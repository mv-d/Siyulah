"""Built-in sandbox that emulates the OAuth 2.0 + data APIs of the providers.

It follows the real flow end to end — authorization code with PKCE (S256),
single-use codes bound to the redirect URI, opaque bearer tokens stored only as
SHA-256 hashes, refresh tokens — so the rest of the platform is exercised
exactly as it would be against Lean, Tarabut, Xero or Qoyod.

The data behind each grant comes from ``SandboxWorld`` (a deterministic
simulation of the connected company). Because it is a sandbox, the consent
screen resolves the company from our own ``state`` value; a real provider would
authenticate the business user instead.
"""

from __future__ import annotations

import hashlib
from datetime import date, datetime, timedelta
from urllib.parse import urlencode

from sqlalchemy.orm import Session

from ..core.config import get_settings, today
from ..core.security import pkce_challenge, random_token
from ..models import Company, Connection, SandboxGrant, utcnow
from .providers import (
    PROVIDERS,
    RemoteAccount,
    RemoteInvoice,
    RemoteTransaction,
    TokenSet,
)
from .sandbox_world import SAUDI_BANKS, HISTORY_DAYS, SandboxWorld, saudi_iban

CODE_TTL = timedelta(minutes=10)
TOKEN_TTL_SECONDS = 3600


class SandboxError(Exception):
    pass


def _h(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def world_for(company: Company) -> SandboxWorld:
    return SandboxWorld(seed=company.sandbox_seed or company.id, sector=company.sector, anchor=company.sandbox_anchor)


def issue_code(
    db: Session,
    *,
    company_id: int,
    provider: str,
    institution: str | None,
    code_challenge: str,
    redirect_uri: str,
) -> str:
    """Called by the sandbox consent screen when the user approves access."""
    role = "operating"
    if PROVIDERS[provider].kind == "bank":
        other_banks = (
            db.query(Connection)
            .filter(Connection.company_id == company_id, Connection.kind == "bank", Connection.status == "connected")
            .count()
        )
        role = "reserve" if other_banks else "operating"
    code = random_token(24)
    db.add(
        SandboxGrant(
            company_id=company_id,
            provider=provider,
            institution=institution,
            account_role=role,
            code=code,
            code_challenge=code_challenge,
            redirect_uri=redirect_uri,
        )
    )
    db.commit()
    return code


class SandboxClient:
    def __init__(self, db: Session, provider: str):
        if provider not in PROVIDERS:
            raise SandboxError(f"Unknown provider {provider}")
        self.db = db
        self.provider = provider
        self.info = PROVIDERS[provider]

    # -- OAuth ----------------------------------------------------------------
    def authorize_url(self, *, state: str, code_challenge: str, redirect_uri: str, institution: str | None) -> str:
        params = {
            "response_type": "code",
            "client_id": f"siyulah-{self.provider}-sandbox",
            "redirect_uri": redirect_uri,
            "scope": " ".join(self.info.scopes),
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
        if institution:
            params["institution"] = institution
        return f"{get_settings().api_url}/api/sandbox/oauth/{self.provider}/authorize?{urlencode(params)}"

    def _issue_tokens(self, grant: SandboxGrant) -> TokenSet:
        access, refresh = "sbx_at_" + random_token(32), "sbx_rt_" + random_token(32)
        grant.access_token_hash = _h(access)
        grant.refresh_token_hash = _h(refresh)
        self.db.commit()
        return TokenSet(access, refresh, TOKEN_TTL_SECONDS, " ".join(self.info.scopes))

    def exchange_code(self, *, code: str, code_verifier: str, redirect_uri: str) -> TokenSet:
        grant = self.db.query(SandboxGrant).filter_by(code=code, provider=self.provider).first()
        if grant is None or grant.code_used:
            raise SandboxError("invalid_grant: unknown or already used code")
        if utcnow() - grant.created_at > CODE_TTL:
            raise SandboxError("invalid_grant: code expired")
        if grant.redirect_uri != redirect_uri:
            raise SandboxError("invalid_grant: redirect_uri mismatch")
        if pkce_challenge(code_verifier) != grant.code_challenge:
            raise SandboxError("invalid_grant: PKCE verification failed")
        grant.code_used = True
        return self._issue_tokens(grant)

    def refresh(self, refresh_token: str) -> TokenSet:
        grant = self.db.query(SandboxGrant).filter_by(refresh_token_hash=_h(refresh_token), provider=self.provider).first()
        if grant is None:
            raise SandboxError("invalid_grant: unknown refresh token")
        return self._issue_tokens(grant)

    def _grant(self, access_token: str) -> SandboxGrant:
        grant = self.db.query(SandboxGrant).filter_by(access_token_hash=_h(access_token), provider=self.provider).first()
        if grant is None:
            raise SandboxError("invalid_token")
        return grant

    def _world(self, grant: SandboxGrant) -> SandboxWorld:
        company = self.db.get(Company, grant.company_id)
        if company is None:
            raise SandboxError("invalid_token")
        return world_for(company)

    # -- Open banking ---------------------------------------------------------
    def accounts(self, access_token: str) -> list[RemoteAccount]:
        grant = self._grant(access_token)
        if self.info.kind != "bank":
            return []
        world = self._world(grant)
        inst = grant.institution or "alrajhi"
        bank_name, _, bank_code = SAUDI_BANKS.get(inst, SAUDI_BANKS["alrajhi"])
        role = grant.account_role
        name = "Current account — Operations" if role == "operating" else "Murabaha deposit — Reserve"
        return [
            RemoteAccount(
                external_id=f"{self.provider}-{inst}-{role}",
                bank_code=inst,
                name=name,
                iban=saudi_iban(bank_code, grant.company_id * 31 + (0 if role == "operating" else 7)),
                currency="SAR",
                balance=world.balance(today(), role),
            )
        ]

    def transactions(self, access_token: str, account_id: str, since: date, until: date) -> list[RemoteTransaction]:
        grant = self._grant(access_token)
        world = self._world(grant)
        role = "reserve" if account_id.endswith("reserve") else "operating"
        start = max(since, today() - timedelta(days=HISTORY_DAYS - 1))
        end = min(until, today())
        return [
            RemoteTransaction(f"{account_id}:{t.external_id}", t.date, t.amount, t.description, t.counterparty)
            for t in world.transactions(start, end, role)
        ]

    # -- Accounting -----------------------------------------------------------
    def invoices(self, access_token: str) -> list[RemoteInvoice]:
        grant = self._grant(access_token)
        if self.info.kind != "accounting":
            return []
        world = self._world(grant)
        now = today()
        cutoff = now - timedelta(days=HISTORY_DAYS + 60)
        out = []
        for inv in world.invoices(now):
            if inv.issue_date < cutoff and inv.paid_date:
                continue
            out.append(
                RemoteInvoice(
                    external_id=f"{self.provider}:{inv.external_id}",
                    kind=inv.kind,
                    number=inv.number,
                    counterparty=inv.party.name_en,
                    counterparty_ar=inv.party.name_ar,
                    issue_date=inv.issue_date,
                    due_date=inv.due_date,
                    amount=inv.amount,
                    vat_amount=inv.vat_amount,
                    amount_paid=inv.amount if inv.paid_date else 0.0,
                    status="paid" if inv.paid_date else "open",
                    paid_date=inv.paid_date,
                    zatca_uuid=inv.zatca_uuid,
                    category=inv.category,
                )
            )
        return out


def token_expiry(ts: TokenSet) -> datetime:
    return utcnow() + timedelta(seconds=ts.expires_in)
