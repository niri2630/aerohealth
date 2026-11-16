import { useQuery } from "@tanstack/react-query";
import { CloudOff } from "lucide-react";
import { useMemo } from "react";

import { ConnectionCheck } from "@/components/aero/ConnectionCheck";
import { CalmState, Panel, PanelHead, Shimmer } from "@/components/aero/primitives";
import { getForecast, type Forecast } from "@/lib/aero/forecast";
import type { LatLon } from "@/lib/aero/types";

const W = 720;
const H = 210;
const PAD = { l: 38, r: 12, t: 12, b: 24 };
const HORIZONS_SHOWN = [3, 6, 12, 24];

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function aqiTone(aqi: number) {
  if (aqi <= 50) return "text-emerald-400";
  if (aqi <= 100) return "text-yellow-300";
  if (aqi <= 150) return "text-orange-400";
  return "text-red-400";
}

function Chart({ data }: { data: Forecast }) {
  const geo = useMemo(() => {
    const hist = data.history.slice(-24).map((p) => ({ t: Date.parse(p.time), v: p.pm25 }));
    const fc = data.forecast.map((p) => ({
      t: Date.parse(p.time),
      v: p.pm25,
      lo: p.lower,
      hi: p.upper,
    }));
    const t0 = hist.length ? hist[0]!.t : fc[0]!.t;
    const t1 = fc[fc.length - 1]!.t;
    const vMax = Math.max(40, ...hist.map((p) => p.v), ...fc.map((p) => p.hi)) * 1.08;
    const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0)) * (W - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - v / vMax) * (H - PAD.t - PAD.b);

    const histPath = hist
      .map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`)
      .join(" ");
    const last = hist[hist.length - 1];
    const fcPath =
      (last ? `M${x(last.t).toFixed(1)},${y(last.v).toFixed(1)} ` : "M") +
      fc
        .map((p, i) => `${last || i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`)
        .join(" ");
    const band =
      fc.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.hi).toFixed(1)}`).join(" ") +
      " " +
      [...fc]
        .reverse()
        .map((p) => `L${x(p.t).toFixed(1)},${y(p.lo).toFixed(1)}`)
        .join(" ") +
      " Z";

    const ticks: { x: number; label: string }[] = [];
    for (let t = Math.ceil(t0 / 3_600_000) * 3_600_000; t <= t1; t += 3_600_000) {
      const h = new Date(t).getHours();
      if (h % 6 === 0) {
        ticks.push({ x: x(t), label: new Date(t).toLocaleTimeString([], { hour: "numeric" }) });
      }
    }
    const yTicks = [0, 0.5, 1].map((f) => ({
      y: y(vMax * f * 0.92),
      label: Math.round(vMax * f * 0.92),
    }));
    return { histPath, fcPath, band, ticks, yTicks, nowX: last ? x(last.t) : x(t0) };
  }, [data]);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`PM2.5 at ${data.station}: last 24 hours observed and the next 24 hours forecast`}
      className="h-auto w-full"
    >
      {geo.yTicks.map((t) => (
        <g key={t.label}>
          <line
            x1={PAD.l}
            x2={W - PAD.r}
            y1={t.y}
            y2={t.y}
            stroke="currentColor"
            className="text-hairline"
            strokeDasharray="2 4"
          />
          <text
            x={PAD.l - 6}
            y={t.y + 3}
            textAnchor="end"
            className="fill-muted-foreground"
            fontSize="9"
          >
            {t.label}
          </text>
        </g>
      ))}
      <path d={geo.band} className="fill-primary/15" />
      <path d={geo.histPath} fill="none" strokeWidth={2} className="stroke-foreground/80" />
      <path
        d={geo.fcPath}
        fill="none"
        strokeWidth={2}
        strokeDasharray="5 4"
        className="stroke-primary"
      />
      <line
        x1={geo.nowX}
        x2={geo.nowX}
        y1={PAD.t}
        y2={H - PAD.b}
        stroke="currentColor"
        className="text-muted-foreground/50"
        strokeDasharray="1 3"
      />
      <text
        x={geo.nowX - 4}
        y={PAD.t + 8}
        textAnchor="end"
        className="fill-muted-foreground"
        fontSize="9"
      >
        observed
      </text>
      <text x={geo.nowX + 4} y={PAD.t + 8} className="fill-primary" fontSize="9">
        forecast
      </text>
      {geo.ticks.map((t) => (
        <text
          key={t.x}
          x={t.x}
          y={H - 8}
          textAnchor="middle"
          className="fill-muted-foreground"
          fontSize="9"
        >
          {t.label}
        </text>
      ))}
      <text
        x={PAD.l - 6}
        y={PAD.t - 2}
        textAnchor="end"
        className="fill-muted-foreground"
        fontSize="8"
      >
        µg/m³
      </text>
    </svg>
  );
}

