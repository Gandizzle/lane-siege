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

  constructor(
    data: GameData,
    seed: number,
    teams: TeamSetup[],
    teamId: string,
    /** Lanes played by a scripted builder rather than by a person. */
    botTeamIds: readonly string[] = [],
  ) {
    this.state = createMatch(data, { seed, teams });
    this.ctx = createContext(data);
    this.teamId = teamId;
    this.bots = botTeamIds
      .filter((id) => id !== teamId)
      .map((id) => new AutoBuilder(data, id, this.state.lanes[id]?.builderId ?? ''));
    this.refresh();
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
    this.current = viewFor(this.state, this.teamId);
  }
}
