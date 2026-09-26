import { useState, type FormEvent } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, CalendarClock, Check, Pencil, Plus, Search, Undo2, X } from "lucide-react";
import { api } from "../api/client";
import type { Invoice, InvoiceSummary, Obligation } from "../api/types";
import { useI18n } from "../i18n";
import { useToast } from "../lib/toast";
import { addDays, daysBetween, todayRiyadh } from "../lib/util";
import { AgingBar } from "../components/charts/AgingBar";
import { Empty, Loading, Modal, Money, Segmented } from "../components/ui";

type Tab = "receivable" | "payable" | "obligations";
type Status = "open" | "overdue" | "paid" | "all";

const todayIso = todayRiyadh;

export function TrackerPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("receivable");
  const summary = useQuery({ queryKey: ["invoice-summary"], queryFn: () => api<InvoiceSummary>("/invoices/summary") });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{t("tracker.title")}</h1>
          <p>{t("tracker.subtitle")}</p>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {(["receivable", "payable", "obligations"] as Tab[]).map((k) => (
          <button key={k} role="tab" className="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {k === "receivable" ? t("tracker.receivables") : k === "payable" ? t("tracker.payables") : t("tracker.obligations")}
          </button>
        ))}
      </div>
      {tab === "obligations" ? <ObligationsTab /> : <InvoicesTab kind={tab} summary={summary.data} />}
    </div>
  );
}

