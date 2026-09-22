/**
 * What a unit costs and how strong that makes it. docs/BALANCE.md.
 *
 * Two ladders, and everything in the roster hangs off them.
 *
 * RUNG is which of a builder's six lines a unit is, and it is the POWER ladder.
 * Going up a rung buys a unit that is dearer in gold, dearer in supply, a
 * little better per gold, and a lot better per supply. That last one is the
 * point of the ladder: supply is the budget that actually binds, so the reason
 * to buy the expensive thing is that it does more with the supply you have,
 * not that it is efficient with gold.
 *
 * MARK is how far up its own chain a unit is, and it is the TALLNESS ladder.
 * A mark costs gold and little or no supply, so upgrading is how a
 * supply-capped player keeps spending. It is priced slightly in the player's
 * favour per gold as well, so going tall is a real choice rather than the thing
 * you do once there is nothing else to buy.
 *
 * THE TWO GROWTH RATES ARE THE WHOLE DESIGN
 *
 *   value per GOLD   x{@link GOLD_EFFICIENCY_PER_RUNG} per rung - nearly flat,
 *                    so a cheap unit is never a trap and a dear one is never
 *                    mandatory.
 *   value per SUPPLY x{@link SUPPLY_EFFICIENCY_PER_RUNG} per rung - steep, so
 *                    by rung 6 a body is five times the army a rung 1 body is
 *                    for the same supply.
 *
 * Gold cost falls out of those two rather than being chosen: if value per
 * supply climbs faster than value per gold, price has to climb by the ratio.
 * That is `markOneCost` below, and it is why the numbers land inside the bands
 * the design called for without being typed in one at a time.
 *
 * WHAT `value` MEANS
 *
 * `P = sqrt(offence x defence)`. The geometric mean, because a unit that is all
 * hit points and no damage kills nothing and a unit that is all damage and no
 * hit points is dead before it fires twice - and only a product says so. It
 * also has the property the pricing needs: hold the offence-to-defence ratio
 * and P is linear in a common scale factor, so "twice the value" is "twice the
 * damage and twice the hit points", which is what makes two armies of equal
 * gold have equal totals of both.
 *
 * WHAT IT DELIBERATELY DOES NOT MEASURE
 *
 * Abilities. A taunt, a shield, a slow and an execute are not stats and a
 * scalar that pretended to price them would be confidently wrong. Every unit
 * therefore carries an `abilityWeight` of 1 until the showdown harness has
 * measured what its ability is actually worth, at which point the weight is
 * where that measurement goes. Armour and damage type are left out for the same
 * reason - their worth is the matrix against whatever they are fighting, which
 * is a wave-balance question, not a price.
 */

import type { GameData, UnitDef } from '../data/schema.ts';

/** Supply a Mark I body of each rung costs. Index 0 is rung 1. */
export const SUPPLY_BY_RUNG = [1, 1, 2, 2, 3, 3] as const;

/**
 * How much better value per supply each rung is than the one below.
 *
 * 1.38 compounds to almost exactly 5x over the six rungs, which is what
 * "dramatically more efficient in terms of supply" has to mean for the top of
 * the ladder to be worth the price of admission.
 */
export const SUPPLY_EFFICIENCY_PER_RUNG = 1.38;

/**
 * And how much better value per gold. Nearly flat, deliberately.
 *
 * 1.1 compounds to 1.61 across the ladder: a rung 6 body is 61% better per gold
 * than a rung 1 body, which is enough that going tall is rewarded and not so
 * much that going wide is a mistake.
 */
export const GOLD_EFFICIENCY_PER_RUNG = 1.1;

/** Gold a rung 1 Mark I body costs. The whole ladder is normalised to this. */
export const RUNG_ONE_COST = 45;

