// Natural language → structured Command. Deterministic rules with a confidence score.
// Low-confidence results go to the Claude fallback (llm.ts), which must return the same schema.

import type { ModuleKind, ResId, RobotKind, TechId } from '../sim/defs';
import { TECHS } from '../sim/defs';
import type { Command, Direction, Intent, System } from './command';

export interface ParseResult { commands: Command[]; confidence: number }

const NUM: Record<string, number> = { a: 1, an: 1, one: 1, single: 1, two: 2, couple: 2, pair: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100 };
const ORD: Record<string, number> = { second: 1, third: 1, fourth: 1, fifth: 1, another: 1, extra: 1, additional: 1 };

export function normalize(s: string) {
  return ` ${s.toLowerCase().replace(/[’']/g, "'").replace(/o₂/g, 'o2').replace(/[^a-z0-9:'\s-]/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

const MODULE_WORDS: [RegExp, ModuleKind][] = [
  [/\b(oxygen|o2) (generators?|units?|gens?|plants?|makers?|machines?)\b|\boxygen\b(?! (risk|over|first|level|problem))|\bo2\b(?! (risk|problem))|\bgenerators?\b/, 'oxygen'],
  [/\bsolar( panels?| arrays?| farms?| fields?| cells?)?\b|\bpanels\b|\bpower hub\b/, 'solar'],
  [/\bbatter(y|ies)( banks?)?\b|\bpower storage\b|\benergy storage\b/, 'battery'],
  [/\bstorage( units?| modules?| depots?| blocks?)?\b|\bwarehouses?\b|\bdepots?\b|\bcargo blocks?\b/, 'storage'],
  [/\bhabitats?\b|\bhabs?\b|\bliving quarters\b|\bhousing\b|\bdorms?\b|\bbeds\b/, 'habitat'],
  [/\bworkshops?\b|\bfabricators?\b|\bfactor(y|ies)\b|\brefiner(y|ies)\b/, 'workshop'],
  [/\b(space |research )?lab(oratory|s)?\b/, 'lab'],
  [/\brobot (bay|factory|garage)s?\b|\bdrone bay\b|\bbays?\b/, 'robotbay'],
  [/\bmining outposts?\b|\boutposts?\b/, 'outpost'],
  [/\bcomm(s|unications?)?( tower| array| dish)?\b|\bantenna\b|\bradio\b/, 'comm'],
  [/\bmedical( module| bay)?\b|\bmed ?bay\b|\bclinic\b|\bhospital\b|\binfirmary\b/, 'medical'],
  [/\bwind( turbines?)?\b|\bturbines?\b/, 'wind'],
  [/\bgreenhouses?\b/, 'greenhouse'],
  [/\breactors?\b|\bnuclear\b/, 'reactor'],
  [/\bgeothermal( taps?| plants?)?\b/, 'geo'],
];
const RES_WORDS: [RegExp, ResId][] = [
  [/\btitanium\b|\bti\b/, 'titanium'],
  [/\biron\b|\bmetal\b|\bsteel\b/, 'iron'],
  [/\bice\b|\bwater\b/, 'ice'],
  [/\bregolith\b|\bsand\b|\bdirt\b|\bsoil\b/, 'regolith'],
  [/\brare( minerals?| metals?| earths?)?\b|\bminerals\b/, 'rare'],
  [/\bsilica\b|\bglass\b/, 'silica'],
  [/\bpolymers?\b|\bplastics?\b/, 'polymer'],
  [/\belectronics?\b|\bchips?\b|\bcircuits?\b/, 'electronics'],
];
const ROBOT_WORDS: [RegExp, RobotKind][] = [
  [/\bminers?\b|\bmining (drones?|bots?|robots?)\b|\bdrills?\b|\bdiggers?\b/, 'miner'],
  [/\bhaulers?\b|\btrucks?\b|\bcarriers?\b|\btransport (bots?|drones?)\b/, 'hauler'],
  [/\bbuilders?\b|\bconstruction (drones?|bots?|robots?)\b/, 'builder'],
  [/\brepair (bots?|drones?|robots?)\b|\brepairers?\b|\bmechanics?\b/, 'repair'],
  [/\bscouts?( drones?)?\b|\bexplorers?\b|\bsurvey drones?\b/, 'scout'],
  [/\bmaintenance (drones?|bots?)\b|\bmaint\b|\bcleaners?\b/, 'maint'],
];
const SYSTEM_WORDS: [RegExp, System][] = [
  [/\boxygen\b|\bo2\b|\bair\b|\blife support\b|\bbreath/, 'oxygen'],
  [/\bpower\b|\benergy\b|\belectric/, 'power'],
  [/\bresearch\b|\bscience\b|\blabs?\b/, 'research'],
  [/\bmining\b|\bminers\b|\bdrilling\b/, 'mining'],
  [/\blight(s|ing)?\b/, 'lighting'],
  [/\bproduction\b|\bmanufactur|\bfabricat|\bworkshop\b/, 'production'],
  [/\bstorage\b/, 'storage'],
  [/\bwater\b|\bice\b/, 'water'],
  [/\bcharg/, 'charging'],
  [/\bsafe|\bsafety\b|\bbackup\b/, 'safety'],
];

export const findModule = (t: string): ModuleKind | undefined => MODULE_WORDS.find(([re]) => re.test(t))?.[1];
export const findResource = (t: string): ResId | undefined => RES_WORDS.find(([re]) => re.test(t))?.[1];
export const findRobot = (t: string): RobotKind | undefined => ROBOT_WORDS.find(([re]) => re.test(t))?.[1];
export function findSystems(t: string): System[] {
  const out: { s: System; i: number }[] = [];
  for (const [re, s] of SYSTEM_WORDS) { const m = re.exec(t); if (m) out.push({ s, i: m.index }); }
  return out.sort((a, b) => a.i - b.i).map((x) => x.s);
}
export function findDirection(t: string): Direction | undefined {
  const m = /\b(north|south|east|west)(ern|ward|wards)?\b/.exec(t);
  if (m) return m[1] as Direction;
  if (/\b(nearest|closest|nearby)\b/.test(t)) return 'nearest';
  return undefined;
}
export function findNumber(t: string): number | undefined {
  const m = /\b(\d{1,4})\b/.exec(t);
  if (m) return parseInt(m[1], 10);
  for (const [w, n] of Object.entries(NUM)) if (new RegExp(`\\b${w}\\b`).test(t) && w !== 'a' && w !== 'an') return n;
  return undefined;
}
function findCount(t: string): number | undefined {
  for (const [w, n] of Object.entries(ORD)) if (new RegExp(`\\b${w}\\b`).test(t)) return n || 1;
  const n = findNumber(t);
  if (n !== undefined && n <= 12) return n;
  if (/\b(a|an|one)\b/.test(t)) return 1;
  return undefined;
}
function findTime(t: string): number | undefined {
  const m = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/.exec(t.replace(/\b(at|by)\b/g, ' '));
  if (/\bmorning\b|\bdawn\b|\bsunrise\b/.test(t)) return 6 * 60 + 30;
  if (/\bnoon\b|\bmidday\b/.test(t)) return 12 * 60;
  if (/\bevening\b|\bsunset\b|\bdusk\b/.test(t)) return 18 * 60;
  if (/\bnight\b|\bmidnight\b/.test(t)) return 22 * 60;
  if (m && /\b(at|every)\b/.test(t)) { let h = parseInt(m[1], 10); const mi = m[2] ? parseInt(m[2], 10) : 0; if (m[3] === 'pm' && h < 12) h += 12; if (m[3] === 'am' && h === 12) h = 0; if (h < 24) return h * 60 + mi; }
  return undefined;
}
function findTech(t: string): TechId | undefined {
  let best: TechId | undefined, bs = 0;
  for (const tech of TECHS) {
    const name = tech.name.toLowerCase();
    let s = 0;
    if (t.includes(name)) s += 10;
    for (const w of name.split(/[\s-]+/)) if (w.length > 3 && t.includes(w)) s += 2;
    if (tech.id === 'reactor' && /\breactor|nuclear\b/.test(t)) s += 6;
    if (tech.id === 'wind' && /\bwind\b/.test(t)) s += 6;
    if (tech.id === 'greenhouse' && /\bgreenhouse\b/.test(t)) s += 6;
    if (tech.id === 'maint_drones' && /\bmaintenance\b/.test(t)) s += 6;
    if (tech.id === 'geo' && /\bgeothermal\b/.test(t)) s += 6;
    if (s > bs) { bs = s; best = tech.id; }
  }
  return bs >= 4 ? best : undefined;
}

/** Parse one clause into a command. */
function parseClause(raw: string): { c: Command; conf: number } {
  const t = normalize(raw);
  const has = (re: RegExp) => re.test(t);
  const mod = findModule(t), res = findResource(t), robot = findRobot(t), dir = findDirection(t);
  const systems = findSystems(t);
  const num = findNumber(t);
  const C = (intent: Intent, extra: Partial<Command> = {}, conf = 0.9) => ({ c: { intent, ...extra } as Command, conf });

  if (has(/^\s*(cancel|stop|abort|halt|nevermind|never mind)\b/) || has(/\bcancel (all|everything|the task|tasks)\b/)) return C('cancel');
  if (has(/\b(resume|unrecall|back to work|all clear|go back to work)\b/)) return C('resume');
  if (has(/\bkeep (everyone|everybody|the colonists|us|people|the crew) alive\b|\bsurviv(e|al)\b(?! storms?)|\bsave (the )?(colonists|crew|everyone)\b|\bwe('re| are) dying\b|\bemergency\b/)) return C('survive');
  if (has(/\b(most urgent|what('s| is) urgent|whatever is urgent|most important|top priority|do what('s| is) needed|whatever we need)\b/)) return C('urgent');
  if (has(/\bprepare\b|\bget ready\b|\bbrace\b|\bready (the colony|us|for)\b/)) return C('prepare', { storm: has(/storm|dust/) || !has(/night|cold/) });
  if (has(/\bevery (morning|day|night|evening|sol|noon)\b|\bdaily\b|\beach (morning|day|sol)\b|\bschedule\b|\bevery\s+\d/)) {
    const minute = findTime(t) ?? 6 * 60 + 30;
    const rest = raw.replace(/\b(every|each)\s+(morning|day|night|evening|sol|noon)\b|\bdaily\b|\bat\s+\d{1,2}(:\d{2})?\s*(am|pm)?/gi, ' ');
    const inner = parseClause(rest);
    return C('schedule', { schedule: { minute }, then: inner.c.intent === 'unknown' ? undefined : inner.c }, inner.c.intent === 'unknown' ? 0.4 : 0.85);
  }
  if (has(/\bprioriti[sz]e\b|\bpriority to\b|\bput .* first\b|\bfocus on\b/) && systems.length) {
    const over = has(/\bover\b|\bbefore\b|\babove\b|\binstead of\b/) && systems.length > 1 ? systems[1] : undefined;
    return C('prioritize', { system: systems[0], over });
  }
  if (has(/\b(turn|switch|shut|power) (off|down)\b|\bcut (the )?power to\b|\bdisable\b|\bpause\b/) && (systems.length || mod)) return C('allocate_power', { system: systems[0] ?? (mod === 'lab' ? 'research' : undefined), module: mod, off: true });
  if (has(/\b(turn|switch|power) on\b|\brestore power\b|\benable\b|\bunpause\b|\bre-?enable\b/) && (systems.length || mod)) return C('allocate_power', { system: systems[0] ?? (mod === 'lab' ? 'research' : undefined), module: mod, off: false });
  if (has(/\ballocate\b|\bpower budget\b|\bredirect power\b/)) return C('allocate_power', { system: systems[0] }, 0.7);
  if (has(/\bwhat should we research\b|\bresearch next\b|\bwhich research\b|\bwhat to research\b/)) return C('research', { question: raw }, 0.9);
  if (has(/\b(research|study|unlock|investigate|develop)\b/)) { const tech = findTech(t); return C('research', { tech, question: tech ? undefined : raw }, tech ? 0.9 : 0.75); }
  if (has(/^\s*how (do|can|could|would|should) we\b|\bfind (a )?(faster|better|cheaper) (way|method)\b/)) return C('research', { question: raw }, 0.7);
  if (robot && has(/\b(build|make|fabricate|construct|produce|print|order|need|want|get|add)\b/) && !has(/\b(send|dispatch)\b/) && !(mod && mod !== 'robotbay')) return C('build_robot', { robot, count: findCount(t) ?? 1 });
  if (has(/\bclean\b|\bdust off\b|\bwipe\b|\bsweep\b/)) return C('clean', {});
  if (has(/\b(repair|mend|patch|seal|weld)\b/) || (has(/\bfix\b/) && mod && !has(/\bproblem|issue\b/) && has(/\b(unit|module|generator|panel|array|bank|tank|habitat|hab|lab|bay|tower|turbine|reactor|workshop|storage)s?\b/))) return C('repair', { module: mod, robotName: /\b(miner|hauler|builder|repair|scout|maint)-?\d+\b/.exec(t)?.[0].toUpperCase().replace(/(\D)(\d)/, '$1-$2') });
  if (has(/\bfix\b|\bsolve\b|\bsort out\b|\bproblem\b|\bissue\b|\bwhat('s| is) wrong\b/) && systems.length) return C('fix', { system: systems[0] });
  if (has(/\b(reduce|lower|cut) (the )?(oxygen|o2) risk\b|\bsafer\b|\bsafety\b|\bbackup\b|\bredundan|\bprotect\b|\bsecure\b|\bfail-?safe\b/)) return C('safety', { system: systems.find((s) => s !== 'safety') });
  if (has(/\b(move|relocate|shift)\b/) && (has(/\bmaterials?\b|\bstock\b|\bsupplies\b|\bresources?\b/) || (res && !mod))) {
    const nearMod = findModule(t.split(/\b(to|near|closer to|next to|towards?)\b/).slice(-1)[0]);
    return C('transport', { resource: res, near: nearMod ?? (has(/\bmine\b/) ? 'mine' : undefined) });
  }
  if (has(/\b(move|relocate|shift)\b/) && mod) {
    const parts = t.split(/\b(closer to|near|next to|to|towards?|beside)\b/);
    const target = parts.length > 1 ? findModule(parts.slice(-1)[0]) : undefined;
    return C('move', { module: findModule(parts[0]) ?? mod, direction: dir, near: target && target !== mod ? target : undefined });
  }
  if (has(/\b(scout|explore|survey|map|chart|reconnoit|search)\b/) || (has(/\b(find|look for|locate)\b/) && (res || has(/deposit|resources?/)))) return C('explore', { direction: dir, resource: res, robots: findCount(t) });
  if (has(/\b(recall|bring (back|home|in)|return|come (home|back)|retreat|pull back|get inside)\b/) && (robot || has(/\b(robots?|drones?|bots?|everyone|all)\b/))) return C('recall', { robot });
  if (has(/\bcharge\b|\brecharge\b|\btop up\b/)) return C('charge', { system: has(/\b(robots?|drones?|bots?)\b/) ? 'charging' : 'power' });
  const produceVerb = has(/\b(produce|fabricate|manufacture|craft|refine|process|smelt|make)\b/);
  if (produceVerb && res && ['silica', 'polymer', 'electronics'].includes(res)) return C('produce', { resource: res, qty: num });
  const mineVerb = has(/\b(mine|dig|drill|extract|harvest|gather|collect|get|fetch|bring|send|dispatch|go for|need)\b/);
  if ((mineVerb && (res || has(/\blowest\b|\bwhatever\b|\bshort\b/))) || (has(/\bmining\b/) && res)) {
    if (has(/\b(lowest|whatever|least|short(est)? on|running low)\b/)) return C('mine', { resource: 'lowest', robots: robot === 'miner' || has(/drones?|bots?|robots?|miners?/) ? findCount(t) : undefined });
    if (res) {
      const qty = num && num > 3 ? num : undefined;
      const robots = /\b(two|three|four|2|3|4|both|all) (\w+ )?(drones?|miners?|bots?|robots?)\b/.test(t) ? (findCount(t.replace(/\b\d{2,}\b/g, '')) ?? 2) : /\b(drones|miners|bots|robots)\b/.test(t) ? 2 : undefined;
      return C('mine', { resource: res, qty, robots, robotName: /\b(miner)-?\d+\b/.exec(t)?.[0].toUpperCase().replace(/(\D)(\d)/, '$1-$2') });
    }
  }
  if (produceVerb && res) return C('produce', { resource: res, qty: num }, 0.6);
  const buildVerb = has(/\b(build|construct|add|place|set up|install|erect|put up|make|create|need|want|get|another|second|third|more|new|expand|extend|increase|grow|bigger)\b/);
  if (has(/\b(expand|extend|increase|grow|more|bigger|boost)\b/) && !mod && systems.length) {
    const s = systems[0];
    const m = s === 'power' ? 'solar' : s === 'storage' ? 'storage' : s === 'oxygen' ? 'oxygen' : s === 'research' ? 'lab' : undefined;
    if (m) return C('build', { module: m, count: 1 }, 0.8);
  }
  if (has(/\b(expand|extend|increase|boost)\b.*\bpower storage\b/)) return C('build', { module: 'battery', count: 1 });
  if (buildVerb && mod) {
    const col = /\bfor (\d+|\w+) (more )?(colonists|people|crew|settlers)\b/.exec(t);
    const colonists = col ? (parseInt(col[1], 10) || NUM[col[1]] || undefined) : undefined;
    const nearWord = /\b(near|next to|beside|by|close to|closer to|at) (the )?(\w+( \w+)?)/.exec(t);
    let near: Command['near'];
    if (nearWord) { const w = nearWord[3]; near = /\bmine|mining|deposit|vein\b/.test(w) ? 'mine' : findModule(` ${w} `) ?? findResource(` ${w} `) ?? (/\bbase\b/.test(w) ? 'base' : undefined); if (near === mod) near = undefined; }
    return C('build', { module: mod, count: colonists ? undefined : findCount(t.replace(/\bfor .*$/, '')) ?? 1, colonists, direction: dir, near });
  }
  if (has(/\b(optimi[sz]e|efficien|reduce|lower|save|cut) (the )?(power|energy|electricity)( use| usage| consumption)?\b|\boptimi[sz]e\b/)) return C('optimize', { system: systems[0] ?? 'power' });
  if (has(/\bstatus\b|\breport\b|\bhow are we\b|\bwhat('s| is) (happening|going on|next)\b|\bwhat should (we|i) do\b|\bwhat now\b|\badvice\b|\banaly[sz]e\b|\binspect\b|\bcheck\b|\bhow (much|many|long)\b|\bshow me\b/)) return C('inspect', { system: systems[0], question: raw }, 0.8);
  if (has(/\b(transport|haul|carry|deliver|bring)\b/) && res) return C('transport', { resource: res, near: findModule(t) });
  if (buildVerb && robot) return C('build_robot', { robot, count: findCount(t) ?? 1 }, 0.7);
  return C('unknown', { question: raw }, 0.2);
}

/** Split on "then"/"and then"/";" for multi-step requests. */
export function parse(raw: string): ParseResult {
  const parts = raw.split(/\s*(?:;|\band then\b|\bthen\b|\balso\b)\s*/i).map((s) => s.trim()).filter(Boolean).slice(0, 3);
  if (!parts.length) return { commands: [{ intent: 'unknown' }], confidence: 0 };
  const out = parts.map(parseClause);
  return { commands: out.map((o) => o.c), confidence: Math.min(...out.map((o) => o.conf)) };
}
