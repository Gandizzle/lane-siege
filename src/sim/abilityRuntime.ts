/**
 * Abilities, running. DESIGN.md §7, §18, extended.
 *
 * `src/data/abilities.ts` says what an ability IS - a trigger, a target, some
 * effects and a price. This is the machine that reads one and does it, and it
 * is deliberately the only place that knows how: every ability in the game goes
 * through `fire`, so a new one is a JSON entry and a new KIND of one is a case
 * in `applyEffect`.
 *
 * THE FOUR QUESTIONS, IN ORDER
 *
 *   1. May it fire?   Not silenced, off cooldown, energy paid, chance rolled.
 *   2. Who is hit?    `selectTargets` turns a target clause into bodies.
 *   3. What happens?  `applyEffect`, once per body, scaled by falloff.
 *   4. What is left?  Anything with a duration becomes a `Status` (status.ts).
 *
 * WHAT A PASSIVE IS
 *
 * There is no such thing as a permanent buff here. A `passive` ability is fired
 * every tick and applies statuses lasting `PASSIVE_TICKS`, so an aura is simply
 * a status that keeps being renewed - and walking out of one lets it lapse a
 * tick later with no bookkeeping at all. The alternative, adding and removing
 * auras as bodies move, is the bug farm this exists to avoid: units advance
 * now (§5.2, amended), so aura membership changes constantly.
 *
 * SPELL IMMUNITY IS A FILTER, NOT A CHECK
 *
 * A body immune to abilities is removed during target selection rather than
 * tested inside each effect. That makes the rule total - no effect can reach
 * it, including damage, which is what §18's "negate any ability effects" asks
 * for - and it makes a Revenant a genuine answer to an ability-heavy line
 * rather than a monster that shrugs off some of it.
 *
 * PURITY (§15.1): every roll comes from the match's generator, every duration
 * is converted to ticks here, and nothing reads a wall clock. Two clients
 * firing the same ability on the same tick get the same result.
 */

import type {
  AbilityRef,
  ArmourType,
  ControlKind,
  DamageMatrix,
  DamageType,
  GameData,
  ResolvedAbility,
  ResolvedEffect,
  ResolvedTarget,
  StatKey,
} from '../data/schema.ts';
import { refId, refRank, resolveAbility } from '../data/schema.ts';
import { TICKS_PER_SECOND } from './constants.ts';
import { crowdControlMultiplier, healBy, healingMultiplier } from './dampening.ts';
import { dealDamage, type Strike, type StrikeEnv } from './strike.ts';
import {
  applyStatus,
  canAct,
  controlScale,
  hasTag,
  immuneToAbilities,
  immuneToControl,
  modifiersOf,
  noteControl,
  regenerateEnergy,
  regenRate,
  tickStatuses,
  type Afflicted,
  type Status,
} from './status.ts';
import { bodyDistanceSquared, distanceSquared, type Combatant } from './targeting.ts';
import type { Rng } from './rng.ts';
import type { EntityId, Vec2 } from './types.ts';

/** How long a passive's status lives before its source has to renew it. */
export const PASSIVE_TICKS = 2;

/** What the runtime needs of a body. `DefensiveUnit` and `Monster` both fit. */
export interface AbilityBody extends Afflicted, Combatant {
  defId: string;
  armour: ArmourType;
  damageType: DamageType;
  pos: Vec2;
  alive: boolean;
  monster: boolean;
  targetId: EntityId | null;
  /** Units carry this for §14.1's rows; monsters do not. */
  damageDealt?: number;
}

export interface AbilityIndex {
  /** Resolved abilities by definition id, for units and monsters alike. */
  byDef: Map<string, ResolvedAbility[]>;
  /** Resolved abilities a send grants to everything it delivers (§11.5). */
  bySend: Map<string, ResolvedAbility[]>;
  /** Every ability, by id at rank 1, for panels and tests. */
  byId: Map<string, ResolvedAbility>;
}

const NONE: ResolvedAbility[] = [];

/**
 * Resolve every reference in the data once, when the match's definition index
 * is built. §15.3: a tick may not resolve, look up or recompute anything an
 * event could have computed for it.
 */
