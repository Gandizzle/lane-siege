# Lane Siege

Competitive lane-defense game for mobile. Up to 4 players, each defending their
own lane against identical waves, spending a second currency to send extra
monsters at each other. Last fortress standing wins.

**[DESIGN.md](DESIGN.md) is the source of truth.** This repository is the
scaffold for it: the toolchain, the module boundaries and the data files, with
the game itself still to be written.

## Status

**M1 and M2 complete** (DESIGN.md §17).

- `npm run dev` — playable single-player game in portrait. Tap a unit, tap a
  tile, watch the wave arrive.
- `npm run sim` — the same simulation headless, text output only.

94 tests cover the simulation, including an end-to-end determinism check.

The balance numbers in `data/` are placeholders and are **not playtested** — the
lane currently falls around wave 4 where §5.5 targets wave 13–15. Fixing that is
a JSON editing job, not a code change. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for what is and is not built.

Next up is M3: the full single lane — all six units of builder A, tiers, tech,
fortress and gem upgrades, 25 waves, bosses, and the attrition endgame.

## Getting started

```bash
npm install
npm run dev        # Vite dev server; open the printed URL on a phone or in a browser
npm run sim        # headless simulation, text output only (M1 harness)
npm test           # vitest
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run build      # production build into dist/
```

Node 20.19+ or 22.12+.

## Layout

```
data/          balance data as JSON. No numbers live in code (DESIGN.md §16).
src/sim/       the simulation. Pure: no Pixi, no DOM, no wall clock, no Math.random.
src/data/      types for data/, a loader, and a validator that reports gaps.
src/render/    everything Pixi. Reads simulation state, never mutates it.
src/render/ui/ HUD, build bar, toasts — the touch layer.
src/headless/  the text-only runner used for M1 and for balance sweeps.
docs/          architecture notes and the open-questions register.
```

## The two rules from DESIGN.md

**1. No hardcoded balance numbers.** Every unit stat, cost, HP value and curve
lives in `data/*.json`, so it can be edited on a phone without touching code.
`src/sim/constants.ts` holds the handful of _engine_ constants (tick rate, two
CPU-budget intervals) and explains why each is not balance data.

**2. Nothing marked OPEN gets a silently invented answer.** The unresolved
decisions are tracked in [docs/OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md). Where
one blocks code, the code says so at the point it is blocked and the data file
holds `null`, not a guess.

## Architecture in one paragraph

The simulation is a pure module: fixed 20-tick/second timestep, seeded RNG,
state plus inputs in and new state out. The renderer reads it and draws it. The
server will run the identical module. That one decision is what buys
cheat-resistant multiplayer, deterministic replays, desync detection and
headless balance runs, so it is enforced mechanically — `src/sim/purity.test.ts`
fails the build if anything under `src/sim/` imports Pixi, touches the DOM,
reads the wall clock or calls `Math.random`. Details in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Legal

No StarCraft II names, unit designs, artwork, sounds or text. Everything ships
original (DESIGN.md §19).
