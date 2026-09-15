/**
 * Fog of war. DESIGN.md §12.
 *
 * §12 left OPEN "exactly what is public" and suggested a minimum of fortress HP
 * and alive/eliminated status. That minimum is what this implements, and the
 * rule is stated once, here, as a set of types:
 *
 *   - Your own lane: everything.
 *   - An opponent's lane: fortress HP and whether they are still alive. That is
 *     all. Not their army, not their gold, not their tech.
 *   - A lane you bought sight of with a send (§11.5): what is HAPPENING in it -
 *     the units, the monsters, the fortress, the aura that is lit. Not what they
 *     have bought.
 *   - Once you are eliminated: the same for every lane, because §13 says an
 *     eliminated player may stay and spectate.
 *
 * HOW MUCH OF THAT IS SWITCHED ON
 *
 * `LaneVisibility` decides which of those rules is in force, because §12's fog
 * is a design lever rather than a law of the game and the interesting question
 * is how much information a player should have, not how little. The rules above
 * are `granted`; `combat` opens every lane while a wave is running and closes
 * them again for the build phase, so you watch the fight and build in private;
 * `always` never closes them. The setting lives in data (`lane.opponentLanes`)
 * and the filter is the same code either way, so turning fog back on is a
 * one-word change rather than a re-plumbing.
 *
 * What is never public under ANY setting is the balance
 * sheet: gold, gems, supply, tech levels, fortress upgrade levels. Seeing
 * someone's army is a tactical read a send can buy. Seeing their bank balance
 * and their upgrade sheet tells you what they are about to do, and nothing in
 * §11 or §12 offers a way to earn that.
 *
 * WHY A PROJECTION AND NOT A FILTERED REFERENCE
 *
 * A view holds its own flat data rather than pointing into `MatchState`. Two
 * reasons, and the first is the important one:
 *
 *   1. Nothing can leak by accident. A field added to `Monster` or `Lane` next
 *      month does not silently become visible to opponents, because it has to
 *      be copied here to appear at all - and the compiler will not let a view
 *      be built from a lane it has no field for.
 *   2. It is what goes on the wire. At M4 the server runs the simulation and
 *      sends each client its view (§15.1, §15.2). Sim objects are far too fat
 *      for that: serialised whole they measured 558 KiB/s for one player and
 *      2.2 MiB/s for a spectator. This shape is what `src/net/protocol.ts`
 *      quantises down to roughly 9 KiB/s.
 *
 * Building a view allocates, which §15.3 forbids - inside the tick. This is
 * outside it: one projection per tick at 20Hz, not per frame at 60, and the
 * simulation's own hot loop stays allocation-free.
 */

import type { ArmourType, DamageType } from '../data/schema.ts';
import type { Attack, EntityId, Lane, MatchState, Phase, TeamId, UnitSpend } from './types.ts';

/**
 * One drawable body. Everything §14.2 needs to pick a silhouette, a fill and a
 * size, and nothing else.
 *
 * `defId` stands in for the rest: tier, and therefore size and pips, is a
 * property of the definition, and tier upgrades swap the definition in place
 * (§7.3). Every viewer has the same `data/`, so sending the id is enough.
 */
export interface EntityView {
  id: EntityId;
  defId: string;
  x: number;
  y: number;
  radius: number;
  /** §14.2: silhouette. */
  armour: ArmourType;
  /** §14.2: fill colour. */
  damageType: DamageType;
  /** 0 to 1. A fraction rather than absolute HP: it is all the bar needs. */
  hpFraction: number;
}

/** What a viewer may see of a fortress. */
export interface FortressView {
  hp: number;
  maxHp: number;
  destroyed: boolean;
  /** Public: the weapon visibly fires in this colour (§10.1). */
  weaponDamageType: DamageType;
  /**
   * Public: an active aura is drawn as a ring around the fortress (§10.1).
   *
   * All three together, because all three are visible. The radius is where the
   * ring is, and the strength is how hard the effect inside it reads - §10.1
   * upgrades them separately on purpose, and a player choosing between Aura
   * Power and Aura Radius can only see that choice if both show.
   */
  activeAura: string | null;
  auraRadius: number;
  auraStrength: number;
}

