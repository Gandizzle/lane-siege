/**
 * The lobby rules. See lobby.ts for the model.
 *
 * What the rest of matchmaking rests on: a seat belongs to a player rather than
 * to a connection, so a reconnection gets its own lane back; a match starts
 * when everyone present is ready but not before latecomers have had a moment;
 * and it starts anyway rather than letting one player hold three others up.
 */

import { describe, expect, it } from 'vitest';
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  cleanLevel,
  cleanLooks,
  createSeats,
  lobbyViewFor,
  makeCode,
  normaliseCode,
  occupiedSeats,
  releaseSeat,
  seatPlayer,
  secondsUntilStart,
  shouldStart,
  type LobbyTiming,
} from './lobby.ts';
import { NO_LOOKS } from '../sim/index.ts';

const TEAMS = ['lane1', 'lane2', 'lane3', 'lane4'];
const TIMING: LobbyTiming = { minWaitSeconds: 10, autoStartSeconds: 60 };

function lobbyOf(count: number, ready = false) {
  const seats = createSeats(TEAMS);
  for (let i = 0; i < count; i++) {
    const seat = seatPlayer(seats, `p${i}`, `Player ${i}`, 'ironvow');
    if (seat) seat.ready = ready;
  }
  return seats;
}

describe('seats belong to players, not to connections', () => {
  it('seats a new player in the first free lane', () => {
    const seats = createSeats(TEAMS);
    expect(seatPlayer(seats, 'a', 'Ann', 'ironvow')?.teamId).toBe('lane1');
    expect(seatPlayer(seats, 'b', 'Bo', 'pyre')?.teamId).toBe('lane2');
  });

  it('gives a returning player their own lane back, not the first free one', () => {
    const seats = createSeats(TEAMS);
    seatPlayer(seats, 'a', 'Ann', 'ironvow');
    const mine = seatPlayer(seats, 'b', 'Bo', 'pyre')!;
    seatPlayer(seats, 'c', 'Cai', 'thornweald');

    // Bo drops: the seat is held, not released.
    mine.connected = false;
    expect(seatPlayer(seats, 'b', 'Bo', 'pyre')?.teamId).toBe('lane2');
    expect(occupiedSeats(seats)).toHaveLength(3);
  });

  it('keeps a returning player’s roster and ready state', () => {
    const seats = createSeats(TEAMS);
    const seat = seatPlayer(seats, 'a', 'Ann', 'gloomtide')!;
    seat.ready = true;
    seat.connected = false;

    const back = seatPlayer(seats, 'a', '', '')!;
    expect(back.builderId).toBe('gloomtide');
    expect(back.ready).toBe(true);
    expect(back.connected).toBe(true);
  });

  it('refuses a fifth player', () => {
    const seats = lobbyOf(4);
    expect(seatPlayer(seats, 'p9', 'Late', 'ironvow')).toBeNull();
  });

  it('frees a released seat for somebody else', () => {
    const seats = lobbyOf(4);
    releaseSeat(seats[1]!);
    expect(seatPlayer(seats, 'p9', 'Late', 'ironvow')?.teamId).toBe('lane2');
  });
});

describe('when the match starts', () => {
  it('does not start an empty room, ever', () => {
    expect(shouldStart(createSeats(TEAMS), 999, TIMING)).toBe(false);
  });

  it('waits for a player who has not readied', () => {
    const seats = lobbyOf(2);
    seats[0]!.ready = true;
    expect(shouldStart(seats, 30, TIMING)).toBe(false);
  });

  it('starts a full room the moment everyone is ready', () => {
    expect(shouldStart(lobbyOf(4, true), 0, TIMING)).toBe(true);
  });

  it('holds a half-full room briefly even when everyone in it is ready', () => {
    const seats = lobbyOf(1, true);
    // A solo player who taps Ready instantly would otherwise take a
    // four-player room to themselves before anyone could arrive.
    expect(shouldStart(seats, 0, TIMING)).toBe(false);
    expect(shouldStart(seats, TIMING.minWaitSeconds, TIMING)).toBe(true);
  });

  it('starts anyway rather than letting one player hold the rest up', () => {
    const seats = lobbyOf(3);
    seats[0]!.ready = true;
    seats[1]!.ready = true;
    expect(shouldStart(seats, TIMING.autoStartSeconds - 1, TIMING)).toBe(false);
    expect(shouldStart(seats, TIMING.autoStartSeconds, TIMING)).toBe(true);
  });

  it('counts a dropped player as present, so one bad connection cannot stall it', () => {
    const seats = lobbyOf(2, true);
    seats[1]!.connected = false;
    expect(shouldStart(seats, TIMING.minWaitSeconds, TIMING)).toBe(true);
  });
});

