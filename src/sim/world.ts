// The world as data: a list of regions, each with a walkable footprint, its own scenery and its connections to its neighbours.
// Everything else in this file (and the flat lists the renderer and sim read) is derived from REGIONS. Routing lives in path.ts.
// Shared by sim (collision, routing) and renderer (drawing).
//
// The world is one continuous coordinate space: regions sit at offsets in it and overlap at their seams, so the player walks from
// one to the next with no transition. What keeps that affordable is that nothing reads the whole world per call: colliders are looked
// up by position (collidersAt / collidersIn), routing builds one grid per zone on demand and evicts (path.ts), and the sim and the
// renderer skip what is far from the player (sim.ts, world-view.ts).

export const PLAYER_RADIUS = 0.5;

export interface Obstacle { x: number; z: number; r: number }
export interface Rect { x0: number; x1: number; z0: number; z1: number }
export interface Pt { x: number; z: number }
// Ore rocks (gatherable, see sim/gathering.ts).
export interface RockSpot extends Obstacle { type: 'iron' | 'coal' | 'mithril' | 'adamant' }

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
  /** Routing zone: regions that share one are searched over one grid (the clearing, the ridge and the cave: the ridge's rock gaps need fine cells). */
  zone: string;
  /** Routing cell size of the zone's grid, in world units. Default WILD_CELL: open country does not need the cave's resolution, and 800 x 120 at 0.25 would be 1.5M cells. */
  cell?: number;
  /** Town squares: no enemy is placed or aggros inside one, and one that wanders in resets. World coordinates. */
  safe?: { x: number; z: number; r: number }[];
  /** Where this region's enemies stand (world coordinates). Hale's older ones live in data.ts, which keeps their ids. */
  spawns?: { type: string; x: number; z: number }[];
}

/** Cell size of a zone's routing grid unless its regions ask for finer. */
export const WILD_CELL = 1;

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

/** Hale's east gate: a 6-unit gap in the clearing's wall at x = 30, between the tree at (22, 12) and the forge's row. Its seam point is just inside. */
const HALE_GATE: Pt = { x: 29, z: 8 };

/** Where each new region's own frame sits in the world. Local coordinates (the design bible's) are offsets from these. */
export const GREYWATER = { x: 436, z: 8 };   // 800 x 120, road along its z = 0; local x -400 is the Hale gate (world 36), +400 the Saltmarrow one
export const SALTMARROW = { x: 906, z: 8 };  // 140 x 140; the town is its west half, the Strand its south and east, the sea beyond x = +30
const at = (o: Pt, lx: number, lz: number) => ({ x: o.x + lx, z: o.z + lz });
const hash = (n: number) => Math.abs(Math.sin(n * 12.9898) * 43758.5453) % 1; // deterministic scatter: no rng state touched

/** Greywater Road's camps, by the bible's layout table (section 3.4). Local coordinates. */
const GREYWATER_SPAWNS = [
  // hog pasture
  ['marsh_hog', -320, -25], ['marsh_hog', -300, 20], ['marsh_hog', -282, -16], ['marsh_hog', -264, 26],
  // wolf camp A: a pack of three (one wakes, all wake)
  ['road_wolf', -170, -35], ['road_wolf', -168.4, -33.8], ['road_wolf', -171.6, -33.4],
  // the ambush: one footpad either side of the road
  ['footpad', -60, 30], ['footpad', -50, -28],
  // the toll camp, across the road: the captain and two footpads
  ['toll_captain', 60, 0], ['footpad', 54, -7], ['footpad', 67, 7],
  // wolf camp B
  ['road_wolf', 190, 40], ['road_wolf', 191.5, 41.2], ['road_wolf', 188.6, 41.6],
  // the hogs by the east end
  ['marsh_hog', 260, -30], ['marsh_hog', 268, -26],
  // Old Grey, behind a rock
  ['old_grey', 330, -45],
] as const;

