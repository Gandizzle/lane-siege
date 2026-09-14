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
    // Lattice exhausted: stack at the centre and let contact resolution sort
    // it out. It is one allocation past any wave the cap permits, so it does
    // not happen.
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
    bounty: stats.bounty,
    radius: stats.radius,
    halfWidth: 0,
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
    alive: true,
  };
}

export function createUnit(
  state: MatchState,
  def: UnitDef,
  tileX: number,
  tileY: number,
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
