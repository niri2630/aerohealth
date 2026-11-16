# PM2.5 forecast evaluation

Generated 2026-11-15 23:09 UTC by `evaluate_forecast.py`.

## Method

**Data.** About 90 days of hourly PM2.5 per station (OpenAQ), weather history and forecast (Open-Meteo), up to three other stations within 25 km (OpenAQ), and the CAMS regional air-quality model on a grid (via Open-Meteo, which also forecasts ahead). The spatial inputs are optional per station.

**Model.** One small gradient-boosted model per horizon predicts the *change* from the current value. The served forecast is a weighted mix of that model, 'same hour yesterday' and 'same as now'. The mix is chosen per horizon by validation inside each training window.

**Evaluation.** Rolling-origin cross-validation: the first 50% of the history is always training; the remaining 50% is cut into four consecutive test windows, and each is forecast by a model trained only on earlier data, with no shuffling and no target-time overlap. Errors are in µg/m³. 'Skill' = 1 - MAE(forecast) / MAE(baseline); positive means we beat the baseline. 'Harder baseline' is whichever of 'same as now' or 'same hour yesterday' had the lower error; at +24 h the two are identical. 'Windows won' counts test windows in which the forecast beat the harder baseline.

**Which stations to trust.** The development stations were used while the design was being built (choosing features, model settings and whether to keep the spatial inputs), so they are optimistic. The fresh stations were first looked at after the design was frozen, and the design was not changed afterwards. They are the fair test.

## Fresh stations (design frozen before they were first run)

### Summary (9 stations: Hyderabad, Pune, Lucknow, Ahmedabad, Patna, Jaipur, Chandigarh, Los Angeles, Bangkok)

| Horizon | Mean skill vs same-as-now | Mean skill vs same-hour-yesterday | Mean skill vs harder baseline | Stations ahead of harder baseline | Windows won (all stations) |
|---|---|---|---|---|---|
| +1 h | 9.2% | 66.0% | 9.2% | 7 / 9 | 32 / 36 |
| +3 h | 13.3% | 35.1% | 12.7% | 8 / 9 | 30 / 36 |
| +6 h | 21.9% | 20.3% | 8.4% | 8 / 9 | 25 / 36 |
| +12 h | 27.9% | 12.1% | 6.9% | 9 / 9 | 22 / 36 |
| +24 h | 10.4% | 10.4% | 10.4% | 9 / 9 | 33 / 36 |

### Hyderabad: Zoo Park, Hyderabad - TSPCB

1756 observed hours; 3 nearby station(s); regional model yes.

| Horizon | Forecast MAE | Same as now | Same hour yesterday | Skill vs harder baseline (pooled) | Per-window skill, mean ± std | Windows beating baseline |
|---|---|---|---|---|---|---|
| +1 h | 4.42 | 5.08 | 12.29 | 13.2% | 12.7% ± 4.0 | 4 / 4 |
| +3 h | 9.98 | 11.54 | 12.19 | 13.5% | 1.6% ± 12.4 | 2 / 4 |
| +6 h | 11.76 | 16.13 | 11.92 | 2.2% | -7.6% ± 16.5 | 2 / 4 |
| +12 h | 11.46 | 14.95 | 11.82 | 3.3% | 0.7% ± 11.6 | 3 / 4 |
| +24 h | 11.08 | 12.33 | 12.33 | 10.1% | 8.6% ± 5.4 | 4 / 4 |

### Pune: Mhada Colony, Pune - IITM

1750 observed hours; 3 nearby station(s); regional model yes.

| Horizon | Forecast MAE | Same as now | Same hour yesterday | Skill vs harder baseline (pooled) | Per-window skill, mean ± std | Windows beating baseline |
|---|---|---|---|---|---|---|
| +1 h | 8.43 | 9.37 | 24.92 | 10.0% | 12.4% ± 4.1 | 4 / 4 |
| +3 h | 15.63 | 19.06 | 25.64 | 18.0% | 18.0% ± 6.3 | 4 / 4 |
| +6 h | 21.21 | 30.83 | 25.60 | 17.6% | 10.0% ± 15.9 | 3 / 4 |
| +12 h | 26.45 | 40.89 | 25.58 | 0.6% | 1.5% ± 7.7 | 2 / 4 |
| +24 h | 23.75 | 25.12 | 25.12 | 5.5% | 10.4% ± 6.0 | 4 / 4 |

