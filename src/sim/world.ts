// Static zone layout and collision. Shared by sim (collision) and renderer (drawing).

export let WORLD_HALF = 30; // zone is a square of side 2*WORLD_HALF
export const PLAYER_RADIUS = 0.5;

export interface Obstacle { x: number; z: number; r: number }

// Hand-placed zone layout.
export const LANDMARKS = {
  clearing: { x: 0, z: 0, r: 9 },
  forge: { x: 20, z: -8 },
  caveMouth: { x: -18, z: -24 },
  npc: { x: 5, z: 2, r: 0.7 },
  vendor: { x: -5, z: 3, r: 0.7 },
};

/** Rock walls either side of the cave mouth gap (x = -18). Two stacked circles per side seal the strip down to the world edge. */
export const CAVE_MOUTH: Obstacle[] = [
  { x: -21.6, z: -26, r: 2.2 }, { x: -21.6, z: -29.4, r: 2 },
  { x: -14.4, z: -26, r: 2.2 }, { x: -14.4, z: -29.4, r: 2 },
];

export interface Rect { x0: number; x1: number; z0: number; z1: number }
/**
 * The cave: rooms of walkable floor that overlap the outdoor square and each other, so the way in is continuous.
 * Walls are the rectangles' edges (a clamp, not colliders: no per-wall cost), so the interior costs O(rooms) per mover.
 * The throat runs north from the mouth; the hollow is the main cavern; the neck leads on to the warden's hall.
 */
export const CAVE_ROOMS: { name: 'throat' | 'hollow' | 'neck' | 'hall'; rect: Rect }[] = [
  { name: 'throat', rect: { x0: -20.5, x1: -15.5, z0: -46, z1: -24 } },
  { name: 'hollow', rect: { x0: -33, x1: -5, z0: -64, z1: -42 } },
  { name: 'neck', rect: { x0: -20.5, x1: -15.5, z0: -76, z1: -60 } },
  { name: 'hall', rect: { x0: -29, x1: -7, z0: -92, z1: -70 } },
];
const CAVE_RECTS = CAVE_ROOMS.map(r => r.rect);

/** Standing stone in the cave: cover, and something to circle. */
export const CAVE_PILLARS: Obstacle[] = [
  { x: -14.5, z: -50, r: 1.4 }, { x: -27, z: -57, r: 1.4 }, { x: -9, z: -55, r: 1.4 },
  { x: -24, z: -76, r: 1.6 }, { x: -12, z: -76, r: 1.6 }, { x: -24, z: -86, r: 1.6 }, { x: -12, z: -86, r: 1.6 },
];

/** The forge building: a collider, and the one outdoor thing big enough to hide behind (see SIGHT_BLOCKERS). */
export const FORGE_BUILDING: Obstacle = { x: 20, z: -8, r: 2.6 };

export const OBSTACLES: Obstacle[] = [
  // forge building
  FORGE_BUILDING,
  // quest giver
  { x: 5, z: 2, r: 0.7 },
  // the merchant
  { x: -5, z: 3, r: 0.7 },
  // cave mouth: rock walls either side of a gap that is now the way in (see CAVE_ROOMS); the old back rock is gone
  ...CAVE_MOUTH,
];

// Trees: radius-1 obstacles.
export const TREES: Obstacle[] = [
  { x: -12, z: 10, r: 1 }, { x: -20, z: 4, r: 1 }, { x: -8, z: 20, r: 1 },
  { x: 10, z: 18, r: 1 }, { x: 22, z: 12, r: 1 }, { x: 14, z: -20, r: 1 },
  { x: 4, z: -18, r: 1 }, { x: -24, z: -8, r: 1 }, { x: 26, z: 24, r: 1 },
  { x: -26, z: 22, r: 1 }, { x: 8, z: 26, r: 1 }, { x: 28, z: -20, r: 1 },
];

// Ore rocks (gatherable, see sim/gathering.ts). Iron sits east of the cave mouth, the harder coal seams further
// along the same ridge; all are placed (and reachable) outside the Cave Brute's aggro radius so mining is not a death trap.
export interface RockSpot extends Obstacle { type: 'iron' | 'coal' | 'mithril' }
export const ROCKS: RockSpot[] = [
  { type: 'iron', x: -10, z: -25.5, r: 1.2 }, { type: 'iron', x: -9, z: -27.5, r: 1.2 },
  { type: 'iron', x: -12.5, z: -28, r: 1.2 }, { type: 'iron', x: -7, z: -24, r: 1.2 },
  { type: 'coal', x: -5, z: -27.5, r: 1.2 }, { type: 'coal', x: -2.5, z: -25.5, r: 1.2 },
  { type: 'coal', x: -1, z: -28.5, r: 1.2 },
];

