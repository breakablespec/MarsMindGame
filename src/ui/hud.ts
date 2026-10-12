// HUD: top status bar, minimap, alerts, task card, objective, bottom command bar, inspector,
// world-space labels, toasts and the end-of-sol card.

import { CAT_NAME, DEPOSIT, MODULES, RES, ResId, ROBOTS, STAGE_INFO, TUNE } from '../sim/defs';
import { activeAlerts, clock, realMinutes, sol, hour } from '../sim/core';
import { o2Cap, batteryCap, waterCap, genOf } from '../sim/power';
import { o2ReserveHours, alive } from '../sim/life';
import { totalSolids, totalCap, usedOf, capOf } from '../sim/storage';
import { liveTasks, taskById, assignedRobots } from '../sim/tasks';
import { nextStage, stageProgress } from '../sim/colony';
import { weatherLabel } from '../sim/environment';
import { efficiency } from '../sim/robots';
import { MAP_H, MAP_W, explored, idx, terrain, T } from '../sim/world';
import type { Game } from '../engine/game';
import type { Alert } from '../sim/state';
import { $, fill, h, img } from './dom';
import { boltUrl, dropUrl, eyeUrl, hotUrl, o2Url, crateUrl, resUrl, robotUrl, moduleUrl } from './icons';
import { coreVersion } from '../ai/perf';
import { account, fmt } from '../account/account';
import { CONFIG } from '../account/config';

export class Hud {
  el = $('#hud');
  world = $('#world-ui');
  mini: HTMLCanvasElement;
  sig = new Map<string, string>();
  constructor(private g: Game) {
    this.mini = document.createElement('canvas');
    this.mini.width = MAP_W * 2; this.mini.height = MAP_H * 2;
    this.build();
  }
  show(on: boolean) { this.el.hidden = !on; this.world.hidden = !on; if (!on) this.world.replaceChildren(); }

  private build() {
    const g = this.g;
    const seg = (cls: string, id: string, label: Node | string, onclick?: () => void) => h('button', { class: `seg ${cls}`, id, type: 'button', onclick }, h('span', { class: 'lbl' }, label), h('span', { class: 'val', id: `${id}-v` }), h('div', { class: 'bar', id: `${id}-b`, hidden: true }, h('i')));
    const top = h('div', { class: 'top' },
      h('div', { class: 'seg sol', id: 't-sol' }, h('span', { class: 'lbl', id: 't-sol-l' }, 'SOL'), h('span', { class: 'val', id: 't-sol-v' })),
      seg('o2', 't-o2', [img(o2Url(), 'ico sm'), 'OXYGEN'] as unknown as string, () => g.open('core', 'oxygen')),
      seg('pw', 't-pw', [img(boltUrl(), 'ico sm'), 'POWER'] as unknown as string, () => g.open('core', 'power')),
      seg('water', 't-w', [img(dropUrl(), 'ico sm'), 'WATER'] as unknown as string, () => g.open('core', 'oxygen')),
      seg('mat', 't-m', [img(crateUrl(), 'ico sm'), 'MATERIALS'] as unknown as string, () => g.open('core', 'resources')),
      h('button', { class: 'seg tok', id: 't-tok', type: 'button', title: 'Profile', onclick: () => g.open('profile') }, h('span', { class: 'lbl' }, `◈ ${CONFIG.currency}`), h('span', { class: 'val', id: 't-tok-v' })),
      h('button', { class: 'seg core', id: 't-core', type: 'button', onclick: () => g.cmd.show() }, h('span', { class: 'lbl', id: 't-core-l' }, 'AI CORE'), h('span', { class: 'val' }, h('i', { class: 'dot' }), h('span', { id: 't-core-v' }, 'ONLINE'))),
      h('div', { class: 'seg speed', id: 't-speed' }, ...[0, 1, 2, 4].map((s) => h('button', { type: 'button', 'data-s': s, title: s ? `${s}× speed (${s === 4 ? 3 : s})` : 'Pause (space)', onclick: () => (s ? g.setSpeed(s) : g.togglePause()) }, s ? `${s}×` : '❚❚'))),
    );
    const right = h('div', { class: 'right' },
      h('button', { class: 'minibox', type: 'button', title: 'Click to move the camera', onclick: (e: MouseEvent) => { const rc = this.mini.getBoundingClientRect(); const x = ((e.clientX - rc.left) / rc.width) * MAP_W, y = ((e.clientY - rc.top) / rc.height) * MAP_H; g.focusTile(Math.floor(x), Math.floor(y)); } }, this.mini, h('span', { class: 'lbl', id: 'mini-l' }, 'MAP')),
      h('div', { class: 'alerts', id: 'alerts' }));
    const task = h('div', { class: 'taskcard', id: 'taskcard', hidden: true });
    const obj = h('div', { class: 'objective', id: 'objective', hidden: true, onclick: () => g.open('core', 'memory') });
    const hot = (k: 'build' | 'inspect' | 'robots' | 'research' | 'overlay' | 'core', label: string, key: string, on: () => void) => h('button', { class: 'hot', type: 'button', id: `hot-${k}`, onclick: on }, img(hotUrl(k)), h('span', null, label), h('span', { class: 'k' }, key));
    const bottom = h('div', { class: 'bottom' },
      h('div', { class: 'hotbar' },
        hot('build', 'BUILD', 'B', () => g.open('core', 'build')),
        hot('inspect', 'INSPECT', 'CLICK', () => { g.toast('Click any robot, module or deposit to inspect it'); g.brief.event('inspect'); }),
        hot('robots', 'ROBOTS', 'R', () => g.open('core', 'robots')),
        hot('research', 'RESEARCH', 'L', () => g.open('core', 'research')),
        hot('overlay', 'OVERLAY', 'O', () => g.cycleOverlay()),
        hot('core', 'CORE', 'TAB', () => g.open('core', 'tasks'))),
      h('button', { class: 'askbtn', id: 'askbtn', type: 'button', onclick: () => { g.cmd.show(); g.brief.event('ask'); } }, img(eyeUrl(), 'eye'), h('span', null, 'ASK CORE'), h('span', { class: 'k' }, 'Q')));
    const insp = h('div', { class: 'inspector panel', id: 'inspector', hidden: true });
    this.el.replaceChildren(top, right, task, obj, bottom, insp);
  }

