/**
 * The build bar. DESIGN.md §4.1, §7.3, §7.4, §9.3, §10.1, §11.4.
 *
 * Sits at the bottom because that is the thumb zone for one-handed portrait
 * play. Five tabs, one per distinct thing to spend on, and a sixth to read:
 *
 *   Build  the six units of this lane's roster (§7.1)
 *   Tech   global tech, tied to damage types rather than unit types (§7.4)
 *   Fort   fortress and resource-building upgrades, bought with gems (§10)
 *   Aura   the fortress weapon's damage type and the active aura (§10.1)
 *   Send   monsters at an opponent, bought with gems (§11.5)
 *   Damage what each of your units landed this round (damagePanel.ts)
 *
 * A SELECTED UNIT is a seventh view and belongs to no tab: what it is, what it
 * does, and the two things you can do about it (§7.3, §11). Tapping a unit
 * takes the lit state off every tab and puts that panel up; tapping any tab
 * puts the unit down and goes there. It used to live inside Build, which meant
 * a unit tapped while another tab was open opened nothing at all, and the tap
 * that went looking for it cleared the selection on the way.
 *
 * Damage is the odd one out among the tabs and sits last for that reason: it
 * spends nothing.
 * It is here rather than beside the lane because §14.1 gives the lane the whole
 * width, and it is a tab rather than an overlay because the bar is already
 * where the screen puts things to read rather than things to watch.
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
import type { AuraType, DamageType, GameData, MonsterDef, UnitDef } from '../../data/schema.ts';
import { sellValue, ticksToSeconds } from '../../sim/index.ts';
import type {
  EconomyView,
  LaneView,
  MatchView,
  OpponentView,
  WaveSummary,
} from '../../sim/index.ts';
import type { LaneLayout } from '../layout.ts';
import { auraColour } from '../aura.ts';
import { DAMAGE_COLOURS, UI } from '../palette.ts';
import { DamagePanel } from './damagePanel.ts';
import { GridButton } from './gridButton.ts';
import { pickSendTarget, sendIcon } from './sends.ts';
import type { EntityStyle } from '../shapes.ts';
import { centreOn, label, wrapped } from './text.ts';
import {
  STAT_CELLS,
  STAT_COLUMNS,
  STAT_ROW_HEIGHT,
  STAT_VALUE_INSET,
  abilityLines,
  briefAbilityLines,
  briefLines,
  monsterAbilityLines,
  monsterStatText,
  panelRegions,
  statText,
  typeLine,
} from './unitStats.ts';

export type Selection =
  | { kind: 'unitDef'; unitDefId: string }
  | { kind: 'placedUnit'; unitId: number }
  /**
   * A monster in the lane, which is read-only: there is nothing to buy and
   * nothing to sell, and the panel is there to answer "what is that, and what
   * does it do to me". Selectable in a lane you are only WATCHING too, for the
   * same reason - reading an opponent's wave costs nobody anything.
   */
  | { kind: 'monster'; monsterId: number }
  | null;

/** What the bar is showing: one of the tabs, or the selected-body view. */
export type View = Tab | 'unit';

/**
 * Which view is up.
 *
 * A selected body outranks the tabs and belongs to none of them, so while one
 * is selected no tab is lit and no tab's panel is drawn. Tapping a tab clears
 * the selection (`setTab`), which is what brings that tab back.
 */
export function activeView(tab: Tab, bodySelected: boolean): View {
  return bodySelected ? 'unit' : tab;
}

/** Is this selection a body on the board - a unit of yours, or a monster? */
export function selectsBody(selection: Selection): boolean {
  return selection?.kind === 'placedUnit' || selection?.kind === 'monster';
}

export interface BuildBarHandlers {
  onSelectUnitDef(unitDefId: string): void;
  /** §11.5: the sender picks the target, which is the point of the mechanic. */
  onSend(sendId: string, targetTeamId: string): void;
  onUpgrade(unitId: number): void;
  /** §11, decided: sell a placed unit back. Build phase only. */
  onSell(unitId: number): void;
  onBuyTech(trackId: string): void;
  onBuyFortress(upgradeId: string): void;
  onBuySupply(): void;
  onSelectWeapon(damageType: DamageType): void;
  onSelectAura(aura: AuraType): void;
  onClearSelection(): void;
  /**
   * A damage row was tapped: point the lane's selection at that unit, so the
   * body doing the damage is picked out of the crowd on the board.
   */
  onSelectPlacedUnit(unitId: number): void;
}

export type Tab = 'build' | 'tech' | 'fort' | 'aura' | 'send' | 'damage';
const TABS: { id: Tab; name: string }[] = [
  { id: 'build', name: 'Build' },
  { id: 'tech', name: 'Tech' },
  { id: 'fort', name: 'Fort' },
  { id: 'aura', name: 'Aura' },
  { id: 'send', name: 'Send' },
  { id: 'damage', name: 'Damage' },
];

/**
 * Fortress ladders the Fort tab exposes, in display order.
 *
 * `unit` is what the next level's number MEANS - a price with no unit on the
 * other side of the arrow is a number you cannot compare to anything.
 */
