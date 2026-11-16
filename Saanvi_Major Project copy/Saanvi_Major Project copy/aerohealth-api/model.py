"""
Health risk prediction model using XGBoost on synthetic training data.
This is a PROXY standing in for the LSTM described in the design doc.
The synthetic data and formula are intentionally interpretable for demo purposes.

Personal inputs (all optional on the API, with safe defaults):
  hypertension  - amplifies the effect of PM2.5 / NO2 (acute ischemic + BP spikes)
  spo2          - blood-oxygen saturation, 90-100 %, lowers respiratory reserve
  height        - cm, combined with weight into BMI
  activity      - resting | walking | cycling -> minute ventilation (inhaled dose)
  mask          - none | surgical | n95 -> filtration of particles (and a little gas)
"""
import numpy as np
import xgboost as xgb
import shap
from typing import Dict
import time

import exposure_profile as prof

# Model will be trained at startup and cached here
_model: xgb.XGBRegressor = None
_explainer: shap.TreeExplainer = None
_feature_names = [
    "pm25", "no2", "o3", "so2", "temperature", "humidity",
    "heart_rate", "age", "weight", "asthma",
    "hypertension", "spo2", "height", "ventilation", "mask_filtration",
]
_display_names = [
    "PM2.5", "NO₂", "O₃", "SO₂", "Temperature", "Humidity",
    "Heart rate", "Age", "Weight", "Asthma",
    "Hypertension", "Blood oxygen", "Height", "Breathing rate", "Mask filtration",
]

DEFAULTS = {
    "hypertension": False,
    "spo2": 97.0,
    "height": 170.0,
    "activity": "resting",
    "mask": "none",
}


def _target(pm25, no2, o3, so2, hum, hr, age, weight, asthma,
            hyp, spo2, height, vent, mask_filt):
    """Hand-written, interpretable risk formula (vectorised). Returns 0-100 pre-noise."""
    pm_pen = 1.0 - mask_filt / 100.0
    # Masks block particles much better than gases; gas penetration is derived
    # from the same filtration level (N95 90% -> 0.90 gas penetration).
    gas_pen = 1.0 - 0.1 * (mask_filt / 90.0)
    dose = 1.0 + 0.25 * np.log(np.maximum(vent, 1.0) / prof.REFERENCE_VENTILATION_LPM)

    pm_term = 0.6 * pm25 * pm_pen * dose
    no2_term = 0.48 * no2 * gas_pen * dose
    o3_term = 0.1867 * o3 * gas_pen * dose
    so2_term = 1.2 * so2 * gas_pen * dose
    pollutants = (pm_term - 30) + (no2_term - 14.4) + (o3_term - 9.33) + (so2_term - 18)

    # Cardiovascular vulnerability: fine particles + NO2 hit hypertensive users harder.
    hyp_effect = hyp * (6 + 0.25 * pm_term + 0.30 * no2_term)

    hr_effect = (hr - 68) * 0.28
    age_effect = (age - 32) * 0.18
    bmi = weight / np.square(height / 100.0)
    bmi_effect = (bmi - 24) * 0.8
    asthma_effect = asthma * 14
    humidity_effect = np.maximum(0, hum - 60) * 0.08
    # Low SpO2 removes respiratory reserve; worse again with asthma.
    spo2_effect = (97 - spo2) * 2.0 + asthma * np.maximum(0, 95 - spo2) * 1.0

    return (pollutants + hyp_effect + hr_effect + age_effect + bmi_effect +
            asthma_effect + humidity_effect + spo2_effect + 35)


def train_model():
    """
    Train XGBoost regressor on synthetic data at startup.
    Training set is generated using a hand-written risk formula with noise.
    """
    global _model, _explainer

    print("Generating synthetic training data...")
    rng = np.random.default_rng(42)
    n = 20000

    # Ambient pollutant levels are right-skewed (most days moderate, a few severe),
    # so draw from beta distributions that still span the full range below.
    pm25 = 5 + 145 * rng.beta(1.5, 3.5, n)
    no2 = 5 + 75 * rng.beta(1.5, 3.5, n)
    o3 = 10 + 90 * rng.beta(2.0, 3.0, n)
    so2 = 1 + 39 * rng.beta(1.2, 4.0, n)
    temp = rng.uniform(10, 35, n)
    hum = rng.uniform(30, 90, n)
    hr = np.clip(rng.normal(72, 12, n), 45, 140)
    age = rng.uniform(12, 85, n)
    asthma = rng.binomial(1, 0.2, n).astype(float)
    hyp = rng.binomial(1, 0.25, n).astype(float)
    spo2 = np.clip(rng.normal(97, 2.0, n), 90, 100)
    height = rng.uniform(140, 200, n)
    # Realistic body mass: sample BMI, then derive weight (independent uniform
    # weight/height produces impossible 150 kg x 140 cm combinations).
    weight = np.clip(np.clip(rng.normal(25, 4.5, n), 16, 42) * np.square(height / 100.0), 35, 150)
    vent = rng.choice(list(prof.ACTIVITY_VENTILATION_LPM.values()), n)
    mask_filt = rng.choice([0.0, 30.0, 90.0], n, p=[0.5, 0.25, 0.25])

    X = np.column_stack([pm25, no2, o3, so2, temp, hum, hr, age, weight, asthma,
                         hyp, spo2, height, vent, mask_filt])
    y_base = _target(pm25, no2, o3, so2, hum, hr, age, weight, asthma,
                     hyp, spo2, height, vent, mask_filt)
    # Floor at 2: breathing is never literally zero-risk, and it keeps masked
    # clean-air cases from collapsing onto a clipped plateau the trees cannot split.
    y = np.clip(y_base + rng.normal(0, 3, n), 2, 100)

    print(f"Training XGBoost on {n} synthetic samples...")
    start = time.time()

    _model = xgb.XGBRegressor(
        n_estimators=300,
        max_depth=6,
        learning_rate=0.08,
        random_state=42,
        tree_method='hist',
    )
    _model.fit(X, y)

    print(f"Model trained in {time.time() - start:.2f}s")

    print("Initializing SHAP explainer...")
    _explainer = shap.TreeExplainer(_model)
    print("Model ready for predictions.")


