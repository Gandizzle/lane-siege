/**
 * The silhouette catalogue. See shapes.ts.
 *
 * Geometry, not pixels: `silhouette()` is pure, so the properties that matter
 * can be checked exactly. That every body stays inside its own collision
 * circle is §4.2's "what you see is what collides" for the drawn part; that no
 * two are the same is the whole reason the catalogue exists; and the family map
 * in schema.ts has to name exactly the shapes that can be drawn, or a data file
 * could ask for one that does not exist.
 */

import { describe, expect, it } from 'vitest';
import { Graphics } from 'pixi.js';
import { SHAPE_FAMILY } from '../data/schema.ts';
import type { ShapeId } from '../data/schema.ts';
import { drawEntity, drawMarkPips, SHAPE_IDS, silhouette, markPipCount } from './shapes.ts';
import type { Piece } from './shapes.ts';

/** The furthest any part of a silhouette gets from the body's centre. */
function reach(pieces: Piece[]): number {
  let worst = 0;
  for (const piece of pieces) {
    if (piece.kind === 'circle') {
      worst = Math.max(worst, Math.hypot(piece.x, piece.y) + piece.r);
    } else {
      for (let i = 0; i < piece.points.length; i += 2) {
        worst = Math.max(worst, Math.hypot(piece.points[i]!, piece.points[i + 1]!));
      }
    }
  }
  return worst;
}

/** A silhouette as a comparable string, rounded so float noise cannot fake a difference. */
function fingerprint(pieces: Piece[]): string {
  return JSON.stringify(
    pieces.map((p) =>
      p.kind === 'circle'
        ? ['c', p.x.toFixed(3), p.y.toFixed(3), p.r.toFixed(3)]
        : ['p', p.points.map((v) => v.toFixed(3))],
    ),
  );
}

describe('every silhouette', () => {
  it('is one the family map knows, and the family map names nothing else', () => {
    expect([...SHAPE_IDS].sort()).toEqual(Object.keys(SHAPE_FAMILY).sort());
  });

  it('has something to draw', () => {
    for (const id of SHAPE_IDS) {
      const pieces = silhouette(id);
      expect(pieces.length, id).toBeGreaterThan(0);
      for (const piece of pieces) {
        if (piece.kind === 'poly') {
          expect(piece.points.length % 2, `${id} has an odd coordinate list`).toBe(0);
          expect(piece.points.length, `${id} polygon too small`).toBeGreaterThanOrEqual(6);
          for (const v of piece.points) expect(Number.isFinite(v), `${id} has NaN`).toBe(true);
        }
      }
    }
  });

  it('stays inside the collision circle, and fills a fair share of it', () => {
    // Inside: what is drawn never sticks out past what collides (§4.2). A fair
    // share: a shape that is mostly empty circle reads as a smaller body than
    // it is, which is the same lie the other way round.
    for (const id of SHAPE_IDS) {
      const r = reach(silhouette(id));
      expect(r, `${id} reaches ${r.toFixed(3)} past its radius`).toBeLessThanOrEqual(1.001);
      expect(r, `${id} only reaches ${r.toFixed(3)}`).toBeGreaterThanOrEqual(0.8);
    }
  });

  it('is unlike every other', () => {
    const seen = new Map<string, ShapeId>();
    for (const id of SHAPE_IDS) {
      const print = fingerprint(silhouette(id));
      const other = seen.get(print);
      expect(other, `${id} is drawn identically to ${other}`).toBeUndefined();
      seen.set(print, id);
    }
  });

  it('draws as a unit and as a monster without complaint', () => {
    // A smoke test through the real Pixi path: concave polygons, clusters and
    // single circles, both filled and stroked. A shape that Pixi refuses to
    // triangulate would show up here rather than on a phone.
    for (const id of SHAPE_IDS) {
      for (const outlined of [false, true]) {
        const g = drawEntity(
          new Graphics(),
          { shape: id, damageType: 'impact', mark: outlined ? 1 : 3, outlined },
          50,
          50,
          9,
        );
        expect(g.context.instructions.length, `${id} drew nothing`).toBeGreaterThan(0);
      }
    }
  });

  it('wears one pip per upgrade bought, not one per mark owned', () => {
    // A unit as built wears none; upgrade it once and one dot appears. Read
    // the other way round the row is always one ahead of what was paid for.
    expect(markPipCount(1)).toBe(0);
    expect(markPipCount(2)).toBe(1);
    expect(markPipCount(3)).toBe(2);

    // And the drawing agrees with the count: one pip is one circle wide, two
    // are a circle plus the gap between them.
    const pips = (mark: number) => {
      const g = new Graphics();
      drawMarkPips(g, mark, 0, 0, 2, 0xffffff);
      return g.bounds.maxX - g.bounds.minX;
    };
    expect(pips(1)).toBe(0);
    expect(pips(2)).toBeCloseTo(4, 6);
    expect(pips(3)).toBeCloseTo(10, 6);
  });

  it('keeps a shape the size the body is, whatever the family', () => {
    // The pips are the only thing that goes outside the silhouette, and only
    // for a mark above one. Everything else is the body.
    const g = drawEntity(
      new Graphics(),
      { shape: 'hexagon', damageType: 'pierce', mark: 1, outlined: false },
      0,
      0,
      10,
    );
    const b = g.bounds;
    expect(Math.max(-b.minX, b.maxX, -b.minY, b.maxY)).toBeLessThanOrEqual(10.5);
  });
});
