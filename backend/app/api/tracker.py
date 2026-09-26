"""Payables / receivables tracker and major obligations."""

from __future__ import annotations

import datetime as dt
import uuid
from collections import defaultdict
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.config import today
from ..core.db import get_db
from ..models import Company, Invoice, Obligation
from ..services.forecast_service import baseline_for, build_inputs
from ..services.forecasting import ObligationInput, obligation_occurrences, run_forecast
from .deps import get_company

router = APIRouter(prefix="/api", tags=["tracker"])

AGING_BUCKETS = [("current", None, 0), ("1_30", 1, 30), ("31_60", 31, 60), ("61_90", 61, 90), ("90_plus", 91, None)]


def _bucket(days_overdue: int) -> str:
    for key, lo, hi in AGING_BUCKETS:
        if (lo is None or days_overdue >= lo) and (hi is None or days_overdue <= hi):
            return key
    return "90_plus"


def invoice_out(inv: Invoice, now: dt.date, behaviour: dict[str, float] | None = None, forecast: dict | None = None) -> dict:
    overdue = (now - inv.due_date).days if inv.status == "open" else 0
    out = {
        "id": inv.id,
        "kind": inv.kind,
        "number": inv.number,
        "source": inv.source,
        "counterparty": inv.counterparty,
        "counterparty_ar": inv.counterparty_ar,
        "category": inv.category,
        "issue_date": inv.issue_date,
        "due_date": inv.due_date,
        "amount": inv.amount,
        "vat_amount": inv.vat_amount,
        "amount_paid": inv.amount_paid,
        "outstanding": inv.outstanding,
        "status": inv.status,
        "paid_date": inv.paid_date,
        "expected_date": inv.expected_date,
        "zatca_uuid": inv.zatca_uuid,
        "notes": inv.notes,
        "days_overdue": max(0, overdue),
        "aging": _bucket(max(0, overdue)) if inv.status == "open" else None,
        "customer_avg_delay": (behaviour or {}).get(inv.counterparty),
    }
    if forecast:
        out["forecast"] = forecast
    return out


def _behaviour(invoices: list[Invoice]) -> dict[str, float]:
    delays: dict[str, list[int]] = defaultdict(list)
    for i in invoices:
        if i.kind == "receivable" and i.paid_date:
            delays[i.counterparty].append((i.paid_date - i.due_date).days)
    return {k: round(sum(v) / len(v), 1) for k, v in delays.items() if v}


@router.get("/invoices")
def list_invoices(
    kind: Literal["receivable", "payable"] = "receivable",
    status: Literal["open", "overdue", "paid", "all"] = "open",
    q: str | None = None,
    limit: int = Query(200, ge=1, le=1000),
    company: Company = Depends(get_company),
    db: Session = Depends(get_db),
):
    now = today()
    all_inv = list(db.scalars(select(Invoice).where(Invoice.company_id == company.id)))
    behaviour = _behaviour(all_inv)
    rows = [i for i in all_inv if i.kind == kind and i.status != "void"]
    if status == "open":
        rows = [i for i in rows if i.status == "open"]
    elif status == "overdue":
        rows = [i for i in rows if i.status == "open" and i.due_date < now]
    elif status == "paid":
        rows = [i for i in rows if i.status == "paid"]
    if q:
        ql = q.lower()
        rows = [i for i in rows if ql in i.number.lower() or ql in i.counterparty.lower() or ql in (i.counterparty_ar or "")]
    rows.sort(key=lambda i: (i.status != "open", i.due_date if i.status == "open" else dt.date.max - (i.paid_date or i.due_date)))

    forecast_view: dict[int, dict] = {}
    if kind == "receivable" and status != "paid":
        inputs = build_inputs(db, company)
        if inputs.history:
            res = run_forecast(inputs, 90, n_sims=300, baseline=baseline_for(db, company, inputs))
            forecast_view = {r["id"]: r for r in res["receivables"]}
    return [invoice_out(i, now, behaviour, forecast_view.get(i.id)) for i in rows[:limit]]


