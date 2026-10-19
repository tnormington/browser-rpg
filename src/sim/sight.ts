// Can one spot see another, or is something in the way? The cave's walls are rectangle edges in the sim (nothing to
// raycast) and cover is circles, so the check walks the line. One answer for three jobs: what an enemy wakes to
// (sim/combat aggro), what it can shoot (ranged casts), and what the HUD hangs a nameplate on.
import { CAVE_DOOR_Z, SIGHT_BLOCKERS, inCave } from './world';

type Pt = { x: number; z: number };
const STEP = 0.5;
const SELF_MARGIN = 1.5; // the end of the line is the thing itself, which may stand against a wall or hug a pillar

/** True when the straight line from `from` to `to` stays on open ground: cave floor, or outdoors short of the cave wall, and clear of everything tall enough to hide behind. */
export function clearLine(from: Pt, to: Pt): boolean {
  const dx = to.x - from.x, dz = to.z - from.z, len = Math.hypot(dx, dz);
  for (let d = 0; d < len - SELF_MARGIN; d += STEP) {
    const x = from.x + (dx * d) / len, z = from.z + (dz * d) / len;
    if (!inCave(x, z) && z <= CAVE_DOOR_Z) return false;
    if (SIGHT_BLOCKERS.some(o => Math.hypot(x - o.x, z - o.z) < o.r - 0.2)) return false;
  }
  return true;
}
