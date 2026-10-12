// CORE command centre: ASK · TASKS · ROBOTS · POWER · OXYGEN · RESOURCES · BUILD · RESEARCH · MEMORY

import { BRANCHES, BUILD_MENU, CAT_NAME, DEPOSIT, MODULES, POWER_CATS, PowerCat, RECIPES, RES, RES_IDS, ResId, ROBOTS, ROBOT_KINDS, ROLE_INFO, STAGE_INFO, TECH, TECHS, TUNE, techPrereq, stageIndex } from '../sim/defs';
import { clock, has, mods, scaledCost, sol } from '../sim/core';
import { batteryCap, demands, forecastSol, genOf, o2Cap, waterCap } from '../sim/power';
import { alive, beds, lifeRates, o2ReserveHours } from '../sim/life';
import { available, capOf, stores, totals, usedOf } from '../sim/storage';
import { cancelTask, liveTasks, assignedRobots } from '../sim/tasks';
import { canResearch, rpPerMinute } from '../sim/research';
import { colonyScores, nextStage, stageProgress } from '../sim/colony';
import type { Autonomy, Perm } from '../sim/state';
import type { Game } from '../engine/game';
import { aiScores, coreVersion } from '../ai/perf';
import { prefLines } from '../ai/learning';
import { suggestResearch } from '../ai/planner';
import { llmLabTalk, aiStatus } from '../ai/llm';
import { BASE_CX, BASE_CY, directionOf, exploredPct } from '../sim/world';
import { h, img } from './dom';
import { moduleUrl, resUrl, robotUrl } from './icons';

export type CoreTab = 'ask' | 'tasks' | 'robots' | 'power' | 'oxygen' | 'resources' | 'build' | 'research' | 'memory';
const TABS: CoreTab[] = ['ask', 'tasks', 'robots', 'power', 'oxygen', 'resources', 'build', 'research', 'memory'];
const btn = (label: string, cls: string, on: () => void, disabled = false) => h('button', { class: `btn small ${cls}`, type: 'button', onclick: on, disabled }, label);
const bar = (f: number, cls = '') => h('div', { class: `bar ${cls}` }, h('i', { style: `width:${Math.round(Math.max(0, Math.min(1, f)) * 100)}%` }));
const costChips = (g: Game, cost: Partial<Record<ResId, number>>) => h('div', { class: 'costs row' }, Object.entries(cost).filter(([, q]) => q).map(([r, q]) => { const have = available(g.st, r as ResId); return h('span', { class: `cost ${have < (q ?? 0) ? 'short' : ''}` }, img(resUrl(r as ResId), 'ico sm'), String(q)); }));
let labLog: { who: 'you' | 'core'; text: string; techs?: string[]; label?: string }[] = [];

export function buildCore(g: Game, tab: CoreTab): { title: string; body: HTMLElement } {
  const tabs = h('div', { class: 'tabs' }, TABS.map((t) => h('button', { class: `tab ${t === tab ? 'on' : ''}`, type: 'button', onclick: () => g.wins.setTab(t) }, t.toUpperCase())));
  const content = tab === 'ask' ? askTab(g) : tab === 'tasks' ? tasksTab(g) : tab === 'robots' ? robotsTab(g) : tab === 'power' ? powerTab(g) : tab === 'oxygen' ? oxygenTab(g) : tab === 'resources' ? resourcesTab(g) : tab === 'build' ? buildTab(g) : tab === 'research' ? researchTab(g) : memoryTab(g);
  return { title: `CORE · ${coreVersion(g.st).text} · ${g.st.core.autonomy.toUpperCase()}`, body: h('div', null, tabs, content) };
}

