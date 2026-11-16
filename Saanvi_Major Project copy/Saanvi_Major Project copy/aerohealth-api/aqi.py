"""
AQI data fetching from OpenAQ v3 API with caching.
"""
import os
import time
from typing import Optional, Dict, Tuple
import httpx
from dotenv import load_dotenv

load_dotenv()

# In-memory cache: (lat_rounded, lon_rounded) -> (response_dict, timestamp)
_cache: Dict[Tuple[float, float], Tuple[dict, float]] = {}
CACHE_TTL = 300  # 5 minutes
_openaq_down_until = 0.0  # set when OpenAQ cannot be reached; see fetch_aqi

def round_coords(lat: float, lon: float) -> Tuple[float, float]:
    """Round to 3 decimals for cache key."""
    return (round(lat, 3), round(lon, 3))


async def fetch_aqi(lat: float, lon: float) -> dict:
    """
    Fetch AQI data from OpenAQ v3 API for the nearest station.
    Returns snake_case fields matching frontend AqiReading type.
    Caches responses for 5 minutes per rounded location.
    
    Falls back to deterministic location-specific synthetic data if OpenAQ
    has no nearby station or is unavailable. The fallback never substitutes
    another city's AQI for the requested location.
    """
    key = round_coords(lat, lon)
    now = time.time()
    
    # Check cache
    if key in _cache:
        data, ts = _cache[key]
        if now - ts < CACHE_TTL:
            return data
    
    # Fetch from OpenAQ v3. If it just failed (blocked network, outage), skip it for a minute so the
    # dashboard answers at once from the labelled simulation instead of waiting on every request.
    global _openaq_down_until
    if now >= _openaq_down_until:
        try:
            result = await _fetch_from_openaq(lat, lon)
            if result:
                result["requested_lat"] = lat
                result["requested_lon"] = lon
                result["location_specific"] = True
                _cache[key] = (result, now)
                return result
        except httpx.TransportError as e:
            _openaq_down_until = now + 60.0
            print(f"OpenAQ unreachable for {lat},{lon}: {e}")
        except Exception as e:
            print(f"OpenAQ fetch failed for {lat},{lon}: {e}")
    
    # Keep the requested coordinates when live monitoring data is unavailable.
    print(f"WARNING: Using location-specific synthetic data for {lat},{lon} - OpenAQ unavailable")
    return _synthetic_fallback(lat, lon)


OPENAQ_BASE = "https://api.openaq.org/v3"
MAX_AGE_HOURS = 6      # a reading older than this is treated as "no live data"
SEARCH_RADIUS_M = 25000
MAX_CANDIDATES = 5     # nearest stations to try before giving up

# ppb -> ug/m3 at 25 C, 1 atm (molecular weight / 24.45)
_UG_PER_PPB = {"no2": 1.88, "o3": 1.96, "so2": 2.62}


def _openaq_headers() -> Optional[dict]:
    key = os.getenv("OPENAQ_API_KEY", "").strip()
    return {"X-API-Key": key} if key else None


def _to_app_units(name: str, value: float, units: str) -> float:
    """Frontend units: PM in ug/m3; NO2, O3 and SO2 in ppb (as the dashboard labels them)."""
    if name in _UG_PER_PPB and (units or "").lower() != "ppb":
        return value / _UG_PER_PPB[name]   # sensor reports ug/m3 -> convert to ppb
    return value


def _parse_dt(text: str):
    from datetime import datetime, timezone
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(timezone.utc)
    except Exception:
        return None


