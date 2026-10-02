/**
 * The HUD's line about sends on their way (hud.ts, `sendNotice`).
 *
 * A send is on its way from the moment it is bought until it is on the field,
 * which can be well after its wave has spawned: the cap keeps the overflow in
 * reserve, sends last (§8.1). The playtest that found this had auto-send
 * switched off and its own swarmlings still walking in, with nothing on screen
 * to say they had been bought earlier.
 */

import { describe, expect, it } from 'vitest';
import { sendNotice } from './hud.ts';

const SOLO = { solo: { kills: 0, endless: null } };
const ENDLESS = {
  solo: { kills: 0, endless: { ageTicks: 600, step: 1, nextBossTicks: 600, nextBosses: 1 } },
};
const STANDARD = { solo: null };

function log(count: number) {
  return Array.from({ length: count }, () => ({ sendId: 'swarmling', fromTeamId: 'lane2' }));
}

describe('the sends notice', () => {
  it('says nothing when nothing is on its way', () => {
    expect(sendNotice(SOLO, { sendLog: [], reserveSends: 0 }, 0)).toBeNull();
    expect(sendNotice(ENDLESS, { sendLog: [], reserveSends: 0 }, 0)).toBeNull();
    expect(sendNotice(STANDARD, { sendLog: [], reserveSends: 0 }, 0)).toBeNull();
  });

  it('in solo, names the sends joining the next wave, as a receipt rather than a warning', () => {
    expect(sendNotice(SOLO, { sendLog: log(1), reserveSends: 0 }, 1)).toEqual({
      text: '1 send joins your next wave',
      solo: true,
    });
    expect(sendNotice(SOLO, { sendLog: log(4), reserveSends: 0 }, 1)?.text).toBe(
      '4 sends join your next wave',
    );
  });

  it('in solo, keeps counting the sends a spawned wave is still holding back', () => {
    // The send log is empty once the wave is out; the reserve still has them.
    expect(sendNotice(SOLO, { sendLog: [], reserveSends: 12 }, 0)?.text).toBe(
      '12 of your sends still to come',
    );
    // And the ones already bought for the next wave are still to come too.
    expect(sendNotice(SOLO, { sendLog: log(3), reserveSends: 12 }, 1)?.text).toBe(
      '15 of your sends still to come',
    );
  });

  it('in the endless wave, counts only the sends the cap is holding back', () => {
    // A send with room walks in on the next tick: a line for it would flicker.
    expect(sendNotice(ENDLESS, { sendLog: log(1), reserveSends: 0 }, 1)).toBeNull();
    expect(sendNotice(ENDLESS, { sendLog: log(1), reserveSends: 7 }, 1)?.text).toBe(
      '7 of your sends still to come',
    );
  });

  it('in a standard match, warns of sends incoming, and of sends still to come once the wave is out', () => {
    expect(sendNotice(STANDARD, { sendLog: log(2), reserveSends: 5 }, 2)).toEqual({
      text: '⚠ 2 sends incoming from 2 lanes',
      solo: false,
    });
    expect(sendNotice(STANDARD, { sendLog: [], reserveSends: 5 }, 0)).toEqual({
      text: '⚠ 5 sends still to come',
      solo: false,
    });
    expect(sendNotice(STANDARD, { sendLog: [], reserveSends: 1 }, 0)?.text).toBe(
      '⚠ 1 send still to come',
    );
  });
});
