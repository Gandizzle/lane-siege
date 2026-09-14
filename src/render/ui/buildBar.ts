/**
 * The build bar. DESIGN.md §4.1, §7.3, §7.4, §9.3, §10.1, §11.4.
 *
 * Sits at the bottom because that is the thumb zone for one-handed portrait
 * play. Five tabs, one per distinct thing to spend on:
 *
 *   Build  six units (§7.1), plus the upgrade panel for a selected one (§7.3)
 *   Tech   global tech, tied to damage types rather than unit types (§7.4)
 *   Fort   fortress and resource-building upgrades, bought with gems (§10)
 *   Aura   the fortress weapon's damage type and the active aura (§10.1)
 *   Send   monsters at an opponent, bought with gems (§11.5)
 *
 * Send arrived with M4 and shares gems with Fort on purpose: §11.2 says offence
 * and defence compete for the same currency and calls that the intended
 * tension. Two adjacent tabs spending one pool is the plainest way to show it.
 *
 * IMPORTANT - interactive objects are built ONCE and only updated afterwards.
 *
 * Pixi resolves a tap by matching pointerdown and pointerup on the SAME display
 * object. A real press is held around 100ms, which at 60fps spans half a dozen
 * frames. An earlier version rebuilt every button each frame, so the object that
 * received the press no longer existed when the release arrived and no tap ever
 * fired - the bar rendered perfectly and was completely dead. Synthetic test
 * clicks hid it, because they release in the same frame they press.
 *
 * So: `setLayout()` creates and positions, `render()` only changes appearance.
 * Never call removeChildren() on anything holding a listener.
 *
 * The bar decides nothing. Affordability is shown here but enforced in the
 * simulation (§15.1), so a greyed-out button is a courtesy, never the rule.
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { Text } from 'pixi.js';
import type { AuraType, DamageType, GameData, UnitDef } from '../../data/schema.ts';
import { ticksToSeconds } from '../../sim/index.ts';
import type { EconomyView, LaneView, MatchView, WaveSummary } from '../../sim/index.ts';
import type { LaneLayout } from '../layout.ts';
import { DAMAGE_COLOURS, UI } from '../palette.ts';
import { GridButton } from './gridButton.ts';
import { centreOn, label } from './text.ts';

export type Selection =
  { kind: 'unitDef'; unitDefId: string } | { kind: 'placedUnit'; unitId: number } | null;

export interface BuildBarHandlers {
  onSelectUnitDef(unitDefId: string): void;
  /** §11.5: the sender picks the target, which is the point of the mechanic. */
  onSend(sendId: string, targetTeamId: string): void;
  onUpgrade(unitId: number): void;
  onBuyTech(trackId: string): void;
  onBuyFortress(upgradeId: string): void;
  onBuySupply(): void;
  onSelectWeapon(damageType: DamageType): void;
  onSelectAura(aura: AuraType): void;
  onClearSelection(): void;
}

type Tab = 'build' | 'tech' | 'fort' | 'aura' | 'send';
const TABS: { id: Tab; name: string }[] = [
  { id: 'build', name: 'Build' },
  { id: 'tech', name: 'Tech' },
  { id: 'fort', name: 'Fort' },
  { id: 'aura', name: 'Aura' },
  { id: 'send', name: 'Send' },
];

/** Fortress ladders the Fort tab exposes, in display order. */
const FORT_UPGRADES: { id: string; name: string }[] = [
  { id: 'weapon', name: 'Weapon' },
  { id: 'hp', name: 'Fortress HP' },
  { id: 'regen', name: 'Regeneration' },
  { id: 'gemProduction', name: 'Gem Output' },
  { id: 'auraStrength', name: 'Aura Power' },
  { id: 'auraRadius', name: 'Aura Radius' },
];

const AURAS: { id: AuraType; name: string }[] = [
  { id: 'damage', name: 'Damage' },
  { id: 'attackSpeed', name: 'Attack Spd' },
  { id: 'armour', name: 'Armour' },
  { id: 'regeneration', name: 'Regen' },
];

const MIN_TOUCH = 44;

