// Colony growth: stages, supply shuttle and arrivals, end-of-sol reports, colony scores.

import { COLONIST_NAMES, MODULES, RES, RES_IDS, ROLE_INFO, Role, STAGES, STAGE_INFO, Stage, TECHS } from './defs';
import { addHistory, emit, first, mods, rand, raise, resolve, sol } from './core';
import { o2Balance, alive, beds } from './life';
import { batteryCap, o2Cap } from './power';
import { exploredPct } from './world';
import type { ColonyState, Colonist, Report, SolStats } from './state';
import { addHaul, createTask } from './tasks';

export const onlineModules = (st: ColonyState) => st.modules.filter((m) => (m.status === 'online' || m.status === 'off') && m.kind !== 'pad');

export function stageProgress(st: ColonyState, stage: Stage) {
  const need = STAGE_INFO[stage].need;
  const have = { modules: onlineModules(st).length, robots: st.robots.length, pop: alive(st).length, research: st.research.done.length, outposts: st.modules.filter((m) => m.kind === 'outpost' && m.status === 'online').length };
  const rows: { label: string; have: number; need: number }[] = [];
  rows.push({ label: 'Modules', have: have.modules, need: need.modules });
  if (need.robots) rows.push({ label: 'Robots', have: have.robots, need: need.robots });
  if (need.pop) rows.push({ label: 'Colonists', have: have.pop, need: need.pop });
  if (need.research) rows.push({ label: 'Research', have: have.research, need: need.research });
  if (need.outposts) rows.push({ label: 'Outposts', have: have.outposts, need: need.outposts });
  return rows;
}
export const nextStage = (st: ColonyState): Stage | null => STAGES[STAGES.indexOf(st.stage) + 1] ?? null;

export function stageCheck(st: ColonyState) {
  const n = nextStage(st);
  if (!n) return;
  if (!stageProgress(st, n).every((r) => r.have >= r.need)) return;
  st.stage = n;
  addHistory(st, `Stage reached: ${STAGE_INFO[n].name}`, 'stage');
  st.core.xp += 40;
  emit(st, 'stage', undefined, undefined, { stage: n, name: STAGE_INFO[n].name, unlocks: STAGE_INFO[n].unlocks });
  if (n === 'base') st.weather.nextMeteor = st.minute + 1440 + 300;
  if (n === 'colony') st.weather.nextSolarStorm = st.minute + 2 * 1440 + 600;
}

// ------------------------------------------------------------------ shuttle

const CRATES = [{ polymer: 10 }, { electronics: 8 }, { iron: 20, titanium: 10 }, { silica: 12, polymer: 6 }];
export function shuttleTick(st: ColonyState) {
  const S = st.shuttle;
  const pad = st.modules.find((m) => m.kind === 'pad');
  if (!pad) return;
  if (S.state === 'away' && st.minute >= S.next - 30) {
    const free = beds(st) - alive(st).length;
    const ok = o2Balance(st).net > 0 && st.rations > 10;
    S.colonists = ok ? Math.max(0, Math.min(free, STAGES.indexOf(st.stage) >= 2 ? 3 : 2)) : 0;
    S.cargo = { ...CRATES[Math.floor(rand(st) * CRATES.length)] };
    S.rations = 24;
    S.state = 'landing'; S.t = 0;
    raise(st, 'shuttle', 'shuttle', 'SUPPLY SHUTTLE INBOUND', `Lands in 30 min · ${S.colonists ? `${S.colonists} colonist${S.colonists > 1 ? 's' : ''}` : free <= 0 ? 'no free beds' : 'no new colonists'} · 24 rations · supply crate`, 'info');
    emit(st, 'shuttleInbound');
  } else if (S.state === 'landing') {
    S.t += 1 / 30;
    if (S.t >= 1) {
      S.state = 'landed'; S.t = 0;
      st.rations += S.rations;
      for (const [r, q] of Object.entries(S.cargo)) pad.delivered[r as keyof typeof pad.delivered] = (pad.delivered[r as keyof typeof pad.delivered] ?? 0) + (q ?? 0);
      if (Object.keys(S.cargo).length) {
        const task = createTask(st, { title: 'Unload supply crate', kind: 'unload', source: 'ROUTINE' });
        task.status = 'running';
        for (const [r, q] of Object.entries(S.cargo)) if (q) addHaul(st, task, r as keyof typeof RES, q, -1, 'storage', 'UNLOADING SHUTTLE', [], pad.id);
      }
      const names: string[] = [];
      for (let i = 0; i < S.colonists; i++) {
        const c = newColonist(st, pickRole(st));
        c.x = (pad.x + 1 + i) * 16 + 8; c.y = (pad.y + 2) * 16 + 12;
        st.colonists.push(c);
        names.push(`${c.name} (${ROLE_INFO[c.role].name.toLowerCase()})`);
      }
      resolve(st, 'shuttle');
      addHistory(st, `Supply shuttle landed${names.length ? ` · arrived: ${names.join(', ')}` : ''}`, 'arrival');
      emit(st, 'shuttleLanded', (pad.x + 2) * 16, (pad.y + 2) * 16, { colonists: S.colonists });
      const pop = alive(st).length;
      for (const p of [8, 14, 24]) if (pop >= p) first(st, `pop-${p}`, `Population reached ${p}`, 'arrival');
    }
  } else if (S.state === 'landed') {
    S.t += 1 / 90;
    if (S.t >= 1) { S.state = 'leaving'; S.t = 0; emit(st, 'shuttleLeave'); }
  } else if (S.state === 'leaving') {
    S.t += 1 / 30;
    if (S.t >= 1) {
      S.state = 'away'; S.t = 0;
      const every = st.modules.some((m) => m.kind === 'comm' && m.status === 'online') ? 2 : 3;
      S.next = (sol(st) - 1 + every) * 1440 + 600;
    }
  }
}

