// Model pipeline: glTF loading with a per-slot cache. Each file is fetched and parsed once; every instance shares its
// geometry (and, for static props, its materials). Rendering only: nothing here touches the sim.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AnimDef } from './anim';
import { SurfaceId, bakeUV, dress } from './surface';

const FILES = import.meta.glob('../assets/models/*.glb', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const urlOf = (file: string) => FILES[`../assets/models/${file}.glb`];

/** How a pack's stock colours are pulled into the scene palette: HSL saturation/lightness multipliers, or a hard colour per material name. */
interface Look { sat: number; light: number; named?: Record<string, number> }

/**
 * One entry per visual slot. `fit` scales the model so its height (or, with `footprint`, its widest horizontal extent)
 * matches the target in world units: the sim's collision radii are authoritative and the model is fitted to them.
 */
export interface SlotDef {
  file: string;
  height?: number;
  /** Keep the file's own coordinates (no fitting): for pieces authored to sit on another model, e.g. armour on the knight. */
  raw?: boolean;
  footprint?: number;
  yaw?: number; // extra turn so the model faces +z, the sim's facing convention
  look: Look;
  metal?: number; roughness?: number;
  anim?: AnimDef;
  /** Cut the 'Armor' mesh in two by bone weight: the leg triangles become their own mesh and material ('ArmorLegs'), so legs and chest can be dressed apart. */
  splitLegs?: boolean;
  /** Ignore the file's vertex colours: a pack that bakes its colours dark would otherwise tint every named colour black. */
  plain?: boolean;
  /**
   * Which surface class (`surface.ts`) dresses the file's materials: one for the whole slot, or one per material name
   * with `*` for the rest. A slot with no entry is drawn in flat colour, as every model was before HOM-117.
   */
  surface?: SurfaceId | Partial<Record<string, SurfaceId>>;
}
/** The surface class for one of a slot's materials: its own, else the slot's catch-all. */
const surfaceOf = (def: SlotDef, name: string): SurfaceId | undefined =>
  typeof def.surface === 'string' ? def.surface : def.surface?.[name] ?? def.surface?.['*'];

const SKIN = 0xb89a7e;
/** A hand-held blade slot: its file's colours are replaced per item by gear.ts, so the look here is only a placeholder. */
const blade = (file: string): SlotDef => ({ file, height: 1.15, look: { sat: 1, light: 1, named: {} }, surface: { '*': 'metal', Brown: 'hide' } });
export const SLOTS = {
  player: { file: 'knight', height: 2.0, look: { sat: 0.55, light: 1.9, named: { Skin: SKIN, Armor: 0x6a7684, ArmorLegs: 0x6a7684, Boots: 0x2a2622, Hands: SKIN } }, splitLegs: true,
    surface: { '*': 'plate', Skin: 'skin', Hands: 'skin', Boots: 'hide' },   // the knight's own armour is worn plate, not world iron
    // jumpSpan: the Jump clip is 1.21 s, of which 0 - 0.50 is a crouch and 0.88 - 1.21 the landing absorb. The hop is half a
    // second, so the whole clip squeezed into it ran the crouch while the knight was already in the air: only 0.50 (the legs
    // at full extension, feet leaving) to 0.88 (straight again, reaching for the ground) is the part that is actually airborne.
    anim: { idle: 'Idle', move: 'Run', moveSpeed: 6, attack: ['Run_swordAttack', 'swordAttackJump'], upper: ['Run_swordAttack'], death: 'Death', jump: 'Jump', jumpSpan: [0.5, 0.88], impact: { Run_swordAttack: 0.4, swordAttackJump: 0.62 } } },
  warden: { file: 'wizard', height: 2.1, look: { sat: 0.6, light: 1.6, named: { Skin: SKIN, Clothes: 0x4c3b66, Hat: 0x33283f, Belt: 0x3a2d22, Gold: 0xb8893a } },
    surface: { '*': 'cloth', Skin: 'skin', Face: 'skin', Belt: 'hide', Gold: 'metal' }, anim: { idle: 'Idle', move: 'Walk' } },
  boar: { file: 'pig', height: 1.0, look: { sat: 0.5, light: 0.95, named: { 'Material.003': 0x93705a, Material: 0x3a281c } }, surface: 'hide',
    anim: { idle: 'Idle', move: 'Idle', attack: ['Jump'], impact: { Jump: 0.5 }, hop: 0.1, lie: 0.45 } },
  wolf: { file: 'wolf', height: 1.25, yaw: -Math.PI / 2, look: { sat: 0.35, light: 0.75, named: { Wolf: 0x8c8e8a } }, surface: 'hide', anim: { idle: 'Idle', move: 'Walking', moveSpeed: 5, lie: 0.4 } },
  brute: { file: 'viking', height: 2.7, look: { sat: 0.8, light: 2.4, named: { Skin: 0x8a5a4a, Face: 0x8a5a4a, Main: 0x6a2a28, Pants: 0x3a2220 } },
    surface: { '*': 'hide', Skin: 'skin', Face: 'skin', Pants: 'cloth' },
    anim: { idle: 'Idle', move: 'Walk', moveSpeed: 4, attack: ['Punch'], hit: 'RecieveHit', death: 'Defeat', impact: { Punch: 0.38 } } },
  // the Warden's model again, dressed as a cultist: a different person from his silhouette alone (crimson robe, dark hat)
  hexer: { file: 'wizard', height: 2.2, look: { sat: 0.6, light: 1.5, named: { Skin: SKIN, Clothes: 0x5a1c24, Hat: 0x2a1418, Belt: 0x2a1d16, Gold: 0x8a6a2a } },
    surface: { '*': 'cloth', Skin: 'skin', Face: 'skin', Belt: 'hide', Gold: 'metal' },
    anim: { idle: 'Idle', move: 'Walk', moveSpeed: 4, attack: ['Shoot_OneHanded'], hit: 'RecieveHit', death: 'Defeat', impact: { Shoot_OneHanded: 0.3 } } },
  // a smaller, paler wolf
  pup: { file: 'wolf', height: 0.8, yaw: -Math.PI / 2, look: { sat: 0.35, light: 0.85, named: { Wolf: 0xa8a290 } }, surface: 'hide', anim: { idle: 'Idle', move: 'Walking', moveSpeed: 5, lie: 0.3 } },
  // the first mount (Thornwick, 10 u/s): the pack's plainer horse, a dun with a dark mane. 'Material.003' is the coat and 'Material.006' mane, tail and
  // hooves, so a skin (section 6.3) is a new pair of colours here plus its own tack layers in mount.ts. The second mount must be a different animal or
  // carry visibly better tack: nothing here should be pushed as far as this model can go.
  horse: { file: 'horse', height: 2.3, plain: true, look: { sat: 0.55, light: 1.3, named: { 'Material.003': 0x6a5848, 'Material.006': 0x1c1a18 } }, surface: 'hide',
    anim: { idle: 'Idle', move: 'Run', moveSpeed: 7, death: 'Death', jump: 'Jump' } },
  // the second mount (Highmoor, 13 u/s): a different animal, not a tint. The pack's fuller horse (2,182 triangles against the first's 690, eight
  // named materials instead of two): a near-black coat with ash markings and a pale mane, so the head and the flowing hair read at a distance. Its
  // tack (barding, a war saddle, a plume) is built in mount.ts. moveSpeed is measured, not guessed (HOM-100): the Gallop clip's planted hooves sweep back at ~5.2 u/s at rate 1,
  // so 13 u/s would need rate 2.5; 7 gives rate 1.86 (a 3.2 Hz gallop) and the hooves slide ~25% instead of the 42% that 9 left.
  destrier: { file: 'destrier', height: 2.55, plain: true, look: { sat: 0.5, light: 1, named: { Main: 0x626a74, Main_Dark: 0x2c2f35, Main_Light: 0x9aa2aa, Hair: 0xdcdfe2, Muzzle: 0x3a3c42,
    Hooves: 0x14151a, Eye_Black: 0x08090b, Eye_White: 0xb4c4d4 } }, surface: 'hide',
    anim: { idle: 'Idle', move: 'Gallop', moveSpeed: 7, death: 'Death', jump: 'Gallop_Jump' } },
  tree: { file: 'pine', height: 5.6, look: { sat: 0.45, light: 1.3, named: { Wood: 0x4a3b2e, Green: 0x2f4538 } }, surface: { Wood: 'bark', Green: 'foliage' } },
  // the stump's cut face is the one sawn surface on a tree, so it takes the board grain and the sides keep their bark
  stump: { file: 'stump', height: 0.8, look: { sat: 0.45, light: 1.3, named: { Wood: 0x4a3b2e, LightWood: 0x6a5a48, Green: 0x2f4538 } },
    surface: { Wood: 'bark', LightWood: 'wood', Green: 'foliage' } },
  // the two mineral nodes wear their own mineral: flecked ore rock and brittle coal, so a node reads apart from a boulder
  ironRock: { file: 'rock5', footprint: 2.6, look: { sat: 0.5, light: 1.7, named: { Rock: 0x6a7078 } }, surface: 'ore' },
  coalRock: { file: 'rock3', footprint: 2.6, look: { sat: 0.5, light: 1.0, named: { Rock: 0x2f3036 } }, surface: 'coal' },
  caveRock: { file: 'rock2', footprint: 6.4, look: { sat: 0.5, light: 1.5, named: { Rock: 0x4b525b } }, surface: 'rock' },
  boulder: { file: 'rock6', footprint: 3.6, look: { sat: 0.5, light: 1.5, named: { Rock: 0x454b53 } }, surface: 'rock' },
  // the smithy is the one model that ships its own material names for all three of a building's surfaces: render, timber, coursed stone and tiles
  forge: { file: 'blacksmith', footprint: 5.2, look: { sat: 0.45, light: 1.0 },
    surface: { Plaster: 'plaster', Wood: 'wood', Wood_Light: 'wood', Wood_Side: 'wood', Stone_Light: 'stone', Stone_Dark: 'stone', RoofTiles_Red: 'roof' } },
  anvil: { file: 'anvil', height: 0.9, look: { sat: 0.3, light: 0.5, named: { MI_Trim_Metal: 0x2a2c33 } }, metal: 0.6, roughness: 0.5, surface: 'metal' },
  // The two worn glb pieces. `raw` keeps the file's own coordinates so they sit on the knight, which also means their UVs
  // are baked in rig units rather than world ones; gear.ts re-projects them when it mounts them (`fitPiece`).
  helmet: { file: 'helmet', raw: true, look: { sat: 0.5, light: 1.6, named: { Grey: 0x7c8794, DarkGrey: 0x4a525c } }, surface: 'plate' },
  pauldrons: { file: 'pauldrons', raw: true, look: { sat: 0.5, light: 1.6, named: { Grey: 0x7c8794 } }, surface: 'plate' },
  sword: blade('sword'),
  // One model per weapon (HOM-203), keyed `weapon_<item id>`; `sword` stays the fallback for any weapon without one. All 20 are authored the way sword.glb is:
  // blade along +Y, broad face across X, butt at the origin, fitted to 1.15 tall, materials Metal / Gold / Red / Brown.
  weapon_copper_sword: blade('weapon_copper_sword'),
  weapon_bronze_sword: blade('weapon_bronze_sword'),
  weapon_rusty_blade: blade('weapon_rusty_blade'),
  weapon_iron_sword: blade('weapon_iron_sword'),
  weapon_steel_sword: blade('weapon_steel_sword'),
  weapon_forged_blade: blade('weapon_forged_blade'),
  weapon_warden_edge: blade('weapon_warden_edge'),
  weapon_adamant_blade: blade('weapon_adamant_blade'),
  weapon_marrows_edge: blade('weapon_marrows_edge'),
  weapon_stormiron_blade: blade('weapon_stormiron_blade'),
  weapon_rotroot_edge: blade('weapon_rotroot_edge'),
  weapon_starmetal_blade: blade('weapon_starmetal_blade'),
  weapon_crownbreaker: blade('weapon_crownbreaker'),
  weapon_echo_blade_1: blade('weapon_echo_blade_1'),
  weapon_echo_blade_2: blade('weapon_echo_blade_2'),
  weapon_echo_blade_3: blade('weapon_echo_blade_3'),
  weapon_echo_blade_4: blade('weapon_echo_blade_4'),
  weapon_echo_blade_5: blade('weapon_echo_blade_5'),
  weapon_echo_blade_6: blade('weapon_echo_blade_6'),
  weapon_echo_blade_7: blade('weapon_echo_blade_7'),
} satisfies Record<string, SlotDef>;
export type SlotId = keyof typeof SLOTS;
/** The slot holding the model made for weapon `id`, or null when it has none and the generic sword stands in. */
export const weaponSlot = (id: string): SlotId | null => `weapon_${id}` in SLOTS ? `weapon_${id}` as SlotId : null;

/**
 * Faces meeting at a shallower angle than this shade as one continuous surface; anything sharper keeps a hard edge.
 * 45 degrees rounds off the curvature the pack authored as facets on a body while leaving armour plates, belts and
 * corners crisp. Only skinned (organic) slots are smoothed: rock, trees, buildings and gear plates keep their facets.
 */
const CREASE = Math.cos(45 * Math.PI / 180);

/**
 * Rewrite a geometry's normals so it shades smoothly: each corner takes the average of the faces meeting at its
 * position that lie within CREASE of its own face. Only the normal attribute is replaced, so the index, the material
 * groups and the skinning attributes all survive â€” three's `toCreasedNormals` re-indexes and throws those away. The
 * pack ships everything flat-shaded (one vertex per face, no sharing), so every corner already has its own normal
 * slot to write into and hard edges stay hard.
 */
export function smoothNormals(g: THREE.BufferGeometry) {
  const pos = g.getAttribute('position'), idx = g.index;
  const corners = idx ? idx.count : pos.count, faces = Math.floor(corners / 3);
  const vertexAt = (corner: number) => (idx ? idx.getX(corner) : corner);
  const faceNormals = new Float32Array(faces * 3);
  const touching = new Map<string, number[]>(); // quantised position -> the faces meeting there
  const keys = new Array<string>(corners);      // per corner, so the second pass need not re-quantise
  const tri = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], n = new THREE.Vector3(), e = new THREE.Vector3();

  for (let f = 0; f < faces; f++) {
    for (let k = 0; k < 3; k++) tri[k].fromBufferAttribute(pos, vertexAt(f * 3 + k));
    n.subVectors(tri[1], tri[0]).cross(e.subVectors(tri[2], tri[0]));
    if (n.lengthSq() === 0) n.set(0, 1, 0); // a degenerate triangle has no direction of its own
    n.normalize().toArray(faceNormals, f * 3);
    for (let k = 0; k < 3; k++) {
      const v = tri[k], key = keys[f * 3 + k] = `${Math.round(v.x * 1e4)},${Math.round(v.y * 1e4)},${Math.round(v.z * 1e4)}`;
      let at = touching.get(key);
      if (!at) touching.set(key, at = []);
      at.push(f);
    }
  }

  const out = new Float32Array(pos.count * 3), sum = new THREE.Vector3();
  for (let f = 0; f < faces; f++) {
    n.fromArray(faceNormals, f * 3);
    for (let k = 0; k < 3; k++) {
      sum.set(0, 0, 0);
      for (const o of touching.get(keys[f * 3 + k])!) {
        e.fromArray(faceNormals, o * 3);
        if (e.dot(n) > CREASE) sum.add(e);
      }
      (sum.lengthSq() ? sum.normalize() : n).toArray(out, vertexAt(f * 3 + k) * 3);
    }
  }
  g.setAttribute('normal', new THREE.BufferAttribute(out, 3));
}