function Reliability({ data }: { data: Forecast }) {
  const rows = HORIZONS_SHOWN.map((h) => ({ h, v: data.evaluation.horizons[String(h)] })).filter(
    (r) => r.v,
  );
  if (!rows.length) return null;
  return (
    <div className="rounded-xl border border-hairline bg-background/55 px-4 py-3">
      <div className="label-glyph text-[9px]">how reliable is this forecast?</div>
      <p className="mt-1 text-[10px] text-muted-foreground">
        Rolling cross-validation on {data.evaluation.observed_hours} hours of station data: four
        later time windows, each forecast by a model that had only seen earlier data. Error is the
        typical miss in µg/m³. Two simple guesses are the benchmark: air stays as it is now, or it
        repeats the same hour yesterday. The verdict is against whichever was harder to beat, and
        the last figure is how many of the windows the forecast won.
      </p>
      <table className="num mt-2 w-full text-[10px]">
        <thead className="text-muted-foreground/70">
          <tr className="text-left">
            <th className="py-1 font-normal">ahead</th>
            <th className="py-1 text-right font-normal">forecast</th>
            <th className="py-1 text-right font-normal">same as now</th>
            <th className="py-1 text-right font-normal">same hour yesterday</th>
            <th className="py-1 text-right font-normal">verdict</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ h, v }) => {
            const skill = v!.skill_vs_best_baseline_pct ?? v!.skill_vs_persistence_pct;
            const better = skill !== null && skill !== undefined && skill > 0;
            return (
              <tr key={h} className="border-t border-hairline/60">
                <td className="py-1">+{h} h</td>
                <td className="py-1 text-right">±{v!.mae.toFixed(1)}</td>
                <td className="py-1 text-right">±{v!.persistence_mae.toFixed(1)}</td>
                <td className="py-1 text-right">
                  {v!.seasonal_naive_mae === null ? "n/a" : `±${v!.seasonal_naive_mae.toFixed(1)}`}
                </td>
                <td className={`py-1 text-right ${better ? "text-primary" : "text-amber-400"}`}>
                  {skill === null || skill === undefined
                    ? "n/a"
                    : `${Math.abs(skill).toFixed(0)}% ${better ? "better" : "worse"}${
                        v!.folds ? ` · ${v!.folds_beating_best_baseline}/${v!.folds}` : ""
                      }`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ForecastPanel({ loc }: { loc: LatLon }) {
  const q = useQuery({
    queryKey: ["forecast", loc.lat, loc.lon],
    queryFn: () => getForecast(loc),
    staleTime: 30 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const data = q.data;

  return (
    <Panel className="p-0" delay={0.16} raise={false}>
      <PanelHead
        label="pm2.5 forecast · next 24 h"
        hint={data ? `${data.station} · ${data.model}` : "station history + weather forecast"}
      />
      <div className="px-5 pb-5">
        {q.isPending ? (
          <div className="space-y-3" aria-busy="true">
            <Shimmer className="h-44 w-full" />
            <p className="num text-[10px] text-muted-foreground">
              Downloading station, neighbour and weather history and training the forecast models
              (about 20 to 40 seconds on first load, then cached for an hour)…
            </p>
          </div>
        ) : q.isError || !data ? (
          <div role="alert">
            <CalmState
              icon={<CloudOff size={22} />}
              message={
                q.error instanceof Error
                  ? `No forecast here: ${q.error.message}`
                  : "No forecast is available for this location."
              }
            />
            <div className="mx-auto max-w-xl px-4 pb-4">
              <ConnectionCheck />
            </div>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {(
                  [
                    ["cleanest hour expected", data.summary.best],
                    ["most polluted hour expected", data.summary.worst],
                  ] as const
                ).map(([label, p]) => (
                  <div
                    key={label}
                    className="rounded-xl border border-hairline bg-background/55 px-4 py-3"
                  >
                    <div className="label-glyph text-[9px]">{label}</div>
                    <div className="num mt-1 text-lg">{clock(p.time)}</div>
                    <div className="num text-[10px] text-muted-foreground">
                      PM2.5 {p.pm25.toFixed(0)} µg/m³ ·{" "}
                      <span className={aqiTone(p.aqi)}>AQI {p.aqi}</span>
                    </div>
                  </div>
                ))}
              </div>
              <Chart data={data} />
              <p className="num text-[9px] text-muted-foreground/80">
                Shaded band: 80% of past forecasts fell inside it. Last station reading:{" "}
                {data.last_observed.pm25.toFixed(1)} µg/m³ at {clock(data.last_observed.time)}.
              </p>
            </div>
            <div className="space-y-3">
              <Reliability data={data} />
              <div className="rounded-xl border border-hairline bg-background/55 px-4 py-3">
                <div className="label-glyph text-[9px]">what drives the forecast</div>
                <ul className="mt-2 space-y-1.5">
                  {data.drivers.map((d) => (
                    <li key={d.factor} className="num text-[10px]">
                      <div className="flex justify-between">
                        <span>{d.factor}</span>
                        <span className="text-muted-foreground">{d.share_pct.toFixed(0)}%</span>
                      </div>
                      <div className="mt-0.5 h-1 rounded bg-surface-2">
                        <div
                          className="h-1 rounded bg-primary/70"
                          style={{ width: `${d.share_pct}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
                {data.spatial ? (
                  <p className="mt-2 text-[9px] text-muted-foreground/80">
                    Spatial inputs:{" "}
                    {data.spatial.neighbour_stations.length > 0
                      ? `${data.spatial.neighbour_stations.length} nearby station(s)`
                      : "no other live station within 25 km"}
                    {data.spatial.regional_model
                      ? ` + regional model (${data.spatial.regional_model})`
                      : ""}
                    .
                  </p>
                ) : null}
                <p className="mt-2 text-[9px] text-muted-foreground/80">
                  Sources: {data.data_sources.join(" · ")}. Modelled estimate, not a measurement or
                  medical advice.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}
