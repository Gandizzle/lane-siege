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
 * The opt-in ad boosts WAVES, not matches: watching one adds `adBoost.waves`
 * boosted waves, and a match uses up as many as it had - so a player out on
 * wave 6 keeps the rest for the next match rather than losing the lot. A
 * match's XP is boosted for the share of its waves the boost covered: all of
 * a 6-wave match with 25 boosted waves left, a quarter of a 20-wave match with
 * 5. A match that earns nothing - practice after the day's allowance - uses
 * none, since there was nothing for it to boost.
 *
 * The ad is offered before every game that can earn XP while fewer than
 * `offerBelow` boosted waves are left, as often as anyone likes, so it stacks
 * - to `maxWaves` at most. A Supporter's boost is always on: no ad, and no
 * waves to use up.
 *
 * Supporter adds its own share to every match besides. Shares ADD, as the
 * business plan has it: both together are 1 + 1.0 + 0.25, not 2 × 1.25.
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
  /**
   * Waves your lane fought, the one it fell in included: what a running boost
   * covers and uses up.
   */
  wavesPlayed: number;
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
    const played = Math.max(1, Math.floor(result.wavesPlayed));
    // A Supporter's covers every wave and uses none up; an ad's covers what
    // it has left, and those are spent.
    const covered = next.supporter ? played : Math.min(played, next.adBoost.wavesLeft);
    if (covered > 0 && ad.bonus > 0) {
      const share = covered < played ? ` (${covered} of ${played} waves)` : '';
      boosts.push({
        id: 'adBoost',
        label: `Boost +${percent(ad.bonus)}${share}`,
        xp: Math.round((base * ad.bonus * covered) / played),
      });
      if (!next.supporter) next.adBoost = { wavesLeft: next.adBoost.wavesLeft - covered };
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

/** Where the opt-in ad's boost stands. */
export interface BoostStatus {
  /** Boosted waves still to come; 0 when none are. */
  wavesLeft: number;
  /** A Supporter's: on for every wave, with no ad and nothing used up. */
  alwaysOn: boolean;
  /** Whether to offer the ad before the next game: fewer than `offerBelow` left. */
  offer: boolean;
  /** Boosted waves after watching one: `waves` more, to `maxWaves` at most. */
  wavesAfter: number;
}

export function boostStatus(config: ProgressionConfig, profile: Profile): BoostStatus {
  const ad = config.adBoost;
  const wavesLeft = profile.adBoost.wavesLeft;
  const alwaysOn = profile.supporter;
  return {
    wavesLeft,
    alwaysOn,
    offer: !alwaysOn && ad.bonus > 0 && wavesLeft < ad.offerBelow,
    wavesAfter: Math.min(ad.maxWaves, wavesLeft + ad.waves),
  };
}

/** The ad was watched to the end: its boosted waves, on top of any left. */
export function startBoost(config: ProgressionConfig, profile: Profile): Profile {
  return { ...profile, adBoost: { wavesLeft: boostStatus(config, profile).wavesAfter } };
}

/** 17 → "17 waves". */
export function waveCount(n: number): string {
  return `${n} ${n === 1 ? 'wave' : 'waves'}`;
}