const hsl = { h: 0, s: 0, l: 0 };
function restyle(src: THREE.MeshStandardMaterial, def: SlotDef, soft: boolean): THREE.MeshStandardMaterial {
  const named = def.look.named?.[src.name];
  const m = new THREE.MeshStandardMaterial({
    map: named === undefined ? src.map : null, // a hard colour replaces the pack's texture too (the anvil's stock texture is lime green)
    vertexColors: !def.plain && !!src.vertexColors, roughness: def.roughness ?? 0.85, metalness: def.metal ?? 0.05, flatShading: !soft,
  });
  if (named !== undefined) m.color.setHex(named);
  else {
    m.color.copy(src.color).getHSL(hsl, THREE.SRGBColorSpace);
    m.color.setHSL(hsl.h, Math.min(1, hsl.s * def.look.sat), Math.min(0.75, hsl.l * def.look.light), THREE.SRGBColorSpace);
  }
  const cls = surfaceOf(def, src.name);
  if (cls) dress(m, cls);   // the class's shared detail and normal maps (surface.ts); a pack texture left in place keeps them off
  m.name = src.name;
  return m;
}

export interface Prepared {
  def: SlotDef;
  /** Static slot: one merged geometry, baked and fitted, ready to share. Skinned slot: the parsed scene to clone. */
  geometry?: THREE.BufferGeometry;
  materials: THREE.MeshStandardMaterial[];
  scene?: THREE.Object3D;
  clips: Map<string, THREE.AnimationClip>;
  fit: { scale: number; offset: THREE.Vector3 };
}

