// Draws the colony: ground, deposits, modules, robots, colonists, shuttle, conveyors, cables,
// particles, blueprints, overlays, lighting, storm haze and fog of war.

import { MODULES, ModuleKind, RES, ResId, ROBOTS, TUNE } from '../sim/defs';
import { daylight, hourOf } from '../sim/core';
import { checkSite, centerOf } from '../sim/grid';
import { o2Cap, batteryCap, stormFactor } from '../sim/power';
import { feedStores } from '../sim/production';
import { capOf, usedOf } from '../sim/storage';
import type { ColonyState, Module, Robot } from '../sim/state';
import { MAP_H, MAP_W, explored, exploredVersion, terrain } from '../sim/world';
import { canvas, disc, ellipse, mix, px, rect } from './pix';
import { C } from './palette';
import { fogLayer, groundLayer } from './terrain';
import { cratePile, frameSprite, Light, moduleSprite, UP } from './modules';
import { colonistSprite, depositSprite, resIcon, robotSprite, shuttleSprite } from './units';

export type Overlay = 'none' | 'power' | 'oxygen' | 'logistics' | 'resource' | 'paths' | 'core';
export interface Scene {
  st: ColonyState;
  time: number;
  selected: { kind: 'robot' | 'module' | 'deposit'; id: number } | null;
  hoverTile: [number, number] | null;
  blueprints: { kind: ModuleKind; x: number; y: number; ok: boolean; reason?: string; primary?: boolean }[];
  overlay: Overlay;
  focus: { x: number; y: number } | null;     // world px the camera should centre on
  routes: [number, number][][];               // planned routes to preview (mine/scout)
  title?: boolean;
}

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; col: string; g: number; size: number }
interface Floater { x: number; y: number; text: string; col: string; t: number; big?: boolean }
interface Flyer { x: number; y: number; tx: number; ty: number; t: number; icon: HTMLCanvasElement }
interface Devil { x: number; y: number; vx: number; vy: number; life: number }

export class Renderer {
  cv: HTMLCanvasElement; c: CanvasRenderingContext2D;
  w = 320; h = 200; scale = 3; zoom = 0; baseScale = 3;
  camX = 0; camY = 0;
  light: HTMLCanvasElement; lc: CanvasRenderingContext2D;
  particles: Particle[] = []; floaters: Floater[] = []; flyers: Flyer[] = []; devils: Devil[] = [];
  shake = 0;
  streaks: { x: number; y: number; s: number }[] = [];
  constructor(cv: HTMLCanvasElement) {
    this.cv = cv;
    this.c = cv.getContext('2d')!;
    [this.light, this.lc] = canvas(10, 10);
    for (let i = 0; i < 90; i++) this.streaks.push({ x: Math.random() * 600, y: Math.random() * 400, s: 0.6 + Math.random() });
  }
  resize(W: number, H: number) {
    this.baseScale = Math.max(2, Math.min(5, Math.floor(Math.min(H / 300, W / 420))));
    const s = Math.max(1, Math.min(6, this.baseScale + this.zoom));
    this.scale = s;
    this.w = Math.ceil(W / s); this.h = Math.ceil(H / s);
    this.cv.width = this.w; this.cv.height = this.h;
    this.cv.style.width = `${this.w * s}px`; this.cv.style.height = `${this.h * s}px`;
    this.c.imageSmoothingEnabled = false;
    this.light.width = this.w; this.light.height = this.h;
  }
  setZoom(z: number, W: number, H: number) { const cx = this.camX + this.w / 2, cy = this.camY + this.h / 2; this.zoom = Math.max(-1, Math.min(2, z)); this.resize(W, H); this.camX = cx - this.w / 2; this.camY = cy - this.h / 2; }
  screenToWorld(sx: number, sy: number) { return { x: sx / this.scale + Math.round(this.camX), y: sy / this.scale + Math.round(this.camY) }; }
  screenToTile(sx: number, sy: number): [number, number] { const p = this.screenToWorld(sx, sy); return [Math.floor(p.x / 16), Math.floor(p.y / 16)]; }
  worldToScreen(x: number, y: number) { return { x: (x - Math.round(this.camX)) * this.scale, y: (y - Math.round(this.camY)) * this.scale }; }
  clampCam() {
    const MW = MAP_W * 16, MH = MAP_H * 16;
    this.camX = this.w >= MW ? -(this.w - MW) / 2 : Math.max(-40, Math.min(MW - this.w + 40, this.camX));
    this.camY = this.h >= MH ? -(this.h - MH) / 2 : Math.max(-40, Math.min(MH - this.h + 40, this.camY));
  }
  centerOn(x: number, y: number, snap = false) {
    const tx = x - this.w / 2, ty = y - this.h / 2;
    if (snap) { this.camX = tx; this.camY = ty; } else { this.camX += (tx - this.camX) * 0.12; this.camY += (ty - this.camY) * 0.12; }
    this.clampCam();
  }

  // ---------------------------------------------------------------- fx API
  burst(x: number, y: number, n: number, col: string, spread = 40, up = 40, g = 120, size = 1) { for (let i = 0; i < n; i++) this.particles.push({ x, y, vx: (Math.random() - 0.5) * spread, vy: -Math.random() * up - 5, life: 0, max: 0.4 + Math.random() * 0.4, col, g, size }); }
  dust(x: number, y: number, n = 3) { for (let i = 0; i < n; i++) this.particles.push({ x: x + (Math.random() - 0.5) * 6, y: y + (Math.random() - 0.5) * 3, vx: (Math.random() - 0.5) * 12, vy: -Math.random() * 8, life: 0, max: 0.6 + Math.random() * 0.5, col: Math.random() < 0.5 ? C.mars[6] : C.mars[5], g: -4, size: 2 }); }
  smoke(x: number, y: number) { this.particles.push({ x, y, vx: (Math.random() - 0.5) * 6, vy: -10 - Math.random() * 8, life: 0, max: 1.4, col: '#6a6070', g: -2, size: 2 }); }
  float(x: number, y: number, text: string, col = '#ffffff', big = false) { this.floaters.push({ x, y, text, col, t: 0, big }); }
  fly(x: number, y: number, tx: number, ty: number, res: ResId) { this.flyers.push({ x, y, tx, ty, t: 0, icon: resIcon(res, 8) }); }
  impact(x: number, y: number) { this.shake = 1.5; this.burst(x, y, 40, C.yellowL, 120, 90, 160, 2); this.burst(x, y, 30, C.mars[6], 90, 60, 100, 2); for (let i = 0; i < 6; i++) this.smoke(x + (Math.random() - 0.5) * 10, y); }

