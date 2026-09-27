# Siyulah — soft-launch video

A ~76-second bilingual (English / Arabic) soft-launch and introduction video, built with
[Remotion](https://www.remotion.dev). 1920×1080, 30 fps, H.264 with a synthesised soundtrack.

| Scene | What it shows |
|---|---|
| Intro | The mark draws itself: *Siyulah · سيولة — See the cash crunch before it happens.* |
| Problem | Fixed outflows (GOSI, payroll on the 27th, ZATCA VAT) against a customer payment that lands 58 days late |
| Meet | The cash-flow co-pilot for Saudi SMEs: Connect → Forecast → Warn → Fix |
| Connect | Lean, Tarabut and Saudi banks, plus Xero, QuickBooks, Zoho Books, Daftra and Qoyod, flowing into Siyulah |
| Forecast | The retail demo's real 90-day forecast: low of SAR 30.4K on 26 Nov, 45% shortfall risk |
| In the app | The dashboard with its plain-language insights |
| Fix | The top suggestion (move one SAR 98,350 bill by 29 days) morphs the forecast: risk 45% → 15%, low SAR 30.4K → 91.1K |
| Collections | The agency demo: one Makkah Health Cluster invoice collected a week early cuts risk 21% → 11% |
| Arabic first | The Arabic dashboard and the phone view: Hijri calendar, Fri–Sat weekend, GOSI · Ejar · ZATCA |
| Trust | Read-only access, OAuth 2.0 + PKCE, AES-256-GCM, PDPL rights, data in the Kingdom |
| Soft launch | Now inviting our first design partners |

Every number on screen comes from the running app. The forecast chart (`src/data/retail.json`) is the engine's
real output for the retail demo as of 27 Sep 2026: `/api/dashboard` for the base case and
`/api/scenarios/preview` for the deferral scenario. The screenshots in `public/shots/` are captured from the app
by `capture.mjs`.

## Render

```bash
npm install
npm run render          # → out/siyulah-soft-launch.mp4 and out/poster.png
npm run studio          # preview and scrub in the browser
```

`render.mjs` synthesises `public/music.wav` first (`music.mjs`: a pad, a plucked arpeggio and a sub bass, no samples)
and uses the Chromium at `/opt/pw-browsers` when present (override with `REMOTION_BROWSER`, or let Remotion
download its own). `FRAMES=0-299 npm run render` renders a range.

To refresh the screenshots, start the app (`./scripts/start.sh`) and run `node capture.mjs`.

## Licences

- Fonts: IBM Plex Sans Arabic, SIL Open Font License (`public/fonts/OFL.txt`).
- Remotion is free for individuals and companies of up to three people. Larger companies need a
  [Remotion company licence](https://www.remotion.dev/license) to render with it.
