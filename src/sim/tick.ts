/**
 * The fixed-timestep step function. DESIGN.md §15.1.
 *
 * `step(ctx, state, commands)` advances the match exactly one tick at
 * 20 ticks/second. No wall clock, no Math.random, no DOM, no Pixi. The server
 * runs this same function, which is what makes replays exact and desyncs
 * detectable.
 *
 * On mutation: §15.3 requires pooled objects and no per-frame allocation, which
 * rules out rebuilding the state tree every tick. So the state is mutated in
 * place and returned. Treat the returned reference as the new state and never
 * hold on to the old one - snapshot with `snapshot()` if you need history.
 *
 * MOVEMENT, IN ONE PARAGRAPH
 *
 * Every body is either engaged - something is in range, it attacks, it does not
 * move and nothing moves it - or seeking. A seeker walks downhill on a distance
 * field whose goals are the free attack positions around every enemy and whose
 * obstacles are everything standing still, and slides off whatever it touches
 * on the way. That is all of it. There is no slot assignment, no tangent
 * steering, no stuck detection, no give-up timer and no post-hoc separation
 * pass, because with those two rules there is nothing left for any of them to
 * fix. See motion.ts and flowfield.ts for the two halves, and docs/PATHING.md
 * for why it is this and not something else.
 */

import { NO_ACQUIRE_LIMIT, cooldownTicks, secondsToTicks } from './constants.ts';
import {
  buildLaneAbilityEnv,
  fire,
  tickBody,
  type AbilityBody,
  type AbilityEnv,
} from './abilityRuntime.ts';
import { Rng } from './rng.ts';
import { dealDamage } from './strike.ts';
import { canAttack, canMove, freshAbilityState, modifiersOf, tauntedBy } from './status.ts';
import type { Command } from './commands.ts';
import { applyCommands } from './apply.ts';
import { resolveDamage } from './damage.ts';
import { stat } from './defs.ts';
import { auraFor, recomputeUnitBuffs } from './buffs.ts';
import { applyHealing } from './dampening.ts';
import { monsterEnrage } from './enrage.ts';
import type { Body } from './motion.ts';
import type { SimContext } from './context.ts';
import { moveSeekers, planMoves, type Walker } from './steering.ts';
import { beginShowdown, showdownEliminations, showdownTick } from './showdown.ts';
import { admitFromReserve, countLiving, createMonster, placeWave } from './spawn.ts';
import { holdOrAcquire, nearestInRange, withinRange } from './targeting.ts';
import {
  FORTRESS_ID,
  type DefensiveUnit,
  type Lane,
  type MatchState,
  type Monster,
} from './types.ts';
import { generateWave, resolveMonsterStats, sendBounty, type SpawnSpec } from './waves.ts';

export { createContext } from './context.ts';
export type { SimContext, World } from './context.ts';

/**
 * §8: every wave carries its own enrage clock, which keeps running while any of
 * its monsters are alive anywhere and stops when the last one dies.
 */
function advanceWaveClocks(state: MatchState): void {
  let finished = 0;
  for (const clock of state.waveClocks) {
    if (clock.remaining > 0) clock.age += 1;
    else finished++;
  }
  // Only rebuild the array when a wave has actually ended, so the common tick
  // allocates nothing.
  if (finished > 0) {
    state.waveClocks = state.waveClocks.filter((c) => c.remaining > 0);
  }
}

/**
 * §12: sight of an opponent's lane, bought with a send, runs out.
 *
 * Counted down on the watcher rather than the watched, so two opponents looking
 * at the same lane have their own clocks.
 */
function advanceVision(state: MatchState): void {
  for (const team of state.teams) {
    for (const watched of Object.keys(team.vision)) {
      const left = team.vision[watched] ?? 0;
      if (left > 0) team.vision[watched] = left - 1;
      else delete team.vision[watched];
    }
  }
}

// ------------------------------------------------------------ engage or seek

/**
 * Decide, for every unit, who it is fighting and whether it can reach them.
 *
 * §5.2: a unit holds its target until that dies, then takes the nearest. There
 * is no acquisition cap - a unit has no fortress of its own to walk at, so
 * "the nearest monster in the lane" is its default and it advances on one it
 * cannot yet reach (§5.2, amended: units advance rather than stand idle).
 *
 * `engaged` is narrower than `targetId`: a unit with a target three tiles away
 * has one to walk toward, not one to shoot. Cooldowns tick here so a body that
 * is walking still recovers.
 */
