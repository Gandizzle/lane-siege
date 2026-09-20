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
 * Result at the same load: 42.8 KiB/s for a player, a sixth of what the same
 * frame costs as objects. The measurement is `npm run wire`, and every figure
 * quoted in this file comes from it at §15.3's load - 40 units and 30 monsters
 * in each of four lanes, which is heavier than a supply cap actually allows.
 *
 * The Final Showdown's frame (§3.3, replaced) is the whole board for everybody,
 * since there is nothing in an arena to hide: 160 bodies at 71.7 KiB/s, which
 * is well under the 129.5 KiB/s a four-lane spectator already costs.
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
import type {
  AttackView,
  LaneView,
  MatchView,
  EntityView,
  ShowdownView,
  TeamId,
  UnitDamageView,
  UnitSpend,
} from '../sim/index.ts';

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
  /**
   * Live stat modifiers, SPARSE and flat: id, a mask of which of the four
   * differ, then one value per set bit. Each value is a hundredth of a
   * multiple of the body's definition, so 120 reads "a fifth more than
   * `units.json` says".
   *
   * Sparse AND masked, because both matter. Most bodies are unmodified, so a
   * row per body would have been the largest thing in a frame; and a body that
   * IS modified almost always has exactly one thing changed - a damage aura, a
   * slow - so a fixed five-number row would have sent three ones to say
   * nothing. Together they cost about half of what a dense row would, which is
   * what a panel whose numbers move while you watch them is worth (§14.1).
   */
  md: number[];
  /**
   * Energy in the pool, SPARSE and flat: id, energy, next id, ... Only for the
   * bodies that can spend it, which is the ten units whose top mark unlocks an
   * energy-costing ability (`EntityView.energy`). Everything else fills the
   * same pool and never spends it, so a row for it would be a number nobody
   * will ever look at.
   */
  en: number[];
  /**
   * `[hp, maxHp, destroyed, weaponTypeIndex, auraIndex, auraRadius,
   * auraStrength]`. The last two are hundredths, like every other fraction
   * here.
   */
  f: [number, number, number, number, number, number, number];
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
  /**
   * Own lane only: what each unit cost, flat and parallel to `u`: gold spent
   * this build phase, gold spent earlier, next unit's, ... Two numbers rather
   * than the refund they add up to, so the sell price is computed by the one
   * rule in `sellValue` on both ends (§11).
   *
   * This is the one place the file's own "derivation over transmission" rule is
   * knowingly not followed. The total paid for a unit IS derivable - it is the
   * sum of gold costs along its upgrade chain, which every client has - and
   * only the split by phase would then need sending. It is sent whole anyway,
   * at a measured 33.1 -> 37.1 KiB/s for a player at the §15.3 load, because
   * the derivation would quietly couple the wire format to the assumption that
   * a unit on the board was always paid for at list price. The day something
   * grants a free unit, the refund the panel quotes and the refund the
   * simulation pays would part company, and nothing would say so.
   */
  sp?: number[];
  /**
   * Own lane only: the round's damage rows, flat: unit id, unit def index,
   * damage, next unit's, ... (§14.1, added).
   *
   * Sent rather than derived, and sent for dead units too, because neither end
   * can reconstruct it: damage is the running total of what a unit landed, and
   * a client that joined mid-wave - or looked away at the wrong moment - never
   * saw the blows that made it. Rounded to whole points, since the panel shows
   * whole points.
   *
   * It costs a measured 37.3 -> 42.8 KiB/s for a player at the §15.3 load, and
   * the id is a third of that. The id is what lets a tapped row point at the
   * body on the board, which is the answer to the question a row of identical
   * silhouettes otherwise raises - worth its share.
   */
  dm?: number[];
  /** Own lane only: `[trackIndex, level]`. */
  tc?: [number, number][];
  /** Own lane only: `[upgradeIndex, level]`. */
  up?: [number, number][];
}

/**
 * One army in the Final Showdown (§3.3, replaced): `[teamIndex, seat, units]`.
 *
 * The seat rides along rather than being derived from the team index, because
 * an eliminated player leaves their spoke empty and the armies that are left
 * keep the seats they had - so the position in this array is not the seat.
 */
export type WireArmy = [number, number, WireEntity[]];

/** `[countdownTicks, armies, flat attacks]`. See `WireLane.a` on the flattening. */
export type WireShowdown = [number, WireArmy[], number[]];

export interface WireFrame {
  tk: number;
  w: number;
  /** 0 build, 1 combat, 2 showdown. */
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
  /** The Final Showdown, once it has started (§3.3, replaced). Absent before then. */
  sd?: WireShowdown;
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
  /**
   * Display names, parallel to `teamIds`, empty where nobody has said.
   *
   * Here rather than in a frame because a name does not change once a match
   * has begun, and twenty times a second is the wrong rate for a string that
   * never moves. The server re-sends the hello at kickoff, once the lobby's
   * names are final, and again on a reconnect - so a client always has them by
   * the time it has a frame to draw.
   */
  teamNames?: string[];
}

/**
 * The index tables both ends resolve against. Built from `data/`, which every
 * client and the server load identically, plus the match's team list.
 */
