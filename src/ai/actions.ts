// Task factories: the only way CORE changes the colony. Each builds a task graph of physical jobs.

import { DEPOSIT, MODULES, PowerCat, RES, ResId, ROBOTS, RobotKind, TECH, TechId, TUNE } from '../sim/defs';
import { emit, scaledCost } from '../sim/core';
import { centerOf, moduleAccess } from '../sim/grid';
import type { ColonyState, Deposit, Module, Robot, Task, TaskSource } from '../sim/state';
import { addHaul, addJob, cancelTask, createTask, taskById } from '../sim/tasks';
import { BASE_CX, BASE_CY, MAP_H, MAP_W, explored, idx, inMap } from '../sim/world';
import { tileOf } from '../sim/robots';
import type { Direction } from './command';

type Src = TaskSource;
const prio = (src: Src) => (src === 'EMERGENCY' ? 0 : src === 'PLAYER' || src === 'BRIEFING' ? 1 : 2);

export function produceTask(st: ColonyState, res: ResId, qty: number, src: Src, command?: string, after: number[] = []): Task {
  const t = createTask(st, { title: `Produce ${qty} ${RES[res].name.toLowerCase()}`, kind: 'produce', source: src, command, after, priority: prio(src) });
  const order = { id: st.nextId++, res, qty, done: 0, taskId: t.id };
  // player/CORE orders go ahead of routine stock orders
  if (src === 'ROUTINE') st.production.push(order); else { const i = st.production.findIndex((o) => { const ot = taskById(st, o.taskId); return !ot || ot.source === 'ROUTINE'; }); if (i < 0) st.production.push(order); else st.production.splice(i, 0, order); }
  t.produce = { res, qty, orderId: order.id };
  t.label = 'QUEUED AT WORKSHOP';
  return t;
}

export function mineTask(st: ColonyState, d: Deposit, qty: number | undefined, robots: Robot[], src: Src, command?: string, after: number[] = [], title?: string): Task {
  const res = DEPOSIT[d.kind].res;
  const t = createTask(st, { title: title ?? `Mine ${res ? RES[res].name.toLowerCase() : 'salvage'}${qty ? ` ×${qty}` : ''}`, kind: 'mine', source: src, command, after, priority: prio(src) });
  const n = Math.max(1, robots.length);
  for (let i = 0; i < n; i++) {
    const q = qty !== undefined ? Math.ceil(qty / n) : undefined;
    addJob(st, t, { kind: 'mine', label: `MINING ${res ? RES[res].name.toUpperCase() : 'SALVAGE'}`, target: d.id, qty: q, only: robots[i]?.id });
  }
  return t;
}

/** Free robots from routine work so a player order can use them right now. */
export function preempt(st: ColonyState, robots: Robot[]) {
  for (const r of robots) {
    if (r.jobId === null) continue;
    const j = st.jobs.find((q) => q.id === r.jobId);
    const t = j ? taskById(st, j.taskId) : undefined;
    if (t && (t.source === 'ROUTINE' || t.source === 'STANDING')) cancelTask(st, t, `Pre-empted for a player order`);
  }
}

export function scoutWaypoints(st: ColonyState, from: [number, number], dir: Direction | undefined, target?: [number, number]): [number, number][] {
  if (target) {
    const n = Math.max(1, Math.round(Math.hypot(target[0] - from[0], target[1] - from[1]) / 6));
    const pts: [number, number][] = [];
    for (let i = 1; i <= n; i++) pts.push([Math.round(from[0] + ((target[0] - from[0]) * i) / n), Math.round(from[1] + ((target[1] - from[1]) * i) / n)]);
    return pts;
  }
  // sweep outward into the least explored side (or the requested one)
  const dirs: Record<string, [number, number]> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
  let d = dir && dir !== 'nearest' ? dirs[dir] : null;
  if (!d) {
    const ex = explored(st);
    let best: [number, number] = [1, 0], bs = -1;
    for (const v of Object.values(dirs)) {
      let unk = 0;
      for (let k = 12; k < 40; k += 2) { const x = BASE_CX + v[0] * k, y = BASE_CY + v[1] * k; if (inMap(x, y) && !ex[idx(x, y)]) unk++; }
      if (unk > bs) { bs = unk; best = v; }
    }
    d = best;
  }
  const pts: [number, number][] = [];
  const perp: [number, number] = [d[1], d[0]];
  for (let k = 1; k <= 6; k++) {
    const dist = 10 + k * 5;
    const off = (k % 2 ? 1 : -1) * 6;
    const x = Math.max(2, Math.min(MAP_W - 3, BASE_CX + d[0] * dist + perp[0] * off));
    const y = Math.max(2, Math.min(MAP_H - 3, BASE_CY + d[1] * dist + perp[1] * off));
    pts.push([x, y]);
  }
  pts.push([BASE_CX + d[0] * 6, BASE_CY + d[1] * 6]);
  return pts;
}