function InvoicesTab({ kind, summary }: { kind: "receivable" | "payable"; summary?: InvoiceSummary }) {
  const { t, f, pick } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<Status>("open");
  const [q, setQ] = useState("");
  const [dateFor, setDateFor] = useState<Invoice | null>(null);
  const [adding, setAdding] = useState(false);
  const list = useQuery({
    queryKey: ["invoices", kind, status, q],
    queryFn: () => api<Invoice[]>(`/invoices?kind=${kind}&status=${status}${q ? `&q=${encodeURIComponent(q)}` : ""}`),
    placeholderData: keepPreviousData,
  });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) => api<Invoice>(`/invoices/${id}`, { method: "PATCH", body }),
    onSuccess: () => qc.invalidateQueries(),
    onError: (e) => toast(e instanceof Error ? e.message : t("common.error"), true),
  });
  const s = summary?.[kind];
  const today = todayIso();

  return (
    <div className="stack" style={{ gap: 16 }}>
      {s && (
        <section className="card">
          <div className="card-header">
            <h2>{kind === "receivable" ? t("tracker.aging") : t("tracker.agingPayables")}</h2>
            <div className="row" style={{ gap: 20 }}>
              <Stat label={t("tracker.total")} value={f.money(s.total, { compact: true })} />
              <Stat label={t("tracker.overdueTotal")} value={f.money(s.overdue, { compact: true })} />
              <Stat label={t("tracker.dueWeek")} value={f.money(s.due_next_7_days, { compact: true })} />
              {kind === "receivable" && summary?.dso_days != null && <Stat label={t("tracker.dso")} value={`${summary.dso_days} ${t("common.days")}`} />}
            </div>
          </div>
          <AgingBar buckets={s.buckets} />
        </section>
      )}

      <section className="card flush">
        <div className="row between" style={{ padding: "14px 16px" }}>
          <div className="row">
            <Segmented
              label={t("common.status")}
              value={status}
              onChange={setStatus}
              options={[
                { value: "open", label: t("common.open") },
                { value: "overdue", label: t("common.overdue") },
                { value: "paid", label: t("common.paid") },
                { value: "all", label: t("common.all") },
              ]}
            />
            <label className="row" style={{ gap: 6, position: "relative" }}>
              <Search size={15} style={{ position: "absolute", insetInlineStart: 10, color: "var(--muted)" }} aria-hidden="true" />
              <input className="input sm" style={{ paddingInlineStart: 32, width: 220 }} placeholder={t("common.search")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("common.search")} />
            </label>
          </div>
          <button className="btn sm" onClick={() => setAdding(true)}>
            <Plus size={15} />
            {kind === "receivable" ? t("tracker.addInvoice") : t("tracker.addBill")}
          </button>
        </div>
        {list.isLoading ? (
          <Loading />
        ) : !list.data?.length ? (
          <Empty title={t("tracker.empty")} />
        ) : (
          <div className={`table-wrap${list.isFetching ? " refetching" : ""}`}>
            <table className="table">
              <thead>
                <tr>
                  <th>{t("tracker.number")}</th>
                  <th>{kind === "receivable" ? t("tracker.customer") : t("tracker.supplier")}</th>
                  <th>{t("tracker.due")}</th>
                  <th className="amount">{t("tracker.outstanding")}</th>
                  {kind === "receivable" && <th>{t("tracker.behaviour")}</th>}
                  <th>{kind === "receivable" ? t("tracker.expected") : t("tracker.expectedPay")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.data.map((inv) => {
                  const dueIn = daysBetween(today, inv.due_date);
                  return (
                    <tr key={inv.id}>
                      <td>
                        <div className="strong num">{inv.number}</div>
                        <div className="xsmall muted row" style={{ gap: 4 }}>
                          {t(`tracker.source.${inv.source}`)}
                          {inv.zatca_uuid && (
                            <span title={`${t("tracker.zatca")}: ${inv.zatca_uuid}`} style={{ display: "inline-flex", color: "var(--good-ink)" }}>
                              <BadgeCheck size={13} aria-label={t("tracker.zatca")} />
                            </span>
                          )}
                        </div>
                      </td>
                      <td>{pick(inv.counterparty, inv.counterparty_ar)}</td>
                      <td>
                        <div className="nowrap">{f.date(inv.due_date, "medium")}</div>
                        {inv.status === "open" ? (
                          inv.days_overdue > 0 ? (
                            <span className={`badge ${inv.days_overdue > 30 ? "critical" : "warning"}`}>{t("tracker.overdueBy", { n: inv.days_overdue })}</span>
                          ) : (
                            <span className="xsmall muted">{dueIn === 0 ? t("tracker.dueToday") : t("tracker.dueIn", { n: dueIn })}</span>
                          )
                        ) : (
                          <span className="badge good">
                            <Check size={13} />
                            {t("common.paid")} {inv.paid_date && f.date(inv.paid_date)}
                          </span>
                        )}
                      </td>
                      <td className="amount strong">
                        <Money value={inv.status === "open" ? inv.outstanding : inv.amount} />
                      </td>
                      {kind === "receivable" && (
                        <td className="small">
                          {inv.customer_avg_delay == null
                            ? "—"
                            : Math.abs(inv.customer_avg_delay) < 2
                              ? t("tracker.onTime")
                              : inv.customer_avg_delay > 0
                                ? t("tracker.late", { n: Math.round(inv.customer_avg_delay) })
                                : t("tracker.early", { n: Math.round(-inv.customer_avg_delay) })}
                        </td>
                      )}
                      <td className="small">
                        {inv.status !== "open" ? (
                          "—"
                        ) : inv.expected_date ? (
                          <span className="badge brand">
                            <CalendarClock size={13} />
                            {kind === "receivable" ? t("tracker.promised") : t("tracker.planned")} {f.date(inv.expected_date)}
                          </span>
                        ) : inv.forecast?.expected_date ? (
                          <div>
                            <div className="nowrap">{f.date(inv.forecast.expected_date, "weekday")}</div>
                            <div className="xsmall muted">{t("tracker.probability", { p: f.pct(inv.forecast.probability_in_horizon) })}</div>
                          </div>
                        ) : kind === "payable" ? (
                          <span className="nowrap">{f.date(inv.due_date)}</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        <div className="row" style={{ gap: 4, flexWrap: "nowrap", justifyContent: "flex-end" }}>
                          {inv.status === "open" ? (
                            <>
                              <button className="btn ghost sm" onClick={() => setDateFor(inv)} title={kind === "receivable" ? t("tracker.setDate") : t("tracker.setPlanned")}>
                                <CalendarClock size={15} />
                              </button>
                              <button className="btn sm" onClick={() => patch.mutate({ id: inv.id, body: { status: "paid" } })}>
                                <Check size={15} />
                                {t("tracker.markPaid")}
                              </button>
                            </>
                          ) : (
                            <button className="btn ghost sm" onClick={() => patch.mutate({ id: inv.id, body: { status: "open" } })}>
                              <Undo2 size={15} />
                              {t("tracker.reopen")}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {dateFor && (
        <DateModal
          invoice={dateFor}
          onClose={() => setDateFor(null)}
          onSave={(date) => {
            patch.mutate({ id: dateFor.id, body: date ? { expected_date: date } : { clear_expected_date: true } });
            setDateFor(null);
          }}
        />
      )}
      {adding && <NewInvoiceModal kind={kind} onClose={() => setAdding(false)} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stack" style={{ gap: 0 }}>
      <span className="xsmall muted">{label}</span>
      <span className="num" style={{ fontWeight: 600 }}>
        <bdi>{value}</bdi>
      </span>
    </div>
  );
}

function DateModal({ invoice, onClose, onSave }: { invoice: Invoice; onClose: () => void; onSave: (d: string | null) => void }) {
  const { t, pick } = useI18n();
  const [date, setDate] = useState(invoice.expected_date ?? invoice.forecast?.expected_date ?? addDays(todayIso(), 7));
  return (
    <Modal
      title={invoice.kind === "receivable" ? t("tracker.setDate") : t("tracker.setPlanned")}
      onClose={onClose}
      footer={
        <>
          {invoice.expected_date && (
            <button className="btn ghost" onClick={() => onSave(null)}>
              <X size={15} />
              {t("tracker.clearDate")}
            </button>
          )}
          <button className="btn primary" onClick={() => onSave(date)}>
            {t("common.save")}
          </button>
        </>
      }
    >
      <p className="small muted" style={{ marginBottom: 12 }}>
        {invoice.number} · {pick(invoice.counterparty, invoice.counterparty_ar)}
      </p>
      <label className="field">
        <span>{t("common.date")}</span>
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
    </Modal>
  );
}

function NewInvoiceModal({ kind, onClose }: { kind: "receivable" | "payable"; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const today = todayIso();
  const [form, setForm] = useState({ number: "", counterparty: "", issue_date: today, due_date: addDays(today, 30), amount: "" });
  const create = useMutation({
    mutationFn: () => api("/invoices", { method: "POST", body: { ...form, kind, amount: Number(form.amount) } }),
    onSuccess: () => {
      qc.invalidateQueries();
      onClose();
    },
    onError: (e) => toast(e instanceof Error ? e.message : t("common.error"), true),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  return (
    <Modal title={kind === "receivable" ? t("tracker.addInvoice") : t("tracker.addBill")} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <label className="field">
            <span>{t("tracker.number")}</span>
            <input className="input" required value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} />
          </label>
          <label className="field">
            <span>{kind === "receivable" ? t("tracker.customer") : t("tracker.supplier")}</span>
            <input className="input" dir="auto" required value={form.counterparty} onChange={(e) => setForm({ ...form, counterparty: e.target.value })} />
          </label>
          <label className="field">
            <span>{t("tracker.issueDate")}</span>
            <input className="input" type="date" required value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} />
          </label>
          <label className="field">
            <span>{t("tracker.dueDate")}</span>
            <input className="input" type="date" required value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
          </label>
          <label className="field">
            <span>{t("tracker.amountInclVat")}</span>
            <input className="input num" type="number" min={1} step="0.01" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn primary" disabled={create.isPending}>
            {t("common.save")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ObligationsTab() {
  const { t, f, pick } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ["obligations"], queryFn: () => api<Obligation[]>("/obligations") });
  const [editing, setEditing] = useState<Obligation | "new" | null>(null);
  const remove = useMutation({
    mutationFn: (id: number) => api(`/obligations/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries(),
    onError: (e) => toast(e instanceof Error ? e.message : t("common.error"), true),
  });

  return (
    <section className="card flush">
      <div className="row between" style={{ padding: "16px 18px" }}>
        <p className="small muted" style={{ maxWidth: 640 }}>
          {t("tracker.obligationsSub")}
        </p>
        <button className="btn sm" onClick={() => setEditing("new")}>
          <Plus size={15} />
          {t("tracker.addObligation")}
        </button>
      </div>
      {list.isLoading ? (
        <Loading />
      ) : !list.data?.length ? (
        <Empty title={t("tracker.empty")} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t("tracker.name")}</th>
                <th className="amount">{t("common.amount")}</th>
                <th>{t("tracker.frequency")}</th>
                <th>{t("tracker.nextPayment")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.map((o) => (
                <tr key={o.id}>
                  <td>
                    <div className="strong">{pick(o.name, o.name_ar)}</div>
                    <div className="row" style={{ gap: 6, marginTop: 2 }}>
                      <span className="badge">{t(`tracker.kinds.${o.kind}`)}</span>
                      <span className="xsmall muted">{o.source === "detected" ? t("common.detected") : t("common.manual")}</span>
                    </div>
                  </td>
                  <td className="amount strong">
                    <Money value={o.amount} />
                  </td>
                  <td className="small">{t(`tracker.freq.${o.frequency}`)}</td>
                  <td className="small">
                    {o.next_payment_date ? f.date(o.next_payment_date, "weekday") : "—"}
                    {o.occurrences_90d.length > 1 && <div className="xsmall muted">×{o.occurrences_90d.length} / 90 {t("common.days")}</div>}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 4, justifyContent: "flex-end", flexWrap: "nowrap" }}>
                      <button className="btn ghost sm" onClick={() => setEditing(o)} aria-label={t("common.edit")}>
                        <Pencil size={15} />
                      </button>
                      <button className="btn ghost sm" onClick={() => remove.mutate(o.id)}>
                        {t("tracker.deactivate")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <ObligationModal obligation={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function ObligationModal({ obligation, onClose }: { obligation: Obligation | null; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({
    kind: obligation?.kind ?? "zakat",
    name: obligation?.name ?? "",
    amount: String(obligation?.amount ?? ""),
    frequency: obligation?.frequency ?? "once",
    next_due_date: obligation?.next_due_date ?? addDays(todayIso(), 30),
  });
  const save = useMutation({
    mutationFn: () =>
      obligation
        ? api(`/obligations/${obligation.id}`, {
            method: "PATCH",
            body: { name: form.name, amount: Number(form.amount), frequency: form.frequency, next_due_date: form.next_due_date },
          })
        : api("/obligations", { method: "POST", body: { ...form, amount: Number(form.amount), name_ar: form.name } }),
    onSuccess: () => {
      qc.invalidateQueries();
      onClose();
    },
    onError: (e) => toast(e instanceof Error ? e.message : t("common.error"), true),
  });
  return (
    <Modal title={obligation ? t("common.edit") : t("tracker.addObligation")} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="form-grid">
          {!obligation && (
            <label className="field">
              <span>{t("tracker.kind")}</span>
              <select className="select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {["zakat", "payroll", "rent", "vat", "gosi", "loan", "other"].map((k) => (
                  <option key={k} value={k}>
                    {t(`tracker.kinds.${k}`)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            <span>{t("tracker.name")}</span>
            <input className="input" dir="auto" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="field">
            <span>{t("common.amount")}</span>
            <input className="input num" type="number" min={1} required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </label>
          <label className="field">
            <span>{t("tracker.frequency")}</span>
            <select className="select" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value as Obligation["frequency"] })}>
              {["once", "monthly", "quarterly", "semiannual", "annual"].map((k) => (
                <option key={k} value={k}>
                  {t(`tracker.freq.${k}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t("tracker.nextPayment")}</span>
            <input className="input" type="date" required value={form.next_due_date} onChange={(e) => setForm({ ...form, next_due_date: e.target.value })} />
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn primary" disabled={save.isPending}>
            {t("common.save")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
