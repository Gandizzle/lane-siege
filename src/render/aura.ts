/**
 * The fortress aura, drawn. DESIGN.md §10.1.
 *
 * §10.1 gives the player two separate purchases - Aura Power and Aura Radius -
 * and one choice of which of four auras is running. All three were invisible:
 * the weapon's damage type at least recoloured the shots it fired, but an aura
 * changed numbers behind the scenes and nothing on screen. A player could not
 * see which aura was on, how far it reached, or whether the last upgrade had
 * bought anything, which makes the whole tab a guess.
 *
 * THREE CHANNELS, ONE PER THING THE PLAYER BOUGHT
 *
 *   radius     the ground it covers, as a bright rim with a wash inside it
 *   type       what the ground does, as a motif that differs per aura
 *   strength   how hard all of it reads: opacity, and how much motif there is
 *
 * So buying Aura Radius visibly pushes the rim further up the lane, buying Aura
 * Power visibly thickens what is inside it, and switching aura visibly changes
 * the pattern. Nothing needs a legend: a unit standing inside the rim is buffed
 * and a unit outside it is not, which is exactly what `auraFor` computes.
 *
 * WHERE IT IS DRAWN
 *
 * Centred on the fortress and clipped to the lane, because that is where the
 * simulation measures it from - `auraFor` takes the distance from a unit to the
 * fortress centre, so the rim drawn here IS the boundary the buff uses. The
 * fortress is a wall across the end of the lane (motion.ts), so the aura reads
 * as a dome of held ground in front of it.
 *
 * Under the bodies, so it never obscures a fight, and on wall time like the
 * effects layer - a pulse is a property of the frame, not of the tick, and
 * nothing here is ever read back by the simulation.
 *
 * EVERY SHAPE IS FILLED; NOTHING STROKES A PATH. Pixi v8 carries path state
 * between draws and a stroked path can pick up a seed at (0, 0) - see the note
 * in effects.ts. Each shape below is an explicit vertex list passed to `poly()`
 * with a `moveTo` at its own first vertex.
 */

import { Container, Graphics } from 'pixi.js';
import type { AuraType, LaneFile } from '../data/schema.ts';
import type { LaneView } from '../sim/index.ts';
import type { LaneLayout } from './layout.ts';
import { fortressShape } from './layout.ts';

/**
 * A colour per aura, chosen away from `DAMAGE_COLOURS` on purpose: an aura is
 * not a damage type, and borrowing amber for the damage aura would say that a
 * ring of it was somehow Impact.
 */
const AURA_COLOURS: Record<AuraType, number> = {
  damage: 0xff6b6b, // a hot red: something hits harder in here
  attackSpeed: 0xffd166, // a quick yellow: something hits oftener
  armour: 0x8ecae6, // a cold blue: something is being shielded
  regeneration: 0x90d48a, // a living green: something is mending
};

/**
 * Strength at which the drawing is at full intensity. `fortress.auras.strength`
 * starts at 0.15 and its ladder climbs from there, so an un-upgraded aura reads
 * as present but thin and a fully upgraded one is unmistakable.
 */
const STRENGTH_FOR_FULL = 0.5;

/** Seconds for one full cycle of whatever the motif does. */
const PERIOD_SECONDS = 2.4;

