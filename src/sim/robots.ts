// Robots: movement, battery, condition and physical job execution. Everything a robot does
// happens by driving somewhere and working there — nothing is teleported.

import { DEPOSIT, MODULES, RES, ROBOTS, ResId, TUNE } from './defs';
import { emit, first, isNight, mods, rand, raise, resolve, sol } from './core';
import { accessTiles, centerOf, depositAccess, findPath, flyPath, moduleAccess, walkable } from './grid';
import { activate, cleanupSalvage, deconstructDone, siteNeeds, startLink } from './construction';
import { stormFactor } from './power';
import { nearestDest, nearestSource, put, take, usedOf } from './storage';
import type { ColonyState, Job, Module, Robot } from './state';
import { jobById, taskById } from './tasks';
import { MOVE_COST, T, idx, inMap, reveal, terrain } from './world';

export const tileOf = (r: { x: number; y: number }): [number, number] => [Math.floor(r.x / 16), Math.floor(r.y / 16)];
export const placeAt = (r: Robot, x: number, y: number) => { r.x = x * 16 + 8; r.y = y * 16 + 10; };
const capOf = (st: ColonyState, r: Robot) => Math.floor(ROBOTS[r.kind].cargo * mods(st).cargo);

export function efficiency(st: ColonyState, r: Robot) {
  const condF = r.condition >= 50 ? 1 : 0.5 + r.condition / 100;
  const storm = stormFactor(st) > 0 ? (ROBOTS[r.kind].flying ? 0.5 : 0.6) : 1;
  return condF * storm * mods(st).robotEff;
}
const outside = (st: ColonyState, r: Robot) => { const [x, y] = tileOf(r); return !inMap(x, y) || terrain(st)[idx(x, y)] !== T.PLATE; };

// ------------------------------------------------------------------ chargers

export function chargers(st: ColonyState): Module[] {
  return st.modules.filter((m) => m.status === 'online' && (MODULES[m.kind].pads ?? 0) > 0 && m.hp > 0.15);
}
export function freePad(st: ColonyState, r: Robot): Module | null {
  const opts = chargers(st).filter((m) => st.robots.filter((q) => q.id !== r.id && q.padModule === m.id).length < (MODULES[m.kind].pads ?? 0));
  const [x, y] = tileOf(r);
  opts.sort((a, b) => Math.hypot(centerOf(a)[0] - x, centerOf(a)[1] - y) - Math.hypot(centerOf(b)[0] - x, centerOf(b)[1] - y));
  return opts[0] ?? null;
}
/** Battery needed to reach the nearest charger, plus a margin. */
export function returnThreshold(st: ColonyState, r: Robot) {
  const pad = chargers(st)[0];
  if (!pad) return TUNE.returnBattery;
  const [x, y] = tileOf(r);
  const near = chargers(st).reduce((b, m) => Math.min(b, Math.hypot(centerOf(m)[0] - x, centerOf(m)[1] - y)), 1e9);
  const per = ROBOTS[r.kind].flying ? 0.2 : 0.12;
  return Math.max(TUNE.returnBattery * 0.6, near * 1.4 * per * (isNight(st) ? 1.5 : 1) + 10);
}

// ------------------------------------------------------------------ movement

/** Plan a route to any goal tile. Returns 'here' | 'ok' | 'none'. */
export function routeTo(st: ColonyState, r: Robot, goals: [number, number][]): 'here' | 'ok' | 'none' {
  const from = tileOf(r);
  if (!goals.length) return 'none';
  if (goals.some(([x, y]) => x === from[0] && y === from[1])) { r.path = []; r.goal = from; return 'here'; }
  if (ROBOTS[r.kind].flying) {
    goals = [...goals].sort((a, b) => Math.hypot(a[0] - from[0], a[1] - from[1]) - Math.hypot(b[0] - from[0], b[1] - from[1]));
    r.path = flyPath(from, goals[0]); r.goal = goals[0];
    return 'ok';
  }
  const p = findPath(st, from, goals);
  if (!p) return 'none';
  r.path = p; r.goal = p.length ? p[p.length - 1] : from;
  return p.length ? 'ok' : 'here';
}
/** Ensure the robot is heading to one of the goals; true once standing on one. */
function arriveAt(st: ColonyState, r: Robot, goals: [number, number][], dt: number): boolean | 'none' {
  const t = tileOf(r);
  if (goals.some(([x, y]) => x === t[0] && y === t[1]) && !r.path.length) return true;
  const goalOk = r.goal && goals.some(([x, y]) => r.goal![0] === x && r.goal![1] === y);
  if (!goalOk || (!r.path.length && !(r.goal && r.goal[0] === t[0] && r.goal[1] === t[1]))) {
    const res = routeTo(st, r, goals);
    if (res === 'none') return 'none';
    if (res === 'here') return true;
  }
  moveAlong(st, r, dt);
  return false;
}

