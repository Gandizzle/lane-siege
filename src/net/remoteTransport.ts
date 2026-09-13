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
 *
 * COMING BACK (§18, M6)
 *
 * A phone that locks, a tab that reloads, a train that enters a tunnel: all
 * three close the socket, and none of them means the player quit. The server
 * holds their seat for a while (server/room.ts), and getting back into it needs
 * one string - Colyseus's reconnection token - which is kept in `sessionStorage`
 * so that it survives a reload of the page but not a new tab, which would be a
 * different player as far as anyone can tell.
 *
 * So connecting tries the token first and falls back to a normal join. A stale
 * token costs one failed round trip and nothing else.
 */

import { Client, type Room } from 'colyseus.js';
import type { GameData } from '../data/schema.ts';
import type { Command, CommandRejection, MatchView } from '../sim/index.ts';
import type { Identity } from './identity.ts';
import { PUBLIC_CODE, type LobbyView } from './lobby.ts';
import {
  ROOM_NAME,
  buildTables,
  decodeFrame,
  type WireFrame,
  type WireHello,
  type WireTables,
} from './protocol.ts';
import { MS_PER_TICK } from '../util/loop.ts';
import type { Transport, TransportStatus } from './transport.ts';

/** Where the reconnection token is kept, per server. */
function tokenKey(endpoint: string): string {
  return `lane-siege.reconnect.${endpoint}`;
}

function readToken(endpoint: string): string | null {
  try {
    return globalThis.sessionStorage?.getItem(tokenKey(endpoint)) ?? null;
  } catch {
    return null;
  }
}

function writeToken(endpoint: string, token: string | null): void {
  try {
    const storage = globalThis.sessionStorage;
    if (!storage) return;
    if (token) storage.setItem(tokenKey(endpoint), token);
    else storage.removeItem(tokenKey(endpoint));
  } catch {
    // No session storage: everything works except surviving a reload.
  }
}

export interface RemoteOptions {
  /** Who this player is, for their seat and their name (identity.ts). */
  identity: Identity;
  /** The roster they arrived with (§7.1). Changeable until kickoff. */
  builderId: string;
  /** A private room's code, or `PUBLIC_CODE` for a quick match. */
  code?: string;
}

export class RemoteTransport implements Transport {
  readonly kind = 'remote' as const;
  /** A room always has a lobby, even on the tick before it has answered. */
  readonly hasLobby = true;
  matchStarted = false;
  status: TransportStatus = 'connecting';
  detail: string | null = null;
  teamId: string | null = null;

  private room: Room | null = null;
  private tables: WireTables | null = null;
  private current: MatchView | null = null;
  private currentLobby: LobbyView | null = null;
  private sinceFrameMs = 0;
  private ticked = false;
  private readonly rejections: CommandRejection[] = [];
  private readonly pending: Command[] = [];
  private disposed = false;

  constructor(
    private readonly data: GameData,
    private readonly endpoint: string,
    private readonly options: RemoteOptions,
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

  /** The last description of the lobby, or null before one has arrived. */
  lobby(): LobbyView | null {
    return this.matchStarted ? null : this.currentLobby;
  }

  setReady(ready: boolean): void {
    this.room?.send('ready', ready);
  }

  setBuilder(builderId: string): void {
    this.room?.send('builder', builderId);
  }

  setName(name: string): void {
    this.room?.send('name', name);
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
    // A deliberate leave, so the server frees the seat rather than holding it
    // for a player who chose to go. `true` is Colyseus's "consented".
    this.room?.leave(true).catch(() => {});
    this.room = null;
    writeToken(this.endpoint, null);
  }

  /**
   * The token first, then a normal join.
   *
   * A token is only ever stale or good, and trying a stale one costs a failed
   * round trip - much less than the alternative, which is asking the player
   * whether they meant to come back.
   */
  private async open(client: Client): Promise<Room> {
    const token = readToken(this.endpoint);
    if (token) {
      try {
        return await client.reconnect(token);
      } catch {
        writeToken(this.endpoint, null);
      }
    }

    return client.joinOrCreate(ROOM_NAME, {
      code: this.options.code ?? PUBLIC_CODE,
      playerId: this.options.identity.playerId,
      name: this.options.identity.name,
      builderId: this.options.builderId,
    });
  }

  private async connect(): Promise<void> {
    const client = new Client(this.endpoint);
    const room = await this.open(client);
    if (this.disposed) {
      await room.leave();
      return;
    }

    this.room = room;
    writeToken(this.endpoint, room.reconnectionToken);

    room.onMessage('lobby', (lobby: LobbyView) => {
      this.currentLobby = lobby;
      if (lobby.started) this.matchStarted = true;
      // A lobby message is proof of a seat, which is what the player is
      // waiting on before the screen can show them anything.
      if (this.status === 'connecting' && this.tables) this.status = 'ready';
    });

    room.onMessage('hello', (hello: WireHello) => {
      this.teamId = hello.teamId;
      this.tables = buildTables(this.data, hello.teamIds, hello.seed);
      this.status = 'ready';

      // Anything tapped while connecting goes now, in the order it was tapped.
      for (const command of this.pending.splice(0, this.pending.length)) {
        room.send('command', command);
      }
    });

    room.onMessage('frame', (frame: WireFrame) => {
      if (!this.tables) return;
      // Frames only flow after kickoff, so one arriving is proof of it -
      // including for a client that reconnected straight into a running match.
      this.matchStarted = true;
      this.current = decodeFrame(frame, this.tables);
      this.sinceFrameMs = 0;
      this.ticked = true;
    });

    room.onMessage('rejected', (rejection: CommandRejection) => {
      this.rejections.push(rejection);
    });

    room.onLeave((code) => {
      this.status = 'closed';
      this.detail =
        code === 4000
          ? 'That room is full'
          : code === 4001
            ? 'That match has already started'
            : 'Disconnected from the server';
      this.room = null;
      // A room that turned us away is not one to try to reconnect to.
      if (code === 4000 || code === 4001) writeToken(this.endpoint, null);
    });

    room.onError((code, message) => {
      this.status = 'error';
      this.detail = message ?? `Server error ${code}`;
    });
  }
}
