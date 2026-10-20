// The world as data: a list of regions, each with a walkable footprint, its own scenery and its connections to its neighbours.
// Everything else in this file (and the flat lists the renderer and sim read) is derived from REGIONS. Routing lives in path.ts.
// Shared by sim (collision, routing) and renderer (drawing).
//
// The world is one continuous coordinate space: regions sit at offsets in it and overlap at their seams, so the player walks from
// one to the next with no transition. What keeps that affordable is that nothing reads the whole world per call: colliders are looked
// up by position (collidersAt / collidersIn), routing builds one grid per zone on demand and evicts (path.ts), and the sim and the
// renderer skip what is far from the player (sim.ts, world-view.ts).

export const PLAYER_RADIUS = 0.5;

/** What an obstacle is, for whatever draws it: the sim only ever reads the circle. Absent means a rock (or, in the clearing, whatever it always was). */
export type PropKind = 'rock' | 'tree' | 'hut' | 'cart' | 'house' | 'inn' | 'hull' | 'crate' | 'person' | 'grave' | 'thornoak' | 'alembic';
export interface Obstacle { x: number; z: number; r: number; kind?: PropKind }
export interface Rect { x0: number; x1: number; z0: number; z1: number }
export interface Pt { x: number; z: number }

/** A hard gate (design 1.3): a line across an opening that turns back a player below `combat` with `keeper`'s words. The player stands on side `from` of it (-1: the lower coordinate). */
export interface Gate {
  id: string;
  axis: 'x' | 'z';
  /** The line's coordinate on `axis`, and the stretch of the other axis the opening covers. */
  at: number;
  span: [number, number];
  from: -1 | 1;
  combat: number;
  keeper: string;
  /** Where the keeper stands: a person you cannot walk through, beside the opening. */
  post: Pt;
  /** What the keeper says to a player under `combat`. */
  refuse: string;
  /** Set when nothing lies behind the gate yet: even a player who has the level is told this and kept back. */
  closed?: string;
}
// Ore rocks (gatherable, see sim/gathering.ts).
export interface RockSpot extends Obstacle { type: 'copper' | 'tin' | 'iron' | 'coal' | 'mithril' | 'adamant' }

/** A gathering spot you stand beside and cannot stand on: a shoal in the water. Unlike a rock it is not a collider. `type` is a NODE_TYPES key. */
export interface NodeSpot extends Obstacle { type: string }
const HERB_RADIUS = 1;
export interface HerbSpot { kind: 'fen' | 'thorn'; type: string; x: number; z: number }

export interface Region {
  id: string;
  name: string;
  /** Underground: dark, echoing, and walled by the footprint's edges. */
  cave: boolean;
  /** A dungeon's room: the id of the DUNGEONS entry this region is one room of. Every `cave` region has one; the dungeon is read off these. */
  dungeon?: string;
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
  /** Fishing spots: nodes with no collider, after the rocks and trees in node-id order. */
  spots?: NodeSpot[];
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
  /** The line the road runs along, if there is one: down x = `at` when axis is 'z' (a road running north to south), along z = `at` when it is 'x'. Drawing only. */
  road?: { axis: 'x' | 'z'; at: number };
  /** Withering Ground: standing in one of these hurts (sim/hazards.ts), and the renderer draws each with the telegraph circle of a boss's ground mark. World coordinates. */
  hazards?: { x: number; z: number; r: number }[];
  /** Herb patches: gathering nodes (after the region's `spots`) with no collider. `kind` picks the look, `type` the herb (a NODE_TYPES row, herbs.ts). */
  herbs?: HerbSpot[];
  gates?: Gate[];
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
  /** The flight master, just inside the east gate (design 5.1): the first thing the road's far end shows you too. */
  flightHale: { x: 26, z: 1, r: 0.7 },
};
const ridgeLandmarks = { caveMouth: { x: -18, z: -24 } };

/** Hale's east gate: a 6-unit gap in the clearing's wall at x = 30, between the tree at (22, 12) and the forge's row. Its seam point is just inside. */
const HALE_GATE: Pt = { x: 29, z: 8 };

/** Where each new region's own frame sits in the world. Local coordinates (the design bible's) are offsets from these. */
export const GREYWATER = { x: 436, z: 8 };   // 800 x 120, road along its z = 0; local x -400 is the Hale gate (world 36), +400 the Saltmarrow one
export const SALTMARROW = { x: 906, z: 8 };  // 140 x 140; the town is its west half, the Strand its south and east, the sea beyond x = +30
export const DUNMERE = { x: 875, z: 524 };   // 140 wide, 848 long (z 100 to 948), the road down its x = 0; a 6-unit corridor north, through Saltmarrow's south edge, is the gate
export const THORNWICK = { x: 875, z: 1008 }; // 140 x 140; the town is its north-west, the Thornwood its south and east; the road comes in at the middle of its north edge
const at =(o: Pt, lx: number, lz: number) => ({ x: o.x + lx, z: o.z + lz });
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
function verge(o: Pt, spawns: Pt[], extra: Obstacle[], run: { axis: 'x' | 'z'; reach: number; near: number; far: number } = { axis: 'x', reach: 380, near: 12, far: 38 }): { obstacles: Obstacle[]; tall: Obstacle[] } {
  const obstacles: Obstacle[] = [...extra], tall: Obstacle[] = extra.filter(e => e.r >= 1.8);
  for (let k = 0; k < Math.ceil(run.reach * 2 / 5.3); k++) {
    const lx = -run.reach + k * 5.3 + (hash(k * 3 + 1) - 0.5) * 4;
    if (lx > run.reach || hash(k * 17 + 5) < 0.35) continue;
    const lz = (hash(k * 7 + 2) < 0.5 ? -1 : 1) * (run.near + hash(k * 11 + 3) * run.far);
    const tree = hash(k * 5 + 4) < 0.4, r = tree ? 0.9 : 1.2 + hash(k * 13 + 6) * 1.2, c = run.axis === 'x' ? at(o, lx, lz) : at(o, lz, lx);
    if (spawns.some(sp => Math.hypot(sp.x - c.x, sp.z - c.z) < 11) || extra.some(e => Math.hypot(e.x - c.x, e.z - c.z) < e.r + r + 2)) continue;
    const ob: Obstacle = { x: c.x, z: c.z, r, kind: tree ? 'tree' : 'rock' };
    obstacles.push(ob);
    if (tree || r >= 1.8) tall.push(ob);
  }
  return { obstacles, tall };
}

