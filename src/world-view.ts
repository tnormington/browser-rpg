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
import { LANDMARKS, REGIONS, Obstacle, Rect, Region, SALTMARROW } from './sim/world';

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
/** Saltmarrow's value ladder: pale limewash walls over a dark stone footing, black timber, slate roofs, a weathered hull; the sea's foam is the palest thing in the frame. */
const FOOTING = 0x59626b, TIMBER = 0x2c241e, HULL = 0x52483e, FOAM = 0xa9bcc6, STONE_MARK = 0x7d858c;

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

type Bag = Record<'rock' | 'bark' | 'wall' | 'roof' | 'wood' | 'glow' | 'stone' | 'hull' | 'sign' | 'pool', THREE.BufferGeometry[]>;
const newBag = (): Bag => ({ rock: [], bark: [], wall: [], roof: [], wood: [], glow: [], stone: [], hull: [], sign: [], pool: [] });

/** A pool of lamplight on the ground: a warm disc fading to nothing at its rim. Unlit and faint (well under the forge's glow), no real light behind it; alpha, not additive, so the fog takes it back to the ground's own colour rather than to a pale blue. */
function lampPool(x: number, z: number, r: number, strength = 0.3, y = 0.05): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(r, 20).rotateX(-Math.PI / 2).translate(x, y, z), warm = new THREE.Color(LANTERN);
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
  bag.pool.push(lampPool(x + 0.3, z, pool, 0.3, y + 0.05));
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
  const win = (lx: number, ly: number) => { put(bag.wood, new THREE.BoxGeometry(1, 1.1, 0.08), lx, ly, d / 2 + 0.03); put(bag.glow, new THREE.BoxGeometry(0.72, 0.82, 0.1), lx, ly, d / 2 + 0.07); };
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

/** The graveyard's stones as one draw. Saltmarrow's are drawn with its slabs; Hale's clearing is render.ts's own, so it asks for them here. */
export function headstones(kit: Kit, obs: Obstacle[]): THREE.Mesh {
  return kit.mesh(mergeGeometries(obs.flatMap((o, i) => headstone(o, hash(o.x * 3.1 + o.z * 7.7) * Math.PI * 2, i)))!, kit.P.slate, 'rock');
}

interface Tile { kind: 'slab' | 'quay' | 'town'; region: Region; rect: Rect; group: THREE.Group | null; ground: THREE.Mesh[]; picks: { npc: THREE.Mesh[]; vendor: THREE.Mesh[]; flight: THREE.Mesh[]; trainer: THREE.Mesh[] } }

const inside = (r: Rect, x: number, z: number, e = 0.01) => x > r.x0 + e && x < r.x1 - e && z > r.z0 + e && z < r.z1 - e;
/** A region's main floor: the biggest of its rects (the others are corridors and piers). */
const mainRect = (r: Region): Rect => r.footprint.reduce((best, f) => (f.x1 - f.x0) * (f.z1 - f.z0) > (best.x1 - best.x0) * (best.z1 - best.z0) ? f : best);
const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;

export class WorldView {
  private tiles: Tile[] = [];
  private kit: Kit;

