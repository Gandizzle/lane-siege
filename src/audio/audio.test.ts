/**
 * Sound, as far as it can be tested without speakers: that every cue has a
 * file that exists, that settings survive a bad save, that the playlist never
 * plays the same piece twice running when it has a choice, that a busy fight is
 * thinned rather than piled up, and that each thing worth hearing is heard
 * exactly once - and nothing that was not worth it at all.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import { DAMAGE_TYPES } from '../data/schema.ts';
import {
  FORTRESS_ID,
  TICKS_PER_SECOND,
  buildDefIndex,
  type EntityView,
  type LaneView,
  type MatchView,
} from '../sim/index.ts';
import {
  CUES,
  MUSIC_TRACKS,
  SOUND_PACKS,
  attackCue,
  type CueSound,
  type MusicTrack,
} from './catalog.ts';
import { MatchCues, combatCues } from './cues.ts';
import { MAX_VOICES, VoiceLimiter } from './limiter.ts';
import {
  DEFAULT_AUDIO_SETTINGS,
  loadAudioSettings,
  nextTrack,
  parseAudioSettings,
  saveAudioSettings,
} from './settings.ts';
import { seeded } from './synth/dsp.ts';
import { SFX } from './synth/sfx.ts';

const PUBLIC_AUDIO = join(import.meta.dirname, '..', '..', 'public', 'audio');
const { data } = loadDataFromDisk();
const defs = buildDefIndex(data);

// ------------------------------------------------------------------ fixtures

function body(id: number, defId: string, x = 4, y = 5): EntityView {
  const def = defs.units.get(defId) ?? defs.monsters.get(defId);
  return {
    id,
    defId,
    x,
    y,
    radius: 0.26,
    armor: def?.armor ?? 'plate',
    damageType: def?.damageType ?? 'impact',
    hpFraction: 1,
  };
}

function lane(overrides: Partial<LaneView> = {}): LaneView {
  return {
    teamId: 'lane1',
    builderId: 'ironvow',
    units: [],
    monsters: [],
    fortress: {
      hp: 1000,
      maxHp: 1000,
      destroyed: false,
      weaponDamageType: 'blast',
      activeAura: null,
      auraRadius: 0,
      auraStrength: 0,
    },
    economy: {
      gold: 100,
      gems: 0,
      supplyUsed: 0,
      supplyCap: 10,
      passiveIncome: 0,
      tech: {},
      upgrades: {},
      sendCooldowns: {},
      waveTally: { kills: 0, fortressKills: 0, bounty: 0, missed: 0 },
    },
    reserveCount: 0,
    reserveSends: 0,
    sendLog: [],
    attacks: [],
    unitSpend: [],
    unitDamage: [],
    ...overrides,
  };
}

function match(
  overrides: Partial<MatchView> = {},
  laneOverrides: Partial<LaneView> = {},
): MatchView {
  return {
    teamId: 'lane1',
    teamName: '',
    seed: 1,
    lateWaves: null,
    tick: 0,
    wave: 1,
    phase: 'build',
    phaseTicksLeft: 100,
    finished: false,
    eliminated: false,
    placement: null,
    lane: lane(laneOverrides),
    opponents: [
      {
        teamId: 'lane2',
        name: 'Bot 2',
        eliminated: false,
        placement: null,
        fortressHp: 1000,
        fortressMaxHp: 1000,
        watching: false,
        visionTicksLeft: 0,
        fighting: false,
      },
    ],
    watching: {},
    showdown: null,
    solo: null,
    ...overrides,
  };
}

/** What a `MatchCues` hears going from `before` to `after`. */
function heard(before: MatchView, after: MatchView): string[] {
  const cues = new MatchCues();
  cues.observe(before);
  return cues.observe(after).sort();
}

const MELEE_UNIT = 'pledge';
const BOSS = 'hollow_king';

// ------------------------------------------------------------------ catalog

