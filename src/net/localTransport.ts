/**
 * The simulation, running right here. Single player, and the practice match.
 *
 * This is what M2 and M3 did inline, lifted behind the transport interface so
 * that the renderer cannot tell the difference between this and a server. Two
 * things follow from that, and both are the point:
 *
 *   - Single player goes through `viewFor` exactly as multiplayer does, so the
 *     fog-of-war filter (§12) is exercised by every game rather than only by
 *     the networked one.
 *   - A command is applied by the same `applyCommand` the server calls, so a
 *     purchase costs the same whichever mode you are in.
 *
 * Commands apply immediately here rather than being queued for the next tick.
 * That is honest for a local game - there is no authority to disagree with -
 * and it is what makes a build tap feel instant.
 *
 * It also runs the other lanes. M4 is four lanes, sends, fog of war and
 * spectating, and none of it can be seen with nobody in the other three, so a
 * practice match seats a scripted builder in each (`src/bot`). That is not a
 * stand-in for multiplayer - the server path is the same simulation reached
 * through `RemoteTransport` - but it means the opponent tabs, the incoming-send
 * notice, bought vision and elimination are all live in a game with no network
 * at all. Which is just as well, since the GitHub Pages build (§15.2) is static
 * and cannot host a room.
 */

import type { GameData } from '../data/schema.ts';
import { AutoBuilder } from '../bot/autoBuilder.ts';
import {
  applyCommand,
  createContext,
  createMatch,
  step,
  viewFor,
  type Command,
  type CommandRejection,
  type MatchState,
  type MatchView,
  type SimContext,
  type TeamSetup,
} from '../sim/index.ts';
import { FixedTimestep } from '../util/loop.ts';
import type { Transport, TransportStatus } from './transport.ts';

const NO_COMMANDS: readonly Command[] = [];

/** What a jumped-to match arrives with, so a late start is not a poor one. */
const JUMP_GOLD = 6000;
const JUMP_GEMS = 600;

/**
 * Where a local match starts, for `?wave=` and `?showdown=` (main.ts).
 *
 * Debugging only, and local only. A networked match has three other people in
 * it and starts at wave 1 like everybody else.
 */
export interface LocalStart {
  /** Open at the build phase before this wave. */
  wave?: number;
  /** Open in the Final Showdown's arena, with four scripted armies in it. */
  showdown?: boolean;
}

export class LocalTransport implements Transport {
  readonly kind = 'local' as const;
  status: TransportStatus = 'ready';
  detail: string | null = null;
  readonly teamId: string;

  private readonly state: MatchState;
  private readonly ctx: SimContext;
  private readonly clock = new FixedTimestep();
  private readonly rejections: CommandRejection[] = [];

  private current: MatchView | null = null;
  private ticked = false;
  private readonly bots: AutoBuilder[];
  /** §12: how much of an opponent's lane this match shows. Data, not code. */
  private readonly visibility: GameData['lane']['opponentLanes'];

  constructor(
    data: GameData,
    seed: number,
    teams: TeamSetup[],
    teamId: string,
    /** Lanes played by a scripted builder rather than by a person. */
    botTeamIds: readonly string[] = [],
    /**
     * Where to start, instead of at wave 1. A debugging affordance in the same
     * family as `?seed=` - see `jumpTo` and `jumpToShowdown`.
     */
    start: LocalStart = {},
  ) {
    this.state = createMatch(data, { seed, teams });
    this.ctx = createContext(data);
    this.teamId = teamId;
    this.visibility = data.lane.opponentLanes;
    this.bots = botTeamIds
      .filter((id) => id !== teamId)
      .map((id) => new AutoBuilder(data, id, this.state.lanes[id]?.builderId ?? ''));

    if (start.showdown) this.jumpToShowdown(data);
    else if (start.wave !== undefined && start.wave > 1) this.jumpTo(data, start.wave);
    this.refresh();
  }

