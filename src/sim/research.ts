// Space research: materials hauled to the lab, then research points accumulate while the lab
// is powered and staffed by a scientist. Completed techs change real modifiers.

import { STAGES, TECH, TechId, techPrereq } from './defs';
import { addHistory, emit, has } from './core';
import { labWorking } from './power';
import { alive } from './life';
import type { ColonyState } from './state';
import { finishTask, taskById, taskJobs } from './tasks';
import { BASE_CX, BASE_CY, reveal } from './world';

export const labs = (st: ColonyState) => st.modules.filter((m) => m.kind === 'lab' && m.status === 'online');
export function rpPerMinute(st: ColonyState) {
  const sci = alive(st).filter((c) => c.role === 'scientist').length;
  if (!sci) return 0;
  return 1 + 0.6 * (sci - 1);
}
export function canResearch(st: ColonyState, id: TechId): { ok: boolean; why?: string } {
  const t = TECH[id];
  if (has(st, id)) return { ok: false, why: 'Already researched' };
  const pre = techPrereq(t);
  if (pre && !has(st, pre)) return { ok: false, why: `Needs ${TECH[pre].name} first` };
  if (t.stage && STAGES.indexOf(st.stage) < STAGES.indexOf(t.stage)) return { ok: false, why: `Needs stage ${t.stage.toUpperCase()}` };
  return { ok: true };
}

export function researchTick(st: ColonyState) {
  const R = st.research;
  if (!R.current) return;
  const task = taskById(st, R.taskId);
  if (task && (task.status === 'cancelled' || task.status === 'failed')) { R.current = null; R.taskId = null; R.rp = 0; R.delivered = false; return; }
  const tech = TECH[R.current];
  if (!R.delivered) {
    const jobs = task ? taskJobs(st, task) : [];
    if (jobs.every((j) => j.status === 'done')) {
      R.delivered = true;
      if (R.bank) { R.rp += R.bank; R.bank = 0; }
      const lab = labs(st)[0];
      if (lab) for (const k of Object.keys(lab.delivered)) delete lab.delivered[k as keyof typeof lab.delivered];
      emit(st, 'researchStart', undefined, undefined, { name: tech.name });
    } else if (task) { task.status = jobs.some((j) => j.status === 'active') ? 'running' : task.status; task.label = jobs.find((j) => j.status === 'active')?.note ?? 'DELIVERING MATERIALS TO LAB'; task.progress = 0.2 * jobs.filter((j) => j.status === 'done').length / Math.max(1, jobs.length); }
    return;
  }
  const lab = labs(st)[0];
  const working = labWorking(st) && lab && lab.powered;
  if (working) R.rp += rpPerMinute(st);
  if (task) {
    task.status = 'running';
    task.progress = 0.2 + 0.8 * Math.min(1, R.rp / tech.rp);
    task.label = !lab ? 'NO LAB' : !alive(st).some((c) => c.role === 'scientist') ? 'NO SCIENTIST' : !lab.powered ? 'LAB UNPOWERED' : `RESEARCHING ${Math.floor((R.rp / tech.rp) * 100)}%`;
  }
  if (R.rp >= tech.rp) completeResearch(st, R.current);
}

export function completeResearch(st: ColonyState, id: TechId) {
  const R = st.research;
  const tech = TECH[id];
  R.done.push(id);
  R.current = null; R.rp = 0; R.delivered = false;
  const task = taskById(st, R.taskId);
  R.taskId = null;
  addHistory(st, `Research complete: ${tech.name}`, 'research');
  emit(st, 'research', undefined, undefined, { id, name: tech.name, effect: tech.effect });
  if (id === 'scanner') {
    for (const d of st.deposits) if (Math.hypot(d.x - BASE_CX, d.y - BASE_CY) < 22 && !d.found) { d.found = true; reveal(st, d.x + 1, d.y + 1, 2.5); }
  }
  if (task) finishTask(st, task, true, `${tech.name}: ${tech.effect}`);
}