/**
 * Cumulative gold and value at each mark, as multiples of the Mark I body.
 *
 * Cost: each upgrade is 1.5x the one before it, so a Mark II has cost 2.5x the
 * base body in total and a Mark III 4.75x.
 *
 * Value: 2.85x and 5.9x. Against the cost that is 14% ahead at Mark II and 5%
 * at Mark III. An upgraded body is meant to be what a player brings to the
 * endgame - the Mark I is the thing you could afford in wave three - so a mark
 * has to be clearly better gold as well as enormously better supply; it was 6%
 * and 9.5%, which was not enough to be a reason for anything.
 *
 * MARK III USED TO BE 4.75, a 24% discount, and that was too much. The top of a
 * chain is where the abilities are, so it is already the best thing a line
 * offers before its price is discounted as well - Ember Mark III came out of
 * the sweep at half again the damage per gold of the identically statted Pledge
 * Mark III, and a tank besides. Supply is where the reward for going tall
 * belongs and it is still enormous: a Mark III is 5.9 times the value for twice
 * the supply.
 *
 * This only works because every line goes to Mark III now. While ten of the
 * twenty-four stopped at Mark II, rewarding marks this heavily would have
 * handed a large free advantage to the two builders whose expensive lines
 * happened to have one.
 */
export const MARK_COST = [1, 2.5, 5.6] as const;
export const MARK_VALUE = [1, 2.85, 5.9] as const;

/**
 * Supply an upgrade costs, as a multiple of the supply its body already costs.
 *
 * A Mark II is free - it is simply how a supply-capped army keeps improving. A
 * Mark III costs the body's supply over again, which is 1 at rungs 1-2, 2 at
 * rungs 3-4 and 3 at rungs 5-6: the "1 to 3 supply at the higher levels of
 * upgrade" the design asked for, arrived at without a second ladder.
 *
 * PROPORTIONAL, NOT FLAT, and that is load-bearing. A flat charge - say 1
 * supply at low rungs and 2 at high - inverts the whole rung ladder at the top
 * mark: a fully upgraded rung 4 body would end up costing five supply against a
 * rung 3 body's three, which makes the dearer unit WORSE per supply and
 * destroys the only reason to climb. Charging in proportion keeps every rung's
 * value per supply exactly where `SUPPLY_EFFICIENCY_PER_RUNG` put it, at every
 * mark.
 */
export const MARK_SUPPLY_MULTIPLE = [0, 0, 1] as const;

/**
 * How much of a unit's offence is its reach.
 *
 * A unit that kills from four tiles away spends the fight not being hit, which
 * is worth paying for and has to come out of its raw numbers or long range
 * would simply be free. 0.08 per tile puts the longest gun in the game about
 * 40% ahead of a melee body of the same price, before anything it does.
 */
export const RANGE_VALUE_PER_TILE = 0.08;

function num(value: number | null | undefined, fallback = 0): number {
  return value ?? fallback;
}

/** Gold a Mark I body of this rung costs. */
export function markOneCost(rung: number): number {
  const index = Math.min(Math.max(rung, 1), SUPPLY_BY_RUNG.length) - 1;
  const supply = SUPPLY_BY_RUNG[index]!;
  // Value per supply climbs faster than value per gold, so price climbs by the
  // ratio between them - and by the supply the body costs, since the ladder is
  // stated per supply.
  const ratio = SUPPLY_EFFICIENCY_PER_RUNG / GOLD_EFFICIENCY_PER_RUNG;
  const relative = supply * Math.pow(ratio, index);
  return (RUNG_ONE_COST * relative) / SUPPLY_BY_RUNG[0]!;
}

/** Gold to BUY this mark, having already paid for the one below it. */
export function markStepCost(rung: number, mark: number): number {
  const base = markOneCost(rung);
  const cumulative = MARK_COST[Math.min(mark, MARK_COST.length) - 1] ?? 1;
  const below = mark > 1 ? (MARK_COST[mark - 2] ?? 0) : 0;
  return base * (cumulative - below);
}

