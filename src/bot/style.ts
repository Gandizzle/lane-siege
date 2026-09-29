/**
 * How a scripted player plays: its personality (autoBuilder.ts reads it).
 *
 * A practice table is three of these, and three copies of one player is a
 * table that teaches one lesson. So each bot rolls an ARCHETYPE - a way of
 * playing somebody might actually choose - and then its numbers are jittered
 * inside the archetype's ranges, so two Raiders are not the same Raider.
 *
 * The knobs are the decisions the game actually asks for:
 *
 *   - How much of the gold goes into the economy (the gem building's two
 *     ladders), and whether that comes before the army or after it.
 *   - How big an army to hold over what the coming wave was tuned for
 *     (`margin`, against the wave's nominal army gold, waves.json).
 *   - Where the gems go: income sends, attack sends one at a time or saved
 *     for a volley, or the fortress itself - its walls, or its aura.
 *   - Who a send is aimed at.
 *   - Where the line stands (forward, or at the wall inside the aura), what
 *     it is made of (counter-picked each wave, or loyal to a favourite), and
 *     whether it goes tall on upgrades or wide on bodies.
 *   - How carefully all of it is done (`sloppiness`).
 *
 * Difficulty is not a setting. It falls out of the choices: a Banker that
 * survives its lean early waves is very hard to kill late, a Raider bleeds its
 * own economy into its volleys, a Rookie forgets to aim its fortress. That is
 * the variety the table is for.
 *
 * Rolled from a seeded generator (sim/rng.ts), so a match seed reproduces its
 * bots exactly - which is what makes a headless measurement of them repeatable.
 */

import type { AuraType } from '../data/schema.ts';
import { Rng } from '../sim/index.ts';

/** Where the gems that do not go into income sends go. */
export type GemUse = 'attack' | 'walls' | 'aura';

/** How attack sends are spent: as they come, or saved up and thrown together. */
export type SendHabit = 'trickle' | 'volley';

/** Who a send is aimed at. */
export type TargetRule = 'leader' | 'weakest' | 'random' | 'revenge';

/**
 * Where the line stands. Forward meets the wave early; at the wall it fights
 * inside the fortress's aura and under its gun, and pays in chip damage to the
 * fortress every wave.
 */
export type Formation = 'forward' | 'deep' | 'wall';

/**
 * What the army is made of: the best counter to each wave, the same one or two
 * lines whatever comes, or whatever takes its fancy.
 */
export type Composition = 'counter' | 'loyal' | 'random';

export interface BotStyle {
  archetype: ArchetypeId;
  /** Gem output levels to own per wave played: 0 is none, 1 the steady line (budget.ts). */
  economy: number;
  /** Waves between gem rate levels; Infinity for never. */
  rateEvery: number;
  /**
   * The army is bought to this share of the coming wave's nominal before any
   * gold goes into the economy - the line below which the wave is lost. The
   * nominal is what a medium player has left AFTER paying for the economy
   * (balance/budget.ts), so a floor near 1 starves the economy for good; a
   * low one trusts the economy to carry the army.
   */
  floor: number;
  /** Army gold to hold over the coming wave's nominal once the economy is paid, as a fraction of it. */
  margin: number;
  /** Of the gold left once army and economy are paid for, the share put into more army. */
  surplusToArmy: number;
  /** Of every gem earned, the share that goes into income sends. */
  incomeShare: number;
  /** What the rest of the gems buy. */
  gemUse: GemUse;
  sendHabit: SendHabit;
  /** For a volley: how many waves of gems to save before throwing them. */
  volleyWaves: number;
  target: TargetRule;
  /** The aura to run: a fixed one, one chosen for the wave, or none at all. */
  aura: AuraType | 'adaptive' | null;
  formation: Formation;
  /** Share of the bodies that are melee: the front line. */
  frontShare: number;
  composition: Composition;
  /** How much an upgrade is preferred to a new body of the same worth: >1 tall, <1 wide. */
  tall: number;
  /** Tech into the army's own damage types and health, or anything cheap, or none. */
  tech: 'focused' | 'spread' | 'none';
  /** Point the fortress weapon at the coming wave each build phase. It is free. */
  aimWeapon: boolean;
  /** Chance of fumbling any one decision: spending short, forgetting to aim. */
  sloppiness: number;
}

