export type AqiReading = {
  aqi: number;
  pm25: number;
  pm10: number;
  no2: number;
  o3: number;
  so2: number;
  temperature: number;
  humidity: number;
  station: string;
  timestamp: string;
};

export type RiskLabel = "Low" | "Moderate" | "High" | "Severe";

export type Prediction = {
  risk_score: number;
  risk_label: RiskLabel;
  predicted_impacts: {
    heart_rate_delta: number;
    hrv_delta: number;
    resp_stress_delta: number;
  };
};

export type Explanation = {
  base_value: number;
  features: { name: string; value: number; shap_value: number }[];
};

export type RouteLeg = {
  geojson: { type: string; coordinates: [number, number][] } | Record<string, unknown>;
  distance_km: number;
  duration_min: number;
  avg_aqi_exposure: number;
  pollutants?: {
    pm25: number;
    pm10: number;
    no2: number;
    so2: number;
    o3: number;
  };
};

export type RouteComparison = {
  safe_route: RouteLeg;
  direct_route: RouteLeg;
  exposure_reduction_pct: number;
};

export type RouteInsight = RouteComparison & {
  safe_route_aqi: number;
  direct_route_aqi: number;
  safe_route_risk_score: number;
  safe_route_risk_label: RiskLabel;
};

export type HistoryPoint = { timestamp: string; aqi: number; risk_score: number };

export type Vitals = {
  heart_rate: number;
  age: number;
  weight: number;
  asthma: boolean;
};

export type PredictBody = Vitals & {
  pm25: number;
  no2: number;
  o3: number;
  so2: number;
  temperature: number;
  humidity: number;
};

export type LatLon = { lat: number; lon: number };