const roadSpawns = worldSpawns(GREYWATER, GREYWATER_SPAWNS);
const roadProps: Obstacle[] = [
  { ...at(GREYWATER, 66, -15), r: 2.6, kind: 'hut' },   // the toll hut, beside the road
  { ...at(GREYWATER, 53, 12), r: 1.4, kind: 'cart' },   // the toll cart
  { ...at(GREYWATER, 330, -38), r: 3.2 },  // the rock Old Grey lies behind, seen from the road
  { ...at(GREYWATER, 336, -52), r: 2.4 },
];
const road = verge(GREYWATER, roadSpawns, roadProps);

/** The town's buildings: the inn (The Gilded Gull) and the houses round the square. */
const SALT_INN: Obstacle = { ...at(SALTMARROW, -10, -16), r: 4.6, kind: 'inn' };
const SALT_HOUSES: Obstacle[] = [
  { ...at(SALTMARROW, -48, -24), r: 3.2, kind: 'house' }, { ...at(SALTMARROW, -50, 22), r: 3.2, kind: 'house' }, { ...at(SALTMARROW, -6, 26), r: 3.2, kind: 'house' }, { ...at(SALTMARROW, -42, -42), r: 3, kind: 'house' },
];
/** Beached hulls, the quay's crates, and the cliff rock the Strand's rare lurks behind. */
const SALT_PROPS: Obstacle[] = [
  { ...at(SALTMARROW, 22, -20), r: 2.4, kind: 'hull' }, { ...at(SALTMARROW, 24, 28), r: 2.4, kind: 'hull' },
  { ...at(SALTMARROW, 24, -5.5), r: 0.9, kind: 'crate' }, { ...at(SALTMARROW, 24, 5.5), r: 0.9, kind: 'crate' },
  { ...at(SALTMARROW, -58, -52), r: 2.6 }, { ...at(SALTMARROW, -30, 36), r: 1.6 }, { ...at(SALTMARROW, -2, -50), r: 1.8 },
  { ...at(SALTMARROW, 12, 40), r: 1.6 }, { ...at(SALTMARROW, -40, 62), r: 2 }, { ...at(SALTMARROW, 28, 8), r: 1.2 }, { ...at(SALTMARROW, 8, 66), r: 2.2 },
];
const saltLandmarks = {
  square: at(SALTMARROW, -25, 0),
  harbourmaster: { ...at(SALTMARROW, -20, 4), r: 0.7 },
  harbourVendor: { ...at(SALTMARROW, -30, 6), r: 0.7 },
  trainer: { ...at(SALTMARROW, -26, -8), r: 0.7 },
  inn: { x: SALT_INN.x, z: SALT_INN.z },
  /** The cooking range, in the inn. */
  range: at(SALTMARROW, -10, -9),
  /** The flight master, just inside the gate from the road. */
  flightSalt: { ...at(SALTMARROW, -54, -5), r: 0.7 },
  /** The quay's root and its end. */
  quayRoot: at(SALTMARROW, 16, 0),
  quayEnd: at(SALTMARROW, 62, 0),
};

/**
 * The graveyards (the bible, on the cost of dying): where a death wakes you. Hale's is in the clearing's north-west corner, Saltmarrow's at the end of the road
 * beside the west gate, each out past its town's own ground so the walk back is the cost. A small safe circle keeps whatever stands near
 * from taking you the moment you wake. The headstones are obstacles (a ring round the spot, never on it).
 */
const graveHale: Pt = { x: -20, z: 26 }, graveSalt: Pt = at(SALTMARROW, -62, 12);
const GRAVE_SAFE_R = 6;
const headstones = (c: Pt): Obstacle[] => [[2.6, 0.4], [3.4, 1.9], [2.8, 3.5], [3.2, 5.1], [2.7, 6.0]]
  .map(([d, a]) => ({ x: c.x + Math.cos(a) * d, z: c.z + Math.sin(a) * d, r: 0.5, kind: 'grave' as const }));
const HALE_HEADSTONES = headstones(graveHale), SALT_HEADSTONES = headstones(graveSalt);

/**
 * Saltmarrow's fishing, by the bible (2.2): silverfin off the quay, brine trout in the shallows past its end, saltpike in the wreck pools on the
 * Strand. The shoals sit in the water a pace off the edge, so the player stands on the quay or the shore to fish. Local coordinates.
 */
const SALT_SPOTS: NodeSpot[] = ([
  ['silverfin', 28, -4.2], ['silverfin', 40, 4.2], ['silverfin', 52, -4.2],
  ['brine_trout', 64, 0], ['brine_trout', 60, 4.8],
  ['saltpike', 12, -30], ['saltpike', 15, -25.5],
] as const).map(([type, lx, lz]) => ({ type, ...at(SALTMARROW, lx, lz), r: 1 }));

/**
 * The Drowned Grotto (bible 1.2): three rooms in a cliff on Saltmarrow's north edge, in the town's own frame (local coordinates). The way in is a door
 * at local (-42.5, -70), through the wall the town's floor ends in. The rooms step across so that each pair overlaps by a doorway and no more.
 */
const rectAt = (o: Pt, x0: number, x1: number, z0: number, z1: number): Rect => ({ x0: o.x + x0, x1: o.x + x1, z0: o.z + z0, z1: o.z + z1 });
const GROTTO_DOOR = at(SALTMARROW, -42.5, -69);
const GALLEY_DOOR = at(SALTMARROW, -42.5, -89);
const HOLD_DOOR = at(SALTMARROW, -27, -109);
const GALLEY_STONES: Obstacle[] = [at(SALTMARROW, -40, -97), at(SALTMARROW, -30, -94), at(SALTMARROW, -36, -105)].map(p => ({ ...p, r: 1.4 }));
const HOLD_STONES: Obstacle[] = [at(SALTMARROW, -26, -118), at(SALTMARROW, -12, -118), at(SALTMARROW, -26, -128), at(SALTMARROW, -12, -128)].map(p => ({ ...p, r: 1.6 }));

