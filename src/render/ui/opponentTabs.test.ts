/**
 * An opponent tab's second line. DESIGN.md §14.1, §12.
 *
 * Pure, so it is tested here rather than through Pixi: a tab holds two `Text`
 * objects and neither can be constructed without a canvas. The rule is about
 * two things that have to share a small box - the name, the detail line and
 * the HP bar under them - and the two tab heights are far enough apart that
 * one constant cannot serve both.
 */

import { describe, expect, it } from 'vitest';
import { detailTop } from './opponentTabs.ts';

/** What `layout()` places the name at; the detail is measured from it. */
const CAPTION_Y = 3;

describe('the detail line and the HP bar', () => {
  it('leaves the bar alone on a tab with room to spare', () => {
    // A landscape tab is 38 tall: bar at 32, and an eleven-pixel line ending
    // at 30 rather than resting on it.
    const top = detailTop(CAPTION_Y, 38);
    expect(top + 11).toBeLessThan(38 - 6);
  });

  it('gives an upright tab everything it has, and no more', () => {
    // 30 tall is every pixel spoken for: the line ends exactly where the bar
    // begins, which is the shape this has always had upright.
    const top = detailTop(CAPTION_Y, 30);
    expect(top + 11).toBe(30 - 6);
  });

  it('never climbs into the name, however little height there is', () => {
    for (const height of [16, 20, 24, 30, 38, 60]) {
      expect(detailTop(CAPTION_Y, height)).toBeGreaterThanOrEqual(CAPTION_Y + 10);
    }
  });
});
