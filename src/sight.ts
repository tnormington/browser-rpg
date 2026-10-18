// Can the player see a spot, or is rock in the way? The cave's walls are rectangle edges in the sim (nothing to raycast), so the check walks the line.
import { CAVE_DOOR_Z, CAVE_MOUTH, inCave } from './sim/world';

type Pt = { x: number; z: number };
const STEP = 0.5;
const SELF_MARGIN = 1.5; // the end of the line is the thing itself, which may stand against a wall or be a collider

/** True when the straight line from `from` to `to` stays on open ground: cave floor, or outdoors short of the cave wall and clear of the mouth rocks. */
export function clearLine(from: Pt, to: Pt): boolean {
  const dx = to.x - from.x, dz = to.z - from.z, len = Math.hypot(dx, dz);
  for (let d = 0; d < len - SELF_MARGIN; d += STEP) {
    const x = from.x + (dx * d) / len, z = from.z + (dz * d) / len;
    if (!inCave(x, z) && z <= CAVE_DOOR_Z) return false;
    if (CAVE_MOUTH.some(o => Math.hypot(x - o.x, z - o.z) < o.r - 0.2)) return false;
  }
  return true;
}
