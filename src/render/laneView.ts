/**
 * The lane: bands, grid, tap targets, and the wave preview. DESIGN.md §4.1.
 *
 * Fixed camera. The whole lane fits one portrait screen: no panning, no zooming,
 * no scrolling (§14.1). That is why there is exactly one transform from tile
 * space to screen space, recomputed on resize and never per frame.
 *
 * Read-only over simulation state. Taps are reported outward as tile
 * coordinates; this class never issues a command or decides whether one is
 * legal - the simulation owns that (§15.1).
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { GameData } from '../data/schema.ts';
import type { MatchView, WaveSummary } from '../sim/index.ts';
import { previewWave } from '../sim/index.ts';
import type { LaneLayout } from './layout.ts';
import { fortressShape, screenToTilePoint } from './layout.ts';
import { DAMAGE_COLOURS, UI } from './palette.ts';
import { drawEntity } from './shapes.ts';
import { label } from './ui/text.ts';

/**
 * Radius of a monster's silhouette in the wave preview, in pixels.
 *
 * Close to the ten-ish pixels a real monster occupies on a phone, so the shape
 * in the preview is the shape you will be reading in the lane rather than a
 * larger, easier version of it. Fixed rather than scaled from the body radius:
 * the preview sits in the spawn band, which a big wave's clump reaches into,
 * and a row whose height changed with the wave would move under it.
 */
const PREVIEW_GLYPH_RADIUS = 9;

/**
 * How strongly the build grid reads. Bright enough to aim at against the dark
 * build zone, short of the full white the selected-tile ring is drawn in - that
 * ring has to stand out against these lines, not compete with them.
 */
const GRID_ALPHA = 0.32;

export interface LaneViewHandlers {
  /**
   * A tap somewhere in the lane, in TILE SPACE and fractional.
   *
   * Not a tile index, because what a tap can land on is not always a tile: a
   * body is a circle standing wherever it has walked to (§14.2), and picking
   * one out of a moving line needs the point, not the square. Whether it means
   * a tile or a body is the caller's decision - `bodyAt` and `screenToTile` in
   * layout.ts are the two readings of it.
   */
  onTap(tileX: number, tileY: number): void;
}

export class LaneView extends Container {
  private readonly bands = new Graphics();
  private readonly grid = new Graphics();
  private readonly furniture = new Graphics();
  private readonly overlay = new Container();
  private readonly touch = new Container();

  constructor(
    private layout: LaneLayout,
    private readonly data: GameData,
    private readonly handlers: LaneViewHandlers,
  ) {
    super();
    this.addChild(this.bands, this.grid, this.furniture, this.overlay, this.touch);
    this.setLayout(layout);
  }

  /** Called on boot and on resize only - never per frame. */
  setLayout(layout: LaneLayout): void {
    this.layout = layout;
    this.drawBands();
    this.drawGrid();
    this.drawFurniture();
    this.installTouchArea();
  }

  private drawBands(): void {
    const g = this.bands;
    const l = this.layout;
    g.clear();

    g.rect(0, 0, l.screen.width, l.screen.height).fill({ color: UI.background });
    g.rect(l.spawn.x, l.spawn.y, l.spawn.width, l.spawn.height).fill({ color: UI.spawnZone });
    g.rect(l.build.x, l.build.y, l.build.width, l.build.height).fill({ color: UI.buildZone });
    g.rect(l.fortress.x, l.fortress.y, l.fortress.width, l.fortress.height).fill({
      color: UI.fortressZone,
    });
  }

