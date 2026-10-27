/**
 * The first screen: who you are, and which kind of match. §17 (M6), §18.
 *
 * DESIGN.md has no front end for matchmaking because §18 leaves it OPEN. Three
 * ways in, decided here and recorded in docs/OPEN-QUESTIONS.md:
 *
 *   - **Practice** is always offered and needs nothing but this device. It is
 *     what the shipped build serves (§15.2: static hosting cannot run a room),
 *     so the game is playable the moment it opens rather than being a menu
 *     waiting for a server.
 *   - **Solo** is one lane and nobody else (§3.3, solo): your sends land on
 *     you, and after the last wave an endless one, scored by what you kill.
 *     Also this device only, and its button carries the best score so far.
 *   - **Quick match** puts you in the next open room. Four players, first come
 *     first served.
 *   - **Private room** is a four-character code you say out loud. Whoever
 *     arrives first opens the room; the rest type the code.
 *
 * There is no room browser, no friends list and no invitations, because a
 * code covers all three for a game of four people and none of the machinery
 * needs a server-side account (identity.ts) that this version does not have.
 *
 * And a **Tutorial**, first in the list and lit for anybody who has not
 * finished a chapter of it yet, since a new player's first question is how to
 * play at all (ui/tutorialScreen.ts, src/tutorial).
 *
 * The two multiplayer buttons are drawn disabled rather than hidden when no
 * server is configured. Hiding them would leave a single-button menu that says
 * nothing about why; disabled with a reason underneath says what the game can
 * do and what it needs to do it.
 *
 * Under the ways to play, two more: your **Collection**, where the keys every
 * level pays unlock builders and cosmetics, and **Supporter**, the one thing
 * the game sells. Each dresses the part a little - the Collection wears a gold
 * tag with the count while there are keys to spend, the heart beats, and
 * Supporter says what it is worth, "+125% XP", under its name - because a
 * button nobody notices sells nothing, and neither is in the way of the
 * button that starts a match.
 *
 * And who you are, at the top: the name card (nameCard.ts), with the level
 * you have reached and how far it is to the next.
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { Text } from 'pixi.js';
import type { LaneLayout } from '../layout.ts';
import { UI } from '../palette.ts';
import { drawBadgeGlyph } from './levelBadge.ts';
import { NameCard, type NameCardState } from './nameCard.ts';
import { centreOn, fit, label } from './text.ts';

/** How a match is found. Chosen here, carried through the builder picker. */
export type MatchMode =
  | { kind: 'practice' }
  /**
   * §3.3, solo: one lane and nobody else. Every send comes back at you, and
   * after the last wave an endless one; the score is what you killed.
   */
  | { kind: 'solo' }
  | { kind: 'quick' }
  | { kind: 'private'; code: string }
  /**
   * §3.3, replaced: straight to the arena, with armies set up by hand.
   *
   * Not a way to play a match - there are no waves and no economy - but the
   * only way to WATCH the fight the balance report is made of. It needs no
   * server for the same reason Practice does not.
   */
  | { kind: 'showdown' }
  /** The chapter list (ui/tutorialScreen.ts), which starts matches of its own. */
  | { kind: 'tutorial' };

export interface HomeHandlers {
  onChoose(mode: MatchMode): void;
  /** Opens the name field; the screen redraws with whatever comes back. */
  onEditName(): void;
  /** Asks for a room code, then joins or opens that room. */
  onPrivateRoom(): void;
  onCollection(): void;
  onSupporter(): void;
}

/** What the home screen shows about the player's progress. */
export interface HomeProfile extends NameCardState {
  /** Has a Supporter's perks: bought, or as a Founder. */
  supporter: boolean;
  founder: boolean;
  /** What a Supporter earns on top in all, "125%": the button says it. */
  supporterBonus: string;
  /**
   * Builders and cosmetics unlocked, of how many; the keys there are; and
   * whether any of them would unlock something now.
   */
  collection: { unlocked: number; total: number; keys: number; canSpend: boolean };
}

