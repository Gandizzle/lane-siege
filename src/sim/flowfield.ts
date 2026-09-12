/**
 * Dijkstra flow field at sub-tile resolution. Replaces the greedy steering of
 * DESIGN.md §5.3 for the cases local steering cannot solve.
 *
 * WHY A FIELD, AND WHY NOT A*
 *
 * §5.3 ruled out A*, navmeshes and flow fields. Greedy steering was a fair
 * first guess but fails on the geometry this game makes: a wall of units with a
 * gap at one end is a local minimum, every greedy step is blocked, and the wave
 * presses flat against the wall forever. Measured: 0 of 8 monsters through an
 * open gap.
 *
 * A* would fix it but is the wrong shape. A* answers "one agent, one goal";
 * this is MANY agents converging on FEW goals - up to 30 monsters all heading
 * for the nearest unit - so per-agent A* re-solves nearly the same search 30
 * times over, and redoes it whenever the line changes. One Dijkstra sweep from
 * every goal at once labels each cell with its distance to the nearest, and
 * every agent walks downhill off the same answer.
 *
 * BODIES HAVE SIZE
 *
 * Agents are circles, not points, so a route through a one-cell gap is a lie.
 * Obstacles are therefore INFLATED by the mover's radius before the sweep - the
 * standard Minkowski trick - which means any downhill route the field offers
 * has genuine clearance for the body that will walk it. That is also why there
 * is one field per mover KIND rather than one for everybody: a monster and a
 * unit have different radii and so need different inflation.
 *
 * Resolution is sub-tile because a tile is wider than a body: at one cell per
 * tile, "blocked" and "clear" are the only answers and a unit half a tile wide
 * gets the same routing as one that fills it.
 *
 * COST MODEL
 *
 * Octile: 10 for an orthogonal step, 14 for a diagonal, which is 10·√2 rounded.
 * Plain breadth-first would treat both as equal and bend paths into staircases.
 * Integer weights bounded by 14 mean Dial's algorithm works - a small ring of
 * buckets instead of a heap - so the sweep is linear and allocation-free.
 *
 * DETERMINISM: integer costs, fixed neighbour order, typed arrays, no
 * floating-point comparisons in the sweep. Every client computes the same field
 * bit for bit.
 */

import type { Vec2 } from './types.ts';

export const UNREACHABLE = 0x7fffffff;

/** Orthogonal and diagonal step costs. 14/10 approximates √2. */
const W_ORTH = 10;
const W_DIAG = 14;

/** Buckets for Dial's algorithm: one more than the largest edge weight. */
const BUCKETS = W_DIAG + 1;

export interface FlowField {
  /** Cells per tile. */
  subdivision: number;
  /** Grid size in CELLS, not tiles. */
  width: number;
  depth: number;

  cost: Int32Array;
  /** 1 where a body of the inflating radius cannot stand. */
  blocked: Uint8Array;
  /** 1 where a goal is. */
  sources: Uint8Array;

  /** Dial's buckets: heads plus an intrusive next-pointer per cell. */
  bucketHead: Int32Array;
  nextInBucket: Int32Array;
}

export function createFlowField(
  tileWidth: number,
  tileDepth: number,
  subdivision: number,
): FlowField {
  const width = tileWidth * subdivision;
  const depth = tileDepth * subdivision;
  const cells = width * depth;

  return {
    subdivision,
    width,
    depth,
    cost: new Int32Array(cells),
    blocked: new Uint8Array(cells),
    sources: new Uint8Array(cells),
    bucketHead: new Int32Array(BUCKETS),
    nextInBucket: new Int32Array(cells),
  };
}

/** Neighbour offsets with their step costs. Orthogonals first, so ties settle. */
const NEIGHBOURS: readonly [number, number, number][] = [
  [0, 1, W_ORTH],
  [0, -1, W_ORTH],
  [1, 0, W_ORTH],
  [-1, 0, W_ORTH],
  [1, 1, W_DIAG],
  [-1, 1, W_DIAG],
  [1, -1, W_DIAG],
  [-1, -1, W_DIAG],
];

export function clearField(field: FlowField): void {
  field.blocked.fill(0);
  field.sources.fill(0);
}

/** Tile-space position to cell index, clamped into the grid. */
export function cellAt(field: FlowField, x: number, y: number): number {
  const cx = Math.min(field.width - 1, Math.max(0, Math.floor(x * field.subdivision)));
  const cy = Math.min(field.depth - 1, Math.max(0, Math.floor(y * field.subdivision)));
  return cy * field.width + cx;
}