const FORT_UPGRADES: { id: string; name: string; unit: string }[] = [
  { id: 'weapon', name: 'Weapon', unit: ' dmg' },
  { id: 'hp', name: 'Fortress HP', unit: ' hp' },
  { id: 'regen', name: 'Regeneration', unit: ' hp/s' },
  { id: 'gemOutput', name: 'Gem Output', unit: ' gems' },
  { id: 'gemRate', name: 'Gem Rate', unit: '× rate' },
  { id: 'auraStrength', name: 'Aura Power', unit: '' },
  { id: 'auraRadius', name: 'Aura Radius', unit: ' tiles' },
];

const AURAS: { id: AuraType; name: string }[] = [
  { id: 'damage', name: 'Damage' },
  { id: 'attackSpeed', name: 'Atk Spd' },
  { id: 'armour', name: 'Armour' },
  { id: 'regeneration', name: 'Regen' },
];

const MIN_TOUCH = 44;

/**
 * The narrowest a send button may be before the tab drops a column.
 *
 * Measured against its longest line: "Revenant · Raider's Haste" at nine
 * pixels is about 150, and the button pads eight either side.
 */
const MIN_SEND_WIDTH = 170;

/** Side margin of the selected-unit panel. */

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

  /**
   * `enabled` false dims the tab without taking it away: Build is the one tab
   * whose contents mean nothing during a wave (§3.1), and a tab that vanished
   * for thirty seconds and came back would be worse to aim at than one that is
   * visibly asleep. It still opens - the panel behind it shows what a unit
   * costs, which is worth reading while you decide what to build next.
   */
  redraw(active: boolean, enabled = true): void {
    this.bg.clear();
    this.bg.roundRect(0, 0, this.w, this.h, 6).fill({ color: active ? UI.panelEdge : UI.buildBar });
    this.caption.style.fill = active ? UI.text : UI.textMuted;
    this.alpha = enabled ? 1 : 0.45;
    centreOn(this.caption, this.w / 2, this.h / 2 - 7);
  }
}

export class BuildBar extends Container {
  private readonly background = new Graphics();
  private readonly tabStrip = new Container();
  private readonly tabButtons: TabButton[] = [];
  private active: Tab = 'build';

  private readonly damagePanel: DamagePanel;
  private readonly panels: Record<Tab, Container>;

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
  private readonly fortButtons: { id: string; name: string; unit: string; button: GridButton }[] =
    [];
  private readonly supplyButton: GridButton;
  private readonly weaponButtons: { type: DamageType; button: GridButton }[] = [];
  private readonly auraButtons: { id: AuraType; button: GridButton }[] = [];

  private readonly sendButtons: { sendId: string; button: GridButton }[] = [];
  private readonly targetButtons: GridButton[] = [];
  private readonly randomButton: GridButton;
  /**
   * Which opponent the next send is aimed at.
   *
   * Held here rather than passed in because it is a property of the control,
   * not of the match: it survives switching tabs, and it is re-pointed only
   * when the chosen target is eliminated.
   */
  private sendTarget: string | null = null;
  /**
   * Spread sends across the living opponents instead of stacking them on one.
   *
   * A separate flag rather than a magic value in `sendTarget`, so the chosen
   * lane is remembered underneath it and turning Random off puts the player
   * back where they were.
   */
  private sendAtRandom = false;
  /** Which team each target chip currently stands for, in chip order. */
  private targetIds: (string | null)[] = [null, null, null];
  /**
   * Sends the player has armed, and the milliseconds left on each cooldown.
   *
   * Held here rather than in the simulation because it is a way of pressing
   * the button, not a rule of the game: what leaves this class is the same
   * `send` command a tap produces (§15.1). It keeps running while the player
   * is on another tab - `render` is called every frame whichever panel is
   * showing - because that is the whole point of arming it.
   */
  private readonly armed = new Map<string, number>();

  private readonly upgradePanel = new Container();
  /** Where each part of the selected-body panel goes (unitStats.ts). */
  private regions = panelRegions({ x: 0, y: 0, width: 0, height: 0 }, 0, 0);
  /** The panel's own box, kept so the regions can be recomputed per body kind. */
  private panelBox = { bar: { x: 0, y: 0, width: 0, height: 0 }, top: 0, height: 0 };
  /** Whether the regions currently reserve a button row. */
  private panelHasButtons = true;
  /** Clips the ability text to its box, so it can never reach the buttons. */
  private readonly textMask = new Graphics();
  private readonly upgradeTitle: Text;
  private readonly upgradeSubtitle: Text;
  /** One `name  value` pair per cell of the stat block, in reading order. */
  private readonly statCells: { name: Text; value: Text }[] = [];
  private readonly traitText: Text;
  private readonly upgradeButton: GridButton;
  private readonly sellButton: GridButton;
  private selectedUnitId: number | null = null;

