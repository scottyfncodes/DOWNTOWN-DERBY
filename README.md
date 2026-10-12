# Downtown Derby

**Ten swings. One city. Make them count.**

A mobile-first 3D arcade destruction game by HaveAnApp. You stand in a rooftop batting cage above a dense downtown and hit ten baseballs into the city, chaining glass, billboards, water towers, cars and rooftop machinery for the highest destruction score.

## Play

- **Drag** on the city to aim (horizontal = direction, vertical = loft).
- **Hold SWING** to wind up, **release** when the needle reaches the green zone. Early contact pulls left, late contact pushes right.
- **ADV** opens loft and spin controls (side spin bends the flight, top/back spin dives or floats).
- Impacts chain into a combo multiplier while hits keep landing. Knockdowns, shattered glass and chain reactions are worth far more than carry distance.
- After ten balls you get a results screen, credits, and an instant **Play Again**.
- Credits unlock bats and balls in the **Garage** with real trade-offs; **Challenges** add tracked objectives.

Keyboard (desktop): `←` `→` aim, `↑` `↓` loft, hold `Space` to swing, `Enter` to continue.

## Stack

- [Vite](https://vite.dev) + TypeScript
- [Three.js](https://threejs.org) rendering, procedural textures and instanced props
- [Rapier](https://rapier.rs) (`@dimforge/rapier3d-compat`) physics with CCD for the ball
- Synthesized WebAudio sound (no audio assets)
- Vitest unit tests for the pure game logic, Playwright for a full mobile-viewport round

## Scripts

```bash
npm install
npm run dev        # local dev server
npm test           # unit tests (vitest)
npm run typecheck  # tsc
npm run build      # typecheck + production build to dist/
npm run preview    # serve dist/ on :4173
npm run e2e        # Playwright: iPhone viewport, plays a full ten-ball round against the preview build
```

## Architecture

```
src/logic/      pure, deterministic game rules (no DOM, no three.js)
  round.ts      state machine + ball counter + round summary
  batting.ts    timing meter, contact quality, launch parameters
  scoring.ts    per-shot scorer: material values, combos, caps, dedupe
  equipment.ts  bats and balls
  challenges.ts tracked objectives
  progression.ts profile, credits, unlocks, storage with fallbacks
src/engine/     renderer/sky, physics wrapper, camera rig, effects, audio
src/world/      procedural city, props (instanced visuals + Rapier bodies), rooftop cage
src/game/       Game orchestrator (collision → damage → score → feedback) and Ball
src/ui/         DOM HUD, title, shot card, results, garage, challenges, settings
```

## Deployment

Static site. `vercel.json` sets the Vite framework preset, build command and caching headers. The app ships a web manifest and icons so it can be added to an iPhone Home Screen.
