// CORE's own initiative, gated by autonomy level and permissions. Runs once per game minute.
//  ASSISTED   → standing orders (rules) only
//  AUTOMATED  → + routine maintenance: cleaning, repairs, production stock, broader mining
//  AUTONOMOUS → + emergency response and expansion within permissions

import { DEPOSIT, RES, ResId, TUNE } from '../sim/defs';
import { activeAlerts, clock, emit, hour, remember, sol } from '../sim/core';
import { genOf } from '../sim/power';
import { robotAvailable } from '../sim/logistics';
import { available, fill, total, totalCap } from '../sim/storage';
import type { ColonyState, Rule, Task } from '../sim/state';
import { addHaul, addJob, createTask, liveTasks, taskById } from '../sim/tasks';
import { BASE_CX, BASE_CY } from '../sim/world';
import { analyze } from './analysis';
import type { Command } from './command';
import * as A from './actions';
import { plan } from './planner';
import { hasModule } from './validator';
import { recommend } from './advice';
import { solLearned } from './learning';

export const LEVEL = { manual: 0, assisted: 1, automated: 2, autonomous: 3 } as const;
const lvl = (st: ColonyState) => LEVEL[st.core.autonomy];

const liveFor = (st: ColonyState, pred: (t: Task) => boolean) => liveTasks(st).some(pred);

export function coreMinute(st: ColonyState) {
  const L = lvl(st);
  const minOfDay = st.minute % 1440;
  // research queue
  if (!st.research.current && st.research.queue.length && st.modules.some((m) => m.kind === 'lab' && m.status === 'online')) {
    const next = st.research.queue.shift()!;
    const p = plan(st, { intent: 'research', tech: next });
    if (p.ok && p.exec) p.exec(st, 'CORE', `Research ${next}`);
  }
  // shortage tracking for AI scores
  if (st.jobs.some((j) => j.status === 'open' && j.note?.startsWith('WAITING FOR'))) st.sol.shortageMinutes++;
  // solar forecast for the ENERGY score
  if (minOfDay === 6 * 60) { let kwh = 0; for (let k = 0; k < 1080; k += 10) kwh += (st.modules.reduce((a, m) => a + genOf(st, m, st.minute + k), 0) * 10) / 60; st.core.forecastToday = kwh; }
  if (minOfDay === 0) {
    const f = st.core.forecastToday;
    if (f && st.sol.genKwh > 1) { const err = Math.abs(st.sol.genKwh - f) / Math.max(1, f); st.core.forecastErr.push(err); if (st.core.forecastErr.length > 10) st.core.forecastErr.shift(); }
    solLearned(st);
  }

  if (L >= 1) runRules(st);
  if (L >= 2 && st.minute % 3 === 0) routines(st);
  if (L >= 3 && st.minute % 2 === 0) autonomous(st);
  if (st.minute % 20 === 0) suggest(st);
}

// ------------------------------------------------------------------ standing orders

function runRules(st: ColonyState) {
  const minOfDay = st.minute % 1440;
  for (const r of st.rules) {
    if (!r.enabled) continue;
    switch (r.kind) {
      case 'hopper': if (st.minute % 4 === 0) { hopperRule(st); if (st.minute % 20 === 0) padRule(st); } break;
      case 'stock': if (st.minute % 3 === 0) stockRule(st); break;
      case 'reserve': st.power.reserve = 0.2; break;
      case 'clean': if (r.lastSol !== sol(st) && minOfDay >= (r.minute ?? 420) && minOfDay < (r.minute ?? 420) + 240) {
        r.lastSol = sol(st);
        const dusty = st.modules.filter((m) => m.kind === 'solar' && m.status === 'online' && m.dust > 0.04);
        if (dusty.length && !liveFor(st, (t) => t.kind === 'clean')) { A.cleanTask(st, dusty, 'STANDING', r.text); remember(st, `Standing order: ${r.text}`, 'STANDING', true, 'auto'); }
      } break;
      case 'schedule': if (r.lastSol !== sol(st) && minOfDay >= (r.minute ?? 0) && minOfDay < (r.minute ?? 0) + 120) {
        r.lastSol = sol(st);
        try {
          const cmd = JSON.parse(r.command ?? '{}') as Command;
          const p = plan(st, cmd);
          if (p.ok && p.exec) { p.exec(st, 'STANDING', r.text); remember(st, r.text, 'STANDING', true, 'auto'); }
          else remember(st, `${r.text} — skipped: ${p.reply}`, 'STANDING', false, 'auto');
        } catch { r.enabled = false; }
      } break;
      case 'hold': if (st.minute >= (r.minute ?? 0)) {
        A.resume(st);
        const dusty = st.modules.filter((m) => m.kind === 'solar' && m.status === 'online' && m.dust > 0.05);
        if (dusty.length) A.cleanTask(st, dusty, 'STANDING', 'Post-storm panel cleaning');
        remember(st, r.text, 'STANDING', true, 'auto');
        emit(st, 'resume');
        r.enabled = false;
      } break;
    }
  }
  st.rules = st.rules.filter((r) => r.enabled || r.kind !== 'hold');
}