  constructor(
    layout: LaneLayout,
    private readonly data: GameData,
    private readonly handlers: BuildBarHandlers,
  ) {
    super();

    this.damagePanel = new DamagePanel(data, (unitId) => handlers.onSelectPlacedUnit(unitId));
    this.panels = {
      build: new Container(),
      tech: new Container(),
      fort: new Container(),
      aura: new Container(),
      send: new Container(),
      damage: this.damagePanel,
    };

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
      this.fortButtons.push({ id: up.id, name: up.name, unit: up.unit, button });
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
    // are hidden when there are fewer. The fourth is Random, which always
    // exists because it is not about any particular opponent.
    for (let slot = 0; slot < 3; slot++) {
      const button = new GridButton(() => {
        const teamId = this.targetIds[slot];
        if (teamId) {
          this.sendTarget = teamId;
          this.sendAtRandom = false;
        }
      });
      this.targetButtons.push(button);
      this.panels.send.addChild(button);
    }
    this.randomButton = new GridButton(() => (this.sendAtRandom = !this.sendAtRandom));
    this.targetButtons.push(this.randomButton);
    this.panels.send.addChild(this.randomButton);

    for (const send of data.sends.sends) {
      const button = new GridButton(
        () => this.sendOnce(send.id),
        () => this.toggleArmed(send.id),
      );
      this.sendButtons.push({ sendId: send.id, button });
      this.panels.send.addChild(button);
    }

    this.upgradeTitle = label('', 13, UI.text, '700');
    this.upgradeSubtitle = label('', 9, UI.textMuted);
    this.traitText = wrapped('', 10, UI.textMuted);
    for (let i = 0; i < STAT_CELLS.length; i++) {
      const cell = { name: label('', 9, UI.textMuted), value: label('', 10, UI.text, '600') };
      this.statCells.push(cell);
      this.upgradePanel.addChild(cell.name, cell.value);
    }
    this.upgradeButton = new GridButton(() => {
      if (this.selectedUnitId !== null) this.handlers.onUpgrade(this.selectedUnitId);
    });
    this.sellButton = new GridButton(() => {
      if (this.selectedUnitId !== null) this.handlers.onSell(this.selectedUnitId);
    });
    this.traitText.mask = this.textMask;
    this.upgradePanel.addChild(
      this.upgradeTitle,
      this.upgradeSubtitle,
      this.textMask,
      this.traitText,
      this.upgradeButton,
      this.sellButton,
    );

    this.everyButton = [
      ...this.unitButtons,
      ...this.techButtons.map((t) => t.button),
      ...this.fortButtons.map((f) => f.button),
      this.supplyButton,
      ...this.weaponButtons.map((w) => w.button),
      ...this.auraButtons.map((a) => a.button),
      ...this.targetButtons,
      ...this.sendButtons.map((s) => s.button),
      this.upgradeButton,
      this.sellButton,
    ];

    this.addChild(
      this.background,
      this.tabStrip,
      this.panels.build,
      this.panels.tech,
      this.panels.fort,
      this.panels.aura,
      this.panels.send,
      this.panels.damage,
      this.upgradePanel,
    );
    this.setLayout(layout);
  }

  /**
   * How long an armed send waits between shots, in milliseconds.
   *
   * Half a second, as asked. Slow enough that a full purse does not empty in
   * one frame, fast enough that arming it is genuinely less work than tapping.
   */
  private static readonly ARMED_COOLDOWN_MS = 500;

  /** New match: nothing is armed and nobody is targeted. */
  reset(): void {
    this.armed.clear();
    this.sendAtRandom = false;
    this.sendTarget = null;
  }

  /** One send, now, at whoever is selected. Blinks so the tap is acknowledged. */
  private sendOnce(sendId: string): void {
    const target = this.resolveTarget();
    if (!target) return;
    this.handlers.onSend(sendId, target);
    this.blink(sendId);
  }

  /**
   * Arm or disarm a send (press and hold).
   *
   * Armed with the cooldown already expired, so the first shot leaves on the
   * next frame rather than half a second after the thumb comes off.
   */
  private toggleArmed(sendId: string): void {
    if (this.armed.has(sendId)) this.armed.delete(sendId);
    else this.armed.set(sendId, 0);
  }

  private blink(sendId: string): void {
    this.sendButtons.find((s) => s.sendId === sendId)?.button.flash();
  }

  /** Who the next send is aimed at: the chosen lane, or a living one at random. */
  private resolveTarget(): string | null {
    return pickSendTarget(
      this.opponents,
      this.sendTarget,
      this.sendAtRandom,
      // The renderer may use the wall clock and Math.random; the simulation may
      // not (§15.1). The command that leaves here names one concrete lane, so
      // the match stays deterministic whichever chip was lit.
      Math.random,
    );
  }

  /** The opponents from the last frame, for `resolveTarget` between renders. */
  private opponents: readonly OpponentView[] = [];

  /** Every button, so blinks and holds can be ticked without hunting for them. */
  private everyButton: GridButton[] = [];

