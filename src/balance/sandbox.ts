/**
 * One army, one wave, nothing else. The instrument for tuning wave difficulty.
 *
 * The showdown harness (`arena.ts`) asks whether four finished armies are
 * balanced against each other. This asks the question that comes first and is
 * the one a player actually meets: CAN THIS MUCH GOLD SURVIVE THIS WAVE, and by
 * how much. A wave the whole roster clears without losing a body is a wave that
 * is not asking anything; a wave nobody clears at the gold they could possibly
 * have by then is a wave that ends the run.
 *
 * WHAT IT CONTROLS FOR
 *
 *   - The fortress is SILENT. No weapon, no aura, no regeneration, no gems.
 *     Every point of damage in the result was dealt by a unit the army paid
 *     for, which is the only way "200 gold of army" can mean anything. The
 *     fortress is the game's safety net and a safety net measured together
 *     with the thing it catches tells you about neither.
 *   - A monster that gets far enough up the lane for the fortress weapon to
 *     reach it is REMOVED and counted as a LEAK, with the health it still had
 *     written down. That is the same cut - the fight being measured is the one
 *     in front of the wall - and it has the useful side effect that the lane
 *     still empties, so a fight that went badly ends instead of running to the
 *     tick cap with three monsters chewing an invulnerable wall.
 *   - No tech, no upgrades, no aura. A wave-3 player has barely any; pretending
 *     otherwise would tune the waves for a player who does not exist yet.
 *
 * WHAT IT DELIBERATELY DOES NOT
 *
 *   - Placement cleverness. Melee across the front, reach behind it, packed
 *     from the row the wave arrives at. A player who blocks a choke or spreads
 *     against splash will do better than this, and that headroom is the point:
 *     these numbers are what a competent-but-plain build gets, so a wave tuned
 *     to them leaves cleverness somewhere to go.
 *   - Retreating, rebuilding, selling, or anything else across waves. One army
 *     meets one wave at full health. Waves compose across a run, and that is
 *     the run harness's question.
 */

import type { GameData, UnitDef } from '../data/schema.ts';
import { buildableUnits, isMelee } from '../data/roster.ts';
import {
  buildDefIndex,
  countLiving,
  createContext,
  createMatch,
  createUnit,
  generateWave,
  recomputeUnitBuffs,
  resolveMonsterStats,
  stat,
  step,
  TICKS_PER_SECOND,
  type MatchState,
} from '../sim/index.ts';
import { lines } from './builds.ts';

/** One body on the shopping list: which of the builder's six lines, how tall. */
export interface Buy {
  rung: number;
  mark: number;
}

/** A shopping list, and what it came to. */
export interface Shopping {
  buys: Buy[];
  gold: number;
  supply: number;
}

export interface SandboxOptions {
  /** Ticks before a fight is abandoned. Six minutes: nothing real takes that. */
  maxTicks?: number;
  /** Let the fortress shoot, buff and heal. Off by default, and off for tuning. */
  wakeTheFortress?: boolean;
  /** The band this basket was drawn for. Reported, never simulated. */
  goldBudget?: number;
  /**
   * Tech levels owned, by track. None by default: the ladder's nominals are
   * army gold with no tech, and tech is one of the things the slack buys.
   */
  tech?: Readonly<Record<string, number>>;
}

export interface WaveOutcome {
  wave: number;
  builderId: string;
  label: string;
  /**
   * The budget this basket was enumerated against, which is the band it
   * belongs to in the report. Distinct from `goldSpent`, which is what the
   * basket actually came to - a 250 gold band holds armies costing 214 to 248
   * and they are all answers to the question "what does 250 gold get you".
   */
  goldBudget: number;
  goldSpent: number;
  supplyUsed: number;
  bodies: number;

  /** Every monster dead and none past the line. The bar the wave is tuned to. */
  cleared: boolean;
  /** Monsters that reached the fortress's reach and were taken off the board. */
  leaked: number;

  /** Health still standing, as a fraction of what each side started with. */
  armyHpLeft: number;
  waveHpLeft: number;
  /**
   * `armyHpLeft - waveHpLeft`: +1 is untouched against a wiped wave, -1 is a
   * wiped army against an untouched wave, and 0 is a fight that went exactly
   * evenly. One number that says how comfortably, rather than whether.
   */
  margin: number;

