// Small pixel icons for the DOM UI (rendered once to data URLs).

import type { ModuleKind, ResId, RobotKind } from '../sim/defs';
import { MODULES } from '../sim/defs';
import { canvas, disc, ellipse, outline, rect } from '../render/pix';
import { C } from '../render/palette';
import { moduleSprite } from '../render/modules';
import { resIcon, robotSprite } from '../render/units';

const urls = new Map<string, string>();
const url = (key: string, f: () => HTMLCanvasElement) => { let u = urls.get(key); if (!u) { u = f().toDataURL(); urls.set(key, u); } return u; };

export const resUrl = (r: ResId) => url(`res:${r}`, () => resIcon(r, 12));
export const robotUrl = (k: RobotKind) => url(`rob:${k}`, () => robotSprite(k, 'down', 0));
export function moduleUrl(k: ModuleKind) {
  return url(`mod:${k}`, () => {
    const s = moduleSprite(k);
    const size = Math.max(s.w, s.h);
    const [cv, c] = canvas(size, size);
    c.drawImage(s.cv, Math.floor((size - s.w) / 2), Math.floor((size - s.h) / 2));
    return cv;
  });
}
export const eyeUrl = (state: 'idle' | 'think' | 'alert' = 'idle') => url(`eye:${state}`, () => {
  const [cv, c] = canvas(18, 18);
  rect(c, 3, 2, 12, 15, C.ink); rect(c, 3, 2, 12, 2, C.inkSoft);
  const col = state === 'alert' ? C.red : state === 'think' ? C.cyan : C.green;
  disc(c, 9, 8, 4, state === 'alert' ? C.redD : C.greenDD); disc(c, 9, 8, 2.5, col); rect(c, 8, 7, 2, 2, '#ffffff');
  rect(c, 5, 13, 2, 2, col); rect(c, 11, 13, 2, 2, col); rect(c, 8, 0, 2, 2, C.ti[2]);
  return outline(cv);
});
export const boltUrl = () => url('bolt', () => { const [cv, c] = canvas(12, 14); rect(c, 6, 1, 3, 4, C.yellow); rect(c, 4, 5, 4, 3, C.yellow); rect(c, 3, 7, 7, 2, C.yellow); rect(c, 5, 9, 3, 3, C.yellow); rect(c, 4, 11, 2, 2, C.yellow); return outline(cv); });
export const o2Url = () => url('o2', () => { const [cv, c] = canvas(14, 14); disc(c, 7, 7, 5, C.cyan); disc(c, 6, 6, 2, C.cyanL); rect(c, 9, 9, 2, 2, C.cyanD); return outline(cv); });
export const dropUrl = () => url('drop', () => { const [cv, c] = canvas(12, 14); disc(c, 6, 8, 4, C.ice[2]); rect(c, 5, 2, 2, 3, C.ice[2]); rect(c, 4, 4, 4, 2, C.ice[2]); rect(c, 4, 7, 1, 2, '#ffffff'); return outline(cv); });
export const crateUrl = () => url('crate', () => { const [cv, c] = canvas(14, 14); rect(c, 2, 3, 10, 9, C.orange); rect(c, 2, 3, 10, 2, C.orangeL); rect(c, 6, 3, 2, 9, C.orangeD); return outline(cv); });
export const hotUrl = (k: 'build' | 'inspect' | 'robots' | 'research' | 'overlay' | 'core') => url(`hot:${k}`, () => {
  const [cv, c] = canvas(18, 18);
  switch (k) {
    case 'build': rect(c, 2, 9, 14, 7, C.ti[3]); rect(c, 2, 9, 14, 2, C.ti[5]); for (let x = 3; x < 16; x += 4) rect(c, x, 4, 2, 6, C.yellow); rect(c, 2, 3, 14, 2, C.yellowD); break;
    case 'inspect': disc(c, 7, 7, 5, C.ink); disc(c, 7, 7, 3.5, C.cyan); rect(c, 10, 10, 2, 2, C.ink); rect(c, 12, 12, 3, 3, C.ink); break;
    case 'robots': return robotSprite('miner', 'down', 0);
    case 'research': rect(c, 7, 1, 4, 6, C.ti[4]); for (let k = 0; k < 6; k++) rect(c, 6 - k, 7 + k, 6 + k * 2, 1, C.cyan); rect(c, 2, 13, 14, 2, C.cyanD); rect(c, 8, 9, 2, 2, '#ffffff'); break;
    case 'overlay': for (let k = 0; k < 3; k++) { rect(c, 2 + k * 2, 3 + k * 4, 12, 4, [C.yellow, C.cyan, C.green][k]); } break;
    case 'core': return robotSprite('scout', 'down', 0);
  }
  return outline(cv);
});
export { MODULES, ellipse };
