# AI_COMMAND_ARCHITECTURE.md

CORE is the colony operating system. The player describes an intention, CORE turns it into a valid plan, robots carry it out, and the colony changes. CORE never makes results appear by magic and never claims success it didn't achieve.

## 1. Pipeline

```
NaturalLanguageCommand
  → IntentParser      (ai/parser.ts)    text → Intent[] + slots + confidence
       └─ low confidence / unknown → Claude fallback (ai/llm.ts), same schema, validated
  → StateAnalysis     (ai/analysis.ts)  live numbers: power, O₂, water, stock, robots, risks
  → Planner           (ai/planner.ts)   intent × analysis → Plan (steps, cost, site, why)
  → Validator         (ai/validator.ts) resources, research, site, robots, permissions
       └─ blocked → refusal with honest reason + offers ("Produce 2 polymer first? [YES]")
  → Task Graph        (ai/tasks.ts)     Plan → Task(s) with Jobs and dependencies
  → Robot Assignment  (sim/logistics.ts) dispatcher picks robots per job
  → Execution         (sim/robots.ts)   physical movement and work
  → Result            (ai/tasks.ts)     before/after diff → "OXYGEN CAPACITY +44%"
```

Rules:

- Everything after the parser is deterministic game code.
- Claude (when the viewer allows it) only fills the same structured `Intent` JSON. Every field is validated against live state, and Claude's output is never executed as code.
- Labels on every CORE message tell the player where the answer came from:

  | Label | Meaning |
  |---|---|
  | **PARSED** | Rule parser |
  | **AI PLAN** | Claude interpreted the words |
  | **CORE MODEL** | Computed recommendation |

## 2. Intents and slots

```ts
type Intent =
  | 'build' | 'mine' | 'move' | 'repair' | 'allocate_power' | 'prioritize' | 'explore'
  | 'transport' | 'research' | 'expand' | 'charge' | 'recall' | 'inspect' | 'prepare'
  | 'optimize' | 'cancel' | 'schedule' | 'produce' | 'build_robot' | 'urgent'
  | 'safety' | 'fix' | 'clean' | 'survive' | 'unknown';

interface Command {
  intent: Intent;
  module?: ModuleKind;            // build/move/repair target type
  count?: number;                 // "two drones", "second generator" → count/ordinal
  resource?: ResourceId | 'lowest' | 'all';
  qty?: number;                   // "mine 20 titanium"
  robot?: RobotKind;              // "send two drones" → miner by context
  robots?: number;
  direction?: 'north' | 'south' | 'east' | 'west' | 'nearest';
  near?: ModuleKind | ResourceId | 'mine' | 'base';
  system?: 'oxygen' | 'power' | 'research' | 'mining' | 'lighting' | 'production' | 'storage' | 'safety';
  over?: Command['system'];       // "prioritize oxygen over research"
  colonists?: number;             // "habitat for 6 more colonists"
  tech?: TechId;
  schedule?: { minute: number; repeat: 'daily' };
  then?: Command;
  question?: string;
}
```

### Parser examples (all covered by tests)

| Player says | Parsed |
|---|---|
| Build a second oxygen generator | build · module=oxygen · count=1 |
| Send two drones to mine titanium | mine · resource=titanium · robots=2 |
| Expand power storage | expand · system=power · module=battery |
| Move the solar panels north | move · module=solar · direction=north |
| Prioritize oxygen over research | prioritize · system=oxygen · over=research |
| Build a habitat for 6 more colonists | build · module=habitat · colonists=6 |
| Mine whatever resource we are lowest on | mine · resource=lowest |
| Fix the power problem | fix · system=power |
| Create a safe backup system | safety · system=safety |
| Repair the oxygen unit | repair · module=oxygen |
| Move batteries closer to power hub | move · module=battery · near=solar |
| Send one drone scouting east | explore · direction=east · robots=1 |
| Do whatever is most urgent | urgent |
| Prepare for a dust storm | prepare · system=power (storm) |
| Make the colony safer | safety |
| Keep everyone alive | survive |
| Scout east for titanium | explore · direction=east · resource=titanium |
| Build another storage near the mine | build · module=storage · near=mine |
| Move mining materials closer to the workshop | transport · near=workshop |
| What should we do next? | inspect (advice) |
| Research reactor technology | research · tech=reactor |
| Clean the solar panels every morning | schedule · 06:30 · then=clean |

