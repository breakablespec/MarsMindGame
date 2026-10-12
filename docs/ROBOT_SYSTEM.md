# ROBOT_SYSTEM.md

Robots are the colony's only physical workforce. Nothing moves, gets mined or gets built unless a robot drives there and does it, and the player can watch every step.

## 1. Robot types

| Type | Name | Move | Speed (tiles/s) | Cargo | Can do |
|---|---|---|---|---|---|
| MINER BOT | MINER-01… | ground (tracks) | 2.2 | 30 | mine, haul own cargo, scout as it travels (reveal r=3) |
| HAULER BOT | HAULER-01… | ground (wheels) | 2.8 | 40 | haul, supply hoppers, transport between storages |
| BUILDER BOT | BUILDER-01… | ground (crane arm) | 2.4 | 15 | build, deconstruct, haul (small loads), clean panels, slow repair |
| REPAIR BOT | REPAIR-01… | ground | 2.6 | 10 | repair modules and robots (fast), seal leaks, tow broken robots |
| SCOUT DRONE | SCOUT-01… | flies | 4.5 | 0 | explore (reveal r=6), survey deposits |
| MAINTENANCE DRONE | MAINT-01… | flies | 3.5 | 10 | clean panels, refill hoppers, small repairs |

The colony starts with **MINER-01** and **BUILDER-01**.

## 2. Robot state

Every robot carries the fields the brief asks for:

| Field | Meaning |
|---|---|
| `battery` | 0–100 % |
| `task` / `job` | Current task (from the task graph) and the job inside it |
| `speed` | Base type speed × efficiency |
| `capacity` | Cargo limit, shown as cargo `{res, qty}` 18 / 30 |
| `condition` | 0–100 % |
| `location` | x, y in pixels; tile derived |
| `efficiency` | `condition factor × storm factor × research bonuses × technician bonus` |

`condition factor` is 1 above 50 %, falling linearly to 0.5 at 0 %. `storm factor` is 0.6 in a dust storm. A technician adds +10 %.

### Status labels

Status strings come from the job phase:

- Mining: `MINING TITANIUM`, `RETURNING SOON` (cargo > 80 % or battery < 35 %), `UNLOADING`, `RETURNING TO CHARGE`, `CHARGING 62%`
- Construction and supply: `COLLECTING MATERIALS`, `DELIVERING`, `ASSEMBLING 64%`, `CONNECTING GRID`
- Other: `SCOUTING`, `REPAIRING HABITAT-2`, `IDLE`, `BROKEN — NEEDS REPAIR`, `PLAYER CONTROL`

## 3. Battery and charging

| Drain | Ground robot | Flying robot |
|---|---|---|
| Moving | 0.12 % per tile | 0.20 % per tile |
| Mining | 0.25 % per unit | |
| Building | 0.08 % per second | |
| Cold night (outside base plating) | +50 % | +50 % |

**Return threshold:**

- A robot returns to charge when its battery would not cover the trip to the nearest free charger plus 10 %. The default trigger is 25 %.
- Cargo is dropped off first if storage is on the way.

**Chargers:**

| Charger | Pads |
|---|---|
| COMMAND MODULE | 2 |
| ROBOT BAY | 4 |
| MINING OUTPOST | 2 |

A pad charges 5 % per real second and draws 2 kW (CHARGING category). If CHARGING is shed, robots wait on the pad.

A robot at 0 % battery stops dead and needs a tow:

- A REPAIR or BUILDER bot drives to it and carries a charge pack, restoring +30 %.

## 4. Condition and breakdowns

**Wear:**

- −1 % per 60 tiles driven.
- −0.1 % per unit mined.
- ×3 during dust storms.
- Solar storm: −0.5 %/game min while outside base plating.

**Breakdowns:**

- Below 35 % condition there is a 1 %-per-game-minute breakdown chance. Predictive Maintenance research cuts this by 70 %.
- A robot also breaks at 0 %.
- Random robot-breakdown emergencies can hit robots in bad condition.

A broken robot stops where it is and keeps any cargo. CORE raises **ROBOT BREAKDOWN** and assigns a REPAIR bot, or a BUILDER at 40 % speed. Repair runs at 5 %/s (builder 2 %/s) up to 100 %.

## 5. Jobs, tasks and assignment

### Task graph

A **task** is what the player or CORE asked for, e.g. TASK #18 · BUILD OXYGEN GENERATOR. It holds **jobs**, the assignable units of work:

