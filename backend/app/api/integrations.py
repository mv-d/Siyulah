from __future__ import annotations

import html
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..integrations.providers import PROVIDERS
from ..integrations.sandbox import SandboxError, issue_code
from ..integrations.sandbox_world import SAUDI_BANKS
from ..models import BankAccount, Company, Connection, OAuthState, User
from ..services.alerts import evaluate_alerts
from ..services.connections import ConnectionError_, complete_authorization, disconnect, redirect_uri as registered_redirect_uri, start_authorization
from ..services.sync import sync_company, sync_connection
from .deps import audit, get_company, get_current_user

router = APIRouter(prefix="/api/integrations", tags=["integrations"])
sandbox_router = APIRouter(prefix="/api/sandbox", tags=["sandbox"])


def connection_out(c: Connection, db: Session) -> dict:
    info = PROVIDERS.get(c.provider)
    bank = SAUDI_BANKS.get(c.institution or "")
    accounts = db.query(BankAccount).filter(BankAccount.connection_id == c.id).count() if c.kind == "bank" else None
    return {
        "id": c.id,
        "provider": c.provider,
        "provider_name": info.name if info else c.provider,
        "provider_name_ar": info.name_ar if info else c.provider,
        "kind": c.kind,
        "institution": c.institution,
        "institution_name": bank[0] if bank else None,
        "institution_name_ar": bank[1] if bank else None,
        "status": c.status,
        "scopes": (c.scopes or "").split(),
        "connected_at": c.connected_at,
        "last_synced_at": c.last_synced_at,
        "last_error": c.last_error,
        "accounts": accounts,
        "token_encrypted": True,
    }


@router.get("/providers")
def providers():
    return {
        "providers": [
            {
                "key": p.key,
                "kind": p.kind,
                "name": p.name,
                "name_ar": p.name_ar,
                "description": p.description,
                "description_ar": p.description_ar,
                "scopes": list(p.scopes),
                "status": p.status,
                "needs_institution": p.needs_institution,
                "color": p.color,
                "tags": list(p.tags),
            }
            for p in PROVIDERS.values()
        ],
        "banks": [{"code": k, "name": v[0], "name_ar": v[1]} for k, v in SAUDI_BANKS.items()],
    }


@router.get("/connections")
def connections(company: Company = Depends(get_company), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(Connection).where(Connection.company_id == company.id, Connection.status != "disconnected").order_by(Connection.id)
    )
    return [connection_out(c, db) for c in rows]


class AuthorizeIn(BaseModel):
    institution: str | None = None


@router.post("/{provider}/authorize")
def authorize(
    provider: str,
    body: AuthorizeIn,
    request: Request,
    user: User = Depends(get_current_user),
    company: Company = Depends(get_company),
    db: Session = Depends(get_db),
):
    try:
        url, state = start_authorization(db, company, provider, body.institution)
    except ConnectionError_ as exc:
        raise HTTPException(400, str(exc)) from exc
    audit(db, request, user, "integration.authorize", f"{provider}:{body.institution or ''}")
    return {"authorize_url": url, "state": state}


class CallbackIn(BaseModel):
    code: str
    state: str


@router.post("/callback")
def callback(
    body: CallbackIn,
    request: Request,
    user: User = Depends(get_current_user),
    company: Company = Depends(get_company),
    db: Session = Depends(get_db),
):
    try:
        conn = complete_authorization(db, company, body.state, body.code)
    except (ConnectionError_, SandboxError) as exc:
        raise HTTPException(400, str(exc)) from exc
    evaluate_alerts(db, company)
    audit(db, request, user, "integration.connected", f"{conn.provider}:{conn.institution or ''}")
    return connection_out(conn, db)


@router.post("/connections/{cid}/sync")
def sync(cid: int, request: Request, user: User = Depends(get_current_user), company: Company = Depends(get_company), db: Session = Depends(get_db)):
    conn = db.get(Connection, cid)
    if conn is None or conn.company_id != company.id or conn.status == "disconnected":
        raise HTTPException(404, "Connection not found")
    try:
        result = sync_connection(db, conn)
    except SandboxError as exc:
        raise HTTPException(502, f"Provider error: {exc}") from exc
    evaluate_alerts(db, company)
    audit(db, request, user, "integration.sync", conn.provider)
    return {"connection": connection_out(conn, db), "result": result.__dict__}


@router.post("/sync-all")
def sync_all(request: Request, user: User = Depends(get_current_user), company: Company = Depends(get_company), db: Session = Depends(get_db)):
    result = sync_company(db, company)
    evaluate_alerts(db, company)
    audit(db, request, user, "integration.sync_all")
    return result.__dict__


@router.delete("/connections/{cid}", status_code=204)
def remove(cid: int, request: Request, user: User = Depends(get_current_user), company: Company = Depends(get_company), db: Session = Depends(get_db)):
    conn = db.get(Connection, cid)
    if conn is None or conn.company_id != company.id:
        raise HTTPException(404, "Connection not found")
    disconnect(db, company, conn)
    evaluate_alerts(db, company)
    audit(db, request, user, "integration.disconnected", f"{conn.provider}:{conn.institution or ''} — imported data deleted")


# --- Sandbox provider consent screen ----------------------------------------------

