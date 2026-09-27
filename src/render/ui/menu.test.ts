/**
 * The menu's pickers step through a list and wrap round both ends, so the
 * last track is one tap back from the first and nothing is a dead end.
 */

import { describe, expect, it } from 'vitest';
import { cycle } from './menu.ts';

describe('stepping through a picker', () => {
  const options = ['shuffle', 'hold-the-line', 'between-waves'];

  it('steps forward and back', () => {
    expect(cycle(options, 'shuffle', 1)).toBe('hold-the-line');
    expect(cycle(options, 'between-waves', -1)).toBe('hold-the-line');
  });

  it('wraps round both ends', () => {
    expect(cycle(options, 'between-waves', 1)).toBe('shuffle');
    expect(cycle(options, 'shuffle', -1)).toBe('between-waves');
  });

  it('steps from the top when the current choice has gone from the list', () => {
    expect(cycle(options, 'a-removed-track', 1)).toBe('hold-the-line');
  });

  it('stays put with only one option', () => {
    expect(cycle(['synth'], 'synth', 1)).toBe('synth');
    expect(cycle(['synth'], 'synth', -1)).toBe('synth');
  });
});
