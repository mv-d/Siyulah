import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { Chart } from "./Chart";
import { Arrow, Bi, Browser, Chip, Counter, Eyebrow, FadeUp, Highlight, Logo, Phone, Words, pct, sar, useProgress, useSpring } from "./components";
import data from "./data/retail.json";
import { C, FONT } from "./theme";

const Page: React.FC<{ bg: string; children: React.ReactNode; style?: React.CSSProperties }> = ({ bg, children, style }) => (
  <AbsoluteFill style={{ background: bg, fontFamily: FONT, color: C.ink, ...style }}>{children}</AbsoluteFill>
);

/** A faint forecast band drifting behind the dark scenes. */
const Backdrop: React.FC<{ opacity?: number }> = ({ opacity = 0.5 }) => {
  const frame = useCurrentFrame();
  const draw = interpolate(frame, [0, 70], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const drift = Math.sin(frame / 60) * 12;
  return (
    <svg width={1920} height={1080} viewBox="0 0 1920 1080" style={{ position: "absolute", inset: 0, opacity }}>
      <g transform={`translate(0 ${drift})`}>
        <path
          d="M0 620 C220 540 380 470 560 520 C760 575 860 760 1060 800 C1220 830 1320 800 1440 740 C1600 660 1760 520 1920 450 L1920 690 C1760 760 1600 880 1440 930 C1320 965 1220 975 1060 950 C860 915 760 700 560 650 C380 610 220 700 0 700 Z"
          fill="#2fb393"
          fillOpacity={0.12 * draw}
        />
        <path
          d="M0 660 C220 600 380 540 560 585 C760 640 860 820 1060 870 C1220 900 1320 880 1440 835 C1600 760 1760 610 1920 560"
          fill="none"
          stroke={C.mint}
          strokeOpacity={0.55}
          strokeWidth={4}
          strokeDasharray="16 14"
          pathLength={1}
          style={{ strokeDasharray: `${draw} 1` }}
        />
      </g>
    </svg>
  );
};

// 1 ─ Intro ──────────────────────────────────────────────────────────────────────────
export const Intro: React.FC = () => (
  <Page bg={`radial-gradient(circle at 70% 35%, #174a3e 0%, ${C.dark} 62%)`} style={{ color: "#f6f5ef" }}>
    <Backdrop />
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 36 }}>
      <Logo size={190} delay={4} />
      <FadeUp delay={30}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 34, fontSize: 132, fontWeight: 700, letterSpacing: -1 }}>
          <span>Siyulah</span>
          <span style={{ color: C.mint }}>سيولة</span>
        </div>
      </FadeUp>
      <Bi
        en="See the cash crunch before it happens."
        ar="اعرف أزمة السيولة قبل أن تقع"
        delay={62}
        size={52}
        color="#f6f5ef"
        arColor={C.mint}
        align="center"
        width={1500}
      />
      <FadeUp delay={100} distance={16}>
        <Chip bg="rgba(155,227,207,0.12)" border="rgba(155,227,207,0.4)" color={C.mint} size={24}>
          SOFT LAUNCH · الإطلاق التجريبي
        </Chip>
      </FadeUp>
    </AbsoluteFill>
  </Page>
);

// 2 ─ Problem ────────────────────────────────────────────────────────────────────────
const TL_X0 = 180;
const TL_W = 1560;
const TL_Y = 640;
const dayX = (d: number) => TL_X0 + (d / 92) * TL_W;

