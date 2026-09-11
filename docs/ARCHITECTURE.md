# Architecture

Companion to DESIGN.md §15. This describes what the scaffold actually does and
where the seams are; DESIGN.md remains the specification.

## The core rule

> The simulation is a pure module with no rendering, no DOM, and no engine
> dependency. — DESIGN.md §15.1

Everything else follows from that. Cheat-resistant multiplayer, deterministic
replays, desync detection and headless balance sweeps are all the same property
seen from different angles: the simulation is a function, and the same function
runs on every client and on the server.

It is enforced three ways, because a rule this load-bearing should not depend on
anyone remembering it:

| Where                    | What it catches                                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `src/sim/purity.test.ts` | imports of Pixi or `src/render/`, DOM access, `Date.now`, `performance.now`, `Math.random`, and `Math.sin/cos/tan/pow` |
| `eslint.config.js`       | the same set, at edit time, as `no-restricted-imports` / `-globals` / `-properties`                                    |
| Module structure         | `src/sim/` imports only from `src/sim/` and `src/data/schema.ts` (types only)                                          |

`Math.sin`, `cos`, `tan` and `pow` are banned in the simulation because their
results are not bit-identical across JavaScript engines, which would make two
clients disagree about a monster's position and desync a match. `Math.sqrt` is
IEEE-754 exact and is fine. The renderer is under no such constraint and uses
trigonometry freely.

## Data flow

```
data/*.json
    │
    ├── src/data/loadNode.ts    (fs)     ──┐
    └── src/data/bundle.ts      (bundled) ─┤
                                           ↓
                                  src/data/validate.ts
                                   { data, report }
                                           ↓
                        ┌──────────────────┴──────────────────┐
                        ↓                                     ↓
              src/sim  (pure)                        src/render (Pixi)
              createMatch → step → MatchState  ───►  reads state, draws shapes
                        ↓
              src/headless/run.ts  (text output, balance sweeps)
```

The loader always returns both the data and a report of what is unfilled. The
report is informational in the browser and fatal in `createMatch`, which throws
`MissingDataError` listing the exact JSON paths rather than defaulting a number
into existence. A silently defaulted number is a hardcoded balance value wearing
a disguise.

## State and mutation

DESIGN.md §15.1 says the simulation "takes state + inputs, returns new state",
and §15.3 says to pool all objects and never allocate per frame. Those pull in
opposite directions — a genuinely immutable tree means reallocating it 20 times
a second per lane.

The scaffold resolves it in favour of §15.3: `step()` mutates the state in place
and returns the same reference. The signature stays the one §15.1 describes, so
callers are written the same way, but you must treat the old reference as dead
after calling. `snapshot()` gives a deep copy when you actually need history —
replays, desync comparison, tests.

Object pooling itself is not implemented yet. `Monster` and `DefensiveUnit`
already carry an `alive` flag rather than being spliced out of their arrays,
which is the shape pooling wants; the free-list goes in during M1 when there are
real spawns to pool.

## Coordinates

The simulation works entirely in **tile** coordinates. `y = 0` is the spawn
edge, `y = depth` is the fortress. The simulation has no idea how big the screen
is, and the renderer owns the single tile→pixel transform in
`src/render/layout.ts`, recomputed on boot and on resize only. The fixed camera
(§4.1, §14.1) is what makes one transform enough.

## Determinism

- One seed per match, shared by every client and the server (§9.2).
- `Rng` is mulberry32: integer-only, one uint32 of state, so a snapshot of the
  generator is a single number.
- `waveRng(matchSeed, waveNumber)` _derives_ a generator rather than advancing
  one, which is what makes wave composition a pure function of
  `(matchSeed, waveNumber)` — wave 7 is identical no matter what happened in
  waves 1 through 6, in any lane.
- The only clock is `state.tick`. Nothing reads wall time.

## Milestone status

**M1, M2 and M3 are complete.**

M1 (headless sim): `npm run sim` plays a single lane through five waves with a
scripted builder and prints the result.

M2 (renderer): `npm run dev` is a playable single-player game in portrait — tap
a unit, tap a tile, watch the wave arrive. Pixi, fixed portrait layout, coloured
shapes, touch build UI, one builder, as §17 specifies.

M3 (full single lane): all six units of builder A with tiers, global tech,
fortress and resource upgrades, gems, supply, 25 authored waves, a four-boss
bank, and the attrition endgame. §17 calls this "the point at which the game is
balanceable", and it is: every lever is a field in `data/`.

The build bar is four tabs — Build, Tech, Fort, Aura — because M3 gives the
player four distinct things to spend on and a portrait phone has one band to
spend them in.

Two OPEN questions were answered by taking DESIGN.md's own recommendation rather
than inventing one, both flagged in
[OPEN-QUESTIONS.md](OPEN-QUESTIONS.md): tiers, tech and fortress purchases stay
available after wave 25 (§3.3), and the supply cap is bought with gold (§11.1).

### How the renderer drives the simulation

The browser paints at whatever rate it likes; the simulation runs at exactly 20
ticks per second and must never see a frame time, or two phones would compute
different states and the §15.1 guarantee would be gone. `render/loop.ts` is the
accumulator between them:

```
frame (deltaMS)  ->  FixedTimestep.advance
                       |- runs whole ticks only, at most MAX_CATCHUP_TICKS
                       |- exposes `alpha`, the fraction of a tick elapsed
                       `- drops the backlog rather than spiralling
