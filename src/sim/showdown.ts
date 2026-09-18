/**
 * The Final Showdown. DESIGN.md §3.3, replaced.
 *
 * §3.3 ended a match with an attrition endgame: from wave 25 nothing could be
 * built or respawned and ever nastier waves ground the table down until one
 * player was left. That is a race against a clock, and it is settled by who
 * banked the most gold rather than by who built the better line. The Final
 * Showdown settles it the other way: the last wave is cleared, the lanes are
 * put away, and all four armies are set down in one cross-shaped arena facing
 * each other. Last player with anything standing wins.
 *
 * WHAT CHANGES, AND WHAT DELIBERATELY DOES NOT
 *
 * Almost nothing changes. The units are the same objects that fought the waves
 * - moved, not copied - standing in the same formation the player arranged,
 * and they fight by exactly the rules they already fight by: hold a target
 * until it dies, then take the nearest; walk downhill on a distance field
 * toward the free positions around an enemy; stop when something is in range.
 * The only differences are that there is no fortress, no monsters, and three
 * other armies instead of one wave.
 *
 * That is on purpose. A player's read on their own army - this one holds a
 * line, this one outranges that one - is twenty-five waves of learning, and an
 * endgame that changed the rules would throw all of it away at the moment it
 * finally matters.
 *
 * TWO CLOCKS
 *
 * `phaseTicksLeft` counts the countdown card down ("Final Showdown in 3...").
 * Nothing moves and nothing swings until it reaches zero, so the card is a
 * real pause rather than an overlay on a fight already in progress.
 *
 * `showdown.age` starts at zero when the card clears and is what dampening
 * reads (dampening.ts): healing, summon HP and crowd-control durations all
 * fade as it climbs, so a fight between two armies that cannot quite finish
 * each other resolves instead of running forever.
 */

import { cooldownTicks, secondsToTicks } from './constants.ts';
import { buildArenaAbilityEnv, fire, tickBody, type AbilityEnv } from './abilityRuntime.ts';
import { legForSeat, legPosition } from './arena.ts';
import type { SimContext } from './context.ts';
import { applyHealing, healingMultiplier } from './dampening.ts';
import { stat } from './defs.ts';
import type { Body } from './motion.ts';
import type { Rng } from './rng.ts';
import { canAttack, canMove, modifiersOf, tauntedBy } from './status.ts';
import { dealDamage } from './strike.ts';
import { moveSeekers, planMoves, type Walker } from './steering.ts';
import { holdOrAcquire, withinRange } from './targeting.ts';
import type { DefensiveUnit, MatchState, Showdown, ShowdownArmy, TeamId } from './types.ts';

/**
 * Put the surviving armies in the arena and start the countdown.
 *
 * Every unit comes back at full HP, as it would at the start of a build phase
 * (§5.4): the showdown is the fight the whole match was for, and opening it
 * with somebody's line still chewed up by wave 25 would decide it on the order
 * the waves happened to arrive in rather than on what anyone built.
 *
 * Each unit is placed on the tile it was BUILT on, in its owner's spoke: the
 * formation a player spent the match arranging is the formation they bring,
 * and the row they kept safest behind the line is the row furthest from the
 * centre (arena.ts).
 */
export function beginShowdown(ctx: SimContext, state: MatchState): void {
  const armies: ShowdownArmy[] = [];

  state.teams.forEach((team, seat) => {
    if (team.eliminated) return;
    const lane = state.lanes[team.id];
    if (!lane) return;

    const leg = legForSeat(seat);
    for (const unit of lane.units) {
      const at = legPosition(ctx.arenaShape, leg, unit.homeTileX, unit.homeTileY);
      unit.pos.x = at.x;
      unit.pos.y = at.y;
      unit.alive = true;
      unit.hp = unit.maxHp;
      unit.cooldown = 0;
      unit.targetId = null;
      unit.engaged = false;
      unit.settled = false;
      unit.fieldCell = -1;
      unit.moveX = 0;
      unit.moveY = 0;
      unit.pathCost = 0;
      // A fresh scoreboard for the last fight, on the same rule as a wave
      // (§14.1): the numbers on screen are the numbers for the fight you are
      // watching.
      unit.damageDealt = 0;
    }

    // Moved, not copied. The lane is finished with; two of every unit would be
    // two of every unit for `snapshot` to duplicate and for the view to have
    // to choose between.
    armies.push({ teamId: team.id, seat, units: lane.units });
    lane.units = [];
  });

  state.showdown = { age: 0, armies, attacks: [] };
  state.phase = 'showdown';
  state.phaseTicksLeft = secondsToTicks(ctx.data.waves.showdown.countdownSeconds);
}

