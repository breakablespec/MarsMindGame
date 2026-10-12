// Static game data: resources, modules, robots, research, stages. Data only — no logic.

export const SEC_PER_MIN = 0.5; // real seconds per game minute at 1×
export const MIN_PER_SOL = 1440;
export const TILE = 16;

// ------------------------------------------------------------------ resources

export type ResId = 'regolith' | 'iron' | 'titanium' | 'ice' | 'rare' | 'silica' | 'polymer' | 'electronics';
export const RES_IDS: ResId[] = ['regolith', 'iron', 'titanium', 'ice', 'rare', 'silica', 'polymer', 'electronics'];
export interface ResDef { id: ResId; name: string; short: string; color: string; dark: string; raw: boolean; target: number }
export const RES: Record<ResId, ResDef> = {
  regolith: { id: 'regolith', name: 'Regolith', short: 'REG', color: '#e2b07a', dark: '#a8703f', raw: true, target: 30 },
  iron: { id: 'iron', name: 'Iron', short: 'FE', color: '#c4552c', dark: '#7d2a16', raw: true, target: 40 },
  titanium: { id: 'titanium', name: 'Titanium', short: 'TI', color: '#a9b8d6', dark: '#5d6a8a', raw: true, target: 40 },
  ice: { id: 'ice', name: 'Ice', short: 'ICE', color: '#8fd4ff', dark: '#4b9ad6', raw: true, target: 40 },
  rare: { id: 'rare', name: 'Rare minerals', short: 'RARE', color: '#ffd36b', dark: '#b07fe0', raw: true, target: 10 },
  silica: { id: 'silica', name: 'Silica', short: 'SI', color: '#f4f1ea', dark: '#a9a39a', raw: false, target: 20 },
  polymer: { id: 'polymer', name: 'Polymer', short: 'POLY', color: '#ffb36b', dark: '#c46a1c', raw: false, target: 20 },
  electronics: { id: 'electronics', name: 'Electronics', short: 'ELEC', color: '#4dff7a', dark: '#1d7a3e', raw: false, target: 12 },
};

export interface Recipe { out: ResId; outQty: number; inputs: Partial<Record<ResId, number>>; minutes: number }
export const RECIPES: Partial<Record<ResId, Recipe>> = {
  silica: { out: 'silica', outQty: 1, inputs: { regolith: 2 }, minutes: 30 },
  polymer: { out: 'polymer', outQty: 1, inputs: { ice: 1, regolith: 1 }, minutes: 40 },
  electronics: { out: 'electronics', outQty: 2, inputs: { rare: 1, silica: 1 }, minutes: 60 },
};

// ------------------------------------------------------------------ deposits

export type DepositKind = 'regolith' | 'iron' | 'titanium' | 'ice' | 'rare' | 'debris' | 'vent';
export const DEPOSIT: Record<DepositKind, { name: string; amount: number; secPerUnit: number; res: ResId | null }> = {
  regolith: { name: 'Regolith field', amount: 400, secPerUnit: 1.6, res: 'regolith' },
  iron: { name: 'Iron vein', amount: 220, secPerUnit: 2.0, res: 'iron' },
  ice: { name: 'Ice deposit', amount: 200, secPerUnit: 2.0, res: 'ice' },
  titanium: { name: 'Titanium vein', amount: 160, secPerUnit: 2.2, res: 'titanium' },
  rare: { name: 'Rare mineral pocket', amount: 60, secPerUnit: 3.0, res: 'rare' },
  debris: { name: 'Crash debris', amount: 16, secPerUnit: 3.0, res: null },
  vent: { name: 'Geothermal vent', amount: 0, secPerUnit: 0, res: null },
};

// ------------------------------------------------------------------ stages

export type Stage = 'outpost' | 'base' | 'colony' | 'settlement' | 'city';
export const STAGES: Stage[] = ['outpost', 'base', 'colony', 'settlement', 'city'];
export const STAGE_INFO: Record<Stage, { name: string; need: { modules: number; robots?: number; pop?: number; research?: number; outposts?: number }; unlocks: string }> = {
  outpost: { name: 'OUTPOST', need: { modules: 0 }, unlocks: 'Basic modules · robot bay' },
  base: { name: 'BASE', need: { modules: 12, robots: 4, research: 1 }, unlocks: 'Comm tower · medical module · meteors begin · far terrain charted' },
  colony: { name: 'COLONY', need: { modules: 20, pop: 8, research: 5 }, unlocks: 'Mining outposts · solar storms · larger shuttles' },
  settlement: { name: 'SETTLEMENT', need: { modules: 30, pop: 14, research: 10, outposts: 1 }, unlocks: 'Reactor research · stronger storms' },
  city: { name: 'CITY', need: { modules: 45, pop: 24, research: 16 }, unlocks: 'Everything' },
};
export const stageIndex = (s: Stage) => STAGES.indexOf(s);

