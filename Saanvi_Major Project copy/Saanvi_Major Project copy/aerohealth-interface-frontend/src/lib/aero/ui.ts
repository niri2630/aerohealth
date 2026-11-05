import type { RiskLabel } from "./types";

export const RISK_VAR: Record<RiskLabel, string> = {
  Low: "var(--risk-low)",
  Moderate: "var(--risk-moderate)",
  High: "var(--risk-high)",
  Severe: "var(--risk-severe)",
};

export const EASE = [0.16, 1, 0.3, 1] as const;

export function riskColor(label: RiskLabel) {
  return RISK_VAR[label];
}

export function fmt(n: number, digits = 0) {
  return n.toFixed(digits);
}

export function clockOf(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}