// Scratch, reused so that a tick allocates nothing (§15.3).
const enemyScratch: DefensiveUnit[] = [];
const everyone: Walker[] = [];
const seekingScratch: Walker[] = [];
const chasingScratch: Walker[] = [];
const chasedScratch: Body[] = [];

/** Everything alive that is not `army`'s, into the shared scratch array. */
function enemiesOf(showdown: Showdown, army: ShowdownArmy): readonly DefensiveUnit[] {
  enemyScratch.length = 0;
  for (const other of showdown.armies) {
    if (other === army) continue;
    for (const unit of other.units) {
      if (unit.alive) enemyScratch.push(unit);
    }
  }
  return enemyScratch;
}

/**
 * One tick of the Final Showdown: the same four stages a lane runs, with three
 * opponents instead of a wave.
 *
 * Everyone moves in ONE pass rather than army by army. In a lane the units
 * move and then the monsters do, and whichever kind is yet to move is treated
 * as settled - a deliberate asymmetry between two sides that are not
 * symmetric. Four armies fighting each other are symmetric, and moving them in
 * seat order would hand the south spoke a systematic advantage over the east
 * one for no reason anybody could see. So every seeker on the board is ordered
 * together by how near it is to a goal, exactly as the units in a lane are.
 */
export function showdownTick(ctx: SimContext, state: MatchState, rng: Rng): void {
  const showdown = state.showdown;
  if (!showdown) return;

  // The countdown card. Nothing happens under it.
  if (state.phaseTicksLeft > 0) {
    state.phaseTicksLeft -= 1;
    return;
  }

  showdown.age += 1;
  showdown.attacks.length = 0;

  const env = buildArenaAbilityEnv(ctx, showdown, rng);

  // 0. Every clock a body carries, as in a lane (tick.ts): statuses expire,
  // burns burn, energy fills, passives renew and the abilities that fire on
  // their own initiative do. Dampening bites on the healing and the control
  // durations inside `env`, which is the whole reason it exists (§3.3,
  // replaced) - a free-for-all in which two armies can hold each other still
  // or heal each other up is a free-for-all that does not end.
  for (const army of showdown.armies) {
    for (const unit of army.units) if (unit.alive) tickBody(env, unit);
  }

  // 1. Who is fighting and who is walking, and 2. where the walkers are going.
  // Both per army, off the same enemy list, so the scratch array is filled
  // once per army rather than once per stage.
  for (const army of showdown.armies) {
    const enemies = enemiesOf(showdown, army);
    classify(ctx, army, enemies);
    planArmyMoves(ctx, army, enemies);
  }

  // 3. Everyone walks, in one order.
  everyone.length = 0;
  for (const army of showdown.armies) {
    for (const unit of army.units) everyone.push(unit);
  }
  moveSeekers(ctx.arena, everyone, (unit) => walkSpeed(unit as DefensiveUnit), [everyone]);

  // 4. Everyone in range lands a hit if their cooldown allows.
  for (const army of showdown.armies) {
    attack(env, ctx, showdown, army, enemiesOf(showdown, army));
  }

  reapArena(env, ctx, showdown);
}

/**
 * How far a unit looks for something to fight: its own reach plus a margin,
 * never less than a floor, both from `waves.showdown.acquire`.
 *
 * A lane gives a unit no acquisition cap at all (`NO_ACQUIRE_LIMIT`), because
 * a lane holds one enemy - the wave - and there is no question of which way to
 * face. The arena is the opposite case, and sight of the whole board is wrong
 * there for the reason §5.1 gives for monsters: "nearest enemy anywhere" is a
 * GLOBAL question, and forty bodies re-answering it every tick against three
 * moving crowds all change their minds together. It also has a unit pick a
 * duel from thirty tiles away instead of walking into the fight. Tied to the
 * unit's own reach, so a mortar looks as far as it can actually shoot rather
 * than as far as a melee body would have noticed.
 */