export function scoutTask(st: ColonyState, robot: Robot | null, waypoints: [number, number][], src: Src, opts: { find?: string; command?: string; title?: string; after?: number[] } = {}): Task {
  const t = createTask(st, { title: opts.title ?? 'Scout', kind: 'scout', source: src, command: opts.command, after: opts.after, priority: prio(src) });
  const j = addJob(st, t, { kind: 'scout', label: 'SCOUTING', waypoints });
  if (opts.find) j.find = opts.find;
  if (robot) j.only = robot.id;
  return t;
}

export function repairTask(st: ColonyState, targets: { module?: Module; robot?: Robot }[], src: Src, command?: string): Task {
  const names = targets.map((t) => t.module?.name ?? t.robot?.name).join(', ');
  const t = createTask(st, { title: `Repair ${names}`, kind: 'repair', source: src, command, priority: prio(src) });
  for (const tg of targets) {
    if (tg.module) addJob(st, t, { kind: 'repair', label: tg.module.kind === 'habitat' ? `SEALING ${tg.module.name}` : `REPAIRING ${tg.module.name}`, target: tg.module.id });
    if (tg.robot) {
      const j = addJob(st, t, { kind: tg.robot.state === 'dead' ? 'tow' : 'repair', label: tg.robot.state === 'dead' ? `RECHARGING ${tg.robot.name}` : `REPAIRING ${tg.robot.name}` });
      j.targetRobot = tg.robot.id;
    }
  }
  return t;
}

export function cleanTask(st: ColonyState, arrays: Module[], src: Src, command?: string): Task {
  const t = createTask(st, { title: `Clean ${arrays.length > 1 ? `${arrays.length} solar arrays` : arrays[0]?.name ?? 'solar arrays'}`, kind: 'clean', source: src, command, priority: prio(src) });
  for (const m of arrays) addJob(st, t, { kind: 'clean', label: 'CLEANING PANELS', target: m.id });
  return t;
}

export function hopperTask(st: ColonyState, gen: Module, qty: number, src: Src, command?: string): Task {
  const t = createTask(st, { title: `Refill ${gen.name} hopper`, kind: 'refill', source: src, command, priority: prio(src) });
  addHaul(st, t, 'ice', qty, gen.id, 'hopper', `SUPPLYING ${gen.name}`);
  return t;
}

export function transportTask(st: ColonyState, moves: { res: ResId; qty: number; from: Module; to: Module }[], src: Src, command?: string): Task {
  const t = createTask(st, { title: `Move stock to ${moves[0]?.to.name ?? 'storage'}`, kind: 'transport', source: src, command, priority: prio(src) });
  for (const m of moves) addHaul(st, t, m.res, m.qty, m.to.id, 'storage', `MOVING ${RES[m.res].name.toUpperCase()}`, [], m.from.id);
  return t;
}

export function researchTask(st: ColonyState, tech: TechId, src: Src, command?: string): Task | null {
  const lab = st.modules.find((m) => m.kind === 'lab' && m.status === 'online');
  if (!lab) return null;
  const def = TECH[tech];
  const t = createTask(st, { title: `Research ${def.name}`, kind: 'research', source: src, command, priority: prio(src) });
  t.researchTech = tech;
  for (const [r, q] of Object.entries(scaledCost(st, def.cost))) if (q > 0) addHaul(st, t, r as ResId, q, lab.id, 'lab', 'DELIVERING TO LAB');
  st.research.current = tech; st.research.rp = 0; st.research.delivered = false; st.research.taskId = t.id;
  return t;
}

