# Lane Siege

Competitive lane-defense game for mobile. Up to 4 players, each defending their
own lane against identical waves, spending a second currency to send extra
monsters at each other. Last fortress standing wins.

**[DESIGN.md](DESIGN.md) is the source of truth.** This repository implements
it.

## Status

**M1 through M5 complete** (DESIGN.md §17).

- `npm run dev` — a playable match in portrait. Pick one of four builders, then
  four lanes with scripted opponents on the other three rosters. Build, upgrade
  in place, buy global tech, upgrade the fortress, pick a weapon type and an
  aura, and send monsters at whichever opponent is doing best.
- `npm run server` then `?server=ws://localhost:2567` — the same match against
  three other people, with the server deciding everything.
- `npm run sim` — the simulation headless, text output only, with a scripted
  player. `npm run sim -- --waves 25` plays a full match.

216 tests, plus four measurement harnesses that are part of how this is
developed rather than extras: `npm run netcheck` (the networked path over real
sockets), `npm run wire` (frame sizes at the §15.3 load), `npm run routing`
(movement, which is the weak spot — see [docs/PATHING.md](docs/PATHING.md)) and
`npm run builders` (all four rosters against identical waves).

Two things are knowingly unfinished:

- **Balance is not playtested.** All four rosters survive to about wave 25
  against the scripted player, which almost certainly means the curve is too
  soft — §5.5 targets a first elimination around wave 13–15. Every number lives
  in `data/`, so tuning is a JSON job: `npm run builders` shows where each
  roster currently leaks.
- **Movement works but does not look good.** Ten approaches, what each measured,
  and what to try next are in [docs/PATHING.md](docs/PATHING.md).

Next is M6: Capacitor's Android build, a lobby, matchmaking and accounts — and
somewhere to host the server, which is what a four-player match needs today.

## Getting started

```bash
npm install
npm run dev        # Vite dev server; open the printed URL on a phone or in a browser
npm run sim        # headless simulation, text output only
npm test           # vitest
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run build      # production build into dist/
```

Node 20.19+ or 22.12+.

### Playing against other people

```bash
npm run server     # authoritative Colyseus room on :2567, up to 4 players
npm run dev        # then open the URL with ?server=ws://localhost:2567
```

The room starts when it is full, or after 20 seconds with whoever has turned up;
any lane nobody took is played by a scripted builder. Without `?server=` the
game is a practice match simulated in the browser — which is what the deployed
build serves, since GitHub Pages is static and cannot host a room.

## Layout

```
data/          balance data as JSON. No numbers live in code (DESIGN.md §16).
src/sim/       the simulation. Pure: no Pixi, no DOM, no wall clock, no Math.random.
src/data/      types for data/, a loader, and a validator that reports gaps.
src/render/    everything Pixi. Reads simulation state, never mutates it.
src/render/ui/ HUD, build bar, opponent tabs, toasts — the touch layer.
src/net/       the transport seam, the wire format, and the two transports.
src/bot/       the scripted player: the headless harness, and practice opponents.
src/util/      the fixed-timestep accumulator, shared by client and server.
server/        the authoritative Colyseus room. Imports src/sim unchanged.
src/headless/  text-only runners and measurement harnesses.
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
server runs the identical module. That one decision is what buys
cheat-resistant multiplayer, deterministic replays, desync detection and
headless balance runs, so it is enforced mechanically — `src/sim/purity.test.ts`
fails the build if anything under `src/sim/` imports Pixi, touches the DOM,
reads the wall clock or calls `Math.random`. Clients are never handed state,
only the filtered view of it that fog of war (§12) allows, so a client cannot
leak what it was never sent. Details in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Legal

No StarCraft II names, unit designs, artwork, sounds or text. Everything ships
original (DESIGN.md §19).
