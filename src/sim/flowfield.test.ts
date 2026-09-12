/**
 * The distance field. See flowfield.ts for why it exists at all.
 *
 * These cover the three properties the rest of the movement code relies on:
 * a goal body does not strand its own sweep, inflation really does mean
 * clearance for the body that will walk the route, and the result is identical
 * every time it is computed.
 */

import { describe, expect, it } from 'vitest';
import {
  UNREACHABLE,
  cellAt,
  clearField,
  computeFlowField,
  createFlowField,
  markGoalBody,
  markObstacle,
  markSource,
  markSourceRow,
  sampleCost,
  steerAlongField,
} from './flowfield.ts';

/** A wall across y = 4.5 with one body missing, leaving a gap at x = 3.5. */
function wallWithGap(inflate: number) {
  const field = createFlowField(8, 8, 4);
  clearField(field);

  for (const x of [0.5, 1.5, 2.5, 4.5, 5.5, 6.5, 7.5]) {
    markObstacle(field, x, 4.5, 0.34, inflate);
  }
  return field;
}

describe('a goal body seeds its whole blob', () => {
  it('leaves the ground around it reachable', () => {
    // An inflated body is several cells across, so seeding only its centre
    // leaves every neighbour of that centre blocked: nothing expands and the
    // whole field comes back unreachable. This was the bug.
    const field = createFlowField(8, 8, 4);
    clearField(field);
    markObstacle(field, 4, 4, 0.34, 0.3);
    markGoalBody(field, 4, 4, 0.34, 0.3);
    computeFlowField(field);

    expect(field.cost[cellAt(field, 4, 2.5)]).toBeLessThan(UNREACHABLE);
    expect(field.cost[cellAt(field, 1, 1)]).toBeLessThan(UNREACHABLE);
  });

  it('is stranded when only the centre cell is seeded', () => {
    const field = createFlowField(8, 8, 4);
    clearField(field);
    markObstacle(field, 4, 4, 0.34, 0.3);
    markSource(field, 4, 4);
    computeFlowField(field);

    expect(field.cost[cellAt(field, 4, 2.5)]).toBe(UNREACHABLE);
  });
});

describe('inflation means real clearance', () => {
  it('routes a body that fits through the gap', () => {
    const field = wallWithGap(0.34);
    markSourceRow(field, 0, 8);
    computeFlowField(field);

    // Reachable from below the wall, so the route through the gap exists.
    expect(field.cost[cellAt(field, 3.5, 6.5)]).toBeLessThan(UNREACHABLE);
  });

  it('refuses the same gap to a body that does not fit', () => {
    const field = wallWithGap(0.9);
    markSourceRow(field, 0, 8);
    computeFlowField(field);

    expect(field.cost[cellAt(field, 3.5, 6.5)]).toBe(UNREACHABLE);
  });

  it('steers toward the gap rather than into the wall', () => {
    const field = wallWithGap(0.34);
    markSourceRow(field, 0, 8);
    computeFlowField(field);

    const out = { x: 0, y: 0 };
    const cell = steerAlongField(field, { x: 6.5, y: 6.5 }, out, 0);

    expect(cell).not.toBe(-1);
    // The goal is up (-y) and the only way through is left (-x).
    expect(out.y).toBeLessThan(0);
    expect(out.x).toBeLessThan(0);
  });
});

describe('cost model', () => {
  it('charges 10 for an orthogonal step and 14 for a diagonal', () => {
    const field = createFlowField(4, 4, 1);
    clearField(field);
    markSource(field, 1.5, 1.5);
    computeFlowField(field);

    expect(field.cost[cellAt(field, 1.5, 2.5)]).toBe(10);
    expect(field.cost[cellAt(field, 2.5, 2.5)]).toBe(14);
  });

  it('reports a gradient rather than a plateau near the goal', () => {
    // sampleCost charges for reaching the cell it reads, because the bare
    // minimum over a neighbourhood reads 0 for everyone within a tile of the
    // goal - and the yielding order runs on this number, so a plateau means
    // the whole crowd ties.
    const field = createFlowField(8, 8, 4);
    clearField(field);
    markObstacle(field, 4, 4, 0.34, 0.34);
    markGoalBody(field, 4, 1, 0.3, 0.34);
    computeFlowField(field);

    const near = sampleCost(field, { x: 4, y: 2.2 }, 0.68);
    const far = sampleCost(field, { x: 4, y: 6 }, 0.68);
    expect(near).toBeLessThan(far);
  });
});

describe('determinism', () => {
  it('computes the same field twice', () => {
    const build = () => {
      const field = wallWithGap(0.34);
      markGoalBody(field, 3.5, 1, 0.3, 0.34);
      computeFlowField(field);
      return field;
    };

    expect(Array.from(build().cost)).toEqual(Array.from(build().cost));
  });
});
