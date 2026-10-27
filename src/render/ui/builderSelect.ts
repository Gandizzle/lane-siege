/**
 * Choosing a builder. DESIGN.md §7.1, §6.1.
 *
 * §7.1 says four builders of six units each, and §6.1 says every one of them
 * fields all four damage types - so a builder is a complete package and the
 * choice is about DISTRIBUTION AND QUALITY, not about coverage. Which means the
 * card has to show the distribution, or the choice is a name and a color.
 *
 * So each card lists the roster's damage types with the strong ones marked. A
 * player who has never seen these rosters can still tell that Ashfall is the
 * Blast one and Verdance is the cheap one before committing to fifteen minutes
 * of it.
 *
 * DESIGN.md never says WHEN a builder is chosen. Before the match, because
 * §7.3's mark upgrades and §11.4's supply budget are both long-run commitments
 * to a roster - and because choosing mid-match would mean either stranding the
 * units already placed or letting a player cherry-pick the best unit of each
 * roster, which deletes the §6.1 choice entirely.
 *
 * One builder is everyone's from the start; the others are unlocked with the
 * keys every level pays (progression.json, keys) - in the Collection, or here.
 * A locked builder's card says what it costs, and choosing it turns Start into
 * Unlock: the unlock is its own tap, so keys are never spent by a player who
 * only meant to start a match.
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { Text } from 'pixi.js';
import type { BuilderDef, DamageType, GameData } from '../../data/schema.ts';
import { buildableUnits } from '../../data/roster.ts';
import type { LaneLayout } from '../layout.ts';
import { DAMAGE_COLORS, UI } from '../palette.ts';
import { centreOn, label, wrapped } from './text.ts';
import { GOLD, RichLabel, SUPPLY } from './currency.ts';
import { drawPadlock } from './collectionArt.ts';
import { keyCount } from '../../progression/cosmetics.ts';

/** Which builders are the player's, and the keys to unlock the rest (progression/store.ts). */
export interface BuilderLocks {
  owns(builderId: string): boolean;
  /** Keys it takes to unlock: none for the starter. */
  cost(builderId: string): number;
  keysLeft(): number;
  /** Spend the keys on it. False if they are not there. */
  unlock(builderId: string): boolean;
}

/** How much better than the roster's own average counts as a strength. */
const STRONG_MARGIN = 1.15;

/**
 * What a second unit of the same damage type is worth, against the first.
 *
 * §6.1 says builders differ by DISTRIBUTION, not coverage - so a roster with
 * two Pierce units is a Pierce roster even if neither is the hardest-hitting
 * unit in the game, because it can field Pierce at the front and at the back.
 * Peak damage alone called a roster built around two Impact and two Pierce
 * units "even across the four", which is exactly backwards.
 */
const SECOND_UNIT_WEIGHT = 0.45;

interface Profile {
  /** Damage types this roster fields, best first. */
  types: { type: DamageType; dps: number; strong: boolean }[];
  goldRange: [number, number];
  supplyRange: [number, number];
  rangeMax: number;
}

/**
 * What a roster is, read off its own numbers rather than written down twice.
 *
 * A summary in prose beside the data is a summary that goes stale the first
 * time somebody tunes a stat, so this is computed.
 */
function profile(data: GameData, builderId: string): Profile {
  const roster = buildableUnits(data, builderId);

  const byType = new Map<DamageType, number[]>();
  for (const unit of roster) {
    const dps = (unit.damage ?? 0) * (unit.attackSpeed ?? 0);
    byType.set(unit.damageType, [...(byType.get(unit.damageType) ?? []), dps]);
  }

  const scored = [...byType.entries()].map(([type, all]) => {
    const sorted = [...all].sort((a, b) => b - a);
    const dps = (sorted[0] ?? 0) + (sorted[1] ?? 0) * SECOND_UNIT_WEIGHT;
    return { type, dps };
  });

  const average = scored.reduce((sum, e) => sum + e.dps, 0) / Math.max(1, scored.length);
  const types = scored
    .map((entry) => ({ ...entry, strong: entry.dps >= average * STRONG_MARGIN }))
    .sort((a, b) => b.dps - a.dps);

  const gold = roster.map((u) => u.goldCost ?? 0);
  const supply = roster.map((u) => u.supplyCost ?? 0);

  return {
    types,
    goldRange: [Math.min(...gold), Math.max(...gold)],
    supplyRange: [Math.min(...supply), Math.max(...supply)],
    rangeMax: Math.max(...roster.map((u) => u.range ?? 0)),
  };
}

class BuilderCard extends Container {
  private readonly bg = new Graphics();
  private readonly swatches = new Graphics();
  private readonly lock = new Graphics();
  private readonly title: Text;
  private readonly cost: Text;
  private readonly note: Text;
  private readonly stats: RichLabel;
  private w = 0;
  private h = 0;
  /** Keys it takes to unlock, or null when it is the player's. */
  private locked: number | null = null;

