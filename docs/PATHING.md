# Pathing: the model, and how it got here

**Status: working. The crowd behaves; the numbers below are the proof.**

Movement took more attempts than anything else in the project. The first ten
were patches on a local-steering model — slots, tangent steering, side
commitment, stuck detection, give-up timers — and each fixed one measured case
while leaving the crowd looking wrong. The eleventh is a replacement, built
around two rules instead of a growing set of checks. This file describes the
model, the reasoning that led to it, the numbers it measures, and what the
earlier attempts taught. `npm run routing` reproduces every number quoted.

DESIGN.md §5.3 specifies no pathfinding at all — greedy steering, a tie-break
toward the lane, stuck detection as a fallback. That did not survive contact
with the geometry the game makes, and the deviations are recorded in
[OPEN-QUESTIONS.md](OPEN-QUESTIONS.md).

## The behaviour being aimed at

The reference is what a tank against thirty melee attackers looks like in a
well-made RTS. The attackers that can reach it stand still and hit it. The
rest wait around them. When a ring member dies, one of the waiting attackers
shifts into the gap. Nobody shivers, nobody gets stuck on anybody else, and two
attackers never jam each other out of a hole that one of them fits in.

Under the previous model every one of those sentences was false somewhere:
bodies in contact shivered, crowds arrived in a clump and pressed, the last
unit or two never found a place, and a hole in a ring was filled by whoever's
slot it was rather than whoever was nearest.

## The model

### Every body is a circle, and that circle is everything

Collision shape, hit shape and drawn size are one circle per body, with its
radius on the unit or monster definition. There are no other shapes and no
separate tile occupancy: a unit is a solid round thing a monster walks around,
not a square it may not enter. Contact between two circles is one subtraction
and one comparison, it is exact, and what you see touching is what is touching.
Range is measured edge to edge, so a melee value near zero means "touching".

One body is not a circle: the fortress. It is the same disc swept along a
horizontal segment — a wall across the end of the lane — because a wave has to
be able to bring its whole front to bear on it, and a circle wide enough for
that would be a dome bulging several tiles up into the build grid. Every
formula below takes the segment instead of the centre, which costs one clamp on
the x axis; with a segment of zero length each one is the circle arithmetic it
was, and that is what every unit and monster has.

Bodies are deliberately smaller than a tile (0.26 for units, 0.22 for monsters,
0.44 for bosses, against a tile of 1.0) so that there is room to move between
them. Monsters spawn as one packed hexagonal clump at the centre of a spawn
zone three tiles above the build grid, and cross it before the first contact.
Units and monsters may fight anywhere in the lane, spawn zone included.

### Rule one: engaged or seeking

Every body is in exactly one of two states each tick:

- **Engaged** — something is in range. It attacks, it does not move, and
  _nothing moves it_. It is an immovable obstacle to everyone, ally and enemy.
- **Seeking** — nothing is in range. It walks.

That one asymmetry is what removed the face-to-face jitter. Two bodies in
contact could only shiver if something kept nudging one of them, and now
nothing can: the moment they are in range they are both engaged, and an
engaged body is terrain. Hysteresis of 0.12 tiles on the range check stops a
target drifting across the boundary from flipping its attacker between the two
states.

### Rule two: walk downhill on a field to the nearest free attack position

A seeker follows a distance field. One multi-source Dijkstra sweep (Dial's
buckets, octile costs, integer arithmetic) labels every cell of the lane with
its distance to the nearest goal, and every seeker of the same kind, radius and
range walks downhill off the same answer. What makes it the right field:

- **Goals are attack positions, not enemies.** Around every enemy is the
  annulus of positions from which a seeker of this radius and range can hit it
  — from touching distance out to touching distance plus the range. Every cell
  that annulus passes through is a goal, _unless something is standing there_.
  So "where should I go" is answered with "the nearest free position that
  something can be hit from", and when a position is taken or freed the answer
  changes on the next sweep. That is the whole of the gap-filling behaviour.
  There is no slot assignment, no queue, no memory of who was heading where.
- **Obstacles are what will not move.** Every enemy body, every engaged ally,
  and every ally that cannot walk, each inflated by the seeker's own radius
  (the Minkowski trick), so a cell is free exactly when a body of that radius
  can stand there. Allies that are still walking are deliberately _not_
  obstacles: they will have moved by the time anyone gets there, and treating
  a moving crowd as terrain is what made every earlier attempt oscillate as the
  terrain reshuffled under it.
