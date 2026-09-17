/**
 * Heads-up display. DESIGN.md §4.1, §9.3, §11.
 *
 * The top rows of the band §4.1 reserves for opponent tabs: the wave clock and
 * your own resources. The tabs themselves are `opponentTabs.ts` and sit below
 * these, sharing the band.
 *
 * Read-only over a `MatchView`, like everything under render/ - so it shows
 * your wallet and never anyone else's, because it has never been given anyone
 * else's (§12).
 */

import { Container, Graphics } from 'pixi.js';
import type { GameData } from '../../data/schema.ts';
import type { MatchView, WaveSummary } from '../../sim/index.ts';
import { ticksToSeconds } from '../../sim/index.ts';
import type { LaneLayout } from '../layout.ts';
import { fortressShape } from '../layout.ts';
import { DAMAGE_COLOURS, UI } from '../palette.ts';
import { centreOn, label, overlaid } from './text.ts';

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

  render(view: MatchView, summary: WaveSummary | null): void {
    const lane = view.lane;
    if (!lane) return;

    this.content.removeChildren();
    this.background.clear();
    this.bars.clear();

    const l = this.layout;
    this.background.rect(l.tabs.x, l.tabs.y, l.tabs.width, l.tabs.height).fill({ color: UI.tabs });

    const pad = 12;
    const isBoss = view.wave > 0 && view.wave % this.data.waves.bossEveryNWaves === 0;

    // Two rows from the top, and a third pinned just above the tab strip.
    // Anchoring the last row to the tabs rather than to a fixed offset is what
    // keeps it out from behind them on a short screen, where the band is at
    // its floor (layout.ts, `TABS_MIN_HEIGHT`).
    const rowOne = l.tabs.y + 6;
    const rowTwo = l.tabs.y + 26;
    const rowThree = Math.max(rowTwo + 18, l.tabStrip.y - 18);

    const waveText = label(
      view.wave === 0 ? 'Prepare' : `Wave ${view.wave}${isBoss ? ' · BOSS' : ''}`,
      15,
      isBoss ? UI.danger : UI.text,
      '700',
    );
    waveText.x = pad;
    waveText.y = rowOne;
    this.content.addChild(waveText);

    // §3.1, amended: the build phase is the only phase with a clock. Combat now
    // runs until the lane is empty (§3.2, amended), so it counts monsters left
    // rather than seconds - a countdown stuck at 0s would say nothing.
    const remaining = lane.monsters.length + lane.reserveCount;
    const seconds = Math.ceil(ticksToSeconds(view.phaseTicksLeft));
    const phaseText = label(
      view.phase === 'build' ? `Build · ${seconds}s` : `Combat · ${remaining} left`,
      12,
      view.phase === 'build' ? UI.accent : UI.textMuted,
      '600',
    );
    phaseText.x = pad;
    phaseText.y = rowTwo;
    this.content.addChild(phaseText);

    // Resources. Gold and gems are deliberately separate currencies with
    // separate sinks (§11.3).
    const economy = lane.economy;
    if (economy) {
      const resources = label(
        `${Math.floor(economy.gold)}g   ${Math.floor(economy.gems)}gem   ` +
          `${economy.supplyUsed}/${economy.supplyCap} supply`,
        12,
        UI.text,
        '600',
      );
      resources.x = l.tabs.width - resources.width - pad;
      resources.y = rowOne + 4;
      this.content.addChild(resources);

      // §11.6: passive income is paid every wave and compounds, and it is the
      // whole reason an early send is an investment rather than an attack.
      // On its own row, as a RATE rather than a balance: it is not a number
      // you spend, it is the number that decides how fast the other three
      // move. Dimmed at zero, because zero is the honest starting value and
      // seeing it there is how a player learns the lever exists.
      const income = label(
        `+${Math.floor(economy.passiveIncome)}g / wave`,
        11,
        economy.passiveIncome > 0 ? UI.text : UI.textMuted,
        '600',
      );
      income.x = l.tabs.width - income.width - pad;
      income.y = rowThree;
      this.content.addChild(income);
    }

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
      offence.y = rowTwo + 2;
      this.content.addChild(offence);
    }

    // §11.5: the incoming-attack notice. Being sent at is the one thing that
    // happens to you because of somebody else, so it needs saying out loud.
    if (lane.sendLog.length > 0) {
      const attackers = new Set(lane.sendLog.map((entry) => entry.fromTeamId));
      const notice = label(
        `⚠ ${lane.sendLog.length} send${lane.sendLog.length === 1 ? '' : 's'} incoming` +
          ` from ${attackers.size} lane${attackers.size === 1 ? '' : 's'}`,
        11,
        UI.danger,
        '700',
      );
      notice.x = pad;
      notice.y = rowThree;
      this.content.addChild(notice);
    }

    this.drawFortress(lane.fortress.hp, lane.fortress.maxHp);
  }

  /**
   * §10.1: the fortress is attackable, so its HP is the match's life bar.
   *
   * Drawn INSIDE the wall rather than beside it. The wall spans the lane and
   * fills its whole band (laneView.ts), so a separate bar would have to sit on
   * top of the stonework anyway - and a gauge set into the rampart says the
   * thing the number says twice over: this wall is what is left of you.
   */
  private drawFortress(hp: number, maxHp: number): void {
    const fraction = Math.max(0, Math.min(1, maxHp > 0 ? hp / maxHp : 0));
    const { cx, cy, halfWidth, radius } = fortressShape(this.layout, this.data.lane);

    const inset = radius * 0.34;
    const y = cy - radius + inset;
    const height = (radius - inset) * 2;
    const x = cx - halfWidth;
    const width = halfWidth * 2;

    this.bars.roundRect(x, y, width, height, height / 2).fill({ color: UI.background });
    if (fraction > 0) {
      const filled = Math.max(height, width * fraction);
      this.bars
        .roundRect(x, y, filled, height, height / 2)
        .fill({ color: fraction > 0.35 ? UI.healthGood : UI.healthLow });
    }

    // Outlined rather than drawn in the background colour: the bar drains, and
    // a reading painted the colour of the background disappears exactly when
    // the number matters most (text.ts, `overlaid`).
    const text = overlaid(
      `${Math.max(0, Math.round(hp))} / ${Math.round(maxHp)}`,
      Math.min(11, height - 6),
    );
    centreOn(text, cx, y + (height - text.height) / 2);
    this.content.addChild(text);
  }
}
