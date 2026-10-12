// Power grid: generation, demand by category, battery, priority load shedding.

import { CAT_NAME, MODULES, PowerCat, TUNE } from './defs';
import { emit, isNight, mods, raise, resolve, sun } from './core';
import type { ColonyState, Module } from './state';

export const isGridLive = (m: Module) => (m.status === 'online') && m.connected && m.hp > 0.15;
export const batteries = (st: ColonyState) => st.modules.filter((m) => m.kind === 'battery' && isGridLive(m));
export const batteryCap = (st: ColonyState) => batteries(st).length * TUNE.batteryKwh;

export function stormFactor(st: ColonyState) { return st.weather.storm && st.minute >= st.weather.storm.start && st.minute < st.weather.storm.end ? st.weather.storm.strength : 0; }

export function genOf(st: ColonyState, m: Module, minute = st.minute): number {
  if (!isGridLive(m)) return 0;
  const hpF = m.hp < 0.5 ? m.hp * 2 : 1;
  const storm = stormFactor(st);
  switch (m.kind) {
    case 'solar': return TUNE.solarPeak * sun(minute) * (1 - m.dust) * (1 - 0.75 * storm) * mods(st).solar * hpF;
    case 'wind': return 3 * (storm > 0 ? 2.5 : 1) * hpF;
    case 'reactor': return 35 * hpF;
    case 'geo': return 12 * hpF;
    default: return 0;
  }
}

export interface Demand { m: Module | null; cat: PowerCat; kw: number; label: string }
/** What every module wants to draw this minute. */
export function demands(st: ColonyState): Demand[] {
  const out: Demand[] = [];
  const night = isNight(st);
  const cold = st.weather.coldSols.includes(Math.floor(st.minute / 1440) + 1) && night;
  for (const m of st.modules) {
    if (m.status !== 'online' || !m.connected) continue;
    const def = MODULES[m.kind];
    switch (m.kind) {
      case 'oxygen': {
        if (wantsO2(st, m)) out.push({ m, cat: 'life', kw: def.draw + 0.5, label: m.name });
        break;
      }
      case 'habitat': {
        const occ = st.colonists.filter((c) => !c.dead).length;
        const habs = st.modules.filter((q) => q.kind === 'habitat' && q.status === 'online').length || 1;
        out.push({ m, cat: 'life', kw: def.draw + 0.2 * (occ / habs) + (cold ? 1 : 0), label: m.name });
        break;
      }
      case 'medical': out.push({ m, cat: 'life', kw: def.draw + (st.colonists.some((c) => !c.dead && c.health < 100) ? 1.5 : 0), label: m.name }); break;
      case 'workshop': if (m.fab && m.fab.kind === 'res') out.push({ m, cat: 'production', kw: def.draw, label: m.name }); break;
      case 'robotbay': out.push({ m, cat: 'production', kw: def.draw + (m.fab && m.fab.kind === 'robot' ? 3 : 0), label: m.name }); break;
      case 'lab': if (labWorking(st)) out.push({ m, cat: 'research', kw: def.draw, label: m.name }); break;
      case 'greenhouse': out.push({ m, cat: 'production', kw: def.draw, label: m.name }); break;
      case 'outpost': out.push({ m, cat: 'production', kw: def.draw, label: m.name }); break;
      case 'pad': out.push({ m, cat: 'lighting', kw: def.draw, label: m.name }); break;
      default: if (def.draw > 0) out.push({ m, cat: def.cat, kw: def.draw, label: m.name });
    }
  }
  // charging pads
  const charging = st.robots.filter((r) => r.state === 'charging' && r.battery < 100);
  if (charging.length) out.push({ m: null, cat: 'charging', kw: 2 * charging.length, label: `${charging.length} robot${charging.length > 1 ? 's' : ''} charging` });
  if (night) { const n = st.modules.filter((m) => m.status === 'online').length; out.push({ m: null, cat: 'lighting', kw: 0.1 * n, label: 'Base lighting' }); }
  return out;
}

