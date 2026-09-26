"""Demo company: a Riyadh perfume & oud retailer selling in-store and on Salla."""

from __future__ import annotations

import logging
from datetime import timedelta

from sqlalchemy.orm import Session

from ..core.config import today
from ..core.security import hash_password
from ..models import Company, Scenario, User, utcnow
from .alerts import ensure_rules, evaluate_alerts
from .connections import connect_directly

log = logging.getLogger("siyulah.seed")

DEMO_EMAIL = "demo@siyulah.sa"
DEMO_PASSWORD = "demo1234"
# Re-anchor the sandbox story when the demo gets older than this.
DEMO_MAX_AGE_DAYS = 7


def create_company_with_sandbox(db: Session, company: Company) -> None:
    """Connect a bank (via Lean) and the accounting system (Qoyod) in the sandbox."""
    connect_directly(db, company, "lean", "alrajhi")
    connect_directly(db, company, "qoyod")
    ensure_rules(db, company)
    evaluate_alerts(db, company)


def seed_demo(db: Session, force: bool = False) -> User:
    user = db.query(User).filter(User.email == DEMO_EMAIL).first()
    if user is not None:
        company = db.get(Company, user.company_id)
        stale = (today() - company.sandbox_anchor).days > DEMO_MAX_AGE_DAYS
        if not force and not stale:
            return user
        log.info("Re-seeding demo company (stale=%s force=%s)", stale, force)
        db.delete(company)
        db.commit()

    company = Company(
        name="Nakhla Perfumes & Oud",
        name_ar="نخلة للعطور والعود",
        sector="retail",
        city="Riyadh",
        cr_number="1010845521",
        vat_number="310845521700003",
        min_cash_buffer=50_000,
        alert_email=DEMO_EMAIL,
        alert_phone="+966500000000",
        sandbox_anchor=today(),
        sandbox_seed=1,
    )
    db.add(company)
    db.flush()
    user = User(
        company_id=company.id,
        email=DEMO_EMAIL,
        full_name="Sara Al-Otaibi",
        password_hash=hash_password(DEMO_PASSWORD),
        locale="ar",
        pdpl_consent_at=utcnow(),
    )
    db.add(user)
    db.commit()
    create_company_with_sandbox(db, company)

    from ..models import Invoice, Obligation

    ofoq = (
        db.query(Invoice)
        .filter(Invoice.company_id == company.id, Invoice.status == "open", Invoice.counterparty == "Al-Ofoq Marketing Co.")
        .order_by(Invoice.amount.desc())
        .first()
    )
    vat = db.query(Obligation).filter(Obligation.company_id == company.id, Obligation.kind == "vat").first()
    scenarios = []
    if ofoq:
        scenarios.append(
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
    if vat:
        scenarios.append(
            Scenario(
                company_id=company.id,
                name="سداد الضريبة بعد أسبوع · Pay VAT a week later",
                description="ماذا لو سددنا ضريبة القيمة المضافة للربع بعد أسبوع؟ · What if we settle the quarterly ZATCA VAT one week later?",
                adjustments=[{"type": "shift_obligation", "obligation_id": vat.id, "days": 7, "label": vat.name}],
            )
        )
    wf_start = today().replace(month=11, day=20) if today().month <= 11 else today()
    scenarios.append(
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
    db.add_all(scenarios)
    db.commit()
    log.info("Demo company seeded (id=%s)", company.id)
    return user