const LEG_BONE = /^(UpperLeg|LowerLeg|Foot)/;
const HAND_BONE = /^(Palm|MiddleHand|Fingers|Thumb)/;

/**
 * How many units of the file's own space one unit of a mesh's geometry becomes, measured off the bind pose: the size of
 * the mesh as the loader lays it out, over the size of the numbers in its position buffer. Packs carry this factor in
 * different places -- the knight's rig hangs under a 100x group and carries more of it in its bind matrices -- so it is
 * measured rather than read off a matrix. `bakeUV` needs it, or a skinned model's texels come out tens of times the size
 * of everything else's (HOM-137).
 */
function bindScale(m: THREE.Mesh): number {
  m.geometry.computeBoundingBox();
  const g = m.geometry.boundingBox!.getSize(new THREE.Vector3()).length();
  const w = new THREE.Box3().setFromObject(m, true).getSize(new THREE.Vector3()).length();
  return g > 1e-9 ? w / g : 1;
}

/**
 * Peel the leg triangles off a skinned mesh into a second mesh that shares its vertex data (a triangle is a leg when the
 * mean of its corners' leg-bone weight is over half). The pack ships the whole outfit as one material, so this is the only
 * way to dress chest and legs separately. Returns null when one side is empty.
 */
function splitBones(m: THREE.SkinnedMesh, bones: RegExp, materialName: string, suffix: string): THREE.SkinnedMesh | null {
  const g = m.geometry, index = g.index, joints = g.getAttribute('skinIndex'), weights = g.getAttribute('skinWeight');
  if (!index || !joints || !weights) return null;
  const leg = m.skeleton.bones.map(b => bones.test(b.name));
  const legWeight = (v: number) => {
    let w = 0;
    for (let k = 0; k < 4; k++) if (leg[joints.getComponent(v, k)]) w += weights.getComponent(v, k);
    return w;
  };
  const body: number[] = [], legs: number[] = [];
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
    ((legWeight(a) + legWeight(b) + legWeight(c)) / 3 > 0.5 ? legs : body).push(a, b, c);
  }
  if (!legs.length || !body.length) return null;
  const legGeo = new THREE.BufferGeometry();
  for (const k of Object.keys(g.attributes)) legGeo.setAttribute(k, g.getAttribute(k));
  legGeo.setIndex(legs);
  g.setIndex(body);
  const mat = (m.material as THREE.Material).clone();
  mat.name = materialName;
  const out = m.clone(false); // clone, not construct: it keeps the node transform and bind matrix the skinning depends on
  out.geometry = legGeo;
  out.material = mat;
  out.name = `${m.name}`;
  m.parent!.add(out);
  return out;
}

