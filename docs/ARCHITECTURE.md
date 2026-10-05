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
makes one transform enough. The Final Showdown's arena is the one exception and
has a camera that moves — its tile space is its own, a 32 × 32 square with the
corners cut out, and nothing in a lane knows about it.

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
a unit, tap a tile, watch the wave arrive. Pixi, fixed portrait layout, colored
shapes, touch build UI, one builder, as §17 specifies.

M3 (full single lane): all six units of builder A with tiers, global tech,
fortress and resource upgrades, gems, supply, 25 authored waves, a four-boss
bank, and an ending that terminates. §17 calls this "the point at which the
game is balanceable", and it is: every lever is a field in `data/`.

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
(§11.1, the doc's recommendation), **no purchase of any kind is available once
the Final Showdown opens** (§3.3's OPEN question, overtaken: the arena is
fought with the army you brought, and every build phase before it — including
the one before the last wave — is fully open), and §12's public record is
fortress HP plus alive-or-out, with the balance sheet never public under any
circumstance.

Selling a unit back is answered in the same register, though §11 never asked:
full price inside the build phase that bought it, so a misclick on a 30-second
clock is undoable, and half in any later one — see
[the selected unit](#the-selected-unit-what-it-says-and-selling-it-back).

### Four builders, differentiated by shape

§6.1 is the constraint that makes this interesting: every builder must field all
four damage types, because every lane faces the same wave. So builders cannot be
differentiated by what they can answer — only by _distribution and quality_.
Four rosters, each excelling at a different **pair** of damage types:

| builder    | strongest       | armor lean | costs               | shape                                              | and what it does                                      |
| ---------- | --------------- | ---------- | ------------------- | -------------------------------------------------- | ----------------------------------------------------- |
| Ironvow    | Impact + Pierce | plate      | 40–95g, 2–3 supply  | the reference: a melee wall with snipers behind it | oaths: taunts, wards, answered blows, judgements      |
| Pyre       | Blast + Impact  | flesh      | 48–98g, 2–3 supply  | hits hardest, dies fastest, charges most           | heat: `burning`, escalation, and dying loudly         |
| Thornweald | Arcane + Pierce | ward       | 34–84g, 1–2 supply  | cheap, quick, numerous; folds to an Impact wave    | growth: roots, `blighted` rot, and a line that mends  |
| Gloomtide  | Blast + Arcane  | swarm      | 62–105g, 2–3 supply | longest reach, fewest bodies, thinnest line        | pressure: `soaked`, chill, and chains through the wet |

Three axes do the work, and all three are consequences of rules that already
existed:

- **Armor lean decides which wave punishes you.** The matrix runs in both
  directions (§6), so a roster built on ward bodies takes 1.5× from Impact —
  and Impact is what the early waves mostly deal. Verdance is therefore
  genuinely harder early and stronger later, without a single special case.
- **Supply is the cap that binds** (§11.4), so a roster's character is its value
  _per supply_, not per unit. Gloomtide's identity is concentration: fewer, more
  expensive bodies with the longest reach and the least health.
- **Every unit has an ability, and three of the four rosters have a WORD.** See
  [abilities](#abilities-a-trigger-a-target-some-effects-and-a-price). The
  names are part of it: `Ironvow` fields Pledge, Oathwall, Sentinel, Judgement,
  Sanction and Vigil, and the abilities are Hold the Line, Riposte, Verdict,
  Censure. A player who has read one of those names has been told something
  about the other five.

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

### Abilities: a trigger, a target, some effects and a price

Thirty-seven bodies that differ only in HP, damage, armor type and damage type
is a spreadsheet. So every unit in the game has an ability — the signature one
from tier 1, its numbers rising with the tier, and a second one unlocked at the
top of its ladder — and every boss and five of the nine monsters have one too.
None of them live in code. `src/data/abilities.ts` is the shape of an ability
and `data/abilities.json` is the sixty of them.

**Every ability is the same four fields.** When it happens, who it happens to,
what happens, and what it costs:

```json
{
  "id": "hold_the_line",
  "name": "Hold the Line",
  "text": "Roars every few seconds and drags the nearest attackers onto itself.",
  "role": "control",
  "numbers": { "period": 5.0, "radius": 2.2, "targets": 3, "hold": 2.0 },
  "ranks": [{}, { "radius": 2.8, "targets": 4, "hold": 2.6 }],
  "trigger": { "when": "interval", "everySeconds": "@period" },
  "target": { "what": "enemiesInRadius", "radius": "@radius", "max": "@targets" },
  "effects": [{ "kind": "control", "control": "taunt", "durationSeconds": "@hold" }]
}
```

A stacking slow on hit and a shield for three allies every six seconds are the
same four fields with different values, which is the point: a new ability is a
JSON entry, and a new KIND of ability is one case in `applyEffect`.

**`"@name"` and `ranks` are why the catalogue is sixty entries and not a
hundred and forty.** A unit's tier 2 usually wants the same ability with one
figure raised. Duplicating the entry per tier is how the stat blocks work, and
it would have tripled this file for the sake of one number — so an ability
names its numbers, refers to them as `"@period"`, and lists per-rank
overrides. Rank 1 is the map as written; a unit asks for
`{ "id": "hold_the_line", "rank": 2 }`. `resolveAbility` turns a definition
into a struct in which every field is already a number, once, when the match's
definition index is built — so a tick never resolves anything (§15.3).

**What is live, and what is vocabulary.** `IMPLEMENTED_EFFECTS` is the set of
effect kinds the simulation honours: `modify` (any of twelve stats, as a
multiplier or a flat amount), `damage` (flat, a share of max, current or
missing HP, or a multiple of the attacker's own swing, optionally bypassing
armor entirely), `damageOverTime`, `heal`, `regen`, `shield`, `control`
(stun, root, disarm, silence, taunt), `execute`, `immunity` and `energy`.
`EFFECT_KINDS` is longer: summons, resurrection, knockback, pull, teleport,
transformation, spirit link, amplify-and-detonate, path blocking, cost
reduction, sell value and bonds are all typed, validated and inert. Those live
in `abilities.json`'s `planned` list, and **`validate.ts` refuses to let a
unit, monster or send reference one**. That rule is the whole reason the
mechanism is trustworthy: the ability's own `text` is what the panel shows a
player, and unlike a `traits` line it cannot describe a rule the game has not
got.

**Support aims at the front line.** `nearestAllies` takes whoever stands
closest, which for a support unit set back in the line is the units beside it
and behind it - the ones nothing is hitting. `frontAllies` takes the allies
inside its radius that stand furthest forward instead, nearest first only
between two that stand level. Forward is the ability environment's to say
(`AbilityEnv.forward`), since it differs by side and by world: up the lane for
a unit, down it for a monster, and inward toward the centre in the arena.
Vigil's Warding Light and Absolution both use it.

**Stacking is a rule, not a number.** `from: "any"` stacks on every
application; `"perSource"` gives one body one stack, so a unit cannot stack its
own debuff by attacking faster; `"perSourceType"` gives one UNIT TYPE one
stack, so stacking it means fielding a mixed line rather than six of the same
thing. Percentages compound rather than adding — two 20% slows leave 64% of the
speed, and no number of them reaches zero, because a slow that reaches zero is
a root and a root is a different effect with its own limits.

**Crowd control cannot be held forever.** §18's diminishing returns, in
`abilities.json`'s `control` block: the first control effect inside the window
lasts its full duration, the second half of it, the third a quarter, and once
the ladder is spent the body is immune for five seconds. Counted per body, and
the Final Showdown dampens every duration on top of that (§3.3, replaced), so a
table of stun units cannot hold a wave — or an enemy army — still.

**A tag is the synergy channel.** Three of the four rosters apply a word and
then charge for it. Pyre's Kindle, Emberdust and Slagshot leave `burning`;
Firestorm and Conflagration do more damage to anything carrying it, and
Wildfire spreads only to what is already alight. Thornweald applies `blighted`
and Heartpiercer collects. Gloomtide applies `soaked` and Torrential, Hailburst,
Undertow and Drownward all collect. A builder whose units want to be built
together is the whole reason a roster is a roster and not six unrelated
purchases.

**Energy is what makes an expensive ability a rhythm rather than a cooldown.**
Every body has the same pool, fills it passively, and tops it up on a kill, and
the ability a three-tier unit unlocks at the top of its ladder spends it —
Interdict's area stun, Absolution's cleanse, Conflagration, Pyroclasm,
Blightbloom, Cloudburst. So the big ability fires on a rhythm set by the fight
rather than by a bare timer, and a unit that is not killing anything fires it
less often. Gloomtide's Murmur grants energy directly, which is what makes it
worth its supply.

**Energy belongs to the fight, so nothing spends it outside one.** No ability
that costs energy fires during a build phase (`AbilityEnv.fighting`), because
everything it could be spent on there is spent on nothing — Absolution
cleansing allies nobody has stunned, Closing Ranks buffing a line with thirty
seconds to stand in — and the unit then met the wave with a part-empty pool.
Only the energy ones need the rule: an ability with no cost that fires at
nothing finds no targets, and `cast` gives up before charging itself a
cooldown.

**And every unit meets every wave with all of it.** A build phase hands each
one a full pool (`respawnUnits`), a unit bought mid-phase is built with one,
and the Final Showdown opens with one for the same reason it opens with full
HP — a pool that carried over would make the wave after a long fight quietly
weaker than the one after a short fight, for a reason no player could see. The
"built with one" half was a bug for a while: `createUnit`'s energy ceiling
defaulted to zero and the call site that builds a unit a player paid for did
not pass it, so every unit spent its first seventeen seconds filling a pool it
should have started with. The parameter is required now, which is the only
version of that fix that stays fixed.

**Two files hold the rules, and each is the only place its thing happens.**
`strike.ts` is the one place a body's HP goes down, and `dampening.ts` the one
place it goes up. Evasion, wards, criticals, the §6 matrix, vulnerability,
lifesteal and reflection are all inside `dealDamage`, in that order, which is
what makes the modifiers reliable — an ability that raises the damage a body
takes raises _all_ of it, and a ward eats whatever arrives next. Damage applied
anywhere else would quietly ignore both. Only an ATTACK can be evaded, warded
or critical; a burn is a consequence of a hit that already happened, and letting
it miss again would make one dodge worth two.

**A passive is a status that keeps being renewed.** There are no permanent
buffs. A `passive` ability fires every tick and applies statuses lasting two
ticks, so an aura is self-cleaning: walking out of one lets it lapse a tick
later with no bookkeeping. The alternative — adding and removing auras as
bodies move — is a bug farm, and units advance now (§5.2, amended), so aura
membership genuinely changes constantly.

**Spell immunity is a filter, not a check.** A body immune to abilities is
removed during target selection rather than tested inside each effect, which
makes the rule total: nothing an ability does can reach a Revenant, damage
included. That makes it a real answer to an ability-heavy line rather than a
monster that shrugs off some of it.

**Firing is re-entrant, so target lists are pooled by depth.** An ability's
damage lands, that fires the target's `onHurt`, and that selects targets of its
own — inside the loop still walking the first ability's list. One shared scratch
array would be overwritten underneath it. A pool indexed by nesting depth keeps
§15.3's no-allocation rule and is correct at any depth.

**Every roll goes through the match's own generator.** One `Rng` is restored
from `state.rngState` at the top of each tick and written back at the end, so a
critical, an evade and a 35% proc are all part of the deterministic stream
(§9.2, §15.1). A second generator, or `Math.random`, would make replays and
desync detection lies.

Cost: a lane tick went from 1.51ms to 2.51ms at §15.3's load (3.0% → 5.0% of
budget) and the showdown from 4.84ms to 6.92ms (9.7% → 13.8%). `npm run
routing` prints the same numbers to four decimal places as it did before, which
is the check that mattered — the movement guarantees are untouched.

### Fog of war is a setting, not a law

`viewFor` takes which of three rules is in force, and `data/lane.json` picks it:
`granted` is §12 as written (a send buys sight), `combat` opens every lane while
a wave is running and closes them for the build phase, `always` never closes
them. The shipped default is `combat`.

The reasoning is in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md): fog during combat
turned four players into four solitaires, while fog during the build phase is
the half that was doing real work — what you are building stays private until it
fights. What is never visible under any of the three is the balance sheet.

One thing is public under all three and always was worth saying out loud: **who
somebody is**. `OpponentView.name` carries the display name, the four tabs
across the top are labelled with it, and the leak test in
`src/sim/multiplayer.test.ts` lists it alongside fortress HP as part of §12's
public record. Fog is about what a player has BUILT; the point of four labelled
tabs is knowing who is being worn down. Names travel in the hello rather than in
every frame, because a name does not change once a match has begun — the server
re-sends it at kickoff with the lobby's final list, and again on a reconnect.

The existing machinery is untouched, which is the point: sends still grant
vision, the opponent tabs still gate on `watching`, and the camera still comes
home by itself when sight lapses — which under `combat` is what happens when the
wave ends. Turning the fog back on is one word in a data file.

### Getting into a match: code, seat, identity

Three ways in, and the front screen offers all three because the answer to "can
I play right now" should never be a menu waiting for a server:

- **Practice** is simulated in this tab with scripted builders in the other
  three lanes, each playing a personality rolled for the match (below). It
  needs nothing, and it is what the GitHub Pages build serves.
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
the one attribute Capacitor cannot express — `screenOrientation`, which is
`fullUser` — is applied by `scripts/prepare-android.mjs` rather than by
committing sixty files of Gradle scaffolding. The script is idempotent and
fails loudly rather than leaving the app quietly wrong, and because `android/`
is generated once and then reused, it rewrites an existing value rather than
only filling in a missing one: a checkout that ran the portrait-locked version
of the script still has that lock sitting in its manifest, and gets corrected.

**Orientation is the player's, on every platform.** `fullUser` allows all four
and still obeys the device's own rotation lock, so a phone held upright stays
upright and a phone with auto-rotate on may be turned. Nothing is locked in a
browser either: the earlier code attempted `screen.orientation.lock` (allowed
on Android only while fullscreen, which a page cannot enter without a gesture;
never on iOS) and showed a notice asking for the phone to be turned upright.
Both are gone, and so is `src/render/ui/orientation.ts`. What replaced them is
a layout that has something to show either way round — see **Two arrangements**
below — so there is nothing left to ask the player for. When an iOS project
exists it wants `UISupportedInterfaceOrientations` listing all of them too.

**The layout follows the renderer's size, checked every frame, not a `resize`
event.** This was a bug worth remembering. Pixi's own resize plugin listens to
`window`'s `resize` and only _queues_ the new size, applying it inside a
`requestAnimationFrame` — so a listener added after it reads `app.screen`
before it has been updated, and gets the size the canvas had a moment ago.
Rotating a phone therefore laid the game out for the orientation it was just
in, and rotating back laid the sideways arrangement inside an upright canvas:
the board across the left half of the screen and the build bar off the bottom.
Comparing the numbers at the top of the frame loop fixes the ordering and
covers every other thing that can change them — browser chrome appearing, a
soft keyboard, a desktop window drag — with one rule and no guessing about when
the viewport has settled. `computeLayout` runs only when they actually differ.

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
derives armor, damage type and body radius from the definition instead of
transmitting them. Same load: **32.7 KiB/s and 117.9 KiB/s** as JSON, and
Colyseus puts messages through msgpack, so those are upper bounds. `npm run
wire` measures it. With sends' own pool on the field (§8.1, amended) the worst
a lane can show is a full wave and a full pool of sends, and the harness loads
that: 83.0 KiB/s and 293.8 KiB/s.

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

**The spawn zone belongs to the attacker.** §5.2, amended, let a unit with
nothing in range advance anywhere in the lane, and measurement showed where
that ends up. With a line built on the top four rows and forty grub packs
incoming, the mean unit stood at y = **-0.14** — the whole defence inside the
spawn zone, camped on the point the wave arrives at — twenty-nine of
thirty-two units were in the zone at once, and monsters only ever occupied
**4 of the lane's 14 rows**. Three things were wrong with that at once: a wave
was born inside a wall of bodies instead of on open ground, so its numbers
never came to bear and a send against that lane was money thrown away; the
fight was a four-row scrum with ten rows of empty lane behind it; and §4.2's
whole point — a front line to absorb, a back line to deal damage — was
flattened, because the engine walked every unit to the door regardless of
where the player put it.

So a unit's lane is the lane without its spawn zone (`unitLane` in
`src/sim/context.ts`): two `World`s over one strip, same grid, different edges.
A unit advances to the top of the build grid and holds; a ranged one still
shoots into the zone, because reach is not a boundary. It is a steering rule
rather than a wall — contact uses the whole lane, since clamping a body between
an invisible edge and a crowd cost the no-overlap guarantee — so a unit shoved
a hair over the line simply walks back out. Nothing new in `data/`: the grid's
top edge already exists.

