# Downtown Derby

**Ten pitches. One city. Bring it down.**

A mobile-first 3D arcade demolition game by HaveAnApp. You bat from a downtown rooftop while a pitcher in a hi-vis vest and hard hat, working from a construction scaffold level with your roof, throws fastballs, sinkers, sliders, changeups and curveballs. Square one up and the ball ignites into a rocket: tap **DETONATE** at the moment that does the most structural damage. Buildings are built from real load-bearing sections, so walls breach, floors fail, towers pancake and debris brings the next building down with it.

## Play

- **Drag** on the city to aim (horizontal = direction, vertical = loft, down to -14° for line drives into facades).
- Every hit takes a chunk out of the building it strikes. The size of the chunk is set by contact quality, ball speed and ball mass: a perfect swing tears out several sections across multiple floors and throws wall fragments into the street; a poor one chips a panel.
- Watch the pitcher's wind-up. **Tap SWING** as the ball crosses the plate. The timing ring fills with the pitch; the green zone is the perfect window. Early swings pull left and top the ball, late swings push right and pop it up, and far-off swings whiff or foul.
- Perfect and Solid contact arm the rocket. It ignites a third of a second after contact; tap **DETONATE** any time while it is lit. Outside a wall: a wide scar. Just inside the breach: weakened supports. Deep inside near the core: a floor fails and everything above it comes down. The warhead's charge drains with time and with every wall it punches through, so a fresh blast is the strongest and a deep one trades power for position.
- Debris from a collapse damages whatever it lands on. A collapse triggered by another building's rubble is a **chain collapse** and scores double.
- Damage persists for the whole round. Hit the same tower twice and the second shot finds a weaker building.
- Ten pitches, then a results screen, credits, and an instant **Play Again**. Taken pitches cost nothing; swings do.
- Credits unlock bats, balls and rockets in the **Garage** with real trade-offs; **Challenges** add tracked objectives such as a first collapse or a chain reaction.

Keyboard (desktop): `←` `→` aim, `↑` `↓` loft, `Space` to swing, `D` to detonate, `Enter` to continue.

## Stack

- [Vite](https://vite.dev) + TypeScript
- [Three.js](https://threejs.org) rendering, procedural textures, instanced building sections and props
- [Rapier](https://rapier.rs) (`@dimforge/rapier3d-compat`) physics with CCD for the ball, fixed cuboid colliders per building section, pooled rigid-body debris chunks
- Synthesized WebAudio sound (no audio assets)
- Vitest unit tests for the pure game logic, Playwright for full mobile-viewport rounds

## Scripts

```bash
npm install
npm run dev        # local dev server
npm test           # unit tests (vitest)
npm run typecheck  # tsc
npm run build      # typecheck + production build to dist/
npm run preview    # serve dist/ on :4173
npm run e2e        # Playwright: iPhone viewport, full ten-pitch rounds against the preview build
```

## Architecture

```
src/logic/      pure, deterministic game rules (no DOM, no three.js, no physics engine)
  round.ts      state machine (AIMING → PITCHING → SWINGING → BALL_IN_FLIGHT → …) + ball counter + round summary
  pitching.ts   pitch profiles, deterministic pitch generation (release → plate), kinematics, swing-timing judgement
  batting.ts    contact model (timing error → quality, power, spray, spin), launch velocity + spin from aim/contact/pitch
  structure.ts  structural model: cells (facade/corner/core/slab) with hit points + bearing weight, floor integrity,
                collapse evaluation (floor fails → floors above removed), blast/impact/penetration formulas, chunking
  rocket.ts     rocket catalog + fuse/burn/coast state machine, charge drain, blast power, self-destruct
  citylayout.ts procedural lots; near rows become structural specs (floors, cell counts, core), far rows are backdrop
  scoring.ts    per-shot scorer: props, building sections, collapses, chain collapses, detonations, bonuses
  equipment.ts  bats, balls, rockets · challenges.ts tracked objectives · progression.ts profile + storage
src/engine/     renderer/sky, physics wrapper, camera rig (aim/flight/overview), effects (particles, flame, blast,
                spin ring), audio
src/world/      buildings.ts (destructible city: colliders + instanced cells + lean + debris chunks + collapse),
                city.ts (backdrop + props + viaduct), pitcher.ts (mound + pitcher rig), rooftop.ts (cage + batter), props
src/game/       Game orchestrator (pitch → swing → flight → penetration/blast → settle → score → feedback) and Ball
src/ui/         DOM HUD (swing/detonate controls, timing ring, pitch readout), shot card, results, garage, challenges
```

### Destruction model

Each destructible building is a stack of floors. A floor is made of modular cells: facade panels around the perimeter, four corner columns, an optional core and a ceiling slab. Every cell has hit points by material (glass < brick < steel < concrete < slab < column) and a load-bearing weight (glass skins bear almost nothing; corners and the core carry most of it). Every impact makes a crater (`impactCrater`): radius `(2 + 9q) × speed/63 × √(mass/5)` and power `4.5 × kinetic damage × (0.3 + 0.7q)`, where `q` is 1 for perfect contact down to 0.08 for a whiff (kinetic damage is `0.0005 · mass · speed²`, times a penetrator factor for rockets). The struck cell takes full power, every cell inside the radius takes linear-falloff damage, including neighbouring buildings, and broken cells throw short-lived physical fragments. A projectile that breaks the struck cell keeps `sqrt(1 - hp/damage) · 0.92` of its speed and flies on through the hole; broken cells lose their collider and instance. Blasts apply linear-falloff damage to every cell within the radius, boosted when confined inside a building. After any damage the structure is re-evaluated bottom-up: the first floor whose remaining bearing capacity drops below the style's threshold fails, and that floor plus everything above it is removed from the model and handed back as debris chunks (pooled rigid bodies that damage what they hit). Floors just above the threshold lean visibly, shed dust and groan.

### Test hooks

`window.__derby.debug` exposes `autoSwing` (seconds relative to the perfect tap), `autoDetonate` (seconds after ignition), `autoDetonateInside`, `pitchSeed`, `renderEvery` and `fixedDt` so the Playwright suite and `scripts/flight-check.mjs` can play deterministic rounds in GPU-less containers.

## Deployment

Static site. `vercel.json` sets the Vite framework preset, build command and caching headers. The app ships a web manifest and icons so it can be added to an iPhone Home Screen.
