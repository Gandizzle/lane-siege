/**
 * What a medium player can afford by the Final Showdown. docs/BALANCE.md.
 *
 * Every unit price in the game is set against one number: the gold a player who
 * plays the economy competently, and neither brilliantly nor badly, has spent
 * by the time the arena opens. Guessing that number and guessing unit prices
 * separately is how a roster ends up costing ten times what anybody can pay, so
 * it is computed here, from `data/`, and recomputed whenever a price changes.
 *
 * WHAT THIS IS AND IS NOT
 *
 * It is a closed-form model of one specific line of play, not a simulation.
 * Nothing here fights anything. It answers "if a player did exactly this, what
 * would they have?", and the assumptions it does that under are listed in
 * `ASSUMPTIONS` and repeated in docs/BALANCE.md, because every one of them is a
 * thing a real game can disagree with. The showdown harness is where real
 * fights happen; this is what tells the harness how big an army to hand out.
 *
 * THE LINE OF PLAY IT MODELS
 *
 *   - Gems are made by the resource building and spent, all of them, on the
 *     most efficient economic send. That is the "most economic send rate" the
 *     whole send ladder is priced against: the cheapest send is the floor, and
 *     everything dearer buys strength or an ability rather than a better rate.
 *   - Gold buys the resource building's own ladders first - one output level
 *     every wave, one rate level every five - because that is what compounds.
 *   - Everything left is the army, the tech and the supply cap.
 *
 * WHY IT COMPOUNDS
 *
 * Gold per wave is not a constant and cannot be set as one. A wave's monsters
 * pay a FIXED pool (`economy.waveBounty`), but passive income is permanent and
 * bought with gems whose rate is itself being upgraded every wave, so the
 * passive line grows faster than linearly and ends up the larger half of the
 * run's gold. Wave 1 pays 3 gold of passive income; wave 25 pays hundreds.
 */

import type { GameData, UpgradeLevel } from '../data/schema.ts';

/** Every number this model assumes rather than reads. One place, on purpose. */
export interface Assumptions {
  /** Waves before the Final Showdown. `waves.showdown.afterWave`. */
  waves: number;
  /**
   * Seconds of wall clock per wave: the build phase plus a fight.
   *
   * THE LOAD-BEARING GUESS. There is no global wave clock - combat runs until
   * every living lane is empty (waves.json `_clockNote`) - so a wave's real
   * length is an output of how well everybody built. Gems accrue per second,
   * so this number scales the entire gem economy and therefore the entire
   * passive-income half of the budget. 30 + 30 is the intended shape, and the
   * showdown harness reports the real figure once there is one.
   */
  secondsPerWave: number;
  /** Gem output levels bought per wave. One, from wave 1, until the ladder ends. */
  outputLevelsPerWave: number;
  /** Waves between gem rate levels, so the last lands on the last wave. */
  wavesPerRateLevel: number;
  /** Supply cap the medium player is modelled as reaching. */
  supplyCapTarget: number;
  /**
   * Tech levels bought in each track that is bought at all.
   *
   * Fractional on purpose: levels are discrete and paid for one at a time, so
   * 3.5 is not a state any single player is in. It is the average across a
   * population where some stopped at 3 and some went to 4, and the half-level
   * is charged at half the price of the fourth.
   */
  techLevels: number;
  /** Which tracks: two defensive ladders and one damage type. */
  techTracks: readonly string[];
}

export const ASSUMPTIONS: Assumptions = {
  waves: 25,
  secondsPerWave: 60,
  outputLevelsPerWave: 1,
  wavesPerRateLevel: 5,
  supplyCapTarget: 120,
  techLevels: 3.5,
  techTracks: ['def_hp', 'def_speed', 'dmg_impact'],
};

/** One wave of the modelled run. */
export interface WaveRow {
  wave: number;
  /** Gem output level active during this wave, and the rate multiplier with it. */
  outputLevel: number;
  rateLevel: number;
  gemsPerSecond: number;
  /** Gems produced this wave, and the sends they buy. */
  gems: number;
  sends: number;
  /** Permanent gold per wave owned by the end of this wave. */
  income: number;
  /** Gold in, split three ways. */
  bounty: number;
  passive: number;
  sendBounty: number;
  /** Gold out: the resource building's own ladders. */
  gemLadderSpend: number;
  /** Running total of everything in, minus everything out, so far. */
  cumulativeIncome: number;
  cumulativeGemLadder: number;
}

