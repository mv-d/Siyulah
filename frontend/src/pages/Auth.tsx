import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BookOpen, Briefcase, ChartLine, Languages, Lock, Sparkles, Store } from "lucide-react";
import { ApiError } from "../api/client";
import { useI18n } from "../i18n";
import { useAuth } from "../lib/auth";
import { useStory, type StoryId } from "../lib/stories";
import { BrandMark } from "../components/ui";

function Aside() {
  const { t } = useI18n();
  return (
    <aside className="auth-aside">
      <div className="row" style={{ gap: 12 }}>
        <BrandMark size={40} />
        <div>
          <div style={{ fontWeight: 700, fontSize: 20 }}>سيولة · Siyulah</div>
          <div style={{ color: "#9fd8c8", fontSize: 13 }}>{t("app.tagline")}</div>
        </div>
      </div>
      <div className="stack" style={{ gap: 18 }}>
        <h1>{t("auth.heroTitle")}</h1>
        <p>{t("auth.heroSub")}</p>
        <HeroChart />
      </div>
      <div className="points">
        <div className="point">
          <Lock size={18} style={{ flex: "none", marginTop: 3 }} />
          <span>{t("auth.point1")}</span>
        </div>
        <div className="point">
          <ChartLine size={18} style={{ flex: "none", marginTop: 3 }} />
          <span>{t("auth.point2")}</span>
        </div>
        <div className="point">
          <Sparkles size={18} style={{ flex: "none", marginTop: 3 }} />
          <span>{t("auth.point3")}</span>
        </div>
      </div>
    </aside>
  );
}

/** Decorative preview of a forecast (not data). */
function HeroChart() {
  return (
    <svg viewBox="0 0 480 150" width="100%" style={{ maxWidth: 520 }} aria-hidden="true">
      <path d="M240 60 C 290 70, 310 110, 350 118 S 420 70, 480 50 L480 100 C 420 125, 390 150, 350 148 S 290 100, 240 60Z" fill="rgba(255,255,255,0.12)" />
      <path d="M0 90 C 40 80, 70 95, 110 70 S 190 55, 240 60" fill="none" stroke="#e8fbf5" strokeWidth="3" strokeLinecap="round" />
      <path d="M240 60 C 290 80, 310 120, 350 132 S 420 90, 480 75" fill="none" stroke="#e8fbf5" strokeWidth="3" strokeDasharray="7 6" strokeLinecap="round" />
      <line x1="0" x2="480" y1="120" y2="120" stroke="#fab219" strokeWidth="1.5" strokeDasharray="6 5" />
      <circle cx="240" cy="60" r="6" fill="#e8fbf5" />
      <circle cx="350" cy="132" r="6" fill="#ff8a7a" stroke="#0b4f41" strokeWidth="2" />
    </svg>
  );
}

function LangToggle() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className="auth-top">
      <button className="btn ghost sm" onClick={() => setLocale(locale === "ar" ? "en" : "ar")}>
        <Languages size={16} />
        {t("common.language")}
      </button>
    </div>
  );
}

