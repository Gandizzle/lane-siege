/**
 * The authoritative room. DESIGN.md §15.1, §15.2, §17 (M4, M6).
 *
 * "Colyseus, 4 lanes, server-authoritative, sends, fog of war, elimination,
 * spectating" (M4), and since M6 the lobby that people arrive in, the
 * matchmaking that brings them here, and the reconnection that lets them back.
 *
 * The room owns the match. It runs the SAME `step` the client runs, from
 * `src/sim`, imported unchanged - that is the whole point of §15.1 and it is
 * what makes a cheating client merely wrong rather than dangerous. Clients send
 * commands; the room validates them with the same `applyCommand` a local game
 * uses and refuses them with the same rejection codes.
 *
 * A ROOM HAS TWO LIVES
 *
 * Before kickoff it is a lobby: seats, names, rosters, ready ticks, and a
 * countdown. After kickoff it is a match and the lobby is history. The rules
 * for the first are in `src/net/lobby.ts`, as pure functions with no socket in
 * them, so they can be tested without a network; this file owns the sockets and
 * asks that module what to do.
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
 *
 * SAVED BUILDS (src/bot/ghost.ts, ghostStore.ts)
 *
 * In a quick match the room also keeps what each player's lane did, and when
 * their match ends - out, or the last one standing - hands it to the store as
 * their last build, for them to keep or not. At kickoff, a quick match's empty
 * seats go to saved builds first and to scripted builders after, so a player
 * who arrives to an empty room still plays three other people's play - and
 * where each of those builds placed is counted for the player who saved it.
 *
 * WHO IS IN A SEAT, AND WHAT THEY EARN (playerStore.ts)
 *
 * A player id is public, so a join that says one also carries the player's
 * key (net/identity.ts); an id with a key on record is refused with any other.
 * A player the server can vouch for this way has their match counted the
 * moment it ends for them - out, or the last one standing - with the same
 * rules their device counts by (progression/award.ts, `matchResultOf`), if
 * they are still there to see it: leaving early earns nothing, as the data
 * says. That count is what the Founders are made from. Their badges are
 * checked against it too, and the others are only shown the ones it bears
 * out. A name hidden after reports (moderation.ts) is shown as the default.
 */

import { Room, type Client } from 'colyseus';
import type { GameData } from '../src/data/schema.ts';
import {
  TICKS_PER_SECOND,
  applyCommand,
  createContext,
  createMatch,
  setLaneBuilder,
  step,
  viewFor,
  type Command,
  type MatchState,
  type SimContext,
} from '../src/sim/index.ts';
import { buildTables, encodeFrame, type WireHello, type WireTables } from '../src/net/protocol.ts';
import { acceptableName } from '../src/net/identity.ts';
import { matchResultOf } from '../src/progression/award.ts';
import {
  MAX_PLAYERS,
  PUBLIC_CODE,
  cleanBadgeIds,
  cleanLevel,
  cleanLooks,
  createSeats,
  lobbyViewFor,
  occupiedSeats,
  releaseSeat,
  seatPlayer,
  shouldStart,
  type LobbySeat,
  type LobbyTiming,
} from '../src/net/lobby.ts';
import { AutoBuilder } from '../src/bot/autoBuilder.ts';
import { GhostPlayer, GhostRecorder, portable } from '../src/bot/ghost.ts';
import { rollSeats } from '../src/bot/style.ts';
import { FixedTimestep, MS_PER_TICK } from '../src/util/loop.ts';
import type { GhostStore } from './ghostStore.ts';
import type { Moderation } from './moderation.ts';
import type { PlayerRecord, PlayerStore } from './playerStore.ts';

export { MAX_PLAYERS };

/** Lane ids are fixed and positional, so a reconnecting client can be seated. */
export const LANE_IDS = ['lane1', 'lane2', 'lane3', 'lane4'];

/**
 * How long a dropped player's seat is held. Long enough to cross a lift, a
 * tunnel or a network handover, short enough that a room full of ghosts frees
 * up while anyone still cares.
 */
export const DEFAULT_RECONNECT_SECONDS = 90;

/** Twice a second. The lobby is text; it does not need the tick rate. */
const LOBBY_BROADCAST_TICKS = TICKS_PER_SECOND / 2;

