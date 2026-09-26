import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Banknote,
  BadgeCheck,
  CalendarClock,
  FlaskConical,
  Gauge,
  Hourglass,
  Landmark,
  Lightbulb,
  Percent,
  ReceiptText,
  RefreshCw,
  Sparkles,
  TrendingDown,
} from "lucide-react";
import { api } from "../api/client";
import type { Dashboard, ForecastEvent, Severity } from "../api/types";
import { useI18n } from "../i18n";
import { useToast } from "../lib/toast";
import { relTime } from "../lib/util";
import { BalanceChart, BalanceLegend, BalanceTable } from "../components/charts/BalanceChart";
import { WeeklyFlows, WeeklyLegend, WeeklyTable } from "../components/charts/WeeklyFlows";
import { ChartCard, Empty, ErrorState, Loading, Money, Segmented, SeverityBadge, SeverityIcon } from "../components/ui";

const EVENT_ICONS: Record<string, typeof Banknote> = {
  payroll: Banknote,
  vat: ReceiptText,
  rent: Landmark,
  gosi: BadgeCheck,
  zakat: ReceiptText,
  loan: Landmark,
  payable: ReceiptText,
};

function riskSeverity(p: number): Severity {
  return p >= 0.5 ? "critical" : p >= 0.2 ? "serious" : p >= 0.05 ? "warning" : "good";
}

