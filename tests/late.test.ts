// Late-game smoke: lab → research → robot bay → fabricate → meteors at BASE.
import { newColony } from '../src/sim/init';
import { simulate } from '../src/sim/tick';
import { coreMinute } from '../src/ai/autonomy';
import { plan } from '../src/ai/planner';
import { parse } from '../src/ai/parser';
import { put, stores } from '../src/sim/storage';
const st = newColony(11);
const hooks = { onMinute: coreMinute };
// generous stock so the test exercises flow, not economy
const s0 = stores(st)[0];
for (const [r, q] of Object.entries({ iron: 60, titanium: 60, silica: 40, electronics: 40, polymer: 30 })) { s0.store[r as 'iron'] = (s0.store[r as 'iron'] ?? 0) + q; }
void put;
const run = (text: string) => {
  const p = plan(st, parse(text).commands[0]);
  console.log(`> ${text}: ${p.ok ? 'OK' : 'REFUSED'} ${p.title} — ${p.reply}`);
  if (p.exec) p.exec(st, 'PLAYER', text);
  return p;
};
run('Build a space lab');
run('Build a robot bay');
for (let i = 0; i < 16; i++) simulate(st, 30, hooks);
console.log('modules', st.modules.map((m) => `${m.name}:${m.status}`).join(' '));
run('Research solar efficiency');
run('Build a hauler robot');
for (let i = 0; i < 20; i++) simulate(st, 30, hooks);
console.log('research', JSON.stringify(st.research).slice(0, 300));
console.log('robots', st.robots.map((r) => `${r.name}:${r.kind}:${r.phase}`).join(' | '));
console.log('stage', st.stage, 'alerts', st.alerts.filter((a) => !a.resolved).map((a) => a.title).join(' | '));
import { totals } from '../src/sim/storage';
import { o2Cap } from '../src/sim/power';
for (let i = 0; i < 48 && !st.lost; i++) { simulate(st, 120, hooks); const t = totals(st); const ox = st.modules.find((m) => m.kind === 'oxygen');
  console.log(`S${Math.floor(st.minute / 1440) + 1} ${Math.floor(st.minute % 1440 / 60)}h o2 ${st.o2.toFixed(0)}/${o2Cap(st)} w ${st.water.toFixed(0)} ice ${t.ice} hop ${ox?.hopper.toFixed(1)} run ${ox?.running} pw ${ox?.powered} rat ${st.rations} bat ${st.power.battery.toFixed(0)} gen ${st.power.gen.toFixed(0)} dem ${st.power.used.toFixed(0)} shed ${st.power.shed.join(',')} pop ${st.colonists.filter((c) => !c.dead).length} hp ${st.colonists.filter((c) => !c.dead).map((c) => c.health.toFixed(0)).join(',')} | ${st.robots.map((r) => r.name.slice(0, 3) + ':' + r.phase.slice(0, 16)).join(' ')} | ${st.alerts.filter((a) => !a.resolved).map((a) => a.title).join(';')}`.slice(0, 360)); }
console.log('after 4 sols stage', st.stage, 'deaths', st.deaths, 'history', st.history.slice(-12).map((h) => `S${h.sol} ${h.text}`).join(' / '));
