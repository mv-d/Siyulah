import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Check, Mail, MessageSquare, RefreshCw, Smartphone } from "lucide-react";
import { api } from "../api/client";
import type { AlertItem, AlertRule, NotificationLog } from "../api/types";
import { useI18n } from "../i18n";
import { useToast } from "../lib/toast";
import { relTime } from "../lib/util";
import { Empty, Loading, SeverityBadge, SeverityIcon, Switch } from "../components/ui";

const CHANNELS = ["in_app", "email", "sms", "push"] as const;

export function AlertsPage() {
  const { t, pick, f } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<"active" | "resolved">("active");
  const alerts = useQuery({ queryKey: ["alerts", status], queryFn: () => api<AlertItem[]>(`/alerts?status=${status}`) });
  const rules = useQuery({ queryKey: ["alert-rules"], queryFn: () => api<AlertRule[]>("/alerts/rules") });
  const log = useQuery({ queryKey: ["notifications"], queryFn: () => api<NotificationLog[]>("/alerts/notifications") });

  const read = useMutation({
    mutationFn: (id: number) => api(`/alerts/${id}/read`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] }),
  });
  const readAll = useMutation({
    mutationFn: () => api("/alerts/read-all", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] }),
  });
  const evaluate = useMutation({
    mutationFn: () => api("/alerts/evaluate", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries(),
  });
  const updateRule = useMutation({
    mutationFn: ({ kind, body }: { kind: string; body: Partial<AlertRule> }) => api<AlertRule>(`/alerts/rules/${kind}`, { method: "PUT", body }),
    onSuccess: () => qc.invalidateQueries(),
    onError: (e) => toast(e instanceof Error ? e.message : t("common.error"), true),
  });
  const test = useMutation({
    mutationFn: (channel: string) => api<{ status: string }>("/alerts/test", { method: "POST", body: { channel } }),
    onSuccess: (r, channel) => {
      toast(t("alerts.testSent", { channel: t(`alerts.channels.${channel}`), status: t(`alerts.status.${r.status}`) }));
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{t("alerts.title")}</h1>
          <p>{t("alerts.subtitle")}</p>
        </div>
        <div className="row">
          <button className="btn sm" onClick={() => evaluate.mutate()} disabled={evaluate.isPending}>
            <RefreshCw size={15} className={evaluate.isPending ? "spin" : undefined} />
            {t("alerts.evaluate")}
          </button>
          <button className="btn sm" onClick={() => readAll.mutate()}>
            <Check size={15} />
            {t("alerts.markAllRead")}
          </button>
        </div>
      </div>

      <div className="grid main-side">
        <section className="card flush">
          <div className="tabs" role="tablist" style={{ padding: "0 12px" }}>
            {(["active", "resolved"] as const).map((s) => (
              <button key={s} className="tab" role="tab" aria-selected={status === s} onClick={() => setStatus(s)}>
                {s === "active" ? t("alerts.active") : t("alerts.history")}
              </button>
            ))}
          </div>
          {alerts.isLoading ? (
            <Loading />
          ) : !alerts.data?.length ? (
            <Empty icon={<BellRing />} title={t("alerts.empty")} />
          ) : (
            <div className="list" style={{ padding: "4px 18px 10px" }}>
              {alerts.data.map((a) => (
                <div className="list-item" key={a.id} style={{ opacity: a.read_at && status === "active" ? 0.75 : 1 }}>
                  <SeverityIcon severity={a.severity} />
                  <div className="body">
                    <div className="row" style={{ gap: 8 }}>
                      <span className="title">{pick(a.title_en, a.title_ar)}</span>
                      {!a.read_at && status === "active" && (
                        <span style={{ width: 8, height: 8, borderRadius: 99, background: "var(--series-1)" }} aria-label="unread" />
                      )}
                    </div>
                    <div className="desc">{pick(a.body_en, a.body_ar)}</div>
                    <div className="row xsmall muted" style={{ marginTop: 6, gap: 8 }}>
                      <SeverityBadge severity={a.severity} />
                      <span>{t(`alerts.rule.${a.kind}.title`) === `alerts.rule.${a.kind}.title` ? a.kind : t(`alerts.rule.${a.kind}.title`)}</span>
                      <span>· {relTime(a.created_at, t)}</span>
                    </div>
                  </div>
                  {!a.read_at && status === "active" && (
                    <button className="btn ghost sm" onClick={() => read.mutate(a.id)}>
                      {t("alerts.markRead")}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <h2>{t("alerts.rules")}</h2>
              <div className="sub">{t("alerts.rulesSub")}</div>
            </div>
          </div>
          {rules.isLoading ? (
            <Loading />
          ) : (
            <div className="list">
              {rules.data?.map((r) => (
                <div className="list-item" key={r.kind} style={{ flexDirection: "column", gap: 10 }}>
                  <div className="row between" style={{ width: "100%", flexWrap: "nowrap" }}>
                    <div>
                      <div className="title small">{t(`alerts.rule.${r.kind}.title`)}</div>
                      <div className="desc">
                        {t(`alerts.rule.${r.kind}.desc`, {
                          days: r.threshold_days ?? 30,
                          pct: r.threshold_pct ?? 20,
                          amount: f.money(r.threshold_amount ?? 50_000, { compact: true }),
                        })}
                      </div>
                    </div>
                    <Switch checked={r.enabled} label={t(`alerts.rule.${r.kind}.title`)} onChange={(v) => updateRule.mutate({ kind: r.kind, body: { enabled: v } })} />
                  </div>
                  {r.enabled && (
                    <div className="row" style={{ gap: 8, width: "100%" }}>
                      {r.threshold_days !== null && (
                        <label className="field" style={{ width: 110 }}>
                          <span className="xsmall">{t("alerts.lookahead")}</span>
                          <input
                            className="input sm num"
                            type="number"
                            min={1}
                            max={120}
                            defaultValue={r.threshold_days}
                            onBlur={(e) => Number(e.target.value) !== r.threshold_days && updateRule.mutate({ kind: r.kind, body: { threshold_days: Number(e.target.value) } })}
                          />
                        </label>
                      )}
                      {r.threshold_pct !== null && (
                        <label className="field" style={{ width: 110 }}>
                          <span className="xsmall">{t("alerts.thresholdPct")}</span>
                          <input
                            className="input sm num"
                            type="number"
                            min={1}
                            max={100}
                            defaultValue={r.threshold_pct}
                            onBlur={(e) => Number(e.target.value) !== r.threshold_pct && updateRule.mutate({ kind: r.kind, body: { threshold_pct: Number(e.target.value) } })}
                          />
                        </label>
                      )}
                      {r.threshold_amount !== null && (
                        <label className="field" style={{ width: 130 }}>
                          <span className="xsmall">{t("alerts.thresholdAmount")}</span>
                          <input
                            className="input sm num"
                            type="number"
                            min={0}
                            step={1000}
                            defaultValue={r.threshold_amount}
                            onBlur={(e) => Number(e.target.value) !== r.threshold_amount && updateRule.mutate({ kind: r.kind, body: { threshold_amount: Number(e.target.value) } })}
                          />
                        </label>
                      )}
                      <div className="row" style={{ gap: 10, marginTop: 18 }}>
                        {CHANNELS.map((c) => (
                          <label key={c} className="checkbox xsmall" style={{ alignItems: "center" }}>
                            <input
                              type="checkbox"
                              checked={r.channels.includes(c)}
                              disabled={c === "in_app"}
                              onChange={(e) =>
                                updateRule.mutate({
                                  kind: r.kind,
                                  body: { channels: e.target.checked ? [...r.channels, c] : r.channels.filter((x) => x !== c) },
                                })
                              }
                              style={{ marginTop: 0 }}
                            />
                            {t(`alerts.channels.${c}`)}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="card flush">
        <div className="row between" style={{ padding: "16px 18px" }}>
          <div>
            <h2>{t("alerts.log")}</h2>
            <div className="small muted">{t("alerts.logSub")}</div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm" onClick={() => test.mutate("email")}>
              <Mail size={15} />
              {t("alerts.test")} · {t("alerts.channels.email")}
            </button>
            <button className="btn sm" onClick={() => test.mutate("sms")}>
              <MessageSquare size={15} />
              {t("alerts.channels.sms")}
            </button>
            <button className="btn sm" onClick={() => test.mutate("push")}>
              <Smartphone size={15} />
              {t("alerts.channels.push")}
            </button>
          </div>
        </div>
        {!log.data?.length ? (
          <Empty title={t("alerts.empty")} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("alerts.channel")}</th>
                  <th>{t("alerts.recipient")}</th>
                  <th>{t("alerts.message")}</th>
                  <th>{t("common.status")}</th>
                  <th>{t("common.date")}</th>
                </tr>
              </thead>
              <tbody>
                {log.data.slice(0, 25).map((n) => (
                  <tr key={n.id}>
                    <td className="small">{t(`alerts.channels.${n.channel}`)}</td>
                    <td className="small num" dir="ltr" style={{ textAlign: "start" }}>
                      {n.recipient ?? "—"}
                    </td>
                    <td className="small" style={{ maxWidth: 420 }}>
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.subject}</div>
                    </td>
                    <td>
                      <span className={`badge ${n.status === "sent" ? "good" : n.status === "failed" ? "critical" : n.status === "sandbox" ? "info" : ""}`} title={n.detail ?? undefined}>
                        {t(`alerts.status.${n.status}`)}
                      </span>
                    </td>
                    <td className="small muted nowrap">{relTime(n.created_at, t)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
