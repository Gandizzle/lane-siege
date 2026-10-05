/**
 * Which view the build bar is showing. See `activeView` in buildBar.ts.
 *
 * Small, but it is the rule a player feels every time they tap a unit: the
 * selected-unit panel belongs to no tab, so selecting a unit works from
 * wherever they happen to be standing.
 */

import { describe, expect, it } from 'vitest';
import { activeView, shortfall } from './buildBar.ts';

describe('a selected unit belongs to no tab (§14.1, amended)', () => {
  it('shows the tab that is open when nothing is selected', () => {
    expect(activeView('build', false)).toBe('build');
    expect(activeView('damage', false)).toBe('damage');
  });

  it('shows the unit from whichever tab was open', () => {
    // The old rule was "the upgrade panel is part of Build", so a unit tapped
    // from any other tab opened nothing at all.
    for (const tab of ['build', 'tech', 'fort', 'aura', 'send', 'damage'] as const) {
      expect(activeView(tab, true)).toBe('unit');
    }
  });

  it('is never a tab and the unit at once', () => {
    // What the tab strip draws lit, and what the panels key off, is one value.
    const tabs = ['build', 'tech', 'fort', 'aura', 'send', 'damage'] as const;
    for (const tab of tabs) {
      const showing = activeView(tab, true);
      expect(tabs.some((t) => t === showing)).toBe(false);
    }
  });
});

describe('what a greyed-out price says is short', () => {
  const wallet = { gold: 100, gems: 5, supplyUsed: 24, supplyCap: 25 };

  it('names only the part of the price the wallet cannot cover', () => {
    expect(shortfall(wallet, { gold: 150, supply: 1 })).toEqual(['gold']);
    expect(shortfall(wallet, { gold: 50, supply: 2 })).toEqual(['supply']);
    expect(shortfall(wallet, { gold: 150, supply: 2 })).toEqual(['gold', 'supply']);
    expect(shortfall(wallet, { gems: 10 })).toEqual(['gem']);
    expect(shortfall(wallet, { gold: 100, supply: 1 })).toEqual([]);
  });

  it('never blames supply for a price that takes none', () => {
    expect(shortfall({ ...wallet, supplyUsed: 25 }, { gold: 50 })).toEqual([]);
    expect(shortfall({ ...wallet, supplyUsed: 25 }, { gold: 50, supply: 0 })).toEqual([]);
  });
});
