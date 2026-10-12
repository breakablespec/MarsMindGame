// Planner: Command × live analysis → Plan. Plans are shown before anything happens and carry
// an exec() that turns them into tasks. Refusals are honest and come with real alternatives.

import { CAT_NAME, DEPOSIT, MODULES, ModuleKind, PowerCat, RECIPES, RES, ResId, ROBOTS, RobotKind, TECH, TechId, TUNE, TECHS } from '../sim/defs';
import { clock, hour, mods, scaledCost, sol, remember } from '../sim/core';
import { centerOf, findSites, rectGap, SiteOption, zoneName } from '../sim/grid';
import { estimateBuild, placeConstruction, peakPower } from '../sim/construction';
import { batteryCap, demands, o2Cap } from '../sim/power';
import { fill, stores, available, roomOf } from '../sim/storage';
import type { ColonyState, Inv, Module, Robot, Task, TaskSource, Rule } from '../sim/state';
import { cancelTask, liveTasks } from '../sim/tasks';
import { canResearch, labs } from '../sim/research';
import { BASE_CX, BASE_CY, directionOf } from '../sim/world';
import { tileOf } from '../sim/robots';
import { analyze, Analysis } from './analysis';
import type { Command } from './command';
import { SYSTEM_CAT } from './command';
import { canBuildKind, hasModule, Offer, prereqs, robotCheck, workingRobots } from './validator';
import * as A from './actions';
import { recommend } from './advice';

export type Label = 'PARSED' | 'AI PLAN' | 'CORE MODEL';
export interface PlanDetail { label: string; value: string; tone?: 'ok' | 'bad' | 'warn' }
export interface Plan {
  ok: boolean;
  intent: Command['intent'];
  kind: 'build' | 'action' | 'info' | 'refuse' | 'emergency';
  title: string;
  reply: string;
  steps: string[];
  why: string[];
  details: PlanDetail[];
  cost?: Inv;
  sites?: { kind: ModuleKind; options: SiteOption[]; idx: number; count: number };
  confirm: 'build' | 'yes' | 'do' | 'none';
  big: boolean;
  offers: Offer[];
  exec?: (st: ColonyState, src: TaskSource, text: string) => Task[];
  effect?: string;
  estSec?: number;
  learn?: { dim: keyof ColonyState['core']['prefs']; delta: number; text: string }[];
}

const P = (p: Partial<Plan> & Pick<Plan, 'intent' | 'title' | 'reply'>): Plan => ({ ok: true, kind: 'action', steps: [], why: [], details: [], confirm: 'do', big: false, offers: [], ...p });
const refuse = (intent: Command['intent'], reply: string, offers: Offer[] = [], why: string[] = []): Plan => P({ ok: false, intent, kind: 'refuse', title: 'CAN\'T DO THAT YET', reply, offers, why, confirm: 'none' });
const resN = (r: ResId) => RES[r].name.toLowerCase();
const costText = (c: Inv) => Object.entries(c).filter(([, q]) => q).map(([r, q]) => `${q} ${RES[r as ResId].name}`).join(' · ');
const secs = (s: number) => (s < 90 ? `${Math.round(s)} sec` : `${Math.round(s / 60)} min`);

export function plan(st: ColonyState, cmd: Command): Plan {
  const a = analyze(st);
  switch (cmd.intent) {
    case 'build': case 'expand': return planBuild(st, a, cmd);
    case 'mine': return planMine(st, a, cmd);
    case 'explore': return planExplore(st, a, cmd);
    case 'repair': return planRepair(st, a, cmd);
    case 'fix': return planFix(st, a, cmd);
    case 'survive': case 'urgent': return planSurvive(st, a, cmd.intent === 'urgent');
    case 'prepare': return planPrepare(st, a, cmd);
    case 'prioritize': return planPrioritize(st, a, cmd);
    case 'allocate_power': return planAllocate(st, a, cmd);
    case 'charge': return planCharge(st, a, cmd);
    case 'recall': return planRecall(st, a, cmd);
    case 'resume': return P({ intent: 'resume', title: 'RESUME OPERATIONS', reply: 'Back to normal: recall lifted, power holds cleared.', steps: ['Robots return to their jobs', 'Paused systems power back up'], exec: (s) => { A.resume(s); return []; } });
    case 'clean': return planClean(st, a);
    case 'produce': return planProduce(st, a, cmd);
    case 'build_robot': return planRobot(st, a, cmd);
    case 'research': return planResearch(st, a, cmd);
    case 'move': return planMove(st, a, cmd);
    case 'transport': return planTransport(st, a, cmd);
    case 'optimize': return planOptimize(st, a, cmd);
    case 'safety': return planSafety(st, a, cmd);
    case 'schedule': return planSchedule(st, a, cmd);
    case 'inspect': return planInspect(st, a, cmd);
    case 'cancel': {
      const live = liveTasks(st).filter((t) => t.source === 'PLAYER' || t.source === 'CORE' || t.source === 'BRIEFING');
      return P({ intent: 'cancel', title: 'CANCEL TASKS', reply: live.length ? `Cancelling ${live.length} task${live.length > 1 ? 's' : ''}. Materials already delivered go back to storage.` : 'Nothing of yours is running. Routine work continues.', exec: (s) => { for (const t of live) cancelTask(s, t, 'Cancelled by commander'); return []; } });
    }
    default: return refuse('unknown', 'I didn\'t catch that. Try: "Build a solar array", "Mine 20 titanium", "Prepare for a dust storm", "Fix the power problem".', [{ label: 'WHAT SHOULD WE DO NEXT?', cmds: [{ intent: 'inspect' }] }]);
  }
}

// ------------------------------------------------------------------ BUILD

const DEFAULT_ANCHOR: Partial<Record<ModuleKind, ModuleKind[]>> = {
  solar: ['solar', 'battery'], battery: ['battery', 'solar'], storage: ['storage', 'workshop'], oxygen: ['oxygen', 'habitat'],
  habitat: ['habitat', 'command'], workshop: ['storage', 'workshop'], lab: ['command', 'core'], robotbay: ['command', 'storage'],
  comm: ['command'], medical: ['habitat'], wind: ['solar', 'battery'], greenhouse: ['habitat'], reactor: ['battery'],
};
export function anchorFor(st: ColonyState, cmd: Command, kind: ModuleKind): { at: [number, number]; why?: string } {
  const near = cmd.near;
  const base: [number, number] = [BASE_CX, BASE_CY];
  if (near === 'mine') {
    const active = st.jobs.filter((j) => j.kind === 'mine' && (j.status === 'active' || j.status === 'open')).map((j) => st.deposits.find((d) => d.id === j.target)).filter(Boolean);
    const d = active[0] ?? st.deposits.filter((q) => q.found && q.amount > 0 && DEPOSIT[q.kind].res).sort((x, y) => Math.hypot(x.x - BASE_CX, x.y - BASE_CY) - Math.hypot(y.x - BASE_CX, y.y - BASE_CY))[0];
    if (d) return { at: [d.x + 1, d.y + 1], why: `near the ${DEPOSIT[d.kind].name.toLowerCase()}` };
  } else if (near && near !== 'base') {
    if (near in MODULES) {
      const ms = st.modules.filter((m) => m.kind === near && (m.status === 'online' || m.status === 'off'));
      if (ms.length) { const c = centerOf(ms[0]); return { at: c, why: `near ${ms[0].name}` }; }
    } else {
      const d = A.nearestDeposit(st, near as ResId);
      if (d) return { at: [d.x + 1, d.y + 1], why: `near the ${DEPOSIT[d.kind].name.toLowerCase()}` };
    }
  }
  if (cmd.direction && cmd.direction !== 'nearest') {
    const v = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }[cmd.direction];
    return { at: [BASE_CX + v[0] * 11, BASE_CY + v[1] * 9], why: `${cmd.direction} of the base` };
  }
  if (kind === 'outpost') {
    const far = st.deposits.filter((d) => d.found && d.amount > 0 && DEPOSIT[d.kind].res && Math.hypot(d.x - BASE_CX, d.y - BASE_CY) > 14).sort((x, y) => Math.hypot(x.x - BASE_CX, x.y - BASE_CY) - Math.hypot(y.x - BASE_CX, y.y - BASE_CY))[0];
    if (far) return { at: [far.x + 1, far.y + 3], why: `next to the ${DEPOSIT[far.kind].name.toLowerCase()}` };
  }
  for (const k of DEFAULT_ANCHOR[kind] ?? []) {
    const ms = st.modules.filter((m) => m.kind === k && m.status === 'online');
    if (ms.length) { const cx = ms.reduce((s, m) => s + centerOf(m)[0], 0) / ms.length, cy = ms.reduce((s, m) => s + centerOf(m)[1], 0) / ms.length; return { at: [cx, cy] }; }
  }
  return { at: base };
}

export function pickSites(st: ColonyState, kind: ModuleKind, at: [number, number], count: number): SiteOption[] {
  const opts = findSites(st, kind, at, 12, kind === 'outpost' ? 10 : 18);
  const def = MODULES[kind];
  const chosen: SiteOption[] = [];
  for (const o of opts) {
    if (chosen.some((c) => rectGap({ x: c.x, y: c.y, w: def.w, h: def.h }, { x: o.x, y: o.y, w: def.w, h: def.h }) < 1)) continue;
    chosen.push(o);
  }
  // keep the first `count` as the plan, the rest as alternatives for CHANGE LOCATION
  return chosen.length >= count ? chosen : chosen;
}

