/**
 * The Collection's little pictures, built the way the GPU gets them: every
 * corner a real number, and every corner on the picture.
 *
 * The padlock's shackle came with a line to the top-left corner of the
 * screen, twice (collectionArt.ts, `strokeArc`): first because the arc joined on
 * to the path the fill before it left behind, then because a stroke that
 * starts with a step of no length builds NaN corners - which some GPUs draw
 * as a spike to the corner, and others, the test browser's among them,
 * quietly drop. A screenshot can miss it, so this looks at the triangles.
 */

import { buildContextBatches, GpuGraphicsContext, Graphics } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { BADGE_GLYPHS, COSMETICS } from '../../progression/config.ts';
import { drawBadgeGlyph, drawXpBar } from './levelBadge.ts';
import { drawCosmeticIcon, drawKey, drawPadlock } from './collectionArt.ts';

/** Every vertex `draw` makes, as the renderer builds them. */
function vertices(draw: (g: Graphics) => void): number[] {
  const g = new Graphics();
  draw(g);
  const gpu = new GpuGraphicsContext();
  buildContextBatches(g.context, gpu);
  return gpu.geometryData.vertices;
}

/** How far the furthest vertex lies from (cx, cy), along either axis. */
function reach(v: number[], cx: number, cy: number): number {
  let far = 0;
  for (let i = 0; i < v.length; i += 2) {
    far = Math.max(far, Math.abs(v[i]! - cx), Math.abs(v[i + 1]! - cy));
  }
  return far;
}

describe('the collection icons', () => {
  it('draw a padlock with real corners, every one of them on the lock', () => {
    const v = vertices((g) => drawPadlock(g, 300, 210, 0xffffff));
    expect(v.length).toBeGreaterThan(0);
    expect(v.every(Number.isFinite)).toBe(true);
    expect(reach(v, 300, 210)).toBeLessThan(13);
  });

  it('draw a key the same way, its ring cut through, at every size it is drawn', () => {
    for (const size of [12, 16, 22, 40]) {
      const v = vertices((g) => drawKey(g, 120, 640, size, 0xffffff));
      expect(v.length, `${size}`).toBeGreaterThan(0);
      expect(v.every(Number.isFinite), `${size}`).toBe(true);
      expect(reach(v, 120, 640), `${size}`).toBeLessThanOrEqual(size / 2 + 0.01);
    }
  });

  it('draw every badge, every cosmetic and the XP bar with real corners', () => {
    for (const glyph of BADGE_GLYPHS) {
      const v = vertices((g) => drawBadgeGlyph(g, glyph, 50, 50, 24, 0xffffff));
      expect(v.every(Number.isFinite), glyph).toBe(true);
      expect(reach(v, 50, 50), glyph).toBeLessThan(20);
    }
    for (const cosmetic of COSMETICS.cosmetics) {
      const v = vertices((g) => drawCosmeticIcon(g, cosmetic, 50, 50, 24));
      expect(v.every(Number.isFinite), cosmetic.id).toBe(true);
      expect(reach(v, 50, 50), cosmetic.id).toBeLessThan(20);
    }
    for (const fraction of [0, 0.001, 0.5, 1]) {
      const v = vertices((g) => drawXpBar(g, 10, 10, 200, 9, fraction));
      expect(v.every(Number.isFinite), `${fraction}`).toBe(true);
    }
  });
});
