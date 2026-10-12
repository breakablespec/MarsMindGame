// Task graph bookkeeping: tasks own jobs; jobs depend on jobs; tasks depend on tasks.

import type { JobKind, ResId } from './defs';
import { emit, remember } from './core';
import type { ColonyState, Job, Task, TaskSource } from './state';

export function createTask(st: ColonyState, t: { title: string; kind: string; source: TaskSource; command?: string; after?: number[]; priority?: number; siteId?: number; est?: number; effect?: Task['effect']; permission?: string; reason?: string }): Task {
  const task: Task = {
    id: st.nextId++, title: t.title, kind: t.kind, source: t.source, status: 'waiting', after: t.after ?? [], jobs: [],
    created: st.minute, command: t.command, label: 'QUEUED', progress: 0, siteId: t.siteId, est: t.est, effect: t.effect,
    permission: t.permission, priority: t.priority ?? (t.source === 'EMERGENCY' ? 0 : t.source === 'PLAYER' || t.source === 'BRIEFING' ? 1 : 2), reason: t.reason,
  };
  st.tasks.push(task);
  if (st.tasks.length > 160) {
    // keep live tasks, drop oldest finished ones
    const finished = st.tasks.filter((q) => q.status === 'done' || q.status === 'failed' || q.status === 'cancelled');
    const drop = new Set(finished.slice(0, st.tasks.length - 160).map((q) => q.id));
    st.tasks = st.tasks.filter((q) => !drop.has(q.id));
    st.jobs = st.jobs.filter((j) => !drop.has(j.taskId));
  }
  return task;
}

export function addJob(st: ColonyState, task: Task, j: { kind: JobKind; label: string; after?: number[]; res?: ResId; qty?: number; from?: number; to?: number; toKind?: Job['toKind']; target?: number; waypoints?: [number, number][]; note?: string; only?: number; find?: string }): Job {
  const job: Job = { id: st.nextId++, taskId: task.id, status: 'open', robotId: null, after: j.after ?? [], moved: 0, ...j };
  st.jobs.push(job);
  task.jobs.push(job.id);
  return job;
}

/** Split a haul into chunks so several robots can share the trips. */
export function addHaul(st: ColonyState, task: Task, res: ResId, qty: number, to: number, toKind: Job['toKind'], label: string, after: number[] = [], from?: number): Job[] {
  const out: Job[] = [];
  let left = qty;
  while (left > 0) {
    const q = Math.min(20, left);
    out.push(addJob(st, task, { kind: 'haul', res, qty: q, to, toKind, label, after, from }));
    left -= q;
  }
  return out;
}

export const jobById = (st: ColonyState, id: number | null | undefined) => (id == null ? undefined : st.jobs.find((j) => j.id === id));
export const taskById = (st: ColonyState, id: number | null | undefined) => (id == null ? undefined : st.tasks.find((t) => t.id === id));
export const taskJobs = (st: ColonyState, t: Task) => t.jobs.map((id) => jobById(st, id)).filter(Boolean) as Job[];
export const liveTasks = (st: ColonyState) => st.tasks.filter((t) => t.status === 'waiting' || t.status === 'running');

export function jobReady(st: ColonyState, j: Job): boolean {
  if (j.status !== 'open') return false;
  const t = taskById(st, j.taskId);
  if (!t || t.status === 'cancelled' || t.status === 'done' || t.status === 'failed') return false;
  if (t.after.some((id) => { const a = taskById(st, id); return a && a.status !== 'done'; })) return false;
  if (t.after.some((id) => { const a = taskById(st, id); return a && (a.status === 'failed' || a.status === 'cancelled'); })) return false;
  return j.after.every((id) => jobById(st, id)?.status === 'done');
}

export function cancelTask(st: ColonyState, t: Task, why = 'Cancelled') {
  if (t.status === 'done' || t.status === 'failed' || t.status === 'cancelled') return;
  t.status = 'cancelled'; t.result = why; t.label = 'CANCELLED';
  for (const j of taskJobs(st, t)) {
    if (j.status === 'open' || j.status === 'active') j.status = 'failed';
    const r = st.robots.find((q) => q.jobId === j.id);
    if (r) { r.jobId = null; r.path = []; r.goal = null; if (r.state !== 'broken' && r.state !== 'dead') r.state = 'idle'; r.phase = 'IDLE'; }
  }
  // dependants fail too
  for (const d of st.tasks.filter((q) => q.after.includes(t.id))) cancelTask(st, d, `Depends on cancelled task #${t.id}`);
  if (t.produce) st.production = st.production.filter((o) => o.id !== t.produce!.orderId);
  if (t.fabricate) st.fabQueue = st.fabQueue.filter((o) => o.id !== t.fabricate!.orderId);
  if (t.siteId) {
    const m = st.modules.find((q) => q.id === t.siteId);
    if (m && (m.status === 'site' || m.status === 'building') && t.kind === 'build') refundSite(st, m);
  }
  emit(st, 'taskCancelled', undefined, undefined, { id: t.id, title: t.title });
}