| Job | Fields | Done by |
|---|---|---|
| `haul` | resource, qty, from (storage), to (site / module hopper / storage) | HAULER > BUILDER > MAINT > MINER |
| `build` | site | BUILDER (several can share) |
| `connect` | site → nearest grid module (cable/pipe stage) | BUILDER |
| `mine` | deposit, target qty (or "until stopped") | MINER |
| `scout` | waypoints (A\* route along a direction) | SCOUT > MINER |
| `repair` | module or robot | REPAIR > BUILDER > MAINT |
| `clean` | solar arrays | MAINT > BUILDER |
| `deconstruct` | module (for "move", refunds 75 % physically) | BUILDER |
| `recall` | → nearest pad / inside base | any |
| `charge` | → pad | any |

Jobs carry `after: jobId[]`. For example, build waits for every haul to arrive, and connect waits for build. Tasks carry `after: taskId[]`, so "build the oxygen generator after 2 polymer are produced" is a real dependency.

### Robot assignment

The dispatcher runs every 0.25 s:

1. Collect open jobs whose dependencies are met, ordered by task priority (EMERGENCY > PLAYER > ROUTINE) then age.
2. For each job, pick the best idle-capable robot: `score = distance + 30·(1 − battery/100) + 200·(wrong type preference) − 50·(already on this task)`. Robots below the return threshold are excluded.
3. Haul jobs larger than a robot's cargo are split into several trips, possibly by several robots.
4. Players see the assignment on the task card ("Assigned: BUILDER-01, HAULER-01") and as dotted paths in the ROBOT PATHS overlay.

A robot keeps its job until it is done, interrupted by low battery (the job re-opens), broken, or recalled.

### Standing orders

Standing orders exist at the start, are visible and editable in CORE › TASKS:

- **Keep oxygen generator hoppers above 8 ice** (haul).
- **Keep miners on the assigned deposit** (MINER-01 → iron vein). This lets a miner work continuously while the colony needs that resource.

AUTOMATED and AUTONOMOUS add CORE-initiated routine tasks (clean panels, repair, rebalance storage, mine the lowest resource). See AI_COMMAND_ARCHITECTURE.md §6.

## 6. Physical work, step by step

### Mining run (MINER-01 → titanium)

1. Path to the deposit's adjacent tile (A\*).
2. Mine: the drill arm animates with sparks, ore chips pop out, cargo ticks up and the deposit shrinks.
3. When full (or battery is low), return to the nearest storage with room (or a MINING OUTPOST) and **UNLOAD**. Crates fly into the module and the storage count rises.
4. Repeat until the target qty is reached or the deposit is empty.

### Construction (BUILDER-01 → oxygen generator)

1. **COLLECTING MATERIALS**: drive to storage, load titanium (the cargo icon shows on the robot).
2. **DELIVERING**: drive to the blueprint and drop it. A crate pile grows on the site and the site's delivered counters fill.
3. Repeat until every material has been delivered. A second builder or hauler shares trips.
4. **ASSEMBLING**: foundation (0–33 %) → frame (33–66 %) → cladding (66–100 %), each drawn differently, with sparks and clicks.
5. **CONNECTING GRID**: a cable crawls to the nearest powered module. Oxygen and habitat modules also get a pipe to the oxygen network.
6. **ACTIVATE**: lights come on, the module starts producing and the result floats up, e.g. "OXYGEN CAPACITY +44 %" (computed from before/after).

## 7. DRIVE mode (manual control)

1. Select a ground robot and press **DRIVE** (or D in the inspector).
2. WASD/arrows steer it. The camera follows.
3. **E** performs the contextual action on the tile ahead: `E — MINE ICE`, `E — UNLOAD (STORAGE-1)`, `E — LOAD TITANIUM`, `E — BUILD (SITE 42%)`, `E — REPAIR`, `E — CLEAN PANELS`.
4. ESC returns the robot to CORE. Battery and condition rules still apply.

## 8. Inspector

Click a robot to open its inspector:

```
MINER-03                       [DRIVE] [RECALL] [FOLLOW]
CURRENT TASK   Mining Titanium (TASK #22)
PROGRESS       64%   ██████░░░
CARGO          18 / 30 TITANIUM
BATTERY        48%   ████▌
CONDITION      91%
EFFICIENCY     0.94
STATUS         RETURNING SOON
```

## 9. Visual language

- Each type has a distinct silhouette and colour:

  | Robot | Look |
  |---|---|
  | Miner | Orange with a drill |
  | Hauler | Grey flatbed; stacked crates show its load |
  | Builder | Yellow with a crane arm |
  | Repair | White with a cyan wrench |
  | Scout | Small quadcopter with a shadow |
  | Maintenance | Cyan hover-disc with a brush |

- Robots have a 4-frame drive animation, a work animation, headlights at night, a battery pip above them when below 30 %, and a red "!" when broken.
- Dust puffs trail ground robots. Flying drones cast a moving shadow.
