# NEW_GAME_LOOP.md

## 1. Core loop

```
SURVIVE → MINE → BUILD → AUTOMATE → RESEARCH → EXPAND → OPTIMIZE → SURVIVE BIGGER PROBLEMS
```

| Beat | What the player does | What CORE / robots do |
|---|---|---|
| Survive | Watches O₂ / power / water, answers alerts | Sheds power, refills hoppers, proposes fixes |
| Mine | Picks what the colony needs ("mine titanium") | Miners drive out, drill, return cargo |
| Build | Describes or places modules | Builders haul, assemble, connect, activate |
| Automate | Raises autonomy, sets standing orders, builds robots | Runs routines within permissions |
| Research | Chooses or asks what to research | Lab turns materials + time into real modifiers |
| Expand | Scouts, outposts, habitats, shuttle colonists | Scouts reveal fog; shuttle brings people |
| Optimize | Moves modules, rebalances storage and power priority | Reports efficiency; AI scores improve |
| Bigger problems | Storms, meteors, solar storms scale with stage | Emergency response plans |

## 2. Sol rhythm (12 real minutes at 1×)

| Time | What happens |
|---|---|
| 06:00 | Sunrise. Solar ramps. CORE posts the **morning brief** as a non-blocking card: weather, power forecast, O₂ reserve, the top recommendation. |
| 06:00–19:00 | Production, mining, building. Solar peaks at 12:30. |
| 19:00 | Sunset. Lights on. Colonists walk back to habitats. Night power is battery only. |
| Cold nights (every ~3rd sol) | Habitat heating +1 kW each. Robots drain battery 50 % faster outside. |
| 00:00 | Sol ends. The **SOL N COMPLETE** report slides in (+titanium, +modules, repairs, power uptime, O₂ uptime). History updates. Rations are eaten. |

There is no sleeping or skipping: time runs. Speed controls are pause / 1× / 2× / 4×.

## 3. First session

| When | Target (brief §46) | How it's delivered |
|---|---|---|
| 0:00 | Loader | Mars planet, then base modules light up one by one, then "CORE ONLINE" |
| 0:05 | Title | Night colony scene with robots moving and the AI core pulsing. "BUILD THE COLONY. COMMAND THE AI." **START COLONY / WATCH SIMULATION** |
| 0:10 | World | Robots already working: MINER-01 drilling iron, BUILDER-01 hauling ice to the oxygen generator, colonists walking between modules. Top bar: OXYGEN 72 %, POWER, WATER 84, MATERIALS, CORE ● ONLINE |
| ≤ 0:30 | Understand O₂ / power / robots | CORE briefing step 1 highlights OXYGEN and POWER in the top bar; step 2 asks you to click MINER-01, which opens the inspector |
| ≤ 2:00 | First command | Step 3: "Press Q and say *Build another solar panel*." The blueprint appears and you press BUILD |
| ≤ 5:00 | First module | BUILDER-01 hauls iron, silica and electronics, assembles, connects, activates: "POWER +14 kW PEAK" |
| ≤ 7:00 | Wow #1 | Step 4: "Build a second oxygen generator." CORE: "I can build it after we produce 2 more polymer. Prioritize polymer production?" YES. The workshop produces, then robots build, connect and activate. "OXYGEN CAPACITY +44 %" |
| ≤ 10:00 | New resource | Step 5: "Send drones for titanium." The titanium signal east is confirmed, MINER-01 leaves base, mines and returns with cargo. Step 6: open the CORE panel (TAB) |

The briefing can be skipped at any point. Each step completes on a real game event, never on a "Next" button.

## 4. Wow moments

1. **"Build a second oxygen generator."** Planning → blueprint → robots collect, transport, build, connect, activate → OXYGEN CAPACITY +N %.
2. **"Send drones for titanium."** Miners assigned, route shown, drones leave base, mine, return with cargo.
3. **Dust storm + "Keep everyone alive."** CORE cuts research, recalls drones, protects oxygen, uses battery reserve, repairs damage, and shows each step live on the task card.

The first dust storm is forecast at the start of **SOL 2** for SOL 2 evening, so a first session of ~20 minutes meets it.

