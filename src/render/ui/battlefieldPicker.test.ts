/**
 * The battlefield panel lays its previews out in as few columns as fit, so
 * each is as large as the screen allows - two across on a phone held upright,
 * one row on a phone turned sideways.
 */

import { describe, expect, it } from 'vitest';
import { cardGrid } from './battlefieldPicker.ts';

describe('laying out the battlefield previews', () => {
  it('puts two across on an upright phone', () => {
    const grid = cardGrid(5, 334, 650);
    expect(grid.columns).toBe(2);
    expect(grid.cardW).toBeGreaterThan(150);
  });

  it('puts them in one row on a phone turned sideways', () => {
    const grid = cardGrid(5, 728, 250);
    expect(grid.columns).toBe(5);
    expect(grid.previewH + 38).toBeLessThanOrEqual(250);
  });

  it('uses the fewest columns that fit, which is the largest previews', () => {
    const roomy = cardGrid(5, 528, 2000);
    expect(roomy.columns).toBe(1);
    const tall = cardGrid(5, 528, 640);
    expect(tall.columns).toBe(2);
  });

  it('cuts the previews down rather than run off a very short screen', () => {
    const grid = cardGrid(5, 400, 60);
    expect(grid.columns).toBe(5);
    expect(grid.previewH).toBeGreaterThanOrEqual(24);
  });
});
