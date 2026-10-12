// Headless 8-sol run used for the README charts. Prints JSON to stdout.
import { newColony } from '../src/sim/init';
import { simulate } from '../src/sim/tick';
import { coreMinute } from '../src/ai/autonomy';
import { plan } from '../src/ai/planner';
import { parse } from '../src/ai/parser';
import { o2Cap, batteryCap } from '../src/sim/power';
import { RES_IDS } from '../src/sim/defs';
import { ACHIEVEMENTS, EARN } from '../src/account/account';
import { CONFIG } from '../src/account/config';

const st = newColony(7);
const startMods = st.modules.length; const startFound = st.deposits.filter((d) => d.found).length;
const hooks = { onMinute: coreMinute };
const series: { m: number; o2: number; bat: number; gen: number; storm: number }[] = [];
const mined: Record<string, number>[] = [];
const cmds = ['Build a second oxygen generator', 'Send drones for titanium', 'Build another solar panel'];
let ci = 0;
for (let m = 0; m < 1440 * 8; m += 30) {
  if (ci < cmds.length && m >= ci * 120 + 30) { const p = plan(st, parse(cmds[ci]).commands[0]); if (p.exec) p.exec(st, 'PLAYER', cmds[ci]); ci++; }
  const before = Math.floor(st.minute / 1440);
  simulate(st, 30, hooks);
  if (Math.floor(st.minute / 1440) !== before && st.prevSol) mined.push({ ...(st.prevSol.mined as Record<string, number>), _prod: Object.values(st.prevSol.produced ?? {}).reduce((a: number, b) => a + (b ?? 0), 0) });
  const s = st.weather.storm;
  series.push({ m: st.minute, o2: Math.round((st.o2 / o2Cap(st)) * 1000) / 10, bat: Math.round((st.power.battery / batteryCap(st)) * 1000) / 10, gen: Math.round(st.power.gen * 10) / 10, storm: s && st.minute >= s.start && st.minute < s.end ? 1 : 0 });
}
const storms = st.history.filter((h) => h.text.startsWith('Dust storm passed')).length;
const ach = ACHIEVEMENTS.filter((a) => a.check(st, {} as never));
const earn = [
  ['4 quests on X', 4 * CONFIG.questReward],
  [`${ach.length} achievements`, ach.reduce((a, b) => a + b.reward, 0)],
  ['8 sols survived', 8 * EARN.sol],
  [`${storms} dust storms survived`, storms * EARN.storm],
  [`${st.modules.filter((m) => m.status === 'online').length - startMods} modules built`, (st.modules.filter((m) => m.status === 'online').length - startMods) * EARN.module],
  [`${st.deposits.filter((d) => d.found).length - startFound} deposits found`, (st.deposits.filter((d) => d.found).length - startFound) * EARN.deposit],
];
console.log(JSON.stringify({ earn, ach: ach.map((a) => a.name), start: 420, series, mined, res: RES_IDS, deaths: st.deaths, stage: st.stage, history: st.history.map((h) => `SOL ${h.sol} ${h.text}`) }));