export function moveAlong(st: ColonyState, r: Robot, dt: number) {
  if (!r.path.length) return;
  r.state = 'moving';
  const def = ROBOTS[r.kind];
  const [nx, ny] = r.path[0];
  if (!def.flying && !walkable(st, nx, ny) && !(r.goal && r.goal[0] === nx && r.goal[1] === ny)) { r.path = []; r.goal = null; return; }
  const gx = nx * 16 + 8, gy = ny * 16 + 10;
  const [tx, ty] = tileOf(r);
  const cost = def.flying ? 1 : MOVE_COST[terrain(st)[idx(Math.max(0, tx), Math.max(0, ty))]] ?? 1;
  const sp = def.speed * 16 * efficiency(st, r) * mods(st).speed * dt / Math.max(0.8, Math.min(2, cost));
  const dx = gx - r.x, dy = gy - r.y, d = Math.hypot(dx, dy);
  if (Math.abs(dx) > Math.abs(dy)) r.facing = dx > 0 ? 'right' : 'left'; else if (dy !== 0) r.facing = dy > 0 ? 'down' : 'up';
  if (d <= sp) { r.x = gx; r.y = gy; r.path.shift(); }
  else { r.x += (dx / d) * sp; r.y += (dy / d) * sp; }
  const k = idx(...tileOf(r));
  if (k !== r.lastTile) {
    r.lastTile = k;
    r.stats.tiles++;
    const drain = (def.flying ? 0.2 : 0.12) * (isNight(st) && outside(st, r) && st.weather.coldSols.includes(sol(st)) ? 1.5 : 1);
    r.battery = Math.max(0, r.battery - drain);
    r.wear += stormFactor(st) > 0 ? 3 : 1;
    if (r.wear >= 60) { r.wear = 0; r.condition = Math.max(0, r.condition - 1); }
    const [x, y] = tileOf(r);
    reveal(st, x, y, def.kind === 'scout' ? 6 : def.flying ? 4 : 3);
    if (!def.flying && st.terrainEdits[k] === undefined && terrain(st)[k] === T.UNSTABLE) r.condition = Math.max(0, r.condition - 0.6);
  }
}

// ------------------------------------------------------------------ job helpers

function release(st: ColonyState, r: Robot, j: Job | undefined, why?: string, blockMin = 0) {
  if (j && j.status === 'active') { j.status = 'open'; j.robotId = null; if (why) j.note = why; if (blockMin) j.blockedUntil = st.minute + blockMin; }
  r.jobId = null; r.path = []; r.goal = null; r.sub = ''; r.workT = 0;
  if (r.state !== 'broken' && r.state !== 'dead' && r.state !== 'driven') r.state = 'idle';
}
function done(st: ColonyState, r: Robot, j: Job) {
  j.status = 'done'; j.robotId = null;
  r.jobId = null; r.path = []; r.goal = null; r.sub = ''; r.workT = 0;
  if (r.state !== 'broken' && r.state !== 'dead') r.state = 'idle';
  r.phase = 'IDLE';
}
function fail(st: ColonyState, r: Robot, j: Job, why: string) {
  j.status = 'failed'; j.fail = why; j.robotId = null;
  r.jobId = null; r.path = []; r.goal = null; r.sub = ''; r.state = 'idle'; r.phase = 'IDLE';
  emit(st, 'jobFailed', r.x, r.y, { why, robot: r.name });
}
const modById = (st: ColonyState, id: number | undefined) => (id === undefined ? undefined : st.modules.find((m) => m.id === id));
const resName = (r: ResId) => RES[r].name.toUpperCase();

/** Deliver cargo into a destination module. Returns units delivered. */
function deliverInto(st: ColonyState, r: Robot, j: Job, m: Module): number {
  if (!r.cargo) return 0;
  const res = r.cargo.res;
  let n = 0;
  if (j.toKind === 'site' || j.toKind === 'lab') {
    const need = j.toKind === 'site' && !m.salvage ? (siteNeeds(st, m)[res] ?? 0) : r.cargo.qty;
    n = Math.min(r.cargo.qty, Math.max(0, need), (j.qty ?? 0) - (j.moved ?? 0));
    m.delivered[res] = (m.delivered[res] ?? 0) + n;
  } else if (j.toKind === 'hopper') {
    n = Math.min(r.cargo.qty, Math.max(0, TUNE.hopperCap - m.hopper));
    m.hopper += n;
  } else {
    n = put(m, res, r.cargo.qty);
  }
  r.cargo.qty -= n;
  if (r.cargo.qty <= 0) r.cargo = null;
  r.stats.hauled += n;
  if (n > 0) emit(st, 'deliver', (m.x + m.w / 2) * 16, (m.y + m.h / 2) * 16, { res, n, from: [r.x, r.y], kind: j.toKind });
  return n;
}

