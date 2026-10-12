// AI performance scores — computed from outcomes, never invented.

import type { ColonyState } from '../sim/state';
import { LEVEL } from './autonomy';

export function coreVersion(st: ColonyState) { const lv = 1 + Math.floor(st.core.xp / 60); return { level: lv, text: `AI CORE v1.${lv}` }; }

export function aiScores(st: ColonyState) {
  const c = st.core;
  const S = st.sol, Pv = st.prevSol;
  const sum = (k: keyof typeof S) => (S[k] as number) + (Pv ? (Pv[k] as number) : 0);
  const planned = c.plans.done + c.plans.failed;
  const errs = c.plans.estErr.slice(-10);
  const avgErr = errs.length ? errs.reduce((a, b) => a + Math.abs(b), 0) / errs.length : 0.25;
  const planning = planned ? Math.round(100 * (c.plans.done / planned) * (1 - Math.min(0.5, avgErr) * 0.6)) : 70;
  const tot = sum('robotTotal'), busy = sum('robotBusy');
  const logistics = Math.round(Math.max(0, Math.min(100, (tot ? busy / tot : 0.4) * 110 + 20 - Math.min(20, sum('shortageMinutes') / 30))));
  const pm = sum('powerMinutes'), pok = sum('powerOkMinutes');
  const fe = c.forecastErr.length ? c.forecastErr.reduce((a, b) => a + b, 0) / c.forecastErr.length : 0.2;
  const energy = Math.round((pm ? pok / pm : 1) * 70 + (1 - Math.min(1, fe)) * 30);
  const mins = Math.max(1, sum('powerMinutes'));
  const resource = Math.round(Math.max(0, 100 - (sum('shortageMinutes') / mins) * 120 - (sum('overloadMinutes') / mins) * 80));
  const times = c.emergencies.times;
  const avgT = times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
  const emergency = avgT === null ? 75 : Math.round(Math.max(0, Math.min(100, 100 - avgT / 4 - st.deaths * 15)));
  const autonomy = Math.round(Math.min(100, (c.initiated.count ? (c.initiated.ok / c.initiated.count) * 60 : 30) + LEVEL[c.autonomy] * 13));
  return { planning, logistics, energy, resource, emergency, autonomy };
}
