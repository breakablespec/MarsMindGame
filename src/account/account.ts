// Player account: X login, quests, MARS balance + ledger, achievements, lifetime stats, referral.
//
// Two modes, picked at boot by initAccount():
//   server — the site has the /api functions (Netlify). Login is "Sign in with X", every reward is
//            granted and stored by the server in Supabase. This file only reports what happened.
//   local  — no server (the Claude artifact, `npm run dev`): the player types an @handle and
//            everything lives in this browser's localStorage.

import { CONFIG, gameUrl, postId } from './config';
import { ACH_REWARD, EARN_RULES, QUEST_LABEL, type EarnEvent, type QuestId } from './rewards';
import { STAGES, stageIndex, type Stage } from '../sim/defs';
import type { ColonyState } from '../sim/state';
import { sol } from '../sim/core';
import { colonyScores, onlineModules } from '../sim/colony';
import { alive } from '../sim/life';

export type { QuestId } from './rewards';
export interface Quest { id: QuestId; title: string; short: string; url: () => string }
export const QUESTS: Quest[] = [
  { id: 'follow', title: '', short: QUEST_LABEL.follow, url: () => `https://x.com/intent/follow?screen_name=${encodeURIComponent(CONFIG.xHandle)}` },
  { id: 'like', title: 'Like the post', short: QUEST_LABEL.like, url: () => `https://x.com/intent/like?tweet_id=${postId()}` },
  { id: 'rt', title: 'Repost the post', short: QUEST_LABEL.rt, url: () => `https://x.com/intent/retweet?tweet_id=${postId()}` },
  { id: 'reply', title: 'Comment on the post', short: QUEST_LABEL.reply, url: () => `https://x.com/intent/tweet?in_reply_to=${postId()}` },
];
export const questTitle = (q: Quest) => (q.id === 'follow' ? `Follow @${CONFIG.xHandle}` : q.title);

export interface Achievement { id: string; name: string; icon: string; reward: number; check: (st: ColonyState) => boolean }
const has = (st: ColonyState, key: string) => !!st.firsts?.[key];
const count = (st: ColonyState, kind: string) => st.modules.filter((m) => m.kind === kind && m.status === 'online').length;
const A = (id: string, icon: string, check: (st: ColonyState) => boolean): Achievement => ({ id, icon, check, name: ACH_REWARD[id].name, reward: ACH_REWARD[id].reward });
export const ACHIEVEMENTS: Achievement[] = [
  A('first-build', '▣', (st) => Object.keys(st.firsts ?? {}).some((k) => k.startsWith('built-'))),
  A('o2-backup', 'O₂', (st) => count(st, 'oxygen') >= 2),
  A('titanium', '◆', (st) => has(st, 'mined-titanium')),
  A('storm', '≋', (st) => has(st, 'storm-survived')),
  A('robot', '⚙', (st) => Object.keys(st.firsts ?? {}).some((k) => k.startsWith('robot-'))),
  A('research', '⚗', (st) => st.research.done.length > 0),
  A('modules15', '▦', (st) => onlineModules(st).filter((m) => m.kind !== 'pad').length >= 15),
  A('sol5', '☀', (st) => sol(st) >= 6 && alive(st).length > 0),
  A('sol10', '✦', (st) => sol(st) >= 11 && alive(st).length > 0),
  A('base', '⌂', (st) => stageIndex(st.stage) >= 1),
  A('colony', '★', (st) => stageIndex(st.stage) >= 2),
  A('rare', '✧', (st) => has(st, 'mined-rare')),
];
export const EARN = Object.fromEntries(Object.entries(EARN_RULES).map(([k, v]) => [k, v.amount])) as Record<EarnEvent, number>;

export interface Stats { sols: number; modules: number; robots: number; research: number; storms: number; bestStage: Stage; bestScore: number; bestSol: number; colonists: number }
export interface Account {
  v: 1;
  handle: string;
  name?: string | null;
  avatar?: string | null;
  createdAt: number;
  tokens: number;
  earned: number;
  ledger: { t: number; amount: number; reason: string }[];
  quests: Partial<Record<QuestId, { openedAt?: number; done?: number }>>;
  ref: string;
  referredBy: string | null;
  invites?: number;
  achievements: Record<string, number>;
  stats: Stats;
}
export interface Gain { amount: number; reason: string; at?: { x: number; y: number } }

const KEY = 'aicolony.account.v1';
let acc: Account | null = null;
let mode: 'server' | 'local' = 'local';
let skew = 0; // server clock − local clock, ms
const listeners = new Set<(a: Account, gain?: Gain) => void>();
const emptyStats = (): Stats => ({ sols: 0, modules: 0, robots: 0, research: 0, storms: 0, bestStage: 'outpost', bestScore: 0, bestSol: 0, colonists: 0 });

