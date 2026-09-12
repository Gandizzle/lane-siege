/**
 * Fog of war. DESIGN.md §12.
 *
 * §12 left OPEN "exactly what is public" and suggested a minimum of fortress HP
 * and alive/eliminated status. That minimum is what this implements, and the
 * rule is stated once, here, as a type:
 *
 *   - Your own lane: everything.
 *   - An opponent's lane: fortress HP and whether they are still alive. That is
 *     all. Not their army, not their gold, not their income, not their tech.
 *   - A lane you have bought sight of with a send (§11.5): its CONTENTS - the
 *     units, the monsters, the fortress. Still not their wallet.
 *   - Once you are eliminated: the contents of every lane, because §13 says an
 *     eliminated player may stay and spectate. Still not their wallets.
 *
 * So the one thing that is never public under any circumstance is the economy.
 * Seeing someone's army is a tactical read that a send can buy; seeing their
 * bank balance tells you what they are about to do, which no rule in §11 or §12
 * offers a way to earn.
 *
 * WHY THIS IS A FUNCTION AND NOT A CONVENTION
 *
 * At M4 the server runs the simulation and sends each client its view (§15.1,
 * §15.2). If filtering were the renderer's job, the hidden data would already
 * be on the client and "fog of war" would mean "please do not look" - so the
 * filter has to happen before anything leaves the server, which means it has to
 * be a pure function of state and viewer. It is used in single player too, over
 * the local transport, so the same code path is exercised either way and a leak
 * cannot hide in the multiplayer-only branch.
 *
 * Views hold REFERENCES into live state rather than copies: the renderer reads
 * them every frame and §15.3 forbids per-frame allocation. The server
 * serialises them on the way out, which is where the copy happens, once.
 */

import type {
  DefensiveUnit,
  Economy,
  Fortress,
  Lane,
  MatchState,
  Monster,
  Phase,
  TeamId,
} from './types.ts';

/** A lane as some viewer is allowed to see it. */
export interface LaneView {
  teamId: TeamId;
  units: readonly DefensiveUnit[];
  monsters: readonly Monster[];
  fortress: Fortress;
  /**
   * Present only for your own lane. A wallet is never public - see the note at
   * the top of this file.
   */
  economy: Economy | null;
  /** §8.1: how many monsters are still queued to enter. */
  reserveCount: number;
  /** §11.5: who has sent what at this lane, for the incoming-attack notice. */
  sendLog: readonly { sendId: string; fromTeamId: TeamId }[];
}

/** What one player knows about another (§12). */
export interface OpponentView {
  teamId: TeamId;
  eliminated: boolean;
  /** Locked in at elimination (§13). */
  placement: number | null;
  fortressHp: number;
  fortressMaxHp: number;
  /** Whether the viewer can currently see this lane's contents. */
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

function laneView(lane: Lane, includeEconomy: boolean): LaneView {
  return {
    teamId: lane.teamId,
    units: lane.units,
    monsters: lane.monsters,
    fortress: lane.fortress,
    economy: includeEconomy ? lane.economy : null,
    reserveCount: lane.reserve.length,
    sendLog: lane.sendLog,
  };
}

/**
 * Everything `teamId` is allowed to know about the match right now.
 *
 * Callers outside the simulation - the renderer, the server's per-client
 * broadcast - should use this and nothing else. Reaching into `MatchState`
 * directly is how fog of war springs a leak.
 */
export function viewFor(state: MatchState, teamId: TeamId): MatchView {
  const self = state.teams.find((t) => t.id === teamId) ?? null;
  const ownLane = state.lanes[teamId] ?? null;

  // §13: being out is what buys you the run of the place.
  const spectating = self?.eliminated ?? false;

  const opponents: OpponentView[] = [];
  const watching: Record<TeamId, LaneView> = {};

  for (const team of state.teams) {
    if (team.id === teamId) continue;

    const lane = state.lanes[team.id];
    const visionTicksLeft = self?.vision[team.id] ?? 0;
    const canWatch = spectating || visionTicksLeft > 0;

    opponents.push({
      teamId: team.id,
      eliminated: team.eliminated,
      placement: team.placement,
      // §12's suggested minimum, and the whole of it.
      fortressHp: lane ? lane.fortress.hp : 0,
      fortressMaxHp: lane ? lane.fortress.maxHp : 0,
      watching: canWatch && lane !== undefined,
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
