from datetime import date, timedelta

from app.integrations.sandbox_world import SandboxWorld, saudi_iban
from app.services.categorizer import categorize

ANCHOR = date(2026, 9, 26)


def iban_valid(iban: str) -> bool:
    rearranged = iban[4:] + iban[:4]
    digits = "".join(str(int(ch, 36)) for ch in rearranged)
    return len(iban) == 24 and int(digits) % 97 == 1


def test_iban_checksum():
    assert iban_valid(saudi_iban("80", 1))
    assert iban_valid(saudi_iban("10", 99))


def test_balances_reconcile_with_transactions():
    w = SandboxWorld(1, "retail", ANCHOR)
    assert w.balance(ANCHOR) == w.profile.anchor_balance
    d1, d2 = ANCHOR - timedelta(days=120), ANCHOR + timedelta(days=20)
    net = sum(t.amount for t in w.transactions(d1 + timedelta(days=1), d2))
    assert abs(w.balance(d2) - w.balance(d1) - net) < 0.05


def test_history_is_realistic_and_categorisable():
    for sector in ("retail", "services"):
        w = SandboxWorld(3, sector, ANCHOR)
        txns = w.transactions(ANCHOR - timedelta(days=364), ANCHOR)
        assert all(categorize(t.description, t.amount) == t.true_category for t in txns)
        bal = w.balance(ANCHOR - timedelta(days=365))
        low = bal
        for d in sorted({t.date for t in txns}):
            bal += sum(t.amount for t in txns if t.date == d)
            low = min(low, bal)
        assert low > 0, f"{sector} history went negative"


def test_bank_and_accounting_views_reconcile():
    w = SandboxWorld(1, "retail", ANCHOR)
    invoices = {i.number: i for i in w.invoices(ANCHOR)}
    transfers = [t for t in w.transactions(ANCHOR - timedelta(days=200), ANCHOR) if t.true_category == "receivable_payment"]
    assert transfers
    for t in transfers:
        number = t.description.rsplit("REF ", 1)[1]
        assert invoices[number].paid_date == t.date
        assert invoices[number].amount == t.amount


def test_world_is_deterministic_and_stable_over_time():
    a = SandboxWorld(5, "retail", ANCHOR).transactions(ANCHOR - timedelta(days=30), ANCHOR)
    b = SandboxWorld(5, "retail", ANCHOR).transactions(ANCHOR - timedelta(days=30), ANCHOR)
    assert [(t.external_id, t.amount) for t in a] == [(t.external_id, t.amount) for t in b]
