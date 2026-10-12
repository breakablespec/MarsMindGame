// Robot assignment: every quarter second, open jobs whose dependencies are met get the best
// available robot (type preference, distance, battery). This is the "robot assignment" stage
// of the command pipeline.

import { JOB_PREF, ROBOTS } from './defs';
import { mods } from './core';
import { centerOf } from './grid';
import type { ColonyState, Job, Robot } from './state';
import { jobReady, taskById } from './tasks';
import { returnThreshold, tileOf } from './robots';
import { BASE_CX, BASE_CY } from './world';

export function jobLocation(st: ColonyState, j: Job): [number, number] | null {
  const mod = (id?: number) => (id === undefined ? undefined : st.modules.find((m) => m.id === id));
  switch (j.kind) {
    case 'haul': { const f = mod(j.from) ?? st.modules.find((m) => (m.store[j.res!] ?? 0) > 0); const m = f ?? mod(j.to); return m ? centerOf(m) : null; }
    case 'mine': { const d = st.deposits.find((q) => q.id === j.target); return d ? [d.x + 1, d.y + 1] : null; }
    case 'scout': return j.waypoints?.[0] ?? null;
    case 'repair': case 'tow': {
      if (j.targetRobot !== undefined) { const r = st.robots.find((q) => q.id === j.targetRobot); return r ? tileOf(r) : null; }
      const m = mod(j.target); return m ? centerOf(m) : null;
    }
    default: { const m = mod(j.target); return m ? centerOf(m) : [BASE_CX, BASE_CY]; }
  }
}
const inBase = (p: [number, number] | null) => !p || Math.hypot(p[0] - BASE_CX, p[1] - BASE_CY) < 13;

export function robotAvailable(st: ColonyState, r: Robot) {
  if (r.jobId !== null) return false;
  if (r.state === 'broken' || r.state === 'dead' || r.state === 'driven') return false;
  if (r.padModule !== null && r.state !== 'charging') return false; // on its way to charge
  if (r.state === 'charging' && r.battery < 60) return false;
  return r.battery > returnThreshold(st, r) + 6;
}

export function dispatch(st: ColonyState) {
  const ready = st.jobs.filter((j) => j.status === 'open' && (!j.blockedUntil || j.blockedUntil <= st.minute) && jobReady(st, j));
  if (!ready.length) return;
  const prio = (j: Job) => taskById(st, j.taskId)?.priority ?? 2;
  ready.sort((a, b) => prio(a) - prio(b) || a.taskId - b.taskId || a.id - b.id);
  const free = st.robots.filter((r) => robotAvailable(st, r));
  if (!free.length) return;
  // parallel construction limit
  const activeSites = new Set(st.jobs.filter((j) => j.kind === 'build' && j.status === 'active').map((j) => j.target));
  const limit = mods(st).parallelBuilds;
  for (const j of ready) {
    if (!free.length) break;
    if (j.kind === 'build' && !activeSites.has(j.target) && activeSites.size >= limit) continue;
    const loc = jobLocation(st, j);
    const task = taskById(st, j.taskId);
    const pref = JOB_PREF[j.kind];
    let best: Robot | null = null, bs = 1e9;
    for (const r of free) {
      if (j.only !== undefined && r.id !== j.only) continue;
      const pi = pref.indexOf(r.kind);
      if (pi < 0) continue;
      if (r.recall && !inBase(loc) && (task?.priority ?? 2) > 0) continue;
      if (j.kind === 'haul' && ROBOTS[r.kind].cargo === 0) continue;
      const [x, y] = tileOf(r);
      const dist = loc ? Math.hypot(loc[0] - x, loc[1] - y) : 0;
      const score = dist + pi * 25 + (100 - r.battery) * 0.3 + (r.cargo && r.cargo.res === j.res ? -10 : 0) + (r.state === 'charging' ? 8 : 0);
      if (score < bs) { bs = score; best = r; }
    }
    if (!best) continue;
    j.status = 'active'; j.robotId = best.id; j.note = undefined;
    best.jobId = j.id; best.state = 'idle'; best.padModule = null; best.path = []; best.goal = null; best.sub = ''; best.workT = 0;
    free.splice(free.indexOf(best), 1);
    if (j.kind === 'build') activeSites.add(j.target);
  }
}
