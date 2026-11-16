"""
Reproducible evaluation of the PM2.5 forecaster. Writes FORECAST_EVALUATION.md.

    python evaluate_forecast.py

Needs OPENAQ_API_KEY (see .env.example) and internet access; takes several minutes because it
downloads history for every station. Results change as new data arrives, so re-run it right before
quoting numbers in the report.

Protocol
  * Every station is scored with rolling-origin cross-validation (see forecast.py): four consecutive
    test windows, each forecast by a model trained only on earlier data. Model-mix weights are chosen
    inside each training window, never on test data.
  * DEV_STATIONS are the stations used while the design was developed (features, model settings,
    whether to keep the spatial inputs). Their numbers are optimistic.
  * FRESH_STATIONS were first looked at only after the design was frozen. They are the fair test.
    Do not tune the design on them; if you change the design, pick new fresh stations.
"""
import time
import warnings
from datetime import datetime, timezone

import httpx

import forecast

warnings.filterwarnings("ignore")

DEV_STATIONS = {
    "Mangaluru": (12.8417, 74.9230),
    "Chennai": (13.0827, 80.2707),
    "Mumbai": (19.0760, 72.8777),
    "Delhi": (28.6139, 77.2090),
    "Kolkata": (22.5726, 88.3639),
    "London": (51.5074, -0.1278),
}
FRESH_STATIONS = {
    "Hyderabad": (17.3850, 78.4867),
    "Pune": (18.5204, 73.8567),
    "Lucknow": (26.8467, 80.9462),
    "Ahmedabad": (23.0225, 72.5714),
    "Patna": (25.5941, 85.1376),
    "Jaipur": (26.9124, 75.7873),
    "Chandigarh": (30.7333, 76.7794),
    "Los Angeles": (34.0522, -118.2437),
    "Beijing": (39.9042, 116.4074),
    "Bangkok": (13.7563, 100.5018),
}
SHOW = forecast.EVAL_HORIZONS
VARIANTS = {
    "temporal only": dict(use_neighbours=False, use_cams=False),
    "+ nearby stations": dict(use_neighbours=True, use_cams=False),
    "+ regional model": dict(use_neighbours=False, use_cams=True),
    "+ both (served design)": dict(use_neighbours=True, use_cams=True),
}


def fmt(v, nd=1, suffix=""):
    return "n/a" if v is None else f"{v:.{nd}f}{suffix}"


def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def load(group, label):
    """Download inputs and run the served design's cross-validation for each station."""
    headers = forecast.aqi_mod._openaq_headers()
    out, failed = {}, {}
    for name, (lat, lon) in group.items():
        try:
            with httpx.Client(timeout=30.0, headers=headers) as client:
                target, nbs = forecast._discover(client, lat, lon)
                inp = forecast.fetch_inputs(client, target, nbs, forecast.HISTORY_DAYS)
            out[name] = {"inputs": inp, "eval": forecast.evaluate_inputs(inp)}
            print(f"ok   [{label}] {name}: {inp.station['station']}", flush=True)
        except Exception as e:  # report, don't hide
            failed[name] = f"{type(e).__name__}: {e}"
            print(f"FAIL [{label}] {name}: {failed[name]}", flush=True)
        time.sleep(3)  # stay inside OpenAQ's rate limit
    return out, failed


def station_tables(results):
    lines = []
    for name, r in results.items():
        inp, ev = r["inputs"], r["eval"]
        lines += [
            f"### {name}: {inp.station['station']}",
            "",
            f"{int(inp.pm.notna().sum())} observed hours; {len(inp.neighbours)} nearby station(s); "
            f"regional model {'yes' if inp.cams is not None else 'no'}.",
            "",
            "| Horizon | Forecast MAE | Same as now | Same hour yesterday | Skill vs harder baseline (pooled) | Per-window skill, mean ± std | Windows beating baseline |",
            "|---|---|---|---|---|---|---|",
        ]
        for h in SHOW:
            v = ev.get(str(h))
            if not v:
                continue
            lines.append(
                f"| +{h} h | {fmt(v['mae'], 2)} | {fmt(v['persistence_mae'], 2)} | "
                f"{fmt(v['seasonal_naive_mae'], 2)} | {fmt(v['skill_vs_best_baseline_pct'], 1, '%')} | "
                f"{fmt(v['fold_skill_mean_pct'], 1, '%')} ± {fmt(v['fold_skill_std_pct'], 1)} | "
                f"{v['folds_beating_best_baseline']} / {v['folds']} |"
            )
        lines.append("")
    return lines


