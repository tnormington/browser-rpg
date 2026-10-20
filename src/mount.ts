// The mount, drawn: the horse model, its tack, and the numbers the rider needs to sit on it. Rendering only.
//
// A MountRig is the horse plus a Seat. The rider is the player's own rig: hand `seat` to Animator.ride() and the knight bends
// into the saddle whatever he is wearing (gear is bone-mounted, so it follows the bones). Each frame call update(), then give the
// rider `bob` so the hips ride the gait instead of floating over it.
//
// Two mounts, two animals: the Courser is the pack's plain dun with a working saddle; the second (Highmoor, 3x the price) is the pack's
// fuller horse in a dark coat with a pale mane, armoured and caparisoned. A MountLook is everything that differs between them.
import * as THREE from 'three';
import { Animator, Seat } from './anim';
import { Prepared, SlotId, spawn } from './models';

/** Tack is drawn in world units, in the horse's frame (+z forward, +y up from the hooves), then hung on a bone so it moves with the body. */
type Hang = (bone: string, mesh: THREE.Mesh, pos: [number, number, number], rot?: [number, number, number]) => void;
const flat = (color: number, rough = 0.85, metal = 0.05) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, flatShading: true });
const box = (w: number, h: number, d: number, m: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);

export interface Saddle { y: number; z: number; width: number; length: number }
export interface MountLook {
  slot: SlotId;
  /** Tuned by eye against the rendered horse. */
  saddle: Saddle;
  dress(hang: Hang, s: Saddle): void;
}

const LEATHER = 0x3a2a20, CLOTH = 0x4a3c34, IRON = 0x5a5e66;
/** A blanket, the seat, a low pommel and cantle: a working saddle and nothing finer. */
function courserTack(hang: Hang, { y, z, width: w, length: l }: Saddle) {
  const leather = flat(LEATHER), cloth = flat(CLOTH), iron = flat(IRON, 0.5, 0.6);
  hang('Torso', box(w, 0.06, l * 1.25, cloth), [0, y - 0.1, z]);
  hang('Torso', box(w * 0.7, 0.1, l, leather), [0, y - 0.03, z]);
  hang('Torso', box(w * 0.4, 0.14, 0.1, leather), [0, y + 0.07, z + l / 2]);
  hang('Torso', box(w * 0.7, 0.16, 0.1, leather), [0, y + 0.08, z - l / 2]);
  for (const sx of [-1, 1]) hang('Torso', box(0.05, 0.05, 0.1, iron), [sx * (w / 2 + 0.02), y - 0.2, z]);
}

const WAR_STEEL = 0x8e98aa, WAR_DARK = 0x2c303c, WAR_CLOTH = 0x3a4a64, WAR_TRIM = 0xb4bccc, WAR_PLUME = 0xdcdfe2;
/**
 * The war horse's tack: a caparison hanging either side in Highmoor's cold slate with a pale hem, a plate peytral across the chest, a chamfron on
 * the face with a plume at the poll, a crinet of plates down the neck, a crupper plate over the quarters and a high-backed saddle with stirrups.
 * Silhouette does the work: the plume, the crest and the hanging cloth are what read at play distance. No glow: it is the horse that is looked at.
 */
