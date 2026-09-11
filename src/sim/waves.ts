/**
 * Wave generation. DESIGN.md §9.2.
 *
 * "Wave composition is a pure function of (matchSeed, waveNumber)." That is the
 * whole contract, and it is what buys deterministic replays, trivial desync
 * detection, and the ability to run thousands of headless matches to check
 * balance curves. Nothing here reads match state - not the tick, not a lane,
 * not what happened in the previous wave.
 *
 * All lanes face identical waves (§9.2). Lane divergence comes only from sends.
 */

import type { ArmourType, DamageType, GameData, MonsterDef } from '../data/schema.ts';
import { waveRng } from './rng.ts';

/** One monster to spawn: its definition, and the wave it belongs to (§8). */
export interface SpawnSpec {
  defId: string;
  waveNumber: number;
}

/** Stats after wave scaling, resolved once at spawn rather than per tick. */
export interface ResolvedMonsterStats {
  hp: number;
  damage: number;
  attackSpeed: number;
  moveSpeed: number;
  range: number;
  bounty: number;
  radius: number;
}

function num(value: number | null, fallback = 0): number {
  return value ?? fallback;
}

/**
 * How far past the authored composition this wave sits. Authored waves scale by
 * 1; every wave beyond the last authored one compounds the §9.2 growth factors.
 */
function scalingExponent(data: GameData, waveNumber: number): number {
  let lastAuthored = 0;
  for (const wave of data.waves.composition) {
    if (wave.wave > lastAuthored) lastAuthored = wave.wave;
  }
  return waveNumber > lastAuthored ? waveNumber - lastAuthored : 0;
}

/**
 * Integer power. Math.pow is banned in the simulation - it is not bit-identical
 * across engines - and repeated multiplication of a small integer count is.
 */
function intPow(base: number, exponent: number): number {
  let result = 1;
  for (let i = 0; i < exponent; i++) result *= base;
  return result;
}

/**
 * §9.1: monster stats scale with wave number, and so does monster count. HP,
 * damage and bounty grow; move and attack speed deliberately do not - that is
 * enrage's job (§8), and stacking the two would make late waves unreadable.
 */
export function resolveMonsterStats(
  data: GameData,
  def: MonsterDef,
  waveNumber: number,
): ResolvedMonsterStats {
  const steps = scalingExponent(data, waveNumber);
  const { scaling } = data.waves;

  return {
    hp: num(def.hp) * intPow(num(scaling.hp, 1), steps),
    damage: num(def.damage) * intPow(num(scaling.damage, 1), steps),
    attackSpeed: num(def.attackSpeed),
    moveSpeed: num(def.moveSpeed),
    range: num(def.range),
    bounty: num(def.bounty) * intPow(num(scaling.bounty, 1), steps),
    radius: num(def.bodyRadius, 0.3),
  };
}

export function isBossWave(data: GameData, waveNumber: number): boolean {
  const every = data.waves.bossEveryNWaves;
  return every > 0 && waveNumber % every === 0;
}

/**
 * The full monster list for a wave, in spawn order.
 *
 * Uses `waveRng(seed, waveNumber)`, which DERIVES a generator rather than
 * advancing one - so wave 7 is identical whatever happened in waves 1 to 6.
 */
export function generateWave(data: GameData, seed: number, waveNumber: number): SpawnSpec[] {
  const rng = waveRng(seed, waveNumber);
  const specs: SpawnSpec[] = [];

  const authored = data.waves.composition.find((w) => w.wave === waveNumber);
  const steps = scalingExponent(data, waveNumber);

  let template = authored;
  if (!template && data.waves.composition.length > 0) {
    // Past the authored range: reuse the last authored shape, scaled up.
    template = data.waves.composition.reduce((a, b) => (a.wave > b.wave ? a : b));
  }

  if (template) {
    for (const entry of template.entries) {
      const scaled = Math.round(num(entry.count) * intPow(num(data.waves.scaling.count, 1), steps));
      for (let i = 0; i < scaled; i++) {
        specs.push({ defId: entry.monsterId, waveNumber });
      }
    }
  }

  // §3.4: every fifth wave is a boss wave, drawn at random from the bank. An
  // authored wave that already names a boss does not get a second one.
  if (isBossWave(data, waveNumber) && data.waves.bossBank.length > 0) {
    const bossIds = new Set(data.waves.bossBank);
    const alreadyHasBoss = specs.some((s) => bossIds.has(s.defId));
    if (!alreadyHasBoss) {
      const chosen = rng.pick(data.waves.bossBank);
      if (chosen) specs.unshift({ defId: chosen, waveNumber });
    }
  }

  return specs;
}