function classifyUnits(lane: Lane): void {
  for (const unit of lane.units) {
    if (!unit.alive) continue;
    if (unit.cooldown > 0) unit.cooldown -= 1;

    const target =
      forcedTarget(lane.monsters, unit) ?? holdOrAcquire(lane.monsters, unit, NO_ACQUIRE_LIMIT);
    unit.targetId = target ? target.id : null;
    unit.engaged = target !== null && withinRange(unit, target, unit.range);
  }
}

/**
 * Who a taunt is making this body fight, or null (§18).
 *
 * Overriding the target rather than adding a rule to acquisition is what makes
 * a taunt work at any distance: a body whose target is out of reach becomes a
 * CHASER and walks to it (see `planMonsterMoves`), which is exactly what being
 * dragged onto a tank should look like. The taunter dying ends it immediately,
 * because a target that is not in the list is not a target.
 */
function forcedTarget<T extends { id: number; alive: boolean }>(
  candidates: readonly T[],
  body: AbilityBody,
): T | null {
  const holder = tauntedBy(body);
  if (holder === null) return null;
  return candidates.find((c) => c.id === holder && c.alive) ?? null;
}

/**
 * The same for monsters, with one difference that changes how a whole wave
 * moves: a monster always has somewhere to be.
 *
 * §5.5 says the fortress is what a wave is for, and that is now the DEFAULT
 * rather than what is left when the lane is empty. A monster walks at the
 * fortress and looks no further than `monsterAcquireRange` for something to
 * fight; inside that it takes the nearest and keeps it until it dies or drifts
 * out; once it is trading blows it stops looking entirely.
 *
 * What this replaces is "every monster in the lane goes after the nearest unit
 * anywhere". That made one tower the destination of thirty bodies at once - a
 * global answer that every one of them recomputed every tick, and which changed
 * for all of them together whenever anything moved. A monster that cannot reach
 * a defender now simply carries on past it, which is what a lane defence looks
 * like, and the queue that used to form behind an unreachable target does not
 * form.
 */
function classifyMonsters(ctx: SimContext, lane: Lane): void {
  const acquireRange = ctx.data.lane.monsterAcquireRange;

  for (const monster of lane.monsters) {
    if (!monster.alive) continue;
    if (monster.cooldown > 0) monster.cooldown -= 1;

    const unit =
      forcedTarget(lane.units, monster) ?? holdOrAcquire(lane.units, monster, acquireRange);
    monster.targetId = unit ? unit.id : FORTRESS_ID;
    monster.engaged = withinRange(monster, unit ?? ctx.fortress, monster.range);
  }
}

// ------------------------------------------------------------------ planning

/**
 * Monsters move in two groups, and which group a monster is in is the whole of
 * how a wave behaves.
 *
 * SEEKERS have caught sight of nothing and are walking at the fortress (§5.5).
 * Defenders are obstacles to route around, not destinations - so a tower off to
 * one side is simply passed, and thirty bodies do not all turn toward it.
 *
 * CHASERS have a defender inside their acquisition range and are going to fight
 * it. They get the older behaviour, and they need it: their goals are the free
 * attack positions around the defenders that are actually being chased, which
 * is what makes a body walk round a full ring to the one gap in it instead of
 * pressing into the back of it. Confining that to bodies already within
 * acquisition range is what keeps it from becoming a lane-wide stampede - it is
 * a local crowd solving a local problem.
 *
 * Both groups are built into scratch arrays rather than fresh ones: this runs
 * per lane per tick (§15.3).
 */
const seekingScratch: Walker[] = [];
const chasingScratch: Walker[] = [];
const chasedScratch: Body[] = [];

