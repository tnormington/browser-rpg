// Dungeon doors (world.ts holds the rooms): which ones are open to this player, and the one rule that keeps a shut one shut. Pure sim.
import type { GameState } from '../sim';
import { Dungeon, dungeonAt } from './world';

/** What each hard gate asks for, by the key a dungeon's `gate.need` names. A key with no entry here never opens: a typo fails shut, not open. */
const GATES: Record<string, (s: GameState) => boolean> = {
  brine_and_bone: s => s.quest.fifth === 'cleared', // the Grotto: the Strand has to be quiet before the harbourmaster will say where the door is
};

export const dungeonOpen = (s: GameState, d: Dungeon) => !d.gate || (GATES[d.gate.need]?.(s) ?? false);

const lastSaid = new WeakMap<GameState, number>();
const SAY_EVERY = 60; // ticks between two refusals: holding a key against a shut door should be one line, not thirty a second

/**
 * Called after a step has been resolved: if it took the player onto a shut dungeon's floor from outside it, the step is undone and the door says why.
 * A player already inside (a save, a test placing them) is never trapped by this: only the way in is refused.
 */
export function holdDoor(s: GameState, from: { x: number; z: number }): boolean {
  const p = s.player, into = dungeonAt(p.x, p.z);
  if (!into || dungeonOpen(s, into) || dungeonAt(from.x, from.z) === into) return false;
  p.x = from.x; p.z = from.z;
  if (s.tick - (lastSaid.get(s) ?? -SAY_EVERY) >= SAY_EVERY) {
    lastSaid.set(s, s.tick);
    s.events.push({ t: 'door', dungeon: into.id, blurb: into.gate!.blurb });
  }
  return true;
}
