// Tiny pixel-painting helpers. All art in the game is drawn with these.

export type Ctx = CanvasRenderingContext2D;

export function canvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d')!;
  x.imageSmoothingEnabled = false;
  return [c, x];
}

export function px(c: Ctx, x: number, y: number, col: string) {
  c.fillStyle = col;
  c.fillRect(x | 0, y | 0, 1, 1);
}
export function rect(c: Ctx, x: number, y: number, w: number, h: number, col: string) {
  c.fillStyle = col;
  c.fillRect(x | 0, y | 0, w | 0, h | 0);
}
/** Pixel-exact filled disc. */
export function disc(c: Ctx, cx: number, cy: number, r: number, col: string) {
  c.fillStyle = col;
  const r2 = r * r;
  for (let y = -Math.ceil(r); y <= Math.ceil(r); y++) {
    let w = 0;
    for (let x = 0; x <= Math.ceil(r); x++) if (x * x + y * y <= r2 + r * 0.6) w = x;
    if (w > 0 || y * y <= r2) c.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2 + 1, 1);
  }
}
/** Pixel-exact filled ellipse. */
export function ellipse(c: Ctx, cx: number, cy: number, rx: number, ry: number, col: string) {
  c.fillStyle = col;
  for (let y = -Math.ceil(ry); y <= Math.ceil(ry); y++) {
    const t = 1 - (y * y) / (ry * ry + ry * 0.5);
    if (t < 0) continue;
    const w = Math.round(rx * Math.sqrt(t));
    c.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2 + 1, 1);
  }
}
export function outlineRect(c: Ctx, x: number, y: number, w: number, h: number, col: string) {
  rect(c, x, y, w, 1, col);
  rect(c, x, y + h - 1, w, 1, col);
  rect(c, x, y, 1, h, col);
  rect(c, x + w - 1, y, 1, h, col);
}

/** Draw a sprite from rows of palette characters ('.' = transparent). */
export function stamp(c: Ctx, rows: string[], pal: Record<string, string>, ox = 0, oy = 0, flip = false) {
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[flip ? row.length - 1 - x : x];
      if (ch === '.' || ch === ' ') continue;
      const col = pal[ch];
      if (col) px(c, ox + x, oy + y, col);
    }
  }
}

/** Seeded small RNG for deterministic decoration. */
export function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function mix(a: string, b: string, t: number): string {
  const A = hexToRgb(a), B = hexToRgb(b);
  const r = A.map((v, i) => Math.round(v + (B[i] - v) * t));
  return `#${r.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export const INK = '#1b1626';
/** Adds a 1px outline around every opaque pixel (the canvas must have a 1px transparent margin). */
export function outline(cv: HTMLCanvasElement, col = INK): HTMLCanvasElement {
  const c = cv.getContext('2d')!;
  const { width: w, height: h } = cv;
  const img = c.getImageData(0, 0, w, h);
  const d = img.data;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 40;
  const [r, g, b] = hexToRgb(col);
  const marks: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (solid(x, y)) continue;
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) marks.push((y * w + x) * 4);
    }
  for (const i of marks) { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; }
  c.putImageData(img, 0, 0);
  return cv;
}
/** Horizontal mirror of a canvas. */
export function flipH(cv: HTMLCanvasElement): HTMLCanvasElement {
  const [o, c] = canvas(cv.width, cv.height);
  c.translate(cv.width, 0);
  c.scale(-1, 1);
  c.drawImage(cv, 0, 0);
  return o;
}
