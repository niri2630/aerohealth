import { labelFor } from "./api";
import type { AqiReading, RouteComparison, RouteInsight, Vitals } from "./types";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}

export function deriveRouteInsight(routes: RouteComparison, vitals: Vitals): RouteInsight {
  const safeAqi = routes.safe_route.avg_aqi_exposure;
  const directAqi = routes.direct_route.avg_aqi_exposure;

  const score = clamp(
    safeAqi * 0.58 +
      (vitals.heart_rate - 60) * 0.12 +
      (vitals.age - 30) * 0.14 +
      (vitals.weight - 70) * 0.05 +
      (vitals.asthma ? 10 : 0) -
      routes.exposure_reduction_pct * 0.14,
    1,
    99,
  );

  return {
    ...routes,
    safe_route_aqi: safeAqi,
    direct_route_aqi: directAqi,
    safe_route_risk_score: Math.round(score),
    safe_route_risk_label: labelFor(score),
  };
}

export function deriveRouteReading(reading: AqiReading, insight?: RouteInsight): AqiReading {
  if (!insight) return reading;

  const baseAqi = reading.aqi || 1;
  const ratio = insight.safe_route_aqi / baseAqi;

  return {
    ...reading,
    aqi: insight.safe_route_aqi,
    pm25: roundOne(reading.pm25 * ratio * 0.97),
    pm10: roundOne(reading.pm10 * ratio * 0.94),
    no2: roundOne(reading.no2 * ratio * 0.91),
    o3: roundOne(reading.o3 * ratio * 0.93),
    so2: roundOne(reading.so2 * ratio * 0.89),
    station: "Safe route estimate",
  };
}