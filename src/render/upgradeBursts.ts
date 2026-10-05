/**
 * The burst on a unit that has just been upgraded (§7.3).
 *
 * Upgrading is in place - same tile, same body - so on the board the only
 * sign it happened used to be one more dot under the unit, and a player whose
 * eyes were on the Upgrade button saw nothing at all. Now, for about a second,
 * a gold ring swells off the unit, its body flashes, chevrons rise over it -
 * one for each upgrade it now wears - and the word for what it became
 * ("Super!", "Ultra!") floats up and away.
 *
 * WALL TIME, AND EVERY FRAME
 *
 * Not part of the effects layer (effects.ts), which turns a tick's blows into
 * animations and so only looks at the lane when a tick arrives and only moves
 * while the match does. An upgrade is a tap, not a blow: in a practice match
 * it lands between ticks, and the tutorial makes it while the match is held
 * still. So this compares the lane on screen with the last one it saw on
 * every frame, and runs on the frame's own clock.
 */

import { Container, Graphics } from 'pixi.js';
import type { Text } from 'pixi.js';
import type { DefIndex, EntityId, LaneView } from '../sim/index.ts';
import type { Camera } from './layout.ts';
import { overlaid } from './ui/text.ts';

/** How long a burst lasts, in milliseconds. */
export const UPGRADE_MS = 1000;
/** Gold: the color of what was spent on it. */
const GOLD = 0xf2c14e;
const FLASH = 0xfff3c4;

interface Burst {
  age: number;
  /** Where the unit stands, in tiles. */
  x: number;
  y: number;
  /** Body radius in tiles. */
  radius: number;
  /** The mark it became: 2 for the first upgrade, 3 for the second. */
  mark: number;
  /** "Super!" or "Ultra!", rising over it. */
  word: Text;
}

/** What a unit is called once upgraded this far (units.json names them the same way). */
export function upgradeWord(mark: number): string {
  return mark >= 3 ? 'Ultra!' : 'Super!';
}

/**
 * Which units in `now` are a higher mark than they were in `before`: the same
 * id, an upgraded definition. Pure, for the tests.
 */
export function upgradedUnits(
  before: ReadonlyMap<EntityId, string>,
  now: LaneView,
  markOf: (defId: string) => number,
): LaneView['units'] {
  return now.units.filter((unit) => {
    const was = before.get(unit.id);
    return was !== undefined && was !== unit.defId && markOf(unit.defId) > markOf(was);
  });
}

export class UpgradeBursts extends Container {
  private readonly graphics = new Graphics();
  private readonly bursts: Burst[] = [];
  /** The lane last looked at: whose it is, and each unit's definition then. */
  private seenTeam: string | null = null;
  private seen = new Map<EntityId, string>();

  constructor(
    private camera: Camera,
    private readonly defs: DefIndex,
  ) {
    super();
    this.eventMode = 'none';
    this.addChild(this.graphics);
  }

  setLayout(camera: Camera): void {
    this.camera = camera;
  }

  reset(): void {
    for (const burst of this.bursts) burst.word.destroy();
    this.bursts.length = 0;
    this.seen.clear();
    this.seenTeam = null;
    this.graphics.clear();
  }

  /** Look at the lane on screen, start a burst for each unit upgraded since the last look. */
  observe(lane: LaneView | null): void {
    if (!lane) return;
    // Switching to watch another lane is not that lane's units upgrading.
    if (lane.teamId === this.seenTeam) {
      const markOf = (defId: string) => this.defs.units.get(defId)?.mark ?? 1;
      for (const unit of upgradedUnits(this.seen, lane, markOf)) {
        const mark = markOf(unit.defId);
        const word = overlaid(
          upgradeWord(mark),
          Math.round(Math.max(13, this.camera.tileSize * 0.42)),
          GOLD,
        );
        this.addChild(word);
        this.bursts.push({ age: 0, x: unit.x, y: unit.y, radius: unit.radius, mark, word });
      }
    }
    this.seenTeam = lane.teamId;
    this.seen = new Map(lane.units.map((unit) => [unit.id, unit.defId]));
  }

  /** Advance on wall time and draw. */
  render(deltaMs: number): void {
    const g = this.graphics;
    g.clear();
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const burst = this.bursts[i]!;
      burst.age += deltaMs;
      if (burst.age >= UPGRADE_MS) {
        burst.word.destroy();
        this.bursts.splice(i, 1);
      }
    }
    for (const burst of this.bursts) this.draw(burst);
  }

  private draw(burst: Burst): void {
    const g = this.graphics;
    const { gridOrigin, tileSize } = this.camera;
    const t = Math.min(1, burst.age / UPGRADE_MS);
    const out = 1 - (1 - t) * (1 - t);
    const cx = gridOrigin.x + burst.x * tileSize;
    const cy = gridOrigin.y + burst.y * tileSize;
    const r = Math.max(4, burst.radius * tileSize);

    // A flash on the body, gone by a third of the way.
    const flash = Math.max(0, 1 - t * 3);
    if (flash > 0.01) {
      g.moveTo(cx + r * 1.15, cy)
        .circle(cx, cy, r * 1.15)
        .fill({ color: FLASH, alpha: 0.75 * flash });
    }

    // Two gold rings swelling off it, the second a beat behind the first.
    for (const delay of [0, 0.18]) {
      const local = (t - delay) / (1 - delay);
      if (local <= 0 || local >= 1) continue;
      const grow = 1 - (1 - local) * (1 - local);
      const ring = r * (1.2 + 2.6 * grow);
      g.moveTo(cx + ring, cy)
        .circle(cx, cy, ring)
        .stroke({
          width: Math.max(2, r * 0.32 * (1 - local)),
          color: GOLD,
          alpha: 0.95 * (1 - local),
        });
    }

    // Chevrons rising off the top of it, one per upgrade worn - the dots under
    // the unit say the same - fading as they go.
    const rise = r * (1.2 + 2.2 * out);
    const fade = t < 0.75 ? 1 : (1 - t) / 0.25;
    const w = r * 0.85;
    const h = r * 0.5;
    const thick = Math.max(2, r * 0.26);
    for (let i = 0; i < burst.mark - 1; i++) {
      const y = cy - rise - i * (h + thick * 1.3);
      g.poly([
        cx - w,
        y + h,
        cx,
        y,
        cx + w,
        y + h,
        cx + w,
        y + h + thick,
        cx,
        y + thick,
        cx - w,
        y + h + thick,
      ]).fill({ color: GOLD, alpha: fade });
    }

    // The word, over the chevrons and going on up past them.
    const word = burst.word;
    word.alpha = fade;
    word.position.set(
      cx - word.width / 2,
      cy - rise - (burst.mark - 1) * (h + thick * 1.3) - word.height - r * 0.3,
    );
  }
}
