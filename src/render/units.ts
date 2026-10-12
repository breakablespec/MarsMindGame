// Robots, colonists, the supply shuttle, deposits and small icons.

import type { DepositKind, ResId, RobotKind, Role } from '../sim/defs';
import { RES, ROLE_INFO } from '../sim/defs';
import type { Facing } from '../sim/state';
import { canvas, disc, ellipse, flipH, outline, px, rect } from './pix';
import { C } from './palette';
import { rock } from './terrain';

type Ctx = CanvasRenderingContext2D;
const cache = new Map<string, HTMLCanvasElement>();
const memo = (key: string, f: () => HTMLCanvasElement) => { let v = cache.get(key); if (!v) { v = f(); cache.set(key, v); } return v; };

function treads(c: Ctx, x: number, y: number, w: number, h: number, frame: number, vertical: boolean) {
  rect(c, x, y, w, h, C.ink);
  rect(c, x, y, w, h, '#2a2533');
  if (vertical) for (let k = (frame % 2); k < h; k += 2) rect(c, x, y + k, w, 1, '#4a4458');
  else for (let k = (frame % 2); k < w; k += 2) rect(c, x + k, y, 1, h, '#4a4458');
}

/** 20×20 robot sprite. Flying robots are drawn without shadow (renderer adds it). */
export function robotSprite(kind: RobotKind, facing: Facing, frame: number, opts: { cargo?: ResId | null; working?: boolean } = {}): HTMLCanvasElement {
  const key = `${kind}:${facing}:${frame % 2}:${opts.cargo ?? ''}:${opts.working ? 1 : 0}`;
  return memo(key, () => {
    if (facing === 'right') return flipH(robotSprite(kind, 'left', frame, opts));
    const [cv, c] = canvas(20, 20);
    const side = facing === 'left';
    const f = frame % 2;
    switch (kind) {
      case 'miner': {
        if (side) {
          treads(c, 4, 13, 12, 4, f, false);
          rect(c, 5, 6, 10, 8, C.orange); rect(c, 5, 6, 10, 2, C.orangeL); rect(c, 5, 12, 10, 2, C.orangeD);
          rect(c, 9, 7, 4, 3, '#1b2a44'); px(c, 10, 7, C.cyanL);
          // drill arm forward (left)
          rect(c, 1, 9, 5, 3, C.ti[2]); rect(c, 0, 9 + (opts.working ? f : 0), 2, 3, C.ti[4]); px(c, 0, 10, C.ti[5]);
          rect(c, 13, 3, 1, 4, C.ti[1]); px(c, 13, 2, C.red);
        } else {
          treads(c, 3, 5, 3, 12, f, true); treads(c, 14, 5, 3, 12, f, true);
          rect(c, 6, 5, 8, 11, C.orange); rect(c, 6, 5, 8, 2, C.orangeL); rect(c, 6, 14, 8, 2, C.orangeD);
          if (facing === 'down') { rect(c, 8, 8, 4, 3, '#1b2a44'); px(c, 9, 8, C.cyanL); rect(c, 8, 16, 4, 3, C.ti[2]); rect(c, 9, 18 - (opts.working ? f : 0), 2, 2, C.ti[4]); }
          else { rect(c, 8, 1, 4, 4, C.ti[2]); rect(c, 9, 0 + (opts.working ? f : 0), 2, 2, C.ti[4]); rect(c, 7, 10, 6, 3, C.orangeD); }
          rect(c, 13, 2, 1, 4, C.ti[1]); px(c, 13, 1, C.red);
        }
        break;
      }
      case 'hauler': {
        if (side) {
          disc(c, 5, 16, 2, C.ink); disc(c, 14, 16, 2, C.ink); px(c, 5, 16, C.ti[2]); px(c, 14, 16, C.ti[2]);
          rect(c, 2, 9, 16, 5, C.ti[3]); rect(c, 2, 9, 16, 1, C.ti[5]); rect(c, 2, 13, 16, 1, C.ti[1]);
          rect(c, 2, 4, 6, 6, C.builder); rect(c, 2, 4, 6, 1, C.yellowL); rect(c, 3, 5, 3, 3, '#1b2a44'); px(c, 3, 5, C.cyanL);
          if (opts.cargo) { const col = RES[opts.cargo].color, d = RES[opts.cargo].dark; rect(c, 9, 4, 4, 5, col); rect(c, 13, 5, 4, 4, col); rect(c, 9, 4, 4, 1, '#ffffff'); rect(c, 12, 4, 1, 5, d); rect(c, 16, 5, 1, 4, d); }
        } else {
          for (const [x, y] of [[3, 4], [14, 4], [3, 14], [14, 14]]) rect(c, x, y, 3, 4, C.ink);
          rect(c, 5, 3, 10, 15, C.ti[3]); rect(c, 5, 3, 1, 15, C.ti[5]); rect(c, 14, 3, 1, 15, C.ti[1]);
          const cabY = facing === 'down' ? 13 : 2;
          rect(c, 5, cabY, 10, 5, C.builder); rect(c, 5, cabY, 10, 1, C.yellowL); if (facing === 'down') { rect(c, 7, cabY + 2, 6, 2, '#1b2a44'); px(c, 8, cabY + 2, C.cyanL); }
          if (opts.cargo) { const col = RES[opts.cargo].color, d = RES[opts.cargo].dark; const y0 = facing === 'down' ? 4 : 8; rect(c, 6, y0, 4, 4, col); rect(c, 10, y0 + 1, 4, 4, col); rect(c, 7, y0 + 5, 5, 3, col); rect(c, 6, y0, 4, 1, '#ffffff'); rect(c, 9, y0, 1, 4, d); }
        }
        break;
      }
      case 'builder': {
        if (side) {
          treads(c, 4, 14, 12, 3, f, false);
          rect(c, 5, 7, 10, 8, C.builder); rect(c, 5, 7, 10, 2, C.yellowL); rect(c, 5, 13, 10, 2, C.builderD);
          rect(c, 10, 9, 3, 3, '#1b2a44'); px(c, 11, 9, C.cyanL);
          // crane arm
          const lift = opts.working ? f * 2 : 0;
          rect(c, 6, 4, 2, 4, C.ti[2]); rect(c, 0, 3 - lift, 8, 2, C.ti[3]); rect(c, 1, 5 - lift, 1, 3, C.ti[1]); rect(c, 0, 8 - lift, 3, 2, C.ti[4]);
          rect(c, 13, 5, 2, 2, C.orange); px(c, 13, 5, C.orangeL);
        } else {
          treads(c, 3, 6, 3, 11, f, true); treads(c, 14, 6, 3, 11, f, true);
          rect(c, 6, 6, 8, 10, C.builder); rect(c, 6, 6, 8, 2, C.yellowL); rect(c, 6, 14, 8, 2, C.builderD);
          const lift = opts.working ? f * 2 : 0;
          if (facing === 'down') { rect(c, 8, 9, 4, 3, '#1b2a44'); px(c, 9, 9, C.cyanL); rect(c, 9, 12, 2, 6 + lift, C.ti[3]); rect(c, 8, 17 + lift, 4, 2, C.ti[4]); }
          else { rect(c, 9, 1 - lift, 2, 6, C.ti[3]); rect(c, 8, 0, 4, 2, C.ti[4]); }
          rect(c, 12, 4, 2, 2, C.orange); px(c, 12, 4, C.orangeL);
        }
        break;
      }
      case 'repair': {
        if (side) {
          disc(c, 6, 16, 2, C.ink); disc(c, 14, 16, 2, C.ink);
          rect(c, 4, 7, 12, 8, C.ti[5]); rect(c, 4, 7, 12, 2, '#ffffff'); rect(c, 4, 13, 12, 2, C.ti[3]);
          rect(c, 10, 8, 2, 5, C.cyan); rect(c, 8, 10, 6, 1, C.cyan);
          rect(c, 0, 9, 5, 2, C.ti[2]); rect(c, 0, 8 + (opts.working ? f * 2 : 0), 2, 2, C.cyan);
        } else {
          for (const [x, y] of [[3, 6], [14, 6], [3, 13], [14, 13]]) rect(c, x, y, 3, 4, C.ink);
          rect(c, 5, 5, 10, 11, C.ti[5]); rect(c, 5, 5, 10, 2, '#ffffff'); rect(c, 5, 14, 10, 2, C.ti[3]);
          rect(c, 9, 7, 2, 6, C.cyan); rect(c, 7, 9, 6, 2, C.cyan);
          if (facing === 'down') { rect(c, 9, 16, 2, 3, C.ti[2]); rect(c, 8, 18, 4, 2, C.cyan); }
        }
        break;
      }
      case 'scout': {
        for (const [x, y] of [[3, 5], [16, 5], [3, 14], [16, 14]]) { ellipse(c, x, y, 3.5, 1.5, 'rgba(220,235,255,0.75)'); px(c, x, y, C.ti[4]); }
        rect(c, 4, 5, 12, 1, C.ti[1]); rect(c, 4, 14, 12, 1, C.ti[1]); rect(c, 4, 5, 1, 10, C.ti[1]); rect(c, 15, 5, 1, 10, C.ti[1]);
        disc(c, 10, 10, 4, C.ti[4]); disc(c, 10, 9, 3, C.ti[5]);
        disc(c, side ? 7 : 10, facing === 'up' ? 8 : 11, 1.6, C.cyan); px(c, side ? 7 : 10, facing === 'up' ? 8 : 11, '#ffffff');
        break;
      }
      case 'maint': {
        ellipse(c, 10, 12, 7, 4, C.cyanD); ellipse(c, 10, 10, 7, 4, C.cyan); ellipse(c, 9, 9, 4, 2, C.cyanL);
        rect(c, 6, 14, 8, 2, C.ti[1]); for (let k = 0; k < 8; k += 2) rect(c, 6 + k, 16, 1, 2 + (f && opts.working ? 1 : 0), C.yellowD);
        px(c, side ? 5 : 10, 10, C.ink);
        break;
      }
    }
    return outline(cv);
  });
}