function acquireRange(ctx: SimContext, unit: DefensiveUnit): number {
  const { margin, minimum } = ctx.data.waves.showdown.acquire;
  return Math.max(minimum, unit.range + margin);
}

/**
 * §5.2, unchanged: hold the target until it dies, then take the nearest -
 * within `acquireRange`, which is the one thing the arena changes.
 *
 * Nothing in range returns no target at all, and the caller decides what that
 * means. Here it means the centre of the map (`planArmyMoves`), exactly as an
 * empty lane means the fortress for a monster (§5.5).
 */
function classify(ctx: SimContext, army: ShowdownArmy, enemies: readonly DefensiveUnit[]): void {
  for (const unit of army.units) {
    if (!unit.alive) continue;
    if (unit.cooldown > 0) unit.cooldown -= 1;

    // A taunt overrides acquisition here exactly as it does in a lane, and
    // matters more: the arena has no fortress to fall back to, so dragging a
    // body off its chosen duel is the whole of what a tank does (§18).
    const held = tauntedBy(unit);
    const forced = held === null ? null : (enemies.find((e) => e.id === held && e.alive) ?? null);
    const target = forced ?? holdOrAcquire(enemies, unit, acquireRange(ctx, unit));
    unit.targetId = target ? target.id : null;
    unit.engaged = target !== null && withinRange(unit, target, unit.range);
  }
}

/**
 * An army walks in two groups, and which group a unit is in is the whole of
 * how the arena fills up.
 *
 * SEEKERS have nothing inside their acquisition range and are walking at the
 * middle of the map. Enemies on the way are obstacles to route around, not
 * destinations - so a unit does not turn aside for a fight it has not noticed,
 * and an army does not swing as one toward whichever body happened to be
 * nearest when the countdown lifted.
 *
 * CHASERS have something in range and are going to fight it. Their goals are
 * the free attack positions around the bodies actually being chased, which is
 * what makes a unit walk round a full ring to the one gap in it rather than
 * press into the back of it.
 *
 * The same split a wave makes in a lane, with the middle of the map where the
 * fortress would be (tick.ts, `planMonsterMoves`).
 */
function planArmyMoves(
  ctx: SimContext,
  army: ShowdownArmy,
  enemies: readonly DefensiveUnit[],
): void {
  seekingScratch.length = 0;
  chasingScratch.length = 0;
  chasedScratch.length = 0;

  for (const unit of army.units) {
    if (!unit.alive || unit.engaged) continue;
    const target =
      unit.targetId === null
        ? null
        : (enemies.find((e) => e.id === unit.targetId && e.alive) ?? null);

    if (!target) {
      seekingScratch.push(unit);
      continue;
    }
    chasingScratch.push(unit);
    if (!chasedScratch.includes(target)) chasedScratch.push(target);
  }

  if (seekingScratch.length > 0) {
    planMoves(
      ctx,
      ctx.arena,
      army.teamId,
      'toCentre',
      seekingScratch,
      enemies,
      army.units,
      true,
      ctx.arenaCentre,
    );
  }
  if (chasingScratch.length > 0) {
    planMoves(
      ctx,
      ctx.arena,
      army.teamId,
      'toTarget',
      chasingScratch,
      enemies,
      army.units,
      true,
      null,
      chasedScratch,
    );
  }

  // Engaged units are in neither group and are going nowhere.
  for (const unit of army.units) {
    if (!unit.alive || !unit.engaged) continue;
    unit.moveX = 0;
    unit.moveY = 0;
    unit.pathCost = 0;
  }
}

/**
 * §7.4's tech still applies - it was bought and it is cached on the unit. §10.1's
 * aura does not: an aura is a ring around a fortress, and no fortress comes to
 * the showdown.
 */
