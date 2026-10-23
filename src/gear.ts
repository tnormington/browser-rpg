// The player's worn gear, drawn: every equipped item is visible and nothing else is. Rendering only.
//
// One PlayerGear owns the knight's bone-mounted pieces. sync() diffs the sim's equipment record against what is mounted and
// rebuilds only the slot that changed, so swapping gear mid-session (even mid-swing) needs no event from the sim.
//   weapon -> sword.glb in the right hand, restyled and rescaled per item
//   head   -> a generated leather cap (rung 1) or helmet.glb (rung 2+), crest and horns added by rung
//   chest  -> the knight's own armour mesh recoloured, plus pauldrons.glb (rung 2+), spiked at rung 3+
//   legs   -> the split-off leg mesh recoloured, plus generated greaves (rung 2+) and knee cops (rung 3+)
//   hands  -> generated gloves: a cuff at the wrist and a mitt over the palm (hide, or wolf pelt with a fur ruff)
//   feet   -> generated boots: a shaft over the ankle and a foot with a sole, a fur-topped shaft for wolfskin
//   offhand-> a generated torch burning in the left fist, with the halo of lit air round its flame
// Bare slots show skin. Looks come from gear-look.ts, keyed by item id with a tier fallback.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Equipment } from './sim/items';

/** The slots that have a worn look: every equipment slot. */
type WornSlot = 'weapon' | 'head' | 'chest' | 'legs' | 'hands' | 'feet' | 'offhand';
import { Appearance, appearanceOf } from './gear-look';
import { cappedIntensity } from './glow';
import { haloMesh } from './halo';
import { Instance, Prepared, SlotDef, smoothNormals, spawn } from './models';
import { bakeUV, dress } from './surface';
import type { Motes } from './fx';

const SKIN = 0xb89a7e;
/** A gathering tool is nobody's gear: it has no item, no tier and no appearance, so its two finishes are fixed here. */
const HAFT = 0x6a5235, TOOL_IRON = 0x8e949c;
/** The torch's flame, the same ember the standing torches burn (props.ts). `EMITTER_DIFFUSE` is render.ts's rule: an emitter shows its own light, not the room's. */
const FLAME = 0xff8a30, EMITTER_DIFFUSE = 0.15;
const UP = new THREE.Vector3(0, 1, 0);
const WHITE = new THREE.Color(0xffffff);
/**
 * Helmet and pauldron pieces are authored in rig units; these are the offsets from their bone (rig units) that seat them.
 * HELM_LIFT and HELM_FIT are measured rather than tuned by eye: the knight's skull stands 0.528 world units tall from
 * y 1.468, and the stock helm at its old lift and scale covered only to 1.965, so the crown came through the top of the
 * bowl (HOM-137). Together these clear the skull by about 40mm on every axis, and because the helm hangs off the same
 * Head bone the clearance holds through every pose rather than only at the bind.
 */
const HELM_LIFT = 0.62, SHOULDER_LIFT = 0.3, HELM_FIT = 1.18;

/**
 * glb gear is authored in the rig's units, not the world's, so models.ts baked its UVs at the wrong texel size: one world
 * unit of helm carried nearly two units of UV and the plate grain came out as speckle. The rebake is once per shared
 * geometry and idempotent -- every instance is the player's, drawn at the same rig scale.
 */
const FITTED = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

/**
 * Generated gear geometry, made ready to draw: non-indexed (so a facet carries neither a UV seam nor a shared normal
 * through its middle), creased, and projected for the surface maps. `smoothNormals` keeps every edge sharper than 45
 * degrees and rounds off the rest, so how many segments a part is built from is what decides how it reads -- a
 * sixteen-sided bowl or cuff shades as rolled metal and worked leather, while a six-sided greave, a box slab and a
 * four-sided spike keep their facets. That is the whole of "hard edges in places, smooth in others": no material says it.
 */
function forge(g: THREE.BufferGeometry): THREE.BufferGeometry {
  // UVs first, while the geometry still shares its vertices: `bakeUV` projects a non-indexed geometry per triangle,
  // which is right for a merged slab of facets and wrong for a rolled dome, where neighbouring triangles would pick
  // different axes and the grain would come out as a patchwork. Splitting afterwards carries the UVs along.
  const n = bakeUV(g);
  return g.index ? smoothed(n.toNonIndexed()) : smoothed(n);
}
const smoothed = (g: THREE.BufferGeometry) => { smoothNormals(g); return g; };

/**
 * How one part of a piece is finished. Roughness is what makes gear read as metal rather than as a tinted shape: the
 * shell keeps the item's own finish, the rolled rims and ridges are polished because they are what a wearer rubs bright,
 * and the straps under them are matte. One roughness over a whole piece is the thing that reads as plastic.
 */
type Finish = 'plate' | 'trim' | 'edge' | 'strap' | 'fur' | 'gem' | 'inlay';

/** A faceted spike that curves: `segs` tapering four-sided frusta stacked along an arc. Base at the origin, heading `start` radians off +Y towards +X, turning `bend` more along its length. */
function curvedSpike(r: number, len: number, start: number, bend: number, segs = 3) {
  const parts: THREE.BufferGeometry[] = [], l = len / segs, p = new THREE.Vector3();
  for (let i = 0; i < segs; i++) {
    const a = start + bend * (i + 0.5) / segs;
    const g = new THREE.CylinderGeometry(Math.max(0.002, r * (1 - (i + 1) / segs)), r * (1 - i / segs), l * 1.08, 4).translate(0, l / 2, 0);
    parts.push(g.rotateZ(-a).translate(p.x, p.y, p.z));
    p.x += Math.sin(a) * l; p.y += Math.cos(a) * l;
  }
  return mergeGeometries(parts)!;
}

/** A swept-back crest fin in profile (x forward, y up, `h` tall, `len` front to back), `thick` wide, centred on the skull's midline. */
function crestFin(h: number, len: number, thick: number) {
  const s = new THREE.Shape();
  s.moveTo(0.4 * len, 0); s.lineTo(0.2 * len, 0.55 * h); s.lineTo(-0.15 * len, h); s.lineTo(-0.6 * len, 0.7 * h); s.lineTo(-0.85 * len, 0.1 * h); s.lineTo(-0.6 * len, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false });
  return g.rotateY(-Math.PI / 2).translate(thick / 2, 0, 0);
}

interface Mounted { id: string | null; group: THREE.Object3D | null; materials: THREE.Material[] }
const empty = (): Mounted => ({ id: null, group: null, materials: [] });

/** The finishes one piece is built from, made on demand. `list` is what `unmount` frees, so a build never leaks a material it did not use. */
interface Palette { get(f: Finish): THREE.MeshStandardMaterial; list: THREE.Material[] }

export interface GearPieces { helmet: Prepared | null; pauldrons: Prepared | null; sword: Prepared | null }

export class PlayerGear {
  private model: THREE.Object3D;
  private bones = new Map<string, THREE.Object3D>();
  /** Bone transforms in model space at the bind pose, captured before any animation runs: mounts are placed from these, not from the live pose. */
  private bind = new Map<string, THREE.Matrix4>();
  /** World units -> model units (the fit wrapper scales the rig down). */
  private k: number;
  private slots: Record<WornSlot, Mounted> = { weapon: empty(), head: empty(), chest: empty(), legs: empty(), hands: empty(), feet: empty(), offhand: empty() };
  private bodyMats = new Map<string, THREE.MeshStandardMaterial>();
  private motes = { weapon: 0, head: 0, chest: 0, legs: 0, hands: 0, feet: 0, offhand: 0 };
  /** Gathering tools, built the first time their skill is worked and kept in the fist, hidden: there are three of them. */
  private tools = new Map<string, THREE.Object3D>();
  private held: string | null = null;
  private tmp = new THREE.Vector3();