// ------------------------------------------------------------------ colonists

export function colonistSprite(role: Role, facing: Facing, frame: number): HTMLCanvasElement {
  return memo(`col:${role}:${facing}:${frame % 2}`, () => {
    if (facing === 'right') return flipH(colonistSprite(role, 'left', frame));
    const [cv, c] = canvas(12, 16);
    const stripe = ROLE_INFO[role].color;
    const f = frame % 2;
    // legs
    if (facing === 'left') { rect(c, 4, 11, 2, 3 + f, '#d8d8e0'); rect(c, 6, 11, 2, 4 - f, '#c0c0cc'); }
    else { rect(c, 3, 11, 2, 3 + f, '#d8d8e0'); rect(c, 7, 11, 2, 4 - f, '#d8d8e0'); }
    // body
    rect(c, 3, 6, 6, 6, '#f2f2f6'); rect(c, 3, 9, 6, 1, stripe);
    if (facing !== 'down') rect(c, facing === 'left' ? 7 : 3, 6, 3, 5, C.ti[3]); // backpack
    // helmet
    disc(c, 6, 4, 3.2, '#f6f6fa');
    if (facing === 'down') { rect(c, 4, 3, 5, 3, '#e0a52a'); px(c, 5, 3, '#fff1b8'); }
    else if (facing === 'left') { rect(c, 3, 3, 3, 3, '#e0a52a'); px(c, 3, 3, '#fff1b8'); }
    return outline(cv);
  });
}

