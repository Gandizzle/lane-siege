/**
 * The simulation, running on the server. DESIGN.md §15.1, §15.2, §17 (M4).
 *
 * This client holds no simulation at all. It sends commands, receives the
 * frames it is allowed to receive (§12), and draws them. That is what
 * "server-authoritative" means here, and it is why fog of war is real rather
 * than polite: the hidden half of the match is never on this machine.
 *
 * WHY THERE IS NO LOCAL PREDICTION YET
 *
 * The obvious next step is to apply a command locally the moment it is tapped
 * and reconcile when the server disagrees. It is deliberately not here:
 *
 *   - Every command is a build-phase action (§3.1) - placing, upgrading,
 *     buying, choosing a weapon type - and in the build phase nothing is
 *     moving. One round trip of delay reads as a slightly soft button, not as
 *     lag in the game.
 *   - Prediction needs a local simulation to predict INTO, and a client only
 *     has its own lane. It cannot run `step`, because enrage clocks and the
 *     end of combat both depend on lanes it may not see (§8, §3.2 amended) -
 *     the same coupling that ruled out sending the command stream instead of
 *     frames. Predicting would mean a second, partial simulation whose only
 *     job is to be optimistic, and a whole class of reconciliation bugs.
 *
 * So the honest version first. If the round trip turns out to feel bad on a
 * real connection, the cheap fix is to predict the WALLET - deduct the cost and
 * show the unit as pending - which needs no simulation at all.
 *
 * INTERPOLATION
 *
 * Frames arrive at the server's tick rate over a network that does not respect
 * it. `alpha` therefore comes from a local clock running at the simulation rate
 * and is reset when a frame lands, so entities slide between the last two
 * frames instead of stepping whenever a packet arrives.
 */

import { Client, type Room } from 'colyseus.js';
import type { GameData } from '../data/schema.ts';
import type { Command, CommandRejection, MatchView } from '../sim/index.ts';
import {
  buildTables,
  decodeFrame,
  type WireFrame,
  type WireHello,
  type WireTables,
} from './protocol.ts';
import { MS_PER_TICK } from '../util/loop.ts';
import type { Transport, TransportStatus } from './transport.ts';

/** Colyseus's room type name, matched with the server's. */
const ROOM_NAME = 'lane_siege';

export class RemoteTransport implements Transport {
  readonly kind = 'remote' as const;
  status: TransportStatus = 'connecting';
  detail: string | null = null;
  teamId: string | null = null;

  private room: Room | null = null;
  private tables: WireTables | null = null;
  private current: MatchView | null = null;
  private seed = 0;
  private sinceFrameMs = 0;
  private ticked = false;
  private readonly rejections: CommandRejection[] = [];
  private readonly pending: Command[] = [];
  private disposed = false;

  constructor(
    private readonly data: GameData,
    private readonly endpoint: string,
  ) {
    this.connect().catch((error: unknown) => {
      this.status = 'error';
      this.detail = error instanceof Error ? error.message : String(error);
    });
  }

  get alpha(): number {
    // Clamped: a late frame should hold the last position rather than have
    // everything slide on past where it was told to be.
    return Math.min(1, this.sinceFrameMs / MS_PER_TICK);
  }

  update(deltaMs: number): void {
    this.sinceFrameMs += deltaMs;
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
    if (!this.room) {
      // Tapped before the room is up. Queue it rather than dropping it: joining
      // takes a moment and the player has no way to know that.
      this.pending.push(command);
      return;
    }
    this.room.send('command', command);
  }

  takeRejections(): CommandRejection[] {
    if (this.rejections.length === 0) return [];
    return this.rejections.splice(0, this.rejections.length);
  }

  dispose(): void {
    this.disposed = true;
    this.status = 'closed';
    this.room?.leave().catch(() => {});
    this.room = null;
  }

  private async connect(): Promise<void> {
    const client = new Client(this.endpoint);
    const room = await client.joinOrCreate(ROOM_NAME);
    if (this.disposed) {
      await room.leave();
      return;
    }

    this.room = room;

    room.onMessage('hello', (hello: WireHello) => {
      this.teamId = hello.teamId;
      this.seed = hello.seed;
      this.tables = buildTables(this.data, hello.teamIds);
      this.status = 'ready';

      // Anything tapped while connecting goes now, in the order it was tapped.
      for (const command of this.pending.splice(0, this.pending.length)) {
        room.send('command', command);
      }
    });

    room.onMessage('frame', (frame: WireFrame) => {
      if (!this.tables) return;
      const view = decodeFrame(frame, this.tables);
      // The seed is not in every frame - it cannot change - so it is restored
      // from the hello here rather than sent 20 times a second.
      view.seed = this.seed;
      this.current = view;
      this.sinceFrameMs = 0;
      this.ticked = true;
    });

    room.onMessage('rejected', (rejection: CommandRejection) => {
      this.rejections.push(rejection);
    });

    room.onLeave((code) => {
      this.status = 'closed';
      this.detail = code === 4000 ? 'That room is full' : 'Disconnected from the server';
      this.room = null;
    });

    room.onError((code, message) => {
      this.status = 'error';
      this.detail = message ?? `Server error ${code}`;
    });
  }
}
