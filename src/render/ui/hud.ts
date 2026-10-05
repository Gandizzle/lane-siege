/**
 * Heads-up display. DESIGN.md §4.1, §9.3, §11.
 *
 * The wave clock and your own resources, in the area §4.1 reserves for them -
 * the top band on an upright phone, the left column on a sideways one. The
 * opponent tabs themselves are `opponentTabs.ts` and share the area.
 *
 * The two arrangements differ only in where the lines go. Upright, the band is
 * wide and short, so it is read in two columns: what is happening on the left,
 * what you have on the right. Sideways it is narrow and tall, so everything is
 * one stack in reading order - and the resources split across two lines,
 * because a 240-pixel column cannot hold gold, gems and supply side by side.
 *
 * Read-only over a `MatchView`, like everything under render/ - so it shows
 * your wallet and never anyone else's, because it has never been given anyone
 * else's (§12).
 */

import { Container, Graphics } from 'pixi.js';
import type { GameData } from '../../data/schema.ts';
import type { MatchView, WaveSummary } from '../../sim/index.ts';
import { ticksToSeconds } from '../../sim/index.ts';
import type { LaneLayout, Rect } from '../layout.ts';
import { fortressShape } from '../layout.ts';
import { DAMAGE_COLORS, UI } from '../palette.ts';
import { screenRect, unionOf } from './locate.ts';
import { GEM, GOLD, RichLabel, SUPPLY } from './currency.ts';
import { centreOn, clock, label, overlaid } from './text.ts';
import { speedLabel, type GameSpeed } from '../preferences.ts';
import { comesNext } from '../laneView.ts';

/**
 * What the HUD says about sends on their way to this lane, or null for nothing.
 *
 * Two counts, because a send is on its way for longer than its log entry
 * lasts. `sendLog` holds sends for the NEXT wave and is cleared when that wave
 * spawns (§11.5) - but sends have a pool of their own on the field (§8.1,
 * amended), and more of them than it holds wait in reserve and can still be
 * walking in long after the log said nothing. Unsaid, that looks like sends
 * arriving that nobody bought: in solo, your own, still coming after
 * auto-send was switched off. So once a wave is out, whatever was sent and
 * has not yet entered is counted too (`reserveSends`).
 *
 * Alone, every send is your own (§3.3, solo): not a warning, a receipt. In the
 * endless wave a send walks in on the next tick when its pool has room, so
 * only the ones the cap is holding back are worth a line.
 */
export function sendNotice(
  view: Pick<MatchView, 'solo'>,
  lane: Pick<NonNullable<MatchView['lane']>, 'sendLog' | 'reserveSends'>,
  attackers: number,
): { text: string; solo: boolean } | null {
  const waiting = lane.reserveSends;
  if (view.solo) {
    const next = view.solo.endless ? 0 : lane.sendLog.length;
    if (waiting > 0) {
      const total = waiting + next;
      return { text: `${total} of your sends still to come`, solo: true };
    }
    if (next > 0) {
      return {
        text: next === 1 ? '1 send joins your next wave' : `${next} sends join your next wave`,
        solo: true,
      };
    }
    return null;
  }
  const incoming = lane.sendLog.length;
  if (incoming > 0) {
    return {
      text:
        `⚠ ${incoming} send${incoming === 1 ? '' : 's'} incoming` +
        ` from ${attackers} lane${attackers === 1 ? '' : 's'}`,
      solo: false,
    };
  }
  if (waiting > 0) {
    return {
      text: `⚠ ${waiting} send${waiting === 1 ? '' : 's'} still to come`,
      solo: false,
    };
  }
  return null;
}

/** A reading on the HUD that the tutorial can point at (`locate`). */
export type HudPart = 'phase' | 'wallet' | 'supply' | 'income' | 'incoming' | 'notice' | 'kills';