export function buildAbilityIndex(data: GameData): AbilityIndex {
  const defs = new Map(data.abilities.abilities.map((a) => [a.id, a]));
  const byDef = new Map<string, ResolvedAbility[]>();
  const bySend = new Map<string, ResolvedAbility[]>();
  const byId = new Map<string, ResolvedAbility>();

  for (const [id, def] of defs) byId.set(id, resolveAbility(def, 1));

  const resolve = (refs: AbilityRef[] | undefined): ResolvedAbility[] => {
    const out: ResolvedAbility[] = [];
    for (const ref of refs ?? []) {
      const def = defs.get(refId(ref));
      if (def) out.push(resolveAbility(def, refRank(ref)));
    }
    return out;
  };

  for (const unit of data.units.units) {
    const resolved = resolve(unit.abilities);
    if (resolved.length > 0) byDef.set(unit.id, resolved);
  }
  for (const monster of [...data.monsters.monsters, ...data.monsters.bosses]) {
    const resolved = resolve(monster.abilities);
    if (resolved.length > 0) byDef.set(monster.id, resolved);
  }
  for (const send of data.sends.sends) {
    const resolved = resolve(send.abilities);
    if (resolved.length > 0) bySend.set(send.id, resolved);
  }
  return { byDef, bySend, byId };
}

export function abilitiesFor(index: AbilityIndex, defId: string): ResolvedAbility[] {
  return index.byDef.get(defId) ?? NONE;
}

/**
 * The cheapest energy an ability of this definition spends, or 0 for a body
 * with nothing to spend it on.
 *
 * "Cheapest" because the question it answers is when the body can next do
 * SOMETHING - and it is the threshold the panel's energy bar marks. Every body
 * fills the same pool at the same rate (abilities.json), so a pool on a body
 * that will never spend it is a bar that only ever reads full, which is why
 * the panel shows one only where this is non-zero.
 */
export function energyCostOf(index: AbilityIndex, defId: string): number {
  let cheapest = 0;
  for (const ability of abilitiesFor(index, defId)) {
    if (ability.energyCost <= 0) continue;
    if (cheapest === 0 || ability.energyCost < cheapest) cheapest = ability.energyCost;
  }
  return cheapest;
}

/**
 * Everything the runtime needs that it cannot work out for itself.
 *
 * `sides` is the interesting one. In a lane a unit's allies are the lane's
 * units and its enemies are its monsters; in the arena an army's allies are its
 * own and its enemies are the other three (§3.3, replaced). The runtime does
 * not need to know which of those it is in, so it does not.
 */
export interface AbilityEnv {
  data: GameData;
  index: AbilityIndex;
  matrix: DamageMatrix;
  strike: StrikeEnv;
  /** Dampening (§3.3, replaced): 1 outside the showdown. */
  healing: number;
  control: number;
  sides: (body: AbilityBody) => { allies: readonly AbilityBody[]; enemies: readonly AbilityBody[] };
  /** What this body's own swing is worth, after tech and auras. */
  attackDamage: (body: AbilityBody) => number;
  /** For crediting damage over time to whoever applied it. */
  bodyById: (id: EntityId) => AbilityBody | null;
  /** Abilities granted by the send that delivered this body, if any (§11.5). */
  granted?: (body: AbilityBody) => ResolvedAbility[];
}

/** What fired the trigger, for the triggers that have something to point at. */
export interface TriggerContext {
  /** `onAttack`: what was hit. `interval` on `attackTarget`: current target. */
  target?: AbilityBody | null;
  /** `onHurt`: who hit us. */
  attacker?: AbilityBody | null;
}

const ticks = (seconds: number): number => Math.max(1, Math.round(seconds * TICKS_PER_SECOND));

// ------------------------------------------------------------------- firing

/** Every ability this body has, its definition's plus its send's. */
function allAbilities(env: AbilityEnv, body: AbilityBody): ResolvedAbility[] {
  const own = abilitiesFor(env.index, body.defId);
  const granted = env.granted?.(body) ?? NONE;
  if (granted.length === 0) return own;
  if (own.length === 0) return granted;
  return [...own, ...granted];
}

/**
 * Fire every ability on `source` whose trigger is `when`.
 *
 * Called from the tick at each of the moments a trigger names. A body with no
 * abilities returns immediately, which is the common case and costs one map
 * lookup.
 */
