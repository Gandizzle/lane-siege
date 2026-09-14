/**
 * Attack animations. DESIGN.md §14.2, §15.1.
 *
 * The simulation records who hit what on each tick (`LaneView.attacks`) and
 * this layer turns that into something to look at. Nothing here can affect the
 * match: an effect is spawned from a blow that has already landed, its damage
 * was applied before it was drawn, and a client with this layer deleted plays
 * exactly the same game.
 *
 * IT NEVER TOUCHES A BODY
 *
 * No effect moves, resizes, or draws over an attacker or a target. A melee
 * swing is an arc struck OUTSIDE the attacker's circle; the spark that follows
 * it sits on the target's edge. That is deliberate and it is the reason melee
 * is a swing rather than the obvious lunge-and-return: the drawn circle is also
 * the collision circle and the hit circle (motion.ts), so a lunge would either
 * be a lie about where the body is or a change to where it is. The animation
 * layer stays strictly decorative, and the crowd behaviour that took eleven
 * attempts to get right stays untouched.
 *
 * EVERY EFFECT IS A FILLED SHAPE, NEVER A STROKED PATH
 *
 * Pixi v8 carries path state between draws: after each fill or stroke it seeds
 * the next path with a `moveTo` at the previous path's last point, and where
 * there is no previous point it seeds (0, 0) - the top-left of the screen. A
 * stroked path that picks that seed up draws a line to it, which reads as a
 * laser fired from the corner of the screen. Rather than guard every call site
 * against that, nothing here strokes a path: every effect is an explicit list
 * of vertices passed to `poly()` and filled, and a `moveTo` at the shape's own
 * first vertex pins the seed to the shape itself. A connector cannot be drawn
 * because there is nothing to connect.
 *
 * POSITIONS ARE IN TILES
 *
 * An effect stores where it is in tile space and is converted to pixels at draw
 * time, so a resize mid-flight moves it with everything else rather than
 * leaving it at a stale pixel address.
 *
 * WHERE THE ENDS OF AN ATTACK COME FROM
 *
 * An attack names two ids. Both are resolved against the lane view it arrived
 * with, and then against the OUTGOING one - because a body that died on the
 * same tick it was hit is already gone from the new view, and a shot with
 * nowhere to land is worse than one that lands on a corpse's last known
 * position. An attacker that cannot be found at all is skipped: it is one
 * missing flourish on the tick something died, which nobody sees.
 */

import { Container, Graphics } from 'pixi.js';
import type { DefIndex, LaneView } from '../sim/index.ts';
import { FORTRESS_ID } from '../sim/index.ts';
import type { GameData } from '../data/schema.ts';
import { stat } from '../sim/defs.ts';
import type { LaneLayout } from './layout.ts';
import { attackStyle, type AttackStyle } from './attackStyle.ts';

/**
 * Melee happens ON TOP of the bodies, and an attacker's own colour is the
 * colour of the thing it is hitting as often as not - a hammer and a grub are
 * both Impact, so an amber swing between two amber bodies disappears. So the
 * flash is drawn at the same hue, mixed toward white: still the damage-type
 * channel §14.2 defines, but bright enough to read against a body wearing it.
 */
function lighten(colour: number, amount: number): number {
  const mix = (channel: number) => Math.round(channel + (255 - channel) * amount);
  return (mix((colour >> 16) & 0xff) << 16) | (mix((colour >> 8) & 0xff) << 8) | mix(colour & 0xff);
}

/** How much of the way to white a melee flash sits. */
const FLASH_LIGHTEN = 0.5;

/** How long a melee swing lasts, in milliseconds. */
const SWING_MS = 170;
/** How long the spark at the point of contact lasts. */
const SPARK_MS = 150;
/** How long a projectile's arrival flash lasts. */
const IMPACT_MS = 130;

/**
 * A ceiling on live effects, so a pathological tick cannot turn into a frame
 * that takes a second to draw. At the §15.3 load a busy tick lands perhaps
 * twenty blows and each lives about a fifth of a second, so the real number
 * sits an order of magnitude below this.
 */
const MAX_EFFECTS = 256;

interface Vec {
  x: number;
  y: number;
}

interface BaseEffect {
  /** Milliseconds lived so far, and the total it gets. */
  age: number;
  life: number;
  colour: number;
}

interface Swing extends BaseEffect {
  kind: 'swing';
  /** The attacker, in tiles. Captured once: the body may move or die. */
  at: Vec;
  /** Radians, pointing at what was hit. */
  angle: number;
  /** Body radius in tiles, so the arc clears the silhouette. */
  radius: number;
}

interface Spark extends BaseEffect {
  kind: 'spark';
  at: Vec;
  angle: number;
  size: number;
}

