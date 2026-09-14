/**
 * The wire format. DESIGN.md §15.1, §15.2.
 *
 * The server runs the simulation and each client is sent what it is allowed to
 * see (§12). A `MatchView` is the right SHAPE for that but the wrong size:
 * serialised as objects-with-keys it measured 144 KiB/s for one player and
 * 537 KiB/s for a spectator at the §15.3 load, which no phone should be asked
 * to carry.
 *
 * So a frame is rows of numbers instead. Three things do the work:
 *
 *   - **Indices instead of strings.** Every client loads the same `data/`, so a
 *     definition can travel as its position in that file. `"hammer_t3"` is nine
 *     bytes; `7` is one.
 *   - **Quantised positions.** Tile coordinates to the nearest hundredth, which
 *     is a fortieth of a body radius and far finer than a pixel at any phone
 *     size. HP as a byte of fraction, which is all a health bar reads.
 *   - **Derivation over transmission.** Armour, damage type and body radius are
 *     properties of the definition, so sending the definition sends them too.
 *
 * Result at the same load: about 9 KiB/s for a player. The measurement is
 * `npm run wire`.
 *
 * WHAT IS NOT HERE, AND WHY
 *
 * The tempting alternative is to send the command stream and have every client
 * simulate: the simulation is deterministic (§15.1), so a few dozen bytes a
 * tick would do. It does not work here, because lanes are not independent. Two
 * things couple them: enrage clocks run per WAVE and stop when that wave's last
 * monster dies in ANY lane (§8), and combat ends only when every living lane is
 * clear (§3.2, amended). A client would therefore need to know what is
 * happening in lanes that §12 forbids it from seeing. Snapshots it is.
 */

import type { GameData } from '../data/schema.ts';
import type { ArmourType, DamageType } from '../data/schema.ts';
import { FORTRESS_UPGRADE_IDS } from '../sim/index.ts';
import type { AttackView, LaneView, MatchView, EntityView, TeamId } from '../sim/index.ts';

/**
 * The Colyseus room type. Shared, because a client asking for a name the server
 * did not define fails with a puzzling "room not found" rather than anything
 * about the mismatch.
 */
export const ROOM_NAME = 'lane_siege';

/** Positions travel as hundredths of a tile. */
const POSITION_SCALE = 100;
/** Health travels as a byte of fraction. */
const HEALTH_SCALE = 255;

/** `[id, defIndex, x, y, hp]`. */
export type WireEntity = [number, number, number, number, number];

export interface WireLane {
  /** Team index. */
  t: number;
  /** Builder index (§7.1). */
  b: number;
  u: WireEntity[];
  m: WireEntity[];
  /** `[hp, maxHp, destroyed, weaponTypeIndex, auraIndex, auraRadius]`. */
  f: [number, number, number, number, number, number];
  /** Reserve count (§8.1). */
  r: number;
  /** `[sendIndex, fromTeamIndex]` per send received. */
  s: [number, number][];
  /**
   * Blows landed this tick, flat: attacker id, target id, attacker id, ... A
   * flat array rather than pairs because msgpack charges per array, and at a
   * busy tick there are dozens of these.
   */
  a: number[];
  /** Own lane only: `[gold, gems, supplyUsed, supplyCap, passiveIncome]`. */
  e?: [number, number, number, number, number];
  /** Own lane only: `[trackIndex, level]`. */
  tc?: [number, number][];
  /** Own lane only: `[upgradeIndex, level]`. */
  up?: [number, number][];
}

export interface WireFrame {
  tk: number;
  w: number;
  /** 0 build, 1 combat. */
  p: number;
  pl: number;
  /** Bit 0 finished, bit 1 eliminated. */
  fl: number;
  /** Placement, 0 when not yet placed. */
  pc: number;
  /** Own team index. */
  me: number;
  l: WireLane | null;
  /**
   * `[teamIndex, fortressHp, fortressMaxHp, eliminated, placement, watching,
   * visionTicksLeft]` per opponent.
   */
  o: [number, number, number, number, number, number, number][];
  wl: WireLane[];
}

/**
 * Sent once when a client joins, because none of it changes afterwards.
 *
 * The team list is what makes indices meaningful, so it has to arrive before
 * the first frame.
 */
export interface WireHello {
  teamIds: TeamId[];
  teamId: TeamId;
  seed: number;
}

/**
 * The index tables both ends resolve against. Built from `data/`, which every
 * client and the server load identically, plus the match's team list.
 */
