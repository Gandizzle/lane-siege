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

import type {
  ArmorType,
  Combination,
  DamageType,
  GameData,
  MonsterDef,
  ShapeId,
  WaveDef,
} from '../data/schema.ts';
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

function num(value: number | null | undefined, fallback = 0): number {
  return value ?? fallback;
}

// ------------------------------------------------------------- combinations

/** An armor and a damage type, as "plate/pierce": one of the sixteen (§6). */
export type ComboKey = string;

export function comboKey(armor: ArmorType, damageType: DamageType): ComboKey {
  return `${armor}/${damageType}`;
}

/**
 * What waves 21 to 24 are made of: two combinations each, in wave order
 * (`chooseLateWaves`). Decided by the match, so it rides on the state and the
 * view rather than coming from the seed.
 */
export type LateWaves = readonly (readonly ComboKey[])[];

/** The row of the wave table for this wave, if it has one. */
function row(data: GameData, waveNumber: number): WaveDef | undefined {
  return data.waves.composition.find((w) => w.wave === waveNumber);
}

/** The last wave the table has a row for. */
function lastRow(data: GameData): number {
  let last = 0;
  for (const wave of data.waves.composition) last = Math.max(last, wave.wave);
  return last;
}

export function isBossWave(data: GameData, waveNumber: number): boolean {
  const every = data.waves.bossEveryNWaves;
  return every > 0 && waveNumber % every === 0;
}

/**
 * The waves that are ONE combination, start to finish: every wave before the
 * late waves that is not a boss wave and is not authored - 1 to 4, 6 to 9, 11
 * to 14 and 16 to 19. Sixteen waves for sixteen combinations, each once.
 *
 * Why: a wave of three monster types asks nothing of the army, because a
 * general-purpose army beats a mixture. A wave that is all Plate wearing
 * all Pierce asks one question, and an army that cannot answer it loses.
 */
export function combinationWaves(data: GameData): number[] {
  const out: number[] = [];
  const before = data.waves.lateWaves?.from ?? lastRow(data) + 1;
  for (let wave = 1; wave < before; wave++) {
    if (isBossWave(data, wave) || row(data, wave)?.entries) continue;
    out.push(wave);
  }
  return out;
}

const combinationWaveSets = new WeakMap<GameData, Set<number>>();

/** Whether `waveNumber` is one of the combination waves, cheaply (asked per death). */
export function isCombinationWave(data: GameData, waveNumber: number): boolean {
  let set = combinationWaveSets.get(data);
  if (!set) {
    set = new Set(combinationWaves(data));
    combinationWaveSets.set(data, set);
  }
  return set.has(waveNumber);
}

/** Waves 21 to 24: two combinations each, chosen by what hurt the most. */
export function isLateWave(data: GameData, waveNumber: number): boolean {
  const late = data.waves.lateWaves;
  return (
    !!late && waveNumber >= late.from && waveNumber <= late.to && !row(data, waveNumber)?.entries
  );
}

/** The match's own streams, apart from every wave's (`waveRng`). */
const ORDER_SALT = 0x5eed_0f1d;
const BOSS_SALT = 0x5eed_b055;
const LATE_SALT = 0x5eed_1a7e;

/** Fisher-Yates, on the match's generator: the same order on every client. */
function shuffled<T>(items: readonly T[], rng: { int(n: number): number }): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Which combination each combination wave is, for this match: the sixteen,
 * shuffled by the seed. A pure function of the seed, so the preview of wave
 * 9 says what wave 9 will be on every client, from the first build phase.
 */
export function combinationOrder(data: GameData, seed: number): Combination[] {
  return shuffled(data.waves.combinations, waveRng(seed, ORDER_SALT));
}

/** The combination a combination wave is, or null for any other wave. */
export function combinationOf(
  data: GameData,
  seed: number,
  waveNumber: number,
): Combination | null {
  const index = combinationWaves(data).indexOf(waveNumber);
  if (index < 0) return null;
  const order = combinationOrder(data, seed);
  return order.length > 0 ? order[index % order.length]! : null;
}

/**
 * Which boss each boss wave brings: the bank shuffled by the seed, so the four
 * boss waves before the last bring each boss once - equal shares, in an order
 * nobody can learn.
 */
export function bossFor(data: GameData, seed: number, waveNumber: number): string | null {
  const bank = data.waves.bossBank;
  const every = data.waves.bossEveryNWaves;
  if (bank.length === 0 || every <= 0) return null;
  const order = shuffled(bank, waveRng(seed, BOSS_SALT));
  return order[(Math.floor(waveNumber / every) - 1 + order.length * 8) % order.length] ?? null;
}

