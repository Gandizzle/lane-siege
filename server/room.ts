/**
 * The authoritative room. DESIGN.md §15.1, §15.2, §17 (M4).
 *
 * "Colyseus, 4 lanes, server-authoritative, sends, fog of war, elimination,
 * spectating."
 *
 * The room owns the match. It runs the SAME `step` the client runs, from
 * `src/sim`, imported unchanged - that is the whole point of §15.1 and it is
 * what makes a cheating client merely wrong rather than dangerous. Clients send
 * commands; the room validates them with the same `applyCommand` a local game
 * uses and refuses them with the same rejection codes.
 *
 * WHAT THE ROOM DOES NOT USE
 *
 * Colyseus's own state synchronisation. Its `Schema` classes would mean
 * declaring a parallel type tree mirroring `MatchState` and keeping the two in
 * step by hand, and the simulation would have to be built out of Schema objects
 * - which would put a networking dependency inside the pure module §15.1
 * insists has none. So the room uses Colyseus for what it is uniquely good at,
 * rooms and matchmaking and a websocket, and puts its own per-client frames
 * (`src/net/protocol.ts`) through `client.send`. Those are already filtered by
 * `viewFor`, so the hidden half of the match never leaves this process.
 *
 * COMMANDS ARE QUEUED, NOT APPLIED ON ARRIVAL
 *
 * A command that arrives mid-tick is held and applied at the top of the next
 * one. Two players buying in the same 50ms therefore resolve in a defined
 * order rather than wherever the packets landed, which is what keeps a replay
 * of the command log reproducible.
 */

import { Room, type Client } from 'colyseus';
import type { GameData } from '../src/data/schema.ts';
import {
  applyCommand,
  createContext,
  createMatch,
  secondsToTicks,
  step,
  viewFor,
  type Command,
  type MatchState,
  type SimContext,
} from '../src/sim/index.ts';
import { buildTables, encodeFrame, type WireHello, type WireTables } from '../src/net/protocol.ts';
import { AutoBuilder } from '../src/bot/autoBuilder.ts';
import { FixedTimestep, MS_PER_TICK } from '../src/util/loop.ts';

/** §2: four lanes, one player each in v1. */
export const MAX_PLAYERS = 4;

/** Lane ids are fixed and positional, so a reconnecting client can be seated. */
export const LANE_IDS = ['lane1', 'lane2', 'lane3', 'lane4'];

export interface RoomOptions {
  data: GameData;
  /** Start with fewer than four once this many seconds have passed. */
  autoStartSeconds: number;
}

interface Seat {
  teamId: string;
  client: Client | null;
  /** Seated at kickoff if nobody took this lane. */
  bot: AutoBuilder | null;
}

/** A command and who to tell if the simulation refuses it. */
interface Queued {
  command: Command;
  client: Client;
}

export class LaneSiegeRoom extends Room {
  override maxClients = MAX_PLAYERS;

  private data!: GameData;
  /** The match. Not Colyseus's `state`, which this room does not use. */
  private match!: MatchState;
  private ctx!: SimContext;
  private tables!: WireTables;
  private readonly timestep = new FixedTimestep();

  private seats: Seat[] = [];
  private queued: Queued[] = [];
  private started = false;
  private waitingTicks = 0;
  private autoStartTicks = 0;