// ------------------------------------------------------------------ shuttle

export function shuttleSprite(flame: number): HTMLCanvasElement {
  return memo(`shuttle:${flame}`, () => {
    const [cv, c] = canvas(44, 56);
    // legs
    rect(c, 6, 34, 2, 12, C.ti[1]); rect(c, 36, 34, 2, 12, C.ti[1]); rect(c, 4, 45, 6, 2, C.ti[2]); rect(c, 34, 45, 6, 2, C.ti[2]);
    // body
    rect(c, 10, 14, 24, 26, C.ti[5]); rect(c, 10, 14, 4, 26, '#ffffff'); rect(c, 30, 14, 4, 26, C.ti[3]);
    rect(c, 13, 6, 18, 9, C.ti[5]); rect(c, 16, 2, 12, 5, '#ffffff'); rect(c, 19, 0, 6, 3, C.ti[4]);
    rect(c, 10, 22, 24, 4, C.orange); rect(c, 10, 22, 24, 1, C.orangeL);
    rect(c, 18, 8, 8, 4, '#1b2a44'); px(c, 19, 8, C.cyanL);
    rect(c, 14, 40, 16, 4, C.ti[1]);
    if (flame) { rect(c, 17, 44, 10, 4, C.yellowL); rect(c, 18, 48, 8, 4, C.yellow); rect(c, 20, 52, 4, 3 + flame, C.orange); }
    return outline(cv);
  });
}

