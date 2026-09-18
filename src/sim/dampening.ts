/**
 * Dampening, and the one place a body's HP goes up. DESIGN.md §3.3, replaced.
 *
 * THE PROBLEM IT EXISTS FOR
 *
 * The Final Showdown is the last thing that happens in a match, so it has to
 * end. Anything that restores or prolongs - healing, health regeneration, a
 * summon arriving at full strength, a stun that holds someone in place - is a
 * way for two armies to keep each other alive indefinitely, and a free-for-all
 * that cannot resolve is worse than one decided badly. So every one of those
 * is scaled down the longer the fight runs.
 *
 * THE CURVE
 *
 * Full strength for `graceSeconds`, then `perSecond` of it removed per second,
 * ADDITIVELY - not compounding, which would approach zero without reaching it.
 * At the authored 1% and a 30-second grace: 90 seconds in, healing is worth
 * 40% of itself; at 130 seconds it is worth nothing at all, and from there the
 * fight can only go one way. The same shape as §8's enrage clock, pointed the
 * other way.
 *
 * WHAT IT APPLIES TO, AND WHAT EXISTS YET
 *
 * Three separate multipliers, because they are three separate effects that
 * happen to share a curve today:
 *
 *   - `healingMultiplier`   - every point of HP restored to a living body.
 *   - `summonHealthMultiplier` - the HP a summoned defender spawns with.
 *   - `crowdControlMultiplier` - how long a stun, root or slow lasts.
 *
 * Two of the three are load-bearing now. Abilities brought healing that is not
 * the fortress's - Heartwood mends its own body, Underweb mends the line round
 * it, Absolution closes wounds, Grave Tithe drinks - and they brought crowd
 * control, so both multipliers are applied by the arena's environment every
 * tick (abilityRuntime.ts, `buildArenaAbilityEnv`). `summonHealthMultiplier`
 * is still waiting: nothing summons, and `summon` is vocabulary rather than a
 * rule (abilities.ts). Three named functions rather than one number used three
 * times, so that the day they need different curves this file is the only one
 * that changes.
 *
 * `applyHealing` and `healBy` are the other half of that: every point of HP a
 * body regains anywhere in the simulation is added by one of these two, so
 * there is exactly one place for a multiplier to bite. A healing effect added
 * without going through them is a healing effect dampening does not reach, and
 * that is the failure mode this is shaped to make obvious. `strike.ts` is the
 * mirror image - the one place HP goes down.
 */

import type { DampeningConfig } from '../data/schema.ts';
import { SECONDS_PER_TICK, TICKS_PER_SECOND } from './constants.ts';

/**
 * What is left of an effect after `ticks` of fighting: 1 during the grace
 * period, falling to 0 and never below it.
 *
 * Ticks rather than seconds because the simulation's only clock is the tick
 * (§15.1): a wall-clock second is a different length on every device, and two
 * clients disagreeing about how dampened a heal was is a desync.
 */
export function dampeningRemaining(config: DampeningConfig, ticks: number): number {
  const grace = config.graceSeconds * TICKS_PER_SECOND;
  if (ticks <= grace) return 1;
  const seconds = (ticks - grace) / TICKS_PER_SECOND;
  return Math.max(0, 1 - config.perSecond * seconds);
}

/** What one point of healing or health regeneration is worth (§3.3, replaced). */
export function healingMultiplier(config: DampeningConfig, ticks: number): number {
  return dampeningRemaining(config, ticks);
}

/**
 * What a summoned defender's starting HP is worth (§3.3, replaced).
 *
 * Nothing summons yet. When something does, its spawn must multiply its HP by
 * this - otherwise a summoner is an army that renews itself for free, which is
 * the exact stalemate dampening is here to prevent.
 */
export function summonHealthMultiplier(config: DampeningConfig, ticks: number): number {
  return dampeningRemaining(config, ticks);
}

/**
 * What a crowd-control duration is worth (§3.3, replaced).
 *
 * Multiplied at the moment the effect is applied and never afterwards, so an
 * effect already running is not retroactively shortened by the clock. This is
 * on top of §18's own diminishing returns, which are about one body being held
 * repeatedly; this is about the fight as a whole having to end.
 */
export function crowdControlMultiplier(config: DampeningConfig, ticks: number): number {
  return dampeningRemaining(config, ticks);
}

/**
 * One tick of healing at `perSecond` HP per second, returning the new HP.
 *
 * The rules that live here rather than at each call site, because they are the
 * same everywhere and getting one of them wrong is invisible:
 *
 *   - A body at or below zero is dead and is not healed back out of it. The
 *     reaping happens at the end of a tick, so without this a lane could be
 *     healed out of its own elimination.
 *   - Healing never overshoots the maximum.
 *   - `multiplier` is dampening's one point of contact (§3.3, replaced). Pass 1 outside
 *     the showdown, where nothing is being dampened.
 */
export function applyHealing(hp: number, maxHp: number, perSecond: number, multiplier = 1): number {
  return healBy(hp, maxHp, perSecond * SECONDS_PER_TICK, multiplier);
}

/**
 * The same three rules for healing that arrives as an AMOUNT rather than a
 * rate: a heal, or lifesteal off a blow that has just landed.
 *
 * Two entry points rather than one because a caller with an amount and only a
 * per-second door to go through has to multiply by the tick rate to cancel it
 * out again, and that expression is exactly the sort of thing somebody later
 * simplifies into a bug.
 */
export function healBy(hp: number, maxHp: number, amount: number, multiplier = 1): number {
  if (hp <= 0 || hp >= maxHp) return hp;
  const healed = amount * multiplier;
  if (healed <= 0) return hp;
  return Math.min(maxHp, hp + healed);
}