function attack(
  env: AbilityEnv,
  ctx: SimContext,
  showdown: Showdown,
  army: ShowdownArmy,
  enemies: readonly DefensiveUnit[],
): void {
  for (const unit of army.units) {
    if (!unit.alive || !unit.engaged || unit.cooldown > 0) continue;
    if (!canAttack(unit)) continue;

    const def = ctx.defs.units.get(unit.defId);
    if (!def) continue;
    const target = enemies.find((e) => e.id === unit.targetId && e.alive);
    if (!target) continue;

    // The same one place damage is dealt as in a lane (strike.ts), and the
    // same §14.1 credit.
    dealDamage(env.strike, unit, target, {
      amount: stat(def.damage) * unit.techDamage,
      damageType: def.damageType,
      isAttack: true,
    });
    unit.cooldown = cooldownTicks(
      stat(def.attackSpeed) * unit.techAttackSpeed * modifiersOf(unit).attackSpeedMul,
    );
    showdown.attacks.push({ attackerId: unit.id, targetId: target.id });

    fire(env, unit, 'onAttack', { target });
    if (target.hp <= 0) fire(env, unit, 'onKill', { target });
  }
}

/** A unit's speed in the arena this tick, after its statuses (status.ts). */
function walkSpeed(unit: DefensiveUnit): number {
  if (!canMove(unit)) return 0;
  const m = modifiersOf(unit);
  return Math.max(0, unit.moveSpeed * m.moveSpeedMul + m.moveSpeedAdd);
}

/**
 * Deathrattles, then healing, then drop the dead.
 *
 * `regenPerSecond` below is still zero for everything - it was the seam a
 * healing effect was expected to arrive through, and abilities arrived
 * somewhere else instead: a `regen` status is carried on the body and is
 * applied by `tickBody` at the top of the tick, where dampening reaches it
 * through the same environment as everything else (abilityRuntime.ts). The
 * loop stays because §10.1's aura would still report through it if a fortress
 * ever came to the arena.
 */
function reapArena(env: AbilityEnv, ctx: SimContext, showdown: Showdown): void {
  const healing = healingMultiplier(ctx.data.waves.showdown.dampening, showdown.age);

  // Deathrattles first, while the body is still standing and still somewhere
  // (tick.ts, `reapDead`, for why the order matters).
  for (const army of showdown.armies) {
    for (const unit of army.units) {
      if (unit.alive && unit.hp <= 0) fire(env, unit, 'onDeath', {});
    }
  }

  for (const army of showdown.armies) {
    let died = false;
    for (const unit of army.units) {
      if (!unit.alive) continue;
      unit.hp = applyHealing(unit.hp, unit.maxHp, regenPerSecond(unit), healing);
      if (unit.hp <= 0) {
        unit.alive = false;
        died = true;
      }
    }
    // A corpse is not an obstacle and not a target, and leaving it in the
    // array is one more `alive` check on every pass over it forever.
    if (died) army.units = army.units.filter((unit) => unit.alive);
  }
}

/**
 * HP per second this body regains in the arena, before dampening.
 *
 * Zero for everything today, and the function exists so that it has somewhere
 * to stop being zero. §10.1's regeneration aura radiates from a fortress and
 * there is no fortress here; a regenerating unit, a healer or a consumable
 * would each report through this, and every point of it would then be
 * multiplied by the dampening at the one call site above (§3.3, replaced).
 */
function regenPerSecond(_unit: DefensiveUnit): number {
  return 0;
}

/**
 * §13, in the arena: an army with nothing left standing is out, and when at
 * most one is still standing the match is over.
 *
 * Placements are counted up from the bottom, as during the waves, so the first
 * army wiped places last. The survivor is placed first here rather than left
 * unplaced - the showdown is the only thing in the match that produces an
 * outright winner, and "won" is a placement like any other.
 */
export function showdownEliminations(state: MatchState): void {
  const showdown = state.showdown;
  if (!showdown) return;
  // Nothing is decided under the countdown card.
  if (state.phaseTicksLeft > 0) return;

  let standing: TeamId | null = null;
  let standingCount = 0;

  for (const army of showdown.armies) {
    const alive = army.units.some((unit) => unit.alive);
    if (alive) {
      standing = army.teamId;
      standingCount += 1;
      continue;
    }

    const team = state.teams.find((t) => t.id === army.teamId);
    if (!team || team.eliminated) continue;
    team.eliminated = true;
    state.eliminatedCount += 1;
    team.placement = state.teams.length - state.eliminatedCount + 1;
  }

  if (standingCount > 1) return;

  state.finished = true;
  if (standing === null) return;
  const winner = state.teams.find((t) => t.id === standing);
  if (winner) winner.placement = 1;
}