def summary_table(title, results):
    lines = [
        f"### {title} ({len(results)} stations: {', '.join(results) or 'none'})",
        "",
        "| Horizon | Mean skill vs same-as-now | Mean skill vs same-hour-yesterday | Mean skill vs harder baseline | Stations ahead of harder baseline | Windows won (all stations) |",
        "|---|---|---|---|---|---|",
    ]
    for h in SHOW:
        evs = [r["eval"].get(str(h)) for r in results.values()]
        evs = [e for e in evs if e]
        if not evs:
            continue
        ahead = sum(1 for e in evs if (e["skill_vs_best_baseline_pct"] or 0) > 0)
        won = sum(e["folds_beating_best_baseline"] for e in evs)
        total = sum(e["folds"] for e in evs)
        lines.append(
            f"| +{h} h | {fmt(mean([e['skill_vs_persistence_pct'] for e in evs]), 1, '%')} | "
            f"{fmt(mean([e['skill_vs_seasonal_pct'] for e in evs]), 1, '%')} | "
            f"{fmt(mean([e['skill_vs_best_baseline_pct'] for e in evs]), 1, '%')} | "
            f"{ahead} / {len(evs)} | {won} / {total} |"
        )
    lines.append("")
    return lines


def ablation(dev):
    lines = [
        "| Inputs | " + " | ".join(f"+{h} h" for h in SHOW) + " | Average |",
        "|---|" + "---|" * (len(SHOW) + 1),
    ]
    for label, kw in VARIANTS.items():
        per_h = {h: [] for h in SHOW}
        for r in dev.values():
            ev = forecast.evaluate_inputs(r["inputs"], **kw)
            for h in SHOW:
                if str(h) in ev and ev[str(h)]["skill_vs_best_baseline_pct"] is not None:
                    per_h[h].append(ev[str(h)]["skill_vs_best_baseline_pct"])
        means = [mean(per_h[h]) for h in SHOW]
        lines.append(f"| {label} | " + " | ".join(fmt(m, 1, "%") for m in means) + f" | {fmt(mean(means), 1, '%')} |")
    return lines + [""]


