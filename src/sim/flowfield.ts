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

/**
 * `owner` where no goal has been marked.
 *
 * Deliberately not -1. The fortress is a body with an id of its own
 * (`FORTRESS_ID`, which IS -1), and it is the goal every monster walks to once
 * a lane is clear (§5.5). Sharing the sentinel made every fortress attack
 * position read as unmarked, so monsters walked to the wall, stood on a goal
 * cell, and never took the last step into contact - a besieged fortress took no
 * damage at all. Any value no entity can hold will do; this one cannot be
 * confused with an id by accident.
 */
export const NO_OWNER = -0x7fffffff;

/**
 * A body as the field sees it: a disc of `radius` swept along a horizontal
 * spine of half-length `halfWidth`, centred on (x, y). `halfWidth` 0 is a plain
 * circle, which is every body but the fortress - see motion.ts for why the
 * fortress is not one.
 *
 * Passed as a record rather than as four loose numbers because the argument
 * lists below already carry an inflation, a range, an owner and a kind, and a
 * fourth bare scalar in the middle of that is a bug waiting for a refactor.
 */
export interface FieldShape {
  x: number;
  y: number;
  radius: number;
  halfWidth: number;
}

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

  /**
   * Dial's buckets, as intrusive DOUBLY-linked lists: one head per bucket, and
   * per cell a forward link, a back link, and which bucket it is currently in
   * (-1 for none).
   *
   * Doubly linked so a cell can be UNLINKED when a shorter route to it is
   * found. With a single forward link there is nowhere to put the cell's new
   * link without destroying its old one - and the old one is the spine of the
   * bucket it is still sitting in, so overwriting it orphans every cell behind
   * it. Those cells are then never relaxed and keep whatever inflated cost they
   * had. It is silent: the field still looks like a field, and roughly half of
   * it is wrong. See `computeFlowField`.
   */
  bucketHead: Int32Array;
  nextInBucket: Int32Array;
  prevInBucket: Int32Array;
  bucketOf: Int32Array;
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
    owner: new Int32Array(cells).fill(NO_OWNER),
    bucketHead: new Int32Array(BUCKETS),
    nextInBucket: new Int32Array(cells),
    prevInBucket: new Int32Array(cells),
    bucketOf: new Int32Array(cells),
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
  field.owner.fill(NO_OWNER);
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
 * every cell whose centre lies strictly within `shape.radius + inflate` of the
 * shape's spine - and the same at the fine resolution.
 */
export function markObstacle(field: FlowField, shape: FieldShape, inflate: number): void {
  const sub = field.subdivision;
  const cx = shape.x * sub;
  const cy = (shape.y - field.originY) * sub;
  const spine = shape.halfWidth * sub;
  const spineMin = cx - spine;
  const spineMax = cx + spine;
  const reach = (shape.radius + inflate) * sub;
  const reachSq = reach * reach;

  {
    const minX = Math.max(0, Math.floor(spineMin - reach));
    const maxX = Math.min(field.width - 1, Math.ceil(spineMax + reach));
    const minY = Math.max(0, Math.floor(cy - reach));
    const maxY = Math.min(field.depth - 1, Math.ceil(cy + reach));
    for (let gy = minY; gy <= maxY; gy++) {
      for (let gx = minX; gx <= maxX; gx++) {
        const px = gx + 0.5;
        const dx = px < spineMin ? px - spineMin : px > spineMax ? px - spineMax : 0;
        const dy = gy + 0.5 - cy;
        // Strict: a cell exactly at touching distance is standable.
        if (dx * dx + dy * dy < reachSq) field.blocked[gy * field.width + gx] = 1;
      }
    }
  }

  {
    const fineWidth = field.width * FINE;
    const fineMin = spineMin * FINE;
    const fineMax = spineMax * FINE;
    const fy = cy * FINE;
    const fineReach = reach * FINE;
    const fineReachSq = fineReach * fineReach;
    const minX = Math.max(0, Math.floor(fineMin - fineReach));
    const maxX = Math.min(fineWidth - 1, Math.ceil(fineMax + fineReach));
    const minY = Math.max(0, Math.floor(fy - fineReach));
    const maxY = Math.min(field.depth * FINE - 1, Math.ceil(fy + fineReach));
    for (let gy = minY; gy <= maxY; gy++) {
      for (let gx = minX; gx <= maxX; gx++) {
        const px = gx + 0.5;
        const dx = px < fineMin ? px - fineMin : px > fineMax ? px - fineMax : 0;
        const dy = gy + 0.5 - fy;
        if (dx * dx + dy * dy < fineReachSq) field.blockedFine[gy * fineWidth + gx] = 1;
      }
    }
  }
}