  unitsLost: number;
  seconds: number;
  timedOut: boolean;

  /**
   * What each body it bought cost, and what that bought.
   *
   * The margin says whether an ARMY was worth its gold. This says whether a
   * BODY was, which is a different question and the one that catches a line
   * carrying more than it is charged for - a top mark with an area attack
   * bolted on reads as three times the damage per gold of its neighbours long
   * before it shows up as a builder winning too often.
   */
  lines: LineResult[];
}

/** One body's ledger: what it cost, what it dealt, what it could take. */
export interface LineResult {
  defId: string;
  rung: number;
  mark: number;
  gold: number;
  supply: number;
  damageDealt: number;
  maxHp: number;
  survived: boolean;
}

const DEFAULT_MAX_TICKS = TICKS_PER_SECOND * 60 * 6;

function num(value: number | null | undefined, fallback = 0): number {
  return value ?? fallback;
}

/**
 * How far up the lane a monster gets before the fortress could open fire.
 *
 * EDGE TO EDGE, because that is how `withinRange` measures: the weapon's reach
 * is its range plus the fortress's own radius plus the body's. A line drawn at
 * the bare range number sits half a tile inside the weapon's actual reach, and
 * the wall quietly shot three of seventeen leakers before they crossed it.
 * Measured against the largest body in the game so the line holds for a boss.
 *
 * Derived rather than picked, so moving the wall's range in
 * `data/fortress.json` moves the line these measurements are taken at instead
 * of leaving them measuring a different lane than the one being played.
 */
export function leakLine(data: GameData): number {
  const fortressY = data.lane.buildZone.depth + data.lane.fortressZoneDepth * 0.5;
  const widest = [...data.monsters.monsters, ...data.monsters.bosses].reduce(
    (max, m) => Math.max(max, num(m.bodyRadius, 0.3)),
    0,
  );
  return fortressY - num(data.lane.fortressRadius) - num(data.fortress.weapon.range, 5) - widest;
}

/**
 * The rows an army may stand in: the front of the build zone, stopping short of
 * anywhere the fortress could touch it.
 *
 * A unit inside the aura is a unit being measured with a buff nobody paid for,
 * and a unit behind the leak line is a unit standing where the fight is not.
 */
export function usableRows(data: GameData): number {
  const fortressY = data.lane.buildZone.depth + data.lane.fortressZoneDepth * 0.5;
  const auraReach =
    fortressY - num(data.fortress.auras.radius.base, 3) - num(data.lane.fortressRadius);
  return Math.max(1, Math.min(Math.ceil(leakLine(data)) - 1, Math.floor(auraReach)));
}

/**
 * What one body costs to have standing there at that mark: its whole chain.
 *
 * Read off the definitions rather than recomputed from the price ladder,
 * because the definitions are what `apply.ts` charges a player. A shop that
 * quoted the formula would be measuring armies nobody can buy the moment the
 * two drift apart, and nothing would say so.
 */
export function chainCost(
  data: GameData,
  builderId: string,
  rung: number,
  mark: number,
): { gold: number; supply: number } {
  const chain = lines(data, builderId).get(rung) ?? [];
  let gold = 0;
  let supply = 0;
  for (const def of chain.slice(0, mark)) {
    gold += num(def.goldCost);
    supply += num(def.supplyCost);
  }
  return { gold, supply };
}

/**
 * Every (rung, mark) a builder could put on the board for this much gold.
 *
 * Marks are bought in place in the real game, but a body that is Mark II by the
 * time the wave lands cost its whole chain, so the shelf prices the chain.
 */
export function shelf(data: GameData, builderId: string, gold: number): Buy[] {
  const chains = lines(data, builderId);
  const out: Buy[] = [];
  for (const unit of buildableUnits(data, builderId)) {
    const depth = chains.get(unit.rung)?.length ?? 1;
    for (let mark = 1; mark <= depth; mark++) {
      if (chainCost(data, builderId, unit.rung, mark).gold <= gold) {
        out.push({ rung: unit.rung, mark });
      }
    }
  }
  return out;
}

