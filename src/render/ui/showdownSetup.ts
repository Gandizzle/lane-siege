/**
 * Setting up a Final Showdown by hand. DESIGN.md §3.3, replaced.
 *
 * `npm run showdown` answers "which builder wins, on average, over six hundred
 * fights". It cannot answer "why did that happen", and neither can a number.
 * This is the other half of the same instrument: pick the armies the harness
 * would have picked, stand them in the same arena, and WATCH.
 *
 * It is set up in exactly the terms the harness uses - a builder, and a share
 * of the supply budget per rung - so a row in the report can be reproduced on
 * screen by typing it in. Same budget from `computeBudget`, same `realise`,
 * same placement by reach. Anything that made this easier to use at the cost of
 * matching the harness would make it a different experiment.
 *
 * Two or four seats, because a duel is where builder parity is actually settled
 * (a four-way is confounded by who converges on whom) and a four-way is what
 * the game ends with.
 *
 * TAP TO CYCLE, rather than a dropdown. There are four builders and twenty
 * builds and this is a phone; a list that has to be scrolled and dismissed is
 * more screen than the choice deserves, and cycling keeps every control one
 * tap from its neighbour.
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { Text } from 'pixi.js';
import type { GameData } from '../../data/schema.ts';
import { computeBudget } from '../../balance/budget.ts';
import {
  BUILD_SPECS,
  lineNames,
  realise,
  sharesLabel,
  type BuildSpec,
  type RungShares,
} from '../../balance/builds.ts';
import type { LaneLayout } from '../layout.ts';
import { UI } from '../palette.ts';
import { centreOn, label } from './text.ts';

/** One seat's army, in the terms the harness uses. */
export interface SeatSetup {
  builderId: string;
  /** The build it started from, for the name shown on the card. */
  specId: string;
  /** Live shares, which editing moves away from the preset. */
  shares: RungShares;
}

export interface ShowdownSetupHandlers {
  onPlay(seats: SeatSetup[]): void;
  onBack(): void;
}

const MIN_TOUCH = 44;
/** What one tap of + or - moves a rung's share by. */
const STEP = 0.05;

function defaultSeats(data: GameData): SeatSetup[] {
  const builders = data.units.builders.filter((b) => b.complete).map((b) => b.id);
  const design = BUILD_SPECS.find((s) => s.id === 'design') ?? BUILD_SPECS[0]!;
  return builders.map((builderId) => ({
    builderId,
    specId: design.id,
    shares: [...design.shares] as unknown as RungShares,
  }));
}

interface Tappable {
  root: Container;
  background: Graphics;
  hit: Rectangle;
}

export class ShowdownSetup extends Container {
  private readonly scrim = new Graphics();
  private readonly heading: Text;
  private readonly note: Text;
  private readonly countButtons: { button: Tappable; text: Text; count: number }[] = [];
  private readonly cards: {
    root: Container;
    background: Graphics;
    title: Text;
    detail: Text;
    rungs: Text;
    builderHit: Rectangle;
    buildHit: Rectangle;
    editHit: Rectangle;
  }[] = [];
  private readonly playButton: Tappable;
  private readonly playText: Text;
  private readonly backButton: Tappable;
  private readonly backText: Text;
  private readonly editor: RungEditor;

  private seats: SeatSetup[];
  private count = 4;
  private editing: number | null = null;

