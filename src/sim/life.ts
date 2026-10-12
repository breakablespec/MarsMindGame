// Life support: oxygen, water, rations, colonist health and movement.

import { MODULES, TUNE, ROLE_INFO } from './defs';
import { addHistory, emit, hour, isNight, mods, raise, rand, realMinutes, resolve, sol } from './core';
import { findPath, moduleAccess } from './grid';
import { o2Cap, stormFactor, waterCap } from './power';
import type { ColonyState, Colonist, Module } from './state';

export const alive = (st: ColonyState) => st.colonists.filter((c) => !c.dead);
export const beds = (st: ColonyState) => st.modules.filter((m) => m.kind === 'habitat' && m.status === 'online').length * mods(st).beds;

export interface LifeRates { o2Prod: number; o2Use: number; waterProd: number; waterUse: number; leak: number }
let lastRates: LifeRates = { o2Prod: 0, o2Use: 0, waterProd: 0, waterUse: 0, leak: 0 };
export const lifeRates = () => lastRates;

/** Expected production/consumption per hour if things keep running as now. */
export function o2Balance(st: ColonyState) {
  const gens = st.modules.filter((m) => m.kind === 'oxygen' && m.status === 'online' && m.hp > 0.15);
  const prodCap = gens.reduce((a, m) => a + TUNE.o2GenRate * mods(st).o2 * (m.hp < 0.5 ? m.hp * 2 : 1), 0);
  const use = alive(st).length * TUNE.o2PerColonist;
  const leak = leakRate(st);
  return { prodCap, use, leak, net: prodCap - use - leak };
}
export function leakRate(st: ColonyState) {
  return st.modules.filter((m) => m.kind === 'habitat' && (m.status === 'online' || m.status === 'off') && m.hp < 0.95).reduce((a, m) => a + TUNE.leakRate * (1 - m.hp) * mods(st).leak * (st.evacuate.includes(m.id) && !st.colonists.some((c) => !c.dead && c.inside === m.id) ? 0.5 : 1), 0);
}
/** Hours of oxygen left at the current net loss (Infinity if not losing). */
export function o2ReserveHours(st: ColonyState) {
  const r = lastRates;
  const net = r.o2Prod - r.o2Use - r.leak;
  if (net >= -0.01) return Infinity;
  return st.o2 / -net;
}

