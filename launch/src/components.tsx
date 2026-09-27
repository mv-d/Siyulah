import React from "react";
import { Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT } from "./theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export function useSpring(delay = 0, damping = 200) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping } });
}

export function useProgress(start: number, duration: number, easing = Easing.inOut(Easing.cubic)) {
  const frame = useCurrentFrame();
  return interpolate(frame, [start, start + duration], [0, 1], { ...clamp, easing });
}

export const FadeUp: React.FC<{ delay?: number; distance?: number; style?: React.CSSProperties; children: React.ReactNode }> = ({
  delay = 0,
  distance = 40,
  style,
  children,
}) => {
  const p = useSpring(delay);
  return <div style={{ opacity: p, transform: `translateY(${(1 - p) * distance}px)`, ...style }}>{children}</div>;
};

const Word: React.FC<{ delay: number; children: React.ReactNode }> = ({ delay, children }) => {
  const p = useSpring(delay);
  return (
    <span style={{ display: "inline-block", opacity: p, transform: `translateY(${(1 - p) * 0.45}em)` }}>{children}</span>
  );
};

/** A line of text whose words rise in one after another. Arabic runs right to left. */
export const Words: React.FC<{
  text: string;
  delay?: number;
  stagger?: number;
  rtl?: boolean;
  align?: "start" | "center";
  style?: React.CSSProperties;
}> = ({ text, delay = 0, stagger = 3, rtl = false, align = "start", style }) => (
  <div
    dir={rtl ? "rtl" : "ltr"}
    style={{
      display: "flex",
      flexWrap: "wrap",
      columnGap: "0.26em",
      justifyContent: align === "center" ? "center" : rtl ? "flex-end" : "flex-start",
      direction: rtl ? "rtl" : "ltr",
      ...style,
    }}
  >
    {text.split(" ").map((w, i) => (
      <Word key={i} delay={delay + i * stagger}>
        {w}
      </Word>
    ))}
  </div>
);

/** English headline with its Arabic line underneath. */
export const Bi: React.FC<{
  en: string;
  ar: string;
  delay?: number;
  size?: number;
  color?: string;
  arColor?: string;
  align?: "start" | "center";
  width?: number;
}> = ({ en, ar, delay = 0, size = 72, color = C.ink, arColor = C.brand, align = "start", width }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: size * 0.22, width }}>
    <Words
      text={en}
      delay={delay}
      align={align}
      style={{ fontSize: size, fontWeight: 700, lineHeight: 1.12, color, letterSpacing: -0.5 }}
    />
    <Words
      text={ar}
      delay={delay + 10}
      rtl
      align={align}
      style={{ fontSize: size * 0.6, fontWeight: 600, lineHeight: 1.35, color: arColor, width: "100%" }}
    />
  </div>
);

export const Eyebrow: React.FC<{ children: React.ReactNode; color?: string; delay?: number }> = ({
  children,
  color = C.brand,
  delay = 0,
}) => (
  <FadeUp delay={delay} distance={16}>
    <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: 4, textTransform: "uppercase", color }}>{children}</div>
  </FadeUp>
);

/** The Siyulah mark: the square pops, the cash curve draws, the dot lands. */
export const Logo: React.FC<{ size: number; delay?: number; bg?: string }> = ({ size, delay = 0, bg = C.brand }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: frame - delay, fps, config: { damping: 14, stiffness: 120 } });
  const draw = interpolate(frame - delay - 8, [0, 26], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const dot = spring({ frame: frame - delay - 30, fps, config: { damping: 9 } });
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" style={{ transform: `scale(${pop})`, flex: "none" }}>
      <rect width="64" height="64" rx="16" fill={bg} />
      <path
        d="M14 42c8 0 10-14 18-14s10 8 18 8"
        fill="none"
        stroke="#ffffff"
        strokeWidth="5"
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={1 - draw}
      />
      <circle cx="50" cy="36" r={4.5 * dot} fill={C.mint} />
    </svg>
  );
};

export const Counter: React.FC<{
  from: number;
  to: number;
  start: number;
  duration?: number;
  format: (n: number) => string;
  style?: React.CSSProperties;
}> = ({ from, to, start, duration = 45, format, style }) => {
  const t = useProgress(start, duration, Easing.out(Easing.cubic));
  return <span style={{ fontVariantNumeric: "tabular-nums", ...style }}>{format(from + (to - from) * t)}</span>;
};