### Lucknow: Talkatora District Industries Center, Lucknow - CPCB

1929 observed hours; 3 nearby station(s); regional model yes.

| Horizon | Forecast MAE | Same as now | Same hour yesterday | Skill vs harder baseline (pooled) | Per-window skill, mean ± std | Windows beating baseline |
|---|---|---|---|---|---|---|
| +1 h | 10.10 | 10.77 | 27.95 | 6.2% | 5.8% ± 1.1 | 4 / 4 |
| +3 h | 19.77 | 24.22 | 26.85 | 18.4% | 6.3% ± 12.3 | 3 / 4 |
| +6 h | 25.76 | 35.30 | 28.50 | 9.7% | -2.1% ± 20.8 | 3 / 4 |
| +12 h | 28.33 | 39.66 | 29.23 | 1.5% | -6.0% ± 19.0 | 3 / 4 |
| +24 h | 26.71 | 28.66 | 28.66 | 6.8% | 6.7% ± 1.3 | 4 / 4 |

### Ahmedabad: Maninagar, Ahmedabad - GPCB

1784 observed hours; 3 nearby station(s); regional model yes.

| Horizon | Forecast MAE | Same as now | Same hour yesterday | Skill vs harder baseline (pooled) | Per-window skill, mean ± std | Windows beating baseline |
|---|---|---|---|---|---|---|
| +1 h | 11.34 | 12.77 | 26.43 | 11.2% | 11.8% ± 3.7 | 4 / 4 |
| +3 h | 20.65 | 28.06 | 26.39 | 22.3% | 16.6% ± 4.6 | 4 / 4 |
| +6 h | 22.78 | 37.08 | 25.98 | 13.2% | 14.4% ± 8.0 | 4 / 4 |
| +12 h | 24.10 | 43.51 | 26.57 | 9.7% | 9.5% ± 13.0 | 2 / 4 |
| +24 h | 21.75 | 26.23 | 26.23 | 17.1% | 16.5% ± 7.6 | 4 / 4 |

### Patna: IGSC Planetarium Complex, Patna - BSPCB

1258 observed hours; 3 nearby station(s); regional model yes.

| Horizon | Forecast MAE | Same as now | Same hour yesterday | Skill vs harder baseline (pooled) | Per-window skill, mean ± std | Windows beating baseline |
|---|---|---|---|---|---|---|
| +1 h | 12.31 | 12.27 | 68.59 | -0.3% | 0.4% ± 1.0 | 2 / 4 |
| +3 h | 31.87 | 25.69 | 69.99 | -24.1% | -8.4% ± 16.7 | 2 / 4 |
| +6 h | 45.45 | 36.28 | 67.51 | -25.3% | -10.9% ± 16.1 | 1 / 4 |
| +12 h | 53.12 | 53.28 | 63.48 | 0.3% | 0.4% ± 4.2 | 1 / 4 |
| +24 h | 64.75 | 68.41 | 68.41 | 5.4% | 8.5% ± 3.4 | 4 / 4 |

### Jaipur: Shastri Nagar, Jaipur - RSPCB

1793 observed hours; 3 nearby station(s); regional model yes.

| Horizon | Forecast MAE | Same as now | Same hour yesterday | Skill vs harder baseline (pooled) | Per-window skill, mean ± std | Windows beating baseline |
|---|---|---|---|---|---|---|
| +1 h | 7.63 | 8.47 | 17.27 | 10.0% | 9.6% ± 2.9 | 4 / 4 |
| +3 h | 14.04 | 17.96 | 17.28 | 21.1% | 12.3% ± 6.4 | 4 / 4 |
| +6 h | 16.79 | 24.79 | 17.17 | 6.3% | 6.2% ± 14.7 | 2 / 4 |
| +12 h | 16.18 | 24.21 | 16.85 | 6.3% | 6.5% ± 10.0 | 2 / 4 |
| +24 h | 15.05 | 17.17 | 17.17 | 12.4% | 12.1% ± 6.2 | 4 / 4 |

