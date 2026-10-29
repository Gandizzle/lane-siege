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
 * Empty seats are played from kickoff (server/room.ts) - in a quick match by
 * other players' saved builds first and scripted builders after - so a
 * two-player match is still the four-lane match §17 describes.
 */

import { COSMETICS, type CosmeticsConfig } from '../progression/config.ts';
import { NO_LOOKS, type Looks, type WornBadge } from '../sim/index.ts';

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
  /**
   * The player's level (src/progression), shown with their name; 0 for an
   * empty seat or a player who did not say. A claim, like the name - it buys
   * nothing but the right to be looked at.
   */
  level: number;
  /**
   * What the player is seen in (`Looks`): their fortress, their shots, their
   * spoke and their win. Nothing for an empty seat or a scripted builder.
   */
  looks: Looks;
  /**
   * The badges beside their name (`WornBadge`): what they wear, as the server
   * checked it against what they have earned. None for an empty seat, a
   * scripted builder or a player the server cannot vouch for.
   */
  badges: WornBadge[];
  /** The roster this player has chosen (§7.1). */
  builderId: string;
  /** Has confirmed their roster and wants to start. */
  ready: boolean;
  /** Holds the seat but the socket is gone - reconnecting, or gone for good. */
  connected: boolean;
  /**
   * Played by a saved build rather than a live player (src/bot/ghost.ts):
   * seated at kickoff, into a quick match's empty seat.
   */
  recorded: boolean;
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
    level: 0,
    looks: { ...NO_LOOKS },
    badges: [],
    builderId: '',
    ready: false,
    connected: false,
    recorded: false,
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
  level = 0,
  looks: Looks = NO_LOOKS,
  badges: readonly WornBadge[] = [],
): LobbySeat | null {
  const existing = seats.find((s) => s.playerId === playerId);
  if (existing) {
    // A seat taken back keeps the looks it had: once a match has begun, the
    // others were told them at kickoff, and a change would only reach some.
    existing.connected = true;
    if (name) existing.name = name;
    if (builderId) existing.builderId = builderId;
    if (level > 0) existing.level = level;
    // Badges are earned rather than chosen for show, so a seat taken back
    // before kickoff wears what was checked this time.
    existing.badges = badges.map((badge) => ({ ...badge }));
    return existing;
  }

  const free = seats.find((s) => s.playerId === null);
  if (!free) return null;

  free.playerId = playerId;
  free.name = name;
  free.level = level;
  free.looks = { ...looks };
  free.badges = badges.map((badge) => ({ ...badge }));
  free.builderId = builderId;
  free.ready = false;
  free.connected = true;
  free.recorded = false;
  return free;
}

/** Give up a seat entirely, so somebody else may take it. */
export function releaseSeat(seat: LobbySeat): void {
  seat.playerId = null;
  seat.name = '';
  seat.level = 0;
  seat.looks = { ...NO_LOOKS };
  seat.badges = [];
  seat.builderId = '';
  seat.ready = false;
  seat.connected = false;
  seat.recorded = false;
}

/**
 * A level as a client claimed it, made safe to draw: a whole number from 0 to
 * a million, and 0 for anything else. Like a name, cleaned by the server
 * because the client is not trusted (§15.1) - though a forged level fools
 * nobody about anything that matters.
 */
export function cleanLevel(claimed: unknown): number {
  if (typeof claimed !== 'number' || !Number.isFinite(claimed)) return 0;
  return Math.max(0, Math.min(1_000_000, Math.floor(claimed)));
}

/**
 * Looks as a client claimed them, made safe to draw: each one a cosmetic that
 * exists, in the slot it is claimed for (data/cosmetics.json), and nothing
 * for anything else. Like the level, a claim rather than a proof - whether it
 * was unlocked is the player's device's to say (src/progression) - and like
 * the level, a forged one fools nobody about anything that matters.
 */
export function cleanLooks(claimed: unknown, cosmetics: CosmeticsConfig = COSMETICS): Looks {
  const r =
    typeof claimed === 'object' && claimed !== null ? (claimed as Record<string, unknown>) : {};
  const one = (slot: keyof Looks): string | null => {
    const id = r[slot];
    const known = cosmetics.cosmetics.some((c) => c.id === id && c.slot === slot);
    return typeof id === 'string' && known ? id : null;
  };
  return {
    fortress: one('fortress'),
    trail: one('trail'),
    floor: one('floor'),
    victory: one('victory'),
  };
}

/** How many badges a player may wear at once, as far as anyone else is shown. */
export const MAX_SHOWN_BADGES = 3;

/**
 * The badges a client says it wears, made safe to check: ids of badges that
 * exist (cosmetics.json's badge slot), each once, at most `MAX_SHOWN_BADGES`.
 * Whether the player has EARNED each one is the server's to check against its
 * own record of them (server/playerStore.ts) - a badge it cannot vouch for is
 * left off, unlike a look, because a badge is a claim about the player.
 */
export function cleanBadgeIds(claimed: unknown, cosmetics: CosmeticsConfig = COSMETICS): string[] {
  if (!Array.isArray(claimed)) return [];
  const known = new Set(cosmetics.cosmetics.filter((c) => c.slot === 'badge').map((c) => c.id));
  const ids: string[] = [];
  for (const id of claimed) {
    if (typeof id === 'string' && known.has(id) && !ids.includes(id)) ids.push(id);
    if (ids.length === MAX_SHOWN_BADGES) break;
  }
  return ids;
}

/**
 * Badges as the server sent them, made safe to draw: known badge ids, a
 * Founder's number a whole number from 1 up, at most `MAX_SHOWN_BADGES`.
 */
export function cleanWornBadges(
  sent: unknown,
  cosmetics: CosmeticsConfig = COSMETICS,
): WornBadge[] {
  if (!Array.isArray(sent)) return [];
  const known = new Set(cosmetics.cosmetics.filter((c) => c.slot === 'badge').map((c) => c.id));
  const badges: WornBadge[] = [];
  for (const item of sent) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== 'string' || !known.has(r.id) || badges.some((b) => b.id === r.id)) continue;
    const number =
      typeof r.number === 'number' && Number.isFinite(r.number) && r.number >= 1
        ? Math.floor(r.number)
        : null;
    badges.push({ id: r.id, number });
    if (badges.length === MAX_SHOWN_BADGES) break;
  }
  return badges;
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
