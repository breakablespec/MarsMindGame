// Player profile: balance, achievements, earnings, and the shareable player card (quote post + ref link).

import { CONFIG } from '../account/config';
import { ACHIEVEMENTS, account, fmt, quoteIntent, refLink, unlocked } from '../account/account';
import { STAGE_INFO, type ModuleKind } from '../sim/defs';
import { onlineModules } from '../sim/colony';
import type { Game } from '../engine/game';
import { canvas, disc, rect } from '../render/pix';
import { C } from '../render/palette';
import { moduleSprite } from '../render/modules';
import { robotSprite } from '../render/units';
import { h } from './dom';

const hash = (s: string) => { let v = 2166136261; for (const ch of s) { v ^= ch.charCodeAt(0); v = Math.imul(v, 16777619); } return v >>> 0; };

/** 16×16 astronaut helmet, colour picked from the handle. */
function avatar(handle: string): HTMLCanvasElement {
  const [cv, c] = canvas(16, 16);
  const cols = [C.orange, C.cyan, C.green, C.yellow, C.rare[1], C.red, C.ice[2]];
  const suit = cols[hash(handle) % cols.length];
  rect(c, 3, 1, 10, 12, C.ink); rect(c, 4, 2, 8, 10, C.ti[5]);
  rect(c, 5, 4, 6, 5, C.ink); rect(c, 6, 5, 4, 3, C.cyanD); rect(c, 6, 5, 2, 1, C.cyanL);
  rect(c, 2, 12, 12, 4, C.ink); rect(c, 3, 13, 10, 3, suit); rect(c, 7, 13, 2, 3, C.ti[5]);
  return cv;
}

export function renderPlayerCard(g: Game): HTMLCanvasElement {
  const a = account()!;
  const W = 400, H = 225;
  const [cv, c] = canvas(W, H);
  const font = (px: number) => `${px}px Silkscreen, monospace`;
  const text = (t: string, x: number, y: number, col: string, px = 8, align: CanvasTextAlign = 'left') => { c.font = font(px); c.textAlign = align; c.fillStyle = col; c.fillText(t, x, y); };
  // sky + stars
  rect(c, 0, 0, W, H, '#0b0810');
  for (let i = 0; i < 90; i++) rect(c, (i * 53 + 7) % W, (i * 37) % 150, 1, 1, i % 4 ? '#3a3050' : '#ffffff');
  disc(c, 352, 46, 20, C.mars[2]); disc(c, 346, 40, 6, C.mars[4]); disc(c, 360, 54, 4, C.mars[1]);
  // Mars ground with the player's colony
  rect(c, 0, 168, W, 57, C.mars[3]); rect(c, 0, 168, W, 2, C.mars[5]);
  for (let i = 0; i < 140; i++) rect(c, (i * 37) % W, 172 + ((i * 17) % 50), 2, 1, i % 2 ? C.mars[2] : C.mars[5]);
  const kinds: ModuleKind[] = g.st && !g.st.demo ? onlineModules(g.st).filter((m) => m.kind !== 'pad').map((m) => m.kind) : ['habitat', 'oxygen', 'solar', 'core', 'command', 'storage'];
  let x = 196;
  for (const k of kinds.slice(0, 8)) { const s = moduleSprite(k); const sc = 0.45; const w = s.w * sc, hh = s.h * sc; if (x + w > W - 6) break; c.drawImage(s.cv, x, 196 - hh, w, hh); x += w + 2; }
  c.drawImage(robotSprite('miner', 'right', 0), 170, 184); c.drawImage(robotSprite('builder', 'down', 0), 150, 186);
  // header
  text('MARS MIND', 14, 18, C.mars[6]);
  text('COMMANDER', 14, 30, '#9a8c78');
  // avatar + handle + balance
  rect(c, 12, 38, 52, 52, C.ink); rect(c, 14, 40, 48, 48, '#1d1828');
  c.imageSmoothingEnabled = false; c.drawImage(avatar(a.handle), 14, 40, 48, 48);
  text(`@${a.handle}`, 74, 56, '#ffffff', a.handle.length > 11 ? 12 : 16);
  text(`◈ ${fmt(a.tokens)} ${CONFIG.currency}`, 74, 74, C.yellow, 8);
  text(`${STAGE_INFO[a.stats.bestStage].name.toUpperCase()} · BEST SOL ${a.stats.bestSol || 1}`, 74, 88, C.green, 8);
  // stats
  const stats: [string, string][] = [['SOLS', String(a.stats.sols)], ['MODULES', String(a.stats.modules)], ['ROBOTS', String(a.stats.robots)], ['RESEARCH', String(a.stats.research)], ['STORMS', String(a.stats.storms)], ['SCORE', String(a.stats.bestScore)]];
  stats.forEach(([k, v], i) => { const sx = 14 + i * 62, sy = 108; rect(c, sx, sy, 58, 26, C.ink); rect(c, sx + 1, sy + 1, 56, 24, '#1d1828'); text(k, sx + 5, sy + 10, '#9a8c78'); text(v, sx + 5, sy + 21, '#ffffff', 8); });
  // achievements
  const got = unlocked().map((u) => u.id);
  text(`ACHIEVEMENTS ${got.length}/${ACHIEVEMENTS.length}`, 14, 150, C.mars[6]);
  ACHIEVEMENTS.forEach((ach, i) => {
    const bx = 128 + i * 22, by = 140, on = got.includes(ach.id);
    rect(c, bx, by, 18, 18, C.ink); rect(c, bx + 1, by + 1, 16, 16, on ? C.yellowD : '#2a2236');
    if (on) rect(c, bx + 2, by + 2, 14, 14, C.yellow);
    c.font = '10px monospace'; c.textAlign = 'center'; c.fillStyle = on ? C.ink : '#4a4058'; c.fillText(ach.icon.slice(0, 2), bx + 9, by + 13);
  });
  // footer
  rect(c, 0, H - 16, W, 16, C.ink);
  text(`JOIN WITH CODE ${a.ref}`, 10, H - 5, C.green);
  text('BUILT WITH AI CORE', W - 10, H - 5, C.mars[6], 8, 'right');
  return cv;
}

