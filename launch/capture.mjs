// Captures the 16:9 product shots used by the launch video (and the pitch deck) from the
// running app. Start the app first (./scripts/start.sh), then:
//   BASE_URL=http://127.0.0.1:8000 node capture.mjs
import { chromium } from "playwright-core";
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:8000";
const OUT = process.env.OUT ?? "public/shots";
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });

async function open(locale, profile, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 1.5, ...opts });
  const page = await ctx.newPage();
  await page.addInitScript((l) => {
    localStorage.setItem("siyulah.locale", l);
    localStorage.setItem("siyulah.theme", "light");
  }, locale);
  await page.goto(`${BASE}/login`);
  await page.waitForSelector(`[data-testid=demo-${profile ?? "retail"}]`);
  await page.waitForTimeout(300);
  return { ctx, page };
}
const settle = async (page, ms = 700) => {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(ms);
};
const shot = async (page, name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`• ${name}`);
};
async function demo(page, profile) {
  await page.click(`[data-testid=demo-${profile}]`);
  await page.waitForSelector("[data-testid=cash-on-hand]", { timeout: 20000 });
  await settle(page, 900);
}
async function nav(page, href) {
  await page.click(`a.nav-item[href="${href}"]`);
  await settle(page);
}

// English, retail (Nakhla)
{
  const { ctx, page } = await open("en", "retail");
  await shot(page, "en-login");
  await demo(page, "retail");
  await shot(page, "en-dashboard");
  const tryIt = page.locator("button:has-text('Try in planner')").first();
  await tryIt.scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(300);
  await shot(page, "en-suggestions");
  await tryIt.click();
  await page.waitForSelector(".delta");
  await settle(page, 1000);
  await shot(page, "en-scenario-defer");
  await nav(page, "/scenarios");
  await page.locator(".scenario-item", { hasText: "Al-Ofoq" }).first().click();
  await settle(page, 1000);
  await shot(page, "en-scenario-ofoq");
  await nav(page, "/alerts");
  await shot(page, "en-alerts");
  await nav(page, "/tracker");
  await shot(page, "en-tracker");
  await ctx.close();
}

// English, services (Wamda)
{
  const { ctx, page } = await open("en", "services");
  await demo(page, "services");
  await shot(page, "en-agency-dashboard");
  await nav(page, "/collections");
  await page.waitForSelector("[data-testid=draft-reminder]");
  await shot(page, "en-collections");
  await page.locator("[data-testid=draft-reminder]").first().click();
  await page.waitForSelector("#reminder-text");
  await page.waitForTimeout(400);
  await shot(page, "en-reminder");
  await page.keyboard.press("Escape");
  await nav(page, "/activity");
  await shot(page, "en-activity");
  // Guided story: step 4 is "hire + collect Makkah first"
  await page.click("[data-testid=story-menu]");
  await page.click(".story-menu .story-card >> nth=1");
  await page.waitForSelector(".story-panel");
  for (let i = 1; i <= 4; i++) {
    await settle(page, 1100);
    if (i === 1 || i === 4) await shot(page, `en-story-services-${i}`);
    if (i < 4) await page.click("[data-testid=story-next]");
  }
  await ctx.close();
}

// Arabic (RTL)
{
  const { ctx, page } = await open("ar", "retail");
  await shot(page, "ar-login");
  await demo(page, "retail");
  await shot(page, "ar-dashboard");
  await nav(page, "/scenarios");
  await page.locator(".scenario-item").first().click();
  await settle(page, 1000);
  await shot(page, "ar-scenarios");
  await ctx.close();
}
{
  const { ctx, page } = await open("ar", "services");
  await demo(page, "services");
  await nav(page, "/collections");
  await page.waitForSelector("[data-testid=draft-reminder]");
  await shot(page, "ar-collections");
  await ctx.close();
}
{
  const { ctx, page } = await open("ar", "retail", { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2.5, isMobile: true, hasTouch: true });
  await demo(page, "retail");
  await shot(page, "ar-mobile-dashboard");
  await ctx.close();
}

await browser.close();
