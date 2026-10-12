// Occupancy, walkability, buildability, site search and A* path finding.

import { MODULES, ModuleKind } from './defs';
import type { ColonyState, Deposit, Module } from './state';
import { BUILDABLE, MAP_H, MAP_W, MOVE_COST, T, WALKABLE, explored, idx, inMap, terrain } from './world';

let gridVersion = 1;
export function bumpGrid() { gridVersion++; }
export const getGridVersion = () => gridVersion;

interface Occ { ver: number; occ: Int32Array; mods: number }
const occCache = new WeakMap<ColonyState, Occ>();

/** occ[i] > 0 → module id; occ[i] < 0 → -(deposit id) ; 0 free. Landing pad doesn't block. */
export function occupancy(st: ColonyState): Int32Array {
  const c = occCache.get(st);
  if (c && c.ver === gridVersion && c.mods === st.modules.length) return c.occ;
  const occ = new Int32Array(MAP_W * MAP_H);
  for (const d of st.deposits) {
    if (d.kind === 'vent') continue;
    if (d.amount <= 0 && d.kind !== 'debris') continue;
    if (d.kind === 'debris' && d.amount <= 0) continue;
    for (let y = d.y; y < d.y + 2; y++) for (let x = d.x; x < d.x + 2; x++) if (inMap(x, y)) occ[idx(x, y)] = -d.id;
  }
  for (const m of st.modules) {
    if (m.kind === 'pad') continue;
    for (let y = m.y; y < m.y + m.h; y++) for (let x = m.x; x < m.x + m.w; x++) if (inMap(x, y)) occ[idx(x, y)] = m.id;
  }
  occCache.set(st, { ver: gridVersion, occ, mods: st.modules.length });
  return occ;
}

export function walkable(st: ColonyState, x: number, y: number): boolean {
  if (!inMap(x, y)) return false;
  const i = idx(x, y);
  return WALKABLE[terrain(st)[i]] && occupancy(st)[i] === 0;
}
export function moduleAt(st: ColonyState, x: number, y: number): Module | null {
  if (!inMap(x, y)) return null;
  const o = occupancy(st)[idx(x, y)];
  if (o > 0) return st.modules.find((m) => m.id === o) ?? null;
  const pad = st.modules.find((m) => m.kind === 'pad' && x >= m.x && y >= m.y && x < m.x + m.w && y < m.y + m.h);
  return pad ?? null;
}
export function depositAt(st: ColonyState, x: number, y: number): Deposit | null {
  if (!inMap(x, y)) return null;
  const o = occupancy(st)[idx(x, y)];
  if (o < 0) return st.deposits.find((d) => d.id === -o) ?? null;
  return st.deposits.find((d) => d.kind === 'vent' && x >= d.x && y >= d.y && x < d.x + 2 && y < d.y + 2) ?? null;
}

/** Walkable tiles touching a rectangle (8-neighbour ring). */
export function accessTiles(st: ColonyState, x: number, y: number, w: number, h: number): [number, number][] {
  const out: [number, number][] = [];
  for (let yy = y - 1; yy <= y + h; yy++)
    for (let xx = x - 1; xx <= x + w; xx++) {
      const inside = xx >= x && yy >= y && xx < x + w && yy < y + h;
      if (inside) continue;
      const corner = (xx === x - 1 || xx === x + w) && (yy === y - 1 || yy === y + h);
      if (corner) continue;
      if (walkable(st, xx, yy)) out.push([xx, yy]);
    }
  return out;
}
export const moduleAccess = (st: ColonyState, m: Module) => accessTiles(st, m.x, m.y, m.w, m.h);
export const depositAccess = (st: ColonyState, d: Deposit) => accessTiles(st, d.x, d.y, 2, 2);

export const centerOf = (m: { x: number; y: number; w: number; h: number }): [number, number] => [m.x + m.w / 2, m.y + m.h / 2];
/** Chebyshev gap between two rectangles (0 = touching). */
export function rectGap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
  return Math.max(dx, dy);
}

// ------------------------------------------------------------------ building sites

export interface SiteCheck { ok: boolean; reason?: string; gridModule?: Module | null }
const GRID_RANGE = 10;
export function gridAnchor(st: ColonyState, r: { x: number; y: number; w: number; h: number }): Module | null {
  let best: Module | null = null, bd = 1e9;
  for (const m of st.modules) {
    if (m.status !== 'online' && m.status !== 'off') continue;
    if (m.kind === 'outpost' || m.kind === 'pad') continue;
    const g = rectGap(m, r);
    if (g <= GRID_RANGE && g < bd) { bd = g; best = m; }
  }
  return best;
}