describe('the catalog', () => {
  it('gives every cue a sound in every pack, and every file exists', () => {
    for (const pack of SOUND_PACKS) {
      for (const cue of CUES) {
        const sound: CueSound = pack.cues[cue];
        expect(sound.files.length, `${pack.id} ${cue}`).toBeGreaterThan(0);
        for (const file of sound.files) {
          expect(existsSync(join(PUBLIC_AUDIO, file)), `${pack.id} ${cue}: ${file}`).toBe(true);
        }
        expect(sound.volume).toBeGreaterThan(0);
        expect(sound.volume).toBeLessThanOrEqual(1);
        expect(sound.maxVoices).toBeGreaterThanOrEqual(1);
        expect(sound.pitchJitter).toBeGreaterThanOrEqual(0);
        expect(sound.pitchJitter).toBeLessThan(0.5);
      }
    }
  });

  it('has an attack sound for every damage type', () => {
    for (const type of DAMAGE_TYPES) expect(CUES).toContain(attackCue(type));
  });

  it('ships no synth file that nothing plays, and plays none it does not ship', () => {
    const shipped = readdirSync(join(PUBLIC_AUDIO, 'sfx', 'synth')).sort();
    const recipes = SFX.map((r) => `${r.id}.wav`).sort();
    const synth = SOUND_PACKS.find((p) => p.id === 'synth')!;
    const used = [...new Set(Object.values(synth.cues).flatMap((c) => c.files))]
      .map((f) => f.replace('sfx/synth/', ''))
      .sort();
    expect(shipped).toEqual(recipes);
    expect(used).toEqual(recipes);
  });

  it('lists music that exists, under ids that are unique', () => {
    expect(MUSIC_TRACKS.length).toBeGreaterThan(1);
    expect(new Set(MUSIC_TRACKS.map((t) => t.id)).size).toBe(MUSIC_TRACKS.length);
    for (const track of MUSIC_TRACKS) {
      expect(existsSync(join(PUBLIC_AUDIO, track.file)), track.file).toBe(true);
      expect(track.id).not.toBe('shuffle');
    }
  });

  it('renders every effect the same way twice, with nothing but finite samples', () => {
    for (const recipe of SFX) {
      const a = recipe.render(seeded(7));
      const b = recipe.render(seeded(7));
      expect(a.length, recipe.id).toBeGreaterThan(0);
      expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer)), recipe.id).toBe(true);
      expect(a.every(Number.isFinite), recipe.id).toBe(true);
    }
  });
});

// ------------------------------------------------------------------ settings

describe('settings', () => {
  function memory(): {
    store: Map<string, string>;
    getItem: (k: string) => string | null;
    setItem: (k: string, v: string) => void;
  } {
    const store = new Map<string, string>();
    return { store, getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) };
  }

  it('round-trips through storage', () => {
    const storage = memory();
    const chosen = {
      ...DEFAULT_AUDIO_SETTINGS,
      music: 0.2,
      muted: true,
      musicChoice: MUSIC_TRACKS[1]!.id,
    };
    saveAudioSettings(storage, chosen);
    expect(loadAudioSettings(storage)).toEqual(chosen);
  });

  it('falls back field by field on a bad or stale save', () => {
    expect(parseAudioSettings(null)).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(parseAudioSettings('junk')).toEqual(DEFAULT_AUDIO_SETTINGS);
    const parsed = parseAudioSettings({
      master: 7,
      music: -1,
      effects: 'loud',
      muted: 'yes',
      musicChoice: 'a-track-since-removed',
      soundPack: 'a-pack-since-removed',
    });
    expect(parsed).toEqual({ ...DEFAULT_AUDIO_SETTINGS, master: 1, music: 0 });
  });

  it('survives storage that is missing, corrupt or throws', () => {
    expect(loadAudioSettings(null)).toEqual(DEFAULT_AUDIO_SETTINGS);
    const corrupt = memory();
    corrupt.setItem('lane-siege.audio', '{not json');
    expect(loadAudioSettings(corrupt)).toEqual(DEFAULT_AUDIO_SETTINGS);
    const hostile = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadAudioSettings(hostile)).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(() => saveAudioSettings(hostile, DEFAULT_AUDIO_SETTINGS)).not.toThrow();
  });
});