  // ---------------------------------------------------------------- main
  render(sc: Scene, dt: number) {
    const { st } = sc;
    const c = this.c, t = sc.time;
    if (sc.focus) this.centerOn(sc.focus.x, sc.focus.y);
    this.clampCam();
    this.shake = Math.max(0, this.shake - dt * 3);
    const sh = this.shake > 0 ? Math.round((Math.random() - 0.5) * this.shake * 3) : 0;
    const cx = Math.round(this.camX) + sh, cy = Math.round(this.camY);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#0b0810';
    c.fillRect(0, 0, this.w, this.h);
    c.translate(-cx, -cy);
    const terr = terrain(st);
    c.drawImage(groundLayer(st, terr), 0, 0);
    const vis = (x: number, y: number, m = 64) => x > cx - m && x < cx + this.w + m && y > cy - m && y < cy + this.h + m;

    // deposits
    for (const d of st.deposits) {
      if (!vis(d.x * 16, d.y * 16)) continue;
      if (d.amount <= 0 && d.kind !== 'vent') continue;
      const level = d.kind === 'vent' ? 4 : Math.max(1, Math.ceil((d.amount / d.max) * 4));
      c.drawImage(depositSprite(d.kind, level), d.x * 16 - 1, d.y * 16 - 2);
      if (d.kind === 'vent' && Math.random() < dt * 4) this.smoke(d.x * 16 + 17, d.y * 16 + 18);
    }

    // conveyors (workshop ↔ storage in range)
    for (const w of st.modules) {
      if (w.kind !== 'workshop' || w.status !== 'online') continue;
      for (const s of feedStores(st, w)) this.conveyor(w, s, t);
    }

    // overlays below modules
    if (sc.overlay === 'power') this.powerOverlay(st, t);
    if (sc.overlay === 'oxygen') this.oxygenOverlay(st, t);
    if (sc.overlay === 'resource') this.resourceOverlay(st, t);
    if (sc.overlay === 'core') this.coreOverlay(st, t);

    // cable/pipe while connecting
    for (const m of st.modules) if (m.link) {
      const a = st.modules.find((q) => q.id === m.link!.to);
      const j = st.jobs.find((q) => q.kind === 'connect' && q.target === m.id && q.status === 'active');
      if (a) this.cable(centerOf(m), centerOf(a), (j?.moved ?? 0) / 100, m.link.pipe, t);
    }

    // y-sorted entities
    const ents: { y: number; draw: () => void }[] = [];
    for (const m of st.modules) {
      const def = MODULES[m.kind];
      if (!vis(m.x * 16, m.y * 16, 120)) continue;
      if (m.kind === 'pad') { ents.push({ y: -1e6, draw: () => this.drawModule(st, m, t) }); continue; }
      ents.push({ y: (m.y + def.h) * 16, draw: () => this.drawModule(st, m, t) });
    }
    for (const r of st.robots) { if (!vis(r.x, r.y)) continue; ents.push({ y: r.y + (ROBOTS[r.kind].flying ? 30 : 4), draw: () => this.drawRobot(st, r, t, sc) }); }
    for (const col of st.colonists) { if (col.dead || col.inside !== null || !vis(col.x, col.y)) continue; ents.push({ y: col.y, draw: () => { const fr = col.path.length ? Math.floor(t * 6) % 2 : 0; const nx = col.path[0]; const facing = nx ? (Math.abs(nx[0] * 16 + 8 - col.x) > Math.abs(nx[1] * 16 + 12 - col.y) ? (nx[0] * 16 + 8 > col.x ? 'right' : 'left') : nx[1] * 16 + 12 > col.y ? 'down' : 'up') : 'down'; ellipse(c, col.x, col.y + 1, 3, 1.2, 'rgba(60,20,10,0.35)'); c.drawImage(colonistSprite(col.role, facing, fr), Math.round(col.x - 6), Math.round(col.y - 14)); } }); }
    for (const dv of this.devils) ents.push({ y: dv.y, draw: () => this.drawDevil(dv, t) });
    ents.sort((a, b) => a.y - b.y);
    for (const e of ents) e.draw();

    // shuttle
    this.drawShuttle(st, t);

    // routes / paths
    if (sc.overlay === 'paths') for (const r of st.robots) this.drawPath(r, t, ROBOTS[r.kind].color);
    if (sc.selected?.kind === 'robot') { const r = st.robots.find((q) => q.id === sc.selected!.id); if (r) this.drawPath(r, t, C.green); }
    for (const route of sc.routes) this.drawRoute(route, t);

    // blueprints
    for (const bp of sc.blueprints) this.drawBlueprint(st, bp, t);

    // selection
    if (sc.selected) this.drawSelection(st, sc, t);
    if (sc.hoverTile && !sc.blueprints.length) { const [hx, hy] = sc.hoverTile; c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 1; c.strokeRect(hx * 16 + 0.5, hy * 16 + 0.5, 15, 15); }

    // particles
    this.updateParticles(dt);
    for (const p of this.particles) { c.globalAlpha = Math.max(0, 1 - p.life / p.max); rect(c, p.x, p.y, p.size, p.size, p.col); }
    c.globalAlpha = 1;
    for (const f of this.flyers) { f.t += dt * 1.6; const k = Math.min(1, f.t); const x = f.x + (f.tx - f.x) * k, y = f.y + (f.ty - f.y) * k - Math.sin(k * Math.PI) * 14; c.drawImage(f.icon, Math.round(x - 5), Math.round(y - 5)); }
    this.flyers = this.flyers.filter((f) => f.t < 1);

    // lighting + weather
    this.lighting(st, t, cx, cy, sc);
    const storm = stormFactor(st);
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (storm > 0) this.stormLayer(storm, t, dt);

    // fog of war
    c.translate(-cx, -cy);
    if (!sc.title) c.drawImage(fogLayer(explored(st), exploredVersion), 0, 0);
    // signals over fog
    for (const d of st.deposits) if (d.signal && !d.found) this.drawSignal(d.x * 16 + 16, d.y * 16 + 16, RES[d.kind === 'titanium' ? 'titanium' : 'iron'].short, t);

    // floaters
    c.textAlign = 'center';
    for (const f of this.floaters) {
      f.t += dt;
      const a = Math.min(1, 2.6 - f.t);
      if (a <= 0) continue;
      c.globalAlpha = a;
      c.font = f.big ? '8px Silkscreen, monospace' : '8px Silkscreen, monospace';
      const y = f.y - f.t * (f.big ? 8 : 14);
      const w = c.measureText(f.text).width;
      if (f.big) { rect(c, f.x - w / 2 - 3, y - 8, w + 6, 11, C.ink); rect(c, f.x - w / 2 - 3, y - 8, w + 6, 1, f.col); }
      c.fillStyle = C.ink; c.fillText(f.text, f.x + 1, y + 1);
      c.fillStyle = f.col; c.fillText(f.text, f.x, y);
    }
    c.globalAlpha = 1;
    this.floaters = this.floaters.filter((f) => f.t < 2.6);
    c.setTransform(1, 0, 0, 1, 0, 0);
    this.updateDevils(st, dt);
  }

