/**
 * The lobby. §17 (M6), §18.
 *
 * Four seats, because §2 says four lanes. Each shows who is in it, which roster
 * they brought (§7.1) and whether they are ready; yours is marked. The rules
 * behind it are in `src/net/lobby.ts` and the screen only draws what the server
 * sent, so what you see is what the room thinks - a client that decided for
 * itself whether the match was about to start would be wrong for the one tick
 * that matters.
 *
 * WHAT IT SAYS WHILE YOU WAIT
 *
 * A countdown, always. A lobby that says "waiting for players" and nothing else
 * gives a player no way to tell a room that is about to start from one that is
 * dead, and the answer to both is to stare at it. So the screen says when the
 * match will begin: the short wait once everyone present is ready, the long one
 * while somebody has not readied.
 *
 * Empty seats say so, and say what happens to them - they are played by the
 * game, not left as free wins for whoever is next to them. A player deciding
 * whether to wait for a fourth needs to know that.
 *
 * It redraws only when the lobby actually changes, which at twice a second it
 * does rarely. Redrawing every frame would also rebuild the buttons, and a
 * rebuilt interactive object never receives a tap (see the note at the top of
 * buildBar.ts).
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { Text } from 'pixi.js';
import type { GameData } from '../../data/schema.ts';
import { displayName } from '../../net/identity.ts';
import { PUBLIC_CODE, type LobbyView } from '../../net/lobby.ts';
import type { TransportStatus } from '../../net/transport.ts';
import type { LaneLayout } from '../layout.ts';
import { UI } from '../palette.ts';
import { centreOn, label } from './text.ts';

export interface LobbyHandlers {
  onReady(ready: boolean): void;
  /** Back to the picker, to bring a different roster (§7.1). */
  onChangeBuilder(): void;
  /** Leave the room entirely. */
  onLeave(): void;
}

export class LobbyScreen extends Container {
  private layout: LaneLayout;
  /** What was last drawn, so a repeated lobby message costs nothing. */
  private signature = '';

  constructor(
    layout: LaneLayout,
    private readonly data: GameData,
    private readonly handlers: LobbyHandlers,
  ) {
    super();
    this.layout = layout;
    this.visible = false;
  }

  setLayout(layout: LaneLayout): void {
    this.layout = layout;
    this.signature = '';
  }

  /** Leaving the lobby: forget what was drawn so the next one draws fresh. */
  reset(): void {
    this.signature = '';
    this.visible = false;
    this.removeChildren();
  }