const Pin: React.FC<{ day: number; label: string; row: 0 | 1; delay: number }> = ({ day, label, row, delay }) => {
  const p = useSpring(delay, 12);
  const h = row === 0 ? 96 : 176;
  return (
    <div style={{ position: "absolute", left: dayX(day), top: TL_Y - h, opacity: Math.min(1, p * 1.4), transform: `translateY(${(1 - p) * -40}px)` }}>
      <div style={{ position: "absolute", left: -1.5, top: 30, width: 3, height: h - 30, background: C.orange }} />
      <div style={{ position: "absolute", left: -8, top: h - 8, width: 16, height: 16, borderRadius: 8, background: C.orange }} />
      <div
        style={{
          position: "absolute",
          left: -1.5,
          top: 0,
          padding: "8px 18px",
          borderRadius: 12,
          background: "#3a2a1f",
          border: `2px solid ${C.orange}`,
          color: "#ffd9c7",
          fontSize: 24,
          fontWeight: 600,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </div>
    </div>
  );
};

export const Problem: React.FC = () => {
  const slide = useProgress(150, 70, Easing.inOut(Easing.cubic));
  const invDay = 0 + 58 * slide;
  const gapP = useSpring(205);
  const axisP = useSpring(30);
  const tickP = useSpring(34);
  const noteP = useSpring(150);
  const months = [
    { d: 0, l: "Oct" },
    { d: 31, l: "Nov" },
    { d: 61, l: "Dec" },
    { d: 92, l: "Jan" },
  ];
  return (
    <Page bg={C.dark} style={{ color: "#f6f5ef" }}>
      <div style={{ position: "absolute", left: 180, top: 110, width: 1560 }}>
        <Eyebrow color={C.mint}>The problem · المشكلة</Eyebrow>
        <div style={{ height: 22 }} />
        <Bi en="Saudi SMEs run out of cash, not profit." ar="الشركات الصغيرة تتعثّر بسبب السيولة، لا بسبب الربح" delay={6} size={72} color="#f6f5ef" arColor={C.mint} />
      </div>
      <div style={{ position: "absolute", left: TL_X0, top: TL_Y, width: TL_W, height: 3, background: "#4d6f66", opacity: axisP }} />
      {months.map((m) => (
        <div key={m.l} style={{ position: "absolute", left: dayX(m.d), top: TL_Y + 16, transform: "translateX(-50%)", fontSize: 22, color: "#8fb3a8", opacity: tickP }}>
          {m.l}
        </div>
      ))}
      <Pin day={14} label="GOSI" row={0} delay={50} />
      <Pin day={26} label="Payroll · 27th" row={1} delay={60} />
      <Pin day={30} label="ZATCA VAT" row={0} delay={70} />
      <Pin day={45} label="GOSI" row={0} delay={80} />
      <Pin day={57} label="Payroll · 27th" row={1} delay={90} />
      <Pin day={87} label="Payroll · 27th" row={1} delay={100} />
      {/* The customer payment: due on day 0, arrives 58 days later */}
      <div style={{ position: "absolute", left: dayX(0), top: TL_Y + 70, width: dayX(invDay) - dayX(0), height: 0, borderTop: `3px dashed ${C.mint}`, opacity: slide > 0 ? 0.8 : 0 }} />
      <FadeUp delay={115} distance={30}>
        <div style={{ position: "absolute", left: dayX(invDay), top: TL_Y + 40, transform: "translateX(-50%)" }}>
          <div style={{ padding: "10px 20px", borderRadius: 12, background: "#173f35", border: `2px solid ${C.mint}`, color: C.mint, fontSize: 24, fontWeight: 600, whiteSpace: "nowrap" }}>
            {slide < 0.02 ? "Customer payment due" : `Customer pays · +${Math.round(invDay)} days`}
          </div>
        </div>
      </FadeUp>
      <div style={{ position: "absolute", left: 180, top: 880, width: 1560, opacity: gapP, transform: `translateY(${(1 - gapP) * 20}px)` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ fontSize: 40, fontWeight: 700 }}>
            Fixed dates out. <span style={{ color: C.mint }}>Late money in.</span>
          </div>
          <div dir="rtl" style={{ fontSize: 36, fontWeight: 600, color: C.mint }}>
            مصاريف بمواعيد ثابتة… وإيرادات متأخرة
          </div>
        </div>
      </div>
      <div style={{ position: "absolute", right: 180, top: 110, fontSize: 22, color: "#8fb3a8", opacity: noteP }}>
        Agency demo: the biggest client pays 58 days late on average
      </div>
    </Page>
  );
};

// 3 ─ Meet Siyulah ───────────────────────────────────────────────────────────────────
export const Meet: React.FC = () => {
  const steps = [
    ["Connect", "اربط"],
    ["Forecast", "توقّع"],
    ["Warn", "نبّه"],
    ["Fix", "عالج"],
  ];
  return (
    <Page bg={`linear-gradient(135deg, ${C.brand} 0%, #0a5747 100%)`} style={{ color: "#f6f5ef" }}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 44 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <Logo size={110} delay={0} bg={C.dark} />
          <FadeUp delay={10}>
            <div style={{ fontSize: 40, fontWeight: 600, color: C.mintSoft }}>Meet Siyulah · تعرّف على سيولة</div>
          </FadeUp>
        </div>
        <Bi en="The cash-flow co-pilot for Saudi SMEs" ar="مساعدك للتدفقات النقدية" delay={16} size={84} color="#f6f5ef" arColor={C.mintSoft} align="center" width={1600} />
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          {steps.map(([en, ar], i) => (
            <React.Fragment key={en}>
              <FadeUp delay={48 + i * 8} distance={24}>
                <Chip bg="rgba(11,38,32,0.35)" border="rgba(201,240,227,0.35)" color="#f6f5ef" size={32}>
                  <span>{en}</span>
                  <span style={{ color: C.mint }}>{ar}</span>
                </Chip>
              </FadeUp>
              {i < steps.length - 1 && (
                <FadeUp delay={52 + i * 8} distance={0}>
                  <Arrow size={40} color={C.mint} />
                </FadeUp>
              )}
            </React.Fragment>
          ))}
        </div>
      </AbsoluteFill>
    </Page>
  );
};

// 4 ─ Connect ────────────────────────────────────────────────────────────────────────
const LOGO_C = { x: 960, y: 610 };
const Flow: React.FC<{ from: { x: number; y: number }; to: { x: number; y: number }; delay: number }> = ({ from, to, delay }) => {
  const frame = useCurrentFrame();
  const p = useProgress(delay, 30);
  const mx = (from.x + to.x) / 2;
  const d = `M${from.x},${from.y} C${mx},${from.y} ${mx},${to.y} ${to.x},${to.y}`;
  const t = (((frame - delay - 30) / 40) % 1 + 1) % 1;
  const u = 1 - t;
  const bx = u * u * u * from.x + 3 * u * u * t * mx + 3 * u * t * t * mx + t * t * t * to.x;
  const by = u * u * u * from.y + 3 * u * u * t * from.y + 3 * u * t * t * to.y + t * t * t * to.y;
  return (
    <g>
      <path d={d} fill="none" stroke={C.brand} strokeOpacity={0.35} strokeWidth={3} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p} />
      {frame > delay + 30 && <circle cx={bx} cy={by} r={7} fill={C.brand} opacity={Math.min(1, (frame - delay - 30) / 10)} />}
    </g>
  );
};

export const Connect: React.FC = () => {
  const bankLabelP = useSpring(20);
  const bookLabelP = useSpring(28);
  const left = [
    { label: "Lean", y: 480 },
    { label: "Tarabut", y: 580 },
    { label: "10 Saudi banks", y: 680 },
  ];
  const right = [
    { label: "Xero", y: 420 },
    { label: "QuickBooks", y: 515 },
    { label: "Zoho Books", y: 610 },
    { label: "Daftra", y: 705 },
    { label: "Qoyod", y: 800 },
  ];
  return (
    <Page bg={C.light}>
      <div style={{ position: "absolute", left: 160, top: 96, width: 1600 }}>
        <Eyebrow>Connect · اربط</Eyebrow>
        <div style={{ height: 18 }} />
        <Bi en="Your bank and your books, in one view" ar="حسابك البنكي ونظامك المحاسبي في شاشة واحدة" delay={4} size={64} />
      </div>
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        {left.map((l, i) => (
          <Flow key={l.label} from={{ x: 520, y: l.y }} to={{ x: LOGO_C.x - 90, y: LOGO_C.y }} delay={40 + i * 8} />
        ))}
        {right.map((r, i) => (
          <Flow key={r.label} from={{ x: 1400, y: r.y }} to={{ x: LOGO_C.x + 90, y: LOGO_C.y }} delay={50 + i * 8} />
        ))}
      </svg>
      <div style={{ position: "absolute", left: 160, top: 400, fontSize: 24, fontWeight: 600, color: C.muted, opacity: bankLabelP }}>Open banking · SAMA-licensed</div>
      {left.map((l, i) => (
        <div key={l.label} style={{ position: "absolute", right: 1920 - 520, top: l.y - 34 }}>
          <FadeUp delay={24 + i * 6} distance={20}>
            <Chip size={30}>{l.label}</Chip>
          </FadeUp>
        </div>
      ))}
      <div style={{ position: "absolute", left: 1400, top: 340, fontSize: 24, fontWeight: 600, color: C.muted, opacity: bookLabelP }}>Accounting</div>
      {right.map((r, i) => (
        <div key={r.label} style={{ position: "absolute", left: 1400, top: r.y - 34 }}>
          <FadeUp delay={30 + i * 6} distance={20}>
            <Chip size={30}>{r.label}</Chip>
          </FadeUp>
        </div>
      ))}
      <div style={{ position: "absolute", left: LOGO_C.x - 90, top: LOGO_C.y - 90 }}>
        <Logo size={180} delay={70} />
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 900, display: "flex", justifyContent: "center", gap: 20 }}>
        {["Read-only", "Your consent · بموافقتك", "OAuth 2.0 + PKCE", "AES-256"].map((t, i) => (
          <FadeUp key={t} delay={110 + i * 6} distance={16}>
            <Chip size={26} bg={C.light2} border="#cfdcd5" color={C.brand}>
              {t}
            </Chip>
          </FadeUp>
        ))}
      </div>
    </Page>
  );
};

