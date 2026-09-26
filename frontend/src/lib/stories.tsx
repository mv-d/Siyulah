import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, ChevronLeft, ChevronRight, X } from "lucide-react";
import { api } from "../api/client";
import type { Adjustment, Collections, Dashboard, Scenario } from "../api/types";
import { useI18n, type Formatters } from "../i18n";
import { useAuth } from "./auth";
import { addDays, todayRiyadh } from "./util";

export type StoryId = "retail" | "services";

interface Ctx {
  dash?: Dashboard;
  coll?: Collections;
  scenarios?: Scenario[];
  f: Formatters;
}

interface Step {
  route: string;
  state?: (c: Ctx) => unknown;
  text: (t: (k: string, p?: Record<string, string | number>) => string, c: Ctx) => string;
}

function headline(c: Ctx) {
  const m = c.dash?.forecast.metrics;
  if (!m || !c.dash) return { low: "…", date: "…", buffer: "…", risk: "…" };
  return {
    low: c.f.money(m.lowest_balance, { compact: true }),
    date: c.f.date(m.lowest_date),
    buffer: c.f.money(c.dash.company.min_cash_buffer, { compact: true }),
    risk: c.f.pct(m.shortfall_probability),
  };
}

const deferral = (c: Ctx) => c.dash?.suggestions.find((s) => s.kind === "shift_payable") ?? c.dash?.suggestions[0];
const topCollection = (c: Ctx) => c.coll?.items[0];

export const STORIES: Record<StoryId, Step[]> = {
  retail: [
    { route: "/", text: (t, c) => t("stories.retail.s1", headline(c)) },
    { route: "/", text: (t) => t("stories.retail.s2") },
    { route: "/scenarios", state: () => ({ openScenario: "Al-Ofoq" }), text: (t) => t("stories.retail.s3") },
    {
      route: "/scenarios",
      state: (c) => {
        const s = deferral(c);
        return s ? { adjustments: s.adjustments, name: s.title_en } : null;
      },
      text: (t, c) => {
        const s = deferral(c);
        const m = c.dash?.forecast.metrics;
        return t("stories.retail.s4", {
          from: m ? c.f.pct(m.shortfall_probability) : "…",
          to: s ? c.f.pct(s.impact.shortfall_probability) : "…",
        });
      },
    },
    { route: "/collections", text: (t) => t("stories.retail.s5") },
    { route: "/alerts", text: (t) => t("stories.retail.s6") },
  ],
  services: [
    { route: "/", text: (t, c) => t("stories.services.s1", headline(c)) },
    {
      route: "/collections",
      text: (t, c) => {
        const top = topCollection(c);
        return t("stories.services.s2", { cut: top ? Math.round(-top.impact.shortfall_change * 100) : "…" });
      },
    },
    { route: "/scenarios", state: () => ({ openScenario: "Hire 2 designers" }), text: (t) => t("stories.services.s3") },
    {
      route: "/scenarios",
      state: (c) => {
        const hire = c.scenarios?.find((s) => s.name.includes("Hire 2 designers"));
        const top = topCollection(c);
        if (!hire || !top) return null;
        const collect: Adjustment = { type: "expect_receivable", invoice_id: top.invoice_id, date: addDays(todayRiyadh(), 7), label: top.number };
        return { adjustments: [...hire.adjustments, collect], name: "توظيف مصمّمَين + تحصيل تجمع مكة أولاً · Hire 2 designers + collect Makkah first" };
      },
      text: (t) => t("stories.services.s4"),
    },
    { route: "/activity", text: (t) => t("stories.services.s5") },
  ],
};

interface StoryValue {
  active: { id: StoryId; step: number } | null;
  start: (id: StoryId) => Promise<void>;
  go: (step: number) => void;
  exit: () => void;
}

const StoryContext = createContext<StoryValue | null>(null);

export function StoryProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<{ id: StoryId; step: number } | null>(null);
  const { demo } = useAuth();
  const start = useCallback(
    async (id: StoryId) => {
      await demo(id);
      setActive({ id, step: 0 });
    },
    [demo],
  );
  const go = useCallback((step: number) => setActive((a) => (a ? { ...a, step } : a)), []);
  const exit = useCallback(() => setActive(null), []);
  const value = useMemo(() => ({ active, start, go, exit }), [active, start, go, exit]);
  return (
    <StoryContext.Provider value={value}>
      {children}
      {active && <StoryPanel />}
    </StoryContext.Provider>
  );
}

export function useStory() {
  const ctx = useContext(StoryContext);
  if (!ctx) throw new Error("useStory outside provider");
  return ctx;
}

function StoryPanel() {
  const { active, go, exit } = useStory();
  const { t, f } = useI18n();
  const navigate = useNavigate();
  const dash = useQuery({ queryKey: ["dashboard", 90], queryFn: () => api<Dashboard>("/dashboard?horizon=90") });
  const coll = useQuery({ queryKey: ["collections"], queryFn: () => api<Collections>("/collections") });
  const scenarios = useQuery({ queryKey: ["scenarios"], queryFn: () => api<Scenario[]>("/scenarios") });
  const ctx: Ctx = { dash: dash.data, coll: coll.data, scenarios: scenarios.data, f };
  const steps = active ? STORIES[active.id] : [];
  const step = active ? steps[active.step] : null;
  const ready = !!dash.data && !!coll.data && !!scenarios.data;

  // Navigate whenever the step changes (once the data a step needs is loaded).
  useEffect(() => {
    if (!step || !ready) return;
    navigate(step.route, { state: step.state ? { ...(step.state(ctx) as object), storyStep: `${active?.id}-${active?.step}` } : null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, active?.step, ready]);

  if (!active || !step) return null;
  const last = active.step === steps.length - 1;
  return (
    <aside className="story-panel" aria-live="polite" aria-label={t("stories.title")}>
      <div className="row between" style={{ flexWrap: "nowrap" }}>
        <div className="row" style={{ gap: 8, flexWrap: "nowrap", minWidth: 0 }}>
          <BookOpen size={17} style={{ color: "var(--brand)", flex: "none" }} aria-hidden="true" />
          <strong className="small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {t(`stories.${active.id}.title`)}
          </strong>
        </div>
        <button className="btn ghost icon sm" onClick={exit} aria-label={t("stories.exit")}>
          <X size={16} />
        </button>
      </div>
      <div className="xsmall muted">{t(`stories.${active.id}.who`)}</div>
      <div className="progress" aria-hidden="true">
        {steps.map((_, i) => (
          <span key={i} className={i <= active.step ? "on" : undefined} />
        ))}
      </div>
      <p className="text">{ready ? step.text(t, ctx) : t("common.loading")}</p>
      <div className="row between">
        <span className="xsmall muted">{t("stories.step", { n: active.step + 1, total: steps.length })}</span>
        <div className="row" style={{ gap: 6 }}>
          {active.step > 0 && (
            <button className="btn sm" onClick={() => go(active.step - 1)}>
              <ChevronLeft size={15} className="flip-rtl" />
              {t("stories.back")}
            </button>
          )}
          <button className="btn primary sm" onClick={() => (last ? exit() : go(active.step + 1))} data-testid="story-next">
            {last ? t("stories.finish") : t("stories.next")}
            {!last && <ChevronRight size={15} className="flip-rtl" />}
          </button>
        </div>
      </div>
    </aside>
  );
}