  override onCreate(options: RoomOptions): void {
    this.data = options.data;
    this.autoStartTicks = secondsToTicks(options.autoStartSeconds);

    // Every lane exists from the start whether or not a human is in it, so
    // that a late joiner is seated rather than changing the match's shape -
    // and so the match seed stays a property of the room, not of who turned up.
    const seed = Math.floor(Math.random() * 0xffffffff);
    this.match = createMatch(this.data, {
      seed,
      teams: LANE_IDS.map((id) => ({ id, playerIds: [] })),
    });
    this.ctx = createContext(this.data);
    this.tables = buildTables(this.data, LANE_IDS, this.match.seed);
    this.seats = LANE_IDS.map((teamId) => ({ teamId, client: null, bot: null }));

    this.onMessage('command', (client, message: Command) => {
      const seat = this.seatOf(client);
      if (!seat) return;
      // A client may only act for its own lane, whatever it puts in the
      // message. This is the one line that makes the rest of the validation
      // meaningful.
      this.queued.push({ command: { ...message, teamId: seat.teamId } as Command, client });
    });

    // Colyseus's interval gives real elapsed time; the simulation is fixed-step,
    // so the accumulator decides how many ticks that is worth (§15.1).
    this.setSimulationInterval((deltaMs) => this.advance(deltaMs), MS_PER_TICK);
  }

  override onJoin(client: Client): void {
    const seat = this.seats.find((s) => s.client === null);
    if (!seat) {
      client.leave(4000, 'room full');
      return;
    }

    seat.client = client;
    this.match.teams.find((t) => t.id === seat.teamId)?.playerIds.push(client.sessionId);

    const hello: WireHello = {
      teamIds: LANE_IDS,
      teamId: seat.teamId,
      seed: this.match.seed,
    };
    client.send('hello', hello);
    this.sendFrame(seat);
  }

  override onLeave(client: Client): void {
    const seat = this.seats.find((s) => s.client === client);
    if (!seat) return;
    seat.client = null;

    // §13: a player who leaves is not holding anyone hostage. Their lane stays
    // in the match and keeps taking waves, so the monsters already in it still
    // have to be dealt with by nobody - which is to say their fortress falls in
    // its own time and they are eliminated normally.
  }

  private seatOf(client: Client): Seat | undefined {
    return this.seats.find((s) => s.client === client);
  }

  private occupied(): number {
    return this.seats.filter((s) => s.client !== null).length;
  }

  private advance(deltaMs: number): void {
    if (!this.started) {
      this.waitingTicks += 1;
      const full = this.occupied() >= MAX_PLAYERS;
      const waitedLongEnough = this.occupied() > 0 && this.waitingTicks >= this.autoStartTicks;
      if (!full && !waitedLongEnough) return;

      this.started = true;
      this.lock().catch(() => {});

      // Whatever lanes nobody took are played by a scripted builder, so a
      // two-player game is still the four-lane match §17 describes rather than
      // two empty lanes whose fortresses fall unopposed in wave one. The room
      // locks at kickoff, so no seat changes hands afterwards.
      for (const seat of this.seats) {
        if (!seat.client) seat.bot = new AutoBuilder(this.data, seat.teamId);
      }
    }

    this.timestep.advance(deltaMs, () => {
      // Applied here rather than handed to `step`, so that a refusal can be
      // sent back to the client that asked for it. `step` applies commands
      // first in any case, so this is the same order.
      for (const { command, client } of this.queued) {
        const result = applyCommand(this.ctx, this.match, command);
        if (!result.ok && result.rejection) client.send('rejected', result.rejection);
      }
      this.queued = [];

      step(this.ctx, this.match, this.botCommands());
    });

    for (const seat of this.seats) this.sendFrame(seat);

    if (this.match.finished) {
      this.broadcast('finished', {});
      this.disconnect().catch(() => {});
    }
  }

  /**
   * One frame per client, each filtered for that client (§12). Built per seat
   * rather than broadcast, because the whole point is that they differ.
   */
  private sendFrame(seat: Seat): void {
    if (!seat.client) return;
    const view = viewFor(this.match, seat.teamId);
    seat.client.send('frame', encodeFrame(view, this.tables));
  }

  private botCommands(): Command[] {
    if (this.match.phase !== 'build') return [];

    const commands: Command[] = [];
    for (const seat of this.seats) {
      if (seat.bot) commands.push(...seat.bot.plan(this.match));
    }
    return commands;
  }
}
