/**
 * Flow-field pathing. Replaces the greedy steering of DESIGN.md §5.3.
 *
 * WHY NOT A*
 *
 * §5.3 ruled out A*, navmeshes and flow fields, and greedy steering was the
 * right first guess - but it fails on the geometry this game actually makes.
 * A wall of units with a gap at one end is a local minimum: every greedy step
 * toward the target is blocked, no tie-break finds the gap, and the whole wave
 * presses flat against the wall forever. Measured: 0 of 8 monsters got through
 * an open gap.
 *
 * A* would fix that, but it is the wrong shape for this problem. A* answers
 * "one agent, one goal". Here it is MANY agents converging on FEW goals - up to
 * 30 monsters all heading for the nearest unit - so per-agent A* solves almost
 * the same search 30 times over and has to redo it whenever the line changes.
 *
 * A distance field inverts that: one breadth-first sweep from all the goals at
 * once labels every tile with its distance to the nearest one, and then every
 * agent just walks downhill. One search serves the whole wave. On this grid
 * that is 80 cells - about 640 edge relaxations - against 30 separate A* runs,
 * so it is both simpler and substantially cheaper, and it cannot get trapped
 * because the field encodes global connectivity by construction.
 *
 * This is the standard answer for RTS-scale crowds converging on shared goals.
 * It also happens to fit §15.3's budget far better than the alternative.
 *
 * DETERMINISM: fixed grid, fixed neighbour order, integer costs. No floats, no
 * iteration over hash maps, so every client computes the identical field.
 */

import type { Vec2 } from './types.ts';

export const UNREACHABLE = 0x7fffffff;

export interface FlowField {
  width: number;
  depth: number;
  /** Steps to the nearest source. UNREACHABLE where no route exists. */
  cost: Int32Array;
  /** Reusable BFS queue, so a sweep allocates nothing. */
  queue: Int32Array;
}

export function createFlowField(width: number, depth: number): FlowField {
  return {
    width,
    depth,
    cost: new Int32Array(width * depth),
    queue: new Int32Array(width * depth),
  };
}

/** Neighbour offsets, orthogonals first so ties resolve to straight moves. */
const NEIGHBOURS: readonly [number, number][] = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

function inside(field: FlowField, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < field.width && y < field.depth;
}

/**
 * Multi-source breadth-first sweep.
 *
 * `sources` are the goal tiles - they may themselves be blocked, which is the
 * normal case: a unit's tile is where monsters want to get to and also a tile
 * they cannot enter, so it seeds at distance 0 and its free neighbours come out
 * at 1. Agents therefore walk to the edge of it and stop, which is exactly the
 * "move into range, then attack" behaviour §5.1 asks for.
 */
export function computeFlowField(field: FlowField, blocked: Uint8Array, sources: Uint8Array): void {
  const { width, depth, cost, queue } = field;
  cost.fill(UNREACHABLE);

  let head = 0;
  let tail = 0;

  for (let i = 0; i < cost.length; i++) {
    if (sources[i] === 1) {
      cost[i] = 0;
      queue[tail++] = i;
    }
  }

  while (head < tail) {
    const index = queue[head++]!;
    const x = index % width;
    const y = (index / width) | 0;
    const next = cost[index]! + 1;

    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= depth) continue;

      const n = ny * width + nx;
      if (blocked[n] === 1) continue;

      // No cutting a diagonal between two blocked tiles - agents would appear
      // to slip through a wall's corner.
      if (dx !== 0 && dy !== 0) {
        if (blocked[y * width + nx] === 1 && blocked[ny * width + x] === 1) continue;
      }

      if (next < cost[n]!) {
        cost[n] = next;
        queue[tail++] = n;
      }
    }
  }
}

/**
 * Steer downhill: write a unit vector toward the best neighbouring tile.
 *
 * Positions outside the grid are clamped into it, since the spawn zone above
 * and the fortress zone below are open ground that the field does not cover.
 *
 * Returns false when the field offers no improvement - the caller then falls
 * back to steering straight at the target, which is correct on open ground.
 */
export function steerAlongField(field: FlowField, from: Vec2, out: Vec2): boolean {
  const tileX = Math.min(field.width - 1, Math.max(0, Math.floor(from.x)));
  const tileY = Math.min(field.depth - 1, Math.max(0, Math.floor(from.y)));

  const here = cellCost(field, tileX, tileY);

  let bestCost = here;
  let bestX = 0;
  let bestY = 0;
  let found = false;

  for (const [dx, dy] of NEIGHBOURS) {
    const nx = tileX + dx;
    const ny = tileY + dy;
    if (!inside(field, nx, ny)) continue;

    const c = field.cost[ny * field.width + nx]!;
    if (c >= bestCost) continue;

    bestCost = c;
    bestX = dx;
    bestY = dy;
    found = true;
  }

  if (!found) return false;

  // Aim at the centre of the chosen tile rather than along the raw axis: that
  // keeps motion smooth instead of snapping between tile centres, and stops an
  // agent sitting on a tile boundary from flip-flopping between two neighbours.
  const targetX = tileX + bestX + 0.5;
  const targetY = tileY + bestY + 0.5;

  const vx = targetX - from.x;
  const vy = targetY - from.y;
  const length = Math.sqrt(vx * vx + vy * vy);
  if (length < 1e-9) return false;

  out.x = vx / length;
  out.y = vy / length;
  return true;
}

function cellCost(field: FlowField, tileX: number, tileY: number): number {
  return field.cost[tileY * field.width + tileX]!;
}

/** True when the field reached this tile at all. */
export function isReachable(field: FlowField, x: number, y: number): boolean {
  const tileX = Math.min(field.width - 1, Math.max(0, Math.floor(x)));
  const tileY = Math.min(field.depth - 1, Math.max(0, Math.floor(y)));
  return cellCost(field, tileX, tileY) !== UNREACHABLE;
}
