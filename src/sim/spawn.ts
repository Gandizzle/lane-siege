/**
 * Entity creation, and where a wave enters the lane.
 *
 * Keeps the shape of a Monster or a DefensiveUnit in one place, so tick.ts and
 * the command layer cannot drift apart on it.
 *
 * §15.3 asks for pooled objects and no per-frame allocation. Spawning is not a
 * per-frame event - it happens on a wave boundary or a build command - so these
 * allocate honestly. The free-list belongs here when it arrives, behind the
 * same functions.
 *
 * THE CLUMP
 *
 * A wave spawns as one packed group at the centre of the spawn zone, on a
 * hexagonal lattice ordered outward from the middle. Hexagonal because that is
 * how circles pack; ordered from the middle so the first monsters are the
 * innermost and a boss, which spawns first, takes the centre and clears the
 * lattice points it covers. Nothing overlaps at spawn, which matters more than
 * it sounds: a body that starts inside another has to be pushed out before it
 * can do anything, and thirty bodies pushed out of one point is a burst.
 *
 * No RNG is spent on positions. The lattice is a pure function of the lane and
 * the wave, so an entry pattern is reproducible from the seed alone (§9.2).
 */

import type { GameData, UnitDef } from '../data/schema.ts';
import type { DefIndex } from './defs.ts';
import { stat } from './defs.ts';
import { freshAbilityState } from './status.ts';
import { resolveMonsterStats, type SpawnSpec } from './waves.ts';
import type { DefensiveUnit, EntityId, Lane, MatchState, Monster, Vec2 } from './types.ts';

function nextId(state: MatchState): EntityId {
  return state.nextEntityId++;
}

/** Clearance left between packed bodies, in tiles, so the clump is not welded. */
const PACK_GAP = 0.03;

/** √3/2: the row pitch of a hexagonal lattice with unit spacing. */
const HEX_ROW = 0.8660254037844386;

/** The clump is wider than it is tall, because the spawn zone is. */
const CLUMP_ASPECT = 1.6;

/** The centre of the spawn zone in tile space. */
export function spawnCentre(data: GameData): Vec2 {
  return { x: data.lane.buildZone.width / 2, y: -data.lane.spawnZoneDepth / 2 };
}

/** The smallest monster in the game sets the lattice pitch. */
function latticePitch(data: GameData): number {
  let smallest = Infinity;
  for (const def of data.monsters.monsters) {
    const r = def.bodyRadius ?? 0.3;
    if (r < smallest) smallest = r;
  }
  if (!Number.isFinite(smallest)) smallest = 0.3;
  return smallest * 2 + PACK_GAP;
}

/**
 * Could a body of `radius` stand at this lattice point and still be wholly
 * inside the spawn zone?
 *
 * The lattice is ten rings deep, which is far more than any wave needs and
 * far more than the zone holds - so for a large enough clump the outer points
 * are outside the lane entirely, and a body placed there spawns out of bounds
 * and is shoved back in by contact resolution. A wave that has to be pushed
 * into the lane before it can walk is a wave that arrives as a burst.
 *
 * The spawn zone specifically, not the whole lane: a wave forms up on the
 * attacker's own ground and walks in from there. The defence stops at the
 * grid's edge (`unitLane` in context.ts), so the two never start interleaved.
 */
function insideSpawnZone(data: GameData, point: Vec2, radius: number): boolean {
  const lane = data.lane;
  return (
    point.x >= radius &&
    point.x <= lane.buildZone.width - radius &&
    point.y >= -lane.spawnZoneDepth + radius &&
    point.y <= -radius
  );
}

const latticeCache = new Map<string, Vec2[]>();

/**
 * Lattice points around the spawn centre, nearest first. Cached per lane
 * geometry: it depends on nothing that changes during a match.
 */
function spawnLattice(data: GameData): Vec2[] {
  const centre = spawnCentre(data);
  const pitch = latticePitch(data);
  const key = `${centre.x}:${centre.y}:${pitch}`;
  const cached = latticeCache.get(key);
  if (cached) return cached;

  // Enough rings for any wave the cap allows, plus a wide margin.
  const rings = 10;
  const points: { x: number; y: number; key: number; q: number; r: number }[] = [];
  for (let q = -rings; q <= rings; q++) {
    for (let r = -rings; r <= rings; r++) {
      if (Math.abs(q + r) > rings) continue;
      const x = pitch * (q + r / 2);
      const y = pitch * r * HEX_ROW;
      points.push({
        x: centre.x + x,
        y: centre.y + y,
        key: x * x + y * CLUMP_ASPECT * (y * CLUMP_ASPECT),
        q,
        r,
      });
    }
  }
  // A total order: elliptical distance, then row, then column.
  points.sort((a, b) => a.key - b.key || a.r - b.r || a.q - b.q);

  const lattice = points.map((p) => ({ x: p.x, y: p.y }));
  latticeCache.set(key, lattice);
  return lattice;
}

/**
 * A position for every monster in a wave, in spawn order, none overlapping.
 *
 * Bodies wider than the lattice pitch - bosses - take a point and consume every
 * point they cover, so the next body lands clear of them.
 */
export function placeWave(data: GameData, radii: readonly number[]): Vec2[] {
  const lattice = spawnLattice(data);
  const pitch = latticePitch(data);
  const taken: { x: number; y: number; radius: number }[] = [];
  const positions: Vec2[] = [];

  for (const radius of radii) {
    let chosen: Vec2 | null = null;
    for (const point of lattice) {
      if (!insideSpawnZone(data, point, radius)) continue;
      let clear = true;
      for (const t of taken) {
        const need = t.radius + radius + PACK_GAP;
        const dx = point.x - t.x;
        const dy = point.y - t.y;
        if (dx * dx + dy * dy < need * need) {
          clear = false;
          break;
        }
      }
      if (clear) {
        chosen = point;
        break;
      }
    }
    // The zone is full: stack at the centre and let contact resolution sort it
    // out. That takes a wave far larger than the cap permits, so in a match it
    // does not happen.
    const at = chosen ?? spawnCentre(data);
    taken.push({ x: at.x, y: at.y, radius: Math.max(radius, pitch / 2) });
    positions.push({ x: at.x, y: at.y });
  }

  return positions;
}