interface Button {
  root: Container;
  background: Graphics;
  title: Text;
  note: Text;
  enabled: boolean;
  /** Quick match and Private room: nothing to do without a server. */
  needsServer: boolean;
  /** The note in full, before it is cut to the button's width. */
  noteText: string;
}

/** How far through the tutorial the player is, for its button's note. */
export interface TutorialProgress {
  done: number;
  total: number;
}

export class HomeScreen extends Container {
  private readonly scrim = new Graphics();
  private readonly heading: Text;
  private readonly nameCard: NameCard;
  private readonly buttons: Button[] = [];
  private readonly extras: ExtraButton[];
  private readonly footnote: Text;

  private profile: HomeProfile | null = null;
  private online = false;
  private tutorial: TutorialProgress = { done: 0, total: 0 };
  /** Most monsters killed in one solo match on this device, 0 for none yet. */
  private soloBest = 0;

  constructor(
    private layout: LaneLayout,
    private readonly handlers: HomeHandlers,
  ) {
    super();

    this.heading = label('Lane Siege', 26, UI.text, '700');
    this.footnote = label('', 10, UI.textMuted);

    // Every child is made once and only ever repositioned. A rebuilt
    // interactive object never receives a tap (see the note at the top of
    // buildBar.ts), and rebuilding on every redraw is how that happens.
    this.nameCard = new NameCard(() => this.handlers.onEditName());
    this.extras = [
      new ExtraButton('collection', 'Collection', () => this.handlers.onCollection()),
      new ExtraButton('supporter', 'Supporter', () => this.handlers.onSupporter()),
    ];

    this.buttons.push(
      this.makeButton('Tutorial', '', false, () => this.handlers.onChoose({ kind: 'tutorial' })),
      this.makeButton('Practice', 'One lane of yours, three played by the game', false, () =>
        this.handlers.onChoose({ kind: 'practice' }),
      ),
      this.makeButton('Solo', '', false, () => this.handlers.onChoose({ kind: 'solo' })),
      this.makeButton('Quick match', 'The next open room, up to four players', true, () =>
        this.handlers.onChoose({ kind: 'quick' }),
      ),
      this.makeButton('Private room', 'Share a four-letter code with friends', true, () =>
        this.handlers.onPrivateRoom(),
      ),
      this.makeButton('Final Showdown', 'Set up armies and watch them fight', false, () =>
        this.handlers.onChoose({ kind: 'showdown' }),
      ),
    );

    this.addChild(
      this.scrim,
      this.heading,
      this.nameCard,
      ...this.buttons.map((b) => b.root),
      ...this.extras,
      this.footnote,
    );
    this.setLayout(layout);
  }

  private makeButton(title: string, note: string, needsServer: boolean, onTap: () => void): Button {
    const root = new Container();
    const background = new Graphics();
    const titleText = label(title, 15, UI.text, '700');
    const noteText = label(note, 10, UI.textMuted);

    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.on('pointertap', () => {
      // Checked here rather than by clearing `eventMode`, so that a disabled
      // button still swallows the tap instead of letting it through to
      // whatever is behind it.
      const button = this.buttons.find((b) => b.root === root);
      if (button?.enabled) onTap();
    });
    root.addChild(background, titleText, noteText);

    return {
      root,
      background,
      title: titleText,
      note: noteText,
      enabled: true,
      needsServer,
      noteText: note,
    };
  }

  /** `online` is whether a server is configured at all (`?server=`). */
  setState(profile: HomeProfile, online: boolean, tutorial: TutorialProgress, soloBest = 0): void {
    this.profile = profile;
    this.online = online;
    this.tutorial = tutorial;
    this.soloBest = soloBest;
    this.redraw();
  }

  setLayout(layout: LaneLayout): void {
    this.layout = layout;
    this.redraw();
  }

  /** The beat of the heart. Nothing while hidden. */
  update(deltaMs: number): void {
    if (!this.visible) return;
    for (const extra of this.extras) extra.animate(deltaMs);
  }