interface Projectile extends BaseEffect {
  kind: 'projectile';
  from: Vec;
  to: Vec;
  style: AttackStyle;
  /** Set once the head arrives, so the impact is spawned exactly once. */
  landed: boolean;
}

interface Impact extends BaseEffect {
  kind: 'impact';
  at: Vec;
  size: number;
}

type Effect = Swing | Spark | Projectile | Impact;

export class EffectsLayer extends Container {
  private readonly graphics = new Graphics();
  /** Named `live` rather than `effects`: Pixi's Container already owns that. */
  private readonly live: Effect[] = [];
  private readonly fortressAt: Vec;

  constructor(
    private layout: LaneLayout,
    private readonly data: GameData,
    private readonly defs: DefIndex,
  ) {
    super();
    const lane = data.lane;
    this.fortressAt = {
      x: lane.buildZone.width / 2,
      y: lane.buildZone.depth + lane.fortressZoneDepth * 0.5,
    };
    this.addChild(this.graphics);
  }

  setLayout(layout: LaneLayout): void {
    this.layout = layout;
  }

  /**
   * What is in flight. For the tests, and for a diagnostic readout - nothing in
   * the game reads it, because nothing in the game may depend on an animation.
   */
  get liveCount(): number {
    return this.live.length;
  }

  liveKinds(): string[] {
    return this.live.map((effect) => effect.kind);
  }

  /** A new match, or a switch to another lane: nothing in flight belongs here. */
  reset(): void {
    this.live.length = 0;
    this.graphics.clear();
  }