### Chandigarh: Sector-6, Panchkula - HSPCB

1752 observed hours; 3 nearby station(s); regional model yes.

| Horizon | Forecast MAE | Same as now | Same hour yesterday | Skill vs harder baseline (pooled) | Per-window skill, mean ± std | Windows beating baseline |
|---|---|---|---|---|---|---|
| +1 h | 6.04 | 5.85 | 13.75 | -3.3% | -4.7% ± 12.6 | 2 / 4 |
| +3 h | 11.21 | 11.92 | 13.89 | 6.0% | 2.3% ± 11.4 | 3 / 4 |
| +6 h | 12.54 | 15.99 | 14.04 | 18.3% | 10.3% ± 11.2 | 3 / 4 |
| +12 h | 12.64 | 18.66 | 14.00 | 15.9% | 12.4% ± 10.4 | 3 / 4 |
| +24 h | 12.26 | 13.73 | 13.73 | 10.7% | 13.4% ± 8.6 | 3 / 4 |

### Los Angeles: Compton

2145 observed hours; 2 nearby station(s); regional model yes.

| Horizon | Forecast MAE | Same as now | Same hour yesterday | Skill vs harder baseline (pooled) | Per-window skill, mean ± std | Windows beating baseline |
|---|---|---|---|---|---|---|
| +1 h | 2.31 | 2.53 | 4.52 | 8.5% | 8.4% ± 1.6 | 4 / 4 |
| +3 h | 3.22 | 3.93 | 4.50 | 18.0% | 18.1% ± 3.0 | 4 / 4 |
| +6 h | 3.76 | 5.24 | 4.55 | 17.5% | 17.8% ± 3.3 | 4 / 4 |
| +12 h | 4.08 | 6.67 | 4.54 | 10.1% | 10.0% ± 1.9 | 4 / 4 |
| +24 h | 3.76 | 4.53 | 4.53 | 16.9% | 17.2% ± 3.8 | 4 / 4 |

### Bangkok: Prabadang Rehabiltation Center

2082 observed hours; 3 nearby station(s); regional model yes.

| Horizon | Forecast MAE | Same as now | Same hour yesterday | Skill vs harder baseline (pooled) | Per-window skill, mean ± std | Windows beating baseline |
|---|---|---|---|---|---|---|
| +1 h | 0.24 | 0.33 | 5.18 | 26.9% | 27.7% ± 7.0 | 4 / 4 |
| +3 h | 0.73 | 0.93 | 5.16 | 21.4% | 22.3% ± 7.8 | 4 / 4 |
| +6 h | 1.43 | 1.70 | 5.16 | 16.0% | 17.0% ± 12.3 | 3 / 4 |
| +12 h | 2.61 | 3.05 | 5.16 | 14.3% | 14.7% ± 16.1 | 2 / 4 |
| +24 h | 4.81 | 5.25 | 5.25 | 8.4% | 8.6% ± 15.4 | 2 / 4 |

Stations with no usable live data in this run:

- Beijing: ForecastUnavailable: No monitoring station with live PM2.5 near this location.

## Development stations (optimistic)

### Summary (6 stations: Mangaluru, Chennai, Mumbai, Delhi, Kolkata, London)

| Horizon | Mean skill vs same-as-now | Mean skill vs same-hour-yesterday | Mean skill vs harder baseline | Stations ahead of harder baseline | Windows won (all stations) |
|---|---|---|---|---|---|
| +1 h | 3.7% | 67.4% | 3.7% | 4 / 6 | 19 / 24 |
| +3 h | 7.1% | 37.4% | 7.1% | 4 / 6 | 17 / 24 |
| +6 h | 13.5% | 18.6% | 9.7% | 6 / 6 | 16 / 24 |
| +12 h | 17.1% | 6.6% | 3.6% | 5 / 6 | 14 / 24 |
| +24 h | 8.2% | 8.2% | 8.2% | 6 / 6 | 18 / 24 |

