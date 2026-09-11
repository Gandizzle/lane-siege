/**
 * A scripted player for the headless runner. DESIGN.md §17, M1.
 *
 * This is TEST HARNESS, not game logic, which is why it lives under headless/
 * and not under sim/. It exists so the M1 text output has something to show:
 * without a player issuing commands nobody ever builds, and the run degenerates
 * into "monsters walk to an empty lane and eat the fortress".
 *
 * It plays the §11.4 decision badly but legibly: fill the supply budget with a
 * front line and some range behind it, then, once supply-capped, spend surplus
 * gold going tall instead of wide - which is exactly the go-wide-or-go-tall
 * choice every wave is supposed to ask.
 */

import type { GameData } from '../data/schema.ts';
import type { Command, MatchState, TeamId } from '../sim/index.ts';

/**
 * Where each unit type wants to stand. Monsters enter at negative y and walk
 * toward the fortress at +y, so LOW rows are the front line that absorbs and
 * HIGH rows are the back line that deals damage over the top of it (§4.1).
 */
interface Slot {
  unitDefId: string;
  tileX: number;
  tileY: number;
}

function buildOrder(data: GameData): Slot[] {
  const width = data.lane.buildZone.width;
  const mid = Math.floor(width / 2);
  const slots: Slot[] = [];

  // Interleave so the line grows outward from the middle of the lane rather
  // than filling from one edge.
  const columns: number[] = [];
  for (let offset = 0; offset < width; offset++) {
    const x = offset % 2 === 0 ? mid + (offset >> 1) : mid - 1 - (offset >> 1);
    if (x >= 0 && x < width) columns.push(x);
  }

  // Round-robin the three types rather than filling on the cheapest one. A line
  // of nothing but Hammers is all Impact damage, which loses to the first Swarm
  // wave outright (§6.1) - and would make the M1 output prove nothing about the
  // matrix.
  const rows: { unitDefId: string; tileY: number }[] = [
    { unitDefId: 'hammer', tileY: 3 },
    { unitDefId: 'spike', tileY: 5 },
    { unitDefId: 'mortar', tileY: 7 },
  ];

  for (let i = 0; i < columns.length; i++) {
    for (const row of rows) {
      slots.push({ unitDefId: row.unitDefId, tileX: columns[i]!, tileY: row.tileY });
    }
  }

  return slots;
}

export class AutoBuilder {
  private readonly slots: Slot[];

  constructor(
    private readonly data: GameData,
    private readonly teamId: TeamId,
  ) {
    this.slots = buildOrder(data);
  }

  /**
   * Commands for one build phase. Returns an empty list outside the build phase,
   * so the caller can invoke it every tick without caring.
   */
  plan(state: MatchState): Command[] {
    if (state.phase !== 'build') return [];

    const lane = state.lanes[this.teamId];
    if (!lane) return [];

    const commands: Command[] = [];
    if (!lane.fortress.activeAura) {
      commands.push({ kind: 'setAura', teamId: this.teamId, aura: 'damage' });
    }

    // Track spend locally: the simulation only applies these next tick, so the
    // planner must not promise the same gold twice.
    let gold = lane.economy.gold;
    let gems = lane.economy.gems;
    let supply = lane.economy.supplyCap - lane.economy.supplyUsed;

    const taken = new Set(
      lane.units.filter((u) => u.alive).map((u) => `${u.homeTileX},${u.homeTileY}`),
    );

    // Go wide while supply allows.
    for (const slot of this.slots) {
      if (taken.has(`${slot.tileX},${slot.tileY}`)) continue;

      const def = this.data.units.units.find((u) => u.id === slot.unitDefId);
      if (!def) continue;

      const cost = def.goldCost ?? 0;
      const supplyCost = def.supplyCost ?? 0;
      if (cost > gold || supplyCost > supply) continue;

      gold -= cost;
      supply -= supplyCost;
      taken.add(`${slot.tileX},${slot.tileY}`);
      commands.push({
        kind: 'placeUnit',
        teamId: this.teamId,
        unitDefId: slot.unitDefId,
        tileX: slot.tileX,
        tileY: slot.tileY,
      });
    }

    // Spend gems on the fortress. They have no other sink in single player
    // (sends are M4), so hoarding them would leave half of M3 untested.
    for (const id of ['weapon', 'regen', 'hp', 'gemProduction', 'auraStrength', 'auraRadius']) {
      const ladder = fortressLadder(this.data, id);
      const level = lane.fortress.upgrades[id] ?? 0;
      const next = ladder.find((l) => l.level === level + 1);
      if (!next) continue;

      const cost = next.gemCost ?? 0;
      const supplyCost = next.supplyCost ?? 0;
      if (cost > gems || supplyCost > supply) continue;

      gems -= cost;
      supply -= supplyCost;
      commands.push({ kind: 'buyFortressUpgrade', teamId: this.teamId, upgradeId: id });
    }

    // Raise the supply cap when it is the thing holding the army back.
    const capLadder = this.data.economy.supply.capUpgrades;
    const capLevel = lane.fortress.upgrades.supply ?? 0;
    const nextCap = capLadder.find((l) => l.level === capLevel + 1);
    if (nextCap && supply <= 2 && (nextCap.goldCost ?? 0) <= gold) {
      gold -= nextCap.goldCost ?? 0;
      commands.push({ kind: 'buySupply', teamId: this.teamId });
    }

    // Supply-capped: go tall instead (§7.3 - roughly 1.6x cost for 2.2x value).
    for (const unit of lane.units) {
      if (!unit.alive) continue;

      const def = this.data.units.units.find((u) => u.id === unit.defId);
      const nextId = def?.upgradesTo;
      if (!nextId) continue;

      const next = this.data.units.units.find((u) => u.id === nextId);
      if (!next) continue;

      const cost = next.goldCost ?? 0;
      const supplyCost = next.supplyCost ?? 0;
      if (cost > gold || supplyCost > supply) continue;

      gold -= cost;
      supply -= supplyCost;
      commands.push({ kind: 'upgradeUnit', teamId: this.teamId, unitId: unit.id });
    }

    // Whatever gold is left goes into tech, cheapest track first (§7.4).
    const affordable = this.data.economy.tech.tracks
      .map((track) => {
        const level = lane.economy.tech[track.id] ?? 0;
        return { track, next: track.levels.find((l) => l.level === level + 1) };
      })
      .filter((t) => t.next !== undefined)
      .sort((a, b) => (a.next!.goldCost ?? 0) - (b.next!.goldCost ?? 0));

    for (const { track, next } of affordable) {
      const cost = next!.goldCost ?? 0;
      if (cost > gold) continue;
      gold -= cost;
      commands.push({ kind: 'buyTech', teamId: this.teamId, trackId: track.id });
    }

    return commands;
  }
}

function fortressLadder(data: GameData, id: string) {
  const f = data.fortress;
  switch (id) {
    case 'weapon':
      return f.weapon.upgrades;
    case 'hp':
      return f.hp.upgrades;
    case 'regen':
      return f.regenOnLaneClear.upgrades;
    case 'gemProduction':
      return f.resourceBuilding.upgrades;
    case 'auraStrength':
      return f.auras.strength.upgrades;
    case 'auraRadius':
      return f.auras.radius.upgrades;
    default:
      return [];
  }
}
