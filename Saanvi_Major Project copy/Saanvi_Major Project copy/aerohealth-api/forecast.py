"""
Spatio-temporal PM2.5 forecast for the next 24 hours at the monitoring station nearest a location.

Inputs (all real data)
  * temporal: ~90 days of hourly PM2.5 at that station (OpenAQ v3 /hours)
  * weather: Open-Meteo history and weather forecast at the station
  * spatial (a): PM2.5 at up to 3 other stations within 25 km (OpenAQ)
  * spatial (b): PM2.5 from the CAMS regional air-quality model on a grid (Open-Meteo), including
                 its own forecast for the coming days
The spatial inputs are optional: when a station has no neighbours or the regional model is
unreachable, the forecast simply runs without them.

Method
  One gradient-boosted model per horizon (+1 h ... +24 h) predicts the change from the current value.
  The served forecast is a weighted mix of that model, "same hour yesterday" and "same as now";
  the mix is chosen per horizon by validation INSIDE the training window, never on test data.

Evaluation
  Rolling-origin cross-validation: the first 50% of the history is always training, the remaining
  50% is cut into 4 consecutive test windows, and each window is forecast by a model trained only on
  data before it (expanding window, no shuffling, no target-time overlap). Reported with the spread
  across windows and compared against two baselines: persistence and same-hour-yesterday.
"""
from __future__ import annotations

import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

import httpx
import numpy as np
import pandas as pd
from xgboost import XGBRegressor

import aqi as aqi_mod

HORIZONS = list(range(1, 25))
EVAL_HORIZONS = [1, 3, 6, 12, 24]
LAGS = [0, 1, 2, 3, 6, 12, 24, 48]
WEATHER_VARS = [
    "temperature_2m",
    "relative_humidity_2m",
    "wind_speed_10m",
    "precipitation",
    "surface_pressure",
]
HISTORY_DAYS = 90             # Open-Meteo serves at most 92 days of past data per call
MIN_OBSERVED_HOURS = 300      # need at least ~12 days of hourly data
MAX_STALE_HOURS = 6
MAX_NEIGHBOURS = 3
MIN_NEIGHBOUR_OVERLAP = 0.5   # a neighbour must report in at least half the target's hours
N_FOLDS = 4
FIRST_TRAIN_FRACTION = 0.5
INNER_VALID_FRACTION = 0.2    # last part of each training window, used only to pick the mix
MIN_INNER_VALID = 60
CACHE_TTL_S = 3600

_cache: Dict[int, Tuple[float, dict]] = {}                       # station -> (when, finished forecast)
_area_cache: Dict[Tuple[float, float], Tuple[float, int]] = {}   # ~1 km area -> (when, station)
_station_locks: Dict[int, threading.Lock] = {}
_lock = threading.Lock()

# Protection for the shared OpenAQ key and the CPU: a cold build downloads a lot and trains ~50 models.
AREA_PRECISION = 2            # decimal places of lat/lon used to recognise "the same place again" (~1 km)
MAX_CONCURRENT_BUILDS = 2     # heavy builds running at the same time; others wait their turn
MAX_CACHED = 200              # entries kept in each cache
_build_slots = threading.BoundedSemaphore(MAX_CONCURRENT_BUILDS)


def _station_lock(sensor_id: int) -> threading.Lock:
    """One lock per station: concurrent requests for the same station share a single build."""
    with _lock:
        return _station_locks.setdefault(sensor_id, threading.Lock())


def _remember(store: dict, key, value) -> None:
    """Insert and keep the cache bounded (oldest entries go first)."""
    with _lock:
        store[key] = value
        if len(store) > MAX_CACHED:
            for old in sorted(store, key=lambda k: store[k][0])[: len(store) - MAX_CACHED]:
                store.pop(old, None)


class ForecastUnavailable(Exception):
    """No usable station / history for this location."""


