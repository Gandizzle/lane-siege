/**
 * The build bar. DESIGN.md §4.1, §14.1, §7.3, §9.3.
 *
 * Sits at the bottom because that is the thumb zone for one-handed portrait play
 * (§4.1). Buttons are sized for a thumb, not a mouse pointer.
 *
 * IMPORTANT - interactive objects are built ONCE and only updated afterwards.
 *
 * Pixi resolves a tap by matching pointerdown and pointerup on the SAME display
 * object. A real click or thumb press is held for around 100ms, which at 60fps
 * spans half a dozen frames. An earlier version rebuilt every button each frame,
 * so the object that received the press no longer existed when the release
 * arrived and no tap ever fired - the bar looked right and was completely dead.
 * Synthetic test clicks hid it, because they release in the same frame they
 * press.
 *
 * So: `layout()` creates and positions, `update()` only changes appearance.
 * Never call removeChildren() on anything holding a listener.
 *
 * The bar decides nothing: affordability is shown here but enforced in the
 * simulation (§15.1), so a greyed-out button is a courtesy, never the rule.
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { Text } from 'pixi.js';
import type { DamageType, GameData, UnitDef } from '../../data/schema.ts';
import type { Lane, WaveSummary } from '../../sim/index.ts';
import type { LaneLayout } from '../layout.ts';
import { DAMAGE_COLOURS, UI } from '../palette.ts';
import { drawEntity } from '../shapes.ts';
import { label } from './text.ts';

export type Selection =
  { kind: 'unitDef'; unitDefId: string } | { kind: 'placedUnit'; unitId: number } | null;

export interface BuildBarHandlers {
  onSelectUnitDef(unitDefId: string): void;
  onUpgrade(unitId: number): void;
  onSelectWeapon(damageType: DamageType): void;
  onClearSelection(): void;
}

/** Minimum comfortable touch target. Below this, thumbs miss. */
const MIN_TOUCH = 44;

/** Centres a Text within a box of the given width, in local coordinates. */
function centreIn(text: Text, width: number, y: number): void {
  text.x = (width - text.width) / 2;
  text.y = y;
}

/** A tappable panel whose listener survives for the life of the bar. */
class TapPanel extends Container {
  protected readonly bg = new Graphics();
  protected width_ = 0;
  protected height_ = 0;

  constructor(onTap: () => void) {
    super();
    this.addChild(this.bg);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointertap', onTap);
  }

  protected resizeTo(width: number, height: number): void {
    this.width_ = width;
    this.height_ = height;
    // Local coordinates, so moving the panel never invalidates its hit area.
    this.hitArea = new Rectangle(0, 0, width, height);
  }

  setEnabled(enabled: boolean): void {
    this.alpha = enabled ? 1 : 0.42;
    this.eventMode = enabled ? 'static' : 'none';
  }

  /** A small solid swatch, used for the fortress weapon damage types. */
  layoutChip(x: number, y: number, width: number, height: number, colour: number): void {
    this.position.set(x, y);
    this.resizeTo(width, height);
    this.bg.clear();
    this.bg.roundRect(0, 0, width, height, 6).fill({ color: colour });
  }
}

class UnitButton extends TapPanel {
  private readonly glyph = new Graphics();
  private readonly ring = new Graphics();
  private readonly nameText: Text;
  private readonly costText: Text;
  private readonly verdictText: Text;

  constructor(
    readonly def: UnitDef,
    onTap: () => void,
  ) {
    super(onTap);
    this.nameText = label(def.name, 10, UI.text, '600');
    this.costText = label(`${def.goldCost ?? 0}g · ${def.supplyCost ?? 0}s`, 9, UI.textMuted);
    this.verdictText = label('', 9, UI.textMuted, '700');
    this.addChild(this.glyph, this.ring, this.nameText, this.costText, this.verdictText);
  }

  layout(x: number, y: number, width: number, height: number): void {
    this.position.set(x, y);
    this.resizeTo(width, height);

    this.bg.clear();
    this.bg.roundRect(0, 0, width, height, 8).fill({ color: UI.panel });
    this.bg.roundRect(0, 0, width, height, 8).stroke({ width: 1, color: UI.panelEdge });

    this.ring.clear();
    this.ring.roundRect(0, 0, width, height, 8).stroke({ width: 2, color: UI.selected });
    this.ring.visible = false;

    this.glyph.clear();
    drawEntity(
      this.glyph,
      { armour: this.def.armour, damageType: this.def.damageType, tier: 1, outlined: false },
      width / 2,
      height * 0.3,
      Math.min(width, height) * 0.17,
    );

    centreIn(this.nameText, width, height * 0.52);
    centreIn(this.costText, width, height * 0.7);
    centreIn(this.verdictText, width, height * 0.84);
  }