/**
 * Every army a builder could buy for this much gold, within a supply cap.
 *
 * Exhaustive rather than sampled: at the gold a player has in the first five
 * waves the shelf is short enough that every distinct basket fits in a run, and
 * a sampled one would leave "is there a build that walks this wave" answered by
 * chance. Baskets are multisets, so order never doubles one up.
 *
 * `spendAtLeast` throws away the baskets that simply declined to buy anything -
 * an army that spent 45 of a 250 budget is not a data point about 250 gold.
 *
 * `maxLines` is the one real restriction, and it is a restriction on the PLAYER
 * rather than on the arithmetic: a person buying an army picks two or three
 * lines they like and buys those, and does not field one of each of six. Left
 * unbounded the count is combinatorial - 63,452 baskets at 1,050 gold against
 * 966 at 650 - and the extra ones are all six-line fruit salads nobody would
 * build. Three lines is the cap; raise it if a result ever looks like it is
 * being decided by the cap rather than by the roster.
 */
export const DEFAULT_MAX_LINES = 3;

/**
 * How many of one thing a basket may hold.
 *
 * Coarse on purpose. Thirteen rung 1 bodies and fourteen rung 1 bodies are not
 * two different armies, and enumerating both doubles the work to learn the same
 * thing twice - unbounded, the basket count runs to 176,000 a builder by the
 * gold a wave 5 player has. The ladder keeps the swarm builds representable
 * (twenty-four bodies is the board nearly full) while collapsing the
 * off-by-ones.
 */
export const COUNT_LADDER = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24] as const;

export function enumerateArmies(
  data: GameData,
  builderId: string,
  gold: number,
  supplyCap: number,
  spendAtLeast = 0.85,
  maxLines = DEFAULT_MAX_LINES,
): Shopping[] {
  // Mixed marks within a line while the whole space can be held; one mark a
  // line past that. See `MIXED_MARK_LIMIT`.
  let leaves = 0;
  walkArmies(data, builderId, gold, supplyCap, spendAtLeast, maxLines, false, () => {
    leaves += 1;
    return leaves <= MIXED_MARK_LIMIT;
  });
  const oneMarkPerLine = leaves > MIXED_MARK_LIMIT;

  const out: Shopping[] = [];
  walkArmies(
    data,
    builderId,
    gold,
    supplyCap,
    spendAtLeast,
    maxLines,
    oneMarkPerLine,
    (buys, spent, supply) => {
      out.push({ buys: [...buys], gold: spent, supply });
      return true;
    },
  );
  return out;
}

/**
 * How many baskets the exhaustive walk may find before it stops mixing marks
 * within a line.
 *
 * The count grows about three and a half times for every 500 gold: a million
 * baskets a builder at 2,500, six million at 3,500, and a sweep past wave 10
 * ran out of memory holding them. Almost all of that growth is one line's
 * bodies split across marks - four Mark I and two Mark II of the same rung -
 * which is a real army mid-upgrade but not a different ANSWER to a wave. So
 * past this many, every line is bought at a single mark, which bounds the
 * space whatever the gold. Set high enough that every band of waves 1 to 10
 * is still enumerated in full, exactly as those waves were tuned.
 */
export const MIXED_MARK_LIMIT = 2_500_000;

/**
 * The walk behind `enumerateArmies`: every basket in turn, handed to `visit`,
 * which returns false to stop. The basket is the walk's own working array and
 * changes as soon as `visit` returns, so a caller that keeps one copies it -
 * and one that only counts does not pay for millions of copies it throws away.
 */
