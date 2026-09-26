// End-to-end smoke test: drives the real app (API + SPA) in Chromium and saves screenshots.
// Usage: BASE_URL=http://127.0.0.1:8000 SHOTS=./shots node e2e/smoke.mjs
import { chromium } from "playwright-core";
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:8000";
const SHOTS = process.env.SHOTS ?? "./e2e-shots";
const exe = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";
fs.mkdirSync(SHOTS, { recursive: true });

const errors = [];
const browser = await chromium.launch({ executablePath: exe });

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, ...opts });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  return { ctx, page };
}
const shot = (page, name, full = true) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
const step = (s) => console.log(`• ${s}`);

// 1) Demo walkthrough in Arabic (RTL)
{
  const { ctx, page } = await newPage({ locale: "ar-SA" });
  await page.goto(`${BASE}/login`);
  await page.waitForSelector("[data-testid=demo-login]");
  await shot(page, "01-login-ar", false);
  step("login page (ar)");

  await page.click("[data-testid=demo-login]");
  await page.waitForSelector("[data-testid=cash-on-hand]", { timeout: 20000 });
  await page.waitForTimeout(400);
  const dir = await page.evaluate(() => document.documentElement.dir);
  if (dir !== "rtl") errors.push(`expected rtl, got ${dir}`);
  await shot(page, "02-dashboard-ar");
  step("dashboard (ar)");

  const chart = page.locator(".chart").first();
  const box = await chart.boundingBox();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await page.waitForTimeout(150);
  await chart.screenshot({ path: `${SHOTS}/03-chart-tooltip-ar.png` });
  if (!(await page.locator(".chart-tooltip").count())) errors.push("tooltip did not appear on hover");
  step("chart tooltip");

  for (const [path, name] of [
    ["/scenarios", "04-scenarios-ar"],
    ["/tracker", "05-tracker-ar"],
    ["/alerts", "06-alerts-ar"],
    ["/integrations", "07-integrations-ar"],
    ["/settings", "08-settings-ar"],
  ]) {
    await page.click(`a.nav-item[href="${path}"]`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    await shot(page, name);
    step(`${path} (ar)`);
  }

  // Scenario: apply a dashboard suggestion in the planner
  await page.click('a.nav-item[href="/"]');
  await page.waitForSelector("[data-testid=cash-on-hand]");
  const trySuggestion = page.locator("button", { hasText: "جرّبه في المخطط" }).first();
  if (await trySuggestion.count()) {
    await trySuggestion.click();
    await page.waitForSelector(".delta");
    await page.waitForTimeout(800);
    await shot(page, "09-scenario-from-suggestion-ar");
    step("suggestion opened in planner");
  } else errors.push("no suggestion on dashboard");

  // Switch to English
  await page.click('a.nav-item[href="/"]');
  await page.waitForSelector("[data-testid=cash-on-hand]");
  await page.click("button:has-text('English')");
  await page.waitForTimeout(400);
  const dir2 = await page.evaluate(() => document.documentElement.dir);
  if (dir2 !== "ltr") errors.push(`expected ltr after switching, got ${dir2}`);
  await shot(page, "10-dashboard-en");
  step("dashboard (en)");
  await page.click('a.nav-item[href="/scenarios"]');
  await page.waitForSelector(".delta");
  await page.waitForTimeout(600);
  await shot(page, "11-scenarios-en");
  await page.click('a.nav-item[href="/tracker"]');
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  await shot(page, "12-tracker-en");
  step("scenarios + tracker (en)");

  // Dark theme
  await page.click('a.nav-item[href="/"]');
  await page.waitForSelector("[data-testid=cash-on-hand]");
  await page.click("button[aria-label='Dark theme']");
  await page.waitForTimeout(300);
  await shot(page, "13-dashboard-dark-en");
  step("dark theme");
  await ctx.close();
}

// 1b) New features: agency demo, collections, cash activity, guided stories
{
  const { ctx, page } = await newPage({ locale: "ar-SA" });
  await page.goto(`${BASE}/login`);
  await page.click("[data-testid=demo-services]");
  await page.waitForSelector("[data-testid=cash-on-hand]", { timeout: 20000 });
  await page.click('a.nav-item[href="/collections"]');
  await page.waitForSelector("[data-testid=draft-reminder]");
  await page.waitForTimeout(300);
  await shot(page, "21-collections-agency-ar");
  await page.locator("[data-testid=draft-reminder]").first().click();
  await page.waitForSelector("#reminder-text");
  const text = await page.inputValue("#reminder-text");
  if (!text.includes("السلام عليكم")) errors.push("Arabic reminder text missing greeting");
  await shot(page, "22-reminder-ar", false);
  await page.keyboard.press("Escape");
  await page.click('a.nav-item[href="/activity"]');
  await page.waitForSelector(".cat-row");
  await page.waitForTimeout(300);
  await shot(page, "23-activity-agency-ar");
  step("agency demo: collections, reminder, cash activity");

  for (const id of ["services", "retail"]) {
    await page.click("[data-testid=story-menu]");
    await page.click(`.story-menu .story-card >> nth=${id === "retail" ? 0 : 1}`);
    await page.waitForSelector(".story-panel");
    let n = 0;
    while (true) {
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(900);
      const text = await page.locator(".story-panel .text").innerText();
      if (text.includes("…") || text.includes("{")) errors.push(`story ${id} step ${n + 1} has unfilled text: ${text}`);
      if (await page.locator(".callout.critical").count()) errors.push(`story ${id} step ${n + 1} shows an error`);
      await shot(page, `24-story-${id}-${n + 1}`, false);
      n += 1;
      const btn = page.locator("[data-testid=story-next]");
      const label = await btn.innerText();
      await btn.click();
      if (label.includes("إنهاء") || label.includes("Finish")) break;
      if (n > 10) break;
    }
    step(`story ${id}: ${n} steps`);
  }
  await ctx.close();
}

// 2) Mobile, Arabic
{
  const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ar-SA" });
  await page.goto(`${BASE}/login`);
  await page.click("[data-testid=demo-login]");
  await page.waitForSelector("[data-testid=cash-on-hand]", { timeout: 20000 });
  await page.waitForTimeout(400);
  await shot(page, "14-mobile-dashboard-ar");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) errors.push(`horizontal overflow on mobile: ${overflow}px`);
  step("mobile dashboard");
  await ctx.close();
}