  /**
   * §4.2: the grid exists purely for positioning - front line to absorb, back
   * line to deal damage - not for scarcity. Supply is the limiting factor, not
   * space, so players should rarely run out of tiles.
   *
   * It is drawn bright, and only while building. Tiles are a thing you aim at
   * for thirty seconds and then stop caring about entirely: once a wave is in
   * the lane nothing you can do is tile-aligned, and a lattice over a fight is
   * just something else for the eye to pick through. So the lines come up at
   * full strength when they are the thing you are working with, and go away
   * when they are not. `render()` does the toggling.
   */
  private drawGrid(): void {
    const g = this.grid;
    const { gridOrigin, tileSize, grid } = this.layout;
    g.clear();

    for (let x = 0; x <= grid.width; x++) {
      const px = gridOrigin.x + x * tileSize;
      g.moveTo(px, gridOrigin.y).lineTo(px, gridOrigin.y + grid.depth * tileSize);
    }
    for (let y = 0; y <= grid.depth; y++) {
      const py = gridOrigin.y + y * tileSize;
      g.moveTo(gridOrigin.x, py).lineTo(gridOrigin.x + grid.width * tileSize, py);
    }
    g.stroke({ width: 1, color: UI.outline, alpha: GRID_ALPHA });
  }

  /**
   * §10: the fortress is attackable; the resource building on it is not.
   *
   * Drawn from the simulation's own geometry rather than from a shape that
   * looked about right - the fortress is a body like any other (motion.ts), a
   * disc of `fortressRadius` swept along a horizontal spine, and the rule that
   * what you see is what you hit applies to it too. It spans the lane, so a
   * wave meets a wall across the whole end of it rather than a target it has to
   * queue for.
   */
  private drawFurniture(): void {
    const g = this.furniture;
    const l = this.layout;
    const lane = this.data.lane;
    g.clear();

    const { cx, cy, halfWidth, radius } = fortressShape(l, lane);

    // A stadium: the exact set of points within `radius` of the spine.
    g.roundRect(cx - halfWidth - radius, cy - radius, (halfWidth + radius) * 2, radius * 2, radius)
      .fill({ color: UI.fortressStone })
      .stroke({ width: 1.5, color: UI.textMuted });

    // Battlements along the top edge, so the wall reads as masonry rather than
    // as a bar. Decoration, drawn inside the body: nothing here moves the edge
    // monsters actually hit.
    const merlon = radius * 0.5;
    for (let x = cx - halfWidth + merlon; x <= cx + halfWidth; x += merlon * 2.8) {
      g.rect(x - merlon / 2, cy - radius, merlon, radius * 0.4).fill({ color: UI.fortressZone });
    }
  }

  /**
   * One hit area over the whole board, reporting where the tap landed in tile
   * space. What that means - a unit, a tile, or empty ground - is decided by
   * whoever is holding the match state, not here.
   *
   * The whole lane column rather than just the build grid: a unit advances
   * during combat (§5.2, amended) and may be standing in the spawn zone, and a
   * unit you can see is a unit you can tap. The column and not the screen,
   * because in landscape the screen also holds the HUD and the build bar, and
   * their buttons are not the board.
   */
  private installTouchArea(): void {
    this.touch.removeChildren();
    const l = this.layout;

    const surface = new Container();
    surface.eventMode = 'static';
    surface.hitArea = new Rectangle(l.lane.x, l.lane.y, l.lane.width, l.lane.height);
    surface.on('pointertap', (event) => {
      const at = screenToTilePoint(this.layout, event.global.x, event.global.y);
      this.handlers.onTap(at.x, at.y);
    });

    this.touch.addChild(surface);
  }

  /**
   * Per-frame overlay: which tile is selected, and the incoming wave.
   *
   * §9.3: players see the composition of the next wave during the build phase.
   * Fair, because everyone faces the same thing, and it is what makes 30 seconds
   * of building a real decision rather than a shopping trip.
   */
  render(view: MatchView, summary: WaveSummary | null): void {
    this.overlay.removeChildren();

    // §3.1: the build phase is the only one in which a tile is a thing you can
    // act on, so it is the only one the lattice is drawn for.
    this.grid.visible = view.phase === 'build';

    // The selected unit is ringed by the entity layer rather than boxed here:
    // it is a mark on a body, and the body is somewhere between two ticks
    // (entities.ts, `EntityMarks`).
    this.drawWavePreview(view, summary);
  }

