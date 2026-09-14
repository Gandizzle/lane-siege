/**
 * The fortress aura, drawn. See aura.ts for the model.
 *
 * Three channels have to be legible in the output, because the whole point is
 * that §10.1's two separate purchases and one choice are visible at all: the
 * radius has to move when the radius is upgraded, the drawing has to thicken
 * when the power is upgraded, and each of the four auras has to look different
 * from the others. And like the effects layer, it is decoration: it never
 * touches the view it reads.
 */

import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import type { AuraType } from '../data/schema.ts';
import type { LaneView } from '../sim/index.ts';
import { AuraLayer, auraColour, STRENGTH_FOR_FULL } from './aura.ts';
import { computeLayout } from './layout.ts';

const { data } = loadDataFromDisk();
const layout = computeLayout(412, 915, data.lane);

const ALL_AURAS: AuraType[] = ['damage', 'attackSpeed', 'armour', 'regeneration'];

function lane(aura: string | null, radius: number, strength: number): LaneView {
  return {
    teamId: 'lane1',
    builderId: 'bastion',
    units: [],
    monsters: [],
    fortress: {
      hp: 1000,
      maxHp: 1000,
      destroyed: false,
      weaponDamageType: 'impact',
      activeAura: aura,
      auraRadius: radius,
      auraStrength: strength,
    },
    economy: null,
    reserveCount: 0,
    sendLog: [],
    attacks: [],
    unitSpend: [],
  };
}

/** A layer that has drawn one frame for this view. */
function draw(view: LaneView | null, ms = 0): AuraLayer {
  const layer = new AuraLayer(layout, data.lane);
  layer.read(view);
  layer.update(ms);
  layer.render();
  return layer;
}

/**
 * What the drawing looks like, coarsely: how many shapes, how much opacity, and
 * the box it covers. Enough to tell two auras apart and to see a channel move,
 * without a canvas to look at.
 */
function look(layer: AuraLayer): string {
  const b = layer.getBounds();
  const box =
    layer.shapeCount === 0
      ? 'empty'
      : `${b.width.toFixed(1)}x${b.height.toFixed(1)}@${b.y.toFixed(1)}`;
  return `${layer.shapeCount} shapes, ink ${layer.ink.toFixed(3)}, ${box}`;
}

describe('an aura is only drawn when there is one', () => {
  it('draws nothing with no aura chosen', () => {
    expect(draw(lane(null, 3, 0.2)).shapeCount).toBe(0);
  });

  it('draws nothing when the radius has not been bought yet', () => {
    // §10.1: strength and radius upgrade separately, and radius starts at 0 -
    // an aura that reaches nowhere buffs nobody, so it shows nothing.
    expect(draw(lane('damage', 0, 0.2)).shapeCount).toBe(0);
  });

  it('draws nothing for a lane it cannot see', () => {
    expect(draw(null).shapeCount).toBe(0);
  });

  it('draws something for every aura the data defines', () => {
    for (const aura of data.fortress.auras.types) {
      expect(draw(lane(aura, 3, 0.2)).shapeCount).toBeGreaterThan(0);
    }
  });

  it('ignores an aura name it does not know how to draw', () => {
    // Better a missing ring than a crash if the data grows a fifth aura.
    expect(draw(lane('telepathy', 3, 0.2)).shapeCount).toBe(0);
  });
});

describe('the three channels are all visible', () => {
  it('gives each aura its own look', () => {
    const looks = ALL_AURAS.map((aura) => look(draw(lane(aura, 3, 0.3))));
    expect(new Set(looks).size).toBe(ALL_AURAS.length);
  });

  it('gives each aura its own colour, and none of them a damage type colour', () => {
    const colours = ALL_AURAS.map((aura) => auraColour(aura));
    expect(new Set(colours).size).toBe(ALL_AURAS.length);
    for (const colour of colours) {
      expect(Object.values(DAMAGE).includes(colour)).toBe(false);
    }
  });

  it('draws more the stronger the aura is', () => {
    // Aura Power is a purchase (§10.1). If buying it changed nothing on screen
    // the player could not tell whether it had worked.
    for (const aura of ALL_AURAS) {
      const weak = draw(lane(aura, 3, 0.05)).ink;
      const strong = draw(lane(aura, 3, STRENGTH_FOR_FULL)).ink;
      expect(strong).toBeGreaterThan(weak);
    }
  });

  it('reaches further the bigger the radius is', () => {
    const near = draw(lane('armour', 2, 0.3)).getBounds().height;
    const far = draw(lane('armour', 5, 0.3)).getBounds().height;
    expect(far).toBeGreaterThan(near * 2);
  });

  it('stops growing once the aura is at full strength', () => {
    const full = look(draw(lane('damage', 3, STRENGTH_FOR_FULL)));
    const beyond = look(draw(lane('damage', 3, STRENGTH_FOR_FULL * 4)));
    expect(beyond).toBe(full);
  });
});

describe('it is decoration', () => {
  it('never touches the view it read', () => {
    const view = lane('regeneration', 3, 0.3);
    const before = JSON.stringify(view);
    const layer = new AuraLayer(layout, data.lane);
    layer.read(view);
    layer.update(120);
    layer.render();
    expect(JSON.stringify(view)).toBe(before);
  });

  it('moves over wall time, and comes back round', () => {
    const at = (ms: number) => look(draw(lane('attackSpeed', 3, 0.3), ms));
    expect(at(600)).not.toBe(at(0));
    // One full period later it is where it started: nothing drifts or grows.
    expect(at(2400)).toBe(at(0));
  });

  it('draws the same thing twice for the same input', () => {
    expect(look(draw(lane('damage', 3, 0.3)))).toBe(look(draw(lane('damage', 3, 0.3))));
  });
});

const DAMAGE = { impact: 0xe69f00, pierce: 0x56b4e9, blast: 0xd55e00, arcane: 0xcc79a7 };
