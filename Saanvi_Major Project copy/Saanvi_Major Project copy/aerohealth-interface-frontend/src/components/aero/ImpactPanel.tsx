import { Activity, Gauge, HeartPulse, Wind } from "lucide-react";
import { motion } from "motion/react";

import { CountUp, Panel, PanelHead, Shimmer } from "./primitives";
import { EASE } from "@/lib/aero/ui";
import type { Activity as ActivityLevel, MaskType, Prediction, Vitals } from "@/lib/aero/types";
import { ACTIVITY_LABEL, ACTIVITY_VENTILATION_LPM, MASK_LABEL } from "@/lib/aero/exposure-profile";
import { AskAIButton } from "./AskAIButton";
import { Tooltip, TooltipContent } from "./Tooltip";

function MetricRow({
  icon,
  name,
  value,
  unit,
  index,
  tooltip,
  aiPrompt,
  aiContext,
}: {
  icon: React.ReactNode;
  name: string;
  value: number;
  unit: string;
  index: number;
  tooltip?: React.ReactNode;
  aiPrompt?: string;
  aiContext?: unknown;
}) {
  const up = value >= 0;
  const mag = Math.min(1, Math.abs(value) / 30);
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE, delay: 0.06 * index }}
      className="inset-tier relative overflow-hidden px-4 py-3"
    >
      <div
        aria-hidden
        className="absolute inset-y-0 left-0 opacity-[0.14]"
        style={{
          width: `${20 + mag * 80}%`,
          background: "linear-gradient(to right, var(--primary), transparent)",
        }}
      />
      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-primary">{icon}</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[13px]">{name}</span>
            {tooltip && (
              <Tooltip 
                content={tooltip} 
                position="right"
                aiPrompt={aiPrompt}
                aiContext={aiContext}
              />
            )}
          </div>
        </div>
        <div className="flex items-baseline gap-1">
          <CountUp
            value={value}
            digits={1}
            prefix={up ? "+" : ""}
            className="text-xl tracking-tight"
          />
          <span className="num text-[10px] text-muted-foreground">{unit}</span>
        </div>
      </div>
    </motion.div>
  );
}

