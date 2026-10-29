/**
 * What the server keeps about each player (playerStore.ts): an id taken by
 * the first key it comes with and no other; XP counted exactly as the device
 * counts it, from the matches the server can vouch for, under the same daily
 * cap however the days are reported; Founders made from that count and the
 * online matches; badges shown only when the record bears them out; and the
 * credits.
 */

import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { KeyValueStore } from '../src/net/identity.ts';
import type { CasualReport } from '../src/net/playerApi.ts';
import { matchResultOf } from '../src/progression/award.ts';
import { PROGRESSION } from '../src/progression/config.ts';
import { xpToReach } from '../src/progression/levels.ts';
import { dayKey } from '../src/progression/profile.ts';
import { ProgressStore } from '../src/progression/store.ts';
import { MemoryFounderStore, type FounderRules } from './founderStore.ts';
import { FilePlayerStore, PlayerStore, parseCasualReport, utcDay } from './playerStore.ts';
import { playerRules } from './routes.ts';

const KEY = '0123456789abcdef0123456789abcdef';
const OTHER = 'fedcba9876543210fedcba9876543210';
/** Midday, so the device's calendar day and the server's agree wherever the test runs. */
const NOW = new Date('2026-10-29T12:00:00Z');
const DAY = 86_400_000;

function memory(): KeyValueStore {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

function setup(rules: FounderRules = { count: 2, level: 3, onlineMatches: 1 }) {
  const founders = new MemoryFounderStore(rules);
  const players = new PlayerStore(playerRules(), founders);
  return { founders, players };
}

function proven(players: PlayerStore, playerId = 'ann', key = KEY) {
  const proof = players.prove(playerId, key, NOW);
  if (!proof.ok) throw new Error(`could not prove ${playerId}`);
  return proof.record;
}

const practice = (day: string, waves = 20): CasualReport => ({
  mode: 'practice',
  placement: 1,
  wavesSurvived: waves,
  wavesPlayed: waves,
  reachedShowdown: false,
  day,
});

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('who a player is', () => {
  it('takes an id with the first key it comes with, and refuses it with any other', () => {
    const { players } = setup();
    const first = players.prove('ann', KEY, NOW);
    expect(first.ok && first.created).toBe(true);
    const again = players.prove('ann', KEY, NOW);
    expect(again.ok && !again.created).toBe(true);
    expect(players.prove('ann', OTHER, NOW)).toEqual({ ok: false, reason: 'wrongKey' });
    expect(players.prove('ann', 'not a key', NOW)).toEqual({ ok: false, reason: 'badKey' });
    expect(players.prove('bo', undefined, NOW)).toEqual({ ok: false, reason: 'badKey' });
    expect(players.has('bo')).toBe(false);
  });

  it('keeps a hash of the key, never the key itself', () => {
    const { players } = setup();
    const record = proven(players);
    expect(JSON.stringify(record)).not.toContain(KEY);
    expect(record.keyHash).toBe(createHash('sha256').update(KEY).digest('hex'));
  });
});

describe('the XP the server counts', () => {
  it('counts an online match exactly as the device does, boost and all', () => {
    const { players } = setup({ count: 2, level: 30, onlineMatches: 1 });
    const record = proven(players);
    const device = new ProgressStore(memory(), () => NOW);
    const result = matchResultOf('online', {
      wave: 12,
      eliminated: true,
      placement: 2,
      reachedShowdown: false,
    });
    device.award(result);
    players.recordOnline(record, result, NOW);
    expect(record.xp).toBe(device.profile.xp);
    expect(record.onlineMatches).toBe(1);

    // An ad watched before the next one, on both sides.
    expect(device.startBoost()).toBe(true);
    expect(players.boost(record, NOW)).toBe(true);
    device.award(result);
    players.recordOnline(record, result, NOW);
    expect(record.xp).toBe(device.profile.xp);
    expect(record.adBoost).toEqual(device.profile.adBoost);
  });

  it('counts practice and solo under the same daily cap as the device', () => {
    const { players } = setup({ count: 2, level: 30, onlineMatches: 1 });
    const record = proven(players);
    const device = new ProgressStore(memory(), () => NOW);
    const day = dayKey(NOW);
    for (let i = 0; i < 4; i++) {
      device.award(
        matchResultOf('practice', {
          wave: 20,
          eliminated: false,
          placement: 1,
          reachedShowdown: false,
        }),
      );
      players.recordCasual(record, practice(day), NOW);
    }
    expect(record.casual[day]).toBe(PROGRESSION.casual.dailyCap);
    expect(record.xp).toBe(device.profile.xp);
  });

  it('gives each day its allowance once, however the days are reported', () => {
    const { players } = setup({ count: 2, level: 30, onlineMatches: 1 });
    const record = proven(players);
    const today = utcDay(NOW);
    const yesterday = utcDay(new Date(NOW.getTime() - DAY));
    const cap = PROGRESSION.casual.dailyCap;
    // Today, yesterday, today, yesterday...: two allowances, never more.
    for (let i = 0; i < 6; i++)
      players.recordCasual(record, practice(i % 2 ? yesterday : today), NOW);
    expect(record.xp).toBe(2 * cap);
    // A day the server cannot believe is counted as its own day, which is spent.
    players.recordCasual(record, practice('2001-01-01'), NOW);
    expect(record.xp).toBe(2 * cap);
    // Tomorrow is close enough to be a time zone, and gets its own.
    const tomorrow = utcDay(new Date(NOW.getTime() + DAY));
    for (let i = 0; i < 2; i++) players.recordCasual(record, practice(tomorrow), NOW);
    expect(record.xp).toBe(3 * cap);
  });

  it('refuses a match nobody could have played', () => {
    const base = practice('2026-10-29');
    expect(parseCasualReport(base)).not.toBeNull();
    expect(parseCasualReport({ ...base, mode: 'online' })).toBeNull();
    expect(parseCasualReport({ ...base, wavesSurvived: 21 })).toBeNull();
    expect(parseCasualReport({ ...base, wavesPlayed: 0, wavesSurvived: 0 })).toBeNull();
    expect(parseCasualReport({ ...base, wavesPlayed: 5000, wavesSurvived: 5000 })).toBeNull();
    expect(parseCasualReport({ ...base, placement: 5 })).toBeNull();
    expect(parseCasualReport({ ...base, wavesPlayed: 2.5 })).toBeNull();
    expect(parseCasualReport({ ...base, mode: 'solo' })).toBeNull();
    expect(parseCasualReport({ ...base, mode: 'solo', placement: null })).not.toBeNull();
    expect(
      parseCasualReport({ ...base, mode: 'solo', placement: null, reachedShowdown: true }),
    ).toBeNull();
    expect(parseCasualReport('a match')).toBeNull();
  });

  it('counts an ad once, not twice in a moment, and not when none is due', () => {
    const { players } = setup({ count: 2, level: 30, onlineMatches: 1 });
    const record = proven(players);
    const ad = PROGRESSION.adBoost;
    expect(players.boost(record, NOW)).toBe(true);
    expect(record.adBoost.wavesLeft).toBe(ad.waves);
    // Not twice in a moment, and not while enough are left that none is offered.
    expect(players.boost(record, new Date(NOW.getTime() + 5_000))).toBe(false);
    expect(players.boost(record, new Date(NOW.getTime() + 60_000))).toBe(false);
    // A six-wave match uses six; then one is due again, and they stack.
    const out = matchResultOf('online', {
      wave: 6,
      eliminated: true,
      placement: 4,
      reachedShowdown: false,
    });
    players.recordOnline(record, out, NOW);
    expect(record.adBoost.wavesLeft).toBe(ad.waves - 6);
    expect(players.boost(record, new Date(NOW.getTime() + 120_000))).toBe(true);
    expect(record.adBoost.wavesLeft).toBe(Math.min(ad.maxWaves, 2 * ad.waves - 6));
  });

  it('stops at the top level, as the device does', () => {
    const { players } = setup({ count: 2, level: 30, onlineMatches: 1 });
    const record = proven(players);
    const top = playerRules().topLevel;
    record.xp = xpToReach(top, PROGRESSION.levels) - 10;
    players.recordOnline(
      record,
      matchResultOf('online', { wave: 20, eliminated: false, placement: 1, reachedShowdown: true }),
      NOW,
    );
    expect(record.xp).toBe(xpToReach(top, PROGRESSION.levels));
    expect(players.level(record)).toBe(top);
  });
});

describe('Founders, from the server’s own count', () => {
  const win = matchResultOf('online', {
    wave: 20,
    eliminated: false,
    placement: 1,
    reachedShowdown: false,
  });

  it('makes a Founder the moment the count reaches the level with the online matches', () => {
    const { founders, players } = setup({ count: 2, level: 3, onlineMatches: 1 });
    const record = proven(players);
    players.recordOnline(record, win, NOW);
    expect(founders.numberOf('ann')).toBeNull();
    players.recordOnline(record, win, NOW);
    expect(players.level(record)).toBeGreaterThanOrEqual(3);
    expect(founders.numberOf('ann')).toBe(1);
    expect(players.summary(record).founderNumber).toBe(1);
  });

  it('needs the online matches: practice alone never makes one', () => {
    const { founders, players } = setup({ count: 2, level: 3, onlineMatches: 1 });
    const record = proven(players);
    for (const offset of [-DAY, 0, DAY]) {
      for (let i = 0; i < 3; i++)
        players.recordCasual(record, practice(utcDay(new Date(NOW.getTime() + offset))), NOW);
    }
    expect(players.level(record)).toBeGreaterThanOrEqual(3);
    expect(founders.numberOf('ann')).toBeNull();
    players.recordOnline(
      record,
      matchResultOf('online', { wave: 1, eliminated: true, placement: 4, reachedShowdown: false }),
      NOW,
    );
    expect(founders.numberOf('ann')).toBe(1);
  });

  it('cannot be had by a copied id', () => {
    const { founders, players } = setup({ count: 2, level: 3, onlineMatches: 1 });
    const record = proven(players);
    players.recordOnline(record, win, NOW);
    players.recordOnline(record, win, NOW);
    expect(founders.numberOf('ann')).toBe(1);
    expect(players.prove('ann', OTHER, NOW).ok).toBe(false);
  });
});

describe('the badges the others see', () => {
  it('shows only what the record bears out, in the game’s order, with the Founder’s number', () => {
    const { players } = setup({ count: 2, level: 3, onlineMatches: 1 });
    const record = proven(players);
    players.wear(record, ['badge_founder', 'badge_veteran', 'badge_supporter']);
    expect(players.shownBadges(record)).toEqual([]);

    players.setSupporter(record, 'test');
    expect(players.shownBadges(record)).toEqual([{ id: 'badge_supporter', number: null }]);

    // Veteran is the server's level 10, whatever the device says.
    record.xp = xpToReach(10, PROGRESSION.levels);
    players.recordOnline(
      record,
      matchResultOf('online', { wave: 1, eliminated: true, placement: 4, reachedShowdown: false }),
      NOW,
    );
    expect(players.shownBadges(record)).toEqual([
      { id: 'badge_supporter', number: null },
      { id: 'badge_veteran', number: null },
      { id: 'badge_founder', number: 1 },
    ]);
    // Not wearing one is not showing it.
    players.wear(record, ['badge_founder']);
    expect(players.shownBadges(record)).toEqual([{ id: 'badge_founder', number: 1 }]);
  });
});

describe('the credits', () => {
  it('lets only a Supporter or a Founder in, and the admin can take a name away for good', () => {
    const { players } = setup({ count: 2, level: 3, onlineMatches: 1 });
    const ann = proven(players, 'ann');
    expect(players.setCreditName(ann, 'Ann B')).toBe('notSupporter');
    players.setSupporter(ann, 'test', NOW);
    expect(players.setCreditName(ann, 'Ann B')).toBe('ok');
    const bo = proven(players, 'bo', OTHER);
    players.setSupporter(bo, 'revenuecat', new Date(NOW.getTime() + 1000));
    players.setCreditName(bo, 'Bo');
    expect(players.credits().supporters).toEqual([{ name: 'Ann B' }, { name: 'Bo' }]);

    players.blockCredit(bo);
    expect(players.credits().supporters).toEqual([{ name: 'Ann B' }]);
    expect(players.setCreditName(bo, 'Bo again')).toBe('blocked');
  });

  it('lists a Founder once, by number, with the name they chose', () => {
    const { players } = setup({ count: 2, level: 3, onlineMatches: 1 });
    const ann = proven(players);
    const win = matchResultOf('online', {
      wave: 20,
      eliminated: false,
      placement: 1,
      reachedShowdown: false,
    });
    players.recordOnline(ann, win, NOW);
    players.recordOnline(ann, win, NOW);
    players.setSupporter(ann, 'test');
    expect(players.setCreditName(ann, 'Ann the First')).toBe('ok');
    expect(players.credits()).toEqual({
      founders: [{ number: 1, name: 'Ann the First' }],
      supporters: [],
    });
  });
});

describe('on disk', () => {
  it('keeps every record across a restart, and forgets one that asks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lane-siege-players-'));
    dirs.push(dir);
    const founders = new MemoryFounderStore({ count: 2, level: 3, onlineMatches: 1 });
    const store = new FilePlayerStore(playerRules(), founders, dir);
    const ann = store.prove('ann', KEY, NOW);
    if (!ann.ok) throw new Error('no record');
    store.recordCasual(ann.record, practice(utcDay(NOW)), NOW);
    store.wear(ann.record, ['badge_veteran']);

    const again = new FilePlayerStore(playerRules(), founders, dir);
    const back = again.get('ann');
    expect(back?.xp).toBe(ann.record.xp);
    expect(back?.badges).toEqual(['badge_veteran']);
    expect(again.prove('ann', OTHER, NOW).ok).toBe(false);
    expect(again.prove('ann', KEY, NOW).ok).toBe(true);

    expect(again.delete('ann')).toBe(true);
    expect(readdirSync(dir).filter((f) => f.endsWith('.json'))).toEqual([]);
    expect(new FilePlayerStore(playerRules(), founders, dir).has('ann')).toBe(false);
  });
});
