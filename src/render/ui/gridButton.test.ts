/**
 * Readable buttons: text that grows with the screen and always fits its box,
 * and a button that cannot be used whose words can still be read - above all
 * the price, which is the number a player saves towards.
 */

import { describe, expect, it } from 'vitest';
import { textScaleFor } from '../layout.ts';
import { UI } from '../palette.ts';
import { DETAIL_SIZE, lineSizes, NOTE_SIZE, TITLE_SIZE } from './gridButton.ts';

/** WCAG relative luminance of a 0xRRGGBB color. */
function luminance(color: number): number {
  const channel = (shift: number) => {
    const c = ((color >> shift) & 0xff) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
}

/** WCAG contrast ratio between two colors, 1 to 21. */
function contrast(a: number, b: number): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** `color` drawn at `alpha` over `ground`, as the old faded button drew its words. */
function faded(color: number, alpha: number, ground: number): number {
  const mix = (shift: number) =>
    Math.round(((color >> shift) & 0xff) * alpha + ((ground >> shift) & 0xff) * (1 - alpha));
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

describe('the text scale', () => {
  it('draws text at about its written size on a phone, either way up', () => {
    for (const [w, h] of [
      [360, 640],
      [390, 844],
      [430, 932],
    ] as const) {
      expect(textScaleFor(w, h), `${w}x${h}`).toBeGreaterThanOrEqual(0.92);
      expect(textScaleFor(w, h), `${w}x${h}`).toBeLessThanOrEqual(1.1);
      // Turning the phone does not change how big its text is.
      expect(textScaleFor(h, w)).toBe(textScaleFor(w, h));
    }
  });

  it('draws it larger on a tablet or a desktop, up to two-fifths larger', () => {
    expect(textScaleFor(1280, 800)).toBe(1.4);
    expect(textScaleFor(768, 1024)).toBe(1.4);
    expect(textScaleFor(2560, 1440)).toBe(1.4);
    expect(textScaleFor(1280, 800)).toBeGreaterThan(textScaleFor(390, 844));
  });
});

describe("a button's lines", () => {
  const height = (s: ReturnType<typeof lineSizes>) =>
    s.pad * 2 + (s.title + s.detail + s.note) * 1.25;

  it('are larger than they were: the price is no longer the smallest thing on it', () => {
    const roomy = lineSizes(200, 1);
    expect(roomy).toMatchObject({ title: TITLE_SIZE, detail: DETAIL_SIZE, note: NOTE_SIZE });
    // They were 11, 9 and 9.
    expect(roomy.title).toBeGreaterThan(11);
    expect(roomy.detail).toBeGreaterThan(9);
    expect(roomy.note).toBeGreaterThan(9);
  });

  it('grow with the screen', () => {
    expect(lineSizes(200, 1.4).title).toBeGreaterThan(lineSizes(200, 1).title);
    expect(lineSizes(200, 1.4).detail).toBeGreaterThan(lineSizes(200, 1).detail);
  });

  it('fit the box they are given, shrinking only as far as they must', () => {
    for (const scale of [0.92, 1, 1.1, 1.4]) {
      for (const h of [56, 64, 80, 120, 240]) {
        const sizes = lineSizes(h, scale);
        // A box tall enough for them at some allowed size gets them inside it
        // (a pixel of rounding either way).
        if (sizes.title > Math.round(TITLE_SIZE * scale * 0.78)) {
          expect(height(sizes), `${h}px at ${scale}`).toBeLessThanOrEqual(h + 2);
        }
        expect(sizes.title).toBeLessThanOrEqual(Math.round(TITLE_SIZE * scale));
      }
    }
  });

  it('never shrink past the floor, however short the box: the note goes instead', () => {
    const tiny = lineSizes(30, 1);
    expect(tiny.title).toBeGreaterThanOrEqual(Math.floor(TITLE_SIZE * 0.78));
    expect(tiny.detail).toBeGreaterThanOrEqual(Math.floor(DETAIL_SIZE * 0.78));
  });

  it('fit two lines in a touch target when the price sits beside the name', () => {
    // Upgrade and Sell: 44 pixels on a phone.
    const inline = lineSizes(44, 1, true);
    expect(inline.title).toBeGreaterThanOrEqual(13);
    expect(inline.pad * 2 + (inline.title + inline.note) * 1.25).toBeLessThanOrEqual(46);
  });
});

describe('a button that cannot be used', () => {
  it('keeps its name readable: at least 4.5 to 1 against its ground', () => {
    expect(contrast(UI.textMuted, UI.panelAsleep)).toBeGreaterThanOrEqual(4.5);
  });

  it('shows a price it cannot pay in a color that reads and says why', () => {
    expect(contrast(UI.unaffordable, UI.panelAsleep)).toBeGreaterThanOrEqual(4.5);
    // Not the text color and not the muted one: the color is the reason.
    expect(UI.unaffordable).not.toBe(UI.text);
    expect(UI.unaffordable).not.toBe(UI.textMuted);
  });

  it('is far easier to read than the faded button it replaced', () => {
    // The whole button used to be drawn at 0.42: name and price together.
    const oldPrice = contrast(faded(UI.textMuted, 0.42, UI.panel), UI.panel);
    expect(oldPrice).toBeLessThan(2.5);
    expect(contrast(UI.unaffordable, UI.panelAsleep)).toBeGreaterThan(oldPrice * 2.5);
  });

  it('still looks different from one that can: a recessed ground, a muted name', () => {
    expect(UI.panelAsleep).not.toBe(UI.panel);
    expect(luminance(UI.panelAsleep)).toBeLessThan(luminance(UI.panel));
    expect(contrast(UI.text, UI.panel)).toBeGreaterThan(contrast(UI.textMuted, UI.panelAsleep));
  });

  it('keeps an asleep tab readable too', () => {
    expect(contrast(UI.textAsleep, UI.buildBar)).toBeGreaterThanOrEqual(4.5);
  });
});
