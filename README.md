# Lane Siege

Competitive lane-defense game for mobile. Up to 4 players, each defending their
own lane against identical waves, spending a second currency to send extra
monsters at each other. Twenty-five waves, then a Final Showdown: the surviving
armies meet in one cross-shaped arena and fight it out. Last player standing
wins.

**[DESIGN.md](DESIGN.md) is the source of truth.** This repository implements
it.

## Status

**M1 through M6 complete** (DESIGN.md §17), except for hosting a server, which
is money rather than code.

- `npm run dev` — a playable match in portrait. Set a name, then take a practice
  match, a quick match, or a private room with a four-letter code. Pick one of
  four builders. Build, upgrade in place, buy global tech, upgrade the fortress,
  pick a weapon type and an aura, and send monsters at whichever opponent is
  doing best. While a wave is running you can watch any lane, and every attack
  animates — a projectile whose shape, size and speed come from the unit that
  fired it, or a swing for anything fighting at contact. Clear the last wave
  and the screen cuts to "Final Showdown in 3…", then to the arena: four
  spokes around a shared centre, every army standing in the formation it was
  built in, scrolled and zoomed to fit a phone. `?wave=25` starts a practice
  match at the last build phase; `?showdown=1` starts inside the arena.
- `npm run server` then `?server=ws://localhost:2567` — the same match against
  three other people, with the server deciding everything. Players gather in a
  lobby, pick rosters, and ready up; a dropped connection keeps your lane for
  ninety seconds.
- `npm run build:android` — the Capacitor Android project, from a clean clone.
  Compiling the APK needs the Android SDK, so that part happens on a machine
  with one.
- `npm run sim` — the simulation headless, text output only, with a scripted
  player. `npm run sim -- --waves 25` plays a full match.

429 tests, plus five measurement harnesses that are part of how this is
developed rather than extras: `npm run netcheck` (the networked path over real
sockets), `npm run lobby` (matchmaking, the lobby and reconnection, also over
real sockets), `npm run wire` (frame sizes at the §15.3 load), `npm run routing`
(movement — see [docs/PATHING.md](docs/PATHING.md)) and `npm run builders`
(all four rosters against identical waves).

Two things are knowingly unfinished:

- **Balance is not playtested.** All four rosters now clear 25 waves without a
  leak against the scripted player, which means the curve is too soft — §5.5
  targets a first elimination around wave 13–15, and the movement rework made
  the defence stronger by letting every unit reach the fight. Every number
  lives in `data/`, so tuning is a JSON job: `npm run builders` is the
  yardstick.
- **Nothing hosts the server.** Multiplayer works, over real sockets, between
  real browsers — but somebody has to run `npm run server` somewhere and hand
  out the address. That is the last item in §17's M6 and the only one that is
  not a code problem.

Next: a balance pass against `npm run builders`, and a host for the server.

## Getting started

```bash
npm install
npm run dev        # Vite dev server; open the printed URL on a phone or in a browser
npm run sim        # headless simulation, text output only
npm test           # vitest
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run build      # production build into dist/
npm run lobby      # matchmaking, lobby and reconnection over real sockets
npm run build:android   # web build + the Capacitor Android project
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