export function fire(
  env: AbilityEnv,
  source: AbilityBody,
  when: ResolvedAbility['trigger']['when'],
  context: TriggerContext = {},
): void {
  if (!source.alive) return;
  const abilities = allAbilities(env, source);
  if (abilities.length === 0) return;

  for (const ability of abilities) {
    if (ability.trigger.when !== when) continue;
    cast(env, source, ability, context);
  }
}

/**
 * The per-tick half: statuses expire, burns burn, energy fills, and the
 * abilities that fire on their own initiative do.
 *
 * Ordered so that a body cannot be killed by a burn and then act in the same
 * tick, and so that a passive refreshed this tick is in force for the fighting
 * that follows it.
 */
export function tickBody(env: AbilityEnv, body: AbilityBody): void {
  // Its first tick is its arrival, whichever of the five ways onto the field it
  // came by (types.ts, `spawnFired`). Before anything else, so a battlecry is
  // in force for the tick it arrived on.
  if (!body.spawnFired) {
    body.spawnFired = true;
    fire(env, body, 'onSpawn', {});
  }

  tickStatuses(body);
  if (!body.alive) return;

  applyMaxHealth(body);

  applyDamageOverTime(env, body);
  if (body.hp <= 0) return;

  const rate = regenRate(body);
  if (rate > 0) {
    body.hp = healBy(
      body.hp,
      body.maxHp,
      rate / TICKS_PER_SECOND,
      env.healing * healingTaken(body),
    );
  }

  const energy = env.data.abilities.energy;
  regenerateEnergy(body, energy.regenPerSecond ?? 0, energy.max ?? 0);

  const abilities = allAbilities(env, body);
  if (abilities.length === 0) return;

  for (const ability of abilities) {
    switch (ability.trigger.when) {
      case 'passive':
        cast(env, body, ability, {});
        break;
      case 'interval':
        cast(env, body, ability, { target: currentTarget(env, body) });
        break;
      case 'healthBelow':
      case 'healthAbove':
        castThreshold(env, body, ability);
        break;
      default:
        break;
    }
  }
}

/**
 * Re-derive `maxHp` from the base and whatever is modifying the ceiling.
 *
 * Raising a maximum must not heal and lowering it must not wound, so the
 * CURRENT HP moves with the ceiling: a body given +200 max HP gains 200 HP, and
 * losing the buff takes both away again. The alternative - keeping the fraction
 * - heals a body for buffing it, which turns a max-health aura into a heal
 * that also happens to be a buff.
 */
function applyMaxHealth(body: AbilityBody): void {
  const m = modifiersOf(body);
  const wanted = body.baseMaxHp * m.maxHealthMul + m.maxHealthAdd;
  if (wanted === body.maxHp) return;
  const delta = wanted - body.maxHp;
  body.maxHp = wanted;
  body.hp = Math.max(1, Math.min(wanted, body.hp + delta));
}

/** What this body is currently fighting, for an interval ability that needs one. */
function currentTarget(env: AbilityEnv, body: AbilityBody): AbilityBody | null {
  if (body.targetId === null) return null;
  const found = env.bodyById(body.targetId);
  return found && found.alive ? found : null;
}

function healingTaken(body: Afflicted): number {
  return modifiersOf(body).healingTakenMul;
}

/** A threshold trigger fires on the crossing, and rearms on the way back. */
function castThreshold(env: AbilityEnv, body: AbilityBody, ability: ResolvedAbility): void {
  const fraction = body.maxHp > 0 ? body.hp / body.maxHp : 1;
  const below = ability.trigger.when === 'healthBelow';
  const crossed = below ? fraction < ability.trigger.fraction : fraction > ability.trigger.fraction;
  const index = body.latched.indexOf(ability.id);

  if (!crossed) {
    if (index >= 0) body.latched.splice(index, 1);
    return;
  }
  if (index >= 0) return;
  if (cast(env, body, ability, {})) body.latched.push(ability.id);
}

/**
 * One firing: the gates, then the targets, then the effects.
 *
 * Returns whether it fired, which is what the threshold latch keys off - an
 * ability that could not pay for itself has not fired and must be allowed to
 * try again.
 */
