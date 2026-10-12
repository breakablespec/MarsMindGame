// Loader (Mars → modules light up → CORE ONLINE) and the title screen.

import { canvas, disc, rect, ellipse } from '../render/pix';
import { C } from '../render/palette';
import { moduleSprite } from '../render/modules';
import type { ModuleKind } from '../sim/defs';
import { h } from './dom';

export function playLoader(root: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    const W = 220, H = 124;
    const [cv, c] = canvas(W, H);
    const msg = h('div', { class: 'msg' }, 'CORE ONLINE');
    const skip = h('div', { class: 'skip' }, 'click or press any key');
    const wrap = h('div', { class: 'loader' }, cv, msg, skip);
    root.replaceChildren(wrap);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const T0 = performance.now(), DUR = reduce ? 600 : 3400;
    let done = false;
    const finish = () => { if (done) return; done = true; removeEventListener('keydown', finish); wrap.classList.add('out'); setTimeout(() => { wrap.remove(); resolve(); }, 350); };
    addEventListener('keydown', finish);
    wrap.addEventListener('pointerdown', finish);
    const kinds: ModuleKind[] = ['habitat', 'command', 'core', 'oxygen', 'solar', 'battery', 'storage'];
    const stars = Array.from({ length: 70 }, (_, i) => [(i * 97) % W, (i * 53) % H, i % 5]);
    const frame = () => {
      if (done) return;
      const t = (performance.now() - T0) / DUR;
      rect(c, 0, 0, W, H, '#0b0810');
      for (const [x, y, k] of stars) rect(c, x, y, 1, 1, k === 0 && Math.floor(t * 20 + x) % 3 === 0 ? '#ffffff' : '#3a3050');
      // phase 1: planet, phase 2: surface with modules
      if (t < 0.38) {
        const r = 18 + t * 60;
        disc(c, W / 2, H / 2, r + 2, '#2a1210');
        disc(c, W / 2, H / 2, r, C.mars[3]);
        disc(c, W / 2 - r * 0.25, H / 2 - r * 0.25, r * 0.7, C.mars[4]);
        disc(c, W / 2 - r * 0.4, H / 2 - r * 0.4, r * 0.3, C.mars[5]);
        ellipse(c, W / 2 + r * 0.3, H / 2 + r * 0.2, r * 0.25, r * 0.15, C.mars[2]);
        // terminator shadow
        c.globalAlpha = 0.5; disc(c, W / 2 + r * 0.55, H / 2 + r * 0.35, r * 0.9, '#0b0810'); c.globalAlpha = 1;
        disc(c, W / 2 + 2, H / 2 - 4, 1.5, C.green);
      } else {
        const k = Math.min(1, (t - 0.38) / 0.45);
        rect(c, 0, 70, W, H - 70, C.mars[2]);
        rect(c, 0, 70, W, 2, C.mars[4]);
        for (let i = 0; i < 40; i++) rect(c, (i * 41) % W, 74 + ((i * 13) % 46), 2, 1, i % 2 ? C.mars[1] : C.mars[3]);
        kinds.forEach((kd, i) => {
          const s = moduleSprite(kd);
          const x = 8 + i * 30, y = 104 - s.h * 0.55;
          const lit = k > (i + 1) / (kinds.length + 1);
          c.globalAlpha = lit ? 1 : 0.25;
          c.drawImage(s.cv, x, y, s.w * 0.55, s.h * 0.55);
          c.globalAlpha = 1;
          if (lit && kd === 'core') { const p = 0.5 + 0.5 * Math.sin(t * 30); disc(c, x + s.w * 0.275, y + 15 * 0.55, 2 + p, C.green); }
        });
        if (k >= 1) msg.classList.add('in');
      }
      if (t >= 1) { setTimeout(finish, reduce ? 0 : 500); return; }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

export function titleScreen(o: { hasSave: boolean; onStart: () => void; onContinue: () => void; onWatch: () => void; account?: string | null; onProfile?: () => void }): HTMLElement {
  let confirmNew = false;
  const actions = h('div', { class: 'actions' });
  const draw = () => actions.replaceChildren(...(o.hasSave
    ? [h('button', { class: 'btn big orange', type: 'button', id: 'btnContinue', onclick: o.onContinue }, 'CONTINUE COLONY'),
      confirmNew ? h('button', { class: 'btn big red', type: 'button', id: 'btnNewConfirm', onclick: o.onStart }, 'REPLACE SAVE?') : h('button', { class: 'btn big', type: 'button', id: 'btnNew', onclick: () => { confirmNew = true; draw(); } }, 'NEW COLONY'),
      h('button', { class: 'btn big green', type: 'button', id: 'btnWatch', onclick: o.onWatch }, 'WATCH SIMULATION')]
    : [h('button', { class: 'btn big orange', type: 'button', id: 'btnStart', onclick: o.onStart }, 'START COLONY'), h('button', { class: 'btn big green', type: 'button', id: 'btnWatch', onclick: o.onWatch }, 'WATCH SIMULATION')]));
  draw();
  return h('div', { class: 'title' }, h('div', { class: 'titlecard' },
    h('div', { class: 'brand' }, 'MARS MIND', h('span', { class: 'chip core' }, '● CORE ONLINE'), o.account ? h('button', { class: 'chip acct', type: 'button', id: 'btnProfile', onclick: o.onProfile }, o.account) : null),
    h('h1', null, h('span', { class: 'a' }, 'Build the colony.'), h('span', { class: 'b' }, 'Command the AI.')),
    h('p', { class: 'sub' }, 'Run a living Mars base using natural language.'),
    actions,
    h('div', { class: 'how' }, h('span', null, '💬 YOU ASK'), h('b', null, '→'), h('span', null, '🧠 CORE PLANS'), h('b', null, '→'), h('span', null, '🤖 ROBOTS BUILD'))));
}