/**
 * §9.3: during the build phase players see the incoming wave - types, counts,
 * armour types - and a summary of what it deals. Fair, because everyone faces
 * the same thing, and it is what makes 30 seconds of building a real decision
 * rather than a shopping trip.
 */
export interface WavePreviewEntry {
  defId: string;
  name: string;
  count: number;
  armour: string;
  damageType: string;
}

export function previewWave(data: GameData, seed: number, waveNumber: number): WavePreviewEntry[] {
  const byId = new Map<string, MonsterDef>();
  for (const m of data.monsters.monsters) byId.set(m.id, m);
  for (const b of data.monsters.bosses) byId.set(b.id, b);

  const counts = new Map<string, number>();
  for (const spec of generateWave(data, seed, waveNumber)) {
    counts.set(spec.defId, (counts.get(spec.defId) ?? 0) + 1);
  }

  const preview: WavePreviewEntry[] = [];
  for (const [defId, count] of counts) {
    const def = byId.get(defId);
    if (!def) continue;
    preview.push({
      defId,
      name: def.name,
      count,
      armour: def.armour,
      damageType: def.damageType,
    });
  }
  return preview;
}

/**
 * §9.3: the preview must also summarise the wave's offence ("this wave deals
 * mostly Pierce") and highlight which of the player's buildable units are strong
 * or weak against it.
 *
 * That sentence is load-bearing. Without it the damage matrix is invisible
 * complexity and new players lose without ever learning why - so this is game
 * logic, not decoration, and it lives in the simulation where an AI opponent and
 * the server can read it too.
 */
export interface UnitRating {
  unitId: string;
  name: string;
  /** Tier 1 units are the buildable ones; higher tiers come from upgrading. */
  tier: number;
  /** Average matrix multiplier of this unit's damage against the wave. */
  effectiveness: number;
  verdict: 'strong' | 'neutral' | 'weak';
}

export interface WaveSummary {
  /** What the wave hits you with, weighted by monster count. */
  dominantDamageType: DamageType | null;
  /** Share of the wave, by count, dealing that type. */
  dominantDamageShare: number;
  /** Armour spread of the wave, by count. */
  armourMix: { armour: ArmourType; count: number }[];
  /** How each buildable unit fares against this wave's armour. */
  units: UnitRating[];
}

const STRONG_THRESHOLD = 1.15;
const WEAK_THRESHOLD = 0.85;

export function summariseWave(
  data: GameData,
  seed: number,
  waveNumber: number,
  builderId?: string,
): WaveSummary {
  const byId = new Map<string, MonsterDef>();
  for (const m of data.monsters.monsters) byId.set(m.id, m);
  for (const b of data.monsters.bosses) byId.set(b.id, b);

  const specs = generateWave(data, seed, waveNumber);
  const damageCounts = new Map<DamageType, number>();
  const armourCounts = new Map<ArmourType, number>();
  let total = 0;

  for (const spec of specs) {
    const def = byId.get(spec.defId);
    if (!def) continue;
    total++;
    damageCounts.set(def.damageType, (damageCounts.get(def.damageType) ?? 0) + 1);
    armourCounts.set(def.armour, (armourCounts.get(def.armour) ?? 0) + 1);
  }

  let dominantDamageType: DamageType | null = null;
  let dominantCount = 0;
  for (const [type, count] of damageCounts) {
    if (count > dominantCount) {
      dominantCount = count;
      dominantDamageType = type;
    }
  }

  const armourMix = [...armourCounts.entries()]
    .map(([armour, count]) => ({ armour, count }))
    .sort((a, b) => b.count - a.count);

  // A unit's usefulness is its damage type averaged over the armour it will
  // actually meet, weighted by how much of that armour is coming.
  const units: UnitRating[] = [];
  for (const unit of data.units.units) {
    if (builderId && unit.builderId !== builderId) continue;

    let weighted = 0;
    for (const { armour, count } of armourMix) {
      weighted += (data.matrix.multipliers[unit.damageType]?.[armour] ?? 1) * count;
    }
    const effectiveness = total > 0 ? weighted / total : 1;

    units.push({
      unitId: unit.id,
      name: unit.name,
      tier: unit.tier,
      effectiveness,
      verdict:
        effectiveness >= STRONG_THRESHOLD
          ? 'strong'
          : effectiveness <= WEAK_THRESHOLD
            ? 'weak'
            : 'neutral',
    });
  }

  return {
    dominantDamageType,
    dominantDamageShare: total > 0 ? dominantCount / total : 0,
    armourMix,
    units,
  };
}
