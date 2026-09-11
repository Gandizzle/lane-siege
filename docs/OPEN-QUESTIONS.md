# Open questions

DESIGN.md's second rule: _where the document says OPEN, the decision has not
been made — do not silently invent an answer._ This is the register. Nothing
here has been answered in code; where one blocks the scaffold, the blocking
point is named.

## Blocking — the simulation cannot run until these are decided

### 1. Wave interval — how often do waves spawn?

_Not in DESIGN.md at all._ §3.2 requires waves to spawn on a fixed global clock
identical for all lanes, and §3.1 gives the build phase as 30 seconds, but the
period of that clock is never stated. Without it there is no wave cadence.

- Data: `waves.waveIntervalSeconds` (`null`)
- Blocks: `tick.ts:advancePhase`, and therefore every wave after the first.

### 2. Do units physically block monster movement? (§4.2)

The doc recommends no collision for v1 — monsters target the nearest unit and
will not advance past a living one anyway — and flags it for revisiting if it
plays badly.

- Data: `lane.unitsBlockMovement` (`null`)
- Affects: `steering.ts:stepToward`. If collision is adopted, the "prefer the
  direction closest to straight down the lane" tie-break (§5.3) becomes
  load-bearing for choosing between equally good detours, and stuck detection
  starts firing in earnest.

## Non-blocking — needed before the milestone in brackets

### 3. Post-wave-25: are upgrades, tech and fortress purchases still allowed? (§3.3) [M3]

The doc recommends yes to all three: gold needs a sink, and it gives a losing
player something to do. Confirm before implementing the attrition endgame.

### 4. Is the supply cap upgrade bought with gold or gems? (§11.1) [M3]

Doc recommends gold. Noted in `economy.json` under `supply._open`.

### 5. What exactly is publicly visible on opponent tabs? (§12) [M4]

Suggested minimum is fortress HP and alive/eliminated status, everything else
hidden. Needs settling before the spectate view is built.

### 6. The send catalogue (§18) [M4]

Which sends exist, what they cost, which grant vision. `sends.json` is empty and
`SendDef` is a first guess at the shape.

### 7. Full monster and boss bank (§18) [M3]

`monsters.json` is empty.

### 8. Lobby, matchmaking, accounts; reconnection and AFK handling (§18) [M6]

### 9. Monetisation and audio (§18) [post-ship]

## Answered by transcription, not by invention

These were already decided in DESIGN.md and are simply written into `data/`:

- The full damage matrix (§6) — `matrix.json`
- Build zone 8×10 (§4.2), build phase 30s (§3.1), boss every 5 waves (§3.4),
  attrition from wave 25 (§3.3), lane cap 30 monsters (§8.1) — `lane.json`,
  `waves.json`
- Enrage: 60s delay, cap ~6× (§8). The **rate** of 0.03/second is derived from
  the doc's own worked example ("60 seconds in = 2.8×", and 1 + 0.03 × 60 =
  2.8), because the formula's code block is empty in the document as supplied.
  Verified by `src/sim/enrage.test.ts`. Worth a glance to confirm.

## Note on DESIGN.md as supplied

Three fenced code blocks in the document arrived empty — the surrounding prose
survived but the code did not:

- **§5.3**, the movement/steering pseudocode. `steering.ts` is written from the
  prose and says so at the top.
- **§8**, the enrage formula. Reconstructed from the worked example, as above.
- **§16**, the JSON schemas for `matrix.json`, `units.json`, `monsters.json` and
  `waves.json`. The shapes in `data/` and in `src/data/schema.ts` are inferred
  from the stats those sections list elsewhere (§7.2, §9.1), so they are a
  proposal rather than a transcription. Check them against what was intended.