export function LoginPage() {
  const { t } = useI18n();
  const { login, demo } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"login" | "demo" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy("login");
    setError(null);
    try {
      await login(email, password);
      nav("/");
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? err.message : t("auth.invalid"));
    } finally {
      setBusy(null);
    }
  };
  const story = useStory();
  const tryDemo = async (profile: "retail" | "services" = "retail") => {
    setBusy("demo");
    setError(null);
    try {
      await demo(profile);
      nav("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="auth">
      <Aside />
      <main className="auth-main" style={{ position: "relative" }}>
        <LangToggle />
        <div className="auth-card">
          <div>
            <h1>{t("auth.welcome")}</h1>
            <p className="muted" style={{ marginTop: 6 }}>
              {t("auth.loginSub")}
            </p>
          </div>
          <button className="btn primary lg block" onClick={() => tryDemo("retail")} disabled={!!busy} data-testid="demo-login">
            {busy === "demo" ? <span className="spinner" /> : <Sparkles size={18} />}
            {t("auth.tryDemo")}
          </button>
          <div className="stack" style={{ gap: 8 }}>
            <span className="xsmall muted">{t("demo.choose")}</span>
            <div className="demo-cards">
              <button className="demo-card" onClick={() => tryDemo("retail")} disabled={!!busy} data-testid="demo-retail">
                <Store size={18} style={{ color: "var(--brand)", flex: "none", marginTop: 2 }} aria-hidden="true" />
                <span className="stack" style={{ gap: 2 }}>
                  <strong className="small">{t("demo.retail")}</strong>
                  <span className="xsmall muted">{t("demo.retailWho")}</span>
                </span>
              </button>
              <button className="demo-card" onClick={() => tryDemo("services")} disabled={!!busy} data-testid="demo-services">
                <Briefcase size={18} style={{ color: "var(--brand)", flex: "none", marginTop: 2 }} aria-hidden="true" />
                <span className="stack" style={{ gap: 2 }}>
                  <strong className="small">{t("demo.services")}</strong>
                  <span className="xsmall muted">{t("demo.servicesWho")}</span>
                </span>
              </button>
            </div>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            <span className="xsmall muted row" style={{ gap: 6 }}>
              <BookOpen size={14} aria-hidden="true" />
              {t("stories.title")} · {t("stories.subtitle")}
            </span>
            <div className="story-cards">
              {(["retail", "services"] as StoryId[]).map((id) => (
                <button key={id} className="story-card" onClick={() => story.start(id)} disabled={!!busy} data-testid={`story-${id}`}>
                  <strong className="small">{t(`stories.${id}.title`)}</strong>
                  <span className="xsmall muted">{t(`stories.${id}.who`)}</span>
                  <span className="xsmall" style={{ color: "var(--brand)", fontWeight: 600 }}>{t("stories.start")} →</span>
                </button>
              ))}
            </div>
          </div>
          <div className="or">{t("auth.or")}</div>
          <form className="stack" onSubmit={submit}>
            <label className="field">
              <span>{t("auth.email")}</span>
              <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" />
            </label>
            <label className="field">
              <span>{t("auth.password")}</span>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                dir="ltr"
              />
            </label>
            {error && <div className="error-text" role="alert">{error}</div>}
            <button className="btn block" type="submit" disabled={!!busy}>
              {busy === "login" && <span className="spinner" />}
              {t("auth.login")}
            </button>
          </form>
          <p className="small muted" style={{ textAlign: "center" }}>
            {t("auth.noAccount")} <Link to="/register">{t("auth.createAccount")}</Link>
          </p>
        </div>
      </main>
    </div>
  );
}

export function RegisterPage() {
  const { t, locale } = useI18n();
  const { register } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ full_name: "", email: "", password: "", company_name: "", sector: "retail", pdpl_consent: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: string | boolean) => setForm((s) => ({ ...s, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register({ ...form, locale });
      nav("/onboarding");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <Aside />
      <main className="auth-main" style={{ position: "relative" }}>
        <LangToggle />
        <form className="auth-card" onSubmit={submit}>
          <div>
            <h1>{t("auth.registerTitle")}</h1>
            <p className="muted" style={{ marginTop: 6 }}>
              {t("auth.registerSub")}
            </p>
          </div>
          <label className="field">
            <span>{t("auth.fullName")}</span>
            <input className="input" required minLength={2} value={form.full_name} onChange={(e) => set("full_name", e.target.value)} />
          </label>
          <label className="field">
            <span>{t("auth.companyName")}</span>
            <input className="input" required minLength={2} value={form.company_name} onChange={(e) => set("company_name", e.target.value)} />
          </label>
          <label className="field">
            <span>{t("auth.sector")}</span>
            <select className="select" value={form.sector} onChange={(e) => set("sector", e.target.value)}>
              <option value="retail">{t("auth.sectorRetail")}</option>
              <option value="services">{t("auth.sectorServices")}</option>
            </select>
          </label>
          <label className="field">
            <span>{t("auth.email")}</span>
            <input className="input" type="email" required value={form.email} onChange={(e) => set("email", e.target.value)} dir="ltr" autoComplete="email" />
          </label>
          <label className="field">
            <span>{t("auth.password")}</span>
            <input
              className="input"
              type="password"
              required
              minLength={8}
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              dir="ltr"
              autoComplete="new-password"
            />
          </label>
          <label className="checkbox small ink-2">
            <input type="checkbox" required checked={form.pdpl_consent} onChange={(e) => set("pdpl_consent", e.target.checked)} />
            <span>{t("auth.consent")}</span>
          </label>
          {error && <div className="error-text" role="alert">{error}</div>}
          <button className="btn primary lg block" type="submit" disabled={busy}>
            {busy && <span className="spinner" />}
            {t("auth.register")}
          </button>
          <p className="small muted" style={{ textAlign: "center" }}>
            {t("auth.haveAccount")} <Link to="/login">{t("auth.login")}</Link>
          </p>
        </form>
      </main>
    </div>
  );
}
