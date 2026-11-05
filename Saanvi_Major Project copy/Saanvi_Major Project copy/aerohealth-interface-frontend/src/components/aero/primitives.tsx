import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { EASE } from "@/lib/aero/ui";

/** Monospace number that eases into position. Never pops in. */
export function CountUp({
  value,
  digits = 0,
  duration = 900,
  className,
  prefix = "",
  suffix = "",
}: {
  value: number;
  digits?: number;
  duration?: number;
  className?: string;
  prefix?: string;
  suffix?: string;
}) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    if (reduced) {
      setShown(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(a + (value - a) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, reduced]);

  return (
    <span className={cn("num", className)}>
      {prefix}
      {shown.toFixed(digits)}
      {suffix}
    </span>
  );
}

export function Panel({
  children,
  className,
  delay = 0,
  raise = true,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  raise?: boolean;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.section
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 18, filter: "blur(8px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: reduced ? 0.2 : 0.6, ease: EASE, delay }}
      className={cn("panel grain", raise && "panel-raise", className)}
    >
      {children}
    </motion.section>
  );
}

export function PanelHead({
  label,
  hint,
  right,
}: {
  label: string;
  hint?: string;
  right?: ReactNode;
}) {
  return (
    <header className="flex items-center justify-between gap-4 px-5 pt-4 pb-3">
      <div className="flex items-baseline gap-3">
        <span className="label-glyph">{label}</span>
        {hint ? <span className="num text-[10px] text-muted-foreground/70">{hint}</span> : null}
      </div>
      {right}
    </header>
  );
}

/** Shimmer skeleton in the same glass language as the panels. */
export function Shimmer({ className }: { className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-xl bg-surface-2", className)}>
      <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-foreground/8 to-transparent" />
    </div>
  );
}

export function CalmState({
  icon,
  message,
  className,
}: {
  icon: ReactNode;
  message: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-10 text-center",
        className,
      )}
    >
      <span className="text-muted-foreground/60">{icon}</span>
      <p className="num text-[11px] tracking-wide text-muted-foreground">{message}</p>
    </div>
  );
}