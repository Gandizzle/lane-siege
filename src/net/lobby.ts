/**
 * The lobby: who is in this match, and when does it start. §17 (M6), §18.
 *
 * DESIGN.md leaves the lobby OPEN, so the rules are decided here and recorded
 * in docs/OPEN-QUESTIONS.md. This module is the rules themselves, as pure
 * functions over a seat list - no sockets, no Colyseus, no clock. The room
 * (server/room.ts) owns the sockets and asks this module what to do; the tests
 * ask it the same questions without a network.
 *
 * WHY A PLAYER ID AND NOT A SESSION ID
 *
 * A seat belongs to a PLAYER, not to a connection. Colyseus hands out a new
 * session id every time a socket opens, so a player who drops and comes back is
 * a different session and would be seated in a different lane - arriving as a
 * stranger in somebody else's half-built lane. Seats are therefore keyed by a
 * player id the client generates once and keeps (identity.ts), which is also
 * what makes reconnection mean "your lane back" rather than "a lane".
 *
 * WHEN THE MATCH STARTS
 *
 * Three conditions, in the order they fire:
 *
 *   1. Everyone present is ready and the room is full - start now, there is
 *      nobody left to wait for.
 *   2. Everyone present is ready and the lobby has been open `minWaitSeconds` -
 *      start, but give latecomers a moment first, or a fast solo player takes
 *      a four-player room to themselves the instant they tap Ready.
 *   3. `autoStartSeconds` have passed - start regardless.
 *
 * The third is the AFK rule (§18, OPEN), and it is the same principle §3.2
 * already applies to waves: one slow player may not hold three others hostage.
 * A player who has not readied is still seated and still plays; they simply did
 * not confirm a roster, and get the one their lane was created with.
 *
 * Empty seats are played by a scripted builder from kickoff (server/room.ts),
 * so a two-player match is still the four-lane match §17 describes.
 */

/**
 * Room-code alphabet: no I, O, 0 or 1, because a code is read off one screen
 * and typed into another and those four are the pairs people get wrong.
 */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Four characters: ~1M codes, short enough to say out loud. */
export const CODE_LENGTH = 4;

/**
 * The code a quick match uses. Empty rather than absent so that one matchmaking
 * call serves both cases: Colyseus filters rooms by this field, and "no code"
 * is just another value to filter on.
 */
export const PUBLIC_CODE = '';

/** §2: four lanes, one player each in v1. */
export const MAX_PLAYERS = 4;

export interface LobbySeat {
  /** The lane this seat plays. Fixed and positional (§2). */
  teamId: string;
  /** Null when nobody holds the seat. */
  playerId: string | null;
  /** Display name, or empty for an empty seat. */
  name: string;
  /** The roster this player has chosen (§7.1). */
  builderId: string;
  /** Has confirmed their roster and wants to start. */
  ready: boolean;
  /** Holds the seat but the socket is gone - reconnecting, or gone for good. */
  connected: boolean;
}

/** What one client is told about the lobby. Their own seat is marked. */
export interface LobbyView {
  /** The room's code, or `PUBLIC_CODE` for a quick match. */
  code: string;
  seats: LobbySeat[];
  /** Index into `seats` of the seat this client holds, or -1. */
  yourSeat: number;
  /** Whole seconds until the match starts anyway. */
  secondsLeft: number;
  /** True once the match has begun; the lobby is then history. */
  started: boolean;
}

export interface LobbyTiming {
  /** Wait at least this long before starting a room that is not full. */
  minWaitSeconds: number;
  /** Start regardless after this long. The AFK rule. */
  autoStartSeconds: number;
}

/** A fresh, empty seat per lane. */
export function createSeats(teamIds: readonly string[]): LobbySeat[] {
  return teamIds.map((teamId) => ({
    teamId,
    playerId: null,
    name: '',
    builderId: '',
    ready: false,
    connected: false,
  }));
}

/**
 * Seat a player: their own seat if they already hold one (a reconnection), or
 * the first free one. Null when the room is full.
 *
 * Reclaiming is checked first and unconditionally, so a player whose socket
 * dropped comes back to their own lane even if free seats exist - the whole
 * point of keying seats by player.
 */
