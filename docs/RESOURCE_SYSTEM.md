# RESOURCE_SYSTEM.md

All numbers here are the initial tuning in `src/sim/defs.ts`. Every value the UI shows is computed from these flows; nothing is decorative.

## Time

- 1 game minute = 0.5 real seconds at 1× speed. 1 sol (24 h) = 12 real minutes.
- Speed controls: pause, 1×, 2×, 4×.
- The sun rises at 06:00 and sets at 19:00. A new colony starts at 07:00 on SOL 1.
- Flows (power, oxygen, water, production, research) are integrated **per game minute**.
- Robot movement and work run per frame in real time, scaled by game speed.

## 1. Stored resources (8)

Solids live in **storage modules**: STORAGE holds 200 units, the COMMAND MODULE holds 60. Every module keeps its own inventory, so distance matters.

| Resource | Colour | Source | Main uses |
|---|---|---|---|
| REGOLITH | dust tan | regolith fields (dunes) | storage, silica, polymer, reactor |
| IRON | rust | iron veins | most structures, robots |
| TITANIUM | steel | titanium veins (first one just outside the start fog, east) | oxygen, habitat, lab, robot bay |
| ICE | ice blue | ice deposits | water → oxygen, polymer |
| RARE MINERALS | violet-gold | far deposits, crash debris | electronics |
| SILICA | white | workshop: 2 regolith → 1 silica (30 min) | solar, lab, habitat |
| POLYMER | orange-white | workshop: 1 ice + 1 regolith → 1 polymer (40 min) | oxygen, habitat, batteries |
| ELECTRONICS | green PCB | workshop: 1 rare + 1 silica → 2 electronics (60 min) | everything powered |

### Chains (V1, deliberately short)

```
ICE ──(oxygen generator melter)──▶ WATER ──(electrolysis)──▶ OXYGEN
REGOLITH ──(workshop)──▶ SILICA ──▶ solar arrays, labs (the "glass" step)
ICE + REGOLITH ──(workshop)──▶ POLYMER
RARE + SILICA ──(workshop)──▶ ELECTRONICS
IRON, TITANIUM ──▶ used directly as metal / structural stock
```

The brief's metal-parts and structural-parts steps are folded into IRON and TITANIUM for V1. Adding them later is one recipe each.

### Starting stock

This reproduces the brief's example exactly:

| Location | Contents |
|---|---|
| STORAGE-1 (150/200) | iron 45, titanium 53, regolith 30, ice 22 |
| COMMAND MODULE (59/60) | silica 24, **polymer 18**, **electronics 14**, rare 3 |

"Build a second oxygen generator" needs 40 titanium, 20 polymer and 10 electronics. The colony is therefore 2 polymer short, and CORE answers "I can build it after we produce 2 more polymer."

## 2. Fluids and gases (colony-wide, held in module tanks)

| | Capacity (per module) | Start |
|---|---|---|
| OXYGEN | command 40 · habitat 60 · oxygen generator 80 | 130 / 180 (72 %) |
| WATER | command 50 · oxygen generator 40 · habitat 20 | 84 / 110 |
| RATIONS | command module locker (no cap) | 40 |

### Oxygen generator

- Has an **ice hopper** (20 ice). Robots refill it physically: a standing order routes ice from storage when the hopper drops below 8.
- **Melter**: 1 ice → 3 water, at up to 2 ice/h, while the water tanks are below 90 %.
- **Electrolysis**: 1.5 water/h → 6 O₂/h while powered and oxygen isn't full. Draws 4 kW (plus 0.5 kW for the melter).

### Consumption

| Consumer | Oxygen | Water | Rations |
|---|---|---|---|
| Colonist | 1.0 O₂/h | 0.25 water/h | 1 per sol, eaten at 00:00 |
| Damaged habitat (leak) | 5 O₂/h × (1 − hp) × 2 | | |

### Oxygen reserve

