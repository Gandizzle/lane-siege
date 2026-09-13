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

### 5. What exactly is publicly visible on opponent tabs? (§12) → **fortress HP and alive-or-out, and nothing else ever**

Taking the doc's suggested minimum, and making it a hard ceiling rather than a
starting point. An opponent tab carries their fortress HP, whether they are
still alive, and their placement once they are out. That is the whole public
record.

Extended where §12 required a decision it did not state:

- **A lane you bought sight of** with a send (§11.5) shows its _contents_ — the
  units, the monsters, the fortress, the aura that is lit. Those are things
  happening in a lane, and a send is how you pay to look.
- **The balance sheet is never public.** Not gold, gems, supply, tech levels, or
  fortress upgrade levels — not with bought vision, not while spectating, not
  ever. Seeing someone's army is a tactical read that §11.5 sells you. Seeing
  their bank balance and their upgrade sheet tells you what they are about to
  do, and nothing in §11 or §12 offers a way to earn that.
- **An eliminated player sees every lane's contents**, because §13 says they may
  stay and spectate, and there is nothing left to protect from someone who can
  no longer send (§13, no kingmaking).

The rule is one function, `viewFor` in `src/sim/view.ts`, and it runs in single
player too — so it is exercised by every game rather than only the networked
one. A view is a projection rather than a filtered reference into live state, so
a field added to `Team` or `Lane` next month cannot silently become visible; one
test asserts the opponent record's keys exactly.

### 6. The send catalogue (§18) → **five sends, escalating**

`sends.json` now holds Swarm Probe, Grub Pack, Plated Push, Ward Raid and Bloat
Drop. Placeholders like every other number, but coherent ones:

- Income is sized against **unit prices**, not against the gem cost, because the
  two currencies are not interchangeable. Grub Pack at 10 gold a wave buys a 40g
  hammer in four waves and is noise by wave 14 — which is §11.5's stated arc,
  "clearly correct before wave 10, clearly a weapon after wave 14".
- The cheap probe and the expensive raid grant vision; the bread-and-butter
  sends do not. So sight is a thing you pay for rather than a side effect of
  attacking.
- Sends close at wave 25 with every other purchase (§3.3, decided above), since
  a send costs gems and is therefore a purchase.

### 7. When is a builder chosen? → **before the match, and fixed for it**

_Not in DESIGN.md at all._ §7.1 gives four builders of six units and §6.1 makes
each one a complete package, but nothing says how a player ends up with one.

Decided: picked before the match starts, and unchangeable once anything is on
the board. Mid-match switching would mean either stranding the units already
placed or letting a player cherry-pick the best unit of each roster — and
cherry-picking deletes the §6.1 choice, which is the whole point of having
builders differ by distribution rather than coverage. §7.3's tier upgrades and
§11.4's supply budget are both long-run commitments to a roster besides.

- Built: a picker before the match; `Lane.builderId`; `placeUnit` refuses
  another builder's unit with `wrong-builder`, in the simulation rather than in
  the UI (§15.1). `setLaneBuilder` lets the server seat a joiner's choice, and
  refuses once the lane has anything on it.
- The three scripted lanes take the other three rosters, so a practice match
  shows all four on the board.

### 8. Two rosters needed structural correction, which is not the same as tuning

Recorded because it looks like balance and is not. `npm run builders` played all
four against identical waves; Verdance and Tidemark were eliminated every run
while Bastion and Ashfall never leaked. Two of the causes were structural:

- **Tidemark paid more supply per point of value than Bastion.** Supply is a
  hard cap (§11.4), so "fewer, stronger units" landed as "less army" — strictly
  worse, not a trade. One supply came off each of its units.
- **Verdance's tank took 1.5× from Impact**, which is what most early waves
  deal. A tank countered by the commonest damage type is not a tank; it is now
  flesh-armoured, one supply class down, with HP cut to match.

The third cause was the measuring instrument. The scripted player built one
fixed line whatever the wave, so each roster's result was really a statement
about the wave order — and it never built a tank at all, because a 700 HP wall
loses a damage contest to everything. It now picks each row against the incoming
wave using the same §9.3 preview a human gets, and scores the front row on how
much of that wave its armour turns away (§4.1: front line to absorb). All four
rosters then survive; Tidemark is the most fragile, which is its identity.

**The curve is still soft for everyone** — nothing leaks before wave 25, where
§5.5 wants a first elimination around 13–15. That is the balance pass, still
deferred.

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

