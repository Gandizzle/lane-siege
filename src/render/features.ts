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

export interface Features {
  /** The build bar's tabs, in the bar's own order; the rest are not shown. */
  tabs: readonly Tab[];
  /** Upgrade and Sell on a selected unit's panel. */
  upgrades: boolean;
  /** The Fort tab's buttons: Supply Cap alone, or every fortress ladder too. */
  fort: 'supply' | 'all';
  /** Gems in the HUD, and the passive income sends pay. */
  gems: boolean;
}

export const EVERYTHING: Features = {
  tabs: ['build', 'tech', 'fort', 'aura', 'send', 'damage'],
  upgrades: true,
  fort: 'all',
  gems: true,
};
