// The mount, drawn: the horse model, its tack, and the numbers the rider needs to sit on it. Rendering only.
//
// A MountRig is the horse plus a Seat. The rider is the player's own rig: hand `seat` to Animator.ride() and the knight bends
// into the saddle whatever he is wearing (gear is bone-mounted, so it follows the bones). Each frame call update(), then give the
// rider `bob` so the hips ride the gait instead of floating over it.
import * as THREE from 'three';
import { Animator, Seat } from './anim';
import { Prepared, spawn } from './models';

/** Tack is drawn in world units, in the horse's frame (+z forward, +y up from the hooves), then hung on the torso bone so it moves with the body. */
const LEATHER = 0x3a2a20, CLOTH = 0x4a3c34, IRON = 0x5a5e66;
/** Tuned by eye against the rendered horse. */
const SADDLE = { y: 1.5, z: -0.1, width: 0.52, length: 0.6 };

export class MountRig {
  readonly root: THREE.Object3D;
  readonly anim: Animator;
  readonly seat: Seat;
  /** The saddle's rise off its rest height this frame, from the gait. */
  bob = 0;
  private torso: THREE.Object3D;
  private rest: number;
  private tmp = new THREE.Vector3();

  constructor(p: Prepared, readonly speed: number) {
    const inst = spawn(p);
    this.root = inst.root;
    this.root.updateMatrixWorld(true);
    this.torso = this.root.getObjectByName('Torso')!;
    this.rest = this.backY();
    this.seat = { y: SADDLE.y + 0.05, z: SADDLE.z };
    this.anim = new Animator(this.root, inst.clips, p.def.anim!);
    this.dress();
  }

  private backY() { return this.root.worldToLocal(this.torso.getWorldPosition(this.tmp)).y; }

  /** Call every frame with whether the mount is travelling. */
  update(dt: number, moving: boolean) {
    this.anim.locomotion(moving, this.speed);
    this.anim.update(dt);
    this.root.updateMatrixWorld(true);
    this.bob = this.backY() - this.rest;
  }

  /** Hang a world-unit mesh on the torso bone at `pos` (the horse's frame, at the bind pose). */
  private hang(mesh: THREE.Mesh, pos: [number, number, number], rot?: [number, number, number]) {
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.position.set(...pos);
    if (rot) mesh.rotation.set(...rot);
    mesh.updateMatrix();
    const world = new THREE.Matrix4().multiplyMatrices(this.root.matrixWorld, mesh.matrix);
    const local = new THREE.Matrix4().multiplyMatrices(new THREE.Matrix4().copy(this.torso.matrixWorld).invert(), world);
    mesh.matrixAutoUpdate = true;
    local.decompose(mesh.position, mesh.quaternion, mesh.scale);
    this.torso.add(mesh);
  }

  private dress() {
    const flat = (color: number, rough = 0.85, metal = 0.05) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, flatShading: true });
    const leather = flat(LEATHER), cloth = flat(CLOTH), iron = flat(IRON, 0.5, 0.6);
    const { y, z, width: w, length: l } = SADDLE;
    // a blanket, the seat, a low pommel and cantle: a working saddle and nothing finer
    this.hang(new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, l * 1.25), cloth), [0, y - 0.1, z]);
    this.hang(new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 0.1, l), leather), [0, y - 0.03, z]);
    this.hang(new THREE.Mesh(new THREE.BoxGeometry(w * 0.4, 0.14, 0.1), leather), [0, y + 0.07, z + l / 2]);
    this.hang(new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 0.16, 0.1), leather), [0, y + 0.08, z - l / 2]);
    for (const sx of [-1, 1]) this.hang(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.1), iron), [sx * (w / 2 + 0.02), y - 0.2, z]);
  }
}