function cast(
  env: AbilityEnv,
  source: AbilityBody,
  ability: ResolvedAbility,
  context: TriggerContext,
): boolean {
  // A passive is a property of the body, not an action it takes, so silence
  // does not switch one off. Everything else is an action.
  if (ability.trigger.when !== 'passive' && !canAct(source)) return false;

  const clock = source.clocks[ability.id] ?? 0;
  if (clock > 0) return false;

  if (ability.trigger.chance < 1 && env.strike.rng.next() >= ability.trigger.chance) return false;
  if (ability.energyCost > 0 && source.energy < ability.energyCost) return false;

  const targets = selectTargets(env, source, ability.target, context);
  if (targets.length === 0) return false;

  if (ability.energyCost > 0) source.energy -= ability.energyCost;
  if (ability.healthCost > 0) source.hp -= source.hp * ability.healthCost;

  const wait = ability.cooldownSeconds > 0 ? ability.cooldownSeconds : ability.trigger.everySeconds;
  if (wait > 0) source.clocks[ability.id] = ticks(wait);

  // One level deeper for everything the effects set off, so a nested firing
  // gets its own target list and this one's survives being iterated.
  depth += 1;
  try {
    for (const [index, effect] of ability.effects.entries()) {
      for (const hit of targets) {
        applyEffect(env, source, hit.body, ability, effect, index, hit.scale);
      }
    }
  } finally {
    depth -= 1;
  }
  return true;
}

// ------------------------------------------------------------------ targeting

interface Hit {
  body: AbilityBody;
  /** What fraction of the effect this body takes, after falloff. */
  scale: number;
}

/**
 * Target lists, one per level of nesting rather than one shared array.
 *
 * Firing is RE-ENTRANT: an ability's damage can land, that can fire the
 * target's `onHurt`, and that can select targets of its own - all inside the
 * loop that is still walking the first ability's list. A single scratch array
 * would be overwritten underneath that loop. A pool indexed by depth keeps
 * §15.3's no-allocation rule (the arrays are reused for the whole match) and is
 * still correct at any depth, which is what this codebase means by cheap.
 */
const hitPool: Hit[][] = [[]];
let depth = 0;

function scratch(): Hit[] {
  while (hitPool.length <= depth) hitPool.push([]);
  const list = hitPool[depth]!;
  list.length = 0;
  return list;
}

/** Can this body be reached by an ability at all? */
function reachable(body: AbilityBody, clause: ResolvedTarget): boolean {
  if (!body.alive || body.hp <= 0) return false;
  if (immuneToAbilities(body)) return false;
  if (clause.requiresTag !== null && !hasTag(body, clause.requiresTag)) return false;
  return true;
}

/**
 * Turn a target clause into bodies, nearest first where order matters.
 *
 * Built into a scratch array: this runs on every hit of every unit with an
 * `onAttack` ability, which at §15.3's load is thousands of calls a second.
 */
