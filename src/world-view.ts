// The drawn world beyond Hale's clearing: the Greywater Road and Saltmarrow (docs/world-design.md section 1), built from the same region
// data the sim reads (sim/world.ts). Rendering only: reads regions, never mutates them.
//
// Cost model. The world is continuous and 900+ units long, so nothing here exists until the player is near it and nothing stays drawn once
// they are not:
//  - Open country is cut into TILE-wide slabs (small, so that frustum culling can drop the ones behind the camera: a slab's meshes are one
//    bounding sphere each). A slab is built (ground, scenery, boundary rock: a handful of merged draws) the first time the player comes
//    within BUILD_RANGE, and is shown only while within SHOW_RANGE. Fog is total at 42 and the camera sits under 20 back, so nothing
//    past SHOW_RANGE could be seen anyway. Standing in Hale, none of it has been built: the clearing's cost is what it was.
//  - A shown slab is a few meshes whatever it holds, so the cost of the road per frame is its slabs in view, not its 810 units.
// Looks here are stand-ins made of primitives in the clearing's palette: the 3D Artist dresses them (W2.5).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HIGHMOOR, LANDMARKS, REGIONS, Gate, Obstacle, Rect, Region, SALTMARROW, SPIRE, THORNWICK } from './sim/world';
import { PROPS, PropId } from './props';
import { mergeParts } from './creatures';
import { GROUND_CELL, bakeUV, groundDrift } from './surface';
import { HaloSpot, haloMesh } from './halo';

/** The few things this file needs from the renderer: its mesh factory (materials and shadows stay in render.ts) and its palette. */
export interface Kit {
  mesh: (g: THREE.BufferGeometry, color: number, cls: string, shadow?: 'cast' | 'receive' | 'both' | 'none') => THREE.Mesh;
  P: { grass: number; grassAlt: number; dirt: number; dirtAlt: number; slate: number; slateDark: number; boulder: number; stone: number; stoneDark: number; bark: number; pine: number; robe: number; hood: number; skin: number; boar: number; gold: number; steel: number; fire: number };
}

export const TILE = 40;
export const BUILD_RANGE = 80;
/** Fog is total at 42 from the camera and the camera sits up to 20 behind the player: nothing further than this from them can be seen. */
export const SHOW_RANGE = 62;
/** The sea off Saltmarrow's shore, and the stand-in colours for what the clearing has no use for. */
const SEA = 0x1b2c3a, SAND = 0x6b6654, DECK = 0x5a4a38, DECK_DARK = 0x3e3329, PLASTER = 0x92948f, ROOF = 0x4e5b69, LANTERN = 0xff9a3c;
/** A torch's pool: redder than a lantern's, because it is a flame and not a wick behind horn. */
const TORCH_LIGHT = 0xff6a24;
/** Saltmarrow's value ladder: pale limewash walls over a dark stone footing, black timber, slate roofs, a weathered hull; the sea's foam is the palest thing in the frame. */
const FOOTING = 0x59626b, TIMBER = 0x2c241e, HULL = 0x52483e, FOAM = 0xa9bcc6, STONE_MARK = 0x7d858c;
/** A town's building colours: Saltmarrow's limewash and slate, Thornwick's warm plaster and dark thatch. */
interface Pal { wall: number; roof: number; foot: number }
const SALT_PAL: Pal = { wall: PLASTER, roof: ROOF, foot: FOOTING }, THORN_PAL: Pal = { wall: 0x8a7d66, roof: 0x4a3f2e, foot: 0x4d4a44 };
/** The fens' ground: peat and moss, still water, reeds, and the stain Withering Ground leaves. Thornwick's: leaf litter under a dark canopy. */
const FEN = { moss: 0x41584a, mossAlt: 0x364b3e, peat: 0x2f3329, stain: 0x6b6a2f, water: 0x4a7a80, reed: 0x9aa862, bone: 0x9a9680, mist: 0x8fa89c };
const WOOD = { brush: 0x2e4a30, thorn: 0x4a3028, cap: 0x8a6a58 };
const WOOD_FLOOR = { litter: 0x3a4630, litterAlt: 0x2f3a2a, loam: 0x3a3226 };
/** The Barrowdowns' turf (cold grey-green grass, peat showing through) and Highmoor's (heath, with heather), and Highmoor's greystone buildings under dark slate. */
const BARROW_FLOOR = { turf: 0x4a5640, turfAlt: 0x3d4833, peat: 0x2f3329 };
const MOOR_FLOOR = { heath: 0x5a5840, heathAlt: 0x4b4a38, heather: 0x5e4a5a };
/** The barrows' mounds (a lighter, drier turf than the ground round them, so a mound is a shape and not a shadow) and the black of a barrow's open mouth. */
const BARROW = { turf: 0x66744f, dark: 0x07090b, jamb: 0x9aa0a4 };
const MOOR_PAL: Pal = { wall: 0x7d7a72, roof: 0x3d4650, foot: 0x4a4a48 };
/** The Cairnwaste's ground (grey ash over black stone, pale drifts of it) and the Spire's (slate with a lilac cast, dark in the ruins), and the Spire's buildings: cold violet-grey stone under near-black slate. */
const WASTE_FLOOR = { ash: 0x4d4a46, ashAlt: 0x3f3c3a, drift: 0x77726a, char: 0x2a2826 };
const SPIRE_FLOOR = { slate: 0x464450, slateAlt: 0x3a3844, ruin: 0x2f2d38 };
const SPIRE_PAL: Pal = { wall: 0x6e6c7c, roof: 0x2c2c3a, foot: 0x45434f };
/** The cairns' black stone, and the pale marble of the Spire's broken columns: the one light shape in a dark country. */
const WASTE_STONE = 0x2e2c2e, SPIRE_MARBLE = 0xa6a4b4;
/** The Spire's arcane light (the same cold violet as the Vault's runes), and the height it lies at on the ground. */
const RUNE_LIGHT = 0xb8a8ff, RUNE_GROUND = 0.07;

let poolMaterial: THREE.MeshBasicMaterial | undefined;
const hash = (n: number) => Math.abs(Math.sin(n * 12.9898) * 43758.5453) % 1;
const flat = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g);
const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0), S = new THREE.Vector3(), V = new THREE.Vector3();
/** Move, turn about y and scale a geometry in place (all parts are merged, so each carries its own placement). */
function place(g: THREE.BufferGeometry, x: number, y: number, z: number, rotY = 0, sx = 1, sy = sx, sz = sx) {
  const out = flat(g);
  out.applyMatrix4(M.compose(V.set(x, y, z), Q.setFromAxisAngle(UP, rotY), S.set(sx, sy, sz)));
  return out;
}

/** A headstone: an upright slab, leaning a little, with a round top. */
function headstone(o: Obstacle, ry: number, i: number): THREE.BufferGeometry[] {
  const lean = (hash(i + 5) - 0.5) * 0.25;
  return [place(new THREE.BoxGeometry(0.8, 1.2, 0.22).rotateZ(lean), o.x, 0.6, o.z, ry), place(new THREE.CylinderGeometry(0.4, 0.4, 0.22, 8).rotateX(Math.PI / 2).rotateZ(lean), o.x - lean * 0.6, 1.2, o.z, ry)];
}

type Bag = Record<'rock' | 'bark' | 'wall' | 'roof' | 'wood' | 'glow' | 'stone' | 'hull' | 'sign' | 'pool' | 'water' | 'reed' | 'bone' | 'brush' | 'thorn' | 'cloth' | 'turf' | 'dark' | 'jamb' | 'heather' | 'cairn' | 'marble' | 'rune', THREE.BufferGeometry[]> & {
  /** Placed copies of props.ts props, by `prop:layer`: one draw per layer however many there are. */
  props: Map<string, { color: number; cls: string; geoms: THREE.BufferGeometry[] }>;
  /** The glow round every light on the slab (halo.ts): one draw for all of them. */
  halos: HaloSpot[];
};
const newBag = (): Bag => ({ rock: [], bark: [], wall: [], roof: [], wood: [], glow: [], stone: [], hull: [], sign: [], pool: [], water: [], reed: [], bone: [], brush: [], thorn: [], cloth: [], turf: [], dark: [], jamb: [], heather: [], cairn: [], marble: [], rune: [], props: new Map(), halos: [] });

/** A prop's layers as one merged geometry each, built the first time it is wanted and copied (never moved) for every placement. */
const propSources = new Map<PropId, { name: string; color: number; cls: string; geo: THREE.BufferGeometry }[]>();
const propHalos = new Map<PropId, HaloSpot[]>();
function propLayers(id: PropId) {
  let layers = propSources.get(id);
  if (!layers) {
    const p = PROPS[id]();
    propSources.set(id, layers = p.layers.map(l => ({ name: l.name, color: l.color, cls: l.cls, geo: mergeParts(l.parts) })));
    propHalos.set(id, p.halos ?? []);
  }
  return layers;
}
function placeProp(bag: Bag, id: PropId, x: number, z: number, rot = 0, scale = 1) {
  for (const l of propLayers(id)) {
    const key = `${id}:${l.name}`;
    let entry = bag.props.get(key);
    if (!entry) bag.props.set(key, entry = { color: l.color, cls: l.cls, geoms: [] });
    entry.geoms.push(place(l.geo.clone(), x, 0, z, rot, scale));
  }
  for (const h of propHalos.get(id)!) { // the prop's own flames, turned and scaled with it
    const [hx, hz] = rotXZ(h.x * scale, h.z * scale, rot);
    bag.halos.push({ id: h.id, x: x + hx, y: h.y * scale, z: z + hz, scale: scale * (h.scale ?? 1) });
  }
}

/** A pool of lamplight on the ground: a warm disc fading to nothing at its rim. Unlit and faint (well under the forge's glow), no real light behind it; alpha, not additive, so the fog takes it back to the ground's own colour rather than to a pale blue. */
function lampPool(x: number, z: number, r: number, strength = 0.3, y = 0.05, color = LANTERN): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(r, 20).rotateX(-Math.PI / 2).translate(x, y, z), warm = new THREE.Color(color);
  const col = new Float32Array(g.attributes.position.count * 4);
  warm.toArray(col, 0); // vertex 0 is the centre; the rim stays clear
  col[3] = strength;
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  return g;
}
/** A lamp post: a pole, a bracket and a lit lantern, with its pool on the ground. Parts go into the bag; `y` is the ground's height. */
function lampPost(bag: Bag, x: number, z: number, y = 0, pool = 4.5) {
  bag.wood.push(place(new THREE.CylinderGeometry(0.08, 0.12, 3.1, 5), x, y + 1.55, z), place(new THREE.BoxGeometry(0.5, 0.08, 0.08), x + 0.2, y + 3.05, z));
  bag.glow.push(place(new THREE.OctahedronGeometry(0.26), x + 0.4, y + 2.85, z));
  bag.halos.push({ id: 'lantern', x: x + 0.4, y: y + 2.85, z });
  bag.pool.push(lampPool(x + 0.3, z, pool, 0.3, y + 0.05));
}
/** A torch on a post (props.ts) and the warm pool it throws: the lamp's counterpart out where the town's lamps do not reach. */
function torchPost(bag: Bag, x: number, z: number, rot = 0, pool = 3.6) {
  placeProp(bag, 'torch', x, z, rot);
  bag.pool.push(lampPool(x, z, pool, 0.26, 0.05, TORCH_LIGHT));
}
/** Rotate a local (x, z) offset about y by `rot`, as `place` does, giving the world offset. */
const rotXZ = (lx: number, lz: number, rot: number): [number, number] => [lx * Math.cos(rot) + lz * Math.sin(rot), -lx * Math.sin(rot) + lz * Math.cos(rot)];