// ------------------------------------------------------------------ research

export type Branch = 'power' | 'life' | 'automation' | 'mining' | 'construction' | 'ai' | 'habitation';
export const BRANCHES: { id: Branch; name: string; color: string }[] = [
  { id: 'power', name: 'POWER', color: '#ffcc2e' },
  { id: 'life', name: 'LIFE SUPPORT', color: '#2fe0e8' },
  { id: 'automation', name: 'AUTOMATION', color: '#ff8a1f' },
  { id: 'mining', name: 'MINING', color: '#c4552c' },
  { id: 'construction', name: 'CONSTRUCTION', color: '#9aa3b5' },
  { id: 'ai', name: 'AI', color: '#4dff7a' },
  { id: 'habitation', name: 'HABITATION', color: '#f6ead2' },
];
export type TechId =
  | 'solar_eff' | 'wind' | 'reactor'
  | 'electrolysis' | 'water_recl' | 'sealed'
  | 'dispatch' | 'maint_drones' | 'swarm'
  | 'drills' | 'scanner' | 'geo'
  | 'prefab' | 'lattice' | 'bracing'
  | 'predictive' | 'forecast' | 'core2'
  | 'bunks' | 'greenhouse' | 'shielding';
export interface TechDef { id: TechId; branch: Branch; tier: 1 | 2 | 3; name: string; effect: string; rp: number; cost: Partial<Record<ResId, number>>; stage?: Stage; keywords: string[] }
const T = (id: TechId, branch: Branch, tier: 1 | 2 | 3, name: string, effect: string, cost: Partial<Record<ResId, number>>, keywords: string[], stage?: Stage): TechDef =>
  ({ id, branch, tier, name, effect, rp: tier === 1 ? 120 : tier === 2 ? 300 : 600, cost, keywords, stage });
