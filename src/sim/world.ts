// Mars map generation: terrain, deposits, the starting outpost layout, and the explored mask.

import { hashNoise } from './rng';
import type { ColonyState } from './state';
import type { DepositKind, ModuleKind } from './defs';

export const MAP_W = 96, MAP_H = 72;
export const MAP_SEED = 2042;
export const BASE_CX = 46, BASE_CY = 33;
export const START_RADIUS = 16;

export enum T { FLAT = 0, ROUGH = 1, ROCK = 2, RIDGE = 3, CRATER = 4, DUNE = 5, ICE = 6, UNSTABLE = 7, PLATE = 8 }
export const T_NAME = ['Flat ground', 'Rough ground', 'Boulders', 'Ridge', 'Crater', 'Dunes', 'Ice sheet', 'Unstable ground', 'Base plating'];
export const WALKABLE = [true, true, false, false, false, true, true, true, true];
export const BUILDABLE = [true, false, false, false, false, false, false, false, true];
export const MOVE_COST = [1, 1.3, 99, 99, 99, 1.4, 1.1, 6, 0.9];

export const idx = (x: number, y: number) => y * MAP_W + x;
export const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;

// ------------------------------------------------------------------ start layout

export interface StartModule { kind: ModuleKind; x: number; y: number }
export const START_MODULES: StartModule[] = [
  { kind: 'command', x: 44, y: 31 },
  { kind: 'core', x: 49, y: 31 },
  { kind: 'habitat', x: 39, y: 31 },
  { kind: 'oxygen', x: 40, y: 35 },
  { kind: 'solar', x: 42, y: 27 },
  { kind: 'solar', x: 45, y: 27 },
  { kind: 'battery', x: 48, y: 27 },
  { kind: 'storage', x: 48, y: 35 },
  { kind: 'workshop', x: 52, y: 35 },
  { kind: 'pad', x: 35, y: 37 },
];
export const PLATE_RECT = { x: 35, y: 25, w: 22, h: 17 };

interface DepoSpec { kind: DepositKind; x: number; y: number; signal?: boolean }
export const DEPOSIT_SPECS: DepoSpec[] = [
  // inside the starting radius
  { kind: 'iron', x: 57, y: 40 },
  { kind: 'ice', x: 31, y: 29 },
  { kind: 'regolith', x: 44, y: 43 },
  { kind: 'regolith', x: 56, y: 22 },
  // titanium signal just beyond the fog, east
  { kind: 'titanium', x: 64, y: 32, signal: true },
  // further out
  { kind: 'titanium', x: 71, y: 50 }, { kind: 'titanium', x: 24, y: 53 }, { kind: 'titanium', x: 79, y: 14 },
  { kind: 'iron', x: 27, y: 41 }, { kind: 'iron', x: 61, y: 59 }, { kind: 'iron', x: 70, y: 25 },
  { kind: 'ice', x: 52, y: 55 }, { kind: 'ice', x: 18, y: 20 }, { kind: 'ice', x: 85, y: 40 },
  { kind: 'regolith', x: 31, y: 48 }, { kind: 'regolith', x: 67, y: 41 }, { kind: 'regolith', x: 39, y: 60 },
  { kind: 'rare', x: 85, y: 26 }, { kind: 'rare', x: 12, y: 59 }, { kind: 'rare', x: 60, y: 7 },
  { kind: 'debris', x: 72, y: 17 }, { kind: 'debris', x: 15, y: 32 }, { kind: 'debris', x: 46, y: 64 },
  { kind: 'vent', x: 82, y: 58 }, { kind: 'vent', x: 9, y: 10 },
];

// ------------------------------------------------------------------ noise