export interface Budget {
  assumptions: Assumptions;
  waves: WaveRow[];
  /** Gold in, over the whole run. */
  startingGold: number;
  bountyTotal: number;
  passiveTotal: number;
  sendBountyTotal: number;
  incomeTotal: number;
  /** Gold out, over the whole run, for everything that is not the army. */
  gemLadderTotal: number;
  supplyCapTotal: number;
  techTotal: Record<string, number>;
  techTotalSum: number;
  overheadTotal: number;
  /** What is left: the gold the army may cost. */
  armyGold: number;
  /** Supply the army may cost, once the gem ladder has taken its share. */
  supplyCap: number;
  gemLadderSupply: number;
  armySupply: number;
  /** Gems produced and sends bought across the run. */
  gemsTotal: number;
  sendsTotal: number;
}

function num(value: number | null | undefined, fallback = 0): number {
  return value ?? fallback;
}

/** Cumulative gold for `levels` rungs of a ladder, charging a part-level pro rata. */
export function ladderCost(levels: readonly UpgradeLevel[], count: number): number {
  const whole = Math.floor(count);
  let total = 0;
  for (let i = 0; i < Math.min(whole, levels.length); i++) total += num(levels[i]?.goldCost);
  const part = count - whole;
  if (part > 0 && whole < levels.length) total += num(levels[whole]?.goldCost) * part;
  return total;
}

/** Supply charged by `levels` rungs of a ladder. Whole levels only - supply is integral. */
export function ladderSupply(levels: readonly UpgradeLevel[], count: number): number {
  let total = 0;
  for (let i = 0; i < Math.min(Math.floor(count), levels.length); i++) {
    total += num(levels[i]?.supplyCost);
  }
  return total;
}

/**
 * The gem-to-gold exchange rate the send ladder defines.
 *
 * The cheapest send is the floor of the economy: whatever it charges per +1
 * gold a wave is the best rate in the game, and every dearer send is paying the
 * difference for a stronger body or an ability. Read rather than assumed, so
 * repricing a send moves the budget.
 */
export function gemsPerIncome(data: GameData): number {
  let best = Infinity;
  for (const send of data.sends.sends) {
    const income = num(send.incomeGranted);
    if (income <= 0) continue;
    best = Math.min(best, num(send.gemCost) / income);
  }
  return Number.isFinite(best) ? best : 0;
}

/**
 * How many gems the resource building makes per second at a given pair of levels.
 *
 * `output` sets gems per payout and `rate` divides the interval between
 * payouts, so the two multiply. The interval is rounded to a whole simulation
 * tick the way `gemPayoutTicks` rounds it, because a model that disagrees with
 * the simulation about the arithmetic is worse than no model.
 */
export function gemsPerSecond(data: GameData, outputLevel: number, rateLevel: number): number {
  const building = data.fortress.resourceBuilding;
  const output = building.output.upgrades;
  const rate = building.rate.upgrades;

  const perPayout =
    outputLevel > 0
      ? num(output[Math.min(outputLevel, output.length) - 1]?.value)
      : num(building.gemsPerPayout);
  const multiplier = rateLevel > 0 ? num(rate[Math.min(rateLevel, rate.length) - 1]?.value, 1) : 1;

  const baseTicks = Math.round(num(building.payoutSeconds) * 20);
  if (baseTicks <= 0 || multiplier <= 0) return 0;
  const ticks = Math.max(1, Math.round(baseTicks / multiplier));
  return perPayout / (ticks / 20);
}

/**
 * Run the model.
 *
 * The one piece of sequencing worth knowing: a wave's gems are produced, spent
 * on sends and EARNED IN THE SAME WAVE. A send bought in wave 5's build phase
 * pays out from wave 5, not wave 6. That is a wave of income more generous than
 * the simulation will be, and it is deliberate - the budget should be the
 * ceiling a good economy reaches, so that prices set against it are not set
 * against a number nobody can hit.
 */