  private redraw(): void {
    const l = this.layout.screen;
    // Sideways there is half the height. Everything still stacks - there are
    // only six things here - but the rhythm tightens so the footnote stays on
    // the screen (layout.ts, `isCompact`).
    const compact = this.layout.compact;
    const top = l.height * (compact ? 0.07 : 0.12);

    this.scrim.clear();
    this.scrim.rect(0, 0, l.width, l.height).fill({ color: UI.background });
    this.scrim.eventMode = 'static';
    this.scrim.hitArea = new Rectangle(0, 0, l.width, l.height);

    centreOn(this.heading, l.width / 2, top);

    // The name sits under the title because it is the one thing on this screen
    // that other people will see.
    const rowWidth = Math.min(l.width - 32, 320);
    const rowX = (l.width - rowWidth) / 2;
    const rowY = top + (compact ? 38 : 52);
    const cardH = NameCard.height(compact);
    this.nameCard.place(rowX, rowY, rowWidth, cardH);
    if (this.profile) this.nameCard.set(this.profile);

    const buttonHeight = compact ? 52 : 62;
    const gap = compact ? 8 : 12;
    const firstY = rowY + cardH + (compact ? 12 : 22);
    const extraH = compact ? 52 : 60;

    // One column while it fits above the footnote; otherwise two, the things
    // this tab can do on the left and the things that need a server on the
    // right - six buttons will not go down a sideways phone.
    const count = this.buttons.length;
    const oneColumn = firstY + count * (buttonHeight + gap) + extraH + gap + 30 <= l.height;
    const columnWidth = oneColumn ? rowWidth : Math.min((l.width - 32 - gap) / 2, 320);
    const blockX = oneColumn ? rowX : (l.width - (columnWidth * 2 + gap)) / 2;

    // The one lit button: the tutorial for somebody who has never finished a
    // chapter of it, and Practice after that. Lit only offline, where there is
    // no match to find, as before.
    const lit = this.online ? -1 : this.tutorial.done === 0 ? 0 : 1;
    const { done, total } = this.tutorial;
    this.buttons[0]!.noteText =
      done === 0
        ? `New here? Learn to play in ${total} short chapters`
        : done >= total
          ? 'All done. Replay any chapter for a refresher'
          : `${done} of ${total} chapters done. Carry on, or replay one`;
    // Solo's score is a tally, so its button carries the number to beat.
    this.buttons[2]!.noteText =
      this.soloBest > 0
        ? `Your best: ${this.soloBest.toLocaleString('en-GB')} monsters killed`
        : 'Sends come home, then a wave that never ends';

    let bottom = firstY;
    let rightBottom = firstY;
    for (const [index, button] of this.buttons.entries()) {
      button.enabled = !button.needsServer || this.online;
      const column = !oneColumn && button.needsServer ? 1 : 0;
      const slot = oneColumn
        ? index
        : this.buttons.slice(0, index).filter((b) => b.needsServer === button.needsServer).length;
      const x = blockX + column * (columnWidth + gap);
      const y = firstY + slot * (buttonHeight + gap);
      bottom = Math.max(bottom, y + buttonHeight + gap);
      if (column === 1) rightBottom = Math.max(rightBottom, y + buttonHeight + gap);

      const onAccent = index === lit;
      button.background.clear();
      button.background
        .roundRect(x, y, columnWidth, buttonHeight, 10)
        .fill({ color: onAccent ? UI.accent : UI.panel })
        .stroke({ width: 1, color: UI.panelEdge });
      button.root.hitArea = new Rectangle(x, y, columnWidth, buttonHeight);
      button.root.alpha = button.enabled ? 1 : 0.45;

      button.title.style.fill = onAccent ? UI.background : UI.text;
      button.note.style.fill = onAccent ? UI.background : UI.textMuted;
      button.title.position.set(x + 16, y + (compact ? 10 : 14));
      button.note.text = fit(button.noteText, columnWidth - 28, 10);
      button.note.position.set(x + 16, y + (compact ? 31 : 36));
    }

    // Collection and Supporter: a row under the ways to play, or - two
    // columns, sideways - in the room the right column has to spare, since the
    // left one is the longer. A small phone held upright gets two narrow
    // columns, too narrow for a row: there they stand one above the other in
    // that spare room, or failing that go under both columns.
    const n = this.extras.length;
    const beside = !oneColumn && (columnWidth - gap * (n - 1)) / n >= 84;
    const stacked = !oneColumn && !beside && rightBottom + n * (extraH + gap) <= bottom;
    const inRight = beside || stacked;
    const extrasW = oneColumn ? rowWidth : inRight ? columnWidth : columnWidth * 2 + gap;
    const extrasX = oneColumn ? rowX : inRight ? blockX + columnWidth + gap : blockX;
    const extrasY = inRight ? rightBottom : bottom;
    const each = stacked ? extrasW : (extrasW - gap * (n - 1)) / n;
    const p = this.profile;
    const c = p?.collection;
    // Keys waiting to be spent on something they would unlock: the tag says
    // how many. Keys with nothing to spend them on are just counted.
    const keys = c && c.keys > 0 ? `${c.keys} ${c.keys === 1 ? 'key' : 'keys'}` : '';
    this.extras[0]!.setNote(
      c?.canSpend
        ? `${keys} to spend`
        : keys
          ? `${keys} saved`
          : c
            ? `${c.unlocked} of ${c.total}`
            : '',
      c?.canSpend ? keys.toUpperCase() : null,
    );
    this.extras[1]!.setNote(
      p?.founder
        ? 'Founder · thank you!'
        : p?.supporter
          ? 'Thank you!'
          : p
            ? `+${p.supporterBonus} XP · no ads`
            : '',
      null,
      // Where the whole of it will not fit, what it is worth still does.
      p && !p.supporter ? `+${p.supporterBonus} XP` : undefined,
    );
    this.extras.forEach((extra, i) => {
      if (stacked) extra.place(extrasX, extrasY + i * (extraH + gap), each, extraH);
      else extra.place(extrasX + i * (each + gap), extrasY, each, extraH);
    });
    bottom = Math.max(bottom, extrasY + (stacked ? n : 1) * (extraH + gap));
    const y = bottom;

    this.footnote.text = this.online
      ? 'Playing on a server. A dropped connection keeps your lane for 90 seconds.'
      : 'Multiplayer needs a server: run npm run server and open with ?server=ws://host:2567';
    this.footnote.style.wordWrap = true;
    this.footnote.style.wordWrapWidth = oneColumn ? rowWidth : columnWidth * 2 + gap;
    this.footnote.style.align = 'center';
    centreOn(this.footnote, l.width / 2, y + 8);
  }
}

