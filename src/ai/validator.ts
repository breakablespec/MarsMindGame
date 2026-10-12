// Validator: honest feasibility checks. Plans never claim more than the colony can do.

import { DEPOSIT, MODULES, ModuleKind, RECIPES, RES, RES_IDS, ResId, ROBOTS, RobotKind, STAGE_INFO, TECH, stageIndex } from '../sim/defs';
import { has } from '../sim/core';
import { available } from '../sim/storage';
import type { ColonyState, Inv } from '../sim/state';
import type { Command } from './command';
import { BASE_CX, BASE_CY } from '../sim/world';

export interface Offer { label: string; cmds: Command[]; primary?: boolean }
export interface Check { ok: boolean; reason?: string; offers?: Offer[] }

export const workingRobots = (st: ColonyState, kind?: RobotKind) => st.robots.filter((r) => (!kind || r.kind === kind) && r.state !== 'broken' && r.state !== 'dead');
export const hasModule = (st: ColonyState, kind: ModuleKind) => st.modules.some((m) => m.kind === kind && m.status === 'online');

export function canBuildKind(st: ColonyState, kind: ModuleKind): Check {
  const def = MODULES[kind];
  if (!def.buildable) return { ok: false, reason: kind === 'command' ? 'There is only one command module.' : kind === 'core' ? 'CORE already runs in the AI core.' : `${def.name} can't be built.` };
  if (def.tech && !has(st, def.tech)) {
    const t = TECH[def.tech];
    const lab = hasModule(st, 'lab');
    return { ok: false, reason: `I can't build a ${def.name.toLowerCase()} yet. ${t.name} is not researched.`, offers: lab ? [{ label: `RESEARCH ${t.name.toUpperCase()}`, cmds: [{ intent: 'research', tech: t.id }], primary: true }] : [{ label: 'BUILD A SPACE LAB FIRST', cmds: [{ intent: 'build', module: 'lab', count: 1 }], primary: true }] };
  }
  if (def.stage && stageIndex(st.stage) < stageIndex(def.stage)) return { ok: false, reason: `${def.name} unlocks at stage ${STAGE_INFO[def.stage].name}. We're an ${STAGE_INFO[st.stage].name}.` };
  if (def.needsVent && !st.deposits.some((d) => d.kind === 'vent' && d.found)) return { ok: false, reason: 'A geothermal tap needs a vent, and we haven\'t found one yet.', offers: [{ label: 'SCOUT FOR VENTS', cmds: [{ intent: 'explore' }] }] };
  return { ok: true };
}

export interface Prereq { lines: string[]; produce: { res: ResId; qty: number }[]; mine: { res: ResId; qty: number; depositId: number }[]; blocked?: string; offers: Offer[] }
/** What must happen before a cost can be paid. Resolves production chains (electronics → silica → regolith). */
export function prereqs(st: ColonyState, cost: Inv, mult = 1): Prereq {
  const out: Prereq = { lines: [], produce: [], mine: [], offers: [] };
  const need: Partial<Record<ResId, number>> = {};
  for (const r of RES_IDS) if (cost[r]) need[r] = Math.ceil((cost[r] ?? 0) * mult);
  // processed resources, most refined first
  for (const r of ['electronics', 'polymer', 'silica'] as ResId[]) {
    const short = Math.max(0, (need[r] ?? 0) - available(st, r));
    if (!short) continue;
    if (!hasModule(st, 'workshop')) { out.blocked = `We need ${short} more ${RES[r].name.toLowerCase()} and there is no workshop to make it.`; out.offers.push({ label: 'BUILD A WORKSHOP', cmds: [{ intent: 'build', module: 'workshop', count: 1 }] }); continue; }
    const rec = RECIPES[r]!;
    const batches = Math.ceil(short / rec.outQty);
    for (const [ir, iq] of Object.entries(rec.inputs) as [ResId, number][]) need[ir] = (need[ir] ?? 0) + iq * batches;
    out.produce.unshift({ res: r, qty: batches * rec.outQty });
    out.lines.unshift(`Produce ${batches * rec.outQty} ${RES[r].name.toLowerCase()} at the workshop (~${Math.round(batches * rec.minutes * 0.5)} s)`);
  }
  for (const r of RES_IDS) {
    if (RECIPES[r]) continue;
    const short = Math.max(0, (need[r] ?? 0) - available(st, r));
    if (!short) continue;
    const dep = st.deposits.filter((d) => d.found && d.amount > 0 && DEPOSIT[d.kind].res === r).sort((a, b) => Math.hypot(a.x - BASE_CX, a.y - BASE_CY) - Math.hypot(b.x - BASE_CX, b.y - BASE_CY))[0];
    const miners = workingRobots(st, 'miner');
    if (!dep) { out.blocked = `We need ${short} more ${RES[r].name.toLowerCase()} and haven't found a ${RES[r].name.toLowerCase()} deposit yet.`; out.offers.push({ label: `SCOUT FOR ${RES[r].name.toUpperCase()}`, cmds: [{ intent: 'explore', resource: r }], primary: true }); continue; }
    if (!miners.length) { out.blocked = `We need ${short} more ${RES[r].name.toLowerCase()} but have no working miner.`; out.offers.push({ label: 'BUILD A MINER', cmds: [{ intent: 'build_robot', robot: 'miner', count: 1 }] }); continue; }
    out.mine.push({ res: r, qty: short, depositId: dep.id });
    out.lines.unshift(`${miners[0].name} mines ${short} ${RES[r].name.toLowerCase()} (~${Math.round(short * DEPOSIT[dep.kind].secPerUnit + (Math.hypot(dep.x - BASE_CX, dep.y - BASE_CY) * 2) / 2.2)} s)`);
  }
  return out;
}

export function robotCheck(st: ColonyState, kind: RobotKind): Check {
  const def = ROBOTS[kind];
  if (def.tech && !has(st, def.tech)) return { ok: false, reason: `${def.name}s need ${TECH[def.tech].name} research.`, offers: [{ label: `RESEARCH ${TECH[def.tech].name.toUpperCase()}`, cmds: [{ intent: 'research', tech: def.tech }] }] };
  if (!hasModule(st, 'robotbay')) return { ok: false, reason: `Robots are built at a robot bay, and we don't have one yet.`, offers: [{ label: 'BUILD A ROBOT BAY', cmds: [{ intent: 'build', module: 'robotbay', count: 1 }], primary: true }] };
  return { ok: true };
}
