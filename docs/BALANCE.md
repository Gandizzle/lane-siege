# Balance: the budget, the ladders, and how we will know

**Status: phases 1 and 3 both open. The economy and the price ladders are in,
the round robin runs, and its first findings have been acted on — the centre
square is now worth holding, every line goes to Mark III, and Gloomtide carries
an 8% weight. Waves 1 to 5 are tuned against an army-gold ladder; waves 6 to 25
are stale and know it.**

Every number in `data/` is a placeholder until something measures it. This file
is the plan for measuring them, the arithmetic the roster is priced against, and
the standard we are going to hold the answer to. Three commands reproduce
everything quoted here:

```
npm run budget     what a medium player can afford by the Final Showdown
npm run reprice    the price ladder, and whether the roster is on it
npm run showdown   the round robin, across every core
npm run waves      every army a builder could buy, against every wave
```

---

## 1. The vocabulary, because one word used to mean two things

**RUNG** is which of a builder's six lines a unit is, 1 (cheapest) to 6
(dearest). It is the power ladder.

**MARK** is how far up its own upgrade chain a unit is — I, II, III — bought in
place on the same tile.

Both were called "tier" until they collided, which is why `UnitDef` now carries
`rung` and `mark`, and why `validate.ts` refuses a complete roster that is not
six lines numbered 1 to 6, or a mark that changes rung on the way up.

**All 24 lines go to Mark III.** Ten of them used to stop at Mark II, and not
evenly: Gloomtide and Thornweald could take both of their expensive lines to the
top while Ironvow and Pyre could take neither. In an endgame fought with
expensive units that is a large free advantage, and it is probably a good part
of why the second run had Gloomtide at 73% and Pyre at 41%.

| builder    | 1         | 2        | 3          | 4          | 5          | 6           |
| ---------- | --------- | -------- | ---------- | ---------- | ---------- | ----------- |
| Ironvow    | Pledge    | Sentinel | Vigil      | Oathwall   | Sanction   | Judgement   |
| Pyre       | Ember     | Wickling | Slagmaw    | Foxfire    | Firebrand  | Scoria      |
| Thornweald | Thornling | Mycelia  | Rotgourd   | Hollowbark | Sporecrown | Nettlespire |
| Gloomtide  | Kelpsnare | Murmur   | Fathomhold | Sleet      | Maelstrom  | Torrent     |

---

## 2. The formula

Every unit price in the game is set against one number: **the gold a medium
player has spent by the time the arena opens.** Guessing that and guessing unit
prices separately is how a roster ends up costing ten times what anyone can pay,
so it is computed, from `data/`, by `src/balance/budget.ts`, and recomputed
whenever a price moves.

### The line of play it models

- Every gem the resource building makes is spent on the **cheapest send**, which
  is the efficiency floor of the whole economy: 10 gems per +1 gold a wave.
- Gold buys the resource building's own ladders first — one output level every
  wave, one rate level every five — because that is what compounds.
- Everything left over is the army, the tech and the supply cap.

### What it produces, at the numbers now in `data/`

```
GOLD IN
  starting                     250
  wave bounty                5,000     200 a wave, fixed, x 25
  passive income            18,486     the sends, compounding
  bounty on sends taken      4,942     a mirrored table
                            28,678

GOLD OUT, BEFORE THE ARMY
  gem output + rate          2,750     25 output levels, 5 rate levels
  supply cap to 120            475
  Plating   (3.5 levels)     1,344
  Cadence   (3.5 levels)     1,699
  Impact    (3.5 levels)     1,020
                             7,287

WHAT THE ARMY GETS
  gold                      21,391
  supply                        95     cap 120, less 25 spent on gem output
  gold per supply            225.2
```

**Gold per wave is not a constant and cannot be set as one.** Wave 1 pays 3 gold
of passive income and wave 25 pays 2,471, because income is permanent and is
bought with gems whose rate is itself being upgraded every wave. Passive income
is the larger half of the run's gold — 18,486 against 5,000 from bounty — so any
attempt to think in "gold per wave" is thinking about a fifth of the economy.

