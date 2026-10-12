// CORE learns the commander's preferences from what they accept, decline and ask for.

import { sol } from '../sim/core';
import type { ColonyState } from '../sim/state';
import type { Plan } from './planner';

type Dim = keyof ColonyState['core']['prefs'];
export const DIM_TEXT: Record<Dim, [string, string]> = {
  safety: ['speed over safety', 'safety over speed'],
  solar: ['reactors over solar', 'solar over reactors'],
  storage: ['lean storage', 'large storage'],
  mining: ['cautious mining', 'aggressive mining'],
  research: ['production over research', 'research over production'],
};

export function learn(st: ColonyState, items: Plan['learn']) {
  if (!items) return;
  for (const it of items) {
    const before = st.core.prefs[it.dim];
    const after = Math.max(0, Math.min(100, before + it.delta));
    st.core.prefs[it.dim] = after;
    st.core.prefEvidence.unshift({ dim: it.dim, text: it.text, sol: sol(st) });
    st.core.prefEvidence = st.core.prefEvidence.slice(0, 40);
  }
}
/** Declining a safety recommendation nudges the model the other way. */
export function declined(st: ColonyState, p: Plan) {
  if (p.learn?.some((l) => l.dim === 'safety' && l.delta > 0)) learn(st, [{ dim: 'safety', delta: -3, text: 'declined a safety plan' }]);
}

export function prefLines(st: ColonyState): string[] {
  const out: string[] = [];
  for (const [d, v] of Object.entries(st.core.prefs) as [Dim, number][]) {
    if (v >= 58) out.push(`Prefers ${DIM_TEXT[d][1]} (${v})`);
    else if (v <= 42) out.push(`Prefers ${DIM_TEXT[d][0]} (${v})`);
  }
  return out;
}

/** End of sol: what changed in the model, written into the sol report. */
export function solLearned(st: ColonyState) {
  const snap = st.core.prefSnapshot ?? { safety: 50, solar: 50, storage: 50, mining: 50, research: 50 };
  const lines: string[] = [];
  for (const [d, v] of Object.entries(st.core.prefs) as [Dim, number][]) {
    const was = snap[d] ?? 50;
    if (v >= 58 && was < 58) lines.push(`CORE learned: you usually prefer ${DIM_TEXT[d][1]}`);
    if (v <= 42 && was > 42) lines.push(`CORE learned: you usually prefer ${DIM_TEXT[d][0]}`);
  }
  const err = st.core.forecastErr[st.core.forecastErr.length - 1];
  if (err !== undefined) lines.push(`Solar forecast error ${Math.round(err * 100)}% — energy model updated`);
  st.core.prefSnapshot = { ...st.core.prefs };
  st.core.learnedPending.push(...lines);
}
