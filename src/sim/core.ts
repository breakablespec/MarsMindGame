// Shared simulation helpers: time, RNG, events, history, alerts, research modifiers.

import { mulberry32Step } from './rng';
import { MIN_PER_SOL, TechId, TUNE } from './defs';
import type { Alert, ColonyState, HistoryEntry, MemoryEntry } from './state';

// ------------------------------------------------------------------ time

export const solOf = (minute: number) => Math.floor(minute / MIN_PER_SOL) + 1;
export const hourOf = (minute: number) => (minute % MIN_PER_SOL) / 60;
export const sol = (st: ColonyState) => solOf(st.minute);
export const hour = (st: ColonyState) => hourOf(st.minute);
export function clock(minute: number) { const m = minute % MIN_PER_SOL; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
export const isNight = (st: ColonyState) => { const h = hour(st); return h < 6 || h >= 19; };
export function sun(minute: number) { const h = hourOf(minute); return h < 6 || h > 19 ? 0 : Math.max(0, Math.sin((Math.PI * (h - 6)) / 13)); }
/** Light level 0..1 for rendering (with twilight). */
export function daylight(minute: number) { const h = hourOf(minute); if (h >= 7 && h <= 18) return 1; if (h <= 5 || h >= 20) return 0; return h < 7 ? (h - 5) / 2 : (20 - h) / 2; }
export const realMinutes = (gameMinutes: number) => (gameMinutes * TUNE_SEC) / 60;
const TUNE_SEC = 0.5;

// ------------------------------------------------------------------ rng in state

export function rand(st: ColonyState): number { const [v, s] = mulberry32Step(st.rng); st.rng = s; return v; }
export const randInt = (st: ColonyState, lo: number, hi: number) => lo + Math.floor(rand(st) * (hi - lo + 1));

// ------------------------------------------------------------------ events (for render/audio)

export interface SimEvent { type: string; x?: number; y?: number; data?: Record<string, unknown> }
type Listener = (e: SimEvent) => void;
const listeners: Listener[] = [];
export function onSim(l: Listener) { listeners.push(l); }
export function emit(_st: ColonyState, type: string, x?: number, y?: number, data?: Record<string, unknown>) { for (const l of listeners) l({ type, x, y, data }); }

// ------------------------------------------------------------------ history, memory

export function addHistory(st: ColonyState, text: string, kind: HistoryEntry['kind'] = 'milestone') {
  st.history.push({ sol: sol(st), minute: st.minute, text, kind });
  if (st.history.length > 200) st.history.splice(0, st.history.length - 200);
  emit(st, 'history', undefined, undefined, { text, kind });
}
export function first(st: ColonyState, key: string, text: string, kind: HistoryEntry['kind'] = 'milestone') {
  if (st.firsts[key] !== undefined) return false;
  st.firsts[key] = st.minute;
  addHistory(st, text, kind);
  return true;
}
export function remember(st: ColonyState, text: string, source: string, ok: boolean, kind: MemoryEntry['kind'] = 'command') {
  st.core.memory.unshift({ sol: sol(st), minute: st.minute, text, source, ok, kind });
  if (st.core.memory.length > 120) st.core.memory.length = 120;
}

// ------------------------------------------------------------------ alerts

export function raise(st: ColonyState, key: string, kind: string, title: string, detail: string, severity: Alert['severity'], target?: number): Alert {
  let a = st.alerts.find((q) => q.key === key && !q.resolved);
  if (a) { a.title = title; a.detail = detail; a.severity = severity; return a; }
  a = { id: st.nextId++, key, kind, title, detail, severity, since: st.minute, target };
  st.alerts.push(a);
  if (severity !== 'info') { st.core.emergencies.raised++; st.sol.emergencies++; }
  emit(st, 'alert', undefined, undefined, { id: a.id, severity, title });
  return a;
}
export function resolve(st: ColonyState, key: string) {
  const a = st.alerts.find((q) => q.key === key && !q.resolved);
  if (!a) return;
  a.resolved = st.minute;
  if (a.severity !== 'info') { st.core.emergencies.resolved++; st.core.emergencies.times.push(st.minute - a.since); if (st.core.emergencies.times.length > 20) st.core.emergencies.times.shift(); }
  emit(st, 'resolved', undefined, undefined, { title: a.title });
}
export const activeAlerts = (st: ColonyState) => st.alerts.filter((a) => !a.resolved);
export function pruneAlerts(st: ColonyState) { st.alerts = st.alerts.filter((a) => !a.resolved || st.minute - a.resolved < 120); }

// ------------------------------------------------------------------ modifiers

export const has = (st: ColonyState, t: TechId) => st.research.done.includes(t);
export function mods(st: ColonyState) {
  const techs = st.colonists.filter((c) => !c.dead && c.role === 'technician').length;
  const engineers = st.colonists.filter((c) => !c.dead && c.role === 'engineer').length;
  const miners = st.colonists.filter((c) => !c.dead && c.role === 'miner').length;
  return {
    solar: has(st, 'solar_eff') ? 1.12 : 1,
    o2: has(st, 'electrolysis') ? 1.25 : 1,
    water: has(st, 'water_recl') ? 0.5 : 1,
    leak: has(st, 'sealed') ? 0.4 : 1,
    speed: has(st, 'dispatch') ? 1.15 : 1,
    cargo: has(st, 'swarm') ? 1.25 : 1,
    mining: (has(st, 'drills') ? 1.3 : 1) * (1 + 0.1 * Math.min(2, miners)),
    build: (has(st, 'prefab') ? 1.3 : 1) * (1 + 0.15 * Math.min(2, engineers)),
    titaniumCost: has(st, 'lattice') ? 0.8 : 1,
    damage: has(st, 'bracing') ? 0.5 : 1,
    breakdown: has(st, 'predictive') ? 0.3 : 1,
    robotEff: 1 + 0.1 * Math.min(2, techs),
    repair: 1 + 0.25 * Math.min(2, techs),
    beds: has(st, 'bunks') ? 6 : 4,
    parallelBuilds: has(st, 'core2') ? 3 : 2,
    forecastLead: has(st, 'forecast') ? 2 : 1,
  };
}
export function scaledCost(st: ColonyState, cost: Partial<Record<string, number>>) {
  const m = mods(st);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(cost)) out[k] = Math.ceil((v ?? 0) * (k === 'titanium' ? m.titaniumCost : 1));
  return out;
}
export { TUNE };