  /**
   * Fire whatever is armed whose cooldown has run out and whose gems are
   * there.
   *
   * The purse is tracked locally across the loop, because `lane.economy` is
   * last tick's snapshot: two armed sends firing on one frame would both see
   * the same balance and the second would be refused. Spending it here keeps
   * the client's arithmetic and the simulation's in step.
   */
  private fireArmed(deltaMs: number, gems: number, canSend: boolean): void {
    if (this.armed.size === 0) return;
    if (!canSend) {
      this.armed.clear();
      return;
    }

    let purse = gems;
    for (const [sendId, left] of this.armed) {
      const next = Math.max(0, left - deltaMs);
      this.armed.set(sendId, next);
      if (next > 0) continue;

      const cost = this.data.sends.sends.find((s) => s.id === sendId)?.gemCost ?? 0;
      if (purse < cost) continue;
      const target = this.resolveTarget();
      if (!target) continue;

      purse -= cost;
      this.handlers.onSend(sendId, target);
      this.blink(sendId);
      this.armed.set(sendId, BuildBar.ARMED_COOLDOWN_MS);
    }
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

    // Everything below is laid out inside the bar, so the bar's own left edge
    // is where it starts. In portrait that is zero; in landscape the bar is
    // the right-hand column and everything would otherwise be drawn off the
    // left of the screen.
    const left = bar.x + 6;
    const inner = bar.width - 12;

    // The tab strip: one row across a wide bar, two rows down a narrow one.
    // Six tabs across a 240-pixel landscape column would be forty pixels each,
    // and "Damage" does not fit in forty pixels.
    const tabGap = 4;
    const tabCols = l.orientation === 'landscape' ? 3 : TABS.length;
    const tabRows = Math.ceil(TABS.length / tabCols);
    const tabH = 26;
    const tabW = (inner - tabGap * (tabCols - 1)) / tabCols;
    this.tabButtons.forEach((button, i) => {
      button.layout(
        left + (i % tabCols) * (tabW + tabGap),
        bar.y + 3 + Math.floor(i / tabCols) * (tabH + tabGap),
        tabW,
        tabH,
      );
    });

    const stripH = tabRows * tabH + (tabRows - 1) * tabGap;
    const top = bar.y + stripH + 7;
    const height = bar.height - stripH - 12;

    // Panel grids. Upright the bar is wide and short, so the buttons go across
    // it; sideways it is narrow and tall, so they go down it. Same buttons,
    // same order, turned a quarter turn - which keeps a button in roughly the
    // place a player's thumb already expects it.
    const wide = l.orientation === 'portrait';
    const across = (items: GridButton[], portraitCols: number) => {
      const cols = wide ? portraitCols : 2;
      grid(items, cols, Math.ceil(items.length / cols), 6, left, top, inner, height);
    };

    across(this.unitButtons, 3);
    across(
      this.techButtons.map((t) => t.button),
      3,
    );
    across([...this.fortButtons.map((f) => f.button), this.supplyButton], 4);
    across(
      [...this.weaponButtons.map((w) => w.button), ...this.auraButtons.map((a) => a.button)],
      4,
    );

    // Send: the target chips, then the catalogue under them. The target has to
    // be visible while choosing what to throw, or picking one becomes a
    // separate step to forget. Four chips across a narrow column would be
    // sixty pixels each, so landscape puts them in two rows of two.
    const chipCols = l.orientation === 'landscape' ? 2 : 4;
    const chipRows = Math.ceil(this.targetButtons.length / chipCols);
    const chipH = 38 * chipRows + 6 * (chipRows - 1);
    grid(this.targetButtons, chipCols, chipRows, 6, left, top, inner, chipH);
    // Wide enough for what a send button has to say, rather than a fixed
    // count. The note line is "Revenant · Raider's Haste" - the monster and
    // what it does when it gets there (sends.ts) - and three across a portrait
    // phone cut both of them in half. Columns are chosen so each button clears
    // `MIN_SEND_WIDTH`, which is two across a phone, one down a landscape
    // column, and three on something genuinely wide.
    const sendCols = Math.max(1, Math.min(3, Math.floor(inner / MIN_SEND_WIDTH)));
    grid(
      this.sendButtons.map((s) => s.button),
      sendCols,
      Math.ceil(this.sendButtons.length / sendCols),
      6,
      left,
      top + chipH + 6,
      inner,
      height - chipH - 6,
    );

    this.damagePanel.layout(bar, top, height);

    // The selected-body panel replaces the Build grid. Its boxes come from
    // `panelRegions`, which SUBTRACTS the title, the stats and the buttons
    // from the panel and gives the ability text what is left - so the text can
    // never be the thing that runs into the buttons, whatever it has to say
    // and however short the screen is (unitStats.ts).
    this.panelBox = { bar, top, height };
    this.placePanel(this.panelHasButtons);
  }

