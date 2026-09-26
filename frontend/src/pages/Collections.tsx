import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownRight, BadgeCheck, CalendarClock, Check, Copy, HandCoins, MessageSquareText, Timer } from "lucide-react";
import { api } from "../api/client";
import type { CollectionItem, Collections } from "../api/types";
import { makeFormatters, useI18n } from "../i18n";
import { useAuth } from "../lib/auth";
import { reminderText, type Channel, type Lang } from "../lib/reminders";
import { useToast } from "../lib/toast";
import { addDays, todayRiyadh } from "../lib/util";
import { Empty, ErrorState, Loading, Modal, Money, Segmented } from "../components/ui";

export function CollectionsPage() {
  const { t, f, pick } = useI18n();
  const q = useQuery({ queryKey: ["collections"], queryFn: () => api<Collections>("/collections") });
  const [remindFor, setRemindFor] = useState<CollectionItem | null>(null);
  const [promiseFor, setPromiseFor] = useState<CollectionItem | null>(null);

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <div className="page"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  const { items, summary } = q.data;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{t("collections.title")}</h1>
          <p>{t("collections.subtitle")}</p>
        </div>
      </div>

      {summary && (
        <section className="card" style={{ padding: 0 }}>
          <div className="kpis" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
            <div className="kpi">
              <span className="label">{t("collections.overdue")}</span>
              <span className="value"><Money value={summary.overdue_total} compact /></span>
              <span className="note">{t("dashboard.overdueNote", { n: summary.overdue_count })}</span>
            </div>
            <div className="kpi">
              <span className="label">{t("collections.dueSoon")}</span>
              <span className="value"><Money value={summary.due_soon_total} compact /></span>
            </div>
            <div className="kpi">
              <span className="label">{t("collections.baseline")}</span>
              <span className="value" style={{ fontSize: 20 }}>
                {t("collections.baselineValue", {
                  low: f.money(summary.baseline_lowest_balance, { compact: true }),
                  risk: f.pct(summary.baseline_shortfall_probability),
                })}
              </span>
            </div>
          </div>
        </section>
      )}

      {items.length === 0 ? (
        <section className="card">
          <Empty icon={<HandCoins />} title={t("collections.empty")} />
        </section>
      ) : (
        <section className="stack" style={{ gap: 12 }}>
          <p className="small muted">{t("collections.rankNote", { days: summary?.collect_within_days ?? 7 })}</p>
          {items.map((it, rank) => (
            <CollectionCard
              key={it.invoice_id}
              item={it}
              rank={rank + 1}
              baselineRisk={summary?.baseline_shortfall_probability ?? 0}
              onRemind={() => setRemindFor(it)}
              onPromise={() => setPromiseFor(it)}
              pickName={pick(it.counterparty, it.counterparty_ar)}
            />
          ))}
        </section>
      )}

      {remindFor && <ReminderModal item={remindFor} onClose={() => setRemindFor(null)} />}
      {promiseFor && <PromiseModal item={promiseFor} onClose={() => setPromiseFor(null)} />}
    </div>
  );
}

