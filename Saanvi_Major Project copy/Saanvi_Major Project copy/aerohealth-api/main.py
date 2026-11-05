"""
AeroHealth API - FastAPI backend for air quality health risk prediction.
All endpoints match the reconciled frontend contract (see STEP0_RECONCILIATION.md).
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List
import time
from datetime import datetime, timedelta
import math

import aqi
import model
import routing
import httpx  # For geocoding API
from ai_assistant import stream_chat_response, get_quick_explanation, generate_health_report

app = FastAPI(title="AeroHealth API", version="1.0.0")

# CORS: open for demo (no auth)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Startup state
_startup_complete = False
_model_ready = False
_graph_ready = False
_warmup_latency_ms = 0.0


@app.on_event("startup")
async def startup():
    """
    Initialize model and graph at startup.
    Runs warm-up prediction to ensure first real request is fast.
    """
    global _startup_complete, _model_ready, _graph_ready, _warmup_latency_ms
    
    print("\n=== AeroHealth API Startup ===")
    start = time.time()
    
    # Train model
    try:
        model.train_model()
        _model_ready = True
    except Exception as e:
        print(f"ERROR: Model training failed: {e}")
        _model_ready = False
    
    # Load routing graph
    try:
        routing.load_graph()
        _graph_ready = True
    except Exception as e:
        print(f"ERROR: Graph loading failed: {e}")
        _graph_ready = False
    
    # Warm-up prediction
    if _model_ready:
        try:
            _warmup_latency_ms = model.warmup()
        except Exception as e:
            print(f"WARNING: Warm-up failed: {e}")
    
    elapsed = time.time() - start
    _startup_complete = True
    
    print(f"\n=== Startup Complete in {elapsed:.2f}s ===")
    print(f"Model ready: {_model_ready}")
    print(f"Graph ready: {_graph_ready}")
    print(f"Warm-up latency: {_warmup_latency_ms:.1f}ms")
    print("API ready for requests.\n")


@app.get("/health")
async def health():
    """Health check with startup status details."""
    return {
        "status": "ready" if _startup_complete else "starting",
        "model_ready": _model_ready,
        "graph_ready": _graph_ready,
        "warmup_latency_ms": round(_warmup_latency_ms, 1),
    }


# ===== REQUEST/RESPONSE MODELS =====

class PredictBody(BaseModel):
    pm25: float
    no2: float
    o3: float
    so2: float
    temperature: float
    humidity: float
    heart_rate: float
    age: float
    weight: float
    asthma: bool


class LatLon(BaseModel):
    lat: float
    lon: float


class RouteRequest(BaseModel):
    origin: LatLon
    destination: LatLon


class GeocodingRequest(BaseModel):
    address: str  # City name, street address, etc.


class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str


class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    context: Optional[dict] = None  # Current app state for context-aware responses


class QuickHelpRequest(BaseModel):
    query_type: str  # "aqi", "pm25", "risk_score", "shap", etc.
    data: dict


class HealthReportRequest(BaseModel):
    aqi_data: dict
    risk_data: dict
    history: List[dict]
    location: str
    vitals: Optional[dict] = None


LOCAL_BIAS_TERMS = {
    "adyar",
    "bejai",
    "kapu",
    "udupi",
    "vitla",
    "kulshekar",
    "kulsheker",
    "mangaluru",
    "mangalore",
    "surathkal",
    "panambur",
    "moodbidri",
    "moodabidri",
}


def _geocode_candidates(address: str) -> List[str]:
    trimmed = address.strip()
    lowered = trimmed.lower()
    candidates = [trimmed]

    if "adyar" in lowered:
        candidates.extend([
            "Adyar, Mangaluru taluk, Dakshina Kannada, Karnataka, India",
            "Adyar, Mangaluru, Karnataka, India",
        ])

    if "kapu" in lowered:
        candidates.extend([
            "Kapu, Kapu taluku, Udupi, Karnataka, India",
            "Kapu, Udupi, Karnataka, India",
        ])

    # Keep unqualified global searches global. Only add the regional suffix
    # when the query is already clearly referring to the local demo region.
    if any(token in lowered for token in LOCAL_BIAS_TERMS):
        if not any(token in lowered for token in ("india", "karnataka", "udupi", "dakshina", "mangaluru", "mangalore")):
            candidates.append(f"{trimmed}, Karnataka, India")

    return candidates


def _score_geocode_result(query: str, result: dict) -> float:
    query_lower = query.lower()
    display_name = result.get("display_name", "").lower()
    name = result.get("name", "").lower()
    score = 0.0

    for token in query_lower.replace(",", " ").split():
        if token and (token in display_name or token in name):
            score += 5.0

    if "india" in display_name:
        score += 8.0
    if "karnataka" in display_name:
        score += 18.0
    if "dakshina kannada" in display_name:
        score += 16.0
    if "udupi" in display_name:
        score += 14.0
    if "mangaluru" in display_name or "mangalore" in display_name:
        score += 14.0

    if any(term in query_lower for term in LOCAL_BIAS_TERMS):
        if any(term in display_name for term in ("karnataka", "dakshina kannada", "udupi", "mangaluru", "mangalore")):
            score += 25.0
        if any(term in display_name for term in ("chennai", "tamil nadu", "mali")):
            score -= 10.0

    if query_lower in display_name:
        score += 10.0

    return score


async def _geocode_address(address: str) -> dict:
    async with httpx.AsyncClient(timeout=10.0) as client:
        best_result = None
        best_score = float("-inf")

        for candidate in _geocode_candidates(address):
            data = await _search_geocoder(client, candidate, 5)

            for result in data:
                score = _score_geocode_result(candidate, result)
                if score > best_score:
                    best_score = score
                    best_result = result

        if not best_result:
            raise HTTPException(status_code=404, detail=f"Location not found: {address}")

        return best_result


async def _geocode_results(address: str) -> List[dict]:
    """Fetch worldwide Nominatim results server-side to avoid browser CORS."""
    results_by_id = {}
    async with httpx.AsyncClient(timeout=10.0) as client:
        for candidate in _geocode_candidates(address):
            for result in await _search_geocoder(client, candidate, 5):
                result_id = result.get("place_id", result.get("osm_id", result.get("display_name")))
                results_by_id[result_id] = result

    return sorted(
        results_by_id.values(),
        key=lambda result: _score_geocode_result(address, result),
        reverse=True,
    )


async def _search_geocoder(client: httpx.AsyncClient, query: str, limit: int) -> List[dict]:
    """Use Nominatim first and Photon when Nominatim is throttled."""
    try:
        response = await client.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": query, "format": "jsonv2", "limit": limit, "addressdetails": 1},
            headers={"User-Agent": "AeroHealth/1.0 (local development)"},
        )
        if response.status_code < 400:
            return response.json()
        if response.status_code not in (403, 429, 503):
            response.raise_for_status()
    except httpx.HTTPError as error:
        print(f"Nominatim unavailable for {query}: {error}")

    photon = await client.get(
        "https://photon.komoot.io/api/",
        params={"q": query, "limit": limit},
        headers={"User-Agent": "AeroHealth/1.0"},
    )
    photon.raise_for_status()
    normalized = []
    for feature in photon.json().get("features", []):
        properties = feature.get("properties", {})
        coordinates = feature.get("geometry", {}).get("coordinates", [])
        if len(coordinates) < 2:
            continue
        parts = [
            properties.get("name"),
            properties.get("city"),
            properties.get("state"),
            properties.get("country"),
        ]
        normalized.append({
            "lat": str(coordinates[1]),
            "lon": str(coordinates[0]),
            "display_name": ", ".join(str(part) for part in parts if part),
            "name": properties.get("name", ""),
        })
    return normalized


# ===== ENDPOINTS =====

@app.get("/api/aqi")
async def get_aqi(lat: float, lon: float):
    """
    Fetch current AQI and pollutant data for the given location.
    Returns AqiReading with snake_case fields, no trend arrays.
    Frontend generates sparklines from /api/history data.
    """
    try:
        data = await aqi.fetch_aqi(lat, lon)
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AQI fetch failed: {str(e)}")


@app.post("/api/predict")
async def post_predict(body: PredictBody):
    """
    Predict health risk score from air quality and vitals.
    Returns risk_score (integer), risk_label (fixed thresholds), and predicted_impacts.
    """
    if not _model_ready:
        raise HTTPException(status_code=503, detail="Model not ready")
    
    try:
        result = model.predict(body.dict())
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")


@app.post("/api/explain")
async def post_explain(body: PredictBody):
    """
    Generate SHAP explanation for the prediction.
    Returns base_value and features sorted by |shap_value| descending.
    """
    if not _model_ready:
        raise HTTPException(status_code=503, detail="Model not ready")
    
    try:
        result = model.explain(body.dict())
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Explanation failed: {str(e)}")


@app.post("/api/route")
async def post_route(req: RouteRequest):
    """
    Compare safe (AQI-weighted) and direct routes.
    Returns both routes as GeoJSON LineStrings with coordinates in [lon, lat] order.
    Coordinates are continuously ordered origin→destination for stroke animation.
    
    If graph not cached, triggers on-demand download (returns status with progress).
    """
    try:
        origin = (req.origin.lat, req.origin.lon)
        dest = (req.destination.lat, req.destination.lon)
        result = routing.compute_route(origin, dest)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Routing failed: {str(e)}")


@app.get("/api/route/status")
async def get_route_status(lat: float, lon: float):
    """
    Check download status for a location's road network.
    Returns: ready | downloading | not_started | failed
    """
    try:
        status = routing.get_download_status(lat, lon)
        return status
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Status check failed: {str(e)}")


@app.post("/api/geocode")
async def post_geocode(req: GeocodingRequest):
    """
    Convert address/city name to lat/lon coordinates using Nominatim (OpenStreetMap).
    Examples: "Delhi, India", "Times Square, New York", "Baker Street, London"
    """
    try:
        result = await _geocode_address(req.address)
        return {
            "lat": float(result["lat"]),
            "lon": float(result["lon"]),
            "display_name": result["display_name"],
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Geocoding failed: {str(e)}")


@app.post("/api/geocode/search")
async def post_geocode_search(req: GeocodingRequest):
    """Return multiple worldwide geocoding choices for an unambiguous picker."""
    try:
        results = await _geocode_results(req.address)
        return [
            {
                "lat": float(result["lat"]),
                "lon": float(result["lon"]),
                "display_name": result.get("display_name", req.address),
            }
            for result in results
            if result.get("lat") is not None and result.get("lon") is not None
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Geocoding search failed: {str(e)}")


@app.get("/api/history")
async def get_history(lat: float, lon: float, hours: int = 24):
    """
    Generate synthetic historical AQI and risk score data.
    Returns array of HistoryPoint with ISO 8601 timestamps in ascending order.
    
    This is a PLACEHOLDER - production would query a real time-series database.
    Generates smooth random walk around current AQI reading.
    """
    try:
        # Get current reading as anchor point
        current = await aqi.fetch_aqi(lat, lon)
        base_aqi = current["aqi"]
        
        # Generate smooth history via random walk
        points = []
        step = 3 if hours > 24 else 1  # sample every 3h for long ranges
        
        for h in range(hours, -1, -step):
            # Smooth wave pattern
            wave = math.sin((hours - h) / 3.4) * 22 + math.cos((hours - h) / 1.7) * 9
            aqi_val = max(12, round(base_aqi + wave))
            
            # Estimate risk score from AQI (simplified linear mapping)
            risk = max(3, min(98, round(aqi_val * 0.46 + 6)))
            
            timestamp = datetime.utcnow() - timedelta(hours=h)
            
            points.append({
                "timestamp": timestamp.isoformat() + "Z",
                "aqi": aqi_val,
                "risk_score": risk,
            })
        
        return points
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"History generation failed: {str(e)}")


@app.get("/")
async def root():
    """API info."""
    return {
        "name": "AeroHealth API",
        "version": "2.0.0",
        "status": "ready" if _startup_complete else "starting",
        "endpoints": [
            "GET /api/aqi?lat={lat}&lon={lon}",
            "POST /api/predict",
            "POST /api/explain",
            "POST /api/route",
            "GET /api/history?lat={lat}&lon={lon}&hours={hours}",
            "POST /api/chat (streaming)",
            "POST /api/quick-help",
            "POST /api/health-report",
            "GET /health",
        ],
        "features": [
            "AI Health Assistant (Grok-powered)",
            "Context-aware explanations",
            "Health reports generation",
            "Multi-city routing with on-demand download"
        ]
    }


# ===== AI ASSISTANT ENDPOINTS =====

@app.post("/api/chat")
async def post_chat(req: ChatRequest):
    """
    Stream conversational AI responses using Grok.
    Supports context-aware answers based on current app state.
    """
    try:
        messages = [{"role": msg.role, "content": msg.content} for msg in req.messages]
        
        async def generate():
            async for chunk in stream_chat_response(messages, req.context):
                yield chunk
        
        return StreamingResponse(generate(), media_type="text/plain")
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chat failed: {str(e)}")


@app.post("/api/quick-help")
async def post_quick_help(req: QuickHelpRequest):
    """
    Get quick contextual explanation for a specific data point.
    Used for tooltips and inline help.
    """
    try:
        explanation = get_quick_explanation(req.query_type, req.data)
        return {"explanation": explanation}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Help generation failed: {str(e)}")


@app.post("/api/health-report")
async def post_health_report(req: HealthReportRequest):
    """
    Generate comprehensive health report with insights and recommendations.
    """
    try:
        report = generate_health_report({
            "aqi_data": req.aqi_data,
            "risk_data": req.risk_data,
            "history": req.history,
            "location": req.location,
            "vitals": req.vitals
        })
        return report
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Report generation failed: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
