"""Glue between the database and the pure forecasting engine."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from threading import Lock

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.config import today
from ..models import BankAccount, Company, Invoice, Obligation, Transaction
from .forecasting import (
    Baseline,
    ForecastInputs,
    ObligationInput,
    PayableInput,
    ReceivableInput,
    build_baseline,
    history_series,
    run_forecast,
)
from .obligations import detect_obligations
from .sync import has_accounting

_baseline_cache: dict[tuple, Baseline] = {}
DISCRETIONARY = ("owner_draw", "transfer")
_cache_lock = Lock()


def current_balance(db: Session, company_id: int) -> float:
    return float(db.scalar(select(func.coalesce(func.sum(BankAccount.balance), 0.0)).where(BankAccount.company_id == company_id)))


def _transactions(db: Session, company_id: int, since: date) -> list[tuple[date, float, str]]:
    return [
        (d, a, c)
        for d, a, c in db.execute(
            select(Transaction.date, Transaction.amount, Transaction.category).where(
                Transaction.company_id == company_id, Transaction.date >= since
            )
        )
    ]


def build_inputs(db: Session, company: Company, as_of: date | None = None) -> ForecastInputs:
    now = today()
    as_of = as_of or now
    live = as_of >= now
    all_txns = _transactions(db, company.id, as_of - timedelta(days=400))
    balance = current_balance(db, company.id)
    if not live:
        balance -= sum(a for d, a, _ in all_txns if as_of < d <= now)
    history = [t for t in all_txns if t[0] <= as_of]

    invoices = list(db.scalars(select(Invoice).where(Invoice.company_id == company.id, Invoice.status != "void")))
    delays: dict[str, list[int]] = defaultdict(list)
    receivable_lags: list[int] = []
    payable_lags: list[int] = []
    for inv in invoices:
        if inv.paid_date and inv.paid_date <= as_of and inv.paid_date >= as_of - timedelta(days=365):
            if inv.kind == "receivable":
                delays[inv.counterparty].append((inv.paid_date - inv.due_date).days)
                receivable_lags.append((inv.paid_date - inv.issue_date).days)
            else:
                payable_lags.append((inv.paid_date - inv.issue_date).days)

    receivables, payables = [], []
    for inv in invoices:
        if inv.issue_date > as_of:
            continue
        if live:
            if inv.status != "open" or inv.outstanding <= 0:
                continue
            outstanding, expected = inv.outstanding, inv.expected_date
        else:
            if inv.paid_date and inv.paid_date <= as_of:
                continue
            if inv.status == "void":
                continue
            outstanding, expected = inv.amount, None
        if inv.kind == "receivable":
            receivables.append(
                ReceivableInput(inv.id, inv.number, inv.counterparty, inv.due_date, outstanding, delays.get(inv.counterparty, []), expected, inv.counterparty_ar)
            )
        else:
            payables.append(PayableInput(inv.id, inv.number, inv.counterparty, inv.due_date, outstanding, expected, inv.counterparty_ar))

    accounting = has_accounting(db, company.id)
    if live:
        obligations = [
            ObligationInput(o.id, o.kind, o.name, o.amount, o.frequency, o.next_due_date, o.name_ar)
            for o in db.scalars(select(Obligation).where(Obligation.company_id == company.id, Obligation.active.is_(True)))
        ]
    else:
        inv_rows = [(i.kind, i.issue_date, i.amount) for i in invoices if i.issue_date <= as_of] if accounting else None
        obligations = [
            ObligationInput(-(k + 1), o.kind, o.name, o.amount, o.frequency, o.next_due_date, o.name_ar)
            for k, o in enumerate(detect_obligations(history, as_of, inv_rows))
        ]

    return ForecastInputs(
        today=as_of,
        opening_balance=balance,
        history=history,
        receivables=receivables,
        payables=payables,
        obligations=obligations,
        company_delays=[d for v in delays.values() for d in v],
        safety_buffer=company.min_cash_buffer,
        invoices_connected=accounting,
        receivable_lags=receivable_lags,
        payable_lags=payable_lags,
    )


def baseline_for(db: Session, company: Company, inputs: ForecastInputs) -> Baseline:
    count, max_id = db.execute(
        select(func.count(Transaction.id), func.max(Transaction.id)).where(Transaction.company_id == company.id)
    ).one()
    key = (company.id, inputs.today, count, max_id, inputs.invoices_connected)
    with _cache_lock:
        cached = _baseline_cache.get(key)
    if cached is not None:
        return cached
    baseline = build_baseline(inputs)
    with _cache_lock:
        if len(_baseline_cache) > 256:
            _baseline_cache.clear()
        _baseline_cache[key] = baseline
    return baseline


def forecast_for(
    db: Session, company: Company, horizon: int = 90, adjustments: list[dict] | None = None, n_sims: int = 500
) -> dict:
    inputs = build_inputs(db, company)
    baseline = baseline_for(db, company, inputs)
    result = run_forecast(inputs, horizon, adjustments, n_sims=n_sims, baseline=baseline)
    result["history"] = history_series(inputs.history, inputs.opening_balance, inputs.today, 30)
    return result


def scenario_compare(db: Session, company: Company, adjustments: list[dict], horizon: int = 90) -> dict:
    inputs = build_inputs(db, company)
    baseline = baseline_for(db, company, inputs)
    base = run_forecast(inputs, horizon, [], baseline=baseline)
    scen = run_forecast(inputs, horizon, adjustments, baseline=baseline)
    bm, sm = base["metrics"], scen["metrics"]
    delta = {
        k: round(sm[k] - bm[k], 2)
        for k in (
            "lowest_balance",
            "ending_balance",
            "shortfall_probability",
            "buffer_breach_probability",
            "net_change",
            "total_inflow",
            "total_outflow",
            "days_below_buffer",
        )
    }
    delta["runway_days"] = (
        None if bm["runway_days"] is None and sm["runway_days"] is None else (sm["runway_days"] or horizon + 1) - (bm["runway_days"] or horizon + 1)
    )
    history = history_series(inputs.history, inputs.opening_balance, inputs.today, 30)
    return {"baseline": base, "scenario": scen, "delta": delta, "history": history}


def backtest_for(db: Session, company: Company, days: int = 30) -> dict | None:
    """Re-run the full pipeline as of ``days`` ago and score it against what happened."""
    now = today()
    as_of = now - timedelta(days=days)
    inputs = build_inputs(db, company, as_of=as_of)
    if len(inputs.history) < 60:
        return None
    result = run_forecast(inputs, days, n_sims=300)
    live = build_inputs(db, company)
    actual = history_series(live.history, live.opening_balance, now, days + 1)[1:]
    # Partner distributions and internal transfers are discretionary and never
    # forecast, so score against the operating balance (i.e. add them back).
    discretionary: dict[date, float] = defaultdict(float)
    for d, a, c in live.history:
        if as_of < d <= now and c in DISCRETIONARY:
            discretionary[d] += a
    running = 0.0
    for a in actual:
        running += discretionary.get(a["date"], 0.0)
        a["balance"] = round(a["balance"] - running, 2)
    points = []
    abs_err = 0.0
    scale = 0.0
    inside = 0
    for f, a in zip(result["series"], actual):
        points.append({"date": f["date"], "predicted": f["p50"], "p10": f["p10"], "p90": f["p90"], "actual": a["balance"]})
        abs_err += abs(f["p50"] - a["balance"])
        scale += abs(a["balance"])
        inside += f["p10"] <= a["balance"] <= f["p90"]
    n = max(1, len(points))
    return {
        "as_of": as_of,
        "days": days,
        "points": points,
        "accuracy": round(max(0.0, 1 - abs_err / scale), 3) if scale else None,
        "band_coverage": round(inside / n, 3),
        "end_predicted": points[-1]["predicted"] if points else None,
        "end_actual": points[-1]["actual"] if points else None,
        "excluded_discretionary": round(-sum(discretionary.values()), 2),
    }