CONSENT_PAGE = """<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<style>
:root{{color-scheme:light dark;--bg:#f4f6f5;--card:#fff;--ink:#101413;--muted:#5b6461;--line:#dfe5e2;--brand:{color}}}
@media (prefers-color-scheme:dark){{:root{{--bg:#0f1312;--card:#171c1b;--ink:#eef3f1;--muted:#a6b0ad;--line:#2a3230}}}}
*{{box-sizing:border-box}}body{{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);
font:15px/1.6 system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;padding:16px}}
.card{{width:min(460px,100%);background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px}}
.badge{{display:inline-flex;gap:8px;align-items:center;font-size:12px;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:2px 10px}}
.logo{{width:44px;height:44px;border-radius:12px;background:var(--brand);color:#fff;display:grid;place-items:center;font-weight:700;font-size:18px}}
h1{{font-size:20px;margin:14px 0 4px}}p{{margin:4px 0;color:var(--muted)}}
ul{{padding-inline-start:20px;margin:14px 0}}li{{margin:4px 0}}
.en{{direction:ltr;text-align:left;border-top:1px solid var(--line);margin-top:16px;padding-top:12px;font-size:13px;color:var(--muted)}}
.row{{display:flex;gap:10px;margin-top:20px}}button{{flex:1;font:inherit;padding:11px 14px;border-radius:10px;border:1px solid var(--line);
background:transparent;color:var(--ink);cursor:pointer}}button.primary{{background:var(--brand);border-color:var(--brand);color:#fff;font-weight:600}}
</style></head><body><form class="card" method="post" action="{action}">
<span class="badge">⚙︎ بيئة تجريبية · Sandbox</span>
<div style="display:flex;gap:12px;align-items:center;margin-top:16px"><div class="logo">{initial}</div>
<div><strong>{provider_ar}</strong><br><span style="color:var(--muted);font-size:13px">{institution_ar}</span></div></div>
<h1>يطلب تطبيق «سيولة» الوصول إلى بياناتك</h1>
<p>وصول للقراءة فقط. لن يتمكن التطبيق من إجراء أي عمليات أو تحويلات.</p>
<ul>{scopes}</ul>
<div class="en"><strong>Siyulah is requesting read-only access</strong> to your {provider_en} data{institution_en}.
It cannot move money or change records. You can revoke access at any time.</div>
{hidden}
<div class="row"><button class="primary" name="decision" value="allow">السماح · Allow</button>
<button name="decision" value="deny">رفض · Deny</button></div></form></body></html>"""

SCOPE_LABELS = {
    "accounts:read": "قائمة الحسابات · Accounts",
    "balances:read": "الأرصدة · Balances",
    "transactions:read": "حركات آخر ١٢ شهراً · 12 months of transactions",
    "invoices:read": "فواتير المبيعات · Sales invoices",
    "bills:read": "فواتير المشتريات · Supplier bills",
    "contacts:read": "جهات الاتصال · Contacts",
}


@sandbox_router.get("/oauth/{provider}/authorize", response_class=HTMLResponse)
def sandbox_authorize(
    provider: str,
    state: str,
    redirect_uri: str,
    code_challenge: str,
    code_challenge_method: str = "S256",
    institution: str | None = None,
    scope: str = "",
    db: Session = Depends(get_db),
):
    info = PROVIDERS.get(provider)
    if info is None or code_challenge_method != "S256":
        raise HTTPException(400, "invalid_request")
    if redirect_uri != registered_redirect_uri():  # only the registered redirect URI is allowed
        raise HTTPException(400, "invalid_request: redirect_uri not registered")
    if db.get(OAuthState, state) is None:
        raise HTTPException(400, "invalid_request: unknown state")
    bank = SAUDI_BANKS.get(institution or "")
    hidden = "".join(
        f'<input type="hidden" name="{k}" value="{html.escape(v or "")}">'
        for k, v in {"state": state, "redirect_uri": redirect_uri, "code_challenge": code_challenge, "institution": institution}.items()
    )
    scopes = "".join(f"<li>{html.escape(SCOPE_LABELS.get(s, s))}</li>" for s in scope.split())
    page = CONSENT_PAGE.format(
        title=f"{info.name} — Sandbox consent",
        color=html.escape(info.color),
        action=f"/api/sandbox/oauth/{provider}/decision",
        initial=html.escape(info.name[:1]),
        provider_ar=html.escape(info.name_ar),
        institution_ar=html.escape(bank[1]) if bank else "",
        provider_en=html.escape(info.name),
        institution_en=f" at {html.escape(bank[0])}" if bank else "",
        scopes=scopes,
        hidden=hidden,
    )
    return HTMLResponse(page, headers={"X-Frame-Options": "DENY", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action *"})


@sandbox_router.post("/oauth/{provider}/decision")
def sandbox_decision(
    provider: str,
    state: str = Form(...),
    redirect_uri: str = Form(...),
    code_challenge: str = Form(...),
    institution: str = Form(""),
    decision: str = Form(...),
    db: Session = Depends(get_db),
):
    st = db.get(OAuthState, state)
    if st is None or st.provider != provider or redirect_uri != registered_redirect_uri():
        raise HTTPException(400, "invalid_request")
    if decision != "allow":
        return RedirectResponse(f"{redirect_uri}?{urlencode({'error': 'access_denied', 'state': state})}", status_code=303)
    code = issue_code(
        db,
        company_id=st.company_id,
        provider=provider,
        institution=institution or None,
        code_challenge=code_challenge,
        redirect_uri=redirect_uri,
    )
    return RedirectResponse(f"{redirect_uri}?{urlencode({'code': code, 'state': state})}", status_code=303)
