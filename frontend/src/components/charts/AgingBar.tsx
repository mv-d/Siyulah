import type { AgingBucket } from "../../api/types";
import { useI18n } from "../../i18n";

const COLORS = ["var(--aging-1)", "var(--aging-2)", "var(--aging-3)", "var(--aging-4)", "var(--aging-5)"];

/** Part-to-whole across ordered aging buckets (ordinal one-hue ramp). */
export function AgingBar({ buckets }: { buckets: AgingBucket[] }) {
  const { t, f } = useI18n();
  const total = buckets.reduce((s, b) => s + b.amount, 0);
  return (
    <div>
      <div className="aging-bar" role="img" aria-label={buckets.map((b) => `${t(`tracker.buckets.${b.key}`)}: ${f.money(b.amount)}`).join(", ")}>
        {total > 0 ? (
          buckets
            .filter((b) => b.amount > 0)
            .map((b) => (
              <div
                key={b.key}
                title={`${t(`tracker.buckets.${b.key}`)} · ${f.money(b.amount)}`}
                style={{ flex: b.amount, background: COLORS[buckets.indexOf(b)] }}
              />
            ))
        ) : (
          <div style={{ flex: 1, background: "var(--surface-3)" }} />
        )}
      </div>
      <div className="aging-legend">
        {buckets.map((b, i) => (
          <div className="it" key={b.key}>
            <span className="k">
              <span className="legend-swatch rect" style={{ background: COLORS[i] }} />
              {t(`tracker.buckets.${b.key}`)}
            </span>
            <span className="v">{f.money(b.amount, { compact: true })}</span>
            <span className="xsmall muted">{b.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
