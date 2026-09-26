import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  Copy,
  FlaskConical,
  HandCoins,
  Landmark,
  Minus,
  Percent,
  Plus,
  Save,
  Trash,
  TrendingDown,
  UserPlus,
  X,
} from "lucide-react";
import { api } from "../api/client";
import type { Adjustment, Invoice, Obligation, Scenario, ScenarioResult } from "../api/types";
import { useI18n } from "../i18n";
import { useToast } from "../lib/toast";
import { addDays, todayRiyadh } from "../lib/util";
import { BalanceChart, BalanceLegend, BalanceTable } from "../components/charts/BalanceChart";
import { ChartCard, Empty, Loading } from "../components/ui";

type AdjType = Adjustment["type"];
const TYPES: AdjType[] = [
  "delay_receivable",
  "expect_receivable",
  "write_off_receivable",
  "shift_payable",
  "shift_obligation",
  "skip_obligation",
  "revenue_change",
  "expense_change",
  "one_off",
  "recurring",
  "loan",
];
const ICONS: Record<AdjType, typeof Plus> = {
  delay_receivable: CalendarClock,
  expect_receivable: CalendarClock,
  write_off_receivable: X,
  shift_payable: CalendarClock,
  shift_obligation: CalendarClock,
  skip_obligation: Minus,
  revenue_change: Percent,
  expense_change: Percent,
  one_off: HandCoins,
  recurring: UserPlus,
  loan: Landmark,
};

interface Draft {
  id: number | null;
  name: string;
  description: string;
  adjustments: Adjustment[];
}

function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

const todayIso = todayRiyadh;

