/**
 * The moment your lane is clear: a burst in the middle of the board, what the
 * wave paid, and who everybody is still waiting on.
 *
 * A wave ends only when EVERY lane has beaten it (§3.2, amended), so the
 * moment that is yours - the last monster in your lane falling - used to pass
 * without a word: the HUD quietly changed to "Waiting on other lanes" and the
 * player was left wondering whether anything had happened. Now it is
 * celebrated where the eye already is, with a chime (audio/cues.ts,
 * `wave.cleared`), and it answers the two questions it raises: what did that
 * earn me, and how long until the next build phase.
 *
 * WHAT IT SAYS
 *
 *   Wave 3 cleared!
 *   +38 gold from 24 kills
 *   2 finished by your fortress: no gold for those      (only if any were)
 *   Still fighting: Rookie, Tactician                   (live; or "Every lane is clear")
 *
 * and once every lane is through and the build phase is on, the last line
 * turns into the clock instead - "24 seconds remaining to build. Build now!" -
 * because a card still up then is a player reading about the last wave while
 * the time to prepare for the next one runs out.
 *
 * The gold and the kills are the wave's tally (sim/types.ts, `WaveTally`):
 * what your line's kills paid you, and the monsters your fortress had to
 * finish, which pay you nothing (§11.1, amended). The tally is read every
 * frame the card is up, so a kill that lands as it opens is counted.
 *
 * It stays up until the player taps somewhere - anywhere on the screen
 * (`dismiss`, from app.ts) - so it is read rather than glimpsed, and the
 * still-fighting list keeps itself current while it waits. It takes no taps
 * of its own: the tap that puts it away also does whatever it was aimed at,
 * since the shop and the other lanes are still going on behind it. A new wave
 * starting puts it away too, its news being out of date.
 */

import { Container, Graphics } from 'pixi.js';
import type { Text } from 'pixi.js';
import { ticksToSeconds, type MatchView, type TeamId } from '../../sim/index.ts';
import type { LaneLayout } from '../layout.ts';
import { UI } from '../palette.ts';
import { confetti, drawBurst, easeOutBack } from './burst.ts';
import { CURRENCY_COLOURS, GOLD, RichLabel } from './currency.ts';
import { centreOn, label, overlaid } from './text.ts';

/** How long the card takes to come and to go, in milliseconds. */
const POP_MS = 350;
const FADE_MS = 300;
/**
 * The least it is up before a tap can put it away: a tap already on its way
 * when the lane cleared - a player mid-purchase - should not swallow it unseen.
 */
const MIN_MS = 700;
/** How many bits of confetti the burst throws. */
const CONFETTI = 34;

/** What the card says, from the view as it stands. */
export interface ClearedLines {
  title: string;
  /** "+38 gold from 24 kills": with a coin token (currency.ts). */
  earned: string;
  /** What the fortress's kills cost, or '' when it made none. */
  wall: string;
  /**
   * Who is still fighting, '' in solo, where there is nobody - or, once the
   * wave is over, how long is left to build.
   */
  waiting: string;
}

export function clearedLines(view: MatchView, wave: number): ClearedLines {
  const tally = view.lane?.economy?.waveTally;
  const kills = tally?.kills ?? 0;
  const gold = Math.round(tally?.bounty ?? 0);
  const walled = tally?.fortressKills ?? 0;
  const missed = Math.round(tally?.missed ?? 0);
  const others = view.opponents.filter((o) => !o.eliminated);
  const fighting = others.filter((o) => o.fighting).map((o) => o.name || laneName(o.teamId));
  return {
    title: `Wave ${wave} cleared!`,
    earned: `+${GOLD}${gold} from ${kills} ${kills === 1 ? 'kill' : 'kills'}`,
    wall:
      walled > 0
        ? `${walled} finished by your fortress: ${missed > 0 ? `${missed} gold lost` : 'no gold'}`
        : '',
    waiting:
      view.phase === 'build'
        ? buildClock(view)
        : others.length === 0
          ? ''
          : fighting.length > 0
            ? `Still fighting: ${fighting.join(', ')}`
            : 'Every lane is clear',
  };
}

/** "24 seconds remaining to build. Build now!" */
function buildClock(view: MatchView): string {
  const seconds = Math.max(0, Math.ceil(ticksToSeconds(view.phaseTicksLeft)));
  return `${seconds} ${seconds === 1 ? 'second' : 'seconds'} remaining to build. Build now!`;
}

/**
 * Whether the lane on screen has just been cleared: in combat, nothing left in
 * it, and it was not clear a moment ago. Never in the endless wave, which has
 * no end to celebrate, nor for a lane that is clear because its fortress fell.
 */
export function justCleared(wasClear: boolean, view: MatchView): boolean {
  return !wasClear && laneIsClear(view);
}

export function laneIsClear(view: MatchView): boolean {
  const lane = view.lane;
  return (
    view.phase === 'combat' &&
    !view.eliminated &&
    !view.solo?.endless &&
    !!lane &&
    !lane.fortress.destroyed &&
    lane.monsters.length + lane.reserveCount === 0
  );
}

export class WaveCleared extends Container {
  private readonly burst = new Graphics();
  private readonly backing = new Graphics();
  private readonly title: Text;
  private readonly earned: RichLabel;
  private readonly wall: Text;
  private readonly waiting: Text;
  private layout: LaneLayout;
  private readonly bits = confetti(CONFETTI);

