<div align="center">

<img src="assets/logo.png" width="132" alt="MARS MIND logo: Mars with a glowing green AI eye">

# MARS MIND

**BUILD THE COLONY. COMMAND THE AI. SURVIVE MARS.**

A pixel-art Mars colony you run in plain language.
You give the order, **CORE** plans it, robots physically build it.

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/breakablespec/MarsMindGame)
&nbsp;
[![Follow @MarsMindGame](https://img.shields.io/badge/Follow-@MarsMindGame-0b0810?style=for-the-badge&logo=x&logoColor=white)](https://x.com/MarsMindGame)

![TypeScript](https://img.shields.io/badge/TypeScript-strict-2fe0e8?style=flat-square&labelColor=0b0810&logo=typescript&logoColor=2fe0e8)
![Runtime deps](https://img.shields.io/badge/runtime%20deps-0-4dff7a?style=flat-square&labelColor=0b0810)
![Bundle](https://img.shields.io/badge/single%20file-356%20KB-ffcc2e?style=flat-square&labelColor=0b0810)
![Tests](https://img.shields.io/badge/headless%20sim%20tests-4%20suites-4dff7a?style=flat-square&labelColor=0b0810)
![Engine](https://img.shields.io/badge/engine-Canvas%202D-ff8a1f?style=flat-square&labelColor=0b0810)

<img src="assets/core-network.gif" width="100%" alt="Night on Mars: green CORE circuits pulse from the AI core to every module while robots work">

</div>

<br>

<div align="center">
<img src="assets/core-terminal.svg" width="100%" alt="CORE terminal: the command 'Build a second oxygen generator' becomes a plan, two tasks and a new oxygen generator">
</div>

<br>

## One command, start to finish

<img src="assets/build-oxygen.gif" width="100%" alt="Typing 'Build a second oxygen generator', approving the plan, robots producing polymer, hauling titanium, assembling and switching the generator on">

Nothing appears by magic. When you ask for a second oxygen generator, CORE checks the stock, finds it is **2 polymer short**, and says so. Approve the plan and you watch every step happen on the map:

| | What happens | Who does it |
|:-:|---|---|
| 1 | Workshop turns ice + regolith into the missing polymer | Workshop, conveyors |
| 2 | Titanium, polymer and electronics are hauled to the blueprint | `BUILDER-01` |
| 3 | Foundation → frame → cladding | `BUILDER-01` |
| 4 | Cable and oxygen pipe are run to the grid | `BUILDER-01` |
| 5 | **OXYGEN CAPACITY +44% · +6 O₂/h** | the colony |

<br>

## When Mars fights back

<table>
<tr>
<td width="58%"><img src="assets/dust-storm.gif" width="100%" alt="A dust storm rolls in, the commander types 'Keep everyone alive', robots return to base and power goes to life support"></td>
<td>

**Dust storm.** Solar drops by up to 75%, robots slow down, panels get dusty.

Say **"Keep everyone alive"** and CORE builds an emergency plan from the colony's live state:

- recall robots before the storm
- top up the oxygen generator hopper
- pause lighting and research
- hold power for life support
- resume work when the sky clears

Also on the forecast: power failures, oxygen leaks, robot breakdowns, meteors, solar storms, cold nights, storage overload.

</td>
</tr>
</table>

<br>

## The numbers are real

<img src="assets/chart-life-support.svg" width="100%" alt="Small multiples over 8 sols: oxygen stored dips to 54% early then stays at 100%; battery charges every day and drains every night; solar output peaks around 41 kW each midday and drops during two dust storms">

Every value on the HUD comes from the simulation, nothing is decorative. This chart is a headless run of the same code the game ships: three commands on SOL 1, then CORE runs the colony through two dust storms. Oxygen dips while the second generator is built, then stays full. The battery fills every day and is nearly empty by dawn, which is exactly why CORE keeps suggesting another battery bank.

<br>

## How CORE thinks

```mermaid
%%{init: {'theme':'base','themeVariables':{'primaryColor':'#120d18','primaryTextColor':'#f6ead2','primaryBorderColor':'#4dff7a','lineColor':'#1fae4a','fontFamily':'monospace'}}}%%
flowchart LR
  A["💬 Your words"] --> B["Parser<br/>intent · module · resource"]
  B --> C["State analysis<br/>O₂ · power · stock · risks"]
  C --> D["Planner<br/>steps · cost · site · why"]
  D --> E{"Validator<br/>can we really?"}
  E -- "missing materials" --> F["Prerequisites<br/>produce · mine"]
  F --> D
  E -- "locked tech" --> G["Honest refusal<br/>+ the path to unlock it"]
  E -- "ok" --> H["Task graph<br/>haul → build → connect"]
  H --> I["🤖 Robots<br/>pathfinding · battery · cargo"]
  I --> J["✅ Result<br/>OXYGEN +44%"]
```

- **No fake numbers.** Costs, build times, power and the predicted effect are computed from the colony's state.
- **No faked actions.** "Build a reactor" before the research is done gets a clear no, plus the way to unlock it.
- **No hidden reasoning dump.** CORE shows a short plan: steps, cost, location and why.
- **Works offline.** A built-in parser understands the game's commands. When the page runs inside Claude, Claude can read freer phrasing too, and every answer still goes through the same validator.

<br>

## The loop

```mermaid
%%{init: {'theme':'base','themeVariables':{'primaryColor':'#1a0f08','primaryTextColor':'#fbc493','primaryBorderColor':'#e8743b','lineColor':'#e8743b','fontFamily':'monospace'}}}%%
flowchart LR
  S(["SURVIVE"]) --> M(["MINE"]) --> B(["BUILD"]) --> A(["AUTOMATE"]) --> R(["RESEARCH"]) --> E(["EXPAND"]) --> O(["OPTIMIZE"]) --> S
```

**OUTPOST → BASE → COLONY → SETTLEMENT → CITY.** Each stage unlocks new modules, harder weather and bigger shuttles.

<br>

## Modules

<img src="assets/modules-lineup.png" width="100%" alt="All modules in a row: solar array, battery bank, oxygen generator, AI core, command module, habitat, storage, workshop, space lab, robot bay, comm tower, medical module, greenhouse, reactor">

| Life support | Power | Industry | Science & growth |
|---|---|---|---|
| Habitat · Oxygen generator · Medical · Greenhouse | Solar array · Battery bank · Wind turbine · Reactor · Geothermal tap | Storage · Workshop · Robot bay · Mining outpost | Space lab · Comm tower |

Production chains are short and physical: **ice → water → O₂**, **regolith → silica**, **ice + regolith → polymer**, **rare + silica → electronics**.

<br>

## The fleet

<div align="center"><img src="assets/robots-lineup.png" width="70%" alt="Six robot types: miner, hauler, builder, repair, scout drone, maintenance drone"></div>

| | Robot | Speed | Cargo | Job |
|:-:|---|:-:|:-:|---|
| <img src="assets/sprites/robot-miner.png" width="40"> | **Miner** | 2.2 | 30 | Drills deposits and brings the ore home |
| <img src="assets/sprites/robot-hauler.png" width="40"> | **Hauler** | 2.8 | 40 | Moves materials between storage, sites and hoppers |
| <img src="assets/sprites/robot-builder.png" width="40"> | **Builder** | 2.4 | 15 | Assembles and connects modules, repairs slowly |
| <img src="assets/sprites/robot-repair.png" width="40"> | **Repair** | 2.6 | 10 | Seals leaks, fixes modules, tows dead robots |
| <img src="assets/sprites/robot-scout.png" width="40"> | **Scout drone** | 4.5 | — | Flies over terrain, clears fog, surveys deposits |
| <img src="assets/sprites/robot-maint.png" width="40"> | **Maintenance drone** | 3.5 | 10 | Cleans solar panels, keeps hoppers full |

Every robot has battery, condition, cargo, a current task and efficiency. They path around rocks and craters, return to charge, wear out, and break down. Want to do it yourself? Press **DRIVE** and steer one with WASD.

<br>

## Screens

<table>
<tr>
<td width="50%"><img src="assets/plan-card.png" width="100%" alt="ASK CORE panel with a build plan: polymer shortfall, result, location, power, time, costs, YES / EDIT PLAN / CANCEL"><br><sub><b>ASK CORE.</b> A plan card: result, cost, site, power, time.</sub></td>
<td width="50%"><img src="assets/core-power.png" width="100%" alt="CORE command centre, power tab: generated, used, battery, forecast tiles and power priority list"><br><sub><b>Command centre.</b> Power priority, forecast, sources.</sub></td>
</tr>
<tr>
<td><img src="assets/title.png" width="100%" alt="Title screen: BUILD THE COLONY. COMMAND THE AI. over a night colony"><br><sub><b>Title.</b> START COLONY or WATCH SIMULATION.</sub></td>
<td align="center"><img src="assets/mobile.png" width="46%" alt="The game on a phone"><br><sub><b>Mobile.</b> Touch, pinch-zoom, the same game.</sub></td>
</tr>
</table>

<br>

## MARS tokens

<table>
<tr>
<td width="44%"><img src="assets/quests.gif" width="100%" alt="Log in with X, four quests, each turns into +1,000 MARS, then ENTER COLONY"></td>
<td>

**Sign in with X** and complete four quests to unlock the colony. Each one pays **+1,000 MARS**:

`FOLLOW` · `LIKE` · `REPOST` · `COMMENT`

Then you keep earning by playing:

| Event | MARS |
|---|--:|
| Module built | 50 |
| Robot built | 100 |
| Research complete | 150 |
| Sol survived | 100 |
| Dust storm survived | 200 |
| New colony stage | 1,000 |
| 12 one-time achievements | 250 – 2,000 |

</td>
</tr>
</table>

<img src="assets/chart-mars-earned.svg" width="100%" alt="Bar chart: in the same 8-sol run a new player earns 7,325 MARS: 4,000 from quests, 2,000 from 5 achievements, 800 from 8 sols, 400 from 2 storms, 100 from 2 modules, 25 from 1 deposit">

### Commander card

<img src="assets/player-card.png" width="100%" alt="Commander card: handle, MARS balance, best stage and sol, stats, achievement badges, the player's colony and referral code">

Every player gets a card built from their own stats: balance, sols, modules, robots, research, storms, score, achievement badges and their colony. **SAVE CARD** and **QUOTE ON 𝕏** share it with a personal referral link.

<br>

## Run it

```bash
git clone https://github.com/breakablespec/MarsMindGame.git
cd MarsMindGame
npm install
npm run build      # → dist/index.html, one self-contained file
npm test           # headless simulation + command tests
npm run dev        # build and serve locally
```

### Go live: Sign in with X + Supabase

```mermaid
%%{init: {'theme':'base','themeVariables':{'primaryColor':'#120d18','primaryTextColor':'#f6ead2','primaryBorderColor':'#4dff7a','lineColor':'#1fae4a','fontFamily':'monospace'}}}%%
flowchart LR
  P["🧑‍🚀 Player"] -- "LOG IN WITH X" --> L["/api/auth/login<br/>PKCE"]
  L --> X["𝕏 approve"]
  X --> C["/api/auth/callback<br/>users/me"]
  C --> S[("Supabase<br/>players · quests · ledger")]
  C -- "signed cookie" --> P
  P -- "quests · events · achievements" --> A["/api/*<br/>Netlify Function"]
  A -- "rewards decided here" --> S
```

1. **Supabase:** run [`supabase/migrations/001_mars_mind.sql`](supabase/migrations/001_mars_mind.sql) in the SQL editor.
2. **Netlify:** import the repo. [`netlify.toml`](netlify.toml) builds the page and the `/api` function.
3. **X app:** OAuth 2.0, Web App, callback `https://YOUR-SITE/api/auth/callback`.
4. **Env vars:** `X_CLIENT_ID`, `X_CLIENT_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, `POST_URL`.

Step by step: **[SETUP.md](SETUP.md)**. Without the server (a plain file or `npm run dev`), the game falls back to typing an @handle and keeps everything in the browser.

<details>
<summary><b>Project structure</b></summary>

```
src/
├── sim/        pure simulation: colony state, power, life support, robots, tasks,
│               construction, logistics, research, weather, colony growth
├── ai/         CORE: parser → analysis → planner → validator, autonomy, learning
├── render/     Canvas 2D renderer, pixel sprites generated in code, lighting, fog
├── ui/         HUD, ASK CORE bar, command centre, quests gate, profile & card
├── account/    X login, quests, MARS balance, achievements, referrals (server or local)
├── audio/      synthesized sound effects and adaptive music
└── engine/     game loop, input, camera, DRIVE mode
netlify/        /api function: Sign in with X (OAuth 2.0 + PKCE), quests, rewards
supabase/       SQL: players, quests, ledger + reward functions (RLS on)
docs/           design docs: game loop, AI command architecture, robots, resources, art
tests/          headless runs: full flows, command parsing, late game, 8-sol soak
tools/          scene staging, README data and header rendering
```

</details>

<details>
<summary><b>Design docs</b></summary>

- [New game loop](docs/NEW_GAME_LOOP.md)
- [AI command architecture](docs/AI_COMMAND_ARCHITECTURE.md)
- [Robot system](docs/ROBOT_SYSTEM.md)
- [Resource system](docs/RESOURCE_SYSTEM.md)
- [Art direction](docs/ART_DIRECTION_SPACE.md)

</details>

<br>

<div align="center">
<img src="assets/banner.png" width="100%" alt="MARS MIND colony at night with green CORE circuits">

<br>

**BUILD THE COLONY. COMMAND THE AI. SURVIVE MARS.**

<sub>🔴 Made for Mars · follow <a href="https://x.com/MarsMindGame">@MarsMindGame</a></sub>
</div>