  constructor(
    readonly builder: BuilderDef,
    private readonly summary: Profile,
    onTap: () => void,
  ) {
    super();
    this.title = label(builder.name, 15, UI.text, '700');
    this.cost = label('', 10, UI.level, '700');
    this.note = label('', 10, UI.textMuted, '600');
    this.stats = new RichLabel(10, UI.textMuted);
    this.addChild(this.bg, this.swatches, this.lock, this.title, this.cost, this.note, this.stats);

    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointertap', onTap);
  }

  layout(x: number, y: number, width: number, height: number): void {
    this.position.set(x, y);
    this.w = width;
    this.h = height;
    this.hitArea = new Rectangle(0, 0, width, height);

    this.bg.clear();
    this.bg
      .roundRect(0, 0, width, height, 10)
      .fill({ color: UI.panel })
      .stroke({ width: 1, color: UI.panelEdge });

    this.title.x = 14;
    this.title.y = 10;

    // A swatch per damage type, strong ones full height. Color is the same
    // channel the units themselves use (§14.2), so the card reads as a preview
    // of the line you are about to build.
    this.swatches.clear();
    const swatchWidth = 16;
    const gap = 5;
    let sx = width - 14 - (swatchWidth + gap) * this.summary.types.length + gap;
    for (const entry of this.summary.types) {
      const tall = entry.strong ? 18 : 9;
      this.swatches
        .roundRect(sx, 12 + (18 - tall), swatchWidth, tall, 2)
        .fill({ color: DAMAGE_COLORS[entry.type] });
      sx += swatchWidth + gap;
    }

    const strong = this.summary.types.filter((t) => t.strong).map((t) => t.type);
    this.note.text =
      strong.length > 0 ? `strongest: ${strong.join(' + ')}` : 'even across the four';
    this.note.x = 14;
    this.note.y = 34;

    const [minGold, maxGold] = this.summary.goldRange;
    const [minSupply, maxSupply] = this.summary.supplyRange;
    this.stats.set(
      `${GOLD}${minGold}–${maxGold} · ${SUPPLY}${minSupply}–${maxSupply} · ` +
        `reach ${this.summary.rangeMax.toFixed(1)}`,
      width - 28,
    );
    this.stats.x = 14;
    this.stats.y = 50;
    this.drawLock();
  }

  /** Locked for `cost` keys, or null for the player's own. */
  setLocked(cost: number | null): void {
    this.locked = cost;
    this.drawLock();
  }

  /** A padlock and the price after the name, on a builder still to unlock. */
  private drawLock(): void {
    this.lock.clear();
    this.cost.visible = this.locked !== null;
    if (this.locked === null) return;
    const x = this.title.x + this.title.width + 16;
    drawPadlock(this.lock, x, this.title.y + 12, UI.level);
    this.cost.text = keyCount(this.locked);
    this.cost.position.set(x + 12, this.title.y + 4);
  }

  setSelected(selected: boolean): void {
    this.bg.clear();
    this.bg
      .roundRect(0, 0, this.w, this.h, 10)
      .fill({ color: selected ? UI.panelEdge : UI.panel })
      .stroke({ width: selected ? 2 : 1, color: selected ? UI.selected : UI.panelEdge });
  }
}

/** A card's widest: on a desktop, a grid in the middle rather than bars from edge to edge. */
const CARD_MAX_WIDTH = 420;

export class BuilderSelect extends Container {
  private readonly scrim = new Graphics();
  private readonly heading: Text;
  private readonly subheading: Text;
  private readonly cards: BuilderCard[] = [];
  private readonly startButton = new Container();
  private readonly startLabel: Text;
  /** Back to wherever the picker was opened from: home, or a lobby. */
  private readonly backButton = new Container();
  private readonly backLabel: Text;
  /** Under the buttons, for a locked builder: what it takes. */
  private readonly hint: Text;
  private chosen: string;
  private startBox = { x: 0, y: 0, width: 0, height: 0 };
  /** The middle of the screen, which the hint is centred on. */
  private middle = 0;

  constructor(
    layout: LaneLayout,
    data: GameData,
    private readonly locks: BuilderLocks,
    private readonly onStart: (builderId: string) => void,
    private readonly onBack: () => void,
  ) {
    super();

    this.heading = label('Pick a builder', 22, UI.text, '700');
    this.subheading = label(
      'All four damage types, different strengths. Fixed for the match.',
      11,
      UI.textMuted,
    );
    this.startLabel = label('Start', 14, UI.background, '700');
    this.backLabel = label('Back', 14, UI.text, '700');
    this.hint = wrapped('', 11, UI.textMuted);
    this.hint.style.align = 'center';

    const builders = data.units.builders;
    this.chosen = (builders.find((b) => locks.owns(b.id)) ?? builders[0])?.id ?? '';

    for (const builder of builders) {
      const card = new BuilderCard(builder, profile(data, builder.id), () => {
        this.chosen = builder.id;
        this.refresh();
      });
      card.setLocked(locks.owns(builder.id) ? null : locks.cost(builder.id));
      this.cards.push(card);
    }

    this.startButton.eventMode = 'static';
    this.startButton.cursor = 'pointer';
    this.startButton.addChild(new Graphics(), this.startLabel);
    this.startButton.on('pointertap', () => this.tapStart());
    this.backButton.eventMode = 'static';
    this.backButton.cursor = 'pointer';
    this.backButton.addChild(new Graphics(), this.backLabel);
    this.backButton.on('pointertap', () => this.onBack());

    this.addChild(
      this.scrim,
      this.heading,
      this.subheading,
      ...this.cards,
      this.backButton,
      this.startButton,
      this.hint,
    );
    this.setLayout(layout);
  }