/** §7.1: every builder has exactly six units. */
const UNITS_PER_BUILDER = 6;

class TabButton extends Container {
  private readonly bg = new Graphics();
  private readonly caption: Text;
  private w = 0;
  private h = 0;

  constructor(
    readonly id: Tab,
    name: string,
    onTap: () => void,
  ) {
    super();
    this.caption = label(name, 11, UI.textMuted, '700');
    this.addChild(this.bg, this.caption);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointertap', onTap);
  }

  layout(x: number, y: number, width: number, height: number): void {
    this.position.set(x, y);
    this.w = width;
    this.h = height;
    this.hitArea = new Rectangle(0, 0, width, height);
    this.redraw(false);
  }

  redraw(active: boolean): void {
    this.bg.clear();
    this.bg.roundRect(0, 0, this.w, this.h, 6).fill({ color: active ? UI.panelEdge : UI.buildBar });
    this.caption.style.fill = active ? UI.text : UI.textMuted;
    centreOn(this.caption, this.w / 2, this.h / 2 - 7);
  }
}

export class BuildBar extends Container {
  private readonly background = new Graphics();
  private readonly tabStrip = new Container();
  private readonly tabButtons: TabButton[] = [];
  private active: Tab = 'build';

  private readonly panels: Record<Tab, Container> = {
    build: new Container(),
    tech: new Container(),
    fort: new Container(),
    aura: new Container(),
    send: new Container(),
  };

  /**
   * Six slots, not six fixed units.
   *
   * There are four rosters (§7.1) and a lane plays one of them, so which unit a
   * slot stands for changes with the lane - but the BUTTON cannot, because a
   * rebuilt interactive object never receives a tap (see the note at the top of
   * this file). So the buttons are permanent and their contents are re-pointed
   * each render.
   */
  private readonly unitButtons: GridButton[] = [];
  private unitSlots: (UnitDef | undefined)[] = [];
  private readonly techButtons: { trackId: string; name: string; button: GridButton }[] = [];
  private readonly fortButtons: { id: string; name: string; button: GridButton }[] = [];
  private readonly supplyButton: GridButton;
  private readonly weaponButtons: { type: DamageType; button: GridButton }[] = [];
  private readonly auraButtons: { id: AuraType; button: GridButton }[] = [];

  private readonly sendButtons: { sendId: string; button: GridButton }[] = [];
  private readonly targetButtons: GridButton[] = [];
  /**
   * Which opponent the next send is aimed at.
   *
   * Held here rather than passed in because it is a property of the control,
   * not of the match: it survives switching tabs, and it is re-pointed only
   * when the chosen target is eliminated.
   */
  private sendTarget: string | null = null;
  /** Which team each target chip currently stands for, in chip order. */
  private targetIds: (string | null)[] = [null, null, null];

  private readonly upgradePanel = new Container();
  private readonly upgradeTitle: Text;
  private readonly upgradeDetail: Text;
  private readonly upgradeButton: GridButton;
  private readonly backButton: GridButton;
  private selectedUnitId: number | null = null;