function hopperRule(st: ColonyState) {
  for (const g of st.modules.filter((m) => m.kind === 'oxygen' && m.status === 'online')) {
    if (g.hopper >= TUNE.hopperLow) continue;
    if (liveFor(st, (t) => t.kind === 'refill' && st.jobs.some((j) => t.jobs.includes(j.id) && j.to === g.id))) continue;
    const ice = available(st, 'ice');
    if (ice <= 0) {
      // no ice in storage: mine it straight into the hopper (works even when storage is full)
      const miners = st.robots.filter((r) => r.kind === 'miner' && !r.recall && r.state !== 'broken' && r.state !== 'dead');
      const dep = miners.length ? A.nearestDeposit(st, 'ice', [Math.floor(g.x), Math.floor(g.y)]) : null;
      if (!dep) continue;
      const t = createTask(st, { title: `Mine ice → ${g.name} hopper`, kind: 'refill', source: 'STANDING', command: 'Keep oxygen generator hoppers above 8 ice', priority: 0 });
      addJob(st, t, { kind: 'mine', label: 'MINING ICE FOR OXYGEN', target: dep.id, qty: A.hopperNeed(g), to: g.id, toKind: 'hopper' });
      remember(st, `Storage has no ice — mining ice directly into ${g.name}`, 'CORE', true, 'auto');
      continue;
    }
    A.hopperTask(st, g, Math.min(ice, A.hopperNeed(g)), 'STANDING', 'Keep oxygen generator hoppers above 8 ice');
  }
}

/** Crates staged on the landing pad go into storage as soon as there is room. */
function padRule(st: ColonyState) {
  const pad = st.modules.find((m) => m.kind === 'pad' && m.status === 'online');
  if (!pad || liveFor(st, (t) => t.kind === 'unload')) return;
  const items = (Object.entries(pad.delivered) as [ResId, number][]).filter(([, q]) => q > 0);
  const room = Math.floor(totalCap(st) * (1 - fill(st)));
  if (!items.length || room < 20) return;
  let left = room - 5;
  const t = createTask(st, { title: 'Move staged crates into storage', kind: 'unload', source: 'STANDING', command: 'Keep the landing pad clear' });
  for (const [r, q] of items) { const n = Math.min(q, left); if (n <= 0) break; left -= n; addHaul(st, t, r, n, -1, 'storage', 'CLEARING PAD', [], pad.id); }
}

function stockRule(st: ColonyState) {
  if (st.holdMining || fill(st) > 0.9) return;
  const L = lvl(st);
  const kinds: ResId[] = L >= 2 ? ['ice', 'regolith', 'iron', 'titanium', 'rare'] : ['ice', 'regolith', 'iron'];
  for (const r of st.robots.filter((q) => q.kind === 'miner' && !q.recall && robotAvailable(st, q))) {
    if (st.jobs.some((j) => j.only === r.id && (j.status === 'open' || j.status === 'active'))) continue;
    const opts = kinds.map((res) => ({ res, ratio: total(st, res) / RES[res].target, dep: A.nearestDeposit(st, res, [Math.floor(r.x / 16), Math.floor(r.y / 16)]) }))
      .filter((o) => o.dep && o.ratio < 1 && (Math.hypot(o.dep.x - BASE_CX, o.dep.y - BASE_CY) < 26 || st.modules.some((m) => m.kind === 'outpost' && m.status === 'online' && Math.hypot(m.x - o.dep!.x, m.y - o.dep!.y) < 10)))
      .sort((a, b) => a.ratio - b.ratio);
    const o = opts[0];
    if (!o) continue;
    const qty = Math.max(10, Math.min(30, Math.ceil(RES[o.res].target * 1.5 - total(st, o.res))));
    A.mineTask(st, o.dep!, qty, [r], 'STANDING', `Keep ${RES[o.res].name.toLowerCase()} at target stock`, [], `Mine ${RES[o.res].name.toLowerCase()} for stock`);
  }
}

// ------------------------------------------------------------------ AUTOMATED

