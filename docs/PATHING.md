# Pathing: what has been tried, and what is still wrong

**Status: working, not good. Expect to revisit this.**

Movement has taken more attempts than anything else in the project, and it is
still the weakest part of the game to watch. This file exists so that the next
attempt starts from what has already been measured rather than from scratch.
`npm run routing` reproduces every number quoted here.

DESIGN.md §5.3 specifies no pathfinding at all — greedy steering, tie-break
toward the lane, stuck detection as a fallback. That turned out not to survive
contact with the geometry the game actually makes, and the deviations are
recorded in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md).

## The problem, in one paragraph

Up to 30 monsters and 40 units share an 8 × 10 lane. Both sides are circles
about two thirds of a tile wide, so a lane is only about twelve bodies across,
and both sides converge on a handful of goals. Everything therefore happens in a
crowd: agents block each other constantly, the thing you want to reach is often
behind something else, and the geometry changes every tick. Crowds are where
naive movement looks worst — it reads as shuffling, jamming, orbiting, or units
standing around doing nothing — and all four of those have been observed here.

## What has been tried

In order. Each row is a real implementation that was measured and either kept,
replaced, or reverted.

| #   | Approach                                                         | Result                                                                                                                     | Kept?          |
| --- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 1   | Greedy steering per §5.3                                         | **0 of 8** monsters through a wall with a gap at one end                                                                   | Replaced       |
| 2   | Veto directions blocked by a neighbour                           | 203 tiles of wasted travel over 20s; 1 of 8 in contact; 42° of spread                                                      | Reverted       |
| 3   | Deflect away from neighbours                                     | 266 tiles of wasted travel; still a queue                                                                                  | Reverted       |
| 4   | Tile-granular multi-source BFS field                             | Solved monsters-versus-wall. Treating ally tiles as terrain caused a clean two-tick oscillation, forever                   | Replaced by #9 |
| 5   | Body-radius separation, asymmetric priority, steering hysteresis | Path efficiency 0.57 → **0.999**; wasted travel 68 tiles → 0.01                                                            | Kept           |
| 6   | Approach slots on a ring around the target                       | Residual motion 7 tiles against 203 and 266 for #2 and #3; contact 1 → 4 of 8; spread 42° → 157°                           | Kept           |
| 7   | Edge-to-edge range, and back a body out of what it is hitting    | Melee gap 0.36 → **0.00** tiles                                                                                            | Kept           |
| 8   | Tangent steering with side commitment                            | Two rows: **3 → 6 of 8** in contact, where 6 is the geometric maximum                                                      | Kept           |
| 9   | Sub-tile Dijkstra field, obstacles inflated by body radius       | Wall with a gap: **1 → 7 of 8** through. Everything else unchanged. Tick 0.25ms → 0.83ms                                   | Kept           |
| 10  | Release the park when nothing is blocking                        | A unit that gave up in a crowd stayed frozen 0.76 tiles from contact **even after every ally around it died**. Now resumes | Kept           |

Three of those deserve calling out as lessons rather than results.