  update(
    affordable: boolean,
    selected: boolean,
    verdict: 'strong' | 'neutral' | 'weak' | undefined,
  ): void {
    this.setEnabled(affordable);
    // Selection must stay visible on an unaffordable button, so the ring is
    // drawn at full opacity regardless of the panel's dimming.
    this.ring.visible = selected;

    // §9.3: highlight which units are strong or weak against this wave, or the
    // matrix stays invisible and players lose without knowing why.
    const show = verdict === 'strong' || verdict === 'weak';
    this.verdictText.visible = show;
    if (!show) return;

    const strong = verdict === 'strong';
    const text = strong ? '▲ strong' : '▼ weak';
    if (this.verdictText.text !== text) {
      this.verdictText.text = text;
      this.verdictText.style.fill = strong ? UI.healthGood : UI.danger;
      centreIn(this.verdictText, this.width_, this.height_ * 0.84);
    }
  }
}

class SimpleButton extends TapPanel {
  private readonly caption: Text;

  constructor(text: string, onTap: () => void) {
    super(onTap);
    this.caption = label(text, 12, UI.text, '700');
    this.addChild(this.caption);
  }

  layout(x: number, y: number, width: number, height: number): void {
    this.position.set(x, y);
    this.resizeTo(width, height);
    this.redraw(UI.panel, UI.text);
  }

  redraw(fill: number, textColour: number): void {
    this.bg.clear();
    this.bg.roundRect(0, 0, this.width_, this.height_, 8).fill({ color: fill });
    this.bg.roundRect(0, 0, this.width_, this.height_, 8).stroke({ width: 1, color: UI.panelEdge });
    this.caption.style.fill = textColour;
    centreIn(this.caption, this.width_, this.height_ / 2 - 8);
  }

  setCaption(text: string): void {
    if (this.caption.text === text) return;
    this.caption.text = text;
    centreIn(this.caption, this.width_, this.height_ / 2 - 8);
  }
}

export class BuildBar extends Container {
  private readonly background = new Graphics();

  private readonly roster = new Container();
  private readonly unitButtons: UnitButton[] = [];
  private readonly weapon = new Container();
  private readonly weaponCaption = label('fortress weapon', 9, UI.textMuted, '600');
  private readonly weaponChips: { type: DamageType; panel: TapPanel; ring: Graphics }[] = [];

  private readonly upgradePanel = new Container();
  private readonly upgradeBg = new Graphics();
  private readonly upgradeTitle: Text;
  private readonly upgradeDetail: Text;
  private readonly upgradeButton: SimpleButton;
  private readonly backButton: SimpleButton;

  private selectedUnitId: number | null = null;

  constructor(
    layout: LaneLayout,
    private readonly data: GameData,
    private readonly handlers: BuildBarHandlers,
  ) {
    super();

    // Tier 1 only: higher tiers are reached by upgrading in place (§7.3), never
    // built directly.
    for (const def of data.units.units.filter((u) => u.tier === 1)) {
      const button = new UnitButton(def, () => this.handlers.onSelectUnitDef(def.id));
      this.unitButtons.push(button);
      this.roster.addChild(button);
    }

    // §10.1: the fortress weapon's damage type is player-selectable during each
    // build phase, free and instant. A small per-wave decision that keeps every
    // player engaging with the matrix - and the reason this corner of the bar
    // exists now that Ready is gone.
    for (const type of data.matrix.damageTypes) {
      const ring = new Graphics();
      const panel = new TapPanel(() => this.handlers.onSelectWeapon(type));
      panel.addChild(ring);
      this.weaponChips.push({ type, panel, ring });
      this.weapon.addChild(panel);
    }
    this.weapon.addChild(this.weaponCaption);
    this.roster.addChild(this.weapon);

    this.upgradeTitle = label('', 13, UI.text, '700');
    this.upgradeDetail = label('', 10, UI.textMuted);
    this.upgradeButton = new SimpleButton('Upgrade', () => {
      if (this.selectedUnitId !== null) this.handlers.onUpgrade(this.selectedUnitId);
    });
    this.backButton = new SimpleButton('Back', () => this.handlers.onClearSelection());
    this.upgradePanel.addChild(
      this.upgradeBg,
      this.upgradeTitle,
      this.upgradeDetail,
      this.upgradeButton,
      this.backButton,
    );

    this.addChild(this.background, this.roster, this.upgradePanel);
    this.setLayout(layout);
  }