// ------------------------------------------------------------------ ASK
function askTab(g: Game) {
  const input = h('input', { type: 'text', placeholder: 'ASK CORE ANYTHING', maxlength: '220' }) as HTMLInputElement;
  const go = () => { const v = input.value.trim(); if (!v) return; g.wins.close(); void g.ask(v); };
  input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') go(); if (e.key === 'Escape') g.wins.close(); });
  setTimeout(() => input.focus(), 30);
  const ex = ['Build another generator', 'Mine titanium', 'Fix oxygen', 'Expand power', 'Prepare for storm', 'What should we do next?', 'Make power safer', 'Expand storage', 'Mine more titanium', 'Reduce oxygen risk', 'Scout east for titanium', 'Build a robot bay', 'Research reactor technology', 'Do whatever is most urgent'];
  const hist = g.st.core.memory.filter((m) => m.kind === 'command').slice(0, 10);
  return h('div', { class: 'list' },
    h('div', { class: 'row' }, h('div', { class: 'grow' }, input), btn('SEND', 'green', go)),
    h('div', { class: 'examples', style: 'padding:0;background:none' }, ex.map((e) => h('button', { class: 'ex', type: 'button', onclick: () => { g.wins.close(); void g.ask(e); } }, e))),
    h('h3', null, 'Recent commands'),
    hist.length ? h('div', { class: 'list' }, hist.map((m) => h('div', { class: 'line' }, h('span', { class: 'chip' }, `SOL ${m.sol} ${clock(m.minute)}`), h('span', { class: 'grow' }, m.text), h('span', { class: `chip ${m.ok ? 'ai' : 'bad'}` }, m.ok ? 'DONE' : 'FAILED')))) : h('div', { class: 'muted' }, 'No commands yet.'));
}

// ------------------------------------------------------------------ TASKS (+ autonomy, standing orders)
function tasksTab(g: Game) {
  const st = g.st;
  const live = liveTasks(st);
  const lvls: Autonomy[] = ['manual', 'assisted', 'automated', 'autonomous'];
  const desc: Record<Autonomy, string> = { manual: 'CORE suggests only. Every command shows a plan first.', assisted: 'Runs your commands and standing orders. Big plans ask first.', automated: '+ routine work: cleaning, repairs, production stock, wider mining.', autonomous: '+ emergency response and expansion within permissions.' };
  const perms: Perm[] = ['mine', 'build', 'repair', 'trade', 'power', 'research', 'expand'];
  const permName: Record<Perm, string> = { mine: 'MINE', build: 'BUILD', repair: 'REPAIR', trade: 'TRADE', power: 'ALLOCATE POWER', research: 'RESEARCH', expand: 'EXPAND' };
  return h('div', { class: 'two' },
    h('div', null,
      h('h3', null, `Task queue · ${live.length}`),
      live.length ? h('div', { class: 'list' }, live.map((t) => {
        const who = assignedRobots(st, t).map((r) => r.name);
        return h('div', { class: 'line', style: 'display:grid;gap:3px' },
          h('div', { class: 'row' }, h('span', { class: 'chip core' }, `#${t.id}`), h('b', { class: 'grow' }, t.title.toUpperCase()), h('span', { class: 'chip' }, t.source), btn('×', '', () => { cancelTask(st, t, 'Cancelled by commander'); g.wins.render(); })),
          h('div', { class: 'row small' }, h('span', { class: 'grow' }, `STATUS: ${t.label}`), `${Math.round(t.progress * 100)}%`), bar(t.progress),
          h('div', { class: 'muted small' }, who.length ? `Assigned: ${who.join(', ')}` : t.after.length ? `After task #${t.after.join(', #')}` : 'Waiting for a robot'));
      })) : h('div', { class: 'muted' }, 'Nothing queued.'),
      h('h3', null, 'Standing orders'),
      h('div', { class: 'list' }, st.rules.map((r) => h('div', { class: 'line' }, h('button', { class: `toggle ${r.enabled ? 'on' : ''}`, type: 'button', onclick: () => { r.enabled = !r.enabled; g.wins.render(); } }, r.enabled ? 'ON' : 'OFF'), h('span', { class: 'grow' }, r.text), h('span', { class: 'chip' }, r.source), btn('DELETE', '', () => { st.rules = st.rules.filter((q) => q.id !== r.id); if (r.kind === 'reserve') st.power.reserve = 0; g.wins.render(); })))),
null),
    h('div', null,
      h('h3', null, 'Autonomy'),
      h('div', { class: 'list' }, lvls.map((l) => h('button', { class: `line ${st.core.autonomy === l ? '' : ''}`, type: 'button', style: `text-align:left;${st.core.autonomy === l ? 'background:var(--ink);color:var(--green)' : ''}`, onclick: () => { g.setAutonomy(l); g.wins.render(); } }, h('b', { class: 'lt', style: 'min-width:110px' }, l.toUpperCase()), h('span', { class: 'small' }, desc[l])))),
      h('h3', null, 'Permissions'),
      h('div', { class: 'row' }, perms.map((p) => h('button', { class: `toggle ${st.core.perms[p] ? 'on' : ''}`, type: 'button', onclick: () => { st.core.perms[p] = !st.core.perms[p]; g.wins.render(); } }, permName[p]))),
null));
}

