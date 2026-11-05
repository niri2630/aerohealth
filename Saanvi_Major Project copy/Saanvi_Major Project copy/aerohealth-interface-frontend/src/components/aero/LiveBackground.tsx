import { cn } from "@/lib/utils";

/** Slow gradient mesh + grid, always behind content. Pauses when paused=true. */
export function LiveBackground({ paused }: { paused?: boolean }) {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        className={cn(
          "absolute -top-1/3 left-1/2 h-[120vh] w-[120vw] -translate-x-1/2 animate-drift rounded-full opacity-[0.22] blur-3xl",
          paused && "[animation-play-state:paused]",
        )}
        style={{
          background:
            "radial-gradient(38% 38% at 30% 35%, var(--primary) 0%, transparent 70%), radial-gradient(30% 30% at 72% 60%, var(--risk-moderate) 0%, transparent 72%)",
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(var(--hairline) 1px, transparent 1px), linear-gradient(90deg, var(--hairline) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage: "radial-gradient(120% 90% at 50% 0%, black 10%, transparent 80%)",
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(to bottom, var(--foreground) 0px, var(--foreground) 1px, transparent 1px, transparent 4px)",
        }}
      />
    </div>
  );
}