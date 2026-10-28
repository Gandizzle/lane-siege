/**
 * A saved build, played back: a quick-match seat nobody live is in, played by
 * what another player did in a match of their own. (docs/ARCHITECTURE.md,
 * "Saved builds")
 *
 * WHAT IS KEPT
 *
 * Every command a quick-match lane accepts passes through the server
 * (server/room.ts), so the server can keep them - not the frames, and not the
 * match, but what the player DID, as actions that mean the same thing in
 * somebody else's match (`GhostCommand`):
 *
 *   - a unit is named by the tile it stands on, not by its id, which is only an
 *     id in the match that gave it out;
 *   - a send's target is named by how many seats round the table it sat, since
 *     the lanes are other people's next time;
 *   - and each action is dated by the wave, and the half of it, it was taken
 *     in - the build phase after wave 3, the fighting of wave 4 (`moment`).
 *
 * A unit placed and sold again in the same build phase was a slip, refunded in
 * full (§11): the pair is kept as nothing (`GhostRecorder`).
 *
 * WHAT A REPLAY IS
 *
 * Not the match again: the waves, the sends coming in and so the gold are all
 * different the second time. So a replay keeps the player's ORDER, not their
 * clock. Each action falls due at the moment it was taken, and is made as soon
 * as the lane can make it, through the same `applyCommand` a tap goes through
 * (`GhostPlayer`):
 *
 *   - Short of gold, gems or supply, it waits, and so does everything after it:
 *     money is spent in the order the player spent it.
 *   - A ladder still cooling, a send on its cooldown or not open yet, a unit to
 *     place while a wave is being fought: that one waits, and the rest go on.
 *   - Anything that cannot happen in this match - a tile already taken, a unit
 *     that is not there to upgrade - is let go.
 *
 * So a build that held to wave 25 plays its opening the way its player did,
 * catches up when the gold comes, and stands with its last army when the
 * recording runs out. It never reacts to what this match throws at it: that is
 * what it means to play against a saved build rather than a person.
 */

import type { AuraType, DamageType } from '../data/schema.ts';
import {
  ladderOf,
  type Command,
  type CommandResult,
  type MatchState,
  type TeamId,
} from '../sim/index.ts';

/** A command as it means the same in another match: no ids, no lanes. */
export type GhostCommand =
  | { kind: 'placeUnit'; unitDefId: string; tileX: number; tileY: number }
  | { kind: 'upgradeUnit'; tileX: number; tileY: number }
  | { kind: 'sellUnit'; tileX: number; tileY: number }
  | { kind: 'buyTech'; trackId: string }
  | { kind: 'buyFortressUpgrade'; upgradeId: string }
  | { kind: 'buySupply' }
  | { kind: 'setWeaponType'; damageType: DamageType }
  | { kind: 'setAura'; aura: AuraType }
  /** `seat` is how far round the table the target sat from the sender: 1 to 3. */
  | { kind: 'send'; sendId: string; seat: number };

export interface GhostAction {
  /** The match's wave when it was taken. */
  wave: number;
  /** Taken while that wave was being fought, rather than in a build phase. */
  combat: boolean;
  do: GhostCommand;
}

/** A recording's most actions. A guard against a lane that only ever buys and sells. */
export const MAX_ACTIONS = 2000;

/** At most this many tries a tick, so a long backlog costs a tick no more than a short one. */
const TRIES_PER_TICK = 12;

/**
 * Where in a match a moment falls, as one number that only goes up. A build
 * phase carries the number of the wave before it, and the wave after it is
 * fought under the next number, so the build phase after wave 3 is 6 and the
 * fighting of wave 4 is 7.
 */
export function moment(wave: number, combat: boolean): number {
  return combat ? wave * 2 - 1 : wave * 2;
}

function momentOf(state: MatchState): number {
  return moment(state.wave, state.phase === 'combat');
}

/** What only the build phase can do: anything on the board. */
function onTheBoard(command: GhostCommand): boolean {
  return (
    command.kind === 'placeUnit' || command.kind === 'upgradeUnit' || command.kind === 'sellUnit'
  );
}

/**
 * `command`, about to be applied to `state`, as it would mean the same in
 * another match - or null when it names something that is not there. Taken
 * BEFORE the command is applied: a sale removes the unit it names.
 */
export function portable(
  command: Command,
  state: MatchState,
  seats: readonly TeamId[],
): GhostCommand | null {
  const lane = state.lanes[command.teamId];
  switch (command.kind) {
    case 'placeUnit':
      return {
        kind: 'placeUnit',
        unitDefId: command.unitDefId,
        tileX: command.tileX,
        tileY: command.tileY,
      };
    case 'upgradeUnit':
    case 'sellUnit': {
      const unit = lane?.units.find((u) => u.id === command.unitId);
      return unit ? { kind: command.kind, tileX: unit.homeTileX, tileY: unit.homeTileY } : null;
    }
    case 'buyTech':
      return { kind: 'buyTech', trackId: command.trackId };
    case 'buyFortressUpgrade':
      return { kind: 'buyFortressUpgrade', upgradeId: command.upgradeId };
    case 'buySupply':
      return { kind: 'buySupply' };
    case 'setWeaponType':
      return { kind: 'setWeaponType', damageType: command.damageType };
    case 'setAura':
      return { kind: 'setAura', aura: command.aura };
    case 'send': {
      const from = seats.indexOf(command.teamId);
      const to = seats.indexOf(command.targetTeamId);
      if (from < 0 || to < 0 || from === to) return null;
      return {
        kind: 'send',
        sendId: command.sendId,
        seat: (to - from + seats.length) % seats.length,
      };
    }
  }
}