function walkArmies(
  data: GameData,
  builderId: string,
  gold: number,
  supplyCap: number,
  spendAtLeast: number,
  maxLines: number,
  oneMarkPerLine: boolean,
  visit: (buys: readonly Buy[], spent: number, supply: number) => boolean,
): void {
  const shelfItems = shelf(data, builderId, gold);
  const costs = shelfItems.map((item) => chainCost(data, builderId, item.rung, item.mark));
  const tiles = usableRows(data) * data.lane.buildZone.width;
  const floor = gold * spendAtLeast;

  const basket: Buy[] = [];
  const rungs = new Map<number, number>();
  let stopped = false;

  const walk = (index: number, goldLeft: number, supplyLeft: number): void => {
    if (stopped) return;
    if (index === shelfItems.length) {
      if (basket.length === 0) return;
      // The bodies' gold plus whatever it cost to raise the cap far enough to
      // field them. Checked here rather than as the walk goes, because what a
      // cap costs depends on the basket's TOTAL supply.
      const supply = supplyCap - supplyLeft;
      const spent = gold - goldLeft + supplyGold(data, supply);
      if (spent <= gold && spent >= floor) stopped = !visit(basket, spent, supply);
      return;
    }

    // Take none of this one.
    walk(index + 1, goldLeft, supplyLeft);

    const item = shelfItems[index]!;
    const cost = costs[index]!;
    const marks = rungs.get(item.rung) ?? 0;
    const fresh = marks === 0;
    if (fresh && rungs.size >= maxLines) return;
    if (!fresh && oneMarkPerLine) return;

    rungs.set(item.rung, marks + 1);
    let taken = 0;
    let goldHere = goldLeft;
    let supplyHere = supplyLeft;
    for (const count of COUNT_LADDER) {
      const extra = count - taken;
      if (basket.length + extra > tiles) break;
      if (cost.gold * extra > goldHere || cost.supply * extra > supplyHere) break;
      goldHere -= cost.gold * extra;
      supplyHere -= cost.supply * extra;
      for (let i = 0; i < extra; i++) basket.push(item);
      taken = count;
      walk(index + 1, goldHere, supplyHere);
    }
    for (let i = 0; i < taken; i++) basket.pop();
    if (fresh) rungs.delete(item.rung);
    else rungs.set(item.rung, marks);
  };

  walk(0, gold, supplyCap);
}

/**
 * Gold it takes to raise the supply cap far enough to field this much.
 *
 * The cap starts at `capBase` and is bought up five at a time (§11.4). Through
 * wave 5 an army never needed more than the base, so the sandbox could ignore
 * it; from wave 6 a 1,200-gold army of cheap bodies wants thirty-odd supply,
 * and a basket that did not pay for that would be measuring an army nobody can
 * field for its price.
 */
export function supplyGold(data: GameData, supply: number): number {
  const { capBase, capUpgrades } = data.economy.supply;
  let cap = num(capBase, 25);
  let gold = 0;
  for (const level of capUpgrades) {
    if (cap >= supply) break;
    cap = num(level.value, cap);
    gold += num(level.goldCost);
  }
  return cap >= supply ? gold : Number.POSITIVE_INFINITY;
}

/** The most supply that can be bought at all. */
export function maxSupply(data: GameData): number {
  const { capBase, capUpgrades } = data.economy.supply;
  return capUpgrades.reduce((cap, level) => Math.max(cap, num(level.value, cap)), num(capBase, 25));
}

