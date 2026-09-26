import pytest

from app.services.categorizer import categorize


@pytest.mark.parametrize(
    "desc,amount,expected",
    [
        ("MADA POS SETTLEMENT T4501", 5000, "sales_pos"),
        ("SALLA PAYOUT #3988", 8000, "sales_online"),
        ("SALLA PLATFORM SUBSCRIPTION", -499, "subscriptions"),
        ("WPS SALARY TRANSFER SEP 2026", -114800, "payroll"),
        ("GOSI MONTHLY CONTRIBUTION", -10000, "gosi"),
        ("EJAR RENT PAYMENT - SHOWROOM", -126000, "rent"),
        ("SADAD ZATCA VAT Q3-2026", -70000, "vat"),
        ("TRANSFER FROM AL-OFOQ MARKETING CO. REF INV-2026-1001", 52900, "receivable_payment"),
        ("TRANSFER TO SNAP MEDIA BUYING REF BILL-2026-5001", -20000, "supplier_payment"),
        ("SNAP ADS", -1600, "marketing"),
        ("سداد فاتورة كهرباء", -3000, "utilities"),
        ("رواتب شهر سبتمبر", -90000, "payroll"),
        ("PROFIT DISTRIBUTION TO PARTNERS", -50000, "owner_draw"),
        ("MURABAHA DEPOSIT PROFIT DISTRIBUTION", 280, "other_income"),
        ("SOMETHING UNKNOWN", -10, "other_expense"),
    ],
)
def test_categorize(desc, amount, expected):
    assert categorize(desc, amount) == expected
