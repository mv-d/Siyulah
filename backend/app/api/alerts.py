from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..models import Alert, AlertRule, Company, Notification, User, utcnow
from ..services.alerts import DEFAULT_RULES, ensure_rules, evaluate_alerts
from ..services.notifier import deliver
from .deps import get_company, get_current_user
from .forecast import alert_out

router = APIRouter(prefix="/api/alerts", tags=["alerts"])

Channel = Literal["in_app", "email", "sms", "push"]


@router.get("")
def list_alerts(
    status: Literal["active", "all", "resolved"] = "active",
    company: Company = Depends(get_company),
    db: Session = Depends(get_db),
):
    stmt = select(Alert).where(Alert.company_id == company.id)
    if status == "active":
        stmt = stmt.where(Alert.resolved_at.is_(None))
    elif status == "resolved":
        stmt = stmt.where(Alert.resolved_at.is_not(None))
    rows = list(db.scalars(stmt.order_by(Alert.created_at.desc()).limit(200)))
    sev = {"critical": 0, "serious": 1, "warning": 2, "info": 3}
    if status == "active":
        rows.sort(key=lambda a: (sev.get(a.severity, 9), -a.id))
    return [alert_out(a) for a in rows]


@router.post("/{aid}/read")
def mark_read(aid: int, company: Company = Depends(get_company), db: Session = Depends(get_db)):
    a = db.get(Alert, aid)
    if a is None or a.company_id != company.id:
        raise HTTPException(404, "Alert not found")
    a.read_at = a.read_at or utcnow()
    db.commit()
    return alert_out(a)


@router.post("/read-all")
def mark_all_read(company: Company = Depends(get_company), db: Session = Depends(get_db)):
    for a in db.scalars(select(Alert).where(Alert.company_id == company.id, Alert.read_at.is_(None))):
        a.read_at = utcnow()
    db.commit()
    return {"ok": True}


@router.post("/evaluate")
def evaluate(company: Company = Depends(get_company), db: Session = Depends(get_db)):
    created = evaluate_alerts(db, company)
    return {"created": len(created)}


def rule_out(r: AlertRule) -> dict:
    return {
        "kind": r.kind,
        "enabled": r.enabled,
        "threshold_amount": r.threshold_amount,
        "threshold_days": r.threshold_days,
        "threshold_pct": r.threshold_pct,
        "channels": r.channels,
    }


@router.get("/rules")
def rules(company: Company = Depends(get_company), db: Session = Depends(get_db)):
    return [rule_out(r) for r in ensure_rules(db, company)]


class RuleIn(BaseModel):
    enabled: bool | None = None
    threshold_amount: float | None = Field(None, ge=0, le=100_000_000)
    threshold_days: int | None = Field(None, ge=1, le=120)
    threshold_pct: float | None = Field(None, ge=1, le=100)
    channels: list[Channel] | None = None


@router.put("/rules/{kind}")
def update_rule(kind: str, body: RuleIn, company: Company = Depends(get_company), db: Session = Depends(get_db)):
    if kind not in {r["kind"] for r in DEFAULT_RULES}:
        raise HTTPException(404, "Unknown rule")
    ensure_rules(db, company)
    rule = db.scalar(select(AlertRule).where(AlertRule.company_id == company.id, AlertRule.kind == kind))
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(rule, k, sorted(set(v)) if k == "channels" else v)
    db.commit()
    evaluate_alerts(db, company)
    return rule_out(rule)


@router.get("/notifications")
def notifications(company: Company = Depends(get_company), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(Notification).where(Notification.company_id == company.id).order_by(Notification.created_at.desc()).limit(100)
    )
    return [
        {
            "id": n.id,
            "alert_id": n.alert_id,
            "channel": n.channel,
            "recipient": n.recipient,
            "status": n.status,
            "subject": n.subject,
            "body": n.body,
            "detail": n.detail,
            "created_at": n.created_at,
        }
        for n in rows
    ]


class TestIn(BaseModel):
    channel: Channel


@router.post("/test")
def test_notification(body: TestIn, user: User = Depends(get_current_user), company: Company = Depends(get_company), db: Session = Depends(get_db)):
    alert = Alert(
        company_id=company.id,
        rule_kind="test",
        severity="info",
        dedupe_key="test",
        title_en="Test alert from Siyulah",
        title_ar="تنبيه تجريبي من سيولة",
        body_en="Your alert channel is set up correctly.",
        body_ar="تم إعداد قناة التنبيهات بنجاح.",
        data={},
        resolved_at=utcnow(),
        read_at=utcnow(),
    )
    db.add(alert)
    db.flush()
    records = deliver(db, company, alert, [body.channel] if body.channel != "in_app" else [], user.locale)
    return {"status": records[0].status if records else "in_app", "detail": records[0].detail if records else None}