/** Set every cell whose centre lies within `radius` tiles of (x, y). */
function stampDisc(
  field: FlowField,
  target: Uint8Array,
  x: number,
  y: number,
  radius: number,
): void {
  const reach = radius * field.subdivision;
  const cx = x * field.subdivision;
  const cy = y * field.subdivision;

  const minX = Math.max(0, Math.floor(cx - reach));
  const maxX = Math.min(field.width - 1, Math.ceil(cx + reach));
  const minY = Math.max(0, Math.floor(cy - reach));
  const maxY = Math.min(field.depth - 1, Math.ceil(cy + reach));
  const reachSq = reach * reach;

  for (let gy = minY; gy <= maxY; gy++) {
    for (let gx = minX; gx <= maxX; gx++) {
      const dx = gx + 0.5 - cx;
      const dy = gy + 0.5 - cy;
      if (dx * dx + dy * dy <= reachSq) target[gy * field.width + gx] = 1;
    }
  }
}

/**
 * Mark every cell a body of radius `inflate` would overlap if it stood there -
 * that is, everything within `bodyRadius + inflate` of the body's centre.
 *
 * Inflating here rather than checking clearance later is what lets a single
 * sweep answer "can THIS body get through" instead of "is there a gap at all".
 */
export function markObstacle(
  field: FlowField,
  x: number,
  y: number,
  bodyRadius: number,
  inflate: number,
): void {
  stampDisc(field, field.blocked, x, y, bodyRadius + inflate);
}

/**
 * Mark a goal that is also an obstacle - the normal case, since what an agent
 * is walking to is a body it cannot walk into.
 *
 * The WHOLE inflated blob is seeded, not just the centre. Seeding only the
 * centre cell strands the sweep: an inflated body is several cells across, so
 * every neighbour of its centre is blocked, nothing expands, and the entire
 * field comes back unreachable. Seeding the blob puts cost 0 on its rim, which
 * is where a mover's centre ends up when the two bodies touch - so a downhill
 * walk ends at contact, which is the "close, then attack" behaviour of §5.1.
 */
export function markGoalBody(
  field: FlowField,
  x: number,
  y: number,
  bodyRadius: number,
  inflate: number,
): void {
  const radius = bodyRadius + inflate;
  stampDisc(field, field.sources, x, y, radius);
  // A body smaller than a cell may round to nothing; it is still a goal.
  field.sources[cellAt(field, x, y)] = 1;
}

export function markSource(field: FlowField, x: number, y: number): void {
  field.sources[cellAt(field, x, y)] = 1;
}

/** Mark a whole tile row as a goal, for "head out of the build zone". */
export function markSourceRow(field: FlowField, tileY: number, tileWidth: number): void {
  const sub = field.subdivision;
  for (let cy = tileY * sub; cy < (tileY + 1) * sub; cy++) {
    if (cy < 0 || cy >= field.depth) continue;
    for (let cx = 0; cx < tileWidth * sub; cx++) {
      field.sources[cy * field.width + cx] = 1;
    }
  }
}

/**
 * Multi-source Dijkstra by Dial's algorithm.
 *
 * Sources seed at 0 whether or not they are blocked, and the sweep refuses to
 * expand INTO a blocked cell. So a goal body's blob holds cost 0 and the free
 * ground around it comes out at 10 and up: agents walk to the rim and stop.
 */
export function computeFlowField(field: FlowField): void {
  const { width, depth, cost, blocked, sources, bucketHead, nextInBucket } = field;

  cost.fill(UNREACHABLE);
  bucketHead.fill(-1);

  let pending = 0;
  for (let i = 0; i < cost.length; i++) {
    if (sources[i] !== 1) continue;
    cost[i] = 0;
    nextInBucket[i] = bucketHead[0]!;
    bucketHead[0] = i;
    pending++;
  }
  if (pending === 0) return;

  // Distances only ever increase, and never by more than W_DIAG, so BUCKETS
  // slots cycled modulo the distance are enough for exact Dijkstra.
  const maxDistance = (width + depth) * W_DIAG + 1;

  for (let distance = 0; distance <= maxDistance && pending > 0; distance++) {
    const slot = distance % BUCKETS;
    let cell = bucketHead[slot]!;
    bucketHead[slot] = -1;

    while (cell !== -1) {
      const next = nextInBucket[cell]!;
      // A cell re-inserted at a shorter distance leaves a stale entry behind.
      if (cost[cell] === distance) {
        pending--;
        const x = cell % width;
        const y = (cell / width) | 0;

        for (const [dx, dy, weight] of NEIGHBOURS) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= depth) continue;

          const n = ny * width + nx;
          if (blocked[n] === 1) continue;

          // No slipping diagonally between two blocked cells.
          if (dx !== 0 && dy !== 0) {
            if (blocked[y * width + nx] === 1 && blocked[ny * width + x] === 1) continue;
          }

          const candidate = distance + weight;
          if (candidate < cost[n]!) {
            cost[n] = candidate;
            const target = candidate % BUCKETS;
            nextInBucket[n] = bucketHead[target]!;
            bucketHead[target] = n;
            pending++;
          }
        }
      }
      cell = next;
    }
  }
}

