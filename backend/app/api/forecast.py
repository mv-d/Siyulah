from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.config import today
from ..core.db import get_db
from ..integrations.sandbox_world import SAUDI_BANKS
from ..models import Alert, BankAccount, Company, Connection, Transaction
from ..services.forecast_service import backtest_for, baseline_for, build_inputs, forecast_for
from ..services.forecasting import history_series, run_forecast
from ..services.insights import build_insights, suggest_actions
from .deps import get_company

router = APIRouter(prefix="/api", tags=["forecast"])

_backtest_cache: dict[tuple, dict | None] = {}


def cached_backtest(db: Session, company: Company) -> dict | None:
    count = db.query(Connection).filter(Connection.company_id == company.id).count()
    key = (company.id, today(), count, db.query(BankAccount).filter(BankAccount.company_id == company.id).count())
    if key not in _backtest_cache:
        if len(_backtest_cache) > 128:
            _backtest_cache.clear()
        _backtest_cache[key] = backtest_for(db, company)
    return _backtest_cache[key]


def _accounts(db: Session, company: Company) -> list[dict]:
    out = []
    for a in db.scalars(select(BankAccount).where(BankAccount.company_id == company.id).order_by(BankAccount.balance.desc())):
        name_en, name_ar, _ = SAUDI_BANKS.get(a.bank_code, (a.bank_code, a.bank_code, ""))
        out.append(
            {
                "id": a.id,
                "bank_code": a.bank_code,
                "bank_name": name_en,
                "bank_name_ar": name_ar,
                "name": a.name,
                "iban_masked": f"SA•• •••• •••• •••• {a.iban_last4}" if a.iban_last4 else None,
                "balance": a.balance,
                "currency": a.currency,
                "updated_at": a.balance_updated_at,
            }
        )
    return out


@router.get("/dashboard")
def dashboard(
    horizon: int = Query(90, ge=14, le=120),
    company: Company = Depends(get_company),
    db: Session = Depends(get_db),
):
    now = today()
    inputs = build_inputs(db, company)
    baseline = baseline_for(db, company, inputs)
    result = run_forecast(inputs, horizon, baseline=baseline)
    result["history"] = history_series(inputs.history, inputs.opening_balance, now, 30)

    recv = [r for r in inputs.receivables]
    overdue = [r for r in recv if r.due_date < now]
    pay_30 = [p for p in inputs.payables if (p.expected_date or p.due_date) <= now + timedelta(days=30)]

    upcoming = []
    for s in result["series"]:
        for e in s["events"]:
            if e["kind"] != "receivable" and e["amount"] <= -5_000:
                upcoming.append(e)
    upcoming = upcoming[:8]

    alerts = list(
        db.scalars(
            select(Alert)
            .where(Alert.company_id == company.id, Alert.resolved_at.is_(None))
            .order_by(Alert.created_at.desc())
        )
    )
    sev = {"critical": 0, "serious": 1, "warning": 2, "info": 3}
    alerts.sort(key=lambda a: (sev.get(a.severity, 9), -a.id))
    connections = list(db.scalars(select(Connection).where(Connection.company_id == company.id, Connection.status != "disconnected")))
    backtest = cached_backtest(db, company)

    return {
        "as_of": now,
        "company": {"name": company.name, "name_ar": company.name_ar, "min_cash_buffer": company.min_cash_buffer},
        "balance": round(inputs.opening_balance, 2),
        "accounts": _accounts(db, company),
        "forecast": result,
        "insights": build_insights(inputs, result),
        "suggestions": suggest_actions(inputs, result, baseline, horizon),
        "receivables": {
            "open_total": round(sum(r.outstanding for r in recv), 2),
            "open_count": len(recv),
            "overdue_total": round(sum(r.outstanding for r in overdue), 2),
            "overdue_count": len(overdue),
        },
        "payables": {
            "due_30_total": round(sum(p.outstanding for p in pay_30), 2),
            "due_30_count": len(pay_30),
            "open_total": round(sum(p.outstanding for p in inputs.payables), 2),
        },
        "upcoming": upcoming,
        "alerts": [alert_out(a) for a in alerts[:5]],
        "alerts_unread": sum(1 for a in alerts if a.read_at is None),
        "connections": {
            "bank": sum(1 for c in connections if c.kind == "bank"),
            "accounting": sum(1 for c in connections if c.kind == "accounting"),
            "last_synced_at": max((c.last_synced_at for c in connections if c.last_synced_at), default=None),
        },
        "backtest": {k: v for k, v in backtest.items() if k != "points"} if backtest else None,
        "has_data": bool(inputs.history),
    }


def alert_out(a: Alert) -> dict:
    return {
        "id": a.id,
        "kind": a.rule_kind,
        "severity": a.severity,
        "title_en": a.title_en,
        "title_ar": a.title_ar,
        "body_en": a.body_en,
        "body_ar": a.body_ar,
        "data": a.data,
        "created_at": a.created_at,
        "read_at": a.read_at,
        "resolved_at": a.resolved_at,
    }


@router.get("/forecast")
def forecast(
    horizon: int = Query(90, ge=7, le=120),
    company: Company = Depends(get_company),
    db: Session = Depends(get_db),
):
    return forecast_for(db, company, horizon)


@router.get("/forecast/backtest")
def backtest(company: Company = Depends(get_company), db: Session = Depends(get_db)):
    return cached_backtest(db, company)


@router.get("/transactions")
def transactions(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    category: str | None = None,
    q: str | None = None,
    company: Company = Depends(get_company),
    db: Session = Depends(get_db),
):
    stmt = select(Transaction).where(Transaction.company_id == company.id)
    if category:
        stmt = stmt.where(Transaction.category == category)
    if q:
        stmt = stmt.where(Transaction.description.ilike(f"%{q}%"))
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = db.scalars(stmt.order_by(Transaction.date.desc(), Transaction.id.desc()).offset(offset).limit(limit))
    return {
        "total": total,
        "items": [
            {
                "id": t.id,
                "date": t.date,
                "amount": t.amount,
                "description": t.description,
                "counterparty": t.counterparty,
                "category": t.category,
                "account_id": t.account_id,
            }
            for t in rows
        ],
    }


@router.get("/transactions/categories")
def categories(
    days: int = Query(30, ge=7, le=365),
    company: Company = Depends(get_company),
    db: Session = Depends(get_db),
):
    from ..services.categorizer import CATEGORY_LABELS

    since = today() - timedelta(days=days - 1)
    totals: dict[str, float] = {}
    for cat, amount in db.execute(
        select(Transaction.category, Transaction.amount).where(Transaction.company_id == company.id, Transaction.date >= since)
    ):
        totals[cat] = totals.get(cat, 0.0) + amount
    items = [
        {"category": c, "label_en": CATEGORY_LABELS.get(c, (c, c))[0], "label_ar": CATEGORY_LABELS.get(c, (c, c))[1], "amount": round(v, 2)}
        for c, v in totals.items()
    ]
    items.sort(key=lambda x: x["amount"])
    return {"days": days, "items": items}
