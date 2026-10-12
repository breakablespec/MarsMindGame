// Game: owns the colony state, the loop, input, camera, selection, plans in preview,
// manual build placement, DRIVE mode, and routes simulation events to fx/audio/UI.

import { account, captureRef, fmt, gameEvent, initAccount, onAccount, questsComplete, type Gain } from '../account/account';
import { CONFIG } from '../account/config';
import { loginScreen, questScreen } from '../ui/gate';
import { MODULES, ModuleKind, RES, ResId, ROBOTS, SEC_PER_MIN, DEPOSIT } from '../sim/defs';
import { clock, emit, hour, isNight, onSim, remember, SimEvent, sol } from '../sim/core';
import { checkSite, depositAt, moduleAt, walkable, centerOf, bumpGrid } from '../sim/grid';
import { newColony } from '../sim/init';
import { step } from '../sim/tick';
import { simulate } from '../sim/tick';
import { clearSave, hasSave, loadGame, saveGame } from '../sim/save';
import type { ColonyState, Robot, Task, TaskSource } from '../sim/state';
import { liveTasks, taskById, jobById } from '../sim/tasks';
import { stormActive } from '../sim/environment';
import { activeAlerts } from '../sim/core';
import { tileOf } from '../sim/robots';
import { put } from '../sim/storage';
import { siteNeeds } from '../sim/construction';
import { idx, MAP_W, MAP_H, reveal, BASE_CX, BASE_CY } from '../sim/world';
import { Renderer, Overlay, Scene } from '../render/renderer';
import { setLayer, setMusic, setSfx, setWind, sfx, startAudio, Layer } from '../audio/synth';
import { parse } from '../ai/parser';
import type { Command } from '../ai/command';
import { plan, Plan, setSiteIndex, Label } from '../ai/planner';
import { coreMinute, setAutonomy } from '../ai/autonomy';
import { learn, declined } from '../ai/learning';
import { aiStatus, initLLM, llmParse } from '../ai/llm';
import { Hud } from '../ui/hud';
import { CommandBar } from '../ui/cmdbar';
import { Windows, WinKind } from '../ui/windows';
import { Briefing } from '../ui/briefing';
import { playLoader, titleScreen } from '../ui/screens';
import { $, h } from '../ui/dom';

export type Sel = { kind: 'robot' | 'module' | 'deposit'; id: number } | null;
export interface Pending { plan: Plan; text: string; source: Label; cmd: Command; idx: number; custom?: { x: number; y: number } | null }

const EARN_EVENTS = new Set(['online', 'robotBuilt', 'research', 'stage', 'found', 'stormEnd', 'solEnd']);

export class Game {
  st: ColonyState;
  r: Renderer;
  mode: 'loading' | 'title' | 'watch' | 'play' = 'loading';
  selected: Sel = null;
  overlay: Overlay = 'none';
  hoverTile: [number, number] | null = null;
  follow: { robotId?: number; taskId?: number } | null = null;
  pending: Pending | null = null;
  placing: ModuleKind | null = null;
  drive: number | null = null;
  driveAct: { kind: string; label: string; t: number } | null = null;
  driveDep: number | null = null;
  driveMod: number | null = null;
  keys = new Set<string>();
  mouse = { x: 0, y: 0, down: false, dragging: false, sx: 0, sy: 0, camX: 0, camY: 0, button: 0 };
  time = 0;
  last = performance.now();
  saveT = 0;
  hudT = 0;
  thinking = false;
  hud: Hud; cmd: CommandBar; wins: Windows; brief: Briefing;
  watchScript: { at: number; text: string; done?: boolean }[] = [];
  watchT = 0;
  prevSpeed = 1;
  sfxGate = new Map<string, number>();
  estimates = new Map<number, number>();

