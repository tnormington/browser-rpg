// What the end of a region looks like (HOM-191): one recipe per edge kind, built from primitives in code, each a handful of piece variants the
// placer (HOM-190) instances with jitter. Rendering only; nothing here is a collider, `clampToWorld` is the wall.
//
// Frame of a piece: origin on the edge line, x along it, +y up, +z OUTWARD (away from the player: rank 0 is the near rank, rank 1 behind it
// and so on). A piece fits in a PIECE_W-wide cell, 0..PIECE_D deep, before the placer's scale.
//
// The grammar (HOM-152): a rock you can stand on is a squat blunt block with a pale lichen cap; so nothing here is. Every edge piece is
// pointed, leaning, snapped or taller than a jump, and none has a flat pale top, so no boundary reads as a place to throw yourself at.
import * as THREE from 'three';
import { put, spike, lump, stick, mergeParts } from './creatures';
import { nextRandom } from './sim/rng';

export type EdgeKind = 'rock' | 'cliff' | 'treeline' | 'thicket' | 'water' | 'hedgerow' | 'ruin' | 'barrow';
export const EDGE_KINDS: readonly EdgeKind[] = ['rock', 'cliff', 'treeline', 'thicket', 'water', 'hedgerow', 'ruin', 'barrow'];
/** Names the data may use that are the same kind as another: a fence is the hedgerow's own posts and rails, and the two always stand together. */
export const EDGE_ALIAS: Record<string, EdgeKind> = { fence: 'hedgerow' };
export const edgeKind = (name: string): EdgeKind => (EDGE_ALIAS[name] ?? name) as EdgeKind;

export const PIECE_W = 4, PIECE_D = 3;

/** The renderer's material classes (render.ts MATERIALS) an edge piece uses. */
export type EdgeClass = 'rock' | 'stone' | 'foliage' | 'wood' | 'bark' | 'ground' | 'gem';
/** One draw's worth of a piece: a colour and a material class (the renderer's `MATERIALS`) and the merged geometry. Instance it with `setColorAt` jitter. */
export interface EdgeLayer { name: string; color: number; cls: EdgeClass; geometry: THREE.BufferGeometry }
/** One variant of a kind: every layer drawn at the same instance matrix. */
export interface EdgePiece { layers: EdgeLayer[] }
export interface EdgeRecipe {
  kind: EdgeKind;
  /** Depth of the band behind the line, world units: where the last rank sits. */
  depth: number;
  /** Ranks to fill (near to far). Rank r sits at z = r * depth / (ranks - 1) (+ jitter), and is darkened by `rankShade` per rank. */
  ranks: number;
  /** Gap between neighbours along the line, world units, drawn per piece; and the variant scale range. */
  spacing: [number, number];
  scale: [number, number];
  /** How far one rank darkens the next (multiply the instance colour by 1 - rankShade * rank): trees behind trees. 0 for none. */
  rankShade: number;
  /** Per-instance lightness jitter: colour * (1 +/- this). */
  colorJitter: number;
  /** `free`: random yaw on every piece. `along`: the piece keeps its face to the player (yaw within +/- 0.35 of the line). */
  yaw: 'free' | 'along';
  /** Sink into the ground by up to this (world units): a heap, not a shelf. */
  sink: number;
  /** Chance a position along a rank is left empty: the hedgerow's gaps you can see through. */
  gap: number;
  pieces: EdgePiece[];
}

type Parts = THREE.BufferGeometry[];
const VARIANTS = 4;
const SEEDS: Record<EdgeKind, number> = { rock: 11, cliff: 23, treeline: 37, thicket: 41, water: 53, hedgerow: 67, ruin: 71, barrow: 89 };
const COL = {
  rock: 0x5a616b, rockDark: 0x4b545f, cliff: 0x5d6672, cliffDark: 0x434b55, rubble: 0x6a7078,
  bark: 0x3a3027, pine: 0x2f4a3a, pineDark: 0x24382e, dead: 0x4a4238,
  thorn: 0x2a2520, bramble: 0x3d4d34, reed: 0x5f6e55, mud: 0x2f3329,
  water: 0x14222d, waterDeep: 0x0b141c, snag: 0x3a3027,
  hedge: 0x3b5238, hedgeDark: 0x2e4230, post: 0x4a3b2e, rail: 0x5a4b3c,
  ruin: 0x6a6f79, ruinDark: 0x51555d, moss: 0x3d4d34,
  mound: 0x3a4535, stand: 0x5f6572, standDark: 0x4b505c,
};

