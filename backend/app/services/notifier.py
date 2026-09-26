"""Delivery of alerts over email, SMS and push.

Channels without credentials run in *sandbox* mode: the message is rendered
and recorded in the notification log (visible in the app) instead of being
sent. Configure ``SIYULAH_SMTP_*`` or ``SIYULAH_SMS_*`` to deliver for real.
"""

from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

import httpx
from sqlalchemy.orm import Session

from ..core.config import get_settings
from ..models import Alert, Company, Notification, User

log = logging.getLogger("siyulah.notify")


def _recipient(db: Session, company: Company, channel: str) -> str | None:
    if channel == "email":
        if company.alert_email:
            return company.alert_email
        user = db.query(User).filter(User.company_id == company.id).order_by(User.id).first()
        return user.email if user else None
    if channel == "sms":
        return company.alert_phone
    if channel == "push":
        return "web-push"
    return None


def _send_email(to: str, subject: str, body: str) -> tuple[str, str | None]:
    s = get_settings()
    if not s.smtp_host:
        return "sandbox", "SMTP not configured — recorded only"
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = s.smtp_from, to, subject
    msg.set_content(body)
    try:
        with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=10) as smtp:
            smtp.starttls()
            if s.smtp_user:
                smtp.login(s.smtp_user, s.smtp_password)
            smtp.send_message(msg)
        return "sent", None
    except Exception as exc:  # pragma: no cover - network
        log.warning("email failed: %s", exc)
        return "failed", str(exc)


def _send_sms(to: str, body: str) -> tuple[str, str | None]:
    s = get_settings()
    if not s.sms_provider_url:
        return "sandbox", "SMS gateway not configured — recorded only"
    try:  # pragma: no cover - network
        r = httpx.post(
            s.sms_provider_url,
            json={"recipient": to, "body": body[:480]},
            headers={"Authorization": f"Bearer {s.sms_api_key}"},
            timeout=10,
        )
        r.raise_for_status()
        return "sent", None
    except Exception as exc:  # pragma: no cover - network
        return "failed", str(exc)


def deliver(db: Session, company: Company, alert: Alert, channels: list[str], locale: str = "ar") -> list[Notification]:
    records = []
    for channel in channels:
        if channel == "in_app":
            continue
        to = _recipient(db, company, channel)
        subject = f"Siyulah | سيولة — {alert.title_ar if locale == 'ar' else alert.title_en}"
        if channel == "sms":
            body = alert.title_ar + " — " + alert.body_ar if locale == "ar" else alert.title_en + " — " + alert.body_en
        else:
            body = f"{alert.title_ar}\n{alert.body_ar}\n\n———\n\n{alert.title_en}\n{alert.body_en}\n"
        if not to:
            status, detail = "skipped", "No recipient configured"
        elif channel == "email":
            status, detail = _send_email(to, subject, body)
        elif channel == "sms":
            status, detail = _send_sms(to, body)
        else:
            status, detail = "sandbox", "Web push delivery is simulated in the MVP"
        n = Notification(
            company_id=company.id, alert_id=alert.id, channel=channel, recipient=to, status=status, subject=subject, body=body, detail=detail
        )
        db.add(n)
        records.append(n)
        log.info("notify %s via %s -> %s (%s)", alert.rule_kind, channel, to, status)
    db.commit()
    return records
