/**
 * When the game asks for the phone to be turned upright. See orientation.ts.
 *
 * The rule has to separate a phone held sideways - which the layout cannot do
 * anything good with - from a desktop window or a tablet, which it can. Both
 * are landscape, so orientation alone is not the test.
 */

import { describe, expect, it } from 'vitest';
import { wantsRotation } from './orientation.ts';

describe('asking for portrait', () => {
  it('says nothing while the phone is upright', () => {
    expect(wantsRotation(412, 915)).toBe(false);
    expect(wantsRotation(360, 640)).toBe(false);
    expect(wantsRotation(430, 932)).toBe(false);
  });

  it('asks when a phone is on its side', () => {
    expect(wantsRotation(915, 412)).toBe(true);
    expect(wantsRotation(640, 360)).toBe(true);
    expect(wantsRotation(932, 430)).toBe(true);
  });

  it('leaves a desktop window alone', () => {
    // A wide window lays out fine: the bands stack, the lane is fitted to
    // whatever height is left, and nobody is holding a monitor sideways.
    expect(wantsRotation(1400, 800)).toBe(false);
    expect(wantsRotation(1920, 1080)).toBe(false);
  });

  it('leaves a tablet alone in either orientation', () => {
    expect(wantsRotation(1024, 768)).toBe(false);
    expect(wantsRotation(768, 1024)).toBe(false);
  });

  it('does not ask about a square viewport', () => {
    // Neither orientation, so there is nothing to turn.
    expect(wantsRotation(500, 500)).toBe(false);
  });
});
