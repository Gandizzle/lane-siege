/**
 * End-of-match overlay. DESIGN.md §13.
 *
 * "Fortress HP reaching zero eliminates that player. Placement is locked in at
 * that moment. An eliminated player may stay and spectate, or leave immediately
 * with no penalty."
 *
 * So this has three jobs, and the middle one is the reason it is not just a
 * Game Over screen: it reports the placement that was locked in, it offers to
 * stay and watch, and it offers another match. Staying is listed first because
 * §13 says nobody is held hostage - a player who wants to watch their killer
 * get killed should not have to be talked out of leaving first.
 *
 * It draws once per outcome rather than per frame: an overlay that rebuilds
 * itself sixty times a second would also rebuild its buttons, and a rebuilt
 * button never receives a tap (see the note at the top of buildBar.ts).
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { MatchView } from '../../sim/index.ts';
import type { LaneLayout } from '../layout.ts';
import { UI } from '../palette.ts';
import { centreOn, label } from './text.ts';

export interface GameOverHandlers {
  onRestart(): void;
  /** §13: stay and watch. The overlay closes; the match carries on. */
  onSpectate(): void;
}

/** What the overlay is currently showing, so it only redraws on a change. */
type Shown = 'none' | 'eliminated' | 'won' | 'finished';

export class GameOver extends Container {
  private shown: Shown = 'none';
  private dismissed = false;

  constructor(
    private layout: LaneLayout,
    private readonly handlers: GameOverHandlers,
  ) {
    super();
    this.visible = false;
  }

  setLayout(layout: LaneLayout): void {
    this.layout = layout;
    // Force a redraw at the new size.
    this.shown = 'none';
  }

  /** New match: clear the "I already dismissed this" memory. */
  reset(): void {
    this.shown = 'none';
    this.dismissed = false;
    this.visible = false;
    this.removeChildren();
  }

  render(view: MatchView): void {
    const outcome = classify(view);

    if (outcome === 'none' || this.dismissed) {
      this.visible = false;
      return;
    }

    this.visible = true;
    if (outcome === this.shown) return;
    this.shown = outcome;
    this.removeChildren();

    const l = this.layout;
    const cx = l.screen.width / 2;

    // The scrim swallows taps as well as light. Without an eventMode it is
    // decoration, and everything behind it - opponent tabs, the build grid -
    // stays live under what is meant to be a modal.
    const scrim = new Graphics();
    scrim.rect(0, 0, l.screen.width, l.screen.height).fill({ color: UI.background, alpha: 0.82 });
    scrim.eventMode = 'static';
    scrim.hitArea = new Rectangle(0, 0, l.screen.width, l.screen.height);
    this.addChild(scrim);

    const heading =
      outcome === 'won' ? 'Last one standing' : outcome === 'finished' ? 'Match over' : 'Fortress lost';
    this.addChild(
      centreOn(
        label(heading, 24, outcome === 'won' ? UI.accent : UI.text, '700'),
        cx,
        l.screen.height * 0.34,
      ),
    );

    // §13: placement is locked in at the moment of elimination, so it is a
    // fact about the match and not a guess made at the end.
    const place = view.placement;
    const detail =
      outcome === 'won'
        ? `You won at wave ${view.wave}`
        : place !== null
          ? `${ordinal(place)} place · held to wave ${view.wave}`
          : `You held to wave ${view.wave}`;
    this.addChild(centreOn(label(detail, 13, UI.textMuted), cx, l.screen.height * 0.41));

    let y = l.screen.height * 0.5;

    // Staying to watch only means anything while somebody else is still playing.
    const stillPlaying = view.opponents.some((o) => !o.eliminated);
    if (outcome === 'eliminated' && stillPlaying) {
      this.addChild(
        this.button(cx, y, 'Stay and watch', UI.accent, UI.background, () => {
          this.dismissed = true;
          this.visible = false;
          this.handlers.onSpectate();
        }),
      );
      y += 56;
    }

    this.addChild(
      this.button(cx, y, 'Play again', UI.panel, UI.text, () => {
        this.reset();
        this.handlers.onRestart();
      }),
    );
  }

  private button(
    cx: number,
    y: number,
    text: string,
    fill: number,
    textColour: number,
    onTap: () => void,
  ): Container {
    const button = new Container();
    const g = new Graphics();
    g.roundRect(cx - 90, y, 180, 44, 10)
      .fill({ color: fill })
      .stroke({ width: 1, color: UI.panelEdge });
    button.addChild(g, centreOn(label(text, 14, textColour, '700'), cx, y + 14));

    button.eventMode = 'static';
    button.cursor = 'pointer';
    button.hitArea = new Rectangle(cx - 90, y, 180, 44);
    button.on('pointertap', onTap);
    return button;
  }
}

function classify(view: MatchView): Shown {
  if (view.eliminated) return 'eliminated';
  // §13: the match ends when one team remains. Being that team is a win.
  if (view.finished) {
    return view.opponents.every((o) => o.eliminated) ? 'won' : 'finished';
  }
  return 'none';
}

function ordinal(placement: number): string {
  const suffix = placement === 1 ? 'st' : placement === 2 ? 'nd' : placement === 3 ? 'rd' : 'th';
  return `${placement}${suffix}`;
}
