/**
 * Bodies, contact, and how a body moves through a crowd.
 *
 * Every body in this simulation is a circle, and that one circle is its
 * collision shape, its hit shape and its drawn size at once. There are no other
 * shapes here on purpose: contact between two circles is one subtraction and
 * one comparison, it is exact, and it means that what you see touching is what
 * is touching.
 *
 * THE RULE
 *
 * A body is either ENGAGED - something is in range, it is attacking, it does
 * not move - or SEEKING - nothing is in range, it is walking. Engaged bodies
 * are immovable. Nothing pushes them, nothing displaces them, and a seeker that
 * walks into one slides off it. That single asymmetry is what removes the
 * face-to-face jitter that every earlier version had: two bodies in contact
 * could only shiver if something kept nudging one of them, and now nothing can.
 *
 * MOVE AND SLIDE
 *
 * A seeker proposes a step, then the step is corrected against every body it
 * would overlap: pushed straight back out along the line between the centres,
 * by exactly the overlap. Do that for each contact, a few times over, and the
 * component of the step INTO an obstacle is cancelled while the component ALONG
 * it survives. That is sliding. It is why a body pressed against a ring of
 * allies drifts around the ring instead of standing there, and why a column of
 * bodies behind a wall spreads sideways along it. Nothing here knows about
 * tangents, sides, or going round - the geometry does it.
 *
 * WHO MOVES FIRST, AND WHO YIELDS
 *
 * Seekers are processed in order of how close they are to a free attack
 * position. Each one resolves against everything SETTLED - engaged bodies,
 * bodies that cannot walk, every enemy, and every seeker ahead of it in the
 * order, which has already moved - and walks straight through the seekers
 * behind it, which have not. When their turn comes they find it where it now
 * is and are pushed out of it. So the body nearest a gap takes its full step
 * even if a body that wanted the same gap was in its way, and that body
 * yields. Two bodies competing for one hole can only jam if neither will give
 * way; here the one further from it always does, because it moves second.
 *
 * A body pushed out of a higher-priority body may have nowhere clean to go for
 * a tick - wedged between it and something settled. Then it keeps the least
 * overlapping position it can find, which is at worst where it started, and
 * the next tick's push finishes the job. Overlap between two seekers can
 * therefore exist briefly; it can never grow, and it never involves an engaged
 * body.
 *
 * DETERMINISM: a fixed processing order, plain arithmetic, and a deterministic
 * direction when two centres coincide exactly.
 */

import type { Vec2 } from './types.ts';

/** What contact needs to know about a body. Units and monsters both qualify. */
export interface Body {
  id: number;
  pos: Vec2;
  radius: number;
  alive: boolean;
  /**
   * Is this body where it is going to be this tick? Engaged and pinned bodies
   * always; a seeker once it has moved. A mover slides off settled bodies and
   * walks through unsettled ones - they will be pushed out of it in turn.
   */
  settled: boolean;
}

/** The edges of the lane, in tiles. A body's centre stays a radius inside them. */
export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Passes over the contact set per step. Two contacts resolved in sequence can
 * push a body back into the first, by a fraction that depends on the angle
 * between them; each pass shrinks what is left by that fraction. Neighbours in
 * a packed crowd sit at sixty degrees, which halves the residue per pass, so
 * eight passes take a full step's overlap below a thousandth of a tile. It has
 * to converge HERE, in one tick: a body that ends the tick overlapping and
 * then engages is frozen with the overlap in it. Passes end early the moment
 * nothing touches, which is nearly always after the first.
 */
const SLIDE_PASSES = 8;

/**
 * A hair of clearance left after resolving a contact, so two bodies that were
 * pushed to exactly touching do not read as overlapping again on the next tick
 * through floating-point noise and get pushed a second time.
 */
const CONTACT_EPSILON = 1e-4;

/**
 * Edge-to-edge distance between two circles. Negative means overlapping.
 */
export function gap(a: Body, b: Body): number {
  const dx = a.pos.x - b.pos.x;
  const dy = a.pos.y - b.pos.y;
  return Math.sqrt(dx * dx + dy * dy) - a.radius - b.radius;
}

/**
 * How deep `at` sits inside anything settled, or outside the lane. 0 is clean.
 */
function deepestOverlap(
  at: Vec2,
  self: Body,
  obstacles: readonly (readonly Body[])[],
  bounds: Bounds,
): number {
  const r = self.radius;
  let worst = Math.max(
    0,
    bounds.minX + r - at.x,
    at.x - (bounds.maxX - r),
    bounds.minY + r - at.y,
    at.y - (bounds.maxY - r),
  );
  for (const set of obstacles) {
    for (const other of set) {
      if (!other.alive || !other.settled || other === self) continue;
      const minDistance = self.radius + other.radius;
      const dx = at.x - other.pos.x;
      const dy = at.y - other.pos.y;
      const overlap = minDistance - Math.sqrt(dx * dx + dy * dy);
      if (overlap > worst) worst = overlap;
    }
  }
  return worst;
}

