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

The simulation works entirely in **tile** coordinates. `y = 0` is the top of
the build grid, `y = depth` is its bottom; the spawn zone is the band of
negative `y` above the grid and the fortress zone the band below it, so the
whole lane is one stretch of ground from `-spawnZoneDepth` to
`depth + fortressZoneDepth`. The simulation has no idea how big the screen is,
and the renderer owns the single tile→pixel transform in `src/render/layout.ts`,
recomputed on boot and on resize only. The fixed camera (§4.1, §14.1) is what
makes one transform enough.

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

**M1 through M5 are complete. M6 is complete except for hosting, which is not
a code problem.**

M1 (headless sim): `npm run sim` plays a single lane through five waves with a
scripted builder and prints the result.

M2 (renderer): `npm run dev` is a playable single-player game in portrait — tap
a unit, tap a tile, watch the wave arrive. Pixi, fixed portrait layout, coloured
shapes, touch build UI, one builder, as §17 specifies.

M3 (full single lane): all six units of builder A with tiers, global tech,
fortress and resource upgrades, gems, supply, 25 authored waves, a four-boss
bank, and the attrition endgame. §17 calls this "the point at which the game is
balanceable", and it is: every lever is a field in `data/`.

M4 (multiplayer): `npm run server` runs an authoritative Colyseus room and
`?server=ws://host:2567` joins it. Four lanes, sends, fog of war, elimination
and spectating — see [the netcode section](#netcode-one-simulation-two-places)
below.

M5 (content): four builders of six units each, 58 unit definitions. A match now
opens on the builder picker, and the three scripted lanes take the other three
rosters — see [the builders section](#four-builders-differentiated-by-shape)
below.

M6 (ship): a home screen with a name on it, quick match and private rooms by
code, a lobby with ready ticks, reconnection into your own lane, and a Capacitor
Android project that `npm run build:android` produces from a clean clone. The
one piece left is somewhere to run `npm run server`, which is money rather than
code — see [getting into a match](#getting-into-a-match-code-seat-identity)
below.

The build bar is five tabs — Build, Tech, Fort, Aura, Send — one per distinct
thing a player spends on. Send and Fort are adjacent on purpose: §11.2 says
offence and defence compete for the same gems and calls that the intended
tension, and two neighbouring tabs drawing on one pool is the plainest way to
show it.

Three OPEN questions are answered, all recorded in
[OPEN-QUESTIONS.md](OPEN-QUESTIONS.md): the supply cap is bought with gold
(§11.1, the doc's recommendation), **no purchase of any kind is available from
wave 25** (§3.3, against the doc's recommendation — the endgame is a grind
fought with what you brought), and §12's public record is fortress HP plus
alive-or-out, with the balance sheet never public under any circumstance.

Selling a unit back is answered in the same register, though §11 never asked:
full price inside the build phase that bought it, so a misclick on a 30-second
clock is undoable, and half in any later one — see
[the selected unit](#the-selected-unit-what-it-says-and-selling-it-back).

### Four builders, differentiated by shape

§6.1 is the constraint that makes this interesting: every builder must field all
four damage types, because every lane faces the same wave. So builders cannot be
differentiated by what they can answer — only by _distribution and quality_.
Four rosters, each excelling at a different **pair** of damage types:

| builder  | strongest       | armour lean | costs               | shape                                              |
| -------- | --------------- | ----------- | ------------------- | -------------------------------------------------- |
| Bastion  | Impact + Pierce | plate       | 40–95g, 2–3 supply  | the reference: a melee wall with snipers behind it |
| Ashfall  | Blast + Impact  | flesh       | 48–98g, 2–3 supply  | hits hardest, dies fastest, charges most           |
| Verdance | Arcane + Pierce | ward        | 34–84g, 1–2 supply  | cheap, quick, numerous; folds to an Impact wave    |
| Tidemark | Blast + Arcane  | swarm       | 62–105g, 2–3 supply | longest reach, fewest bodies, thinnest line        |

Two axes do the work, and both are consequences of rules that already existed:

- **Armour lean decides which wave punishes you.** The matrix runs in both
  directions (§6), so a roster built on ward bodies takes 1.5× from Impact —
  and Impact is what the early waves mostly deal. Verdance is therefore
  genuinely harder early and stronger later, without a single special case.
- **Supply is the cap that binds** (§11.4), so a roster's character is its value
  _per supply_, not per unit. Tidemark's identity is concentration: fewer, more
  expensive bodies with the longest reach and the least health.

Tier scaling is the same throughout, measured off builder A rather than
invented: ×2.18 HP, ×2.21 damage, ×1.60 gold at tier 2; ×2.10, ×2.16, ×1.63 at
tier 3. That satisfies §7.3's "~1.6× base cost for ~2.2× value", and a test
asserts the property directly — an upgrade must cost proportionally less than it
gives, or upgrading in place stops being the reason to hold board presence.

Every unit body is a circle of radius 0.26 tiles, whatever the roster, and a
test enforces that no body is wider than 0.7 of a tile. Size is a movement
lever, not a balance one: bodies are deliberately about half a tile so that a
crowd has room to move between them (see [PATHING.md](PATHING.md)), and a roster
that packed the lane tighter would fight differently for reasons that have
nothing to do with its numbers. Builders therefore differ by numbers rather
than by size. Monsters are 0.22 and bosses 0.44; the distance field is built
per body size, so a boss is never offered a route it does not fit.

**Choosing a builder is a pre-match decision**, which DESIGN.md never states.
Recorded in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md): §7.3's upgrades and §11.4's
supply budget are both long-run commitments to a roster, and choosing mid-match
would mean either stranding what is already built or letting a player
cherry-pick the best unit of each roster, which deletes the §6.1 choice
entirely. The simulation enforces it — `placeUnit` refuses another builder's
unit with `wrong-builder`, because the UI is a client and a client is not
trusted with rules.

`npm run builders` plays all four side by side against identical waves and
reports where each one leaked. It is a sanity check, not a verdict: the scripted
player is a poor one.

### Fog of war is a setting, not a law

`viewFor` takes which of three rules is in force, and `data/lane.json` picks it:
`granted` is §12 as written (a send buys sight), `combat` opens every lane while
a wave is running and closes them for the build phase, `always` never closes
them. The shipped default is `combat`.

The reasoning is in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md): fog during combat
turned four players into four solitaires, while fog during the build phase is
the half that was doing real work — what you are building stays private until it
fights. What is never visible under any of the three is the balance sheet.

The existing machinery is untouched, which is the point: sends still grant
vision, the opponent tabs still gate on `watching`, and the camera still comes
home by itself when sight lapses — which under `combat` is what happens when the
wave ends. Turning the fog back on is one word in a data file.

### Getting into a match: code, seat, identity

Three ways in, and the front screen offers all three because the answer to "can
I play right now" should never be a menu waiting for a server:

- **Practice** is simulated in this tab with scripted builders in the other
  three lanes. It needs nothing, and it is what the GitHub Pages build serves.
- **Quick match** joins the next open room.
- **Private room** is four characters you say out loud.

The last two need `?server=`, and are drawn disabled with the reason underneath
when there is none. Hiding them would leave a one-button menu that explains
nothing.

**Matchmaking is one line.** `filterBy(['code'])` on the room definition, and
`joinOrCreate` with a code from the client. Quick match sends the empty code,
so everyone asking for one lands in the same room until it fills. A private room
sends four characters from an alphabet with no ambiguous pairs in it (no I, O,
0 or 1), so whoever arrives first opens the room and the rest type the code.
A mistyped code opens an empty room of that name instead of erroring, because
"nobody is here yet" and "you typed it wrong" want the same next action from
the player.

There is no lobby server, no room list and no database. None of them add
anything a four-player game with a shareable code needs.

**A seat belongs to a player, not to a connection.** Colyseus hands out a new
session id every time a socket opens, so a player who drops and comes back
would otherwise be a stranger seated into somebody else's half-built lane.
Seats are keyed by a player id the client generates once and keeps, which is
also what makes reconnection mean "your lane back" rather than "a lane".

The rules — who sits where, when the match starts, what the countdown says —
are pure functions in `src/net/lobby.ts` with no socket in them, so they are
tested without a network. The room owns the sockets and asks that module what to
do. `npm run lobby` then checks that those are the rules the room actually
applies, over real sockets, including a drop and a reclaim.

**The match starts** when everyone present is ready and the room is full; or
when everyone present is ready and the room has been open ten seconds, so the
first player to arrive and tap Ready does not take a four-player room to
themselves; or after sixty seconds regardless. The last is the AFK rule, and it
is §3.2's principle applied to the lobby: one slow player may not hold three
others up.

**Identity is a claim, not a proof.** §17 lists "accounts" and §18 leaves the
system OPEN; what the game needs from one is an id that survives a restart and
a name other people see. There is no password and no server-side record, because
credentials need a server to hold them and there is nowhere to run one — and an
unprovable id is no weaker than the session id it replaces. The server treats it
accordingly: it seats by id and grants nothing else on the strength of it. Names
are cleaned on both sides, the server's pass being the one that counts, because
a name is drawn on three other people's screens and the client is not trusted
with text any more than with rules.

**Reconnection** holds a seat for ninety seconds after kickoff. While its player
is away the lane keeps taking waves with nobody defending it, which is what §13
already describes for a player who leaves, so a drop costs the time you were
gone rather than the match. A bot taking over was rejected: it would play
somebody's lane for them, and differently from how they would. Before kickoff
there is nothing to come back to, so leaving frees the seat for somebody else.

The client keeps its reconnection token in `sessionStorage`, which survives a
reload of the page but not a new tab — a new tab is a different player as far as
anyone can tell. Connecting tries the token first and falls back to a normal
join, so a stale one costs a failed round trip and nothing else.

### The one piece of DOM

Everything the player touches is drawn in Pixi except text entry, and that
exception is not close. A canvas cannot raise the on-screen keyboard, show the
caret the operating system draws, offer autocorrect, or be dictated into.
So a real `<input>` appears over the canvas for as long as it takes to type a
name or a room code and is removed afterwards (`src/render/ui/textPrompt.ts`).
It is deliberately not `prompt()`, which is blocking, unstyleable, suppressed in
some mobile browsers, and inside a Capacitor shell looks like a browser error
rather than part of the game.

### Android: Capacitor, and what is generated

§1 says Android first. Capacitor is the shell: a WebView, the web build inside
it, and no second codebase. `npm run build:android` does the whole thing from a
clean clone — builds with a relative base (an absolute one resolves to the
device's filesystem root and every asset 404s), creates the native project if it
is not there, copies the build in, and applies the manifest edits the config
file has no field for.

`android/` is generated and has been in `.gitignore` since the first commit, so
the one attribute Capacitor cannot express — `screenOrientation="portrait"`,
which §1, §4.1 and §14.1 all assume — is applied by `scripts/prepare-android.mjs`
rather than by committing sixty files of Gradle scaffolding. The script is
idempotent and fails loudly rather than leaving the app quietly wrong.

Producing the APK needs the Android SDK and Google's Maven repository, so it
happens on a developer's machine or in CI with the SDK installed, not here:

```
npm run build:android     # web build + native project, ready to open
npm run android:open      # Android Studio, to run or sign it
```

### Netcode: one simulation, two places

§15.1's core rule pays for itself here. The server imports `step` from
`src/sim` unchanged and runs it; a client holds no simulation at all. So a
cheating client is merely wrong about its own screen, and every cost, phase and
supply check is enforced once, in the place that decides (§15.1).

Everything the renderer sees arrives as a `MatchView`, never a `MatchState`:

```
     tap                     command                    step()
 renderer ───► Transport ───────────────► room ───────► simulation
     ▲              ▲                       │                │
     │              │      frame            │   viewFor(state, team)
     └── MatchView ──┴───────────────────────┴────────────────┘
                                      (one per client, filtered)
```

`Transport` (`src/net/transport.ts`) has two implementations and the renderer
cannot tell them apart:

|             | `LocalTransport`              | `RemoteTransport`                  |
| ----------- | ----------------------------- | ---------------------------------- |
| Simulation  | this tab                      | the server                         |
| Other lanes | scripted builders (`src/bot`) | other people                       |
| Commands    | applied immediately           | sent, applied at the next tick     |
| Fog of war  | `viewFor`                     | `viewFor`, before anything is sent |

That last row is the reason for the shape. If filtering were the renderer's
job, the hidden half of the match would already be on the client and fog of war
would mean "please do not look" — and single player would exercise a different
code path from multiplayer, which is exactly where a leak would hide. One test
asserts the opponent record's keys exactly, so a field added to `Team` or `Lane`
later cannot quietly become public.

**Frames are rows of numbers.** Views serialised as objects measured 144 KiB/s
for a player and 537 KiB/s at the §15.3 load for a spectator, which no phone
should be asked to carry. `src/net/protocol.ts` sends definition indices rather
than strings, positions quantised to a hundredth of a tile, HP as a byte, and
derives armour, damage type and body radius from the definition instead of
transmitting them. Same load: **32.7 KiB/s and 117.9 KiB/s** as JSON, and
Colyseus puts messages through msgpack, so those are upper bounds. `npm run
wire` measures it.

**Colyseus's state sync is deliberately unused.** Its `Schema` classes would
mean a parallel type tree mirroring `MatchState`, kept in step by hand, and the
simulation would have to be built out of `Schema` objects — putting a
networking dependency inside the module §15.1 insists has none. The room uses
Colyseus for what it is uniquely good at, rooms and matchmaking and a
websocket, and sends its own frames through `client.send`.

**Sending the command stream instead does not work here**, though determinism
(§15.1) suggests it should: it would be a few dozen bytes a tick. Lanes are not
independent. Enrage clocks run per wave and stop when that wave's last monster
dies in _any_ lane (§8), and combat ends only when every living lane is clear
(§3.2, amended). A client would need to know what is happening in lanes §12
forbids it from seeing. Snapshots it is.

**There is no client-side prediction yet**, and that is a choice rather than an
omission. Every command is a build-phase action, and in the build phase nothing
is moving, so one round trip reads as a slightly soft button rather than as lag.
Prediction needs a local simulation to predict into, and for the coupling reason
above a client cannot run one. If it turns out to feel bad on a real connection,
the cheap fix is to predict the _wallet_ — deduct the cost, show the unit as
pending — which needs no simulation at all.

**What is not deployed.** GitHub Pages is static (§15.2, hosting-dev), so it
cannot host a room: the public build serves a practice match against scripted
opponents in the other three lanes. That is not a stand-in for the networked
path — both go through the same `viewFor`, and `npm run netcheck` exercises the
real one with real sockets — but it does mean a four-player match needs someone
to run `npm run server`. Hosting, a lobby and matchmaking are M6.

### The lane: spawn zone, build grid, fortress zone

A lane is three bands of open ground, all in the same tile space. Above the
8 × 10 build grid is a spawn zone three tiles deep (`lane.spawnZoneDepth`),
where a wave lands as one packed hexagonal clump at the centre and crosses
before the first contact, so the fight starts in the open rather than on the
top build row. Below the grid is the fortress zone, one tile deep, with the
fortress as a body of radius 0.4 at its centre. Tiles matter for exactly one
thing — where a unit may be _built_ — and both sides may fight anywhere in the
lane, spawn zone included. The renderer square-fits the whole 8 × 14 lane and
derives the three bands from one tile size.

### Movement: engaged or seeking

Movement is described in full in [PATHING.md](PATHING.md), with every number
and the attempts that preceded it. The short version is three rules.

**A monster is going to the fortress unless something gets close enough to
fight.** That is §5.5's losing condition made into the default heading rather
than a fallback for an empty lane. A monster looks no further than
`lane.monsterAcquireRange` (3 tiles) for a defender; inside that it takes the
nearest, keeps it while it lives and stays in range, and never looks around
once it is trading blows. Defensive units follow the same rule with no
acquisition cap, since they have no fortress of their own to walk at.

The alternative — every monster going after the nearest defender anywhere — is
a global question that every body re-answers every tick, and the answer changes
for all of them at once whenever anything moves. That is what made one tower the
destination of a whole wave, and a lane defence in which a defender cannot be
bypassed is not a lane defence.

**Every body is either engaged or seeking.** Engaged means something is in
range: it attacks, it does not move, and _nothing moves it_ — it is an
immovable obstacle to ally and enemy alike. Seeking means nothing is in range:
it walks. Two bodies in contact could only shiver if something kept nudging one
of them, and now nothing can, which is where every version of face-to-face
jitter went.

**A seeker walks downhill on a distance field whose goals are the free attack
positions.** One multi-source Dijkstra sweep per (kind, body radius, range)
labels every cell with its distance to the nearest position from which an
enemy is in range and nothing is already standing — the annulus from touching
distance out to touching distance plus the range, around every enemy, minus
whatever is occupied. Obstacles are what will not move: enemies, engaged
allies, allies that cannot walk, each inflated by the seeker's radius. Allies
that are walking are not obstacles, because treating a moving crowd as terrain
is what made every earlier attempt oscillate. Goals are found at 4 × 4 samples
per cell, so a hole narrower than a cell that a body still fits is seen; and
when every attack position is taken, the goals become the positions beside the
allies that are attacking, so the rest wait where the next hole will open.

**A boss passes through monsters** (§3.4, decided) and is solid to everything
else. It is four times the width of the swarm it arrives with, and made solid to
them it spends the fight wedged in its own escort: measured against a defended
line, a solid boss never reached the line in 600 ticks and walked 3.2 tiles for
every tile of progress, where a phasing one engages at tick 270 at 1.05x. The
rule is symmetric, it is only about monsters, and it holds in the distance field
as well as in contact - a boss routes as though the swarm were not there, and
the swarm routes as though the boss were not. Defenders and the fortress wall
are unaffected, which is the half that must not change: a boss you cannot block
is a boss the lane cannot defend against.

Contact is move-and-slide: a proposed step is pushed out of everything settled
it would overlap, along the line between centres, so the component into an
obstacle is cancelled and the component along it survives. Seekers move in
order of distance to a goal, each resolving against the ones that have already
moved and walking through the ones that have not — which then yield when their
turn comes. Two bodies wanting the same hole cannot jam: the one further away
moves second and gives way.

| case                                          | result                                                       |
| --------------------------------------------- | ------------------------------------------------------------ |
| thirty melee monsters on one tank             | 8 of 8 holes refilled in under a second; ring never moves    |
| face to face for 20 seconds                   | movement 0.000000 tiles                                      |
| two rows of units, target off to one side     | 6 of 8 engaged (the geometric maximum)                       |
| wall of immobile allies with a gap at one end | 8 of 8 through                                               |
| left wall against right wall                  | skew −2.1% over 12 seeds (was 7.9%)                          |
| a real wave against a 3-deep block            | 8 of 8 engaged, 0.00 tiles of movement in the last 2 seconds |

**The sweep has to be exact, and for a long time it was not.** Dial's algorithm
linked its buckets with one forward pointer per cell, and re-filing a cell that
was already queued — which happens constantly — overwrote that pointer and
orphaned every cell behind it in the bucket it still sat in. Those cells were
never relaxed and kept whatever inflated cost they held, so about half of every
field was wrong, some of it unreachable with a good route available, and which
half depended on the order cells were scanned in. It read as a pathing problem
and never as a queue problem: waves wandered on one side of the lane and not
the other, bodies paused and restarted, crowds split. Nothing threw, and the
whole behavioural suite passed throughout. The buckets are doubly linked now,
and `flowfield.test.ts` checks the field against a plain relaxation pass over
the same grid rather than against how the bodies look.

There is no slot assignment, tangent steering, side commitment, stuck
detection, give-up timer, retarget interval, separation pass or tile
occupancy. Each existed to correct a symptom of the previous model and none is
needed under this one. Whole tick at the §15.3 load: 2.0ms of the 50ms budget.

### Attack animations, which the simulation decides and the renderer draws

A blow is a fact about the match, so the simulation records it: each tick every
lane carries the list of who hit what (`Lane.attacks`, cleared at the top of the
next tick). The renderer turns that into something to look at. The split is the
same one §15.1 rests on everywhere else, and it buys three things — a lane you
are watching animates exactly like your own, a replay animates, and a client
with the effects layer deleted plays the identical game.

Two ids per blow and nothing else. The renderer already knows where every body
is and keeps a tick of history for interpolation, so positions would be four
numbers where two will do: measured at the §15.3 load, the worst tick of a
spectator's frame went from 5.98 KiB to 6.03 KiB with twelve blows in it.
`FORTRESS_ID` stands in on either side, so a monster besieging the fortress and
the fortress weapon firing back are the same record shape.

**A shot looks like the thing that fired it**, and every channel is read off the
attacker's own definition so there is nothing to author:

| channel    | comes from  | so that                                        |
| ---------- | ----------- | ---------------------------------------------- |
| head shape | damage type | a dart, a slug, a shell or a mote              |
| colour     | damage type | the same fill §14.2 draws the body in          |
| size       | damage      | a mortar shell is not a thornling's dart       |
| speed      | range       | time in the air stays about 0.16s at any reach |
| trail      | armour      | two guns of one damage type still differ       |

Tier scales the head exactly as §14.2 scales a body, so an upgraded unit's shot
is recognisably the same shot.

**Melee is a swing, not a lunge.** A body's drawn circle is also its collision
circle and its hit circle, so moving it to animate an attack would either be a
lie about where it is or a change to where it is — and the crowd behaviour that
took eleven attempts to get right depends on it not moving (see
[PATHING.md](PATHING.md)). So the attacker stays exactly put and the animation
happens around it: a crescent sweeping across its near face through the
direction of the blow, fattening to the middle of the swing and thinning away
again, with slivers thrown off the point of contact. Nothing in the effects
layer reads or writes a body. A test asserts that literally, by comparing the
attacker and target before and after a frame.

The flash is drawn at the attacker's damage-type colour mixed halfway to white.
A hammer and a grub are both Impact, and an amber swing between two amber
bodies is invisible; lightening keeps §14.2's colour channel while making the
blow readable against a body wearing the same hue.

**Every effect is a filled shape; nothing strokes a path.** Pixi v8 carries path
state between draws — after each fill or stroke it seeds the next path with a
point from the previous one, falling back to (0, 0) when there is none — so a
stroked path can pick that up and draw a line to the corner of the screen. Each
effect is therefore an explicit vertex list passed to `poly()` and filled, with
a `moveTo` at the shape's own first vertex pinning the seed to the shape. A
connector cannot be drawn because there is nothing to connect.

Effects run on wall time rather than ticks — a 170ms swing is ten frames at
60fps and three at 20Hz — and store their positions in tiles, so a resize
mid-flight carries them with everything else. They are capped at 256 live, an
order of magnitude above what a busy tick produces.

### The fortress aura, drawn

§10.1 sells two upgrades and offers one choice — Aura Power, Aura Radius, and
which of four auras is running — and until now all three were invisible. The
weapon's damage type at least recoloured the shots it fired; an aura changed
numbers behind the scenes and nothing on screen, which makes the whole tab a
guess.

Three channels, one per thing the player bought:

| channel  | comes from   | drawn as                                       |
| -------- | ------------ | ---------------------------------------------- |
| radius   | Aura Radius  | a bright rim with a wash of held ground inside |
| type     | the aura tab | a motif that differs per aura                  |
| strength | Aura Power   | opacity, and how much of the motif there is    |

The motifs say what the aura does rather than merely differing: **damage** puts
chevrons on the rim pointing out of the fortress, because that is the direction
the buff acts in; **attack speed** runs rings outward, because speed is the one
channel that reads as motion rather than as shape; **armour** is a still lattice
of scales, because armour does nothing until something hits you; and
**regeneration** drifts motes up the lane, because a thing being given back
should look like it is travelling.

The rim is drawn at the radius `auraFor` actually measures, centred where it
measures from, so a unit inside the line is buffed and a unit outside it is not
— the drawing is the rule rather than an illustration of it. The aura tab's
chips carry the same four colours and now print the radius and the strength, so
buying Aura Power changes a number there and the ground in the lane at the same
time. It sits under the bodies so it never obscures a fight, runs on wall time
like the effects layer, and the simulation neither reads it nor knows it exists
— `aura.test.ts` asserts that literally, and that each channel moves when the
thing it stands for is bought.

### Every body has its own silhouette

§14.2 gave one shape per armour type - circle, hexagon, diamond, triangle
cluster. That is four shapes for thirty-seven bodies, and a crowd of identical
hexagons tells you nothing about which of your units is which. Every unit and
monster now has its own silhouette, thirty-seven in all, assigned in the data
(`shape` on each definition) from a catalogue in `render/shapes.ts`.

What §14.2 was protecting is kept as a rule about **families**: round things
are Flesh, angular things are Plate, pointed and stellar things are Ward, and
clusters of small things are Swarm. The counter-read still works at a glance and
without colour - a wall of angular shapes is a wall of Plate whether or not you
can name each one - and within a family every member is distinct. `SHAPE_FAMILY`
in `schema.ts` is the assignment; `validate.ts` refuses data on load if a shape
is in the wrong family for its armour, if two bodies on the field share one, or
if a tier does not carry its base's shape up the chain (§7.3: an upgrade is the
same unit).

The wave preview (§9.3) draws them too: each incoming monster's shape sits
under its count and name, at the size it will be in the lane and in the same
outline-means-monster convention. "4× Husk plate" tells you what is coming only
if you already know what a Husk looks like; the shape below it is the thing you
will actually be picking out of a crowd thirty seconds later. One size for all
of them - the preview is a key, not a scale model, and the HUD already says BOSS
in red.

The catalogue is geometry first and pixels second. `silhouette()` returns plain
vertex lists and circles inside the unit circle; `drawEntity()` scales and
paints them. That is what makes it testable without a canvas: every shape is
checked to stay inside the body's collision radius - what you see is exactly
what collides, §4.2 - to fill at least eight tenths of it, and to be unlike
every other. Fused shapes such as a teardrop or a crescent are traced as one
polygon rather than built from overlapping primitives, because a monster is
stroked and stroking a union draws every seam.

### The build grid, and what a unit button shows

Two small things that both come down to §14.2: show the player the thing
itself, and only while it is the thing they are working with.

**The grid is drawn bright, and only during the build phase.** A tile is
something you aim at for thirty seconds and then stop caring about entirely -
once a wave is in the lane nothing you can do is tile-aligned, and a lattice
over a fight is one more thing for the eye to pick through. So the lines come
up at full strength when they are what you are working with, and vanish when
they are not.

**A unit button carries the unit's own silhouette, not a coloured square.**
The same armour shape, the same damage-type fill, the same tier pips that
§14.2 draws on the board, from the same `drawEntity` the entity layer uses - so
the thing you tap and the thing that appears on the tile are drawn by one
function and cannot disagree. Choosing what to build is choosing a shape you
will have to pick out of a crowd three seconds later, and a row of identical
squares teaches you nothing about which shape that is. The chips that really
are just a colour - a damage type on the Aura tab, a tech track - stay squares,
because that is what they are.

### The selected unit: what it says, and selling it back

Tapping a unit on the board replaces the Build grid with a panel about that
unit: what it is, six numbers, a line of prose, and three buttons.

The six numbers are HP, Damage, Dmg/s, Range, Atk spd and Move, two across and
three down. Each reads `now` or `now → after the upgrade`, and **the arrow
appears only where the tier actually changes the number** — a panel that draws
an arrow between two identical readings is claiming an upgrade bought something
it did not. `Dmg/s` is derived rather than authored, because damage and attack
speed mean little apart: a tier that trades one for the other looks like an
upgrade in one cell and a downgrade in the next until you multiply them. Range
below the melee threshold prints as `melee`; §5.2 measures reach edge to edge,
so a melee value is a hair over zero and the digits are true but useless.

These are **definition** numbers. Tech (§7.4) and the fortress aura (§10.1)
multiply on top of them and are shown on their own tabs. Folding them in would
make the tier comparison — which is what the panel is for — move for reasons
that have nothing to do with the tier.

The prose line is `UnitDef.traits`, and it is **descriptive only**. Nothing in
the simulation reads it. A line there does not give a unit an ability; it
describes one the rules already give it, so the mechanic is built first and the
line written second, or the panel starts lying. It is empty for every unit
today; the place exists and the schema carries it.

**Selling** is the third button, and the rule is in
[OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) — full price inside the build phase that
bought it, half afterwards, per purchase rather than per unit. What matters
architecturally is where the price is computed. Each unit carries two numbers,
gold spent this build phase and gold spent earlier, and the view sends **those
two numbers rather than the refund they add up to**, so the client prices the
sale by calling the simulation's own `sellValue`. There is one rule in one
place, and the number on the button cannot drift from the number the command
pays. The alternative — the server quoting a price the client displays — would
need a round trip per selection and would lag the tap.

This is the one place the wire format knowingly does not follow its own
"derivation over transmission" rule. The total paid for a unit _is_ derivable
— it is the sum of gold costs along its upgrade chain — and only the split by
phase would then need sending, at a measured 37.1 against 33.1 KiB/s for a
player at the §15.3 load. It is sent whole anyway, because the derivation
quietly assumes every unit on the board was paid for at list price. The day
something grants a free unit, the two numbers would part company and nothing
would say so.

### Bodies, contact and range

Every body is a disc swept along a horizontal segment, and that shape is its
collision shape, its hit shape and its drawn size at once, with the radius on
the unit or monster definition. There are no other shapes and no tile occupancy:
a unit is a solid round thing a monster walks around, not a square it may not
enter. What you see touching is what is touching.

The segment has no length for every unit and every monster, which makes them
circles — one clamp on the x axis and the arithmetic is identical. It exists
for the **fortress**, which is a wall across the end of the lane rather than a
pebble at the middle of it. It spans the full eight tiles, so nothing walks
around behind it, and its front face is a straight line the width of the lane:
a wave meets it along a front and a dozen or more monsters hit it at once
instead of queueing for the two contact points a 0.4-tile circle offered. It is
solid to units and monsters alike, and the renderer draws it from these numbers
rather than from a rectangle that looked about right, so the wall you see is
the wall that stops you.

Attack `range` is measured **edge to edge**, not centre to centre, and against
the nearest point of the other body's segment rather than its centre. A melee
value near zero therefore means "walk up until the bodies touch". Centre-to-
centre range left every attacker standing a full body-width short of its target,
which looked wrong for melee. A range check has 0.12 tiles of hysteresis, so a
target drifting across the boundary cannot flip its attacker between fighting
and walking.

**A besieged fortress used to take no damage at all.** The field records which
enemy each attack position belongs to, so a melee body that reaches a cell can
walk the last fraction into contact; cells with no goal recorded read as
`NO_OWNER`. That sentinel was −1, and `FORTRESS_ID` is also −1, so every
position around the fortress read as unmarked. Monsters walked to the wall,
stood on a goal cell, and never took the last step. It looked exactly like a
pathing quirk and was an id collision; the sentinel is now a value no entity can
hold, and `src/sim/siege.test.ts` fails if a monster at the wall stops hitting
it.

### How the renderer drives the simulation

The browser paints at whatever rate it likes; the simulation runs at exactly 20
ticks per second and must never see a frame time, or two phones would compute
different states and the §15.1 guarantee would be gone. `util/loop.ts` is the
accumulator between them — in the browser, and in the server's room, which
faces the same problem from the other side:

```
frame (deltaMS)  ->  FixedTimestep.advance
                       |- runs whole ticks only, at most MAX_CATCHUP_TICKS
                       |- exposes `alpha`, the fraction of a tick elapsed
                       `- drops the backlog rather than spiralling
```

Two consequences worth knowing:

- **Interpolation is a rendering concern.** `EntityLayer` keeps every body's
  previous position and lerps by `alpha`, so a 20Hz simulation draws smoothly at
  60fps. The simulation stores no such thing. It interpolates from the view
  being _replaced_, which works identically for a local tick and for a frame off
  a socket.
- **A long stall drops simulated time on purpose.** After a backgrounded tab or
  a GC pause, catch-up is capped and the remainder is discarded — better a match
  that skips than one that locks up. A side effect is that wall-clock
  fast-forwarding cannot be used to speed a match up in tests.

Input goes out through the transport and is never applied by the renderer.
Locally that is immediate, so the UI can show _why_ a tap was refused on the
same frame; remotely it is a round trip and the refusal comes back as a message.
Either way it is the same `applyCommand` the simulation uses, so a tap costs the
same in both modes.

Implemented and tested (344 tests):

- Seeded RNG and per-wave derivation (§9.2)
- The damage matrix and its row/column invariant (§6)
- Enrage: additive, capped, per-wave clocks (§8)
- Targeting — both kinds hold a target while it is alive and in range, and
  otherwise take the nearest in range (§5.1, §5.2, amended)
- Movement — engaged-or-seeking bodies, a distance field to the free attack
  positions, move-and-slide with yielding (§5.3 and §4.2, both amended)
- Wave generation as a pure function of (seed, waveNumber), boss waves, scaling
  past the authored range, and the build-phase preview (§9.1–§9.3, §3.4)
- The reserve queue and the lane cap (§8.1)
- Commands: place, upgrade in place, weapon type, aura, tech, fortress, supply
  and send — with cost, supply, tile and phase validation inside the simulation
  (§7.3, §11.4, §3.2)
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
- Sends: cost, the target being the sender's choice, the bounty going to the
  defender, no sending from the grave, and the build-phase and wave-25 windows
  (§11.5, §13, §3.1, §3.3)
- Fog of war as a pure function of state and viewer, with the opponent record's
  keys asserted exactly so nothing can quietly become public (§12)
- The wire format: round trip, quantisation bounds, and that a frame cannot
  carry what the view withheld (§15.1)
- The local transport: whole-tick advance, immediate commands, drained
  refusals, and the same filtering the server applies (§15.1)
- The networked path end to end, over real sockets — `npm run netcheck`: lane
  seating, per-client frames, a purchase landing only in the buyer's lane, a
  client failing to act for another lane, refusals reaching whoever asked, and a
  send buying sight of a lane without its wallet (§12, §15.1)
- Every builder against the rules that define one: six units, all four damage
  types, a tier 2 on everything, upgrade chains that resolve, upgrades priced
  below their value, bodies that fit the lane's routing, and a distribution
  distinct from every other roster's (§6.1, §7.1, §7.3)
- One roster per lane: the default, an unknown builder refused, another
  builder's unit refused, and the roster fixed once anything is on the board
- Selling a unit back: full price inside the build phase that bought it,
  including an upgrade bought in it; half in a later one; a fresh upgrade on an
  old body still refunded in full; supply returned whole; the tile freed; the
  unit removed rather than killed, so it does not respawn; and refused in
  combat and from wave 25 (§11, decided)
- What the selected-unit panel says: the arrow only where a tier moves the
  number, never between two identical readings, across every unit in the game
- Besieging the fortress: a monster that reaches the wall engages it and keeps
  hitting it, a whole wave brings its weight to bear at once rather than
  queueing, and nothing walks through the wall or around behind it (§5.5)
- The fortress as a swept disc: blocked along its whole length, offering attack
  positions along its whole face, and identical to the old circle when the
  spine has no length
- The aura: nothing drawn without one, something for every aura the data
  defines, each of the four visibly different, and all three channels moving
  when the thing they stand for is bought (§10.1)
- A boss phasing: it shares ground with monsters, never overlaps a defender by
  more than contact tolerance, and reaches a defended line through its own
  escort instead of milling in it (§3.4)
- The resource building: one gem every two seconds from the start, paid during
  the build phase as well as combat, +1 per payout per output level, a rate
  ladder that is additive rather than compounding, and both ladders refused
  when the GOLD is missing rather than the gems (§10.2, §11.3, amended)
- The distance field against a plain shortest path, cell for cell, on forty
  random layouts, and that a mirrored layout produces a mirrored field - the
  two tests that catch a wrong field rather than a wrong-looking crowd
- Rule zero: a monster ignores a defender it has not reached, takes one that
  comes inside its acquisition range, keeps it rather than swapping every tick,
  and goes back to the fortress when it dies (§5.1)
- The silhouette catalogue: every shape inside its collision circle and filling
  a fair share of it, no two alike, drawable filled and stroked; and the data
  giving every body on the field its own, in its armour family, carried up each
  upgrade chain - with the validator shown to refuse a duplicate and a
  wrong-family shape (§14.2, amended)

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
- **Hosting** (§15.2) — the last piece of M6, and the only one that is money
  rather than code. A four-player match needs someone to run `npm run server`,
  and clients reach it with `?server=`; GitHub Pages is static and cannot host a
  room. The lobby, matchmaking and reconnection that were listed here are built.
- **A signed APK** — `npm run build:android` produces the native project, but
  compiling it needs the Android SDK and Google's Maven repository. Nothing is
  missing from the project; it is a machine with the SDK on it.
- **Server-side accounts** (§18) — identity is a player id this device
  generated, which is what seats and reconnection need and no more. A ladder or
  anything purchasable needs a credential a server holds, and that needs the
  server first.
- **Client-side prediction** — deliberately absent, see the netcode section. The
  cheap version, predicting the wallet rather than the simulation, is the one to
  build if the round trip turns out to feel bad.
- **Object pooling** (§15.3) — entities carry an `alive` flag and dead monsters
  are swept on the tick they die, which is the shape pooling wants, but there is
  no free list yet. Scratch vectors and the reused distance fields already avoid
  per-tick allocation.

## Stack

Per DESIGN.md §15.2. TypeScript everywhere, Pixi.js for rendering, Vite for the
build, Vitest for tests, Colyseus for multiplayer, Capacitor for the Android
build (§17, M6).

Colyseus is pinned at 0.16 on both sides, because the JavaScript client has not
been released past 0.16 while the server is at 0.18, and a mismatched pair is
not worth debugging. The server half also pulls in a dependency tree with
several npm audit advisories (a `nanoid` one rated high). None of it reaches the
shipped bundle — `npm audit --omit=dev` reports zero — but it wants addressing
before this server is ever exposed to the internet, which is M6's problem along
with hosting it at all.

`vite.config.ts` sets `base` to `/lane-siege/` for GitHub Pages. Override with
`VITE_BASE` for anywhere else; Capacitor will want `./`.