  /** Milliseconds since the card opened; negative while it is not up. */
  private age = -1;
  /** Milliseconds since it was tapped away; negative while it is staying. */
  private closing = -1;
  private wave = 0;
  /**
   * Whether the lane was clear at the last look. True to begin with, so a
   * match joined while the lane happens to be empty does not open on a party.
   */
  private wasClear = true;

  constructor(layout: LaneLayout) {
    super();
    this.layout = layout;
    this.eventMode = 'none';
    this.title = overlaid('', 30, CURRENCY_COLOURS.gold, '700');
    this.earned = new RichLabel(16, UI.text, '700');
    this.wall = label('', 13, UI.textMuted, '600');
    this.waiting = label('', 13, UI.accent, '700');
    this.addChild(this.burst, this.backing, this.title, this.earned, this.wall, this.waiting);
    this.visible = false;
  }

  setLayout(layout: LaneLayout): void {
    this.layout = layout;
  }

  /** Put it away: a new match, or the home screen. */
  reset(): void {
    this.age = -1;
    this.closing = -1;
    this.visible = false;
    this.wasClear = true;
  }

  /** Whether the card is up (or on its way out). */
  get showing(): boolean {
    return this.age >= 0;
  }

  /**
   * A tap anywhere on the screen: the card fades out, unless it has only just
   * opened (`MIN_MS`).
   */
  dismiss(): void {
    if (this.age >= MIN_MS && this.closing < 0) this.closing = 0;
  }

  /** Watch for the lane going clear, and open the card when it does. */
  observe(view: MatchView): void {
    if (justCleared(this.wasClear, view)) {
      this.age = 0;
      this.closing = -1;
      this.wave = view.wave;
    }
    this.wasClear = laneIsClear(view);
    // The next wave walking in makes the card old news.
    if (this.age >= 0 && this.closing < 0 && view.wave !== this.wave) this.closing = 0;
    if (view.eliminated) this.reset();
  }

  /** Animate, on wall time: it is a thumb's-eye moment, not the match's. */
  render(view: MatchView, deltaMs: number): void {
    if (this.age < 0) {
      this.visible = false;
      return;
    }
    this.age += deltaMs;
    if (this.closing >= 0) this.closing += deltaMs;
    if (this.closing >= FADE_MS) {
      this.age = -1;
      this.closing = -1;
      this.visible = false;
      return;
    }
    this.visible = true;

    const l = this.layout;
    const scale = Math.max(1, l.textScale);
    const cx = l.lane.x + l.lane.width / 2;
    const cy = l.lane.y + l.lane.height * 0.42;

    // Up with a little overshoot; down with a fade once tapped away.
    const t = this.age;
    const pop = t < POP_MS ? easeOutBack(t / POP_MS) : 1;
    const fade = this.closing >= 0 ? 1 - this.closing / FADE_MS : 1;
    this.alpha = Math.max(0, Math.min(1, fade));

    const lines = clearedLines(view, this.wave);
    this.title.text = lines.title;
    this.title.style.fontSize = Math.round(30 * scale);
    this.earned.setFontSize(Math.round(16 * scale));
    this.earned.set(lines.earned);
    this.wall.style.fontSize = Math.round(13 * scale);
    this.wall.text = lines.wall;
    this.waiting.style.fontSize = Math.round(13 * scale);
    this.waiting.text = lines.waiting;

    // Stacked under the title, each line only if it has something to say.
    // The title pops about its own middle.
    this.title.scale.set(1);
    const titleH = this.title.height;
    let y = cy - titleH / 2;
    this.title.scale.set(pop);
    this.title.x = cx - this.title.width / 2;
    this.title.y = y + (titleH - this.title.height) / 2;
    y += titleH + 4 * scale;
    this.earned.x = cx - this.earned.width / 2;
    this.earned.y = y;
    y += this.earned.height + 6 * scale;
    this.wall.visible = lines.wall !== '';
    if (this.wall.visible) {
      centreOn(this.wall, cx, y);
      y += this.wall.height + 4 * scale;
    }
    this.waiting.visible = lines.waiting !== '';
    if (this.waiting.visible) {
      centreOn(this.waiting, cx, y);
      y += this.waiting.height;
    }

    // A dark card behind the words, so they read over whatever is fighting.
    const width =
      Math.max(
        this.title.width / Math.max(0.01, pop),
        this.earned.width,
        this.wall.visible ? this.wall.width : 0,
        this.waiting.visible ? this.waiting.width : 0,
      ) +
      36 * scale;
    const top = cy - titleH / 2 - 12 * scale;
    this.backing.clear();
    this.backing
      .roundRect(cx - width / 2, top, width, y - top + 12 * scale, 14)
      .fill({ color: UI.background, alpha: 0.82 })
      .stroke({ width: 2, color: CURRENCY_COLOURS.gold, alpha: 0.7 });

    const reach = Math.min(l.lane.width, l.lane.height) * 0.48;
    drawBurst(this.burst, cx, cy, reach, this.age, scale, this.bits);
  }
}

/** "lane3" -> "Lane 3", as the tabs above the lane say it. */
function laneName(teamId: TeamId): string {
  const match = /(\d+)$/.exec(teamId);
  return match ? `Lane ${match[1]}` : teamId;
}