### The assumptions, all of them

| assumption                | value                                               | how load-bearing                                                     |
| ------------------------- | --------------------------------------------------- | -------------------------------------------------------------------- |
| Waves before the showdown | 25                                                  | Read from `waves.showdown.afterWave`.                                |
| Seconds per wave          | 60                                                  | **The big guess.** See below.                                        |
| Gem output levels         | 1 a wave                                            | The medium player's defining habit.                                  |
| Gem rate levels           | 1 per 5 waves                                       | Last one lands on wave 25.                                           |
| Supply cap target         | 120                                                 | 150 is the max; reaching it is meant to be a reward.                 |
| Tech                      | 3.5 levels in Plating, Cadence and one damage track | Fractional on purpose — a population average, not a state.           |
| Sends                     | mirrored                                            | Everyone sends what you send, so the bounty nets out between equals. |

**Seconds per wave is the one to distrust.** There is no global wave clock —
combat runs until every living lane is empty — so a wave's real length is an
output of how well everybody built. Gems accrue _per second_, so this number
scales the entire gem economy and therefore the whole passive half of the
budget. 30 + 30 is the intended shape; the `npm run builders` run at the time of
writing measured **48s a wave** against trivially easy waves, which will rise as
the monsters are tuned up. Re-check it once phase 4 has a real curve.

### Three economy rules the formula depends on

**A wave pays a fixed pool** (`economy.waveBounty`, 200 gold), divided between
its monsters in proportion to the `bounty` weight on each definition. Bounties
used to be authored per monster, so a wave paid whatever its composition
happened to add up to — wave 24 paid 545 gold and wave 12 paid 101, chosen by
nobody — and clearing a wave fast was a way to farm it. Now what a wave pays is
a decision, and the reward for building well is that you survive it.

**A sent monster is priced against its sender**: 2 gold per 10 gems spent, paid
to the defender _on top of_ the wave pool rather than out of it, so sending at
somebody cannot starve them. Three opponents piling on one lane fund that lane's
answer, which is what makes being ganged up on survivable.

**Gem output costs supply**, one per level. Gems buy sends, sends buy permanent
income, and income buys more of everything — a loop with nothing stopping it
when the only cost is gold you are about to have more of. Supply is the one
budget that is genuinely scarce, so a player who maxes output arrives at the
showdown rich and 25 supply short. That is the governor.

---

## 3. The price ladders

Two growth rates, and every price in the game falls out of them
(`src/balance/pricing.ts`).

```
value per GOLD    x1.10 per rung    (x1.61 across the six)
value per SUPPLY  x1.38 per rung    (x5.00 across the six)
```

Gold cost is **not chosen**. If value per supply climbs faster than value per
gold, price has to climb by the ratio between them:

| rung | supply | Mk I | Mk II | Mk III | full line | supply | gold/supply |
| ---- | ------ | ---- | ----- | ------ | --------- | ------ | ----------- |
| 1    | 1      | 45   | 68    | 101    | 214       | 2      | 107         |
| 2    | 1      | 56   | 85    | 127    | 268       | 2      | 134         |
| 3    | 2      | 142  | 212   | 319    | 673       | 4      | 168         |
| 4    | 2      | 178  | 267   | 400    | 844       | 4      | 211         |
| 5    | 3      | 334  | 502   | 752    | 1,588     | 6      | 265         |
| 6    | 3      | 420  | 629   | 944    | 1,993     | 6      | 332         |

Every Mark I price lands inside the band the design asked for (rung 1: 30–60,
rung 6: 325–425) without a single number being typed in by hand.

A mark costs 1.5× the step before it, so a Mark II has cost 2.5× the base body
and a Mark III 4.75×. It is worth **2.85× and 5.9×** — 14% and 24% ahead of the
cost — so going tall is clearly better gold **and** enormously better supply.
An upgraded body is what a player brings to the arena; a Mark I is what they
could afford in wave three. It was 6% and 9.5%, which was not a reason for
anything.

