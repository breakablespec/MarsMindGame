// A brand-new outpost: the starting layout, stock, robots, colonists and standing orders.

import { DEPOSIT, MODULES, POWER_CATS, RES_IDS } from './defs';
import { newModule } from './construction';
import { emptySol, newColonist } from './colony';
import { makeRobot } from './production';
import type { ColonyState, Rule } from './state';
import { BASE_CX, BASE_CY, DEPOSIT_SPECS, START_MODULES, START_RADIUS, encodeMask, generateTerrain, MAP_W, MAP_H, idx } from './world';
import { hashNoise } from './rng';
import { bumpGrid, moduleAccess } from './grid';

export function newColony(seed = 7): ColonyState {
  generateTerrain();
  const st: ColonyState = {
    version: 1, seed, rng: seed * 9973 + 17, minute: 7 * 60, speed: 1, stage: 'outpost',
    explored: '', terrainEdits: {}, modules: [], robots: [], deposits: [], colonists: [], jobs: [], tasks: [], rules: [],
    production: [], fabQueue: [],
    research: { done: [], current: null, rp: 0, delivered: false, taskId: null, queue: [], bank: 0 },
    power: { order: [...POWER_CATS], mode: Object.fromEntries(POWER_CATS.map((c) => [c, 'auto'])) as ColonyState['power']['mode'], hold: null, nightOff: [], battery: 90, gen: 0, demand: 0, used: 0, shed: [], reserve: 0 },
    o2: 130, water: 84, rations: 40,
    weather: { storm: null, nextStorm: 1440 + 17 * 60, solarStorm: null, nextSolarStorm: 0, meteor: null, nextMeteor: 1e9, coldSols: [] },
    shuttle: { next: 2 * 1440 + 600, state: 'away', t: 0, colonists: 0, cargo: {}, rations: 24 },
    alerts: [], history: [], sol: emptySol(), lastReport: null, reports: [],
    core: {
      autonomy: 'assisted',
      perms: { mine: true, build: true, repair: true, trade: false, power: true, research: true, expand: false },
      prefs: { safety: 50, solar: 50, storage: 50, mining: 50, research: 50 }, prefEvidence: [],
      xp: 0, plans: { made: 0, done: 0, failed: 0, refused: 0, estErr: [] }, emergencies: { raised: 0, resolved: 0, times: [] },
      initiated: { count: 0, ok: 0 }, memory: [], forecastErr: [], said: {}, learnedPending: [],
    },
    briefing: { step: 0, done: false, offered: false },
    nextId: 1, deaths: 0, evacuate: [], holdMining: false, lost: false, firsts: {}, scoreHist: [],
  };
  for (let s = 2; s < 80; s++) if (hashNoise(s, 404) < 0.33) st.weather.coldSols.push(s);
  // deposits
  for (const d of DEPOSIT_SPECS) {
    const info = DEPOSIT[d.kind];
    st.deposits.push({ id: st.nextId++, kind: d.kind, x: d.x, y: d.y, amount: info.amount, max: info.amount, found: false, signal: !!d.signal, salvage: d.kind === 'debris' ? { electronics: 12, rare: 4, rp: 60 } : undefined });
  }
  // modules
  for (const s of START_MODULES) {
    const m = newModule(st, s.kind, s.x, s.y, 'online');
    m.builtMinute = 0;
    st.modules.push(m);
  }
  bumpGrid();
  const by = (k: string) => st.modules.find((m) => m.kind === k)!;
  Object.assign(by('storage').store, { iron: 45, titanium: 53, regolith: 30, ice: 22 });
  Object.assign(by('command').store, { silica: 24, polymer: 18, electronics: 14, rare: 3 });
  by('oxygen').hopper = 12;
  const solars = st.modules.filter((m) => m.kind === 'solar');
  solars[0].dust = 0.22; solars[1].dust = 0.14;
  // explored
  const mask = new Uint8Array(MAP_W * MAP_H);
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (Math.hypot(x - BASE_CX, y - BASE_CY) <= START_RADIUS) mask[idx(x, y)] = 1;
  st.explored = encodeMask(mask);
  for (const d of st.deposits) if (mask[idx(d.x, d.y)] && mask[idx(d.x + 1, d.y + 1)] && mask[idx(d.x + 1, d.y)] && mask[idx(d.x, d.y + 1)]) d.found = true;
  // robots
  const storage = by('storage'), cmd = by('command');
  const a = moduleAccess(st, storage).find(([x]) => x > storage.x + 1) ?? moduleAccess(st, storage)[0];
  st.robots.push(makeRobot(st, 'miner', a[0], a[1]));
  const b = moduleAccess(st, cmd).find(([, y]) => y < cmd.y) ?? moduleAccess(st, cmd)[0];
  st.robots.push(makeRobot(st, 'builder', b[0], b[1]));
  st.robots[0].battery = 88; st.robots[1].battery = 94; st.robots[0].condition = 92; st.robots[1].condition = 96;
  // colonists
  const hab = by('habitat');
  for (const [i, role] of (['engineer', 'scientist', 'technician', 'medic'] as const).entries()) {
    const c = newColonist(st, role);
    c.arrivedSol = 1;
    const home = i % 2 === 0 ? hab : cmd;
    c.inside = home.id; c.insideT = 2 + i * 6;
    const acc = moduleAccess(st, home)[0];
    c.x = acc[0] * 16 + 8; c.y = acc[1] * 16 + 12;
    st.colonists.push(c);
  }
  // standing orders
  const rules: Omit<Rule, 'id'>[] = [
    { kind: 'hopper', text: 'Keep oxygen generator hoppers above 8 ice', enabled: true, source: 'START' },
    { kind: 'stock', text: 'Miners keep ice, regolith and iron at target stock', enabled: true, source: 'START' },
    { kind: 'clean', text: 'Clean solar panels every morning (07:00)', enabled: true, minute: 7 * 60, source: 'START' },
  ];
  for (const r of rules) st.rules.push({ id: st.nextId++, ...r });
  st.history.push({ sol: 1, minute: 0, text: 'Outpost founded · CORE online', kind: 'milestone' });
  st.history.push({ sol: 1, minute: 0, text: 'First habitat online · 4 colonists', kind: 'milestone' });
  st.firsts['built-habitat'] = 0; st.firsts['built-oxygen'] = 0; st.firsts['built-solar'] = 0; st.firsts['built-battery'] = 0; st.firsts['built-storage'] = 0; st.firsts['built-workshop'] = 0;
  void RES_IDS; void MODULES;
  return st;
}