The same measurement after: **0 units** in the zone (deepest advance y =
0.047), **0 monsters born overlapping a unit** (was 5 in 140), the cap still
held 77% of combat, and the wave now reaches 13 of 14 rows as the line gives
way. Spawn placement was tightened to match — the hex lattice is ten rings
deep, far more than the zone holds, so points that would put a body outside it
are skipped rather than spawning out of bounds and being shoved back in.

### Two pools on the field: the wave and the sends

§8.1 caps a lane at `maxConcurrentMonsters` on the field at once, with the
excess queued in a reserve that feeds in as bodies die. That cap used to be
shared, so a wave that filled it pushed the sends that joined it to the back
of the queue, and a flood of sends held the wave back. **There are two pools
now** (§8.1, amended): `maxConcurrentMonsters` (30) for what the wave brought -
in solo's endless wave, the stream and its bosses - and `maxConcurrentSends`
(30, equal on purpose) for what was sent. A full wave and a full complement of
sends can stand in a lane together, sixty bodies.

- **One queue, read per pool.** `lane.reserve` is still a single list, but a
  slot freed in a pool goes to the first body waiting for THAT pool
  (`admitFromReserve` in spawn.ts; `poolOf`, `poolCap`). Each pool keeps its
  own order, and neither waits behind the other.
- **Room means ground too.** The clump's spacing gives the spawn zone room
  for about thirty-seven of the usual 0.22-tile body - a wave alone never needs
  more, and a wave and its sends can. A body the zone has no ground for is not
  stacked on the centre to be shoved apart by contact resolution, which
  arrives as a burst: it waits at the head of the queue (`packWave`) and walks
  in as the clump moves off, a few ticks behind it. So `admitFromReserve` runs
  every tick there is a queue, not only when something dies, and admits a body
  only where `freeSpawnPoint` finds it a place.
- **What it costs.** The expensive part of a tick is the distance fields:
  one per kind of walking body per lane, each marking every body in the lane
  and, for a unit, a ring of attack positions around every monster at that
  unit's reach. Twice the monsters is twice the rings. Measured with a real
  line of every unit kind (`npm run perf`): four lanes with a full wave each,
  10.9 ms of the 50 ms tick; with a full pool of sends as well, 20.4 ms. On the
  wire (`npm run wire`): 83.0 KiB/s for a player and 293.8 KiB/s for a
  spectator of all four lanes, up from 52.4 and 171.3, as JSON and so upper
  bounds.
- **What made room for it.** A unit's field is a lane minus the spawn zone,
  and a long-reach unit's ring around a monster still in that zone was being
  sampled cell by blocked cell at the fine resolution, for nothing. `markRing`,
  `markObstacle` and `markCrowd` now stop at `FlowField.open` - the rectangle
  of cells with any ground inside the world, set by `markOutside` - which
  changes no field (every cell past it is blocked at both resolutions already)
  and took a third off the tick: 15.7 ms to 11.3 ms with a full wave, 34.8 ms
  to 19.2 ms with sends as well. The harness used to measure a line of one
  melee unit, which read a third of the true cost; it measures a mixed line
  now.
- **Where that leaves a phone.** An online match is simulated on the server,
  and solo is one lane, so neither is close. The heavy case is a practice match
  late in the game, where the phone simulates all four lanes itself and the
  scripted lanes send at each other: at a few times slower than the machine
  the numbers above came from, that can approach the budget. The loop catches
  up at most `MAX_CATCHUP_TICKS` ticks a frame (src/util/loop.ts), so the
  failure is slow motion rather than a spiral, but it wants checking on a real
  mid-range phone.

### The Final Showdown: one arena, four armies

§3.3 ended a match with an attrition endgame — from wave 25 nothing could be
built and nothing respawned, and increasingly nasty waves ground the table down
until one player was left. That is a race against a clock, settled by who
banked the most gold. **It has been replaced.** Clearing the last wave
(`waves.showdown.afterWave`) now opens the **Final Showdown**: a card counts
down from three, and the four armies are set down in one cross-shaped arena
facing each other. Last player with anything standing wins.

**The shape** (`src/sim/arena.ts`). Four spokes of lane width meeting at a
square centre. A spoke is the player's whole 8 × 10 build grid plus
`approachDepth` rows of open ground ahead of it, so the centre is 8 × 8 by
construction and the bounding square is 32 × 32. The four corners of that
square are _not_ arena: `Bounds.band` in motion.ts is what keeps bodies out of
them, and `markOutside` in flowfield.ts is what stops the distance field
routing through them. Seating is by seat at the table, clockwise from south,
and an eliminated player simply leaves their spoke empty rather than the table
reshuffling.

**The transplant** (`src/sim/showdown.ts`). Every unit is _moved_ out of its
lane — the same objects, not copies — restored to full HP as at the start of a
build phase, and stood on the tile it was built on in its owner's spoke. The
line a player spent twenty-five waves arranging is the line they take in, and
the row they kept safest behind the fight is the row furthest from the centre.
`lane.units` is left empty; from there the lanes, the fortresses and the
economy are done.

**The fight is the fight they already know, with one thing added.** Units hold
a target until it dies, take the nearest otherwise, walk downhill on the same
distance field and stop when something is in range. What the arena adds is a
LIMIT on how far they look: `max(acquire.minimum, its own range + acquire.margin)`,
edge to edge, where a lane gives a unit no limit at all. A lane holds one enemy
and there is no question which way to face; an arena holds three, and "nearest
enemy anywhere" is a global question that forty bodies re-answer every tick
against three moving crowds, all changing their minds together — §5.1's
argument for capping a monster's acquisition, arriving on the other side of the
board. It is tied to the unit's own reach so a Sanction looks as far as it can
actually shoot rather than as far as a melee body would have noticed.

A unit with nothing inside that range walks at the **middle of the map**, which
is what makes four armies converge rather than each pick a duel from thirty
tiles away. The centre is a goal body with no size, not the centre square:
stopping at the near edge of an eight-tile square would leave two melee lines
eight tiles apart and blind to each other, which is a stalemate rather than a
showdown. It is the same seekers-and-chasers split a wave makes in a lane, with
the middle of the map where the fortress would be. The movement
code was generalised onto a `World` (`src/sim/context.ts`) — a size, a set of
edges, and whatever is solid in it — so the same `planMoves` and `moveSeekers`
run in both places. In the arena every seeker on the board moves in **one**
priority order rather than army by army: a lane's units-then-monsters ordering
is a deliberate asymmetry between two sides that are not symmetric, and four
armies fighting each other are.

