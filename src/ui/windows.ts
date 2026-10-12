// Modal windows: CORE command centre, reports, help, settings, stage-up, colony card.

import type { Game } from '../engine/game';
import type { Report } from '../sim/state';
import { STAGE_INFO, Stage } from '../sim/defs';
import { clearSave } from '../sim/save';
import { newColony } from '../sim/init';
import { setMusic, setSfx } from '../audio/synth';
import { $, h } from './dom';
import { buildCore, CoreTab } from './core';
import { colonyCard } from './card';
import { profileBody } from './profile';

export type WinKind = 'core' | 'settings' | 'help' | 'report' | 'away' | 'stage' | 'lost' | 'card' | 'profile';

export class Windows {
  layer = $('#layer');
  current: WinKind | null = null;
  tab: CoreTab = 'ask';
  arg: unknown;
  timer = 0;
  musicOn = true; sfxOn = true;
  constructor(private g: Game) {
    this.layer.addEventListener('pointerdown', (e) => { if (e.target === this.layer && this.current !== 'lost') this.close(); });
  }
  open(kind: WinKind, arg?: unknown) {
    this.current = kind; this.arg = arg;
    if (kind === 'core' && typeof arg === 'string') this.tab = arg as CoreTab;
    this.render();
    this.layer.hidden = false;
    clearInterval(this.timer);
    if (kind === 'core') this.timer = window.setInterval(() => this.refresh(), 1000);
    this.g.sound('open');
    if (kind === 'core') this.g.brief.event(`tab:${this.tab}`);
  }
  close() { if (!this.current) return; this.current = null; this.layer.hidden = true; this.layer.replaceChildren(); clearInterval(this.timer); this.g.sound('close'); }
  setTab(t: CoreTab) { this.tab = t; this.render(); this.g.brief.event(`tab:${t}`); }
  refresh() {
    if (this.current !== 'core') return;
    if (document.activeElement && (document.activeElement as HTMLElement).tagName === 'INPUT') return;
    const wb = this.layer.querySelector('.wb');
    const top = wb?.scrollTop ?? 0;
    this.render();
    const nb = this.layer.querySelector('.wb');
    if (nb) nb.scrollTop = top;
  }
  render() {
    const g = this.g;
    const k = this.current;
    if (!k) return;
    let title = '', body: HTMLElement, cls = '';
    switch (k) {
      case 'core': { const r = buildCore(g, this.tab); title = r.title; body = r.body; cls = 'core'; break; }
      case 'settings': title = 'SETTINGS'; cls = 'narrow'; body = h('div', { class: 'list' },
        h('div', { class: 'line' }, h('span', { class: 'grow' }, 'Music'), h('button', { class: `toggle ${this.musicOn ? 'on' : ''}`, type: 'button', onclick: () => { this.musicOn = !this.musicOn; setMusic(this.musicOn); this.render(); } }, this.musicOn ? 'ON' : 'OFF')),
        h('div', { class: 'line' }, h('span', { class: 'grow' }, 'Sound effects'), h('button', { class: `toggle ${this.sfxOn ? 'on' : ''}`, type: 'button', onclick: () => { this.sfxOn = !this.sfxOn; setSfx(this.sfxOn); this.render(); } }, this.sfxOn ? 'ON' : 'OFF')),
        h('div', { class: 'line' }, h('span', { class: 'grow' }, 'Controls & help'), h('button', { class: 'btn small', type: 'button', onclick: () => this.open('help') }, 'OPEN')),
        h('div', { class: 'line' }, h('span', { class: 'grow' }, 'Briefing (tutorial)'), h('button', { class: 'btn small', type: 'button', onclick: () => { this.close(); g.brief.restart(); } }, 'RESTART')),
        h('div', { class: 'line' }, h('span', { class: 'grow' }, 'Profile + player card'), h('button', { class: 'btn small green', type: 'button', onclick: () => this.open('profile') }, 'OPEN')),
        h('div', { class: 'line' }, h('span', { class: 'grow' }, 'Save now (autosaves every 15 s)'), h('button', { class: 'btn small', type: 'button', onclick: () => { g.save(); g.toast('Colony saved', 'good'); } }, 'SAVE')),
        h('div', { class: 'line' }, h('span', { class: 'grow' }, 'Title screen'), h('button', { class: 'btn small', type: 'button', onclick: () => { g.save(); this.close(); g.showTitle(); } }, 'EXIT')),
        h('div', { class: 'line' }, h('span', { class: 'grow' }, 'Abandon this colony and start over'), h('button', { class: 'btn small red', type: 'button', onclick: (e: MouseEvent) => { const b = e.currentTarget as HTMLButtonElement; if (b.dataset.sure) { clearSave(); this.close(); g.startColony(newColony(), true); } else { b.dataset.sure = '1'; b.textContent = 'REALLY?'; } } }, 'NEW COLONY'))); break;
      case 'help': title = 'CONTROLS'; cls = 'narrow'; body = h('div', { class: 'kv' }, ...([
        ['Q / ENTER', 'Ask CORE (natural language)'], ['TAB', 'CORE command centre'], ['WASD / ARROWS', 'Move the camera (or drive a robot)'], ['DRAG', 'Pan the map'], ['WHEEL / + −', 'Zoom'], ['CLICK', 'Inspect robots, modules, deposits'], ['B', 'Build menu (place by hand)'], ['R', 'Robots'], ['L', 'Research'], ['O', 'Cycle overlays: power, oxygen, resources, robot paths'], ['SPACE', 'Pause'], ['1 2 3', 'Speed 1× 2× 4×'], ['F', 'Follow the selected robot'], ['E', 'Act while driving a robot'], ['ESC', 'Cancel / close / settings'],
      ] as [string, string][]).flatMap(([a, b]) => [h('b', null, a), h('span', null, b)])); break;
      case 'report': { const r = this.arg as Report; title = `SOL ${r.sol} COMPLETE`; cls = 'narrow ok'; body = h('div', { class: 'list' }, h('div', { class: 'term' }, ...r.lines.map((l) => h('div', null, l))), r.learned.length ? h('div', { class: 'term' }, ...r.learned.map((l) => h('div', null, `▶ ${l}`))) : null, h('div', { class: 'line' }, h('span', { class: 'grow' }, 'COLONY SCORE'), h('span', { class: 'big-num' }, String(r.score))), h('button', { class: 'btn green', type: 'button', onclick: () => this.close() }, 'CONTINUE')); break; }
      case 'away': { const lines = this.arg as string[]; title = 'WHILE YOU WERE AWAY'; cls = 'narrow core'; body = h('div', { class: 'list' }, h('div', { class: 'term' }, ...lines.map((l) => h('div', null, l))), h('button', { class: 'btn green', type: 'button', onclick: () => this.close() }, 'THANKS, CORE')); break; }
      case 'stage': { const d = this.arg as { stage: Stage; name: string; unlocks: string }; title = `STAGE UP · ${d.name}`; cls = 'narrow ok'; body = h('div', { class: 'list' }, h('div', { class: 'term' }, `The outpost is now a ${d.name}.`), h('div', { class: 'line' }, h('b', null, 'UNLOCKED'), h('span', null, STAGE_INFO[d.stage].unlocks)), h('button', { class: 'btn green', type: 'button', onclick: () => this.close() }, 'ONWARD')); break; }
      case 'lost': title = 'COLONY LOST'; cls = 'narrow alert'; body = h('div', { class: 'list' }, h('div', { class: 'term' }, 'Every colonist has been lost. CORE kept the logs.'), h('div', { class: 'timeline' }, ...g.st.history.slice(-8).map((e) => h('div', { class: 'e' }, h('b', null, `SOL ${e.sol}`), h('span', null, e.text)))), h('button', { class: 'btn orange', type: 'button', onclick: () => { clearSave(); this.close(); g.startColony(newColony(), true); } }, 'START A NEW COLONY')); break;
      case 'card': title = 'COLONY CARD'; cls = ''; body = colonyCard(g); break;
      case 'profile': title = 'COMMANDER PROFILE'; cls = 'profilewin'; body = profileBody(g); break;
    }
    this.layer.replaceChildren(h('div', { class: `win ${cls}`, role: 'dialog', 'aria-label': title }, h('div', { class: 'wh' }, title, h('button', { class: 'x', type: 'button', onclick: () => this.close() }, '×')), h('div', { class: 'wb' }, body)));
  }
}