/** Supply to buy this mark, having already paid for the one below it. */
export function markStepSupply(rung: number, mark: number): number {
  const body = SUPPLY_BY_RUNG[Math.min(Math.max(rung, 1), SUPPLY_BY_RUNG.length) - 1]!;
  if (mark <= 1) return body;
  return body * (MARK_SUPPLY_MULTIPLE[Math.min(mark, MARK_SUPPLY_MULTIPLE.length) - 1] ?? 0);
}

/** Cumulative gold and supply paid for a body standing at this rung and mark. */
export function totalCost(rung: number, mark: number): { gold: number; supply: number } {
  let gold = 0;
  let supply = 0;
  for (let m = 1; m <= mark; m++) {
    gold += markStepCost(rung, m);
    supply += markStepSupply(rung, m);
  }
  return { gold, supply };
}

/**
 * The value a body at this rung and mark is supposed to have, in the arbitrary
 * units `unitValue` measures. Scaled by `scale` to put the roster where the
 * monsters expect to find it.
 */
export function targetValue(rung: number, mark: number, scale = 1): number {
  const index = Math.min(Math.max(rung, 1), SUPPLY_BY_RUNG.length) - 1;
  const supply = SUPPLY_BY_RUNG[index]!;
  const perSupply = Math.pow(SUPPLY_EFFICIENCY_PER_RUNG, index);
  const markMultiple = MARK_VALUE[Math.min(mark, MARK_VALUE.length) - 1] ?? 1;
  return scale * supply * perSupply * markMultiple;
}

/** Damage a unit puts out per second, with reach priced in. */
export function unitOffence(unit: Pick<UnitDef, 'damage' | 'attackSpeed' | 'range'>): number {
  const dps = num(unit.damage) * num(unit.attackSpeed);
  return dps * (1 + num(unit.range) * RANGE_VALUE_PER_TILE);
}

/** What it takes to remove it. Armour is left out: that is the matrix's job. */
export function unitDefence(unit: Pick<UnitDef, 'hp'>): number {
  return num(unit.hp);
}

/**
 * `sqrt(offence x defence)`, the one number the price ladder is set against.
 *
 * `abilityWeight` is the escape hatch, and the honest one: a unit whose ability
 * is worth 20% of its body carries 1.2 here and is given 20% fewer raw stats
 * for the same price. Everything ships at 1 until the showdown harness has
 * measured a reason for it not to be.
 */
export function unitValue(
  unit: Pick<UnitDef, 'damage' | 'attackSpeed' | 'range' | 'hp'>,
  abilityWeight = 1,
): number {
  return Math.sqrt(unitOffence(unit) * unitDefence(unit)) * abilityWeight;
}

export interface PricedUnit {
  id: string;
  builderId: string;
  name: string;
  rung: number;
  mark: number;
  goldCost: number;
  supplyCost: number;
  /** What the body must be worth, and the factor its stats move by to get there. */
  targetValue: number;
  currentValue: number;
  scaleFactor: number;
  damage: number;
  hp: number;
}

/**
 * Price and restat the whole roster.
 *
 * Stats move by a single factor applied to BOTH damage and hit points, which
 * holds the unit's offence-to-defence ratio - and that ratio is its role. A
 * tank stays a tank and a gun stays a gun; only how much of either it is for
 * the price changes. Attack speed, range, move speed, armour, damage type and
 * abilities are never touched here: those are what make the unit itself, and a
 * price ladder has no business rewriting them.
 *
 * `scale` sets where the whole roster sits in absolute terms. It cancels out of
 * every comparison between units, so the showdown cannot see it at all - only
 * the waves can, which is why it is chosen to leave the roster near the power
 * level the monsters were authored against.
 */
