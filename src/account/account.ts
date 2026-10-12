// Player account: X handle, quests, token balance + ledger, achievements, lifetime stats, referral.
// Stored in this browser (localStorage) separately from the colony save, so it survives NEW COLONY.

import { CONFIG, gameUrl, postId } from './config';
import { STAGES, stageIndex, type Stage } from '../sim/defs';
import type { ColonyState } from '../sim/state';
import { sol } from '../sim/core';
import { colonyScores, onlineModules } from '../sim/colony';
import { alive } from '../sim/life';

export type QuestId = 'follow' | 'like' | 'rt' | 'reply';
export interface Quest { id: QuestId; title: string; short: string; url: () => string }
export const QUESTS: Quest[] = [
  { id: 'follow', title: `Follow @${CONFIG.xHandle}`, short: 'FOLLOW', url: () => `https://x.com/intent/follow?screen_name=${encodeURIComponent(CONFIG.xHandle)}` },
  { id: 'like', title: 'Like the post', short: 'LIKE', url: () => `https://x.com/intent/like?tweet_id=${postId()}` },
  { id: 'rt', title: 'Repost the post', short: 'REPOST', url: () => `https://x.com/intent/retweet?tweet_id=${postId()}` },
  { id: 'reply', title: 'Comment on the post', short: 'COMMENT', url: () => `https://x.com/intent/tweet?in_reply_to=${postId()}&text=${encodeURIComponent(CONFIG.replyText)}` },
];

export interface Achievement { id: string; name: string; icon: string; reward: number; check: (st: ColonyState, a: Account) => boolean }
const has = (st: ColonyState, key: string) => !!st.firsts?.[key];
const count = (st: ColonyState, kind: string) => st.modules.filter((m) => m.kind === kind && m.status === 'online').length;
export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-build', name: 'First Module', icon: '▣', reward: 250, check: (st) => Object.keys(st.firsts ?? {}).some((k) => k.startsWith('built-')) },
  { id: 'o2-backup', name: 'Backup Oxygen', icon: 'O₂', reward: 500, check: (st) => count(st, 'oxygen') >= 2 },
  { id: 'titanium', name: 'Titanium Strike', icon: '◆', reward: 250, check: (st) => has(st, 'mined-titanium') },
  { id: 'storm', name: 'Storm Survivor', icon: '≋', reward: 500, check: (st) => has(st, 'storm-survived') },
  { id: 'robot', name: 'Robot Factory', icon: '⚙', reward: 250, check: (st) => Object.keys(st.firsts ?? {}).some((k) => k.startsWith('robot-')) },
  { id: 'research', name: 'First Discovery', icon: '⚗', reward: 250, check: (st) => st.research.done.length > 0 },
  { id: 'modules15', name: '15 Modules', icon: '▦', reward: 500, check: (st) => onlineModules(st).filter((m) => m.kind !== 'pad').length >= 15 },
  { id: 'sol5', name: '5 Sols Alive', icon: '☀', reward: 500, check: (st) => sol(st) >= 6 && alive(st).length > 0 },
  { id: 'sol10', name: '10 Sols Alive', icon: '✦', reward: 1000, check: (st) => sol(st) >= 11 && alive(st).length > 0 },
  { id: 'base', name: 'Base Established', icon: '⌂', reward: 1000, check: (st) => stageIndex(st.stage) >= 1 },
  { id: 'colony', name: 'Colony Founded', icon: '★', reward: 2000, check: (st) => stageIndex(st.stage) >= 2 },
  { id: 'rare', name: 'Rare Minerals', icon: '✧', reward: 500, check: (st) => has(st, 'mined-rare') },
];

/** Repeatable in-game rewards (per event, in the colony being played). */
export const EARN = { module: 50, robot: 100, research: 150, sol: 100, stage: 1000, deposit: 25, storm: 200 };

export interface Account {
  v: 1;
  handle: string;
  createdAt: number;
  tokens: number;
  earned: number;
  ledger: { t: number; amount: number; reason: string }[];
  quests: Partial<Record<QuestId, { openedAt?: number; done?: number }>>;
  ref: string;
  referredBy: string | null;
  achievements: Record<string, number>;
  stats: { sols: number; modules: number; robots: number; research: number; storms: number; bestStage: Stage; bestScore: number; bestSol: number; colonists: number };
}

const KEY = 'aicolony.account.v1';
let acc: Account | null = null;
const listeners: ((a: Account, gain?: { amount: number; reason: string }) => void)[] = [];

function refCode(handle: string) {
  let h = 2166136261;
  for (const ch of handle.toLowerCase()) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return `${(handle.replace(/[^A-Za-z0-9]/g, "").slice(0, 8) || "CMDR").toUpperCase()}-${(h >>> 0).toString(36).slice(0, 4).toUpperCase()}`;
}

/** ?ref=CODE on the page URL (kept until an account is created). */
export function captureRef() {
  try {
    const q = new URLSearchParams(location.search).get('ref') ?? new URLSearchParams(location.hash.slice(1)).get('ref');
    if (q && /^[A-Z0-9_-]{3,20}$/i.test(q)) localStorage.setItem(`${KEY}.ref`, q.toUpperCase());
  } catch { /* storage unavailable */ }
}
const pendingRef = () => { try { return localStorage.getItem(`${KEY}.ref`); } catch { return null; } };