function nextMonthFirst(): string {
  const [y, m] = todayRiyadh().split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

export function ScenariosPage() {
  const { t, f, pick } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const location = useLocation();
  const incoming = location.state as { adjustments?: Adjustment[]; name?: string; openScenario?: string } | null;

  const scenarios = useQuery({ queryKey: ["scenarios"], queryFn: () => api<Scenario[]>("/scenarios") });
  const receivables = useQuery({ queryKey: ["invoices", "receivable", "open"], queryFn: () => api<Invoice[]>("/invoices?kind=receivable&status=open") });
  const payables = useQuery({ queryKey: ["invoices", "payable", "open"], queryFn: () => api<Invoice[]>("/invoices?kind=payable&status=open") });
  const obligations = useQuery({ queryKey: ["obligations"], queryFn: () => api<Obligation[]>("/obligations") });

  const [draft, setDraft] = useState<Draft | null>(
    incoming?.adjustments ? { id: null, name: incoming.name ?? "", description: "", adjustments: incoming.adjustments } : null,
  );
  const [horizon] = useState(90);
  const applied = useRef<string | null>(null);

  // Suggestions and guided stories open the planner with a scenario to show.
  useEffect(() => {
    if (!incoming || applied.current === location.key) return;
    if (incoming.adjustments) {
      applied.current = location.key;
      setDraft({ id: null, name: incoming.name ?? "", description: "", adjustments: incoming.adjustments });
    } else if (incoming.openScenario && scenarios.data) {
      applied.current = location.key;
      const s = scenarios.data.find((x) => x.name.includes(incoming.openScenario!));
      if (s) setDraft({ id: s.id, name: s.name, description: s.description ?? "", adjustments: s.adjustments });
    }
  }, [location.key, incoming, scenarios.data]);

  useEffect(() => {
    if (!draft && scenarios.data && !incoming?.openScenario) {
      const s = scenarios.data[0];
      setDraft(s ? { id: s.id, name: s.name, description: s.description ?? "", adjustments: s.adjustments } : { id: null, name: "", description: "", adjustments: [] });
    }
  }, [draft, scenarios.data, incoming]);

  const debounced = useDebounced(draft?.adjustments ?? [], 350);
  const preview = useQuery({
    queryKey: ["scenario-preview", JSON.stringify(debounced), horizon],
    queryFn: () => api<ScenarioResult>("/scenarios/preview", { method: "POST", body: { adjustments: debounced, horizon } }),
    enabled: !!draft,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const save = useMutation({
    mutationFn: async (asNew: boolean) => {
      if (!draft) return null;
      const body = { name: draft.name || t("scenarios.untitled"), description: draft.description || null, adjustments: draft.adjustments };
      if (draft.id && !asNew) return api<Scenario>(`/scenarios/${draft.id}`, { method: "PUT", body });
      return api<Scenario>("/scenarios", { method: "POST", body });
    },
    onSuccess: (s) => {
      if (s) setDraft({ id: s.id, name: s.name, description: s.description ?? "", adjustments: s.adjustments });
      qc.invalidateQueries({ queryKey: ["scenarios"] });
      toast(t("scenarios.savedToast"));
    },
    onError: (e) => toast(e instanceof Error ? e.message : t("common.error"), true),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api(`/scenarios/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setDraft(null);
      qc.invalidateQueries({ queryKey: ["scenarios"] });
    },
  });

  const defaults = useMemo(() => {
    const rec = receivables.data?.[0];
    const pay = payables.data?.[0];
    const ob = obligations.data?.find((o) => o.kind === "vat") ?? obligations.data?.[0];
    const base = todayIso();
    return (type: AdjType): Adjustment => {
      switch (type) {
        case "delay_receivable":
          return { type, invoice_id: rec?.id, days: 15 };
        case "expect_receivable":
          return { type, invoice_id: rec?.id, date: addDays(base, 7) };
        case "write_off_receivable":
          return { type, invoice_id: rec?.id };
        case "shift_payable":
          return { type, invoice_id: pay?.id, days: 14 };
        case "shift_obligation":
          return { type, obligation_id: ob?.id, days: 7 };
        case "skip_obligation":
          return { type, obligation_id: ob?.id };
        case "revenue_change":
          return { type, pct: -20, start_date: addDays(base, 1), end_date: addDays(base, 30) };
        case "expense_change":
          return { type, pct: 10 };
        case "one_off":
          return { type, date: addDays(base, 14), amount: -80_000, label: "" };
        case "recurring":
          return { type, start_date: nextMonthFirst(), amount: -18_000, frequency: "monthly", label: "" };
        case "loan":
          return { type, date: addDays(base, 7), amount: 200_000, months: 12, rate_pct: 7.5, label: "" };
      }
    };
  }, [receivables.data, payables.data, obligations.data]);

  if (scenarios.isLoading || !draft) return <Loading />;

  const setAdj = (i: number, patch: Partial<Adjustment>) =>
    setDraft((d) => (d ? { ...d, adjustments: d.adjustments.map((a, k) => (k === i ? { ...a, ...patch } : a)) } : d));
  const addAdj = (a: Adjustment) => setDraft((d) => (d ? { ...d, adjustments: [...d.adjustments, a] } : d));
  const removeAdj = (i: number) => setDraft((d) => (d ? { ...d, adjustments: d.adjustments.filter((_, k) => k !== i) } : d));

  const r = preview.data;
  const bm = r?.baseline.metrics;
  const sm = r?.scenario.metrics;

  const invoiceLabel = (i: Invoice) =>
    `${i.number} · ${pick(i.counterparty, i.counterparty_ar)} · ${f.money(i.outstanding, { compact: true })} · ${f.date(i.due_date)}`;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{t("scenarios.title")}</h1>
          <p>{t("scenarios.subtitle")}</p>
        </div>
        <button className="btn" onClick={() => setDraft({ id: null, name: "", description: "", adjustments: [] })}>
          <Plus size={16} />
          {t("scenarios.newScenario")}
        </button>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "minmax(0, 280px) minmax(0, 1fr)", alignItems: "start" }} data-layout="scenarios">
        <aside className="card" style={{ padding: 14 }}>
          <h3 style={{ padding: "4px 4px 10px" }}>{t("scenarios.saved")}</h3>
          <div className="scenario-list">
            {scenarios.data?.map((s) => (
              <button
                key={s.id}
                className="scenario-item"
                aria-current={draft.id === s.id}
                onClick={() => setDraft({ id: s.id, name: s.name, description: s.description ?? "", adjustments: s.adjustments })}
              >
                <strong className="small">{s.name}</strong>
                {s.description && <span className="d">{s.description}</span>}
              </button>
            ))}
            {!scenarios.data?.length && <p className="small muted" style={{ padding: 4 }}>—</p>}
          </div>
        </aside>

        <div className="stack" style={{ gap: 16 }}>
          <section className="card">
            <div className="form-grid" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.4fr)" }}>
              <label className="field">
                <span>{t("scenarios.name")}</span>
                <input className="input" dir="auto" value={draft.name} placeholder={t("scenarios.untitled")} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </label>
              <label className="field">
                <span>
                  {t("scenarios.description")} <span className="muted">({t("common.optional")})</span>
                </span>
                <input className="input" dir="auto" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </label>
            </div>

            <div className="row between" style={{ margin: "20px 0 10px" }}>
              <h3>{t("scenarios.adjustments")}</h3>
              <label className="row small" style={{ gap: 6 }}>
                <select
                  className="select sm"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) addAdj(defaults(e.target.value as AdjType));
                    e.target.value = "";
                  }}
                  aria-label={t("scenarios.addChange")}
                  style={{ width: "auto" }}
                >
                  <option value="">＋ {t("scenarios.addChange")}</option>
                  {TYPES.map((ty) => (
                    <option key={ty} value={ty}>
                      {t(`scenarios.types.${ty}`)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="stack">
              {draft.adjustments.length === 0 && (
                <div className="callout">
                  <FlaskConical size={18} style={{ flex: "none", marginTop: 2 }} />
                  <div className="stack" style={{ gap: 10 }}>
                    <span className="small">{t("scenarios.noChanges")}</span>
                    <div className="row" style={{ gap: 6 }}>
                      <span className="xsmall muted">{t("scenarios.presets")}:</span>
                      <button className="btn sm" onClick={() => addAdj({ ...defaults("recurring"), label: t("scenarios.presetHire") })}>
                        {t("scenarios.presetHire")}
                      </button>
                      <button className="btn sm" onClick={() => addAdj(defaults("revenue_change"))}>
                        {t("scenarios.presetDip")}
                      </button>
                      <button className="btn sm" onClick={() => addAdj({ ...defaults("one_off"), label: t("scenarios.presetStock") })}>
                        {t("scenarios.presetStock")}
                      </button>
                      <button className="btn sm" onClick={() => addAdj({ ...defaults("loan"), label: "Kafalah" })}>
                        {t("scenarios.presetLoan")}
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {draft.adjustments.map((a, i) => {
                const Icon = ICONS[a.type];
                const invoices = a.type === "shift_payable" ? payables.data : receivables.data;
                return (
                  <div className="adj" key={i}>
                    <span className="adj-icon">
                      <Icon size={16} />
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <strong className="small">{t(`scenarios.types.${a.type}`)}</strong>
                      <div className="adj-fields">
                        {"invoice_id" in defaults(a.type) && (
                          <label className="field" style={{ gridColumn: "1 / -1" }}>
                            <span>{a.type === "shift_payable" ? t("scenarios.fields.bill") : t("scenarios.fields.invoice")}</span>
                            <select className="select sm" value={a.invoice_id ?? ""} onChange={(e) => setAdj(i, { invoice_id: Number(e.target.value), label: invoices?.find((x) => x.id === Number(e.target.value))?.number })}>
                              {invoices?.map((inv) => (
                                <option key={inv.id} value={inv.id}>
                                  {invoiceLabel(inv)}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        {"obligation_id" in defaults(a.type) && (
                          <label className="field" style={{ gridColumn: "1 / -1" }}>
                            <span>{t("scenarios.fields.obligation")}</span>
                            <select className="select sm" value={a.obligation_id ?? ""} onChange={(e) => setAdj(i, { obligation_id: Number(e.target.value) })}>
                              {obligations.data?.map((o) => (
                                <option key={o.id} value={o.id}>
                                  {pick(o.name, o.name_ar)} · {f.money(o.amount, { compact: true })} · {o.next_payment_date ? f.date(o.next_payment_date) : "—"}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        {a.days !== undefined && (
                          <label className="field">
                            <span>{a.type === "shift_obligation" ? t("scenarios.fields.daysShift") : t("scenarios.fields.days")}</span>
                            <input className="input sm num" type="number" value={a.days} min={-60} max={120} onChange={(e) => setAdj(i, { days: Number(e.target.value) })} />
                          </label>
                        )}
                        {a.pct !== undefined && (
                          <label className="field">
                            <span>{t("scenarios.fields.pct")}</span>
                            <input className="input sm num" type="number" value={a.pct} min={-100} max={300} onChange={(e) => setAdj(i, { pct: Number(e.target.value) })} />
                          </label>
                        )}
                        {(a.type === "revenue_change" || a.type === "expense_change") && (
                          <>
                            <label className="field">
                              <span>{t("scenarios.fields.from")}</span>
                              <input className="input sm" type="date" value={a.start_date ?? ""} onChange={(e) => setAdj(i, { start_date: e.target.value || undefined })} />
                            </label>
                            <label className="field">
                              <span>{t("scenarios.fields.to")}</span>
                              <input className="input sm" type="date" value={a.end_date ?? ""} onChange={(e) => setAdj(i, { end_date: e.target.value || undefined })} />
                            </label>
                          </>
                        )}
                        {a.date !== undefined && (
                          <label className="field">
                            <span>{t("scenarios.fields.date")}</span>
                            <input className="input sm" type="date" value={a.date} onChange={(e) => setAdj(i, { date: e.target.value })} />
                          </label>
                        )}
                        {a.type === "recurring" && (
                          <label className="field">
                            <span>{t("scenarios.fields.start")}</span>
                            <input className="input sm" type="date" value={a.start_date ?? ""} onChange={(e) => setAdj(i, { start_date: e.target.value })} />
                          </label>
                        )}
                        {a.amount !== undefined && (
                          <label className="field">
                            <span>
                              {a.type === "loan" ? t("scenarios.fields.principal") : a.type === "recurring" ? t("scenarios.fields.monthly") : t("scenarios.fields.amount")}
                            </span>
                            <input className="input sm num" type="number" step={1000} value={a.amount} onChange={(e) => setAdj(i, { amount: Number(e.target.value) })} />
                          </label>
                        )}
                        {a.type === "loan" && (
                          <>
                            <label className="field">
                              <span>{t("scenarios.fields.months")}</span>
                              <input className="input sm num" type="number" min={1} max={120} value={a.months ?? 12} onChange={(e) => setAdj(i, { months: Number(e.target.value) })} />
                            </label>
                            <label className="field">
                              <span>{t("scenarios.fields.rate")}</span>
                              <input className="input sm num" type="number" step={0.5} min={0} max={50} value={a.rate_pct ?? 0} onChange={(e) => setAdj(i, { rate_pct: Number(e.target.value) })} />
                            </label>
                          </>
                        )}
                        {(a.type === "one_off" || a.type === "recurring" || a.type === "loan") && (
                          <label className="field">
                            <span>{t("scenarios.fields.label")}</span>
                            <input className="input sm" dir="auto" value={a.label ?? ""} maxLength={120} onChange={(e) => setAdj(i, { label: e.target.value })} />
                          </label>
                        )}
                      </div>
                    </div>
                    <button className="btn ghost icon sm" onClick={() => removeAdj(i)} aria-label={t("common.remove")}>
                      <X size={16} />
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="row" style={{ marginTop: 18, justifyContent: "flex-end" }}>
              {draft.id && (
                <button className="btn danger sm" onClick={() => window.confirm(t("scenarios.deleteConfirm")) && remove.mutate(draft.id!)}>
                  <Trash size={15} />
                  {t("common.delete")}
                </button>
              )}
              {draft.id && (
                <button className="btn sm" onClick={() => save.mutate(true)} disabled={save.isPending}>
                  <Copy size={15} />
                  {t("scenarios.saveAs")}
                </button>
              )}
              <button className="btn primary sm" onClick={() => save.mutate(false)} disabled={save.isPending}>
                <Save size={15} />
                {save.isPending ? t("common.saving") : t("scenarios.save")}
              </button>
            </div>
          </section>

          {preview.error && (
            <div className={`callout small ${(preview.error as { status?: number }).status === 418 ? "brand" : "critical"}`}>
              {(preview.error as { status?: number }).status === 418 ? t("preview.scenarioMiss") : (preview.error as Error).message}
            </div>
          )}

          {r && bm && sm ? (
            <>
              <section className={`grid cols-3${preview.isFetching ? " refetching" : ""}`} style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }} aria-label={t("scenarios.impact")}>
                <DeltaTile label={t("scenarios.lowest")} base={bm.lowest_balance} value={sm.lowest_balance} kind="money" goodWhenUp />
                <DeltaTile label={t("scenarios.risk")} base={bm.shortfall_probability} value={sm.shortfall_probability} kind="pct" goodWhenUp={false} />
                <DeltaTile label={t("scenarios.belowBuffer")} base={bm.days_below_buffer} value={sm.days_below_buffer} kind="days" goodWhenUp={false} />
                <DeltaTile label={t("scenarios.ending", { n: horizon })} base={bm.ending_balance} value={sm.ending_balance} kind="money" goodWhenUp />
              </section>
              <ChartCard
                title={t("scenarios.compare")}
                busy={preview.isFetching}
                chart={
                  <BalanceChart
                    history={r.history}
                    forecast={r.baseline.series}
                    scenario={r.scenario.series}
                    buffer={bm.safety_buffer}
                    height={320}
                    ariaLabel={`${t("scenarios.compare")}: ${t("scenarios.lowest")} ${f.money(bm.lowest_balance)} → ${f.money(sm.lowest_balance)}`}
                  />
                }
                table={<BalanceTable history={r.history} forecast={r.baseline.series} scenario={r.scenario.series} />}
                legend={<BalanceLegend scenario />}
              />
            </>
          ) : preview.isLoading ? (
            <Loading />
          ) : (
            <Empty icon={<TrendingDown />} title={t("scenarios.noChanges")} />
          )}
        </div>
      </div>
    </div>
  );
}

function DeltaTile({ label, base, value, kind, goodWhenUp }: { label: string; base: number; value: number; kind: "money" | "pct" | "days"; goodWhenUp: boolean }) {
  const { t, f } = useI18n();
  const diff = value - base;
  const fmt = (v: number, sign = false) => {
    if (kind === "money") return f.money(v, { compact: true, sign });
    const s = sign && v > 0 ? "+" : "";
    if (kind === "pct") return sign ? `${s}${Math.round(v * 100)} ${t("scenarios.pp")}` : f.pct(v);
    return `${s}${f.number(v)} ${t("common.days")}`;
  };
  const flat = kind === "pct" ? Math.abs(diff) < 0.005 : Math.abs(diff) < (kind === "money" ? 500 : 0.5);
  const good = diff > 0 === goodWhenUp;
  const cls = flat ? "flat" : good ? "up" : "down";
  const Arrow = diff > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="delta">
      <span className="k">{label}</span>
      <span className="v">
        <bdi>{fmt(value)}</bdi>
      </span>
      <span className={`d ${cls}`}>
        {flat ? (
          t("scenarios.noChange")
        ) : (
          <>
            <Arrow size={14} aria-hidden="true" />
            <bdi>{fmt(diff, true)}</bdi>
          </>
        )}
      </span>
      <span className="xsmall muted">
        {t("scenarios.baseline")} <bdi>{fmt(base)}</bdi>
      </span>
    </div>
  );
}