export class Hud extends Container {
  private readonly background = new Graphics();
  private readonly bars = new Graphics();
  private readonly content = new Container();
  /** What each reading was drawn as last frame, for `locate`. */
  private readonly parts = new Map<HudPart, Container[]>();
  /**
   * The wallet and the income, with coin, gem and supply icons (currency.ts).
   * Kept rather than made each frame like the other lines: they are the ones
   * that carry icons, and relaying an icon row that has not changed is waste.
   */
  private readonly purse = new RichLabel(12, UI.text, '600');
  private readonly army = new RichLabel(12, UI.text, '600');
  private readonly income = new RichLabel(11, UI.textMuted, '600');

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

  /**
   * Whether gems are shown (features.ts). Until the tutorial has taught them
   * there is nothing to spend them on, so the wallet is gold alone, and the
   * income line - which sends pay into - is only shown if a practice has set
   * some income of its own (tutorial/lessons.ts, "Room to grow").
   */
  setGems(shown: boolean): void {
    this.gems = shown;
  }

  private gems = true;

  /** Where a reading is on screen, or null if it was not drawn last frame. */
  locate(part: HudPart): Rect | null {
    return unionOf((this.parts.get(part) ?? []).map((text) => screenRect(text)));
  }

  /** Note that `text` is (part of) `part`, and pass it on. */
  private tag<T extends Container | null>(part: HudPart, text: T): T {
    if (text) this.parts.set(part, [...(this.parts.get(part) ?? []), text]);
    return text;
  }