**Dampening** (`src/sim/dampening.ts`) is the stalemate brake, and is
scaffolding: healing, a summon's starting HP and crowd-control durations each
lose `perSecond` of themselves per second past a `graceSeconds` grace, so a
fight between two armies that cannot quite finish each other resolves instead
of running forever. Only the first has anything to multiply today — there are
no summons and no crowd control yet, and the one healing effect in the game
(§10.1's regeneration aura) radiates from a fortress, and no fortress comes to
the showdown. They are three named functions rather than one number used three
times so the day those effects land, the call site is a lookup. `applyHealing`
is the other half: **every point of HP any body regains anywhere in the
simulation is added by that one function**, so there is exactly one place for a
multiplier to bite, and a healing effect added without going through it is
visibly wrong.

**The camera moves, and it is the only one that does.** §14.1's whole-board-on-
one-screen rule cannot hold for a 32 × 32 arena on a portrait phone — fitting
it would leave a body four pixels across. So `arenaCamera` fits the arena to
the _longer_ screen axis (on a phone: full height, scroll sideways), never
zooms in past the tile size the lane was drawn at, and clamps the offset so the
board always covers the screen. Drag anywhere to scroll. The lane stack — lane,
aura, HUD, opponent tabs, build bar — is hidden outright, because none of it
means anything any more: nothing to build, nothing to send, no fortress to
upgrade and no other lane to watch.

**Ownership needed a channel.** §14.2 spends silhouette on armor, fill on
damage type, and size and pips on tier; a lane never needs a fifth because
everything solid in it is yours. Four armies in one arena do, so each spoke's
floor is tinted with its seat's color and each body wears a ring in the same
color — two readings of one fact, and the spoke tint survives a crowded
centre.

Measured: **7.6 ms per tick** with four armies of forty (15% of the 50 ms
budget, against 10.9 ms for four lanes with a full wave each - the arena's
field is nine times a lane's area, but it is one army's kinds against another
rather than every lane's), and **99.3 KiB/s** on the wire, below the 171.3
KiB/s a four-lane spectator already costs. `npm run perf` and `npm run wire`.

To look at it without playing twenty-five waves: `?wave=25` starts a practice
match at the last build phase, and `?showdown=1` starts inside the arena with
four scripted armies already in it.

### Solo: your own sends, and a wave that never ends

A fifth way to play from the home screen, and the one that needs nobody else.
`createMatch(data, { mode: 'solo', teams: [one] })` (`src/sim/state.ts`) - a
solo match with more than one lane is refused, because every rule below assumes
the only lane is yours.

**Every send comes home.** `send` in `src/sim/apply.ts` replaces whatever target
the command named with the sender's own lane, and the rule a standard match
keeps - you may not send at yourself - is waived. Nothing else about a send
changes through the twenty-five waves: it costs the same, pays the same income,
carries the same bounty and joins the next wave. So the economy sends are what
they always were, an investment, and an attack send is a way to buy a harder,
richer wave. The send tab shows one chip, "Yourself", saying when the send will
arrive.

**After the last wave, an endless one** (`src/sim/endless.ts`). The build
phase after wave 25 runs as any other, and where a standard match would cut to
the Final Showdown, `beginEndless` opens a stream instead. The phase is
`combat` from then until the fortress falls; `allLanesClear` is never asked,
so the stream never ends on its own.

- **What comes.** `endlessPool` collects every non-boss monster the authored
  waves used (twelve today) and every boss in the bank or the waves. The
  field is filled to the wave's cap (`maxConcurrentMonsters`, 30) on the
  stream's first tick and kept there: every body that dies is replaced on the
  next tick (`fillTheField`), wherever the spawn zone has ground for it. The
  stream never queues; a body is drawn when there is a place for it. Body `n`
  is drawn uniformly by `waveRng(seed, 1_000_000 + n)` and boss `n` by
  `waveRng(seed, 2_000_000 + n)`, so which monsters a seed sends, in what
  order, is the same whatever the player does - only how soon each arrives
  depends on play - and a replay is exact (§9.2).
- **Bosses come in batches.** Every `bossEverySeconds` (30) a batch falls due:
  `firstBosses` (1) in the first, and one more every `bossGrowthEvery` (2)
  batches - 1, 1, 2, 2, 3, 3... (`bossBatchSize`). They do not push past the
  cap: they take the next places that free up, ahead of the stream's own
  bodies, so a few minutes in, a death is replaced by a boss as often as not.
- **How hard.** Each `stepSeconds` (30) is a step: bodies of step `k` are grown
  as wave `26 + k` would be, by the same §9.1 curve the waves use. Each step
  keeps its own enrage clock (§8), so bodies a minute old enrage together and
  a fresh step does not inherit an old one's fury.
- **The line is what you brought.** Once the stream opens nothing can be
  bought - not a unit, an upgrade, tech, the fortress, supply, the weapon or
  the aura (`shopOpen` refuses with `sends-only`; `shopOpenIn` and
  `sendsOpenIn` are the renderer's copies, which grey every panel but Send) -
  and a unit that falls stays down, since there is no build phase left to
  respawn it in. It was built the other way first, with the board open and
  fallen units standing back up after fifteen seconds; a playtest asked for
  the stream to be a test of the line built before it instead. Gold stops
  with it: the stream's bodies and the sends pay no bounty, and no passive
  income is paid, because there is nothing left to spend it on. The HUD drops
  the income line, and the send buttons drop the income from their price.
- **Sends are the one thing left.** Gems still come in, and a send - always at
  yourself - is more to kill for the tally, at the wall's risk. One made
  during the stream walks in at once, or, when its own pool is full, waits
  behind only other sends: sends have a pool of their own on the field (§8.1,
  amended). It used to share one cap and wait behind the stream, and a
  playtest found the result: auto-send switched off, no more gems spent, and
  its swarmlings still walking in minutes later, which looked exactly like
  sends nobody had bought.

**The tally.** `lane.kills` counts every monster that dies in the lane, in any
phase, by any hand, and `MatchView.solo` carries it - with the stream's age,
step, and the size and time of the next boss batch when it is running - on the
wire as one short row (`so` in protocol.ts). The HUD shows it all match; the
wave label reads "Endless next", then "Endless wave" with a clock counting up;
the lane's preview shows the twelve silhouettes the stream draws from and when
the next batch of bosses is due. When the fortress falls the end card shows how long the wall held,
the number killed, and whether it is a new best (`soloBest` in preferences,
also shown on the home button).

To look at it without twenty-five waves: choose Solo with `?wave=26`, which
starts at the build phase before the stream with the usual late-start purse.
How long a line lasts is in BALANCE.md, under the phases.

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
| color      | damage type | the same fill §14.2 draws the body in          |
| size       | damage      | a Sanction shell is not a Thornling's dart     |
| speed      | range       | time in the air stays about 0.16s at any reach |
| trail      | armor       | two guns of one damage type still differ       |

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

The flash is drawn at the attacker's damage-type color mixed halfway to white.
A Pledge and a grub are both Impact, and an amber swing between two amber
bodies is invisible; lightening keeps §14.2's color channel while making the
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

**A death is a pop, drawn after the fact.** The simulation removes a dead body
on the tick it dies, and nothing about that changes: it is gone from collision,
targeting and the view at once. The renderer notices a body that was in the
last view and is not in this one and leaves a 320ms pop where it stood — its
own silhouette swelling and fading, a near-white flash at its heart, and seven
shards of its color thrown to about twice its radius. Every channel is read
off the body (shape, damage-type color, radius, mark, outlined or filled), so
a new unit or monster dies correctly with nothing to author.

The view only says what is there, so which disappearances count as deaths is
the caller's call (`DeathRule`): in combat and in the arena, all of them; in the
build phase only monsters, because a unit leaving then was sold; at the start
of the showdown none, because the armies have walked out to the arena. Switching
which lane is on screen swaps every body at once, so nothing pops unless both
views are of the same team's board.

### Sound: cues, packs and a playlist

Sound follows the same rule the effects do: the simulation does not know it
exists. Every sound is a difference between two views the renderer already has
(`src/audio/cues.ts`), so a remote match, a practice match, auto-send and a tap
all sound alike, and a client with the audio deleted plays the identical game.
Two sources, because they change at different rates. The fight on screen, every
blow and every death, is heard on the tick, from the same pair of views and the
same `DeathRule` as the death pop, so a pop and its sound are one event. The
match and your own lane (phases, the fortress, builds, sales, purchases, sends
out and in, the ending) are diffed once a frame against a small snapshot,
because a practice match applies a purchase between ticks and a snapshot
compared twice finds nothing new the second time. Button taps are heard in
`app.ts` by running Pixi's own hit test on each press and release: anything
drawn with a pointer cursor, pressed and released on the same one, ticks, so a
button added later joins in with nothing to do. It is not a listener on the
stage, because Pixi delivers events only to containers that are interactive
themselves, and making the root interactive would change what every tap under
it hits. The listeners are added before Pixi's own so the release is tested
against the screen that was tapped, not the one its button opened.

**The game plays cues, never files.** `CUES` in `catalog.ts` is the vocabulary:
`death.boss`, `send.incoming`, `ui.denied`. A sound pack maps every cue to one
or more files, a volume, a voice limit, a minimum gap and a pitch spread.
Replacing the sound is a new pack, not a hunt through the renderer, and a
damage type added to the data without an attack cue fails the type check. The
music is a list of tracks; the setting names one to repeat, or `shuffle`, which
picks at random each time a piece ends and never picks the one that just
finished. The pieces have endings rather than seamless loops, so nothing
depends on an MP3 looping without a gap, which browsers do not do reliably.

**Settings are what a menu will edit.** Levels (master, music, effects), mute,
the music choice and the pack live in `settings.ts`, saved to `localStorage`
and read back field by field, so a bad save or a removed track falls back
rather than going silent. `AudioEngine.configure` applies a change mid-sound and
saves it, and the menu (below) is what calls it. M mutes from anywhere, and
`?sounds=1` opens a sound board that auditions every cue and track.

**A busy fight is thinned, not piled up.** A late wave lands dozens of blows a
second. Each cue has its own voice cap and minimum gap and there is a ceiling of
24 voices overall (`limiter.ts`). A sound refused is dropped, never queued,
because a queued sound arrives after the thing it was about. Blows are quiet and
pitch-jittered; anything about the player is louder and rarer.

**Browsers start silent.** Nothing is fetched and no context runs until the
first tap or key press, which then decodes the pack's effects into memory and
starts the music. Effects are decoded because they must start on the frame
asked for; music streams through an `<audio>` element routed into the same
Web Audio graph, so one gain per level covers both. A hidden tab or a
backgrounded app suspends the lot.

**The sounds are our own.** Every file under `public/audio/` is rendered from a
recipe in `src/audio/synth/` by `npm run audio`: a small offline synthesizer
(oscillators, filters, envelopes, a Freeverb) and a two-song score. Effects
ship as 22.05kHz mono WAV, levelled by the loudness of their loudest 50ms rather
than by peak, since a square-wave alarm and a click with the same peak are
twenty decibels apart to listen to. Music ships as 96kbps MP3, levelled to one
average loudness so the playlist does not jump. Noise is seeded, so
regenerating an unchanged recipe writes identical bytes. Downloaded sounds go
in as a new pack; `public/audio/CREDITS.md` says what a file from elsewhere has
to record.

### The menu

A button in the top-left corner of every screen, both ways up, opens one panel
(`src/render/ui/menu.ts`). The corner is reserved in the layout
(`LaneLayout.menuButton`) rather than found by each screen, and the HUD moves
its first lines over to clear it. The button is drawn at 36 pixels, because the
top band's floor is 102 and it holds three rows of text and the tabs; its hit
area reaches six pixels past the drawing to make up the rest of a thumb.

What is in it is what exists to be set. Sound: three levels, mute, which music
plays (one piece or shuffle), skip to the next piece, and which effects pack is
in use, shown even while there is only one so the option is visible. Then the
game: your name, the game speed, whether status markers are drawn (below), the
battlefield underfoot (below), the effects guide and the damage chart side by side, leaving the match, and closing
the menu. Upright it is one
column; on a short screen the two sections sit side by side, since one column
of every row would run off the bottom.

**A practice match pauses behind it; an online one does not.** A match in this
tab stops advancing while the menu is open, along with everything that animates
on its behalf and auto-send, which has to be skipped rather than slowed: a
practice match applies a send the moment it is submitted, so an armed send would
still go out with time stopped. A room keeps running, because three other
people are playing it, and the panel says so rather than letting a player think
they have stopped time.

**Game speed: ½×, 1×, 2× or 3×, for a match in this tab.** Practice and the
hand-built Final Showdown feed the simulation's fixed-step clock that multiple
of each frame's time, so the rules are untouched: the same ticks run, sooner or
later. Everything that animates on the match's behalf runs at the same multiple
(effects, status markers, auto-send's own timers), so a 2× match looks like
one. At 3× a 60fps frame is exactly one tick; a slow phone that falls behind
drops ticks to the clock's catch-up ceiling and runs a little under 3× rather
than freezing. An online match always runs at 1×, so the picker is shown there
but cannot move. The HUD writes the speed beside the phase clock whenever it is
not 1×, because a build timer counting down three times as fast needs its reason
beside it. The choice is saved with the other preferences (`preferences.ts`).

**Leaving takes two taps.** The first arms the button ("Tap again to leave")
for three seconds; the second throws the match away. It is the one thing in the
menu that cannot be undone.

The panel reads the settings back from the sound system every frame it is open
rather than keeping a copy, so M pressed with the menu open moves the mute
switch too. Each row is one of four shapes (slider, toggle, picker, button), so
a new option is a row in the constructor and `arrange` and a line in `render`,
not new layout. Esc opens and closes it.

### Status markers: what is happening to a body

A burn, a slow, a ward: every ability that lasts leaves a status on a body, and
until now a player could only find one by selecting the body and reading its
numbers. Now each body wears a small animated marker for each KIND of thing
happening to it, eleven kinds in all (`src/sim/statusMarks.ts` sorts them,
`src/render/statusMarks.ts` draws them):

| kind         | from                                             | marker                    |
| ------------ | ------------------------------------------------ | ------------------------- |
| burning      | a blast damage-over-time (Pyre)                  | flames off the top        |
| blighted     | any other damage-over-time (spores)              | bubbles rising            |
| slowed       | move or attack speed down                        | ice crystals circling     |
| rooted       | root                                             | spikes, under the body    |
| stunned      | stun, or any other control that stops it         | stars circling overhead   |
| taunted      | taunt                                            | a red chevron pointing in |
| shielded     | a ward with blows left                           | a bubble                  |
| regenerating | healing over time                                | pluses rising             |
| empowered    | damage, attack or move speed, crit, lifesteal up | chevrons rising, right    |
| weakened     | damage dealt down, damage taken or anti-heal up  | chevrons sinking, left    |
| fortified    | damage taken down, evasion, reflect, immunity    | four corner brackets      |

**A body's own passives are left out.** A Carapace's plated shell is what a
Carapace is, not something happening to it, and marking it would badge every
one on the board forever and bury the marks that mean something changed. The
same passive reaching a DIFFERENT body is kept, because that is the news: an
enemy's dampening field slowing your line, or a Pledge standing close enough to
its neighbour to share its aura, which is how a player finds out spacing
matters. A body's own triggered effects (a Stoke, a Brood Surge) are events,
and are kept too.

The view sends KINDS, not statuses: one bitmask per affected body
(`EntityView.statusMarks`), and on the wire a sparse list of id and bits for the
few bodies that have any, lanes and arena alike. Whose burn it is and how long
it has left are the panel's business.

Every kind has its own shape as well as its color, which is the rule the bodies
follow (§14.2), so the greens can be told apart without the color: rising
pluses are healing, rising bubbles are blight, spikes in the ground are roots.
Markers are anchored to the body's edge and sized from its radius with a floor
and a ceiling, so a Mite's are legible and a boss's do not swamp it. They
animate on the match's clock, so they hold still with everything else while the
menu pauses a practice match. The menu's "Show status effects" turns them off;
the choice is saved (`preferences.ts`).

**The legend and the guide say what the markers mean** (`ui/effectsPanel.ts`).
A button beside the board (at the end of the opponent tabs upright, above them
sideways, in the top corner of the arena) opens a list of every kind of marker
on screen now or in the last minute of play, newest first, each drawn live as it
looks on the board, with whether it was on units or monsters. The button shows
the latest kind itself, animated, and a dot while there is one the player has
not opened the legend since. `statusLog.ts` keeps that record, fed the board on
screen once a tick, so it lists what the player could actually have seen. The
menu's "Effects guide" opens every kind the game has. Tapping any row, in
either list, opens its page: the marker on a unit and on a monster, what it
does, and every ability that causes it with who carries it. Like the menu, the
panel pauses a practice match while it is open.

**Nothing in the legend or the guide is written by hand, so neither can fall
behind the game.** The rows are `STATUS_MARKS`. Each kind's name, one-line
summary, description and drawing are one entry in `MARK_INFO`
(`render/statusMarks.ts`), a record keyed by the kinds, so a kind added without
all four is a compile error, and the board draws from the same record. What
causes each kind is worked out from `abilities.json` by the rule the board uses
(`markOfEffect`), with the unit, monster, boss or send that carries each
ability (`statusGuide.ts`); a unit line is named at the lowest mark that has
the ability. Adding a kind of marker is therefore three edits: append it to
`STATUS_MARKS`, teach `markOf` what produces it, and give it a `MARK_INFO`
entry. It then appears on the board, in the legend and in the guide at once. A
new ability needs nothing at all: it is listed under its marker the moment
something carries it.

### Battlefield backgrounds: a ground to fight on

The lane and the arena can be drawn on a ground other than the flat dark one:
Meadow, Dunes, Cobblestone or Molten (`src/render/battlefield.ts`). They are
cosmetic and meant one day to be earned or bought; for now every one is open,
and `unlockedBattlefields` is the single place that rule will live.
`battlefieldInUse` is what the renderer draws — the choice, if it is still
unlocked, and the plain ground otherwise — so a saved choice that stops being
available falls back rather than failing.

**Chosen by sight.** The menu's Battlefield row names the ground in use and
opens a panel of previews over the menu (`ui/battlefieldPicker.ts`); closing it,
by Done, ✕ or Esc, goes back to the menu. Each card paints its ground the way
the board does, with the build grid over it and two units and two monsters of
four damage types standing on it, taken from the game's data — because the
question is not whether it is pretty but whether the fight still reads on it.
A tap picks it, and the card in use is framed. A ground that is not unlocked
will show dimmed and marked, and cannot be picked. The cards are laid out in
the fewest columns that fit (`cardGrid`): two across upright, one row on a
phone turned sideways.

**Seen, but never the point.** The first version of the three calm grounds was
so quiet it could hardly be seen on a phone; they are now a good deal stronger,
but they keep the rules. Every channel on a body already means something —
silhouette is armor, fill is damage type, outline means monster (§14.2) — so
nothing in a calm ground is the size or brightness of a body, and nothing is
laid out on the tile grid: cobbles are a staggered lattice smaller than a
tile, ripples run at a slant and in pieces, and tufts are scattered.

**Molten is the experiment.** Basalt plates over lava that glows, pulses in
bands that roll down the lane towards the wall, and throws up a few slow
embers. It was made deliberately bolder than the rest to see how far is too
far: its orange sits near the impact and blast fills, its cracks are bright
lines, and its embers are small moving lights — each of which the calm grounds
avoid. The plates are the cells of a jittered lattice (`voronoiCells`), each
drawn back towards its middle so the lava under them shows in the cracks.

**The grid stays the brightest straight line.** Over a textured ground the build
grid is drawn at 0.5 rather than 0.32 (`gridAlpha`), and the zones become
translucent tints over the ground rather than flat fills: the spawn and fortress
zones still read, and the build zone, which the grid already marks, takes the
ground as it is.

**Drawn, not loaded.** A `GroundView` paints its ground with Graphics from a
fixed seed, in tile units, so it is the same at every screen size and visit,
costs no download, and is painted once per layout (the lane's on `drawBands`,
the arena's floor once per zoom) rather than per frame. What moves on Molten is
only the alpha of four layers and a dozen or so embers, on a wall-time clock of
its own (`animate`): it is scenery, so it keeps moving while a practice match is
paused and does not speed up with it. A still ground's `animate` returns at
once. Every detail is kept wholly inside its area, so nothing needs a mask. The
arena's cross is painted as three areas with their own seeds — the column and
the two arms — so neighbouring pieces are not copies.

### The practice bots: seven ways to play

The three opponents in a practice match, and the empty seats of an online room,
are `src/bot/autoBuilder.ts`. Each one plays a **style** (`src/bot/style.ts`):
one of seven archetypes, rolled from the match seed without repeats, with every
number jittered inside that archetype's ranges. So two Raiders are not the same
Raider, and the same `?seed=` always seats the same bots. The opponent tabs are
labelled with the archetype's name, which is a fair hint of what is coming.

| archetype  | plays                                                                               |
| ---------- | ----------------------------------------------------------------------------------- |
| Banker     | invests hard and early, sends only for income, lean army; poor early, rich late     |
| Tactician  | counters every wave, aims everything, steady economy, the odd send at the leader    |
| Warden     | stands at the wall and grows the fortress: its aura, then its walls                 |
| Raider     | banks its gems and throws them at one lane as a volley of sends                     |
| Horde      | goes wide on cheap bodies, upgrades late, sends at whoever it likes                 |
| Specialist | loyal to two cheap lines and a signature one, whatever the wave says                |
| Rookie     | under-builds, forgets to aim, buys what catches its eye, keeps gold it should spend |

The knobs are the decisions the game asks for:

- how much gold goes into the gem building, and how soon;
- how big an army to hold;
- where the gems go (income sends, attack sends one at a time or in volleys,
  the fortress's walls, its aura);
- who a send is aimed at (the leader, the weakest, at random, or whoever sent
  the most at it);
- where the line stands (forward, deep, or at the wall inside the aura);
- whether the army counters each wave or stays loyal;
- tall or wide, tech or none;
- how often it fumbles.

Difficulty is not a setting. It falls out of those choices (BALANCE.md §4d):
Bankers and Tacticians often beat all twenty-five waves, Raiders, Wardens and
Hordes usually fall in the teens, and Rookies and Specialists are the ones to
beat early.

**Every style plays the same game underneath**, the one BALANCE.md found
reaches the late waves. At the start of each build phase the bot:

1. Reads the coming wave from the preview, plus whatever has been sent at it.
2. Buys the army up to a **floor**: a share of the wave's nominal army gold
   (`waves.json` `armyGold`).
3. Buys the gem building up to the style's pace.
4. Tops the army up to the nominal plus the style's margin.
5. Puts some of what is left into more army and banks the rest.

The army is measured in **effective gold**: each body's whole chain, scaled by
how well it suits this wave through the damage matrix in both directions. So an
army of impact bodies facing a swarm reads as short, and gets bought counters.
Each purchase (a body, an upgrade in place, a level of tech) is whatever adds
the most strength per gold, where strength is the price ladder's own
`sqrt(offence x defence)` with the matrix applied. Below a body-count target
that grows with the wave, new bodies are preferred to upgrades. A few Mark III
units are strong per gold and still let forty monsters walk round them.

Gems are split as they arrive: the style's share into income sends (best rate
first, the same as the auto-send button), the rest to its other use. Sends are
bought whenever the shop is open, combat included. When several lanes are tied
for "leader" (every fortress is whole for the first few waves), the target is
chosen among them at random. Taking the first would aim every bot at the first
lane, which in a practice match is always yours.

The build phase is planned once, on its first tick, and every other tick only
spends gems. That is about 0.05 ms a tick for four bots, against about 1 ms
for the simulation step. What the last plan decided is on `bot.report`.

The tutorial's bots are the plain Tactician with sends switched off
(`quietBots`), because a monster nobody sent on purpose is one the coach would
have to explain.

### The tutorial: chapters, a coach, and a match that waits

Home has a **Tutorial** button, lit for anybody who has not finished a chapter
yet. It opens a list of seven chapters (`ui/tutorialScreen.ts`): the lane, a
first line and a first wave, upgrading and selling, supply, counters, gems and
sends, and reading a battle, with a practice match after five of them (below).
A new player takes the big button, which plays them in order: each lesson ends
on a card whose main button starts the next one, and the last offers a real
match. A returning player taps any one chapter for
a refresher. Finished chapters get a tick and are saved (`tutorialDone` in
`preferences.ts`), and the big button offers to carry on from the first chapter
without one.

**Every chapter is its own match.** `src/tutorial/match.ts` makes an ordinary
practice match on a fixed seed with the chapter's builder, and the chapter's
`setup` stages it through `LocalTransport.stage`, which hands a function the
state between ticks. "Gems and sends" opens with a line built and gems saved, so
it does not depend on having played "Build your first line" first. The bots in
the other lanes build but never send (`quietBots`), because a monster nobody
sent on purpose is one the coach would have to explain. They also get a
150-gold head start (`BOT_HEAD_START`). A wave ends only when every lane has
beaten it, and on a wave-one purse the thinnest bot buys a single tank that
takes most of a minute to clear it. With the head start, wave 1 is over about
eight seconds after your own lane clears. The coach fills that gap: once your
lane is empty it says why the wave is not over yet and points at a lane still
fighting.

**A chapter is data** (`src/tutorial/chapters.ts`, shapes in `types.ts`): a list
of steps, each a line of text, a thing to point at, and what ends it.

- `next` steps are read, then Next is tapped.
- `tap` steps want the player to do something, and `done` checks the match or
  the interface for it: the Sentinel card selected, four units on the board,
  the weapon switched. A step is over the moment the thing is done.
- `free` steps are for closing a card the player opened.
- `watch` steps run the match until something happens - the lane clears, a
  monster catches fire - and then hold it, with Next up. They never move on by
  themselves. Two of these used to be `free` steps that ended the moment the
  thing happened, and a playtester lost both cards mid-sentence; now the player
  finishes reading, and the moment they were reading about is still on screen.

A step can also open a reference card as it begins (`opens`, so far only the
damage chart). The runner reports each step as it starts (`onEnter`) before
anything can end it, so the game opens the card in time for the step's `done`
to see it open. Closing it is the player's, and is what moves the step on.

Any number the coach says (a price, a bounty, the build timer, which Fort
upgrades cost gems and which cost gold, the best damage type against the next
wave and its multiplier) is read from the data, or from the match on screen,
when it is said. A balance change cannot make the tutorial wrong. What the coach points at is a
**named** target, not a position: "the Send tab", "row six", "the first burning
monster". `Game.locate` finds each one on screen as it is drawn this frame
(`ui/locate.ts`, and a `locate` on the HUD, the build bar, the opponent tabs and
the watch banner), so the same chapter works upright and sideways and survives
a layout change.

**The coach holds the screen** (`ui/tutorialCoach.ts`).

- On a `next` step the board dims and only the card takes a tap.
- On a `tap` step the board dims round a hole over the target. Only the hole
  takes a tap, which falls through to the real button or the real lane, so the
  player learns the real gesture. A ring pulses round the hole and an arrow
  points at it. A tap anywhere else is swallowed and flashes the ring.
- On a `free` step nothing is blocked.

The blockers are four rectangles round the hole, because Pixi hit-tests a
shape's area, not its paint, so a sheet with a hole cut in it would swallow the
hole's taps too.

**The card sits beside what it is about** (`placeCard`): under the target, over
it, or to either side, whichever fits and is nearest, so the words and the
thing are read together. It used to go wherever it covered least of the
target, which on a phone meant the far end of the screen. A button kept clear
(the menu and legend buttons, drawn over the coach) pushes it on past rather
than ruling the side out. Where there is an arrow it sits in the gap between
card and target, pointing from one to the other: on every `tap` step, and on a
reading step whose target is small enough that a ring alone is easy to miss -
a number in the stats, a single button (`wantsArrow`). Only a target too big to
sit beside (the whole lane) falls back to the old least-covered spot. The card
grows with the screen's text scale like the rest of the interface. While the
menu or the effects panel is open, the coach stands aside.

**The bottom row is ◀ Exit Next ▶.** Back (`TutorialRunner.back`) shows the step
before again without running it again: nothing is staged, `done` is not
checked, the match holds, and every step looked back on has a Next, whatever it
was. Next walks forward through the steps already done to where the player
left off, which is live again exactly as it was. A silent step (one that was
only there while a card was open) is passed over both ways.

**The match waits while the coach talks.** Every step holds the match unless it
says `run` (or is a `watch` step whose moment has not come), and the
chapter-complete card holds it too, so a wave never walks in while the player
is reading about the build grid. It is the same pause the
menu uses. The status markers keep animating through it, because a flame is
easier to point out lit.

`src/tutorial/runner.ts` steps through a chapter with no Pixi in it, and
`tutorial.test.ts` plays every chapter to the end against a real match, doing
what a tap on each target would do. A chapter that asks for something the match
will not allow (a unit it cannot afford, a button that is not there, a wave
that never ends) fails there, not on a new player's phone.

### What the tutorial teaches, after the first playtest

A player's notes on the tutorial changed what several chapters say and show.

- **The first wave says where its gold came from.** "Wave cleared!" quotes the
  wave's tally (`waveEarnings` in chapters.ts): how many monsters your units
  killed and the gold that paid, out of the wave's whole bounty, and how many
  got through and were finished by the fortress - which pays nothing, so it says
  what those cost. The tally is the simulation's own (below), so the numbers are
  the ones the wallet moved by.
- **Supply is its own chapter, shown rather than told.** The figure and what it
  allows (25 supply, 25 one-supply units); opening the Fort tab and buying more;
  the Build tab, pointing at the supply number on a card and working out how
  few of the biggest units fit; and a unit upgraded once already, whose Upgrade
  button says the second upgrade takes more supply. (A unit's first upgrade
  takes none, its second as much again as the unit: units.json.)
- **Tech is explained as what it is**: an upgrade for a whole kind of unit at
  once, for the rest of the match, with a step after the purchase that says
  what changed, how far the levels go, and what Plating and Cadence do.
- Smaller things: "a line of four Pledges", an arrow at the number the stats
  arrow explains, "tap the ability", "dot" rather than "pip", "the right unit"
  rather than "tool", a send's cooldown said plainly, and what an incoming send
  does to the next wave said in full.

### Practice matches between chapters

Seven chapters back to back were a lot to read and very little to do: by the
end a new player had been told about supply, counters, tech, gems and sends
without having made one decision about any of them. So the tutorial is now
twelve **lessons** (`src/tutorial/lessons.ts`, `LESSONS`): the chapters, and
after each of chapters 2 to 6 a whole **practice match**, played until the
fortress falls (or every bot's does), with only what has been taught so far on
screen.

**The interface opens a piece at a time.** `render/features.ts` says what a
match shows: which build-bar tabs, whether a unit's panel has Upgrade and Sell
(and the arrows and next-mark ability that preview them), whether the Fort tab
has the fortress ladders or Supply Cap alone, and whether gems are in the HUD.
`chapters.ts` names five stages and each chapter plays with one:

| Stage      | Opens                           | Chapters                           |
| ---------- | ------------------------------- | ---------------------------------- |
| building   | the Build tab, nothing else     | The lane, Build your first line    |
| upgrading  | + Upgrade and Sell              | Upgrade and sell                   |
| supply     | + the Fort tab, Supply Cap only | Supply                             |
| counters   | + Tech, Aura and Damage tabs    | Counters                           |
| everything | + gems, fortress ladders, Send  | Gems and sends, Reading the battle |

What is not open is not drawn at all, rather than drawn and refused: a tab
that does nothing is one more thing to wonder about. It is the interface only;
the simulation takes any command, and the player can only reach what is drawn.
`Game.applyFeatures` sets it as a lesson starts and puts everything back for
any other match. The Counters chapter gained a step for the Damage tab, which
it now opens.

**Each practice is set up so the newest piece matters** (`practiceMatch` in
match.ts: an ordinary match on a fresh seed, with the practice's `setup`
staged on it):

| After                 | Practice        | Set up                                                                  |
| --------------------- | --------------- | ----------------------------------------------------------------------- |
| Build your first line | Hold the line   | a normal start                                                          |
| Upgrade and sell      | Fewer, stronger | 12 supply, so upgrading is how to grow                                  |
| Supply                | Room to grow    | 900 gold, a 5 supply cap, and about 1,000 gold a wave                   |
| Counters              | Read the wave   | the weapon on the worst damage type for wave 1, 250 extra gold for tech |
| Gems and sends        | The full game   | 40 gems, and the bots send                                              |

Until sends are taught the bots are quiet, as in the chapters, and numbered
rather than named for a style. A practice opens on a card (`intro` in the
coach) that says what is new and points at it; the match is held until Play.
The game-over card after a practice offers the next lesson first and the same
match again second, rather than "stay and watch". A practice counts as done
when its match ends, however it ends. The menu's Leave match goes back to the
tutorial list from any lesson.

How long they last, for a scripted novice at 1x speed: Hold the line about 6
minutes (falling at wave 6, its 25 supply full), Fewer, stronger about 10,
Room to grow 14 to 16 (where the quiet bots fall first, around wave 13 to 15,
by which time the novice has raised the cap from 5 to 75 or more), and the last
two about 11.

**Room to grow** is the one practice that needed the simulation to move. The
cap's ladder lists what the cap BECOMES at each level (30, 35, ...), and buying
a level used to set it there, so a lane started at 5 jumped straight to 30.
Now a purchase adds the level's step (`supplyStep` in apply.ts), which is the
same thing from the usual start and +5 from any other; the Supply Cap button
says the cap it will make from the one there is. Its gold a wave is the wave's
own bounty plus per-wave income for the rest, and the HUD shows that income
line whenever there is some, gems or no gems.

**The list** keeps its seven chapter rows; each practice is a pill on the row
of the chapter before it, ticked when done, because twelve rows do not fit
down a phone. The big button carries on from the first lesson not yet done,
practice or chapter.

`tutorial.test.ts` checks that every lesson's features include the last one's,
that every step and every practice intro points only at what its lesson has
open, that each practice is set up as above, and that a practice with nothing
built ends with the fortress falling and nothing sent at it.

### A finished chapter is celebrated

When a chapter's last step is done, "Chapter 2 Complete!" bursts open in the
upper middle of the lane with the chapter's name under it and the victory
fanfare (`ui/chapterComplete.ts`). It is the same burst as a cleared lane's
(`ui/burst.ts`: ring, rays and confetti, shared by both), drawn over the coach
so its dimming does not dim it, and it stays as long as the coach's
chapter-complete card at the bottom of the screen does. A wave-cleared card
still up at that moment is put away.

### Super and Ultra, not Mark II and III

An upgraded unit is named for how far it has been upgraded: Pledge, Super
Pledge, Ultra Pledge (units.json). "Mark II" and "Mark III" were the design
documents' words and meant nothing to a player; the numbering is still `mark` in
the data and the code, where it is a number, and nowhere a player reads it. A
unit at the top of its ladder says "fully upgraded" on its button.

### A cleared lane is celebrated

When your own lane is clear - usually well before the wave ends, since it ends
only when every lane has beaten it - a card bursts open in the middle of the
board with a chime (`ui/waveCleared.ts`, `wave.cleared` in audio/cues.ts):

```text
Wave 3 cleared!
+38 gold from 24 kills
2 finished by your fortress: 6 gold lost
Still fighting: Rookie, Tactician
```

It stays up until the player taps anywhere (`Game.screenTapped`, from a
`pointerdown` listener on the canvas in app.ts, so the tap still reaches
whatever it was aimed at), or the next wave starts. A tap in its first 0.7
seconds does not count, so a player mid-build does not dismiss it before they
have seen it. If it is still up when every lane is through and the build
phase starts, its last line becomes the clock - "24 seconds remaining to build.
Build now!" - since a player reading about the last wave is spending the time
to prepare for the next one. It is never shown for a lane emptied by its
fortress falling or in solo's endless wave. The chime moved with
it: it used to sound when the whole wave ended, which was the moment that
mattered least to the player. It sounds at the end of the wave only when the
lane-clear was missed (a match joined mid-wave).

Two numbers it needs are new on the wire:

- **`WaveTally`** (sim/types.ts, on `EconomyView` for your own lane): the wave's
  kills by your line and by your fortress, the gold the first paid and the gold
  the second did not. Reset as each wave starts; kept through the build phase
  after it, which is when the tutorial reads it.
- **`OpponentView.fighting`**: whether a lane is still at the wave. Public
  whatever can be seen of the lane - it says nothing about what is in it, and
  the wave ending says the same thing moments later - so "still fighting" can be
  answered without sight of anybody's board. The fog-of-war test lists it.

### An upgrade shows on the board

Upgrading is in place, so the only sign on the board used to be one more dot.
Now the unit flashes, two gold rings swell off it, chevrons rise over it (one
per upgrade, like the dots), and "Super!" or "Ultra!" floats up - about a
second in all (`upgradeBursts.ts`). It watches the lane on screen every frame
and runs on wall time, rather than living in the effects layer, which only
looks at a lane when a tick arrives and only moves while the match does: an
upgrade is a tap, lands between ticks in a practice match, and the tutorial
makes it while the match is held.

### What a unit card says

Each Build card now says whether the unit is **melee** or **ranged** on its
third line, ahead of the counter verdict ("ranged · ▲ strong"), by the same
rule the stat panel uses (`isMelee`, the attack-style threshold). Where it
stands follows from that, and the silhouette does not say. The unit's own
silhouette in the corner is drawn larger than a color chip (`bodySize` in
gridButton.ts): it is a shape the player has to learn to pick out of a crowd.

The ability card is bigger and set larger (20/15/14 at a scale of 1, from
16/11/11), and "Tap anywhere to close" is a full-width bar in the accent color
where a button would be, not small print.

### The damage chart

The damage matrix (DESIGN.md §6) is the rule the whole game turns on, and the
board never shows it. `ui/damageChart.ts` puts it on one card: damage types down
the side in their colors, armor across the top with a real monster's
silhouette and the word for its family of shapes (round, angular, clusters,
pointed), and the multiplier in each cell, green and "strong" above 1, orange
and "weak" below. A line under the grid says that the chart works both ways,
because the simulation applies the same matrix to a monster hitting a unit
(`sim/damage.ts`).

It is opened from the menu ("Damage vs armor"), and the tutorial's Counters
chapter opens it too. Like the effects panel it pauses a practice match, and
Esc closes it. Everything on it comes from `data.matrix`. The one sentence
that generalises ("every damage type is strong against one armor and weak
against another") is only shown while the matrix makes it true. A new armor
type would not compile until it had a word for its shapes.

### The fortress aura, drawn

§10.1 sells two upgrades and offers one choice — Aura Power, Aura Radius, and
which of four auras is running — and until now all three were invisible. The
weapon's damage type at least recolored the shots it fired; an aura changed
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
channel that reads as motion rather than as shape; **armor** is a still lattice
of scales, because armor does nothing until something hits you; and
**regeneration** drifts motes up the lane, because a thing being given back
should look like it is travelling.

The rim is drawn at the radius `auraFor` actually measures, centred where it
measures from, so a unit inside the line is buffed and a unit outside it is not
— the drawing is the rule rather than an illustration of it. The aura tab's
chips carry the same four colors and now print the radius and the strength, so
buying Aura Power changes a number there and the ground in the lane at the same
time. It sits under the bodies so it never obscures a fight, runs on wall time
like the effects layer, and the simulation neither reads it nor knows it exists
— `aura.test.ts` asserts that literally, and that each channel moves when the
thing it stands for is bought.

### Every body has its own silhouette

§14.2 gave one shape per armor type - circle, hexagon, diamond, triangle
cluster. That is four shapes for thirty-seven bodies, and a crowd of identical
hexagons tells you nothing about which of your units is which. Every unit and
monster now has its own silhouette, thirty-seven in all, assigned in the data
(`shape` on each definition) from a catalogue in `render/shapes.ts`.

What §14.2 was protecting is kept as a rule about **families**: round things
are Flesh, angular things are Plate, pointed and stellar things are Ward, and
clusters of small things are Swarm. The counter-read still works at a glance and
without color - a wall of angular shapes is a wall of Plate whether or not you
can name each one - and within a family every member is distinct. `SHAPE_FAMILY`
in `schema.ts` is the assignment; `validate.ts` refuses data on load if a shape
is in the wrong family for its armor, if two bodies on the field share one, or
if a tier does not carry its base's shape up the chain (§7.3: an upgrade is the
same unit).

The wave preview (§9.3) draws them too, during the build phase only - once the
wave walks in, it is on the board to be looked at, and the strip was text drawn
over the top of the fight. Each incoming monster's shape sits
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

### Two windows: the shop and the board

Everything a player spends on used to be gated on one condition - the build
phase - and that conflated two different things.

**The board** is the line itself: placing a unit, upgrading one in place,
selling one back. That is build-phase only (§3.1). The line is what the wave is
about to hit, and rearranging it mid-fight would make every wave a reaction
test rather than a plan.

**The shop** is everything else: global tech, the fortress ladders, the supply
cap, the weapon's damage type, the active aura, and sends. None of it touches
the line, and a player with nothing they may do for the length of a fight is
watching a screen rather than playing. So the shop stays open through combat
and closes only when the Final Showdown starts. Two predicates in
`src/sim/apply.ts`, `shopOpen` and `boardOpen`, and the build bar greys exactly
the Build tab and the selected unit's Upgrade and Sell buttons.

Solo's endless wave closes both, and leaves only sends open (see
[Solo](#solo-your-own-sends-and-a-wave-that-never-ends)).

A send bought during combat behaves exactly as one bought during a build phase:
its monsters join the target's **next** wave, because `incomingSends` is
drained when a wave spawns rather than when it is queued. Nothing lands on a
fight already in progress, so the only thing the old rule decided was when the
attacker was allowed to think about it.

### Two arrangements of the same three areas

A match screen is three things: the HUD with the opponent tabs, the lane, and
the build bar. Upright they are stacked — band, board, band. Sideways they are
columns — HUD left, board middle, build bar right, each the full height. That
is the whole difference, and it is the whole of `computeLayout`'s branching:
`portraitBands` and `landscapeBands` each return the three rectangles, and one
shared `fitLane` puts the lane inside the middle one.

Which one runs is decided by `width > height`, and a square screen is called
upright — the stacked arrangement is the one the game was designed around, and
a tie has to go somewhere. Everything downstream reads `layout.orientation`
rather than measuring the screen again, so there is one answer to the question.

`fitLane` is why this was a small change rather than a rewrite. It fits the
8 × 14 lane square inside whatever rectangle it is handed and derives the
spawn, build and fortress bands from that rectangle's own x and width, so the
tile↔screen transform, picking, the wave preview, the watch banner and the
toasts all work off `layout.lane` and never off the screen. The simulation
never learns which way the phone is: the lane is 8 wide in both.

What each area does with its column is its own business, and two of them do
something different:

- **The HUD** stacks its rows down the left instead of splitting them into two
  columns, and puts the four opponent tabs at the BOTTOM of its column rather
  than under the text. The tabs are a fixed block — four rows at 30px — so
  anchoring them to the bottom is what leaves the text rows room to breathe;
  reserving a fixed height at the top instead ran the last row of text behind
  the first tab, which is exactly the collision `tabStrip` exists to prevent.
- **The build bar** halves its grids. A column 34% of a wide screen is narrower
  than a band across a tall one, so the tab strip goes 3 × 2 instead of 6 × 1,
  the unit and upgrade panels go two across, and the send target chips go 2 × 2.
  Four columns of buttons in a narrow column are unreadably tall.

The front screens — home, roster picker, lobby — are laid out down the middle
and have no columns to rearrange, so they get one bit instead: `layout.compact`,
true under 560 pixels of height. It moves the seat cards and the roster cards
into 2 × 2 grids and tightens the vertical rhythm, which is the difference
between a lobby that fits a sideways phone and one whose Ready button is off
the bottom of it.

The Final Showdown needed nothing. Its camera already fits the arena's side to
the screen's LONGER edge and scrolls the other (`arenaCamera`), which is a rule
about the arena and the viewport rather than about orientation.

### Gold, gems and supply are pictures

Wherever a number is a price or a wallet (the top band, every build-bar
button, the builder picker), gold is a coin, gems are a cut jewel and supply is
a figure, drawn by `ui/currency.ts` in place of "g", "gem" and "supply". A
string marks where one goes with a token (`{gold}45 · {supply}1`), and a
`RichLabel` lays the words and icons out on one line, shrinking a line that
would run past its button rather than cutting a price short. They are drawn
rather than emoji because an emoji coin is recent enough that older phones show
an empty box, it looks different on every system, and it cannot be colored to
the palette. Sentences keep their words ("not enough gems"); the tutorial names
the three pictures when it tours the wallet.

### The top band: what it says, and why it has a floor

Three rows of text above a row of four tabs. Left: the wave and whether it is a
boss, then the phase — seconds while building, monsters left while fighting.
While building, the wave named is the one coming — `Wave 6 incoming`, `Wave 1
incoming` in place of the old `Prepare` — since the one just fought is history
and the one coming is what the build is for. Where the band is too narrow for
`Wave 5 incoming · BOSS` it drops the word rather than the boss
(`Wave 5 · BOSS`): the phase clock under it already says it is a build.
Right: gold, gems, supply, then what the wave DEALS (§9.3), then **passive
income as a rate** (§11.6) — `+12 / wave` beside a coin, which is not a number you spend but
the one that decides how fast the other three move, and the whole reason an
early send is an investment rather than an attack. It shows at zero too,
dimmed, because zero is where everyone starts and seeing it is how the lever
gets noticed. The bottom row also carries §11.5's incoming-send warning.

That warning counts every send still on its way, not just the ones in the send
log. The log holds sends for the NEXT wave and clears when that wave spawns,
but more sends than their pool holds on the field wait in reserve (§8.1,
amended), and those can still be walking in long after the log went quiet. So once a wave is out, the lane view's `reserveSends` - how many of the
reserve were sent - keeps the line up: `⚠ 5 sends still to come`, or in solo,
where every send is your own, `5 of your sends still to come` (`sendNotice` in
hud.ts). Without it a solo player who switched auto-send off saw their own
earlier sends still arriving and nothing to say they had been bought.

The band's height is `max(11.5% of the screen, 102px)`, and the lane gives up
what that takes. A share of the screen divides a tall phone correctly and a
short one badly: at 640 pixels 11.5% is 74, less than the band's own text
needs, and the send warning was drawn behind the tabs. A lane one tile shorter
is a cosmetic loss; a warning you cannot read is not. The row of tabs is in the
layout as `tabStrip` for the same reason — the tabs drew themselves up from the
bottom of the band while the HUD placed rows down from the top, and the two
working it out separately is how they collided.

**The tabs are labelled by name, not by lane.** A lane number says nothing
anybody wants to know, and once the lobby is history these four tabs are the
only place another player's name appears. A seat nobody has named — a scripted
lane, or a player who never set one — falls back to `Lane 2`. The second line
of a tab says something only when there is something to say: `out · 3rd`, or
how long bought sight has left. The HP percentage that used to sit there is
gone: the bar underneath is the same number read faster, and two of one fact is
one too many.

### The send tab: what you are throwing, at whom, and how often

§11.5's offence, made legible and then made comfortable.

**One send, one monster, and the send is named after it.** A send used to buy a
pack under a product name — "Swarm Probe", eighteen gems, six Swarmlings —
which made every send a decision about a pack rather than about a monster, made
the cheapest button the one that dropped the most bodies, and left the button
saying its own name and then the monster's underneath it. Each send now
delivers exactly one body and is CALLED that body. A send id therefore matches
the monster id it delivers, which is the same word in two separate namespaces
(`defs.sends` and `defs.monsters`) and reads correctly in both.

**Fifteen sends, 10 to 500 gems, five to a page.** The ladder is in
`data/sends.json` and `validate.ts` holds it to its rules: every price a
multiple of ten, every cooldown one to ten seconds, three economy sends at the
best income per gem and every other send strictly below it. Five sends stand in
the grid at a time, and the grid's sixth cell holds the page control — ◀, the
page number, ▶ — because five sends leave that cell empty in both the
three-by-two portrait grid and the two-by-three landscape one, so paging costs
no height on a short phone. Every page stands in the same five places.

So a button is a name, a price, and **what the send is for** — "Carapace /
(gem)120 → +(coin)7/wave / Siegework" over a slab, or "economy" for the three that pay
the best rate. The icon is the monster because a send _is_ that monster: the
same shape, armor family and damage-type fill that §14.2 draws in the lane, in
the wave preview and on a unit button. All fifteen draw a different picture,
and a test in `src/render/ui/sends.test.ts` keeps it that way.

The ability named is **the send's own where it has one, the monster's
otherwise**. `carapace` grants Siegework to a Carapace that already has its
shell and that IS the purchase; `herald` grants nothing and the Herald's own
War Cry is named. Sight follows it on the same line, because the price line is
the two numbers a send is weighed by and must never be the line that gets cut.

**Every send has a cooldown, and the simulation holds it.** One to ten seconds,
per player and per send, in `lane.sendCooldowns`: `apply.ts` refuses a send
still cooling (`on-cooldown`) and `tick.ts` counts every clock down each tick.
The rule lives there and not on the button so that a tap, a held auto-send and
a bot all wait the same time, and so that a client cannot skip it. The view and
the wire carry your own clocks (`sendCooldowns`, `sc`), and the button draws
what is left as a dark shade over the part still waiting, with a bright edge,
sweeping off to the right as it runs out — a timer that is read at a glance and
never has to be read as a number.

**The grid fits its box, and the columns are chosen against it.** `grid` used
to draw each button at least a touch target tall while spacing the rows at the
unclamped pitch, so five sends in a column count whose rows did not fit spilled
off the bottom of the bar and the last row was cut in half. It now honours its
box, and `columnsThatFit` picks the count: rows at a full touch target and
buttons wide enough to read, else buttons wide enough with shorter rows, else
tappable rows however narrow — taking the MOST columns that qualify at each
step, which is the fewest rows. Three across a portrait phone, two down a
landscape column. And `GridButton` cuts each of its three lines to its own
width with an ellipsis, which it can do and the dozen call sites that build
labels cannot: a button knows how wide it is and a string does not.

**A Random chip** sits beside the three opponent chips. §11.5's default is to
gang up on the leader; Random is the other shape of pressure — spread across
every living lane without three taps per send. It re-draws from the living
opponents each time, so it can never aim at somebody already out, and the
command that leaves the client still names one concrete lane, which is what
keeps the simulation deterministic (§15.1).

**Press and hold a send for a second to arm it**, and it fires every time its
cooldown runs out for as long as the gems are there. The button fills a bar
along its bottom edge while the hold counts, so the gesture explains itself; an
armed send wears an accent ring and says `auto`. It keeps firing while the
player is on another tab or another page, because that is the point of arming
it. After firing it holds off for the send's own cooldown locally as well, so a
send fired on this frame is not fired again before the view says it is
cooling. A send you cannot yet
afford is dimmed but still takes the hold — "fire this as soon as I can afford
it" is exactly the case auto-send is for — which is why `GridButton` separates
`enabled` (dimmed, taps do nothing) from `interactive` (takes events at all).
The purse is tracked locally across one frame's firings, because
`lane.economy` is last tick's snapshot and two armed sends would otherwise both
see the same balance.

**Every press blinks.** A send is the one action whose effect happens in
somebody else's lane, so without a blink there is nothing on screen to say the
tap landed.

### The build grid, and what a unit button shows

Two small things that both come down to §14.2: show the player the thing
itself, and only while it is the thing they are working with.

**The grid is drawn bright, and only during the build phase.** A tile is
something you aim at for thirty seconds and then stop caring about entirely -
once a wave is in the lane nothing you can do is tile-aligned, and a lattice
over a fight is one more thing for the eye to pick through. So the lines come
up at full strength when they are what you are working with, and vanish when
they are not.

**A unit button carries the unit's own silhouette, not a colored square.**
The same armor shape, the same damage-type fill, the same tier pips that
§14.2 draws on the board, from the same `drawEntity` the entity layer uses - so
the thing you tap and the thing that appears on the tile are drawn by one
function and cannot disagree. Choosing what to build is choosing a shape you
will have to pick out of a crowd three seconds later, and a row of identical
squares teaches you nothing about which shape that is. The chips that really
are just a color - a damage type on the Aura tab, a tech track - stay squares,
because that is what they are.

**You tap the body, not the tile it is standing in.** A tap is read as a point
in tile space, and `bodyAt` takes the unit whose own circle covers it - the
same circle that collides, that range is measured to and that is drawn (§14.2).
The tile rule it replaces pointed at the wrong thing in both directions: a unit
that had advanced off its tile (§5.2, amended) could not be tapped where it
plainly was, and a tap on an empty corner of an occupied tile selected a unit
that was nowhere near the finger. Selection is drawn to match - a ring on the
body, interpolated with it, rather than a box snapping from tile to tile a
third of a second behind the thing it was pointing at.

Exactly the body turned out to be too small to aim at — about twenty pixels
across on a phone, against the forty-four a thumb wants — so the tap circle is
the body plus `TOUCH_SLACK_PX`, and the nearest body within that wins. Eleven
pixels, which is short on purpose: the REACH has to stay under one tile, or a
tap on the empty tile beside a line would select the line instead of building
there, and building beside a line is most of what the build phase is.

### Reading the bar: text that grows with the screen, and buttons that stay legible

**One text scale for the screen.** `textScaleFor` (layout.ts) reads the short
side of the screen: about 1 on a phone either way up (0.92 on the smallest,
where the panels have least room), and up to 1.4 on a tablet or a desktop
window, where the bar's buttons are many times a phone's and phone-sized type
was lost in them. It is on the layout as `textScale`, and every panel in the bar
sizes its type from it — the grid buttons, the tabs, the page number, the
selected-body panel, its ability chips and the damage panel — so a name is the
same size on every tab. Sideways the HUD column grows with it too; upright the
top band stays at its phone sizes, because it is a band at its floor height
packed to the pixel.

**Bigger at the written size.** A button's three lines are 14, 13 and 12 at a
scale of 1 (`TITLE_SIZE`, `DETAIL_SIZE`, `NOTE_SIZE` in gridButton.ts). They
were 11, 9 and 9 — the price, the number the button is read for, was the
smallest thing on it. The selected-body panel went from 13/9/9/10 to
15/11/11/12 (`PANEL_TEXT`), the tabs from 11 to 13, the ability chips from 10 to
12, the damage panel from 10/11 to 12/13.

**Then fitted to the box.** `lineSizes` shrinks a button's three lines together
until they fit its height, but never below 78% — past that the note line is
dropped instead. A long name shrinks to fit its width (to 85%), then a short
name is used where the button has one (`shortTitle`: Fort HP, Regen, Gem Out,
Aura Pwr, Aura Size, Supply, Speed), and only after that is it cut with an
ellipsis. A price with a second half (`detailMore`: what a fortress level buys,
what a send pays) stays on one line where it fits, takes a line of its own on a
button tall enough for four, and only otherwise shrinks. Upgrade and Sell are a
touch target tall, so they put the price beside the name (`priceBesideName`),
and the next mark's glyph in the corner is the first thing given up on a narrow
one. The selected-body panel measures its stat names at their drawn size and
starts the values one gap past the widest, drawing a value smaller rather than
into the next column's name.

**A button that cannot be used is recessed, not faded.** It used to be drawn at
42% opacity, words and all, which put a price you could not yet afford at about
2 to 1 against its ground — unreadable exactly when it is the number you are
saving towards. Now the ground goes darker (`UI.panelAsleep`), the name goes to
the muted text color, and the price says whether money is the reason: the
amount that is short is drawn in `UI.unaffordable`, a warm coral - the gold, the
supply, or both, and only those (`shortfall` in buildBar.ts; `RichLabel` colors
the amount after each currency icon on its own) - and the price stays muted when
the button is out for any other reason (the wrong phase, the top of its ladder).
A fortress level that takes supply now says so in its price, beside the gold,
rather than after what it buys. A usable button's price is drawn in the full text
color. The asleep Build tab during a wave gets its own dimmer caption color
rather than a fade. gridButton.test.ts holds every one of these combinations
above 4.5 to 1.

### The selected body: what it says, and selling it back

Tapping a body on the board replaces the Build grid with a panel about it: what
it is, six numbers, what it does, and — for a unit of yours — two buttons.

**A monster is a body too.** Tapping one opens the same panel with no buttons
on it: there is nothing to buy and nothing to sell, and the question a tap on a
Revenant asks is "what is that and what does it do to me". It works in a lane
you are only WATCHING as well, because reading somebody else's wave costs
nobody anything, which is why `BuildBar.render` takes the lane on screen
alongside your own. A monster with no ability says "nothing special" rather
than showing an empty block — a blank panel reads as one that failed to load —
and a selected monster wears the same ring a selected unit does. Its panel
closes itself when it dies, since holding a panel open on a corpse would leave
the tabs unreachable until the player noticed.

**The header is one line.** It used to be two: "Vigil → Vigil II" over "Tier 1 →
2 · arcane · ward", which spent a quarter of the panel telling a player that the
next Vigil is called Vigil II. It is now `Vigil` with `arcane · ward` beside it —
placed at render time, because where it starts depends on how wide the name
measured. The tier lives on the Upgrade button's pips and what the tier buys is
in the stat block. The "Next tier · Kindle, improved" line went the same way; a
tier that unlocks a NEW ability still gets a line, because that is something to
decide about.

**Back is gone.** Tapping empty ground already puts the body down, which is
what Back did, so the two remaining buttons take the full width.

**The energy meter lives in the space the one-line header freed**, at the right
of the title row — and only for a body that can SPEND energy, which is the ten
units whose top tier unlocks an energy-costing ability. Every body fills the
same pool at the same rate, so a meter on the rest would read full forever. It
is here rather than floating over the body because health bars already float
over every body in the lane and a second stripe on each turns a crowded fight
into wallpaper; energy is a question about ONE unit — is that Sanction about to
Interdict — which is exactly what selecting a body is for.

The meter marks **where the cheapest ability becomes affordable**. A bar on its
own says how full the pool is, which is not the question; the question is
whether the next ability is about to fire, so a notch sits at the cost and the
fill goes from grey to accent as it crosses. The cost is read from `data/` on
the client, so the wire carries only the number that actually moves: a sparse
`[id, energy]` row per body that can spend it, which is a handful per lane and
took the player frame from 2.48 to 2.49 KiB.

**The boxes are a subtraction, not a guess** (`panelRegions` in
`unitStats.ts`). The buttons are pinned to the bottom of the panel and the
ability text above them grows with what it has to say, so on a short screen the
two used to meet — and the text lost, because the buttons are drawn over it.
The panel is now allocated in priority order: the buttons take a touch target
off the bottom first (being able to act on the thing outranks reading about
it), the title takes its line off the top, the ability text claims a floor of
two lines, and the **stat grid takes whatever is left, in whole rows**. On a
360 × 640 phone that means one row of stats and both ability names rather than
three rows of stats and nothing; Dmg/s is the two cells above it multiplied
together, and what a unit DOES is not readable anywhere else. A test asserts
the subtraction at seven viewports both ways round, and a mask over the text's
box is the hard edge behind the fitting — a string nobody anticipated is cut
off rather than drawn over a button.

**The text shrinks before it truncates.** `renderAbilityText` tries the full
wording at ten pixels, then nine, then eight, then the ability names alone. A
tall panel gets the sentences; a short one gets the names, which is still the
half that matters.

The six numbers are HP, Damage, Dmg/s, Range, Atk spd and Move, two across and
three down. Each reads `now` or `now → after the upgrade`, and **the arrow
appears only where the tier actually changes the number** — a panel that draws
an arrow between two identical readings is claiming an upgrade bought something
it did not. `Dmg/s` is derived rather than authored, because damage and attack
speed mean little apart: a tier that trades one for the other looks like an
upgrade in one cell and a downgrade in the next until you multiply them. Range
below the melee threshold prints as `melee`; §5.2 measures reach edge to edge,
so a melee value is a hair over zero and the digits are true but useless.

These are the numbers the body is **actually fighting with**. Tech (§7.4), the
fortress aura (§10.1) and every ability status on it are folded in, and a cell
is drawn **green where something has raised it and red where something has
lowered it** — a slowed monster's Move goes red while you watch, a Pledge
standing beside two others shows its Damage in green. Higher is better in every
cell the panel shows, which is why one comparison colors all six.

The same multiplier is applied to the tier being compared with, so the arrow
still compares two TIERS rather than a buffed body against an unbuffed
definition. `Dmg/s` is scaled by damage times attack speed, so a buff to one
against a debuff to the other correctly cancels out and the cell stays plain.

**Where the numbers come from** is `EntityView.mods`: four multiples of the
definition, computed in the simulation because only the simulation knows any of
the three layers, and put on the wire SPARSE and MASKED — a row only for a body
that has something on it, and inside the row only the fields that differ.
Most bodies are unmodified and a body that is modified almost always has one
thing changed, so the two together cost about half what a dense row would. It
is still the biggest thing added to a frame in a while: 2.13 → 2.48 KiB for a
player at §15.3's load, 6.45 → 7.95 for a spectator.

Under the numbers is **what the body does**: one chip per ability, each one a
button. A name always fits and a sentence has to be shrunk until it does —
which is how a tier-1 Oathwall came to show "Hold the Line" and no description
at all, because the fitting fell all the way back to names. So the panel shows
names, the chips wrap like words, a chip that would fall outside the box is not
drawn, and tapping one opens a card.

**The card's numbers are generated, not authored** (`abilityText.ts`). An
ability's `text` in `abilities.json` says what it is FOR in one short sentence
and carries no figures at all; everything else on the card is read off the
RESOLVED ability, so the panel and the data cannot disagree and a balance pass
never leaves a stale description behind it. It also answers what the flavour
line could not: "three Pledges in a row are three times braced" left a player
asking whether they had to stay in a row, and the card says `Always on, while
they are in range` / `Up to 3 allies within 1.6 tiles` / `+8% damage · up to 3
stacks, one per unit`. Where an ability controls, the card adds the one-line
note about diminishing returns, because that is where somebody is deciding
whether a stun is worth building.

A chip for an ability the NEXT tier unlocks is drawn dimmer and marked `+`:
what an upgrade buys is exactly the sort of thing to read before buying it. An
ability the next tier merely improves gets no chip, because the stat block
above already shows what the tier moves.

The older `UnitDef.traits` lines are still supported, still descriptive only,
and still empty for every unit; an ability's description cannot lie the same
way, because `validate.ts` refuses an ability built out of effects the
simulation does not honour.

**Selling** is the second button, and the rule is in
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

**A crowd at that wall now spreads along it.** Three rules that were each
right for a circle and wrong for a wall the width of the lane. A body closing
the last fraction into contact walked at its target's CENTRE, so a monster
arriving at one end of the fortress set off along the wall toward the middle,
through everything already fighting there. The field marked attack positions in
the strip along the lane's edge, where contact will not let a body stand, so a
crowd could queue for a goal that could never be taken. And obstacles were
inflated by exactly the seeker's radius, which offered slots with a thousandth
of a tile to spare that contact resolution cannot place a body in - the body
pressed into the notch for the rest of the wave while free wall stood empty a
few tiles away. Closing now aims at the nearest point of the target's spine,
`markBorder` makes the lane's own edges terrain, and `PASSAGE_CLEARANCE` asks
for room to spare in a gap the seeker must pass through rather than touch.
Measured on a wave arriving at an undefended wall: 17 of the 30 bodies at the
wall engaged, 5 on its outer thirds, and 1.40 tiles of shuffling every two
seconds from the rank that could not get in; now 18 of 22, 8 on the outer
thirds, and 0.00.

**A fast body no longer tails a slow one.** Reported from play: a grub walked
the whole lane locked behind a husk, at the husk's speed, and then shuffled
behind it at the wall instead of stepping round to the free stonework a
half-tile away. Two rules, each right on its own. The field marks as terrain
only what will not move, so a _walking_ ally was free ground and the route ran
straight through it. Contact cancels the part of a step that goes into a body,
and head-on there is no other part - no tangent to slide along. So the follower
inherited the leader's pace and nothing in the model ever noticed. The fix is a
third kind of ground: a walking ally costs `CROWD_COST` extra to enter rather
than nothing, because getting past a body takes time. Round one body the detour
wins; inside a crowd every route pays alike and the shortest still wins, so a
wave queues instead of fanning out. Measured: the follower went from 0.70 to
1.07 tiles per second of its own 1.10, and at a saturated wall the share of
body-ticks spent attacking went from 83% to 90%.

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

Implemented and tested (388 tests):

- Seeded RNG and per-wave derivation (§9.2)
- The damage matrix and its row/column invariant (§6)
- Enrage: additive, capped, per-wave clocks (§8)
- Targeting — both kinds hold a target while it is alive and in range, and
  otherwise take the nearest in range (§5.1, §5.2, amended)
- Movement — engaged-or-seeking bodies, a distance field to the free attack
  positions, move-and-slide with yielding (§5.3 and §4.2, both amended)
- Wave generation as a pure function of (seed, waveNumber), boss waves, scaling
  past the authored range, and the build-phase preview (§9.1–§9.3, §3.4)
- The reserve queue and the lane's two caps, one for the wave and one for
  sends (§8.1, amended)
- Commands: place, upgrade in place, weapon type, aura, tech, fortress, supply
  and send — with cost, supply, tile and phase validation inside the simulation
  (§7.3, §11.4, §3.2)
- Gold flow: kill bounties to the defender for its own line's kills, a kill the
  FORTRESS made paying every other living lane instead and the defender nothing,
  and passive income payout (§11.1 amended, §11.6)
- Unit respawn at every build phase, including the last (§5.4)
- Fortress weapon and continuous regeneration (§10.1, §5.5, amended): the
  weapon fires with the damage, reach and rate the LADDER raised rather than
  the ones the data file starts them at; the wall heals every tick in both
  phases, never past its maximum, and never back out of its own destruction
- Elimination and placement, including simultaneous deaths (§13)
- End-to-end determinism: same seed, same final state (§15.1)
- Portrait layout, the tile↔screen transform, and the shape vocabulary (§4.1,
  §14.2)
- The same three areas in columns: which way round a viewport is, the order of
  the columns, three areas that never share a pixel at five sizes, the opponent
  tabs kept inside the HUD, the lane still whole and square with its zone bands
  spanning its own column, the tile↔screen round trip sideways, and the short
  screens that ask the front screens to compact (§4.1, amended)
- An opponent tab's second line: clear of the HP bar on a tab with height to
  spare, using every pixel of one that has none, and never climbing into the
  name (§14.1, §12)
- Abilities, three ways (§7, §18): the VOCABULARY holds together - every stat
  an ability may modify is one the aggregation honours, every live effect kind
  is exercised by an authored ability, and the planned list is exactly the
  kinds that are not live; the RULES do what they say - a stack rule caps, a
  percent slow compounds rather than adding, `perSourceType` rewards a mixed
  line, control diminishes and then stops landing, a ward eats exactly one
  attack, a rank lays over its base numbers and every `"@name"` resolves; and
  the INTEGRATION happens - a real roster sets a wave alight, slows one down,
  drags one onto its tank, spends and refills energy, fails entirely against
  spell immunity, and a paid send arrives carrying the send's own ability
- The selected-body panel's boxes, at seven viewports both ways round: the text
  never reaches the buttons, the four boxes stack in order without overlap, a
  panel too short for anything reports no room rather than a box that grows
  upwards, the ability text keeps a two-line floor by giving up a stat row, and
  a monster's panel spends the button row on reading instead (§14.1)
- What the panel says: the name and the types on one line with no tier and no
  "II", a chip for an ability the next tier UNLOCKS and none for one it merely
  improves, the rank the body actually has so the card shows its numbers, and
  an answer rather than a blank for a monster that does nothing special
  (§14.1, §7)
- Ability chips wrap like words and stop at the bottom of their box, and both
  of a tier-3 unit's fit the box a 360 × 640 phone gives them (§14.1)
- Abilities in words (§7, §18): every ability in the catalogue describes at
  every rank with no placeholder left in it, the authored line stays short and
  carries no figures, and the generated lines say what a player is actually
  asking - that a passive holds only while they are in range, what a stack is
  counted per, what a chance is, what an energy cost is, and both halves of a
  synergy
- A stat cell showing what the body is fighting with: multiplied by what is on
  it, green up and red down per cell, `Dmg/s` moving when either of the two
  behind it moves and staying plain when they cancel, reach never modified, the
  compared tier scaled the same way, and a difference too small for the wire to
  carry not painting anything (§14.1)
- A grid of buttons that fits its box at six viewport sizes, three columns on a
  phone and two down a landscape column, and a narrow row preferred over an
  unreadable button (§14.1)
- A frame carrying live stat modifiers, sparse: every modified body's four
  numbers survive the round trip, and an unmodified one carries nothing at all
  (§15.2)
- The energy meter: nothing at all for a body that can never spend any, one for
  the tier that unlocks an energy ability, the CHEAPEST of two costs rather
  than the last (given to a unit for the test, since the roster has one each),
  a fill in proportion and clamped at both ends, a notch that says when the
  ability becomes affordable, and the whole thing given up rather than drawn
  over a long name (§14.1)
- A frame carrying energy, sparse: the body that can spend it carries a number
  through the round trip and the one beside it that cannot carries nothing
  (§15.2)
- Energy belongs to the fight: nothing spends it during a build phase however
  many allies an ability could aim at, every wave opens with a full pool
  however the last one went, and so does the Final Showdown (§7, §18, §3.3
  replaced)
- The roster design rules, asserted against the data rather than intended:
  every unit has an ability, every tier carries its signature forward at that
  tier's rank, every ladder ends in a second ability, a three-tier unit's
  second ability costs energy, some monsters are left ordinary and no boss is,
  and each of the three tagged builders both applies and exploits its own word
- Global tech, tied to damage types and cached per unit (§7.4, §15.3)
- Fortress, weapon, regen, aura and resource upgrades, bought with gems (§10)
- The supply cap as a purchase (§11.4)
- The selected-unit view belonging to no tab: selecting a unit unlights every
  tab and opens it, and tapping a tab puts the unit down (§14.1, amended)
- Auras: one active, radius and strength upgrading separately (§10.1)
- The Final Showdown: the cross arena's geometry and seating, the transplant
  out of the lanes, the countdown holding every army still, four armies
  converging on one centre, the last one standing placed first, and the shop
  closing when the armies march (§3.3, replaced)
- What a unit can see in the arena: a body just inside its reach plus the
  margin and not one just outside, a long-reaching unit given sight to match
  rather than the floor, nothing at all across the board when the card lifts,
  and the centre of the map walked at instead (§3.3, replaced)
- The two windows: tech, fortress ladders, supply, the weapon type, the aura
  and sends all bought mid-wave, the board still refused, and a send bought in
  combat still landing on the NEXT wave (§3.1, amended)
- Pointing at a body rather than at a tile: the circle that collides is the
  circle that a tap hits, including for a unit that has walked off its tile,
  and nothing selected by an empty corner of an occupied one (§14.2)
- The touch allowance: a tap reaching a short way past a body's edge, the
  nearer of two bodies within reach, and a reach that stays under one tile so
  the next tile along is still somewhere to build (§14.2)
- The spawn zone as the attacker's ground: the whole defence kept out of it
  however hard it is pushed, no monster born inside a unit, the cap still
  reached while a queue waits, and a cap-sized clump packed wholly inside the
  zone (§5.2 amended, §8.1)
- Send buttons: every send drawing the monster it delivers, no two drawing the
  same picture, and a random target that never picks a lane that is out (§11.5)
- Dampening's curve and the one function every point of healing goes through
  (§3.3, replaced)
- Fixed-timestep rendering at any frame rate, with interpolation (§15.1)
- Touch build UI: select, place, upgrade in place, ready, with rejection
  feedback (§4.1, §7.3, §3.2)
- The build-phase wave preview, its offence summary and per-unit counter hints
  (§9.3)
- Sends: cost, the target being the sender's choice, the bounty going to the
  defender, no sending from the grave, and the build-phase window closing when
  the showdown opens (§11.5, §13, §3.1, §3.3 replaced)
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
  combat and once the showdown opens (§11, decided)
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
  giving every body on the field its own, in its armor family, carried up each
  upgrade chain - with the validator shown to refuse a duplicate and a
  wrong-family shape (§14.2, amended)
- The tier pips as a count of upgrades BOUGHT rather than of tiers owned: one
  upgrade, one dot (§14.2)
- The round's damage scoreboard: a unit credited with exactly what the monster
  lost rather than with the swing on paper, overkill on a killing blow not
  counted, the numbers surviving the whole build phase after the fight and
  clearing when the next wave spawns, a unit that died still holding its row,
  and the rows never leaving the lane that earned them (§12, §14.1, added)
- The damage panel's own arithmetic: the ranking, the bar each row is measured
  against, a total that counts rows the screen had no room for, and the row
  count fitted to the screen rather than squeezed into it
- A walking ally as cost rather than terrain: a fast body walks round a slow
  one at its own pace instead of inheriting the slow one's, the field steers it
  round rather than into it, a crowd with no way round is still a route rather
  than a locked door, and a body is not charged for standing in its own
  footprint - plus, at the wall, that the time bodies spend there is spent
  attacking and that none of them wobbles on the spot
- A crowd at the fortress wall: it fills the wall end to end rather than piling
  into the middle, everybody gets in while there is still room for everybody,
  and the rank that genuinely does not fit stands still instead of grinding -
  plus the three geometry rules behind that (the lane's edges as terrain, a
  slot needing room to spare before the field routes through it, and closing on
  the nearest point of a body's spine rather than its centre)

### Deliberate departures from DESIGN.md

Several rules were changed after playtesting, and the code says so where it
matters. The full list is in
[OPEN-QUESTIONS.md](OPEN-QUESTIONS.md#design-changes-to-designmd); the three
with the widest blast radius are:

- **The match ends in the Final Showdown, not in attrition** (§3.3). The last
  wave is followed by a free-for-all in one cross-shaped arena rather than by
  ever-nastier waves against a table that can no longer build or respawn. The
  old ending was decided by who banked the most gold; this one is decided by
  the armies. See
  [the Final Showdown](#the-final-showdown-one-arena-four-armies).

- **The fortress heals on a clock, and its own kills pay everyone else**
  (§5.5, §11.1). Regeneration is continuous — `fortress.regen.base` HP per
  second, every tick, in both phases — rather than a lump when the lane goes
  clear, because healing only on a clear withheld the lever from exactly the
  player who needed it. And a monster the wall kills pays the lane it died in
  nothing, while every other living lane collects `fortressKillBounty` gold:
  the weapon is there so a small leak repairs itself and a large one is fatal
  (§10.1), not as a defence to build around, and paid for its own kills it was
  the latter.
- **The combat phase ends as soon as every living lane is clear** (§3.2). §3.2's
  concern is that a _slow_ player must not hold everyone else hostage, and this
  cannot do that: the clock only jumps forward when every living lane is already
  finished, which is the same principle the ready button applies to the build
  phase. The consequence is that the wave clock is no longer strictly fixed — it
  is fixed _unless everyone is done early_, so a skilled table moves through
  waves faster than the nominal 75s cycle.

### A word on the balance numbers

They are placeholders, and balancing them is now a build of its own rather than
a JSON editing job done by eye. The plan, the arithmetic and the standard are in
[BALANCE.md](BALANCE.md); this is what the code half looks like.

`src/balance/` is a fourth peer to `sim`, `render` and `net`. It imports the
simulation and never the other way round, and nothing in it runs during a match
except `builds.ts`, which the Final Showdown setup screen uses to spend a budget
the same way the harness does.

```
budget.ts      what a medium player can afford by the arena. A closed-form
               model of one line of play, read from data/ - not a simulation,
               and it says so. `npm run budget`.
pricing.ts     two growth rates, and every gold cost, supply cost, damage and
               hit point figure in the roster falls out of them.
               `npm run reprice` shows the diff, `--write` applies it.
builds.ts      a build is a share of the supply budget per rung, not a list of
               units, and `realise` spends a budget on one.
arena.ts       one fight: armies in, placements and surviving supply out.
tournament.ts  plan, run, summarise - in three pieces so a run is reproducible
               and can be sharded across cores. `npm run showdown`.
```

The split that matters is **plan / run / summarise**. A tournament plan is a
pure function of its options, so four processes each running every fourth fight
produce the same records as one process running all of them. They have to: a
fight between full-budget armies costs about fifteen seconds, because every
distinct `(radius, range)` among the seekers needs its own flow field every tick
and a six-rung army has six of them.

Two things the harness does that are not obvious and are load-bearing:

- **The controls gate the signal.** Four copies of one builder on one build must
  win 25% a seat, and win rate by spoke across the four-ways must be flat,
  before any builder number is worth reading. Either coming back skewed means
  the arena is unfair and every result inherits it.
- **A build that could not spend its budget is reported as such.** Rung 1 and 2
  armies want more bodies than the 80-tile grid holds and cannot spend half
  their gold; they lose partly on arithmetic, and a report that quietly scored
  that as a balance finding would send the tuning in the wrong direction.

Waves are the deferred half. Putting the roster on a price ladder lifted its
middle about 4x and its top 12–20x, so `npm run builders` now clears all 25
waves with four fortresses untouched, where §5.5 wants a first elimination
around wave 13–15. Monster strength is one knob and turning it is phase 3.

### Not yet built

- **Multi-part bosses** (§3.4) — a boss should carry a mix of armor types across
  its parts or spawns so no single damage type hard-counters it. The bank spreads
  four armor types across four bosses as a stopgap; real parts need a model that
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
