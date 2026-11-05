import { motion } from "motion/react";

import { Panel, PanelHead, Shimmer } from "./primitives";
import { EASE } from "@/lib/aero/ui";
import type { Explanation } from "@/lib/aero/types";
import { AskAIButton } from "./AskAIButton";
import { Tooltip, TooltipContent } from "./Tooltip";

export function ShapPanel({
  explanation,
  loading,
}: {
  explanation?: Explanation | undefined;
  loading?: boolean;
}) {
  const feats = explanation?.features.slice(0, 8) ?? [];
  const maxAbs = Math.max(1, ...feats.map((f) => Math.abs(f.shap_value)));

  return (
    <Panel delay={0.32}>
      <div className="flex items-center justify-between px-5 pt-5">
        <div className="flex items-center gap-1.5">
          <span className="label-glyph">why this score</span>
          <Tooltip 
            content={TooltipContent.SHAP} 
            position="right"
            aiPrompt={explanation ? `Explain these SHAP values in detail. Base value: ${explanation.base_value.toFixed(1)}. Top factors: ${feats.slice(0, 5).map(f => `${f.name} (${f.shap_value > 0 ? '+' : ''}${f.shap_value.toFixed(1)})`).join(', ')}. Which factors should I focus on?` : undefined}
            aiContext={explanation ? { features: feats, baseValue: explanation.base_value } : undefined}
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="num text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
            {explanation ? `base value ${explanation.base_value.toFixed(1)}` : "awaiting model"}
          </span>
          {explanation && (
            <AskAIButton
              variant="subtle"
              label="Explain SHAP"
              prompt={`Can you explain what these SHAP values mean and which factors are affecting my health risk the most? Top factors: ${feats.slice(0, 3).map(f => `${f.name}: ${f.shap_value > 0 ? '+' : ''}${f.shap_value.toFixed(1)}`).join(', ')}`}
              context={{ features: feats, baseValue: explanation.base_value }}
            />
          )}
        </div>
      </div>
      <div className="px-5 pb-6">
        {loading || !explanation ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Shimmer key={i} className="h-8" />
            ))}
          </div>
        ) : (
          <div className="relative">
            <div className="absolute top-0 bottom-0 left-1/2 border-l border-dashed border-foreground/25" />
            <span className="num absolute -top-1 left-1/2 ml-2 text-[9px] tracking-[0.14em] text-muted-foreground uppercase">
              base {explanation.base_value.toFixed(1)}
            </span>

            <div className="space-y-2 pt-5">
              {feats.map((f, i) => {
                const w = (Math.abs(f.shap_value) / maxAbs) * 40;
                const positive = f.shap_value >= 0;
                const inside = w > 32;
                return (
                  <div key={f.name} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 text-right text-[12px] text-muted-foreground">
                      {f.name}
                    </span>
                    <div className="relative h-7 flex-1">
                      <motion.div
                        className="absolute top-1/2 h-6 -translate-y-1/2 rounded-md"
                        style={{
                          left: positive ? "50%" : `${50 - w}%`,
                          background: positive
                            ? "color-mix(in oklab, var(--risk-high) 55%, transparent)"
                            : "color-mix(in oklab, var(--primary) 45%, transparent)",
                          borderRight: positive ? "1px solid var(--risk-high)" : undefined,
                          borderLeft: positive ? undefined : "1px solid var(--primary)",
                        }}
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: `${w}%`, opacity: 1 }}
                        transition={{ duration: 0.6, ease: EASE, delay: 0.12 * i }}
                      />
                      <span
                        className="num absolute top-1/2 -translate-y-1/2 text-[11px]"
                        style={{
                          left: positive
                            ? inside
                              ? `calc(50% + ${w}% - 44px)`
                              : `calc(50% + ${w}% + 8px)`
                            : undefined,
                          right: positive
                            ? undefined
                            : inside
                              ? `calc(50% + ${w}% - 44px)`
                              : `calc(50% + ${w}% + 8px)`,
                        }}
                      >
                        {f.shap_value > 0 ? "+" : ""}
                        {f.shap_value.toFixed(1)}
                      </span>
                    </div>
                    <span className="num w-14 shrink-0 text-[10px] text-muted-foreground/70">
                      {f.value}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="mt-5 flex items-center gap-5 border-t border-hairline pt-4">
              <span className="flex items-center gap-2">
                <span className="size-2 rounded-sm bg-[color-mix(in_oklab,var(--risk-high)_60%,transparent)]" />
                <span className="label-glyph">raises risk</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="size-2 rounded-sm bg-[color-mix(in_oklab,var(--primary)_60%,transparent)]" />
                <span className="label-glyph">lowers risk</span>
              </span>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}