  constructor(
    private layout: LaneLayout,
    private readonly data: GameData,
    private readonly handlers: ShowdownSetupHandlers,
  ) {
    super();
    this.seats = defaultSeats(data);

    this.heading = label('Final Showdown', 22, UI.text, '700');
    this.note = label('', 10, UI.textMuted);

    for (const count of [2, 4]) {
      const button = this.makeTappable(() => {
        this.count = count;
        this.redraw();
      });
      const text = label(`${count} players`, 13, UI.text, '600');
      button.root.addChild(text);
      this.countButtons.push({ button, text, count });
    }

    // Four cards, made once. Two of them are hidden in a duel rather than
    // rebuilt: a rebuilt interactive object never receives a tap (buildBar.ts).
    for (let seat = 0; seat < 4; seat++) {
      const root = new Container();
      const background = new Graphics();
      const title = label('', 14, UI.text, '700');
      const detail = label('', 10, UI.textMuted);
      const rungs = label('', 9, UI.accent, '600');
      const builderHit = new Rectangle();
      const buildHit = new Rectangle();
      const editHit = new Rectangle();

      root.eventMode = 'static';
      root.cursor = 'pointer';
      root.on('pointertap', (event) => {
        const local = root.toLocal(event.global);
        if (builderHit.contains(local.x, local.y)) this.cycleBuilder(seat);
        else if (buildHit.contains(local.x, local.y)) this.cycleBuild(seat);
        else if (editHit.contains(local.x, local.y)) this.openEditor(seat);
      });
      root.addChild(background, title, detail, rungs);
      this.cards.push({ root, background, title, detail, rungs, builderHit, buildHit, editHit });
    }

    this.playButton = this.makeTappable(() => {
      this.handlers.onPlay(this.seats.slice(0, this.count).map((s) => ({ ...s })));
    });
    this.playText = label('Play', 16, UI.background, '700');
    this.playButton.root.addChild(this.playText);

    this.backButton = this.makeTappable(() => this.handlers.onBack());
    this.backText = label('Back', 13, UI.textMuted, '600');
    this.backButton.root.addChild(this.backText);

    this.editor = new RungEditor(layout, data, {
      onChange: (shares) => {
        if (this.editing === null) return;
        this.seats[this.editing] = { ...this.seats[this.editing]!, shares, specId: 'custom' };
        this.redraw();
      },
      onClose: () => {
        this.editing = null;
        this.editor.visible = false;
        this.redraw();
      },
    });
    this.editor.visible = false;

    this.addChild(
      this.scrim,
      this.heading,
      this.note,
      ...this.countButtons.map((c) => c.button.root),
      ...this.cards.map((c) => c.root),
      this.playButton.root,
      this.backButton.root,
      this.editor,
    );
    this.setLayout(layout);
  }

  private makeTappable(onTap: () => void): Tappable {
    const root = new Container();
    const background = new Graphics();
    const hit = new Rectangle();
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.on('pointertap', onTap);
    root.addChild(background);
    root.hitArea = hit;
    return { root, background, hit };
  }

  private cycleBuilder(seat: number): void {
    const ids = this.data.units.builders.filter((b) => b.complete).map((b) => b.id);
    const current = ids.indexOf(this.seats[seat]!.builderId);
    this.seats[seat] = { ...this.seats[seat]!, builderId: ids[(current + 1) % ids.length]! };
    this.redraw();
  }

  private cycleBuild(seat: number): void {
    const current = BUILD_SPECS.findIndex((s) => s.id === this.seats[seat]!.specId);
    const next = BUILD_SPECS[(current + 1) % BUILD_SPECS.length]!;
    this.seats[seat] = {
      ...this.seats[seat]!,
      specId: next.id,
      shares: [...next.shares] as unknown as RungShares,
    };
    this.redraw();
  }

  private openEditor(seat: number): void {
    this.editing = seat;
    this.editor.setShares(this.seats[seat]!.shares, this.seats[seat]!.builderId);
    this.editor.visible = true;
    this.redraw();
  }

  /** Start over from the presets, e.g. when the screen is opened afresh. */
  reset(): void {
    this.seats = defaultSeats(this.data);
    this.count = 4;
    this.editing = null;
    this.editor.visible = false;
    this.redraw();
  }

  setLayout(layout: LaneLayout): void {
    this.layout = layout;
    this.editor.setLayout(layout);
    this.redraw();
  }

