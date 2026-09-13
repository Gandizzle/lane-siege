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
 *   - **Quick match** puts you in the next open room. Four players, first come
 *     first served.
 *   - **Private room** is a four-character code you say out loud. Whoever
 *     arrives first opens the room; the rest type the code.
 *
 * There is no room browser, no friends list and no invitations, because a
 * code covers all three for a game of four people and none of the machinery
 * needs a server-side account (identity.ts) that this version does not have.
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
import { centreOn, label } from './text.ts';

/** How a match is found. Chosen here, carried through the builder picker. */
export type MatchMode =
  { kind: 'practice' } | { kind: 'quick' } | { kind: 'private'; code: string };

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
      this.makeButton('Practice', 'One lane of yours, three played by the game', () =>
        this.handlers.onChoose({ kind: 'practice' }),
      ),
      this.makeButton('Quick match', 'The next open room, up to four players', () =>
        this.handlers.onChoose({ kind: 'quick' }),
      ),
      this.makeButton('Private room', 'Share a four-letter code with friends', () =>
        this.handlers.onPrivateRoom(),
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

  private makeButton(title: string, note: string, onTap: () => void): Button {
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

    return { root, background, title: titleText, note: noteText, enabled: true };
  }

  /** `online` is whether a server is configured at all (`?server=`). */
  setState(playerName: string, online: boolean): void {
    this.playerName = playerName;
    this.online = online;
    this.redraw();
  }

  setLayout(layout: LaneLayout): void {
    this.layout = layout;
    this.redraw();
  }

  private redraw(): void {
    const l = this.layout.screen;

    this.scrim.clear();
    this.scrim.rect(0, 0, l.width, l.height).fill({ color: UI.background });
    this.scrim.eventMode = 'static';
    this.scrim.hitArea = new Rectangle(0, 0, l.width, l.height);

    centreOn(this.heading, l.width / 2, l.height * 0.12);

    // The name sits under the title because it is the one thing on this screen
    // that other people will see.
    const rowWidth = Math.min(l.width - 32, 320);
    const rowX = (l.width - rowWidth) / 2;
    const rowY = l.height * 0.12 + 52;
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

    const buttonHeight = 62;
    const gap = 12;
    let y = rowY + 48 + 26;

    for (const [index, button] of this.buttons.entries()) {
      // Practice is index 0 and always available; the rest need a server.
      button.enabled = index === 0 || this.online;

      button.background.clear();
      button.background
        .roundRect(rowX, y, rowWidth, buttonHeight, 10)
        .fill({ color: index === 0 && !this.online ? UI.accent : UI.panel })
        .stroke({ width: 1, color: button.enabled ? UI.panelEdge : UI.panelEdge });
      button.root.hitArea = new Rectangle(rowX, y, rowWidth, buttonHeight);
      button.root.alpha = button.enabled ? 1 : 0.45;

      const onAccent = index === 0 && !this.online;
      button.title.style.fill = onAccent ? UI.background : UI.text;
      button.note.style.fill = onAccent ? UI.background : UI.textMuted;
      button.title.position.set(rowX + 16, y + 14);
      button.note.position.set(rowX + 16, y + 36);

      y += buttonHeight + gap;
    }

    this.footnote.text = this.online
      ? 'Playing on a server. A dropped connection keeps your lane for 90 seconds.'
      : 'Multiplayer needs a server: run npm run server and open with ?server=ws://host:2567';
    this.footnote.style.wordWrap = true;
    this.footnote.style.wordWrapWidth = rowWidth;
    this.footnote.style.align = 'center';
    centreOn(this.footnote, l.width / 2, y + 8);
  }
}
