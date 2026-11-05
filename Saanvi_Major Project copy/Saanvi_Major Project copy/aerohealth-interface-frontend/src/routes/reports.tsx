import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { Activity, AlertTriangle, Download, ShieldCheck } from "lucide-react";

import { EASE } from "@/lib/aero/ui";
import { getHistory } from "@/lib/aero/api";
import { readLiveContext, type LiveContext } from "@/lib/aero/live-context";
import type { HistoryPoint } from "@/lib/aero/types";

export const Route = createFileRoute("/reports")({ component: ReportsPage });
type Range = "24h" | "7d" | "30d";

type RiskState = { risk_score?: number; risk_label?: string };

function ReportsPage() {
  const [range, setRange] = useState<Range>("7d");
  const [live, setLive] = useState<Partial<LiveContext>>({});
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const hours = range === "24h" ? 24 : range === "7d" ? 168 : 720;

  useEffect(() => {
    let active = true;
    const load = async () => {
      const next = readLiveContext();
      if (active) setLive(next);
      if (next.location_coords) {
        setLoading(true);
        const result = await getHistory(next.location_coords, hours);
        if (active) setHistory(result.data);
      }
      if (active) setLoading(false);
    };
    void load();
    return () => { active = false; };
  }, [hours]);

  const aqi = live.aqi_data?.aqi ?? 0;
  const risk = (live.risk_data as RiskState | undefined) ?? {};
  const route = live.route_data;
  const values = history.map((point) => point.aqi);
  const average = values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : aqi;
  const peak = values.length ? Math.max(...values) : aqi;
  const unhealthyCount = values.filter((value) => value > 100).length;
  const firstValue = values.at(0);
  const latestValue = values.at(-1);
  const trend =
    firstValue !== undefined && latestValue !== undefined && values.length > 1 && latestValue < firstValue
      ? "improving"
      : "worsening";
  const pollutants = live.aqi_data;
  const factors = [...(live.shap_data?.features ?? [])].sort((a, b) => Math.abs(b.shap_value) - Math.abs(a.shap_value)).slice(0, 5);

  const insights = useMemo(() => {
    const output: { title: string; message: string; tone: "warning" | "positive" | "info" }[] = [];
    if (aqi > 100) output.push({ title: "Current air needs caution", message: `AQI is ${aqi}. Reduce strenuous outdoor activity and consider a well-fitting N95 or KN95 mask.`, tone: "warning" });
    if (values.length) output.push({ title: `Recent trend is ${trend}`, message: `The selected period moved from AQI ${values[0]} to ${values[values.length - 1]}.`, tone: trend === "improving" ? "positive" : "warning" });
    if (route) output.push({ title: "Route comparison available", message: `Safe route exposure is ${route.exposure_reduction_pct}% lower than direct (${route.safe_route.avg_aqi_exposure} versus ${route.direct_route.avg_aqi_exposure} AQI).`, tone: "positive" });
    if (factors[0]) output.push({ title: "Largest model driver", message: `${factors[0].name} contributes ${factors[0].shap_value >= 0 ? "+" : ""}${factors[0].shap_value.toFixed(1)} to the score.`, tone: factors[0].shap_value > 0 ? "warning" : "info" });
    return output.length ? output : [{ title: "Waiting for live data", message: "Visit the dashboard to load current AQI, risk, and route information.", tone: "info" as const }];
  }, [aqi, factors, route, trend, values]);

  function exportReport() {
    const lines = ["AeroHealth Live Report", `Location: ${live.location ?? "Unknown"}`, `Range: ${range}`, `Current AQI: ${aqi}`, `Risk: ${risk.risk_score ?? "unknown"} (${risk.risk_label ?? "unknown"})`, `Average AQI: ${average}`, `Peak AQI: ${peak}`, `Readings above 100: ${unhealthyCount}`, route ? `Safe route exposure reduction: ${route.exposure_reduction_pct}%` : "Route: not calculated", pollutants ? `Pollutants: PM2.5 ${pollutants.pm25}, PM10 ${pollutants.pm10}, NO2 ${pollutants.no2}, SO2 ${pollutants.so2}, O3 ${pollutants.o3}` : "Pollutants: unavailable", "", ...insights.map((item) => `${item.title}: ${item.message}`)];
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `aerohealth-${range}-report.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <header className="border-b border-white/5 bg-gradient-to-br from-primary/10 via-transparent to-cyan-500/5">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-14 md:flex-row md:items-end md:justify-between">
          <div><div className="mb-3 text-sm uppercase tracking-[0.2em] text-primary">◆ LIVE HEALTH EXPOSURE REPORT</div><h1 className="text-5xl font-light tracking-tight">Your exposure <span className="text-primary italic">analyzed.</span></h1><p className="mt-4 text-muted-foreground">{live.location ?? "Connect the dashboard to load your current location"} · {loading ? "updating live data" : `updated ${live.updated_at ? new Date(live.updated_at).toLocaleTimeString() : "now"}`}</p></div>
          <button onClick={exportReport} className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-5 py-3 font-medium text-primary hover:bg-primary/20"><Download size={18} /> Export current report</button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-10 px-6 py-10">
        <div className="flex gap-2">{(["24h", "7d", "30d"] as Range[]).map((item) => <button key={item} onClick={() => setRange(item)} className={`rounded-xl px-5 py-2 text-sm ${range === item ? "border border-primary/30 bg-primary/15 text-primary" : "border border-white/10 text-muted-foreground hover:bg-white/5"}`}>{item === "24h" ? "24 Hours" : item === "7d" ? "7 Days" : "30 Days"}</button>)}</div>
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">{[{ label: "Current AQI", value: aqi, detail: live.aqi_data?.station ?? "waiting" }, { label: "Risk score", value: risk.risk_score ?? "--", detail: risk.risk_label ?? "waiting" }, { label: `${range} average`, value: average, detail: trend }, { label: "Readings >100", value: unhealthyCount, detail: `peak ${peak}` }].map((item, index) => <motion.div key={item.label} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.08, ease: EASE }} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"><div className="text-xs uppercase tracking-wider text-muted-foreground">{item.label}</div><div className="mt-3 text-4xl font-bold num">{item.value}</div><div className="mt-2 text-xs capitalize text-muted-foreground">{item.detail}</div></motion.div>)}</section>
        <section><h2 className="mb-5 text-3xl font-light">Live <span className="text-primary italic">insights</span></h2><div className="grid gap-4 lg:grid-cols-3">{insights.map((item) => <div key={item.title} className={`rounded-2xl border p-5 ${item.tone === "warning" ? "border-orange-500/30 bg-orange-500/10" : item.tone === "positive" ? "border-green-500/30 bg-green-500/10" : "border-cyan-500/30 bg-cyan-500/10"}`}><div className="mb-3 flex items-center gap-2">{item.tone === "positive" ? <ShieldCheck size={18} className="text-green-400" /> : item.tone === "warning" ? <AlertTriangle size={18} className="text-orange-400" /> : <Activity size={18} className="text-cyan-400" />}<strong>{item.title}</strong></div><p className="text-sm leading-relaxed text-muted-foreground">{item.message}</p></div>)}</div></section>
        <section className="grid gap-6 lg:grid-cols-2"><div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"><h2 className="mb-4 text-2xl font-light">Current <span className="text-primary italic">pollutants</span></h2>{pollutants ? <div className="grid grid-cols-5 gap-2">{[["PM2.5", pollutants.pm25], ["PM10", pollutants.pm10], ["NO2", pollutants.no2], ["SO2", pollutants.so2], ["O3", pollutants.o3]].map(([label, value]) => <div key={label} className="rounded-xl bg-black/20 p-3 text-center"><div className="num text-lg">{value}</div><div className="mt-1 text-[10px] text-muted-foreground">{label}</div></div>)}</div> : <p className="text-sm text-muted-foreground">No live AQI data yet. Open the dashboard first.</p>}</div><div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"><h2 className="mb-4 text-2xl font-light">Top <span className="text-primary italic">risk factors</span></h2>{factors.length ? <div className="space-y-2">{factors.map((factor) => <div key={factor.name} className="flex items-center justify-between rounded-lg bg-black/20 px-3 py-2"><span>{factor.name}</span><span className={`num ${factor.shap_value >= 0 ? "text-orange-400" : "text-primary"}`}>{factor.shap_value >= 0 ? "+" : ""}{factor.shap_value.toFixed(1)}</span></div>)}</div> : <p className="text-sm text-muted-foreground">No explanation data yet.</p>}</div></section>
        <section className="rounded-2xl border border-primary/25 bg-primary/[0.05] p-5"><h2 className="mb-4 text-2xl font-light">Route <span className="text-primary italic">comparison</span></h2>{route ? <div className="grid gap-3 md:grid-cols-3"><div><div className="text-xs text-muted-foreground">Safe route</div><div className="num text-xl">{route.safe_route.distance_km} km · AQI {route.safe_route.avg_aqi_exposure}</div></div><div><div className="text-xs text-muted-foreground">Direct route</div><div className="num text-xl">{route.direct_route.distance_km} km · AQI {route.direct_route.avg_aqi_exposure}</div></div><div><div className="text-xs text-muted-foreground">Estimated reduction</div><div className="num text-2xl text-primary">{route.exposure_reduction_pct}%</div></div></div> : <p className="text-sm text-muted-foreground">Calculate a route on the dashboard to include route exposure in this report.</p>}</section>
        <section><h2 className="mb-5 text-3xl font-light">Exposure <span className="text-primary italic">timeline</span></h2><div className="space-y-2">{history.length ? history.map((point) => <div key={point.timestamp} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3"><span className="text-sm text-muted-foreground">{new Date(point.timestamp).toLocaleString()}</span><span className="num">AQI {point.aqi}</span><span className="num text-primary">Risk {point.risk_score}</span></div>) : <div className="rounded-xl border border-white/10 p-5 text-sm text-muted-foreground">No history loaded yet.</div>}</div></section>
      </main>
    </div>
  );
}
