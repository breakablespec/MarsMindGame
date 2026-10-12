// Construction: blueprint sites, staged assembly, grid connection, activation, deconstruction.

import { MODULES, ModuleKind, ResId, ROBOTS, TUNE } from './defs';
import { addHistory, emit, first, mods, scaledCost } from './core';
import { bumpGrid, centerOf, gridAnchor } from './grid';
import { T, idx, inMap, terrain } from './world';
import { batteryCap, o2Cap } from './power';
import { beds } from './life';
import { stores, totalCap } from './storage';
import type { ColonyState, Module, Task, TaskSource } from './state';
import { addHaul, addJob, createTask, finishTask, taskById } from './tasks';

export function moduleName(st: ColonyState, kind: ModuleKind): string {
  const def = MODULES[kind];
  const n = st.modules.filter((m) => m.kind === kind).length + 1;
  return `${def.short}-${n}`;
}

export function newModule(st: ColonyState, kind: ModuleKind, x: number, y: number, status: Module['status']): Module {
  const def = MODULES[kind];
  return {
    id: st.nextId++, kind, name: kind === 'command' ? 'COMMAND' : kind === 'core' ? 'AI CORE' : kind === 'pad' ? 'LANDING PAD' : moduleName(st, kind),
    x, y, w: def.w, h: def.h, status, hp: 1, progress: status === 'online' ? 1 : 0, connected: status === 'online',
    delivered: {}, store: {}, hopper: 0, dust: 0, powered: status === 'online', running: false, fab: null, link: null,
  };
}

export function peakPower(st: ColonyState) {
  return st.modules.filter((m) => m.status === 'online').reduce((a, m) => a + (m.kind === 'solar' ? TUNE.solarPeak * mods(st).solar : MODULES[m.kind].gen ?? 0), 0);
}

function effectFor(st: ColonyState, kind: ModuleKind): Task['effect'] {
  switch (kind) {
    case 'oxygen': case 'habitat': return { kind: 'o2cap', before: o2Cap(st) };
    case 'solar': case 'wind': case 'reactor': case 'geo': return { kind: 'powerpeak', before: peakPower(st) };
    case 'battery': return { kind: 'battery', before: batteryCap(st) };
    case 'storage': return { kind: 'storage', before: totalCap(st) };
    default: return { kind: 'generic', before: 0 };
  }
}

/** Rough real-seconds estimate for a construction given current robots. */
export function estimateBuild(st: ColonyState, kind: ModuleKind, x: number, y: number): number {
  const def = MODULES[kind];
  const cost = scaledCost(st, def.cost);
  const units = Object.values(cost).reduce((a, b) => a + b, 0);
  const haulers = st.robots.filter((r) => ['hauler', 'builder', 'maint', 'repair'].includes(r.kind) && r.state !== 'broken' && r.state !== 'dead');
  const cargo = haulers.length ? haulers.reduce((a, r) => a + ROBOTS[r.kind].cargo, 0) / haulers.length : 15;
  const src = stores(st)[0];
  const dist = src ? Math.hypot(centerOf(src)[0] - x, centerOf(src)[1] - y) : 10;
  const trips = Math.ceil(units / Math.max(1, cargo));
  const haulSec = (trips * (dist * 2 / 2.5 + 3)) / Math.max(1, Math.min(haulers.length, Math.ceil(units / 20)));
  const builders = Math.max(1, st.robots.filter((r) => r.kind === 'builder' && r.state !== 'broken').length);
  const buildSec = def.buildSec / mods(st).build / (1 + (builders - 1) * 0.7);
  return Math.round(haulSec + buildSec + (kind === 'outpost' ? 0 : 4));
}

export interface PlaceOpts { source: TaskSource; command?: string; title?: string; after?: number[]; priority?: number; reason?: string; permission?: string }
/** Put a blueprint on the map and create its task graph: hauls → build → connect. */
export function placeConstruction(st: ColonyState, kind: ModuleKind, x: number, y: number, o: PlaceOpts): { task: Task; site: Module } {
  const def = MODULES[kind];
  const site = newModule(st, kind, x, y, 'site');
  const effect = effectFor(st, kind);
  st.modules.push(site);
  bumpGrid();
  const task = createTask(st, { title: o.title ?? `Build ${def.name}`, kind: 'build', source: o.source, command: o.command, after: o.after, priority: o.priority, siteId: site.id, est: estimateBuild(st, kind, x, y), effect, reason: o.reason, permission: o.permission });
  site.taskId = task.id;
  const cost = scaledCost(st, def.cost);
  const hauls = Object.entries(cost).flatMap(([r, q]) => (q > 0 ? addHaul(st, task, r as ResId, q, site.id, 'site', 'COLLECTING MATERIALS') : []));
  const build = addJob(st, task, { kind: 'build', label: 'ASSEMBLING', target: site.id, after: hauls.map((j) => j.id) });
  if (kind !== 'outpost') addJob(st, task, { kind: 'connect', label: 'CONNECTING GRID', target: site.id, after: [build.id] });
  emit(st, 'blueprint', (x + def.w / 2) * 16, (y + def.h / 2) * 16, { kind });
  emit(st, 'gridChanged');
  return { task, site };
}