**Reactive schemes oscillate, and damping does not fix them.** #2 and #3 both
resolve contention by reacting to whoever is nearby. The churn is in the
priority ordering itself, which flips as the crowd shifts, so no amount of
smoothing settles it. What worked was removing the contention instead: give
every attacker its own slot (#6) so no two ever want the same point.

**Commitment beats recomputation.** #8 works because the unit commits to a
_side_ and holds it until the obstacle is no longer in the way. Every earlier
version recomputed the choice each tick, and the choice flips on a fraction of a
tile of movement, so the unit shuffled instead of going round.

**Every give-up rule so far has become a freeze.** This has now happened three
times in three different places: gating movement on the stuck flag froze
monsters permanently, the stall-park froze units mid-detour, and the park's
bests-ever baselines froze units even after the obstruction cleared. The shape
is always the same — a state that suppresses movement, entered on a condition
that only movement can clear. Any future "stop trying" rule needs an exit that
does not depend on the agent moving.

## What is still wrong

Measured or observed, roughly in order of how much it shows:

1. **Crowds do not look good.** Units arrive in a clump rather than fanning out
   cleanly, and the last one or two never find a place. The slot ring is
   assigned by entity id, not by who is nearest which slot, so attackers
   routinely walk past a free slot to reach "theirs".
2. **7 of 8, not 8 of 8, through a gap.** The last unit queues behind the crowd
   at the gap and gives up. Correct-ish behaviour, but it reads as a unit
   standing around.
3. **Units at contact never come to rest.** They press into what they are
   hitting and are pushed back out every tick. Displacement per tick is
   near zero, so it is not visible jitter, but the crowd is never actually
   still: ~17 tiles of movement across 8 monsters over 2 seconds, essentially
   all of it this.
4. **The field routes to the nearest monster, not to the unit's own target.**
   With several monsters in the lane those differ, so a unit can be steered
   toward one monster while its slot is around another.
5. **Bosses are wider than the field assumes.** Inflation uses each kind's
   declared radius because one sweep serves every member of that kind, and a
   boss body is roughly twice a normal one. A boss can therefore be offered a
   route it does not fit, and falls back on local steering there.
6. **Monsters are not obstacles to each other in their own field.** Only the
   defensive line is. So monsters route around units properly but not around
   each other; separation alone handles that, which is why a dense pack still
   bunches on approach.
7. **The handover distance is a tuned constant.** `FIELD_HANDOVER` is 2 tiles
   because 2 measured better than 1, 1.5, 3 and 4 — not because 2 falls out of
   anything. Same for the 4-second stall window.

## Candidates for the next attempt

Not yet tried, in rough order of expected value for the effort:

- **Assign slots by proximity, not by id.** A small assignment problem (8-30
  attackers over 8 slots) solved greedily by distance each time the group
  changes. Directly targets problem 1, which is the one that shows most, and it
  is cheap.
- **Continuous local avoidance (RVO/ORCA).** The standard answer for smooth
  crowds: each agent picks a velocity that is collision-free against its
  neighbours' velocities rather than their positions. Would replace #5 and #8
  and plausibly problems 1 and 3 together. Real cost: a proper implementation is
  a few hundred lines, needs its own determinism audit (no trigonometry, and
  linear programming with exact tie-breaks), and has its own failure mode of
  agents drifting past each other in slow motion.
- **Let the field carry crowd density.** Continuum-crowds style: add a cost term
  for congested cells so routes spread out instead of everyone taking the same
  line. Targets problems 1 and 2. Cheap to add to the existing sweep; needs care
  not to create its own gradient churn.
- **A second field to the unit's own target.** Targets problem 4. One sweep per
  distinct target is too expensive, but one sweep per _cluster_ of nearby
  targets is probably affordable at four lanes.
- **Per-body inflation for bosses.** A third field for large bodies, or route
  bosses with a short per-agent A\* since there are at most a few of them.
  Targets problem 5.
- **Raise `pathSubdivision` from 4 to 8.** Sharper clearance, linear cost in the
  sweep. Worth trying once the tick budget is better understood at four lanes.

## Where the code is

| File                       | Role                                                        |
| -------------------------- | ----------------------------------------------------------- |
| `src/sim/flowfield.ts`     | The Dijkstra field: inflation, the sweep, downhill steering |
| `src/sim/avoidance.ts`     | Tangent steering, side commitment, the corridor test        |
| `src/sim/slots.ts`         | Approach slots and ring capacity                            |
| `src/sim/separation.ts`    | Body-radius separation and the yielding order               |
| `src/sim/steering.ts`      | Candidate directions, hysteresis, stuck detection           |
| `src/sim/tick.ts`          | `updateFields`, and the route choice in `advanceUnit`       |
| `src/headless/routing.ts`  | `npm run routing` — the measurements above                  |
| `src/sim/movement.test.ts` | Behavioural regression guards for each case                 |