/** Dump any cargo into the nearest storage with room (used before other jobs and when idle). */
function unloadCargo(st: ColonyState, r: Robot, dt: number): 'done' | 'moving' | 'full' {
  if (!r.cargo) return 'done';
  // storage full → stage the crate on the landing pad (a physical overflow area, hauled in later)
  const dest = nearestDest(st, r.cargo.res, tileOf(r), { allowOutpost: true }) ?? st.modules.find((m) => m.kind === 'pad' && m.status === 'online');
  if (!dest) { r.phase = 'STORAGE FULL'; return 'full'; }
  const arr = arriveAt(st, r, moduleAccess(st, dest), dt);
  r.phase = dest.kind === 'pad' ? `STAGING ${resName(r.cargo.res)} ON PAD` : `RETURNING ${resName(r.cargo.res)}`;
  if (arr === 'none') return 'full';
  if (!arr) return 'moving';
  const res = r.cargo.res;
  let n: number;
  if (dest.kind === 'pad') { n = r.cargo.qty; dest.delivered[res] = (dest.delivered[res] ?? 0) + n; raise(st, 'overload', 'storage', 'STORAGE OVERLOAD', 'Storage full · extra crates go on the pad', 'warn'); }
  else n = put(dest, res, r.cargo.qty);
  r.cargo.qty -= n;
  if (n) emit(st, 'deliver', (dest.x + dest.w / 2) * 16, (dest.y + dest.h / 2) * 16, { res, n, from: [r.x, r.y], kind: 'storage' });
  if (r.cargo.qty <= 0) r.cargo = null;
  return r.cargo ? 'full' : 'done';
}

// ------------------------------------------------------------------ main update

export function robotsUpdate(st: ColonyState, dt: number) {
  for (const r of st.robots) updateRobot(st, r, dt);
}

function updateRobot(st: ColonyState, r: Robot, dt: number) {
  if (r.state === 'driven') return;
  if (r.state === 'dead') { r.phase = 'BATTERY DEAD — NEEDS TOW'; return; }
  if (r.state === 'broken') { r.phase = 'BROKEN — NEEDS REPAIR'; return; }
  if (r.condition <= 0) { breakDown(st, r, 'worn out'); return; }
  if (r.battery <= 0 && r.state !== 'charging') {
    const j = jobById(st, r.jobId); release(st, r, j, 'Robot battery died');
    r.state = 'dead'; r.padModule = null;
    raise(st, `dead-${r.id}`, 'robot', `${r.name} BATTERY DEAD`, 'Out of charge · needs a tow', 'warn', r.id);
    emit(st, 'robotDead', r.x, r.y, { name: r.name });
    return;
  }

  // charging
  if (r.state === 'charging') {
    const pad = modById(st, r.padModule ?? undefined);
    const powered = pad && pad.status === 'online' && !st.power.shed.includes('charging');
    if (powered) r.battery = Math.min(100, r.battery + TUNE.chargePerSec * dt);
    r.phase = powered ? `CHARGING ${Math.floor(r.battery)}%` : 'WAITING FOR POWER';
    const wanted = r.jobId !== null || st.jobs.some((j) => j.status === 'open' && !j.blockedUntil);
    if (r.battery >= 100 || (r.battery >= 80 && wanted && !r.recall) || !pad) { r.state = 'idle'; r.padModule = null; r.phase = 'IDLE'; }
    return;
  }

  // heading to a charger
  if (r.padModule !== null && r.jobId === null) {
    const pad = modById(st, r.padModule);
    if (!pad || pad.status !== 'online') { r.padModule = null; r.state = 'idle'; return; }
    const arr = arriveAt(st, r, moduleAccess(st, pad), dt);
    r.phase = r.recall ? 'RECALLED · RETURNING' : 'RETURNING TO CHARGE';
    if (arr === 'none') { r.padModule = null; r.state = 'idle'; return; }
    if (arr) {
      if (r.cargo && MODULES[pad.kind].storeCap) { const n = put(pad, r.cargo.res, r.cargo.qty); r.cargo.qty -= n; if (r.cargo.qty <= 0) r.cargo = null; }
      r.state = 'charging'; r.path = []; r.goal = null;
      emit(st, 'dock', r.x, r.y);
    }
    return;
  }

  const j = jobById(st, r.jobId);
  // low battery → go charge (job re-opens with its progress kept)
  if (r.battery < returnThreshold(st, r) && (!j || (j.kind !== 'charge'))) {
    const pad = freePad(st, r);
    if (pad) { release(st, r, j, j ? `${r.name} went to charge` : undefined); r.padModule = pad.id; r.phase = 'RETURNING TO CHARGE'; return; }
  }

  if (!j || j.status !== 'active') {
    if (j) release(st, r, j);
    r.state = r.path.length ? 'moving' : 'idle';
    // idle behaviour: unload cargo, top up battery, go home if recalled
    if (r.cargo) { unloadCargo(st, r, dt); return; }
    r.idleT += dt;
    r.stats.idle += dt;
    if (r.recall && outside(st, r)) { const pad = freePad(st, r); if (pad) { r.padModule = pad.id; return; } }
    if (r.battery < 70 && r.idleT > 2) { const pad = freePad(st, r); if (pad) { r.padModule = pad.id; return; } }
    if (r.path.length) moveAlong(st, r, dt);
    r.phase = r.recall ? 'RECALLED · STANDING BY' : 'IDLE';
    return;
  }
  r.idleT = 0;
  r.stats.busy += dt;
  switch (j.kind) {
    case 'haul': return doHaul(st, r, j, dt);
    case 'mine': return doMine(st, r, j, dt);
    case 'build': return doBuild(st, r, j, dt);
    case 'connect': return doConnect(st, r, j, dt);
    case 'repair': return doRepair(st, r, j, dt);
    case 'tow': return doTow(st, r, j, dt);
    case 'clean': return doClean(st, r, j, dt);
    case 'scout': return doScout(st, r, j, dt);
    case 'deconstruct': return doDeconstruct(st, r, j, dt);
    case 'recall': case 'charge': {
      const pad = freePad(st, r);
      if (!pad) { done(st, r, j); return; }
      done(st, r, j); r.padModule = pad.id; return;
    }
  }
}