  /** Call at the bind pose, before the Animator exists. */
  constructor(private inst: Instance, private pieces: GearPieces) {
    this.model = inst.root.children[0];
    inst.root.updateMatrixWorld(true);
    const modelInv = new THREE.Matrix4().copy(this.model.matrixWorld).invert();
    this.model.traverse(o => {
      const bone = (o as THREE.Bone).isBone;
      if (!bone && !o.name.endsWith('_end')) return; // the rig's `*_end` tips are plain nodes, not joints, but gear is sized from them
      if (bone) this.bones.set(o.name, o);
      this.bind.set(o.name, new THREE.Matrix4().multiplyMatrices(modelInv, o.matrixWorld));
    });
    this.k = 1 / this.model.scale.x;
    for (const m of inst.materials) if (m.name === 'Armor' || m.name === 'ArmorLegs' || m.name === 'Boots' || m.name === 'Hands') this.bodyMats.set(m.name, m as THREE.MeshStandardMaterial);
    this.dressBody('Armor', null);
    this.dressBody('ArmorLegs', null);
    this.dressBody('Boots', null);
    this.dressBody('Hands', null);
  }

  /** Where a bone sat at the bind pose, in model units. */
  private at(bone: string): THREE.Vector3 { return new THREE.Vector3().setFromMatrixPosition(this.bind.get(bone)!); }