  setLayout(layout: LaneLayout): void {
    const l = layout;

    this.background.clear();
    this.background
      .rect(l.buildBar.x, l.buildBar.y, l.buildBar.width, l.buildBar.height)
      .fill({ color: UI.buildBar });

    const weaponWidth = 96;
    const gap = 6;
    const count = Math.max(1, this.unitButtons.length);
    const available = l.buildBar.width - weaponWidth - gap * (count + 1) - 6;
    const buttonWidth = Math.max(MIN_TOUCH, available / count);
    const buttonHeight = Math.max(MIN_TOUCH, l.buildBar.height - 22);
    const top = l.buildBar.y + 8;

    this.unitButtons.forEach((button, i) => {
      button.layout(6 + gap + i * (buttonWidth + gap), top, buttonWidth, buttonHeight);
    });
    // Four chips in a 2x2 block, each comfortably thumb-sized.
    const weaponX = l.buildBar.width - weaponWidth - 6;
    const chipW = (weaponWidth - 6) / 2;
    const chipH = (buttonHeight - 18) / 2;
    this.weaponChips.forEach(({ panel, ring }, i) => {
      const cx = weaponX + (i % 2) * (chipW + 6);
      const cy = top + 16 + Math.floor(i / 2) * (chipH + 6);
      panel.layoutChip(cx, cy, chipW, chipH, DAMAGE_COLOURS[this.weaponChips[i]!.type]);
      ring.clear();
      ring.roundRect(0, 0, chipW, chipH, 6).stroke({ width: 2, color: UI.selected });
      ring.visible = false;
    });

    this.weaponCaption.x = weaponX;
    this.weaponCaption.y = top + 2;

    // Upgrade panel occupies the same band.
    const panelWidth = l.buildBar.width - 100;
    this.upgradeBg.clear();
    this.upgradeBg.roundRect(6, top, panelWidth, buttonHeight, 8).fill({ color: UI.panel });
    this.upgradeBg
      .roundRect(6, top, panelWidth, buttonHeight, 8)
      .stroke({ width: 1, color: UI.panelEdge });

    this.upgradeTitle.y = top + 8;
    this.upgradeDetail.y = top + 28;
    this.upgradeButton.layout(6 + panelWidth / 2 - 70, top + buttonHeight - 34, 140, 28);
    this.backButton.layout(l.buildBar.width - 88, top, 82, buttonHeight);
  }

  render(lane: Lane, selection: Selection, summary: WaveSummary | null, canBuild: boolean): void {
    for (const chip of this.weaponChips) {
      chip.ring.visible = lane.fortress.weaponDamageType === chip.type;
      chip.panel.setEnabled(canBuild);
    }

    const upgrading = selection?.kind === 'placedUnit';
    this.roster.visible = !upgrading;
    this.upgradePanel.visible = upgrading;

    if (upgrading) {
      this.selectedUnitId = selection.unitId;
      this.renderUpgrade(lane, selection.unitId);
      return;
    }

    this.selectedUnitId = null;
    this.renderRoster(lane, selection, summary, canBuild);
  }

  private renderRoster(
    lane: Lane,
    selection: Selection,
    summary: WaveSummary | null,
    canBuild: boolean,
  ): void {
    for (const button of this.unitButtons) {
      const def = button.def;
      const affordable =
        canBuild &&
        lane.economy.gold >= (def.goldCost ?? 0) &&
        lane.economy.supplyUsed + (def.supplyCost ?? 0) <= lane.economy.supplyCap;

      button.update(
        affordable,
        selection?.kind === 'unitDef' && selection.unitDefId === def.id,
        summary?.units.find((u) => u.unitId === def.id)?.verdict,
      );
    }
  }

  /**
   * §7.3: the upgrade happens in place - the unit keeps its tile and its
   * identity, gains stats and possibly an ability.
   */
  private renderUpgrade(lane: Lane, unitId: number): void {
    const unit = lane.units.find((u) => u.id === unitId);
    const current = unit ? this.data.units.units.find((u) => u.id === unit.defId) : undefined;
    const next = current?.upgradesTo
      ? this.data.units.units.find((u) => u.id === current.upgradesTo)
      : undefined;

    if (!current) {
      this.upgradeTitle.text = 'Unit lost';
      this.upgradeDetail.text = '';
      this.upgradeButton.visible = false;
    } else if (!next) {
      this.upgradeTitle.text = `${current.name} — max tier`;
      this.upgradeDetail.text = 'Nothing further to buy for this unit.';
      this.upgradeButton.visible = false;
    } else {
      const affordable =
        lane.economy.gold >= (next.goldCost ?? 0) &&
        lane.economy.supplyUsed + (next.supplyCost ?? 0) <= lane.economy.supplyCap;

      this.upgradeTitle.text = `${current.name} → ${next.name}`;
      this.upgradeDetail.text =
        `${next.goldCost ?? 0}g` +
        `${next.supplyCost ? ` · +${next.supplyCost} supply` : ''}` +
        `   ${current.hp ?? 0}→${next.hp ?? 0} hp` +
        `   ${current.damage ?? 0}→${next.damage ?? 0} dmg`;
      this.upgradeButton.visible = true;
      this.upgradeButton.setEnabled(affordable);
    }

    this.upgradeTitle.x = 18;
    this.upgradeDetail.x = 18;
  }
}