/**
 * How much room, in tiles, a body needs BEYOND the exact sum of two radii
 * before the field will route it between them.
 *
 * The field's inflation used to be exact, so a slot with a thousandth of a
 * tile to spare read as free ground. Contact resolution cannot place a body
 * there: pushed clear of one neighbour it lands inside the other, and the step
 * is refused (motion.ts). The body then presses into the notch for the rest of
 * the wave while the field keeps telling it to - the "stuck behind an ally" a
 * crowd at the fortress wall shows most clearly, since the wall is lined with
 * engaged bodies a hair too close together to pass.
 *
 * A tenth of a cell. Big enough that a slot the field offers is one a body can
 * actually be placed in, small enough to leave the real gaps open: the routing
 * tests measure both, and gap-filling is unchanged at this value.
 */
export const PASSAGE_CLEARANCE = 0.02;

/**
 * Block the strip along the lane's edge that a body of `inflate` cannot stand
 * in, at both resolutions.
 *
 * motion.ts keeps every body's whole width inside the lane, so a position
 * within its own radius of the boundary is one no body of that size can
 * occupy. The field did not know that: it inflated bodies and left the lane's
 * own walls uninflated, so the cells along each edge read as free ground - and
 * the attack positions marked there were goals a crowd could walk at forever
 * without ever arriving. A wave besieging a lane-wide fortress would pile into
 * the corner chasing one, while free wall stood empty a few tiles away,
 * because a goal that is never occupied is never taken off the field.
 *
 * Call before the obstacles, like any other terrain.
 */
export function markBorder(field: FlowField, inflate: number): void {
  const margin = inflate * field.subdivision;
  blockBorder(field.blocked, field.width, field.depth, margin);
  blockBorder(field.blockedFine, field.width * FINE, field.depth * FINE, margin * FINE);
}

/**
 * Block the outer `margin` cells of a grid, writing only the strips rather
 * than scanning every cell: this runs once per field per tick (§15.3), and a
 * field is tens of thousands of cells at the fine resolution.
 */
function blockBorder(grid: Uint8Array, width: number, depth: number, margin: number): void {
  // Cells whose CENTRE is inside the margin, which is what `blocked` means.
  const band = Math.min(Math.ceil(margin - 0.5), Math.min(width, depth) >> 1);
  if (band <= 0) return;

  grid.fill(1, 0, band * width);
  grid.fill(1, (depth - band) * width, depth * width);
  for (let gy = band; gy < depth - band; gy++) {
    const row = gy * width;
    grid.fill(1, row, row + band);
    grid.fill(1, row + width - band, row + width);
  }
}