  /** Start the chosen builder - or, while it is locked, unlock it first. */
  private tapStart(): void {
    if (this.locks.owns(this.chosen)) {
      this.onStart(this.chosen);
      return;
    }
    if (this.locks.keysLeft() >= this.locks.cost(this.chosen)) this.locks.unlock(this.chosen);
    this.refresh();
  }

  setLayout(layout: LaneLayout): void {
    const l = layout.screen;

    this.scrim.clear();
    this.scrim.rect(0, 0, l.width, l.height).fill({ color: UI.background });
    this.scrim.eventMode = 'static';
    this.scrim.hitArea = new Rectangle(0, 0, l.width, l.height);

    const headTop = l.height * (layout.compact ? 0.05 : 0.1);
    centreOn(this.heading, l.width / 2, headTop);
    centreOn(this.subheading, l.width / 2, headTop + 34);

    // Four cards in one column on a phone held upright, two-by-two wherever
    // there is the width for it - sideways, or on a desktop - using the width
    // a short screen has instead of the height it does not (layout.ts,
    // `isCompact`). Never wider than `CARD_MAX_WIDTH`: on a big screen the
    // grid sits in the middle instead of stretching cards from edge to edge.
    const cardHeight = 74;
    const gap = 10;
    const top = headTop + 68;
    const cols = layout.compact || l.width >= 2 * 340 + gap + 32 ? 2 : 1;
    const rows = Math.ceil(this.cards.length / cols);
    const cardWidth = Math.min(CARD_MAX_WIDTH, (l.width - 32 - gap * (cols - 1)) / cols);
    const gridX = (l.width - (cardWidth * cols + gap * (cols - 1))) / 2;
    this.cards.forEach((card, i) => {
      card.layout(
        gridX + (i % cols) * (cardWidth + gap),
        top + Math.floor(i / cols) * (cardHeight + gap),
        cardWidth,
        cardHeight,
      );
    });

    // Back and Start side by side under the cards, Start the bigger.
    const buttonY = top + rows * (cardHeight + gap) + 16;
    const startWidth = 180;
    const backWidth = 110;
    const backX = (l.width - (backWidth + 12 + startWidth)) / 2;
    const startX = backX + backWidth + 12;

    const back = this.backButton.children[0] as Graphics;
    back.clear();
    back
      .roundRect(backX, buttonY, backWidth, 46, 10)
      .fill({ color: UI.panel })
      .stroke({ width: 1, color: UI.panelEdge });
    this.backButton.hitArea = new Rectangle(backX, buttonY, backWidth, 46);
    centreOn(this.backLabel, backX + backWidth / 2, buttonY + 15);

    this.startBox = { x: startX, y: buttonY, width: startWidth, height: 46 };
    this.startButton.hitArea = new Rectangle(startX, buttonY, startWidth, 46);
    this.hint.style.wordWrapWidth = Math.min(l.width - 32, 360);
    this.middle = l.width / 2;

    this.refresh();
  }

  /**
   * Redraw what depends on the player's keys and builders: called whenever the
   * picker is shown, since the Collection may have unlocked one meanwhile.
   */
  refresh(): void {
    for (const card of this.cards) {
      card.setSelected(card.builder.id === this.chosen);
      const id = card.builder.id;
      card.setLocked(this.locks.owns(id) ? null : this.locks.cost(id));
    }

    // Start, Unlock, or a locked builder there are not the keys for yet.
    const owned = this.locks.owns(this.chosen);
    const cost = this.locks.cost(this.chosen);
    const left = this.locks.keysLeft();
    const affordable = !owned && left >= cost;
    const { x, y, width, height } = this.startBox;
    const g = this.startButton.children[0] as Graphics;
    g.clear();
    g.roundRect(x, y, width, height, 10).fill({
      color: owned ? UI.accent : affordable ? UI.level : UI.panelEdge,
    });
    this.startLabel.text = owned ? 'Start' : affordable ? `Unlock · ${keyCount(cost)}` : 'Locked';
    this.startLabel.style.fill = owned || affordable ? UI.background : UI.textMuted;
    centreOn(this.startLabel, x + width / 2, y + 15);

    const name = this.cards.find((c) => c.builder.id === this.chosen)?.builder.name ?? '';
    this.hint.visible = !owned;
    this.hint.text = affordable
      ? `Unlocking ${name} spends ${keyCount(cost)} of your ${left}.`
      : `${name}: ${keyCount(cost)} to unlock, and you have ${left}. A key every level.`;
    centreOn(this.hint, this.middle, y + height + 12);
  }
}

/** Exported for the tests: what a card claims about a roster. */
export function builderProfile(data: GameData, builderId: string): Profile {
  return profile(data, builderId);
}

export type { Profile as BuilderProfile };
