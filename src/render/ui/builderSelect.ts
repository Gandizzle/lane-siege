/**
 * Choosing a builder. DESIGN.md §7.1, §6.1.
 *
 * §7.1 says four builders of six units each, and §6.1 says every one of them
 * fields all four damage types - so a builder is a complete package and the
 * choice is about DISTRIBUTION AND QUALITY, not about coverage. Which means the
 * card has to show the distribution, or the choice is a name and a colour.
 *
 * So each card lists the roster's damage types with the strong ones marked. A
 * player who has never seen these rosters can still tell that Ashfall is the
 * Blast one and Verdance is the cheap one before committing to fifteen minutes
 * of it.
 *
 * DESIGN.md never says WHEN a builder is chosen. Before the match, because
 * §7.3's tier upgrades and §11.4's supply budget are both long-run commitments
 * to a roster - and because choosing mid-match would mean either stranding the
 * units already placed or letting a player cherry-pick the best unit of each
 * roster, which deletes the §6.1 choice entirely.
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { Text } from 'pixi.js';
import type { BuilderDef, DamageType, GameData } from '../../data/schema.ts';
import type { LaneLayout } from '../layout.ts';
import { DAMAGE_COLOURS, UI } from '../palette.ts';
import { centreOn, label } from './text.ts';

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
  const roster = data.units.units.filter((u) => u.tier === 1 && u.builderId === builderId);

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
  private readonly title: Text;
  private readonly note: Text;
  private readonly stats: Text;
  private w = 0;
  private h = 0;

  constructor(
    readonly builder: BuilderDef,
    private readonly summary: Profile,
    onTap: () => void,
  ) {
    super();
    this.title = label(builder.name, 15, UI.text, '700');
    this.note = label('', 10, UI.textMuted, '600');
    this.stats = label('', 10, UI.textMuted);
    this.addChild(this.bg, this.swatches, this.title, this.note, this.stats);

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

    // A swatch per damage type, strong ones full height. Colour is the same
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
        .fill({ color: DAMAGE_COLOURS[entry.type] });
      sx += swatchWidth + gap;
    }

    const strong = this.summary.types.filter((t) => t.strong).map((t) => t.type);
    this.note.text = strong.length > 0 ? `strongest: ${strong.join(' + ')}` : 'even across the four';
    this.note.x = 14;
    this.note.y = 34;

    const [minGold, maxGold] = this.summary.goldRange;
    const [minSupply, maxSupply] = this.summary.supplyRange;
    this.stats.text =
      `${minGold}–${maxGold}g · ${minSupply}–${maxSupply} supply · ` +
      `reach ${this.summary.rangeMax.toFixed(1)}`;
    this.stats.x = 14;
    this.stats.y = 50;
  }

  setSelected(selected: boolean): void {
    this.bg.clear();
    this.bg
      .roundRect(0, 0, this.w, this.h, 10)
      .fill({ color: selected ? UI.panelEdge : UI.panel })
      .stroke({ width: selected ? 2 : 1, color: selected ? UI.selected : UI.panelEdge });
  }
}

export class BuilderSelect extends Container {
  private readonly scrim = new Graphics();
  private readonly heading: Text;
  private readonly subheading: Text;
  private readonly cards: BuilderCard[] = [];
  private readonly startButton = new Container();
  private readonly startLabel: Text;
  private chosen: string;

  constructor(
    layout: LaneLayout,
    data: GameData,
    private readonly onStart: (builderId: string) => void,
  ) {
    super();

    this.heading = label('Pick a builder', 22, UI.text, '700');
    this.subheading = label(
      'All four damage types, different strengths. Fixed for the match.',
      11,
      UI.textMuted,
    );
    this.startLabel = label('Start', 14, UI.background, '700');

    const builders = data.units.builders;
    this.chosen = builders[0]?.id ?? '';

    for (const builder of builders) {
      const card = new BuilderCard(builder, profile(data, builder.id), () => {
        this.chosen = builder.id;
        this.refresh();
      });
      this.cards.push(card);
    }

    this.startButton.eventMode = 'static';
    this.startButton.cursor = 'pointer';
    this.startButton.addChild(new Graphics(), this.startLabel);
    this.startButton.on('pointertap', () => this.onStart(this.chosen));

    this.addChild(this.scrim, this.heading, this.subheading, ...this.cards, this.startButton);
    this.setLayout(layout);
  }

  setLayout(layout: LaneLayout): void {
    const l = layout.screen;

    this.scrim.clear();
    this.scrim.rect(0, 0, l.width, l.height).fill({ color: UI.background });
    this.scrim.eventMode = 'static';
    this.scrim.hitArea = new Rectangle(0, 0, l.width, l.height);

    centreOn(this.heading, l.width / 2, l.height * 0.1);
    centreOn(this.subheading, l.width / 2, l.height * 0.1 + 34);

    const cardHeight = 74;
    const gap = 10;
    const top = l.height * 0.1 + 68;
    this.cards.forEach((card, i) => {
      card.layout(16, top + i * (cardHeight + gap), l.width - 32, cardHeight);
    });

    const buttonY = top + this.cards.length * (cardHeight + gap) + 16;
    const buttonWidth = 180;
    const buttonX = (l.width - buttonWidth) / 2;

    const g = this.startButton.children[0] as Graphics;
    g.clear();
    g.roundRect(buttonX, buttonY, buttonWidth, 46, 10).fill({ color: UI.accent });
    this.startButton.hitArea = new Rectangle(buttonX, buttonY, buttonWidth, 46);
    centreOn(this.startLabel, l.width / 2, buttonY + 15);

    this.refresh();
  }

  private refresh(): void {
    for (const card of this.cards) card.setSelected(card.builder.id === this.chosen);
  }
}

/** Exported for the tests: what a card claims about a roster. */
export function builderProfile(data: GameData, builderId: string): Profile {
  return profile(data, builderId);
}

export type { Profile as BuilderProfile };