function planMonsterMoves(ctx: SimContext, lane: Lane, unitsBlock: boolean): void {
  seekingScratch.length = 0;
  chasingScratch.length = 0;
  chasedScratch.length = 0;

  for (const monster of lane.monsters) {
    if (!monster.alive || monster.engaged) continue;
    const target =
      monster.targetId === FORTRESS_ID || monster.targetId === null
        ? null
        : (lane.units.find((u) => u.id === monster.targetId && u.alive) ?? null);

    if (!target) {
      seekingScratch.push(monster);
      continue;
    }
    chasingScratch.push(monster);
    if (!chasedScratch.includes(target)) chasedScratch.push(target);
  }

  if (seekingScratch.length > 0) {
    planMoves(
      ctx,
      ctx.lane,
      lane.teamId,
      'toFortress',
      seekingScratch,
      lane.units,
      lane.monsters,
      unitsBlock,
      ctx.fortress,
    );
  }
  if (chasingScratch.length > 0) {
    planMoves(
      ctx,
      ctx.lane,
      lane.teamId,
      'toTarget',
      chasingScratch,
      lane.units,
      lane.monsters,
      unitsBlock,
      null,
      chasedScratch,
    );
  }

  // Engaged monsters are not in either group and are going nowhere.
  for (const monster of lane.monsters) {
    if (!monster.alive || !monster.engaged) continue;
    monster.moveX = 0;
    monster.moveY = 0;
    monster.pathCost = 0;
  }
}

// ------------------------------------------------------------------- moving

// ----------------------------------------------------------------- fighting

function unitsAttack(env: AbilityEnv, ctx: SimContext, lane: Lane): void {
  for (const unit of lane.units) {
    if (!unit.alive || !unit.engaged || unit.cooldown > 0) continue;
    // A stunned or disarmed unit keeps its target and its cooldown and simply
    // does not swing (status.ts).
    if (!canAttack(unit)) continue;

    const def = ctx.defs.units.get(unit.defId);
    if (!def) continue;
    const target = lane.monsters.find((m) => m.id === unit.targetId && m.alive);
    if (!target) continue;

    // §7.4 tech is cached on the unit; §10.1 aura depends on where it is
    // standing right now, so it is evaluated here (see buffs.ts on why).
    const aura = auraFor(lane, unit, ctx.fortressPosition);

    // Through `dealDamage`, which is the one place HP goes down: evasion,
    // wards, criticals, the §6 matrix, the target's vulnerability, lifesteal
    // and reflection all live there (strike.ts), and the §14.1 credit is what
    // the monster actually lost.
    dealDamage(env.strike, unit, target, {
      amount: stat(def.damage) * unit.techDamage * aura.damage,
      damageType: def.damageType,
      isAttack: true,
    });
    unit.cooldown = cooldownTicks(
      stat(def.attackSpeed) *
        unit.techAttackSpeed *
        aura.attackSpeed *
        modifiersOf(unit).attackSpeedMul,
    );
    lane.attacks.push({ attackerId: unit.id, targetId: target.id });

    // §7: the blow has landed, so whatever the unit does on landing one now
    // happens - and if it killed, that too.
    fire(env, unit, 'onAttack', { target });
    if (target.hp <= 0) fire(env, unit, 'onKill', { target });
  }
}

function monstersAttack(env: AbilityEnv, ctx: SimContext, lane: Lane, state: MatchState): void {
  const enrageConfig = ctx.data.waves.enrage;

  for (const monster of lane.monsters) {
    if (!monster.alive || !monster.engaged || monster.cooldown > 0) continue;
    if (!canAttack(monster)) continue;

    // §8: enrage raises damage and attack speed. Never HP - a stalling player
    // should face deadlier monsters, not unkillable ones.
    const multiplier = monsterEnrage(state, monster, enrageConfig);
    const damage = monster.damage * multiplier;

    if (monster.targetId !== FORTRESS_ID) {
      const target = lane.units.find((u) => u.id === monster.targetId && u.alive);
      if (!target) continue;
      // §10.1's armour aura is a property of where the unit is standing and
      // not of any ability, so it multiplies the swing on the way in; every
      // other mitigation is inside `dealDamage` (strike.ts).
      dealDamage(env.strike, monster, target, {
        amount: damage * auraFor(lane, target, ctx.fortressPosition).damageTaken,
        damageType: monster.damageType,
        isAttack: true,
      });
      lane.attacks.push({ attackerId: monster.id, targetId: target.id });
      fire(env, monster, 'onAttack', { target });
      if (target.hp <= 0) fire(env, monster, 'onKill', { target });
    } else {
      // Sieging the fortress (§5.5).
      lane.fortress.hp -= resolveDamage(
        ctx.data.matrix.multipliers,
        damage,
        monster.damageType,
        ctx.data.fortress.armour,
      );
      lane.attacks.push({ attackerId: monster.id, targetId: FORTRESS_ID });
    }

    monster.cooldown = cooldownTicks(
      monster.attackSpeed * multiplier * modifiersOf(monster).attackSpeedMul,
    );
  }
}

