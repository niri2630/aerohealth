import { motion } from "motion/react";

import { CountUp, Shimmer } from "./primitives";
import { EASE } from "@/lib/aero/ui";
import type { AqiReading, HistoryPoint, RouteInsight } from "@/lib/aero/types";
import { AskAIButton } from "./AskAIButton";
import { Tooltip, TooltipContent } from "./Tooltip";

function Spark({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const d = points
    .map((p, i) => `${(i / (points.length - 1)) * 100},${22 - ((p - min) / span) * 20}`)
    .join(" ");
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="h-5 w-full">
      <polyline
        points={d}
        fill="none"
        stroke="var(--primary)"
        strokeOpacity="0.75"
        strokeWidth="1.4"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function TelemetryStrip({
  reading,
  history,
  loading,
  routeInsight,
}: {
  reading?: AqiReading | undefined;
  history: HistoryPoint[];
  loading?: boolean;
  routeInsight?: RouteInsight | undefined;
}) {
  if (loading || !reading) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Shimmer key={i} className="h-[74px]" />
        ))}
      </div>
    );
  }

  const trend = history.map((h) => h.aqi);
  const isRouteDerived = reading.station === "Safe route estimate";
  const chips: { k: string; v: number; unit: string; digits?: number; spark?: boolean; tooltip?: React.ReactNode; aiPrompt?: string }[] = [
    { 
      k: "AQI", 
      v: reading.aqi, 
      unit: "us", 
      spark: true, 
      tooltip: TooltipContent.AQI,
      aiPrompt: `Current AQI is ${reading.aqi}. What does this mean for my health? What precautions should I take?`
    },
    { 
      k: "PM2.5", 
      v: reading.pm25, 
      unit: "µg/m³", 
      digits: 1, 
      spark: true, 
      tooltip: TooltipContent.PM25,
      aiPrompt: `PM2.5 level is ${reading.pm25.toFixed(1)} µg/m³. Is this dangerous? What are the health effects and how can I protect myself?`
    },
    { 
      k: "PM10", 
      v: reading.pm10, 
      unit: "µg/m³", 
      digits: 1, 
      tooltip: TooltipContent.PM10,
      aiPrompt: `PM10 is at ${reading.pm10.toFixed(1)} µg/m³. Should I be concerned about this level?`
    },
    { 
      k: "NO₂", 
      v: reading.no2, 
      unit: "ppb", 
      digits: 1, 
      tooltip: TooltipContent.NO2,
      aiPrompt: `NO₂ (Nitrogen Dioxide) is ${reading.no2.toFixed(1)} ppb. What health risks does this pose, especially for respiratory health?`
    },
    { 
      k: "O₃", 
      v: reading.o3, 
      unit: "ppb", 
      digits: 1, 
      tooltip: TooltipContent.O3,
      aiPrompt: `Ground-level Ozone is ${reading.o3.toFixed(1)} ppb. How does this affect my lungs and when is it typically highest?`
    },
    { 
      k: "SO₂", 
      v: reading.so2, 
      unit: "ppb", 
      digits: 1, 
      tooltip: TooltipContent.SO2,
      aiPrompt: `SO₂ (Sulfur Dioxide) is ${reading.so2.toFixed(1)} ppb. What are the sources and health impacts of this level?`
    },
    { k: "Temp", v: reading.temperature, unit: "°C", digits: 1 },
    { k: "Humidity", v: reading.humidity, unit: "%" },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <div className="space-y-0.5">
          <span className="text-xs text-muted-foreground">
            {routeInsight ? "Safe Route Air Quality" : "Live Air Quality Data"}
          </span>
          {isRouteDerived ? (
            <div className="num text-[9px] tracking-[0.14em] uppercase text-primary/80">
              route-derived pollutant estimate
            </div>
          ) : null}
        </div>
        <AskAIButton
          variant="subtle"
          label="Explain metrics"
          prompt={`Can you explain what these air quality metrics mean? AQI: ${reading.aqi}, PM2.5: ${reading.pm25.toFixed(1)} µg/m³, PM10: ${reading.pm10.toFixed(1)} µg/m³, NO₂: ${reading.no2.toFixed(1)} ppb, O₃: ${reading.o3.toFixed(1)} ppb, SO₂: ${reading.so2.toFixed(1)} ppb`}
          context={reading}
        />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2">
        {chips.map((c, i) => (
          <motion.div
            key={c.k}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE, delay: 0.05 * i }}
            className="inset-tier px-3 py-2.5"
          >
            <div className="flex items-baseline justify-between">
              <div className="flex items-center gap-1">
                <span className="label-glyph">{c.k}</span>
                {c.tooltip && (
                  <Tooltip 
                    content={c.tooltip} 
                    position="top"
                    aiPrompt={c.aiPrompt}
                    aiContext={{ pollutant: c.k, value: c.v, unit: c.unit }}
                  />
                )}
              </div>
              <span className="num text-[9px] text-muted-foreground/60">{c.unit}</span>
            </div>
            <CountUp value={c.v} digits={c.digits ?? 0} className="text-lg tracking-tight" />
            {c.spark ? <Spark points={trend} /> : <div className="h-5" />}
          </motion.div>
        ))}
      </div>
    </div>
  );
}