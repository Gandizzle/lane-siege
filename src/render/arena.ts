/**
 * The Final Showdown's board. DESIGN.md §3.3 replaced, amending §14.1.
 *
 * Every other screen in this game is fixed: the whole lane fits one portrait
 * phone and the camera never moves (§14.1). The arena cannot be drawn that way
 * - the cross is 32 tiles on a side and the Y 29 by 25, against a lane's 8 by
 * 14, and shrinking either to fit would leave a body four pixels across - so
 * this is the one place with a camera you can move. It is zoomed out only as
 * far as it has to be and it scrolls with a drag; `arenaCamera` in layout.ts
 * holds both rules.
 *
 * Both shapes are drawn by one set of code, from the simulation's own spokes
 * (arena.ts): each spoke is a rectangle along its own direction, the middle is
 * the polygon their inner ends close, and the outline is the walk round all of
 * them. Which shape is on screen is the view's to say (`ShowdownView.layout`).
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
 * Ownership. A lane has one side and everything solid in it is yours; several
 * armies in one arena do not, and §14.2's channels are all spent on what a
 * body is rather than whose it is. So each spoke's floor is tinted with the
 * color of the seat fighting from it and each body wears a ring in the same
 * color - two readings of the same fact, one of which survives at a glance
 * across a crowded centre. A spoke nobody fights from - the two either side
 * of a duel - is left bare.
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import type { GameData } from '../data/schema.ts';
import type {
  ArenaLayout,
  ArenaShape,
  DefIndex,
  EntityView,
  LaneView,
  MatchView,
} from '../sim/index.ts';
import { ARENA_LAYOUTS, arenaShape } from '../sim/index.ts';
import { EntityLayer } from './entities.ts';
import { EffectsLayer } from './effects.ts';
import { arenaCamera, centredOn, type Camera, type Rect } from './layout.ts';
import { SEAT_COLORS, UI } from './palette.ts';
import { GroundView, isTextured, type BattlefieldId } from './battlefield.ts';

/** How strongly a spoke's floor carries its owner's color. A tint, not a fill. */
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
    reserveSends: 0,
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

/** The seat's color, wrapped so a fifth seat could never throw. */
export function seatColor(seat: number): number {
  return SEAT_COLORS[((seat % SEAT_COLORS.length) + SEAT_COLORS.length) % SEAT_COLORS.length]!;
}

/** A point in arena tiles, from the arena's top-left. */
interface Point {
  x: number;
  y: number;
}

/**
 * One spoke's own ground, as a polygon in arena tiles: from where the middle
 * stops to the spoke's far end, edge to edge. In the order inner right, outer
 * right, outer left, inner left - right and left as seen walking in.
 */
export function spokePolygon(shape: ArenaShape, spoke: number): Point[] {
  const d = shape.spokes[spoke]!;
  const half = shape.spokeWidth / 2;
  const at = (along: number, across: number): Point => ({
    x: shape.centre.x + along * d.x + across * d.y,
    y: shape.centre.y + along * d.y - across * d.x,
  });
  return [at(shape.hub, half), at(shape.reach, half), at(shape.reach, -half), at(shape.hub, -half)];
}

/**
 * The middle: the polygon the spokes' inner ends close. Its corners are the
 * inside corners between neighbouring spokes - the square's four on the cross,
 * the triangle's three on the Y.
 */
export function hubPolygon(shape: ArenaShape): Point[] {
  return shape.spokes.map((_, i) => spokePolygon(shape, i)[3]!);
}

/**
 * The whole arena's edge, once round: out along each spoke's near edge, across
 * its far end and back to the inside corner it shares with the next spoke,
 * which is where that spoke's walk starts.
 */
export function arenaOutline(shape: ArenaShape): Point[] {
  return shape.spokes.flatMap((_, i) => spokePolygon(shape, i).slice(0, 3));
}

/**
 * The part of a convex polygon between two vertical lines - one holder's band
 * of the middle when the hill is shared. Sutherland-Hodgman, two edges.
 */