export interface WireTables {
  teamIds: TeamId[];
  /**
   * The match seed. Public and constant (§9.2), so it arrives once with the
   * hello rather than 20 times a second in every frame.
   */
  seed: number;
  unitIds: string[];
  monsterIds: string[];
  sendIds: string[];
  builderIds: string[];
  damageTypes: DamageType[];
  armourTypes: ArmourType[];
  auraIds: string[];
  techTrackIds: string[];
  fortressUpgradeIds: string[];
  /** defId -> index, and back, for each kind. */
  unitIndex: Map<string, number>;
  monsterIndex: Map<string, number>;
  /** Everything derivable from a definition, so it never goes on the wire. */
  unitTraits: { armour: ArmourType; damageType: DamageType; radius: number }[];
  monsterTraits: { armour: ArmourType; damageType: DamageType; radius: number }[];
}

function num(value: number | null, fallback: number): number {
  return value === null || !Number.isFinite(value) ? fallback : value;
}

export function buildTables(data: GameData, teamIds: TeamId[], seed = 0): WireTables {
  const unitIds = data.units.units.map((u) => u.id);
  const monsterIds = [
    ...data.monsters.monsters.map((m) => m.id),
    ...data.monsters.bosses.map((b) => b.id),
  ];

  const unitTraits = data.units.units.map((u) => ({
    armour: u.armour,
    damageType: u.damageType,
    radius: num(u.bodyRadius, 0.34),
  }));
  const monsterTraits = [...data.monsters.monsters, ...data.monsters.bosses].map((m) => ({
    armour: m.armour,
    damageType: m.damageType,
    radius: num(m.bodyRadius, 0.3),
  }));

  return {
    teamIds: [...teamIds],
    seed,
    unitIds,
    monsterIds,
    sendIds: data.sends.sends.map((s) => s.id),
    builderIds: data.units.builders.map((b) => b.id),
    damageTypes: [...data.matrix.damageTypes],
    armourTypes: [...data.matrix.armourTypes],
    auraIds: [...data.fortress.auras.types],
    techTrackIds: data.economy.tech.tracks.map((t) => t.id),
    fortressUpgradeIds: [...FORTRESS_UPGRADE_IDS],
    unitIndex: new Map(unitIds.map((id, i) => [id, i])),
    monsterIndex: new Map(monsterIds.map((id, i) => [id, i])),
    unitTraits,
    monsterTraits,
  };
}

function encodeEntity(entity: EntityView, index: Map<string, number>): WireEntity {
  return [
    entity.id,
    index.get(entity.defId) ?? -1,
    Math.round(entity.x * POSITION_SCALE),
    Math.round(entity.y * POSITION_SCALE),
    Math.round(entity.hpFraction * HEALTH_SCALE),
  ];
}

function decodeEntity(
  row: WireEntity,
  ids: string[],
  traits: { armour: ArmourType; damageType: DamageType; radius: number }[],
): EntityView {
  const [id, defIndex, x, y, hp] = row;
  const trait = traits[defIndex];
  return {
    id,
    defId: ids[defIndex] ?? '',
    x: x / POSITION_SCALE,
    y: y / POSITION_SCALE,
    radius: trait ? trait.radius : 0.3,
    armour: trait ? trait.armour : ('flesh' as ArmourType),
    damageType: trait ? trait.damageType : ('impact' as DamageType),
    hpFraction: hp / HEALTH_SCALE,
  };
}

function flattenAttacks(attacks: readonly AttackView[]): number[] {
  const out: number[] = [];
  for (const attack of attacks) out.push(attack.attackerId, attack.targetId);
  return out;
}

function unflattenAttacks(flat: readonly number[] | undefined): AttackView[] {
  const out: AttackView[] = [];
  if (!flat) return out;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    out.push({ attackerId: flat[i]!, targetId: flat[i + 1]! });
  }
  return out;
}

function encodeLane(lane: LaneView, tables: WireTables): WireLane {
  const out: WireLane = {
    t: tables.teamIds.indexOf(lane.teamId),
    b: tables.builderIds.indexOf(lane.builderId),
    u: lane.units.map((u) => encodeEntity(u, tables.unitIndex)),
    m: lane.monsters.map((m) => encodeEntity(m, tables.monsterIndex)),
    f: [
      Math.round(lane.fortress.hp),
      Math.round(lane.fortress.maxHp),
      lane.fortress.destroyed ? 1 : 0,
      tables.damageTypes.indexOf(lane.fortress.weaponDamageType),
      lane.fortress.activeAura === null ? -1 : tables.auraIds.indexOf(lane.fortress.activeAura),
      Math.round(lane.fortress.auraRadius * POSITION_SCALE),
    ],
    r: lane.reserveCount,
    s: lane.sendLog.map(
      (entry) =>
        [tables.sendIds.indexOf(entry.sendId), tables.teamIds.indexOf(entry.fromTeamId)] as [
          number,
          number,
        ],
    ),
    a: flattenAttacks(lane.attacks),
  };

  if (lane.economy) {
    const e = lane.economy;
    out.e = [
      Math.round(e.gold),
      Math.round(e.gems),
      e.supplyUsed,
      e.supplyCap,
      Math.round(e.passiveIncome),
    ];
    out.tc = Object.entries(e.tech).map(
      ([id, level]) => [tables.techTrackIds.indexOf(id), level] as [number, number],
    );
    out.up = Object.entries(e.upgrades).map(
      ([id, level]) => [tables.fortressUpgradeIds.indexOf(id), level] as [number, number],
    );
  }

  return out;
}

