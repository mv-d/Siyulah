"""Demo companies.

* ``retail``: Nakhla Perfumes & Oud, a Riyadh perfume retailer selling in-store (mada) and on Salla.
* ``services``: Wamda Creative Agency, a Jeddah marketing agency with a heavy payroll and
  slow-paying B2B clients.

Both connect a bank and an accounting system through the full sandbox OAuth flow.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy.orm import Session

from ..core.config import today
from ..core.security import hash_password
from ..models import Company, Invoice, Obligation, Scenario, User, utcnow
from .alerts import ensure_rules, evaluate_alerts
from .calendar_ksa import add_months
from .connections import connect_directly

log = logging.getLogger("siyulah.seed")

DEMO_PASSWORD = "demo1234"
# Re-anchor the sandbox story when a demo gets older than this.
DEMO_MAX_AGE_DAYS = 7


@dataclass(frozen=True)
class Demo:
    email: str
    user_name: str
    name: str
    name_ar: str
    sector: str
    city: str
    cr_number: str
    vat_number: str
    buffer: float
    seed: int
    bank: tuple[str, str]
    accounting: str


DEMOS = {
    "retail": Demo(
        "demo@siyulah.sa", "Sara Al-Otaibi", "Nakhla Perfumes & Oud", "نخلة للعطور والعود", "retail", "Riyadh",
        "1010845521", "310845521700003", 50_000, 1, ("lean", "alrajhi"), "qoyod",
    ),
    "services": Demo(
        "agency@siyulah.sa", "Faisal Al-Harbi", "Wamda Creative Agency", "ومضة للإبداع والتسويق", "services", "Jeddah",
        "4030271986", "302719860500003", 150_000, 2, ("tarabut", "snb"), "zoho",
    ),
}
DEMO_EMAIL = DEMOS["retail"].email
DEMO_EMAILS = {d.email for d in DEMOS.values()}


def create_company_with_sandbox(db: Session, company: Company, bank: tuple[str, str] = ("lean", "alrajhi"), accounting: str = "qoyod") -> None:
    """Connect a bank (open banking) and an accounting system in the sandbox."""
    connect_directly(db, company, bank[0], bank[1])
    connect_directly(db, company, accounting)
    ensure_rules(db, company)
    evaluate_alerts(db, company)


def profile_for_email(email: str) -> str | None:
    return next((k for k, d in DEMOS.items() if d.email == email), None)


def seed_demo(db: Session, force: bool = False, profile: str = "retail") -> User:
    demo = DEMOS.get(profile, DEMOS["retail"])
    user = db.query(User).filter(User.email == demo.email).first()
    if user is not None:
        company = db.get(Company, user.company_id)
        stale = (today() - company.sandbox_anchor).days > DEMO_MAX_AGE_DAYS
        if not force and not stale:
            return user
        log.info("Re-seeding %s demo (stale=%s force=%s)", profile, stale, force)
        db.delete(company)
        db.commit()

    company = Company(
        name=demo.name,
        name_ar=demo.name_ar,
        sector=demo.sector,
        city=demo.city,
        cr_number=demo.cr_number,
        vat_number=demo.vat_number,
        min_cash_buffer=demo.buffer,
        alert_email=demo.email,
        alert_phone="+966500000000",
        sandbox_anchor=today(),
        sandbox_seed=demo.seed,
    )
    db.add(company)
    db.flush()
    user = User(
        company_id=company.id,
        email=demo.email,
        full_name=demo.user_name,
        password_hash=hash_password(DEMO_PASSWORD),
        locale="ar",
        pdpl_consent_at=utcnow(),
    )
    db.add(user)
    db.commit()
    create_company_with_sandbox(db, company, demo.bank, demo.accounting)
    db.add_all(_retail_scenarios(db, company) if demo.sector == "retail" else _agency_scenarios(db, company))
    db.commit()
    log.info("%s demo seeded (company id=%s)", profile, company.id)
    return user


def _largest_open(db: Session, company: Company, counterparty: str) -> Invoice | None:
    return (
        db.query(Invoice)
        .filter(Invoice.company_id == company.id, Invoice.status == "open", Invoice.counterparty == counterparty)
        .order_by(Invoice.amount.desc())
        .first()
    )


def _retail_scenarios(db: Session, company: Company) -> list[Scenario]:
    out = []
    ofoq = _largest_open(db, company, "Al-Ofoq Marketing Co.")
    if ofoq:
        out.append(
            Scenario(
                company_id=company.id,
                name="تأخر «الأفق» 15 يوماً · Al-Ofoq pays 15 days late",
                description=(
                    f"ماذا لو سُددت الفاتورة {ofoq.number} بقيمة {ofoq.amount:,.0f} ر.س متأخرة 15 يوماً؟ · "
                    f"What if the {ofoq.amount:,.0f} SAR invoice {ofoq.number} is paid 15 days late?"
                ),
                adjustments=[{"type": "delay_receivable", "invoice_id": ofoq.id, "days": 15, "label": ofoq.number}],
            )
        )
    vat = db.query(Obligation).filter(Obligation.company_id == company.id, Obligation.kind == "vat").first()
    if vat:
        out.append(
            Scenario(
                company_id=company.id,
                name="سداد الضريبة بعد أسبوع · Pay VAT a week later",
                description="ماذا لو سددنا ضريبة القيمة المضافة للربع بعد أسبوع؟ · What if we settle the quarterly ZATCA VAT one week later?",
                adjustments=[{"type": "shift_obligation", "obligation_id": vat.id, "days": 7, "label": vat.name}],
            )
        )
    wf_start = today().replace(month=11, day=20) if today().month <= 11 else today()
    out.append(
        Scenario(
            company_id=company.id,
            name="جمعة بيضاء أضعف (‎-25%) · Soft White Friday",
            description="اختبار ضغط: مبيعات الجمعة البيضاء أقل بـ 25% من نمط العام الماضي · Stress test: White Friday sales 25% below last year's pattern.",
            adjustments=[
                {
                    "type": "revenue_change",
                    "pct": -25,
                    "start_date": wf_start.isoformat(),
                    "end_date": (wf_start + timedelta(days=10)).isoformat(),
                }
            ],
        )
    )
    return out


def _agency_scenarios(db: Session, company: Company) -> list[Scenario]:
    out = []
    makkah = _largest_open(db, company, "Makkah Health Cluster")
    if makkah:
        out.append(
            Scenario(
                company_id=company.id,
                name="تأخر «تجمع مكة الصحي» 30 يوماً إضافية · Makkah Health Cluster 30 days later",
                description=(
                    f"ماذا لو تأخر سداد الفاتورة {makkah.number} ({makkah.amount:,.0f} ر.س) 30 يوماً إضافية؟ · "
                    f"What if {makkah.number} ({makkah.amount:,.0f} SAR) is paid another 30 days late?"
                ),
                adjustments=[{"type": "delay_receivable", "invoice_id": makkah.id, "days": 30, "label": makkah.number}],
            )
        )
    start = add_months(today().replace(day=1), 1, 1)
    # A new retainer is invoiced on the 1st, net 30, and usually settled about two weeks late.
    first_receipt = add_months(start, 1, 15)
    out.append(
        Scenario(
            company_id=company.id,
            name="توظيف مصمّمَين لعقد جديد · Hire 2 designers for a new retainer",
            description=(
                "توظيف مصمّمَين (26,000 ر.س شهرياً) من الشهر القادم لخدمة عقد شهري جديد بقيمة 34,500 ر.س يُحصّل بعد نحو 45 يوماً. · "
                "Hire two designers (SAR 26,000/month) from next month to serve a new SAR 34,500/month retainer that pays about 45 days later."
            ),
            adjustments=[
                {"type": "recurring", "start_date": start.isoformat(), "amount": -26_000, "frequency": "monthly", "label": "2 designers · مصممان"},
                {"type": "recurring", "start_date": first_receipt.isoformat(), "amount": 34_500, "frequency": "monthly", "label": "New retainer · عقد جديد"},
            ],
        )
    )
    return out