// ------------------------------------------------------------------ HAUL

function haulDest(st: ColonyState, r: Robot, j: Job): Module | null {
  if (j.toKind === 'storage' && (j.to === undefined || j.to < 0 || !modById(st, j.to))) return nearestDest(st, j.res!, tileOf(r), { exclude: j.from });
  const m = modById(st, j.to);
  return m ?? null;
}

function doHaul(st: ColonyState, r: Robot, j: Job, dt: number) {
  const res = j.res!;
  const task = taskById(st, j.taskId);
  const buildy = task?.kind === 'build';
  // foreign cargo first
  if (r.cargo && r.cargo.res !== res) { const u = unloadCargo(st, r, dt); if (u === 'full') release(st, r, j, 'STORAGE FULL', 5); return; }
  const remaining = (j.qty ?? 0) - (j.moved ?? 0);
  if (remaining <= 0 && !r.cargo) { done(st, r, j); return; }
  if (r.cargo && (r.sub === 'deliver' || r.cargo.qty >= Math.min(capOf(st, r), remaining))) {
    r.sub = 'deliver';
    const dest = haulDest(st, r, j);
    if (!dest) { release(st, r, j, j.toKind === 'storage' ? 'STORAGE FULL' : 'Destination gone', 5); return; }
    const goals = moduleAccess(st, dest);
    const arr = arriveAt(st, r, goals, dt);
    r.phase = buildy ? `DELIVERING ${resName(res)}` : j.toKind === 'hopper' ? `DELIVERING ICE → ${dest.name}` : `DELIVERING ${resName(res)} → ${dest.name}`;
    j.note = buildy ? 'COLLECTING MATERIALS' : r.phase;
    if (arr === 'none') { fail(st, r, j, `No route to ${dest.name}`); return; }
    if (!arr) return;
    const n = deliverInto(st, r, j, dest);
    j.moved = (j.moved ?? 0) + n;
    r.sub = '';
    if (n === 0 && r.cargo) {
      // destination can't take more (hopper full / site satisfied)
      j.moved = j.qty; done(st, r, j); return;
    }
    if ((j.moved ?? 0) >= (j.qty ?? 0)) done(st, r, j);
    return;
  }
  // fetch
  r.sub = 'fetch';
  let src: Module | null | undefined = j.from !== undefined ? modById(st, j.from) : null;
  const fromSite = src && (src.salvage || src.kind === 'pad');
  if (src && !fromSite && (src.store[res] ?? 0) <= 0) src = null;
  if (fromSite && (src!.delivered[res] ?? 0) <= 0) { if (r.cargo) { r.sub = 'deliver'; return; } j.moved = j.qty; done(st, r, j); cleanupSalvage(st); return; }
  if (!src) src = nearestSource(st, res, tileOf(r));
  if (!src) {
    if (r.cargo) { r.sub = 'deliver'; return; }
    release(st, r, j, `WAITING FOR ${resName(res)}`, 6);
    return;
  }
  const arr = arriveAt(st, r, moduleAccess(st, src), dt);
  r.phase = buildy ? 'COLLECTING MATERIALS' : `COLLECTING ${resName(res)}`;
  j.note = buildy ? 'COLLECTING MATERIALS' : `COLLECTING ${resName(res)}`;
  if (arr === 'none') { fail(st, r, j, `No route to ${src.name}`); return; }
  if (!arr) return;
  r.workT += dt;
  if (r.workT < 0.6) { r.state = 'working'; return; }
  r.workT = 0;
  const want = Math.min(capOf(st, r) - (r.cargo?.qty ?? 0), remaining - (r.cargo?.qty ?? 0));
  let got = 0;
  if (fromSite) { got = Math.min(want, src.delivered[res] ?? 0); src.delivered[res] = (src.delivered[res] ?? 0) - got; if (!src.delivered[res]) delete src.delivered[res]; }
  else got = take(src, res, want);
  if (got > 0) { r.cargo = { res, qty: (r.cargo?.qty ?? 0) + got }; emit(st, 'load', r.x, r.y, { res, n: got, from: src.id }); r.battery = Math.max(0, r.battery - 0.1); }
  r.sub = 'deliver';
  if (fromSite) cleanupSalvage(st);
}

