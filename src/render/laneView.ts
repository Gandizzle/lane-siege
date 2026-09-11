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
import type { Lane, MatchState, WaveSummary } from '../sim/index.ts';
import { previewWave } from '../sim/index.ts';
import type { LaneLayout } from './layout.ts';
import { screenToTile } from './layout.ts';
import { DAMAGE_COLOURS, UI } from './palette.ts';
import { label } from './ui/text.ts';

export interface LaneViewHandlers {
  onTapTile(tileX: number, tileY: number): void;
  onTapElsewhere(): void;
}

export class LaneView extends Container {
  private readonly bands = new Graphics();
  private readonly grid = new Graphics();
  private readonly highlight = new Graphics();
  private readonly furniture = new Graphics();
  private readonly overlay = new Container();
  private readonly touch = new Container();

  constructor(
    private layout: LaneLayout,
    private readonly data: GameData,
    private readonly handlers: LaneViewHandlers,
  ) {
    super();
    this.addChild(this.bands, this.grid, this.furniture, this.highlight, this.overlay, this.touch);
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

  /** §10: the fortress is attackable; the resource building beside it is not. */
  private drawFurniture(): void {
    const g = this.furniture;
    const l = this.layout;
    g.clear();

    const h = l.fortress.height * 0.22;
    const cy = l.fortress.y + l.fortress.height * 0.3;
    const cx = l.screen.width / 2;

    g.rect(cx - h * 1.6, cy - h, h * 3.2, h * 2)
      .fill({ color: UI.gridLine })
      .stroke({ width: 1.5, color: UI.textMuted });
    g.rect(cx + h * 2.2, cy - h * 0.7, h * 1.4, h * 1.4).fill({ color: UI.gridLine });
  }

  /**
   * One hit area over the whole screen. Pixi reports the tap; `screenToTile`
   * decides whether it landed on the build grid, and anything else clears the
   * current selection.
   */
  private installTouchArea(): void {
    this.touch.removeChildren();
    const l = this.layout;

    const surface = new Container();
    surface.eventMode = 'static';
    surface.hitArea = new Rectangle(0, l.tabs.y, l.screen.width, l.buildBar.y - l.tabs.y);
    surface.on('pointertap', (event) => {
      const tile = screenToTile(this.layout, event.global.x, event.global.y);
      if (tile) this.handlers.onTapTile(tile.tileX, tile.tileY);
      else this.handlers.onTapElsewhere();
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
  render(
    state: MatchState,
    lane: Lane,
    selectedUnitId: number | null,
    summary: WaveSummary | null,
  ): void {
    this.highlight.clear();
    this.overlay.removeChildren();

    if (selectedUnitId !== null) {
      const unit = lane.units.find((u) => u.id === selectedUnitId);
      if (unit) {
        const { gridOrigin, tileSize } = this.layout;
        this.highlight
          .rect(
            gridOrigin.x + Math.floor(unit.pos.x) * tileSize,
            gridOrigin.y + Math.floor(unit.pos.y) * tileSize,
            tileSize,
            tileSize,
          )
          .stroke({ width: 2, color: UI.selected });
      }
    }

    this.drawWavePreview(state, summary);
  }

  /**
   * The spawn band is short, so this lays out in two fixed rows and never lets
   * the two halves of row one collide: heading on the left, counter hint on the
   * right, trimmed to whatever space the heading leaves.
   */
  private drawWavePreview(state: MatchState, summary: WaveSummary | null): void {
    const l = this.layout;
    const pad = 12;
    const nextWave = state.phase === 'build' ? state.wave + 1 : state.wave;
    const entries = previewWave(this.data, state.seed, nextWave);
    if (entries.length === 0) return;

    const rowOne = l.spawn.y + 5;
    const rowTwo = l.spawn.y + l.spawn.height - 20;

    const heading = label(
      state.phase === 'build' ? `next wave ${nextWave}` : `wave ${nextWave}`,
      10,
      UI.textMuted,
      '700',
    );
    heading.x = pad;
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
        const room = l.screen.width - pad - (heading.x + heading.width + 10);
        if (hint.width <= room) {
          hint.x = l.screen.width - pad - hint.width;
          hint.y = rowOne;
          this.overlay.addChild(hint);
        }
      }
    }

    // One chip per monster type, on a single row: count, name, armour.
    let x = pad;
    for (const entry of entries) {
      const colour = DAMAGE_COLOURS[entry.damageType as keyof typeof DAMAGE_COLOURS] ?? UI.text;
      const text = label(`${entry.count}× ${entry.name}`, 11, colour, '700');
      const armour = label(` ${entry.armour}`, 10, UI.textMuted);

      if (x + text.width + armour.width + 12 > l.screen.width - pad) {
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

      x += text.width + armour.width + 12;
    }
  }
}