- **Goals are found at a finer resolution than routing.** The hole two ring
  members leave when a third dies is often narrower than a field cell yet wide
  enough for a body. So whether a cell holds a goal is decided by sampling it
  at 4 × 4 points and asking whether any of them is both in range and clear of
  every obstacle. Routing stays at cell resolution, which is where the
  clearance guarantee lives; only "is there an attack position in this cell"
  is asked more carefully.
- **When every attack position is taken**, the goals are the positions beside
  the allies that are attacking, so a body with nothing to attack waits where
  it is nearest to the next position that will free up. It stands there; it
  does not press. That is the second of exactly two cases.

Steering off the field takes only cells strictly cheaper than where the body
stands, so following it is always progress, and a body pressed against an
obstacle — on a cell whose centre is blocked but whose edge is not — reads the
cost of the free ground beside it rather than "unreachable". The alternative,
escaping to the neighbouring cell and then closing again, was a six-tick shiver
in every body pressed against a ring.

### Contact: move and slide, with priority

A seeker proposes a step, and the step is pushed out of every settled body it
would overlap — straight back along the line between centres, by exactly the
overlap, a few times over. The component of the step _into_ an obstacle is
cancelled; the component _along_ it survives. That is sliding, and it is why a
body pressed against a ring drifts round the ring rather than standing there,
with nothing anywhere that knows about tangents or sides.

Seekers move in order of how close they are to a goal, and each one resolves
against everything **settled**: engaged bodies, pinned bodies, every enemy, and
every seeker ahead of it in the order, which has already moved. It walks
_through_ the seekers behind it. When their turn comes they find it where it
now is and are pushed out of it. So the body nearest a hole takes its full step
even if a body that wanted the same hole was in its way, and that body yields —
because it moves second. Two bodies competing for one hole can only jam if
neither gives way, and here the one further away always does.

A body that yields can have nowhere clean to go for a tick. Then it keeps the
least-overlapping position it can find, which is at worst where it started, and
the next tick's push finishes the job. Overlap between two walkers can
therefore exist briefly; it can never grow, and it never involves an engaged
body, because an engaged body is never displaced and a seeker is never allowed
to end a step inside one.

### What is not here

No slot assignment, no tangent steering, no side commitment, no stuck
detection, no give-up timer, no retarget interval, no separation pass, no
tile occupancy. Each of those existed to correct a symptom of the previous
model, and with the two rules above the symptom does not arise. The movement
code is smaller than the patches it replaced (1,520 → 1,290 lines, comments
excluded), and none of it is a special case.

## Measured

From `npm run routing`. Both sides disarmed so that only movement is measured.

| case                                          | result                                                                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| thirty melee monsters on one tank             | ring of 7; 8 kills, 7 holes refilled, slowest in 16 ticks (0.8s); ring members moved 0.000; overlap 0.0012 |
| face to face for 20 seconds                   | both engaged; movement 0.000000 tiles                                                                      |
| two rows of units, target off to one side     | **6 of 8** engaged, which is the geometric maximum for these body sizes                                    |
| wall of immobile allies with a gap at one end | **8 of 8** through (was 7 of 8; 1 of 8 before the field existed)                                           |
| a monster crossing open ground                | path efficiency 99.6%                                                                                      |
| a real wave against a 3-deep block            | 8 of 8 engaged; **0.00 tiles** of movement in the last 2 seconds (was ~17)                                 |

On the one hole that did not refill: ring members are immovable and a ring
packs first come first served, so the hole one member leaves is sometimes
narrower than a body. The harness kills the member whose neighbours are
furthest apart each round, and after seven refills the remaining holes have
closed up. That is the geometry, not the pathing, and it is the price of
engaged bodies that never move — the price that buys zero jitter.

Whole tick at the §15.3 load: **1.8ms of the 50ms budget (3.6%)**, four lanes,
88 monsters and 156 units, one field per (kind, radius, range) in play.
`npm run perf` re-checks it.

## What has been tried, in order

Each row was a real implementation, measured and either kept, replaced, or
reverted. Rows 1–10 are the local-steering lineage; 11 replaced them all.

