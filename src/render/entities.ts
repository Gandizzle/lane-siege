/**
 * Draws the living contents of a lane. DESIGN.md §14.2, §15.1.
 *
 * Strictly read-only over simulation state: this layer takes a MatchState and
 * produces pixels, and never writes back. That is what lets the same code draw a
 * local simulation, a server snapshot or a replay without knowing which it has.
 *
 * Positions are interpolated between the last two ticks. The simulation runs at
 * 20Hz; without interpolation a 60Hz phone shows each monster jumping three
 * times a second, which reads as a bug. The previous positions live here, in the
 * renderer, because the simulation must not carry rendering concerns.
 */

import { Container, Graphics } from 'pixi.js';
import type { DefIndex, Lane } from '../sim/index.ts';
import type { LaneLayout } from './layout.ts';
import { UI } from './palette.ts';
import { drawEntity } from './shapes.ts';

interface PreviousPosition {
  x: number;
  y: number;
}

export class EntityLayer extends Container {
  private readonly monsterGraphics = new Graphics();
  private readonly unitGraphics = new Graphics();
  private readonly healthGraphics = new Graphics();

  /** Where each monster was on the previous tick, for interpolation. */
  private previous = new Map<number, PreviousPosition>();
  private staging = new Map<number, PreviousPosition>();

  constructor(
    private layout: LaneLayout,
    private readonly defs: DefIndex,
  ) {
    super();
    this.addChild(this.unitGraphics, this.monsterGraphics, this.healthGraphics);
  }

  setLayout(layout: LaneLayout): void {
    this.layout = layout;
  }

  /**
   * Call immediately BEFORE stepping the simulation. Captures where everything
   * is now so the next frames can interpolate from it.
   */
  captureTick(lane: Lane): void {
    // Swap the two maps rather than allocating a new one each tick.
    const next = this.staging;
    next.clear();
    for (const monster of lane.monsters) {
      if (!monster.alive) continue;
      next.set(monster.id, { x: monster.pos.x, y: monster.pos.y });
    }
    this.staging = this.previous;
    this.previous = next;
  }

  /** Redraw from current state. `alpha` is the fraction of a tick elapsed. */
  render(lane: Lane, alpha: number): void {
    this.unitGraphics.clear();
    this.monsterGraphics.clear();
    this.healthGraphics.clear();

    this.drawUnits(lane);
    this.drawMonsters(lane, alpha);
  }

  private tileToPixel(tileX: number, tileY: number): { x: number; y: number } {
    const { gridOrigin, tileSize } = this.layout;
    return { x: gridOrigin.x + tileX * tileSize, y: gridOrigin.y + tileY * tileSize };
  }

  private drawUnits(lane: Lane): void {
    const radius = this.layout.tileSize * 0.34;

    for (const unit of lane.units) {
      if (!unit.alive) continue;

      const def = this.defs.units.get(unit.defId);
      if (!def) continue;

      const centre = this.tileToPixel(unit.tileX + 0.5, unit.tileY + 0.5);

      // Solid fill = your unit (§14.2).
      drawEntity(
        this.unitGraphics,
        { armour: unit.armour, damageType: unit.damageType, tier: def.tier, outlined: false },
        centre.x,
        centre.y,
        radius,
      );

      if (unit.hp < unit.maxHp) {
        this.drawHealthBar(centre.x, centre.y - radius * 1.5, radius * 2, unit.hp / unit.maxHp);
      }
    }
  }

  private drawMonsters(lane: Lane, alpha: number): void {
    const radius = this.layout.tileSize * 0.3;

    for (const monster of lane.monsters) {
      if (!monster.alive) continue;

      const def = this.defs.monsters.get(monster.defId);
      const prev = this.previous.get(monster.id);

      // A monster that did not exist last tick has nothing to interpolate from,
      // so it appears at its true position rather than sliding in from nowhere.
      const x = prev ? prev.x + (monster.pos.x - prev.x) * alpha : monster.pos.x;
      const y = prev ? prev.y + (monster.pos.y - prev.y) * alpha : monster.pos.y;

      const centre = this.tileToPixel(x, y);
      const scale = def?.isBoss ? 2.1 : 1;

      // Outline = monster (§14.2).
      drawEntity(
        this.monsterGraphics,
        {
          armour: monster.armour,
          damageType: monster.damageType,
          tier: 1,
          outlined: true,
        },
        centre.x,
        centre.y,
        radius * scale,
      );

      if (monster.hp < monster.maxHp) {
        this.drawHealthBar(
          centre.x,
          centre.y - radius * scale * 1.5,
          radius * 2 * scale,
          monster.hp / monster.maxHp,
        );
      }
    }
  }

  private drawHealthBar(cx: number, cy: number, width: number, fraction: number): void {
    const height = Math.max(2, this.layout.tileSize * 0.06);
    const clamped = Math.max(0, Math.min(1, fraction));

    // A trough light enough to read against the lane background - otherwise a
    // nearly-dead monster shows a stray sliver with no bar around it.
    this.healthGraphics.rect(cx - width / 2, cy, width, height).fill({ color: UI.panelEdge });
    this.healthGraphics
      .rect(cx - width / 2, cy, width * clamped, height)
      .fill({ color: clamped > 0.4 ? UI.healthGood : UI.healthLow });
  }
}
