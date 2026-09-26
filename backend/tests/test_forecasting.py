from datetime import date, timedelta

import numpy as np

from app.services.forecasting import (
    ForecastInputs,
    ObligationInput,
    PayableInput,
    ReceivableInput,
    fit_flow_model,
    obligation_occurrences,
    run_forecast,
)

TODAY = date(2026, 9, 26)


def synthetic_history(days=365, base=5000.0, thursday_boost=1.5, seed=1):
    rng = np.random.default_rng(seed)
    hist = []
    for i in range(days):
        d = TODAY - timedelta(days=days - 1 - i)
        amt = base * (thursday_boost if d.weekday() == 3 else 1.0) * rng.lognormal(0, 0.1)
        hist.append((d, amt, "sales_pos"))
        hist.append((d, -1000 * rng.lognormal(0, 0.2), "other_expense"))
    return hist


def make_inputs(**kw):
    return ForecastInputs(today=TODAY, opening_balance=100_000, history=synthetic_history(), safety_buffer=20_000, **kw)


def test_glm_learns_weekday_effect():
    start = TODAY - timedelta(days=364)
    hist = synthetic_history()
    series = np.zeros(365)
    for d, a, c in hist:
        if c == "sales_pos":
            series[(d - start).days] += a
    model = fit_flow_model(start, series)
    assert abs(model.drivers()["thu"] - 0.5) < 0.1  # +50% on Thursdays
    pred = model.mean([TODAY + timedelta(days=i) for i in range(1, 8)])
    assert 4000 < pred.min() < 6500 and pred.max() > 6500


def test_baseline_matches_expected_net_flow():
    res = run_forecast(make_inputs(), 30)
    # ~5.4k in (with Thursday boost) minus ~1k out per day.
    per_day = res["metrics"]["net_change"] / 30
    assert 3800 < per_day < 5200
    assert res["model"]["backtest_accuracy"] > 0.85
    s = res["series"]
    assert all(x["p10"] <= x["p50"] <= x["p90"] for x in s)


def test_payable_and_obligation_are_scheduled_exactly():
    ob = ObligationInput(1, "payroll", "Payroll", 80_000, "monthly", date(2026, 10, 27))
    pay = PayableInput(2, "BILL-1", "Supplier", date(2026, 10, 5), 30_000)
    base = run_forecast(make_inputs(), 60)
    res = run_forecast(make_inputs(payables=[pay], obligations=[ob]), 60)
    diff = {s["date"]: b["p50"] - s["p50"] for s, b in zip(res["series"], base["series"])}
    assert abs(diff[date(2026, 10, 4)]) < 1
    assert abs(diff[date(2026, 10, 5)] - 30_000) < 1
    assert abs(diff[date(2026, 10, 27)] - 110_000) < 1
    events = [e for s in res["series"] for e in s["events"]]
    assert {e["kind"] for e in events} == {"payable", "payroll"}


def test_obligation_occurrences_roll_forward_and_skip_weekends():
    ob = ObligationInput(1, "payroll", "Payroll", 1, "monthly", date(2026, 8, 27))
    occ = obligation_occurrences(ob, TODAY, TODAY + timedelta(days=90))
    # 27 Sep (Sun), 27 Oct (Tue), 27 Nov is a Friday -> Thu 26 Nov.
    assert occ == [date(2026, 9, 27), date(2026, 10, 27), date(2026, 11, 26)]
    shifted = obligation_occurrences(ob, TODAY, TODAY + timedelta(days=90), shift_first=7)
    assert shifted[0] == date(2026, 10, 4)


def test_receivable_uses_customer_delay_history():
    on_time = ReceivableInput(1, "INV-1", "Prompt Co", date(2026, 10, 10), 50_000, delays=[0, 0, 1, 0, 2])
    late = ReceivableInput(2, "INV-2", "Slow Co", date(2026, 10, 10), 50_000, delays=[30, 35, 40, 32, 38])
    r = run_forecast(make_inputs(receivables=[on_time, late]), 90)
    view = {x["id"]: x for x in r["receivables"]}
    assert view[1]["expected_date"] <= date(2026, 10, 14)
    assert view[2]["expected_date"] >= date(2026, 11, 8)