/** Steps around the rim. Enough that the arc reads as a curve at phone size. */
const ARC_STEPS = 72;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export class AuraLayer extends Container {
  private readonly graphics = new Graphics();
  /** Wall-clock phase, in seconds, wrapped to the motif's period. */
  private clock = 0;
  private aura: AuraType | null = null;
  private radiusTiles = 0;
  private strength = 0;
  private shapes = 0;
  private drawnInk = 0;

  /** Filled shapes in the last frame. Introspection: two adds and no cost. */
  get shapeCount(): number {
    return this.shapes;
  }

  /**
   * How much was drawn, as the total opacity laid down. This is the strength
   * channel made measurable: buying Aura Power has to raise it, or the purchase
   * bought nothing a player can see.
   */
  get ink(): number {
    return this.drawnInk;
  }

  constructor(
    private layout: LaneLayout,
    private readonly lane: LaneFile,
  ) {
    super();
    this.addChild(this.graphics);
  }

  setLayout(layout: LaneLayout): void {
    this.layout = layout;
  }

  /** What to draw, off the view. Cheap, and safe to call every frame. */
  read(lane: LaneView | null): void {
    const fortress = lane?.fortress;
    const active = fortress?.activeAura ?? null;
    this.aura = isAuraType(active) ? active : null;
    this.radiusTiles = fortress?.auraRadius ?? 0;
    this.strength = fortress?.auraStrength ?? 0;
  }

  /** Advance the motif. `deltaMs` is wall time, never ticks. */
  update(deltaMs: number): void {
    this.clock = (this.clock + deltaMs / 1000) % PERIOD_SECONDS;
  }

  render(): void {
    const g = this.graphics;
    g.clear();
    this.shapes = 0;
    this.drawnInk = 0;

    if (this.aura === null || this.radiusTiles <= 0) return;

    const { cx, cy } = fortressShape(this.layout, this.lane);
    const radius = this.radiusTiles * this.layout.tileSize;
    const colour = AURA_COLOURS[this.aura];
    const intensity = clamp01(this.strength / STRENGTH_FOR_FULL);
    const phase = this.clock / PERIOD_SECONDS;

    // The ground it holds, and the rim that says where that stops.
    this.fillDisc(cx, cy, radius, colour, 0.05 + 0.09 * intensity);
    this.fillAnnulus(
      cx,
      cy,
      radius - Math.max(1.5, radius * 0.012),
      radius,
      colour,
      0.35 + 0.45 * intensity,
    );

    switch (this.aura) {
      case 'damage':
        this.drawSpikes(cx, cy, radius, colour, intensity, phase);
        break;
      case 'attackSpeed':
        this.drawPulses(cx, cy, radius, colour, intensity, phase);
        break;
      case 'armour':
        this.drawScales(cx, cy, radius, colour, intensity);
        break;
      case 'regeneration':
        this.drawMotes(cx, cy, radius, colour, intensity, phase);
        break;
    }
  }

  /**
   * DAMAGE: chevrons on the rim, pointing out of the fortress.
   *
   * Outward because that is the direction the buff acts in - everything inside
   * this line hits what is beyond it harder. More of them, and longer, the
   * stronger the aura.
   */
  private drawSpikes(
    cx: number,
    cy: number,
    radius: number,
    colour: number,
    intensity: number,
    phase: number,
  ): void {
    const count = 10 + Math.round(14 * intensity);
    const length = radius * (0.05 + 0.05 * intensity);
    const halfWidth = (Math.PI / count) * 0.45;
    // A slow rotation, so the ring reads as live rather than as a decal.
    const drift = phase * ((Math.PI * 2) / count);

    for (let i = 0; i < count; i++) {
      const a = drift + (Math.PI * 2 * i) / count;
      // Only the half facing up the lane: the other half is behind the wall.
      if (Math.sin(a) > 0.25) continue;
      const tip = radius + length;
      this.fillShape(
        [
          cx + Math.cos(a) * tip,
          cy + Math.sin(a) * tip,
          cx + Math.cos(a - halfWidth) * radius,
          cy + Math.sin(a - halfWidth) * radius,
          cx + Math.cos(a + halfWidth) * radius,
          cy + Math.sin(a + halfWidth) * radius,
        ],
        colour,
        0.4 + 0.45 * intensity,
      );
    }
  }

  /**
   * ATTACK SPEED: rings running outward, one after another.
   *
   * Speed is the one channel that reads as motion rather than as shape, so the
   * motif is the motion: rings leave the wall and reach the rim, and a stronger
   * aura runs more of them at once.
   */
  private drawPulses(
    cx: number,
    cy: number,
    radius: number,
    colour: number,
    intensity: number,
    phase: number,
  ): void {
    const rings = 2 + Math.round(2 * intensity);
    for (let i = 0; i < rings; i++) {
      const t = (phase + i / rings) % 1;
      const r = radius * (0.15 + 0.85 * t);
      // Fades as it goes, so the rim is where a pulse ends rather than where it
      // is cut off.
      const alpha = (0.18 + 0.4 * intensity) * (1 - t);
      this.fillAnnulus(cx, cy, r - Math.max(1, radius * 0.008), r, colour, alpha);
    }
  }

  /**
   * ARMOUR: a lattice of scales, still.
   *
   * Armour is the one aura that does nothing until something hits you, so its
   * motif does not move either. A stronger aura closes the lattice up.
   */
  private drawScales(
    cx: number,
    cy: number,
    radius: number,
    colour: number,
    intensity: number,
  ): void {
    const rows = 3;
    const alpha = 0.16 + 0.34 * intensity;
    for (let row = 1; row <= rows; row++) {
      const r = (radius * row) / (rows + 0.35);
      const count = 6 + row * 4;
      const span = ((Math.PI * 2) / count) * (0.3 + 0.25 * intensity);
      const thickness = Math.max(1, radius * 0.01);
      for (let i = 0; i < count; i++) {
        const a = (Math.PI * 2 * i) / count + (row % 2 ? span : 0);
        if (Math.sin(a) > 0.35) continue;
        this.fillArc(cx, cy, r - thickness, r, a - span, a + span, colour, alpha);
      }
    }
  }

  /**
   * REGENERATION: motes rising through the held ground.
   *
   * Drifting up the lane rather than in circles, because regeneration is the
   * one aura that gives something back over time and a thing being returned
   * should look like it is travelling.
   */
  private drawMotes(
    cx: number,
    cy: number,
    radius: number,
    colour: number,
    intensity: number,
    phase: number,
  ): void {
    const count = 8 + Math.round(16 * intensity);
    const size = Math.max(1.4, radius * 0.014) * (0.8 + 0.5 * intensity);

    for (let i = 0; i < count; i++) {
      // A fixed pseudo-scatter: the same motes every frame, moving, rather than
      // a new sprinkle each frame, which reads as static rather than as drift.
      const seed = (i * 0.6180339887) % 1;
      const across = (seed * 2 - 1) * 0.92;
      const t = (phase + seed * 3.7) % 1;
      const x = cx + across * radius;
      const y = cy - t * radius * 0.95;
      // Inside the circle, or it would sit on ground the aura does not hold.
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > radius * radius) continue;
      // Brightest in the middle of the climb, so they fade in and out.
      const alpha = (0.35 + 0.45 * intensity) * Math.sin(t * Math.PI);
      this.fillDisc(x, y, size, colour, alpha);
    }
  }

  // ------------------------------------------------------------------ shapes

  private fillDisc(x: number, y: number, r: number, colour: number, alpha: number): void {
    if (alpha <= 0.01 || r <= 0) return;
    const points: number[] = [];
    const steps = r > 12 ? 24 : 10;
    for (let i = 0; i < steps; i++) {
      const a = (Math.PI * 2 * i) / steps;
      points.push(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    this.fillShape(points, colour, alpha);
  }

  private fillAnnulus(
    x: number,
    y: number,
    inner: number,
    outer: number,
    colour: number,
    alpha: number,
  ): void {
    this.fillArc(x, y, inner, outer, 0, Math.PI * 2, colour, alpha);
  }

  private fillArc(
    x: number,
    y: number,
    inner: number,
    outer: number,
    from: number,
    to: number,
    colour: number,
    alpha: number,
  ): void {
    if (alpha <= 0.01 || outer <= 0 || outer <= inner) return;
    const steps = Math.max(3, Math.round((ARC_STEPS * Math.abs(to - from)) / (Math.PI * 2)));
    const points: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const a = from + ((to - from) * i) / steps;
      points.push(x + Math.cos(a) * outer, y + Math.sin(a) * outer);
    }
    for (let i = steps; i >= 0; i--) {
      const a = from + ((to - from) * i) / steps;
      points.push(x + Math.cos(a) * inner, y + Math.sin(a) * inner);
    }
    this.fillShape(points, colour, alpha);
  }

  /** One filled polygon, with the path seed pinned to its own first vertex. */
  private fillShape(points: readonly number[], colour: number, alpha: number): void {
    if (alpha <= 0.01 || points.length < 6) return;
    this.shapes += 1;
    this.drawnInk += alpha;
    this.graphics
      .moveTo(points[0]!, points[1]!)
      .poly(points as number[])
      .fill({ color: colour, alpha });
  }
}

function isAuraType(value: string | null): value is AuraType {
  return (
    value === 'damage' || value === 'attackSpeed' || value === 'armour' || value === 'regeneration'
  );
}

/** The colour an aura is drawn in, so the build bar can show the same one. */
export function auraColour(aura: AuraType): number {
  return AURA_COLOURS[aura];
}

export { STRENGTH_FOR_FULL };
