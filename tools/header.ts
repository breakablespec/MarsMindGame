// X/Twitter header for MARS MIND (1500×500), drawn with the game's own sprites. Build: see tools/README.
import { moduleSprite } from '../src/render/modules';
import { robotSprite } from '../src/render/units';
import { C } from '../src/render/palette';
import type { ModuleKind } from '../src/sim/defs';

const W = 375, H = 125, S = 4;
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
const hex = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const mix = (a: string, b: string, t: number) => { const A = hex(a), B = hex(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`; };

export function drawHeader(withText: boolean): HTMLCanvasElement {
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d')!; c.imageSmoothingEnabled = false;
  const r = (x: number, y: number, w: number, h: number, col: string) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
  let seed = 9; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  // ---- sky: space black → violet → dusty red horizon (ordered dither between bands)
  const HZ = 84;
  const sky = ['#07050b', '#0b0810', '#120c1a', '#1a1126', '#2a1424', '#4a1a1c', '#7a3416', '#9c4420'];
  for (let y = 0; y < HZ; y++) for (let x = 0; x < W; x++) {
    const t = Math.pow(y / HZ, 1.6) * (sky.length - 1) + (BAYER[y % 4][x % 4] / 16 - 0.5) * 0.9;
    r(x, y, 1, 1, sky[Math.max(0, Math.min(sky.length - 1, Math.round(t)))]);
  }
  for (let i = 0; i < 140; i++) { const x = Math.floor(rnd() * W), y = Math.floor(rnd() * 46); r(x, y, 1, 1, rnd() < 0.25 ? '#ffffff' : rnd() < 0.5 ? '#8a7fb0' : '#4a4068'); }
  for (const [x, y] of [[44, 10], [212, 8], [352, 30], [150, 22]]) { r(x - 1, y, 3, 1, '#9a90c8'); r(x, y - 1, 1, 3, '#9a90c8'); r(x, y, 1, 1, '#ffffff'); }
  // Earth (tiny blue dot) + Phobos
  r(331, 15, 2, 2, '#8fd4ff'); r(331, 15, 1, 1, '#e2f6ff');
  const disc = (cx: number, cy: number, rad: number, col: string) => { for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) if (x * x + y * y <= rad * rad + rad * 0.8) r(cx + x, cy + y, 1, 1, col); };
  disc(262, 24, 4, '#110d18'); disc(262, 24, 3, '#5d6578'); disc(261, 23, 2, '#9aa3b5'); r(263, 25, 1, 1, '#3c4253');
  // blue Martian sunset (sun low over the left ridge)
  const SX = 322, SY = 44;
  for (let y = SY - 30; y < HZ; y++) for (let x = SX - 64; x < SX + 64; x++) {
    const d = Math.hypot((x - SX) * 0.7, y - SY);
    const k = 1 - d / 34 + (BAYER[y % 4][x % 4] / 16 - 0.5) * 0.25;
    if (k > 0.66) r(x, y, 1, 1, '#4b9ad6'); else if (k > 0.42) r(x, y, 1, 1, '#2c6aa6'); else if (k > 0.2 && (x + y) % 2 === 0) r(x, y, 1, 1, '#3a3a6a');
  }
  disc(SX, SY, 4, '#c4ecff'); disc(SX, SY, 3, '#ffffff');
  // AI CORE beam (green, faint, into the sky)
  const BX = 210;
  for (let y = 2; y < 96; y++) { const a = y / 96; if (a > 0.25 || y % 2 === 0) r(BX, y, 1, 1, mix('#0e5a2a', '#4dff7a', 0.3 + a * 0.7)); if (a > 0.45 && (y % 2 === 0 || a > 0.75)) { r(BX - 1, y, 1, 1, mix('#0e5a2a', '#1fae4a', a)); r(BX + 1, y, 1, 1, mix('#0e5a2a', '#1fae4a', a)); } }

  // ---- ridges: far (hazed) and near
  const ridge = (base: number, amp: number, f1: number, f2: number, col: string, ph: number) => {
    for (let x = 0; x < W; x++) {
      const hgt = base - (Math.sin(x * f1 + ph) * 0.5 + 0.5) * amp - (Math.sin(x * f2 + ph * 2.3) * 0.5 + 0.5) * amp * 0.6 - (x > 260 && x < 330 ? Math.max(0, 12 - Math.abs(x - 295) * 0.35) : 0);
      for (let y = Math.floor(hgt); y < HZ + 2; y++) r(x, y, 1, 1, col);
    }
  };
  ridge(74, 10, 0.031, 0.083, '#4a1c18', 1.2);
  ridge(80, 7, 0.047, 0.13, '#6a2814', 4.1);
  // mesa top highlight
  for (let x = 0; x < W; x++) for (let y = 60; y < HZ; y++) { /* keep silhouettes flat for readability */ }

  // ---- ground with dunes
  for (let y = HZ; y < H; y++) for (let x = 0; x < W; x++) {
    const depth = (y - HZ) / (H - HZ);
    const dune = Math.sin(x * (0.05 + depth * 0.02) + y * 0.9 + Math.sin(x * 0.013) * 3);
    const base = 2 + depth * 2.6 + dune * 0.7 + (BAYER[y % 4][x % 4] / 16 - 0.5) * 0.9;
    r(x, y, 1, 1, C.mars[Math.max(0, Math.min(6, Math.round(base)))]);
  }
  r(0, HZ, W, 1, '#9c4420');
  // rocks
  for (const [x, y, s] of [[20, 112, 3], [52, 118, 2], [128, 104, 2], [24, 96, 2], [360, 118, 3], [118, 121, 3]]) { disc(x, y, s, '#3e160a'); disc(x - 1, y - 1, s - 1, '#7a3416'); }

  // ---- colony on a plated strip
  const kinds: ModuleKind[] = ['solar', 'solar', 'oxygen', 'core', 'command', 'habitat'];
  let x = 150; const GY = 110;
  r(144, GY - 6, 231, 10, '#3c4253'); r(144, GY - 6, 231, 1, '#7c8598');
  for (let i = 144; i < W; i += 4) r(i, GY - 6, 2, 1, i % 8 ? '#ffcc2e' : '#110d18');
  const lights: { x: number; y: number; rad: number; col: string }[] = [];
  for (const k of kinds) {
    const sp = moduleSprite(k); const sc = 0.6; const w = Math.round(sp.w * sc), h2 = Math.round(sp.h * sc);
    const top = GY - h2 + 2;
    c.drawImage(sp.cv, x, top, w, h2);
    for (const l of sp.lights) lights.push({ x: x + l.x * sc, y: top + l.y * sc, rad: Math.max(3, l.r * sc * 0.8), col: l.col });
    if (k === 'core') lights.push({ x: x + w / 2, y: top + 9, rad: 14, col: '#4dff7a' });
    x += w + 2;
  }
  // ---- deposit + robots
  for (const [ox, oy, s2] of [[100, 101, 4], [107, 103, 3], [96, 105, 2]]) { disc(ox, oy, s2, '#3c4253'); disc(ox - 1, oy - 1, s2 - 1, '#9aa3b5'); r(ox - 1, oy - 2, 1, 1, '#e3e7ef'); }
  c.drawImage(robotSprite('miner', 'left', 0, { working: true }), 112, 96);
  for (let i = 0; i < 6; i++) r(110 - i, 101 - (i % 3), 1, 1, i % 2 ? '#fff0a0' : '#ffcc2e');
  c.drawImage(robotSprite('hauler', 'right', 1, { cargo: 'titanium' }), 136, 104);
  c.drawImage(robotSprite('scout', 'right', 0), 160, 46);
  for (let i = 1; i < 14; i++) if (i % 2) r(160 - i * 2, 54 + Math.round(i * 0.3), 1, 1, mix('#110d18', '#2fe0e8', 1 - i / 14));
  lights.push({ x: 168, y: 52, rad: 5, col: '#2fe0e8' }, { x: 108, y: 101, rad: 6, col: '#ffcc2e' });

  // ---- dusk: dim the land, then light windows/beacons additively
  c.globalCompositeOperation = 'multiply';
  const g = c.createLinearGradient(0, HZ - 30, 0, H); g.addColorStop(0, 'rgba(140,110,150,1)'); g.addColorStop(1, 'rgba(120,90,120,1)');
  c.fillStyle = g; c.fillRect(0, HZ - 30, W, H - HZ + 30);
  c.globalCompositeOperation = 'lighter';
  for (const l of lights) {
    const rg = c.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.rad); const [R, G2, B] = hex(l.col.length === 7 ? l.col : '#ffe9a8');
    rg.addColorStop(0, `rgba(${R},${G2},${B},0.55)`); rg.addColorStop(1, `rgba(${R},${G2},${B},0)`);
    c.fillStyle = rg; c.fillRect(l.x - l.rad, l.y - l.rad, l.rad * 2, l.rad * 2);
  }
  c.globalCompositeOperation = 'source-over';
  // quantize glow back to crisp pixels: re-snap via nearest scaling happens on export

  if (withText) pixelText(c, 'MARS', 22, 20, 3, '#e8743b', '#7a3416');
  if (withText) pixelText(c, 'MIND', 22 + 4 * 18 + 10, 20, 3, '#4dff7a', '#0e5a2a');

  const out = document.createElement('canvas'); out.width = W * S; out.height = H * S;
  const o = out.getContext('2d')!; o.imageSmoothingEnabled = false; o.drawImage(cv, 0, 0, W * S, H * S);
  return out;
}

// 5×7 pixel font (only the letters we need)
const FONT: Record<string, string[]> = {
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
};
function pixelText(c: CanvasRenderingContext2D, text: string, x: number, y: number, s: number, col: string, shade: string) {
  let cx = x;
  for (const ch of text) {
    const g = FONT[ch]; if (!g) { cx += 4 * s; continue; }
    for (const [pass, ox, oy, colr] of [[0, 1, 1, '#110d18'], [0, 1, 2, '#110d18'], [1, 0, 0, col]] as [number, number, number, string][]) {
      for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 5; gx++) if (g[gy][gx] === '1') {
        c.fillStyle = pass && gy >= 5 ? shade : colr; c.fillRect(cx + gx * s + ox, y + gy * s + oy, s, s);
      }
    }
    cx += 6 * s;
  }
}

(window as unknown as { __header: typeof drawHeader }).__header = drawHeader;
