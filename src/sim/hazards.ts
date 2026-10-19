// Withering Ground (docs/world-design.md 1.4): the fens' stained patches. Standing in one drains health a second, so the first ground where standing
// still hurts is also the first where a fight is better taken on the road. The patches are data on the region (world.ts); the renderer draws each with
// the same ground circle a boss's mark uses. Pure sim.
import type { GameState } from '../sim';
import { WITHERING } from './world';
import { harmPlayer } from './combat';
import { isFlying } from './flight';

export const WITHERING_NAME = 'Withering Ground';
/** Seconds standing in a patch between drains, and the share of maximum health each takes (unarmoured: the ground does not care what you wear). */
export const WITHERING_EVERY = 1;
export const WITHERING_FRAC = 0.02;
/** `src` on the death recap and the hit event for damage that comes from the ground rather than an enemy. */
export const GROUND_SRC = 'ground';

const standing = new WeakMap<GameState, number>();

/** The patch a point is in, if any. */
export const witheringAt = (x: number, z: number) => WITHERING.find(h => Math.hypot(x - h.x, z - h.z) <= h.r);

export function updateWithering(s: GameState, dt: number) {
  const p = s.player;
  if (p.dead || isFlying(p) || !witheringAt(p.x, p.z)) return void standing.delete(s);
  const t = (standing.get(s) ?? 0) + dt;
  if (t < WITHERING_EVERY) return void standing.set(s, t);
  standing.set(s, t - WITHERING_EVERY);
  harmPlayer(s, GROUND_SRC, undefined, Math.max(1, Math.round(p.maxHp * WITHERING_FRAC)), WITHERING_NAME);
}
