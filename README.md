# AeroHealth

AeroHealth is a full-stack air-quality and personal exposure research project. It brings live environmental readings, a demonstration health-risk estimate, explainable model results, and route exposure comparisons together in a web interface.

The project is designed to make environmental information easier to explore: choose a location, review current pollutant levels, adjust personal inputs, and see how estimated risk and route exposure change. The interface and API run as separate local services.

## Features

- **Air-quality monitoring:** Retrieves nearby readings for common pollutants and environmental conditions. When live monitoring data cannot be retrieved, the API can provide clearly identified, location-specific synthetic readings for the demo.
- **Personalized risk estimation:** Combines pollutant readings with user-provided inputs to produce a demonstration risk score and category.
- **Explainable results:** Uses SHAP feature contributions to show which inputs influenced a prediction.
- **Route comparison:** Compares a direct route with an alternative route using distance and estimated pollution exposure.
- **History and location search:** Explore recent air-quality and risk information, and search for a place to monitor or route between.
- **Health assistant and reports:** Ask questions about displayed project data and generate a summary of current conditions.

- **Extended health profile:** Hypertension, blood oxygen (SpO₂), height, activity level (resting / walking / cycling) and mask protection (none / surgical / N95) feed the risk model, SHAP breakdown and predicted impacts (including systolic BP).
- **Speed-aware routing:** Enter your own travel speed (e.g. 8 km/h running, 50 km/h car). Route times use that speed, and the "safe" route is the one with the lowest *inhaled dose* (concentration × breathing rate × time × mask).
- **24-hour PM2.5 forecast (spatio-temporal):** For the nearest monitoring station, the API downloads about 90 days of hourly OpenAQ history, Open-Meteo weather, up to three nearby stations, and the CAMS regional air-quality model, trains a gradient-boosted model per horizon, and serves `/api/forecast` with uncertainty bands. The model is mixed with "same hour yesterday" and "same as now" using weights chosen by validation inside each training window. Accuracy is measured with rolling-origin cross-validation (four later test windows) against both baselines, and reported separately for stations used while developing the design and for fresh stations first run after it was frozen. Run `python evaluate_forecast.py` in `aerohealth-api` (several minutes) to regenerate `FORECAST_EVALUATION.md`. The forecast does not beat the baselines at every station, horizon or window; the report states where it does not. A cold call takes about 20 to 40 seconds and is then cached for an hour.
- **Trip-based reports:** Searching a route only plans it. Press "I took the safe/direct route" to log a trip; the Reports page is built from logged trips only, and each trip can be edited, excluded or deleted.

## How it works

The browser-based interface sends requests to a Python API. The API retrieves or generates air-quality readings, runs the risk-estimation and explanation logic, and provides location, route, history, and assistant features. The frontend and backend are started separately during local development.

The demonstration risk model is trained at startup using synthetic data. Its results are not clinically validated, are not medical advice, and must not be used to make health or treatment decisions. Synthetic readings are not a substitute for measurements from a verified monitoring station.

## Requirements

- Python 3.10 or later
- Node.js and npm compatible with Vite 8
- Internet access for live air-quality data, geocoding, and external routing services

## Run locally on Windows

Open the backend directory in one VS Code terminal and the frontend directory in a second terminal. These directories are inside the project folder.

### Start the backend

From the backend directory:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

The API health check is at `http://127.0.0.1:8000/health`. Interactive endpoint documentation is at `http://127.0.0.1:8000/docs`.

### Start the frontend

From the frontend directory, set the API address in the current PowerShell session, install the JavaScript dependencies, and start the development server:

```powershell
$env:VITE_API_URL = "http://127.0.0.1:8000"
npm ci
npm run dev
```

Open the local address printed by the development server, usually `http://localhost:5173`.

Live air-quality data needs a free OpenAQ API key. Copy `aerohealth-api/.env.example` to `aerohealth-api/.env` and set `OPENAQ_API_KEY` (get one at https://explore.openaq.org). Without it, the API falls back to clearly labelled synthetic readings. `.env` is git-ignored; when deploying, set the same variable in the host's environment settings.

The assistant can use the xAI service when an `XAI_API_KEY` environment variable is configured for the backend. Without a key, the API uses a local fallback response. Keep API keys private and never add them to Git.

## When something does not load

The route planner and the forecast depend on outside services, and a campus or office network may block some of them. The app is built to say what is wrong instead of failing silently:

- **Check connection.** Appears under the map and in the forecast card whenever something fails. It tests the services (place search, road routing, map pictures, OpenAQ, Open-Meteo, the AI assistant) from the computer running the API and also shows whether the OpenAQ key is set. A missing key and a blocked network look the same on screen ("no data"); this tells them apart.
- **Place search blocked.** The API falls back to an offline place list (`aerohealth-api/gazetteer.json`, about 110 OpenStreetMap places around Mangaluru plus the street names of the bundled road graph) and also accepts typed coordinates such as `12.8417, 74.9230`. Results from the list are tagged "(offline list)".
- **Road routing blocked.** The API uses the bundled road graph (`demo_graph.pickle`, roughly a 6 km by 6 km campus area) when both points are inside it; otherwise it draws a simulated curve. Both are labelled on screen as not real road routes. If no routing service answers at all, the map shows a clearly labelled straight-line estimate, never an old line.
- **Forecast says "no forecast".** Read the message on the card. The usual causes are a missing `.env` (the key file is hidden and git-ignored, so copies and clones often leave it out; copy `.env.example` to `.env` in `aerohealth-api` and add the key), the frontend started without `VITE_API_URL`, an old backend without `/api/forecast`, or OpenAQ and Open-Meteo being blocked. Restart the API after changing `.env`.
- **Routes on the map.** The planner draws a safe route (teal) and a direct route (red). When the lowest-exposure route is the direct road, the two coincide, so the red line is drawn as dashes on top of the teal one and the legend says "same road". Up to two other genuinely different roads are kept as grey "options" and listed under the map with how far, how long and how much more (or less) pollution they involve compared with the safe route. If no other distinct road exists, the list says so. Pollution along routes is simulated, so a detour rarely lowers the dose enough to be chosen and the differences are illustrative.

## Checks

Run these commands from the frontend directory:

```powershell
npm run lint
npm run build
```

## API overview

The API provides endpoints for health status, air-quality readings, risk prediction, SHAP explanations, route comparison, geocoding, history, chat, quick help, and health reports. Start the backend and visit `http://127.0.0.1:8000/docs` to inspect the available request and response schemas.

## Limitations and deployment notes

- Risk estimates use synthetic training data and are for demonstration only.
- Live readings and external map services may be unavailable, incomplete, or rate-limited.
- The demo API permits cross-origin requests and does not include authentication. Add appropriate access controls and review CORS settings before exposing it publicly.
- `/api/forecast` is the expensive endpoint (a cold call makes dozens of OpenAQ requests with your key and trains about 50 models). It has basic protections: each client gets 20 requests per minute, repeat requests for the same area are answered from memory with no outside calls, simultaneous requests for one station share a single build, at most two builds run at once, and results are cached for an hour. These limit accidents and casual abuse, not a determined attacker: the client address comes from a header that can be spoofed, so put real authentication or a gateway in front before making the API public.

## Push changes to GitHub

Create a commit from the repository root, then push the current branch:

```powershell
git add .
git status
git diff --cached
git commit -m "Update AeroHealth documentation"
git push
```

Review the staged changes before committing. The repository is already connected to GitHub, so a remote URL does not need to be added again. If Git reports that there is nothing to commit, there are no new changes to push.
