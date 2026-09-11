/**
 * Tech and aura resolution. DESIGN.md §7.4, §10.1, §15.3.
 *
 * Two kinds of buff, deliberately handled differently:
 *
 *   TECH (§7.4) is tied to damage types, not unit types - "+10% Pierce damage"
 *   lifts every Pierce unit you own. It changes only when something is bought or
 *   upgraded, so the resolved multipliers are CACHED on each unit and recomputed
 *   on those events only. That is the §15.3 rule.
 *
 *   AURA (§10.1) buffs friendly units within a radius of the fortress. §15.3
 *   says recompute auras on add/remove/upgrade and on wave start, never per
 *   tick - which assumed stationary units. Units now advance (§5.2, amended), so
 *   aura membership genuinely changes mid-combat and caching it would be wrong.
 *   What §15.3 was protecting against is expensive work per tick; a squared
 *   distance compare per unit is not that, so membership is evaluated inline and
 *   only the strength lookup is cached.
 */

import type { GameData } from '../data/schema.ts';
import type { DefIndex } from './defs.ts';
import { stat } from './defs.ts';
import { distanceSquared } from './targeting.ts';
import type { DefensiveUnit, Lane, Vec2 } from './types.ts';

/** Total fractional bonus from a tech track at the level the lane has bought. */
function trackBonus(data: GameData, lane: Lane, trackId: string): number {
  const level = lane.economy.tech[trackId] ?? 0;
  if (level <= 0) return 0;

  const track = data.economy.tech.tracks.find((t) => t.id === trackId);
  if (!track) return 0;

  // `value` is the cumulative bonus at that level, not a per-level increment.
  const entry = track.levels.find((l) => l.level === level);
  return stat(entry?.value ?? null);
}

/**
 * Recompute the cached tech multipliers for every unit in a lane.
 *
 * Call after: placing a unit, upgrading one, buying tech, and on wave start.
 * Never per tick.
 */
export function recomputeUnitBuffs(data: GameData, defs: DefIndex, lane: Lane): void {
  const hpBonus = trackBonus(data, lane, 'def_hp');
  const speedBonus = trackBonus(data, lane, 'def_speed');

  for (const unit of lane.units) {
    const def = defs.units.get(unit.defId);
    if (!def) continue;

    const damageBonus = trackBonus(data, lane, `dmg_${def.damageType}`);

    unit.techDamage = 1 + damageBonus;
    unit.techAttackSpeed = 1 + speedBonus;

    // Raising max HP must not silently heal or harm: keep the damage taken so
    // far proportional.
    const newMax = stat(def.hp) * (1 + hpBonus);
    if (newMax !== unit.maxHp) {
      const fraction = unit.maxHp > 0 ? unit.hp / unit.maxHp : 1;
      unit.maxHp = newMax;
      unit.hp = Math.min(newMax, newMax * fraction);
    }
  }
}

export interface AuraEffect {
  damage: number;
  attackSpeed: number;
  /** Multiplier on damage taken. Below 1 means tougher. */
  damageTaken: number;
  /** HP restored per second. */
  regenPerSecond: number;
}

const NO_AURA: AuraEffect = { damage: 1, attackSpeed: 1, damageTaken: 1, regenPerSecond: 0 };

/**
 * The aura as it applies to one unit, given where it is standing right now.
 *
 * §10.1: only one aura is active at a time, and strength and radius upgrade
 * separately - early on the radius cannot cover the whole build zone, which is
 * the choice between a tight buffed core near the fortress and a spread-out line
 * that intercepts sooner but fights unbuffed.
 */
export function auraFor(lane: Lane, unit: DefensiveUnit, fortressPos: Vec2): AuraEffect {
  const aura = lane.fortress.activeAura;
  if (!aura) return NO_AURA;

  const radius = lane.fortress.auraRadius;
  if (radius <= 0) return NO_AURA;
  if (distanceSquared(unit.pos, fortressPos) > radius * radius) return NO_AURA;

  const strength = lane.fortress.auraStrength;
  switch (aura) {
    case 'damage':
      return { damage: 1 + strength, attackSpeed: 1, damageTaken: 1, regenPerSecond: 0 };
    case 'attackSpeed':
      return { damage: 1, attackSpeed: 1 + strength, damageTaken: 1, regenPerSecond: 0 };
    case 'armour':
      // Diminishing rather than linear, so stacking strength never reaches immunity.
      return { damage: 1, attackSpeed: 1, damageTaken: 1 / (1 + strength), regenPerSecond: 0 };
    case 'regeneration':
      return {
        damage: 1,
        attackSpeed: 1,
        damageTaken: 1,
        // Strength reads as a fraction of the unit's maximum per second.
        regenPerSecond: strength,
      };
    default:
      return NO_AURA;
  }
}

export { NO_AURA };