export function DashboardPage() {
  const { t, f, pick } = useI18n();
  const [horizon, setHorizon] = useState(90);
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ["dashboard", horizon],
    queryFn: () => api<Dashboard>(`/dashboard?horizon=${horizon}`),
    placeholderData: keepPreviousData,
  });
  const sync = useMutation({
    mutationFn: () => api<{ transactions_added: number; invoices_added: number }>("/integrations/sync-all", { method: "POST" }),
    onSuccess: (r) => {
      toast(t("integrations.syncedToast", { tx: r.transactions_added, inv: r.invoices_added }));
      qc.invalidateQueries();
    },
    onError: (e) => toast(e instanceof Error ? e.message : t("common.error"), true),
  });

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <div className="page"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  const d = q.data;

  if (!d.has_data) {
    return (
      <div className="page">
        <div className="card">
          <Empty icon={<Landmark />} title={t("dashboard.noData")}>
            <p style={{ maxWidth: 420 }}>{t("dashboard.noDataSub")}</p>
            <Link className="btn primary" to="/onboarding">
              {t("dashboard.connect")}
            </Link>
          </Empty>
        </div>
      </div>
    );
  }

  const m = d.forecast.metrics;
  const buffer = d.company.min_cash_buffer;
  const risk = riskSeverity(m.shortfall_probability);
  const busy = q.isFetching && !q.isLoading;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{t("dashboard.title")}</h1>
          <p>{t("dashboard.subtitle")}</p>
        </div>
        <div className="row">
          <Segmented
            label={t("dashboard.horizon")}
            value={horizon}
            onChange={setHorizon}
            options={[30, 60, 90].map((v) => ({ value: v, label: `${v} ${t("common.days")}` }))}
          />
          <button className="btn sm" onClick={() => sync.mutate()} disabled={sync.isPending} title={t("common.synced", { time: relTime(d.connections.last_synced_at, t) })}>
            <RefreshCw size={15} className={sync.isPending ? "spin" : undefined} />
            {t("common.syncNow")}
          </button>
        </div>
      </div>

      <section className={`card hero-card${busy ? " refetching" : ""}`} aria-label={t("dashboard.cashOnHand")}>
        <div className="hero">
          <span className="label">{t("dashboard.cashOnHand")}</span>
          <span className="value" data-testid="cash-on-hand">
            <bdi>{f.number(d.balance)}</bdi>
            <span className="cur">{f.currency}</span>
          </span>
          <span className="small muted">
            {t("dashboard.acrossAccounts", { n: d.accounts.length })} · {t("common.synced", { time: relTime(d.connections.last_synced_at, t) })}
          </span>
          <div className="accounts">
            {d.accounts.map((a) => (
              <div className="acct" key={a.id}>
                <span>
                  {pick(a.bank_name, a.bank_name_ar)} <span className="muted num">•••• {a.iban_masked?.slice(-4)}</span>
                </span>
                <Money value={a.balance} />
              </div>
            ))}
          </div>
        </div>
        <div className="kpis">
          <div className="kpi">
            <span className="label">
              <Hourglass size={15} aria-hidden="true" />
              {t("dashboard.runway")}
            </span>
            <span className="value">
              {m.runway_days !== null ? (
                <>
                  {m.runway_days}
                  <span className="unit">{t("common.days")}</span>
                </>
              ) : (
                t("dashboard.runwayOk", { n: m.horizon })
              )}
            </span>
            <span className="note">{m.runway_days !== null ? t("dashboard.runwayNote") : t("dashboard.runwayNoteOk")}</span>
            {m.runway_days !== null && m.runway_days <= 30 && <SeverityBadge severity="critical" />}
          </div>
          <div className="kpi">
            <span className="label">
              <TrendingDown size={15} aria-hidden="true" />
              {t("dashboard.lowest")}
            </span>
            <span className="value">
              <Money value={m.lowest_balance} compact />
            </span>
            <span className="note">{t("dashboard.lowestOn", { date: f.date(m.lowest_date, "weekday") })}</span>
            {m.lowest_balance < buffer && (
              <span className={`badge ${m.lowest_balance < 0 ? "critical" : "serious"}`} style={{ alignSelf: "flex-start" }}>
                {t("dashboard.buffer")} · {f.money(buffer, { compact: true })}
              </span>
            )}
          </div>
          <div className="kpi">
            <span className="label">
              <Percent size={15} aria-hidden="true" />
              {t("dashboard.risk")}
            </span>
            <span className="value">{f.pct(m.shortfall_probability)}</span>
            <span className="note">{t("dashboard.riskNote", { n: m.horizon })}</span>
            <span style={{ alignSelf: "flex-start" }}>
              <SeverityBadge severity={risk} />
            </span>
          </div>
          <div className="kpi">
            <span className="label">
              <ReceiptText size={15} aria-hidden="true" />
              {t("dashboard.overdue")}
            </span>
            <span className="value">
              <Money value={d.receivables.overdue_total} compact />
            </span>
            <span className="note">
              {t("dashboard.overdueNote", { n: d.receivables.overdue_count })} · {t("dashboard.receivablesOpen")} {f.money(d.receivables.open_total, { compact: true })}
            </span>
          </div>
        </div>
      </section>

      <div className="grid main-side">
        <div className="stack" style={{ gap: 16 }}>
          <ChartCard
            title={t("dashboard.forecastTitle")}
            sub={t("dashboard.forecastSub")}
            busy={busy}
            chart={
              <BalanceChart
                history={d.forecast.history}
                forecast={d.forecast.series}
                buffer={buffer}
                height={320}
                ariaLabel={`${t("dashboard.forecastTitle")}: ${t("dashboard.lowest")} ${f.money(m.lowest_balance)} ${t("dashboard.lowestOn", { date: f.date(m.lowest_date) })}`}
              />
            }
            table={<BalanceTable history={d.forecast.history} forecast={d.forecast.series} />}
            legend={<BalanceLegend />}
          />
          <ChartCard
            title={t("dashboard.weekly")}
            sub={t("dashboard.weeklySub")}
            busy={busy}
            chart={<WeeklyFlows series={d.forecast.series} ariaLabel={t("dashboard.weekly")} />}
            table={<WeeklyTable series={d.forecast.series} />}
            legend={<WeeklyLegend />}
          />
          <ModelCard d={d} />
        </div>

        <div className="stack" style={{ gap: 16 }}>
          <section className="card" aria-labelledby="insights-h">
            <div className="card-header">
              <div className="card-title">
                <Sparkles size={18} aria-hidden="true" style={{ color: "var(--brand)" }} />
                <div>
                  <h2 id="insights-h">{t("dashboard.insights")}</h2>
                  <div className="sub">{t("dashboard.insightsSub")}</div>
                </div>
              </div>
            </div>
            <div className="list">
              {d.insights.map((i, k) => (
                <div className="list-item" key={k}>
                  <SeverityIcon severity={i.severity} />
                  <div className="body small ink-2" style={{ color: "var(--ink)" }}>
                    {pick(i.text_en, i.text_ar)}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {d.suggestions.length > 0 && (
            <section className="card" aria-labelledby="actions-h">
              <div className="card-header">
                <div className="card-title">
                  <Lightbulb size={18} aria-hidden="true" style={{ color: "var(--brand)" }} />
                  <div>
                    <h2 id="actions-h">{t("dashboard.actions")}</h2>
                    <div className="sub">{t("dashboard.actionsSub")}</div>
                  </div>
                </div>
              </div>
              <div className="list">
                {d.suggestions.map((s, k) => (
                  <div className="list-item" key={k}>
                    <div className="body">
                      <div className="title small">{pick(s.title_en, s.title_ar)}</div>
                      <div className="row" style={{ marginTop: 8, gap: 6 }}>
                        <span className="badge good">{t("dashboard.impactLowest", { value: f.money(s.impact.lowest_balance_change, { compact: true, sign: true }) })}</span>
                        <span className="badge">
                          {t("dashboard.impactRisk", { value: `${f.pct(m.shortfall_probability)} → ${f.pct(s.impact.shortfall_probability)}` })}
                        </span>
                      </div>
                    </div>
                    <button
                      className="btn sm"
                      onClick={() => nav("/scenarios", { state: { adjustments: s.adjustments, name: pick(s.title_en, s.title_ar) } })}
                    >
                      <FlaskConical size={15} />
                      {t("dashboard.openInPlanner")}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          <UpcomingCard events={d.upcoming} />

          <section className="card">
            <div className="card-header">
              <h2>{t("dashboard.alertsTitle")}</h2>
              <Link to="/alerts" className="btn ghost sm">
                {t("dashboard.viewAll")}
                <ArrowUpRight size={14} className="flip-rtl" />
              </Link>
            </div>
            {d.alerts.length === 0 ? (
              <p className="small muted">{t("dashboard.emptyAlerts")}</p>
            ) : (
              <div className="list">
                {d.alerts.slice(0, 3).map((a) => (
                  <div className="list-item" key={a.id}>
                    <SeverityIcon severity={a.severity} />
                    <div className="body">
                      <div className="title small">{pick(a.title_en, a.title_ar)}</div>
                      <div className="desc">{pick(a.body_en, a.body_ar)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function UpcomingCard({ events }: { events: ForecastEvent[] }) {
  const { t, f, pick } = useI18n();
  return (
    <section className="card">
      <div className="card-header">
        <div className="card-title">
          <CalendarClock size={18} aria-hidden="true" style={{ color: "var(--brand)" }} />
          <div>
            <h2>{t("dashboard.upcoming")}</h2>
            <div className="sub">{t("dashboard.upcomingSub")}</div>
          </div>
        </div>
      </div>
      <div className="list">
        {events.map((e, i) => {
          const Icon = EVENT_ICONS[e.kind] ?? ReceiptText;
          // Supplier bills are labelled "Counterparty — BILL-…": show the name, move the number down.
          const [name, ref] = pick(e.label_en, e.label_ar).split(" — ");
          return (
            <div className="list-item" key={i} style={{ alignItems: "center" }}>
              <span className="status-icon" style={{ background: "var(--surface-3)", color: "var(--ink-2)" }} aria-hidden="true">
                <Icon size={16} />
              </span>
              <div className="body">
                <div className="title small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {name}
                </div>
                <div className="desc nowrap" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                  {f.date(e.date, "weekday")} · {ref ? <bdi>{ref}</bdi> : t(`events.${e.kind}`)}
                </div>
              </div>
              <Money value={e.amount} className="small strong" />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ModelCard({ d }: { d: Dashboard }) {
  const { t, f } = useI18n();
  const model = d.forecast.model;
  const drivers = Object.entries(model.sales_drivers)
    .filter(([k, v]) => ["ramadan", "last_ten_ramadan", "white_friday", "national_day", "payday", "pre_eid_adha", "founding_day"].includes(k) && Math.abs(v) >= 0.04)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const bt = d.backtest;
  return (
    <section className="card">
      <div className="card-header">
        <div className="card-title">
          <Gauge size={18} aria-hidden="true" style={{ color: "var(--brand)" }} />
          <h2>{t("dashboard.model")}</h2>
        </div>
      </div>
      <div className="grid cols-3" style={{ gap: 20 }}>
        <div className="stack" style={{ gap: 4 }}>
          <span className="small ink-2">{t("dashboard.accuracy")}</span>
          <span style={{ fontSize: 30, fontWeight: 600 }}>{bt?.accuracy != null ? f.pct(bt.accuracy, 1) : "—"}</span>
          <span className="xsmall muted">{t("dashboard.accuracyNote", { days: bt?.days ?? 30 })}</span>
          {bt && bt.excluded_discretionary > 0 && (
            <span className="xsmall muted">{t("dashboard.discretionaryNote", { amount: f.money(bt.excluded_discretionary, { compact: true }) })}</span>
          )}
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <span className="small ink-2">{t("dashboard.simulations", { n: f.number(model.simulations) })}</span>
          <span className="small ink-2">{t("dashboard.training", { n: model.training_days })}</span>
          <span className="xsmall muted">
            {t("dashboard.inflow")} {f.money(d.forecast.metrics.total_inflow, { compact: true })} · {t("dashboard.outflow")}{" "}
            {f.money(d.forecast.metrics.total_outflow, { compact: true })}
          </span>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <span className="small ink-2">{t("dashboard.learned")}</span>
          {drivers.length === 0 && <span className="xsmall muted">—</span>}
          {drivers.map(([k, v]) => (
            <div key={k} className="row between small">
              <span>{t(`drivers.${k}`)}</span>
              <span className="num" style={{ fontWeight: 600 }}>
                <bdi>{v > 0 ? "+" : ""}{f.pct(v)}</bdi>
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
