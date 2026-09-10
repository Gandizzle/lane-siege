Lane Siege — Game Design Document
(working title — do not use "Squadron Tower Defense" or any StarCraft II asset, unit name, or artwork)
Version 0.1 — design phase, no code written yet.
How to use this document
This is the complete specification agreed so far. Hand it to a coding session as the source of truth.
Two rules for whoever implements this:
Every number in this document is a placeholder. Real values come from playtesting. Nothing numeric may be hardcoded — it all lives in JSON data files (see §16).
Where this document says OPEN, the decision has not been made. Do not silently invent an answer. Ask.
1. High concept
A competitive lane-defense game for mobile. Up to 4 players, each defending their own lane against identical waves of monsters, while spending a second currency to send extra monsters into each other's lanes. Last fortress standing wins.
The tension is three-way: build wide (more units), build tall (upgrade what you have), or build economy (fortress upgrades and sends, which grant permanent passive income).
Platform: Android first, portrait orientation, one-handed play.
Target match length: ~20–25 minutes typical, with a hard attrition endgame that guarantees termination.
2. Players and teams
v1: 4 players, free-for-all. Every player owns one lane.
Model the data structure as "a lane is owned by a team of one or more players" from day one. 2v2 then becomes configuration, not a rewrite.
Planned later: 2v2 mode, 8-player support.
3. Match structure
3.1 Wave cycle
Build phase — 30 seconds. Players place units, upgrade, buy tech, buy fortress upgrades, and queue sends.
Combat phase — monsters spawn and advance.
Enrage — begins 60 seconds after that wave spawns (see §8).
3.2 Global wave clock
Waves spawn on a fixed global clock, identical for all lanes, regardless of whether any lane has cleared the previous wave. If you are slow, wave 8 arrives while wave 7 is still alive in your lane.
This is deliberate: it caps total match length and prevents one slow player from holding three others hostage.
Ready button: if all living players press ready, the remaining build time is skipped and the next wave spawns early.
3.3 Wave 25 — the attrition endgame
Starting at wave 25:
Players can no longer build new defensive units.
Defensive units no longer respawn between waves. Losses are permanent from here.
The game grinds to a forced conclusion. Gold continues to accumulate and is still spendable.
OPEN: After wave 25, are tier upgrades to surviving units still permitted? Are fortress upgrades and global tech still purchasable? Recommendation: yes to all three — gold needs a sink, and it gives a losing player something to do. Confirm before implementing.
3.4 Boss waves
Every 5 waves (5, 10, 15, 20, 25, …). The boss type is drawn randomly from a bank of boss definitions. Bosses are ordinary monsters with much larger stats; they leak, siege, and behave identically to normal monsters in every other respect.
Bosses should carry a mix of armor types across their parts or spawns so no single damage type hard-counters them.
4. The lane
4.1 Layout
Fixed camera. The entire lane fits on one portrait screen. No panning, no zooming, no scrolling. This is a hard constraint — it removes an entire class of mobile UX problems and simplifies the renderer enormously.
Top to bottom:
Zone
Purpose
Opponent tabs
Tap to spectate another lane (subject to fog of war, §12)
Spawn zone
Monsters enter here
Build zone — 8 wide × 10 deep
Where players place defensive units
Fortress + resource building
Fortress is attackable; resource building is not
Build bar
Unit selection, upgrades, sends — thumb zone
4.2 The build grid
8 × 10 = 80 tiles.
Space is deliberately not the limiting factor. Supply is (§11.4). Players should rarely, if ever, run out of tiles.
The grid therefore exists purely for positioning — front line to absorb, back line to deal damage — not for scarcity.
Units occupy one tile each.
OPEN: Do units block monster movement (physical collision), or can monsters pass through occupied tiles? Given that monsters target the nearest unit and won't advance past living units anyway (§5.1), collision may be unnecessary. Recommendation: no collision in v1; revisit if it plays badly.
5. Combat model
5.1 Monster behaviour
A monster targets the nearest defensive unit in the lane.
It re-evaluates continuously and switches to a new target if one becomes closer.
It moves toward its target until in attack range, then attacks.
Monsters never advance to the fortress while any defensive unit is alive.
Once all defensive units in the lane are dead, monsters move to the fortress and attack it.
For CPU reasons, re-evaluate nearest-target on a fixed interval (~0.25–0.5s), not every tick.
5.2 Defensive unit behaviour
Defensive units are stationary. They never move and never chase.
A unit acquires the nearest valid target within its range.
It holds that target until the target dies or leaves range.
Only then does it reacquire — again, nearest in range.
This prevents target-switch jitter and wasted damage. Note that this supersedes any earlier notion of units "pathing to targets": only monsters move.
5.3 Movement — no pathfinding
Deliberately no A*, no navmesh, no flow fields. Movement is greedy steering:
Code
Implementation notes:
Ties broken by preferring the direction closest to straight down the lane.
Stuck detection: if a monster's net displacement over ~1 second is below a threshold, it attacks whatever is nearest instead of continuing to steer. This is the fallback for local minima and must exist, or monsters will vibrate against obstacles forever.
This algorithm is cheap enough to run for 4 lanes × ~30 monsters at 20 ticks/second on a mid-range phone.
5.4 Unit death and respawn
Defensive units have HP and can die during a wave.
All defensive units respawn fully at the start of each build phase (through wave 24).
Therefore: losing your line on wave 4 is a temporary setback. The punishment is the leak damage your fortress takes, not the loss of your investment.
From wave 25, respawn stops (§3.3).
5.5 Leaks
When all units in a lane are dead, surviving monsters advance and besiege the fortress, remaining there until killed.
They do not vanish. They keep attacking.
Death-spiral warning: a sieging monster means the lane never clears, which means the enrage timer for that wave never stops, which means the next wave arrives against a still-rising multiplier. This must be defused by:
A fortress weapon strong enough to reliably kill one or two current-wave monsters unaided. Small leaks then self-repair; large leaks are correctly fatal.
Fortress HP regeneration each time the lane goes fully clear, so chip damage is not permanent.
These two levers are also the primary control over when the first player is eliminated. Target roughly wave 13–15, not wave 8.
6. Damage and armour types
Four damage types, four armour types, rock-paper-scissors. Every row and every column sums to 4.1, so no type is globally stronger — each has exactly one favourable and one unfavourable matchup.
Damage ↓ / Armour →
Flesh
Plate
Swarm
Ward
Impact
1.0
1.0
0.6
1.5
Pierce
0.6
1.5
1.0
1.0
Blast
1.5
0.6
1.0
1.0
Arcane
1.0
1.0
1.5
0.6
Rationale (matters for teachability):
Impact — raw force. Shatters Ward barriers; wasted on Swarm, where one huge hit kills one tiny thing.
Pierce — armour-piercing. Punches through Plate; passes cleanly through Flesh without doing much.
Blast — explosive. Shreds Flesh; smothered by Plate.
Arcane — energy. Chains through Swarm; absorbed by Ward.
Names are placeholders and may change. The 1.5 / 1.0 / 0.6 spread is a starting point: 1.4 / 0.7 flattens it, 1.75 / 0.5 sharpens it.
Both monsters and defensive units have a damage type and an armour type. The matrix applies in both directions.
6.1 Builder coverage rule
Because every lane faces the same wave, every builder must have access to all four damage types across its six units. A builder missing Pierce simply loses on the Plate wave.
Builders are differentiated by distribution and quality, not coverage — one builder has two excellent Blast units and a mediocre Arcane one, another is the reverse.
7. Defensive units
7.1 Builders
4+ builders at launch. Each has 6 units.
Build one builder completely first. Get the systems right against a single roster. Builders 2–4 are then largely data entry against a proven framework — roughly a fifth of the effort each.
4 builders × 6 units × ~2.2 average tiers ≈ 53 unit definitions, ~10 stats each ≈ 500 numbers to balance. Plan accordingly.
7.2 Unit stats
Every unit needs: gold cost, supply cost, HP, armour type, damage per attack, damage type, attack speed, range, tier.
7.3 Tier upgrades
Upgrade happens in place — the unit keeps its tile and its identity, gains stats and possibly an ability.
All units have at least a tier 2. Some have tier 3.
Starting price guidance: ~1.6× base cost for ~2.2× value, so upgrading is more gold-efficient than building new — but requires existing board presence.
Some upgrades may cost additional supply. This is a per-unit data field, not a global rule.
7.4 Global tech
Purchased with gold, from a tech panel.
Tied to damage types, not unit types — e.g. "+10% Pierce damage" affects every Pierce unit you own.
Four offensive tracks (one per damage type), plus defensive tracks.
~5 levels each, escalating cost.
8. Enrage
Code
Additive, not compounding. 60 seconds in = 2.8×. Readable at a glance, which compounding is not.
Applies to monster damage, movement speed, and attack speed.
Does not apply to monster HP. A stalling player should face deadlier monsters, not unkillable ones.
Starts 60 seconds after that wave spawns.
Enrage is tracked per wave, not per lane. Wave 3's monsters carry their own enrage clock. If they join a still-alive enraged wave 2, they are not enraged — wave 2's monsters remain enraged, wave 3's start fresh.
A wave's enrage clock stops when all monsters of that wave are dead.
Cap at ~6× (tunable). Beyond that the lane is decided anyway.
8.1 Reserve queue
Each lane has a maximum concurrent monster count (starting value: 30).
If a wave contains more than the cap, the excess sits in reserve and spawns one at a time as active monsters die.
Reserves spawn into their own wave's current enrage state.
9. Monsters
9.1 Design approach
No special abilities in v1. Variety comes entirely from the stat space, which is large enough:
armour type × damage type × move speed × HP × attack speed × damage per attack × range
4 × 4 × (several tiers of each stat) gives plenty of distinct-feeling monsters. Abilities and traits are a later addition.
9.2 Wave generation
Wave composition is a pure function of (matchSeed, waveNumber).
All lanes face identical waves. One seed per match, shared by every client and the server.
Monster stats and monster count both scale with wave number.
Lane divergence comes exclusively from sends (§11.5).
This gives, for free: deterministic replays, trivial desync detection, and the ability to run thousands of headless simulated matches to check balance curves.
9.3 Next-wave preview
During the build phase, players see the composition of the incoming wave — monster types, counts, armour types. Fair, because everyone faces the same thing, and it is what makes 30 seconds of building a real decision rather than a shopping trip.
The preview should also summarise the wave's offence ("this wave deals mostly Pierce") and highlight which of the player's buildable units are strong or weak against it. Without this, the matrix is invisible complexity and new players lose without knowing why.
10. Fortress and resource building
10.1 Fortress
Attackable. Has HP, a weapon, and an aura.
HP — reaching zero eliminates the player. Regenerates on full lane clear (§5.5).
Weapon — the last line of defence. Should reliably kill one or two current-wave monsters unaided.
Its damage type is player-selectable during each build phase, free and instant. A small per-wave decision that keeps every player engaging with the matrix.
Aura — buffs friendly units within a radius.
Only one aura active at a time, chosen by the player from: damage, attack speed, armour, regeneration.
Strength and radius are separate upgrades. Early on the radius cannot cover the whole build zone, forcing a real choice: a tight buffed core near the fortress, or a spread-out line that intercepts sooner but fights unbuffed.
All fortress ranges — weapon range and aura radius — must be freely adjustable in data. An explicit design goal is to experiment with a fortress that actively participates in the battle versus one that sits back.
10.2 Resource building
Sits adjacent to the fortress. Cannot be attacked or damaged.
Produces gems (§11.2).
Upgradable. Some resource upgrades cost supply.
11. Economy
11.1 Gold
Earned: bounty for every monster killed in your lane. The defender always gets the bounty, including for monsters that were sent at them by an opponent.
Also earned from passive income (§11.6), paid out each wave.
Spent on: new defensive units, tier upgrades, global tech.
OPEN: Is the supply cap upgrade bought with gold or gems? Recommendation: gold.
11.2 Gems
Produced by the resource building, at a rate that can be upgraded.
Spent on: fortress upgrades (HP, weapon, aura strength, aura radius) and sends.
Offence and defence therefore compete for the same currency — that is the intended tension.
11.3 The two-currency split