/** The whole movement-and-combat pipeline for one lane, in order. */
function laneTick(ctx: SimContext, lane: Lane, state: MatchState, rng: Rng): void {
  const enrageConfig = ctx.data.waves.enrage;
  const unitsBlock = ctx.data.lane.unitsBlockMovement !== false;

  // Last tick's blows are last tick's news. Emptied in place rather than
  // replaced, so the common tick allocates nothing (§15.3).
  lane.attacks.length = 0;

  const env = buildLaneAbilityEnv(ctx, lane, rng, state.phase === 'combat');

  // 0. Every clock a body carries: statuses expire, burns burn, wounds close,
  // energy fills, and the abilities that fire on their own initiative do
  // (abilityRuntime.ts). BEFORE classification, so a slow applied last tick is
  // in force for the walking that happens this one.
  for (const unit of lane.units) if (unit.alive) tickBody(env, unit);
  for (const monster of lane.monsters) if (monster.alive) tickBody(env, monster);

  // 1. Who is fighting and who is walking, from where everyone is now.
  classifyUnits(lane);
  classifyMonsters(ctx, lane);

  // 2. Every walker picks a direction, off fields built from step 1.
  // A unit plans and walks in `unitLane` - the lane without its spawn zone -
  // so the ground a wave arrives on stays the attacker's (context.ts).
  planMoves(
    ctx,
    ctx.unitLane,
    lane.teamId,
    'unit',
    lane.units,
    lane.monsters,
    lane.units,
    true,
    null,
  );
  planMonsterMoves(ctx, lane, unitsBlock);

  // 3. Everyone walks: units first, then monsters. Whichever kind is not
  // moving is settled - where it is now is where it will be - and monsters
  // carry enrage on their speed (§8).
  // The fortress is in every contact set: it is solid to both kinds, and
  // without it a besieging crowd presses straight through the wall.
  const obstacles: (readonly Body[])[] = unitsBlock
    ? [lane.units, lane.monsters, ctx.fortressBodies]
    : [lane.monsters, ctx.fortressBodies];
  for (const monster of lane.monsters) monster.settled = true;
  // The whole lane for CONTACT, `unitLane` only for steering above. The spawn
  // zone is somewhere a unit will not walk, not a wall it can be crushed
  // against: clamping a body between an invisible edge and a crowd pressing on
  // it is the wedge `SLIDE_PASSES` exists for, and it measurably cost the
  // no-overlap guarantee (0.0147 tiles against a 0.01 tolerance). Shoved a
  // hair past the line by a crowd, a unit simply walks back out.
  // Slows, roots and stuns arrive here: a status that scales `moveSpeed` and
  // one that forbids moving outright are the same rule read twice (status.ts).
  moveSeekers(
    ctx.lane,
    lane.units,
    (u) => walkSpeed(u as AbilityBody, (u as DefensiveUnit).moveSpeed),
    [lane.units, lane.monsters, ctx.fortressBodies],
  );
  for (const unit of lane.units) unit.settled = true;
  moveSeekers(
    ctx.lane,
    lane.monsters,
    (m) =>
      walkSpeed(
        m as AbilityBody,
        (m as Monster).moveSpeed * monsterEnrage(state, m as Monster, enrageConfig),
      ),
    obstacles,
  );

  // 4. Everyone who was fighting lands a hit if their cooldown allows.
  unitsAttack(env, ctx, lane);
  monstersAttack(env, ctx, lane, state);
}

/** A body's speed this tick, after its statuses. Rooted or stunned is zero. */
function walkSpeed(body: AbilityBody, base: number): number {
  if (!canMove(body)) return 0;
  const m = modifiersOf(body);
  return Math.max(0, base * m.moveSpeedMul + m.moveSpeedAdd);
}

/**
 * §10.1: the fortress weapon is the last line of defence and must reliably kill
 * one or two current-wave monsters unaided, so that small leaks self-repair and
 * large ones are correctly fatal. Its damage type is chosen by the player each
 * build phase.
 */