export const ARCHETYPE_IDS = [
  'banker',
  'tactician',
  'warden',
  'raider',
  'horde',
  'specialist',
  'rookie',
] as const;
export type ArchetypeId = (typeof ARCHETYPE_IDS)[number];

/** A knob's range: the archetype's centre, jittered uniformly inside it. */
type Range = readonly [number, number];

interface Archetype {
  id: ArchetypeId;
  /** What the player sees it called (opponent tabs). */
  name: string;
  /** How often it turns up at a table, relative to the others. */
  weight: number;
  economy: Range;
  rateEvery: Range;
  floor: Range;
  margin: Range;
  surplusToArmy: Range;
  incomeShare: Range;
  gemUse: readonly GemUse[];
  sendHabit: readonly SendHabit[];
  volleyWaves: Range;
  target: readonly TargetRule[];
  aura: readonly (AuraType | 'adaptive' | null)[];
  formation: readonly Formation[];
  frontShare: Range;
  composition: readonly Composition[];
  tall: Range;
  tech: readonly BotStyle['tech'][];
  aimWeapon: number;
  sloppiness: Range;
}

/**
 * Seven ways to play. The ranges are what makes each one itself; everything
 * inside them is left to the roll.
 */
export const ARCHETYPES: readonly Archetype[] = [
  {
    // Invests hard and early, sends only for income, holds a lean army. Poor
    // for the first few waves, rich for the rest of the game.
    id: 'banker',
    name: 'Banker',
    weight: 2,
    economy: [1.1, 1.5],
    rateEvery: [4, 5],
    floor: [0.5, 0.65],
    margin: [0.2, 0.35],
    surplusToArmy: [0.3, 0.6],
    incomeShare: [0.95, 1],
    gemUse: ['attack'],
    sendHabit: ['trickle'],
    volleyWaves: [3, 3],
    target: ['leader', 'random'],
    aura: ['damage', 'adaptive'],
    formation: ['deep', 'forward'],
    frontShare: [0.35, 0.5],
    composition: ['counter'],
    tall: [1.1, 1.4],
    tech: ['focused'],
    aimWeapon: 0.9,
    sloppiness: [0, 0.05],
  },
  {
    // The all-rounder: counters every wave, aims everything, a steady economy
    // and a comfortable army, and the odd send at whoever is winning.
    id: 'tactician',
    name: 'Tactician',
    weight: 2,
    economy: [0.9, 1.2],
    rateEvery: [5, 6],
    floor: [0.7, 0.8],
    margin: [0.35, 0.5],
    surplusToArmy: [0.6, 0.9],
    incomeShare: [0.75, 0.9],
    gemUse: ['attack'],
    sendHabit: ['trickle'],
    volleyWaves: [2, 2],
    target: ['leader'],
    aura: ['adaptive'],
    formation: ['deep'],
    frontShare: [0.35, 0.5],
    composition: ['counter'],
    tall: [1, 1.3],
    tech: ['focused'],
    aimWeapon: 1,
    sloppiness: [0, 0.03],
  },
  {
    // Stands at the wall and makes the fortress the weapon: the aura grown and
    // strengthened, the walls thickened, income on the side.
    id: 'warden',
    name: 'Warden',
    weight: 2,
    economy: [0.7, 1.0],
    rateEvery: [5, 7],
    floor: [0.65, 0.75],
    margin: [0.25, 0.4],
    surplusToArmy: [0.5, 0.8],
    incomeShare: [0.45, 0.65],
    gemUse: ['aura', 'walls'],
    sendHabit: ['trickle'],
    volleyWaves: [2, 2],
    target: ['revenge', 'leader'],
    aura: ['adaptive', 'armour', 'regeneration', 'damage'],
    formation: ['wall'],
    frontShare: [0.3, 0.45],
    composition: ['counter'],
    tall: [1.1, 1.4],
    tech: ['focused'],
    aimWeapon: 0.9,
    sloppiness: [0, 0.05],
  },
  {
    // Saves its gems and throws them at somebody all at once. A menace to its
    // target, and poorer for every volley than it would be for income.
    id: 'raider',
    name: 'Raider',
    weight: 2,
    economy: [0.5, 0.9],
    rateEvery: [6, 9],
    floor: [0.7, 0.8],
    margin: [0.2, 0.35],
    surplusToArmy: [0.6, 0.9],
    incomeShare: [0.3, 0.5],
    gemUse: ['attack'],
    sendHabit: ['volley'],
    volleyWaves: [2, 4],
    target: ['weakest', 'leader', 'random', 'revenge'],
    aura: ['damage', 'attackSpeed'],
    formation: ['forward', 'deep'],
    frontShare: [0.35, 0.55],
    composition: ['counter'],
    tall: [0.9, 1.2],
    tech: ['focused', 'spread'],
    aimWeapon: 0.8,
    sloppiness: [0, 0.08],
  },
  {
    // Goes wide: a crowd of cheap bodies, upgraded late, and a steady drip of
    // sends at whoever it feels like.
    id: 'horde',
    name: 'Horde',
    weight: 2,
    economy: [0.6, 1.0],
    rateEvery: [5, 8],
    floor: [0.75, 0.85],
    margin: [0.3, 0.45],
    surplusToArmy: [0.7, 1],
    incomeShare: [0.6, 0.8],
    gemUse: ['attack'],
    sendHabit: ['trickle'],
    volleyWaves: [2, 2],
    target: ['random', 'leader'],
    aura: ['attackSpeed', 'damage'],
    formation: ['forward', 'deep'],
    frontShare: [0.5, 0.7],
    composition: ['counter'],
    tall: [0.55, 0.8],
    tech: ['spread'],
    aimWeapon: 0.7,
    sloppiness: [0.02, 0.1],
  },
  {
    // Found a line it likes and sticks to it, whatever the wave says. Brilliant
    // when the waves suit it, and it does not notice when they stop.
    id: 'specialist',
    name: 'Specialist',
    weight: 2,
    economy: [0.8, 1.2],
    rateEvery: [5, 7],
    floor: [0.7, 0.8],
    margin: [0.4, 0.55],
    surplusToArmy: [0.6, 0.9],
    incomeShare: [0.7, 0.9],
    gemUse: ['attack', 'walls'],
    sendHabit: ['trickle', 'volley'],
    volleyWaves: [2, 3],
    target: ['leader', 'weakest'],
    aura: ['damage', 'attackSpeed', 'armour'],
    formation: ['deep', 'forward', 'wall'],
    frontShare: [0.3, 0.5],
    composition: ['loyal'],
    tall: [1.2, 1.6],
    tech: ['focused'],
    aimWeapon: 0.6,
    sloppiness: [0, 0.06],
  },
  {
    // New to the game: under-builds, forgets things, buys whatever catches its
    // eye, and keeps gold it should have spent.
    id: 'rookie',
    name: 'Rookie',
    weight: 1,
    economy: [0, 0.5],
    rateEvery: [8, 12],
    floor: [0.4, 0.6],
    margin: [-0.1, 0.1],
    surplusToArmy: [0.1, 0.4],
    incomeShare: [0.2, 0.6],
    gemUse: ['attack', 'walls'],
    sendHabit: ['trickle'],
    volleyWaves: [2, 2],
    target: ['random', 'leader'],
    aura: [null, 'damage', 'regeneration'],
    formation: ['forward', 'deep', 'wall'],
    frontShare: [0.2, 0.7],
    composition: ['random', 'counter'],
    tall: [0.6, 1.1],
    tech: ['none', 'spread'],
    aimWeapon: 0.15,
    sloppiness: [0.2, 0.4],
  },
];