export interface RoomOptions extends Partial<LobbyTiming> {
  data: GameData;
  /** Start with fewer than four once this many seconds have passed. */
  autoStartSeconds: number;
  /** How long a dropped player may take to come back. */
  reconnectSeconds?: number;
  /**
   * The room's code. Empty for a quick match. Matched by Colyseus's `filterBy`,
   * so a private code only ever meets rooms opened with the same one.
   */
  code?: string;
  /** Where saved builds are kept. Without one, a quick match neither keeps nor uses them. */
  ghosts?: GhostStore;
  /** What the server keeps about players. Without it, nobody's match is counted and nobody wears a badge. */
  players?: PlayerStore;
  /** Names hidden after reports. */
  moderation?: Moderation;
}

/** What the join call carries: who you are and what you brought. */
export interface JoinOptions {
  playerId?: string;
  /** Proof the player id is this player's (net/identity.ts). */
  key?: string;
  name?: string;
  /** The player's level, for showing with their name (lobby.ts, `cleanLevel`). */
  level?: number;
  /** What the player is seen in (lobby.ts, `cleanLooks`). */
  looks?: unknown;
  /** The badges they wear, by id (lobby.ts, `cleanBadgeIds`): shown if their record bears them out. */
  badges?: unknown;
  builderId?: string;
  code?: string;
}

interface Seat {
  /** The part clients are shown, and the part lobby.ts reasons about. */
  lobby: LobbySeat;
  client: Client | null;
  /** Seated at kickoff if nobody took this lane and no saved build did. */
  bot: AutoBuilder | null;
  /** A saved build seated at kickoff, and whose it is. */
  ghost: { player: GhostPlayer; ownerId: string; savedAt: string } | null;
  /** This lane's match is over, and what follows from that has been done. */
  ended: boolean;
  /** The player's record, when the server can vouch for who they are (playerStore.ts). */
  record: PlayerRecord | null;
  /** Their match has been counted towards their XP. */
  counted: boolean;
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
  private sinceLobbyBroadcast = 0;
  private timing: LobbyTiming = { minWaitSeconds: 0, autoStartSeconds: 0 };
  private reconnectSeconds = DEFAULT_RECONNECT_SECONDS;
  private code = PUBLIC_CODE;
  private ghosts: GhostStore | null = null;
  private players: PlayerStore | null = null;
  private moderation: Moderation | null = null;
  private readonly recorder = new GhostRecorder();

  override onCreate(options: RoomOptions): void {
    this.data = options.data;
    this.code = options.code ?? PUBLIC_CODE;
    this.ghosts = options.ghosts ?? null;
    this.players = options.players ?? null;
    this.moderation = options.moderation ?? null;
    this.reconnectSeconds = options.reconnectSeconds ?? DEFAULT_RECONNECT_SECONDS;
    this.timing = {
      // A room that is not full waits this long before starting, so that the
      // first player to arrive and tap Ready does not take it to themselves.
      minWaitSeconds: options.minWaitSeconds ?? Math.min(10, options.autoStartSeconds),
      autoStartSeconds: options.autoStartSeconds,
    };

    // The code is metadata as well as a filter so that a client can read back
    // the code of the room it landed in rather than assuming it got the one it
    // asked for.
    this.setMetadata({ code: this.code }).catch(() => {});

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
    this.seats = createSeats(LANE_IDS).map((lobby) => ({
      lobby,
      client: null,
      bot: null,
      ghost: null,
      ended: false,
      record: null,
      counted: false,
    }));

    this.onMessage('command', (client, message: Command) => {
      const seat = this.seatOf(client);
      if (!seat) return;
      // A client may only act for its own lane, whatever it puts in the
      // message. This is the one line that makes the rest of the validation
      // meaningful.
      this.queued.push({
        command: { ...message, teamId: seat.lobby.teamId } as Command,
        client,
      });
    });

    // Lobby messages. All three are refused outright once the match has
    // started: a roster is a commitment (§7.1) and a ready tick means nothing
    // afterwards.
    this.onMessage('ready', (client, ready: boolean) => {
      const seat = this.seatOf(client);
      if (!seat || this.started) return;
      seat.lobby.ready = ready === true;
      this.broadcastLobby();
    });

    this.onMessage('builder', (client, builderId: string) => {
      const seat = this.seatOf(client);
      if (!seat || this.started) return;
      if (!this.data.units.builders.some((b) => b.id === builderId)) return;
      seat.lobby.builderId = builderId;
      this.broadcastLobby();
    });

    this.onMessage('name', (client, name: string) => {
      const seat = this.seatOf(client);
      if (!seat || this.started) return;
      // Cleaned and checked again here: the client does it for the player's
      // benefit, the server because the client is not trusted (§15.1, applied
      // to text). This string is drawn on three other people's screens, and a
      // name the filter refuses is stored empty, which every screen shows as
      // the player's default name - as is one hidden after reports.
      const chosen = acceptableName(String(name ?? ''));
      if (seat.record && chosen) this.players?.noteName(seat.record, chosen);
      seat.lobby.name = this.shownName(seat.lobby.playerId, chosen);
      this.broadcastLobby();
    });

    // Colyseus's interval gives real elapsed time; the simulation is fixed-step,
    // so the accumulator decides how many ticks that is worth (§15.1).
    this.setSimulationInterval((deltaMs) => this.advance(deltaMs), MS_PER_TICK);
  }

