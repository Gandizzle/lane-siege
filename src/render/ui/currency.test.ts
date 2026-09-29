/**
 * Prices with pictures in them (currency.ts): a string's tokens become icons,
 * and everything else stays text.
 */

import { describe, expect, it } from 'vitest';
import { GEM, GOLD, SUPPLY, parseRich } from './currency.ts';

describe('prices with pictures', () => {
  it('splits a price into its words and its icons, in order', () => {
    expect(parseRich(`${GOLD}45 · ${SUPPLY}1`)).toEqual([
      { icon: 'gold' },
      { text: '45 · ' },
      { icon: 'supply' },
      { text: '1' },
    ]);
    expect(parseRich(`${GEM}10 → +${GOLD}1/wave`)).toEqual([
      { icon: 'gem' },
      { text: '10 → +' },
      { icon: 'gold' },
      { text: '1/wave' },
    ]);
  });

  it('leaves a string with no tokens as it was', () => {
    expect(parseRich('maxed')).toEqual([{ text: 'maxed' }]);
    expect(parseRich('')).toEqual([]);
    // Only the three currencies are tokens.
    expect(parseRich('{silver}3')).toEqual([{ text: '{silver}3' }]);
  });
});
