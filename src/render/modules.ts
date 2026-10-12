// Module sprites (3/4 top-down, chunky, outlined) + construction stages.

import { MODULES, ModuleKind } from '../sim/defs';
import { canvas, disc, ellipse, outline, px, rect } from './pix';
import { C } from './palette';

export interface Light { x: number; y: number; r: number; col: string }
export interface Sprite { cv: HTMLCanvasElement; up: number; lights: Light[]; w: number; h: number }
type Ctx = CanvasRenderingContext2D;

export const UP: Record<ModuleKind, number> = { command: 14, core: 26, habitat: 10, oxygen: 18, solar: 6, battery: 10, storage: 10, workshop: 14, lab: 16, robotbay: 12, outpost: 22, comm: 38, medical: 10, wind: 30, greenhouse: 10, reactor: 16, geo: 18, pad: 0 };

/** A 3/4 box: top face then front face, with highlight and seam. */
function box(c: Ctx, x: number, y: number, w: number, topH: number, frontH: number, top: [string, string, string], front: [string, string, string]) {
  rect(c, x, y, w, topH, top[1]);
  rect(c, x, y, w, 2, top[2]);
  rect(c, x, y, 1, topH, top[2]);
  rect(c, x + w - 1, y, 1, topH, top[0]);
  rect(c, x, y + topH, w, frontH, front[1]);
  rect(c, x, y + topH, w, 1, front[2]);
  rect(c, x, y + topH + frontH - 2, w, 2, front[0]);
  rect(c, x + w - 2, y + topH, 2, frontH, front[0]);
}
function win(c: Ctx, x: number, y: number, w: number, h: number, lights: Light[], col = C.cyanL) {
  rect(c, x - 1, y - 1, w + 2, h + 2, C.ink);
  rect(c, x, y, w, h, '#1b2a44');
  rect(c, x, y, w, 1, '#2c4a70');
  px(c, x + 1, y + 1, col);
  if (w > 3) px(c, x + 2, y + 1, '#6fd7ff');
  lights.push({ x: x + w / 2, y: y + h / 2, r: 10, col: '#ffe9a8' });
}
function hazard(c: Ctx, x: number, y: number, w: number, h: number) {
  rect(c, x, y, w, h, C.yellow);
  for (let k = -h; k < w; k += 4) for (let j = 0; j < h; j++) { const xx = x + k + j; if (xx >= x && xx < x + w) { rect(c, xx, y + j, 2, 1, C.ink); } }
}
function rivets(c: Ctx, x: number, y: number, w: number, step: number, col: string) { for (let k = 2; k < w - 1; k += step) px(c, x + k, y, col); }

const TOP_CREAM: [string, string, string] = [C.cream[1], C.cream[3], C.cream[4]];
const FRONT_CREAM: [string, string, string] = [C.cream[0], C.cream[1], C.cream[2]];
const TOP_TI: [string, string, string] = [C.ti[2], C.ti[4], C.ti[5]];
const FRONT_TI: [string, string, string] = [C.ti[0], C.ti[2], C.ti[3]];
const TOP_DARK: [string, string, string] = [C.ti[0], C.ti[1], C.ti[2]];
const FRONT_DARK: [string, string, string] = ['#1e2230', C.ti[0], C.ti[1]];

