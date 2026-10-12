# ART_DIRECTION_SPACE.md

**Mood:** Escapists-like readability × Mars colony management × retro NASA × industrial sci-fi × pixel strategy.

**Not:** dark generic cyberpunk, purple SaaS, muddy brown, over-realistic, or sterile grey everywhere.

## 1. Palette

| Role | Main | Dark | Light | Use |
|---|---|---|---|---|
| MARS ORANGE | `#e8743b` | `#b4532a` | `#f6a66a` | Ground, dust, UI accent |
| DUST RED | `#b8362a` | `#7d2219` | `#d8584a` | Rocks, ridges, crater shadow |
| SPACE BLACK | `#110d18` | `#07050b` | `#2a2236` | Ink outlines, fog, night sky, terminal |
| OXYGEN CYAN | `#2fe0e8` | `#1495a8` | `#b8fbff` | Oxygen tanks, pipes, O₂ UI |
| POWER YELLOW | `#ffcc2e` | `#d48f12` | `#fff0a0` | Solar panels, cables, power UI |
| AI GREEN | `#4dff7a` | `#1fae4a` | `#c8ffd6` | CORE, AI core glow, CORE text, online pips |
| TITANIUM GREY | `#9aa3b5` | `#5d6578` | `#e3e7ef` | Structures, plating, robots |
| ALERT RED | `#ff3b3b` | `#c01a2a` | `#ffb3b3` | Warnings, broken, leaks |
| ICE BLUE | `#8fd4ff` | `#4b9ad6` | `#e2f6ff` | Ice deposits, water, cold nights |

**Support colours:**

| Colour | Hex | Use |
|---|---|---|
| Habitat cream | `#f6ead2` | Habitats |
| Robot-bay orange | `#ff8a1f` | Robot bay, miners |
| Builder yellow | `#ffb21f` | Builders |
| Iron rust | `#c4552c` | Iron ore |
| Rare gold | `#ffd36b` (+ `#d9a3ff` sparkle) | Rare minerals; tiny accents only |

Green appears only on the AI (CORE glow, online lights). The greenhouse is the one later exception.

## 2. Pixel rules

- Tile 16 px. Integer scaling only (2×–5×). Scale is chosen from the viewport and can be zoomed in or out one step.
- Top-down with a 3/4 tilt: structures show a roof plane and a short front wall, like the earlier buildings.
- 1 px **SPACE BLACK outline** on every module, robot and deposit. Terrain features use a dark-shade edge instead of black, so the base pops against the ground.
- Light from the top-left: highlight on top and left edges, shade on the bottom and right.
- No anti-aliasing and no gradients except the night/storm overlays.

## 3. Terrain

| Terrain | Look |
|---|---|
| FLAT dust | Mars orange with 3-tone dither speckles and faint wind ripples (light streaks) |
| ROUGH | Same base with scattered pebbles (dark red dots) |
| ROCK | Chunky dust-red boulders with a light top face and a black-ish shadow on the south side |
| RIDGE / MESA | Dust-red with a stepped cliff face |
| CRATER | Elliptical bowl: dark inner shadow on the north half, light rim on the south, a few rocks |
| DUNE / regolith field | Pale tan wave bands |
| ICE patch | Ice-blue cracked plates with white glints |
| UNSTABLE | Dark cracks plus a hazard tint |
| PLATING (base floor) | Titanium grey panels with seams and yellow/black hazard edging at the base perimeter |
| LANDING PAD | Dark circle with a yellow ring, a white H-mark and blinking edge lights |
| FOG | SPACE BLACK with a 2-px dither fringe; a faint grid shows mapped-but-dark areas on the minimap |

## 4. Modules

Every module must be identifiable by silhouette and colour alone:

| Module | Look | Animation |
|---|---|---|
| COMMAND MODULE 3×3 | Cream hull, orange NASA stripe, central dome, dish antenna, windows | Dish rotates, window lights flicker |
| AI CORE 2×2 | Black monolith tower with a **pulsing AI-green ring** and eye | Pulse speed rises when CORE is thinking |
| HABITAT 3×2 | Cream/white pressurised capsule, round windows, airlock on the side | Airlock opens when colonists pass; windows lit at night |
| OXYGEN GENERATOR 2×2 | **Two cyan tanks** plus pipework; fill level visible in the tank glass | Bubbles rise when producing; ice hopper shows ice |
| SOLAR ARRAY 2×2 | **Yellow-framed** dark-blue panels on struts | Glint sweeps across; dust shows as orange haze over the panels |
| BATTERY BANK 2×2 | Dark grey cabinets with **yellow charge bars** | Bars show the actual stored charge |
| STORAGE 2×2 | **Grey cargo blocks** | Crates stack higher as fill % rises |
| WORKSHOP 3×2 | Orange/grey industrial shed, saw-tooth roof, vent | Sparks while fabricating; conveyor belts to storage |
| SPACE LAB 3×2 | **White/blue** with dome and dish | Blue scan light while researching |
| ROBOT BAY 3×2 | **Orange** garage, roll-up door, charging pads in front | Door opens when a robot is built |
| MINING OUTPOST 2×2 | **Dark industrial** gantry with drill, red beacon | Beacon blinks |
| COMM TOWER 2×2 | Tall lattice mast, dish | Red tip light blinks |
| MEDICAL 2×2 | White with a cyan cross and red stripe | |
| WIND TURBINE 2×2 | Three-blade rotor on a mast | Spins (faster in storms) |
| REACTOR 3×3 | Concrete dome with yellow/black hazard ring | Ring glows |
| GREENHOUSE 3×2 | Glass with green plants — the only green outside the AI | |
| LANDING PAD 4×4 | See terrain | Supply shuttle lands with flame and dust |

