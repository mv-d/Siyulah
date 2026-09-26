"""OAuth 2.0 connection lifecycle for bank and accounting integrations."""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..core.config import get_settings
from ..core.security import pkce_challenge, random_token
from ..integrations.providers import PROVIDERS
from ..integrations.sandbox import SandboxClient, SandboxError, issue_code, token_expiry
from ..models import BankAccount, Company, Connection, Invoice, OAuthState, utcnow
from .sync import refresh_detected_obligations, sync_connection

STATE_TTL = timedelta(minutes=10)


class ConnectionError_(Exception):
    pass


def redirect_uri() -> str:
    return f"{get_settings().frontend_url}/integrations/callback"


def start_authorization(db: Session, company: Company, provider: str, institution: str | None) -> tuple[str, str]:
    info = PROVIDERS.get(provider)
    if info is None or info.status != "available":
        raise ConnectionError_("This integration is not available yet")
    if info.needs_institution and not institution:
        raise ConnectionError_("Choose a bank to connect")
    duplicate = db.scalar(
        select(Connection).where(
            Connection.company_id == company.id,
            Connection.status != "disconnected",
            Connection.provider == provider if info.kind != "bank" else Connection.institution == institution,
        )
    )
    if duplicate is not None:
        raise ConnectionError_("Already connected")
    verifier = random_token(48)
    state = random_token(24)
    db.add(OAuthState(state=state, company_id=company.id, provider=provider, institution=institution, code_verifier=verifier))
    db.commit()
    url = SandboxClient(db, provider).authorize_url(
        state=state, code_challenge=pkce_challenge(verifier), redirect_uri=redirect_uri(), institution=institution
    )
    return url, state


def complete_authorization(db: Session, company: Company, state: str, code: str) -> Connection:
    st = db.get(OAuthState, state)
    if st is None or st.company_id != company.id:
        raise ConnectionError_("Invalid or expired authorization request")
    if utcnow() - st.created_at > STATE_TTL:
        db.delete(st)
        db.commit()
        raise ConnectionError_("Authorization request expired — please try again")
    info = PROVIDERS[st.provider]
    try:
        tokens = SandboxClient(db, st.provider).exchange_code(code=code, code_verifier=st.code_verifier, redirect_uri=redirect_uri())
    except SandboxError as exc:
        raise ConnectionError_(str(exc)) from exc
    conn = Connection(
        company_id=company.id,
        provider=st.provider,
        kind=info.kind,
        institution=st.institution,
        status="connected",
        access_token=tokens.access_token,
        refresh_token=tokens.refresh_token,
        token_expires_at=token_expiry(tokens),
        scopes=tokens.scope,
    )
    db.add(conn)
    db.delete(st)
    db.commit()
    sync_connection(db, conn)
    return conn


def connect_directly(db: Session, company: Company, provider: str, institution: str | None = None) -> Connection:
    """Run the full OAuth flow server-side (used to seed the demo company)."""
    _, state = start_authorization(db, company, provider, institution)
    st = db.get(OAuthState, state)
    code = issue_code(
        db,
        company_id=company.id,
        provider=provider,
        institution=institution,
        code_challenge=pkce_challenge(st.code_verifier),
        redirect_uri=redirect_uri(),
    )
    return complete_authorization(db, company, state, code)


def disconnect(db: Session, company: Company, conn: Connection) -> None:
    """Revoke access and delete the data imported through this connection (PDPL)."""
    if conn.kind == "bank":
        db.execute(delete(BankAccount).where(BankAccount.connection_id == conn.id))
    else:
        db.execute(delete(Invoice).where(Invoice.connection_id == conn.id, Invoice.source == "accounting"))
    conn.status = "disconnected"
    conn.access_token = None
    conn.refresh_token = None
    db.commit()
    refresh_detected_obligations(db, company)