/**
 * Ore inside the cave. Kept apart from ROCKS (the ridge outside, hand-placed clear of the Brute) and listed after TREES when the
 * nodes are built, so no existing node id moves and old saves still line up. The first three veins make a seam along the hollow's
 * south-west wall, in reach of the Ravager pack that guards them and of nothing else; the coal is on the far side.
 */
export const CAVE_ROCKS: RockSpot[] = [
  { type: 'mithril', x: -29.2, z: -45.5, r: 1.2 }, { type: 'mithril', x: -29.2, z: -47.9, r: 1.2 }, { type: 'mithril', x: -29.2, z: -50.3, r: 1.2 },
  { type: 'coal', x: -8, z: -45.5, r: 1.2 }, { type: 'coal', x: -8.2, z: -49.5, r: 1.2 },
];

export const COLLIDERS = [...OBSTACLES, ...TREES, ...ROCKS, ...CAVE_PILLARS, ...CAVE_ROCKS];

/**
 * What stands tall enough to break a line of sight (see sim/sight.ts): the forge, the rocks either side of the cave
 * mouth, tree trunks and the cave's standing stones. Ore seams are waist-high and the quest giver is a person:
 * neither hides anything behind it, so neither is here.
 */
export const SIGHT_BLOCKERS: Obstacle[] = [FORGE_BUILDING, ...CAVE_MOUTH, ...TREES, ...CAVE_PILLARS];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The nearest spot on walkable floor to t for a circle of this radius: the outdoor square, or any cave room. */
export function clampToWorld(t: { x: number; z: number }, radius = PLAYER_RADIUS) {
  const m = WORLD_HALF - radius;
  let best = { x: clamp(t.x, -m, m), z: clamp(t.z, -m, m) };
  let bestD = (best.x - t.x) ** 2 + (best.z - t.z) ** 2;
  if (bestD === 0) return best;
  for (const r of CAVE_RECTS) {
    // a room narrower than the circle collapses to its centreline rather than inverting
    const lx = (r.x0 + r.x1) / 2, lz = (r.z0 + r.z1) / 2;
    const c = {
      x: clamp(t.x, Math.min(lx, r.x0 + radius), Math.max(lx, r.x1 - radius)),
      z: clamp(t.z, Math.min(lz, r.z0 + radius), Math.max(lz, r.z1 - radius)),
    };
    const d = (c.x - t.x) ** 2 + (c.z - t.z) ** 2;
    if (d < bestD) { best = c; bestD = d; if (d === 0) break; }
  }
  return best;
}

const inRect = (r: Rect, x: number, z: number) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
/** True when the point is on cave floor (any room, edges included). The mouth gap up to z = -24 counts: the throat starts there. */
export const inCave = (x: number, z: number) => CAVE_RECTS.some(r => inRect(r, x, z));

/** Where daylight gives way to cave dark, as z along the throat: 0 at `from`, 1 at `to`. The threshold is the stretch between. */
export const CAVE_FADE = { from: -24, to: -36 };
/** 0 outdoors, 1 deep inside, smooth across the threshold. For lighting and sound to follow the player through the mouth. */
export function caveDepth(x: number, z: number): number {
  if (!inCave(x, z)) return 0;
  const k = clamp((CAVE_FADE.from - z) / (CAVE_FADE.from - CAVE_FADE.to), 0, 1);
  return k * k * (3 - 2 * k);
}

/**
 * Click-to-move has no pathfinding, and a straight line from deep in the cave to the clearing runs into rock. The rooms sit
 * along one axis, so a walk that has to change room is steered through the junctions instead: `caveRank` says which stretch a
 * point is in (0 outdoors, 1 throat, 2 hollow, 3 neck, 4 hall) and `steerPoint` says where to head right now.
 */