  private set(id: string, html: string | (() => Node[]), key?: string) {
    const el = document.getElementById(id);
    if (!el) return;
    if (typeof html === 'string') { if (el.textContent !== html) el.textContent = html; return; }
    if (key !== undefined) { if (this.sig.get(id) === key) return; this.sig.set(id, key); }
    el.replaceChildren(...html());
  }
  private bar(id: string, f: number, cls?: string) {
    const b = document.getElementById(id);
    if (!b) return;
    b.hidden = false;
    const i = b.firstElementChild as HTMLElement;
    const w = `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`;
    if (i.style.width !== w) i.style.width = w;
    if (cls && !b.classList.contains(cls)) { b.className = `bar ${cls}`; }
  }

  update(force: boolean) {
    const g = this.g, st = g.st;
    if (this.el.hidden) return;
    // top bar
    const wl = weatherLabel(st);
    this.set('t-sol-l', `SOL ${sol(st)} · ${STAGE_INFO[st.stage].name}`);
    this.set('t-sol-v', `${clock(st.minute)}${wl.kind !== 'clear' ? ` ${wl.kind === 'night' ? '☾' : wl.kind === 'storm' ? '≋' : wl.kind === 'solar' ? '✶' : wl.kind === 'cold' ? '❄' : '!'}` : ''}`);
    const cap = o2Cap(st), pct = cap ? st.o2 / cap : 0;
    const res = o2ReserveHours(st);
    this.set('t-o2-v', `${Math.round(pct * 100)}%${Number.isFinite(res) && res < 4 ? ` · ${res < 2 ? `${Math.max(1, Math.round(realMinutes(res * 60)))}m` : `${res.toFixed(1)}h`}` : ''}`);
    this.bar('t-o2-b', pct, pct < 0.3 ? 'red' : 'cyan');
    document.getElementById('t-o2')!.classList.toggle('alert', pct < 0.3);
    const net = st.power.gen - st.power.used;
    this.set('t-pw-v', `${net >= 0 ? '+' : ''}${net.toFixed(Math.abs(net) < 10 ? 1 : 0)} kW`);
    const bc = batteryCap(st);
    this.bar('t-pw-b', bc ? st.power.battery / bc : 0, st.power.battery / Math.max(1, bc) < 0.15 ? 'red' : 'yellow');
    document.getElementById('t-pw')!.classList.toggle('alert', st.power.shed.includes('life'));
    document.getElementById('t-pw')!.title = `Generating ${st.power.gen.toFixed(1)} kW · using ${st.power.used.toFixed(1)} kW · battery ${Math.round(st.power.battery)}/${bc} kWh${st.power.shed.length ? ` · paused: ${st.power.shed.map((c) => CAT_NAME[c]).join(', ')}` : ''}`;
    this.set('t-w-v', `${Math.round(st.water)}`);
    this.bar('t-w-b', st.water / Math.max(1, waterCap(st)), 'ti');
    this.set('t-m-v', `${totalSolids(st)}`);
    this.set('t-tok-v', fmt(account()?.tokens ?? 0));
    this.bar('t-m-b', totalSolids(st) / Math.max(1, totalCap(st)), totalSolids(st) / Math.max(1, totalCap(st)) > 0.95 ? 'red' : 'orange');
    const crit = activeAlerts(st).some((a) => a.severity === 'crit');
    const busy = liveTasks(st).filter((t) => t.source !== 'ROUTINE' && t.source !== 'STANDING').length;
    const coreState = g.thinking ? 'think' : crit ? 'alert' : 'idle';
    document.getElementById('t-core')!.dataset.state = coreState;
    this.set('t-core-l', `${coreVersion(st).text} · ${st.core.autonomy.toUpperCase()}`);
    this.set('t-core-v', g.thinking ? 'PLANNING…' : crit ? 'ALERT' : busy ? `ONLINE · ${busy} TASK${busy > 1 ? 'S' : ''}` : 'ONLINE');
    for (const b of document.querySelectorAll<HTMLButtonElement>('#t-speed button')) b.classList.toggle('on', Number(b.dataset.s) === st.speed);
    document.getElementById('hot-overlay')!.classList.toggle('on', g.overlay !== 'none');
    document.getElementById('hot-overlay')!.querySelector('span')!.textContent = g.overlay === 'none' ? 'OVERLAY' : g.overlay.toUpperCase();
    this.drawMini();
    this.alerts();
    this.taskCard();
    this.objective();
    this.inspector(force);
    void force;
  }