  private redraw(): void {
    const l = this.layout.screen;
    const compact = this.layout.compact;

    this.scrim.clear();
    this.scrim.rect(0, 0, l.width, l.height).fill({ color: UI.background });
    this.scrim.eventMode = 'static';
    this.scrim.hitArea = new Rectangle(0, 0, l.width, l.height);

    const width = Math.min(l.width - 32, 380);
    const x = (l.width - width) / 2;
    const top = l.height * (compact ? 0.04 : 0.07);
    centreOn(this.heading, l.width / 2, top);

    // The budget every seat spends is the harness's, so what is set up here is
    // the same experiment the report ran.
    const budget = computeBudget(this.data);
    this.note.text = `Every army gets ${Math.round(budget.armyGold).toLocaleString('en-GB')} gold and ${budget.armySupply} supply`;
    this.note.style.wordWrap = true;
    this.note.style.wordWrapWidth = width;
    this.note.style.align = 'center';
    centreOn(this.note, l.width / 2, top + 30);

    let y = top + (compact ? 48 : 56);

    // 2 or 4.
    const half = (width - 8) / 2;
    for (const [i, entry] of this.countButtons.entries()) {
      const bx = x + i * (half + 8);
      const on = entry.count === this.count;
      entry.button.background.clear();
      entry.button.background
        .roundRect(bx, y, half, MIN_TOUCH, 8)
        .fill({ color: on ? UI.accent : UI.panel })
        .stroke({ width: 1, color: UI.panelEdge });
      entry.button.hit.x = bx;
      entry.button.hit.y = y;
      entry.button.hit.width = half;
      entry.button.hit.height = MIN_TOUCH;
      entry.text.style.fill = on ? UI.background : UI.text;
      centreOn(entry.text, bx + half / 2, y + (MIN_TOUCH - entry.text.height) / 2);
    }
    y += MIN_TOUCH + (compact ? 8 : 14);

    // The seats. Everything below the visible ones is parked off-screen rather
    // than destroyed.
    const cardHeight = compact ? 54 : 62;
    const byId = new Map(this.data.units.builders.map((b) => [b.id, b]));
    for (const [seat, card] of this.cards.entries()) {
      card.root.visible = seat < this.count;
      if (!card.root.visible) continue;

      const setup = this.seats[seat]!;
      const army = realise(
        this.data,
        setup.builderId,
        { id: setup.specId, name: setup.specId, shares: setup.shares },
        budget.armyGold,
        budget.armySupply,
      );
      const spec = BUILD_SPECS.find((s) => s.id === setup.specId);

      card.background.clear();
      card.background
        .roundRect(x, y, width, cardHeight, 10)
        .fill({ color: UI.panel })
        .stroke({ width: 1, color: UI.panelEdge });

      card.title.text = `${seat + 1}. ${byId.get(setup.builderId)?.name ?? setup.builderId}`;
      card.title.position.set(x + 12, y + 9);

      const shape = spec ? spec.name : sharesLabel(setup.shares);
      card.detail.text =
        `${shape}  ·  ${army.units.length} bodies, ${army.supplyUsed} supply` +
        (army.tilesShort > 0 ? `, ${army.tilesShort} would not fit` : '');
      card.detail.style.wordWrap = true;
      card.detail.style.wordWrapWidth = width - 24;
      card.detail.position.set(x + 12, y + 30);

      // Three tap zones across the card: the name changes the builder, the
      // middle changes the preset, and the right-hand edge opens the rungs.
      card.root.position.set(0, 0);
      card.root.hitArea = new Rectangle(x, y, width, cardHeight);
      card.builderHit.x = x;
      card.builderHit.y = y;
      card.builderHit.width = width * 0.45;
      card.builderHit.height = cardHeight;
      card.buildHit.x = x + width * 0.45;
      card.buildHit.y = y;
      card.buildHit.width = width * 0.3;
      card.buildHit.height = cardHeight;
      card.editHit.x = x + width * 0.75;
      card.editHit.y = y;
      card.editHit.width = width * 0.25;
      card.editHit.height = cardHeight;

      // The right-hand quarter is its own control, and it shows the shares as
      // six bars rather than as "10/10/15/15/25/25". The numbers are what the
      // editor is for; what the card needs is the SHAPE of the army, which a
      // row of bars gives at a glance and in a quarter of a phone's width.
      const edge = x + width * 0.75;
      card.background
        .moveTo(edge, y + 8)
        .lineTo(edge, y + cardHeight - 8)
        .stroke({ width: 1, color: UI.panelEdge });

      const chartX = edge + 14;
      const chartWidth = width * 0.25 - 28;
      const chartBottom = y + cardHeight - 18;
      const chartHeight = cardHeight - 34;
      const barWidth = chartWidth / 6 - 2;
      const peak = Math.max(...setup.shares, 1e-9);
      for (const [rung, share] of setup.shares.entries()) {
        const height = Math.max(2, (share / peak) * chartHeight);
        card.background
          .roundRect(chartX + rung * (barWidth + 2), chartBottom - height, barWidth, height, 1)
          .fill({ color: share > 0 ? UI.accent : UI.panelEdge });
      }
      card.rungs.text = 'rungs 1-6';
      card.rungs.position.set(edge + (width * 0.25 - card.rungs.width) / 2, chartBottom + 4);

      y += cardHeight + 8;
    }

    y += compact ? 4 : 10;

    this.playButton.background.clear();
    this.playButton.background.roundRect(x, y, width, MIN_TOUCH + 8, 10).fill({ color: UI.accent });
    this.playButton.hit.x = x;
    this.playButton.hit.y = y;
    this.playButton.hit.width = width;
    this.playButton.hit.height = MIN_TOUCH + 8;
    centreOn(this.playText, x + width / 2, y + (MIN_TOUCH + 8 - this.playText.height) / 2);
    y += MIN_TOUCH + 16;

    this.backButton.background.clear();
    this.backButton.background
      .roundRect(x, y, width, MIN_TOUCH, 10)
      .fill({ color: UI.panel })
      .stroke({ width: 1, color: UI.panelEdge });
    this.backButton.hit.x = x;
    this.backButton.hit.y = y;
    this.backButton.hit.width = width;
    this.backButton.hit.height = MIN_TOUCH;
    centreOn(this.backText, x + width / 2, y + (MIN_TOUCH - this.backText.height) / 2);
  }
}