// ------------------------------------------------------------------ ROBOTS
function robotsTab(g: Game) {
  const st = g.st;
  const bay = st.modules.some((m) => m.kind === 'robotbay' && m.status === 'online');
  return h('div', null,
    h('h3', null, `Fleet · ${st.robots.length} robots`),
    h('div', { class: 'list' }, st.robots.map((r) => {
      const job = st.jobs.find((j) => j.id === r.jobId);
      return h('div', { class: 'line' }, img(robotUrl(r.kind), 'ico lg'),
        h('div', { class: 'grow', style: 'display:grid;gap:2px' }, h('div', { class: 'row' }, h('b', { class: 'lt' }, r.name), h('span', { class: 'chip' }, r.state.toUpperCase()), job ? h('span', { class: 'small muted' }, `task #${job.taskId}`) : null), h('div', { class: 'small' }, r.phase),
          h('div', { class: 'row small' }, 'BAT', h('div', { style: 'width:80px' }, bar(r.battery / 100, r.battery < 25 ? 'red' : 'yellow')), 'COND', h('div', { style: 'width:80px' }, bar(r.condition / 100, r.condition < 35 ? 'red' : 'ti')), r.cargo ? `${r.cargo.qty} ${RES[r.cargo.res].short}` : '')),
        btn('FOLLOW', '', () => { g.wins.close(); g.followRobot(r.id); }), !ROBOTS[r.kind].flying ? btn('DRIVE', 'orange', () => { g.wins.close(); g.startDrive(r.id); }) : null);
    })),
    h('h3', null, 'Build robots'),
    bay ? null : h('div', { class: 'muted' }, 'Build a ROBOT BAY to make robots.'),
    h('div', { class: 'cards' }, ROBOT_KINDS.map((k) => {
      const d = ROBOTS[k];
      const locked = !bay || (d.tech && !has(st, d.tech));
      return h('div', { class: `card ${locked ? 'locked' : ''}` }, h('div', { class: 'ct' }, img(robotUrl(k), 'ico lg'), d.name.toUpperCase()), h('div', { class: 'small' }, d.desc), h('div', { class: 'small muted' }, `${d.speed} tiles/s · cargo ${d.cargo}${d.flying ? ' · flies' : ''}`), costChips(g, d.cost),
        btn(d.tech && !has(st, d.tech) ? `NEEDS ${TECH[d.tech].name.toUpperCase()}` : 'BUILD', 'orange', () => { g.wins.close(); void g.handleCommand({ intent: 'build_robot', robot: k, count: 1 }, `Build a ${d.name.toLowerCase()}`, 'PARSED'); g.cmd.show(); }, !!locked));
    })));
}