/** Cut a prism's top on the slant (a break, not a lid): lowers its top face by up to slope across its width. Works on a box or a cylinder built from y = 0 to h. */
const slant = (g: THREE.BufferGeometry, h: number, slope: number) => {
  const p = g.attributes.position, wid = g.boundingBox ?? (g.computeBoundingBox(), g.boundingBox!);
  for (let i = 0; i < p.count; i++) if (p.getY(i) > h - 1e-3) p.setY(i, h - slope * (p.getX(i) - wid.min.x) / (wid.max.x - wid.min.x));
  return g;
};
const layer = (name: string, color: number, cls: EdgeClass, parts: Parts): EdgeLayer => ({ name, color, cls, geometry: parts.length ? mergeParts(parts) : null! }); // an empty layer is dropped by edgeRecipe
/** A variant-local random in [a, b]. */
const between = (box: { rng: number }, a: number, b: number) => a + nextRandom(box) * (b - a);
/** A pointed, faceted crag: a dodecahedron (the boulder's own facets) stretched a little tall and leaning, never a tall thin crystal. It has no flat top to stand on. */
const shard = (x: number, z: number, w: number, h: number, lean: number, yaw: number) =>
  put(new THREE.DodecahedronGeometry(1, 0), x, h * 0.7, z, lean, yaw, lean * 0.6, w, h, w * 0.9);

// ---- rock: heaped, pointed, leaning; never a bead on a string ----
function rockPieces(box: { rng: number }): EdgePiece[] {
  return Array.from({ length: VARIANTS }, (_, v) => {
    const main: Parts = [], dark: Parts = [];
    if (v === 0) { // a tall pointed boulder with two shards at its foot
      main.push(shard(0, 0.4, 1.3, between(box, 1.6, 2.1), 0.12, 0.4), spike(0.1, 2.5, 0.4, 0.9, 0.45, 0.1));
      dark.push(shard(-1.5, -0.3, 0.7, 0.9, -0.3, 1.1), shard(1.4, -0.5, 0.8, 1.1, 0.25, 2.4));
    } else if (v === 1) { // a slab thrown over: leaning hard, its upper edge a ridge
      main.push(put(new THREE.OctahedronGeometry(1, 0), 0, 1.3, 0.2, 0.3, 0.5, -0.45, 1.0, 1.5, 1.4));
      dark.push(lump(-1.4, 0, -0.2, 0.55, 0.7), lump(1.4, 0, 0.2, 0.45, 0.8));
    } else if (v === 2) { // a heap: five lumps, the highest capped with a spike so even the heap has a point
      for (let i = 0; i < 5; i++) main.push(lump(between(box, -1.6, 1.6), 0, between(box, -0.6, 0.8), between(box, 0.8, 1.3), 1.0));
      dark.push(spike(0, 0.8, 0.2, 1.8, 0.5, 0.15));
    } else { // a pair of shards leaning against each other
      main.push(shard(-0.7, 0, 1.0, 1.8, 0.28, 0.3), shard(0.8, 0.3, 0.9, 2.3, -0.2, 1.6));
      dark.push(lump(0, 0, 0.8, 0.6, 0.6), lump(-1.5, 0, 0.3, 0.4, 0.8));
    }
    return { layers: [layer('rock', COL.rock, 'rock', main), layer('rockDark', COL.rockDark, 'rock', dark)] };
  });
}