function decodeLane(wire: WireLane, tables: WireTables): LaneView {
  const [hp, maxHp, destroyed, weaponIndex, auraIndex, auraRadius] = wire.f;

  const economy = wire.e
    ? {
        gold: wire.e[0],
        gems: wire.e[1],
        supplyUsed: wire.e[2],
        supplyCap: wire.e[3],
        passiveIncome: wire.e[4],
        tech: Object.fromEntries(
          (wire.tc ?? [])
            .filter(([index]) => index >= 0)
            .map(([index, level]) => [tables.techTrackIds[index]!, level]),
        ),
        upgrades: Object.fromEntries(
          (wire.up ?? [])
            .filter(([index]) => index >= 0)
            .map(([index, level]) => [tables.fortressUpgradeIds[index]!, level]),
        ),
      }
    : null;

  return {
    teamId: tables.teamIds[wire.t] ?? '',
    builderId: tables.builderIds[wire.b] ?? tables.builderIds[0] ?? '',
    units: wire.u.map((row) => decodeEntity(row, tables.unitIds, tables.unitTraits)),
    monsters: wire.m.map((row) => decodeEntity(row, tables.monsterIds, tables.monsterTraits)),
    fortress: {
      hp,
      maxHp,
      destroyed: destroyed === 1,
      weaponDamageType: tables.damageTypes[weaponIndex] ?? tables.damageTypes[0]!,
      activeAura: auraIndex < 0 ? null : (tables.auraIds[auraIndex] ?? null),
      auraRadius: auraRadius / POSITION_SCALE,
    },
    economy,
    reserveCount: wire.r,
    sendLog: wire.s
      .filter(([sendIndex]) => sendIndex >= 0)
      .map(([sendIndex, fromIndex]) => ({
        sendId: tables.sendIds[sendIndex]!,
        fromTeamId: tables.teamIds[fromIndex] ?? '',
      })),
    attacks: unflattenAttacks(wire.a),
  };
}

export function encodeFrame(view: MatchView, tables: WireTables): WireFrame {
  return {
    tk: view.tick,
    w: view.wave,
    p: view.phase === 'build' ? 0 : 1,
    pl: view.phaseTicksLeft,
    fl: (view.finished ? 1 : 0) | (view.eliminated ? 2 : 0),
    pc: view.placement ?? 0,
    me: tables.teamIds.indexOf(view.teamId),
    l: view.lane ? encodeLane(view.lane, tables) : null,
    o: view.opponents.map(
      (o) =>
        [
          tables.teamIds.indexOf(o.teamId),
          Math.round(o.fortressHp),
          Math.round(o.fortressMaxHp),
          o.eliminated ? 1 : 0,
          o.placement ?? 0,
          o.watching ? 1 : 0,
          o.visionTicksLeft,
        ] as [number, number, number, number, number, number, number],
    ),
    wl: Object.values(view.watching).map((lane) => encodeLane(lane, tables)),
  };
}

export function decodeFrame(frame: WireFrame, tables: WireTables): MatchView {
  const watching: Record<TeamId, LaneView> = {};
  for (const wire of frame.wl) {
    const lane = decodeLane(wire, tables);
    watching[lane.teamId] = lane;
  }

  return {
    teamId: tables.teamIds[frame.me] ?? '',
    seed: tables.seed,
    tick: frame.tk,
    wave: frame.w,
    phase: frame.p === 0 ? 'build' : 'combat',
    phaseTicksLeft: frame.pl,
    finished: (frame.fl & 1) === 1,
    eliminated: (frame.fl & 2) === 2,
    placement: frame.pc === 0 ? null : frame.pc,
    lane: frame.l ? decodeLane(frame.l, tables) : null,
    opponents: frame.o.map(
      ([teamIndex, hp, maxHp, eliminated, placement, watchingFlag, visionTicksLeft]) => ({
        teamId: tables.teamIds[teamIndex] ?? '',
        fortressHp: hp,
        fortressMaxHp: maxHp,
        eliminated: eliminated === 1,
        placement: placement === 0 ? null : placement,
        watching: watchingFlag === 1,
        visionTicksLeft,
      }),
    ),
    watching,
  };
}
