/**
 * Which kinds of status marker have been on screen lately, and on whom - what
 * the effects legend lists (ui/effectsPanel.ts).
 *
 * Fed the board on screen once a tick, the same board the markers are drawn
 * on, so it lists exactly what the player could have seen: their own lane, a
 * lane they are watching, or the arena. Times are the match clock, which stops
 * when the match is paused, so "twelve seconds ago" means twelve seconds of
 * play.
 *
 * Pure bookkeeping over views, with no Pixi in it, so it is tested directly
 * (statusLog.test.ts).
 */

import { STATUS_MARKS, hasMark, type LaneView, type StatusMark } from '../sim/index.ts';

/** How long a marker counts as recent after it was last on screen, in seconds. */
export const RECENT_SECONDS = 60;

export interface SeenMark {
  mark: StatusMark;
  /** On screen right now. */
  now: boolean;
  /** Seconds since it was last on screen: 0 when it is on screen now. */
  ago: number;
  /** Whether it was on a unit (a defender) or a monster, within the window. */
  onUnits: boolean;
  onMonsters: boolean;
}

interface Sighting {
  onUnits: number;
  onMonsters: number;
}

export class StatusLog {
  private readonly sightings = new Map<StatusMark, Sighting>();
  /** The kinds on screen at the last look. */
  private current = 0;
  /** Kinds first seen since the legend was last opened. */
  private unread = 0;

  /** Record what is on `board` at match time `time` (seconds). */
  observe(board: LaneView | null, time: number): void {
    let units = 0;
    let monsters = 0;
    for (const body of board?.units ?? []) units |= body.statusMarks ?? 0;
    for (const body of board?.monsters ?? []) monsters |= body.statusMarks ?? 0;
    this.current = units | monsters;

    for (const mark of STATUS_MARKS) {
      const onUnits = hasMark(units, mark);
      const onMonsters = hasMark(monsters, mark);
      if (!onUnits && !onMonsters) continue;
      let sighting = this.sightings.get(mark);
      if (!sighting) {
        sighting = { onUnits: -Infinity, onMonsters: -Infinity };
        this.sightings.set(mark, sighting);
        this.unread |= 1 << STATUS_MARKS.indexOf(mark);
      }
      if (onUnits) sighting.onUnits = time;
      if (onMonsters) sighting.onMonsters = time;
    }
  }

  /**
   * Every kind seen within `window` seconds of `time`: what is on screen now
   * first, then the rest by how recently.
   */
  recent(time: number, window = RECENT_SECONDS): SeenMark[] {
    const out: SeenMark[] = [];
    for (const [mark, sighting] of this.sightings) {
      const last = Math.max(sighting.onUnits, sighting.onMonsters);
      if (time - last > window) continue;
      const now = hasMark(this.current, mark);
      out.push({
        mark,
        now,
        ago: now ? 0 : Math.max(0, time - last),
        onUnits: time - sighting.onUnits <= window,
        onMonsters: time - sighting.onMonsters <= window,
      });
    }
    return out.sort(
      (a, b) =>
        Number(b.now) - Number(a.now) ||
        a.ago - b.ago ||
        STATUS_MARKS.indexOf(a.mark) - STATUS_MARKS.indexOf(b.mark),
    );
  }

  /** The kind most recently seen, for the legend button to show; null if none yet. */
  latest(time: number): StatusMark | null {
    return this.recent(time)[0]?.mark ?? null;
  }

  /** A kind has appeared that the player has not opened the legend since. */
  get hasUnread(): boolean {
    return this.unread !== 0;
  }

  /** The legend has been opened: everything seen so far has been shown. */
  markRead(): void {
    this.unread = 0;
  }

  /** A new match: nothing has been seen yet. */
  reset(): void {
    this.sightings.clear();
    this.current = 0;
    this.unread = 0;
  }
}