// ------------------------------------------------------------------ MINE

function doMine(st: ColonyState, r: Robot, j: Job, dt: number) {
  const d = st.deposits.find((q) => q.id === j.target);
  if (!d) { fail(st, r, j, 'Deposit missing'); return; }
  const info = DEPOSIT[d.kind];
  const mineRes: ResId = d.kind === 'debris' ? (d.amount > 4 ? 'electronics' : 'rare') : info.res!;
  const cap = capOf(st, r);
  const targetReached = j.qty !== undefined && (j.moved ?? 0) + (r.cargo?.qty ?? 0) >= j.qty;
  const mustUnload = r.cargo && (r.cargo.qty >= cap || d.amount <= 0 || targetReached || r.cargo.res !== mineRes || r.battery < returnThreshold(st, r) + 6);
  if (mustUnload || r.sub === 'unload') {
    r.sub = 'unload';
    if (!r.cargo) { r.sub = ''; return; }
    // life-critical ice can go straight into an oxygen generator hopper, bypassing full storage
    const direct = j.to !== undefined && j.toKind === 'hopper' ? st.modules.find((m) => m.id === j.to && m.status === 'online' && m.hopper < TUNE.hopperCap - 0.5) : undefined;
    const dest = direct ?? nearestDest(st, r.cargo.res, tileOf(r), { allowOutpost: true });
    if (!dest) { r.phase = 'STORAGE FULL'; j.note = 'STORAGE FULL'; raise(st, 'overload', 'storage', 'STORAGE OVERLOAD', 'Storage full · miners waiting', 'warn'); release(st, r, j, 'STORAGE FULL', 10); return; }
    const arr = arriveAt(st, r, moduleAccess(st, dest), dt);
    r.phase = r.cargo.qty >= cap * 0.8 ? 'RETURNING WITH CARGO' : 'RETURNING SOON';
    j.note = `HAULING ${resName(r.cargo.res)} HOME`;
    if (arr === 'none') { fail(st, r, j, 'No route home'); return; }
    if (!arr) return;
    const res = r.cargo.res;
    let n: number;
    if (direct) { n = Math.min(r.cargo.qty, Math.max(0, Math.floor(TUNE.hopperCap - dest.hopper))); dest.hopper += n; }
    else n = put(dest, res, r.cargo.qty);
    r.cargo.qty -= n;
    if (r.cargo.qty <= 0) r.cargo = null;
    j.moved = (j.moved ?? 0) + n;
    st.sol.mined[res] = (st.sol.mined[res] ?? 0) + n;
    r.stats.mined += n;
    emit(st, 'deliver', (dest.x + dest.w / 2) * 16, (dest.y + dest.h / 2) * 16, { res, n, from: [r.x, r.y], kind: 'storage' });
    if (res === 'titanium') first(st, 'mined-titanium', 'First titanium mined');
    if (res === 'rare') first(st, 'mined-rare', 'First rare minerals mined');
    r.sub = '';
    if (r.cargo && direct) { j.to = undefined; r.sub = 'unload'; return; }
    if (r.cargo) { release(st, r, j, 'STORAGE FULL', 5); return; }
    if ((j.qty !== undefined && (j.moved ?? 0) >= j.qty) || d.amount <= 0) {
      if (d.amount <= 0) emit(st, 'depleted', d.x * 16 + 16, d.y * 16 + 16, { kind: d.kind });
      done(st, r, j);
    }
    return;
  }
  if (d.amount <= 0) { if (r.cargo) { r.sub = 'unload'; return; } done(st, r, j); return; }
  const arr = arriveAt(st, r, depositAccess(st, d), dt);
  r.phase = `MINING ${d.kind === 'debris' ? 'SALVAGE' : resName(mineRes)}`;
  j.note = r.phase;
  if (arr === 'none') { fail(st, r, j, `No route to the ${info.name.toLowerCase()}`); return; }
  if (!arr) return;
  // face the deposit
  const [tx, ty] = tileOf(r);
  const cx = d.x + 1, cy = d.y + 1;
  if (Math.abs(cx - tx - 0.5) > Math.abs(cy - ty - 0.5)) r.facing = cx > tx ? 'right' : 'left'; else r.facing = cy > ty ? 'down' : 'up';
  r.state = 'working';
  r.workT += dt * efficiency(st, r) * mods(st).mining;
  if (Math.random() < dt * 6) emit(st, 'drill', d.x * 16 + 16, d.y * 16 + 16, { res: mineRes });
  while (r.workT >= info.secPerUnit && d.amount > 0 && (r.cargo?.qty ?? 0) < cap) {
    r.workT -= info.secPerUnit;
    d.amount -= 1;
    r.cargo = { res: mineRes, qty: (r.cargo?.qty ?? 0) + 1 };
    r.battery = Math.max(0, r.battery - 0.25);
    r.condition = Math.max(0, r.condition - 0.1);
    if (d.kind === 'debris' && d.amount === 0 && d.salvage) { st.research.rp += 0; emit(st, 'salvaged', d.x * 16 + 16, d.y * 16 + 16, { rp: d.salvage.rp }); salvageBonus(st, d.salvage.rp); }
    if (j.qty !== undefined && (j.moved ?? 0) + r.cargo.qty >= j.qty) break;
  }
}
function salvageBonus(st: ColonyState, rp: number) {
  if (st.research.current) st.research.rp += rp;
  else st.research.bank = (st.research.bank ?? 0) + rp;
  first(st, 'salvage', 'Crash debris salvaged — research data recovered');
}