/** A house or the inn, from the ground up: a stone footing, limewashed walls in a black timber frame, a steep slate roof, a chimney, a door and lit windows. */
function building(o: Obstacle, rot: number, bag: Bag) {
  const big = o.kind === 'inn', w = o.r * 1.45, d = w * (big ? 1.5 : 1.7), h = big ? 4.6 : 3, roofH = big ? 3.4 : 2.8, doorX = big ? w * 0.15 : 0;
  const put = (list: THREE.BufferGeometry[], g: THREE.BufferGeometry, lx: number, ly: number, lz: number) => list.push(place(g.translate(lx, ly, lz), o.x, 0, o.z, rot));
  put(bag.stone, new THREE.BoxGeometry(2 * w + 0.4, 0.9, d + 0.4), 0, 0.45, 0);
  put(bag.wall, new THREE.BoxGeometry(2 * w, h - 0.9, d), 0, 0.9 + (h - 0.9) / 2, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(bag.wood, new THREE.BoxGeometry(0.3, h, 0.3), sx * w, h / 2, sz * d / 2); // the frame's corner posts
  put(bag.wood, new THREE.BoxGeometry(2 * w + 0.3, 0.28, d + 0.3), 0, h - 0.1, 0); // the eaves beam
  if (big) put(bag.wood, new THREE.BoxGeometry(2 * w + 0.15, 0.2, d + 0.15), 0, 2.7, 0); // the jetty between storeys
  put(bag.roof, new THREE.ConeGeometry(w * 1.65, roofH, 4).rotateY(Math.PI / 4).scale(1, 1, big ? 0.8 : 0.95), 0, h + roofH / 2, 0);
  put(bag.stone, new THREE.BoxGeometry(0.9, 2.4, 0.9), w * 0.5, h + roofH * 0.45, -d * 0.12); // the chimney
  put(bag.wood, new THREE.BoxGeometry(1, 1.9, 0.16), doorX, 0.95, d / 2 + 0.28); // the door, proud of the footing
  const win = (lx: number, ly: number) => {
    put(bag.wood, new THREE.BoxGeometry(1, 1.1, 0.08), lx, ly, d / 2 + 0.03);
    put(bag.glow, new THREE.BoxGeometry(0.72, 0.82, 0.1), lx, ly, d / 2 + 0.07);
    const [wx, wz] = rotXZ(lx, d / 2 + 0.12, rot); // the light coming through the glass, just proud of the pane
    bag.halos.push({ id: 'window', x: o.x + wx, y: ly, z: o.z + wz });
  };
  if (big) { for (const lx of [-0.8, -0.45, 0.55, 0.85]) win(lx * w, 1.9); for (const lx of [-0.5, 0.5]) win(lx * w, 3.65); } else for (const lx of [-0.5, 0.5]) win(lx * w, 1.9);
  if (big) { // the Gilded Gull's sign: a board on a bracket over the door
    put(bag.wood, new THREE.BoxGeometry(1.5, 0.1, 0.1), doorX + 0.8, 3.3, d / 2 + 0.7);
    put(bag.sign, new THREE.BoxGeometry(0.1, 0.75, 0.9), doorX + 1.35, 2.85, d / 2 + 0.7);
  }
  const [px, pz] = rotXZ(doorX, d / 2 + 2.4, rot); // lamplight spilling from the door onto the ground in front
  bag.pool.push(lampPool(o.x + px, o.z + pz, big ? 6 : 4.2, 0.26));
}

/** A beached boat: a half-hull on its keel, listing, with a deck, a stem post and a broken mast. */
function boat(o: Obstacle, rot: number, bag: Bag) {
  const len = o.r * 1.6, beam = o.r * 0.6, depth = o.r * 0.8;
  const put = (list: THREE.BufferGeometry[], g: THREE.BufferGeometry, lx = 0, ly = 0, lz = 0) => list.push(place(g.rotateZ(0.12).translate(lx, ly, lz), o.x, 0, o.z, rot));
  put(bag.hull, new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(len, depth, beam), 0, depth * 0.95, 0);
  put(bag.wood, new THREE.CylinderGeometry(1, 1, 0.08, 8).scale(len * 0.98, 1, beam * 0.98), 0, depth * 0.95, 0); // the deck seen from above
  put(bag.hull, new THREE.ConeGeometry(0.28, 1.8, 4).rotateZ(-0.5), len - 0.1, depth + 0.6, 0); // the stem post, raised
  put(bag.wood, new THREE.CylinderGeometry(0.1, 0.16, 3.6, 5), -len * 0.15, depth + 1.7, 0); // the mast, snapped
  put(bag.wood, new THREE.CylinderGeometry(0.06, 0.07, 2.8, 4).rotateZ(1.25), -len * 0.15 + 1.1, depth + 1.8, 0); // the boom, hanging
}

/** A clump of fen reed: a fan of tall pale blades leaning out of one root. Seeded, so it is the same reed every time the slab is built. */
function reedClump(bag: Bag, x: number, z: number, seed: number) {
  for (let b = 0, n = 5 + Math.floor(hash(seed) * 4); b < n; b++) {
    const a = b * 2.4 + seed, h = 1.5 + hash(seed + b * 3) * 1.3, lean = 0.1 + hash(b + seed * 2) * 0.2;
    bag.reed.push(place(new THREE.ConeGeometry(0.1, h, 4).rotateZ(Math.sin(a) * lean).rotateX(Math.cos(a) * lean), x + Math.cos(a) * 0.35, h / 2, z + Math.sin(a) * 0.35));
  }
}
/** A drowned tree: a bleached trunk, snapped short, with a limb or two. */
function snag(bag: Bag, x: number, z: number, seed: number) {
  const ry = hash(seed) * Math.PI * 2, h = 2.4 + hash(seed + 1) * 1.6;
  bag.bone.push(place(new THREE.CylinderGeometry(0.1, 0.24, h, 5).rotateZ(0.12), x, h / 2, z, ry), place(new THREE.CylinderGeometry(0.04, 0.09, 1.5, 4).rotateZ(1), x + 0.5, h * 0.7, z, ry), place(new THREE.CylinderGeometry(0.04, 0.08, 1.1, 4).rotateZ(-1.1), x - 0.4, h * 0.5, z, ry));
}

/** The graveyard's stones as one draw. Saltmarrow's are drawn with its slabs; Hale's clearing is render.ts's own, so it asks for them here. */
export function headstones(kit: Kit, obs: Obstacle[]): THREE.Mesh {
  return kit.mesh(mergeGeometries(obs.flatMap((o, i) => headstone(o, hash(o.x * 3.1 + o.z * 7.7) * Math.PI * 2, i)))!, kit.P.slate, 'rock');
}

/** `slab`: a stretch of a region's floor and what stands on it; `quay`, `town`: what is only once; `gate`: the posts, lamps and keeper at a hard gate. The pick meshes carry their town's id in `userData.id`. */
interface Tile { kind: 'slab' | 'quay' | 'town' | 'gate'; region: Region; rect: Rect; gate?: Gate; group: THREE.Group | null; ground: THREE.Mesh[]; picks: { npc: THREE.Mesh[]; vendor: THREE.Mesh[]; flight: THREE.Mesh[]; trainer: THREE.Mesh[] } }

const inside = (r: Rect, x: number, z: number, e = 0.01) => x > r.x0 + e && x < r.x1 - e && z > r.z0 + e && z < r.z1 - e;
/** A region's main floor: the biggest of its rects (the others are corridors and piers). */
const mainRect = (r: Region): Rect => r.footprint.reduce((best, f) => (f.x1 - f.x0) * (f.z1 - f.z0) > (best.x1 - best.x0) * (best.z1 - best.z0) ? f : best);
const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
/** A floor that runs north to south (much deeper than wide): the fens. Its slabs are cut in z. */
const isLong = (r: Rect) => r.z1 - r.z0 > (r.x1 - r.x0) * 1.5;

export class WorldView {
  private tiles: Tile[] = [];
  private kit: Kit;

  constructor(private scene: THREE.Scene, kit: Kit) {
    this.kit = kit;
    for (const region of REGIONS) {
      if (region.zone === 'hale' || region.district) continue; // the clearing and the cave are render.ts's own; a district has no floor to draw
      // the region's main floor (its biggest rect) is cut into slabs; the rest (the gate's corridor, the quay) ride with the slab they touch
      const rect = mainRect(region);
      const tile = (kind: Tile['kind'], rect: Rect, gate?: Gate): Tile => ({ kind, region, rect, gate, group: null, ground: [], picks: { npc: [], vendor: [], flight: [], trainer: [] } });
      // slabs are cut along the region's long way: the road of a region that runs north to south (the fens) is cut in z, the rest in x
      if (isLong(rect)) for (let z = rect.z0; z < rect.z1 - 1e-6; z += TILE) this.tiles.push(tile('slab', { x0: rect.x0, x1: rect.x1, z0: z, z1: Math.min(rect.z1, z + TILE) }));
      else for (let x = rect.x0; x < rect.x1 - 1e-6; x += TILE) this.tiles.push(tile('slab', { x0: x, x1: Math.min(rect.x1, x + TILE), z0: rect.z0, z1: rect.z1 }));
      if (region.id === 'saltmarrow') { // what is only once: the sea and the quay, and the people of the square
        this.tiles.push(tile('quay', { x0: SALTMARROW.x + 10, x1: SALTMARROW.x + 160, z0: SALTMARROW.z - 130, z1: SALTMARROW.z + 130 }));
        this.tiles.push(tile('town', { x0: LANDMARKS.square.x - 40, x1: LANDMARKS.square.x + 40, z0: LANDMARKS.square.z - 40, z1: LANDMARKS.square.z + 40 }));
      }
      if (region.id === 'thornwick') this.tiles.push(tile('town', { x0: LANDMARKS.thornSquare.x - 40, x1: LANDMARKS.thornSquare.x + 40, z0: LANDMARKS.thornSquare.z - 40, z1: LANDMARKS.thornSquare.z + 40 }));
      if (region.id === 'highmoor') this.tiles.push(tile('town', { x0: LANDMARKS.highSquare.x - 40, x1: LANDMARKS.highSquare.x + 40, z0: LANDMARKS.highSquare.z - 40, z1: LANDMARKS.highSquare.z + 40 }));
      if (region.id === 'spire') this.tiles.push(tile('town', { x0: LANDMARKS.spireSquare.x - 40, x1: LANDMARKS.spireSquare.x + 40, z0: LANDMARKS.spireSquare.z - 40, z1: LANDMARKS.spireSquare.z + 40 }));
      for (const g of region.gates ?? []) {
        const c = g.axis === 'z' ? { x: (g.span[0] + g.span[1]) / 2, z: g.at } : { x: g.at, z: (g.span[0] + g.span[1]) / 2 };
        this.tiles.push(tile('gate', { x0: c.x - 16, x1: c.x + 16, z0: c.z - 16, z1: c.z + 16 }, g));
      }
    }
  }

  /** Slabs built and slabs shown, for the bench. */
  get stats() { return { tiles: this.tiles.length, built: this.tiles.filter(t => t.group).length, shown: this.tiles.filter(t => t.group?.visible).length }; }

  /** Build slabs the player has come near, show only the ones in view. Cheap: a distance per slab. */
  update(px: number, pz: number) {
    for (const t of this.tiles) {
      const dx = Math.max(t.rect.x0 - px, 0, px - t.rect.x1), dz = Math.max(t.rect.z0 - pz, 0, pz - t.rect.z1), d = Math.hypot(dx, dz);
      if (!t.group && d <= BUILD_RANGE) this.build(t);
      if (t.group) t.group.visible = d <= SHOW_RANGE;
    }
  }

  /** The harbourmaster's and the chandler's pick proxies, when they are in view. */
  npcPicks(): THREE.Mesh[] { return this.tiles.flatMap(t => t.group?.visible ? t.picks.npc : []); }
  vendorPicks(): THREE.Mesh[] { return this.tiles.flatMap(t => t.group?.visible ? t.picks.vendor : []); }
  flightPicks(): THREE.Mesh[] { return this.tiles.flatMap(t => t.group?.visible ? t.picks.flight : []); }
  trainerPicks(): THREE.Mesh[] { return this.tiles.flatMap(t => t.group?.visible ? t.picks.trainer : []); }
  /** Is the harbourmaster's slab in view (his mark floats only then)? */
  harbourShown(): boolean { return this.tiles.some(t => t.group?.visible && t.picks.npc.length > 0); }

  // --- building a slab ------------------------------------------------------------------------------------------------------------

  private build(t: Tile) {
    const g = new THREE.Group();
    t.group = g;
    this.scene.add(g);
    const r = t.region, rect = t.rect;
    const add = (m: THREE.Object3D) => { g.add(m); return m; };
    if (t.kind === 'quay') return this.quay(t, add);
    if (t.kind === 'town') return this.town(t, add);
    if (t.kind === 'gate') return this.gate(t, add);

    // floors: this slab of the main rect, plus every other rect of the region that touches it (a gate's corridor; Saltmarrow's quay is its own tile)
    const main = mainRect(r), floors = [rect, ...r.footprint.filter(f => f !== main && overlaps(f, rect) && r.id !== 'saltmarrow')];
    for (const f of floors) { const m = this.floor(f, r); t.ground.push(m); add(m); }

    // scenery: the region's obstacles that stand in this slab (a slab of a north-south region is cut in z, so z counts too)
    const long = isLong(main), inSlab = (o: { x: number; z: number }) => o.x >= rect.x0 && o.x < rect.x1 && (!long || (o.z >= rect.z0 && o.z < rect.z1));
    this.scenery(r.obstacles.filter(inSlab), rect, r, add);

    // the edge of the world: a wall of boulders where the floor ends and nothing else begins
    this.boundary(floors, rect, r, add);
  }

  /** A slab of ground tinted per vertex: grass, with the road down its axis (the road is the region's z-centre), sand toward the sea, paving in a town square. */
  private floor(f: Rect, r: Region): THREE.Mesh {
    const { P } = this.kit, w = f.x1 - f.x0, d = f.z1 - f.z0, sx = Math.max(1, Math.round(w / GROUND_CELL)), sz = Math.max(1, Math.round(d / GROUND_CELL));
    const geo = new THREE.PlaneGeometry(w, d, sx, sz).rotateX(-Math.PI / 2).translate((f.x0 + f.x1) / 2, 0, (f.z0 + f.z1) / 2);
    const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color(), a = new THREE.Color(P.grass), b = new THREE.Color(P.grassAlt);
    const dirt = new THREE.Color(P.dirt).multiplyScalar(1.45), dirtAlt = new THREE.Color(P.dirtAlt).multiplyScalar(1.45), // the road reads as a road in the dark: lighter than the clearing's earth
      sand = new THREE.Color(SAND), stone = new THREE.Color(P.stone);
    const road = r.road ?? null, square = r.safe?.[0], fen = r.id === 'dunmere', wood = r.id === 'thornwick', barrow = r.id === 'barrowdowns', moor = r.id === 'highmoor', waste = r.id === 'cairnwaste', spire = r.id === 'spire';
    if (fen) { a.set(FEN.moss); b.set(FEN.mossAlt); } else if (wood) { a.set(WOOD_FLOOR.litter); b.set(WOOD_FLOOR.litterAlt); }
    else if (barrow) { a.set(BARROW_FLOOR.turf); b.set(BARROW_FLOOR.turfAlt); } else if (moor) { a.set(MOOR_FLOOR.heath); b.set(MOOR_FLOOR.heathAlt); }
    else if (waste) { a.set(WASTE_FLOOR.ash); b.set(WASTE_FLOOR.ashAlt); } else if (spire) { a.set(SPIRE_FLOOR.slate); b.set(SPIRE_FLOOR.slateAlt); }
    const drift = new THREE.Color(WASTE_FLOOR.drift), char = new THREE.Color(WASTE_FLOOR.char), ruinGround = new THREE.Color(SPIRE_FLOOR.ruin);
    const peat = new THREE.Color(barrow ? BARROW_FLOOR.peat : FEN.peat), stain = new THREE.Color(FEN.stain), loam = new THREE.Color(WOOD_FLOOR.loam), heather = new THREE.Color(MOOR_FLOOR.heather);
    const earth = new THREE.Color(P.dirt);   // bare ground showing through worn turf, unlike `dirt` above it is not lightened: it is a patch, not a road
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v), z = pos.getZ(v), j = hash(x * 12.9898 + z * 78.233);
      c.copy(a).lerp(b, groundDrift(x, z) * 0.8 + j * 0.2);   // the two tones in drifts, not a dapple: the jitter only breaks the drift's edge
      if (!fen && !wood && !barrow && !waste && !spire) c.lerp(earth, THREE.MathUtils.clamp((groundDrift(x, z, 7) - 0.64) * 2.6, 0, 0.5));   // earth through the thin of it, where the region has no second ground of its own
      if (fen) { // peat in the hollows, and the ground the Withering patches have killed
        c.lerp(peat, THREE.MathUtils.clamp((groundDrift(x, z, 2) - 0.55) * 2.2, 0, 0.7));
        for (const h of r.hazards ?? []) { const k = THREE.MathUtils.clamp((h.r + 2.2 - Math.hypot(x - h.x, z - h.z)) / 3, 0, 1); if (k > 0) c.lerp(stain, k * 0.85); }
      }
      if (barrow) c.lerp(peat, THREE.MathUtils.clamp((groundDrift(x, z, 2) - 0.5) * 1.6, 0, 0.5)); // peat in the low ground between the mounds
      if (waste) { // pale ash in long drifts, and scorched black where the stone shows through
        c.lerp(drift, THREE.MathUtils.clamp((groundDrift(x, z * 0.6, 5) - 0.5) * 1.5, 0, 0.5));   // z squeezed: the drifts run east to west, as blown ash does
        c.lerp(char, THREE.MathUtils.clamp((groundDrift(x, z, 6) - 0.62) * 2.2, 0, 0.6));
      }
      if (road) {
        const off = road.axis === 'x' ? Math.abs(z - road.at) : Math.abs(x - road.at); // distance from the road's centre line
        const k = THREE.MathUtils.clamp((4.2 - off) / 2.4, 0, 1) + (r.id === 'greywater' && x < 52 ? 0.6 : 0); // the road, and the dirt of Hale's gate yard
        if (k > 0) c.lerp(dirt.clone().lerp(dirtAlt, j), Math.min(1, k) * (off < 12 ? 1 : 0));
      } else if (wood) {
        c.lerp(loam, groundDrift(x, z, 3) * 0.35); // loam showing through the litter
        if (square) { const k = THREE.MathUtils.clamp((square.r - Math.hypot(x - square.x, z - square.z)) / 8, 0, 1); if (k > 0) c.lerp(stone.clone().lerp(dirtAlt, j * 0.6), k * 0.8); }
        if (Math.abs(x - THORNWICK.x) < 3.6 && z < square!.z) c.lerp(dirt, 0.9); // the road in from the north
      } else if (moor) {
        c.lerp(heather, THREE.MathUtils.clamp((groundDrift(x, z, 4) - 0.45) * 1.4, 0, 0.55)); // heather in drifts across the heath
        if (square) { const k = THREE.MathUtils.clamp((square.r - Math.hypot(x - square.x, z - square.z)) / 8, 0, 1); if (k > 0) c.lerp(stone.clone().lerp(dirtAlt, j * 0.6), k * 0.8); }
        if (Math.abs(z - HIGHMOOR.z) < 3.6 && x < square!.x) c.lerp(dirt, 0.9); // the road in from the west
      } else if (spire) {
        c.lerp(ruinGround, THREE.MathUtils.clamp((square!.z - 20 - z) / 30, 0, 0.8)); // the ground goes dark and broken toward the ruins in the north
        const k = THREE.MathUtils.clamp((square!.r - Math.hypot(x - square!.x, z - square!.z)) / 8, 0, 1); if (k > 0) c.lerp(stone.clone().lerp(dirtAlt, j * 0.6), k * 0.8);
        if (Math.abs(x - SPIRE.x) < 3.6 && z > square!.z) c.lerp(dirt, 0.9); // the road in from the south
      } else {
        if (x > SALTMARROW.x + 6) c.lerp(sand, THREE.MathUtils.clamp((x - SALTMARROW.x - 6) / 10, 0, 1)); // the beach
        if (square) { const k = THREE.MathUtils.clamp((square.r - Math.hypot(x - square.x, z - square.z)) / 8, 0, 1); if (k > 0) c.lerp(stone.clone().lerp(dirtAlt, j * 0.6), k * 0.8); }
        if (Math.abs(z - (SALTMARROW.z)) < 3.6 && x > SALTMARROW.x - 70 && x < SALTMARROW.x - 36) c.lerp(dirt, 0.9); // the way in from the road
      }
      c.toArray(col, v * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = this.kit.mesh(geo, 0xffffff, 'ground', 'receive');
    (m.material as THREE.MeshStandardMaterial).vertexColors = true;
    return m;
  }

  /** Obstacles by what they are, merged into one draw per material; the road's waymarks ride with the slab they stand in. */
  private scenery(obs: Obstacle[], rect: Rect, r: Region, add: (o: THREE.Object3D) => void) {
    const bag = newBag();
    obs.forEach((o, i) => {
      const h = hash(o.x * 3.1 + o.z * 7.7), ry = h * Math.PI * 2;
      switch (o.kind) {
        case 'person': return;
        case 'thornoak': placeProp(bag, 'thornoak', o.x, o.z, ry, 0.9 + hash(i + 11) * 0.3); return;
        case 'alembic': placeProp(bag, 'alembic', o.x, o.z, Math.atan2(LANDMARKS.thornSquare.x - o.x, LANDMARKS.thornSquare.z - o.z) - Math.PI / 2); return; // the bench's front (+z in its own frame) faces the square
        case 'rack': return; // the station's collider: highmoorTown draws the racks
        case 'forge': return; // the station's collider: render.ts draws the forge
        case 'circle': return; // the station's collider: spireTown draws the rune circle
        case 'tower': return; // the tower's collider: spireTown draws the tower
        case 'ruin': // the wastes' cairns are heaps of black stone, the Spire's ruins broken marble columns
          if (r.id === 'spire') this.brokenColumn(bag, o, ry, i); else this.blackCairn(bag, o, ry);
          return;
        case 'tree': { // a dead tree, bent inland by the wind off the sea: a leaning trunk and two bare limbs
          bag.bark.push(place(new THREE.CylinderGeometry(0.14, 0.26, 3.2, 5).rotateZ(0.14).translate(-0.22, 0, 0), o.x, 1.6, o.z),
            place(new THREE.CylinderGeometry(0.05, 0.1, 1.6, 4).rotateZ(0.9), o.x + Math.cos(ry) * 0.5 - 0.35, 2.6, o.z - Math.sin(ry) * 0.5, ry),
            place(new THREE.CylinderGeometry(0.04, 0.09, 1.3, 4).rotateZ(-1.0), o.x - Math.cos(ry) * 0.4 - 0.35, 2.2, o.z + Math.sin(ry) * 0.4, ry));
          return;
        }
        case 'barrow': { // a turf mound ringed with kerbstones, its black mouth between two standing stones under a lintel, facing the road
          const rz = (mainRect(r).z0 + mainRect(r).z1) / 2, dir = o.z > rz ? -1 : 1, mz = o.z + dir * o.r * 0.8;
          bag.turf.push(place(new THREE.SphereGeometry(1, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), o.x, 0, o.z, ry, o.r * 1.1, o.r * 0.7, o.r * 1.1));
          for (let n = 0; n < 11; n++) {
            const a = n * Math.PI * 2 / 11 + ry;
            if (dir * Math.cos(a) > 0.8) continue; // not across the mouth
            bag.rock.push(place(new THREE.BoxGeometry(0.9, 0.7, 0.55), o.x + Math.sin(a) * o.r * 1.08, 0.3, o.z + Math.cos(a) * o.r * 1.08, a));
          }
          // the jambs and lintel are pale stone: a black door only reads as a door against something lighter than the dusk round it (HOM-100)
          for (const s of [-1, 1]) bag.jamb.push(place(new THREE.BoxGeometry(0.6, 2.4, 0.7), o.x + s * 1.15, 1.2, mz, 0.08 * s));
          bag.jamb.push(place(new THREE.BoxGeometry(3.3, 0.55, 0.9), o.x, 2.55, mz));
          bag.dark.push(place(new THREE.BoxGeometry(1.7, 0.06, 2.4), o.x, 0.03, mz + dir * 1.2)); // the threshold, trodden black, so the mouth has a floor in front of it
          bag.dark.push(place(new THREE.BoxGeometry(1.7, 2.1, 1.2), o.x, 1.05, mz - dir * 0.3));
          // half the mounds have been opened and a pair of torches left burning at the mouth: the only warm light in grave country, and what tells one barrow from the next at range
          if (h < 0.5) for (const s of [-1, 1]) torchPost(bag, o.x + s * 2.4, mz + dir * 0.5, 0, 4);
          return;
        }
        case 'hut': case 'house': case 'inn': building(o, ry * 0.12, bag); return;
        case 'cart': {
          bag.wood.push(place(new THREE.BoxGeometry(2.6, 0.7, 1.4), o.x, 0.9, o.z, ry), place(new THREE.CylinderGeometry(0.55, 0.55, 0.15, 8).rotateX(Math.PI / 2), o.x, 0.55, o.z + 0.8, ry), place(new THREE.CylinderGeometry(0.55, 0.55, 0.15, 8).rotateX(Math.PI / 2), o.x, 0.55, o.z - 0.8, ry));
          return;
        }
        case 'crate': bag.wood.push(place(new THREE.BoxGeometry(1.3, 1.1, 1.3), o.x, 0.55, o.z, ry), place(new THREE.BoxGeometry(1.4, 0.12, 0.3), o.x, 1.15, o.z, ry), place(new THREE.BoxGeometry(0.3, 0.12, 1.4), o.x, 1.17, o.z, ry)); return;
        case 'hull': boat(o, ry, bag); return;
        case 'grave': bag.rock.push(...headstone(o, ry, i)); return;
        default: { // a rock: a faceted lump a little wider than the circle the sim collides with
          const s = o.r * (1.15 + hash(i + 3) * 0.3);
          bag.rock.push(place(new THREE.DodecahedronGeometry(1), o.x, s * 0.5, o.z, ry, s, s * (0.7 + hash(i + 9) * 0.35), s));
        }
      }
    });
    if (r.road) this.waymarks(bag, rect, mainRect(r), r.road.axis, r.id === 'greywater' ? 100 : 0);
    if (r.id === 'greywater' || r.id === 'saltmarrow') this.roadDressing(bag, rect, r);
    if (r.id === 'dunmere') this.fenDressing(bag, rect, r);
    if (r.id === 'thornwick') this.woodDressing(bag, rect, r);
    if (r.id === 'barrowdowns') this.barrowDressing(bag, rect, r);
    if (r.id === 'highmoor') this.moorDressing(bag, rect, r);
    if (r.id === 'cairnwaste') this.wasteDressing(bag, rect, r);
    if (r.id === 'spire') this.spireDressing(bag, rect, r);
    this.emit(bag, add, r.id === 'thornwick' ? THORN_PAL : r.id === 'highmoor' ? MOOR_PAL : r.id === 'spire' ? SPIRE_PAL : SALT_PAL);
  }

  /** A milestone every 80 units down the road, on its verge: a squared post with a board pointing on. How far from home the player is, in a thing they pass. `skip`: nearer than this to the origin Hale's gate has its own. */
  private waymarks(bag: Bag, rect: Rect, main: Rect, axis: 'x' | 'z', skip: number) {
    const lo = axis === 'x' ? rect.x0 : rect.z0, hi = axis === 'x' ? rect.x1 : rect.z1, road = axis === 'x' ? (main.z0 + main.z1) / 2 : (main.x0 + main.x1) / 2;
    for (let s = Math.ceil(lo / 80) * 80; s < hi; s += 80) {
      if (s < skip) continue;
      // on the north verge of an east-west road, the east verge of a north-south one; the board points along the road, on
      const x = axis === 'x' ? s : road + 6.5, z = axis === 'x' ? road - 6.5 : s, rot = axis === 'x' ? 0 : -Math.PI / 2;
      bag.stone.push(place(new THREE.BoxGeometry(0.7, 1.6, 0.7), x, 0.8, z), place(new THREE.BoxGeometry(0.9, 0.2, 0.9), x, 1.7, z));
      bag.wood.push(place(new THREE.BoxGeometry(1.5, 0.32, 0.08).translate(0.45, 1.25, 0.38), x, 0, z, rot), place(new THREE.ConeGeometry(0.2, 0.4, 3).rotateZ(-Math.PI / 2).translate(1.4, 1.25, 0.38), x, 0, z, rot));
    }
  }

  /**
   * The road country's verges. The Greywater Road and the Strand are the two regions with no scatter of their own, so the ground between the
   * waymarks was bare to the boulders: a bush, a dry bush or a tuft of grass in every 9-unit cell, kept off the road itself, the beach, a town
   * square, a camp and anything standing. Waist-high at most and with nothing to collide with, like the Thornwood's brush.
   */
  private roadDressing(bag: Bag, rect: Rect, r: Region) {
    const CELL = 9, camps = r.spawns ?? [], road = r.road, square = r.safe?.[0];
    for (let i = Math.floor(rect.x0 / CELL); i <= Math.floor(rect.x1 / CELL); i++) for (let j = Math.floor(rect.z0 / CELL); j <= Math.floor(rect.z1 / CELL); j++) {
      const k = hash(i * 3.7 + j * 12.1 + 7), x = (i + 0.15 + 0.7 * hash(i * 2.7 + j * 4.3)) * CELL, z = (j + 0.15 + 0.7 * hash(j * 3.9 + i * 2.1)) * CELL;
      if (k > 0.52 || x < rect.x0 || x >= rect.x1 || z < rect.z0 || z >= rect.z1 || !r.footprint.some(f => inside(f, x, z, 2))) continue;
      if (road && Math.abs((road.axis === 'x' ? z : x) - road.at) < 7) continue;
      if (r.id === 'saltmarrow' && x > SALTMARROW.x + 4) continue;   // the beach, the quay and the sea
      if (square && Math.hypot(x - square.x, z - square.z) < square.r + 6) continue;
      if (camps.some(c => Math.hypot(c.x - x, c.z - z) < 5) || r.obstacles.some(o => Math.hypot(o.x - x, o.z - z) < o.r + 1.5)) continue;
      const ry = k * 40;
      if (k < 0.2) placeProp(bag, 'bush', x, z, ry, 0.85 + k * 1.4);
      else if (k < 0.34) placeProp(bag, 'bushDry', x, z, ry, 0.8 + k);
      else for (let n = 0; n < 5; n++) { const a = n * 1.3 + ry; bag.brush.push(place(new THREE.ConeGeometry(0.11, 0.6 + hash(n + k * 8) * 0.3, 3).rotateZ(Math.sin(a) * 0.4).rotateX(Math.cos(a) * 0.4), x + Math.cos(a) * 0.3, 0.3, z + Math.sin(a) * 0.3)); }
    }
  }

  /**
   * The fens' dressing: still pools in the hollows, ringed with reeds. One candidate per 26-unit cell of the world (so a pool belongs to
   * the slab its centre is in, and the same pools are there however the slabs are cut), none on the road, a patch of Withering Ground, a camp or a tree.
   */
  private fenDressing(bag: Bag, rect: Rect, r: Region) {
    const CELL = 26, road = r.road!.at, camps = r.spawns ?? [];
    for (let i = Math.floor(rect.x0 / CELL); i <= Math.floor(rect.x1 / CELL); i++) for (let j = Math.floor(rect.z0 / CELL); j <= Math.floor(rect.z1 / CELL); j++) {
      const k = hash(i * 7.3 + j * 13.1);
      if (k > 0.5) continue;
      const x = (i + 0.2 + 0.6 * hash(i * 3.1 + j)) * CELL, z = (j + 0.2 + 0.6 * hash(j * 5.7 + i)) * CELL, rad = 2.6 + k * 6;
      if (x < rect.x0 || x >= rect.x1 || z < rect.z0 || z >= rect.z1 || Math.abs(x - road) < rad + 8) continue;
      if (!r.footprint.some(f => inside(f, x, z, rad))) continue;
      if ((r.hazards ?? []).some(h => Math.hypot(h.x - x, h.z - z) < h.r + rad + 1.5) || camps.some(c => Math.hypot(c.x - x, c.z - z) < rad + 6) || r.obstacles.some(o => Math.hypot(o.x - x, o.z - z) < o.r + rad + 1)) continue;
      bag.water.push(place(new THREE.CircleGeometry(rad, 14).rotateX(-Math.PI / 2).scale(1, 1, 0.7 + 0.3 * hash(i + j * 2.3)), x, 0.03, z, hash(i * 9.1 + j) * Math.PI));
      bag.pool.push(lampPool(x, z, rad * 1.8, 0.2, 0.5, FEN.mist)); // the mist that sits on still water: the one pale thing in a fen
      for (let n = 0; n < 5; n++) { const a = n * 2.4 + k * 10, d = rad * (0.9 + 0.3 * hash(n + k * 7)); reedClump(bag, x + Math.cos(a) * d, z + Math.sin(a) * d * 0.7, i * 17 + j * 5 + n); }
    }
    // reed beds and snags across the open ground, so the fen is never bare to the horizon: one candidate per 11-unit cell
    const free = (x: number, z: number, pad: number) => x >= rect.x0 && x < rect.x1 && z >= rect.z0 && z < rect.z1 && Math.abs(x - road) > 6 && r.footprint.some(f => inside(f, x, z, 2))
      && !(r.hazards ?? []).some(h => Math.hypot(h.x - x, h.z - z) < h.r + pad) && !camps.some(c => Math.hypot(c.x - x, c.z - z) < 4) && !r.obstacles.some(o => Math.hypot(o.x - x, o.z - z) < o.r + pad);
    const SCATTER = 11;
    for (let i = Math.floor(rect.x0 / SCATTER); i <= Math.floor(rect.x1 / SCATTER); i++) for (let j = Math.floor(rect.z0 / SCATTER); j <= Math.floor(rect.z1 / SCATTER); j++) {
      const k = hash(i * 4.1 + j * 9.7 + 3), x = (i + 0.15 + 0.7 * hash(i * 2.3 + j * 1.7)) * SCATTER, z = (j + 0.15 + 0.7 * hash(j * 6.1 + i * 3.9)) * SCATTER;
      if (k > 0.5 || !free(x, z, 1.5)) continue;
      if (k < 0.07) snag(bag, x, z, i * 31 + j);
      else if (k < 0.12) bag.rock.push(place(new THREE.DodecahedronGeometry(1), x, 0.25, z, k * 40, 0.8 + k * 3, 0.45, 0.7 + k * 2));
      else for (let n = 0; n < 2 + Math.floor(k * 6); n++) reedClump(bag, x + (hash(n + k * 9) - 0.5) * 3, z + (hash(n * 3 + k * 5) - 0.5) * 3, i * 13 + j * 7 + n);
    }
    // Withering Ground, told apart from far off without the overlay: a ring of bone-pale stakes on the rim, and dead stalks standing in the stain
    for (const h of r.hazards ?? []) {
      if (h.x < rect.x0 || h.x >= rect.x1 || h.z < rect.z0 || h.z >= rect.z1) continue;
      for (let n = 0; n < 12; n++) {
        const a = n * Math.PI / 6 + hash(h.x + n) * 0.3, out = 0.25 * (n % 2 ? 1 : -1);
        bag.bone.push(place(new THREE.ConeGeometry(0.14, 1.9 + hash(n + h.z) * 0.8, 4).rotateZ(Math.sin(a) * out).rotateX(-Math.cos(a) * out), h.x + Math.cos(a) * (h.r + 0.2), 1.1, h.z + Math.sin(a) * (h.r + 0.2)));
      }
      for (let n = 0; n < 10; n++) {
        const a = n * 2.4, d = h.r * (0.2 + 0.7 * hash(n * 5 + h.x)), lean = (hash(n + h.z) - 0.5) * 0.8;
        bag.bone.push(place(new THREE.ConeGeometry(0.06, 0.9, 3).rotateZ(lean), h.x + Math.cos(a) * d, 0.45, h.z + Math.sin(a) * d));
      }
    }
  }

  /**
   * The Thornwood's undergrowth, the opposite of the fens' open reed: brambles, fallen boughs and close brush in every 7-unit cell, none in the town, on the road in,
   * at the east gate, or crowding a thornoak or a camp. Low (under a person's waist), so an enemy is never hidden behind it, and with nothing to collide with.
   */
  private woodDressing(bag: Bag, rect: Rect, r: Region) {
    const CELL = 7, sq = LANDMARKS.thornSquare, camps = r.spawns ?? [], herbs = r.herbs ?? [];
    for (let i = Math.floor(rect.x0 / CELL); i <= Math.floor(rect.x1 / CELL); i++) for (let j = Math.floor(rect.z0 / CELL); j <= Math.floor(rect.z1 / CELL); j++) {
      const k = hash(i * 5.3 + j * 11.9 + 1), x = (i + 0.15 + 0.7 * hash(i * 3.3 + j * 2.1)) * CELL, z = (j + 0.15 + 0.7 * hash(j * 4.7 + i * 1.3)) * CELL;
      if (k > 0.68 || x < rect.x0 || x >= rect.x1 || z < rect.z0 || z >= rect.z1 || !r.footprint.some(f => inside(f, x, z, 2))) continue;
      if (Math.hypot(x - sq.x, z - sq.z) < 38 || (Math.abs(x - THORNWICK.x) < 6 && z < THORNWICK.z - 20) || (x > THORNWICK.x + 52 && Math.abs(z - THORNWICK.z) < 9)) continue;
      if (camps.some(c => Math.hypot(c.x - x, c.z - z) < 5) || herbs.some(h => Math.hypot(h.x - x, h.z - z) < 3) || r.obstacles.some(o => Math.hypot(o.x - x, o.z - z) < o.r + 1.5)) continue;
      const ry = k * 40;
      if (k < 0.34) { // a bramble: a mound of leaf with thorn canes arching out of it
        bag.brush.push(place(new THREE.IcosahedronGeometry(1, 0), x, 0.35, z, ry, 0.9 + k * 1.5, 0.55, 0.9 + k * 1.2));
        for (let n = 0; n < 7; n++) { const a = n * 0.9 + ry; bag.thorn.push(place(new THREE.ConeGeometry(0.06, 1.3 + hash(n + i * 3 + j) * 0.7, 3).rotateZ(Math.sin(a) * 0.9).rotateX(Math.cos(a) * 0.9), x + Math.cos(a) * 0.6, 0.7, z + Math.sin(a) * 0.6)); }
      } else if (k < 0.47) { // a fallen bough: a trunk on the ground with a broken limb
        bag.bark.push(place(new THREE.CylinderGeometry(0.22, 0.3, 3.6, 5).rotateZ(Math.PI / 2 - 0.05), x, 0.28, z, ry), place(new THREE.CylinderGeometry(0.06, 0.1, 1.2, 4).rotateZ(0.9), x + Math.cos(ry) * 0.8, 0.7, z - Math.sin(ry) * 0.8, ry));
      } else if (k < 0.6) { // close brush: a fan of dark fronds
        for (let n = 0; n < 6; n++) { const a = n * 1.05 + ry; bag.brush.push(place(new THREE.ConeGeometry(0.2, 1.1, 3).rotateZ(Math.sin(a) * 0.55).rotateX(Math.cos(a) * 0.55), x + Math.cos(a) * 0.3, 0.55, z + Math.sin(a) * 0.3)); }
      } else placeProp(bag, 'bush', x, z, ry, 0.9 + hash(i * 2.2 + j) * 0.5); // a bush in leaf under the canopy
    }
  }

  /**
   * The Barrowdowns' grave country: standing stones (some with a second leaning on them), cairns, leaning headstones, dead thorns and scattered bone in every 12-unit cell, none on the road,
   * a camp, a mound or a vein. Thin or low enough that no enemy hides behind it, and with nothing to collide with. The barrows themselves are the sim's obstacles, drawn in `scenery`.
   */
  private barrowDressing(bag: Bag, rect: Rect, r: Region) {
    const CELL = 12, road = r.road!.at, camps = r.spawns ?? [];
    for (let i = Math.floor(rect.x0 / CELL); i <= Math.floor(rect.x1 / CELL); i++) for (let j = Math.floor(rect.z0 / CELL); j <= Math.floor(rect.z1 / CELL); j++) {
      const k = hash(i * 6.1 + j * 10.3 + 2), x = (i + 0.15 + 0.7 * hash(i * 2.9 + j * 1.9)) * CELL, z = (j + 0.15 + 0.7 * hash(j * 5.3 + i * 3.7)) * CELL;
      if (k > 0.5 || x < rect.x0 || x >= rect.x1 || z < rect.z0 || z >= rect.z1 || Math.abs(z - road) < 8 || !r.footprint.some(f => inside(f, x, z, 2))) continue;
      if (camps.some(c => Math.hypot(c.x - x, c.z - z) < 6) || r.obstacles.some(o => Math.hypot(o.x - x, o.z - z) < o.r + 2.5) || (r.rocks ?? []).some(o => Math.hypot(o.x - x, o.z - z) < 5)) continue;
      const ry = k * 40;
      if (k < 0.14) { // a standing stone, with a shorter one leaning against it
        bag.rock.push(place(new THREE.BoxGeometry(0.9, 3.4 + k * 8, 0.55).rotateZ((k - 0.07) * 0.5), x, 1.8, z, ry), place(new THREE.BoxGeometry(0.7, 1.7, 0.45).rotateZ(0.2), x + 1.1, 0.85, z, ry));
      } else if (k < 0.24) { // a cairn: three stones and a capstone
        for (let n = 0; n < 3; n++) bag.rock.push(place(new THREE.DodecahedronGeometry(1), x + Math.cos(n * 2.1) * 0.8, 0.4, z + Math.sin(n * 2.1) * 0.8, ry + n, 0.75, 0.5, 0.75));
        bag.rock.push(place(new THREE.DodecahedronGeometry(1), x, 1.2, z, ry, 0.55, 0.5, 0.55));
      } else if (k < 0.34) { // a leaning headstone
        bag.rock.push(...headstone({ x, z, r: 0.5, kind: 'grave' }, ry, i + j));
      } else if (k < 0.42) snag(bag, x, z, i * 29 + j);
      else for (let n = 0; n < 4; n++) { const a = n * 1.7 + ry; bag.bone.push(place(new THREE.ConeGeometry(0.07, 0.8, 3).rotateZ(Math.PI / 2 - 0.1 * n), x + Math.cos(a) * 0.5, 0.12, z + Math.sin(a) * 0.5, a)); } // scattered bone
    }
  }

  /** Highmoor's heath: heather in drifts, loose stones and runs of drystone wall in every 6-unit cell, none in the square, on the road in, on a camp or a boulder. */
  private moorDressing(bag: Bag, rect: Rect, r: Region) {
    const CELL = 6, camps = r.spawns ?? [], sq = LANDMARKS.highSquare;
    for (let i = Math.floor(rect.x0 / CELL); i <= Math.floor(rect.x1 / CELL); i++) for (let j = Math.floor(rect.z0 / CELL); j <= Math.floor(rect.z1 / CELL); j++) {
      const k = hash(i * 4.9 + j * 8.3 + 5), x = (i + 0.15 + 0.7 * hash(i * 3.7 + j * 2.3)) * CELL, z = (j + 0.15 + 0.7 * hash(j * 6.1 + i * 1.1)) * CELL;
      if (k > 0.62 || x < rect.x0 || x >= rect.x1 || z < rect.z0 || z >= rect.z1 || !r.footprint.some(f => inside(f, x, z, 2))) continue;
      if (Math.hypot(x - sq.x, z - sq.z) < 14 || (Math.abs(z - HIGHMOOR.z) < 5 && x < HIGHMOOR.x + 12) || camps.some(c => Math.hypot(c.x - x, c.z - z) < 4) || r.obstacles.some(o => Math.hypot(o.x - x, o.z - z) < o.r + 1.5)) continue;
      const ry = k * 50;
      if (k < 0.4) for (let n = 0; n < 5; n++) { const a = n * 1.3 + ry; bag.heather.push(place(new THREE.IcosahedronGeometry(1, 0), x + Math.cos(a) * 0.7, 0.25, z + Math.sin(a) * 0.7, a, 0.55 + hash(n + k * 9) * 0.3, 0.32, 0.55)); }
      else if (k < 0.48) for (let n = 0; n < 3; n++) bag.rock.push(place(new THREE.DodecahedronGeometry(1), x + n * 0.9, 0.2, z + (n % 2) * 0.5, ry + n, 0.5 + hash(n + k) * 0.4, 0.3, 0.5));
      else if (k < 0.55) bag.rock.push(place(new THREE.BoxGeometry(1.8, 0.6, 0.45), x, 0.3, z, ry), place(new THREE.BoxGeometry(1.4, 0.45, 0.45), x + 1.7, 0.22, z + 0.2, ry + 0.2));
      else placeProp(bag, 'bushDry', x, z, ry, 0.75 + hash(i + j * 3.3) * 0.4); // gorse, half bare: what grows on a heath that cannot keep a leaf
    }
  }

  /** A cairn of the wastes: a heap of black stone, wide at the foot and narrowing to a capstone, with a slab standing against it on the side the road is. */
  private blackCairn(bag: Bag, o: Obstacle, ry: number) {
    for (let n = 0; n < 6; n++) { const a = n * 1.05 + ry, d = o.r * 0.55; bag.cairn.push(place(new THREE.DodecahedronGeometry(1), o.x + Math.cos(a) * d, 0.55, o.z + Math.sin(a) * d, a, o.r * 0.55, o.r * 0.42, o.r * 0.55)); }
    for (let n = 0; n < 3; n++) { const a = n * 2.1 + ry; bag.cairn.push(place(new THREE.DodecahedronGeometry(1), o.x + Math.cos(a) * o.r * 0.25, o.r * 0.55 + 0.7, o.z + Math.sin(a) * o.r * 0.25, a, o.r * 0.42, o.r * 0.34, o.r * 0.42)); }
    bag.cairn.push(place(new THREE.DodecahedronGeometry(1), o.x, o.r * 0.95 + 0.9, o.z, ry, o.r * 0.3, o.r * 0.26, o.r * 0.3));
    bag.cairn.push(place(new THREE.BoxGeometry(0.9, 2.6 + o.r * 0.4, 0.45).rotateZ(0.08), o.x + Math.cos(ry) * (o.r + 0.5), (2.6 + o.r * 0.4) / 2, o.z + Math.sin(ry) * (o.r + 0.5), ry));
  }

  /** One of the Spire's broken columns: a plinth, a fluted drum snapped off at a slant, and two drums fallen beside it. Pale marble, the lightest thing in the ruins. */
  private brokenColumn(bag: Bag, o: Obstacle, ry: number, i: number) {
    const h = 2.4 + hash(i * 3 + 1) * 2.8, rad = Math.max(0.5, o.r * 0.6);
    bag.marble.push(place(new THREE.BoxGeometry(rad * 2.8, 0.4, rad * 2.8), o.x, 0.2, o.z, ry));
    bag.marble.push(place(new THREE.CylinderGeometry(rad * 0.85, rad, h, 8), o.x, 0.4 + h / 2, o.z, ry));
    bag.marble.push(place(new THREE.CylinderGeometry(rad * 0.85, rad * 0.85, 0.7, 8).rotateZ(0.5), o.x, 0.4 + h + 0.15, o.z, ry)); // the break: a drum left leaning on the top
    for (let n = 0; n < 2; n++) bag.marble.push(place(new THREE.CylinderGeometry(rad * 0.85, rad * 0.85, 1.1 + n * 0.5, 8).rotateZ(Math.PI / 2), o.x + Math.cos(ry + n * 2.4) * (rad + 1.2), rad * 0.85, o.z + Math.sin(ry + n * 2.4) * (rad + 1.2), ry + n));
  }

  /** The Cairnwaste's open ground: black standing slabs (one leaning on another), bleached snags and scattered black shards in every 12-unit cell, none on the road, a camp, a cairn or a vein. Low or thin enough that no enemy hides behind it. */
  private wasteDressing(bag: Bag, rect: Rect, r: Region) {
    const CELL = 12, road = r.road!.at, camps = r.spawns ?? [];
    for (let i = Math.floor(rect.x0 / CELL); i <= Math.floor(rect.x1 / CELL); i++) for (let j = Math.floor(rect.z0 / CELL); j <= Math.floor(rect.z1 / CELL); j++) {
      const k = hash(i * 6.7 + j * 9.1 + 7), x = (i + 0.15 + 0.7 * hash(i * 2.3 + j * 1.3)) * CELL, z = (j + 0.15 + 0.7 * hash(j * 5.9 + i * 3.1)) * CELL;
      if (k > 0.5 || x < rect.x0 || x >= rect.x1 || z < rect.z0 || z >= rect.z1 || Math.abs(x - road) < 8 || !r.footprint.some(f => inside(f, x, z, 2))) continue;
      if (camps.some(c => Math.hypot(c.x - x, c.z - z) < 6) || r.obstacles.some(o => Math.hypot(o.x - x, o.z - z) < o.r + 2.5) || (r.rocks ?? []).some(o => Math.hypot(o.x - x, o.z - z) < 5)) continue;
      const ry = k * 40;
      if (k < 0.16) bag.cairn.push(place(new THREE.BoxGeometry(1.1, 3 + k * 10, 0.6).rotateZ((k - 0.08) * 0.6), x, 1.6, z, ry), place(new THREE.BoxGeometry(0.8, 1.6, 0.5).rotateZ(0.25), x + 1.2, 0.8, z, ry)); // a standing slab, with a shorter one against it
      else if (k < 0.3) snag(bag, x, z, i * 23 + j);
      else for (let n = 0; n < 4; n++) { const a = n * 1.9 + ry; bag.cairn.push(place(new THREE.DodecahedronGeometry(1), x + Math.cos(a) * 0.8, 0.16, z + Math.sin(a) * 0.8, a, 0.4 + hash(n + k * 7) * 0.35, 0.22, 0.4)); } // black shards in the ash
    }
  }

  /** The ruins north of the Spire's square: low wall stubs, fallen blocks and rubble in every 7-unit cell, none in the town, on a camp, a column or the Vault's corridor. Under a person's waist, so nothing hides behind it. */
  private spireDressing(bag: Bag, rect: Rect, r: Region) {
    const CELL = 7, sq = LANDMARKS.spireSquare, camps = r.spawns ?? [];
    for (let i = Math.floor(rect.x0 / CELL); i <= Math.floor(rect.x1 / CELL); i++) for (let j = Math.floor(rect.z0 / CELL); j <= Math.floor(rect.z1 / CELL); j++) {
      const k = hash(i * 5.1 + j * 8.7 + 9), x = (i + 0.15 + 0.7 * hash(i * 3.9 + j * 2.7)) * CELL, z = (j + 0.15 + 0.7 * hash(j * 6.3 + i * 1.9)) * CELL;
      if (k > 0.55 || x < rect.x0 || x >= rect.x1 || z < rect.z0 || z >= rect.z1 || !r.footprint.some(f => inside(f, x, z, 2))) continue;
      if (Math.hypot(x - sq.x, z - sq.z) < 40 || (Math.abs(x - SPIRE.x) < 6 && z < SPIRE.z - 40) || camps.some(c => Math.hypot(c.x - x, c.z - z) < 4) || r.obstacles.some(o => Math.hypot(o.x - x, o.z - z) < o.r + 1.5)) continue;
      const ry = k * 50;
      if (k < 0.2) bag.marble.push(place(new THREE.BoxGeometry(2.4, 0.7, 0.55), x, 0.35, z, ry), place(new THREE.BoxGeometry(1.5, 0.45, 0.55), x + 2.1, 0.22, z + 0.2, ry + 0.2)); // a wall stub
      else if (k < 0.34) bag.marble.push(place(new THREE.BoxGeometry(1.3, 0.6, 0.9), x, 0.3, z, ry), place(new THREE.BoxGeometry(0.9, 0.5, 0.7), x + 1.1, 0.25, z + 0.5, ry + 0.6)); // fallen blocks
      else for (let n = 0; n < 4; n++) bag.rock.push(place(new THREE.DodecahedronGeometry(1), x + n * 0.7, 0.18, z + (n % 2) * 0.5, ry + n, 0.4 + hash(n + k) * 0.3, 0.26, 0.4)); // rubble
    }
  }

  /**
   * The Sundered Spire's square: its flight master by the road in, the Keeper and the provisioner, the stump of the Spire itself in the middle (a drum of pale stone snapped off at the height of a house,
   * with the fallen top lying beside it), a lamp by every person and one at the forge, and a lamp every 13 units down the road from the south. (The Vault's keeper stands at his gate.)
   */
  private spireTown(t: Tile, add: (o: THREE.Object3D) => void) {
    const sq = LANDMARKS.spireSquare, fm = LANDMARKS.flightSpire, bag = newBag();
    add(((g: THREE.Group) => { g.traverse(o => { o.userData.id = 'spire'; }); return g; })(flightMasterFigure(this.kit, fm, sq, t.picks.flight)));
    lampPost(bag, fm.x + 1.4, fm.z - 1.1, 0, 6);
    const toward = (at: { x: number; z: number }) => Math.atan2(sq.x - at.x, sq.z - at.z + 0.01) + Math.PI;
    this.person(add, LANDMARKS.spireKeeper, 0x4a3a62, 'cap', toward(LANDMARKS.spireKeeper), t.picks.npc, 'spire', 0x2a2040);
    this.person(add, LANDMARKS.spireVendor, 0x5a5a38, 'brim', toward(LANDMARKS.spireVendor), t.picks.vendor, 'spire');
    for (const l of [LANDMARKS.spireKeeper, LANDMARKS.spireVendor]) lampPost(bag, l.x + 1.4, l.z - 1.1, 0, 6);
    lampPost(bag, LANDMARKS.forgeSpire.x - 2.4, LANDMARKS.forgeSpire.z + 3.2, 0, 5); // the smith works late
    this.spireTower(bag, sq);
    this.runeCircle(bag, LANDMARKS.circle);
    for (let n = 0, z = SPIRE.z + 66; z > sq.z + 6; n++, z -= 13) lampPost(bag, SPIRE.x + (n % 2 ? 4.4 : -4.4), z, 0, 5.5);
    this.emit(bag, add, SPIRE_PAL);
  }

  /**
   * What is left of the Spire: a stepped plinth, a tall shaft cut by dark window slits and held by four leaning buttresses, a jagged crown, a seam of cold rune light up one side, and the sundering itself, a ring of
   * stones and a core of arcane light hung in the air over the break. The tallest thing in the game's last town: it is seen from the road in, and from the Vault's door. Same footprint as the old stump.
   */
  private spireTower(bag: Bag, sq: { x: number; z: number }) {
    const H = 11;
    bag.marble.push(place(new THREE.CylinderGeometry(5.4, 5.8, 0.5, 10), sq.x, 0.25, sq.z), place(new THREE.CylinderGeometry(4.4, 4.8, 0.5, 10), sq.x, 0.75, sq.z));
    bag.marble.push(place(new THREE.CylinderGeometry(2.7, 3.3, H, 10), sq.x, 1 + H / 2, sq.z));
    for (let n = 0; n < 4; n++) { const a = n * Math.PI / 2 + 0.4, lean = 0.16; bag.marble.push(place(new THREE.BoxGeometry(0.9, 7.5 - n * 0.9, 1.4).rotateZ(lean), sq.x + Math.cos(a) * 3.8, 1 + (7.5 - n * 0.9) / 2, sq.z + Math.sin(a) * 3.8, -a + Math.PI / 2)); }
    for (let n = 0; n < 5; n++) { const a = n * 1.26 + 0.9, y = 4.5 + (n % 3) * 2.2; bag.dark.push(place(new THREE.BoxGeometry(0.5, 1.8, 0.5), sq.x + Math.cos(a) * 2.75, y, sq.z + Math.sin(a) * 2.75, -a)); } // window slits
    for (let n = 0; n < 7; n++) { const a = n * 0.9 + 0.2, h = 1.2 + hash(n * 3.3) * 3 + (n % 2) * 1.3; bag.marble.push(place(new THREE.BoxGeometry(1.1, h, 0.7), sq.x + Math.cos(a) * 2.3, 1 + H + h / 2 - 0.3, sq.z + Math.sin(a) * 2.3, -a, 1, 1, 1)); } // the crown, torn
    bag.rune.push(place(new THREE.BoxGeometry(0.16, H - 1.5, 0.12), sq.x + 2.78, 1 + H / 2, sq.z - 0.2, 0)); // a seam of rune light up the shaft
    for (let n = 0; n < 7; n++) { const a = n * 0.9, r = 4 + hash(n * 7.1) * 1.8, y = 14 + (n % 3) * 1.8 + hash(n) * 1.5; bag.marble.push(place(new THREE.DodecahedronGeometry(1), sq.x + Math.cos(a) * r, y, sq.z + Math.sin(a) * r, a, 0.45 + hash(n + 2) * 0.5, 0.35 + hash(n + 4) * 0.4, 0.4)); }
    bag.rune.push(place(new THREE.OctahedronGeometry(1.1), sq.x, 16.5, sq.z, 0.4, 1, 1.6, 1));
    bag.marble.push(place(new THREE.CylinderGeometry(2.1, 2.3, 3.4, 10).rotateZ(Math.PI / 2 - 0.1), sq.x + 7, 1.7, sq.z + 3, 0.5)); // the top, fallen on its side
    for (let n = 0; n < 5; n++) { const a = n * 1.3 + 2; bag.marble.push(place(new THREE.BoxGeometry(1.2 + hash(n) * 0.8, 0.6, 0.9), sq.x + Math.cos(a) * 7.5, 0.3, sq.z + Math.sin(a) * 7.5, a)); } // dropped masonry round the plinth
    for (let n = 0; n < 24; n++) { const a = n * Math.PI / 12; bag.rune.push(place(new THREE.PlaneGeometry(0.2, n % 2 ? 0.5 : 0.8).rotateX(-Math.PI / 2), sq.x + Math.sin(a) * 9, RUNE_GROUND, sq.z + Math.cos(a) * 9, a)); } // the tower's own circle, laid in the stones of the square
  }

  /**
   * The rune circle, the tenth skill's one object: a two-tier dais, a bright inner ring and a ring of glyph ticks in cold light, six tall standing stones each cut with a glowing slit and leaning a little
   * inward, and a small sigil of light turning over the centre. Cold violet, never warm: the forge across the square is the only orange.
   */
  private runeCircle(bag: Bag, rc: { x: number; z: number }) {
    bag.marble.push(place(new THREE.CylinderGeometry(2.9, 3.1, 0.25, 12), rc.x, 0.12, rc.z), place(new THREE.CylinderGeometry(2.4, 2.6, 0.25, 12), rc.x, 0.37, rc.z));
    for (const [rad, tube] of [[2.15, 0.07], [1.25, 0.05]]) bag.rune.push(place(new THREE.RingGeometry(rad - tube, rad + tube, 24).rotateX(-Math.PI / 2), rc.x, 0.51, rc.z));
    for (let n = 0; n < 12; n++) { const a = n * Math.PI / 6; bag.rune.push(place(new THREE.PlaneGeometry(0.16, 0.4).rotateX(-Math.PI / 2), rc.x + Math.sin(a) * 1.7, 0.51, rc.z + Math.cos(a) * 1.7, a)); }
    for (let n = 0; n < 6; n++) {
      const a = n * Math.PI / 3 + 0.3, h = 2.4 + (n % 3) * 0.7, x = rc.x + Math.sin(a) * 3.3, z = rc.z + Math.cos(a) * 3.3;
      bag.marble.push(place(new THREE.BoxGeometry(0.7, h, 0.5).rotateX(-0.07), x, h / 2 + 0.2, z, a));
      bag.rune.push(place(new THREE.BoxGeometry(0.1, h * 0.55, 0.06), x - Math.sin(a) * 0.27, h / 2 + 0.25, z - Math.cos(a) * 0.27, a)); // the cut slit, on the face toward the centre
    }
    bag.rune.push(place(new THREE.OctahedronGeometry(0.4), rc.x, 1.7, rc.z, 0.5, 1, 1.5, 1));
  }

  /** Thornwick's own: a well in the square, a stall at the provisioner's, a notice board at the reeve's, barrels and crates, and lamps down the road from the north. */
  private townDressing(bag: Bag) {
    const sq = LANDMARKS.thornSquare, v = LANDMARKS.thornVendor, rv = LANDMARKS.thornReeve;
    bag.stone.push(place(new THREE.CylinderGeometry(1.25, 1.4, 0.95, 8), sq.x, 0.47, sq.z), place(new THREE.CylinderGeometry(1.5, 1.5, 0.12, 8), sq.x, 0.98, sq.z));
    bag.water.push(place(new THREE.CircleGeometry(1, 8).rotateX(-Math.PI / 2), sq.x, 0.9, sq.z));
    for (const s of [-1, 1]) bag.wood.push(place(new THREE.BoxGeometry(0.18, 2.5, 0.18), sq.x + s * 1.25, 1.25, sq.z));
    bag.wood.push(place(new THREE.BoxGeometry(2.8, 0.14, 0.14), sq.x, 2.5, sq.z));
    bag.roof.push(place(new THREE.ConeGeometry(1.9, 0.9, 4).rotateY(Math.PI / 4).scale(1, 1, 0.6), sq.x, 3, sq.z));
    // the provisioner's stall: four posts, a counter and a striped-cloth awning pitched forward
    for (const [dx, dz] of [[-1.6, -1.1], [1.6, -1.1], [-1.6, 1.1], [1.6, 1.1]]) bag.wood.push(place(new THREE.BoxGeometry(0.14, dz > 0 ? 2 : 2.5, 0.14), v.x + dx, dz > 0 ? 1 : 1.25, v.z + dz));
    bag.wood.push(place(new THREE.BoxGeometry(3.4, 0.9, 0.7), v.x, 0.45, v.z + 1.1));
    bag.cloth.push(place(new THREE.BoxGeometry(3.8, 0.1, 2.9).rotateX(0.2), v.x, 2.3, v.z));
    for (const [dx, dz] of [[2.6, -0.8], [3.2, 0.2], [-2.7, -0.4]]) bag.wood.push(place(new THREE.CylinderGeometry(0.45, 0.4, 0.95, 7), v.x + dx, 0.47, v.z + dz));
    bag.wood.push(place(new THREE.BoxGeometry(1.1, 0.9, 1.1), v.x - 3.2, 0.45, v.z + 0.9), place(new THREE.BoxGeometry(0.9, 0.8, 0.9), v.x - 3.1, 1.3, v.z + 0.9, 0.4));
    // the reeve's notice board: two posts and a board with three pinned sheets
    for (const s of [-1, 1]) bag.wood.push(place(new THREE.BoxGeometry(0.14, 2.2, 0.14), rv.x + 1.8 + s * 0.8, 1.1, rv.z + 1));
    bag.wood.push(place(new THREE.BoxGeometry(1.9, 1.2, 0.1), rv.x + 1.8, 1.5, rv.z + 1));
    for (let n = 0; n < 3; n++) bag.sign.push(place(new THREE.BoxGeometry(0.4, 0.5, 0.04), rv.x + 1.2 + n * 0.6, 1.5 + (n % 2) * 0.15, rv.z + 1.07, (n - 1) * 0.08));
    // the road in: a lamp every 13 units, alternating sides, from the town's north edge to the square
    for (let n = 0, z = THORNWICK.z - 58; z < sq.z - 6; n++, z += 13) lampPost(bag, THORNWICK.x + (n % 2 ? 4.4 : -4.4), z, 0, 5.5);
  }

  /** One merged draw per material, for a bag of parts. The pools are unlit and additive, so they are not a material class of the renderer's. */
  private emit(bag: Bag, add: (o: THREE.Object3D) => void, pal: Pal = SALT_PAL) {
    const { P, mesh } = this.kit, one = (list: THREE.BufferGeometry[], color: number, cls: string, shadow: 'both' | 'cast' | 'receive' | 'none' = 'both') => {
      if (list.length) add(mesh(mergeGeometries(list)!, color, cls, shadow));
    };
    one(bag.rock, P.slate, 'rock');
    one(bag.bark, P.bark, 'bark');
    one(bag.wall, pal.wall, 'plaster');   // limewash and render, not cut stone: the footing below it is what is coursed
    one(bag.stone, pal.foot, 'stone');
    one(bag.roof, pal.roof, 'roof');
    one(bag.hull, HULL, 'stone');
    one(bag.wood, TIMBER, 'wood');
    one(bag.sign, P.gold, 'cloth', 'cast');
    one(bag.water, FEN.water, 'ground', 'receive');
    one(bag.reed, FEN.reed, 'foliage', 'cast');
    one(bag.bone, FEN.bone, 'wood', 'cast');
    one(bag.brush, WOOD.brush, 'foliage', 'cast');
    one(bag.thorn, WOOD.thorn, 'wood', 'cast');
    one(bag.cloth, 0x7a4a3a, 'cloth', 'cast');
    one(bag.turf, BARROW.turf, 'foliage');
    one(bag.dark, BARROW.dark, 'stone', 'none');
    one(bag.jamb, BARROW.jamb, 'stone');
    one(bag.heather, MOOR_FLOOR.heather, 'foliage', 'cast');
    one(bag.cairn, WASTE_STONE, 'rock');
    one(bag.marble, SPIRE_MARBLE, 'stone');
    if (bag.rune.length) { const m = mesh(mergeGeometries(bag.rune)!, RUNE_LIGHT, 'glow', 'none'); (m.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.4; add(m); }
    for (const e of bag.props.values()) one(e.geoms, e.color, e.cls, e.cls === 'glow' ? 'none' : 'both');
    if (bag.glow.length) { const m = mesh(mergeGeometries(bag.glow)!, LANTERN, 'glow', 'none'); (m.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.1; add(m); }
    if (bag.pool.length) {
      poolMaterial ??= new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
      const m = new THREE.Mesh(mergeGeometries(bag.pool)!, poolMaterial);
      m.renderOrder = 1;
      add(m);
    }
    const halos = haloMesh(bag.halos); // the glow round every lamp, window and torch on the slab, in one draw
    if (halos) add(halos);
  }
  /** Boulders every 4 units along the edges of the floor that open onto nothing, as the clearing's ring does, in one instanced draw. */
  private boundary(floors: Rect[], rect: Rect, r: Region, add: (o: THREE.Object3D) => void) {
    const all = REGIONS.flatMap(x => x.footprint), pts: { x: number; z: number }[] = [], main = mainRect(r);
    const f = floors[0];
    const edge = (x: number, z: number) => {
      if (all.some(o => o !== f && inside(o, x, z))) return; // another floor lies here: a way through, not a wall
      if (r.id === 'saltmarrow' && x > SALTMARROW.x + 29) return; // the shore is open water (rocks along it would wall the quay in)
      pts.push({ x, z });
    };
    // the slab's own edges along the region's long way (north and south for a road that runs east to west, west and east for one that runs north to south), and its end edges only where they are the region's ends
    const long = isLong(main), west = rect.x0 <= main.x0 + 1e-6, east = rect.x1 >= main.x1 - 1e-6, north = rect.z0 <= main.z0 + 1e-6, south = rect.z1 >= main.z1 - 1e-6;
    for (let x = rect.x0; x <= rect.x1 + 1e-6; x += 4) { if (!long || north) edge(x, rect.z0); if (!long || south) edge(x, rect.z1); }
    for (let z = rect.z0; z <= rect.z1 + 1e-6; z += 4) { if (long || west) edge(rect.x0, z); if (long || east) edge(rect.x1, z); }
    if (!pts.length) return;
    const im = new THREE.InstancedMesh(bakeUV(new THREE.DodecahedronGeometry(1.6)), this.kit.mesh(new THREE.BufferGeometry(), this.kit.P.boulder, 'rock').material, pts.length);
    pts.forEach((p, i) => { const k = hash(i * 7 + p.x), s = 0.8 + k * 0.45; im.setMatrixAt(i, M.compose(V.set(p.x, 0.8 * s, p.z), Q.setFromAxisAngle(UP, k * 40), S.set(s, s, s))); });
    im.castShadow = im.receiveShadow = true;
    im.matrixAutoUpdate = false;
    add(im);
  }

  /** The sea past the shore and the quay out over it. */
  private quay(t: Tile, add: (o: THREE.Object3D) => void) {
    const { mesh } = this.kit, sm = SALTMARROW;
    // the sea, past the shore (a flat plane under the quay's deck, a little below the land)
    const sea = mesh(new THREE.PlaneGeometry(240, 260).rotateX(-Math.PI / 2).translate(sm.x + 30 + 120, -0.35, sm.z), SEA, 'ground', 'receive');
    add(sea);
    // the quay: a deck out over the water on piles, with a post every six units; its far end is a landing for the flight master and the fishing spots
    const q = t.region.footprint.find(f => f !== mainRect(t.region))!, len = q.x1 - q.x0, wid = q.z1 - q.z0, cx = (q.x0 + q.x1) / 2, cz = (q.z0 + q.z1) / 2;
    const deck = mesh(new THREE.BoxGeometry(len, 0.4, wid).translate(cx, -0.2, cz), DECK, 'wood', 'both');
    t.ground.push(deck);
    add(deck);
    const bag = newBag(), foam: THREE.BufferGeometry[] = [];
    for (let x = q.x0 + 2; x <= q.x1 - 1; x += 6) for (const z of [q.z0 + 0.3, q.z1 - 0.3]) bag.wood.push(place(new THREE.CylinderGeometry(0.22, 0.3, 2.6, 6), x, 0.7, z));
    for (let x = q.x0 + 1.5; x < q.x1; x += 2) bag.wood.push(place(new THREE.BoxGeometry(0.07, 0.03, wid), x, 0.02, cz)); // the plank seams: scale and pace on a deck that is otherwise one slab
    for (let x = q.x0 + 9; x < q.x1 - 4; x += 12) { // a bollard with its coil of rope, on the quay's south edge
      bag.stone.push(place(new THREE.CylinderGeometry(0.26, 0.32, 0.6, 6), x, 0.3, q.z1 - 0.7));
      bag.wood.push(place(new THREE.TorusGeometry(0.28, 0.07, 4, 8).rotateX(Math.PI / 2), x, 0.55, q.z1 - 0.7));
    }
    for (let x = q.x0 + 6; x < q.x1; x += 20) lampPost(bag, x, q.z0 + 0.5, 0, 5.5); // a lamp every twenty units down the north edge
    bag.wood.push(...[0, 1, 2].map(i => place(new THREE.CylinderGeometry(0.4, 0.45, 0.9, 7), q.x0 + 3 + (i % 2) * 0.85, 0.45, q.z0 + 1 + (i >> 1) * 0.8))); // barrels at the root
    this.emit(bag, add);
    // the foam where the sea meets the shore: two ragged pale lines, the palest thing in the frame
    const shore = SALTMARROW.x + 30;
    for (const [dx, w, a] of [[0.4, 1.6, 0.0], [2.6, 0.7, 0.9]] as const) for (let z = -130; z < 130; z += 7) foam.push(place(new THREE.BoxGeometry(w, 0.03, 6 + hash(z + a) * 1.5), shore + dx + hash(z * 3 + a) * 0.8, -0.3, SALTMARROW.z + z + 3));
    add(mesh(mergeGeometries(foam)!, FOAM, 'ground', 'none'));
  }

  /** A townsperson: a robed cone, a head and a cap or a pedlar's hat and pack. Stand-ins, as the clearing's two figures were. `into` collects the meshes as click targets, each tagged with `id`. */
  private person(add: (o: THREE.Object3D) => void, at: { x: number; z: number }, body: number, hat: 'cap' | 'brim', face: number, into: THREE.Mesh[], id: string, capColor = 0x2c3a52) {
    const { P, mesh } = this.kit, grp = new THREE.Group();
    grp.position.set(at.x, 0, at.z);
    grp.rotation.y = face;
    const part = (g: THREE.BufferGeometry, color: number, cls: string, y: number, x = 0, z = 0) => { const m = mesh(g, color, cls, 'cast'); m.position.set(x, y, z); m.userData.id = id; grp.add(m); into.push(m); return m; };
    part(new THREE.ConeGeometry(0.7, 1.7, 6), body, 'cloth', 0.85);
    part(new THREE.SphereGeometry(0.3, 6, 4), P.skin, 'skin', 1.95);
    if (hat === 'cap') part(new THREE.CylinderGeometry(0.28, 0.34, 0.22, 8), capColor, 'cloth', 2.28);
    else { part(new THREE.ConeGeometry(0.55, 0.35, 6), 0x3a2a1a, 'cloth', 2.2); part(new THREE.BoxGeometry(0.9, 0.7, 0.7), 0x5a4128, 'wood', 0.35, 1.2, 0.3); part(new THREE.BoxGeometry(0.28, 0.28, 0.28), P.gold, 'metal', 0.8, 0.2, 0.55); }
    add(grp);
  }

  /** The people of a town square: Saltmarrow's harbourmaster, chandler, trainer and flight master, or Thornwick's reeve, provisioner and flight master. */
  private town(t: Tile, add: (o: THREE.Object3D) => void) {
    if (t.region.id === 'highmoor') return this.highmoorTown(t, add);
    if (t.region.id === 'spire') return this.spireTown(t, add);
    const thorn = t.region.id === 'thornwick', square = thorn ? LANDMARKS.thornSquare : LANDMARKS.square;
    const toward = (at: { x: number; z: number }) => Math.atan2(square.x - at.x, square.z - at.z + 0.01) + Math.PI; // turned toward the way in
    const tag = (g: THREE.Group, id: string) => { g.traverse(o => { o.userData.id = id; }); return g; };
    const stands = thorn ? [LANDMARKS.thornReeve, LANDMARKS.thornVendor, LANDMARKS.thornTrainer, LANDMARKS.thornStable, LANDMARKS.flightThorn] : [LANDMARKS.harbourmaster, LANDMARKS.harbourVendor, LANDMARKS.trainer, LANDMARKS.flightSalt];
    if (thorn) {
      this.person(add, LANDMARKS.thornReeve, 0x5c4a6e, 'cap', toward(LANDMARKS.thornReeve), t.picks.npc, 'thorn', 0x3a2f44);
      this.person(add, LANDMARKS.thornVendor, 0x6a5a30, 'brim', toward(LANDMARKS.thornVendor), t.picks.vendor, 'thorn');
      add(tag(flightMasterFigure(this.kit, LANDMARKS.flightThorn, square, t.picks.flight), 'thornwick'));
      this.person(add, LANDMARKS.thornTrainer, 0x3a5a4a, 'cap', toward(LANDMARKS.thornTrainer), t.picks.trainer, 'thorn_trainer');
      this.person(add, LANDMARKS.thornStable, 0x5a3e28, 'brim', toward(LANDMARKS.thornStable), t.picks.trainer, 'thorn_stable'); // the stablemaster is picked like the trainer: a vendor with one thing to sell
    } else {
      this.person(add, LANDMARKS.harbourmaster, 0x3d5870, 'cap', toward(LANDMARKS.harbourmaster), t.picks.npc, 'harbour');
      this.person(add, LANDMARKS.harbourVendor, 0x6b4a2c, 'brim', toward(LANDMARKS.harbourVendor), t.picks.vendor, 'harbour');
      add(tag(flightMasterFigure(this.kit, LANDMARKS.flightSalt, square, t.picks.flight), 'saltmarrow'));
      this.person(add, LANDMARKS.trainer, 0x7a2e2a, 'cap', toward(LANDMARKS.trainer), t.picks.trainer, 'trainer');
    }
    const bag = newBag(); // lamps by the people who matter: the square, the gate, the stalls
    for (const l of stands) lampPost(bag, l.x + 1.4, l.z - 1.1, 0, 6);
    if (thorn) lampPost(bag, LANDMARKS.alembic.x - 1.8, LANDMARKS.alembic.z + 1.6, 0, 5); // the alchemist works late
    if (thorn) this.townDressing(bag);
    this.emit(bag, add);
  }

  /** Highmoor's square: its flight master by the road in, the Steward, the provisioner, the trainer and the stablemaster, a cairn of grey stones in the middle, and a lamp every 13 units down the road from the west. (The keepers stand at their gates.) */
  private highmoorTown(t: Tile, add: (o: THREE.Object3D) => void) {
    const sq = LANDMARKS.highSquare, fm = LANDMARKS.flightHigh, bag = newBag();
    add(((g: THREE.Group) => { g.traverse(o => { o.userData.id = 'highmoor'; }); return g; })(flightMasterFigure(this.kit, fm, sq, t.picks.flight)));
    lampPost(bag, fm.x + 1.4, fm.z - 1.1, 0, 6);
    const toward = (at: { x: number; z: number }) => Math.atan2(sq.x - at.x, sq.z - at.z + 0.01) + Math.PI; // turned toward the way in, as in the other towns
    this.person(add, LANDMARKS.highTrainer, 0x4a3a52, 'cap', toward(LANDMARKS.highTrainer), t.picks.trainer, 'high_trainer');
    this.person(add, LANDMARKS.highStable, 0x5a3e28, 'brim', toward(LANDMARKS.highStable), t.picks.trainer, 'high_stable'); // picked like the trainer: a vendor with one thing to sell
    this.person(add, LANDMARKS.highSteward, 0x3a4a62, 'cap', toward(LANDMARKS.highSteward), t.picks.npc, 'high', 0x2a3248);
    this.person(add, LANDMARKS.highVendor, 0x6a5a30, 'brim', toward(LANDMARKS.highVendor), t.picks.vendor, 'high');
    for (const l of [LANDMARKS.highTrainer, LANDMARKS.highStable, LANDMARKS.highSteward, LANDMARKS.highVendor]) lampPost(bag, l.x + 1.4, l.z - 1.1, 0, 6);
    lampPost(bag, LANDMARKS.rack.x - 2.6, LANDMARKS.rack.z + 1.4, 0, 5); // the tanner works late
    bag.stone.push(place(new THREE.CylinderGeometry(2.4, 2.8, 0.5, 8), sq.x, 0.25, sq.z));
    for (let n = 0; n < 4; n++) bag.stone.push(place(new THREE.DodecahedronGeometry(1.5 - n * 0.3), sq.x + n * 0.15, 0.9 + n * 1.1, sq.z, n * 0.7));
    for (let n = 0, x = HIGHMOOR.x - 62; x < sq.x - 6; n++, x += 13) lampPost(bag, x, HIGHMOOR.z + (n % 2 ? 4.4 : -4.4), 0, 5.5);
    for (const [lx, lz, rot] of [[LANDMARKS.rack.x - HIGHMOOR.x, LANDMARKS.rack.z - HIGHMOOR.z, 0.5], [-9, 15, 0.1], [-31, -14, 2.2]]) placeProp(bag, 'tanningRack', HIGHMOOR.x + lx, HIGHMOOR.z + lz, rot); // the tanners' racks, off the road
    this.emit(bag, add, MOOR_PAL);
  }

  /**
   * A hard gate: two stout posts and a lintel across the opening, a lantern on each, and its keeper standing by, facing whoever comes up to it. A gate that is
   * closed for good is also barred with planks. Where the sim holds the line is `gate.at`; the posts stand a unit to the near side of it.
   */
  private gate(t: Tile, add: (o: THREE.Object3D) => void) {
    const g = t.gate!, bag = newBag(), lo = g.span[0], hi = g.span[1], mid = (lo + hi) / 2, wide = hi - lo + 2.6;
    const at = (a: number, b: number) => g.axis === 'z' ? { x: a, z: b } : { x: b, z: a }; // (across, along) to world
    const post = (a: number) => { const p = at(a, g.at); bag.stone.push(place(new THREE.BoxGeometry(1.1, 4.4, 1.1), p.x, 2.2, p.z), place(new THREE.BoxGeometry(1.4, 0.35, 1.4), p.x, 4.55, p.z)); lampPost(bag, p.x + (g.axis === 'z' ? 0 : -0.9), p.z + (g.axis === 'z' ? -0.9 : 0), 0, 5); };
    post(lo - 0.9); post(hi + 0.9);
    const c = at(mid, g.at), lintel = g.axis === 'z' ? new THREE.BoxGeometry(wide, 0.55, 0.8) : new THREE.BoxGeometry(0.8, 0.55, wide);
    bag.wood.push(place(lintel, c.x, 4.2, c.z));
    if (g.closed) { // planks across the opening, and a cross-brace
      for (let y = 0.5; y < 3.4; y += 0.65) bag.wood.push(place(g.axis === 'z' ? new THREE.BoxGeometry(hi - lo, 0.28, 0.2) : new THREE.BoxGeometry(0.2, 0.28, hi - lo), c.x, y, c.z));
      bag.wood.push(place(g.axis === 'z' ? new THREE.BoxGeometry(hi - lo, 0.2, 0.2).rotateZ(0.5) : new THREE.BoxGeometry(0.2, 0.2, hi - lo).rotateX(0.5), c.x, 1.9, c.z));
    }
    this.emit(bag, add);
    // the keeper, to one side, facing the way the player comes from (the near side of the line)
    const face = g.axis === 'z' ? (g.from < 0 ? Math.PI : 0) : (g.from < 0 ? -Math.PI / 2 : Math.PI / 2);
    this.person(add, g.post, g.closed ? 0x4a3a2a : 0x3a4a3c, 'cap', face, [], 'gate', 0x2a2a2a);
  }
}

/**
 * A flight master: a robed figure in sea-teal with feathered wings on the back and a pennant on a pole, so the way out of a town reads
 * from across the square. A stand-in made of primitives like the other townspeople (the 3D Artist dresses it). The meshes go into `into`
 * as pick proxies. Shared by Saltmarrow (here) and Hale's clearing (render.ts).
 */
export function flightMasterFigure(kit: Kit, at: { x: number; z: number }, toward: { x: number; z: number }, into: THREE.Mesh[]): THREE.Group {
  const { P, mesh } = kit, grp = new THREE.Group();
  grp.position.set(at.x, 0, at.z);
  grp.rotation.y = Math.atan2(toward.x - at.x, toward.z - at.z);
  const part = (g: THREE.BufferGeometry, color: number, cls: string, y: number, x = 0, z = 0, rz = 0) => {
    const m = mesh(g, color, cls, 'cast');
    m.position.set(x, y, z);
    m.rotation.z = rz;
    grp.add(m);
    into.push(m);
    return m;
  };
  part(new THREE.ConeGeometry(0.7, 1.7, 6), 0x2f5a5e, 'cloth', 0.85);
  part(new THREE.SphereGeometry(0.3, 6, 4), P.skin, 'skin', 1.95);
  part(new THREE.ConeGeometry(0.34, 0.5, 6), 0x234347, 'cloth', 2.3);
  for (const side of [-1, 1]) part(new THREE.BoxGeometry(0.12, 1.5, 0.5), 0xd9ceb2, 'cloth', 1.55, side * 0.5, -0.55, side * -0.35); // wings
  part(new THREE.CylinderGeometry(0.05, 0.05, 2.9, 5), 0x4a3b2e, 'wood', 1.45, 0.85, 0.25);
  part(new THREE.BoxGeometry(0.9, 0.42, 0.05), P.gold, 'cloth', 2.55, 1.3, 0.25);
  // the perch and the bird that carries the player: a gull-pale bird, wings folded, on a post and crossbar at the master's shoulder
  part(new THREE.CylinderGeometry(0.07, 0.09, 1.7, 5), 0x4a3b2e, 'wood', 0.85, -1.4, 0.5);
  part(new THREE.BoxGeometry(0.9, 0.08, 0.08), 0x4a3b2e, 'wood', 1.68, -1.4, 0.5);
  part(new THREE.SphereGeometry(0.36, 6, 4).scale(0.8, 0.85, 1.35), 0xd7dde0, 'cloth', 2.05, -1.4, 0.5); // body
  part(new THREE.SphereGeometry(0.19, 6, 4), 0xd7dde0, 'cloth', 2.42, -1.4, 0.78); // head
  part(new THREE.ConeGeometry(0.07, 0.3, 4).rotateX(Math.PI / 2), P.gold, 'cloth', 2.4, -1.4, 0.99); // beak
  for (const side of [-1, 1]) part(new THREE.BoxGeometry(0.07, 0.5, 0.95), 0x4a525a, 'cloth', 2.05, -1.4 + side * 0.28, 0.4); // folded wings, dark-tipped
  part(new THREE.BoxGeometry(0.3, 0.06, 0.55), 0x4a525a, 'cloth', 1.92, -1.4, 0.05); // tail
  return grp;
}