export function priceRoster(
  data: GameData,
  options: {
    scale?: number;
    anchor?: ScaleAnchor;
    abilityWeights?: Record<string, number>;
  } = {},
): PricedUnit[] {
  const weights = { ...weightsFromData(data), ...(options.abilityWeights ?? {}) };
  const scale = options.scale ?? rosterScale(data, options.anchor ?? 'rung1', weights);

  return data.units.units.map((unit) => {
    const current = unitValue(unit, weights[unit.id] ?? 1);
    const target = targetValue(unit.rung, unit.mark, scale);
    const factor = current > 0 ? target / current : 1;

    return {
      id: unit.id,
      builderId: unit.builderId,
      name: unit.name,
      rung: unit.rung,
      mark: unit.mark,
      goldCost: Math.round(markStepCost(unit.rung, unit.mark)),
      supplyCost: markStepSupply(unit.rung, unit.mark),
      targetValue: target,
      currentValue: current,
      scaleFactor: factor,
      damage: num(unit.damage) * factor,
      hp: num(unit.hp) * factor,
    };
  });
}

/**
 * Where to pin the roster's absolute power, given that the ladder reshapes
 * everything relative to it.
 *
 * WHY THIS IS A CHOICE AT ALL. The roster as authored is not a power ladder: a
 * Judgement costs 2.4x a Pledge and is worth about the same, because the six
 * lines were six ROLES at one power level rather than six steps up one. Putting
 * them on a ladder where the top is nine times the price of the bottom
 * therefore cannot leave everything where it is - something has to move a long
 * way, and `scale` decides what.
 *
 *   `rung1` pins the bottom. Rung 1 keeps the numbers the early waves were
 *           authored against, and everything above it climbs. Waves 1-5 carry
 *           on working and waves 15-25 become far too easy, which is the safe
 *           direction: monsters are one knob and can be turned up afterwards.
 *   `median` pins the middle and moves both ends. It keeps the roster's total
 *           power closest to where it was and is the worst of the three to
 *           play, because it guts the cheap units the opening depends on.
 */
export type ScaleAnchor = 'rung1' | 'median';

/**
 * The weights the roster carries in `data/`, so a reprice reads them without
 * being told. An override passed in wins, which is how a candidate weight is
 * tried before it is written down.
 */
export function weightsFromData(data: GameData): Record<string, number> {
  const out: Record<string, number> = {};
  for (const unit of data.units.units) {
    const weight = unit.valueWeight;
    if (weight !== null && weight !== undefined && weight !== 1) out[unit.id] = weight;
  }
  return out;
}

export function rosterScale(
  data: GameData,
  anchor: ScaleAnchor = 'rung1',
  abilityWeights: Record<string, number> = {},
): number {
  const ratioOf = (unit: UnitDef): number => {
    const current = unitValue(unit, weights[unit.id] ?? 1);
    const target = targetValue(unit.rung, unit.mark, 1);
    return target > 0 ? current / target : 0;
  };

  const pool =
    anchor === 'rung1'
      ? data.units.units.filter((u) => u.rung === 1 && u.mark === 1)
      : data.units.units;
  const weights = { ...weightsFromData(data), ...abilityWeights };

  const ratios = pool
    .map(ratioOf)
    .filter((r) => r > 0)
    .sort((a, b) => a - b);
  if (ratios.length === 0) return 1;

  // The median rather than the mean, so one unit that was mispriced by a factor
  // of three moves itself rather than dragging the other fifty-seven with it.
  const mid = ratios.length >> 1;
  return ratios.length % 2 === 1 ? ratios[mid]! : (ratios[mid - 1]! + ratios[mid]!) / 2;
}

/**
 * How far the roster's power moves overall, which is how far the monsters have
 * to move to keep the waves as hard as they were.
 *
 * Measured at the MIDDLE of the ladder - rung 3, Mark I - because that is where
 * a player fighting waves actually sits. It is reported rather than applied:
 * monster strength is the wave-balance knob and is turned separately.
 */
export function monsterRescale(data: GameData, scale: number): number {
  const middle = data.units.units.filter((u) => u.rung === 3 && u.mark === 1);
  if (middle.length === 0) return 1;

  let before = 0;
  let after = 0;
  for (const unit of middle) {
    before += unitValue(unit);
    after += targetValue(unit.rung, unit.mark, scale);
  }
  return before > 0 ? after / before : 1;
}
