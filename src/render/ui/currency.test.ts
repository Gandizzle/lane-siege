/**
 * Prices with pictures in them (currency.ts): a string's tokens become icons,
 * and everything else stays text.
 */

import { describe, expect, it } from 'vitest';
import { GEM, GOLD, SUPPLY, parseRich, splitAmounts } from './currency.ts';

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

  it('labels the amount after each icon, so only the short one need be colored', () => {
    // The playtest: a unit short of supply alone showed its gold in red too.
    expect(splitAmounts(parseRich(`${GOLD}45 · ${SUPPLY}1`))).toEqual([
      { icon: 'gold' },
      { text: '45', of: 'gold' },
      { text: ' · ' },
      { icon: 'supply' },
      { text: '1', of: 'supply' },
    ]);
    expect(splitAmounts(parseRich(`${GOLD}68 · ${SUPPLY}+1`)).at(-1)).toEqual({
      text: '+1',
      of: 'supply',
    });
    // Text with no icon before it is nobody's amount.
    expect(splitAmounts(parseRich(`+${GOLD}12`))).toEqual([
      { text: '+' },
      { icon: 'gold' },
      { text: '12', of: 'gold' },
    ]);
    expect(splitAmounts(parseRich('maxed'))).toEqual([{ text: 'maxed' }]);
  });
});