export function account(): Account | null {
  if (acc) return acc;
  try { const raw = localStorage.getItem(KEY); if (raw) acc = JSON.parse(raw) as Account; } catch { acc = null; }
  return acc;
}
function save() { if (!acc) return; try { localStorage.setItem(KEY, JSON.stringify(acc)); } catch { /* storage unavailable */ } }
export function onAccount(fn: (a: Account, gain?: { amount: number; reason: string }) => void) { listeners.push(fn); }
const notify = (gain?: { amount: number; reason: string }) => { if (acc) for (const f of listeners) f(acc, gain); };

export const validHandle = (s: string) => /^@?[A-Za-z0-9_]{1,15}$/.test(s.trim());
export function login(handleRaw: string): Account {
  const handle = handleRaw.trim().replace(/^@/, '');
  const old = account();
  if (old && old.handle.toLowerCase() === handle.toLowerCase()) return old;
  const ref = refCode(handle);
  const by = pendingRef();
  acc = {
    v: 1, handle, createdAt: Date.now(), tokens: 0, earned: 0, ledger: [], quests: {}, ref, referredBy: by && by !== ref ? by : null, achievements: {},
    stats: { sols: 0, modules: 0, robots: 0, research: 0, storms: 0, bestStage: 'outpost', bestScore: 0, bestSol: 0, colonists: 0 },
  };
  save(); notify();
  return acc;
}
export function logout() { acc = null; try { localStorage.removeItem(KEY); } catch { /* ignore */ } }

export function earn(amount: number, reason: string) {
  if (!acc || amount <= 0) return;
  acc.tokens += amount; acc.earned += amount;
  acc.ledger.unshift({ t: Date.now(), amount, reason });
  acc.ledger = acc.ledger.slice(0, 60);
  save(); notify({ amount, reason });
}

// ------------------------------------------------------------------ quests
export const questDone = (id: QuestId) => !!account()?.quests[id]?.done;
export const questsComplete = () => QUESTS.every((q) => questDone(q.id));
export const questsDoneCount = () => QUESTS.filter((q) => questDone(q.id)).length;
/** The player opened the quest link: it counts after the delay. */
export function openQuest(id: QuestId) {
  const a = account(); if (!a) return;
  const q = (a.quests[id] ??= {});
  if (q.done) return;
  q.openedAt ??= Date.now();
  save(); notify();
}
/** Seconds left before an opened quest counts (0 = ready / not opened). */
export function questWait(id: QuestId) {
  const q = account()?.quests[id];
  if (!q?.openedAt || q.done) return 0;
  return Math.max(0, CONFIG.questDelaySec - (Date.now() - q.openedAt) / 1000);
}
/** Completes any opened quest whose delay has passed. Call often. */
export function tickQuests(): QuestId[] {
  const a = account(); if (!a) return [];
  const out: QuestId[] = [];
  for (const q of QUESTS) {
    const s = a.quests[q.id];
    if (s?.openedAt && !s.done && Date.now() - s.openedAt >= CONFIG.questDelaySec * 1000) { s.done = Date.now(); out.push(q.id); earn(CONFIG.questReward, `Quest: ${q.short}`); }
  }
  if (out.length) save();
  return out;
}

// ------------------------------------------------------------------ in-game earning
/** Called from the game's event stream (play mode only). */
export function gameEvent(st: ColonyState, type: string): { amount: number; reason: string }[] {
  const a = account(); if (!a || st.demo) return [];
  const gains: { amount: number; reason: string }[] = [];
  const add = (amount: number, reason: string) => { earn(amount, reason); gains.push({ amount, reason }); };
  switch (type) {
    case 'online': a.stats.modules++; add(EARN.module, 'Module built'); break;
    case 'robotBuilt': a.stats.robots++; add(EARN.robot, 'Robot built'); break;
    case 'research': a.stats.research++; add(EARN.research, 'Research complete'); break;
    case 'stage': add(EARN.stage, `Stage: ${st.stage.toUpperCase()}`); break;
    case 'found': add(EARN.deposit, 'Deposit found'); break;
    case 'stormEnd': if (alive(st).length) { a.stats.storms++; add(EARN.storm, 'Storm survived'); } break;
    case 'solEnd': if (alive(st).length) { a.stats.sols++; add(EARN.sol, `Sol ${sol(st) - 1} survived`); } break;
  }
  // lifetime bests
  const s = a.stats;
  s.bestSol = Math.max(s.bestSol, sol(st));
  if (STAGES.indexOf(st.stage) > STAGES.indexOf(s.bestStage)) s.bestStage = st.stage;
  s.bestScore = Math.max(s.bestScore, colonyScores(st).overall);
  s.colonists = Math.max(s.colonists, alive(st).length);
  // one-time achievements
  for (const ach of ACHIEVEMENTS) {
    if (a.achievements[ach.id] || !ach.check(st, a)) continue;
    a.achievements[ach.id] = Date.now();
    add(ach.reward, `Achievement: ${ach.name}`);
  }
  save(); notify();
  return gains;
}

export const unlocked = () => ACHIEVEMENTS.filter((x) => account()?.achievements[x.id]);
export function refLink() {
  const base = gameUrl();
  const a = account(); if (!a) return base;
  return `${base}${base.includes('?') ? '&' : '?'}ref=${a.ref}`;
}
export function quoteIntent() {
  const text = `${CONFIG.shareText} ${refLink()}`;
  return `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(CONFIG.postUrl)}`;
}
export const fmt = (n: number) => n.toLocaleString('en-US');