export const TECHS: TechDef[] = [
  T('solar_eff', 'power', 1, 'High-Efficiency Solar Cells', 'Solar output +12%', { silica: 10, electronics: 4 }, ['solar', 'power', 'energy', 'panel', 'electricity']),
  T('wind', 'power', 2, 'Wind Turbines', 'Unlocks WIND TURBINE: 3 kW day and night, ×2.5 during dust storms', { iron: 12, polymer: 8, electronics: 6 }, ['wind', 'storm', 'night', 'power', 'dust', 'backup']),
  T('reactor', 'power', 3, 'Compact Reactor', 'Unlocks REACTOR: 35 kW constant, storm-proof', { titanium: 25, electronics: 20, rare: 6 }, ['reactor', 'nuclear', 'power', 'energy', 'storm'], 'settlement'),
  T('electrolysis', 'life', 1, 'Efficient Electrolysis', 'Oxygen generators +25% output at the same power', { polymer: 8, electronics: 4 }, ['oxygen', 'o2', 'air', 'breathe', 'electrolysis', 'efficiency']),
  T('water_recl', 'life', 2, 'Water Reclamation', 'Colonists use 50% less water', { polymer: 12, silica: 8, electronics: 4 }, ['water', 'ice', 'reclaim', 'recycle', 'survive', 'longer']),
  T('sealed', 'life', 3, 'Sealed Habitats', 'Leaks −60%, meteor damage to habitats −30%', { titanium: 20, polymer: 15 }, ['leak', 'seal', 'habitat', 'safe', 'meteor', 'oxygen']),
  T('dispatch', 'automation', 1, 'Smart Dispatch', 'All robots move 15% faster', { electronics: 6, silica: 4 }, ['robot', 'speed', 'faster', 'logistics', 'dispatch']),
  T('maint_drones', 'automation', 2, 'Maintenance Drones', 'Unlocks MAINTENANCE DRONE (cleans panels, refills hoppers)', { electronics: 10, polymer: 8 }, ['maintenance', 'clean', 'drone', 'panel', 'dust', 'automation']),
  T('swarm', 'automation', 3, 'Swarm Logic', 'Robot cargo +25%; builders stack at full speed', { electronics: 18, rare: 4 }, ['swarm', 'robot', 'cargo', 'build', 'faster', 'automation']),
  T('drills', 'mining', 1, 'Diamond Drills', 'Mining speed +30%', { iron: 10, titanium: 6 }, ['drill', 'mine', 'mining', 'faster', 'titanium', 'extraction']),
  T('scanner', 'mining', 2, 'Deep Scanner', 'Reveals every deposit within 22 tiles of the base', { electronics: 10, silica: 8 }, ['scan', 'find', 'deposit', 'titanium', 'explore', 'scout', 'survey']),
  T('geo', 'mining', 3, 'Geothermal Tap', 'Unlocks GEOTHERMAL TAP on vents: 12 kW constant', { titanium: 20, electronics: 12 }, ['geothermal', 'vent', 'power', 'heat']),
  T('prefab', 'construction', 1, 'Prefab Frames', 'Construction 30% faster', { iron: 12, polymer: 4 }, ['build', 'construction', 'faster', 'prefab']),
  T('lattice', 'construction', 2, 'Titanium Lattice', 'Titanium costs −20%', { titanium: 15, silica: 6 }, ['titanium', 'cheaper', 'cost', 'build']),
  T('bracing', 'construction', 3, 'Storm Bracing', 'Storm and meteor damage −50%', { titanium: 20, iron: 20 }, ['storm', 'meteor', 'damage', 'safe', 'dust', 'protect', 'longer']),
  T('predictive', 'ai', 1, 'Predictive Maintenance', 'Robot breakdowns −70%', { electronics: 6 }, ['breakdown', 'repair', 'robot', 'maintenance', 'reliable']),
  T('forecast', 'ai', 2, 'Storm Forecasting', 'Storm warnings arrive twice as early with an automatic prep plan', { electronics: 10, silica: 6 }, ['storm', 'forecast', 'warning', 'dust', 'predict', 'longer', 'survive']),
  T('core2', 'ai', 3, 'CORE v2', '+1 parallel construction site; CORE plans expansions itself', { electronics: 24, rare: 6 }, ['ai', 'core', 'autonomy', 'smart', 'parallel']),
  T('bunks', 'habitation', 1, 'Bunk Expansion', 'Habitats hold 6 colonists instead of 4', { polymer: 10, iron: 6 }, ['bunk', 'bed', 'habitat', 'colonist', 'population', 'room']),
  T('greenhouse', 'habitation', 2, 'Greenhouse', 'Unlocks GREENHOUSE: +4 rations per sol', { silica: 12, polymer: 8 }, ['food', 'ration', 'greenhouse', 'plant', 'grow']),
  T('shielding', 'habitation', 3, 'Radiation Shielding', 'Solar storms no longer damage robots near the base', { titanium: 18, polymer: 12, rare: 4 }, ['radiation', 'solar storm', 'shield', 'protect']),
];
export const TECH: Record<TechId, TechDef> = Object.fromEntries(TECHS.map((t) => [t.id, t])) as Record<TechId, TechDef>;
export const techPrereq = (t: TechDef): TechId | null => { if (t.tier === 1) return null; const p = TECHS.find((x) => x.branch === t.branch && x.tier === t.tier - 1); return p ? p.id : null; };

// ------------------------------------------------------------------ modules

export type ModuleKind = 'command' | 'core' | 'habitat' | 'oxygen' | 'solar' | 'battery' | 'storage' | 'workshop' | 'lab' | 'robotbay' | 'outpost' | 'comm' | 'medical' | 'wind' | 'greenhouse' | 'reactor' | 'geo' | 'pad';
export type PowerCat = 'life' | 'core' | 'charging' | 'production' | 'research' | 'lighting';
export const POWER_CATS: PowerCat[] = ['life', 'core', 'charging', 'production', 'research', 'lighting'];
export const CAT_NAME: Record<PowerCat, string> = { life: 'LIFE SUPPORT', core: 'CORE SYSTEMS', charging: 'CHARGING', production: 'PRODUCTION', research: 'RESEARCH', lighting: 'LIGHTING' };