// ------------------------------------------------------------------ deposits

export function depositSprite(kind: DepositKind, level: number): HTMLCanvasElement {
  return memo(`dep:${kind}:${level}`, () => {
    const [cv, c] = canvas(34, 34);
    const n = level; // 1..4 chunks remaining
    switch (kind) {
      case 'iron': {
        ellipse(c, 17, 22, 15, 9, C.dust[1]);
        const spots = [[10, 18, 7], [22, 16, 8], [16, 24, 7], [26, 25, 5]];
        for (let i = 0; i < n; i++) { const [x, y, r] = spots[i]; ellipse(c, x, y, r, r * 0.8, C.rust[1]); ellipse(c, x - 1, y - 1, r - 1, r * 0.7 - 1, C.rust[3]); ellipse(c, x - 2, y - 2, r * 0.5, r * 0.3, C.rust[4]); rect(c, x - 2, y, 4, 1, C.rust[0]); px(c, x + 1, y - 2, '#ffd0b0'); }
        break;
      }
      case 'titanium': {
        ellipse(c, 17, 23, 15, 8, C.dust[1]);
        const spots = [[11, 20], [20, 14], [24, 22], [16, 25]];
        for (let i = 0; i < n; i++) { const [x, y] = spots[i]; for (let k = 0; k < 3; k++) { const h = 7 + k * 2; rect(c, x - 3 + k * 3, y - h + 4, 3, h, k === 1 ? C.ti[4] : C.ti[3]); rect(c, x - 3 + k * 3, y - h + 4, 1, h, '#ffffff'); rect(c, x - 1 + k * 3, y - h + 4, 1, h, C.ti[1]); } px(c, x, y - 6, '#ffffff'); }
        break;
      }
      case 'ice': {
        ellipse(c, 17, 22, 15, 9, C.ice[1]);
        const spots = [[10, 18], [21, 15], [17, 24], [26, 23]];
        for (let i = 0; i < n; i++) { const [x, y] = spots[i]; rect(c, x - 5, y - 4, 10, 8, C.ice[2]); rect(c, x - 5, y - 4, 10, 2, C.ice[4]); rect(c, x - 5, y - 4, 2, 8, C.ice[3]); rect(c, x + 3, y - 2, 2, 6, C.ice[1]); px(c, x - 3, y - 3, '#ffffff'); }
        break;
      }
      case 'regolith': {
        const h = 4 + n * 2;
        ellipse(c, 17, 24, 15, 7, C.mars[5]); ellipse(c, 17, 24 - h / 2, 12, h, C.mars[6]); ellipse(c, 14, 22 - h / 2, 7, h * 0.6, C.mars[7]);
        for (let k = 0; k < 6; k++) px(c, 8 + k * 4, 22 + (k % 2) * 3, C.mars[3]);
        break;
      }
      case 'rare': {
        rock(c, 17, 21, 11, 5);
        const spots = [[12, 16], [21, 14], [18, 22], [24, 20]];
        for (let i = 0; i < n; i++) { const [x, y] = spots[i]; rect(c, x - 1, y - 4, 3, 6, C.rare[1]); rect(c, x, y - 5, 1, 7, C.rare[2]); px(c, x, y - 5, '#ffffff'); rect(c, x + 2, y - 2, 2, 4, C.rare[0]); }
        break;
      }
      case 'debris': {
        ellipse(c, 17, 24, 14, 6, C.mars[2]);
        rect(c, 6, 14, 18, 9, C.ti[3]); rect(c, 6, 14, 18, 2, C.ti[5]); rect(c, 6, 20, 18, 2, C.red);
        rect(c, 22, 9, 10, 8, '#1b2a5a'); for (let x = 23; x < 32; x += 3) rect(c, x, 10, 1, 6, '#3f62a8'); rect(c, 22, 9, 10, 1, C.yellowD);
        rect(c, 3, 19, 6, 3, C.ti[2]); rect(c, 12, 23, 3, 4, C.ti[1]);
        disc(c, 12, 12, 3, C.ti[4]); px(c, 12, 12, C.ink);
        break;
      }
      case 'vent': {
        ellipse(c, 17, 20, 14, 9, '#3a1a10'); ellipse(c, 17, 20, 10, 6, '#5a200e'); ellipse(c, 17, 20, 6, 3, C.orange); ellipse(c, 17, 20, 3, 1.5, C.yellowL);
        for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; rect(c, 17 + Math.cos(a) * 11, 20 + Math.sin(a) * 7, 2, 2, C.dust[0]); }
        break;
      }
    }
    return outline(cv);
  });
}

