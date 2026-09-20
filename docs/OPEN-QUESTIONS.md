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
  Pledge in four waves and is noise by wave 14 — which is §11.5's stated arc,
  "clearly correct before wave 10, clearly a weapon after wave 14".
- The cheap probe and the expensive raid grant vision; the bread-and-butter
  sends do not. So sight is a thing you pay for rather than a side effect of
  attacking.
- Sends close when the Final Showdown opens, with every other purchase (§3.3
  replaced, decided above), since a send costs gems and is therefore a purchase.

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
four against identical waves; Thornweald and Gloomtide (then Verdance and
Tidemark) were eliminated every run while Ironvow and Pyre never leaked. Two of
the causes were structural:

- **Gloomtide paid more supply per point of value than Ironvow.** Supply is a
  hard cap (§11.4), so "fewer, stronger units" landed as "less army" — strictly
  worse, not a trade. One supply came off each of its units.
- **Thornweald's tank took 1.5× from Impact**, which is what most early waves
  deal. A tank countered by the commonest damage type is not a tank; it is now
  flesh-armoured, one supply class down, with HP cut to match.

The third cause was the measuring instrument. The scripted player built one
fixed line whatever the wave, so each roster's result was really a statement
about the wave order — and it never built a tank at all, because a 700 HP wall
loses a damage contest to everything. It now picks each row against the incoming
wave using the same §9.3 preview a human gets, and scores the front row on how
much of that wave its armour turns away (§4.1: front line to absorb). All four
rosters then survive; Gloomtide is the most fragile, which is its identity.

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

### 12. Can a unit be sold, and for how much? (§11) → **yes: full price inside the build phase that bought it, half afterwards, and the rate applies per purchase**

_Not in DESIGN.md at all._ §11 prices everything that can be bought and says
nothing about anything coming back, which leaves a misclick permanent: on a
phone, on a 30-second clock, laying a line of units means tapping a grid at
speed, and a tap one tile out or on the wrong unit is not a decision anybody
made.

Decided in three parts.

**Full price inside the build phase that bought it.** This is the undo button,
and calling it that is the point — it costs nothing, so it corrects a mistake
without also being a tactic. Nothing is learned between placing a unit and
selling it in the same breath, because no wave has run.

**Half afterwards.** Once a wave has been fought, selling is a real decision
made with real information — you have seen what came and what is coming (§9.3)
— so it is priced. Half is high enough that a board can be rebuilt around a
counter and low enough that churning every wave loses to committing.

**The rate is per PURCHASE, not per unit.** A unit carries two numbers: gold
spent in the build phase now in progress, and gold spent in any earlier one.
The first refunds in full and the second at half, so an upgrade bought by
mistake on a unit that has stood there for ten waves is as undoable as a unit
bought by mistake. The alternative — one rate per unit, decided by when the
body was placed — makes the upgrade ladder the one purchase with no undo, which
is backwards: it is the expensive one.

Two smaller decisions fell out of it:

- **Supply comes back whole, always.** It is a slot the unit occupies, not a
  price it paid, and a half-returned slot would mean a player who sold and
  rebuilt the same unit slowly lost their army cap.
- **A sold unit is removed, not killed.** §5.4 respawns casualties at the next
  build phase; a sale is not a casualty, and a unit that walked back onto its
  tile with the refund already paid would be free money.

Selling is closed outside the build phase, and closed once the Final Showdown
opens like every other transaction (question 3): the arena is fought with the
army you brought, and turning a line into gold nobody can spend would be a
strange exception to that.

- Data: `economy.sell.sameBuildPhase: 1`, `economy.sell.later: 0.5`.
- Built: `sellUnit` and `sellValue` in `src/sim/apply.ts`, the phase rollover in
  `src/sim/tick.ts`, `unitSpend` on `LaneView`, and the Sell button in
  `src/render/ui/buildBar.ts` — which prices the sale with the simulation's own
  `sellValue`, so the number on the button is the number the command pays.
- Checked: `src/sim/selling.test.ts`.

## Still open — needed before the milestone in brackets

### 3. Post-wave-25 purchases (§3.3) → **overtaken: the shop closes when the armies march**

The question was what may still be bought during §3.3's attrition endgame.
There is no attrition endgame any more — §3.3 has been replaced by the Final
Showdown (see the design-changes list below) — so the question it asked no
longer has a subject, and the rule that replaces it is simpler than either
answer on offer:

