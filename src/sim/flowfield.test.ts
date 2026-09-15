/**
 * The distance field. See flowfield.ts for the model.
 *
 * What the rest of movement relies on: goals are the free positions an enemy
 * is in range from and nothing else; a position taken by something standing
 * still is not a goal, unless nothing is free; inflation really does mean
 * clearance for the body that will walk the route; a body pressed against an
 * obstacle reads the ground beside it, not a wall; the lane's spawn zone above
 * the grid is part of the field; and the result is identical every time it is
 * computed.
 */

import { describe, expect, it } from 'vitest';
import {
  UNREACHABLE,
  W_DIAG,
  W_ORTH,
  cellAt,
  clearField,
  computeFlowField,
  costAt,
  createFlowField,
  markObstacle,
  goalOwner,
  NO_OWNER,
  markRing,
  SOURCE_WAIT,
  standingCost,
  steerAlongField,
} from './flowfield.ts';
import type { FieldShape } from './flowfield.ts';

const SUB = 5;
/** A melee reach: thinner than a cell, which is the case the ring has to get right. */
const MELEE = 0.08;

/** A plain circular body, which is what every body but the fortress is. */
function disc(x: number, y: number, radius: number): FieldShape {
  return { x, y, radius, halfWidth: 0 };
}

/** The fortress shape: a disc swept along a horizontal spine. */
function wall(x: number, y: number, radius: number, halfWidth: number): FieldShape {
  return { x, y, radius, halfWidth };
}

/** An 8-wide lane: 3 tiles of spawn zone above a 10-deep grid. */
function laneField() {
  const field = createFlowField(8, 13, -3, SUB);
  clearField(field);
  return field;
}

/** The same lane with its 1-tile fortress zone on the bottom, as the sim builds it. */
function fullLaneField() {
  const field = createFlowField(8, 14, -3, SUB);
  clearField(field);
  return field;
}

/**
 * A wall of bodies across y = 4.5 with one gap at x = 3.5, 0.58 tiles wide:
 * room for a 0.44-wide monster, not for a 0.88-wide boss.
 */
function wallWithGap(inflate: number) {
  const field = laneField();
  for (const x of [0.5, 1.5, 2.95, 4.05, 5.5, 6.5, 7.5]) {
    markObstacle(field, disc(x, 4.5, 0.26), inflate);
  }
  return field;
}

