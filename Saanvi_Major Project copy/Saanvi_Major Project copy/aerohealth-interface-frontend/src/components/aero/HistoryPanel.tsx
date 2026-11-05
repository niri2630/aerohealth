import { Leaf, Sparkles, TrendingUp } from "lucide-react";
import { motion } from "motion/react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { CalmState, CountUp, Panel, PanelHead, Shimmer } from "./primitives";
import { EASE, clockOf } from "@/lib/aero/ui";
import type { HistoryPoint } from "@/lib/aero/types";

export function HistoryPanel({
  history,
  loading,
  range,
  onRange,
}: {
  history: HistoryPoint[];
  loading?: boolean;
  range: 24 | 168;
  onRange: (r: 24 | 168) => void;
}) {
  const data = history.map((h) => ({ ...h, t: clockOf(h.timestamp) }));
  const peak = data.length
    ? data.reduce((a, b) => (b.risk_score > a.risk_score ? b : a))
    : undefined;
  const clean = data.length ? data.reduce((a, b) => (b.aqi < a.aqi ? b : a)) : undefined;
  const avg = data.length
    ? data.reduce((s, d) => s + d.aqi, 0) / data.length
    : 0;

  return (
    <Panel delay={0.4}>
      <PanelHead
        label="trend"
        hint={range === 24 ? "last 24 hours" : "last 7 days"}
        right={
          <div className="flex rounded-lg border border-hairline bg-surface-2 p-0.5">
            {([24, 168] as const).map((r) => (
              <button
                key={r}
                onClick={() => onRange(r)}
                className="relative px-3 py-1"
              >
                {range === r ? (
                  <motion.span
                    layoutId="range-pill"
                    className="absolute inset-0 rounded-md bg-surface-3"
                    transition={{ type: "spring", stiffness: 420, damping: 32 }}
                  />
                ) : null}
                <span
                  className={`num relative text-[10px] tracking-[0.14em] uppercase ${
                    range === r ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {r === 24 ? "24h" : "7d"}
                </span>
              </button>
            ))}
          </div>
        }
      />

      <div className="h-[240px] px-2">
        {loading ? (
          <Shimmer className="mx-3 h-[220px] rounded-2xl" />
        ) : data.length === 0 ? (
          <CalmState
            icon={<TrendingUp size={18} strokeWidth={1.4} />}
            message="No telemetry recorded for this window yet."
          />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: -12 }}>
              <defs>
                <linearGradient id="gAqi" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.36} />
                  <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gRisk" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--risk-high)" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="var(--risk-high)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--hairline)" vertical={false} />
              <XAxis
                dataKey="t"
                tick={{ fontSize: 10, fill: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}
                stroke="var(--hairline)"
                interval="preserveStartEnd"
                minTickGap={28}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}
                stroke="var(--hairline)"
                width={44}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--hairline)",
                  borderRadius: 14,
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                }}
                labelStyle={{ color: "var(--muted-foreground)" }}
              />
              <Area
                type="monotone"
                dataKey="aqi"
                stroke="var(--primary)"
                strokeWidth={1.8}
                fill="url(#gAqi)"
                animationDuration={900}
              />
              <Area
                type="monotone"
                dataKey="risk_score"
                stroke="var(--risk-high)"
                strokeWidth={1.6}
                fill="url(#gRisk)"
                animationDuration={1100}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="grid gap-2 px-4 pt-4 pb-5 sm:grid-cols-3">
        {[
          {
            icon: <TrendingUp size={13} strokeWidth={1.5} />,
            label: "highest risk",
            value: peak?.risk_score ?? 0,
            caption: peak ? `peaked at ${peak.t}` : "—",
          },
          {
            icon: <Leaf size={13} strokeWidth={1.5} />,
            label: "cleanest air",
            value: clean?.aqi ?? 0,
            caption: clean ? `AQI low at ${clean.t}` : "—",
          },
          {
            icon: <Sparkles size={13} strokeWidth={1.5} />,
            label: "window average",
            value: avg,
            caption: "mean AQI across window",
          },
        ].map((m, i) => (
          <motion.div
            key={m.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE, delay: 0.45 + i * 0.06 }}
            className="inset-tier px-4 py-3"
          >
            <div className="flex items-center gap-2 text-primary">
              {m.icon}
              <span className="label-glyph">{m.label}</span>
            </div>
            <CountUp value={m.value} className="mt-1 block text-2xl tracking-tight" />
            <p className="mt-0.5 text-[11px] text-muted-foreground">{m.caption}</p>
          </motion.div>
        ))}
      </div>
    </Panel>
  );
}