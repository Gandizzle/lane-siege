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
 * Practice and solo pay the same way, line by line, up to `casual.dailyCap` XP
 * a day between them - enough that playing alone is a real way to level, not
 * so much that it is the way, and capped because the device is what keeps
 * score. Solo has no one to place against, so no placement. A match that
 * crosses the cap shows everything it earned, then the part over the cap
 * taken off; boosts are added to what is left.
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
 * business plan has it: both together are 1 + 0.5 + 0.75, not 1.5 × 1.75.
 *
 * THE TOP LEVEL
 *
 * XP stops at the top level (levels.ts). The match that reaches it shows
 * everything it earned, boosts and all, then the part past the top taken off,
 * as the daily cap does. A match played at the top earns nothing and spends
 * nothing - no boosted waves, none of the day's allowance - so all of it is
 * still there when new builders or cosmetics raise the top. The ad is not
 * offered at the top: there is no XP for it to boost.
 *
 * Pure: the profile in, the award and the next profile out. The day is passed
 * in rather than read, so a test can be on any day it likes.
 */

import type { ProgressionConfig } from './config.ts';
import { xpCeiling } from './levels.ts';
import { hasSupporterPerks, type Profile } from './profile.ts';

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

/** How a match stood the moment it ended for one lane: what its XP is counted from. */
export interface MatchEnd {
  /** The wave it ended in. */
  wave: number;
  /** The lane fell, rather than outlasting everyone. */
  eliminated: boolean;
  /** Where it finished, 1 being the winner; null if none was locked in. */
  placement: number | null;
  /** Its army reached the Final Showdown. */
  reachedShowdown: boolean;
}

/**
 * The result a match's XP is counted from, the moment it ended for a lane.
 * One function for both counts: the device's (render/game.ts) and the
 * server's (server/room.ts), so the two cannot come out different.
 */
export function matchResultOf(mode: XpMode, end: MatchEnd): MatchResult {
  // Waves got through: all of them for an army that reached the showdown;
  // for a lane that fell, every wave before the one that broke it.
  const wavesSurvived = end.reachedShowdown
    ? end.wave
    : end.eliminated
      ? Math.max(0, end.wave - 1)
      : end.wave;
  return {
    mode,
    placement: end.placement,
    wavesSurvived,
    // The wave it ended in counts as played: what a running boost covers.
    wavesPlayed: Math.max(1, end.wave),
    reachedShowdown: end.reachedShowdown,
  };
}

export type XpLineId =
  'played' | 'waves' | 'placement' | 'showdown' | 'limit' | 'adBoost' | 'supporter' | 'top';

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
  /** The part past the top level, taken off: only on the match that reaches it. */
  overTop: XpLine | null;
  /** The sum of `lines`. */
  base: number;
  /** Everything: `lines`, `boosts` and `overTop`. */
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

/**
 * What a match pays for, line by line: playing it out, every wave survived,
 * the placement and reaching the Final Showdown. `placed` is false for solo,
 * which has no one to place against.
 */
function matchLines(config: ProgressionConfig, result: MatchResult, placed: boolean): XpLine[] {
  const m = config.match;
  const lines: XpLine[] = [{ id: 'played', label: 'Match played', xp: m.played }];
  const waves = Math.max(0, Math.floor(result.wavesSurvived));
  if (waves > 0 && m.perWave > 0) {
    const noun = waves === 1 ? 'wave' : 'waves';
    lines.push({ id: 'waves', label: `${waves} ${noun} survived`, xp: waves * m.perWave });
  }
  const place = result.placement;
  if (placed && place !== null && place >= 1) {
    // A table bigger than the list earns nothing for the places past its end.
    const xp = m.placement[place - 1] ?? 0;
    if (xp > 0) lines.push({ id: 'placement', label: `${ordinal(place)} place`, xp });
  }
  if (result.reachedShowdown && m.showdown > 0) {
    lines.push({ id: 'showdown', label: 'Reached the Final Showdown', xp: m.showdown });
  }
  return lines;
}

/** Said once the top level is reached: why the XP stops, and what starts it again. */
export function topNote(top: number): string {
  return (
    `Level ${top} is the top for now. New builders and cosmetics raise it, ` +
    'and XP counts again from there.'
  );
}

/**
 * The XP a finished match earns, and the profile with it added. `top` is the
 * top level (store.ts): XP past the start of it does not count.
 */
