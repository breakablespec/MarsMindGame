import { newColony } from '../src/sim/init';
import { simulate } from '../src/sim/tick';
import { coreMinute } from '../src/ai/autonomy';
import { plan } from '../src/ai/planner';
import { parse } from '../src/ai/parser';
import { totals } from '../src/sim/storage';
import { clock } from '../src/sim/core';
import { o2Cap, batteryCap } from '../src/sim/power';
import { colonyScores } from '../src/sim/colony';
import { aiScores } from '../src/ai/perf';

const st = newColony();
const hooks = { onMinute: coreMinute };
const show = (label: string) => {
  const t = totals(st);
  console.log(`[${label}] SOL ${Math.floor(st.minute / 1440) + 1} ${clock(st.minute)} O2 ${st.o2.toFixed(1)}/${o2Cap(st)} W ${st.water.toFixed(1)} bat ${st.power.battery.toFixed(1)}/${batteryCap(st)} gen ${st.power.gen.toFixed(1)} used ${st.power.used.toFixed(1)} shed ${st.power.shed.join(',')} | ice ${t.ice} reg ${t.regolith} fe ${t.iron} ti ${t.titanium} poly ${t.polymer} si ${t.silica} el ${t.electronics}`);
  for (const r of st.robots) console.log(`   ${r.name} ${r.state} ${r.phase} bat ${r.battery.toFixed(0)} cargo ${r.cargo ? r.cargo.res + ':' + r.cargo.qty : '-'}`);
  console.log('   tasks:', st.tasks.filter((t) => t.status === 'running' || t.status === 'waiting').map((t) => `#${t.id} ${t.title} [${t.label}] ${Math.round(t.progress * 100)}%`).join(' | '));
  console.log('   alerts:', st.alerts.filter((a) => !a.resolved).map((a) => a.title).join(' | '));
};
show('start');
simulate(st, 20, hooks); show('+20m');
// wow #1
for (const text of ['Build a second oxygen generator', 'Send drones for titanium', 'Build another solar panel', 'Fix the power problem', 'Prepare for a dust storm', 'Make the colony safer', 'Keep everyone alive', 'Build a reactor', 'Mine whatever resource we are lowest on', 'Move mining materials closer to the workshop', 'Prioritize oxygen over research', 'Build a habitat for 6 more colonists', 'What should we do next?']) {
  const pr = parse(text);
  const p = plan(st, pr.commands[0]);
  console.log(`\n> ${text}\n  ${JSON.stringify(pr.commands[0])} conf ${pr.confidence}\n  ${p.ok ? 'OK' : 'REFUSED'} ${p.title} — ${p.reply}\n  steps: ${p.steps.join(' / ')}\n  why: ${p.why.join(' / ')}\n  details: ${p.details.map((d) => d.label + ': ' + d.value).join(' / ')}\n  offers: ${p.offers.map((o) => o.label).join(', ')}`);
}
const p1 = plan(st, parse('Build a second oxygen generator').commands[0]);
const tasks = p1.exec!(st, 'PLAYER', 'Build a second oxygen generator');
console.log('created', tasks.map((t) => `#${t.id} ${t.title} after ${t.after}`));
for (let i = 0; i < 12; i++) { simulate(st, 30, hooks); show(`+${(i + 1) * 30}m`); }
const p2 = plan(st, parse('Send drones for titanium').commands[0]);
p2.exec!(st, 'PLAYER', 'Send drones for titanium');
for (let i = 0; i < 10; i++) { simulate(st, 30, hooks); show(`ti +${(i + 1) * 30}m`); }
simulate(st, 1440 * 2, hooks); show('+2 sols');
console.log('history', st.history.map((h) => `SOL ${h.sol} ${h.text}`));
console.log('report', st.lastReport);
console.log('scores', colonyScores(st), aiScores(st));