describe('the playlist', () => {
  const random = seeded(3);

  it('plays a chosen piece again and again', () => {
    const chosen = MUSIC_TRACKS[0]!;
    for (let i = 0; i < 5; i++)
      expect(nextTrack(MUSIC_TRACKS, chosen.id, chosen.id, random)).toBe(chosen);
  });

  it('never shuffles the same piece twice running when it has a choice', () => {
    let previous: string | null = null;
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const next: MusicTrack = nextTrack(MUSIC_TRACKS, 'shuffle', previous, random)!;
      expect(next.id).not.toBe(previous);
      seen.add(next.id);
      previous = next.id;
    }
    expect(seen.size).toBe(MUSIC_TRACKS.length);
  });

  it('repeats the only piece there is, and plays nothing from an empty list', () => {
    const only = [MUSIC_TRACKS[0]!];
    expect(nextTrack(only, 'shuffle', only[0]!.id, random)).toBe(only[0]);
    expect(nextTrack([], 'shuffle', null, random)).toBeNull();
  });

  it('shuffles when the chosen piece has gone from the list', () => {
    expect(nextTrack(MUSIC_TRACKS, 'gone', null, random)).not.toBeNull();
  });
});

// ------------------------------------------------------------------ limiter

describe('the limiter', () => {
  const sound: CueSound = { files: ['x'], volume: 1, maxVoices: 2, minGapMs: 50, pitchJitter: 0 };

  it('spaces starts of one cue by its gap', () => {
    const limiter = new VoiceLimiter();
    expect(limiter.admit('attack.impact', sound, 0, 100)).toBe(true);
    expect(limiter.admit('attack.impact', sound, 20, 100)).toBe(false);
    expect(limiter.admit('attack.impact', sound, 60, 100)).toBe(true);
  });

  it('holds a cue to its voices until one ends', () => {
    const limiter = new VoiceLimiter();
    expect(limiter.admit('attack.impact', sound, 0, 300)).toBe(true);
    expect(limiter.admit('attack.impact', sound, 100, 300)).toBe(true);
    expect(limiter.admit('attack.impact', sound, 200, 300)).toBe(false);
    expect(limiter.admit('attack.impact', sound, 301, 300)).toBe(true);
  });

  it('counts cues separately, under one ceiling for everything', () => {
    const limiter = new VoiceLimiter();
    const wide: CueSound = { ...sound, maxVoices: 100, minGapMs: 0 };
    expect(limiter.admit('attack.impact', sound, 0, 1000)).toBe(true);
    expect(limiter.admit('attack.pierce', sound, 0, 1000)).toBe(true);
    for (let i = 2; i < MAX_VOICES; i++)
      expect(limiter.admit('death.monster', wide, i, 1000)).toBe(true);
    expect(limiter.admit('death.unit', wide, 50, 1000)).toBe(false);
    expect(limiter.sounding(50)).toBe(MAX_VOICES);
    expect(limiter.sounding(2000)).toBe(0);
  });
});

// ------------------------------------------------------------------ the fight

