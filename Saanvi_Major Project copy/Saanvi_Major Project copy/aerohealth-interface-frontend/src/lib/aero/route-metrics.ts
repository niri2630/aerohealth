import { simPredict } from "./api";
import type {
  AqiReading,
  PredictBody,
  Prediction,
  RouteComparison,
  RouteInsight,
  RouteLeg,
  Vitals,
} from "./types";

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}

/**
 * True when the safe and the direct route follow the same road. The map then shows one line (the safe
 * route is drawn over the direct one), so the UI says so instead of looking like a missing route.
 */
export function routesCoincide(routes: RouteComparison): boolean {
  const a = (routes.direct_route.geojson as { coordinates?: number[][] }).coordinates ?? [];
  const b = (routes.safe_route.geojson as { coordinates?: number[][] }).coordinates ?? [];
  if (!a.length || a.length !== b.length) return false;
  const step = Math.max(1, Math.floor(a.length / 12));
  for (let i = 0; i < a.length; i += step) {
    const p = a[i];
    const q = b[i];
    if (
      !p ||
      !q ||
      Math.abs((p[0] ?? 0) - (q[0] ?? 0)) > 1e-6 ||
      Math.abs((p[1] ?? 0) - (q[1] ?? 0)) > 1e-6
    ) {
      return false;
    }
  }
  return true;
}

/**
 * The exact model input for "what is my risk while travelling this leg":
 * the leg's average pollutants + the ambient weather + the full personal profile
 * (hypertension, SpO2, activity, mask, ...).
 */
export function legPredictBody(
  leg: RouteLeg,
  vitals: Vitals,
  weather?: Pick<AqiReading, "temperature" | "humidity">,
): PredictBody | undefined {
  const p = leg.pollutants;
  if (!p) return undefined;
  return {
    pm25: p.pm25,
    no2: p.no2,
    o3: p.o3,
    so2: p.so2,
    temperature: weather?.temperature ?? 25,
    humidity: weather?.humidity ?? 60,
    ...vitals,
  };
}

/**
 * Route insight with an instant local score. The dashboard then upgrades the
 * two risk scores to the server model's answer (see `withModelScores`).
 */
export function deriveRouteInsight(
  routes: RouteComparison,
  vitals: Vitals,
  weather?: Pick<AqiReading, "temperature" | "humidity">,
): RouteInsight {
  const score = (leg: RouteLeg) => {
    const body = legPredictBody(leg, vitals, weather);
    return body ? simPredict(body) : undefined;
  };
  const safe = score(routes.safe_route);
  const direct = score(routes.direct_route);
  return {
    ...routes,
    safe_route_aqi: routes.safe_route.avg_aqi_exposure,
    direct_route_aqi: routes.direct_route.avg_aqi_exposure,
    safe_route_risk_score: safe?.risk_score ?? 0,
    safe_route_risk_label: safe?.risk_label ?? "Low",
    direct_route_risk_score: direct?.risk_score ?? 0,
    direct_route_risk_label: direct?.risk_label ?? "Low",
  };
}

export function withModelScores(
  insight: RouteInsight,
  safe?: Prediction,
  direct?: Prediction,
): RouteInsight {
  return {
    ...insight,
    ...(safe
      ? { safe_route_risk_score: safe.risk_score, safe_route_risk_label: safe.risk_label }
      : {}),
    ...(direct
      ? { direct_route_risk_score: direct.risk_score, direct_route_risk_label: direct.risk_label }
      : {}),
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
