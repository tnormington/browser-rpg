// The world as data: a list of regions, each with a walkable footprint, its own scenery and its connections to its neighbours.
// Everything else in this file (and the flat lists the renderer and sim read) is derived from REGIONS. Routing lives in path.ts.
// Shared by sim (collision, routing) and renderer (drawing).

export const PLAYER_RADIUS = 0.5;

export interface Obstacle { x: number; z: number; r: number }
export interface Rect { x0: number; x1: number; z0: number; z1: number }
export interface Pt { x: number; z: number }
// Ore rocks (gatherable, see sim/gathering.ts).
export interface RockSpot extends Obstacle { type: 'iron' | 'coal' | 'mithril' }

export interface Region {
  id: string;
  name: string;
  /** Underground: dark, echoing, and walled by the footprint's edges. */
  cave: boolean;
  /**
   * The floor, as rectangles whose union is walkable. Footprints may overlap: that is the seam between two regions, so the world is
   * one continuous coordinate space. Walls are the edges (a clamp, not colliders: no per-wall cost).
   */
  footprint: Rect[];
  /** Solid things that are not nodes: buildings, people, rock walls, standing stones. */
  obstacles: Obstacle[];
  /** The subset of `obstacles` tall enough to break a line of sight (see sim/sight.ts). */
  tall: Obstacle[];
  /** Trees: radius-1 obstacles that are also woodcutting nodes. */
  trees: Obstacle[];
  rocks: RockSpot[];
  landmarks: Record<string, Pt & { r?: number }>;
  /** Neighbours and a walkable point on the seam between them. Symmetric: if a lists b, b lists a. */
  connections: { to: string; at: Pt }[];
}

const FORGE_BUILDING: Obstacle = { x: 20, z: -8, r: 2.6 };

/** Rock walls either side of the cave mouth gap (x = -18). Two stacked circles per side seal the strip down to the world edge. */
const MOUTH_WALLS: Obstacle[] = [
  { x: -21.6, z: -26, r: 2.2 }, { x: -21.6, z: -29.4, r: 2 },
  { x: -14.4, z: -26, r: 2.2 }, { x: -14.4, z: -29.4, r: 2 },
];

const clearingLandmarks = {
  clearing: { x: 0, z: 0, r: 9 },
  forge: { x: 20, z: -8 },
  npc: { x: 5, z: 2, r: 0.7 },
  vendor: { x: -5, z: 3, r: 0.7 },
};
const ridgeLandmarks = { caveMouth: { x: -18, z: -24 } };

/**
 * The world. Order matters: node ids follow region order (each region's rocks, then its trees), so new ground goes last and every
 * older node keeps its id (and its save). The ridge is first because its ore was always the first nodes.
 * The cave's rooms overlap the clearing and each other, so the way in is continuous.
 */
