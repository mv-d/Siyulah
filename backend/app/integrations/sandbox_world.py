"""A deterministic simulation of a Saudi SME's finances.

The sandbox Open Banking (Lean / Tarabut) and accounting (Xero, Qoyod, ...)
providers expose different *views* of the same simulated company, so bank
transactions and accounting invoices always reconcile — exactly like a real
company connecting both systems.

Every value is a pure function of ``(seed, date)``, and balances are anchored
to the day the company joined (``anchor``), so re-syncing tomorrow adds
tomorrow's transactions without rewriting history.
"""

from __future__ import annotations

import hashlib
import math
import uuid
import zlib
from dataclasses import dataclass, field
from datetime import date, timedelta
from functools import cached_property

import numpy as np

from ..services.calendar_ksa import (
    is_eid,
    is_founding_day_season,
    is_last_ten_ramadan,
    is_national_day_season,
    is_payday_window,
    is_pre_eid_adha,
    is_ramadan,
    is_white_friday_season,
    next_business_day,
    previous_business_day,
    quarter_bounds,
    quarter_of,
    vat_due_date,
    add_months,
)

HISTORY_DAYS = 365
VAT_RATE = 0.15


@dataclass(frozen=True)
class Party:
    key: str
    name_en: str
    name_ar: str
    typical_amount: float
    weight: float = 1.0
    delays: tuple[int, ...] = (0,)
    terms: int = 30
    category: str | None = None


@dataclass
class WorldTxn:
    external_id: str
    date: date
    amount: float
    description: str
    counterparty: str | None
    true_category: str
    account: str = "operating"


@dataclass
class WorldInvoice:
    external_id: str
    kind: str  # receivable | payable
    number: str
    party: Party
    issue_date: date
    due_date: date
    amount: float
    vat_amount: float
    paid_date: date | None
    zatca_uuid: str
    category: str | None = None


@dataclass
class Profile:
    key: str
    company_en: str
    company_ar: str
    city: str
    # The opening balance is calibrated so the company's true cash low over the
    # next 90 days lands near this value: every sandbox company starts in a
    # realistic "tight month", whatever day it joins.
    future_low_target: float
    min_anchor_balance: float
    pos_base: float = 0.0
    online_base: float = 0.0
    daily_opex: float = 0.0
    growth: float = 0.10
    payroll_steps: tuple[tuple[int, float], ...] = ()  # (days relative to anchor, monthly payroll)
    gosi_rate: float = 0.09
    rent_amount: float = 0.0
    rent_offset: int = 38  # next rent payment = anchor + offset
    customers: tuple[Party, ...] = ()
    suppliers: tuple[Party, ...] = ()
    invoice_prob: float = 0.0
    bill_prob: float = 0.0
    retainers: tuple[Party, ...] = ()
    fixed_monthly: tuple[tuple[int, str, str, float, str], ...] = ()  # (day, desc, counterparty, amount, category)
    story_invoices: tuple[tuple[str, int, int, float, int | None], ...] = ()  # (party, issued, due, amount, paid rel. anchor)
    story_bills: tuple[tuple[str, int, int, float], ...] = ()
    seasonal: dict = field(default_factory=dict)


