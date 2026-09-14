/**
 * Attack animations. See effects.ts and attackStyle.ts for the model.
 *
 * The guarantee that matters most is the one that cannot be seen in a
 * screenshot: an effect is decorative. It is spawned from a blow that has
 * already landed, it never touches a body, and the simulation neither reads it
 * nor knows it exists. The rest is that a shot looks like the thing that fired
 * it, and that nothing accumulates.
 */

import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import { buildDefIndex, FORTRESS_ID, type LaneView } from '../sim/index.ts';
import { computeLayout } from './layout.ts';
import { EffectsLayer } from './effects.ts';
import { attackStyle, RANGED_MIN_TILES } from './attackStyle.ts';
import { DAMAGE_COLOURS } from './palette.ts';

const { data } = loadDataFromDisk();
const defs = buildDefIndex(data);
const layout = computeLayout(412, 915, data.lane);

function layerFor(): EffectsLayer {
  return new EffectsLayer(layout, data, defs);
}

/** A unit definition that is definitely melee, and one that is definitely not. */
const MELEE_UNIT = 'hammer';
const RANGED_UNIT = 'mortar';

function body(id: number, defId: string, x: number, y: number) {
  const def = defs.units.get(defId) ?? defs.monsters.get(defId);
  return {
    id,
    defId,
    x,
    y,
    radius: 0.26,
    armour: def?.armour ?? ('plate' as const),
    damageType: def?.damageType ?? ('impact' as const),
    hpFraction: 1,
  };
}

function lane(overrides: Partial<LaneView> = {}): LaneView {
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
      activeAura: null,
      auraRadius: 0,
      auraStrength: 0,
    },
    economy: null,
    reserveCount: 0,
    sendLog: [],
    attacks: [],
    unitSpend: [],
    ...overrides,
  };
}

describe('a shot looks like the thing that fired it', () => {
  it('draws a projectile for reach and a swing for contact', () => {
    const melee = defs.units.get(MELEE_UNIT)!;
    const ranged = defs.units.get(RANGED_UNIT)!;
    expect(attackStyle({ ...styleInput(melee) }).ranged).toBe(false);
    expect(attackStyle({ ...styleInput(ranged) }).ranged).toBe(true);
  });

  it('puts the boundary in the gap the data actually has', () => {
    // Nothing may sit near the threshold, or it would flicker between a swing
    // and a shot when a balance change nudged it.
    for (const unit of data.units.units) {
      const range = unit.range ?? 0;
      expect(Math.abs(range - RANGED_MIN_TILES)).toBeGreaterThan(0.3);
    }
  });

  it('uses the same colour the body is drawn in (§14.2)', () => {
    const style = attackStyle({
      damageType: 'arcane',
      armour: 'ward',
      range: 3,
      damage: 20,
    });
    expect(style.colour).toBe(DAMAGE_COLOURS.arcane);
  });

  it('gives each damage type its own head', () => {
    const shapes = (['impact', 'pierce', 'blast', 'arcane'] as const).map(
      (damageType) => attackStyle({ damageType, armour: 'flesh', range: 3, damage: 20 }).shape,
    );
    expect(new Set(shapes).size).toBe(4);
  });

  it('sizes the head by damage and scales it by tier, like a body', () => {
    const small = attackStyle({ damageType: 'impact', armour: 'flesh', range: 3, damage: 5 });
    const big = attackStyle({ damageType: 'impact', armour: 'flesh', range: 3, damage: 70 });
    expect(big.size).toBeGreaterThan(small.size);

    const tier3 = attackStyle({
      damageType: 'impact',
      armour: 'flesh',
      range: 3,
      damage: 5,
      tier: 3,
    });
    expect(tier3.size).toBeGreaterThan(small.size);
  });

  it('flies faster the further it has to go, so time in the air stays similar', () => {
    const near = attackStyle({ damageType: 'pierce', armour: 'flesh', range: 1, damage: 10 });
    const far = attackStyle({ damageType: 'pierce', armour: 'flesh', range: 5, damage: 10 });
    expect(far.speed).toBeGreaterThan(near.speed);
    expect(5 / far.speed).toBeLessThan(2 * (1 / near.speed));
  });

  it('trails by armour family, so two guns of one damage type still differ', () => {
    const flesh = attackStyle({ damageType: 'blast', armour: 'flesh', range: 3, damage: 30 });
    const swarm = attackStyle({ damageType: 'blast', armour: 'swarm', range: 3, damage: 30 });
    expect(flesh.trail).not.toBe(swarm.trail);
  });
});

function styleInput(def: {
  damageType: 'impact' | 'pierce' | 'blast' | 'arcane';
  armour: 'flesh' | 'plate' | 'swarm' | 'ward';
  range: number | null;
  damage: number | null;
  tier?: number;
}) {
  return {
    damageType: def.damageType,
    armour: def.armour,
    range: def.range ?? 0,
    damage: def.damage ?? 0,
    ...(def.tier !== undefined && { tier: def.tier }),
  };
}

