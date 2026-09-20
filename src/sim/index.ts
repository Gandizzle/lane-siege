/**
 * Public surface of the simulation. DESIGN.md §15.1.
 *
 * The renderer, the headless runner and the Colyseus server all import from
 * here and from nowhere deeper. Nothing in this module tree may import Pixi,
 * touch the DOM, read the wall clock or call Math.random - see
 * src/sim/purity.test.ts, which fails the build if that ever changes.
 */

export * from './types.ts';
export * from './commands.ts';
export * from './constants.ts';
export { Rng, waveRng } from './rng.ts';
export { damageMultiplier, resolveDamage } from './damage.ts';
export { enrageMultiplier, monsterEnrage, findWaveClock } from './enrage.ts';
export { createMatch, setLaneBuilder, MissingDataError } from './state.ts';
export type { MatchOptions, TeamSetup } from './state.ts';
export { createContext, step, snapshot } from './tick.ts';
export type { SimContext } from './tick.ts';
export { buildDefIndex } from './defs.ts';
export type { DefIndex } from './defs.ts';
export { applyCommand, applyCommands, sellValue, FORTRESS_UPGRADE_IDS } from './apply.ts';
export type { CommandResult } from './apply.ts';
export {
  generateWave,
  previewWave,
  summariseWave,
  isBossWave,
  resolveMonsterStats,
} from './waves.ts';
export type { SpawnSpec, WavePreviewEntry, WaveSummary, UnitRating } from './waves.ts';
export { inBounds, tileOccupiedByUnit } from './grid.ts';
export { gap, slideStep } from './motion.ts';
export type { Body, Bounds } from './motion.ts';
export { LEGS, arenaCentre, arenaShape, legForSeat, legPosition } from './arena.ts';
export type { ArenaShape, Leg } from './arena.ts';
export {
  applyHealing,
  crowdControlMultiplier,
  dampeningRemaining,
  healingMultiplier,
  summonHealthMultiplier,
} from './dampening.ts';
export { createMonster, createUnit, placeWave, spawnCentre } from './spawn.ts';
export { countLiving } from './spawn.ts';
// For the balance harness, which stands armies up directly rather than buying
// them one build phase at a time (src/balance/arena.ts).
export { recomputeUnitBuffs } from './buffs.ts';
export { stat } from './defs.ts';
export { viewFor } from './view.ts';
export type {
  AttackView,
  EconomyView,
  EntityView,
  StatMods,
  FortressView,
  LaneVisibility,
  LaneView,
  MatchView,
  OpponentView,
  ShowdownArmyView,
  ShowdownView,
  UnitDamageView,
} from './view.ts';