export function predictEffect(st: ColonyState, kind: ModuleKind, count: number): string {
  const def = MODULES[kind];
  switch (kind) {
    case 'oxygen': { const c = o2Cap(st); return `OXYGEN CAPACITY +${Math.round(((def.o2Cap ?? 0) * count / Math.max(1, c)) * 100)}% · +${Math.round(TUNE.o2GenRate * mods(st).o2 * count)} O₂/h`; }
    case 'habitat': return `+${mods(st).beds * count} BEDS · OXYGEN CAPACITY +${Math.round(((def.o2Cap ?? 0) * count / Math.max(1, o2Cap(st))) * 100)}%`;
    case 'solar': return `POWER +${Math.round(TUNE.solarPeak * mods(st).solar * count)} kW PEAK (+${Math.round(TUNE.solarPeak * mods(st).solar * 8.3 * count)} kWh/sol)`;
    case 'battery': return `BATTERY +${TUNE.batteryKwh * count} kWh (${batteryCap(st)} → ${batteryCap(st) + TUNE.batteryKwh * count})`;
    case 'storage': return `STORAGE +${(def.storeCap ?? 0) * count}`;
    case 'wind': case 'reactor': case 'geo': return `POWER +${(def.gen ?? 0) * count} kW STEADY`;
    default: return def.desc;
  }
}

function buildWhy(st: ColonyState, a: Analysis, kind: ModuleKind): string[] {
  const out: string[] = [];
  switch (kind) {
    case 'oxygen': out.push(a.o2.gens <= 1 ? 'Oxygen depends on a single generator' : `${a.o2.gens} generators make ${Math.round(a.o2.gens * TUNE.o2GenRate * mods(st).o2)} O₂/h`); out.push(`${a.pop} colonists breathe ${a.pop} O₂/h`); break;
    case 'solar': out.push(a.power.forecastBalance < 0 ? `Energy forecast ${Math.round(a.power.forecastBalance)} kWh over the next sol` : `Energy forecast +${Math.round(a.power.forecastBalance)} kWh over the next sol`); out.push(`Peak generation now ${Math.round(peakPower(st))} kW`); break;
    case 'battery': out.push(`Tonight needs ~${Math.round(a.power.nightUse)} kWh; storage holds ${a.power.cap} kWh`); if (a.power.batteryAtDawn < 5) out.push('Battery is forecast to run empty before dawn'); break;
    case 'storage': out.push(`Storage ${Math.round(a.fill * 100)}% full`); break;
    case 'habitat': out.push(`${a.pop}/${a.beds} beds used — the shuttle only brings colonists when there are free beds`); break;
    case 'robotbay': out.push(`${st.robots.length} robots do all the colony's work`, 'A bay builds new robots and adds 4 charging pads'); break;
    case 'lab': out.push('Research unlocks real upgrades: solar +12%, faster drills, storm forecasting…'); break;
    case 'workshop': out.push('Turns regolith, ice and rare minerals into silica, polymer and electronics'); break;
  }
  return out;
}

function planBuild(st: ColonyState, a: Analysis, cmd: Command): Plan {
  let kind = cmd.module;
  if (!kind) {
    if (cmd.system === 'power') kind = 'solar'; else if (cmd.system === 'storage') kind = 'storage'; else if (cmd.system === 'oxygen') kind = 'oxygen';
    else return refuse('build', 'What should I build? I can make solar arrays, batteries, oxygen generators, storage, habitats, a workshop, a space lab, a robot bay and more.', [{ label: 'SOLAR ARRAY', cmds: [{ intent: 'build', module: 'solar' }] }, { label: 'BATTERY', cmds: [{ intent: 'build', module: 'battery' }] }, { label: 'STORAGE', cmds: [{ intent: 'build', module: 'storage' }] }]);
  }
  const def = MODULES[kind];
  const chk = canBuildKind(st, kind);
  if (!chk.ok) return refuse('build', chk.reason!, chk.offers ?? []);
  let count = Math.max(1, Math.min(4, cmd.count ?? 1));
  let note = '';
  if (kind === 'habitat' && cmd.colonists) { count = Math.max(1, Math.ceil(cmd.colonists / mods(st).beds)); note = `Habitats hold ${mods(st).beds}. For ${cmd.colonists} more colonists I'll build ${count} (${count * mods(st).beds} beds). `; }
  const anchor = anchorFor(st, cmd, kind);
  const options = pickSites(st, kind, anchor.at, count);
  if (options.length < count) {
    if (!options.length) return refuse('build', `I can't find a valid site for a ${def.name.toLowerCase()} ${anchor.why ?? 'near the base'}: it needs flat, explored ground within 10 tiles of the power grid${kind === 'outpost' ? '' : ''}.`, [{ label: 'SCOUT FOR SPACE', cmds: [{ intent: 'explore' }] }, { label: 'TRY NEAR THE BASE', cmds: [{ ...cmd, near: 'base', direction: undefined }] }]);
    note += `Only room for ${options.length} near there. `;
    count = options.length;
  }
  const cost = scaledCost(st, def.cost);
  const totalCost: Inv = Object.fromEntries(Object.entries(cost).map(([r, q]) => [r, q * count]));
  const pre = prereqs(st, cost, count);
  if (pre.blocked) return refuse('build', `${note}${pre.blocked}`, pre.offers, buildWhy(st, a, kind));
  const est = estimateBuild(st, kind, options[0].x, options[0].y) * (1 + (count - 1) * 0.7);
  const preSec = pre.produce.reduce((s, p) => s + (RECIPES[p.res]!.minutes * Math.ceil(p.qty / RECIPES[p.res]!.outQty)) * 0.5, 0) + pre.mine.reduce((s, m) => s + m.qty * DEPOSIT[st.deposits.find((d) => d.id === m.depositId)!.kind].secPerUnit + 20, 0);
  const effect = predictEffect(st, kind, count);
  const power = (def.gen ? (kind === 'solar' ? TUNE.solarPeak * mods(st).solar : def.gen) : -def.draw) * count;
  const details: PlanDetail[] = [
    { label: 'Location', value: count > 1 ? `${options.slice(0, count).map((o) => o.zone).filter((v, i, s) => s.indexOf(v) === i).join(', ')}` : options[0].zone },
    { label: 'Cost', value: costText(totalCost), tone: pre.lines.length ? 'warn' : 'ok' },
    { label: 'Power', value: `${power >= 0 ? '+' : ''}${power.toFixed(power % 1 ? 1 : 0)} kW${kind === 'solar' ? ' peak' : ''}` },
    { label: 'Build Time', value: `${secs(est + preSec)}` },
    { label: 'Result', value: effect, tone: 'ok' },
  ];
  const builders = workingRobots(st, 'builder');
  const haulers = workingRobots(st).filter((r) => ['hauler', 'builder', 'maint', 'repair'].includes(r.kind));
  const src = stores(st).map((m) => m.name).slice(0, 2).join(' / ');
  const steps = [
    ...pre.lines,
    `${haulers.slice(0, 2).map((r) => r.name).join(' + ') || 'Robots'} collect ${costText(totalCost)} from ${src}`,
    `Haul to the site — ${options[0].zone}`,
    `${builders.map((r) => r.name).join(' + ') || 'A builder'} assembles: foundation → frame → cladding`,
    kind === 'outpost' ? 'Self-powered: switches on when assembled' : `Connect to the grid${kind === 'oxygen' || kind === 'habitat' ? ' and oxygen network' : ''}`,
    `Activate: ${effect}`,
  ];
  let reply: string;
  let confirm: Plan['confirm'] = 'build';
  if (pre.mine.length) { reply = `${note}Need ${pre.mine.map((x) => `${x.qty} more ${resN(x.res)}`).join(' and ')} first. Mine it?`; confirm = 'yes'; }
  else if (pre.produce.length) {
    const short = pre.produce.map((p) => { const direct = Math.ceil((cost[p.res] ?? 0) * count) - available(st, p.res); return `${direct > 0 ? direct : p.qty} more ${resN(p.res)}`; });
    reply = `${note}I can build it after we produce ${short.join(' and ')}. Want me to prioritize ${pre.produce.map((p) => resN(p.res)).join(' and ')} production?`;
    confirm = 'yes';
  } else reply = `${note}Ready to build. Blueprint is on the map.`;
  return P({
    intent: 'build', kind: 'build', title: `BUILD PLAN · ${def.name.toUpperCase()}${count > 1 ? ` ×${count}` : ''}`, reply, steps, why: buildWhy(st, a, kind), details,
    cost: totalCost, sites: { kind, options, idx: 0, count }, confirm, big: true, estSec: est + preSec, effect,
    learn: kind === 'oxygen' && a.o2.gens >= 1 && a.o2.pct > 0.5 ? [{ dim: 'safety', delta: 6, text: 'built a backup oxygen generator before it was needed' }] : kind === 'storage' && a.fill < 0.8 ? [{ dim: 'storage', delta: 6, text: 'added storage early' }] : kind === 'reactor' ? [{ dim: 'solar', delta: -10, text: 'chose a reactor' }] : kind === 'solar' ? [{ dim: 'solar', delta: 4, text: 'built solar' }] : kind === 'battery' ? [{ dim: 'safety', delta: 3, text: 'added battery reserve' }] : undefined,
    exec: (s, srcT, text) => {
      const out: Task[] = [];
      const preIds: number[] = [];
      for (const m of pre.mine) { const d = s.deposits.find((q) => q.id === m.depositId); if (!d) continue; const miners = workingRobots(s, 'miner').slice(0, 1); A.preempt(s, miners); const t = A.mineTask(s, d, m.qty, miners, srcT, text, [], `Mine ${m.qty} ${resN(m.res)} for ${def.name.toLowerCase()}`); preIds.push(t.id); out.push(t); }
      for (const p of pre.produce) { const t = A.produceTask(s, p.res, p.qty, srcT, text, pre.mine.length ? [...preIds] : []); out.push(t); preIds.push(t.id); }
      const idx = (this_sites.idx ?? 0);
      const chosen = options.slice(idx, idx + count).length === count ? options.slice(idx, idx + count) : options.slice(0, count);
      for (const o of chosen) { const { task } = placeConstruction(s, kind!, o.x, o.y, { source: srcT, command: text, after: preIds, priority: srcT === 'EMERGENCY' ? 0 : 1 }); out.push(task); }
      return out;
    },
  });
}
// CHANGE LOCATION mutates this holder before exec (set by the UI)
const this_sites: { idx: number } = { idx: 0 };
export function setSiteIndex(i: number) { this_sites.idx = i; }

