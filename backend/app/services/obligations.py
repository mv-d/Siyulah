"""Detect recurring major obligations from bank history.

Payroll (WPS), GOSI, rent (Ejar), financing installments and the next ZATCA VAT
payment are recognised from categorised transactions, so a newly connected
company gets its upcoming "big-ticket" outflows without any setup.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import date
from statistics import median

from .calendar_ksa import add_months, quarter_bounds, quarter_of, vat_due_date

VAT_RATE = 0.15
TAXABLE_CASH_SALES = ("sales_pos", "sales_online")


@dataclass
class DetectedObligation:
    kind: str
    name: str
    name_ar: str
    amount: float
    frequency: str
    next_due_date: date
    notes: str


def _nominal_day(dates: list[date]) -> int:
    # Payments move *earlier* around weekends, so the latest observed day is the nominal one.
    days = Counter(d.day for d in dates[-6:])
    return max(days) if days else 1


def _next_monthly(today: date, day: int) -> date:
    candidate = add_months(today.replace(day=1), 0, day)
    return candidate if candidate > today else add_months(today.replace(day=1), 1, day)


def _frequency_from_interval(days: float) -> tuple[str, int]:
    for name, months, center in (("monthly", 1, 30), ("quarterly", 3, 91), ("semiannual", 6, 182), ("annual", 12, 365)):
        if abs(days - center) <= center * 0.2:
            return name, months
    return "monthly", 1


def detect_obligations(
    txns: list[tuple[date, float, str]],
    today: date,
    invoices: list[tuple[str, date, float]] | None = None,
) -> list[DetectedObligation]:
    """``txns``: (date, signed amount, category). ``invoices``: (kind, issue_date, amount)."""
    by_cat: dict[str, list[tuple[date, float]]] = {}
    for d, amount, cat in sorted(txns):
        if d <= today:
            by_cat.setdefault(cat, []).append((d, amount))
    out: list[DetectedObligation] = []

    payroll = [(d, -a) for d, a in by_cat.get("payroll", []) if a < 0]
    if payroll and (today - payroll[-1][0]).days <= 45:
        day = _nominal_day([d for d, _ in payroll])
        out.append(
            DetectedObligation(
                "payroll",
                "Payroll (WPS)",
                "الرواتب (نظام حماية الأجور)",
                round(payroll[-1][1], 2),
                "monthly",
                _next_monthly(today, day),
                f"Detected from {len(payroll)} WPS salary transfers; paid around the {day}th.",
            )
        )

    gosi = [(d, -a) for d, a in by_cat.get("gosi", []) if a < 0]
    if gosi and (today - gosi[-1][0]).days <= 45:
        day = _nominal_day([d for d, _ in gosi])
        out.append(
            DetectedObligation(
                "gosi",
                "GOSI contributions",
                "اشتراكات التأمينات الاجتماعية",
                round(gosi[-1][1], 2),
                "monthly",
                _next_monthly(today, day),
                "Monthly social insurance contributions (due before the 15th).",
            )
        )

    rent = [(d, -a) for d, a in by_cat.get("rent", []) if a < 0]
    if rent:
        if len(rent) >= 2:
            freq, months = _frequency_from_interval((rent[-1][0] - rent[-2][0]).days)
        else:
            freq, months = "annual", 12
        nxt = add_months(rent[-1][0], months)
        while nxt <= today:
            nxt = add_months(nxt, months)
        out.append(
            DetectedObligation(
                "rent",
                "Rent (Ejar)",
                "الإيجار (منصة إيجار)",
                round(rent[-1][1], 2),
                freq,
                nxt,
                f"{freq.capitalize()} rent detected from Ejar payments.",
            )
        )

    loans = [(d, -a) for d, a in by_cat.get("loan", []) if a < 0]
    if len(loans) >= 2 and (today - loans[-1][0]).days <= 45:
        day = _nominal_day([d for d, _ in loans])
        out.append(
            DetectedObligation(
                "loan",
                "Financing installment",
                "قسط التمويل",
                round(median(a for _, a in loans[-3:]), 2),
                "monthly",
                _next_monthly(today, day),
                "Recurring financing installment.",
            )
        )

    vat = _estimate_vat(by_cat, today, invoices or [])
    if vat:
        out.append(vat)
    return out


def _estimate_vat(
    by_cat: dict[str, list[tuple[date, float]]], today: date, invoices: list[tuple[str, date, float]]
) -> DetectedObligation | None:
    y, q = quarter_of(today)
    py, pq = (y, q - 1) if q > 1 else (y - 1, 4)
    prev_due = vat_due_date(py, pq)
    prev_start, prev_end = quarter_bounds(py, pq)
    paid_prev = any(prev_end < d <= today for d, _ in by_cat.get("vat", []))
    if today <= prev_due and not paid_prev:
        year, quarter, due = py, pq, prev_due
    else:
        year, quarter, due = y, q, vat_due_date(y, q)
    start, end = quarter_bounds(year, quarter)
    upto = min(end, today)
    elapsed = (upto - start).days + 1
    total = (end - start).days + 1

    sales = sum(a for cat in TAXABLE_CASH_SALES for d, a in by_cat.get(cat, []) if start <= d <= upto and a > 0)
    if invoices:
        sales += sum(a for k, d, a in invoices if k == "receivable" and start <= d <= upto)
        purchases = sum(a for k, d, a in invoices if k == "payable" and start <= d <= upto)
    else:
        sales += sum(a for d, a in by_cat.get("receivable_payment", []) if start <= d <= upto and a > 0)
        purchases = sum(-a for d, a in by_cat.get("supplier_payment", []) if start <= d <= upto and a < 0)
    if elapsed <= 0:
        return None
    scale = total / elapsed
    net = (sales - purchases) * scale * VAT_RATE / (1 + VAT_RATE)
    if net <= 0:
        return None
    return DetectedObligation(
        "vat",
        f"ZATCA VAT — Q{quarter} {year}",
        f"ضريبة القيمة المضافة — الربع {quarter} {year}",
        round(net, 2),
        "once",
        due,
        "Estimated output VAT minus input VAT for the quarter"
        + ("" if elapsed == total else f" (extrapolated from {elapsed} of {total} days)")
        + ". Due by the last day of the following month.",
    )