export interface WireTables {
  teamIds: TeamId[];
  /** Display names, parallel to `teamIds`. See `WireHello.teamNames`. */
  teamNames: string[];
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

export function buildTables(
  data: GameData,
  teamIds: TeamId[],
  seed = 0,
  teamNames: readonly string[] = [],
): WireTables {
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
    teamNames: teamIds.map((_, i) => teamNames[i] ?? ''),
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

/** Hundredths of a multiple, which is a percentage of the definition's value. */
const MOD_SCALE = 100;

/** The four fields of `StatMods`, in the order the mask's bits count them. */
const MOD_FIELDS = ['damage', 'attackSpeed', 'moveSpeed', 'maxHealth'] as const;

/** The sparse, masked modifier rows for one list of bodies. See `WireLane.md`. */
function encodeMods(entities: readonly EntityView[]): number[] {
  const out: number[] = [];
  for (const entity of entities) {
    const mods = entity.mods;
    if (!mods) continue;

    let mask = 0;
    const values: number[] = [];
    for (const [bit, field] of MOD_FIELDS.entries()) {
      const scaled = Math.round(mods[field] * MOD_SCALE);
      if (scaled === MOD_SCALE) continue;
      mask |= 1 << bit;
      values.push(scaled);
    }
    // Rounded back to unmodified: the sim thought it was worth sending and the
    // quantisation disagrees, so say nothing rather than send a row of ones.
    if (mask === 0) continue;
    out.push(entity.id, mask, ...values);
  }
  return out;
}

/** The sparse energy rows for one list of bodies. See `WireLane.en`. */
function encodeEnergy(entities: readonly EntityView[]): number[] {
  const out: number[] = [];
  for (const entity of entities) {
    if (entity.energy === null || entity.energy === undefined) continue;
    // Whole points. The pool is a hundred wide and fills at six a second, so a
    // fraction of a point is below what a bar can draw or a player can use.
    out.push(entity.id, Math.round(entity.energy));
  }
  return out;
}

/** Put the sparse energy rows back on the bodies they belong to. */
function applyEnergy(entities: EntityView[], rows: readonly number[]): void {
  if (rows.length === 0) return;
  const byId = new Map<number, EntityView>();
  for (const entity of entities) byId.set(entity.id, entity);

  for (let i = 0; i + 1 < rows.length; i += 2) {
    const entity = byId.get(rows[i]!);
    if (entity) entity.energy = rows[i + 1]!;
  }
}

/** Put the sparse rows back on the bodies they belong to. */
function applyMods(entities: EntityView[], rows: readonly number[]): void {
  if (rows.length === 0) return;
  const byId = new Map<number, EntityView>();
  for (const entity of entities) byId.set(entity.id, entity);

  let i = 0;
  while (i + 1 < rows.length) {
    const entity = byId.get(rows[i]!);
    const mask = rows[i + 1]!;
    i += 2;
    const mods = { damage: 1, attackSpeed: 1, moveSpeed: 1, maxHealth: 1 };
    for (const [bit, field] of MOD_FIELDS.entries()) {
      if ((mask & (1 << bit)) === 0) continue;
      mods[field] = (rows[i] ?? MOD_SCALE) / MOD_SCALE;
      i += 1;
    }
    // A row for a body this viewer cannot see is skipped, not dropped: the
    // cursor has already walked past its values.
    if (entity) entity.mods = mods;
  }
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
    // Both filled in from the lane's sparse rows, for the few bodies that have
    // any (`applyMods`, `applyEnergy`).
    mods: null,
    energy: null,
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

function flattenSpend(spend: readonly UnitSpend[]): number[] {
  const out: number[] = [];
  for (const entry of spend) out.push(Math.round(entry.thisPhase), Math.round(entry.earlier));
  return out;
}

function unflattenSpend(flat: readonly number[] | undefined): UnitSpend[] {
  const out: UnitSpend[] = [];
  if (!flat) return out;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    out.push({ thisPhase: flat[i]!, earlier: flat[i + 1]! });
  }
  return out;
}

function flattenDamage(rows: readonly UnitDamageView[], index: Map<string, number>): number[] {
  const out: number[] = [];
  for (const row of rows) {
    out.push(row.unitId, index.get(row.defId) ?? -1, Math.round(row.damage));
  }
  return out;
}

function unflattenDamage(flat: readonly number[] | undefined, ids: string[]): UnitDamageView[] {
  const out: UnitDamageView[] = [];
  if (!flat) return out;
  for (let i = 0; i + 2 < flat.length; i += 3) {
    out.push({ unitId: flat[i]!, defId: ids[flat[i + 1]!] ?? '', damage: flat[i + 2]! });
  }
  return out;
}

function encodeLane(lane: LaneView, tables: WireTables): WireLane {
  const out: WireLane = {
    t: tables.teamIds.indexOf(lane.teamId),
    b: tables.builderIds.indexOf(lane.builderId),
    u: lane.units.map((u) => encodeEntity(u, tables.unitIndex)),
    m: lane.monsters.map((m) => encodeEntity(m, tables.monsterIndex)),
    md: [...encodeMods(lane.units), ...encodeMods(lane.monsters)],
    en: [...encodeEnergy(lane.units), ...encodeEnergy(lane.monsters)],
    f: [
      Math.round(lane.fortress.hp),
      Math.round(lane.fortress.maxHp),
      lane.fortress.destroyed ? 1 : 0,
      tables.damageTypes.indexOf(lane.fortress.weaponDamageType),
      lane.fortress.activeAura === null ? -1 : tables.auraIds.indexOf(lane.fortress.activeAura),
      Math.round(lane.fortress.auraRadius * POSITION_SCALE),
      Math.round(lane.fortress.auraStrength * POSITION_SCALE),
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
    out.sp = flattenSpend(lane.unitSpend);
    out.dm = flattenDamage(lane.unitDamage, tables.unitIndex);
  }

  return out;
}

function decodeLane(wire: WireLane, tables: WireTables): LaneView {
  const [hp, maxHp, destroyed, weaponIndex, auraIndex, auraRadius, auraStrength] = wire.f;

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

  const units = wire.u.map((row) => decodeEntity(row, tables.unitIds, tables.unitTraits));
  const monsters = wire.m.map((row) => decodeEntity(row, tables.monsterIds, tables.monsterTraits));
  // One flat list for both kinds, matched back by id: a body is a body and
  // splitting the rows would be two arrays where one does.
  applyMods(units, wire.md ?? []);
  applyMods(monsters, wire.md ?? []);
  applyEnergy(units, wire.en ?? []);
  applyEnergy(monsters, wire.en ?? []);

  return {
    teamId: tables.teamIds[wire.t] ?? '',
    builderId: tables.builderIds[wire.b] ?? tables.builderIds[0] ?? '',
    units,
    monsters,
    fortress: {
      hp,
      maxHp,
      destroyed: destroyed === 1,
      weaponDamageType: tables.damageTypes[weaponIndex] ?? tables.damageTypes[0]!,
      activeAura: auraIndex < 0 ? null : (tables.auraIds[auraIndex] ?? null),
      auraRadius: auraRadius / POSITION_SCALE,
      auraStrength: auraStrength / POSITION_SCALE,
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
    unitSpend: unflattenSpend(wire.sp),
    unitDamage: unflattenDamage(wire.dm, tables.unitIds),
  };
}

const PHASE_CODES = ['build', 'combat', 'showdown'] as const;

function encodeShowdown(showdown: ShowdownView, tables: WireTables): WireShowdown {
  return [
    showdown.countdown,
    showdown.armies.map(
      (army) =>
        [
          tables.teamIds.indexOf(army.teamId),
          army.seat,
          army.units.map((u) => encodeEntity(u, tables.unitIndex)),
        ] as WireArmy,
    ),
    flattenAttacks(showdown.attacks),
  ];
}

function decodeShowdown(wire: WireShowdown, tables: WireTables): ShowdownView {
  const [countdown, armies, attacks] = wire;
  return {
    countdown,
    armies: armies.map(([teamIndex, seat, units]) => ({
      teamId: tables.teamIds[teamIndex] ?? '',
      seat,
      units: units.map((row) => decodeEntity(row, tables.unitIds, tables.unitTraits)),
    })),
    attacks: unflattenAttacks(attacks),
  };
}

export function encodeFrame(view: MatchView, tables: WireTables): WireFrame {
  const frame: WireFrame = {
    tk: view.tick,
    w: view.wave,
    p: Math.max(0, PHASE_CODES.indexOf(view.phase)),
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
  if (view.showdown) frame.sd = encodeShowdown(view.showdown, tables);
  return frame;
}

export function decodeFrame(frame: WireFrame, tables: WireTables): MatchView {
  const watching: Record<TeamId, LaneView> = {};
  for (const wire of frame.wl) {
    const lane = decodeLane(wire, tables);
    watching[lane.teamId] = lane;
  }

  return {
    teamId: tables.teamIds[frame.me] ?? '',
    teamName: tables.teamNames[frame.me] ?? '',
    seed: tables.seed,
    tick: frame.tk,
    wave: frame.w,
    phase: PHASE_CODES[frame.p] ?? 'build',
    phaseTicksLeft: frame.pl,
    finished: (frame.fl & 1) === 1,
    eliminated: (frame.fl & 2) === 2,
    placement: frame.pc === 0 ? null : frame.pc,
    lane: frame.l ? decodeLane(frame.l, tables) : null,
    opponents: frame.o.map(
      ([teamIndex, hp, maxHp, eliminated, placement, watchingFlag, visionTicksLeft]) => ({
        teamId: tables.teamIds[teamIndex] ?? '',
        // Not in the frame: a name is constant for a match and arrives with
        // the hello (`WireHello.teamNames`).
        name: tables.teamNames[teamIndex] ?? '',
        fortressHp: hp,
        fortressMaxHp: maxHp,
        eliminated: eliminated === 1,
        placement: placement === 0 ? null : placement,
        watching: watchingFlag === 1,
        visionTicksLeft,
      }),
    ),
    watching,
    showdown: frame.sd ? decodeShowdown(frame.sd, tables) : null,
  };
}
