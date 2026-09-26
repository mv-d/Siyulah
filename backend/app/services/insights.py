"""Plain-language insights and suggested actions (Arabic + English).

Suggestions are not generic tips: each one is a concrete scenario that has been
run through the forecasting engine, so its impact on the lowest balance and the
shortfall probability is measured, and the UI can open it in the scenario planner.
"""

from __future__ import annotations

import math
from datetime import date, timedelta

from ..core.i18n import date_ar, date_en, pct, sar_ar, sar_en
from .forecasting import Baseline, ForecastInputs, run_forecast

# Walk-in and online sales; B2B collections are too lumpy for a 30-day momentum read.
SALES_CATEGORIES = ("sales_pos", "sales_online")

DRIVER_LABELS = {
    "ramadan": ("Ramadan", "رمضان"),
    "last_ten_ramadan": ("the last ten nights of Ramadan", "العشر الأواخر من رمضان"),
    "white_friday": ("White Friday", "الجمعة البيضاء"),
    "national_day": ("National Day week", "أسبوع اليوم الوطني"),
    "payday": ("salary week (27th)", "أسبوع الرواتب (يوم 27)"),
    "pre_eid_adha": ("the days before Eid al-Adha", "الأيام التي تسبق عيد الأضحى"),
    "founding_day": ("Founding Day", "يوم التأسيس"),
}


def _insight(kind: str, severity: str, en: str, ar: str, **data) -> dict:
    return {"kind": kind, "severity": severity, "text_en": en, "text_ar": ar, "data": data}


