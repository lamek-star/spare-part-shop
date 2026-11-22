"use client";
/**
 * The glass dashboard's moving parts: the theme (dark glass by default, light on request, remembered in this browser),
 * the drifting glows behind the page, the greeting, numbers that count up, and the sales chart that draws itself.
 * Everything here respects "reduce motion": the numbers and the chart then simply appear.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n, useT } from "./i18n";
import { qs } from "./api";
import { useApi } from "./kit";

type Theme = "dark" | "light";
const KEY = "sp-theme";

function storedTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}
function applyTheme(theme: Theme) {
  if (theme === "light") document.documentElement.dataset.theme = "light";
  else delete document.documentElement.dataset.theme;
}

/** Applies the remembered theme once the app starts (dark needs nothing: it is the default). */
export function useThemeOnLoad() {
  useEffect(() => applyTheme(storedTheme()), []);
}

export function ThemeSwitch() {
  const t = useT();
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => setTheme(storedTheme()), []);
  const dark = theme === "dark";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      className="theme-switch"
      onClick={() => {
        const next: Theme = dark ? "light" : "dark";
        try {
          localStorage.setItem(KEY, next);
        } catch {
          /* private window: the choice lasts until the page closes */
        }
        applyTheme(next);
        setTheme(next);
      }}
    >
      <span>{t("shell.darkMode")}</span>
      <span className="track" aria-hidden="true" />
    </button>
  );
}

export function GlowField() {
  return (
    <div className="glow-field no-print" aria-hidden="true">
      <span className="g-blue" />
      <span className="g-green" />
      <span className="g-cyan" />
    </div>
  );
}

/** The orange sphere at the top of the page: part of the page, so it scrolls away with the top bar. */
export function SunGlow() {
  return <span className="sun-glow no-print" aria-hidden="true" />;
}

const reduceMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** "Good morning, Sami" and today's date in the person's language. */
export function Greeting({ name }: { name: string }) {
  const { t, language } = useI18n();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  if (!now) return null;
  const hour = now.getHours();
  const key =
    hour < 12
      ? "shell.goodMorning"
      : hour < 18
        ? "shell.goodAfternoon"
        : "shell.goodEvening";
  let date: string;
  try {
    date = now.toLocaleDateString(language, {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  } catch {
    date = now.toDateString();
  }
  return (
    <div className="greeting">
      <h2>{t(key, { name: name.split(/\s+/)[0] || name })}</h2>
      <small>
        <span className="status-dot" /> {date}
      </small>
    </div>
  );
}

/**
 * A number that counts from its last value to the new one (about 0.7 s, easing out), like the reference dashboard's
 * cards. `format` turns the running value into text (money, thousands separators).
 */
export function CountUp({
  value,
  format,
}: {
  value: number;
  format: (n: number) => string;
}) {
  const [shown, setShown] = useState(value);
  const from = useRef(0);
  useEffect(() => {
    if (reduceMotion()) {
      setShown(value);
      from.current = value;
      return;
    }
    const start = performance.now();
    const begin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 700);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(begin + (value - begin) * eased);
      if (p < 1) frame = requestAnimationFrame(tick);
      else from.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <span className="count">{format(shown)}</span>;
}

export const formatCount = (n: number) => Math.round(n).toLocaleString("en-US");
export const formatMoney = (currency: string) => (minor: number) => {
  const v = Math.round(minor);
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  return `${sign}${currency} ${Math.trunc(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
};

interface DayRow {
  day: string;
  invoices: number;
  totalMinor: number;
}
const RANGES = [
  { key: "dash.range7", days: 7 },
  { key: "dash.range30", days: 30 },
  { key: "dash.range90", days: 90 },
  { key: "dash.range12m", days: 365 },
] as const;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

interface Point {
  label: string;
  total: number;
  invoices: number;
}

/** Every day in the range (or every month for a year), zero where nothing was invoiced. */
function series(rows: DayRow[], days: number): Point[] {
  const byDay = new Map(rows.map((r) => [r.day.slice(0, 10), r]));
  const end = new Date();
  if (days > 120) {
    const months: Point[] = [];
    for (let i = 11; i >= 0; i--) {
      const m = new Date(end.getFullYear(), end.getMonth() - i, 1);
      const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`;
      let total = 0;
      let invoices = 0;
      for (const r of rows)
        if (r.day.startsWith(key)) {
          total += r.totalMinor;
          invoices += r.invoices;
        }
      months.push({ label: key, total, invoices });
    }
    return months;
  }
  const out: Point[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    const r = byDay.get(isoDay(d));
    out.push({
      label: isoDay(d),
      total: r?.totalMinor ?? 0,
      invoices: r?.invoices ?? 0,
    });
  }
  return out;
}

/** A smooth line through the points (Catmull-Rom as cubic Bezier). */
function smooth(points: [number, number][]): string {
  if (points.length < 2)
    return points.length ? `M${points[0][0]},${points[0][1]}` : "";
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
  }
  return d;
}

