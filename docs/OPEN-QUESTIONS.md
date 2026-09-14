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
- Built: every unit is a solid circle that a monster's distance field routes
  around, inflated by the monster's own radius so every route offered has real
  clearance ([PATHING.md](PATHING.md)). There is no tile occupancy; tiles only
  say where a unit may be built.
- The consequence that used to need a safety net no longer does: a monster
  that can get no further is pressed against a unit, which puts that unit in
  range, and "attack the nearest thing in range" covers the boxed-in case with
  no stuck detector at all.

### 5. What exactly is publicly visible on opponent tabs? (§12) → **fortress HP and alive-or-out; lane contents during a wave; the balance sheet never**

Taking the doc's suggested minimum for the TAB, and making it a hard ceiling
rather than a starting point. An opponent tab carries their fortress HP, whether
they are still alive, and their placement once they are out. That is the whole
public record on the tab itself.

**Amended: every lane is watchable while a wave is running.** Fog of war during
combat made four players into four solitaires — you could not see the game you
were competing in, and the thing a send bought you was the ability to watch,
which is backwards. So `lane.opponentLanes` is `combat`: during a wave anyone
may look into any lane, and during the build phase nobody may look into anyone's.
What you are BUILDING is still private until it fights, which is the half of the
secrecy that was doing real work.

The fog itself is not deleted, it is switched off: `granted` restores §12 as
written and `always` removes it entirely, the filter is the same code in all
three cases, and one test covers each. Turning it back on — behind an aura, a
send, or a mode — is a one-word change in `data/lane.json`. While it is off, the
vision a send grants is redundant rather than removed, and the Send tab stops
showing a countdown for sight that has no clock.

Extended where §12 required a decision it did not state:

- **A lane you can see** shows its _contents_ — the units, the monsters, the
  fortress, the aura that is lit, and every blow landed this tick so the
  animations are the same fight for everyone watching it. Those are things
  happening in a lane. Under `granted` a send is how you pay to look; under
  `combat` a wave is.
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

### 10. Lobby, matchmaking, accounts; reconnection and AFK handling (§18) → **a code, a seat, and an identity that is a claim rather than a proof**

Four questions §18 leaves open, answered together because each one's answer only
makes sense given the others.

**Matchmaking is one filter.** `filterBy(['code'])` on the room definition, and
nothing else. Quick match joins with the empty code, so everyone asking for a
quick match lands in the same open room until it fills; a private room joins
with four characters from an alphabet that has no ambiguous pairs in it, so
whoever arrives first opens the room and the rest type the code. There is no
room browser, no friends list and no invitation system, because a code you say
out loud covers all three for a game of four people. A mistyped code opens an
empty room of that name rather than failing, which is visible on screen and
fixed by retyping — "nobody is here yet" and "you typed it wrong" want the same
next action.

**A lobby, with a countdown that is always a number.** Four seats, each showing
who is in it, which roster they brought and whether they are ready. The match
starts when everyone present is ready and the room is full; or when everyone
present is ready and the room has been open ten seconds, so a fast solo player
does not take a four-player room to themselves; or after sixty seconds
regardless. That last one is the **AFK rule**, and it is the same principle
§3.2 already applies to waves — one slow player may not hold three others up. A
player who has not readied still plays; they simply did not confirm a roster.
Empty seats are played by a scripted builder from kickoff, as they already were.

**"Accounts" means an identity, not a credential.** A player id generated once
on the device and kept, plus a display name. That is what the game actually
needs an account for: giving a seat back to the player who left it, and making a
name in a lobby mean the same person twice. There is deliberately no password,
no server-side record and no stats history — credentials need a server to hold
them and there is nowhere to run one (§15.2), and an id that cannot be proven is
no weaker than the seat-by-session-id it replaces. The server treats a player id
as a claim and never grants anything on the strength of it beyond a seat, so the
worst a forged one achieves is taking a seat in a room whose code you already
had. Anything that must not be forgeable — a ladder, purchases — needs the real
thing first, and is not in v1.

**Reconnection: the seat is held, the lane is not played for you.** Before
kickoff, leaving frees the seat; there is nothing to come back to. After
kickoff it is held for ninety seconds, because there is: a half-built lane with
your name on it. While you are away nobody defends it and it keeps taking waves,
which is exactly what §13 already describes for a player who leaves, so a
dropped connection costs the time you were gone rather than the match. A bot
taking over was considered and rejected: it would play somebody's lane for them,
and play it differently from how they would.

- Built: `src/net/lobby.ts` (the rules, as pure functions), `src/net/identity.ts`,
  `server/room.ts`, `src/render/ui/homeScreen.ts` and `lobbyScreen.ts`.