/** The Strand: south and east of the town, out of its safe square. Local coordinates. */
const STRAND_SPAWNS = [
  ['shore_crab', 20, -48], ['shore_crab', 25, -40], ['shore_crab', 17, 24], ['shore_crab', 23, 32],
  ['drowned_sailor', -4, 50], ['drowned_sailor', 6, 46], ['drowned_sailor', -18, 60],
  ['tide_hag', -56, 50], ['tide_hag', -48, 60],
  ['barnacle_ogre', 24, 58],
  ['gutterhook', -62, -62],
] as const;

const worldSpawns = (o: Pt, list: readonly (readonly [string, number, number])[]) => list.map(([type, lx, lz]) => ({ type, ...at(o, lx, lz) }));

/**
 * The road's verges: boulders and dead trees along both sides, none within 11 of a camp and none in the strip the road runs
 * down (so a click along it is a straight line), nor near the gates. Deterministic, so ids and saves are stable.
 */
function verge(o: Pt, spawns: Pt[], extra: Obstacle[]): { obstacles: Obstacle[]; tall: Obstacle[] } {
  const obstacles: Obstacle[] = [...extra], tall: Obstacle[] = extra.filter(e => e.r >= 1.8);
  for (let k = 0; k < 150; k++) {
    const lx = -380 + k * 5.3 + (hash(k * 3 + 1) - 0.5) * 4;
    if (lx > 380 || hash(k * 17 + 5) < 0.35) continue;
    const lz = (hash(k * 7 + 2) < 0.5 ? -1 : 1) * (12 + hash(k * 11 + 3) * 38);
    const tree = hash(k * 5 + 4) < 0.4, r = tree ? 0.9 : 1.2 + hash(k * 13 + 6) * 1.2, c = at(o, lx, lz);
    if (spawns.some(sp => Math.hypot(sp.x - c.x, sp.z - c.z) < 11) || extra.some(e => Math.hypot(e.x - c.x, e.z - c.z) < e.r + r + 2)) continue;
    const ob = { x: c.x, z: c.z, r };
    obstacles.push(ob);
    if (tree || r >= 1.8) tall.push(ob);
  }
  return { obstacles, tall };
}

const roadSpawns = worldSpawns(GREYWATER, GREYWATER_SPAWNS);
const roadProps: Obstacle[] = [
  { ...at(GREYWATER, 66, -15), r: 2.6 },   // the toll hut, beside the road
  { ...at(GREYWATER, 53, 12), r: 1.4 },    // the toll cart
  { ...at(GREYWATER, 330, -38), r: 3.2 },  // the rock Old Grey lies behind, seen from the road
  { ...at(GREYWATER, 336, -52), r: 2.4 },
];
const road = verge(GREYWATER, roadSpawns, roadProps);

