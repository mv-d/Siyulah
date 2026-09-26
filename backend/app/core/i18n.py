"""Tiny server-side formatting helpers for bilingual (Arabic/English) messages."""

from __future__ import annotations

from datetime import date

MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"]


def sar_en(amount: float) -> str:
    return f"SAR {abs(amount):,.0f}" if amount >= 0 else f"-SAR {abs(amount):,.0f}"


LRI, PDI = "\u2066", "\u2069"  # bidi isolates keep "-1,200" intact inside Arabic text


def sar_ar(amount: float) -> str:
    sign = "-" if amount < 0 else ""
    return f"{LRI}{sign}{abs(amount):,.0f}{PDI} ر.س"


def date_en(d: date) -> str:
    return f"{d.day} {MONTHS_EN[d.month - 1]}"


def date_ar(d: date) -> str:
    return f"{d.day} {MONTHS_AR[d.month - 1]}"


def pct(x: float) -> str:
    return f"{x * 100:.0f}%"
