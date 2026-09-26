import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, CircleCheck, Languages, Lock, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import { api } from "../api/client";
import type { Bank, Connection, Provider } from "../api/types";
import { useI18n } from "../i18n";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import { relTime } from "../lib/util";
import { BrandMark, Empty, Loading, Modal } from "../components/ui";

const RETURN_KEY = "siyulah.oauth.return";

function useCatalog() {
  return useQuery({ queryKey: ["providers"], queryFn: () => api<{ providers: Provider[]; banks: Bank[] }>("/integrations/providers"), staleTime: Infinity });
}

function useConnections() {
  return useQuery({ queryKey: ["connections"], queryFn: () => api<Connection[]>("/integrations/connections") });
}

/** Start the OAuth 2.0 authorization-code flow: the provider consent screen takes over. */
function useAuthorize(returnTo: string) {
  const toast = useToast();
  const { t } = useI18n();
  return useMutation({
    mutationFn: ({ provider, institution }: { provider: string; institution?: string }) =>
      api<{ authorize_url: string }>(`/integrations/${provider}/authorize`, { method: "POST", body: { institution: institution ?? null } }),
    onSuccess: (r) => {
      try {
        sessionStorage.setItem(RETURN_KEY, returnTo);
      } catch {
        /* ignore */
      }
      window.location.assign(r.authorize_url);
    },
    onError: (e) => toast(e instanceof Error ? e.message : t("common.error"), true),
  });
}

function ProviderLogo({ p, size = 40 }: { p: Pick<Provider, "name" | "color">; size?: number }) {
  return (
    <span className="logo" style={{ background: p.color, width: size, height: size, borderRadius: size * 0.28, display: "grid", placeItems: "center", color: "#fff", fontWeight: 700, flex: "none" }} aria-hidden="true">
      {p.name.slice(0, 1)}
    </span>
  );
}

