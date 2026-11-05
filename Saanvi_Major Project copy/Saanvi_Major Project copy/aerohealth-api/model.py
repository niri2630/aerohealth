"""
Health risk prediction model using XGBoost on synthetic training data.
This is a PROXY standing in for the LSTM described in the design doc.
The synthetic data and formula are intentionally interpretable for demo purposes.
"""
import numpy as np
import xgboost as xgb
import shap
from typing import Dict, List
import time

# Model will be trained at startup and cached here
_model: xgb.XGBRegressor = None
_explainer: shap.TreeExplainer = None
_feature_names = ["pm25", "no2", "o3", "so2", "temperature", "humidity", 
                  "heart_rate", "age", "weight", "asthma"]


def train_model():
    """
    Train XGBoost regressor on synthetic data at startup.
    Training set is generated using a hand-written risk formula with noise.
    """
    global _model, _explainer
    
    print("Generating synthetic training data...")
    np.random.seed(42)
    n_samples = 5000
    
    # Sample input features from reasonable ranges
    X = np.column_stack([
        np.random.uniform(5, 150, n_samples),      # pm25
        np.random.uniform(5, 80, n_samples),       # no2
        np.random.uniform(10, 100, n_samples),     # o3
        np.random.uniform(1, 40, n_samples),       # so2
        np.random.uniform(10, 35, n_samples),      # temperature
        np.random.uniform(30, 90, n_samples),      # humidity
        np.random.uniform(50, 120, n_samples),     # heart_rate
        np.random.uniform(18, 75, n_samples),      # age
        np.random.uniform(45, 110, n_samples),     # weight
        np.random.binomial(1, 0.2, n_samples),     # asthma (20% prevalence)
    ])
    
    # Synthetic target: weighted sum of pollutant z-scores + biometric multipliers
    # This formula is intentionally interpretable (not a black-box LSTM)
    pm25_norm = (X[:, 0] - 50) / 40
    no2_norm = (X[:, 1] - 30) / 20
    o3_norm = (X[:, 2] - 50) / 30
    so2_norm = (X[:, 3] - 15) / 10
    hr_effect = (X[:, 6] - 68) * 0.28
    age_effect = (X[:, 7] - 32) * 0.18
    weight_effect = (X[:, 8] - 72) * 0.06
    asthma_effect = X[:, 9] * 14
    humidity_effect = np.maximum(0, X[:, 5] - 60) * 0.08
    
    y_base = (pm25_norm * 24 + no2_norm * 9.6 + o3_norm * 5.6 + so2_norm * 12 +
              hr_effect + age_effect + weight_effect + asthma_effect + humidity_effect)
    
    # Add noise and clip to [0, 100]
    noise = np.random.normal(0, 3, n_samples)
    y = np.clip(y_base + noise + 35, 0, 100)
    
    print(f"Training XGBoost on {n_samples} synthetic samples...")
    start = time.time()
    
    _model = xgb.XGBRegressor(
        n_estimators=150,
        max_depth=6,
        learning_rate=0.1,
        random_state=42,
        tree_method='hist',
    )
    _model.fit(X, y)
    
    elapsed = time.time() - start
    print(f"Model trained in {elapsed:.2f}s")
    
    # Initialize SHAP explainer
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


def predict(data: Dict[str, float]) -> Dict:
    """
    Run prediction on input data.
    Returns risk_score (integer), risk_label, and predicted_impacts (1 decimal).
    """
    if _model is None:
        raise RuntimeError("Model not trained. Call train_model() first.")
    
    # Convert input dict to feature array in correct order
    X = np.array([[
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
    ]])
    
    raw_score = _model.predict(X)[0]
    risk_score = round(float(raw_score))  # integer, 0 decimals
    
    # Predicted impacts derived from risk score with simple proportional formulas
    return {
        "risk_score": risk_score,
        "risk_label": get_risk_label(risk_score),
        "predicted_impacts": {
            "heart_rate_delta": round(risk_score * 0.13, 1),
            "hrv_delta": round(-risk_score * 0.21, 1),
            "resp_stress_delta": round(risk_score * 0.34, 1),
        }
    }


def explain(data: Dict[str, float]) -> Dict:
    """
    Generate SHAP explanation for the prediction.
    Returns base_value and features list sorted by |shap_value| descending.
    All values rounded to 1 decimal.
    """
    if _explainer is None:
        raise RuntimeError("Explainer not initialized. Call train_model() first.")
    
    # Convert input dict to feature array
    X = np.array([[
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
    ]])
    
    shap_values = _explainer.shap_values(X)
    base = float(_explainer.expected_value)
    
    # Build features list with display names
    display_names = [
        "PM2.5", "NO₂", "O₃", "SO₂", "Temperature", "Humidity",
        "Heart rate", "Age", "Weight", "Asthma"
    ]
    
    features = []
    for i, name in enumerate(display_names):
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
    expl = explain(default_input)
    
    elapsed = (time.time() - start) * 1000  # ms
    print(f"Warm-up complete: predict+explain took {elapsed:.1f}ms")
    print(f"Sample prediction: risk_score={pred['risk_score']}, label={pred['risk_label']}")
    
    return elapsed