  constructor(
    layout: LaneLayout,
    private readonly data: GameData,
    private readonly handlers: BuildBarHandlers,
  ) {
    super();

    for (const tab of TABS) {
      const button = new TabButton(tab.id, tab.name, () => this.setTab(tab.id));
      this.tabButtons.push(button);
      this.tabStrip.addChild(button);
    }

    // Build tab: tier 1 only - higher tiers come from upgrading in place (§7.3).
    // Six slots, because §7.1 gives every builder exactly six units.
    for (let slot = 0; slot < UNITS_PER_BUILDER; slot++) {
      const button = new GridButton(() => {
        const def = this.unitSlots[slot];
        if (def) this.handlers.onSelectUnitDef(def.id);
      });
      this.unitButtons.push(button);
      this.panels.build.addChild(button);
    }

    for (const track of data.economy.tech.tracks) {
      const button = new GridButton(() => this.handlers.onBuyTech(track.id));
      this.techButtons.push({ trackId: track.id, name: track.name, button });
      this.panels.tech.addChild(button);
    }

    for (const up of FORT_UPGRADES) {
      const button = new GridButton(() => this.handlers.onBuyFortress(up.id));
      this.fortButtons.push({ id: up.id, name: up.name, button });
      this.panels.fort.addChild(button);
    }
    this.supplyButton = new GridButton(() => this.handlers.onBuySupply());
    this.panels.fort.addChild(this.supplyButton);

    for (const type of data.matrix.damageTypes) {
      const button = new GridButton(() => this.handlers.onSelectWeapon(type));
      this.weaponButtons.push({ type, button });
      this.panels.aura.addChild(button);
    }
    for (const aura of AURAS) {
      const button = new GridButton(() => this.handlers.onSelectAura(aura.id));
      this.auraButtons.push({ id: aura.id, button });
      this.panels.aura.addChild(button);
    }

    // §2: at most three opponents, so three target chips exist from boot and
    // are hidden when there are fewer.
    for (let slot = 0; slot < 3; slot++) {
      const button = new GridButton(() => {
        const teamId = this.targetIds[slot];
        if (teamId) this.sendTarget = teamId;
      });
      this.targetButtons.push(button);
      this.panels.send.addChild(button);
    }
    for (const send of data.sends.sends) {
      const button = new GridButton(() => {
        if (this.sendTarget) this.handlers.onSend(send.id, this.sendTarget);
      });
      this.sendButtons.push({ sendId: send.id, button });
      this.panels.send.addChild(button);
    }

    this.upgradeTitle = label('', 13, UI.text, '700');
    this.upgradeDetail = label('', 10, UI.textMuted);
    this.upgradeButton = new GridButton(() => {
      if (this.selectedUnitId !== null) this.handlers.onUpgrade(this.selectedUnitId);
    });
    this.backButton = new GridButton(() => this.handlers.onClearSelection());
    this.upgradePanel.addChild(
      this.upgradeTitle,
      this.upgradeDetail,
      this.upgradeButton,
      this.backButton,
    );

    this.addChild(
      this.background,
      this.tabStrip,
      this.panels.build,
      this.panels.tech,
      this.panels.fort,
      this.panels.aura,
      this.panels.send,
      this.upgradePanel,
    );
    this.setLayout(layout);
  }

  private setTab(tab: Tab): void {
    this.active = tab;
    this.handlers.onClearSelection();
  }

  setLayout(layout: LaneLayout): void {
    const l = layout;
    const bar = l.buildBar;

    this.background.clear();
    this.background.rect(bar.x, bar.y, bar.width, bar.height).fill({ color: UI.buildBar });

    // Tab strip along the top of the bar.
    const tabH = 26;
    const tabW = (bar.width - 12 - 3 * 4) / TABS.length;
    this.tabButtons.forEach((button, i) => {
      button.layout(6 + i * (tabW + 4), bar.y + 3, tabW, tabH);
    });

    const top = bar.y + tabH + 7;
    const height = bar.height - tabH - 12;

    grid(this.unitButtons, 3, 2, 6, top, bar.width - 12, height);
    grid(
      this.techButtons.map((t) => t.button),
      3,
      2,
      6,
      top,
      bar.width - 12,
      height,
    );
    grid(
      [...this.fortButtons.map((f) => f.button), this.supplyButton],
      4,
      2,
      6,
      top,
      bar.width - 12,
      height,
    );
    grid(
      [...this.weaponButtons.map((w) => w.button), ...this.auraButtons.map((a) => a.button)],
      4,
      2,
      6,
      top,
      bar.width - 12,
      height,
    );

    // Send: a row of target chips, then the catalogue under it. The target has
    // to be visible while choosing what to throw, or picking one becomes a
    // separate step to forget.
    const chipH = 38;
    grid(this.targetButtons, 3, 1, 6, top, bar.width - 12, chipH);
    grid(
      this.sendButtons.map((s) => s.button),
      3,
      2,
      6,
      top + chipH + 6,
      bar.width - 12,
      height - chipH - 6,
    );

    // Upgrade panel replaces the Build grid when a placed unit is selected.
    this.upgradeTitle.x = 18;
    this.upgradeTitle.y = top + 6;
    this.upgradeDetail.x = 18;
    this.upgradeDetail.y = top + 26;
    this.upgradeButton.layout(18, top + height - 46, 150, Math.max(MIN_TOUCH, 44));
    this.backButton.layout(bar.width - 106, top + height - 46, 88, Math.max(MIN_TOUCH, 44));
  }