describe('effects are spawned from blows that already landed', () => {
  it('spawns a projectile for a ranged attacker', () => {
    const layer = layerFor();
    const view = lane({
      units: [body(1, RANGED_UNIT, 4, 8)],
      monsters: [body(2, 'grub', 4, 5)],
      attacks: [{ attackerId: 1, targetId: 2 }],
    });
    layer.spawn(view, null);
    expect(layer.liveKinds()).toEqual(['projectile']);
  });

  it('spawns a swing and a spark for a melee attacker', () => {
    const layer = layerFor();
    const view = lane({
      units: [body(1, MELEE_UNIT, 4, 5)],
      monsters: [body(2, 'grub', 4.5, 5)],
      attacks: [{ attackerId: 1, targetId: 2 }],
    });
    layer.spawn(view, null);
    expect(layer.liveKinds().sort()).toEqual(['spark', 'swing']);
  });

  it('animates a monster hitting the fortress, and the fortress shooting back', () => {
    const layer = layerFor();
    const view = lane({
      monsters: [body(9, 'grub', 4, 10)],
      attacks: [
        { attackerId: 9, targetId: FORTRESS_ID },
        { attackerId: FORTRESS_ID, targetId: 9 },
      ],
    });
    layer.spawn(view, null);
    expect(layer.liveCount).toBeGreaterThan(0);
  });

  it('still lands a shot on a body that died on the same tick', () => {
    const layer = layerFor();
    const before = lane({
      units: [body(1, RANGED_UNIT, 4, 8)],
      monsters: [body(2, 'grub', 4, 5)],
    });
    // The target is gone from the new view: it was killed by this very blow.
    const after = lane({
      units: [body(1, RANGED_UNIT, 4, 8)],
      attacks: [{ attackerId: 1, targetId: 2 }],
    });
    layer.spawn(after, before);
    expect(layer.liveKinds()).toEqual(['projectile']);
  });

  it('skips a blow whose attacker cannot be found at all', () => {
    const layer = layerFor();
    const view = lane({
      monsters: [body(2, 'grub', 4, 5)],
      attacks: [{ attackerId: 77, targetId: 2 }],
    });
    layer.spawn(view, null);
    expect(layer.liveCount).toBe(0);
  });

  it('never touches the bodies it draws between', () => {
    const layer = layerFor();
    const attacker = body(1, MELEE_UNIT, 4, 5);
    const target = body(2, 'grub', 4.5, 5);
    const view = lane({
      units: [attacker],
      monsters: [target],
      attacks: [{ attackerId: 1, targetId: 2 }],
    });
    const snapshot = JSON.stringify([attacker, target]);
    layer.spawn(view, null);
    layer.update(50);
    layer.render();
    expect(JSON.stringify([attacker, target])).toBe(snapshot);
  });
});

describe('nothing accumulates', () => {
  it('retires a swing once its life is up', () => {
    const layer = layerFor();
    layer.spawn(
      lane({
        units: [body(1, MELEE_UNIT, 4, 5)],
        monsters: [body(2, 'grub', 4.5, 5)],
        attacks: [{ attackerId: 1, targetId: 2 }],
      }),
      null,
    );
    expect(layer.liveCount).toBe(2);
    layer.update(1000);
    expect(layer.liveCount).toBe(0);
  });

  it('turns a projectile into exactly one impact, then nothing', () => {
    const layer = layerFor();
    layer.spawn(
      lane({
        units: [body(1, RANGED_UNIT, 4, 8)],
        monsters: [body(2, 'grub', 4, 5)],
        attacks: [{ attackerId: 1, targetId: 2 }],
      }),
      null,
    );
    // Long enough for the shot to land, short enough that the flash survives.
    layer.update(500);
    expect(layer.liveKinds()).toEqual(['impact']);
    layer.update(500);
    expect(layer.liveCount).toBe(0);
  });

  it('holds a ceiling however many blows land at once', () => {
    const layer = layerFor();
    const units = [];
    const monsters = [];
    const attacks = [];
    for (let i = 0; i < 400; i++) {
      units.push(body(i * 2, MELEE_UNIT, 4, 5));
      monsters.push(body(i * 2 + 1, 'grub', 4.5, 5));
      attacks.push({ attackerId: i * 2, targetId: i * 2 + 1 });
    }
    layer.spawn(lane({ units, monsters, attacks }), null);
    expect(layer.liveCount).toBeLessThanOrEqual(256 + 1);
  });

  it('drops everything on a lane change', () => {
    const layer = layerFor();
    layer.spawn(
      lane({
        units: [body(1, MELEE_UNIT, 4, 5)],
        monsters: [body(2, 'grub', 4.5, 5)],
        attacks: [{ attackerId: 1, targetId: 2 }],
      }),
      null,
    );
    layer.reset();
    expect(layer.liveCount).toBe(0);
  });
});
