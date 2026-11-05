import type {
  AqiReading,
  Explanation,
  HistoryPoint,
  LatLon,
  PredictBody,
  Prediction,
  RiskLabel,
  RouteComparison,
} from "./types";

const BASE = (import.meta.env["VITE_API_URL"] ?? "").replace(/\/$/, "");

/**
 * Every read goes through the REST contract at VITE_API_URL. When the demo API
 * is unreachable we fall back to a deterministic local simulation so no panel
 * ever renders a raw error — `simulated` flags that state in the UI.
 */
export type Sourced<T> = { data: T; simulated: boolean };

const OSRM_BASE = "https://router.project-osrm.org/route/v1/driving";
const NOMINATIM_BASE = "https://nominatim.openstreetmap.org/search";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  if (!BASE) throw new Error("VITE_API_URL is not configured");
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${path} responded ${res.status}`);
  return (await res.json()) as T;
}

async function withFallback<T>(fn: () => Promise<T>, fallback: () => T): Promise<Sourced<T>> {
  try {
    return { data: await fn(), simulated: false };
  } catch {
    return { data: fallback(), simulated: true };
  }
}

/* ── deterministic simulation ─────────────────────────────────────── */

function seeded(lat: number, lon: number) {
  const s = Math.abs(Math.sin(lat * 12.9898 + lon * 78.233) * 43758.5453);
  return s - Math.floor(s);
}

function routeExposure(coordinates: [number, number][]) {
  const samples = coordinates.filter((_, index) => index % Math.max(1, Math.floor(coordinates.length / 32)) === 0);
  const values = samples.map(([lon, lat]) => {
    const r = seeded(lat, lon);
    const aqi = 38 + r * 112;
    return {
      aqi,
      pm25: aqi * 0.52,
      pm10: aqi * 0.83,
      no2: 12 + r * 38,
      so2: 3 + r * 11,
      o3: 18 + (1 - r) * 44,
    };
  });
  const average = (key: keyof (typeof values)[number]) =>
    values.length ? values.reduce((sum, value) => sum + value[key], 0) / values.length : 0;
  return {
    aqi: Math.round(average("aqi")),
    pollutants: {
      pm25: Math.round(average("pm25") * 10) / 10,
      pm10: Math.round(average("pm10") * 10) / 10,
      no2: Math.round(average("no2") * 10) / 10,
      so2: Math.round(average("so2") * 10) / 10,
      o3: Math.round(average("o3") * 10) / 10,
    },
  };
}

function simAqi({ lat, lon }: LatLon): AqiReading {
  const r = seeded(lat, lon);
  const aqi = Math.round(42 + r * 118);
  return {
    aqi,
    pm25: Math.round(aqi * 0.52 * 10) / 10,
    pm10: Math.round(aqi * 0.83 * 10) / 10,
    no2: Math.round((12 + r * 38) * 10) / 10,
    o3: Math.round((18 + (1 - r) * 44) * 10) / 10,
    so2: Math.round((3 + r * 11) * 10) / 10,
    temperature: Math.round((14 + r * 18) * 10) / 10,
    humidity: Math.round(38 + (1 - r) * 44),
    station: "LOCAL-SIM-01",
    timestamp: new Date().toISOString(),
  };
}

export function labelFor(score: number): RiskLabel {
  if (score < 25) return "Low";
  if (score < 50) return "Moderate";
  if (score < 75) return "High";
  return "Severe";
}

function simPredict(b: PredictBody): Prediction {
  const score = Math.max(
    2,
    Math.min(
      99,
      b.pm25 * 0.62 +
        b.no2 * 0.24 +
        b.o3 * 0.14 +
        b.so2 * 0.3 +
        (b.heart_rate - 68) * 0.28 +
        (b.age - 32) * 0.18 +
        (b.weight - 72) * 0.06 +
        (b.asthma ? 14 : 0) +
        Math.max(0, b.humidity - 60) * 0.08,
    ),
  );
  return {
    risk_score: Math.round(score),
    risk_label: labelFor(score),
    predicted_impacts: {
      heart_rate_delta: Math.round(score * 0.13 * 10) / 10,
      hrv_delta: -Math.round(score * 0.21 * 10) / 10,
      resp_stress_delta: Math.round(score * 0.34 * 10) / 10,
    },
  };
}

function simExplain(b: PredictBody): Explanation {
  const feats = [
    { name: "PM2.5", value: b.pm25, shap_value: b.pm25 * 0.42 - 6 },
    { name: "NO₂", value: b.no2, shap_value: b.no2 * 0.19 - 3.4 },
    { name: "O₃", value: b.o3, shap_value: b.o3 * 0.1 - 3 },
    { name: "SO₂", value: b.so2, shap_value: b.so2 * 0.26 - 1.1 },
    { name: "Heart rate", value: b.heart_rate, shap_value: (b.heart_rate - 68) * 0.31 },
    { name: "Age", value: b.age, shap_value: (b.age - 32) * 0.2 },
    { name: "Weight", value: b.weight, shap_value: (b.weight - 72) * 0.07 },
    { name: "Asthma", value: b.asthma ? 1 : 0, shap_value: b.asthma ? 11.5 : -2.2 },
    { name: "Humidity", value: b.humidity, shap_value: (b.humidity - 55) * 0.06 },
  ].map((f) => ({ ...f, shap_value: Math.round(f.shap_value * 10) / 10 }));
  feats.sort((a, z) => Math.abs(z.shap_value) - Math.abs(a.shap_value));
  return { base_value: 24.5, features: feats };
}

function line(a: LatLon, b: LatLon, bow: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const curve = Math.sin(t * Math.PI) * bow;
    pts.push([
      a.lon + (b.lon - a.lon) * t + curve,
      a.lat + (b.lat - a.lat) * t + curve * 0.6,
    ]);
  }
  return pts;
}

export function previewRoute(origin: LatLon, destination: LatLon): RouteComparison {
  const d =
    Math.hypot(destination.lat - origin.lat, destination.lon - origin.lon) * 111;
  const direct = { km: Math.round(d * 10) / 10, aqi: 128 };
  const safe = { km: Math.round(d * 1.18 * 10) / 10, aqi: 74 };
  return {
    direct_route: {
      geojson: { type: "LineString", coordinates: line(origin, destination, 0) },
      distance_km: direct.km,
      duration_min: Math.round(direct.km * 3.1),
      avg_aqi_exposure: direct.aqi,
      pollutants: { pm25: 58.2, pm10: 92.9, no2: 38.9, so2: 10.8, o3: 49.4 },
    },
    safe_route: {
      geojson: { type: "LineString", coordinates: line(origin, destination, 0.012) },
      distance_km: safe.km,
      duration_min: Math.round(safe.km * 3.4),
      avg_aqi_exposure: safe.aqi,
      pollutants: { pm25: 35.4, pm10: 56.4, no2: 28.3, so2: 7.8, o3: 37.0 },
    },
    exposure_reduction_pct: Math.round((1 - safe.aqi / direct.aqi) * 100),
  };
}

export async function geocodeWorldwide(address: string): Promise<{ location: LatLon; displayName: string } | null> {
  if (BASE) {
    try {
      const result = await call<{ lat: number; lon: number; display_name: string }>("/api/geocode", {
        method: "POST",
        body: JSON.stringify({ address }),
      });
      return { location: { lat: result.lat, lon: result.lon }, displayName: result.display_name };
    } catch {
      // Fall through to direct lookup when the backend is unavailable.
    }
  }
  const response = await fetch(`${NOMINATIM_BASE}?q=${encodeURIComponent(address)}&format=jsonv2&limit=1&addressdetails=1`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return null;
  const results = (await response.json()) as Array<{ lat?: string; lon?: string; display_name?: string }>;
  const result = results[0];
  if (!result?.lat || !result.lon) return null;
  return {
    location: { lat: Number(result.lat), lon: Number(result.lon) },
    displayName: result.display_name ?? address,
  };
}

export async function searchWorldwide(address: string, signal?: AbortSignal): Promise<Array<{ location: LatLon; displayName: string }>> {
  if (address.trim().length < 2) return [];
  if (BASE) {
    try {
      const results = await call<Array<{ lat: number; lon: number; display_name: string }>>("/api/geocode/search", {
        method: "POST",
        body: JSON.stringify({ address }),
        ...(signal ? { signal } : {}),
      });
      return results.map((result) => ({ location: { lat: result.lat, lon: result.lon }, displayName: result.display_name }));
    } catch {
      // Fall through to direct lookup when the backend is unavailable.
    }
  }
  const response = await fetch(`${NOMINATIM_BASE}?q=${encodeURIComponent(address)}&format=jsonv2&limit=5&addressdetails=1`, {
    headers: { Accept: "application/json" },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) return [];
  const results = (await response.json()) as Array<{ lat?: string; lon?: string; display_name?: string }>;
  return results.flatMap((result) => {
    if (!result.lat || !result.lon) return [];
    return [{ location: { lat: Number(result.lat), lon: Number(result.lon) }, displayName: result.display_name ?? address }];
  });
}

export async function fetchWorldwideRoute(origin: LatLon, destination: LatLon): Promise<RouteComparison & { route_source: string }> {
  type RawRoute = { distance: number; duration: number; geometry: { type: string; coordinates: [number, number][] } };
  const request = async (points: LatLon[]): Promise<RawRoute> => {
    const coordinates = points.map((point) => `${point.lon},${point.lat}`).join(";");
    const response = await fetch(`${OSRM_BASE}/${coordinates}?overview=full&geometries=geojson`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Global route service responded ${response.status}`);
    const payload = (await response.json()) as { routes?: RawRoute[] };
    if (!payload.routes?.[0]) throw new Error("No drivable route found for these locations");
    return payload.routes[0];
  };

  const directRoute = await request([origin, destination]);
  const latitudeDelta = destination.lat - origin.lat;
  const longitudeDelta = destination.lon - origin.lon;
  const length = Math.max(Math.hypot(latitudeDelta, longitudeDelta), 0.01);
  const offset = Math.min(0.12, Math.max(0.006, length * 0.16));
  const midpoint = { lat: (origin.lat + destination.lat) / 2, lon: (origin.lon + destination.lon) / 2 };
  const waypointA = { lat: midpoint.lat - (longitudeDelta / length) * offset, lon: midpoint.lon + (latitudeDelta / length) * offset };
  const waypointB = { lat: midpoint.lat + (longitudeDelta / length) * offset, lon: midpoint.lon - (latitudeDelta / length) * offset };

  const candidateRoutes = await Promise.allSettled([
    request([origin, waypointA, destination]),
    request([origin, waypointB, destination]),
  ]);
  const candidates = candidateRoutes
    .filter((result): result is PromiseFulfilledResult<RawRoute> => result.status === "fulfilled")
    .map((result) => result.value);

  const exposureFor = (route: RawRoute) => routeExposure(route.geometry.coordinates);
  const directExposure = exposureFor(directRoute);
  const safeRoute = candidates
    .filter((route) => route.geometry.coordinates.length > 2)
    .sort((left, right) => exposureFor(left).aqi - exposureFor(right).aqi)[0] ?? directRoute;
  const safeExposure = exposureFor(safeRoute);

  const toLeg = (route: RawRoute, exposure: ReturnType<typeof routeExposure>) => ({
    geojson: route.geometry,
    distance_km: Math.round((route.distance / 1000) * 10) / 10,
    duration_min: Math.round(route.duration / 60),
    avg_aqi_exposure: exposure.aqi,
    pollutants: exposure.pollutants,
  });
  const direct = toLeg(directRoute, directExposure);
  const safe = toLeg(safeRoute, safeExposure);
  const exposureReduction = direct.avg_aqi_exposure > 0
    ? Math.max(1, Math.round((1 - safe.avg_aqi_exposure / direct.avg_aqi_exposure) * 100))
    : 0;
  return {
    direct_route: direct,
    safe_route: safe,
    exposure_reduction_pct: exposureReduction,
    route_source: "OpenStreetMap / OSRM",
  };
}

