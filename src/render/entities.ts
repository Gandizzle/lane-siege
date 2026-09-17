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
import type { Camera } from './layout.ts';
import { UI } from './palette.ts';
import { drawEntity } from './shapes.ts';

interface PreviousPosition {
  x: number;
  y: number;
}

/**
 * Who a body belongs to, drawn as a ring behind it, or null for no ring.
 *
 * Only the Final Showdown uses it (§3.3, replaced): a lane has exactly one side on each
 * team, so solid-fill-means-defender already says whose a body is. Four armies
 * in one arena do not have that, and §14.2's channels are all spoken for -
 * silhouette is armour, fill is damage type, size and pips are tier - so
 * ownership gets a channel of its own rather than taking one of those over.
 */
export type RingOf = (unit: EntityView) => number | null;

/** What to draw around a body beyond the body itself. */
export interface EntityMarks {
  /** Whose each body is, for the Final Showdown's four armies. */
  ringOf?: RingOf;
  /**
   * The selected unit, ringed WHERE IT IS.
   *
   * It used to be a box drawn around the tile the unit was mostly inside,
   * which is fine while a line is standing still on its tiles and nonsense
   * the moment it advances (§5.2, amended): the box snapped from tile to tile
   * a third of a second behind the body it was meant to be pointing at. A ring
   * on the body's own circle is the same circle that decides what a tap hits
   * and what a shot reaches, so all three agree.
   */
  selectedId?: number | null;
}

/** How much wider than the body the selection ring sits. */
const SELECTION_RING = 1.25;

export class EntityLayer extends Container {
  private readonly ringGraphics = new Graphics();
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
    private layout: Camera,
    private readonly defs: DefIndex,
  ) {
    super();
    this.addChild(
      // Under the bodies: a ring is a badge, not a highlight, and it must
      // never eat into the silhouette it belongs to.
      this.ringGraphics,
      this.unitGraphics,
      this.monsterGraphics,
      this.healthGraphics,
    );
  }

  setLayout(layout: Camera): void {
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
  render(lane: LaneView, alpha: number, marks: EntityMarks = {}): void {
    this.ringGraphics.clear();
    this.unitGraphics.clear();
    this.monsterGraphics.clear();
    this.healthGraphics.clear();

    this.drawUnits(lane, alpha, marks);
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

  private drawUnits(lane: LaneView, alpha: number, marks: EntityMarks): void {
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

      const ring = marks.ringOf ? marks.ringOf(unit) : null;
      if (ring !== null) {
        this.ringGraphics
          .circle(centre.x, centre.y, radius * 1.34)
          .stroke({ width: Math.max(1.5, radius * 0.2), color: ring, alpha: 0.95 });
      }

      // The selection, drawn from the interpolated position like the body it
      // belongs to - so it stays on the unit while the unit is walking.
      if (unit.id === marks.selectedId) {
        this.ringGraphics
          .circle(centre.x, centre.y, radius * SELECTION_RING)
          .stroke({ width: 2, color: UI.selected });
      }

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
