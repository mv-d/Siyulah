"""Pull data from connected providers into Siyulah and refresh derived state."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.config import today
from ..integrations.sandbox import SandboxClient, SandboxError, token_expiry
from ..models import BankAccount, Company, Connection, Invoice, Obligation, Transaction, utcnow
from .categorizer import categorize
from .obligations import detect_obligations


@dataclass
class SyncResult:
    accounts: int = 0
    transactions_added: int = 0
    invoices_added: int = 0
    invoices_updated: int = 0


def client_for(db: Session, conn: Connection) -> SandboxClient:
    return SandboxClient(db, conn.provider)


def _ensure_token(db: Session, conn: Connection, client: SandboxClient) -> str:
    if conn.token_expires_at and conn.token_expires_at <= utcnow() + timedelta(minutes=1) and conn.refresh_token:
        ts = client.refresh(conn.refresh_token)
        conn.access_token, conn.refresh_token = ts.access_token, ts.refresh_token
        conn.token_expires_at = token_expiry(ts)
        db.commit()
    return conn.access_token or ""


def sync_connection(db: Session, conn: Connection) -> SyncResult:
    client = client_for(db, conn)
    result = SyncResult()
    try:
        token = _ensure_token(db, conn, client)
        if conn.kind == "bank":
            _sync_bank(db, conn, client, token, result)
        elif conn.kind == "accounting":
            _sync_accounting(db, conn, client, token, result)
        conn.status = "connected"
        conn.last_error = None
        conn.last_synced_at = utcnow()
        db.commit()
    except SandboxError as exc:
        db.rollback()
        conn.status = "error"
        conn.last_error = str(exc)
        db.commit()
        raise
    company = db.get(Company, conn.company_id)
    refresh_detected_obligations(db, company)
    return result


def _sync_bank(db: Session, conn: Connection, client: SandboxClient, token: str, result: SyncResult) -> None:
    now = today()
    for remote in client.accounts(token):
        acct = db.scalar(
            select(BankAccount).where(BankAccount.company_id == conn.company_id, BankAccount.external_id == remote.external_id)
        )
        if acct is None:
            acct = BankAccount(company_id=conn.company_id, external_id=remote.external_id, bank_code=remote.bank_code, name=remote.name)
            db.add(acct)
        acct.connection_id = conn.id
        acct.name = remote.name
        acct.iban = remote.iban
        acct.iban_last4 = remote.iban[-4:]
        acct.currency = remote.currency
        acct.balance = remote.balance
        acct.balance_updated_at = utcnow()
        db.flush()
        result.accounts += 1

        last = db.scalar(select(Transaction.date).where(Transaction.account_id == acct.id).order_by(Transaction.date.desc()).limit(1))
        since = (last - timedelta(days=7)) if last else now - timedelta(days=365)
        existing = set(
            db.scalars(select(Transaction.external_id).where(Transaction.company_id == conn.company_id, Transaction.date >= since))
        )
        new_rows = []
        for t in client.transactions(token, remote.external_id, since, now):
            if t.external_id in existing:
                continue
            new_rows.append(
                Transaction(
                    company_id=conn.company_id,
                    account_id=acct.id,
                    external_id=t.external_id,
                    date=t.date,
                    amount=t.amount,
                    description=t.description,
                    counterparty=t.counterparty,
                    category=categorize(t.description, t.amount),
                )
            )
        db.add_all(new_rows)
        result.transactions_added += len(new_rows)
    db.commit()


def _sync_accounting(db: Session, conn: Connection, client: SandboxClient, token: str, result: SyncResult) -> None:
    current = {
        i.external_id: i for i in db.scalars(select(Invoice).where(Invoice.company_id == conn.company_id, Invoice.source == "accounting"))
    }
    for r in client.invoices(token):
        inv = current.get(r.external_id)
        if inv is None:
            db.add(
                Invoice(
                    company_id=conn.company_id,
                    connection_id=conn.id,
                    external_id=r.external_id,
                    source="accounting",
                    kind=r.kind,
                    number=r.number,
                    counterparty=r.counterparty,
                    counterparty_ar=r.counterparty_ar,
                    category=r.category,
                    issue_date=r.issue_date,
                    due_date=r.due_date,
                    amount=r.amount,
                    vat_amount=r.vat_amount,
                    amount_paid=r.amount_paid,
                    status=r.status,
                    paid_date=r.paid_date,
                    zatca_uuid=r.zatca_uuid,
                )
            )
            result.invoices_added += 1
            continue
        # The accounting system is the source of truth, except when the user has
        # already marked an invoice as settled locally.
        if inv.status == "paid" and r.status != "paid":
            continue
        changed = (inv.status, inv.amount_paid, inv.paid_date, inv.due_date, inv.amount) != (
            r.status, r.amount_paid, r.paid_date, r.due_date, r.amount,
        )
        if changed:
            inv.status, inv.amount_paid, inv.paid_date = r.status, r.amount_paid, r.paid_date
            inv.due_date, inv.amount, inv.vat_amount = r.due_date, r.amount, r.vat_amount
            result.invoices_updated += 1
    db.commit()


def has_accounting(db: Session, company_id: int) -> bool:
    return (
        db.query(Connection)
        .filter(Connection.company_id == company_id, Connection.kind == "accounting", Connection.status != "disconnected")
        .count()
        > 0
    )


def refresh_detected_obligations(db: Session, company: Company) -> None:
    now = today()
    txns = [
        (d, a, c)
        for d, a, c in db.execute(
            select(Transaction.date, Transaction.amount, Transaction.category).where(
                Transaction.company_id == company.id, Transaction.date >= now - timedelta(days=400)
            )
        )
    ]
    invoices = None
    if has_accounting(db, company.id):
        invoices = [
            (k, d, a)
            for k, d, a in db.execute(
                select(Invoice.kind, Invoice.issue_date, Invoice.amount).where(
                    Invoice.company_id == company.id, Invoice.status != "void", Invoice.issue_date >= now - timedelta(days=200)
                )
            )
        ]
    detected = detect_obligations(txns, now, invoices)
    existing = {
        o.kind: o
        for o in db.scalars(select(Obligation).where(Obligation.company_id == company.id, Obligation.source == "detected"))
    }
    for det in detected:
        ob = existing.get(det.kind)
        if ob is None:
            db.add(
                Obligation(
                    company_id=company.id,
                    kind=det.kind,
                    name=det.name,
                    name_ar=det.name_ar,
                    amount=det.amount,
                    frequency=det.frequency,
                    next_due_date=det.next_due_date,
                    source="detected",
                    notes=det.notes,
                )
            )
            continue
        new_period = det.kind == "vat" and ob.name != det.name
        if new_period:
            ob.active = True
            ob.user_modified = False
        if ob.user_modified or not ob.active:
            continue
        ob.name, ob.name_ar, ob.amount = det.name, det.name_ar, det.amount
        ob.frequency, ob.next_due_date, ob.notes = det.frequency, det.next_due_date, det.notes
    db.commit()


def sync_company(db: Session, company: Company) -> SyncResult:
    total = SyncResult()
    for conn in db.scalars(select(Connection).where(Connection.company_id == company.id, Connection.status != "disconnected")):
        r = sync_connection(db, conn)
        total.accounts += r.accounts
        total.transactions_added += r.transactions_added
        total.invoices_added += r.invoices_added
        total.invoices_updated += r.invoices_updated
    return total