**Every build phase is fully open, including the one before the last wave.
Nothing at all can be bought once the showdown opens.** The arena is fought
with the army you brought, and the last build phase is the last chance to
change it — which is what makes it worth playing rather than a formality
before a grind.

The free per-build-phase choices — the fortress weapon's damage type and the
active aura (§10.1) — are unaffected: they cost nothing, so they are not
purchases, and the showdown has no fortress to apply them to anyway.

### 4. Is the supply cap upgrade bought with gold or gems? (§11.1)

Taking the doc's recommendation: **gold**. The ladder is in `economy.json`; the
cost field is the only thing that would change.

### 9. Full monster and boss bank (§18) [M3]

Five monsters exist (four normal, one boss) — the M1 slice. Note that the boss
is single-armour, where §3.4 wants bosses to carry a **mix** of armour types
across their parts or spawns so no single damage type hard-counters them. That
needs a multi-part boss model that does not exist yet.

### 13. The arena is a cross, and a cross is only fair to four (§3.3, replaced) [balance]

The Final Showdown seats each surviving army on the spoke its seat at the table
owns, and an eliminated player's spoke is left empty rather than handed to
somebody else. That is the right rule for identity and the wrong one for
geometry as soon as fewer than four armies arrive.

**Two survivors** may end up on ADJACENT spokes or OPPOSITE ones depending on
which two players died, and those are materially different fights: opposite is a
head-on clash, adjacent is an L-shaped one that meets at an angle. Two duels
decided by different geometry is a fairness problem with no symptom - nothing
crashes, one player simply had a different game. The balance harness and the
Final Showdown mode already seat a duel opposite (`seatsForArmies` in
src/balance/arena.ts); the live rule is unchanged and needs a decision.

**Three survivors** cannot be made fair on this shape at all: two of them are
adjacent and one is opposite both, whatever the seating. It wants its own arena
shape - a Y rather than a cross - and nothing measured on the current one should
be read as balancing for it.

Neither blocks the first phase of balancing, which is four-way and duel only.
See [BALANCE.md](BALANCE.md).

### 11. Monetisation and audio (§18) [post-ship]

## Answered by transcription, not by invention

Already decided in DESIGN.md and simply written into `data/`:

