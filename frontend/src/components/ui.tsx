import { useEffect, useState, type ReactNode } from "react";
import { ChartLine, CircleAlert, CircleCheck, Info, OctagonAlert, Table2, TriangleAlert, X } from "lucide-react";
import type { Severity } from "../api/types";
import { useI18n } from "../i18n";

export function SeverityIcon({ severity, size = 17 }: { severity: Severity; size?: number }) {
  const Icon =
    severity === "critical" ? OctagonAlert : severity === "serious" ? TriangleAlert : severity === "warning" ? CircleAlert : severity === "good" ? CircleCheck : Info;
  return (
    <span className={`status-icon ${severity}`} aria-hidden="true">
      <Icon size={size} />
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const { t } = useI18n();
  const Icon =
    severity === "critical" ? OctagonAlert : severity === "serious" ? TriangleAlert : severity === "warning" ? CircleAlert : severity === "good" ? CircleCheck : Info;
  return (
    <span className={`badge ${severity}`}>
      <Icon aria-hidden="true" />
      {t(`alerts.severity.${severity}`)}
    </span>
  );
}

export function Money({ value, compact, sign, className }: { value: number; compact?: boolean; sign?: boolean; className?: string }) {
  const { f } = useI18n();
  return <span className={`num ${className ?? ""}`}>{f.money(value, { compact, sign })}</span>;
}

export function Loading() {
  const { t } = useI18n();
  return (
    <div className="loading-page" aria-busy="true">
      <div className="row muted">
        <div className="spinner" />
        {t("common.loading")}
      </div>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="empty">
      <div className="icon">
        <CircleAlert />
      </div>
      <div>{error instanceof Error ? error.message : t("common.error")}</div>
      {onRetry && (
        <button className="btn sm" onClick={onRetry}>
          {t("common.retry")}
        </button>
      )}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="icon">{icon}</div>}
      <div style={{ color: "var(--ink)", fontWeight: 500 }}>{title}</div>
      {children}
    </div>
  );
}

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="btn ghost icon sm" onClick={onClose} aria-label={t("common.close")}>
            <X size={18} />
          </button>
        </div>
        {children}
        {footer && <div className="modal-actions">{footer}</div>}
      </div>
    </div>
  );
}

/** Card for a chart: title, legend and a table-view toggle (the accessible twin). */
export function ChartCard({
  title,
  sub,
  legend,
  actions,
  chart,
  table,
  busy,
}: {
  title: string;
  sub?: string;
  legend?: ReactNode;
  actions?: ReactNode;
  chart: ReactNode;
  table: ReactNode;
  busy?: boolean;
}) {
  const { t } = useI18n();
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>{title}</h2>
          {sub && <div className="sub">{sub}</div>}
        </div>
        <div className="row">
          {actions}
          <button className="btn ghost sm" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
            {asTable ? <ChartLine size={16} /> : <Table2 size={16} />}
            {asTable ? t("common.showChart") : t("common.showTable")}
          </button>
        </div>
      </div>
      <div className={busy ? "refetching" : undefined}>{asTable ? table : chart}</div>
      {legend && !asTable && <div className="chart-foot">{legend}</div>}
    </section>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} aria-pressed={o.value === value} onClick={() => onChange(o.value)} type="button">
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span className="track" />
    </label>
  );
}

export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 64 64" width={size * 0.72} height={size * 0.72}>
        <path d="M8 44c9 0 11-16 21-16s11 9 21 9" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" />
        <circle cx="51" cy="37" r="5" fill="#9be3cf" />
      </svg>
    </span>
  );
}
