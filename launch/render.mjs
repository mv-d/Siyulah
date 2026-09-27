// Renders the launch video to out/siyulah-soft-launch.mp4 and a poster frame.
// Usage: npm run render            (FRAMES=0-299 npm run render to render a range)
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const candidates = [process.env.REMOTION_BROWSER, "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell"];
const browserExecutable = candidates.find((p) => p && fs.existsSync(p)) ?? null;

if (!fs.existsSync("public/music.wav")) execFileSync(process.execPath, ["music.mjs"], { stdio: "inherit" });
fs.mkdirSync("out", { recursive: true });

const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts") });
const composition = await selectComposition({ serveUrl, id: "SiyulahLaunch", browserExecutable });
const frameRange = process.env.FRAMES ? process.env.FRAMES.split("-").map(Number) : null;
const output = process.env.OUT ?? "out/siyulah-soft-launch.mp4";

let last = -1;
await renderMedia({
  composition,
  serveUrl,
  codec: "h264",
  crf: 20,
  audioBitrate: "192k",
  outputLocation: output,
  browserExecutable,
  concurrency: Number(process.env.CONCURRENCY ?? Math.max(1, os.cpus().length)),
  frameRange: frameRange ? [frameRange[0], frameRange[1]] : null,
  onProgress: ({ progress }) => {
    const p = Math.floor(progress * 20);
    if (p !== last) {
      last = p;
      console.log(`rendering ${Math.round(progress * 100)}%`);
    }
  },
});
console.log(`→ ${output} (${composition.durationInFrames} frames at ${composition.fps} fps)`);

if (!frameRange) {
  await renderStill({ composition, serveUrl, output: "out/poster.png", frame: 110, browserExecutable });
  console.log("→ out/poster.png");
}
