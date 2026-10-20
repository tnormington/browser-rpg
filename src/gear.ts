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
// Bare slots show skin. Looks come from gear-look.ts, keyed by item id with a tier fallback.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Equipment } from './sim/items';

/** The slots that have a worn look: every equipment slot. */
type WornSlot = 'weapon' | 'head' | 'chest' | 'legs' | 'hands' | 'feet';
import { Appearance, appearanceOf } from './gear-look';
import { cappedIntensity } from './glow';
import { Instance, Prepared, spawn } from './models';
import { bakeUV, dress } from './surface';
import type { Motes } from './fx';

const SKIN = 0xb89a7e;
const GRIP = 0x2a1d14;
const UP = new THREE.Vector3(0, 1, 0);
/** Helmet and pauldron pieces are authored in rig units; these are the offsets from their bone (rig units) that seat them. Tuned by eye. */
const HELM_LIFT = 0.55, SHOULDER_LIFT = 0.3;

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

export interface GearPieces { helmet: Prepared | null; pauldrons: Prepared | null; sword: Prepared | null }

export class PlayerGear {
  private model: THREE.Object3D;
  private bones = new Map<string, THREE.Object3D>();
  /** Bone transforms in model space at the bind pose, captured before any animation runs: mounts are placed from these, not from the live pose. */
  private bind = new Map<string, THREE.Matrix4>();
  /** World units -> model units (the fit wrapper scales the rig down). */
  private k: number;
  private slots: Record<WornSlot, Mounted> = { weapon: empty(), head: empty(), chest: empty(), legs: empty(), hands: empty(), feet: empty() };
  private bodyMats = new Map<string, THREE.MeshStandardMaterial>();
  private motes = { weapon: 0, head: 0, chest: 0, legs: 0, hands: 0, feet: 0 };
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
    const m = new THREE.Mesh(bakeUV(g), material);   // generated gear is authored in world units, so the projection is already to scale
    m.castShadow = m.receiveShadow = true;
    m.userData.own = true;
    m.position.set(...pos);
    if (rot) m.rotation.set(...rot);
    parent.add(m);
    return m;
  }

  /** A cone of base radius `r` and length `len` standing at `pos` and pointing along `dir`. */
  private spikeOut(material: THREE.Material, parent: THREE.Object3D, pos: [number, number, number], dir: [number, number, number], r: number, len: number) {
    const m = this.part(new THREE.ConeGeometry(r, len, 4).translate(0, len / 2, 0), material, parent, pos);
    m.quaternion.setFromUnitVectors(UP, new THREE.Vector3(...dir).normalize());
    return m;
  }

  /** Per-piece material: `trim` is the darker secondary colour, the main tint carries the metal response. Neither glows: only inlays and the blade do, so plate is never lit all over. */
  private material(ap: Appearance, trim = false): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({
      color: trim ? ap.trim : ap.tint, metalness: trim ? Math.min(ap.metal, 0.6) : ap.metal, roughness: trim ? Math.min(1, ap.rough + 0.15) : ap.rough, flatShading: true,
    });
    dress(m, ap.metal > 0.3 ? 'metal' : 'hide');   // plate takes the hammered grain, leather and cloth the pebbled one
    return m;
  }

  /** A glowing inlay (vein, seam): the one place the tier's cold emissive lives on generated geometry, capped under the bloom threshold. */
  private inlay(ap: Appearance): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color: ap.trim, metalness: 0.3, roughness: 0.4, flatShading: true, side: THREE.DoubleSide });
    m.emissive.setHex(ap.glow || 0); m.emissiveIntensity = ap.glow ? cappedIntensity(ap.glow, ap.glowI * 1.8) : 0;
    return m;
  }

  private double(m: THREE.MeshStandardMaterial) { const d = m.clone(); d.side = THREE.DoubleSide; return d; }

  /** Recolour a glb piece's materials by name: `main` names take the tint, `trim` names the trim (and the glow). */
  private restyle(mats: THREE.Material[], ap: Appearance, main: string[], trim: string[], blade = false) {
    for (const mat of mats as THREE.MeshStandardMaterial[]) {
      const isMain = main.includes(mat.name), isTrim = trim.includes(mat.name);
      if (mat.name === 'Brown') { mat.color.setHex(GRIP); mat.metalness = 0; mat.roughness = 0.9; continue; }
      if (!isMain && !isTrim) continue;
      mat.map = null;
      dress(mat, 'metal');   // the pack's own texture goes; the class's maps (hung by models.ts) go back on
      mat.color.setHex(isMain ? ap.tint : ap.trim);
      mat.metalness = isMain ? ap.metal : Math.min(ap.metal, 0.6);
      mat.roughness = isMain ? ap.rough : Math.min(1, ap.rough + 0.15);
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

  private buildWeapon(id: string) {
    const sword = this.pieces.sword, hand = this.bones.get('MiddleHandR');
    if (!sword || !hand) return null;
    const ap = appearanceOf(id);
    const blade = spawn(sword, true);
    blade.root.matrixAutoUpdate = true;
    blade.root.scale.setScalar(ap.scale / hand.getWorldScale(this.tmp).x);
    blade.root.rotation.z = Math.PI * 0.75; // blade forward and up from the fist
    if (ap.width) blade.root.scale.z *= ap.width; // broad adamant, narrow stormiron
    this.restyle(blade.materials, ap, ['Metal'], ['Gold', 'Red'], true);
    hand.add(blade.root);
    return { group: blade.root, materials: blade.materials };
  }

  private buildHead(id: string) {
    const ap = appearanceOf(id), g = new THREE.Group(), w = this.world(), mats: THREE.Material[] = [];
    const main = this.material(ap), trim = this.material(ap, true);
    mats.push(main, trim);
    if (ap.form === 'gutterhook') {
      // a salvaged cap with a gutting hook lashed over the brow: the hook is the silhouette, a single cold glint at its tip
      const vein = this.inlay(ap);
      mats.push(vein);
      this.part(new THREE.SphereGeometry(0.3, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.95, 1.05), main, w, [0, -0.02, 0]);
      this.part(new THREE.CylinderGeometry(0.31, 0.34, 0.07, 7), trim, w, [0, -0.04, 0]);
      this.part(new THREE.CylinderGeometry(0.325, 0.325, 0.03, 7), trim, w, [0, 0.12, 0]); // lashing band
      const hook = this.part(curvedSpike(0.05, 0.62, -0.1, 2.9, 5), trim, w, [0, 0.2, 0.22], [0, -Math.PI / 2, 0]); // up from the brow and over, point back down
      hook.scale.setScalar(1);
      this.part(new THREE.OctahedronGeometry(0.06), vein, w, [0, 0.42, 0.02]);
      this.part(new THREE.BoxGeometry(0.5, 0.04, 0.04), vein, w, [0, -0.02, 0.32]); // a narrow eye slit's worth of light across the brim
    } else if (ap.rung <= 1 || !this.pieces.helmet) {
      // leather cap: a low dome and a rolled brim, close to the skull
      this.part(new THREE.SphereGeometry(0.3, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.85, 1.05), main, w, [0, -0.02, 0]);
      this.part(new THREE.CylinderGeometry(0.31, 0.32, 0.06, 7), trim, w, [0, -0.04, 0]);
    } else {
      const helm = spawn(this.pieces.helmet, true);
      helm.root.matrixAutoUpdate = true;
      helm.root.scale.setScalar(ap.rung >= 3 ? 1.1 : 1);
      this.restyle(helm.materials, ap, ['Grey'], ['DarkGrey']);
      mats.push(...helm.materials);
      g.add(helm.root);
      if (ap.form === 'adamant') {
        // a heavy squared helm: brow slab, flat ridge, cheek slabs and a T of jade light. No horns, no crest: the mass is the read.
        const vein = this.inlay(ap);
        mats.push(vein);
        helm.root.scale.setScalar(1.18);
        this.part(new THREE.BoxGeometry(0.66, 0.1, 0.52), trim, w, [0, 0.14, 0.06]);
        this.part(new THREE.BoxGeometry(0.2, 0.14, 0.74), main, w, [0, 0.32, -0.02]);
        for (const s of [-1, 1]) this.part(new THREE.BoxGeometry(0.09, 0.34, 0.34), trim, w, [s * 0.31, -0.06, 0.04]);
        this.part(new THREE.BoxGeometry(0.34, 0.04, 0.04), vein, w, [0, 0.04, 0.3]);
        this.part(new THREE.BoxGeometry(0.04, 0.22, 0.04), vein, w, [0, -0.07, 0.3]);
      } else if (ap.form === 'storm') {
        // a lean helm under a fan of backswept spikes and two long cheek barbs: a jagged crown that reads from every side
        const vein = this.inlay(ap);
        mats.push(vein);
        helm.root.scale.setScalar(1.05);
        for (const [x, len, lift] of [[0, 0.8, 0.28], [-0.14, 0.62, 0.24], [0.14, 0.62, 0.24]] as const)
          this.part(curvedSpike(0.06, len, 0.9, 0.4), trim, w, [x, lift, 0.1], [0, Math.PI / 2, 0]);
        for (const s of [-1, 1]) this.part(curvedSpike(0.05, 0.4, 1.2, -0.5), trim, w, [s * 0.3, 0.02, 0.1]).scale.x = s;
        this.part(new THREE.BoxGeometry(0.03, 0.4, 0.04), vein, w, [0, 0.4, 0.2], [0.9, 0, 0]);
        this.part(new THREE.BoxGeometry(0.34, 0.03, 0.04), vein, w, [0, 0.04, 0.3]);
      } else if (ap.form === 'star') {
        // a clean black helm and one thing over it: a four-point star hung on a stem above the brow, two crossed diamonds around a bright core. Two long blades sweep back off the cheeks.
        const vein = this.inlay(ap);
        mats.push(vein);
        helm.root.scale.setScalar(1.12);
        this.part(new THREE.CylinderGeometry(0.02, 0.05, 0.3, 4), trim, w, [0, 0.44, 0]);
        this.part(new THREE.OctahedronGeometry(0.1).scale(0.5, 2.8, 0.5), vein, w, [0, 0.72, 0]);
        this.part(new THREE.OctahedronGeometry(0.1).scale(2.4, 0.5, 0.5), vein, w, [0, 0.72, 0]);
        this.part(new THREE.OctahedronGeometry(0.06), vein, w, [0, 0.72, 0], [0.6, 0.6, 0]);
        for (const s of [-1, 1]) this.part(curvedSpike(0.05, 0.62, 1.5, -0.35), trim, w, [s * 0.3, 0.02, -0.02]).scale.x = s;
        this.part(new THREE.BoxGeometry(0.3, 0.035, 0.04), vein, w, [0, 0.04, 0.3]); // the visor slit
      } else if (ap.rung >= 3) { // a swept crest along the skull: the silhouette cue from behind
        const h = ap.rung >= 4 ? 0.5 : 0.28;
        this.part(crestFin(h, 0.62, ap.rung >= 4 ? 0.07 : 0.05), trim, w, [0, 0.24, -0.02]);
        const vein = this.inlay(ap);
        mats.push(vein);
        this.part(new THREE.BoxGeometry(ap.rung >= 4 ? 0.1 : 0.08, h * 0.7, 0.04), vein, w, [0, 0.24 + h * 0.55, -0.2 * h / 0.5], [0.55, 0, 0]); // vein up the crest's back edge, standing proud of the fin
        if (ap.rung >= 4) {
          // aventail: a flared plate over the nape, with a glowing seam down it: the read from behind at play distance
          const back = new THREE.CylinderGeometry(0.34, 0.46, 0.3, 6, 1, true, Math.PI / 2, Math.PI);
          const plate = this.double(trim);
          mats.push(plate);
          this.part(back, plate, w, [0, -0.24, 0]);
          this.part(new THREE.BoxGeometry(0.06, 0.28, 0.04), vein, w, [0, -0.24, -0.45]);
          this.part(new THREE.CylinderGeometry(0.455, 0.465, 0.03, 6, 1, true, Math.PI / 2, Math.PI), vein, w, [0, -0.38, 0]); // hem line
          // horns: three-piece curved spikes that sweep out and back up
          for (const s of [-1, 1]) this.part(curvedSpike(0.075, 0.55, 1.1, -0.9), trim, w, [s * 0.26, 0.14, 0], [0, 0, 0]).scale.x = s;
        }
      }
    }
    g.add(w);
    this.mount('Head', g, this.at('Head').add(new THREE.Vector3(0, HELM_LIFT, 0)));
    return { group: g, materials: mats };
  }

  private buildChest(id: string) {
    const ap = appearanceOf(id);
    if (ap.form === 'greywolf') return this.buildHauberk(ap);
    if (ap.rung <= 1 || !this.pieces.pauldrons) return { group: null, materials: [] };
    const g = new THREE.Group(), w = this.world();
    const pads = spawn(this.pieces.pauldrons, true);
    pads.root.matrixAutoUpdate = true;
    pads.root.scale.setScalar(1 + 0.18 * (ap.rung - 2));
    this.restyle(pads.materials, ap, ['Grey'], []);
    const mats: THREE.Material[] = [...pads.materials];
    g.add(pads.root);
    if (ap.form === 'adamant' || ap.form === 'storm') {
      const trim = this.material(ap, true), main = this.material(ap), vein = this.inlay(ap);
      mats.push(trim, main, vein);
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
      const trim = this.material(ap, true), main = this.material(ap), vein = this.inlay(ap);
      mats.push(trim, main, vein);
      pads.root.scale.setScalar(1.35);
      for (const s of [-1, 1]) {
        for (let i = 0; i < 3; i++) this.part(curvedSpike(0.065 - i * 0.012, 0.78 - i * 0.16, 0.45 + i * 0.4, 0.35, 3), trim, w, [s * 0.34, 0.1 - i * 0.03, -0.02 * i]).scale.x = s;
        this.part(new THREE.OctahedronGeometry(0.08), vein, w, [s * 0.34, 0.1, 0]);
      }
      this.part(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 6).rotateX(Math.PI / 2), main, w, [0, -0.28, -0.3]);
      this.part(new THREE.OctahedronGeometry(0.1).scale(0.55, 3.0, 0.55), vein, w, [0, -0.28, -0.34]);
      this.part(new THREE.OctahedronGeometry(0.1).scale(3.0, 0.55, 0.55), vein, w, [0, -0.28, -0.34]);
    } else if (ap.rung >= 3) { // spikes on the shoulders: horizontal read at gathering distance
      const trim = this.material(ap, true), vein = this.inlay(ap), h = ap.rung >= 4 ? 0.3 : 0.18;
      mats.push(trim, vein);
      for (const s of [-1, 1]) {
        this.part(curvedSpike(0.07, h * 1.7, 0.5, 0.5), trim, w, [s * 0.34, 0.08, 0]).scale.x = s;
        this.part(new THREE.OctahedronGeometry(0.075), vein, w, [s * 0.34, 0.08, 0]); // a lit collar where the spike meets the plate
      }
    }
    g.add(w);
    this.mount('Torso', g, this.at('Torso').add(new THREE.Vector3(0, SHOULDER_LIFT, 0)));
    return { group: g, materials: mats };
  }

  /** The Greywolf Hauberk: a wolfskin mantle in two flared tiers and a wolf's head on the left shoulder with a cold glint for each eye. */
  private buildHauberk(ap: Appearance) {
    const g = new THREE.Group(), w = this.world();
    const fur = this.double(this.material(ap)), dark = this.material(ap, true), eye = this.inlay(ap);
    const mats: THREE.Material[] = [fur, dark, eye];
    this.part(new THREE.CylinderGeometry(0.34, 0.5, 0.2, 7, 1, true), fur, w, [0, 0.12, 0]);
    this.part(new THREE.CylinderGeometry(0.46, 0.64, 0.2, 7, 1, true), fur, w, [0, -0.04, 0]);
    // the head: snout forward and out over the left shoulder, ears up
    this.part(new THREE.ConeGeometry(0.15, 0.4, 5), dark, w, [-0.4, 0.26, 0.2], [Math.PI / 2, 0, 0]);
    this.part(new THREE.BoxGeometry(0.3, 0.2, 0.26), dark, w, [-0.4, 0.28, 0.02]);
    for (const x of [-0.5, -0.3]) {
      this.part(new THREE.ConeGeometry(0.07, 0.2, 4), dark, w, [x, 0.46, -0.04]);
      this.part(new THREE.BoxGeometry(0.06, 0.04, 0.04), eye, w, [x, 0.32, 0.14]);
    }
    // a spiked fur ridge on the right so the mantle is not symmetrical from behind
    this.part(curvedSpike(0.06, 0.34, 0.4, 0.6), dark, w, [0.4, 0.14, 0]);
    g.add(w);
    this.mount('Torso', g, this.at('Torso').add(new THREE.Vector3(0, SHOULDER_LIFT, 0)));
    return { group: g, materials: mats };
  }

  private buildLegs(id: string) {
    const ap = appearanceOf(id);
    if (ap.rung <= 1) return { group: null, materials: [] };
    const main = this.material(ap), trim = this.material(ap, true), mats: THREE.Material[] = [main, trim];
    const root = new THREE.Group();
    for (const side of ['L', 'R']) {
      const shin = `LowerLeg${side}`, end = `LowerLeg${side}_end`;
      if (!this.bind.has(shin) || !this.bind.has(end)) continue;
      const a = this.at(shin), b = this.at(end), len = a.distanceTo(b) / this.k;
      const g = new THREE.Group(), w = this.world();
      // shin plate: a tapered six-sided shell from knee to ankle; knee cop on top for the higher rungs
      this.part(new THREE.CylinderGeometry(0.15, 0.11, len * 0.8, 6), main, w, [0, 0, 0]);
      this.part(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 6), trim, w, [0, -len * 0.4, 0]);
      if (ap.rung >= 3) this.part(new THREE.OctahedronGeometry(ap.rung >= 4 ? 0.17 : 0.13), trim, w, [0, len * 0.4 + 0.05, 0.05]);
      if (ap.rung >= 4) this.part(new THREE.ConeGeometry(0.05, 0.22, 4), trim, w, [0, len * 0.4 + 0.05, 0.2], [Math.PI / 2, 0, 0]);
      if (ap.form === 'adamant') this.part(new THREE.BoxGeometry(0.34, 0.12, 0.3), trim, w, [0, len * 0.4 + 0.1, 0.06]); // a squared knee guard over the cop
      if (ap.form === 'star') { // a lit seam down the front of each shin and a blade trailing off the calf
        const vein = this.inlay(ap);
        mats.push(vein);
        this.part(new THREE.BoxGeometry(0.025, len * 0.7, 0.025), vein, w, [0, 0, 0.14]);
        this.part(curvedSpike(0.04, 0.34, 2.6, 0.3, 2), trim, w, [0, -len * 0.1, -0.12]);
      }
      if (ap.form === 'storm') for (const s of [-1, 1]) this.part(curvedSpike(0.04, 0.3, 1.0, -0.4), trim, w, [s * 0.14, 0, 0], [0, 0, 0]).scale.x = s; // shin barbs
      g.add(w);
      this.mountPiece(root, shin, g, a.clone().lerp(b, 0.5));
    }
    return { group: root.userData.pieces ? root : null, materials: mats };
  }

  /** Gloves: the knight's own hands recoloured (they are a mesh of their own, see models.ts), plus a cuff at the wrist, on the Palm bone. Wolfskin swaps the cuff for a flared fur ruff and fringes the fingertips. Sizes are world units: the knight's hand is ~0.2 long. */
  private buildHands(id: string) {
    const ap = appearanceOf(id), moor = ap.form === 'moor', fur = ap.form === 'wolfskin' || moor;
    const main = this.material(ap), trim = this.material(ap, true), mats: THREE.Material[] = [main, trim];
    const ruff = fur ? this.double(main) : null;
    if (ruff) mats.push(ruff);
    const vein = ap.glow && ap.rung >= 3 ? this.inlay(ap) : null;
    if (vein) mats.push(vein);
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
        this.part(new THREE.CylinderGeometry(0.1, 0.095, 0.08, 7), trim, w, [0, -0.02, 0]); // a wrapped cuff, with reeds hung from it
        for (let i = 0; i < 8; i++) { const t = (i / 8) * Math.PI * 2; this.part(new THREE.ConeGeometry(0.018, 0.2 + 0.04 * (i % 3), 3), main, w, [Math.sin(t) * 0.1, -0.15, Math.cos(t) * 0.1], [Math.PI + Math.cos(t) * 0.25, 0, -Math.sin(t) * 0.25]); }
      } else if (ap.form === 'thorn') {
        this.part(new THREE.CylinderGeometry(0.105, 0.1, 0.1, 7), trim, w, [0, -0.04, 0]);
        for (let i = 0; i < 5; i++) { const t = (i / 5) * Math.PI * 2; this.spikeOut(trim, w, [Math.sin(t) * 0.1, -0.04, Math.cos(t) * 0.1], [Math.sin(t), -0.5, Math.cos(t)], 0.04, 0.17); } // thorns round the wrist
        for (const x of [-0.04, 0, 0.04]) this.spikeOut(trim, w, [x, len * 0.35 + 0.02, 0.06], [0, 0.35, 1], 0.022, 0.1); // and on the knuckles
      } else {
        this.part(new THREE.CylinderGeometry(0.1, 0.095, 0.1, 7), trim, w, [0, -0.04, 0]); // a plain stitched cuff
      }
      if (ap.rung >= 2) this.part(new THREE.BoxGeometry(0.13, 0.05, 0.11), trim, w, [0, len * 0.35, 0]); // knuckle band: the tier fallback
      if (vein) this.part(new THREE.BoxGeometry(0.135, 0.015, 0.115), vein, w, [0, len * 0.35 + 0.03, 0]);
      g.add(w);
      this.mountPiece(root, palm, g, a, dir);
    }
    return { group: root.userData.pieces ? root : null, materials: mats };
  }

  /** Boots: a shaft over the ankle and a foot with a sole, both on the Foot bone (which sits at ground level, heel). Wolfskin tops the shaft with a flared fur cuff. */
  private buildFeet(id: string) {
    const ap = appearanceOf(id), moor = ap.form === 'moor', fur = ap.form === 'wolfskin' || moor;
    const main = this.material(ap), trim = this.material(ap, true), mats: THREE.Material[] = [main, trim];
    const ruff = fur ? this.double(main) : null;
    if (ruff) mats.push(ruff);
    const vein = ap.glow && ap.rung >= 3 ? this.inlay(ap) : null;
    if (vein) mats.push(vein);
    const root = new THREE.Group();
    for (const side of ['L', 'R']) {
      const foot = `Foot${side}`, toe = `Foot${side}_end`;
      if (!this.bind.has(foot) || !this.bind.has(toe)) continue;
      const a = this.at(foot), dir = this.at(toe).sub(a);
      // the foot's local Z ends up pointing up or down depending on the rig's handedness; "up" is whichever side it faces
      const zUp = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize())).y > 0 ? 1 : -1;
      const g = new THREE.Group(), w = this.world();
      this.part(new THREE.BoxGeometry(0.17, 0.3, 0.09), main, w, [0, 0.07, zUp * 0.055]);
      this.part(new THREE.BoxGeometry(0.165, 0.32, 0.025), trim, w, [0, 0.07, zUp * 0.0125]); // sole
      if (ap.rung >= 2) this.part(new THREE.BoxGeometry(0.16, 0.08, 0.09), trim, w, [0, 0.19, zUp * 0.055]); // toe cap: the tier fallback
      if (vein) this.part(new THREE.BoxGeometry(0.02, 0.2, 0.02), vein, w, [0, 0.1, zUp * 0.1]);
      if (moor) this.part(curvedSpike(0.035, 0.26, 0.1, 0.9, 3), trim, w, [0, 0.2, zUp * 0.09], [0, zUp > 0 ? Math.PI / 2 : -Math.PI / 2, 0]); // a horn toe-cap, curling up off the toe
      g.add(w);
      this.mountPiece(root, foot, g, a, dir);
      const shaft = new THREE.Group(), s = this.world();
      this.part(new THREE.CylinderGeometry(0.105, 0.12, 0.24, 7), main, s, [0, 0.13, -0.03]);
      if (moor) this.part(new THREE.CylinderGeometry(0.2, 0.12, 0.15, 7, 1, true), ruff!, s, [0, 0.28, -0.03]); // a deep fleece top, wider than wolfskin's
      else if (fur) this.part(new THREE.CylinderGeometry(0.17, 0.11, 0.1, 7, 1, true), ruff!, s, [0, 0.27, -0.03]);
      else this.part(new THREE.CylinderGeometry(0.12, 0.12, 0.035, 7), trim, s, [0, 0.25, -0.03]); // rolled top
      if (ap.form === 'marsh') {
        this.part(new THREE.CylinderGeometry(0.122, 0.128, 0.06, 7), trim, s, [0, 0.04, -0.03]); // the mud line round the ankle
        for (let i = 0; i < 8; i++) { const t = (i / 8) * Math.PI * 2; this.part(new THREE.ConeGeometry(0.02, 0.17 + 0.04 * (i % 3), 3), main, s, [Math.sin(t) * 0.12, 0.2, -0.03 + Math.cos(t) * 0.12], [Math.PI + Math.cos(t) * 0.3, 0, -Math.sin(t) * 0.3]); } // reeds hung over the top
      } else if (ap.form === 'thorn') {
        for (let i = 0; i < 5; i++) { const t = (i / 5) * Math.PI * 2 + 0.3; this.spikeOut(trim, s, [Math.sin(t) * 0.12, 0.25, -0.03 + Math.cos(t) * 0.12], [Math.sin(t), 0.7, Math.cos(t)], 0.035, 0.17); } // a crown of thorns round the rim
        this.spikeOut(trim, s, [0, 0.06, -0.14], [0, -0.35, -1], 0.04, 0.2); // and a spur at the heel
      }
      shaft.add(s);
      this.mountPiece(root, foot, shaft, a);
    }
    return { group: root.userData.pieces ? root : null, materials: mats };
  }
  private build(slot: WornSlot, id: string) {
    switch (slot) {
      case 'weapon': return this.buildWeapon(id);
      case 'head': return this.buildHead(id);
      case 'chest': return this.buildChest(id);
      case 'legs': return this.buildLegs(id);
      case 'hands': return this.buildHands(id);
      case 'feet': return this.buildFeet(id);
    }
  }

  /**
   * Make what is mounted match the equipment record. `motes` is optional: they drift off tier 3+ pieces.
   * A slot whose piece failed to load simply shows nothing extra (the body recolour still applies), so a missing GLB never breaks play.
   */
  sync(eq: Equipment, dt: number, motes?: Motes) {
    for (const slot of ['weapon', 'head', 'chest', 'legs', 'hands', 'feet'] as const) {
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