### 9. Full monster and boss bank (§18) [M3]

Five monsters exist (four normal, one boss) — the M1 slice. Note that the boss
is single-armour, where §3.4 wants bosses to carry a **mix** of armour types
across their parts or spawns so no single damage type hard-counters them. That
needs a multi-part boss model that does not exist yet.

### 10. Lobby, matchmaking, accounts; reconnection and AFK handling (§18) [M6]

### 11. Monetisation and audio (§18) [post-ship]

## Answered by transcription, not by invention

Already decided in DESIGN.md and simply written into `data/`:

- The full damage matrix (§6) — `matrix.json`
- Build zone 8×10 (§4.2), build phase 30s (§3.1), boss every 5 waves (§3.4),
  attrition from wave 25 (§3.3), lane cap 30 monsters (§8.1)
- Enrage: 60s delay, cap ~6× (§8). The **rate** of 0.03/second is derived from
  the doc's own worked example ("60 seconds in = 2.8×", and 1 + 0.03 × 60 = 2.8),
  because that formula's code block is empty in the document as supplied.
  Verified by `src/sim/enrage.test.ts`. Worth a glance to confirm.

## Known weak spot: movement

**Movement works but does not look good, and will need another pass.** It has
taken more attempts than anything else here and is still the weakest thing to
watch: crowds arrive in a clump rather than fanning out, the last unit or two
never find a place, and bodies at contact never quite come to rest.

This is deliberately recorded rather than quietly carried. Every approach tried,
what each one measured, the seven problems that remain and the candidates for
the next attempt are in [PATHING.md](PATHING.md), and `npm run routing`
reproduces the numbers. Nothing downstream depends on the current approach
beyond `advanceUnit` and `monstersAct` in `src/sim/tick.ts`, so replacing it
later is a contained change.

## Design changes to DESIGN.md

Decisions that override the document rather than filling a gap in it:

- **§3.2 — there is no global wave-spawn clock.** The only global timers are the
  30s build phase and the enrage clock (§8). Combat runs until every living lane
  is empty. The original clock existed so one slow player could not hold three
  others hostage; that is now handled at the other end instead — enrage keeps
  climbing on a lane that cannot clear, and when its fortress falls the lane is
  wiped and stops receiving waves, so it cannot stall the match indefinitely.
- **§5.3 — pathing is a sub-tile Dijkstra field, not greedy steering.** §5.3
  explicitly ruled out A\*, navmeshes and flow fields. Greedy steering could not
  solve a wall with a gap in it — a measured 0 of 8 monsters got through, and 1
  of 8 units once tangent steering was added — so a multi-source Dijkstra field
  replaced it. A\* was considered and rejected as the wrong shape: many agents,
  few goals, so one shared sweep beats 30 individual searches. Cells are a
  quarter tile (`lane.pathSubdivision`) and obstacles are inflated by the
  mover's kind radius, so free space is where that body's centre may legally be
  and every route offered has real clearance. Whole tick: 1.65% of the budget,
  up from 0.50%. The field is used only when something is in the way; on open
  ground agents still walk straight at their target.
- **§5.3 — the field routes, local steering arrives.** The field and tangent
  steering are complementary rather than alternatives. The field is global and
  solves the wall (1 of 8 units through, to 7 of 8); tangent steering handles
  what it hands back — the last two tiles to a slot, and units the field has no
  clear cell to offer at all. Letting the field steer all the way in points
  every attacker at the same body and undoes the slots (6 of 8 in contact with
  the handover, 3 without). Two consequences worth naming: inflation is per
  _kind_, so a boss can be offered a route it does not quite fit and falls back
  on local steering there; and the give-up-and-park rule applies to local
  steering only, since a unit on a global gradient cannot orbit, and parking one
  that was mid-detour froze it for the rest of the fight.
- **§5.1/§5.2 — attackers take approach slots around a target.** Rather than all
  walking at the target's centre, each takes its own position on a ring around
  it, so a group surrounds rather than forming a queue. Reactive alternatives
  (vetoing blocked directions, deflecting away from neighbours) were both built
  and both oscillated; the numbers are in ARCHITECTURE.md.
- **§5.1 — `range` is measured edge to edge.** A melee value near zero means
  walking up until the bodies touch. Centre-to-centre range left attackers a
  full body-width short of their target.
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
