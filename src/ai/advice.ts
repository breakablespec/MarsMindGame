// CORE's recommendation engine: the single most useful next move, from live analysis + preferences.

import { RES } from '../sim/defs';
import type { ColonyState } from '../sim/state';
import type { Analysis } from './analysis';
import type { Command } from './command';
import { hasModule } from './validator';
import { signalFor } from './actions';

export interface Rec { text: string; label: string; cmd: Command | null; key: string }

export function recommend(st: ColonyState, a: Analysis): Rec {
  const prefs = st.core.prefs;
  const safe = prefs.safety >= 60;
  if (a.o2.leak > 0) return { key: 'leak', text: `Oxygen leak · ${a.o2.reserveText} left`, label: 'FIX THE OXYGEN PROBLEM', cmd: { intent: 'fix', system: 'oxygen' } };
  if (a.o2.pct < 0.3) return { key: 'o2', text: `Oxygen low · ${Math.round(a.o2.pct * 100)}%`, label: 'FIX THE OXYGEN PROBLEM', cmd: { intent: 'fix', system: 'oxygen' } };
  if (a.storm.inMin !== null && a.storm.inMin < 360 && !st.power.hold) return { key: 'storm', text: `Dust storm in ${Math.floor(a.storm.inMin / 60)}h`, label: 'PREPARE FOR THE STORM', cmd: { intent: 'prepare', storm: true } };
  if (a.water.hopperLow.length && a.stock.ice < 5) return { key: 'ice', text: 'Out of ice soon', label: 'MINE ICE', cmd: { intent: 'mine', resource: 'ice' } };
  if (a.damaged.length) return { key: 'damage', text: `${a.damaged[0].name} damaged · ${Math.round(a.damaged[0].hp * 100)}%`, label: 'REPAIR', cmd: { intent: 'repair' } };
  if (st.robots.some((r) => r.state === 'broken' || r.state === 'dead')) return { key: 'robots', text: 'A robot is broken', label: 'REPAIR ROBOTS', cmd: { intent: 'repair' } };
  if (a.power.forecastBalance < -10) return { key: 'solar', text: `Not enough power tomorrow · −${Math.round(-a.power.forecastBalance)} kWh`, label: 'BUILD A SOLAR ARRAY', cmd: { intent: 'build', module: 'solar' } };
  if (a.power.batteryAtDawn < 5) return { key: 'battery', text: 'Battery won\'t last the night', label: 'BUILD A BATTERY BANK', cmd: { intent: 'build', module: 'battery' } };
  if (a.power.dusty.length) return { key: 'dust', text: 'Solar panels are dusty', label: 'CLEAN THE PANELS', cmd: { intent: 'clean' } };
  if (a.o2.gens <= 1) return { key: 'o2gen', text: safe ? 'You like safety: add a backup O₂ unit' : 'Only one oxygen generator', label: 'BUILD A SECOND OXYGEN GENERATOR', cmd: { intent: 'build', module: 'oxygen' } };
  if (a.fill > 0.85) return { key: 'storage', text: `Storage ${Math.round(a.fill * 100)}% full`, label: 'BUILD STORAGE', cmd: { intent: 'build', module: 'storage' } };
  const sig = signalFor(st, 'titanium');
  if (sig && a.stock.titanium < 40) return { key: 'ti', text: `Titanium low · ${a.stock.titanium}`, label: 'SEND DRONES FOR TITANIUM', cmd: { intent: 'mine', resource: 'titanium', robots: 2 } };
  if (!hasModule(st, 'robotbay')) return { key: 'bay', text: 'Need more robots', label: 'BUILD A ROBOT BAY', cmd: { intent: 'build', module: 'robotbay' } };
  if (!hasModule(st, 'lab')) return { key: 'lab', text: 'No research yet', label: 'BUILD A SPACE LAB', cmd: { intent: 'build', module: 'lab' } };
  if (!st.research.current) return { key: 'research', text: 'Lab is idle', label: 'WHAT SHOULD WE RESEARCH?', cmd: { intent: 'research', question: 'what should we research next' } };
  if (a.pop >= a.beds) return { key: 'beds', text: 'All beds taken', label: 'BUILD A HABITAT', cmd: { intent: 'build', module: 'habitat' } };
  if (!st.robots.some((r) => r.kind === 'hauler')) return { key: 'hauler', text: 'Builder is overloaded', label: 'BUILD A HAULER', cmd: { intent: 'build_robot', robot: 'hauler' } };
  const low = a.lowest;
  if (low.ratio < 0.6) return { key: 'low', text: `${RES[low.res].name} low · ${a.stock[low.res]}`, label: `MINE / MAKE ${RES[low.res].name.toUpperCase()}`, cmd: { intent: 'mine', resource: low.res } };
  return { key: 'expand', text: 'Colony stable', label: 'SCOUT FOR RARE MINERALS', cmd: { intent: 'explore', resource: 'rare' } };
}