### Mangaluru: Kadri, Mangalore - KSPCB

1283 observed hours; 0 nearby station(s); regional model yes.

| Horizon | Forecast MAE | Same as now | Same hour yesterday | Skill vs harder baseline (pooled) | Per-window skill, mean ± std | Windows beating baseline |
|---|---|---|---|---|---|---|
| +1 h | 2.96 | 3.01 | 8.56 | 1.6% | 1.7% ± 0.7 | 4 / 4 |
| +3 h | 5.53 | 5.76 | 8.39 | 4.0% | 3.6% ± 2.9 | 3 / 4 |
| +6 h | 7.17 | 7.38 | 8.49 | 2.9% | 3.0% ± 1.8 | 4 / 4 |
| +12 h | 7.83 | 8.67 | 8.65 | 9.6% | 2.6% ± 6.8 | 3 / 4 |
| +24 h | 7.85 | 8.56 | 8.56 | 8.3% | 8.3% ± 5.9 | 4 / 4 |

### Chennai: Velachery Res. Area, Chennai - CPCB

1724 observed hours; 3 nearby station(s); regional model yes.

| Horizon | Forecast MAE | Same as now | Same hour yesterday | Skill vs harder baseline (pooled) | Per-window skill, mean ± std | Windows beating baseline |
|---|---|---|---|---|---|---|
| +1 h | 1.57 | 1.57 | 7.31 | 0.0% | 0.0% ± 0.0 | 0 / 4 |
| +3 h | 3.80 | 3.67 | 7.28 | -3.6% | -1.7% ± 3.0 | 0 / 4 |
| +6 h | 4.72 | 5.07 | 6.76 | 6.9% | 2.6% ± 4.4 | 1 / 4 |
| +12 h | 5.98 | 6.57 | 6.81 | 9.0% | 5.1% ± 8.8 | 1 / 4 |
| +24 h | 7.36 | 7.37 | 7.37 | 0.2% | 0.3% ± 0.5 | 1 / 4 |

### Mumbai: Colaba, Mumbai - MPCB

847 observed hours; 3 nearby station(s); regional model yes.

| Horizon | Forecast MAE | Same as now | Same hour yesterday | Skill vs harder baseline (pooled) | Per-window skill, mean ± std | Windows beating baseline |
|---|---|---|---|---|---|---|
| +1 h | 3.01 | 2.93 | 8.78 | -2.5% | -2.7% ± 13.6 | 3 / 4 |
| +3 h | 5.68 | 5.59 | 8.68 | -1.6% | -5.8% ± 18.0 | 2 / 4 |
| +6 h | 7.16 | 7.75 | 8.48 | 7.6% | -13.4% ± 30.3 | 1 / 4 |
| +12 h | 8.73 | 10.68 | 8.86 | 2.0% | -10.3% ± 16.9 | 1 / 4 |
| +24 h | 8.29 | 9.27 | 9.27 | 10.5% | 12.2% ± 6.0 | 4 / 4 |

### Delhi: R K Puram, Delhi - DPCC

1833 observed hours; 2 nearby station(s); regional model yes.

| Horizon | Forecast MAE | Same as now | Same hour yesterday | Skill vs harder baseline (pooled) | Per-window skill, mean ± std | Windows beating baseline |
|---|---|---|---|---|---|---|
| +1 h | 19.97 | 21.43 | 49.91 | 6.8% | 6.3% ± 2.7 | 4 / 4 |
| +3 h | 36.66 | 43.77 | 50.58 | 16.3% | 16.4% ± 6.2 | 4 / 4 |
| +6 h | 42.97 | 60.50 | 50.23 | 17.8% | 15.0% ± 7.8 | 4 / 4 |
| +12 h | 48.67 | 64.56 | 51.08 | 6.6% | 0.7% ± 18.5 | 3 / 4 |
| +24 h | 44.27 | 50.11 | 50.11 | 11.7% | 13.2% ± 4.7 | 4 / 4 |

