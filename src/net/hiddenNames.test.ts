/**
 * Names this player has reported (hiddenNames.ts): gone from this device's
 * screens at once, by player and name, a saved build's seat counting as its
 * player, and still gone next time the game opens.
 */

import { describe, expect, it } from 'vitest';
import { HiddenNames } from './hiddenNames.ts';
import type { KeyValueStore } from './identity.ts';

function memory(): KeyValueStore {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

describe('names this player has reported', () => {
  it('shows the default in their place, for that name only', () => {
    const hidden = new HiddenNames(memory());
    hidden.hide('zed', 'Rude');
    expect(hidden.shown('zed', 'Rude')).toBe('');
    expect(hidden.shown('zed', 'Polite')).toBe('Polite');
    expect(hidden.shown('bo', 'Rude')).toBe('Rude');
    expect(hidden.shown(null, 'Rude')).toBe('Rude');
  });

  it('counts a saved build’s seat as its player', () => {
    const hidden = new HiddenNames(memory());
    hidden.hide('ghost:zed', 'Rude');
    expect(hidden.isHidden('zed', 'Rude')).toBe(true);
    expect(hidden.isHidden('ghost:zed', 'Rude')).toBe(true);
  });

  it('remembers them next time, and survives a broken store', () => {
    const storage = memory();
    new HiddenNames(storage).hide('zed', 'Rude');
    expect(new HiddenNames(storage).isHidden('zed', 'Rude')).toBe(true);
    storage.setItem('lane-siege.hiddenNames', 'not json');
    expect(new HiddenNames(storage).isHidden('zed', 'Rude')).toBe(false);
    expect(new HiddenNames(null).shown('zed', 'Rude')).toBe('Rude');
  });
});