  /**
   * `lobby` is null for the moment between asking for a room and hearing back,
   * and for as long as that takes when the server is not there at all. Both say
   * so on screen, with a way out - a player staring at a room that will never
   * answer needs a Leave button more than anyone.
   */
  render(lobby: LobbyView | null, status: TransportStatus, detail: string | null): void {
    this.visible = true;
    const signature = JSON.stringify([lobby, status, detail, this.layout.screen.width]);
    if (signature === this.signature) return;
    this.signature = signature;
    this.removeChildren();

    const l = this.layout.screen;
    const cx = l.width / 2;

    const scrim = new Graphics();
    scrim.rect(0, 0, l.width, l.height).fill({ color: UI.background });
    scrim.eventMode = 'static';
    scrim.hitArea = new Rectangle(0, 0, l.width, l.height);
    this.addChild(scrim);

    if (!lobby) {
      const failed = status === 'error' || status === 'closed';
      this.addChild(
        centreOn(
          label(
            failed ? 'Could not join' : 'Finding a room…',
            20,
            failed ? UI.danger : UI.text,
            '700',
          ),
          cx,
          l.height * 0.4,
        ),
      );
      if (detail) {
        this.addChild(centreOn(label(detail, 11, UI.textMuted), cx, l.height * 0.4 + 32));
      }
      const width = Math.min(l.width - 32, 340);
      this.addChild(
        this.button((l.width - width) / 2, l.height * 0.5, width, 'Back', UI.panel, UI.text, () =>
          this.handlers.onLeave(),
        ),
      );
      return;
    }

    const you = lobby.seats[lobby.yourSeat];

    const heading = lobby.code === PUBLIC_CODE ? 'Quick match' : 'Private room';
    this.addChild(centreOn(label(heading, 22, UI.text, '700'), cx, l.height * 0.08));

    // The code is the thing one player reads out and three others type, so it
    // is drawn as big as the heading and spaced out, not as a subtitle.
    let y = l.height * 0.08 + 36;
    if (lobby.code !== PUBLIC_CODE) {
      this.addChild(centreOn(label([...lobby.code].join(' '), 28, UI.accent, '700'), cx, y));
      y += 38;
      this.addChild(centreOn(label('Share this code to fill the room', 10, UI.textMuted), cx, y));
      y += 22;
    } else {
      this.addChild(
        centreOn(label('Anyone looking for a match can land here', 10, UI.textMuted), cx, y),
      );
      y += 24;
    }

    const cardWidth = Math.min(l.width - 32, 340);
    const cardX = (l.width - cardWidth) / 2;
    const cardHeight = 52;

    for (const [index, seat] of lobby.seats.entries()) {
      this.addChild(this.seatCard(cardX, y, cardWidth, cardHeight, seat, index === lobby.yourSeat));
      y += cardHeight + 8;
    }

    y += 10;

    // Always a number. See the note at the top of this file.
    const waiting = lobby.seats.filter((s) => s.playerId && !s.ready).length;
    const countdown =
      waiting > 0
        ? `Starting in ${lobby.secondsLeft}s, or sooner if everyone is ready`
        : `Starting in ${lobby.secondsLeft}s`;
    this.addChild(centreOn(label(countdown, 11, UI.textMuted), cx, y));
    y += 26;

    if (status !== 'ready') {
      this.addChild(centreOn(label('Reconnecting…', 12, UI.danger, '700'), cx, y - 44));
    }

    const ready = you?.ready === true;
    this.addChild(
      this.button(
        cardX,
        y,
        cardWidth,
        ready ? 'Ready — tap to wait' : 'Ready',
        ready ? UI.panel : UI.accent,
        ready ? UI.text : UI.background,
        () => this.handlers.onReady(!ready),
      ),
    );
    y += 54;

    const half = (cardWidth - 10) / 2;
    this.addChild(
      this.button(cardX, y, half, 'Change roster', UI.panel, UI.text, () =>
        this.handlers.onChangeBuilder(),
      ),
      this.button(cardX + half + 10, y, half, 'Leave', UI.panel, UI.textMuted, () =>
        this.handlers.onLeave(),
      ),
    );
  }

  private seatCard(
    x: number,
    y: number,
    width: number,
    height: number,
    seat: LobbyView['seats'][number],
    yours: boolean,
  ): Container {
    const card = new Container();
    const background = new Graphics();
    background
      .roundRect(x, y, width, height, 10)
      .fill({ color: yours ? UI.panelEdge : UI.panel })
      .stroke({ width: yours ? 2 : 1, color: yours ? UI.selected : UI.panelEdge });
    card.addChild(background);

    const empty = seat.playerId === null;
    const name = displayName(seat.name, seat.playerId);
    const nameText = label(
      yours ? `${name} (you)` : name,
      14,
      empty ? UI.textMuted : UI.text,
      '700',
    );
    nameText.position.set(x + 14, y + 9);
    card.addChild(nameText);

    const builder = this.data.units.builders.find((b) => b.id === seat.builderId);
    const detail = empty
      ? 'Open — played by the game if nobody takes it'
      : !seat.connected
        ? 'Disconnected — their seat is held'
        : (builder?.name ?? 'Choosing a roster');
    const detailText = label(detail, 10, seat.connected || empty ? UI.textMuted : UI.danger);
    detailText.position.set(x + 14, y + 29);
    card.addChild(detailText);

    if (!empty) {
      const state = seat.ready ? 'READY' : 'waiting';
      const tick = label(state, 10, seat.ready ? UI.healthGood : UI.textMuted, '700');
      tick.position.set(x + width - tick.width - 14, y + 21);
      card.addChild(tick);
    }

    return card;
  }

  private button(
    x: number,
    y: number,
    width: number,
    text: string,
    fill: number,
    textColour: number,
    onTap: () => void,
  ): Container {
    const button = new Container();
    const background = new Graphics();
    background
      .roundRect(x, y, width, 44, 10)
      .fill({ color: fill })
      .stroke({ width: 1, color: UI.panelEdge });
    const caption: Text = label(text, 13, textColour, '700');
    button.addChild(background, centreOn(caption, x + width / 2, y + 15));
    button.eventMode = 'static';
    button.cursor = 'pointer';
    button.hitArea = new Rectangle(x, y, width, 44);
    button.on('pointertap', onTap);
    return button;
  }
}