def build_insights(inputs: ForecastInputs, result: dict) -> list[dict]:
    m = result["metrics"]
    out: list[dict] = []
    today = inputs.today
    buffer = inputs.safety_buffer

    lowest_date: date = m["lowest_date"]
    window = [s for s in result["series"] if lowest_date - timedelta(days=10) <= s["date"] <= lowest_date]
    drivers = sorted((e for s in window for e in s["events"] if e["amount"] < 0), key=lambda e: e["amount"])[:3]
    if m["lowest_balance"] < buffer or m["shortfall_probability"] > 0.05:
        names_en = ", ".join(f"{e['label_en']} ({sar_en(-e['amount'])})" for e in drivers)
        names_ar = "، ".join(f"{e['label_ar']} ({sar_ar(-e['amount'])})" for e in drivers)
        sev = "critical" if m["lowest_balance"] < 0 else "serious"
        out.append(
            _insight(
                "low_point",
                sev,
                f"Cash is projected to bottom out at {sar_en(m['lowest_balance'])} on {date_en(lowest_date)}"
                + (f", driven by {names_en}." if drivers else "."),
                f"من المتوقع أن ينخفض الرصيد إلى {sar_ar(m['lowest_balance'])} في {date_ar(lowest_date)}"
                + (f" بسبب {names_ar}." if drivers else "."),
                date=lowest_date,
            )
        )
    if m["shortfall_probability"] >= 0.05:
        out.append(
            _insight(
                "shortfall",
                "critical" if m["shortfall_probability"] >= 0.5 else "serious",
                f"{pct(m['shortfall_probability'])} chance the balance goes negative within {m['horizon']} days"
                + (f" — earliest risk around {date_en(m['risk_date'])}." if m["risk_date"] else "."),
                f"احتمال {pct(m['shortfall_probability'])} أن يصبح الرصيد سالباً خلال {m['horizon']} يوماً"
                + (f" — أقرب خطر حوالي {date_ar(m['risk_date'])}." if m["risk_date"] else "."),
            )
        )
    elif m["lowest_balance"] >= buffer:
        out.append(
            _insight(
                "healthy",
                "good",
                f"Cash stays above your {sar_en(buffer)} safety buffer for the next {m['horizon']} days (lowest {sar_en(m['lowest_balance'])}).",
                f"يبقى الرصيد أعلى من حد الأمان {sar_ar(buffer)} خلال {m['horizon']} يوماً القادمة (الأدنى {sar_ar(m['lowest_balance'])}).",
            )
        )

    overdue = [r for r in inputs.receivables if r.due_date < today]
    if overdue:
        total = sum(r.outstanding for r in overdue)
        slow = max(overdue, key=lambda r: (sum(r.delays) / len(r.delays)) if r.delays else 0)
        avg = round(sum(slow.delays) / len(slow.delays)) if slow.delays else None
        en = f"{len(overdue)} customer invoices worth {sar_en(total)} are overdue."
        ar = f"{len(overdue)} فواتير عملاء بقيمة {sar_ar(total)} متأخرة السداد."
        if avg and avg > 5:
            en += f" {slow.counterparty} typically pays {avg} days after the due date."
            ar += f" {slow.counterparty_ar or slow.counterparty} يسدد عادةً بعد {avg} يوماً من تاريخ الاستحقاق."
        out.append(_insight("overdue", "warning", en, ar, total=total, count=len(overdue)))

    # Sales momentum: last 30 days vs the 30 before.
    recent = sum(a for d, a, c in inputs.history if c in SALES_CATEGORIES and today - timedelta(days=30) < d <= today)
    prior = sum(a for d, a, c in inputs.history if c in SALES_CATEGORIES and today - timedelta(days=60) < d <= today - timedelta(days=30))
    if prior > 0 and recent > 0:
        change = recent / prior - 1
        if abs(change) >= 0.03:
            up = change > 0
            out.append(
                _insight(
                    "momentum",
                    "good" if up else "warning",
                    f"Store and online sales are {'up' if up else 'down'} {pct(abs(change))} over the last 30 days ({sar_en(recent)}).",
                    f"مبيعات المتجر والمتجر الإلكتروني {'ارتفعت' if up else 'انخفضت'} بنسبة {pct(abs(change))} خلال آخر 30 يوماً ({sar_ar(recent)}).",
                    change=change,
                )
            )

    # Seasonal effect the model learned that falls inside the horizon.
    drivers_learned = result["model"].get("sales_drivers") or {}
    end = today + timedelta(days=m["horizon"])
    from .calendar_ksa import is_last_ten_ramadan, is_national_day_season, is_ramadan, is_white_friday_season

    upcoming = {
        "white_friday": any(is_white_friday_season(today + timedelta(days=i)) for i in range(1, m["horizon"] + 1)),
        "ramadan": any(is_ramadan(today + timedelta(days=i)) for i in range(1, m["horizon"] + 1, 3)),
        "last_ten_ramadan": any(is_last_ten_ramadan(today + timedelta(days=i)) for i in range(1, m["horizon"] + 1, 2)),
        "national_day": any(is_national_day_season(today + timedelta(days=i)) for i in range(1, m["horizon"] + 1)),
    }
    for key, effect in sorted(drivers_learned.items(), key=lambda kv: -abs(kv[1])):
        if upcoming.get(key) and effect >= 0.1 and key in DRIVER_LABELS:
            en_l, ar_l = DRIVER_LABELS[key]
            out.append(
                _insight(
                    "seasonality",
                    "info",
                    f"Learned from last year: {en_l} lifts your daily sales by about {pct(effect)} — it's in this forecast window (before {date_en(end)}).",
                    f"تعلّم النموذج من العام الماضي: {ar_l} يرفع مبيعاتك اليومية بنحو {pct(effect)} — وهو ضمن فترة هذا التوقع.",
                    effect=effect,
                )
            )
            break

    big = sorted(
        (e for s in result["series"][:21] for e in s["events"] if e["kind"] in ("vat", "payroll", "rent", "zakat", "loan")),
        key=lambda e: e["date"],
    )
    if big:
        e = big[0]
        out.append(
            _insight(
                "upcoming",
                "info",
                f"Next major payment: {e['label_en']} — {sar_en(-e['amount'])} on {date_en(e['date'])}.",
                f"الدفعة الكبيرة القادمة: {e['label_ar']} — {sar_ar(-e['amount'])} في {date_ar(e['date'])}.",
                date=e["date"],
            )
        )
    return out


