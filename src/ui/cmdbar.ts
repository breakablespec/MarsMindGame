// ASK CORE: the natural-language command bar, plan cards, and task feedback.

import { RES, ResId } from '../sim/defs';
import { available } from '../sim/storage';
import type { Task } from '../sim/state';
import type { Game, Pending } from '../engine/game';
import type { Label, Plan } from '../ai/planner';
import { aiStatus } from '../ai/llm';
import { analyze } from '../ai/analysis';
import { recommend } from '../ai/advice';
import { $, h, img } from './dom';
import { eyeUrl, resUrl } from './icons';

const EXAMPLES = ['Build a second oxygen generator', 'Send drones for titanium', 'Build another solar panel', 'Fix the power problem', 'Prepare for a dust storm', 'Make the colony safer', 'Mine whatever resource we are lowest on', 'Keep everyone alive', 'What should we do next?', 'Prioritize oxygen over research', 'Build a habitat for 6 more colonists', 'Clean the solar panels every morning'];

export class CommandBar {
  el = $('#cmd');
  log: HTMLElement;
  input: HTMLInputElement;
  ex: HTMLElement;
  visible = false;
  thinkEl: HTMLElement | null = null;
  currentPlanEl: HTMLElement | null = null;
  hideT = 0;
  constructor(private g: Game) {
    this.log = h('div', { class: 'log' });
    this.input = h('input', { type: 'text', placeholder: 'ASK CORE ANYTHING…  e.g. "Build a second oxygen generator"', maxlength: '220', 'aria-label': 'Command for CORE' }) as HTMLInputElement;
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { const v = this.input.value; this.input.value = ''; void this.g.ask(v); }
      if (e.key === 'Escape') this.hide();
      if (e.key === 'Tab') { e.preventDefault(); this.hide(); this.g.open('core', 'ask'); }
    });
    this.ex = h('div', { class: 'examples' });
    this.el.classList.add('panel');
    this.el.replaceChildren(
      h('div', { class: 'hd' }, img(eyeUrl(), 'ico'), 'ASK CORE', h('span', { class: 'st', id: 'cmd-st' }), h('button', { class: 'x', type: 'button', onclick: () => this.hide() }, '×')),
      this.log,
      h('div', { class: 'askrow' }, this.input, h('button', { class: 'btn green', type: 'button', onclick: () => { const v = this.input.value; this.input.value = ''; void this.g.ask(v); } }, 'SEND')),
      this.ex);
  }
  typing() { return this.visible && document.activeElement === this.input; }
  show() {
    clearTimeout(this.hideT);
    this.visible = true;
    this.el.hidden = false;
    const st = aiStatus();
    $('#cmd-st').textContent = st === 'ready' ? '● CLAUDE CONNECTED · natural language' : st === 'denied' ? '● BUILT-IN PARSER (Claude not allowed)' : '● BUILT-IN PARSER';
    this.examples();
    if (!this.log.children.length) this.coreSaid(`${this.status()} What next?`, 'CORE MODEL');
    setTimeout(() => this.input.focus(), 30);
  }
  hide() { this.visible = false; this.el.hidden = true; this.input.blur(); }
  prefill(t: string) { this.input.value = t; this.input.focus(); }
  private status() {
    const a = analyze(this.g.st);
    return `O₂ ${Math.round(a.o2.pct * 100)}% · ⚡ ${a.power.net >= 0 ? '+' : ''}${a.power.net.toFixed(1)} kW · ${a.pop} colonists.`;
  }
  examples() {
    const a = analyze(this.g.st);
    const rec = recommend(this.g.st, a);
    const chips: HTMLElement[] = [];
    if (rec.cmd) chips.push(h('button', { class: 'ex rec', type: 'button', title: 'CORE recommendation', onclick: () => { this.userSaid(rec.label); void this.g.handleCommand(rec.cmd!, rec.label, 'CORE MODEL'); } }, `▶ ${rec.label}`));
    for (const e of EXAMPLES.slice(0, rec.cmd ? 5 : 6)) chips.push(h('button', { class: 'ex', type: 'button', onclick: () => void this.g.ask(e) }, e));
    this.ex.replaceChildren(...chips);
  }
  private push(el: HTMLElement) {
    this.log.append(el);
    while (this.log.children.length > 24) this.log.firstElementChild!.remove();
    requestAnimationFrame(() => {
      // show the newest message from its top (plan cards can be taller than the log)
      const top = el.offsetTop - this.log.offsetTop - 4;
      this.log.scrollTop = el.offsetHeight > this.log.clientHeight ? top : this.log.scrollHeight;
    });
  }
  userSaid(text: string) { this.push(h('div', { class: 'msg you' }, h('span', { class: 'who' }, 'YOU'), h('span', { class: 'txt' }, text))); }
  coreSaid(text: string, label: Label | 'CORE MODEL' = 'CORE MODEL') { this.push(h('div', { class: 'msg core' }, h('span', { class: 'who' }, 'CORE'), h('div', { class: 'txt' }, h('div', { class: 'say' }, label === 'AI PLAN' ? h('span', { class: 'chip ai' }, 'CLAUDE') : null, text)))); }
  note(text: string) { this.push(h('div', { class: 'msg note' }, text)); }
  thinking(on: boolean) {
    this.thinkEl?.remove(); this.thinkEl = null;
    if (on) { this.thinkEl = h('div', { class: 'msg core' }, h('span', { class: 'who' }, 'CORE'), h('div', { class: 'thinking' }, h('i'), h('i'), h('i'), h('span', null, 'PLANNING…'))); this.push(this.thinkEl); }
  }

  showPlan(p: Plan, text: string, label: Label, pending: Pending | null) {
    const g = this.g;
    const kind = p.kind === 'emergency' ? 'emergency' : p.kind === 'info' ? 'info' : p.kind === 'refuse' ? 'refuse' : '';
    // compact stat chips; long values keep their full text in the tooltip
    const ICON: Record<string, string> = { location: '⌖', power: '⚡', 'build time': '⏱', 'est. time': '⏱', time: '⏱', distance: '↔', route: '↔', robots: '⚙', robot: '⚙', deposit: '◆', oxygen: 'O₂', colonists: '☺' };
    const shortV = (v: string) => v.replace(/\s*\([^)]*\)/g, '').trim();
    const result = p.details.find((d) => d.label === 'Result');
    const chips = p.details.filter((d) => d !== result && !(p.cost && d.label === 'Cost') && !(d.label === 'Power' && result && /^POWER/i.test(result.value))).map((d) => {
      const ic = ICON[d.label.toLowerCase()];
      return h('span', { class: `stat ${d.tone ?? ''}`, title: `${d.label}: ${d.value}`, 'data-detail': d.label }, ic ? h('i', null, ic) : h('i', { class: 'lbl' }, d.label.toUpperCase()), shortV(d.value));
    });
    const costs = p.cost ? h('div', { class: 'costs' }, Object.entries(p.cost).filter(([, q]) => q).map(([r, q]) => { const have = available(g.st, r as ResId); return h('span', { class: `cost ${have < (q ?? 0) ? 'short' : ''}`, title: `${RES[r as ResId].name}: have ${have}, need ${q}` }, img(resUrl(r as ResId), 'ico sm'), `${q}`, h('span', { class: 'muted' }, ` /${have}`)); })) : null;
    const acts = h('div', { class: 'acts' });
    const more = p.steps.length || p.why.length ? h('details', { class: 'more' },
      h('summary', null, p.steps.length ? `HOW · ${p.steps.length} STEPS` : 'WHY'),
      p.steps.length ? h('ol', null, p.steps.map((s) => h('li', null, s))) : null,
      p.why.length ? h('div', { class: 'why' }, p.why.map((w) => h('div', null, `• ${w}`))) : null) : null;
    const card = h('div', { class: `plan ${kind}` },
      h('div', { class: 'ph' }, h('span', { class: 'grow' }, p.title.replace(/^BUILD PLAN · /, 'BUILD · ')), label === 'AI PLAN' ? h('span', { class: 'chip ai' }, 'CLAUDE') : null),
      h('div', { class: 'pb' },
        h('div', { class: 'term' }, p.reply),
        result ? h('div', { class: 'result', title: result.value }, '→ ', shortV(result.value)) : null,
        chips.length ? h('div', { class: 'stats' }, chips) : null,
        costs,
        acts,
        more));
    const btn = (label2: string, cls: string, on: () => void) => h('button', { class: `btn small ${cls}`, type: 'button', onclick: on }, label2);
    const lock = () => { for (const b of acts.querySelectorAll('button')) (b as HTMLButtonElement).disabled = true; };
    if (pending && p.exec) {
      if (p.confirm === 'yes') acts.append(btn('YES', 'green', () => { lock(); g.confirmPending(); }), btn('EDIT PLAN', '', () => { lock(); g.clearPreview(); this.prefill(text); }), btn('CANCEL', '', () => { lock(); g.cancelPending(); }));
      else if (p.confirm === 'build') {
        acts.append(btn(p.kind === 'build' && p.intent !== 'safety' ? 'BUILD' : 'EXECUTE', 'orange', () => { lock(); g.confirmPending(); }));
        if (p.sites && p.sites.options.length > p.sites.count) acts.append(btn('CHANGE LOCATION', '', () => g.changeLocation()));
        acts.append(btn('CANCEL', '', () => { lock(); g.cancelPending(); }));
        if (p.sites) acts.append(h('span', { class: 'muted small' }, 'or tap the map'));
      } else acts.append(btn('EXECUTE', 'orange', () => { lock(); g.confirmPending(); }), btn('CANCEL', '', () => { lock(); g.cancelPending(); }));
    }
    for (const o of p.offers) acts.append(btn(o.label, o.primary ? 'cyan' : '', () => { this.userSaid(o.label); for (const c of o.cmds) void g.handleCommand(c, o.label, 'CORE MODEL'); }));
    if (!acts.children.length) acts.remove();
    this.currentPlanEl = card;
    this.push(h('div', { class: 'msg core' }, h('span', { class: 'who' }, 'CORE'), h('div', { class: 'txt' }, card)));
  }
  updateLocation(zone: string) {
    const el = this.currentPlanEl?.querySelector('[data-detail="Location"]');
    if (el) el.replaceChildren(h('i', null, '⌖'), zone);
  }
  started(p: Plan, tasks: Task[]) {
    if (this.currentPlanEl) for (const b of this.currentPlanEl.querySelectorAll('button')) (b as HTMLButtonElement).disabled = true;
    if (!tasks.length) { this.push(h('div', { class: 'started' }, `✓ ${p.title} — applied`)); }
    else this.push(h('div', { class: 'started' }, `▶ ${tasks.map((t) => `TASK #${t.id} ${t.title}`).join('  ·  ')}${p.estSec ? `  ·  ~${Math.round(p.estSec)}s` : ''}`));
    clearTimeout(this.hideT);
    this.hideT = window.setTimeout(() => { if (this.visible && !this.input.value.trim()) this.hide(); }, this.g.mode === 'watch' ? 3500 : 1800);
  }
  taskFinished(id: number, title: string, result: string, ok: boolean) {
    if (!this.visible) return;
    this.push(h('div', { class: 'msg core' }, h('span', { class: 'who' }, 'CORE'), h('div', { class: 'txt' }, h('div', { class: 'say' }, `${ok ? '✓' : '✗'} TASK #${id} ${title}${result ? ` — ${result}` : ''}`))));
  }
}