  /**
   * Start at the build phase before `wave` (`?wave=`).
   *
   * A practice match is the only way to look at anything, and there are things
   * - the Final Showdown above all (§3.3, replaced) - that are twenty-five
   * waves in. Every lane is funded on arrival, since a late start with a
   * wave-one purse is a late start with nothing on the board. Local matches
   * only; a real match has three other people in it and no business starting
   * anywhere but wave 1.
   */
  private jumpTo(data: GameData, wave: number): void {
    this.state.wave = Math.min(wave, data.waves.showdown.afterWave) - 1;
    for (const lane of Object.values(this.state.lanes)) {
      lane.economy.gold += JUMP_GOLD;
      lane.economy.gems += JUMP_GEMS;
    }
  }

  /**
   * Start in the arena itself (`?showdown=1`).
   *
   * `?wave=25` is the honest route and it is the one to use to PLAY the
   * ending, but it only reaches the arena if all four lanes survive wave 25 -
   * which, with the balance numbers still at their placeholders, they usually
   * do not. This route funds every lane, runs one build phase so the scripted
   * builders spend it, and then hands the match to the showdown as though the
   * last wave had just been cleared. Four armies, no waves, straight in.
   *
   * Every lane is scripted here, the player's included: the point is to LOOK
   * at the arena, and a spoke with nothing standing in it shows nothing.
   */
  private jumpToShowdown(data: GameData): void {
    const builders = Object.values(this.state.lanes).map(
      (lane) => new AutoBuilder(data, lane.teamId, lane.builderId),
    );
    for (const lane of Object.values(this.state.lanes)) {
      lane.economy.gold += JUMP_GOLD;
      lane.economy.gems += JUMP_GEMS;
    }

    // One build phase, spent all at once. Stopped one tick short of its end so
    // that the last wave never spawns - there is nothing to learn from it here.
    this.state.wave = data.waves.showdown.afterWave - 1;
    while (this.state.phase === 'build' && this.state.phaseTicksLeft > 1) {
      const commands: Command[] = [];
      for (const bot of builders) commands.push(...bot.plan(this.state));
      step(this.ctx, this.state, commands);
    }

    // The state the tick after the last wave's last monster dies. `step` does
    // the rest, because opening the showdown is the simulation's job (§3.3,
    // replaced).
    this.state.wave = data.waves.showdown.afterWave;
    this.state.phase = 'combat';
    this.state.phaseTicksLeft = 0;
    step(this.ctx, this.state);
  }

  get alpha(): number {
    return this.clock.alpha;
  }

  update(deltaMs: number): void {
    const ticks = this.clock.advance(deltaMs, () => {
      step(this.ctx, this.state, this.botCommands());
    });
    if (ticks > 0) {
      this.ticked = true;
      this.refresh();
    }
  }

  /**
   * A practice match has no lobby: there is nobody to wait for, the other three
   * lanes are scripted, and the roster was chosen on the way in. It is running
   * the moment it is made.
   */
  readonly hasLobby = false;
  readonly matchStarted = true;

  lobby(): null {
    return null;
  }

  setReady(): void {
    // Nothing to be ready for.
  }

  setBuilder(): void {
    // The roster is fixed when the match is created (§7.1); a practice match
    // has no window in which to change it.
  }

  setName(): void {
    // Nobody to show it to.
  }

  view(): MatchView | null {
    return this.current;
  }

  consumeTick(): boolean {
    const had = this.ticked;
    this.ticked = false;
    return had;
  }

  submit(command: Command): void {
    const result = applyCommand(this.ctx, this.state, command);
    if (!result.ok && result.rejection) this.rejections.push(result.rejection);
    // A purchase changes the wallet, and the player should see that on this
    // frame rather than on the next tick.
    this.refresh();
  }

  takeRejections(): CommandRejection[] {
    if (this.rejections.length === 0) return [];
    return this.rejections.splice(0, this.rejections.length);
  }

  dispose(): void {
    this.status = 'closed';
  }

  /**
   * What the scripted lanes want to do this tick.
   *
   * Returns the shared empty array outside the build phase, which is almost
   * every tick, so the common case allocates nothing (§15.3).
   */
  private botCommands(): readonly Command[] {
    if (this.bots.length === 0 || this.state.phase !== 'build') return NO_COMMANDS;

    const commands: Command[] = [];
    for (const bot of this.bots) commands.push(...bot.plan(this.state));
    return commands;
  }

  private refresh(): void {
    this.current = viewFor(this.ctx, this.state, this.teamId, this.visibility);
  }
}