function fortressActs(ctx: SimContext, lane: Lane): void {
  if (lane.fortress.destroyed) return;

  if (lane.fortress.weaponCooldown > 0) {
    lane.fortress.weaponCooldown -= 1;
    return;
  }

  // The LANE's numbers, not the data's. Each of these starts at its data base
  // and is what the weapon ladder raises (§10.1, apply.ts); read from the data
  // instead, the weapon fires at its base forever and every level of the
  // upgrade is gold spent on nothing.
  const weapon = lane.fortress;
  // From the wall, not from a point at the middle of it: a monster chewing the
  // far end of a five-tile fortress is in range of the fortress.
  const target = nearestInRange(lane.monsters, ctx.fortress, weapon.weaponRange);
  if (!target) return;

  const alive = target.hp > 0;
  target.hp -= resolveDamage(
    ctx.data.matrix.multipliers,
    weapon.weaponDamage,
    lane.fortress.weaponDamageType,
    target.armour,
  );
  // Whoever lands the killing blow owns the kill, and the wall's kills pay
  // differently (§11.1, amended). `alive` guards the case where something else
  // already finished it this tick and it has not been reaped yet.
  if (alive && target.hp <= 0) target.killedByFortress = true;
  lane.fortress.weaponCooldown = cooldownTicks(weapon.weaponAttackSpeed);
  lane.attacks.push({ attackerId: FORTRESS_ID, targetId: target.id });
}

/**
 * §11.1, amended: a kill the FORTRESS made pays the lane it happened in
 * nothing, and pays every other living lane a flat gold instead.
 *
 * The weapon exists so that a small leak repairs itself and a large one is
 * correctly fatal (§10.1) - not as a defence you build around. Paid the bounty
 * for its kills, it was: a player could let the wall farm a wave and bank the
 * gold for it. Now leaning on the wall funds the rest of the table, which is
 * the same pressure §11.5 puts on sending - your economy is everyone else's
 * problem and theirs is yours.
 *
 * Flat, and per other lane, rather than the monster's own bounty: what the
 * wall kills is not a choice anyone made, so the payout should not scale with
 * what happened to wander into it.
 */
function payTheTable(ctx: SimContext, state: MatchState, killedIn: Lane): void {
  const bounty = ctx.data.economy.fortressKillBounty ?? 0;
  if (bounty <= 0) return;

  for (const team of state.teams) {
    if (team.eliminated || team.id === killedIn.teamId) continue;
    const lane = state.lanes[team.id];
    if (lane) lane.economy.gold += bounty;
  }
}

/**
 * §11.1: the defender gets the bounty for a monster its own line killed,
 * including for monsters an opponent sent at them.
 *
 * §5.5: when the lane goes fully clear the fortress regenerates, so chip damage
 * is not permanent. That lever plus the fortress weapon is the primary control
 * over when the first player is eliminated - target wave 13-15, not wave 8.
 */
function reapDead(ctx: SimContext, lane: Lane, state: MatchState, rng: Rng): void {
  let anyMonsterDied = false;
  const env = buildLaneAbilityEnv(ctx, lane, rng, state.phase === 'combat');

  // Deathrattles first, while the body is still standing and still has a
  // position to explode at. Firing after `alive = false` would be firing from
  // a corpse that target selection has already stopped being able to see.
  for (const monster of lane.monsters) {
    if (monster.alive && monster.hp <= 0) fire(env, monster, 'onDeath', {});
  }
  for (const unit of lane.units) {
    if (unit.alive && unit.hp <= 0) fire(env, unit, 'onDeath', {});
  }

  for (const monster of lane.monsters) {
    if (!monster.alive || monster.hp > 0) continue;
    monster.alive = false;
    anyMonsterDied = true;

    if (monster.killedByFortress) payTheTable(ctx, state, lane);
    else lane.economy.gold += monster.bounty;

    const clock = state.waveClocks.find((c) => c.waveNumber === monster.waveNumber);
    if (clock) clock.remaining -= 1;
  }

  for (const unit of lane.units) {
    if (!unit.alive) continue;

    // §10.1 regeneration aura, as a fraction of the unit's own maximum per
    // second. Nothing is dampened in a lane: dampening's clock is the arena's.
    const regen = auraFor(
      lane,
      unit,
      ctx.fortressPosition,
      ctx.data.fortress.auras.regenerationPerStrength ?? 1,
    ).regenPerSecond;
    unit.hp = applyHealing(unit.hp, unit.maxHp, unit.maxHp * regen);

    if (unit.hp <= 0) {
      unit.alive = false;
      // A dead body carries nothing: leaving statuses on it would have them
      // waiting on the tile when it respawns next build phase (§5.4).
      unit.statuses.length = 0;
    }
  }

  if (anyMonsterDied) {
    // Drop the corpses, then let the reserve queue refill the free slots (§8.1).
    lane.monsters = lane.monsters.filter((m) => m.alive);
    admitFromReserve(state, ctx.data, ctx.defs, lane);
  }

  if (lane.fortress.hp <= 0) lane.fortress.destroyed = true;
}