  // ---------------------------------------------------------------- minimap
  private miniBase: HTMLCanvasElement | null = null;
  private miniT = 0;
  drawMini() {
    const g = this.g, st = g.st;
    this.miniT--;
    if (this.miniT > 0) return;
    this.miniT = 3;
    const c = this.mini.getContext('2d')!;
    if (!this.miniBase) {
      const b = document.createElement('canvas'); b.width = MAP_W * 2; b.height = MAP_H * 2;
      const bc = b.getContext('2d')!;
      const t = terrain(st);
      const col = ['#cc6331', '#b4532a', '#7d2219', '#7d2219', '#5a1a12', '#f08c50', '#8fd4ff', '#7a3416', '#9aa3b5'];
      for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) { bc.fillStyle = col[t[idx(x, y)]]; bc.fillRect(x * 2, y * 2, 2, 2); }
      this.miniBase = b;
    }
    c.drawImage(this.miniBase, 0, 0);
    const ex = explored(st);
    c.fillStyle = '#0b0810';
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (!ex[idx(x, y)]) c.fillRect(x * 2, y * 2, 2, 2);
    for (const d of st.deposits) { if (!d.found && !d.signal) continue; c.fillStyle = d.found ? (d.kind === 'vent' ? '#ff8a1f' : d.kind === 'debris' ? '#e3e7ef' : RES[DEPOSIT[d.kind].res ?? 'iron'].color) : '#2fe0e8'; c.fillRect(d.x * 2, d.y * 2, 4, 4); }
    for (const m of st.modules) { c.fillStyle = m.status === 'online' ? (m.kind === 'pad' ? '#4a4458' : MODULES[m.kind].color) : '#2fe0e8'; c.fillRect(m.x * 2, m.y * 2, m.w * 2, m.h * 2); }
    for (const r of st.robots) { c.fillStyle = r.state === 'broken' || r.state === 'dead' ? '#ff3b3b' : '#4dff7a'; c.fillRect(Math.floor(r.x / 8) - 1, Math.floor(r.y / 8) - 1, 3, 3); }
    // viewport
    c.strokeStyle = '#ffffff'; c.lineWidth = 1;
    c.strokeRect(Math.round(g.r.camX / 8) + 0.5, Math.round(g.r.camY / 8) + 0.5, Math.round(g.r.w / 8), Math.round(g.r.h / 8));
    this.set('mini-l', `MAP · ${Math.round((Array.from(ex).reduce((a, b) => a + b, 0) / ex.length) * 100)}% CHARTED`);
  }

  // ---------------------------------------------------------------- alerts
  private alerts() {
    const g = this.g, st = g.st;
    const list = activeAlerts(st).filter((a) => !a.dismissed).sort((a, b) => sev(b) - sev(a) || b.since - a.since).slice(0, 5);
    const key = list.map((a) => `${a.id}:${a.title}:${a.detail}`).join('|');
    this.set('alerts', () => list.map((a) => this.alertCard(a)), key);
  }
  private alertCard(a: Alert): HTMLElement {
    const g = this.g;
    const btns: HTMLElement[] = [];
    if (a.kind === 'suggest' && a.cmd) btns.push(h('button', { class: 'btn small green', type: 'button', onclick: () => { try { const c = JSON.parse(a.cmd!); g.cmd.show(); g.cmd.userSaid(a.label ?? 'CORE suggestion'); void g.handleCommand(c, a.label ?? '', 'CORE MODEL'); a.dismissed = true; } catch { /* ignore */ } } }, a.label ?? 'PLAN'));
    else if (a.severity !== 'info' && responseFor(a)) btns.push(h('button', { class: `btn small ${a.severity === 'crit' ? 'red' : 'yellow'}`, type: 'button', onclick: () => { const c = responseFor(a)!; g.cmd.show(); g.cmd.userSaid(`${a.title} — what do we do?`); void g.handleCommand(c, a.title, 'CORE MODEL'); } }, 'CORE PLAN'));
    if (a.target !== undefined) btns.push(h('button', { class: 'btn small', type: 'button', onclick: () => { const m = g.st.modules.find((q) => q.id === a.target); const r = g.st.robots.find((q) => q.id === a.target); if (m) { g.focusTile(m.x + m.w / 2, m.y + m.h / 2); g.select({ kind: 'module', id: m.id }); } else if (r) g.followRobot(r.id); } }, 'SHOW'));
    return h('div', { class: `alert ${a.kind === 'suggest' ? 'suggest' : a.severity}` },
      h('div', { class: 't' }, h('span', null, a.kind === 'suggest' ? '▶ CORE SUGGESTS' : a.title), h('button', { class: 'x', type: 'button', title: 'Dismiss', onclick: () => { a.dismissed = true; this.update(true); } }, '×')),
      h('div', null, a.detail), btns.length ? h('div', { class: 'row' }, btns) : null);
  }

  // ---------------------------------------------------------------- task card
  private taskCard() {
    const g = this.g, st = g.st;
    const el = document.getElementById('taskcard')!;
    const live = liveTasks(st);
    const pick = (g.follow?.taskId ? taskById(st, g.follow.taskId) : undefined) ?? live.find((t) => t.source === 'PLAYER' || t.source === 'BRIEFING') ?? live.find((t) => t.source === 'EMERGENCY' || t.source === 'CORE');
    if (!pick || g.mode === 'title') { el.hidden = true; return; }
    el.hidden = false;
    const who = assignedRobots(st, pick).map((r) => r.name);
    const pctv = Math.round(pick.progress * 100);
    const key = `${pick.id}:${pick.label}:${pctv}:${who.join(',')}:${live.length}`;
    this.set('taskcard', () => [
      h('div', { class: 'h' }, h('span', { class: 'id' }, `TASK #${pick.id}`), h('span', { class: 'grow' }, pick.title.toUpperCase()), h('span', { class: 'chip' }, pick.source === 'EMERGENCY' ? 'EMERGENCY' : pick.source === 'CORE' ? 'CORE' : 'COMMAND'),
        h('button', { class: 'btn small', type: 'button', title: 'Camera follows the robots', onclick: () => { g.follow = { taskId: pick.id }; } }, 'WATCH'),
        h('button', { class: 'btn small', type: 'button', title: 'Cancel task', onclick: () => { import('../sim/tasks').then((m) => { m.cancelTask(g.st, pick, 'Cancelled by commander'); g.toast(`Task #${pick.id} cancelled`); }); } }, '×')),
      h('div', { class: 'st' }, h('span', null, `STATUS: ${pick.label}`), h('span', null, `${pctv}%`)),
      h('div', { class: 'bar' }, h('i', { style: `width:${pctv}%` })),
      h('div', { class: 'who' }, who.length ? `Assigned: ${who.join(', ')}` : pick.after.length && pick.status === 'waiting' ? `Waiting for task #${pick.after.join(', #')}` : 'Waiting for a free robot', live.length > 1 ? ` · ${live.length - 1} more task${live.length > 2 ? 's' : ''} (TAB)` : ''),
    ], key);
  }

  // ---------------------------------------------------------------- objective (next stage)
  private objective() {
    const g = this.g, st = g.st;
    const el = document.getElementById('objective')!;
    if (g.brief.visible() || g.mode !== 'play') { el.hidden = true; return; }
    const n = nextStage(st);
    if (!n) { el.hidden = true; return; }
    el.hidden = false;
    const rows = stageProgress(st, n);
    const key = rows.map((r) => `${r.have}/${r.need}`).join(',') + n;
    this.set('objective', () => [h('div', { class: 'h' }, h('span', null, `NEXT: ${STAGE_INFO[n].name}`), h('span', { class: 'muted' }, 'COLONY GROWTH')), ...rows.map((r) => h('div', { class: 'r' }, h('span', null, r.label), h('div', { class: `bar ${r.have >= r.need ? '' : 'orange'}` }, h('i', { style: `width:${Math.min(100, (r.have / r.need) * 100)}%` })), h('span', null, `${r.have}/${r.need}`)))], key);
  }

  // ---------------------------------------------------------------- inspector
  private inspector(force: boolean) {
    const g = this.g, st = g.st;
    const el = document.getElementById('inspector')!;
    const s = g.selected;
    if (!s) { el.hidden = true; return; }
    el.hidden = false;
    if (s.kind === 'robot') {
      const r = st.robots.find((q) => q.id === s.id);
      if (!r) { g.selected = null; return; }
      const job = st.jobs.find((j) => j.id === r.jobId);
      const task = job ? taskById(st, job.taskId) : undefined;
      const cap = Math.floor(ROBOTS[r.kind].cargo);
      const key = `${r.id}:${r.phase}:${Math.round(r.battery)}:${r.cargo?.qty ?? 0}:${Math.round(r.condition)}:${task?.id}:${Math.round((task?.progress ?? 0) * 100)}:${g.drive}`;
      if (!force && this.sig.get('inspector') === key) return;
      this.set('inspector', () => [
        h('div', { class: 'hd' }, img(robotUrl(r.kind), 'ico'), r.name, h('span', { class: 'chip core' }, ROBOTS[r.kind].name.toUpperCase()), h('button', { class: 'x', type: 'button', onclick: () => g.select(null) }, '×')),
        h('div', { class: 'bd' },
          h('div', { class: 'stat' }, h('b', null, 'CURRENT TASK'), h('span', null, task ? `${task.title} (#${task.id})` : r.state === 'charging' ? 'Charging' : 'None')),
          task ? h('div', { class: 'stat' }, h('b', null, 'PROGRESS'), h('div', { class: 'bar' }, h('i', { style: `width:${Math.round(task.progress * 100)}%` }))) : null,
          cap ? h('div', { class: 'stat' }, h('b', null, 'CARGO'), h('span', null, r.cargo ? `${r.cargo.qty} / ${cap} ${RES[r.cargo.res].name.toUpperCase()}` : `0 / ${cap}`)) : null,
          h('div', { class: 'stat' }, h('b', null, `BATTERY ${Math.round(r.battery)}%`), h('div', { class: `bar ${r.battery < 25 ? 'red' : 'yellow'}` }, h('i', { style: `width:${r.battery}%` }))),
          h('div', { class: 'stat' }, h('b', null, `CONDITION ${Math.round(r.condition)}%`), h('div', { class: `bar ${r.condition < 35 ? 'red' : 'ti'}` }, h('i', { style: `width:${r.condition}%` }))),
          h('div', { class: 'stat' }, h('b', null, 'EFFICIENCY'), h('span', null, efficiency(st, r).toFixed(2))),
          h('div', { class: 'status' }, `STATUS: ${r.phase}`),
          h('div', { class: 'row' },
            !ROBOTS[r.kind].flying ? h('button', { class: 'btn small orange', type: 'button', onclick: () => (g.drive === r.id ? g.stopDrive() : g.startDrive(r.id)) }, g.drive === r.id ? 'RELEASE' : 'DRIVE') : null,
            h('button', { class: 'btn small', type: 'button', onclick: () => g.followRobot(r.id) }, 'FOLLOW'),
            h('button', { class: 'btn small', type: 'button', onclick: () => { void g.handleCommand({ intent: 'recall', robot: r.kind }, `Recall ${r.name}`, 'PARSED'); } }, 'RECALL'),
            r.state === 'broken' || r.state === 'dead' ? h('button', { class: 'btn small red', type: 'button', onclick: () => { g.cmd.show(); void g.handleCommand({ intent: 'repair', robotName: r.name }, `Repair ${r.name}`, 'PARSED'); } }, 'REPAIR') : null)),
      ], key);
      return;
    }
    if (s.kind === 'module') {
      const m = st.modules.find((q) => q.id === s.id);
      if (!m) { g.selected = null; return; }
      const def = MODULES[m.kind];
      const lines: [string, string][] = [];
      if (m.status === 'site' || m.status === 'building') {
        const t = taskById(st, m.taskId);
        lines.push(['STATUS', m.salvage ? 'SALVAGE PILE' : m.status === 'site' ? 'AWAITING MATERIALS' : `ASSEMBLING ${Math.round(m.progress * 100)}%`]);
        for (const [r, q] of Object.entries(def.cost)) lines.push([RES[r as ResId].name.toUpperCase(), `${m.delivered[r as ResId] ?? 0} / ${q}`]);
        if (t) lines.push(['TASK', `#${t.id} ${t.label}`]);
      } else {
        lines.push(['STATUS', m.status === 'off' ? 'SWITCHED OFF' : m.powered ? (m.running ? 'RUNNING' : 'ONLINE') : 'UNPOWERED']);
        lines.push(['HULL', `${Math.round(m.hp * 100)}%`]);
        if (def.gen) lines.push(['GENERATING', `${genOf(st, m).toFixed(1)} kW`]);
        if (def.draw) lines.push(['DRAW', `${def.draw} kW · ${CAT_NAME[def.cat]}`]);
        if (m.kind === 'solar') lines.push(['DUST', `${Math.round(m.dust * 100)}%`]);
        if (m.kind === 'oxygen') { lines.push(['ICE HOPPER', `${m.hopper.toFixed(0)} / ${TUNE.hopperCap}`]); lines.push(['OUTPUT', m.running ? `${TUNE.o2GenRate} O₂/h` : 'IDLE']); }
        if (m.kind === 'battery') lines.push(['GRID BATTERY', `${Math.round(st.power.battery)} / ${batteryCap(st)} kWh`]);
        if (def.storeCap) { lines.push(['STORED', `${usedOf(m)} / ${capOf(m)}`]); for (const [r, q] of Object.entries(m.store)) if (q) lines.push([RES[r as ResId].name.toUpperCase(), String(q)]); }
        if (m.kind === 'habitat') lines.push(['RESIDENTS', `${Math.min(alive(st).length, 4)} beds used`]);
        if (m.fab) lines.push(['FABRICATING', m.fab.kind === 'res' ? `${RES[m.fab.res].name} (${m.fab.left} min)` : `${ROBOTS[m.fab.robot].name} (${m.fab.left} min)`]);
        if (m.kind === 'lab') lines.push(['RESEARCH', st.research.current ? `${st.research.current} ${Math.round(st.research.rp)} RP` : 'IDLE']);
      }
      const key = lines.map((l) => l.join(':')).join('|') + m.id;
      if (!force && this.sig.get('inspector') === key) return;
      this.set('inspector', () => [
        h('div', { class: 'hd' }, img(moduleUrl(m.kind), 'ico'), m.name, h('button', { class: 'x', type: 'button', onclick: () => g.select(null) }, '×')),
        h('div', { class: 'bd' }, h('div', { class: 'muted small' }, def.desc), ...lines.map(([a, b]) => h('div', { class: 'stat' }, h('b', null, a), h('span', null, b))),
          m.status === 'online' || m.status === 'off' ? h('div', { class: 'row' },
            m.hp < 1 ? h('button', { class: 'btn small red', type: 'button', onclick: () => { g.cmd.show(); void g.handleCommand({ intent: 'repair', module: m.kind }, `Repair ${m.name}`, 'PARSED'); } }, 'REPAIR') : null,
            def.buildable ? h('button', { class: 'btn small', type: 'button', onclick: () => { g.cmd.show(); g.cmd.prefill(`Move ${def.name.toLowerCase()} `); } }, 'MOVE…') : null,
            def.draw && def.cat !== 'life' ? h('button', { class: 'btn small', type: 'button', onclick: () => { m.status = m.status === 'off' ? 'online' : 'off'; g.toast(`${m.name} ${m.status === 'off' ? 'switched off' : 'back on'}`); this.update(true); } }, m.status === 'off' ? 'SWITCH ON' : 'SWITCH OFF') : null,
            m.kind === 'lab' ? h('button', { class: 'btn small cyan', type: 'button', onclick: () => g.open('core', 'research') }, 'OPEN LAB') : null,
            m.kind === 'robotbay' ? h('button', { class: 'btn small orange', type: 'button', onclick: () => g.open('core', 'robots') }, 'BUILD ROBOTS') : null,
            m.kind === 'workshop' ? h('button', { class: 'btn small orange', type: 'button', onclick: () => g.open('core', 'resources') }, 'PRODUCTION') : null) : null),
      ], key);
      return;
    }
    const d = st.deposits.find((q) => q.id === s.id);
    if (!d) { g.selected = null; return; }
    const info = DEPOSIT[d.kind];
    const key = `dep:${d.id}:${d.amount}:${d.found}`;
    if (!force && this.sig.get('inspector') === key) return;
    this.set('inspector', () => [
      h('div', { class: 'hd' }, info.res ? img(resUrl(info.res), 'ico') : null, d.found ? info.name.toUpperCase() : 'UNCONFIRMED SIGNAL', h('button', { class: 'x', type: 'button', onclick: () => g.select(null) }, '×')),
      h('div', { class: 'bd' },
        d.found ? h('div', { class: 'stat' }, h('b', null, 'REMAINING'), h('span', null, d.kind === 'vent' ? 'Build site for a geothermal tap' : `${d.amount} / ${d.max}`)) : h('div', { class: 'muted' }, 'Orbital survey suggests a deposit here. Scout it to confirm.'),
        d.found && d.amount > 0 && info.res ? h('div', { class: 'stat' }, h('b', null, 'MINING TIME'), h('span', null, `${info.secPerUnit} s / unit (base miner)`)) : null,
        h('div', { class: 'row' },
          d.found && info.res && d.amount > 0 ? h('button', { class: 'btn small orange', type: 'button', onclick: () => { g.cmd.show(); void g.ask(`Mine ${info.res}`); } }, `MINE ${info.res.toUpperCase()}`) : null,
          d.kind === 'debris' && d.found ? h('button', { class: 'btn small orange', type: 'button', onclick: () => { g.cmd.show(); void g.ask('Mine salvage'); } }, 'SALVAGE') : null,
          !d.found ? h('button', { class: 'btn small cyan', type: 'button', onclick: () => { g.cmd.show(); void g.ask(`Scout for ${info.res ?? 'deposits'}`); } }, 'SCOUT IT') : null)),
    ], key);
  }

  // ---------------------------------------------------------------- world labels
  drawWorld(bps: { kind: keyof typeof MODULES; x: number; y: number; ok: boolean; reason?: string }[]) {
    const g = this.g, st = g.st, r = g.r;
    const labels: HTMLElement[] = [];
    const at = (x: number, y: number, cls: string, ...kids: (string | Node)[]) => { const p = r.worldToScreen(x, y); const el = h('div', { class: `wlabel ${cls}`, style: `left:${p.x}px;top:${p.y}px` }, ...kids); labels.push(el); };
    // hovered or selected robot
    const hov = g.hoverTile ? st.robots.find((q) => Math.floor(q.x / 16) === g.hoverTile![0] && Math.floor(q.y / 16) === g.hoverTile![1]) : undefined;
    const sel = g.selected?.kind === 'robot' ? st.robots.find((q) => q.id === g.selected!.id) : undefined;
    for (const rb of [sel, hov !== sel ? hov : undefined]) if (rb) at(rb.x, rb.y - 22 - (ROBOTS[rb.kind].flying ? 8 : 0), 'robot', rb.name, ' ', h('small', null, rb.phase));
    if (g.drive !== null) { const rb = st.robots.find((q) => q.id === g.drive); const a = rb && g.driveAction(rb); if (rb && a) at(rb.x, rb.y - 34, 'e', `E — ${a.label}`); }
    if (!sel && !hov && g.hoverTile && !bps.length) { const m = st.modules.find((q) => q.kind !== 'pad' && g.hoverTile![0] >= q.x && g.hoverTile![0] < q.x + q.w && g.hoverTile![1] >= q.y && g.hoverTile![1] < q.y + q.h); if (m) at((m.x + m.w / 2) * 16, m.y * 16 - 16, '', m.name); }
    for (const bp of bps) { const def = MODULES[bp.kind]; at((bp.x + def.w / 2) * 16, bp.y * 16 - 18, `bp ${bp.ok ? '' : 'bad'}`, bp.ok ? `${def.name.toUpperCase()} · ${Object.entries(def.cost).map(([k, v]) => `${v} ${RES[k as ResId].short}`).join(' ')}` : bp.reason ?? 'INVALID'); }
    this.world.replaceChildren(...labels);
  }

  // ---------------------------------------------------------------- toasts, sol card
  toast(msg: string, kind = 'info') {
    if (!msg) return;
    const box = $('#toasts');
    const el = h('div', { class: `toast ${kind}` }, msg);
    box.append(el);
    while (box.children.length > 3) box.firstElementChild!.remove();
    setTimeout(() => el.classList.add('out'), kind === 'big' ? 4200 : 3000);
    setTimeout(() => el.remove(), kind === 'big' ? 4700 : 3500);
  }
  solCard() {
    const g = this.g, rep = g.st.lastReport;
    if (!rep) return;
    document.querySelector('.solcard')?.remove();
    const gains = rep.lines.filter((l) => l.startsWith('+')).slice(0, 3);
    const ok = (v: number) => (v >= 99 ? '✓' : `${Math.round(v)}%`);
    const el = h('div', { class: 'solcard' }, h('b', null, `SOL ${rep.sol} COMPLETE`),
      h('div', { class: 'sc' }, h('span', { class: 'big-num' }, String(rep.score)), h('span', null, 'SCORE')),
      h('div', { class: 'chips' }, h('span', null, `O₂ ${ok(rep.uptimeO2)}`), h('span', null, `⚡ ${ok(rep.uptimePower)}`)),
      gains.length ? h('div', null, gains.join(' · ')) : null,
      h('div', { class: 'row' }, h('button', { class: 'btn small green', type: 'button', onclick: () => { el.remove(); g.open('report', rep); } }, 'REPORT'), h('button', { class: 'btn small', type: 'button', onclick: () => el.remove() }, 'OK')));
    $('#app').append(el);
    setTimeout(() => el.remove(), 14000);
  }
}

const sev = (a: Alert) => (a.severity === 'crit' ? 3 : a.severity === 'warn' ? 2 : a.kind === 'suggest' ? 1 : 0);
export function responseFor(a: Alert): import('../ai/command').Command | null {
  if (a.kind === 'leak' || a.key === 'o2-low' || a.key === 'hopper-empty' || a.key === 'water-low') return { intent: 'fix', system: 'oxygen' };
  if (a.key === 'power-failure' || a.key === 'power-shed' || a.key === 'dust-panels') return { intent: 'fix', system: 'power' };
  if (a.key === 'storm-forecast' || a.key === 'storm' || a.key === 'solar-forecast') return { intent: 'prepare', storm: true };
  if (a.kind === 'robot' || a.kind === 'damage') return { intent: 'repair' };
  if (a.key === 'overload') return { intent: 'build', module: 'storage' };
  if (a.key === 'meteor-forecast') return { intent: 'survive' };
  if (a.key === 'rations') return { intent: 'inspect' };
  return null;
}
export { hour, fill };