  override onJoin(client: Client, options?: JoinOptions): void {
    // A player id identifies a seat to reclaim and nothing else (identity.ts).
    // Without one, the session id stands in: that player gets a seat like
    // anyone else, but cannot reclaim it after a drop.
    const playerId = options?.playerId || client.sessionId;
    const seat = this.seats.find((s) => s.lobby.playerId === playerId);

    // The room locks at kickoff, so a new arrival mid-match is only possible
    // as a reclaim. Refused explicitly rather than seated into a lane whose
    // fortress somebody else has been defending.
    if (this.started && !seat) {
      client.leave(4001, 'match already started');
      return;
    }

    // The id is public; the key says it is this player's. An id with a key on
    // record is refused with any other, or none - that is a copied id.
    let record: PlayerRecord | null = null;
    if (this.players && options?.playerId) {
      if (options.key !== undefined || this.players.has(playerId)) {
        const proof = this.players.prove(playerId, options.key);
        if (!proof.ok) {
          client.leave(4003, 'that player id belongs to another device');
          return;
        }
        record = proof.record;
      }
    }

    const chosen = acceptableName(String(options?.name ?? ''));
    if (record && chosen) this.players?.noteName(record, chosen);
    if (record) this.players?.wear(record, cleanBadgeIds(options?.badges));
    const placed = seatPlayer(
      this.seats.map((s) => s.lobby),
      playerId,
      this.shownName(playerId, chosen),
      options?.builderId ?? '',
      cleanLevel(options?.level),
      cleanLooks(options?.looks),
      record && this.players ? this.players.shownBadges(record) : [],
    );
    if (!placed) {
      client.leave(4000, 'room full');
      return;
    }

    const mine = this.seats.find((s) => s.lobby === placed)!;
    mine.client = client;
    mine.record = record;

    const team = this.match.teams.find((t) => t.id === placed.teamId);
    if (team && !team.playerIds.includes(playerId)) team.playerIds.push(playerId);

    client.send('hello', this.helloFor(placed.teamId));
    this.broadcastLobby();
    if (this.started) this.sendFrame(mine);
  }

  /**
   * §13, §18: a player who leaves is not holding anyone hostage, and one whose
   * phone went into a tunnel has not left.
   *
   * Before kickoff, leaving frees the seat - there is nothing to come back to
   * and somebody else should be able to take the lane. After kickoff the seat
   * is held for `reconnectSeconds`, because there is: a half-built lane with
   * their name on it. While they are away the lane keeps taking waves with
   * nobody defending it, which is the behaviour §13 already describes, so a
   * drop costs them the time they were gone rather than the match.
   */
  override async onLeave(client: Client, consented?: boolean): Promise<void> {
    const seat = this.seats.find((s) => s.client === client);
    if (!seat) return;

    seat.client = null;
    seat.lobby.connected = false;

    if (!this.started || consented) {
      releaseSeat(seat.lobby);
      this.broadcastLobby();
      return;
    }

    this.broadcastLobby();

    try {
      const returned = await this.allowReconnection(client, this.reconnectSeconds);
      seat.client = returned;
      seat.lobby.connected = true;
      returned.send('hello', this.helloFor(seat.lobby.teamId));
      this.sendFrame(seat);
      this.broadcastLobby();
    } catch {
      // The window closed. The seat stays theirs for the rest of the match -
      // nobody else may have it, because the match is locked and the lane is
      // half theirs - and the lane plays on undefended.
      this.broadcastLobby();
    }
  }