export function lifeTick(st: ColonyState) {
  const cap = o2Cap(st), wcap = waterCap(st);
  const m = mods(st);
  let o2Prod = 0, waterProd = 0, waterUse = 0;
  for (const g of st.modules) {
    if (g.kind !== 'oxygen') continue;
    g.running = false;
    if (g.status !== 'online' || !g.powered || g.hp < 0.15) continue;
    const hpF = g.hp < 0.5 ? g.hp * 2 : 1;
    // melter
    if (g.hopper > 0 && st.water < wcap * 0.9) {
      const ice = Math.min(g.hopper, TUNE.melterIcePerHour / 60);
      g.hopper -= ice;
      st.water += ice * TUNE.waterPerIce;
      waterProd += ice * TUNE.waterPerIce * 60;
      g.running = true;
    }
    // electrolysis
    const need = (TUNE.o2GenWater / 60) * hpF;
    if (st.o2 < cap && st.water >= need) {
      const p = ((TUNE.o2GenRate * m.o2) / 60) * hpF;
      st.o2 += p; st.water -= need;
      o2Prod += p * 60; waterUse += need * 60;
      g.running = true;
    }
  }
  const people = alive(st);
  const o2Use = people.length * TUNE.o2PerColonist;
  const wUse = people.length * TUNE.waterPerColonist * m.water + st.modules.filter((q) => q.kind === 'greenhouse' && q.status === 'online' && q.powered).length * 1;
  const leak = leakRate(st);
  st.o2 -= (o2Use + leak) / 60;
  st.water -= wUse / 60;
  waterUse += wUse;
  st.o2 = Math.max(0, Math.min(cap, st.o2));
  st.water = Math.max(0, Math.min(wcap, st.water));
  lastRates = { o2Prod, o2Use, waterProd, waterUse, leak };

  // rations at midnight
  if (st.minute % 1440 === 0) {
    const gh = st.modules.filter((q) => q.kind === 'greenhouse' && q.status === 'online' && q.powered).length;
    st.rations = Math.max(0, st.rations - people.length + gh * 4);
  }

  // health
  const medical = st.modules.some((q) => q.kind === 'medical' && q.status === 'online' && q.powered) && people.some((c) => c.role === 'medic');
  for (const c of people) {
    let d = 0;
    if (st.o2 <= 0.01) d -= 12;
    if (st.water <= 0.01) d -= 4;
    if (st.rations <= 0) d -= 2;
    if (d === 0) d = medical ? 8 : 3;
    c.health = Math.max(0, Math.min(100, c.health + d / 60));
    if (c.health <= 0) {
      c.dead = true; st.deaths++;
      addHistory(st, `${c.name} (${ROLE_INFO[c.role].name}) was lost`, 'loss');
      emit(st, 'death', c.x, c.y, { name: c.name });
      raise(st, `death-${c.id}`, 'death', 'COLONIST LOST', `${c.name} did not survive`, 'crit');
    }
  }
  if (people.length && alive(st).length === 0) st.lost = true;

  // stats + alerts
  const pct = cap ? st.o2 / cap : 0;
  st.sol.o2Minutes++;
  if (pct >= 0.15 && st.o2 > 0) st.sol.o2OkMinutes++;
  const resH = o2ReserveHours(st);
  const resText = Number.isFinite(resH) ? (resH < 2 ? `${Math.max(1, Math.round(realMinutes(resH * 60)))} MIN` : (resH < 24 ? `${resH.toFixed(1)} H` : `${Math.round(resH)} H`)) : 'STABLE';
  if (pct < 0.15) raise(st, 'o2-low', 'oxygen', 'OXYGEN CRITICAL', `${Math.round(pct * 100)}% · ${resText} left`, 'crit');
  else if (pct < 0.3) raise(st, 'o2-low', 'oxygen', 'OXYGEN LOW', `${Math.round(pct * 100)}% · ${resText} left`, 'warn');
  else if (pct > 0.35) resolve(st, 'o2-low');
  for (const h of st.modules.filter((q) => q.kind === 'habitat')) {
    if (h.hp < 0.95 && h.status !== 'site' && h.status !== 'building') raise(st, `leak-${h.id}`, 'leak', `OXYGEN LEAK — ${h.name}`, `−${(TUNE.leakRate * (1 - h.hp) * m.leak).toFixed(1)} O₂/h · ${resText} left${st.evacuate.includes(h.id) ? ' · evacuated' : ''}`, h.hp < 0.6 ? 'crit' : 'warn', h.id);
    else resolve(st, `leak-${h.id}`);
  }
  const wpct = wcap ? st.water / wcap : 0;
  if (wpct < 0.12) raise(st, 'water-low', 'water', 'WATER LOW', `Water ${Math.round(st.water)} · needs ice`, wpct < 0.04 ? 'crit' : 'warn');
  else if (wpct > 0.18) resolve(st, 'water-low');
  const starved = st.modules.filter((q) => q.kind === 'oxygen' && q.status === 'online' && q.hopper < 0.5);
  if (starved.length && wpct < 0.5) raise(st, 'hopper-empty', 'oxygen', 'ICE HOPPER EMPTY', `${starved.map((q) => q.name).join(', ')} · no ice`, 'warn');
  else resolve(st, 'hopper-empty');
  if (st.rations < people.length * 2) raise(st, 'rations', 'food', 'RATIONS LOW', `${st.rations} left · ${people.length} colonists`, st.rations <= 0 ? 'crit' : 'warn');
  else resolve(st, 'rations');
}

// ------------------------------------------------------------------ colonist movement (per frame)