This only works because every line reaches Mark III. Rewarding marks this
heavily while ten lines could not have handed two builders the game.

**Upgrade supply is proportional, never flat.** A Mark II is free; a Mark III
costs the body's supply over again, which is 1, 2 or 3 depending on rung. A flat
charge (1 at low rungs, 2 at high) inverts the ladder at the top mark: a fully
upgraded rung 4 would cost five supply against a rung 3's three, making the
dearer unit _worse_ per supply and destroying the only reason to climb. There is
a test for exactly that.

### What `value` means, and what it deliberately misses

`P = sqrt(offence × defence)`, where offence is `damage × attackSpeed` with a
reach premium of 8% a tile, and defence is hit points. The geometric mean,
because a wall that cannot hurt anything is worth nothing and a gun that dies to
a sneeze is too — only a product says so. It also has the property the pricing
needs: hold the offence-to-defence ratio and P is linear in a common scale
factor, so "twice the value" is "twice the damage and twice the hit points",
which is what makes two armies of equal gold have equal totals of both.

Restatting scales damage and hit points **together**, which holds each unit's
role. Attack speed, range, move speed, armour, damage type and abilities are
never touched by the ladder.

**Abilities are not priced by the formula.** A taunt, a shield, a slow and an
execute are not stats and a scalar that pretended to price them would be
confidently wrong. Instead each unit carries a **`valueWeight`** in
`units.json`: above 1 means it is worth more than it looks, so `npm run reprice`
gives it fewer raw stats for the same price.

It is the one knob set from **evidence** rather than from a ladder, and every
value in it should be able to name the run that justified it. Currently one
entry: Gloomtide's roster at 1.08, after run 02. Closing the rest of this gap —
a measured weight per ability — is phase 2.

### Two consequences worth knowing about

**The board is a second cap.** The build grid is 8 × 10 = 80 tiles. A 95-supply
army of 1-supply bodies wants 95 of them, so rung 1 and rung 2 builds run out of
board before they run out of supply. `npm run showdown` reports it.

**Low rungs cannot spend the budget.** Rung 1 fully upgraded is 107 gold per
supply against the 225 the budget has to spend; a pure rung 1 army leaves half
the gold unspent. That is not a bug — it is the ladder doing its job, and it
means the budget picks out rung 4–5 fully upgraded as where a player should
land — but any build that could not spend what it was given is flagged in the
report, because a build losing on arithmetic is not a balance finding.

---

### King of the hill

The centre square is a prize. Whichever army has the most living bodies inside
it holds it, and every body that army owns — wherever it stands — deals 50% more
damage and takes 50% less (`waves.showdown.centre`). A tie is held by everyone
tied, so contesting is never worse than conceding.

Without it the arena has one correct strategy and it is not a fight: mass the
slowest, longest-ranged bodies the budget affords, hold them at the back of your
spoke, let the other three destroy each other, walk in and mop up. Under that
plan the front half of every roster is dead weight, and the first two runs said
so — pure rung 6 won 77.6% and everything below rung 3 lost outright. A prize for
standing in the middle is what makes a front line worth paying for.

Held, not captured: recomputed from where the bodies are every tick, so it turns
over on a walk and nobody owns it by having got there first.

---

### The corners are not glass — and it did not matter

The arena is a cross, so the four corners of its bounding square are not arena:
nothing stands there and nothing walks there. Until `waves.showdown.lineOfSight`
they were transparent anyway, and a body at the back of one spoke could shoot
one at the back of the next across the gap. That looked like the reason reach
was beating the price ladder, so it was closed (`crossesTheVoid` in
`src/sim/arena.ts`) and measured.

