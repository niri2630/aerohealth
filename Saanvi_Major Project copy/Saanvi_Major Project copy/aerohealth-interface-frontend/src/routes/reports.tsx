import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  Activity,
  AlertTriangle,
  Download,
  Pencil,
  ShieldCheck,
  Trash2,
  Check,
  X,
} from "lucide-react";

import { EASE } from "@/lib/aero/ui";
import { postPredict } from "@/lib/aero/api";
import { readLiveContext, type LiveContext } from "@/lib/aero/live-context";
import {
  ACTIVITY_LABEL,
  MASK_LABEL,
  POLLUTANT_KEYS,
  POLLUTANT_LABEL,
  emptyInhaled,
  round1,
  type Inhaled,
} from "@/lib/aero/exposure-profile";
import {
  clearTrips,
  deleteTrip,
  loadTrips,
  subscribeTrips,
  tripMetrics,
  updateTrip,
  type Trip,
} from "@/lib/aero/trips";
import type { Activity as ActivityLevel, MaskType, PredictBody } from "@/lib/aero/types";

export const Route = createFileRoute("/reports")({ component: ReportsPage });

type Range = "24h" | "7d" | "30d" | "all";
const RANGE_HOURS: Record<Range, number> = { "24h": 24, "7d": 168, "30d": 720, all: Infinity };
const RANGE_LABEL: Record<Range, string> = {
  "24h": "24 Hours",
  "7d": "7 Days",
  "30d": "30 Days",
  all: "All time",
};

type RiskState = { risk_score?: number; risk_label?: string };

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function tripBody(trip: Trip): PredictBody {
  const p = trip.legs[trip.routeTaken].pollutants;
  return {
    pm25: p.pm25,
    no2: p.no2,
    o3: p.o3,
    so2: p.so2,
    temperature: trip.weather.temperature,
    humidity: trip.weather.humidity,
    ...trip.vitals,
    activity: trip.activity,
    mask: trip.mask,
  };
}