  private seatOf(client: Client): Seat | undefined {
    return this.seats.find((s) => s.client === client);
  }

  /** The name to show for a player: theirs, or '' (their default) once it has been hidden after reports. */
  private shownName(playerId: string | null, name: string): string {
    return this.moderation ? this.moderation.shownName(playerId, name) : name;
  }

  private lobbySeats(): LobbySeat[] {
    return this.seats.map((s) => s.lobby);
  }

  private elapsedSeconds(): number {
    return this.waitingTicks / TICKS_PER_SECOND;
  }

  /** A quick match with somewhere to keep builds: it keeps them, and seats them. */
  private get keepsBuilds(): boolean {
    return this.ghosts !== null && this.code === PUBLIC_CODE;
  }

  /** One lobby message per client, each with their own seat marked. */
  private broadcastLobby(): void {
    this.sinceLobbyBroadcast = 0;
    const seats = this.lobbySeats();
    const elapsed = this.elapsedSeconds();
    for (const seat of this.seats) {
      if (!seat.client) continue;
      seat.client.send(
        'lobby',
        lobbyViewFor(
          seats,
          seat.lobby.playerId ?? '',
          this.code,
          elapsed,
          this.timing,
          this.started,
        ),
      );
    }
  }

  private advance(deltaMs: number): void {
    if (!this.started) {
      this.waitingTicks += 1;
      this.sinceLobbyBroadcast += 1;
      if (this.sinceLobbyBroadcast >= LOBBY_BROADCAST_TICKS) this.broadcastLobby();

      if (!shouldStart(this.lobbySeats(), this.elapsedSeconds(), this.timing)) return;
      this.kickOff();
    }

    this.timestep.advance(deltaMs, () => {
      // Applied here rather than handed to `step`, so that a refusal can be
      // sent back to the client that asked for it. `step` applies commands
      // first in any case, so this is the same order.
      for (const { command, client } of this.queued) {
        // Made portable before it is applied: a sale removes the unit it names.
        const kept = this.keepsBuilds ? portable(command, this.match, LANE_IDS) : null;
        const result = applyCommand(this.ctx, this.match, command);
        if (!result.ok && result.rejection) client.send('rejected', result.rejection);
        if (result.ok && kept) this.recorder.add(command.teamId, this.match, kept);
      }
      this.queued = [];

      // Saved builds play the way a tap does, and hear whether it was taken.
      for (const seat of this.seats) {
        seat.ghost?.player.act(this.match, (command) =>
          applyCommand(this.ctx, this.match, command),
        );
      }

      step(this.ctx, this.match, this.botCommands());
      this.settleEnds();
      this.countMatches();
    });

    for (const seat of this.seats) this.sendFrame(seat);

    if (this.match.finished) {
      this.broadcast('finished', {});
      this.disconnect().catch(() => {});
    }
  }

