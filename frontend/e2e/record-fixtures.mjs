// Drives the real app (API + SPA) for each demo company and records every API response
// it makes, plus the engine export used to replay scenarios in the browser. The static
// preview build (vite.preview.config.ts) serves these without a server.
// Usage: BASE_URL=http://127.0.0.1:8000 node e2e/record-fixtures.mjs
import { chromium } from "playwright-core";
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:8000";
const OUT = process.env.OUT ?? "src/preview/fixtures.json";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });

async function record(profile) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem("siyulah.locale", "en"));
  const responses = {};
  const pending = new Set();
  page.on("requestfinished", (req) => {
    const url = new URL(req.url());
    if (!url.pathname.startsWith("/api/")) return;
    const job = (async () => {
      const res = await req.response();
      if (!res || res.status() >= 400 || res.status() === 204) return;
      const path = url.pathname.slice(4) + url.search;
      const isPreview = req.method() === "POST" && path === "/scenarios/preview";
      if (req.method() !== "GET" && !isPreview) return;
      const key = isPreview ? `POST ${path} ${req.postData()}` : `GET ${path}`;
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
  await page.click(`[data-testid=demo-${profile}]`);
  await page.waitForSelector("[data-testid=cash-on-hand]");
  await settle();
  for (const h of ["60 days", "30 days", "90 days"]) {
    await page.click(`.segmented button:has-text("${h}")`);
    await settle();
  }
  const suggestions = await page.locator("button:has-text('Try in planner')").count();
  for (let i = 0; i < suggestions; i++) {
    await nav("/");
    await page.locator("button:has-text('Try in planner')").nth(i).click();
    await settle();
  }
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
  await nav("/collections");
  await nav("/activity");
  await page.click(`.segmented button:has-text("90 days")`);
  await settle();
  await nav("/alerts");
  await page.click("[role=tab]:has-text('Resolved')");
  await settle();
  await nav("/integrations");
  await nav("/settings");

  // Data the app fetches with arbitrary parameters, served by the preview runtime.
  const token = await page.evaluate(() => localStorage.getItem("siyulah.token"));
  const get = async (path) => (await fetch(`${BASE}/api${path}`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const engine = await get("/forecast/engine");
  const transactions = await get("/transactions?limit=500");
  await ctx.close();

  // Split the server's scenario results out: they validate the browser engine, and the
  // preview computes scenarios itself.
  const previews = {};
  for (const key of Object.keys(responses)) {
    if (key.startsWith("POST /scenarios/preview")) {
      previews[key.slice("POST /scenarios/preview ".length)] = responses[key];
      delete responses[key];
    }
  }
  return { responses, engine, transactions, previews };
}

const profiles = {};
for (const p of ["retail", "services"]) {
  profiles[p] = await record(p);
  console.log(`${p}: ${Object.keys(profiles[p].responses).length} responses, ${Object.keys(profiles[p].previews).length} scenario checks`);
}
await browser.close();

const today = profiles.retail.responses["GET /dashboard?horizon=90"]?.as_of;
const validation = Object.fromEntries(Object.entries(profiles).map(([k, v]) => [k, v.previews]));
for (const v of Object.values(profiles)) delete v.previews;
fs.writeFileSync(OUT, JSON.stringify({ today, now: Date.now(), profiles }));
fs.writeFileSync(OUT.replace(/\.json$/, ".validation.json"), JSON.stringify(validation));
console.log(`fixtures for ${today} → ${OUT} (${(fs.statSync(OUT).size / 1e6).toFixed(2)} MB)`);