// ---- cliff: a face of leaning, uneven columns with rubble at its foot ----
function cliffPieces(box: { rng: number }): EdgePiece[] {
  return Array.from({ length: VARIANTS }, (_, v) => {
    const face: Parts = [], shards: Parts = [], rubble: Parts = [];
    const n = 4 + (v & 1);
    for (let i = 0; i < n; i++) {
      const x = -1.7 + (3.4 * i) / (n - 1), h = between(box, 4.5, 8.5), r = between(box, 0.7, 1.05);
      // each column tapers to a ragged top; the cone on it means no column ends flat
      face.push(put(new THREE.CylinderGeometry(r * 0.55, r, h, 5).translate(0, h / 2, 0), x, 0, between(box, 0, 0.5), between(box, -0.05, 0.05), between(box, 0, 3), between(box, -0.07, 0.07)));
      face.push(spike(x, h - 0.1, 0.1, between(box, 0.8, 1.6), r * 0.5, between(box, -0.2, 0.2), between(box, -0.2, 0.2)));
    }
    shards.push(shard(between(box, -1.2, 1.2), -0.9, 0.55, between(box, 1.5, 2.4), between(box, -0.3, 0.3), 1), spike(between(box, -1.5, 1.5), 0, -1.1, 1.6, 0.4, 0.4));
    for (let i = 0; i < 6 + v; i++) rubble.push(lump(between(box, -1.9, 1.9), 0, between(box, -2.2, -0.6), between(box, 0.22, 0.6), 0.8));
    return { layers: [layer('face', COL.cliff, 'rock', face), layer('shard', COL.cliffDark, 'rock', shards), layer('rubble', COL.rubble, 'rock', rubble)] };
  });
}

// ---- treeline: trees behind trees; the placer darkens each rank ----
function pine(x: number, z: number, h: number, w: number, tilt = 0): { trunk: Parts; foliage: Parts } {
  const trunk: Parts = [put(new THREE.CylinderGeometry(0.16 * w, 0.28 * w, h * 0.5, 5).translate(0, h * 0.25, 0), x, 0, z, 0, 0, tilt)];
  const foliage: Parts = [];
  for (let i = 0; i < 4; i++) { // four stacked cones, each narrower: a spruce silhouette, pointed all the way up
    const f = i / 3, r = (1.7 - f * 1.1) * w, len = h * 0.34;
    foliage.push(put(new THREE.ConeGeometry(r, len, 6).translate(0, len / 2, 0), x - tilt * h * f * 0.5, h * (0.22 + f * 0.5), z, 0, i * 0.7, tilt));
  }
  return { trunk, foliage };
}
function treelinePieces(box: { rng: number }): EdgePiece[] {
  return Array.from({ length: VARIANTS }, (_, v) => {
    const trunk: Parts = [], foliage: Parts = [], dead: Parts = [];
    const add = (p: ReturnType<typeof pine>) => { trunk.push(...p.trunk); foliage.push(...p.foliage); };
    if (v === 0) add(pine(0, 0, between(box, 7, 9), 1));
    else if (v === 1) { add(pine(-1.1, 0, between(box, 6, 8), 0.9)); add(pine(1.2, 0.6, between(box, 4.5, 6), 0.85)); }
    else if (v === 2) add(pine(0, 0, between(box, 4, 5), 1.25)); // a short, fat spruce, to break the height
    else { // a dead pine: bare trunk, splintered branches, one rag of foliage
      dead.push(put(new THREE.CylinderGeometry(0.1, 0.3, 6.5, 5).translate(0, 3.25, 0), 0, 0, 0, 0, 0, 0.06));
      for (let i = 0; i < 6; i++) dead.push(stick(0, 2 + i * 0.7, 0, between(box, 0.9, 1.7), 0.06, between(box, -0.9, 0.9), between(box, -1.2, 1.2)));
      const p = pine(0.4, 0.3, 3.2, 0.7); foliage.push(...p.foliage);
    }
    return { layers: [layer('trunk', COL.bark, 'bark', trunk), layer('foliage', COL.pine, 'foliage', foliage), layer('dead', COL.dead, 'wood', dead)] };
  });
}

