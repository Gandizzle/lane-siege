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
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { Text } from 'pixi.js';
import type { LaneLayout } from '../layout.ts';
import { UI } from '../palette.ts';
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
  private readonly nameRow = new Container();
  private readonly nameBackground = new Graphics();
  private readonly nameLabel: Text;
  private readonly nameValue: Text;
  private readonly nameHint: Text;
  private readonly buttons: Button[] = [];
  private readonly footnote: Text;

  private playerName = '';
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
    this.nameLabel = label('You are', 10, UI.textMuted, '600');
    this.nameValue = label('', 15, UI.text, '700');
    this.nameHint = label('tap to change', 10, UI.textMuted);
    this.footnote = label('', 10, UI.textMuted);

    this.nameRow.eventMode = 'static';
    this.nameRow.cursor = 'pointer';
    this.nameRow.on('pointertap', () => this.handlers.onEditName());
    // Every child is made once and only ever repositioned. A rebuilt
    // interactive object never receives a tap (see the note at the top of
    // buildBar.ts), and rebuilding on every redraw is how that happens.
    this.nameRow.addChild(this.nameBackground, this.nameLabel, this.nameValue, this.nameHint);

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
      this.nameRow,
      ...this.buttons.map((b) => b.root),
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
  setState(playerName: string, online: boolean, tutorial: TutorialProgress, soloBest = 0): void {
    this.playerName = playerName;
    this.online = online;
    this.tutorial = tutorial;
    this.soloBest = soloBest;
    this.redraw();
  }

  setLayout(layout: LaneLayout): void {
    this.layout = layout;
    this.redraw();
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
    const rowY = top + (compact ? 40 : 52);
    this.nameBackground.clear();
    this.nameBackground
      .roundRect(rowX, rowY, rowWidth, 48, 10)
      .fill({ color: UI.panel })
      .stroke({ width: 1, color: UI.panelEdge });
    this.nameRow.hitArea = new Rectangle(rowX, rowY, rowWidth, 48);
    this.nameLabel.position.set(rowX + 14, rowY + 9);
    this.nameValue.text = this.playerName;
    this.nameValue.position.set(rowX + 14, rowY + 23);

    this.nameHint.position.set(rowX + rowWidth - this.nameHint.width - 14, rowY + 19);

    const buttonHeight = compact ? 52 : 62;
    const gap = compact ? 8 : 12;
    const firstY = rowY + 48 + (compact ? 14 : 26);

    // One column while it fits above the footnote; otherwise two, the things
    // this tab can do on the left and the things that need a server on the
    // right - six buttons will not go down a sideways phone.
    const count = this.buttons.length;
    const oneColumn = firstY + count * (buttonHeight + gap) + 30 <= l.height;
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
    for (const [index, button] of this.buttons.entries()) {
      button.enabled = !button.needsServer || this.online;
      const column = !oneColumn && button.needsServer ? 1 : 0;
      const slot = oneColumn
        ? index
        : this.buttons.slice(0, index).filter((b) => b.needsServer === button.needsServer).length;
      const x = blockX + column * (columnWidth + gap);
      const y = firstY + slot * (buttonHeight + gap);
      bottom = Math.max(bottom, y + buttonHeight + gap);

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
