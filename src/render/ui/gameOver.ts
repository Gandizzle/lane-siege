/**
 * End-of-match overlay. DESIGN.md §13.
 *
 * "Fortress HP reaching zero eliminates that player. Placement is locked in at
 * that moment." M2 is single player, so elimination simply ends the run and
 * offers another - the placement and spectate paths arrive with opponents at M4.
 */

import { Container, Graphics } from 'pixi.js';
import type { MatchState } from '../../sim/index.ts';
import type { LaneLayout } from '../layout.ts';
import { UI } from '../palette.ts';
import { centreOn, label } from './text.ts';
import { Rectangle } from 'pixi.js';

export class GameOver extends Container {
  private shown = false;

  constructor(
    private layout: LaneLayout,
    private readonly onRestart: () => void,
  ) {
    super();
    this.visible = false;
  }

  setLayout(layout: LaneLayout): void {
    this.layout = layout;
    this.shown = false;
  }

  render(state: MatchState, teamId: string): void {
    const team = state.teams.find((t) => t.id === teamId);
    const over = team?.eliminated === true;

    this.visible = over;
    if (!over || this.shown) return;

    // Static once shown: rebuilding this every frame would be pure waste.
    this.shown = true;
    this.removeChildren();

    const l = this.layout;
    const cx = l.screen.width / 2;

    const scrim = new Graphics();
    scrim.rect(0, 0, l.screen.width, l.screen.height).fill({ color: UI.background, alpha: 0.82 });
    this.addChild(scrim);

    this.addChild(centreOn(label('Fortress lost', 24, UI.text, '700'), cx, l.screen.height * 0.38));
    this.addChild(
      centreOn(
        label(`You held to wave ${state.wave}`, 13, UI.textMuted),
        cx,
        l.screen.height * 0.45,
      ),
    );

    const buttonY = l.screen.height * 0.53;
    const button = new Container();
    const g = new Graphics();
    g.roundRect(cx - 80, buttonY, 160, 44, 10).fill({ color: UI.accent });
    button.addChild(g);
    button.addChild(centreOn(label('Play again', 14, UI.background, '700'), cx, buttonY + 14));

    button.eventMode = 'static';
    button.cursor = 'pointer';
    button.hitArea = new Rectangle(cx - 80, buttonY, 160, 44);
    button.on('pointertap', () => {
      this.shown = false;
      this.visible = false;
      this.onRestart();
    });

    this.addChild(button);
  }
}