export function checkSite(st: ColonyState, kind: ModuleKind, x: number, y: number, ignore: number[] = []): SiteCheck {
  const def = MODULES[kind];
  const t = terrain(st), ex = explored(st), occ = occupancy(st);
  const vent = def.needsVent ? st.deposits.find((d) => d.kind === 'vent' && d.x === x && d.y === y) : null;
  if (def.needsVent && !vent) return { ok: false, reason: 'Must sit exactly on a geothermal vent' };
  for (let yy = y; yy < y + def.h; yy++)
    for (let xx = x; xx < x + def.w; xx++) {
      if (!inMap(xx, yy)) return { ok: false, reason: 'Off the map' };
      const i = idx(xx, yy);
      if (!ex[i]) return { ok: false, reason: 'Unexplored ground' };
      const o = occ[i];
      if (o !== 0 && !ignore.includes(o)) return { ok: false, reason: o > 0 ? 'Another module is here' : 'A deposit is here' };
      if (!vent && !BUILDABLE[t[i]]) return { ok: false, reason: `${['Flat ground', 'Rough ground', 'Boulders', 'Ridge', 'Crater', 'Dunes', 'Ice sheet', 'Unstable ground', 'Plating'][t[i]]} can't be built on` };
      const pad = st.modules.find((m) => m.kind === 'pad' && xx >= m.x && yy >= m.y && xx < m.x + m.w && yy < m.y + m.h);
      if (pad) return { ok: false, reason: 'Landing pad must stay clear' };
    }
  // one-tile clearance so robots can always get around
  const rr = { x, y, w: def.w, h: def.h };
  for (const m of st.modules) {
    if (ignore.includes(m.id)) continue;
    if (rectGap(m, rr) < 1) return { ok: false, reason: `Too close to ${m.name} (robots need a lane)` };
  }
  for (const d of st.deposits) {
    if (d.kind === 'vent' && vent) continue;
    if ((d.amount > 0 || d.kind === 'vent') && rectGap({ x: d.x, y: d.y, w: 2, h: 2 }, rr) < 1) return { ok: false, reason: `Blocks the ${d.kind} deposit` };
  }
  if (!accessTiles(st, x, y, def.w, def.h).length) return { ok: false, reason: 'No robot access' };
  const anchor = kind === 'outpost' ? null : gridAnchor(st, rr);
  if (kind !== 'outpost' && !anchor) return { ok: false, reason: `More than ${GRID_RANGE} tiles from the power grid` };
  return { ok: true, gridModule: anchor };
}

export interface SiteOption { x: number; y: number; score: number; zone: string }
/** Best valid sites for a module near an anchor point (tile coords). */
export function findSites(st: ColonyState, kind: ModuleKind, near: [number, number], count = 6, maxR = 16): SiteOption[] {
  const def = MODULES[kind];
  const out: SiteOption[] = [];
  const stores = st.modules.filter((m) => m.status === 'online' && (m.kind === 'storage' || m.kind === 'command'));
  if (def.needsVent) {
    for (const d of st.deposits.filter((q) => q.kind === 'vent' && q.found)) if (checkSite(st, kind, d.x, d.y).ok) out.push({ x: d.x, y: d.y, score: Math.hypot(d.x - near[0], d.y - near[1]), zone: zoneName(d.x, d.y) });
    return out.sort((a, b) => a.score - b.score).slice(0, count);
  }
  for (let r = 0; r <= maxR; r++)
    for (let y = Math.round(near[1]) - r; y <= Math.round(near[1]) + r; y++)
      for (let x = Math.round(near[0]) - r; x <= Math.round(near[0]) + r; x++) {
        if (Math.max(Math.abs(x - Math.round(near[0])), Math.abs(y - Math.round(near[1]))) !== r) continue;
        const sx = x - Math.floor(def.w / 2), sy = y - Math.floor(def.h / 2);
        if (!checkSite(st, kind, sx, sy).ok) continue;
        const cx = sx + def.w / 2, cy = sy + def.h / 2;
        const dStore = stores.length ? Math.min(...stores.map((m) => Math.hypot(centerOf(m)[0] - cx, centerOf(m)[1] - cy))) : 0;
        const onPlate = terrain(st)[idx(sx, sy)] === T.PLATE ? -2 : 0;
        out.push({ x: sx, y: sy, score: Math.hypot(cx - near[0], cy - near[1]) + dStore * 0.25 + onPlate, zone: zoneName(sx, sy) });
        if (out.length > 60) break;
      }
  out.sort((a, b) => a.score - b.score);
  // de-duplicate overlapping options
  const picked: SiteOption[] = [];
  for (const o of out) { if (picked.some((p) => Math.abs(p.x - o.x) < def.w && Math.abs(p.y - o.y) < def.h)) continue; picked.push(o); if (picked.length >= count) break; }
  return picked;
}