function pickRole(st: ColonyState): Role {
  const live = alive(st);
  const need: Role[] = ['scientist', 'engineer', 'technician', 'medic', 'miner'];
  for (const r of need) if (!live.some((c) => c.role === r)) return r;
  return need[Math.floor(rand(st) * need.length)];
}
export function newColonist(st: ColonyState, role: Role): Colonist {
  const used = new Set(st.colonists.map((c) => c.name));
  const name = COLONIST_NAMES.find((n) => !used.has(n)) ?? `CREW-${st.colonists.length + 1}`;
  return { id: st.nextId++, name, role, health: 100, x: 0, y: 0, path: [] as [number, number][], inside: null, insideT: 0, target: null, arrivedSol: sol(st) };
}

// ------------------------------------------------------------------ sol end

export function emptySol(): SolStats {
  return { mined: {}, produced: {}, built: 0, repairs: 0, tasks: 0, emergencies: 0, powerMinutes: 0, powerOkMinutes: 0, o2Minutes: 0, o2OkMinutes: 0, robotBusy: 0, robotTotal: 0, peak: 0, genKwh: 0, useKwh: 0, shortageMinutes: 0, overloadMinutes: 0 };
}
export function solEnd(st: ColonyState): Report {
  const S = st.sol;
  const n = sol(st) - 1;
  const lines: string[] = [];
  for (const r of RES_IDS) { const v = (S.mined[r] ?? 0) + (S.produced[r] ?? 0); if (v) lines.push(`+${v} ${RES[r].name}`); }
  if (S.built) lines.push(`+${S.built} Module${S.built > 1 ? 's' : ''} Built`);
  if (S.repairs) lines.push(`+${S.repairs} Repair${S.repairs > 1 ? 's' : ''}`);
  if (S.tasks) lines.push(`${S.tasks} tasks done`);
  const up = S.powerMinutes ? (S.powerOkMinutes / S.powerMinutes) * 100 : 100;
  const o2 = S.o2Minutes ? (S.o2OkMinutes / S.o2Minutes) * 100 : 100;
  lines.push(`Power on: ${Math.round(up)}%`);
  lines.push(`Oxygen OK: ${Math.round(o2)}%`);
  lines.push(`Energy: +${Math.round(S.genKwh)} / −${Math.round(S.useKwh)} kWh`);
  if (S.emergencies) lines.push(`${S.emergencies} alert${S.emergencies > 1 ? 's' : ''} handled`);
  const score = colonyScores(st).overall;
  const rep: Report = { sol: n, lines, uptimePower: up, uptimeO2: o2, learned: [...st.core.learnedPending], score };
  st.core.learnedPending = [];
  st.lastReport = rep;
  st.reports.unshift(rep);
  st.reports = st.reports.slice(0, 12);
  st.scoreHist.push(score);
  if (st.scoreHist.length > 30) st.scoreHist.shift();
  st.prevSol = { ...S };
  st.sol = emptySol();
  emit(st, 'solEnd', undefined, undefined, { sol: n });
  return rep;
}

// ------------------------------------------------------------------ scores (all derived from state)

export function colonyScores(st: ColonyState) {
  const S = st.sol, P = st.prevSol ?? S;
  const pop = alive(st);
  const mins = S.o2Minutes + (P === S ? 0 : P.o2Minutes);
  const okO2 = S.o2OkMinutes + (P === S ? 0 : P.o2OkMinutes);
  const missingHealth = pop.length ? pop.reduce((a, c) => a + (100 - c.health), 0) / pop.length : 100;
  const survival = clamp(100 - 15 * st.deaths - (mins ? (1 - okO2 / mins) * 60 : 0) - missingHealth * 0.4);
  const busy = S.robotBusy + (P === S ? 0 : P.robotBusy), tot = S.robotTotal + (P === S ? 0 : P.robotTotal);
  const efficiency = clamp(tot ? (busy / tot) * 130 : 50);
  const pm = S.powerMinutes + (P === S ? 0 : P.powerMinutes), pok = S.powerOkMinutes + (P === S ? 0 : P.powerOkMinutes);
  const night = 0.1 * st.modules.length + 8;
  const energy = clamp((pm ? pok / pm : 1) * 60 + Math.min(1, (st.power.battery / Math.max(1, night)) / 8) * 40 * (batteryCap(st) ? 1 : 0));
  const bal = o2Balance(st);
  const oxygen = clamp((st.o2 / Math.max(1, o2Cap(st))) * 50 + Math.max(0, Math.min(1, bal.net / Math.max(1, bal.use) + 0.5)) * 50);
  const research = clamp((st.research.done.length / TECHS.length) * 90 + (st.research.current ? 10 : 0));
  const automation = clamp((Math.min(12, st.robots.length) / 12) * 55 + ['manual', 'assisted', 'automated', 'autonomous'].indexOf(st.core.autonomy) * 10 + Math.min(3, st.rules.filter((r) => r.enabled).length) * 5);
  const expansion = clamp((Math.min(45, onlineModules(st).length) / 45) * 50 + exploredPct(st) * 100 * 0.3 + (Math.min(24, pop.length) / 24) * 30);
  const parts = { survival, efficiency, energy, oxygen, research, automation, expansion };
  const overall = Math.round((survival * 2 + oxygen * 1.5 + energy * 1.5 + efficiency + research + automation + expansion) / 9);
  return { ...parts, overall };
}
const clamp = (v: number) => Math.round(Math.max(0, Math.min(100, v)));

export { MODULES, mods };
