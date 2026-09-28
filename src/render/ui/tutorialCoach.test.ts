/**
 * Where the coach's card goes (tutorialCoach.ts, `placeCard`): off the thing
 * it is pointing at, and never under a button that is drawn over it.
 */

import { describe, expect, it } from 'vitest';
import type { Rect } from '../layout.ts';
import { placeCard } from './tutorialCoach.ts';

const PHONE: Rect = { x: 0, y: 0, width: 390, height: 844 };
const CARD = { width: 366, height: 140 };
const MENU: Rect = { x: 6, y: 6, width: 36, height: 36 };
const LEGEND: Rect = { x: 354, y: 68, width: 30, height: 30 };

function cardAt(at: { x: number; y: number }): Rect {
  return { ...at, width: CARD.width, height: CARD.height };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe('the coach card', () => {
  it('sits at the bottom when there is nothing to keep clear of', () => {
    const at = placeCard(PHONE, CARD, null);
    expect(at.y + CARD.height).toBeLessThanOrEqual(PHONE.height);
    expect(at.y).toBeGreaterThan(PHONE.height / 2);
  });

  it('moves to the top when the target is at the bottom', () => {
    const buildBar: Rect = { x: 0, y: 633, width: 390, height: 211 };
    const at = placeCard(PHONE, CARD, buildBar, [MENU, LEGEND]);
    expect(overlaps(cardAt(at), buildBar)).toBe(false);
    expect(at.y).toBeLessThan(PHONE.height / 2);
  });

  it('never covers the menu or the legend button, which are drawn over it', () => {
    const targets: Rect[] = [
      { x: 0, y: 633, width: 390, height: 211 },
      { x: 43, y: 443, width: 303, height: 38 },
      { x: 0, y: 102, width: 390, height: 531 },
      { x: 203, y: 10, width: 175, height: 15 },
    ];
    for (const target of targets) {
      const card = cardAt(placeCard(PHONE, CARD, target, [MENU, LEGEND]));
      expect(overlaps(card, MENU)).toBe(false);
      expect(overlaps(card, LEGEND)).toBe(false);
      expect(card.y + card.height).toBeLessThanOrEqual(PHONE.height);
    }
  });

  it('picks the spot that covers least of a target too big to miss', () => {
    // The whole lane: either end covers some of it, and the bottom covers less.
    const lane: Rect = { x: 0, y: 102, width: 390, height: 531 };
    const at = placeCard(PHONE, CARD, lane, [MENU, LEGEND]);
    expect(at.y).toBeGreaterThan(PHONE.height / 2);
  });
});