/** How far one x sits outside the spine's interval. 0 anywhere along it. */
function offSpine(px: number, spineMin: number, spineMax: number): number {
  return px < spineMin ? spineMin - px : px > spineMax ? px - spineMax : 0;
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
  shape: FieldShape,
  inflate: number,
  range: number,
  ownerId: number,
  kind: number = SOURCE_ATTACK,
): void {
  const sub = field.subdivision;
  const cx = shape.x * sub;
  const cy = (shape.y - field.originY) * sub;
  const spine = shape.halfWidth * sub;
  const spineMin = cx - spine;
  const spineMax = cx + spine;
  const near = (shape.radius + inflate) * sub;
  const far = near + range * sub;

  const minX = Math.max(0, Math.floor(spineMin - far));
  const maxX = Math.min(field.width - 1, Math.ceil(spineMax + far));
  const minY = Math.max(0, Math.floor(cy - far));
  const maxY = Math.min(field.depth - 1, Math.ceil(cy + far));
  const nearSq = near * near;
  const farSq = far * far;
  const fineWidth = field.width * FINE;

  for (let gy = minY; gy <= maxY; gy++) {
    // Nearest and farthest the cell's row gets to the spine, in y.
    const dyNear = gy > cy ? gy - cy : cy > gy + 1 ? cy - (gy + 1) : 0;
    const dyFar = Math.max(cy - gy, gy + 1 - cy);
    for (let gx = minX; gx <= maxX; gx++) {
      // The cell's x-interval against the spine's: 0 where they overlap.
      const dxNear = gx > spineMax ? gx - spineMax : gx + 1 < spineMin ? spineMin - (gx + 1) : 0;
      // Distance to an interval is convex along x, so the cell's farthest
      // point from the spine is at one of its two edges.
      const dxFar = Math.max(
        offSpine(gx, spineMin, spineMax),
        offSpine(gx + 1, spineMin, spineMax),
      );
      // The square meets the annulus when its nearest point is inside the
      // outer boundary and its farthest point is outside the inner one.
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
            const dx = offSpine(gx + (sx + 0.5) / FINE, spineMin, spineMax);
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
 *
 * WHY THE BUCKETS ARE DOUBLY LINKED
 *
 * Every queued cell's cost lies in [d, d + W_DIAG] while distance d is being
 * processed - nothing is ever inserted below d, and the largest step is
 * W_DIAG - so a window of BUCKETS = W_DIAG + 1 slots holds them all with no two
 * distinct costs sharing a slot. That is what makes Dial's exact.
 *
 * It is only exact if the queue is. An earlier version linked the buckets with
 * a single forward pointer per cell, and re-inserting a cell that was already
 * queued overwrote that pointer - which was the spine of the bucket it still
 * sat in. Every cell behind it was orphaned, never relaxed, and kept whatever
 * inflated cost it happened to have. Roughly half of a typical field was wrong,
 * some of it UNREACHABLE with a perfectly good route available, and which half
 * depended on the order cells happened to be scanned in. That is a directional
 * bias, a stall, and a jitter all at once, and none of it looked like a bug in
 * a queue. `flowfield.test.ts` now checks the whole field against a plain
 * relaxation pass on randomised layouts, which is the only kind of test that
 * catches this.
 */
export function computeFlowField(field: FlowField): number {
  const { width, depth, cost, blocked, sources } = field;
  const { bucketHead, nextInBucket, prevInBucket, bucketOf } = field;

  cost.fill(UNREACHABLE);
  bucketHead.fill(-1);
  bucketOf.fill(-1);

  /** Put `cell` at the head of its bucket. It must not already be in one. */
  const link = (cell: number, slot: number): void => {
    const head = bucketHead[slot]!;
    nextInBucket[cell] = head;
    prevInBucket[cell] = -1;
    if (head !== -1) prevInBucket[head] = cell;
    bucketHead[slot] = cell;
    bucketOf[cell] = slot;
  };

  /** Take `cell` out of whichever bucket holds it. */
  const unlink = (cell: number): void => {
    const slot = bucketOf[cell]!;
    if (slot === -1) return;
    const prev = prevInBucket[cell]!;
    const next = nextInBucket[cell]!;
    if (prev === -1) bucketHead[slot] = next;
    else nextInBucket[prev] = next;
    if (next !== -1) prevInBucket[next] = prev;
    bucketOf[cell] = -1;
  };

  let pending = 0;
  for (let i = 0; i < cost.length; i++) {
    if (sources[i] === 0) continue;
    cost[i] = 0;
    link(i, 0);
    pending++;
  }
  const sourceCount = pending;
  if (pending === 0) return 0;

  // A bound on the longest shortest path: every cell, every step diagonal.
  const maxDistance = width * depth * W_DIAG + 1;

  for (let distance = 0; distance <= maxDistance && pending > 0; distance++) {
    const slot = distance % BUCKETS;

    // Cells are unlinked as they are taken, and relaxing one can insert into
    // this same slot only at a strictly greater distance - which cannot happen,
    // since every insertion is distance + weight and weight >= W_ORTH. So the
    // list only ever shrinks here.
    let cell = bucketHead[slot]!;
    while (cell !== -1) {
      unlink(cell);
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
          // Already queued at a worse cost: take it out before re-filing it,
          // or its old bucket loses everything behind it.
          if (bucketOf[n] !== -1) {
            unlink(n);
            pending--;
          }
          cost[n] = candidate;
          link(n, candidate % BUCKETS);
          pending++;
        }
      }

      cell = bucketHead[slot]!;
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
 * Returns `NO_OWNER` when no attack goal is within a cell: the body is
 * somewhere to wait, or nowhere in particular, and should stand still.
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
  return NO_OWNER;
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