/** The dashboard's sales chart: invoiced totals over 7 / 30 / 90 days or 12 months, drawn as a glowing line. */
export function SalesChart({ currency }: { currency: string }) {
  const t = useT();
  const [days, setDays] = useState<number>(30);
  const range = useMemo(() => {
    const to = new Date();
    const from = new Date(to);
    from.setDate(to.getDate() - (days > 120 ? 365 : days - 1));
    return { from: isoDay(from), to: isoDay(to) };
  }, [days]);
  const data = useApi<DayRow[]>(`/reports/daily-sales${qs(range)}`);
  const points = useMemo(
    () => series(data.data ?? [], days),
    [data.data, days],
  );
  const [hover, setHover] = useState<number | null>(null);
  const money = formatMoney(currency);

  const W = 720;
  const H = 230;
  const pad = { l: 8, r: 8, t: 14, b: 26 };
  const max = Math.max(1, ...points.map((p) => p.total));
  const x = (i: number) =>
    pad.l + (i * (W - pad.l - pad.r)) / Math.max(1, points.length - 1);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const xy = points.map((p, i) => [x(i), y(p.total)] as [number, number]);
  const line = smooth(xy);
  const area = xy.length
    ? `${line} L${x(points.length - 1)},${H - pad.b} L${x(0)},${H - pad.b} Z`
    : "";
  const total = points.reduce((s, p) => s + p.total, 0);
  const invoices = points.reduce((s, p) => s + p.invoices, 0);
  const tickEvery = Math.max(1, Math.ceil(points.length / 6));

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h3>{t("dash.salesTrend")}</h3>
          <div className="chart-total">
            <CountUp value={total} format={money} />
          </div>
          <small className="muted">
            {invoices
              ? t("dash.salesInPeriod", { count: invoices })
              : t("dash.noSalesYet")}
          </small>
        </div>
        <div
          className="range-tabs"
          role="group"
          aria-label={t("dash.salesTrend")}
        >
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              aria-pressed={days === r.days}
              onClick={() => setDays(r.days)}
            >
              {t(r.key)}
            </button>
          ))}
        </div>
      </div>
      <div className="chart-wrap" onMouseLeave={() => setHover(null)}>
        <svg
          className="sales-chart"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${t("dash.salesTrend")}: ${money(total)}`}
          key={`${days}-${total}`}
          onMouseMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            const rel = ((e.clientX - box.left) / box.width) * W;
            const i = Math.round(
              ((rel - pad.l) / (W - pad.l - pad.r)) * (points.length - 1),
            );
            setHover(Math.max(0, Math.min(points.length - 1, i)));
          }}
        >
          <defs>
            <linearGradient id="sales-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.38" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g className="grid">
            {[0.25, 0.5, 0.75].map((f) => (
              <line
                key={f}
                x1={pad.l}
                x2={W - pad.r}
                y1={pad.t + f * (H - pad.t - pad.b)}
                y2={pad.t + f * (H - pad.t - pad.b)}
              />
            ))}
          </g>
          {area && <path className="area" d={area} fill="url(#sales-fill)" />}
          {line && (
            <path
              className="line"
              d={line}
              pathLength={3000}
              style={{ ["--len" as string]: 3000 }}
            />
          )}
          {points.map((p, i) =>
            i % tickEvery === 0 || i === points.length - 1 ? (
              <text key={p.label} x={x(i)} y={H - 6} textAnchor="middle">
                {p.label.slice(5).replace("-", "/")}
              </text>
            ) : null,
          )}
          {hover !== null && xy[hover] && (
            <circle className="dot" cx={xy[hover][0]} cy={xy[hover][1]} r={5} />
          )}
        </svg>
        {hover !== null && xy[hover] && (
          <div
            className="chart-tip"
            style={{
              left: `${(xy[hover][0] / W) * 100}%`,
              top: `${(xy[hover][1] / H) * 100}%`,
            }}
          >
            <strong>{money(points[hover].total)}</strong> ·{" "}
            {points[hover].label}
          </div>
        )}
      </div>
    </div>
  );
}
