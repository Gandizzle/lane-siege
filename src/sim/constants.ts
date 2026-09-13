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