// 3) New company onboarding: register -> Lean (open banking) consent -> Qoyod consent -> forecast
{
  const { ctx, page } = await newPage({ locale: "en-US" });
  await page.goto(`${BASE}/register`);
  await page.evaluate(() => localStorage.setItem("siyulah.locale", "en"));
  await page.reload();
  const email = `owner${Date.now()}@example.sa`;
  await page.fill("input[autocomplete=email]", email);
  await page.locator("input").nth(0).fill("Maha Al-Qahtani");
  await page.locator("input").nth(1).fill("Wamda Creative Agency");
  await page.selectOption("select", "services");
  await page.fill("input[autocomplete=new-password]", "password123");
  await page.check("input[type=checkbox]");
  await shot(page, "15-register-en", false);
  await page.click("button[type=submit]");
  await page.waitForURL("**/onboarding");
  await page.waitForSelector("[data-provider=lean]");
  await shot(page, "16-onboarding-step1-en", false);
  step("registered");

  await page.click("[data-provider=lean] button");
  await page.click("[data-bank=snb]");
  await shot(page, "17-bank-picker-en", false);
  await page.click(".modal .btn.primary");
  await page.waitForURL("**/api/sandbox/oauth/lean/authorize**");
  await shot(page, "18-consent-lean", false);
  await page.click("button[value=allow]");
  await page.waitForURL("**/onboarding**", { timeout: 20000 });
  await page.waitForSelector("[data-provider=qoyod]");
  step("bank connected via consent screen");

  await page.click("[data-provider=qoyod] button");
  await page.waitForURL("**/api/sandbox/oauth/qoyod/authorize**");
  await page.click("button[value=allow]");
  await page.waitForURL("**/onboarding**", { timeout: 20000 });
  await page.waitForSelector("text=You're all set");
  await shot(page, "19-onboarding-done-en", false);
  await page.click("text=Open my forecast");
  await page.waitForSelector("[data-testid=cash-on-hand]", { timeout: 20000 });
  await page.waitForTimeout(500);
  await shot(page, "20-new-company-dashboard-en");
  step("new company dashboard");
  await ctx.close();
}

await browser.close();
if (errors.length) {
  console.error("\nERRORS:\n" + errors.join("\n"));
  process.exit(1);
}
console.log("\nE2E smoke passed");
