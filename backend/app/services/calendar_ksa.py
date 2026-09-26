"""Saudi business calendar: Fri/Sat weekend, Hijri seasons, paydays and holidays.

These helpers feed both the forecasting model (as seasonal features) and the
scheduling of obligations (payments due on a bank holiday move earlier).
"""

from __future__ import annotations

from datetime import date, timedelta
from functools import lru_cache

from hijridate import Gregorian

# Python weekday(): Monday=0 ... Friday=4, Saturday=5
WEEKEND = frozenset({4, 5})


@lru_cache(maxsize=8192)
def hijri(d: date) -> tuple[int, int, int]:
    h = Gregorian(d.year, d.month, d.day).to_hijri()
    return h.year, h.month, h.day


def is_ramadan(d: date) -> bool:
    return hijri(d)[1] == 9


def is_last_ten_ramadan(d: date) -> bool:
    _, m, day = hijri(d)
    return m == 9 and day >= 20


def is_eid(d: date) -> bool:
    _, m, day = hijri(d)
    return (m == 10 and day <= 4) or (m == 12 and 10 <= day <= 13)


def is_pre_eid_adha(d: date) -> bool:
    _, m, day = hijri(d)
    return m == 12 and 1 <= day <= 9


def is_national_day_season(d: date) -> bool:
    # Saudi National Day (23 Sep) — retail promotions run the week around it.
    return d.month == 9 and 18 <= d.day <= 24


def is_founding_day_season(d: date) -> bool:
    return d.month == 2 and 19 <= d.day <= 23


def is_white_friday_season(d: date) -> bool:
    # "White Friday" is the regional Black Friday campaign (late November).
    return d.month == 11 and d.day >= 20


def is_payday_window(d: date) -> bool:
    # Government salaries land on the 27th; spending stays elevated into early month.
    return d.day >= 27 or d.day <= 3


def is_bank_holiday(d: date) -> bool:
    if d.weekday() in WEEKEND:
        return True
    _, m, day = hijri(d)
    if (m == 10 and day <= 3) or (m == 12 and 9 <= day <= 12):
        return True
    return (d.month, d.day) in {(9, 23), (2, 22)}


def previous_business_day(d: date) -> date:
    while is_bank_holiday(d):
        d -= timedelta(days=1)
    return d


def next_business_day(d: date) -> date:
    while is_bank_holiday(d):
        d += timedelta(days=1)
    return d


def month_day(year: int, month: int, day: int) -> date:
    """date(year, month, day) clamped to the month's last day."""
    import calendar

    last = calendar.monthrange(year, month)[1]
    return date(year, month, min(day, last))


def add_months(d: date, months: int, day: int | None = None) -> date:
    total = d.month - 1 + months
    y, m = d.year + total // 12, total % 12 + 1
    return month_day(y, m, day if day is not None else d.day)


def quarter_of(d: date) -> tuple[int, int]:
    return d.year, (d.month - 1) // 3 + 1


def quarter_bounds(year: int, q: int) -> tuple[date, date]:
    start = date(year, 3 * (q - 1) + 1, 1)
    end = add_months(start, 3) - timedelta(days=1)
    return start, end


def vat_due_date(year: int, q: int) -> date:
    """ZATCA quarterly VAT return + payment is due by the last day of the next month."""
    _, q_end = quarter_bounds(year, q)
    first_next = q_end + timedelta(days=1)
    due = add_months(first_next, 1) - timedelta(days=1)
    return previous_business_day(due)


FEATURE_NAMES = [
    "trend",
    "sun",
    "mon",
    "tue",
    "wed",
    "thu",
    "fri",
    "payday",
    "month_start",
    "ramadan",
    "last_ten_ramadan",
    "eid",
    "pre_eid_adha",
    "national_day",
    "founding_day",
    "white_friday",
]


def day_features(d: date) -> list[float]:
    """Calendar features for day ``d`` (without trend/intercept). Saturday is the base day."""
    wd = d.weekday()
    dow = [
        1.0 if wd == 6 else 0.0,  # Sunday
        1.0 if wd == 0 else 0.0,
        1.0 if wd == 1 else 0.0,
        1.0 if wd == 2 else 0.0,
        1.0 if wd == 3 else 0.0,  # Thursday
        1.0 if wd == 4 else 0.0,  # Friday
    ]
    return dow + [
        1.0 if is_payday_window(d) else 0.0,
        1.0 if 4 <= d.day <= 8 else 0.0,
        1.0 if is_ramadan(d) else 0.0,
        1.0 if is_last_ten_ramadan(d) else 0.0,
        1.0 if is_eid(d) else 0.0,
        1.0 if is_pre_eid_adha(d) else 0.0,
        1.0 if is_national_day_season(d) else 0.0,
        1.0 if is_founding_day_season(d) else 0.0,
        1.0 if is_white_friday_season(d) else 0.0,
    ]