  // ---------------------------------------------------------------- modules
  drawModule(st: ColonyState, m: Module, t: number) {
    const c = this.c;
    const def = MODULES[m.kind];
    const spr = moduleSprite(m.kind);
    const ox = m.x * 16 - 1, oy = m.y * 16 - spr.up - 1;
    const W = def.w * 16, H = def.h * 16;
    if (m.kind === 'pad') { c.drawImage(spr.cv, ox, oy); for (const [i, l] of spr.lights.entries()) if ((Math.floor(t * 2) + i) % 2 === 0) disc(c, ox + l.x, oy + l.y, 1.5, C.red); const staged = Object.values(m.delivered).reduce((a, b) => a + (b ?? 0), 0); if (staged > 0) c.drawImage(cratePile(Math.min(6, Math.ceil(staged / 8))), m.x * 16 + 4, m.y * 16 + H - 18); return; }
    // shadow
    if (m.status === 'online' || m.status === 'off' || m.progress > 0.66) ellipse(c, m.x * 16 + W / 2 + 4, m.y * 16 + H - 2, W / 2 + 2, 6, 'rgba(60,18,8,0.35)');
    if (m.salvage || m.status === 'site' || m.status === 'building') { this.drawSite(st, m, t, ox, oy); return; }
    c.drawImage(spr.cv, ox, oy);
    this.moduleOverlay(st, m, t, ox, oy);
    // state marks
    const top = oy + 2;
    if (m.status === 'off') { c.globalAlpha = 0.45; rect(c, ox + 1, oy + 1, spr.w - 2, spr.h - 2, '#20202a'); c.globalAlpha = 1; this.pip(m.x * 16 + W / 2, top, 'OFF', C.ti[4]); }
    else if (!m.powered && def.cat !== 'core' && !def.gen && m.kind !== 'battery' && m.kind !== 'storage') this.pip(m.x * 16 + W / 2, top, '⚡', C.yellow);
    if (m.hp < 0.95) {
      if (Math.random() < 0.15) this.smoke(m.x * 16 + Math.random() * W, m.y * 16 + H / 2);
      if (Math.random() < 0.05) this.burst(m.x * 16 + Math.random() * W, m.y * 16 + Math.random() * H, 3, C.yellowL, 30, 20, 60);
      if (m.kind === 'habitat' && Math.random() < 0.3) this.particles.push({ x: m.x * 16 + Math.random() * W, y: m.y * 16 + 4, vx: (Math.random() - 0.5) * 10, vy: -12, life: 0, max: 0.8, col: C.cyanL, g: -6, size: 1 });
      if (Math.floor(t * 3) % 2 === 0) this.pip(m.x * 16 + W - 4, top, '!', C.red);
    }
  }

  pip(x: number, y: number, text: string, col: string) {
    const c = this.c;
    c.font = '8px Silkscreen, monospace'; c.textAlign = 'center';
    const w = Math.max(7, c.measureText(text).width + 4);
    rect(c, x - w / 2, y - 9, w, 9, C.ink); rect(c, x - w / 2 + 1, y - 8, w - 2, 7, col);
    c.fillStyle = C.ink; c.fillText(text, x, y - 2);
  }

