import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import { BootSequence } from "@/components/aero/BootSequence";
import { ForecastPanel } from "@/components/aero/ForecastPanel";
import { ImpactPanel } from "@/components/aero/ImpactPanel";
import { LiveBackground } from "@/components/aero/LiveBackground";
import { MapPanel } from "@/components/aero/MapPanel";
import { Panel, PanelHead } from "@/components/aero/primitives";
import { RiskGauge } from "@/components/aero/RiskGauge";
import { ShapPanel } from "@/components/aero/ShapPanel";
import { TelemetryStrip } from "@/components/aero/TelemetryStrip";
import { TopNav } from "@/components/aero/TopNav";
import { getAqi, getHistory, postExplain, postPredict } from "@/lib/aero/api";
import { deriveRouteInsight, deriveRouteReading, legPredictBody, withModelScores } from "@/lib/aero/route-metrics";
import { DEFAULT_SPEED_KMH } from "@/lib/aero/exposure-profile";
import type { LatLon, PredictBody, RouteComparison, Vitals } from "@/lib/aero/types";
import { writeLiveContext } from "@/lib/aero/live-context";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AeroHealth " },
      {
        name: "description",
        content:
          "A live personal air-quality risk instrument: health risk score, predicted heart-rate and HRV impact, explainable drivers and low-exposure routing.",
      },
      { property: "og:title", content: "AeroHealth — Your air, your risk, right now" },
      {
        property: "og:description",
        content:
          "Live pollutant telemetry, a personal health risk score, explainable model drivers and cleaner routes.",
      },
    ],
  }),
  component: Index,
});

