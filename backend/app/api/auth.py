from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from ..core.config import today
from ..core.db import get_db
from ..core.security import create_access_token, hash_password, verify_password
from ..models import Company, User, utcnow
from ..services.alerts import ensure_rules
from ..services.seed import seed_demo
from .deps import audit, get_company, get_current_user

router = APIRouter(prefix="/api/auth", tags=["auth"])


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=2, max_length=200)
    company_name: str = Field(min_length=2, max_length=200)
    sector: Literal["retail", "services"] = "retail"
    city: str = "Riyadh"
    locale: Literal["ar", "en"] = "ar"
    pdpl_consent: bool


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


def user_out(user: User, company: Company) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "locale": user.locale,
        "company": {
            "id": company.id,
            "name": company.name,
            "name_ar": company.name_ar,
            "sector": company.sector,
            "city": company.city,
            "min_cash_buffer": company.min_cash_buffer,
            "currency": company.currency,
        },
    }


@router.post("/register", response_model=TokenOut, status_code=201)
def register(body: RegisterIn, request: Request, db: Session = Depends(get_db)):
    if not body.pdpl_consent:
        raise HTTPException(422, "Consent to data processing (PDPL) is required")
    if db.query(User).filter(User.email == body.email.lower()).first():
        raise HTTPException(409, "An account with this email already exists")
    company = Company(
        name=body.company_name,
        name_ar=body.company_name,
        sector=body.sector,
        city=body.city,
        min_cash_buffer=50_000 if body.sector == "retail" else 150_000,
        alert_email=body.email.lower(),
        sandbox_anchor=today(),
    )
    db.add(company)
    db.flush()
    company.sandbox_seed = 100 + company.id
    user = User(
        company_id=company.id,
        email=body.email.lower(),
        full_name=body.full_name,
        password_hash=hash_password(body.password),
        locale=body.locale,
        pdpl_consent_at=utcnow(),
    )
    db.add(user)
    db.commit()
    ensure_rules(db, company)
    audit(db, request, user, "auth.register", f"PDPL consent recorded at {user.pdpl_consent_at.isoformat()}")
    return TokenOut(access_token=create_access_token(user.id, company.id))


@router.post("/login", response_model=TokenOut)
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email.lower()).first()
    if user is None or not verify_password(body.password, user.password_hash):
        audit(db, request, None, "auth.login_failed", body.email.lower())
        raise HTTPException(401, "Incorrect email or password")
    if user.email == "demo@siyulah.sa":
        user = seed_demo(db)  # re-anchors the demo story if it has gone stale
    user.last_login_at = utcnow()
    db.commit()
    audit(db, request, user, "auth.login")
    return TokenOut(access_token=create_access_token(user.id, user.company_id))


@router.post("/demo", response_model=TokenOut)
def demo(request: Request, reset: bool = False, db: Session = Depends(get_db)):
    user = seed_demo(db, force=reset)
    audit(db, request, user, "auth.demo_login")
    return TokenOut(access_token=create_access_token(user.id, user.company_id))


@router.get("/me")
def me(user: User = Depends(get_current_user), company: Company = Depends(get_company)):
    return user_out(user, company)