  moduleOverlay(st: ColonyState, m: Module, t: number, ox: number, oy: number) {
    const c = this.c;
    const spr = moduleSprite(m.kind);
    switch (m.kind) {
      case 'core': {
        const pulse = 0.5 + 0.5 * Math.sin(t * 3);
        disc(c, ox + spr.w / 2, oy + 15, 4 + pulse, mix(C.greenD, C.greenL, pulse));
        disc(c, ox + spr.w / 2, oy + 15, 2, '#ffffff');
        for (let y = 23; y < spr.h - 14; y += 4) { const on = (Math.floor(t * 4) + y) % 3 === 0; if (on) { rect(c, ox + 12, oy + y, 2, 2, C.green); rect(c, ox + spr.w - 14, oy + y, 2, 2, C.green); } }
        break;
      }
      case 'oxygen': {
        const f = Math.max(0, Math.min(1, st.o2 / Math.max(1, o2Cap(st))));
        for (const tx of [4, 18]) { const hh = Math.round(12 * f); rect(c, ox + tx + 4, oy + 14 + 12 - hh, 3, hh, C.cyanL); }
        if (m.running && Math.random() < 0.25) this.particles.push({ x: ox + 8 + Math.random() * 18, y: oy + 28, vx: 0, vy: -8, life: 0, max: 1.4, col: '#ffffff', g: -2, size: 1 });
        const ice = Math.ceil((m.hopper / TUNE.hopperCap) * 6);
        for (let i = 0; i < ice; i++) rect(c, ox + 11 + (i % 3) * 4, oy + spr.h - 12 + (i < 3 ? 1 : -2), 3, 2, C.ice[i % 2 ? 2 : 3]);
        break;
      }
      case 'battery': {
        const f = Math.max(0, Math.min(1, st.power.battery / Math.max(1, batteryCap(st))));
        for (let k = 0; k < 3; k++) { const x = ox + 3 + k * 9 + 2; const bars = Math.round(f * 4); for (let b = 0; b < 4; b++) rect(c, x, oy + 25 - b * 2, 4, 1, b < bars ? (f < 0.2 ? C.red : C.yellow) : '#2a2533'); }
        break;
      }
      case 'storage': case 'outpost': {
        if (m.kind === 'outpost') { if (Math.floor(t * 2) % 2 === 0) disc(c, ox + spr.w / 2, oy + 1, 1.5, C.red); break; }
        const f = usedOf(m) / Math.max(1, capOf(m));
        const n = Math.round(f * 8);
        const top = Object.entries(m.store).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).slice(0, 3).map(([r]) => RES[r as ResId]);
        for (let i = 0; i < n; i++) { const col = top[i % Math.max(1, top.length)]?.color ?? C.orange; const x = ox + 6 + (i % 4) * 6, y = oy + 15 - Math.floor(i / 4) * 4; rect(c, x, y, 5, 4, col); rect(c, x, y, 5, 1, '#ffffff'); rect(c, x, y + 3, 5, 1, 'rgba(0,0,0,0.35)'); }
        break;
      }
      case 'solar': {
        if (m.dust > 0.02) { c.globalAlpha = Math.min(0.75, m.dust * 1.1); rect(c, ox + 2, oy + 3, spr.w - 4, 25, C.mars[5]); c.globalAlpha = 1; }
        const g = ((t * 22 + m.id * 13) % 90) - 20;
        if (g > 0 && g < spr.w && hourOf(st.minute) > 6 && hourOf(st.minute) < 19) for (let y = 0; y < 24; y++) px(c, ox + 2 + g + y * 0.4, oy + 4 + y, 'rgba(255,255,255,0.55)');
        break;
      }
      case 'workshop': {
        if (m.fab && m.powered) { if (Math.random() < 0.4) this.burst(ox + 18 + Math.random() * 10, oy + 32, 2, C.yellowL, 30, 30, 90); if (Math.random() < 0.2) this.smoke(ox + spr.w - 8, oy); }
        break;
      }
      case 'lab': {
        if (st.research.current && st.research.delivered && m.powered) { const a = (t * 2) % (Math.PI * 2); disc(c, ox + 20 + Math.cos(a) * 4, oy + 14 + Math.sin(a) * 2, 1.5, C.ice[4]); }
        break;
      }
      case 'robotbay': {
        if (m.fab && m.fab.kind === 'robot' && m.powered) { if (Math.random() < 0.4) this.burst(ox + 14 + Math.random() * 20, oy + 28, 2, C.yellowL, 30, 20, 90); if (Math.floor(t * 4) % 2) disc(c, ox + 5, oy + 6, 1.5, C.orangeL); }
        break;
      }
      case 'comm': if (Math.floor(t * 1.5) % 2 === 0) disc(c, ox + spr.w / 2, oy + 1, 1.5, C.red); break;
      case 'wind': {
        const a = t * (stormFactor(st) > 0 ? 9 : 3);
        const hx = ox + spr.w / 2, hy = oy + 8;
        for (let k = 0; k < 3; k++) { const an = a + (k * Math.PI * 2) / 3; for (let r = 2; r < 13; r++) px(c, hx + Math.cos(an) * r, hy + Math.sin(an) * r * 0.9, r < 4 ? C.ti[2] : '#ffffff'); }
        disc(c, hx, hy, 1.5, C.ti[1]);
        break;
      }
      case 'geo': case 'reactor': if (Math.random() < 0.2) this.smoke(ox + spr.w / 2, oy + 4); break;
      case 'command': { const a = t * 0.8; ellipse(c, ox + 40, oy + 6, 6 * Math.abs(Math.cos(a)) + 1, 4, '#ffffff'); px(c, ox + 40, oy + 6, C.red); if (Math.floor(t * 1.2) % 2 === 0) px(c, ox + 4, oy, C.red); break; }
    }
  }

  drawSite(st: ColonyState, m: Module, t: number, ox: number, oy: number) {
    const c = this.c;
    const def = MODULES[m.kind];
    const W = def.w * 16, H = def.h * 16;
    const x0 = m.x * 16, y0 = m.y * 16;
    const p = m.progress;
    if (m.salvage) {
      if (p > 0.05) c.drawImage(frameSprite(m.kind, 2), ox, oy);
    } else if (p <= 0) {
      // blueprint outline
      c.strokeStyle = C.cyan; c.lineWidth = 1; c.setLineDash([3, 2]); c.lineDashOffset = -t * 8;
      c.strokeRect(x0 + 1.5, y0 + 1.5, W - 3, H - 3); c.setLineDash([]);
      c.globalAlpha = 0.18; rect(c, x0 + 2, y0 + 2, W - 4, H - 4, C.cyan); c.globalAlpha = 1;
    } else if (p < 0.33) c.drawImage(frameSprite(m.kind, 1), ox, oy);
    else if (p < 0.66) c.drawImage(frameSprite(m.kind, 2), ox, oy);
    else {
      c.drawImage(frameSprite(m.kind, 2), ox, oy);
      const spr = moduleSprite(m.kind);
      const f = (p - 0.66) / 0.34;
      const hh = Math.round(spr.h * f);
      c.drawImage(spr.cv, 0, spr.h - hh, spr.w, hh, ox, oy + spr.h - hh, spr.w, hh);
    }
    // delivered materials as a crate pile
    const delivered = Object.values(m.delivered).reduce((a, b) => a + (b ?? 0), 0);
    if (delivered > 0) c.drawImage(cratePile(Math.ceil(delivered / 8)), x0 + W - 16, y0 + H - 14);
    // progress bar
    if (!m.salvage) {
      rect(c, x0 + 2, y0 + H + 2, W - 4, 3, C.ink);
      const need = Object.values(MODULES[m.kind].cost).reduce((a, b) => a + (b ?? 0), 0);
      const mat = need ? Math.min(1, delivered / need) : 1;
      rect(c, x0 + 3, y0 + H + 3, (W - 6) * (p > 0 ? p : mat * 0.999), 1, p > 0 ? C.yellow : C.cyan);
    }
  }

  // ---------------------------------------------------------------- robots
  drawRobot(st: ColonyState, r: Robot, t: number, sc: Scene) {
    const c = this.c;
    const def = ROBOTS[r.kind];
    const moving = r.state === 'moving';
    const working = r.state === 'working';
    const frame = moving || working ? Math.floor(t * (working ? 8 : 6)) : 0;
    const hover = def.flying ? 7 + Math.sin(t * 4 + r.id) * 1.5 : 0;
    const x = Math.round(r.x - 10), y = Math.round(r.y - 14 - hover);
    ellipse(c, r.x, r.y + 3, def.flying ? 5 : 7, def.flying ? 2 : 2.5, def.flying ? 'rgba(40,10,5,0.3)' : 'rgba(60,18,8,0.4)');
    if (r.state === 'broken' || r.state === 'dead') { c.globalAlpha = 0.85; }
    c.drawImage(robotSprite(r.kind, r.facing, frame, { cargo: r.kind === 'hauler' ? r.cargo?.res ?? null : null, working }), x, y);
    c.globalAlpha = 1;
    if (moving && !def.flying && Math.random() < 0.3) this.dust(r.x, r.y + 3, 1);
    if (working && r.kind === 'miner' && Math.random() < 0.5) { const dx = r.facing === 'left' ? -9 : r.facing === 'right' ? 9 : 0, dy = r.facing === 'up' ? -12 : r.facing === 'down' ? 6 : -2; this.burst(r.x + dx, r.y + dy, 2, Math.random() < 0.5 ? C.yellowL : C.mars[6], 40, 30, 120); }
    if (working && r.kind === 'builder' && Math.random() < 0.3) this.burst(r.x + (r.facing === 'left' ? -9 : 9), r.y - 10, 2, C.yellowL, 30, 20, 90);
    if (working && def.flying && Math.random() < 0.3) this.dust(r.x, r.y + 2, 1);
    // cargo chip for non-haulers
    if (r.cargo && r.kind !== 'hauler') c.drawImage(resIcon(r.cargo.res, 6), x + 12, y - 2);
    // pips
    if (r.state === 'broken' || r.state === 'dead') { if (Math.floor(t * 3) % 2 === 0) this.pip(r.x, y, '!', C.red); if (Math.random() < 0.1) this.smoke(r.x, r.y - 8); }
    else if (r.state === 'charging') this.pip(r.x, y, '⚡', C.yellow);
    else if (r.battery < 30) this.pip(r.x, y, `${Math.round(r.battery)}%`, r.battery < 15 ? C.red : C.yellow);
    if (r.recall && outsideBase(r)) this.pip(r.x, y - 10, '↩', C.cyan);
    void sc;
  }

  drawPath(r: Robot, t: number, col: string) {
    if (!r.path.length) return;
    const c = this.c;
    let px0 = r.x, py0 = r.y;
    c.fillStyle = col;
    for (let i = 0; i < r.path.length; i++) {
      const [tx, ty] = r.path[i];
      const x = tx * 16 + 8, y = ty * 16 + 10;
      const steps = Math.max(1, Math.round(Math.hypot(x - px0, y - py0) / 4));
      for (let s = 0; s < steps; s++) { if ((s + Math.floor(t * 6) + i) % 3 !== 0) continue; c.fillRect(Math.round(px0 + ((x - px0) * s) / steps), Math.round(py0 + ((y - py0) * s) / steps), 1, 1); }
      px0 = x; py0 = y;
    }
    const [gx, gy] = r.path[r.path.length - 1];
    c.strokeStyle = col; c.lineWidth = 1; c.strokeRect(gx * 16 + 3.5, gy * 16 + 5.5, 9, 9);
  }
  drawRoute(route: [number, number][], t: number) {
    const c = this.c;
    for (let i = 1; i < route.length; i++) {
      const [ax, ay] = route[i - 1], [bx, by] = route[i];
      const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) * 4));
      for (let s = 0; s < n; s++) if ((s + Math.floor(t * 8)) % 3 === 0) rect(c, (ax + ((bx - ax) * s) / n) * 16 + 8, (ay + ((by - ay) * s) / n) * 16 + 8, 2, 2, C.green);
    }
    const last = route[route.length - 1];
    if (last) { const p = 3 + Math.sin(t * 5) * 1.5; c.strokeStyle = C.green; c.strokeRect(last[0] * 16 + 8 - p - 2, last[1] * 16 + 8 - p - 2, p * 2 + 4, p * 2 + 4); }
  }

  drawBlueprint(st: ColonyState, bp: Scene['blueprints'][number], t: number) {
    const c = this.c;
    const def = MODULES[bp.kind];
    const spr = moduleSprite(bp.kind);
    const x0 = bp.x * 16, y0 = bp.y * 16, W = def.w * 16, H = def.h * 16;
    const col = bp.ok ? C.cyan : C.red;
    c.globalAlpha = bp.primary === false ? 0.25 : 0.5;
    c.drawImage(spr.cv, x0 - 1, y0 - spr.up - 1);
    c.globalAlpha = bp.primary === false ? 0.12 : 0.25;
    rect(c, x0, y0, W, H, col);
    c.globalAlpha = 1;
    c.strokeStyle = col; c.lineWidth = 1; c.setLineDash([3, 2]); c.lineDashOffset = -t * 10;
    c.strokeRect(x0 + 0.5, y0 + 0.5, W - 1, H - 1); c.setLineDash([]);
    if (bp.primary !== false) { const s = 3; for (const [cx2, cy2, dx, dy] of [[x0 - 2, y0 - 2, 1, 1], [x0 + W + 1, y0 - 2, -1, 1], [x0 - 2, y0 + H + 1, 1, -1], [x0 + W + 1, y0 + H + 1, -1, -1]]) { rect(c, Math.min(cx2, cx2 + dx * s), cy2, s + 1, 1, col); rect(c, cx2, Math.min(cy2, cy2 + dy * s), 1, s + 1, col); } }
    void st; void checkSite;
  }

  drawSelection(st: ColonyState, sc: Scene, t: number) {
    const c = this.c;
    const s = sc.selected!;
    let x = 0, y = 0, w = 0, h = 0;
    if (s.kind === 'robot') { const r = st.robots.find((q) => q.id === s.id); if (!r) return; x = r.x - 9; y = r.y - 16 - (ROBOTS[r.kind].flying ? 7 : 0); w = 18; h = 20; }
    else if (s.kind === 'module') { const m = st.modules.find((q) => q.id === s.id); if (!m) return; const up = UP[m.kind]; x = m.x * 16 - 2; y = m.y * 16 - up - 2; w = m.w * 16 + 4; h = m.h * 16 + up + 4; }
    else { const d = st.deposits.find((q) => q.id === s.id); if (!d) return; x = d.x * 16 - 2; y = d.y * 16 - 2; w = 36; h = 36; }
    const p = Math.floor((Math.sin(t * 6) + 1) * 1.2);
    const L = 4;
    c.fillStyle = C.green;
    for (const [ax, ay, dx, dy] of [[x - p, y - p, 1, 1], [x + w + p, y - p, -1, 1], [x - p, y + h + p, 1, -1], [x + w + p, y + h + p, -1, -1]]) {
      c.fillRect(Math.min(ax, ax + dx * L), ay, L + 1, 1);
      c.fillRect(ax, Math.min(ay, ay + dy * L), 1, L + 1);
    }
  }

  // ---------------------------------------------------------------- infrastructure lines
  conveyor(a: Module, b: Module, t: number) {
    const c = this.c;
    const [ax, ay] = centerOf(a), [bx, by] = centerOf(b);
    // L-shaped belt along the ground between the closest edges
    const sx = (ax < bx ? a.x + a.w : a.x) * 16 + (ax < bx ? 0 : -1), sy = Math.round(ay * 16) + 4;
    const ex = (ax < bx ? b.x : b.x + b.w) * 16, ey = Math.round(by * 16) + 4;
    const pts: [number, number][] = [[sx, sy], [ex, sy], [ex, ey]];
    for (let i = 1; i < pts.length; i++) {
      const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
      const horiz = y1 === y2;
      const minx = Math.min(x1, x2), miny = Math.min(y1, y2);
      if (horiz) { rect(c, minx, y1 - 2, Math.abs(x2 - x1), 5, C.ink); rect(c, minx, y1 - 1, Math.abs(x2 - x1), 3, '#3a3448'); for (let k = minx + ((Math.floor(t * 12) * (x2 > x1 ? 1 : -1)) % 4 + 4) % 4; k < Math.max(x1, x2); k += 4) rect(c, k, y1 - 1, 1, 3, '#5a5268'); }
      else { rect(c, x1 - 2, miny, 5, Math.abs(y2 - y1), C.ink); rect(c, x1 - 1, miny, 3, Math.abs(y2 - y1), '#3a3448'); for (let k = miny + ((Math.floor(t * 12)) % 4); k < Math.max(y1, y2); k += 4) rect(c, x1 - 1, k, 3, 1, '#5a5268'); }
    }
  }
  cable([ax, ay]: [number, number], [bx, by]: [number, number], f: number, pipe: boolean, t: number) {
    const c = this.c;
    const x1 = ax * 16, y1 = ay * 16, x2 = bx * 16, y2 = by * 16;
    const n = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1) / 2));
    const k = Math.round(n * Math.max(0, Math.min(1, f)));
    for (let i = 0; i <= k; i++) { const x = x1 + ((x2 - x1) * i) / n, y = y1 + ((y2 - y1) * i) / n; rect(c, x, y, 2, 2, pipe ? C.cyan : C.yellow); if (pipe) px(c, x, y + 2, C.cyanD); else px(c, x, y + 2, C.yellowD); }
    if (k < n && Math.random() < 0.5) this.burst(x1 + ((x2 - x1) * k) / n, y1 + ((y2 - y1) * k) / n, 1, pipe ? C.cyanL : C.yellowL, 20, 20, 60);
    void t;
  }
  /** CORE network: green circuit traces from the AI core to every module (drawn under the modules). */
  coreGlow: [number, number][] = [];
  coreOverlay(st: ColonyState, t: number) {
    const core = st.modules.find((m) => m.kind === 'core' && m.status === 'online');
    if (!core) return;
    const c = this.c;
    const [cx0, cy0] = centerOf(core);
    const cx = Math.round(cx0 * 16), cy = Math.round(cy0 * 16 + 6);
    const mods = st.modules.filter((m) => m.id !== core.id && m.status === 'online' && m.kind !== 'pad');
    this.coreGlow = [[cx, cy]];
    mods.forEach((m, i) => {
      const [mx0, my0] = centerOf(m);
      const mx = Math.round(mx0 * 16), my = Math.round(my0 * 16 + 4);
      // orthogonal route: leave the core along x or y depending on index, one bend
      const bend: [number, number] = i % 2 ? [mx, cy] : [cx, my];
      const seg = (ax: number, ay: number, bx: number, by: number) => {
        const x = Math.min(ax, bx), y = Math.min(ay, by), w = Math.abs(bx - ax), h = Math.abs(by - ay);
        rect(c, x - 2, y - 2, w + 4, h + 4, 'rgba(7,5,11,0.75)');
        rect(c, x - 1, y - 1, w + 2, h + 2, C.greenDD);
        rect(c, x, y, Math.max(1, w), Math.max(1, h), C.greenD);
      };
      seg(cx, cy, bend[0], bend[1]); seg(bend[0], bend[1], mx, my);
      for (const [ax, ay, bx, by] of [[cx, cy, bend[0], bend[1]], [bend[0], bend[1], mx, my]]) {
        const n = Math.max(1, Math.round((Math.abs(bx - ax) + Math.abs(by - ay)) / 22));
        for (let k = 0; k <= n; k++) this.coreGlow.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
      }
      rect(c, bend[0] - 2, bend[1] - 2, 5, 5, C.green); rect(c, bend[0] - 1, bend[1] - 1, 3, 3, C.greenL);
      // a data pulse running along the trace
      const L1 = Math.abs(bend[0] - cx) + Math.abs(bend[1] - cy), L2 = Math.abs(mx - bend[0]) + Math.abs(my - bend[1]);
      const k = ((t * 60 + i * 37) % (L1 + L2 + 40));
      let px = cx, py = cy;
      if (k < L1) { px = cx + Math.sign(bend[0] - cx) * Math.min(k, Math.abs(bend[0] - cx)); py = cy + Math.sign(bend[1] - cy) * Math.min(k, Math.abs(bend[1] - cy)); }
      else if (k < L1 + L2) { const q = k - L1; px = bend[0] + Math.sign(mx - bend[0]) * Math.min(q, Math.abs(mx - bend[0])); py = bend[1] + Math.sign(my - bend[1]) * Math.min(q, Math.abs(my - bend[1])); }
      else return;
      rect(c, px - 2, py - 2, 4, 4, C.greenL);
    });
  }

  powerOverlay(st: ColonyState, t: number) {
    const hub = st.modules.find((m) => m.kind === 'command');
    if (!hub) return;
    for (const m of st.modules) {
      if (m.id === hub.id || m.kind === 'pad' || m.status !== 'online') continue;
      const def = MODULES[m.kind];
      this.cable(centerOf(m), centerOf(hub), 1, false, t);
      const [x, y] = centerOf(m);
      const v = def.gen ? `+${Math.round(def.kind === 'solar' ? TUNE.solarPeak : def.gen)}` : def.draw ? `-${def.draw}` : '';
      if (v) this.pip(x * 16, y * 16 - 4, v, def.gen ? C.yellow : m.powered ? C.ti[4] : C.red);
    }
  }
  oxygenOverlay(st: ColonyState, t: number) {
    const gens = st.modules.filter((m) => (m.kind === 'oxygen' || m.kind === 'habitat' || m.kind === 'command' || m.kind === 'medical') && m.status === 'online');
    const src = gens.filter((m) => m.kind === 'oxygen');
    for (const g of src) for (const m of gens) if (m.kind !== 'oxygen') this.cable(centerOf(g), centerOf(m), 1, true, t);
    for (const m of gens) { const [x, y] = centerOf(m); const v = m.kind === 'oxygen' ? (m.running ? '+O₂' : 'IDLE') : m.kind === 'habitat' && m.hp < 0.95 ? 'LEAK' : 'O₂'; this.pip(x * 16, y * 16 - 4, v, m.kind === 'habitat' && m.hp < 0.95 ? C.red : C.cyan); }
  }
  resourceOverlay(st: ColonyState, t: number) {
    for (const d of st.deposits) {
      if (!d.found) continue;
      const pulse = 2 + Math.sin(t * 4) * 1.5;
      this.c.strokeStyle = d.kind === 'vent' ? C.orange : C.green;
      this.c.strokeRect(d.x * 16 - pulse, d.y * 16 - pulse, 32 + pulse * 2, 32 + pulse * 2);
      this.pip(d.x * 16 + 16, d.y * 16 - 2, d.kind === 'vent' ? 'VENT' : d.kind === 'debris' ? 'SALVAGE' : `${d.kind.toUpperCase().slice(0, 4)} ${d.amount}`, d.kind === 'vent' ? C.orange : C.greenL);
    }
  }

  drawSignal(x: number, y: number, label: string, t: number) {
    const c = this.c;
    const r = 6 + ((t * 10) % 14);
    c.globalAlpha = Math.max(0, 1 - r / 20);
    c.strokeStyle = C.cyan; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke();
    c.globalAlpha = 1;
    disc(c, x, y, 5, C.ink); disc(c, x, y, 4, C.cyanDD);
    c.font = '8px Silkscreen, monospace'; c.textAlign = 'center'; c.fillStyle = C.cyanL; c.fillText('?', x, y + 3);
    this.pip(x, y - 8, `${label} SIGNAL`, C.cyan);
  }

  // ---------------------------------------------------------------- shuttle, devils
  drawShuttle(st: ColonyState, t: number) {
    const S = st.shuttle;
    if (S.state === 'away') return;
    const pad = st.modules.find((m) => m.kind === 'pad');
    if (!pad) return;
    const c = this.c;
    const cx = (pad.x + 2) * 16, cy = (pad.y + 2) * 16 + 6;
    const alt = S.state === 'landing' ? (1 - S.t) * (1 - S.t) * 220 : S.state === 'leaving' ? S.t * S.t * 220 : 0;
    const sc = Math.max(0.3, 1 - alt / 260);
    ellipse(c, cx, cy + 10, 18 * sc, 6 * sc, 'rgba(20,6,4,0.45)');
    const flame = S.state !== 'landed' ? 1 + (Math.floor(t * 20) % 3) : 0;
    c.drawImage(shuttleSprite(flame), Math.round(cx - 22), Math.round(cy - 46 - alt));
    if (S.state !== 'landed' && alt < 90) for (let i = 0; i < 4; i++) this.dust(cx + (Math.random() - 0.5) * 50, cy + 6 + Math.random() * 8, 1);
  }
  updateDevils(st: ColonyState, dt: number) {
    if (this.devils.length < 3 && Math.random() < dt * 0.05) {
      const fromLeft = Math.random() < 0.5;
      this.devils.push({ x: fromLeft ? 0 : MAP_W * 16, y: 200 + Math.random() * (MAP_H * 16 - 400), vx: (fromLeft ? 1 : -1) * (18 + Math.random() * 14), vy: (Math.random() - 0.5) * 8, life: 0 });
    }
    for (const d of this.devils) { d.x += d.vx * dt; d.y += d.vy * dt; d.life += dt; }
    this.devils = this.devils.filter((d) => d.x > -40 && d.x < MAP_W * 16 + 40 && d.life < 90);
    void st;
  }
  drawDevil(d: Devil, t: number) {
    const c = this.c;
    for (let k = 0; k < 14; k++) {
      const h = k * 2.2;
      const a = t * 9 + k * 0.9;
      const r = 2 + k * 0.6;
      c.globalAlpha = 0.5 - k * 0.025;
      rect(c, d.x + Math.cos(a) * r, d.y - h + Math.sin(a) * r * 0.35, 2, 2, k % 3 ? C.mars[6] : C.mars[7]);
    }
    c.globalAlpha = 1;
    if (Math.random() < 0.3) this.dust(d.x, d.y, 1);
  }

  // ---------------------------------------------------------------- particles
  updateParticles(dt: number) {
    for (const p of this.particles) { p.life += dt; p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    this.particles = this.particles.filter((p) => p.life < p.max);
    if (this.particles.length > 900) this.particles.splice(0, this.particles.length - 900);
  }

  // ---------------------------------------------------------------- lighting & weather
  lighting(st: ColonyState, t: number, cx: number, cy: number, sc: Scene) {
    const day = sc.title ? 0.15 : daylight(st.minute);
    const storm = stormFactor(st);
    const lc = this.lc;
    if (day >= 0.999 && storm <= 0) return;
    const night = 1 - day;
    lc.globalCompositeOperation = 'source-over';
    const amb = mix(mix('#ffffff', '#3a3060', night), '#b07850', storm * 0.5);
    lc.fillStyle = amb;
    lc.fillRect(0, 0, this.w, this.h);
    lc.globalCompositeOperation = 'lighter';
    const glow = (x: number, y: number, r: number, col: string, a = 1) => {
      const sx = x - cx, sy = y - cy;
      if (sx < -r || sy < -r || sx > this.w + r || sy > this.h + r) return;
      const g = lc.createRadialGradient(sx, sy, 0, sx, sy, r);
      g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
      lc.globalAlpha = a * Math.max(night, storm * 0.7);
      lc.fillStyle = g; lc.fillRect(sx - r, sy - r, r * 2, r * 2);
    };
    for (const m of st.modules) {
      if (m.status !== 'online' && m.kind !== 'pad') continue;
      const spr = moduleSprite(m.kind);
      const ox = m.x * 16 - 1, oy = m.y * 16 - spr.up - 1;
      const lit = m.powered || m.kind === 'pad' || m.kind === 'core';
      if (!lit) continue;
      for (const l of spr.lights) glow(ox + l.x, oy + l.y, l.r * 1.6, l.col, 0.75);
      glow(m.x * 16 + m.w * 8, m.y * 16 + m.h * 16 + 4, 26, '#ffcf8a', 0.35);
    }
    if (sc.overlay === 'core') { for (const [x, y] of this.coreGlow) glow(x, y, 9, '#4dff7a', 0.45); const k = st.modules.find((m) => m.kind === 'core'); if (k) glow(k.x * 16 + k.w * 8, k.y * 16 + k.h * 8, 70, '#4dff7a', 0.7); }
    for (const r of st.robots) {
      if (r.state === 'broken' || r.state === 'dead') continue;
      const dx = r.facing === 'left' ? -1 : r.facing === 'right' ? 1 : 0, dy = r.facing === 'up' ? -1 : r.facing === 'down' ? 1 : 0;
      glow(r.x + dx * 14, r.y - 4 + dy * 12, 18, '#fff4c8', 0.8);
      glow(r.x, r.y - 6, 8, ROBOTS[r.kind].color, 0.6);
    }
    lc.globalAlpha = 1;
    lc.globalCompositeOperation = 'source-over';
    this.c.setTransform(1, 0, 0, 1, 0, 0);
    this.c.globalCompositeOperation = 'multiply';
    this.c.drawImage(this.light, 0, 0);
    this.c.globalCompositeOperation = 'source-over';
    this.c.translate(-cx, -cy);
    void t;
  }
  stormLayer(s: number, t: number, dt: number) {
    const c = this.c;
    c.globalAlpha = 0.22 + s * 0.28;
    rect(c, 0, 0, this.w, this.h, '#d0703a');
    c.globalAlpha = 1;
    for (const k of this.streaks) {
      k.x -= (160 + k.s * 120) * dt; k.y += (40 + k.s * 30) * dt;
      if (k.x < -20) { k.x = this.w + Math.random() * 60; k.y = Math.random() * this.h - 40; }
      if (k.y > this.h) k.y = -10;
      c.globalAlpha = 0.25 + k.s * 0.3;
      rect(c, k.x, k.y, 6 + k.s * 6, 1, C.mars[7]);
    }
    c.globalAlpha = 0.25 * s;
    const g = c.createRadialGradient(this.w / 2, this.h / 2, this.h * 0.3, this.w / 2, this.h / 2, this.h * 0.9);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, '#5a2410');
    c.fillStyle = g; c.fillRect(0, 0, this.w, this.h);
    c.globalAlpha = 1;
    void t;
  }
}

function outsideBase(r: Robot) { return Math.hypot(r.x / 16 - 46, r.y / 16 - 33) > 12; }
export type { Light };