const cache = new Map<string, Sprite>();
export function moduleSprite(kind: ModuleKind): Sprite {
  const hit = cache.get(kind);
  if (hit) return hit;
  const def = MODULES[kind];
  const up = UP[kind];
  const W = def.w * 16 + 2, H = def.h * 16 + up + 2;
  const [cv, c] = canvas(W, H);
  const L: Light[] = [];
  const fy = up + 1;           // footprint top
  const fb = H - 1;            // footprint bottom
  switch (kind) {
    case 'command': {
      rect(c, 2, fb - 6, W - 4, 5, C.ti[1]);
      box(c, 3, 6, W - 6, 34, 18, TOP_CREAM, FRONT_CREAM);
      for (let x = 11; x < W - 6; x += 9) rect(c, x, 8, 1, 31, C.cream[2]);
      rect(c, 3, 22, W - 6, 1, C.cream[2]);
      rect(c, 3, 42, W - 6, 4, C.orange); rect(c, 3, 42, W - 6, 1, C.orangeL); rect(c, 3, 45, W - 6, 1, C.orangeD);
      for (const x of [7, 14, 33, 40]) win(c, x, 49, 4, 4, L);
      rect(c, 20, 47, 10, 11, C.yellow); rect(c, 21, 48, 8, 10, C.ti[2]); rect(c, 24, 48, 1, 10, C.ti[1]); rect(c, 21, 48, 8, 1, C.ti[4]);
      // roof: dome, vents, dish
      disc(c, 25, 24, 9, C.ti[2]); disc(c, 25, 23, 8, C.cream[4]); disc(c, 23, 21, 3, '#ffffff'); disc(c, 25, 23, 4, '#cfe9ff'); disc(c, 24, 22, 2, '#ffffff');
      L.push({ x: 25, y: 23, r: 14, col: '#bff6ff' });
      rect(c, 7, 11, 8, 6, C.ti[2]); rect(c, 7, 11, 8, 2, C.ti[4]); rect(c, 8, 14, 6, 1, C.ti[0]);
      rect(c, 7, 27, 6, 6, C.ti[3]); rect(c, 8, 28, 4, 1, C.ti[1]); rect(c, 8, 30, 4, 1, C.ti[1]);
      rect(c, 39, 6, 2, 12, C.ti[1]);
      ellipse(c, 40, 6, 7, 4, '#ffffff'); ellipse(c, 40, 6, 5, 2.5, C.ti[5]); px(c, 40, 6, C.red);
      rect(c, 4, 1, 1, 6, C.ti[1]); px(c, 4, 0, C.red);
      L.push({ x: 4, y: 0, r: 6, col: '#ff5a5a' });
      break;
    }
    case 'core': {
      ellipse(c, W / 2, fb - 4, 15, 5, C.ti[1]);
      rect(c, 4, fb - 10, W - 8, 8, C.ti[1]); rect(c, 4, fb - 10, W - 8, 2, C.ti[3]);
      // tower
      rect(c, 8, 6, W - 16, fb - 14, C.ink); rect(c, 8, 6, 2, fb - 14, C.inkSoft); rect(c, W - 10, 6, 2, fb - 14, '#05030a');
      rect(c, 9, 6, W - 18, 3, '#3a3050');
      for (let y = 22; y < fb - 12; y += 4) { rect(c, 12, y, 2, 2, C.greenDD); rect(c, W - 14, y, 2, 2, C.greenDD); }
      // eye ring (static part; glow pulses in overlay)
      disc(c, W / 2, 15, 6, C.greenDD); disc(c, W / 2, 15, 4, C.ink); disc(c, W / 2, 15, 2, C.greenD);
      rect(c, W / 2, 0, 1, 6, C.ti[2]); px(c, W / 2, 0, C.green);
      L.push({ x: W / 2, y: 15, r: 22, col: '#4dff7a' });
      break;
    }
    case 'habitat': {
      rect(c, 2, fb - 5, W - 4, 4, C.ti[1]);
      // capsule hull
      const y0 = 4, th = 24, fh = 13;
      box(c, 6, y0, W - 12, th, fh, TOP_CREAM, FRONT_CREAM);
      ellipse(c, 6, y0 + th / 2 + 3, 5, th / 2 + 2, C.cream[2]); ellipse(c, W - 7, y0 + th / 2 + 3, 5, th / 2 + 2, C.cream[1]);
      rect(c, 6, y0 + 4, W - 12, 1, C.cream[2]); rect(c, 6, y0 + 16, W - 12, 1, C.cream[2]);
      for (let x = 14; x < W - 10; x += 10) rect(c, x, y0 + 2, 1, th - 2, C.cream[2]);
      rect(c, 6, y0 + th + 3, W - 12, 2, C.orange);
      for (const x of [11, 20, 29]) { disc(c, x + 1, y0 + th + 8, 2.5, C.ink); disc(c, x + 1, y0 + th + 8, 1.5, '#2c4a70'); px(c, x, y0 + th + 7, C.cyanL); L.push({ x: x + 1, y: y0 + th + 8, r: 10, col: '#ffe9a8' }); }
      // airlock pod
      rect(c, W - 13, y0 + th - 2, 10, fh + 4, C.ti[3]); rect(c, W - 13, y0 + th - 2, 10, 2, C.ti[5]); rect(c, W - 11, y0 + th + 3, 6, fh - 3, C.ti[1]); rect(c, W - 11, y0 + th + 3, 6, 1, C.yellow);
      break;
    }
    case 'oxygen': {
      rect(c, 2, fb - 7, W - 4, 6, C.ti[1]); rect(c, 2, fb - 7, W - 4, 2, C.ti[3]);
      for (const tx of [4, 18]) {
        rect(c, tx, 8, 11, fb - 16, C.cyan); rect(c, tx, 8, 2, fb - 16, C.cyanL); rect(c, tx + 8, 8, 3, fb - 16, C.cyanD);
        ellipse(c, tx + 5, 8, 5, 2, C.cyanL); ellipse(c, tx + 5, 8, 3, 1, '#ffffff');
        rect(c, tx + 3, 13, 5, 14, C.cyanDD); rect(c, tx + 4, 14, 3, 12, '#0a3a44');
        rect(c, tx, 30, 11, 1, C.cyanD);
      }
      rect(c, 15, 16, 3, 2, C.ti[3]); rect(c, 15, 24, 3, 2, C.ti[3]);
      // ice hopper box in front
      rect(c, 9, fb - 12, 14, 8, C.ti[2]); rect(c, 9, fb - 12, 14, 2, C.ti[4]); rect(c, 10, fb - 9, 12, 4, C.ti[0]);
      L.push({ x: 9, y: 20, r: 12, col: '#7af8ff' }, { x: 23, y: 20, r: 12, col: '#7af8ff' });
      break;
    }
    case 'solar': {
      for (const [y0, x0] of [[3, 1], [15, 1]] as [number, number][]) {
        rect(c, x0 + 6, y0 + 11, 2, 6, C.ti[1]); rect(c, W - 9, y0 + 11, 2, 6, C.ti[1]);
        rect(c, x0 + 1, y0, W - 4, 12, C.yellowD); rect(c, x0 + 1, y0, W - 4, 1, C.yellowL); rect(c, x0 + 2, y0 + 1, W - 6, 10, '#1b2a5a');
        for (let x = x0 + 2; x < W - 4; x += 4) for (let y = y0 + 1; y < y0 + 11; y += 3) { rect(c, x, y, 3, 2, (x + y) % 2 ? '#26407a' : '#22396f'); px(c, x, y, '#3f62a8'); }
        rect(c, x0 + 1, y0 + 11, W - 4, 1, C.yellow);
      }
      break;
    }
    case 'battery': {
      rect(c, 2, fb - 4, W - 4, 3, C.ti[1]);
      for (let k = 0; k < 3; k++) {
        const x = 3 + k * 9;
        box(c, x, 4, 8, 12, 14, TOP_DARK, FRONT_DARK);
        rect(c, x + 2, 6, 4, 1, C.ti[0]); rect(c, x + 2, 8, 4, 1, C.ti[0]);
        rect(c, x + 2, 19, 4, 8, '#14101c');
      }
      hazard(c, 3, fb - 6, W - 6, 2);
      // bolt icon
      rect(c, 14, 6, 2, 2, C.yellow); rect(c, 13, 8, 2, 2, C.yellow); rect(c, 14, 10, 3, 1, C.yellow);
      break;
    }
    case 'storage': {
      rect(c, 2, fb - 4, W - 4, 3, C.ti[1]);
      box(c, 2, 5, W - 4, 16, 14, TOP_TI, FRONT_TI);
      rect(c, 5, 8, W - 10, 11, C.ti[1]); rect(c, 5, 8, W - 10, 1, C.ti[0]);
      for (let x = 4; x < W - 4; x += 3) rect(c, x, 23, 1, 10, C.ti[1]);
      rect(c, 2, 27, W - 4, 2, C.orange);
      break;
    }
    case 'workshop': {
      rect(c, 2, fb - 4, W - 4, 3, C.ti[1]);
      // saw-tooth roof
      const y0 = 5;
      for (let k = 0; k < 4; k++) {
        const x = 3 + k * 11;
        for (let j = 0; j < 9; j++) rect(c, x + j, y0 + 9 - j, 11 - j, 1, j < 2 ? C.orangeL : C.orange);
        rect(c, x, y0 + 1, 2, 9, C.cyanD); rect(c, x, y0 + 1, 1, 9, C.cyanL);
        rect(c, x, y0 + 10, 11, 8, C.ti[3]);
      }
      rect(c, 3, y0 + 18, W - 6, 15, C.ti[2]); rect(c, 3, y0 + 18, W - 6, 1, C.ti[4]);
      rect(c, 3, fb - 6, W - 6, 2, C.ti[0]);
      // roll door
      rect(c, 8, y0 + 21, 16, 12, C.yellow); for (let y = y0 + 22; y < y0 + 33; y += 2) rect(c, 9, y, 14, 1, C.yellowD);
      win(c, 30, y0 + 22, 5, 4, L); win(c, 39, y0 + 22, 5, 4, L);
      // stack
      rect(c, W - 10, 0, 5, 10, C.ti[1]); rect(c, W - 10, 0, 5, 2, C.ti[3]);
      break;
    }
    case 'lab': {
      rect(c, 2, fb - 4, W - 4, 3, C.ti[1]);
      box(c, 3, 8, W - 6, 20, 14, [C.ti[4], C.ti[6], '#ffffff'], [C.ti[3], C.ti[5], C.ti[6]]);
      rect(c, 3, 30, W - 6, 3, C.ice[1]); rect(c, 3, 30, W - 6, 1, C.ice[2]);
      for (const x of [7, 15, 31, 39]) win(c, x, 35, 4, 3, L, C.ice[3]);
      rect(c, 21, 33, 7, 9, C.ti[2]); rect(c, 21, 33, 7, 1, C.ice[1]);
      // dome
      disc(c, 20, 15, 8, C.ti[3]); disc(c, 20, 14, 7, C.ice[2]); disc(c, 18, 12, 3, C.ice[4]); disc(c, 20, 14, 3, C.ice[1]);
      L.push({ x: 20, y: 14, r: 14, col: '#8fd4ff' });
      rect(c, 37, 6, 2, 8, C.ti[2]); ellipse(c, 38, 5, 5, 3, '#ffffff'); ellipse(c, 38, 5, 3, 1.5, C.ti[4]);
      break;
    }
    case 'robotbay': {
      rect(c, 2, fb - 4, W - 4, 3, C.ti[1]);
      box(c, 3, 4, W - 6, 16, 16, [C.orangeD, C.orange, C.orangeL], [C.ti[1], C.ti[3], C.ti[4]]);
      for (let x = 8; x < W - 6; x += 8) rect(c, x, 6, 4, 4, C.ti[3]);
      // doors
      for (const dx of [6, 26]) { rect(c, dx, 22, 16, 11, C.ink); rect(c, dx + 1, 22, 14, 10, C.ti[2]); for (let y = 23; y < 32; y += 2) rect(c, dx + 1, y, 14, 1, C.ti[1]); hazard(c, dx, 21, 16, 2); }
      rect(c, 3, 20, W - 6, 1, C.orangeD);
      px(c, 5, 6, C.yellow); px(c, W - 6, 6, C.yellow);
      L.push({ x: 14, y: 26, r: 10, col: '#ffcf7a' }, { x: 34, y: 26, r: 10, col: '#ffcf7a' });
      break;
    }
    case 'outpost': {
      rect(c, 2, fb - 6, W - 4, 5, C.ti[0]); rect(c, 2, fb - 6, W - 4, 1, C.ti[2]);
      // gantry lattice
      rect(c, 6, 4, 2, fb - 10, C.ti[1]); rect(c, W - 9, 4, 2, fb - 10, C.ti[1]);
      for (let y = 6; y < fb - 8; y += 6) { for (let k = 0; k < 6; k++) { px(c, 8 + k * 3, y + k, C.ti[2]); px(c, W - 10 - k * 3, y + k, C.ti[2]); } rect(c, 6, y, W - 13, 1, C.ti[1]); }
      rect(c, 4, 2, W - 8, 4, C.ink); rect(c, 4, 2, W - 8, 1, C.ti[1]);
      // drill + hopper
      rect(c, 14, 10, 5, fb - 18, C.ti[2]); rect(c, 15, fb - 10, 3, 5, C.ti[4]);
      box(c, 3, fb - 16, 10, 4, 8, TOP_DARK, FRONT_DARK);
      // mini solar
      rect(c, W - 13, fb - 16, 10, 6, C.yellowD); rect(c, W - 12, fb - 15, 8, 4, '#1b2a5a');
      px(c, W / 2, 0, C.red); rect(c, W / 2 - 1, 1, 3, 2, C.ti[1]);
      L.push({ x: W / 2, y: 0, r: 8, col: '#ff5a5a' });
      break;
    }
    case 'comm': {
      ellipse(c, W / 2, fb - 4, 12, 4, C.ti[1]);
      rect(c, 6, fb - 8, W - 12, 5, C.ti[2]); rect(c, 6, fb - 8, W - 12, 1, C.ti[4]);
      // lattice mast
      const top = 2, bot = fb - 8;
      for (let y = top; y < bot; y++) { const t = (y - top) / (bot - top); const half = 2 + t * 6; px(c, W / 2 - half, y, C.ti[1]); px(c, W / 2 + half, y, C.ti[1]); if ((y - top) % 5 === 0) rect(c, W / 2 - half, y, half * 2 + 1, 1, C.ti[2]); if ((y - top) % 5 === 2) { px(c, W / 2 - half / 2, y, C.ti[3]); px(c, W / 2 + half / 2, y, C.ti[3]); } }
      ellipse(c, W / 2 + 6, 18, 6, 4, '#ffffff'); ellipse(c, W / 2 + 6, 18, 4, 2, C.ti[4]); px(c, W / 2 + 6, 18, C.ti[1]);
      px(c, W / 2, 0, C.red); px(c, W / 2, 1, C.redD);
      L.push({ x: W / 2, y: 0, r: 8, col: '#ff5a5a' });
      break;
    }
    case 'medical': {
      rect(c, 2, fb - 4, W - 4, 3, C.ti[1]);
      box(c, 3, 4, W - 6, 16, 14, [C.ti[4], '#ffffff', '#ffffff'], [C.ti[3], C.ti[5], C.ti[6]]);
      rect(c, 13, 7, 6, 12, C.cyan); rect(c, 10, 10, 12, 6, C.cyan); rect(c, 13, 7, 6, 1, C.cyanL);
      rect(c, 3, 22, W - 6, 2, C.red);
      win(c, 7, 26, 4, 3, L); win(c, 21, 26, 4, 3, L);
      break;
    }
    case 'wind': {
      ellipse(c, W / 2, fb - 4, 10, 4, C.ti[1]);
      rect(c, W / 2 - 1, 8, 3, fb - 12, C.ti[4]); rect(c, W / 2 + 1, 8, 1, fb - 12, C.ti[2]);
      rect(c, W / 2 - 3, 6, 7, 5, C.ti[5]); rect(c, W / 2 - 3, 10, 7, 1, C.ti[2]);
      break;
    }
    case 'greenhouse': {
      rect(c, 2, fb - 4, W - 4, 3, C.ti[1]);
      rect(c, 3, 5, W - 6, 28, 'rgba(196,236,255,0.55)');
      for (let k = 0; k < 7; k++) { const x = 7 + k * 6; rect(c, x, 14 + (k % 2) * 3, 4, 12, '#2f8a3a'); disc(c, x + 2, 13 + (k % 2) * 3, 3, '#5bd35a'); px(c, x + 1, 12 + (k % 2) * 3, '#b8f59a'); }
      for (let x = 3; x < W - 3; x += 8) rect(c, x, 5, 1, 28, C.ti[4]);
      rect(c, 3, 5, W - 6, 1, '#ffffff'); rect(c, 3, 18, W - 6, 1, C.ti[4]);
      rect(c, 3, 33, W - 6, 2, C.ti[2]);
      L.push({ x: W / 2, y: 18, r: 18, col: '#b8f59a' });
      break;
    }
    case 'reactor': {
      ellipse(c, W / 2, fb - 10, 24, 12, C.ink);
      ellipse(c, W / 2, fb - 11, 23, 11, C.yellow);
      for (let a = 0; a < 16; a++) { const an = (a / 16) * Math.PI * 2; if (a % 2) disc(c, W / 2 + Math.cos(an) * 20, fb - 11 + Math.sin(an) * 9.5, 2, C.ink); }
      ellipse(c, W / 2, fb - 16, 19, 16, C.cream[1]); ellipse(c, W / 2 - 3, fb - 20, 14, 11, C.cream[2]); ellipse(c, W / 2 - 6, fb - 24, 6, 4, C.cream[3]);
      rect(c, W / 2 - 3, fb - 36, 6, 5, C.ti[2]);
      L.push({ x: W / 2, y: fb - 11, r: 22, col: '#ffe066' });
      break;
    }
    case 'geo': {
      ellipse(c, W / 2, fb - 6, 13, 6, '#3a1a10'); ellipse(c, W / 2, fb - 6, 8, 3, C.orange);
      box(c, 4, 6, W - 8, 10, 12, TOP_DARK, FRONT_DARK);
      rect(c, 6, 16, 3, 14, C.ti[3]); rect(c, W - 9, 16, 3, 14, C.ti[3]);
      rect(c, 9, 20, W - 18, 3, C.orangeD);
      rect(c, W / 2 - 2, 0, 4, 8, C.ti[2]);
      L.push({ x: W / 2, y: fb - 6, r: 16, col: '#ff8a3a' });
      break;
    }
    case 'pad': {
      ellipse(c, W / 2, H / 2, W / 2 - 1, H / 2 - 1, '#2a2236');
      ellipse(c, W / 2, H / 2, W / 2 - 4, H / 2 - 4, C.yellow);
      ellipse(c, W / 2, H / 2, W / 2 - 7, H / 2 - 7, '#2a2236');
      ellipse(c, W / 2, H / 2, W / 2 - 9, H / 2 - 9, '#352c44');
      // H mark
      rect(c, W / 2 - 9, H / 2 - 10, 4, 20, '#ffffff'); rect(c, W / 2 + 5, H / 2 - 10, 4, 20, '#ffffff'); rect(c, W / 2 - 5, H / 2 - 2, 10, 4, '#ffffff');
      for (let a = 0; a < 8; a++) { const an = (a / 8) * Math.PI * 2; L.push({ x: W / 2 + Math.cos(an) * (W / 2 - 3), y: H / 2 + Math.sin(an) * (H / 2 - 3), r: 5, col: '#ff5a5a' }); }
      break;
    }
  }
  if (kind !== 'pad') outline(cv);
  const s = { cv, up, lights: L, w: W, h: H };
  cache.set(kind, s);
  return s;
}