interface RungEditorHandlers {
  onChange(shares: RungShares): void;
  onClose(): void;
}

/**
 * The six rungs, with a minus and a plus each.
 *
 * Shares are not normalised as they are edited - `realise` divides by the total
 * - so a tap never silently moves the other five rows. What the row shows is
 * the share as a percentage of the current total, which is what it will
 * actually be spent as.
 */
class RungEditor extends Container {
  private readonly scrim = new Graphics();
  private readonly panel = new Graphics();
  private readonly heading: Text;
  private readonly summary: Text;
  private readonly rows: { minus: Rectangle; plus: Rectangle; text: Text }[] = [];
  private readonly doneText: Text;
  private doneHit = new Rectangle();
  private shares: RungShares = [0, 0, 0, 0, 0, 0];
  private builderId = '';

  constructor(
    private layout: LaneLayout,
    private readonly data: GameData,
    private readonly handlers: RungEditorHandlers,
  ) {
    super();
    this.heading = label('Supply by rung', 15, UI.text, '700');
    this.summary = label('', 10, UI.textMuted);
    this.doneText = label('Done', 14, UI.background, '700');

    for (let rung = 0; rung < 6; rung++) {
      this.rows.push({
        minus: new Rectangle(),
        plus: new Rectangle(),
        text: label('', 12, UI.text),
      });
    }

    // A tap outside the panel closes it, the way the ability card does.
    this.scrim.eventMode = 'static';
    this.scrim.on('pointertap', () => this.handlers.onClose());
    this.panel.eventMode = 'static';
    this.panel.on('pointertap', (event) => {
      const local = this.panel.toLocal(event.global);
      if (this.doneHit.contains(local.x, local.y)) {
        this.handlers.onClose();
        return;
      }
      for (const [rung, row] of this.rows.entries()) {
        if (row.minus.contains(local.x, local.y)) return this.nudge(rung, -STEP);
        if (row.plus.contains(local.x, local.y)) return this.nudge(rung, STEP);
      }
    });

    this.addChild(
      this.scrim,
      this.panel,
      this.heading,
      this.summary,
      ...this.rows.map((r) => r.text),
      this.doneText,
    );
  }

  private nudge(rung: number, by: number): void {
    const next = [...this.shares] as number[];
    next[rung] = Math.max(0, Math.round((next[rung]! + by) * 100) / 100);
    // Never leave every rung at zero: an army of nothing is not a build, and
    // `realise` would divide by it.
    if (next.every((s) => s <= 0)) return;
    this.shares = next as unknown as RungShares;
    this.handlers.onChange(this.shares);
    this.redraw();
  }

  setShares(shares: RungShares, builderId: string): void {
    this.shares = [...shares] as unknown as RungShares;
    this.builderId = builderId;
    this.redraw();
  }

  setLayout(layout: LaneLayout): void {
    this.layout = layout;
    this.redraw();
  }

