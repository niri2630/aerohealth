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

The assistant can use the xAI service when an `XAI_API_KEY` environment variable is configured for the backend. Without a key, the API uses a local fallback response. Keep API keys private and never add them to Git.

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
