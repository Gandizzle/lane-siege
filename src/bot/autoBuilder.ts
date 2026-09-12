/**
 * A scripted player. DESIGN.md §17.
 *
 * Two jobs, which is why it is no longer under `headless/`:
 *
 *   - The headless runner needs somebody to build, or the M1 text output
 *     degenerates into "monsters walk into an empty lane and eat the fortress".
 *   - The practice match needs three opponents. M4 is four lanes with sends,
 *     fog of war and spectating, and none of that can be seen at all without
 *     somebody in the other lanes. It also means multiplayer's opponent tabs,
 *     vision and elimination are exercised by every local game rather than only
 *     when a server is running.
 *
 * It is not an AI and is not pretending to be. It plays the §11.4 decision
 * badly but legibly: fill the supply budget with a front line and some range
 * behind it, then, once supply-capped, spend surplus gold going tall instead of
 * wide - which is exactly the go-wide-or-go-tall choice every wave asks. Its
 * sending follows §11.5's stated intent literally: aim at whoever is furthest
 * ahead, which is the gang-up-on-the-leader mechanic with no coordination
 * needed.
 *
 * It reads MatchState rather than a view, because it runs where the authority
 * is - inside the local transport, or the headless runner - and not on a
 * client. Fog of war is a rule about what a PLAYER may see (§12); a bot that
 * cheated by reading everything would be a design problem, so it deliberately
 * uses only what §12 makes public: fortress HP, and who is still alive.
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

    // §11.5: send at whoever is furthest ahead. The leader is read off the
    // public record only - fortress HP, and who is still alive (§12) - so this
    // is a decision a human at the opponent tabs could also make.
    //
    // Gems buy sends OR the fortress, never both, and that is §11.2's intended
    // tension. This spends on offence first while a send is affordable, so a
    // practice match actually demonstrates being attacked rather than four
    // players quietly turtling.
    const sendPlan = this.planSend(state, gems);
    if (sendPlan) {
      gems -= sendPlan.cost;
      commands.push(sendPlan.command);
    }

    // Spend the rest on the fortress.
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

  /**
   * The most expensive send it can afford, aimed at the healthiest opponent.
   *
   * Most expensive rather than cheapest because the catalogue is ordered by
   * weight: spending 90 gems on the biggest thing available beats dribbling
   * five probes at somebody, and it gives a practice match something to react
   * to rather than a constant trickle.
   */
  private planSend(state: MatchState, gems: number): { command: Command; cost: number } | null {
    if (state.wave >= this.data.waves.attritionStartWave) return null;

    const self = state.teams.find((t) => t.id === this.teamId);
    if (!self || self.eliminated) return null;

    let leader: { teamId: TeamId; hp: number } | null = null;
    for (const team of state.teams) {
      if (team.eliminated || team.id === this.teamId) continue;
      const lane = state.lanes[team.id];
      if (!lane) continue;
      if (!leader || lane.fortress.hp > leader.hp) {
        leader = { teamId: team.id, hp: lane.fortress.hp };
      }
    }
    if (!leader) return null;

    const affordable = this.data.sends.sends
      .filter((send) => (send.gemCost ?? Infinity) <= gems)
      .sort((a, b) => (b.gemCost ?? 0) - (a.gemCost ?? 0));

    const choice = affordable[0];
    if (!choice) return null;

    return {
      cost: choice.gemCost ?? 0,
      command: {
        kind: 'send',
        teamId: this.teamId,
        targetTeamId: leader.teamId,
        sendId: choice.id,
      },
    };
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