RETAIL = Profile(
    key="retail",
    company_en="Nakhla Perfumes & Oud",
    company_ar="نخلة للعطور والعود",
    city="Riyadh",
    future_low_target=-12_000,
    min_anchor_balance=60_000,
    pos_base=5_300,
    online_base=2_450,
    daily_opex=420,
    growth=0.12,
    payroll_steps=((-400, 101_500), (-210, 108_200), (-95, 114_800)),
    gosi_rate=0.095,
    rent_amount=126_000,
    rent_offset=45,
    customers=(
        Party("oasis", "Golden Oasis Hotels", "فنادق الواحة الذهبية", 17_500, 3, (12, 18, 20, 25, 15, 22, 19)),
        Party("ofoq", "Al-Ofoq Marketing Co.", "شركة الأفق للتسويق", 21_000, 2, (2, 5, 0, 7, 4, 3, 1)),
        Party("rayyan", "Al-Rayyan Holding Group", "مجموعة الريان القابضة", 28_000, 2, (35, 42, 50, 38, 45, 40)),
        Party("diyafa", "Diyafa Events", "ضيافة للفعاليات", 11_500, 2, (0, -2, 1, 0, 3, 0)),
        Party("najd", "Najd Corporate Gifts", "نجد للهدايا الترويجية", 8_800, 1, (8, 10, 14, 6, 9)),
    ),
    suppliers=(
        Party("oud", "Arabian Oud Supplies", "توريدات العود العربي", 31_000, 3, terms=45, category="inventory"),
        Party("glass", "Gulf Glass & Packaging", "الخليج للزجاج والتغليف", 10_200, 2, terms=30, category="packaging"),
        Party("taif", "Taif Rose Distillery", "معمل ورد الطائف", 16_000, 2, terms=30, category="inventory"),
        Party("majd", "Al-Majd Printing", "مطابع المجد", 4_500, 1, terms=30, category="marketing"),
    ),
    invoice_prob=0.21,
    bill_prob=0.30,
    fixed_monthly=(
        (1, "SALLA PLATFORM SUBSCRIPTION", "Salla", -499, "subscriptions"),
        (1, "QOYOD SUBSCRIPTION", "Qoyod", -249, "subscriptions"),
        (3, "GOOGLE WORKSPACE", "Google", -312, "subscriptions"),
        (5, "STC BUSINESS BILL", "STC", -1_180, "telecom"),
        (10, "SADAD SEC ELECTRICITY", "Saudi Electricity Co.", -3_100, "utilities"),
        (11, "SADAD NWC WATER", "National Water Co.", -420, "utilities"),
        (28, "BANK CHARGES", None, -365, "bank_fees"),
    ),
    story_invoices=(
        ("ofoq", -5, 40, 52_900, 44),
        ("rayyan", -75, -45, 38_640, 26),
        ("rayyan", -50, -20, 24_150, 41),
        ("oasis", -40, -10, 31_050, 9),
        ("diyafa", -12, 18, 16_675, 18),
    ),
    story_bills=(
        ("oud", -20, 38, 98350),
        ("taif", -21, 9, 23_460),
        ("glass", -8, 22, 12_650),
    ),
    seasonal={
        "ramadan": 1.45,
        "last_ten": 1.35,
        "pre_eid_adha": 1.25,
        "eid": 0.80,
        "national_day": 1.35,
        "founding_day": 1.15,
        "white_friday_pos": 1.30,
        "white_friday_online": 2.40,
        "payday": 1.15,
    },
)

