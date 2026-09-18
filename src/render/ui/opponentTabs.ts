/**
 * The opponent tabs. DESIGN.md §4.1, §12, §13.
 *
 * §4.1 reserves the top band for these and §12 says what may go in them:
 * fortress HP, and whether that player is still alive. That is the whole public
 * record, and it is deliberately not much - you can see who is being worn down
 * and who is coasting, and nothing about how they are doing it.
 *
 * A tab is also a way in. Tapping one you can see inside switches the lane view
 * to that lane, which is §11.5's bought vision and §13's spectating using the
 * same control. Tapping one you cannot see does nothing except say so, which is
 * more useful than an unexplained dead button.
 *
 * Interactive objects are built once and only updated afterwards - see the note
 * at the top of buildBar.ts for what happens otherwise. Four tabs exist from
 * boot whether or not four lanes are in play.
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { Text } from 'pixi.js';
import type { MatchView, OpponentView } from '../../sim/index.ts';
import { ticksToSeconds } from '../../sim/index.ts';
import type { LaneLayout } from '../layout.ts';
import { UI } from '../palette.ts';
import { centreOn, fit, label } from './text.ts';

/** §2: four lanes. */
const SLOTS = 4;

/** One tab's height where there is room to choose it. Matches layout.ts. */
const TAB_ROW_HEIGHT = 30;

export interface OpponentTabHandlers {
  /** A tab the viewer can see inside was tapped. */
  onWatch(teamId: string): void;
  /** The "you" tab, or a tab already being watched, was tapped. */
  onWatchOwn(): void;
  /** A tab the viewer cannot see inside was tapped. */
  onBlocked(): void;
}

class OpponentTab extends Container {
  private readonly bg = new Graphics();
  private readonly bar = new Graphics();
  private readonly caption: Text;
  private readonly detail: Text;
  private w = 0;
  private h = 0;

  teamId: string | null = null;

  constructor(private readonly handlers: OpponentTabHandlers) {
    super();
    this.caption = label('', 10, UI.text, '700');
    this.detail = label('', 9, UI.textMuted, '600');
    this.addChild(this.bg, this.bar, this.caption, this.detail);

    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointertap', () => this.tapped());
  }

  private tapped(): void {
    if (this.teamId === null) {
      this.handlers.onWatchOwn();
      return;
    }
    if (this.watchable) this.handlers.onWatch(this.teamId);
    else this.handlers.onBlocked();
  }

  private watchable = false;

  layout(x: number, y: number, width: number, height: number): void {
    this.position.set(x, y);
    this.w = width;
    this.h = height;
    this.hitArea = new Rectangle(0, 0, width, height);
    this.caption.x = 6;
    this.caption.y = 3;
    this.detail.x = 6;
    this.detail.y = detailTop(this.caption.y, height);
  }

  /** `null` for the viewer's own lane, which is always shown first. */
  update(
    opponent: OpponentView | null,
    ownName: string,
    ownFraction: number,
    active: boolean,
  ): void {
    const eliminated = opponent?.eliminated ?? false;
    const fraction = opponent
      ? opponent.fortressMaxHp > 0
        ? opponent.fortressHp / opponent.fortressMaxHp
        : 0
      : ownFraction;

    this.teamId = opponent ? opponent.teamId : null;
    this.watchable = opponent ? opponent.watching : true;

    this.bg.clear();
    this.bg
      .roundRect(0, 0, this.w, this.h, 5)
      .fill({ color: active ? UI.panelEdge : UI.panel })
      .stroke({ width: 1, color: active ? UI.selected : UI.panelEdge });

    // The HP bar IS the tab: it is the one thing §12 makes public, so it gets
    // the space rather than a label.
    const barY = this.h - 6;
    const clamped = Math.max(0, Math.min(1, fraction));
    this.bar.clear();
    this.bar.rect(4, barY, this.w - 8, 3).fill({ color: UI.background });
    if (!eliminated) {
      this.bar
        .rect(4, barY, (this.w - 8) * clamped, 3)
        .fill({ color: clamped > 0.35 ? UI.healthGood : UI.healthLow });
    }

    // Who, not where. A lane number says nothing a player wants to know, and
    // the four tabs across the top are the only place anybody else's name
    // appears once the lobby is history. `shortName` is the fallback for a
    // seat nobody has named - a bot, or a player who never set one.
    const name = opponent ? opponent.name || shortName(opponent.teamId) : ownName;
    const fitted = fit(name, this.w - 8, this.caption.style.fontSize as number);
    if (this.caption.text !== fitted) this.caption.text = fitted;
    this.caption.style.fill = eliminated ? UI.textMuted : UI.text;

    // The second line says something only when there is something to say:
    // out and where they placed, or how long you can see inside. The HP
    // PERCENTAGE used to live here and does not need to - the bar under it is
    // the same number, read faster, and two of one fact is one too many.
    const detail = eliminated
      ? `out · ${ordinal(opponent?.placement ?? 0)}`
      : opponent
        ? opponent.watching
          ? watchingLabel(opponent)
          : ''
        : 'you';
    if (this.detail.text !== detail) this.detail.text = detail;
    this.detail.style.fill = opponent?.watching ? UI.accent : UI.textMuted;

    // Eliminated lanes are still tappable - §13 lets you watch a finished lane,
    // and there is nothing to hide once somebody is out.
    this.alpha = eliminated ? 0.6 : 1;
    centreOn(this.caption, this.w / 2, 3);
    centreOn(this.detail, this.w / 2, detailTop(this.caption.y, this.h));
  }
}