export const REGIONS: Region[] = [
  {
    // The rock face along the clearing's southern edge, with the cave mouth gap through it. Iron sits east of the gap, the harder
    // coal seams further along the same ridge; all are placed (and reachable) outside the Cave Brute's aggro radius so mining
    // is not a death trap. A district of the clearing: it adds no floor of its own.
    id: 'ridge', name: 'The Ridge', cave: false,
    footprint: [{ x0: -24, x1: 2, z0: -30, z1: -22 }],
    obstacles: MOUTH_WALLS, tall: MOUTH_WALLS, trees: [],
    rocks: [
      { type: 'iron', x: -10, z: -25.5, r: 1.2 }, { type: 'iron', x: -9, z: -27.5, r: 1.2 },
      { type: 'iron', x: -12.5, z: -28, r: 1.2 }, { type: 'iron', x: -7, z: -24, r: 1.2 },
      { type: 'coal', x: -5, z: -27.5, r: 1.2 }, { type: 'coal', x: -2.5, z: -25.5, r: 1.2 },
      { type: 'coal', x: -1, z: -28.5, r: 1.2 },
    ],
    landmarks: ridgeLandmarks,
    connections: [{ to: 'clearing', at: { x: -18, z: -22 } }, { to: 'throat', at: { x: -18, z: -26 } }],
  },
  {
    // The outdoor square. Its half-side is live (setWorldHalf), so this rect is mutated in place.
    id: 'clearing', name: 'The Clearing', cave: false,
    footprint: [{ x0: -30, x1: 30, z0: -30, z1: 30 }],
    obstacles: [FORGE_BUILDING, { x: 5, z: 2, r: 0.7 }, { x: -5, z: 3, r: 0.7 }], // forge building, quest giver, the merchant
    tall: [FORGE_BUILDING], // the one outdoor thing big enough to hide behind
    trees: [
      { x: -12, z: 10, r: 1 }, { x: -20, z: 4, r: 1 }, { x: -8, z: 20, r: 1 },
      { x: 10, z: 18, r: 1 }, { x: 22, z: 12, r: 1 }, { x: 14, z: -20, r: 1 },
      { x: 4, z: -18, r: 1 }, { x: -24, z: -8, r: 1 }, { x: 26, z: 24, r: 1 },
      { x: -26, z: 22, r: 1 }, { x: 8, z: 26, r: 1 }, { x: 28, z: -20, r: 1 },
    ],
    rocks: [],
    landmarks: clearingLandmarks,
    connections: [{ to: 'ridge', at: { x: -18, z: -22 } }],
  },
  {
    // The throat runs north from the mouth.
    id: 'throat', name: 'The Throat', cave: true,
    footprint: [{ x0: -20.5, x1: -15.5, z0: -46, z1: -24 }],
    obstacles: [], tall: [], trees: [], rocks: [], landmarks: {},
    connections: [{ to: 'ridge', at: { x: -18, z: -26 } }, { to: 'hollow', at: { x: -18, z: -44 } }],
  },
  {
    // The hollow is the main cavern. Standing stones are cover, and something to circle. Its ore is kept apart from the ridge's
    // (the nodes are listed after the clearing's trees, see above). The first three veins make a seam along the south-west wall,
    // in reach of the Ravager pack that guards them and of nothing else; the coal is on the far side.
    id: 'hollow', name: 'The Hollow', cave: true,
    footprint: [{ x0: -33, x1: -5, z0: -64, z1: -42 }],
    obstacles: [{ x: -14.5, z: -50, r: 1.4 }, { x: -27, z: -57, r: 1.4 }, { x: -9, z: -55, r: 1.4 }],
    tall: [], trees: [],
    rocks: [
      { type: 'mithril', x: -29.2, z: -45.5, r: 1.2 }, { type: 'mithril', x: -29.2, z: -47.9, r: 1.2 }, { type: 'mithril', x: -29.2, z: -50.3, r: 1.2 },
      { type: 'coal', x: -8, z: -45.5, r: 1.2 }, { type: 'coal', x: -8.2, z: -49.5, r: 1.2 },
    ],
    landmarks: {},
    connections: [{ to: 'throat', at: { x: -18, z: -44 } }, { to: 'neck', at: { x: -18, z: -62 } }],
  },
  {
    // The neck leads on to the warden's hall.
    id: 'neck', name: 'The Neck', cave: true,
    footprint: [{ x0: -20.5, x1: -15.5, z0: -76, z1: -60 }],
    obstacles: [], tall: [], trees: [], rocks: [], landmarks: {},
    connections: [{ to: 'hollow', at: { x: -18, z: -62 } }, { to: 'hall', at: { x: -18, z: -73 } }],
  },
  {
    id: 'hall', name: "The Warden's Hall", cave: true,
    footprint: [{ x0: -29, x1: -7, z0: -92, z1: -70 }],
    obstacles: [{ x: -24, z: -76, r: 1.6 }, { x: -12, z: -76, r: 1.6 }, { x: -24, z: -86, r: 1.6 }, { x: -12, z: -86, r: 1.6 }],
    tall: [], trees: [], rocks: [], landmarks: {},
    connections: [{ to: 'neck', at: { x: -18, z: -73 } }],
  },
];
// the hollow's and hall's standing stones are tall (they break sight lines)
for (const r of REGIONS) if (r.cave) r.tall.push(...r.obstacles);

export const regionById = (id: string): Region => REGIONS.find(r => r.id === id)!;

// --- Flat views of the regions: what the renderer and the sim read. -----------------------------------------------------------

export let WORLD_HALF = 30; // the clearing is a square of side 2*WORLD_HALF
export const LANDMARKS = { ...clearingLandmarks, ...ridgeLandmarks };

