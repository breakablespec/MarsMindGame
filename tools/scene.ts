// Dev-only bundle: the real game + helpers to stage marketing shots (header, promo frames).
import '../src/main';
import { newColony } from '../src/sim/init';
import { simulate } from '../src/sim/tick';
import { coreMinute, setAutonomy } from '../src/ai/autonomy';
import { plan } from '../src/ai/planner';
import { parse } from '../src/ai/parser';
import { findSites, bumpGrid } from '../src/sim/grid';
import { newModule, activate, placeConstruction } from '../src/sim/construction';
import { makeRobot } from '../src/sim/production';
import { newColonist } from '../src/sim/colony';
import { stores } from '../src/sim/storage';
import { BASE_CX, BASE_CY, reveal } from '../src/sim/world';
import type { ModuleKind, RobotKind, Role } from '../src/sim/defs';
import type { Game } from '../src/engine/game';
import * as A from '../src/ai/actions';
import { robotSprite } from '../src/render/units';
import { moduleSprite } from '../src/render/modules';
import type { Deposit } from '../src/sim/state';

function stage(opts: { minute: number; seed?: number }) {
  const g = (window as unknown as { __game: Game }).__game;
  const st = newColony(opts.seed ?? 7);
  g.startColony(st, false);
  st.briefing = { step: 99, done: true, offered: true };
  g.brief.hide();
  setAutonomy(st, 'autonomous');
  for (let i = 0; i < 4; i++) reveal(st, BASE_CX + (i % 2 ? 14 : -14), BASE_CY + (i < 2 ? -8 : 8), 14);
  reveal(st, BASE_CX, BASE_CY, 26);
  // a grown base: modules placed online around the core
  const add = (kind: ModuleKind, near: [number, number]) => {
    const o = findSites(st, kind, near, 1, 20)[0];
    if (!o) return;
    const m = newModule(st, kind, o.x, o.y, 'online');
    st.modules.push(m); bumpGrid(); activate(st, m);
  };
  const B: [number, number] = [BASE_CX, BASE_CY];
  for (const [k, n] of [['solar', [BASE_CX - 2, BASE_CY - 9]], ['solar', [BASE_CX + 6, BASE_CY - 8]], ['battery', [BASE_CX + 10, BASE_CY - 6]], ['oxygen', [BASE_CX - 8, BASE_CY + 4]], ['habitat', [BASE_CX - 10, BASE_CY - 2]],
    ['lab', [BASE_CX + 12, BASE_CY + 2]], ['robotbay', [BASE_CX + 4, BASE_CY + 8]], ['storage', [BASE_CX + 12, BASE_CY + 7]], ['greenhouse', [BASE_CX - 14, BASE_CY + 6]], ['medical', [BASE_CX - 4, BASE_CY + 8]]] as [ModuleKind, [number, number]][]) add(k, n);
  void B;
  // fleet + crew
  const bay = st.modules.find((m) => m.kind === 'robotbay') ?? st.modules[0];
  const kinds: RobotKind[] = ['hauler', 'hauler', 'hauler', 'builder', 'builder', 'miner', 'miner', 'scout', 'scout', 'repair', 'maint'];
  for (const [i, k] of kinds.entries()) st.robots.push(makeRobot(st, k, bay.x + (i % 4), bay.y + bay.h + 1 + Math.floor(i / 4)));
  const roles: Role[] = ['engineer', 'miner', 'scientist', 'technician', 'medic', 'engineer'];
  for (const r of roles) { const c = newColonist(st, r); c.x = (BASE_CX + Math.floor(Math.random() * 6) - 3) * 16; c.y = (BASE_CY + 3) * 16; st.colonists.push(c); }
  // plenty of stock so every order runs
  const s0 = stores(st)[0];
  for (const [r, q] of Object.entries({ iron: 140, titanium: 140, silica: 80, electronics: 60, polymer: 60, regolith: 40, ice: 40 })) s0.store[r as 'iron'] = (s0.store[r as 'iron'] ?? 0) + q;
  st.research.done.push('solar_eff' as never);
  st.minute = opts.minute;
  // live orders: construction, mining, scouting
  for (const text of ['Build a comm tower', 'Build 2 solar arrays', 'Send drones for titanium', 'Mine ice', 'Scout east for rare minerals']) {
    const p = plan(st, parse(text).commands[0]);
    if (p.ok && p.exec) p.exec(st, 'PLAYER', text);
  }
  // clear skies for the shot
  st.weather.storm = null; st.weather.nextStorm = st.minute + 1440 * 3; st.weather.solarStorm = null; st.weather.meteor = null;
  // every miner on a different deposit, near enough to be in frame
  const miners = st.robots.filter((r) => r.kind === 'miner');
  const deps = (['iron', 'regolith', 'ice', 'titanium'] as const).map((res) => A.nearestDeposit(st, res)).filter(Boolean) as Deposit[];
  miners.forEach((r, i) => { const d = deps[i % deps.length]; if (d) A.mineTask(st, d, 60, [r], 'PLAYER', 'mine'); });
  // a construction site in the middle of the shot
  for (const [k, near] of [['battery', [BASE_CX - 1, BASE_CY + 6]], ['storage', [BASE_CX + 7, BASE_CY + 5]]] as [ModuleKind, [number, number]][]) {
    const o = findSites(st, k, near, 1, 8)[0]; if (o) placeConstruction(st, k, o.x, o.y, { source: 'PLAYER', command: 'build' });
  }
  simulate(st, 2, { onMinute: coreMinute });
  return st;
}

/** PNG data URL of a sprite scaled up with crisp pixels. */
function spritePng(kind: string, robot: boolean, scale: number) {
  const src = robot ? robotSprite(kind as never, 'down', 0) : moduleSprite(kind as never).cv;
  const c = document.createElement('canvas'); c.width = src.width * scale; c.height = src.height * scale;
  const x = c.getContext('2d')!; x.imageSmoothingEnabled = false; x.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}
(window as unknown as { __dev: unknown }).__dev = { stage, simulate, coreMinute, plan, parse, spritePng };
