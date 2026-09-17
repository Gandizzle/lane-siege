/**
 * "You are watching lane 3." DESIGN.md §11.5, §12, §13.
 *
 * One lane is on screen at a time (§14.1: fixed camera), so when it is not
 * yours that has to be unmistakable - otherwise the build grid appears to have
 * stopped responding, which is indistinguishable from the game being broken.
 *
 * It also carries the vision clock. Sight bought with a send is measured in
 * seconds (§11.5), and a countdown is the difference between the view snapping
 * back on you and the view snapping back for a reason.
 *
 * Doubles as the connection notice, because they occupy the same strip and are
 * never both true: you cannot be watching a lane you have not been sent yet.
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { Text } from 'pixi.js';
import { ticksToSeconds, type MatchView } from '../../sim/index.ts';
import type { TransportStatus } from '../../net/transport.ts';
import type { LaneLayout } from '../layout.ts';
import { UI } from '../palette.ts';
import { centreOn, label } from './text.ts';

export class WatchBanner extends Container {
  private readonly background = new Graphics();
  private readonly caption: Text;
  private readonly backButton = new Container();
  private readonly backLabel: Text;
  private layout: LaneLayout;

  constructor(layout: LaneLayout, onBack: () => void) {
    super();
    this.layout = layout;
    this.caption = label('', 11, UI.text, '700');
    this.backLabel = label('Back to my lane', 11, UI.background, '700');

    const chip = new Graphics();
    this.backButton.addChild(chip, this.backLabel);
    this.backButton.eventMode = 'static';
    this.backButton.cursor = 'pointer';
    this.backButton.on('pointertap', onBack);

    this.addChild(this.background, this.caption, this.backButton);
    this.setLayout(layout);
    this.visible = false;
  }

  setLayout(layout: LaneLayout): void {
    this.layout = layout;
    const strip = this.stripRect();

    this.background.clear();
    this.background
      .roundRect(strip.x, strip.y, strip.width, strip.height, 6)
      .fill({ color: UI.panel })
      .stroke({ width: 1, color: UI.accent });

    this.caption.x = strip.x + 10;
    this.caption.y = strip.y + 7;

    const chipWidth = this.backLabel.width + 18;
    const chipX = strip.x + strip.width - chipWidth - 6;
    const chipY = strip.y + 4;
    const chipHeight = strip.height - 8;

    const chip = this.backButton.children[0] as Graphics;
    chip.clear();
    chip.roundRect(chipX, chipY, chipWidth, chipHeight, 5).fill({ color: UI.accent });
    this.backButton.hitArea = new Rectangle(chipX, chipY, chipWidth, chipHeight);
    centreOn(this.backLabel, chipX + chipWidth / 2, chipY + chipHeight / 2 - 7);
  }

  /** Across the top of the spawn band, above the lane and below the tabs. */
  private stripRect(): { x: number; y: number; width: number; height: number } {
    const l = this.layout;
    return { x: l.lane.x + 6, y: l.spawn.y + 2, width: l.lane.width - 12, height: 26 };
  }

  render(view: MatchView, watchingTeamId: string | null): void {
    if (watchingTeamId === null) {
      this.visible = false;
      return;
    }

    const opponent = view.opponents.find((o) => o.teamId === watchingTeamId);
    const seconds = opponent ? Math.ceil(ticksToSeconds(opponent.visionTicksLeft)) : 0;
    const reason = opponent?.eliminated
      ? 'eliminated'
      : seconds > 0
        ? `sight for ${seconds}s`
        : view.eliminated
          ? 'spectating'
          : 'visible';

    this.caption.text = `Watching ${laneName(watchingTeamId)} · ${reason}`;
    this.backButton.visible = true;
    this.visible = true;
  }

  /** Not a lane at all: connecting, or the connection has gone. */
  renderStatus(status: TransportStatus, detail: string | null): void {
    if (status === 'ready') {
      this.visible = false;
      return;
    }

    this.caption.text =
      status === 'connecting'
        ? 'Connecting to the server…'
        : (detail ?? (status === 'closed' ? 'Disconnected' : 'Connection failed'));
    this.backButton.visible = false;
    this.visible = true;
  }
}

function laneName(teamId: string): string {
  const match = /(\d+)$/.exec(teamId);
  return match ? `Lane ${match[1]}` : teamId;
}