// ------------------------------------------------------------------ POWER
function powerTab(g: Game) {
  const st = g.st;
  const P = st.power;
  const ds = demands(st);
  const fc = forecastSol(st);
  const byCat = new Map<PowerCat, number>();
  for (const d of ds) byCat.set(d.cat, (byCat.get(d.cat) ?? 0) + d.kw);
  const gens = st.modules.filter((m) => m.status === 'online' && MODULES[m.kind].gen);
  const cap = batteryCap(st);
  const move = (c: PowerCat, dir: -1 | 1) => { const i = P.order.indexOf(c); const j = i + dir; if (j < 0 || j >= P.order.length) return; [P.order[i], P.order[j]] = [P.order[j], P.order[i]]; g.wins.render(); };
  return h('div', { class: 'two' },
    h('div', null,
      h('div', { class: 'cards', style: 'grid-template-columns:repeat(2,1fr)' },
        h('div', { class: 'card' }, h('b', { class: 'lt' }, 'GENERATED'), h('span', { class: 'big-num' }, `${P.gen.toFixed(1)} kW`)),
        h('div', { class: 'card' }, h('b', { class: 'lt' }, 'USED'), h('span', { class: 'big-num' }, `${P.used.toFixed(1)} kW`)),
        h('div', { class: 'card' }, h('b', { class: 'lt' }, 'BATTERY'), h('span', { class: 'big-num' }, `${Math.round(P.battery)} / ${cap}`), bar(cap ? P.battery / cap : 0, 'yellow')),
        h('div', { class: 'card' }, h('b', { class: 'lt' }, 'PEAK LOAD (SOL)'), h('span', { class: 'big-num' }, `${st.sol.peak.toFixed(1)} kW`))),
      h('div', { class: 'fc' }, h('div', { class: `fcx ${fc.genKwh - fc.useKwh >= 0 ? 'ok' : 'bad'}` }, h('b', null, 'TOMORROW'), `${fc.genKwh - fc.useKwh >= 0 ? '+' : '−'}${Math.abs(Math.round(fc.genKwh - fc.useKwh))} kWh`), h('div', { class: `fcx ${fc.batteryAtDawn >= 5 ? 'ok' : 'bad'}` }, h('b', null, 'TONIGHT'), fc.batteryAtDawn >= 5 ? 'Battery OK' : 'Battery runs out')),
      h('h3', null, 'Sources'),
      h('div', { class: 'list' }, gens.map((m) => h('div', { class: 'line' }, img(moduleUrl(m.kind), 'ico lg'), h('b', { class: 'grow lt' }, m.name), m.kind === 'solar' ? h('span', { class: 'small muted' }, `dust ${Math.round(m.dust * 100)}%`) : null, `${genOf(st, m).toFixed(1)} kW`))),
      h('div', { class: 'row', style: 'margin-top:8px' }, btn('CLEAN PANELS', '', () => { g.wins.close(); void g.ask('Clean the solar panels'); }), btn('FIX POWER', 'yellow', () => { g.wins.close(); void g.ask('Fix the power problem'); }), btn('OPTIMIZE', '', () => { g.wins.close(); void g.ask('Reduce power use'); }))),
    h('div', null,
      h('h3', null, 'Power priority (top = protected)'),
      h('div', { class: 'prio' }, P.order.map((c, i) => h('div', { class: `p ${P.shed.includes(c) ? 'shed' : ''}` }, h('span', null, String(i + 1)),
        h('span', null, CAT_NAME[c], h('span', { class: 'muted' }, ` ${(byCat.get(c) ?? 0).toFixed(1)} kW`), P.shed.includes(c) ? h('span', { class: 'chip bad' }, 'PAUSED') : null, P.nightOff.includes(c) ? h('span', { class: 'chip' }, 'DAY ONLY') : null),
        h('span', { class: 'seg3' }, (['on', 'auto', 'off'] as const).map((mo) => h('button', { type: 'button', class: P.mode[c] === mo ? 'on' : '', onclick: () => { if (c === 'life' && mo === 'off') { g.toast('Life support can\'t be switched off', 'bad'); return; } P.mode[c] = mo; g.wins.render(); } }, mo.toUpperCase()))),
        h('span', null, h('button', { class: 'btn small', type: 'button', onclick: () => move(c, -1) }, '▲'), h('button', { class: 'btn small', type: 'button', onclick: () => move(c, 1) }, '▼'))))),
      P.hold ? h('div', { class: 'term', style: 'margin-top:8px' }, `HOLD: ${P.hold.cats.map((c) => CAT_NAME[c]).join(', ')} paused${P.hold.untilO2 ? ` until O₂ > ${P.hold.untilO2}%` : ''}${P.hold.untilMinute ? ` until ${clock(P.hold.untilMinute)}` : ''}`, h('br'), h('button', { class: 'btn small', type: 'button', onclick: () => { P.hold = null; g.wins.render(); } }, 'LIFT HOLD')) : null,
      null,
      P.reserve ? h('div', { class: 'chip warn', style: 'margin-top:6px' }, `Reserve ${Math.round(P.reserve * 100)}% for life support`) : null));
}

