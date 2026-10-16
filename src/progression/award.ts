/**
 * XP for a match: what it earned, line by line, and what the boosts added.
 *
 * WHERE IT COMES FROM
 *
 * A normal match - against other people, online - is where XP is earned. It
 * pays for finishing (your match, not everybody's: eliminated counts), for
 * every wave survived, for the placement, and for reaching the Final
 * Showdown. Losing still earns: a player out on wave 6 has to come away with
 * something, or the second match never happens.
 *
 * Practice and solo pay a little, once a day (`casual.gamesPerDay`) - enough
 * that playing alone is not a dead end, not enough to be the way to level, and
 * not enough to be worth cheating at while the device is what keeps score.
 *
 * BOOSTS
 *
 * The opt-in ad adds a share of the base to the next few matches that earn
 * anything, and Supporter adds a share to all of them. They ADD, as the
 * business plan has it: both together are 1 + 1.0 + 0.25, not 2 × 1.25. A
 * match that earns nothing - practice after the day's allowance - does not use
 * up a boosted match, since there was nothing for it to boost.
 *
 * Pure: the profile in, the award and the next profile out. The day is passed
 * in rather than read, so a test can be on any day it likes.
 */

import type { ProgressionConfig } from './config.ts';
import type { Profile } from './profile.ts';

/** How the match was played, which decides what it can earn. */
export type XpMode = 'online' | 'practice' | 'solo';

/** Everything about a finished match that XP is counted from. */
export interface MatchResult {
  mode: XpMode;
  /** Where you finished, 1 being the winner. Null if none was locked in. */
  placement: number | null;
  /** Waves your lane got through. */
  wavesSurvived: number;
  /** Your army reached the Final Showdown. */
  reachedShowdown: boolean;
}

export type XpLineId =
  'played' | 'waves' | 'placement' | 'showdown' | 'daily' | 'adBoost' | 'supporter';

/** One line of the breakdown the popup shows. */
export interface XpLine {
  id: XpLineId;
  label: string;
  xp: number;
}

export interface XpAward {
  /** What the match itself earned, in the order the popup lists it. */
  lines: XpLine[];
  /** What the boosts added on top. */
  boosts: XpLine[];
  /** The sum of `lines`. */
  base: number;
  /** Everything: `lines` and `boosts`. */
  total: number;
  /** Said under the breakdown when something wants explaining - usually why it is zero. */
  note: string | null;
}

/** 1 → "1st". */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen
    ? 'th'
    : n % 10 === 1
      ? 'st'
      : n % 10 === 2
        ? 'nd'
        : n % 10 === 3
          ? 'rd'
          : 'th';
  return `${n}${suffix}`;
}

/** 0.25 → "25%". */
export function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function timesADay(n: number): string {
  return n === 1 ? 'once a day' : `${n} times a day`;
}

/** The XP a finished match earns, and the profile with it added. */
export function awardXp(
  config: ProgressionConfig,
  profile: Profile,
  result: MatchResult,
  today: string,
): { award: XpAward; profile: Profile } {
  const next = structuredClone(profile);
  const lines: XpLine[] = [];
  let note: string | null = null;

  if (result.mode === 'online') {
    const m = config.match;
    lines.push({ id: 'played', label: 'Match played', xp: m.played });
    const waves = Math.max(0, Math.floor(result.wavesSurvived));
    if (waves > 0 && m.perWave > 0) {
      const noun = waves === 1 ? 'wave' : 'waves';
      lines.push({ id: 'waves', label: `${waves} ${noun} survived`, xp: waves * m.perWave });
    }
    const place = result.placement;
    if (place !== null && place >= 1) {
      // A table bigger than the list earns nothing for the places past its end.
      const xp = m.placement[place - 1] ?? 0;
      if (xp > 0) lines.push({ id: 'placement', label: `${ordinal(place)} place`, xp });
    }
    if (result.reachedShowdown && m.showdown > 0) {
      lines.push({ id: 'showdown', label: 'Reached the Final Showdown', xp: m.showdown });
    }
  } else {
    const c = config.casual;
    const games = next.casual.day === today ? next.casual.games : 0;
    if (games < c.gamesPerDay && c.xp > 0) {
      const what = result.mode === 'solo' ? 'solo' : 'practice';
      lines.push({ id: 'daily', label: `Daily ${what} XP`, xp: c.xp });
      next.casual = { day: today, games: games + 1 };
    } else {
      note =
        `Practice and solo earn XP ${timesADay(c.gamesPerDay)}. ` +
        'Back tomorrow, or play online for more.';
    }
  }

  const base = lines.reduce((sum, line) => sum + line.xp, 0);
  const boosts: XpLine[] = [];
  if (base > 0) {
    const ad = config.adBoost;
    if (next.adBoost.matchesLeft > 0 && ad.bonus > 0) {
      boosts.push({
        id: 'adBoost',
        label: `Boost +${percent(ad.bonus)}`,
        xp: Math.round(base * ad.bonus),
      });
      next.adBoost = { ...next.adBoost, matchesLeft: next.adBoost.matchesLeft - 1 };
    }
    const supporter = config.supporter.bonus;
    if (next.supporter && supporter > 0) {
      boosts.push({
        id: 'supporter',
        label: `Supporter +${percent(supporter)}`,
        xp: Math.round(base * supporter),
      });
    }
  }

  const total = base + boosts.reduce((sum, line) => sum + line.xp, 0);
  next.xp = profile.xp + total;
  return { award: { lines, boosts, base, total, note }, profile: next };
}

/** Where the opt-in ad's boost stands today. */
export interface BoostStatus {
  /** XP-earning matches the running boost has left; 0 when none is running. */
  matchesLeft: number;
  /** Boosts still to be had today. */
  leftToday: number;
  /** Whether one can be started now. */
  available: boolean;
  /** Why not, in words, when it cannot. */
  reason: string | null;
}

export function boostStatus(
  config: ProgressionConfig,
  profile: Profile,
  today: string,
): BoostStatus {
  const watched = profile.adBoost.day === today ? profile.adBoost.watched : 0;
  const leftToday = Math.max(0, config.adBoost.perDay - watched);
  const running = profile.adBoost.matchesLeft;
  if (running > 0) {
    return {
      matchesLeft: running,
      leftToday,
      available: false,
      reason:
        running === 1
          ? 'Boost on for your next match'
          : `Boost on for your next ${running} matches`,
    };
  }
  if (leftToday <= 0) {
    return {
      matchesLeft: 0,
      leftToday,
      available: false,
      reason: 'That is today’s boosts. Back tomorrow',
    };
  }
  return { matchesLeft: 0, leftToday, available: true, reason: null };
}

/** Start a boost - the ad has been watched, or a Supporter has claimed one. */
export function startBoost(config: ProgressionConfig, profile: Profile, today: string): Profile {
  const watched = profile.adBoost.day === today ? profile.adBoost.watched : 0;
  return {
    ...profile,
    adBoost: { matchesLeft: config.adBoost.matches, day: today, watched: watched + 1 },
  };
}