/**
 * Waves 21 to 24, decided as wave 20 ends: the `choose` combinations that took
 * the biggest share of the surviving armies' health in waves 1 to 19 (`harm`,
 * keyed by combination), shuffled into pairs. Ties, and a combination nobody
 * met, are settled by the seed - so a match with no record at all (a test, a
 * debugging start at wave 21) still gets a fair draw.
 */
export function chooseLateWaves(
  data: GameData,
  seed: number,
  harm: Readonly<Record<ComboKey, number>>,
): ComboKey[][] {
  const late = data.waves.lateWaves;
  if (!late) return [];
  const rng = waveRng(seed, LATE_SALT);
  const all = shuffled(
    data.waves.combinations.map((c) => comboKey(c.armor, c.damageType)),
    rng,
  );
  // Stable: an equal share keeps the shuffled order, which is the tie-break.
  const chosen = [...all].sort((a, b) => (harm[b] ?? 0) - (harm[a] ?? 0)).slice(0, late.choose);
  const order = shuffled(chosen, rng);
  const waves: ComboKey[][] = [];
  for (let i = 0; i < order.length; i += late.perWave) waves.push(order.slice(i, i + late.perWave));
  return waves;
}

// ------------------------------------------------------------------ scaling

/**
 * A value of the wave table at `waveNumber`: the row's own if it has one;
 * otherwise carried on from the last rows that do, at the rate between them -
 * which is how solo's endless stream, past the last row, keeps growing.
 */
