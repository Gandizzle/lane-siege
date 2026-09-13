/**
 * The distance field: where to walk to get into range of something.
 *
 * One multi-source Dijkstra sweep over the whole lane labels every cell with
 * its distance to the nearest FREE ATTACK POSITION, and every seeker of the
 * same kind and size walks downhill off the same answer. See docs/PATHING.md
 * for the model this serves; this file is the geometry.
 *
 * WHAT IS A GOAL
 *
 * Not the enemy - a place to stand where the enemy is in range. Around every
 * enemy body there is an annulus of positions from which a seeker of the given
 * radius and range can hit it: from touching distance out to touching distance
 * plus the range. Every cell that annulus passes through is a source, unless
 * something is already standing there. So the field's answer to "where should
 * I go" is "the nearest free position that something can be hit from", and
 * when a position is taken or freed the answer changes on the next sweep. That
 * is the whole of the gap-filling behaviour: no slot assignment, no queue, no
 * bookkeeping about who was heading where.
 *
 * The annulus is exact - the seeker's real range, not a fixed band - because a
 * goal that is not actually in range is a lie the seeker has to discover by
 * walking there, and a crowd of seekers discovering it at once is a crowd
 * milling. A melee body's annulus is thinner than a cell, so the last fraction
 * from the cell it reaches to actual contact is walked straight at the enemy
 * that owns the cell (see `owner`).
 *
 * A hole in a ring can be narrower than a cell and still fit a body - the gap
 * two ring members leave when a third dies is often exactly that - and a hole
 * the field cannot see never gets filled. So whether a cell is a goal is
 * decided at a finer resolution than the routing: each cell is sampled at
 * FINE × FINE points, and it is a goal if any of them is both in range and
 * clear of every obstacle. Routing stays at cell resolution, where the
 * clearance guarantee lives; only the question "is there an attack position
 * in this cell" is asked more carefully.
 *
 * WHEN EVERY GOAL IS TAKEN
 *
 * The goals are then the positions beside the bodies that are attacking, so
 * a body with nothing to attack waits where it is nearest to the next position
 * that frees up. Those goals are marked with a different kind (see `sources`)
 * so a body that reaches one stands there rather than pressing on. That is the
 * second of exactly two cases; there is no third.
 *
 * WHAT IS AN OBSTACLE
 *
 * Anything that will not move: every enemy body, every ally that is ENGAGED -
 * in range of something and therefore not going anywhere - and every ally that
 * cannot walk at all. Allies that are still walking are deliberately NOT
 * obstacles. They will have moved by the time anyone gets there, and treating
 * a moving crowd as terrain is what made every earlier attempt oscillate as
 * the terrain reshuffled under it. Contact between moving bodies is a local
 * matter, handled by sliding (motion.ts), not by the field.
 *
 * BODIES HAVE SIZE
 *
 * Every obstacle is inflated by the seeker's own radius before the sweep - the
 * Minkowski trick - so a cell is free exactly when a body of that radius can
 * stand there without overlapping anything. One field therefore serves one
 * radius; a boss gets its own sweep, which is cheap, rather than a route it
 * cannot fit.
 *
 * COST MODEL
 *
 * Octile: 10 for an orthogonal step, 14 for a diagonal. Integer weights bounded
 * by 14 mean Dial's algorithm works - a ring of buckets instead of a heap - so
 * the sweep is linear and allocation-free.
 *
 * DETERMINISM: integer costs, fixed neighbour order, typed arrays, and the only
 * floating point is the geometry of which cells a circle covers. Every client
 * computes the same field bit for bit.
 */

import type { Vec2 } from './types.ts';

export const UNREACHABLE = 0x7fffffff;

/** Sample points per cell side when deciding whether a cell holds a goal. */
const FINE = 4;

/** What kind of goal a source cell is. */
export const SOURCE_ATTACK = 1;
export const SOURCE_WAIT = 2;

/** Orthogonal and diagonal step costs. 14/10 approximates √2. */
export const W_ORTH = 10;
export const W_DIAG = 14;

/** Buckets for Dial's algorithm: one more than the largest edge weight. */
const BUCKETS = W_DIAG + 1;

export interface FlowField {
  /** Cells per tile. */
  subdivision: number;
  /** Tile-space y of cell row 0. Negative: the spawn zone sits above the grid. */
  originY: number;
  /** Grid size in CELLS, not tiles. */
  width: number;
  depth: number;

  cost: Int32Array;
  /** 1 where a body of the field's radius cannot stand. Decided by cell centre. */
  blocked: Uint8Array;
  /** The same at FINE times the resolution, for deciding where goals are. */
  blockedFine: Uint8Array;
  /** SOURCE_ATTACK or SOURCE_WAIT where a goal is, 0 elsewhere. */
  sources: Uint8Array;
  /** On an attack goal cell, the id of the enemy it is an attack position for. */
  owner: Int32Array;

