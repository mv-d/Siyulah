// Checks that the browser engine (src/preview/engine.ts) reproduces the server's scenario
// results recorded by e2e/record-fixtures.mjs. Run with: npm run preview:validate
import fs from "node:fs";
import { PreviewEngine } from "../dist-preview/engine.mjs";
const fx = JSON.parse(fs.readFileSync(new URL("../src/preview/fixtures.json", import.meta.url)));
const val = JSON.parse(fs.readFileSync(new URL("../src/preview/fixtures.validation.json", import.meta.url)));
let worst = { money: 0, prob: 0, series: 0 }, fails = 0, checks = 0;
for (const [profile, cases] of Object.entries(val)) {
  const eng = new PreviewEngine(fx.profiles[profile].engine);
  for (const [bodyJson, server] of Object.entries(cases)) {
    const body = JSON.parse(bodyJson);
    const mine = eng.compare(body.adjustments);
    for (const side of ["baseline", "scenario"]) {
      const a = server[side].metrics, b = mine[side].metrics;
      for (const k of ["lowest_balance", "ending_balance", "total_inflow", "total_outflow", "lowest_p10", "ending_p10", "ending_p90"]) worst.money = Math.max(worst.money, Math.abs(a[k] - b[k]));
      for (const k of ["shortfall_probability", "buffer_breach_probability"]) worst.prob = Math.max(worst.prob, Math.abs(a[k] - b[k]));
      for (const k of ["lowest_date", "days_below_buffer", "runway_days", "cash_zero_date", "buffer_breach_date"]) if (a[k] !== b[k]) { fails++; console.log("MISMATCH", profile, side, k, a[k], b[k], body.adjustments.map(x=>x.type).join("+")); }
      server[side].series.forEach((s, i) => { const m = mine[side].series[i]; worst.series = Math.max(worst.series, Math.abs(s.p50 - m.p50), Math.abs(s.p10 - m.p10), Math.abs(s.p90 - m.p90)); if (s.events.length !== m.events.length) { fails++; console.log("EVENTS", profile, side, s.date, s.events.length, m.events.length); } });
      const ra = JSON.stringify(server[side].receivables.map(r=>[r.id,r.expected_date,r.probability_in_horizon])), rb = JSON.stringify(mine[side].receivables.map(r=>[r.id,r.expected_date,r.probability_in_horizon]));
      if (ra !== rb) { fails++; console.log("RECEIVABLES", profile, side); }
      checks++;
    }
  }
}
console.log(`${checks} forecast runs compared · worst money diff SAR ${worst.money.toFixed(2)} · worst daily band diff SAR ${worst.series.toFixed(2)} · worst probability diff ${worst.prob.toFixed(3)} · mismatches ${fails}`);
if (fails || worst.money > 50 || worst.prob > 0.005) process.exit(1);
