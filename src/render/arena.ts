/**
 * The Final Showdown's board. DESIGN.md §3.3 replaced, amending §14.1.
 *
 * Every other screen in this game is fixed: the whole lane fits one portrait
 * phone and the camera never moves (§14.1). The arena cannot be drawn that way
 * - it is 32 tiles on a side against a lane's 8 by 14, and shrinking it to fit
 * would leave a body four pixels across - so this is the one place with a
 * camera you can move. It is zoomed out only as far as it has to be and it
 * scrolls with a drag; `arenaCamera` in layout.ts holds both rules.
 *
 * It reuses the lane's own body and effect layers rather than drawing bodies
 * again. A unit has to look like the unit the player spent the match building,
 * and a swing has to read like the swings they have been watching for
 * twenty-five waves - so the bodies, the health bars, the melee arcs and the
 * projectiles are all the same code (entities.ts, effects.ts), pointed at a
 * different camera.
 *
 * WHAT IS DRAWN THAT A LANE DOES NOT HAVE
 *
 * Ownership. A lane has one side and everything solid in it is yours; four
 * armies in one arena do not, and §14.2's channels are all spent on what a
 * body is rather than whose it is. So each spoke's floor is tinted with its
 * seat's colour and each body wears a ring in the same colour - two readings
 * of the same fact, one of which survives at a glance across a crowded centre.
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import type { GameData } from '../data/schema.ts';
import type { ArenaShape, DefIndex, EntityView, LaneView, MatchView } from '../sim/index.ts';
import { LEGS } from '../sim/index.ts';
import { EntityLayer } from './entities.ts';
import { EffectsLayer } from './effects.ts';
import { arenaCamera, centredOn, type Camera, type Rect } from './layout.ts';
import { SEAT_COLOURS, UI } from './palette.ts';

/** How strongly a spoke's floor carries its owner's colour. A tint, not a fill. */
const SPOKE_TINT_ALPHA = 0.1;
/**
 * How strongly a held centre is tinted. Well above the spoke tint, because the
 * hill is a thing being won rather than a thing being owned: at 0.1 it read as
 * another piece of floor.
 */
const HELD_TINT_ALPHA = 0.3;

/** A drag shorter than this is a tap that missed, not a scroll. */
const DRAG_SLOP = 4;

/**
 * The arena as a `LaneView`, so the body and effect layers can draw it.
 *
 * Not a hack so much as an observation: those layers want a list of bodies and
 * a list of blows, which is exactly what an arena is. Everything else on a
 * `LaneView` is lane furniture the arena has none of - no monsters, no
 * fortress, no economy - and it is spelled out as empty here rather than left
 * for a reader to wonder about.
 */
export function arenaAsLane(view: MatchView): LaneView | null {
  const showdown = view.showdown;
  if (!showdown) return null;

  const units: EntityView[] = [];
  for (const army of showdown.armies) units.push(...army.units);

  return {
    teamId: view.teamId,
    builderId: view.lane?.builderId ?? '',
    units,
    monsters: [],
    fortress: {
      hp: 0,
      maxHp: 0,
      destroyed: true,
      weaponDamageType: 'impact',
      activeAura: null,
      auraRadius: 0,
      auraStrength: 0,
    },
    economy: null,
    reserveCount: 0,
    sendLog: [],
    attacks: showdown.attacks,
    unitSpend: [],
    unitDamage: [],
  };
}

/** Which seat each unit belongs to, by entity id, for the ownership rings. */
export function seatsById(view: MatchView): Map<number, number> {
  const out = new Map<number, number>();
  for (const army of view.showdown?.armies ?? []) {
    for (const unit of army.units) out.set(unit.id, army.seat);
  }
  return out;
}

/** The seat's colour, wrapped so a fifth seat could never throw. */
export function seatColour(seat: number): number {
  return SEAT_COLOURS[((seat % SEAT_COLOURS.length) + SEAT_COLOURS.length) % SEAT_COLOURS.length]!;
}

export class ArenaStage extends Container {
  private readonly ground = new Graphics();
  private readonly entities: EntityLayer;
  private readonly effectsLayer: EffectsLayer;
  private readonly touch = new Container();

  private camera: Camera;
  /** Where the arena's top-left wants to be, before clamping. */
  private offset = { x: 0, y: 0 };
  private screen: Rect;
  private dragging: { pointerX: number; pointerY: number; moved: number } | null = null;
  private seats = new Map<number, number>();
  private readonly centre = new Graphics();
  /** Recentred once, when the arena first appears, and never again. */
  private framed = false;

