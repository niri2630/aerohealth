import type { AqiReading, Explanation, LatLon, RouteComparison, Vitals } from "./types";

const STORAGE_KEY = "aerohealth_live_context";

export const PROJECT_CONTEXT = {
  name: "AeroHealth",
  purpose: "A personal air-quality health-risk assistant that combines pollution data, personal vitals, explainable risk scoring, and lower-exposure route planning.",
  capabilities: [
    "current AQI and pollutant monitoring",
    "personal health-risk prediction",
    "SHAP explanations for risk factors",
    "global geocoding and driving routes",
    "safe versus direct route exposure comparison",
    "context-aware AI explanations",
  ],
  dataSources: ["OpenAQ", "OpenStreetMap", "OSRM", "XGBoost", "SHAP"],
  limitations: [
    "risk predictions are a prototype and are not a medical diagnosis",
    "route pollutant values are estimates based on route geometry",
    "historical values may be simulated when live services are unavailable",
  ],
};

export type LiveContext = {
  project: typeof PROJECT_CONTEXT;
  location?: string;
  location_coords?: LatLon;
  aqi_data?: AqiReading;
  risk_data?: Record<string, unknown>;
  shap_data?: Explanation;
  vitals?: Vitals;
  route_data?: RouteComparison;
  updated_at: string;
};

export function readLiveContext(): Partial<LiveContext> {
  if (typeof window === "undefined") return {};
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored ? (JSON.parse(stored) as Partial<LiveContext>) : {};
  } catch {
    return {};
  }
}

export function writeLiveContext(update: Partial<LiveContext>) {
  if (typeof window === "undefined") return;
  const next = {
    ...readLiveContext(),
    ...update,
    project: PROJECT_CONTEXT,
    updated_at: new Date().toISOString(),
  } satisfies LiveContext;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}
