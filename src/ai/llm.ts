// Claude fallback via the artifact viewer's `sample` capability (the viewer's own Claude, with consent).
// Claude only ever returns structured JSON in CORE's command schema; every field is validated
// against the live colony before the deterministic planner sees it. Nothing Claude says is executed.

import { MODULES, ModuleKind, RES_IDS, ResId, ROBOT_KINDS, RobotKind, TECHS, TechId } from '../sim/defs';
import { clock, sol } from '../sim/core';
import { totals } from '../sim/storage';
import type { ColonyState } from '../sim/state';
import { analyze } from './analysis';
import { canResearch } from '../sim/research';
import { Command, Direction, INTENTS, Intent, System } from './command';

type SampleFn = ((input: string, opts?: Record<string, unknown>) => Promise<{ text: string }>) & { json: <T>(input: string, opts?: Record<string, unknown>) => Promise<T> };
let sampleFn: SampleFn | null = null;
let status: 'unknown' | 'ready' | 'unavailable' | 'denied' = 'unknown';
export const aiStatus = () => status;

export async function initLLM() {
  try {
    const w = window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } };
    if (!w.claude?.use) { status = 'unavailable'; return; }
    const s = (await w.claude.use('sample')) as SampleFn | null;
    if (s) { sampleFn = s; status = 'ready'; } else status = 'unavailable';
  } catch { status = 'unavailable'; }
}

function summary(st: ColonyState) {
  const a = analyze(st);
  return {
    sol: sol(st), time: clock(st.minute), stage: st.stage,
    oxygenPct: Math.round(a.o2.pct * 100), o2NetPerHour: +a.o2.net.toFixed(1), powerNetKw: +a.power.net.toFixed(1), batteryKwh: Math.round(a.power.battery), batteryCap: a.power.cap,
    stock: totals(st), modules: st.modules.filter((m) => m.status === 'online').map((m) => m.kind),
    robots: st.robots.map((r) => ({ name: r.name, kind: r.kind, state: r.state })),
    knownDeposits: a.deposits.map((d) => ({ kind: d.kind, dir: d.dir, dist: Math.round(d.dist) })),
    risks: a.risks.slice(0, 5).map((r) => r.text), research: { done: st.research.done, current: st.research.current },
    storm: a.storm,
  };
}

const SCHEMA = `Command = {
 "intent": one of ${JSON.stringify(INTENTS)},
 "module"?: one of ${JSON.stringify(Object.keys(MODULES))},
 "count"?: integer 1-4, "colonists"?: integer (habitat sizing),
 "resource"?: one of ${JSON.stringify(RES_IDS)} | "lowest",
 "qty"?: integer 1-500,
 "robot"?: one of ${JSON.stringify(ROBOT_KINDS)}, "robots"?: integer 1-6,
 "direction"?: "north"|"south"|"east"|"west"|"nearest",
 "near"?: a module kind | a resource | "mine" | "base",
 "system"?: "oxygen"|"power"|"research"|"mining"|"lighting"|"production"|"storage"|"safety"|"water"|"charging",
 "over"?: same values as system (prioritize X over Y),
 "off"?: boolean (allocate_power),
 "tech"?: one of ${JSON.stringify(TECHS.map((t) => t.id))},
 "storm"?: boolean (prepare),
 "schedule"?: {"minute": 0-1439}, "then"?: Command (for intent "schedule")
}
Intent notes: build (a module), mine (a raw resource), produce (silica/polymer/electronics at the workshop), build_robot, explore (scout), repair, fix (diagnose a system problem), survive (keep everyone alive), urgent (most urgent thing), prepare (dust storm / night), prioritize, allocate_power (switch a system on/off), charge, recall, resume, clean (solar panels), move (relocate a module), transport (move stock between storages), optimize, safety (backups/reserves), research, schedule (daily routine), inspect (status / advice), cancel.`;

export async function llmParse(st: ColonyState, text: string): Promise<{ commands: Command[]; reply: string } | { error: string }> {
  if (!sampleFn) return { error: status === 'denied' ? 'denied' : 'unavailable' };
  const prompt = `You are the command parser for CORE, the AI operating system of a small Mars colony game. Robots do all physical work.
Translate the commander's request into 1-3 game commands using ONLY this schema. If it can't be expressed, return an empty list and a short explanation of what CORE can do instead. Never invent modules, resources or techs. Prefer one command.

Schema:
${SCHEMA}

Colony state:
${JSON.stringify(summary(st))}

Commander said: ${JSON.stringify(text)}

Reply with only JSON: {"reply": "<CORE's short reply, max 16 words, calm and competent>", "commands": [Command, ...]}`;
  try {
    const out = await sampleFn.json<{ reply?: string; commands?: unknown[] }>(prompt, { modelTier: 'quick', cache: false });
    const cmds = (Array.isArray(out?.commands) ? out.commands : []).map((c) => validate(c)).filter(Boolean) as Command[];
    return { commands: cmds.slice(0, 3), reply: typeof out?.reply === 'string' ? out.reply.slice(0, 160) : '' };
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'not_granted' || code === 'sampling_disabled') status = 'denied';
    return { error: status === 'denied' ? 'denied' : 'failed' };
  }
}