export function seatPlayer(
  seats: LobbySeat[],
  playerId: string,
  name: string,
  builderId: string,
): LobbySeat | null {
  const existing = seats.find((s) => s.playerId === playerId);
  if (existing) {
    existing.connected = true;
    if (name) existing.name = name;
    if (builderId) existing.builderId = builderId;
    return existing;
  }

  const free = seats.find((s) => s.playerId === null);
  if (!free) return null;

  free.playerId = playerId;
  free.name = name;
  free.builderId = builderId;
  free.ready = false;
  free.connected = true;
  return free;
}

/** Give up a seat entirely, so somebody else may take it. */
export function releaseSeat(seat: LobbySeat): void {
  seat.playerId = null;
  seat.name = '';
  seat.builderId = '';
  seat.ready = false;
  seat.connected = false;
}

export function occupiedSeats(seats: readonly LobbySeat[]): LobbySeat[] {
  return seats.filter((s) => s.playerId !== null);
}

/**
 * Should the match start? See the three conditions at the top of this file.
 *
 * A seat whose player has dropped still counts as present and its ready state
 * still counts: they may be back within seconds, and a room that restarts its
 * wait every time somebody's phone sleeps never starts at all.
 */
export function shouldStart(
  seats: readonly LobbySeat[],
  elapsedSeconds: number,
  timing: LobbyTiming,
): boolean {
  const present = occupiedSeats(seats);
  if (present.length === 0) return false;
  if (elapsedSeconds >= timing.autoStartSeconds) return true;

  const allReady = present.every((s) => s.ready);
  if (!allReady) return false;

  const full = present.length >= seats.length;
  return full || elapsedSeconds >= timing.minWaitSeconds;
}

/**
 * Seconds until the match starts anyway, for the countdown on screen.
 *
 * It shows the nearer of the two deadlines that can actually fire, so the
 * number on screen is the one the player is waiting on: the short wait once
 * everyone present is ready, the long AFK deadline otherwise.
 */
export function secondsUntilStart(
  seats: readonly LobbySeat[],
  elapsedSeconds: number,
  timing: LobbyTiming,
): number {
  const present = occupiedSeats(seats);
  if (present.length === 0) return Math.max(0, Math.ceil(timing.autoStartSeconds - elapsedSeconds));

  const deadline = present.every((s) => s.ready) ? timing.minWaitSeconds : timing.autoStartSeconds;
  return Math.max(0, Math.ceil(Math.min(deadline, timing.autoStartSeconds) - elapsedSeconds));
}

/** The view one client gets: the whole seat list, with their own marked. */
export function lobbyViewFor(
  seats: readonly LobbySeat[],
  playerId: string,
  code: string,
  elapsedSeconds: number,
  timing: LobbyTiming,
  started: boolean,
): LobbyView {
  return {
    code,
    seats: seats.map((s) => ({ ...s })),
    yourSeat: seats.findIndex((s) => s.playerId === playerId),
    secondsLeft: secondsUntilStart(seats, elapsedSeconds, timing),
    started,
  };
}

/**
 * A room code from a random source. The source is a parameter so that a test
 * can hand it a counter and the browser can hand it `crypto`.
 *
 * `random` must return a float in [0, 1).
 */
export function makeCode(random: () => number): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    const index = Math.min(CODE_ALPHABET.length - 1, Math.floor(random() * CODE_ALPHABET.length));
    code += CODE_ALPHABET[index];
  }
  return code;
}

/**
 * Clean a typed code into one that can be matched: upper case, with spaces and
 * punctuation dropped and anything outside the alphabet discarded.
 *
 * No attempt is made to guess at a typo. The alphabet has no ambiguous pairs in
 * it, so a character outside it was never in the code, and silently folding it
 * onto a neighbour would send the player confidently into the wrong room. A
 * wrong code lands in an empty room of that name, which is visible on screen
 * and fixed by retyping.
 */
export function normaliseCode(typed: string): string {
  let code = '';
  for (const character of typed.toUpperCase()) {
    if (CODE_ALPHABET.includes(character)) code += character;
    if (code.length === CODE_LENGTH) break;
  }
  return code;
}
