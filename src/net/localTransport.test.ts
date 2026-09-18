/**
 * The local transport: the practice match, and the single-player path.
 *
 * What matters here is that it behaves like the remote one. Same interface,
 * same filter, same validation - so anything the renderer does works both ways,
 * and fog of war cannot be a multiplayer-only concern.
 */

import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import { MS_PER_TICK } from '../util/loop.ts';
import { LocalTransport } from './localTransport.ts';

const { data } = loadDataFromDisk();
const LANES = ['lane1', 'lane2', 'lane3', 'lane4'];

function practice(): LocalTransport {
  return new LocalTransport(
    data,
    5,
    LANES.map((id) => ({ id, playerIds: [id] })),
    'lane1',
    LANES.slice(1),
  );
}

/** Advance by whole ticks, as the frame loop would. */
function run(transport: LocalTransport, ticks: number): void {
  for (let i = 0; i < ticks; i++) transport.update(MS_PER_TICK);
}

describe('the local transport', () => {
  it('has a view before the first tick', () => {
    const transport = practice();
    expect(transport.status).toBe('ready');
    expect(transport.view()).not.toBeNull();
    expect(transport.view()!.lane!.teamId).toBe('lane1');
  });

  it('advances the simulation on whole ticks only', () => {
    const transport = practice();
    const before = transport.view()!.tick;

    transport.update(MS_PER_TICK / 2);
    expect(transport.view()!.tick).toBe(before);
    expect(transport.consumeTick()).toBe(false);

    transport.update(MS_PER_TICK / 2);
    expect(transport.view()!.tick).toBe(before + 1);
    expect(transport.consumeTick()).toBe(true);
    // Drained, not latched.
    expect(transport.consumeTick()).toBe(false);
  });

  it('applies a command immediately and reports a refusal', () => {
    const transport = practice();

    transport.submit({
      kind: 'placeUnit',
      teamId: 'lane1',
      unitDefId: 'pledge',
      tileX: 3,
      tileY: 6,
    });
    expect(transport.view()!.lane!.units).toHaveLength(1);
    expect(transport.takeRejections()).toEqual([]);

    transport.submit({
      kind: 'placeUnit',
      teamId: 'lane1',
      unitDefId: 'pledge',
      tileX: 3,
      tileY: 6,
    });
    expect(transport.takeRejections()).toEqual(['tile-occupied']);
    // Drained.
    expect(transport.takeRejections()).toEqual([]);
  });

  it('filters what it hands back, exactly as the server would (§12)', () => {
    const transport = practice();
    run(transport, 40);

    const view = transport.view()!;
    expect(view.opponents).toHaveLength(3);
    expect(view.lane!.economy).not.toBeNull();
    // The other lanes are being played, and none of them is readable.
    expect(Object.keys(view.watching)).toHaveLength(0);
    for (const opponent of view.opponents) {
      expect(opponent.fortressMaxHp).toBeGreaterThan(0);
      expect(opponent.watching).toBe(false);
    }
  });

  it('plays the other three lanes', () => {
    const transport = practice();
    // Through the first build phase, which is when a builder spends.
    run(transport, 700);

    const view = transport.view()!;
    expect(view.wave).toBeGreaterThan(0);
    // Nothing here can see into those lanes, so the evidence that somebody is
    // home is that their fortresses are still up once the wave has landed.
    expect(view.opponents.every((o) => !o.eliminated)).toBe(true);
  });

  it('closes when disposed', () => {
    const transport = practice();
    transport.dispose();
    expect(transport.status).toBe('closed');
  });

  // Spectating after elimination is a rule about views, not about transports,
  // and it is asserted directly in src/sim/multiplayer.test.ts - where a team
  // can simply be marked eliminated instead of the test having to play twenty
  // thousand ticks of four lanes to get there.
});
