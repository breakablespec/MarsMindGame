// The whole colony as one JSON-serialisable object. The simulation never touches the DOM,
// so the same state could live on a server (shared colony) or in localStorage (personal colony).

import type { DepositKind, JobKind, ModuleKind, PowerCat, ResId, RobotKind, Role, Stage, TechId } from './defs';

export type Facing = 'up' | 'down' | 'left' | 'right';
export type Inv = Partial<Record<ResId, number>>;

export interface Module {
  id: number; kind: ModuleKind; name: string;
  x: number; y: number; w: number; h: number;
  /** site → building → online. 'off' = switched off by player/CORE. */
  status: 'site' | 'building' | 'online' | 'off';
  hp: number;            // 0..1 structural health
  progress: number;      // 0..1 assembly progress
  connected: boolean;    // cable/pipe stage done
  delivered: Inv;        // materials delivered to the site
  store: Inv;            // storage contents (storage / command / outpost)
  hopper: number;        // oxygen generator ice hopper
  dust: number;          // solar panel dust 0..1
  powered: boolean;      // had power last minute
  running: boolean;      // actually operating last minute (e.g. O2 gen producing)
  taskId?: number;       // construction task
  builtMinute?: number;
  fab?: { kind: 'res'; res: ResId; left: number; orderId: number } | { kind: 'robot'; robot: RobotKind; left: number; orderId: number } | null;
  /** cable / pipe route to the grid, drawn while connecting */
  link?: { x: number; y: number; to: number; pipe: boolean } | null;
  /** cancelled/deconstructed: materials waiting to be hauled away, removed when empty */
  salvage?: boolean;
  /** module is being moved: rebuilt elsewhere after deconstruction */
  moving?: boolean;
}

export interface Robot {
  id: number; kind: RobotKind; name: string;
  x: number; y: number;       // pixels (centre of tile = tx*16+8)
  facing: Facing;
  battery: number;            // 0..100
  condition: number;          // 0..100
  cargo: { res: ResId; qty: number } | null;
  jobId: number | null;
  state: 'idle' | 'moving' | 'working' | 'charging' | 'broken' | 'driven' | 'dead';
  phase: string;              // live label: "MINING TITANIUM", "CHARGING 62%"…
  path: [number, number][];
  goal: [number, number] | null;
  workT: number;              // accumulated work seconds
  padModule: number | null;   // charging at
  recall: boolean;            // ordered to stay inside base
  stats: { busy: number; idle: number; tiles: number; mined: number; hauled: number };
  wear: number;               // tiles since last wear tick
  sub: string;                // job sub-phase: fetch / deliver / unload / drill / work
  idleT: number;              // seconds idle
  lastTile: number;           // for per-tile drain/reveal
}

export interface Job {
  id: number; taskId: number; kind: JobKind;
  status: 'open' | 'active' | 'done' | 'failed';
  robotId: number | null;
  after: number[];            // job ids that must be done first
  res?: ResId; qty?: number; moved?: number;  // haul / mine progress
  from?: number;              // module id (source storage) — chosen at pickup if absent
  to?: number;                // module id (site / hopper / storage / lab)
  toKind?: 'site' | 'hopper' | 'storage' | 'lab';
  target?: number;            // module / deposit / robot id
  waypoints?: [number, number][];
  label: string;
  note?: string;
  fail?: string;
  blockedUntil?: number;     // game minute — don't reassign before this
  targetRobot?: number;      // repair / tow a robot
  find?: string;             // scout: stop when a deposit of this kind is found
  only?: number;             // reserved for one robot (player named it)
  found?: number[];          // scout results (deposit ids)
}

export type TaskSource = 'PLAYER' | 'CORE' | 'ROUTINE' | 'EMERGENCY' | 'STANDING' | 'BRIEFING';
export interface Task {
  id: number; title: string; kind: string; source: TaskSource;
  status: 'waiting' | 'running' | 'done' | 'failed' | 'cancelled';
  after: number[];            // task ids
  jobs: number[];
  created: number;            // game minute
  startedReal?: number;       // real seconds clock when first job activated
  finished?: number;
  command?: string;
  result?: string;
  label: string;
  progress: number;
  siteId?: number;
  est?: number;               // estimated real seconds
  effect?: { kind: 'o2cap' | 'powerpeak' | 'battery' | 'storage' | 'beds' | 'generic'; before: number };
  permission?: string;
  /** production / fabrication / research handled by modules, not jobs */
  produce?: { res: ResId; qty: number; orderId: number };
  fabricate?: { robot: RobotKind; orderId: number };
  researchTech?: TechId;
  priority: number;           // 0 emergency, 1 player, 2 routine
  reason?: string;
}

export interface Deposit { id: number; kind: DepositKind; x: number; y: number; amount: number; max: number; found: boolean; signal: boolean; salvage?: { electronics: number; rare: number; rp: number } }

export interface Colonist { id: number; name: string; role: Role; health: number; x: number; y: number; path: [number, number][]; inside: number | null; insideT: number; target: number | null; arrivedSol: number; dead?: boolean }