/**
 * A small button under the ways to play: the Collection, Supporter.
 *
 * Each has a drawn icon and is dressed for what it is: the Collection's edge
 * turns gold and a tag on its corner counts the keys while there are keys to
 * spend; Supporter's heart beats. Drawn every frame only in the few pixels
 * that move.
 */
class ExtraButton extends Container {
  private readonly bg = new Graphics();
  private readonly icon = new Graphics();
  private readonly ribbon = new Graphics();
  private readonly title: Text;
  private readonly note: Text;
  private readonly ribbonText: Text;
  private clock = 0;
  private noteText = '';
  /** The note cut short, for a button too narrow for all of it. */
  private shortNote = '';
  /** The tag on the corner, or null for none. */
  private tag: string | null = null;

  constructor(
    private readonly kind: 'collection' | 'supporter',
    caption: string,
    onTap: () => void,
  ) {
    super();
    this.title = label(caption, 13, UI.text, '700');
    this.note = label('', 9, UI.textMuted, '600');
    this.ribbonText = label('', 8, UI.background, '700');
    this.addChild(this.bg, this.icon, this.title, this.note, this.ribbon, this.ribbonText);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointertap', onTap);
  }

  setNote(text: string, tag: string | null, short = text): void {
    this.noteText = text;
    this.shortNote = short;
    this.tag = tag;
  }

