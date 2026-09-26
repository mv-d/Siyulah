from __future__ import annotations

from datetime import UTC, date, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .core.db import Base
from .core.security import EncryptedString


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class Company(Base):
    __tablename__ = "companies"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    name_ar: Mapped[str | None] = mapped_column(String(200))
    sector: Mapped[str] = mapped_column(String(32), default="retail")  # retail | services
    city: Mapped[str] = mapped_column(String(64), default="Riyadh")
    cr_number: Mapped[str | None] = mapped_column(String(32))  # Commercial Registration
    vat_number: Mapped[str | None] = mapped_column(String(32))
    currency: Mapped[str] = mapped_column(String(3), default="SAR")
    # Minimum cash the company wants to keep on hand. Alerts fire below it.
    min_cash_buffer: Mapped[float] = mapped_column(Float, default=50_000)
    alert_email: Mapped[str | None] = mapped_column(String(200))
    alert_phone: Mapped[str | None] = mapped_column(EncryptedString(255))
    # Anchor date for sandbox integrations, so simulated data stays consistent.
    sandbox_anchor: Mapped[date] = mapped_column(Date, default=date.today)
    sandbox_seed: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    users: Mapped[list[User]] = relationship(back_populates="company", cascade="all, delete-orphan")


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"))
    email: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(200))
    password_hash: Mapped[str] = mapped_column(String(255))
    locale: Mapped[str] = mapped_column(String(5), default="ar")
    pdpl_consent_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime)

    company: Mapped[Company] = relationship(back_populates="users")