  /** Parent `obj` to `bone`, positioned at `modelPos` (model units) with the bind pose's orientation, so it follows the bone from there. */
  private mount(bone: string, obj: THREE.Object3D, modelPos: THREE.Vector3, dir?: THREE.Vector3) {
    const q = dir ? new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize()) : new THREE.Quaternion(); // `dir`: where the piece's +Y points, in model space
    const local = new THREE.Matrix4().copy(this.bind.get(bone)!).invert().multiply(new THREE.Matrix4().compose(modelPos, q, new THREE.Vector3(1, 1, 1)));
    obj.matrixAutoUpdate = true;
    local.decompose(obj.position, obj.quaternion, obj.scale);
    this.bones.get(bone)!.add(obj);
  }

  /** A piece on its own bone, of a slot that spans several: holder is only a handle that remembers the pieces, since each lives under a different bone. */
  private mountPiece(holder: THREE.Object3D, bone: string, obj: THREE.Object3D, modelPos: THREE.Vector3, dir?: THREE.Vector3) {
    this.mount(bone, obj, modelPos, dir);
    (holder.userData.pieces ??= [] as THREE.Object3D[]).push(obj);
  }

  /** Generated geometry is authored in world units; this wrapper puts it in model units. Meshes are flagged so unmount() can free them. */
  private world(): THREE.Group {
    const g = new THREE.Group();
    g.scale.setScalar(this.k);
    return g;
  }

  private part(g: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D, pos: [number, number, number], rot?: [number, number, number]) {
    const m = new THREE.Mesh(forge(g), material);   // generated gear is authored in world units, so the projection is already to scale
    m.castShadow = m.receiveShadow = true;
    m.userData.own = true;
    m.position.set(...pos);
    if (rot) m.rotation.set(...rot);
    parent.add(m);
    return m;
  }

  /** A ring standing proud of a shell: a rolled rim, a strap, a brow band. Many-sided, so it shades as a rolled edge rather than a nut. */
  private band(r0: number, r1: number, h: number, finish: Finish, p: Palette, parent: THREE.Object3D, pos: [number, number, number], rot?: [number, number, number]) {
    return this.part(new THREE.CylinderGeometry(r0, r1, h, 18, 1, true), p.get(finish), parent, pos, rot);
  }

  /**
   * A cut stone, set in a collar: the crest and jewel work a rung-3-and-up piece carries. Flat-shaded and faceted,
   * because a stone is its facets, and ringed in the polished finish so it reads as set rather than glued on.
   */
  private jewel(r: number, p: Palette, parent: THREE.Object3D, pos: [number, number, number], rot?: [number, number, number]) {
    this.part(new THREE.CylinderGeometry(r * 1.5, r * 1.6, r * 0.55, 8), p.get('edge'), parent, pos, rot);
    return this.part(new THREE.OctahedronGeometry(r).scale(1, 0.75, 1), p.get('gem'), parent, pos, rot);
  }

  /** A cone of base radius `r` and length `len` standing at `pos` and pointing along `dir`. */
  private spikeOut(material: THREE.Material, parent: THREE.Object3D, pos: [number, number, number], dir: [number, number, number], r: number, len: number) {
    const m = this.part(new THREE.ConeGeometry(r, len, 4).translate(0, len / 2, 0), material, parent, pos);
    m.quaternion.setFromUnitVectors(UP, new THREE.Vector3(...dir).normalize());
    return m;
  }

  /**
   * One finish of a piece. Nothing here is flat-shaded except the cut stone: `forge()` creases the geometry at 45 degrees
   * instead, so the shape decides where the hard edges fall. Four colours are in play on a piece of plate -- the shell's
   * tint, the darker trim, a polished edge off the tint, and the strap leather under it all -- which is what keeps a set
   * from reading as one tinted shape.
   */
  private material(ap: Appearance, finish: Finish): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ flatShading: finish === 'gem' });
    const hide = ap.metal <= 0.3;   // a leather piece takes the pebble grain, a plated one the hammer's
    let cls = hide ? 'hide' : 'plate';
    switch (finish) {
      case 'plate': m.color.setHex(ap.tint); m.metalness = ap.metal; m.roughness = ap.rough; break;
      case 'trim': m.color.setHex(ap.trim); m.metalness = Math.min(ap.metal, 0.6); m.roughness = Math.min(1, ap.rough + 0.15); break;
      // the rolled rim, the brow band, the ridge down a greave: worked thin and rubbed bright, so the key light lands on
      // an edge and nowhere else. On plate this is the whole of the specular read.
      case 'edge': m.color.setHex(ap.tint).lerp(WHITE, 0.24); m.metalness = Math.max(ap.metal, 0.55); m.roughness = Math.max(0.08, ap.rough * 0.3); break;
      case 'strap': m.color.setHex(ap.accent!); m.metalness = 0.02; m.roughness = 0.78; cls = 'hide'; break;
      case 'fur': m.color.setHex(ap.accent!).lerp(WHITE, 0.22); m.metalness = 0; m.roughness = 1; m.side = THREE.DoubleSide; cls = 'fur'; break;
      // a set stone. It takes the piece's own seam colour and only lights up where that colour is a cold one: an amber in
      // iron or bronze is a polished stone catching the key, not a new family of emissive (docs/art-direction.md).
      case 'gem':
        m.color.setHex(ap.gem!); m.metalness = 0; m.roughness = 0.07; cls = 'gem';
        if (ap.glow) { m.emissive.setHex(ap.gem!); m.emissiveIntensity = cappedIntensity(ap.gem!, Math.max(0.35, ap.glowI)); }
        break;
      // a glowing inlay (vein, seam): the one place the tier's cold emissive lives on generated geometry, capped under the bloom threshold
      case 'inlay':
        m.color.setHex(ap.trim); m.metalness = 0.3; m.roughness = 0.4; m.side = THREE.DoubleSide;
        m.emissive.setHex(ap.glow || 0); m.emissiveIntensity = ap.glow ? cappedIntensity(ap.glow, ap.glowI * 1.8) : 0;
        return m;   // a light has no surface
    }
    dress(m, cls);
    return m;
  }

  /** The finishes a build draws on, made the first time each is asked for and collected so `unmount` can free them. */
  private palette(ap: Appearance): Palette {
    const made = new Map<Finish, THREE.MeshStandardMaterial>(), list: THREE.Material[] = [];
    return {
      list,
      get: (f: Finish) => {
        let m = made.get(f);
        if (!m) { made.set(f, m = this.material(ap, f)); list.push(m); }
        return m;
      },
    };
  }

  /**
   * A glb gear piece, made ready to wear: creased like generated gear (so the bowl of a helm rolls and its folds stay
   * hard) and re-projected in world units, because models.ts baked these in the rig's and put nearly two tiles of plate
   * grain in every world unit -- which is what the speckle on the old helm was. Cached per source geometry: every
   * instance is the player's and is drawn at the same rig scale.
   */
  private fitPiece(def: SlotDef, o: THREE.Object3D) {
    o.traverse(c => {
      const mesh = c as THREE.Mesh;
      if (!mesh.isMesh) return;
      let g = FITTED.get(mesh.geometry);
      if (!g) {
        let fit = mesh.geometry.clone();
        if (!def.keepMaps) fit = bakeUV(fit, 1 / this.k);   // UVs before the split, as in `forge`
        if (!def.keepNormals) fit = smoothed(fit.index ? fit.toNonIndexed() : fit);
        FITTED.set(mesh.geometry, g = fit);
      }
      mesh.geometry = g;
    });
  }

  private double(m: THREE.MeshStandardMaterial) { const d = m.clone(); d.side = THREE.DoubleSide; return d; }

  /**
   * Recolour a glb piece's materials by name: `main` names take the tint, `trim` names the trim (and the glow). The pack
   * ships these flat-shaded; worn plate is left smooth so the shell reads as a beaten bowl and the hard edges come from
   * the rims and ridges built onto it, which is the same rule `forge()` applies to generated gear.
   */
  private restyle(def: SlotDef, mats: THREE.Material[], ap: Appearance, main: string[], trim: string[], cls: 'plate' | 'metal' = 'plate', polish = 1) {
    const blade = cls === 'metal';
    for (const mat of mats as THREE.MeshStandardMaterial[]) {
      const isMain = main.includes(mat.name), isTrim = trim.includes(mat.name);
      if (mat.name === 'Brown') { mat.color.setHex(ap.accent!); mat.metalness = 0; mat.roughness = 0.85; continue; } // the grip's leather wrap
      if (!isMain && !isTrim) continue;
      if (!def.keepMaps) {
        mat.map = null;
        dress(mat, cls);   // the pack's own texture goes; the class's maps (hung by models.ts) go back on
      }
      mat.color.setHex(isMain ? ap.tint : ap.trim);   // the tier ladder is a retint of one mesh, so it stays either way
      mat.metalness = isMain ? ap.metal : Math.min(ap.metal, 0.6);
      mat.roughness = Math.max(0.08, (isMain ? ap.rough : Math.min(1, ap.rough + 0.15)) * polish);
      mat.flatShading = false;
      if (ap.glow && blade && (isTrim || isMain)) { mat.emissive.setHex(ap.glow); mat.emissiveIntensity = cappedIntensity(ap.glow, isTrim ? ap.glowI : ap.glowI * 0.4); }
      mat.needsUpdate = true;
    }
  }

  private unmount(slot: WornSlot) {
    const s = this.slots[slot];
    s.group?.removeFromParent();
    for (const o of (s.group?.userData.pieces ?? []) as THREE.Object3D[]) o.removeFromParent();
    s.group?.traverse(o => { if (o.userData.own) (o as THREE.Mesh).geometry.dispose(); });
    for (const m of s.materials) m.dispose();
    this.slots[slot] = empty();
  }

  /** Dress the body materials for a slot: skin when bare, the item's tint when worn. */
  private dressBody(name: 'Armor' | 'ArmorLegs' | 'Boots' | 'Hands', id: string | null) {
    const m = this.bodyMats.get(name);
    if (!m) return;
    const ap = id ? appearanceOf(id) : null;
    m.color.setHex(ap ? ap.tint : SKIN);
    m.metalness = ap ? ap.metal : 0.02;
    m.roughness = ap ? ap.rough : 0.9;
    m.emissive.setHex(0);
  }

  /** An Echo shard: a long faceted stone in the set's own seam colour, standing at `pos` and leaning out along `lean` (radians round the Y axis, 0 = towards +Z) by a fixed tilt. Used by the Echo blades and the Echohide leather. */
  private echoShard(r: number, len: number, p: Palette, parent: THREE.Object3D, pos: [number, number, number], lean = 0, tilt = 0.5) {
    return this.part(new THREE.OctahedronGeometry(r).scale(1, len, 1), p.get('gem'), parent, pos, [Math.cos(lean) * tilt, 0, -Math.sin(lean) * tilt]);
  }

  /**
   * The seven Echo blades (HOM-177, docs/combat-99.md 6.2), each a shape of its own on the sword model: the glb gives the grip and the blade's base
   * silhouette and these parts change it. Authored in the blade's own units (1.15 tall, butt at the origin, broad across X, thin across Z), so every
   * dimension is a fraction of a blade however far the item's `scale` stretches it. The thread is the Echo: shards, marks, and the afterimage.
   * 1 a shard clamped at the guard; 2 three tally marks cut in the flat; 3 the blade split, its halves hanging either side; 4 a saw of shards down one edge under a
   * crescent guard; 5 fans of feathers off the guard and shards orbiting the forte; 6 no steel at all, one long crystal; 7 dark to the edge, trailing three afterimages.
   */
  private echoBlade(n: number, p: Palette, root: THREE.Object3D, glb: THREE.Material[]) {
    const trim = p.get('trim'), edge = p.get('edge'), vein = p.get('inlay'), gem = p.get('gem');
    const shard = (r: number, len: number, pos: [number, number, number], rot?: [number, number, number]) => this.part(new THREE.OctahedronGeometry(r).scale(1, len, 1), gem, root, pos, rot);
    const horn = (side: number, y: number, r: number, len: number, start: number, bend: number) => { this.part(curvedSpike(r, len, start, bend, 4), trim, root, [0, y, 0]).scale.x = side; }; // a crescent arm, up and out along ±X
    switch (n) {
      case 1:
        shard(0.065, 2.2, [0, 0.2, 0]);                                              // the clamped shard, stood across the guard
        this.part(new THREE.BoxGeometry(0.02, 0.5, 0.07), vein, root, [0, 0.65, 0]); // a seam down the blade's centre
        this.part(new THREE.BoxGeometry(0.2, 0.04, 0.06), edge, root, [0, 0.2, 0]);  // the guard it is clamped to
        break;
      case 2:
        for (const [i, y] of [0.46, 0.6, 0.74].entries()) this.part(new THREE.BoxGeometry(0.15 - i * 0.025, 0.02, 0.07), vein, root, [0, y, 0]); // three marks, each a notch shorter: a tally
        this.part(new THREE.BoxGeometry(0.3, 0.05, 0.075), trim, root, [0, 0.2, 0]);   // a heavy bar guard
        for (const s of [-1, 1]) shard(0.035, 1.8, [s * 0.17, 0.2, 0]);                // a shard at each end of it
        break;
      case 3:
        for (const s of [-1, 1]) {                                                     // the blade split: a half hangs off each edge, parted from it
          shard(0.04, 6.5, [s * 0.1, 0.72, 0], [0, 0, -s * 0.045]);
          shard(0.02, 3, [s * 0.16, 0.5, 0], [0, 0, -s * 0.09]);
        }
        this.part(new THREE.BoxGeometry(0.26, 0.04, 0.06), edge, root, [0, 0.2, 0]);
        this.part(new THREE.BoxGeometry(0.016, 0.5, 0.075), vein, root, [0, 0.7, 0]);
        break;
      case 4:
        for (let i = 0; i < 5; i++) this.part(new THREE.ConeGeometry(0.05 - i * 0.004, 0.2 - i * 0.02, 4), gem, root, [-0.07, 0.42 + i * 0.14, 0], [0, 0, 0.9]); // teeth down the left edge, hooked up the blade
        for (const s of [-1, 1]) horn(s, 0.2, 0.035, 0.3, 1.25, -0.9);                 // the crescent guard, tips up
        this.part(new THREE.BoxGeometry(0.12, 0.04, 0.06), edge, root, [0, 0.2, 0]);
        break;
      case 5:
        for (const s of [-1, 1]) for (const [i, [y, h]] of ([[0.18, 0.08], [0.2, 0.5], [0.22, 1.0]] as const).entries()) this.spikeOut(i === 1 ? gem : trim, root, [s * 0.05, y, 0], [s * 1, h, 0], 0.04, 0.2 + i * 0.07); // three feathers a side, fanned up off the guard
        for (let i = 0; i < 4; i++) { const a = i * 1.7; shard(0.04, 2.2, [Math.sin(a) * 0.13, 0.42 + i * 0.17, Math.cos(a) * 0.13]); } // and shards turning round the blade
        break;
      case 6: {
        root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && glb.includes(m.material as THREE.Material) && (m.material as THREE.Material).name === 'Metal') m.visible = false; }); // no steel: the blade is the stone
        this.part(new THREE.CylinderGeometry(0.0, 0.09, 1.1, 6).translate(0, 0.55, 0).scale(1.1, 1, 0.7), gem, root, [0, 0.2, 0]);
        this.part(new THREE.BoxGeometry(0.02, 0.8, 0.16), vein, root, [0, 0.7, 0]);                  // a core of light down the crystal\n        for (const s of [-1, 1]) this.part(new THREE.CylinderGeometry(0.0, 0.055, 0.8, 6).translate(0, 0.4, 0), gem, root, [s * 0.06, 0.14, s * 0.04], [s * 0.2, 0, -s * 0.2]); // two more stones grown off the first
        this.band(0.085, 0.085, 0.05, 'edge', p, root, [0, 0.18, 0]);
        this.band(0.07, 0.07, 0.12, 'trim', p, root, [0, 0.08, 0]);
        break;
      }
      case 7: {
        const sh = new THREE.Shape();
        sh.moveTo(-0.06, 0.2); sh.lineTo(-0.075, 0.95); sh.lineTo(0, 1.3); sh.lineTo(0.075, 0.95); sh.lineTo(0.06, 0.2);
        for (const [k, a] of [0.3, 0.18, 0.1].entries()) {                             // each afterimage is the blade a moment ago: further round, fainter
          const m = vein.clone(); m.transparent = true; m.opacity = a; m.depthWrite = false; p.list.push(m);
          const g = this.part(new THREE.ExtrudeGeometry(sh, { depth: 0.01, bevelEnabled: false }), m, root, [0, 0, 0.02 * (k + 1)], [0, 0, 0.07 * (k + 1)]);
          g.castShadow = g.receiveShadow = false;
        }
        const ring = this.part(new THREE.TorusGeometry(0.12, 0.01, 4, 20), vein, root, [0, 0.2, 0], [Math.PI / 2, 0, 0]); // a ring at the guard
        ring.castShadow = false;
        this.part(new THREE.BoxGeometry(0.18, 0.04, 0.06), edge, root, [0, 0.2, 0]);
        break;
      }
    }
  }

  private buildWeapon(id: string) {
    const sword = this.pieces.sword, hand = this.bones.get('MiddleHandR');
    if (!sword || !hand) return null;
    const ap = appearanceOf(id);
    const blade = spawn(sword, true);
    blade.root.matrixAutoUpdate = true;
    blade.root.scale.setScalar(ap.scale / hand.getWorldScale(this.tmp).x);
    blade.root.rotation.z = Math.PI * 0.75; // blade forward and up from the fist
    if (ap.width) blade.root.scale.z *= ap.width; // broad adamant, narrow stormiron
    this.restyle(sword.def, blade.materials, ap, ['Metal'], ['Gold', 'Red'], 'metal');
    const mats: THREE.Material[] = [...blade.materials];
    if (ap.rung >= 3) {
      // A stone in the pommel of anything above plain steel. The sword slot is fitted to 1.15 units tall with its butt at
      // the origin, so these are fractions of a blade however far the item's own `scale` stretches it.
      const p = this.palette(ap);
      this.jewel(0.05, p, blade.root, [0, 0.05, 0]);
      if (ap.blade) this.echoBlade(ap.blade, p, blade.root, blade.materials);
      mats.push(...p.list);
    }
    hand.add(blade.root);
    return { group: blade.root, materials: mats };
  }

  /**
   * The tool a gathering skill is worked with, held in the same fist as the sword and authored the way the sword model
   * is: haft along +Y with the grip at the origin, in world units (the knight is 2.0 tall), scaled into bone space on
   * mount. Herbalism has none: a herb is pulled by hand.
   */
  private buildTool(skill: string, hand: THREE.Object3D) {
    const g = new THREE.Group();
    g.scale.setScalar(1 / hand.getWorldScale(this.tmp).x);
    // A quarter turn back from where the sword's blade points puts the haft out along the arm's own line; the rest of the
    // turn cocks the head back off it, so the swing drives the head past the hands instead of hiding it behind them.
    g.rotation.z = -Math.PI / 4 + 0.45;
    const wood = new THREE.MeshStandardMaterial({ color: HAFT, metalness: 0.02, roughness: 0.82 });
    const iron = new THREE.MeshStandardMaterial({ color: TOOL_IRON, metalness: 0.7, roughness: 0.42 });
    dress(wood, 'wood');
    dress(iron, 'metal');
    const haft = (len: number) => this.part(new THREE.CylinderGeometry(0.03, 0.038, len, 8).translate(0, len / 2, 0), wood, g, [0, 0, 0]);
    if (skill === 'fishing') {
      // a rod, not a tool with a head: long, whippy and tapered to nothing, with a cork grip at the butt
      this.part(new THREE.CylinderGeometry(0.007, 0.026, 1.8, 6).translate(0, 0.9, 0), wood, g, [0, 0, 0]);
      this.part(new THREE.CylinderGeometry(0.042, 0.042, 0.22, 8).translate(0, 0.1, 0), iron, g, [0, 0, 0]);
    } else if (skill === 'woodcutting') {
      // a felling axe: one bit, swung edge-on, so the blade's plane is the plane the arc travels in
      haft(0.62);
      this.part(new THREE.CylinderGeometry(0.05, 0.05, 0.11, 6).translate(0, 0.6, 0), iron, g, [0, 0, 0]);
      const s = new THREE.Shape();
      s.moveTo(0, -0.12); s.lineTo(0.22, -0.18); s.lineTo(0.28, 0); s.lineTo(0.22, 0.18); s.lineTo(0, 0.12);
      const bit = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: false }).translate(0, 0, -0.025).rotateY(-Math.PI / 2);
      this.part(bit.translate(0, 0.6, 0.045), iron, g, [0, 0, 0]);
    } else {
      // a pick: a long spike forward and a short blunt poll back, the head crossing the haft in the swing's own plane
      haft(0.66);
      this.part(new THREE.CylinderGeometry(0.048, 0.048, 0.1, 6).translate(0, 0.64, 0), iron, g, [0, 0, 0]);
      this.part(new THREE.CylinderGeometry(0.008, 0.045, 0.36, 4).translate(0, 0.18, 0).rotateX(Math.PI / 2 + 0.22).translate(0, 0.64, 0), iron, g, [0, 0, 0]);
      this.part(new THREE.CylinderGeometry(0.03, 0.046, 0.2, 4).translate(0, 0.1, 0).rotateX(-Math.PI / 2 + 0.22).translate(0, 0.64, 0), iron, g, [0, 0, 0]);
    }
    hand.add(g);
    return g;
  }

  /**
   * Put the gathering tool for `skill` in the right hand, or take it away with null. The sword is stowed while a tool is
   * out: nobody swings a pick with a drawn blade in the same fist. Each tool is built once and kept.
   */
  hold(skill: string | null) {
    const want = skill && skill !== 'herbalism' ? skill : null;
    const hand = this.bones.get('MiddleHandR');
    if (!hand) return;
    if (want !== this.held) {
      const prev = this.held && this.tools.get(this.held);
      if (prev) prev.visible = false;
      this.held = want;
      if (want) {
        let tool = this.tools.get(want);
        if (!tool) this.tools.set(want, tool = this.buildTool(want, hand));
        tool.visible = true;
      }
    }
    const sword = this.slots.weapon.group;
    if (sword) sword.visible = !this.held;   // set every frame: sync() rebuilds the slot without knowing a tool is out
  }

  private buildHead(id: string) {
    const ap = appearanceOf(id), g = new THREE.Group(), w = this.world(), p = this.palette(ap);
    const main = p.get('plate'), trim = p.get('trim');
    if (ap.form === 'gutterhook') {
      // a salvaged cap with a gutting hook lashed over the brow: the hook is the silhouette, a single cold glint at its tip
      const vein = p.get('inlay');
      this.part(new THREE.SphereGeometry(0.3, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.95, 1.05), main, w, [0, -0.02, 0]);
      this.band(0.31, 0.34, 0.07, 'edge', p, w, [0, -0.04, 0]);
      this.band(0.325, 0.325, 0.03, 'strap', p, w, [0, 0.12, 0]); // lashing band
      const hook = this.part(curvedSpike(0.05, 0.62, -0.1, 2.9, 5), trim, w, [0, 0.2, 0.22], [0, -Math.PI / 2, 0]); // up from the brow and over, point back down
      hook.scale.setScalar(1);
      this.part(new THREE.OctahedronGeometry(0.06), vein, w, [0, 0.42, 0.02]);
      this.part(new THREE.BoxGeometry(0.32, 0.035, 0.04), vein, w, [0, -0.02, 0.32]); // a narrow eye slit's worth of light under the brim
    } else if (ap.form === 'crown') {
      // the one head piece that is not a helm: a five-point circlet over a bare head, its own stone over the brow
      this.band(0.3, 0.315, 0.13, 'plate', p, w, [0, -0.12, 0]);
      this.band(0.305, 0.305, 0.028, 'edge', p, w, [0, -0.055, 0]);
      this.band(0.312, 0.312, 0.028, 'edge', p, w, [0, -0.185, 0]);
      for (let i = 0; i < 5; i++) {
        const t = (i / 5) * Math.PI * 2 + Math.PI, lean = i === 0 ? 0 : 0.18;
        this.spikeOut(trim, w, [Math.sin(t) * 0.3, -0.06, Math.cos(t) * 0.3], [Math.sin(t) * lean, 1, Math.cos(t) * lean], 0.05, i === 0 ? 0.3 : 0.2);
      }
      this.jewel(0.06, p, w, [0, -0.05, 0.3], [Math.PI / 2, 0, 0]);
    } else if (ap.rung <= 1 || !this.pieces.helmet) {
      // leather cap: a low dome and a rolled brim, close to the skull. Rolled from enough segments to shade as worked
      // leather rather than as a faceted ball, with the brim the one hard line on it.
      this.part(new THREE.SphereGeometry(0.3, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.88, 1.05), main, w, [0, -0.02, 0]);
      this.band(0.31, 0.325, 0.065, 'trim', p, w, [0, -0.04, 0]);
      this.part(new THREE.BoxGeometry(0.055, 0.1, 0.09), p.get('strap'), w, [0, -0.02, 0.3]); // the brow strap, riveted at the front
    } else {
      const helm = spawn(this.pieces.helmet, true);
      this.fitPiece(this.pieces.helmet.def, helm.root);
      helm.root.matrixAutoUpdate = true;
      helm.root.scale.setScalar(HELM_FIT * (ap.rung >= 3 ? 1.04 : 1));
      this.restyle(this.pieces.helmet.def, helm.materials, ap, ['Grey'], ['DarkGrey']);
      p.list.push(...helm.materials);
      g.add(helm.root);
      if (ap.form === 'adamant') {
        // a heavy squared helm: brow slab, flat ridge, cheek slabs and a T of jade light. No horns, no crest: the mass is the read.
        const vein = p.get('inlay');
        helm.root.scale.setScalar(HELM_FIT * 1.06);
        this.part(new THREE.BoxGeometry(0.66, 0.1, 0.52), trim, w, [0, 0.14, 0.06]);
        this.part(new THREE.BoxGeometry(0.2, 0.14, 0.74), main, w, [0, 0.32, -0.02]);
        this.part(new THREE.BoxGeometry(0.21, 0.035, 0.75), p.get('edge'), w, [0, 0.4, -0.02]); // the ridge's polished crown
        for (const s of [-1, 1]) this.part(new THREE.BoxGeometry(0.09, 0.34, 0.34), trim, w, [s * 0.31, -0.06, 0.04]);
        this.part(new THREE.BoxGeometry(0.34, 0.04, 0.04), vein, w, [0, 0.04, 0.3]);
        this.part(new THREE.BoxGeometry(0.04, 0.22, 0.04), vein, w, [0, -0.07, 0.3]);
        this.jewel(0.06, p, w, [0, 0.2, 0.26], [Math.PI / 2.4, 0, 0]);
      } else if (ap.form === 'storm') {
        // a lean helm under a fan of backswept spikes and two long cheek barbs: a jagged crown that reads from every side
        const vein = p.get('inlay');
        helm.root.scale.setScalar(HELM_FIT);
        for (const [x, len, lift] of [[0, 0.8, 0.28], [-0.14, 0.62, 0.24], [0.14, 0.62, 0.24]] as const)
          this.part(curvedSpike(0.06, len, 0.9, 0.4), trim, w, [x, lift, 0.1], [0, Math.PI / 2, 0]);
        for (const s of [-1, 1]) this.part(curvedSpike(0.05, 0.4, 1.2, -0.5), trim, w, [s * 0.3, 0.02, 0.1]).scale.x = s;
        this.part(new THREE.BoxGeometry(0.03, 0.4, 0.04), vein, w, [0, 0.4, 0.2], [0.9, 0, 0]);
        this.part(new THREE.BoxGeometry(0.34, 0.03, 0.04), vein, w, [0, 0.04, 0.3]);
        this.jewel(0.055, p, w, [0, 0.21, 0.24], [Math.PI / 2.6, 0, 0]);
      } else if (ap.form === 'star') {
        // a clean black helm and one thing over it: a four-point star hung on a stem above the brow, two crossed diamonds around a bright core. Two long blades sweep back off the cheeks.
        const vein = p.get('inlay');
        helm.root.scale.setScalar(HELM_FIT * 1.02);
        this.part(new THREE.CylinderGeometry(0.02, 0.05, 0.3, 4), trim, w, [0, 0.44, 0]);
        this.part(new THREE.OctahedronGeometry(0.1).scale(0.5, 2.8, 0.5), vein, w, [0, 0.72, 0]);
        this.part(new THREE.OctahedronGeometry(0.1).scale(2.4, 0.5, 0.5), vein, w, [0, 0.72, 0]);
        this.part(new THREE.OctahedronGeometry(0.06), vein, w, [0, 0.72, 0], [0.6, 0.6, 0]);
        for (const s of [-1, 1]) this.part(curvedSpike(0.05, 0.62, 1.5, -0.35), trim, w, [s * 0.3, 0.02, -0.02]).scale.x = s;
        this.part(new THREE.BoxGeometry(0.3, 0.035, 0.04), vein, w, [0, 0.04, 0.3]); // the visor slit
      } else {
        // The ladder's own plate helms. Every rung gets the brow it is read by: a band rolled round the widest line of
        // the bowl, and a nasal hanging off it down the middle of the face, both polished. The bowl stays smooth, so
        // these two are the only hard lit lines on the helm and the eye slit sits in their shadow.
        this.band(0.344, 0.348, 0.055, 'edge', p, w, [0, 0.01, 0]);
        this.part(new THREE.CylinderGeometry(0.055, 0.02, 0.23, 4).rotateY(Math.PI / 4), p.get('edge'), w, [0, -0.1, 0.315]);
        this.part(crestFin(0.1, 0.56, 0.05), p.get('edge'), w, [0, 0.19, -0.02]);   // a low comb over the crown, so the bowl is not a bare dome
        if (ap.rung >= 3) { // a swept crest along the skull: the silhouette cue from behind
          const h = ap.rung >= 4 ? 0.5 : 0.28;
          this.part(crestFin(h, 0.62, ap.rung >= 4 ? 0.07 : 0.05), trim, w, [0, 0.24, -0.02]);
          const vein = p.get('inlay');
          this.part(new THREE.BoxGeometry(ap.rung >= 4 ? 0.1 : 0.08, h * 0.7, 0.04), vein, w, [0, 0.24 + h * 0.55, -0.2 * h / 0.5], [0.55, 0, 0]); // vein up the crest's back edge, standing proud of the fin
          this.jewel(0.055, p, w, [0, 0.19, 0.2], [Math.PI / 2.6, 0, 0]); // the crest's stone, set at its root over the brow
          if (ap.rung >= 4) {
            // aventail: a flared plate over the nape, with a glowing seam down it: the read from behind at play distance
            const back = new THREE.CylinderGeometry(0.34, 0.46, 0.3, 6, 1, true, Math.PI / 2, Math.PI);
            const plate = this.double(trim);
            p.list.push(plate);
            this.part(back, plate, w, [0, -0.24, 0]);
            this.part(new THREE.BoxGeometry(0.06, 0.28, 0.04), vein, w, [0, -0.24, -0.45]);
            this.part(new THREE.CylinderGeometry(0.455, 0.465, 0.03, 6, 1, true, Math.PI / 2, Math.PI), vein, w, [0, -0.38, 0]); // hem line
            // horns: three-piece curved spikes that sweep out and back up
            for (const s of [-1, 1]) this.part(curvedSpike(0.075, 0.55, 1.1, -0.9), trim, w, [s * 0.26, 0.14, 0], [0, 0, 0]).scale.x = s;
          }
        }
      }
    }
    g.add(w);
    this.mount('Head', g, this.at('Head').add(new THREE.Vector3(0, HELM_LIFT, 0)));
    return { group: g, materials: p.list };
  }

  private buildChest(id: string) {
    const ap = appearanceOf(id);
    if (ap.form === 'greywolf') return this.buildHauberk(ap);
    if (ap.rung <= 1 || !this.pieces.pauldrons) return { group: null, materials: [] };
    const g = new THREE.Group(), w = this.world(), p = this.palette(ap);
    const pads = spawn(this.pieces.pauldrons, true);
    this.fitPiece(this.pieces.pauldrons.def, pads.root);
    pads.root.matrixAutoUpdate = true;
    pads.root.scale.setScalar(1 + 0.18 * (ap.rung - 2));
    // The shoulders are the one part of a worn set that is always turned up at the sky, so they are left half as rough as
    // the breast under them: the key light picks them out and the torso stays matte. Plate that is one roughness all over
    // has no shape in a frame lit by a single moon.
    this.restyle(this.pieces.pauldrons.def, pads.materials, ap, ['Grey'], [], 'plate', 0.55);
    p.list.push(...pads.materials);
    g.add(pads.root);
    // A gorget at the throat and a baldric across the chest, on every plated rung: the head then sits in a ring of metal
    // rather than on a bare neck, and the strap is the piece's one soft material, so plate never covers a whole torso.
    // The neck is at +0.09 above this mount and the chest's front face at z +0.25, both measured off the rig.
    this.band(0.17, 0.25, 0.14, 'plate', p, w, [0, 0.145, 0.01]);
    this.band(0.176, 0.176, 0.03, 'edge', p, w, [0, 0.21, 0.01]);
    this.part(new THREE.BoxGeometry(0.075, 0.46, 0.04), p.get('strap'), w, [0.03, -0.08, 0.235], [0, 0, 0.45]);
    if (ap.rung >= 3) this.jewel(0.055, p, w, [0, 0.15, 0.23], [Math.PI / 2, 0, 0]); // the gorget's stone, under the chin
    if (ap.form === 'adamant' || ap.form === 'storm') {
      const trim = p.get('trim'), main = p.get('plate'), vein = p.get('inlay');
      pads.root.scale.setScalar(ap.form === 'adamant' ? 1.5 : 1.1);
      for (const s of [-1, 1]) {
        if (ap.form === 'adamant') { // square slab over each shoulder, a lit stud in it, and a gorget collar
          this.part(new THREE.BoxGeometry(0.5, 0.1, 0.44), trim, w, [s * 0.38, 0.2, 0]);
          this.part(new THREE.BoxGeometry(0.12, 0.12, 0.12), vein, w, [s * 0.38, 0.27, 0]);
        } else { // two upswept barbs a side, and a lit root
          this.part(curvedSpike(0.07, 0.75, 0.35, 0.5), trim, w, [s * 0.34, 0.1, 0]).scale.x = s;
          this.part(curvedSpike(0.05, 0.5, 0.9, 0.3), trim, w, [s * 0.4, 0.06, -0.08]).scale.x = s;
          this.part(new THREE.OctahedronGeometry(0.07), vein, w, [s * 0.34, 0.1, 0]);
        }
      }
      if (ap.form === 'adamant') this.part(new THREE.CylinderGeometry(0.3, 0.38, 0.16, 6), main, w, [0, 0.16, 0]);
      else for (const z of [0, 1, 2]) this.part(curvedSpike(0.045, 0.4 - z * 0.08, 2.6, 0.3, 2), trim, w, [0, 0.1 - z * 0.3, -0.3]); // dorsal barbs down the spine
    } else if (ap.form === 'star') {
      // each shoulder a fan of three swept pinions with a lit root, and a four-point star set on the back between them (the camera sits behind the player)
      const trim = p.get('trim'), main = p.get('plate'), vein = p.get('inlay');
      pads.root.scale.setScalar(1.35);
      for (const s of [-1, 1]) {
        for (let i = 0; i < 3; i++) this.part(curvedSpike(0.065 - i * 0.012, 0.78 - i * 0.16, 0.45 + i * 0.4, 0.35, 3), trim, w, [s * 0.34, 0.1 - i * 0.03, -0.02 * i]).scale.x = s;
        this.part(new THREE.OctahedronGeometry(0.08), vein, w, [s * 0.34, 0.1, 0]);
      }
      this.part(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 6).rotateX(Math.PI / 2), main, w, [0, -0.28, -0.3]);
      this.part(new THREE.OctahedronGeometry(0.1).scale(0.55, 3.0, 0.55), vein, w, [0, -0.28, -0.34]);
      this.part(new THREE.OctahedronGeometry(0.1).scale(3.0, 0.55, 0.55), vein, w, [0, -0.28, -0.34]);
    } else if (ap.rung >= 3) { // spikes on the shoulders: horizontal read at gathering distance
      const trim = p.get('trim'), h = ap.rung >= 4 ? 0.3 : 0.18;
      for (const s of [-1, 1]) {
        this.part(curvedSpike(0.07, h * 1.7, 0.5, 0.5), trim, w, [s * 0.34, 0.08, 0]).scale.x = s;
        this.part(new THREE.OctahedronGeometry(0.075), p.get('inlay'), w, [s * 0.34, 0.08, 0]); // a lit collar where the spike meets the plate
      }
    }
    g.add(w);
    this.mount('Torso', g, this.at('Torso').add(new THREE.Vector3(0, SHOULDER_LIFT, 0)));
    return { group: g, materials: p.list };
  }

  /** The Greywolf Hauberk: a wolfskin mantle in two flared tiers and a wolf's head on the left shoulder with a cold glint for each eye. */
  private buildHauberk(ap: Appearance) {
    const g = new THREE.Group(), w = this.world(), p = this.palette(ap);
    const fur = this.double(p.get('plate')), dark = p.get('trim'), eye = p.get('inlay');
    p.list.push(fur);
    // seven sides, not the eighteen a rolled cuff takes: a pelt hangs in folds, and a mantle shaded smooth reads as a cone of stone
    this.part(new THREE.CylinderGeometry(0.34, 0.5, 0.2, 7, 1, true), fur, w, [0, 0.12, 0]);
    this.part(new THREE.CylinderGeometry(0.46, 0.64, 0.2, 7, 1, true), fur, w, [0, -0.04, 0]);
    this.band(0.345, 0.345, 0.035, 'strap', p, w, [0, 0.2, 0]); // the thong the mantle is drawn up on
    // the head: snout forward and out over the left shoulder, ears up
    this.part(new THREE.ConeGeometry(0.15, 0.4, 5), dark, w, [-0.4, 0.26, 0.2], [Math.PI / 2, 0, 0]);
    this.part(new THREE.CylinderGeometry(0.17, 0.13, 0.22, 5).rotateX(Math.PI / 2), dark, w, [-0.4, 0.28, 0.02]); // a tapered skull, not a cube
    for (const x of [-0.5, -0.3]) {
      this.part(new THREE.ConeGeometry(0.07, 0.2, 4), dark, w, [x, 0.46, -0.04]);
      this.part(new THREE.OctahedronGeometry(0.035), eye, w, [x, 0.33, 0.12]);   // an eye the size of an eye
    }
    // a spiked fur ridge on the right so the mantle is not symmetrical from behind
    this.part(curvedSpike(0.06, 0.34, 0.4, 0.6), dark, w, [0.4, 0.14, 0]);
    g.add(w);
    this.mount('Torso', g, this.at('Torso').add(new THREE.Vector3(0, SHOULDER_LIFT, 0)));
    return { group: g, materials: p.list };
  }

  private buildLegs(id: string) {
    const ap = appearanceOf(id);
    if (ap.rung <= 1) return { group: null, materials: [] };
    const p = this.palette(ap), main = p.get('plate'), trim = p.get('trim');
    const root = new THREE.Group();
    for (const side of ['L', 'R']) {
      const shin = `LowerLeg${side}`, end = `LowerLeg${side}_end`;
      if (!this.bind.has(shin) || !this.bind.has(end)) continue;
      const a = this.at(shin), b = this.at(end), len = a.distanceTo(b) / this.k;
      const g = new THREE.Group(), w = this.world();
      // Shin plate: a tapered six-sided shell from knee to ankle, left faceted on purpose (six sides meet at sixty
      // degrees, past the crease, so the plate keeps its folds where the helm's bowl rolls). Down the front of it runs a
      // polished ridge and round it two leather bands: the hard lit line and the soft dark one, on every rung. Both are
      // cut from the same cone as the shell, so they hug it over its whole taper instead of floating off the ankle.
      const shell = len * 0.8, rAt = (f: number) => 0.13 + (f / shell) * 0.04;   // the shell's radius at a height f off its middle
      this.part(new THREE.CylinderGeometry(0.15, 0.11, shell, 6), main, w, [0, 0, 0]);
      this.part(new THREE.CylinderGeometry(0.157, 0.117, shell * 0.98, 3, 1, false, -0.24, 0.48), p.get('edge'), w, [0, 0, 0]);
      this.band(0.118, 0.126, 0.05, 'edge', p, w, [0, -shell / 2, 0]);   // the rolled rim at the ankle, cut to the shell's own radius there
      for (const f of [-shell * 0.3, shell * 0.26]) this.band(rAt(f + 0.02) + 0.008, rAt(f - 0.02) + 0.008, 0.042, 'strap', p, w, [0, f, 0]);
      if (ap.rung >= 3) {
        this.part(new THREE.OctahedronGeometry(ap.rung >= 4 ? 0.17 : 0.13), trim, w, [0, len * 0.4 + 0.05, 0.05]);
        this.jewel(0.045, p, w, [0, len * 0.4 + 0.05, 0.05 + (ap.rung >= 4 ? 0.14 : 0.11)], [Math.PI / 2, 0, 0]); // a stone in each knee cop
      }
      if (ap.rung >= 4) this.part(new THREE.ConeGeometry(0.05, 0.22, 4), trim, w, [0, len * 0.4 + 0.05, 0.2], [Math.PI / 2, 0, 0]);
      if (ap.form === 'adamant') this.part(new THREE.BoxGeometry(0.34, 0.12, 0.3), trim, w, [0, len * 0.4 + 0.1, 0.06]); // a squared knee guard over the cop
      if (ap.form === 'star') { // a lit seam down the front of each shin and a blade trailing off the calf
        const vein = p.get('inlay');
        this.part(new THREE.BoxGeometry(0.025, len * 0.7, 0.025), vein, w, [0, 0, 0.14]);
        this.part(curvedSpike(0.04, 0.34, 2.6, 0.3, 2), trim, w, [0, -len * 0.1, -0.12]);
      }
      if (ap.form === 'storm') for (const s of [-1, 1]) this.part(curvedSpike(0.04, 0.3, 1.0, -0.4), trim, w, [s * 0.14, 0, 0], [0, 0, 0]).scale.x = s; // shin barbs
      g.add(w);
      this.mountPiece(root, shin, g, a.clone().lerp(b, 0.5));
    }
    return { group: root.userData.pieces ? root : null, materials: p.list };
  }

  /** Gloves: the knight's own hands recoloured (they are a mesh of their own, see models.ts), plus a cuff at the wrist, on the Palm bone. Wolfskin swaps the cuff for a flared fur ruff and fringes the fingertips. Sizes are world units: the knight's hand is ~0.2 long. */
  private buildHands(id: string) {
    const ap = appearanceOf(id), moor = ap.form === 'moor', fur = ap.form === 'wolfskin' || moor;
    const p = this.palette(ap), main = p.get('plate'), trim = p.get('trim');
    const ruff = fur ? p.get('fur') : null;
    const vein = ap.glow && ap.rung >= 3 ? p.get('inlay') : null;
    const root = new THREE.Group();
    for (const side of ['L', 'R']) {
      const palm = `Palm${side}`, tip = `Fingers${side}_end`;
      if (!this.bind.has(palm) || !this.bind.has(tip)) continue;
      const a = this.at(palm), dir = this.at(tip).sub(a), len = dir.length() / this.k; // +Y runs from the wrist to the fingertips
      const g = new THREE.Group(), w = this.world();
      if (moor) {
        // a deep fleece cuff, taller and wider than wolfskin's, and a horn toggle curling off the back of the hand
        this.part(new THREE.CylinderGeometry(0.11, 0.2, 0.17, 7, 1, true), ruff!, w, [0, -0.08, 0]);
        this.part(curvedSpike(0.03, 0.2, 0.2, 1.4, 3), trim, w, [0, len * 0.15, 0.06], [0, Math.PI / 2, 0]);
      } else if (fur) {
        this.part(new THREE.CylinderGeometry(0.095, 0.16, 0.12, 7, 1, true), ruff!, w, [0, -0.07, 0]); // flared ruff, widest at the elbow end
        for (const x of [-0.04, 0.04]) this.part(new THREE.ConeGeometry(0.035, 0.09, 4), trim, w, [x, len * 1.0, 0], [Math.PI, 0, 0]); // fringe at the fingertips
      } else if (ap.form === 'marsh') {
        this.band(0.1, 0.095, 0.08, 'trim', p, w, [0, -0.02, 0]); // a wrapped cuff, with reeds hung from it
        for (let i = 0; i < 8; i++) { const t = (i / 8) * Math.PI * 2; this.part(new THREE.ConeGeometry(0.018, 0.2 + 0.04 * (i % 3), 3), main, w, [Math.sin(t) * 0.1, -0.15, Math.cos(t) * 0.1], [Math.PI + Math.cos(t) * 0.25, 0, -Math.sin(t) * 0.25]); }
      } else if (ap.form === 'thorn') {
        this.band(0.105, 0.1, 0.1, 'trim', p, w, [0, -0.04, 0]);
        for (let i = 0; i < 5; i++) { const t = (i / 5) * Math.PI * 2; this.spikeOut(trim, w, [Math.sin(t) * 0.1, -0.04, Math.cos(t) * 0.1], [Math.sin(t), -0.5, Math.cos(t)], 0.04, 0.17); } // thorns round the wrist
        for (const x of [-0.04, 0, 0.04]) this.spikeOut(trim, w, [x, len * 0.35 + 0.02, 0.06], [0, 0.35, 1], 0.022, 0.1); // and on the knuckles
      } else if (ap.form === 'echohide') {
        this.band(0.105, 0.1, 0.1, 'trim', p, w, [0, -0.04, 0]);
        for (let i = 0; i < 6; i++) this.echoShard(0.03, 2, p, w, [Math.sin(i * 1.047) * 0.115, -0.04, Math.cos(i * 1.047) * 0.115], i * 1.047); // Echo shards stood round the cuff, leaning out
        for (const x of [-0.04, 0, 0.04]) this.part(new THREE.OctahedronGeometry(0.02).scale(1, 1.6, 1), p.get('gem'), w, [x, len * 0.35 + 0.03, 0.065]); // and a stud on each knuckle
      } else {
        this.band(0.1, 0.095, 0.1, 'strap', p, w, [0, -0.04, 0]); // a plain stitched cuff
      }
      if (ap.rung >= 2) { // knuckle band, plated and rubbed bright on its crown: the tier fallback
        this.part(new THREE.BoxGeometry(0.13, 0.05, 0.11), trim, w, [0, len * 0.35, 0]);
        this.part(new THREE.BoxGeometry(0.135, 0.018, 0.115), p.get('edge'), w, [0, len * 0.35 + 0.028, 0]);
      }
      if (vein) this.part(new THREE.BoxGeometry(0.135, 0.015, 0.115), vein, w, [0, len * 0.35 + 0.04, 0]);
      g.add(w);
      this.mountPiece(root, palm, g, a, dir);
    }
    return { group: root.userData.pieces ? root : null, materials: p.list };
  }

  /** Boots: a shaft over the ankle and a foot with a sole, both on the Foot bone (which sits at ground level, heel). Wolfskin tops the shaft with a flared fur cuff. */
  private buildFeet(id: string) {
    const ap = appearanceOf(id), moor = ap.form === 'moor', fur = ap.form === 'wolfskin' || moor;
    const p = this.palette(ap), main = p.get('plate'), trim = p.get('trim');
    const ruff = fur ? p.get('fur') : null;
    const vein = ap.glow && ap.rung >= 3 ? p.get('inlay') : null;
    const root = new THREE.Group();
    for (const side of ['L', 'R']) {
      const foot = `Foot${side}`, toe = `Foot${side}_end`;
      if (!this.bind.has(foot) || !this.bind.has(toe)) continue;
      const a = this.at(foot), dir = this.at(toe).sub(a);
      // the foot's local Z ends up pointing up or down depending on the rig's handedness; "up" is whichever side it faces
      const zUp = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize())).y > 0 ? 1 : -1;
      const g = new THREE.Group(), w = this.world();
      this.part(new THREE.BoxGeometry(0.17, 0.3, 0.09), main, w, [0, 0.07, zUp * 0.055]);
      this.part(new THREE.BoxGeometry(0.165, 0.32, 0.025), p.get('strap'), w, [0, 0.07, zUp * 0.0125]); // sole
      if (ap.rung >= 2) { // toe cap, with its top edge rubbed bright: the tier fallback
        this.part(new THREE.BoxGeometry(0.16, 0.08, 0.09), trim, w, [0, 0.19, zUp * 0.055]);
        this.part(new THREE.BoxGeometry(0.168, 0.022, 0.096), p.get('edge'), w, [0, 0.225, zUp * 0.055]);
      }
      if (vein) this.part(new THREE.BoxGeometry(0.02, 0.2, 0.02), vein, w, [0, 0.1, zUp * 0.1]);
      if (moor) this.part(curvedSpike(0.035, 0.26, 0.1, 0.9, 3), trim, w, [0, 0.2, zUp * 0.09], [0, zUp > 0 ? Math.PI / 2 : -Math.PI / 2, 0]); // a horn toe-cap, curling up off the toe
      g.add(w);
      this.mountPiece(root, foot, g, a, dir);
      const shaft = new THREE.Group(), s = this.world();
      this.part(new THREE.CylinderGeometry(0.105, 0.12, 0.24, 14), main, s, [0, 0.13, -0.03]);
      this.band(0.113, 0.113, 0.04, 'strap', p, s, [0, 0.16, -0.03]); // the buckle strap round the shaft
      if (moor) this.part(new THREE.CylinderGeometry(0.2, 0.12, 0.15, 7, 1, true), ruff!, s, [0, 0.28, -0.03]); // a deep fleece top, wider than wolfskin's
      else if (fur) this.part(new THREE.CylinderGeometry(0.17, 0.11, 0.1, 7, 1, true), ruff!, s, [0, 0.27, -0.03]);
      else this.band(0.12, 0.12, 0.035, 'edge', p, s, [0, 0.25, -0.03]); // rolled top
      if (ap.form === 'marsh') {
        this.band(0.122, 0.128, 0.06, 'trim', p, s, [0, 0.04, -0.03]); // the mud line round the ankle
        for (let i = 0; i < 8; i++) { const t = (i / 8) * Math.PI * 2; this.part(new THREE.ConeGeometry(0.02, 0.17 + 0.04 * (i % 3), 3), main, s, [Math.sin(t) * 0.12, 0.2, -0.03 + Math.cos(t) * 0.12], [Math.PI + Math.cos(t) * 0.3, 0, -Math.sin(t) * 0.3]); } // reeds hung over the top
      } else if (ap.form === 'thorn') {
        for (let i = 0; i < 5; i++) { const t = (i / 5) * Math.PI * 2 + 0.3; this.spikeOut(trim, s, [Math.sin(t) * 0.12, 0.25, -0.03 + Math.cos(t) * 0.12], [Math.sin(t), 0.7, Math.cos(t)], 0.035, 0.17); } // a crown of thorns round the rim
        this.spikeOut(trim, s, [0, 0.06, -0.14], [0, -0.35, -1], 0.04, 0.2); // and a spur at the heel
      } else if (ap.form === 'echohide') {
        for (let i = 0; i < 6; i++) this.echoShard(0.032, 2.2, p, s, [Math.sin(i * 1.047) * 0.125, 0.25, -0.03 + Math.cos(i * 1.047) * 0.125], i * 1.047); // a ring of Echo shards round the rim
        this.echoShard(0.04, 2.6, p, s, [0, 0.06, -0.14], Math.PI); // and one at the heel
      }
      shaft.add(s);
      this.mountPiece(root, foot, shaft, a);
    }
    return { group: root.userData.pieces ? root : null, materials: p.list };
  }

  /**
   * The off hand (HOM-148): a torch burning in the left fist. Authored along +Y with the grip at the origin and in world units,
   * like a gathering tool, and turned to where the sword points -- forward and up -- so the flame stands clear of the shoulder
   * instead of inside it. A third the size of the standing torch in props.ts, and built from the same four parts.
   *
   * It is the one worn piece that carries a halo. An emitter's own material is held under the bloom threshold (glow.ts), so the
   * flame on its own is a flat shape; the lit air round it is the halo, and because a carried light has to move with the hand it
   * is in, the halo is built into this group rather than into the scene's one merged mesh.
   */
  private buildOffhand(id: string) {
    const hand = this.bones.get('MiddleHandL');
    if (!hand) return null;
    const ap = appearanceOf(id), p = this.palette(ap), g = new THREE.Group();
    g.scale.setScalar(1 / hand.getWorldScale(this.tmp).x);
    g.rotation.z = Math.PI * 0.75;
    this.part(new THREE.CylinderGeometry(0.032, 0.042, 0.6, 8).translate(0, 0.2, 0), p.get('plate'), g, [0, 0, 0]); // the stake
    this.band(0.048, 0.048, 0.045, 'trim', p, g, [0, 0.38, 0]);                                                     // the one iron band under the head
    this.part(new THREE.CylinderGeometry(0.068, 0.05, 0.14, 6), p.get('strap'), g, [0, 0.52, 0]);                   // the pitch-soaked head
    const flame = new THREE.MeshStandardMaterial({ color: FLAME, emissive: FLAME, emissiveIntensity: cappedIntensity(FLAME, 1), roughness: 0.6, metalness: 0 });
    flame.color.multiplyScalar(EMITTER_DIFFUSE);
    p.list.push(flame);
    for (const [r, sy, x, y, z] of [[0.075, 1.9, 0, 0.66, 0], [0.045, 1.5, 0.015, 0.78, -0.012]] as const) {
      const m = this.part(new THREE.OctahedronGeometry(r).scale(1, sy, 1), flame, g, [x, y, z]);
      m.castShadow = m.receiveShadow = false; // a flame is light, not a thing that stands in it
    }
    const halo = haloMesh([{ id: 'torch', x: 0, y: 0.7, z: 0, scale: 0.8 }]); // smaller than the standing torch's: a brand in a fist is a smaller flame
    if (halo) { halo.userData.own = true; g.add(halo); } // `own`: unmount frees its geometry, as it does every part built here
    hand.add(g);
    return { group: g, materials: p.list };
  }

  private build(slot: WornSlot, id: string) {
    switch (slot) {
      case 'weapon': return this.buildWeapon(id);
      case 'head': return this.buildHead(id);
      case 'chest': return this.buildChest(id);
      case 'legs': return this.buildLegs(id);
      case 'hands': return this.buildHands(id);
      case 'feet': return this.buildFeet(id);
      case 'offhand': return this.buildOffhand(id);
    }
  }

  /**
   * Make what is mounted match the equipment record. `motes` is optional: they drift off tier 3+ pieces.
   * A slot whose piece failed to load simply shows nothing extra (the body recolour still applies), so a missing GLB never breaks play.
   */
  sync(eq: Equipment, dt: number, motes?: Motes) {
    for (const slot of ['weapon', 'head', 'chest', 'legs', 'hands', 'feet', 'offhand'] as const) {
      const id = eq[slot];
      if (id !== this.slots[slot].id) {
        this.unmount(slot);
        const built = id ? this.build(slot, id) : null;
        this.slots[slot] = { id, group: built?.group ?? null, materials: built?.materials ?? [] };
        if (slot === 'chest') this.dressBody('Armor', id);
        if (slot === 'legs') this.dressBody('ArmorLegs', id);
        if (slot === 'hands') this.dressBody('Hands', id);
        if (slot === 'feet') this.dressBody('Boots', id); // the knight's own boots are black: bare feet are skin, worn ones take the item's colour
      }
      const ap = id ? appearanceOf(id) : null, g = (this.slots[slot].group?.userData.pieces?.[0] ?? this.slots[slot].group) as THREE.Object3D | null;
      if (motes && ap?.motes && g) {
        this.motes[slot] += dt * (slot === 'weapon' ? 6 : 2);
        while (this.motes[slot] >= 1) {
          this.motes[slot]--;
          g.getWorldPosition(this.tmp);
          if (slot === 'weapon') this.tmp.addScaledVector(UP, 0.35); // up the blade, not at the fist
          motes.emit(this.tmp.x, this.tmp.y, this.tmp.z, ap.motes);
        }
      }
    }
  }
}