  render(view: MatchView, lane: LaneView, selection: Selection, summary: WaveSummary | null): void {
    // §3.3, decided: from wave 25 nothing can be bought at all. The free
    // weapon/aura choices stay live, so they use `canChoose` instead.
    const canChoose = view.phase === 'build';
    const canAct = canChoose && view.wave < this.data.waves.attritionStartWave;
    const canBuild = canAct;
    // §13: out of the match means out of the shop, whatever the phase says.
    const alive = !view.eliminated;

    for (const button of this.tabButtons) button.redraw(button.id === this.active);

    const upgrading = selection?.kind === 'placedUnit';
    this.upgradePanel.visible = upgrading && this.active === 'build';
    this.panels.build.visible = this.active === 'build' && !upgrading;
    this.panels.tech.visible = this.active === 'tech';
    this.panels.fort.visible = this.active === 'fort';
    this.panels.aura.visible = this.active === 'aura';
    this.panels.send.visible = this.active === 'send';

    const economy = lane.economy;
    // The bar only ever shows your own lane, which always has a wallet. A lane
    // without one is somebody else's, and nothing here should be pointed at it.
    if (!economy) return;

    if (upgrading && this.active === 'build') {
      this.selectedUnitId = selection.unitId;
      this.renderUpgrade(lane, economy, selection.unitId, canAct && alive);
    } else {
      this.selectedUnitId = null;
    }

    if (this.panels.build.visible) {
      this.renderUnits(lane.builderId, economy, selection, summary, canBuild && alive);
    }
    if (this.panels.tech.visible) this.renderTech(economy, canAct && alive);
    if (this.panels.fort.visible) this.renderFort(economy, canAct && alive);
    if (this.panels.aura.visible) this.renderAura(lane, canChoose && alive);
    if (this.panels.send.visible) this.renderSend(view, economy, canAct && alive);
  }

  /**
   * §11.5: pick a target, then pick what to throw at it.
   *
   * The target defaults to whoever has the most fortress HP left, which is the
   * leader as far as §12 lets anyone tell - so the default action is the
   * gang-up-on-the-leader one the section describes, and choosing differently
   * is a deliberate act.
   */
  private renderSend(view: MatchView, economy: EconomyView, canAct: boolean): void {
    const targets = [...view.opponents]
      .filter((o) => !o.eliminated)
      .sort((a, b) => a.teamId.localeCompare(b.teamId));

    // Re-point at the leader when nothing is chosen, or when the chosen target
    // has been eliminated out from under the choice.
    if (!this.sendTarget || !targets.some((t) => t.teamId === this.sendTarget)) {
      const leader = [...targets].sort((a, b) => b.fortressHp - a.fortressHp)[0];
      this.sendTarget = leader ? leader.teamId : null;
    }

    this.targetIds = [null, null, null];
    this.targetButtons.forEach((button, slot) => {
      const target = targets[slot];
      button.visible = target !== undefined;
      if (!target) return;

      this.targetIds[slot] = target.teamId;
      const fraction =
        target.fortressMaxHp > 0 ? Math.round((100 * target.fortressHp) / target.fortressMaxHp) : 0;

      button.setSwatch(null);
      button.update({
        title: laneName(target.teamId),
        detail: `${fraction}% fortress`,
        // A countdown only where there is one to count: sight can also come
        // from the lane simply being open during a wave (§12), which does not
        // run out on a clock of its own.
        note: target.watching
          ? target.visionTicksLeft > 0
            ? `visible ${Math.ceil(ticksToSeconds(target.visionTicksLeft))}s`
            : 'visible'
          : '',
        noteColour: UI.accent,
        enabled: canAct,
        selected: this.sendTarget === target.teamId,
      });
    });

    const gems = economy.gems;
    for (const { sendId, button } of this.sendButtons) {
      const def = this.data.sends.sends.find((s) => s.id === sendId);
      if (!def) continue;

      const cost = def.gemCost ?? 0;
      const income = def.incomeGranted ?? 0;

      button.setSwatch(null);
      button.update({
        title: def.name,
        // §11.5: the income is the whole reason an early send is an investment
        // rather than an attack, so it is priced right next to the cost.
        detail: `${cost} gem → +${income}g/wave`,
        note: def.grantsVision ? `${def.monsters.length}× · sight` : `${def.monsters.length}×`,
        enabled: canAct && this.sendTarget !== null && gems >= cost,
      });
    }
  }

