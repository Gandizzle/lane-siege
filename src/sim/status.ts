/**
 * Status effects: what an ability leaves behind. DESIGN.md §7, §18, extended.
 *
 * An ability fires once. What it DOES usually lasts - a slow for three
 * seconds, a burn for four, a ward until something spends it - so every ability
 * that is not instant puts a `Status` on a body and this file is what a body
 * does with the ones it is carrying.
 *
 * ONE LIST, NOT A FIELD PER EFFECT
 *
 * The alternative to a list is a field on the body per effect: `slowUntil`,
 * `burnStacks`, `shieldBlocks`. That works until two units apply the same slow
 * and one of them dies, and then nothing knows whose slow it was. A status
 * carries its own source and its own clock, so expiry, stacking and "who did
 * this" all fall out of the same structure, and `modifiersOf` is one loop over
 * a short array rather than fifteen branches.
 *
 * STACKING IS A RULE, NOT A NUMBER
 *
 * `from` is the interesting field. A slow that stacks from `any` source is a
 * slow four cheap units hold a wave still with; one that stacks `perSource`
 * cannot be stacked by attacking faster; one that stacks `perSourceType` is
 * stacked by building DIFFERENT units, which is a reason to field a mixed line
 * rather than six of the same thing. Each is one word in `abilities.json`.
 *
 * MULTIPLIERS AND FLAT AMOUNTS ARE DIFFERENT THINGS
 *
 * `percent` is a multiplier and they compound: two 20% slows leave 64% of the
 * speed, not 60%, and no number of them reaches zero. That matters - a slow
 * that can reach zero is a root, and a root is a different effect with its own
 * diminishing returns. `flat` adds in the stat's own units and exists for the
 * four stats where an absolute is the honest form (damage, move speed, reach,
 * maximum HP); `validate.ts` refuses it on the rest.
 *
 * PURITY: nothing here reads the clock, the renderer or `Math.random`. Every
 * duration is in TICKS, converted once by whoever applies the status (§15.1).
 */

import type { ControlKind, DamageType, ResolvedEffect, StatKey } from '../data/schema.ts';

/** A stack rule with its numbers already resolved (abilities.ts). */
export type ResolvedStackRule = ResolvedEffect['stacks'];
import { SECONDS_PER_TICK } from './constants.ts';
import type { EntityId } from './types.ts';

/** Which stats take a `flat` amount. Everything else is a multiplier only. */
export const FLAT_CAPABLE: readonly StatKey[] = ['damageDealt', 'moveSpeed', 'maxHealth'];

/** Which stats accumulate by addition because they already are fractions. */
export const ADDITIVE_STATS: readonly StatKey[] = [
  'critChance',
  'critDamage',
  'evasion',
  'lifesteal',
  'reflect',
];

/**
 * One effect, running on one body.
 *
 * Plain data, like everything else in the simulation: a status survives
 * `structuredClone`, goes over the wire if it ever needs to, and can be
 * compared between two clients to find a desync.
 */
export interface Status {
  /** The ability that applied it, and the effect within that ability. */
  abilityId: string;
  slot: number;
  kind: 'modify' | 'damageOverTime' | 'regen' | 'shield' | 'control' | 'immunity';
  stat: StatKey | null;
  mode: 'percent' | 'flat';
  amount: number;
  /** Flat HP per second, for `damageOverTime` and `regen`. */
  perSecond: number;
  /** A fraction of the CARRIER's maximum HP per second, for the same two. */
  ofMaxHealth: number;
  damageType: DamageType | null;
  /** Attacks this ward will still eat, for `shield`. */
  blocks: number;
  control: ControlKind | null;
  immuneTo: 'control' | 'abilities' | null;
  /** The word this status leaves on its carrier, for synergies. */
  tag: string | null;
  /**
   * Ticks remaining. 0 means "until something removes it" - which is how a
   * passive is modelled, refreshed every tick by its source; see `PASSIVE_TICKS`
   * in abilityRuntime.ts.
   */
  ticksLeft: number;
  sourceId: EntityId;
  sourceDefId: string;
}

/** Every way a status can change a body, aggregated. */
export interface Modifiers {
  damageMul: number;
  damageAdd: number;
  damageTakenMul: number;
  attackSpeedMul: number;
  moveSpeedMul: number;
  moveSpeedAdd: number;
  maxHealthMul: number;
  maxHealthAdd: number;
  healingTakenMul: number;
  energyRegenMul: number;
  critChance: number;
  critDamage: number;
  evasion: number;
  lifesteal: number;
  reflect: number;
}

export const NO_MODIFIERS: Readonly<Modifiers> = {
  damageMul: 1,
  damageAdd: 0,
  damageTakenMul: 1,
  attackSpeedMul: 1,
  moveSpeedMul: 1,
  moveSpeedAdd: 0,
  maxHealthMul: 1,
  maxHealthAdd: 0,
  healingTakenMul: 1,
  energyRegenMul: 1,
  critChance: 0,
  critDamage: 0,
  evasion: 0,
  lifesteal: 0,
  reflect: 0,
};

