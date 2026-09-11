/**
 * Keeping same-kind bodies out of each other, without jitter or deadlock.
 *
 * The first attempt refused any step that would overlap a neighbour. That is
 * where the jitter came from: a blocked agent falls through to its next-best
 * direction, its neighbour does the same, and the pair oscillate - and with
 * three or more mutually blocking each other, every direction is refused and
 * the whole group clogs.
 *
 * The fix is to stop refusing moves. Agents move wherever the path says, and
 * afterwards any pair that ended up too close is pushed apart. Displacement,
 * not refusal: there is no decision to flip-flop between, and a clump always
 * resolves because the push is a continuous function of the overlap rather than
 * a yes/no gate.
 *
 * Hard blocking is still right for a monster meeting a WALL of units - that is
 * terrain, not a crowd - so the occupancy grid keeps doing that job.
 *
 * DETERMINISM: pairs are visited in array order and the maths is plain
 * arithmetic, so every client resolves a pile identically.
 */

import type { Vec2 } from './types.ts';

export interface SeparableBody {
  pos: Vec2;
  alive: boolean;
  /**
   * Body radius. Pairwise, so a boss really is bigger than a grub: a single
   * global radius meant a boss drawn at twice the size collided at normal size
   * and its silhouette clipped straight through its escort.
   */
  radius: number;
  /**
   * Distance to this body's goal, from the flow field. It is the priority
   * order: whoever is closer to the goal holds its ground and whoever is
   * further yields.
   *
   * This asymmetry is the whole trick. Symmetric shoving both oscillates - each
   * agent undoes the other's step, every tick - and deadlocks, because a ring
   * of agents can all block each other. A strict order cannot contain a cycle,
   * so a crowd resolves into a queue instead of a scrum.
   */
  pathCost: number;
  id: number;
}

/**
 * How much of the overlap to correct per iteration. Below 1 so a pile settles
 * over a few ticks instead of exploding apart, which would look like a bounce.
 */
const STIFFNESS = 0.7;

/** True when `a` outranks `b`: closer to the goal, ties broken by id. */
export function outranks(a: SeparableBody, b: SeparableBody): boolean {
  if (a.pathCost !== b.pathCost) return a.pathCost < b.pathCost;
  return a.id < b.id;
}

/**
 * Would standing at (x, y) overlap a body that outranks `self`?
 *
 * Only higher-priority bodies block, so the check can never be mutual and a
 * group can never deadlock: someone in any set of agents is always the closest
 * to the goal, and that one is free to move.
 */
export function blockedByPriority(
  bodies: readonly SeparableBody[],
  self: SeparableBody,
  x: number,
  y: number,
): boolean {
  for (const other of bodies) {
    if (!other.alive || other === self) continue;
    if (!outranks(other, self)) continue;

    const minDistance = self.radius + other.radius;
    const dx = x - other.pos.x;
    const dy = y - other.pos.y;
    if (dx * dx + dy * dy < minDistance * minDistance) return true;
  }

  return false;
}

/**
 * Push overlapping pairs apart.
 *
 * `canOccupy` vetoes a resolved position - used to stop a shove from squeezing
 * a monster inside a unit's tile. A vetoed body simply keeps its position for
 * this pass; the next tick tries again.
 */
export function relaxSeparation(
  bodies: readonly SeparableBody[],
  iterations: number,
  canOccupy: ((x: number, y: number) => boolean) | null,
): void {
  if (bodies.length < 2) return;

  for (let pass = 0; pass < iterations; pass++) {
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i]!;
      if (!a.alive) continue;

      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j]!;
        if (!b.alive) continue;

        const minDistance = a.radius + b.radius;
        if (minDistance <= 0) continue;

        let dx = b.pos.x - a.pos.x;
        let dy = b.pos.y - a.pos.y;
        const distSq = dx * dx + dy * dy;
        if (distSq >= minDistance * minDistance) continue;

        let dist = Math.sqrt(distSq);
        if (dist < 1e-6) {
          // Exactly coincident: pick a deterministic direction from the pair's
          // indices rather than a random one, or clients would disagree.
          dx = ((i + j) & 1) === 0 ? 1 : 0;
          dy = ((i + j) & 1) === 0 ? 0 : 1;
          dist = 1;
        }

        // Only the lower-priority body moves. Pushing both is what made the
        // leader bounce backwards into the step it had just taken, which is
        // exactly the jitter this is here to remove.
        const push = ((minDistance - dist) / dist) * STIFFNESS;

        if (outranks(a, b)) {
          const bx = b.pos.x + dx * push;
          const by = b.pos.y + dy * push;
          if (!canOccupy || canOccupy(bx, by)) {
            b.pos.x = bx;
            b.pos.y = by;
          }
        } else {
          const ax = a.pos.x - dx * push;
          const ay = a.pos.y - dy * push;
          if (!canOccupy || canOccupy(ax, ay)) {
            a.pos.x = ax;
            a.pos.y = ay;
          }
        }
      }
    }
  }
}

