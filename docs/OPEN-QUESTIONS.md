# Open questions

DESIGN.md's second rule: _where the document says OPEN, the decision has not
been made — do not silently invent an answer._ This is the register.

## Answered

### 1. Wave interval — how often do waves spawn? → **75 seconds**

_Was not in DESIGN.md at all._ §3.2 requires a fixed global wave clock and §3.1
gives the build phase as 30 seconds, but the clock's period was never stated.

Decided: **75s is the full cycle** — 30s build + 45s combat. 25 waves lands at
roughly 31 minutes, a little over §1's "~20–25 minutes typical" target. Enrage
begins 60s after a wave spawns, so each wave gets about 15 seconds of enrage
before the next one lands on top of it.

- Data: `waves.waveIntervalSeconds: 75`
- `validate.ts` now rejects an interval that does not exceed the build phase,
  since that would leave no combat phase at all.

### 2. Do units physically block monster movement? (§4.2) → **yes, they block**

Decided against the doc's own v1 recommendation: units _do_ block.

- Data: `lane.unitsBlockMovement: true`
- Built: `grid.ts` holds a per-lane occupancy grid, rebuilt when units change and
  never per tick (§15.3). `steering.ts` ranks eight candidate directions by how
  closely each matches the desired heading and takes the best unblocked one.
  Ties fall to straight down the lane — which is exactly the §5.3 tie-break, now
  load-bearing rather than decorative.
- Two consequences are now real rather than theoretical: a monster can be boxed
  in completely, so stuck detection is a genuine safety net; and a monster
  standing on a tile where a unit gets built is explicitly allowed to leave by
  any route, or it would be trapped there forever.

## Still open — needed before the milestone in brackets

### 3. Post-wave-25 purchases (§3.3) → **nothing can be bought**

Answered against the doc's recommendation. DESIGN.md suggested keeping tiers,
tech and fortress upgrades available so gold had a sink; decided instead that
the attrition endgame is a hard, terminating grind fought with whatever you
brought, not a last shopping trip. From wave 25 every purchase is refused:
units, tiers, tech, fortress and supply alike.

The free per-build-phase choices — the fortress weapon's damage type and the
active aura (§10.1) — still work, because they cost nothing and keep a losing
player engaging with the matrix to the end.

### 4. Is the supply cap upgrade bought with gold or gems? (§11.1)

Taking the doc's recommendation: **gold**. The ladder is in `economy.json`; the
cost field is the only thing that would change.

### 5. What exactly is publicly visible on opponent tabs? (§12) [M4]

Suggested minimum is fortress HP and alive/eliminated status, everything else
hidden. Needs settling before the spectate view is built.

### 6. The send catalogue (§18) [M4]

Which sends exist, what they cost, which grant vision. `sends.json` is empty;
`SendDef` is a first guess at the shape, and `Lane.incomingSends` is already
wired into wave spawning so sends do not need retrofitting later.

### 7. Full monster and boss bank (§18) [M3]

Five monsters exist (four normal, one boss) — the M1 slice. Note that the boss
is single-armour, where §3.4 wants bosses to carry a **mix** of armour types
across their parts or spawns so no single damage type hard-counters them. That
needs a multi-part boss model that does not exist yet.

### 8. Lobby, matchmaking, accounts; reconnection and AFK handling (§18) [M6]

### 9. Monetisation and audio (§18) [post-ship]

## Answered by transcription, not by invention

Already decided in DESIGN.md and simply written into `data/`:

- The full damage matrix (§6) — `matrix.json`
- Build zone 8×10 (§4.2), build phase 30s (§3.1), boss every 5 waves (§3.4),
  attrition from wave 25 (§3.3), lane cap 30 monsters (§8.1)
- Enrage: 60s delay, cap ~6× (§8). The **rate** of 0.03/second is derived from
  the doc's own worked example ("60 seconds in = 2.8×", and 1 + 0.03 × 60 = 2.8),
  because that formula's code block is empty in the document as supplied.
  Verified by `src/sim/enrage.test.ts`. Worth a glance to confirm.