function selectTargets(
  env: AbilityEnv,
  source: AbilityBody,
  clause: ResolvedTarget,
  context: TriggerContext,
): Hit[] {
  const hits = scratch();
  const { allies, enemies } = env.sides(source);

  switch (clause.what) {
    case 'self':
      if (reachable(source, clause)) hits.push({ body: source, scale: 1 });
      break;

    case 'attackTarget': {
      const t = context.target ?? currentTarget(env, source);
      if (t && reachable(t, clause)) hits.push({ body: t, scale: 1 });
      break;
    }

    case 'attacker': {
      const a = context.attacker;
      if (a && reachable(a, clause)) hits.push({ body: a, scale: 1 });
      break;
    }

    case 'enemiesInRadius':
      // Around what was hit when there is one - splash lands on the target,
      // not on the shooter - and around the source otherwise.
      collectInRadius(hits, context.target ?? source, enemies, clause, source.id);
      break;

    case 'alliesInRadius':
      collectInRadius(hits, source, allies, clause, clause.includeSelf ? -1 : source.id);
      break;

    case 'nearestAllies':
      collectInRadius(hits, source, allies, clause, clause.includeSelf ? -1 : source.id);
      hits.sort(
        (a, b) => distanceSquared(a.body.pos, source.pos) - distanceSquared(b.body.pos, source.pos),
      );
      trim(hits, clause);
      break;

    case 'lowestHealthAlly': {
      let worst: AbilityBody | null = null;
      let worstFraction = Infinity;
      for (const ally of allies) {
        if (ally.id === source.id && !clause.includeSelf) continue;
        if (!reachable(ally, clause)) continue;
        if (!withinRadius(source, ally, clause.radius)) continue;
        const fraction = ally.maxHp > 0 ? ally.hp / ally.maxHp : 1;
        if (fraction < worstFraction) {
          worstFraction = fraction;
          worst = ally;
        }
      }
      if (worst) hits.push({ body: worst, scale: 1 });
      break;
    }

    case 'randomEnemy': {
      collectInRadius(hits, source, enemies, { ...clause, max: Infinity }, source.id);
      if (hits.length > 0) {
        const pick = hits[env.strike.rng.int(hits.length)]!;
        hits.length = 0;
        hits.push(pick);
      }
      break;
    }

    case 'chain': {
      // From what was hit, to the next nearest, to the next: each jump pays
      // `falloff`, so a long chain is worth less at the end than the start.
      const first = context.target ?? null;
      if (!first) break;
      let from = first;
      let scale = 1;
      const taken = new Set<EntityId>([first.id]);
      for (let jump = 0; jump < clause.jumps; jump++) {
        let next: AbilityBody | null = null;
        let best = Infinity;
        for (const enemy of enemies) {
          if (taken.has(enemy.id) || !reachable(enemy, clause)) continue;
          const d = bodyDistanceSquared(from, enemy);
          if (d < best && withinRadius(from, enemy, clause.radius)) {
            best = d;
            next = enemy;
          }
        }
        if (!next) break;
        scale *= clause.falloff;
        hits.push({ body: next, scale });
        taken.add(next.id);
        from = next;
      }
      break;
    }

    case 'enemiesInLine': {
      const aim = context.target ?? null;
      if (!aim) break;
      collectInLine(hits, source, aim.pos, enemies, clause);
      break;
    }

    case 'enemiesInCone': {
      const aim = context.target ?? currentTarget(env, source);
      if (!aim) break;
      collectInCone(hits, source, aim.pos, enemies, clause);
      break;
    }

    // Vocabulary: no effect kind that uses these is live, so no selector is.
    case 'deadAllyNearby':
    case 'bondedAlly':
      break;
  }

  return hits;
}

function withinRadius(from: Combatant, other: Combatant, radius: number): boolean {
  const reach = radius + other.radius;
  return bodyDistanceSquared(from, other) <= reach * reach;
}

/** Everything of `pool` inside the clause's radius of `centre`, nearest first. */
function collectInRadius(
  hits: Hit[],
  centre: AbilityBody,
  pool: readonly AbilityBody[],
  clause: ResolvedTarget,
  skipId: EntityId,
): void {
  for (const body of pool) {
    if (body.id === skipId) continue;
    if (!reachable(body, clause)) continue;
    if (!withinRadius(centre, body, clause.radius)) continue;
    hits.push({ body, scale: 1 });
  }
  if (hits.length > 1) {
    hits.sort((a, b) => bodyDistanceSquared(centre, a.body) - bodyDistanceSquared(centre, b.body));
  }
  applyFalloff(hits, clause);
  trim(hits, clause);
}

/**
 * A rectangle `width` across, running `length` from the source through the aim
 * point. What an artillery line looks like: it lands along the shell's path.
 */
function collectInLine(
  hits: Hit[],
  source: AbilityBody,
  aim: Vec2,
  pool: readonly AbilityBody[],
  clause: ResolvedTarget,
): void {
  const dx = aim.x - source.pos.x;
  const dy = aim.y - source.pos.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return;
  const ux = dx / length;
  const uy = dy / length;
  const half = clause.width / 2;

  for (const body of pool) {
    if (!reachable(body, clause)) continue;
    const rx = body.pos.x - source.pos.x;
    const ry = body.pos.y - source.pos.y;
    const along = rx * ux + ry * uy;
    if (along < 0 || along > clause.length) continue;
    const across = Math.abs(rx * uy - ry * ux);
    if (across > half + body.radius) continue;
    hits.push({ body, scale: 1 });
  }
  if (hits.length > 1) {
    hits.sort(
      (a, b) => distanceSquared(source.pos, a.body.pos) - distanceSquared(source.pos, b.body.pos),
    );
  }
  applyFalloff(hits, clause);
  trim(hits, clause);
}