function routines(st: ColonyState) {
  const P = st.core.perms;
  const storm = st.weather.storm && st.minute >= st.weather.storm.start && st.minute < st.weather.storm.end;
  // clean dusty arrays
  if (!storm) {
    const dusty = st.modules.filter((m) => m.kind === 'solar' && m.status === 'online' && m.dust > 0.3);
    if (dusty.length && !liveFor(st, (t) => t.kind === 'clean')) { A.cleanTask(st, dusty, 'ROUTINE', 'Panels over 30% dusty'); remember(st, `Cleaning ${dusty.length} dusty array(s) (automated)`, 'CORE', true, 'auto'); }
  }
  // repairs
  if (P.repair) {
    const targets: { module?: import('../sim/state').Module; robot?: import('../sim/state').Robot }[] = [
      ...st.modules.filter((m) => (m.status === 'online' || m.status === 'off') && (m.hp < 0.85 || (m.kind === 'habitat' && m.hp < 0.95))).filter((m) => !st.jobs.some((j) => (j.status === 'open' || j.status === 'active') && j.kind === 'repair' && j.target === m.id)).map((m) => ({ module: m })),
      ...st.robots.filter((r) => (r.state === 'broken' || r.state === 'dead') && !st.jobs.some((j) => (j.status === 'open' || j.status === 'active') && j.targetRobot === r.id)).map((r) => ({ robot: r })),
    ];
    if (targets.length && st.robots.some((r) => ['repair', 'builder', 'maint'].includes(r.kind) && r.state !== 'broken' && r.state !== 'dead')) {
      const leak = targets.some((t) => t.module?.kind === 'habitat');
      A.repairTask(st, targets, leak ? 'EMERGENCY' : 'ROUTINE', 'Automated repair');
      remember(st, `Repair dispatched: ${targets.map((t) => t.module?.name ?? t.robot?.name).join(', ')}`, 'CORE', true, 'auto');
    }
  }
  // production stock
  if (P.build && hasModule(st, 'workshop')) {
    for (const res of ['silica', 'polymer', 'electronics'] as ResId[]) {
      if (total(st, res) >= RES[res].target * 0.6) continue;
      if (st.production.some((o) => o.res === res)) continue;
      const p = plan(st, { intent: 'produce', resource: res, qty: res === 'electronics' ? 4 : 6 });
      if (p.ok && p.exec && !p.steps.some((s) => /mines/.test(s))) p.exec(st, 'ROUTINE', `Keep ${res} stocked`);
    }
  }
}

// ------------------------------------------------------------------ AUTONOMOUS

function autonomous(st: ColonyState) {
  const P = st.core.perms;
  for (const al of activeAlerts(st)) {
    if (al.acted) continue;
    let cmd: Command | null = null;
    if (al.kind === 'leak' && P.repair) cmd = { intent: 'fix', system: 'oxygen' };
    else if (al.key === 'o2-low' && P.power) cmd = { intent: 'fix', system: 'oxygen' };
    else if (al.key === 'power-failure' && P.power) cmd = { intent: 'fix', system: 'power' };
    else if (al.key === 'storm-forecast' && P.power) cmd = { intent: 'prepare', storm: true };
    else if (al.key === 'meteor-forecast') { al.acted = true; continue; }
    if (!cmd) continue;
    const p = plan(st, cmd);
    al.acted = true;
    if (p.ok && p.exec) {
      p.exec(st, 'EMERGENCY', `${al.title} — autonomous response`);
      st.core.initiated.count++;
      remember(st, `${al.title}: ${p.steps.slice(0, 3).join('; ')}`, 'CORE', true, 'emergency');
      emit(st, 'coreAct', undefined, undefined, { title: al.title, steps: p.steps });
    }
  }
  if (P.expand && st.minute % 60 === 0) {
    const a = analyze(st);
    const building = (k: string) => st.modules.some((m) => m.kind === k && (m.status === 'site' || m.status === 'building'));
    let cmd: Command | null = null;
    if (a.power.forecastBalance < -20 && !building('solar')) cmd = { intent: 'build', module: 'solar' };
    else if (a.power.batteryAtDawn < 5 && hour(st) < 16 && !building('battery')) cmd = { intent: 'build', module: 'battery' };
    else if (a.fill > 0.85 && !building('storage')) cmd = { intent: 'build', module: 'storage' };
    if (cmd) {
      const p = plan(st, cmd);
      if (p.ok && p.exec && p.confirm === 'build') { p.exec(st, 'CORE', `Autonomous expansion: ${cmd.module}`); remember(st, `Expansion: ${p.title} — ${p.why[0] ?? ''}`, 'CORE', true, 'auto'); emit(st, 'coreAct', undefined, undefined, { title: p.title, steps: p.steps }); }
    }
  }
}

// ------------------------------------------------------------------ suggestions (every level)

function suggest(st: ColonyState) {
  const a = analyze(st);
  const rec = recommend(st, a);
  // emergencies already have their own alert with a CORE PLAN button
  if (rec.key === 'expand' || rec.key === 'leak' || rec.key === 'o2' || rec.key === 'storm') return;
  const last = st.core.said[rec.key] ?? -1e9;
  if (st.minute - last < 180) return;
  // suggestions are info alerts the UI turns into CORE cards with a one-tap plan
  st.core.said[rec.key] = st.minute;
  const old = st.alerts.find((x) => x.kind === 'suggest' && !x.resolved);
  if (old) old.resolved = st.minute;
  st.alerts.push({ id: st.nextId++, key: `suggest-${rec.key}`, kind: 'suggest', title: 'CORE SUGGESTS', detail: rec.text, severity: 'info', since: st.minute });
  st.alerts[st.alerts.length - 1].cmd = JSON.stringify(rec.cmd);
  st.alerts[st.alerts.length - 1].label = rec.label;
  emit(st, 'suggest', undefined, undefined, { text: rec.text, label: rec.label });
}

export function setAutonomy(st: ColonyState, level: ColonyState['core']['autonomy']) {
  st.core.autonomy = level;
  remember(st, `Autonomy set to ${level.toUpperCase()}`, 'PLAYER', true, 'command');
}
export function ruleTime(r: Rule) { return r.minute !== undefined ? clock(r.minute) : ''; }
export { taskById, DEPOSIT };
