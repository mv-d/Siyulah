"""Smart alerts: evaluate rules against the live forecast and notify."""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.config import today
from ..core.i18n import date_ar, date_en, pct, sar_ar, sar_en
from ..models import Alert, AlertRule, Company, User, utcnow
from .forecast_service import baseline_for, build_inputs
from .forecasting import run_forecast
from .notifier import deliver

DEFAULT_RULES = [
    {"kind": "low_balance", "threshold_days": 30, "channels": ["in_app", "email"]},
    {"kind": "runway", "threshold_days": 30, "channels": ["in_app", "email", "sms"]},
    {"kind": "shortfall_risk", "threshold_pct": 20.0, "channels": ["in_app", "email"]},
    {"kind": "overdue_receivable", "threshold_days": 7, "channels": ["in_app"]},
    {"kind": "upcoming_payment", "threshold_amount": 50_000.0, "threshold_days": 7, "channels": ["in_app", "email"]},
]
SEVERITY_RANK = {"info": 0, "warning": 1, "serious": 2, "critical": 3}


def ensure_rules(db: Session, company: Company) -> list[AlertRule]:
    existing = {r.kind: r for r in db.scalars(select(AlertRule).where(AlertRule.company_id == company.id))}
    for spec in DEFAULT_RULES:
        if spec["kind"] not in existing:
            rule = AlertRule(company_id=company.id, **spec)
            db.add(rule)
            existing[spec["kind"]] = rule
    db.commit()
    return [existing[s["kind"]] for s in DEFAULT_RULES]


def _cond(severity: str, en: str, ar: str, body_en: str, body_ar: str, **data) -> dict:
    return {"severity": severity, "title_en": en, "title_ar": ar, "body_en": body_en, "body_ar": body_ar, "data": data}