export function clipToColumns(polygon: readonly Point[], minX: number, maxX: number): Point[] {
  const clip = (points: readonly Point[], inside: (p: Point) => boolean, x: number): Point[] => {
    const out: Point[] = [];
    points.forEach((p, i) => {
      const q = points[(i + 1) % points.length]!;
      const pIn = inside(p);
      const qIn = inside(q);
      if (pIn) out.push(p);
      if (pIn !== qIn) {
        const t = (x - p.x) / (q.x - p.x);
        out.push({ x, y: p.y + t * (q.y - p.y) });
      }
    });
    return out;
  };
  return clip(
    clip(polygon, (p) => p.x >= minX, minX),
    (p) => p.x <= maxX,
    maxX,
  );
}

export class ArenaStage extends Container {
  /** Both shapes, built once: which is on screen follows the view. */
  private readonly shapes: Record<ArenaLayout, ArenaShape>;
  private shape: ArenaShape;
  /** The shape's middle, kept rather than rebuilt: the hill is redrawn every frame. */
  private hub: Point[];
  private readonly ground = new Graphics();
  /**
   * The battlefield's painted floor (battlefield.ts), in arena space from its
   * top-left: painted once per zoom and skin and moved with the camera, since
   * a drag repaints `ground` every move and a painted floor is thousands of
   * shapes.
   */
  private readonly floor = new GroundView();
  /**
   * The floor's shape, when it is not a union of axis-aligned pieces: the Y's
   * spokes run at angles, so its floor is painted as one block and cut to the
   * outline by this.
   */
  private readonly floorMask = new Graphics();
  /** The seat tints, the centre and the wall line, over the floor. */
  private readonly marks = new Graphics();
  private battlefield: BattlefieldId = 'plain';
  /** What `floor` was last painted for: skin, shape and tile size. */
  private floorFor = '';
  /** Which seat fights from which spoke, for the tints: `[spoke, seat]`. */
  private occupants: [number, number][] = [];
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
    screen: Rect,
    /** The lane's tile size: the arena is never drawn larger than this. */
    private laneTileSize: number,
    data: GameData,
    defs: DefIndex,
  ) {
    super();
    const shapes = {} as Record<ArenaLayout, ArenaShape>;
    for (const layout of ARENA_LAYOUTS) shapes[layout] = arenaShape(data, layout);
    this.shapes = shapes;
    this.shape = shapes.cross;
    this.hub = hubPolygon(this.shape);
    this.screen = screen;
    this.camera = this.cameraFor(this.offset);
    this.entities = new EntityLayer(this.camera, defs);
    this.effectsLayer = new EffectsLayer(this.camera, data, defs);
    // The hill goes over the ground and under the bodies: it is painted
    // ground, and it must never obscure the fight standing on it.
    this.addChild(
      this.ground,
      this.floor,
      this.floorMask,
      this.marks,
      this.centre,
      this.entities,
      this.effectsLayer,
      this.touch,
    );
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

  /** Which ground to paint the arena on. Repaints only when it changes. */
  setBattlefield(id: BattlefieldId): void {
    if (id === this.battlefield) return;
    this.battlefield = id;
    this.drawGround();
  }

  /** Drop the interpolation and any swing still in the air, for a fresh arena. */
  reset(): void {
    this.entities.reset();
    this.effectsLayer.reset();
    this.framed = false;
    // The next fight may be a different shape with different people in it.
    this.occupants = [];
  }

  captureTick(lane: LaneView | null): void {
    this.entities.captureTick(lane);
  }

  spawnEffects(incoming: LaneView, outgoing: LaneView | null): void {
    // Nothing leaves the arena but by dying.
    this.effectsLayer.spawn(incoming, outgoing, 'all');
  }

  update(deltaMs: number): void {
    this.effectsLayer.update(deltaMs);
  }

  /** `statusTime` is the status markers' clock, or null with them turned off. */
  render(view: MatchView, lane: LaneView, alpha: number, statusTime: number | null = null): void {
    this.follow(view);
    if (!this.framed) {
      // Open on the middle. Everything converges there, and a player who wants
      // to watch their own spoke instead is one drag away.
      this.offset = centredOn(
        this.screen.width,
        this.screen.height,
        this.camera.tileSize,
        this.shape.centre,
      );
      this.framed = true;
      this.recompute();
    }

    this.seats = seatsById(view);
    this.drawCentre(view);
    this.entities.render(lane, alpha, {
      ringOf: (unit) => {
        const seat = this.seats.get(unit.id);
        return seat === undefined ? null : seatColor(seat);
      },
      statusTime,
    });
    this.effectsLayer.render();
  }

  /**
   * Take the shape and the seating from the view: the arena is chosen by who
   * reaches it (arena.ts, `seating`), so the stage cannot know it in advance.
   * Redraws only when either actually changes.
   */
  private follow(view: MatchView): void {
    const showdown = view.showdown;
    if (!showdown) return;

    const shape = this.shapes[showdown.layout] ?? this.shapes.cross;
    const occupants = showdown.armies.map((army): [number, number] => [army.spoke, army.seat]);
    const same =
      shape === this.shape &&
      occupants.length === this.occupants.length &&
      occupants.every(([spoke, seat], i) => {
        const [was, wasSeat] = this.occupants[i]!;
        return spoke === was && seat === wasSeat;
      });
    if (same) return;

    if (shape !== this.shape) {
      this.shape = shape;
      this.hub = hubPolygon(shape);
      // A different shape has a different middle to open on.
      this.framed = false;
    }
    this.occupants = occupants;
    this.recompute();
  }

  // ------------------------------------------------------------------ camera

  private cameraFor(offset: { x: number; y: number }): Camera {
    return arenaCamera(
      this.screen.width,
      this.screen.height,
      this.shape.width,
      this.shape.depth,
      this.laneTileSize,
      offset,
    );
  }

  private recompute(): void {
    this.camera = this.cameraFor(this.offset);
    // The clamped origin is the truth; keeping the unclamped one would let a
    // drag build up slack that has to be dragged back out before anything
    // moves again.
    this.offset = { ...this.camera.gridOrigin };
    this.entities.setLayout(this.camera);
    this.effectsLayer.setLayout(this.camera);
    this.drawGround();
  }

  /**
   * The arena's ground: the floor, each occupied spoke tinted by the seat
   * fighting from it, and the middle picked out a shade lighter.
   *
   * Drawn from the simulation's own geometry (arena.ts), so the ground a body
   * may stand on is exactly the ground that is drawn. The rest of the bounding
   * box is not part of the arena and is not painted - that is what makes the
   * shape legible as a cross or a Y rather than as a rectangle with decoration
   * on it.
   */
  private drawGround(): void {
    const g = this.ground;
    const { tileSize, gridOrigin } = this.camera;
    const textured = isTextured(this.battlefield);
    const flat = (points: readonly Point[]): number[] =>
      points.flatMap((p) => [gridOrigin.x + p.x * tileSize, gridOrigin.y + p.y * tileSize]);
    const outline = flat(arenaOutline(this.shape));

    g.clear();
    g.rect(0, 0, this.screen.width, this.screen.height).fill({ color: UI.background });

    // A painted ground brings its own floor instead.
    if (!textured) g.poly(outline).fill({ color: UI.arenaFloor });
    this.paintFloor();
    this.floor.position.set(gridOrigin.x, gridOrigin.y);
    this.floorMask.position.set(gridOrigin.x, gridOrigin.y);

    // Whose ground is whose. The tint stops at the middle, which belongs to
    // nobody.
    const m = this.marks;
    m.clear();
    for (const [spoke, seat] of this.occupants) {
      if (spoke >= this.shape.spokes.length) continue;
      m.poly(flat(spokePolygon(this.shape, spoke))).fill({
        color: seatColor(seat),
        alpha: SPOKE_TINT_ALPHA,
      });
    }

    m.poly(flat(this.hub)).fill({
      color: UI.arenaCentre,
      alpha: textured ? 0.5 : 1,
    });

    // An outline around the whole arena, so its edge reads as a wall rather
    // than as where the paint happened to stop.
    m.poly(outline).stroke({ width: 1, color: UI.panelEdge });
  }

  /**
   * The arena in the battlefield's ground.
   *
   * The cross is three pieces that do not overlap - the vertical bar, and the
   * two arms either side of it - so no part is painted twice and nothing needs
   * masking to its shape. The Y's spokes run at angles a painted rectangle
   * cannot follow, so it is painted as one block over its bounding box and cut
   * to its outline.
   */
  private paintFloor(): void {
    const key = `${this.battlefield}:${this.shape.layout}:${this.camera.tileSize}`;
    if (key === this.floorFor) return;
    this.floorFor = key;
    const t = this.camera.tileSize;
    const { spokeLength, spokeWidth, width, depth, layout } = this.shape;
    const piece = (x: number, y: number, w: number, h: number): Rect => ({
      x: x * t,
      y: y * t,
      width: w * t,
      height: h * t,
    });

    if (layout === 'cross') {
      this.floor.mask = null;
      this.floorMask.clear();
      this.floor.paint(
        this.battlefield,
        [
          piece(spokeLength, 0, spokeWidth, width),
          piece(0, spokeLength, spokeLength, spokeWidth),
          piece(spokeLength + spokeWidth, spokeLength, spokeLength, spokeWidth),
        ],
        t,
      );
      return;
    }

    this.floor.paint(this.battlefield, [piece(0, 0, width, depth)], t);
    this.floorMask.clear();
    this.floorMask
      .poly(arenaOutline(this.shape).flatMap((p) => [p.x * t, p.y * t]))
      .fill({ color: 0xffffff });
    this.floor.mask = this.floorMask;
  }

  /** Move whatever moves in the floor (battlefield.ts, `GroundView.animate`). */
  animateGround(seconds: number): void {
    this.floor.animate(seconds);
  }

  /**
   * Who holds the hill, painted on it (§3.3, replaced).
   *
   * A prize nobody can see is a prize nobody plays for, and the whole point of
   * the centre buff is to pull armies into the middle - so the middle has to
   * say who is winning it. The square, or the Y's triangle, takes the holder's
   * seat color, and a TIE splits it into a band each, which reads as contested
   * rather than as somebody having quietly taken it.
   *
   * Redrawn every frame rather than on layout, unlike the rest of the ground:
   * it is the one part of the floor that changes while nothing else does.
   */
  private drawCentre(view: MatchView): void {
    const g = this.centre;
    g.clear();

    const holders = view.showdown?.centreHolders ?? [];
    const { tileSize, gridOrigin } = this.camera;
    const hub = this.hub;
    const flat = (points: readonly Point[]): number[] =>
      points.flatMap((p) => [gridOrigin.x + p.x * tileSize, gridOrigin.y + p.y * tileSize]);

    if (holders.length === 0) {
      // Nobody is standing there. An outline only, so the middle still reads
      // as somewhere worth being rather than as empty floor.
      g.poly(flat(hub)).stroke({ width: 1, color: UI.panelEdge });
      return;
    }

    const seatOf = new Map(view.showdown?.armies.map((army) => [army.teamId, army.seat]) ?? []);
    let left = Infinity;
    let right = -Infinity;
    for (const p of hub) {
      left = Math.min(left, p.x);
      right = Math.max(right, p.x);
    }
    const band = (right - left) / holders.length;
    holders.forEach((teamId, index) => {
      const seat = seatOf.get(teamId);
      if (seat === undefined) return;
      const strip = clipToColumns(hub, left + index * band, left + (index + 1) * band);
      if (strip.length < 3) return;
      g.poly(flat(strip)).fill({ color: seatColor(seat), alpha: HELD_TINT_ALPHA });
    });

    // One outline in the leader's color when it is held outright, and in the
    // neutral edge color when it is shared - a contested hill should not look
    // like a won one.
    const outline = holders.length === 1 ? seatColor(seatOf.get(holders[0]!) ?? 0) : UI.outline;
    g.poly(flat(hub)).stroke({ width: 2, color: outline, alpha: 0.9 });
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
