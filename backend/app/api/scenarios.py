from __future__ import annotations

import datetime as dt
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..models import Company, Scenario
from ..services.forecast_service import scenario_compare
from .deps import get_company

router = APIRouter(prefix="/api/scenarios", tags=["scenarios"])

AdjType = Literal[
    "delay_receivable",
    "expect_receivable",
    "write_off_receivable",
    "shift_payable",
    "shift_obligation",
    "skip_obligation",
    "revenue_change",
    "expense_change",
    "one_off",
    "recurring",
    "loan",
]

REQUIRED = {
    "delay_receivable": ("invoice_id", "days"),
    "expect_receivable": ("invoice_id", "date"),
    "write_off_receivable": ("invoice_id",),
    "shift_payable": ("invoice_id", "days"),
    "shift_obligation": ("obligation_id", "days"),
    "skip_obligation": ("obligation_id",),
    "revenue_change": ("pct",),
    "expense_change": ("pct",),
    "one_off": ("date", "amount"),
    "recurring": ("start_date", "amount"),
    "loan": ("date", "amount", "months"),
}


class Adjustment(BaseModel):
    type: AdjType
    invoice_id: int | None = None
    obligation_id: int | None = None
    days: int | None = Field(None, ge=-120, le=180)
    pct: float | None = Field(None, ge=-100, le=500)
    date: dt.date | None = None
    start_date: dt.date | None = None
    end_date: dt.date | None = None
    amount: float | None = Field(None, ge=-100_000_000, le=100_000_000)
    months: int | None = Field(None, ge=1, le=120)
    rate_pct: float | None = Field(None, ge=0, le=50)
    frequency: Literal["weekly", "monthly", "quarterly"] | None = None
    label: str | None = Field(None, max_length=120)

    @model_validator(mode="after")
    def _required(self):
        missing = [f for f in REQUIRED[self.type] if getattr(self, f) is None]
        if missing:
            raise ValueError(f"{self.type} requires {', '.join(missing)}")
        return self


class ScenarioIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(None, max_length=1000)
    adjustments: list[Adjustment] = Field(default_factory=list, max_length=25)


class PreviewIn(BaseModel):
    adjustments: list[Adjustment] = Field(default_factory=list, max_length=25)
    horizon: int = Field(90, ge=14, le=120)


def _dump(adjs: list[Adjustment]) -> list[dict]:
    return [a.model_dump(mode="json", exclude_none=True) for a in adjs]


def scenario_out(s: Scenario) -> dict:
    return {
        "id": s.id,
        "name": s.name,
        "description": s.description,
        "adjustments": s.adjustments,
        "created_at": s.created_at,
        "updated_at": s.updated_at,
    }


def _get(db: Session, company: Company, sid: int) -> Scenario:
    s = db.get(Scenario, sid)
    if s is None or s.company_id != company.id:
        raise HTTPException(404, "Scenario not found")
    return s


@router.get("")
def list_scenarios(company: Company = Depends(get_company), db: Session = Depends(get_db)):
    rows = db.scalars(select(Scenario).where(Scenario.company_id == company.id).order_by(Scenario.updated_at.desc()))
    return [scenario_out(s) for s in rows]


@router.post("", status_code=201)
def create_scenario(body: ScenarioIn, company: Company = Depends(get_company), db: Session = Depends(get_db)):
    s = Scenario(company_id=company.id, name=body.name, description=body.description, adjustments=_dump(body.adjustments))
    db.add(s)
    db.commit()
    return scenario_out(s)


@router.put("/{sid}")
def update_scenario(sid: int, body: ScenarioIn, company: Company = Depends(get_company), db: Session = Depends(get_db)):
    s = _get(db, company, sid)
    s.name, s.description, s.adjustments = body.name, body.description, _dump(body.adjustments)
    db.commit()
    return scenario_out(s)


@router.delete("/{sid}", status_code=204)
def delete_scenario(sid: int, company: Company = Depends(get_company), db: Session = Depends(get_db)):
    db.delete(_get(db, company, sid))
    db.commit()


@router.post("/preview")
def preview(body: PreviewIn, company: Company = Depends(get_company), db: Session = Depends(get_db)):
    return scenario_compare(db, company, _dump(body.adjustments), body.horizon)


@router.get("/{sid}/run")
def run(sid: int, horizon: int = Query(90, ge=14, le=120), company: Company = Depends(get_company), db: Session = Depends(get_db)):
    s = _get(db, company, sid)
    return {"scenario": scenario_out(s), **scenario_compare(db, company, s.adjustments, horizon)}
