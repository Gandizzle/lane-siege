/**
 * Send buttons: what they draw, and who they aim at. See sends.ts.
 */

import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../../data/loadNode.ts';
import { pickSendTarget, sendIcon, sendIconKey } from './sends.ts';
import type { OpponentView } from '../../sim/index.ts';
import { SHAPE_IDS } from '../shapes.ts';

const { data } = loadDataFromDisk();

function opponent(teamId: string, eliminated = false): OpponentView {
  return {
    teamId,
    name: '',
    eliminated,
    placement: null,
    fortressHp: 100,
    fortressMaxHp: 100,
    watching: false,
    visionTicksLeft: 0,
  };
}

describe('what a send button draws', () => {
  it('gives every send the silhouette of the monster it delivers', () => {
    for (const send of data.sends.sends) {
      const icon = sendIcon(data, send.id);
      expect(icon, send.id).not.toBeNull();
      // A real shape from the catalogue, so `drawEntity` has something to draw.
      expect(SHAPE_IDS).toContain(icon!.style.shape);
      // Outlined, because it is a monster and not a defensive unit (§14.2).
      expect(icon!.style.outlined).toBe(true);
      expect(icon!.count).toBe(send.monsters.length);
      expect(icon!.monsterName.length).toBeGreaterThan(0);
    }
  });

  it('names the monster, not just the pack', () => {
    // The point of the icon is that a shape gets a word attached to it: a
    // player who reads "5x Grub" under a circle learns the circle.
    const icon = sendIcon(data, 'grub')!;
    const grub = data.monsters.monsters.find((m) => m.id === 'grub')!;
    expect(icon.monsterName).toBe(grub.name);
    expect(icon.style.shape).toBe(grub.shape);
    expect(icon.style.damageType).toBe(grub.damageType);
  });

  it('draws a different picture for every send', () => {
    // Two send buttons showing the same shape in the same fill would be two
    // buttons a player cannot tell apart.
    const keys = data.sends.sends.map((send) => sendIconKey(sendIcon(data, send.id)!));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has nothing to draw for a send that is not there', () => {
    expect(sendIcon(data, 'no_such_send')).toBeNull();
  });
});

describe('who a send is aimed at', () => {
  const three = [opponent('a'), opponent('b'), opponent('c')];

  it('takes the chosen lane when one is chosen', () => {
    expect(pickSendTarget(three, 'b', false, () => 0)).toBe('b');
  });

  it('takes nobody when the chosen lane is out', () => {
    // §13: an eliminated lane takes no more monsters, and the simulation
    // refuses it - so the UI must not offer to spend gems on it.
    const out = [opponent('a'), opponent('b', true), opponent('c')];
    expect(pickSendTarget(out, 'b', false, () => 0)).toBeNull();
  });

  it('takes nobody when nothing is chosen', () => {
    expect(pickSendTarget(three, null, false, () => 0)).toBeNull();
  });

  it('spreads across the living opponents at random', () => {
    expect(pickSendTarget(three, null, true, () => 0)).toBe('a');
    expect(pickSendTarget(three, null, true, () => 0.5)).toBe('b');
    expect(pickSendTarget(three, null, true, () => 0.99)).toBe('c');
  });

  it('never picks an eliminated lane at random', () => {
    const out = [opponent('a', true), opponent('b'), opponent('c', true)];
    for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
      expect(pickSendTarget(out, null, true, () => r)).toBe('b');
    }
  });

  it('survives a random source at its edges', () => {
    // A generator that returns exactly 1 would index past the end.
    expect(pickSendTarget(three, null, true, () => 1)).toBe('c');
    expect(pickSendTarget(three, null, true, () => -0.1)).toBe('a');
  });

  it('has nobody to aim at when everyone is out', () => {
    const out = three.map((o) => opponent(o.teamId, true));
    expect(pickSendTarget(out, 'a', false, () => 0)).toBeNull();
    expect(pickSendTarget(out, null, true, () => 0)).toBeNull();
  });
});