  /**
   * Lanes whose match has just ended - out, or the match over. A player's
   * build becomes their last one, to keep or not; a saved build's place is
   * counted for whoever saved it. Each once.
   */
  private settleEnds(): void {
    const store = this.ghosts;
    if (!store || !this.keepsBuilds) return;
    for (const seat of this.seats) {
      if (seat.ended) continue;
      const team = this.match.teams.find((t) => t.id === seat.lobby.teamId);
      if (!team || !(team.eliminated || this.match.finished)) continue;
      seat.ended = true;
      // The one left standing when the match ends is first, whether or not
      // the simulation wrote it down.
      const placement = team.placement ?? (team.eliminated ? null : 1);
      try {
        if (seat.ghost && placement !== null) {
          store.recordResult(seat.ghost.ownerId, seat.ghost.savedAt, placement);
        } else if (!seat.ghost && seat.lobby.playerId && !seat.bot) {
          store.setLast({
            playerId: seat.lobby.playerId,
            name: seat.lobby.name,
            level: seat.lobby.level,
            looks: seat.lobby.looks,
            builderId: this.match.lanes[seat.lobby.teamId]?.builderId ?? seat.lobby.builderId,
            wave: this.match.wave,
            placement,
            playedAt: new Date().toISOString(),
            actions: this.recorder.actionsOf(seat.lobby.teamId),
          });
        }
      } catch (error) {
        // A store that cannot write loses a build; it never stops a match.
        console.error('[lane-siege] could not keep a build:', error);
      }
    }
  }

  /**
   * Players whose match has just ended - out, or the match over - counted
   * towards the XP the server keeps for them (playerStore.ts), by the rules
   * their own device counts with, and only if they are here to see it end:
   * leaving early earns nothing. Each once. Quick matches and private rooms
   * alike: both are normal matches.
   */
  private countMatches(): void {
    const players = this.players;
    if (!players || !this.started) return;
    for (const seat of this.seats) {
      if (seat.counted || !seat.record) continue;
      const team = this.match.teams.find((t) => t.id === seat.lobby.teamId);
      if (!team || !(team.eliminated || this.match.finished)) continue;
      seat.counted = true;
      if (!seat.client) continue;
      const result = matchResultOf('online', {
        wave: this.match.wave,
        eliminated: team.eliminated,
        placement: team.placement,
        reachedShowdown: this.match.showdown?.armies.some((a) => a.teamId === team.id) ?? false,
      });
      try {
        players.recordOnline(seat.record, result);
      } catch (error) {
        // A record that cannot be written loses a match's XP; it never stops a match.
        console.error('[lane-siege] could not count a match:', error);
      }
    }
  }

  /**
   * What a client is told once, on the way in.
   *
   * The names ride along here rather than in every frame: a name does not
   * change once a match has begun, and twenty times a second is the wrong rate
   * for a string that never moves. A name set while the lobby is still filling
   * would be stale in the hello somebody already received, which is why
   * `kickOff` re-sends it to everyone with the final list.
   */
  private helloFor(teamId: string): WireHello {
    return {
      teamIds: LANE_IDS,
      teamId,
      seed: this.match.seed,
      teamNames: this.seats.map((seat) => seat.lobby.name),
      teamLevels: this.seats.map((seat) => seat.lobby.level),
      teamRecorded: this.seats.map((seat) => seat.ghost !== null),
      teamLooks: this.seats.map((seat) => seat.lobby.looks),
      teamBadges: this.seats.map((seat) => seat.lobby.badges),
    };
  }

  /**
   * From lobby to match: seat the rosters people chose, hand the empty lanes to
   * scripted builders, and lock the room.
   */
  private kickOff(): void {
    this.started = true;
    this.lock().catch(() => {});
    this.seatSavedBuilds();

    // Who everybody is, now that it is settled: the lobby is about to become
    // history, and the names in it are what the four tabs across the top of
    // every screen will be labelled with for the rest of the match.
    for (const seat of this.seats) {
      const team = this.match.teams.find((t) => t.id === seat.lobby.teamId);
      if (team) {
        team.name = seat.lobby.name;
        team.level = seat.lobby.level;
        team.recorded = seat.ghost !== null;
        team.looks = { ...seat.lobby.looks };
        team.badges = seat.lobby.badges.map((badge) => ({ ...badge }));
      }
    }
    this.tables = buildTables(
      this.data,
      LANE_IDS,
      this.match.seed,
      this.seats.map((seat) => seat.lobby.name),
      this.seats.map((seat) => seat.lobby.level),
      this.seats.map((seat) => seat.ghost !== null),
      this.seats.map((seat) => seat.lobby.looks),
      this.seats.map((seat) => seat.lobby.badges),
    );
    for (const seat of this.seats) {
      if (seat.client) seat.client.send('hello', this.helloFor(seat.lobby.teamId));
    }

    for (const seat of this.seats) {
      // §7.1: the roster each player settled on in the lobby. Applied here
      // rather than at join, because until kickoff they may still change it.
      if (seat.lobby.playerId && seat.lobby.builderId) {
        setLaneBuilder(this.data, this.match, seat.lobby.teamId, seat.lobby.builderId);
      }
    }

    // Whatever lanes nobody took are played by a scripted builder, so a
    // two-player game is still the four-lane match §17 describes rather than
    // two empty lanes whose fortresses fall unopposed in wave one. A seat whose
    // player merely dropped is NOT one of these: it is still theirs, and a bot
    // playing it would be playing somebody's half-built lane for them.
    //
    // Each plays a personality rolled from the match seed, as a practice
    // match's bots do (src/bot/style.ts).
    const empty = this.seats.filter((seat) => !seat.lobby.playerId);
    const styles = rollSeats(
      this.match.seed,
      empty.map((seat) => seat.lobby.teamId),
    );
    empty.forEach((seat, i) => {
      seat.bot = new AutoBuilder(
        this.data,
        seat.lobby.teamId,
        this.match.lanes[seat.lobby.teamId]?.builderId ?? '',
        { style: styles[i]!.style, seed: this.match.seed },
      );
    });

    this.broadcastLobby();
  }