const WORKPLACE: Record<string, string[]> = {
  engineer: ['workshop', 'robotbay', 'command', 'storage'],
  scientist: ['lab', 'command', 'core'],
  technician: ['robotbay', 'workshop', 'storage', 'oxygen'],
  medic: ['medical', 'habitat', 'command'],
  miner: ['storage', 'outpost', 'workshop'],
};
function homeOf(st: ColonyState, c: Colonist): Module | null {
  const habs = st.modules.filter((m) => m.kind === 'habitat' && m.status === 'online' && !st.evacuate.includes(m.id));
  if (!habs.length) return st.modules.find((m) => m.kind === 'command') ?? null;
  return habs[c.id % habs.length];
}
export function colonistsUpdate(st: ColonyState, dt: number) {
  const night = isNight(st);
  const shelter = stormFactor(st) > 0 || (st.weather.meteor && st.minute >= st.weather.meteor.at - 30 && st.minute < st.weather.meteor.at + 30) || (st.weather.solarStorm && st.minute >= st.weather.solarStorm.start && st.minute < st.weather.solarStorm.end);
  // evacuation ends once a habitat is sealed again
  if (st.evacuate.length) st.evacuate = st.evacuate.filter((id) => { const m = st.modules.find((q) => q.id === id); return !!m && m.status === 'online' && m.hp < 0.99; });
  for (const c of st.colonists) {
    if (c.dead) continue;
    if (c.inside !== null && st.evacuate.includes(c.inside)) c.insideT = 0;
    if (c.inside !== null) {
      c.insideT -= dt / 0.5; // game minutes
      const mustStay = night || shelter;
      const home = homeOf(st, c);
      if ((c.insideT > 0 && !st.evacuate.includes(c.inside)) || (mustStay && !st.evacuate.includes(c.inside) && (c.inside === home?.id || st.modules.find((m) => m.id === c.inside)?.kind === 'command'))) continue;
      // leave the module
      const m = st.modules.find((q) => q.id === c.inside);
      const acc = m ? moduleAccess(st, m) : [];
      const a = acc[Math.floor(rand(st) * acc.length)];
      if (a) { c.x = a[0] * 16 + 8; c.y = a[1] * 16 + 12; }
      emit(st, 'airlock', c.x, c.y);
      c.inside = null; c.path = []; c.target = null;
    }
    if (!c.path.length) {
      let dest: Module | null = null;
      if (night || shelter) dest = homeOf(st, c);
      else if (c.target !== null && !st.evacuate.includes(c.target)) dest = st.modules.find((m) => m.id === c.target) ?? null;
      if (!dest || (c.target !== null && dest.id === c.target && !night && !shelter && rand(st) < 0.002)) {
        const kinds = WORKPLACE[c.role] ?? ['command'];
        const opts = st.modules.filter((m) => m.status === 'online' && !st.evacuate.includes(m.id) && (kinds.includes(m.kind) || (rand(st) < 0.2 && ['command', 'habitat', 'storage'].includes(m.kind))));
        dest = opts.length ? opts[Math.floor(rand(st) * opts.length)] : homeOf(st, c);
      }
      if (!dest) continue;
      c.target = dest.id;
      const tx = Math.floor(c.x / 16), ty = Math.floor((c.y - 4) / 16);
      const acc = moduleAccess(st, dest);
      if (acc.some(([x, y]) => x === tx && y === ty)) {
        c.inside = dest.id;
        c.insideT = night || shelter ? 60 : 25 + rand(st) * 70;
        emit(st, 'airlock', c.x, c.y);
        continue;
      }
      const p = findPath(st, [tx, ty], acc, 3000);
      if (!p) { c.inside = dest.id; c.insideT = 30; continue; }
      c.path = p;
    }
    // walk
    const [nx, ny] = c.path[0];
    const gx = nx * 16 + 8, gy = ny * 16 + 12;
    const dx = gx - c.x, dy = gy - c.y;
    const d = Math.hypot(dx, dy);
    const sp = 22 * dt;
    if (d <= sp) { c.x = gx; c.y = gy; c.path.shift(); if (!c.path.length) { const m = st.modules.find((q) => q.id === c.target); if (m) { c.inside = m.id; c.insideT = night || shelter ? 60 : 25 + rand(st) * 70; emit(st, 'airlock', c.x, c.y); } } }
    else { c.x += (dx / d) * sp; c.y += (dy / d) * sp; }
  }
  void hour; void sol; void MODULES;
}
