import React from "react";
import { useCurrentFrame } from "remotion";
import data from "./data/retail.json";
import { useProgress, useSpring } from "./components";
import { C } from "./theme";

// Real output of the Siyulah engine for the retail demo (Nakhla Perfumes & Oud) as of
// 27 Sep 2026: 30 days of history, the 90-day base forecast and the "defer the Arabian
// Oud bill 29 days" scenario. Recorded from /api/dashboard and /api/scenarios/preview.
type Point = { date: string; p10: number; p50: number; p90: number };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const Y_MIN = -80000;
const Y_MAX = 400000;

export const Chart: React.FC<{
  width: number;
  height: number;
  historyStart?: number;
  forecastStart?: number;
  forecastDuration?: number;
  /** 0 = base case, 1 = deferral scenario */
  mix?: number;
  /** "scenario" draws the forecast as a solid brand-green line */
  variant?: "base" | "scenario";
  showBase?: boolean;
  lowStart?: number;
  id: string;
}> = ({ width, height, historyStart = 0, forecastStart = 40, forecastDuration = 110, mix = 0, variant = "base", showBase = false, lowStart, id }) => {
  const frame = useCurrentFrame();
  const padL = 96;
  const padR = 32;
  const padT = 28;
  const padB = 56;
  const n = data.history.length + data.base.length;
  const x = (i: number) => padL + (i / (n - 1)) * (width - padL - padR);
  const y = (v: number) => padT + ((Y_MAX - v) / (Y_MAX - Y_MIN)) * (height - padT - padB);
  const h0 = data.history.length - 1;

  const blend = (a: Point, b: Point): Point => ({
    date: a.date,
    p10: a.p10 + (b.p10 - a.p10) * mix,
    p50: a.p50 + (b.p50 - a.p50) * mix,
    p90: a.p90 + (b.p90 - a.p90) * mix,
  });
  const series: Point[] = data.base.map((p, i) => blend(p, data.defer[i]));
  const today = data.history[h0].balance;

  const hist = data.history.map((h, i) => `${i ? "L" : "M"}${x(i)},${y(h.balance)}`).join(" ");
  const med = (s: Point[]) => [`M${x(h0)},${y(today)}`, ...s.map((p, i) => `L${x(h0 + 1 + i)},${y(p.p50)}`)].join(" ");
  const band =
    [`M${x(h0)},${y(today)}`, ...series.map((p, i) => `L${x(h0 + 1 + i)},${y(p.p90)}`)].join(" ") +
    " " +
    [...series.map((p, i) => ({ p, i })).reverse().map(({ p, i }) => `L${x(h0 + 1 + i)},${y(p.p10)}`), `L${x(h0)},${y(today)}`].join(" ") +
    "Z";

  const histP = useProgress(historyStart, 36);
  const foreP = useProgress(forecastStart, forecastDuration);
  const axisP = useSpring(historyStart - 6);
  const lowP = useSpring(lowStart ?? 99999, 12);

  let lowI = 0;
  series.forEach((p, i) => {
    if (p.p50 < series[lowI].p50) lowI = i;
  });
  const low = series[lowI];
  const lowX = x(h0 + 1 + lowI);
  const lowY = y(low.p50);
  const d = new Date(low.date + "T00:00:00Z");
  const lowLabel = `Low SAR ${(Math.round(low.p50 / 100) / 10).toFixed(1)}K · ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;

  const ticks = [0, 100000, 200000, 300000];
  const monthTicks: { i: number; label: string }[] = [];
  const all = [...data.history.map((h) => h.date), ...data.base.map((b) => b.date)];
  all.forEach((dt, i) => {
    if (dt.endsWith("-01")) monthTicks.push({ i, label: MONTHS[Number(dt.slice(5, 7)) - 1] });
  });

  const histClip = x(0) + (x(h0) - x(0)) * histP;
  const foreClip = x(h0) + (x(n - 1) - x(h0) + 4) * foreP;
  const pulse = 0.5 + 0.5 * Math.sin(frame / 5);
  const scen = variant === "scenario";

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: "visible" }}>
      <defs>
        <clipPath id={`${id}-hist`}>
          <rect x={0} y={0} width={histClip} height={height} />
        </clipPath>
        <clipPath id={`${id}-fore`}>
          <rect x={x(h0) - 2} y={0} width={Math.max(0, foreClip - x(h0) + 2)} height={height} />
        </clipPath>
      </defs>
      <g opacity={axisP}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} stroke={t === 0 ? "#b9c4be" : C.grid} strokeWidth={t === 0 ? 2 : 1.5} />
            <text x={padL - 16} y={y(t) + 8} textAnchor="end" fontSize={22} fill={C.muted}>
              {t === 0 ? "0" : `${t / 1000}K`}
            </text>
          </g>
        ))}
        {monthTicks.map((m) => (
          <text key={m.i} x={x(m.i)} y={height - 14} textAnchor="middle" fontSize={22} fill={C.muted}>
            {m.label}
          </text>
        ))}
        <line x1={x(h0)} x2={x(h0)} y1={padT - 8} y2={height - padB} stroke="#b9c4be" strokeWidth={2} />
        <text x={x(h0)} y={padT - 14} textAnchor="middle" fontSize={20} fill={C.muted}>
          Today
        </text>
        <line x1={padL} x2={width - padR} y1={y(data.buffer)} y2={y(data.buffer)} stroke={C.orange} strokeWidth={3} strokeDasharray="12 10" />
        <text x={padL + 12} y={y(data.buffer) + 30} textAnchor="start" fontSize={21} fontWeight={600} fill={C.orangeText}>
          Safety buffer · SAR 50K
        </text>
      </g>
      <path d={hist} fill="none" stroke={C.blue} strokeWidth={5} strokeLinejoin="round" clipPath={`url(#${id}-hist)`} />
      <g clipPath={`url(#${id}-fore)`}>
        <path d={band} fill={scen ? C.brand : C.blue} fillOpacity={0.14} />
        {showBase && <path d={med(data.base)} fill="none" stroke="#9aa8a2" strokeWidth={3.5} strokeDasharray="10 9" />}
        <path d={med(series)} fill="none" stroke={scen ? C.brand : C.blue} strokeWidth={5} strokeDasharray={scen ? undefined : "14 10"} strokeLinejoin="round" />
      </g>
      {lowStart !== undefined && (
        <g opacity={lowP}>
          <circle cx={lowX} cy={lowY} r={12 + pulse * 10} fill={mix > 0.5 ? C.brand : C.orange} opacity={0.18} />
          <circle cx={lowX} cy={lowY} r={11 * lowP} fill={mix > 0.5 ? C.brand : C.orange} stroke="#ffffff" strokeWidth={3} />
          <text x={lowX} y={lowY + 52} textAnchor="middle" fontSize={26} fontWeight={700} fill={C.ink}>
            {lowLabel}
          </text>
        </g>
      )}
    </svg>
  );
};
