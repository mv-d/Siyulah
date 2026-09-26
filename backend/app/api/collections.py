"""Collections assistant: who to chase first, measured against the forecast.

Each overdue or soon-due invoice is re-run through the engine as "collected
within a week" on the same simulated paths as the baseline, so the reported
effect on shortfall risk and on the low point is that collection alone.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.config import today
from ..core.db import get_db
from ..models import Company, Invoice
from ..services.forecast_service import baseline_for, build_inputs
from ..services.forecasting import run_forecast
from .deps import get_company

router = APIRouter(prefix="/api", tags=["collections"])

CANDIDATE_WINDOW_DAYS = 14  # overdue, or due within two weeks
MAX_CANDIDATES = 10
COLLECT_WITHIN_DAYS = 7


def _profiles(invoices: list[Invoice]) -> dict[str, dict]:
    """Per-customer payment behaviour from settled invoices."""
    delays: dict[str, list[int]] = defaultdict(list)
    for inv in invoices:
        if inv.kind == "receivable" and inv.paid_date:
            delays[inv.counterparty].append((inv.paid_date - inv.due_date).days)
    out = {}
    for name, d in delays.items():
        out[name] = {
            "paid_invoices": len(d),
            "avg_days_late": round(sum(d) / len(d), 1),
            "on_time_rate": round(sum(1 for x in d if x <= 3) / len(d), 3),
            "worst_days_late": max(d),
        }
    return out


@router.get("/collections")
def collections(company: Company = Depends(get_company), db: Session = Depends(get_db)):
    now = today()
    inputs = build_inputs(db, company)
    if not inputs.history:
        return {"as_of": now, "items": [], "summary": None}
    baseline = baseline_for(db, company, inputs)
    base = run_forecast(inputs, 90, baseline=baseline)
    bm = base["metrics"]
    expected = {r["id"]: r for r in base["receivables"]}

    invoices = list(db.scalars(select(Invoice).where(Invoice.company_id == company.id, Invoice.kind == "receivable")))
    by_id = {i.id: i for i in invoices}
    profiles = _profiles(invoices)
    outstanding_by_customer: dict[str, float] = defaultdict(float)
    for r in inputs.receivables:
        outstanding_by_customer[r.counterparty] += r.outstanding

    candidates = sorted(
        (r for r in inputs.receivables if (r.due_date - now).days <= CANDIDATE_WINDOW_DAYS and r.outstanding > 0),
        key=lambda r: -r.outstanding,
    )[:MAX_CANDIDATES]
    target = now + timedelta(days=COLLECT_WITHIN_DAYS)
    items = []
    for r in candidates:
        inv = by_id[r.id]
        # Same simulations as the baseline, so the difference is this collection alone.
        run = run_forecast(
            inputs,
            90,
            [{"type": "expect_receivable", "invoice_id": r.id, "date": target.isoformat()}],
            n_sims=base["model"]["simulations"],
            baseline=baseline,
        )
        sm = run["metrics"]
        overdue = max(0, (now - r.due_date).days)
        view = expected.get(r.id) or {}
        exp_date = view.get("expected_date")
        days_sooner = max(0, (exp_date - target).days) if exp_date else None
        profile = profiles.get(r.counterparty)
        items.append(
            {
                "invoice_id": r.id,
                "number": r.number,
                "counterparty": r.counterparty,
                "counterparty_ar": r.counterparty_ar,
                "amount": inv.amount,
                "outstanding": r.outstanding,
                "issue_date": inv.issue_date,
                "due_date": r.due_date,
                "days_overdue": overdue,
                "promised_date": inv.expected_date,
                "zatca_uuid": inv.zatca_uuid,
                "notes": inv.notes,
                "forecast": expected.get(r.id),
                "customer": {
                    **(profile or {"paid_invoices": 0, "avg_days_late": None, "on_time_rate": None, "worst_days_late": None}),
                    "total_outstanding": round(outstanding_by_customer[r.counterparty], 2),
                },
                "impact": {
                    "collect_by": target,
                    "lowest_balance": sm["lowest_balance"],
                    "lowest_balance_change": round(sm["lowest_balance"] - bm["lowest_balance"], 2),
                    "shortfall_probability": sm["shortfall_probability"],
                    "shortfall_change": round(sm["shortfall_probability"] - bm["shortfall_probability"], 3),
                    "days_below_buffer_change": sm["days_below_buffer"] - bm["days_below_buffer"],
                    # How much sooner than the forecast expects the money would arrive.
                    "days_sooner": days_sooner,
                    "cash_days": round(r.outstanding * (days_sooner or 0), 0),
                },
                "tone": "friendly" if overdue == 0 else "firm" if overdue <= 30 else "final",
            }
        )
    # Biggest reduction in risk first, then the biggest lift to the low point.
    items.sort(
        key=lambda i: (
            i["impact"]["shortfall_change"],
            -i["impact"]["lowest_balance_change"],
            -i["impact"]["cash_days"],
            -i["outstanding"],
        )
    )
    overdue_items = [r for r in inputs.receivables if r.due_date < now]
    return {
        "as_of": now,
        "items": items,
        "summary": {
            "overdue_total": round(sum(r.outstanding for r in overdue_items), 2),
            "overdue_count": len(overdue_items),
            "due_soon_total": round(sum(r.outstanding for r in inputs.receivables if now <= r.due_date <= now + timedelta(days=CANDIDATE_WINDOW_DAYS)), 2),
            "baseline_lowest_balance": bm["lowest_balance"],
            "baseline_shortfall_probability": bm["shortfall_probability"],
            "collect_within_days": COLLECT_WITHIN_DAYS,
        },
    }