### Construction stages

Drawn over the footprint as the build progresses:

1. **Blueprint:** cyan dashed outline with module icon and cost.
2. **Materials:** crate pile in the corner, growing per delivery.
3. **Foundation:** grey plates.
4. **Frame:** girders, yellow-black.
5. **Cladding:** partial module sprite revealed bottom-up.
6. **Online:** flash plus floater text.

### State marks

- **Damaged:** sparks, a smoke puff, a red "!" pip.
- **Unpowered:** greyed lights and a yellow ⚡ pip.
- **Leaking:** cyan vapour puffs.

## 5. Robots (≈ 14×14 sprites)

| Robot | Look |
|---|---|
| MINER | Orange body, black treads, grey drill arm |
| HAULER | Titanium grey flatbed with yellow cab; crates on the back match its cargo |
| BUILDER | Builder yellow, crane arm, orange beacon |
| REPAIR | White with a cyan cross and wrench arm |
| SCOUT | Small quadcopter (4 rotor blurs), cyan eye, drop shadow |
| MAINTENANCE | Cyan disc hover-drone with brush, drop shadow |

Shared details:

- 4 facings; a 2–4-frame drive cycle with treads/wheels stepping; a work frame per job (drill sparks, crane up/down, wrench spin).
- Headlights at night (soft cones in the light pass).
- Pips above the robot:

  | Pip | Shown when |
  |---|---|
  | Battery (yellow) | Under 30 % |
  | Red "!" | Broken |
  | Resource chip | Carrying cargo |

- Selected robot: AI-green corner brackets and a name tag.

## 6. Colonists and the shuttle

- **Colonists:** 8×12 suited figures — white suit, coloured shoulder stripe by role, gold visor. They only walk on plating, through airlocks.
- **Supply shuttle:** white/orange lander. It descends, flame first, kicks up dust rings and sits for 2 game hours.

## 7. Atmosphere and life

- **Day sky:** none (top-down); ground tone shifts warmer at noon, cooler at dawn/dusk.
- **Night:** blue-violet multiply tint (≈ 55 %). Light discs from module windows, lamps, robot headlights and the AI core glow (green).
- **Dust storm:** orange haze overlay (35–55 %), diagonal streak particles, reduced visibility vignette, rotating dust devils.
- **Ambient motion:**
  - dust devils crossing the plains;
  - drifting dust motes;
  - blinking beacon lights;
  - the AI core pulse;
  - solar glints;
  - conveyor items;
  - colonists;
  - robots;
  - the occasional meteor streak at night.

## 8. UI — retro NASA control panel

| Element | Style |
|---|---|
| Panels | Warm paper `#f3ece0` with 3 px SPACE BLACK border and hard 4 px drop shadow |
| Panel headers | Coloured by system: CORE = AI green on black, OXYGEN = cyan, POWER = yellow, ALERT = red, BUILD = orange |
| CORE output | **Terminal insets**: SPACE BLACK with AI-green text and a blinking caret |
| Fonts | **Silkscreen** for labels/readouts, **VT323** for CORE terminal text, **Pixelify Sans** for body copy |
| Top bar | Segmented gauges; O₂ and power show a bar plus a number; warnings flash red |
| Buttons | Chunky pixel buttons with a 3 px border; primary orange, CORE green, danger red |
| Plan cards | Title strip, cost chips with have/need colouring, WHY lines, BUILD / CHANGE LOCATION / CANCEL |
| Alerts | Red/yellow cards stacking on the right with CORE's plan inside |

## 9. Sound and music

**SFX (all synthesised):**

| Sound | Synthesis |
|---|---|
| Robot motors | Low pulse near the camera |
| Airlock | Filtered noise hiss and clunk |
| Solar hum | Faint sine when the camera is over arrays |
| Warning beeps | Two-tone |
| Drilling | Noise bursts |
| Wind | Continuous filtered noise, louder in storms |
| Dust storm roar | |
| Construction clicks | |
| CORE chime | |
| Others | Done, error, stage-up fanfare, shuttle rumble |

**Music layers:**

| Layer | Character | When |
|---|---|---|
| BASE | Calm arpeggio | Day |
| NIGHT | Sparse pads | Night |
| STORM | Low drone with pulses | Dust storms |
| RESEARCH | Bright arps | Lab open |
| EMERGENCY | Fast bass pulse | Active critical alert |