/**
 * What one unit has landed this round (§14.1, added), for the damage panel.
 *
 * A list of its own rather than a field on `EntityView`, for two reasons. A
 * unit that died partway through the wave still did the damage it did, and
 * `units` holds only the living, so a parallel array would drop exactly the
 * rows a player most wants to see. And it is own-lane information: what your
 * line is worth is a read on your own board, not a thing a send should buy.
 */
export interface UnitDamageView {
  unitId: EntityId;
  /** Carries the tier, and so the pips the panel draws (§7.3, §14.2). */
  defId: string;
  damage: number;
}

/** Your own balance sheet. Never anyone else's. */
export interface EconomyView {
  gold: number;
  gems: number;
  supplyUsed: number;
  supplyCap: number;
  passiveIncome: number;
  tech: Record<string, number>;
  /** Fortress upgrade levels, which are a purchase record like any other. */
  upgrades: Record<string, number>;
}

export interface LaneView {
  teamId: TeamId;
  /**
   * Which roster this lane builds from (§7.1). Public: what somebody is
   * building is visible the moment a unit of theirs is, and the counter hints
   * (§9.3) are per-builder, so the UI needs it for its own lane regardless.
   */
  builderId: string;
  units: EntityView[];
  monsters: EntityView[];
  fortress: FortressView;
  /** Present only for your own lane. */
  economy: EconomyView | null;
  /** §8.1: how many monsters are still queued to enter. */
  reserveCount: number;
  /** §11.5: who has sent what at this lane, for the incoming-attack notice. */
  sendLog: { sendId: string; fromTeamId: TeamId }[];
  /**
   * Blows landed on this tick, for the renderer to animate (§14.2). Cosmetic
   * and complete: a lane you can see shows every swing in it, because hiding
   * some would be a different lie from the one fog of war tells.
   */
  attacks: AttackView[];
  /**
   * Own lane only: what has been paid for each unit, parallel to `units`.
   *
   * The two raw numbers rather than the refund they add up to, so the client
   * prices a sale with the same `sellValue` the simulation charges - one rule
   * in one place, and the panel cannot drift from what the button does. It is
   * per unit because selection is a client-side thing that changes between
   * ticks, and a price that needed a round trip would lag the tap.
   */
  unitSpend: UnitSpend[];
  /**
   * Own lane only: damage landed by each unit in the round now in progress,
   * dead ones included. Cleared when the next wave spawns, not when the build
   * phase opens, so it is still there to read between fights.
   */
  unitDamage: UnitDamageView[];
}

/**
 * How much of an opponent's lane a player may see (§12).
 *
 *   - `granted`: only what a send bought, or everything once eliminated.
 *   - `combat`:  every lane while a wave is running; nothing in the build
 *                phase, so what you are building stays yours until it fights.
 *   - `always`:  every lane, all the time.
 */
export type LaneVisibility = 'granted' | 'combat' | 'always';

/** One blow, for the renderer to animate. See `Attack` in types.ts. */
export interface AttackView {
  attackerId: EntityId;
  targetId: EntityId;
}

/** What one player knows about another (§12). */
export interface OpponentView {
  teamId: TeamId;
  eliminated: boolean;
  /** Locked in at elimination (§13). */
  placement: number | null;
  fortressHp: number;
  fortressMaxHp: number;
  /** Whether the viewer can currently see inside this lane. */
  watching: boolean;
  /** Ticks of bought sight left, 0 when none. */
  visionTicksLeft: number;
}

export interface MatchView {
  /** Whose view this is. */
  teamId: TeamId;
  /** Public and identical for everyone: every lane faces the same wave (§9.2). */
  seed: number;
  tick: number;
  wave: number;
  phase: Phase;
  phaseTicksLeft: number;
  finished: boolean;
  eliminated: boolean;
  placement: number | null;
  /** Your own lane, in full. Null only if the match has no lane for you. */
  lane: LaneView | null;
  opponents: OpponentView[];
  /** Lanes whose contents this viewer may watch, keyed by team. */
  watching: Record<TeamId, LaneView>;
}

/** The living units, in one pass, so the views and the spend stay in step. */
function livingUnits(lane: Lane) {
  return lane.units.filter((unit) => unit.alive);
}

function unitViews(lane: Lane): EntityView[] {
  const out: EntityView[] = [];
  for (const unit of livingUnits(lane)) {
    out.push({
      id: unit.id,
      defId: unit.defId,
      x: unit.pos.x,
      y: unit.pos.y,
      radius: unit.radius,
      armour: unit.armour,
      damageType: unit.damageType,
      hpFraction: unit.maxHp > 0 ? unit.hp / unit.maxHp : 0,
    });
  }
  return out;
}

