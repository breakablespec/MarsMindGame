// Orchestrates the simulation: one game minute of flows, plus per-frame robot/colonist motion.

import { SEC_PER_MIN } from './defs';
import { pruneAlerts } from './core';
import { cleanupSalvage } from './construction';
import { shuttleTick, solEnd, stageCheck } from './colony';
import { environmentTick } from './environment';
import { lifeTick, colonistsUpdate } from './life';
import { dispatch } from './logistics';
import { powerTick } from './power';
import { productionTick } from './production';
import { researchTick } from './research';
import { robotsMinute, robotsUpdate } from './robots';
import type { ColonyState } from './state';
import { updateTasks } from './tasks';

export interface Hooks { onMinute?: (st: ColonyState) => void }
const accs = new WeakMap<ColonyState, { min: number; disp: number }>();

export function step(st: ColonyState, dtReal: number, hooks: Hooks = {}) {
  if (st.lost) return;
  const dt = dtReal * st.speed;
  if (dt <= 0) return;
  let a = accs.get(st);
  if (!a) { a = { min: 0, disp: 0 }; accs.set(st, a); }
  a.min += dt;
  let n = 0;
  while (a.min >= SEC_PER_MIN && n < 40) { a.min -= SEC_PER_MIN; minuteTick(st, hooks); n++; }
  const sub = Math.max(1, Math.ceil(dt / 0.05));
  for (let i = 0; i < sub; i++) robotsUpdate(st, dt / sub);
  colonistsUpdate(st, dt);
  a.disp += dt;
  if (a.disp >= 0.25) { a.disp = 0; dispatch(st); updateTasks(st); }
}

export function minuteTick(st: ColonyState, hooks: Hooks = {}) {
  st.minute++;
  environmentTick(st);
  powerTick(st);
  lifeTick(st);
  productionTick(st);
  researchTick(st);
  robotsMinute(st);
  shuttleTick(st);
  if (st.minute % 10 === 0) stageCheck(st);
  if (st.minute % 5 === 0) cleanupSalvage(st);
  hooks.onMinute?.(st);
  if (st.minute % 1440 === 0) solEnd(st);
  if (st.minute % 30 === 0) pruneAlerts(st);
}

/** Fast-forward (offline catch-up, tests). Robots move in coarse steps. */
export function simulate(st: ColonyState, minutes: number, hooks: Hooks = {}) {
  for (let i = 0; i < minutes; i++) {
    minuteTick(st, hooks);
    for (let k = 0; k < 5; k++) robotsUpdate(st, SEC_PER_MIN / 5);
    colonistsUpdate(st, SEC_PER_MIN);
    dispatch(st); updateTasks(st);
  }
}
