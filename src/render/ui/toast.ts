/**
 * Transient feedback for a refused command.
 *
 * The simulation returns a `CommandRejection` rather than throwing, because
 * "you cannot afford that" is a normal result of tapping a button (§15.1). This
 * turns that value into something the player can read.
 */

import { Container, Graphics } from 'pixi.js';
import type { CommandRejection } from '../../sim/index.ts';
import type { LaneLayout } from '../layout.ts';
import { UI } from '../palette.ts';
import { centreOn, label } from './text.ts';

const MESSAGES: Record<CommandRejection, string> = {
  'not-build-phase': 'Only during the build phase',
  'tile-occupied': 'That tile is taken',
  'tile-out-of-bounds': 'Outside the build zone',
  'insufficient-gold': 'Not enough gold',
  'insufficient-gems': 'Not enough gems',
  'insufficient-supply': 'Not enough supply',
  'unknown-definition': 'Not available yet',
  'no-such-unit': 'That unit is gone',
  'max-tier': 'Already at max tier',
  'building-closed': 'Nothing can be bought from wave 25',
  eliminated: 'You are out',
  'target-eliminated': 'That player is out',
  'invalid-target': 'Pick an opponent',
  'wrong-builder': 'Not one of your units',
};

const VISIBLE_MS = 1600;

export class Toast extends Container {
  private remaining = 0;
  private text = '';

  show(rejection: CommandRejection): void {
    this.showText(MESSAGES[rejection] ?? 'Not allowed');
  }

  /**
   * For things the simulation has no opinion about - sight of a lane running
   * out, a tab you cannot see inside. Those are not refused commands, they are
   * the interface explaining itself.
   */
  showText(text: string): void {
    this.text = text;
    this.remaining = VISIBLE_MS;
  }

  /** `deltaMs` is wall time - this is a renderer concern, not simulated time. */
  update(deltaMs: number, layout: LaneLayout): void {
    this.removeChildren();
    if (this.remaining <= 0) return;

    this.remaining -= deltaMs;
    if (this.remaining <= 0) return;

    const cx = layout.screen.width / 2;
    const y = layout.buildBar.y - 44;

    const text = label(this.text, 12, UI.text, '600');
    const width = text.width + 28;

    const bubble = new Graphics();
    bubble.roundRect(cx - width / 2, y, width, 28, 14).fill({ color: UI.panel });
    bubble.roundRect(cx - width / 2, y, width, 28, 14).stroke({ width: 1, color: UI.panelEdge });

    this.addChild(bubble, centreOn(text, cx, y + 7));
    // Fade out over the last third.
    this.alpha = Math.min(1, this.remaining / (VISIBLE_MS / 3));
  }
}