export function awardXp(
  config: ProgressionConfig,
  profile: Profile,
  result: MatchResult,
  today: string,
  top = Infinity,
): { award: XpAward; profile: Profile } {
  const next = structuredClone(profile);
  const ceiling = xpCeiling(top, config.levels);
  if (profile.xp >= ceiling) {
    // At the top already: nothing counts, so nothing is used up either.
    next.xp = ceiling;
    const award: XpAward = {
      lines: [],
      boosts: [],
      overTop: null,
      base: 0,
      total: 0,
      note: topNote(top),
    };
    return { award, profile: next };
  }
  const lines: XpLine[] = [];
  let note: string | null = null;

  if (result.mode === 'online') {
    lines.push(...matchLines(config, result, true));
  } else {
    // The same lines, to what is left of today's cap.
    const cap = config.casual.dailyCap;
    const spent = next.casual.day === today ? next.casual.xp : 0;
    const left = Math.max(0, cap - spent);
    const capped = `That is today's ${cap} XP from practice and solo. Back tomorrow, or play online for more.`;
    if (left === 0) {
      note = capped;
    } else {
      const earned = matchLines(config, result, result.mode === 'practice');
      lines.push(...earned);
      const sum = earned.reduce((total, line) => total + line.xp, 0);
      if (sum > left) lines.push({ id: 'limit', label: "Over today's limit", xp: left - sum });
      const earnedToday = spent + Math.min(sum, left);
      next.casual = { day: today, xp: earnedToday };
      note = earnedToday >= cap ? capped : `Practice and solo XP today: ${earnedToday} of ${cap}.`;
    }
  }

  const base = lines.reduce((sum, line) => sum + line.xp, 0);
  const boosts: XpLine[] = [];
  if (base > 0) {
    const ad = config.adBoost;
    const played = Math.max(1, Math.floor(result.wavesPlayed));
    // A Supporter's covers every wave and uses none up; an ad's covers what
    // it has left, and those are spent. A Founder's is a Supporter's.
    const perks = hasSupporterPerks(next);
    const covered = perks ? played : Math.min(played, next.adBoost.wavesLeft);
    if (covered > 0 && ad.bonus > 0) {
      const share = covered < played ? ` (${covered} of ${played} waves)` : '';
      boosts.push({
        id: 'adBoost',
        label: `Boost +${percent(ad.bonus)}${share}`,
        xp: Math.round((base * ad.bonus * covered) / played),
      });
      if (!perks) next.adBoost = { wavesLeft: next.adBoost.wavesLeft - covered };
    }
    const supporter = config.supporter.bonus;
    if (perks && supporter > 0) {
      boosts.push({
        id: 'supporter',
        label: `${next.founder ? 'Founder' : 'Supporter'} +${percent(supporter)}`,
        xp: Math.round(base * supporter),
      });
    }
  }

  let total = base + boosts.reduce((sum, line) => sum + line.xp, 0);
  // The match that reaches the top: what is past it, taken off.
  let overTop: XpLine | null = null;
  const room = ceiling - profile.xp;
  if (total > room) {
    overTop = { id: 'top', label: 'Past the top level', xp: room - total };
    total = room;
  }
  if (total >= room) note = topNote(top);
  next.xp = profile.xp + total;
  return { award: { lines, boosts, overTop, base, total, note }, profile: next };
}

/** Where the opt-in ad's boost stands. */
export interface BoostStatus {
  /** Boosted waves still to come; 0 when none are. */
  wavesLeft: number;
  /** A Supporter's: on for every wave, with no ad and nothing used up. */
  alwaysOn: boolean;
  /**
   * Whether to offer the ad before the next game: fewer than `offerBelow`
   * left, and below the top level, where there is no XP for it to boost.
   */
  offer: boolean;
  /** Boosted waves after watching one: `waves` more, to `maxWaves` at most. */
  wavesAfter: number;
}

export function boostStatus(
  config: ProgressionConfig,
  profile: Profile,
  atTop = false,
): BoostStatus {
  const ad = config.adBoost;
  const wavesLeft = profile.adBoost.wavesLeft;
  const alwaysOn = hasSupporterPerks(profile);
  return {
    wavesLeft,
    alwaysOn,
    offer: !alwaysOn && !atTop && ad.bonus > 0 && wavesLeft < ad.offerBelow,
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