/** The town's buildings: the inn (The Gilded Gull) and the houses round the square. */
const SALT_INN: Obstacle = { ...at(SALTMARROW, -10, -16), r: 4.6 };
const SALT_HOUSES: Obstacle[] = [
  { ...at(SALTMARROW, -48, -24), r: 3.2 }, { ...at(SALTMARROW, -50, 22), r: 3.2 }, { ...at(SALTMARROW, -6, 26), r: 3.2 }, { ...at(SALTMARROW, -42, -42), r: 3 },
];
/** Beached hulls, the quay's crates, and the cliff rock the Strand's rare lurks behind. */
const SALT_PROPS: Obstacle[] = [
  { ...at(SALTMARROW, 22, -20), r: 2.4 }, { ...at(SALTMARROW, 24, 28), r: 2.4 },
  { ...at(SALTMARROW, 24, -5.5), r: 0.9 }, { ...at(SALTMARROW, 24, 5.5), r: 0.9 },
  { ...at(SALTMARROW, -58, -52), r: 2.6 }, { ...at(SALTMARROW, -30, 36), r: 1.6 }, { ...at(SALTMARROW, -2, -50), r: 1.8 },
  { ...at(SALTMARROW, 12, 40), r: 1.6 }, { ...at(SALTMARROW, -40, 62), r: 2 }, { ...at(SALTMARROW, 28, 8), r: 1.2 }, { ...at(SALTMARROW, 8, 66), r: 2.2 },
];
const saltLandmarks = {
  square: at(SALTMARROW, -25, 0),
  harbourmaster: { ...at(SALTMARROW, -20, 4), r: 0.7 },
  harbourVendor: { ...at(SALTMARROW, -30, 6), r: 0.7 },
  inn: { x: SALT_INN.x, z: SALT_INN.z },
  /** The cooking range, in the inn: reserved for the cooking station (W2.2). */
  range: at(SALTMARROW, -10, -9),
  /** The quay's root and its end: where the flight master (W2.3) and the fishing spots (W2.2) will go. */
  quayRoot: at(SALTMARROW, 16, 0),
  quayEnd: at(SALTMARROW, 62, 0),
};

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
    id: 'ridge', name: 'The Ridge', cave: false, zone: 'hale', cell: 0.25,
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
    id: 'clearing', name: 'The Clearing', cave: false, zone: 'hale', cell: 0.25,
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
    connections: [{ to: 'ridge', at: { x: -18, z: -22 } }, { to: 'greywater', at: HALE_GATE }],
    // Hale's safe ground is the smithy's yard, not the whole square: Hale's own enemies live in the clearing (the nearest boar is 8 from the forge)
    // and its golden-path fights are fought on the middle of it, so a town-sized circle here would be a different game. Saltmarrow's is the real thing.
    safe: [{ x: 20, z: -8, r: 4 }],
  },
  {
    // The throat runs north from the mouth.
    id: 'throat', name: 'The Throat', cave: true, zone: 'hale', cell: 0.25,
    footprint: [{ x0: -20.5, x1: -15.5, z0: -46, z1: -24 }],
    obstacles: [], tall: [], trees: [], rocks: [], landmarks: {},
    connections: [{ to: 'ridge', at: { x: -18, z: -26 } }, { to: 'hollow', at: { x: -18, z: -44 } }],
  },
  {
    // The hollow is the main cavern. Standing stones are cover, and something to circle. Its ore is kept apart from the ridge's
    // (the nodes are listed after the clearing's trees, see above). The first three veins make a seam along the south-west wall,
    // in reach of the Ravager pack that guards them and of nothing else; the coal is on the far side.
    id: 'hollow', name: 'The Hollow', cave: true, zone: 'hale', cell: 0.25,
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
    id: 'neck', name: 'The Neck', cave: true, zone: 'hale', cell: 0.25,
    footprint: [{ x0: -20.5, x1: -15.5, z0: -76, z1: -60 }],
    obstacles: [], tall: [], trees: [], rocks: [], landmarks: {},
    connections: [{ to: 'hollow', at: { x: -18, z: -62 } }, { to: 'hall', at: { x: -18, z: -73 } }],
  },
  {
    id: 'hall', name: "The Warden's Hall", cave: true, zone: 'hale', cell: 0.25,
    footprint: [{ x0: -29, x1: -7, z0: -92, z1: -70 }],
    obstacles: [{ x: -24, z: -76, r: 1.6 }, { x: -12, z: -76, r: 1.6 }, { x: -24, z: -86, r: 1.6 }, { x: -12, z: -86, r: 1.6 }],
    tall: [], trees: [], rocks: [], landmarks: {},
    connections: [{ to: 'neck', at: { x: -18, z: -73 } }],
  },
  {
    // The Greywater Road: 800 x 120 of wilds, the road down its middle. Its footprint is the road's own rectangle, a 6-unit corridor
    // through Hale's east wall (the gate), and ten units of overlap with Saltmarrow. Camps and the elite are in section 3.4.
    id: 'greywater', name: 'Greywater Road', cave: false, zone: 'greywater',
    footprint: [
      { x0: 28, x1: 44, z0: 5, z1: 11 },
      { x0: GREYWATER.x - 400, x1: GREYWATER.x + 410, z0: GREYWATER.z - 60, z1: GREYWATER.z + 60 },
    ],
    obstacles: road.obstacles, tall: road.tall, trees: [], rocks: [],
    landmarks: { gate: { x: 30, z: 8 }, toll: at(GREYWATER, 60, 0) },
    connections: [{ to: 'clearing', at: HALE_GATE }, { to: 'saltmarrow', at: at(GREYWATER, 405, 0) }],
    spawns: roadSpawns,
  },
  {
    // Saltmarrow and the Strand. The land is the west 100 units of a 140 square (the sea is the rest, and its edge is the wall); the
    // quay runs out into the water as a walkable strip. The town square is safe; the Strand's enemies stand outside it.
    id: 'saltmarrow', name: 'Saltmarrow', cave: false, zone: 'saltmarrow',
    footprint: [
      { x0: SALTMARROW.x - 70, x1: SALTMARROW.x + 30, z0: SALTMARROW.z - 70, z1: SALTMARROW.z + 70 },
      { x0: SALTMARROW.x + 16, x1: SALTMARROW.x + 62, z0: SALTMARROW.z - 3, z1: SALTMARROW.z + 3 },
    ],
    obstacles: [SALT_INN, ...SALT_HOUSES, ...SALT_PROPS, { ...saltLandmarks.harbourmaster }, { ...saltLandmarks.harbourVendor }],
    tall: [SALT_INN, ...SALT_HOUSES, SALT_PROPS[4]], trees: [],
    rocks: [-14, -8, -2, 4, 10].map((lx, i) => ({ type: 'adamant' as const, ...at(SALTMARROW, lx, i % 2 ? -66 : -64), r: 1.2 })),
    landmarks: saltLandmarks,
    connections: [{ to: 'greywater', at: at(GREYWATER, 405, 0) }],
    safe: [{ ...saltLandmarks.square, r: 35 }],
    spawns: worldSpawns(SALTMARROW, STRAND_SPAWNS),
  },
];
// the hollow's and hall's standing stones are tall (they break sight lines)
for (const r of REGIONS) if (r.cave) r.tall.push(...r.obstacles);

