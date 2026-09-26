import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, KeyRound, ShieldCheck, Trash } from "lucide-react";
import { api, download } from "../api/client";
import type { AuditEntry, CompanySettings, PrivacyInfo } from "../api/types";
import { useI18n, type Locale } from "../i18n";
import { useAuth } from "../lib/auth";
import { useTheme, type ThemePref } from "../lib/theme";
import { useToast } from "../lib/toast";
import { relTime } from "../lib/util";
import { Loading, Modal, Segmented } from "../components/ui";

export function SettingsPage() {
  const { t, f, locale, setLocale, pick } = useI18n();
  const { logout } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const theme = useTheme();
  const company = useQuery({ queryKey: ["company"], queryFn: () => api<CompanySettings>("/company") });
  const privacy = useQuery({ queryKey: ["privacy"], queryFn: () => api<PrivacyInfo>("/privacy") });
  const audit = useQuery({ queryKey: ["audit"], queryFn: () => api<AuditEntry[]>("/privacy/audit") });
  const [form, setForm] = useState<Partial<CompanySettings>>({});
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (company.data) setForm(company.data);
  }, [company.data]);

  const save = useMutation({
    mutationFn: (body: Partial<CompanySettings>) => api<CompanySettings>("/company", { method: "PUT", body }),
    onSuccess: () => {
      toast(t("settings.savedToast"));
      qc.invalidateQueries();
    },
    onError: (e) => toast(e instanceof Error ? e.message : t("common.error"), true),
  });
  const saveLocale = (l: Locale) => {
    setLocale(l);
    api("/me", { method: "PUT", body: { locale: l } }).catch(() => {});
  };

  if (company.isLoading) return <Loading />;
  const clean = (v: string | null | undefined) => (v === "" || v === undefined ? null : v);
  const submitCompany = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({
      name: form.name,
      name_ar: clean(form.name_ar),
      city: form.city,
      cr_number: clean(form.cr_number),
      vat_number: clean(form.vat_number),
      min_cash_buffer: Number(form.min_cash_buffer),
    } as Partial<CompanySettings>);
  };
  const submitContacts = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ alert_email: clean(form.alert_email), alert_phone: clean(form.alert_phone) } as Partial<CompanySettings>);
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{t("settings.title")}</h1>
          <p>{t("settings.subtitle")}</p>
        </div>
      </div>

      <div className="grid cols-2" style={{ alignItems: "start" }}>
        <form className="card stack" onSubmit={submitCompany}>
          <h2>{t("settings.company")}</h2>
          <div className="form-grid">
            <label className="field">
              <span>{t("settings.nameEn")}</span>
              <input className="input" value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} />
            </label>
            <label className="field">
              <span>{t("settings.nameAr")}</span>
              <input className="input" value={form.name_ar ?? ""} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} dir="rtl" />
            </label>
            <label className="field">
              <span>{t("settings.city")}</span>
              <input className="input" value={form.city ?? ""} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </label>
            <label className="field">
              <span>{t("settings.cr")}</span>
              <input className="input num" dir="ltr" inputMode="numeric" pattern="\d{10}" value={form.cr_number ?? ""} onChange={(e) => setForm({ ...form, cr_number: e.target.value })} />
            </label>
            <label className="field">
              <span>{t("settings.vat")}</span>
              <input className="input num" dir="ltr" inputMode="numeric" pattern="3\d{13}3" value={form.vat_number ?? ""} onChange={(e) => setForm({ ...form, vat_number: e.target.value })} />
            </label>
            <label className="field">
              <span>{t("settings.buffer")}</span>
              <input className="input num" type="number" min={0} step={5000} value={form.min_cash_buffer ?? 0} onChange={(e) => setForm({ ...form, min_cash_buffer: Number(e.target.value) })} />
              <span className="hint">{t("settings.bufferHint")}</span>
            </label>
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn primary" type="submit" disabled={save.isPending}>
              {t("common.save")}
            </button>
          </div>
        </form>

        <div className="stack" style={{ gap: 16 }}>
          <form className="card stack" onSubmit={submitContacts}>
            <h2>{t("settings.contacts")}</h2>
            <div className="form-grid">
              <label className="field">
                <span>{t("settings.alertEmail")}</span>
                <input className="input" type="email" dir="ltr" value={form.alert_email ?? ""} onChange={(e) => setForm({ ...form, alert_email: e.target.value })} />
              </label>
              <label className="field">
                <span>{t("settings.alertPhone")}</span>
                <input className="input num" dir="ltr" pattern="\+9665\d{8}" placeholder="+9665XXXXXXXX" value={form.alert_phone ?? ""} onChange={(e) => setForm({ ...form, alert_phone: e.target.value })} />
              </label>
            </div>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn" type="submit" disabled={save.isPending}>
                {t("common.save")}
              </button>
            </div>
          </form>

          <section className="card stack">
            <h2>{t("settings.preferences")}</h2>
            <div className="row between">
              <span className="small ink-2">{t("settings.language")}</span>
              <Segmented label={t("settings.language")} value={locale} onChange={saveLocale} options={[{ value: "ar", label: "العربية" }, { value: "en", label: "English" }]} />
            </div>
            <div className="row between">
              <span className="small ink-2">{t("settings.theme")}</span>
              <Segmented<ThemePref>
                label={t("settings.theme")}
                value={theme.pref}
                onChange={theme.set}
                options={[
                  { value: "system", label: t("settings.themeSystem") },
                  { value: "light", label: t("settings.themeLight") },
                  { value: "dark", label: t("settings.themeDark") },
                ]}
              />
            </div>
          </section>

          <PasswordCard />
        </div>
      </div>

      <section className="card">
        <div className="card-header">
          <div className="card-title">
            <ShieldCheck size={18} style={{ color: "var(--brand)" }} aria-hidden="true" />
            <div>
              <h2>{t("settings.security")}</h2>
              <div className="sub">{t("settings.securitySub")}</div>
            </div>
          </div>
        </div>
        {privacy.data && (
          <div className="grid cols-3" style={{ gap: 14 }}>
            <Info k={t("settings.dataRegion")} v={pick(privacy.data.data_region, privacy.data.data_region_ar)} />
            <Info k={t("settings.encryption")} v={pick(privacy.data.encryption_at_rest, privacy.data.encryption_at_rest_ar)} />
            <Info k={t("settings.passwords")} v={privacy.data.password_hashing} />
            <Info k={t("settings.bankAccess")} v={pick(privacy.data.bank_access, privacy.data.bank_access_ar)} />
            <Info k={t("settings.consentAt")} v={privacy.data.consent_recorded_at ? f.date(privacy.data.consent_recorded_at.slice(0, 10), "medium") : "—"} />
            <Info k={t("settings.frameworks")} v={pick(privacy.data.frameworks.join(" · "), privacy.data.frameworks_ar.join(" · "))} />
          </div>
        )}
        <hr className="divider" style={{ margin: "18px 0" }} />
        <div className="grid cols-2" style={{ gap: 20 }}>
          <div className="stack" style={{ gap: 10 }}>
            <div>
              <h3>{t("settings.export")}</h3>
              <p className="small muted">{t("settings.exportSub")}</p>
            </div>
            <div className="row">
              <button className="btn sm" onClick={() => download("/privacy/export", "siyulah-export.json").catch(() => toast(t("common.error"), true))}>
                <Download size={15} />
                {t("settings.export")}
              </button>
              <button className="btn danger sm" onClick={() => setDeleting(true)}>
                <Trash size={15} />
                {t("settings.deleteAccount")}
              </button>
            </div>
            <p className="xsmall muted">{t("settings.deleteSub")}</p>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            <div>
              <h3>{t("settings.audit")}</h3>
              <p className="small muted">{t("settings.auditSub")}</p>
            </div>
            <div className="list">
              {audit.data?.slice(0, 6).map((a) => (
                <div className="list-item small" key={a.id} style={{ padding: "7px 0" }}>
                  <code className="num" style={{ fontSize: 12.5 }}>
                    {a.action}
                  </code>
                  <span className="muted xsmall" style={{ marginInlineStart: "auto" }}>
                    {relTime(a.created_at, t)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
      {deleting && <DeleteModal onClose={() => setDeleting(false)} onDeleted={logout} />}
    </div>
  );
}

function Info({ k, v }: { k: string; v: string }) {
  return (
    <div className="stack" style={{ gap: 2 }}>
      <span className="xsmall muted">{k}</span>
      <span className="small">{v}</span>
    </div>
  );
}

function PasswordCard() {
  const { t } = useI18n();
  const toast = useToast();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const change = useMutation({
    mutationFn: () => api("/me/password", { method: "POST", body: { current_password: cur, new_password: next } }),
    onSuccess: () => {
      toast(t("settings.passwordToast"));
      setCur("");
      setNext("");
    },
    onError: (e) => toast(e instanceof Error ? e.message : t("common.error"), true),
  });
  return (
    <form
      className="card stack"
      onSubmit={(e) => {
        e.preventDefault();
        change.mutate();
      }}
    >
      <h2 className="row" style={{ gap: 8 }}>
        <KeyRound size={17} aria-hidden="true" />
        {t("settings.password")}
      </h2>
      <div className="form-grid">
        <label className="field">
          <span>{t("settings.currentPassword")}</span>
          <input className="input" type="password" dir="ltr" required value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" />
        </label>
        <label className="field">
          <span>{t("settings.newPassword")}</span>
          <input className="input" type="password" dir="ltr" required minLength={8} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        </label>
      </div>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn" type="submit" disabled={change.isPending}>
          {t("common.save")}
        </button>
      </div>
    </form>
  );
}

function DeleteModal({ onClose, onDeleted }: { onClose: () => void; onDeleted: () => void }) {
  const { t } = useI18n();
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const del = useMutation({
    mutationFn: () => api("/privacy/delete-account", { method: "POST", body: { confirm, password } }),
    onSuccess: onDeleted,
    onError: (e) => setError(e instanceof Error ? e.message : t("common.error")),
  });
  return (
    <Modal
      title={t("settings.deleteAccount")}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="btn danger" disabled={confirm !== "DELETE" || !password || del.isPending} onClick={() => del.mutate()}>
            <Trash size={15} />
            {t("common.delete")}
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="small">{t("settings.deleteConfirm")}</p>
        <input className="input" dir="ltr" placeholder="DELETE" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <input className="input" dir="ltr" type="password" placeholder={t("auth.password")} value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <div className="error-text">{error}</div>}
      </div>
    </Modal>
  );
}