function BankPicker({ provider, banks, onClose, onPick, busy }: { provider: Provider; banks: Bank[]; onClose: () => void; onPick: (code: string) => void; busy: boolean }) {
  const { t, pick } = useI18n();
  const [sel, setSel] = useState<string | null>(null);
  return (
    <Modal
      title={t("integrations.chooseBank")}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="btn primary" disabled={!sel || busy} onClick={() => sel && onPick(sel)}>
            {busy && <span className="spinner" />}
            {t("integrations.connect")}
            <ArrowUpRight size={15} className="flip-rtl" />
          </button>
        </>
      }
    >
      <p className="small muted" style={{ marginBottom: 12 }}>
        {t("integrations.via", { provider: pick(provider.name, provider.name_ar) })} · {t("integrations.readOnly")}
      </p>
      <div className="bank-grid">
        {banks.map((b) => (
          <button key={b.code} className="bank-option" aria-pressed={sel === b.code} onClick={() => setSel(b.code)} data-bank={b.code}>
            <span className="dot">{b.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}</span>
            <span>{pick(b.name, b.name_ar)}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

function ProviderCard({ p, connected, onConnect }: { p: Provider; connected: boolean; onConnect: () => void }) {
  const { t, pick } = useI18n();
  const soon = p.status !== "available";
  return (
    <div className="provider" style={{ opacity: soon ? 0.7 : 1 }} data-provider={p.key}>
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <ProviderLogo p={p} />
        <div style={{ minWidth: 0 }}>
          <strong>{pick(p.name, p.name_ar)}</strong>
          <div className="row" style={{ gap: 4, marginTop: 2 }}>
            {p.tags.map((tag) => (
              <span key={tag} className="badge" style={{ height: 20, fontSize: 11.5 }}>
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>
      <p className="desc">{pick(p.description, p.description_ar)}</p>
      {soon ? (
        <span className="badge" style={{ alignSelf: "flex-start" }}>
          {t("integrations.soon")}
        </span>
      ) : connected && !p.needs_institution ? (
        <span className="badge good" style={{ alignSelf: "flex-start" }}>
          <CircleCheck size={14} />
          {t("integrations.connected")}
        </span>
      ) : (
        <button className="btn sm" style={{ alignSelf: "flex-start" }} onClick={onConnect}>
          {t("integrations.connect")}
        </button>
      )}
    </div>
  );
}

export function IntegrationsPage() {
  const { t, pick } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const catalog = useCatalog();
  const conns = useConnections();
  const authorize = useAuthorize("/integrations");
  const [bankFor, setBankFor] = useState<Provider | null>(null);
  const sync = useMutation({
    mutationFn: (id: number) => api<{ result: { transactions_added: number; invoices_added: number } }>(`/integrations/connections/${id}/sync`, { method: "POST" }),
    onSuccess: (r) => {
      toast(t("integrations.syncedToast", { tx: r.result.transactions_added, inv: r.result.invoices_added }));
      qc.invalidateQueries();
    },
    onError: (e) => toast(e instanceof Error ? e.message : t("common.error"), true),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api(`/integrations/connections/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries(),
  });

  if (catalog.isLoading || conns.isLoading) return <Loading />;
  const providers = catalog.data?.providers ?? [];
  const connected = new Set(conns.data?.map((c) => c.provider));
  const section = (kinds: string[], available: boolean) => providers.filter((p) => kinds.includes(p.kind) && (p.status === "available") === available);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{t("integrations.title")}</h1>
          <p>{t("integrations.subtitle")}</p>
        </div>
      </div>

      <section className="card">
        <div className="card-header">
          <h2>{t("integrations.connected")}</h2>
          <span className="badge brand">
            <ShieldCheck size={14} />
            AES-256 · OAuth 2.0 + PKCE
          </span>
        </div>
        {!conns.data?.length ? (
          <p className="small muted">{t("integrations.noConnections")}</p>
        ) : (
          <div className="list">
            {conns.data.map((c) => (
              <div className="list-item" key={c.id} style={{ alignItems: "center" }}>
                <ProviderLogo p={{ name: c.provider_name, color: providers.find((p) => p.key === c.provider)?.color ?? "#555" }} size={36} />
                <div className="body">
                  <div className="title">
                    {c.institution_name ? pick(c.institution_name, c.institution_name_ar) : pick(c.provider_name, c.provider_name_ar)}
                    {c.institution_name && <span className="muted small"> · {t("integrations.via", { provider: pick(c.provider_name, c.provider_name_ar) })}</span>}
                  </div>
                  <div className="desc row" style={{ gap: 8 }}>
                    <span className={`badge ${c.status === "connected" ? "good" : "critical"}`}>{c.status === "connected" ? t("integrations.connected") : c.last_error}</span>
                    <span className="row" style={{ gap: 4 }}>
                      <Lock size={12} /> {t("integrations.readOnly")} · {t("integrations.encrypted")}
                    </span>
                    <span>· {t("integrations.lastSync", { time: relTime(c.last_synced_at, t) })}</span>
                    {c.accounts != null && <span>· {t("integrations.accounts", { n: c.accounts })}</span>}
                  </div>
                </div>
                <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                  <button className="btn ghost sm" onClick={() => sync.mutate(c.id)} disabled={sync.isPending} aria-label={t("common.syncNow")}>
                    <RefreshCw size={15} className={sync.isPending && sync.variables === c.id ? "spin" : undefined} />
                  </button>
                  <button
                    className="btn danger sm"
                    onClick={() => {
                      const name = c.institution_name ? pick(c.institution_name, c.institution_name_ar) : pick(c.provider_name, c.provider_name_ar);
                      if (window.confirm(t("integrations.disconnectConfirm", { name }))) remove.mutate(c.id);
                    }}
                  >
                    <Unplug size={15} />
                    {t("integrations.disconnect")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="stack">
        <div>
          <h2>{t("integrations.banks")}</h2>
          <p className="small muted">{t("integrations.banksSub")}</p>
        </div>
        <div className="provider-grid">
          {section(["bank"], true).map((p) => (
            <ProviderCard key={p.key} p={p} connected={connected.has(p.key)} onConnect={() => setBankFor(p)} />
          ))}
        </div>
      </section>

      <section className="stack">
        <div>
          <h2>{t("integrations.accounting")}</h2>
          <p className="small muted">{t("integrations.accountingSub")}</p>
        </div>
        <div className="provider-grid">
          {section(["accounting"], true).map((p) => (
            <ProviderCard key={p.key} p={p} connected={connected.has(p.key)} onConnect={() => authorize.mutate({ provider: p.key })} />
          ))}
        </div>
      </section>

      <section className="stack">
        <div>
          <h2>{t("integrations.comingSoon")}</h2>
          <p className="small muted">{t("integrations.comingSoonSub")}</p>
        </div>
        <div className="provider-grid">
          {providers
            .filter((p) => p.status !== "available")
            .map((p) => (
              <ProviderCard key={p.key} p={p} connected={false} onConnect={() => {}} />
            ))}
        </div>
      </section>

      {bankFor && (
        <BankPicker
          provider={bankFor}
          banks={catalog.data?.banks ?? []}
          busy={authorize.isPending}
          onClose={() => setBankFor(null)}
          onPick={(code) => authorize.mutate({ provider: bankFor.key, institution: code })}
        />
      )}
    </div>
  );
}

const handledCodes = new Set<string>();

export function IntegrationsCallback() {
  const { t, pick } = useI18n();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let back = "/integrations";
    try {
      back = sessionStorage.getItem(RETURN_KEY) ?? back;
    } catch {
      /* ignore */
    }
    const code = params.get("code");
    const state = params.get("state");
    if (params.get("error") || !code || !state) {
      setError(t("integrations.denied"));
      return;
    }
    if (handledCodes.has(code)) return;
    handledCodes.add(code);
    api<Connection>("/integrations/callback", { method: "POST", body: { code, state } })
      .then((c) => {
        const name = c.institution_name ? pick(c.institution_name, c.institution_name_ar) : pick(c.provider_name, c.provider_name_ar);
        toast(t("integrations.connectedToast", { name }));
        qc.invalidateQueries();
        nav(back, { replace: true });
      })
      .catch((e) => setError(e instanceof Error ? e.message : t("common.error")));
  }, [params, nav, qc, toast, t, pick]);

  return (
    <div className="loading-page">
      {error ? (
        <div className="card stack" style={{ maxWidth: 420, textAlign: "center" }}>
          <p>{error}</p>
          <Link className="btn" to="/integrations">
            {t("common.back")}
          </Link>
        </div>
      ) : (
        <div className="row muted">
          <div className="spinner" />
          {t("integrations.callbackWorking")}
        </div>
      )}
    </div>
  );
}

export function OnboardingPage() {
  const { t, locale, setLocale, pick } = useI18n();
  const { me } = useAuth();
  const catalog = useCatalog();
  const conns = useConnections();
  const [params, setParams] = useSearchParams();
  const authorize = useAuthorize("/onboarding");
  const [bankFor, setBankFor] = useState<Provider | null>(null);

  if (catalog.isLoading || conns.isLoading) return <Loading />;
  const hasBank = conns.data?.some((c) => c.kind === "bank");
  const hasAcct = conns.data?.some((c) => c.kind === "accounting");
  const step = !hasBank ? 1 : !hasAcct && params.get("skip") !== "1" ? 2 : 3;
  const providers = catalog.data?.providers ?? [];

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <header className="row between" style={{ padding: "16px 24px" }}>
        <div className="row">
          <BrandMark />
          <strong>{t("app.name")}</strong>
          {me && <span className="muted small">· {pick(me.company.name, me.company.name_ar)}</span>}
        </div>
        <button className="btn ghost sm" onClick={() => setLocale(locale === "ar" ? "en" : "ar")}>
          <Languages size={16} />
          {t("common.language")}
        </button>
      </header>
      <main className="page" style={{ maxWidth: 880, margin: "0 auto" }}>
        <div className="stack" style={{ gap: 6 }}>
          <h1>{t("integrations.onboardingTitle")}</h1>
          <p className="muted">{t("integrations.onboardingSub")}</p>
        </div>
        <div className="steps" aria-label="progress">
          {[t("integrations.step1"), t("integrations.step2"), t("integrations.step3")].map((label, i) => (
            <div className="row" key={label} style={{ gap: 8 }}>
              {i > 0 && <span className="step-sep" />}
              <span className={`step${step === i + 1 ? " active" : step > i + 1 ? " done" : ""}`}>
                <span className="n">{step > i + 1 ? "✓" : i + 1}</span>
                {label}
              </span>
            </div>
          ))}
        </div>

        {step === 1 && (
          <section className="card stack">
            <div>
              <h2>{t("integrations.bankStepTitle")}</h2>
              <p className="small muted">{t("integrations.bankStepSub")}</p>
            </div>
            <div className="provider-grid">
              {providers
                .filter((p) => p.kind === "bank" && p.status === "available")
                .map((p) => (
                  <ProviderCard key={p.key} p={p} connected={false} onConnect={() => setBankFor(p)} />
                ))}
            </div>
            <div className="callout small">
              <ShieldCheck size={18} style={{ flex: "none", color: "var(--brand)" }} />
              <span>{t("auth.point1")}</span>
            </div>
          </section>
        )}
        {step === 2 && (
          <section className="card stack">
            <div className="row between">
              <div>
                <h2>{t("integrations.acctStepTitle")}</h2>
                <p className="small muted">{t("integrations.acctStepSub")}</p>
              </div>
              <button className="btn ghost sm" onClick={() => setParams({ skip: "1" })}>
                {t("common.skip")}
              </button>
            </div>
            <div className="provider-grid">
              {providers
                .filter((p) => p.kind === "accounting" && p.status === "available")
                .map((p) => (
                  <ProviderCard key={p.key} p={p} connected={false} onConnect={() => authorize.mutate({ provider: p.key })} />
                ))}
            </div>
          </section>
        )}
        {step === 3 && (
          <section className="card">
            <Empty icon={<CircleCheck style={{ color: "var(--good-ink)" }} />} title={t("integrations.doneTitle")}>
              <p>{t("integrations.doneSub")}</p>
              <Link to="/" className="btn primary lg">
                {t("integrations.goDashboard")}
              </Link>
            </Empty>
          </section>
        )}
      </main>
      {bankFor && (
        <BankPicker
          provider={bankFor}
          banks={catalog.data?.banks ?? []}
          busy={authorize.isPending}
          onClose={() => setBankFor(null)}
          onPick={(code) => authorize.mutate({ provider: bankFor.key, institution: code })}
        />
      )}
    </div>
  );
}
