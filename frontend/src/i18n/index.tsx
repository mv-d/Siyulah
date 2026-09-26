import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ar } from "./ar";
import { en } from "./en";

export type Locale = "ar" | "en";
const DICTS = { ar, en } as const;
const STORAGE_KEY = "siyulah.locale";
const LRI = "⁦";
const PDI = "⁩";

type Params = Record<string, string | number>;

function lookup(dict: unknown, path: string): string | undefined {
  let cur: unknown = dict;
  for (const part of path.split(".")) {
    if (cur && typeof cur === "object" && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part];
    } else return undefined;
  }
  return typeof cur === "string" ? cur : undefined;
}

export function parseDate(d: string | Date): Date {
  if (d instanceof Date) return d;
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, day);
}

function readStoredLocale(): Locale {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "ar" || v === "en") return v;
  } catch {
    /* storage unavailable */
  }
  return "ar";
}

export function makeFormatters(locale: Locale) {
  const tag = locale === "ar" ? "ar-SA-u-nu-latn" : "en-US";
  const dateTag = locale === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB";
  const n0 = new Intl.NumberFormat(tag, { maximumFractionDigits: 0 });
  const compact = new Intl.NumberFormat(tag, { notation: "compact", maximumFractionDigits: 1 });
  const cur = locale === "ar" ? "ر.س" : "SAR";

  const number = (v: number) => n0.format(Math.round(v));
  /** Digits and the compact unit word ("ألف", "K") separately, so bidi isolation can wrap only the digits. */
  const compactParts = (v: number): [string, string] => {
    if (Math.abs(v) < 10_000) return [n0.format(Math.round(v)), ""];
    const parts = compact.formatToParts(v);
    const digits = parts.filter((p) => p.type !== "compact" && p.type !== "literal").map((p) => p.value).join("");
    const unit = parts.filter((p) => p.type === "compact").map((p) => p.value).join("");
    return [digits, unit];
  };
  const compactNum = (v: number) => {
    const [digits, unit] = compactParts(v);
    if (!unit) return locale === "ar" ? `${LRI}${digits}${PDI}` : digits;
    return locale === "ar" ? `${LRI}${digits}${PDI} ${unit}` : `${digits}${unit}`;
  };
  /** Plain-text money, bidi-isolated so the minus sign stays attached in RTL. */
  const money = (v: number, opts: { compact?: boolean; sign?: boolean } = {}) => {
    const sign = v < 0 ? "-" : opts.sign && v > 0 ? "+" : "";
    const [digits, unit] = opts.compact ? compactParts(Math.abs(v)) : [number(Math.abs(v)), ""];
    if (locale === "ar") return `${LRI}${sign}${digits}${PDI}${unit ? ` ${unit}` : ""} ${cur}`;
    return `${sign}${cur} ${digits}${unit}`;
  };
  const date = (d: string | Date, style: "short" | "medium" | "long" | "weekday" = "short") => {
    const dt = parseDate(d);
    const opts: Intl.DateTimeFormatOptions =
      style === "short"
        ? { day: "numeric", month: "short" }
        : style === "medium"
          ? { day: "numeric", month: "short", year: "numeric" }
          : style === "weekday"
            ? { weekday: "short", day: "numeric", month: "short" }
            : { weekday: "long", day: "numeric", month: "long", year: "numeric" };
    return new Intl.DateTimeFormat(dateTag, opts).format(dt);
  };
  const hijri = (d: string | Date) =>
    new Intl.DateTimeFormat(locale === "ar" ? "ar-SA-u-ca-islamic-umalqura-nu-latn" : "en-US-u-ca-islamic-umalqura", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(parseDate(d));
  const pct = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`;
  const month = (d: string | Date) => new Intl.DateTimeFormat(dateTag, { month: "short" }).format(parseDate(d));
  return { number, compactNum, compactParts, money, date, hijri, pct, month, currency: cur };
}

export type Formatters = ReturnType<typeof makeFormatters>;

interface I18nValue {
  locale: Locale;
  dir: "rtl" | "ltr";
  setLocale: (l: Locale) => void;
  t: (path: string, params?: Params) => string;
  f: Formatters;
  /** Pick the localized variant of a bilingual API field. */
  pick: (en: string | null | undefined, ar: string | null | undefined) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readStoredLocale);
  const dir = locale === "ar" ? "rtl" : "ltr";

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
    document.title = locale === "ar" ? "سيولة | Siyulah" : "Siyulah | سيولة";
  }, [locale, dir]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<I18nValue>(() => {
    const dict = DICTS[locale];
    const t = (path: string, params?: Params) => {
      let s = lookup(dict, path) ?? lookup(en, path) ?? path;
      if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
      return s;
    };
    const pick = (e: string | null | undefined, a: string | null | undefined) => (locale === "ar" ? a || e || "" : e || a || "");
    return { locale, dir, setLocale, t, f: makeFormatters(locale), pick };
  }, [locale, dir, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n outside provider");
  return ctx;
}
