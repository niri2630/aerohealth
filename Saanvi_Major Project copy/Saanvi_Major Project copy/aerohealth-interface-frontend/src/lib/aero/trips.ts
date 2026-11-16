import { emptyInhaled, inhaledDose, totalDose, type Inhaled } from "./exposure-profile";
import type { Activity, MaskType, RouteComparison, RouteLeg, Vitals } from "./types";

/**
 * Trip log. Searching for a route on the dashboard only *plans* it; nothing is
 * recorded until the user logs the route they actually took. Reports are built
 * from logged trips only, so browsing routes never distorts the exposure report.
 */
const STORAGE_KEY = "aerohealth_trips_v1";
const CHANGE_EVENT = "aerohealth:trips";

export type TripLeg = {
  distance_km: number;
  avg_aqi: number;
  pollutants: NonNullable<RouteLeg["pollutants"]>;
};

export type Trip = {
  id: string;
  /** When the trip actually happened (editable). */
  occurredAt: string;
  loggedAt: string;
  origin: string;
  destination: string;
  routeTaken: "safe" | "direct";
  speed_kmh: number;
  activity: Activity;
  mask: MaskType;
  legs: { safe: TripLeg; direct: TripLeg };
  vitals: Vitals;
  weather: { temperature: number; humidity: number };
  /** Untick to keep a trip in the log but leave it out of the report totals. */
  included: boolean;
  edited: boolean;
};

export type TripMetrics = {
  distance_km: number;
  duration_min: number;
  avg_aqi: number;
  pollutants: TripLeg["pollutants"];
  inhaled: Inhaled;
  inhaled_total_ug: number;
};

const ZERO_POLLUTANTS = { pm25: 0, pm10: 0, no2: 0, so2: 0, o3: 0 };

function toTripLeg(leg: RouteLeg): TripLeg {
  return {
    distance_km: leg.distance_km,
    avg_aqi: leg.avg_aqi_exposure,
    pollutants: leg.pollutants ?? ZERO_POLLUTANTS,
  };
}

/** Duration and inhaled dose are derived from distance + pollutants, so edits stay consistent. */
export function tripMetrics(trip: Trip): TripMetrics {
  const leg = trip.legs[trip.routeTaken];
  const duration = Math.max(1, Math.round((leg.distance_km / Math.max(trip.speed_kmh, 0.1)) * 60));
  const inhaled = leg.distance_km
    ? inhaledDose(leg.pollutants, duration, trip.activity, trip.mask)
    : emptyInhaled();
  return {
    distance_km: leg.distance_km,
    duration_min: duration,
    avg_aqi: leg.avg_aqi,
    pollutants: leg.pollutants,
    inhaled,
    inhaled_total_ug: totalDose(inhaled),
  };
}

export function loadTrips(): Trip[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Trip[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(trips: Trip[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trips));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeTrips(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function logTrip(input: {
  routes: RouteComparison;
  routeTaken: "safe" | "direct";
  origin: string;
  destination: string;
  speedKmh: number;
  vitals: Vitals;
  weather: { temperature: number; humidity: number };
}): Trip {
  const now = new Date().toISOString();
  const trip: Trip = {
    id: `trip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    occurredAt: now,
    loggedAt: now,
    origin: input.origin,
    destination: input.destination,
    routeTaken: input.routeTaken,
    speed_kmh: input.speedKmh,
    activity: input.vitals.activity,
    mask: input.vitals.mask,
    legs: {
      safe: toTripLeg(input.routes.safe_route),
      direct: toTripLeg(input.routes.direct_route),
    },
    vitals: input.vitals,
    weather: input.weather,
    included: true,
    edited: false,
  };
  persist([trip, ...loadTrips()]);
  return trip;
}

export function updateTrip(id: string, patch: Partial<Trip>) {
  persist(loadTrips().map((trip) => (trip.id === id ? { ...trip, ...patch, edited: true } : trip)));
}

export function deleteTrip(id: string) {
  persist(loadTrips().filter((trip) => trip.id !== id));
}

export function clearTrips() {
  persist([]);
}
