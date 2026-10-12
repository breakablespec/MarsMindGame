// Environment: dust storms, solar storms, cold nights, meteors and random failures.

import { MODULES, stageIndex } from './defs';
import { addHistory, clock, emit, first, mods, rand, randInt, raise, resolve, sol } from './core';
import { bumpGrid, moduleAt } from './grid';
import { fill } from './storage';
import type { ColonyState } from './state';
import { BASE_CX, BASE_CY, T, explored, idx, inMap, terrain } from './world';

export const stormActive = (st: ColonyState) => !!st.weather.storm && st.minute >= st.weather.storm.start && st.minute < st.weather.storm.end;
export const solarStormActive = (st: ColonyState) => !!st.weather.solarStorm && st.minute >= st.weather.solarStorm.start && st.minute < st.weather.solarStorm.end;
export const isColdSol = (st: ColonyState, s = sol(st)) => st.weather.coldSols.includes(s);

export function stormLead(st: ColonyState) { return 240 * mods(st).forecastLead; }

export function environmentTick(st: ColonyState) {
  const W = st.weather;
  // ---- dust storms
  if (!W.storm && st.minute >= W.nextStorm - stormLead(st)) {
    const len = randInt(st, 240, 540);
    const strength = 0.7 + rand(st) * 0.3;
    W.storm = { start: W.nextStorm, end: W.nextStorm + len, strength, announced: false };
  }
  if (W.storm) {
    const s = W.storm;
    if (st.minute < s.start) {
      const eta = s.start - st.minute;
      raise(st, 'storm-forecast', 'storm', 'DUST STORM INBOUND', `In ${Math.floor(eta / 60)}h ${eta % 60}m · solar −${Math.round(75 * s.strength)}%`, 'warn');
      if (!s.announced) { s.announced = true; emit(st, 'stormForecast', undefined, undefined, { at: s.start }); }
    } else if (st.minute < s.end) {
      resolve(st, 'storm-forecast');
      if (st.minute === s.start) emit(st, 'stormStart');
      const left = s.end - st.minute;
      raise(st, 'storm', 'storm', s.strength > 0.85 ? 'MAJOR DUST STORM' : 'DUST STORM', `Solar −${Math.round(75 * s.strength)}% · ends in ${Math.floor(left / 60)}h ${left % 60}m`, 'warn');
    } else {
      resolve(st, 'storm');
      emit(st, 'stormEnd');
      const alive = st.colonists.filter((c) => !c.dead).length;
      addHistory(st, `${s.strength > 0.85 ? 'Survived major dust storm' : 'Dust storm passed'} · ${alive} colonists safe`, 'emergency');
      first(st, 'storm-survived', 'First dust storm survived');
      W.storm = null;
      W.nextStorm = st.minute + randInt(st, 3, 5) * 1440 + randInt(st, -300, 300);
    }
  }

  // ---- solar storms (from COLONY)
  if (stageIndex(st.stage) >= 2) {
    if (!W.solarStorm && W.nextSolarStorm && st.minute >= W.nextSolarStorm - 60) W.solarStorm = { start: W.nextSolarStorm, end: W.nextSolarStorm + randInt(st, 90, 180) };
    if (W.solarStorm) {
      if (st.minute < W.solarStorm.start) raise(st, 'solar-forecast', 'solar', 'SOLAR STORM INBOUND', `At ${clock(W.solarStorm.start)} · robots outside get damaged`, 'warn');
      else if (st.minute < W.solarStorm.end) { resolve(st, 'solar-forecast'); raise(st, 'solar-storm', 'solar', 'SOLAR STORM', 'Robots outside get damaged', 'warn'); }
      else { resolve(st, 'solar-storm'); addHistory(st, 'Solar storm passed', 'emergency'); W.solarStorm = null; W.nextSolarStorm = st.minute + randInt(st, 4, 6) * 1440; }
    }
  }

  // ---- cold nights
  const h = (st.minute % 1440) / 60;
  if (isColdSol(st) && h >= 16 && h < 19) raise(st, 'cold', 'cold', 'COLD NIGHT AHEAD', 'More power needed tonight', 'info');
  else if (isColdSol(st) && (h >= 19 || h < 6)) raise(st, 'cold', 'cold', 'COLD NIGHT', 'Heaters on · more power used', 'info');
  else resolve(st, 'cold');

  // ---- meteors (from BASE)
  if (stageIndex(st.stage) >= 1) {
    if (!W.meteor && st.minute >= W.nextMeteor - 60) W.meteor = { at: W.nextMeteor, count: randInt(st, 1, 3), announced: false };
    if (W.meteor) {
      if (st.minute < W.meteor.at) raise(st, 'meteor-forecast', 'meteor', 'METEOR SHOWER INBOUND', `${W.meteor.count} impact${W.meteor.count > 1 ? 's' : ''} at ${clock(W.meteor.at)}`, 'warn');
      else { resolve(st, 'meteor-forecast'); meteorStrike(st, W.meteor.count); W.meteor = null; W.nextMeteor = st.minute + randInt(st, 2, 4) * 1440 + randInt(st, -200, 200); }
    }
  }

  // ---- random seal failures (from BASE)
  if (stageIndex(st.stage) >= 1 && st.minute % 60 === 0) {
    for (const m of st.modules) if (m.kind === 'habitat' && m.status === 'online' && m.hp > 0.9 && rand(st) < 0.004 * mods(st).leak) { m.hp -= 0.15; emit(st, 'leak', (m.x + m.w / 2) * 16, (m.y + m.h / 2) * 16, { name: m.name }); }
  }

  // ---- storage overload
  const f = fill(st);
  if (f > 0.95) { st.sol.overloadMinutes++; raise(st, 'overload', 'storage', 'STORAGE OVERLOAD', `Storage ${Math.round(f * 100)}% full`, 'warn'); }
  else if (f < 0.9) resolve(st, 'overload');
}

