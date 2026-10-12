// Workshop fabrication (silica / polymer / electronics) and robot bay fabrication.

import { MODULES, RECIPES, RES, ResId, ROBOTS, RobotKind, TUNE } from './defs';
import { addHistory, emit, first } from './core';
import { centerOf, moduleAccess, rectGap } from './grid';
import { put, roomOf, stores, take } from './storage';
import type { ColonyState, Module, Robot } from './state';
import { finishTask, taskById, taskJobs } from './tasks';

export const inRange = (a: Module, b: Module) => rectGap(a, b) <= TUNE.conveyorRange;
export const feedStores = (st: ColonyState, w: Module) => stores(st).filter((s) => s.kind !== 'outpost' && inRange(w, s));

function haveInputs(st: ColonyState, w: Module, inputs: Partial<Record<ResId, number>>) {
  const src = feedStores(st, w);
  return Object.entries(inputs).every(([r, q]) => src.reduce((a, s) => a + (s.store[r as ResId] ?? 0), 0) >= (q ?? 0));
}

export function productionTick(st: ColonyState) {
  const shops = st.modules.filter((m) => m.kind === 'workshop' && m.status === 'online');
  for (const w of shops) {
    if (!w.fab) {
      for (const o of st.production) {
        if (st.modules.some((q) => q.fab && q.fab.kind === 'res' && q.fab.orderId === o.id)) continue;
        const rec = RECIPES[o.res];
        if (!rec) continue;
        if (!haveInputs(st, w, rec.inputs)) continue;
        for (const [r, q] of Object.entries(rec.inputs)) {
          let need = q ?? 0;
          for (const s of feedStores(st, w)) { if (!need) break; const got = take(s, r as ResId, need); need -= got; if (got) emit(st, 'conveyor', centerOf(s)[0] * 16, centerOf(s)[1] * 16, { to: [centerOf(w)[0] * 16, centerOf(w)[1] * 16], res: r }); }
        }
        w.fab = { kind: 'res', res: o.res, left: rec.minutes, orderId: o.id };
        break;
      }
    } else if (w.fab.kind === 'res' && w.powered) {
      w.fab.left -= 1;
      if (w.fab.left <= 0) {
        const rec = RECIPES[w.fab.res]!;
        const dest = feedStores(st, w).filter((s) => roomOf(s) > 0).sort((a, b) => rectGap(a, w) - rectGap(b, w))[0];
        if (!dest) { w.fab.left = 0; continue; }
        const n = put(dest, rec.out, rec.outQty);
        emit(st, 'conveyor', centerOf(w)[0] * 16, centerOf(w)[1] * 16, { to: [centerOf(dest)[0] * 16, centerOf(dest)[1] * 16], res: rec.out });
        st.sol.produced[rec.out] = (st.sol.produced[rec.out] ?? 0) + n;
        const o = st.production.find((q) => q.id === (w.fab as { orderId: number }).orderId);
        w.fab = null;
        if (o) {
          o.done += n;
          if (o.done >= o.qty) {
            st.production = st.production.filter((q) => q.id !== o.id);
            const t = taskById(st, o.taskId);
            if (t) finishTask(st, t, true, `Produced ${o.done} ${RES[o.res].name.toLowerCase()}`);
          }
        }
      }
    }
  }
  // task labels for production orders
  for (const o of st.production) {
    const t = taskById(st, o.taskId);
    if (!t || (t.status !== 'running' && t.status !== 'waiting')) continue;
    if (t.after.some((id) => { const a = taskById(st, id); return a && a.status !== 'done'; })) continue;
    t.status = 'running';
    const busy = st.modules.find((m) => m.fab && m.fab.kind === 'res' && m.fab.orderId === o.id);
    const rec = RECIPES[o.res]!;
    t.progress = Math.min(1, (o.done + (busy && busy.fab ? 1 - busy.fab.left / rec.minutes : 0) * rec.outQty) / o.qty);
    if (busy) t.label = busy.powered ? `PRODUCING ${RES[o.res].name.toUpperCase()} ${o.done}/${o.qty}` : 'WORKSHOP UNPOWERED';
    else if (!shops.length) t.label = 'NO WORKSHOP';
    else {
      const missing = Object.entries(rec.inputs).filter(([r, q]) => !shops.some((w) => feedStores(st, w).reduce((a, s) => a + (s.store[r as ResId] ?? 0), 0) >= (q ?? 0))).map(([r]) => RES[r as ResId].name.toUpperCase());
      t.label = missing.length ? `WAITING FOR ${missing.join(' + ')}` : 'QUEUED AT WORKSHOP';
    }
  }

  // robot bays
  for (const bay of st.modules.filter((m) => m.kind === 'robotbay' && m.status === 'online')) {
    if (!bay.fab) {
      const o = st.fabQueue.find((q) => !q.started && Object.entries(ROBOTS[q.robot].cost).every(([r, need]) => (bay.delivered[r as ResId] ?? 0) >= (need ?? 0)));
      if (o) {
        for (const [r, need] of Object.entries(ROBOTS[o.robot].cost)) bay.delivered[r as ResId] = (bay.delivered[r as ResId] ?? 0) - (need ?? 0);
        bay.fab = { kind: 'robot', robot: o.robot, left: ROBOTS[o.robot].fabMin, orderId: o.id };
        o.started = true;
        emit(st, 'fabStart', centerOf(bay)[0] * 16, centerOf(bay)[1] * 16, { robot: o.robot });
      }
    } else if (bay.fab.kind === 'robot' && bay.powered) {
      bay.fab.left -= 1;
      if (bay.fab.left <= 0) {
        const kind = bay.fab.robot;
        const orderId = bay.fab.orderId;
        bay.fab = null;
        const r = spawnRobot(st, kind, bay);
        const o = st.fabQueue.find((q) => q.id === orderId);
        st.fabQueue = st.fabQueue.filter((q) => q.id !== orderId);
        emit(st, 'robotBuilt', r.x, r.y, { name: r.name, kind });
        first(st, `robot-${kind}`, `First ${ROBOTS[kind].name.toLowerCase()} built: ${r.name}`, 'build') || addHistory(st, `${r.name} rolled out of ${bay.name}`, 'build');
        const t = taskById(st, o?.taskId);
        if (t) finishTask(st, t, true, `${r.name} ONLINE`);
      }
    }
  }
  for (const o of st.fabQueue) {
    const t = taskById(st, o.taskId);
    if (!t || (t.status !== 'running' && t.status !== 'waiting')) continue;
    const bay = st.modules.find((m) => m.fab && m.fab.kind === 'robot' && m.fab.orderId === o.id);
    const hauls = taskJobs(st, t);
    if (bay && bay.fab) { t.status = 'running'; t.label = bay.powered ? `FABRICATING ${ROBOTS[o.robot].prefix}` : 'ROBOT BAY UNPOWERED'; t.progress = 0.5 + 0.5 * (1 - bay.fab.left / ROBOTS[o.robot].fabMin); }
    else if (hauls.some((j) => j.status !== 'done')) { const a = hauls.find((j) => j.status === 'active'); if (a) t.status = 'running'; t.label = a?.note ?? 'DELIVERING PARTS'; t.progress = 0.5 * hauls.reduce((s, j) => s + Math.min(1, (j.moved ?? 0) / (j.qty || 1)), 0) / Math.max(1, hauls.length); }
    else t.label = 'WAITING FOR ROBOT BAY';
  }
}

export function robotName(st: ColonyState, kind: RobotKind) {
  const n = st.robots.filter((r) => r.kind === kind).length + 1;
  return `${ROBOTS[kind].prefix}-${String(n).padStart(2, '0')}`;
}
export function makeRobot(st: ColonyState, kind: RobotKind, x: number, y: number): Robot {
  return {
    id: st.nextId++, kind, name: robotName(st, kind), x: x * 16 + 8, y: y * 16 + 10, facing: 'down', battery: 100, condition: 100,
    cargo: null, jobId: null, state: 'idle', phase: 'IDLE', path: [], goal: null, workT: 0, padModule: null, recall: false,
    stats: { busy: 0, idle: 0, tiles: 0, mined: 0, hauled: 0 }, wear: 0, sub: '', idleT: 0, lastTile: -1,
  };
}
export function spawnRobot(st: ColonyState, kind: RobotKind, at: Module): Robot {
  const acc = moduleAccess(st, at);
  const [x, y] = acc[0] ?? [at.x, at.y + at.h];
  const r = makeRobot(st, kind, x, y);
  st.robots.push(r);
  return r;
}
void MODULES;