// 5 ─ Forecast ───────────────────────────────────────────────────────────────────────
const Metric: React.FC<{ label: string; ar: string; children: React.ReactNode; delay: number; accent?: string }> = ({ label, ar, children, delay, accent = C.ink }) => (
  <FadeUp delay={delay} distance={24}>
    <div style={{ background: C.card, border: `2px solid ${C.line}`, borderRadius: 24, padding: "28px 34px", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24, color: C.muted, fontWeight: 600 }}>
        <span>{label}</span>
        <span dir="rtl">{ar}</span>
      </div>
      <div style={{ fontSize: 76, fontWeight: 700, color: accent, lineHeight: 1.1 }}>{children}</div>
    </div>
  </FadeUp>
);

export const Forecast: React.FC = () => (
  <Page bg={C.light}>
    <div style={{ position: "absolute", left: 120, top: 80, width: 1680 }}>
      <Eyebrow>Forecast · التوقع</Eyebrow>
      <div style={{ height: 16 }} />
      <Bi en="See the next 90 days, not just today" ar="شاهد الأيام التسعين القادمة، لا اليوم فقط" delay={4} size={64} />
    </div>
    <div style={{ position: "absolute", left: 90, top: 330 }}>
      <Chart id="forecast" width={1180} height={620} historyStart={24} forecastStart={62} forecastDuration={110} lowStart={180} />
    </div>
    <div style={{ position: "absolute", left: 1330, top: 360, width: 480, display: "flex", flexDirection: "column", gap: 28 }}>
      <Metric label="Cash today" ar="النقد المتاح" delay={30}>
        <Counter from={0} to={123200} start={36} duration={40} format={(n) => `SAR ${Math.round(n).toLocaleString("en-US")}`} style={{ fontSize: 60 }} />
      </Metric>
      <Metric label="Lowest point" ar="أدنى رصيد" delay={185} accent={C.orangeText}>
        <span style={{ fontSize: 60 }}>SAR 30.4K</span>
        <div style={{ fontSize: 26, color: C.body, fontWeight: 500 }}>26 Nov · under the SAR 50K buffer</div>
      </Metric>
      <Metric label="Shortfall risk" ar="خطر العجز" delay={205} accent={C.orangeText}>
        <Counter from={0} to={45} start={212} duration={40} format={pct} />
      </Metric>
    </div>
  </Page>
);