def main():
    dev, dev_failed = load(DEV_STATIONS, "dev")
    fresh, fresh_failed = load(FRESH_STATIONS, "fresh")

    L = [
        "# PM2.5 forecast evaluation",
        "",
        f"Generated {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC by `evaluate_forecast.py`.",
        "",
        "## Method",
        "",
        "**Data.** About 90 days of hourly PM2.5 per station (OpenAQ), weather history and forecast "
        "(Open-Meteo), up to three other stations within 25 km (OpenAQ), and the CAMS regional "
        "air-quality model on a grid (via Open-Meteo, which also forecasts ahead). The spatial inputs are "
        "optional per station.",
        "",
        "**Model.** One small gradient-boosted model per horizon predicts the *change* from the current "
        "value. The served forecast is a weighted mix of that model, 'same hour yesterday' and 'same as "
        "now'. The mix is chosen per horizon by validation inside each training window.",
        "",
        "**Evaluation.** Rolling-origin cross-validation: the first 50% of the history is always training; "
        "the remaining 50% is cut into four consecutive test windows, and each is forecast by a model "
        "trained only on earlier data, with no shuffling and no target-time overlap. Errors are in µg/m³. "
        "'Skill' = 1 - MAE(forecast) / MAE(baseline); positive means we beat the baseline. 'Harder "
        "baseline' is whichever of 'same as now' or 'same hour yesterday' had the lower error; at +24 h "
        "the two are identical. 'Windows won' counts test windows in which the forecast beat the harder baseline.",
        "",
        "**Which stations to trust.** The development stations were used while the design was being built "
        "(choosing features, model settings and whether to keep the spatial inputs), so they are "
        "optimistic. The fresh stations were first looked at after the design was frozen, and the design "
        "was not changed afterwards. They are the fair test.",
        "",
        "## Fresh stations (design frozen before they were first run)",
        "",
    ]
    L += summary_table("Summary", fresh)
    L += station_tables(fresh)
    if fresh_failed:
        L += ["Stations with no usable live data in this run:", ""] + [f"- {n}: {m}" for n, m in fresh_failed.items()] + [""]
    L += ["## Development stations (optimistic)", ""]
    L += summary_table("Summary", dev)
    L += station_tables(dev)
    if dev_failed:
        L += ["Stations with no usable live data in this run:", ""] + [f"- {n}: {m}" for n, m in dev_failed.items()] + [""]
    L += [
        "## Do the spatial inputs help? (development stations, mean skill vs harder baseline)",
        "",
        "Rule used when designing: keep an input family only if it raised this average.",
        "",
    ]
    L += ablation(dev)

    # Data-driven reading of the fresh-station result.
    def horizon_mean(h):
        evs = [r["eval"].get(str(h)) for r in fresh.values()]
        return mean([e["skill_vs_best_baseline_pct"] for e in evs if e])

    means = {h: horizon_mean(h) for h in SHOW}
    pos = [h for h in SHOW if means[h] is not None and means[h] > 0]
    neg = [h for h in SHOW if means[h] is not None and means[h] <= 0]
    losers = []
    for name, r in fresh.items():
        vals = [e["skill_vs_best_baseline_pct"] for e in r["eval"].values() if e["skill_vs_best_baseline_pct"] is not None]
        if vals and sum(vals) / len(vals) < 0:
            losers.append(name)
    L += ["## Honest reading of the results", ""]
    if fresh:
        L.append(
            "- On the fresh stations, mean skill against the harder baseline is positive at "
            + (", ".join(f"+{h} h" for h in pos) or "no horizon")
            + (" and zero or negative at " + ", ".join(f"+{h} h" for h in neg) if neg else "")
            + "."
        )
        L.append(
            f"- **Not every station benefits.** On average the forecast was worse than the harder baseline at: "
            f"{', '.join(losers)}."
            if losers
            else "- No fresh station had an average skill below zero in this run."
        )
    else:
        L.append("- No fresh stations returned data in this run, so there is no unbiased result to report.")
    L += [
        "- The one-hour-ahead gain is small for any method because hourly PM2.5 is very persistent. The "
        "mix weights chosen by validation lean towards 'same as now' at +1 h, which keeps the forecast "
        "from being meaningfully worse than it, but it does not make +1 h a strong forecast.",
        "- Per-window spread is large at some stations (see 'mean ± std'). Each window is only about "
        "10% of ~90 days of data, so a single window can contain one pollution episode that dominates its "
        "error. Treat differences of a few percent as noise.",
        "- Nearby-station inputs only exist where another station within 25 km reports live PM2.5. Many "
        "stations have none, so for them the spatial part comes only from the regional model.",
        "- The regional model (CAMS) is a model, not a measurement, and the weather inputs at the target hour "
        "are weather *forecasts*; training uses analysed past weather, a small optimistic bias at longer horizons.",
        "- Forecast uncertainty bands come from the empirical 10th and 90th percentile of out-of-window "
        "residuals; their calibration was not separately verified.",
        "- This is a temporal and local-spatial forecast built on station data. It is not validated for use "
        "in health or safety decisions.",
        "",
    ]
    with open("FORECAST_EVALUATION.md", "w", encoding="utf-8") as f:
        f.write("\n".join(L))
    print("wrote FORECAST_EVALUATION.md", flush=True)


if __name__ == "__main__":
    main()
