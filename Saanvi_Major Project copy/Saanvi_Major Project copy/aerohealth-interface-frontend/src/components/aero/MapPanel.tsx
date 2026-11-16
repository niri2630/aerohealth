import { AnimatePresence, motion } from "motion/react";
import { ClientOnly } from "@tanstack/react-router";
import { CheckCircle2, Navigation, Route as RouteIcon, ShieldCheck, Wind } from "lucide-react";
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";

import { CalmState, CountUp, Panel, PanelHead, Shimmer } from "./primitives";
import { EASE } from "@/lib/aero/ui";
import type { LatLon, RouteComparison, RouteInsight, Vitals } from "@/lib/aero/types";
import {
  fetchWorldwideRoute,
  geocodeWorldwide,
  previewRoute,
  searchWorldwide,
  type PlaceMatch,
} from "@/lib/aero/api";
import { routesCoincide } from "@/lib/aero/route-metrics";
import { ConnectionCheck } from "./ConnectionCheck";
import { AskAIButton } from "./AskAIButton";
import { Tooltip, TooltipContent } from "./Tooltip";
import { DEFAULT_SPEED_KMH, SPEED_PRESETS, personaliseRoutes } from "@/lib/aero/exposure-profile";
import { logTrip } from "@/lib/aero/trips";

const MapCanvas = lazy(() => import("./MapCanvas"));
const API_BASE = (import.meta.env["VITE_API_URL"] ?? "").replace(/\/$/, "");

/** A problem the person can act on (unknown place, same start and end), shown as a message. */
class RouteProblem extends Error {}