SERVICES = Profile(
    key="services",
    company_en="Wamda Creative Agency",
    company_ar="ومضة للإبداع والتسويق",
    city="Jeddah",
    future_low_target=70_000,
    min_anchor_balance=150_000,
    daily_opex=780,
    growth=0.15,
    payroll_steps=((-400, 232_000), (-230, 247_500), (-70, 262_400)),
    gosi_rate=0.09,
    rent_amount=90_000,
    rent_offset=52,
    retainers=(
        Party("redsea", "Red Sea Ventures", "مشاريع البحر الأحمر", 57_500, 1, (20, 25, 30, 28, 24)),
        Party("hejaz", "Hejaz Real Estate", "الحجاز العقارية", 40_250, 1, (5, 7, 10, 3, 6)),
        Party("makkah", "Makkah Health Cluster", "تجمع مكة الصحي", 74_750, 1, (45, 60, 55, 70, 50)),
        Party("tamkeen", "Tamkeen Fintech", "تمكين للتقنية المالية", 34_500, 1, (0, 2, 1, 4, 0)),
        Party("balad", "Al-Balad Cafés", "مقاهي البلد", 18_400, 1, (10, 14, 8, 12, 11)),
        Party("nahdi", "Nakheel Pharmacies", "صيدليات النخيل", 29_900, 1, (3, 5, 2, 8, 4)),
    ),
    customers=(
        Party("season", "Jeddah Season Events", "فعاليات موسم جدة", 68_000, 2, (30, 40, 35, 28)),
        Party("tamkeen", "Tamkeen Fintech", "تمكين للتقنية المالية", 22_000, 1, (0, 2, 1, 4, 0)),
        Party("redsea", "Red Sea Ventures", "مشاريع البحر الأحمر", 35_000, 1, (20, 25, 30, 28, 24)),
    ),
    suppliers=(
        Party("media", "Snap Media Buying", "سناب لشراء الإعلانات", 21_000, 3, terms=15, category="media"),
        Party("studio", "Lens Production Studio", "استوديو لنس للإنتاج", 16_500, 2, terms=30, category="production"),
        Party("free", "Freelance Creators Collective", "تجمع المبدعين المستقلين", 7_800, 3, terms=15, category="freelancers"),
    ),
    invoice_prob=0.27,
    bill_prob=0.30,
    fixed_monthly=(
        (1, "ADOBE CREATIVE CLOUD SUBSCRIPTION", "Adobe", -2_850, "subscriptions"),
        (1, "FIGMA SUBSCRIPTION", "Figma", -1_320, "subscriptions"),
        (2, "ZOHO BOOKS SUBSCRIPTION", "Zoho", -560, "subscriptions"),
        (5, "STC BUSINESS BILL", "STC", -2_400, "telecom"),
        (10, "SADAD SEC ELECTRICITY", "Saudi Electricity Co.", -2_300, "utilities"),
        (28, "BANK CHARGES", None, -410, "bank_fees"),
    ),
    story_invoices=(
        ("makkah", -118, -88, 85_962, 34),
        ("makkah", -87, -57, 85_962, 58),
        ("makkah", -57, -27, 85_962, 71),
        ("makkah", -26, 4, 85_962, 66),
        ("redsea", -87, -57, 66_125, -30),
        ("redsea", -57, -27, 66_125, 5),
        ("redsea", -26, 4, 66_125, 30),
        ("season", -55, -25, 94_300, 19),
    ),
    story_bills=(
        ("studio", -25, 12, 48_300),
        ("media", -6, 9, 36_800),
    ),
)

PROFILES = {"retail": RETAIL, "services": SERVICES}

SAUDI_BANKS = {
    "alrajhi": ("Al Rajhi Bank", "مصرف الراجحي", "80"),
    "snb": ("Saudi National Bank", "البنك الأهلي السعودي", "10"),
    "riyad": ("Riyad Bank", "بنك الرياض", "20"),
    "sab": ("Saudi Awwal Bank", "البنك السعودي الأول", "45"),
    "alinma": ("Alinma Bank", "مصرف الإنماء", "05"),
    "bsf": ("Banque Saudi Fransi", "البنك السعودي الفرنسي", "55"),
    "anb": ("Arab National Bank", "البنك العربي الوطني", "30"),
    "albilad": ("Bank Albilad", "بنك البلاد", "15"),
    "aljazira": ("Bank AlJazira", "بنك الجزيرة", "60"),
    "saib": ("Saudi Investment Bank", "البنك السعودي للاستثمار", "65"),
}


def saudi_iban(bank_code: str, seed: int) -> str:
    """A syntactically valid Saudi IBAN (SAkk + 2-digit bank code + 18 digits)."""
    digits = str(int(hashlib.sha256(f"{seed}-{bank_code}".encode()).hexdigest(), 16))[:18]
    bban = bank_code + digits
    # ISO 13616 check digits: move "SA00" to the end, letters -> numbers (S=28, A=10).
    check = 98 - int(bban + "281000") % 97
    return f"SA{check:02d}{bban}"


