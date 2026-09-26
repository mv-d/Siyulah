/**
 * Browser port of the "assemble" half of the forecasting engine
 * (backend/app/services/forecasting.py → run_forecast).
 *
 * It replays the server's own Monte Carlo draws (exported by /api/forecast/engine),
 * so any scenario computed here matches what the server would return on the same
 * simulated paths. Keep it in step with the Python implementation.
 */
import type { Adjustment, Forecast, ForecastEvent, ForecastPoint, HistoryPoint, Metrics, ReceivableForecast, ScenarioResult } from "../api/types";

interface Receivable {
  id: number;
  number: string;
  counterparty: string;
  counterparty_ar: string | null;
  due_date: string;
  outstanding: number;
  expected_date: string | null;
}
interface Payable {
  id: number;
  number: string;
  counterparty: string;
  counterparty_ar: string | null;
  due_date: string;
  outstanding: number;
  expected_date: string | null;
}
interface Obligation {
  id: number;
  kind: string;
  name: string;
  name_ar: string | null;
  amount: number;
  frequency: string;
  next_due_date: string;
}

export interface EngineExport {
  today: string;
  opening_balance: number;
  safety_buffer: number;
  receivables: Receivable[];
  payables: Payable[];
  obligations: Obligation[];
  holidays: string[];
  model: { method: string; training_days: number; backtest_accuracy: number | null; sales_drivers: Record<string, number>; expense_drivers: Record<string, number> };
  history: HistoryPoint[];
  sims: {
    n: number;
    horizon: number;
    base_in: number[];
    base_out: number[];
    pipeline: Record<string, number>;
    receivables: Record<string, { days: number[]; paid: string } | null>;
  };
}

// --- dates as UTC day numbers --------------------------------------------------
const DAY = 86_400_000;
const toDay = (iso: string) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY);
const toIso = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);
const weekday = (day: number) => (new Date(day * DAY).getUTCDay() + 6) % 7; // Python: Monday = 0
const ymd = (day: number) => {
  const d = new Date(day * DAY);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()] as const;
};
const monthLength = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function addMonths(day: number, months: number, dom?: number): number {
  const [y, m, d] = ymd(day);
  const total = m - 1 + months;
  const y2 = y + Math.floor(total / 12);
  const m2 = (((total % 12) + 12) % 12) + 1;
  return toDay(`${y2}-${String(m2).padStart(2, "0")}-${String(Math.min(dom ?? d, monthLength(y2, m2))).padStart(2, "0")}`);
}

const FREQ: Record<string, number | undefined> = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };

