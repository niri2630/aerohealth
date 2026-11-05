# AeroHealth

AeroHealth is a web application that combines local air-quality readings with a demonstration health-risk model and route comparisons. The repository currently keeps the application inside `Saanvi_Major Project copy/Saanvi_Major Project copy/`; the commands below use that existing layout.

## What it does

- Retrieves air-quality readings for a selected location from OpenAQ, with location-specific synthetic data when live readings are unavailable.
- Estimates a personal air-quality risk score from pollutant and user inputs, and shows feature contributions using SHAP.
- Compares routes by distance and estimated pollution exposure.
- Provides air-quality history, location search, an assistant, and health reports.

The risk model is trained at startup using synthetic data. Its scores are for demonstration and learning only; they are not clinically validated and must not be used for medical decisions.

## Project layout

```text
Saanvi_Major Project copy/
└── Saanvi_Major Project copy/
    ├── aerohealth-api/                 FastAPI backend
    ├── aerohealth-interface-frontend/  React and TypeScript frontend
    └── demo_graph.pickle               Demo road graph used by routing
```

The repository root also contains project explanation exports and their PDF-generation script.

## Requirements

- Python 3.10 or later
- Node.js and npm, using a version supported by Vite 8
- Internet access for live air-quality data, geocoding, and some routing operations

## Run locally on Windows

Open two PowerShell terminals from the repository root.

### 1. Start the API

In the first terminal:

```powershell
cd "Saanvi_Major Project copy\Saanvi_Major Project copy\aerohealth-api"
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

The API health check is available at `http://127.0.0.1:8000/health`. FastAPI's interactive API documentation is at `http://127.0.0.1:8000/docs`.

### 2. Start the frontend

In the second terminal:

```powershell
cd "Saanvi_Major Project copy\Saanvi_Major Project copy\aerohealth-interface-frontend"
Set-Content .env.local 'VITE_API_URL=http://127.0.0.1:8000'
npm ci
npm run dev
```

Open the local address printed by Vite, usually `http://localhost:5173`.

The assistant can use an xAI API key when one is configured as `XAI_API_KEY` in the API's `.env` file. Without that key, the API provides a local fallback response. Keep API keys in local environment files; never commit them.

## Useful commands

Run these from `aerohealth-interface-frontend`:

```powershell
npm run lint
npm run build
```

## API endpoints

The backend exposes a health check and endpoints for air-quality readings, risk prediction, SHAP explanations, route comparison, geocoding, history, chat, quick help, and health reports. See `http://127.0.0.1:8000/docs` while the API is running for request and response schemas.

## Limitations

- Risk estimates are based on synthetic training data and are not medical advice.
- Air-quality readings may fall back to synthetic values when a live source is unavailable.
- The API currently enables permissive CORS for the demo and does not provide authentication. Review both before deploying publicly.
- External data and routing services may be unavailable or rate-limited.
