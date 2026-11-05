import { motion, useReducedMotion } from "motion/react";

import { CountUp, Shimmer } from "./primitives";
import { EASE, riskColor } from "@/lib/aero/ui";
import type { RiskLabel } from "@/lib/aero/types";
import { AskAIButton } from "./AskAIButton";
import { Tooltip, TooltipContent } from "./Tooltip";

const R = 132;
const CIRC = 2 * Math.PI * R;
const SWEEP = 0.75; // 270° arc

export function RiskGauge({
  score,
  label,
  loading,
  station,
}: {
  score: number;
  label: RiskLabel;
  loading?: boolean;
  station?: string | undefined;
}) {
  const reduced = useReducedMotion();
  const color = riskColor(label);

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-5 py-6">
        <Shimmer className="size-[300px] rounded-full" />
        <Shimmer className="h-3 w-32" />
      </div>
    );
  }

  const pct = Math.max(0, Math.min(100, score)) / 100;

  return (
    <div className="relative flex flex-col items-center py-4">
      {/* Ask AI Button */}
      <AskAIButton
        variant="floating"
        prompt={`Why is my health risk score ${score}? What does a ${label} risk level mean for me?`}
        context={{ score, label, station }}
      />
      
      <motion.div
        aria-hidden
        className="absolute top-1/2 left-1/2 -z-10 size-[360px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
        animate={{ opacity: [0.16, 0.3, 0.16] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        style={{ background: `radial-gradient(circle, ${color} 0%, transparent 68%)` }}
      />

      <div className="relative size-[300px]">
        <svg viewBox="0 0 300 300" className="size-full -rotate-[225deg]">
          <circle
            cx="150"
            cy="150"
            r={R}
            fill="none"
            stroke="var(--hairline)"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${CIRC * SWEEP} ${CIRC}`}
          />
          <motion.circle
            cx="150"
            cy="150"
            r={R}
            fill="none"
            stroke={color}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${CIRC * SWEEP} ${CIRC}`}
            initial={{ strokeDashoffset: CIRC * SWEEP }}
            animate={{ strokeDashoffset: CIRC * SWEEP * (1 - pct) }}
            transition={
              reduced
                ? { duration: 0.2 }
                : { type: "spring", stiffness: 42, damping: 11, mass: 1.1 }
            }
            style={{ filter: `drop-shadow(0 0 14px ${color})` }}
          />
          {Array.from({ length: 28 }).map((_, i) => {
            const a = (i / 27) * SWEEP * 2 * Math.PI;
            const x1 = 150 + Math.cos(a) * (R - 20);
            const y1 = 150 + Math.sin(a) * (R - 20);
            const x2 = 150 + Math.cos(a) * (R - 14);
            const y2 = 150 + Math.sin(a) * (R - 14);
            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="var(--foreground)"
                strokeOpacity={i / 27 <= pct ? 0.5 : 0.13}
                strokeWidth="1.5"
              />
            );
          })}
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="flex items-center gap-1.5">
            <span className="label-glyph">health risk score</span>
            <Tooltip 
              content={TooltipContent.RiskScore} 
              position="right"
              aiPrompt={`Explain my health risk score of ${score}. Why is it ${label}? What factors are contributing most to this score?`}
              aiContext={{ score, label, station }}
            />
          </div>
          <CountUp
            value={score}
            duration={1200}
            className="mt-1 text-[74px] leading-none font-medium tracking-tight"
          />
          <motion.span
            key={label}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: EASE }}
            className="num mt-2 rounded-full border px-3 py-1 text-[10px] tracking-[0.2em] uppercase"
            style={{ color, borderColor: `${color}`, background: `color-mix(in oklab, ${color} 12%, transparent)` }}
          >
            {label}
          </motion.span>
          {station ? (
            <span className="num mt-3 text-[9px] tracking-[0.16em] text-muted-foreground/70 uppercase text-center">
              {station}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}