/**
 * The road's waysides: [local x, side of the road, nodes from the road's edge outward along it]. Each stand is three or four nodes a few units apart.
 * Hale has copper and nothing else (HOM-77), so the road is where the metal ladder actually climbs: tin and iron on the first stands past the east
 * gate, coal from the second on, and the far stands the richest. The stands and their geometry are unchanged; only what is in them moved.
 */
const WAYSIDES: [number, 1 | -1, ('copper' | 'tin' | 'iron' | 'coal' | 'tree')[]][] = [
  [-350, 1, ['tin', 'iron', 'tree']], [-230, -1, ['tree', 'tin', 'coal', 'tree']], [-120, 1, ['copper', 'iron', 'tree']],
  [-20, -1, ['tin', 'coal', 'tree']], [120, 1, ['tree', 'iron', 'copper', 'tree']], [230, -1, ['iron', 'coal', 'tree']],
  [300, 1, ['copper', 'iron', 'coal', 'tree']], [365, -1, ['copper', 'tree', 'coal']],
];
function waysides(): { rocks: RockSpot[]; trees: Obstacle[] } {
  const rocks: RockSpot[] = [], trees: Obstacle[] = [];
  for (const [lx, side, kinds] of WAYSIDES) kinds.forEach((type, i) => {
    const p = at(GREYWATER, lx + (i - (kinds.length - 1) / 2) * 3.6, side * (9 + (i % 2) * 2));
    if (type === 'tree') trees.push({ ...p, r: 1 }); else rocks.push({ type, ...p, r: 1.2 });
  });
  return { rocks, trees };
}

/**
 * Dunmere Fens (bible 3.4): a quarter-hour of road south, the first ground where standing still hurts. The road is x = 0 (local), every camp sits
 * 22 or more off it so a walker is never pulled in, and the levels climb north to south: stalker pairs and the first witches at 17 and 18, trolls at
 * 20, the Bogfather holding the road's last stretch, Mother Mire in the south-west corner. Local coordinates: z runs from the Saltmarrow gate (-424)
 * to Thornwick (+424).
 */
const DUNMERE_SPAWNS = [
  ['fen_stalker', -24, -372], ['fen_stalker', -22.4, -370.8],
  ['fen_stalker', 26, -304], ['fen_stalker', 27.6, -302.8],
  ['bog_witch', 32, -250],
  ['fen_stalker', -28, -226], ['fen_stalker', -26.4, -224.8],
  ['bog_witch', -34, -160],
  ['fen_stalker', 24, -124], ['fen_stalker', 25.6, -122.8],
  ['bog_witch', 30, -66],
  ['mire_troll', -30, -20], ['mire_troll', 28, 34],
  ['fen_stalker', -26, 84], ['fen_stalker', -24.4, 85.2],
  ['bog_witch', 36, 126], ['bog_witch', -38, 170],
  ['mire_troll', 30, 214], ['mire_troll', -28, 256],
  ['bog_witch', -34, 302],
  ['bogfather', 22, 340],
  ['mother_mire', -56, 392],
] as const;
const dunmereSpawns = worldSpawns(DUNMERE, DUNMERE_SPAWNS);

/**
 * Withering Ground: nineteen stained patches of fen, none within ten of the road, none on a camp. Standing in one drains health a second
 * (sim/hazards.ts); the renderer draws each as the ground circle of a boss's mark. Every third has a fenbloom growing at its rim.
 */
function witheringPatches(spawns: Pt[]): { hazards: { x: number; z: number; r: number }[]; herbs: HerbSpot[] } {
  const hazards: { x: number; z: number; r: number }[] = [], herbs: HerbSpot[] = [];
  for (let i = 0; i < 19; i++) {
    const lz = -400 + i * 44 + (hash(i * 5 + 1) - 0.5) * 16, r = 5 + hash(i * 3 + 2) * 3.5, off = 24 + hash(i * 7 + 3) * 28;
    const spot = [1, -1].map(side => at(DUNMERE, (i % 2 ? 1 : -1) * side * off, lz)).find(c => spawns.every(sp => Math.hypot(sp.x - c.x, sp.z - c.z) > r + 12));
    if (!spot) continue;
    hazards.push({ ...spot, r });
    if (i % 3 === 0) herbs.push({ kind: 'fen', type: 'fenbloom', x: spot.x + r * 0.9, z: spot.z + r * 0.3 });
  }
  return { hazards, herbs };
}
/** Fenbloom along the verges, in threes: a walker sees one cluster from the last. */
function fenHerbs(hazards: { x: number; z: number; r: number }[]): HerbSpot[] {
  const out: HerbSpot[] = [];
  for (let j = 0; j < 12; j++) for (let k = 0; k < 3; k++) {
    const c = at(DUNMERE, (j % 2 ? 1 : -1) * (13 + hash(j * 3 + 1) * 5 + k * 1.8), -390 + j * 68 + k * 2.2 + hash(j + k) * 6);
    if (!hazards.some(h => Math.hypot(h.x - c.x, h.z - c.z) < h.r + 1)) out.push({ kind: 'fen', type: 'fenbloom', ...c });
  }
  return out;
}
const withering = witheringPatches(dunmereSpawns);
const fen = verge(DUNMERE, dunmereSpawns, [], { axis: 'z', reach: 410, near: 14, far: 46 });