export function fabricateTask(st: ColonyState, kind: RobotKind, src: Src, command?: string, after: number[] = []): Task | null {
  const bay = st.modules.find((m) => m.kind === 'robotbay' && m.status === 'online');
  if (!bay) return null;
  const def = ROBOTS[kind];
  const t = createTask(st, { title: `Build ${def.name}`, kind: 'fabricate', source: src, command, after, priority: prio(src) });
  for (const [r, q] of Object.entries(def.cost)) if (q) addHaul(st, t, r as ResId, q, bay.id, 'lab', 'DELIVERING PARTS');
  const o = { id: st.nextId++, robot: kind, taskId: t.id, started: false };
  st.fabQueue.push(o);
  t.fabricate = { robot: kind, orderId: o.id };
  return t;
}

export function deconstructTask(st: ColonyState, m: Module, src: Src, command?: string, title?: string): Task {
  const t = createTask(st, { title: title ?? `Deconstruct ${m.name}`, kind: 'deconstruct', source: src, command, priority: prio(src) });
  const dj = addJob(st, t, { kind: 'deconstruct', label: 'DECONSTRUCTING', target: m.id });
  const refund = scaledCost(st, MODULES[m.kind].cost);
  for (const [r, q] of Object.entries(refund)) { const n = Math.floor(q * 0.75); if (n > 0) addHaul(st, t, r as ResId, n, -1, 'storage', 'RETURNING MATERIALS', [dj.id], m.id); }
  for (const [r, q] of Object.entries(m.store)) if (q) addHaul(st, t, r as ResId, q, -1, 'storage', 'EMPTYING STORAGE', [dj.id], m.id);
  return t;
}

export function chargeRobots(st: ColonyState, robots: Robot[], src: Src): Task {
  const t = createTask(st, { title: 'Charge robots', kind: 'charge', source: src, priority: prio(src) });
  for (const r of robots) { const j = addJob(st, t, { kind: 'charge', label: 'RETURNING TO CHARGE' }); j.only = r.id; }
  return t;
}

export function recall(st: ColonyState, robots: Robot[]) {
  let n = 0;
  for (const r of robots) {
    if (r.state === 'broken' || r.state === 'dead') continue;
    r.recall = true; n++;
    const j = st.jobs.find((q) => q.id === r.jobId);
    if (j) {
      const t = taskById(st, j.taskId);
      const [x, y] = j.kind === 'mine' ? (() => { const d = st.deposits.find((q) => q.id === j.target); return d ? [d.x, d.y] : tileOf(r); })() : tileOf(r);
      if (Math.hypot(x - BASE_CX, y - BASE_CY) > 12 || j.kind === 'scout') {
        if (t && (t.source === 'ROUTINE' || t.source === 'STANDING')) cancelTask(st, t, 'Recalled');
        else { j.status = 'open'; j.robotId = null; r.jobId = null; r.path = []; r.goal = null; r.state = 'idle'; }
      }
    }
  }
  emit(st, 'recall', undefined, undefined, { n });
  return n;
}
export function resume(st: ColonyState) {
  for (const r of st.robots) r.recall = false;
  st.power.hold = null; st.holdMining = false; st.evacuate = [];
}

export function holdPower(st: ColonyState, cats: PowerCat[], why: string, opts: { untilO2?: number; untilMinute?: number }) {
  const prev = st.power.hold;
  const merged = prev ? [...new Set([...prev.cats, ...cats])] : cats;
  st.power.hold = { cats: merged, why, untilO2: opts.untilO2 ?? prev?.untilO2, untilMinute: Math.max(opts.untilMinute ?? 0, prev?.untilMinute ?? 0) || undefined };
}

export function nearestDeposit(st: ColonyState, res: ResId, from: [number, number] = [BASE_CX, BASE_CY]): Deposit | null {
  return st.deposits.filter((d) => d.found && d.amount > 0 && DEPOSIT[d.kind].res === res).sort((a, b) => Math.hypot(a.x - from[0], a.y - from[1]) - Math.hypot(b.x - from[0], b.y - from[1]))[0] ?? null;
}
export function signalFor(st: ColonyState, res: ResId): Deposit | null {
  return st.deposits.find((d) => d.signal && !d.found && DEPOSIT[d.kind].res === res) ?? null;
}
export function hopperNeed(gen: Module) { return Math.max(0, Math.floor(TUNE.hopperCap - gen.hopper)); }
export { centerOf, moduleAccess };