export interface ModuleDef {
  kind: ModuleKind; name: string; short: string; w: number; h: number;
  cost: Partial<Record<ResId, number>>; buildSec: number;
  draw: number; cat: PowerCat; gen?: number;
  o2Cap?: number; waterCap?: number; storeCap?: number; beds?: number; pads?: number;
  tech?: TechId; stage?: Stage; buildable: boolean; desc: string; color: string; needsVent?: boolean;
}
const M = (d: Omit<ModuleDef, 'buildable'> & { buildable?: boolean }): ModuleDef => ({ buildable: true, ...d });
export const MODULES: Record<ModuleKind, ModuleDef> = {
  command: M({ kind: 'command', name: 'Command Module', short: 'COMMAND', w: 3, h: 3, cost: {}, buildSec: 0, draw: 1.5, cat: 'core', o2Cap: 40, waterCap: 50, storeCap: 60, pads: 2, buildable: false, desc: 'Colony headquarters. Small store, 2 charging pads, oxygen and water tanks.', color: '#f6ead2' }),
  core: M({ kind: 'core', name: 'AI Core', short: 'AI CORE', w: 2, h: 2, cost: {}, buildSec: 0, draw: 1.5, cat: 'core', buildable: false, desc: 'CORE runs here. If it loses power, robots finish their current job and wait.', color: '#4dff7a' }),
  habitat: M({ kind: 'habitat', name: 'Habitat', short: 'HABITAT', w: 3, h: 2, cost: { titanium: 25, polymer: 15, silica: 10, iron: 10 }, buildSec: 50, draw: 1.0, cat: 'life', o2Cap: 60, waterCap: 20, beds: 4, desc: 'Pressurised living quarters. 4 beds (6 with Bunk Expansion).', color: '#f6ead2' }),
  oxygen: M({ kind: 'oxygen', name: 'Oxygen Generator', short: 'OXYGEN', w: 2, h: 2, cost: { titanium: 40, polymer: 20, electronics: 10 }, buildSec: 42, draw: 4.0, cat: 'life', o2Cap: 80, waterCap: 40, desc: 'Melts ice into water and splits it into oxygen: 6 O₂/h. Ice hopper holds 20.', color: '#2fe0e8' }),
  solar: M({ kind: 'solar', name: 'Solar Array', short: 'SOLAR', w: 2, h: 2, cost: { iron: 10, silica: 12, electronics: 2 }, buildSec: 25, draw: 0, cat: 'core', gen: 14, desc: '14 kW at noon, nothing at night. Dust on the panels cuts output.', color: '#ffcc2e' }),
  battery: M({ kind: 'battery', name: 'Battery Bank', short: 'BATTERY', w: 2, h: 2, cost: { iron: 15, electronics: 6, polymer: 4 }, buildSec: 30, draw: 0, cat: 'core', desc: 'Stores 120 kWh to carry the colony through the night.', color: '#ffcc2e' }),
  storage: M({ kind: 'storage', name: 'Storage', short: 'STORAGE', w: 2, h: 2, cost: { iron: 20, regolith: 10 }, buildSec: 20, draw: 0.2, cat: 'core', storeCap: 200, desc: 'Cargo blocks for 200 units of solids.', color: '#9aa3b5' }),
  workshop: M({ kind: 'workshop', name: 'Workshop', short: 'WORKSHOP', w: 3, h: 2, cost: { iron: 25, titanium: 10, electronics: 4 }, buildSec: 40, draw: 3.0, cat: 'production', desc: 'Makes silica, polymer and electronics. Conveyors reach storage within 5 tiles.', color: '#ff8a1f' }),
  lab: M({ kind: 'lab', name: 'Space Lab', short: 'LAB', w: 3, h: 2, cost: { titanium: 20, silica: 15, electronics: 12, polymer: 6 }, buildSec: 50, draw: 3.0, cat: 'research', desc: 'Research. Needs a scientist and power.', color: '#8fd4ff' }),
  robotbay: M({ kind: 'robotbay', name: 'Robot Bay', short: 'ROBOT BAY', w: 3, h: 2, cost: { iron: 30, titanium: 15, electronics: 8 }, buildSec: 45, draw: 0.5, cat: 'production', pads: 4, desc: 'Builds robots. 4 charging pads.', color: '#ff8a1f' }),
  outpost: M({ kind: 'outpost', name: 'Mining Outpost', short: 'OUTPOST', w: 2, h: 2, cost: { iron: 25, titanium: 10, electronics: 3 }, buildSec: 35, draw: 0.5, cat: 'production', storeCap: 80, pads: 2, stage: 'colony', desc: 'Remote drop-off and 2 charging pads for far mining. Haulers carry its stock home.', color: '#4a4552' }),
  comm: M({ kind: 'comm', name: 'Comm Tower', short: 'COMM', w: 2, h: 2, cost: { iron: 15, electronics: 10, titanium: 5 }, buildSec: 30, draw: 1.0, cat: 'core', stage: 'base', desc: 'Earth link: supply shuttle every 2 sols instead of 3, trade offers.', color: '#d9dee8' }),
  medical: M({ kind: 'medical', name: 'Medical Module', short: 'MEDICAL', w: 2, h: 2, cost: { titanium: 10, polymer: 12, electronics: 8 }, buildSec: 35, draw: 1.0, cat: 'life', stage: 'base', desc: 'Heals colonists 2.5× faster.', color: '#ffffff' }),
  wind: M({ kind: 'wind', name: 'Wind Turbine', short: 'WIND', w: 2, h: 2, cost: { iron: 12, polymer: 6, electronics: 3 }, buildSec: 25, draw: 0, cat: 'core', gen: 3, tech: 'wind', desc: '3 kW day and night, ×2.5 in dust storms.', color: '#e3e7ef' }),
  greenhouse: M({ kind: 'greenhouse', name: 'Greenhouse', short: 'GREENHOUSE', w: 3, h: 2, cost: { silica: 25, polymer: 15, iron: 10 }, buildSec: 45, draw: 2.5, cat: 'production', tech: 'greenhouse', desc: '+4 rations per sol.', color: '#5bd35a' }),
  reactor: M({ kind: 'reactor', name: 'Reactor', short: 'REACTOR', w: 3, h: 3, cost: { titanium: 60, electronics: 30, regolith: 40 }, buildSec: 80, draw: 0, cat: 'core', gen: 35, tech: 'reactor', desc: '35 kW, day, night and storm.', color: '#c8c3b4' }),
  geo: M({ kind: 'geo', name: 'Geothermal Tap', short: 'GEOTHERMAL', w: 2, h: 2, cost: { iron: 30, titanium: 20, electronics: 10 }, buildSec: 50, draw: 0, cat: 'core', gen: 12, tech: 'geo', needsVent: true, desc: '12 kW constant. Must sit on a geothermal vent.', color: '#ff6b3b' }),
  pad: M({ kind: 'pad', name: 'Landing Pad', short: 'PAD', w: 4, h: 4, cost: {}, buildSec: 0, draw: 0.3, cat: 'lighting', buildable: false, desc: 'The supply shuttle lands here.', color: '#2a2236' }),
};
export const BUILD_MENU: ModuleKind[] = ['solar', 'battery', 'oxygen', 'storage', 'habitat', 'workshop', 'lab', 'robotbay', 'medical', 'comm', 'outpost', 'wind', 'greenhouse', 'geo', 'reactor'];