// ---- thicket: low, wet, tangled; impassable-looking without being a wall ----
function thicketPieces(box: { rng: number }): EdgePiece[] {
  return Array.from({ length: VARIANTS }, (_, v) => {
    const thorn: Parts = [], leaf: Parts = [], reed: Parts = [], mud: Parts = [];
    for (let i = 0; i < 9 + v * 2; i++) thorn.push(stick(between(box, -1.6, 1.6), 0, between(box, -1, 1), between(box, 1.1, 1.9), 0.05, between(box, -1, 1), between(box, -1, 1)));
    for (let i = 0; i < 3; i++) leaf.push(lump(between(box, -1.5, 1.5), 0.3, between(box, -0.8, 0.8), between(box, 0.4, 0.7), 0.7));
    for (let i = 0; i < 6; i++) reed.push(spike(between(box, -1.8, 1.8), 0, between(box, -1.4, 1.4), between(box, 1.1, 2.0), 0.06, between(box, -0.25, 0.25), between(box, -0.25, 0.25)));
    mud.push(put(new THREE.CylinderGeometry(1.6, 1.8, 0.05, 7), between(box, -0.3, 0.3), 0.03, 0));
    return { layers: [layer('mud', COL.mud, 'ground', mud), layer('thorn', COL.thorn, 'wood', thorn), layer('leaf', COL.bramble, 'foliage', leaf), layer('reed', COL.reed, 'foliage', reed)] };
  });
}

// ---- water: a dark sheet you can see is too deep, overlapping its neighbours into one body, with reeds at its rim and a snag ----
function waterPieces(box: { rng: number }): EdgePiece[] {
  return Array.from({ length: VARIANTS }, (_, v) => {
    const sheet: Parts = [], deep: Parts = [], reed: Parts = [], snag: Parts = [];
    sheet.push(put(new THREE.CylinderGeometry(3.4, 3.5, 0.04, 9), between(box, -0.3, 0.3), 0.06, 0.4, 0, v, 0, 1, 1, between(box, 0.8, 1.1)));
    deep.push(put(new THREE.CylinderGeometry(2.2, 2.3, 0.04, 9), between(box, -0.5, 0.5), 0.1, 0.5, 0, v * 2, 0));
    for (let i = 0; i < 3 + v; i++) reed.push(spike(between(box, -2.6, 2.6), 0, between(box, -1.6, 0.4), between(box, 1.2, 2.2), 0.09, between(box, -0.2, 0.2), between(box, -0.2, 0.2)));
    if (v % 2 === 0) snag.push(stick(between(box, -1, 1), 0, 0.6, between(box, 1.5, 2.6), 0.1, between(box, -0.3, 0.3), between(box, -0.4, 0.4)));
    else snag.push(lump(between(box, -0.8, 0.8), 0.1, 0.6, 0.55, 0.6));
    return { layers: [layer('sheet', COL.water, 'ground', sheet), layer('deep', COL.waterDeep, 'ground', deep), layer('reed', COL.reed, 'foliage', reed), layer('snag', COL.snag, 'wood', snag)] };
  });
}
// ---- hedgerow / fence: the one kind that says people live here; a line with gaps you can see through ----
function hedgerowPieces(box: { rng: number }): EdgePiece[] {
  return Array.from({ length: VARIANTS }, (_, v) => {
    const hedge: Parts = [], dark: Parts = [], post: Parts = [], rail: Parts = [];
    const run = (x0: number, x1: number, rails: boolean) => { // posts every 1.2 and two rails, each a little off true
      const n = Math.max(2, Math.round((x1 - x0) / 1.2) + 1);
      for (let i = 0; i < n; i++) post.push(put(new THREE.BoxGeometry(0.16, 1.4, 0.16), x0 + ((x1 - x0) * i) / (n - 1), 0.65, 0, between(box, -0.06, 0.06), between(box, 0, 1), between(box, -0.12, 0.12)));
      if (rails) for (const y of [0.5, 1.0]) rail.push(put(new THREE.BoxGeometry(x1 - x0, 0.09, 0.07), (x0 + x1) / 2, y + between(box, -0.04, 0.04), 0.02, 0, 0, between(box, -0.07, 0.07)));
    };
    const bush = (x: number, r: number) => { hedge.push(lump(x, r * 0.5, between(box, -0.1, 0.1), r, 0.75), lump(x + r * 0.5, r * 0.4, between(box, 0.1, 0.4), r * 0.7, 0.8)); dark.push(lump(x - r * 0.2, r * 0.3, 0.5, r * 0.55, 0.8)); };
    if (v === 0) { bush(-1.4, 0.85); bush(-0.2, 1.0); bush(1.6, 0.8); } // a hedge with a gap you see through, posts in the gap
    else if (v === 1) { run(-2, 2, true); bush(0.6, 0.7); } // a fence, a bush grown through it
    else if (v === 2) { run(-2, 0.4, true); run(1.0, 2, false); } // a fence with the rail down: posts left standing
    else { bush(-1.5, 0.7); bush(-0.4, 0.95); bush(0.8, 0.85); bush(1.7, 0.7); run(-1.9, 1.9, false); } // a full hedge on its posts
    return { layers: [layer('hedge', COL.hedge, 'foliage', hedge), layer('hedgeDark', COL.hedgeDark, 'foliage', dark), layer('post', COL.post, 'wood', post), layer('rail', COL.rail, 'wood', rail)] };
  });
}