```

Two consequences worth knowing:

- **Interpolation is a rendering concern.** `EntityLayer` keeps each monster's
  previous position and lerps by `alpha`, so a 20Hz simulation draws smoothly at
  60fps. The simulation stores no such thing.
- **A long stall drops simulated time on purpose.** After a backgrounded tab or
  a GC pause, catch-up is capped and the remainder is discarded — better a match
  that skips than one that locks up. A side effect is that wall-clock
  fast-forwarding cannot be used to speed a match up in tests.

Input goes through `applyCommand` directly rather than being queued for the next
tick, so the UI can show _why_ a tap was refused. That is the same validated
path `step` uses, so a tap costs the same either way; at M4 this call becomes
the local prediction alongside a send to the server.

Implemented and tested (133 tests):

- Seeded RNG and per-wave derivation (§9.2)
- The damage matrix and its row/column invariant (§6)
- Enrage: additive, capped, per-wave clocks (§8)
- Targeting — monsters re-evaluate on an interval, units hold their target until
  it dies or leaves range (§5.1, §5.2)
- Greedy steering **with collision** and stuck detection (§5.3, §4.2)
- Wave generation as a pure function of (seed, waveNumber), boss waves, scaling
  past the authored range, and the build-phase preview (§9.1–§9.3, §3.4)
- The reserve queue and the lane cap (§8.1)
- Commands: place, upgrade in place, weapon type, aura, ready — with cost,
  supply, tile and phase validation inside the simulation (§7.3, §11.4, §3.2)
- Gold flow: kill bounties to the defender, gems per wave, passive income payout
  (§11.1, §11.6, §10.2)
- Unit respawn between waves, and its halt at wave 25 (§5.4, §3.3)
- Fortress weapon and regeneration on lane clear (§10.1, §5.5)
- Elimination and placement, including simultaneous deaths (§13)
- End-to-end determinism: same seed, same final state (§15.1)
- Portrait layout, the tile↔screen transform, and the shape vocabulary (§4.1,
  §14.2)
- Global tech, tied to damage types and cached per unit (§7.4, §15.3)
- Fortress, weapon, regen, aura and resource upgrades, bought with gems (§10)
- The supply cap as a purchase (§11.4)
- Auras: one active, radius and strength upgrading separately (§10.1)
- The attrition endgame: construction closes at wave 25, respawn stops, and
  gold keeps its sinks (§3.3)
- Fixed-timestep rendering at any frame rate, with interpolation (§15.1)
- Touch build UI: select, place, upgrade in place, ready, with rejection
  feedback (§4.1, §7.3, §3.2)
- The build-phase wave preview, its offence summary and per-unit counter hints
  (§9.3)

### Deliberate departures from DESIGN.md

Several rules were changed after playtesting, and the code says so where it
matters. The full list is in
[OPEN-QUESTIONS.md](OPEN-QUESTIONS.md#design-changes-to-designmd); the two with
the widest blast radius are:

- **The fortress does not self-heal by default** (§5.5). Regeneration on a full
  lane clear is a fortress upgrade you buy, not a freebie —
  `fortress.regenOnLaneClear.base` is `0` and `Fortress.regenPerClear` on the
  lane is what an upgrade raises. §5.5 named regen as one of two levers against
  the leak death-spiral, so until the upgrade ladder exists in M3 the fortress
  weapon is carrying that alone and chip damage is permanent.
- **The combat phase ends as soon as every living lane is clear** (§3.2). §3.2's
  concern is that a _slow_ player must not hold everyone else hostage, and this
  cannot do that: the clock only jumps forward when every living lane is already
  finished, which is the same principle the ready button applies to the build
  phase. The consequence is that the wave clock is no longer strictly fixed — it
  is fixed _unless everyone is done early_, so a skilled table moves through
  waves faster than the nominal 75s cycle.

### A word on the balance numbers

They are placeholders and **not playtested**. As it stands the lane falls around
wave 4, where §5.5 targets wave 13–15 for the first elimination. That gap is a
data problem, not a code one: §5.5 names the two levers as the fortress weapon
and lane-clear regeneration, and both are fields in `fortress.json`. Supply cap,
starting gold and the whole unit table are equally provisional.

The point of M1 is that the systems run and are provable, and that fixing the
curve is now a JSON editing job.

### Not yet built

- **Multi-part bosses** (§3.4) — a boss should carry a mix of armour types across
  its parts or spawns so no single damage type hard-counters it. The bank spreads
  four armour types across four bosses as a stopgap; real parts need a model that
  does not exist yet.
- **Opponent tabs** (§4.1, §12) — the top band carries the wave clock and
  resources instead. Tabs slot in beside them at M4.
- **Sends, fog of war, spectating** (§11.5, §12) — M4. `Lane.incomingSends` is
  already merged into wave spawning, so sends will not need retrofitting.
- **Object pooling** (§15.3) — entities carry an `alive` flag and dead monsters
  are swept on the tick they die, which is the shape pooling wants, but there is
  no free list yet. Scratch vectors and the occupancy grid already avoid
  per-tick allocation.
- **Builders B, C and D, and units 4–6 of builder A** — M5, mostly data entry.
  `bastion` has no Arcane unit, which the validator reports as a note and will
  upgrade to an error the moment its `complete` flag flips to true.

## Stack

Per DESIGN.md §15.2. TypeScript everywhere, Pixi.js for rendering, Vite for the
build, Vitest for tests. Colyseus (multiplayer) and Capacitor (Android
packaging) are not installed yet — they arrive at M4 and M6 and would otherwise
be dependencies with nothing to do.

`vite.config.ts` sets `base` to `/lane-siege/` for GitHub Pages. Override with
`VITE_BASE` for anywhere else; Capacitor will want `./`.