// ------------------------------------------------------------------ icons (UI + map)

export function resIcon(r: ResId, size = 10): HTMLCanvasElement {
  return memo(`res:${r}:${size}`, () => {
    const [cv, c] = canvas(size + 2, size + 2);
    const col = RES[r].color, d = RES[r].dark;
    const s = size;
    switch (r) {
      case 'ice': rect(c, 2, 3, s - 2, s - 3, col); rect(c, 2, 3, s - 2, 2, '#ffffff'); rect(c, s - 2, 4, 2, s - 4, d); break;
      case 'titanium': for (let k = 0; k < 3; k++) { rect(c, 2 + k * 3, 3 + (k === 1 ? 0 : 2), 3, s - 3 - (k === 1 ? 0 : 2), k === 1 ? '#e3e7ef' : col); } rect(c, 2, 4, 1, s - 4, '#ffffff'); break;
      case 'rare': rect(c, s / 2, 1, 3, s - 1, C.rare[2]); rect(c, s / 2 - 3, 4, 3, s - 4, C.rare[1]); rect(c, s / 2 + 3, 5, 2, s - 5, C.rare[0]); px(c, s / 2 + 1, 2, '#ffffff'); break;
      case 'electronics': rect(c, 2, 3, s - 2, s - 4, '#1d7a3e'); rect(c, 2, 3, s - 2, 1, '#4dff7a'); rect(c, 4, 5, 3, 3, '#110d18'); for (let k = 3; k < s; k += 2) { px(c, k, 2, '#ffd36b'); px(c, k, s - 1, '#ffd36b'); } break;
      case 'polymer': rect(c, 2, 2, s - 3, s - 2, col); rect(c, 2, 2, s - 3, 2, '#fff1dc'); rect(c, 2, s / 2, s - 3, 1, d); break;
      case 'silica': disc(c, s / 2 + 1, s / 2 + 1, s / 2 - 1, col); disc(c, s / 2, s / 2, s / 4, '#ffffff'); px(c, s / 2 + 2, s / 2 + 2, d); break;
      default: disc(c, s / 2 + 1, s / 2 + 2, s / 2 - 0.5, col); disc(c, s / 2, s / 2, s / 4, '#ffffff'); disc(c, s / 2 + 2, s / 2 + 3, s / 5, d);
    }
    return outline(cv);
  });
}

export function robotIcon(kind: RobotKind): HTMLCanvasElement { return robotSprite(kind, 'down', 0); }