// ------------------------------------------------------------------ robots

export type RobotKind = 'miner' | 'hauler' | 'builder' | 'repair' | 'scout' | 'maint';
export type JobKind = 'haul' | 'build' | 'connect' | 'mine' | 'scout' | 'repair' | 'clean' | 'deconstruct' | 'recall' | 'charge' | 'tow';
export interface RobotDef { kind: RobotKind; name: string; prefix: string; speed: number; cargo: number; flying: boolean; cost: Partial<Record<ResId, number>>; fabMin: number; tech?: TechId; desc: string; can: JobKind[]; color: string }
export const ROBOTS: Record<RobotKind, RobotDef> = {
  miner: { kind: 'miner', name: 'Miner Bot', prefix: 'MINER', speed: 2.2, cargo: 30, flying: false, cost: { iron: 20, titanium: 8, electronics: 4 }, fabMin: 60, desc: 'Drills deposits and brings the ore home.', can: ['mine', 'haul', 'scout', 'recall', 'charge'], color: '#ff8a1f' },
  hauler: { kind: 'hauler', name: 'Hauler Bot', prefix: 'HAULER', speed: 2.8, cargo: 40, flying: false, cost: { iron: 18, polymer: 6, electronics: 3 }, fabMin: 50, desc: 'Moves materials: storage, sites, hoppers, outposts.', can: ['haul', 'recall', 'charge', 'tow'], color: '#9aa3b5' },
  builder: { kind: 'builder', name: 'Builder Bot', prefix: 'BUILDER', speed: 2.4, cargo: 15, flying: false, cost: { iron: 18, titanium: 6, electronics: 4 }, fabMin: 60, desc: 'Assembles and connects modules. Can haul small loads and repair slowly.', can: ['build', 'connect', 'haul', 'deconstruct', 'repair', 'clean', 'recall', 'charge', 'tow'], color: '#ffb21f' },
  repair: { kind: 'repair', name: 'Repair Bot', prefix: 'REPAIR', speed: 2.6, cargo: 10, flying: false, cost: { titanium: 10, polymer: 6, electronics: 6 }, fabMin: 50, desc: 'Fixes modules and robots fast. Seals leaks. Tows dead robots.', can: ['repair', 'tow', 'haul', 'recall', 'charge', 'clean'], color: '#f2f4f8' },
  scout: { kind: 'scout', name: 'Scout Drone', prefix: 'SCOUT', speed: 4.5, cargo: 0, flying: true, cost: { polymer: 8, electronics: 6, titanium: 4 }, fabMin: 40, desc: 'Flies over terrain, reveals fog and surveys deposits.', can: ['scout', 'recall', 'charge'], color: '#2fe0e8' },
  maint: { kind: 'maint', name: 'Maintenance Drone', prefix: 'MAINT', speed: 3.5, cargo: 10, flying: true, cost: { polymer: 6, electronics: 4, iron: 4 }, fabMin: 40, tech: 'maint_drones', desc: 'Cleans solar panels and keeps hoppers full.', can: ['clean', 'haul', 'repair', 'recall', 'charge'], color: '#2fe0e8' },
};
export const ROBOT_KINDS: RobotKind[] = ['miner', 'hauler', 'builder', 'repair', 'scout', 'maint'];
/** Preferred robot types per job, best first. */
export const JOB_PREF: Record<JobKind, RobotKind[]> = {
  haul: ['hauler', 'builder', 'maint', 'repair', 'miner'],
  build: ['builder'], connect: ['builder'], deconstruct: ['builder'],
  mine: ['miner'], scout: ['scout', 'miner'],
  repair: ['repair', 'builder', 'maint'], clean: ['maint', 'builder', 'repair'],
  recall: ['miner', 'hauler', 'builder', 'repair', 'scout', 'maint'], charge: ['miner', 'hauler', 'builder', 'repair', 'scout', 'maint'],
  tow: ['repair', 'builder', 'hauler'],
};