- `reserveHours = O₂ / max(0.01, consumption − production)`. It is shown in real minutes when it drops under 2 game hours ("OXYGEN RESERVE · 11 MIN").
- Warnings at 30 % and 15 %, then CRITICAL.

### Colonist health

| Condition | Health change |
|---|---|
| No oxygen | −12 /h |
| No water | −4 /h |
| No rations | −2 /h |
| Otherwise | +3 /h (+8 with a staffed MEDICAL module) |

A colonist at 0 health is lost: logged in history, survival score falls. If every colonist is lost, the colony ends.

## 3. Power (kW, kWh)

### Generation

| Source | Output |
|---|---|
| SOLAR ARRAY (2×2) | 14 kW peak × sun(t) × (1 − panel dust) × weather × research |
| WIND TURBINE (research) | 3 kW, ×2.5 during dust storms |
| REACTOR (research) | 35 kW constant |
| GEOTHERMAL TAP (research, on a vent) | 12 kW |

`sun(t) = sin(π · (h − 6) / 13)` for 06:00–19:00, otherwise 0.

**Panel dust** builds up 6 %/sol in clear weather and 40 %/sol in a storm. MAINTENANCE drones, builders or a "clean the panels" command remove it.

### Battery

BATTERY BANK (2×2) stores 120 kWh and charges/discharges at up to 30 kW each. The colony starts with one bank at 90 kWh.

### Demand

| Consumer | kW | Category |
|---|---|---|
| Command module | 1.5 | CORE |
| AI core | 1.5 | CORE |
| Comm tower | 1.0 | CORE |
| Habitat | 1.0 + 0.2/colonist (+1.0 on cold nights) | LIFE SUPPORT |
| Oxygen generator | 4.0 (+0.5 melter) when running | LIFE SUPPORT |
| Medical | 1.0 (+1.5 while healing) | LIFE SUPPORT |
| Charging pad | 2.0 per robot docked | CHARGING |
| Workshop | 3.0 while fabricating | PRODUCTION |
| Robot bay | 0.5 + 3.0 while building a robot | PRODUCTION |
| Mining outpost | 0.5 | PRODUCTION |
| Greenhouse | 2.5 | PRODUCTION |
| Lab | 3.0 while researching | RESEARCH |
| Storage | 0.2 | CORE |
| Landing pad | 0.3 | LIGHTING |
| Base lighting | 0.1 per module at night | LIGHTING |

### Priority shedding

Categories are ranked; the default order (protected first) is:

1. LIFE SUPPORT
2. CORE
3. CHARGING
4. PRODUCTION
5. RESEARCH
6. LIGHTING

Each minute: `available = generation + min(battery, 30 kW·h)`. If demand exceeds it, CORE switches off whole categories from the bottom of the list until demand fits. Those modules show **UNPOWERED** and an alert names what was cut.

The player (or CORE) can reorder categories and set any category to ON / AUTO / OFF:

- **"Prioritize oxygen"**: LIFE SUPPORT goes to the top, and RESEARCH, LIGHTING and optional mining are set to *hold until oxygen > 60 %*.
- **"Prioritize oxygen over research"**: only those two are swapped.

The POWER panel tracks generated, used, battery, peak load (max demand this sol) and uptime %.

### The starting balance

The colony is designed to run slightly short of power:

- Two arrays give ~232 kWh/sol against ~300 kWh/sol of demand.
- The battery fills by evening, but late in night 1 PRODUCTION and LIGHTING are shed.
- That is CORE's first real recommendation: "build a third solar array or a second battery". Oxygen is never at risk on night 1.

## 4. Deposits

Deposits are physical nodes on the map. Their amount is visible only once explored.

| Deposit | Units | Mining time per unit (base miner) |
|---|---|---|
| Regolith field | 400 | 1.6 s |
| Iron vein | 220 | 2.0 s |
| Ice deposit | 200 | 2.0 s |
| Titanium vein | 160 | 2.2 s |
| Rare mineral pocket | 60 | 3.0 s |
| Crash debris (salvage) | 12 electronics + 4 rare + 60 research | 3.0 s |
| Geothermal vent | — (build site) | |

