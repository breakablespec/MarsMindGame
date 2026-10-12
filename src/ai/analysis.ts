// State analysis: the live numbers CORE reasons with. Every plan's WHY lines come from here.

import { CAT_NAME, MODULES, RES, RES_IDS, ResId, RobotKind, ROBOT_KINDS, TUNE } from '../sim/defs';
import { activeAlerts, hour, mods, realMinutes } from '../sim/core';
import { alive, beds, lifeRates, o2Balance, o2ReserveHours } from '../sim/life';
import { batteryCap, forecastSol, o2Cap, waterCap } from '../sim/power';
import { fill, totals } from '../sim/storage';
import type { ColonyState, Deposit, Module } from '../sim/state';
import { liveTasks } from '../sim/tasks';
import { stormActive } from '../sim/environment';
import { BASE_CX, BASE_CY, directionOf } from '../sim/world';

export interface Risk { key: string; text: string; severity: number }
export interface Analysis {
  power: { gen: number; demand: number; used: number; net: number; battery: number; cap: number; hoursLeft: number; forecastBalance: number; batteryAtDawn: number; nightUse: number; shed: string[]; dusty: Module[] };
  o2: { pct: number; amount: number; cap: number; prod: number; use: number; leak: number; reserveH: number; reserveText: string; gens: number; net: number };
  water: { amount: number; cap: number; pct: number; hopperLow: Module[] };
  stock: Record<ResId, number>;
  lowest: { res: ResId; ratio: number };
  fill: number;
  robots: Record<RobotKind, { total: number; idle: number; busy: number; charging: number; broken: number }>;
  deposits: (Deposit & { dist: number; dir: string })[];
  damaged: Module[];
  risks: Risk[];
  pop: number; beds: number;
  storm: { active: boolean; inMin: number | null };
  live: number;
}

export function analyze(st: ColonyState): Analysis {
  const fs = forecastSol(st);
  const cap = batteryCap(st);
  const net = st.power.gen - st.power.used;
  const lr = lifeRates();
  const bal = o2Balance(st);
  const resH = o2ReserveHours(st);
  const oc = o2Cap(st);
  const stock = totals(st);
  const ratios = (['ice', 'regolith', 'iron', 'titanium', 'silica', 'polymer', 'electronics', 'rare'] as ResId[]).map((r) => ({ res: r, ratio: stock[r] / RES[r].target }));
  ratios.sort((a, b) => a.ratio - b.ratio);
  const robots = Object.fromEntries(ROBOT_KINDS.map((k) => [k, { total: 0, idle: 0, busy: 0, charging: 0, broken: 0 }])) as Analysis['robots'];
  for (const r of st.robots) {
    const R = robots[r.kind];
    R.total++;
    if (r.state === 'broken' || r.state === 'dead') R.broken++;
    else if (r.state === 'charging') R.charging++;
    else if (r.jobId !== null) R.busy++;
    else R.idle++;
  }
  const deposits = st.deposits.filter((d) => d.found && (d.amount > 0 || d.kind === 'vent')).map((d) => ({ ...d, dist: Math.hypot(d.x - BASE_CX, d.y - BASE_CY), dir: directionOf(d.x, d.y) })).sort((a, b) => a.dist - b.dist);
  const damaged = st.modules.filter((m) => (m.status === 'online' || m.status === 'off') && m.hp < 0.9);
  const dusty = st.modules.filter((m) => m.kind === 'solar' && m.status === 'online' && m.dust > 0.25);
  const gens = st.modules.filter((m) => m.kind === 'oxygen' && m.status === 'online').length;
  const hopperLow = st.modules.filter((m) => m.kind === 'oxygen' && m.status === 'online' && m.hopper < TUNE.hopperLow);
  const storm = st.weather.storm;
  const a: Analysis = {
    power: { gen: st.power.gen, demand: st.power.demand, used: st.power.used, net, battery: st.power.battery, cap, hoursLeft: net < 0 ? st.power.battery / -net : Infinity, forecastBalance: fs.genKwh - fs.useKwh, batteryAtDawn: fs.batteryAtDawn, nightUse: fs.nightUse, shed: st.power.shed.map((c) => CAT_NAME[c]), dusty },
    o2: { pct: oc ? st.o2 / oc : 0, amount: st.o2, cap: oc, prod: lr.o2Prod, use: lr.o2Use, leak: lr.leak, reserveH: resH, reserveText: Number.isFinite(resH) ? (resH < 2 ? `${Math.max(1, Math.round(realMinutes(resH * 60)))} min` : `${resH.toFixed(1)} h`) : 'stable', gens, net: bal.net },
    water: { amount: st.water, cap: waterCap(st), pct: waterCap(st) ? st.water / waterCap(st) : 0, hopperLow },
    stock, lowest: ratios[0], fill: fill(st), robots, deposits, damaged,
    risks: [], pop: alive(st).length, beds: beds(st),
    storm: { active: stormActive(st), inMin: storm && st.minute < storm.start ? storm.start - st.minute : null },
    live: liveTasks(st).length,
  };
  a.risks = risks(st, a);
  return a;
}