export function archetype(id: ArchetypeId): Archetype {
  return ARCHETYPES.find((a) => a.id === id)!;
}

function within(rng: Rng, [low, high]: Range): number {
  return low + (high - low) * rng.next();
}

function oneOf<T>(rng: Rng, options: readonly T[]): T {
  return options[rng.int(options.length)]!;
}

/** A player of this archetype, its numbers rolled inside the archetype's ranges. */
export function rollStyle(rng: Rng, id: ArchetypeId): BotStyle {
  const a = archetype(id);
  return {
    archetype: a.id,
    economy: within(rng, a.economy),
    rateEvery: Math.round(within(rng, a.rateEvery)),
    floor: within(rng, a.floor),
    margin: within(rng, a.margin),
    surplusToArmy: within(rng, a.surplusToArmy),
    incomeShare: within(rng, a.incomeShare),
    gemUse: oneOf(rng, a.gemUse),
    sendHabit: oneOf(rng, a.sendHabit),
    volleyWaves: Math.round(within(rng, a.volleyWaves)),
    target: oneOf(rng, a.target),
    aura: oneOf(rng, a.aura),
    formation: oneOf(rng, a.formation),
    frontShare: within(rng, a.frontShare),
    composition: oneOf(rng, a.composition),
    tall: within(rng, a.tall),
    tech: oneOf(rng, a.tech),
    aimWeapon: rng.next() < a.aimWeapon,
    sloppiness: within(rng, a.sloppiness),
  };
}