describe('the fight on screen', () => {
  const width = data.lane.buildZone.width;

  it("hears a blow as its attacker's damage type, panned to where it stands", () => {
    const unit = body(1, MELEE_UNIT, 0.5);
    const monster = body(2, 'grub', width - 0.5);
    const now = lane({
      units: [unit],
      monsters: [monster],
      attacks: [
        { attackerId: 1, targetId: 2 },
        { attackerId: 2, targetId: 1 },
      ],
    });
    const cues = combatCues(now, now, 'all', defs, width);
    expect(cues).toHaveLength(2);
    expect(cues[0]!.cue).toBe(attackCue(unit.damageType));
    expect(cues[0]!.pan).toBeLessThan(0);
    expect(cues[1]!.cue).toBe(attackCue(monster.damageType));
    expect(cues[1]!.pan).toBeGreaterThan(0);
    for (const cue of cues) expect(Math.abs(cue.pan!)).toBeLessThan(1);
  });

  it('hears the fortress weapon as its own damage type', () => {
    const now = lane({
      monsters: [body(2, 'grub')],
      attacks: [{ attackerId: FORTRESS_ID, targetId: 2 }],
    });
    expect(combatCues(now, now, 'all', defs, width)).toEqual([{ cue: 'attack.blast' }]);
  });

  it('still hears a blow struck by something that died on the same tick', () => {
    const before = lane({ units: [body(1, MELEE_UNIT)], monsters: [body(2, 'grub')] });
    const after = lane({ monsters: [body(2, 'grub')], attacks: [{ attackerId: 1, targetId: 2 }] });
    const cues = combatCues(after, before, 'all', defs, width).map((c) => c.cue);
    expect(cues).toContain(attackCue(body(1, MELEE_UNIT).damageType));
    expect(cues).toContain('death.unit');
  });

  it('hears a death as a monster, a boss or one of yours, by the same rule the pop uses', () => {
    const before = lane({
      units: [body(1, MELEE_UNIT)],
      monsters: [body(2, 'grub'), body(3, BOSS)],
    });
    const after = lane();
    expect(
      combatCues(after, before, 'all', defs, width)
        .map((c) => c.cue)
        .sort(),
    ).toEqual(['death.boss', 'death.monster', 'death.unit'].sort());
    // The build phase: a unit leaving was sold, which is not a death.
    expect(
      combatCues(after, before, 'monsters', defs, width)
        .map((c) => c.cue)
        .sort(),
    ).toEqual(['death.boss', 'death.monster'].sort());
    expect(combatCues(after, before, 'none', defs, width)).toEqual([]);
  });

  it('hears nothing die when the screen switches to another lane', () => {
    const before = lane({ monsters: [body(2, 'grub')] });
    const after = lane({ teamId: 'lane2' });
    expect(combatCues(after, before, 'all', defs, width)).toEqual([]);
  });
});

// ------------------------------------------------------------------ the match