// ------------------------------------------------------------------ BUILD / CONNECT / DECONSTRUCT

function doBuild(st: ColonyState, r: Robot, j: Job, dt: number) {
  const m = modById(st, j.target);
  if (!m) { fail(st, r, j, 'Site gone'); return; }
  if (r.cargo) { const u = unloadCargo(st, r, dt); if (u === 'full') release(st, r, j, 'STORAGE FULL', 5); return; }
  const arr = arriveAt(st, r, moduleAccess(st, m), dt);
  r.phase = `ASSEMBLING ${Math.floor(m.progress * 100)}%`;
  j.note = 'ASSEMBLING';
  if (arr === 'none') { fail(st, r, j, `No route to ${m.name}`); return; }
  if (!arr) return;
  faceRect(r, m);
  r.state = 'working';
  m.status = 'building';
  const others = st.robots.filter((q) => q.id !== r.id && q.jobId !== null && jobById(st, q.jobId)?.kind === 'build' && jobById(st, q.jobId)?.target === m.id && q.state === 'working').length;
  const stack = others > 0 && !st.research.done.includes('swarm') ? 0.7 : 1;
  m.progress = Math.min(1, m.progress + (dt / Math.max(1, MODULES[m.kind].buildSec)) * efficiency(st, r) * mods(st).build * stack);
  r.battery = Math.max(0, r.battery - 0.08 * dt);
  if (Math.random() < dt * 5) emit(st, 'spark', (m.x + Math.random() * m.w) * 16, (m.y + Math.random() * m.h) * 16, {});
  if (m.progress >= 1) {
    // other builders sharing this site are done too
    for (const q of st.jobs) if (q.kind === 'build' && q.target === m.id && q.id !== j.id && q.status !== 'done') { q.status = 'done'; const rr = st.robots.find((x) => x.jobId === q.id); if (rr) { rr.jobId = null; rr.state = 'idle'; } }
    emit(st, 'assembled', (m.x + m.w / 2) * 16, (m.y + m.h / 2) * 16, { name: m.name });
    done(st, r, j);
    if (m.kind === 'outpost') activate(st, m);
  }
}

function doConnect(st: ColonyState, r: Robot, j: Job, dt: number) {
  const m = modById(st, j.target);
  if (!m) { fail(st, r, j, 'Site gone'); return; }
  const arr = arriveAt(st, r, moduleAccess(st, m), dt);
  r.phase = 'CONNECTING GRID';
  j.note = 'CONNECTING GRID';
  if (arr === 'none') { fail(st, r, j, `No route to ${m.name}`); return; }
  if (!arr) return;
  if (!m.link) { const a = startLink(st, m); if (!a) { fail(st, r, j, 'No powered module within 10 tiles'); return; } }
  r.state = 'working';
  const a = modById(st, m.link!.to);
  const dist = a ? Math.hypot(centerOf(a)[0] - centerOf(m)[0], centerOf(a)[1] - centerOf(m)[1]) : 4;
  const secs = 3 + dist * 0.25;
  j.moved = Math.min(100, (j.moved ?? 0) + (dt / secs) * 100);
  r.phase = `CONNECTING GRID ${Math.floor(j.moved)}%`;
  if (Math.random() < dt * 3) emit(st, 'spark', r.x, r.y - 6, {});
  if (j.moved >= 100) { done(st, r, j); activate(st, m); }
}