@router.get("/invoices/summary")
def invoice_summary(company: Company = Depends(get_company), db: Session = Depends(get_db)):
    now = today()
    rows = list(db.scalars(select(Invoice).where(Invoice.company_id == company.id, Invoice.status == "open")))
    out = {}
    for kind in ("receivable", "payable"):
        buckets = {k: {"amount": 0.0, "count": 0} for k, _, _ in AGING_BUCKETS}
        for i in rows:
            if i.kind != kind or i.outstanding <= 0:
                continue
            b = buckets[_bucket(max(0, (now - i.due_date).days))]
            b["amount"] = round(b["amount"] + i.outstanding, 2)
            b["count"] += 1
        total = sum(b["amount"] for b in buckets.values())
        due_7 = sum(i.outstanding for i in rows if i.kind == kind and now <= i.due_date <= now + dt.timedelta(days=7))
        out[kind] = {
            "total": round(total, 2),
            "overdue": round(total - buckets["current"]["amount"], 2),
            "due_next_7_days": round(due_7, 2),
            "buckets": [{"key": k, **buckets[k]} for k, _, _ in AGING_BUCKETS],
        }
    # Days Sales Outstanding over the last 90 days of invoicing.
    recent = list(
        db.scalars(
            select(Invoice).where(
                Invoice.company_id == company.id, Invoice.kind == "receivable", Invoice.issue_date >= now - dt.timedelta(days=90)
            )
        )
    )
    billed = sum(i.amount for i in recent)
    out["dso_days"] = round(out["receivable"]["total"] / (billed / 90), 1) if billed else None
    return out


class InvoiceIn(BaseModel):
    kind: Literal["receivable", "payable"]
    number: str = Field(min_length=1, max_length=40)
    counterparty: str = Field(min_length=1, max_length=200)
    issue_date: dt.date
    due_date: dt.date
    amount: float = Field(gt=0, le=100_000_000)
    vat_included: bool = True
    notes: str | None = Field(None, max_length=1000)


class InvoicePatch(BaseModel):
    status: Literal["open", "paid", "void"] | None = None
    paid_date: dt.date | None = None
    expected_date: dt.date | None = None
    clear_expected_date: bool = False
    notes: str | None = Field(None, max_length=1000)


def _get_invoice(db: Session, company: Company, iid: int) -> Invoice:
    inv = db.get(Invoice, iid)
    if inv is None or inv.company_id != company.id:
        raise HTTPException(404, "Invoice not found")
    return inv


@router.post("/invoices", status_code=201)
def create_invoice(body: InvoiceIn, company: Company = Depends(get_company), db: Session = Depends(get_db)):
    if body.due_date < body.issue_date:
        raise HTTPException(422, "Due date must be on or after the issue date")
    vat = round(body.amount * 0.15 / 1.15, 2) if body.vat_included else 0.0
    inv = Invoice(
        company_id=company.id,
        external_id=f"manual:{uuid.uuid4()}",
        source="manual",
        kind=body.kind,
        number=body.number,
        counterparty=body.counterparty,
        counterparty_ar=body.counterparty,
        issue_date=body.issue_date,
        due_date=body.due_date,
        amount=body.amount,
        vat_amount=vat,
        notes=body.notes,
    )
    db.add(inv)
    db.commit()
    return invoice_out(inv, today())


@router.patch("/invoices/{iid}")
def update_invoice(iid: int, body: InvoicePatch, company: Company = Depends(get_company), db: Session = Depends(get_db)):
    inv = _get_invoice(db, company, iid)
    if body.status == "paid":
        inv.status = "paid"
        inv.amount_paid = inv.amount
        inv.paid_date = body.paid_date or today()
    elif body.status == "open":
        inv.status, inv.amount_paid, inv.paid_date = "open", 0.0, None
    elif body.status == "void":
        inv.status = "void"
    if body.expected_date is not None:
        inv.expected_date = body.expected_date
    if body.clear_expected_date:
        inv.expected_date = None
    if body.notes is not None:
        inv.notes = body.notes
    db.commit()
    return invoice_out(inv, today())