  constructor(
    private readonly shape: ArenaShape,
    screen: Rect,
    /** The lane's tile size: the arena is never drawn larger than this. */
    private laneTileSize: number,
    data: GameData,
    defs: DefIndex,
  ) {
    super();
    this.screen = screen;
    this.camera = arenaCamera(screen.width, screen.height, shape.size, laneTileSize, this.offset);
    this.entities = new EntityLayer(this.camera, defs);
    this.effectsLayer = new EffectsLayer(this.camera, data, defs);
    // The hill goes over the ground and under the bodies: it is painted
    // ground, and it must never obscure the fight standing on it.
    this.addChild(this.ground, this.centre, this.entities, this.effectsLayer, this.touch);
    this.installTouchArea();
    this.drawGround();
  }

  setLayout(screen: Rect, laneTileSize: number): void {
    this.screen = screen;
    this.laneTileSize = laneTileSize;
    // A resize should keep looking at what it was looking at, so the point
    // currently at the middle of the screen stays there.
    this.framed = false;
    this.recompute();
    this.installTouchArea();
  }

  /** Drop the interpolation and any swing still in the air, for a fresh arena. */
  reset(): void {
    this.entities.reset();
    this.effectsLayer.reset();
    this.framed = false;
  }

  captureTick(lane: LaneView | null): void {
    this.entities.captureTick(lane);
  }

  spawnEffects(incoming: LaneView, outgoing: LaneView | null): void {
    this.effectsLayer.spawn(incoming, outgoing);
  }

  update(deltaMs: number): void {
    this.effectsLayer.update(deltaMs);
  }

  render(view: MatchView, lane: LaneView, alpha: number): void {
    if (!this.framed) {
      // Open on the middle. Everything converges there, and a player who wants
      // to watch their own spoke instead is one drag away.
      this.offset = centredOn(this.screen.width, this.screen.height, this.camera.tileSize, {
        x: this.shape.size / 2,
        y: this.shape.size / 2,
      });
      this.framed = true;
      this.recompute();
    }

    this.seats = seatsById(view);
    this.drawCentre(view);
    this.entities.render(lane, alpha, {
      ringOf: (unit) => {
        const seat = this.seats.get(unit.id);
        return seat === undefined ? null : seatColour(seat);
      },
    });
    this.effectsLayer.render();
  }

  // ------------------------------------------------------------------ camera

  private recompute(): void {
    this.camera = arenaCamera(
      this.screen.width,
      this.screen.height,
      this.shape.size,
      this.laneTileSize,
      this.offset,
    );
    // The clamped origin is the truth; keeping the unclamped one would let a
    // drag build up slack that has to be dragged back out before anything
    // moves again.
    this.offset = { ...this.camera.gridOrigin };
    this.entities.setLayout(this.camera);
    this.effectsLayer.setLayout(this.camera);
    this.drawGround();
  }

  /**
   * The cross: two overlapping bars, the four spokes tinted by seat, and the
   * square where they meet picked out a shade lighter.
   *
   * Drawn from the simulation's own geometry (arena.ts), so the ground a body
   * may stand on is exactly the ground that is drawn. The corners of the
   * bounding square are not part of the arena and are not painted - that is
   * what makes the shape legible as a cross rather than as a square with
   * decoration on it.
   */
  private drawGround(): void {
    const g = this.ground;
    const { tileSize, gridOrigin } = this.camera;
    const { spokeLength, spokeWidth, size } = this.shape;
    const px = (tiles: number) => tiles * tileSize;
    const at = (x: number, y: number, w: number, h: number) =>
      g.rect(gridOrigin.x + px(x), gridOrigin.y + px(y), px(w), px(h));

    g.clear();
    g.rect(0, 0, this.screen.width, this.screen.height).fill({ color: UI.background });

    // Vertical bar, then horizontal: their union is the cross.
    at(spokeLength, 0, spokeWidth, size).fill({ color: UI.arenaFloor });
    at(0, spokeLength, size, spokeWidth).fill({ color: UI.arenaFloor });

    // Whose ground is whose, in the order arena.ts seats them: clockwise from
    // south. The tint stops at the centre, which belongs to nobody.
    const far = spokeLength + spokeWidth;
    const spokes: Record<(typeof LEGS)[number], [number, number, number, number]> = {
      south: [spokeLength, far, spokeWidth, spokeLength],
      west: [0, spokeLength, spokeLength, spokeWidth],
      north: [spokeLength, 0, spokeWidth, spokeLength],
      east: [far, spokeLength, spokeLength, spokeWidth],
    };
    LEGS.forEach((leg, seat) => {
      const [x, y, w, h] = spokes[leg];
      at(x, y, w, h).fill({ color: seatColour(seat), alpha: SPOKE_TINT_ALPHA });
    });

    at(spokeLength, spokeLength, spokeWidth, spokeWidth).fill({ color: UI.arenaCentre });

    // An outline around the whole cross, so its edge reads as a wall rather
    // than as where the paint happened to stop.
    at(spokeLength, 0, spokeWidth, size).stroke({ width: 1, color: UI.panelEdge });
    at(0, spokeLength, size, spokeWidth).stroke({ width: 1, color: UI.panelEdge });
  }