function smooth(x: number, y: number, scale: number, seed: number): number {
  const fx = x / scale, fy = y / scale;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const a = hashNoise(x0, y0, seed), b = hashNoise(x0 + 1, y0, seed), c = hashNoise(x0, y0 + 1, seed), d = hashNoise(x0 + 1, y0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
const fbm = (x: number, y: number, seed: number) => smooth(x, y, 11, seed) * 0.6 + smooth(x, y, 5, seed + 7) * 0.3 + smooth(x, y, 2.5, seed + 13) * 0.1;

// ------------------------------------------------------------------ generation

export interface Craters { x: number; y: number; r: number }
let baseTerrain: Uint8Array | null = null;
export let CRATERS: Craters[] = [];

function distBase(x: number, y: number) { return Math.hypot(x - BASE_CX, y - BASE_CY); }

export function generateTerrain(): Uint8Array {
  if (baseTerrain) return baseTerrain;
  const t = new Uint8Array(MAP_W * MAP_H);
  const S = MAP_SEED;
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      const i = idx(x, y);
      const n = fbm(x, y, S);
      const r = fbm(x, y, S + 100);
      const d = distBase(x, y);
      let v = T.FLAT;
      const edge = Math.min(x, y, MAP_W - 1 - x, MAP_H - 1 - y);
      if (n > 0.66 && d > 13) v = T.ROCK;
      else if (n > 0.57 && d > 11) v = T.ROUGH;
      if (r > 0.7 && d > 12 && v === T.FLAT) v = T.DUNE;
      if (r < 0.2 && d > 14 && v !== T.FLAT) v = T.RIDGE;
      if (edge < 2 && hashNoise(x, y, S + 3) < 0.7) v = T.ROCK;
      if (hashNoise(x, y, S + 9) < 0.035 && v === T.FLAT && d > 9) v = T.ROUGH;
      t[i] = v;
    }
  // craters
  CRATERS = [];
  let k = 0;
  for (let tries = 0; tries < 200 && CRATERS.length < 13; tries++) {
    const cx = 6 + Math.floor(hashNoise(tries, S, 1) * (MAP_W - 12));
    const cy = 6 + Math.floor(hashNoise(tries, S, 2) * (MAP_H - 12));
    const r = 2 + Math.floor(hashNoise(tries, S, 3) * 3);
    if (distBase(cx, cy) < 18) continue;
    if (DEPOSIT_SPECS.some((d) => Math.hypot(d.x - cx, d.y - cy) < r + 5)) continue;
    if (CRATERS.some((c) => Math.hypot(c.x - cx, c.y - cy) < c.r + r + 4)) continue;
    CRATERS.push({ x: cx, y: cy, r });
    for (let y = cy - r - 1; y <= cy + r + 1; y++)
      for (let x = cx - r - 1; x <= cx + r + 1; x++) {
        if (!inMap(x, y)) continue;
        const dd = Math.hypot(x - cx, (y - cy) * 1.15);
        if (dd < r - 0.3) t[idx(x, y)] = T.CRATER;
        else if (dd < r + 1.1) t[idx(x, y)] = T.ROUGH;
      }
    k++;
  }
  // unstable ground patches
  for (let i = 0; i < 5; i++) {
    const cx = 8 + Math.floor(hashNoise(i, S, 21) * (MAP_W - 16)), cy = 8 + Math.floor(hashNoise(i, S, 22) * (MAP_H - 16));
    if (distBase(cx, cy) < 20) continue;
    for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 3; x <= cx + 3; x++) if (inMap(x, y) && hashNoise(x, y, S + 31) < 0.75 && t[idx(x, y)] !== T.CRATER) t[idx(x, y)] = T.UNSTABLE;
  }
  // ice sheets around ice deposits, clearings around all deposits
  for (const d of DEPOSIT_SPECS) {
    for (let y = d.y - 3; y <= d.y + 4; y++)
      for (let x = d.x - 3; x <= d.x + 4; x++) {
        if (!inMap(x, y)) continue;
        const dd = Math.hypot(x - d.x - 0.5, y - d.y - 0.5);
        if (dd < 3.2) t[idx(x, y)] = d.kind === 'ice' && dd < 3.0 && hashNoise(x, y, 77) < 0.85 ? T.ICE : d.kind === 'regolith' && dd < 3 ? T.DUNE : T.FLAT;
      }
  }
  // clear the base area of rough ground
  for (let y = PLATE_RECT.y - 3; y < PLATE_RECT.y + PLATE_RECT.h + 3; y++)
    for (let x = PLATE_RECT.x - 3; x < PLATE_RECT.x + PLATE_RECT.w + 3; x++)
      if (inMap(x, y) && (t[idx(x, y)] === T.ROCK || t[idx(x, y)] === T.RIDGE || t[idx(x, y)] === T.ROUGH || t[idx(x, y)] === T.DUNE)) t[idx(x, y)] = T.FLAT;
  // base plating: aprons around every starting module + two corridors
  for (const m of START_MODULES) {
    const def = { command: [3, 3], core: [2, 2], habitat: [3, 2], oxygen: [2, 2], solar: [2, 2], battery: [2, 2], storage: [2, 2], workshop: [3, 2], pad: [4, 4] }[m.kind as 'command'] ?? [2, 2];
    for (let y = m.y - 1; y <= m.y + def[1]; y++) for (let x = m.x - 1; x <= m.x + def[0]; x++) if (inMap(x, y)) t[idx(x, y)] = T.PLATE;
  }
  for (let x = 37; x <= 55; x++) t[idx(x, 34)] = T.PLATE;
  for (let y = 26; y <= 37; y++) t[idx(47, y)] = T.PLATE;
  // guarantee every deposit is reachable from the base: carve a corridor where needed
  for (const d of DEPOSIT_SPECS) carveIfUnreachable(t, d.x, d.y);
  baseTerrain = t;
  void k;
  return t;
}