/**
 * Push a proposed position out of every settled body it overlaps, treating
 * those bodies as immovable, and back inside the lane's edges, which are walls
 * like any other contact and are resolved in the same passes so that a push
 * off one cannot leave the body inside the other. `self` is skipped. Mutates
 * `proposed`. Returns whether the last pass still had to push - the position
 * is then not known to be clean.
 */
function resolveContacts(
  proposed: Vec2,
  self: Body,
  obstacles: readonly (readonly Body[])[],
  bounds: Bounds,
): boolean {
  const r = self.radius;
  let touched = false;

  for (let pass = 0; pass < SLIDE_PASSES; pass++) {
    touched = false;

    if (proposed.x < bounds.minX + r) {
      proposed.x = bounds.minX + r;
      touched = true;
    } else if (proposed.x > bounds.maxX - r) {
      proposed.x = bounds.maxX - r;
      touched = true;
    }
    if (proposed.y < bounds.minY + r) {
      proposed.y = bounds.minY + r;
      touched = true;
    } else if (proposed.y > bounds.maxY - r) {
      proposed.y = bounds.maxY - r;
      touched = true;
    }

    for (const set of obstacles) {
      for (const other of set) {
        if (!other.alive || !other.settled || other === self) continue;

        const minDistance = self.radius + other.radius;
        let dx = proposed.x - other.pos.x;
        let dy = proposed.y - other.pos.y;
        const distSq = dx * dx + dy * dy;
        if (distSq >= minDistance * minDistance) continue;

        let dist = Math.sqrt(distSq);
        if (dist < 1e-9) {
          // Exactly on top of each other: a deterministic direction from the
          // ids, since any direction is as good as any other and clients must
          // agree on it.
          dx = (self.id + other.id) % 2 === 0 ? 1 : 0;
          dy = dx === 1 ? 0 : 1;
          dist = 1;
        }

        const push = (minDistance - dist) / dist + CONTACT_EPSILON;
        proposed.x += dx * push;
        proposed.y += dy * push;
        touched = true;
      }
    }

    if (!touched) return false;
  }
  return touched;
}

const scratchProposed: Vec2 = { x: 0, y: 0 };

/**
 * A resolved position this deep in something is not clean, and is only taken
 * if the body was at least that deep to begin with.
 */
const CLEAN_TOLERANCE = 1e-3;

/**
 * Move `self` by `step` tiles along the unit vector (dirX, dirY), sliding off
 * anything settled in the way, and keep it inside `bounds`. A step that cannot
 * be resolved cleanly is taken only if it leaves the body no deeper in anything
 * than it already was; otherwise the body stays put.
 *
 * Returns how far it actually got, which the caller can use to tell "arrived"
 * from "stuck" - though nothing in this simulation needs to any more.
 */
export function slideStep(
  self: Body,
  dirX: number,
  dirY: number,
  step: number,
  obstacles: readonly (readonly Body[])[],
  bounds: Bounds,
): number {
  const startX = self.pos.x;
  const startY = self.pos.y;

  scratchProposed.x = startX + dirX * step;
  scratchProposed.y = startY + dirY * step;

  const unresolved = resolveContacts(scratchProposed, self, obstacles, bounds);
  if (unresolved) {
    const after = deepestOverlap(scratchProposed, self, obstacles, bounds);
    if (after > CLEAN_TOLERANCE && after > deepestOverlap(self.pos, self, obstacles, bounds)) {
      return 0;
    }
  }

  self.pos.x = scratchProposed.x;
  self.pos.y = scratchProposed.y;

  const mx = self.pos.x - startX;
  const my = self.pos.y - startY;
  return Math.sqrt(mx * mx + my * my);
}

/**
 * Settle a body that is overlapping something without wanting to go anywhere -
 * one that has just spawned into a crowd, say. A zero-length slide.
 */
export function settle(self: Body, obstacles: readonly (readonly Body[])[], bounds: Bounds): void {
  slideStep(self, 0, 0, 0, obstacles, bounds);
}

/**
 * Order indices by (cost, id), in place, allocation-free.
 *
 * Insertion sort: the sets are small (a lane holds tens of bodies) and the
 * order barely changes between ticks, which is the case insertion sort is
 * fastest at. Stable, and ids are unique, so the order is total.
 */
export function orderByPriority(
  indices: number[],
  count: number,
  costOf: (index: number) => number,
  idOf: (index: number) => number,
): void {
  for (let i = 1; i < count; i++) {
    const key = indices[i]!;
    const keyCost = costOf(key);
    const keyId = idOf(key);
    let j = i - 1;
    while (j >= 0) {
      const other = indices[j]!;
      const otherCost = costOf(other);
      if (otherCost < keyCost || (otherCost === keyCost && idOf(other) < keyId)) break;
      indices[j + 1] = other;
      j--;
    }
    indices[j + 1] = key;
  }
}