describe('the countdown', () => {
  it('shows the short wait once everyone present is ready', () => {
    expect(secondsUntilStart(lobbyOf(2, true), 4, TIMING)).toBe(TIMING.minWaitSeconds - 4);
  });

  it('shows the long wait while somebody is not ready', () => {
    expect(secondsUntilStart(lobbyOf(2), 4, TIMING)).toBe(TIMING.autoStartSeconds - 4);
  });

  it('never goes below zero', () => {
    expect(secondsUntilStart(lobbyOf(2, true), 999, TIMING)).toBe(0);
  });
});

describe('the view one client gets', () => {
  it('marks the seat that belongs to them, and copies the rest', () => {
    const seats = lobbyOf(3);
    const view = lobbyViewFor(seats, 'p1', 'QRST', 2, TIMING, false);

    expect(view.yourSeat).toBe(1);
    expect(view.code).toBe('QRST');
    expect(view.seats).toHaveLength(4);
    expect(view.seats[3]!.playerId).toBeNull();
    // A copy: mutating the room's seats later must not change a sent view.
    seats[0]!.name = 'changed';
    expect(view.seats[0]!.name).toBe('Player 0');
  });

  it('says -1 for a client with no seat, such as one that arrived full', () => {
    expect(lobbyViewFor(lobbyOf(4), 'nobody', '', 0, TIMING, false).yourSeat).toBe(-1);
  });
});

describe('room codes', () => {
  it('is four characters from an alphabet with no ambiguous pairs', () => {
    let n = 0;
    const code = makeCode(() => (n++ % CODE_ALPHABET.length) / CODE_ALPHABET.length);
    expect(code).toHaveLength(CODE_LENGTH);
    for (const character of code) expect(CODE_ALPHABET).toContain(character);
    for (const character of 'IO01') expect(CODE_ALPHABET).not.toContain(character);
  });

  it('stays in the alphabet even when the source returns its upper bound', () => {
    expect(makeCode(() => 1)).toHaveLength(CODE_LENGTH);
    expect(CODE_ALPHABET).toContain(makeCode(() => 1)[0]!);
  });

  it('takes a typed code in any case, with spaces', () => {
    expect(normaliseCode(' qr st ')).toBe('QRST');
  });

  it('drops characters that were never in a code rather than guessing', () => {
    expect(normaliseCode('Q1R0S')).toBe('QRS');
    expect(normaliseCode('!!!!')).toBe('');
  });

  it('takes only the first four', () => {
    expect(normaliseCode('QRSTUVWX')).toBe('QRST');
  });
});

describe('a level comes with the name (src/progression)', () => {
  it('seats a player with the level they claimed, and keeps it on a reconnection', () => {
    const seats = createSeats(TEAMS);
    const seat = seatPlayer(seats, 'p1', 'Ann', 'ironvow', 12)!;
    expect(seat.level).toBe(12);
    // A reconnection that says nothing keeps what was said before.
    expect(seatPlayer(seats, 'p1', '', '', 0)!.level).toBe(12);
    releaseSeat(seat);
    expect(seat.level).toBe(0);
  });

  it('cleans a claimed level into a whole number it is safe to draw', () => {
    expect(cleanLevel(7)).toBe(7);
    expect(cleanLevel(7.9)).toBe(7);
    expect(cleanLevel(-3)).toBe(0);
    expect(cleanLevel(1e12)).toBe(1_000_000);
    expect(cleanLevel('9')).toBe(0);
    expect(cleanLevel(Number.NaN)).toBe(0);
    expect(cleanLevel(undefined)).toBe(0);
  });

  it('keeps the looks a seat was taken with, and lets them go with it', () => {
    const seats = createSeats(['a', 'b']);
    const worn = { ...NO_LOOKS, fortress: 'fortress_granite', trail: 'trail_frost' };
    const seat = seatPlayer(seats, 'p1', 'Ann', 'ironvow', 3, worn)!;
    expect(seat.looks).toEqual(worn);
    // Taken back mid-match, it keeps what everyone was told at kickoff.
    expect(seatPlayer(seats, 'p1', '', '', 0, NO_LOOKS)!.looks).toEqual(worn);
    releaseSeat(seat);
    expect(seat.looks).toEqual(NO_LOOKS);
    expect(seats[1]!.looks).toEqual(NO_LOOKS);
  });

  it('cleans claimed looks to cosmetics that exist, each in its own slot', () => {
    expect(
      cleanLooks({
        fortress: 'fortress_gilded',
        trail: 'trail_ember',
        floor: 'floor_checker',
        victory: 'victory_fireworks',
      }),
    ).toEqual({
      fortress: 'fortress_gilded',
      trail: 'trail_ember',
      floor: 'floor_checker',
      victory: 'victory_fireworks',
    });
    // A look from another slot, one that does not exist, and junk.
    expect(
      cleanLooks({ fortress: 'trail_ember', trail: 'trail_lasers', floor: 7, victory: {} }),
    ).toEqual(NO_LOOKS);
    for (const junk of [null, undefined, 'fortress_gilded', 3, []]) {
      expect(cleanLooks(junk)).toEqual(NO_LOOKS);
    }
  });
});
