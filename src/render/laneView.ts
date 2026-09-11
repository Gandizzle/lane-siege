/**
 * Draws the lane. DESIGN.md §4.1, §14.2.
 *
 * The renderer READS simulation state and draws it (§15.1). It never mutates
 * one, never decides anything, and holds no game rules - so the same lane can
 * be drawn from a local simulation, from a server snapshot, or from a replay
 * without any of them knowing the difference.
 *
 * Right now there is no simulation state to draw, so this renders the static
 * furniture plus a legend of the shape vocabulary. Wire `sync(state)` to a real
 * MatchState in M2.
 */

import { Container, Graphics, Text } from 'pixi.js';
import type { GameData } from '../data/schema.ts';
import type { LaneLayout } from './layout.ts';
import { UI } from './palette.ts';
import { drawEntity } from './shapes.ts';

function label(text: string, size: number, colour: number = UI.textMuted): Text {
  return new Text({
    text,
    style: {
      fill: colour,
      fontSize: size,
      fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      fontWeight: '500',
    },
  });
}

function band(g: Graphics, x: number, y: number, w: number, h: number, colour: number): void {
  g.rect(x, y, w, h).fill({ color: colour });
}

export class LaneView extends Container {
  private readonly background = new Graphics();
  private readonly grid = new Graphics();
  /** Entities are drawn here each frame from simulation state. */
  readonly entityLayer = new Container();
  private readonly overlay = new Container();

  constructor(
    private layout: LaneLayout,
    private readonly data: GameData,
  ) {
    super();
    this.addChild(this.background, this.grid, this.entityLayer, this.overlay);
    this.redraw(layout);
  }

  /** Called on boot and on resize only - never per frame. */
  redraw(layout: LaneLayout): void {
    this.layout = layout;
    this.drawBands();
    this.drawGrid();
    this.drawLegend();
  }

  private drawBands(): void {
    const g = this.background;
    const l = this.layout;
    g.clear();

    band(g, 0, 0, l.screen.width, l.screen.height, UI.background);
    band(g, l.tabs.x, l.tabs.y, l.tabs.width, l.tabs.height, UI.tabs);
    band(g, l.spawn.x, l.spawn.y, l.spawn.width, l.spawn.height, UI.spawnZone);
    band(g, l.build.x, l.build.y, l.build.width, l.build.height, UI.buildZone);
    band(g, l.fortress.x, l.fortress.y, l.fortress.width, l.fortress.height, UI.fortressZone);
    band(g, l.buildBar.x, l.buildBar.y, l.buildBar.width, l.buildBar.height, UI.buildBar);
  }

  /**
   * §4.2: the grid exists purely for positioning - front line to absorb, back
   * line to deal damage - not for scarcity. Supply is the limiting factor, not
   * space, so players should rarely run out of tiles.
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
    g.stroke({ width: 1, color: UI.gridLine });
  }

  /**
   * Placeholder content: the four silhouettes in the four damage colours, so
   * the shape vocabulary is visible and checkable before there is a game.
   * Replace with the real build bar in M2.
   */
  private drawLegend(): void {
    this.overlay.removeChildren();
    const l = this.layout;
    const { armourTypes, damageTypes } = this.data.matrix;

    const heading = label(
      `Super Land Siege — ${l.grid.width}×${l.grid.depth} build zone`,
      13,
      UI.text,
    );
    heading.x = 12;
    heading.y = l.tabs.y + l.tabs.height / 2 - heading.height / 2;
    this.overlay.addChild(heading);

    const spawnLabel = label('spawn', 11);
    spawnLabel.x = 12;
    spawnLabel.y = l.spawn.y + l.spawn.height / 2 - spawnLabel.height / 2;
    this.overlay.addChild(spawnLabel);

    const fortressLabel = label('fortress · resource building', 11);
    fortressLabel.x = 12;
    fortressLabel.y = l.fortress.y + l.fortress.height * 0.72;
    this.overlay.addChild(fortressLabel);

    // §10: the fortress is attackable; the resource building beside it is not.
    const markerY = l.fortress.y + l.fortress.height * 0.36;
    const markerR = l.fortress.height * 0.22;
    const marker = new Graphics();
    marker
      .rect(l.screen.width / 2 - markerR * 1.6, markerY - markerR, markerR * 3.2, markerR * 2)
      .fill({ color: UI.gridLine })
      .stroke({ width: 1.5, color: UI.textMuted });
    marker
      .rect(
        l.screen.width / 2 + markerR * 2.2,
        markerY - markerR * 0.7,
        markerR * 1.4,
        markerR * 1.4,
      )
      .fill({ color: UI.gridLine });
    this.overlay.addChild(marker);

    // Row of silhouettes: one per armour type, each shown solid (a defensive
    // unit) beside outlined (a monster), cycling through the damage colours and
    // through tiers 1-3 - tier 3 is the ceiling (§7.3).
    const count = armourTypes.length;
    const slot = l.screen.width / count;
    const radius = Math.min(l.buildBar.height * 0.13, l.screen.width / (count * 5.6));
    const pairGap = radius * 2.5;
    const rowY = l.buildBar.y + l.buildBar.height * 0.4;

    armourTypes.forEach((armour, i) => {
      const damageType = damageTypes[i % damageTypes.length];
      if (!damageType) return;
      const cx = slot * (i + 0.5);
      const tier = (i % 3) + 1;

      const solid = new Graphics();
      drawEntity(
        solid,
        { armour, damageType, tier, outlined: false },
        cx - pairGap / 2,
        rowY,
        radius,
      );
      const outline = new Graphics();
      drawEntity(
        outline,
        { armour, damageType, tier: 1, outlined: true },
        cx + pairGap / 2,
        rowY,
        radius,
      );
      this.overlay.addChild(solid, outline);

      const name = label(armour, 10);
      name.x = cx - name.width / 2;
      name.y = rowY + radius * 2.4;
      this.overlay.addChild(name);
    });

    const caption = label('solid = your unit · outline = monster · pips = tier', 10);
    caption.x = l.screen.width / 2 - caption.width / 2;
    caption.y = l.buildBar.y + l.buildBar.height - caption.height - 8;
    this.overlay.addChild(caption);
  }
}
