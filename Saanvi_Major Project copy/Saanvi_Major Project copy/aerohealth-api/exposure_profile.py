"""
Shared personal-exposure constants used by BOTH the risk model and the router,
so the dashboard score and the route comparison always agree.

Mirrored on the frontend in src/lib/aero/exposure-profile.ts - keep the two in sync.
"""
import math
from typing import Dict

# Approximate minute ventilation (litres of air breathed per minute).
ACTIVITY_VENTILATION_LPM: Dict[str, float] = {
    "resting": 8.0,
    "walking": 20.0,
    "cycling": 38.0,
}
REFERENCE_VENTILATION_LPM = ACTIVITY_VENTILATION_LPM["resting"]

# Fraction of each pollutant that still reaches the lungs through a mask.
# Masks stop particles far better than gases, so NO2/O3/SO2 barely change.
MASK_PENETRATION: Dict[str, Dict[str, float]] = {
    "none":     {"pm": 1.00, "gas": 1.00},
    "surgical": {"pm": 0.70, "gas": 0.97},
    "n95":      {"pm": 0.10, "gas": 0.90},
}


def normalise_activity(activity: str) -> str:
    activity = (activity or "resting").lower()
    return activity if activity in ACTIVITY_VENTILATION_LPM else "resting"


def normalise_mask(mask: str) -> str:
    mask = (mask or "none").lower()
    return mask if mask in MASK_PENETRATION else "none"


def ventilation_lpm(activity: str) -> float:
    return ACTIVITY_VENTILATION_LPM[normalise_activity(activity)]


def dose_factor(ventilation: float) -> float:
    """
    Scales internal pollutant dose with breathing rate. Physical dose is linear
    in ventilation (cycling = ~4.8x resting); the risk score uses a log
    compression so one activity change cannot saturate the 0-100 scale.
    """
    return 1.0 + 0.25 * math.log(max(ventilation, 1.0) / REFERENCE_VENTILATION_LPM)


def mask_pm(mask: str) -> float:
    return MASK_PENETRATION[normalise_mask(mask)]["pm"]


def mask_gas(mask: str) -> float:
    return MASK_PENETRATION[normalise_mask(mask)]["gas"]