  /**
   * A quick match's empty seats, given to saved builds: other players' play,
   * picked near the room's level and never the room's own players' builds.
   * Whatever seats are left go to scripted builders, as before. A build
   * plays the builder it was saved with, under its player's name and level.
   */
  private seatSavedBuilds(): void {
    if (!this.ghosts || !this.keepsBuilds) return;
    const empty = this.seats.filter((seat) => !seat.lobby.playerId);
    const humans = this.seats.filter((seat) => seat.lobby.playerId);
    if (empty.length === 0) return;
    const level =
      humans.reduce((sum, seat) => sum + seat.lobby.level, 0) / Math.max(1, humans.length);
    let picked: ReturnType<GhostStore['pick']> = [];
    try {
      picked = this.ghosts.pick(empty.length, {
        exclude: new Set(humans.map((seat) => seat.lobby.playerId!)),
        level,
        random: Math.random,
      });
    } catch (error) {
      console.error('[lane-siege] could not pick saved builds:', error);
    }
    picked.forEach((ghost, i) => {
      const seat = empty[i]!;
      if (!this.data.units.builders.some((b) => b.id === ghost.builderId)) return;
      // The badges its player wears now, as far as their record bears them out.
      const owner = this.players?.get(ghost.playerId) ?? null;
      Object.assign(seat.lobby, {
        // Never a real player's id, so nobody can reclaim it as their seat.
        playerId: `ghost:${ghost.playerId}`,
        name: this.shownName(ghost.playerId, acceptableName(ghost.name)),
        level: cleanLevel(ghost.level),
        looks: cleanLooks(ghost.looks),
        badges: owner && this.players ? this.players.shownBadges(owner) : [],
        builderId: ghost.builderId,
        ready: true,
        // Present, with no socket to lose: never shown as reconnecting.
        connected: true,
        recorded: true,
      });
      seat.ghost = {
        player: new GhostPlayer(seat.lobby.teamId, ghost.actions, LANE_IDS),
        ownerId: ghost.playerId,
        savedAt: ghost.savedAt,
      };
    });
  }

  /**
   * One frame per client, each filtered for that client (§12). Built per seat
   * rather than broadcast, because the whole point is that they differ.
   */
  private sendFrame(seat: Seat): void {
    if (!seat.client || !this.started) return;
    const view = viewFor(this.ctx, this.match, seat.lobby.teamId, this.data.lane.opponentLanes);
    seat.client.send('frame', encodeFrame(view, this.tables));
  }

  /** The scripted seats: they plan each build phase once and spend gems whenever the shop is open. */
  private botCommands(): Command[] {
    const commands: Command[] = [];
    for (const seat of this.seats) {
      if (seat.bot) commands.push(...seat.bot.plan(this.match));
    }
    return commands;
  }

  /** For the headless checks: how many seats a human holds right now. */
  occupied(): number {
    return occupiedSeats(this.lobbySeats()).length;
  }
}