// 5b ─ In the app ────────────────────────────────────────────────────────────────────
export const InApp: React.FC = () => (
  <Page bg={C.light2}>
    <div style={{ position: "absolute", left: 0, right: 0, top: 70, display: "flex", justifyContent: "center" }}>
      <Bi en="Every number, explained in plain language" ar="كل رقم مشروح بلغة واضحة" delay={0} size={52} align="center" width={1600} />
    </div>
    <div style={{ position: "absolute", left: 310, top: 240 }}>
      <FadeUp delay={6} distance={60}>
        <Browser src="shots/en-dashboard.png" width={1300} zoom={[1, 1.12]} zoomStart={20} zoomDuration={130} origin="70% 40%" />
      </FadeUp>
    </div>
  </Page>
);

// 6 ─ Fix ────────────────────────────────────────────────────────────────────────────
export const Fix: React.FC = () => {
  const mix = useProgress(110, 80);
  const noteP = useSpring(200);
  return (
    <Page bg={C.light2}>
      <div style={{ position: "absolute", left: 120, top: 80, width: 1680 }}>
        <Eyebrow>Fix · عالج</Eyebrow>
        <div style={{ height: 16 }} />
        <Bi en="Then it tells you what to do about it" ar="ثم يخبرك بما يجب فعله" delay={4} size={64} />
      </div>
      <div style={{ position: "absolute", left: 90, top: 330 }}>
        <FadeUp delay={30} distance={0}>
          <Chart id="fix" width={1180} height={620} historyStart={-60} forecastStart={-60} mix={mix} variant="scenario" showBase lowStart={40} />
        </FadeUp>
      </div>
      <div style={{ position: "absolute", left: 1330, top: 330, width: 480, display: "flex", flexDirection: "column", gap: 24 }}>
        <FadeUp delay={50} distance={30}>
          <div style={{ background: C.brand, color: "#f6f5ef", borderRadius: 24, padding: "26px 30px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 22, fontWeight: 600, color: C.mintSoft, letterSpacing: 2 }}>TOP SUGGESTION · أفضل اقتراح</div>
            <div style={{ fontSize: 30, fontWeight: 600, lineHeight: 1.3 }}>Ask one supplier to move a SAR 98,350 bill by 29 days</div>
            <div dir="rtl" style={{ fontSize: 26, color: C.mintSoft }}>
              اطلب من مورّد واحد تأجيل فاتورة 29 يوماً
            </div>
          </div>
        </FadeUp>
        <Metric label="Shortfall risk" ar="خطر العجز" delay={80} accent={C.brand}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <span style={{ color: C.orangeText, fontSize: 56 }}>45%</span>
            <Arrow size={50} color={C.muted} />
            <Counter from={45} to={15} start={110} duration={80} format={pct} />
          </div>
        </Metric>
        <Metric label="Lowest balance" ar="أدنى رصيد" delay={90} accent={C.brand}>
          <Counter from={data.metrics.lowest} to={data.deferMetrics.lowest} start={110} duration={80} format={sar} style={{ fontSize: 60 }} />
        </Metric>
      </div>
      <div style={{ position: "absolute", left: 186, top: 968, fontSize: 24, color: C.muted, opacity: noteP }}>
        Measured on the same 500 simulated futures as the base case · grey dashed line = base case
      </div>
    </Page>
  );
};

// 7 ─ Collections ────────────────────────────────────────────────────────────────────
export const Collections: React.FC = () => (
  <Page bg={C.light}>
    <div style={{ position: "absolute", left: 120, top: 80, width: 1680 }}>
      <Eyebrow>For agencies · للوكالات</Eyebrow>
      <div style={{ height: 16 }} />
      <Bi en="Chase the invoice that moves the risk" ar="طالِب بالفاتورة التي تُحدث الفرق" delay={4} size={64} />
    </div>
    <div style={{ position: "absolute", left: 120, top: 360, width: 520, display: "flex", flexDirection: "column", gap: 24 }}>
      <Metric label="Wamda's risk" ar="خطر العجز" delay={40} accent={C.brand}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <span style={{ color: C.orangeText, fontSize: 56 }}>21%</span>
          <Arrow size={50} color={C.muted} />
          <Counter from={21} to={11} start={120} duration={50} format={pct} />
        </div>
        <div style={{ fontSize: 24, color: C.body, fontWeight: 500 }}>if one SAR 85,962 invoice arrives a week early</div>
      </Metric>
      <Metric label="Makkah Health Cluster" ar="سجل العميل" delay={60}>
        <span style={{ fontSize: 56 }}>58 days late</span>
        <div style={{ fontSize: 24, color: C.body, fontWeight: 500 }}>on average, learned from its history</div>
      </Metric>
      <FadeUp delay={80} distance={20}>
        <Chip size={26} bg={C.light2} border="#cfdcd5" color={C.brand}>
          Reminder ready · Arabic or English
        </Chip>
      </FadeUp>
    </div>
    <div style={{ position: "absolute", left: 700, top: 330 }}>
      <FadeUp delay={10} distance={60}>
        <Browser src="shots/en-collections.png" width={1120} zoom={[1, 1.28]} zoomStart={60} zoomDuration={150} origin="78% 52%">
          <Highlight left={72.2} top={54.2} width={10.4} height={4.8} start={120} />
        </Browser>
      </FadeUp>
    </div>
  </Page>
);

// 8 ─ Arabic first ───────────────────────────────────────────────────────────────────
export const ArabicFirst: React.FC = () => {
  const phoneP = useSpring(40, 18);
  const chips = ["Hijri calendar · التقويم الهجري", "Fri–Sat weekend", "GOSI · Ejar · ZATCA", "Ramadan & Eid · رمضان والعيد"];
  return (
    <Page bg={C.dark} style={{ color: "#f6f5ef" }}>
      <div style={{ position: "absolute", left: 120, top: 70, width: 1680 }}>
        <Bi en="Arabic first. Saudi by design." ar="عربي أولاً… وسعودي في كل تفصيلة" delay={0} size={64} color="#f6f5ef" arColor={C.mint} />
      </div>
      <div style={{ position: "absolute", left: 120, top: 270 }}>
        <FadeUp delay={10} distance={50}>
          <Browser src="shots/ar-dashboard.png" width={1120} zoom={[1, 1.06]} zoomStart={10} zoomDuration={220} origin="80% 20%" dark />
        </FadeUp>
      </div>
      <div style={{ position: "absolute", left: 1420, top: 230 + (1 - phoneP) * 400, opacity: phoneP }}>
        <Phone src="shots/ar-mobile-dashboard.png" width={330} />
      </div>
      <div style={{ position: "absolute", left: 120, top: 972, display: "flex", gap: 18 }}>
        {chips.map((t, i) => (
          <FadeUp key={t} delay={90 + i * 8} distance={16}>
            <Chip size={24} bg="rgba(155,227,207,0.10)" border="rgba(155,227,207,0.35)" color={C.mint}>
              {t}
            </Chip>
          </FadeUp>
        ))}
      </div>
    </Page>
  );
};

// 9 ─ Trust ──────────────────────────────────────────────────────────────────────────
const icons: Record<string, React.ReactNode> = {
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="14" r="4" />
      <path d="M11 11l8-8M16 6l2 2M14 8l2 2" />
    </>
  ),
  shield: <path d="M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6z" />,
  doc: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M12 10v7M9 14l3 3 3-3" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-6-6-6-11a6 6 0 0 1 12 0c0 5-6 11-6 11z" />
      <circle cx="12" cy="10" r="2" />
    </>
  ),
};