function walk(t: Uint8Array, x: number, y: number) { return inMap(x, y) && WALKABLE[t[idx(x, y)]]; }
function carveIfUnreachable(t: Uint8Array, gx: number, gy: number) {
  // BFS from base on walkable terrain
  const seen = new Uint8Array(MAP_W * MAP_H);
  const q = [idx(BASE_CX, BASE_CY + 5)];
  seen[q[0]] = 1;
  for (let h = 0; h < q.length; h++) {
    const k = q[h], x = k % MAP_W, y = (k / MAP_W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!walk(t, nx, ny)) continue;
      const nk = idx(nx, ny);
      if (seen[nk]) continue;
      seen[nk] = 1; q.push(nk);
    }
  }
  const near = [[gx - 1, gy], [gx + 2, gy], [gx, gy - 1], [gx, gy + 2]];
  if (near.some(([x, y]) => inMap(x, y) && seen[idx(x, y)])) return;
  // carve straight-ish line toward base from the deposit
  let x = gx - 1, y = gy;
  for (let s = 0; s < 200; s++) {
    if (inMap(x, y) && seen[idx(x, y)]) break;
    if (inMap(x, y) && !WALKABLE[t[idx(x, y)]]) t[idx(x, y)] = T.ROUGH;
    const dx = BASE_CX - x, dy = BASE_CY + 5 - y;
    if (Math.abs(dx) > Math.abs(dy)) x += Math.sign(dx); else y += Math.sign(dy);
  }
}

/** Live terrain = generated terrain + edits (meteor craters). Cached per state. */
const terrainCache = new WeakMap<ColonyState, { edits: number; t: Uint8Array }>();
export function terrain(st: ColonyState): Uint8Array {
  const n = Object.keys(st.terrainEdits).length;
  const c = terrainCache.get(st);
  if (c && c.edits === n) return c.t;
  const t = generateTerrain().slice();
  for (const [k, v] of Object.entries(st.terrainEdits)) t[+k] = v;
  terrainCache.set(st, { edits: n, t });
  return t;
}

// ------------------------------------------------------------------ explored mask

const exploredCache = new WeakMap<ColonyState, Uint8Array>();
export function explored(st: ColonyState): Uint8Array {
  let e = exploredCache.get(st);
  if (e) return e;
  e = decodeMask(st.explored);
  exploredCache.set(st, e);
  return e;
}
export let exploredVersion = 0;
/** Reveal a disc; returns number of newly revealed tiles. Marks deposits found. */
export function reveal(st: ColonyState, cx: number, cy: number, r: number): number {
  const e = explored(st);
  let n = 0;
  const r2 = r * r;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (!inMap(x, y)) continue;
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > r2) continue;
      const i = idx(x, y);
      if (!e[i]) { e[i] = 1; n++; }
    }
  if (n) {
    exploredVersion++;
    for (const d of st.deposits) if (!d.found && e[idx(d.x, d.y)] && e[idx(d.x + 1, d.y + 1)]) d.found = true;
  }
  return n;
}
export function isExplored(st: ColonyState, x: number, y: number) { return inMap(x, y) && explored(st)[idx(x, y)] === 1; }
export function syncExplored(st: ColonyState) { st.explored = encodeMask(explored(st)); }
export function exploredPct(st: ColonyState) { const e = explored(st); let n = 0; for (let i = 0; i < e.length; i++) n += e[i]; return n / e.length; }

export function encodeMask(m: Uint8Array): string {
  const out: string[] = [];
  let cur = m[0], run = 0;
  for (let i = 0; i < m.length; i++) {
    if (m[i] === cur) run++;
    else { out.push(`${cur}${run}`); cur = m[i]; run = 1; }
  }
  out.push(`${cur}${run}`);
  return out.join(',');
}
export function decodeMask(s: string): Uint8Array {
  const m = new Uint8Array(MAP_W * MAP_H);
  if (!s) return m;
  let i = 0;
  for (const part of s.split(',')) {
    const v = part[0] === '1' ? 1 : 0, n = parseInt(part.slice(1), 10) || 0;
    if (v) m.fill(1, i, Math.min(m.length, i + n));
    i += n;
  }
  return m;
}

export function directionVector(dir: string): [number, number] {
  switch (dir) { case 'north': return [0, -1]; case 'south': return [0, 1]; case 'east': return [1, 0]; case 'west': return [-1, 0]; default: return [1, 0]; }
}
export function directionOf(x: number, y: number): string {
  const dx = x - BASE_CX, dy = y - BASE_CY;
  const ang = Math.atan2(dy, dx) * 180 / Math.PI;
  const dirs = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
  return dirs[(Math.round(ang / 45) + 8) % 8];
}