export const accountMode = () => mode;
export function onAccount(fn: (a: Account, gain?: Gain) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
const notify = (gain?: Gain) => { if (acc) for (const f of [...listeners]) f(acc, gain); };
const save = () => { if (!acc || mode !== 'local') return; try { localStorage.setItem(KEY, JSON.stringify(acc)); } catch { /* storage unavailable */ } };
export const fmt = (n: number) => n.toLocaleString('en-US');

// ------------------------------------------------------------------ boot
type Summary = {
  player: { handle: string; name: string | null; avatar: string | null; tokens: number; ref: string; referred_by: string | null; created_at: string; best: Partial<Stats> };
  quests: Partial<Record<QuestId, { opened_at: string | null; completed_at: string | null }>>;
  ledger: { amount: number; reason: string; at: string }[];
  achievements: Record<string, string>;
  counts: { sols: number; modules: number; robots: number; research: number; storms: number; earned: number };
  invites: number; now: string;
  config?: { xHandle?: string; postUrl?: string; questDelaySec?: number; questReward?: number };
};
const ms = (s: string | null | undefined) => (s ? Date.parse(s) : undefined);
function applyConfig(c?: Summary['config']) {
  if (!c) return;
  if (c.xHandle) CONFIG.xHandle = c.xHandle;
  if (c.postUrl) CONFIG.postUrl = c.postUrl;
  if (c.questDelaySec) CONFIG.questDelaySec = c.questDelaySec;
  if (c.questReward) CONFIG.questReward = c.questReward;
}
function applySummary(j: Summary) {
  skew = (ms(j.now) ?? Date.now()) - Date.now();
  applyConfig(j.config);
  const p = j.player;
  acc = {
    v: 1, handle: p.handle, name: p.name, avatar: p.avatar, createdAt: ms(p.created_at) ?? Date.now(), tokens: Number(p.tokens), earned: Number(j.counts.earned),
    ledger: j.ledger.map((l) => ({ t: ms(l.at) ?? 0, amount: l.amount, reason: l.reason })),
    quests: Object.fromEntries(Object.entries(j.quests).map(([k, q]) => [k, { openedAt: ms(q?.opened_at), done: ms(q?.completed_at) }])),
    ref: p.ref, referredBy: p.referred_by, invites: j.invites,
    achievements: Object.fromEntries(Object.entries(j.achievements).map(([k, v]) => [k, ms(v) ?? 1])),
    stats: { ...emptyStats(), ...j.counts, bestStage: (p.best?.bestStage as Stage) ?? 'outpost', bestScore: p.best?.bestScore ?? 0, bestSol: p.best?.bestSol ?? 0, colonists: p.best?.colonists ?? 0 },
  };
}

/** True for the website build (dist/, marked by build.mjs): there, login is always Sign in with X. */
function hosted() {
  try {
    if (!(window as unknown as { __MM_SERVER__?: number }).__MM_SERVER__) return false;
    const local = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|)$/.test(location.hostname);
    return !local || new URLSearchParams(location.search).has('server');
  } catch { return false; }
}
let apiProblem: string | null = null;
/** Why the login server can't be reached (null when fine). Shown on the login screen. */
export const loginProblem = () => apiProblem;