  constructor(private scene: THREE.Scene, kit: Kit) {
    this.kit = kit;
    for (const region of REGIONS) {
      if (region.zone === 'hale') continue; // the clearing and the cave are render.ts's own
      // the region's main floor (its biggest rect) is cut into slabs; the rest (the gate's corridor, the quay) ride with the slab they touch
      const rect = mainRect(region);
      const tile = (kind: Tile['kind'], rect: Rect): Tile => ({ kind, region, rect, group: null, ground: [], picks: { npc: [], vendor: [], flight: [], trainer: [] } });
      for (let x = rect.x0; x < rect.x1 - 1e-6; x += TILE) this.tiles.push(tile('slab', { x0: x, x1: Math.min(rect.x1, x + TILE), z0: rect.z0, z1: rect.z1 }));
      if (region.id === 'saltmarrow') { // what is only once: the sea and the quay, and the people of the square
        this.tiles.push(tile('quay', { x0: SALTMARROW.x + 10, x1: SALTMARROW.x + 160, z0: SALTMARROW.z - 130, z1: SALTMARROW.z + 130 }));
        this.tiles.push(tile('town', { x0: LANDMARKS.square.x - 40, x1: LANDMARKS.square.x + 40, z0: LANDMARKS.square.z - 40, z1: LANDMARKS.square.z + 40 }));
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

    // floors: this slab of the main rect, plus every other rect of the region that touches it (the gate's corridor, the quay's land end)
    const main = mainRect(r), floors = [rect, ...r.footprint.filter(f => f !== main && overlaps(f, rect) && r.id === 'greywater')];
    for (const f of floors) { const m = this.floor(f, r); t.ground.push(m); add(m); }

    // scenery: the region's obstacles that stand in this slab
    const mine = r.obstacles.filter(o => o.x >= rect.x0 && o.x < rect.x1);
    this.scenery(mine, rect, r, add);

    // the edge of the world: a wall of boulders where the floor ends and nothing else begins
    this.boundary(floors, rect, r, add);
  }

  /** A slab of ground tinted per vertex: grass, with the road down its axis (the road is the region's z-centre), sand toward the sea, paving in a town square. */
  private floor(f: Rect, r: Region): THREE.Mesh {
    const { P } = this.kit, w = f.x1 - f.x0, d = f.z1 - f.z0, sx = Math.max(1, Math.round(w / 4)), sz = Math.max(1, Math.round(d / 4));
    const geo = new THREE.PlaneGeometry(w, d, sx, sz).rotateX(-Math.PI / 2).translate((f.x0 + f.x1) / 2, 0, (f.z0 + f.z1) / 2);
    const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color(), a = new THREE.Color(P.grass), b = new THREE.Color(P.grassAlt);
    const dirt = new THREE.Color(P.dirt).multiplyScalar(1.45), dirtAlt = new THREE.Color(P.dirtAlt).multiplyScalar(1.45), // the road reads as a road in the dark: lighter than the clearing's earth
      sand = new THREE.Color(SAND), stone = new THREE.Color(P.stone);
    const road = r.id === 'greywater' ? (f.z0 + f.z1) / 2 : null, square = r.safe?.[0];
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v), z = pos.getZ(v), j = hash(x * 12.9898 + z * 78.233);
      c.copy(a).lerp(b, j);
      if (road !== null) {
        const k = THREE.MathUtils.clamp((4.2 - Math.abs(z - road)) / 2.4, 0, 1) + (x < 52 ? 0.6 : 0); // the road, and the dirt of the gate's yard
        if (k > 0) c.lerp(dirt.clone().lerp(dirtAlt, j), Math.min(1, k) * (Math.abs(z - road) < 12 ? 1 : 0));
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
        case 'tree': { // a dead tree, bent inland by the wind off the sea: a leaning trunk and two bare limbs
          bag.bark.push(place(new THREE.CylinderGeometry(0.14, 0.26, 3.2, 5).rotateZ(0.14).translate(-0.22, 0, 0), o.x, 1.6, o.z),
            place(new THREE.CylinderGeometry(0.05, 0.1, 1.6, 4).rotateZ(0.9), o.x + Math.cos(ry) * 0.5 - 0.35, 2.6, o.z - Math.sin(ry) * 0.5, ry),
            place(new THREE.CylinderGeometry(0.04, 0.09, 1.3, 4).rotateZ(-1.0), o.x - Math.cos(ry) * 0.4 - 0.35, 2.2, o.z + Math.sin(ry) * 0.4, ry));
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
    if (r.id === 'greywater') this.waymarks(bag, rect, (r.footprint.find(f => f === mainRect(r)) ?? rect));
    this.emit(bag, add);
  }

  /** A milestone every 80 units down the road, on its north verge: a squared post with a board pointing on to the sea. How far from home the player is, in a thing they pass. */
  private waymarks(bag: Bag, rect: Rect, main: Rect) {
    const roadZ = (main.z0 + main.z1) / 2;
    for (let x = Math.ceil(rect.x0 / 80) * 80; x < rect.x1; x += 80) {
      if (x < 100) continue; // Hale's gate has its own
      const z = roadZ - 6.5;
      bag.stone.push(place(new THREE.BoxGeometry(0.7, 1.6, 0.7), x, 0.8, z), place(new THREE.BoxGeometry(0.9, 0.2, 0.9), x, 1.7, z));
      bag.wood.push(place(new THREE.BoxGeometry(1.5, 0.32, 0.08), x + 0.45, 1.25, z + 0.38), place(new THREE.ConeGeometry(0.2, 0.4, 3).rotateZ(-Math.PI / 2), x + 1.4, 1.25, z + 0.38));
    }
  }

  /** One merged draw per material, for a bag of parts. The pools are unlit and additive, so they are not a material class of the renderer's. */
  private emit(bag: Bag, add: (o: THREE.Object3D) => void) {
    const { P, mesh } = this.kit, one = (list: THREE.BufferGeometry[], color: number, cls: string, shadow: 'both' | 'cast' | 'none' = 'both') => {
      if (list.length) add(mesh(mergeGeometries(list)!, color, cls, shadow));
    };
    one(bag.rock, P.slate, 'rock');
    one(bag.bark, P.bark, 'wood');
    one(bag.wall, PLASTER, 'stone');
    one(bag.stone, FOOTING, 'stone');
    one(bag.roof, ROOF, 'stone');
    one(bag.hull, HULL, 'stone');
    one(bag.wood, TIMBER, 'wood');
    one(bag.sign, P.gold, 'cloth', 'cast');
    if (bag.glow.length) { const m = mesh(mergeGeometries(bag.glow)!, LANTERN, 'glow', 'none'); (m.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.1; add(m); }
    if (bag.pool.length) {
      poolMaterial ??= new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
      const m = new THREE.Mesh(mergeGeometries(bag.pool)!, poolMaterial);
      m.renderOrder = 1;
      add(m);
    }
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
    // the slab's own north and south edges, and its end edges only where they are the region's ends
    for (let x = rect.x0; x <= rect.x1 + 1e-6; x += 4) { edge(x, rect.z0); edge(x, rect.z1); }
    for (let z = rect.z0; z <= rect.z1 + 1e-6; z += 4) { if (rect.x0 <= main.x0 + 1e-6) edge(rect.x0, z); if (rect.x1 >= main.x1 - 1e-6) edge(rect.x1, z); }
    if (!pts.length) return;
    const im = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1.6), this.kit.mesh(new THREE.BufferGeometry(), this.kit.P.boulder, 'rock').material, pts.length);
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

  /** The harbourmaster and the chandler: the clearing's two figures in the sea's colours (stand-ins, as theirs were). */
  private town(t: Tile, add: (o: THREE.Object3D) => void) {
    const { P, mesh } = this.kit;
    const person = (at: { x: number; z: number }, body: number, hat: 'cap' | 'brim', into: THREE.Mesh[]) => {
      const grp = new THREE.Group();
      grp.position.set(at.x, 0, at.z);
      grp.rotation.y = Math.atan2(LANDMARKS.square.x - at.x, LANDMARKS.square.z - at.z + 0.01) + Math.PI; // turned toward the way in
      const part = (g: THREE.BufferGeometry, color: number, cls: string, y: number, x = 0, z = 0) => { const m = mesh(g, color, cls, 'cast'); m.position.set(x, y, z); grp.add(m); into.push(m); return m; };
      part(new THREE.ConeGeometry(0.7, 1.7, 6), body, 'cloth', 0.85);
      part(new THREE.SphereGeometry(0.3, 6, 4), P.skin, 'skin', 1.95);
      if (hat === 'cap') part(new THREE.CylinderGeometry(0.28, 0.34, 0.22, 8), 0x2c3a52, 'cloth', 2.28);
      else { part(new THREE.ConeGeometry(0.55, 0.35, 6), 0x3a2a1a, 'cloth', 2.2); part(new THREE.BoxGeometry(0.9, 0.7, 0.7), 0x5a4128, 'wood', 0.35, 1.2, 0.3); part(new THREE.BoxGeometry(0.28, 0.28, 0.28), P.gold, 'metal', 0.8, 0.2, 0.55); }
      add(grp);
    };
    person(LANDMARKS.harbourmaster, 0x3d5870, 'cap', t.picks.npc);
    person(LANDMARKS.harbourVendor, 0x6b4a2c, 'brim', t.picks.vendor);
    add(flightMasterFigure(this.kit, LANDMARKS.flightSalt, LANDMARKS.square, t.picks.flight));
    person(LANDMARKS.trainer, 0x7a2e2a, 'cap', t.picks.trainer);
    const bag = newBag(); // lamps by the people who matter: the square, the gate, the stalls
    for (const l of [LANDMARKS.harbourmaster, LANDMARKS.harbourVendor, LANDMARKS.trainer, LANDMARKS.flightSalt]) lampPost(bag, l.x + 1.4, l.z - 1.1, 0, 6);
    this.emit(bag, add);
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
