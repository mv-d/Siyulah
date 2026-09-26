"""Integration catalogue and the provider client interface.

Every provider speaks OAuth 2.0 (authorization code + PKCE). In this MVP all
providers run against the built-in sandbox (see ``sandbox.py``); swapping in a
live client means implementing ``ProviderClient`` against the vendor's API
(Lean / Tarabut for SAMA open banking, Xero / QuickBooks / Zoho / Daftra /
Qoyod for accounting) — the sync pipeline, forecasting and alerts are unchanged.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Protocol


@dataclass(frozen=True)
class ProviderInfo:
    key: str
    kind: str  # bank | accounting | commerce | government
    name: str
    name_ar: str
    description: str
    description_ar: str
    scopes: tuple[str, ...] = ()
    status: str = "available"  # available | coming_soon
    needs_institution: bool = False
    color: str = "#0f5e4d"
    tags: tuple[str, ...] = field(default_factory=tuple)


PROVIDERS: dict[str, ProviderInfo] = {
    p.key: p
    for p in (
        ProviderInfo(
            "lean", "bank", "Lean Technologies", "لين تكنولوجيز",
            "SAMA-licensed open banking gateway. Read-only access to balances and 12 months of transactions.",
            "بوابة مصرفية مفتوحة مرخّصة من ساما. وصول للقراءة فقط إلى الأرصدة وحركات ١٢ شهراً.",
            ("accounts:read", "balances:read", "transactions:read"), needs_institution=True, color="#1b3a8a",
            tags=("SAMA Open Banking", "Read-only"),
        ),
        ProviderInfo(
            "tarabut", "bank", "Tarabut", "ترابط",
            "Open banking platform connected to Saudi banks under the SAMA framework.",
            "منصة مصرفية مفتوحة متصلة بالبنوك السعودية وفق إطار ساما.",
            ("accounts:read", "balances:read", "transactions:read"), needs_institution=True, color="#0b6b5f",
            tags=("SAMA Open Banking", "Read-only"),
        ),
        ProviderInfo(
            "qoyod", "accounting", "Qoyod", "قيود",
            "Saudi cloud accounting, ZATCA-approved e-invoicing. Syncs invoices and bills.",
            "برنامج محاسبة سحابي سعودي معتمد للفوترة الإلكترونية. مزامنة الفواتير والمشتريات.",
            ("invoices:read", "bills:read", "contacts:read"), color="#0e7c86", tags=("Local", "ZATCA ready"),
        ),
        ProviderInfo(
            "daftra", "accounting", "Daftra", "دفترة",
            "Arabic-first ERP and accounting for SMEs across the Gulf.",
            "نظام محاسبة وإدارة موارد عربي للمنشآت الصغيرة والمتوسطة في الخليج.",
            ("invoices:read", "bills:read"), color="#2463eb", tags=("Local",),
        ),
        ProviderInfo(
            "xero", "accounting", "Xero", "زيرو",
            "Global cloud accounting. Syncs receivables, payables and contacts.",
            "برنامج محاسبة سحابي عالمي. مزامنة الذمم المدينة والدائنة وجهات الاتصال.",
            ("accounting.transactions.read", "accounting.contacts.read"), color="#13b5ea",
        ),
        ProviderInfo(
            "quickbooks", "accounting", "QuickBooks Online", "كويك بوكس",
            "Intuit's cloud accounting for small businesses.",
            "برنامج إنتويت للمحاسبة السحابية للمنشآت الصغيرة.",
            ("com.intuit.quickbooks.accounting",), color="#2ca01c",
        ),
        ProviderInfo(
            "zoho", "accounting", "Zoho Books", "زوهو بوكس",
            "Zoho's accounting suite, popular with Gulf service businesses.",
            "حزمة زوهو المحاسبية، شائعة لدى شركات الخدمات في الخليج.",
            ("ZohoBooks.invoices.READ", "ZohoBooks.bills.READ"), color="#e42527",
        ),
        ProviderInfo(
            "salla", "commerce", "Salla", "سلة",
            "Pending payouts from your Salla store as known future inflows.",
            "التحويلات المعلّقة من متجرك في سلة كتدفقات مستقبلية مؤكدة.",
            status="coming_soon", color="#004d5a",
        ),
        ProviderInfo(
            "zid", "commerce", "Zid", "زد",
            "Order settlements from your Zid store.",
            "تسويات الطلبات من متجرك في زد.",
            status="coming_soon", color="#7b3fe4",
        ),
        ProviderInfo(
            "zatca", "government", "ZATCA Fatoora", "فاتورة (هيئة الزكاة والضريبة والجمارك)",
            "E-invoicing data (issued and received invoices) to sharpen predictions.",
            "بيانات الفوترة الإلكترونية (الصادرة والواردة) لتحسين دقة التوقعات.",
            status="coming_soon", color="#00733c",
        ),
    )
}


@dataclass
class TokenSet:
    access_token: str
    refresh_token: str
    expires_in: int
    scope: str


@dataclass
class RemoteAccount:
    external_id: str
    bank_code: str
    name: str
    iban: str
    currency: str
    balance: float


@dataclass
class RemoteTransaction:
    external_id: str
    date: date
    amount: float
    description: str
    counterparty: str | None


@dataclass
class RemoteInvoice:
    external_id: str
    kind: str
    number: str
    counterparty: str
    counterparty_ar: str | None
    issue_date: date
    due_date: date
    amount: float
    vat_amount: float
    amount_paid: float
    status: str
    paid_date: date | None
    zatca_uuid: str | None
    category: str | None


class ProviderClient(Protocol):
    def authorize_url(self, *, state: str, code_challenge: str, redirect_uri: str, institution: str | None) -> str: ...

    def exchange_code(self, *, code: str, code_verifier: str, redirect_uri: str) -> TokenSet: ...

    def refresh(self, refresh_token: str) -> TokenSet: ...

    def accounts(self, access_token: str) -> list[RemoteAccount]: ...

    def transactions(self, access_token: str, account_id: str, since: date, until: date) -> list[RemoteTransaction]: ...

    def invoices(self, access_token: str) -> list[RemoteInvoice]: ...
