/**
 * Puter.js AI Integration
 * Free, unlimited Grok access with image generation, TTS, STT, and function calling
 * 
 * Note: puter is loaded via CDN script in index.html
 * Users authenticate through Puter's "User-Pays" model (no API keys needed)
 */

// Declare global puter (loaded via CDN)
declare global {
  interface Window {
    puterInitError?: string;
    puterReady?: boolean;
    puterInitializedAt?: number;
  }
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface StreamChunk {
  text: string;
  done: boolean;
}

type AIContent = string | Record<string, unknown>;

function messageContentToText(content: AIContent | AIContent[] | undefined): string {
  if (typeof content === "string") return content;
  return content === undefined ? "" : JSON.stringify(content) ?? "";
}

/**
 * Wait for Puter.js to be available and ensure user is authenticated
 */
async function waitForPuter(timeoutMs = 10000): Promise<boolean> {
  const startTime = Date.now();

  // Load Puter only for optional voice/image features. Text chat has already
  // tried the backend and does not need this browser SDK.
  if (typeof window !== 'undefined' && !window.puter && !window.puterInitError) {
    try {
      const module = await import('@heyputer/puter.js');
      window.puter = module.default;
      window.puterReady = !!window.puter;
    } catch (error) {
      window.puterInitError = String(error ?? 'Puter initialization failed');
    }
  }

  // First, wait for puter to load. The bootstrap attaches diagnostic flags
  while (Date.now() - startTime < timeoutMs) {
    if (typeof window !== 'undefined') {
      // If bootstrap recorded an error, bail early with diagnostics
      if (window.puterInitError) {
        console.error('Puter initialization error detected:', window.puterInitError);
        return false;
      }

      if (window.puter) return true;
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // timed out waiting for window.puter
  console.error('waitForPuter timed out', {
    elapsedMs: Date.now() - startTime,
    puterInitError: window.puterInitError,
    puterReady: window.puterReady,
    puterInitializedAt: window.puterInitializedAt,
  });
  return false;
}

/**
 * Stream chat responses from Grok with context awareness
 */
export async function* streamGrokChat(
  messages: ChatMessage[],
  context?: any
): AsyncGenerator<string, void, unknown> {
  // Backend chat works on normal localhost and does not require Puter auth,
  // Chrome flags, microphone permissions, or a secure-origin override.
  const backendBase = (import.meta.env["VITE_API_URL"] ?? "").replace(/\/$/, "");
  if (backendBase) {
    try {
      const response = await fetch(`${backendBase}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages, context }),
      });
      if (response.ok && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          if (chunk) yield chunk;
        }
        return;
      }
    } catch (error) {
      console.warn("Backend AI unavailable; trying optional browser AI", error);
    }
  }

  try {
    // Wait for Puter.js to load
    const puterAvailable = await waitForPuter();
    if (!puterAvailable) {
      yield buildLocalAssistantResponse(messages, context);
      return;
    }

    const puter = window.puter;

    // Build system prompt with context
    const systemPrompt = buildSystemPrompt(context);
    const fullMessages = [
      { role: 'system', content: systemPrompt, images: [] },
      ...messages.map((message) => ({ ...message, images: [] })),
    ];

    const response = await puter.ai.chat(fullMessages, {
      model: 'x-ai/grok-4-1-fast',
      stream: true,
      temperature: 0.7,
      max_tokens: 1000
    });

    for await (const part of response) {
      if (part.text) {
        yield part.text;
      }
    }
  } catch (error: any) {
    console.error('Grok chat error:', error);
    
    // Check if it's an authentication error
    if (error?.message?.includes('Unauthorized') || error?.message?.includes('auth')) {
      yield `\n\n🔐 **Authentication Required**\n\n`;
      yield `Puter.js needs you to sign in to use Grok for free.\n\n`;
      yield `**How it works:**\n`;
      yield `• Puter uses a "User-Pays" model\n`;
      yield `• Each user covers their own AI usage through their Puter account\n`;
      yield `• No API keys, no developer costs!\n\n`;
      yield `**To get started:**\n`;
      yield `1. Visit [puter.com](https://puter.com) and create a free account\n`;
      yield `2. Come back and refresh this page\n`;
      yield `3. Puter will authenticate you automatically\n\n`;
      yield `Once authenticated, you'll have unlimited access to Grok AI! 🚀`;
    } else {
      yield buildLocalAssistantResponse(messages, context);
    }
  }
}

function buildLocalAssistantResponse(messages: ChatMessage[], context?: any): string {
  const latest = messages[messages.length - 1]?.content?.toLowerCase() ?? "";
  const aqi = Number(context?.aqi ?? 0);
  const risk = Number(context?.riskScore ?? 0);
  const location = context?.location ?? "your current location";
  const route = context?.route_data ?? context?.routeData ?? context;
  const safe = route?.safe_route ?? {};
  const direct = route?.direct_route ?? {};
  const hasRoute = Boolean(route?.safe_route && route?.direct_route);
  const factors = context?.shap_data?.features ?? context?.topRiskFactors ?? [];
  const isExposure = latest.includes("exposure reduction") || latest.includes("how much cleaner");
  const isFactors = latest.includes("risk factor") || latest.includes("contribut") || latest.includes("affecting my score");
  const isPollutants = latest.includes("pollutant") || latest.includes("pm2.5") || latest.includes("pm25");

  if (latest.includes("what are you") || latest.includes("what is aerohealth") || latest.includes("how does this project")) {
    return "I am the AeroHealth assistant. I explain the app's live AQI, personal risk score, SHAP contributors, and direct-versus-safe route exposure. AeroHealth combines OpenAQ, OpenStreetMap/OSRM, XGBoost, and SHAP. Route pollutant values are estimates, and the risk score is a prototype indicator rather than a medical diagnosis.";
  }

  if (isExposure) {
    if (!hasRoute) return "I do not have a route comparison attached to this chat yet. Run the route on the dashboard, then use Ask AI from the route panel so I can calculate the exposure reduction.";
    return `The safe route reduces estimated exposure by ${route.exposure_reduction_pct ?? "not available"}%. Safe-route AQI is ${safe.avg_aqi_exposure ?? "not available"}, compared with ${direct.avg_aqi_exposure ?? "not available"} on the direct route.`;
  }
  if (isFactors) {
    if (!factors.length) return "The SHAP explanation has not been attached yet. Wait for the dashboard prediction to load, then ask again.";
    const strongest = [...factors].sort((a, b) => Math.abs(Number(b.shap_value ?? 0)) - Math.abs(Number(a.shap_value ?? 0))).slice(0, 5);
    return `The strongest contributors are ${strongest.map((factor) => `${factor.name}: ${Number(factor.shap_value ?? 0) >= 0 ? "+" : ""}${Number(factor.shap_value ?? 0).toFixed(1)}`).join(", ")}. Positive values raise risk; negative values lower it.`;
  }
  if (isPollutants) {
    if (!hasRoute) return "No route pollutant breakdown is attached yet. Calculate a route and use Ask AI from its comparison panel.";
    const values = (leg: any) => `PM2.5 ${leg.pollutants?.pm25 ?? "n/a"}, PM10 ${leg.pollutants?.pm10 ?? "n/a"}, NO2 ${leg.pollutants?.no2 ?? "n/a"}, SO2 ${leg.pollutants?.so2 ?? "n/a"}, O3 ${leg.pollutants?.o3 ?? "n/a"}`;
    return `Safe route: ${values(safe)}. Direct route: ${values(direct)}.`;
  }

  if ((latest.includes("route") || latest.includes("commute")) && !isExposure && !isPollutants && !isFactors) {
    const routeDetails = safe && direct
      ? `Safe: ${safe.distance_km} km, AQI ${safe.avg_aqi_exposure}; direct: ${direct.distance_km} km, AQI ${direct.avg_aqi_exposure}; exposure reduction: ${route.exposure_reduction_pct ?? "not available"}%.`
      : `Route metrics are not attached to this chat yet. Open the route comparison and use its Ask AI button so I can read the fetched route values.`;
    const timing = latest.includes("morning") && latest.includes("evening")
      ? "Compare both departure times: morning rush traffic can raise roadside exposure, while evening conditions depend on traffic and wind."
      : latest.includes("morning")
        ? "Morning rush traffic can raise roadside exposure, so the lower-exposure route is preferable."
        : latest.includes("evening")
          ? "Evening conditions depend on traffic, wind, and the current AQI, so check the reading before leaving."
          : "Prefer the safe route when the exposure reduction is meaningful, especially with asthma.";
    return `${routeDetails} ${timing}`;
  }
  if (latest.includes("pm2.5") || latest.includes("pollution") || latest.includes("aqi")) {
    return `At ${location}, the current AQI is ${aqi}. PM2.5 is especially important because fine particles can travel deep into the lungs. Limit strenuous outdoor activity when pollution is high and use a well-fitting N95 or KN95 mask outdoors.`;
  }
  if (latest.includes("risk") || latest.includes("score")) {
    return `Your current AeroHealth risk score is ${risk}/100. It combines air-quality readings with personal factors such as age, heart rate, weight, humidity, and asthma status. Use the SHAP panel to see which factors are contributing most.`;
  }
  return `I can still help with your AeroHealth data even when online AI is unavailable. Ask about your AQI, risk score, pollutants, SHAP factors, or whether the safer route is worth taking.`;
}

/**
 * Get single non-streaming response from Grok
 */
export async function getGrokResponse(
  prompt: string,
  context?: any
): Promise<string> {
  try {
    const puterAvailable = await waitForPuter();
    if (!puterAvailable) {
      return 'Puter.js is not available. Please refresh the page.';
    }

    const puter = window.puter;
    const systemPrompt = buildSystemPrompt(context);
    const response = await puter.ai.chat([
      { role: 'system', content: systemPrompt, images: [] },
      { role: 'user', content: prompt, images: [] }
    ], {
      model: 'x-ai/grok-4-1-fast',
      temperature: 0.7
    });

    return messageContentToText(response.message?.content);
  } catch (error) {
    console.error('Grok response error:', error);
    return 'Sorry, I could not generate a response.';
  }
}

/**
 * Analyze image with Grok Vision
 */
export async function analyzeImage(
  imageUrl: string,
  question: string = "What do you see in this image and how does it relate to air quality?"
): Promise<string> {
  try {
    const puterAvailable = await waitForPuter();
    if (!puterAvailable) {
      return 'Puter.js is not available. Please refresh the page.';
    }

    const puter = window.puter;
    const response = await puter.ai.chat(
      question,
      imageUrl,
      { model: "x-ai/grok-4-1-fast" }
    );
    return messageContentToText(response.message?.content);
  } catch (error) {
    console.error('Image analysis error:', error);
    return 'Could not analyze the image.';
  }
}

/**
 * Generate visualization image from text prompt
 */
export async function generateVisualization(prompt: string): Promise<HTMLImageElement> {
  try {
    const puterAvailable = await waitForPuter();
    if (!puterAvailable) {
      throw new Error('Puter.js not available');
    }

    const puter = window.puter;
    const image = await puter.ai.txt2img({
      prompt,
      model: 'x-ai/grok-imagine-image',
    });
    return image;
  } catch (error) {
    console.error('Image generation error:', error);
    throw error;
  }
}

/**
 * Text-to-speech for voice responses
 */
export async function speakResponse(
  text: string,
  voice: 'eve' | 'ara' | 'rex' | 'sal' | 'leo' = 'eve'
): Promise<HTMLAudioElement> {
  try {
    const puterAvailable = await waitForPuter();
    if (!puterAvailable) {
      throw new Error('Puter.js not available');
    }

    const puter = window.puter;
    const audio = await puter.ai.txt2speech(text, {
      provider: "xai",
      voice,
      output_format: "mp3"
    });
    return audio;
  } catch (error) {
    console.error('TTS error:', error);
    throw error;
  }
}

/**
 * Speech-to-text for voice input
 */
export async function transcribeSpeech(audioFile: string | File): Promise<string> {
  try {
    const puterAvailable = await waitForPuter();
    if (!puterAvailable) {
      throw new Error('Puter.js not available');
    }

    const puter = window.puter;
    const transcript = await puter.ai.speech2txt({
      file: audioFile,
      provider: 'xai',
      language: 'en',
      format: true
    });
    return transcript.text;
  } catch (error) {
    console.error('STT error:', error);
    throw error;
  }
}

/**
 * Function calling - Grok can call these functions
 */
export const availableFunctions = {
  getCurrentAQI: {
    name: 'getCurrentAQI',
    description: 'Get current air quality data for the user location',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  getRiskScore: {
    name: 'getRiskScore',
    description: 'Get the user\'s current health risk score and explanation',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  findSafeRoute: {
    name: 'findSafeRoute',
    description: 'Calculate a cleaner air route from origin to destination',
    parameters: {
      type: 'object',
      properties: {
        origin: { type: 'string', description: 'Starting location' },
        destination: { type: 'string', description: 'Destination location' }
      },
      required: ['origin', 'destination']
    }
  },
  explainSHAP: {
    name: 'explainSHAP',
    description: 'Explain what SHAP values mean and which factors affect risk most',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  getRecommendations: {
    name: 'getRecommendations',
    description: 'Get personalized health recommendations based on current conditions',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    }
  }
};

/**
 * Execute function calls from Grok
 */
export async function executeFunctionCall(
  functionName: string,
  args: any,
  appContext: any
): Promise<any> {
  switch (functionName) {
    case 'getCurrentAQI':
      return appContext.aqiData || { aqi: 0, message: 'No AQI data available' };
    
    case 'getRiskScore':
      return appContext.riskData || { risk_score: 0, risk_label: 'Unknown' };
    
    case 'findSafeRoute':
      // Trigger route calculation
      return { message: `Finding safe route from ${args.origin} to ${args.destination}...` };
    
    case 'explainSHAP':
      return appContext.shapData || { message: 'SHAP data not available' };
    
    case 'getRecommendations':
      return generateRecommendations(appContext);
    
    default:
      return { error: 'Unknown function' };
  }
}

/**
 * Chat with function calling support
 */
export async function* streamGrokWithFunctions(
  messages: ChatMessage[],
  context: any
): AsyncGenerator<string, void, unknown> {
  try {
    const puterAvailable = await waitForPuter();
    if (!puterAvailable) {
      yield "⚠️ Puter.js is not loaded. Please refresh the page.";
      return;
    }

    const puter = window.puter;
    const systemPrompt = buildSystemPrompt(context);
    
    const response = await puter.ai.chat(messages.map((message) => ({ ...message, images: [] })), {
      model: 'x-ai/grok-4-1-fast',
      stream: true,
      tools: Object.values(availableFunctions).map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })),
    });

    for await (const part of response) {
      if (part.type === "tool_use" && part.name) {
        const result = await executeFunctionCall(part.name, part.input, context);
        yield `\n[Function: ${part.name}]\n${JSON.stringify(result, null, 2)}\n`;
      } else if (part.text) {
        yield part.text;
      }
    }
  } catch (error) {
    console.error('Function calling error:', error);
    yield '⚠️ Error during function execution.';
  }
}

function buildSystemPrompt(context?: any): string {
  let prompt = `You are AeroHealth AI Assistant, an expert in air quality and personal health powered by advanced AI.

Your personality:
- Warm, empathetic, and supportive (health is personal)
- Clear and simple (avoid jargon unless explaining)
- Actionable (give specific, practical advice)
- Encouraging (help users make healthier choices)

Your capabilities:
- Explain air quality metrics (AQI, PM2.5, NO₂, O₃, etc.)
- Interpret health risk scores and SHAP explanations
- Provide personalized health advice based on user data
- Compare routes and explain exposure differences
- Generate visualizations of air quality data
- Answer health questions with scientific accuracy

Guidelines:
- Use everyday language (not medical textbook speak)
- Reference specific numbers from user's current data
- Explain the "why" behind recommendations
- For vulnerable groups (asthma, elderly, children), emphasize extra caution
- Be concise but thorough - respect the user's time`;

  if (context) {
    prompt += '\n\nCurrent user context:';
    
    if (context.location) {
      prompt += `\n- Location: ${context.location}`;
    }
    
    if (context.aqi) {
      prompt += `\n- Current AQI: ${context.aqi}`;
    }
    
    if (context.riskScore !== undefined) {
      prompt += `\n- Risk Score: ${context.riskScore}/100 (${context.riskLabel || 'unknown'})`;
    }
    
    if (context.vitals) {
      const v = context.vitals;
      prompt += `\n- User vitals: Age ${v.age}, Heart rate ${v.heart_rate} bpm, Asthma: ${v.asthma ? 'Yes' : 'No'}, Hypertension: ${v.hypertension ? 'Yes' : 'No'}, SpO2: ${v.spo2 ?? 'n/a'}%, Height: ${v.height ?? 'n/a'} cm, Activity: ${v.activity ?? 'resting'}, Mask: ${v.mask ?? 'none'}`;
    }
    
    if (context.topRiskFactors && context.topRiskFactors.length > 0) {
      const factors = context.topRiskFactors.slice(0, 3).map((f: any) => `${f.name}: ${f.shap_value > 0 ? '+' : ''}${f.shap_value.toFixed(1)}`).join(', ');
      prompt += `\n- Top risk factors: ${factors}`;
    }
  }

  return prompt;
}

/**
 * Generate recommendations based on context
 */
function generateRecommendations(context: any): any {
  const recs = [];
  const aqi = context.aqi || 0;
  const riskScore = context.riskScore || 0;
  
  if (aqi > 100) {
    recs.push('🏠 Stay indoors when possible');
    recs.push('😷 Wear N95 mask if going outside');
    recs.push('🚫 Avoid strenuous outdoor exercise');
  }
  
  if (riskScore >= 50) {
    recs.push('🚗 Use safe route feature');
    recs.push('💊 Have rescue medications ready (if applicable)');
  }
  
  if (context.vitals?.asthma) {
    recs.push('🌡️ Monitor symptoms closely');
    recs.push('📱 Keep emergency contacts handy');
  }
  
  recs.push('💧 Stay hydrated');
  recs.push('🥗 Eat antioxidant-rich foods');
  
  return { recommendations: recs };
}

export default {
  streamGrokChat,
  getGrokResponse,
  analyzeImage,
  generateVisualization,
  speakResponse,
  transcribeSpeech,
  streamGrokWithFunctions
};