describe('the match and your own lane', () => {
  it('is silent on the first look, however much is already going on', () => {
    const cues = new MatchCues();
    expect(cues.observe(match({ phase: 'combat' }, { units: [body(1, MELEE_UNIT)] }))).toEqual([]);
  });

  it('hears a wave start and a wave beaten', () => {
    // A wave walks in with its monsters: a lane empty from the first frame
    // would read as beaten already.
    const walkingIn = match({ phase: 'combat' }, { monsters: [body(9, 'grub')] });
    expect(heard(match({ phase: 'build' }), walkingIn)).toEqual(['wave.start']);
    expect(heard(match({ phase: 'combat' }), match({ phase: 'build' }))).toEqual(['wave.cleared']);
  });

  it('chimes when YOUR lane is clear, not again when the wave ends after it', () => {
    // Your lane is usually clear long before the last lane finishes: the
    // chime goes with the card that celebrates it (ui/waveCleared.ts).
    const cues = new MatchCues();
    const fighting = match({ phase: 'combat' }, { monsters: [body(9, 'grub')] });
    const clear = match({ phase: 'combat' });
    const over = match({ phase: 'build', wave: 1 });
    cues.observe(fighting);
    expect(cues.observe(clear)).toEqual(['wave.cleared']);
    expect(cues.observe(clear)).toEqual([]);
    expect(cues.observe(over)).toEqual([]);
  });

  it('does not chime for a lane emptied by its fortress falling', () => {
    const cues = new MatchCues();
    cues.observe(match({ phase: 'combat' }, { monsters: [body(9, 'grub')] }));
    const fallen = match({ phase: 'combat', eliminated: true });
    expect(cues.observe(fallen)).not.toContain('wave.cleared');
  });

  it('hears a unit placed, upgraded and sold', () => {
    const one = match({}, { units: [body(1, MELEE_UNIT)] });
    expect(heard(match(), one)).toEqual(['build.place']);
    const upgraded = match({}, { units: [{ ...body(1, MELEE_UNIT), defId: 'pledge_2' }] });
    expect(heard(one, upgraded)).toEqual(['build.upgrade']);
    expect(heard(one, match())).toEqual(['build.sell']);
  });

  it('does not take a unit respawning at the end of a wave for one being placed', () => {
    const fighting = match({ phase: 'combat' });
    const respawned = match({ phase: 'build' }, { units: [body(1, MELEE_UNIT)] });
    expect(heard(fighting, respawned)).toEqual(['wave.cleared']);
  });

  it('leaves a unit lost in combat to the fight, not to the till', () => {
    const one = match({ phase: 'combat' }, { units: [body(1, MELEE_UNIT)] });
    expect(heard(one, match({ phase: 'combat' }))).toEqual([]);
  });

  it('hears a purchase, and a switch of weapon or aura', () => {
    const before = match();
    const economy = before.lane!.economy!;
    expect(heard(before, match({}, { economy: { ...economy, tech: { damage: 1 } } }))).toEqual([
      'buy',
    ]);
    expect(heard(before, match({}, { economy: { ...economy, upgrades: { walls: 1 } } }))).toEqual([
      'buy',
    ]);
    expect(heard(before, match({}, { economy: { ...economy, supplyCap: 12 } }))).toEqual(['buy']);
    const fortress = before.lane!.fortress;
    expect(
      heard(before, match({}, { fortress: { ...fortress, weaponDamageType: 'pierce' } })),
    ).toEqual(['ui.switch']);
    expect(heard(before, match({}, { fortress: { ...fortress, activeAura: 'regen' } }))).toEqual([
      'ui.switch',
    ]);
  });

  it('hears a send go out when its cooldown restarts, and not while it runs down', () => {
    const at = (ticks: number) => {
      const view = match();
      view.lane!.economy!.sendCooldowns = { swarmling: ticks };
      return view;
    };
    expect(heard(match(), at(20))).toEqual(['send.launch']);
    expect(heard(at(20), at(19))).toEqual([]);
    expect(heard(at(3), at(20))).toEqual(['send.launch']);
  });

  it('hears a send at you, and your fortress taking a blow', () => {
    const before = match({ phase: 'combat' });
    expect(
      heard(
        before,
        match({ phase: 'combat' }, { sendLog: [{ sendId: 'swarmling', fromTeamId: 'lane2' }] }),
      ),
    ).toEqual(['send.incoming']);
    const hurt = match({ phase: 'combat' }, { fortress: { ...before.lane!.fortress, hp: 990 } });
    expect(heard(before, hurt)).toEqual(['fortress.hit']);
  });

  it('plays the ending once: a defeat when you are out, a victory when you are last', () => {
    const cues = new MatchCues();
    cues.observe(match({ phase: 'combat' }));
    expect(cues.observe(match({ phase: 'combat', eliminated: true }))).toEqual(['match.defeat']);
    expect(cues.observe(match({ phase: 'combat', eliminated: true, finished: true }))).toEqual([]);

    const won = match({ finished: true, placement: 1 });
    won.opponents = won.opponents.map((o) => ({ ...o, eliminated: true }));
    expect(heard(match({ phase: 'combat' }), won)).toContain('match.victory');
  });

  it('counts down to the showdown, then opens it', () => {
    const at = (seconds: number): MatchView =>
      match({
        phase: 'showdown',
        showdown: {
          countdown: seconds * TICKS_PER_SECOND,
          armies: [],
          attacks: [],
          centreHolders: [],
        } as unknown as MatchView['showdown'],
      });
    expect(heard(at(3), at(2))).toEqual(['showdown.tick']);
    expect(heard(at(1), at(0))).toEqual(['showdown.start']);
    expect(heard(at(0), at(0))).toEqual([]);
  });
});