/** An arc `degrees` wide and `length` deep, pointed at the aim point. */
function collectInCone(
  hits: Hit[],
  source: AbilityBody,
  aim: Vec2,
  pool: readonly AbilityBody[],
  clause: ResolvedTarget,
): void {
  const dx = aim.x - source.pos.x;
  const dy = aim.y - source.pos.y;
  const facing = Math.atan2(dy, dx);
  const halfAngle = (clause.degrees * Math.PI) / 360;

  for (const body of pool) {
    if (!reachable(body, clause)) continue;
    const rx = body.pos.x - source.pos.x;
    const ry = body.pos.y - source.pos.y;
    const distance = Math.hypot(rx, ry);
    if (distance > clause.length + body.radius) continue;
    if (distance > 1e-6) {
      let delta = Math.atan2(ry, rx) - facing;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      // A wide body at the edge of the arc is inside it: the angle it subtends
      // grows as it gets closer, which is what stops a cone from missing
      // something it is standing on.
      if (Math.abs(delta) > halfAngle + Math.asin(Math.min(1, body.radius / distance))) continue;
    }
    hits.push({ body, scale: 1 });
  }
  if (hits.length > 1) {
    hits.sort(
      (a, b) => distanceSquared(source.pos, a.body.pos) - distanceSquared(source.pos, b.body.pos),
    );
  }
  applyFalloff(hits, clause);
  trim(hits, clause);
}

/** The nth body found takes `falloff^n` of the effect. */
function applyFalloff(hits: Hit[], clause: ResolvedTarget): void {
  if (clause.falloff >= 1) return;
  let scale = 1;
  for (const hit of hits) {
    hit.scale = scale;
    scale *= clause.falloff;
  }
}

function trim(hits: Hit[], clause: ResolvedTarget): void {
  if (hits.length > clause.max) hits.length = clause.max;
}

// -------------------------------------------------------------------- effects

function strikeFrom(
  env: AbilityEnv,
  source: AbilityBody,
  target: AbilityBody,
  effect: ResolvedEffect,
  scale: number,
): Strike | null {
  const missing = Math.max(0, target.maxHp - target.hp);
  let amount =
    effect.flat +
    effect.ofMaxHealth * target.maxHp +
    effect.ofCurrentHealth * target.hp +
    effect.ofMissingHealth * missing +
    effect.ofAttack * env.attackDamage(source);

  if (effect.bonusIfTag && hasTag(target, effect.bonusIfTag.tag)) {
    amount *= effect.bonusIfTag.multiplier;
  }
  amount *= scale;
  if (amount <= 0) return null;

  return {
    amount,
    damageType: effect.damageType ?? source.damageType,
    bypassArmour: effect.bypassArmour,
    // An ability's damage is a consequence of a hit that already happened, so
    // it cannot itself be dodged, warded or critical. See strike.ts.
    isAttack: false,
    noFeedback: true,
  };
}

function statusFrom(
  source: AbilityBody,
  ability: ResolvedAbility,
  effect: ResolvedEffect,
  slot: number,
  kind: Status['kind'],
  durationTicks: number,
  scale: number,
): Status {
  return {
    abilityId: ability.id,
    slot,
    kind,
    stat: effect.stat as StatKey | null,
    mode: effect.mode,
    amount: effect.amount * scale,
    perSecond: effect.perSecond * scale,
    ofMaxHealth: effect.ofMaxHealth * scale,
    damageType: effect.damageType,
    blocks: effect.blocks,
    control: effect.control as ControlKind | null,
    immuneTo: effect.immuneTo,
    tag: effect.appliesTag,
    ticksLeft: durationTicks,
    sourceId: source.id,
    sourceDefId: source.defId,
  };
}

/**
 * One effect, on one body.
 *
 * `slot` is the effect's index within its ability, so an ability with two
 * statuses keeps them apart and each stacks by its own rule.
 */
