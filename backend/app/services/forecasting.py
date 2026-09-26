"""Siyulah cash-flow forecasting engine.

A hybrid model, deliberately explainable:

1. **Known flows** are scheduled exactly: open supplier bills, payroll, rent,
   GOSI, ZATCA VAT and other obligations, plus anything a scenario adds.
2. **Receivables** are scheduled probabilistically. Each customer's historical
   payment delays (days paid after the due date) form an empirical
   distribution that is sampled per simulation — a customer who usually pays
   three weeks late is forecast that way.
3. **Unscheduled day-to-day flows** (POS/online sales, variable opex) are
   learned from bank history with a ridge regression on log-amounts over Saudi
   calendar features (Fri/Sat weekend, the 27th payday window, Ramadan, Eid,
   National Day, White Friday...). Residuals are bootstrapped so the
   uncertainty is data-driven rather than assumed Gaussian.

A Monte Carlo run (default 500 paths) combines the three and yields P10/P50/P90
balance bands, the probability of a shortfall and the cash runway. The random
streams are keyed per component, so a scenario run differs from the baseline
only by the scenario itself.

The module is pure (no database access) so it can be tested in isolation.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

import numpy as np

from .calendar_ksa import FEATURE_NAMES, add_months, day_features, previous_business_day

# Categories that are scheduled explicitly (never learned by the baseline model).
# Owner distributions and internal transfers are discretionary, so they are not projected.
ALWAYS_SCHEDULED = frozenset({"payroll", "gosi", "rent", "vat", "zakat", "loan", "transfer", "owner_draw"})
# Categories scheduled from invoices when an accounting system is connected.
INVOICE_CATEGORIES = frozenset({"receivable_payment", "supplier_payment"})

DEFAULT_DELAYS = [0, 0, 2, 5, 7, 10, 14]
DEFAULT_RECEIVABLE_LAGS = [30 + d for d in DEFAULT_DELAYS]
DEFAULT_PAYABLE_LAGS = [30, 30, 45]
RIDGE_LAMBDA = 4.0
MIN_TRAINING_DAYS = 28


@dataclass
class ReceivableInput:
    id: int
    number: str
    counterparty: str
    due_date: date
    outstanding: float
    delays: list[int] = field(default_factory=list)
    expected_date: date | None = None
    counterparty_ar: str | None = None


@dataclass
class PayableInput:
    id: int
    number: str
    counterparty: str
    due_date: date
    outstanding: float
    expected_date: date | None = None
    counterparty_ar: str | None = None


@dataclass
class ObligationInput:
    id: int
    kind: str
    name: str
    amount: float
    frequency: str
    next_due_date: date
    name_ar: str | None = None


@dataclass
class ForecastInputs:
    today: date
    opening_balance: float
    history: list[tuple[date, float, str]]  # (date, signed amount, category)
    receivables: list[ReceivableInput] = field(default_factory=list)
    payables: list[PayableInput] = field(default_factory=list)
    obligations: list[ObligationInput] = field(default_factory=list)
    company_delays: list[int] = field(default_factory=list)
    safety_buffer: float = 0.0
    invoices_connected: bool = False
    # Issue-to-payment lags (days) of settled invoices; used to phase in invoices
    # that have not been issued yet.
    receivable_lags: list[int] = field(default_factory=list)
    payable_lags: list[int] = field(default_factory=list)

    @property
    def baseline_exclude(self) -> frozenset[str]:
        return ALWAYS_SCHEDULED | (INVOICE_CATEGORIES if self.invoices_connected else frozenset())


# --- Baseline model -----------------------------------------------------------


@dataclass
class FlowModel:
    """Log-link (quasi-)Poisson GLM with ridge regularisation.

    Multiplicative calendar effects, unbiased mean predictions even on
    zero-heavy daily series, and empirical multiplicative residuals for
    simulation.
    """

    beta: np.ndarray
    ratios: np.ndarray  # actual / fitted on the training window
    start: date
    n_days: int
    active_features: list[str]

    def design(self, dates: list[date]) -> np.ndarray:
        rows = []
        for d in dates:
            # Level is held at the end of the training window (no trend extrapolation).
            t = min(1.0, (d - self.start).days / max(1, self.n_days - 1))
            rows.append([1.0, t, *day_features(d)])
        return np.asarray(rows)

    def mean(self, dates: list[date]) -> np.ndarray:
        return np.exp(self.design(dates) @ self.beta)

    def simulate(self, dates: list[date], rng: np.random.Generator, n: int) -> np.ndarray:
        mu = self.mean(dates)
        noise = rng.choice(self.ratios, size=(n, len(dates)), replace=True)
        return mu[None, :] * noise

    def drivers(self) -> dict[str, float]:
        """Multiplicative effect of each calendar feature (e.g. thu: +0.31 => +31%)."""
        out = {}
        for i, name in enumerate(FEATURE_NAMES[1:], start=2):
            if name in self.active_features:
                out[name] = round(float(math.exp(self.beta[i]) - 1.0), 4)
        return out


def fit_flow_model(start: date, series: np.ndarray, lam: float = RIDGE_LAMBDA) -> FlowModel:
    n = len(series)
    dates = [start + timedelta(days=i) for i in range(n)]
    X = np.asarray([[1.0, i / max(1, n - 1), *day_features(d)] for i, d in enumerate(dates)])
    y_raw = np.clip(series, 0.0, None)
    scale = float(y_raw.mean())
    support = X[:, 2:].sum(axis=0)
    active = [FEATURE_NAMES[j + 1] for j in range(len(support)) if support[j] >= 3]
    if scale <= 0:
        beta = np.zeros(X.shape[1])
        beta[0] = -50.0  # effectively zero flow
        return FlowModel(beta, np.ones(1), start, n, [])
    y = y_raw / scale  # fit on a unit scale so the penalty is meaningful
    penalty = lam * np.eye(X.shape[1])
    penalty[0, 0] = 0.0
    # Features never seen in training carry no information: pin them at zero.
    for j in range(len(support)):
        if support[j] == 0:
            penalty[j + 2, j + 2] = 1e6
    beta = np.zeros(X.shape[1])
    beta[0] = 0.0
    for _ in range(60):  # IRLS
        eta = np.clip(X @ beta, -30, 30)
        mu = np.exp(eta)
        z = eta + (y - mu) / mu
        A = X.T @ (mu[:, None] * X) + penalty
        new = np.linalg.solve(A, X.T @ (mu * z))
        if np.max(np.abs(new - beta)) < 1e-7:
            beta = new
            break
        beta = new
    fitted = np.exp(X @ beta)
    ratios = y / fitted
    ratios = ratios / ratios.mean()  # exact mean preservation in simulation
    beta[0] += math.log(scale)
    return FlowModel(beta, ratios, start, n, active)


def _daily_series(
    history: list[tuple[date, float, str]], exclude: frozenset[str], start: date, end: date
) -> tuple[np.ndarray, np.ndarray]:
    n = (end - start).days + 1
    inflow, outflow = np.zeros(n), np.zeros(n)
    for d, amount, category in history:
        if category in exclude or d < start or d > end:
            continue
        i = (d - start).days
        if amount >= 0:
            inflow[i] += amount
        else:
            outflow[i] += -amount
    return inflow, outflow


@dataclass
class RunRate:
    """Compound-Poisson run-rate of invoice payments (count per day, amounts)."""

    per_day: float
    amounts: np.ndarray

    @property
    def daily_mean(self) -> float:
        return float(self.per_day * self.amounts.mean()) if len(self.amounts) else 0.0


@dataclass
class Baseline:
    inflow: FlowModel | None
    outflow: FlowModel | None
    fallback_in: float
    fallback_out: float
    training_days: int
    accuracy: float | None
    runrates: dict[str, RunRate] = field(default_factory=dict)


RUNRATE_WINDOW = 180


def _runrates(history: list[tuple[date, float, str]], today: date) -> dict[str, RunRate]:
    since = today - timedelta(days=RUNRATE_WINDOW - 1)
    first = min((d for d, _, _ in history), default=today)
    window = max(1, (today - max(since, first)).days + 1)
    out = {}
    for cat in INVOICE_CATEGORIES:
        amounts = np.asarray([abs(a) for d, a, c in history if c == cat and since <= d <= today])
        if len(amounts):
            out[cat] = RunRate(len(amounts) / window, amounts)
    return out


def phase_in(lags: list[int], horizon: int, default: list[int]) -> np.ndarray:
    """P(issue-to-payment lag < h) for h = 1..horizon — the share of day-h payments
    that will come from invoices issued after today."""
    pool = np.asarray(lags if len(lags) >= 5 else default)
    h = np.arange(1, horizon + 1)
    return (pool[None, :] < h[:, None]).mean(axis=1)


def build_baseline(inputs: ForecastInputs) -> Baseline:
    today = inputs.today
    dated = [h for h in inputs.history if h[0] <= today]
    if not dated:
        return Baseline(None, None, 0.0, 0.0, 0, None)
    start = max(min(h[0] for h in dated), today - timedelta(days=364))
    inflow, outflow = _daily_series(dated, inputs.baseline_exclude, start, today)
    n = len(inflow)
    runrates = _runrates(dated, today) if inputs.invoices_connected else {}
    if n < MIN_TRAINING_DAYS:
        return Baseline(None, None, float(inflow.mean()), float(outflow.mean()), n, None, runrates)
    return Baseline(
        inflow=fit_flow_model(start, inflow),
        outflow=fit_flow_model(start, outflow),
        fallback_in=float(inflow.mean()),
        fallback_out=float(outflow.mean()),
        training_days=n,
        accuracy=_backtest(start, inflow, outflow),
        runrates=runrates,
    )


def _backtest(start: date, inflow: np.ndarray, outflow: np.ndarray, holdout: int = 28) -> float | None:
    """Train on all but the last 4 weeks, forecast them, score weekly totals (1 - WAPE)."""
    n = len(inflow)
    if n < holdout + 56:
        return None
    test_dates = [start + timedelta(days=n - holdout + i) for i in range(holdout)]
    actual_total, abs_err = 0.0, 0.0
    for series in (inflow, outflow):
        model = fit_flow_model(start, series[: n - holdout])
        # Hold the trend at the end of the training window, as in production.
        pred = model.mean(test_dates)
        act = series[n - holdout :]
        pw, aw = pred.reshape(-1, 7).sum(axis=1), act.reshape(-1, 7).sum(axis=1)
        abs_err += float(np.abs(pw - aw).sum())
        actual_total += float(aw.sum())
    if actual_total <= 0:
        return None
    return float(max(0.0, 1.0 - abs_err / actual_total))


# --- Adjustments (scenarios) --------------------------------------------------


def _as_date(v: Any) -> date | None:
    if v is None or isinstance(v, date):
        return v
    return date.fromisoformat(str(v)[:10])


FREQUENCY_MONTHS = {"monthly": 1, "quarterly": 3, "semiannual": 6, "annual": 12}


def obligation_occurrences(ob: ObligationInput, today: date, end: date, shift_first: int = 0) -> list[date]:
    """Payment dates of an obligation in (today, end].

    Recurring obligations roll forward from their nominal ``next_due_date`` and
    move to the previous business day when they land on a weekend/holiday.
    ``shift_first`` moves only the next occurrence (e.g. "pay VAT a week later").
    """
    step = FREQUENCY_MONTHS.get(ob.frequency)
    first_day = today + timedelta(days=1)
    if step is None:  # one-off
        d = max(ob.next_due_date, first_day) + timedelta(days=shift_first)
        d = max(d, first_day)
        return [d] if d <= end else []
    anchor_day = ob.next_due_date.day
    k = 0

    def nth(k: int) -> date:
        return previous_business_day(add_months(ob.next_due_date, step * k, anchor_day))

    d = nth(0)
    while d <= today:
        k += 1
        d = nth(k)
    occs = []
    limit = end + timedelta(days=abs(shift_first))
    while d <= limit:
        occs.append(d)
        k += 1
        d = nth(k)
    if occs and shift_first:
        occs[0] = max(first_day, occs[0] + timedelta(days=shift_first))
    return sorted(o for o in occs if today < o <= end)


# --- Forecast -----------------------------------------------------------------


def _event(d: date, kind: str, en: str, ar: str, amount: float, ref: str | None = None, **extra) -> dict:
    return {"date": d, "kind": kind, "label_en": en, "label_ar": ar, "amount": round(amount, 2), "ref": ref, **extra}


@dataclass
class Draws:
    """Every random draw of one Monte Carlo run, before any scenario is applied.

    Scenarios only rescale, shift or add to these draws, so re-using one set of
    draws gives exact common random numbers, and exporting it lets another runtime
    (the browser preview) reproduce the server's results.
    """

    dates: list[date]
    base_in: np.ndarray  # (n_sims, horizon): learned day-to-day inflows + future-invoice pipeline
    base_out: np.ndarray
    pipeline: dict[str, float]
    # Per receivable: sampled days-from-today of payment (before any scenario shift) and
    # whether it gets paid at all; None when the user already set an expected date.
    receivables: dict[int, tuple[np.ndarray, np.ndarray] | None]

    @property
    def n_sims(self) -> int:
        return self.base_in.shape[0]


def draw_simulations(
    inputs: ForecastInputs,
    horizon: int = 90,
    n_sims: int = 500,
    seed: int = 20240923,
    baseline: Baseline | None = None,
) -> Draws:
    today = inputs.today
    dates = [today + timedelta(days=i + 1) for i in range(horizon)]
    baseline = baseline or build_baseline(inputs)

    # 1) Baseline day-to-day flows ------------------------------------------------
    rng = np.random.default_rng([seed, 0])
    if baseline.inflow is not None:
        base_in = baseline.inflow.simulate(dates, rng, n_sims)
        base_out = baseline.outflow.simulate(dates, rng, n_sims)
    else:
        base_in = np.full((n_sims, horizon), baseline.fallback_in)
        base_out = np.full((n_sims, horizon), baseline.fallback_out)

    # Invoices not issued yet: phase in the historical run-rate as today's open
    # invoices run off (a day-h payment needs an issue-to-payment lag < h).
    rr_rng = np.random.default_rng([seed, 2])
    pipeline = {"receivable_payment": 0.0, "supplier_payment": 0.0}
    for cat, lags, default, target in (
        ("receivable_payment", inputs.receivable_lags, DEFAULT_RECEIVABLE_LAGS, base_in),
        ("supplier_payment", inputs.payable_lags, DEFAULT_PAYABLE_LAGS, base_out),
    ):
        rr = baseline.runrates.get(cat)
        if not rr:
            continue
        weight = phase_in(lags, horizon, default)
        counts = rr_rng.poisson(rr.per_day * weight[None, :], size=(n_sims, horizon))
        target += counts * rr_rng.choice(rr.amounts, size=(n_sims, horizon))
        pipeline[cat] = float((rr.daily_mean * weight).sum())

    # 2) Receivables: sampled from each customer's payment behaviour --------------
    company_delays = inputs.company_delays if len(inputs.company_delays) >= 3 else DEFAULT_DELAYS
    samples: dict[int, tuple[np.ndarray, np.ndarray] | None] = {}
    for r in inputs.receivables:
        if r.outstanding <= 0:
            continue
        if r.expected_date:
            samples[r.id] = None
            continue
        r_rng = np.random.default_rng([seed, 1, r.id])
        overdue = (today - r.due_date).days
        pool = np.asarray(r.delays if len(r.delays) >= 3 else company_delays)
        if overdue > 0:
            # Condition on what we already know: it has not been paid yet.
            remaining = pool[pool > overdue]
            # Later than this customer usually pays: a long, uncertain tail.
            tail = overdue + r_rng.geometric(1 / 14, size=n_sims)
            if len(remaining):
                known = r_rng.choice(remaining, size=n_sims) + r_rng.integers(-2, 3, size=n_sims)
                # Thin evidence (1-2 later payments) gets blended with the tail.
                use_tail = r_rng.random(n_sims) < (0.5 if len(remaining) < 3 else 0.0)
                delays = np.where(use_tail, tail, known)
            else:
                delays = tail
            delays = np.maximum(delays, overdue + 1)
        else:
            delays = r_rng.choice(pool, size=n_sims) + r_rng.integers(-2, 3, size=n_sims)
        # Long-overdue invoices carry a real chance of not paying within the horizon.
        p_default = 0.0 if overdue <= 60 else min(0.6, 0.25 + (overdue - 60) / 200)
        paid_mask = r_rng.random(n_sims) >= p_default
        samples[r.id] = ((r.due_date - today).days + delays, paid_mask)

    return Draws(dates, base_in, base_out, pipeline, samples)


def run_forecast(
    inputs: ForecastInputs,
    horizon: int = 90,
    adjustments: list[dict] | None = None,
    n_sims: int = 500,
    seed: int = 20240923,
    baseline: Baseline | None = None,
    draws: Draws | None = None,
) -> dict:
    adjustments = adjustments or []
    today = inputs.today
    end = today + timedelta(days=horizon)
    dates = [today + timedelta(days=i + 1) for i in range(horizon)]
    index = {d: i for i, d in enumerate(dates)}
    baseline = baseline or build_baseline(inputs)
    draws = draws or draw_simulations(inputs, horizon, n_sims, seed, baseline)
    n_sims = draws.n_sims
    base_in, base_out, pipeline = draws.base_in.copy(), draws.base_out.copy(), draws.pipeline

    for adj in adjustments:
        t = adj.get("type")
        if t in ("revenue_change", "expense_change"):
            factor = 1.0 + float(adj.get("pct", 0)) / 100.0
            s = _as_date(adj.get("start_date")) or dates[0]
            e = _as_date(adj.get("end_date")) or end
            mask = np.array([s <= d <= e for d in dates])
            target = base_in if t == "revenue_change" else base_out
            target[:, mask] *= max(0.0, factor)

    det_in = np.zeros(horizon)
    det_out = np.zeros(horizon)
    recv = np.zeros((n_sims, horizon))
    events: list[dict] = []

    delay_shift = {int(a["invoice_id"]): int(a.get("days", 0)) for a in adjustments if a.get("type") == "delay_receivable"}
    payable_shift = {int(a["invoice_id"]): int(a.get("days", 0)) for a in adjustments if a.get("type") == "shift_payable"}
    obligation_shift = {int(a["obligation_id"]): int(a.get("days", 0)) for a in adjustments if a.get("type") == "shift_obligation"}
    skipped = {int(a["obligation_id"]) for a in adjustments if a.get("type") == "skip_obligation"}
    written_off = {int(a["invoice_id"]) for a in adjustments if a.get("type") == "write_off_receivable"}
    collect_on = {int(a["invoice_id"]): _as_date(a.get("date")) for a in adjustments if a.get("type") == "expect_receivable"}

    # 3) Receivables: the sampled payment days, shifted or pinned by the scenario ---
    receivable_view = []
    for r in inputs.receivables:
        if r.outstanding <= 0 or r.id in written_off:
            continue
        shift = delay_shift.get(r.id, 0)
        expected_date = collect_on.get(r.id) or r.expected_date
        if expected_date:
            pay_days = np.full(n_sims, (expected_date - today).days + shift)
            paid_mask = np.ones(n_sims, dtype=bool)
        else:
            raw, paid_mask = draws.receivables[r.id]
            pay_days = raw + shift
        pay_days = np.maximum(pay_days, 1)
        in_window = paid_mask & (pay_days <= horizon)
        rows = np.nonzero(in_window)[0]
        recv[rows, pay_days[rows] - 1] += r.outstanding
        prob = float(in_window.mean())
        median_day = int(np.median(pay_days[in_window])) if in_window.any() else None
        expected = today + timedelta(days=median_day) if median_day else None
        receivable_view.append(
            {
                "id": r.id,
                "number": r.number,
                "expected_date": expected,
                "probability_in_horizon": round(prob, 3),
                "p10_date": today + timedelta(days=int(np.percentile(pay_days, 10))),
                "p90_date": today + timedelta(days=int(np.percentile(pay_days, 90))),
            }
        )
        if expected and prob >= 0.2:
            events.append(
                _event(
                    expected,
                    "receivable",
                    f"{r.counterparty} — {r.number}",
                    f"{r.counterparty_ar or r.counterparty} — {r.number}",
                    r.outstanding,
                    f"invoice:{r.id}",
                    probability=round(prob, 3),
                )
            )

    # 4) Payables — paid on the due date (or the planned date) -------------------
    for p in inputs.payables:
        if p.outstanding <= 0:
            continue
        d = (p.expected_date or p.due_date) + timedelta(days=payable_shift.get(p.id, 0))
        if d <= today:
            d = today + timedelta(days=1)
        if d > end:
            continue
        det_out[index[d]] += p.outstanding
        events.append(
            _event(d, "payable", f"{p.counterparty} — {p.number}", f"{p.counterparty_ar or p.counterparty} — {p.number}", -p.outstanding, f"invoice:{p.id}")
        )

    # 5) Obligations: payroll, rent, VAT, GOSI, zakat, loans ---------------------
    for ob in inputs.obligations:
        if ob.id in skipped:
            continue
        for d in obligation_occurrences(ob, today, end, obligation_shift.get(ob.id, 0)):
            det_out[index[d]] += ob.amount
            events.append(_event(d, ob.kind, ob.name, ob.name_ar or ob.name, -ob.amount, f"obligation:{ob.id}"))

    # 6) Scenario-only items ------------------------------------------------------
    for n_adj, adj in enumerate(adjustments):
        t = adj.get("type")
        label = str(adj.get("label") or "")
        if t == "one_off":
            d = _as_date(adj.get("date"))
            amount = float(adj.get("amount", 0))
            if d and today < d <= end:
                (det_in if amount >= 0 else det_out)[index[d]] += abs(amount)
                events.append(_event(d, "scenario", label or "One-off", label or "بند لمرة واحدة", amount, f"adj:{n_adj}"))
        elif t == "recurring":
            start = _as_date(adj.get("start_date")) or dates[0]
            amount = float(adj.get("amount", 0))
            step = {"weekly": None, "monthly": 1, "quarterly": 3}.get(adj.get("frequency", "monthly"), 1)
            k, d = 0, start
            while d <= end:
                if d > today:
                    (det_in if amount >= 0 else det_out)[index[d]] += abs(amount)
                    events.append(_event(d, "scenario", label or "Recurring", label or "بند متكرر", amount, f"adj:{n_adj}"))
                k += 1
                d = start + timedelta(days=7 * k) if step is None else add_months(start, step * k, start.day)
        elif t == "loan":
            d0 = _as_date(adj.get("date")) or dates[0]
            principal = float(adj.get("amount", 0))
            months = max(1, int(adj.get("months", 12)))
            r = float(adj.get("rate_pct", 0)) / 100 / 12
            installment = principal / months if r == 0 else principal * r / (1 - (1 + r) ** -months)
            if today < d0 <= end:
                det_in[index[d0]] += principal
                events.append(_event(d0, "scenario", label or "Financing drawdown", label or "سحب تمويل", principal, f"adj:{n_adj}"))
            for k in range(1, months + 1):
                d = add_months(d0, k)
                if today < d <= end:
                    det_out[index[d]] += installment
                    events.append(_event(d, "scenario", (label or "Financing") + " — installment", (label or "التمويل") + " — قسط", -installment, f"adj:{n_adj}"))

    # 7) Simulate balances -----------------------------------------------------------
    inflow = base_in + recv + det_in[None, :]
    outflow = base_out + det_out[None, :]
    paths = inputs.opening_balance + np.cumsum(inflow - outflow, axis=1)
    p10, p50, p90 = np.percentile(paths, [10, 50, 90], axis=0)
    mean_in, mean_out = inflow.mean(axis=0), outflow.mean(axis=0)

    events.sort(key=lambda e: (e["date"], e["amount"]))
    events_by_day: dict[date, list[dict]] = {}
    for e in events:
        events_by_day.setdefault(e["date"], []).append(e)

    series = [
        {
            "date": d,
            "p10": round(float(p10[i]), 2),
            "p50": round(float(p50[i]), 2),
            "p90": round(float(p90[i]), 2),
            "inflow": round(float(mean_in[i]), 2),
            "outflow": round(float(mean_out[i]), 2),
            "events": events_by_day.get(d, []),
        }
        for i, d in enumerate(dates)
    ]

    buffer = inputs.safety_buffer
    lowest_i = int(np.argmin(p50))
    zero_i = next((i for i in range(horizon) if p50[i] < 0), None)
    buffer_i = next((i for i in range(horizon) if p50[i] < buffer), None)
    risk_i = next((i for i in range(horizon) if p10[i] < 0), None)
    path_min = paths.min(axis=1)
    metrics = {
        "opening_balance": round(inputs.opening_balance, 2),
        "ending_balance": round(float(p50[-1]), 2),
        "ending_p10": round(float(p10[-1]), 2),
        "ending_p90": round(float(p90[-1]), 2),
        "lowest_balance": round(float(p50[lowest_i]), 2),
        "lowest_date": dates[lowest_i],
        "lowest_p10": round(float(p10.min()), 2),
        "cash_zero_date": dates[zero_i] if zero_i is not None else None,
        "runway_days": zero_i + 1 if zero_i is not None else None,
        "buffer_breach_date": dates[buffer_i] if buffer_i is not None else None,
        "risk_date": dates[risk_i] if risk_i is not None else None,
        "shortfall_probability": round(float((path_min < 0).mean()), 3),
        "buffer_breach_probability": round(float((path_min < buffer).mean()), 3),
        "total_inflow": round(float(mean_in.sum()), 2),
        "total_outflow": round(float(mean_out.sum()), 2),
        "net_change": round(float(mean_in.sum() - mean_out.sum()), 2),
        "avg_daily_outflow": round(float(mean_out.mean()), 2),
        "days_below_buffer": int((p50 < buffer).sum()),
        "future_invoice_inflow": round(pipeline["receivable_payment"], 2),
        "future_bill_outflow": round(pipeline["supplier_payment"], 2),
        "safety_buffer": buffer,
        "horizon": horizon,
    }
    model = {
        "method": "hybrid-montecarlo-ridge",
        "simulations": n_sims,
        "training_days": baseline.training_days,
        "backtest_accuracy": round(baseline.accuracy, 3) if baseline.accuracy is not None else None,
        "sales_drivers": baseline.inflow.drivers() if baseline.inflow else {},
        "expense_drivers": baseline.outflow.drivers() if baseline.outflow else {},
    }
    return {
        "as_of": today,
        "horizon": horizon,
        "series": series,
        "metrics": metrics,
        "model": model,
        "receivables": receivable_view,
    }


def history_series(
    history: list[tuple[date, float, str]], current_balance: float, today: date, days: int = 30
) -> list[dict]:
    """Reconstruct end-of-day balances for the last ``days`` days from the current balance."""
    start = today - timedelta(days=days - 1)
    inflow = {start + timedelta(days=i): 0.0 for i in range(days)}
    outflow = dict(inflow)
    for d, amount, _ in history:
        if start <= d <= today:
            if amount >= 0:
                inflow[d] += amount
            else:
                outflow[d] += -amount
    out = []
    bal = current_balance
    for i in range(days - 1, -1, -1):
        d = start + timedelta(days=i)
        out.append({"date": d, "balance": round(bal, 2), "inflow": round(inflow[d], 2), "outflow": round(outflow[d], 2)})
        bal -= inflow[d] - outflow[d]
    out.reverse()
    return out