def test_overdue_invoice_conditions_on_elapsed_time():
    overdue = ReceivableInput(1, "INV-1", "Slow Co", date(2026, 9, 1), 40_000, delays=[30, 35, 40, 45, 50])
    r = run_forecast(make_inputs(receivables=[overdue]), 90)
    exp = r["receivables"][0]["expected_date"]
    # 25 days overdue already; this customer pays 30-50 days late -> early/mid October.
    assert date(2026, 9, 29) <= exp <= date(2026, 10, 22)


def test_scenarios_move_money_in_the_expected_direction():
    rec = ReceivableInput(1, "INV-1", "Customer", date(2026, 10, 20), 60_000, delays=[0, 1, 2, 0, 1])
    ob = ObligationInput(3, "vat", "VAT", 40_000, "once", date(2026, 10, 29))
    inputs = make_inputs(receivables=[rec], obligations=[ob])
    base = run_forecast(inputs, 90)
    late = run_forecast(inputs, 90, [{"type": "delay_receivable", "invoice_id": 1, "days": 15}])
    d = date(2026, 10, 28)
    b = next(s for s in base["series"] if s["date"] == d)["p50"]
    l = next(s for s in late["series"] if s["date"] == d)["p50"]
    assert abs((b - l) - 60_000) < 1_000
    assert abs(base["metrics"]["ending_balance"] - late["metrics"]["ending_balance"]) < 1

    vat_later = run_forecast(inputs, 90, [{"type": "shift_obligation", "obligation_id": 3, "days": 7}])
    assert any(e["kind"] == "vat" and e["date"] == date(2026, 11, 5) for s in vat_later["series"] for e in s["events"])

    dip = run_forecast(inputs, 90, [{"type": "revenue_change", "pct": -50}])
    assert dip["metrics"]["total_inflow"] < base["metrics"]["total_inflow"] * 0.7

    loan = run_forecast(inputs, 90, [{"type": "loan", "date": "2026-10-01", "amount": 120_000, "months": 12, "rate_pct": 0}])
    assert abs(loan["metrics"]["ending_balance"] - base["metrics"]["ending_balance"] - (120_000 - 2 * 10_000)) < 10_500


def test_shortfall_probability_and_runway():
    ob = ObligationInput(1, "rent", "Rent", 400_000, "once", date(2026, 10, 15))
    r = run_forecast(make_inputs(obligations=[ob]), 90)
    m = r["metrics"]
    assert m["runway_days"] == (date(2026, 10, 15) - TODAY).days
    assert m["cash_zero_date"] == date(2026, 10, 15)
    assert m["shortfall_probability"] > 0.95


def test_future_invoices_phase_in():
    hist = synthetic_history()
    for i in range(0, 360, 10):
        d = TODAY - timedelta(days=i)
        hist.append((d, 20_000.0, "receivable_payment"))
    inputs = ForecastInputs(
        today=TODAY, opening_balance=100_000, history=hist, invoices_connected=True, receivable_lags=[30, 31, 35, 40, 45]
    )
    r = run_forecast(inputs, 90)
    # 2k/day run-rate, fully phased in after ~45 days: about 2k * (90 - ~37) = ~100k.
    assert 70_000 < r["metrics"]["future_invoice_inflow"] < 130_000
    first_month = sum(s["inflow"] for s in r["series"][:28])
    last_month = sum(s["inflow"] for s in r["series"][-28:])
    assert last_month > first_month + 30_000


def test_earlier_collection_never_lowers_the_forecast():
    """Common random numbers: a scenario differs from the baseline only by the scenario."""
    rec = ReceivableInput(1, "INV-1", "Slow Co", date(2026, 8, 1), 80_000, delays=[60, 70, 75, 90])
    ob = ObligationInput(2, "payroll", "Payroll", 150_000, "monthly", date(2026, 10, 27))
    inputs = make_inputs(receivables=[rec], obligations=[ob])
    base = run_forecast(inputs, 90)
    early = run_forecast(inputs, 90, [{"type": "expect_receivable", "invoice_id": 1, "date": "2026-10-01"}])
    for b, e in zip(base["series"], early["series"]):
        if b["date"] >= date(2026, 10, 1):
            assert e["p50"] >= b["p50"] - 1e-6
    assert early["metrics"]["shortfall_probability"] <= base["metrics"]["shortfall_probability"]