function applyEffect(
  env: AbilityEnv,
  source: AbilityBody,
  target: AbilityBody,
  ability: ResolvedAbility,
  effect: ResolvedEffect,
  slot: number,
  scale: number,
): void {
  // A passive renews itself every tick; everything else lasts what it says.
  const duration =
    ability.trigger.when === 'passive' && effect.durationSeconds <= 0
      ? PASSIVE_TICKS
      : effect.durationSeconds > 0
        ? ticks(effect.durationSeconds)
        : PASSIVE_TICKS;

  switch (effect.kind) {
    case 'damage': {
      const strike = strikeFrom(env, source, target, effect, scale);
      if (strike) dealDamage(env.strike, source, target, strike);
      break;
    }

    case 'execute': {
      if (target.maxHp <= 0) break;
      if (target.hp / target.maxHp > effect.belowFraction) break;
      // Straight to zero, bypassing everything: an execute that the matrix
      // could reduce is not an execute.
      const landed = target.hp;
      target.hp = 0;
      if (source.damageDealt !== undefined) source.damageDealt += landed;
      break;
    }

    case 'heal': {
      const amount = (effect.flat + effect.ofMaxHealth * target.maxHp) * scale;
      target.hp = healBy(
        target.hp,
        target.maxHp,
        amount,
        env.healing * modifiersOf(target).healingTakenMul,
      );
      break;
    }

    case 'energy': {
      const max = env.data.abilities.energy.max ?? 0;
      target.energy = Math.max(0, Math.min(max, target.energy + effect.energy * scale));
      break;
    }

    case 'modify':
      if (effect.stat === null) break;
      applyStatus(
        target,
        statusFrom(source, ability, effect, slot, 'modify', duration, scale),
        effect.stacks,
      );
      break;

    case 'damageOverTime':
      applyStatus(
        target,
        statusFrom(source, ability, effect, slot, 'damageOverTime', duration, scale),
        effect.stacks,
      );
      break;

    case 'regen':
      applyStatus(
        target,
        statusFrom(source, ability, effect, slot, 'regen', duration, scale),
        effect.stacks,
      );
      break;

    case 'shield':
      applyStatus(
        target,
        statusFrom(source, ability, effect, slot, 'shield', duration, scale),
        effect.stacks,
      );
      break;

    case 'immunity':
      applyStatus(
        target,
        statusFrom(source, ability, effect, slot, 'immunity', duration, scale),
        effect.stacks,
      );
      break;

    case 'control': {
      if (immuneToControl(target)) break;
      const config = env.data.abilities.control;
      const fraction = controlScale(target, config.scale);
      if (fraction <= 0) break;
      // Dampening multiplies the duration at the moment it is applied, never
      // afterwards, so an effect already running is not retroactively cut
      // short (dampening.ts).
      const held = ticks(effect.durationSeconds * fraction * env.control);
      applyStatus(
        target,
        statusFrom(source, ability, effect, slot, 'control', held, scale),
        effect.stacks,
      );
      noteControl(
        target,
        config.scale,
        ticks(config.windowSeconds ?? 0),
        ticks(config.immuneSeconds ?? 0),
      );
      break;
    }

    // Vocabulary. `validate.ts` refuses to let a unit, monster or send
    // reference an ability using one of these, so reaching this line means the
    // live set in abilities.ts grew without a case being added here.
    case 'summon':
    case 'resurrect':
    case 'knockback':
    case 'pull':
    case 'teleport':
    case 'transform':
    case 'consume':
    case 'spiritLink':
    case 'amplify':
    case 'pathBlock':
    case 'costReduction':
    case 'bond':
      break;
  }
}

/** One tick of every burn on this body, credited to whoever lit it. */
function applyDamageOverTime(env: AbilityEnv, body: AbilityBody): void {
  if (body.statuses.length === 0) return;
  for (const status of body.statuses) {
    if (status.kind !== 'damageOverTime') continue;
    const perSecond = status.perSecond + status.ofMaxHealth * body.maxHp;
    if (perSecond <= 0) continue;
    const source = env.bodyById(status.sourceId);
    dealDamage(env.strike, source, body, {
      amount: perSecond / TICKS_PER_SECOND,
      damageType: status.damageType ?? body.damageType,
      isAttack: false,
      noFeedback: true,
    });
    if (body.hp <= 0) return;
  }
}

// ---------------------------------------------------------------- environments

/**
 * The environment for one lane: a defender's allies are the lane's units and
 * its enemies are its monsters, and the other way round for a monster.
 *
 * Built per lane per tick. That is deliberate - it is six closures over two
 * arrays and nothing is copied - and it is what keeps the runtime ignorant of
 * whether it is running a lane or the arena (§3.3, replaced).
 */