/** The gate in the corridor south of Saltmarrow (the strip x 872 to 878 of Dunmere's footprint): the line the keeper holds. */
const SALT_GATE: Gate = {
  id: 'dunmere', axis: 'z', at: 90, span: [DUNMERE.x - 3, DUNMERE.x + 3], from: -1, combat: 16, keeper: 'Marshwarden Quill', post: { x: DUNMERE.x - 2, z: 87.6 },
  refuse: 'Halt. The Dunmere Fens eat anyone who goes in under combat level 16. Hunt the Strand a while, then come back.',
};

/** Thornwick (bible 2.1): the town is the north-west, a safe circle of 35 about the square; the Thornwood fills the rest. Local coordinates. */
const THORN_SPAWNS = [
  ['thornback', -56, 28], ['thornback', -48, 40], ['thornback', -58, 50],
  ['blight_stag', 50, -40], ['blight_stag', 56, -26], ['blight_stag', 44, 30],
  ['rotwood_cultist', -30, 60], ['rotwood_cultist', 20, 58], ['rotwood_cultist', 58, 40], ['rotwood_cultist', 46, -6],
  ['thorn_warden', 4, 62],
  ['elder_thornback', -62, 62],
] as const;
const thornSpawns = worldSpawns(THORNWICK, THORN_SPAWNS);
const THORN_HOUSES: Obstacle[] = [[-30, -34], [30, -38], [-36, -4], [32, 6], [-12, 14]].map(([lx, lz]) => ({ ...at(THORNWICK, lx, lz), r: 3.1, kind: 'house' as const }));
const thornLandmarks = {
  thornSquare: at(THORNWICK, 0, -18),
  thornReeve: { ...at(THORNWICK, -8, -24), r: 0.7 },
  thornVendor: { ...at(THORNWICK, -16, -12), r: 0.7 },
  /** The trainer, a little way off the square on the west side: Guard is bought here. */
  thornTrainer: { ...at(THORNWICK, -22, -24), r: 0.7 },
  /** The stablemaster, beside the trainer on the west side: the first mount is bought here. */
  thornStable: { ...at(THORNWICK, -22, -34), r: 0.7 },
  /** The flight master, just inside the town from the north road. */
  flightThorn: { ...at(THORNWICK, 10, -52), r: 0.7 },
  /** The alchemist's bench: a station, for the card that teaches alchemy. */
  alembic: at(THORNWICK, 14, -8),
};
const THORN_ALEMBIC: Obstacle = { ...thornLandmarks.alembic, r: 1.3, kind: 'alembic' };
const graveThorn: Pt = at(THORNWICK, -44, -50);
const THORN_HEADSTONES = headstones(graveThorn);
/**
 * The Rotroot (bible 1.2): three rooms under the Thornwood's south edge, in Thornwick's frame (local coordinates). It is the Grotto's plan turned about
 * (door at the south edge, rooms stepping west), so the same rules and the same hand-built fine routing grid serve it: each pair of rooms overlaps by a doorway and no more.
 */
const ROTROOT_DOOR = at(THORNWICK, 42.5, 69);
const WARREN_DOOR = at(THORNWICK, 42.5, 89);
const HEART_DOOR = at(THORNWICK, 27, 109);
const WARREN_STONES: Obstacle[] = [at(THORNWICK, 40, 97), at(THORNWICK, 30, 94), at(THORNWICK, 36, 105)].map(p => ({ ...p, r: 1.4 }));
const HEART_STONES: Obstacle[] = [at(THORNWICK, 26, 118), at(THORNWICK, 12, 118), at(THORNWICK, 26, 128), at(THORNWICK, 12, 128)].map(p => ({ ...p, r: 1.6 }));
/** The Thornwood: thornoaks wherever there is room, which is most places outside the town. Deterministic, 5 apart, clear of camps, the gate, the Rotroot's mouth and the town's own ground. */
function thornwood(): Obstacle[] {
  const out: Obstacle[] = [], sq = thornLandmarks.thornSquare;
  for (let k = 0; k < 400 && out.length < 70; k++) {
    const c = at(THORNWICK, (hash(k * 3 + 1) - 0.5) * 132, (hash(k * 5 + 2) - 0.5) * 132);
    if (Math.hypot(c.x - sq.x, c.z - sq.z) < 41 || Math.hypot(c.x - graveThorn.x, c.z - graveThorn.z) < 12 || Math.abs(c.x - THORNWICK.x) < 7 && c.z < THORNWICK.z - 20) continue;
    if (Math.hypot(c.x - ROTROOT_DOOR.x, c.z - ROTROOT_DOOR.z) < 8) continue;
    if (thornSpawns.some(sp => Math.hypot(sp.x - c.x, sp.z - c.z) < 9) || Math.hypot(c.x - (THORNWICK.x + 63), c.z - THORNWICK.z) < 12) continue;
    if (out.some(o => Math.hypot(o.x - c.x, o.z - c.z) < 6)) continue;
    out.push({ ...c, r: 1.3, kind: 'thornoak' });
  }
  return out;
}
const THORNWOODS = thornwood();
/** The garden by the alembic (Marrowleaf, the first six: the one herb a new gatherer can pick), and Thornmint wherever the wood thins. */
const THORN_HERBS: HerbSpot[] = [[22, -30], [25, -26], [28, -32], [24, -22], [20, -24], [29, -20], [-52, 8], [-44, 20], [40, 50], [52, 18], [-20, 44], [8, 36], [30, 24], [-62, 36]]
  .map(([lx, lz], i) => ({ kind: 'thorn' as const, type: i < 6 ? 'marrowleaf' : 'thornmint', ...at(THORNWICK, lx, lz) }));
/** The east gate, onto the road to the Barrowdowns: refuses everyone for now, since nothing is built behind it. */
const THORN_GATE: Gate = {
  id: 'barrowdowns', axis: 'x', at: THORNWICK.x + 63, span: [THORNWICK.z - 3, THORNWICK.z + 3], from: -1, combat: 22, keeper: 'Gatewarden Hobb', post: { x: THORNWICK.x + 60.6, z: THORNWICK.z - 4 },
  refuse: 'The barrow road is for those of combat level 22 and over. Come back when you are one of them.',
  closed: 'The road to the Barrowdowns is shut. Nobody who went up it has come back to say why.',
};