@dataclass
class Inputs:
    station: dict
    pm: pd.Series                                  # hourly, regular index, NaN where missing
    wx: pd.DataFrame                               # weather, reaches ~3 days past `pm`
    cams: Optional[pd.Series] = None               # regional model PM2.5, reaches into the future
    neighbours: Dict[str, pd.Series] = field(default_factory=dict)  # name -> PM2.5 on pm's index


# --------------------------------------------------------------------------- data


def _parse_utc(text: str) -> pd.Timestamp:
    return pd.Timestamp(text).tz_convert("UTC").tz_localize(None)


def _get(client: httpx.Client, url: str, params: Optional[dict] = None, tries: int = 3) -> httpx.Response:
    """GET with polite retry on OpenAQ's rate limit (429). Waits at most ~30 s in total, then gives up."""
    for attempt in range(tries):
        resp = client.get(url, params=params)
        if resp.status_code == 429:
            try:
                wait = float(resp.headers.get("retry-after", ""))
            except ValueError:
                wait = 5.0 * (attempt + 1)
            time.sleep(min(wait, 10.0))
            continue
        resp.raise_for_status()
        return resp
    raise ForecastUnavailable("The air-quality data service is rate-limiting requests; try again in a minute.")


def _fresh_pm25_sensor(client: httpx.Client, loc: dict, now: pd.Timestamp) -> Optional[int]:
    """The PM2.5 sensor of this station that reported within MAX_STALE_HOURS (old instruments are skipped)."""
    pm_ids = {
        s["id"]
        for s in loc.get("sensors", [])
        if ((s.get("parameter") or {}).get("name", "").lower() in ("pm25", "pm2.5"))
    }
    if not pm_ids:
        return None
    latest = _get(client, f"{aqi_mod.OPENAQ_BASE}/locations/{loc['id']}/latest").json()
    fresh = []
    for item in latest.get("results") or []:
        if item.get("sensorsId") in pm_ids and item.get("value") is not None:
            utc = (item.get("datetime") or {}).get("utc")
            if utc:
                fresh.append((_parse_utc(utc), item["sensorsId"]))
    if not fresh:
        return None
    when, sensor_id = max(fresh)
    return sensor_id if (now - when) <= pd.Timedelta(hours=MAX_STALE_HOURS) else None


def _discover(client: httpx.Client, lat: float, lon: float) -> Tuple[dict, List[dict]]:
    """Nearest station with live PM2.5, plus up to MAX_NEIGHBOURS more within the same search radius."""
    resp = _get(
        client,
        f"{aqi_mod.OPENAQ_BASE}/locations",
        {"coordinates": f"{lat},{lon}", "radius": str(aqi_mod.SEARCH_RADIUS_M), "limit": 12},
    )
    now = pd.Timestamp.now("UTC").tz_localize(None)
    found: List[dict] = []
    for loc in resp.json().get("results") or []:
        sensor_id = _fresh_pm25_sensor(client, loc, now)
        if sensor_id is None:
            continue
        coords = loc.get("coordinates") or {}
        found.append(
            {
                "sensor_id": sensor_id,
                "station": loc.get("name") or "OpenAQ station",
                "lat": coords.get("latitude", lat),
                "lon": coords.get("longitude", lon),
            }
        )
        if len(found) >= 1 + MAX_NEIGHBOURS:
            break
    if not found:
        raise ForecastUnavailable("No monitoring station with live PM2.5 near this location.")
    return found[0], found[1:]