export function buildLaneAbilityEnv(
  ctx: {
    data: GameData;
    abilities: AbilityIndex;
    defs: { units: Map<string, { damage: number | null }> };
  },
  lane: { units: AbilityBody[]; monsters: AbilityBody[] },
  rng: Rng,
): AbilityEnv {
  const env: AbilityEnv = {
    data: ctx.data,
    index: ctx.abilities,
    matrix: ctx.data.matrix.multipliers,
    strike: {
      matrix: ctx.data.matrix.multipliers,
      rng,
      // Nothing is dampened in a lane: dampening's clock is the arena's
      // (dampening.ts).
      healing: 1,
      onEvade: (target) => fire(env, target as AbilityBody, 'onEvade', {}),
      onHurt: (target, attacker) =>
        fire(env, target as AbilityBody, 'onHurt', {
          attacker: (attacker as AbilityBody | null) ?? null,
        }),
    },
    healing: 1,
    control: 1,
    sides: (body) =>
      body.monster
        ? { allies: lane.monsters, enemies: lane.units }
        : { allies: lane.units, enemies: lane.monsters },
    attackDamage: (body) =>
      body.monster
        ? ((body as unknown as { damage: number }).damage ?? 0)
        : (ctx.defs.units.get(body.defId)?.damage ?? 0),
    bodyById: (id) =>
      lane.units.find((u) => u.id === id) ?? lane.monsters.find((m) => m.id === id) ?? null,
    granted: (body) => {
      const sendId = (body as unknown as { sendId: string | null }).sendId;
      return sendId === null || sendId === undefined
        ? NONE
        : (ctx.abilities.bySend.get(sendId) ?? NONE);
    },
  };
  return env;
}

/**
 * The environment for the arena: an army's allies are its own and its enemies
 * are the other three seats' (§3.3, replaced).
 *
 * The lists are built ONCE per tick rather than per lookup. Membership can only
 * change when a body dies, the dead are filtered out of target selection
 * anyway, and the corpses are not swept until the end of the tick - so a list
 * taken at the top of the tick is correct for the whole of it, and firing an
 * ability does not rebuild three arrays.
 *
 * Dampening is the other difference from a lane: healing and control durations
 * both fade with `showdown.age`, which is what stops two armies from holding or
 * healing each other indefinitely (dampening.ts).
 */
export function buildArenaAbilityEnv(
  ctx: {
    data: GameData;
    abilities: AbilityIndex;
    defs: { units: Map<string, { damage: number | null }> };
  },
  showdown: {
    age: number;
    armies: { teamId: string; units: AbilityBody[] }[];
  },
  rng: Rng,
): AbilityEnv {
  const dampening = ctx.data.waves.showdown.dampening;
  const allies = new Map<string, AbilityBody[]>();
  const enemies = new Map<string, AbilityBody[]>();
  const everyone: AbilityBody[] = [];

  for (const army of showdown.armies) {
    allies.set(army.teamId, army.units);
    for (const unit of army.units) everyone.push(unit);
  }
  const teamOf = new Map<EntityId, string>();
  for (const army of showdown.armies) {
    for (const unit of army.units) teamOf.set(unit.id, army.teamId);
  }
  // By team rather than by `includes`, which at a hundred and sixty bodies in
  // four armies is four quadratic scans a tick for an answer a lookup gives.
  for (const army of showdown.armies) {
    enemies.set(
      army.teamId,
      everyone.filter((unit) => teamOf.get(unit.id) !== army.teamId),
    );
  }

  const env: AbilityEnv = {
    data: ctx.data,
    index: ctx.abilities,
    matrix: ctx.data.matrix.multipliers,
    strike: {
      matrix: ctx.data.matrix.multipliers,
      rng,
      healing: healingMultiplier(dampening, showdown.age),
      onEvade: (target) => fire(env, target as AbilityBody, 'onEvade', {}),
      onHurt: (target, attacker) =>
        fire(env, target as AbilityBody, 'onHurt', {
          attacker: (attacker as AbilityBody | null) ?? null,
        }),
    },
    healing: healingMultiplier(dampening, showdown.age),
    control: crowdControlMultiplier(dampening, showdown.age),
    sides: (body) => {
      const team = teamOf.get(body.id) ?? '';
      return { allies: allies.get(team) ?? NONE_BODIES, enemies: enemies.get(team) ?? NONE_BODIES };
    },
    // No monsters in the arena, so every attack damage is a unit's definition.
    attackDamage: (body) => ctx.defs.units.get(body.defId)?.damage ?? 0,
    bodyById: (id) => everyone.find((unit) => unit.id === id) ?? null,
  };
  return env;
}

const NONE_BODIES: readonly AbilityBody[] = [];
