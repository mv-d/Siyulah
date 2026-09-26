import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { api } from "../api/client";
import type { CategoryBreakdown, CategoryTotal, TransactionItem } from "../api/types";
import { useI18n } from "../i18n";
import { ErrorState, Loading, Money, Segmented } from "../components/ui";

const PAGE = 25;

export function ActivityPage() {
  const { t, f, pick } = useI18n();
  const [days, setDays] = useState(30);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const cats = useQuery({
    queryKey: ["categories", days],
    queryFn: () => api<CategoryBreakdown>(`/transactions/categories?days=${days}`),
    placeholderData: keepPreviousData,
  });
  const params = new URLSearchParams({ limit: String(limit) });
  if (q) params.set("q", q);
  if (category) params.set("category", category);
  const tx = useQuery({
    queryKey: ["transactions", params.toString()],
    queryFn: () => api<{ total: number; items: TransactionItem[] }>(`/transactions?${params.toString()}`),
    placeholderData: keepPreviousData,
  });

  if (cats.isLoading) return <Loading />;
  if (cats.error || !cats.data) return <div className="page"><ErrorState error={cats.error} onRetry={() => cats.refetch()} /></div>;
  const c = cats.data;
  const ins = c.items.filter((i) => i.amount > 0).sort((a, b) => b.amount - a.amount);
  const outs = c.items.filter((i) => i.amount < 0).sort((a, b) => a.amount - b.amount);
  const labels = Object.fromEntries(c.items.map((i) => [i.category, i]));

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{t("activity.title")}</h1>
          <p>{t("activity.subtitle")}</p>
        </div>
        <Segmented
          label={t("activity.period")}
          value={days}
          onChange={setDays}
          options={[30, 90].map((v) => ({ value: v, label: `${v} ${t("common.days")}` }))}
        />
      </div>

      <section className={`card${cats.isFetching ? " refetching" : ""}`} style={{ padding: 0 }}>
        <div className="kpis" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
          <Total label={t("activity.totalIn")} value={c.inflow} prior={c.prior_inflow} days={days} upIsGood />
          <Total label={t("activity.totalOut")} value={c.outflow} prior={c.prior_outflow} days={days} upIsGood={false} />
          <div className="kpi">
            <span className="label">{t("activity.net")}</span>
            <span className="value"><Money value={c.inflow - c.outflow} compact sign /></span>
            <span className="note">
              {f.date(c.since)} – {f.date(c.until)}
            </span>
          </div>
        </div>
      </section>

      <div className={`grid cols-2${cats.isFetching ? " refetching" : ""}`} style={{ alignItems: "start" }}>
        <CategoryCard title={t("activity.moneyIn")} items={ins} total={c.inflow} days={days} color="var(--series-1)" />
        <CategoryCard title={t("activity.moneyOut")} items={outs} total={c.outflow} days={days} color="var(--series-2)" />
      </div>

      <section className="card flush">
        <div className="row between" style={{ padding: "14px 16px" }}>
          <h2>{t("activity.transactions")}</h2>
          <div className="row">
            <label className="row" style={{ position: "relative" }}>
              <Search size={15} style={{ position: "absolute", insetInlineStart: 10, color: "var(--muted)" }} aria-hidden="true" />
              <input
                className="input sm"
                style={{ paddingInlineStart: 32, width: 220 }}
                placeholder={t("common.search")}
                aria-label={t("common.search")}
                value={q}
                dir="auto"
                onChange={(e) => {
                  setQ(e.target.value);
                  setLimit(PAGE);
                }}
              />
            </label>
            <select
              className="select sm"
              style={{ width: "auto" }}
              aria-label={t("activity.category")}
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setLimit(PAGE);
              }}
            >
              <option value="">{t("activity.allCategories")}</option>
              {[...ins, ...outs].map((i) => (
                <option key={i.category} value={i.category}>
                  {pick(i.label_en, i.label_ar)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {tx.data && (
          <div className={`table-wrap${tx.isFetching ? " refetching" : ""}`}>
            <table className="table">
              <thead>
                <tr>
                  <th>{t("common.date")}</th>
                  <th>{t("activity.description")}</th>
                  <th>{t("activity.category")}</th>
                  <th>{t("activity.account")}</th>
                  <th className="amount">{t("common.amount")}</th>
                </tr>
              </thead>
              <tbody>
                {tx.data.items.map((r) => (
                  <tr key={r.id}>
                    <td className="nowrap small">{f.date(r.date, "weekday")}</td>
                    <td className="small">
                      <div dir="ltr" style={{ textAlign: "start" }}>{r.description}</div>
                    </td>
                    <td>
                      <span className="chip">{labels[r.category] ? <CatName item={labels[r.category]} /> : r.category}</span>
                    </td>
                    <td className="small ink-2 nowrap">{pick(r.bank_name, r.bank_name_ar)}</td>
                    <td className="amount strong">
                      <Money value={r.amount} sign />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row between" style={{ padding: "12px 16px" }}>
              <span className="xsmall muted">{t("activity.showing", { n: tx.data.items.length, total: tx.data.total })}</span>
              {tx.data.items.length < tx.data.total && (
                <button className="btn sm" onClick={() => setLimit((l) => l + PAGE * 2)}>
                  {t("activity.loadMore")}
                </button>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function CatName({ item }: { item: CategoryTotal }) {
  const { pick } = useI18n();
  return <>{pick(item.label_en, item.label_ar)}</>;
}

function Total({ label, value, prior, days, upIsGood }: { label: string; value: number; prior: number; days: number; upIsGood: boolean }) {
  const { t, f } = useI18n();
  const change = prior > 0 ? value / prior - 1 : null;
  const good = change !== null && (change > 0) === upIsGood;
  return (
    <div className="kpi">
      <span className="label">{label}</span>
      <span className="value"><Money value={value} compact /></span>
      {change !== null && Math.abs(change) >= 0.01 && (
        <span className="note">
          <span style={{ color: good ? "var(--good-ink)" : "var(--critical-ink)", fontWeight: 600 }}>
            <bdi>{change > 0 ? "+" : ""}{f.pct(change)}</bdi>
          </span>{" "}
          {t("activity.vsPrior", { n: days })}
        </span>
      )}
    </div>
  );
}

/** Magnitude by category: one hue per chart, bars from a common baseline, values at the bar end. */
function CategoryCard({ title, items, total, days, color }: { title: string; items: CategoryTotal[]; total: number; days: number; color: string }) {
  const { t, f } = useI18n();
  const max = Math.max(1, ...items.map((i) => Math.abs(i.amount)));
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>{title}</h2>
          <div className="sub">{t("activity.vsPrior", { n: days })}</div>
        </div>
      </div>
      <div className="cat-bars" role="list">
        {items.map((i) => {
          const v = Math.abs(i.amount);
          const prior = Math.abs(i.prior_amount);
          const change = prior > 0 ? v / prior - 1 : null;
          return (
            <div className="cat-row" role="listitem" key={i.category} title={`${f.money(v)} · ${t("activity.share", { p: f.pct(v / Math.max(1, total)) })}`}>
              <span className="name">
                <CatName item={i} />
              </span>
              <span className="track">
                <span className="bar" style={{ width: `${(v / max) * 100}%`, background: color }} />
              </span>
              <span className="val">
                <Money value={v} compact />
                <span className="d">
                  {t("activity.share", { p: f.pct(v / Math.max(1, total)) })}
                  {change !== null && Math.abs(change) >= 0.05 && (
                    <>
                      {" · "}
                      <bdi>{change > 0 ? "+" : ""}{f.pct(change)}</bdi>
                    </>
                  )}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
