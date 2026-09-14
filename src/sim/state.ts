/**
 * Match setup. DESIGN.md §15.1.
 *
 * `createMatch` is the only place a MatchState is born. It reads every starting
 * number out of `data/` - none of them appear here - and refuses to build a
 * match from incomplete data rather than substituting defaults. A silent
 * default would be a hardcoded balance number by another name.
 */

import type { GameData } from '../data/schema.ts';
import { secondsToTicks } from './constants.ts';
import { Rng } from './rng.ts';
import type { Lane, MatchState, PlayerId, Team, TeamId } from './types.ts';

export class MissingDataError extends Error {
  constructor(public readonly paths: string[]) {
    super(
      `Cannot start a match: ${paths.length} balance value(s) are still unfilled in data/.\n` +
        paths.map((p) => `  · ${p}`).join('\n'),
    );
    this.name = 'MissingDataError';
  }
}

function requireNumber(value: number | null, path: string, missing: string[]): number {
  if (value === null || !Number.isFinite(value)) {
    missing.push(path);
    return 0;
  }
  return value;
}

/**
 * Seat a lane with a roster before the match starts (§7.1).
 *
 * For the server, which creates the match when the room opens and only learns
 * what each player picked as they join. Refused once the lane has anything on
 * it, because a roster is a commitment: §7.3's upgrades and §11.4's supply
 * budget both run the length of a match, and swapping mid-match would strand
 * whatever is already built.
 */
export function setLaneBuilder(
  data: GameData,
  state: MatchState,
  teamId: TeamId,
  builderId: string,
): boolean {
  const lane = state.lanes[teamId];
  if (!lane) return false;
  if (state.wave > 0 || lane.units.length > 0) return false;
  if (!data.units.builders.some((b) => b.id === builderId)) return false;

  lane.builderId = builderId;
  return true;
}

export interface TeamSetup {
  id: TeamId;
  /** §2: one or more. v1 is free-for-all, so exactly one. */
  playerIds: PlayerId[];
  /**
   * Which roster this team builds from (§7.1). Defaults to the first builder in
   * `units.json` so that a caller with no opinion - a test, the headless runner
   * - still gets a playable lane.
   */
  builderId?: string;
}

export interface MatchOptions {
  /** One seed per match, shared by every client and the server (§9.2). */
  seed: number;
  teams: TeamSetup[];
}

function createLane(
  data: GameData,
  teamId: TeamId,
  builderId: string,
  missing: string[],
): Lane {
  const maxHp = requireNumber(data.fortress.hp.base, 'fortress.hp.base', missing);
  const weaponType = data.matrix.damageTypes[0];
  if (!weaponType) missing.push('matrix.damageTypes[0]');

  return {
    teamId,
    builderId,
    units: [],
    monsters: [],
    reserve: [],
    incomingSends: [],
    sendLog: [],
    attacks: [],
    fortress: {
      hp: maxHp,
      maxHp,
      // 0 by default: the fortress does not self-heal until the upgrade is
      // bought (§5.5, amended).
      regenPerClear: data.fortress.regenOnLaneClear.base ?? 0,
      // Player-selectable each build phase (§10.1); this is only the opening value.
      weaponDamageType: weaponType ?? 'impact',
      weaponCooldown: 0,
      activeAura: null,
      weaponDamage: requireNumber(data.fortress.weapon.damage, 'fortress.weapon.damage', missing),
      weaponAttackSpeed: requireNumber(
        data.fortress.weapon.attackSpeed,
        'fortress.weapon.attackSpeed',
        missing,
      ),
      weaponRange: requireNumber(data.fortress.weapon.range, 'fortress.weapon.range', missing),
      auraStrength: data.fortress.auras.strength.base ?? 0,
      auraRadius: data.fortress.auras.radius.base ?? 0,
      gemsPerWave: data.fortress.resourceBuilding.gemsPerWave ?? 0,
      upgrades: {},
      destroyed: false,
    },
    economy: {
      gold: requireNumber(data.economy.startingGold, 'economy.startingGold', missing),
      gems: requireNumber(data.economy.startingGems, 'economy.startingGems', missing),
      supplyUsed: 0,
      supplyCap: requireNumber(data.economy.supply.capBase, 'economy.supply.capBase', missing),
      passiveIncome: 0,
      tech: {},
    },
  };
}

export function createMatch(data: GameData, options: MatchOptions): MatchState {
  const missing: string[] = [];

  const buildTicks = secondsToTicks(data.waves.buildPhaseSeconds);

  const teams: Team[] = options.teams.map((setup) => ({
    id: setup.id,
    playerIds: [...setup.playerIds],
    eliminated: false,
    placement: null,
    vision: {},
  }));

  const known = new Set(data.units.builders.map((b) => b.id));
  const fallback = data.units.builders[0]?.id;
  if (fallback === undefined) missing.push('units.builders[0].id');

  const lanes: Record<TeamId, Lane> = {};
  for (const setup of options.teams) {
    const wanted = setup.builderId ?? fallback ?? '';
    // An unknown builder is a caller bug, not a balance gap, and silently
    // seating them with someone else's roster would be worse than saying so.
    if (setup.builderId !== undefined && !known.has(setup.builderId)) {
      throw new Error(
        `No such builder '${setup.builderId}'. Known: ${[...known].join(', ')}`,
      );
    }
    lanes[setup.id] = createLane(data, setup.id, wanted, missing);
  }

  if (missing.length > 0) throw new MissingDataError(missing);

  return {
    seed: options.seed,
    rngState: new Rng(options.seed).state,
    tick: 0,
    // A match opens on a build phase, before wave 1 (§3.1).
    wave: 0,
    phase: 'build',
    phaseTicksLeft: buildTicks,
    teams,
    lanes,
    waveClocks: [],
    nextEntityId: 1,
    finished: false,
    eliminatedCount: 0,
  };
}
