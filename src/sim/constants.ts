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
 * Monsters re-evaluate their nearest target on this interval rather than every
 * tick (§5.1, §15.3). The doc gives a range of 0.25-0.5s; 0.25s is the
 * responsive end. Raise it first if the CPU budget is tight.
 */
export const MONSTER_RETARGET_TICKS = secondsToTicks(0.25);

/**
 * Stuck detection (§5.3). If a monster's net displacement over this window is
 * below the threshold, it stops steering and attacks whatever is nearest.
 * This fallback must exist or monsters vibrate against obstacles forever.
 */
export const STUCK_WINDOW_TICKS = secondsToTicks(1);

/** Tiles of net displacement below which a monster counts as stuck. */
export const STUCK_DISPLACEMENT_TILES = 0.1;