/**
 * §5.4: all defensive units respawn fully at the start of each build phase, so
 * losing your line on wave 4 is a temporary setback - the punishment is the leak
 * damage, not the loss of the investment.
 *
 * Every build phase, without exception. §3.3 used to stop respawning at wave 25
 * so its attrition endgame was fought with what survived; the Final Showdown (§3.3, replaced)
 * replaces that, and it opens with every army whole (showdown.ts).
 */
function respawnUnits(lane: Lane, energyMax: number): void {
  for (const unit of lane.units) {
    unit.alive = true;
    unit.maxHp = unit.baseMaxHp;
    unit.hp = unit.maxHp;
    // A fresh body, which is what §5.4 says respawning is: no burns carried
    // over from the wave that killed it, no cooldowns part-spent, and a FULL
    // ENERGY POOL. Every unit that can spend energy meets every wave with all
    // of it - a pool that carried over would make the first wave after a long
    // fight quietly weaker than the one after a short one, for a reason no
    // player could see. Nothing can spend it during the build phase either
    // (abilityRuntime.ts, `AbilityEnv.fighting`), so full here is full when
    // the wave lands.
    Object.assign(unit, freshAbilityState(energyMax));
    unit.targetId = null;
    unit.cooldown = 0;
    // Units advance during combat (§5.2, amended), so put the line back on the
    // tiles the player chose rather than leaving it wherever it drifted to.
    unit.pos.x = unit.homeTileX + 0.5;
    unit.pos.y = unit.homeTileY + 0.5;
    unit.engaged = false;
    unit.fieldCell = -1;
  }
}

/**
 * A new build phase opens: what was bought in the last one is no longer a
 * mistake that can be taken back at full price (§11, sell).
 *
 * Every lane, including eliminated ones - they cannot sell anyway, and a rule
 * that skips lanes is a rule with an exception to remember.
 */
function rollOverUnitSpend(state: MatchState): void {
  for (const lane of Object.values(state.lanes)) {
    for (const unit of lane.units) {
      unit.spend.earlier += unit.spend.thisPhase;
      unit.spend.thisPhase = 0;
    }
  }
}

/** Put a wave into every living lane. All lanes face identical waves (§9.2). */
function spawnWave(ctx: SimContext, state: MatchState): void {
  const specs = generateWave(ctx.data, state.seed, state.wave);
  if (specs.length === 0) return;

  const cap = ctx.data.waves.maxConcurrentMonsters;
  let totalSpawned = 0;

  for (const team of state.teams) {
    if (team.eliminated) continue;
    const lane = state.lanes[team.id];
    if (!lane) continue;

    // §11.5: monsters an opponent sent at this lane join its next wave. The
    // defender still collects their bounty - priced against the gems the
    // SENDER spent (`sendBounty`), and paid on top of the wave's own fixed
    // pool, so being sent at is gold now in exchange for their income later.
    const incoming = lane.incomingSends.map((s) => ({
      defId: s.defId,
      waveNumber: state.wave,
      sendId: s.sendId,
      bounty: sendBounty(ctx.data, s.sendId, state.wave),
    }));
    lane.incomingSends.length = 0;
    // The "you are being attacked by X" notice belongs to the wave that is
    // coming, so it clears when that wave actually lands.
    lane.sendLog.length = 0;

    // Everyone who fits under the cap spawns together, as one packed clump at
    // the centre of the spawn zone; the rest wait in reserve (§8.1).
    const arriving: SpawnSpec[] = [];
    for (const spec of [...specs, ...incoming]) {
      if (arriving.length + countLiving(lane) < cap) {
        arriving.push(spec);
      } else {
        lane.reserve.push(spec);
      }
      totalSpawned++;
    }

    const radii = arriving.map((spec) => {
      const def = ctx.defs.monsters.get(spec.defId);
      return def ? resolveMonsterStats(ctx.data, def, spec.waveNumber).radius : 0.3;
    });
    const positions = placeWave(ctx.data, radii);
    arriving.forEach((spec, i) => {
      const monster = createMonster(state, ctx.data, ctx.defs, spec, positions[i]!);
      if (monster) lane.monsters.push(monster);
    });
  }

  if (totalSpawned > 0) {
    state.waveClocks.push({
      waveNumber: state.wave,
      age: 0,
      // One clock per wave across all lanes: it stops when the last monster of
      // this wave dies anywhere (§8).
      remaining: totalSpawned,
    });
  }
}