// ---- ruin: broken wall, snapped columns, fallen stone; jagged on top ----
function ruinPieces(box: { rng: number }): EdgePiece[] {
  return Array.from({ length: VARIANTS }, (_, v) => {
    const stone: Parts = [], dark: Parts = [], moss: Parts = [];
    const wall = (x0: number, n: number) => {
      for (let i = 0; i < n; i++) { // a wall stub: neighbouring segments of different heights, each top slanted
        const h = between(box, 1.6, 4.0), w = between(box, 0.6, 1.1), x = x0 + i * 0.9;
        stone.push(put(slant(new THREE.BoxGeometry(w, h, 0.7).translate(0, h / 2, 0), h, between(box, -1.1, 1.1)), x, 0, between(box, -0.15, 0.15), 0, 0, between(box, -0.1, 0.1))); // the broken top, on the slant
      }
    };
    if (v === 0) { wall(-1.9, 4); dark.push(put(new THREE.CylinderGeometry(0.5, 0.5, 1.3, 7), 0.5, 0.55, -1.0, 0, 0, Math.PI / 2 + 0.2)); }
    else if (v === 1) { // a column snapped on the slant, the cut face tilted, its drum fallen at the foot
      stone.push(put(slant(new THREE.CylinderGeometry(0.5, 0.58, 4.6, 7).translate(0, 2.3, 0), 4.6, 1.1), 0, 0, 0, 0, 0, 0.04));
      dark.push(put(new THREE.CylinderGeometry(0.5, 0.5, 1.2, 7), 1.5, 0.5, -0.8, 0.2, 0, Math.PI / 2 - 0.3));
    } else if (v === 2) { // a stub of wall with a lintel fallen across it at an angle, nothing a body could pass through
      wall(-1.4, 3);
      stone.push(put(new THREE.BoxGeometry(2.8, 0.45, 0.6), 0.5, 1.6, -0.5, 0.15, 0.2, 0.55));
    } else { wall(-1.9, 2); stone.push(put(slant(new THREE.CylinderGeometry(0.45, 0.52, 3.4, 7).translate(0, 1.7, 0), 3.4, -0.9), 1.1, 0, 0.2)); }
    for (let i = 0; i < 4; i++) moss.push(lump(between(box, -1.8, 1.8), 0, between(box, -1.2, 0.6), between(box, 0.2, 0.45), 0.7));
    return { layers: [layer('stone', COL.ruin, 'stone', stone), layer('stoneDark', COL.ruinDark, 'stone', dark), layer('moss', COL.moss, 'foliage', moss)] };
  });
}