- **Start map:** an iron vein, an ice deposit and two regolith fields lie inside the explored radius. A titanium *signal* (orbital survey, shown as "?") sits just beyond the fog to the east.
- **Further out:** more titanium, rare pockets, crash debris and two vents, found by scouting.

## 5. Build costs and build times

Build time is the assembly time for one BUILDER; extra builders stack at 70 %.

| Module | Size | Cost | Time |
|---|---|---|---|
| SOLAR ARRAY | 2×2 | iron 10, silica 12, electronics 2 | 25 s |
| BATTERY BANK | 2×2 | iron 15, electronics 6, polymer 4 | 30 s |
| OXYGEN GENERATOR | 2×2 | titanium 40, polymer 20, electronics 10 | 42 s |
| STORAGE | 2×2 | iron 20, regolith 10 | 20 s |
| HABITAT (4 beds) | 3×2 | titanium 25, polymer 15, silica 10, iron 10 | 50 s |
| WORKSHOP | 3×2 | iron 25, titanium 10, electronics 4 | 40 s |
| SPACE LAB | 3×2 | titanium 20, silica 15, electronics 12, polymer 6 | 50 s |
| ROBOT BAY | 3×2 | iron 30, titanium 15, electronics 8 | 45 s |
| MINING OUTPOST | 2×2 | iron 25, titanium 10, electronics 3 | 35 s |
| COMM TOWER | 2×2 | iron 15, electronics 10, titanium 5 | 30 s |
| MEDICAL MODULE | 2×2 | titanium 10, polymer 12, electronics 8 | 35 s |
| WIND TURBINE * | 2×2 | iron 12, polymer 6, electronics 3 | 25 s |
| GREENHOUSE * | 3×2 | silica 25, polymer 15, iron 10 | 45 s |
| REACTOR * | 3×3 | titanium 60, electronics 30, regolith 40 | 80 s |
| GEOTHERMAL TAP * | 2×2 | iron 30, titanium 20, electronics 10 | 50 s |

\* needs research.

## 6. Robots

Robots are built at the **ROBOT BAY**, which is unlocked by building one.

| Robot | Cost | Fabrication time |
|---|---|---|
| MINER | iron 20, titanium 8, electronics 4 | 60 game min |
| HAULER | iron 18, polymer 6, electronics 3 | |
| BUILDER | iron 18, titanium 6, electronics 4 | |
| REPAIR | titanium 10, polymer 6, electronics 6 | |
| SCOUT DRONE | polymer 8, electronics 6, titanium 4 | |
| MAINTENANCE DRONE * | polymer 6, electronics 4, iron 4 | |

\* needs research.

## 7. Storage rules

- **Putting:** a robot delivers to the nearest storage that already holds that resource and has room, otherwise the nearest with room.
- **Taking:** from the nearest storage that holds it.
- **Workshop feed:** the workshop pulls inputs and pushes outputs over **conveyors** to any storage within 5 tiles. Conveyors are drawn, with items visibly moving. Anything further needs a hauler.
- **STORAGE OVERLOAD:** when every storage is above 95 %, miners finish their load and wait. CORE proposes a new storage module.
- **Overflow staging:** a robot holding cargo that no storage can take sets it down as crates on the LANDING PAD (drawn as a crate pile). A standing rule moves staged crates into storage once there is room for at least 20 units.
- **Life-critical ice bypass:** if a hopper runs low and storage holds no ice, CORE mines ice straight into the oxygen generator hopper, even when storage is full.
- **"Move mining materials closer to the workshop":** a transport task where haulers move stock between storages.

## 8. Research costs

| Tier | Research points | Typical materials |
|---|---|---|
| 1 | 120 RP | 8–15 silica / electronics |
| 2 | 300 RP | 15–25 mixed |
| 3 | 600 RP | 25–40 mixed |

A powered lab makes 1 RP per game minute per assigned scientist. A second scientist adds 0.6.
