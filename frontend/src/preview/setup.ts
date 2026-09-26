/**
 * Static preview runtime. Serves API responses recorded from the real Siyulah
 * backend (see e2e/record-fixtures.mjs) so the app can run as a single file
 * without a server. Reads come from the recording; writes are refused politely.
 */
import { ApiError } from "../api/client";
import fixtures from "./fixtures.json";

interface Fixtures {
  today: string;
  now: number;
  baselines: Record<string, unknown>;
  responses: Record<string, unknown>;
}

const data = fixtures as unknown as Fixtures;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function readOnly(): ApiError {
  const ar = document.documentElement.lang === "ar";
  return new ApiError(418, ar ? "معاينة للقراءة فقط. شغّل التطبيق لحفظ التغييرات." : "Read-only preview. Run the app to save changes.");
}

/** Scenario previews share one baseline per horizon; re-attach it. */
function hydrate(value: unknown): unknown {
  if (value && typeof value === "object" && "baselineRef" in (value as Record<string, unknown>)) {
    const { baselineRef, ...rest } = value as Record<string, unknown>;
    return { ...rest, baseline: data.baselines[String(baselineRef)] };
  }
  return value;
}

function filterInvoices(path: string): unknown | undefined {
  const url = new URL(path, "http://preview");
  const q = (url.searchParams.get("q") ?? "").toLowerCase();
  url.searchParams.delete("q");
  const base = data.responses[`GET ${url.pathname}${url.search}`];
  if (!Array.isArray(base)) return undefined;
  return base.filter((i: Record<string, string | null>) =>
    [i.number, i.counterparty, i.counterparty_ar].some((v) => (v ?? "").toLowerCase().includes(q)),
  );
}

window.__SIYULAH_PREVIEW__ = {
  today: data.today,
  now: data.now,
  async handle(method, path, body) {
    await delay(method === "GET" ? 60 : 140);
    if (method === "POST" && (path === "/auth/demo" || path === "/auth/login")) return { access_token: "preview" };
    const key = method === "POST" && path === "/scenarios/preview" ? `POST ${path} ${JSON.stringify(body)}` : `${method} ${path}`;
    if (key in data.responses) return clone(hydrate(data.responses[key]));
    if (method === "GET" && path.startsWith("/invoices?") && path.includes("q=")) {
      const filtered = filterInvoices(path);
      if (filtered) return filtered;
    }
    if (method === "GET") throw new ApiError(404, "Not recorded in this preview");
    throw readOnly();
  },
};
