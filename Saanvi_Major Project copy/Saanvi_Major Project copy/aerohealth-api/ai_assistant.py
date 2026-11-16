"""
AI Health Assistant powered by Grok (xAI) for conversational explanations.
Provides context-aware responses about air quality, health risks, and recommendations.
"""
from openai import OpenAI
from typing import List, Dict, Optional, AsyncIterator
import json
import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Initialize Grok client (uses xAI's API which is OpenAI-compatible)
# API key from environment variable
GROK_API_KEY = os.getenv("XAI_API_KEY", "")
client = OpenAI(
    api_key=GROK_API_KEY,
    base_url="https://api.x.ai/v1"
) if GROK_API_KEY else None


SYSTEM_PROMPT = """You are AeroHealth AI Assistant, an expert in air quality and personal health.

Your role is to:
1. Explain air quality metrics (AQI, PM2.5, NO₂, etc.) in simple terms
2. Interpret health risk scores and SHAP explanations
3. Provide personalized health advice based on air quality and user vitals
4. Explain routing decisions (why safe route differs from direct route)
5. Answer questions about pollutants, health impacts, and protective measures

Guidelines:
- Use simple, conversational language (avoid medical jargon)
- Be empathetic and supportive (health is personal)
- Reference specific data when user provides it
- Give actionable advice (not just information)
- Explain "why" behind recommendations
- For vulnerable groups (asthma, elderly, children), emphasize extra caution

When user shares data (e.g., "my risk score is 42"), use it to personalize your response.

Current context awareness:
- User's location
- Current AQI values
- Risk score and contributing factors
- Route comparison data
- Personal vitals (if shared)

Be concise but thorough. Use examples. Make complex health data understandable."""


def build_context_message(context: Dict) -> str:
    """Build context message from current app state."""
    parts = []

    project = context.get("project")
    if project:
        parts.append(f"Project: {project.get('name', 'AeroHealth')} - {project.get('purpose', '')}")
        parts.append(f"Project capabilities: {', '.join(project.get('capabilities', []))}")
        parts.append(f"Project data sources: {', '.join(project.get('dataSources', []))}")
        parts.append(f"Project limitations: {', '.join(project.get('limitations', []))}")
    
    if "location" in context:
        parts.append(f"Location: {context['location']}")
    
    if "aqi_data" in context:
        aqi = context["aqi_data"]
        parts.append(f"Current AQI: {aqi.get('aqi')} (PM2.5: {aqi.get('pm25')}µg/m³, NO₂: {aqi.get('no2')}ppb)")
    
    if "risk_data" in context:
        risk = context["risk_data"]
        parts.append(f"User's risk score: {risk.get('risk_score')}/100 ({risk.get('risk_label')})")
        if "predicted_impacts" in risk:
            impacts = risk["predicted_impacts"]
            parts.append(f"Predicted impacts: HR+{impacts.get('heart_rate_delta')} bpm, HRV {impacts.get('hrv_delta')} ms")
    
    if "shap_data" in context:
        shap = context["shap_data"]
        top_features = shap.get("features", [])[:3]
        feature_str = ", ".join([f"{f['name']}: {f['shap_value']:+.1f}" for f in top_features])
        parts.append(f"Top risk factors (SHAP): {feature_str}")
    
    if "route_data" in context:
        route = context["route_data"]
        direct = route.get("direct_route", {})
        safe = route.get("safe_route", {})
        reduction = route.get("exposure_reduction_pct", 0)
        parts.append(f"Routes: Direct {direct.get('distance_km')}km (AQI {direct.get('avg_aqi_exposure')}), Safe {safe.get('distance_km')}km (AQI {safe.get('avg_aqi_exposure')}), {reduction}% cleaner")
    
    if "vitals" in context:
        vitals = context["vitals"]
        parts.append(f"User vitals: Age {vitals.get('age')}, HR {vitals.get('heart_rate')} bpm, Asthma: {vitals.get('asthma')}, Hypertension: {vitals.get('hypertension')}, SpO2: {vitals.get('spo2')}%, Activity: {vitals.get('activity')}, Mask: {vitals.get('mask')}")
    
    if "chart_data" in context:
        chart = context["chart_data"]
        parts.append(f"User is viewing: {chart.get('type')} chart - {chart.get('description')}")
    
    if parts:
        return "CURRENT CONTEXT:\n" + "\n".join(parts)
    return ""


async def stream_chat_response(
    messages: List[Dict[str, str]], 
    context: Optional[Dict] = None
) -> AsyncIterator[str]:
    """
    Stream chat response from Grok with context awareness.
    Yields chunks of text as they arrive.
    """
    if not client:
        # Keep the endpoint useful when an xAI key is not configured. The
        # frontend can still use this deterministic, question-aware fallback.
        yield build_local_response(messages, context)
        return
    
    # Build full message history with system prompt and context
    full_messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    
    # Add context if provided
    if context:
        context_msg = build_context_message(context)
        if context_msg:
            full_messages.append({"role": "system", "content": context_msg})
    
    # Add conversation history
    full_messages.extend(messages)
    
    try:
        # Stream response from Grok
        stream = client.chat.completions.create(
            model="grok-beta",  # or grok-2-latest
            messages=full_messages,
            stream=True,
            temperature=0.7,
            max_tokens=1000
        )
        
        for chunk in stream:
            if chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content
                
    except Exception as e:
        # Provider/auth failures should not leak raw API errors into the chat.
        # Keep the conversation useful with the deterministic local assistant.
        print(f"AI provider unavailable; using local response: {e}")
        yield build_local_response(messages, context)


def build_local_response(messages: List[Dict[str, str]], context: Optional[Dict] = None) -> str:
    """Compose a context-aware answer when an external LLM is unavailable."""
    question = next(
        (message.get("content", "") for message in reversed(messages) if message.get("role") == "user"),
        "",
    ).lower()
    context = context or {}
    aqi_data = context.get("aqi_data", {}) or {}
    risk_data = context.get("risk_data", {}) or {}
    aqi_value = aqi_data.get("aqi", context.get("aqi", "unknown"))
    risk_score = risk_data.get("risk_score", context.get("risk_score", context.get("riskScore", "unknown")))
    risk_label = risk_data.get("risk_label", context.get("risk_label", context.get("riskLabel", "unknown")))
    shap_data = context.get("shap_data", {}) or {}
    factors = shap_data.get("features", context.get("topRiskFactors", [])) or []

    route = context.get("route_data") or context.get("routeData") or {}
    if not route.get("safe_route") and context.get("safe_route"):
        route = context
    safe = route.get("safe_route") or {}
    direct = route.get("direct_route") or {}

    def first_value(mapping: Dict, *names: str, default: str = "not available"):
        for name in names:
            value = mapping.get(name)
            if value is not None and value != "":
                return value
        return default

    safe_distance = first_value(safe, "distance_km", "distance", "km")
    direct_distance = first_value(direct, "distance_km", "distance", "km")
    safe_aqi = first_value(safe, "avg_aqi_exposure", "aqi")
    direct_aqi = first_value(direct, "avg_aqi_exposure", "aqi")
    reduction = first_value(route, "exposure_reduction_pct", "exposureReductionPct", "reduction")

    vitals = context.get("vitals") or {}
    asthma = bool(vitals.get("asthma", False)) or "asthma" in question
    heart_concern = any(term in question for term in ("heart", "cardiac", "chest pain", "palpitation"))
    urgent = any(term in question for term in ("hurry", "urgent", "quick", "late", "rush", "right now"))
    is_risk_factors = "risk factor" in question or "contribut" in question or "affecting my score" in question
    is_exposure = "exposure reduction" in question or "how much cleaner" in question or "worth taking" in question
    is_pollutants = "pollutant" in question or "pm2.5" in question or "pm25" in question
    is_route = any(term in question for term in ("route", "commute", "safe path", "travel", "morning", "evening"))
    is_timing = "morning" in question or "evening" in question
    sections = []

    if any(term in question for term in ("what are you", "what is aerohealth", "how does this project", "how does the project")):
        return (
            "I am the AeroHealth assistant. I explain live AQI, personal risk scores, SHAP contributors, "
            "and direct-versus-safe route exposure. AeroHealth combines OpenAQ, OpenStreetMap/OSRM, "
            "XGBoost, and SHAP. Route pollutant values are estimates, and the risk score is a prototype indicator, "
            "not a medical diagnosis."
        )

    if is_route:
        if safe and direct:
            sections.append(
                f"Route comparison: safe is {safe_distance} km at AQI {safe_aqi}; direct is {direct_distance} km at AQI {direct_aqi}; estimated exposure reduction is {reduction}%."
            )
        else:
            sections.append("I do not have the fetched route metrics attached to this chat. Run the route and use Ask AI from the route panel so I can compare it accurately.")
        if is_timing:
            if "morning" in question and "evening" in question:
                sections.append("For timing, morning rush traffic often increases roadside exposure; evening depends more on traffic, wind, and the current AQI. Check the live reading immediately before leaving.")
            elif "morning" in question:
                sections.append("Morning rush traffic often increases roadside exposure. If you must leave then, prefer the lower-AQI route and avoid strenuous activity outdoors.")
            else:
                sections.append("Evening can be better or worse depending on traffic and wind, so compare the live AQI before leaving rather than assuming one time is always safer.")
    if is_exposure:
        if reduction == "not available":
            sections.append("Exposure reduction cannot be calculated until a fetched route comparison is attached.")
        else:
            sections.append(f"The safe route is estimated to reduce exposure by {reduction}% compared with the direct route.")
    if is_pollutants:
        safe_pollutants = safe.get("pollutants") or {}
        direct_pollutants = direct.get("pollutants") or {}
        if not safe_pollutants and not direct_pollutants:
            sections.append("No route pollutant breakdown is attached yet. Run the route comparison first and use Ask AI from the route panel.")
        else:
            sections.append(f"Route pollutants, safe versus direct: PM2.5 {safe_pollutants.get('pm25', 'n/a')} vs {direct_pollutants.get('pm25', 'n/a')}; PM10 {safe_pollutants.get('pm10', 'n/a')} vs {direct_pollutants.get('pm10', 'n/a')}; NO2 {safe_pollutants.get('no2', 'n/a')} vs {direct_pollutants.get('no2', 'n/a')}; SO2 {safe_pollutants.get('so2', 'n/a')} vs {direct_pollutants.get('so2', 'n/a')}; O3 {safe_pollutants.get('o3', 'n/a')} vs {direct_pollutants.get('o3', 'n/a')}.")
    if is_risk_factors:
        if not factors:
            sections.append("No SHAP explanation is attached yet; wait for the dashboard prediction to load.")
        else:
            top_factors = sorted(factors, key=lambda factor: abs(float(factor.get("shap_value", 0))), reverse=True)[:5]
            details = "; ".join(f"{factor.get('name', 'factor')}: {float(factor.get('shap_value', 0)):+.1f}" for factor in top_factors)
            sections.append(f"Strongest score contributors: {details}. Positive SHAP values raise risk; negative values lower it.")
    if any(term in question for term in ("air quality", "aqi", "pollution")):
        sections.append(f"Current AQI is {aqi_value}. Reduce strenuous outdoor activity when pollution is high, and use a well-fitting N95 or KN95 mask outside.")
    if any(term in question for term in ("risk", "score", "health impact")) and not is_risk_factors:
        top_factors = sorted(
            factors,
            key=lambda factor: abs(float(factor.get("shap_value", 0))),
            reverse=True,
        )[:3]
        factor_text = ", ".join(
            f"{factor.get('name', 'factor')} ({float(factor.get('shap_value', 0)):+.1f})"
            for factor in top_factors
        ) or "the current air-quality and vital inputs"
        sections.append(f"Current risk is {risk_score}/100 ({risk_label}); it combines pollution with personal inputs. Largest contributors: {factor_text}.")
    if asthma:
        sections.append("Asthma safety: prefer the lower-exposure route, avoid strenuous outdoor activity during pollution peaks, keep prescribed medication available, and follow your clinician's action plan.")
    if heart_concern:
        sections.append("Because you mentioned heart concerns, avoid strenuous exposure during poor air quality. Seek urgent medical care for chest pain, severe breathlessness, fainting, or symptoms that feel dangerous; this app cannot assess an emergency.")
    if urgent:
        sections.append("If you are in a hurry, prioritize the route with lower AQI exposure, leave promptly, avoid outdoor exertion, and do not ignore serious symptoms just to save time.")
    if sections:
        return " ".join(sections)
    return f"I can interpret the live AeroHealth context: AQI {aqi_value}, risk {risk_score}/100 ({risk_label}). Tell me what decision you are making and I will connect the route, pollutants, vitals, and risk factors." 


def get_quick_explanation(query_type: str, data: Dict) -> str:
    """
    Generate quick explanations for common queries without streaming.
    Used for tooltips and inline help.
    """
    explanations = {
        "aqi": f"AQI (Air Quality Index) of {data.get('aqi', 0)} means the air quality is {'good' if data.get('aqi', 0) < 50 else 'moderate' if data.get('aqi', 0) < 100 else 'unhealthy'}. This is a standardized scale from 0-500 where lower is better.",
        
        "pm25": f"PM2.5 at {data.get('pm25', 0)}µg/m³ - These are tiny particles 30x smaller than a human hair. They penetrate deep into lungs and bloodstream. WHO guideline is <15µg/m³ annual average.",
        
        "risk_score": f"Your risk score of {data.get('risk_score', 0)} is {data.get('risk_label', 'calculated')} based on both air quality and your personal health factors. Higher scores mean greater health impact from current conditions.",
        
        "shap": "SHAP values show how much each factor contributes to your risk. Positive bars (red) increase risk, negative bars (blue) decrease it. The longer the bar, the more it matters for YOU specifically.",
        
        "safe_route": f"The safe route is {data.get('exposure_reduction_pct', 0)}% cleaner because it avoids high-pollution roads. You'll breathe cleaner air for just {data.get('extra_time', 0)} extra minutes.",
        
        "no2": "Nitrogen Dioxide (NO₂) comes mainly from vehicle exhaust. Short-term exposure can irritate airways; long-term exposure linked to respiratory disease.",
        
        "o3": "Ozone (O₃) at ground level is a harmful pollutant (different from protective ozone layer). Causes breathing problems, especially during exercise.",
        
        "asthma": "With asthma, your airways are more sensitive to air pollution. Even moderate AQI can trigger symptoms. Consider the safe route option and avoid outdoor exercise on high-pollution days."
    }
    
    return explanations.get(query_type, "Ask me anything about this data point!")


def generate_health_report(data: Dict) -> Dict:
    """
    Generate a comprehensive health report from user data.
    Returns structured report data for PDF/display.
    """
    aqi_data = data.get("aqi_data", {})
    risk_data = data.get("risk_data", {})
    history_data = data.get("history", [])
    
    # Analyze trends
    if len(history_data) >= 2:
        recent_aqi = [h["aqi"] for h in history_data[-8:]]
        trend = "improving" if recent_aqi[-1] < recent_aqi[0] else "worsening"
        avg_aqi = sum(recent_aqi) / len(recent_aqi)
    else:
        trend = "stable"
        avg_aqi = aqi_data.get("aqi", 0)
    
    # Generate insights
    insights = []
    
    # AQI insights
    current_aqi = aqi_data.get("aqi", 0)
    if current_aqi > 100:
        insights.append({
            "type": "warning",
            "title": "Unhealthy Air Quality",
            "message": f"Current AQI of {current_aqi} may cause breathing discomfort. Sensitive groups should limit outdoor activity."
        })
    elif current_aqi > 50:
        insights.append({
            "type": "caution",
            "title": "Moderate Air Quality",
            "message": f"AQI of {current_aqi} is acceptable for most, but unusually sensitive people should consider reducing prolonged outdoor exertion."
        })
    
    # Risk insights
    risk_score = risk_data.get("risk_score", 0)
    if risk_score >= 50:
        insights.append({
            "type": "alert",
            "title": "Elevated Health Risk",
            "message": f"Your personal risk score of {risk_score} suggests significant health impact. Follow protective measures below."
        })
    
    # Recommendations
    recommendations = []
    
    if current_aqi > 100 or risk_score >= 50:
        recommendations.append("🏠 Stay indoors when possible, especially during peak pollution hours (morning and evening rush)")
        recommendations.append("😷 Wear an N95 or KN95 mask if you must go outside")
        recommendations.append("🚫 Avoid strenuous outdoor exercise")
    
    if current_aqi > 50:
        recommendations.append("🚗 Use the safe route feature for your commute")
        recommendations.append("🪟 Keep windows closed and use air purifier if available")
    
    recommendations.append("💧 Stay hydrated to help your body flush out pollutants")
    recommendations.append("🥗 Eat antioxidant-rich foods (fruits, vegetables)")
    
    return {
        "summary": {
            "current_aqi": current_aqi,
            "risk_score": risk_score,
            "risk_label": risk_data.get("risk_label", "Unknown"),
            "trend": trend,
            "avg_aqi_24h": round(avg_aqi)
        },
        "insights": insights,
        "recommendations": recommendations,
        "timestamp": aqi_data.get("timestamp", ""),
        "location": data.get("location", "Unknown")
    }