// ------------------------------------------------------------------ MINE / EXPLORE

function planMine(st: ColonyState, a: Analysis, cmd: Command): Plan {
  let res = cmd.resource;
  if (res === 'all') res = 'lowest';
  if (res === 'lowest' || !res) {
    const raw = (['ice', 'regolith', 'iron', 'titanium', 'rare'] as ResId[]).filter((r) => A.nearestDeposit(st, r)).map((r) => ({ r, ratio: a.stock[r] / RES[r].target })).sort((x, y) => x.ratio - y.ratio);
    if (!raw.length) return refuse('mine', 'We haven\'t found any deposits to mine. Scout first?', [{ label: 'SCOUT', cmds: [{ intent: 'explore' }], primary: true }]);
    res = raw[0].r;
  }
  if (RECIPES[res]) return planProduce(st, a, { intent: 'produce', resource: res, qty: cmd.qty });
  const miners = workingRobots(st, 'miner');
  if (!miners.length) return refuse('mine', 'No working miner. Build one at a robot bay?', hasModule(st, 'robotbay') ? [{ label: 'BUILD A MINER', cmds: [{ intent: 'build_robot', robot: 'miner' }], primary: true }] : [{ label: 'BUILD A ROBOT BAY', cmds: [{ intent: 'build', module: 'robotbay' }], primary: true }]);
  let want = Math.max(1, cmd.robots ?? 1);
  let named = cmd.robotName ? miners.filter((r) => r.name === cmd.robotName) : [];
  const pickN = named.length ? named : miners.slice().sort((x, y) => (x.jobId === null ? 0 : 1) - (y.jobId === null ? 0 : 1) || y.battery - x.battery).slice(0, want);
  const shortNote = want > miners.length ? `We only have ${miners.length} miner${miners.length > 1 ? 's' : ''}, so I'm sending ${miners.length === 1 ? 'it' : 'them all'}. ` : '';
  want = pickN.length;
  const dep = A.nearestDeposit(st, res);
  const qty = cmd.qty ?? Math.round(ROBOTS.miner.cargo * mods(st).cargo * want);
  if (!dep) {
    const sig = A.signalFor(st, res);
    if (sig) {
      const dir = directionOf(sig.x, sig.y), dist = Math.round(Math.hypot(sig.x - BASE_CX, sig.y - BASE_CY));
      const scout = workingRobots(st, 'scout')[0] ?? null;
      const steps = [`${scout ? scout.name : pickN[0].name} surveys the orbital signal ${dir} (${dist} tiles)`, `When ${resN(res)} is confirmed, ${pickN.map((r) => r.name).join(' + ')} mine ${qty} ${resN(res)}`, `Cargo returns to the nearest storage`];
      return P({ intent: 'mine', title: `MINING PLAN · ${RES[res].name.toUpperCase()}`, reply: `${shortNote}No confirmed ${resN(res)} yet, but the orbital survey shows a signal ${dir}. I'll check it, then mine.`, steps, why: [`${RES[res].name} stock ${a.stock[res]} (target ${RES[res].target})`], details: [{ label: 'Route', value: `${dist} tiles ${dir}` }, { label: 'Robots', value: pickN.map((r) => r.name).join(', ') }],
        estSec: dist * 2 / 2.2 + qty * DEPOSIT[sig.kind].secPerUnit,
        learn: [{ dim: 'mining', delta: 4, text: `asked for ${resN(res)} mining` }],
        exec: (s, src, text) => {
          A.preempt(s, pickN);
          const wp = A.scoutWaypoints(s, [BASE_CX, BASE_CY], undefined, [sig.x + 1, sig.y + 3]);
          const t1 = A.scoutTask(s, scout ?? pickN[0], wp, src, { find: sig.kind, command: text, title: `Survey ${resN(res)} signal` });
          const d = s.deposits.find((q) => q.id === sig.id)!;
          const t2 = A.mineTask(s, d, qty, pickN, src, text, [t1.id], `Mine ${qty} ${resN(res)}`);
          return [t1, t2];
        } });
    }
    return refuse('mine', `We haven't found any ${resN(res)} yet. Scout for it?`, [{ label: `SCOUT FOR ${RES[res].name.toUpperCase()}`, cmds: [{ intent: 'explore', resource: res }], primary: true }]);
  }
  const dist = Math.round(Math.hypot(dep.x - BASE_CX, dep.y - BASE_CY));
  const dir = directionOf(dep.x, dep.y);
  if (fill(st) > 0.95) return refuse('mine', 'Storage is full — anything mined would have nowhere to go. Build storage first?', [{ label: 'BUILD STORAGE', cmds: [{ intent: 'build', module: 'storage' }], primary: true }]);
  const trip = (dist * 2) / 2.2 + ROBOTS.miner.cargo * DEPOSIT[dep.kind].secPerUnit;
  return P({
    intent: 'mine', title: `MINING PLAN · ${RES[res].name.toUpperCase()}`, reply: `${shortNote}Assigning ${pickN.map((r) => r.name).join(' and ')}. Route is on the map.`,
    steps: [`${pickN.map((r) => r.name).join(' + ')} drive${pickN.length > 1 ? '' : 's'} to the ${DEPOSIT[dep.kind].name.toLowerCase()} (${dist} tiles ${dir})`, `Drill ${qty} ${resN(res)} (deposit has ${dep.amount})`, 'Return to the nearest storage and unload', `Repeat until ${qty} ${resN(res)} are in storage`],
    why: [`${RES[res].name} stock ${a.stock[res]} (target ${RES[res].target})`],
    details: [{ label: 'Deposit', value: `${DEPOSIT[dep.kind].name} · ${dep.amount} left` }, { label: 'Distance', value: `${dist} tiles ${dir}` }, { label: 'Robots', value: pickN.map((r) => `${r.name} ${Math.round(r.battery)}%`).join(', ') }, { label: 'Est. time', value: secs(trip * Math.ceil(qty / (ROBOTS.miner.cargo * pickN.length))) }],
    estSec: trip * Math.ceil(qty / (ROBOTS.miner.cargo * pickN.length)),
    learn: [{ dim: 'mining', delta: 3, text: `ordered ${resN(res)} mining` }],
    exec: (s, src, text) => { A.preempt(s, pickN); return [A.mineTask(s, dep, qty, pickN, src, text, [], `Mine ${qty} ${resN(res)}`)]; },
  });
}

function planExplore(st: ColonyState, a: Analysis, cmd: Command): Plan {
  const scouts = workingRobots(st, 'scout');
  const miners = workingRobots(st, 'miner');
  const robot: Robot | undefined = scouts[0] ?? miners[0];
  if (!robot) return refuse('explore', 'No robot can scout: we need a scout drone (robot bay) or a miner.', [{ label: 'BUILD A ROBOT BAY', cmds: [{ intent: 'build', module: 'robotbay' }] }]);
  const res = cmd.resource && cmd.resource !== 'lowest' && cmd.resource !== 'all' ? cmd.resource : undefined;
  const sig = res ? A.signalFor(st, res) : null;
  const sigOk = sig && (!cmd.direction || directionOf(sig.x, sig.y).includes(cmd.direction));
  const target: [number, number] | undefined = sigOk ? [sig!.x + 1, sig!.y + 3] : undefined;
  const wps = A.scoutWaypoints(st, tileOf(robot), cmd.direction, target);
  const dirText = cmd.direction && cmd.direction !== 'nearest' ? cmd.direction : target ? directionOf(target[0], target[1]) : directionOf(wps[2][0], wps[2][1]);
  const slow = robot.kind !== 'scout' ? `${robot.name} will survey (no scout drone yet — slower, smaller view). ` : '';
  const found = res ? A.nearestDeposit(st, res) : null;
  return P({
    intent: 'explore', title: `SCOUT PLAN · ${dirText.toUpperCase()}${res ? ` · ${RES[res].name.toUpperCase()}` : ''}`,
    reply: `${slow}${res && found ? `We already know a ${resN(res)} deposit (${Math.round(Math.hypot(found.x - BASE_CX, found.y - BASE_CY))} tiles ${directionOf(found.x, found.y)}), but I'll look for more. ` : ''}Route plotted ${dirText}.`,
    steps: [`${robot.name} flies/drives ${wps.length} waypoints ${dirText}`, `Reveals terrain (radius ${robot.kind === 'scout' ? 6 : 3}) and surveys deposits`, res ? `Stops when ${resN(res)} is confirmed` : 'Returns to base', 'Charges at the nearest pad'],
    why: [`${Math.round((1 - a.deposits.length / Math.max(1, st.deposits.length)) * 100)}% of known signals unconfirmed`],
    details: [{ label: 'Robot', value: `${robot.name} · ${Math.round(robot.battery)}%` }, { label: 'Route', value: `${wps.length} waypoints ${dirText}` }],
    exec: (s, src, text) => { A.preempt(s, [robot]); return [A.scoutTask(s, robot, wps, src, { find: res ? (res as string) : undefined, command: text, title: `Scout ${dirText}${res ? ` for ${resN(res)}` : ''}` })]; },
  });
}

// ------------------------------------------------------------------ REPAIR / FIX