function percentile(sorted: Float64Array | number[], q: number): number {
  const pos = ((sorted.length - 1) * q) / 100;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const round3 = (v: number) => Math.round(v * 1000) / 1000;

export class PreviewEngine {
  private today: number;
  private holidays: Set<number>;

  constructor(private data: EngineExport) {
    this.today = toDay(data.today);
    this.holidays = new Set(data.holidays.map(toDay));
  }

  private isBankHoliday(day: number) {
    const wd = weekday(day);
    return wd === 4 || wd === 5 || this.holidays.has(day);
  }

  private previousBusinessDay(day: number) {
    while (this.isBankHoliday(day)) day -= 1;
    return day;
  }

  private occurrences(ob: Obligation, end: number, shiftFirst = 0): number[] {
    const step = FREQ[ob.frequency];
    const firstDay = this.today + 1;
    const next = toDay(ob.next_due_date);
    if (step === undefined) {
      const d = Math.max(Math.max(next, firstDay) + shiftFirst, firstDay);
      return d <= end ? [d] : [];
    }
    const anchor = ymd(next)[2];
    const nth = (k: number) => this.previousBusinessDay(addMonths(next, step * k, anchor));
    let k = 0;
    let d = nth(0);
    while (d <= this.today) d = nth(++k);
    const occs: number[] = [];
    const limit = end + Math.abs(shiftFirst);
    while (d <= limit) {
      occs.push(d);
      d = nth(++k);
    }
    if (occs.length && shiftFirst) occs[0] = Math.max(firstDay, occs[0] + shiftFirst);
    return occs.filter((o) => o > this.today && o <= end).sort((a, b) => a - b);
  }

  run(adjustments: Adjustment[]): Forecast {
    const { sims } = this.data;
    const n = sims.n;
    const H = sims.horizon;
    const today = this.today;
    const end = today + H;
    const dayIndex = (day: number) => day - today - 1;

    const baseIn = Float64Array.from(sims.base_in);
    const baseOut = Float64Array.from(sims.base_out);
    for (const a of adjustments) {
      if (a.type !== "revenue_change" && a.type !== "expense_change") continue;
      const factor = Math.max(0, 1 + (a.pct ?? 0) / 100);
      const s = a.start_date ? toDay(a.start_date) : today + 1;
      const e = a.end_date ? toDay(a.end_date) : end;
      const target = a.type === "revenue_change" ? baseIn : baseOut;
      for (let h = 0; h < H; h++) {
        const d = today + 1 + h;
        if (d < s || d > e) continue;
        for (let i = 0; i < n; i++) target[i * H + h] *= factor;
      }
    }

    const detIn = new Float64Array(H);
    const detOut = new Float64Array(H);
    const recv = new Float64Array(n * H);
    const events: ForecastEvent[] = [];
    const ev = (d: number, kind: string, en: string, ar: string, amount: number, ref: string | null, extra: Partial<ForecastEvent> = {}) =>
      events.push({ date: toIso(d), kind, label_en: en, label_ar: ar, amount: round2(amount), ref, ...extra });

    const byType = (t: Adjustment["type"]) => adjustments.filter((a) => a.type === t);
    const delayShift = new Map(byType("delay_receivable").map((a) => [a.invoice_id!, a.days ?? 0]));
    const payableShift = new Map(byType("shift_payable").map((a) => [a.invoice_id!, a.days ?? 0]));
    const obligationShift = new Map(byType("shift_obligation").map((a) => [a.obligation_id!, a.days ?? 0]));
    const skipped = new Set(byType("skip_obligation").map((a) => a.obligation_id!));
    const writtenOff = new Set(byType("write_off_receivable").map((a) => a.invoice_id!));
    const collectOn = new Map(byType("expect_receivable").map((a) => [a.invoice_id!, a.date!]));

    // Receivables: the sampled payment days, shifted or pinned by the scenario.
    const receivableView: ReceivableForecast[] = [];
    for (const r of this.data.receivables) {
      if (r.outstanding <= 0 || writtenOff.has(r.id)) continue;
      const shift = delayShift.get(r.id) ?? 0;
      const expectedDate = collectOn.get(r.id) ?? r.expected_date;
      const payDays = new Int32Array(n);
      const paid = new Uint8Array(n);
      if (expectedDate) {
        payDays.fill(toDay(expectedDate) - today + shift);
        paid.fill(1);
      } else {
        const sample = sims.receivables[String(r.id)];
        if (!sample) continue;
        for (let i = 0; i < n; i++) {
          payDays[i] = sample.days[i] + shift;
          paid[i] = sample.paid.charCodeAt(i) === 49 ? 1 : 0;
        }
      }
      const inWindow: number[] = [];
      for (let i = 0; i < n; i++) {
        payDays[i] = Math.max(payDays[i], 1);
        if (paid[i] && payDays[i] <= H) {
          inWindow.push(payDays[i]);
          recv[i * H + payDays[i] - 1] += r.outstanding;
        }
      }
      const prob = inWindow.length / n;
      inWindow.sort((a, b) => a - b);
      const medianDay = inWindow.length ? Math.trunc(percentile(inWindow, 50)) : null;
      const expected = medianDay ? today + medianDay : null;
      const all = Array.from(payDays).sort((a, b) => a - b);
      receivableView.push({
        id: r.id,
        number: r.number,
        expected_date: expected !== null ? toIso(expected) : null,
        probability_in_horizon: round3(prob),
        p10_date: toIso(today + Math.trunc(percentile(all, 10))),
        p90_date: toIso(today + Math.trunc(percentile(all, 90))),
      });
      if (expected !== null && prob >= 0.2) {
        ev(expected, "receivable", `${r.counterparty} — ${r.number}`, `${r.counterparty_ar || r.counterparty} — ${r.number}`, r.outstanding, `invoice:${r.id}`, {
          probability: round3(prob),
        });
      }
    }

    // Payables: paid on the due date (or the planned date).
    for (const p of this.data.payables) {
      if (p.outstanding <= 0) continue;
      let d = toDay(p.expected_date ?? p.due_date) + (payableShift.get(p.id) ?? 0);
      if (d <= today) d = today + 1;
      if (d > end) continue;
      detOut[dayIndex(d)] += p.outstanding;
      ev(d, "payable", `${p.counterparty} — ${p.number}`, `${p.counterparty_ar || p.counterparty} — ${p.number}`, -p.outstanding, `invoice:${p.id}`);
    }

    // Obligations: payroll, rent, VAT, GOSI, zakat, loans.
    for (const ob of this.data.obligations) {
      if (skipped.has(ob.id)) continue;
      for (const d of this.occurrences(ob, end, obligationShift.get(ob.id) ?? 0)) {
        detOut[dayIndex(d)] += ob.amount;
        ev(d, ob.kind, ob.name, ob.name_ar || ob.name, -ob.amount, `obligation:${ob.id}`);
      }
    }

    // Scenario-only items.
    adjustments.forEach((a, k) => {
      const label = a.label ?? "";
      const add = (d: number, amount: number) => ((amount >= 0 ? detIn : detOut)[dayIndex(d)] += Math.abs(amount));
      if (a.type === "one_off" && a.date) {
        const d = toDay(a.date);
        const amount = a.amount ?? 0;
        if (d > today && d <= end) {
          add(d, amount);
          ev(d, "scenario", label || "One-off", label || "بند لمرة واحدة", amount, `adj:${k}`);
        }
      } else if (a.type === "recurring") {
        const start = a.start_date ? toDay(a.start_date) : today + 1;
        const amount = a.amount ?? 0;
        const step = a.frequency === "weekly" ? null : a.frequency === "quarterly" ? 3 : 1;
        const dom = ymd(start)[2];
        for (let i = 0, d = start; d <= end; i++, d = step === null ? start + 7 * i : addMonths(start, step * i, dom)) {
          if (d > today) {
            add(d, amount);
            ev(d, "scenario", label || "Recurring", label || "بند متكرر", amount, `adj:${k}`);
          }
        }
      } else if (a.type === "loan") {
        const d0 = a.date ? toDay(a.date) : today + 1;
        const principal = a.amount ?? 0;
        const months = Math.max(1, Math.trunc(a.months ?? 12));
        const r = (a.rate_pct ?? 0) / 100 / 12;
        const installment = r === 0 ? principal / months : (principal * r) / (1 - Math.pow(1 + r, -months));
        if (d0 > today && d0 <= end) {
          detIn[dayIndex(d0)] += principal;
          ev(d0, "scenario", label || "Financing drawdown", label || "سحب تمويل", principal, `adj:${k}`);
        }
        for (let m = 1; m <= months; m++) {
          const d = addMonths(d0, m);
          if (d > today && d <= end) {
            detOut[dayIndex(d)] += installment;
            ev(d, "scenario", `${label || "Financing"} — installment`, `${label || "التمويل"} — قسط`, -installment, `adj:${k}`);
          }
        }
      }
    });

    // Balances on every simulated path.
    const paths = new Float64Array(n * H);
    const meanIn = new Float64Array(H);
    const meanOut = new Float64Array(H);
    for (let i = 0; i < n; i++) {
      let bal = this.data.opening_balance;
      for (let h = 0; h < H; h++) {
        const inflow = baseIn[i * H + h] + recv[i * H + h] + detIn[h];
        const outflow = baseOut[i * H + h] + detOut[h];
        bal += inflow - outflow;
        paths[i * H + h] = bal;
        meanIn[h] += inflow / n;
        meanOut[h] += outflow / n;
      }
    }
    const p10 = new Float64Array(H);
    const p50 = new Float64Array(H);
    const p90 = new Float64Array(H);
    const col = new Float64Array(n);
    for (let h = 0; h < H; h++) {
      for (let i = 0; i < n; i++) col[i] = paths[i * H + h];
      col.sort();
      p10[h] = percentile(col, 10);
      p50[h] = percentile(col, 50);
      p90[h] = percentile(col, 90);
    }

    events.sort((a, b) => (a.date === b.date ? a.amount - b.amount : a.date < b.date ? -1 : 1));
    const byDay = new Map<string, ForecastEvent[]>();
    for (const e of events) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);

    const series: ForecastPoint[] = [];
    for (let h = 0; h < H; h++) {
      const date = toIso(today + 1 + h);
      series.push({ date, p10: round2(p10[h]), p50: round2(p50[h]), p90: round2(p90[h]), inflow: round2(meanIn[h]), outflow: round2(meanOut[h]), events: byDay.get(date) ?? [] });
    }

    const buffer = this.data.safety_buffer;
    let lowest = 0;
    for (let h = 1; h < H; h++) if (p50[h] < p50[lowest]) lowest = h;
    const first = (pred: (h: number) => boolean) => {
      for (let h = 0; h < H; h++) if (pred(h)) return h;
      return null;
    };
    const zero = first((h) => p50[h] < 0);
    const breach = first((h) => p50[h] < buffer);
    const risk = first((h) => p10[h] < 0);
    let negative = 0;
    let belowBuffer = 0;
    for (let i = 0; i < n; i++) {
      let min = Infinity;
      for (let h = 0; h < H; h++) min = Math.min(min, paths[i * H + h]);
      if (min < 0) negative++;
      if (min < buffer) belowBuffer++;
    }
    const sum = (a: Float64Array) => a.reduce((s, v) => s + v, 0);
    const day = (h: number | null) => (h === null ? null : toIso(today + 1 + h));
    const metrics: Metrics = {
      opening_balance: round2(this.data.opening_balance),
      ending_balance: round2(p50[H - 1]),
      ending_p10: round2(p10[H - 1]),
      ending_p90: round2(p90[H - 1]),
      lowest_balance: round2(p50[lowest]),
      lowest_date: day(lowest)!,
      lowest_p10: round2(Math.min(...p10)),
      cash_zero_date: day(zero),
      runway_days: zero === null ? null : zero + 1,
      buffer_breach_date: day(breach),
      risk_date: day(risk),
      shortfall_probability: round3(negative / n),
      buffer_breach_probability: round3(belowBuffer / n),
      total_inflow: round2(sum(meanIn)),
      total_outflow: round2(sum(meanOut)),
      net_change: round2(sum(meanIn) - sum(meanOut)),
      avg_daily_outflow: round2(sum(meanOut) / H),
      days_below_buffer: Array.from(p50).filter((v) => v < buffer).length,
      future_invoice_inflow: round2(sims.pipeline.receivable_payment ?? 0),
      future_bill_outflow: round2(sims.pipeline.supplier_payment ?? 0),
      safety_buffer: buffer,
      horizon: H,
    };
    return {
      as_of: this.data.today,
      horizon: H,
      series,
      metrics,
      model: { ...this.data.model, simulations: n },
      receivables: receivableView,
      history: this.data.history,
    };
  }

  /** Same shape as POST /api/scenarios/preview. */
  compare(adjustments: Adjustment[]): ScenarioResult {
    const baseline = this.run([]);
    const scenario = this.run(adjustments);
    const bm = baseline.metrics;
    const sm = scenario.metrics;
    const keys = ["lowest_balance", "ending_balance", "shortfall_probability", "buffer_breach_probability", "net_change", "total_inflow", "total_outflow", "days_below_buffer"] as const;
    const delta: Record<string, number | null> = Object.fromEntries(keys.map((k) => [k, round2((sm[k] as number) - (bm[k] as number))]));
    const H = this.data.sims.horizon;
    delta.runway_days = bm.runway_days === null && sm.runway_days === null ? null : (sm.runway_days ?? H + 1) - (bm.runway_days ?? H + 1);
    return { baseline, scenario, delta, history: this.data.history };
  }
}
