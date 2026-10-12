// Shareable colony card: a pixel PNG summarising the colony, built from live state.

import { MODULES } from '../sim/defs';
import { sol } from '../sim/core';
import { colonyScores, onlineModules } from '../sim/colony';
import { alive } from '../sim/life';
import { o2Cap } from '../sim/power';
import { peakPower } from '../sim/construction';
import type { Game } from '../engine/game';
import { canvas, rect } from '../render/pix';
import { C } from '../render/palette';
import { moduleSprite } from '../render/modules';
import { robotSprite } from '../render/units';
import { h } from './dom';
import { coreVersion } from '../ai/perf';

export function renderCard(g: Game): HTMLCanvasElement {
  const st = g.st;
  const W = 320, H = 180;
  const [cv, c] = canvas(W, H);
  rect(c, 0, 0, W, H, '#0b0810');
  for (let i = 0; i < 60; i++) rect(c, (i * 53) % W, (i * 31) % 70, 1, 1, i % 3 ? '#3a3050' : '#ffffff');
  // ground strip with the colony's modules
  rect(c, 0, 92, W, 88, C.mars[3]);
  for (let i = 0; i < 120; i++) rect(c, (i * 37) % W, 94 + ((i * 17) % 80), 2, 1, i % 2 ? C.mars[2] : C.mars[5]);
  const mods = onlineModules(st).filter((m) => m.kind !== 'pad').slice(0, 9);
  let x = 6;
  for (const m of mods) { const s = moduleSprite(m.kind); const sc = 0.5; const w = s.w * sc, hh = s.h * sc; if (x + w > W - 4) break; c.drawImage(s.cv, x, 128 - hh, w, hh); x += w + 2; }
  for (const [i, r] of st.robots.slice(0, 8).entries()) c.drawImage(robotSprite(r.kind, 'down', 0), 8 + i * 22, 140);
  // header
  c.font = '8px Silkscreen, monospace'; c.textAlign = 'left';
  c.fillStyle = C.mars[6]; c.fillText('MARS MIND', 8, 14);
  c.fillStyle = '#ffffff'; c.font = '16px Silkscreen, monospace'; c.fillText(`SOL ${sol(st)}`, 8, 32);
  const stats: [string, string][] = [
    ['POPULATION', String(alive(st).length)], ['MODULES', String(onlineModules(st).length)], ['POWER', `${Math.round(peakPower(st))} kW`],
    ['OXYGEN', `${Math.round((st.o2 / Math.max(1, o2Cap(st))) * 100)}%`], ['ROBOTS', String(st.robots.length)], ['SCORE', String(colonyScores(st).overall)],
  ];
  stats.forEach(([k, v], i) => {
    const sx = 8 + (i % 3) * 104, sy = 46 + Math.floor(i / 3) * 22;
    c.font = '8px Silkscreen, monospace'; c.fillStyle = '#9a8c78'; c.fillText(k, sx, sy);
    c.fillStyle = i === 3 ? C.cyan : i === 2 ? C.yellow : '#ffffff'; c.font = '8px Silkscreen, monospace'; c.fillText(v, sx, sy + 10);
  });
  rect(c, 0, H - 14, W, 14, C.ink);
  c.fillStyle = C.green; c.font = '8px Silkscreen, monospace'; c.fillText(`BUILT WITH ${coreVersion(st).text}`, 8, H - 4);
  c.textAlign = 'right'; c.fillStyle = C.mars[6]; c.fillText(MODULES.command.name.toUpperCase().slice(0, 0) + st.stage.toUpperCase(), W - 8, H - 4);
  return cv;
}

export function colonyCard(g: Game): HTMLElement {
  const cv = renderCard(g);
  const big = document.createElement('canvas');
  big.width = cv.width * 3; big.height = cv.height * 3;
  const bc = big.getContext('2d')!; bc.imageSmoothingEnabled = false; bc.drawImage(cv, 0, 0, big.width, big.height);
  const img = h('img', { src: big.toDataURL('image/png'), class: 'colcard', alt: 'Colony card' });
  const st = g.st;
  const text = `MARS MIND · SOL ${sol(st)} · ${alive(st).length} colonists · ${onlineModules(st).length} modules · ${Math.round(peakPower(st))} kW · O₂ ${Math.round((st.o2 / Math.max(1, o2Cap(st))) * 100)}% · ${st.robots.length} robots · score ${colonyScores(st).overall} · built with ${coreVersion(st).text}`;
  const save = async () => {
    const blob: Blob | null = await new Promise((r) => big.toBlob((b) => r(b), 'image/png'));
    if (!blob) return;
    try {
      const w = window as unknown as { claude?: { use?: (n: string) => Promise<{ save: (o: { filename: string; data: Blob }) => Promise<unknown> } | null> } };
      const dl = w.claude?.use ? await w.claude.use('downloads') : null;
      if (dl) { await dl.save({ filename: `colony-sol-${sol(st)}.png`, data: blob }); return; }
    } catch { /* fall back */ }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `colony-sol-${sol(st)}.png`; a.click();
  };
  return h('div', { class: 'list' }, img,
    h('div', { class: 'row' }, h('button', { class: 'btn green', type: 'button', onclick: () => void save() }, 'SAVE IMAGE'), h('button', { class: 'btn', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(text); g.toast('Copied', 'good'); } catch { g.toast('Copy not available here', 'bad'); } } }, 'COPY TEXT')),
    h('div', { class: 'term' }, text));
}