### Kolkata: Padmapukur, Howrah - WBPCB

1858 observed hours; 3 nearby station(s); regional model yes.

| Horizon | Forecast MAE | Same as now | Same hour yesterday | Skill vs harder baseline (pooled) | Per-window skill, mean ± std | Windows beating baseline |
|---|---|---|---|---|---|---|
| +1 h | 4.53 | 5.00 | 16.70 | 9.4% | 8.4% ± 4.3 | 4 / 4 |
| +3 h | 10.06 | 11.59 | 16.85 | 13.3% | 12.2% ± 6.2 | 4 / 4 |
| +6 h | 15.61 | 18.46 | 16.77 | 4.1% | 2.9% ± 17.1 | 2 / 4 |
| +12 h | 18.62 | 23.75 | 16.86 | -13.1% | -5.1% ± 19.5 | 3 / 4 |
| +24 h | 16.34 | 16.74 | 16.74 | 2.3% | 0.2% ± 5.6 | 1 / 4 |

### London: Tower Hamlets - Mile End Road

2082 observed hours; 1 nearby station(s); regional model yes.

| Horizon | Forecast MAE | Same as now | Same hour yesterday | Skill vs harder baseline (pooled) | Per-window skill, mean ± std | Windows beating baseline |
|---|---|---|---|---|---|---|
| +1 h | 2.98 | 3.21 | 8.07 | 7.0% | 8.6% ± 4.1 | 4 / 4 |
| +3 h | 4.92 | 5.75 | 8.23 | 14.5% | 16.3% ± 4.2 | 4 / 4 |
| +6 h | 6.41 | 7.93 | 8.23 | 19.1% | 23.3% ± 8.6 | 4 / 4 |
| +12 h | 7.49 | 9.31 | 8.26 | 7.6% | 17.0% ± 14.6 | 3 / 4 |
| +24 h | 6.81 | 8.15 | 8.15 | 16.5% | 22.3% ± 11.0 | 4 / 4 |

## Do the spatial inputs help? (development stations, mean skill vs harder baseline)

Rule used when designing: keep an input family only if it raised this average.

| Inputs | +1 h | +3 h | +6 h | +12 h | +24 h | Average |
|---|---|---|---|---|---|---|
| temporal only | 1.7% | 5.1% | 7.5% | 1.9% | 5.8% | 4.4% |
| + nearby stations | 3.5% | 6.0% | 7.9% | 1.7% | 5.9% | 5.0% |
| + regional model | 3.0% | 6.5% | 9.7% | 3.9% | 8.5% | 6.3% |
| + both (served design) | 3.7% | 7.1% | 9.7% | 3.6% | 8.2% | 6.5% |

## Honest reading of the results

- On the fresh stations, mean skill against the harder baseline is positive at +1 h, +3 h, +6 h, +12 h, +24 h.
- **Not every station benefits.** On average the forecast was worse than the harder baseline at: Patna.
- The one-hour-ahead gain is small for any method because hourly PM2.5 is very persistent. The mix weights chosen by validation lean towards 'same as now' at +1 h, which keeps the forecast from being meaningfully worse than it, but it does not make +1 h a strong forecast.
- Per-window spread is large at some stations (see 'mean ± std'). Each window is only about 10% of ~90 days of data, so a single window can contain one pollution episode that dominates its error. Treat differences of a few percent as noise.
- Nearby-station inputs only exist where another station within 25 km reports live PM2.5. Many stations have none, so for them the spatial part comes only from the regional model.
- The regional model (CAMS) is a model, not a measurement, and the weather inputs at the target hour are weather *forecasts*; training uses analysed past weather, a small optimistic bias at longer horizons.
- Forecast uncertainty bands come from the empirical 10th and 90th percentile of out-of-window residuals; their calibration was not separately verified.
- This is a temporal and local-spatial forecast built on station data. It is not validated for use in health or safety decisions.