/** What this file needs of a body. Both kinds satisfy it (types.ts). */
export interface Afflicted {
  id: EntityId;
  defId: string;
  hp: number;
  maxHp: number;
  /** Maximum HP before any `maxHealth` modifier (abilityRuntime.ts). */
  baseMaxHp: number;
  /** False until this body's first tick, when `onSpawn` fires. */
  spawnFired: boolean;
  statuses: Status[];
  energy: number;
  /** Ticks until each ability may fire again, by ability id. */
  clocks: Record<string, number>;
  /** Ability ids whose threshold trigger has fired and not yet rearmed. */
  latched: string[];
  /** How many control effects have landed inside the current window (§18). */
  controlUses: number;
  controlWindowLeft: number;
  controlImmuneLeft: number;
}

/**
 * Put a status on a body, honouring its stack rule.
 *
 * Returns whether anything changed, which is what an eventual "show the player
 * that it landed" would hang off.
 */
export function applyStatus(body: Afflicted, status: Status, rule: ResolvedStackRule): boolean {
  const max = Math.max(1, rule.max);
  const refresh = rule.refresh !== false;

  let present = 0;
  let existing: Status | null = null;
  let shortest: Status | null = null;

  for (const s of body.statuses) {
    if (s.abilityId !== status.abilityId || s.slot !== status.slot) continue;
    present += 1;
    if (shortest === null || s.ticksLeft < shortest.ticksLeft) shortest = s;
    if (rule.from === 'perSource' && s.sourceId === status.sourceId) existing = s;
    if (rule.from === 'perSourceType' && s.sourceDefId === status.sourceDefId) existing = s;
  }

  // A source that already has its stack on this body refreshes it rather than
  // adding a second one. This is what `perSource` and `perSourceType` buy.
  if (existing) {
    if (!refresh) return false;
    existing.ticksLeft = Math.max(existing.ticksLeft, status.ticksLeft);
    existing.amount = status.amount;
    existing.blocks = Math.max(existing.blocks, status.blocks);
    return true;
  }

  if (present >= max) {
    // At the cap, a fresh application tops up the one closest to expiring,
    // which is what keeps a maxed stack alive under continued pressure without
    // ever exceeding the cap.
    if (refresh && shortest) {
      shortest.ticksLeft = Math.max(shortest.ticksLeft, status.ticksLeft);
      return true;
    }
    return false;
  }

  body.statuses.push(status);
  return true;
}

/** Everything the body's statuses add up to. */
export function modifiersOf(body: Afflicted): Modifiers {
  if (body.statuses.length === 0) return NO_MODIFIERS;

  const m: Modifiers = { ...NO_MODIFIERS };
  for (const s of body.statuses) {
    if (s.kind !== 'modify' || s.stat === null) continue;
    const flat = s.mode === 'flat';
    switch (s.stat) {
      case 'damageDealt':
        if (flat) m.damageAdd += s.amount;
        else m.damageMul *= 1 + s.amount;
        break;
      case 'damageTaken':
        m.damageTakenMul *= 1 + s.amount;
        break;
      case 'attackSpeed':
        m.attackSpeedMul *= 1 + s.amount;
        break;
      case 'moveSpeed':
        if (flat) m.moveSpeedAdd += s.amount;
        else m.moveSpeedMul *= 1 + s.amount;
        break;
      case 'maxHealth':
        if (flat) m.maxHealthAdd += s.amount;
        else m.maxHealthMul *= 1 + s.amount;
        break;
      case 'healingTaken':
        m.healingTakenMul *= 1 + s.amount;
        break;
      case 'energyRegen':
        m.energyRegenMul *= 1 + s.amount;
        break;
      case 'critChance':
        m.critChance += s.amount;
        break;
      case 'critDamage':
        m.critDamage += s.amount;
        break;
      case 'evasion':
        m.evasion += s.amount;
        break;
      case 'lifesteal':
        m.lifesteal += s.amount;
        break;
      case 'reflect':
        m.reflect += s.amount;
        break;
    }
  }
  // A multiplier can be driven negative by a stack of -100% debuffs only if
  // something authored one; clamp rather than let a body heal itself by being
  // hit. Healing is the exception: full anti-heal is a designed value.
  m.damageMul = Math.max(0, m.damageMul);
  m.damageTakenMul = Math.max(0, m.damageTakenMul);
  m.attackSpeedMul = Math.max(0.05, m.attackSpeedMul);
  m.moveSpeedMul = Math.max(0, m.moveSpeedMul);
  m.healingTakenMul = Math.max(0, m.healingTakenMul);
  return m;
}

function hasControl(body: Afflicted, kind: ControlKind): boolean {
  for (const s of body.statuses) if (s.kind === 'control' && s.control === kind) return true;
  return false;
}

/** May it swing? Stun and disarm say no. */
export function canAttack(body: Afflicted): boolean {
  return !hasControl(body, 'stun') && !hasControl(body, 'disarm');
}

/** May it walk? Stun and root say no. */
export function canMove(body: Afflicted): boolean {
  return !hasControl(body, 'stun') && !hasControl(body, 'root');
}

/** May it fire an ability? Stun and silence say no. */
export function canAct(body: Afflicted): boolean {
  return !hasControl(body, 'stun') && !hasControl(body, 'silence');
}