/**
 * The world. Order matters: node ids follow region order (each region's rocks, then its trees), so new ground goes last and every
 * older node keeps its id (and its save). The ridge is first because its ore was always the first nodes.
 * The cave's rooms overlap the clearing and each other, so the way in is continuous.
 */
export const REGIONS: Region[] = [
  {
    // The rock face along the clearing's southern edge, with the cave mouth gap through it. It held the iron and coal until HOM-77 moved
    // them out to the Greywater Road: Hale's rocks are copper and nothing else now, so the ladder starts here and climbs elsewhere.
    // The three that stay keep their old places, outside the Cave Brute's aggro radius so mining is not a death trap.
    // A district of the clearing: it adds no floor of its own.
    id: 'ridge', name: 'The Ridge', cave: false, zone: 'hale', cell: 0.25,
    footprint: [{ x0: -24, x1: 2, z0: -30, z1: -22 }],
    obstacles: MOUTH_WALLS, tall: MOUTH_WALLS, trees: [],
    rocks: [
      { type: 'copper', x: -10, z: -25.5, r: 1.2 }, { type: 'copper', x: -5, z: -27.5, r: 1.2 }, { type: 'copper', x: -1, z: -28.5, r: 1.2 },
    ],
    landmarks: ridgeLandmarks,
    connections: [{ to: 'clearing', at: { x: -18, z: -22 } }, { to: 'throat', at: { x: -18, z: -26 } }],
  },
  {
    // The outdoor square. Its half-side is live (setWorldHalf), so this rect is mutated in place.
    id: 'clearing', name: 'The Clearing', cave: false, zone: 'hale', cell: 0.25,
    footprint: [{ x0: -30, x1: 30, z0: -30, z1: 30 }],
    obstacles: [FORGE_BUILDING, { x: 5, z: 2, r: 0.7 }, { x: -5, z: 3, r: 0.7 }, clearingLandmarks.flightHale, ...HALE_HEADSTONES], // forge building, quest giver, the merchant, the flight master, the graveyard's stones
    tall: [FORGE_BUILDING], // the one outdoor thing big enough to hide behind
    trees: [
      { x: -12, z: 10, r: 1 }, { x: -20, z: 4, r: 1 }, { x: -8, z: 20, r: 1 },
      { x: 10, z: 18, r: 1 }, { x: 22, z: 12, r: 1 }, { x: 14, z: -20, r: 1 },
      { x: 4, z: -18, r: 1 }, { x: -24, z: -8, r: 1 }, { x: 26, z: 24, r: 1 },
      { x: -26, z: 22, r: 1 }, { x: 8, z: 26, r: 1 }, { x: 28, z: -20, r: 1 },
    ],
    rocks: [],
    landmarks: clearingLandmarks,
    connections: [{ to: 'ridge', at: { x: -18, z: -22 } }, { to: 'greywater', at: HALE_GATE }, { to: 'seams', at: { x: 26, z: -12 } }],
    // Hale's safe ground is the smithy's yard, not the whole square: Hale's own enemies live in the clearing (the nearest boar is 8 from the forge)
    // and its golden-path fights are fought on the middle of it, so a town-sized circle here would be a different game. Saltmarrow's is the real thing.
    safe: [{ x: 20, z: -8, r: 4 }, { ...graveHale, r: GRAVE_SAFE_R }],
  },
  {
    // The throat runs north from the mouth.
    id: 'throat', name: 'The Throat', cave: true, dungeon: 'hollow', zone: 'hale', cell: 0.25,
    footprint: [{ x0: -20.5, x1: -15.5, z0: -46, z1: -24 }],
    obstacles: [], tall: [], trees: [], rocks: [], landmarks: {},
    connections: [{ to: 'ridge', at: { x: -18, z: -26 } }, { to: 'hollow', at: { x: -18, z: -44 } }],
  },
  {
    // The hollow is the main cavern. Standing stones are cover, and something to circle. The three veins make a seam along the south-west wall,
    // in reach of the Ravager pack that guards them and of nothing else. Its coal went out to the road with the ridge's (HOM-77): the nearest
    // seam to the forge must not be one a player on the first quest has to walk past the Brute to reach.
    id: 'hollow', name: 'The Hollow', cave: true, dungeon: 'hollow', zone: 'hale', cell: 0.25,
    footprint: [{ x0: -33, x1: -5, z0: -64, z1: -42 }],
    obstacles: [{ x: -14.5, z: -50, r: 1.4 }, { x: -27, z: -57, r: 1.4 }, { x: -9, z: -55, r: 1.4 }],
    tall: [], trees: [],
    rocks: [
      { type: 'mithril', x: -29.2, z: -45.5, r: 1.2 }, { type: 'mithril', x: -29.2, z: -47.9, r: 1.2 }, { type: 'mithril', x: -29.2, z: -50.3, r: 1.2 },
    ],
    landmarks: {},
    connections: [{ to: 'throat', at: { x: -18, z: -44 } }, { to: 'neck', at: { x: -18, z: -62 } }],
  },
  {
    // The neck leads on to the warden's hall.
    id: 'neck', name: 'The Neck', cave: true, dungeon: 'hollow', zone: 'hale', cell: 0.25,
    footprint: [{ x0: -20.5, x1: -15.5, z0: -76, z1: -60 }],
    obstacles: [], tall: [], trees: [], rocks: [], landmarks: {},
    connections: [{ to: 'hollow', at: { x: -18, z: -62 } }, { to: 'hall', at: { x: -18, z: -73 } }],
  },
  {
    id: 'hall', name: "The Warden's Hall", cave: true, dungeon: 'hollow', zone: 'hale', cell: 0.25,
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
    road: { axis: 'x', at: GREYWATER.z },
    connections: [{ to: 'clearing', at: HALE_GATE }, { to: 'saltmarrow', at: at(GREYWATER, 405, 0) }, { to: 'wayside', at: at(GREYWATER, -350, 0) }],
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
    obstacles: [SALT_INN, ...SALT_HOUSES, ...SALT_PROPS, { ...saltLandmarks.harbourmaster, kind: 'person' }, { ...saltLandmarks.harbourVendor, kind: 'person' }, { ...saltLandmarks.flightSalt, kind: 'person' }, { ...saltLandmarks.trainer, kind: 'person' }, ...SALT_HEADSTONES],
    tall: [SALT_INN, ...SALT_HOUSES, SALT_PROPS[4]], trees: [],
    rocks: [-14, -8, -2, 4, 10].map((lx, i) => ({ type: 'adamant' as const, ...at(SALTMARROW, lx, i % 2 ? -66 : -64), r: 1.2 })),
    spots: SALT_SPOTS,
    landmarks: saltLandmarks,
    connections: [{ to: 'greywater', at: at(GREYWATER, 405, 0) }, { to: 'dunmere', at: { x: DUNMERE.x, z: 76 } }, { to: 'gangway', at: GROTTO_DOOR }],
    safe: [{ ...saltLandmarks.square, r: 35 }, { ...graveSalt, r: GRAVE_SAFE_R }],
    spawns: worldSpawns(SALTMARROW, STRAND_SPAWNS),
  },
  {
    // The bottom of the metal ladder (HOM-56): rocks a level-1 character meets in the open. Two by the forge, in the clearing's north-east corner
    // (the nearest enemy, the wolf at (14, -15), is ten away and aggroes at eight); one at the ridge's east end, clear of the Cave Brute and the
    // wolves. Copper only since HOM-77: the tin went out to the road's first wayside, so the first bronze bar is already a walk east.
    // A district of the clearing: it adds no floor of its own.
    id: 'seams', name: 'The Seams', cave: false, zone: 'hale', cell: 0.25,
    footprint: [{ x0: 22, x1: 30, z0: -20, z1: -8 }, { x0: 3, x1: 11, z0: -29.5, z1: -23 }],
    obstacles: [], tall: [], trees: [],
    rocks: [
      { type: 'copper', x: 27, z: -13.5, r: 1.2 }, { type: 'copper', x: 24.5, z: -17.5, r: 1.2 },
      { type: 'copper', x: 4.5, z: -26.5, r: 1.2 },
    ],
    landmarks: {},
    connections: [{ to: 'clearing', at: { x: 26, z: -12 } }],
  },
  {
    // The road's waysides (HOM-57): eight small stands of ore and a tree or two, one every hundred units, alternating sides, a pace or so off the
    // road (the verges start twelve out) and clear of every camp's aggro, so a walker can work them as they pass. Since HOM-77 they carry the whole
    // ladder above copper: tin and iron from the first stand past Hale's gate, coal from the second, the richest at the Saltmarrow end.
    // Listed last (after the Seams) so every older node keeps its id and its save. A district of the road: it adds no floor of its own.
    id: 'wayside', name: 'The Waysides', cave: false, zone: 'greywater',
    footprint: [{ x0: GREYWATER.x - 400, x1: GREYWATER.x + 400, z0: GREYWATER.z - 12, z1: GREYWATER.z + 12 }],
    obstacles: [], tall: [],
    ...waysides(),
    landmarks: {},
    connections: [{ to: 'greywater', at: at(GREYWATER, -350, 0) }],
  },
  {
    // Dunmere Fens: the road south from Saltmarrow to Thornwick. Its main floor is 140 x 848 and the road runs down its middle; a 6-unit corridor
    // north through Saltmarrow's south edge is the hard gate (combat 16). Its south end overlaps Thornwick across the whole width: soft.
    id: 'dunmere', name: 'Dunmere Fens', cave: false, zone: 'dunmere',
    footprint: [
      { x0: DUNMERE.x - 70, x1: DUNMERE.x + 70, z0: 100, z1: 948 },
      { x0: DUNMERE.x - 3, x1: DUNMERE.x + 3, z0: 70, z1: 106 },
    ],
    obstacles: [...fen.obstacles, { ...SALT_GATE.post, r: 0.55, kind: 'person' }], tall: fen.tall, trees: [], rocks: [],
    landmarks: { gate: { x: DUNMERE.x, z: SALT_GATE.at } },
    connections: [{ to: 'saltmarrow', at: { x: DUNMERE.x, z: 76 } }, { to: 'thornwick', at: { x: THORNWICK.x, z: 943 } }],
    spawns: dunmereSpawns,
    road: { axis: 'z', at: DUNMERE.x },
    hazards: withering.hazards,
    herbs: [...withering.herbs, ...fenHerbs(withering.hazards)],
    gates: [SALT_GATE],
  },
  {
    // Thornwick and the Thornwood. The town is safe ground: no spawns, no aggro. The thornoaks have no woodcutting rung yet (Woodcutting has one tree),
    // so they are scenery that stops you; the herb patches are Herbalism nodes. The Rotroot's mouth and the Barrowdowns road are later cards.
    id: 'thornwick', name: 'Thornwick', cave: false, zone: 'thornwick',
    footprint: [{ x0: THORNWICK.x - 70, x1: THORNWICK.x + 70, z0: THORNWICK.z - 70, z1: THORNWICK.z + 70 }],
    obstacles: [
      ...THORN_HOUSES, THORN_ALEMBIC, ...THORNWOODS, ...THORN_HEADSTONES, { ...THORN_GATE.post, r: 0.55, kind: 'person' },
      { ...thornLandmarks.thornReeve, kind: 'person' }, { ...thornLandmarks.thornVendor, kind: 'person' }, { ...thornLandmarks.flightThorn, kind: 'person' }, { ...thornLandmarks.thornTrainer, kind: 'person' }, { ...thornLandmarks.thornStable, kind: 'person' },
    ],
    tall: [...THORN_HOUSES, ...THORNWOODS],
    trees: [], rocks: [],
    landmarks: thornLandmarks,
    connections: [{ to: 'dunmere', at: { x: THORNWICK.x, z: 943 } }, { to: 'mouth', at: ROTROOT_DOOR }],
    safe: [{ ...thornLandmarks.thornSquare, r: 35 }, { ...graveThorn, r: GRAVE_SAFE_R }],
    spawns: thornSpawns,
    herbs: THORN_HERBS,
    gates: [THORN_GATE],
  },
  {
    // The Drowned Grotto (HOM-64), listed last so every older node and enemy keeps its id. Its own routing zone at the cave's fine cell: the town's zone is coarse.
    // The gangway holds the sentry hag, the galley the two ogres and a hag, the hold the Captain.
    id: 'gangway', name: 'The Gangway', cave: true, dungeon: 'grotto', zone: 'grotto', cell: 0.25,
    footprint: [rectAt(SALTMARROW, -45, -40, -90, -68)],
    obstacles: [], tall: [], trees: [], rocks: [], landmarks: {},
    connections: [{ to: 'saltmarrow', at: GROTTO_DOOR }, { to: 'galley', at: GALLEY_DOOR }],
    spawns: worldSpawns(SALTMARROW, [['tide_hag', -42.5, -80]]),
  },
  {
    id: 'galley', name: 'The Galley', cave: true, dungeon: 'grotto', zone: 'grotto', cell: 0.25,
    footprint: [rectAt(SALTMARROW, -46, -24, -110, -88)],
    obstacles: GALLEY_STONES, tall: [], trees: [], rocks: [], landmarks: {},
    connections: [{ to: 'gangway', at: GALLEY_DOOR }, { to: 'hold', at: HOLD_DOOR }],
    spawns: worldSpawns(SALTMARROW, [['barnacle_ogre', -31, -101], ['barnacle_ogre', -41, -108], ['tide_hag', -34, -91]]),
  },
  {
    id: 'hold', name: "Marrow's Hold", cave: true, dungeon: 'grotto', zone: 'grotto', cell: 0.25,
    footprint: [rectAt(SALTMARROW, -30, -8, -134, -108)],
    obstacles: HOLD_STONES, tall: [], trees: [], rocks: [], landmarks: {},
    connections: [{ to: 'galley', at: HOLD_DOOR }],
    spawns: worldSpawns(SALTMARROW, [['captain_marrow', -19, -126]]),
  },
  {
    // The Rotroot (HOM-75), after the Grotto for the same reason. The mouth holds the cult's sentry, the warren a Thorn Warden and two more of them, the heart the Mother.
    id: 'mouth', name: 'The Mouth', cave: true, dungeon: 'rotroot', zone: 'rotroot', cell: 0.25,
    footprint: [rectAt(THORNWICK, 40, 45, 68, 90)],
    obstacles: [], tall: [], trees: [], rocks: [], landmarks: {},
    connections: [{ to: 'thornwick', at: ROTROOT_DOOR }, { to: 'warren', at: WARREN_DOOR }],
    spawns: worldSpawns(THORNWICK, [['rotwood_cultist', 42.5, 80]]),
  },
  {
    id: 'warren', name: 'The Root Warren', cave: true, dungeon: 'rotroot', zone: 'rotroot', cell: 0.25,
    footprint: [rectAt(THORNWICK, 24, 46, 88, 110)],
    obstacles: WARREN_STONES, tall: [], trees: [], rocks: [], landmarks: {},
    connections: [{ to: 'mouth', at: WARREN_DOOR }, { to: 'heart', at: HEART_DOOR }],
    spawns: worldSpawns(THORNWICK, [['thorn_warden', 31, 101], ['rotwood_cultist', 41, 108], ['rotwood_cultist', 34, 91]]),
  },
  {
    id: 'heart', name: "The Mother's Heart", cave: true, dungeon: 'rotroot', zone: 'rotroot', cell: 0.25,
    footprint: [rectAt(THORNWICK, 8, 30, 108, 134)],
    obstacles: HEART_STONES, tall: [], trees: [], rocks: [], landmarks: {},
    connections: [{ to: 'warren', at: HEART_DOOR }],
    spawns: worldSpawns(THORNWICK, [['rotroot_mother', 19, 126]]),
  },
];
// the hollow's and hall's standing stones are tall (they break sight lines)
for (const r of REGIONS) if (r.cave) r.tall.push(...r.obstacles);