export function MapPanel({
  loc,
  aqi,
  place,
  loading,
  vitals,
  speedKmh,
  onSpeedChange,
  insight,
  weather,
  onRoutesChange,
}: {
  loc: LatLon;
  aqi: number;
  place: string;
  loading?: boolean;
  vitals: Vitals;
  /** Traveller's own speed in km/h (8 = a runner, 50 = a car). */
  speedKmh: number;
  onSpeedChange: (kmh: number) => void;
  /** Route insight scored by the risk model for the current profile. */
  insight?: RouteInsight | undefined;
  weather?: { temperature: number; humidity: number } | undefined;
  onRoutesChange?: (routes?: RouteComparison) => void;
}) {
  // Raw route as fetched; times and inhaled dose are re-derived from the user's
  // speed, breathing rate and mask, so changing them updates the plan instantly.
  const [rawRoutes, setRawRoutes] = useState<RouteComparison | undefined>();
  const routes = useMemo(
    () => (rawRoutes ? personaliseRoutes(rawRoutes, speedKmh, vitals.activity, vitals.mask) : undefined),
    [rawRoutes, speedKmh, vitals.activity, vitals.mask],
  );
  const [speedText, setSpeedText] = useState(String(speedKmh));
  const [loggedTrip, setLoggedTrip] = useState<"safe" | "direct" | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [showInputs, setShowInputs] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeNote, setRouteNote] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadMessage, setDownloadMessage] = useState("");
  const [downloadRemaining, setDownloadRemaining] = useState(0);
  
  // Address inputs (user-friendly)
  const [originAddress, setOriginAddress] = useState("");
  const [destinationAddress, setDestinationAddress] = useState("");
  const [routeLabels, setRouteLabels] = useState<{ origin: string; destination: string } | undefined>();
  const [originSuggestions, setOriginSuggestions] = useState<PlaceMatch[]>([]);
  const [destinationSuggestions, setDestinationSuggestions] = useState<PlaceMatch[]>([]);
  const suggestionRequest = useRef<AbortController | null>(null);
  const suggestionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // The selected dashboard location is the origin until the user enters one.
  const [origin, setOrigin] = useState<LatLon>(loc);
  const [destination, setDestination] = useState<LatLon>(loc);
  const routeInsight = insight;

  useEffect(() => {
    onRoutesChange?.(routes);
  }, [routes, onRoutesChange]);

  useEffect(() => {
    setSpeedText(String(speedKmh));
  }, [speedKmh]);

  function commitSpeed(text: string) {
    const value = Number(text);
    if (!Number.isFinite(value) || value <= 0) {
      setSpeedText(String(speedKmh));
      return;
    }
    const clamped = Math.min(150, Math.max(1, Math.round(value * 10) / 10));
    onSpeedChange(clamped);
    setSpeedText(String(clamped));
  }

  function recordTrip(taken: "safe" | "direct") {
    if (!routes) return;
    logTrip({
      routes,
      routeTaken: taken,
      origin: routeLabels?.origin ?? place,
      destination: routeLabels?.destination ?? "selected destination",
      speedKmh,
      vitals,
      weather: weather ?? { temperature: 25, humidity: 60 },
    });
    setLoggedTrip(taken);
  }

  useEffect(() => {
    if (!originAddress.trim()) setOrigin(loc);
    if (!destinationAddress.trim()) setDestination(loc);
  }, [loc, originAddress, destinationAddress]);

  function buildGeocodeCandidates(address: string) {
    const trimmed = address.trim();
    const candidates = [trimmed];

    const aliasMap: Record<string, string> = {
      Vittla: "Vitla",
      Kulsheker: "Kulshekar",
      Kulshekeri: "Kulshekar",
    };

    for (const [from, to] of Object.entries(aliasMap)) {
      if (new RegExp(`\\b${from}\\b`, "i").test(trimmed)) {
        candidates.push(trimmed.replace(new RegExp(`\\b${from}\\b`, "ig"), to));
      }
    }

    const isLocalQuery = /adyar|bejai|kapu|udupi|vitla|vittla|kulshekar|kulsheker|mangaluru|mangalore|surathkal|panambur|moodbidri|moodabidri/i.test(trimmed);
    if (isLocalQuery && !/india|karnataka|udupi|dakshina|mangaluru|mangalore/i.test(trimmed)) {
      candidates.push(`${trimmed}, Karnataka, India`);
    }
    return candidates;
  }

  async function geocodeAddress(address: string): Promise<PlaceMatch | null> {
    try {
      const worldwide = await geocodeWorldwide(address);
      if (worldwide) return worldwide;

      if (!API_BASE) return null;
      for (const candidate of buildGeocodeCandidates(address)) {
        const res = await fetch(`${API_BASE}/api/geocode`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: candidate }),
          signal: AbortSignal.timeout(12000),
        });
        if (!res.ok) continue;
        const data = await res.json();
        if (typeof data.lat === "number" && typeof data.lon === "number") {
          return {
            location: { lat: data.lat, lon: data.lon },
            displayName: candidate,
            offline: data.source === "offline",
          };
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  async function updateSuggestions(value: string, target: "origin" | "destination") {
    if (suggestionTimer.current) clearTimeout(suggestionTimer.current);
    suggestionRequest.current?.abort();
    if (value.trim().length < 2) {
      if (target === "origin") setOriginSuggestions([]);
      else setDestinationSuggestions([]);
      return;
    }
    suggestionTimer.current = setTimeout(() => {
      const controller = new AbortController();
      suggestionRequest.current = controller;
      void searchWorldwide(value, controller.signal)
        .then((results) => {
          if (target === "origin") setOriginSuggestions(results);
          else setDestinationSuggestions(results);
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          if (target === "origin") setOriginSuggestions([]);
          else setDestinationSuggestions([]);
        });
    }, 250);
  }

  function chooseSuggestion(target: "origin" | "destination", suggestion: { location: LatLon; displayName: string }) {
    if (target === "origin") {
      setOriginAddress(suggestion.displayName);
      setOrigin(suggestion.location);
      setOriginSuggestions([]);
    } else {
      setDestinationAddress(suggestion.displayName);
      setDestination(suggestion.location);
      setDestinationSuggestions([]);
    }
  }

  async function findRoute() {
    setPending(true);
    setFailed(false);
    setRawRoutes(undefined);
    setRouteLabels(undefined);
    setLoggedTrip(null);
    setDownloading(false);
    setRouteError(null);
    setRouteNote(null);

    // Known only once both places are resolved; used for the last-resort estimate below.
    let endpoints: { from: LatLon; to: LatLon } | null = null;
    try {
      let finalOrigin = originAddress.trim() ? origin : loc;
      let finalDestination = destinationAddress.trim() ? destination : loc;
      let usedOfflineList = false;

      if (originAddress.trim()) {
        const found = await geocodeAddress(originAddress);
        if (!found) {
          throw new RouteProblem(
            `Could not find "${originAddress.trim()}". Pick a place from the suggestion list, or type coordinates such as 12.8417, 74.9230.`,
          );
        }
        finalOrigin = found.location;
        setOrigin(found.location);
        if (found.offline) usedOfflineList = true;
      }

      if (destinationAddress.trim()) {
        const found = await geocodeAddress(destinationAddress);
        if (!found) {
          throw new RouteProblem(
            `Could not find "${destinationAddress.trim()}". Pick a place from the suggestion list, or type coordinates such as 12.8417, 74.9230.`,
          );
        }
        finalDestination = found.location;
        setDestination(found.location);
        if (found.offline) usedOfflineList = true;
      }

      if (
        Math.abs(finalOrigin.lat - finalDestination.lat) < 0.00001 &&
        Math.abs(finalOrigin.lon - finalDestination.lon) < 0.00001
      ) {
        throw new RouteProblem("Choose a destination different from the current location.");
      }
      endpoints = { from: finalOrigin, to: finalDestination };

      const requestBackendRoute = async () => {
        if (!API_BASE) throw new Error("Backend route service is not configured");
        const res = await fetch(`${API_BASE}/api/route`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            origin: finalOrigin,
            destination: finalDestination,
            speed_kmh: speedKmh,
            activity: vitals.activity,
            mask: vitals.mask,
          }),
          signal: AbortSignal.timeout(25000),
        });
        if (!res.ok) throw new Error(`${res.status}`);
        return await res.json();
      };

      setRouteLabels({
        origin: originAddress.trim() || place,
        destination: destinationAddress.trim() || "selected destination",
      });

      // 1) the online road router; 2) the local API (online router, then the offline road graph,
      // then a simulated curve). Both are bounded by timeouts so a blocked network cannot hang this.
      let data: RouteComparison & { route_source?: string; simulated?: boolean };
      try {
        data = await fetchWorldwideRoute(finalOrigin, finalDestination, {
          speedKmh,
          activity: vitals.activity,
          mask: vitals.mask,
        });
      } catch (worldwideError) {
        console.warn("Online road routing failed; trying the local API", worldwideError);
        data = await requestBackendRoute();
      }
      if (!data.safe_route || !data.direct_route) throw new Error("Route service returned an invalid route");

      setRawRoutes(data);
      setDownloading(false);

      const notes: string[] = [];
      if (data.simulated) {
        notes.push(
          "Simulated route: the online road routing could not be reached, so this curve only illustrates the idea. Distance, time and pollution are not real road values.",
        );
      } else if (data.route_source && /offline road graph/i.test(data.route_source)) {
        notes.push(
          "Online road routing was unreachable, so this route follows the offline road graph, which covers only the campus area. Pollution values are simulated.",
        );
      }
      if (usedOfflineList) {
        notes.push("A place was matched in the offline place list because the online place search was unreachable.");
      }
      setRouteNote(notes.length ? notes.join(" ") : null);
    } catch (e) {
      console.error("Route failed:", e);
      if (e instanceof RouteProblem) {
        // Say what is wrong. Never draw an old line as if it were the answer.
        setRouteError(e.message);
      } else if (endpoints) {
        // Both places are known but no routing service answered (online router blocked and the local
        // API not running): a clearly labelled straight-line estimate is better than an empty map.
        setRawRoutes(previewRoute(endpoints.from, endpoints.to));
        setRouteNote(
          "Straight-line estimate only: no routing service could be reached (the online router is blocked or offline, and the AeroHealth API on this computer is not answering). Distance and pollution are illustrative, not real road values.",
        );
      } else {
        setRouteError("Something went wrong while looking up the places. Check your connection and try again.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel className="relative min-h-[560px]" delay={0.16} raise={false}>
      <PanelHead
        label="exposure map"
        hint={`${origin.lat.toFixed(4)} / ${origin.lon.toFixed(4)} → ${destination.lat.toFixed(4)} / ${destination.lon.toFixed(4)}`}
        right={
          <div className="flex items-center gap-2">
            {routes && (
              <AskAIButton
                variant="subtle"
                label="Compare routes"
                prompt={`I have two routes: Safe route is ${routes.safe_route.distance_km.toFixed(1)}km with AQI ${Math.round(routes.safe_route.avg_aqi_exposure)}, Direct route is ${routes.direct_route.distance_km.toFixed(1)}km with AQI ${Math.round(routes.direct_route.avg_aqi_exposure)}. Should I take the safe route? What's the health impact difference?`}
                context={routes}
              />
            )}
            <button
              onClick={() => setShowInputs(!showInputs)}
              className="press flex items-center gap-2 rounded-xl border border-primary/35 bg-primary/12 px-3 py-1.5 text-primary transition-colors hover:bg-primary/20"
            >
              <span className="num text-[10px] tracking-[0.14em] uppercase">
                {showInputs ? "hide coords" : "edit coords"}
              </span>
            </button>
            <button
              onClick={findRoute}
              disabled={pending}
              className="press flex items-center gap-2 rounded-xl border border-primary/35 bg-primary/12 px-3 py-1.5 text-primary transition-colors hover:bg-primary/20 disabled:opacity-60"
            >
              <Navigation size={12} strokeWidth={1.6} />
              <span className="num text-[10px] tracking-[0.14em] uppercase">
                {pending ? "routing" : "find safe route"}
              </span>
            </button>
          </div>
        }
      />

      <div className="mx-3 mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-hairline bg-surface-2 px-3 py-2.5">
        <label htmlFor="travel-speed" className="label-glyph">travel speed</label>
        <div className="flex items-center gap-1.5">
          <input
            id="travel-speed"
            type="number"
            inputMode="decimal"
            min={1}
            max={150}
            step={0.5}
            value={speedText}
            onChange={(e) => setSpeedText(e.target.value)}
            onBlur={(e) => commitSpeed(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") commitSpeed(e.currentTarget.value); }}
            className="num w-16 rounded border border-hairline bg-background px-2 py-1 text-right text-xs"
          />
          <span className="num text-[10px] text-muted-foreground">km/h</span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {SPEED_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => onSpeedChange(preset.kmh)}
              className={`press rounded-lg border px-2 py-1 text-[10px] transition-colors ${
                Math.abs(speedKmh - preset.kmh) < 0.05
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-hairline text-muted-foreground hover:text-foreground"
              }`}
            >
              {preset.label} {preset.kmh}
            </button>
          ))}
        </div>
        <span className="num ml-auto text-[9px] text-muted-foreground">
          times &amp; inhaled dose use your speed{speedKmh === DEFAULT_SPEED_KMH ? " (default: runner)" : ""}
        </span>
      </div>

      {routeError || routeNote ? (
        <div
          role={routeError ? "alert" : "status"}
          className={`mx-3 mb-3 rounded-xl border px-3 py-2.5 text-[11px] ${
            routeError
              ? "border-amber-500/40 bg-amber-500/10 text-amber-100"
              : "border-hairline bg-surface-2 text-muted-foreground"
          }`}
        >
          <p>{routeError ?? routeNote}</p>
          <ConnectionCheck className="mt-2" />
        </div>
      ) : null}

      {showInputs && (
        <div className="mx-3 mb-3 space-y-3 rounded-xl border border-hairline bg-surface-2 p-3">
          <div className="space-y-2">
            <div>
              <label className="label-glyph mb-1 block">Origin (address or coordinates)</label>
              <div className="relative">
                <input
                  type="text"
                  value={originAddress}
                  onChange={(e) => { setOriginAddress(e.target.value); void updateSuggestions(e.target.value, "origin"); }}
                  placeholder="Search origin worldwide, e.g. Times Square, New York"
                  className="w-full rounded border border-hairline bg-background px-2 py-1.5 text-xs"
                />
                {originSuggestions.length ? <div className="absolute top-full right-0 left-0 z-[1000] mt-1 overflow-hidden rounded-lg border border-hairline bg-background shadow-xl">{originSuggestions.map((suggestion, index) => <button key={`${index}-${suggestion.location.lat}-${suggestion.location.lon}`} type="button" onClick={() => chooseSuggestion("origin", suggestion)} className="block w-full border-b border-hairline px-3 py-2 text-left text-[11px] last:border-0 hover:bg-primary/10">{suggestion.displayName}{suggestion.offline ? <span className="num ml-2 text-[9px] text-muted-foreground">(offline list)</span> : null}</button>)}</div> : null}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                step="0.000001"
                value={origin.lat}
                onChange={(e) => setOrigin({ ...origin, lat: parseFloat(e.target.value) || 0 })}
                placeholder="Latitude"
                className="w-full rounded border border-hairline bg-background px-2 py-1 text-xs num"
              />
              <input
                type="number"
                step="0.000001"
                value={origin.lon}
                onChange={(e) => setOrigin({ ...origin, lon: parseFloat(e.target.value) || 0 })}
                placeholder="Longitude"
                className="w-full rounded border border-hairline bg-background px-2 py-1 text-xs num"
              />
            </div>
          </div>
          
          <div className="space-y-2">
            <div>
              <label className="label-glyph mb-1 block">Destination (address or coordinates)</label>
              <div className="relative">
                <input
                  type="text"
                  value={destinationAddress}
                  onChange={(e) => { setDestinationAddress(e.target.value); void updateSuggestions(e.target.value, "destination"); }}
                  placeholder="Search destination worldwide, e.g. Baker Street, London"
                  className="w-full rounded border border-hairline bg-background px-2 py-1.5 text-xs"
                />
                {destinationSuggestions.length ? <div className="absolute top-full right-0 left-0 z-[1000] mt-1 overflow-hidden rounded-lg border border-hairline bg-background shadow-xl">{destinationSuggestions.map((suggestion, index) => <button key={`${index}-${suggestion.location.lat}-${suggestion.location.lon}`} type="button" onClick={() => chooseSuggestion("destination", suggestion)} className="block w-full border-b border-hairline px-3 py-2 text-left text-[11px] last:border-0 hover:bg-primary/10">{suggestion.displayName}{suggestion.offline ? <span className="num ml-2 text-[9px] text-muted-foreground">(offline list)</span> : null}</button>)}</div> : null}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                step="0.000001"
                value={destination.lat}
                onChange={(e) => setDestination({ ...destination, lat: parseFloat(e.target.value) || 0 })}
                placeholder="Latitude"
                className="w-full rounded border border-hairline bg-background px-2 py-1 text-xs num"
              />
              <input
                type="number"
                step="0.000001"
                value={destination.lon}
                onChange={(e) => setDestination({ ...destination, lon: parseFloat(e.target.value) || 0 })}
                placeholder="Longitude"
                className="w-full rounded border border-hairline bg-background px-2 py-1 text-xs num"
              />
            </div>
          </div>
          
          <div className="text-[10px] text-muted-foreground num">
            💡 Tip: Enter addresses like "Central Park, NYC" or use coordinates. First-time routing in a new city takes 1-2 minutes to download road network.
          </div>
        </div>
      )}

      <div className="relative h-[480px] overflow-hidden">
        {loading ? (
          <Shimmer className="absolute inset-3 rounded-2xl" />
        ) : (
          <ClientOnly fallback={<Shimmer className="absolute inset-3 rounded-2xl" />}>
            <Suspense fallback={<Shimmer className="absolute inset-3 rounded-2xl" />}>
              <MapCanvas loc={loc} aqi={aqi} routes={routes} />
            </Suspense>
          </ClientOnly>
        )}

        <div className="pointer-events-none absolute top-3 left-3 z-[500] max-w-[min(70%,420px)] rounded-xl border border-hairline bg-background/70 px-3 py-2 backdrop-blur-md">
          <div className="label-glyph">{routes ? "selected route" : "current location AQI"}</div>
          <div className="mt-1 truncate text-[10px] text-foreground">
            {routes ? `${routeLabels?.origin ?? place} → ${routeLabels?.destination ?? "selected destination"}` : place}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <Wind size={11} strokeWidth={1.5} className="text-primary" />
            <span className="num text-[11px]">{routes ? "route AQI below" : `AQI ${aqi}`}</span>
          </div>
        </div>

        <div className="pointer-events-none absolute top-3 right-3 z-[500] space-y-1.5 rounded-xl border border-hairline bg-background/70 px-3 py-2 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <span className="h-[2px] w-5 rounded bg-primary" />
            <span className="num text-[9px] tracking-[0.14em] uppercase">safe</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-[3px] w-5 rounded bg-red-500" />
            <span className="num text-[9px] tracking-[0.14em] uppercase">direct</span>
          </div>
          {routes && routesCoincide(routes) ? (
            <div className="num max-w-[9rem] text-[9px] leading-snug text-muted-foreground">same road, so the red dashes sit on the teal line</div>
          ) : null}
        </div>

        {downloading ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute right-3 bottom-3 z-[500] w-[min(430px,calc(100%-1.5rem))] rounded-2xl border border-primary/50 bg-background/95 p-3 shadow-2xl backdrop-blur-xl"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Navigation size={16} strokeWidth={1.5} className="animate-spin text-primary" />
                <span className="label-glyph">updating road geometry</span>
              </div>
              <span className="num text-sm text-primary">{downloadProgress}%</span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3">
              <motion.div className="h-full bg-primary" animate={{ width: `${downloadProgress}%` }} />
            </div>
          </motion.div>
        ) : null}

        {failed ? (
          <div className="absolute inset-x-3 bottom-3 z-[500] rounded-2xl border border-hairline bg-background/80 backdrop-blur-xl">
            <CalmState
              icon={<Navigation size={18} strokeWidth={1.4} />}
              message="Route service is quiet right now — try again in a moment."
            />
          </div>
        ) : null}
      </div>

      <AnimatePresence>
        {routes ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="mt-3 rounded-2xl border border-primary/25 bg-surface-1 p-4"
          >
              <div className="mb-3 flex items-center justify-between border-b border-hairline pb-3">
                <div>
                  <div className="label-glyph">selected route air quality</div>
                  <div className="mt-1 text-[10px] text-muted-foreground">AQI and pollutants below belong to this route, not the current-location card above.</div>
                </div>
                <Wind size={16} className="text-primary" />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <ShieldCheck size={16} strokeWidth={1.5} className="text-primary" />
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="label-glyph">exposure reduction</span>
                      <Tooltip 
                        content={TooltipContent.ExposureReduction} 
                        position="top"
                        aiPrompt={`The safe route reduces my air pollution exposure by ${routes.exposure_reduction_pct.toFixed(1)}%. Safe route: ${routes.safe_route.distance_km.toFixed(1)}km, ${Math.round(routes.safe_route.duration_min)}min, AQI ${Math.round(routes.safe_route.avg_aqi_exposure)}. Direct route: ${routes.direct_route.distance_km.toFixed(1)}km, ${Math.round(routes.direct_route.duration_min)}min, AQI ${Math.round(routes.direct_route.avg_aqi_exposure)}. Is it worth taking the safe route?`}
                        aiContext={routes}
                      />
                    </div>
                    <CountUp
                      value={routes.exposure_reduction_pct}
                      duration={1400}
                      suffix="%"
                      className="text-3xl leading-none text-primary"
                    />
                    {routes.exposure_reduction_pct === 0 ? (
                      <div className="mt-1 max-w-[240px] text-[10px] text-muted-foreground">
                        No detour lowers your inhaled dose at {speedKmh} km/h, so the direct route is also the safest.
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-8 gap-y-1.5">
                  {(
                    [
                      ["safe", routes.safe_route],
                      ["direct", routes.direct_route],
                    ] as const
                  ).map(([k, leg]) => (
                    <div key={k} className="flex items-center gap-2">
                      <RouteIcon
                        size={11}
                        strokeWidth={1.5}
                        className={k === "safe" ? "text-primary" : "text-muted-foreground"}
                      />
                      <span className="num text-[10px] tracking-[0.12em] uppercase text-muted-foreground">
                        {k}
                      </span>
                      <span className="num text-[11px]">
                        {leg.distance_km.toFixed(1)} km · {Math.round(leg.duration_min)} min ·
                        AQI {Math.round(leg.avg_aqi_exposure)}
                        {typeof leg.inhaled_total_ug === "number" ? ` · ${leg.inhaled_total_ug.toFixed(0)} µg inhaled` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {[
                  { k: "safe route AQI", v: routeInsight?.safe_route_aqi ?? routes.safe_route.avg_aqi_exposure, s: "average exposure" },
                  { k: "direct route AQI", v: routeInsight?.direct_route_aqi ?? routes.direct_route.avg_aqi_exposure, s: "baseline exposure" },
                  { k: "route risk score", v: routeInsight?.safe_route_risk_score ?? 0, s: `${routeInsight?.safe_route_risk_label ?? "Low"} · direct ${routeInsight?.direct_route_risk_score ?? 0}` },
                ].map((item) => (
                  <div key={item.k} className="rounded-xl border border-hairline bg-background/55 px-3 py-2.5">
                    <div className="label-glyph text-[9px]">{item.k}</div>
                    <div className="mt-1 flex items-end gap-1.5">
                      <CountUp value={item.v} digits={0} className="text-xl tracking-tight" />
                    </div>
                    <div className="num mt-0.5 text-[9px] text-muted-foreground/60 uppercase">{item.s}</div>
                  </div>
                ))}
              </div>

              <div className="mt-3 grid gap-2 border-t border-hairline pt-3 sm:grid-cols-2">
                {(["safe", "direct"] as const).map((kind) => {
                  const leg = kind === "safe" ? routes.safe_route : routes.direct_route;
                  const pollutants = leg.pollutants;
                  return (
                    <div key={`${kind}-pollutants`} className="rounded-xl border border-hairline bg-background/55 px-3 py-2.5">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="label-glyph text-[9px]">{kind} route pollutants</span>
                        <span className="num text-[9px] text-muted-foreground">average</span>
                      </div>
                      <div className="grid grid-cols-5 gap-1.5">
                        {[
                          ["PM2.5", pollutants?.pm25],
                          ["PM10", pollutants?.pm10],
                          ["NO₂", pollutants?.no2],
                          ["SO₂", pollutants?.so2],
                          ["O₃", pollutants?.o3],
                        ].map(([label, value]) => (
                          <div key={label} className="min-w-0 text-center">
                            <div className="num text-[11px] text-foreground">{typeof value === "number" ? value.toFixed(1) : "--"}</div>
                            <div className="label-glyph truncate text-[8px] text-muted-foreground">{label}</div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-2 text-right num text-[8px] text-muted-foreground">µg/m³ estimate</div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-3 rounded-xl border border-hairline bg-background/55 px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="label-glyph text-[9px]">add to your exposure report</div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      Searching a route only plans it. Log it only if you actually took it, so your report stays accurate.
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {(["safe", "direct"] as const).map((kind) => (
                      <button
                        key={kind}
                        type="button"
                        onClick={() => recordTrip(kind)}
                        className="press rounded-xl border border-primary/35 bg-primary/12 px-3 py-1.5 text-primary transition-colors hover:bg-primary/20"
                      >
                        <span className="num text-[10px] tracking-[0.12em] uppercase">I took the {kind} route</span>
                      </button>
                    ))}
                  </div>
                </div>
                {loggedTrip ? (
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-primary" role="status">
                    <CheckCircle2 size={13} />
                    Logged the {loggedTrip} route.
                    <Link to="/reports" className="underline underline-offset-2">View report</Link>
                  </div>
                ) : null}
              </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, ease: EASE }}
      />
    </Panel>
  );
}