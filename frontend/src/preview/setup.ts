/**
 * Static preview runtime. Serves API responses recorded from the real Siyulah
 * backend (see e2e/record-fixtures.mjs) so the app runs as a single file without
 * a server. Scenarios are computed in the browser by replaying the server's own
 * Monte Carlo draws (see ./engine.ts). Writes are refused politely.
 */
import { ApiError } from "../api/client";
import type { Adjustment, TransactionItem } from "../api/types";
import { PreviewEngine, type EngineExport } from "./engine";
import fixtures from "./fixtures.json";

type Profile = "retail" | "services";
interface ProfileData {
  responses: Record<string, unknown>;
  engine: EngineExport;
  transactions: { total: number; items: TransactionItem[] };
}
interface Fixtures {
  today: string;
  now: number;
  profiles: Record<Profile, ProfileData>;
}

const data = fixtures as unknown as Fixtures;
const engines = new Map<Profile, PreviewEngine>();
const TOKEN_KEY = "siyulah.token";

function readProfile(): Profile {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token === "preview-services") return "services";
  } catch {
    /* storage unavailable */
  }
  return "retail";
}

let active: Profile = readProfile();
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function readOnly(): ApiError {
  const ar = document.documentElement.lang === "ar";
  return new ApiError(418, ar ? "معاينة للقراءة فقط. شغّل التطبيق لحفظ التغييرات." : "Read-only preview. Run the app to save changes.");
}

function engine(): PreviewEngine {
  let e = engines.get(active);
  if (!e) {
    e = new PreviewEngine(data.profiles[active].engine);
    engines.set(active, e);
  }
  return e;
}

function filterInvoices(p: ProfileData, url: URL): unknown | undefined {
  const q = (url.searchParams.get("q") ?? "").toLowerCase();
  url.searchParams.delete("q");
  const base = p.responses[`GET ${url.pathname}${url.search}`];
  if (!Array.isArray(base)) return undefined;
  return base.filter((i: Record<string, string | null>) =>
    [i.number, i.counterparty, i.counterparty_ar].some((v) => (v ?? "").toLowerCase().includes(q)),
  );
}

function filterTransactions(p: ProfileData, url: URL) {
  const q = (url.searchParams.get("q") ?? "").toLowerCase();
  const category = url.searchParams.get("category");
  const limit = Number(url.searchParams.get("limit") ?? 50);
  const rows = p.transactions.items.filter(
    (t) => (!category || t.category === category) && (!q || t.description.toLowerCase().includes(q)),
  );
  return { total: rows.length, items: rows.slice(0, limit) };
}

window.__SIYULAH_PREVIEW__ = {
  today: data.today,
  now: data.now,
  async handle(method, path, body) {
    const url = new URL(path, "http://preview");
    if (method === "POST" && url.pathname === "/auth/demo") {
      active = url.searchParams.get("profile") === "services" ? "services" : "retail";
      await delay(150);
      return { access_token: `preview-${active}` };
    }
    if (method === "POST" && url.pathname === "/auth/login") {
      active = "retail";
      return { access_token: "preview-retail" };
    }
    const p = data.profiles[active];
    if (method === "POST" && url.pathname === "/scenarios/preview") {
      await delay(30);
      return engine().compare(((body as { adjustments?: Adjustment[] })?.adjustments ?? []) as Adjustment[]);
    }
    await delay(method === "GET" ? 50 : 120);
    const key = `${method} ${path}`;
    if (key in p.responses) return clone(p.responses[key]);
    if (method === "GET" && url.pathname === "/transactions") return filterTransactions(p, url);
    if (method === "GET" && url.pathname === "/invoices" && url.searchParams.has("q")) {
      const filtered = filterInvoices(p, url);
      if (filtered) return filtered;
    }
    if (method === "GET") throw new ApiError(404, "Not recorded in this preview");
    throw readOnly();
  },
};