const loader = new GLTFLoader();
const cache = new Map<SlotId, Promise<Prepared>>();

/** Parse a slot's file once; the promise is cached so concurrent callers share a single fetch. */
export function loadSlot(id: SlotId): Promise<Prepared> {
  let p = cache.get(id);
  if (!p) { p = load(id); cache.set(id, p); }
  return p;
}

async function load(id: SlotId): Promise<Prepared> {
  const def: SlotDef = SLOTS[id];
  const gltf = await loader.loadAsync(urlOf(def.file));
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const clips = new Map<string, THREE.AnimationClip>();
  for (const c of gltf.animations) clips.set(c.name.split('|').pop()!, c); // "HumanArmature|Run" -> "Run"

  const meshes: THREE.Mesh[] = [];
  let skinned = false;
  root.traverse(o => { if ((o as THREE.Mesh).isMesh) { meshes.push(o as THREE.Mesh); skinned ||= (o as THREE.SkinnedMesh).isSkinnedMesh; } });
  // before anything splits or merges: the legs share the body's attributes, so the seam only shades smoothly if both
  // sides were normalled while they were still one surface
  if (skinned) for (const m of meshes) smoothNormals(m.geometry);
  if (def.splitLegs) for (const m of [...meshes]) {
    if ((m as THREE.SkinnedMesh).isSkinnedMesh && (m.material as THREE.Material).name === 'Armor') {
      const legs = splitBones(m as THREE.SkinnedMesh, LEG_BONE, 'ArmorLegs', 'Legs');
      if (legs) meshes.push(legs);
    }
    // the bare hands, peeled off the skin so a glove can recolour them without touching the face and arms
    if ((m as THREE.SkinnedMesh).isSkinnedMesh && (m.material as THREE.Material).name === 'Skin') {
      const hands = splitBones(m as THREE.SkinnedMesh, HAND_BONE, 'Hands', 'Hands');
      if (hands) meshes.push(hands);
    }
  }
  const mats = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  const styled = (m: THREE.Material) => { let s = mats.get(m); if (!s) { s = restyle(m as THREE.MeshStandardMaterial, def, skinned); mats.set(m, s); } return s; };

  let geometry: THREE.BufferGeometry | undefined;
  let materials: THREE.MeshStandardMaterial[];
  let box: THREE.Box3;
  if (skinned) {
    for (const m of meshes) {
      m.material = Array.isArray(m.material) ? m.material.map(styled) : styled(m.material);
      m.geometry.computeBoundingSphere();
      m.geometry.boundingSphere!.radius *= 1.5; // bounds come from the bind pose: pad them so an attack lunge never pops at the screen edge
    }
    materials = [...mats.values()];
    box = new THREE.Box3().setFromObject(root, true);
  } else {
    // bake node transforms into the geometry and merge into one mesh: one Object3D per instance instead of a node tree
    const parts: THREE.BufferGeometry[] = [], used: THREE.MeshStandardMaterial[] = [];
    for (const m of meshes) {
      const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color' && k !== 'uv') g.deleteAttribute(k);
      g.clearGroups();
      parts.push(g);
      used.push(styled(m.material as THREE.Material));
    }
    geometry = mergeGeometries(parts, true)!;
    materials = used;
    geometry.computeBoundingBox();
    box = geometry.boundingBox!;
  }
  const size = box.getSize(new THREE.Vector3());
  const dim = def.footprint ? Math.max(size.x, size.z) : size.y;
  const scale = def.raw ? 1 : (def.footprint ?? def.height!) / dim;
  const offset = def.raw ? new THREE.Vector3() : new THREE.Vector3(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2).multiplyScalar(scale);
  if (skinned) offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), def.yaw ?? 0); // the model turns about its own origin, so the centring offset must turn with it
  if (geometry) { // bake the fit as well: instances then need no transform of their own
    geometry.scale(scale, scale, scale).translate(offset.x, offset.y, offset.z);
    if (def.yaw) geometry.rotateY(def.yaw);
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
  }
  // UVs for the surface maps (surface.ts), last, so the projection is off the geometry as it will be drawn. A static slot
  // carries its fit, so it is already in world units; a skinned one is still in its file's space and that space is not
  // the geometry's own (see `bindScale`). Taking the fit alone left every skinned model's texels a hundred times too
  // large, so the grain on a knight, a wolf or a villager was one stretched smear rather than plate, pelt and cloth.
  if (def.surface) {
    if (geometry) bakeUV(geometry);
    else for (const m of meshes) bakeUV(m.geometry, scale * bindScale(m));
  }
  return { def, geometry, materials, scene: skinned ? root : undefined, clips, fit: { scale, offset } };
}