export const regionById = (id: string): Region => REGIONS.find(r => r.id === id)!;

// --- Flat views of the regions: what the renderer and the sim read. -----------------------------------------------------------

export let WORLD_HALF = 30; // the clearing is a square of side 2*WORLD_HALF
export const LANDMARKS = { ...clearingLandmarks, ...ridgeLandmarks, ...saltLandmarks };

const surface = REGIONS.filter(r => !r.cave), caves = REGIONS.filter(r => r.cave);
/** Rock walls either side of the cave mouth gap. */
export const CAVE_MOUTH: Obstacle[] = MOUTH_WALLS;
/** Standing stone in the cave: cover, and something to circle. */
export const CAVE_PILLARS: Obstacle[] = caves.flatMap(r => r.obstacles);
/** The forge building: a collider, and the one outdoor thing big enough to hide behind (see SIGHT_BLOCKERS). */
export { FORGE_BUILDING };
export const OBSTACLES: Obstacle[] = REGIONS.flatMap(r => r.obstacles);
/** Hale's trees: the ones the first quests chop. Other regions' trees (none yet) are in REGIONS. */
export const TREES: Obstacle[] = surface.filter(r => r.zone === 'hale').flatMap(r => r.trees);
/** The ridge's ore, outside the cave. Other surface regions' ore (Saltmarrow's adamant) is in their own `rocks`. */
export const ROCKS: RockSpot[] = surface.filter(r => r.zone === 'hale').flatMap(r => r.rocks);
/** Ore inside the cave. */
export const CAVE_ROCKS: RockSpot[] = caves.flatMap(r => r.rocks);
/**
 * Every solid thing in the world, in one list. Nothing should scan it: ask for the ones near a place (collidersAt, collidersIn).
 * It is still the list a test or the stress knob appends to, and the index below follows it.
 */
export const COLLIDERS: Obstacle[] = [...OBSTACLES, ...REGIONS.flatMap(r => r.trees), ...REGIONS.flatMap(r => r.rocks)];

// --- Where things are: a spatial index over COLLIDERS, so collision and line tests cost what is near, not what exists. ---------