## 5. Environment and emergencies

| Event | Trigger | Effect | CORE response |
|---|---|---|---|
| DUST STORM | Forecast 3–6 h ahead (×2 with Storm Forecasting); from SOL 2, then every 3–5 sols; length 4–10 h | Solar ×0.25, panel dust +40 %/sol, robot efficiency ×0.6, visibility haze, wear ×3, wind turbines ×2.5 | prepare: charge batteries, recall drones, fill O₂, pause non-critical; after: clean panels, repair |
| SOLAR STORM | From COLONY stage; forecast 1 h | Robots outside plating lose condition; comm tower offline | Recall all robots inside the base; resume after |
| COLD NIGHT | ~every 3rd sol | Habitat heating +1 kW each; robot drain +50 % | Shed lighting/production early, top up battery before sunset |
| METEOR EVENT | From BASE stage; 1–3 impacts | Impact crater on terrain; hit modules take 30–70 % damage; habitats leak | Repair, seal leaks; re-plan sites |
| OXYGEN LEAK | Habitat hp < 100 % (meteor, random seal failure at low condition) | O₂ loss scales with damage | Seal: repair bot → habitat; move colonists; shed research |
| POWER FAILURE | Battery empty and life support shed, or the grid module (battery/solar) broken | Modules unpowered by priority | Shed, clean panels, build solar/battery |
| ROBOT BREAKDOWN | Condition < 35 % chance or 0 % | Robot stops | Assign repair |
| SOLAR OUTPUT DROP | Panel dust > 40 % | Solar × (1 − dust) | Clean panels |
| STORAGE OVERLOAD | All storage > 95 % | Miners wait | Build storage / stop mining |

Emergencies are real state changes. Each one is resolved when its condition clears, and its response time feeds EMERGENCY RESPONSE.

## 6. Colonists

- **Start:** 4 colonists:

  | Name | Role |
  |---|---|
  | ADA | Engineer |
  | KENJI | Scientist |
  | PRIYA | Technician |
  | OMAR | Medic |

- **Day:** they walk between habitat, command module, workshop and lab on base plating. **Night:** they sleep in habitats.
- **Needs:** oxygen, water, rations, sleep (night in a bed), safety (they shelter in the habitat during storms and meteors).
- **Role bonuses:**

  | Role | Bonus |
  |---|---|
  | Engineer | Build +15 % |
  | Scientist | Required for research; +60 % per extra scientist |
  | Technician | Robot efficiency +10 %, repair +25 % |
  | Medic | Healing ×2.5 with medical |
  | Miner | Mining +10 % |

- **Arrivals:** the SUPPLY SHUTTLE lands on the landing pad every 3 sols at 10:00 (every 2 with a comm tower). It brings +24 rations and a supply crate. Up to 2 colonists come aboard if there are free beds, oxygen net production is positive and rations > 10. Colonists walk out of the shuttle.
- Not a social sim: no relationships or moods beyond health.

## 7. Research (SPACE LAB)

Seven branches, three techs each. Every effect is a real modifier.

| Branch | T1 | T2 | T3 |
|---|---|---|---|
| POWER | High-Efficiency Solar Cells: solar +12 % | Wind Turbines: unlock (3 kW, ×2.5 in storms) | Compact Reactor: unlock (35 kW) — needs SETTLEMENT |
| LIFE SUPPORT | Efficient Electrolysis: O₂ gen +25 % | Water Reclamation: colonist water −50 % | Sealed Habitats: leaks −60 %, meteor damage to habitats −30 % |
| AUTOMATION | Smart Dispatch: robot speed +15 % | Maintenance Drones: unlock | Swarm Logic: cargo +25 %, two builders on one site at 100 % |
| MINING | Diamond Drills: mining +30 % | Deep Scanner: reveals all deposits within 22 tiles | Geothermal Tap: unlock (on vents, 12 kW) |
| CONSTRUCTION | Prefab Frames: build speed +30 % | Titanium Lattice: titanium costs −20 % | Storm Bracing: storm and meteor damage −50 % |
| AI | Predictive Maintenance: breakdowns −70 % | Storm Forecasting: storm warning ×2, auto-prep plan | CORE v2: +1 concurrent construction, autonomous expansion planning |
| HABITATION | Bunk Expansion: habitat beds 4 → 6 | Greenhouse: unlock (+4 rations/sol) | Radiation Shielding: solar storms no longer harm robots near base |

