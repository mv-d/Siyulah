import { useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { ForecastEvent, ForecastPoint, HistoryPoint } from "../../api/types";
import { useI18n } from "../../i18n";
import { areaPath, linear, linePath, niceTicks } from "./scale";
import { useWidth } from "./useSize";

interface Props {
  history: HistoryPoint[];
  forecast: ForecastPoint[];
  buffer: number;
  /** Scenario run: when present, `forecast` is drawn as the grey baseline. */
  scenario?: ForecastPoint[];
  height?: number;
  ariaLabel: string;
}

interface Row {
  date: string;
  kind: "history" | "forecast";
  actual?: number;
  p10?: number;
  p50?: number;
  p90?: number;
  s10?: number;
  s50?: number;
  s90?: number;
  inflow: number;
  outflow: number;
  events: ForecastEvent[];
}

const AXIS_BAND = 28;

export function BalanceChart({ history, forecast, buffer, scenario, height = 300, ariaLabel }: Props) {
  const { t, f, dir, pick } = useI18n();
  const rtl = dir === "rtl";
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const rows: Row[] = useMemo(() => {
    const h: Row[] = history.map((p) => ({ date: p.date, kind: "history", actual: p.balance, inflow: p.inflow, outflow: p.outflow, events: [] }));
    const fc: Row[] = forecast.map((p, i) => {
      const s = scenario?.[i];
      return {
        date: p.date,
        kind: "forecast",
        p10: p.p10,
        p50: p.p50,
        p90: p.p90,
        s10: s?.p10,
        s50: s?.p50,
        s90: s?.p90,
        inflow: s ? s.inflow : p.inflow,
        outflow: s ? s.outflow : p.outflow,
        events: s ? s.events : p.events,
      };
    });
    return [...h, ...fc];
  }, [history, forecast, scenario]);

  const todayIdx = history.length - 1;
  const today = history[todayIdx];
  const n = rows.length;

  const yAxisW = 58;
  const plotTop = 22;
  const plotBottom = height - 8;
  const plotStart = rtl ? 12 : yAxisW;
  const plotEnd = rtl ? width - yAxisW : width - 16;

  const values = rows.flatMap((r) => [r.actual, r.p10, r.p90, r.s10, r.s90].filter((v): v is number => v !== undefined));
  const vMin = Math.min(0, buffer, ...values);
  const vMax = Math.max(buffer, ...values);
  const ticks = niceTicks(vMin, vMax, 5);
  const y = linear([ticks[0], ticks[ticks.length - 1]], [plotBottom, plotTop]);
  const x = (i: number) => (rtl ? plotEnd - (i / Math.max(1, n - 1)) * (plotEnd - plotStart) : plotStart + (i / Math.max(1, n - 1)) * (plotEnd - plotStart));

  const histPts = rows.slice(0, todayIdx + 1).map((r, i) => [x(i), y(r.actual!)] as [number, number]);
  const start: [number, number] = [x(todayIdx), y(today.balance)];
  const fcIdx = rows.map((_, i) => i).filter((i) => i > todayIdx);
  /** The highlighted forecast (the scenario when comparing) at quantile q. */
  const main = (r: Row, q: 10 | 50 | 90): number =>
    (scenario ? { 10: r.s10, 50: r.s50, 90: r.s90 }[q] : { 10: r.p10, 50: r.p50, 90: r.p90 }[q]) ?? 0;
  const pt = (i: number, v: number): [number, number] => [x(i), y(v)];
  const bandTop = [start, ...fcIdx.map((i) => pt(i, main(rows[i], 90)))];
  const bandBot = [start, ...fcIdx.map((i) => pt(i, main(rows[i], 10)))];
  const medianPts = [start, ...fcIdx.map((i) => pt(i, main(rows[i], 50)))];
  const baselinePts = scenario ? [start, ...fcIdx.map((i) => pt(i, rows[i].p50 ?? 0))] : [];

  // Direct labels: "now" and the lowest projected point (selective, never every point).
  const lowIdx = fcIdx.reduce((best, i) => (best === -1 || main(rows[i], 50) < main(rows[best], 50) ? i : best), -1);
  const lowVal = lowIdx >= 0 ? main(rows[lowIdx], 50) : null;
  // Below the dot by default; above it when that would collide with the buffer line or the axis.
  const below = lowVal !== null ? y(lowVal) + 20 : 0;
  const lowLabelY =
    lowVal === null ? 0 : Math.abs(below - 4 - y(buffer)) < 14 || below > plotBottom ? y(lowVal) - 12 : below;

  const xTickCount = Math.max(3, Math.min(7, Math.floor((plotEnd - plotStart) / 110)));
  const xTicks = Array.from({ length: xTickCount }, (_, k) => Math.round((k / (xTickCount - 1)) * (n - 1)));

  const pickIndex = (clientX: number, rect: DOMRect) => {
    const px = clientX - rect.left;
    const frac = (rtl ? plotEnd - px : px - plotStart) / (plotEnd - plotStart);
    return Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1))));
  };
  const onMove = (e: PointerEvent<SVGRectElement>) => setHover(pickIndex(e.clientX, (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()));
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Escape" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    if (e.key === "Escape") return setHover(null);
    if (e.key === "Home") return setHover(0);
    if (e.key === "End") return setHover(n - 1);
    const visualRight = e.key === "ArrowRight" ? 1 : -1;
    const step = rtl ? -visualRight : visualRight;
    setHover((h) => Math.max(0, Math.min(n - 1, (h ?? todayIdx) + step)));
  };

  const hv = hover !== null ? rows[hover] : null;
  const hx = hover !== null ? x(hover) : 0;
  const tooltipLeft = hover !== null ? (hx + 250 > width ? Math.max(0, hx - 244) : hx + 14) : 0;
  const bufferY = y(buffer);
  const zeroY = y(0);

  return (
    <div
      className="chart"
      ref={ref}
      tabIndex={0}
      role="img"
      aria-label={ariaLabel}
      onKeyDown={onKey}
      onBlur={() => setHover(null)}
      style={{ height: height + AXIS_BAND }}
    >
      <svg width={width} height={height + AXIS_BAND} aria-hidden="true">
        {/* grid */}
        {ticks.map((tv) => (
          <g key={tv}>
            <line x1={plotStart} x2={plotEnd} y1={y(tv)} y2={y(tv)} stroke={tv === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth={1} />
            {/* SVG text-anchor follows text direction, so "end" sits outside the plot in both LTR and RTL. */}
            <text className="axis-text" x={rtl ? plotEnd + 8 : plotStart - 8} y={y(tv)} dy="0.32em" textAnchor="end">
              {f.compactNum(tv)}
            </text>
          </g>
        ))}
        {/* x ticks */}
        {xTicks.map((i, k) => (
          <text
            key={i}
            className="axis-text"
            x={x(i)}
            y={height + 18}
            textAnchor={k === 0 ? "start" : k === xTicks.length - 1 ? "end" : "middle"}
          >
            {f.date(rows[i].date)}
          </text>
        ))}
        {/* today divider */}
        <line x1={x(todayIdx)} x2={x(todayIdx)} y1={plotTop - 8} y2={plotBottom} stroke="var(--axis)" strokeWidth={1} />
        <text className="axis-text" x={x(todayIdx)} y={plotTop - 12} textAnchor="middle">
          {t("common.today")}
        </text>

        {/* likely range */}
        <path d={areaPath(bandTop, bandBot)} fill="var(--series-1-wash)" />

        {/* safety buffer */}
        <line x1={plotStart} x2={plotEnd} y1={bufferY} y2={bufferY} stroke="var(--warning)" strokeWidth={1.5} strokeDasharray="6 4" />
        {width >= 520 && (
          <text className="label-text" x={rtl ? plotStart + 4 : plotEnd - 4} y={bufferY - 6} textAnchor="end">
            {t("dashboard.buffer")} · {f.compactNum(buffer)}
          </text>
        )}

        {scenario && (
          <path d={linePath(baselinePts)} fill="none" stroke="var(--compare)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        )}
        <path d={linePath(histPts)} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <path
          d={linePath(medianPts)}
          fill="none"
          stroke="var(--series-1)"
          strokeWidth={2}
          strokeDasharray="5 4"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* direct labels */}
        <circle cx={start[0]} cy={start[1]} r={4.5} fill="var(--series-1)" stroke="var(--chart-surface)" strokeWidth={2} />
        {lowIdx >= 0 && lowVal !== null && (
          <g>
            <circle cx={x(lowIdx)} cy={y(lowVal)} r={4.5} fill={lowVal < buffer ? "var(--critical)" : "var(--series-1)"} stroke="var(--chart-surface)" strokeWidth={2} />
            <text
              className="label-strong"
              x={Math.max(plotStart + 70, Math.min(plotEnd - 70, x(lowIdx)))}
              y={lowLabelY}
              textAnchor="middle"
            >
              {t("dashboard.lowPoint")} {f.compactNum(lowVal)} · {f.date(rows[lowIdx].date)}
            </text>
          </g>
        )}

        {/* hover layer */}
        {hv && (
          <g pointerEvents="none">
            <line x1={hx} x2={hx} y1={plotTop} y2={plotBottom} stroke="var(--ink-2)" strokeWidth={1} opacity={0.5} />
            {hv.actual !== undefined && <circle cx={hx} cy={y(hv.actual)} r={4.5} fill="var(--series-1)" stroke="var(--chart-surface)" strokeWidth={2} />}
            {hv.kind === "forecast" && scenario && <circle cx={hx} cy={y(hv.p50!)} r={4} fill="var(--compare)" stroke="var(--chart-surface)" strokeWidth={2} />}
            {hv.kind === "forecast" && (
              <circle cx={hx} cy={y(main(hv, 50))} r={4.5} fill="var(--series-1)" stroke="var(--chart-surface)" strokeWidth={2} />
            )}
          </g>
        )}
        <rect
          x={Math.min(plotStart, plotEnd)}
          y={plotTop}
          width={Math.abs(plotEnd - plotStart)}
          height={plotBottom - plotTop}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        />
        {zeroY < plotBottom && zeroY > plotTop && <line x1={plotStart} x2={plotEnd} y1={zeroY} y2={zeroY} stroke="var(--axis)" strokeWidth={1} pointerEvents="none" />}
      </svg>

      {hv && (
        <div className="chart-tooltip" style={{ left: tooltipLeft, top: 8 }}>
          <div className="tt-date">{f.date(hv.date, "weekday")}</div>
          {hv.kind === "history" ? (
            <div className="tt-row">
              <span className="key" style={{ background: "var(--series-1)" }} />
              <span className="v">{f.money(hv.actual!)}</span>
              <span className="k">{t("dashboard.history")}</span>
            </div>
          ) : (
            <>
              <div className="tt-row">
                <span className="key dash" style={{ color: "var(--series-1)" }} />
                <span className="v">{f.money(main(hv, 50))}</span>
                <span className="k">{scenario ? t("scenarios.scenario") : t("dashboard.forecast")}</span>
              </div>
              {scenario && (
                <div className="tt-row">
                  <span className="key" style={{ background: "var(--compare)" }} />
                  <span className="v">{f.money(hv.p50!)}</span>
                  <span className="k">{t("scenarios.baseline")}</span>
                </div>
              )}
              <div className="tt-row">
                <span className="k">{t("dashboard.range")}</span>
                <span className="num ink-2" style={{ fontSize: 12.5 }}>
                  <bdi>{f.compactNum(main(hv, 10))}</bdi> – <bdi>{f.compactNum(main(hv, 90))}</bdi>
                </span>
              </div>
            </>
          )}
          <div className="tt-row">
            <span className="k">{t("dashboard.inflow")}</span>
            <span className="num">{f.money(hv.inflow, { compact: true })}</span>
            <span className="k">· {t("dashboard.outflow")}</span>
            <span className="num">{f.money(hv.outflow, { compact: true })}</span>
          </div>
          {hv.events.length > 0 && (
            <div className="tt-events">
              {[...hv.events]
                .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
                .slice(0, 4)
                .map((e, i) => (
                  <div className="tt-event" key={i}>
                    <span>{pick(e.label_en, e.label_ar)}</span>
                    <span className="num">{f.money(e.amount, { compact: true, sign: true })}</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function BalanceLegend({ scenario }: { scenario?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="legend" aria-hidden="true">
      <span className="legend-item" style={{ color: "var(--series-1)" }}>
        <span className="legend-swatch" />
        <span className="ink-2">{t("dashboard.history")}</span>
      </span>
      {scenario && (
        <span className="legend-item" style={{ color: "var(--compare)" }}>
          <span className="legend-swatch" />
          <span className="ink-2">{t("scenarios.baseline")}</span>
        </span>
      )}
      <span className="legend-item" style={{ color: "var(--series-1)" }}>
        <span className="legend-swatch dash" />
        <span className="ink-2">{scenario ? t("scenarios.scenario") : t("dashboard.forecast")}</span>
      </span>
      <span className="legend-item">
        <span className="legend-swatch band" style={{ background: "var(--series-1-wash)" }} />
        <span className="ink-2">{t("dashboard.band")}</span>
      </span>
      <span className="legend-item" style={{ color: "var(--warning)" }}>
        <span className="legend-swatch dash" />
        <span className="ink-2">{t("dashboard.buffer")}</span>
      </span>
    </div>
  );
}

export function BalanceTable({ history, forecast, scenario }: { history: HistoryPoint[]; forecast: ForecastPoint[]; scenario?: ForecastPoint[] }) {
  const { t, f } = useI18n();
  return (
    <div className="table-wrap" style={{ maxHeight: 360, overflowY: "auto" }}>
      <table className="table">
        <thead>
          <tr>
            <th>{t("common.date")}</th>
            <th className="amount">{t("dashboard.history")}</th>
            {scenario && <th className="amount">{t("scenarios.baseline")}</th>}
            <th className="amount">{scenario ? t("scenarios.scenario") : t("dashboard.forecast")}</th>
            <th className="amount">P10</th>
            <th className="amount">P90</th>
          </tr>
        </thead>
        <tbody>
          {history.map((h) => (
            <tr key={h.date}>
              <td>{f.date(h.date, "weekday")}</td>
              <td className="amount">{f.money(h.balance)}</td>
              {scenario && <td />}
              <td />
              <td />
              <td />
            </tr>
          ))}
          {forecast.map((p, i) => {
            const s = scenario?.[i];
            return (
              <tr key={p.date}>
                <td>{f.date(p.date, "weekday")}</td>
                <td />
                {scenario && <td className="amount">{f.money(p.p50)}</td>}
                <td className="amount">{f.money(s ? s.p50 : p.p50)}</td>
                <td className="amount">{f.money(s ? s.p10 : p.p10)}</td>
                <td className="amount">{f.money(s ? s.p90 : p.p90)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
