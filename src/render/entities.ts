/**
 * Draws the living contents of a lane. DESIGN.md §14.2, §15.1.
 *
 * Takes a `LaneView` (§12) and produces pixels. It cannot write back and it
 * cannot see anything the view left out, which is what lets the same code draw
 * a local match, a lane on a server, a lane you are spectating, or a replay
 * without knowing which it has.
 *
 * Positions are interpolated between the last two ticks. The simulation runs at
 * 20Hz; without interpolation a 60Hz phone shows each body jumping three times
 * a second, which reads as a bug. The previous positions live here, in the
 * renderer, because the simulation must not carry rendering concerns.
 */

import { Container, Graphics } from 'pixi.js';
import type { DefIndex, EntityView, LaneView } from '../sim/index.ts';
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

  /**
   * Where each body was on the previous tick, for interpolation. Units are in
   * here too: they advance when nothing is in range (§5.2, amended), so
   * interpolating only monsters left the line stepping at 20Hz beside monsters
   * moving at 60.
   */
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
   * Call when a tick lands, with the view that is being REPLACED. Those become
   * the positions the next frames interpolate away from, so at alpha 0 the
   * screen shows the previous tick and at alpha 1 the new one.
   *
   * Works the same for a local match and for frames off a socket, which is why
   * it takes the outgoing view rather than reaching for a simulation.
   */
  captureTick(lane: LaneView | null): void {
    // Swap the two maps rather than allocating a new one each tick.
    const next = this.staging;
    next.clear();
    if (lane) {
      for (const entity of lane.units) next.set(entity.id, { x: entity.x, y: entity.y });
      for (const entity of lane.monsters) next.set(entity.id, { x: entity.x, y: entity.y });
    }
    this.staging = this.previous;
    this.previous = next;
  }

  /** Drop the interpolation history, for a lane change or a new match. */
  reset(): void {
    this.previous.clear();
    this.staging.clear();
  }

  /** Redraw from current state. `alpha` is the fraction of a tick elapsed. */
  render(lane: LaneView, alpha: number): void {
    this.unitGraphics.clear();
    this.monsterGraphics.clear();
    this.healthGraphics.clear();

    this.drawUnits(lane, alpha);
    this.drawMonsters(lane, alpha);
  }

  /**
   * Where to draw a body: between where it was last tick and where it is now.
   *
   * A body that did not exist last tick has nothing to interpolate from, so it
   * appears at its true position rather than sliding in from nowhere.
   */
  private interpolate(entity: EntityView, alpha: number): { x: number; y: number } {
    const prev = this.previous.get(entity.id);
    if (!prev) return { x: entity.x, y: entity.y };
    return {
      x: prev.x + (entity.x - prev.x) * alpha,
      y: prev.y + (entity.y - prev.y) * alpha,
    };
  }

  private tileToPixel(tileX: number, tileY: number): { x: number; y: number } {
    const { gridOrigin, tileSize } = this.layout;
    return { x: gridOrigin.x + tileX * tileSize, y: gridOrigin.y + tileY * tileSize };
  }

  private drawUnits(lane: LaneView, alpha: number): void {
    for (const unit of lane.units) {
      // §14.2: tier drives size and pips, and the silhouette is the unit's
      // own. Both are properties of the definition - which is also why the
      // wire format sends only the id.
      const def = this.defs.units.get(unit.defId);
      const tier = def?.tier ?? 1;
      const shape = def?.shape ?? 'orb';

      const at = this.interpolate(unit, alpha);
      const centre = this.tileToPixel(at.x, at.y);
      // Draw at the body radius the simulation collides with, so what you see
      // is exactly what takes up space.
      const radius = unit.radius * this.layout.tileSize;

      // Solid fill = a defensive unit (§14.2).
      drawEntity(
        this.unitGraphics,
        { shape, damageType: unit.damageType, tier, outlined: false },
        centre.x,
        centre.y,
        radius,
      );

      if (unit.hpFraction < 1) {
        this.drawHealthBar(centre.x, centre.y - radius * 1.5, radius * 2, unit.hpFraction);
      }
    }
  }

  private drawMonsters(lane: LaneView, alpha: number): void {
    for (const monster of lane.monsters) {
      const at = this.interpolate(monster, alpha);
      const centre = this.tileToPixel(at.x, at.y);
      // Same rule as the units: the drawn size IS the collision size. A boss
      // used to be drawn at twice its collision radius, so its silhouette
      // clipped straight through the escort around it.
      const radius = monster.radius * this.layout.tileSize;

      // Outline = monster (§14.2).
      const shape = this.defs.monsters.get(monster.defId)?.shape ?? 'orb';
      drawEntity(
        this.monsterGraphics,
        { shape, damageType: monster.damageType, tier: 1, outlined: true },
        centre.x,
        centre.y,
        radius,
      );

      if (monster.hpFraction < 1) {
        this.drawHealthBar(centre.x, centre.y - radius * 1.5, radius * 2, monster.hpFraction);
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