function CollectionCard({
  item,
  rank,
  baselineRisk,
  onRemind,
  onPromise,
  pickName,
}: {
  item: CollectionItem;
  rank: number;
  baselineRisk: number;
  onRemind: () => void;
  onPromise: () => void;
  pickName: string;
}) {
  const { t, f } = useI18n();
  const c = item.customer;
  // Below ~1.5 points the change is within simulation noise; don't claim it.
  const riskMoves = item.impact.shortfall_change <= -0.015;
  const lowMoves = item.impact.lowest_balance_change > 1_000;
  const moves = riskMoves || lowMoves;
  const toneClass = item.tone === "final" ? "critical" : item.tone === "firm" ? "warning" : "info";
  return (
    <article className="card collection" aria-label={`${item.number} · ${pickName}`}>
      <div className="collection-rank" aria-hidden="true">{rank}</div>
      <div className="collection-main">
        <div className="row between" style={{ alignItems: "flex-start" }}>
          <div>
            <div className="row" style={{ gap: 8 }}>
              <strong>{pickName}</strong>
              <span className={`badge ${toneClass}`}>
                {item.days_overdue > 0 ? t("tracker.overdueBy", { n: item.days_overdue }) : t("collections.tones.friendly")}
              </span>
              {item.promised_date && (
                <span className="badge brand">
                  <CalendarClock size={13} />
                  {t("collections.promised", { date: f.date(item.promised_date) })}
                </span>
              )}
            </div>
            <div className="small muted" style={{ marginTop: 3 }}>
              <bdi>{item.number}</bdi> · {t("tracker.due")} {f.date(item.due_date, "medium")}
              {item.zatca_uuid && (
                <span title={t("tracker.zatca")} style={{ color: "var(--good-ink)", marginInlineStart: 6, display: "inline-flex", verticalAlign: "middle" }}>
                  <BadgeCheck size={13} aria-label={t("tracker.zatca")} />
                </span>
              )}
            </div>
          </div>
          <span style={{ fontSize: 20, fontWeight: 600 }}>
            <Money value={item.outstanding} />
          </span>
        </div>

        <div className="collection-grid">
          <div className="stack" style={{ gap: 3 }}>
            <span className="xsmall muted">{t("collections.customer")}</span>
            <span className="small">
              {c.avg_days_late == null
                ? t("collections.noHistory")
                : c.avg_days_late <= 3
                  ? t("collections.avgOnTime")
                  : t("collections.avgLate", { n: Math.round(c.avg_days_late) })}
            </span>
            {c.on_time_rate != null && <span className="xsmall muted">{t("collections.onTimeRate", { p: f.pct(c.on_time_rate) })}</span>}
            <span className="xsmall muted">{t("collections.owesTotal", { amount: f.money(c.total_outstanding, { compact: true }) })}</span>
          </div>
          <div className="stack" style={{ gap: 3 }}>
            <span className="xsmall muted">{t("tracker.expected")}</span>
            {item.forecast?.expected_date ? (
              <>
                <span className="small">{f.date(item.forecast.expected_date, "weekday")}</span>
                <span className="xsmall muted">{t("tracker.probability", { p: f.pct(item.forecast.probability_in_horizon) })}</span>
              </>
            ) : (
              <span className="small">—</span>
            )}
          </div>
          <div className="stack" style={{ gap: 5 }}>
            <span className="xsmall muted">{t("scenarios.impact")}</span>
            {moves ? (
              <div className="row" style={{ gap: 6 }}>
                {riskMoves && (
                  <span className="badge good">
                    <ArrowDownRight size={13} />
                    {t("collections.riskEffect", { from: f.pct(baselineRisk), to: f.pct(item.impact.shortfall_probability) })}
                  </span>
                )}
                {lowMoves && (
                  <span className="badge good">{t("collections.lowEffect", { value: f.money(item.impact.lowest_balance_change, { compact: true, sign: true }) })}</span>
                )}
              </div>
            ) : (
              <span className="xsmall ink-2">{t("collections.noEffect")}</span>
            )}
            {!!item.impact.days_sooner && item.impact.days_sooner > 2 && (
              <span className="xsmall muted row" style={{ gap: 4 }}>
                <Timer size={12} aria-hidden="true" />
                {t("collections.sooner", { n: item.impact.days_sooner })}
              </span>
            )}
          </div>
        </div>

        <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
          {item.notes && <span className="xsmall muted" style={{ marginInlineEnd: "auto" }}>{t("collections.lastReminder", { note: item.notes.split("\n").pop() ?? "" })}</span>}
          <button className="btn sm" onClick={onPromise}>
            <CalendarClock size={15} />
            {t("collections.logPromise")}
          </button>
          <button className="btn primary sm" onClick={onRemind} data-testid="draft-reminder">
            <MessageSquareText size={15} />
            {t("collections.remind")}
          </button>
        </div>
      </div>
    </article>
  );
}