class SandboxWorld:
    def __init__(self, seed: int, sector: str, anchor: date):
        self.seed = seed
        self.profile = PROFILES.get(sector, RETAIL)
        self.anchor = anchor
        self.origin = anchor - timedelta(days=HISTORY_DAYS + 150)
        self._cache: dict = {}

    # -- helpers -------------------------------------------------------------
    def _rng(self, d: date, stream: int) -> np.random.Generator:
        return np.random.default_rng([self.seed, d.toordinal(), stream])

    def _growth(self, d: date) -> float:
        return (1 + self.profile.growth) ** ((d - self.anchor).days / 365)

    def _season(self, d: date, channel: str) -> float:
        s = self.profile.seasonal
        if not s:
            return 1.0
        m = 1.0
        if is_ramadan(d):
            m *= s["ramadan"]
        if is_last_ten_ramadan(d):
            m *= s["last_ten"]
        if is_pre_eid_adha(d):
            m *= s["pre_eid_adha"]
        if is_eid(d):
            m *= s["eid"]
        if is_national_day_season(d):
            m *= s["national_day"]
        if is_founding_day_season(d):
            m *= s["founding_day"]
        if is_white_friday_season(d):
            m *= s["white_friday_online"] if channel == "online" else s["white_friday_pos"]
        if is_payday_window(d):
            m *= s["payday"]
        return m

    # Mon..Sun multipliers for walk-in retail (Thu/Fri/Sat evenings are busiest).
    _DOW = (0.85, 0.90, 1.00, 1.35, 1.15, 1.25, 0.85)

    def pos_sales(self, d: date) -> float:
        if not self.profile.pos_base:
            return 0.0
        key = ("pos", d)
        if key not in self._cache:
            noise = self._rng(d, 1).lognormal(0, 0.17)
            v = self.profile.pos_base * self._DOW[d.weekday()] * self._season(d, "pos") * self._growth(d) * noise
            self._cache[key] = round(v, 2)
        return self._cache[key]

    def online_sales(self, d: date) -> float:
        if not self.profile.online_base:
            return 0.0
        key = ("online", d)
        if key not in self._cache:
            noise = self._rng(d, 2).lognormal(0, 0.25)
            v = self.profile.online_base * self._season(d, "online") * self._growth(d) * noise
            self._cache[key] = round(v, 2)
        return self._cache[key]

    @cached_property
    def rent_dates(self) -> set[date]:
        first = self.anchor + timedelta(days=self.profile.rent_offset)
        return {previous_business_day(add_months(first, 6 * k)) for k in range(-4, 6)}

    def payroll_amount(self, d: date) -> float:
        amount = 0.0
        for rel, value in self.profile.payroll_steps:
            if (d - self.anchor).days >= rel:
                amount = value
        return amount

    # -- invoices ------------------------------------------------------------
    def _pick(self, rng: np.random.Generator, parties: tuple[Party, ...]) -> Party:
        w = np.asarray([p.weight for p in parties], dtype=float)
        return parties[int(rng.choice(len(parties), p=w / w.sum()))]

    def _paid_date(self, due: date, delay: int) -> date:
        return next_business_day(due + timedelta(days=int(delay)))

    @cached_property
    def all_invoices(self) -> list[WorldInvoice]:
        """Every invoice/bill from the origin up to anchor + 2 years (future ones are filtered by date)."""
        p = self.profile
        out: list[WorldInvoice] = []
        end = self.anchor + timedelta(days=730)
        counters = {"receivable": 1000, "payable": 5000}

        def make(kind: str, party: Party, issued: date, due: date, amount: float, paid: date | None, tag: str) -> None:
            counters[kind] += 1
            prefix = "INV" if kind == "receivable" else "BILL"
            vat = round(amount * VAT_RATE / (1 + VAT_RATE), 2)
            ext = f"{kind[:3]}-{tag}-{issued:%Y%m%d}-{party.key}"
            out.append(
                WorldInvoice(
                    external_id=ext,
                    kind=kind,
                    number=f"{prefix}-{issued.year}-{counters[kind]:04d}",
                    party=party,
                    issue_date=issued,
                    due_date=due,
                    amount=round(amount, 2),
                    vat_amount=vat,
                    paid_date=paid,
                    zatca_uuid=str(uuid.UUID(hashlib.md5(f"{self.seed}{ext}".encode()).hexdigest())),
                    category=party.category,
                )
            )

        story_window = (self.anchor - timedelta(days=100), self.anchor + timedelta(days=45))
        d = self.origin
        while d <= end:
            if d.weekday() not in (4, 5):
                rng = self._rng(d, 10)
                growth = self._growth(d)
                if p.customers and rng.random() < p.invoice_prob:
                    c = self._pick(rng, p.customers)
                    amount = c.typical_amount * growth * rng.lognormal(0, 0.35)
                    due = d + timedelta(days=c.terms)
                    make("receivable", c, d, due, amount, self._paid_date(due, int(rng.choice(c.delays)) + int(rng.integers(-2, 3))), "r")
                if p.suppliers and rng.random() < p.bill_prob:
                    s = self._pick(rng, p.suppliers)
                    amount = s.typical_amount * growth * rng.lognormal(0, 0.35)
                    due = d + timedelta(days=s.terms)
                    make("payable", s, d, due, amount, next_business_day(due), "b")
                # Pre-season stock purchases (Ramadan and White Friday), ~6 weeks ahead.
                if p.seasonal and p.suppliers and d.weekday() == 0:
                    ahead = d + timedelta(days=42)
                    if (is_ramadan(ahead) and not is_ramadan(ahead - timedelta(days=7))) or (
                        ahead.month == 11 and 14 <= ahead.day <= 20 and d < story_window[0]
                    ):
                        s = p.suppliers[0]
                        due = d + timedelta(days=s.terms)
                        make("payable", s, d, due, 95_000 * growth * rng.lognormal(0, 0.1), next_business_day(due), "s")
            # Monthly retainers issued on the 1st, net 30.
            if p.retainers and d.day == 1:
                for c in p.retainers:
                    rng = self._rng(d, 20 + zlib.crc32(c.key.encode()) % 50)
                    if -120 < (d - self.anchor).days < 0 and c.key in ("makkah", "redsea"):
                        continue  # covered by the story invoices below
                    due = d + timedelta(days=30)
                    paid = self._paid_date(due, int(rng.choice(c.delays)) + int(rng.integers(-2, 3)))
                    make("receivable", c, d, due, c.typical_amount * self._growth(d) ** 0.5, paid, "m")
            d += timedelta(days=1)

        parties = {c.key: c for c in (*p.customers, *p.retainers, *p.suppliers)}
        for i, (key, issued, due, amount, paid) in enumerate(p.story_invoices):
            party = parties[key]
            make(
                "receivable",
                party,
                self.anchor + timedelta(days=issued),
                self.anchor + timedelta(days=due),
                amount,
                next_business_day(self.anchor + timedelta(days=paid)) if paid is not None else None,
                f"s{i}",
            )
        for i, (key, issued, due, amount) in enumerate(p.story_bills):
            due_d = self.anchor + timedelta(days=due)
            make("payable", parties[key], self.anchor + timedelta(days=issued), due_d, amount, next_business_day(due_d), f"sb{i}")
        out.sort(key=lambda inv: (inv.issue_date, inv.external_id))
        return out

    def invoices(self, as_of: date) -> list[WorldInvoice]:
        """Invoices issued on/before ``as_of`` with payment status as of that date."""
        result = []
        for inv in self.all_invoices:
            if inv.issue_date > as_of:
                continue
            paid = inv.paid_date if inv.paid_date and inv.paid_date <= as_of else None
            result.append(
                WorldInvoice(**{**inv.__dict__, "paid_date": paid})
            )
        return result

    # -- bank transactions -----------------------------------------------------
    def _vat_for_quarter(self, year: int, q: int) -> float:
        start, end = quarter_bounds(year, q)
        sales = 0.0
        d = start
        while d <= end:
            sales += self.pos_sales(d) + self.online_sales(d)
            d += timedelta(days=1)
        for inv in self.all_invoices:
            if start <= inv.issue_date <= end:
                if inv.kind == "receivable":
                    sales += inv.amount
                else:
                    sales -= inv.amount
        return round(max(0.0, sales * VAT_RATE / (1 + VAT_RATE)), 2)

    def _day_txns(self, d: date) -> list[WorldTxn]:
        p = self.profile
        txns: list[WorldTxn] = []
        tag = f"{d:%Y%m%d}"

        def add(stream: str, amount: float, desc: str, cp: str | None, cat: str, account: str = "operating") -> None:
            if abs(amount) < 0.01:
                return
            txns.append(WorldTxn(f"{account[:3]}-{tag}-{stream}", d, round(amount, 2), desc, cp, cat, account))

        if p.pos_base:
            add("pos", self.pos_sales(d), f"MADA POS SETTLEMENT T{4500 + self.seed % 97}", "mada", "sales_pos")
        if p.online_base and d.weekday() in (6, 2):  # Salla payouts every Sunday and Wednesday
            back = 3 if d.weekday() == 6 else 4  # Thu-Sat / Sun-Wed windows
            amount = sum(self.online_sales(d - timedelta(days=k)) for k in range(1, back + 1))
            add("salla", amount * 0.975, f"SALLA PAYOUT #{d.toordinal() % 100000}", "Salla", "sales_online")
        if p.online_base and d.weekday() == 0:
            week = sum(self.online_sales(d - timedelta(days=k)) for k in range(1, 8))
            add("ship", -week * 0.07, "SMSA EXPRESS SHIPPING", "SMSA Express", "logistics")

        rng = self._rng(d, 3)
        if d.weekday() not in (4,):
            spend = p.daily_opex * rng.lognormal(0, 0.5)
            if rng.random() < 0.55:
                add("misc", -spend, "POS PURCHASE - OFFICE & STORE SUPPLIES", "Various", "other_expense")
        if rng.random() < (0.30 if p.key == "retail" else 0.18):
            platform = ("SNAP ADS", "TIKTOK ADS", "GOOGLE ADS", "INFLUENCER PAYMENT")[int(rng.integers(0, 4))]
            boost = 1.8 if (is_white_friday_season(d + timedelta(days=10)) or is_ramadan(d + timedelta(days=10))) else 1.0
            add("ads", -1_600 * boost * rng.lognormal(0, 0.4), platform, platform.split()[0].title(), "marketing")

        for i, (day, desc, cp, amount, cat) in enumerate(p.fixed_monthly):
            if d.day == day:
                season = 1.7 if cat == "utilities" and d.month in (6, 7, 8, 9) else 1.0
                add(f"fix{i}", amount * season * (1 + (rng.random() - 0.5) * 0.08), desc, cp, cat)

        # Payroll via WPS on the 27th (earlier if it falls on a weekend/holiday).
        if d == previous_business_day(d.replace(day=27)):
            add("wps", -self.payroll_amount(d), f"WPS SALARY TRANSFER {d:%b %Y}".upper(), "Mudad / WPS", "payroll")
        # GOSI contributions before the 15th.
        if d == previous_business_day(d.replace(day=12)):
            add("gosi", -self.payroll_amount(d - timedelta(days=20)) * p.gosi_rate, "GOSI MONTHLY CONTRIBUTION", "GOSI", "gosi")
        # Semi-annual rent through Ejar.
        if p.rent_amount and d in self.rent_dates:
            add("rent", -p.rent_amount, "EJAR RENT PAYMENT - SHOWROOM & WAREHOUSE", "Ejar", "rent")
        # ZATCA VAT for the previous quarter.
        y, q = quarter_of(d)
        py, pq = (y, q - 1) if q > 1 else (y - 1, 4)
        if d == vat_due_date(py, pq):
            add("vat", -self._vat_for_quarter(py, pq), f"SADAD ZATCA VAT Q{pq}-{py}", "ZATCA", "vat")
        return txns

    @cached_property
    def anchor_balance(self) -> float:
        inv = self._invoice_txns()
        running, low = 0.0, 0.0
        for i in range(1, 91):
            d = self.anchor + timedelta(days=i)
            running += sum(t.amount for t in self._day_txns(d)) + sum(t.amount for t in inv.get(d, []))
            low = min(low, running)
        target = self.profile.future_low_target - low
        return float(max(self.profile.min_anchor_balance, round(target, -2)))

    @cached_property
    def distributions(self) -> dict[date, float]:
        """Partner profit distributions that keep historical balances realistic.

        Walking backwards from the anchor balance, whenever an earlier balance
        would fall below the floor, the cash that was built up afterwards is
        paid out as a distribution on the next month's first business day.
        """
        floor = 60_000.0 if self.profile.key == "retail" else 150_000.0
        nets: dict[date, float] = {}
        inv = self._invoice_txns()
        d = self.origin
        while d <= self.anchor:
            nets[d] = sum(t.amount for t in self._day_txns(d)) + sum(t.amount for t in inv.get(d, []))
            d += timedelta(days=1)
        draws: dict[date, float] = {}
        b = self.anchor_balance
        d = self.anchor
        while d > self.origin:
            b -= nets[d]  # balance at end of d - 1
            if b < floor:
                x = math.ceil((floor - b) / 5_000) * 5_000 + 20_000
                pay = next_business_day(add_months(d.replace(day=1), 1, 1))
                if pay > self.anchor - timedelta(days=20):
                    pay = d  # must not precede the day it has to lift
                draws[pay] = draws.get(pay, 0.0) + x
                b += x
            d -= timedelta(days=1)
        return draws

    def _invoice_txns(self) -> dict[date, list[WorldTxn]]:
        if "inv_txns" in self._cache:
            return self._cache["inv_txns"]
        by_day: dict[date, list[WorldTxn]] = {}
        for inv in self.all_invoices:
            if not inv.paid_date:
                continue
            if inv.kind == "receivable":
                t = WorldTxn(
                    f"ope-{inv.paid_date:%Y%m%d}-{inv.external_id}",
                    inv.paid_date,
                    inv.amount,
                    f"TRANSFER FROM {inv.party.name_en.upper()} REF {inv.number}",
                    inv.party.name_en,
                    "receivable_payment",
                )
            else:
                t = WorldTxn(
                    f"ope-{inv.paid_date:%Y%m%d}-{inv.external_id}",
                    inv.paid_date,
                    -inv.amount,
                    f"TRANSFER TO {inv.party.name_en.upper()} REF {inv.number}",
                    inv.party.name_en,
                    "supplier_payment",
                )
            by_day.setdefault(inv.paid_date, []).append(t)
        self._cache["inv_txns"] = by_day
        return by_day

    def transactions(self, start: date, end: date, account: str = "operating") -> list[WorldTxn]:
        if account == "reserve":
            out = []
            d = start
            while d <= end:
                if d.day == 1:
                    out.append(WorldTxn(f"res-{d:%Y%m%d}-profit", d, round(75_000 * 0.045 / 12, 2), "MURABAHA DEPOSIT PROFIT DISTRIBUTION", None, "other_income", "reserve"))
                d += timedelta(days=1)
            return out
        inv = self._invoice_txns()
        draws = self.distributions
        out = []
        d = start
        while d <= end:
            out.extend(self._day_txns(d))
            out.extend(inv.get(d, []))
            if d in draws:
                out.append(WorldTxn(f"ope-{d:%Y%m%d}-dist", d, -round(draws[d], 2), "PROFIT DISTRIBUTION TO PARTNERS", "Partners", "owner_draw"))
            d += timedelta(days=1)
        return out

    def _net(self, start: date, end: date, account: str) -> float:
        return sum(t.amount for t in self.transactions(start, end, account))

    def balance(self, as_of: date, account: str = "operating") -> float:
        anchor_balance = self.anchor_balance if account == "operating" else 75_000.0
        if as_of >= self.anchor:
            return round(anchor_balance + self._net(self.anchor + timedelta(days=1), as_of, account), 2)
        return round(anchor_balance - self._net(as_of + timedelta(days=1), self.anchor, account), 2)