export const Trust: React.FC = () => {
  const tiles: [string, string, string, string][] = [
    ["lock", "Read-only access", "قراءة فقط", "It cannot move money"],
    ["key", "OAuth 2.0 + PKCE", "موافقتك أولاً", "A consent screen for every link"],
    ["shield", "AES-256-GCM", "تشفير البيانات", "Tokens and IBANs encrypted"],
    ["doc", "PDPL rights", "حماية البيانات الشخصية", "Export or erase in one click"],
    ["pin", "Data in the Kingdom", "بياناتك داخل المملكة", "KSA hosting by default"],
  ];
  return (
    <Page bg={C.light}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 150, display: "flex", justifyContent: "center" }}>
        <Bi en="Bank-grade trust from day one" ar="ثقة بمستوى البنوك منذ اليوم الأول" delay={0} size={68} align="center" width={1600} />
      </div>
      <div style={{ position: "absolute", left: 120, right: 120, top: 470, display: "flex", gap: 28 }}>
        {tiles.map(([icon, en, ar, sub], i) => (
          <FadeUp key={en} delay={24 + i * 7} distance={40} style={{ flex: 1 }}>
            <div style={{ background: C.card, border: `2px solid ${C.line}`, borderRadius: 28, padding: "36px 30px", display: "flex", flexDirection: "column", gap: 14, minHeight: 340 }}>
              <svg width={64} height={64} viewBox="0 0 24 24" fill="none" stroke={C.brand} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                {icons[icon]}
              </svg>
              <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.2 }}>{en}</div>
              <div dir="rtl" style={{ fontSize: 28, fontWeight: 600, color: C.brand, textAlign: "right" }}>
                {ar}
              </div>
              <div style={{ fontSize: 24, color: C.body, lineHeight: 1.35 }}>{sub}</div>
            </div>
          </FadeUp>
        ))}
      </div>
    </Page>
  );
};