function monsterViews(lane: Lane): EntityView[] {
  const out: EntityView[] = [];
  for (const monster of lane.monsters) {
    if (!monster.alive) continue;
    out.push({
      id: monster.id,
      defId: monster.defId,
      x: monster.pos.x,
      y: monster.pos.y,
      radius: monster.radius,
      armour: monster.armour,
      damageType: monster.damageType,
      hpFraction: monster.maxHp > 0 ? monster.hp / monster.maxHp : 0,
    });
  }
  return out;
}

function laneView(lane: Lane, own: boolean): LaneView {
  return {
    teamId: lane.teamId,
    builderId: lane.builderId,
    units: unitViews(lane),
    monsters: monsterViews(lane),
    fortress: {
      hp: lane.fortress.hp,
      maxHp: lane.fortress.maxHp,
      destroyed: lane.fortress.destroyed,
      weaponDamageType: lane.fortress.weaponDamageType,
      activeAura: lane.fortress.activeAura,
      auraRadius: lane.fortress.auraRadius,
      auraStrength: lane.fortress.auraStrength,
    },
    economy: own
      ? {
          gold: lane.economy.gold,
          gems: lane.economy.gems,
          supplyUsed: lane.economy.supplyUsed,
          supplyCap: lane.economy.supplyCap,
          passiveIncome: lane.economy.passiveIncome,
          tech: { ...lane.economy.tech },
          upgrades: { ...lane.fortress.upgrades },
        }
      : null,
    reserveCount: lane.reserve.length,
    sendLog: lane.sendLog.map((s) => ({ sendId: s.sendId, fromTeamId: s.fromTeamId })),
    attacks: lane.attacks.map((a: Attack) => ({
      attackerId: a.attackerId,
      targetId: a.targetId,
    })),
    unitSpend: own ? livingUnits(lane).map((unit) => ({ ...unit.spend })) : [],
    // Every unit, not just the living: a unit that was overrun on the way to
    // the fortress earned its numbers before it went down.
    unitDamage: own
      ? lane.units.map((unit) => ({
          unitId: unit.id,
          defId: unit.defId,
          damage: unit.damageDealt,
        }))
      : [],
  };
}

/**
 * Everything `teamId` is allowed to know about the match right now.
 *
 * Callers outside the simulation - the renderer, the server's per-client
 * broadcast - should use this and nothing else. Reaching into `MatchState`
 * directly is how fog of war springs a leak.
 */
export function viewFor(
  state: MatchState,
  teamId: TeamId,
  visibility: LaneVisibility = 'granted',
): MatchView {
  const self = state.teams.find((t) => t.id === teamId) ?? null;
  const ownLane = state.lanes[teamId] ?? null;

  // §13: being out is what buys you the run of the place.
  const spectating = self?.eliminated ?? false;
  // Open to everyone, for reasons that have nothing to do with this viewer.
  const openToAll =
    visibility === 'always' || (visibility === 'combat' && state.phase === 'combat');

  const opponents: OpponentView[] = [];
  const watching: Record<TeamId, LaneView> = {};

  for (const team of state.teams) {
    if (team.id === teamId) continue;

    const lane = state.lanes[team.id];
    const visionTicksLeft = self?.vision[team.id] ?? 0;
    const canWatch = (openToAll || spectating || visionTicksLeft > 0) && lane !== undefined;

    opponents.push({
      teamId: team.id,
      eliminated: team.eliminated,
      placement: team.placement,
      // §12's suggested minimum, and the whole of it.
      fortressHp: lane ? lane.fortress.hp : 0,
      fortressMaxHp: lane ? lane.fortress.maxHp : 0,
      watching: canWatch,
      visionTicksLeft,
    });

    if (canWatch && lane) watching[team.id] = laneView(lane, false);
  }

  return {
    teamId,
    seed: state.seed,
    tick: state.tick,
    wave: state.wave,
    phase: state.phase,
    phaseTicksLeft: state.phaseTicksLeft,
    finished: state.finished,
    eliminated: self?.eliminated ?? false,
    placement: self?.placement ?? null,
    lane: ownLane ? laneView(ownLane, true) : null,
    opponents,
    watching,
  };
}