| #   | Approach                                                                         | Result                                                                                       | Fate              |
| --- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------- |
| 1   | Greedy steering per §5.3                                                         | 0 of 8 monsters through a wall with a gap at one end                                         | Replaced          |
| 2   | Veto directions blocked by a neighbour                                           | 203 tiles of wasted travel over 20s; 1 of 8 in contact                                       | Reverted          |
| 3   | Deflect away from neighbours                                                     | 266 tiles of wasted travel; still a queue                                                    | Reverted          |
| 4   | Tile-granular multi-source BFS field                                             | Solved monsters-versus-wall. Ally tiles as terrain oscillated with period two, forever       | Replaced by #9    |
| 5   | Body-radius separation, asymmetric priority, steering hysteresis                 | Path efficiency 0.57 → 0.999                                                                 | Superseded by #11 |
| 6   | Approach slots on a ring around the target                                       | Contact 1 → 4 of 8; but slots went by id, so attackers walked past free ones to reach theirs | Superseded by #11 |
| 7   | Edge-to-edge range, back a body out of what it is hitting                        | Melee gap 0.36 → 0.00 tiles                                                                  | Kept (range rule) |
| 8   | Tangent steering with side commitment                                            | Two rows: 3 → 6 of 8                                                                         | Superseded by #11 |
| 9   | Sub-tile Dijkstra field, obstacles inflated by body radius                       | Wall with a gap: 1 → 7 of 8 through                                                          | Kept, reworked    |
| 10  | Release the park when nothing is blocking                                        | A unit frozen 0.76 tiles from contact after every ally around it died now resumes            | Superseded by #11 |
| 11  | Engaged-or-seeking; field to free attack positions; move-and-slide with yielding | The table above                                                                              | **Current**       |

## What the earlier attempts taught

**Reactive schemes oscillate, and damping does not fix them.** #2 and #3 both
resolve contention by reacting to whoever is nearby. The churn is in the
priority ordering itself, which flips as the crowd shifts. What works is a
strict order that cannot contain a cycle — and in #11 that order is also what
decides who yields.

**Two different rules disagreeing about the same position is a shiver.** Every
jitter found here had that shape: the field said "step back to the free cell",
the closing rule said "step toward the enemy", and a body on the boundary
alternated between them. The fix was never damping; it was making one rule
answer the question.

**Every give-up rule became a freeze.** Gating movement on a stuck flag froze
monsters permanently; the stall-park froze units mid-detour; the park's
bests-ever baselines froze units even after the obstruction cleared. The shape
was always a state that suppresses movement, entered on a condition only
movement can clear. #11 has no such state: a body that cannot move simply
stands, and moves the moment the field gives it somewhere to go.

**A goal that is not really a goal is a lie the crowd discovers together.** A
ring band thicker than the attack range sent bodies to positions they could not
attack from; they arrived, pressed, and milled. Goals are now the exact
in-range annulus, at fine resolution.

**Patching the symptom grows the patch list without bound.** Ten rows, each
correct in isolation, and the crowd still looked wrong. The replacement took
less code than the patches it removed.

## Known limits

- **A hole narrower than a body stays open.** Engaged bodies do not shuffle
  to make room. See the measurement note above; it is a deliberate trade.
- **Goal sampling is 4 × 4 per cell.** A sliver of free space thinner than a
  quarter of a cell (0.05 tiles) can still be missed. Finer sampling costs
  linearly more per enemy and has not been needed.
- **One field per (kind, radius, range).** A roster with many distinct ranges
  means more sweeps per tick. Ranges are data, and the sweep is cheap, but
  this is the term that grows.
- **Cell resolution is five per tile.** A gap that a body fits through by less
  than a fifth of a tile can read as blocked. `lane.pathSubdivision` raises it
  at linear cost.

## Where the code is

| File                        | Role                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| `src/sim/flowfield.ts`      | The distance field: inflation, attack annuli at fine resolution, the sweep, downhill steering |
| `src/sim/motion.ts`         | Circles, contact, move-and-slide, the yielding order                                          |
| `src/sim/targeting.ts`      | Edge-to-edge range and the hysteresis that decides engaged-or-seeking                         |
| `src/sim/spawn.ts`          | The hexagonal spawn clump                                                                     |
| `src/sim/tick.ts`           | `classify*`, `planMoves`, `moveSeekers`: the pipeline in order                                |
| `src/headless/routing.ts`   | `npm run routing` — the measurements above                                                    |
| `src/sim/movement.test.ts`  | Behavioural guards for every case above                                                       |
| `src/sim/flowfield.test.ts` | The field's geometry: rings, holes, clearance, waiting positions                              |