/**
 * §3.1, amended: build phase, then combat.
 *
 * DESIGN CHANGE to §3.2. The original had waves spawning on a fixed global
 * clock so that one slow player could not hold three others hostage. That also
 * meant a second wave could land on top of an unfinished one and wreck the
 * build cycle, so the clock is gone: the ONLY global timers left are the 30s
 * build phase and the enrage clock (§8).
 *
 * Combat now runs until every living lane is empty. The hostage problem is
 * handled at the other end instead - enrage keeps climbing on a lane that
 * cannot clear (§8), and when that lane's fortress falls its monsters are wiped
 * from the board and it stops receiving waves, so it cannot stall the match
 * indefinitely.
 */
function allLanesClear(state: MatchState): boolean {
  const living = state.teams.filter((t) => !t.eliminated);
  if (living.length === 0) return true;

  return living.every((team) => {
    const lane = state.lanes[team.id];
    if (!lane) return true;
    return lane.reserve.length === 0 && countLiving(lane) === 0;
  });
}

function advancePhase(ctx: SimContext, state: MatchState): void {
  // The showdown runs on its own clock (showdown.ts) and never goes back.
  if (state.phase === 'showdown') return;

  if (state.phase === 'build') {
    if (state.phaseTicksLeft > 0) {
      state.phaseTicksLeft -= 1;
      return;
    }

    state.phase = 'combat';
    state.wave += 1;
    // Combat has no clock of its own. It ends when the lanes are empty.
    state.phaseTicksLeft = 0;
    spawnWave(ctx, state);

    // §15.3: recompute on wave start, not per tick.
    for (const team of state.teams) {
      if (team.eliminated) continue;
      const lane = state.lanes[team.id];
      if (!lane) continue;
      recomputeUnitBuffs(ctx.data, ctx.defs, lane);
      // The round's scoreboard starts here rather than when the build phase
      // opened, which is what leaves the last wave's numbers up to be read
      // for the whole of that build phase (§14.1, added).
      for (const unit of lane.units) unit.damageDealt = 0;
    }
    return;
  }

  if (!allLanesClear(state)) return;

  // §3.3, replaced: the last wave was the last wave. What follows is not another build
  // phase but the Final Showdown.
  if (state.wave >= ctx.data.waves.showdown.afterWave) {
    beginShowdown(ctx, state);
    return;
  }

  state.phase = 'build';
  state.phaseTicksLeft = secondsToTicks(ctx.data.waves.buildPhaseSeconds);
  rollOverUnitSpend(state);

  for (const team of state.teams) {
    if (team.eliminated) continue;
    const lane = state.lanes[team.id];
    if (!lane) continue;

    respawnUnits(lane, stat(ctx.data.abilities.energy.max));
    // §11.6: passive income is paid each wave and compounds over the match.
    // Gems are not: the resource building pays them out on its own clock
    // (§10.2, amended) - see `produceGems`.
    lane.economy.gold += lane.economy.passiveIncome;
  }
}

/**
 * Clear a dead player's lane.
 *
 * Their monsters would otherwise sit there forever: nothing kills them, and
 * since combat now ends only when every lane is empty (§3.2, amended), they
 * would stall the match for everyone still playing. Wave clocks are decremented
 * for each one removed, or the wave never ends and enrage keeps climbing (§8).
 */
function wipeLane(state: MatchState, lane: Lane): void {
  for (const monster of lane.monsters) {
    if (!monster.alive) continue;
    const clock = state.waveClocks.find((c) => c.waveNumber === monster.waveNumber);
    if (clock) clock.remaining -= 1;
    monster.alive = false;
  }
  for (const spec of lane.reserve) {
    const clock = state.waveClocks.find((c) => c.waveNumber === spec.waveNumber);
    if (clock) clock.remaining -= 1;
  }

  lane.monsters.length = 0;
  // Nothing is swinging in a wiped lane, so nothing should still be drawn
  // swinging in it either.
  lane.attacks.length = 0;
  lane.reserve.length = 0;
  lane.incomingSends.length = 0;
}