const surface = REGIONS.filter(r => !r.cave), caves = REGIONS.filter(r => r.cave);
/** Rock walls either side of the cave mouth gap. */
export const CAVE_MOUTH: Obstacle[] = MOUTH_WALLS;
/** Standing stone in the cave: cover, and something to circle. */
export const CAVE_PILLARS: Obstacle[] = caves.flatMap(r => r.obstacles);
/** The forge building: a collider, and the one outdoor thing big enough to hide behind (see SIGHT_BLOCKERS). */
export { FORGE_BUILDING };
export const OBSTACLES: Obstacle[] = REGIONS.flatMap(r => r.obstacles);
export const TREES: Obstacle[] = REGIONS.flatMap(r => r.trees);
/** The ridge's ore, outside the cave. */
export const ROCKS: RockSpot[] = surface.flatMap(r => r.rocks);
/** Ore inside the cave. */
export const CAVE_ROCKS: RockSpot[] = caves.flatMap(r => r.rocks);
export const COLLIDERS: Obstacle[] = [...OBSTACLES, ...TREES, ...ROCKS, ...CAVE_ROCKS];

/**
 * What stands tall enough to break a line of sight (see sim/sight.ts): the forge, the rocks either side of the cave
 * mouth, tree trunks and the cave's standing stones. Ore seams are waist-high and the quest giver is a person:
 * neither hides anything behind it, so neither is here.
 */
export const SIGHT_BLOCKERS: Obstacle[] = [...REGIONS.flatMap(r => r.tall), ...TREES];

/** The gatherable spots in node-id order: region by region, each region's rocks then its trees. Ids are positions in this list. */
export const nodeSpots = (): (RockSpot | (Obstacle & { type: 'tree' }))[] =>
  REGIONS.flatMap(r => [...r.rocks, ...r.trees.map(t => ({ ...t, type: 'tree' as const }))]);

/** Every region's floor in one list (the same rect objects, so a resized clearing shows here). */
export const FOOTPRINT: Rect[] = REGIONS.flatMap(r => r.footprint);
const CAVE_RECTS: Rect[] = caves.flatMap(r => r.footprint);

/** The old name for the cave's rooms, with the rect each is made of. */
export const CAVE_ROOMS = caves.map(r => ({ name: r.id as 'throat' | 'hollow' | 'neck' | 'hall', rect: r.footprint[0] }));

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The nearest spot on walkable floor to t for a circle of this radius: on any region's footprint. */
export function clampToWorld(t: { x: number; z: number }, radius = PLAYER_RADIUS) {
  let best = { x: t.x, z: t.z }, bestD = Infinity;
  for (const r of FOOTPRINT) {
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
/** The region a point is in: the first listed whose footprint holds it (so on a seam, the earlier region), or null off the map. */
export const regionAt = (x: number, z: number): Region | null => REGIONS.find(r => r.footprint.some(f => inRect(f, x, z))) ?? null;

/** Where daylight gives way to cave dark, as z along the throat: 0 at `from`, 1 at `to`. The threshold is the stretch between. */
export const CAVE_FADE = { from: -24, to: -36 };
/** 0 outdoors, 1 deep inside, smooth across the threshold. For lighting and sound to follow the player through the mouth. */
export function caveDepth(x: number, z: number): number {
  if (!inCave(x, z)) return 0;
  const k = clamp((CAVE_FADE.from - z) / (CAVE_FADE.from - CAVE_FADE.to), 0, 1);
  return k * k * (3 - 2 * k);
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
 * into another footprint (another room, or the outdoor square). Pure geometry, so verify can prove the walls are sealed.
 */
export function caveWallPoints(step = 3): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const open = (x: number, z: number, self: Rect) =>
    FOOTPRINT.some(r => r !== self && inRect({ x0: r.x0 + 0.01, x1: r.x1 - 0.01, z0: r.z0 + 0.01, z1: r.z1 - 0.01 }, x, z));
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

/** Dev-only: resize the clearing (see sim/stress.ts). Importers see the new value through the live binding. */
export function setWorldHalf(h: number) {
  WORLD_HALF = h;
  const f = regionById('clearing').footprint[0];
  f.x0 = f.z0 = -h; f.x1 = f.z1 = h;
}

/** Dev-only: add a tree or ore rock to a region after the fact (see sim/stress.ts), keeping the flat lists and colliders in step. */
export function addScenery(regionId: string, spot: Obstacle | RockSpot) {
  const r = regionById(regionId);
  if ('type' in spot) { r.rocks.push(spot); (r.cave ? CAVE_ROCKS : ROCKS).push(spot); } else { r.trees.push(spot); TREES.push(spot); }
  COLLIDERS.push(spot);
}