describe('goals are the free positions around an enemy', () => {
  it('rings a body at touching distance and leaves its inside unreachable', () => {
    const field = laneField();
    markObstacle(field, disc(4, 4, 0.22), 0.26);
    markRing(field, disc(4, 4, 0.22), 0.26, MELEE, 1);
    computeFlowField(field);

    // Inside the body: nowhere a seeker can stand.
    expect(costAt(field, 4, 4)).toBe(UNREACHABLE);
    // A body-length away in any direction: on the ring, cost 0.
    const touching = 0.22 + 0.26 + 0.05;
    expect(costAt(field, 4 + touching, 4)).toBe(0);
    expect(costAt(field, 4 - touching, 4)).toBe(0);
    expect(costAt(field, 4, 4 + touching)).toBe(0);
    // Far away: reachable, and further.
    expect(costAt(field, 4, 1)).toBeGreaterThan(0);
    expect(costAt(field, 4, 1)).toBeLessThan(UNREACHABLE);
  });

  it('does not count a position somebody is already standing in', () => {
    const field = laneField();
    const seeker = 0.22;
    // The enemy, and an engaged ally touching it from the north.
    markObstacle(field, disc(4, 4, 0.26), seeker);
    markObstacle(field, disc(4, 4 - (0.26 + seeker), seeker), seeker);
    markRing(field, disc(4, 4, 0.26), seeker, MELEE, 1);
    computeFlowField(field);

    // North of the enemy is taken; a seeker coming from the north is routed
    // round to a side, so its cost is more than the straight-line distance.
    const north = costAt(field, 4, 2.5);
    const straightLine = Math.round((2.5 - 4 + 0.26 + seeker) * -1 * SUB) * 10;
    expect(north).toBeGreaterThan(straightLine);
    expect(north).toBeLessThan(UNREACHABLE);

    // And a position on the west side is still a goal.
    expect(costAt(field, 4 - (0.26 + seeker + 0.05), 4)).toBe(0);
  });

  it('is unreachable everywhere when every position is taken', () => {
    const field = laneField();
    const r = 0.22;
    markObstacle(field, disc(4, 4, 0.26), r);
    // Six bodies packed around it: a full ring at these sizes.
    const ring = 0.26 + r;
    const around: [number, number][] = [
      [ring, 0],
      [-ring, 0],
      [ring * 0.5, ring * 0.866],
      [-ring * 0.5, ring * 0.866],
      [ring * 0.5, -ring * 0.866],
      [-ring * 0.5, -ring * 0.866],
    ];
    for (const [dx, dy] of around) markObstacle(field, disc(4 + dx, 4 + dy, r), r);
    markRing(field, disc(4, 4, 0.26), r, MELEE, 1);
    expect(computeFlowField(field)).toBe(0);

    expect(costAt(field, 4, 1)).toBe(UNREACHABLE);
  });

  it('sees a hole narrower than a cell that a body still fits through', () => {
    // Two ring members leaving a gap: the free arc between them is a sliver,
    // narrower than a field cell, so no cell CENTRE is both free and in range.
    // The fine sampling finds it anyway.
    const field = laneField();
    const r = 0.22;
    const enemy = 0.26;
    markObstacle(field, disc(4, 4, enemy), r);
    const ring = enemy + r + 0.04;
    // Neighbours at ±56° (cos 0.559, sin 0.829): a body between them clears
    // each by a few hundredths of a tile, in a sliver about half a cell wide.
    markObstacle(field, disc(4 + ring * 0.559, 4 + ring * 0.829, r), r);
    markObstacle(field, disc(4 + ring * 0.559, 4 - ring * 0.829, r), r);
    // Everything else around the enemy is taken solidly: bodies at 110°, 150°,
    // 190° and 230°.
    for (const [c, sn] of [
      [-0.342, 0.94],
      [-0.866, 0.5],
      [-0.985, -0.174],
      [-0.643, -0.766],
    ]) {
      markObstacle(field, disc(4 + ring * c!, 4 + ring * sn!, r), r);
    }
    markRing(field, disc(4, 4, enemy), r, MELEE, 1);
    expect(computeFlowField(field)).toBeGreaterThan(0);
    // The hole is to the east, and a body approaching from the east is led in.
    expect(costAt(field, 6, 4)).toBeLessThan(costAt(field, 6, 5.5));
  });

  it('marks waiting positions beside the attackers when nothing is free', () => {
    const field = laneField();
    const r = 0.22;
    markObstacle(field, disc(4, 4, 0.26), r);
    const ring = 0.26 + r;
    const around: [number, number][] = [
      [ring, 0],
      [-ring, 0],
      [ring * 0.5, ring * 0.866],
      [-ring * 0.5, ring * 0.866],
      [ring * 0.5, -ring * 0.866],
      [-ring * 0.5, -ring * 0.866],
    ];
    for (const [dx, dy] of around) markObstacle(field, disc(4 + dx, 4 + dy, r), r);
    markRing(field, disc(4, 4, 0.26), r, MELEE, 1);
    expect(computeFlowField(field)).toBe(0);

    for (const [dx, dy] of around) {
      markRing(field, disc(4 + dx, 4 + dy, r), r, 1 / SUB, NO_OWNER, SOURCE_WAIT);
    }
    expect(computeFlowField(field)).toBeGreaterThan(0);

    // Far away is reachable now, and the slope runs toward the ring: a point
    // just outside the second layer costs less than one further out.
    expect(costAt(field, 4, 1)).toBeLessThan(UNREACHABLE);
    expect(costAt(field, 4, 2.8)).toBeLessThan(costAt(field, 4, 1.5));
    // And a body there is beside a waiting position, not an attack position.
    expect(goalOwner(field, { x: 4, y: 2.95 })).toBe(NO_OWNER);
  });

  it('is the whole reach of a ranged seeker, not a band at touching distance', () => {
    const field = laneField();
    markObstacle(field, disc(4, 6, 0.22), 0.26);
    markRing(field, disc(4, 6, 0.22), 0.26, 3.9, 1);
    computeFlowField(field);

    // Three tiles away is in range, so it is a goal; five is not.
    expect(costAt(field, 4, 3)).toBe(0);
    expect(costAt(field, 4, 1)).toBeGreaterThan(0);
    // Touching is in range too: the annulus starts at contact.
    expect(costAt(field, 4, 6 - 0.53)).toBe(0);
  });

  it('remembers which enemy a goal cell belongs to', () => {
    const field = laneField();
    markObstacle(field, disc(2, 4, 0.22), 0.26);
    markObstacle(field, disc(6, 4, 0.22), 0.26);
    markRing(field, disc(2, 4, 0.22), 0.26, MELEE, 11);
    markRing(field, disc(6, 4, 0.22), 0.26, MELEE, 22);
    computeFlowField(field);

    expect(field.owner[cellAt(field, 2.53, 4)]).toBe(11);
    expect(field.owner[cellAt(field, 6.53, 4)]).toBe(22);
  });
});