  /** Dial's buckets: heads plus an intrusive next-pointer per cell. */
  bucketHead: Int32Array;
  nextInBucket: Int32Array;
}

export function createFlowField(
  tileWidth: number,
  tileDepth: number,
  originY: number,
  subdivision: number,
): FlowField {
  const width = tileWidth * subdivision;
  const depth = tileDepth * subdivision;
  const cells = width * depth;

  return {
    subdivision,
    originY,
    width,
    depth,
    cost: new Int32Array(cells),
    blocked: new Uint8Array(cells),
    blockedFine: new Uint8Array(cells * FINE * FINE),
    sources: new Uint8Array(cells),
    owner: new Int32Array(cells).fill(-1),
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
  field.blockedFine.fill(0);
  field.sources.fill(0);
  field.owner.fill(-1);
}

/** Tile-space position to cell index, clamped into the grid. */
export function cellAt(field: FlowField, x: number, y: number): number {
  const cx = Math.min(field.width - 1, Math.max(0, Math.floor(x * field.subdivision)));
  const cy = Math.min(
    field.depth - 1,
    Math.max(0, Math.floor((y - field.originY) * field.subdivision)),
  );
  return cy * field.width + cx;
}

/** The cost at a tile-space position. UNREACHABLE where nothing leads anywhere. */
export function costAt(field: FlowField, x: number, y: number): number {
  return field.cost[cellAt(field, x, y)]!;
}

/**
 * Mark every cell a body of radius `inflate` would overlap if it stood there -
 * every cell whose centre lies strictly within `bodyRadius + inflate` of the
 * body's centre - and the same at the fine resolution. Circles only; there are
 * no other shapes in this simulation.
 */
export function markObstacle(
  field: FlowField,
  x: number,
  y: number,
  bodyRadius: number,
  inflate: number,
): void {
  const sub = field.subdivision;
  const cx = x * sub;
  const cy = (y - field.originY) * sub;
  const reach = (bodyRadius + inflate) * sub;
  const reachSq = reach * reach;

  {
    const minX = Math.max(0, Math.floor(cx - reach));
    const maxX = Math.min(field.width - 1, Math.ceil(cx + reach));
    const minY = Math.max(0, Math.floor(cy - reach));
    const maxY = Math.min(field.depth - 1, Math.ceil(cy + reach));
    for (let gy = minY; gy <= maxY; gy++) {
      for (let gx = minX; gx <= maxX; gx++) {
        const dx = gx + 0.5 - cx;
        const dy = gy + 0.5 - cy;
        // Strict: a cell exactly at touching distance is standable.
        if (dx * dx + dy * dy < reachSq) field.blocked[gy * field.width + gx] = 1;
      }
    }
  }

  {
    const fineWidth = field.width * FINE;
    const fx = cx * FINE;
    const fy = cy * FINE;
    const fineReach = reach * FINE;
    const fineReachSq = fineReach * fineReach;
    const minX = Math.max(0, Math.floor(fx - fineReach));
    const maxX = Math.min(fineWidth - 1, Math.ceil(fx + fineReach));
    const minY = Math.max(0, Math.floor(fy - fineReach));
    const maxY = Math.min(field.depth * FINE - 1, Math.ceil(fy + fineReach));
    for (let gy = minY; gy <= maxY; gy++) {
      for (let gx = minX; gx <= maxX; gx++) {
        const dx = gx + 0.5 - fx;
        const dy = gy + 0.5 - fy;
        if (dx * dx + dy * dy < fineReachSq) field.blockedFine[gy * fineWidth + gx] = 1;
      }
    }
  }
}

/**
 * Mark the attack positions around a body: every cell holding a point from
 * which a seeker of radius `inflate` and reach `range` can hit it - a point in
 * the annulus from touching distance to touching distance plus the range, and
 * not inside any obstacle.
 *
 * A cell whose centre is clear counts on that alone: the annulus crosses it,
 * and the last fraction to actual contact is walked. A cell whose centre is
 * blocked is sampled at the fine resolution, and counts if any sample is both
 * in the annulus and clear - the hole between two ring members that is
 * narrower than a cell but wide enough for a body. Such a cell is unblocked so
 * the sweep can seed from it; it borders the enemy's own inflation, so nothing
 * routes THROUGH it to anywhere.
 *
 * Call AFTER every obstacle has been marked: a cell marked and then blocked
 * would tell a seeker to walk into a wall. `ownerId` is recorded so a seeker
 * that reaches the cell knows which enemy to close on; `kind` says whether the
 * cell is somewhere to attack from (SOURCE_ATTACK) or somewhere to wait
 * (SOURCE_WAIT).
 */
export function markRing(
  field: FlowField,
  x: number,
  y: number,
  bodyRadius: number,
  inflate: number,
  range: number,
  ownerId: number,
  kind: number = SOURCE_ATTACK,
): void {
  const sub = field.subdivision;
  const cx = x * sub;
  const cy = (y - field.originY) * sub;
  const near = (bodyRadius + inflate) * sub;
  const far = near + range * sub;

  const minX = Math.max(0, Math.floor(cx - far));
  const maxX = Math.min(field.width - 1, Math.ceil(cx + far));
  const minY = Math.max(0, Math.floor(cy - far));
  const maxY = Math.min(field.depth - 1, Math.ceil(cy + far));
  const nearSq = near * near;
  const farSq = far * far;
  const fineWidth = field.width * FINE;

  for (let gy = minY; gy <= maxY; gy++) {
    // Nearest and farthest the cell's row gets to the centre, in y.
    const dyNear = gy > cy ? gy - cy : cy > gy + 1 ? cy - (gy + 1) : 0;
    const dyFar = Math.max(cy - gy, gy + 1 - cy);
    for (let gx = minX; gx <= maxX; gx++) {
      const dxNear = gx > cx ? gx - cx : cx > gx + 1 ? cx - (gx + 1) : 0;
      const dxFar = Math.max(cx - gx, gx + 1 - cx);
      // The square meets the annulus when its nearest point is inside the
      // outer circle and its farthest point is outside the inner one.
      if (dxNear * dxNear + dyNear * dyNear > farSq) continue;
      if (dxFar * dxFar + dyFar * dyFar < nearSq) continue;

      const cell = gy * field.width + gx;
      if (field.blocked[cell] === 1) {
        let found = false;
        for (let sy = 0; sy < FINE && !found; sy++) {
          const py = gy + (sy + 0.5) / FINE;
          const dy = py - cy;
          for (let sx = 0; sx < FINE; sx++) {
            if (field.blockedFine[(gy * FINE + sy) * fineWidth + gx * FINE + sx] === 1) continue;
            const dx = gx + (sx + 0.5) / FINE - cx;
            const d = dx * dx + dy * dy;
            if (d >= nearSq && d <= farSq) {
              found = true;
              break;
            }
          }
        }
        if (!found) continue;
        field.blocked[cell] = 0;
      }
      field.sources[cell] = kind;
      field.owner[cell] = ownerId;
    }
  }
}

/**
 * Multi-source Dijkstra by Dial's algorithm. Sources seed at 0; the sweep never
 * expands INTO a blocked cell, so blocked cells stay UNREACHABLE and a seeker
 * standing on one reads the free ground beside it instead (`standingCost`).
 *
 * Returns how many sources there were: zero means nothing is reachable and the
 * caller should seed the fallback goals instead.
 */
export function computeFlowField(field: FlowField): number {
  const { width, depth, cost, blocked, sources, bucketHead, nextInBucket } = field;

  cost.fill(UNREACHABLE);
  bucketHead.fill(-1);

  let pending = 0;
  for (let i = 0; i < cost.length; i++) {
    if (sources[i] === 0) continue;
    cost[i] = 0;
    nextInBucket[i] = bucketHead[0]!;
    bucketHead[0] = i;
    pending++;
  }
  const sourceCount = pending;
  if (pending === 0) return 0;

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

  return sourceCount;
}

/**
 * What a cell of straight-line distance costs when ranking candidates. Below
 * the field's own step cost on purpose: the field already decided which cells
 * are downhill, and this only chooses among them - so a cell three steps down
 * the slope should beat one step down, not tie with it. Charging the full rate
 * made every straight-ahead cell tie with standing still, and nothing moved.
 */
const LOOKAHEAD_CHARGE = W_ORTH * 0.8;

/** The cell index of a tile-space position, clamped, split into x and y. */
function cellCoords(field: FlowField, from: Vec2, out: Vec2): void {
  const fx = from.x * field.subdivision;
  const fy = (from.y - field.originY) * field.subdivision;
  out.x = Math.min(field.width - 1, Math.max(0, Math.floor(fx)));
  out.y = Math.min(field.depth - 1, Math.max(0, Math.floor(fy)));
}

const scratchCell: Vec2 = { x: 0, y: 0 };

/**
 * How far from a goal a body standing at `from` is: the cost of its cell, or -
 * when its cell is blocked - the cheapest cell touching it.
 *
 * A body is only ever on a blocked cell because a cell is blocked by its
 * CENTRE while the body's centre sits a fraction of a cell away, outside the
 * obstacle it is pressed against. It is not inside anything; it is at the
 * edge of the free ground beside it, and that ground's cost is its cost. The
 * alternative - reading UNREACHABLE and "escaping" to the neighbouring cell -
 * is a step backwards that the next tick's closing step undoes, forever: the
 * shiver every body pressed against a ring used to have.
 */
export function standingCost(field: FlowField, from: Vec2): number {
  const { width, depth, cost } = field;
  cellCoords(field, from, scratchCell);
  const ox = scratchCell.x;
  const oy = scratchCell.y;

  const own = cost[oy * width + ox]!;
  if (own !== UNREACHABLE) return own;

  let best = UNREACHABLE;
  for (let dy = -1; dy <= 1; dy++) {
    const ny = oy + dy;
    if (ny < 0 || ny >= depth) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const nx = ox + dx;
      if (nx < 0 || nx >= width) continue;
      const c = cost[ny * width + nx]!;
      if (c < best) best = c;
    }
  }
  return best;
}