/** `r4m2 x1, r1m1 x2`, which is how a basket reads in a table. */
export function shoppingLabel(shopping: Shopping): string {
  const counts = new Map<string, number>();
  for (const buy of shopping.buys) {
    const key = `r${buy.rung}m${buy.mark}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([key, n]) => (n > 1 ? `${key}x${n}` : key)).join(' ');
}

interface Placed {
  def: UnitDef;
  tileX: number;
  tileY: number;
}

/**
 * Melee across the front, reach behind it.
 *
 * Rows fill from the row the wave arrives at, outward from the middle of each
 * row so a line grows around the centre. Melee takes the front rows because a
 * front line that stands behind its guns is not a front line; within each group
 * the shortest reach goes first, so a 2-tile gun sits in front of a 5-tile one.
 */
export function layOut(data: GameData, builderId: string, shopping: Shopping): Placed[] {
  const chains = lines(data, builderId);
  const bodies: UnitDef[] = [];
  for (const buy of shopping.buys) {
    const def = chains.get(buy.rung)?.[buy.mark - 1];
    if (def) bodies.push(def);
  }

  const melee = bodies.filter(isMelee).sort((a, b) => num(a.range) - num(b.range));
  const reach = bodies.filter((b) => !isMelee(b)).sort((a, b) => num(a.range) - num(b.range));

  const { width } = data.lane.buildZone;
  const mid = Math.floor(width / 2);
  const columns: number[] = [];
  for (let offset = 0; offset < width; offset++) {
    const x = offset % 2 === 0 ? mid + (offset >> 1) : mid - 1 - (offset >> 1);
    if (x >= 0 && x < width) columns.push(x);
  }

  const rows = usableRows(data);
  const tiles: { tileX: number; tileY: number }[] = [];
  for (let tileY = 0; tileY < rows; tileY++) {
    for (const tileX of columns) tiles.push({ tileX, tileY });
  }

  return [...melee, ...reach]
    .slice(0, tiles.length)
    .map((def, i) => ({ def, tileX: tiles[i]!.tileX, tileY: tiles[i]!.tileY }));
}

/** The whole wave's health, which is what `waveHpLeft` is a fraction of. */
export function waveHitPoints(data: GameData, seed: number, wave: number): number {
  const byId = new Map([...data.monsters.monsters, ...data.monsters.bosses].map((m) => [m.id, m]));
  let total = 0;
  for (const spec of generateWave(data, seed, wave)) {
    const def = byId.get(spec.defId);
    if (def) total += resolveMonsterStats(data, def, spec.waveNumber).hp;
  }
  return total;
}

/**
 * Stand one army in a lane, send one wave at it, and report how it went.
 */
export function runWave(
  data: GameData,
  builderId: string,
  shopping: Shopping,
  wave: number,
  seed: number,
  options: SandboxOptions = {},
): WaveOutcome {
  const maxTicks = options.maxTicks ?? DEFAULT_MAX_TICKS;
  const state = createMatch(data, { seed, teams: [{ id: 'lane', playerIds: ['p1'] }] });
  const ctx = createContext(data);
  const defs = buildDefIndex(data);
  const lane = state.lanes.lane!;

  if (options.wakeTheFortress !== true) silence(lane);

  const placed = layOut(data, builderId, shopping);
  const energyMax = stat(data.abilities.energy.max);
  for (const p of placed) lane.units.push(createUnit(state, p.def, p.tileX, p.tileY, energyMax));
  Object.assign(lane.economy.tech, options.tech ?? {});
  recomputeUnitBuffs(data, defs, lane);
  // By id, so a summon added mid-fight is never mistaken for a body that was
  // paid for, and so the ledger below can be built from the same list.
  const bought = new Map(lane.units.map((unit, i) => [unit.id, placed[i]!.def]));

  // The bodies the player PAID for, by id. A builder that summons adds units
  // to the lane mid-fight, and those are not what the gold bought.
  const paidFor = new Set(bought.keys());
  const waveHp = waveHitPoints(data, seed, wave);
  const line = leakLine(data);

  // Hand the match the build phase that ends with this wave walking in. The
  // first step flips to combat and spawns it, so the loop below is looking at
  // a lane with the wave already in it.
  state.wave = wave - 1;
  state.phase = 'build';
  state.phaseTicksLeft = 0;
  step(ctx, state);

  let leaked = 0;
  let leakedHp = 0;
  let ticks = 1;

  while (ticks < maxTicks) {
    // Taken off the board the tick they cross, so the health written down is
    // the health they would have carried to the wall.
    for (const monster of lane.monsters) {
      if (!monster.alive || monster.pos.y < line) continue;
      leaked++;
      leakedHp += Math.max(0, monster.hp);
      monster.hp = 0;
    }
    if (countLiving(lane) === 0 && lane.reserve.length === 0) break;

    step(ctx, state);
    ticks++;
  }

  // Health is read against each body's maximum AT THE END, not the maximum it
  // was created with. Buffs that raise a maximum land on the first tick of
  // combat - Thornweald's rung 2 lifts its neighbours by a third - and measuring
  // the new health against the old ceiling had that army finishing wave 2 with
  // 125% of itself. A dead body counts its whole maximum against the army and
  // nothing for it.
  let armyHpNow = 0;
  let armyHpMax = 0;
  let living = 0;
  for (const unit of lane.units) {
    if (!paidFor.has(unit.id)) continue;
    armyHpMax += unit.maxHp;
    if (unit.alive) {
      armyHpNow += Math.max(0, unit.hp);
      living += 1;
    }
  }
  const standing = lane.monsters.reduce((sum, m) => sum + (m.alive ? Math.max(0, m.hp) : 0), 0);
  const reserveHp = lane.reserve.reduce((sum, spec) => {
    const def = defs.monsters.get(spec.defId);
    return sum + (def ? resolveMonsterStats(data, def, spec.waveNumber).hp : 0);
  }, 0);

  const armyHpLeft = armyHpMax > 0 ? armyHpNow / armyHpMax : 0;
  const waveHpLeft = waveHp > 0 ? (standing + reserveHp + leakedHp) / waveHp : 0;

  const ledger: LineResult[] = [];
  for (const unit of lane.units) {
    const def = bought.get(unit.id);
    if (!def) continue;
    const cost = chainCost(data, builderId, def.rung, def.mark);
    ledger.push({
      defId: def.id,
      rung: def.rung,
      mark: def.mark,
      gold: cost.gold,
      supply: cost.supply,
      damageDealt: unit.damageDealt,
      maxHp: unit.maxHp,
      survived: unit.alive,
    });
  }

  return {
    wave,
    builderId,
    label: shoppingLabel(shopping),
    goldBudget: options.goldBudget ?? shopping.gold,
    goldSpent: shopping.gold,
    supplyUsed: shopping.supply,
    bodies: placed.length,
    cleared: leaked === 0 && standing === 0 && reserveHp === 0,
    leaked,
    armyHpLeft,
    waveHpLeft,
    margin: armyHpLeft - waveHpLeft,
    unitsLost: placed.length - living,
    seconds: ticks / TICKS_PER_SECOND,
    timedOut: ticks >= maxTicks,
    lines: ledger,
  };
}

/** Everything the wall does for free, switched off. */
function silence(lane: MatchState['lanes'][string]): void {
  const f = lane!.fortress;
  f.weaponDamage = 0;
  f.auraStrength = 0;
  f.auraRadius = 0;
  f.activeAura = null;
  f.regenPerSecond = 0;
  f.gemPayoutTicks = 0;
  // Nothing should end on the wall falling over - a leak is counted and
  // removed long before it could, and a wall that died would end the match
  // mid-measurement.
  f.maxHp = Number.MAX_SAFE_INTEGER;
  f.hp = f.maxHp;
}

// ---------------------------------------------------------------- the sweep

/**
 * One measurement: this builder, this much gold, this wave, this basket.
 *
 * Planned up front and separately from being fought, so a shard can take every
 * nth probe and the plan is identical whatever the sharding - the same split
 * the showdown tournament uses, and for the same reason.
 */
export interface Probe {
  wave: number;
  builderId: string;
  gold: number;
  shopping: Shopping;
}

export interface SweepOptions {
  waves: number[];
  /** Gold bands per wave, as fractions of that wave's nominal army value. */
  bands: number[];
  /** Most baskets fought per (wave, builder, band). Sampled if there are more. */
  cap: number;
  seed: number;
  supplyCap: number;
}

export const SWEEP_DEFAULTS: SweepOptions = {
  waves: Array.from({ length: 20 }, (_, i) => i + 1),
  bands: [0.5, 0.75, 1, 1.25],
  cap: 40,
  seed: 1,
  // As much as can be bought. A basket pays for the cap it needs out of its own
  // gold (`supplyGold`), so a high ceiling costs a cheap army nothing and lets a
  // wide one exist at all.
  supplyCap: 120,
};

/**
 * What a wave is tuned to be survivable by, in gold of army.
 *
 * Authored on the wave in `data/waves.json`; the fallback is there so an
 * unauthored wave can still be probed rather than crashing the sweep.
 */
export function nominalArmyGold(data: GameData, wave: number): number {
  const authored = data.waves.composition.find((w) => w.wave === wave);
  return num(authored?.armyGold, 200 * wave);
}

/**
 * Trim a basket list to `cap`, keeping its SHAPE rather than its first entries.
 *
 * Sorted by how much of the gold went high up the ladder, then sampled at even
 * spacing, so what comes back still runs from cheap-and-many to dear-and-few.
 * Taking the first N instead would hand back whichever corner of the search the
 * enumerator happens to emit first, and every number downstream would be about
 * that corner.
 */
export function sampleArmies(armies: Shopping[], cap: number): Shopping[] {
  if (armies.length <= cap) return armies;

  const key = (s: Shopping): number => {
    const weight = s.buys.reduce((sum, b) => sum + b.rung, 0);
    return s.buys.length > 0 ? weight / s.buys.length : 0;
  };
  const sorted = [...armies].sort((a, b) => key(a) - key(b) || a.buys.length - b.buys.length);

  const out: Shopping[] = [];
  for (let i = 0; i < cap; i++) {
    out.push(sorted[Math.floor((i * sorted.length) / cap)]!);
  }
  return out;
}

export function planProbes(data: GameData, options: SweepOptions): Probe[] {
  const probes: Probe[] = [];
  const builders = data.units.builders.filter((b) => b.complete);

  for (const wave of options.waves) {
    const nominal = nominalArmyGold(data, wave);
    for (const band of options.bands) {
      const gold = Math.round(nominal * band);
      for (const builder of builders) {
        const all = enumerateArmies(data, builder.id, gold, options.supplyCap);
        for (const shopping of sampleArmies(all, options.cap)) {
          probes.push({ wave, builderId: builder.id, gold, shopping });
        }
      }
    }
  }
  return probes;
}

export function runProbes(
  data: GameData,
  probes: readonly Probe[],
  seed: number,
  onProgress?: (done: number, total: number) => void,
): WaveOutcome[] {
  const out: WaveOutcome[] = [];
  probes.forEach((probe, i) => {
    out.push(
      runWave(data, probe.builderId, probe.shopping, probe.wave, seed, {
        goldBudget: probe.gold,
        tech: techAtWave(data, probe.builderId, probe.shopping, probe.wave),
      }),
    );
    onProgress?.(i + 1, probes.length);
  });
  return out;
}

/**
 * The tech a steady player owns going into a wave: nothing to wave 12, then
 * a level each of health, attack speed and the army's main damage type every
 * three waves - one at 13, two at 16, three at 19.
 *
 * The sweep fights with it because a real player at wave 16 owns it. Without
 * it, a wave's nominal was the gold an army needed with NO tech, and the first
 * 20-wave runs showed what that means: a player who bought tech needed about
 * two thirds of a late wave's nominal and banked the rest. The budget model
 * already takes tech out of the gold before the army (`budget.ts`), which is
 * the same thing said the other way round.
 */
export function techAtWave(
  data: GameData,
  builderId: string,
  shopping: Shopping,
  wave: number,
): Record<string, number> {
  const level = Math.max(0, Math.floor((wave - 10) / TECH_WAVES_PER_LEVEL));
  if (level === 0) return {};
  // The damage type the army spends most on, by what its bodies cost.
  const byType = new Map<string, number>();
  const chains = lines(data, builderId);
  for (const buy of shopping.buys) {
    const def = chains.get(buy.rung)?.[buy.mark - 1];
    if (!def) continue;
    const cost = chainCost(data, builderId, buy.rung, buy.mark).gold;
    byType.set(def.damageType, (byType.get(def.damageType) ?? 0) + cost);
  }
  const main = [...byType].sort((a, b) => b[1] - a[1])[0]?.[0];
  const tracks = ['def_hp', 'def_speed', ...(main ? [`dmg_${main}`] : [])];
  const out: Record<string, number> = {};
  for (const id of tracks) {
    const track = data.economy.tech.tracks.find((t) => t.id === id);
    if (track) out[id] = Math.min(level, track.levels.length);
  }
  return out;
}

export const TECH_WAVES_PER_LEVEL = 3;

/** What the tech `techAtWave` hands an army at this wave costs, damage track included. */
export function techGoldAtWave(data: GameData, wave: number): number {
  const level = Math.max(0, Math.floor((wave - 10) / TECH_WAVES_PER_LEVEL));
  let gold = 0;
  // Any damage track: they are priced alike.
  for (const id of ['def_hp', 'def_speed', 'dmg_impact']) {
    const track = data.economy.tech.tracks.find((t) => t.id === id);
    for (const l of track?.levels ?? []) if (l.level <= level) gold += l.goldCost ?? 0;
  }
  return gold;
}

/** What a wave actually is: how many bodies and how much health, in total. */
export function generateWaveSummary(
  data: GameData,
  seed: number,
  wave: number,
): { count: number; hp: number } {
  const byId = new Map([...data.monsters.monsters, ...data.monsters.bosses].map((m) => [m.id, m]));
  let count = 0;
  let hp = 0;
  for (const spec of generateWave(data, seed, wave)) {
    const def = byId.get(spec.defId);
    if (!def) continue;
    count += 1;
    hp += resolveMonsterStats(data, def, spec.waveNumber).hp;
  }
  return { count, hp };
}