const INDEX_CELL = 16;
/** How far an entity's reach may extend past its own position when looked up by collidersAt (a body radius, plus the push out of a collider). */
const INDEX_MARGIN = 4;
let cells = new Map<number, Obstacle[]>(), indexedLen = -1, indexVersion = 0, indexedVersion = -1;
const cellKey = (i: number, j: number) => i * 100003 + j;
const NONE: Obstacle[] = [];
/** Drop the index: call after changing a collider's place or size in place. Pushing or removing from COLLIDERS is noticed on its own. */
export const colliderIndexChanged = () => { indexVersion++; };
function ensureIndex() {
  if (indexedLen === COLLIDERS.length && indexedVersion === indexVersion) return;
  cells = new Map();
  for (const o of COLLIDERS) {
    const i0 = Math.floor((o.x - o.r - INDEX_MARGIN) / INDEX_CELL), i1 = Math.floor((o.x + o.r + INDEX_MARGIN) / INDEX_CELL);
    const j0 = Math.floor((o.z - o.r - INDEX_MARGIN) / INDEX_CELL), j1 = Math.floor((o.z + o.r + INDEX_MARGIN) / INDEX_CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = cellKey(i, j), list = cells.get(k);
      if (list) list.push(o); else cells.set(k, [o]);
    }
  }
  indexedLen = COLLIDERS.length; indexedVersion = indexVersion;
}
/** Every collider that can touch a body within INDEX_MARGIN of (x, z). No allocation: the list is the index's own, so do not keep it across a change to COLLIDERS. */
export function collidersAt(x: number, z: number): readonly Obstacle[] {
  ensureIndex();
  return cells.get(cellKey(Math.floor(x / INDEX_CELL), Math.floor(z / INDEX_CELL))) ?? NONE;
}
const scratch: Obstacle[] = [];
/** Colliders near anywhere in a box (a segment's bounding box, say), possibly with repeats. The list is reused by the next call. */
export function collidersIn(x0: number, z0: number, x1: number, z1: number): readonly Obstacle[] {
  ensureIndex();
  const i0 = Math.floor(Math.min(x0, x1) / INDEX_CELL), i1 = Math.floor(Math.max(x0, x1) / INDEX_CELL);
  const j0 = Math.floor(Math.min(z0, z1) / INDEX_CELL), j1 = Math.floor(Math.max(z0, z1) / INDEX_CELL);
  if (i0 === i1 && j0 === j1) return cells.get(cellKey(i0, j0)) ?? NONE;
  scratch.length = 0;
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const l = cells.get(cellKey(i, j)); if (l) for (const o of l) scratch.push(o); }
  return scratch;
}

/** The squares where nothing hostile lives or fights: every region's `safe` circle. */
export const SAFE_ZONES: { x: number; z: number; r: number }[] = REGIONS.flatMap(r => r.safe ?? []);
export const inSafeZone = (x: number, z: number) => SAFE_ZONES.some(c => Math.hypot(x - c.x, z - c.z) <= c.r);

/**
 * What stands tall enough to break a line of sight (see sim/sight.ts): the forge, the rocks either side of the cave
 * mouth, tree trunks and the cave's standing stones. Ore seams are waist-high and the quest giver is a person:
 * neither hides anything behind it, so neither is here.
 */
export const SIGHT_BLOCKERS: Obstacle[] = [...REGIONS.flatMap(r => r.tall), ...REGIONS.flatMap(r => r.trees)];

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
    for (const o of collidersAt(p.x, p.z)) {
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

/** Take scenery added by addScenery away again: out of its region, the flat lists and the colliders. */
export function removeScenery(regionId: string, spot: Obstacle | RockSpot) {
  const r = regionById(regionId), drop = (list: Obstacle[]) => { const i = list.indexOf(spot); if (i >= 0) list.splice(i, 1); };
  drop(r.rocks); drop(r.trees); drop(ROCKS); drop(CAVE_ROCKS); drop(TREES); drop(COLLIDERS);
}