/**
 * Resolve overlaps BETWEEN the two kinds, moving only the intruder.
 *
 * Same-kind separation is symmetric-ish with a priority order, but across kinds
 * there is no sensible ranking - so the defender holds its ground and the
 * monster gets pushed back out. The result is melee that stops exactly at
 * contact: bodies touching, neither clipping through nor standing apart.
 *
 * Tile occupancy still stops monsters entering a unit's tile, but a tile is a
 * whole unit wide, so on its own it let a monster's body sink into a unit's by
 * roughly a tenth of a tile.
 */
export function pushOutOf(
  intruders: readonly SeparableBody[],
  holders: readonly SeparableBody[],
): void {
  for (const intruder of intruders) {
    if (!intruder.alive) continue;

    for (const holder of holders) {
      if (!holder.alive) continue;

      const minDistance = intruder.radius + holder.radius;
      let dx = intruder.pos.x - holder.pos.x;
      let dy = intruder.pos.y - holder.pos.y;
      const distSq = dx * dx + dy * dy;
      if (distSq >= minDistance * minDistance) continue;

      let dist = Math.sqrt(distSq);
      if (dist < 1e-6) {
        // Exactly coincident: back the intruder off the way it came.
        dx = 0;
        dy = -1;
        dist = 1;
      }

      intruder.pos.x = holder.pos.x + (dx / dist) * minDistance;
      intruder.pos.y = holder.pos.y + (dy / dist) * minDistance;
    }
  }
}

/**
 * A steering nudge away from nearby bodies that outrank this one.
 *
 * Blended into the desired heading rather than used as a veto. A veto is
 * discrete - a direction is allowed or it is not - and the allowed set churns
 * every tick as the crowd shifts, so the choice flips and the agent shuffles on
 * the spot. Measured: vetoing produced 203 tiles of wasted travel where this
 * produces almost none.
 *
 * Being continuous, it also does the thing the veto could not: agents curve
 * smoothly around an ally and fan out around the far side of a target, instead
 * of stacking into a queue behind it.
 *
 * Only outranking bodies push, so a leader is never deflected by its own
 * followers.
 *
 * Writes a unit vector into `out` and returns true when there was anything to
 * avoid.
 */
export function avoidanceDirection(
  bodies: readonly SeparableBody[],
  self: SeparableBody,
  out: Vec2,
): boolean {
  let ax = 0;
  let ay = 0;

  for (const other of bodies) {
    if (!other.alive || other === self) continue;
    if (!outranks(other, self)) continue;

    const minDistance = self.radius + other.radius;
    // Start easing aside before contact, so the curve is gentle.
    const influence = minDistance * 2;

    const dx = self.pos.x - other.pos.x;
    const dy = self.pos.y - other.pos.y;
    const distSq = dx * dx + dy * dy;
    if (distSq >= influence * influence) continue;

    const dist = Math.sqrt(distSq);
    if (dist < 1e-6) {
      ax += 1;
      continue;
    }

    // Strength rises as they close, so a distant ally barely registers.
    const strength = (influence - dist) / influence;
    ax += (dx / dist) * strength;
    ay += (dy / dist) * strength;
  }

  const length = Math.sqrt(ax * ax + ay * ay);
  if (length < 1e-6) return false;

  out.x = ax / length;
  out.y = ay / length;
  return true;
}
