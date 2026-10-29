/**
 * Report a name: the other players in this match or lobby, a Report button
 * for each, and a second step that says what reporting does before it is
 * done. (docs/ARCHITECTURE.md, "Name reports")
 *
 * Reached from a lobby's seat card (straight to the second step, for that
 * player) and from the menu's "Report a name" (the list first). What a report
 * does, said on the card so nobody reports in the dark: this player stops
 * seeing the name at once, the server counts it, and a name reported by
 * several different players is hidden from everyone until it is checked.
 *
 * Built once and only repositioned, like every other card: a rebuilt button
 * never receives a tap (see the note at the top of buildBar.ts). A match has
 * three other seats at most, so three rows are made and reused.
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { Text } from 'pixi.js';
import type { WornBadge } from '../../sim/index.ts';
import type { LaneLayout } from '../layout.ts';
import { UI } from '../palette.ts';
import { BadgeRow } from './badgeRow.ts';
import { PanelButton } from './menu.ts';
import { fit, label, wrapped } from './text.ts';

/** Somebody whose name can be reported. */
export interface Reportable {
  /** Their seat's player id: a saved build's (`ghost:<id>`) is its player's. */
  playerId: string;
  /** The name they are showing. */
  name: string;
  badges: readonly WornBadge[];
  /** A saved build playing for them, rather than them. */
  recorded: boolean;
}

export interface ReportHandlers {
  onReport(who: Reportable): void;
  onClose(): void;
}

const PAD = 18;
const ROW_H = 46;
const ROWS = 3;

class ReportRow extends Container {
  private readonly bg = new Graphics();
  private readonly nameText: Text;
  private readonly note: Text;
  private readonly badges = new BadgeRow();
  readonly button: PanelButton;
  who: Reportable | null = null;

  constructor(onTap: (who: Reportable) => void) {
    super();
    this.nameText = label('', 14, UI.text, '700');
    this.note = label('', 10, UI.textMuted);
    this.button = new PanelButton('Report', () => {
      if (this.who) onTap(this.who);
    });
    this.addChild(this.bg, this.nameText, this.note, this.badges, this.button);
  }

  show(who: Reportable, width: number): void {
    this.who = who;
    this.bg.clear();
    this.bg
      .roundRect(0, 0, width, ROW_H, 10)
      .fill({ color: UI.panel })
      .stroke({ width: 1, color: UI.panelEdge });
    const buttonW = 86;
    const room = width - buttonW - 36;
    this.nameText.text = fit(who.name, room, 14);
    this.nameText.position.set(12, who.recorded ? 6 : 13);
    const badgeX = 12 + this.nameText.width + 6;
    const badgeW = this.badges.set(who.badges, 12);
    this.badges.visible = badgeX + badgeW <= room + 12;
    this.badges.position.set(badgeX, this.nameText.y + 4);
    this.note.visible = who.recorded;
    this.note.text = 'a saved build, playing for them';
    this.note.position.set(12, 26);
    this.button.place(width - buttonW - 8, 8, buttonW, ROW_H - 16);
    this.button.set('Report', 'plain');
  }
}

export class ReportCard extends Container {
  private readonly scrim = new Graphics();
  private readonly card = new Graphics();
  private readonly title: Text;
  private readonly body: Text;
  private readonly rows: ReportRow[] = [];
  private readonly confirm: PanelButton;
  private readonly cancel: PanelButton;
  private layout: LaneLayout;
  private people: Reportable[] = [];
  /** The second step: who is about to be reported. Null on the list. */
  private chosen: Reportable | null = null;