// ------------------------------------------------------------------ OXYGEN
function oxygenTab(g: Game) {
  const st = g.st;
  const cap = o2Cap(st), wcap = waterCap(st);
  const r = lifeRates();
  const res = o2ReserveHours(st);
  const gens = st.modules.filter((m) => m.kind === 'oxygen' && m.status !== 'site' && m.status !== 'building');
  return h('div', { class: 'two' },
    h('div', null,
      h('div', { class: 'cards', style: 'grid-template-columns:repeat(2,1fr)' },
        h('div', { class: 'card' }, h('b', { class: 'lt' }, 'OXYGEN STORAGE'), h('span', { class: 'big-num' }, `${Math.round(st.o2)} / ${cap}`), bar(cap ? st.o2 / cap : 0, 'cyan')),
        h('div', { class: 'card' }, h('b', { class: 'lt' }, 'RESERVE'), h('span', { class: 'big-num' }, Number.isFinite(res) ? `${res.toFixed(1)} h` : 'STABLE')),
        h('div', { class: 'card' }, h('b', { class: 'lt' }, 'PRODUCTION'), h('span', { class: 'big-num' }, `+${r.o2Prod.toFixed(1)}/h`)),
        h('div', { class: 'card' }, h('b', { class: 'lt' }, 'CONSUMPTION'), h('span', { class: 'big-num' }, `−${(r.o2Use + r.leak).toFixed(1)}/h`), r.leak ? h('span', { class: 'chip bad' }, `LEAKS −${r.leak.toFixed(1)}/h`) : null),
        h('div', { class: 'card' }, h('b', { class: 'lt' }, 'WATER'), h('span', { class: 'big-num' }, `${Math.round(st.water)} / ${wcap}`), bar(wcap ? st.water / wcap : 0, 'ti')),
        h('div', { class: 'card' }, h('b', { class: 'lt' }, 'RATIONS'), h('span', { class: 'big-num' }, String(st.rations)), h('span', { class: 'small muted' }, `${alive(st).length}/sol eaten`))),
      h('h3', null, 'Oxygen generators'),
      h('div', { class: 'list' }, gens.map((m) => h('div', { class: 'line' }, img(moduleUrl('oxygen'), 'ico lg'), h('b', { class: 'grow lt' }, m.name), h('span', { class: 'small' }, `ICE ${m.hopper.toFixed(0)}/${TUNE.hopperCap}`), h('span', { class: `chip ${m.running ? 'ai' : 'warn'}` }, m.running ? 'PRODUCING' : m.powered ? 'IDLE' : 'UNPOWERED')))),
      h('div', { class: 'row', style: 'margin-top:8px' }, btn('PRIORITIZE OXYGEN', 'cyan', () => { g.wins.close(); void g.ask('Prioritize oxygen'); }), btn('FIX OXYGEN', 'yellow', () => { g.wins.close(); void g.ask('Fix the oxygen problem'); }), btn('BUILD GENERATOR', '', () => { g.wins.close(); void g.ask('Build another oxygen generator'); }))),
    h('div', null,
      h('h3', null, `Colonists · ${alive(st).length} / ${beds(st)} beds`),
      h('div', { class: 'list' }, st.colonists.map((c) => h('div', { class: `line ${c.dead ? 'done' : ''}` }, h('span', { class: 'chip', style: `background:${ROLE_INFO[c.role].color}` }, ROLE_INFO[c.role].name), h('b', { class: 'grow lt' }, c.name), c.dead ? 'LOST' : h('div', { style: 'width:110px' }, bar(c.health / 100, c.health < 50 ? 'red' : '')), h('span', { class: 'small muted' }, c.dead ? '' : c.inside !== null ? (st.modules.find((m) => m.id === c.inside)?.name ?? 'inside') : 'outside')))),
null));
}