  private renderUnits(
    builderId: string,
    economy: EconomyView,
    selection: Selection,
    summary: WaveSummary | null,
    canBuild: boolean,
  ): void {
    this.unitSlots = this.data.units.units.filter((u) => u.tier === 1 && u.builderId === builderId);

    this.unitButtons.forEach((button, slot) => {
      const def = this.unitSlots[slot];
      button.visible = def !== undefined;
      if (!def) return;

      const gold = def.goldCost ?? 0;
      const supply = def.supplyCost ?? 0;
      const affordable =
        canBuild && economy.gold >= gold && economy.supplyUsed + supply <= economy.supplyCap;

      const verdict = summary?.units.find((u) => u.unitId === def.id)?.verdict;
      button.setSwatch(DAMAGE_COLOURS[def.damageType]);
      button.update({
        title: def.name,
        detail: `${gold}g · ${supply} supply`,
        // §9.3: say which units counter this wave, or the matrix stays invisible.
        note: verdict === 'strong' ? '▲ strong' : verdict === 'weak' ? '▼ weak' : '',
        noteColour: verdict === 'strong' ? UI.healthGood : UI.danger,
        enabled: affordable,
        selected: selection?.kind === 'unitDef' && selection.unitDefId === def.id,
      });
    });
  }

  /** §7.4: tech is tied to damage types - one buy lifts every unit of that type. */
  private renderTech(economy: EconomyView, canAct: boolean): void {
    for (const { trackId, name, button } of this.techButtons) {
      const track = this.data.economy.tech.tracks.find((t) => t.id === trackId);
      if (!track) continue;

      const level = economy.tech[trackId] ?? 0;
      const next = track.levels.find((l) => l.level === level + 1);
      const cost = next?.goldCost ?? 0;

      button.setSwatch(track.damageType ? DAMAGE_COLOURS[track.damageType] : null);
      button.update({
        title: name,
        detail: next ? `${cost}g` : 'maxed',
        note: `level ${level}/${track.levels.length}`,
        enabled: canAct && next !== undefined && economy.gold >= cost,
      });
    }
  }

  /** §10: fortress upgrades are bought with GEMS - offence and defence compete. */
  private renderFort(economy: EconomyView, canAct: boolean): void {
    const ladders = fortressLadders(this.data);

    for (const { id, name, button } of this.fortButtons) {
      const ladder = ladders[id] ?? [];
      const level = economy.upgrades[id] ?? 0;
      const next = ladder.find((l) => l.level === level + 1);
      const cost = next?.gemCost ?? 0;
      const supply = next?.supplyCost ?? 0;

      button.setSwatch(null);
      button.update({
        title: name,
        detail: next ? `${cost} gem${supply ? ` · ${supply}s` : ''}` : 'maxed',
        note: `level ${level}/${ladder.length}`,
        enabled:
          canAct &&
          next !== undefined &&
          economy.gems >= cost &&
          economy.supplyUsed + supply <= economy.supplyCap,
      });
    }

    // §11.4: the supply cap is a purchase, not a gift.
    const ladder = this.data.economy.supply.capUpgrades;
    const level = economy.upgrades.supply ?? 0;
    const next = ladder.find((l) => l.level === level + 1);
    this.supplyButton.setSwatch(null);
    this.supplyButton.update({
      title: 'Supply Cap',
      detail: next ? `${next.goldCost ?? 0}g → ${next.value ?? 0}` : 'maxed',
      note: `cap ${economy.supplyCap}`,
      enabled: canAct && next !== undefined && economy.gold >= (next.goldCost ?? 0),
    });
  }