export function wantsO2(st: ColonyState, m: Module) {
  if (m.kind !== 'oxygen' || m.status !== 'online' || m.hp < 0.15) return false;
  const cap = o2Cap(st), wcap = waterCap(st);
  const o2Room = st.o2 < cap - 0.1;
  const melt = m.hopper > 0 && st.water < wcap * 0.9;
  return (o2Room && st.water > 0.5) || melt;
}
export function labWorking(st: ColonyState) {
  return !!st.research.current && st.research.delivered && st.colonists.some((c) => !c.dead && c.role === 'scientist');
}
export const o2Cap = (st: ColonyState) => st.modules.filter((m) => m.status === 'online' || m.status === 'off').reduce((a, m) => a + (MODULES[m.kind].o2Cap ?? 0), 0);
export const waterCap = (st: ColonyState) => st.modules.filter((m) => m.status === 'online' || m.status === 'off').reduce((a, m) => a + (MODULES[m.kind].waterCap ?? 0), 0);

export interface PowerResult { gen: number; demand: number; used: number; shed: PowerCat[]; battery: number; cap: number }

/** One game minute of the grid. Sets module.powered. */
export function powerTick(st: ColonyState): PowerResult {
  const P = st.power;
  const storm = stormFactor(st);
  // panel dust
  const dustRate = (TUNE.dustPerSol + (storm > 0 ? TUNE.stormDustPerSol * storm : 0)) / 1440;
  for (const m of st.modules) if (m.kind === 'solar' && m.status === 'online') m.dust = Math.min(0.9, m.dust + dustRate);

  const gen = st.modules.reduce((a, m) => a + genOf(st, m), 0);
  const cap = batteryCap(st);
  P.battery = Math.min(P.battery, cap);
  const ds = demands(st);
  const byCat = new Map<PowerCat, number>();
  for (const d of ds) byCat.set(d.cat, (byCat.get(d.cat) ?? 0) + d.kw);
  const totalDemand = [...byCat.values()].reduce((a, b) => a + b, 0);

  const excluded = new Set<PowerCat>();
  for (const c of P.order) if (P.mode[c] === 'off') excluded.add(c);
  if (P.hold) {
    const o2pct = (st.o2 / Math.max(1, o2Cap(st))) * 100;
    const holding = (P.hold.untilO2 !== undefined && o2pct < P.hold.untilO2) || (P.hold.untilMinute !== undefined && st.minute < P.hold.untilMinute);
    if (holding) for (const c of P.hold.cats) excluded.add(c);
    else { emit(st, 'holdEnd', undefined, undefined, { why: P.hold.why }); P.hold = null; st.holdMining = false; }
  }
  if (isNight(st)) for (const c of P.nightOff) excluded.add(c);

  const nBat = batteries(st).length;
  const discharge = Math.min(nBat * TUNE.batteryRate, P.battery * 60);
  const reserveKwh = cap * P.reserve;
  const protectedCats: PowerCat[] = P.order.slice(0, 2);

  // shed from the bottom of the priority list until demand fits
  const active = P.order.filter((c) => !excluded.has(c) && (byCat.get(c) ?? 0) > 0);
  const shed: PowerCat[] = [];
  const fits = (cats: PowerCat[]) => {
    const prot = cats.filter((c) => protectedCats.includes(c)).reduce((a, c) => a + (byCat.get(c) ?? 0), 0);
    const rest = cats.filter((c) => !protectedCats.includes(c)).reduce((a, c) => a + (byCat.get(c) ?? 0), 0);
    const avail = gen + discharge;
    // non-protected loads may not dig into the reserve
    const genLeft = Math.max(0, gen - prot);
    const restAvail = P.battery > reserveKwh ? genLeft + Math.max(0, Math.min(discharge, (P.battery - reserveKwh) * 60)) : genLeft;
    return prot + rest <= avail + 1e-6 && rest <= restAvail + 1e-6;
  };
  const keep = [...active];
  while (keep.length && !fits(keep)) shed.unshift(keep.pop()!);
  const used = keep.reduce((a, c) => a + (byCat.get(c) ?? 0), 0);
  const net = gen - used;
  if (net >= 0) P.battery = Math.min(cap, P.battery + Math.min(net, nBat * TUNE.batteryRate) / 60);
  else P.battery = Math.max(0, P.battery + net / 60);

  const off = new Set<PowerCat>([...shed, ...excluded]);
  for (const m of st.modules) {
    const def = MODULES[m.kind];
    if (m.status !== 'online') { m.powered = false; continue; }
    if (def.gen || m.kind === 'battery' || m.kind === 'outpost') { m.powered = m.connected || m.kind === 'outpost'; continue; }
    m.powered = m.connected && !off.has(def.cat) && m.hp > 0.15;
  }
  P.gen = gen; P.demand = totalDemand; P.used = used; P.shed = [...off].filter((c) => (byCat.get(c) ?? 0) > 0);

  // stats
  const S = st.sol;
  S.genKwh += gen / 60; S.useKwh += used / 60; S.peak = Math.max(S.peak, totalDemand);
  S.powerMinutes++;
  const lifeShed = P.shed.includes('life') || P.shed.includes('core');
  if (!lifeShed) S.powerOkMinutes++;

  // alerts
  const realShed = shed.filter((c) => (byCat.get(c) ?? 0) > 0);
  if (realShed.length || lifeShed) P.lastShed = st.minute;
  const calm = P.lastShed === undefined || st.minute - P.lastShed > 15;
  if (lifeShed && realShed.length) raise(st, 'power-failure', 'power', 'POWER FAILURE', `${realShed.map((c) => CAT_NAME[c]).join(', ')} OFF · battery ${Math.round(P.battery)} kWh`, 'crit');
  else if (calm) resolve(st, 'power-failure');
  if (realShed.length && !lifeShed) raise(st, 'power-shed', 'power', 'POWER LOW', `Paused: ${realShed.map((c) => CAT_NAME[c]).join(', ')}`, 'warn');
  else if (calm) resolve(st, 'power-shed');
  const solarModules = st.modules.filter((m) => m.kind === 'solar' && m.status === 'online');
  const dusty = solarModules.filter((m) => m.dust > 0.4);
  if (dusty.length) raise(st, 'dust-panels', 'solar', 'SOLAR OUTPUT DROP', `Dusty panels · output −${Math.round((dusty.reduce((a, m) => a + m.dust, 0) / dusty.length) * 100)}%`, 'warn');
  else resolve(st, 'dust-panels');
  if (shed.length && !st.power.shed.length) emit(st, 'shed');
  return { gen, demand: totalDemand, used, shed: P.shed, battery: P.battery, cap };
}

/** Forecast energy balance for the rest of the sol and the coming night, kWh. */
export function forecastSol(st: ColonyState): { genKwh: number; useKwh: number; nightUse: number; nightHours: number; batteryAtDawn: number } {
  const ds = demands(st);
  const baseDemand = ds.filter((d) => d.cat !== 'lighting').reduce((a, d) => a + d.kw, 0);
  let gen = 0, use = 0, bat = st.power.battery;
  const cap = batteryCap(st);
  let nightUse = 0, nightH = 0;
  for (let k = 0; k < 24 * 60; k += 15) {
    const mi = st.minute + k;
    const g = st.modules.reduce((a, m) => a + genOf(st, m, mi), 0);
    const h = (mi % 1440) / 60;
    const night = h < 6 || h >= 19;
    const d = baseDemand + (night ? 0.1 * st.modules.length : 0);
    gen += (g * 15) / 60; use += (d * 15) / 60;
    if (night) { nightUse += (d * 15) / 60; nightH += 0.25; }
    bat = Math.max(0, Math.min(cap, bat + ((g - d) * 15) / 60));
    if (night && h >= 5.75 && h < 6) break;
  }
  return { genKwh: gen, useKwh: use, nightUse, nightHours: nightH, batteryAtDawn: bat };
}