/**
 * The enemy a body standing at `from` should close on: the owner of the attack
 * goal under it, or of one touching its cell - a body pressed against a ring
 * member is usually on a blocked cell beside the goal rather than on it.
 * Returns -1 when no attack goal is within a cell: the body is somewhere to
 * wait, or nowhere in particular, and should stand still.
 */
export function goalOwner(field: FlowField, from: Vec2): number {
  const { width, depth, sources, owner } = field;
  cellCoords(field, from, scratchCell);
  const ox = scratchCell.x;
  const oy = scratchCell.y;

  const own = oy * width + ox;
  if (sources[own] === SOURCE_ATTACK) return owner[own]!;

  for (let dy = -1; dy <= 1; dy++) {
    const ny = oy + dy;
    if (ny < 0 || ny >= depth) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const nx = ox + dx;
      if (nx < 0 || nx >= width) continue;
      const n = ny * width + nx;
      if (sources[n] === SOURCE_ATTACK) return owner[n]!;
    }
  }
  return -1;
}

/**
 * Steer downhill from a tile-space position.
 *
 * Looks `lookahead` cells in every direction. Only cells strictly cheaper than
 * where the body stands (`standingCost`) are candidates - that is what
 * "downhill" means, and it is the guarantee that following the field is always
 * progress. Among the candidates, the one that is cheapest once the
 * straight-line walk to it is charged for wins, so the body heads as far down
 * the slope as the window allows rather than to the nearest cell that happens
 * to be lower. Charging true distance rather than steps is what keeps the walk
 * straight on open ground: with a step charge, three diagonals looked cheaper
 * than three orthogonals and every path zigzagged.
 *
 * Writes a unit vector into `out` and returns the chosen cell, or -1 when
 * nothing within reach is downhill: on a goal already, or enclosed. The caller
 * then closes on the enemy directly, which is correct in both cases.
 *
 * `preferCell` is last tick's choice, kept unless something is clearly better,
 * so a body on a cell boundary does not alternate between two equal neighbours.
 */