  /**
   * §10.1: the weapon's damage type is free and instant each build phase, and
   * exactly one aura is active at a time.
   */
  private renderAura(lane: LaneView, canAct: boolean): void {
    for (const { type, button } of this.weaponButtons) {
      button.setSwatch(DAMAGE_COLOURS[type]);
      button.update({
        title: type,
        detail: 'weapon',
        enabled: canAct,
        selected: lane.fortress.weaponDamageType === type,
      });
    }
    for (const { id, button } of this.auraButtons) {
      const meta = AURAS.find((a) => a.id === id);
      button.setSwatch(null);
      button.update({
        title: meta?.name ?? id,
        detail: 'aura',
        note: lane.fortress.auraRadius > 0 ? `r ${lane.fortress.auraRadius.toFixed(1)}` : '',
        enabled: canAct,
        selected: lane.fortress.activeAura === id,
      });
    }
  }

  /** §7.3: upgrading happens in place - same tile, same identity. */
  private renderUpgrade(
    lane: LaneView,
    economy: EconomyView,
    unitId: number,
    canAct: boolean,
  ): void {
    const unit = lane.units.find((u) => u.id === unitId);
    const current = unit ? this.data.units.units.find((u) => u.id === unit.defId) : undefined;
    const next = current?.upgradesTo
      ? this.data.units.units.find((u) => u.id === current.upgradesTo)
      : undefined;

    this.backButton.setSwatch(null);
    this.backButton.update({ title: 'Back', detail: '', enabled: true });

    if (!current) {
      this.upgradeTitle.text = 'Unit lost';
      this.upgradeDetail.text = '';
      this.upgradeButton.visible = false;
      return;
    }

    if (!next) {
      this.upgradeTitle.text = `${current.name} — max tier`;
      this.upgradeDetail.text = 'Nothing further to buy for this unit.';
      this.upgradeButton.visible = false;
      return;
    }

    const gold = next.goldCost ?? 0;
    const supply = next.supplyCost ?? 0;
    this.upgradeTitle.text = `${current.name} → ${next.name}`;
    this.upgradeDetail.text = `${current.hp ?? 0}→${next.hp ?? 0} hp   ${current.damage ?? 0}→${next.damage ?? 0} dmg`;

    this.upgradeButton.visible = true;
    this.upgradeButton.setSwatch(DAMAGE_COLOURS[next.damageType]);
    this.upgradeButton.update({
      title: 'Upgrade',
      detail: `${gold}g${supply ? ` · +${supply} supply` : ''}`,
      enabled: canAct && economy.gold >= gold && economy.supplyUsed + supply <= economy.supplyCap,
    });
  }
}

function fortressLadders(data: GameData) {
  const f = data.fortress;
  return {
    weapon: f.weapon.upgrades,
    hp: f.hp.upgrades,
    regen: f.regenOnLaneClear.upgrades,
    gemProduction: f.resourceBuilding.upgrades,
    auraStrength: f.auras.strength.upgrades,
    auraRadius: f.auras.radius.upgrades,
  } as Record<string, ReturnType<() => GameData['fortress']['hp']['upgrades']>>;
}

/** "lane3" -> "Lane 3". The same shape the opponent tabs use. */
function laneName(teamId: string): string {
  const match = /(\d+)$/.exec(teamId);
  return match ? `Lane ${match[1]}` : teamId;
}

/** Lay buttons out in a fixed grid, left to right then top to bottom. */
function grid(
  buttons: GridButton[],
  cols: number,
  rows: number,
  gap: number,
  top: number,
  width: number,
  height: number,
): void {
  const w = (width - gap * (cols - 1)) / cols;
  const h = (height - gap * (rows - 1)) / rows;
  buttons.forEach((button, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    button.layout(6 + col * (w + gap), top + row * (h + gap), w, Math.max(MIN_TOUCH, h));
  });
}