function destrierTack(hang: Hang, { y, z, width: w, length: l }: Saddle) {
  const steel = flat(WAR_STEEL, 0.4, 0.45), dark = flat(WAR_DARK, 0.75), cloth = flat(WAR_CLOTH, 0.95), trim = flat(WAR_TRIM, 0.6, 0.2), plume = flat(WAR_PLUME, 0.9);
  // saddle: a deep seat between a tall cantle and a pommel that swells forward
  hang('Torso', box(w * 0.8, 0.1, l, dark), [0, y - 0.03, z]);
  hang('Torso', box(w * 0.8, 0.34, 0.12, dark), [0, y + 0.15, z - l / 2], [0.2, 0, 0]);
  hang('Torso', box(w * 0.5, 0.22, 0.12, dark), [0, y + 0.1, z + l / 2], [-0.2, 0, 0]);
  hang('Torso', box(w * 0.85, 0.04, 0.14, steel), [0, y + 0.31, z - l / 2 - 0.04], [0.2, 0, 0]); // the cantle's steel cap
  // caparison: two panels hanging off the saddle with a pale hem, and a bar of cloth across the quarters
  const dag = new THREE.ConeGeometry(0.11, 0.26, 3).rotateX(Math.PI); // the hem is cut in points, which is what makes a skirt read as cloth and not a box
  for (const sx of [-1, 1]) {
    const x = sx * (w / 2 + 0.2), lean: [number, number, number] = [0, 0, sx * 0.1];
    hang('Torso', box(0.05, 0.46, 1.3, cloth), [x, y - 0.4, z - 0.05], lean);
    hang('Torso', box(0.06, 0.06, 1.3, trim), [x + sx * 0.04, y - 0.64, z - 0.05], lean);
    for (let i = 0; i < 6; i++) hang('Torso', new THREE.Mesh(dag, trim), [x + sx * 0.05, y - 0.78, z - 0.6 + i * 0.22], lean);
    hang('Torso', box(0.07, 0.2, 0.2, steel), [x, y - 0.12, z + 0.45]); // the plate each skirt is pinned by
    hang('Torso', box(0.05, 0.05, 0.28, steel), [x + sx * 0.04, y - 1.0, z]); // stirrup iron
  }
  // crupper: three plates stepping down the quarters
  for (let i = 0; i < 3; i++) hang('Torso', box(w * (1.1 - i * 0.12), 0.05, 0.3, steel), [0, y + 0.02 - i * 0.07, z - 0.55 - i * 0.28], [0.22 + i * 0.08, 0, 0]);
  // peytral: a chest plate with a rim, studded, hanging from a strap over the withers
  hang('Torso', box(0.62, 0.5, 0.1, steel), [0, y - 0.55, z + 0.95], [-0.15, 0, 0]);
  hang('Torso', box(0.66, 0.06, 0.12, trim), [0, y - 0.28, z + 0.93], [-0.15, 0, 0]);
  for (const sx of [-1, 0, 1]) hang('Torso', new THREE.Mesh(new THREE.OctahedronGeometry(0.05), trim), [sx * 0.2, y - 0.55, z + 1.02]);
  // crinet: plates down the crest of the neck, smaller toward the poll
  for (let i = 0; i < 5; i++) hang('Torso', box(0.14 - i * 0.012, 0.05, 0.2, steel), [0, y + 0.07 + i * 0.12, z + 0.88 + i * 0.12], [-0.8 - i * 0.04, 0, 0]);
  // chamfron: a plate down the face, a rim round each eye and a plume at the poll
  hang('Head', box(0.2, 0.07, 0.7, steel), [0, 2.1, 1.28], [0.85, 0, 0]);
  hang('Head', box(0.26, 0.05, 0.12, trim), [0, 2.38, 1.03], [0.2, 0, 0]);
  for (let i = 0; i < 4; i++) hang('Head', new THREE.Mesh(new THREE.ConeGeometry(0.11 - i * 0.012, 0.8 - i * 0.09, 4), plume), [0, 2.62 - i * 0.04, 0.9 - i * 0.12], [-0.5 - i * 0.28, 0, 0]);
}

/** Look per mount id; a mount the table does not know falls back by speed (the second is the 13 u/s one). */
export const MOUNT_LOOKS = {
  courser: { slot: 'horse', saddle: { y: 1.5, z: -0.1, width: 0.52, length: 0.6 }, dress: courserTack },
  destrier: { slot: 'destrier', saddle: { y: 1.72, z: -0.3, width: 0.56, length: 0.66 }, dress: destrierTack },
} satisfies Record<string, MountLook>;
export type MountLookId = keyof typeof MOUNT_LOOKS;
export const mountLookId = (id: string | undefined, speed: number): MountLookId => (id && id in MOUNT_LOOKS ? id as MountLookId : speed > 10 ? 'destrier' : 'courser');

export class MountRig {
  readonly root: THREE.Object3D;
  readonly anim: Animator;
  readonly seat: Seat;
  /** The saddle's rise off its rest height this frame, from the gait. */
  bob = 0;
  private torso: THREE.Object3D;
  private rest: number;
  private tmp = new THREE.Vector3();

  constructor(p: Prepared, readonly speed: number, look: MountLook) {
    const inst = spawn(p);
    this.root = inst.root;
    this.root.updateMatrixWorld(true);
    this.torso = this.root.getObjectByName('Torso')!;
    this.rest = this.backY();
    this.seat = { y: look.saddle.y + 0.05, z: look.saddle.z };
    this.anim = new Animator(this.root, inst.clips, p.def.anim!);
    look.dress((bone, mesh, pos, rot) => this.hang(bone, mesh, pos, rot), look.saddle);
  }

  private backY() { return this.root.worldToLocal(this.torso.getWorldPosition(this.tmp)).y; }

  /** Call every frame with whether the mount is travelling. */
  update(dt: number, moving: boolean) {
    this.anim.locomotion(moving, this.speed);
    this.anim.update(dt);
    this.root.updateMatrixWorld(true);
    this.bob = this.backY() - this.rest;
  }

  /** Hang a world-unit mesh on a bone at `pos` (the horse's frame, at the bind pose). */
  private hang(boneName: string, mesh: THREE.Mesh, pos: [number, number, number], rot?: [number, number, number]) {
    const bone = this.root.getObjectByName(boneName)!;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.position.set(...pos);
    if (rot) mesh.rotation.set(...rot);
    mesh.updateMatrix();
    const world = new THREE.Matrix4().multiplyMatrices(this.root.matrixWorld, mesh.matrix);
    const local = new THREE.Matrix4().multiplyMatrices(new THREE.Matrix4().copy(bone.matrixWorld).invert(), world);
    mesh.matrixAutoUpdate = true;
    local.decompose(mesh.position, mesh.quaternion, mesh.scale);
    bone.add(mesh);
  }
}