/**
 * Where a single late arrival - one admitted from the reserve - stands: the
 * innermost lattice point not currently under a living monster.
 */
export function reservePosition(data: GameData, radius: number, living: readonly Monster[]): Vec2 {
  for (const point of spawnLattice(data)) {
    if (!insideSpawnZone(data, point, radius)) continue;
    let clear = true;
    for (const monster of living) {
      if (!monster.alive) continue;
      const need = monster.radius + radius + PACK_GAP;
      const dx = point.x - monster.pos.x;
      const dy = point.y - monster.pos.y;
      if (dx * dx + dy * dy < need * need) {
        clear = false;
        break;
      }
    }
    if (clear) return { x: point.x, y: point.y };
  }
  return spawnCentre(data);
}

export function createMonster(
  state: MatchState,
  data: GameData,
  defs: DefIndex,
  spec: SpawnSpec,
  pos: Vec2,
): Monster | null {
  const def = defs.monsters.get(spec.defId);
  if (!def) return null;

  const stats = resolveMonsterStats(data, def, spec.waveNumber);

  return {
    id: nextId(state),
    defId: spec.defId,
    damage: stats.damage,
    attackSpeed: stats.attackSpeed,
    moveSpeed: stats.moveSpeed,
    range: stats.range,
    // §11.1, replaced: the spec carries the bounty, because a wave divides a
    // fixed pool and a sent body is priced against what its sender paid
    // (waves.ts). The definition's own number is only a weight now, and is the
    // fallback for a spec made without one - tests, mostly.
    bounty: spec.bounty ?? stats.bounty,
    killedByFortress: false,
    radius: stats.radius,
    halfWidth: 0,
    monster: true,
    // §3.4, decided: a boss and its escort pass through each other (motion.ts).
    phasesMonsters: def.isBoss === true,
    waveNumber: spec.waveNumber,
    pos: { x: pos.x, y: pos.y },
    hp: stats.hp,
    maxHp: stats.hp,
    armour: def.armour,
    damageType: def.damageType,
    cooldown: 0,
    targetId: null,
    engaged: false,
    settled: false,
    pathCost: 0,
    fieldCell: -1,
    moveX: 0,
    moveY: 0,
    sendId: spec.sendId ?? null,
    ...freshAbilityState(stat(data.abilities.energy.max)),
    baseMaxHp: stats.hp,
    alive: true,
  };
}

export function createUnit(
  state: MatchState,
  def: UnitDef,
  tileX: number,
  tileY: number,
  /**
   * The energy ceiling from `abilities.json`. A fresh body starts FULL.
   *
   * Required rather than defaulted. It used to default to zero, and the one
   * caller that builds a unit a player paid for did not pass it - so every
   * unit was built with an empty pool and spent the first seventeen seconds of
   * its life filling one. A default that is wrong for the real call site is a
   * bug waiting on somebody to notice.
   */
  energyMax: number,
): DefensiveUnit {
  const pos = { x: tileX + 0.5, y: tileY + 0.5 };

  return {
    id: nextId(state),
    defId: def.id,
    homeTileX: tileX,
    homeTileY: tileY,
    pos,
    moveSpeed: stat(def.moveSpeed),
    radius: stat(def.bodyRadius),
    halfWidth: 0,
    monster: false,
    phasesMonsters: false,
    range: stat(def.range),
    // What it cost is stamped on by the command that bought it (apply.ts):
    // creation does not know whether this is a purchase or a test fixture.
    spend: { thisPhase: 0, earlier: 0 },
    supplyPaid: 0,
    engaged: false,
    settled: false,
    pathCost: 0,
    fieldCell: -1,
    moveX: 0,
    moveY: 0,
    hp: stat(def.hp),
    maxHp: stat(def.hp),
    armour: def.armour,
    damageType: def.damageType,
    techDamage: 1,
    techAttackSpeed: 1,
    cooldown: 0,
    targetId: null,
    damageDealt: 0,
    ...freshAbilityState(energyMax),
    baseMaxHp: stat(def.hp),
    alive: true,
  };
}

/**
 * §8.1: a lane holds at most `maxConcurrentMonsters`. The excess waits in
 * reserve and enters one at a time as active monsters die, each arriving into
 * its own wave's current enrage state - which is automatic here, because enrage
 * is read from the wave's clock rather than stamped onto the monster.
 */
export function admitFromReserve(
  state: MatchState,
  data: GameData,
  defs: DefIndex,
  lane: Lane,
): void {
  const cap = data.waves.maxConcurrentMonsters;

  while (lane.reserve.length > 0 && countLiving(lane) < cap) {
    const spec = lane.reserve.shift();
    if (!spec) break;
    const def = defs.monsters.get(spec.defId);
    if (!def) continue;

    const radius = resolveMonsterStats(data, def, spec.waveNumber).radius;
    const monster = createMonster(
      state,
      data,
      defs,
      spec,
      reservePosition(data, radius, lane.monsters),
    );
    if (monster) lane.monsters.push(monster);
  }
}

export function countLiving(lane: Lane): number {
  let count = 0;
  for (const monster of lane.monsters) if (monster.alive) count++;
  return count;
}