**It changed nothing.** A paired A/B — 120 four-ways, the same seeded plan both
times, the only difference being the flag — moved the four builders by 1.6,
1.7, 4.2 and 0.9 points against error bars of 2 to 4.5, and left the build
ladder in the same order. Pure rung 6 went _up_, 52.4% to 57.1%.

The change is very far from inert, which is what makes the null interesting.
Instrumenting acquisition over twelve four-ways — 193,685 picks that had
something to pick — the rule changes **63.7%** of them: 41.6% swap to a nearer
body, and 22.1% are refused a target outright and walk at the centre instead.
Fight length changed in 119 of the 120 paired fights and the finishing order in
65 of them. What did not change was who won, in 104 of 120.

So reach simply does not need the corners. It wins inside one spoke, where
there is no void to shoot over — which is also why the effect is exactly zero
in a duel: the two armies sit on opposite spokes, every shot stays inside the
vertical bar, and 0 of 5,310 in-range sightings cross anything. **Do not
re-measure this in duels.** It is invisible there by construction.

Kept on regardless: shooting through ground nothing can walk on is wrong
whether or not it is decisive, and the tick cost is nil (5.96ms, unchanged).
The lesson for the ladder is that reach is mispriced in `unitValue`'s
`1 + range * 0.08`, not mis-terrained.

---

## 4. The waves, and what each one asks for

A wave is not tuned against "can you beat it". It is tuned against **how much
gold of army it takes to beat it**, and that number is authored on the wave as
`armyGold` in `data/waves.json`.

### The ladder

A player who spends every coin on army has 250 at wave 1 and 200 more each
wave after, since a wave pays a fixed pool (§11.1) whatever walks in. The
nominal is about four fifths of that, and **the fifth left over is the whole
point**: it is the room to bank gold, buy economy, take a risk, or cover a bad
build. A wave a player must spend every coin to survive has taken the decision
away and is too hard whatever its clear rate says.

| wave | monsters | health | `armyGold` | a player has | slack | asks for             |
| ---: | -------: | -----: | ---------: | -----------: | ----: | -------------------- |
|    1 |       30 |    540 |        200 |          250 |    50 | Swarm 78%            |
|    2 |       38 |  1,293 |        350 |          450 |   100 | Flesh 80%            |
|    3 |       34 |  3,091 |        500 |          650 |   150 | Plate 89%            |
|    4 |       36 |  2,244 |        650 |          850 |   200 | Ward 62%             |
|    5 |  26+boss |  6,128 |        850 |        1,050 |   200 | all four, and a boss |

Health is what the wave is worth AT THAT WAVE, not what its definitions say:
every monster grows one step a wave (§9.1, amended), so the same 30-health grub
is a 58-health grub by wave 5. That is what lets a wave reuse a body without
getting easier, and it is why the stat panel resolves against the wave on screen
rather than reading `monsters.json`. Health per gold climbs from 2.7 to 7.2 up
the five and that climb is not the difficulty curve on its own — the bodies are
getting individually harder too, and a boss is one lump that can only hit one
thing at a time and is therefore worth far less threat per point than forty
bodies that surround you.

### Twenty-five to forty-five bodies

The old waves ran 8 to 30 and the first five ran 8 to 12. A wave of eight is
not a wave, it is an errand: one body of the right damage type answers it, and
there is nothing to place against. The density target is the genre's — Squadron
Tower Defense runs 25 to 45 — and it is what makes placement, splash and a
front line worth anything.

Holding that density meant **cutting the early monsters down**, because 25
bodies at the old 45 health each is 1,125 health against a wave 1 army of about
1,000. A grub is 30 health now and does 6 damage; a husk is 110 rather than 170.
Fewer, bigger monsters would have been the other answer, and it is the wrong one:
the count is what the game is made of.

### Every wave asks for something, and it is not the same thing

The first attempt spread each wave's armour around so nobody was wrong-footed.
That was backwards, and the reasoning that corrected it is worth writing down:

> If the wave has some of everything, then there is nothing for me to build
> against, and any composition I have will be strong in some ways and weak in
> others. So I can just spam the single most broken unit my builder has.
> Versus, if each wave has a particular strength, I will get wrecked on the
> wave that counters my one-unit strategy, and I'll lose. So I have to build
> balance to survive.

A balanced wave is a wave with no answer, and a wave with no answer is a wave
you brute-force. So each of the five is about 80% one armour type and the type
rotates: Swarm, Flesh, Plate, Ward, then a boss wave carrying all four plus
whatever the boss came up as.

Which builder that hurts rotates with it, because a builder's cheap half —
rungs 1 to 3, all a 200-to-500 gold player can reach — carries three of the
four damage types and is therefore missing one. Ironvow had no Blast down there
and cleared 5% of its armies at the Flesh wave; swapping which of its rungs
carries Blast and which carries Arcane took that to 23% without giving it
anything it did not already own.

**The damage a wave DEALS matters as much as the armour it wears**, and that is
easier to miss. Blast is the only damage type Flesh armour fears, and the only
monster in the game that dealt any was the Bloater, which does not appear until
wave 16. So through the whole early game Flesh was simply the best armour to
wear, Pyre wore it on its cheap front line, and Pyre cleared more of every one
of the first five waves than anyone — on survivability, not damage, which is
why the damage-per-gold table never showed it. The Swarmling deals Blast now.

### The boss, and its purse

The bank is **four bodies of equal power in four armour types**, not a
difficulty ladder. A boss is drawn at random (§3.4), so a bank whose members ran
1,400 to 3,100 health made wave 5 a different fight depending on the die, and no
amount of tuning the escort makes that one wave. They differ in shape — the Ward
one hits hardest and has least health, the Flesh one the reverse — so which
comes up changes how you fight it and not whether you can.

They are 3,500 to 4,300 health and hit for 105 to 145 at about 73 damage a
second — roughly three times what they were. At 1,275 health a boss died in
five seconds against an army that could afford wave 5 at all, which is not a
boss, it is a large monster. It is now more than half of wave 5's health on its
own, and the escort came down to 26 bodies to make room for it.

What separates wave 25's boss from wave 5's is `waves.bossScaling`, compounded
per BOSS WAVE rather than per wave: 1.6× health and 1.35× damage each time one
comes round. A boss does NOT also take the per-wave growth every other monster
gets, or it would take both.

And a boss pays a **purse** (`economy.bossBounty`, 200) on top of its share of
the wave pool. The pool is fixed, so without one a boss wave pays exactly what
wave 4 paid for several times the work. It is paid on the kill, so a boss that
walks past the line pays nothing.

### How a wave is measured

`npm run waves` runs the sandbox (`src/balance/sandbox.ts`) over every army each
builder could buy at gold bands either side of the wave's nominal. What it
reports per wave, builder and band:

- **cleared** — every monster dead, none past the line. The bar.
- **margin** — own health left minus the wave's health left, from +1 (untouched
  against a wiped wave) to −1. How comfortably, rather than whether.
- **time** — seconds of game clock. A wave that takes ninety seconds is not
  the same wave as one that takes fifteen, whoever wins it.

It also reports **what each line gave back for what it cost**: damage per gold,
averaged over every fight a line appeared in, and health per gold. Neither is a
verdict — a wall is supposed to be all health and a gun all damage — but a line
that is several times its neighbours on both is carrying something its price
does not know about. That is how Ember Mark III was caught: half again the
damage per gold of the identically statted Pledge Mark III, and a tank besides,
because its top mark comes with an area attack that nothing charged for it.

A wave is tuned when, at its nominal: a good build clears it with room over, a
poor build at the same gold does not, and half the gold clears nothing.

### Where the five landed

Every army every builder could buy, at four gold bands, against all five waves.
2,332 probes in two minutes, `reports/waves-11.txt`. Pooled over the four
builders, the share that cleared:

| wave | 50% | 75% | 100% | 125% |
| ---: | --: | --: | ---: | ---: |
|    1 |  0% |  0% |  71% |  98% |
|    2 |  0% |  3% |  43% |  81% |
|    3 |  0% |  9% |  64% |  88% |
|    4 |  0% | 11% |  65% |  79% |
|    5 |  0% |  6% |  57% |  94% |

That is the shape the ladder was after. Half the nominal clears nothing at any
wave. Three quarters is a real fight and mostly a lost one. At the nominal a
good build passes and a bad one does not, which is the decision the whole thing
exists to create. A quarter over — the slack — is safe.

**What it says about the builders.** Best margin at nominal, which is a finer
reading than clear rate:

| wave | ironvow | pyre | thornweald | gloomtide |
| ---: | ------: | ---: | ---------: | --------: |
|    1 |    0.53 | 0.42 |       0.82 |      0.58 |
|    2 |    0.41 | 0.53 |       0.66 |      0.41 |
|    3 |    0.63 | 0.61 |       0.78 |      0.52 |
|    4 |    0.47 | 0.71 |       0.84 |      0.37 |
|    5 |    0.55 | 0.54 |       0.78 |      0.50 |

Thornweald is first at all five on margin and mid-table on clear rate: a few
very good answers and a lot of bad ones. Pyre is the reverse — it clears 70 to
95% of its armies at every wave on the thinnest margins in the game, which is a
builder that is hard to build badly. Those are legitimately different identities
and not obviously a problem; what would be a problem is one builder ahead on
both, and none is.

Pyre took three passes to get there, and what finally moved it is worth
recording because the obvious instruments all missed it. Its lines are not
stronger per gold — a table of effective damage per gold at rungs 1 to 3 put it
LAST at three of the five waves — and it carries 11% fewer raw stats than
anyone else's cheap half. What it has is that **all three of its cheap abilities
are offence and all three fire on attack, two of them at more than one body**,
where the other three builders have a slow, an evade, a shield and a heal aura
down there. Against thirty monsters arriving together that is a different order
of thing, and it is not something a body's price knows about. Spitfire and
Wildfire were priced down; the bodies were never the problem.

**Hold all of this against the showdown, which disagrees.** In the arena
Gloomtide wins 44% of four-ways and Pyre 19%. A builder is not strong or weak,
it is strong or weak AT A PHASE, and a weight aimed at one record lands on the
other. Gloomtide's 8% weight is now on its rungs 4 to 6 only, which is what the
arena is fought with; its cheap half, which is what the waves are fought with,
carries none.

## 5. The phases

**Phase 0 — instrumentation.** _Done._ Vocabulary settled, the budget computed
rather than guessed, the round robin running with its controls.

**Phase 1 — the showdown.** _Here._ Get the four builders to parity in the
arena, at equal gold and equal supply, turning gold cost, supply cost and stats.
Nothing about waves.

**Phase 2 — abilities.** The ladder prices bodies. It does not price what they
do, and until it does, a unit with a strong ability is strictly better than one
without at the same price. Measure each ability's worth by removing it from a
fixed army and re-running, then put the number in `abilityWeights` and reprice.

**Phase 3 — waves.** _Waves 1 to 5 done; 6 to 25 open._ Monster strength,
composition and the difficulty curve, measured with `npm run waves` against the
army-gold ladder below. Waves 6 to 25 are stale: they were authored against
monster stats that have since been cut, and they still run 12 to 30 bodies
rather than the 25 to 45 the early ladder now runs at.

**Phase 4 — sends, and the meta.** What makes an _attack_ send correct. A
100-gem bloater has a payback of 16 waves and never pays for itself
economically, so its value is entirely "damage or forced defensive investment",
and the metric that has to exist is **gold of enemy defence forced per gem
spent**. If that is below 1 for every attack send, sending is never correct and
three of the five sends are dead content.