/**
 * Where you wake when you die: the town whose graveyard is nearest the place you fell (by straight distance, the world being flat), at the
 * graveyard, which is out past the town's edge: you walk back. `wake` is where a new game starts (Hale's) and where a flight lands you.
 * `found` is the hook for flight masters (W2.3): pass the ids of the towns whose master you have found and only those count; it defaults
 * to every town.
 */
export const TOWNS: { id: string; name: string; wake: Pt; grave: Pt; map: Pt }[] = [
  { id: 'hale', name: 'Hale', wake: { x: 0, z: 6 }, grave: graveHale, map: { x: 0, z: 0 } }, // where a new game starts (PLAYER_SPAWN in data.ts reads this)
  { id: 'saltmarrow', name: 'Saltmarrow', wake: at(SALTMARROW, -25, -4), grave: graveSalt, map: { x: 900, z: 0 } },
  { id: 'thornwick', name: 'Thornwick', wake: at(THORNWICK, 2, -30), grave: graveThorn, map: { x: 900, z: 1000 } },
];// `map`: the world-map position (design 1.2), used for the map screen and for flight prices only: walking never reads it
export function nearestTown(x: number, z: number, found: readonly string[] = TOWNS.map(t => t.id)) {
  const open = TOWNS.filter(t => found.includes(t.id));
  return (open.length ? open : TOWNS).reduce((best, t) =>
    Math.hypot(x - t.grave.x, z - t.grave.z) < Math.hypot(x - best.grave.x, z - best.grave.z) ? t : best);
}