  /**
   * Who holds the hill, painted on it (§3.3, replaced).
   *
   * A prize nobody can see is a prize nobody plays for, and the whole point of
   * the centre buff is to pull armies into the middle - so the middle has to
   * say who is winning it. The square takes the holder's seat colour, and a
   * TIE splits it into a band each, which reads as contested rather than as
   * somebody having quietly taken it.
   *
   * Redrawn every frame rather than on layout, unlike the rest of the ground:
   * it is the one part of the floor that changes while nothing else does.
   */
  private drawCentre(view: MatchView): void {
    const g = this.centre;
    g.clear();

    const holders = view.showdown?.centreHolders ?? [];
    const { tileSize, gridOrigin } = this.camera;
    const { spokeLength, spokeWidth } = this.shape;
    const x = gridOrigin.x + spokeLength * tileSize;
    const y = gridOrigin.y + spokeLength * tileSize;
    const side = spokeWidth * tileSize;

    if (holders.length === 0) {
      // Nobody is standing there. An outline only, so the square still reads as
      // somewhere worth being rather than as empty floor.
      g.rect(x, y, side, side).stroke({ width: 1, color: UI.panelEdge });
      return;
    }

    const seatOf = new Map(view.showdown?.armies.map((army) => [army.teamId, army.seat]) ?? []);
    const band = side / holders.length;
    holders.forEach((teamId, index) => {
      const seat = seatOf.get(teamId);
      if (seat === undefined) return;
      g.rect(x + index * band, y, band, side).fill({
        color: seatColour(seat),
        alpha: HELD_TINT_ALPHA,
      });
    });

    // One outline in the leader's colour when it is held outright, and in the
    // neutral edge colour when it is shared - a contested hill should not look
    // like a won one.
    const outline = holders.length === 1 ? seatColour(seatOf.get(holders[0]!) ?? 0) : UI.outline;
    g.rect(x, y, side, side).stroke({ width: 2, color: outline, alpha: 0.9 });
  }

  // ------------------------------------------------------------------- input

  /**
   * Drag to scroll. One surface over the whole screen, because in the showdown
   * there is nothing else to tap: no tiles to build on, no bar to buy from.
   */
  private installTouchArea(): void {
    this.touch.removeChildren();

    const surface = new Container();
    surface.eventMode = 'static';
    surface.hitArea = new Rectangle(0, 0, this.screen.width, this.screen.height);
    surface.on('pointerdown', (event: FederatedPointerEvent) => {
      this.dragging = { pointerX: event.global.x, pointerY: event.global.y, moved: 0 };
    });
    surface.on('globalpointermove', (event: FederatedPointerEvent) => this.drag(event));
    surface.on('pointerup', () => (this.dragging = null));
    surface.on('pointerupoutside', () => (this.dragging = null));

    this.touch.addChild(surface);
  }

  private drag(event: FederatedPointerEvent): void {
    const from = this.dragging;
    if (!from) return;

    const dx = event.global.x - from.pointerX;
    const dy = event.global.y - from.pointerY;
    from.moved += Math.abs(dx) + Math.abs(dy);
    from.pointerX = event.global.x;
    from.pointerY = event.global.y;
    if (from.moved < DRAG_SLOP) return;

    this.offset = { x: this.offset.x + dx, y: this.offset.y + dy };
    this.recompute();
  }
}