**Phase 5 — humans.** The simulation cannot measure whether 30 seconds is enough
to make five decisions on a phone, whether the build bar is legible mid-panic,
or whether losing to three opponents ganging up feels bad.

---

## 6. How we will know when it is balanced

In order. **Each one gates the ones below it.**

### 0. Mirror control

Four copies of one builder on one build. **25% a seat, within the quoted
error.** Anything else is the _arena_ being unfair rather than the roster, and
every builder number in the report would inherit it. Expect the winner to win by
a hair — critical hits and tie-breaks have to land somewhere — so this is a test
of the mean, not of whether the fight was close.

### 1. Seat parity

Win rate by spoke across the four-ways, seating shuffled. **25% ± 3 points.** The
arena is a cross whose four spokes are meant to be one spoke rotated.

### 2. Duels

The primary signal, because a four-way is confounded by who converges on whom —
a player nobody walks at wins fights they never fought.

- **No matchup outside 40/60**, in either direction.
- No builder outside **50% ± 3 points** across all its duels.
- Margin, in surviving supply, within **10 points** across builders. A 51/49
  matchup where the loser is always wiped is a different problem from a 51/49
  where it is not.

### 3. Four-ways

**25% ± 3 points** a builder. Expected to need only small adjustments once the
duels are flat; a builder that is fine one-on-one and dominant four-way is a
finding about focus-fire, not about its roster.

### 4. Builds

- **No build above 60%** win rate. If one shape of army is simply correct, the
  rung ladder is wrong, not the builder.
- **No pure-rung build in the top two or the bottom two** by a wide margin. That
  is the ladder's own self-test.
- No build that could not spend its budget is scored as a balance finding.

### Sample sizes

The most expensive mistake available here is nerfing a builder over forty fights
of noise. Every headline number in the report carries its standard error;
`sqrt(p(1-p)/n)` at an even 50% means:

| fights | error       |
| ------ | ----------- |
| 100    | ±5.0 points |
| 280    | ±3.0        |
| 1,000  | ±1.6        |
| 2,500  | ±1.0        |

A fight between full-budget armies costs about 15 seconds of CPU, because every
distinct `(radius, range)` among the seekers needs its own flow field every tick
and a six-rung army has six of them. `npm run showdown` forks one process per
core; `--shard i/n` splits a run across machines.

### Not yet criteria, but they will be

- **Minimum gold to clear wave N with no fortress damage**, per builder, within
  ~10% across builders at every wave. This is phase 3's headline number and it
  is the one that decides how much gold each builder brings to the showdown —
  which means phase 1 and phase 3 are not independent. What has to be equal in
  the end is the **product** of showdown strength per gold and gold left after
  surviving.
- **Decision density**: at each build phase, at least two purchases within 10%
  of the best marginal value. This is the closest thing to a measure of whether
  the game is any fun.
- **No dead content**: every line, every tech track and every send bought in some
  meaningful fraction of strong builds.

---

## 7. Adjusting the formula

The formula is code, not prose, so changing it is changing
`src/balance/budget.ts` and re-running `npm run budget`. The things most likely
to want changing, in the order they would be reached for:

1. `ASSUMPTIONS.secondsPerWave`, once phase 3 has a real curve. It scales the
   passive half of the budget directly.
2. `ASSUMPTIONS.outputLevelsPerWave`, if the supply cost of gem output turns out
   to make one-a-wave the wrong habit.
3. `economy.waveBounty`, which is the only part of the gold curve that is a
   straight dial.
4. `SUPPLY_EFFICIENCY_PER_RUNG` and `GOLD_EFFICIENCY_PER_RUNG` in
   `pricing.ts` — the two numbers the whole roster hangs off. Raising the first
   makes the top of the ladder more attractive per supply and therefore dearer;
   raising the second makes expensive units better value and flattens the
   reason to go wide.

After any of them: `npm run reprice` to see the diff, `-- --write` to apply it,
then `npm test` and `npm run showdown -- --quick` before trusting anything.
