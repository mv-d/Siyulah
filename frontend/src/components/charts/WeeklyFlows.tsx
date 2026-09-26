import { useMemo, useState } from "react";
import type { ForecastPoint } from "../../api/types";
import { useI18n } from "../../i18n";
import { barPath, linear, niceTicks } from "./scale";
import { useWidth } from "./useSize";

interface Week {
  start: string;
  end: string;
  inflow: number;
  outflow: number;
}

export function weeklyBuckets(series: ForecastPoint[]): Week[] {
  const weeks: Week[] = [];
  for (let i = 0; i < series.length; i += 7) {
    const chunk = series.slice(i, i + 7);
    weeks.push({
      start: chunk[0].date,
      end: chunk[chunk.length - 1].date,
      inflow: chunk.reduce((s, p) => s + p.inflow, 0),
      outflow: chunk.reduce((s, p) => s + p.outflow, 0),
    });
  }
  return weeks;
}

const HEIGHT = 220;
const AXIS_BAND = 26;

/** Diverging columns: cash in above the baseline, cash out below it. */
export function WeeklyFlows({ series, ariaLabel }: { series: ForecastPoint[]; ariaLabel: string }) {
  const { t, f, dir } = useI18n();
  const rtl = dir === "rtl";
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const weeks = useMemo(() => weeklyBuckets(series), [series]);

  const yAxisW = 52;
  const plotStart = rtl ? 8 : yAxisW;
  const plotEnd = rtl ? width - yAxisW : width - 8;
  const top = 10;
  const bottom = HEIGHT - 6;
  const maxIn = Math.max(1, ...weeks.map((w) => w.inflow));
  const maxOut = Math.max(1, ...weeks.map((w) => w.outflow));
  const ticks = niceTicks(-maxOut, maxIn, 4);
  const y = linear([ticks[0], ticks[ticks.length - 1]], [bottom, top]);
  const band = (plotEnd - plotStart) / Math.max(1, weeks.length);
  const bw = Math.min(24, band * 0.55);
  const cx = (i: number) => (rtl ? plotEnd - (i + 0.5) * band : plotStart + (i + 0.5) * band);
  const base = y(0);
  // Keep date labels at least ~80px apart.
  const labelEvery = Math.max(1, Math.ceil(weeks.length / Math.max(2, Math.floor((plotEnd - plotStart) / 80))));
  const hv = hover !== null ? weeks[hover] : null;
  const hx = hover !== null ? cx(hover) : 0;

  return (
    <div className="chart" ref={ref} role="img" aria-label={ariaLabel} style={{ height: HEIGHT + AXIS_BAND }}>
      <svg width={width} height={HEIGHT + AXIS_BAND} aria-hidden="true">
        {ticks.map((tv) => (
          <g key={tv}>
            <line x1={plotStart} x2={plotEnd} y1={y(tv)} y2={y(tv)} stroke={tv === 0 ? "var(--axis)" : "var(--grid)"} />
            <text className="axis-text" x={rtl ? plotEnd + 8 : plotStart - 8} y={y(tv)} dy="0.32em" textAnchor="end">
              {f.compactNum(tv)}
            </text>
          </g>
        ))}
        {weeks.map((w, i) => {
          const x0 = cx(i) - bw / 2;
          const active = hover === i;
          return (
            <g key={w.start} opacity={hover === null || active ? 1 : 0.55}>
              <path d={barPath(x0, bw, base - 1, y(w.inflow))} fill="var(--series-1)" />
              <path d={barPath(x0, bw, base + 1, y(-w.outflow))} fill="var(--series-2)" />
              {i % labelEvery === 0 && (
                <text className="axis-text" x={cx(i)} y={HEIGHT + 18} textAnchor="middle">
                  {f.date(w.start)}
                </text>
              )}
              <rect
                x={cx(i) - band / 2}
                y={top}
                width={band}
                height={bottom - top}
                fill="transparent"
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                tabIndex={0}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                aria-label={`${f.date(w.start)} – ${f.date(w.end)}: ${t("dashboard.inflow")} ${f.money(w.inflow)}, ${t("dashboard.outflow")} ${f.money(w.outflow)}`}
              />
            </g>
          );
        })}
      </svg>
      {hv && (
        <div className="chart-tooltip" style={{ left: hx + 220 > width ? Math.max(0, hx - 214) : hx + 14, top: 6 }}>
          <div className="tt-date">
            {f.date(hv.start)} – {f.date(hv.end)}
          </div>
          <div className="tt-row">
            <span className="key" style={{ background: "var(--series-1)", height: 8, width: 8, borderRadius: 2 }} />
            <span className="v">{f.money(hv.inflow)}</span>
            <span className="k">{t("dashboard.inflow")}</span>
          </div>
          <div className="tt-row">
            <span className="key" style={{ background: "var(--series-2)", height: 8, width: 8, borderRadius: 2 }} />
            <span className="v">{f.money(hv.outflow)}</span>
            <span className="k">{t("dashboard.outflow")}</span>
          </div>
          <div className="tt-row">
            <span className="k">{t("dashboard.net")}</span>
            <span className="v">{f.money(hv.inflow - hv.outflow, { sign: true })}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function WeeklyLegend() {
  const { t } = useI18n();
  return (
    <div className="legend">
      <span className="legend-item">
        <span className="legend-swatch rect" style={{ background: "var(--series-1)" }} />
        {t("dashboard.inflow")}
      </span>
      <span className="legend-item">
        <span className="legend-swatch rect" style={{ background: "var(--series-2)" }} />
        {t("dashboard.outflow")}
      </span>
    </div>
  );
}

export function WeeklyTable({ series }: { series: ForecastPoint[] }) {
  const { t, f } = useI18n();
  const weeks = weeklyBuckets(series);
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{t("common.date")}</th>
            <th className="amount">{t("dashboard.inflow")}</th>
            <th className="amount">{t("dashboard.outflow")}</th>
            <th className="amount">{t("dashboard.net")}</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => (
            <tr key={w.start}>
              <td>
                {f.date(w.start)} – {f.date(w.end)}
              </td>
              <td className="amount">{f.money(w.inflow)}</td>
              <td className="amount">{f.money(w.outflow)}</td>
              <td className="amount">{f.money(w.inflow - w.outflow, { sign: true })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
