# Balance: the budget, the ladders, and how we will know

**Status: phase 1 of 4. The economy and the price ladders are in; the showdown
round robin runs; nothing has been tuned on its results yet.**

Every number in `data/` is a placeholder until something measures it. This file
is the plan for measuring them, the arithmetic the roster is priced against, and
the standard we are going to hold the answer to. Three commands reproduce
everything quoted here:

```
npm run budget     what a medium player can afford by the Final Showdown
npm run reprice    the price ladder, and whether the roster is on it
npm run showdown   the round robin, across every core
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
and a Mark III 4.75×. It is worth 2.65× and 5.2× — about 6% and 9.5% ahead of
flat — so going tall is slightly better gold **and** enormously better supply.

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

**Abilities are not priced.** A taunt, a shield, a slow and an execute are not
stats and a scalar that pretended to price them would be confidently wrong.
Every unit carries an implicit ability weight of 1 until the round robin has
measured what its ability is actually worth; `priceRoster`'s `abilityWeights` is
where that measurement goes, and closing that gap is phase 2's main job.

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

## 4. The phases

**Phase 0 — instrumentation.** _Done._ Vocabulary settled, the budget computed
rather than guessed, the round robin running with its controls.

**Phase 1 — the showdown.** _Here._ Get the four builders to parity in the
arena, at equal gold and equal supply, turning gold cost, supply cost and stats.
Nothing about waves.

**Phase 2 — abilities.** The ladder prices bodies. It does not price what they
do, and until it does, a unit with a strong ability is strictly better than one
without at the same price. Measure each ability's worth by removing it from a
fixed army and re-running, then put the number in `abilityWeights` and reprice.

**Phase 3 — waves.** Monster strength, composition and the difficulty curve.
This is currently wide open: the reprice lifted the middle of the roster about
4× and the top 12–20×, so every wave is a no-contest — `npm run builders`
clears all 25 with four fortresses at 100%. It is the safe direction (monsters
are one knob and can be turned up) and it is deliberately deferred.

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

## 5. How we will know when it is balanced

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

## 6. Adjusting the formula

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