function ReminderModal({ item, onClose }: { item: CollectionItem; onClose: () => void }) {
  const { t, locale } = useI18n();
  const { me } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [lang, setLang] = useState<Lang>(locale === "ar" ? "ar" : "en");
  const company = me?.company ?? { name: "", name_ar: null };
  const generated = useMemo(
    () => reminderText(item, company, channel, lang, makeFormatters("ar"), makeFormatters("en")),
    [item, company, channel, lang],
  );
  const [text, setText] = useState<string | null>(null);
  const value = text ?? generated;
  const log = useMutation({
    mutationFn: () => {
      const stamp = `${t(`collections.channels.${channel}`)} · ${todayRiyadh()}`;
      return api(`/invoices/${item.invoice_id}`, { method: "PATCH", body: { notes: item.notes ? `${item.notes}\n${stamp}` : stamp } });
    },
    onSuccess: () => {
      toast(t("collections.reminded"));
      qc.invalidateQueries({ queryKey: ["collections"] });
      onClose();
    },
    onError: (e) => toast(e instanceof Error ? e.message : t("common.error"), true),
  });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast(t("collections.copied", { channel: t(`collections.channels.${channel}`) }));
    } catch {
      const el = document.getElementById("reminder-text") as HTMLTextAreaElement | null;
      el?.select();
      toast(t("collections.copyFailed"), true);
    }
  };
  return (
    <Modal
      title={`${t("collections.reminderTitle")} · ${item.number}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={() => log.mutate()}>
            <Check size={15} />
            {t("collections.markReminded")}
          </button>
          <button className="btn primary" onClick={copy}>
            <Copy size={15} />
            {t("collections.copy")}
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="row between">
          <span className="small ink-2">{t("collections.channel")}</span>
          <Segmented<Channel>
            label={t("collections.channel")}
            value={channel}
            onChange={(v) => {
              setChannel(v);
              setText(null);
            }}
            options={(["whatsapp", "sms", "email"] as Channel[]).map((c) => ({ value: c, label: t(`collections.channels.${c}`) }))}
          />
        </div>
        <div className="row between">
          <span className="small ink-2">{t("collections.language")}</span>
          <Segmented<Lang>
            label={t("collections.language")}
            value={lang}
            onChange={(v) => {
              setLang(v);
              setText(null);
            }}
            options={[
              { value: "ar", label: "العربية" },
              { value: "en", label: "English" },
              { value: "both", label: t("collections.both") },
            ]}
          />
        </div>
        <textarea
          id="reminder-text"
          className="input"
          dir="auto"
          rows={12}
          value={value}
          onChange={(e) => setText(e.target.value)}
          style={{ lineHeight: 1.6, fontSize: 14 }}
        />
      </div>
    </Modal>
  );
}

function PromiseModal({ item, onClose }: { item: CollectionItem; onClose: () => void }) {
  const { t, f, pick } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [date, setDate] = useState(item.promised_date ?? addDays(todayRiyadh(), 7));
  const save = useMutation({
    mutationFn: () => api(`/invoices/${item.invoice_id}`, { method: "PATCH", body: { expected_date: date } }),
    onSuccess: () => {
      toast(t("collections.promiseSaved", { date: f.date(date) }));
      qc.invalidateQueries();
      onClose();
    },
    onError: (e) => toast(e instanceof Error ? e.message : t("common.error"), true),
  });
  return (
    <Modal
      title={t("collections.logPromise")}
      onClose={onClose}
      footer={
        <button className="btn primary" onClick={() => save.mutate()} disabled={save.isPending}>
          {t("collections.savePromise")}
        </button>
      }
    >
      <p className="small muted" style={{ marginBottom: 12 }}>
        <bdi>{item.number}</bdi> · {pick(item.counterparty, item.counterparty_ar)} · {f.money(item.outstanding)}
      </p>
      <label className="field">
        <span>{t("collections.promiseDate")}</span>
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
    </Modal>
  );
}