def evaluate_alerts(db: Session, company: Company) -> list[Alert]:
    rules = {r.kind: r for r in ensure_rules(db, company) if r.enabled}
    inputs = build_inputs(db, company)
    if not inputs.history:
        return []
    # Same horizon, simulation count and seed as the dashboard, so alerts and KPIs agree exactly.
    result = run_forecast(inputs, 90, baseline=baseline_for(db, company, inputs))
    m, series = result["metrics"], result["series"]
    now = today()
    conditions: dict[str, dict] = {}

    rule = rules.get("low_balance")
    if rule:
        threshold = rule.threshold_amount or company.min_cash_buffer
        window = series[: rule.threshold_days or 30]
        breach = next((s for s in window if s["p50"] < threshold), None)
        if breach:
            low = min(window, key=lambda s: s["p50"])
            neg = low["p50"] < 0
            conditions["low_balance"] = _cond(
                "critical" if neg else "serious",
                f"Balance projected below {sar_en(threshold)} on {date_en(breach['date'])}",
                f"توقع انخفاض الرصيد عن {sar_ar(threshold)} في {date_ar(breach['date'])}",
                f"Lowest projected balance in the next {len(window)} days is {sar_en(low['p50'])} on {date_en(low['date'])}. "
                "Review upcoming payments or accelerate collections.",
                f"أدنى رصيد متوقع خلال {len(window)} يوماً هو {sar_ar(low['p50'])} في {date_ar(low['date'])}. "
                "راجع المدفوعات القادمة أو سرّع التحصيل.",
                breach_date=breach["date"],
                lowest=low["p50"],
                lowest_date=low["date"],
            )

    rule = rules.get("runway")
    if rule and m["runway_days"] is not None and m["runway_days"] <= (rule.threshold_days or 30):
        conditions["runway"] = _cond(
            "critical",
            f"Warning: {m['runway_days']}-day cash runway remaining",
            f"تحذير: السيولة المتبقية تكفي {m['runway_days']} يوماً فقط",
            f"At the current trajectory the balance reaches zero on {date_en(m['cash_zero_date'])}.",
            f"وفق المسار الحالي سيصل الرصيد إلى الصفر في {date_ar(m['cash_zero_date'])}.",
            runway_days=m["runway_days"],
            cash_zero_date=m["cash_zero_date"],
        )

    rule = rules.get("shortfall_risk")
    if rule and m["shortfall_probability"] * 100 >= (rule.threshold_pct or 20):
        conditions["shortfall_risk"] = _cond(
            "critical" if m["shortfall_probability"] >= 0.5 else "serious",
            f"{pct(m['shortfall_probability'])} risk of a cash shortfall within 90 days",
            f"خطر عجز نقدي بنسبة {pct(m['shortfall_probability'])} خلال 90 يوماً",
            f"In {pct(m['shortfall_probability'])} of simulated scenarios the balance drops below zero"
            + (f", earliest around {date_en(m['risk_date'])}." if m["risk_date"] else "."),
            f"في {pct(m['shortfall_probability'])} من السيناريوهات المحاكاة ينخفض الرصيد تحت الصفر"
            + (f"، أقربها حوالي {date_ar(m['risk_date'])}." if m["risk_date"] else "."),
            probability=m["shortfall_probability"],
        )

    rule = rules.get("overdue_receivable")
    if rule:
        late = [r for r in inputs.receivables if (now - r.due_date).days > (rule.threshold_days or 7)]
        if late:
            total = sum(r.outstanding for r in late)
            worst = max(late, key=lambda r: (now - r.due_date).days)
            days = (now - worst.due_date).days
            conditions["overdue_receivable"] = _cond(
                "warning",
                f"{len(late)} overdue invoices — {sar_en(total)} outstanding",
                f"{len(late)} فواتير متأخرة — {sar_ar(total)} مستحقة",
                f"Oldest: {worst.number} from {worst.counterparty}, {days} days past due.",
                f"الأقدم: {worst.number} من {worst.counterparty_ar or worst.counterparty}، متأخرة {days} يوماً.",
                count=len(late),
                total=total,
                invoice_ids=[r.id for r in late],
            )

    created: list[Alert] = []
    locale = (db.query(User).filter(User.company_id == company.id).order_by(User.id).first() or User(locale="ar")).locale
    active = {
        a.rule_kind: a
        for a in db.scalars(
            select(Alert).where(Alert.company_id == company.id, Alert.resolved_at.is_(None), Alert.rule_kind != "upcoming_payment")
        )
    }
    for kind, rule in rules.items():
        if kind == "upcoming_payment":
            continue
        cond = conditions.get(kind)
        current = active.get(kind)
        if cond is None:
            if current:
                current.resolved_at = utcnow()
            continue
        data = _jsonable(cond.pop("data"))
        if current is None:
            alert = Alert(company_id=company.id, rule_kind=kind, dedupe_key=kind, data=data, **cond)
            db.add(alert)
            db.flush()
            created.append(alert)
            deliver(db, company, alert, rule.channels, locale)
        else:
            escalated = SEVERITY_RANK[cond["severity"]] > SEVERITY_RANK[current.severity]
            for k, v in cond.items():
                setattr(current, k, v)
            current.data = data
            if escalated:
                current.read_at = None
                deliver(db, company, current, rule.channels, locale)

    rule = rules.get("upcoming_payment")
    if rule:
        horizon = now + timedelta(days=rule.threshold_days or 7)
        seen = set(db.scalars(select(Alert.dedupe_key).where(Alert.company_id == company.id, Alert.rule_kind == "upcoming_payment")))
        for s in series:
            if s["date"] > horizon:
                break
            for e in s["events"]:
                if e["amount"] > -(rule.threshold_amount or 50_000) or e["kind"] in ("receivable", "scenario"):
                    continue
                key = f"upcoming:{e['ref']}:{e['date'].isoformat()}"
                if key in seen:
                    continue
                days = (e["date"] - now).days
                alert = Alert(
                    company_id=company.id,
                    rule_kind="upcoming_payment",
                    severity="info",
                    dedupe_key=key,
                    title_en=f"{e['label_en']}: {sar_en(-e['amount'])} due {date_en(e['date'])}",
                    title_ar=f"{e['label_ar']}: {sar_ar(-e['amount'])} مستحقة في {date_ar(e['date'])}",
                    body_en=f"Due in {days} day{'s' if days != 1 else ''}. Projected balance after payment: {sar_en(s['p50'])}.",
                    body_ar=f"مستحقة خلال {days} يوم. الرصيد المتوقع بعد السداد: {sar_ar(s['p50'])}.",
                    data=_jsonable({"date": e["date"], "amount": e["amount"], "ref": e["ref"]}),
                )
                db.add(alert)
                db.flush()
                created.append(alert)
                deliver(db, company, alert, rule.channels, locale)
        for a in db.scalars(
            select(Alert).where(Alert.company_id == company.id, Alert.rule_kind == "upcoming_payment", Alert.resolved_at.is_(None))
        ):
            due = a.data.get("date")
            if due and due < now.isoformat():
                a.resolved_at = utcnow()
    db.commit()
    return created


def _jsonable(data: dict) -> dict:
    out = {}
    for k, v in data.items():
        out[k] = v.isoformat() if hasattr(v, "isoformat") else v
    return out