@router.delete("/invoices/{iid}", status_code=204)
def delete_invoice(iid: int, company: Company = Depends(get_company), db: Session = Depends(get_db)):
    inv = _get_invoice(db, company, iid)
    if inv.source != "manual":
        raise HTTPException(400, "Synced invoices are managed in your accounting system — void it instead")
    db.delete(inv)
    db.commit()


# --- Obligations -----------------------------------------------------------------


class ObligationIn(BaseModel):
    kind: Literal["payroll", "rent", "vat", "gosi", "zakat", "loan", "other"]
    name: str = Field(min_length=1, max_length=120)
    name_ar: str | None = Field(None, max_length=120)
    amount: float = Field(gt=0, le=100_000_000)
    frequency: Literal["once", "monthly", "quarterly", "semiannual", "annual"]
    next_due_date: dt.date
    notes: str | None = Field(None, max_length=1000)


class ObligationPatch(BaseModel):
    name: str | None = Field(None, max_length=120)
    amount: float | None = Field(None, gt=0, le=100_000_000)
    frequency: Literal["once", "monthly", "quarterly", "semiannual", "annual"] | None = None
    next_due_date: dt.date | None = None
    active: bool | None = None
    notes: str | None = Field(None, max_length=1000)


def obligation_out(o: Obligation, now: dt.date) -> dict:
    occ = obligation_occurrences(
        ObligationInput(o.id, o.kind, o.name, o.amount, o.frequency, o.next_due_date, o.name_ar), now, now + dt.timedelta(days=90)
    )
    return {
        "id": o.id,
        "kind": o.kind,
        "name": o.name,
        "name_ar": o.name_ar,
        "amount": o.amount,
        "frequency": o.frequency,
        "next_due_date": o.next_due_date,
        "next_payment_date": occ[0] if occ else None,
        "occurrences_90d": occ,
        "active": o.active,
        "source": o.source,
        "user_modified": o.user_modified,
        "notes": o.notes,
    }


def _get_obligation(db: Session, company: Company, oid: int) -> Obligation:
    o = db.get(Obligation, oid)
    if o is None or o.company_id != company.id:
        raise HTTPException(404, "Obligation not found")
    return o


@router.get("/obligations")
def list_obligations(include_inactive: bool = False, company: Company = Depends(get_company), db: Session = Depends(get_db)):
    now = today()
    stmt = select(Obligation).where(Obligation.company_id == company.id)
    if not include_inactive:
        stmt = stmt.where(Obligation.active.is_(True))
    rows = [obligation_out(o, now) for o in db.scalars(stmt)]
    rows.sort(key=lambda o: (o["next_payment_date"] or dt.date.max))
    return rows


@router.post("/obligations", status_code=201)
def create_obligation(body: ObligationIn, company: Company = Depends(get_company), db: Session = Depends(get_db)):
    o = Obligation(company_id=company.id, source="manual", **body.model_dump())
    db.add(o)
    db.commit()
    return obligation_out(o, today())


@router.patch("/obligations/{oid}")
def update_obligation(oid: int, body: ObligationPatch, company: Company = Depends(get_company), db: Session = Depends(get_db)):
    o = _get_obligation(db, company, oid)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(o, k, v)
    o.user_modified = True
    db.commit()
    return obligation_out(o, today())


@router.delete("/obligations/{oid}", status_code=204)
def delete_obligation(oid: int, company: Company = Depends(get_company), db: Session = Depends(get_db)):
    o = _get_obligation(db, company, oid)
    if o.source == "detected":
        o.active = False  # keep a tombstone so re-detection does not bring it back
        o.user_modified = True
    else:
        db.delete(o)
    db.commit()