function repairWho(st: ColonyState) {
  const rep = workingRobots(st, 'repair');
  if (rep.length) return { name: rep[0].name, slow: false };
  const b = workingRobots(st, 'builder');
  return b.length ? { name: b[0].name, slow: true } : null;
}
function planRepair(st: ColonyState, a: Analysis, cmd: Command): Plan {
  const targets: { module?: Module; robot?: Robot }[] = [];
  if (cmd.robotName) { const r = st.robots.find((q) => q.name === cmd.robotName); if (r) targets.push({ robot: r }); }
  else if (cmd.module) {
    const ms = st.modules.filter((m) => m.kind === cmd.module && (m.status === 'online' || m.status === 'off'));
    const dmg = ms.filter((m) => m.hp < 1);
    if (!ms.length) return refuse('repair', `We don't have a ${MODULES[cmd.module].name.toLowerCase()}.`);
    if (!dmg.length) return P({ intent: 'repair', kind: 'info', title: 'NO REPAIR NEEDED', reply: `${ms.map((m) => `${m.name} hull ${Math.round(m.hp * 100)}%`).join(', ')} — nothing to repair.${cmd.module === 'oxygen' ? ` It's ${ms[0].running ? 'producing' : ms[0].powered ? 'idle (tank full or no water)' : 'unpowered'}.` : ''}`, confirm: 'none', offers: cmd.module === 'oxygen' ? [{ label: 'FIX THE OXYGEN PROBLEM', cmds: [{ intent: 'fix', system: 'oxygen' }] }] : [] });
    for (const m of dmg) targets.push({ module: m });
  } else {
    for (const m of a.damaged) targets.push({ module: m });
    for (const r of st.robots.filter((q) => q.state === 'broken' || q.state === 'dead' || q.condition < 50)) targets.push({ robot: r });
  }
  if (!targets.length) return P({ intent: 'repair', kind: 'info', title: 'ALL SYSTEMS NOMINAL', reply: 'Nothing is damaged and no robot needs repairs.', confirm: 'none' });
  const who = repairWho(st);
  if (!who) return refuse('repair', 'No robot can repair: we need a repair bot or a builder.', [{ label: 'BUILD A REPAIR BOT', cmds: [{ intent: 'build_robot', robot: 'repair' }] }]);
  const leak = targets.some((t) => t.module?.kind === 'habitat');
  return P({
    intent: 'repair', title: `REPAIR PLAN`, reply: `${who.name} is on it${who.slow ? ' (builders repair at 40% speed)' : ''}.`,
    steps: targets.map((t) => t.module ? `${t.module.kind === 'habitat' ? 'Seal' : 'Repair'} ${t.module.name} (hull ${Math.round(t.module.hp * 100)}%)` : `${t.robot!.state === 'dead' ? 'Recharge' : 'Repair'} ${t.robot!.name} (${t.robot!.state === 'dead' ? 'battery 0%' : `condition ${Math.round(t.robot!.condition)}%`})`),
    why: leak ? ['A damaged habitat leaks oxygen'] : [],
    exec: (s, src, text) => [A.repairTask(s, targets, leak ? 'EMERGENCY' : src, text)],
  });
}

function planFix(st: ColonyState, a: Analysis, cmd: Command): Plan {
  if (cmd.system === 'oxygen' || cmd.system === 'life' || cmd.system === 'water') return planOxygen(st, a, cmd);
  if (cmd.system === 'storage') return planBuild(st, a, { intent: 'build', module: 'storage' });
  if (cmd.system === 'research') {
    const lab = labs(st)[0];
    if (!lab) return refuse('fix', 'There is no lab yet.', [{ label: 'BUILD A SPACE LAB', cmds: [{ intent: 'build', module: 'lab' }] }]);
    if (!st.research.current) return P({ intent: 'fix', kind: 'info', title: 'RESEARCH', reply: 'The lab is idle — pick a project.', confirm: 'none', offers: [{ label: 'WHAT SHOULD WE RESEARCH?', cmds: [{ intent: 'research', question: 'what next' }] }] });
    if (!lab.powered) return planAllocate(st, a, { intent: 'allocate_power', system: 'research', off: false });
  }
  // power
  const steps: string[] = [], why: string[] = [];
  const execs: ((s: ColonyState, src: TaskSource, text: string) => Task[])[] = [];
  const offers: Offer[] = [];
  if (a.power.shed.length) why.push(`Paused now: ${a.power.shed.join(', ')}`);
  why.push(`Generation ${a.power.gen.toFixed(1)} kW vs demand ${a.power.demand.toFixed(1)} kW · battery ${Math.round(a.power.battery)}/${a.power.cap} kWh`);
  if (a.power.forecastBalance < 0) why.push(`Next sol: ${Math.round(a.power.forecastBalance)} kWh short`);
  if (a.power.batteryAtDawn < 5) why.push(`Battery runs out before dawn (night needs ~${Math.round(a.power.nightUse)} kWh)`);
  const dusty = st.modules.filter((m) => m.kind === 'solar' && m.status === 'online' && m.dust > 0.1);
  if (dusty.length) { steps.push(`Clean ${dusty.length} dusty array${dusty.length > 1 ? 's' : ''} (+${Math.round(dusty.reduce((s, m) => s + m.dust, 0) * TUNE.solarPeak)} kW at noon)`); execs.push((s, src, text) => [A.cleanTask(s, dusty, src, text)]); }
  const damaged = st.modules.filter((m) => (m.kind === 'solar' || m.kind === 'battery') && m.hp < 0.9 && m.status === 'online');
  if (damaged.length) { steps.push(`Repair ${damaged.map((m) => m.name).join(', ')}`); execs.push((s, src, text) => [A.repairTask(s, damaged.map((m) => ({ module: m })), src, text)]); }
  const night = hour(st) >= 15 || hour(st) < 6;
  if (a.power.batteryAtDawn < 10 || a.power.shed.length) {
    steps.push(`Pause LIGHTING and RESEARCH ${night ? 'until sunrise' : 'until the battery recovers'} (saves ~${(0.1 * st.modules.length + (st.research.current ? 3 : 0)).toFixed(1)} kW)`);
    execs.push((s) => { A.holdPower(s, ['lighting', 'research'], 'power fix', { untilMinute: night ? (Math.floor(s.minute / 1440) + (hour(s) >= 6 ? 1 : 0)) * 1440 + 7 * 60 : s.minute + 240 }); return []; });
  }
  const dayDeficit = a.power.forecastBalance < 0;
  const nightShort = a.power.batteryAtDawn < 5;
  if (dayDeficit) offers.push({ label: 'BUILD A SOLAR ARRAY', cmds: [{ intent: 'build', module: 'solar' }], primary: true });
  if (nightShort && !dayDeficit) offers.push({ label: 'BUILD A BATTERY BANK', cmds: [{ intent: 'build', module: 'battery' }], primary: true });
  if (!steps.length && !offers.length) return P({ intent: 'fix', kind: 'info', title: 'POWER OK', reply: `Power is fine: ${a.power.gen.toFixed(1)} kW in, ${a.power.used.toFixed(1)} kW used, battery ${Math.round(a.power.battery)} kWh, forecast ${a.power.forecastBalance >= 0 ? '+' : ''}${Math.round(a.power.forecastBalance)} kWh.`, why, confirm: 'none' });
  if (offers.length) steps.push(`Long-term: ${offers.map((o) => o.label.toLowerCase()).join(' or ')} (needs your OK)`);
  return P({ intent: 'fix', title: 'POWER FIX', reply: steps.length > 1 ? 'Here\'s the fix, cheapest first.' : 'One change will do it.', steps, why, offers, exec: execs.length ? (s, src, text) => execs.flatMap((e) => e(s, src, text)) : undefined, ok: execs.length > 0, confirm: execs.length ? 'do' : 'none' });
}

function planOxygen(st: ColonyState, a: Analysis, cmd: Command): Plan {
  const steps: string[] = [], why: string[] = [];
  const execs: ((s: ColonyState, src: TaskSource, text: string) => Task[])[] = [];
  const offers: Offer[] = [];
  why.push(`Oxygen ${Math.round(a.o2.pct * 100)}% · making ${a.o2.prod.toFixed(1)}/h · using ${(a.o2.use + a.o2.leak).toFixed(1)}/h · reserve ${a.o2.reserveText}`);
  const leaking = st.modules.filter((m) => m.kind === 'habitat' && m.hp < 0.95 && m.status !== 'site');
  const who = repairWho(st);
  if (leaking.length) {
    why.push(`Leak in ${leaking.map((m) => m.name).join(', ')} (−${a.o2.leak.toFixed(1)} O₂/h)`);
    if (st.modules.filter((m) => m.kind === 'habitat' && m.status === 'online').length > leaking.length || st.modules.some((m) => m.kind === 'command')) { steps.push('Reduce habitat occupancy — colonists move to the command module'); execs.push((s) => { s.evacuate = leaking.map((m) => m.id); return []; }); }
    if (st.research.current || st.modules.some((m) => m.kind === 'lab')) { steps.push('Shut down the research lab (+3 kW to life support)'); execs.push((s) => { A.holdPower(s, ['research', 'lighting'], 'oxygen emergency', { untilO2: 60 }); return []; }); }
    steps.push(who ? `Redirect ${who.name} → ${leaking[0].name}${who.slow ? ' (builder: slower)' : ''}` : 'No robot can repair — build a repair bot');
    steps.push('Seal section (leak stops as the hull is repaired)');
    if (who) execs.push((s, src, text) => [A.repairTask(s, leaking.map((m) => ({ module: m })), 'EMERGENCY', text)]);
  }
  const gens = st.modules.filter((m) => m.kind === 'oxygen' && m.status === 'online');
  const starving = gens.filter((m) => m.hopper < TUNE.hopperLow);
  if (starving.length) {
    const ice = available(st, 'ice');
    if (ice > 0) { steps.push(`Refill ${starving.map((m) => m.name).join(', ')} with ice (${Math.min(ice, starving.reduce((s2, m) => s2 + A.hopperNeed(m), 0))} ice)`); execs.push((s, src, text) => starving.map((m) => A.hopperTask(s, m, Math.min(available(s, 'ice'), A.hopperNeed(m)), 'EMERGENCY', text))); }
    else { steps.push('Mine ice — storage is empty'); const d = A.nearestDeposit(st, 'ice'); const mn = workingRobots(st, 'miner'); if (d && mn.length) execs.push((s, src, text) => { A.preempt(s, mn.slice(0, 1)); return [A.mineTask(s, d, 30, mn.slice(0, 1), 'EMERGENCY', text, [], 'Emergency ice run')]; }); }
  }
  const unpowered = gens.filter((m) => !m.powered);
  if (unpowered.length || a.power.shed.includes('LIFE SUPPORT')) { steps.push('Prioritize oxygen: life support first, research and lighting paused until O₂ > 60%'); execs.push((s) => { s.power.order = ['life', ...s.power.order.filter((c) => c !== 'life')]; A.holdPower(s, ['research', 'lighting'], 'oxygen priority', { untilO2: 60 }); s.holdMining = true; return []; }); }
  if (a.o2.net < 0.5 && !leaking.length) { why.push(`Generators can make ${Math.round(a.o2.gens * TUNE.o2GenRate * mods(st).o2)} O₂/h for ${a.pop} colonists`); offers.push({ label: 'BUILD AN OXYGEN GENERATOR', cmds: [{ intent: 'build', module: 'oxygen' }], primary: true }); }
  if (!steps.length) return P({ intent: 'fix', kind: 'info', title: 'OXYGEN OK', reply: `Oxygen is stable: ${Math.round(a.o2.pct * 100)}%, net ${a.o2.net >= 0 ? '+' : ''}${a.o2.net.toFixed(1)} O₂/h.`, why, offers, confirm: 'none' });
  steps.push('Restore oxygen: generators run at full output');
  return P({ intent: 'fix', kind: 'emergency', title: 'OXYGEN RESPONSE', reply: leaking.length ? `Leak confirmed. Reserve ${a.o2.reserveText}.` : 'Here\'s how we restore oxygen.', steps, why, offers, exec: (s, src, text) => execs.flatMap((e) => e(s, src, text)), learn: [{ dim: 'safety', delta: 2, text: 'acted on an oxygen problem' }] });
}

// ------------------------------------------------------------------ SURVIVE / URGENT / PREPARE

function planSurvive(st: ColonyState, a: Analysis, urgentOnly: boolean): Plan {
  const steps: string[] = [], why: string[] = [];
  const execs: ((s: ColonyState, src: TaskSource, text: string) => Task[])[] = [];
  const offers: Offer[] = [];
  const add = (p: Plan) => { if (!p.exec || !p.ok) { offers.push(...p.offers); return; } steps.push(...p.steps.filter((x) => !steps.includes(x))); why.push(...p.why.filter((x) => !why.includes(x))); execs.push(p.exec); offers.push(...p.offers); };
  const stormy = a.storm.active || a.storm.inMin !== null;
  if (stormy) add(planPrepare(st, a, { intent: 'prepare', storm: true }));
  if (a.o2.leak > 0 || a.o2.pct < 0.4 || a.water.hopperLow.length) add(planOxygen(st, a, { intent: 'fix', system: 'oxygen' }));
  if (a.power.shed.length || a.power.batteryAtDawn < 5) add(planFix(st, a, { intent: 'fix', system: 'power' }));
  const broken = st.robots.filter((r) => r.state === 'broken' || r.state === 'dead');
  const dmg = a.damaged.filter((m) => m.kind !== 'habitat');
  if ((broken.length || dmg.length) && repairWho(st)) { steps.push(`Repair ${[...dmg.map((m) => m.name), ...broken.map((r) => r.name)].join(', ')}`); execs.push((s, src, text) => [A.repairTask(s, [...dmg.map((m) => ({ module: m })), ...broken.map((r) => ({ robot: r }))], 'EMERGENCY', text)]); }
  if (!steps.length) {
    const rec = recommend(st, a);
    return P({ intent: urgentOnly ? 'urgent' : 'survive', kind: 'info', title: urgentOnly ? 'MOST URGENT' : 'COLONY STATUS', reply: urgentOnly ? `No emergency. Next: ${rec.text}.` : `Everyone is safe.`, details: [{ label: 'Oxygen', value: `${Math.round(a.o2.pct * 100)}%`, tone: 'ok' }, { label: 'Power', value: `${a.power.net >= 0 ? '+' : ''}${a.power.net.toFixed(1)} kW`, tone: a.power.net >= 0 ? 'ok' : 'warn' }, { label: 'Colonists', value: `${a.pop}`, tone: 'ok' }], why: a.risks.slice(0, 3).map((r) => r.text), confirm: 'none', offers: rec.cmd ? [{ label: rec.label, cmds: [rec.cmd], primary: true }] : [] });
  }
  const take = urgentOnly ? Math.min(steps.length, 3) : steps.length;
  return P({ intent: urgentOnly ? 'urgent' : 'survive', kind: 'emergency', title: urgentOnly ? 'MOST URGENT' : 'KEEP EVERYONE ALIVE', reply: urgentOnly ? `Top priority: ${a.risks[0]?.text ?? steps[0]}.` : 'Survival plan, built from the colony\'s live state:', steps: steps.slice(0, take), why: why.slice(0, 4), offers: offers.slice(0, 3), exec: (s, src, text) => execs.flatMap((e) => e(s, 'EMERGENCY', text)), learn: [{ dim: 'safety', delta: 4, text: 'asked CORE to keep everyone alive' }] });
}

function planPrepare(st: ColonyState, a: Analysis, cmd: Command): Plan {
  const storm = st.weather.storm;
  const until = storm ? storm.end : null;
  const steps: string[] = [], why: string[] = [];
  if (storm && st.minute < storm.end) why.push(st.minute < storm.start ? `Dust storm at ${clock(storm.start)} for ~${Math.round((storm.end - storm.start) / 60)}h · solar −${Math.round(75 * storm.strength)}%` : `Storm in progress until ${clock(storm.end)}`);
  else if (cmd.storm) why.push('No storm on the forecast right now — this sets the colony up for the next one');
  why.push(`Battery ${Math.round(a.power.battery)}/${a.power.cap} kWh · oxygen ${Math.round(a.o2.pct * 100)}%`);
  const outsideRobots = st.robots.filter((r) => r.state !== 'broken' && r.state !== 'dead' && Math.hypot(r.x / 16 - BASE_CX, r.y / 16 - BASE_CY) > 10);
  steps.push(`Charge batteries: pause PRODUCTION, RESEARCH and LIGHTING${until ? ` until ${clock(until)}` : ' for 6h'}`);
  steps.push(`Recall drones${outsideRobots.length ? `: ${outsideRobots.map((r) => r.name).join(', ')}` : ''} and keep robots inside the base`);
  const gens = st.modules.filter((m) => m.kind === 'oxygen' && m.status === 'online');
  const fillable = gens.filter((m) => A.hopperNeed(m) > 0);
  if (fillable.length && available(st, 'ice') > 0) steps.push(`Store oxygen: top up ${fillable.map((m) => m.name).join(', ')} hoppers to ${TUNE.hopperCap} ice`);
  steps.push('Life support first in the power order');
  const dusty = st.modules.filter((m) => m.kind === 'solar' && m.status === 'online' && m.dust > 0.05);
  if (dusty.length && (!storm || st.minute < storm.start)) steps.push(`Clean ${dusty.length} array${dusty.length > 1 ? 's' : ''} now so they start the storm clean`);
  steps.push('After the storm: clean the panels, lift the recall, resume work');
  return P({
    intent: 'prepare', kind: 'emergency', title: 'STORM PREPARATION', reply: storm && st.minute < storm.end ? 'Battening down. Everything below happens now.' : 'Setting up storm posture.', steps, why,
    learn: [{ dim: 'safety', delta: 5, text: 'prepared for a storm in advance' }],
    exec: (s, src, text) => {
      const out: Task[] = [];
      const end = s.weather.storm ? s.weather.storm.end : s.minute + 360;
      A.holdPower(s, ['production', 'research', 'lighting'], 'storm preparation', { untilMinute: end });
      s.power.order = ['life', ...s.power.order.filter((c) => c !== 'life')];
      A.recall(s, s.robots.filter((r) => r.kind !== 'builder' && r.kind !== 'repair' && r.kind !== 'hauler'));
      for (const m of fillable) { const q = Math.min(available(s, 'ice'), A.hopperNeed(m)); if (q > 0) out.push(A.hopperTask(s, m, q, src, text)); }
      if (dusty.length && (!s.weather.storm || s.minute < s.weather.storm.start)) out.push(A.cleanTask(s, dusty, src, text));
      // after the storm: one-shot rule
      s.rules.push({ id: s.nextId++, kind: 'hold', text: `After the storm (${clock(end)}): clean panels, lift recall`, enabled: true, minute: end, source: 'CORE' });
      return out;
    },
  });
}

// ------------------------------------------------------------------ POWER ALLOCATION

function planPrioritize(st: ColonyState, a: Analysis, cmd: Command): Plan {
  const cat = cmd.system ? SYSTEM_CAT[cmd.system] : undefined;
  if (cmd.system === 'oxygen' && !cmd.over) {
    return P({ intent: 'prioritize', title: 'PRIORITIZE OXYGEN', reply: 'Life support is now first in line. Non-essentials pause until oxygen is above 60%.',
      steps: ['Keep: OXYGEN generators, HABITATS, life support', 'Lower: RESEARCH and LIGHTING (paused until O₂ > 60%)', 'Lower: optional mining (routine mining pauses)', `Oxygen now ${Math.round(a.o2.pct * 100)}%`],
      why: [`Oxygen ${Math.round(a.o2.pct * 100)}% · net ${a.o2.net >= 0 ? '+' : ''}${a.o2.net.toFixed(1)} O₂/h`],
      learn: [{ dim: 'safety', delta: 5, text: 'prioritized oxygen' }],
      exec: (s) => { s.power.order = ['life', ...s.power.order.filter((c) => c !== 'life')]; A.holdPower(s, ['research', 'lighting'], 'oxygen priority', { untilO2: 60 }); s.holdMining = s.o2 / Math.max(1, o2Cap(s)) < 0.6; return []; } });
  }
  if (!cat) return refuse('prioritize', 'I can prioritize oxygen, research, production, charging or lighting.');
  const over = cmd.over ? SYSTEM_CAT[cmd.over] : undefined;
  const order = [...st.power.order];
  const without = order.filter((c) => c !== cat);
  let next: PowerCat[];
  if (over) { const i = without.indexOf(over); next = [...without.slice(0, i), cat, ...without.slice(i)]; }
  else next = cat === 'life' ? ['life', ...without] : [without[0], without[1], cat, ...without.slice(2)].filter((c, i, arr) => arr.indexOf(c) === i) as PowerCat[];
  if (cat !== 'life' && next.indexOf(cat) < next.indexOf('life')) next = ['life', ...next.filter((c) => c !== 'life')];
  const note = cat !== 'life' && !over ? ' Life support and core systems always stay above it.' : '';
  return P({ intent: 'prioritize', title: `POWER PRIORITY`, reply: `${CAT_NAME[cat]} moved up.${note}`, steps: next.map((c, i) => `${i + 1}. ${CAT_NAME[c]}${c === cat ? '  ◀' : ''}`), why: a.power.shed.length ? [`Currently paused: ${a.power.shed.join(', ')}`] : ['No systems are paused right now — this sets the order for the next shortage'],
    learn: cat === 'research' ? [{ dim: 'research', delta: 5, text: 'prioritized research' }] : cat === 'life' ? [{ dim: 'safety', delta: 4, text: 'prioritized life support' }] : undefined,
    exec: (s) => { s.power.order = next; return []; } });
}

function planAllocate(st: ColonyState, a: Analysis, cmd: Command): Plan {
  const cat = cmd.system ? SYSTEM_CAT[cmd.system] : cmd.module ? MODULES[cmd.module].cat : undefined;
  if (cmd.module && cmd.module !== 'lab') {
    const ms = st.modules.filter((m) => m.kind === cmd.module && (m.status === 'online' || m.status === 'off'));
    if (!ms.length) return refuse('allocate_power', `We don't have a ${MODULES[cmd.module].name.toLowerCase()}.`);
    const life = MODULES[cmd.module].cat === 'life' && cmd.off;
    return P({ intent: 'allocate_power', title: `${cmd.off ? 'SWITCH OFF' : 'SWITCH ON'} ${MODULES[cmd.module].name.toUpperCase()}`, reply: life ? `That stops ${cmd.module === 'oxygen' ? 'oxygen production' : 'life support'}. Are you sure?` : `${ms.map((m) => m.name).join(', ')} ${cmd.off ? 'off' : 'on'}.`, big: life, confirm: life ? 'yes' : 'do', steps: ms.map((m) => `${m.name} → ${cmd.off ? 'OFF' : 'ON'}`), exec: (s) => { for (const m of ms) { const mm = s.modules.find((q) => q.id === m.id); if (mm) mm.status = cmd.off ? 'off' : 'online'; } return []; } });
  }
  if (!cat) return refuse('allocate_power', 'Which system? Research, lighting, production, charging or life support.');
  if (cat === 'life' && cmd.off) return refuse('allocate_power', 'I won\'t cut life support — colonists would suffocate. I can pause research, lighting or production instead.', [{ label: 'PAUSE RESEARCH', cmds: [{ intent: 'allocate_power', system: 'research', off: true }] }, { label: 'PAUSE LIGHTING', cmds: [{ intent: 'allocate_power', system: 'lighting', off: true }] }]);
  return P({ intent: 'allocate_power', title: `${CAT_NAME[cat]} ${cmd.off ? 'OFF' : 'ON'}`, reply: cmd.off ? `${CAT_NAME[cat]} switched off. Saves ~${(st.power.demand ? demandOf(st, cat) : 0).toFixed(1)} kW.` : `${CAT_NAME[cat]} back on.`, steps: [`${CAT_NAME[cat]}: ${cmd.off ? 'OFF' : 'AUTO'}`],
    exec: (s) => { s.power.mode[cat] = cmd.off ? 'off' : 'auto'; if (!cmd.off && s.power.hold) s.power.hold.cats = s.power.hold.cats.filter((c) => c !== cat); if (cmd.module === 'lab') for (const m of s.modules.filter((q) => q.kind === 'lab')) m.status = cmd.off ? 'off' : 'online'; return []; } });
}
const demandOf = (st: ColonyState, cat: PowerCat) => demands(st).filter((d) => d.cat === cat).reduce((s, d) => s + d.kw, 0);

function planCharge(st: ColonyState, a: Analysis, cmd: Command): Plan {
  if (cmd.system === 'charging') {
    const rs = st.robots.filter((r) => r.state !== 'broken' && r.state !== 'dead' && r.battery < 95);
    if (!rs.length) return P({ intent: 'charge', kind: 'info', title: 'ROBOTS CHARGED', reply: 'Every robot is above 95%.', confirm: 'none' });
    return P({ intent: 'charge', title: 'CHARGE ROBOTS', reply: `Sending ${rs.length} robot${rs.length > 1 ? 's' : ''} to the pads.`, steps: rs.map((r) => `${r.name} ${Math.round(r.battery)}% → pad`), exec: (s, src) => [A.chargeRobots(s, rs, src)] });
  }
  const need = a.power.cap - a.power.battery;
  return P({ intent: 'charge', title: 'CHARGE BATTERIES', reply: need < 5 ? 'Batteries are already full.' : `Pausing production and research so the batteries fill faster (${Math.round(need)} kWh to go).`, steps: ['PRODUCTION and RESEARCH pause for 3h', `Surplus now: ${(a.power.gen - a.power.used).toFixed(1)} kW`], exec: need < 5 ? undefined : (s) => { A.holdPower(s, ['production', 'research'], 'charging batteries', { untilMinute: s.minute + 180 }); return []; }, ok: need >= 5, confirm: need < 5 ? 'none' : 'do' });
}

function planRecall(st: ColonyState, a: Analysis, cmd: Command): Plan {
  const rs = st.robots.filter((r) => (!cmd.robot || r.kind === cmd.robot) && r.state !== 'broken' && r.state !== 'dead');
  return P({ intent: 'recall', title: 'RECALL', reply: `Recalling ${rs.length} robot${rs.length > 1 ? 's' : ''}. Work outside the base pauses until you say "resume".`, steps: rs.map((r) => `${r.name} → inside the base`), exec: (s) => { A.recall(s, rs); return []; }, offers: [{ label: 'RESUME LATER', cmds: [{ intent: 'resume' }] }] });
}

function planClean(st: ColonyState, a: Analysis): Plan {
  const arrays = st.modules.filter((m) => m.kind === 'solar' && m.status === 'online' && m.dust > 0.02);
  if (!arrays.length) return P({ intent: 'clean', kind: 'info', title: 'PANELS CLEAN', reply: 'All solar arrays are clean.', confirm: 'none' });
  const who = workingRobots(st).find((r) => ['maint', 'builder', 'repair'].includes(r.kind));
  if (!who) return refuse('clean', 'No robot can clean panels: a builder, repair bot or maintenance drone is needed.');
  return P({ intent: 'clean', title: 'CLEAN SOLAR ARRAYS', reply: `${who.name} will clean ${arrays.length} array${arrays.length > 1 ? 's' : ''}.`, steps: arrays.map((m) => `${m.name}: ${Math.round(m.dust * 100)}% dust → 0% (+${(m.dust * TUNE.solarPeak).toFixed(1)} kW at noon)`), exec: (s, src, text) => [A.cleanTask(s, arrays, src, text)] });
}

// ------------------------------------------------------------------ PRODUCE / ROBOTS / RESEARCH

function planProduce(st: ColonyState, a: Analysis, cmd: Command): Plan {
  const res = cmd.resource as ResId;
  const rec = RECIPES[res];
  if (!rec) return planMine(st, a, { intent: 'mine', resource: res, qty: cmd.qty });
  if (!hasModule(st, 'workshop')) return refuse('produce', 'We need a workshop to make that.', [{ label: 'BUILD A WORKSHOP', cmds: [{ intent: 'build', module: 'workshop' }], primary: true }]);
  const qty = Math.max(rec.outQty, cmd.qty ?? 10);
  const batches = Math.ceil(qty / rec.outQty);
  const inputs: Inv = Object.fromEntries(Object.entries(rec.inputs).map(([r, q]) => [r, (q ?? 0) * batches]));
  const pre = prereqs(st, inputs);
  if (pre.blocked) return refuse('produce', pre.blocked, pre.offers);
  return P({ intent: 'produce', title: `PRODUCTION · ${RES[res].name.toUpperCase()} ×${batches * rec.outQty}`, reply: `Queued at the workshop${pre.lines.length ? ' after the inputs are ready' : ''}.`, steps: [...pre.lines, `Workshop turns ${costText(inputs)} into ${batches * rec.outQty} ${resN(res)}`, `${secs(batches * rec.minutes * 0.5)} at full power`], details: [{ label: 'Inputs', value: costText(inputs) }],
    exec: (s, src, text) => { const out: Task[] = []; const ids: number[] = []; for (const m of pre.mine) { const d = s.deposits.find((q) => q.id === m.depositId); if (d) { const mn = workingRobots(s, 'miner').slice(0, 1); A.preempt(s, mn); const t = A.mineTask(s, d, m.qty, mn, src, text); out.push(t); ids.push(t.id); } } for (const p of pre.produce) { const t = A.produceTask(s, p.res, p.qty, src, text, ids); out.push(t); ids.push(t.id); } out.push(A.produceTask(s, res, batches * rec.outQty, src, text, ids)); return out; } });
}

function planRobot(st: ColonyState, a: Analysis, cmd: Command): Plan {
  const kind = cmd.robot as RobotKind;
  const def = ROBOTS[kind];
  const chk = robotCheck(st, kind);
  if (!chk.ok) return refuse('build_robot', chk.reason!, chk.offers ?? []);
  const count = Math.max(1, Math.min(4, cmd.count ?? 1));
  const pre = prereqs(st, def.cost, count);
  if (pre.blocked) return refuse('build_robot', pre.blocked, pre.offers);
  const cost: Inv = Object.fromEntries(Object.entries(def.cost).map(([r, q]) => [r, (q ?? 0) * count]));
  return P({ intent: 'build_robot', kind: 'build', title: `FABRICATE · ${def.name.toUpperCase()}${count > 1 ? ` ×${count}` : ''}`, reply: pre.lines.length ? `I can build ${count > 1 ? 'them' : 'it'} after: ${pre.lines.join('; ')}. Go ahead?` : `${def.desc} Ready to fabricate.`,
    steps: [...pre.lines, `Haul ${costText(cost)} to the robot bay`, `Fabricate (${Math.round(def.fabMin * 0.5)} s each)`, `${def.prefix}-${String(st.robots.filter((r) => r.kind === kind).length + 1).padStart(2, '0')} rolls out`], details: [{ label: 'Cost', value: costText(cost), tone: pre.lines.length ? 'warn' : 'ok' }],
    confirm: pre.lines.length ? 'yes' : 'build', big: true,
    learn: kind === 'miner' ? [{ dim: 'mining', delta: 5, text: 'built another miner' }] : undefined,
    exec: (s, src, text) => { const out: Task[] = []; const ids: number[] = []; for (const m of pre.mine) { const d = s.deposits.find((q) => q.id === m.depositId); if (d) { const mn = workingRobots(s, 'miner').slice(0, 1); A.preempt(s, mn); const t = A.mineTask(s, d, m.qty, mn, src, text); out.push(t); ids.push(t.id); } } for (const p of pre.produce) { const t = A.produceTask(s, p.res, p.qty, src, text, ids); out.push(t); ids.push(t.id); } for (let i = 0; i < count; i++) { const t = A.fabricateTask(s, kind, src, text, ids); if (t) out.push(t); } return out; } });
}

export function suggestResearch(st: ColonyState, q: string): TechId[] {
  const words = q.toLowerCase();
  const scored = TECHS.filter((t) => canResearch(st, t.id).ok).map((t) => {
    let s = 0;
    for (const k of t.keywords) if (words.includes(k)) s += 3;
    if (/next|should/.test(words)) s += (t.tier === 1 ? 2 : 0) + prefBoost(st, t.id);
    return { id: t.id, s };
  }).sort((x, y) => y.s - x.s);
  return scored.filter((x) => x.s > 0).slice(0, 3).map((x) => x.id).concat(scored.length && scored[0].s === 0 ? scored.slice(0, 3).map((x) => x.id) : []).slice(0, 3);
}
function prefBoost(st: ColonyState, id: TechId) {
  const a = analyze(st);
  if (id === 'solar_eff' && a.power.forecastBalance < 0) return 3;
  if (id === 'drills' && a.stock.titanium < 30) return 2;
  if (id === 'electrolysis' && a.o2.gens <= 1) return 2;
  if (id === 'predictive' && st.robots.some((r) => r.condition < 60)) return 2;
  if (id === 'prefab' && st.core.prefs.safety < 45) return 1;
  return 0;
}

function planResearch(st: ColonyState, a: Analysis, cmd: Command): Plan {
  if (!labs(st).length) return refuse('research', 'Research needs a Space Lab.', [{ label: 'BUILD A SPACE LAB', cmds: [{ intent: 'build', module: 'lab' }], primary: true }]);
  if (!cmd.tech) {
    const ids = suggestResearch(st, cmd.question ?? 'next');
    return P({ intent: 'research', kind: 'info', title: 'RESEARCH SUGGESTIONS', reply: 'Based on what the colony needs right now:', steps: ids.map((id) => `${TECH[id].name}: ${TECH[id].effect} · ${costText(TECH[id].cost)} · ${TECH[id].rp} RP`), confirm: 'none', offers: ids.map((id, i) => ({ label: `RESEARCH ${TECH[id].name.toUpperCase()}`, cmds: [{ intent: 'research', tech: id }], primary: i === 0 })) });
  }
  const t = TECH[cmd.tech];
  const can = canResearch(st, cmd.tech);
  if (!can.ok) {
    const pre = can.why?.startsWith('Needs ') && can.why.includes('first') ? TECHS.find((x) => can.why!.includes(x.name)) : undefined;
    return refuse('research', `${t.name}: ${can.why}.`, pre ? [{ label: `RESEARCH ${pre.name.toUpperCase()}`, cmds: [{ intent: 'research', tech: pre.id }], primary: true }] : []);
  }
  const pre = prereqs(st, t.cost);
  if (pre.blocked) return refuse('research', pre.blocked, pre.offers);
  const busy = st.research.current;
  const rpm = Math.max(1, st.colonists.filter((c) => !c.dead && c.role === 'scientist').length);
  return P({ intent: 'research', title: `EXPERIMENT · ${t.name.toUpperCase()}`, reply: busy ? `The lab is busy with ${TECH[busy].name}. I'll queue this next.` : pre.lines.length ? `Materials first: ${pre.lines.join('; ')}.` : 'Materials go to the lab, then research begins.',
    steps: [...pre.lines, `Haul ${costText(scaledCost(st, t.cost))} to the lab`, `Research ${t.rp} RP (~${secs((t.rp / rpm) * 0.5)})`, `Result: ${t.effect}`], details: [{ label: 'Requirements', value: costText(scaledCost(st, t.cost)) }, { label: 'Research time', value: `${t.rp} RP` }, { label: 'Result', value: t.effect, tone: 'ok' }],
    learn: [{ dim: 'research', delta: 4, text: `started research on ${t.name}` }],
    exec: (s, src, text) => { if (s.research.current) { if (!s.research.queue.includes(t.id)) s.research.queue.push(t.id); return []; } const out: Task[] = []; const ids: number[] = []; for (const p of pre.produce) { const tk = A.produceTask(s, p.res, p.qty, src, text); out.push(tk); ids.push(tk.id); } const rt = A.researchTask(s, t.id, src, text); if (rt) { rt.after = ids; out.push(rt); } return out; } });
}

// ------------------------------------------------------------------ MOVE / TRANSPORT

function planMove(st: ColonyState, a: Analysis, cmd: Command): Plan {
  if (!cmd.module) return refuse('move', 'Which module should I move?');
  const kind = cmd.module;
  const def = MODULES[kind];
  if (!def.buildable) return refuse('move', `${def.name} is anchored to the bedrock — it can't be moved.`);
  const ms = st.modules.filter((m) => m.kind === kind && m.status === 'online');
  if (!ms.length) return refuse('move', `We don't have a ${def.name.toLowerCase()} to move.`);
  const builders = workingRobots(st, 'builder');
  if (!builders.length) return refuse('move', 'Moving a module needs a builder bot.');
  const anchor = anchorFor(st, { intent: 'build', direction: cmd.direction, near: cmd.near }, kind);
  const target = ms.sort((x, y) => Math.hypot(centerOf(y)[0] - anchor.at[0], centerOf(y)[1] - anchor.at[1]) - Math.hypot(centerOf(x)[0] - anchor.at[0], centerOf(x)[1] - anchor.at[1]))[0];
  const opts = findSites(st, kind, anchor.at, 6, 16).filter((o) => rectGap({ x: o.x, y: o.y, w: def.w, h: def.h }, target) >= 1);
  if (!opts.length) return refuse('move', `No valid site ${anchor.why ?? 'there'}.`);
  const cost = scaledCost(st, def.cost);
  const loss: Inv = Object.fromEntries(Object.entries(cost).map(([r, q]) => [r, q - Math.floor(q * 0.75)]));
  const pre = prereqs(st, loss);
  if (pre.blocked) return refuse('move', `Moving loses 25% of the materials. ${pre.blocked}`, pre.offers);
  const genLoss = def.gen ? `Output drops by ${kind === 'solar' ? TUNE.solarPeak : def.gen} kW while it's moved` : def.cat === 'life' ? 'Its life-support output pauses while it is moved' : '';
  return P({ intent: 'move', kind: 'build', title: `MOVE PLAN · ${target.name}`, reply: `I'll take ${target.name} apart, carry the parts and rebuild it ${anchor.why ?? 'there'} (${opts[0].zone}).`,
    steps: [`${builders[0].name} deconstructs ${target.name} (75% of materials recovered)`, 'Haulers return parts to storage', `Rebuild at ${opts[0].zone} (net cost ${costText(loss)})`, 'Connect to the grid and activate'], why: genLoss ? [genLoss] : [], details: [{ label: 'From', value: zoneName(target.x, target.y) }, { label: 'To', value: opts[0].zone }, { label: 'Net cost', value: costText(loss) }],
    sites: { kind, options: opts, idx: 0, count: 1 }, confirm: 'build', big: true,
    exec: (s, src, text) => {
      const m = s.modules.find((q) => q.id === target.id)!;
      const t1 = A.deconstructTask(s, m, src, text, `Move ${m.name}: deconstruct`);
      const i = this_sites.idx ?? 0;
      const o = opts[i] ?? opts[0];
      const { task } = placeConstruction(s, kind, o.x, o.y, { source: src, command: text, after: [t1.id], title: `Move ${m.name}: rebuild` });
      return [t1, task];
    } });
}

function planTransport(st: ColonyState, a: Analysis, cmd: Command): Plan {
  const ss = stores(st).filter((m) => m.kind !== 'outpost' || true);
  if (ss.length < 2) return refuse('transport', 'There\'s only one storage location, so there\'s nowhere closer to move things. Build a storage module there?', [{ label: `BUILD STORAGE${cmd.near && cmd.near in MODULES ? ` NEAR ${MODULES[cmd.near as ModuleKind].short}` : ''}`, cmds: [{ intent: 'build', module: 'storage', near: cmd.near }], primary: true }]);
  const anchorMod = cmd.near && cmd.near in MODULES ? st.modules.find((m) => m.kind === cmd.near && m.status === 'online') : null;
  const at: [number, number] = anchorMod ? centerOf(anchorMod) : [BASE_CX, BASE_CY];
  const sorted = ss.slice().sort((x, y) => Math.hypot(centerOf(x)[0] - at[0], centerOf(x)[1] - at[1]) - Math.hypot(centerOf(y)[0] - at[0], centerOf(y)[1] - at[1]));
  const dest = sorted[0];
  const resList: ResId[] = cmd.resource && cmd.resource !== 'lowest' && cmd.resource !== 'all' ? [cmd.resource] : ['iron', 'titanium', 'regolith', 'ice', 'rare'];
  const moves: { res: ResId; qty: number; from: Module; to: Module }[] = [];
  let room = roomOf(dest);
  for (const src of sorted.slice(1)) for (const r of resList) { const q = Math.min(src.store[r] ?? 0, room); if (q > 0) { moves.push({ res: r, qty: q, from: src, to: dest }); room -= q; } }
  if (!moves.length) return P({ intent: 'transport', kind: 'info', title: 'NOTHING TO MOVE', reply: room <= 0 ? `${dest.name} is full.` : `Those materials are already in ${dest.name}, the storage nearest ${anchorMod?.name ?? 'the base'}.`, confirm: 'none' });
  return P({ intent: 'transport', title: `LOGISTICS · STOCK → ${dest.name}`, reply: `Haulers will move ${moves.reduce((s, m) => s + m.qty, 0)} units to ${dest.name}${anchorMod ? `, next to ${anchorMod.name}` : ''}.`, steps: moves.map((m) => `${m.qty} ${resN(m.res)}: ${m.from.name} → ${m.to.name}`), exec: (s, src, text) => [A.transportTask(s, moves, src, text)], learn: [{ dim: 'storage', delta: 2, text: 'organized storage' }] });
}

// ------------------------------------------------------------------ OPTIMIZE / SAFETY

function planOptimize(st: ColonyState, a: Analysis, cmd: Command): Plan {
  const steps: string[] = [], why: string[] = [];
  const execs: ((s: ColonyState, src: TaskSource, text: string) => Task[])[] = [];
  const dusty = st.modules.filter((m) => m.kind === 'solar' && m.status === 'online' && m.dust > 0.05);
  if (dusty.length) { steps.push(`Clean ${dusty.length} array${dusty.length > 1 ? 's' : ''}: +${(dusty.reduce((s, m) => s + m.dust, 0) * TUNE.solarPeak).toFixed(1)} kW at noon`); execs.push((s, src, text) => [A.cleanTask(s, dusty, src, text)]); }
  const lights = 0.1 * st.modules.length * 11;
  if (!st.power.nightOff.includes('lighting')) { steps.push(`Dim base lighting at night: saves ~${Math.round(lights)} kWh per night`); execs.push((s) => { if (!s.power.nightOff.includes('lighting')) s.power.nightOff.push('lighting'); return []; }); }
  if (!st.power.nightOff.includes('production') && hasModule(st, 'workshop')) { steps.push('Run the workshop in daylight only: production waits for the sun instead of the battery'); execs.push((s) => { if (!s.power.nightOff.includes('production')) s.power.nightOff.push('production'); return []; }); }
  why.push(`Night load ~${Math.round(a.power.nightUse)} kWh vs battery ${a.power.cap} kWh`);
  if (!steps.length) return P({ intent: 'optimize', kind: 'info', title: 'ALREADY OPTIMIZED', reply: 'Panels are clean and non-essential loads already avoid the night.', why, confirm: 'none', offers: [{ label: 'UNDO NIGHT LIMITS', cmds: [{ intent: 'allocate_power', system: 'lighting', off: false }] }] });
  return P({ intent: 'optimize', title: 'POWER OPTIMIZATION', reply: 'Cheapest savings first. These change schedules, not hardware.', steps, why, exec: (s, src, text) => execs.flatMap((e) => e(s, src, text)) });
}

function planSafety(st: ColonyState, a: Analysis, cmd: Command): Plan {
  const steps: string[] = [], why: string[] = [];
  const subs: Plan[] = [];
  const offers: Offer[] = [];
  const focus = cmd.system;
  if ((!focus || focus === 'oxygen') && a.o2.gens <= 1) { const p = planBuild(st, a, { intent: 'build', module: 'oxygen' }); if (p.ok) { subs.push(p); steps.push(`Build oxygen backup — ${p.details.find((d) => d.label === 'Location')?.value ?? ''}${p.confirm === 'yes' ? ` (after: ${p.steps.filter((x) => /^Produce|mines/.test(x)).join('; ')})` : ''}`); } else offers.push(...p.offers); }
  if ((!focus || focus === 'power') && st.modules.filter((m) => m.kind === 'battery' && m.status === 'online').length <= 1) { const p = planBuild(st, a, { intent: 'build', module: 'battery' }); if (p.ok) { subs.push(p); steps.push('Add battery storage (+120 kWh)'); } else offers.push(...p.offers); }
  if (!focus || focus === 'oxygen') { const cmdM = st.modules.find((m) => m.kind === 'command')!; const ice = Math.min(10, available(st, 'ice')); if (ice > 0 && (cmdM.store.ice ?? 0) < 10 && roomOf(cmdM) >= ice) { steps.push(`Move emergency supplies: ${ice} ice into the command module`); subs.push(P({ intent: 'transport', title: '', reply: '', exec: (s, src, text) => { const from = stores(s).find((m) => m.id !== cmdM.id && (m.store.ice ?? 0) >= ice); return from ? [A.transportTask(s, [{ res: 'ice', qty: ice, from, to: s.modules.find((m) => m.id === cmdM.id)! }], src, text)] : []; } })); } }
  if (!focus || focus === 'power') { steps.push('Keep a 20% power reserve for life support (standing rule)'); subs.push(P({ intent: 'safety', title: '', reply: '', exec: (s) => { s.power.reserve = 0.2; if (!s.rules.some((r) => r.kind === 'reserve')) s.rules.push({ id: s.nextId++, kind: 'reserve', text: 'Keep 20% battery reserved for life support', enabled: true, source: 'PLAYER' }); return []; } })); }
  const spof = [a.o2.gens <= 1 ? 'oxygen' : '', st.modules.filter((m) => m.kind === 'battery' && m.status === 'online').length <= 1 ? 'power' : ''].filter(Boolean);
  if (spof.length) why.push(`${spof.join(' and ')} ${spof.length > 1 ? 'are' : 'is a'} current single point${spof.length > 1 ? 's' : ''} of failure`);
  if (a.risks[0]) why.push(a.risks[0].text);
  if (!steps.length) return P({ intent: 'safety', kind: 'info', title: 'ALREADY SAFE', reply: 'Backups are in place: multiple generators, batteries and a power reserve.', confirm: 'none' });
  const buildCount = subs.filter((p) => p.kind === 'build').length;
  return P({ intent: 'safety', kind: 'build', title: 'SAFETY PLAN', reply: `REQUEST: ${focus ? `make ${focus} safer` : 'increase colony safety'}.`, steps, why, offers, confirm: buildCount ? 'build' : 'do', big: buildCount > 0,
    learn: [{ dim: 'safety', delta: 8, text: 'asked for backups and reserves' }],
    exec: (s, src, text) => subs.flatMap((p) => p.exec ? p.exec(s, src, text) : []) });
}

// ------------------------------------------------------------------ SCHEDULE / INSPECT

function planSchedule(st: ColonyState, a: Analysis, cmd: Command): Plan {
  if (!cmd.then || !cmd.schedule) return refuse('schedule', 'What should happen on a schedule? e.g. "Clean the solar panels every morning".');
  const inner = cmd.then;
  const text = describeCommand(inner);
  return P({ intent: 'schedule', title: 'STANDING ORDER', reply: `Saved: every sol at ${clock(cmd.schedule.minute)} — ${text}.`, steps: [`${clock(cmd.schedule.minute)} daily → ${text}`, 'Edit or remove it in CORE › TASKS'], learn: inner.intent === 'clean' ? [{ dim: 'safety', delta: 2, text: 'scheduled maintenance' }] : undefined,
    exec: (s) => { const r: Rule = { id: s.nextId++, kind: 'schedule', text: `${clock(cmd.schedule!.minute)} daily: ${text}`, enabled: true, minute: cmd.schedule!.minute, command: JSON.stringify(inner), source: 'PLAYER' }; s.rules.push(r); return []; } });
}
export function describeCommand(c: Command): string {
  switch (c.intent) {
    case 'clean': return 'clean the solar panels';
    case 'mine': return `mine ${c.resource === 'lowest' ? 'the lowest resource' : c.resource ?? 'resources'}`;
    case 'charge': return 'charge the batteries';
    case 'repair': return 'repair damaged modules';
    case 'recall': return 'recall robots';
    case 'resume': return 'resume operations';
    case 'explore': return `scout ${c.direction ?? ''}`.trim();
    case 'produce': return `produce ${c.qty ?? 10} ${c.resource}`;
    case 'build': return `build ${c.module}`;
    default: return c.intent.replace('_', ' ');
  }
}

function planInspect(st: ColonyState, a: Analysis, cmd: Command): Plan {
  const rec = recommend(st, a);
  const lines = [
    `OXYGEN ${Math.round(a.o2.pct * 100)}% · ${a.o2.net >= 0 ? '+' : ''}${a.o2.net.toFixed(1)} O₂/h · reserve ${a.o2.reserveText}`,
    `POWER ${a.power.gen.toFixed(1)} kW in / ${a.power.used.toFixed(1)} kW used · battery ${Math.round(a.power.battery)}/${a.power.cap} kWh · next sol ${a.power.forecastBalance >= 0 ? '+' : ''}${Math.round(a.power.forecastBalance)} kWh`,
    `WATER ${Math.round(a.water.amount)}/${a.water.cap} · ICE ${a.stock.ice} · storage ${Math.round(a.fill * 100)}% full`,
    `ROBOTS ${st.robots.length} (${Object.values(a.robots).reduce((s, r) => s + r.busy, 0)} busy) · colonists ${a.pop}/${a.beds} beds`,
  ];
  if (cmd.system === 'power') lines.splice(0, 1);
  return P({ intent: 'inspect', kind: 'info', title: 'COLONY STATUS · SOL ' + sol(st), reply: `Next: ${rec.text}.`, steps: lines, why: a.risks.slice(0, 3).map((r) => r.text), confirm: 'none', offers: rec.cmd ? [{ label: rec.label, cmds: [rec.cmd], primary: true }] : [] });
}

export { remember, MODULES };