export function zoneName(x: number, y: number): string {
  const dx = x - 46, dy = y - 33;
  const d = Math.hypot(dx, dy);
  if (d < 6) return 'Base Core';
  const ns = dy < -3 ? 'North' : dy > 3 ? 'South' : '';
  const ew = dx > 3 ? 'East' : dx < -3 ? 'West' : '';
  const dir = `${ns}${ns && ew ? '-' : ''}${ew}` || 'Central';
  const ring = d < 12 ? 'Utility Zone' : d < 22 ? 'Ring' : 'Frontier';
  return `${dir} ${ring}`;
}

// ------------------------------------------------------------------ A*

class Heap {
  a: number[] = []; p: number[] = [];
  push(v: number, pr: number) { const a = this.a, p = this.p; a.push(v); p.push(pr); let i = a.length - 1; while (i > 0) { const j = (i - 1) >> 1; if (p[j] <= p[i]) break; [a[i], a[j]] = [a[j], a[i]]; [p[i], p[j]] = [p[j], p[i]]; i = j; } }
  pop(): number { const a = this.a, p = this.p; const top = a[0]; const lv = a.pop()!, lp = p.pop()!; if (a.length) { a[0] = lv; p[0] = lp; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < a.length && p[l] < p[m]) m = l; if (r < a.length && p[r] < p[m]) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; [p[i], p[m]] = [p[m], p[i]]; i = m; } } return top; }
  get size() { return this.a.length; }
}

const gScore = new Float32Array(MAP_W * MAP_H);
const came = new Int32Array(MAP_W * MAP_H);
const stamp = new Uint32Array(MAP_W * MAP_H);
let stampN = 1;

/** A* from a tile to any of the goal tiles. Returns tiles after start (inclusive of goal), or null. */
export function findPath(st: ColonyState, from: [number, number], goals: [number, number][], maxIter = 12000): [number, number][] | null {
  if (!goals.length) return null;
  const [sx, sy] = from;
  if (goals.some(([gx, gy]) => gx === sx && gy === sy)) return [];
  const goalSet = new Set(goals.map(([x, y]) => idx(x, y)));
  const t = terrain(st), occ = occupancy(st), ex = explored(st);
  stampN++;
  const s = idx(sx, sy);
  gScore[s] = 0; came[s] = -1; stamp[s] = stampN;
  const h = (k: number) => { const x = k % MAP_W, y = (k / MAP_W) | 0; let b = 1e9; for (const [gx, gy] of goals) b = Math.min(b, Math.abs(gx - x) + Math.abs(gy - y)); return b * 0.9; };
  const open = new Heap();
  open.push(s, h(s));
  let it = 0, found = -1;
  while (open.size && it++ < maxIter) {
    const k = open.pop();
    if (goalSet.has(k)) { found = k; break; }
    const x = k % MAP_W, y = (k / MAP_W) | 0;
    const gk = gScore[k];
    for (let d = 0; d < 4; d++) {
      const nx = x + (d === 0 ? 1 : d === 1 ? -1 : 0), ny = y + (d === 2 ? 1 : d === 3 ? -1 : 0);
      if (!inMap(nx, ny)) continue;
      const nk = idx(nx, ny);
      const tv = t[nk];
      if (!WALKABLE[tv] || (occ[nk] !== 0 && !goalSet.has(nk))) continue;
      const cost = MOVE_COST[tv] * (ex[nk] ? 1 : 1.25);
      const ng = gk + cost;
      if (stamp[nk] === stampN && gScore[nk] <= ng) continue;
      stamp[nk] = stampN; gScore[nk] = ng; came[nk] = k;
      open.push(nk, ng + h(nk));
    }
  }
  if (found < 0) return null;
  const out: [number, number][] = [];
  let k = found;
  while (k !== s && k >= 0) { out.push([k % MAP_W, (k / MAP_W) | 0]); k = came[k]; }
  out.reverse();
  return out;
}

/** Straight-line route for flying drones (tile waypoints). */
export function flyPath(from: [number, number], to: [number, number]): [number, number][] {
  const out: [number, number][] = [];
  const n = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
  for (let i = 1; i <= n; i++) out.push([Math.round(from[0] + ((to[0] - from[0]) * i) / n), Math.round(from[1] + ((to[1] - from[1]) * i) / n)]);
  return out;
}

export function pathLength(p: [number, number][]) { return p.length; }
