/**
 * Which parts of the interface a match shows.
 *
 * A real match shows everything. The tutorial does not: it opens the game a
 * piece at a time - building, then upgrading, then supply, counters, and last
 * gems and sends - and plays a whole practice match after each piece, so a
 * new player gets reps with the basics before the next choice arrives
 * (src/tutorial/lessons.ts). What is not open yet is not drawn at all, rather
 * than drawn and refused: a tab that does nothing is one more thing to wonder
 * about, which is the opposite of the point.
 *
 * Interface only. The simulation still takes any command, and nothing in a
 * tutorial match needs it not to - the bots there are told not to send, and
 * the player can only reach what is drawn.
 */

import type { Tab } from './ui/buildBar.ts';
import type { MatchMode } from './ui/homeScreen.ts';

export interface Features {
  /** The build bar's tabs, in the bar's own order; the rest are not shown. */
  tabs: readonly Tab[];
  /** Upgrade and Sell on a selected unit's panel. */
  upgrades: boolean;
  /** The Fort tab's buttons: Supply Cap alone, or every fortress ladder too. */
  fort: 'supply' | 'all';
  /** Gems in the HUD, and the passive income sends pay. */
  gems: boolean;
  /**
   * The counter hints: the sword and shield on each unit card (counterIcons.ts).
   *
   * A learning aid, so it is in the games you learn in - practice, solo and
   * the tutorial from the chapter that explains it - and not in a game
   * against other people, where reading the wave against the chart is part
   * of what is being played (`featuresFor`).
   */
  counterHints: boolean;
}

export const EVERYTHING: Features = {
  tabs: ['build', 'tech', 'fort', 'aura', 'send', 'damage'],
  upgrades: true,
  fort: 'all',
  gems: true,
  counterHints: true,
};

/**
 * What a match outside the tutorial shows (the tutorial sets its own, chapter
 * by chapter). Exhaustive on purpose: a new kind of match has to say which
 * side of the line it is on.
 */
export function featuresFor(mode: MatchMode): Features {
  switch (mode.kind) {
    case 'practice':
    case 'solo':
    case 'tutorial':
    case 'showdown':
      return EVERYTHING;
    case 'quick':
    case 'private':
      return { ...EVERYTHING, counterHints: false };
  }
}