export const regionById = (id: string): Region => REGIONS.find(r => r.id === id)!;

// --- Flat views of the regions: what the renderer and the sim read. -----------------------------------------------------------

export let WORLD_HALF = 30; // the clearing is a square of side 2*WORLD_HALF
export const LANDMARKS = { ...clearingLandmarks, ...ridgeLandmarks, ...saltLandmarks, ...thornLandmarks };
/** Every hard gate in the world (each region's own), and every Withering Ground patch. */
export const GATES: Gate[] = REGIONS.flatMap(r => r.gates ?? []);
export const WITHERING: { x: number; z: number; r: number }[] = REGIONS.flatMap(r => r.hazards ?? []);

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
/** Hale's ore, outside the cave: copper and nothing else (HOM-77). Other surface regions' ore (the road's, Saltmarrow's adamant) is in their own `rocks`. */
export const ROCKS: RockSpot[] = surface.filter(r => r.zone === 'hale').flatMap(r => r.rocks);
/** Ore inside the cave: the Hollow's three mithril veins. */
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

/** The gatherable spots in node-id order: region by region, each region's rocks, then its trees, then its fishing spots, then its herb patches. Ids are positions in this list. */
export const nodeSpots = (): (RockSpot | NodeSpot)[] =>
  REGIONS.flatMap(r => [...r.rocks, ...r.trees.map(t => ({ ...t, type: 'tree' as const })), ...(r.spots ?? []), ...(r.herbs ?? []).map(h => ({ type: h.type, x: h.x, z: h.z, r: HERB_RADIUS }))]);