// ------------------------------------------------------------------ construction stages

const stageCache = new Map<string, HTMLCanvasElement>();
/** Foundation plates (stage 1) and girder frame (stage 2) for a footprint. */
export function frameSprite(kind: ModuleKind, stage: 1 | 2): HTMLCanvasElement {
  const key = `${kind}:${stage}`;
  const hit = stageCache.get(key);
  if (hit) return hit;
  const def = MODULES[kind];
  const up = UP[kind];
  const W = def.w * 16 + 2, H = def.h * 16 + up + 2;
  const [cv, c] = canvas(W, H);
  const fy = up + 1;
  rect(c, 2, fy + 2, W - 4, H - fy - 4, C.ti[2]);
  for (let x = 2; x < W - 2; x += 8) rect(c, x, fy + 2, 1, H - fy - 4, C.ti[1]);
  for (let y = fy + 2; y < H - 2; y += 8) rect(c, 2, y, W - 4, 1, C.ti[1]);
  rect(c, 2, fy + 2, W - 4, 1, C.ti[4]);
  if (stage === 2) {
    const top = Math.max(2, fy - up + 4);
    const beam = (x: number, y: number, w: number, h: number) => { rect(c, x, y, w, h, C.yellow); for (let k = 0; k < Math.max(w, h); k += 4) rect(c, w > h ? x + k : x, w > h ? y : y + k, w > h ? 2 : w, w > h ? h : 2, C.ink); };
    beam(3, top, 2, H - top - 4); beam(W - 5, top, 2, H - top - 4); beam(W / 2 - 1, top, 2, H - top - 4);
    beam(3, top, W - 6, 2); beam(3, Math.floor((top + H) / 2), W - 6, 2);
    for (let k = 0; k < 8; k++) { px(c, 5 + k * ((W - 10) / 8), top + 2 + k * ((H - top - 8) / 8), C.yellowD); }
  }
  outline(cv);
  stageCache.set(key, cv);
  return cv;
}

export function cratePile(n: number): HTMLCanvasElement {
  const key = `crates:${Math.min(6, n)}`;
  const hit = stageCache.get(key);
  if (hit) return hit;
  const [cv, c] = canvas(18, 16);
  const spots = [[1, 9], [8, 9], [4, 4], [11, 4], [1, 2], [8, 0]];
  for (let i = 0; i < Math.min(6, n); i++) { const [x, y] = spots[i]; rect(c, x, y, 7, 6, C.orange); rect(c, x, y, 7, 1, C.orangeL); rect(c, x + 3, y, 1, 6, C.orangeD); rect(c, x, y + 5, 7, 1, C.orangeD); }
  outline(cv);
  stageCache.set(key, cv);
  return cv;
}