function doDeconstruct(st: ColonyState, r: Robot, j: Job, dt: number) {
  const m = modById(st, j.target);
  if (!m) { fail(st, r, j, 'Module gone'); return; }
  const arr = arriveAt(st, r, moduleAccess(st, m), dt);
  r.phase = `DECONSTRUCTING ${Math.floor((1 - m.progress) * 100)}%`;
  j.note = 'DECONSTRUCTING';
  if (arr === 'none') { fail(st, r, j, `No route to ${m.name}`); return; }
  if (!arr) return;
  faceRect(r, m);
  r.state = 'working';
  if (m.status === 'online' || m.status === 'off') { m.status = 'building'; m.connected = false; emit(st, 'gridChanged'); }
  m.progress = Math.max(0, m.progress - (dt / Math.max(8, MODULES[m.kind].buildSec * 0.4)) * efficiency(st, r) * mods(st).build);
  if (Math.random() < dt * 5) emit(st, 'spark', (m.x + Math.random() * m.w) * 16, (m.y + Math.random() * m.h) * 16, {});
  if (m.progress <= 0) { done(st, r, j); deconstructDone(st, m); }
}

// ------------------------------------------------------------------ REPAIR / TOW / CLEAN

function doRepair(st: ColonyState, r: Robot, j: Job, dt: number) {
  const rate = (r.kind === 'repair' ? 5 : 2) * mods(st).repair * efficiency(st, r);
  if (j.targetRobot !== undefined) {
    const t = st.robots.find((q) => q.id === j.targetRobot);
    if (!t) { fail(st, r, j, 'Robot gone'); return; }
    const [x, y] = tileOf(t);
    const arr = arriveAt(st, r, accessTiles(st, x, y, 1, 1).concat([[x, y]]), dt);
    r.phase = `REPAIRING ${t.name}`;
    j.note = r.phase;
    if (arr === 'none') { fail(st, r, j, `No route to ${t.name}`); return; }
    if (!arr) return;
    r.state = 'working';
    t.condition = Math.min(100, t.condition + rate * dt);
    if (Math.random() < dt * 4) emit(st, 'spark', t.x, t.y - 6, {});
    if (t.condition >= 100) { if (t.state === 'broken') t.state = 'idle'; resolve(st, `broken-${t.id}`); st.sol.repairs++; emit(st, 'repaired', t.x, t.y, { name: t.name }); done(st, r, j); }
    return;
  }
  const m = modById(st, j.target);
  if (!m) { fail(st, r, j, 'Module gone'); return; }
  const arr = arriveAt(st, r, moduleAccess(st, m), dt);
  r.phase = m.kind === 'habitat' && m.hp < 0.95 ? `SEALING ${m.name}` : `REPAIRING ${m.name}`;
  j.note = r.phase;
  if (arr === 'none') { fail(st, r, j, `No route to ${m.name}`); return; }
  if (!arr) return;
  faceRect(r, m);
  r.state = 'working';
  m.hp = Math.min(1, m.hp + (rate / 100) * dt);
  if (Math.random() < dt * 5) emit(st, 'spark', (m.x + Math.random() * m.w) * 16, (m.y + Math.random() * m.h) * 16, {});
  if (m.hp >= 1) { st.sol.repairs++; emit(st, 'repaired', (m.x + m.w / 2) * 16, (m.y + m.h / 2) * 16, { name: m.name }); done(st, r, j); }
}

function doTow(st: ColonyState, r: Robot, j: Job, dt: number) {
  const t = st.robots.find((q) => q.id === j.targetRobot);
  if (!t) { fail(st, r, j, 'Robot gone'); return; }
  if (t.state !== 'dead') { done(st, r, j); return; }
  const [x, y] = tileOf(t);
  const arr = arriveAt(st, r, accessTiles(st, x, y, 1, 1).concat([[x, y]]), dt);
  r.phase = `RECHARGING ${t.name}`;
  j.note = r.phase;
  if (arr === 'none') { fail(st, r, j, `No route to ${t.name}`); return; }
  if (!arr) return;
  r.state = 'working';
  r.workT += dt;
  if (r.workT > 2.5) { t.battery = 30; t.state = 'idle'; resolve(st, `dead-${t.id}`); r.battery = Math.max(0, r.battery - 8); emit(st, 'repaired', t.x, t.y, { name: t.name }); done(st, r, j); }
}