function ReportsPage() {
  const [range, setRange] = useState<Range>("30d");
  const [live, setLive] = useState<Partial<LiveContext>>({});
  const [trips, setTrips] = useState<Trip[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);

  useEffect(() => {
    setLive(readLiveContext());
    const sync = () => setTrips(loadTrips());
    sync();
    return subscribeTrips(sync);
  }, []);

  const inRange = useMemo(() => {
    const cutoff = Date.now() - RANGE_HOURS[range] * 3600_000;
    return trips
      .filter((trip) => new Date(trip.occurredAt).getTime() >= cutoff)
      .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  }, [trips, range]);
  const counted = useMemo(() => inRange.filter((trip) => trip.included), [inRange]);

  // Risk for each trip comes from the same model as the dashboard.
  const riskQueries = useQueries({
    queries: inRange.map((trip) => {
      const body = tripBody(trip);
      return { queryKey: ["trip-risk", body], queryFn: () => postPredict(body), staleTime: 60_000 };
    }),
  });
  const riskById = useMemo(() => {
    const map = new Map<string, { score: number; label: string }>();
    inRange.forEach((trip, index) => {
      const data = riskQueries[index]?.data?.data;
      if (data) map.set(trip.id, { score: data.risk_score, label: data.risk_label });
    });
    return map;
  }, [inRange, riskQueries]);

  const summary = useMemo(() => {
    const inhaled: Inhaled = emptyInhaled();
    let minutes = 0;
    let km = 0;
    let aqiWeighted = 0;
    let avoided = 0;
    let safeCount = 0;
    for (const trip of counted) {
      const m = tripMetrics(trip);
      for (const key of POLLUTANT_KEYS) inhaled[key] += m.inhaled[key];
      minutes += m.duration_min;
      km += m.distance_km;
      aqiWeighted += m.avg_aqi * m.distance_km;
      if (trip.routeTaken === "safe") {
        safeCount += 1;
        avoided += Math.max(
          0,
          tripMetrics({ ...trip, routeTaken: "direct" }).inhaled_total_ug - m.inhaled_total_ug,
        );
      }
    }
    const total = round1(POLLUTANT_KEYS.reduce((sum, key) => sum + inhaled[key], 0));
    const risks = counted
      .map((trip) => riskById.get(trip.id)?.score)
      .filter((v): v is number => typeof v === "number");
    return {
      inhaled,
      total,
      minutes,
      km: round1(km),
      avgAqi: km ? Math.round(aqiWeighted / km) : 0,
      avoided: round1(avoided),
      safeCount,
      avgRisk: risks.length
        ? Math.round(risks.reduce((a, b) => a + b, 0) / risks.length)
        : undefined,
      peakRisk: risks.length ? Math.max(...risks) : undefined,
    };
  }, [counted, riskById]);

  const ranked = POLLUTANT_KEYS.map((key) => ({ key, value: round1(summary.inhaled[key]) })).sort(
    (a, b) => b.value - a.value,
  );
  const maxInhaled = Math.max(1, ...ranked.map((item) => item.value));

  const aqi = live.aqi_data?.aqi ?? 0;
  const risk = (live.risk_data as RiskState | undefined) ?? {};
  const pollutants = live.aqi_data;
  const factors = [...(live.shap_data?.features ?? [])]
    .sort((a, b) => Math.abs(b.shap_value) - Math.abs(a.shap_value))
    .slice(0, 5);

  const insights = useMemo(() => {
    const out: { title: string; message: string; tone: "warning" | "positive" | "info" }[] = [];
    if (!counted.length) {
      return [
        {
          title: "No trips in this report yet",
          message:
            "Plan a route on the dashboard, then press “I took the safe/direct route” once you actually travel. Routes you only search for are never counted.",
          tone: "info" as const,
        },
      ];
    }
    const top = ranked[0];
    if (top && top.value > 0 && summary.total > 0) {
      out.push({
        title: `${POLLUTANT_LABEL[top.key]} affected you most`,
        message: `${POLLUTANT_LABEL[top.key]} made up ${Math.round((top.value / summary.total) * 100)}% of the ${summary.total} µg you inhaled across ${counted.length} trip${counted.length === 1 ? "" : "s"}.`,
        tone: "warning",
      });
    }
    if (summary.safeCount && summary.avoided > 0) {
      out.push({
        title: "Safe routes paid off",
        message: `On ${summary.safeCount} trip${summary.safeCount === 1 ? "" : "s"} the safe route cut your inhaled dose by about ${summary.avoided} µg versus the direct route.`,
        tone: "positive",
      });
    }
    const directTrips = counted.length - summary.safeCount;
    if (directTrips) {
      out.push({
        title: `${directTrips} trip${directTrips === 1 ? "" : "s"} on the direct route`,
        message:
          "These had higher exposure. Open a trip and use Edit if you actually took a different route.",
        tone: "info",
      });
    }
    return out;
  }, [counted, ranked, summary]);

  function exportReport() {
    const lines = [
      "AeroHealth Exposure Report",
      `Range: ${RANGE_LABEL[range]}`,
      `Trips counted: ${counted.length} of ${inRange.length}`,
      `Distance: ${summary.km} km, time in transit: ${summary.minutes} min`,
      `Total inhaled: ${summary.total} ug (${ranked.map((r) => `${POLLUTANT_LABEL[r.key]} ${r.value}`).join(", ")})`,
      summary.avgRisk !== undefined
        ? `Average trip risk: ${summary.avgRisk}/100 (peak ${summary.peakRisk})`
        : "Average trip risk: n/a",
      "",
      "Trips:",
      ...inRange.map((trip) => {
        const m = tripMetrics(trip);
        return `${trip.included ? "[x]" : "[ ]"} ${new Date(trip.occurredAt).toLocaleString()} | ${trip.origin} -> ${trip.destination} | ${trip.routeTaken} route | ${m.distance_km} km @ ${trip.speed_kmh} km/h = ${m.duration_min} min | AQI ${m.avg_aqi} | ${m.inhaled_total_ug} ug inhaled | ${ACTIVITY_LABEL[trip.activity]}, mask ${MASK_LABEL[trip.mask]}`;
      }),
      "",
      ...insights.map((item) => `${item.title}: ${item.message}`),
    ];
    const url = URL.createObjectURL(
      new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `aerohealth-${range}-report.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const card = "rounded-2xl border border-white/10 bg-white/[0.04] p-5";

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <header className="border-b border-white/5 bg-gradient-to-br from-primary/10 via-transparent to-cyan-500/5">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-14 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-3 text-sm uppercase tracking-[0.2em] text-primary">
              ◆ EXPOSURE REPORT
            </div>
            <h1 className="text-5xl font-light tracking-tight">
              Your exposure <span className="text-primary italic">analyzed.</span>
            </h1>
            <p className="mt-4 text-muted-foreground">
              Built from the trips you actually took · {live.location ?? "no location chosen yet"}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              to="/"
              className="rounded-xl border border-white/10 px-5 py-3 text-sm text-muted-foreground hover:bg-white/5"
            >
              ← Dashboard
            </Link>
            <button
              onClick={exportReport}
              className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-5 py-3 font-medium text-primary hover:bg-primary/20"
            >
              <Download size={18} /> Export report
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-10 px-6 py-10">
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(RANGE_LABEL) as Range[]).map((item) => (
            <button
              key={item}
              onClick={() => setRange(item)}
              className={`rounded-xl px-5 py-2 text-sm ${range === item ? "border border-primary/30 bg-primary/15 text-primary" : "border border-white/10 text-muted-foreground hover:bg-white/5"}`}
            >
              {RANGE_LABEL[item]}
            </button>
          ))}
        </div>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[
            {
              label: "Trips counted",
              value: counted.length,
              detail: `${summary.km} km · ${summary.minutes} min in transit`,
            },
            {
              label: "Total inhaled",
              value: `${summary.total} µg`,
              detail: "all tracked pollutants",
            },
            {
              label: "Average trip risk",
              value: summary.avgRisk ?? "--",
              detail: summary.peakRisk !== undefined ? `peak ${summary.peakRisk}` : "no trips yet",
            },
            {
              label: "Avoided by safe routes",
              value: `${summary.avoided} µg`,
              detail: `${summary.safeCount} safe-route trip${summary.safeCount === 1 ? "" : "s"}`,
            },
          ].map((item, index) => (
            <motion.div
              key={item.label}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.08, ease: EASE }}
              className={card}
            >
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                {item.label}
              </div>
              <div className="num mt-3 text-4xl font-bold">{item.value}</div>
              <div className="mt-2 text-xs text-muted-foreground">{item.detail}</div>
            </motion.div>
          ))}
        </section>

        <section>
          <h2 className="mb-5 text-3xl font-light">
            Live <span className="text-primary italic">insights</span>
          </h2>
          <div className="grid gap-4 lg:grid-cols-3">
            {insights.map((item) => (
              <div
                key={item.title}
                className={`rounded-2xl border p-5 ${item.tone === "warning" ? "border-orange-500/30 bg-orange-500/10" : item.tone === "positive" ? "border-green-500/30 bg-green-500/10" : "border-cyan-500/30 bg-cyan-500/10"}`}
              >
                <div className="mb-3 flex items-center gap-2">
                  {item.tone === "positive" ? (
                    <ShieldCheck size={18} className="text-green-400" />
                  ) : item.tone === "warning" ? (
                    <AlertTriangle size={18} className="text-orange-400" />
                  ) : (
                    <Activity size={18} className="text-cyan-400" />
                  )}
                  <strong>{item.title}</strong>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">{item.message}</p>
              </div>
            ))}
          </div>
        </section>

        <section className={card}>
          <h2 className="mb-1 text-2xl font-light">
            Pollutants that <span className="text-primary italic">affected you</span>
          </h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Micrograms inhaled on the trips counted above (concentration × breathing rate × time ×
            mask).
          </p>
          {summary.total > 0 ? (
            <div className="space-y-3">
              {ranked.map((item) => (
                <div key={item.key} className="flex items-center gap-3">
                  <span className="w-14 text-sm text-muted-foreground">
                    {POLLUTANT_LABEL[item.key]}
                  </span>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-black/30">
                    <motion.div
                      className="h-full rounded-full bg-primary/70"
                      initial={{ width: 0 }}
                      animate={{ width: `${(item.value / maxInhaled) * 100}%` }}
                      transition={{ duration: 0.6, ease: EASE }}
                    />
                  </div>
                  <span className="num w-24 text-right text-sm">{item.value} µg</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No counted trips in this range yet.</p>
          )}
        </section>

        <section>
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-3xl font-light">
              Trip <span className="text-primary italic">log</span>
            </h2>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setEditMode((on) => !on);
                  setEditing(null);
                }}
                className={`flex items-center gap-2 rounded-xl border px-4 py-2 text-sm ${editMode ? "border-primary/30 bg-primary/15 text-primary" : "border-white/10 text-muted-foreground hover:bg-white/5"}`}
              >
                <Pencil size={14} /> {editMode ? "Done editing" : "Edit report"}
              </button>
              {editMode && trips.length ? (
                <button
                  onClick={() => {
                    if (window.confirm("Delete every logged trip? This cannot be undone."))
                      clearTrips();
                  }}
                  className="rounded-xl border border-red-500/30 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10"
                >
                  Clear all
                </button>
              ) : null}
            </div>
          </div>

          {inRange.length ? (
            <div className="space-y-2">
              {inRange.map((trip) => {
                const m = tripMetrics(trip);
                const r = riskById.get(trip.id);
                const isEditing = editing === trip.id;
                return (
                  <div
                    key={trip.id}
                    className={`rounded-xl border px-4 py-3 ${trip.included ? "border-white/10 bg-white/[0.04]" : "border-white/5 bg-white/[0.015] opacity-60"}`}
                  >
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                      {editMode ? (
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={trip.included}
                            onChange={(e) => updateTrip(trip.id, { included: e.target.checked })}
                            aria-label="Include this trip in the report"
                          />
                          counted
                        </label>
                      ) : null}
                      <div className="min-w-0 flex-1 basis-64">
                        <div className="truncate text-sm">
                          {trip.origin} → {trip.destination}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(trip.occurredAt).toLocaleString()} · {trip.routeTaken} route
                          {trip.edited ? " · edited" : ""}
                          {!trip.included ? " · not counted" : ""}
                        </div>
                      </div>
                      <span className="num text-sm">
                        {m.distance_km} km · {m.duration_min} min @ {trip.speed_kmh} km/h
                      </span>
                      <span className="num text-sm">AQI {m.avg_aqi}</span>
                      <span className="num text-sm text-primary">{m.inhaled_total_ug} µg</span>
                      <span className="num text-sm text-primary">Risk {r ? r.score : "…"}</span>
                      {editMode ? (
                        <div className="flex gap-1">
                          <button
                            onClick={() => setEditing(isEditing ? null : trip.id)}
                            aria-label="Edit trip"
                            className="rounded-lg border border-white/10 p-2 text-muted-foreground hover:bg-white/5"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => deleteTrip(trip.id)}
                            aria-label="Delete trip"
                            className="rounded-lg border border-red-500/30 p-2 text-red-400 hover:bg-red-500/10"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ) : null}
                    </div>

                    {isEditing ? <TripEditor trip={trip} onClose={() => setEditing(null)} /> : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-white/10 p-6 text-sm text-muted-foreground">
              No trips logged in this range. Plan a route on the{" "}
              <Link to="/" className="text-primary underline underline-offset-2">
                dashboard
              </Link>{" "}
              and log it once you have travelled it.
            </div>
          )}
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className={card}>
            <h2 className="mb-1 text-2xl font-light">
              Current <span className="text-primary italic">pollutants</span>
            </h2>
            <p className="mb-4 text-xs text-muted-foreground">
              Live snapshot from the dashboard — not part of the trip totals.
            </p>
            {pollutants ? (
              <div className="grid grid-cols-5 gap-2">
                {[
                  ["PM2.5", pollutants.pm25],
                  ["PM10", pollutants.pm10],
                  ["NO2", pollutants.no2],
                  ["SO2", pollutants.so2],
                  ["O3", pollutants.o3],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-black/20 p-3 text-center">
                    <div className="num text-lg">{value}</div>
                    <div className="mt-1 text-[10px] text-muted-foreground">{label}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No live AQI data yet. Open the dashboard first.
              </p>
            )}
            {pollutants ? (
              <p className="mt-3 text-xs text-muted-foreground">
                AQI {aqi} · risk {risk.risk_score ?? "--"} ({risk.risk_label ?? "waiting"})
              </p>
            ) : null}
          </div>
          <div className={card}>
            <h2 className="mb-4 text-2xl font-light">
              Top <span className="text-primary italic">risk factors</span>
            </h2>
            {factors.length ? (
              <div className="space-y-2">
                {factors.map((factor) => (
                  <div
                    key={factor.name}
                    className="flex items-center justify-between rounded-lg bg-black/20 px-3 py-2"
                  >
                    <span>{factor.name}</span>
                    <span
                      className={`num ${factor.shap_value >= 0 ? "text-orange-400" : "text-primary"}`}
                    >
                      {factor.shap_value >= 0 ? "+" : ""}
                      {factor.shap_value.toFixed(1)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No explanation data yet.</p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function TripEditor({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const [routeTaken, setRouteTaken] = useState(trip.routeTaken);
  const [occurredAt, setOccurredAt] = useState(toLocalInput(trip.occurredAt));
  const [speed, setSpeed] = useState(String(trip.speed_kmh));
  const [activity, setActivity] = useState<ActivityLevel>(trip.activity);
  const [mask, setMask] = useState<MaskType>(trip.mask);
  const speedValue = Number(speed);
  const valid =
    Number.isFinite(speedValue) &&
    speedValue > 0 &&
    speedValue <= 150 &&
    !Number.isNaN(Date.parse(occurredAt));
  const field = "rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm";

  function save() {
    if (!valid) return;
    updateTrip(trip.id, {
      routeTaken,
      occurredAt: new Date(occurredAt).toISOString(),
      speed_kmh: speedValue,
      activity,
      mask,
    });
    onClose();
  }

  return (
    <div className="mt-3 grid gap-3 border-t border-white/10 pt-3 sm:grid-cols-2 lg:grid-cols-5">
      <label className="text-xs text-muted-foreground">
        Route actually taken
        <select
          className={`${field} mt-1 block w-full`}
          value={routeTaken}
          onChange={(e) => setRouteTaken(e.target.value as "safe" | "direct")}
        >
          <option value="safe">Safe route</option>
          <option value="direct">Direct route</option>
        </select>
      </label>
      <label className="text-xs text-muted-foreground">
        When
        <input
          className={`${field} mt-1 block w-full`}
          type="datetime-local"
          value={occurredAt}
          onChange={(e) => setOccurredAt(e.target.value)}
        />
      </label>
      <label className="text-xs text-muted-foreground">
        Speed (km/h)
        <input
          className={`${field} mt-1 block w-full`}
          type="number"
          min={1}
          max={150}
          step={0.5}
          value={speed}
          onChange={(e) => setSpeed(e.target.value)}
        />
      </label>
      <label className="text-xs text-muted-foreground">
        Activity
        <select
          className={`${field} mt-1 block w-full`}
          value={activity}
          onChange={(e) => setActivity(e.target.value as ActivityLevel)}
        >
          {(Object.keys(ACTIVITY_LABEL) as ActivityLevel[]).map((key) => (
            <option key={key} value={key}>
              {ACTIVITY_LABEL[key]}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs text-muted-foreground">
        Mask
        <select
          className={`${field} mt-1 block w-full`}
          value={mask}
          onChange={(e) => setMask(e.target.value as MaskType)}
        >
          {(Object.keys(MASK_LABEL) as MaskType[]).map((key) => (
            <option key={key} value={key}>
              {MASK_LABEL[key]}
            </option>
          ))}
        </select>
      </label>
      <div className="flex gap-2 sm:col-span-2 lg:col-span-5">
        <button
          onClick={save}
          disabled={!valid}
          className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-sm text-primary hover:bg-primary/20 disabled:opacity-50"
        >
          <Check size={14} /> Save changes
        </button>
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-sm text-muted-foreground hover:bg-white/5"
        >
          <X size={14} /> Cancel
        </button>
      </div>
    </div>
  );
}
