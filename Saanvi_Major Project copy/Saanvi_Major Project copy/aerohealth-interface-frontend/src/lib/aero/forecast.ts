import type { LatLon } from "./types";

export type ForecastPoint = {
  hours_ahead: number;
  time: string; // ISO UTC
  pm25: number;
  lower: number;
  upper: number;
  aqi: number;
};

export type HorizonEvaluation = {
  mae: number;
  rmse: number;
  r2: number;
  persistence_mae: number;
  seasonal_naive_mae: number | null;
  skill_vs_persistence_pct: number | null;
  skill_vs_seasonal_pct?: number | null;
  /** Skill against whichever baseline was harder to beat. */
  skill_vs_best_baseline_pct?: number | null;
  /** Rolling cross-validation: number of test windows, and how many the forecast won. */
  folds?: number;
  folds_beating_best_baseline?: number;
  fold_skill_mean_pct?: number | null;
  fold_skill_std_pct?: number | null;
  test_points: number;
};

export type Forecast = {
  station: string;
  sensor_id: number;
  generated_at: string;
  last_observed: { time: string; pm25: number };
  forecast: ForecastPoint[];
  history: { time: string; pm25: number }[];
  summary: { best: ForecastPoint; worst: ForecastPoint };
  drivers: { factor: string; share_pct: number }[];
  /** Spatial inputs actually used for this station. */
  spatial?: { neighbour_stations: string[]; regional_model: string | null };
  evaluation: {
    method: string;
    baselines: string[];
    observed_hours: number;
    coverage_pct: number;
    history_days: number;
    horizons: Record<string, HorizonEvaluation>;
  };
  data_sources: string[];
  model: string;
};

const BASE = (import.meta.env["VITE_API_URL"] ?? "").replace(/\/$/, "");

/**
 * Real data or nothing: unlike the other panels there is no simulated fallback, because a
 * made-up forecast would be indistinguishable from a real one. Errors carry the server's reason.
 */
export async function getForecast(loc: LatLon): Promise<Forecast> {
  if (!BASE) {
    throw new Error(
      "The app cannot find the AeroHealth API (VITE_API_URL is not set). Start the backend, then start the frontend with VITE_API_URL=http://127.0.0.1:8000.",
    );
  }
  let res: Response;
  try {
    // The first call downloads history and trains the models (20 to 40 s), so allow a long wait.
    res = await fetch(`${BASE}/api/forecast?lat=${loc.lat}&lon=${loc.lon}`, {
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new Error(
      "The AeroHealth API is not answering. Check that the backend is running (uvicorn on port 8000) and that VITE_API_URL points to it.",
    );
  }
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { detail?: string }).detail ?? "";
    } catch {
      /* keep the generic message */
    }
    throw new Error(explainForecastFailure(res.status, detail));
  }
  return (await res.json()) as Forecast;
}

/** Plain-language cause and fix for the failures people actually hit. */
function explainForecastFailure(status: number, detail: string): string {
  if (/OPENAQ_API_KEY is not configured/i.test(detail)) {
    return "The API has no OpenAQ key. Copy .env.example to .env in the aerohealth-api folder, add the key, and restart the API.";
  }
  if (/401|403|unauthorized|forbidden/i.test(detail)) {
    return "OpenAQ rejected the API key. Check OPENAQ_API_KEY in aerohealth-api/.env, then restart the API.";
  }
  if (status === 429) {
    return "Too many forecast requests in a short time. Wait a minute and try again.";
  }
  if (status === 404) {
    return "This backend is an older version without the forecast feature. Update the backend files and restart it.";
  }
  if (status === 502 || /rate-limit|upstream|connect|timed out|timeout/i.test(detail)) {
    return "The data services (OpenAQ, Open-Meteo) could not be reached from this network, or are rate-limiting it. Try again in a minute, or use Check connection.";
  }
  if (/No monitoring station/i.test(detail)) {
    return "There is no live air-quality station near this location, so no forecast can be made here.";
  }
  return detail || `The forecast service answered with an error (${status}).`;
}