## 3. State analysis (`analyze(state)`)

| Area | What is computed |
|---|---|
| Power | Generation now; demand now; net; battery kWh; hours of battery at current net; forecast sol balance (kWh); peak load; categories shed |
| Oxygen | Stock, capacity, production/h, consumption/h, reserve hours, leaks |
| Water | Stock, capacity, net/h, hopper ice levels |
| Stock | Inventory per resource (total and per storage), storage fill %, lowest resource vs. target stock |
| Robots | By type: idle/busy/charging/broken, average battery |
| Deposits | Known deposits per resource with distance; unexplored directions |
| Risks | Single points of failure (one O₂ generator, one battery…), damaged modules, active emergencies, forecast storms |

The analysis is shown in plan cards as **WHY** lines, for example:

> WHY: oxygen and power are current single points of failure

These are concise structured explanations drawn from the analysis, never hidden reasoning.

## 4. Planner behaviour (selected)

### build

- Pick a site:
  - near the requested anchor, otherwise the base core;
  - on flat explored ground;
  - within 10 tiles of a powered module;
  - not blocking plating;
  - scored by distance to storage and the anchor.
- Cost and power delta come from defs. Build time comes from builders available.
- Plan card: **BUILD / CHANGE LOCATION / CANCEL**. CHANGE LOCATION cycles to the next best site or lets you click a tile.

### Missing materials

- The validator computes the shortfall per resource.
- **Producible** (silica/polymer/electronics): "I can build it after we produce 2 more polymer. Want me to prioritize polymer production?" with **YES / EDIT PLAN / CANCEL**. YES creates task A (produce) and task B (build, `after: A`).
- **Raw** (iron/titanium/ice…): "We need 18 more titanium. MINER-01 can mine it (~2 min). Mine it first?"

### Research gating

"I can't build a reactor yet. Reactor technology is not researched." with **[RESEARCH COMPACT REACTOR]**. If there's no lab yet: "Build a Space Lab first?"

### mine

- **Known deposit:** choose the nearest. Count robots ("two drones" → up to 2 miners; the plan says if fewer exist).
- **No known deposit:**
  - If a scout exists: plan scouting in the stated direction first, then mining.
  - Otherwise send the miner to survey toward the strongest signal.
- `lowest` picks the resource with the worst stock/target ratio.

### Other intents

| Intent | Plan |
|---|---|
| fix power | Diagnose (deficit / night battery / shed categories / dusty panels / broken module), then the cheapest fixes in order: clean panels, shed lighting/research, build solar or battery |
| fix oxygen / survive / urgent | Ranked emergency steps built from current risks, e.g. "1. Reduce habitat occupancy 2. Shut down research lab 3. Redirect repair drone 4. Seal section 5. Restore oxygen" |
| prepare (storm) | Charge batteries (shed production now), recall drones, fill O₂ to 95 %, pause non-critical tasks, clean panels afterwards |
| safety | Backup oxygen generator, add battery storage, move emergency supplies (rations into the command module), keep a 20 % power reserve (standing rule) |
| move | Deconstruct (75 % materials physically returned to storage) → rebuild at the new site, as one task graph |
| transport | Haul stock from far storage to the storage nearest the anchor |

## 5. Validator rules (never fake)

- Costs must be in storage, or a production/mining prerequisite task is offered.
- Robot types must exist ("No scout drone yet — MINER-01 can survey slowly, or build a scout at a robot bay").
- Research must be unlocked. Stage must be reached (e.g. reactors at SETTLEMENT).
- The site must be valid at execution time. If a meteor lands on it, the task re-plans the site and says so.
- Permissions are checked against the autonomy level (§6) for CORE-initiated work. Player commands always override permissions, but MANUAL always asks for confirmation.
- A task finishes as **DONE** only when the physical end state is verified: the module is online, the qty is mined, the area is revealed. Otherwise it's **FAILED** with the reason.