// 10 ─ Soft launch ───────────────────────────────────────────────────────────────────
export const Launch: React.FC = () => {
  const audiences = ["Retail & e-commerce · التجزئة", "Agencies & services · الوكالات", "Accounting firms · مكاتب المحاسبة"];
  return (
    <Page bg={`radial-gradient(circle at 50% 30%, #13574a 0%, ${C.dark} 65%)`} style={{ color: "#f6f5ef" }}>
      <Backdrop opacity={0.35} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 34 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 30 }}>
          <Logo size={130} delay={0} />
          <FadeUp delay={16}>
            <div style={{ fontSize: 96, fontWeight: 700, letterSpacing: -1 }}>
              Siyulah <span style={{ color: C.mint }}>سيولة</span>
            </div>
          </FadeUp>
        </div>
        <FadeUp delay={40} distance={16}>
          <Chip bg={C.orange} border={C.orange} color="#1d0f07" size={26}>
            SOFT LAUNCH · الإطلاق التجريبي
          </Chip>
        </FadeUp>
        <Bi en="Now inviting our first design partners" ar="ندعو الآن شركاءنا الأوائل من المنشآت الصغيرة والمتوسطة" delay={56} size={68} color="#f6f5ef" arColor={C.mint} align="center" width={1700} />
        <div style={{ display: "flex", gap: 18 }}>
          {audiences.map((a, i) => (
            <FadeUp key={a} delay={96 + i * 8} distance={16}>
              <Chip size={26} bg="rgba(155,227,207,0.10)" border="rgba(155,227,207,0.35)" color="#f6f5ef">
                {a}
              </Chip>
            </FadeUp>
          ))}
        </div>
        <FadeUp delay={140} distance={10}>
          <Words text="Cash you can see coming." delay={140} align="center" style={{ fontSize: 44, fontWeight: 600, color: C.mintSoft }} />
        </FadeUp>
      </AbsoluteFill>
    </Page>
  );
};