  place(x: number, y: number, width: number, height: number): void {
    this.hitArea = new Rectangle(x, y, width, height);
    const edge = this.kind === 'supporter' ? UI.support : this.tag ? UI.level : UI.xp;
    this.bg.clear();
    this.bg
      .roundRect(x, y, width, height, 10)
      .fill({ color: UI.panel })
      .stroke({ width: this.kind === 'supporter' || this.tag ? 1.5 : 1, color: edge, alpha: 0.85 });

    // Icon above or beside the words, whichever the button has room for.
    const stacked = width < 120;
    const iconSize = Math.min(20, height * (stacked ? 0.3 : 0.4));
    const textX = stacked ? x + width / 2 : x + 12 + iconSize + 8;
    this.title.style.fontSize = width < 90 ? 11 : 13;
    const room = stacked ? width - 8 : width - (textX - x) - 6;
    const whole = fit(this.noteText, room, 9);
    this.note.text = whole === this.noteText ? whole : fit(this.shortNote, room, 9);
    if (stacked) {
      // Icon, name and note as one block, centred top to bottom.
      const block = iconSize + 4 + this.title.height + this.note.height - 2;
      const top = y + (height - block) / 2;
      this.iconAt = { cx: x + width / 2, cy: top + iconSize / 2, size: iconSize };
      centreOn(this.title, textX, top + iconSize + 4);
      centreOn(this.note, textX, top + iconSize + 2 + this.title.height);
    } else {
      this.title.position.set(textX, y + height / 2 - this.title.height + 2);
      this.note.position.set(textX, y + height / 2 + 2);
      this.iconAt = { cx: x + 12 + iconSize / 2, cy: y + height / 2, size: iconSize };
    }

    // The tag, across the top right corner.
    this.ribbon.clear();
    this.ribbonText.text = this.tag ?? '';
    this.ribbonText.visible = this.tag !== null;
    if (this.tag !== null) {
      const rw = this.ribbonText.width + 10;
      const rh = this.ribbonText.height + 2;
      this.ribbon
        .roundRect(x + width - rw - 4, y - rh / 2, rw, rh, rh / 2)
        .fill({ color: UI.level });
      this.ribbonText.position.set(x + width - rw + 1, y - rh / 2 + 1);
    }
    this.drawIcon();
  }

  private iconAt = { cx: 0, cy: 0, size: 0 };

  animate(deltaMs: number): void {
    this.clock += deltaMs / 1000;
    if (this.kind === 'supporter') this.drawIcon();
  }

  private drawIcon(): void {
    const g = this.icon;
    const { cx, cy, size } = this.iconAt;
    g.clear();
    if (size <= 0) return;
    if (this.kind === 'supporter') {
      // A heartbeat: two quick swells, then rest.
      const t = this.clock % 1.4;
      const beat = t < 0.15 ? t / 0.15 : t < 0.3 ? 1 - (t - 0.15) / 0.15 : 0;
      const beat2 =
        t >= 0.35 && t < 0.5 ? (t - 0.35) / 0.15 : t >= 0.5 && t < 0.65 ? 1 - (t - 0.5) / 0.15 : 0;
      const scale = 1 + 0.14 * Math.max(beat, beat2 * 0.7);
      drawBadgeGlyph(g, 'heart', cx, cy, size * scale, UI.support);
      return;
    }
    // The collection: four tiles, one of them gold.
    const t = size * 0.42;
    const gap = size * 0.12;
    const x0 = cx - t - gap / 2;
    const y0 = cy - t - gap / 2;
    const colors = [UI.xp, UI.level, UI.accent, UI.support];
    for (let i = 0; i < 4; i++) {
      const tx = x0 + (i % 2) * (t + gap);
      const ty = y0 + Math.floor(i / 2) * (t + gap);
      g.roundRect(tx, ty, t, t, t * 0.25).fill({ color: colors[i]! });
    }
  }
}