def suggest_actions(inputs: ForecastInputs, result: dict, baseline: Baseline, horizon: int) -> list[dict]:
    """Try concrete levers through the engine and keep the ones that measurably help."""
    m = result["metrics"]
    buffer = inputs.safety_buffer
    if m["lowest_balance"] >= buffer and m["shortfall_probability"] < 0.05:
        return []
    today = inputs.today
    low = m["lowest_date"]
    candidates: list[tuple[dict, str, str, list[dict]]] = []

    for p in sorted(inputs.payables, key=lambda p: -p.outstanding)[:5]:
        pay = p.expected_date or p.due_date
        if p.outstanding >= 10_000 and today < pay <= low:
            days = min(30, max(14, (low - pay).days + 7))
            candidates.append(
                (
                    {"type": "shift_payable", "invoice_id": p.id, "days": days},
                    f"Ask {p.counterparty} to move {p.number} ({sar_en(p.outstanding)}) by {days} days",
                    f"اطلب من {p.counterparty_ar or p.counterparty} تأجيل {p.number} ({sar_ar(p.outstanding)}) {days} يوماً",
                    [{"type": "shift_payable", "invoice_id": p.id, "days": days, "label": p.number}],
                )
            )

    overdue = sorted((r for r in inputs.receivables if r.due_date < today), key=lambda r: -r.outstanding)
    if overdue:
        top = overdue[:3]
        target = today + timedelta(days=7)
        adjs = [{"type": "expect_receivable", "invoice_id": r.id, "date": target.isoformat(), "label": r.number} for r in top]
        total = sum(r.outstanding for r in top)
        candidates.append(
            (
                adjs[0],
                f"Collect the {len(top)} largest overdue invoices ({sar_en(total)}) within 7 days",
                f"حصّل أكبر {len(top)} فواتير متأخرة ({sar_ar(total)}) خلال 7 أيام",
                adjs,
            )
        )

    gap = buffer - m["lowest_p10"]
    if m["shortfall_probability"] >= 0.15 and gap > 0:
        amount = int(math.ceil(gap / 25_000) * 25_000)
        draw = today + timedelta(days=7)
        adjs = [{"type": "loan", "date": draw.isoformat(), "amount": amount, "months": 12, "rate_pct": 7.5, "label": "Working-capital facility"}]
        candidates.append(
            (
                adjs[0],
                f"Arrange a {sar_en(amount)} working-capital facility (e.g. Kafalah-guaranteed), 12 months",
                f"رتّب تمويل رأس مال عامل بقيمة {sar_ar(amount)} (مثلاً بضمان برنامج كفالة) لمدة 12 شهراً",
                adjs,
            )
        )

    suggestions = []
    for _, en, ar, adjs in candidates:
        # Same simulation count and seed as the baseline run, so the difference is the lever alone.
        r = run_forecast(inputs, horizon, adjs, n_sims=result["model"]["simulations"], baseline=baseline)
        sm = r["metrics"]
        gain = sm["lowest_balance"] - m["lowest_balance"]
        risk_drop = m["shortfall_probability"] - sm["shortfall_probability"]
        # Keep levers that help and never raise the risk of going negative.
        if risk_drop >= 0 and (gain > 1_000 or risk_drop > 0.02):
            suggestions.append(
                {
                    "kind": adjs[0]["type"],
                    "priority": 1 if adjs[0]["type"] == "loan" else 0,
                    "title_en": en,
                    "title_ar": ar,
                    "adjustments": adjs,
                    "impact": {
                        "lowest_balance": sm["lowest_balance"],
                        "lowest_balance_change": round(gain, 2),
                        "shortfall_probability": sm["shortfall_probability"],
                        "shortfall_change": round(-risk_drop, 3),
                    },
                }
            )
    # Operational levers (collect, renegotiate) before financing; then by impact.
    suggestions.sort(key=lambda s: (s["priority"], s["impact"]["shortfall_probability"], -s["impact"]["lowest_balance_change"]))
    # One ask per supplier is enough.
    seen: set[str] = set()
    unique = []
    for s in suggestions:
        key = s["title_en"].split(" to move ")[0] if s["kind"] == "shift_payable" else s["kind"]
        if key not in seen:
            seen.add(key)
            unique.append(s)
    return unique[:3]