def _hourly_pm25(client: httpx.Client, sensor_id: int, days: int) -> pd.Series:
    now = datetime.now(timezone.utc)
    frm = (now - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    to = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    rows: List[dict] = []
    for page in range(1, 8):
        resp = _get(
            client,
            f"{aqi_mod.OPENAQ_BASE}/sensors/{sensor_id}/hours",
            {"datetime_from": frm, "datetime_to": to, "limit": 1000, "page": page},
        )
        batch = resp.json().get("results") or []
        rows += batch
        if len(batch) < 1000:
            break

    values: Dict[pd.Timestamp, List[float]] = {}
    for row in rows:
        value = row.get("value")
        end = ((row.get("period") or {}).get("datetimeTo") or {}).get("utc")
        if value is None or not end or value < 0 or value > 1000:
            continue
        values.setdefault(_parse_utc(end).floor("h"), []).append(float(value))
    if not values:
        raise ForecastUnavailable("The station has no recent hourly PM2.5 history.")
    series = pd.Series({ts: float(np.mean(v)) for ts, v in values.items()}).sort_index()
    return series.reindex(pd.date_range(series.index.min(), series.index.max(), freq="h"))


def _weather(client: httpx.Client, lat: float, lon: float, days: int) -> pd.DataFrame:
    resp = client.get(
        "https://api.open-meteo.com/v1/forecast",
        params={
            "latitude": lat,
            "longitude": lon,
            "past_days": min(days, 92),
            "forecast_days": 3,
            "hourly": ",".join(WEATHER_VARS),
            "timezone": "UTC",
        },
    )
    resp.raise_for_status()
    df = pd.DataFrame(resp.json()["hourly"])
    df.index = pd.to_datetime(df.pop("time"))
    return df.astype(float).reindex(pd.date_range(df.index.min(), df.index.max(), freq="h"))


def _cams(client: httpx.Client, lat: float, lon: float, days: int) -> Optional[pd.Series]:
    """Regional air-quality model PM2.5 (CAMS via Open-Meteo): a gridded, forecastable spatial signal."""
    try:
        resp = client.get(
            "https://air-quality-api.open-meteo.com/v1/air-quality",
            params={
                "latitude": lat,
                "longitude": lon,
                "hourly": "pm2_5",
                "past_days": min(days, 92),
                "forecast_days": 3,
                "timezone": "UTC",
            },
        )
        resp.raise_for_status()
        h = resp.json()["hourly"]
        s = pd.Series(h["pm2_5"], index=pd.to_datetime(h["time"]), dtype=float)
        return s if s.notna().sum() > 100 else None
    except Exception:
        return None  # optional input: forecast still works without it


def fetch_inputs(client: httpx.Client, target: dict, neighbours: List[dict], days: int) -> Inputs:
    pm = _hourly_pm25(client, target["sensor_id"], days)
    observed = int(pm.notna().sum())
    if observed < MIN_OBSERVED_HOURS:
        raise ForecastUnavailable(
            f"Only {observed} hours of PM2.5 history at this station; need {MIN_OBSERVED_HOURS}."
        )
    def pull(n: dict) -> Optional[pd.Series]:
        try:
            return _hourly_pm25(client, n["sensor_id"], days).reindex(pm.index)
        except (ForecastUnavailable, httpx.HTTPError):
            return None

    nb: Dict[str, pd.Series] = {}
    if neighbours:
        with ThreadPoolExecutor(max_workers=len(neighbours)) as pool:  # independent downloads
            pulled = list(pool.map(pull, neighbours))
        for n, s in zip(neighbours, pulled):
            if s is None:
                continue
            overlap = float((s.notna() & pm.notna()).sum()) / max(1, int(pm.notna().sum()))
            if overlap >= MIN_NEIGHBOUR_OVERLAP:
                nb[n["station"]] = s
    # Separate client: the OpenAQ key header must not be sent to Open-Meteo.
    with httpx.Client(timeout=httpx.Timeout(30.0, connect=6.0)) as plain:
        wx = _weather(plain, target["lat"], target["lon"], days)
        cams = _cams(plain, target["lat"], target["lon"], days)
    return Inputs(station=target, pm=pm, wx=wx, cams=cams, neighbours=nb)


# ------------------------------------------------------------------------ features


def _neighbour_mean(inp: Inputs) -> Optional[pd.Series]:
    if not inp.neighbours:
        return None
    return pd.DataFrame(inp.neighbours).mean(axis=1)  # NaN-safe mean over stations reporting that hour


def _base_features(inp: Inputs) -> pd.DataFrame:
    """
    Level (pm_lag0) plus *relative* history. The model predicts the change from the current
    value, so features are differences from now; this lets it cope with seasonal level shifts
    (monsoon to winter) that trees cannot extrapolate to in absolute terms.
    """
    pm, wx = inp.pm, inp.wx
    f = pd.DataFrame(index=pm.index)
    f["pm_lag0"] = pm
    for k in LAGS:
        if k:
            f[f"pm_lag{k}"] = pm.shift(k) - pm
    f["pm_mean6"] = pm.rolling(6, min_periods=3).mean() - pm
    f["pm_mean24"] = pm.rolling(24, min_periods=8).mean() - pm
    f["pm_mean168"] = pm.rolling(168, min_periods=48).mean() - pm
    f["pm_std24"] = pm.rolling(24, min_periods=8).std()
    f["pm_trend3"] = pm - pm.shift(3)
    for col in ("temperature_2m", "wind_speed_10m", "relative_humidity_2m"):
        f[f"{col}_now"] = wx[col].reindex(pm.index).to_numpy()

    nb = _neighbour_mean(inp)
    f["nb_rel0"] = (nb - pm) if nb is not None else np.nan          # are neighbours dirtier or cleaner now?
    f["nb_trend3"] = (nb - nb.shift(3)) if nb is not None else np.nan  # is the air nearby getting worse?
    f["cams_rel0"] = (inp.cams.reindex(pm.index) - pm) if inp.cams is not None else np.nan
    return f


def _horizon_features(base: pd.DataFrame, inp: Inputs, h: int) -> pd.DataFrame:
    pm, wx = inp.pm, inp.wx
    target_time = base.index + pd.Timedelta(hours=h)
    X = base.copy()
    # PM2.5 at the *target hour* on each of the last 3 days, relative to now
    # (pm.shift(24 - h) is "same hour yesterday" for this horizon).
    days = {}
    for d in (1, 2, 3):
        days[f"pm_tgt_day{d}"] = (pm.shift(24 * d - h) - pm).reindex(base.index)
        X[f"pm_tgt_day{d}"] = days[f"pm_tgt_day{d}"].to_numpy()
    X["pm_tgt_mean3d"] = pd.DataFrame(days).mean(axis=1).to_numpy()
    X["hour_sin"] = np.sin(2 * np.pi * target_time.hour / 24)
    X["hour_cos"] = np.cos(2 * np.pi * target_time.hour / 24)
    X["dow"] = target_time.dayofweek
    for col in WEATHER_VARS:
        X[f"{col}_tgt"] = wx[col].reindex(target_time).to_numpy()
    X["d_temp"] = X["temperature_2m_tgt"] - X["temperature_2m_now"]
    X["d_wind"] = X["wind_speed_10m_tgt"] - X["wind_speed_10m_now"]
    if inp.cams is not None:
        c_now = inp.cams.reindex(base.index).to_numpy()
        c_tgt = inp.cams.reindex(target_time).to_numpy()
        X["cams_delta_tgt"] = c_tgt - c_now                          # forecast change in the regional model
        X["cams_ratio_tgt"] = c_tgt / np.maximum(c_now, 1.0)
    else:
        X["cams_delta_tgt"] = np.nan
        X["cams_ratio_tgt"] = np.nan
    return X


# Deliberately small and heavily regularised: the signal beyond "same as now" is weak,
# and deeper models overfit short station histories.
PARAMS = dict(
    objective="reg:squarederror",
    n_estimators=80,
    max_depth=2,
    learning_rate=0.05,
    subsample=0.8,
    colsample_bytree=0.6,
    min_child_weight=15,
    reg_lambda=5.0,
)


def _new_model() -> XGBRegressor:
    return XGBRegressor(**PARAMS, n_jobs=1, random_state=7)


# ------------------------------------------------------------- mixing the forecasts

# Weights on (model, same-hour-yesterday, same-as-now). Model-heavy combinations come first so that
# ties and near-ties keep the model.
WEIGHT_GRID: List[Tuple[float, float, float]] = [
    (wm, wy, round(1.0 - wm - wy, 2))
    for wm in (1.0, 0.75, 0.5, 0.25, 0.0)
    for wy in (0.0, 0.25, 0.5, 0.75, 1.0)
    if wm + wy <= 1.0 + 1e-9
]


def _combine(w: Tuple[float, float, float], model_pred, yday, level):
    yd = np.where(np.isnan(yday), model_pred, yday)  # no yesterday available -> fall back to the model
    return np.clip(w[0] * model_pred + w[1] * yd + w[2] * level, 0, None)


def _train_with_weights(X, y, yday, level, rows, h: int):
    """
    Fit on `rows` (a boolean Series of usable training origins) and choose the mix weights on the
    last INNER_VALID_FRACTION of those rows with a model that never saw them. Test data is never touched.
    """
    idx = X.index[rows]
    n = len(idx)
    weights = (1.0, 0.0, 0.0)  # until validation says otherwise, trust the model alone
    n_val = max(MIN_INNER_VALID, int(n * INNER_VALID_FRACTION))
    if n - n_val >= 100:
        val_start = idx[n - n_val]
        inner = rows & (X.index < val_start - pd.Timedelta(hours=h))
        val = rows & (X.index >= val_start) & yday.notna().to_numpy()
        if inner.sum() >= 80 and val.sum() >= 30:
            m_in = _new_model().fit(X[inner], (y - level)[inner])
            lv = level[val].to_numpy()
            mp = np.clip(lv + m_in.predict(X[val]), 0, None)
            yt, yd = y[val].to_numpy(), yday[val].to_numpy()
            best, best_mae = weights, np.inf
            for cand in WEIGHT_GRID:
                mae = float(np.mean(np.abs(yt - (cand[0] * mp + cand[1] * yd + cand[2] * lv))))
                if mae < best_mae * 0.99:  # must be clearly better to displace an earlier (model-heavier) mix
                    best, best_mae = cand, mae
            weights = best
    model = _new_model().fit(X[rows], (y - level)[rows])
    return model, weights


# ----------------------------------------------------------------------- evaluation


def _mae(y: np.ndarray, p: np.ndarray) -> float:
    return float(np.mean(np.abs(y - p)))


def _metrics(y: np.ndarray, p: np.ndarray) -> Tuple[float, float, float]:
    err = y - p
    rmse = float(np.sqrt(np.mean(err**2)))
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    r2 = float(1 - np.sum(err**2) / ss_tot) if ss_tot > 0 else float("nan")
    return float(np.mean(np.abs(err))), rmse, r2


def _skills(mae_f, mae_f_sub, mae_p, mae_y) -> Tuple[Optional[float], Optional[float], Optional[float]]:
    sp = 100 * (1 - mae_f / mae_p) if mae_p > 0 else None
    sy = 100 * (1 - mae_f_sub / mae_y) if mae_y is not None and mae_y > 0 else None
    cand = [s for s in (sp, sy) if s is not None]
    return sp, sy, (min(cand) if cand else None)


def _cv_horizon(inp: Inputs, base: pd.DataFrame, h: int) -> Optional[dict]:
    """Rolling-origin cross-validation for one horizon."""
    X = _horizon_features(base, inp, h)
    pm = inp.pm
    y = pm.shift(-h)
    yday = pm.shift(24 - h)
    level = X["pm_lag0"]
    ok = y.notna() & level.notna()
    origins = X.index[ok]
    n = len(origins)
    if n < 300:
        return None
    first = int(n * FIRST_TRAIN_FRACTION)
    edges = np.linspace(first, n, N_FOLDS + 1).astype(int)

    folds = []
    pooled = {k: [] for k in ("y", "f", "m", "p", "yd")}
    for k in range(N_FOLDS):
        t0 = origins[edges[k]]
        t1 = origins[edges[k + 1]] if edges[k + 1] < n else None
        test = ok & (X.index >= t0)
        if t1 is not None:
            test = test & (X.index < t1)
        train = ok & (X.index < t0 - pd.Timedelta(hours=h))  # no target-time overlap with the test window
        if train.sum() < 150 or test.sum() < 25:
            continue
        model, w = _train_with_weights(X, y, yday, level, train, h)
        lv = level[test].to_numpy()
        mp = np.clip(lv + model.predict(X[test]), 0, None)
        yd = yday[test].to_numpy()
        f = _combine(w, mp, yd, lv)
        yt = y[test].to_numpy()
        has_y = ~np.isnan(yd)
        mae_f = _mae(yt, f)
        mae_y = _mae(yt[has_y], yd[has_y]) if has_y.sum() >= 15 else None
        mae_f_sub = _mae(yt[has_y], f[has_y]) if has_y.sum() >= 15 else None
        _, _, best = _skills(mae_f, mae_f_sub, _mae(yt, lv), mae_y)
        folds.append({"skill_best": best, "weights": w, "n": int(test.sum())})
        for key, arr in (("y", yt), ("f", f), ("m", mp), ("p", lv), ("yd", yd)):
            pooled[key].append(arr)
    if len(folds) < 2:
        return None

    Y, F, M, P, YD = (np.concatenate(pooled[k]) for k in ("y", "f", "m", "p", "yd"))
    has_y = ~np.isnan(YD)
    mae, rmse, r2 = _metrics(Y, F)
    p_mae = _mae(Y, P)
    y_mae = _mae(Y[has_y], YD[has_y]) if has_y.sum() >= 30 else None
    f_sub = _mae(Y[has_y], F[has_y]) if has_y.sum() >= 30 else None
    sp, sy, best = _skills(mae, f_sub, p_mae, y_mae)
    fold_skills = [f["skill_best"] for f in folds if f["skill_best"] is not None]
    resid = Y - F
    wm = np.mean([f["weights"] for f in folds], axis=0)
    return {
        "mae": round(mae, 2),
        "rmse": round(rmse, 2),
        "r2": round(r2, 3),
        "model_only_mae": round(_mae(Y, M), 2),
        "persistence_mae": round(p_mae, 2),
        "seasonal_naive_mae": None if y_mae is None else round(y_mae, 2),
        "skill_vs_persistence_pct": None if sp is None else round(sp, 1),
        "skill_vs_seasonal_pct": None if sy is None else round(sy, 1),
        "skill_vs_best_baseline_pct": None if best is None else round(best, 1),
        "folds": len(folds),
        "fold_skill_mean_pct": round(float(np.mean(fold_skills)), 1) if fold_skills else None,
        "fold_skill_std_pct": round(float(np.std(fold_skills)), 1) if fold_skills else None,
        "folds_beating_best_baseline": int(sum(1 for s in fold_skills if s > 0)),
        "mean_weights": {"model": round(float(wm[0]), 2), "yesterday": round(float(wm[1]), 2), "now": round(float(wm[2]), 2)},
        "test_points": int(len(Y)),
        "_q10": float(np.quantile(resid, 0.10)),
        "_q90": float(np.quantile(resid, 0.90)),
    }


def evaluate_inputs(inp: Inputs, use_neighbours: bool = True, use_cams: bool = True) -> Dict[str, dict]:
    """Cross-validated evaluation only (no serving fit). Flags allow clean ablations."""
    variant = replace(
        inp,
        neighbours=inp.neighbours if use_neighbours else {},
        cams=inp.cams if use_cams else None,
    )
    base = _base_features(variant)
    out: Dict[str, dict] = {}
    for h in EVAL_HORIZONS:
        ev = _cv_horizon(variant, base, h)
        if ev:
            ev.pop("_q10"), ev.pop("_q90")
            out[str(h)] = ev
    return out


# --------------------------------------------------------------------------- serving

_GROUPS = {
    "Recent PM2.5 (last few hours)": ("pm_lag0", "pm_lag1", "pm_lag2", "pm_lag3", "pm_mean6", "pm_trend3"),
    "Yesterday's pattern": (
        "pm_lag6", "pm_lag12", "pm_lag24", "pm_lag48", "pm_mean24", "pm_mean168", "pm_std24",
        "pm_tgt_day1", "pm_tgt_day2", "pm_tgt_day3", "pm_tgt_mean3d",
    ),
    "Time of day / week": ("hour_sin", "hour_cos", "dow"),
    "Nearby stations": ("nb_rel0", "nb_trend3"),
    "Regional air-quality model": ("cams_rel0", "cams_delta_tgt", "cams_ratio_tgt"),
}


def _driver_shares(model: XGBRegressor) -> List[dict]:
    """Share of the model's learned splits (gain) per family of inputs."""
    gain = model.get_booster().get_score(importance_type="gain")
    totals = {name: 0.0 for name in _GROUPS}
    totals["Weather"] = 0.0
    for feat, g in gain.items():
        for name, members in _GROUPS.items():
            if feat in members:
                totals[name] += g
                break
        else:
            totals["Weather"] += g
    s = sum(totals.values()) or 1.0
    return sorted(
        ({"factor": k, "share_pct": round(100 * v / s, 1)} for k, v in totals.items() if v > 0),
        key=lambda d: -d["share_pct"],
    )


def forecast_from_inputs(inp: Inputs, history_days: int = HISTORY_DAYS) -> dict:
    """Cross-validate, train, and forecast. Pure computation on already-downloaded inputs."""
    pm = inp.pm
    observed = int(pm.notna().sum())
    base = _base_features(inp)
    t_last = pm.dropna().index.max()

    # Every horizon is an independent model. XGBoost releases the GIL while fitting, so threads give
    # a real speed-up (a cold call otherwise spends ~20 s training 48 small models one by one).
    workers = max(1, min(8, os.cpu_count() or 2))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        cv_results = list(pool.map(lambda h: _cv_horizon(inp, base, h), EVAL_HORIZONS))

    evaluation: Dict[str, dict] = {}
    intervals: Dict[int, Tuple[float, float]] = {}
    for h, ev in zip(EVAL_HORIZONS, cv_results):
        if ev:
            intervals[h] = (ev.pop("_q10"), ev.pop("_q90"))
            evaluation[str(h)] = ev

    origin_row = base.loc[[t_last]]

    def serve(h: int):
        X = _horizon_features(base, inp, h)
        y = pm.shift(-h)
        yday_s = pm.shift(24 - h)
        level = X["pm_lag0"]
        ok = y.notna() & level.notna()
        if ok.sum() < 150:
            return None
        model, w = _train_with_weights(X, y, yday_s, level, ok, h)
        xr = _horizon_features(origin_row, inp, h)
        lv = xr["pm_lag0"].to_numpy()
        mp = np.clip(lv + model.predict(xr), 0, None)
        yd = np.array([yday_s.get(t_last, np.nan)], dtype=float)
        value = float(_combine(w, mp, yd, lv)[0])
        nearest = min(intervals, key=lambda e: abs(e - h)) if intervals else None
        q10, q90 = intervals[nearest] if nearest else (-0.25 * value, 0.25 * value)
        target_time = t_last + pd.Timedelta(hours=h)
        return model, {
            "hours_ahead": h,
            "time": target_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "pm25": round(value, 1),
            "lower": round(max(0.0, value + q10), 1),
            "upper": round(value + q90, 1),
            "aqi": round(aqi_mod._pm25_to_aqi(value)),
        }

    with ThreadPoolExecutor(max_workers=workers) as pool:
        served = list(pool.map(serve, HORIZONS))
    forecast: List[dict] = []
    models: Dict[int, XGBRegressor] = {}
    for h, item in zip(HORIZONS, served):
        if item:
            models[h], point = item
            forecast.append(point)
    if not forecast:
        raise ForecastUnavailable("Not enough history to train a forecast model.")

    drivers = _driver_shares(models.get(12) or models[max(models)])
    recent = pm.dropna().iloc[-72:]
    now = pd.Timestamp.now("UTC").tz_localize(None)
    future = [f for f in forecast if pd.Timestamp(f["time"][:-1]) > now] or forecast
    best = min(future, key=lambda f: f["pm25"])
    worst = max(future, key=lambda f: f["pm25"])

    sources = ["OpenAQ v3 (PM2.5 history)", "Open-Meteo (weather history and forecast)"]
    if inp.cams is not None:
        sources.append("CAMS regional air-quality model via Open-Meteo")
    if inp.neighbours:
        sources.append(f"{len(inp.neighbours)} nearby OpenAQ station(s)")

    return {
        "station": inp.station["station"],
        "sensor_id": inp.station["sensor_id"],
        "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "last_observed": {
            "time": t_last.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "pm25": round(float(pm[t_last]), 1),
        },
        "forecast": forecast,
        "history": [
            {"time": ts.strftime("%Y-%m-%dT%H:%M:%SZ"), "pm25": round(float(v), 1)}
            for ts, v in recent.items()
        ],
        "summary": {"best": best, "worst": worst},
        "drivers": drivers,
        "spatial": {
            "neighbour_stations": list(inp.neighbours.keys()),
            "regional_model": "CAMS (Open-Meteo)" if inp.cams is not None else None,
        },
        "evaluation": {
            "method": (
                f"rolling-origin cross-validation: the first {int(FIRST_TRAIN_FRACTION * 100)}% of the "
                f"history is always training; the rest is {N_FOLDS} consecutive test windows, each "
                "forecast by a model trained only on earlier data"
            ),
            "baselines": ["persistence (same as now)", "same hour yesterday"],
            "observed_hours": observed,
            "coverage_pct": round(100 * observed / len(pm), 1),
            "history_days": history_days,
            "horizons": evaluation,
        },
        "data_sources": sources,
        "model": "XGBoost per horizon (+1h to +24h), mixed with same-hour-yesterday / same-as-now by validation",
    }