## Design changes to DESIGN.md

Decisions that override the document rather than filling a gap in it:

- **§3.2 — there is no global wave-spawn clock.** The only global timers are the
  30s build phase and the enrage clock (§8). Combat runs until every living lane
  is empty. The original clock existed so one slow player could not hold three
  others hostage; that is now handled at the other end instead — enrage keeps
  climbing on a lane that cannot clear, and when its fortress falls the lane is
  wiped and stops receiving waves, so it cannot stall the match indefinitely.
- **§5.3 — pathing is a distance field, not greedy steering.** §5.3 explicitly
  ruled out A\*, navmeshes and flow fields. Greedy steering could not solve a
  wall with a gap in it — a measured 0 of 8 monsters got through — so a
  multi-source breadth-first distance field replaced it. A\* was considered and
  rejected as the wrong shape: many agents, few goals, so one shared sweep beats
  30 individual searches and costs 0.44% of the tick budget. The field is used
  only when line of sight is blocked; on open ground agents still walk straight.
- **§4.2 — same-kind collision is by body radius, not by tile.** Tile occupancy
  is right for monster-versus-unit, where a line of units is a wall. It is too
  coarse between entities of the same kind moving continuously: two in adjacent
  tiles could sit half a tile apart and visibly overlap, and a wave wider than
  the lane used to spawn several monsters onto the same point. Units now keep
  `unitRadius * 2` apart and monsters `monsterRadius * 2`, both matching what is
  drawn, so what you see is what collides.
- **§5.2 — defensive units are no longer permanently stationary.** A unit with
  nothing in range advances on the nearest monster until something comes into
  range, then plants and fights. It still never chases a target it is already
  engaging, so §5.2's anti-jitter guarantee is intact. `moveSpeed` is per unit in
  `units.json`; `0` restores the original stationary behaviour.
- **§3.2 — the ready button is gone.** The build phase is short enough that
  skipping it was not worth a button. Its corner of the build bar now holds the
  fortress weapon damage-type selector (§10.1).
- **§13 — an eliminated player's lane is wiped.** Their monsters are removed and
  no further waves spawn there. Without this a dead lane's leftovers would stall
  combat forever, since combat now ends only when every lane is empty.

- **§5.5 — fortress self-healing is an upgrade, not a default.** Base
  regeneration on a full lane clear is `0`. Buying it is a fortress upgrade,
  landing with the rest of them in M3. Until then chip damage is permanent and
  the fortress weapon is the only thing holding the leak death-spiral off.
- **§3.2 — the combat phase ends early when every living lane is clear.** The
  global wave clock is now "fixed unless everyone is done", matching how the
  ready button already works for the build phase. It still cannot be used to
  stall other players, since it only ever moves the clock forward.

## Invented for M1, and flagged as such

Two things the simulation needed that DESIGN.md does not cover at all:

- **Fortress armour type** (`fortress.armour: "plate"`). The matrix applies in
  both directions (§6), so a monster besieging the fortress needs something to
  resolve its damage type against. The doc gives the fortress HP, a weapon and an
  aura, but never an armour type.
- **Wave scaling factors** (`waves.scaling`). §9.1 says monster stats and count
  scale with wave number but gives no curve. These apply only past the last
  authored wave, so they are inert across waves 1–5.

Everything else numeric in `data/` is a placeholder in the doc's own sense, and
**none of it is playtested** — see the balance note in the M1 section of
[ARCHITECTURE.md](ARCHITECTURE.md).

## Note on DESIGN.md as supplied

Three fenced code blocks in the document arrived empty — the surrounding prose
survived but the code did not:

- **§5.3**, the movement/steering pseudocode. `steering.ts` is written from the
  prose and says so at the top.
- **§8**, the enrage formula. Reconstructed from the worked example, as above.
- **§16**, the JSON schemas for `matrix.json`, `units.json`, `monsters.json` and
  `waves.json`. The shapes in `data/` and in `src/data/schema.ts` are inferred
  from the stats those sections list elsewhere (§7.2, §9.1), so they are a
  proposal rather than a transcription.