function tableValue(
  data: GameData,
  waveNumber: number,
  pick: (w: WaveDef) => number | undefined,
): number {
  const rows = data.waves.composition
    .filter((w) => pick(w) !== undefined)
    .sort((a, b) => a.wave - b.wave);
  if (rows.length === 0) return 1;
  const exact = rows.find((w) => w.wave === waveNumber);
  if (exact) return pick(exact)!;
  const before = rows.filter((w) => w.wave < waveNumber);
  const last = before.at(-1);
  if (!last) return pick(rows[0]!)!;
  // Inside the table, between two rows: the earlier one holds.
  if (rows.some((w) => w.wave > waveNumber)) return pick(last)!;
  // Past it: from the last row, at the last step between two GENERATED rows,
  // repeated - every wave for the monsters' column, every five for the
  // bosses'. Not the step into an authored row: the council is twelve bosses
  // at a twelfth of one boss's scale, and growing from that step would shrink
  // solo's endless bosses. Repeated multiplication, not a fractional power,
  // which is not bit-identical across engines.
  const generated = before.filter((w) => !w.entries);
  const prev = generated.at(-2);
  const latest = generated.at(-1);
  if (!prev || !latest) return pick(last)!;
  const gap = latest.wave - prev.wave;
  const step = pick(latest)! / pick(prev)!;
  return pick(last)! * intPow(step, Math.floor((waveNumber - last.wave) / gap));
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

/** How many times its written health and damage a monster has at this wave. */
export function monsterGrowth(data: GameData, wave: number): number {
  return tableValue(data, wave, (w) => w.scale);
}

/** The same for a boss, which has a column of its own. */
export function bossGrowth(data: GameData, wave: number): number {
  return tableValue(data, wave, (w) => w.bossScale);
}

/** How many monsters a generated wave brings. */
export function waveCount(data: GameData, wave: number): number {
  return Math.max(1, Math.round(tableValue(data, wave, (w) => w.count)));
}

/**
 * §9.1, replaced: a monster's HP and DAMAGE are its definition's times the
 * wave's `scale` - a table, one row a wave (waves.json), not a curve. A boss
 * takes the row's `bossScale` instead.
 *
 * Move and attack speed deliberately do not grow - that is enrage's job (§8),
 * and stacking the two would make late waves unreadable. Nor does bounty: it
 * is a WEIGHT within a fixed pool (§11.1).
 */
export function resolveMonsterStats(
  data: GameData,
  def: MonsterDef,
  waveNumber: number,
): ResolvedMonsterStats {
  const growth =
    def.isBoss === true ? bossGrowth(data, waveNumber) : monsterGrowth(data, waveNumber);
  return {
    hp: num(def.hp) * growth,
    damage: num(def.damage) * growth,
    attackSpeed: num(def.attackSpeed),
    moveSpeed: num(def.moveSpeed),
    range: num(def.range),
    bounty: num(def.bounty),
    radius: num(def.bodyRadius, 0.3),
  };
}

// ------------------------------------------------------------------ a wave

/**
 * The full monster list for a wave, in spawn order.
 *
 *   An authored row (`entries`)  exactly those: wave 25's council, and tests.
 *   A boss wave                  its boss, alone (`bossFor`).
 *   A combination wave           `count` of one combination's monster.
 *   A late wave (21-24)          `count`, half each of two combinations,
 *                                from `late` (the match's own record) - or,
 *                                with no record, a draw from the seed.
 *
 * Pure in (data, seed, wave, late). Everything but the late waves is a
 * function of the seed alone, so it can be previewed from the start.
 */
export function generateWave(
  data: GameData,
  seed: number,
  waveNumber: number,
  late?: LateWaves | null,
): SpawnSpec[] {
  const specs: SpawnSpec[] = [];
  const authored = row(data, waveNumber);

  if (authored?.entries) {
    for (const entry of authored.entries) {
      for (let i = 0; i < num(entry.count); i++) specs.push({ defId: entry.monsterId, waveNumber });
    }
  } else if (isBossWave(data, waveNumber)) {
    const boss = bossFor(data, seed, waveNumber);
    if (boss) specs.push({ defId: boss, waveNumber });
  } else if (isLateWave(data, waveNumber)) {
    const from = data.waves.lateWaves!.from;
    const pairs = late && late.length > 0 ? late : chooseLateWaves(data, seed, {});
    const keys = pairs[waveNumber - from] ?? pairs[0] ?? [];
    const monsters = keys
      .map((key) => data.waves.combinations.find((c) => comboKey(c.armor, c.damageType) === key))
      .filter((c): c is Combination => c !== undefined)
      .map((c) => c.monsterId);
    const count = waveCount(data, waveNumber);
    // Alternating, so the two halves arrive mixed rather than one behind the other.
    for (let i = 0; i < count && monsters.length > 0; i++) {
      specs.push({ defId: monsters[i % monsters.length]!, waveNumber });
    }
  } else {
    const combo =
      combinationOf(data, seed, waveNumber) ??
      // Past the table (or a table with no combination waves): any one.
      waveRng(seed, waveNumber).pick(data.waves.combinations) ??
      null;
    if (combo) {
      const count = waveCount(data, waveNumber);
      for (let i = 0; i < count; i++) specs.push({ defId: combo.monsterId, waveNumber });
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
  //
  // ONE purse a boss wave, shared between its bosses. Every boss wave but the
  // last has one boss and so pays the whole purse on it; the last is a council
  // of them, and paying each its own purse would hand whoever cleared it a
  // second army's worth of gold the moment before the Final Showdown.
  const purse = num(data.economy.bossBounty);
  const bosses = new Set(data.monsters.bosses.map((b) => b.id));
  const count = specs.filter((spec) => bosses.has(spec.defId)).length;
  if (purse > 0 && count > 0) {
    for (const spec of specs) {
      if (bosses.has(spec.defId)) spec.bounty = num(spec.bounty ?? null) + purse / count;
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
  return (sendPrice(data, sendId).gems * num(data.economy.sendBountyPerTenGems)) / 10;
}

/**
 * What a send costs, and the income it grants: the price as written.
 *
 * It USED to climb with the monster curve, because the body it delivered did -
 * a send cost the same 10 gems at wave 20 as at wave 1 for a body twenty-four
 * times the size, and a table sending at itself drowned. The fix now lives in
 * the body instead: a sent body is the size its send says at every wave
 * (sends.json `_bodies`), so a gem buys the same pressure whenever it is spent
 * and the price can be the number on the button.
 */
/** Whether a send may land in `wave` (sends.json `_unlock`). */
export function sendOpen(send: { fromWave?: number }, wave: number): boolean {
  return wave >= (send.fromWave ?? 1);
}

export function sendPrice(data: GameData, sendId: string): { gems: number; income: number } {
  const send = data.sends.sends.find((s) => s.id === sendId);
  if (!send) return { gems: 0, income: 0 };
  return { gems: num(send.gemCost), income: num(send.incomeGranted) };
}

/**
 * §9.3: during the build phase players see the incoming wave - types, counts,
 * armor types - and a summary of what it deals. Fair, because everyone faces
 * the same thing, and it is what makes 30 seconds of building a real decision
 * rather than a shopping trip.
 */
export interface WavePreviewEntry {
  defId: string;
  name: string;
  count: number;
  armor: ArmorType;
  damageType: DamageType;
  /**
   * The monster's silhouette (§14.2, amended), so the preview can show the
   * thing rather than only name it. Carried here beside `armor` and
   * `damageType` for the same reason those are: it is a property of the
   * definition that the preview needs, and looking it up again in the renderer
   * would be a second place for the answer to come from.
   */
  shape: ShapeId;
}

export function previewWave(
  data: GameData,
  seed: number,
  waveNumber: number,
  late?: LateWaves | null,
): WavePreviewEntry[] {
  const byId = new Map<string, MonsterDef>();
  for (const m of data.monsters.monsters) byId.set(m.id, m);
  for (const b of data.monsters.bosses) byId.set(b.id, b);

  const counts = new Map<string, number>();
  for (const spec of generateWave(data, seed, waveNumber, late)) {
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
      armor: def.armor,
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
  /** Whether its DAMAGE is good against the wave's armor: the sword. */
  verdict: 'strong' | 'neutral' | 'weak';
  /**
   * Average matrix multiplier of the wave's damage against this unit's armor:
   * how hard the wave's blows land on it. Below 1 is good for the unit.
   */
  taken: number;
  /** Whether its ARMOR is good against the wave's damage: the shield. */
  armorVerdict: 'strong' | 'neutral' | 'weak';
}

export interface WaveSummary {
  /** What the wave hits you with, weighted by monster count. */
  dominantDamageType: DamageType | null;
  /** Share of the wave, by count, dealing that type. */
  dominantDamageShare: number;
  /** Armor spread of the wave, by count. */
  armorMix: { armor: ArmorType; count: number }[];
  /** How each buildable unit fares against this wave's armor. */
  units: UnitRating[];
}

const STRONG_THRESHOLD = 1.15;
const WEAK_THRESHOLD = 0.85;

export function summariseWave(
  data: GameData,
  seed: number,
  waveNumber: number,
  builderId?: string,
  late?: LateWaves | null,
): WaveSummary {
  const byId = new Map<string, MonsterDef>();
  for (const m of data.monsters.monsters) byId.set(m.id, m);
  for (const b of data.monsters.bosses) byId.set(b.id, b);

  const specs = generateWave(data, seed, waveNumber, late);
  const damageCounts = new Map<DamageType, number>();
  const armorCounts = new Map<ArmorType, number>();
  let total = 0;

  for (const spec of specs) {
    const def = byId.get(spec.defId);
    if (!def) continue;
    total++;
    damageCounts.set(def.damageType, (damageCounts.get(def.damageType) ?? 0) + 1);
    armorCounts.set(def.armor, (armorCounts.get(def.armor) ?? 0) + 1);
  }

  let dominantDamageType: DamageType | null = null;
  let dominantCount = 0;
  for (const [type, count] of damageCounts) {
    if (count > dominantCount) {
      dominantCount = count;
      dominantDamageType = type;
    }
  }

  const armorMix = [...armorCounts.entries()]
    .map(([armor, count]) => ({ armor, count }))
    .sort((a, b) => b.count - a.count);

  // A unit's usefulness is its damage type averaged over the armor it will
  // actually meet, weighted by how much of that armor is coming - and, the
  // other way round, the wave's damage types averaged over the unit's armor,
  // weighted by how much of each is coming: the matrix works both ways (§6).
  const units: UnitRating[] = [];
  for (const unit of data.units.units) {
    if (builderId && unit.builderId !== builderId) continue;

    let weighted = 0;
    for (const { armor, count } of armorMix) {
      weighted += (data.matrix.multipliers[unit.damageType]?.[armor] ?? 1) * count;
    }
    const effectiveness = total > 0 ? weighted / total : 1;
    let incoming = 0;
    for (const [type, count] of damageCounts) {
      incoming += (data.matrix.multipliers[type]?.[unit.armor] ?? 1) * count;
    }
    const taken = total > 0 ? incoming / total : 1;

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
      taken,
      // Taking less is the good side, so the thresholds turn round.
      armorVerdict:
        taken <= WEAK_THRESHOLD ? 'strong' : taken >= STRONG_THRESHOLD ? 'weak' : 'neutral',
    });
  }

  return {
    dominantDamageType,
    dominantDamageShare: total > 0 ? dominantCount / total : 0,
    armorMix,
    units,
  };
}