- Checked: `src/net/lobby.test.ts` and `identity.test.ts` without a network;
  `npm run lobby` with real sockets, including a drop and a reclaim.

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

## Movement

**Movement is solved to the standard the game needs, after eleven attempts.**
The first ten were patches on a local-steering model and each fixed one
measured case while the crowd still looked wrong; the eleventh replaced them
with two rules — an engaged body never moves, and a seeker walks downhill on a
field to the nearest free attack position — and thirty melee bodies on one tank
now behave the way a good RTS's do. The model, the measurements, the lessons
and the known limits are in [PATHING.md](PATHING.md); `npm run routing`
reproduces the numbers. The one deliberate trade: engaged bodies do not
shuffle to make room, so a hole narrower than a body stays open until the next
death.

## Design changes to DESIGN.md

Decisions that override the document rather than filling a gap in it:

- **§3.2 — there is no global wave-spawn clock.** The only global timers are the
  30s build phase and the enrage clock (§8). Combat runs until every living lane
  is empty. The original clock existed so one slow player could not hold three
  others hostage; that is now handled at the other end instead — enrage keeps
  climbing on a lane that cannot clear, and when its fortress falls the lane is
  wiped and stops receiving waves, so it cannot stall the match indefinitely.
- **§5.3 — movement is engaged-or-seeking on a distance field, not greedy
  steering.** §5.3 explicitly ruled out A\*, navmeshes and flow fields. Greedy
  steering could not solve a wall with a gap in it (a measured 0 of 8 through),
  and every patch on it — slots, tangent steering, stuck detection, give-up
  timers — fixed one case and left the crowd wrong. The model now is two
  rules: a body with something in range is engaged and immovable; a body with
  nothing in range walks downhill on a multi-source Dijkstra field whose goals
  are the free positions from which an enemy is in range, sliding off whatever
  it touches and yielding to whoever is nearer a goal. Cells are a fifth of a
  tile (`lane.pathSubdivision`), obstacles are inflated by the mover's own
  radius, and there is one field per (kind, radius, range) in play. Whole
  tick: 3.6% of the budget. [PATHING.md](PATHING.md) has the rest.
- **§5.1 — monsters hold a target while it is in range; there is no
  retarget interval.** §5.1 has monsters re-evaluating "nearest" continuously.
  A walking monster has no target and re-reads the field every tick, which is
  a stronger form of that; once something is in range it holds it, as units
  do, because switching between two in-range enemies wastes the hits already
  landed. `retargetIntervalSeconds` is gone from the data.
- **§4 — a spawn zone above the build grid.** Monsters spawn as one packed
  clump at the centre of a three-tile band above the grid
  (`lane.spawnZoneDepth`) and cross it before the first contact, rather than
  appearing on the top build row. Both sides may fight anywhere in the lane,
  spawn zone included.
- **§5.1 — `range` is measured edge to edge.** A melee value near zero means
  walking up until the bodies touch. Centre-to-centre range left attackers a
  full body-width short of their target.
- **§4.2 — every body is one circle: collision shape, hit shape and drawn
  size.** There is no tile occupancy and no separate hit box. Contact between
  two circles is exact, edge-to-edge range reads off the same circle, and what
  is drawn is exactly what collides and exactly what counts as in range. Bodies
  are about half a tile wide (0.26 for units, 0.22 for monsters, 0.44 for
  bosses) so a crowd has room to move between them.
- **§5.2 — defensive units are no longer permanently stationary.** A unit with
  nothing in range advances toward the nearest free attack position until
  something comes into range, then plants and fights — anywhere in the lane,
  spawn zone included. It never moves while engaged, so §5.2's anti-jitter
  guarantee is stronger than before, not weaker. `moveSpeed` is per unit in
  `units.json`; `0` pins a unit in place, and a pinned unit is terrain to its
  allies' routing. The line returns to its build tiles at each build phase.
- **§3.2 — the ready button is gone.** The build phase is short enough that
  skipping it was not worth a button. Its corner of the build bar now holds the
  fortress weapon damage-type selector (§10.1). The lobby has one, but that is a
  different thing: it confirms a roster before a match, not a build phase during
  one.
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

- **§5.3**, the movement/steering pseudocode. The prose was implemented and
  then replaced; `src/sim/tick.ts` and `src/sim/motion.ts` are the movement
  now, and [PATHING.md](PATHING.md) records why.
- **§8**, the enrage formula. Reconstructed from the worked example, as above.
- **§16**, the JSON schemas for `matrix.json`, `units.json`, `monsters.json` and
  `waves.json`. The shapes in `data/` and in `src/data/schema.ts` are inferred
  from the stats those sections list elsewhere (§7.2, §9.1), so they are a
  proposal rather than a transcription.
