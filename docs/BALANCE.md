# Balance: the budget, the ladders, and how we will know

**Status: phases 1 and 3 both open. The economy and the price ladders are in,
the round robin runs, and every builder wins between 47% and 53% of its duels.
All twenty-five waves are tuned against an army-gold ladder and against whole
runs on five economy plans, and gem output costs 3 more gold a level. The game
has since been played to break it (§4b): the
regeneration aura no longer heals for free, and the arena is walked at 2.5×
so that no single shape of army wins it. The send tab is now a fifteen-send
ladder from 10 to 500 gems, fixed prices, each send on a cooldown and the dear
ones opening as the game reaches them (§4c). The open question is still the
late-game builder gap: Thornweald and Gloomtide win the late game more often
than Pyre and Ironvow.**

Every number in `data/` is a placeholder until something measures it. This file
is the plan for measuring them, the arithmetic the roster is priced against, and
the standard we are going to hold the answer to. Five commands
reproduce everything quoted here:

```
npm run budget     what a medium player can afford by the Final Showdown
npm run reprice    the price ladder, and whether the roster is on it
npm run showdown   the round robin, across every core
npm run waves      every army a builder could buy, against every wave
npm run runs       whole runs, played, on four economy plans
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

| builder    | 1         | 2        | 3        | 4          | 5          | 6           |
| ---------- | --------- | -------- | -------- | ---------- | ---------- | ----------- |
| Ironvow    | Pledge    | Sentinel | Vigil    | Oathwall   | Sanction   | Judgement   |
| Pyre       | Ember     | Wickling | Foxfire  | Slagmaw    | Firebrand  | Scoria      |
| Thornweald | Thornling | Mycelia  | Rotgourd | Hollowbark | Sporecrown | Nettlespire |
| Gloomtide  | Kelpsnare | Murmur   | Sleet    | Fathomhold | Maelstrom  | Torrent     |

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

A player who spends every coin on army has 250 at wave 1, 200 more each wave
after (a wave pays a fixed pool, §11.1), and a boss's 200-gold purse on top
after waves 5 and 10. The nominal was set at about four fifths of that for
waves 1 to 3, and **the fifth left over is the point**: it is the room to bank
gold, buy economy, take a risk, or cover a bad build.

| wave | theme      |    monsters |  health | `armyGold` | no economy has | steady has | asks for                     |
| ---: | ---------- | ----------: | ------: | ---------: | -------------: | ---------: | ---------------------------- |
|    1 |            |          30 |     540 |        200 |            250 |            | Swarm 78%                    |
|    2 |            |          38 |   1,337 |        350 |            450 |            | Flesh 80%                    |
|    3 |            |          34 |   3,304 |        500 |            650 |            | Plate 89%                    |
|    4 |            |          36 |   2,480 |        740 |            850 |            | Ward 62%                     |
|    5 | boss       |     26+boss |   6,461 |        920 |          1,050 |            | all four, and a boss         |
|    6 | Volley     |          32 |   4,676 |      1,400 |          1,450 |            | Ward: all ranged             |
|    7 | Skitter    |          45 |   4,155 |      1,500 |          1,650 |            | Swarm: tiny and fast         |
|    8 | Bulwark    |          27 |  15,093 |      1,750 |          1,850 |            | Plate: slow and armoured     |
|    9 | Rush       |          27 |  11,867 |      1,925 |          2,050 |            | Flesh: divers and bursters   |
|   10 | boss       |     22+boss |  14,581 |      2,175 |          2,250 |            | all four, and a bigger boss  |
|   11 | Hollow     |          28 |  14,749 |      2,550 |          2,650 |      2,684 | Ward: immune to abilities    |
|   12 | Mend       |          33 |  24,468 |      3,000 |          2,850 |      3,247 | Flesh, healed from behind    |
|   13 | Siege      |          28 |  27,500 |      3,300 |          3,050 |      3,442 | Plate, with guns behind it   |
|   14 | Frenzy     |          34 |  15,708 |      3,850 |          3,250 |      4,174 | Swarm and Flesh, all fast    |
|   15 | boss       |     26+boss |  39,703 |      4,500 |          3,450 |      4,998 | a boss with healers          |
|   16 | Blight     |          37 |  55,397 |      4,290 |          3,850 |      4,876 | Flesh: Bloaters in a horde   |
|   17 | Stampede   |          36 |  25,483 |      5,280 |          4,050 |      5,999 | Swarm and Flesh, all fast    |
|   18 | Dirge      |          31 |  51,650 |      6,390 |          4,250 |      7,262 | Ward: every one of them      |
|   19 | Iron Tide  |          28 | 116,057 |      6,400 |          4,450 |      7,201 | Plate: the Bulwark, at scale |
|   20 | boss       |     21+boss | 114,690 |      7,710 |          4,650 |      8,765 | one of everything hard       |
|   21 | Artillery  |          35 |  89,556 |      8,400 |          5,050 |     10,195 | Ward: the Volley, at scale   |
|   22 | Bastion    |          28 | 160,010 |      8,500 |          5,250 |      9,576 | Plate, healed from behind    |
|   23 | Onslaught  |          39 | 171,671 |     10,400 |          5,450 |     11,834 | Flesh and Swarm, sprinting   |
|   24 | Juggernaut |          34 | 216,909 |     12,600 |          5,650 |     14,320 | Flesh and Ward, healed       |
|   25 | Council    | 12 bosses+4 | 808,041 |     21,000 |          5,850 |     17,042 | a full army, or nothing      |

"Steady has" is the budget model's steady player going into the wave — one gem
output level a wave, a rate level every five — after paying for its gem
building and for the tech the sweep fights with (below). It is the line waves 11
to 20 are set against; the column to its left is the line waves 1 to 10 are.

`armyGold` is where an AVERAGE build clears — the gold at which 55 to 65% of
every army a builder could buy takes the wave with nothing leaking. It is not
what a good build needs, which is 80 to 90% of it, and it is set against a
player with no economy at all. So from wave 4 the column on the right looks
thin, and it is thin on purpose: waves 6 to 10 grow faster than a flat 200 gold
a wave because the economy does (see below), and the full-run harness is the
measure of whether there is room left. There is — a player who bought no
economy and played well still had about 450 gold in hand at wave 10 with the
fortress untouched.

Health is what the wave is worth AT THAT WAVE, not what its definitions say:
every monster grows one step a wave (§9.1, amended) — 1.22× health and 1.17×
damage — so the same 30-health grub is a 66-health grub by wave 5 and a
180-health grub by wave 10. That is what lets a wave reuse a body without getting
easier, and it is why the stat panel resolves against the wave on screen rather
than reading `monsters.json`. Health per gold is not the difficulty curve on its
own: the bodies are getting individually harder, a boss is one lump that can
only hit one thing at a time, and a Bulwark's 15,000 health is slow Plate that
has to walk to you.

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

### Waves 6 to 10, and the two new monsters

Each has a theme you have to answer, on top of an armour type:

- **Volley (6)** — every monster fights from range: Spitters from two and a
  half tiles, Wardens from one. A line that does not walk forward is being shot
  for free, and a back line that out-ranges them is worth more than one that
  out-damages them.
- **Skitter (7)** — forty Mites. A Mite is 0.13 tiles where every other monster
  is 0.22, so nearly three times as many fit around a unit, and it is the
  fastest thing in the game. One is nothing; forty surrounding a gun are the
  whole wave. Splash is the answer, and so is a line with no gaps in it.
- **Bulwark (8)** — Husks and Carapaces: fifteen thousand health of slow Plate
  that shrugs off a fifth of every hit. Sustained Pierce, and time.
- **Rush (9)** — Stalkers sprint in on Ambush and go for the back line;
  Bloaters burst when they die. Flesh armour, Blast damage.
- **Boss (10)** — the bank once over (`bossScaling`), with an escort that
  borrows from the four before it.

**The Spitter and the Mite** are the first monsters that are not a 0.22-tile
disc fighting from contact. The Mite broke one thing: the spawn lattice was
sized by the smallest monster IN THE GAME, which was the same as the smallest
monster in the wave until the Mite existed — after which every wave spawned on a
Mite-sized lattice, packed its grubs nearly edge to edge, and arrived at the line
as a crowd that shoved engaged bodies into each other. It is sized by the
smallest body being placed now.

**The Stalker deals Blast.** Pierce was the damage type of every heavy hitter
in the monster set — Warden, Carapace, Stalker — while Blast belonged to the
Swarmling and the Bloater, one tiny and one rare. So Flesh, which only Blast
hurts, was the best armour to wear for the first half of the game. The Rush
wave is where a Flesh front line pays for it.

### Waves 11 to 20: the Mender, the Revenant, and a curve that bends

Each still asks one question on top of its armour:

- **Hollow (11)** — the Revenant's first wave. Wardens and Motes, with Revenants
  that no ability touches: no slow, no burn, no soak, no chain. Only plain
  damage works, which is a bad day for an army built on its abilities.
- **Mend (12)** — the Mender's first: a Grub horde and five Bloaters, held
  together by healers standing out of reach behind them. Killing things is not
  enough; the answer is reach, a diver, or burst that finishes a body between
  two heals.
- **Siege (13)** — Carapaces and Husks in front, Spitters behind: a Plate wall
  with guns over it.
- **Frenzy (14)** — Mites and Stalkers. Everything is fast and half of it is
  tiny: Arcane or splash for the one, Blast for the other.
- **Boss (15)** — with Menders in the escort, and a Mender heals a share of
  whatever it is standing behind. Including the boss.
- **Blight (16)** — seven Bloaters in a Grub tide. Every Bloater that dies in
  your melee bursts on it, and Rupture now grows with the wave.
- **Stampede (17)** — thirty-six bodies, Mites and Stalkers, as fast as the game has.
- **Dirge (18)** — every monster is Ward: Revenants that shrug off abilities,
  Wardens that slow your swing, Spitters behind, and Menders keeping the
  Spitters alive.
- **Iron Tide (19)** — over a hundred thousand health of Plate: the Bulwark
  again, seven times over.
- **Boss (20)** — a bigger boss, with an escort that takes one of everything
  hard.

**The Mender** stops short like a Spitter and heals the most wounded monster in
reach by a share of that monster's maximum health (`mend`, 5% every 2.5
seconds). A share, not a number, so it grows with whatever it stands behind.
Revenants are immune to it, as they are to everything.

**Rupture grows with the wave.** It was a flat 60 — a Bloater hit and a half at
wave 1, a sixth of one by wave 15 — so the thing a Bloater wave asks for had
quietly stopped being asked. It is 1.6 of the Bloater's own hit now.

**The curve bends at wave 10.** Monsters grow 1.22× health and 1.17× damage a
wave to wave 10, because that is where the economy compounds fastest. Past it
an army grows by roughly what a wave pays, and the early rate would have
outrun every army there is by wave 15 — leaving nothing to build later waves
from but Grubs. From wave 11 it is 1.15× and 1.11× (`scaling.after`). Bosses
went the other way: at 1.6× a boss wave, the wave 20 boss would have had
16,000 health against a 9,000-gold army, which is one large monster. From
wave 15 a boss grows 2.2× health and 1.6× damage (`bossScaling.after`).

**Past wave 10 the ladder is set against a player with an economy.** The
nominals for waves 1 to 10 sit under what a player with NO economy has; from
wave 11 they sit under what the budget model's steady player has for the army —
one gem output level a wave, a rate level every five, after paying for both and
for tech. A player with no economy is meant to fall behind there, and does.
Waves 11 to 15 sit at 90 to 96% of the steady line and 16 to 24 at about 88%.
They were at 94 to 97% for a while, and at that only Thornweald's scripted
player reached wave 25 under any economy: a run's army is shaped by every wave
before it and cannot be bought fresh for each one, which a sweep of fresh armies
does not see. At 88% every plan with an economy gets somebody to the council.

**The sweep fights with tech from wave 13.** Every army in it carries a level
each of health, attack speed and its main damage type from wave 13, two from
16, three from 19 — what a steady player owns by then (`techAtWave`). The first
20-wave runs had a player who bought tech needing about two thirds of each late
wave's nominal, because the nominal had been measured against armies with none.

### Waves 21 to 25, and the council

- **Artillery (21)** — the Volley at scale: eighteen Spitters and eleven Wardens
  firing over six Revenants. Reach, or a line that walks forward and gets
  there.
- **Bastion (22)** — ten Carapaces and eleven Husks with seven Menders behind: a
  Plate wall that heals.
- **Onslaught (23)** — Stalkers, Mites and Bloaters, thirty-nine of them, all at
  a sprint.
- **Juggernaut (24)** — Bloaters, Revenants, a Grub screen and Menders: Flesh and
  Ward, one of them immune to everything clever.
- **The Council (25)** — three of each of the four bosses, and four Menders to
  keep them standing. They were built as one of each armour type so that no
  single damage type answers a boss wave, and together that is the point: the
  Hollow King stuns the line in front of it, the Brood Sire hits harder the
  more it is hurt, the Gravemother heals itself off every wound it deals, the
  Chitin Lord cannot be held once it is wounded and shrugs off a fifth of every
  hit, and the Menders heal a share of whatever they stand behind — a boss
  included.

**Why twelve.** A boss grows on its own curve (`bossScaling`), slower than the
monsters: by wave 25 a boss is 17 times its base health where a Grub is 49
times. One of each would have been a tenth of what a wave-25 army is. Three of
each is what the sweep says it takes.

**The council is set above the steady line, on purpose.** Its nominal is
21,000; a steady economy has about 17,000 for its army going into wave 25, and
an army at the supply cap costs about 21,000 by the budget model. At 21,000 two
armies in five clear it; at 26,000, four in five. In whole runs it was beaten,
untouched, by five players who arrived with 89 to 109 supply and 19,000 to
24,000 gold of army and tech between them — all Thornweald and Gloomtide. It
killed the two steady players who arrived with 81 and 84 supply and about
15,000, which is the brief. It also killed Ironvow's strong player, who arrived
with 104 supply and 21,000, which is not the council's doing: it is the
late-game builder gap (§4a). That is the brief — very hard
without a maxed-out army — and the test that holds every other wave under the
steady line exempts this one by name.

**One purse a boss wave.** A boss pays a purse on the kill; with twelve bosses
that would have been twelve purses — 2,400 gold — the moment before the Final
Showdown. A boss wave now pays one purse, shared between its bosses, which
changes nothing for waves 5 to 20. A wave past 25, reusing the last authored
shape, brings its monsters and not its bosses.

**The tech the sweep assumes tops out at level 4** from wave 22, about where the
budget model has a player by the showdown (3.5).

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

Past wave 10 the enumeration had to change. The number of distinct armies
grows about three and a half times every 500 gold — a million a builder at
2,500, six million at 3,500 — and a sweep past wave 10 ran out of memory holding
them. Almost all of that growth is one line split across marks, four Mark I and
two Mark II of the same rung, which is a real army mid-upgrade but not a
different answer to a wave. So past 2.5 million armies each line is bought at a
single mark, which bounds the count at any gold; every band of waves 1 to 10 is
still enumerated in full, exactly as those waves were tuned. The sweep now plans
once and hands each process its share, where each process used to plan the
whole thing itself — three minutes and 3.5 GB apiece past wave 10.

### Where the twenty-five landed

Every army every builder could buy, at four gold bands, against all twenty-five
waves — 15,140 probes in twenty-three minutes, `reports/waves-25.txt`. Pooled
over the builders, the share that cleared:

| wave | 50% | 75% | 100% | 125% |
| ---: | --: | --: | ---: | ---: |
|    1 |  0% |  0% |  71% |  98% |
|    2 |  0% |  1% |  45% |  84% |
|    3 |  0% |  2% |  52% |  81% |
|    4 |  0% | 14% |  64% |  92% |
|    5 |  0% |  2% |  61% |  96% |
|    6 |  0% |  8% |  74% |  95% |
|    7 |  0% |  8% |  62% |  95% |
|    8 |  0% |  4% |  69% |  92% |
|    9 |  0% |  4% |  55% |  94% |
|   10 |  0% |  1% |  51% |  96% |
|   11 |  0% |  1% |  50% |  79% |
|   12 |  0% |  4% |  58% |  87% |
|   13 |  0% |  4% |  54% |  89% |
|   14 |  0% |  8% |  62% |  88% |
|   15 |  0% | 19% |  60% |  83% |
|   16 |  0% | 22% |  64% |  92% |
|   17 |  0% | 29% |  71% |  84% |
|   18 |  0% | 16% |  64% |  92% |
|   19 |  0% | 15% |  44% |  80% |
|   20 |  0% | 20% |  81% |  92% |
|   21 |  0% | 11% |  65% |  84% |
|   22 |  1% | 26% |  68% |  90% |
|   23 |  2% | 26% |  66% |  80% |
|   24 |  0% | 14% |  69% |  97% |
|   25 |  0% | 14% |  44% |  86% |

Half the nominal clears nothing. Three quarters is a fight you mostly lose. At
the nominal a good build passes and a bad one does not, which is the decision
the ladder exists to create. A quarter over is safe — less so past wave 15,
where the waves that are a check (Blight on melee, Stampede on splash, Iron
Tide on sustained Pierce) fail a quarter of armies whatever they spent, because
money does not buy the answer if the army has none. Past wave 15 the nominal
clears two thirds of armies rather than half, on purpose: a run's army is
carried from wave to wave rather than bought fresh for each one, and the waves
were eased until a strong economy reliably arrived at the council (§4a). Iron
Tide (19) and the council (25) are the two walls, at 44%.

That table is about one wave at a time. Whether a WHOLE RUN is balanced is a
different question, and the one that decides it is how far a player can push
the economy — which is the next section.

## 4a. How far the economy can be pushed

The sandbox cannot see the economy. Gem output makes gems, gems buy sends,
sends buy income, and income arrives every wave for the rest of the game: a
player who invests early is poorer for a few waves and richer after, and
whether "a few waves" is survivable is only visible over a run.

`npm run runs` plays waves 1 to 10 in the real simulation (`src/balance/run.ts`)
with a scripted player on four economy plans:

- **army** — no economy at all. Its gems still go into income.
- **steady** — the line `budget.ts` models the whole game on: one output level a
  wave, a rate level every five, army first to a safe margin.
- **greedy** — output to 20 and two rate levels by wave 10, bought before the
  army every time, whatever that costs it.
- **smart** — the same greed played well: army only until the coming wave is
  safely won, every spare coin into the economy, and save before a boss. Where
  this lands at wave 10 is the real answer.

Its army is bought by LOOKAHEAD: for everything it could buy, it plays the
coming wave in the sandbox with and without it, and buys what gains most per
gold. That is a stronger player than most people, on purpose — a weak army
policy would make greed die of bad play and call the waves tuned.

**The design's line**: a player who can reach gem output 20 with two rate levels
by wave 10 and still be alive has found waves that are too soft or a builder
that is too strong.

**At first, three builders crossed it.** Smart greed reached output 20 to 25
with two or three rate levels, the fortress never below 91%. The economy
compounds and the waves did not: their difficulty grew by the flat 200 gold of
the wave bounty while a medium economy's income was adding up to 175 a wave on
top. What fixed it, in the order the runs found it:

1. **A steeper monster curve** — 1.22× health and 1.17× damage a wave, from
   1.18 and 1.14 — so the waves outgrow a linear line. This moved waves 4 and 5
   by about a tenth too, and their nominals with them.
2. **Heartwood** (Hollowbark) regenerated 1.2% of maximum health a second —
   29 a second on a Mark I — and a pair of Hollowbarks, 356 gold, beat waves 2
   to 4 alone by out-healing them. No other rung-4 pair cleared wave 3. Halved,
   and its middle rank cut further.
3. **Underweb** (Mycelia) gave four allies 1.8% of maximum health a second at
   Mark III, and stacked with Heartwood into a wall healing near 200 a second:
   three bodies held wave 8. Halved.
4. **Firebrand** had the highest rung-5 damage in the game AND a splash, at the
   price the ladder charges Sanction for a single target; a pair of them cleared
   waves 2 to 4 in five seconds. Its splash reaches three bodies rather than
   four and the line carries a 1.15 weight.
5. **Sporecrown**'s rapid 116-damage shots waste almost nothing on a
   70-health monster, where a rung-5 heavy hitter overkills it by 350. The price
   ladder cannot see overkill. A 1.1 weight.
6. **Hollowbark** itself took a 1.1 weight after all of that.

Three of those changes (Heartwood, Underweb, the Hollowbark and Sporecrown
weights) are scoped to Marks I and II, or to lower ranks: a wave-1-to-10 army
fields those, and the Final Showdown is fought at Mark III.

And one thing about the INSTRUMENT, because it nearly produced the wrong
answer. The sandbox's margin is army health left minus wave health left, and a
wave that walks PAST an army is wave health left — so a tanky army that
survived at 38% while a quarter of wave 6 strolled by scored +0.15, a win. The
scripted player optimised that, bought exactly that army against the all-ranged
wave, and lost its fortress with two Hollowbarks still standing. It weighs what
leaks four times what survives now. The sandbox's own report was always right
about that fight — it said "not cleared" — but the one-number margin was not.

**Where it landed** — `reports/runs-07.txt`:

| builder    | army               | steady             | greedy      | smart: output / rate at wave 10 |
| ---------- | ------------------ | ------------------ | ----------- | ------------------------------- |
| Ironvow    | all ten, untouched | all ten, untouched | dies wave 5 | 14 / 2                          |
| Pyre       | all ten, untouched | all ten, untouched | dies wave 5 | 13 / 2                          |
| Thornweald | all ten, untouched | all ten, untouched | dies wave 4 | 14 / 2                          |
| Gloomtide  | all ten, untouched | all ten, untouched | dies wave 3 | 12 / 1                          |

Nobody reaches the line, and all four stop within two output levels of each
other. A player can still out-invest the budget model's steady line by about
half, which is the room for a greedy plan to pay off.

### To wave 20

The same four plans, played to wave 20 (`reports/runs-20.txt`), with two
changes to the player: it buys tech, judged by the same lookahead as bodies,
and it buys in lots of about a sixth of its gold, because one body at a time
was seven hundred simulated waves a build phase at late incomes.

| builder    | no economy | steady                    | greedy | smart greed           |
| ---------- | ---------- | ------------------------- | ------ | --------------------- |
| Ironvow    | dies 15    | dies 15 (the boss)        | dies 5 | all twenty, untouched |
| Pyre       | dies 16    | dies 19                   | dies 5 | all twenty, untouched |
| Thornweald | dies 16    | all twenty, 2,198 in hand | dies 4 | all twenty, untouched |
| Gloomtide  | dies 15    | dies 19                   | dies 3 | all twenty, untouched |

It took three passes to get here. The first set waves 11 to 20 at four fifths of
the steady line with no tech in the sweep, and everyone with an economy walked
through them — smart greed had maxed its gem building by wave 15 while fielding
80% of each wave's nominal. The second raised the nominals without the tech and
over-shot on one wave: forty Mites at wave 14 were a splash check that 42% of
armies failed with a quarter more gold, and it killed two steady players who
happened to own no splash. The third is the one described above.

**No economy dies at 15 or 16, and that is the design.** It is where the ladder
stops being set against a player with none. **Naive greed** still dies by wave 5. **Smart greed** stays under the wave-10 line (output 11 to 15, rate 1 or 2)
and survives everything.

**What is left open is not a wave question.** Smart greed reaches the top of the
gem building — output 25, rate 5 — between waves 13 and 15, every builder. From
there the economy is no longer a decision: its income runs at 2,000 to 2,700 a
wave against a steady player's 1,000 to 1,500, and it finishes wave 20 untouched
with 2,500 to 4,800 banked. No wave 16 to 20 can threaten that player without
killing the steady one first, because the gap between them is the economy.
Output levels cost a flat 50 gold all the way to 25, so the last ten are as
cheap as the first; a rising price on the late levels, or a lower ceiling, is
the lever — and it is the economy's formula, so it is a design call.

**Thornweald is the late-wave builder.** It is the only steady player alive at
wave 20, and at the nominal it clears 75% of wave 19 where the others clear 35
to 45%. Not acted on yet: one run each is a single seed, and the sweep's
per-builder spread past wave 15 is wide for everyone.

### The gem output price rises

That open question was answered by making each output level cost more than
the last: 50 gold for the first, then 3 more a level, 122 for the twenty-fifth.
The brief was that a strong economy should still win the late game, but that
getting one should not be easy, and maxing the building by wave 15 should be
extremely risky.

Rises of 1, 2 and 3 gold a level were each played by the maximum-greed player,
every builder, on three seeds, to wave 20 — eleven runs a step, leaving out one
seed on which Ironvow died to its wave-5 boss draw whatever the price was:

| rise a level | maxed output by wave 15 | of those, died | died at all |
| -----------: | ----------------------: | -------------: | ----------: |
|  0 (flat 50) |                10 of 11 |              1 |     1 of 11 |
|           +1 |                 6 of 11 |              3 |     6 of 11 |
|           +2 |                 3 of 11 |              0 |     4 of 11 |
|           +3 |                 0 of 11 |              — |     6 of 11 |

At +2 the few who got there by wave 15 all lived — harder, but not risky. At +3
nobody gets there by 15 however greedy, and more than half the players who try
die; the ones who do not still finish on about twice the steady player's
income, which is the strong economy winning the late game. So +3.

Two things the table does not say on its face. At +1, Gloomtide's greed collapsed
at wave 8 on all three seeds — the price tipped the scripted player's choice
between output and rate at the wrong moment — which is an artefact of one
player's policy, not of the price. And who survives greed depends more on the
BUILDER than on the price: Thornweald and Gloomtide came through at every step,
Ironvow and Pyre mostly did not. That is the late-wave builder gap again.

The steady player spends a little more on its gem building too, so the line the
later nominals sit under came down by up to 500 gold, and waves 16 to 22 were
re-set to about 95% of it.

### To wave 25

All five plans, every builder, the whole ladder, with the rising output price
and a fifth plan: **strong**, which buys half again the steady line's economy
with the army first. Steady is the budget model's medium player and too timid
to see the late game; smart greed puts every spare coin in, which at a rising
price is reckless; strong is the economy the late waves are meant to reward.
(`reports/runs-25.txt`; one seed, so read the pattern rather than any one cell.)

| builder    | no economy | steady                | strong              | greedy | smart greed  |
| ---------- | ---------- | --------------------- | ------------------- | ------ | ------------ |
| Ironvow    | dies 15    | dies 13               | dies at the council | dies 4 | dies 15      |
| Pyre       | dies 18    | dies at the council   | dies 13             | dies 4 | dies 13      |
| Thornweald | dies 16    | **beats the council** | **beats it**        | dies 4 | **beats it** |
| Gloomtide  | dies 15    | dies at the council   | **beats it**        | dies 3 | **beats it** |

What it says:

- **No economy dies in the mid-teens; naive greed by wave 4.** Both by design.
- **Every plan with an economy gets somebody to the council**, and the council
  kills whoever arrives short of a full army (above).
- **A strong economy wins the late game — for two builders of four.** The five
  players that beat the council finished on 2,800 to 3,500 gold a wave of
  income; the two steady players it killed were on about 2,150.
- **Maximum greed is a coin flip**: two of four maxed the gem building by wave
  20 and walked the council, two died at 13 and 15.

**The open question now is the builders, not the waves.** Thornweald and
Gloomtide win the late game under every plan with an economy; Pyre and Ironvow
mostly do not. Pyre dies at wave 13 in two plans of three — Siege, Plate armour,
and Pyre's only Pierce is its rung 6 — and Ironvow's strong player lost the
council with 104 supply and 21,000 of army and tech, more than two of the
players who beat it. The sweep, which buys every army fresh for the wave in
front of it, puts the four builders within a few points of each other at most
waves; a run, which has to carry its army from wave to wave, does not. That gap
is where the next round of builder balance belongs.

### What it did to the arena, and what is left open

Every one of those nerfs also lands in the Final Showdown, so the round robin was
re-run afterwards (`reports/showdown-05.txt`, 20 duels a pair). The waves-only
changes above were scoped away from Mark III where they could be, and
Thornweald's Mark IIIs took a 0.93 weight (a price cut) — it is still the
weakest at 39%, with Pyre and Ironvow at 44% and 43%. Two findings are left open
because they are design calls, not tuning:

- **Gloomtide won 73% of its duels.** Settled since, by its REACH. Every one of
  its four ranged lines out-ranged everything else at its rung — the
  Maelstrom by more than a tile — and the price formula values a tile of range
  at about four percent of a unit's worth (`RANGE_VALUE_PER_TILE`), where in an
  arena it is the fight. Measured one change at a time, 20 duels a pair:

  | change                                                        | Gloomtide |
  | ------------------------------------------------------------- | --------: |
  | as it was                                                     |       73% |
  | reach cut to a little past each rung's next-longest           |       62% |
  | and its Mark III soak combos trimmed (Hailburst, Torrential…) |       60% |
  | reach equal to each rung's longest, Tidesong's haste trimmed  |       55% |

  Every builder now sits between 47% and 55% (`reports/showdown-06.txt`). The
  soak trims are kept but were never the story: damage bonuses on Mark III
  abilities moved it two points where range moved it sixteen.

- **Mark II is now the best arena buy** — the design-to-Mark-II core wins 90%
  of its duels (80% after the Gloomtide change, still ahead of the Mark III
  design at 73%) — because Ember's Mark III and the final upgrade in general got
  dearer last round. That runs against "every line goes to Mark III". Either
  the last step's price comes back down or Mark III gets something Mark II
  does not have.

## 4b. Playing it to break it

Everything above measures a sensible player. Real players are not sensible:
they find one thing that works and lean on it until it stops working. So each
builder was played that way on purpose, looking for the strategy that is
simply correct, with the harness switches that make each one playable:

```
npm run runs -- --spam          every line on its own, nothing else bought
npm run runs -- --wall          stand at the fortress instead of forward
npm run runs -- --aura <type>   and run that aura there
npm run runs -- --max-aura      every gem into the aura before any send
npm run runs -- --mirror        the table sends at you what you send at it
npm run runs -- --ui-sends      sends at the auto-send button's rate
npm run showdown -- --walk <n> --centre <x>    the arena's rules, overridden
```

What was found, and what was done about it, smallest change that worked:

| what a player tries                | what happened                                                                                                                             | change                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| the regeneration aura              | healed 15% of every unit's health a second, free, from the moment it was picked; at the wall a three-quarter army held a third more often | 0.75% a second, 2.5% fully upgraded                             |
| sending at a table that sends back | sends cost the same at wave 20 as at wave 1 while the bodies grew with the wave; mirrored, every economy plan died by wave 11 bar one     | sends priced by wave; since replaced by fixed-size bodies (§4c) |
| a Bloater send late                | its cargo burst for a flat 110 whatever the wave                                                                                          | cargo is 2.9× its attack, so it grows with the wave             |
| one unit and nothing else          | no line carries a game; the best is six Slagmaws, which hold to wave 14                                                                   | none — see below                                                |
| standing at the wall               | per wave, far stronger than forward; over a run, the fortress takes chip damage every wave and it adds up                                 | none — a real trade                                             |
| maxing the fortress aura           | worth about a fifth more army at the wall, for the gems of one or two waves                                                               | none — bought first it is a trap, bought late it is a gem sink  |
| nothing but rung 6 in the showdown | won 176 of 176 fights against every other shape its own builder could field                                                               | the arena is walked at 2.5× lane speed                          |

**Slagmaw** is the closest to a one-unit strategy. Six of them at Mark II hold
wave 14 on 69% of its gold, where six of any other builder's rung-4 tanks lose.
It is not the reflection being too high: with none at all they lose like
everyone else, and cut from 25% to 10% they still win. Waves 13 and 14 hit with
Blast and Impact, Slagmaw is Plate, and any reflection tips a close fight. The
same six die at the first boss. A matchup, then, and Pyre is already the
weakest builder late, so it stays.

**The table that sends back** is the setting the harness had been hiding: its
rival never sent, and a real table of economy players sends as much as it
receives. Played that way — at the wall, sends at the auto-send button's rate,
every send also landing in your own next wave — with sends at a flat price,
seven of eight runs died between waves 6 and 11. Priced for the wave they land
in, six of eight reach the council and three beat it
(`reports/runs-25-table.txt`):

| builder    | steady, flat price  | steady, priced by wave | strong, flat price | strong, priced by wave |
| ---------- | ------------------- | ---------------------- | ------------------ | ---------------------- |
| Ironvow    | dies 11             | dies at the council    | dies 8             | **beats it**           |
| Pyre       | dies 9              | dies at the council    | dies 8             | dies 13                |
| Thornweald | dies at the council | dies at the council    | dies 6             | dies 6                 |
| Gloomtide  | dies 11             | **beats it**           | dies 6             | **beats it**           |

**The fortress aura** maxed — +50% and 8.5 tiles, 1,868 gems — at 60% of a
wave's gold, standing at the wall, held wave 20 58% of the time where the same
army forward held none. That looked like the broken thing until it was played:
every run that put its gems into the aura before any send died between waves 13
and 16 with next to no income, because the gems it spent were the gems that
would have compounded. Bought late, out of a strong economy, it is exactly the
late-game reward a strong economy is meant to buy.

### The showdown was a range contest, and walking fixed it

Pure rung 6 won **every one** of 176 fights against the other shapes its own
builder could field — the designed spread, the Mark II core, a wall of tanks,
rungs 5 and 6 — nearly always with nine bodies of ten still standing. Traced
fight by fight, the reason was not the price ladder. Units walk the arena at
their lane speed, 0.2 to 0.65 tiles a second, so a tile of reach is three to
five seconds of shooting at something that cannot shoot back, and rung 6 has a
tile on everything. Its opponents took the centre, and died holding it.

`waves.showdown.walkSpeed` multiplies every body's speed in the arena, and only
there. A round robin of six shapes, each builder against itself, both seatings:

| walk speed | pure 6 | pure 5 | swarm (bottom heavy) | Mark II core | rungs 3 and 4 | even sixths |
| ---------- | -----: | -----: | -------------------: | -----------: | ------------: | ----------: |
| 1× (was)   |   100% |    62% |                  15% |          52% |           52% |         18% |
| 2×         |    70% |    35% |                  52% |          55% |           68% |         20% |
| **2.5×**   |    45% |    32% |                  65% |          62% |           65% |         30% |
| 3×         |    18% |    35% |                  75% |          60% |           78% |         35% |

At 2.5 the best three shapes are three different armies within three points of
each other, and none of them is the top rung. Faster than that, the side that
walks the most bodies into the centre wins before anything can shoot it. The
king-of-the-hill prize is what answers reach, and it stays at 50%: at half the
prize and 2× walking, pure rung 6 was back to 88%.

Across builders the walk moved little (`reports/showdown-07.txt`): 44% to 55%
of duels, where 1× had 47% to 55%. It did cost Ironvow three points, and
Ironvow was already the builder a new player would give up on — last or
second-last in best margin at nominal gold on fifteen of the sixteen waves from
10 to 25. Its Mark IIIs, which both the late waves and the arena are fought
with, took the lever Thornweald's took before them: a 0.95 value weight, five
percent more health and damage for the same price. Marks I and II are
untouched; the early waves were already even.

|        | Ironvow duels | all four builders | Ironvow clears at nominal, waves 16–25 |
| ------ | ------------: | ----------------- | -------------------------------------- |
| before |         44.2% | 44% – 55%         | 31, 27, 34, 30, 28, 17 of 40           |
| after  |         47.5% | 47.5% – 53%       | 32, 29, 35, 32, 29, 20 of 40           |

(`reports/showdown-08.txt`; the sweep at waves 16, 18, 20, 22, 24 and 25.)

## 4c. The send ladder

Fifteen sends, 10 to 500 gems, five to a page (`data/sends.json`). Three pay the
economy's best rate; the rest pay less and bring a body or an ability instead.
Every send has a cooldown the simulation enforces, and the dear ones open as
the game reaches them.

| send      | gems | cooldown | income | gold a wave per 10 gems | body (health) | what it brings                             | opens |
| --------- | ---: | -------: | -----: | ----------------------: | ------------: | ------------------------------------------ | ----: |
| Swarmling |   10 |       1s |     +1 |                **1.00** |            20 | economy                                    |     1 |
| Grub      |   20 |       2s |     +2 |                **1.00** |            45 | economy                                    |     1 |
| Mite      |   30 |       2s |     +2 |                    0.67 |           150 | Ambush: arrives sprinting                  |     1 |
| Mote      |   40 |       3s |     +3 |                    0.75 |           220 | Flicker: 30% of blows miss                 |     2 |
| Stalker   |   50 |       3s |     +3 |                    0.60 |           330 | Hamstring: slows what it bites             |     2 |
| Husk      |   60 |       5s |     +6 |                **1.00** |           150 | economy                                    |     1 |
| Spitter   |   70 |       4s |     +4 |                    0.57 |           420 | Corrode: its target takes more             |     3 |
| Warden    |   80 |       4s |     +5 |                    0.63 |           560 | Bulwark aura: pack takes 20% less          |     3 |
| Mender    |  100 |       5s |     +6 |                    0.60 |           600 | Rejuvenation aura: pack heals 1%/s         |     4 |
| Carapace  |  120 |       5s |     +7 |                    0.58 |          1000 | Siegework, on top of its shell             |     4 |
| Revenant  |  150 |       6s |     +8 |                    0.53 |          1200 | haste, sight, immune to abilities          |     5 |
| Bloater   |  200 |       7s |    +10 |                    0.50 |          1700 | Volatile Cargo: bursts on death            |     6 |
| Herald    |  300 |       8s |    +14 |                    0.47 |          2400 | War Cry aura: pack moves and swings faster |     8 |
| Bastion   |  400 |       9s |    +18 |                    0.45 |          3600 | Iron Will aura: pack cannot be held        |     9 |
| Behemoth  |  500 |      10s |    +22 |                    0.44 |          5000 | Trample                                    |    10 |

### The price is the price, so the body is fixed

Send prices had been climbing with the monster curve (§4b), because the body a
send delivered did. A fifteen-send ladder from 10 to 500 cannot work that way:
at wave 20 the 500-gem send would cost twelve thousand. So the price is the
number on the button, and what stops a gem buying twenty-four times the
pressure at wave 20 that it bought at wave 1 moved into the body instead: **a
sent body is the same size at every wave.** A Behemoth is five thousand health
at wave 10 and at wave 22.

That holds the pressure a player can apply roughly level through the game,
because a steady player's gems a wave grow about as fast as the waves do —
160 gems at wave 6 against 4,700 health of wave, 900 against 24,000 at wave 12,
2,400 against 170,000 at wave 23. What keeps a dear send worth its gems late is
its aura: an aura is a percentage, and it buffs the wave-23 pack around it.

**Auras never stack.** Each of the four is its own stat — damage taken,
regeneration, speed, control immunity — so no two ever add to the same number,
and each holds a single stack on a body whoever it comes from. A monster
standing inside two Bulwarks has one Bulwark (`src/sim/abilities.test.ts`).

### The cooldowns cap the economy, gently

The three economy sends together take at most about thirty-two gems a second.
Past that, a strong economy's gems go on the attack sends and their worse rate.
Whole runs with the new ladder (the rival never sends back) land within about
ten percent of the incomes they had before — strong players on 2,900 to 3,500
gold a wave at wave 25 rather than 3,050 to 3,650 — and the same builders reach
and beat the council. The cap only bites at the very top, which is where a
maxed economy was meant to stop compounding for free.

### Playing it to break it, again

**Every send, one player's full wave of gems into one kind**, against armies
that held the wave on 110% of its gold, measured before the two changes
below. Share of those armies still holding:

| wave | gems | economy sends | attack sends | strongest            |
| ---: | ---: | ------------: | -----------: | -------------------- |
|    6 |  160 |       80–100% |       60–95% | Warden (60%)         |
|   12 |  900 |        40–60% |       25–45% | Warden, Herald (25%) |
|   18 | 1800 |        50–80% |       40–70% | Bloater (40%)        |
|   23 | 2400 |        85–95% |       50–95% | Mender (50%)         |

The economy sends are among the weakest attacks at every wave, which is the
point of them; the attack sends sit in one band with the auras at the top of it. Two
things did not, and were changed:

1. **The economy bodies were bigger than the early waves' own** — a sent Husk
   was 240 health when wave 3's were 164 — and at a table that sends back
   (every send you make also lands in your own next wave) three of four strong
   economies drowned on the wave-5 boss. They are two health a gem now:
   Swarmling 20, Grub 45, Husk 150.
2. **The Behemoth rush.** Save the gems, drop the biggest thing early: one
   Behemoth beat 85 of the 96 armies that held waves 6 to 9 comfortably
   without it, and 23 of 24 at wave 10. A fixed-size body is enormous early,
   so every attack send now **opens** at about the wave where one wave's gems
   buy it (`fromWave`; the button says "opens wave N"), and the Behemoth hits
   for 110 rather than 200 and lost its Thick Hide. At wave 12 one Behemoth
   now leaves 58% of those armies standing, level with the rest of the
   ladder.

Left alone: the Warden is the best attack early and the Mender the best late —
both auras, both inside the band, and both answerable by killing the one body
carrying it.

**At a table that sends back**, played whole (`--mirror`: every send also lands
in your own next wave), across three seeds to wave 12: eleven of twelve steady
economies and eight of twelve strong ones were still standing. Gloomtide's
strong economy dies on the wave-5 boss every time, because the scripted player
buys a gem upgrade before the boss that its own returning sends then make it
pay for — the harness playing the plan too literally rather than a send out of
line.

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

**Phase 3 — waves.** _All twenty-five tuned._ Monster strength, composition
and the difficulty curve, measured with `npm run waves` against the army-gold
ladder and with `npm run runs` for how far the economy can be pushed. What is
left is not a wave question: a run exposes a late-game gap between builders that
the per-wave sweep does not (§4a, "To wave 25").

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