  /**
   * Put the parts of the selected-body panel where its regions say.
   *
   * Called on resize and whenever the KIND of body changes, because a monster
   * has nothing to buy: its panel reserves no button row and the reading space
   * grows by a touch target. Cheap, and skipped entirely when neither has
   * changed.
   */
  private placePanel(hasButtons: boolean): void {
    const { bar, top, height } = this.panelBox;
    this.panelHasButtons = hasButtons;
    this.regions = panelRegions(bar, top, height, hasButtons);
    const r = this.regions;
    const column = r.stats.width / STAT_COLUMNS;

    this.upgradeTitle.position.set(r.title.x, r.title.y);
    // The type line is placed BESIDE the name, at render time, because where
    // it starts depends on how wide the name turned out to be.

    this.statCells.forEach((cell, i) => {
      const row = Math.floor(i / STAT_COLUMNS);
      const x = r.stats.x + (i % STAT_COLUMNS) * column;
      const y = r.stats.y + row * STAT_ROW_HEIGHT;
      cell.name.position.set(x, y + 1);
      cell.value.position.set(x + STAT_VALUE_INSET, y);
      // A row that did not fit is not drawn. On a short phone the last one -
      // Dmg/s and Move - gives way to the ability names, and Dmg/s is the two
      // cells above it multiplied together anyway (unitStats.ts).
      const fits = row < r.statRows;
      cell.name.visible = fits;
      cell.value.visible = fits;
    });

    this.traitText.position.set(r.text.x, r.text.y);
    this.traitText.style.wordWrapWidth = r.text.width;
    // Belt as well as braces. The fitting in `renderAbilityText` shrinks the
    // wording until it fits the box; the mask makes the box a hard edge, so a
    // string nobody anticipated is cut off rather than drawn over a button.
    this.textMask
      .clear()
      .rect(r.text.x, r.text.y, r.text.width, r.text.height)
      .fill({ color: 0xffffff });

    // Two buttons across the full width, now that Back is gone: tapping empty
    // space already puts the body down, which is what Back did and one fewer
    // thing to explain.
    const gap = 8;
    const actionWidth = (r.buttons.width - gap) / 2;
    this.upgradeButton.layout(r.buttons.x, r.buttons.y, actionWidth, MIN_TOUCH);
    this.sellButton.layout(r.buttons.x + actionWidth + gap, r.buttons.y, actionWidth, MIN_TOUCH);
  }

