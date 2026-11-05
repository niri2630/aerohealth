import { Info } from "lucide-react";
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useNavigate } from "@tanstack/react-router";

interface TooltipProps {
  content: string | React.ReactNode;
  position?: "top" | "bottom" | "left" | "right";
  className?: string;
  aiPrompt?: string | undefined;
  aiContext?: unknown | undefined;
}

/**
 * Contextual tooltip with info icon
 * Shows explanations when hovering or clicking
 * Can open AI assistant with pre-filled context
 */
export function Tooltip({ content, position = "top", className = "", aiPrompt, aiContext }: TooltipProps) {
  const [show, setShow] = useState(false);
  const navigate = useNavigate();

  const positionClasses = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2"
  };

  function handleAskAI(e: React.MouseEvent) {
    e.stopPropagation();
    if (aiPrompt) {
      // Navigate to assistant with pre-filled prompt and context
      navigate({
        to: "/assistant",
        search: {
          prompt: aiPrompt,
          context: aiContext ? JSON.stringify(aiContext) : undefined
        }
      });
    }
  }

  return (
    <div className="relative inline-block">
      <button
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onClick={(e) => {
          e.stopPropagation();
          setShow(!show);
        }}
        className={`press inline-flex items-center justify-center text-muted-foreground hover:text-primary transition-colors ${className}`}
        aria-label="More information"
      >
        <Info size={14} strokeWidth={1.8} />
      </button>

      <AnimatePresence>
        {show && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: position === "top" ? 5 : -5 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className={`absolute z-50 w-64 rounded-lg border border-hairline bg-background/95 backdrop-blur-md shadow-xl ${positionClasses[position]}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-2.5 text-xs leading-relaxed">
              {typeof content === "string" ? (
                <p className="text-muted-foreground">{content}</p>
              ) : (
                content
              )}
            </div>
            
            {/* Ask AI button */}
            {aiPrompt && (
              <div className="border-t border-hairline px-3 py-2">
                <button
                  onClick={handleAskAI}
                  className="w-full press flex items-center justify-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
                >
                  <span>Ask AI about this</span>
                  <span className="text-[10px]">→</span>
                </button>
              </div>
            )}
            
            {/* Arrow */}
            <div
              className={`absolute size-2 rotate-45 border bg-background ${
                position === "top"
                  ? "bottom-[-4px] left-1/2 -translate-x-1/2 border-r border-b border-t-0 border-l-0"
                  : position === "bottom"
                    ? "top-[-4px] left-1/2 -translate-x-1/2 border-l border-t border-r-0 border-b-0"
                    : position === "left"
                      ? "right-[-4px] top-1/2 -translate-y-1/2 border-t border-r border-l-0 border-b-0"
                      : "left-[-4px] top-1/2 -translate-y-1/2 border-b border-l border-r-0 border-t-0"
              }`}
              style={{ borderColor: "var(--hairline)" }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Inline tooltip for labels
 */
export function InlineTooltip({ label, content }: { label: string; content: string | React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{label}</span>
      <Tooltip content={content} />
    </span>
  );
}

/**
 * Tooltip content helpers for common air quality terms
 */
export const TooltipContent = {
  AQI: (
    <div className="space-y-1.5">
      <p className="font-medium text-foreground">Air Quality Index (AQI)</p>
      <p className="text-muted-foreground">
        A standardized scale from 0-500 that measures overall air pollution. Higher values mean worse air quality.
      </p>
      <div className="space-y-0.5 text-[10px] mt-2">
        <div className="flex justify-between">
          <span>0-50:</span>
          <span className="text-green-500">Good</span>
        </div>
        <div className="flex justify-between">
          <span>51-100:</span>
          <span className="text-yellow-500">Moderate</span>
        </div>
        <div className="flex justify-between">
          <span>101-150:</span>
          <span className="text-orange-500">Unhealthy (sensitive)</span>
        </div>
        <div className="flex justify-between">
          <span>151-200:</span>
          <span className="text-red-500">Unhealthy</span>
        </div>
        <div className="flex justify-between">
          <span>201+:</span>
          <span className="text-purple-500">Very Unhealthy</span>
        </div>
      </div>
    </div>
  ),

  PM25: (
    <div className="space-y-1.5">
      <p className="font-medium text-foreground">PM2.5 (Fine Particles)</p>
      <p className="text-muted-foreground">
        Tiny particles less than 2.5 micrometers in diameter. Small enough to penetrate deep into lungs and bloodstream.
      </p>
      <p className="text-muted-foreground mt-1">
        <strong>Sources:</strong> Vehicle exhaust, industrial emissions, wildfires, cooking smoke.
      </p>
    </div>
  ),

  PM10: (
    <div className="space-y-1.5">
      <p className="font-medium text-foreground">PM10 (Coarse Particles)</p>
      <p className="text-muted-foreground">
        Particles less than 10 micrometers. Can irritate eyes, nose, and throat.
      </p>
      <p className="text-muted-foreground mt-1">
        <strong>Sources:</strong> Dust, pollen, mold, construction sites.
      </p>
    </div>
  ),

  NO2: (
    <div className="space-y-1.5">
      <p className="font-medium text-foreground">NO₂ (Nitrogen Dioxide)</p>
      <p className="text-muted-foreground">
        A reddish-brown gas that can irritate airways and worsen asthma. Measured in parts per billion (ppb).
      </p>
      <p className="text-muted-foreground mt-1">
        <strong>Sources:</strong> Vehicle emissions, power plants, industrial processes.
      </p>
    </div>
  ),

  O3: (
    <div className="space-y-1.5">
      <p className="font-medium text-foreground">O₃ (Ground-level Ozone)</p>
      <p className="text-muted-foreground">
        Not emitted directly—forms when pollutants react with sunlight. Can trigger breathing problems.
      </p>
      <p className="text-muted-foreground mt-1">
        <strong>Note:</strong> Worse on hot, sunny days. Different from protective ozone layer above Earth.
      </p>
    </div>
  ),

  SO2: (
    <div className="space-y-1.5">
      <p className="font-medium text-foreground">SO₂ (Sulfur Dioxide)</p>
      <p className="text-muted-foreground">
        A colorless gas with a sharp smell. Can cause breathing difficulties, especially for people with asthma.
      </p>
      <p className="text-muted-foreground mt-1">
        <strong>Sources:</strong> Fossil fuel combustion, volcanic eruptions, industrial facilities.
      </p>
    </div>
  ),

  RiskScore: (
    <div className="space-y-1.5">
      <p className="font-medium text-foreground">Health Risk Score</p>
      <p className="text-muted-foreground">
        A personalized score (0-100) predicting your health risk from current air quality based on your vitals and conditions.
      </p>
      <p className="text-muted-foreground mt-1">
        Calculated using machine learning with air quality data, your age, heart rate, weight, and respiratory conditions.
      </p>
    </div>
  ),

  SHAP: (
    <div className="space-y-1.5">
      <p className="font-medium text-foreground">SHAP Values</p>
      <p className="text-muted-foreground">
        Shows <strong>why</strong> your risk score is what it is. Each bar shows how much a factor increases (+) or decreases (-) your risk.
      </p>
      <p className="text-muted-foreground mt-1">
        Positive values push your risk higher. Negative values lower it. The base value is your starting risk before factors are applied.
      </p>
    </div>
  ),

  HeartRate: (
    <div className="space-y-1.5">
      <p className="font-medium text-foreground">Heart Rate Impact</p>
      <p className="text-muted-foreground">
        Predicted change in your heart rate over the next 6 hours due to air pollution exposure.
      </p>
      <p className="text-muted-foreground mt-1">
        Positive values mean your heart will work harder. Based on PM2.5, NO₂, and your baseline heart rate.
      </p>
    </div>
  ),

  HRV: (
    <div className="space-y-1.5">
      <p className="font-medium text-foreground">Heart Rate Variability (HRV)</p>
      <p className="text-muted-foreground">
        Variation in time between heartbeats. Higher HRV = better cardiovascular health and stress resilience.
      </p>
      <p className="text-muted-foreground mt-1">
        Air pollution typically decreases HRV (negative impact), indicating increased cardiovascular stress.
      </p>
    </div>
  ),

  RespStress: (
    <div className="space-y-1.5">
      <p className="font-medium text-foreground">Respiratory Stress</p>
      <p className="text-muted-foreground">
        An index measuring breathing difficulty and lung irritation from air pollutants.
      </p>
      <p className="text-muted-foreground mt-1">
        Higher values mean more respiratory strain. Especially important for people with asthma or COPD.
      </p>
    </div>
  ),

  SafeRoute: (
    <div className="space-y-1.5">
      <p className="font-medium text-foreground">Safe Route Algorithm</p>
      <p className="text-muted-foreground">
        Calculates cleaner paths by avoiding high-pollution roads, even if slightly longer.
      </p>
      <p className="text-muted-foreground mt-1">
        Uses real-time AQI data along road segments to minimize your total pollution exposure during the journey.
      </p>
    </div>
  ),

  ExposureReduction: (
    <div className="space-y-1.5">
      <p className="font-medium text-foreground">Exposure Reduction</p>
      <p className="text-muted-foreground">
        Percentage decrease in average air pollution when taking the safe route vs. the direct route.
      </p>
      <p className="text-muted-foreground mt-1">
        <strong>Example:</strong> 35% reduction means you breathe 35% less pollution, which can significantly reduce health impacts.
      </p>
    </div>
  )
};