export function steerAlongField(
  field: FlowField,
  from: Vec2,
  out: Vec2,
  lookahead: number,
  preferCell = -1,
): number {
  const { width, depth, cost, subdivision } = field;

  const fx = from.x * subdivision;
  const fy = (from.y - field.originY) * subdivision;
  cellCoords(field, from, scratchCell);
  const originX = scratchCell.x;
  const originY = scratchCell.y;

  const here = standingCost(field, from);
  let bestCell = -1;
  let bestScore = Infinity;

  for (let dy = -lookahead; dy <= lookahead; dy++) {
    const ny = originY + dy;
    if (ny < 0 || ny >= depth) continue;

    for (let dx = -lookahead; dx <= lookahead; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = originX + dx;
      if (nx < 0 || nx >= width) continue;

      const n = ny * width + nx;
      const c = cost[n]!;
      if (c === UNREACHABLE || c >= here) continue;

      // Distance from where the body actually is, not from its cell's corner.
      const ex = nx + 0.5 - fx;
      const ey = ny + 0.5 - fy;
      const stepped = c + Math.sqrt(ex * ex + ey * ey) * LOOKAHEAD_CHARGE;
      const score = n === preferCell ? stepped - W_ORTH : stepped;
      if (score >= bestScore) continue;

      bestScore = score;
      bestCell = n;
    }
  }

  if (bestCell === -1) return -1;

  const targetX = ((bestCell % width) + 0.5) / subdivision;
  const targetY = (((bestCell / width) | 0) + 0.5) / subdivision + field.originY;

  const vx = targetX - from.x;
  const vy = targetY - from.y;
  const length = Math.sqrt(vx * vx + vy * vy);
  if (length < 1e-9) return -1;

  out.x = vx / length;
  out.y = vy / length;
  return bestCell;
}
