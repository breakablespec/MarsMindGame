// Parser + planner contract tests: the brief's example commands must map to the right intent,
// and CORE must never fake an impossible action.
import { parse } from '../src/ai/parser';
import { plan } from '../src/ai/planner';
import { newColony } from '../src/sim/init';
import { simulate } from '../src/sim/tick';
import { coreMinute } from '../src/ai/autonomy';

let fail = 0, pass = 0;
const ok = (cond: boolean, msg: string) => { if (cond) pass++; else { fail++; console.log('FAIL', msg); } };

const CASES: [string, Partial<Record<string, unknown>>][] = [
  ['Build a second oxygen generator', { intent: 'build', module: 'oxygen' }],
  ['Build another solar panel', { intent: 'build', module: 'solar' }],
  ['Send drones for titanium', { intent: 'mine', resource: 'titanium' }],
  ['Mine whatever resource we are lowest on', { intent: 'mine', resource: 'lowest' }],
  ['Fix the power problem', { intent: 'fix' }],
  ['Prepare for a dust storm', { intent: 'prepare' }],
  ['Keep everyone alive', { intent: 'survive' }],
  ['Make the colony safer', { intent: 'safety' }],
  ['Prioritize oxygen over research', { intent: 'prioritize', system: 'oxygen', over: 'research' }],
  ['Build a habitat for 6 more colonists', { intent: 'build', module: 'habitat' }],
  ['Clean the solar panels every morning', { intent: 'schedule' }],
  ['Build a reactor', { intent: 'build', module: 'reactor' }],
  ['Recall all robots', { intent: 'recall' }],
  ['Scout north', { intent: 'explore', direction: 'north' }],
];
for (const [text, want] of CASES) {
  const c = parse(text).commands[0] as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(want)) ok(c?.[k] === v, `"${text}" → ${k}=${String(c?.[k])}, want ${String(v)}`);
}

// Brief example: 2 polymer short → CORE says so and offers to produce it, nothing is built for free
const st = newColony();
simulate(st, 5, { onMinute: coreMinute });
const p = plan(st, parse('Build a second oxygen generator').commands[0]);
ok(/2 more polymer/.test(p.reply), `oxygen reply mentions polymer shortfall: ${p.reply}`);
ok(p.confirm === 'yes', 'oxygen plan asks YES/EDIT/CANCEL');
ok(st.modules.filter((m) => m.kind === 'oxygen').length === 1, 'no module created before confirmation');

// Locked tech is refused, with an honest path
const r = plan(st, parse('Build a reactor').commands[0]);
ok(r.kind === 'refuse' && !r.exec, 'reactor refused without exec');
ok(r.offers.length > 0, 'reactor refusal offers a path');

// Gibberish is unknown, not guessed into an action
ok(parse('purple monkey dishwasher').commands[0]?.intent === 'unknown', 'gibberish → unknown');

console.log(`ai tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
