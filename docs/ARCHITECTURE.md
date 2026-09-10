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

## What is implemented, and what is a stub

Implemented and tested:

- Seeded RNG and per-wave derivation (§9.2)
- The damage matrix and its row/column invariant (§6)
- Enrage: additive, capped, per-wave clocks (§8)
- Targeting rules — monsters re-evaluate on an interval, units hold their target
  until it dies or leaves range (§5.1, §5.2)
- Greedy steering and stuck detection (§5.3)
- Portrait layout and the tile↔screen transform (§4.1)
- The shape vocabulary: four silhouettes, four colours, tier pips, outline vs
  solid (§14.2)
- Data loading, gap reporting, and the builder-coverage check (§6.1)

Stubbed, with the reason marked at the call site:

- **Wave spawning** (`tick.ts:advancePhase`) — needs `waves.composition` and
  `monsters.json`, and needs the wave interval decided.
- **Command handling** (`tick.ts:step`) — commands are typed and accepted but
  not yet applied; each needs cost, supply and phase validation inside the
  simulation.
- **Unit respawn between waves** (§5.4) and the wave-25 attrition switch (§3.3).
- **Fortress regeneration on lane clear** (§5.5).
- **Auras and tech multipliers** (§7.4, §10.1) — note §15.3: recompute on
  add/remove/upgrade and on wave start, cached on the unit, never per tick.
- **Reserve queue draining** (§8.1).
- **Sends, passive income, fog of war, elimination placement** (§11, §12, §13) —
  M4 territory, but the state fields exist so they are not retrofitted.

## Stack

Per DESIGN.md §15.2. TypeScript everywhere, Pixi.js for rendering, Vite for the
build, Vitest for tests. Colyseus (multiplayer) and Capacitor (Android
packaging) are not installed yet — they arrive at M4 and M6 and would otherwise
be dependencies with nothing to do.

`vite.config.ts` sets `base` to `/lane-siege/` for GitHub Pages. Override with
`VITE_BASE` for anywhere else; Capacitor will want `./`.
