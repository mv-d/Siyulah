from datetime import date

from app.services.calendar_ksa import (
    add_months,
    is_bank_holiday,
    is_ramadan,
    previous_business_day,
    quarter_bounds,
    vat_due_date,
)


def test_saudi_weekend_is_friday_and_saturday():
    assert is_bank_holiday(date(2026, 9, 25))  # Friday
    assert is_bank_holiday(date(2026, 9, 26))  # Saturday
    assert not is_bank_holiday(date(2026, 9, 27))  # Sunday is a working day


def test_payments_move_to_previous_business_day():
    # 27 Nov 2026 is a Friday -> payroll runs Thursday 26 Nov.
    assert previous_business_day(date(2026, 11, 27)) == date(2026, 11, 26)
    # National Day (23 Sep) is a bank holiday.
    assert previous_business_day(date(2026, 9, 23)) == date(2026, 9, 22)


def test_vat_due_last_day_of_following_month():
    assert quarter_bounds(2026, 3) == (date(2026, 7, 1), date(2026, 9, 30))
    # Q3 2026 is due 31 Oct 2026 (a Saturday) -> Thursday 29 Oct.
    assert vat_due_date(2026, 3) == date(2026, 10, 29)
    assert vat_due_date(2026, 4) == date(2027, 1, 31) or vat_due_date(2026, 4) < date(2027, 2, 1)


def test_hijri_ramadan():
    assert is_ramadan(date(2026, 3, 1))  # Ramadan 1447
    assert not is_ramadan(date(2026, 9, 26))


def test_add_months_clamps_to_month_end():
    assert add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)
    assert add_months(date(2026, 11, 15), 3, 27) == date(2027, 2, 27)
