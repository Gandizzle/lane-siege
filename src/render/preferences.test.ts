/**
 * The player's preferences survive a reload, a bad save, and the rename of the
 * key they are kept under (preferences.ts).
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFERENCES,
  GAME_SPEEDS,
  PreferenceStore,
  parsePreferences,
  speedLabel,
} from './preferences.ts';

function memory() {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
}

describe('preferences', () => {
  it('starts at real time with the markers on', () => {
    expect(new PreferenceStore(null).settings).toEqual({
      statusEffects: true,
      practiceSpeed: 1,
      tutorialDone: [],
      soloBest: 0,
      battlefield: 'plain',
    });
  });

  it('keeps a speed only if it is one the menu offers', () => {
    for (const speed of GAME_SPEEDS) {
      expect(parsePreferences({ practiceSpeed: speed }).practiceSpeed).toBe(speed);
    }
    expect(parsePreferences({ practiceSpeed: 7 }).practiceSpeed).toBe(1);
    expect(parsePreferences({ practiceSpeed: '2' }).practiceSpeed).toBe(1);
    expect(parsePreferences('junk')).toEqual(DEFAULT_PREFERENCES);
  });

  it('saves a change and reads it back', () => {
    const storage = memory();
    new PreferenceStore(storage).configure({ practiceSpeed: 3, statusEffects: false });
    expect(new PreferenceStore(storage).settings).toEqual({
      statusEffects: false,
      practiceSpeed: 3,
      tutorialDone: [],
      soloBest: 0,
      battlefield: 'plain',
    });
  });

  it('remembers finished tutorial chapters, once each, and nothing that is not a name', () => {
    const storage = memory();
    new PreferenceStore(storage).configure({ tutorialDone: ['lane', 'build', 'lane'] });
    expect(new PreferenceStore(storage).settings.tutorialDone).toEqual(['lane', 'build']);
    expect(parsePreferences({ tutorialDone: ['lane', 4, null] }).tutorialDone).toEqual(['lane']);
    expect(parsePreferences({ tutorialDone: 'lane' }).tutorialDone).toEqual([]);
  });

  it('keeps the solo best as a whole number of kills, and nothing else', () => {
    const storage = memory();
    new PreferenceStore(storage).configure({ soloBest: 412 });
    expect(new PreferenceStore(storage).settings.soloBest).toBe(412);
    expect(parsePreferences({ soloBest: 12.7 }).soloBest).toBe(12);
    expect(parsePreferences({ soloBest: -3 }).soloBest).toBe(0);
    expect(parsePreferences({ soloBest: '99' }).soloBest).toBe(0);
  });

  it('keeps the battlefield chosen, and only one that exists', () => {
    const storage = memory();
    new PreferenceStore(storage).configure({ battlefield: 'dunes' });
    expect(new PreferenceStore(storage).settings.battlefield).toBe('dunes');
    expect(parsePreferences({ battlefield: 'lava' }).battlefield).toBe('plain');
    expect(parsePreferences({ battlefield: 3 }).battlefield).toBe('plain');
  });

  it('carries the marker switch over from where it was saved before', () => {
    const storage = memory();
    storage.setItem('lane-siege.display', JSON.stringify({ statusEffects: false }));
    expect(new PreferenceStore(storage).settings.statusEffects).toBe(false);
  });

  it('survives storage that throws', () => {
    const hostile = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const prefs = new PreferenceStore(hostile);
    expect(prefs.settings).toEqual(DEFAULT_PREFERENCES);
    expect(() => prefs.configure({ practiceSpeed: 2 })).not.toThrow();
    expect(prefs.settings.practiceSpeed).toBe(2);
  });

  it('writes a half as a half', () => {
    expect(GAME_SPEEDS.map(speedLabel)).toEqual(['½×', '1×', '2×', '3×']);
  });
});