  render(
    view: MatchView,
    lane: LaneView,
    /**
     * The lane actually on screen, which is `lane` unless the player is
     * watching somebody else's (§12). Only the monster panel reads it: every
     * other thing in the bar is about your own wallet and your own board.
     */
    shown: LaneView,
    selection: Selection,
    summary: WaveSummary | null,
    deltaMs = 0,
  ): void {
    // Two windows, not one (apply.ts, `shopOpen` and `boardOpen`). THE BOARD -
    // placing, upgrading in place, selling back - is the build phase only: it
    // is what the wave is about to hit. THE SHOP - tech, the fortress ladders,
    // supply, the weapon type, the aura, sends - stays open through combat,
    // because none of it touches the line and a player with nothing to do for
    // the length of a fight is watching rather than playing. Both close when
    // the armies march (§3.3, replaced).
    const canShop = view.phase !== 'showdown';
    const canBuild = canShop && view.phase === 'build';
    // §13: out of the match means out of the shop, whatever the phase says.
    const alive = !view.eliminated;

    // Blinks and hold gestures run on wall time, on every button, whichever
    // panel is showing: a hold that stopped counting when the player looked
    // away would be a hold that never completed.
    for (const button of this.everyButton) button.animate(deltaMs);
    this.opponents = view.opponents;
    this.fireArmed(deltaMs, lane.economy?.gems ?? 0, canShop && alive && !view.finished);

    // A selected unit is a view of its own, belonging to no tab: none of them
    // is lit while it is up, and tapping any of them puts the unit down and
    // goes there. It used to live inside Build, so a unit tapped from any other
    // tab opened nothing and the tap that went looking for it threw the
    // selection away.
    const showing = activeView(this.active, selectsBody(selection));
    for (const button of this.tabButtons) {
      button.redraw(showing === button.id, button.id !== 'build' || (canBuild && alive));
    }

    this.upgradePanel.visible = showing === 'unit';
    this.panels.build.visible = showing === 'build';
    this.panels.tech.visible = showing === 'tech';
    this.panels.fort.visible = showing === 'fort';
    this.panels.aura.visible = showing === 'aura';
    this.panels.send.visible = showing === 'send';
    this.panels.damage.visible = showing === 'damage';

    // Before the wallet check below: the damage panel is the one thing here
    // that still reads once the fortress has fallen, and §13 lets a beaten
    // player stay and look at what happened.
    if (this.panels.damage.visible) {
      this.damagePanel.render(
        lane,
        view.wave,
        view.phase,
        selection?.kind === 'placedUnit' ? selection.unitId : null,
      );
    }

    // Before the wallet check, deliberately: a monster panel is read-only and
    // is exactly as useful in a lane you are watching as in your own.
    if (showing === 'unit' && selection?.kind === 'monster') {
      this.selectedUnitId = null;
      this.renderMonster(shown, selection.monsterId);
    }

    const economy = lane.economy;
    // The bar only ever shows your own lane, which always has a wallet. A lane
    // without one is somebody else's, and nothing here should be pointed at it.
    if (!economy) return;

    if (showing === 'unit' && selection?.kind === 'placedUnit') {
      this.selectedUnitId = selection.unitId;
      this.renderUpgrade(lane, economy, selection.unitId, canBuild && alive);
    } else {
      this.selectedUnitId = null;
    }

    if (this.panels.build.visible) {
      this.renderUnits(lane.builderId, economy, selection, summary, canBuild && alive);
    }
    if (this.panels.tech.visible) this.renderTech(economy, canShop && alive);
    if (this.panels.fort.visible) this.renderFort(economy, canShop && alive);
    if (this.panels.aura.visible) this.renderAura(lane, canShop && alive);
    if (this.panels.send.visible) this.renderSend(view, economy, canShop && alive);
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
      if (button === this.randomButton) return;
      const target = targets[slot];
      button.visible = target !== undefined;
      if (!target) return;

      this.targetIds[slot] = target.teamId;
      const fraction =
        target.fortressMaxHp > 0 ? Math.round((100 * target.fortressHp) / target.fortressMaxHp) : 0;

      button.setSwatch(null);
      button.update({
        // Who, not where, as on the tabs above the lane: a lane number tells
        // the player nothing about which opponent they are about to hit.
        title: target.name || laneName(target.teamId),
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
        selected: !this.sendAtRandom && this.sendTarget === target.teamId,
      });
    });

    // §11.5's default is to gang up on the leader, and Random is the other
    // shape of pressure: spread across every living lane without three taps
    // per send. It is always offered, because it is about the table rather
    // than about any one opponent.
    this.randomButton.visible = true;
    this.randomButton.setSwatch(null);
    this.randomButton.update({
      title: 'Random',
      detail: targets.length > 1 ? `of ${targets.length}` : 'any lane',
      note: this.sendAtRandom ? 'spreading' : '',
      noteColour: UI.accent,
      enabled: canAct && targets.length > 0,
      selected: this.sendAtRandom,
    });

    const gems = economy.gems;
    const aimed = this.resolveTarget() !== null;
    for (const { sendId, button } of this.sendButtons) {
      const def = this.data.sends.sends.find((s) => s.id === sendId);
      if (!def) continue;

      const cost = def.gemCost ?? 0;
      const income = def.incomeGranted ?? 0;
      const icon = sendIcon(this.data, sendId);
      const armed = this.armed.has(sendId);

      // The monster's own silhouette, its own name, and what it will do when it
      // arrives: a send delivers one of that monster (§11.5), and the shape
      // here is the shape that will be walking at somebody in thirty seconds
      // (sends.ts).
      button.setSwatch(icon ? icon.style : null);
      button.update({
        title: def.name,
        // §11.5: the income is the whole reason an early send is an investment
        // rather than an attack, so it is priced right next to the cost.
        // Sight belongs beside the price, not beside the monster: it is part
        // of what the gems buy (§12), where the monster's name and what it
        // does are what arrives in somebody's lane.
        detail: `${cost} gem → +${income}g/wave${def.grantsVision ? ' · sight' : ''}`,
        note: armed
          ? `auto · every ${(BuildBar.ARMED_COOLDOWN_MS / 1000).toFixed(1)}s`
          : icon
            ? [icon.monsterName, icon.abilityName].filter((part) => part !== null).join(' · ')
            : `${def.monsters.length}×`,
        noteColour: armed ? UI.accent : UI.textMuted,
        enabled: canAct && aimed && gems >= cost,
        // Dimmed when the gems are not there, but still able to take a HOLD:
        // arming a send you cannot yet afford is exactly the case auto-send is
        // for (gridButton.ts).
        interactive: canAct && aimed,
        selected: armed,
        selectedColour: UI.accent,
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
      button.setSwatch(glyphOf(def));
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

    for (const { id, name, unit, button } of this.fortButtons) {
      const ladder = ladders[id] ?? [];
      const level = economy.upgrades[id] ?? 0;
      const next = ladder.find((l) => l.level === level + 1);
      // §11.3 gives fortress upgrades to gems, but the two resource-building
      // ladders are bought with gold (§10.2, amended), so the button reads the
      // price off the level rather than assuming a currency.
      const gems = next?.gemCost ?? 0;
      const gold = next?.goldCost ?? 0;
      const supply = next?.supplyCost ?? 0;
      const price = gems > 0 ? `${gems} gem` : `${gold}g`;

      const gain = next?.value ?? null;
      button.setSwatch(null);
      button.update({
        title: name,
        detail: next ? `${price} → ${trim(gain)}${unit}${supply ? ` · ${supply}s` : ''}` : 'maxed',
        note: `level ${level}/${ladder.length}`,
        enabled:
          canAct &&
          next !== undefined &&
          economy.gems >= gems &&
          economy.gold >= gold &&
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
      // The same colour the ground is drawn in when this aura is running
      // (aura.ts), so the chip and the lane say the same thing.
      button.setSwatch(auraColour(id));
      // §10.1 sells strength and radius separately, so the chip says both:
      // otherwise Aura Power is a purchase with no visible consequence here.
      const strength = Math.round(lane.fortress.auraStrength * 100);
      button.update({
        title: meta?.name ?? id,
        detail: lane.fortress.auraRadius > 0 ? `r ${lane.fortress.auraRadius.toFixed(1)}` : 'aura',
        note: `+${strength}%`,
        noteColour: auraColour(id),
        enabled: canAct,
        selected: lane.fortress.activeAura === id,
      });
    }
  }

  /**
   * The selected unit: what it is, what it does, and the two ways to spend it.
   *
   * §7.3 upgrading happens in place - same tile, same identity - and §11
   * selling takes it off the board for what was paid. Both are shown together
   * because they are the same decision seen from two sides.
   */
  private renderUpgrade(
    lane: LaneView,
    economy: EconomyView,
    unitId: number,
    canAct: boolean,
  ): void {
    const index = lane.units.findIndex((u) => u.id === unitId);
    const unit = index < 0 ? undefined : lane.units[index];
    const current = unit ? this.data.units.units.find((u) => u.id === unit.defId) : undefined;
    const next = current?.upgradesTo
      ? this.data.units.units.find((u) => u.id === current.upgradesTo)
      : undefined;

    if (!this.panelHasButtons) this.placePanel(true);

    if (!current) {
      // Sold, or killed and not yet respawned. Nothing left to describe.
      this.setHeader('Unit lost', '');
      this.traitText.text = '';
      this.showStats(null, null);
      this.upgradeButton.visible = false;
      this.sellButton.visible = false;
      return;
    }

    // The name, and what it deals and is made of, on ONE line. The tier it is
    // about to become used to be here twice - "Vigil → Vigil II" over "Tier 1
    // → 2" - which spent two of the panel's lines telling a player that the
    // next Vigil is called Vigil II. The Upgrade button's pips say the tier
    // and the stat block says what the tier buys.
    this.setHeader(current.name, typeLine(current.damageType, current.armour));
    this.showStats(current, next ?? null);
    // What it DOES, which is most of why one unit is not another (§7, §18).
    // `traits` are the older, purely descriptive lines and are usually absent;
    // the ability lines are never absent, because every unit has an ability.
    const traits = current.traits ?? [];
    this.renderAbilityText(
      [...traits, ...abilityLines(this.data, current, next ?? null)],
      [...traits, ...briefAbilityLines(this.data, current, next ?? null)],
    );

    this.upgradeButton.visible = true;
    this.sellButton.visible = true;
    this.renderUpgradeButton(economy, next, canAct);
    this.renderSellButton(lane, index, canAct);
  }

  /**
   * The panel for a MONSTER: what it is, what it is made of, and what it does.
   *
   * There is nothing to buy here, so the two buttons are hidden and the text
   * gets their space - `panelRegions` is told there are no buttons and the
   * subtraction comes out differently, which is the whole reason the boxes are
   * computed rather than fixed.
   *
   * Abilities come from the definition, so a monster with none says so rather
   * than showing an empty block: "nothing special" is information, and a
   * player who has just tapped a Grub to find out has been answered.
   */
  private renderMonster(lane: LaneView, monsterId: number): void {
    const body = lane.monsters.find((m) => m.id === monsterId);
    const def = body
      ? [...this.data.monsters.monsters, ...this.data.monsters.bosses].find(
          (m) => m.id === body.defId,
        )
      : undefined;

    this.upgradeButton.visible = false;
    this.sellButton.visible = false;
    // Nothing to buy, so the button row is not reserved and the reading space
    // is a touch target taller (unitStats.ts, `panelRegions`).
    if (this.panelHasButtons) this.placePanel(false);

    if (!def) {
      // Killed while its panel was open, which happens constantly mid-wave.
      this.setHeader('Gone', '');
      this.traitText.text = '';
      this.showStats(null, null);
      return;
    }

    this.setHeader(def.name, typeLine(def.damageType, def.armour));
    this.showMonsterStats(def);
    const lines = monsterAbilityLines(this.data, def);
    this.renderAbilityText(lines, briefLines(lines));
  }

  /** Name on the left, what it deals and is made of immediately after it. */
  private setHeader(name: string, type: string): void {
    this.upgradeTitle.text = name;
    this.upgradeSubtitle.text = type;
    // Beside the name rather than under it, so the panel spends one line where
    // it used to spend two. `width` is only meaningful once the text has been
    // measured, which is why this is here and not in `setLayout`.
    this.upgradeSubtitle.position.set(
      this.regions.title.x + this.upgradeTitle.width + 8,
      this.regions.title.y + 5,
    );
  }

  /**
   * Put the ability text in its box, shrinking it until it fits.
   *
   * Four attempts, fullest first: the whole wording at ten pixels, at nine, at
   * eight, then names only. A short panel - a 360x640 phone leaves about thirty
   * pixels here - gets the names, which is still the useful half; a tall one
   * gets the sentences. Whatever is chosen, the mask set in `setLayout` is the
   * hard edge, so even an unfitted string stops at the box.
   */
  private renderAbilityText(full: string[], brief: string[]): void {
    const box = this.regions.text.height;
    const attempts: { lines: string[]; size: number }[] = [
      { lines: full, size: 10 },
      { lines: full, size: 9 },
      { lines: full, size: 8 },
      { lines: brief, size: 10 },
      { lines: brief, size: 9 },
    ];

    for (const [index, attempt] of attempts.entries()) {
      this.traitText.style.fontSize = attempt.size;
      this.traitText.text = attempt.lines.join('\n');
      // The last attempt is taken whether it fits or not: something legible
      // and clipped beats nothing at all.
      if (this.traitText.height <= box || index === attempts.length - 1) return;
    }
  }

  /** The same six cells, read off a monster definition. */
  private showMonsterStats(def: MonsterDef): void {
    this.statCells.forEach((cell, i) => {
      const meta = STAT_CELLS[i];
      if (!meta) {
        cell.name.text = '';
        cell.value.text = '';
        return;
      }
      cell.name.text = meta.name;
      cell.value.text = monsterStatText(meta.key, def);
    });
  }

  /** Fills the stat block. `next` null means there is no tier to compare to. */
  private showStats(current: UnitDef | null, next: UnitDef | null): void {
    this.statCells.forEach((cell, i) => {
      const meta = STAT_CELLS[i];
      if (!meta || !current) {
        cell.name.text = '';
        cell.value.text = '';
        return;
      }
      cell.name.text = meta.name;
      cell.value.text = statText(meta.key, current, next);
    });
  }

  private renderUpgradeButton(
    economy: EconomyView,
    next: UnitDef | undefined,
    canAct: boolean,
  ): void {
    this.upgradeButton.visible = true;
    if (!next) {
      // Shown but dead at the top of the ladder, rather than removed. A button
      // that vanishes leaves Sell sitting in a hole where it used to be, and
      // "max tier" is worth saying anyway - §7.3 gives different units
      // different ladder lengths, so where the top is is not obvious.
      this.upgradeButton.setSwatch(null);
      this.upgradeButton.update({ title: 'Upgrade', detail: 'max tier', enabled: false });
      return;
    }

    const gold = next.goldCost ?? 0;
    const supply = next.supplyCost ?? 0;
    // The body it becomes, not just its colour: the tier pips are the clearest
    // statement of what the button buys.
    this.upgradeButton.setSwatch(glyphOf(next));
    this.upgradeButton.update({
      title: 'Upgrade',
      detail: `${gold}g${supply ? ` · +${supply} supply` : ''}`,
      enabled: canAct && economy.gold >= gold && economy.supplyUsed + supply <= economy.supplyCap,
    });
  }

  /**
   * §11, decided: full price back inside the build phase that bought it, half
   * afterwards.
   *
   * The refund is computed with the simulation's own `sellValue` from the two
   * raw numbers the view carries, so the price on the button is the price the
   * command pays - there is no second copy of the rule to drift.
   */
  private renderSellButton(lane: LaneView, index: number, canAct: boolean): void {
    const spend = lane.unitSpend[index] ?? { thisPhase: 0, earlier: 0 };
    const refund = sellValue(this.data, spend);
    const paid = spend.thisPhase + spend.earlier;

    this.sellButton.visible = true;
    this.sellButton.setSwatch(null);
    this.sellButton.update({
      title: 'Sell',
      detail: `+${refund}g`,
      // Which rate applied, so a half refund never looks like a bug. "undo"
      // rather than "100%" because that is what the full rate is FOR.
      note: paid === 0 ? '' : spend.earlier === 0 ? 'undo · full' : `of ${paid}g`,
      noteColour: spend.earlier === 0 ? UI.healthGood : UI.textMuted,
      enabled: canAct,
    });
  }
}

function fortressLadders(data: GameData) {
  const f = data.fortress;
  return {
    weapon: f.weapon.upgrades,
    hp: f.hp.upgrades,
    regen: f.regen.upgrades,
    gemOutput: f.resourceBuilding.output.upgrades,
    gemRate: f.resourceBuilding.rate.upgrades,
    auraStrength: f.auras.strength.upgrades,
    auraRadius: f.auras.radius.upgrades,
  } as Record<string, ReturnType<() => GameData['fortress']['hp']['upgrades']>>;
}

/** "lane3" -> "Lane 3". The same shape the opponent tabs use. */
function laneName(teamId: string): string {
  const match = /(\d+)$/.exec(teamId);
  return match ? `Lane ${match[1]}` : teamId;
}

/** A ladder's next value, without a trailing `.0` on the whole ones. */
function trim(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '?';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** A unit as §14.2 draws it: armour shape, damage colour, tier size and pips. */
function glyphOf(def: UnitDef): EntityStyle {
  return {
    shape: def.shape,
    damageType: def.damageType,
    tier: def.tier,
    // Solid, because it is one of yours (§14.2). Monsters are the outlines.
    outlined: false,
  };
}

/** Lay buttons out in a fixed grid, left to right then top to bottom. */
function grid(
  buttons: GridButton[],
  cols: number,
  rows: number,
  gap: number,
  /** The bar's own left edge. Zero in portrait; the right column's in landscape. */
  left: number,
  top: number,
  width: number,
  height: number,
): void {
  const w = (width - gap * (cols - 1)) / cols;
  const h = (height - gap * (rows - 1)) / rows;
  buttons.forEach((button, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    button.layout(left + col * (w + gap), top + row * (h + gap), w, Math.max(MIN_TOUCH, h));
  });
}