describe('a body pressed against an obstacle', () => {
  it('reads the cost of the free ground beside it, not a wall', () => {
    const field = laneField();
    markObstacle(field, disc(4, 4, 0.22), 0.26);
    markRing(field, disc(4, 4, 0.22), 0.26, MELEE, 1);
    // An engaged ally on the east side, taking that position.
    markObstacle(field, disc(4.48, 4, 0.22), 0.26);
    computeFlowField(field);

    // Touching the ally from the east: the body's own cell centre is inside
    // the ally's inflation, so the cell is blocked...
    const pressed = { x: 4.48 + 0.48 + 0.01, y: 4 };
    expect(costAt(field, pressed.x, pressed.y)).toBe(UNREACHABLE);
    // ...but the body is standing on free ground, and reads it as such.
    const standing = standingCost(field, pressed);
    expect(standing).toBeLessThan(UNREACHABLE);
    // And it is not told to step away from the ally to get there: nothing
    // within reach is strictly better than where it is, except a real goal.
    const out = { x: 0, y: 0 };
    const cell = steerAlongField(field, pressed, out, 3);
    if (cell !== -1) expect(field.cost[cell]).toBeLessThan(standing);
  });
});

describe('inflation means real clearance', () => {
  it('routes a body that fits through the gap', () => {
    const field = wallWithGap(0.22);
    markRing(field, disc(3.5, 1, 0.26), 0.22, MELEE, 1);
    computeFlowField(field);
    expect(costAt(field, 3.5, 7)).toBeLessThan(UNREACHABLE);
  });

  it('refuses the same gap to a body that does not fit', () => {
    const field = wallWithGap(0.44);
    markRing(field, disc(3.5, 1, 0.26), 0.44, MELEE, 1);
    computeFlowField(field);
    expect(costAt(field, 3.5, 7)).toBe(UNREACHABLE);
  });

  it('steers toward the gap rather than into the wall', () => {
    const field = wallWithGap(0.22);
    markRing(field, disc(3.5, 1, 0.26), 0.22, MELEE, 1);
    computeFlowField(field);

    const out = { x: 0, y: 0 };
    const cell = steerAlongField(field, { x: 6.5, y: 7 }, out, 3);
    expect(cell).not.toBe(-1);
    // The goal is up (-y) and the only way through is left (-x).
    expect(out.y).toBeLessThan(0);
    expect(out.x).toBeLessThan(0);
  });

  it('walks straight on open ground', () => {
    const field = laneField();
    markObstacle(field, disc(4, 1, 0.26), 0.22);
    markRing(field, disc(4, 1, 0.26), 0.22, MELEE, 1);
    computeFlowField(field);

    const out = { x: 0, y: 0 };
    // From a cell centre. On a cell boundary the two neighbours tie and the
    // first wins, which is a half-cell lean the hysteresis then holds; that is
    // the grid, not the steering, and the walk itself is checked in
    // movement.test.ts.
    steerAlongField(field, { x: 4.1, y: 9.1 }, out, 3);
    expect(Math.abs(out.x)).toBeLessThan(0.05);
    expect(out.y).toBeLessThan(-0.99);
  });
});