export function caveRank(x: number, z: number): number {
  if (!inCave(x, z) || z > -27) return 0;
  const [throat, hollow, neck, hall] = CAVE_RECTS;
  return inRect(hall, x, z) ? 4 : inRect(hollow, x, z) ? 2 : inRect(neck, x, z) ? 3 : inRect(throat, x, z) ? 1 : 0;
}
// Each waypoint sits inside the next stretch (not on the line between two), so crossing it changes the rank.
const WAY_IN = [{ x: -18, z: -34 }, { x: -18, z: -46 }, { x: -18, z: -67 }, { x: -18, z: -74 }];
const MOUTH_APPROACH = { x: -18, z: -22 };
const WAY_OUT = [MOUTH_APPROACH, { x: -18, z: -38 }, { x: -18, z: -60 }, { x: -18, z: -67 }];
/** The point to walk towards on the way to `to`: `to` itself unless a wall is in between, then the next junction on the route. */
export function steerPoint(from: { x: number; z: number }, to: { x: number; z: number }): { x: number; z: number } {
  const a = caveRank(from.x, from.z), b = caveRank(to.x, to.z);
  // the strip between the throat and the open square (rank 0 but still between the rocks): walk out of it before heading for anything outdoors
  if (a === 0 && b === 0 && inCave(from.x, from.z) && !inCave(to.x, to.z)) return MOUTH_APPROACH;
  if (a === b) return to;
  // the way in is a gap in the rocks: line up on it outdoors first, or the walk meets the rock beside it
  if (a === 0 && from.z > -24 && Math.abs(from.x - MOUTH_APPROACH.x) > 1) return MOUTH_APPROACH;
  return b > a ? WAY_IN[a] : WAY_OUT[a - 1];
}

/**
 * The line the cave's wall runs along at the mouth. Two creatures can only single each other out (Tab, forgiving click) when
 * they are on the same side of it or standing close: a ridge miner is not offered the Hexer behind forty units of rock.
 */
export const CAVE_DOOR_Z = -30;
export const DOOR_SIGHT = 12;
export const sameSideOfDoor = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z) <= DOOR_SIGHT || (a.z > CAVE_DOOR_Z) === (b.z > CAVE_DOOR_Z);

/**
 * Points along the cave's walls, `step` apart, for the renderer to hang rock on: every room's edge except the stretches that open
 * into another room or onto the outdoor square. Pure geometry, so verify can prove the walls are sealed.
 */
export function caveWallPoints(step = 3): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const open = (x: number, z: number, self: Rect) =>
    CAVE_RECTS.some(r => r !== self && inRect({ x0: r.x0 + 0.01, x1: r.x1 - 0.01, z0: r.z0 + 0.01, z1: r.z1 - 0.01 }, x, z))
    || (Math.abs(x) < WORLD_HALF - 0.01 && z > -WORLD_HALF + 0.01 && z < WORLD_HALF - 0.01);
  for (const r of CAVE_RECTS) {
    const edge = (x: number, z: number) => { if (!open(x, z, r)) out.push({ x, z }); };
    for (let x = r.x0; x <= r.x1 + 1e-6; x += step) { edge(x, r.z0); edge(x, r.z1); }
    for (let z = r.z0; z <= r.z1 + 1e-6; z += step) { edge(r.x0, z); edge(r.x1, z); }
  }
  return out;
}

/**
 * Push a circle of the given radius out of the world edge and all obstacles (mutates p). Rocks set side by side, or close to a
 * wall, can shove a body into the next one, so anything that moved it gets another pass, with the walls getting the last word:
 * nothing ever ends up off the floor, and a body between two rocks settles instead of being nudged every tick.
 */
export function resolveCollisions(p: { x: number; z: number }, radius = PLAYER_RADIUS) {
  const c = clampToWorld(p, radius);
  p.x = c.x; p.z = c.z;
  for (let pass = 0; pass < 3; pass++) {
    let pushed = false;
    for (const o of COLLIDERS) {
      const ox = p.x - o.x, oz = p.z - o.z;
      const d = Math.hypot(ox, oz), min = o.r + radius;
      if (d < min) {
        const nx = d > 1e-6 ? ox / d : 1, nz = d > 1e-6 ? oz / d : 0;
        p.x = o.x + nx * min;
        p.z = o.z + nz * min;
        pushed = true;
      }
    }
    if (!pushed) return;
    const w = clampToWorld(p, radius);
    p.x = w.x; p.z = w.z;
  }
}

/** Dev-only: resize the zone (see sim/stress.ts). Importers see the new value through the live binding. */
export function setWorldHalf(h: number) { WORLD_HALF = h; }
