// The player's worn gear, drawn: every equipped item is visible and nothing else is. Rendering only.
//
// One PlayerGear owns the knight's bone-mounted pieces. sync() diffs the sim's equipment record against what is mounted and
// rebuilds only the slot that changed, so swapping gear mid-session (even mid-swing) needs no event from the sim.
//   weapon -> sword.glb in the right hand, restyled and rescaled per item
//   head   -> a generated leather cap (rung 1) or helmet.glb (rung 2+), crest and horns added by rung
//   chest  -> the knight's own armour mesh recoloured, plus pauldrons.glb (rung 2+), spiked at rung 3+
//   legs   -> the split-off leg mesh recoloured, plus generated greaves (rung 2+) and knee cops (rung 3+)
// Bare slots show skin. Looks come from gear-look.ts, keyed by item id with a tier fallback.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Equipment } from './sim/items';
import { Appearance, appearanceOf } from './gear-look';
import { cappedIntensity } from './glow';
import { Instance, Prepared, spawn } from './models';
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
  private slots: Record<keyof Equipment, Mounted> = { weapon: empty(), head: empty(), chest: empty(), legs: empty() };
  private bodyMats = new Map<string, THREE.MeshStandardMaterial>();
  private motes = { weapon: 0, head: 0, chest: 0, legs: 0 };
  private tmp = new THREE.Vector3();

  /** Call at the bind pose, before the Animator exists. */
  constructor(private inst: Instance, private pieces: GearPieces) {
    this.model = inst.root.children[0];
    inst.root.updateMatrixWorld(true);
    const modelInv = new THREE.Matrix4().copy(this.model.matrixWorld).invert();
    this.model.traverse(o => {
      if (!(o as THREE.Bone).isBone) return;
      this.bones.set(o.name, o);
      this.bind.set(o.name, new THREE.Matrix4().multiplyMatrices(modelInv, o.matrixWorld));
    });
    this.k = 1 / this.model.scale.x;
    for (const m of inst.materials) if (m.name === 'Armor' || m.name === 'ArmorLegs') this.bodyMats.set(m.name, m as THREE.MeshStandardMaterial);
    this.dressBody('Armor', null);
    this.dressBody('ArmorLegs', null);
  }

  /** Where a bone sat at the bind pose, in model units. */
  private at(bone: string): THREE.Vector3 { return new THREE.Vector3().setFromMatrixPosition(this.bind.get(bone)!); }

  /** Parent `obj` to `bone`, positioned at `modelPos` (model units) with the bind pose's orientation, so it follows the bone from there. */
  private mount(bone: string, obj: THREE.Object3D, modelPos: THREE.Vector3) {
    const local = new THREE.Matrix4().copy(this.bind.get(bone)!).invert().multiply(new THREE.Matrix4().makeTranslation(modelPos.x, modelPos.y, modelPos.z));
    obj.matrixAutoUpdate = true;
    local.decompose(obj.position, obj.quaternion, obj.scale);
    this.bones.get(bone)!.add(obj);
  }

  /** Generated geometry is authored in world units; this wrapper puts it in model units. Meshes are flagged so unmount() can free them. */
  private world(): THREE.Group {
    const g = new THREE.Group();
    g.scale.setScalar(this.k);
    return g;
  }

  private part(g: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D, pos: [number, number, number], rot?: [number, number, number]) {
    const m = new THREE.Mesh(g, material);
    m.castShadow = m.receiveShadow = true;
    m.userData.own = true;
    m.position.set(...pos);
    if (rot) m.rotation.set(...rot);
    parent.add(m);
    return m;
  }

  /** Per-piece material: `trim` is the darker secondary colour, the main tint carries the metal response. Neither glows: only inlays and the blade do, so plate is never lit all over. */
  private material(ap: Appearance, trim = false): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({
      color: trim ? ap.trim : ap.tint, metalness: trim ? Math.min(ap.metal, 0.6) : ap.metal, roughness: trim ? Math.min(1, ap.rough + 0.15) : ap.rough, flatShading: true,
    });
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
      mat.color.setHex(isMain ? ap.tint : ap.trim);
      mat.metalness = isMain ? ap.metal : Math.min(ap.metal, 0.6);
      mat.roughness = isMain ? ap.rough : Math.min(1, ap.rough + 0.15);
      if (ap.glow && blade && (isTrim || isMain)) { mat.emissive.setHex(ap.glow); mat.emissiveIntensity = cappedIntensity(ap.glow, isTrim ? ap.glowI : ap.glowI * 0.4); }
      mat.needsUpdate = true;
    }
  }

  private unmount(slot: keyof Equipment) {
    const s = this.slots[slot];
    s.group?.removeFromParent();
    s.group?.traverse(o => { if (o.userData.own) (o as THREE.Mesh).geometry.dispose(); });
    for (const m of s.materials) m.dispose();
    this.slots[slot] = empty();
  }

  /** Dress the body materials for a slot: skin when bare, the item's tint when worn. */
  private dressBody(name: 'Armor' | 'ArmorLegs', id: string | null) {
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
    this.restyle(blade.materials, ap, ['Metal'], ['Gold', 'Red'], true);
    hand.add(blade.root);
    return { group: blade.root, materials: blade.materials };
  }

  private buildHead(id: string) {
    const ap = appearanceOf(id), g = new THREE.Group(), w = this.world(), mats: THREE.Material[] = [];
    const main = this.material(ap), trim = this.material(ap, true);
    mats.push(main, trim);
    if (ap.rung <= 1 || !this.pieces.helmet) {
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
      if (ap.rung >= 3) { // a swept crest along the skull: the silhouette cue from behind
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
    if (ap.rung <= 1 || !this.pieces.pauldrons) return { group: null, materials: [] };
    const g = new THREE.Group(), w = this.world();
    const pads = spawn(this.pieces.pauldrons, true);
    pads.root.matrixAutoUpdate = true;
    pads.root.scale.setScalar(1 + 0.18 * (ap.rung - 2));
    this.restyle(pads.materials, ap, ['Grey'], []);
    const mats: THREE.Material[] = [...pads.materials];
    g.add(pads.root);
    if (ap.rung >= 3) { // spikes on the shoulders: horizontal read at gathering distance
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

  private buildLegs(id: string) {
    const ap = appearanceOf(id);
    if (ap.rung <= 1) return { group: null, materials: [] };
    const main = this.material(ap), trim = this.material(ap, true), mats: THREE.Material[] = [main, trim];
    const root = new THREE.Group();
    for (const side of ['L', 'R']) {
      const shin = `LowerLeg.${side}`, end = `LowerLeg.${side}_end`;
      if (!this.bind.has(shin) || !this.bind.has(end)) continue;
      const a = this.at(shin), b = this.at(end), len = a.distanceTo(b) / this.k;
      const g = new THREE.Group(), w = this.world();
      // shin plate: a tapered six-sided shell from knee to ankle; knee cop on top for the higher rungs
      this.part(new THREE.CylinderGeometry(0.15, 0.11, len * 0.8, 6), main, w, [0, 0, 0]);
      this.part(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 6), trim, w, [0, -len * 0.4, 0]);
      if (ap.rung >= 3) this.part(new THREE.OctahedronGeometry(ap.rung >= 4 ? 0.17 : 0.13), trim, w, [0, len * 0.4 + 0.05, 0.05]);
      if (ap.rung >= 4) this.part(new THREE.ConeGeometry(0.05, 0.22, 4), trim, w, [0, len * 0.4 + 0.05, 0.2], [Math.PI / 2, 0, 0]);
      g.add(w);
      this.mount(shin, g, a.clone().lerp(b, 0.5));
      root.add(g);
    }
    return { group: root.children.length ? root : null, materials: mats };
  }

  private build(slot: keyof Equipment, id: string) {
    switch (slot) {
      case 'weapon': return this.buildWeapon(id);
      case 'head': return this.buildHead(id);
      case 'chest': return this.buildChest(id);
      case 'legs': return this.buildLegs(id);
    }
  }

  /**
   * Make what is mounted match the equipment record. `motes` is optional: they drift off tier 3+ pieces.
   * A slot whose piece failed to load simply shows nothing extra (the body recolour still applies), so a missing GLB never breaks play.
   */
  sync(eq: Equipment, dt: number, motes?: Motes) {
    for (const slot of ['weapon', 'head', 'chest', 'legs'] as const) {
      const id = eq[slot];
      if (id !== this.slots[slot].id) {
        this.unmount(slot);
        const built = id ? this.build(slot, id) : null;
        this.slots[slot] = { id, group: built?.group ?? null, materials: built?.materials ?? [] };
        if (slot === 'chest') this.dressBody('Armor', id);
        if (slot === 'legs') this.dressBody('ArmorLegs', id);
      }
      const ap = id ? appearanceOf(id) : null, g = this.slots[slot].group;
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
