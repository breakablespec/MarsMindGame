// CORE briefing (tutorial): one instruction at a time, completed by real game events.

import type { Game } from '../engine/game';
import { $, h, img } from './dom';
import { eyeUrl } from './icons';

interface Step { title: string; text: string; done: (ev: string) => boolean; cmd?: string; hint?: string; after?: (g: Game) => void }
const STEPS: Step[] = [
  { title: 'OXYGEN + POWER', text: 'Oxygen + power keep everyone alive. Tap OXYGEN or POWER up top.', done: (e) => e === 'tab:oxygen' || e === 'tab:power' },
  { title: 'YOUR ROBOTS', text: 'Robots do all the work. Tap MINER-01 on the map.', done: (e) => e === 'select:robot', after: (g) => { const m = g.st.robots.find((r) => r.kind === 'miner'); if (m) g.focusTile(Math.floor(m.x / 16), Math.floor(m.y / 16)); } },
  { title: 'GIVE A COMMAND', text: 'Tell CORE what to build. Tap the button, then BUILD.', cmd: 'Build another solar panel', done: (e) => e.startsWith('exec:build') },
  { title: 'WATCH IT HAPPEN', text: 'Watch: haul → assemble → connect → ONLINE.', done: (e) => e.startsWith('online:') },
  { title: 'THE BIG ONE', text: 'The big one: a second oxygen generator.', cmd: 'Build a second oxygen generator', done: (e) => e.startsWith('exec:build:oxygen') || e === 'exec:build:' },
  { title: 'TITANIUM', text: 'Titanium is low. Send drones east.', cmd: 'Send drones for titanium', done: (e) => e.startsWith('exec:mine') || e.startsWith('exec:explore') },
];

export class Briefing {
  el: HTMLElement;
  constructor(private g: Game) {
    this.el = h('div', { class: 'brief', hidden: true });
    $('#hud').append(this.el);
  }
  get st() { return this.g.st; }
  active() { return !this.st.briefing.done && this.st.briefing.offered && this.st.briefing.step > 0; }
  visible() { return !this.el.hidden; }
  hide() { this.el.hidden = true; }
  begin() { this.st.briefing = { step: 0, done: false, offered: false }; setTimeout(() => this.offer(), 900); }
  restart() { this.st.briefing = { step: 1, done: false, offered: true }; $('#hud').append(this.el); this.render(); }
  resume() { if (this.st.briefing.done) { this.hide(); return; } $('#hud').append(this.el); if (this.st.briefing.offered && this.st.briefing.step > 0) this.render(); else this.offer(); }
  offer() {
    if (this.g.mode !== 'play' || this.st.briefing.done) return;
    $('#hud').append(this.el);
    this.el.hidden = false;
    this.el.replaceChildren(h('div', { class: 'step' }, img(eyeUrl(), 'ico'), h('span', null, 'CORE'), 'ONLINE'),
      h('p', null, 'Outpost online. Quick briefing?'),
      h('div', { class: 'row' }, h('button', { class: 'btn green', type: 'button', onclick: () => { this.st.briefing = { step: 1, done: false, offered: true }; this.render(); this.g.sound('core'); } }, 'YES'), h('button', { class: 'btn small ghost', type: 'button', style: 'color:var(--green)', onclick: () => this.skip() }, 'SKIP')));
    this.g.sound('core');
  }
  skip() { this.st.briefing = { step: 99, done: true, offered: true }; this.hide(); this.g.toast('Q = ask CORE · TAB = command centre', 'core'); }
  render() {
    const n = this.st.briefing.step;
    const s = STEPS[n - 1];
    if (!s) return;
    this.el.hidden = false;
    this.el.replaceChildren(
      h('div', { class: 'step' }, h('span', null, `BRIEFING ${n}/${STEPS.length}`), s.title),
      h('p', null, s.text),
      h('div', { class: 'row' },
        s.cmd ? h('button', { class: 'btn small green', type: 'button', onclick: () => { this.g.cmd.show(); void this.g.ask(s.cmd!); } }, `"${s.cmd}"`) : null,
        h('button', { class: 'btn small ghost', type: 'button', style: 'color:var(--green)', onclick: () => this.skip() }, 'SKIP')));
    s.after?.(this.g);
  }
  event(ev: string) {
    if (!this.active()) return;
    const s = STEPS[this.st.briefing.step - 1];
    if (!s || !s.done(ev)) return;
    this.st.briefing.step++;
    if (this.st.briefing.step > STEPS.length) {
      this.st.briefing.done = true;
      this.hide();
      this.g.toast('Briefing done', 'big');
      this.g.sound('stage');
      return;
    }
    this.g.sound('done');
    setTimeout(() => this.render(), 400);
  }
  tick() { /* events drive progress */ }
}