function Control({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="label-glyph">{label}</span>
        <span className="num text-[11px]">
          {value}
          <span className="text-muted-foreground"> {unit}</span>
        </span>
      </div>
      <div className="relative mt-2 h-4">
        <div className="absolute top-1/2 h-[3px] w-full -translate-y-1/2 rounded-full bg-surface-3" />
        <div
          className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-primary"
          style={{ width: `${pct}%`, boxShadow: "0 0 10px -1px var(--primary)" }}
        />
        <input
          type="range"
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full cursor-pointer appearance-none bg-transparent [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-primary [&::-webkit-slider-thumb]:bg-background [&::-webkit-slider-thumb]:shadow-[0_0_12px_-1px_var(--primary)] [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:active:scale-90"
        />
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="press flex w-full items-center justify-between rounded-xl border border-hairline bg-surface-2 px-4 py-3 transition-colors hover:border-primary/35"
    >
      <span className="label-glyph">{label}</span>
      <span
        className="relative h-5 w-9 rounded-full border border-hairline transition-colors"
        style={{
          background: checked ? "color-mix(in oklab, var(--primary) 30%, transparent)" : "var(--surface-3)",
        }}
      >
        <motion.span
          className="absolute top-[2px] size-3.5 rounded-full bg-foreground/85"
          animate={{ left: checked ? 18 : 3 }}
          transition={{ type: "spring", stiffness: 520, damping: 34 }}
        />
      </span>
    </button>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  hint?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="label-glyph">{label}</span>
        {hint ? <span className="num text-[10px] text-muted-foreground">{hint}</span> : null}
      </div>
      <div role="radiogroup" aria-label={label} className="mt-2 grid auto-cols-fr grid-flow-col gap-1 rounded-xl border border-hairline bg-surface-2 p-1">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(option.value)}
              className={`press rounded-lg px-2 py-1.5 text-[11px] transition-colors ${
                active
                  ? "border border-primary/40 bg-primary/15 text-primary"
                  : "border border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const ACTIVITY_OPTIONS = (Object.keys(ACTIVITY_LABEL) as ActivityLevel[]).map((value) => ({
  value,
  label: ACTIVITY_LABEL[value],
}));
const MASK_OPTIONS = (Object.keys(MASK_LABEL) as MaskType[]).map((value) => ({
  value,
  label: MASK_LABEL[value],
}));

export function ImpactPanel({
  prediction,
  loading,
  vitals,
  onVitals,
}: {
  prediction?: Prediction | undefined;
  loading?: boolean;
  vitals: Vitals;
  onVitals: (v: Vitals) => void;
}) {
  const p = prediction?.predicted_impacts;
  return (
    <Panel className="flex flex-col" delay={0.24}>
      <PanelHead 
        label="predicted health impact" 
        hint="next 6h"
        right={
          p && (
            <AskAIButton
              variant="subtle"
              label="Explain impact"
              prompt={`My predicted health impacts are: Heart rate ${p.heart_rate_delta > 0 ? '+' : ''}${p.heart_rate_delta.toFixed(1)} bpm, HRV ${p.hrv_delta > 0 ? '+' : ''}${p.hrv_delta.toFixed(1)} ms, Respiratory stress ${p.resp_stress_delta > 0 ? '+' : ''}${p.resp_stress_delta.toFixed(1)}. What do these numbers mean for my health?`}
              context={{ impacts: p, vitals }}
            />
          )
        }
      />
      <div className="space-y-2 px-4">
        {loading || !p ? (
          Array.from({ length: 4 }).map((_, i) => <Shimmer key={i} className="h-[58px]" />)
        ) : (
          <>
            <MetricRow
              icon={<HeartPulse size={15} strokeWidth={1.5} />}
              name="Heart rate"
              value={p.heart_rate_delta}
              unit="bpm"
              index={0}
              tooltip={TooltipContent.HeartRate}
              aiPrompt={`My predicted heart rate change is ${p.heart_rate_delta > 0 ? '+' : ''}${p.heart_rate_delta.toFixed(1)} bpm over the next 6 hours. What does this mean for my cardiovascular health?`}
              aiContext={{ heartRateDelta: p.heart_rate_delta, vitals }}
            />
            <MetricRow
              icon={<Activity size={15} strokeWidth={1.5} />}
              name="HRV"
              value={p.hrv_delta}
              unit="ms"
              index={1}
              tooltip={TooltipContent.HRV}
              aiPrompt={`My HRV (Heart Rate Variability) is predicted to change by ${p.hrv_delta > 0 ? '+' : ''}${p.hrv_delta.toFixed(1)} ms. What does this indicate about my stress and health?`}
              aiContext={{ hrvDelta: p.hrv_delta, vitals }}
            />
            <MetricRow
              icon={<Wind size={15} strokeWidth={1.5} />}
              name="Respiratory stress"
              value={p.resp_stress_delta}
              unit="idx"
              index={2}
              tooltip={TooltipContent.RespStress}
              aiPrompt={`Respiratory stress index change is ${p.resp_stress_delta > 0 ? '+' : ''}${p.resp_stress_delta.toFixed(1)}. Should I be concerned? What precautions should I take?`}
              aiContext={{ respStressDelta: p.resp_stress_delta, vitals }}
            />
            {typeof p.systolic_bp_delta === "number" ? (
              <MetricRow
                icon={<Gauge size={15} strokeWidth={1.5} />}
                name="Systolic BP"
                value={p.systolic_bp_delta}
                unit="mmHg"
                index={3}
                aiPrompt={`My predicted systolic blood pressure rise is +${p.systolic_bp_delta.toFixed(1)} mmHg${vitals.hypertension ? " and I have hypertension" : ""}. How concerned should I be, and what can I do about it?`}
                aiContext={{ systolicBpDelta: p.systolic_bp_delta, vitals }}
              />
            ) : null}
          </>
        )}
      </div>

      <div className="mt-5 space-y-5 border-t border-hairline px-4 pt-5 pb-5">
        <span className="label-glyph">your profile</span>
        <Control
          label="resting heart rate"
          value={vitals.heart_rate}
          min={45}
          max={140}
          unit="bpm"
          onChange={(heart_rate) => onVitals({ ...vitals, heart_rate })}
        />
        <Control
          label="age"
          value={vitals.age}
          min={12}
          max={90}
          unit="yrs"
          onChange={(age) => onVitals({ ...vitals, age })}
        />
        <Control
          label="weight"
          value={vitals.weight}
          min={35}
          max={150}
          unit="kg"
          onChange={(weight) => onVitals({ ...vitals, weight })}
        />
        <Control
          label="height"
          value={vitals.height}
          min={120}
          max={220}
          unit="cm"
          onChange={(height) => onVitals({ ...vitals, height })}
        />
        <Control
          label="blood oxygen (SpO₂)"
          value={vitals.spo2}
          min={90}
          max={100}
          unit="%"
          onChange={(spo2) => onVitals({ ...vitals, spo2 })}
        />
        <ToggleRow
          label="asthma / respiratory condition"
          checked={vitals.asthma}
          onChange={(asthma) => onVitals({ ...vitals, asthma })}
        />
        <ToggleRow
          label="hypertension / cardiovascular condition"
          checked={vitals.hypertension}
          onChange={(hypertension) => onVitals({ ...vitals, hypertension })}
        />
        <Segmented
          label="activity / exertion"
          value={vitals.activity}
          options={ACTIVITY_OPTIONS}
          hint={`${ACTIVITY_VENTILATION_LPM[vitals.activity]} L/min air`}
          onChange={(activity) => onVitals({ ...vitals, activity })}
        />
        <Segmented
          label="mask protection"
          value={vitals.mask}
          options={MASK_OPTIONS}
          onChange={(mask) => onVitals({ ...vitals, mask })}
        />
      </div>
    </Panel>
  );
}