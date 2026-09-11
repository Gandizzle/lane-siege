/**
 * Movement and collision. DESIGN.md §5.3, and §4.2 now that units block.
 */

import { describe, expect, it } from 'vitest';
import { createGrid, isTileBlocked, rebuildOccupancy } from './grid.ts';
import { LANE_DIRECTION, stepToward, updateStuckDetection } from './steering.ts';
import { STUCK_WINDOW_TICKS } from './constants.ts';
import type { DefensiveUnit, Monster } from './types.ts';

function monsterAt(x: number, y: number, speed = 2): Monster {
  return {
    id: 1,
    defId: 'grub',
    damage: 1,
    attackSpeed: 1,
    moveSpeed: speed,
    range: 1,
    bounty: 1,
    waveNumber: 1,
    pos: { x, y },
    hp: 10,
    maxHp: 10,
    armour: 'flesh',
    damageType: 'impact',
    cooldown: 0,
    targetId: null,
    retargetIn: 0,
    pathCost: 0,
    stuckAnchor: { x, y },
    stuckTicks: 0,
    lastStepIndex: -1,
    isStuck: false,
    besieging: false,
    alive: true,
  };
}

function unitAt(tileX: number, tileY: number): DefensiveUnit {
  return {
    id: 100 + tileX,
    defId: 'hammer',
    homeTileX: tileX,
    homeTileY: tileY,
    pos: { x: tileX + 0.5, y: tileY + 0.5 },
    moveSpeed: 0,
    pathCost: 0,
    advanceTargetId: null,
    stuckAnchor: { x: tileX + 0.5, y: tileY + 0.5 },
    stuckTicks: 0,
    lastStepIndex: -1,
    isStuck: false,
    hp: 10,
    maxHp: 10,
    armour: 'plate',
    damageType: 'impact',
    techDamage: 1,
    techAttackSpeed: 1,
    cooldown: 0,
    targetId: null,
    alive: true,
  };
}

describe('occupancy grid (§4.2)', () => {
  it('marks tiles held by living units and only those', () => {
    const grid = createGrid(8, 10);
    const units = [unitAt(3, 4), unitAt(5, 6)];
    rebuildOccupancy(grid, units);

    expect(isTileBlocked(grid, 3, 4)).toBe(true);
    expect(isTileBlocked(grid, 5, 6)).toBe(true);
    expect(isTileBlocked(grid, 0, 0)).toBe(false);
  });

  it('frees a tile when its unit dies', () => {
    const grid = createGrid(8, 10);
    const unit = unitAt(2, 2);
    rebuildOccupancy(grid, [unit]);
    expect(isTileBlocked(grid, 2, 2)).toBe(true);

    unit.alive = false;
    rebuildOccupancy(grid, [unit]);
    expect(isTileBlocked(grid, 2, 2)).toBe(false);
  });

  it('treats everything outside the build grid as open ground', () => {
    // The spawn zone above and the fortress zone below are not build tiles.
    const grid = createGrid(8, 10);
    expect(isTileBlocked(grid, 0, -1)).toBe(false);
    expect(isTileBlocked(grid, 0, 99)).toBe(false);
  });
});

describe('steering (§5.3)', () => {
  it('walks straight at the destination when nothing is in the way', () => {
    const monster = monsterAt(3.5, 0.5);
    const moved = stepToward(monster, { x: 3.5, y: 5.5 }, 2, 1, null);

    expect(moved).toBe(true);
    expect(monster.pos.x).toBeCloseTo(3.5, 6);
    expect(monster.pos.y).toBeGreaterThan(0.5);
  });

  it('carries the enrage speed multiplier (§8)', () => {
    const slow = monsterAt(3.5, 0.5);
    const fast = monsterAt(3.5, 0.5);
    stepToward(slow, { x: 3.5, y: 9.5 }, 2, 1, null);
    stepToward(fast, { x: 3.5, y: 9.5 }, 2, 2.8, null);
    expect(fast.pos.y - 0.5).toBeCloseTo((slow.pos.y - 0.5) * 2.8, 6);
  });

  it('routes around a blocked tile instead of walking into it', () => {
    const grid = createGrid(8, 10);
    rebuildOccupancy(grid, [unitAt(3, 1)]);

    // Right at the wall's edge: the next straight step would land inside the
    // blocked tile, so this is the tick where it has to deviate.
    const monster = monsterAt(3.5, 0.95);
    stepToward(monster, { x: 3.5, y: 9.5 }, 2, 1, grid);

    expect(isTileBlocked(grid, Math.floor(monster.pos.x), Math.floor(monster.pos.y))).toBe(false);
    // It deviated sideways rather than standing still.
    expect(monster.pos.x).not.toBeCloseTo(3.5, 3);
  });

  it('reports failure when every direction is blocked', () => {
    const grid = createGrid(3, 3);
    const walls: DefensiveUnit[] = [];
    for (let x = 0; x < 3; x++) {
      for (let y = 0; y < 3; y++) walls.push(unitAt(x, y));
    }
    rebuildOccupancy(grid, walls);

    // Standing in a free gap that the surrounding tiles have sealed off. Its
    // own tile is cleared, so this is a genuine box-in rather than the escape
    // case below.
    grid.cells[1 * 3 + 1] = 0;
    const monster = monsterAt(1.5, 1.5);

    // A step large enough to leave its own tile - otherwise it just shuffles
    // inside the gap, which is movement, not being blocked.
    expect(stepToward(monster, { x: 1.5, y: 9.5 }, 20, 1, grid)).toBe(false);
    expect(monster.pos.x).toBeCloseTo(1.5, 6);
    expect(monster.pos.y).toBeCloseTo(1.5, 6);
  });

  it('lets a monster escape a tile a unit was built on top of', () => {
    const grid = createGrid(8, 10);
    rebuildOccupancy(grid, [unitAt(3, 3)]);

    const monster = monsterAt(3.5, 3.5);
    expect(stepToward(monster, { x: 3.5, y: 9.5 }, 2, 1, grid)).toBe(true);
  });

  it('prefers straight down the lane when directions tie', () => {
    // Destination directly ahead: the lane-forward candidate must win.
    const monster = monsterAt(3.5, 0.5);
    stepToward(monster, { x: 3.5, y: 9.5 }, 1, 1, createGrid(8, 10));
    expect(monster.pos.y).toBeGreaterThan(0.5);
    expect(monster.pos.x).toBeCloseTo(3.5, 6);
    expect(LANE_DIRECTION.y).toBe(1);
  });
});

describe('stuck detection (§5.3)', () => {
  it('fires when a monster makes no progress over the window', () => {
    const monster = monsterAt(3.5, 3.5);
    for (let i = 0; i < STUCK_WINDOW_TICKS; i++) updateStuckDetection(monster);
    expect(monster.isStuck).toBe(true);
  });

  it('clears once the monster is moving again', () => {
    const monster = monsterAt(3.5, 3.5);
    for (let i = 0; i < STUCK_WINDOW_TICKS; i++) updateStuckDetection(monster);
    expect(monster.isStuck).toBe(true);

    for (let i = 0; i < STUCK_WINDOW_TICKS; i++) {
      monster.pos.y += 0.5;
      updateStuckDetection(monster);
    }
    expect(monster.isStuck).toBe(false);
  });
});