  /**
   * Turn this tick's blows into effects.
   *
   * `incoming` is the lane as it is now; `outgoing` is the lane it replaced,
   * consulted only for bodies that have since died.
   */
  spawn(incoming: LaneView, outgoing: LaneView | null): void {
    for (const attack of incoming.attacks) {
      if (this.live.length >= MAX_EFFECTS) return;

      const from = this.locate(attack.attackerId, incoming, outgoing);
      const to = this.locate(attack.targetId, incoming, outgoing);
      if (!from || !to) continue;

      const style = this.styleOf(attack.attackerId, incoming, outgoing);
      if (!style) continue;

      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < 1e-6) continue;
      const angle = Math.atan2(dy, dx);

      if (style.ranged) {
        this.live.push({
          kind: 'projectile',
          age: 0,
          // Long enough to cross the gap at this attacker's speed, and never
          // so long that a shot hangs in the air after its target is gone.
          life: Math.min(900, (distance / style.speed) * 1000),
          colour: style.colour,
          from: { x: from.x, y: from.y },
          to: { x: to.x, y: to.y },
          style,
          landed: false,
        });
        continue;
      }

      const radius = this.radiusOf(attack.attackerId, incoming, outgoing) ?? 0.26;
      this.live.push({
        kind: 'swing',
        age: 0,
        life: SWING_MS,
        colour: style.colour,
        at: { x: from.x, y: from.y },
        angle,
        radius,
      });

      // The spark sits on the target's edge, which is where the blow actually
      // arrives - not at the midpoint, which reads as a near miss.
      const targetRadius = this.radiusOf(attack.targetId, incoming, outgoing) ?? 0.22;
      this.live.push({
        kind: 'spark',
        age: 0,
        life: SPARK_MS,
        colour: style.colour,
        at: {
          x: to.x - Math.cos(angle) * targetRadius,
          y: to.y - Math.sin(angle) * targetRadius,
        },
        angle,
        size: targetRadius,
      });
    }
  }

  /** Advance every effect by one frame of wall time and drop the finished ones. */
  update(deltaMs: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const effect = this.live[i]!;
      effect.age += deltaMs;

      if (effect.kind === 'projectile' && !effect.landed && effect.age >= effect.life) {
        effect.landed = true;
        if (this.live.length < MAX_EFFECTS) {
          this.live.push({
            kind: 'impact',
            age: 0,
            life: IMPACT_MS,
            colour: effect.colour,
            at: { x: effect.to.x, y: effect.to.y },
            size: effect.style.size * 2.4,
          });
        }
      }

      if (effect.age >= effect.life) this.live.splice(i, 1);
    }
  }

  render(): void {
    this.graphics.clear();
    for (const effect of this.live) {
      switch (effect.kind) {
        case 'projectile':
          this.drawProjectile(effect);
          break;
        case 'swing':
          this.drawSwing(effect);
          break;
        case 'spark':
          this.drawSpark(effect);
          break;
        case 'impact':
          this.drawImpact(effect);
          break;
      }
    }
  }

  // ------------------------------------------------------------------ drawing

  private toPixel(at: Vec): Vec {
    const { gridOrigin, tileSize } = this.layout;
    return { x: gridOrigin.x + at.x * tileSize, y: gridOrigin.y + at.y * tileSize };
  }

  private drawProjectile(effect: Projectile): void {
    const t = Math.min(1, effect.age / effect.life);
    const tile = this.layout.tileSize;
    const head = this.toPixel({
      x: effect.from.x + (effect.to.x - effect.from.x) * t,
      y: effect.from.y + (effect.to.y - effect.from.y) * t,
    });
    const angle = Math.atan2(effect.to.y - effect.from.y, effect.to.x - effect.from.x);
    const r = Math.max(1.5, effect.style.size * tile);
    const g = this.graphics;

    // The trail first, so the head draws over it. Dots are spaced behind the
    // head along its own flight line; the count is the attacker's armour
    // family (attackStyle.ts).
    for (let i = 1; i <= effect.style.trail; i++) {
      const back = r * 1.8 * i;
      g.circle(
        head.x - Math.cos(angle) * back,
        head.y - Math.sin(angle) * back,
        r * (0.5 - i * 0.1),
      ).fill({ color: effect.colour, alpha: 0.45 / i });
    }

    switch (effect.style.shape) {
      case 'dart': {
        // A thin spike along the line of flight.
        const nose = r * 2.1;
        const half = r * 0.62;
        const nx = Math.cos(angle);
        const ny = Math.sin(angle);
        g.poly([
          head.x + nx * nose,
          head.y + ny * nose,
          head.x - ny * half - nx * r * 0.6,
          head.y + nx * half - ny * r * 0.6,
          head.x + ny * half - nx * r * 0.6,
          head.y - nx * half - ny * r * 0.6,
        ]).fill({ color: effect.colour });
        break;
      }
      case 'slug':
        g.circle(head.x, head.y, r).fill({ color: effect.colour });
        break;
      case 'shell': {
        g.circle(head.x, head.y, r).fill({ color: effect.colour });
        // The ring is a filled annulus rather than a stroked circle, for the
        // same reason everything else here is filled.
        const ring = r * 1.75;
        const band = Math.max(0.6, r * 0.4);
        const steps = 12;
        const points: number[] = [];
        for (let i = 0; i <= steps; i++) {
          const a = (Math.PI * 2 * i) / steps;
          points.push(head.x + Math.cos(a) * (ring + band), head.y + Math.sin(a) * (ring + band));
        }
        for (let i = steps; i >= 0; i--) {
          const a = (Math.PI * 2 * i) / steps;
          points.push(head.x + Math.cos(a) * ring, head.y + Math.sin(a) * ring);
        }
        this.fillShape(points, effect.colour, 0.65);
        break;
      }
      case 'mote': {
        const d = r * 1.35;
        g.poly([
          head.x,
          head.y - d,
          head.x + d,
          head.y,
          head.x,
          head.y + d,
          head.x - d,
          head.y,
        ]).fill({ color: effect.colour });
        g.circle(head.x, head.y, d * 1.5).fill({ color: effect.colour, alpha: 0.18 });
        break;
      }
    }
  }

  /**
   * A swing: a crescent sweeping across the attacker's near face, in the
   * direction of the blow.
   *
   * Built as one polygon - an outer arc and an inner arc back again - so it is
   * a single filled shape with no path state to leak (see the note at the top).
   * It grows to full width halfway through its life and thins away again, which
   * is what makes it read as a swing rather than as a shape being switched on.
   */
  private drawSwing(effect: Swing): void {
    const t = Math.min(1, effect.age / effect.life);
    const centre = this.toPixel(effect.at);
    const tile = this.layout.tileSize;

    // Just clear of the silhouette, reaching toward what was hit.
    const middle = effect.radius * tile * 1.25;
    // Fat in the middle of the swing, nothing at either end.
    const envelope = Math.sin(t * Math.PI);
    const thickness = effect.radius * tile * 0.5 * envelope;
    if (thickness < 0.4) return;

    // Sweeps THROUGH the direction of the blow rather than starting on it, so
    // it reads as passing across the enemy rather than stopping at it.
    const span = Math.PI * 0.62;
    const from = effect.angle + (-0.5 + t) * Math.PI * 0.45 - span / 2;

    const steps = 10;
    const outer = middle + thickness / 2;
    const inner = middle - thickness / 2;
    const points: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const a = from + (span * i) / steps;
      points.push(centre.x + Math.cos(a) * outer, centre.y + Math.sin(a) * outer);
    }
    for (let i = steps; i >= 0; i--) {
      const a = from + (span * i) / steps;
      points.push(centre.x + Math.cos(a) * inner, centre.y + Math.sin(a) * inner);
    }

    this.fillShape(points, lighten(effect.colour, FLASH_LIGHTEN), 0.95 * (1 - t * t));
  }

  /**
   * The blow landing: a few short filled slivers fanning out of the point of
   * contact, thrown along the line of the strike.
   */
  private drawSpark(effect: Spark): void {
    const t = Math.min(1, effect.age / effect.life);
    const at = this.toPixel(effect.at);
    const tile = this.layout.tileSize;
    const length = effect.size * tile * (0.5 + 0.9 * t);
    const width = Math.max(0.6, effect.size * tile * 0.26 * (1 - t));
    const alpha = 0.95 * (1 - t);

    for (let i = -1; i <= 1; i++) {
      // The outer two are shorter, so the burst has a shape rather than being
      // three lines of equal length.
      const reach = length * (i === 0 ? 1 : 0.7);
      const a = effect.angle + i * 0.6;
      const tipX = at.x + Math.cos(a) * reach;
      const tipY = at.y + Math.sin(a) * reach;
      // A sliver: wide at the contact point, a point at the far end.
      const nx = -Math.sin(a) * width;
      const ny = Math.cos(a) * width;
      this.fillShape(
        [at.x + nx, at.y + ny, tipX, tipY, at.x - nx, at.y - ny],
        lighten(effect.colour, FLASH_LIGHTEN),
        alpha,
      );
    }
  }

  /** A ring opening where a shot landed. A filled annulus, not a stroke. */
  private drawImpact(effect: Impact): void {
    const t = Math.min(1, effect.age / effect.life);
    const at = this.toPixel(effect.at);
    const radius = effect.size * this.layout.tileSize * (0.5 + t);
    const thickness = Math.max(0.6, radius * 0.3 * (1 - t));

    const steps = 14;
    const points: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const a = (Math.PI * 2 * i) / steps;
      points.push(
        at.x + Math.cos(a) * (radius + thickness),
        at.y + Math.sin(a) * (radius + thickness),
      );
    }
    for (let i = steps; i >= 0; i--) {
      const a = (Math.PI * 2 * i) / steps;
      points.push(at.x + Math.cos(a) * radius, at.y + Math.sin(a) * radius);
    }
    this.fillShape(points, effect.colour, 0.75 * (1 - t));
  }

  /**
   * One filled polygon, with the path seed pinned to its own first vertex.
   *
   * The `moveTo` is the whole reason this is a method rather than two lines at
   * each call site: it guarantees that whatever point Pixi carried over from
   * the previous draw is replaced by a point on this shape, so a connector
   * drawn from it would have zero length. See the note at the top of the file.
   */
  private fillShape(points: readonly number[], colour: number, alpha: number): void {
    if (alpha <= 0.01 || points.length < 6) return;
    this.graphics
      .moveTo(points[0]!, points[1]!)
      .poly(points as number[])
      .fill({ color: colour, alpha });
  }

  // ----------------------------------------------------------------- lookups

  private locate(id: number, incoming: LaneView, outgoing: LaneView | null): Vec | null {
    if (id === FORTRESS_ID) return this.fortressAt;
    const body = findBody(id, incoming) ?? (outgoing ? findBody(id, outgoing) : undefined);
    return body ? { x: body.x, y: body.y } : null;
  }

  private radiusOf(id: number, incoming: LaneView, outgoing: LaneView | null): number | null {
    if (id === FORTRESS_ID) return this.data.lane.fortressRadius;
    const body = findBody(id, incoming) ?? (outgoing ? findBody(id, outgoing) : undefined);
    return body ? body.radius : null;
  }

  /**
   * What the attacker's blow looks like, read off its definition.
   *
   * The fortress weapon has no definition in units.json - it is the lane's own
   * gun (§10.1) - so its style comes from the fortress data and the damage type
   * the player picked, which is exactly what everyone can already see.
   */
  private styleOf(id: number, incoming: LaneView, outgoing: LaneView | null): AttackStyle | null {
    if (id === FORTRESS_ID) {
      const weapon = this.data.fortress.weapon;
      return attackStyle({
        damageType: incoming.fortress.weaponDamageType,
        armour: this.data.fortress.armour,
        range: stat(weapon.range),
        damage: stat(weapon.damage),
      });
    }

    const body = findBody(id, incoming) ?? (outgoing ? findBody(id, outgoing) : undefined);
    if (!body) return null;

    const unit = this.defs.units.get(body.defId);
    if (unit) {
      return attackStyle({
        damageType: body.damageType,
        armour: body.armour,
        range: stat(unit.range),
        damage: stat(unit.damage),
        tier: unit.tier,
      });
    }

    const monster = this.defs.monsters.get(body.defId);
    if (monster) {
      return attackStyle({
        damageType: body.damageType,
        armour: body.armour,
        range: stat(monster.range),
        damage: stat(monster.damage),
      });
    }

    return null;
  }
}

function findBody(id: number, lane: LaneView) {
  return lane.units.find((u) => u.id === id) ?? lane.monsters.find((m) => m.id === id);
}