- The full damage matrix (§6) — `matrix.json`
- Build zone 8×10 (§4.2), build phase 30s (§3.1), boss every 5 waves (§3.4),
  25 authored waves (§3.3, though what follows them is no longer §3.3's),
  lane cap 30 monsters (§8.1)
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

- **§3.3 — the match ends in the Final Showdown, not in attrition.** §3.3 had
  the table stop building and stop respawning at wave 25 and grind through
  ever-nastier waves until one player was left. That is a race against a clock,
  and it is settled by who banked the most gold rather than by who built the
  better army. Clearing the last wave now cuts to a card — "Final Showdown in
  3…" — and then to a cross-shaped arena, four spokes of lane width around an
  8 × 8 centre, with every surviving army standing in its own spoke on the
  tiles it was built on, restored to full HP. They converge on the middle and
  fight a free-for-all under the targeting and movement rules they have used all
  match, with one addition: sight in the arena is local rather than global -
  a unit looks its own reach plus a margin, never less than a floor, and walks
  at the middle of the map when nothing is inside that. Last player with anything standing wins, and is placed first.
  Three things follow: every build phase is open, including the one before the
  last wave, and nothing at all is buyable once the armies march; units respawn
  at every build phase without exception; and the camera moves for the first
  time, since a 32 × 32 arena does not fit a phone screen at a readable
  scale. **Dampening** is the brake that guarantees termination — healing, a
  summon's starting HP and crowd-control durations all fade 1% per second
  additively after the first 30 seconds. Two of the three are load-bearing now
  that abilities exist: the arena heals and holds, and both multipliers are
  applied every tick. The summon curve is still waiting on summons, which are
  vocabulary rather than a rule. `waves.showdown` in `data/waves.json` holds all
  four numbers.

- **§3.1 — the shop stays open during combat; only the board closes.** §3.1
  puts placing, upgrading, tech, fortress upgrades and queued sends all in the
  build phase. Only the first two of those are about the LINE, and only the
  line has a reason to be frozen while a wave is hitting it. Tech, the fortress
  and resource ladders, the supply cap, the weapon's damage type, the active
  aura and sends are now all buyable mid-wave; placing a unit, upgrading one in
  place and selling one back are still build-phase only. A send bought during
  combat still joins the target's next wave, exactly as one bought during a
  build phase does, so the old rule only ever decided when the attacker was
  allowed to think about it. `shopOpen` and `boardOpen` in `src/sim/apply.ts`.
- **§11.5 — sends can be aimed at random, and armed to repeat.** §11.5 has the
  player choose a target per send. Two additions, both conveniences rather than
  rules: a Random chip spreads sends across the living opponents (the command
  still names one concrete lane, so determinism is untouched), and pressing and
  holding a send for a second arms it to fire every 500ms while the gems last.
  Neither changes what a send does or costs.
- **§14.2 — a tap selects the body, not the tile.** A unit is one circle -
  collision shape, hit shape and drawn size at once - so the thing a tap hits
  is that circle, wherever the unit has walked to, and the selection is drawn
  as a ring on it rather than as a box around a tile. The tile rule missed a
  unit that had advanced off its own tile and selected one from an empty corner
  of its tile. The tap circle is the body plus eleven pixels, because the body
  alone is a ~22px target where a thumb wants 44; the reach stays under one
  tile so the empty tile beside a line is still somewhere to build.
- **§12 — a player's NAME is public.** §12 lists fortress HP and
  alive-or-eliminated as the public record. A name belongs on that list: fog is
  about what somebody has built, and the four tabs across the top exist to say
  who is being worn down. Names ride in the hello rather than in every frame,
  since they do not change once a match starts. The HP percentage that used to
  be printed under each tab is gone - the bar is the same number, read faster.
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
- **§5.2 — a unit advances, but not into the spawn zone.** The amendment below
  let a unit with nothing in range walk anywhere in the lane, spawn zone
  included. Measured under load that put the whole defence on the spawn point:
  mean unit y of -0.14, twenty-nine of thirty-two units inside the zone, and
  monsters confined to 4 of the lane's 14 rows. A wave born inside a wall of
  bodies never brings its numbers to bear, which quietly made a send against
  that lane worthless and flattened §4.2's front-line/back-line decision. The
  spawn zone is now the attacker's ground: a unit advances to the top of the
  build grid and holds, and its reach still crosses the line. A steering rule,
  not a wall - contact uses the whole lane, so a unit shoved over the line
  walks back rather than being crushed against it. No new number: the grid's
  top edge is the line.
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

- **§5.5 — the fortress heals continuously, not on a lane clear.** §5.5 gave
  the wall its HP back when the lane went fully clear. It now heals every tick,
  in both phases, at `fortress.regen.base` HP per second (5 to start, and a
  ladder that raises it). Healing only on a clear meant a player who never
  quite cleared a wave never healed at all - the lever was hardest to pull
  exactly when it was needed - and it made the reward for clearing arrive as a
  number that jumped rather than a wall you can watch recover. A trickle is
  also legible: a fortress losing HP faster than it heals is one that is
  genuinely in trouble. Healing cannot save a wall that has already reached
  zero; the elimination check owns that moment.
- **§11.1 — a kill the FORTRESS makes pays every other lane, not the
  defender.** The wall exists so a small leak repairs itself and a large one is
  correctly fatal (§10.1), not as a defence to build around - but paid the
  bounty for its own kills, it was exactly that: let the weapon farm the wave
  and bank the gold. A monster the wall kills now pays the lane it died in
  nothing, and every other living lane `economy.fortressKillBounty` gold (1).
  Flat, and per other lane, rather than the monster's own bounty: what the wall
  catches is nobody's decision, so the payout should not scale with what
  happened to wander into it. A monster your own line killed is worth exactly
  what it always was.
- **§14.1 — a selected unit is a view of its own, belonging to no tab.**
  Selecting a placed unit takes the lit state off every tab and puts up what
  that unit is, what it does, and the two things you can do about it (§7.3,
  §11); tapping any tab puts the unit down and goes there. It used to live
  inside the Build tab, which meant a unit tapped from any other tab opened
  nothing at all - and the tap that went looking for it in Build threw the
  selection away on the way past.
- **§3.4 — a boss passes through monsters, and they through it.** It stays
  perfectly solid to defensive units and to the fortress wall. A boss is four
  times the width of the swarm it arrives with, and that swarm is what its wave
  is made of; made solid to them it spends the fight wedged in its own escort,
  and the escort spends the fight queueing round a body it cannot get past.
  Measured against a defended line: solid, the boss never reached the line in
  600 ticks and walked 3.2 tiles for every tile of progress; phasing, it engages
  at tick 270 at 1.05x. Nothing about the crowd's shape depends on one body, so
  the cost is a boss and some monsters sharing ground, which is what a thing
  that size wading through a swarm should look like anyway.
- **§10.2, §11.3 — the resource building pays gems on its own clock, and both
  of its ladders are bought with gold.** Gems used to arrive as a lump at the
  end of each wave. They now arrive one every two seconds, all the time, in
  both phases: an economy upgrade should pay you while you play rather than
  settle up afterwards, and it makes buying the building early a real decision
  rather than a delayed one. Two ladders replace the single one - `gemOutput`
  adds a gem per payout, `gemRate` adds half the base rate per level,
  ADDITIVELY (1.5x, 2x, 2.5x, not 1.5x, 2.25x, 3.375x). Both cost gold rather
  than gems: §11.3 gives fortress upgrades to gems, but a building that makes
  gems, paid for in gems, is a loop that only opens once you are already
  winning it. Gold is what you have in the first build phase, which is when the
  decision to invest should be live.
- **§14.1, §14.2 — a sixth build-bar tab shows what each unit landed, and the
  tier pips count upgrades rather than tiers.** §14.1 gives the lane the whole
  width and lists five tabs, all of them things to spend on; the damage
  scoreboard is a sixth and spends nothing. It is there rather than beside the
  lane because there is no side to put it on, and because the bar is already
  idle during combat, which is when the numbers move. The simulation clears
  each unit's total when a wave SPAWNS rather than when the build phase opens,
  so the fight just finished stays readable for the whole build phase after it
  - the only moment a player has both the time to read it and a decision to
    spend it on. A unit is credited with what the monster actually lost, overkill
    on the killing blow excluded, so the rows add up to the HP the line
    destroyed. Rows are own-lane only: §12 lets a send buy sight of a fight, not
    a reckoning of what somebody's line is worth. Separately, the pips under a
    silhouette now count UPGRADES BOUGHT rather than tiers owned - a unit as
    built wears none, one upgrade is one dot - which is what §14.2's "tier pips"
    reads as when the thing being counted is what you paid for.
- **§14.2 — every body has its own silhouette; the armour type is its
  family.** The document gave one shape per armour type, which is four shapes
  for thirty-seven bodies. Each unit and monster now has a distinct shape, and
  the information §14.2 put in the silhouette moves up a level: round shapes
  are Flesh, angular are Plate, pointed and stellar are Ward, clusters are
  Swarm. Tiers keep their base's shape (§7.3). The validator refuses a roster
  in which two bodies share a shape or a shape is in the wrong family.
- **§3.2 — the combat phase ends early when every living lane is clear.** The
  global wave clock is now "fixed unless everyone is done", matching how the
  ready button already works for the build phase. It still cannot be used to
  stall other players, since it only ever moves the clock forward.

- **§14.1 — an ability is a name you can tap, and the description is
  generated.** The panel has about two lines for what a body does, and a unit
  at the top of its ladder has two abilities with a sentence each. Fitting them
  meant shrinking until they fit, and what actually happened is that the
  descriptions were dropped entirely - a tier-1 Oathwall showed "Hold the Line"
  and nothing else. The panel now lists NAMES, each a button, and tapping one
  opens a card. The card's authored line says what the ability is for in one
  short sentence and carries no numbers at all; every figure on it is read off
  the resolved ability, so the panel and the data cannot disagree and a balance
  pass cannot leave a stale description behind. A test caps the authored lines
  at ninety characters and refuses a figure in one.

- **§14.1 — a stat cell shows what the body is fighting with, not what its
  definition says.** The panel deliberately showed definition numbers so that
  the tier comparison would not move for reasons unrelated to the tier. With
  abilities that is the wrong half of the trade: a player watching a slow land
  on a wave wants to see the Move cell drop. Tech, the aura and every status
  are now folded in, the cell is green where something raised it and red where
  something lowered it, and the SAME multiplier is applied to the tier being
  compared with - so the arrow still compares two tiers. It costs a sparse,
  masked row per modified body on the wire (`EntityView.mods`).

- **§11.5 — a send delivers one monster, not a pack.** §11.5 describes a send
  as monsters, plural, added to an opponent's next wave, and the catalogue
  priced packs: eighteen gems for six Swarmlings, ninety for two Bloaters. That
  makes every send a decision about a pack rather than about a monster, makes
  the cheapest button the one that drops the most bodies, and spends the send
  button's third line on a count. Each send now delivers exactly one, with its
  gem cost and its granted income divided by the old pack size so that the gems
  and the gold per monster are exactly what they were. Pressure is something a
  player builds up rather than drops; the freed line on the button says what the
  monster will DO when it arrives, which is the thing worth weighing.

  The sends were then RENAMED after the monsters they deliver - Swarmling,
  Grub, Husk, Revenant, Bloater - because a button that said "Swarm Probe" and
  then "Swarmling" underneath was the same name twice. A send id now matches
  the monster id it delivers, which is the same word in two separate namespaces
  and reads correctly in both.

- **§14.1 — a monster can be selected and read.** §14.1's panel is about a unit
  you own. Half of what the ability system added is on the other side of the
  board — a Revenant that abilities slide off, a Bloater that bursts — and none
  of it was readable anywhere. Tapping a monster now opens the same panel with
  no buttons on it, in your own lane or in one you are watching.

- **§7, §18 — every unit has an ability, and the rosters are named for what
  they do.** §7 gives a builder six units and differentiates them by damage
  type, armour type and price; §18 lists ability mechanics as a later concern.
  Six units that differ only in those three things are a spreadsheet, so the
  ability system is built now and the numbers are tuned later, like every other
  number in `data/`. Every unit has a signature ability from tier 1 whose
  numbers rise with the tier, and a second one unlocked at the top of its
  ladder - which for the ten three-tier units is an ability that spends energy.
  Five of the nine monsters have one and four deliberately do not; every boss
  has one, and three of the four are thresholds. Three sends hand an ability to
  everything they deliver, which is what makes a send a thing rather than a
  quantity of monsters.

  The four rosters were RENAMED to match, because a name that says nothing is
  a name a player has to memorise: Bastion, Ashfall, Verdance and Tidemark are
  now **Ironvow** (oaths: taunts, wards, answered blows), **Pyre** (heat:
  `burning`, escalation, dying loudly), **Thornweald** (growth: roots, rot, a
  line that mends itself) and **Gloomtide** (pressure: `soaked`, chill, chains
  through the wet). Every unit id and name changed with them - Pledge, Oathwall,
  Sentinel, Judgement, Sanction, Vigil; Ember, Slagmaw, Firebrand, Wickling,
  Scoria, Foxfire; Thornling, Hollowbark, Sporecrown, Mycelia, Nettlespire,
  Rotgourd; Fathomhold, Kelpsnare, Torrent, Sleet, Maelstrom, Murmur - so that
  a unit's id, its name and its builder's name all say the same thing. No stat
  moved: this was flavour and mechanics, and balance is still ahead of us.

  The one rule worth stating as a rule: an ability a unit can reference must be
  built out of effect kinds the simulation actually honours, and `validate.ts`
  enforces it. The rest of §18's list - summons, resurrection, knockback,
  teleportation, transformation, spirit link, detonation, path blocking, cost
  reduction, charm, fear, banishment - is typed, validated and inert, and lives
  in `abilities.json`'s `planned` list where it is a design rather than a
  promise. See [ARCHITECTURE.md](ARCHITECTURE.md#abilities-a-trigger-a-target-some-effects-and-a-price).

- **§1, §14.1 — the game plays either way up, and asks for neither.** §1 says
  portrait and one-handed, and the renderer used to enforce it: an attempted
  `screen.orientation.lock`, a `screenOrientation="portrait"` line in the
  Android manifest, and a notice telling a sideways player to turn the phone
  upright. A lock a browser refuses and a notice a player cannot act on are
  not a layout. `computeLayout` now has a second arrangement of the same three
  areas — HUD left, lane middle, build bar right, instead of the three stacked
  bands — and the lock, the notice and `src/render/ui/orientation.ts` are gone.
  Portrait is untouched and is still the shape the game is designed around; it
  is simply no longer the only one. Nothing in the simulation is aware of any
  of this: the lane is 8 × 14 either way round, so the same match plays the
  same however the phone is held, and a phone turned mid-match keeps playing.

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