/** Every region's floor in one list (the same rect objects, so a resized clearing shows here). */
export const FOOTPRINT: Rect[] = REGIONS.flatMap(r => r.footprint);
const CAVE_RECTS: Rect[] = caves.flatMap(r => r.footprint);

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

// --- Dungeons (bible 1.2): a per-region list of rooms inside the parent's frame, not a region of their own. The Hollow is the first; every rule below
// (is this cave floor, how dark is it, is the wall in the way, may a mount be ridden here) reads the list, and a second dungeon is one more entry. -----

/** A dungeon is the cave's pattern: rooms of walkable floor that overlap, behind one door. */
export interface Dungeon {
  id: string;
  name: string;
  /** The region whose frame it sits in: the town or wilds the door opens off. */
  parent: string;
  /** Where daylight gives way to dark, as z along the way in: 0 at `from`, 1 at `to`. The threshold is the stretch between. */
  fade: { from: number; to: number };
  /** The solid stone round the rooms: a line that crosses it off the floor is cut by the wall (sim/sight.ts), and a creature behind it is not offered to a player outside (sameSideOfDoor). */
  rock: Rect;
  /** Hard-gated: the door does not let you in until `need` (a key into sim/dungeon.ts's DUNGEON_GATES) holds. Absent = always open. */
  gate?: { need: string; blurb: string };
  /** The rooms, in the order they are walked: the `cave` regions that name this dungeon. */
  rooms: { name: string; rect: Rect }[];
}

const DUNGEON_DEFS: Omit<Dungeon, 'rooms'>[] = [
  { id: 'hollow', name: 'The Hollow', parent: 'hale', fade: { from: -24, to: -36 }, rock: { x0: -34, x1: -4, z0: -94, z1: -30 } },
  { id: 'grotto', name: 'The Drowned Grotto', parent: 'saltmarrow', fade: { from: SALTMARROW.z - 70, to: SALTMARROW.z - 82 },
    rock: rectAt(SALTMARROW, -48, -6, -136, -70),
    gate: { need: 'brine_and_bone', blurb: "The door in the cliff is barred from within. Harbourmaster Pell's work on the Strand would be what opens it." } },
  { id: 'rotroot', name: 'The Rotroot', parent: 'thornwick', fade: { from: THORNWICK.z + 70, to: THORNWICK.z + 82 },
    rock: rectAt(THORNWICK, 6, 48, 70, 136),
    gate: { need: 'rotroot', blurb: 'Roots as thick as a man lie across the mouth, and something under them breathes. Only a fighter of combat level 22 or more would go in.' } },
];

export const DUNGEONS: Dungeon[] = DUNGEON_DEFS.map(d => ({ ...d, rooms: caves.filter(r => r.dungeon === d.id).map(r => ({ name: r.id, rect: r.footprint[0] })) }));
export const dungeonById = (id: string): Dungeon => DUNGEONS.find(d => d.id === id)!;

/** Every dungeon's rooms in one list, each with the rect it is made of and the dungeon it belongs to (what the renderer builds a floor and walls from). */
export const CAVE_ROOMS = DUNGEONS.flatMap(d => d.rooms.map(r => ({ ...r, dungeon: d.id })));

/** The dungeon whose floor a point is on, or null: outdoors, or any town. */
export const dungeonAt = (x: number, z: number): Dungeon | null => DUNGEONS.find(d => d.rooms.some(r => inRect(r.rect, x, z))) ?? null;

/**
 * Mounts are not ridden in dungeons (bible 1.2). Nothing is mounted yet; the mount cast and the dismount-on-entry read this, so the rule has one home.
 */
export const mountsAllowed = (x: number, z: number) => dungeonAt(x, z) === null;

/** 0 outdoors, 1 deep inside, smooth across the threshold. For lighting and sound to follow the player through the door. */
export function caveDepth(x: number, z: number): number {
  const d = dungeonAt(x, z);
  if (!d) return 0;
  const k = clamp((d.fade.from - z) / (d.fade.from - d.fade.to), 0, 1);
  return k * k * (3 - 2 * k);
}

/** The line the Hollow's wall runs along at the mouth (its rock begins here). */
export const CAVE_DOOR_Z = dungeonById('hollow').rock.z1;
export const DOOR_SIGHT = 12;
/** The dungeon whose rock a point is in (on or off its floor), or null. */
export const rockAt = (x: number, z: number): Dungeon | null => DUNGEONS.find(d => inRect(d.rock, x, z)) ?? null;
/**
 * Two creatures can only single each other out (Tab, forgiving click) when they are on the same side of a dungeon's wall or standing close:
 * a ridge miner is not offered the Hexer behind forty units of rock.
 */
export const sameSideOfDoor = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z) <= DOOR_SIGHT || rockAt(a.x, a.z) === rockAt(b.x, b.z);

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