/** An archetype drawn by weight. */
export function rollArchetype(rng: Rng): ArchetypeId {
  const total = ARCHETYPES.reduce((sum, a) => sum + a.weight, 0);
  let pick = rng.next() * total;
  for (const a of ARCHETYPES) {
    pick -= a.weight;
    if (pick < 0) return a.id;
  }
  return ARCHETYPES[0]!.id;
}

/**
 * Archetypes for a table of `count` bots, drawn by weight without repeats
 * while there are archetypes left: a table of three is three different ways
 * to play, which is what it is for.
 */
export function rollTable(rng: Rng, count: number): ArchetypeId[] {
  const out: ArchetypeId[] = [];
  for (let i = 0; i < count; i++) {
    let id = rollArchetype(rng);
    for (let tries = 0; tries < 20 && out.includes(id) && out.length < ARCHETYPES.length; tries++) {
      id = rollArchetype(rng);
    }
    out.push(id);
  }
  return out;
}

/** A rolled bot for one seat: how it plays, and what it is called. */
export interface SeatStyle {
  teamId: string;
  style: BotStyle;
  /** The archetype's name, numbered if the table has two: "Raider", "Raider 2". */
  name: string;
}

/**
 * Personalities for a table's bots, rolled from the match seed: different
 * archetypes while there are enough to go round, each with its own jitter.
 * The same seed seats the same bots, which is what makes a practice match's
 * `?seed=` - and a headless measurement - repeatable.
 */
export function rollSeats(seed: number, teamIds: readonly string[]): SeatStyle[] {
  const archetypes = rollTable(new Rng(seed ^ 0x51ed270b), teamIds.length);
  const seen = new Map<ArchetypeId, number>();
  return teamIds.map((teamId, i) => {
    const id = archetypes[i]!;
    const count = (seen.get(id) ?? 0) + 1;
    seen.set(id, count);
    const name = archetype(id).name;
    return {
      teamId,
      style: rollStyle(new Rng(seed ^ hashString(teamId)), id),
      name: count > 1 ? `${name} ${count}` : name,
    };
  });
}

/** A 32-bit mix of a string, to give each seat its own stream off one match seed. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The style a bot plays when nobody rolled one: the Tactician at the middle of
 * its ranges. Online rooms seat this in empty lanes, and the old headless
 * tools measure with it.
 */
export const DEFAULT_STYLE: BotStyle = rollStyleAtCentre('tactician');

function rollStyleAtCentre(id: ArchetypeId): BotStyle {
  const a = archetype(id);
  const mid = ([low, high]: Range) => (low + high) / 2;
  return {
    archetype: a.id,
    economy: mid(a.economy),
    rateEvery: Math.round(mid(a.rateEvery)),
    floor: mid(a.floor),
    margin: mid(a.margin),
    surplusToArmy: mid(a.surplusToArmy),
    incomeShare: mid(a.incomeShare),
    gemUse: a.gemUse[0]!,
    sendHabit: a.sendHabit[0]!,
    volleyWaves: Math.round(mid(a.volleyWaves)),
    target: a.target[0]!,
    aura: a.aura[0]!,
    formation: a.formation[0]!,
    frontShare: mid(a.frontShare),
    composition: a.composition[0]!,
    tall: mid(a.tall),
    tech: a.tech[0]!,
    aimWeapon: a.aimWeapon >= 0.5,
    sloppiness: mid(a.sloppiness),
  };
}

export { Rng };
