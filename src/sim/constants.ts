/**
 * Engine constants. NOT balance data.
 *
 * DESIGN.md's rule is that no *balance* number may be hardcoded - unit stats,
 * costs, HP, wave curves all live in `data/`. The values here are properties of
 * the engine itself: the tick rate the determinism guarantee is defined against
 * (§15.1) and two CPU-budget intervals (§15.3). They are stated in the doc as
 * architecture, not as things to playtest.
 *
 * If you find yourself wanting to tune one of these for feel rather than for
 * frame time, it belongs in `data/`, not here.
 */

/** Fixed timestep. DESIGN.md §15.1. The server runs the same rate. */
export const TICKS_PER_SECOND = 20;

/** Seconds of simulated time per tick. */
export const SECONDS_PER_TICK = 1 / TICKS_PER_SECOND;

export function secondsToTicks(seconds: number): number {
  return Math.round(seconds * TICKS_PER_SECOND);
}

export function ticksToSeconds(ticks: number): number {
  return ticks * SECONDS_PER_TICK;
}

/**
 * Hysteresis on being in range, in tiles.
 *
 * A body engages when an enemy's edge is within its range, and stays engaged
 * until that enemy is further than range PLUS this. Without the slack a target
 * drifting a hair across the boundary flips its attacker between "attacking"
 * and "walking" every tick, which is the face-to-face shiver. With it there is
 * no boundary to sit on.
 *
 * Engine, not balance: it is about float noise at a threshold, and it is far
 * smaller than any range in data/.
 */
export const ENGAGE_SLACK_TILES = 0.12;

/**
 * The acquisition range of a body that has no cap: a defensive unit, whose
 * default is simply "the nearest monster in the lane" (§5.2).
 *
 * A number rather than a special case, so `holdOrAcquire` has one code path.
 * Larger than any lane, and finite so the arithmetic inside it stays ordinary.
 */
export const NO_ACQUIRE_LIMIT = 1e6;

/**
 * Attack cooldown in ticks for a given attacks-per-second rate.
 *
 * Whole ticks, so two clients running the same match agree on exactly which
 * tick a blow lands (§15.1). A rate of zero never fires rather than firing
 * every tick, which is what a divide by zero would otherwise give.
 */
export function cooldownTicks(attacksPerSecond: number): number {
  if (attacksPerSecond <= 0) return Number.MAX_SAFE_INTEGER;
  return Math.max(1, Math.round(TICKS_PER_SECOND / attacksPerSecond));
}