/** Decide the mode and load the signed-in player. Call once before showing the title. */
export async function initAccount(): Promise<void> {
  let status = 0;
  try {
    const r = await fetch('/api/me', { headers: { accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store' });
    status = r.status;
    const isJson = (r.headers.get('content-type') ?? '').includes('application/json');
    if (r.status === 200 && isJson) { mode = 'server'; applySummary(await r.json()); return; }
    if (r.status === 401 && isJson) {
      mode = 'server'; acc = null;
      const c = await fetch('/api/config', { cache: 'no-store' }).then((x) => x.json()).catch(() => null);
      applyConfig(c ?? undefined);
      return;
    }
  } catch { /* no server here */ }
  if (hosted()) {
    // a real site without a working /api: keep X login, and say what is wrong instead of asking for a handle
    mode = 'server'; acc = null;
    apiProblem = status ? `Login server answered ${status} — open /api/health` : 'Login server unreachable — open /api/health';
    return;
  }
  mode = 'local';
  try { const raw = localStorage.getItem(KEY); if (raw) acc = JSON.parse(raw) as Account; } catch { acc = null; }
}
export async function refreshAccount() {
  if (mode !== 'server') return;
  try { const r = await fetch('/api/me'); if (r.ok) { applySummary(await r.json()); notify(); } else if (r.status === 401) acc = null; } catch { /* offline */ }
}

async function post<T = Record<string, unknown>>(path: string, body: unknown): Promise<T | null> {
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
    if (r.status === 401) { acc = null; return null; }
    return r.ok ? (r.json() as Promise<T>) : null;
  } catch { return null; }
}
type AwardRes = { awarded?: boolean; amount?: number; reason?: string; tokens?: number; ok?: boolean; error?: string; already?: boolean; completed_at?: string; opened_at?: string };
function credit(res: AwardRes | null, at?: Gain['at']) {
  if (!acc || !res) return false;
  if (typeof res.tokens === 'number') acc.tokens = res.tokens;
  if (res.awarded && res.amount) {
    acc.earned += res.amount;
    const reason = res.reason ?? 'Reward';
    acc.ledger.unshift({ t: Date.now(), amount: res.amount, reason });
    acc.ledger = acc.ledger.slice(0, 60);
    notify({ amount: res.amount, reason, at });
    return true;
  }
  notify();
  return false;
}

// ------------------------------------------------------------------ login
/** ?ref=CODE on the page URL (kept until an account is created). */
export function captureRef() {
  try {
    const q = new URLSearchParams(location.search).get('ref') ?? new URLSearchParams(location.hash.slice(1)).get('ref');
    if (q && /^[A-Z0-9_-]{3,20}$/i.test(q)) localStorage.setItem(`${KEY}.ref`, q.toUpperCase());
  } catch { /* storage unavailable */ }
}
const pendingRef = () => { try { return localStorage.getItem(`${KEY}.ref`); } catch { return null; } };
export function account(): Account | null { return acc; }

/** Server mode: go to X. */
export function loginWithX() {
  const ref = pendingRef();
  location.href = `/api/auth/login?return=${encodeURIComponent(location.pathname || '/')}${ref ? `&ref=${encodeURIComponent(ref)}` : ''}`;
}

function refCode(handle: string) {
  let h = 2166136261;
  for (const ch of handle.toLowerCase()) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return `${(handle.replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || 'CMDR').toUpperCase()}-${(h >>> 0).toString(36).slice(0, 4).toUpperCase()}`;
}
export const validHandle = (s: string) => /^@?[A-Za-z0-9_]{1,15}$/.test(s.trim());
/** Local mode: an @handle typed by the player. */
export function login(handleRaw: string): Account {
  const handle = handleRaw.trim().replace(/^@/, '');
  if (acc && acc.handle.toLowerCase() === handle.toLowerCase()) return acc;
  const ref = refCode(handle);
  const by = pendingRef();
  acc = { v: 1, handle, createdAt: Date.now(), tokens: 0, earned: 0, ledger: [], quests: {}, ref, referredBy: by && by !== ref ? by : null, achievements: {}, stats: emptyStats() };
  save(); notify();
  return acc;
}
export async function logout() {
  if (mode === 'server') await post('/api/auth/logout', {});
  else try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  acc = null;
}

/** Local mode only: the server grants MARS in server mode. */
function earnLocal(amount: number, reason: string, at?: Gain['at']) {
  if (!acc || amount <= 0) return;
  acc.tokens += amount; acc.earned += amount;
  acc.ledger.unshift({ t: Date.now(), amount, reason });
  acc.ledger = acc.ledger.slice(0, 60);
  save(); notify({ amount, reason, at });
}

// ------------------------------------------------------------------ quests
const now = () => Date.now() + skew;
export const questDone = (id: QuestId) => !!acc?.quests[id]?.done;
export const questsComplete = () => QUESTS.every((q) => questDone(q.id));
export const questsDoneCount = () => QUESTS.filter((q) => questDone(q.id)).length;
const claiming = new Set<QuestId>();
const retryAt: Partial<Record<QuestId, number>> = {};

/** The player opened the quest link: it counts after the delay. */
export function openQuest(id: QuestId) {
  if (!acc) return;
  const q = (acc.quests[id] ??= {});
  if (q.done) return;
  q.openedAt ??= now();
  save(); notify();
  if (mode === 'server') void post<AwardRes>('/api/quest', { quest: id, action: 'open' }).then((r) => { if (r?.opened_at && acc) { (acc.quests[id] ??= {}).openedAt = ms(r.opened_at); notify(); } });
}
/** Seconds left before an opened quest counts (0 = ready / not opened). */
export function questWait(id: QuestId) {
  const q = acc?.quests[id];
  if (!q?.openedAt || q.done) return 0;
  return Math.max(0, CONFIG.questDelaySec - (now() - q.openedAt) / 1000);
}
/** Completes any opened quest whose delay has passed. Call often; rewards arrive through onAccount. */
export function tickQuests() {
  if (!acc) return;
  for (const q of QUESTS) {
    const s = acc.quests[q.id];
    if (!s?.openedAt || s.done || questWait(q.id) > 0) continue;
    if (mode === 'local') { s.done = Date.now(); earnLocal(CONFIG.questReward, `Quest: ${q.short}`); continue; }
    if (claiming.has(q.id) || (retryAt[q.id] ?? 0) > Date.now()) continue;
    claiming.add(q.id);
    void post<AwardRes>('/api/quest', { quest: q.id, action: 'claim' }).then((r) => {
      claiming.delete(q.id);
      if (!acc) return;
      if (r?.ok) { (acc.quests[q.id] ??= {}).done = ms(r.completed_at) ?? Date.now(); credit(r); }
      else retryAt[q.id] = Date.now() + 1000;
    });
  }
}

// ------------------------------------------------------------------ in-game earning
const pendingAch = new Set<string>();
let lastBest = '';
const safeKey = (s: string) => s.replace(/[^A-Za-z0-9:_.,-]/g, '_').slice(0, 70);

/** Called from the game's event stream (play mode only). Rewards arrive through onAccount. */
export function gameEvent(st: ColonyState, type: string, data: Record<string, unknown> = {}, at?: Gain['at']) {
  const a = acc; if (!a || st.demo) return;
  st.colonyId ??= Math.random().toString(36).slice(2, 10);
  const cid = st.colonyId;
  const n = sol(st);
  let ev: { event: EarnEvent; key: string; label: string; stat?: keyof Stats } | null = null;
  switch (type) {
    case 'online': ev = { event: 'module', key: `${cid}:${data.id ?? n}`, label: EARN_RULES.module.label, stat: 'modules' }; break;
    case 'robotBuilt': ev = { event: 'robot', key: `${cid}:${data.name ?? n}`, label: EARN_RULES.robot.label, stat: 'robots' }; break;
    case 'research': ev = { event: 'research', key: `${cid}:${data.name ?? n}`, label: EARN_RULES.research.label, stat: 'research' }; break;
    case 'stage': ev = { event: 'stage', key: `${cid}:${st.stage}`, label: `Stage: ${st.stage.toUpperCase()}` }; break;
    case 'found': ev = { event: 'deposit', key: `${cid}:${data.kind ?? ''}:${Math.round(at?.x ?? 0)},${Math.round(at?.y ?? 0)}`, label: EARN_RULES.deposit.label }; break;
    case 'stormEnd': if (alive(st).length) ev = { event: 'storm', key: `${cid}:${n}`, label: EARN_RULES.storm.label, stat: 'storms' }; break;
    case 'solEnd': if (alive(st).length) ev = { event: 'sol', key: `${cid}:${n - 1}`, label: `Sol ${n - 1} survived`, stat: 'sols' }; break;
  }
  if (ev) {
    if (mode === 'local') { if (ev.stat) (a.stats[ev.stat] as number)++; earnLocal(EARN_RULES[ev.event].amount, ev.label, at); }
    else {
      const stat = ev.stat;
      void post<AwardRes>('/api/earn', { event: ev.event, key: safeKey(ev.key) }).then((r) => { if (r?.awarded && stat && acc) (acc.stats[stat] as number)++; credit(r, at); });
    }
  }
  // lifetime bests
  const s = a.stats;
  s.bestSol = Math.max(s.bestSol, n);
  if (STAGES.indexOf(st.stage) > STAGES.indexOf(s.bestStage)) s.bestStage = st.stage;
  s.bestScore = Math.max(s.bestScore, colonyScores(st).overall);
  s.colonists = Math.max(s.colonists, alive(st).length);
  if (mode === 'server' && (type === 'solEnd' || type === 'stage')) {
    const best = JSON.stringify({ bestSol: s.bestSol, bestScore: s.bestScore, bestStage: s.bestStage, colonists: s.colonists });
    if (best !== lastBest) { lastBest = best; void post('/api/stats', JSON.parse(best)); }
  }
  // one-time achievements
  for (const ach of ACHIEVEMENTS) {
    if (a.achievements[ach.id] || pendingAch.has(ach.id) || !ach.check(st)) continue;
    if (mode === 'local') { a.achievements[ach.id] = Date.now(); earnLocal(ach.reward, `Achievement: ${ach.name}`); continue; }
    pendingAch.add(ach.id);
    void post<AwardRes>('/api/achievement', { id: ach.id }).then((r) => {
      pendingAch.delete(ach.id);
      if (r && acc) { acc.achievements[ach.id] = Date.now(); credit(r); }
    });
  }
  save();
}

export const unlocked = () => ACHIEVEMENTS.filter((x) => acc?.achievements[x.id]);
export function refLink() {
  const base = gameUrl();
  if (!acc) return base;
  return `${base}${base.includes('?') ? '&' : '?'}ref=${acc.ref}`;
}
export function quoteIntent() {
  const text = `${CONFIG.shareText} ${refLink()}`;
  return `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(CONFIG.postUrl)}`;
}