def build_forecast(lat: float, lon: float, history_days: int = HISTORY_DAYS) -> dict:
    """Fetch data, evaluate, train and forecast. Blocking (several seconds on a cold call)."""
    headers = aqi_mod._openaq_headers()
    if headers is None:
        raise ForecastUnavailable("OPENAQ_API_KEY is not configured on the server.")

    # 1) Fast path: this area was forecast recently, so answer from memory with no outside request.
    area = (round(lat, AREA_PRECISION), round(lon, AREA_PRECISION))
    seen = _area_cache.get(area)
    if seen and time.time() - seen[0] < CACHE_TTL_S:
        done = _cache.get(seen[1])
        if done and time.time() - done[0] < CACHE_TTL_S:
            return done[1]

    with httpx.Client(timeout=httpx.Timeout(30.0, connect=6.0), headers=headers) as client:
        target, neighbours = _discover(client, lat, lon)
        sensor_id = target["sensor_id"]
        _remember(_area_cache, area, (time.time(), sensor_id))

        # 2) One build per station: requests that arrive meanwhile wait for it and reuse the result.
        with _station_lock(sensor_id):
            done = _cache.get(sensor_id)
            if done and time.time() - done[0] < CACHE_TTL_S:
                return done[1]
            # 3) At most MAX_CONCURRENT_BUILDS heavy builds at once, so many different places cannot
            #    exhaust the CPU or the OpenAQ key's request quota.
            with _build_slots:
                inp = fetch_inputs(client, target, neighbours, history_days)
                result = forecast_from_inputs(inp, history_days)
            _remember(_cache, sensor_id, (time.time(), result))
            return result