describe('the field covers the spawn zone', () => {
  it('maps a position above the grid to a real cell', () => {
    const field = laneField();
    const cell = cellAt(field, 4, -1.5);
    expect(cell).toBeGreaterThanOrEqual(0);
    expect(cell).toBeLessThan(field.width * field.depth);
    // Rows above y = 0 are the first rows of the field, not clamped to row 0.
    expect(Math.floor(cell / field.width)).toBe(Math.floor(1.5 * SUB));
  });

  it('reaches from the spawn centre to a goal on the grid', () => {
    const field = laneField();
    markObstacle(field, disc(4, 5, 0.26), 0.22);
    markRing(field, disc(4, 5, 0.26), 0.22, MELEE, 1);
    computeFlowField(field);
    expect(costAt(field, 4, -1.5)).toBeLessThan(UNREACHABLE);
  });
});

describe('cost model', () => {
  it('charges 10 for an orthogonal step and 14 for a diagonal', () => {
    const field = createFlowField(4, 4, 0, 1);
    clearField(field);
    field.sources[cellAt(field, 1.5, 1.5)] = 1;
    computeFlowField(field);

    expect(costAt(field, 1.5, 2.5)).toBe(10);
    expect(costAt(field, 2.5, 2.5)).toBe(14);
  });
});

describe('determinism', () => {
  it('computes the same field twice', () => {
    const build = () => {
      const field = wallWithGap(0.22);
      markRing(field, disc(3.5, 1, 0.26), 0.22, MELEE, 1);
      computeFlowField(field);
      return field;
    };
    expect(Array.from(build().cost)).toEqual(Array.from(build().cost));
  });
});

describe('a body with a spine is a wall, not a point', () => {
  // The fortress (§4) is a disc swept along a horizontal segment. Everything
  // else in the lane is a circle, which is the same code with a spine of zero.
  const SPINE = 3.55;
  const THICK = 0.45;
  const MONSTER = 0.22;

  it('blocks the whole length of itself, not just its middle', () => {
    const field = fullLaneField();
    markObstacle(field, wall(4, 10.5, THICK, SPINE), MONSTER);

    // Solid end to end at its own depth...
    for (const x of [0.4, 2, 4, 6, 7.6]) {
      expect(field.blocked[cellAt(field, x, 10.5)]).toBe(1);
    }
    // ...and not a tile above it, where the front rank stands.
    expect(field.blocked[cellAt(field, 4, 9.2)]).toBe(0);
  });

  it('offers attack positions along its whole face', () => {
    const field = fullLaneField();
    markObstacle(field, wall(4, 10.5, THICK, SPINE), MONSTER);
    markRing(field, wall(4, 10.5, THICK, SPINE), MONSTER, MELEE, 7);

    // A place to stand in front of every part of the wall, each one knowing
    // which body it belongs to - this is what a circle of the same area could
    // not give, and what lets a wave hit the fortress all at once.
    for (const x of [1, 2.5, 4, 5.5, 7]) {
      expect(goalOwner(field, { x, y: 9.8 })).toBe(7);
    }
  });

  it('is exactly the circle it used to be when the spine has no length', () => {
    const spined = fullLaneField();
    const round = fullLaneField();
    markRing(spined, wall(4, 6, 0.22, 0), 0.26, MELEE, 1);
    markRing(round, disc(4, 6, 0.22), 0.26, MELEE, 1);
    expect(Array.from(spined.sources)).toEqual(Array.from(round.sources));
    expect(Array.from(spined.owner)).toEqual(Array.from(round.owner));
  });
});

