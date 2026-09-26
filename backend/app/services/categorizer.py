"""Rule-based categorisation of Saudi bank statement lines (English + Arabic)."""

from __future__ import annotations

import re

# (pattern, category, sign) — sign: +1 inflows only, -1 outflows only, 0 either.
RULES: list[tuple[re.Pattern[str], str, int]] = [
    # Transfers that quote an invoice/bill number settle receivables/payables,
    # whatever the counterparty's name looks like.
    (re.compile(r"TRANSFER FROM .*\bREF\b|حوالة واردة .*مرجع", re.I), "receivable_payment", 1),
    (re.compile(r"TRANSFER TO .*\bREF\b|حوالة صادرة .*مرجع", re.I), "supplier_payment", -1),
    (re.compile(r"\bWPS\b|SALAR|PAYROLL|MUDAD|رواتب|مساند", re.I), "payroll", -1),
    (re.compile(r"\bGOSI\b|التأمينات الاجتماعية", re.I), "gosi", -1),
    (re.compile(r"\bEJAR\b|\bRENT\b|إيجار|ايجار", re.I), "rent", -1),
    (re.compile(r"ZAKAT|زكاة", re.I), "zakat", -1),
    (re.compile(r"ZATCA|\bVAT\b|ضريبة القيمة المضافة|هيئة الزكاة والضريبة", re.I), "vat", -1),
    (re.compile(r"KAFALAH|LOAN|FINANCING INSTALLMENT|قسط|تمويل", re.I), "loan", 0),
    (re.compile(r"SUBSCRIPTION|WORKSPACE|ADOBE|FIGMA|اشتراك", re.I), "subscriptions", -1),
    (re.compile(r"MADA|POS SETTLEMENT|مدى|نقاط البيع", re.I), "sales_pos", 1),
    (re.compile(r"SALLA|\bZID\b|PAYOUT|سلة|زد", re.I), "sales_online", 1),
    (re.compile(r"\bSEC\b|ELECTRIC|\bNWC\b|WATER|كهرباء|المياه", re.I), "utilities", -1),
    (re.compile(r"\bSTC\b|MOBILY|\bZAIN\b|اتصالات|موبايلي", re.I), "telecom", -1),
    (re.compile(r"SNAP|TIKTOK|GOOGLE ADS|\bMETA\b|INFLUENCER|إعلان", re.I), "marketing", -1),
    (re.compile(r"SMSA|ARAMEX|NAQEL|\bSPL\b|SHIPPING|شحن", re.I), "logistics", -1),
    (re.compile(r"BANK CHARGE|\bFEES?\b|رسوم بنكية", re.I), "bank_fees", -1),
    (re.compile(r"DISTRIBUTION TO PARTNERS|OWNER DRAW|توزيع أرباح|مسحوبات", re.I), "owner_draw", -1),
    (re.compile(r"PROFIT DISTRIBUTION|MURABAHA|أرباح", re.I), "other_income", 1),
    (re.compile(r"OWN ACCOUNT|INTERNAL TRANSFER|تحويل داخلي", re.I), "transfer", 0),
    (re.compile(r"TRANSFER FROM|INCOMING|حوالة واردة", re.I), "receivable_payment", 1),
    (re.compile(r"TRANSFER TO|OUTGOING|حوالة صادرة", re.I), "supplier_payment", -1),
]

INFLOW_CATEGORIES = ("sales_pos", "sales_online", "receivable_payment", "other_income")
CATEGORY_LABELS = {
    "sales_pos": ("In-store sales (mada)", "مبيعات المتجر (مدى)"),
    "sales_online": ("Online store payouts", "تحويلات المتجر الإلكتروني"),
    "receivable_payment": ("Customer payments", "تحصيلات العملاء"),
    "other_income": ("Other income", "إيرادات أخرى"),
    "payroll": ("Payroll (WPS)", "الرواتب (حماية الأجور)"),
    "gosi": ("GOSI", "التأمينات الاجتماعية"),
    "rent": ("Rent (Ejar)", "الإيجار (إيجار)"),
    "vat": ("ZATCA VAT", "ضريبة القيمة المضافة"),
    "zakat": ("Zakat", "الزكاة"),
    "loan": ("Financing", "التمويل"),
    "supplier_payment": ("Supplier payments", "مدفوعات الموردين"),
    "utilities": ("Utilities", "الخدمات"),
    "telecom": ("Telecom", "الاتصالات"),
    "subscriptions": ("Software & subscriptions", "البرمجيات والاشتراكات"),
    "marketing": ("Marketing", "التسويق"),
    "logistics": ("Shipping & logistics", "الشحن والخدمات اللوجستية"),
    "bank_fees": ("Bank fees", "الرسوم البنكية"),
    "transfer": ("Internal transfer", "تحويل داخلي"),
    "owner_draw": ("Partner distributions", "توزيعات الشركاء"),
    "other_expense": ("Other expenses", "مصروفات أخرى"),
}


def categorize(description: str, amount: float) -> str:
    sign = 1 if amount >= 0 else -1
    for pattern, category, rule_sign in RULES:
        if rule_sign and rule_sign != sign:
            continue
        if pattern.search(description):
            return category
    return "other_income" if sign > 0 else "other_expense"