function risks(st: ColonyState, a: Analysis): Risk[] {
  const out: Risk[] = [];
  for (const al of activeAlerts(st)) if (al.severity === 'crit') out.push({ key: al.key, text: `${al.title}: ${al.detail}`, severity: 100 });
  if (a.o2.pct < 0.3) out.push({ key: 'o2', text: `Oxygen at ${Math.round(a.o2.pct * 100)}% (reserve ${a.o2.reserveText})`, severity: 90 });
  if (a.o2.leak > 0) out.push({ key: 'leak', text: `Habitat leaking ${a.o2.leak.toFixed(1)} O₂/h`, severity: 85 });
  if (a.power.batteryAtDawn < 5 && hour(st) > 8) out.push({ key: 'night', text: `Battery forecast to run out before dawn (night needs ~${Math.round(a.power.nightUse)} kWh, storage ${a.power.cap} kWh)`, severity: 60 });
  if (a.o2.gens <= 1) out.push({ key: 'spof-o2', text: 'Oxygen depends on a single generator', severity: 45 });
  if (st.modules.filter((m) => m.kind === 'battery' && m.status === 'online').length <= 1) out.push({ key: 'spof-bat', text: 'One battery bank carries the whole night', severity: 40 });
  if (a.power.dusty.length) out.push({ key: 'dust', text: `${a.power.dusty.length} solar array${a.power.dusty.length > 1 ? 's' : ''} dusty (avg ${Math.round((a.power.dusty.reduce((s, m) => s + m.dust, 0) / a.power.dusty.length) * 100)}%)`, severity: 35 });
  if (a.water.hopperLow.length) out.push({ key: 'hopper', text: `${a.water.hopperLow.map((m) => m.name).join(', ')} ice hopper low`, severity: 50 });
  if (a.stock.ice < 10) out.push({ key: 'ice', text: `Only ${a.stock.ice} ice in storage`, severity: 55 });
  if (a.fill > 0.85) out.push({ key: 'fill', text: `Storage ${Math.round(a.fill * 100)}% full`, severity: 40 });
  if (a.storm.inMin !== null) out.push({ key: 'storm', text: `Dust storm in ${Math.floor(a.storm.inMin / 60)}h ${a.storm.inMin % 60}m`, severity: 70 });
  if (a.storm.active) out.push({ key: 'storm-now', text: 'Dust storm in progress', severity: 75 });
  if (a.damaged.length) out.push({ key: 'damage', text: `${a.damaged.map((m) => `${m.name} ${Math.round(m.hp * 100)}%`).join(', ')} damaged`, severity: 65 });
  const broken = st.robots.filter((r) => r.state === 'broken' || r.state === 'dead');
  if (broken.length) out.push({ key: 'robots', text: `${broken.map((r) => r.name).join(', ')} out of action`, severity: 50 });
  if (a.pop >= a.beds) out.push({ key: 'beds', text: `All ${a.beds} beds taken — no room for new colonists`, severity: 20 });
  if (st.rations < a.pop * 3) out.push({ key: 'rations', text: `Rations for ${Math.floor(st.rations / Math.max(1, a.pop))} sols`, severity: 45 });
  return out.sort((x, y) => y.severity - x.severity);
}

export const fmtKw = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(Math.abs(v) < 10 ? 1 : 0)}`;
export { MODULES, mods, RES_IDS };