export interface Alert { id: number; key: string; kind: string; title: string; detail: string; severity: 'info' | 'warn' | 'crit'; since: number; resolved?: number; target?: number; acted?: boolean; planned?: boolean; cmd?: string; label?: string; dismissed?: boolean }

export interface Rule { id: number; kind: 'hopper' | 'stock' | 'clean' | 'schedule' | 'reserve' | 'hold'; text: string; enabled: boolean; minute?: number; command?: string; robotId?: number; lastSol?: number; source: 'START' | 'PLAYER' | 'CORE' }

export interface ProdOrder { id: number; res: ResId; qty: number; done: number; taskId?: number; standing?: boolean }
export interface FabOrder { id: number; robot: RobotKind; taskId?: number; started: boolean }

export interface HistoryEntry { sol: number; minute: number; text: string; kind: 'milestone' | 'build' | 'emergency' | 'stage' | 'loss' | 'research' | 'arrival' }
export interface MemoryEntry { sol: number; minute: number; text: string; source: string; ok: boolean; kind: 'command' | 'auto' | 'learned' | 'emergency' }

export interface SolStats {
  mined: Inv; produced: Inv; built: number; repairs: number; tasks: number; emergencies: number;
  powerMinutes: number; powerOkMinutes: number; o2Minutes: number; o2OkMinutes: number;
  robotBusy: number; robotTotal: number; peak: number; genKwh: number; useKwh: number; shortageMinutes: number; overloadMinutes: number;
}

export interface Report { sol: number; lines: string[]; uptimePower: number; uptimeO2: number; learned: string[]; score: number }

export type Autonomy = 'manual' | 'assisted' | 'automated' | 'autonomous';
export type Perm = 'mine' | 'build' | 'repair' | 'trade' | 'power' | 'research' | 'expand';

export interface CoreState {
  autonomy: Autonomy;
  perms: Record<Perm, boolean>;
  prefs: { safety: number; solar: number; storage: number; mining: number; research: number };
  prefEvidence: { dim: string; text: string; sol: number }[];
  xp: number;
  plans: { made: number; done: number; failed: number; refused: number; estErr: number[] };
  emergencies: { raised: number; resolved: number; times: number[] };
  initiated: { count: number; ok: number };
  memory: MemoryEntry[];
  forecastErr: number[];
  said: Record<string, number>;   // suggestion keys → last minute said (to avoid nagging)
  forecastToday?: number;
  learnedPending: string[];
  prefSnapshot?: Record<string, number>;
}

export interface Weather {
  storm: { start: number; end: number; strength: number; announced: boolean } | null;
  nextStorm: number;          // game minute
  solarStorm: { start: number; end: number } | null;
  nextSolarStorm: number;
  meteor: { at: number; count: number; announced: boolean } | null;
  nextMeteor: number;
  coldSols: number[];
}

export interface Shuttle { next: number; state: 'away' | 'landing' | 'landed' | 'leaving'; t: number; colonists: number; cargo: Inv; rations: number }

export interface Power {
  order: PowerCat[];
  mode: Record<PowerCat, 'on' | 'auto' | 'off'>;
  hold: { cats: PowerCat[]; untilO2?: number; untilMinute?: number; why: string } | null;   // "prioritize oxygen", storm prep
  nightOff: PowerCat[];       // categories that only run in daylight (optimize)
  battery: number;            // kWh stored
  gen: number; demand: number; used: number;           // kW last minute
  shed: PowerCat[];
  reserve: number;            // keep this fraction of battery for life support (standing rule)
  lastShed?: number;          // minute power was last shed (alert hysteresis)
}

export interface ColonyState {
  version: 1;
  seed: number;
  rng: number;
  minute: number;             // absolute game minutes since SOL 1 00:00
  speed: number;
  stage: Stage;
  explored: string;           // RLE-encoded explored mask
  terrainEdits: Record<number, number>;
  modules: Module[];
  robots: Robot[];
  deposits: Deposit[];
  colonists: Colonist[];
  jobs: Job[];
  tasks: Task[];
  rules: Rule[];
  production: ProdOrder[];
  fabQueue: FabOrder[];
  research: { done: TechId[]; current: TechId | null; rp: number; delivered: boolean; taskId: number | null; queue: TechId[]; bank?: number };
  power: Power;
  o2: number; water: number; rations: number;
  weather: Weather;
  shuttle: Shuttle;
  alerts: Alert[];
  history: HistoryEntry[];
  sol: SolStats;
  prevSol?: SolStats;
  lastReport: Report | null;
  reports: Report[];
  core: CoreState;
  briefing: { step: number; done: boolean; offered: boolean };
  nextId: number;
  deaths: number;
  evacuate: number[];         // habitats colonists should avoid (leak response)
  holdMining: boolean;        // pause routine mining (prioritize oxygen)
  lost: boolean;
  lastSavedAt?: number;
  firsts: Record<string, number>;
  scoreHist: number[];
  demo?: boolean;
}

export const newId = (st: ColonyState) => st.nextId++;