// ------------------------------------------------------------------ colonists

export type Role = 'engineer' | 'scientist' | 'technician' | 'medic' | 'miner';
export const ROLE_INFO: Record<Role, { name: string; color: string; bonus: string }> = {
  engineer: { name: 'ENGINEER', color: '#ff8a1f', bonus: 'Construction +15%' },
  scientist: { name: 'SCIENTIST', color: '#8fd4ff', bonus: 'Runs the lab' },
  technician: { name: 'TECHNICIAN', color: '#ffcc2e', bonus: 'Robots +10%, repairs +25%' },
  medic: { name: 'MEDIC', color: '#ff3b3b', bonus: 'Healing ×2.5 with medical' },
  miner: { name: 'MINER', color: '#c4552c', bonus: 'Mining +10%' },
};
export const COLONIST_NAMES = ['ADA', 'KENJI', 'PRIYA', 'OMAR', 'LENA', 'TOMAS', 'YUKI', 'AMARA', 'IGOR', 'MAYA', 'RAFAEL', 'SUNG', 'ZARA', 'NIKO', 'ELIF', 'JONAS', 'MEI', 'DIEGO', 'ANYA', 'KOFI', 'ROSA', 'HUGO', 'NADIA', 'PAVEL', 'IRIS', 'MALIK', 'SAGE', 'TEO'];

// ------------------------------------------------------------------ tuning

export const TUNE = {
  solarPeak: 14,
  batteryKwh: 120,
  batteryRate: 30,
  o2PerColonist: 1.0,
  waterPerColonist: 0.25,
  o2GenRate: 6,
  o2GenWater: 1.5,
  melterIcePerHour: 2,
  waterPerIce: 3,
  hopperCap: 20,
  hopperLow: 8,
  leakRate: 10,
  chargePerSec: 5,
  returnBattery: 25,
  conveyorRange: 5,
  shuttleEvery: 3,
  dustPerSol: 0.06,
  stormDustPerSol: 0.4,
  labRp: 1,
};