export function siteNeeds(st: ColonyState, m: Module): Partial<Record<ResId, number>> {
  const cost = scaledCost(st, MODULES[m.kind].cost);
  const out: Partial<Record<ResId, number>> = {};
  for (const [r, q] of Object.entries(cost)) { const left = q - (m.delivered[r as ResId] ?? 0); if (left > 0) out[r as ResId] = left; }
  return out;
}

/** Start the cable/pipe stage from the site to the nearest grid module. */
export function startLink(st: ColonyState, m: Module) {
  const a = gridAnchor(st, m);
  if (!a) return null;
  const [cx, cy] = centerOf(m);
  m.link = { x: cx, y: cy, to: a.id, pipe: m.kind === 'oxygen' || m.kind === 'habitat' || m.kind === 'medical' || m.kind === 'greenhouse' };
  return a;
}

export function effectText(st: ColonyState, m: Module, effect: Task['effect']): string {
  if (!effect) return `${m.name} ONLINE`;
  switch (effect.kind) {
    case 'o2cap': { const after = o2Cap(st); const pct = effect.before ? Math.round(((after - effect.before) / effect.before) * 100) : 100; return m.kind === 'oxygen' ? `OXYGEN CAPACITY +${pct}% · +${Math.round(TUNE.o2GenRate * mods(st).o2)} O₂/h` : `OXYGEN CAPACITY +${pct}% · BEDS +${mods(st).beds}`; }
    case 'powerpeak': { const after = peakPower(st); return `POWER +${Math.round(after - effect.before)} kW ${m.kind === 'solar' ? 'PEAK' : 'STEADY'}`; }
    case 'battery': return `BATTERY +${batteryCap(st) - effect.before} kWh`;
    case 'storage': return `STORAGE +${totalCap(st) - effect.before}`;
    default:
      switch (m.kind) {
        case 'workshop': return 'PRODUCTION ONLINE';
        case 'lab': return 'RESEARCH ONLINE';
        case 'robotbay': return 'ROBOT FABRICATION ONLINE · +4 PADS';
        case 'outpost': return 'OUTPOST ONLINE · REMOTE DROP-OFF';
        case 'comm': return 'EARTH LINK ONLINE';
        case 'medical': return 'MEDICAL ONLINE';
        case 'greenhouse': return 'GREENHOUSE ONLINE · +4 RATIONS/SOL';
        default: return `${m.name} ONLINE`;
      }
  }
}

/** Final step: power on. Called when the connect job finishes (or build, for self-powered modules). */
export function activate(st: ColonyState, m: Module) {
  m.status = 'online'; m.connected = true; m.link = null; m.progress = 1; m.builtMinute = st.minute; m.powered = true;
  // the base grows: a plated apron around every new module (outposts stay bare)
  if (m.kind !== 'outpost' && m.kind !== 'geo') {
    const t = terrain(st);
    for (let y = m.y - 1; y <= m.y + m.h; y++) for (let x = m.x - 1; x <= m.x + m.w; x++) if (inMap(x, y) && t[idx(x, y)] === T.FLAT) st.terrainEdits[idx(x, y)] = T.PLATE;
  }
  if (m.kind === 'oxygen') m.hopper = 0;
  const task = taskById(st, m.taskId);
  const text = effectText(st, m, task?.effect);
  st.sol.built++;
  emit(st, 'online', (m.x + m.w / 2) * 16, (m.y + m.h / 2) * 16, { text, kind: m.kind, id: m.id });
  const def = MODULES[m.kind];
  const n = st.modules.filter((q) => q.kind === m.kind && q.status === 'online').length;
  if (n === 2 && m.kind === 'oxygen') addHistory(st, 'Second oxygen generator built', 'build');
  else if (n === 2 && m.kind === 'habitat') addHistory(st, 'Second habitat online', 'build');
  else first(st, `built-${m.kind}`, `First ${def.name.toLowerCase()} built`, 'build');
  if (task) finishTask(st, task, true, text);
  void beds;
}

/** Deconstruction finished: the module becomes a crate pile of 75% of its cost. */
export function deconstructDone(st: ColonyState, m: Module) {
  const cost = scaledCost(st, MODULES[m.kind].cost);
  m.delivered = {};
  for (const [r, q] of Object.entries(cost)) m.delivered[r as ResId] = Math.floor(q * 0.75);
  // anything stored inside also comes out
  for (const [r, q] of Object.entries(m.store)) m.delivered[r as ResId] = (m.delivered[r as ResId] ?? 0) + (q ?? 0);
  m.store = {};
  m.status = 'site'; m.salvage = true; m.progress = 0; m.connected = false; m.powered = false;
  emit(st, 'deconstructed', (m.x + m.w / 2) * 16, (m.y + m.h / 2) * 16, { name: m.name });
  emit(st, 'gridChanged');
}

export function cleanupSalvage(st: ColonyState) {
  const before = st.modules.length;
  st.modules = st.modules.filter((m) => {
    if (!m.salvage) return true;
    const left = Object.values(m.delivered).reduce((a, b) => a + (b ?? 0), 0);
    const live = st.jobs.some((j) => (j.status === 'open' || j.status === 'active') && (j.from === m.id || j.target === m.id || j.to === m.id));
    return left > 0 || live;
  });
  if (st.modules.length !== before) { bumpGrid(); emit(st, 'gridChanged'); }
}

export const buildingSites = (st: ColonyState) => st.modules.filter((m) => (m.status === 'site' || m.status === 'building') && !m.salvage);