async def _fetch_from_openaq(lat: float, lon: float) -> Optional[dict]:
    """
    Latest readings from the nearest OpenAQ v3 station that has fresh PM2.5.
    v3 requires an API key (X-API-Key) and reports values per *sensor id*, so the
    pollutant names come from the location's sensor list. Returns None when there
    is no key, no nearby station, or only stale data.
    """
    from datetime import datetime, timezone

    headers = _openaq_headers()
    if headers is None:
        print("OPENAQ_API_KEY is not set - skipping live data")
        return None

    params = {
        "coordinates": f"{lat},{lon}",
        "radius": str(SEARCH_RADIUS_M),
        "limit": MAX_CANDIDATES,  # v3 returns nearest-first when coordinates are given
    }
    async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=4.0), headers=headers) as client:
        resp = await client.get(f"{OPENAQ_BASE}/locations", params=params)
        resp.raise_for_status()
        locations = resp.json().get("results") or []

        now = datetime.now(timezone.utc)
        for location in locations:
            sensors = {
                s["id"]: (
                    (s.get("parameter") or {}).get("name", "").lower(),
                    (s.get("parameter") or {}).get("units", ""),
                )
                for s in location.get("sensors", [])
            }
            if not any(name in ("pm25", "pm2.5") for name, _ in sensors.values()):
                continue

            lresp = await client.get(f"{OPENAQ_BASE}/locations/{location['id']}/latest")
            lresp.raise_for_status()

            # Several sensors can report the same pollutant (old and new
            # instruments): keep the newest reading for each one.
            best: Dict[str, Tuple[float, object, str]] = {}
            for item in lresp.json().get("results") or []:
                name, units = sensors.get(item.get("sensorsId"), ("", ""))
                value = item.get("value")
                when = _parse_dt(((item.get("datetime") or {}).get("utc")) or "")
                if not name or value is None or when is None:
                    continue
                if name == "pm2.5":
                    name = "pm25"
                if name not in best or when > best[name][1]:
                    best[name] = (_to_app_units(name, float(value), units), when, units)

            pm = best.get("pm25")
            if pm is None or (now - pm[1]).total_seconds() > MAX_AGE_HOURS * 3600:
                continue  # nearest station has no fresh PM2.5; try the next one

            return _build_reading(best, location, pm[1])
    return None


def _build_reading(best: dict, location: dict, when) -> dict:
    """Map the freshest value per pollutant to our AqiReading fields."""
    def get(name, default):
        return best[name][0] if name in best else default

    pm25 = get("pm25", 25.0)
    return {
        "aqi": round(_pm25_to_aqi(pm25)),
        "pm25": round(pm25, 1),
        "pm10": round(get("pm10", pm25 * 1.6), 1),
        "no2": round(get("no2", 18.0), 1),
        "o3": round(get("o3", 20.0), 1),
        "so2": round(get("so2", 5.0), 1),
        "temperature": round(get("temperature", 25.0), 1),
        "humidity": round(get("relativehumidity", 65.0)),
        "station": location.get("name") or "OpenAQ station",
        "timestamp": when.strftime("%Y-%m-%dT%H:%M:%S") + "Z",
        "data_source": "openaq",
        "measured": sorted(best.keys()),
    }


def _pm25_to_aqi(pm25: float) -> float:
    """
    Simplified US EPA PM2.5 to AQI conversion.
    Breakpoints for 24-hour average (using instant value as proxy).
    """
    breakpoints = [
        (0, 12.0, 0, 50),
        (12.1, 35.4, 51, 100),
        (35.5, 55.4, 101, 150),
        (55.5, 150.4, 151, 200),
        (150.5, 250.4, 201, 300),
        (250.5, 500.4, 301, 500),
    ]
    
    for c_lo, c_hi, i_lo, i_hi in breakpoints:
        if c_lo <= pm25 <= c_hi:
            return ((i_hi - i_lo) / (c_hi - c_lo)) * (pm25 - c_lo) + i_lo
    
    return 500.0  # hazardous


def _synthetic_fallback(lat: float, lon: float) -> dict:
    """
    Last-resort synthetic data (should rarely be used if fallback coords work).
    """
    from datetime import datetime
    import math
    
    # Deterministic based on location
    seed = abs(math.sin(lat * 12.9898 + lon * 78.233) * 43758.5453)
    r = seed - math.floor(seed)
    
    aqi_val = round(42 + r * 118)
    
    return {
        "aqi": aqi_val,
        "pm25": round(aqi_val * 0.52, 1),
        "pm10": round(aqi_val * 0.83, 1),
        "no2": round(12 + r * 38, 1),
        "o3": round(18 + (1 - r) * 44, 1),
        "so2": round(3 + r * 11, 1),
        "temperature": round(14 + r * 18, 1),
        "humidity": round(38 + (1 - r) * 44),
        "station": "FALLBACK-SIM",
        "data_source": "synthetic",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "requested_lat": lat,
        "requested_lon": lon,
        "location_specific": True,
    }