/** §13: fortress HP at zero eliminates that team; placement locks in there. */
function checkEliminations(state: MatchState): void {
  // There are no fortresses in the arena and no lanes left to wipe: an army
  // with nothing standing is what being out means there (showdown.ts).
  if (state.phase === 'showdown') {
    showdownEliminations(state);
    return;
  }

  for (const team of state.teams) {
    if (team.eliminated) continue;
    const lane = state.lanes[team.id];
    if (!lane || !lane.fortress.destroyed) continue;

    team.eliminated = true;
    wipeLane(state, lane);
    // Count up from the bottom: the first out places last. Counting survivors
    // would give two teams eliminated on the same tick the same placement.
    state.eliminatedCount += 1;
    team.placement = state.teams.length - state.eliminatedCount + 1;
  }

  const living = state.teams.filter((t) => !t.eliminated).length;
  // §13: the match ends when one team remains. A solo lane - the M1 harness, or
  // a practice run - has no opponent to outlast, so it ends only when its own
  // fortress falls, not instantly.
  state.finished = state.teams.length > 1 ? living <= 1 : living === 0;
}

// ----------------------------------------------------------------------- step

/** Advance the match one tick. Returns the same (mutated) state object. */
export function step(
  ctx: SimContext,
  state: MatchState,
  commands: readonly Command[] = [],
): MatchState {
  if (state.finished) return state;

  applyCommands(ctx, state, commands);

  state.tick += 1;
  advanceWaveClocks(state);
  advanceVision(state);
  advancePhase(ctx, state);

  // One generator for the whole tick, restored from the state and written back
  // to it, so every roll an ability makes - a critical, an evade, a 35% proc -
  // is part of the match's own deterministic stream (§9.2, §15.1). A second
  // generator, or `Math.random`, would make replays and desync detection lies.
  const rng = new Rng(state.rngState);

  if (state.phase === 'showdown') {
    // No lanes, no fortresses, no economy: one arena and whoever is left in it.
    showdownTick(ctx, state, rng);
  } else {
    for (const team of state.teams) {
      if (team.eliminated) continue;
      const lane = state.lanes[team.id];
      if (!lane) continue;

      laneTick(ctx, lane, state, rng);
      fortressActs(ctx, lane);
      produceGems(lane);
      regenerateFortress(lane);
      reapDead(ctx, lane, state, rng);
    }
  }

  state.rngState = rng.state;
  checkEliminations(state);
  return state;
}

/**
 * §10.2, amended: the resource building hands over gems on its own clock.
 *
 * Every tick, in both phases, for as long as the lane is alive. Gems that
 * arrive while you play are a different thing from gems that arrive in a lump
 * at the end of a wave: the second is a wave's reward, and the first is a
 * reason to have built the building early, which is what an economy upgrade is
 * supposed to be.
 *
 * An integer countdown rather than a fraction accumulated per tick. The two
 * agree on the long run and disagree about exactly which tick a payout lands
 * on; the countdown cannot drift, and there is nothing to argue about between
 * two clients running the same match.
 */
/**
 * §5.5, amended: the fortress heals on a clock, not in a lump when the lane
 * goes clear.
 *
 * Every tick, in both phases, for as long as it stands. Healing only on a
 * clear made chip damage permanent for anyone who never quite cleared, and
 * made the reward for clearing a wave arrive as a number that jumped. A
 * trickle is legible while you watch it: a wall losing HP faster than this is
 * one that is actually in trouble.
 */
function regenerateFortress(lane: Lane): void {
  const fortress = lane.fortress;
  if (fortress.destroyed) return;
  // `applyHealing` is where the rules live, including the one that matters
  // here: a wall that has reached zero is down, whatever the tick order says,
  // and must not be healed back out of its own elimination (dampening.ts).
  fortress.hp = applyHealing(fortress.hp, fortress.maxHp, fortress.regenPerSecond);
}

function produceGems(lane: Lane): void {
  const fortress = lane.fortress;
  if (fortress.gemPayoutTicks <= 0) return;

  fortress.gemCooldown -= 1;
  if (fortress.gemCooldown > 0) return;

  lane.economy.gems += fortress.gemsPerPayout;
  fortress.gemCooldown = fortress.gemPayoutTicks;
}

/** Deep copy, for replays, desync comparison and tests. */
export function snapshot(state: MatchState): MatchState {
  return structuredClone(state);
}