function bigCard(g: Game) {
  const cv = renderPlayerCard(g);
  const big = document.createElement('canvas');
  big.width = cv.width * 3; big.height = cv.height * 3;
  const bc = big.getContext('2d')!; bc.imageSmoothingEnabled = false; bc.drawImage(cv, 0, 0, big.width, big.height);
  return big;
}

async function saveCanvas(big: HTMLCanvasElement, filename: string, g: Game) {
  const blob: Blob | null = await new Promise((r) => big.toBlob((b) => r(b), 'image/png'));
  if (!blob) return;
  try {
    const w = window as unknown as { claude?: { use?: (n: string) => Promise<{ save: (o: { filename: string; data: Blob }) => Promise<unknown> } | null> } };
    const dl = w.claude?.use ? await w.claude.use('downloads') : null;
    if (dl) { await dl.save({ filename, data: blob }); g.toast('Card saved', 'good'); return; }
  } catch { /* fall back to a plain download */ }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  g.toast('Card saved', 'good');
}

export function profileBody(g: Game): HTMLElement {
  const a = account();
  if (!a) return h('div', { class: 'term' }, 'Not logged in.');
  const big = bigCard(g);
  const card = h('img', { src: big.toDataURL('image/png'), class: 'pcard', alt: 'Player card' });
  const got = new Set(unlocked().map((u) => u.id));
  const copy = async () => { try { await navigator.clipboard.writeText(refLink()); g.toast('Ref link copied', 'good'); } catch { g.toast(refLink(), 'info'); } };
  return h('div', { class: 'profile' },
    h('div', { class: 'phead' },
      h('div', null, h('b', { class: 'lt' }, `@${a.handle}`), h('div', { class: 'bal' }, h('span', { class: 'big-num' }, fmt(a.tokens)), ` ${CONFIG.currency}`))),
    card,
    h('div', { class: 'share' },
      h('button', { class: 'btn green', type: 'button', onclick: () => void saveCanvas(big, `commander-${a.handle}.png`, g) }, '1 · SAVE CARD'),
      h('a', { class: 'btn orange', href: quoteIntent(), target: '_blank', rel: 'noopener noreferrer' }, '2 · QUOTE ON 𝕏'),
      h('button', { class: 'btn', type: 'button', onclick: () => void copy() }, 'COPY REF LINK')),
    h('div', { class: 'muted small' }, 'Attach the saved card to your quote post.'),
    h('div', { class: 'reflink', title: 'Your referral link' }, refLink()),
    h('h3', null, `Achievements · ${got.size}/${ACHIEVEMENTS.length}`),
    h('div', { class: 'achs' }, ACHIEVEMENTS.map((x) => h('div', { class: `ach ${got.has(x.id) ? 'on' : ''}`, title: `${x.name} · +${fmt(x.reward)}` }, h('i', null, x.icon), h('span', null, x.name), h('b', null, got.has(x.id) ? '✓' : `+${fmt(x.reward)}`)))),
    h('h3', null, 'Recent earnings'),
    h('div', { class: 'ledger' }, a.ledger.slice(0, 8).map((l) => h('div', null, h('span', null, l.reason), h('b', null, `+${fmt(l.amount)}`)))),
    a.referredBy ? h('div', { class: 'muted small' }, `Invited by ${a.referredBy}`) : null);
}
