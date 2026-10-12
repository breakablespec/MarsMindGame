// Resources: per-module inventories, capacity, reservations, nearest source/destination.

import { MODULES, RES_IDS, ResId } from './defs';
import { centerOf } from './grid';
import type { ColonyState, Inv, Module } from './state';

export const isStore = (m: Module) => (m.status === 'online' || m.status === 'off') && !!MODULES[m.kind].storeCap;
export const stores = (st: ColonyState) => st.modules.filter(isStore);
export const capOf = (m: Module) => MODULES[m.kind].storeCap ?? 0;
export const usedOf = (m: Module) => RES_IDS.reduce((a, r) => a + (m.store[r] ?? 0), 0);
export const roomOf = (m: Module) => Math.max(0, capOf(m) - usedOf(m));

export function totals(st: ColonyState): Record<ResId, number> {
  const out = Object.fromEntries(RES_IDS.map((r) => [r, 0])) as Record<ResId, number>;
  for (const m of stores(st)) for (const r of RES_IDS) out[r] += m.store[r] ?? 0;
  return out;
}
export const total = (st: ColonyState, r: ResId) => stores(st).reduce((a, m) => a + (m.store[r] ?? 0), 0);
export const totalSolids = (st: ColonyState) => stores(st).reduce((a, m) => a + usedOf(m), 0);
export const totalCap = (st: ColonyState) => stores(st).reduce((a, m) => a + capOf(m), 0);
export const fill = (st: ColonyState) => { const c = totalCap(st); return c ? totalSolids(st) / c : 1; };

/** Materials already promised to open haul jobs (not yet picked up). */
export function reserved(st: ColonyState, r: ResId): number {
  let n = 0;
  for (const j of st.jobs) {
    if (j.kind !== 'haul' || j.res !== r || (j.status !== 'open' && j.status !== 'active')) continue;
    if (j.toKind === 'storage') continue;
    const carrying = j.robotId != null ? st.robots.find((q) => q.id === j.robotId && q.jobId === j.id)?.cargo?.qty ?? 0 : 0;
    n += Math.max(0, (j.qty ?? 0) - (j.moved ?? 0) - carrying);
  }
  return n;
}
export const available = (st: ColonyState, r: ResId) => Math.max(0, total(st, r) - reserved(st, r));

export function take(m: Module, r: ResId, q: number): number { const n = Math.max(0, Math.min(q, m.store[r] ?? 0)); m.store[r] = (m.store[r] ?? 0) - n; if (!m.store[r]) delete m.store[r]; return n; }
export function put(m: Module, r: ResId, q: number): number { const n = Math.max(0, Math.min(q, roomOf(m))); if (n) m.store[r] = (m.store[r] ?? 0) + n; return n; }

const dist = (m: Module, p: [number, number]) => { const c = centerOf(m); return Math.hypot(c[0] - p[0], c[1] - p[1]); };
export function nearestSource(st: ColonyState, r: ResId, near: [number, number], exclude?: number): Module | null {
  const c = stores(st).filter((m) => (m.store[r] ?? 0) > 0 && m.id !== exclude);
  c.sort((a, b) => dist(a, near) - dist(b, near) - ((b.store[r] ?? 0) - (a.store[r] ?? 0)) * 0.01);
  return c[0] ?? null;
}
export function nearestDest(st: ColonyState, r: ResId, near: [number, number], opts: { allowOutpost?: boolean; exclude?: number } = {}): Module | null {
  const c = stores(st).filter((m) => roomOf(m) > 0 && m.id !== opts.exclude && (opts.allowOutpost || m.kind !== 'outpost'));
  c.sort((a, b) => dist(a, near) - (a.store[r] ? 3 : 0) - (dist(b, near) - (b.store[r] ? 3 : 0)));
  return c[0] ?? null;
}

export function costMissing(st: ColonyState, cost: Inv, mult = 1): Partial<Record<ResId, number>> {
  const miss: Partial<Record<ResId, number>> = {};
  for (const r of RES_IDS) { const need = Math.ceil((cost[r] ?? 0) * mult); if (!need) continue; const have = available(st, r); if (have < need) miss[r] = need - have; }
  return miss;
}
export const invEmpty = (i: Inv) => !RES_IDS.some((r) => (i[r] ?? 0) > 0);
export const invText = (i: Inv) => RES_IDS.filter((r) => (i[r] ?? 0) > 0).map((r) => `${i[r]} ${r}`).join(', ');