function doClean(st: ColonyState, r: Robot, j: Job, dt: number) {
  const m = modById(st, j.target);
  if (!m) { fail(st, r, j, 'Array gone'); return; }
  if (m.dust < 0.02) { done(st, r, j); return; }
  const arr = arriveAt(st, r, moduleAccess(st, m), dt);
  r.phase = `CLEANING ${m.name}`;
  j.note = 'CLEANING PANELS';
  if (arr === 'none') { fail(st, r, j, `No route to ${m.name}`); return; }
  if (!arr) return;
  faceRect(r, m);
  r.state = 'working';
  m.dust = Math.max(0, m.dust - (r.kind === 'maint' ? 0.35 : 0.2) * dt * efficiency(st, r));
  r.battery = Math.max(0, r.battery - 0.05 * dt);
  if (Math.random() < dt * 6) emit(st, 'dust', (m.x + Math.random() * m.w) * 16, (m.y + Math.random() * m.h) * 16, {});
  if (m.dust < 0.02) { m.dust = 0; done(st, r, j); }
}

// ------------------------------------------------------------------ SCOUT

function doScout(st: ColonyState, r: Robot, j: Job, dt: number) {
  const wps = j.waypoints ?? [];
  const i = j.moved ?? 0;
  if (j.find) {
    const hit = st.deposits.find((d) => d.found && d.kind === j.find && !(j.found ?? []).includes(d.id) && d.amount > 0);
    if (hit) { j.found = [...(j.found ?? []), hit.id]; emit(st, 'found', hit.x * 16 + 16, hit.y * 16 + 16, { kind: hit.kind, robot: r.name }); done(st, r, j); return; }
  }
  if (i >= wps.length) { done(st, r, j); return; }
  const wp = wps[i];
  const goals: [number, number][] = ROBOTS[r.kind].flying ? [wp] : nearWalkable(st, wp);
  const arr = arriveAt(st, r, goals, dt);
  r.phase = `SCOUTING ${i + 1}/${wps.length}`;
  j.note = j.find ? `SCOUTING FOR ${j.find.toUpperCase()}` : 'SCOUTING';
  if (arr === 'none' || arr) { j.moved = i + 1; r.path = []; r.goal = null; }
}
function nearWalkable(st: ColonyState, [x, y]: [number, number]): [number, number][] {
  for (let rr = 0; rr < 5; rr++) {
    const out: [number, number][] = [];
    for (let yy = y - rr; yy <= y + rr; yy++) for (let xx = x - rr; xx <= x + rr; xx++) if (walkable(st, xx, yy)) out.push([xx, yy]);
    if (out.length) return out;
  }
  return [[x, y]];
}

function faceRect(r: Robot, m: { x: number; y: number; w: number; h: number }) {
  const [tx, ty] = tileOf(r);
  if (tx < m.x) r.facing = 'right'; else if (tx >= m.x + m.w) r.facing = 'left'; else if (ty < m.y) r.facing = 'down'; else r.facing = 'up';
}

// ------------------------------------------------------------------ per minute

export function breakDown(st: ColonyState, r: Robot, why: string) {
  const j = jobById(st, r.jobId);
  if (j && j.status === 'active') { j.status = 'open'; j.robotId = null; }
  r.jobId = null; r.path = []; r.goal = null; r.state = 'broken'; r.padModule = null;
  r.phase = 'BROKEN — NEEDS REPAIR';
  raise(st, `broken-${r.id}`, 'robot', `ROBOT BREAKDOWN — ${r.name}`, `${why} · condition ${Math.round(r.condition)}%`, 'warn', r.id);
  emit(st, 'breakdown', r.x, r.y, { name: r.name });
}

export function robotsMinute(st: ColonyState) {
  const ss = st.weather.solarStorm && st.minute >= st.weather.solarStorm.start && st.minute < st.weather.solarStorm.end;
  for (const r of st.robots) {
    if (r.state === 'broken' || r.state === 'dead') continue;
    if (ss && outside(st, r) && !(st.research.done.includes('shielding') && Math.hypot(r.x / 16 - 46, r.y / 16 - 33) < 14)) r.condition = Math.max(0, r.condition - 0.5);
    if (r.condition < 35 && r.state !== 'charging' && rand(st) < 0.01 * mods(st).breakdown) breakDown(st, r, 'component failure');
  }
  st.sol.robotTotal += st.robots.length;
  st.sol.robotBusy += st.robots.filter((r) => r.jobId !== null && (r.state === 'moving' || r.state === 'working')).length;
  void usedOf;
}
