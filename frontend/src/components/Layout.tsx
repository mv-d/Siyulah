import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bell, FlaskConical, LayoutDashboard, Languages, LogOut, Menu, Moon, Plug, ReceiptText, Settings, Sun } from "lucide-react";
import { api } from "../api/client";
import type { AlertItem } from "../api/types";
import { useI18n } from "../i18n";
import { useAuth } from "../lib/auth";
import { isDark, useTheme } from "../lib/theme";
import { initials, todayRiyadh } from "../lib/util";
import { BrandMark } from "./ui";

export function Layout() {
  const { t, f, locale, setLocale, pick } = useI18n();
  const { me, logout } = useAuth();
  const { set: setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(isDark);
  const location = useLocation();
  const alerts = useQuery({ queryKey: ["alerts", "active"], queryFn: () => api<AlertItem[]>("/alerts?status=active"), refetchInterval: 120_000 });
  const unread = alerts.data?.filter((a) => !a.read_at).length ?? 0;
  const iso = todayRiyadh();

  const nav = [
    { to: "/", icon: LayoutDashboard, label: t("nav.dashboard"), end: true },
    { to: "/scenarios", icon: FlaskConical, label: t("nav.scenarios") },
    { to: "/tracker", icon: ReceiptText, label: t("nav.tracker") },
    { to: "/alerts", icon: Bell, label: t("nav.alerts"), count: unread },
    { to: "/integrations", icon: Plug, label: t("nav.integrations") },
    { to: "/settings", icon: Settings, label: t("nav.settings") },
  ];
  const title = nav.find((n) => (n.end ? location.pathname === n.to : location.pathname.startsWith(n.to)))?.label ?? "";
  const companyName = me ? pick(me.company.name, me.company.name_ar) : "";

  return (
    <div className="shell">
      <aside className={`sidebar${open ? " open" : ""}`} aria-label={t("nav.menu")}>
        <NavLink to="/" className="brand" onClick={() => setOpen(false)}>
          <BrandMark />
          <span>
            <div className="brand-name">{t("app.name")}</div>
            <div className="brand-sub">{t("app.tagline")}</div>
          </span>
        </NavLink>
        <nav className="nav">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-item${isActive ? " active" : ""}`} onClick={() => setOpen(false)}>
              <n.icon size={19} aria-hidden="true" />
              <span>{n.label}</span>
              {!!n.count && <span className="count" aria-label={`${n.count}`}>{n.count}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="company-chip">
            <span className="avatar">{initials(me?.full_name ?? "")}</span>
            <div className="meta">
              <div style={{ fontWeight: 500, fontSize: 13.5 }}>{me?.full_name}</div>
              <div className="xsmall muted">{companyName}</div>
            </div>
          </div>
          <button className="btn ghost sm" style={{ justifyContent: "flex-start" }} onClick={logout}>
            <LogOut size={16} />
            {t("nav.logout")}
          </button>
        </div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <div className="main">
        <header className="topbar">
          <button className="btn ghost icon menu-btn" onClick={() => setOpen(true)} aria-label={t("nav.menu")}>
            <Menu size={20} />
          </button>
          <div className="dates">
            <strong style={{ fontSize: 14.5 }}>{title}</strong>
            <span className="xsmall muted">
              {f.date(iso, "long")} · {f.hijri(iso)}
            </span>
          </div>
          <div className="spacer" />
          <button className="btn ghost sm" onClick={() => setLocale(locale === "ar" ? "en" : "ar")} aria-label="Language">
            <Languages size={17} />
            {t("common.language")}
          </button>
          <button
            className="btn ghost icon sm"
            aria-label={dark ? t("common.themeLight") : t("common.themeDark")}
            onClick={() => {
              setTheme(dark ? "light" : "dark");
              setDark(!dark);
            }}
          >
            {dark ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <NavLink to="/alerts" className="btn ghost icon sm" aria-label={t("nav.alerts")} style={{ position: "relative" }}>
            <Bell size={17} />
            {unread > 0 && (
              <span
                style={{ position: "absolute", top: 3, insetInlineEnd: 3, width: 8, height: 8, borderRadius: 999, background: "var(--critical)" }}
              />
            )}
          </NavLink>
        </header>
        <Outlet />
      </div>
    </div>
  );
}