/**
 * How far out to look, in cells, for a body whose own inflated footprint spans
 * `selfFootprint` tiles.
 *
 * A mover is in its own field's obstacle set, so the cells under it are its own
 * body and carry no useful cost. Reading only the eight touching cells would
 * find nothing but itself and conclude it was walled in; the search therefore
 * starts just beyond its own footprint.
 */
function reachCells(field: FlowField, selfFootprint: number): number {
  return Math.max(1, Math.ceil(selfFootprint * field.subdivision) + 1);
}

/**
 * How far this body is from the goal: the cost of the best cell within reach,
 * plus what it costs to get to that cell.
 *
 * Not simply the cost of the cell it stands on, because that cell is usually
 * its own body and so unreachable. This is the number the yielding order runs
 * on - whoever is nearer the goal has right of way - so every body needs a
 * real answer, not UNREACHABLE for all of them.
 *
 * The travel charge is what keeps it a gradient. A bare minimum over the
 * neighbourhood reads 0 for everyone within a tile of the goal, and the whole
 * crowd ties; charging for the distance to that cell separates them again.
 */
export function sampleCost(field: FlowField, from: Vec2, selfFootprint: number): number {
  const { width, depth, cost, subdivision } = field;
  const originX = Math.min(width - 1, Math.max(0, Math.floor(from.x * subdivision)));
  const originY = Math.min(depth - 1, Math.max(0, Math.floor(from.y * subdivision)));
  const reach = reachCells(field, selfFootprint);

  let best = cost[originY * width + originX]!;
  for (let dy = -reach; dy <= reach; dy++) {
    const ny = originY + dy;
    if (ny < 0 || ny >= depth) continue;
    for (let dx = -reach; dx <= reach; dx++) {
      const nx = originX + dx;
      if (nx < 0 || nx >= width) continue;
      const c = cost[ny * width + nx]!;
      if (c === UNREACHABLE) continue;
      const stepped = c + Math.max(Math.abs(dx), Math.abs(dy)) * W_ORTH;
      if (stepped < best) best = stepped;
    }
  }
  return best;
}

/**
 * Steer downhill from a tile-space position.
 *
 * Writes a unit vector into `out` and returns the chosen cell, or -1 when the
 * field offers nothing better than standing still: already at the goal, or
 * genuinely enclosed. The caller then falls back to local steering, which is
 * correct in both cases.
 *
 * `preferCell` is last tick's choice. Keeping it unless something is clearly
 * better stops a mover on a cell boundary alternating between two equally good
 * neighbours, which reads as a shiver.
 */
export function steerAlongField(
  field: FlowField,
  from: Vec2,
  out: Vec2,
  selfFootprint: number,
  preferCell = -1,
): number {
  const { width, depth, cost, subdivision } = field;

  const originX = Math.min(width - 1, Math.max(0, Math.floor(from.x * subdivision)));
  const originY = Math.min(depth - 1, Math.max(0, Math.floor(from.y * subdivision)));

  const here = cost[originY * width + originX]!;
  const reach = reachCells(field, selfFootprint);

  let bestCell = -1;
  let bestScore = here;

  for (let dy = -reach; dy <= reach; dy++) {
    const ny = originY + dy;
    if (ny < 0 || ny >= depth) continue;

    for (let dx = -reach; dx <= reach; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = originX + dx;
      if (nx < 0 || nx >= width) continue;

      const n = ny * width + nx;
      const c = cost[n]!;
      if (c === UNREACHABLE) continue;

      // Charge for the distance travelled to get there, so a nearer cell of
      // equal cost wins and the mover does not lunge across the neighbourhood.
      const stepped = c + Math.max(Math.abs(dx), Math.abs(dy)) * W_ORTH;
      const score = n === preferCell ? stepped - W_ORTH : stepped;
      if (score >= bestScore) continue;

      bestScore = score;
      bestCell = n;
    }
  }

  if (bestCell === -1) return -1;

  // Aim at the chosen cell's centre so motion is smooth rather than snapping
  // between cell centres.
  const targetX = ((bestCell % width) + 0.5) / subdivision;
  const targetY = (((bestCell / width) | 0) + 0.5) / subdivision;

  const vx = targetX - from.x;
  const vy = targetY - from.y;
  const length = Math.sqrt(vx * vx + vy * vy);
  if (length < 1e-9) return -1;

  out.x = vx / length;
  out.y = vy / length;
  return bestCell;
}