/** What each lane in a match has done, as it will be saved. */
export class GhostRecorder {
  private readonly actions = new Map<TeamId, GhostAction[]>();

  /** A command `teamId`'s lane has just had accepted, in its portable form. */
  add(teamId: TeamId, state: MatchState, command: GhostCommand): void {
    const list = this.actions.get(teamId) ?? [];
    this.actions.set(teamId, list);
    const combat = state.phase === 'combat';
    const at = moment(state.wave, combat);

    // A unit sold in the build phase it was placed in was a slip, and the
    // refund was whole: keep the pair as nothing - and any upgrades bought on
    // it in between, which the sale refunded too.
    if (command.kind === 'sellUnit') {
      let placed = -1;
      for (let i = list.length - 1; i >= 0 && placed < 0; i--) {
        const a = list[i]!.do;
        if (a.kind === 'placeUnit' && a.tileX === command.tileX && a.tileY === command.tileY) {
          placed = i;
        }
      }
      if (placed >= 0 && moment(list[placed]!.wave, list[placed]!.combat) === at) {
        const onTile = (a: GhostAction) =>
          'tileX' in a.do && a.do.tileX === command.tileX && a.do.tileY === command.tileY;
        const kept = list.filter((a, i) => i < placed || !onTile(a));
        list.length = 0;
        list.push(...kept);
        return;
      }
    }
    if (list.length < MAX_ACTIONS) list.push({ wave: state.wave, combat, do: command });
  }

  actionsOf(teamId: TeamId): GhostAction[] {
    return [...(this.actions.get(teamId) ?? [])];
  }
}

/**
 * Plays a recording in a lane of a live match. `act` is called every tick
 * with a way to apply a command and hear back whether it was taken.
 */
export class GhostPlayer {
  /** What is still to do, in the order it was done. */
  private queue: GhostAction[];

  constructor(
    private readonly teamId: TeamId,
    actions: readonly GhostAction[],
    /** The match's seats in table order, for whom a send goes to. */
    private readonly seats: readonly TeamId[],
  ) {
    this.queue = [...actions];
  }

  /** Actions not yet made: waiting for their moment, for the money, or for a ladder. */
  get remaining(): number {
    return this.queue.length;
  }

  act(state: MatchState, apply: (command: Command) => CommandResult): void {
    if (state.phase === 'showdown' || state.finished) return;
    const self = state.teams.find((t) => t.id === this.teamId);
    if (!self || self.eliminated) return;

    const now = momentOf(state);
    const kept: GhostAction[] = [];
    /** Ladders and sends with a level or a shot still waiting: the rest of theirs wait too. */
    const busy = new Set<string>();
    let tries = 0;
    let broke = false;

    for (const [index, action] of this.queue.entries()) {
      // In order, so the first one still to come is the end of what is due.
      if (moment(action.wave, action.combat) > now) {
        kept.push(...this.queue.slice(index));
        break;
      }
      if (broke || tries >= TRIES_PER_TICK) {
        kept.push(action);
        continue;
      }
      if (onTheBoard(action.do) && state.phase !== 'build') {
        kept.push(action);
        continue;
      }
      const command = this.materialise(action.do, state);
      if (!command) continue;
      const line = command.kind === 'send' ? `send:${command.sendId}` : ladderOf(command);
      if (line !== null && busy.has(line)) {
        kept.push(action);
        continue;
      }

      tries += 1;
      const result = apply(command);
      if (result.ok) continue;
      switch (result.rejection) {
        case 'insufficient-gold':
        case 'insufficient-gems':
        case 'insufficient-supply':
          // Money is spent in the order it was spent: nothing after this goes
          // ahead of it.
          kept.push(action);
          broke = true;
          break;
        case 'on-cooldown':
        case 'send-locked':
        case 'not-build-phase':
          kept.push(action);
          if (line !== null) busy.add(line);
          break;
        default:
          // Cannot happen in this match - a tile taken, a level already at
          // its top, a target gone. Let go.
          break;
      }
    }
    this.queue = kept;
  }

  /** A portable command as a command for this lane, now: or null if what it names is not here. */
  private materialise(command: GhostCommand, state: MatchState): Command | null {
    const teamId = this.teamId;
    switch (command.kind) {
      case 'upgradeUnit':
      case 'sellUnit': {
        const unit = state.lanes[teamId]?.units.find(
          (u) => u.homeTileX === command.tileX && u.homeTileY === command.tileY,
        );
        return unit ? { kind: command.kind, teamId, unitId: unit.id } : null;
      }
      case 'send': {
        // The seat it went to before, or the next one round still standing.
        const from = this.seats.indexOf(teamId);
        const n = this.seats.length;
        for (let k = 0; k < n; k++) {
          const target = this.seats[(from + command.seat + k) % n];
          if (target === undefined || target === teamId) continue;
          const team = state.teams.find((t) => t.id === target);
          if (team && !team.eliminated) {
            return { kind: 'send', teamId, targetTeamId: target, sendId: command.sendId };
          }
        }
        return null;
      }
      case 'placeUnit':
        return { ...command, teamId };
      case 'buyTech':
        return { ...command, teamId };
      case 'buyFortressUpgrade':
        return { ...command, teamId };
      case 'buySupply':
        return { kind: 'buySupply', teamId };
      case 'setWeaponType':
        return { ...command, teamId };
      case 'setAura':
        return { ...command, teamId };
    }
  }
}