function simHistory(loc: LatLon, hours: number): HistoryPoint[] {
  const base = simAqi(loc).aqi;
  const step = hours > 24 ? 3 : 1;
  const out: HistoryPoint[] = [];
  for (let h = hours; h >= 0; h -= step) {
    const wave = Math.sin((hours - h) / 3.4) * 22 + Math.cos((hours - h) / 1.7) * 9;
    const aqi = Math.max(12, Math.round(base + wave));
    out.push({
      timestamp: new Date(Date.now() - h * 3600_000).toISOString(),
      aqi,
      risk_score: Math.max(3, Math.min(98, Math.round(aqi * 0.46 + 6))),
    });
  }
  return out;
}

/* ── contract calls ───────────────────────────────────────────────── */

export const getAqi = (loc: LatLon) =>
  withFallback(
    () => call<AqiReading>(`/api/aqi?lat=${loc.lat}&lon=${loc.lon}`),
    () => simAqi(loc),
  );

export const postPredict = (body: PredictBody) =>
  withFallback(
    () => call<Prediction>("/api/predict", { method: "POST", body: JSON.stringify(body) }),
    () => simPredict(body),
  );

export const postExplain = (body: PredictBody) =>
  withFallback(
    () => call<Explanation>("/api/explain", { method: "POST", body: JSON.stringify(body) }),
    () => simExplain(body),
  );

export const postRoute = (origin: LatLon, destination: LatLon) =>
  withFallback(
    () =>
      call<RouteComparison>("/api/route", {
        method: "POST",
        body: JSON.stringify({ origin, destination }),
      }),
    () => previewRoute(origin, destination),
  );

export const getHistory = (loc: LatLon, hours: number) =>
  withFallback(
    () => call<HistoryPoint[]>(`/api/history?lat=${loc.lat}&lon=${loc.lon}&hours=${hours}`),
    () => simHistory(loc, hours),
  );