// ------------------------------------------------------------------ RESOURCES
function resourcesTab(g: Game) {
  const st = g.st;
  const T = totals(st);
  const shops = st.modules.some((m) => m.kind === 'workshop' && m.status === 'online');
  const deps = st.deposits.filter((d) => d.found && (d.amount > 0 || d.kind === 'vent')).sort((a, b) => Math.hypot(a.x - BASE_CX, a.y - BASE_CY) - Math.hypot(b.x - BASE_CX, b.y - BASE_CY));
  return h('div', { class: 'two' },
    h('div', null,
      h('h3', null, 'Stock'),
      h('div', { class: 'list' }, RES_IDS.map((r) => h('div', { class: 'line' }, img(resUrl(r), 'ico'), h('b', { class: 'lt', style: 'width:110px' }, RES[r].name.toUpperCase()), h('div', { class: 'grow' }, bar(T[r] / Math.max(1, RES[r].target * 2), T[r] < RES[r].target * 0.5 ? 'red' : 'orange')), h('span', { style: 'width:60px;text-align:right' }, `${T[r]}`), h('span', { class: 'small muted', style: 'width:70px' }, `target ${RES[r].target}`),
        RECIPES[r] ? btn('MAKE', '', () => { g.wins.close(); void g.handleCommand({ intent: 'produce', resource: r, qty: 10 }, `Produce 10 ${r}`, 'PARSED'); g.cmd.show(); }, !shops) : btn('MINE', '', () => { g.wins.close(); g.cmd.show(); void g.handleCommand({ intent: 'mine', resource: r }, `Mine ${r}`, 'PARSED'); })))),
      h('h3', null, 'Storage modules'),
      h('div', { class: 'list' }, stores(st).map((m) => h('div', { class: 'line' }, img(moduleUrl(m.kind), 'ico lg'), h('b', { class: 'lt', style: 'width:100px' }, m.name), h('div', { class: 'grow' }, bar(usedOf(m) / Math.max(1, capOf(m)), usedOf(m) / capOf(m) > 0.95 ? 'red' : 'ti')), `${usedOf(m)}/${capOf(m)}`)))),
    h('div', null,
      h('h3', null, 'Workshop queue'),
      st.production.length ? h('div', { class: 'list' }, st.production.map((o) => h('div', { class: 'line' }, img(resUrl(o.res), 'ico'), h('span', { class: 'grow' }, `${RES[o.res].name}: ${o.done}/${o.qty}`), st.modules.some((m) => m.fab && m.fab.kind === 'res' && m.fab.orderId === o.id) ? h('span', { class: 'chip ai' }, 'RUNNING') : h('span', { class: 'chip' }, 'QUEUED')))) : h('div', { class: 'muted' }, shops ? 'Workshop idle.' : 'No workshop.'),
      h('div', { class: 'muted small' }, Object.values(RECIPES).map((rc) => `${rc!.outQty} ${RES[rc!.out].name} ← ${Object.entries(rc!.inputs).map(([k, v]) => `${v} ${RES[k as ResId].name}`).join(' + ')} (${rc!.minutes} min)`).join(' · ')),
      h('h3', null, `Known deposits · ${Math.round(exploredPct(st) * 100)}% charted`),
      h('div', { class: 'list' }, deps.map((d) => h('div', { class: 'line' }, DEPOSIT[d.kind].res ? img(resUrl(DEPOSIT[d.kind].res!), 'ico') : null, h('span', { class: 'grow' }, `${DEPOSIT[d.kind].name} · ${Math.round(Math.hypot(d.x - BASE_CX, d.y - BASE_CY))} tiles ${directionOf(d.x, d.y)}`), d.kind === 'vent' ? h('span', { class: 'chip' }, 'VENT') : `${d.amount}`, btn('SHOW', '', () => { g.wins.close(); g.focusTile(d.x + 1, d.y + 1); g.select({ kind: 'deposit', id: d.id }); })))),
      st.deposits.some((d) => d.signal && !d.found) ? h('div', { class: 'term', style: 'margin-top:6px' }, '? on the map = unconfirmed signal. Send a scout.') : null));
}

// ------------------------------------------------------------------ BUILD
function buildTab(g: Game) {
  const st = g.st;
  return h('div', null,

    h('div', { class: 'cards' }, BUILD_MENU.map((k) => {
      const d = MODULES[k];
      const lockTech = d.tech && !has(st, d.tech);
      const lockStage = d.stage && stageIndex(st.stage) < stageIndex(d.stage);
      const locked = lockTech || lockStage;
      const cost = scaledCost(st, d.cost) as Partial<Record<ResId, number>>;
      return h('div', { class: `card ${locked ? 'locked' : ''}` },
        h('div', { class: 'ct' }, img(moduleUrl(k), 'ico xl'), h('span', null, d.name.toUpperCase(), h('div', { class: 'small muted' }, `${d.w}×${d.h} · ${d.gen ? `+${k === 'solar' ? TUNE.solarPeak : d.gen} kW` : d.draw ? `−${d.draw} kW` : 'no power'}`))),
        h('div', { class: 'small' }, d.desc), costChips(g, cost),
        locked ? h('div', { class: 'chip warn' }, lockTech ? `RESEARCH ${TECH[d.tech!].name.toUpperCase()}` : `STAGE ${d.stage!.toUpperCase()}`) :
          h('div', { class: 'row' }, btn('PLACE', 'orange', () => g.startPlacing(k)), btn('ASK CORE', 'green', () => { g.wins.close(); g.cmd.show(); void g.ask(`Build a ${d.name.toLowerCase()}`); })));
    })));
}

