from __future__ import annotations

import json
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.config import get_settings, today
from ..core.db import get_db
from ..core.security import hash_password, verify_password
from ..models import (
    AlertRule,
    AuditLog,
    BankAccount,
    Company,
    Connection,
    Invoice,
    Obligation,
    Scenario,
    Transaction,
    User,
)
from ..services.alerts import evaluate_alerts
from .deps import audit, get_company, get_current_user

router = APIRouter(prefix="/api", tags=["settings"])


def company_out(c: Company) -> dict:
    return {
        "id": c.id,
        "name": c.name,
        "name_ar": c.name_ar,
        "sector": c.sector,
        "city": c.city,
        "cr_number": c.cr_number,
        "vat_number": c.vat_number,
        "currency": c.currency,
        "min_cash_buffer": c.min_cash_buffer,
        "alert_email": c.alert_email,
        "alert_phone": c.alert_phone,
        "created_at": c.created_at,
    }


class CompanyIn(BaseModel):
    name: str | None = Field(None, min_length=2, max_length=200)
    name_ar: str | None = Field(None, max_length=200)
    city: str | None = Field(None, max_length=64)
    cr_number: str | None = Field(None, pattern=r"^\d{10}$")
    vat_number: str | None = Field(None, pattern=r"^3\d{13}3$")
    min_cash_buffer: float | None = Field(None, ge=0, le=100_000_000)
    alert_email: EmailStr | None = None
    alert_phone: str | None = Field(None, pattern=r"^\+9665\d{8}$")


@router.get("/company")
def get_company_settings(company: Company = Depends(get_company)):
    return company_out(company)


@router.put("/company")
def update_company(
    body: CompanyIn,
    request: Request,
    user: User = Depends(get_current_user),
    company: Company = Depends(get_company),
    db: Session = Depends(get_db),
):
    changes = body.model_dump(exclude_none=True)
    for k, v in changes.items():
        setattr(company, k, v)
    db.commit()
    audit(db, request, user, "company.updated", ", ".join(sorted(changes)))
    if "min_cash_buffer" in changes:
        evaluate_alerts(db, company)
    return company_out(company)


class MeIn(BaseModel):
    full_name: str | None = Field(None, min_length=2, max_length=200)
    locale: Literal["ar", "en"] | None = None


@router.put("/me")
def update_me(body: MeIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(user, k, v)
    db.commit()
    return {"full_name": user.full_name, "locale": user.locale}


class PasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


@router.post("/me/password", status_code=204)
def change_password(body: PasswordIn, request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(400, "Current password is incorrect")
    user.password_hash = hash_password(body.new_password)
    db.commit()
    audit(db, request, user, "auth.password_changed")


# --- PDPL / security ------------------------------------------------------------


@router.get("/privacy")
def privacy_info(user: User = Depends(get_current_user)):
    s = get_settings()
    return {
        "data_region": s.data_region,
        "encryption_at_rest": "AES-256-GCM (integration tokens, IBANs, phone numbers)",
        "password_hashing": "scrypt (N=16384, r=8, p=1)",
        "transport": "TLS 1.2+ required in production",
        "bank_access": "Read-only via SAMA open banking providers (OAuth 2.0 + PKCE)",
        "consent_recorded_at": user.pdpl_consent_at,
        "retention": "Bank and accounting data is deleted when you disconnect an integration or delete the account.",
        "frameworks": ["SAMA Cyber Security Framework", "Saudi PDPL", "SAMA Open Banking Framework"],
    }


@router.get("/privacy/export")
def export_data(
    request: Request,
    user: User = Depends(get_current_user),
    company: Company = Depends(get_company),
    db: Session = Depends(get_db),
):
    """PDPL right of access: a machine-readable copy of everything we hold."""

    def rows(model, *order):
        return [
            {c.name: getattr(r, c.name) for c in model.__table__.columns if c.name not in ("access_token", "refresh_token", "password_hash")}
            for r in db.scalars(select(model).where(model.company_id == company.id).order_by(*order))
        ]

    data = {
        "exported_at": today().isoformat(),
        "data_region": get_settings().data_region,
        "company": company_out(company),
        "users": [
            {"email": u.email, "full_name": u.full_name, "locale": u.locale, "pdpl_consent_at": u.pdpl_consent_at, "created_at": u.created_at}
            for u in db.scalars(select(User).where(User.company_id == company.id))
        ],
        "connections": rows(Connection, Connection.id),
        "bank_accounts": rows(BankAccount, BankAccount.id),
        "transactions": rows(Transaction, Transaction.date),
        "invoices": rows(Invoice, Invoice.issue_date),
        "obligations": rows(Obligation, Obligation.id),
        "scenarios": rows(Scenario, Scenario.id),
        "alert_rules": rows(AlertRule, AlertRule.id),
        "audit_log": rows(AuditLog, AuditLog.created_at),
    }
    audit(db, request, user, "privacy.export")
    body = json.dumps(data, default=str, ensure_ascii=False, indent=2)
    return Response(
        body,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="siyulah-export-{today().isoformat()}.json"'},
    )


class DeleteIn(BaseModel):
    password: str
    confirm: Literal["DELETE"]


@router.post("/privacy/delete-account", status_code=204)
def delete_account(
    body: DeleteIn,
    request: Request,
    user: User = Depends(get_current_user),
    company: Company = Depends(get_company),
    db: Session = Depends(get_db),
):
    """PDPL right to erasure: remove the company and all its data."""
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(400, "Password is incorrect")
    if user.email == "demo@siyulah.sa":
        raise HTTPException(400, "The shared demo account cannot be deleted")
    audit(db, request, None, "privacy.account_deleted", f"company {company.id}", company_id=None)
    db.delete(company)
    db.commit()


@router.get("/privacy/audit")
def audit_log(company: Company = Depends(get_company), db: Session = Depends(get_db)):
    rows = db.scalars(select(AuditLog).where(AuditLog.company_id == company.id).order_by(AuditLog.created_at.desc()).limit(100))
    return [{"id": r.id, "action": r.action, "detail": r.detail, "ip": r.ip, "created_at": r.created_at} for r in rows]
