/**
 * Test-only fixtures. Imported by `*.test.ts` and by nothing the game ships.
 *
 * WHY THIS EXISTS. A lot of rules are about what happens BETWEEN waves -
 * respawn, the sell discount, when a send lands, whether the shop reopens - and
 * the only way to see one is to run a wave to its end and look at the build
 * phase that follows. Written against the real `data/`, such a test quietly
 * depends on wave 1 being small enough for whatever line the test happened to
 * build, and the day wave 1 is tuned the test fails somewhere far from the rule
 * it was testing. That happened: waves 1 to 5 went from 8 bodies to 28-44 and
 * seven tests in four files broke, none of them about waves.
 *
 * So a test about the build phase gets a wave it can finish, and says so.
 */

import type { GameData } from '../data/schema.ts';

/**
 * The balance data with every authored wave cut to one weak monster.
 *
 * For tests that need a wave to END rather than to be a fight. The monster is
 * still a real monster off the roster, so spawning, pathing, bounty and the
 * wave clocks all behave; there is simply one of it.
 */
export function trivialWaves(data: GameData, monsterId = 'grub'): GameData {
  const copy = structuredClone(data);
  for (const wave of copy.waves.composition) {
    wave.entries = [{ monsterId, count: 1 }];
  }
  // A boss would put a second, very much not trivial body in every fifth wave.
  copy.waves.bossEveryNWaves = 0;
  return copy;
}

/** The fastest a body in this wave moves, in tiles per tick. */
export function fastestStep(data: GameData, wave: number, ticksPerSecond: number): number {
  const byId = new Map([...data.monsters.monsters, ...data.monsters.bosses].map((m) => [m.id, m]));
  const authored = data.waves.composition.find((w) => w.wave === wave);
  let fastest = 0;
  for (const entry of authored?.entries ?? []) {
    fastest = Math.max(fastest, byId.get(entry.monsterId)?.moveSpeed ?? 0);
  }
  return fastest / ticksPerSecond;
}