export const Arrow: React.FC<{ size?: number; color?: string }> = ({ size = 56, color = C.ink }) => (
  <svg width={size} height={size * 0.6} viewBox="0 0 40 24" style={{ flex: "none" }}>
    <path d="M2 12H34M24 3l10 9-10 9" fill="none" stroke={color} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const Chip: React.FC<{ children: React.ReactNode; bg?: string; color?: string; size?: number; border?: string; style?: React.CSSProperties }> = ({
  children,
  bg = C.card,
  color = C.ink,
  size = 28,
  border = C.line,
  style,
}) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 12,
      padding: `${size * 0.42}px ${size * 0.8}px`,
      borderRadius: 999,
      background: bg,
      color,
      border: `2px solid ${border}`,
      fontSize: size,
      fontWeight: 600,
      whiteSpace: "nowrap",
      ...style,
    }}
  >
    {children}
  </div>
);

/** A screenshot in a light browser window, slowly zooming toward `origin`. */
export const Browser: React.FC<{
  src: string;
  width: number;
  zoom?: [number, number];
  zoomStart?: number;
  zoomDuration?: number;
  origin?: string;
  dark?: boolean;
  children?: React.ReactNode;
}> = ({ src, width, zoom = [1, 1.05], zoomStart = 0, zoomDuration = 150, origin = "50% 30%", dark = false, children }) => {
  const t = useProgress(zoomStart, zoomDuration, Easing.inOut(Easing.sin));
  const scale = zoom[0] + (zoom[1] - zoom[0]) * t;
  const height = (width * 9) / 16;
  return (
    <div
      style={{
        width,
        borderRadius: 20,
        overflow: "hidden",
        background: dark ? "#10231f" : "#ffffff",
        boxShadow: "0 30px 80px rgba(14,42,36,0.28), 0 4px 14px rgba(14,42,36,0.12)",
        border: `1px solid ${dark ? C.darkLine : C.line}`,
      }}
    >
      <div
        style={{
          height: 44,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 18px",
          background: dark ? C.dark2 : "#eef1ee",
          borderBottom: `1px solid ${dark ? C.darkLine : C.line}`,
        }}
      >
        {["#e36a5a", "#e8b64c", "#5cb85c"].map((c) => (
          <span key={c} style={{ width: 14, height: 14, borderRadius: 7, background: c, display: "inline-block" }} />
        ))}
        <div
          style={{
            marginLeft: 18,
            padding: "4px 18px",
            borderRadius: 999,
            background: dark ? "#0e2a24" : "#ffffff",
            color: dark ? C.onDark : C.muted,
            fontSize: 18,
            fontFamily: FONT,
          }}
        >
          Siyulah
        </div>
      </div>
      <div style={{ width, height, overflow: "hidden", position: "relative" }}>
        <div style={{ position: "absolute", inset: 0, transform: `scale(${scale})`, transformOrigin: origin }}>
          <Img src={staticFile(src)} style={{ width, height, display: "block" }} />
          {children}
        </div>
      </div>
    </div>
  );
};

/** A phone showing a tall screenshot. */
export const Phone: React.FC<{ src: string; width: number }> = ({ src, width }) => {
  const inner = width - 24;
  return (
    <div
      style={{
        width,
        padding: 12,
        borderRadius: 52,
        background: "#0b1f1b",
        boxShadow: "0 40px 90px rgba(0,0,0,0.45)",
        border: `2px solid ${C.darkLine}`,
      }}
    >
      <div style={{ width: inner, height: inner * 2.05, borderRadius: 40, overflow: "hidden", background: "#ffffff" }}>
        <Img src={staticFile(src)} style={{ width: inner, display: "block" }} />
      </div>
    </div>
  );
};

/** A pulsing ring drawn over part of a screenshot (coordinates in percent). */
export const Highlight: React.FC<{ left: number; top: number; width: number; height: number; start: number }> = ({
  left,
  top,
  width,
  height,
  start,
}) => {
  const frame = useCurrentFrame();
  const inP = useSpring(start, 14);
  const pulse = 0.5 + 0.5 * Math.sin((frame - start) / 6);
  return (
    <div
      style={{
        position: "absolute",
        left: `${left}%`,
        top: `${top}%`,
        width: `${width}%`,
        height: `${height}%`,
        borderRadius: 14,
        border: `4px solid ${C.orange}`,
        boxShadow: `0 0 0 ${6 + pulse * 10}px rgba(224,102,47,${0.18 * inP})`,
        opacity: inP,
        transform: `scale(${0.9 + 0.1 * inP})`,
      }}
    />
  );
};

export const sar = (n: number) => `SAR ${(Math.round(n / 100) / 10).toFixed(1)}K`;
export const pct = (n: number) => `${Math.round(n)}%`;