Gold
Gems
Source
Kills + passive income
Resource building
Sinks
Units, upgrades, tech
Fortress, sends
Competes for
Wide vs tall vs tech
Defence vs offence
11.4 Supply
Hard cap on total supply spent. Does not grow automatically. It is an upgrade you choose to buy, which makes a large army a deliberate strategic investment rather than a default.
Supply is consumed by:
Placing defensive units
Some tier upgrades
Some fortress upgrades
Some resource production upgrades
This makes supply a single shared budget across offence, defence, and economy — every supply-costing purchase competes with every other.
Note the resulting core decision: since most tier upgrades cost less supply than a new unit, every wave asks go wide or go tall.
11.5 Sends
Cost gems. Add extra monsters to a target opponent's next wave.
The sender chooses the target whenever more than one opponent is alive. This is the gang-up-on-the-leader mechanic and is intentional.
The defender receives the kill bounty for sent monsters.
Sending grants the sender permanent passive income.
Some send types grant temporary vision of the target's lane (§12).
Eliminated players may not send.
The resulting arc: an early send is an economic investment with a payback period; a late send is a pure attack where the sender knowingly eats the gold loss to force a leak. Same button, opposite meaning depending on the wave.
Starting tuning target: payback period of roughly 5–6 waves — clearly correct before wave 10, clearly a weapon after wave 14.
11.6 Passive income
Granted by fortress upgrades and by sending.
Paid out as gold, each wave.
Compounds over the match. This is the long-game economic engine.
12. Fog of war and information
You see only your own lane by default.
Opponent tabs show limited public information.
OPEN: exactly what is public. Suggested minimum: fortress HP and alive/eliminated status. Everything else — their army, gold, income — hidden.
Some sends grant temporary full vision of the target's lane.
13. Elimination and match end
Fortress HP reaching zero eliminates that player. Placement is locked in at that moment.
An eliminated player may stay and spectate, or leave immediately with no penalty.
If they leave, their lane simply goes empty. Nobody is held hostage.
Eliminated players cannot send monsters. No kingmaking.
Match ends when one player (or team) remains, or when the wave-25 attrition endgame resolves.
14. Presentation
14.1 Orientation and camera
Portrait. Fixed camera. Whole lane visible at all times. See §4.1.
14.2 Visual language — coloured shapes
Placeholder art is the permanent plan, and the shapes carry real information:
Channel
Encodes
Silhouette
Armour type — circle = Flesh, hexagon = Plate, small triangle cluster = Swarm, diamond = Ward
Fill colour
Damage type — Impact, Pierce, Blast, Arcane
Size + pips
Tier
Outline vs solid fill
Monster vs defensive unit
Shape is the primary channel for the information you must read instantly on an incoming monster, which keeps the game colourblind-safe. This is drawn entirely with Pixi Graphics calls — no sprites, no texture atlas, no asset pipeline, and it scales to any screen density.
15. Technical architecture
15.1 The core rule
The simulation is a pure module with no rendering, no DOM, and no engine dependency.
Fixed timestep — 20 ticks/second.
Seeded RNG. Fully deterministic.
Takes state + inputs, returns new state.
The renderer reads simulation state and draws it. The server runs the identical module. This single decision gives you cheat-resistant multiplayer, deterministic replays, desync detection, and the ability to run headless balance simulations with no graphics at all.
15.2 Stack
Layer
Choice
Why
Language
TypeScript
Plain text, phone-editable, one language everywhere
Rendering
Pixi.js
Fast 2D, shapes need no assets
Multiplayer
Colyseus
Rooms, matchmaking, state sync out of the box; Node/TS
Packaging
Capacitor
Wraps the web build into an installable Android app
Hosting (dev)
GitHub Pages
Free; push to deploy; playable in phone Chrome
15.3 Performance budget
4 lanes × ~30 monsters + ~40 units + projectiles.
Pool all objects. No per-frame allocation.
Recompute auras only when units are added, removed, or upgraded, and on wave start. Never per tick.
Re-evaluate monster targeting on a 0.25–0.5s interval, not per tick.
16. Data schemas
All balance data lives in JSON so it can be edited on a phone without touching code.
data/matrix.json
Json
data/units.json
Json
data/monsters.json
Json
data/waves.json
Json
data/fortress.json — HP, regen, weapon damage/speed/range, aura types, aura strength and radius per level, supply costs, passive income per upgrade.
data/sends.json — gem cost, monsters granted, income granted, grants vision (bool), vision duration.
data/economy.json — starting gold, starting gems, gem production rate and upgrade curve, supply cap base and upgrade curve, global tech tracks and costs.
17. Build order
Milestone
Contents
M1 — Headless sim
One lane, one builder, 3 units, 5 waves. Text output only. No graphics. Proves the tick loop, targeting, steering, damage matrix, and gold flow.
M2 — Renderer
Pixi, portrait layout, coloured shapes, touch build UI. Single player, still one builder.
M3 — Full single lane
All 6 units of builder A, tiers, tech, fortress, gems, supply, 25 waves, bosses, attrition endgame. This is the point at which the game is balanceable.
M4 — Multiplayer
Colyseus, 4 lanes, server-authoritative, sends, fog of war, elimination, spectating.
M5 — Content
Builders B, C, D. Mostly data entry.
M6 — Ship
Capacitor Android build, lobby, matchmaking, accounts.
Do not attempt 8 players or 2v2 until M4 is stable.
18. Open questions
Post-wave-25: are upgrades, tech, and fortress purchases still allowed? (§3.3)
Do units physically block monster movement? (§4.2)
Is the supply cap upgrade bought with gold or gems? (§11.1)
What exactly is publicly visible on opponent tabs under fog of war? (§12)
Lobby, matchmaking, and account system.
Reconnection and AFK handling.
Monetisation, if any.
Audio.
Full monster and boss bank definitions.
Send catalogue — which sends exist, what they cost, which grant vision.
19. Legal
No StarCraft II names, unit designs, artwork, sounds, or text. The genre and mechanics are not protectable; specific assets and names are. Everything ships original.