  constructor(private root: HTMLElement) {
    captureRef();
    this.r = new Renderer($('#game') as HTMLCanvasElement);
    this.st = newColony();
    this.hud = new Hud(this);
    this.cmd = new CommandBar(this);
    this.wins = new Windows(this);
    this.brief = new Briefing(this);
    onSim((e) => this.onSim(e));
    this.bindInput();
    const resize = () => { this.r.resize(root.clientWidth, root.clientHeight); };
    addEventListener('resize', resize);
    resize();
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.mode === 'play') this.save(); });
    addEventListener('pagehide', () => { if (this.mode === 'play') this.save(); });
    void initLLM();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ================================================================ flow
  async boot(skip = false) {
    const ready = initAccount();
    if (!skip) await playLoader($('#screen'));
    await ready;
    onAccount((_, g) => { if (g) this.showGain(g); else this.hud.update(true); });
    this.showTitle();
    this.afterLogin();
  }
  /** Back from X: continue straight into the quests (or the colony); show why a login failed. */
  afterLogin() {
    let p: URLSearchParams;
    try { p = new URLSearchParams(location.search); } catch { return; }
    const auth = p.get('auth');
    if (!auth) return;
    p.delete('auth'); const reason = p.get('reason'); p.delete('reason');
    try { history.replaceState(null, '', `${location.pathname}${p.toString() ? `?${p}` : ''}${location.hash}`); } catch { /* sandboxed */ }
    if (auth === 'ok' && account()) {
      this.toast(`Signed in as @${account()!.handle}`, 'good');
      this.enter(() => { const s = hasSave() ? loadGame() : null; this.startColony(s ?? newColony(), !s); });
    } else if (auth === 'error') {
      const why: Record<string, string> = { cancelled: 'X login cancelled', expired: 'Login took too long — try again', token: 'X refused the login — check the app keys', profile: 'Could not read your X profile', database: 'Could not save your profile — try again', server: 'Login is not configured on the server yet' };
      this.toast(why[reason ?? ''] ?? 'X login failed — try again', 'bad');
    }
  }
  showTitle() {
    this.mode = 'title';
    this.wins.close(); this.cmd.hide(); this.clearPreview();
    const demo = newColony(11);
    demo.demo = true;
    demo.minute = 20 * 60 + 40;
    demo.core.autonomy = 'automated';
    simulate(demo, 30, { onMinute: coreMinute });
    this.setState(demo);
    this.r.centerOn((BASE_CX + 2) * 16, BASE_CY * 16, true);
    this.hud.show(false);
    this.brief.hide();
    setLayer('title');
    const screen = $('#screen');
    screen.replaceChildren(titleScreen({
      hasSave: hasSave(),
      onStart: () => { startAudio(); this.enter(() => { clearSave(); this.startColony(newColony(), true); }); },
      onContinue: () => { startAudio(); this.enter(() => { const s = loadGame(); this.startColony(s ?? newColony(), !s); }); },
      account: account() ? `@${account()!.handle} · ${fmt(account()!.tokens)} ${CONFIG.currency}` : null,
      onProfile: () => this.open('profile'),
      onWatch: () => { startAudio(); this.startWatch(); },
    }));
  }
  /** Entry gate: X login → 4 quests → game. */
  enter(run: () => void) {
    const screen = $('#screen');
    if (!account()) { screen.replaceChildren(loginScreen({ onDone: () => this.enter(run), onBack: () => this.showTitle(), sound: sfx })); return; }
    if (!questsComplete()) { screen.replaceChildren(questScreen({ onDone: () => { sfx('stage'); this.enter(run); }, onBack: () => this.showTitle(), sound: sfx, toast: (m, k) => this.toast(m, k) })); return; }
    run();
  }
  setState(st: ColonyState) {
    this.st = st;
    bumpGrid();
    this.selected = null; this.follow = null; this.pending = null; this.placing = null; this.drive = null;
  }
  startColony(st: ColonyState, fresh: boolean) {
    this.setState(st);
    this.mode = 'play';
    $('#screen').replaceChildren();
    $('#watchbar')?.remove();
    this.hud.show(true);
    setMusic(true); setSfx(true);
    this.r.centerOn((BASE_CX + 1) * 16, (BASE_CY + 2) * 16, true);
    if (fresh) this.brief.begin();
    else {
      const away = this.catchUp();
      if (away) this.wins.open('away', away);
      this.brief.resume();
    }
    this.save();
    this.hud.update(true);
  }
  startWatch() {
    const st = newColony(23);
    st.demo = true;
    st.core.autonomy = 'autonomous';
    st.core.perms.expand = true; st.core.perms.trade = true;
    st.speed = 2;
    this.setState(st);
    this.mode = 'watch';
    $('#screen').replaceChildren();
    this.hud.show(true);
    this.brief.hide();
    this.watchT = 0;
    this.watchScript = [
      { at: 2, text: 'Build a second oxygen generator' },
      { at: 40, text: 'Send drones for titanium' },
      { at: 75, text: 'Build another solar panel' },
      { at: 110, text: 'Build a robot bay' },
      { at: 150, text: 'Make the colony safer' },
      { at: 200, text: 'Build a hauler' },
      { at: 240, text: 'Prepare for a dust storm' },
    ];
    const bar = h('div', { class: 'watchbar', id: 'watchbar' }, h('b', null, 'SIMULATION'), h('span', { id: 'watchcap' }, 'CORE is running the colony at AUTONOMOUS. Commands appear as a commander would type them.'), h('button', { class: 'btn small', type: 'button', onclick: () => { $('#watchbar')?.remove(); this.showTitle(); } }, 'EXIT'));
    $('#app').append(bar);
  }
  catchUp(): string[] | null {
    const st = this.st;
    if (!st.lastSavedAt) return null;
    const secs = (Date.now() - st.lastSavedAt) / 1000;
    const minutes = Math.min(1440, Math.floor(secs / SEC_PER_MIN / 4));
    if (minutes < 30) return null;
    const before = { built: st.history.length, tasks: st.core.memory.length, o2: st.o2, sol: sol(st) };
    const snapshot = JSON.stringify({ mined: st.sol.mined });
    simulate(st, minutes, { onMinute: coreMinute });
    const lines = [`${Math.floor(minutes / 60)}h ${minutes % 60}m of colony time passed while you were away (simulated at quarter speed).`];
    const newHist = st.history.slice(before.built);
    for (const e of newHist.slice(-6)) lines.push(`SOL ${e.sol}: ${e.text}`);
    const mem = st.core.memory.slice(0, Math.max(0, st.core.memory.length - before.tasks)).slice(0, 5);
    for (const m of mem) lines.push(`CORE ${m.ok ? 'did' : 'tried'}: ${m.text}`);
    lines.push(`Oxygen ${Math.round(before.o2)} → ${Math.round(st.o2)} · colonists ${st.colonists.filter((c) => !c.dead).length} alive`);
    void snapshot;
    return lines;
  }

  // ================================================================ API used by UI
  toast(msg: string, kind: 'info' | 'good' | 'bad' | 'core' | 'big' = 'info') { this.hud.toast(msg, kind); }
  sound(name: string) { sfx(name); }
  save() { if (this.mode === 'play') saveGame(this.st); }
  open(kind: WinKind, arg?: unknown) { this.wins.open(kind, arg); this.keys.clear(); }
  setSpeed(s: number) { this.st.speed = s; this.hud.update(true); sfx('click'); }
  togglePause() { if (this.st.speed > 0) { this.prevSpeed = this.st.speed; this.st.speed = 0; } else this.st.speed = this.prevSpeed || 1; this.hud.update(true); }
  setAutonomy(level: ColonyState['core']['autonomy']) { setAutonomy(this.st, level); this.hud.update(true); this.brief.event('autonomy'); }
  select(sel: Sel) {
    this.selected = sel;
    if (sel?.kind === 'robot') this.brief.event('select:robot');
    if (sel?.kind === 'module') this.brief.event(`select:${this.st.modules.find((m) => m.id === sel.id)?.kind}`);
    this.hud.update(true);
    if (sel) sfx('click');
  }
  followRobot(id: number) { this.follow = { robotId: id }; this.select({ kind: 'robot', id }); }
  focusTile(x: number, y: number) { this.follow = null; this.r.centerOn(x * 16 + 8, y * 16 + 8, false); this.camGoal = { x: x * 16 + 8, y: y * 16 + 8 }; }
  camGoal: { x: number; y: number } | null = null;

  // ================================================================ commands
  async ask(text: string) {
    text = text.trim();
    if (!text) return;
    const st = this.st;
    this.cmd.show();
    this.cmd.userSaid(text);
    emit(st, 'command', undefined, undefined, { text });
    let res = parse(text);
    let source: Label = 'PARSED';
    if (res.confidence < 0.6 || res.commands[0]?.intent === 'unknown') {
      if (aiStatus() === 'ready') {
        this.setThinking(true);
        const r = await llmParse(st, text);
        this.setThinking(false);
        if ('commands' in r) {
          if (r.commands.length) { res = { commands: r.commands, confidence: 0.8 }; source = 'AI PLAN'; if (r.reply) this.cmd.coreSaid(r.reply, 'AI PLAN'); }
          else { this.cmd.coreSaid(r.reply || 'I can\'t turn that into colony work.', 'AI PLAN'); remember(st, text, 'AI PLAN', false); return; }
        } else if (r.error === 'denied') this.cmd.note('Claude isn\'t allowed on this page, so CORE only understands its built-in phrasing.');
      } else this.cmd.note('Claude isn\'t connected here, so CORE uses its built-in command parser.');
    }
    for (const c of res.commands.slice(0, 3)) await this.handleCommand(c, text, source);
  }

  async handleCommand(c: Command, text: string, source: Label) {
    this.setThinking(true);
    sfx('think');
    await new Promise((r) => setTimeout(r, this.mode === 'watch' ? 250 : 420));
    this.setThinking(false);
    const p = plan(this.st, c);
    if (p.kind === 'info' || p.kind === 'refuse' || p.title.startsWith('POWER OK') || p.title.startsWith('OXYGEN OK')) {
      if (!p.ok) { this.st.core.plans.refused++; sfx('error'); }
      this.cmd.showPlan(p, text, p.kind === 'info' && source === 'PARSED' ? 'CORE MODEL' : source, null);
      if (p.ok && p.exec && !p.steps.length) this.runPlan(p, text, source);
      return;
    }
    if (!p.exec) { this.cmd.showPlan(p, text, source, null); return; }
    const needsOk = p.big || p.confirm === 'yes' || this.st.core.autonomy === 'manual';
    if (needsOk && this.mode !== 'watch') {
      this.pending = { plan: p, text, source, cmd: c, idx: 0 };
      setSiteIndex(0);
      this.cmd.showPlan(p, text, source, this.pending);
      sfx('plan');
      if (p.sites?.options[0]) { const o = p.sites.options[0]; const def = MODULES[p.sites.kind]; this.focusTile(o.x + def.w / 2, o.y + def.h / 2); }
      return;
    }
    this.cmd.showPlan(p, text, source, null);
    this.runPlan(p, text, source);
  }

  runPlan(p: Plan, text: string, source: Label) {
    if (!p.exec) return;
    const st = this.st;
    const src: TaskSource = this.mode === 'watch' ? 'PLAYER' : this.brief.active() ? 'BRIEFING' : 'PLAYER';
    learn(st, p.learn);
    st.core.plans.made++;
    if (this.pending?.custom && p.sites) { p.sites.options.unshift({ x: this.pending.custom.x, y: this.pending.custom.y, score: 0, zone: 'Your pick' }); setSiteIndex(0); }
    const tasks = p.exec(st, src, text);
    this.clearPreview();
    for (const t of tasks) if (p.estSec) this.estimates.set(t.id, Date.now() / 1000);
    if (!tasks.length) remember(st, text, source, true);
    this.cmd.started(p, tasks);
    sfx('confirm');
    const main = tasks.find((t) => t.kind === 'build' || t.kind === 'mine' || t.kind === 'scout') ?? tasks[0];
    if (main) this.follow = { taskId: main.id };
    this.brief.event(`exec:${p.intent}:${p.sites?.kind ?? ''}`);
    this.hud.update(true);
    this.save();
  }
  confirmPending() { if (!this.pending) return; const { plan: p, text, source } = this.pending; this.runPlan(p, text, source); }
  cancelPending() { if (this.pending) { declined(this.st, this.pending.plan); this.cmd.coreSaid('Plan cancelled. Nothing was changed.', 'CORE MODEL'); } this.clearPreview(); }
  changeLocation() {
    const P = this.pending;
    if (!P?.plan.sites) return;
    const s = P.plan.sites;
    P.custom = null;
    P.idx = (P.idx + s.count) % Math.max(1, s.options.length);
    if (P.idx + s.count > s.options.length) P.idx = 0;
    setSiteIndex(P.idx);
    const o = s.options[P.idx];
    const def = MODULES[s.kind];
    this.focusTile(o.x + def.w / 2, o.y + def.h / 2);
    this.cmd.updateLocation(o.zone);
    sfx('click');
  }
  clearPreview() { this.pending = null; setSiteIndex(0); }
  setThinking(on: boolean) { this.thinking = on; this.cmd.thinking(on); this.hud.update(true); }

  // ================================================================ manual build
  startPlacing(kind: ModuleKind) { this.placing = kind; this.wins.close(); this.cmd.hide(); this.clearPreview(); this.toast(`Tap a spot for ${MODULES[kind].name}`); this.brief.event('placing'); }
  placeAt(tx: number, ty: number) {
    const kind = this.placing!;
    const def = MODULES[kind];
    const x = tx - Math.floor(def.w / 2), y = ty - Math.floor(def.h / 2);
    const chk = checkSite(this.st, kind, x, y);
    if (!chk.ok) { this.toast(chk.reason ?? 'Can\'t build there', 'bad'); sfx('error'); return; }
    this.placing = null;
    const p = plan(this.st, { intent: 'build', module: kind, count: 1 });
    if (!p.ok || !p.exec) { this.cmd.show(); this.cmd.showPlan(p, `Build ${def.name}`, 'PARSED', null); return; }
    p.sites = { kind, options: [{ x, y, score: 0, zone: 'Your pick' }, ...(p.sites?.options ?? [])], idx: 0, count: 1 };
    const loc = p.details.find((d) => d.label === 'Location'); if (loc) loc.value = 'Your pick';
    this.pending = { plan: p, text: `Build ${def.name}`, source: 'PARSED', cmd: { intent: 'build', module: kind }, idx: 0 };
    setSiteIndex(0);
    this.cmd.show();
    this.cmd.showPlan(p, `Build ${def.name} (placed by hand)`, 'PARSED', this.pending);
  }

  // ================================================================ DRIVE mode
  startDrive(id: number) {
    const r = this.st.robots.find((q) => q.id === id);
    if (!r || ROBOTS[r.kind].flying) { this.toast('Only ground robots can be driven', 'bad'); return; }
    if (r.state === 'broken' || r.state === 'dead') { this.toast(`${r.name} can't move`, 'bad'); return; }
    const j = jobById(this.st, r.jobId);
    if (j && j.status === 'active') { j.status = 'open'; j.robotId = null; }
    r.jobId = null; r.path = []; r.goal = null; r.padModule = null; r.state = 'driven'; r.phase = 'PLAYER CONTROL';
    this.drive = id; this.follow = { robotId: id }; this.select({ kind: 'robot', id });
    this.wins.close(); this.cmd.hide();
    this.toast(`DRIVING ${r.name} · WASD move · E act · ESC exit`, 'core');
  }
  stopDrive() {
    const r = this.st.robots.find((q) => q.id === this.drive);
    if (r && r.state === 'driven') { r.state = 'idle'; r.phase = 'IDLE'; }
    this.drive = null; this.driveAct = null;
    this.toast('Robot handed back to CORE', 'core');
  }
  /** What E would do for the driven robot right now. */
  driveAction(r: Robot): { label: string; run: () => void; continuous?: boolean } | null {
    const st = this.st;
    const [tx, ty] = tileOf(r);
    const near: [number, number][] = [[tx, ty + 1], [tx, ty - 1], [tx - 1, ty], [tx + 1, ty]];
    const dir: Record<string, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    near.sort((a, b) => (a[0] === tx + dir[r.facing][0] && a[1] === ty + dir[r.facing][1] ? -1 : 0) - (b[0] === tx + dir[r.facing][0] && b[1] === ty + dir[r.facing][1] ? -1 : 0));
    const cap = ROBOTS[r.kind].cargo;
    for (const [x, y] of near) {
      const d = depositAt(st, x, y);
      if (d && r.kind === 'miner' && DEPOSIT[d.kind].res && d.amount > 0 && (r.cargo?.qty ?? 0) < cap && (!r.cargo || r.cargo.res === DEPOSIT[d.kind].res)) return { label: `MINE ${DEPOSIT[d.kind].res!.toUpperCase()}`, continuous: true, run: () => { this.driveAct = { kind: 'mine', label: 'MINING', t: 0 }; this.driveDep = d.id; } };
      const m = moduleAt(st, x, y);
      if (!m) continue;
      if (r.cargo && (m.status === 'site' || m.status === 'building') && !m.salvage && (siteNeeds(st, m)[r.cargo.res] ?? 0) > 0) return { label: `DELIVER ${r.cargo.res.toUpperCase()}`, run: () => { const need = siteNeeds(st, m)[r.cargo!.res] ?? 0; const n = Math.min(need, r.cargo!.qty); m.delivered[r.cargo!.res] = (m.delivered[r.cargo!.res] ?? 0) + n; r.cargo!.qty -= n; if (r.cargo!.qty <= 0) r.cargo = null; sfx('deliver'); this.r.float(r.x, r.y - 20, `+${n}`, '#ffcc2e'); } };
      if (r.cargo && MODULES[m.kind].storeCap && m.status === 'online') return { label: `UNLOAD → ${m.name}`, run: () => { const n = put(m, r.cargo!.res, r.cargo!.qty); if (n) { this.r.fly(r.x, r.y - 8, centerOf(m)[0] * 16, centerOf(m)[1] * 16, r.cargo!.res); this.r.float(centerOf(m)[0] * 16, m.y * 16, `+${n} ${RES[r.cargo!.res].short}`, '#c8ffd6'); st.sol.mined[r.cargo!.res] = (st.sol.mined[r.cargo!.res] ?? 0) + n; } r.cargo!.qty -= n; if (r.cargo!.qty <= 0) r.cargo = null; sfx('deliver'); } };
      if (r.kind === 'builder' && (m.status === 'site' || m.status === 'building') && !m.salvage && Object.keys(siteNeeds(st, m)).length === 0 && m.progress < 1) return { label: `BUILD ${m.name} ${Math.floor(m.progress * 100)}%`, continuous: true, run: () => { this.driveAct = { kind: 'build', label: 'ASSEMBLING', t: 0 }; this.driveMod = m.id; } };
      if ((r.kind === 'builder' || r.kind === 'repair') && m.hp < 1 && m.status !== 'site') return { label: `REPAIR ${m.name}`, continuous: true, run: () => { this.driveAct = { kind: 'repair', label: 'REPAIRING', t: 0 }; this.driveMod = m.id; } };
      if ((r.kind === 'builder' || r.kind === 'repair') && m.kind === 'solar' && m.dust > 0.02) return { label: `CLEAN ${m.name}`, continuous: true, run: () => { this.driveAct = { kind: 'clean', label: 'CLEANING', t: 0 }; this.driveMod = m.id; } };
    }
    return null;
  }
  updateDrive(dt: number) {
    const st = this.st;
    const r = st.robots.find((q) => q.id === this.drive);
    if (!r || r.state !== 'driven') { this.drive = null; return; }
    let dx = 0, dy = 0;
    if (!this.cmd.typing() && !this.wins.current) {
      if (this.keys.has('a') || this.keys.has('arrowleft')) dx -= 1;
      if (this.keys.has('d') || this.keys.has('arrowright')) dx += 1;
      if (this.keys.has('w') || this.keys.has('arrowup')) dy -= 1;
      if (this.keys.has('s') || this.keys.has('arrowdown')) dy += 1;
    }
    if (dx || dy) {
      this.driveAct = null;
      const sp = ROBOTS[r.kind].speed * 16 * dt;
      const len = Math.hypot(dx, dy);
      const nx = r.x + (dx / len) * sp, ny = r.y + (dy / len) * sp;
      const ok = (x: number, y: number) => walkable(st, Math.floor(x / 16), Math.floor(y / 16)) || (Math.floor(x / 16) === Math.floor(r.x / 16) && Math.floor(y / 16) === Math.floor(r.y / 16));
      if (ok(nx, r.y)) r.x = nx;
      if (ok(r.x, ny)) r.y = ny;
      r.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
      const k = idx(...tileOf(r));
      if (k !== r.lastTile) { r.lastTile = k; r.battery = Math.max(0, r.battery - 0.12); r.stats.tiles++; const [x, y] = tileOf(r); reveal(st, x, y, 3); }
      if (Math.random() < 0.3) this.r.dust(r.x, r.y + 3, 1);
      r.phase = 'PLAYER CONTROL';
    }
    if (this.driveAct && st.speed > 0) {
      const a = this.driveAct;
      const gdt = dt * st.speed;
      if (a.kind === 'mine') {
        const d = st.deposits.find((q) => q.id === this.driveDep);
        if (!d || d.amount <= 0 || (r.cargo?.qty ?? 0) >= ROBOTS[r.kind].cargo) { this.driveAct = null; return; }
        a.t += gdt;
        if (Math.random() < 0.4) this.r.burst(d.x * 16 + 16, d.y * 16 + 16, 2, '#fff0a0', 40, 30, 120);
        if (a.t >= DEPOSIT[d.kind].secPerUnit) { a.t = 0; d.amount--; r.cargo = { res: DEPOSIT[d.kind].res as ResId, qty: (r.cargo?.qty ?? 0) + 1 }; r.battery = Math.max(0, r.battery - 0.25); sfx('drill'); }
        r.phase = `MINING ${r.cargo?.qty ?? 0}/${ROBOTS[r.kind].cargo}`;
      } else {
        const m = st.modules.find((q) => q.id === this.driveMod);
        if (!m) { this.driveAct = null; return; }
        if (a.kind === 'build') { m.status = 'building'; m.progress = Math.min(1, m.progress + gdt / MODULES[m.kind].buildSec); if (Math.random() < 0.3) this.r.burst((m.x + Math.random() * m.w) * 16, (m.y + Math.random() * m.h) * 16, 2, '#fff0a0', 30, 20, 90); r.phase = `ASSEMBLING ${Math.floor(m.progress * 100)}%`; if (m.progress >= 1) { this.driveAct = null; this.toast(`${m.name} assembled — CORE will connect it`, 'good'); } }
        if (a.kind === 'repair') { m.hp = Math.min(1, m.hp + gdt * 0.03); r.phase = `REPAIRING ${Math.floor(m.hp * 100)}%`; if (m.hp >= 1) this.driveAct = null; }
        if (a.kind === 'clean') { m.dust = Math.max(0, m.dust - gdt * 0.2); r.phase = `CLEANING ${Math.floor(m.dust * 100)}%`; if (m.dust <= 0) this.driveAct = null; }
      }
    }
  }

  // ================================================================ input
  bindInput() {
    const cv = this.r.cv;
    addEventListener('keydown', (e) => {
      startAudio();
      if (this.mode === 'title' || this.mode === 'loading') return;
      const k = e.key.toLowerCase();
      if (this.cmd.typing() || (e.target as HTMLElement)?.tagName === 'INPUT') { if (k === 'escape') this.cmd.hide(); return; }
      if (k === 'escape') {
        if (this.wins.current) { this.wins.close(); return; }
        if (this.drive !== null) { this.stopDrive(); return; }
        if (this.placing) { this.placing = null; this.toast('Placement cancelled'); return; }
        if (this.pending) { this.cancelPending(); return; }
        if (this.cmd.visible) { this.cmd.hide(); return; }
        if (this.selected) { this.select(null); this.follow = null; return; }
        this.open('settings'); return;
      }
      if (this.wins.current) { if (k === 'tab') { e.preventDefault(); this.wins.close(); } return; }
      if (this.mode === 'watch') return;
      if (k === 'tab') { e.preventDefault(); this.open('core', 'ask'); return; }
      if (k === 'q' || k === 'enter') { e.preventDefault(); this.cmd.show(); this.brief.event('ask'); return; }
      if (this.drive !== null && k === 'e') { const r = this.st.robots.find((q) => q.id === this.drive); const a = r && this.driveAction(r); if (a) a.run(); return; }
      if (k === ' ') { e.preventDefault(); this.togglePause(); return; }
      if (k === '1') this.setSpeed(1);
      if (k === '2') this.setSpeed(2);
      if (k === '3') this.setSpeed(4);
      if (k === 'b') { this.open('core', 'build'); return; }
      if (k === 'r') { this.open('core', 'robots'); return; }
      if (k === 'l') { this.open('core', 'research'); return; }
      if (k === 'o') { this.cycleOverlay(); return; }
      if (k === 'f' && this.selected?.kind === 'robot') { this.followRobot(this.selected.id); return; }
      if (k === 'h' || k === '?') { this.open('help'); return; }
      if (k === '=' || k === '+') { this.r.setZoom(this.r.zoom + 1, this.root.clientWidth, this.root.clientHeight); return; }
      if (k === '-') { this.r.setZoom(this.r.zoom - 1, this.root.clientWidth, this.root.clientHeight); return; }
      this.keys.add(k);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    // two-finger pinch zoom (touch)
    const touches = new Map<number, [number, number]>();
    let pinch0 = 0, pinched = false;
    const pinchDist = () => { const [a, b] = [...touches.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]); };
    const dropTouch = (e: PointerEvent) => { touches.delete(e.pointerId); if (touches.size < 2) pinch0 = 0; if (!touches.size && e.type === 'pointercancel') pinched = false; };
    cv.addEventListener('pointercancel', dropTouch);
    cv.addEventListener('pointerdown', (e) => {
      startAudio();
      if (this.mode !== 'play' && this.mode !== 'watch') return;
      if (e.pointerType === 'touch') { touches.set(e.pointerId, [e.clientX, e.clientY]); if (touches.size === 2) { pinch0 = pinchDist(); pinched = true; this.mouse.down = false; this.mouse.dragging = true; return; } }
      cv.setPointerCapture(e.pointerId);
      this.mouse.down = true; this.mouse.dragging = false; this.mouse.button = e.button;
      this.mouse.sx = e.clientX; this.mouse.sy = e.clientY; this.mouse.camX = this.r.camX; this.mouse.camY = this.r.camY;
    });
    cv.addEventListener('pointermove', (e) => {
      if (touches.has(e.pointerId)) {
        touches.set(e.pointerId, [e.clientX, e.clientY]);
        if (touches.size === 2 && pinch0 > 0) {
          const ratio = pinchDist() / pinch0;
          if (ratio > 1.35 || ratio < 0.74) { this.r.setZoom(this.r.zoom + (ratio > 1 ? 1 : -1), this.root.clientWidth, this.root.clientHeight); pinch0 = pinchDist(); }
          return;
        }
      }
      const rc = cv.getBoundingClientRect();
      this.mouse.x = e.clientX - rc.left; this.mouse.y = e.clientY - rc.top;
      this.hoverTile = this.r.screenToTile(this.mouse.x, this.mouse.y);
      if (this.mouse.down) {
        const dx = e.clientX - this.mouse.sx, dy = e.clientY - this.mouse.sy;
        if (!this.mouse.dragging && Math.hypot(dx, dy) > 6) { this.mouse.dragging = true; cv.classList.add('grab'); this.follow = null; this.camGoal = null; }
        if (this.mouse.dragging) { this.r.camX = this.mouse.camX - dx / this.r.scale; this.r.camY = this.mouse.camY - dy / this.r.scale; this.r.clampCam(); }
      }
    });
    cv.addEventListener('pointerleave', () => { this.hoverTile = null; });
    cv.addEventListener('pointerup', (e) => {
      const wasPinch = pinched;
      dropTouch(e);
      if (!touches.size) pinched = false;
      cv.classList.remove('grab');
      if (wasPinch) { this.mouse.down = false; this.mouse.dragging = false; return; }
      const wasDrag = this.mouse.dragging;
      this.mouse.down = false; this.mouse.dragging = false;
      if (wasDrag || (this.mode !== 'play' && this.mode !== 'watch')) return;
      const rc = cv.getBoundingClientRect();
      this.click(e.clientX - rc.left, e.clientY - rc.top, e.button);
    });
    cv.addEventListener('wheel', (e) => {
      if (this.mode !== 'play' && this.mode !== 'watch') return;
      e.preventDefault();
      this.r.setZoom(this.r.zoom + (e.deltaY < 0 ? 1 : -1), this.root.clientWidth, this.root.clientHeight);
    }, { passive: false });
  }

  cycleOverlay() {
    const order: Overlay[] = ['none', 'power', 'oxygen', 'resource', 'paths', 'logistics'];
    this.overlay = order[(order.indexOf(this.overlay) + 1) % order.length];
    if (this.overlay === 'logistics') this.overlay = 'none';
    this.toast(this.overlay === 'none' ? 'Overlay off' : `Overlay: ${this.overlay.toUpperCase()}`);
    this.hud.update(true);
    this.brief.event('overlay');
  }

  click(sx: number, sy: number, button: number) {
    const st = this.st;
    const w = this.r.screenToWorld(sx, sy);
    const [tx, ty] = [Math.floor(w.x / 16), Math.floor(w.y / 16)];
    if (button === 2) { if (this.placing) { this.placing = null; return; } this.select(null); this.follow = null; return; }
    if (this.placing) { this.placeAt(tx, ty); return; }
    if (this.pending?.plan.sites) {
      const kind = this.pending.plan.sites.kind, def = MODULES[kind];
      const x = tx - Math.floor(def.w / 2), y = ty - Math.floor(def.h / 2);
      const chk = checkSite(st, kind, x, y);
      if (chk.ok) { this.pending.custom = { x, y }; this.pending.plan.sites.options.unshift({ x, y, score: 0, zone: 'Your pick' }); this.pending.idx = 0; setSiteIndex(0); this.cmd.updateLocation('Your pick'); sfx('click'); return; }
    }
    // robots first (they sit on top)
    let best: Robot | null = null, bd = 12;
    for (const r of st.robots) { const d = Math.hypot(r.x - w.x, r.y - 6 - (ROBOTS[r.kind].flying ? 7 : 0) - w.y); if (d < bd) { bd = d; best = r; } }
    if (best) { this.select({ kind: 'robot', id: best.id }); return; }
    const m = moduleAt(st, tx, ty) ?? st.modules.find((q) => q.kind !== 'pad' && w.x >= q.x * 16 && w.x < (q.x + q.w) * 16 && w.y >= q.y * 16 - 14 && w.y < (q.y + q.h) * 16);
    if (m) { this.select({ kind: 'module', id: m.id }); return; }
    const d = depositAt(st, tx, ty);
    if (d && (d.found || d.signal)) { this.select({ kind: 'deposit', id: d.id }); return; }
    this.select(null); this.follow = null;
  }

  // ================================================================ events → fx/audio/ui
  gate(name: string, sec: number) { const now = performance.now() / 1000; const last = this.sfxGate.get(name) ?? 0; if (now - last < sec) return false; this.sfxGate.set(name, now); return true; }
  onScreen(x?: number, y?: number) { if (x === undefined || y === undefined) return true; return x > this.r.camX - 32 && x < this.r.camX + this.r.w + 32 && y > this.r.camY - 32 && y < this.r.camY + this.r.h + 32; }
  onSim(e: SimEvent) {
    if (this.mode === 'loading') return;
    const quiet = this.mode === 'title';
    const d = e.data ?? {};
    if (this.mode === 'play' && EARN_EVENTS.has(e.type)) this.rewards(e);
    const vis = this.onScreen(e.x, e.y);
    switch (e.type) {
      case 'deliver': if (vis && d.from) { const [fx, fy] = d.from as [number, number]; this.r.fly(fx, fy - 8, e.x!, e.y! - 8, d.res as ResId); if (!quiet && this.gate('deliver', 0.15)) sfx('deliver'); if ((d.n as number) >= 5) this.r.float(e.x!, e.y! - 18, `+${d.n} ${RES[d.res as ResId].short}`, '#c8ffd6'); } break;
      case 'conveyor': if (vis) { const [tx, ty] = d.to as [number, number]; this.r.fly(e.x!, e.y!, tx, ty, d.res as ResId); } break;
      case 'drill': if (vis && !quiet && this.gate('drill', 0.35)) sfx('drill'); break;
      case 'spark': if (vis) { this.r.burst(e.x!, e.y!, 3, '#fff0a0', 40, 30, 100); if (!quiet && this.gate('build', 0.4)) sfx('build'); } break;
      case 'dust': if (vis) this.r.dust(e.x!, e.y!, 2); break;
      case 'assembled': if (!quiet) sfx('build'); break;
      case 'online': {
        if (vis) { this.r.burst(e.x!, e.y!, 30, '#4dff7a', 80, 60, 60, 2); this.r.float(e.x!, e.y! - 30, String(d.text), '#4dff7a', true); }
        if (!quiet) { sfx('online'); this.toast(`ONLINE · ${d.text}`, 'good'); }
        this.brief.event(`online:${d.kind}`);
        break;
      }
      case 'blueprint': if (!quiet) sfx('plan'); break;
      case 'alert': if (!quiet) { if (d.severity === 'crit' && this.gate('alarm', 6)) sfx('alarm'); else if (d.severity === 'warn' && this.gate('warn', 3)) sfx('warn'); } break;
      case 'impact': this.r.impact(e.x!, e.y!); if (!quiet) sfx('impact'); break;
      case 'shuttleInbound': if (!quiet) { this.toast('Supply shuttle inbound — landing in 30 min', 'core'); } break;
      case 'shuttleLanded': if (!quiet) { sfx('shuttle'); this.toast(Number(d.colonists) ? `Shuttle landed · ${d.colonists} new colonist${Number(d.colonists) > 1 ? 's' : ''}` : 'Shuttle landed · supplies delivered', 'good'); } break;
      case 'shuttleLeave': if (!quiet) sfx('shuttle'); break;
      case 'robotBuilt': if (vis) { this.r.burst(e.x!, e.y!, 20, '#ff8a1f', 60, 40, 80, 2); this.r.float(e.x!, e.y! - 22, `${d.name} ONLINE`, '#ffbf7a', true); } if (!quiet) { sfx('robot'); this.toast(`${d.name} rolled out of the robot bay`, 'good'); } break;
      case 'research': if (!quiet) { sfx('research'); this.toast(`RESEARCH COMPLETE · ${d.name}: ${d.effect}`, 'big'); } break;
      case 'researchStart': if (!quiet) this.toast(`Research started: ${d.name}`, 'core'); break;
      case 'stage': if (!quiet) { sfx('stage'); this.toast(`STAGE UP · ${d.name}`, 'big'); this.wins.open('stage', d); } break;
      case 'death': if (!quiet) { sfx('alarm'); this.toast(`${d.name} was lost`, 'bad'); } break;
      case 'taskDone': this.taskEvent(d, true); break;
      case 'taskFailed': this.taskEvent(d, false); break;
      case 'found': if (vis || this.mode === 'play') { this.r.float(e.x!, e.y! - 20, `${String(d.kind).toUpperCase()} CONFIRMED`, '#4dff7a', true); this.r.burst(e.x!, e.y!, 20, '#b8fbff', 60, 40, 40, 2); } if (!quiet) { sfx('core'); this.toast(`${d.robot} confirmed ${d.kind} deposit`, 'core'); } break;
      case 'depleted': if (!quiet) this.toast(`${String(d.kind)} deposit depleted`, 'info'); break;
      case 'solEnd': if (!quiet && this.mode === 'play') this.hud.solCard(); this.save(); break;
      case 'airlock': if (vis && !quiet && this.gate('airlock', 1.2)) sfx('airlock'); break;
      case 'dock': if (vis && !quiet && this.gate('dock', 0.5)) sfx('dock'); break;
      case 'stormStart': if (!quiet) this.toast('DUST STORM — solar output collapsing', 'bad'); break;
      case 'stormEnd': if (!quiet) this.toast('Storm has passed', 'good'); break;
      case 'coreAct': if (!quiet) { sfx('core'); this.toast(`CORE · ${d.title}: acting now`, 'core'); } break;
      case 'recall': if (!quiet && Number(d.n)) this.toast(`${d.n} robots recalled`, 'core'); break;
      case 'salvaged': if (!quiet) this.toast(`Salvage recovered · +${d.rp} research data`, 'good'); break;
      case 'breakdown': if (!quiet) this.toast(`${d.name} broke down`, 'bad'); break;
      case 'leak': if (!quiet) this.toast(`Seal failure in ${d.name} — oxygen leaking`, 'bad'); break;
      case 'holdEnd': if (!quiet) this.toast(`Power hold lifted (${d.why})`, 'core'); break;
      case 'resume': if (!quiet) this.toast('Storm over — robots back to work', 'core'); break;
      case 'jobFailed': break;
    }
  }
  /** Report a colony event; the MARS it earns arrives through onAccount (see showGain). */
  rewards(e: SimEvent) {
    gameEvent(this.st, e.type, e.data ?? {}, e.x !== undefined && e.y !== undefined ? { x: e.x, y: e.y } : undefined);
  }
  private gainStack = 0;
  private gainT = 0;
  showGain(g: Gain) {
    if (this.mode !== 'play' || g.reason.startsWith('Quest:')) return;
    if (g.reason.startsWith('Achievement')) { this.toast(`🏆 ${g.reason.slice(13)} · +${fmt(g.amount)} ${CONFIG.ticker}`, 'big'); sfx('stage'); }
    else if (g.at) {
      const t = performance.now(); this.gainStack = t - this.gainT < 600 ? this.gainStack + 1 : 0; this.gainT = t;
      this.r.float(g.at.x, g.at.y - 44 - this.gainStack * 12, `+${fmt(g.amount)} ${CONFIG.ticker}`, '#ffcc2e', true);
    } else this.toast(`+${fmt(g.amount)} ${CONFIG.ticker} · ${g.reason}`, 'good');
    this.hud.update(true);
  }
  taskEvent(d: Record<string, unknown>, ok: boolean) {
    if (this.mode === 'title') return;
    const src = d.source as TaskSource;
    const id = Number(d.id);
    const started = this.estimates.get(id);
    if (started !== undefined) {
      const t = taskById(this.st, id);
      if (t?.est) { const actual = Date.now() / 1000 - started; this.st.core.plans.estErr.push((actual - t.est / Math.max(0.5, this.st.speed)) / Math.max(1, t.est)); if (this.st.core.plans.estErr.length > 20) this.st.core.plans.estErr.shift(); }
      this.estimates.delete(id);
    }
    if (src === 'ROUTINE' || src === 'STANDING') return;
    this.cmd.taskFinished(id, String(d.title), String(d.result), ok);
    this.toast(`TASK #${id} ${ok ? 'DONE' : 'FAILED'} · ${d.title}${d.result ? ` — ${d.result}` : ''}`, ok ? 'core' : 'bad');
    if (!ok) sfx('error');
    if (this.follow?.taskId === id) this.follow = null;
    this.brief.event(`done:${d.title}`);
  }

  // ================================================================ loop
  frame(now: number) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    try { this.update(dt); this.draw(dt); } catch (err) { console.error(err); }
    requestAnimationFrame((t) => this.frame(t));
  }

  update(dt: number) {
    const st = this.st;
    if (this.mode === 'loading') return;
    if (this.mode === 'title') {
      step(st, dt, { onMinute: coreMinute });
      const a = this.time * 0.05;
      this.r.centerOn((BASE_CX + Math.cos(a) * 6) * 16, (BASE_CY + 2 + Math.sin(a * 1.3) * 4) * 16, false);
      return;
    }
    const paused = !!this.wins.current && this.wins.current !== 'core';
    if (!paused) step(st, dt, { onMinute: coreMinute });
    if (this.drive !== null) this.updateDrive(dt);
    // camera pan
    if (this.drive === null && !this.cmd.typing() && !this.wins.current) {
      let dx = 0, dy = 0;
      if (this.keys.has('a') || this.keys.has('arrowleft')) dx -= 1;
      if (this.keys.has('d') || this.keys.has('arrowright')) dx += 1;
      if (this.keys.has('w') || this.keys.has('arrowup')) dy -= 1;
      if (this.keys.has('s') || this.keys.has('arrowdown')) dy += 1;
      if (dx || dy) { this.follow = null; this.camGoal = null; this.r.camX += dx * 260 * dt; this.r.camY += dy * 260 * dt; this.r.clampCam(); }
    }
    // watch mode script
    if (this.mode === 'watch') {
      this.watchT += dt;
      for (const s of this.watchScript) if (!s.done && this.watchT >= s.at) { s.done = true; const cap = $('#watchcap'); if (cap) cap.textContent = `COMMANDER: "${s.text}"`; void this.ask(s.text); }
      if (!this.follow) { const t = liveTasks(st).find((q) => q.source === 'PLAYER'); if (t) this.follow = { taskId: t.id }; }
    }
    // music + wind
    const crit = activeAlerts(st).some((a) => a.severity === 'crit');
    const layer: Layer = crit ? 'emergency' : stormActive(st) ? 'storm' : this.wins.current === 'core' && this.wins.tab === 'research' ? 'research' : isNight(st) ? 'night' : 'base';
    setLayer(layer);
    setWind(stormActive(st) ? (st.weather.storm?.strength ?? 0.8) : 0.15);
    if (st.lost && this.mode === 'play' && this.wins.current !== 'lost') this.wins.open('lost');
    this.hudT -= dt;
    if (this.hudT <= 0) { this.hudT = 0.1; this.hud.update(false); this.brief.tick(); }
    this.saveT += dt;
    if (this.saveT > 15) { this.saveT = 0; this.save(); }
  }

  focus(): { x: number; y: number } | null {
    const st = this.st;
    if (this.follow?.robotId !== undefined) { const r = st.robots.find((q) => q.id === this.follow!.robotId); if (r) return { x: r.x, y: r.y }; }
    if (this.follow?.taskId !== undefined) {
      const t = taskById(st, this.follow.taskId);
      if (!t || t.status === 'done' || t.status === 'failed' || t.status === 'cancelled') { this.follow = null; return null; }
      const rob = st.robots.find((r) => r.jobId !== null && t.jobs.includes(r.jobId));
      if (rob) return { x: rob.x, y: rob.y };
      const site = st.modules.find((m) => m.id === t.siteId);
      if (site) return { x: (site.x + site.w / 2) * 16, y: (site.y + site.h / 2) * 16 };
      // waiting on a prerequisite task: follow that one
      const pre = t.after.map((id) => taskById(st, id)).find((q) => q && q.status !== 'done');
      if (pre) { const r2 = st.robots.find((r) => r.jobId !== null && pre.jobs.includes(r.jobId)); if (r2) return { x: r2.x, y: r2.y }; const ws = st.modules.find((m) => m.fab && m.kind === 'workshop'); if (ws) return { x: (ws.x + 1.5) * 16, y: (ws.y + 1) * 16 }; }
    }
    if (this.camGoal) {
      // with the command panel open, keep the target in the upper part of the screen
      const g = { x: this.camGoal.x, y: this.camGoal.y + (this.cmd.visible ? this.r.h * 0.22 : 0) };
      const dx = g.x - (this.r.camX + this.r.w / 2), dy = g.y - (this.r.camY + this.r.h / 2);
      if (Math.hypot(dx, dy) < 4 && !this.pending) this.camGoal = null;
      return g;
    }
    return null;
  }

  draw(dt: number) {
    const st = this.st;
    const bps: Scene['blueprints'] = [];
    if (this.pending?.plan.sites) {
      const s = this.pending.plan.sites;
      const opts = s.options.slice(this.pending.idx, this.pending.idx + s.count);
      for (const o of opts) bps.push({ kind: s.kind, x: o.x, y: o.y, ok: true, primary: true });
    }
    if (this.placing && this.hoverTile) {
      const def = MODULES[this.placing];
      const x = this.hoverTile[0] - Math.floor(def.w / 2), y = this.hoverTile[1] - Math.floor(def.h / 2);
      const chk = checkSite(st, this.placing, x, y);
      bps.push({ kind: this.placing, x, y, ok: chk.ok, reason: chk.reason, primary: true });
    }
    const routes: [number, number][][] = [];
    const scene: Scene = { st, time: this.time, selected: this.selected, hoverTile: this.placing || this.pending ? null : this.hoverTile, blueprints: bps, overlay: this.overlay, focus: this.mode === 'title' ? null : this.focus(), routes, title: this.mode === 'title' };
    this.r.render(scene, dt);
    if (this.mode !== 'title') this.hud.drawWorld(bps);
  }
}

export { hour, clock, MAP_W, MAP_H };