  private redraw(): void {
    const l = this.layout.screen;
    this.scrim.clear();
    this.scrim.rect(0, 0, l.width, l.height).fill({ color: 0x000000, alpha: 0.6 });
    this.scrim.hitArea = new Rectangle(0, 0, l.width, l.height);

    // Sideways there is less than half the height, and six rows at a full
    // touch target plus a heading, a summary and a button come to more than a
    // 412-tall screen has. The rows tighten rather than scroll: a panel that
    // has to be scrolled to reach its own Done button is worse than a row that
    // is eight pixels short.
    const compact = this.layout.compact;
    const rowHeight = compact ? 38 : MIN_TOUCH;
    const buttonSize = compact ? 30 : 34;
    const headingSpace = compact ? 38 : 48;
    const width = Math.min(l.width - 32, 340);
    const height = headingSpace + rowHeight * 6 + 22 + MIN_TOUCH + 20;
    const x = (l.width - width) / 2;
    const y = Math.max(8, (l.height - height) / 2);

    this.panel.clear();
    this.panel
      .roundRect(x, y, width, height, 12)
      .fill({ color: UI.panel })
      .stroke({ width: 1, color: UI.panelEdge });
    this.panel.hitArea = new Rectangle(x, y, width, height);

    centreOn(this.heading, l.width / 2, y + (compact ? 9 : 14));

    const names = lineNames(this.data, this.builderId);
    const total = this.shares.reduce((a, b) => a + b, 0);
    let rowY = y + headingSpace;
    for (const [rung, row] of this.rows.entries()) {
      const share = total > 0 ? this.shares[rung]! / total : 0;
      row.text.text = `${rung + 1}. ${names[rung] ?? ''}`.padEnd(2);
      row.text.position.set(x + 14, rowY + (rowHeight - row.text.height) / 2);

      const plusX = x + width - 14 - buttonSize;
      const minusX = plusX - buttonSize - 52;

      for (const [bx, glyph] of [
        [minusX, '−'],
        [plusX, '+'],
      ] as const) {
        this.panel
          .roundRect(bx, rowY + (rowHeight - buttonSize) / 2, buttonSize, buttonSize, 6)
          .fill({ color: UI.buildBar })
          .stroke({ width: 1, color: UI.panelEdge });
        void glyph;
      }

      // The two glyphs and the reading, drawn into the panel's graphics so the
      // editor keeps a fixed number of children however many rungs there are.
      this.panel
        .moveTo(minusX + 10, rowY + rowHeight / 2)
        .lineTo(minusX + buttonSize - 10, rowY + rowHeight / 2)
        .stroke({ width: 2, color: UI.text });
      this.panel
        .moveTo(plusX + 10, rowY + rowHeight / 2)
        .lineTo(plusX + buttonSize - 10, rowY + rowHeight / 2)
        .stroke({ width: 2, color: UI.text });
      this.panel
        .moveTo(plusX + buttonSize / 2, rowY + rowHeight / 2 - 7)
        .lineTo(plusX + buttonSize / 2, rowY + rowHeight / 2 + 7)
        .stroke({ width: 2, color: UI.text });

      row.text.text = `${rung + 1}. ${names[rung] ?? ''}   ${Math.round(share * 100)}%`;

      row.minus.x = minusX;
      row.minus.y = rowY;
      row.minus.width = buttonSize;
      row.minus.height = rowHeight;
      row.plus.x = plusX;
      row.plus.y = rowY;
      row.plus.width = buttonSize;
      row.plus.height = rowHeight;
      rowY += rowHeight;
    }

    // What the shares currently buy, updated on every tap, so the editor does
    // not have to be closed to find out whether a change was worth making.
    const budget = computeBudget(this.data);
    const army = realise(
      this.data,
      this.builderId,
      { id: 'custom', name: 'custom', shares: this.shares },
      budget.armyGold,
      budget.armySupply,
    );
    this.summary.text =
      `${army.units.length} bodies, ${army.supplyUsed}/${budget.armySupply} supply, ` +
      `${Math.round((army.goldSpent / budget.armyGold) * 100)}% of the gold` +
      (army.tilesShort > 0 ? `, ${army.tilesShort} would not fit` : '');
    this.summary.style.wordWrap = true;
    this.summary.style.wordWrapWidth = width - 28;
    this.summary.style.align = 'center';
    centreOn(this.summary, l.width / 2, rowY + 3);

    const doneY = rowY + 22;
    this.panel.roundRect(x + 14, doneY, width - 28, MIN_TOUCH, 8).fill({ color: UI.accent });
    this.doneHit = new Rectangle(x + 14, doneY, width - 28, MIN_TOUCH);
    centreOn(this.doneText, x + width / 2, doneY + (MIN_TOUCH - this.doneText.height) / 2);
  }
}

export type { BuildSpec };
