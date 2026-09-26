// Drives the real app (API + SPA) and records every API response it makes, so the
// static preview build (vite.preview.config.ts) can replay them without a server.
// Usage: BASE_URL=http://127.0.0.1:8000 node e2e/record-fixtures.mjs
import { chromium } from "playwright-core";
import crypto from "node:crypto";
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:8000";
const OUT = process.env.OUT ?? "src/preview/fixtures.json";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
await page.addInitScript(() => localStorage.setItem("siyulah.locale", "en"));

const responses = {};
const pending = new Set();
page.on("requestfinished", async (req) => {
  const url = new URL(req.url());
  if (!url.pathname.startsWith("/api/")) return;
  const job = (async () => {
    const res = await req.response();
    if (!res || res.status() >= 400 || res.status() === 204) return;
    const path = url.pathname.slice(4) + url.search;
    const key = req.method() === "POST" && path === "/scenarios/preview" ? `POST ${path} ${req.postData()}` : `${req.method()} ${path}`;
    if (req.method() !== "GET" && !key.startsWith("POST /scenarios/preview")) return;
    try {
      responses[key] = await res.json();
    } catch {
      /* not JSON */
    }
  })();
  pending.add(job);
  job.finally(() => pending.delete(job));
});

const settle = async () => {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(700); // scenario preview is debounced
  await page.waitForLoadState("networkidle");
  await Promise.all([...pending]);
};
const nav = async (href) => {
  await page.click(`a.nav-item[href="${href}"]`);
  await settle();
};

await page.goto(`${BASE}/login`);
await page.click("[data-testid=demo-login]");
await page.waitForSelector("[data-testid=cash-on-hand]");
await settle();
for (const h of ["60 days", "30 days", "90 days"]) {
  await page.click(`.segmented button:has-text("${h}")`);
  await settle();
}

// Every suggested action opened in the planner.
const suggestions = await page.locator("button:has-text('Try in planner')").count();
for (let i = 0; i < suggestions; i++) {
  await nav("/");
  await page.locator("button:has-text('Try in planner')").nth(i).click();
  await settle();
}

// Saved scenarios, an empty draft, one change of each type, and the presets.
await nav("/scenarios");
const saved = await page.locator(".scenario-item").count();
for (let i = 0; i < saved; i++) {
  await page.locator(".scenario-item").nth(i).click();
  await settle();
}
const types = await page.$$eval("select[aria-label='Add a change'] option", (os) => os.map((o) => o.value).filter(Boolean));
for (const type of types) {
  await page.click("button:has-text('New scenario')");
  await settle();
  await page.selectOption("select[aria-label='Add a change']", type);
  await settle();
}
for (const preset of ["Hire 2 staff", "Sales drop 20%", "Extra stock order", "Kafalah facility"]) {
  await page.click("button:has-text('New scenario')");
  await settle();
  await page.click(`button:has-text('${preset}')`);
  await settle();
}

// Tracker: every tab and status filter.
await nav("/tracker");
for (const tab of ["Receivables", "Payables"]) {
  await page.click(`[role=tab]:has-text('${tab}')`);
  await settle();
  for (const s of ["Overdue", "Paid", "All", "Open"]) {
    await page.click(`.segmented button:has-text('${s}')`);
    await settle();
  }
}
await page.click("[role=tab]:has-text('Major payments')");
await settle();

await nav("/alerts");
await page.click("[role=tab]:has-text('Resolved')");
await settle();
await nav("/integrations");
await nav("/settings");
await browser.close();

// Scenario previews share one baseline: store it once.
const baselines = {};
for (const [key, value] of Object.entries(responses)) {
  if (!key.startsWith("POST /scenarios/preview") || !value?.baseline) continue;
  const json = JSON.stringify(value.baseline);
  const ref = crypto.createHash("sha1").update(json).digest("hex").slice(0, 10);
  baselines[ref] = value.baseline;
  delete value.baseline;
  value.baselineRef = ref;
}
const today = responses["GET /dashboard?horizon=90"]?.as_of;
const out = { today, now: Date.now(), baselines, responses };
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`recorded ${Object.keys(responses).length} responses (${Object.keys(baselines).length} baseline) for ${today} → ${OUT} (${(fs.statSync(OUT).size / 1e6).toFixed(2)} MB)`);