/** Who is holding its attention, or null. §18's taunt. */
export function tauntedBy(body: Afflicted): EntityId | null {
  for (const s of body.statuses) {
    if (s.kind === 'control' && s.control === 'taunt') return s.sourceId;
  }
  return null;
}

export function immuneToAbilities(body: Afflicted): boolean {
  for (const s of body.statuses) if (s.immuneTo === 'abilities') return true;
  return false;
}

export function immuneToControl(body: Afflicted): boolean {
  if (body.controlImmuneLeft > 0) return true;
  for (const s of body.statuses) if (s.immuneTo === 'control') return true;
  return false;
}

/** Does it carry this word - `burning`, `soaked`, `blighted`? */
export function hasTag(body: Afflicted, tag: string): boolean {
  for (const s of body.statuses) if (s.tag === tag) return true;
  return false;
}

/**
 * Spend a ward on an incoming attack, if there is one.
 *
 * Returns true when the attack was eaten entirely. A ward that runs out of
 * blocks is removed here rather than waiting for its clock, because a spent
 * ward that still shows is a ward the player will count on.
 */
export function consumeShield(body: Afflicted): boolean {
  for (let i = 0; i < body.statuses.length; i++) {
    const s = body.statuses[i]!;
    if (s.kind !== 'shield' || s.blocks <= 0) continue;
    s.blocks -= 1;
    if (s.blocks <= 0) body.statuses.splice(i, 1);
    return true;
  }
  return false;
}

/**
 * How long a control effect landing NOW should last, as a fraction (§18).
 *
 * The first one inside the window is full length, the second half, the third a
 * quarter, and once `scale` is spent the body cannot be controlled at all for
 * `immuneSeconds`. Called at the moment of application and never again, so an
 * effect already running is not retroactively shortened.
 */
export function controlScale(body: Afflicted, scale: readonly number[]): number {
  if (scale.length === 0) return 1;
  const index = Math.min(body.controlUses, scale.length - 1);
  return scale[index] ?? 0;
}

/** Record that a control effect landed, and start the immunity if it was the last. */
export function noteControl(
  body: Afflicted,
  scale: readonly number[],
  windowTicks: number,
  immuneTicks: number,
): void {
  body.controlUses += 1;
  body.controlWindowLeft = windowTicks;
  if (body.controlUses >= scale.length) {
    body.controlImmuneLeft = immuneTicks;
    body.controlUses = 0;
    body.controlWindowLeft = 0;
  }
}

/**
 * One tick of every clock a body carries: status durations, ability cooldowns,
 * the control window and the control immunity.
 *
 * Returns the HP change owed by damage over time and regeneration SEPARATELY,
 * because the two go through different rules - damage through the §6 matrix and
 * healing through `applyHealing`, which is dampening's one point of contact
 * (dampening.ts). The caller owns both.
 */
export function tickStatuses(body: Afflicted): void {
  if (body.controlWindowLeft > 0) {
    body.controlWindowLeft -= 1;
    // The window closed without another control effect: the ladder resets.
    if (body.controlWindowLeft === 0) body.controlUses = 0;
  }
  if (body.controlImmuneLeft > 0) body.controlImmuneLeft -= 1;

  for (const key of Object.keys(body.clocks)) {
    const left = body.clocks[key] ?? 0;
    if (left > 0) body.clocks[key] = left - 1;
  }

  if (body.statuses.length === 0) return;
  let write = 0;
  for (let read = 0; read < body.statuses.length; read++) {
    const s = body.statuses[read]!;
    if (s.ticksLeft > 0) {
      s.ticksLeft -= 1;
      if (s.ticksLeft === 0) continue;
    }
    body.statuses[write++] = s;
  }
  body.statuses.length = write;
}

/** HP per second this body is losing to damage over time, by damage type. */
export function damageOverTimeRate(body: Afflicted): Status[] {
  return body.statuses.filter((s) => s.kind === 'damageOverTime');
}

/** HP per second this body is regaining from `regen` statuses. */
export function regenRate(body: Afflicted): number {
  let rate = 0;
  for (const s of body.statuses) {
    if (s.kind !== 'regen') continue;
    rate += s.perSecond + s.ofMaxHealth * body.maxHp;
  }
  return rate;
}

/** Passive energy regeneration for one tick. */
export function regenerateEnergy(body: Afflicted, perSecond: number, max: number): void {
  const m = modifiersOf(body);
  body.energy = Math.min(max, body.energy + perSecond * m.energyRegenMul * SECONDS_PER_TICK);
}

/** A fresh body's ability state. One place, so no call site forgets a field. */
export function freshAbilityState(energy: number): {
  statuses: Status[];
  energy: number;
  clocks: Record<string, number>;
  latched: string[];
  controlUses: number;
  controlWindowLeft: number;
  controlImmuneLeft: number;
  spawnFired: boolean;
} {
  return {
    statuses: [],
    energy,
    clocks: {},
    latched: [],
    controlUses: 0,
    controlWindowLeft: 0,
    controlImmuneLeft: 0,
    spawnFired: false,
  };
}
