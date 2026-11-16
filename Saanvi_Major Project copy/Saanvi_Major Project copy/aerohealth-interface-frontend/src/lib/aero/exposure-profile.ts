import type { Activity, MaskType, RouteComparison, RouteLeg } from "./types";

/**
 * Personal-exposure constants. Mirrors aerohealth-api/exposure_profile.py -
 * keep the two in sync so the dashboard score and route comparison agree.
 */
export const ACTIVITY_VENTILATION_LPM: Record<Activity, number> = {
  resting: 8,
  walking: 20,
  cycling: 38,
};

/** Fraction of each pollutant that still reaches the lungs through the mask. */
export const MASK_PENETRATION: Record<MaskType, { pm: number; gas: number }> = {
  none: { pm: 1, gas: 1 },
  surgical: { pm: 0.7, gas: 0.97 },
  n95: { pm: 0.1, gas: 0.9 },
};

export const ACTIVITY_LABEL: Record<Activity, string> = {
  resting: "Resting",
  walking: "Walking",
  cycling: "Cycling",
};

export const MASK_LABEL: Record<MaskType, string> = {
  none: "None",
  surgical: "Surgical",
  n95: "N95 / KN95",
};

/** One-tap speed presets for the route planner (km/h). */
export const SPEED_PRESETS: { label: string; kmh: number }[] = [
  { label: "Walk", kmh: 5 },
  { label: "Run", kmh: 8 },
  { label: "Cycle", kmh: 18 },
  { label: "Car", kmh: 50 },
];

export const DEFAULT_SPEED_KMH = 8;

const POLLUTANTS = ["pm25", "pm10", "no2", "so2", "o3"] as const;
export type PollutantKey = (typeof POLLUTANTS)[number];
export const POLLUTANT_LABEL: Record<PollutantKey, string> = {
  pm25: "PM2.5",
  pm10: "PM10",
  no2: "NO₂",
  so2: "SO₂",
  o3: "O₃",
};
export const POLLUTANT_KEYS = POLLUTANTS;

export type Inhaled = Record<PollutantKey, number>;

export function emptyInhaled(): Inhaled {
  return { pm25: 0, pm10: 0, no2: 0, so2: 0, o3: 0 };
}

export function round1(value: number) {
  return Math.round(value * 10) / 10;
}

/** µg inhaled = concentration (µg/m³) × ventilation (m³/min) × minutes × mask penetration. */
export function inhaledDose(
  pollutants: RouteLeg["pollutants"],
  durationMin: number,
  activity: Activity,
  mask: MaskType,
): Inhaled {
  const vent = ACTIVITY_VENTILATION_LPM[activity] / 1000;
  const out = emptyInhaled();
  if (!pollutants) return out;
  for (const key of POLLUTANTS) {
    const pen =
      key === "pm25" || key === "pm10" ? MASK_PENETRATION[mask].pm : MASK_PENETRATION[mask].gas;
    out[key] = round1((pollutants[key] ?? 0) * vent * durationMin * pen);
  }
  return out;
}

export function totalDose(inhaled: Inhaled) {
  return round1(POLLUTANTS.reduce((sum, key) => sum + inhaled[key], 0));
}

/** Re-time a leg at the traveller's speed and attach the dose they would inhale. */
export function personaliseLeg(
  leg: RouteLeg,
  speedKmh: number | undefined,
  activity: Activity,
  mask: MaskType,
): RouteLeg {
  const duration =
    speedKmh && speedKmh > 0 && leg.distance_km
      ? Math.max(1, Math.round((leg.distance_km / speedKmh) * 60))
      : leg.duration_min;
  const inhaled = inhaledDose(leg.pollutants, duration, activity, mask);
  return {
    ...leg,
    duration_min: duration,
    ...(speedKmh ? { speed_kmh: speedKmh } : {}),
    inhaled_ug: inhaled,
    inhaled_total_ug: totalDose(inhaled),
  };
}

export function doseReductionPct(direct: RouteLeg, safe: RouteLeg) {
  const base = direct.inhaled_total_ug ?? 0;
  if (base <= 0) return 0;
  return Math.max(0, Math.round((1 - (safe.inhaled_total_ug ?? 0) / base) * 100));
}

/** Re-apply the user's profile to an already-fetched route comparison. */
export function personaliseRoutes(
  routes: RouteComparison,
  speedKmh: number | undefined,
  activity: Activity,
  mask: MaskType,
): RouteComparison {
  const direct = personaliseLeg(routes.direct_route, speedKmh, activity, mask);
  const safe = personaliseLeg(routes.safe_route, speedKmh, activity, mask);
  return {
    ...routes,
    direct_route: direct,
    safe_route: safe,
    exposure_reduction_pct: doseReductionPct(direct, safe),
  };
}
