/**
 * The build bar. DESIGN.md §4.1, §14.1, §7.3, §9.3.
 *
 * Sits at the bottom because that is the thumb zone for one-handed portrait play
 * (§4.1). Buttons are sized for a thumb, not a mouse pointer.
 *
 * Two modes:
 *   - nothing selected, or a unit type selected -> the roster, one button per
 *     buildable unit, showing cost, supply, and whether it is strong or weak
 *     against the incoming wave (§9.3)
 *   - a placed unit selected -> its upgrade, priced (§7.3)
 *
 * The bar reports taps outward and decides nothing: affordability is shown here
 * but enforced in the simulation (§15.1), so the greyed-out state is a courtesy,
 * never the rule.
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { GameData, UnitDef } from '../../data/schema.ts';
import type { Lane, WaveSummary } from '../../sim/index.ts';
import type { LaneLayout } from '../layout.ts';
import { UI } from '../palette.ts';
import { drawEntity } from '../shapes.ts';
import { centreOn, label } from './text.ts';

export type Selection =
  { kind: 'unitDef'; unitDefId: string } | { kind: 'placedUnit'; unitId: number } | null;

export interface BuildBarHandlers {
  onSelectUnitDef(unitDefId: string): void;
  onUpgrade(unitId: number): void;
  onReady(): void;
  onClearSelection(): void;
}

/** Minimum comfortable touch target. Below this, thumbs miss. */
const MIN_TOUCH = 44;

export class BuildBar extends Container {
  private readonly background = new Graphics();
  private readonly buttons = new Container();

  constructor(
    private layout: LaneLayout,
    private readonly data: GameData,
    private readonly handlers: BuildBarHandlers,
  ) {
    super();
    this.addChild(this.background, this.buttons);
  }

  setLayout(layout: LaneLayout): void {
    this.layout = layout;
  }

  render(lane: Lane, selection: Selection, summary: WaveSummary | null, canBuild: boolean): void {
    this.buttons.removeChildren();
    this.background.clear();

    const l = this.layout;
    this.background
      .rect(l.buildBar.x, l.buildBar.y, l.buildBar.width, l.buildBar.height)
      .fill({ color: UI.buildBar });

    if (selection?.kind === 'placedUnit') {
      this.renderUpgradePanel(lane, selection.unitId);
      return;
    }

    this.renderRoster(lane, selection, summary, canBuild);
  }

  private buildableUnits(): UnitDef[] {
    // Tier 1 only: higher tiers are reached by upgrading in place (§7.3), never
    // built directly.
    return this.data.units.units.filter((u) => u.tier === 1);
  }

  private renderRoster(
    lane: Lane,
    selection: Selection,
    summary: WaveSummary | null,
    canBuild: boolean,
  ): void {
    const l = this.layout;
    const units = this.buildableUnits();

    const readyWidth = 78;
    const gap = 6;
    const available = l.buildBar.width - readyWidth - gap * (units.length + 1) - 6;
    const buttonWidth = Math.max(MIN_TOUCH, available / Math.max(1, units.length));
    const buttonHeight = Math.max(MIN_TOUCH, l.buildBar.height - 22);
    const top = l.buildBar.y + 8;

    units.forEach((def, i) => {
      const x = 6 + gap + i * (buttonWidth + gap);
      const rating = summary?.units.find((u) => u.unitId === def.id);

      const affordable =
        canBuild &&
        lane.economy.gold >= (def.goldCost ?? 0) &&
        lane.economy.supplyUsed + (def.supplyCost ?? 0) <= lane.economy.supplyCap;

      const selected = selection?.kind === 'unitDef' && selection.unitDefId === def.id;

      this.buttons.addChild(
        this.unitButton(
          def,
          x,
          top,
          buttonWidth,
          buttonHeight,
          affordable,
          selected,
          rating?.verdict,
        ),
      );
    });

    this.buttons.addChild(
      this.readyButton(
        l.buildBar.width - readyWidth - 6,
        top,
        readyWidth,
        buttonHeight,
        lane.ready,
        // §3.2: ready skips the remaining build time. It means nothing once the
        // wave is already walking down the lane.
        canBuild,
      ),
    );
  }

  private unitButton(
    def: UnitDef,
    x: number,
    y: number,
    width: number,
    height: number,
    affordable: boolean,
    selected: boolean,
    verdict: 'strong' | 'neutral' | 'weak' | undefined,
  ): Container {
    const button = new Container();
    const g = new Graphics();

    g.roundRect(x, y, width, height, 8).fill({ color: UI.panel });
    g.roundRect(x, y, width, height, 8).stroke({
      width: selected ? 2 : 1,
      color: selected ? UI.selected : UI.panelEdge,
    });
    button.addChild(g);

    const cx = x + width / 2;
    const glyphRadius = Math.min(width, height) * 0.17;

    drawEntity(
      g,
      { armour: def.armour, damageType: def.damageType, tier: 1, outlined: false },
      cx,
      y + height * 0.3,
      glyphRadius,
    );

    button.addChild(centreOn(label(def.name, 10, UI.text, '600'), cx, y + height * 0.52));
    button.addChild(
      centreOn(
        label(`${def.goldCost ?? 0}g · ${def.supplyCost ?? 0}s`, 9, UI.textMuted),
        cx,
        y + height * 0.7,
      ),
    );

    // §9.3: highlight which units are strong or weak against this wave. Without
    // this the matrix is invisible complexity and new players lose without
    // knowing why.
    if (verdict && verdict !== 'neutral') {
      const strong = verdict === 'strong';
      button.addChild(
        centreOn(
          label(strong ? '▲ strong' : '▼ weak', 9, strong ? UI.healthGood : UI.danger, '700'),
          cx,
          y + height * 0.84,
        ),
      );
    }

    button.alpha = affordable ? 1 : 0.42;
    button.eventMode = 'static';
    button.cursor = 'pointer';
    button.hitArea = new Rectangle(x, y, width, height);
    button.on('pointertap', () => this.handlers.onSelectUnitDef(def.id));

    return button;
  }