## 6. Autonomy and permissions

| Level | What CORE does by itself |
|---|---|
| MANUAL | Nothing. Suggests only. Even player commands show a plan card first. Robots still recharge. |
| ASSISTED (default) | Executes player commands (confirms big ones: builds, moves, robot fabrication) and runs **standing orders** the player can see and edit. |
| AUTOMATED | + routine tasks: refill hoppers, clean panels > 30 % dust, repair damaged modules/robots, mine the lowest resource with idle miners, rebalance storage, keep production stock targets. |
| AUTONOMOUS | + manages approved systems: emergency responses, power allocation, builds solar/battery/storage when forecasts demand it, starts research by preference. |

Permission toggles (default ON except EXPAND and TRADE): **MINE · BUILD · REPAIR · TRADE · ALLOCATE POWER · RESEARCH · EXPAND**. Every CORE-initiated task names the permission it used and appears in MEMORY.

## 7. Emergencies and the response planner

Each emergency (see NEW_GAME_LOOP.md §5) raises an alert card with CORE's response plan:

```
⚠ OXYGEN LEAK — HABITAT-2      RESERVE 8 MIN
PLAN
1. Move 2 colonists to Command Module   (reduce habitat occupancy)
2. Shut down Space Lab                    (+3 kW to life support)
3. Redirect REPAIR-01 → Habitat-2         (ETA 14 s)
4. Seal section                           (leak −80 % on arrival)
5. Restore oxygen                         (O₂ generator to 100 %)
[EXECUTE]  [EDIT]  [IGNORE]
```

- At AUTONOMOUS (with REPAIR / ALLOCATE POWER permissions) CORE executes it immediately and logs it.
- The steps are generated from state: if no repair bot exists, step 3 says BUILDER-01 (slower), with the honest ETA.

## 8. Learning

### Preference model (0–100, starts at 50)

| Dimension | Moves on |
|---|---|
| safety ↔ speed | Accepting backups, "safer", keeping reserves vs. rushing builds/declining backups |
| solar ↔ reactor | What the player builds when given options |
| storage size | Building storage before it's > 80 % full |
| mining aggression | Mining commands, robots assigned to mining |
| research focus | Research vs. production choices |

Uses:

- Recommendations cite it: "You usually prioritize safety. I recommend a backup oxygen unit."
- Plan ordering and autonomy choices follow the preferences.
- MEMORY shows what CORE has learned and from which events.

### AI performance (CORE vX.Y)

All scores are computed from outcomes over the last 2 sols, 0–100:

| Score | Computed from |
|---|---|
| PLANNING | Share of plans that finished DONE; estimate accuracy (actual vs. estimated time) |
| LOGISTICS | Robot utilisation while jobs were waiting; average haul distance vs. nearest-possible |
| ENERGY | Life-support/CORE uptime (no shedding); solar forecast error |
| RESOURCE OPTIMIZATION | Time without shortage-blocked jobs; time not in storage overload |
| EMERGENCY RESPONSE | Average time from alert to resolved, penalised by colonist health loss |
| AUTONOMY | CORE-initiated tasks that succeeded × autonomy level reach |

The CORE version is `v1.(level)`. Level comes from XP for completed tasks and resolved emergencies.

## 9. Claude fallback (artifact `sample` capability)

- **Command parsing:** used only when parser confidence is below 0.6 or the intent is unknown. The prompt contains the intent schema, the enumerations above and a compact state summary. Output is JSON `{reply, commands[]}`; anything invalid is dropped.
- **Lab talk:** "How do we survive longer dust storms?" Claude gets the tech list with real effects and returns `{reply, techIds[]}`. The game then shows those techs' real costs and effects.
- **No Claude:** the keyword fallback still works, and the UI says so.