  /**
   * Two fixed rows across the top of the spawn zone - heading on the left,
   * counter hint on the right, trimmed to whatever space the heading leaves -
   * kept to the top so the clump spawning at the zone's centre is not drawn
   * through text.
   */
  private drawWavePreview(view: MatchView, summary: WaveSummary | null): void {
    const l = this.layout;
    const pad = 12;
    // The lane COLUMN's edges, not the screen's: in landscape the preview has
    // the lane's width to work in and the panels either side are not its room.
    const leftEdge = l.lane.x + pad;
    const rightEdge = l.lane.x + l.lane.width - pad;
    const nextWave = view.phase === 'build' ? view.wave + 1 : view.wave;
    const entries = previewWave(this.data, view.seed, nextWave);
    if (entries.length === 0) return;

    const rowOne = l.spawn.y + 5;
    const rowTwo = l.spawn.y + 21;
    const rowThree = l.spawn.y + 21 + PREVIEW_GLYPH_RADIUS + 16;

    const heading = label(
      view.phase === 'build' ? `next wave ${nextWave}` : `wave ${nextWave}`,
      10,
      UI.textMuted,
      '700',
    );
    heading.x = leftEdge;
    heading.y = rowOne;
    this.overlay.addChild(heading);

    // §9.3: highlight which of the player's units are strong or weak against
    // this wave. Only tier 1 - higher tiers are reached by upgrading, not
    // building, so naming them here would be advice you cannot act on.
    if (summary) {
      const buildable = summary.units.filter((u) => u.tier === 1);
      const strong = buildable.filter((u) => u.verdict === 'strong').map((u) => u.name);
      const weak = buildable.filter((u) => u.verdict === 'weak').map((u) => u.name);

      const parts: string[] = [];
      if (strong.length > 0) parts.push(`▲ ${strong.join(', ')}`);
      if (weak.length > 0) parts.push(`▼ ${weak.join(', ')}`);

      if (parts.length > 0) {
        const hint = label(parts.join('   '), 10, UI.textMuted, '600');
        const room = rightEdge - (heading.x + heading.width + 10);
        if (hint.width <= room) {
          hint.x = rightEdge - hint.width;
          hint.y = rowOne;
          this.overlay.addChild(hint);
        }
      }
    }

    // One chip per monster type: count and name, the armour word as its legend,
    // and the monster's own silhouette centred underneath (§14.2, amended).
    //
    // The silhouette is the part worth having. "4× Husk plate" tells you what
    // is coming only if you already know what a Husk looks like; the shape
    // below it is the thing you will actually be picking out of a crowd in
    // thirty seconds, drawn by the same `drawEntity` that will draw it then, in
    // the same outline-means-monster convention. One size for all of them: this
    // is a key, not a scale model, and at nine pixels a size difference reads
    // as noise rather than as information. The HUD already says BOSS in red.
    let x = leftEdge;
    for (const entry of entries) {
      const colour = DAMAGE_COLOURS[entry.damageType];
      const text = label(`${entry.count}× ${entry.name}`, 11, colour, '700');
      const armour = label(` ${entry.armour}`, 10, UI.textMuted);
      const width = text.width + armour.width;

      if (x + width + 12 > rightEdge) {
        const more = label('…', 11, UI.textMuted, '700');
        more.x = x;
        more.y = rowTwo;
        this.overlay.addChild(more);
        break;
      }

      text.x = x;
      text.y = rowTwo;
      armour.x = x + text.width;
      armour.y = rowTwo + 1;
      this.overlay.addChild(text, armour);

      const glyph = new Graphics();
      drawEntity(
        glyph,
        { shape: entry.shape, damageType: entry.damageType, tier: 1, outlined: true },
        x + width / 2,
        rowThree,
        PREVIEW_GLYPH_RADIUS,
      );
      this.overlay.addChild(glyph);

      x += width + 12;
    }
  }
}
