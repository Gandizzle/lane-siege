/**
 * Heads-up display. DESIGN.md §4.1, §9.3, §11.
 *
 * Occupies the top band, which §4.1 reserves for opponent tabs. M2 is single
 * player (§17), so it carries the wave clock and the player's resources instead;
 * the tabs slot in beside them at M4 when there are opponents to spectate.
 *
 * Read-only over simulation state, like everything under render/.
 */

import { Container, Graphics } from 'pixi.js';
import type { GameData } from '../../data/schema.ts';
import type { MatchState, WaveSummary } from '../../sim/index.ts';
import { ticksToSeconds } from '../../sim/index.ts';
import type { LaneLayout } from '../layout.ts';
import { DAMAGE_COLOURS, UI } from '../palette.ts';
import { label } from './text.ts';

export class Hud extends Container {
  private readonly background = new Graphics();
  private readonly bars = new Graphics();
  private readonly content = new Container();

  constructor(
    private layout: LaneLayout,
    private readonly data: GameData,
  ) {
    super();
    this.addChild(this.background, this.bars, this.content);
  }

  setLayout(layout: LaneLayout): void {
    this.layout = layout;
  }

  render(state: MatchState, teamId: string, summary: WaveSummary | null): void {
    const lane = state.lanes[teamId];
    if (!lane) return;

    this.content.removeChildren();
    this.background.clear();
    this.bars.clear();

    const l = this.layout;
    this.background.rect(l.tabs.x, l.tabs.y, l.tabs.width, l.tabs.height).fill({ color: UI.tabs });

    const pad = 12;
    const isBoss = state.wave > 0 && state.wave % this.data.waves.bossEveryNWaves === 0;

    const waveText = label(
      state.wave === 0 ? 'Prepare' : `Wave ${state.wave}${isBoss ? ' · BOSS' : ''}`,
      15,
      isBoss ? UI.danger : UI.text,
      '700',
    );
    waveText.x = pad;
    waveText.y = l.tabs.y + 8;
    this.content.addChild(waveText);

    // §3.1, amended: the build phase is the only phase with a clock. Combat now
    // runs until the lane is empty (§3.2, amended), so it counts monsters left
    // rather than seconds - a countdown stuck at 0s would say nothing.
    const remaining = lane.monsters.filter((m) => m.alive).length + lane.reserve.length;
    const seconds = Math.ceil(ticksToSeconds(state.phaseTicksLeft));
    const phaseText = label(
      state.phase === 'build' ? `Build · ${seconds}s` : `Combat · ${remaining} left`,
      12,
      state.phase === 'build' ? UI.accent : UI.textMuted,
      '600',
    );
    phaseText.x = pad;
    phaseText.y = l.tabs.y + 28;
    this.content.addChild(phaseText);

    // Resources. Gold and gems are deliberately separate currencies with
    // separate sinks (§11.3).
    const resources = label(
      `${Math.floor(lane.economy.gold)}g   ${Math.floor(lane.economy.gems)}gem   ` +
        `${lane.economy.supplyUsed}/${lane.economy.supplyCap} supply`,
      12,
      UI.text,
      '600',
    );
    resources.x = l.tabs.width - resources.width - pad;
    resources.y = l.tabs.y + 10;
    this.content.addChild(resources);

    if (summary?.dominantDamageType) {
      // §9.3: say what the wave DEALS, or the matrix stays invisible.
      const pct = Math.round(summary.dominantDamageShare * 100);
      const offence = label(
        `incoming: ${pct}% ${summary.dominantDamageType}`,
        11,
        DAMAGE_COLOURS[summary.dominantDamageType],
        '600',
      );
      offence.x = l.tabs.width - offence.width - pad;
      offence.y = l.tabs.y + 30;
      this.content.addChild(offence);
    }

    this.drawFortress(lane.fortress.hp, lane.fortress.maxHp);
  }

  /** §10.1: the fortress is attackable, so its HP is the match's life bar. */
  private drawFortress(hp: number, maxHp: number): void {
    const l = this.layout;
    const fraction = Math.max(0, Math.min(1, maxHp > 0 ? hp / maxHp : 0));

    const barWidth = l.fortress.width - 24;
    const barHeight = 10;
    const x = 12;
    const y = l.fortress.y + l.fortress.height - barHeight - 8;

    this.bars.rect(x, y, barWidth, barHeight).fill({ color: UI.background });
    this.bars
      .rect(x, y, barWidth * fraction, barHeight)
      .fill({ color: fraction > 0.35 ? UI.healthGood : UI.healthLow });

    const text = label(`fortress ${Math.max(0, Math.round(hp))} / ${Math.round(maxHp)}`, 10);
    text.x = x;
    text.y = y - 14;
    this.content.addChild(text);
  }
}
