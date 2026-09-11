/**
 * Entity creation. Keeps the shape of a Monster or a DefensiveUnit in one
 * place, so tick.ts and the command layer cannot drift apart on it.
 *
 * §15.3 asks for pooled objects and no per-frame allocation. Spawning is not a
 * per-frame event - it happens on a wave boundary or a build command - so these
 * allocate honestly. The free-list belongs here when it arrives, behind the
 * same two functions.
 */

import type { GameData, UnitDef } from '../data/schema.ts';
import type { DefIndex } from './defs.ts';
import { stat } from './defs.ts';
import { MONSTER_RETARGET_TICKS } from './constants.ts';
import { resolveMonsterStats, type SpawnSpec } from './waves.ts';
import type { DefensiveUnit, EntityId, Lane, MatchState, Monster } from './types.ts';

function nextId(state: MatchState): EntityId {
  return state.nextEntityId++;
}

/**
 * Where a monster enters the lane. The spawn zone sits above the build grid, so
 * y is negative; x is spread across the lane width by index rather than at
 * random, which keeps a wave's entry pattern deterministic without spending RNG.
 */
export function spawnPosition(data: GameData, index: number): { x: number; y: number } {
  const width = data.lane.buildZone.width;
  const row = Math.floor(index / width);
  return {
    x: (index % width) + 0.5,
    // Stagger into rows above the lane. Without this a wave larger than the
    // lane is wide starts with several monsters on the exact same point, which
    // reads as them passing through each other.
    y: -(data.lane.spawnZoneDepth * 0.5) - row * (data.lane.monsterRadius * 2.2),
  };
}

export function createMonster(
  state: MatchState,
  data: GameData,
  defs: DefIndex,
  spec: SpawnSpec,
  index: number,
): Monster | null {
  const def = defs.monsters.get(spec.defId);
  if (!def) return null;

  const stats = resolveMonsterStats(data, def, spec.waveNumber);
  const pos = spawnPosition(data, index);

  return {
    id: nextId(state),
    defId: spec.defId,
    damage: stats.damage,
    attackSpeed: stats.attackSpeed,
    moveSpeed: stats.moveSpeed,
    range: stats.range,
    bounty: stats.bounty,
    waveNumber: spec.waveNumber,
    pos: { x: pos.x, y: pos.y },
    hp: stats.hp,
    maxHp: stats.hp,
    armour: def.armour,
    damageType: def.damageType,
    cooldown: 0,
    targetId: null,
    retargetIn: 0,
    stuckAnchor: { x: pos.x, y: pos.y },
    stuckTicks: 0,
    isStuck: false,
    besieging: false,
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
    stuckAnchor: { x: pos.x, y: pos.y },
    stuckTicks: 0,
    isStuck: false,
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
    const monster = createMonster(state, data, defs, spec, lane.monsters.length);
    if (monster) {
      monster.retargetIn = MONSTER_RETARGET_TICKS;
      lane.monsters.push(monster);
    }
  }
}

export function countLiving(lane: Lane): number {
  let count = 0;
  for (const monster of lane.monsters) if (monster.alive) count++;
  return count;
}