export interface Instance { root: THREE.Object3D; materials: THREE.MeshStandardMaterial[]; clips: Map<string, THREE.AnimationClip> }

/**
 * A fresh renderable instance. Static slots share geometry and (unless `ownMaterials`) materials and are frozen:
 * matrixAutoUpdate off, since nothing in a static prop's own subtree ever moves. Skinned slots clone the skeleton and
 * always get their own materials, so a hit flash on one enemy does not light up its neighbours.
 */
export function spawn(p: Prepared, ownMaterials = false): Instance {
  const shadow = (o: THREE.Object3D) => { o.castShadow = o.receiveShadow = true; };
  if (!p.scene) {
    const materials = ownMaterials ? p.materials.map(m => m.clone()) : p.materials;
    const mesh = new THREE.Mesh(p.geometry, materials.length === 1 ? materials[0] : materials);
    shadow(mesh);
    mesh.matrixAutoUpdate = false;
    return { root: mesh, materials, clips: p.clips };
  }
  const model = cloneSkinned(p.scene);
  const own = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  const mine = (m: THREE.Material) => { let c = own.get(m); if (!c) { c = (m as THREE.MeshStandardMaterial).clone(); own.set(m, c); } return c; };
  model.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.material = Array.isArray(m.material) ? m.material.map(mine) : mine(m.material);
    shadow(m);
  });
  // fit wrapper: feet on the ground, centred, scaled to the collision-derived size
  const fit = new THREE.Group();
  model.scale.multiplyScalar(p.fit.scale);
  model.position.copy(p.fit.offset);
  model.rotation.y = p.def.yaw ?? 0;
  fit.add(model);
  return { root: fit, materials: [...own.values()], clips: p.clips };
}

/** Freeze a static subtree: compute its world matrices once, then never again. */
export function freeze(o: THREE.Object3D) {
  o.updateMatrix();
  o.updateMatrixWorld(true);
  o.traverse(c => { c.matrixAutoUpdate = false; });
}
