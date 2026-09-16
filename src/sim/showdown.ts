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

import { NO_ACQUIRE_LIMIT, cooldownTicks, secondsToTicks } from './constants.ts';
import { legForSeat, legPosition } from './arena.ts';
import type { SimContext } from './context.ts';
import { applyHealing, healingMultiplier } from './dampening.ts';
import { resolveDamage } from './damage.ts';
import { stat } from './defs.ts';
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
export function showdownTick(ctx: SimContext, state: MatchState): void {
  const showdown = state.showdown;
  if (!showdown) return;

  // The countdown card. Nothing happens under it.
  if (state.phaseTicksLeft > 0) {
    state.phaseTicksLeft -= 1;
    return;
  }

  showdown.age += 1;
  showdown.attacks.length = 0;

  // 1. Who is fighting and who is walking, and 2. where the walkers are going.
  // Both per army, off the same enemy list, so the scratch array is filled
  // once per army rather than once per stage.
  for (const army of showdown.armies) {
    const enemies = enemiesOf(showdown, army);
    classify(army, enemies);
    planMoves(ctx, ctx.arena, army.teamId, 'showdown', army.units, enemies, army.units, true, null);
  }

  // 3. Everyone walks, in one order.
  everyone.length = 0;
  for (const army of showdown.armies) {
    for (const unit of army.units) everyone.push(unit);
  }
  moveSeekers(ctx.arena, everyone, (unit) => unit.moveSpeed, [everyone]);

  // 4. Everyone in range lands a hit if their cooldown allows.
  for (const army of showdown.armies) {
    attack(ctx, showdown, army, enemiesOf(showdown, army));
  }

  reapArena(ctx, showdown);
}

/**
 * §5.2, unchanged: hold the target until it dies, then take the nearest. No
 * acquisition cap - a unit in the arena has no fortress to fall back on, so
 * "the nearest enemy anywhere" is its default and it advances on one it cannot
 * yet reach.
 */
function classify(army: ShowdownArmy, enemies: readonly DefensiveUnit[]): void {
  for (const unit of army.units) {
    if (!unit.alive) continue;
    if (unit.cooldown > 0) unit.cooldown -= 1;

    const target = holdOrAcquire(enemies, unit, NO_ACQUIRE_LIMIT);
    unit.targetId = target ? target.id : null;
    unit.engaged = target !== null && withinRange(unit, target, unit.range);
  }
}

/**
 * §7.4's tech still applies - it was bought and it is cached on the unit. §10.1's
 * aura does not: an aura is a ring around a fortress, and no fortress comes to
 * the showdown.
 */
function attack(
  ctx: SimContext,
  showdown: Showdown,
  army: ShowdownArmy,
  enemies: readonly DefensiveUnit[],
): void {
  for (const unit of army.units) {
    if (!unit.alive || !unit.engaged || unit.cooldown > 0) continue;

    const def = ctx.defs.units.get(unit.defId);
    if (!def) continue;
    const target = enemies.find((e) => e.id === unit.targetId && e.alive);
    if (!target) continue;

    const dealt = resolveDamage(
      ctx.data.matrix.multipliers,
      stat(def.damage) * unit.techDamage,
      def.damageType,
      target.armour,
    );
    // Credited with what the target actually lost, as in a lane (§14.1).
    unit.damageDealt += target.hp > 0 ? Math.min(dealt, target.hp) : 0;
    target.hp -= dealt;
    unit.cooldown = cooldownTicks(stat(def.attackSpeed) * unit.techAttackSpeed);
    showdown.attacks.push({ attackerId: unit.id, targetId: target.id });
  }
}

/**
 * Drop the dead, and heal whatever has healing - which is nothing yet.
 *
 * The healing loop is here rather than absent because it is the seam the
 * effect arrives through, and because it is where dampening has to bite when
 * it does (dampening.ts). §10.1's regeneration aura is the only healing in the
 * game and it comes from a fortress, so `regenPerSecond` is zero for every
 * body in the arena today.
 */
function reapArena(ctx: SimContext, showdown: Showdown): void {
  const healing = healingMultiplier(ctx.data.waves.showdown.dampening, showdown.age);

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