class OAuthState(Base):
    """Pending OAuth 2.0 authorization (state + PKCE verifier)."""

    __tablename__ = "oauth_states"

    state: Mapped[str] = mapped_column(String(64), primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"))
    provider: Mapped[str] = mapped_column(String(32))
    institution: Mapped[str | None] = mapped_column(String(32))
    code_verifier: Mapped[str] = mapped_column(EncryptedString(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Connection(Base):
    __tablename__ = "connections"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(32))
    kind: Mapped[str] = mapped_column(String(16))  # bank | accounting
    institution: Mapped[str | None] = mapped_column(String(32))  # bank code for open banking
    status: Mapped[str] = mapped_column(String(16), default="connected")
    access_token: Mapped[str | None] = mapped_column(EncryptedString(1024))
    refresh_token: Mapped[str | None] = mapped_column(EncryptedString(1024))
    token_expires_at: Mapped[datetime | None] = mapped_column(DateTime)
    scopes: Mapped[str | None] = mapped_column(String(255))
    connected_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_error: Mapped[str | None] = mapped_column(Text)


class BankAccount(Base):
    __tablename__ = "bank_accounts"
    __table_args__ = (UniqueConstraint("company_id", "external_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    connection_id: Mapped[int | None] = mapped_column(ForeignKey("connections.id", ondelete="CASCADE"))
    external_id: Mapped[str] = mapped_column(String(64))
    bank_code: Mapped[str] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(120))
    iban: Mapped[str | None] = mapped_column(EncryptedString(255))
    iban_last4: Mapped[str | None] = mapped_column(String(4))
    currency: Mapped[str] = mapped_column(String(3), default="SAR")
    balance: Mapped[float] = mapped_column(Float, default=0)
    balance_updated_at: Mapped[datetime | None] = mapped_column(DateTime)


class Transaction(Base):
    __tablename__ = "transactions"
    __table_args__ = (UniqueConstraint("company_id", "external_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("bank_accounts.id", ondelete="CASCADE"), index=True)
    external_id: Mapped[str] = mapped_column(String(80))
    date: Mapped[date] = mapped_column(Date, index=True)
    amount: Mapped[float] = mapped_column(Float)  # signed: + inflow, - outflow
    description: Mapped[str] = mapped_column(String(255))
    counterparty: Mapped[str | None] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(32), index=True)


class Invoice(Base):
    """Receivables (sales invoices) and payables (supplier bills)."""

    __tablename__ = "invoices"
    __table_args__ = (UniqueConstraint("company_id", "external_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    connection_id: Mapped[int | None] = mapped_column(ForeignKey("connections.id", ondelete="SET NULL"))
    external_id: Mapped[str] = mapped_column(String(80))
    source: Mapped[str] = mapped_column(String(16), default="accounting")  # accounting | manual
    kind: Mapped[str] = mapped_column(String(16), index=True)  # receivable | payable
    number: Mapped[str] = mapped_column(String(40))
    counterparty: Mapped[str] = mapped_column(String(200))
    counterparty_ar: Mapped[str | None] = mapped_column(String(200))
    category: Mapped[str | None] = mapped_column(String(32))
    issue_date: Mapped[date] = mapped_column(Date)
    due_date: Mapped[date] = mapped_column(Date, index=True)
    amount: Mapped[float] = mapped_column(Float)  # total incl. VAT
    vat_amount: Mapped[float] = mapped_column(Float, default=0)
    amount_paid: Mapped[float] = mapped_column(Float, default=0)
    status: Mapped[str] = mapped_column(String(16), default="open")  # open | paid | void
    paid_date: Mapped[date | None] = mapped_column(Date)
    # User override: when the customer promised to pay / when we plan to pay.
    expected_date: Mapped[date | None] = mapped_column(Date)
    zatca_uuid: Mapped[str | None] = mapped_column(String(64))
    notes: Mapped[str | None] = mapped_column(Text)

    @property
    def outstanding(self) -> float:
        return max(0.0, round(self.amount - self.amount_paid, 2))


class Obligation(Base):
    """Major scheduled expenses: payroll, rent, ZATCA VAT, GOSI, Zakat, loans."""

    __tablename__ = "obligations"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(24))  # payroll | rent | vat | gosi | zakat | loan | other
    name: Mapped[str] = mapped_column(String(120))
    name_ar: Mapped[str | None] = mapped_column(String(120))
    amount: Mapped[float] = mapped_column(Float)  # positive; always an outflow
    frequency: Mapped[str] = mapped_column(String(16))  # once | monthly | quarterly | semiannual | annual
    next_due_date: Mapped[date] = mapped_column(Date)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    source: Mapped[str] = mapped_column(String(16), default="manual")  # detected | manual
    user_modified: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str | None] = mapped_column(Text)


class Scenario(Base):
    __tablename__ = "scenarios"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(Text)
    adjustments: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class AlertRule(Base):
    __tablename__ = "alert_rules"
    __table_args__ = (UniqueConstraint("company_id", "kind"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    # low_balance | runway | shortfall_risk | overdue_receivable | upcoming_payment
    kind: Mapped[str] = mapped_column(String(32))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    threshold_amount: Mapped[float | None] = mapped_column(Float)
    threshold_days: Mapped[int | None] = mapped_column(Integer)
    threshold_pct: Mapped[float | None] = mapped_column(Float)
    channels: Mapped[list] = mapped_column(JSON, default=lambda: ["in_app", "email"])


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    rule_kind: Mapped[str] = mapped_column(String(32))
    severity: Mapped[str] = mapped_column(String(16))  # critical | serious | warning | info
    dedupe_key: Mapped[str] = mapped_column(String(120), index=True)
    title_en: Mapped[str] = mapped_column(String(255))
    title_ar: Mapped[str] = mapped_column(String(255))
    body_en: Mapped[str] = mapped_column(Text)
    body_ar: Mapped[str] = mapped_column(Text)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    read_at: Mapped[datetime | None] = mapped_column(DateTime)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime)


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    alert_id: Mapped[int | None] = mapped_column(ForeignKey("alerts.id", ondelete="CASCADE"))
    channel: Mapped[str] = mapped_column(String(16))  # email | sms | push | in_app
    recipient: Mapped[str | None] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(16))  # sent | sandbox | failed | skipped
    subject: Mapped[str | None] = mapped_column(String(255))
    body: Mapped[str | None] = mapped_column(Text)
    detail: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int | None] = mapped_column(Integer)
    action: Mapped[str] = mapped_column(String(64))
    detail: Mapped[str | None] = mapped_column(Text)
    ip: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class SandboxGrant(Base):
    """State of the built-in sandbox OAuth server (stands in for Lean/Tarabut/Xero...)."""

    __tablename__ = "sandbox_grants"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"))
    provider: Mapped[str] = mapped_column(String(32))
    institution: Mapped[str | None] = mapped_column(String(32))
    account_role: Mapped[str] = mapped_column(String(16), default="operating")
    code: Mapped[str | None] = mapped_column(String(64), index=True)
    code_challenge: Mapped[str | None] = mapped_column(String(128))
    redirect_uri: Mapped[str | None] = mapped_column(String(500))
    access_token_hash: Mapped[str | None] = mapped_column(String(64), index=True)
    refresh_token_hash: Mapped[str | None] = mapped_column(String(64), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    code_used: Mapped[bool] = mapped_column(Boolean, default=False)
