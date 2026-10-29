/**
 * The looks a player is seen in (looks.ts): that every one the Collection
 * offers can be drawn, that each stays where it is allowed to be - a skin
 * inside the wall, a floor on its spoke, a trail smaller than the shot that
 * left it - and that a win is a win before anything goes off.
 */

import { Graphics } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { COSMETICS } from '../progression/config.ts';
import { NO_LOOKS, type MatchView, type OpponentView } from '../sim/index.ts';
import { battlefieldOf } from './battlefield.ts';
import {
  VictoryShow,
  drawFloor,
  drawFortress,
  drawTrailBit,
  floorOf,
  isFortressSkin,
  looksOf,
  trailOf,
  victoryLength,
  victoryOf,
  winnerOf,
  type FloorKind,
  type TrailKind,
} from './looks.ts';

const SKINS = [null, 'fortress_granite', 'fortress_obsidian', 'fortress_gilded'];

function bounds(draw: (g: Graphics) => void) {
  const g = new Graphics();
  draw(g);
  return g.bounds;
}

function opponent(teamId: string, extra: Partial<OpponentView> = {}): OpponentView {
  return {
    teamId,
    name: '',
    level: 0,
    recorded: false,
    looks: NO_LOOKS,
    badges: [],
    eliminated: false,
    placement: null,
    fortressHp: 1,
    fortressMaxHp: 1,
    watching: false,
    visionTicksLeft: 0,
    fighting: false,
    ...extra,
  };
}

/** Just what deciding a winner reads off a view. */
function ended(view: Partial<MatchView>): MatchView {
  return {
    teamId: 'me',
    teamLooks: NO_LOOKS,
    finished: true,
    eliminated: false,
    solo: null,
    opponents: [],
    ...view,
  } as MatchView;
}

describe('looks', () => {
  it('can draw every look the Collection offers', () => {
    for (const c of COSMETICS.cosmetics) {
      if (c.slot === 'fortress') expect(isFortressSkin(c.id), c.id).toBe(true);
      if (c.slot === 'trail') expect(trailOf(c.id), c.id).not.toBeNull();
      if (c.slot === 'floor') expect(floorOf(c.id), c.id).not.toBeNull();
      if (c.slot === 'victory') expect(victoryOf(c.id), c.id).not.toBeNull();
      if (c.slot === 'battlefield') expect(battlefieldOf(c.id), c.id).not.toBe('plain');
    }
    // And nothing at all for none, or for something it does not know.
    expect([trailOf(null), floorOf('floor_lava'), victoryOf('trail_ember')]).toEqual([
      null,
      null,
      null,
    ]);
  });

  it('paints every skin inside the wall, whatever its length', () => {
    for (const halfWidth of [150, 40, 0]) {
      const plain = bounds((g) => drawFortress(g, null, 200, 100, halfWidth, 20));
      for (const skin of SKINS) {
        const b = bounds((g) => drawFortress(g, skin, 200, 100, halfWidth, 20));
        // The wall's own outline is the edge of everything a skin draws.
        expect([b.minX, b.minY, b.maxX, b.maxY], `${skin} at ${halfWidth}`).toEqual([
          plain.minX,
          plain.minY,
          plain.maxX,
          plain.maxY,
        ]);
      }
    }
  });

  it('draws each skin differently', () => {
    const drawn = SKINS.map((skin) => {
      const g = new Graphics();
      drawFortress(g, skin, 200, 100, 150, 20);
      return g.context.instructions.length;
    });
    expect(new Set(drawn).size).toBe(SKINS.length);
  });

  it('leaves trail bits smaller than the shot, gone once they have faded', () => {
    for (const kind of ['ember', 'frost'] as TrailKind[]) {
      const b = bounds((g) => drawTrailBit(g, kind, 50, 50, 4, 0, 1));
      expect(b.maxX - b.minX, kind).toBeLessThanOrEqual(8.01);
      const g = new Graphics();
      drawTrailBit(g, kind, 50, 50, 4, 10_000, 1);
      expect(g.context.instructions, kind).toHaveLength(0);
    }
  });

  it('keeps a floor on its own strip', () => {
    for (const kind of ['checker', 'starfield'] as FloorKind[]) {
      const b = bounds((g) =>
        drawFloor(g, kind, {
          origin: { x: 0, y: 50 },
          dir: { x: 1, y: 0 },
          from: 2,
          to: 12,
          half: 2,
          unit: 10,
          toPixel: (x, y) => [x * 10, y * 10],
        }),
      );
      expect(b.minX, kind).toBeGreaterThanOrEqual(20 - 0.01);
      expect(b.maxX, kind).toBeLessThanOrEqual(120 + 0.01);
      expect(b.minY, kind).toBeGreaterThanOrEqual(480 - 0.01);
      expect(b.maxY, kind).toBeLessThanOrEqual(520 + 0.01);
    }
  });

  it('knows the winner: you, still standing, or whoever placed first', () => {
    expect(winnerOf(ended({}))).toBe('me');
    expect(
      winnerOf(
        ended({
          eliminated: true,
          opponents: [opponent('a', { eliminated: true }), opponent('b', { placement: 1 })],
        }),
      ),
    ).toBe('b');
    expect(winnerOf(ended({ finished: false }))).toBeNull();
    // Solo's wall always falls: nobody wins it.
    expect(winnerOf(ended({ eliminated: true, solo: {} as MatchView['solo'] }))).toBeNull();
  });

  it("finds anyone's looks in the match: yours, and every other seat's", () => {
    const mine = { ...NO_LOOKS, victory: 'victory_confetti' };
    const theirs = { ...NO_LOOKS, fortress: 'fortress_gilded' };
    const view = ended({ teamLooks: mine, opponents: [opponent('b', { looks: theirs })] });
    expect(looksOf(view, 'me')).toEqual(mine);
    expect(looksOf(view, 'b')).toEqual(theirs);
    expect(looksOf(view, 'nobody')).toEqual(NO_LOOKS);
  });

  it('goes off, and is done when its time is up', () => {
    for (const kind of ['fireworks', 'confetti'] as const) {
      const show = new VictoryShow();
      show.play(kind, 400, 800);
      show.update(300);
      expect(show.playing, kind).toBe(true);
      expect(show.visible).toBe(true);
      show.update(victoryLength(kind));
      expect(show.playing, kind).toBe(false);
      expect(show.visible).toBe(false);
    }
  });
});