export function computeBudget(data: GameData, assumptions: Assumptions = ASSUMPTIONS): Budget {
  const building = data.fortress.resourceBuilding;
  const outputLadder = building.output.upgrades;
  const rateLadder = building.rate.upgrades;
  const perIncome = gemsPerIncome(data);
  const wavePool = num(data.economy.waveBounty);
  const bountyPer10 = num(data.economy.sendBountyPerTenGems);

  const rows: WaveRow[] = [];
  let income = 0;
  let cumulativeIncome = num(data.economy.startingGold);
  let cumulativeGemLadder = 0;

  for (let wave = 1; wave <= assumptions.waves; wave++) {
    // Bought in the build phase of the wave before, so wave 1 runs on the base
    // building and wave 2 on the first level.
    const outputLevel = Math.min((wave - 1) * assumptions.outputLevelsPerWave, outputLadder.length);
    const rateLevel = Math.min(Math.floor(wave / assumptions.wavesPerRateLevel), rateLadder.length);

    const perSecond = gemsPerSecond(data, outputLevel, rateLevel);
    const gems = perSecond * assumptions.secondsPerWave;
    const sends = perIncome > 0 ? gems / perIncome : 0;
    income += sends;

    // A mirrored table: everybody sends what you send, so you are paid the
    // bounty on as many sends as you buy. It nets to nothing between equals and
    // only moves gold when the aggression is one-sided, which is the point of
    // it - but it is real income and the budget has to carry it.
    const sendBounty = (sends * perIncome * bountyPer10) / 10;

    // What this wave's own ladder levels cost.
    const outputBought = Math.min(wave * assumptions.outputLevelsPerWave, outputLadder.length);
    const rateBought = Math.min(
      Math.floor(wave / assumptions.wavesPerRateLevel),
      rateLadder.length,
    );
    const ladderSoFar = ladderCost(outputLadder, outputBought) + ladderCost(rateLadder, rateBought);
    const gemLadderSpend = ladderSoFar - cumulativeGemLadder;
    cumulativeGemLadder = ladderSoFar;

    cumulativeIncome += wavePool + income + sendBounty;

    rows.push({
      wave,
      outputLevel,
      rateLevel,
      gemsPerSecond: perSecond,
      gems,
      sends,
      income,
      bounty: wavePool,
      passive: income,
      sendBounty,
      gemLadderSpend,
      cumulativeIncome,
      cumulativeGemLadder,
    });
  }

  const sum = (pick: (r: WaveRow) => number): number => rows.reduce((a, r) => a + pick(r), 0);

  const supplyLadder = data.economy.supply.capUpgrades;
  const capLevels = supplyLadder.filter((u) => num(u.value) <= assumptions.supplyCapTarget).length;
  const supplyCapTotal = ladderCost(supplyLadder, capLevels);
  const supplyCap =
    capLevels > 0 ? num(supplyLadder[capLevels - 1]?.value) : num(data.economy.supply.capBase);

  const techTotal: Record<string, number> = {};
  for (const id of assumptions.techTracks) {
    const track = data.economy.tech.tracks.find((t) => t.id === id);
    techTotal[id] = track ? ladderCost(track.levels, assumptions.techLevels) : 0;
  }
  const techTotalSum = Object.values(techTotal).reduce((a, b) => a + b, 0);

  const startingGold = num(data.economy.startingGold);
  const bountyTotal = sum((r) => r.bounty);
  const passiveTotal = sum((r) => r.passive);
  const sendBountyTotal = sum((r) => r.sendBounty);
  const incomeTotal = startingGold + bountyTotal + passiveTotal + sendBountyTotal;
  const gemLadderTotal = cumulativeGemLadder;
  const overheadTotal = gemLadderTotal + supplyCapTotal + techTotalSum;

  const outputBought = Math.min(
    assumptions.waves * assumptions.outputLevelsPerWave,
    outputLadder.length,
  );
  const gemLadderSupply =
    ladderSupply(outputLadder, outputBought) +
    ladderSupply(rateLadder, Math.floor(assumptions.waves / assumptions.wavesPerRateLevel));

  return {
    assumptions,
    waves: rows,
    startingGold,
    bountyTotal,
    passiveTotal,
    sendBountyTotal,
    incomeTotal,
    gemLadderTotal,
    supplyCapTotal,
    techTotal,
    techTotalSum,
    overheadTotal,
    armyGold: incomeTotal - overheadTotal,
    supplyCap,
    gemLadderSupply,
    armySupply: supplyCap - gemLadderSupply,
    gemsTotal: sum((r) => r.gems),
    sendsTotal: sum((r) => r.sends),
  };
}