const DIRS: Direction[] = ['north', 'south', 'east', 'west', 'nearest'];
const SYSTEMS: System[] = ['oxygen', 'power', 'research', 'mining', 'lighting', 'production', 'storage', 'safety', 'water', 'charging', 'life'];
const int = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : undefined);
export function validate(raw: unknown, depth = 0): Command | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!INTENTS.includes(r.intent as Intent)) return null;
  const c: Command = { intent: r.intent as Intent };
  if (typeof r.module === 'string' && r.module in MODULES) c.module = r.module as ModuleKind;
  if (typeof r.resource === 'string' && (RES_IDS.includes(r.resource as ResId) || r.resource === 'lowest')) c.resource = r.resource as ResId | 'lowest';
  if (typeof r.robot === 'string' && ROBOT_KINDS.includes(r.robot as RobotKind)) c.robot = r.robot as RobotKind;
  if (typeof r.direction === 'string' && DIRS.includes(r.direction as Direction)) c.direction = r.direction as Direction;
  if (typeof r.system === 'string' && SYSTEMS.includes(r.system as System)) c.system = r.system as System;
  if (typeof r.over === 'string' && SYSTEMS.includes(r.over as System)) c.over = r.over as System;
  if (typeof r.near === 'string' && (r.near in MODULES || RES_IDS.includes(r.near as ResId) || r.near === 'mine' || r.near === 'base')) c.near = r.near as Command['near'];
  if (typeof r.tech === 'string' && TECHS.some((t) => t.id === r.tech)) c.tech = r.tech as TechId;
  if (typeof r.off === 'boolean') c.off = r.off;
  if (typeof r.storm === 'boolean') c.storm = r.storm;
  c.count = int(r.count, 1, 4); c.qty = int(r.qty, 1, 500); c.robots = int(r.robots, 1, 6); c.colonists = int(r.colonists, 1, 24);
  if (c.intent === 'schedule' && depth === 0) {
    const s = r.schedule as Record<string, unknown> | undefined;
    const m = int(s?.minute, 0, 1439);
    const then = validate(r.then, 1);
    if (m === undefined || !then) return null;
    c.schedule = { minute: m }; c.then = then;
  }
  for (const k of Object.keys(c) as (keyof Command)[]) if (c[k] === undefined) delete c[k];
  return c;
}

/** Lab talk: map a strategic research question to existing techs (validated). */
export async function llmLabTalk(st: ColonyState, question: string): Promise<{ reply: string; techIds: TechId[] } | { error: string }> {
  if (!sampleFn) return { error: 'unavailable' };
  const techs = TECHS.map((t) => ({ id: t.id, name: t.name, effect: t.effect, branch: t.branch, tier: t.tier, available: canResearch(st, t.id).ok, done: st.research.done.includes(t.id) }));
  const prompt = `You advise the research lab of a Mars colony game. Pick up to 3 techs from the list that best answer the commander's question. Only use ids from the list; prefer ones with available=true and done=false. Explain in one short sentence (max 22 words) why, referencing real effects.

Techs: ${JSON.stringify(techs)}
Colony: ${JSON.stringify(summary(st))}
Question: ${JSON.stringify(question)}

Reply with only JSON: {"reply": string, "techIds": [id, ...]}`;
  try {
    const out = await sampleFn.json<{ reply?: string; techIds?: unknown[] }>(prompt, { modelTier: 'quick', cache: false });
    const ids = (Array.isArray(out?.techIds) ? out.techIds : []).filter((x): x is TechId => typeof x === 'string' && TECHS.some((t) => t.id === x) && !st.research.done.includes(x as TechId)).slice(0, 3);
    return { reply: typeof out?.reply === 'string' ? out.reply.slice(0, 200) : '', techIds: ids };
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'not_granted' || code === 'sampling_disabled') status = 'denied';
    return { error: 'failed' };
  }
}