  constructor(
    layout: LaneLayout,
    private readonly handlers: ReportHandlers,
  ) {
    super();
    this.layout = layout;
    this.visible = false;
    this.title = label('', 18, UI.text, '700');
    this.body = wrapped('', 12, UI.textMuted);
    for (let i = 0; i < ROWS; i++) {
      const row = new ReportRow((who) => this.choose(who));
      this.rows.push(row);
    }
    this.confirm = new PanelButton('Report name', () => {
      if (this.chosen) this.handlers.onReport(this.chosen);
    });
    this.cancel = new PanelButton('Cancel', () => this.back());

    // A choice, made with the buttons: a tap beside the card closes it.
    this.scrim.eventMode = 'static';
    this.scrim.on('pointertap', () => this.handlers.onClose());
    this.card.eventMode = 'static';
    this.addChild(
      this.scrim,
      this.card,
      this.title,
      this.body,
      ...this.rows,
      this.confirm,
      this.cancel,
    );
  }

  get isOpen(): boolean {
    return this.visible;
  }

  /** The list: everybody else here whose name can be reported. */
  openList(people: readonly Reportable[]): void {
    this.people = people.slice(0, ROWS);
    this.chosen = null;
    this.visible = true;
    this.arrange();
  }

  /** Straight to the second step, for one player (a lobby's seat card). */
  openFor(who: Reportable): void {
    this.people = [];
    this.chosen = who;
    this.visible = true;
    this.arrange();
  }

  close(): void {
    this.visible = false;
  }

  setLayout(layout: LaneLayout): void {
    this.layout = layout;
    if (this.visible) this.arrange();
  }

  private choose(who: Reportable): void {
    this.chosen = who;
    this.arrange();
  }

  /** Cancel on the second step goes back to the list, if there was one. */
  private back(): void {
    if (this.chosen && this.people.length > 0) {
      this.chosen = null;
      this.arrange();
      return;
    }
    this.handlers.onClose();
  }

  private arrange(): void {
    const screen = this.layout.screen;
    const w = Math.min(screen.width - 32, 360);
    const inner = w - PAD * 2;
    const x = Math.round((screen.width - w) / 2);

    const confirming = this.chosen !== null;
    this.title.text = confirming
      ? fit(`Report "${this.chosen!.name}"?`, inner, 18)
      : 'Report a name';
    this.body.text = confirming
      ? 'You stop seeing this name now. When several players report the same name, ' +
        'it is hidden from everyone until it has been checked. Report names, not ' +
        'how somebody plays.'
      : this.people.length > 0
        ? 'Pick the name you think nobody should have to see.'
        : 'There is nobody else here whose name can be reported.';
    this.body.style.wordWrapWidth = inner;

    const listH = confirming ? 0 : this.people.length * (ROW_H + 8);
    const h = PAD + 30 + this.body.height + 14 + listH + 44 + PAD;
    const y = Math.round(Math.max(8, (screen.height - h) / 2));

    this.scrim.clear();
    this.scrim.rect(0, 0, screen.width, screen.height).fill({ color: UI.background, alpha: 0.78 });
    this.scrim.hitArea = new Rectangle(0, 0, screen.width, screen.height);
    this.card.clear();
    this.card
      .roundRect(x, y, w, h, 14)
      .fill({ color: UI.buildBar })
      .stroke({ width: 1, color: UI.panelEdge });
    this.card.hitArea = new Rectangle(x, y, w, h);

    let ty = y + PAD;
    this.title.position.set(x + PAD, ty);
    ty += 30;
    this.body.position.set(x + PAD, ty);
    ty += this.body.height + 14;

    this.rows.forEach((row, i) => {
      const who = confirming ? undefined : this.people[i];
      row.visible = who !== undefined;
      if (!who) return;
      row.position.set(x + PAD, ty);
      row.show(who, inner);
      ty += ROW_H + 8;
    });

    const half = (inner - 10) / 2;
    if (confirming) {
      this.cancel.place(x + PAD, ty, half, 40);
      this.cancel.set('Cancel', 'plain');
      this.confirm.visible = true;
      this.confirm.place(x + PAD + half + 10, ty, half, 40);
      this.confirm.set('Report name', 'danger');
    } else {
      this.confirm.visible = false;
      this.cancel.place(x + PAD, ty, inner, 40);
      this.cancel.set('Close', 'plain');
    }
  }
}