  /** `speed` is the game speed, when a practice match is running at one (preferences.ts). */
  render(view: MatchView, summary: WaveSummary | null, speed: GameSpeed = 1): void {
    const lane = view.lane;
    if (!lane) return;

    this.content.removeChildren();
    this.parts.clear();
    this.background.clear();
    this.bars.clear();

    const l = this.layout;
    this.background.rect(l.tabs.x, l.tabs.y, l.tabs.width, l.tabs.height).fill({ color: UI.tabs });
    // Sideways the HUD is a column the height of the screen, and on a tablet
    // or a desktop its text at phone size was lost in it: it grows with the
    // screen's text scale there (layout.ts, `textScaleFor`). Upright it is a
    // band at its floor height on a phone, packed to the pixel, and stays put.
    const k = l.orientation === 'landscape' ? Math.max(1, l.textScale) : 1;
    const px = (size: number) => Math.round(size * k);
    this.purse.setFontSize(px(12));
    this.army.setFontSize(px(12));
    this.income.setFontSize(px(11));

    // §3.3, solo: the endless last wave, once it is running.
    const endless = view.solo?.endless ?? null;
    // ...and the build phase before it, which has no next wave to number.
    const endlessNext = !endless && comesNext(this.data, view) === 'endless';
    // The wave the banner is about: during a build phase the one that is
    // coming - the number the player is building for - and otherwise the one
    // being fought. It used to name the last wave until the next one spawned,
    // which is thirty seconds of the banner being one behind the preview.
    const incoming = view.phase === 'build';
    const shownWave = incoming ? view.wave + 1 : view.wave;
    const isBoss =
      !endless &&
      !endlessNext &&
      shownWave > 0 &&
      shownWave % this.data.waves.bossEveryNWaves === 0;
    const economy = lane.economy;
    const remaining = lane.monsters.length + lane.reserveCount;
    const seconds = Math.ceil(ticksToSeconds(view.phaseTicksLeft));
    const attackers = new Set(lane.sendLog.map((entry) => entry.fromTeamId));

    // What there is to say, once, so the two arrangements below differ only in
    // where they put it.
    // `room` is the width it may take: "Wave 25 incoming · BOSS" is long, and
    // where it would run into the purse it drops "incoming", which the phase
    // line under it ("Build · 24s") already says.
    const wave = (room = Infinity) => {
      if (endless || endlessNext) {
        return label(endless ? 'Endless wave' : 'Endless next', px(15), UI.danger, '700');
      }
      const boss = isBoss ? ' · BOSS' : '';
      const color = isBoss ? UI.danger : UI.text;
      const full = label(
        `Wave ${shownWave}${incoming ? ' incoming' : ''}${boss}`,
        px(15),
        color,
        '700',
      );
      if (!incoming || full.width <= room) return full;
      full.destroy();
      return label(`Wave ${shownWave}${boss}`, px(15), color, '700');
    };
    // §3.3, solo: the score, all match long - it is the one number a solo
    // match is played for.
    const kills = () =>
      view.solo
        ? label(`${view.solo.kills.toLocaleString('en-GB')} killed`, px(12), UI.accent, '700')
        : null;
    // §3.1, amended: the build phase is the only phase with a clock. Combat now
    // runs until the lane is empty (§3.2, amended), so it counts monsters left
    // rather than seconds - a countdown stuck at 0s would say nothing.
    // A match not at real time says so, where the clock it changes is: a
    // build timer counting down three times as fast needs its reason beside it.
    const pace = speed === 1 ? '' : ` · ${speedLabel(speed)}`;
    // Your lane can be empty while the wave is not over: it ends only when
    // every lane has beaten it, and "0 left" would look like the game had
    // stalled.
    // The endless wave has no end to count down to, so it counts up: how long
    // the wall has held, and how much is on the field against it.
    const fighting = endless
      ? `${clock(ticksToSeconds(endless.ageTicks))} · ${remaining} on the field`
      : remaining > 0
        ? `Combat · ${remaining} left`
        : 'Waiting on other lanes';
    const phase = () =>
      label(
        (view.phase === 'build' ? `Build · ${seconds}s` : fighting) + pace,
        px(12),
        view.phase === 'build' ? UI.accent : UI.textMuted,
        '600',
      );
    // §11.6: passive income is paid every wave and compounds, and it is the
    // whole reason an early send is an investment rather than an attack. A RATE
    // rather than a balance: not a number you spend, but the one that decides
    // how fast the other three move. Dimmed at zero, because zero is the honest
    // starting value and seeing it there is how a player learns the lever
    // exists.
    // Not in the endless wave, which pays none: nothing can be bought in it,
    // so gold stops (endless.ts).
    const income = () => {
      if (endless || (!this.gems && (economy?.passiveIncome ?? 0) <= 0)) return null;
      this.income.set(`+${GOLD}${Math.floor(economy?.passiveIncome ?? 0)} / wave`);
      this.income.setColor((economy?.passiveIncome ?? 0) > 0 ? UI.text : UI.textMuted);
      return this.income;
    };
    // What you have: gold and gems together, supply as used out of the cap.
    const purse = () => {
      this.purse.set(
        this.gems
          ? `${GOLD}${Math.floor(economy?.gold ?? 0)}   ${GEM}${Math.floor(economy?.gems ?? 0)}`
          : `${GOLD}${Math.floor(economy?.gold ?? 0)}`,
      );
      return this.purse;
    };
    const army = () => {
      this.army.set(`${SUPPLY}${economy?.supplyUsed ?? 0}/${economy?.supplyCap ?? 0}`);
      return this.army;
    };
    // §9.3: say what the wave DEALS, or the matrix stays invisible.
    const offence = () =>
      summary?.dominantDamageType
        ? label(
            `incoming: ${Math.round(summary.dominantDamageShare * 100)}% ` +
              `${summary.dominantDamageType}`,
            px(11),
            DAMAGE_COLORS[summary.dominantDamageType],
            '600',
          )
        : null;
    // §11.5: being sent at is the one thing that happens to you because of
    // somebody else, so it needs saying out loud.
    const notice = () => {
      const said = sendNotice(view, lane, attackers.size);
      return said ? label(said.text, px(11), said.solo ? UI.accent : UI.danger, '700') : null;
    };

    if (l.orientation === 'landscape') {
      // One stack, in reading order: what wave it is, what is happening, what
      // you have, what is coming.
      const left = l.tabs.x + 12;
      let y = l.tabs.y + 6;
      // The lines beside the menu button start past it; the rest use the
      // column's full width.
      const button = l.menuButton;
      const place = (text: Container | null, gap: number) => {
        if (!text) return;
        text.x = y < button.y + button.height ? button.x + button.width + 8 : left;
        text.y = y;
        this.content.addChild(text);
        y += gap;
      };

      place(
        this.tag('phase', wave(l.tabs.x + l.tabs.width - 12 - (button.x + button.width + 8))),
        px(21),
      );
      place(this.tag('phase', phase()), px(18));
      place(this.tag('kills', kills()), px(18));
      if (economy) {
        // Two lines, because the column is too narrow for three numbers and
        // their units side by side.
        place(this.tag('wallet', purse()), px(17));
        place(this.tag('supply', this.tag('wallet', army())), px(17));
        place(this.tag('income', income()), px(17));
      }
      place(this.tag('incoming', offence()), px(16));
      place(this.tag('notice', notice()), px(16));
    } else {
      // Two columns: what is happening on the left, what you have on the right.
      // The last row is pinned just above the tab strip rather than at a fixed
      // offset, which is what keeps it out from behind the tabs on a short
      // screen where the band is at its floor (layout.ts, `TABS_MIN_HEIGHT`).
      const pad = 12;
      const rowOne = l.tabs.y + 6;
      const rowTwo = l.tabs.y + 26;
      const rowThree = Math.max(rowTwo + 18, l.tabStrip.y - 18);
      const rightEdge = l.tabs.x + l.tabs.width - pad;

      // The left column starts past the menu button, which has the corner.
      const leftEdge = l.menuButton.x + l.menuButton.width + 8;
      const left = (text: Container | null, y: number) => {
        if (!text) return;
        text.x = leftEdge;
        text.y = y;
        this.content.addChild(text);
      };
      const right = (text: Container | null, y: number) => {
        if (!text) return;
        text.x = rightEdge - text.width;
        text.y = y;
        this.content.addChild(text);
      };

      // Gold and gems are deliberately separate currencies with separate sinks
      // (§11.3). Placed first, because the wave label is fitted to what they
      // leave of the row.
      let walletLeft = rightEdge;
      if (economy) {
        // Supply first from the right, then the purse left of it: one row,
        // two labels, so each keeps its own icons.
        const armyLabel = this.tag('supply', this.tag('wallet', army()));
        right(armyLabel, rowOne + 4);
        const purseLabel = this.tag('wallet', purse());
        right(purseLabel, rowOne + 4);
        purseLabel.x = armyLabel.x - 16 - purseLabel.width;
        walletLeft = purseLabel.x;
        right(this.tag('income', income()), rowThree);
      }
      const waveLabel = this.tag('phase', wave(walletLeft - 12 - leftEdge));
      left(waveLabel, rowOne);
      const phaseLabel = this.tag('phase', phase());
      left(phaseLabel, rowTwo);
      left(this.tag('notice', notice()), rowThree);
      const offenceLabel = this.tag('incoming', offence());
      right(offenceLabel, rowTwo + 2);

      // §3.3, solo: the tally rides beside the wave, where the eye already is
      // - or, when a long wave label leaves it no room before the purse,
      // beside the phase, where it outranks the counter hint: it is the
      // number the match is played for.
      const killsLabel = this.tag('kills', kills());
      if (killsLabel) {
        const besideWave = waveLabel.x + waveLabel.width + 10;
        if (besideWave + killsLabel.width <= walletLeft - 12) {
          killsLabel.x = besideWave;
          killsLabel.y = rowOne + 3;
        } else {
          killsLabel.x = phaseLabel.x + phaseLabel.width + 10;
          killsLabel.y = rowTwo;
          if (offenceLabel && killsLabel.x + killsLabel.width > offenceLabel.x - 8) {
            offenceLabel.visible = false;
          }
        }
        this.content.addChild(killsLabel);
      }
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

    // Outlined rather than drawn in the background color: the bar drains, and
    // a reading painted the color of the background disappears exactly when
    // the number matters most (text.ts, `overlaid`).
    const text = overlaid(
      `${Math.max(0, Math.round(hp))} / ${Math.round(maxHp)}`,
      Math.min(11, height - 6),
    );
    centreOn(text, cx, y + (height - text.height) / 2);
    this.content.addChild(text);
  }
}