  private renderUpgradePanel(lane: Lane, unitId: number): void {
    const l = this.layout;
    const unit = lane.units.find((u) => u.id === unitId);
    const current = unit ? this.data.units.units.find((u) => u.id === unit.defId) : undefined;
    const next = current?.upgradesTo
      ? this.data.units.units.find((u) => u.id === current.upgradesTo)
      : undefined;

    const top = l.buildBar.y + 8;
    const height = Math.max(MIN_TOUCH, l.buildBar.height - 22);
    const width = l.buildBar.width - 100;

    const panel = new Container();
    const g = new Graphics();
    g.roundRect(6, top, width, height, 8).fill({ color: UI.panel });
    g.roundRect(6, top, width, height, 8).stroke({ width: 1, color: UI.panelEdge });
    panel.addChild(g);

    if (!current) {
      panel.addChild(
        centreOn(label('unit lost', 12, UI.textMuted), 6 + width / 2, top + height / 2),
      );
    } else if (!next) {
      panel.addChild(
        centreOn(label(`${current.name} — max tier`, 12, UI.textMuted), 6 + width / 2, top + 16),
      );
    } else {
      const affordable =
        lane.economy.gold >= (next.goldCost ?? 0) &&
        lane.economy.supplyUsed + (next.supplyCost ?? 0) <= lane.economy.supplyCap;

      panel.addChild(
        centreOn(
          label(`${current.name} → ${next.name}`, 13, UI.text, '700'),
          6 + width / 2,
          top + 10,
        ),
      );
      panel.addChild(
        centreOn(
          label(
            `${next.goldCost ?? 0}g` +
              `${next.supplyCost ? ` · +${next.supplyCost} supply` : ''}` +
              `   ${current.hp ?? 0} → ${next.hp ?? 0} hp` +
              `   ${current.damage ?? 0} → ${next.damage ?? 0} dmg`,
            10,
            UI.textMuted,
          ),
          6 + width / 2,
          top + 30,
        ),
      );

      const buttonY = top + height - 30;
      const upgrade = new Container();
      const ug = new Graphics();
      ug.roundRect(6 + width / 2 - 70, buttonY, 140, 26, 6).fill({
        color: affordable ? UI.accent : UI.panelEdge,
      });
      upgrade.addChild(ug);
      upgrade.addChild(
        centreOn(
          label('Upgrade', 12, affordable ? UI.background : UI.textMuted, '700'),
          6 + width / 2,
          buttonY + 6,
        ),
      );
      upgrade.eventMode = 'static';
      upgrade.cursor = 'pointer';
      upgrade.hitArea = new Rectangle(6 + width / 2 - 70, buttonY, 140, 26);
      upgrade.on('pointertap', () => this.handlers.onUpgrade(unitId));
      panel.addChild(upgrade);
    }

    this.buttons.addChild(panel);

    // A way back to the roster.
    const close = new Container();
    const cg = new Graphics();
    const cx = l.buildBar.width - 88;
    cg.roundRect(cx, top, 82, height, 8).fill({ color: UI.panel });
    cg.roundRect(cx, top, 82, height, 8).stroke({ width: 1, color: UI.panelEdge });
    close.addChild(cg);
    close.addChild(centreOn(label('Back', 12, UI.text, '600'), cx + 41, top + height / 2 - 8));
    close.eventMode = 'static';
    close.cursor = 'pointer';
    close.hitArea = new Rectangle(cx, top, 82, height);
    close.on('pointertap', () => this.handlers.onClearSelection());
    this.buttons.addChild(close);
  }

  /** §3.2: all living players ready skips the rest of the build phase. */
  private readyButton(
    x: number,
    y: number,
    width: number,
    height: number,
    isReady: boolean,
    enabled: boolean,
  ): Container {
    const button = new Container();
    const g = new Graphics();

    g.roundRect(x, y, width, height, 8).fill({ color: isReady ? UI.healthGood : UI.panel });
    g.roundRect(x, y, width, height, 8).stroke({ width: 1, color: UI.panelEdge });
    button.addChild(g);

    button.addChild(
      centreOn(
        label(isReady ? 'Ready ✓' : 'Ready', 12, isReady ? UI.background : UI.text, '700'),
        x + width / 2,
        y + height / 2 - 8,
      ),
    );

    button.alpha = enabled ? 1 : 0.42;
    if (enabled) {
      button.eventMode = 'static';
      button.cursor = 'pointer';
      button.hitArea = new Rectangle(x, y, width, height);
      button.on('pointertap', () => this.handlers.onReady());
    }

    return button;
  }
}