def get_risk_label(score: float) -> str:
    """
    Fixed thresholds matching frontend labelFor function.
    CRITICAL: These exact cutpoints drive color-bloom animations.
    """
    if score < 25:
        return "Low"
    elif score < 50:
        return "Moderate"
    elif score < 75:
        return "High"
    else:
        return "Severe"


def _features(data: Dict) -> np.ndarray:
    """Convert an API payload (new fields optional) to the model's feature row."""
    g = lambda key: data.get(key, DEFAULTS.get(key))
    mask_filt = round((1.0 - prof.mask_pm(g("mask"))) * 100.0)
    return np.array([[
        data["pm25"],
        data["no2"],
        data["o3"],
        data["so2"],
        data["temperature"],
        data["humidity"],
        data["heart_rate"],
        data["age"],
        data["weight"],
        1.0 if data["asthma"] else 0.0,
        1.0 if g("hypertension") else 0.0,
        float(min(100.0, max(90.0, g("spo2")))),
        float(g("height")),
        prof.ventilation_lpm(g("activity")),
        float(mask_filt),
    ]])


def predict(data: Dict) -> Dict:
    """
    Run prediction on input data.
    Returns risk_score (integer), risk_label, and predicted_impacts (1 decimal).
    """
    if _model is None:
        raise RuntimeError("Model not trained. Call train_model() first.")

    X = _features(data)
    raw_score = float(np.clip(_model.predict(X)[0], 2, 100))
    risk_score = round(raw_score)  # integer, 0 decimals

    hyp = 1.0 if data.get("hypertension", False) else 0.0
    spo2 = min(100.0, max(90.0, data.get("spo2", DEFAULTS["spo2"])))
    low_spo2 = max(0.0, 96.0 - spo2)

    # Predicted impacts: proportional to the score, modulated by the profile.
    return {
        "risk_score": risk_score,
        "risk_label": get_risk_label(risk_score),
        "predicted_impacts": {
            "heart_rate_delta": round(risk_score * 0.13 * (1 + 0.20 * hyp), 1),
            "hrv_delta": round(-risk_score * 0.21 * (1 + 0.10 * hyp), 1),
            # Low blood oxygen directly amplifies respiratory strain.
            "resp_stress_delta": round(risk_score * 0.34 * (1 + 0.08 * low_spo2), 1),
            "systolic_bp_delta": round(risk_score * 0.11 * (1.6 if hyp else 1.0), 1),
        }
    }


def explain(data: Dict) -> Dict:
    """
    Generate SHAP explanation for the prediction.
    Returns base_value and features list sorted by |shap_value| descending.
    All values rounded to 1 decimal.
    """
    if _explainer is None:
        raise RuntimeError("Explainer not initialized. Call train_model() first.")

    X = _features(data)
    shap_values = _explainer.shap_values(X)
    base = float(np.ravel(_explainer.expected_value)[0])

    features = []
    for i, name in enumerate(_display_names):
        features.append({
            "name": name,
            "value": round(float(X[0, i]), 1),
            "shap_value": round(float(shap_values[0, i]), 1),
        })

    # Sort by absolute SHAP value descending
    features.sort(key=lambda f: abs(f["shap_value"]), reverse=True)

    return {
        "base_value": round(base, 1),
        "features": features,
    }


def warmup():
    """
    Warm-up call to ensure first real request isn't slow.
    Runs predict + explain with default inputs.
    """
    if _model is None:
        raise RuntimeError("Model not trained. Call train_model() first.")

    print("Running warm-up prediction...")
    start = time.time()

    default_input = {
        "pm25": 35.0,
        "no2": 25.0,
        "o3": 40.0,
        "so2": 10.0,
        "temperature": 22.0,
        "humidity": 60.0,
        "heart_rate": 72.0,
        "age": 35.0,
        "weight": 70.0,
        "asthma": False,
    }

    pred = predict(default_input)
    explain(default_input)

    elapsed = (time.time() - start) * 1000  # ms
    print(f"Warm-up complete: predict+explain took {elapsed:.1f}ms")
    print(f"Sample prediction: risk_score={pred['risk_score']}, label={pred['risk_label']}")

    return elapsed