/**
 * The sweep against a plain relaxation pass.
 *
 * This is the test that matters most in the file and the only kind that could
 * have caught what it was written for. Dial's algorithm is an optimisation of
 * Dijkstra, and an optimisation is only worth having if it gives the same
 * answer; a bug in its queue does not throw, does not produce anything that
 * looks wrong in isolation, and quietly leaves half the field holding costs
 * that no route justifies. Every behaviour above can pass while that is true.
 *
 * So: build layouts at random, sweep them, and check every single cell against
 * a slow, obviously-correct shortest path over the same grid.
 */
describe('the sweep is exact', () => {
  /** Relax every edge until nothing improves. Obviously correct, obviously slow. */
  function shortestPaths(field: ReturnType<typeof laneField>): Int32Array {
    const { width, depth, blocked, sources } = field;
    const cost = new Int32Array(width * depth).fill(UNREACHABLE);
    for (let i = 0; i < cost.length; i++) if (sources[i] !== 0) cost[i] = 0;

    const steps: [number, number, number][] = [
      [0, 1, W_ORTH],
      [0, -1, W_ORTH],
      [1, 0, W_ORTH],
      [-1, 0, W_ORTH],
      [1, 1, W_DIAG],
      [-1, 1, W_DIAG],
      [1, -1, W_DIAG],
      [-1, -1, W_DIAG],
    ];

    for (let pass = 0, changed = true; changed && pass < 5000; pass++) {
      changed = false;
      for (let y = 0; y < depth; y++) {
        for (let x = 0; x < width; x++) {
          const here = cost[y * width + x]!;
          if (here === UNREACHABLE) continue;
          for (const [dx, dy, weight] of steps) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= depth) continue;
            const n = ny * width + nx;
            if (blocked[n] === 1) continue;
            if (dx !== 0 && dy !== 0) {
              if (blocked[y * width + nx] === 1 && blocked[ny * width + x] === 1) continue;
            }
            if (here + weight < cost[n]!) {
              cost[n] = here + weight;
              changed = true;
            }
          }
        }
      }
    }
    return cost;
  }

  /** A deterministic pseudo-random sequence: the failures have to be repeatable. */
  function scatter(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  it('agrees with a plain shortest path, cell for cell, on random layouts', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const random = scatter(seed);
      const field = laneField();

      const obstacles = 3 + Math.floor(random() * 12);
      for (let i = 0; i < obstacles; i++) {
        const x = random() * 8;
        const y = random() * 13 - 3;
        markObstacle(field, disc(x, y, 0.2 + random() * 0.3), 0.22);
      }
      const goals = 1 + Math.floor(random() * 3);
      for (let i = 0; i < goals; i++) {
        const x = random() * 8;
        const y = random() * 13 - 3;
        markRing(field, disc(x, y, 0.22), 0.22, random() < 0.5 ? MELEE : 2.5, i + 1);
      }

      computeFlowField(field);
      const want = shortestPaths(field);
      const wrong = [...field.cost].findIndex((got, i) => got !== want[i]);
      expect(
        wrong === -1 ? -1 : `seed ${seed} cell ${wrong}: ${field.cost[wrong]} vs ${want[wrong]}`,
      ).toBe(-1);
    }
  });

  it('has no handedness: a mirrored layout gives a mirrored field', () => {
    // The symptom that sent us looking: a unit against the left wall produced
    // wandering and jitter where the same unit against the right wall did not.
    // Nothing in the model is left- or right-handed, so nothing in the numbers
    // may be either.
    for (const x of [0.5, 1.5, 2.5, 3.5]) {
      const left = laneField();
      markObstacle(left, disc(x, 5.5, 0.26), 0.22);
      markRing(left, disc(x, 5.5, 0.26), 0.22, MELEE, 1);
      computeFlowField(left);

      const right = laneField();
      markObstacle(right, disc(8 - x, 5.5, 0.26), 0.22);
      markRing(right, disc(8 - x, 5.5, 0.26), 0.22, MELEE, 1);
      computeFlowField(right);

      for (let y = 0; y < left.depth; y++) {
        for (let cx = 0; cx < left.width; cx++) {
          expect(left.cost[y * left.width + cx]).toBe(
            right.cost[y * right.width + (right.width - 1 - cx)],
          );
        }
      }
    }
  });
});
