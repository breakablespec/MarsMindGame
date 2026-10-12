// Static ground: the whole Mars map pre-rendered once (and again only when a meteor edits it),
// plus the fog-of-war layer.

import { hashNoise } from '../sim/rng';
import { CRATERS, MAP_H, MAP_W, T, idx, inMap } from '../sim/world';
import type { ColonyState } from '../sim/state';
import { canvas, disc, ellipse, hexToRgb, rect } from './pix';
import { C } from './palette';

const TS = 16;
const rgb = (h: string) => hexToRgb(h);

const P = {
  mars: C.mars.map(rgb), dust: C.dust.map(rgb), ti: C.ti.map(rgb), ice: C.ice.map(rgb),
};

function smoothN(x: number, y: number, s: number, seed: number) {
  const fx = x / s, fy = y / s, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const a = hashNoise(x0, y0, seed), b = hashNoise(x0 + 1, y0, seed), c = hashNoise(x0, y0 + 1, seed), d = hashNoise(x0 + 1, y0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Pixel colour for natural ground types. */
let BIG: Float32Array | null = null;
const BW = (MAP_W * TS) / 2;
function bigAt(px: number, py: number) {
  if (!BIG) {
    BIG = new Float32Array(BW * ((MAP_H * TS) / 2));
    for (let y = 0; y < (MAP_H * TS) / 2; y++) for (let x = 0; x < BW; x++) BIG[y * BW + x] = smoothN(x * 2, y * 2, 40, 11) * 0.6 + smoothN(x * 2, y * 2, 13, 12) * 0.4;
  }
  return BIG[(py >> 1) * BW + (px >> 1)];
}
function groundPixel(t: number, px: number, py: number): [number, number, number] {
  const h = hashNoise(px, py, 5);
  const big = bigAt(px, py);
  switch (t) {
    case T.DUNE: {
      const band = Math.sin(px * 0.16 + py * 0.42 + big * 9);
      if (band > 0.75) return P.mars[7];
      if (band > 0.2) return P.mars[6];
      if (band < -0.85) return P.mars[4];
      return h < 0.05 ? P.mars[4] : P.mars[5];
    }
    case T.ICE: {
      const cell = Math.floor((px + Math.floor(smoothN(px, py, 7, 3) * 6)) / 7) * 31 + Math.floor((py + Math.floor(smoothN(px, py, 7, 4) * 6)) / 6);
      const cx = (px + Math.floor(smoothN(px, py, 7, 3) * 6)) % 7, cy = (py + Math.floor(smoothN(px, py, 7, 4) * 6)) % 6;
      if (cx === 0 || cy === 0) return P.ice[1];
      if (h > 0.985) return [255, 255, 255];
      return hashNoise(cell, 9) > 0.55 ? P.ice[3] : P.ice[2];
    }
    case T.UNSTABLE: {
      const crack = Math.abs(Math.sin(px * 0.23 + Math.sin(py * 0.31) * 2.2)) < 0.07 || Math.abs(Math.sin(py * 0.27 + Math.sin(px * 0.19) * 2)) < 0.06;
      if (crack) return P.dust[0];
      return h < 0.1 ? P.dust[2] : big > 0.55 ? P.mars[3] : P.mars[2];
    }
    case T.ROUGH: case T.FLAT: default: {
      let base = big > 0.62 ? P.mars[5] : big > 0.42 ? P.mars[4] : big > 0.3 ? P.mars[3] : P.mars[3];
      if (t === T.ROUGH) base = big > 0.55 ? P.mars[4] : P.mars[3];
      const ripple = Math.sin(px * 0.31 + py * 0.83 + big * 7);
      if (ripple > 0.96) return P.mars[6];
      if (ripple < -0.97) return P.mars[2];
      if (h < 0.035) return P.mars[2];
      if (h > 0.975) return P.mars[6];
      return base;
    }
  }
}

let groundCv: HTMLCanvasElement | null = null;
const applied = new Set<number>();

function paintRegion(c: CanvasRenderingContext2D, terr: Uint8Array, tx0: number, ty0: number, tx1: number, ty1: number) {
  tx0 = Math.max(0, tx0); ty0 = Math.max(0, ty0); tx1 = Math.min(MAP_W - 1, tx1); ty1 = Math.min(MAP_H - 1, ty1);
  const W = (tx1 - tx0 + 1) * TS, H = (ty1 - ty0 + 1) * TS;
  const img = c.createImageData(W, H);
  const d = img.data;
  const tAt = (x: number, y: number) => (inMap(x, y) ? terr[idx(x, y)] : T.ROCK);
  for (let ly = 0; ly < H; ly++)
    for (let lx = 0; lx < W; lx++) {
      const px = tx0 * TS + lx, py = ty0 * TS + ly;
      const tx = (px / TS) | 0, ty = (py / TS) | 0;
      let t = tAt(tx, ty);
      if (t !== T.PLATE && t !== T.ROCK && t !== T.RIDGE && t !== T.CRATER) {
        const jx = Math.floor(hashNoise(px, py, 71) * 7) - 3, jy = Math.floor(hashNoise(px, py, 72) * 7) - 3;
        const t2 = tAt(((px + jx) / TS) | 0, ((py + jy) / TS) | 0);
        if (t2 !== T.PLATE && t2 !== T.ROCK && t2 !== T.RIDGE && t2 !== T.CRATER) t = t2;
      }
      let col: [number, number, number];
      if (t === T.PLATE) {
        const qx = px % TS, qy = py % TS;
        const alt = ((tx + ty) % 2 === 0);
        if (qx === 0 || qy === 0) col = P.ti[1];
        else if (qx === 1 || qy === 1) col = P.ti[4];
        else if ((qx === 3 || qx === 13) && (qy === 3 || qy === 13)) col = P.ti[2];
        else if (hashNoise(tx, ty, 61) < 0.18 && qy % 3 === 0 && qx > 2 && qx < 14) col = P.ti[2];
        else col = alt ? P.ti[3] : [146, 155, 173];
        if (hashNoise(px, py, 33) < 0.03) col = P.ti[2];
      } else if (t === T.ROCK || t === T.RIDGE) {
        col = hashNoise(px, py, 8) < 0.1 ? P.dust[1] : P.dust[2];
      } else if (t === T.CRATER) {
        col = P.mars[2];
      } else col = groundPixel(t, px, py);
      const o = (ly * W + lx) * 4;
      d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
    }
  c.putImageData(img, tx0 * TS, ty0 * TS);
  for (let ty = ty0; ty <= ty1; ty++)
    for (let tx = tx0; tx <= tx1; tx++) {
      const t = terr[idx(tx, ty)];
      const x = tx * TS, y = ty * TS;
      if (t === T.ROUGH) { const n = 2 + Math.floor(hashNoise(tx, ty, 41) * 3); for (let k = 0; k < n; k++) pebble(c, x + 2 + hashNoise(tx, ty, 50 + k) * 12, y + 2 + hashNoise(tx, ty, 60 + k) * 12, k); }
      else if (t === T.FLAT && hashNoise(tx, ty, 43) < 0.06) pebble(c, x + 4 + hashNoise(tx, ty, 44) * 8, y + 4 + hashNoise(tx, ty, 45) * 8, 0);
      if (t === T.PLATE) {
        const edge = (dx: number, dy: number) => tAt(tx + dx, ty + dy) !== T.PLATE;
        const stripe = (sx: number, sy: number, w: number, h: number) => { rect(c, sx, sy, w, h, C.yellow); for (let k = 0; k < Math.max(w, h); k += 4) rect(c, w > h ? sx + k : sx, w > h ? sy : sy + k, w > h ? 2 : w, w > h ? h : 2, C.ink); };
        if (edge(0, -1)) stripe(x, y, TS, 2);
        if (edge(0, 1)) { stripe(x, y + 14, TS, 2); rect(c, x, y + 16, TS, 2, 'rgba(60,20,10,0.35)'); }
        if (edge(-1, 0)) stripe(x, y, 2, TS);
        if (edge(1, 0)) stripe(x + 14, y, 2, TS);
      }
    }
}

/** Full-map ground layer; later terrain edits (base aprons, meteor scars) repaint only their tiles. */
export function groundLayer(st: ColonyState, terr: Uint8Array): HTMLCanvasElement {
  if (groundCv) {
    for (const k of Object.keys(st.terrainEdits)) {
      const i = +k;
      if (applied.has(i)) continue;
      applied.add(i);
      const tx = i % MAP_W, ty = (i / MAP_W) | 0;
      paintRegion(groundCv.getContext('2d')!, terr, tx - 1, ty - 1, tx + 1, ty + 1);
    }
    return groundCv;
  }
  const W = MAP_W * TS, H = MAP_H * TS;
  const [cv, c] = canvas(W, H);
  for (const k of Object.keys(st.terrainEdits)) applied.add(+k);
  const tAt = (x: number, y: number) => (inMap(x, y) ? terr[idx(x, y)] : T.ROCK);
  paintRegion(c, terr, 0, 0, MAP_W - 1, MAP_H - 1);
  // craters: bowl shading + rim
  for (const cr of CRATERS) {
    const cx = cr.x * TS + 8, cy = cr.y * TS + 8, r = cr.r * TS;
    ellipse(c, cx, cy + 3, r + 10, (r + 10) * 0.86, C.mars[5]);
    ellipse(c, cx, cy, r + 4, (r + 4) * 0.86, C.mars[6]);
    ellipse(c, cx, cy + 2, r, r * 0.86, C.mars[2]);
    ellipse(c, cx, cy - 2, r - 3, (r - 3) * 0.8, C.dust[1]);
    ellipse(c, cx + 2, cy + 3, r - 6, (r - 6) * 0.78, C.mars[1]);
    ellipse(c, cx + 4, cy + 6, (r - 6) * 0.5, (r - 6) * 0.35, C.mars[3]);
    for (let k = 0; k < 5; k++) { const a = hashNoise(cr.x, k, 3) * Math.PI * 2; rock(c, cx + Math.cos(a) * (r + 8), cy + Math.sin(a) * (r + 6), 2 + Math.floor(hashNoise(k, cr.y, 4) * 3), k); }
  }
  // boulders and ridges (with shadows), drawn top to bottom
  for (let ty = 0; ty < MAP_H; ty++)
    for (let tx = 0; tx < MAP_W; tx++) {
      const t = terr[idx(tx, ty)];
      const x = tx * TS, y = ty * TS;
      if (t === T.RIDGE) {
        rect(c, x, y, TS, TS, C.dust[3]);
        if (hashNoise(tx, ty, 2) < 0.3) rect(c, x + 3, y + 4, 6, 3, C.dust[4]);
        if (tAt(tx, ty - 1) !== T.RIDGE) rect(c, x, y, TS, 2, C.mars[3]);
        if (tAt(tx, ty + 1) !== T.RIDGE) { rect(c, x, y + 10, TS, 6, C.dust[1]); for (let k = 0; k < 4; k++) rect(c, x + 2 + k * 4, y + 11, 1, 5, C.dust[0]); rect(c, x, y + 16, TS, 3, 'rgba(40,10,10,0.35)'); }
      } else if (t === T.ROCK) {
        const n = hashNoise(tx, ty, 17);
        rock(c, x + 8 + (n - 0.5) * 4, y + 9, 6 + Math.floor(n * 3), tx * 7 + ty);
        if (hashNoise(tx, ty, 18) < 0.5) rock(c, x + 3 + hashNoise(tx, ty, 19) * 10, y + 3 + hashNoise(tx, ty, 20) * 6, 2 + Math.floor(hashNoise(tx, ty, 21) * 2), tx + ty);
      }
    }
  groundCv = cv;
  return cv;
}

function pebble(c: CanvasRenderingContext2D, x: number, y: number, k: number) {
  const s = 1 + (k % 2);
  rect(c, x, y + 1, s + 1, s, C.dust[1]);
  rect(c, x, y, s + 1, s, C.dust[3]);
  rect(c, x, y, 1, 1, C.mars[6]);
}
export function rock(c: CanvasRenderingContext2D, x: number, y: number, r: number, seed: number) {
  ellipse(c, x + 1, y + r * 0.6, r + 1, r * 0.45, 'rgba(50,14,10,0.45)');
  ellipse(c, x, y, r + 1, r * 0.82 + 1, C.ink);
  ellipse(c, x, y, r, r * 0.82, C.dust[2]);
  ellipse(c, x - r * 0.2, y - r * 0.25, r * 0.7, r * 0.5, C.dust[3]);
  ellipse(c, x - r * 0.35, y - r * 0.4, r * 0.35, r * 0.25, C.dust[4]);
  if (hashNoise(seed, 3) < 0.5) rect(c, x + r * 0.2, y, 1, Math.max(1, r * 0.4), C.dust[1]);
}

// ------------------------------------------------------------------ fog of war

let fogCv: HTMLCanvasElement | null = null;
let fogVer = -1;
export function fogLayer(ex: Uint8Array, ver: number): HTMLCanvasElement {
  if (fogCv && fogVer === ver) return fogCv;
  fogVer = ver;
  const W = MAP_W * TS, H = MAP_H * TS;
  if (!fogCv) fogCv = canvas(W, H)[0];
  const c = fogCv.getContext('2d')!;
  c.clearRect(0, 0, W, H);
  const known = (x: number, y: number) => !inMap(x, y) || ex[idx(x, y)] === 1;
  for (let ty = 0; ty < MAP_H; ty++)
    for (let tx = 0; tx < MAP_W; tx++) {
      if (ex[idx(tx, ty)]) continue;
      const x = tx * TS, y = ty * TS;
      // fully unknown tile
      const edge = known(tx - 1, ty) || known(tx + 1, ty) || known(tx, ty - 1) || known(tx, ty + 1);
      c.fillStyle = '#0b0810';
      if (!edge) { c.fillRect(x, y, TS, TS); if ((tx + ty) % 4 === 0) { c.fillStyle = '#1c1426'; c.fillRect(x + 8, y + 8, 1, 1); } continue; }
      // dithered fringe
      for (let py = 0; py < TS; py += 2)
        for (let px = 0; px < TS; px += 2) {
          const dl = known(tx - 1, ty) ? px : 99, dr = known(tx + 1, ty) ? TS - px : 99, du = known(tx, ty - 1) ? py : 99, dd = known(tx, ty + 1) ? TS - py : 99;
          const dist = Math.min(dl, dr, du, dd);
          const keep = dist / 10 + (hashNoise(x + px, y + py, 9) - 0.5) * 0.5;
          if (keep > 0.35) c.fillRect(x + px, y + py, 2, 2);
        }
    }
  return fogCv;
}

export { disc };
