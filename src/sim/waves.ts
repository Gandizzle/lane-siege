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

import type { ArmourType, DamageType, GameData, MonsterDef, ShapeId } from '../data/schema.ts';
import { waveRng } from './rng.ts';

/** One monster to spawn: its definition, and the wave it belongs to (§8). */
export interface SpawnSpec {
  defId: string;
  waveNumber: number;
  /**
   * The send that bought this body, or absent for one the wave brought (§11.5).
   *
   * Carried all the way from the purchase to the spawn - through the reserve,
   * which can hold a body for several waves - because a send's abilities are
   * the send's, not the monster's (abilities.json).
   */
  sendId?: string;
  /**
   * Gold this body pays the lane that kills it, decided when the wave was
   * generated or the send was queued rather than read off the definition.
   *
   * A wave's monsters divide a FIXED pool (`shareOutTheWavePool`); a sent one is
   * priced against what its sender spent (`sendBounty`). It rides on the spec
   * because the reserve can hold a body for several waves (§8.1), and its
   * bounty belongs to the wave that bought it, not the one it finally walks in
   * with.
   */
  bounty?: number;
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
 * How far past the authored composition this wave sits. Authored waves scale
 * their COUNT by 1; every wave beyond the last authored one compounds §9.2's
 * growth factor, because past the authored range there is nothing else to say
 * how many walk in.
 *
 * Counts only. What a wave is MADE OF is a decision; how strong each body in it
 * is, is a curve - see `statSteps`.
 */
function countSteps(data: GameData, waveNumber: number): number {
  let lastAuthored = 0;
  for (const wave of data.waves.composition) {
    if (wave.wave > lastAuthored) lastAuthored = wave.wave;
  }
  return waveNumber > lastAuthored ? waveNumber - lastAuthored : 0;
}

/**
 * How far up the strength curve a wave sits: one step per wave, from the first.
 *
 * §9.1 as written only grew a monster past the authored range, so a grub was
 * the same 30-health grub at wave 1 and at wave 20 and the whole difficulty
 * curve had to be carried by counts and by which monsters were in the mix. That
 * makes the cheap monsters dead weight the moment anything bigger exists, and
 * it means a wave cannot reuse a body without the wave getting easier.
 *
 * Scaling the bodies instead lets a wave keep a small roster on purpose - a
 * grub is a fine "it walks at you and hits things", and one asset can serve
 * twenty-five waves - while still being a real fight at wave 20. The numbers
 * it produces are what the stat panel shows, not the definition's
 * (`monsterStatText`), because a wave-5 grub really is not a wave-1 grub.
 */
function statSteps(waveNumber: number): number {
  return Math.max(0, waveNumber - 1);
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
 * How many boss waves past the first this one is. Wave 5 is 0, wave 25 is 4.
 *
 * Bosses are drawn at random from a bank (§3.4), so the bank has to be four
 * bodies of the SAME power wearing four different armour types - otherwise
 * "wave 5" means a 1,400 HP fight or a 3,100 HP fight depending on a die roll,
 * and no amount of tuning the escort makes that one wave. What separates wave
 * 5's boss from wave 25's is this exponent, not which body came up.
 */
function bossStep(data: GameData, waveNumber: number): number {
  const every = data.waves.bossEveryNWaves;
  if (every <= 0) return 0;
  return Math.max(0, Math.floor(waveNumber / every) - 1);
}

/**
 * §9.1, amended: monster HP and DAMAGE grow one step a wave, from wave 1.
 *
 * Move and attack speed deliberately do not - that is enrage's job (§8), and
 * stacking the two would make late waves unreadable. Nor does bounty any more:
 * §11.1 made it a WEIGHT within a fixed pool rather than an amount, and every
 * body in one wave scales by the same factor, so scaling it moved no share of
 * anything and only made the number on the definition harder to read.
 *
 * A boss scales on its own ladder (`bossScaling`) and not on this one, because
 * it appears once every five waves and would otherwise take both.
 */
export function resolveMonsterStats(
  data: GameData,
  def: MonsterDef,
  waveNumber: number,
): ResolvedMonsterStats {
  const { scaling } = data.waves;
  // A boss scales on its own ladder and NOT on the per-wave one, or it would
  // take both: it appears once every five waves, so five waves of ordinary
  // growth are already priced into `bossScaling`.
  const isBoss = def.isBoss === true;
  const steps = isBoss ? 0 : statSteps(waveNumber);
  const boss = isBoss ? bossStep(data, waveNumber) : 0;
  const bossHp = intPow(num(data.waves.bossScaling?.hp ?? null, 1), boss);
  const bossDamage = intPow(num(data.waves.bossScaling?.damage ?? null, 1), boss);

  return {
    hp: num(def.hp) * intPow(num(scaling.hp, 1), steps) * bossHp,
    damage: num(def.damage) * intPow(num(scaling.damage, 1), steps) * bossDamage,
    attackSpeed: num(def.attackSpeed),
    moveSpeed: num(def.moveSpeed),
    range: num(def.range),
    bounty: num(def.bounty),
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
  const steps = countSteps(data, waveNumber);

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

  shareOutTheWavePool(data, specs);
  return specs;
}

/**
 * §11.1, REPLACED: a wave pays a FIXED pool, split between its monsters in
 * proportion to the `bounty` weight on each definition.
 *
 * The bounty on a monster definition used to be the gold it paid, so a wave's
 * payout was whatever its composition happened to add up to: wave 24 paid 545
 * gold and wave 12 paid 101, and nobody decided either. Worse, it made clearing
 * a wave fast a way to FARM it - the gold curve bent to whoever built the most
 * damage, and the lead compounded.
 *
 * A fixed pool takes that out. The number on the definition is now a weight, so
 * a carapace is still worth four grubs to kill and the wave still pays 200
 * whatever walks in. What a player earns from a wave is now a constant, and the
 * reward for building well is that they survive it - which is the pressure the
 * game is supposed to be about.
 *
 * Sent monsters are NOT in this: they are priced against what their sender paid
 * (`sendBountyPerTenGems`), so sending at somebody cannot dilute their pool.
 */
export function shareOutTheWavePool(data: GameData, specs: SpawnSpec[]): void {
  const pool = num(data.economy.waveBounty);
  if (pool <= 0 || specs.length === 0) return;

  const byId = new Map([...data.monsters.monsters, ...data.monsters.bosses].map((m) => [m.id, m]));
  const weightOf = (spec: SpawnSpec): number =>
    Math.max(0, num(byId.get(spec.defId)?.bounty ?? null));

  let total = 0;
  for (const spec of specs) total += weightOf(spec);

  // Every weight zero would divide by nothing. An even split is the honest
  // reading of "no monster here is worth more than another".
  for (const spec of specs) {
    spec.bounty = total > 0 ? (pool * weightOf(spec)) / total : pool / specs.length;
  }

  // §3.4, added: a boss pays a PURSE on top of its share of the pool.
  //
  // Its share alone is not a reward for killing it - the pool is fixed, so a
  // boss wave that paid only the pool would pay exactly what wave 4 paid for a
  // wave that is several times the work. The purse is what makes surviving a
  // boss wave buy the army that survives the next five, and it is paid on the
  // kill rather than on the wave, so a boss that walks past collects nothing.
  const purse = num(data.economy.bossBounty);
  if (purse > 0) {
    const bosses = new Set(data.monsters.bosses.map((b) => b.id));
    for (const spec of specs) {
      if (bosses.has(spec.defId)) spec.bounty = num(spec.bounty ?? null) + purse;
    }
  }
}

/**
 * §11.5: what a sent monster pays the lane that kills it.
 *
 * Priced against what the SENDER spent rather than against the body, so that a
 * send is a straight trade - permanent income for them, gold now for you - and
 * an expensive attack send funds its target's answer to it. Sends are bought
 * with gems and the bounty is paid in gold, which is the one place in the game
 * the two currencies touch; `sendBountyPerTenGems` is that exchange rate.
 */
export function sendBounty(data: GameData, sendId: string): number {
  const send = data.sends.sends.find((s) => s.id === sendId);
  if (!send) return 0;
  return (num(send.gemCost) * num(data.economy.sendBountyPerTenGems)) / 10;
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
  armour: ArmourType;
  damageType: DamageType;
  /**
   * The monster's silhouette (§14.2, amended), so the preview can show the
   * thing rather than only name it. Carried here beside `armour` and
   * `damageType` for the same reason those are: it is a property of the
   * definition that the preview needs, and looking it up again in the renderer
   * would be a second place for the answer to come from.
   */
  shape: ShapeId;
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
      shape: def.shape,
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
  /** Mark 1 units are the buildable ones; higher marks come from upgrading. */
  mark: number;
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
      mark: unit.mark,
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