// ------------------------------------------------------------------ RESEARCH
function researchTab(g: Game) {
  const st = g.st;
  const R = st.research;
  const lab = st.modules.some((m) => m.kind === 'lab' && m.status === 'online');
  const cur = R.current ? TECH[R.current] : null;
  const input = h('input', { type: 'text', placeholder: 'e.g. "How do we survive longer dust storms?"', maxlength: '200' }) as HTMLInputElement;
  const send = async () => {
    const q = input.value.trim(); if (!q) return;
    input.value = '';
    labLog.push({ who: 'you', text: q });
    g.wins.render();
    let ids: string[] = [], reply = '', label = 'CORE MODEL';
    if (aiStatus() === 'ready') { const r = await llmLabTalk(st, q); if ('techIds' in r) { ids = r.techIds; reply = r.reply; label = 'AI PLAN'; } }
    if (!ids.length) { ids = suggestResearch(st, q); reply = ids.length ? 'From the research tree, these would help most:' : 'Everything relevant is already researched.'; }
    labLog.push({ who: 'core', text: reply, techs: ids, label });
    labLog = labLog.slice(-8);
    g.wins.render();
  };
  input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') void send(); });
  return h('div', null,
    !lab ? h('div', { class: 'term' }, 'No SPACE LAB yet. Build one to start research.', h('br'), h('button', { class: 'btn small green', type: 'button', onclick: () => { g.wins.close(); g.cmd.show(); void g.ask('Build a space lab'); } }, 'ASK CORE TO BUILD A LAB')) : null,
    cur ? h('div', { class: 'line', style: 'display:grid;gap:4px' }, h('div', { class: 'row' }, h('span', { class: 'chip warn' }, 'EXPERIMENT'), h('b', { class: 'grow' }, cur.name.toUpperCase()), `${Math.floor(R.rp)} / ${cur.rp} RP`), bar(R.delivered ? R.rp / cur.rp : 0, 'cyan'), h('div', { class: 'small muted' }, R.delivered ? `${rpPerMinute(st).toFixed(1)} RP/min · result: ${cur.effect}` : 'Waiting for materials to reach the lab')) : null,
    R.queue.length ? h('div', { class: 'small' }, `Queued: ${R.queue.map((t) => TECH[t].name).join(', ')}`) : null,
    h('h3', null, `Research tree · ${R.done.length}/${TECHS.length}`),
    h('div', { class: 'tree' }, BRANCHES.map((b) => h('div', { class: 'branch' }, h('div', { class: 'bh', style: `background:${b.color}` }, b.name),
      TECHS.filter((t) => t.branch === b.id).map((t) => {
        const done = R.done.includes(t.id), cur2 = R.current === t.id;
        const chk = canResearch(st, t.id);
        const pre = techPrereq(t);
        return h('button', { class: `tech ${done ? 'done' : cur2 ? 'cur' : !chk.ok ? 'locked' : ''}`, type: 'button', title: chk.why ?? '', onclick: () => { if (done || !lab) return; g.wins.close(); g.cmd.show(); void g.handleCommand({ intent: 'research', tech: t.id }, `Research ${t.name}`, 'PARSED'); } },
          h('b', null, `T${t.tier} ${t.name}`), h('span', null, t.effect), h('span', { class: 'muted' }, done ? '✓ DONE' : `${t.rp} RP · ${Object.entries(t.cost).map(([k, v]) => `${v} ${RES[k as ResId].short}`).join(' ')}`), pre && !has(st, pre) ? h('span', { class: 'muted' }, `needs ${TECH[pre].name}`) : null);
      })))),
    h('h3', null, 'Talk to CORE about research'),
    h('div', { class: 'list' }, labLog.map((m) => m.who === 'you' ? h('div', { class: 'line' }, h('b', { class: 'lt' }, 'YOU'), m.text) : h('div', { class: 'term' }, h('span', { class: `chip ${m.label === 'AI PLAN' ? 'ai' : 'model'}` }, m.label ?? 'CORE MODEL'), ' ', m.text, ...(m.techs ?? []).map((id) => { const t = TECH[id as keyof typeof TECH]; return t ? h('div', { class: 'row', style: 'margin-top:4px' }, h('span', { class: 'grow' }, `▶ ${t.name}: ${t.effect} · ${t.rp} RP`), h('button', { class: 'btn small green', type: 'button', onclick: () => { g.wins.close(); g.cmd.show(); void g.handleCommand({ intent: 'research', tech: t.id }, `Research ${t.name}`, 'CORE MODEL'); } }, 'QUEUE')) : null; })))),
    h('div', { class: 'row', style: 'margin-top:6px' }, h('div', { class: 'grow' }, input), btn('ASK', 'green', () => void send())),
    h('div', { class: 'examples', style: 'padding:6px 0 0;background:none' }, ['What should we research next?', 'How do we survive longer dust storms?', 'How can we reduce power use?', 'Find a faster titanium extraction method'].map((e) => h('button', { class: 'ex', type: 'button', onclick: () => { input.value = e; void send(); } }, e))));
}