// ---- barrow: a steep earthen mound with the dead's standing stones on it ----
function barrowPieces(box: { rng: number }): EdgePiece[] {
  const stand = (x: number, z: number, h: number, lean: number): Parts[number] => put(new THREE.CylinderGeometry(0.3, 0.6, h, 4).translate(0, h / 2, 0), x, 0, z, lean * 0.4, between(box, 0, 3), lean, 1.1, 1, 0.6); // a broad, tapering slab, not a crystal
  return Array.from({ length: VARIANTS }, (_, v) => {
    const mound: Parts = [], up: Parts = [], dark: Parts = [];
    // detail-0 icosahedron stretched tall: a steep faceted dome, not the smooth walkable one
    mound.push(put(new THREE.IcosahedronGeometry(1, 0), 0, 0.9, 0.2, 0, v, 0, between(box, 1.4, 1.8), between(box, 1.5, 2.0), between(box, 1.3, 1.7)));
    if (v === 0) up.push(stand(-0.3, -1.3, 3.4, 0.12), stand(0.9, -1.1, 2.6, -0.2));
    else if (v === 1) { // a trilithon on the mound's near foot: two uprights, a lintel; the mound is behind it
      up.push(stand(-0.9, -1.5, 3.0, 0.02), stand(0.9, -1.5, 3.0, -0.02));
      dark.push(put(new THREE.BoxGeometry(2.7, 0.5, 0.55), 0, 3.2, -1.5, 0, 0, 0.03));
    } else if (v === 2) up.push(stand(-1.6, -0.6, 2.8, 0.25), stand(1.5, -0.9, 3.6, -0.15), stand(0, -1.6, 2.2, 0.05));
    else { up.push(stand(-1.2, -1.2, 3.8, 0.2)); dark.push(put(new THREE.IcosahedronGeometry(1, 0), 1.3, 0.4, -1.0, 0, 1, 0, 0.9, 0.7, 0.8)); }
    return { layers: [layer('mound', COL.mound, 'foliage', mound), layer('stand', COL.stand, 'stone', up), layer('standDark', COL.standDark, 'stone', dark)] };
  });
}

const BUILD: Record<EdgeKind, { make: (box: { rng: number }) => EdgePiece[]; meta: Omit<EdgeRecipe, 'kind' | 'pieces'> }> = {
  rock:     { make: rockPieces,     meta: { depth: 5,  ranks: 2, spacing: [1.8, 4.2], scale: [0.8, 1.5],  rankShade: 0.12, colorJitter: 0.1,  yaw: 'free',  sink: 0.3,  gap: 0.05 } },
  cliff:    { make: cliffPieces,    meta: { depth: 4,  ranks: 2, spacing: [3.0, 3.8], scale: [0.9, 1.4],  rankShade: 0.15, colorJitter: 0.08, yaw: 'along', sink: 0.2,  gap: 0 } },
  treeline: { make: treelinePieces, meta: { depth: 12, ranks: 4, spacing: [2.0, 3.6], scale: [0.8, 1.3],  rankShade: 0.14, colorJitter: 0.1,  yaw: 'free',  sink: 0.1,  gap: 0.05 } },
  thicket:  { make: thicketPieces,  meta: { depth: 5,  ranks: 2, spacing: [1.8, 3.0], scale: [0.8, 1.3],  rankShade: 0.1,  colorJitter: 0.12, yaw: 'free',  sink: 0,    gap: 0.1 } },
  water:    { make: waterPieces,    meta: { depth: 8,  ranks: 3, spacing: [2.8, 3.8], scale: [0.9, 1.3],  rankShade: 0.1,  colorJitter: 0.06, yaw: 'free',  sink: 0.03, gap: 0 } },
  hedgerow: { make: hedgerowPieces, meta: { depth: 2,  ranks: 2, spacing: [3.4, 4.2], scale: [0.95, 1.1], rankShade: 0.08, colorJitter: 0.08, yaw: 'along', sink: 0,    gap: 0.15 } },
  ruin:     { make: ruinPieces,     meta: { depth: 4,  ranks: 2, spacing: [3.2, 5.0], scale: [0.9, 1.3],  rankShade: 0.12, colorJitter: 0.08, yaw: 'along', sink: 0.1,  gap: 0.2 } },
  barrow:   { make: barrowPieces,   meta: { depth: 6,  ranks: 2, spacing: [3.4, 5.0], scale: [0.9, 1.3],  rankShade: 0.12, colorJitter: 0.08, yaw: 'free',  sink: 0.1,  gap: 0.1 } },
};

const cache = new Map<EdgeKind, EdgeRecipe>();
/** The recipe for a kind (aliases resolved), built once: the geometry is shared, so a placer instances it and never disposes it. */
export function edgeRecipe(name: string): EdgeRecipe {
  const kind = edgeKind(name), hit = cache.get(kind);
  if (hit) return hit;
  if (!BUILD[kind]) throw new Error(`no edge kind "${name}"`);
  const recipe: EdgeRecipe = { kind, ...BUILD[kind].meta, pieces: BUILD[kind].make({ rng: SEEDS[kind] }).map(p => ({ layers: p.layers.filter(l => l.geometry) })) };
  cache.set(kind, recipe);
  return recipe;
}