- **Materials:** carried to the lab by robots (haul job). The lab then accumulates RP while powered and staffed.
- **Talk to CORE in the lab:** "How do we survive longer dust storms?" returns Wind Turbines, Storm Bracing and Storm Forecasting, each with real costs and effects, plus **[QUEUE]**.

## 8. Progression

| Stage | Requirements | Unlocks |
|---|---|---|
| OUTPOST | start | Basic modules, robot bay |
| BASE | 12 modules · 4 robots · 1 research | Comm tower, medical, meteors begin, terrain ring 2 visible on map (scout targets) |
| COLONY | 20 modules · 8 colonists · 5 research | Mining outposts, solar storms, shuttle carries 3 colonists |
| SETTLEMENT | 30 modules · 14 colonists · 10 research · 1 outpost | Reactor research, larger storms |
| CITY | 45 modules · 24 colonists · 16 research | Everything; endgame score chase |

Stage-up is a moment: banner, sound, history entry, and CORE gains XP.

## 9. Scores

### Colony score

All parts come from real state, 0–100:

| Part | Formula |
|---|---|
| SURVIVAL | 100 − 15·deaths − time-weighted share of the last 2 sols with O₂ < 30 % or water < 20 % (×60) − colonists' missing health % (×0.4) |
| EFFICIENCY | Average robot utilisation (busy, not charging/idle) over the last sol × 100 |
| ENERGY | 0.6·uptime of CORE+LIFE categories + 0.4·min(1, battery reserve hours / 8) |
| OXYGEN | 0.5·(O₂ / capacity) + 0.5·min(1, net production margin / consumption) |
| RESEARCH | Researched techs / 21 (plus 10 for an active lab) |
| AUTOMATION | Robots (max 12) + autonomy level + standing orders |
| EXPANSION | Modules (max 45) + explored % + population |

The overall **COLONY SCORE** is a weighted average: survival ×2, oxygen ×1.5, energy ×1.5, the rest ×1.

AI performance scores are in AI_COMMAND_ARCHITECTURE.md §8.

## 10. History and reports

- **Colony history** (milestones are automatic), for example:
  - SOL 1 — First habitat online
  - SOL 1 — Colony founded
  - SOL 2 — First titanium mined
  - SOL 3 — Second oxygen generator built
  - SOL 4 — Survived major dust storm
  - Population reached 8
  - Stage BASE reached
- **SOL N COMPLETE:** resource deltas, modules built, repairs, power uptime %, oxygen uptime %, emergencies, what CORE learned.
- **While you were away:** on reload, up to 1 sol is simulated, and CORE summarises what it did.
- **Shareable colony card:** a pixel card (PNG) showing:
  - MARS MIND
  - SOL
  - POPULATION
  - MODULES
  - POWER (peak kW)
  - OXYGEN %
  - ROBOTS
  - COLONY SCORE
  - a mini render of the base
  - "BUILT WITH AI CORE"

  It can be saved or copied as text.

## 11. Screens and UI

| Area | Contents |
|---|---|
| Top bar | SOL / time · OXYGEN % · POWER ±kW · WATER · MATERIALS · AI CORE ● ONLINE · stage · speed |
| Bottom bar | BUILD · INSPECT · ROBOTS · RESEARCH · OVERLAYS, plus the persistent **ASK CORE (Q)** |
| Right | Minimap with fog, alerts, task card |
| CORE command centre (TAB) | ASK · TASKS · ROBOTS · POWER · OXYGEN · RESOURCES · BUILD · RESEARCH · MEMORY (history, preferences, AI performance, colony score, card) |
| Inspectors | Click a robot or module |
| Overlays | POWER · OXYGEN · LOGISTICS · RESOURCE · ROBOT PATHS |