/** A cancelled construction site: delivered materials stay as a crate pile for haulers to return. */
export function refundSite(st: ColonyState, m: import('./state').Module) {
  const anyDelivered = Object.values(m.delivered).some((v) => (v ?? 0) > 0);
  if (!anyDelivered) { st.modules = st.modules.filter((q) => q.id !== m.id); emit(st, 'gridChanged'); return; }
  m.status = 'site'; m.progress = 0; m.taskId = undefined;
  const task = createTask(st, { title: `Return materials from ${m.name}`, kind: 'salvage', source: 'ROUTINE', siteId: m.id });
  task.status = 'running';
  for (const [r, q] of Object.entries(m.delivered)) if ((q ?? 0) > 0) addHaul(st, task, r as ResId, q!, -1, 'storage', 'RETURNING MATERIALS', [], m.id);
  m.salvage = true;
}

export function finishTask(st: ColonyState, t: Task, ok: boolean, result: string) {
  if (t.status === 'done' || t.status === 'failed' || t.status === 'cancelled') return;
  t.status = ok ? 'done' : 'failed';
  t.result = result; t.finished = st.minute; t.progress = ok ? 1 : t.progress;
  t.label = ok ? 'DONE' : 'FAILED';
  if (t.source !== 'ROUTINE' && t.source !== 'STANDING') {
    st.core.plans[ok ? 'done' : 'failed']++;
    if (t.source === 'CORE' || t.source === 'EMERGENCY') { st.core.initiated.count++; if (ok) st.core.initiated.ok++; }
    if (t.est && t.startedReal !== undefined) { /* estimate error recorded by engine */ }
    remember(st, t.command ?? t.title, t.source, ok, t.source === 'PLAYER' || t.source === 'BRIEFING' ? 'command' : t.source === 'EMERGENCY' ? 'emergency' : 'auto');
  }
  if (ok) { st.sol.tasks++; st.core.xp += t.source === 'ROUTINE' ? 1 : 4; }
  for (const j of taskJobs(st, t)) if (j.status === 'open' || j.status === 'active') { j.status = ok ? 'done' : 'failed'; const r = st.robots.find((q) => q.jobId === j.id); if (r) { r.jobId = null; if (r.state === 'working' || r.state === 'moving') r.state = 'idle'; r.path = []; r.goal = null; } }
  if (!ok) for (const d of st.tasks.filter((q) => q.after.includes(t.id))) cancelTask(st, d, `Blocked: #${t.id} failed (${result})`);
  emit(st, ok ? 'taskDone' : 'taskFailed', undefined, undefined, { id: t.id, title: t.title, result, source: t.source });
}

/** Recompute status, label and progress of live tasks; finish job-based tasks whose jobs are all done. */
export function updateTasks(st: ColonyState) {
  for (const t of st.tasks) {
    if (t.status !== 'waiting' && t.status !== 'running') continue;
    const blocked = t.after.some((id) => { const a = taskById(st, id); return a && a.status !== 'done'; });
    const jobs = taskJobs(st, t);
    if (blocked) { const a = taskById(st, t.after.find((id) => taskById(st, id)?.status !== 'done')); t.label = a ? `WAITING: ${a.title.toUpperCase()} (#${a.id})` : 'WAITING'; t.status = 'waiting'; continue; }
    if (t.produce || t.fabricate || t.researchTech) continue; // module-driven
    if (!jobs.length) continue;
    const done = jobs.filter((j) => j.status === 'done').length;
    const failed = jobs.find((j) => j.status === 'failed');
    if (failed && t.kind !== 'mine') { finishTask(st, t, false, failed.fail ?? `${failed.label} failed`); continue; }
    if (done === jobs.length) {
      if (t.kind === 'build' || t.kind === 'move') continue; // finished by construction on activation
      finishTask(st, t, true, t.result ?? 'done');
      continue;
    }
    const active = jobs.find((j) => j.status === 'active') ?? jobs.find((j) => j.status === 'open' && jobReady(st, j));
    if (jobs.some((j) => j.status === 'active')) { t.status = 'running'; if (t.startedReal === undefined) t.startedReal = Date.now() / 1000; }
    if (active) t.label = active.note && active.status === 'active' ? active.note : active.label;
    else t.label = 'WAITING FOR ROBOTS';
    // progress: weighted by job type
    let w = 0, p = 0;
    for (const j of jobs) {
      const weight = j.kind === 'build' ? 3 : j.kind === 'connect' ? 1 : j.kind === 'haul' || j.kind === 'mine' ? 1 : 1;
      w += weight;
      if (j.status === 'done') p += weight;
      else if ((j.kind === 'haul' || j.kind === 'mine') && j.qty) { const carry = j.robotId !== null ? st.robots.find((r) => r.id === j.robotId)?.cargo?.qty ?? 0 : 0; p += weight * Math.min(1, ((j.moved ?? 0) + carry * (j.kind === 'mine' ? 1 : 0.5)) / j.qty); }
      else if (j.kind === 'build' && j.target !== undefined) { const m = st.modules.find((q) => q.id === j.target); if (m) p += weight * m.progress; }
    }
    t.progress = w ? p / w : 0;
  }
}

export function assignedRobots(st: ColonyState, t: Task) {
  const ids = new Set(t.jobs);
  return st.robots.filter((r) => r.jobId !== null && ids.has(r.jobId));
}