export function meteorStrike(st: ColonyState, count: number) {
  const ex = explored(st);
  const targets = st.modules.filter((m) => m.status !== 'site' && m.kind !== 'pad');
  for (let i = 0; i < count; i++) {
    let x: number, y: number;
    if (targets.length && rand(st) < 0.55) { const m = targets[Math.floor(rand(st) * targets.length)]; x = m.x + Math.floor(rand(st) * m.w); y = m.y + Math.floor(rand(st) * m.h); }
    else { x = BASE_CX + randInt(st, -16, 16); y = BASE_CY + randInt(st, -14, 14); }
    if (!inMap(x, y)) continue;
    emit(st, 'impact', x * 16 + 8, y * 16 + 8, {});
    const m = moduleAt(st, x, y);
    if (m && m.kind !== 'pad') {
      const dmg = (0.3 + rand(st) * 0.4) * mods(st).damage * (m.kind === 'habitat' && st.research.done.includes('sealed') ? 0.7 : 1);
      m.hp = Math.max(0.05, m.hp - dmg);
      addHistory(st, `Meteor hit ${m.name} (−${Math.round(dmg * 100)}% hull)`, 'emergency');
      raise(st, `damage-${m.id}`, 'damage', `METEOR DAMAGE — ${m.name}`, `Hull ${Math.round(m.hp * 100)}%${m.kind === 'habitat' ? ' · leaking' : ''}`, m.hp < 0.5 ? 'crit' : 'warn', m.id);
    } else {
      const t = terrain(st)[idx(x, y)];
      if (t !== T.PLATE && ex[idx(x, y)]) { st.terrainEdits[idx(x, y)] = T.ROUGH; bumpGrid(); }
    }
    for (const r of st.robots) if (Math.hypot(r.x / 16 - x, r.y / 16 - y) < 2) { r.condition = Math.max(0, r.condition - 30); }
  }
  void MODULES;
}

export function weatherLabel(st: ColonyState): { kind: 'clear' | 'dust' | 'storm' | 'solar' | 'cold' | 'night'; text: string } {
  if (stormActive(st)) return { kind: 'storm', text: 'DUST STORM' };
  if (solarStormActive(st)) return { kind: 'solar', text: 'SOLAR STORM' };
  const h = (st.minute % 1440) / 60;
  if (isColdSol(st) && (h >= 19 || h < 6)) return { kind: 'cold', text: 'COLD NIGHT' };
  if (st.weather.storm && st.minute < st.weather.storm.start) return { kind: 'dust', text: `STORM ${clock(st.weather.storm.start)}` };
  if (h >= 19 || h < 6) return { kind: 'night', text: 'NIGHT' };
  return { kind: 'clear', text: 'CLEAR' };
}
