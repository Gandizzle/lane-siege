/**
 * Where the coach's card goes (tutorialCoach.ts, `placeCard`): beside the
 * thing it is pointing at, off it, and never under a button that is drawn
 * over it.
 */

import { describe, expect, it } from 'vitest';
import type { Rect } from '../layout.ts';
import { placeCard, wantsArrow } from './tutorialCoach.ts';

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

  it('sits just above a target at the bottom, not at the far end of the screen', () => {
    const buildBar: Rect = { x: 0, y: 633, width: 390, height: 211 };
    const at = placeCard(PHONE, CARD, buildBar, [MENU, LEGEND]);
    expect(overlaps(cardAt(at), buildBar)).toBe(false);
    expect(at.side).toBe('above');
    expect(buildBar.y - (at.y + CARD.height)).toBeLessThanOrEqual(12);
  });

  it('sits right under a target near the top', () => {
    const wallet: Rect = { x: 203, y: 4, width: 175, height: 22 };
    const at = placeCard(PHONE, CARD, wallet, [MENU, LEGEND]);
    expect(at.side).toBe('below');
    expect(overlaps(cardAt(at), wallet)).toBe(false);
    expect(at.y).toBeLessThan(PHONE.height / 3);
  });

  it('leaves the gap it is asked for, where the arrow goes', () => {
    const card: Rect = { x: 130, y: 700, width: 120, height: 80 };
    const at = placeCard(PHONE, CARD, card, [MENU, LEGEND], 38);
    expect(at.side).toBe('above');
    expect(card.y - (at.y + CARD.height)).toBeCloseTo(38, 5);
  });

  it('goes beside a target on a wide screen when that is nearest', () => {
    const wide: Rect = { x: 0, y: 0, width: 1280, height: 800 };
    const tall: Rect = { x: 400, y: 20, width: 300, height: 760 };
    const at = placeCard(wide, CARD, tall, [MENU, LEGEND]);
    expect(['left', 'right']).toContain(at.side);
    expect(overlaps(cardAt(at), tall)).toBe(false);
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

  it('picks the spot that covers least of a target too big to sit beside', () => {
    // Nearly the whole screen: nowhere beside it fits, so it covers the least.
    const lane: Rect = { x: 0, y: 40, width: 390, height: 700 };
    const at = placeCard(PHONE, CARD, lane, [MENU, LEGEND]);
    expect(at.side).toBeNull();
    expect(at.y).toBeGreaterThan(PHONE.height / 2);
  });
});

describe('the coach arrow', () => {
  it('points at anything to tap, and at a small thing to read', () => {
    const button: Rect = { x: 10, y: 700, width: 120, height: 44 };
    const lane: Rect = { x: 0, y: 102, width: 390, height: 531 };
    expect(wantsArrow('tap', lane, PHONE)).toBe(true);
    expect(wantsArrow('next', button, PHONE)).toBe(true);
    // A ring round half the screen says enough on its own.
    expect(wantsArrow('next', lane, PHONE)).toBe(false);
    expect(wantsArrow('next', null, PHONE)).toBe(false);
  });
});