/** Debounce a value so slider drags don't hammer /api/predict or /api/explain. */
function useDebounced<T>(value: T, ms = 320) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function Index() {
  const [booting, setBooting] = useState(true);
  const [dark, setDark] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [place, setPlace] = useState("Mangaluru · IN");
  const [loc, setLoc] = useState<LatLon>({ lat: 12.841690, lon: 74.922980 });
  const [range, setRange] = useState<24 | 168>(24);
  const [routes, setRoutes] = useState<RouteComparison | undefined>();
  const [speedKmh, setSpeedKmh] = useState(DEFAULT_SPEED_KMH);
  const [vitals, setVitals] = useState<Vitals>({
    heart_rate: 72,
    age: 34,
    weight: 74,
    asthma: false,
    hypertension: false,
    spo2: 97,
    height: 170,
    activity: "resting",
    mask: "none",
  });
  const debouncedVitals = useDebounced(vitals);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const aqiQ = useQuery({
    queryKey: ["aqi", loc.lat, loc.lon],
    queryFn: () => getAqi(loc),
    refetchInterval: 120_000,
  });
  const historyQ = useQuery({
    queryKey: ["history", loc.lat, loc.lon, range],
    queryFn: () => getHistory(loc, range),
  });

  const reading = aqiQ.data?.data;
  const body: PredictBody | undefined = useMemo(
    () =>
      reading
        ? {
            pm25: reading.pm25,
            no2: reading.no2,
            o3: reading.o3,
            so2: reading.so2,
            temperature: reading.temperature,
            humidity: reading.humidity,
            ...debouncedVitals,
          }
        : undefined,
    [reading, debouncedVitals],
  );

  const predictQ = useQuery({
    queryKey: ["predict", body],
    queryFn: () => postPredict(body!),
    enabled: !!body,
  });
  const explainQ = useQuery({
    queryKey: ["explain", body],
    queryFn: () => postExplain(body!),
    enabled: !!body,
  });

  const prediction = predictQ.data?.data;
  // Route risk is scored by the same model as the dashboard, using each route's
  // own pollutants plus the full personal profile (SpO2, hypertension, mask, ...).
  const baseRouteInsight = useMemo(
    () => (routes ? deriveRouteInsight(routes, debouncedVitals, reading) : undefined),
    [routes, debouncedVitals, reading],
  );
  const safeBody = useMemo(
    () => (routes ? legPredictBody(routes.safe_route, debouncedVitals, reading) : undefined),
    [routes, debouncedVitals, reading],
  );
  const directBody = useMemo(
    () => (routes ? legPredictBody(routes.direct_route, debouncedVitals, reading) : undefined),
    [routes, debouncedVitals, reading],
  );
  const safeRouteQ = useQuery({
    queryKey: ["route-predict", "safe", safeBody],
    queryFn: () => postPredict(safeBody!),
    enabled: !!safeBody,
    placeholderData: keepPreviousData,
  });
  const directRouteQ = useQuery({
    queryKey: ["route-predict", "direct", directBody],
    queryFn: () => postPredict(directBody!),
    enabled: !!directBody,
    placeholderData: keepPreviousData,
  });
  const activeRouteInsight = useMemo(
    () =>
      baseRouteInsight
        ? withModelScores(baseRouteInsight, safeRouteQ.data?.data, directRouteQ.data?.data)
        : undefined,
    [baseRouteInsight, safeRouteQ.data, directRouteQ.data],
  );
  const activeTelemetryReading = useMemo(
    () => (reading ? deriveRouteReading(reading, activeRouteInsight) : undefined),
    [reading, activeRouteInsight],
  );
  const activeRiskScore = activeRouteInsight?.safe_route_risk_score ?? prediction?.risk_score ?? 0;
  const activeRiskLabel = activeRouteInsight?.safe_route_risk_label ?? prediction?.risk_label ?? "Low";
  const simulated =
    aqiQ.data?.simulated || predictQ.data?.simulated || historyQ.data?.simulated;

  useEffect(() => {
    const liveUpdate: Parameters<typeof writeLiveContext>[0] = {
      location: place,
      location_coords: loc,
      vitals,
      speed_kmh: speedKmh,
    };
    if (reading) liveUpdate.aqi_data = reading;
    if (prediction) liveUpdate.risk_data = prediction;
    if (explainQ.data?.data) liveUpdate.shap_data = explainQ.data.data;
    if (activeRouteInsight) liveUpdate.route_data = activeRouteInsight;
    writeLiveContext(liveUpdate);
  }, [place, loc, vitals, speedKmh, reading, prediction, explainQ.data, activeRouteInsight]);

  const onPlace = useCallback((name: string, next: LatLon) => {
    setPlace(name);
    setLoc(next);
  }, []);

  return (
    <div className="min-h-screen">
      <LiveBackground paused={modalOpen || booting} />
      {booting ? <BootSequence onDone={() => setBooting(false)} /> : null}

      <TopNav
        place={place}
        onPlace={onPlace}
        dark={dark}
        onTheme={setDark}
        onOpenChange={setModalOpen}
      />

      <main className="mx-auto w-full max-w-[1500px] space-y-3 px-5 pt-5 pb-16">
        <h1 className="sr-only">AeroHealth — personal air quality health risk</h1>

        <div className="grid gap-3 xl:grid-cols-[1fr_340px]">
          <Panel className="flex items-center justify-center" delay={0.08} raise={false}>
            <RiskGauge
              score={activeRiskScore}
              label={activeRiskLabel}
              loading={predictQ.isPending || aqiQ.isPending}
              station={
                activeRouteInsight
                  ? `safe route · AQI ${activeRouteInsight.safe_route_aqi} · direct AQI ${activeRouteInsight.direct_route_aqi}`
                  : reading
                    ? `station ${reading.station} · ${new Date(reading.timestamp)
                        .toISOString()
                        .slice(11, 16)} utc`
                    : undefined
              }
            />
          </Panel>

          <div className="space-y-3">
            <Panel className="p-3" delay={0.12} raise={false}>
              <TelemetryStrip
                reading={activeTelemetryReading}
                history={historyQ.data?.data ?? []}
                loading={aqiQ.isPending}
                routeInsight={activeRouteInsight}
              />
            </Panel>
            {simulated ? (
              <Panel className="px-4 py-3" delay={0.14} raise={false}>
                <PanelHead
                  label="signal source"
                  hint="live API unreachable · local simulation"
                />
              </Panel>
            ) : null}
          </div>
        </div>

        <ForecastPanel loc={loc} />

        <div className="grid gap-3 lg:grid-cols-[3fr_2fr]">
          <MapPanel
            loc={loc}
            aqi={reading?.aqi ?? 0}
            place={place}
            loading={aqiQ.isPending}
            vitals={vitals}
            speedKmh={speedKmh}
            onSpeedChange={setSpeedKmh}
            insight={activeRouteInsight}
            weather={reading ? { temperature: reading.temperature, humidity: reading.humidity } : undefined}
            onRoutesChange={setRoutes}
          />
          <ImpactPanel
            prediction={prediction}
            loading={predictQ.isPending}
            vitals={vitals}
            onVitals={setVitals}
          />
        </div>

        <ShapPanel explanation={explainQ.data?.data} loading={explainQ.isPending} />
      </main>
    </div>
  );
}