/**
 * Where a tab's second line sits: above the HP bar, and never up into the name.
 *
 * The bar is drawn at `height - 6` and a nine-pixel line is about eleven tall,
 * so an upright tab - thirty pixels, all of them spoken for - can only put the
 * two edge to edge. A landscape tab is eight pixels taller than it needs to be,
 * and spends two of them on a gap rather than leaving the tail of a `y` resting
 * on the bar. Pure, and out here where a test can reach it: the tab itself
 * cannot be constructed without a canvas.
 */
export function detailTop(captionY: number, height: number): number {
  const DETAIL_LINE = 11;
  const CAPTION_LINE = 10;
  const BAR_TOP = height - 6;
  return Math.max(captionY + CAPTION_LINE, BAR_TOP - DETAIL_LINE - 2);
}

/** What to call a seat nobody has named: where it sits, since that is all we know. */
function shortName(teamId: string): string {
  const match = /(\d+)$/.exec(teamId);
  return match ? `Lane ${match[1]}` : teamId;
}

function ordinal(placement: number): string {
  if (placement <= 0) return '—';
  const suffix = placement === 1 ? 'st' : placement === 2 ? 'nd' : placement === 3 ? 'rd' : 'th';
  return `${placement}${suffix}`;
}

function watchingLabel(opponent: OpponentView): string {
  // Spectating after elimination has no clock; bought vision does (§11.5).
  if (opponent.visionTicksLeft <= 0) return 'visible';
  return `${Math.ceil(ticksToSeconds(opponent.visionTicksLeft))}s`;
}

export class OpponentTabs extends Container {
  private readonly tabs: OpponentTab[] = [];

  constructor(layout: LaneLayout, handlers: OpponentTabHandlers) {
    super();
    for (let i = 0; i < SLOTS; i++) {
      const tab = new OpponentTab(handlers);
      this.tabs.push(tab);
      this.addChild(tab);
    }
    this.setLayout(layout);
  }

  setLayout(layout: LaneLayout): void {
    // From the layout, not computed here: the HUD places its rows against the
    // same rectangle, and the two of them working it out separately is how the
    // incoming-send notice ended up behind the tabs (layout.ts, `tabStrip`).
    const strip = layout.tabStrip;
    const gap = 4;

    // A row across a wide strip, a column down a tall one. Four tabs across a
    // 240-pixel landscape column would be sixty pixels each, which is not
    // enough for a name; down it they get the full width and there is height
    // to spare.
    if (layout.orientation === 'landscape') {
      const height = Math.min(TAB_ROW_HEIGHT + 8, (strip.height - gap * (SLOTS - 1)) / SLOTS);
      this.tabs.forEach((tab, i) => {
        tab.layout(strip.x, strip.y + i * (height + gap), strip.width, height);
      });
      return;
    }

    const width = (strip.width - gap * (SLOTS - 1)) / SLOTS;
    this.tabs.forEach((tab, i) => {
      tab.layout(strip.x + i * (width + gap), strip.y, width, strip.height);
    });
  }

  /** `watchingTeamId` is the lane currently on screen, or null for your own. */
  render(view: MatchView, watchingTeamId: string | null): void {
    const ownFraction =
      view.lane && view.lane.fortress.maxHp > 0
        ? view.lane.fortress.hp / view.lane.fortress.maxHp
        : 0;

    // Your own lane first, then the opponents in a stable order, so a tab does
    // not move under the player's thumb when somebody is eliminated.
    const ordered = [...view.opponents].sort((a, b) => a.teamId.localeCompare(b.teamId));

    this.tabs.forEach((tab, i) => {
      if (i === 0) {
        tab.visible = true;
        tab.update(
          null,
          view.teamName || shortName(view.teamId),
          ownFraction,
          watchingTeamId === null,
        );
        return;
      }
      const opponent = ordered[i - 1];
      tab.visible = opponent !== undefined;
      if (opponent) tab.update(opponent, '', 0, watchingTeamId === opponent.teamId);
    });
  }
}