// ------------------------------------------------------------------ MEMORY (history, scores, prefs)
function memoryTab(g: Game) {
  const st = g.st;
  const cs = colonyScores(st);
  const ai = aiScores(st);
  const v = coreVersion(st);
  const n = nextStage(st);
  const sb = (label: string, val: number) => h('div', { class: 'r' }, label, bar(val / 100, val < 40 ? 'red' : val < 70 ? 'yellow' : ''), String(val));
  return h('div', { class: 'two' },
    h('div', null,
      h('div', { class: 'row' }, h('div', null, h('b', { class: 'lt' }, 'COLONY SCORE'), h('div', { class: 'big-num' }, String(cs.overall))), h('div', { class: 'grow' }), btn('PLAYER CARD', 'green', () => g.wins.open('profile'))),
      h('div', { class: 'scorebars', style: 'margin-top:6px' }, sb('SURVIVAL', cs.survival), sb('EFFICIENCY', cs.efficiency), sb('ENERGY', cs.energy), sb('OXYGEN', cs.oxygen), sb('RESEARCH', cs.research), sb('AUTOMATION', cs.automation), sb('EXPANSION', cs.expansion)),
      h('h3', null, `${v.text} · performance`),
      h('div', { class: 'scorebars' }, sb('PLANNING', ai.planning), sb('LOGISTICS', ai.logistics), sb('ENERGY', ai.energy), sb('RESOURCE OPTIMIZATION', ai.resource), sb('EMERGENCY RESPONSE', ai.emergency), sb('AUTONOMY', ai.autonomy)),
      h('h3', null, 'What CORE has learned about you'),
      prefLines(st).length ? h('div', { class: 'term' }, ...prefLines(st).map((l) => h('div', null, l))) : h('div', { class: 'muted' }, 'Learning from your choices…'),
      n ? h('div', null, h('h3', null, `Next stage: ${STAGE_INFO[n].name}`), h('div', { class: 'scorebars' }, stageProgress(st, n).map((r) => h('div', { class: 'r' }, r.label.toUpperCase(), bar(r.have / r.need), `${r.have}/${r.need}`))), h('div', { class: 'small muted' }, `Unlocks: ${STAGE_INFO[n].unlocks}`)) : null),
    h('div', null,
      h('h3', null, 'Colony history'),
      h('div', { class: 'timeline' }, st.history.slice().reverse().slice(0, 30).map((e) => h('div', { class: 'e' }, h('b', null, `SOL ${e.sol}`), h('span', null, e.text)))),
      h('h3', null, 'CORE memory'),
      h('div', { class: 'timeline' }, st.core.memory.slice(0, 20).map((m) => h('div', { class: 'e' }, h('b', null, `${clock(m.minute)}`), h('span', null, `${m.ok ? '✓' : '✗'} ${m.text} `, h('span', { class: 'chip' }, m.source))))),
      st.reports.length ? h('div', null, h('h3', null, 'Sol reports'), h('div', { class: 'list' }, st.reports.slice(0, 5).map((r) => h('button', { class: 'line', type: 'button', onclick: () => g.wins.open('report', r) }, h('b', { class: 'lt grow' }, `SOL ${r.sol}`), `score ${r.score}`, h('span', { class: 'muted small' }, ` power ${r.uptimePower.toFixed(0)}% · O₂ ${r.uptimeO2.toFixed(0)}%`))))) : null));
}

export { sol, mods, POWER_CATS };
