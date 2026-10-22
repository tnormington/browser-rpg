// The edge of the world, drawn (HOM-190). sim/edges.ts says what stands where, edges.ts (HOM-191) what each kind looks like; this puts them on screen.
// The whole world has some 5,000 pieces and only a few hundred are ever within sight, so nothing is built per piece: each shape (a kind's variant, one
// material class of it) is one InstancedMesh, refilled with whatever lies within the fog's reach of the player whenever they have walked a few paces.
// A region you are not near costs nothing; one you are near costs a handful of draws, however long its wall.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EdgeKind, EdgePiece, buildEdges } from './sim/edges';
import { inCave } from './sim/world';
import { edgeRecipe } from './edges';
import { edgeStyles } from './edge-styles';
import { bakeUV } from './surface';

/** The reach of the view: fog is total at 85 on a clear night and the camera sits behind the player; a fen's air carries a little further. */
const RANGE = 110;
/** A refill happens when the player has walked this far from where the last one was taken. */
const REFRESH = 8;
const CELL = 32;

const flat = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g);
/** One draw of a variant: a material class and every layer of the variant that uses it, merged, colours painted into the vertices. */
interface Shape { cls: string; geometry: THREE.BufferGeometry; material: THREE.Material }

/** One shape's instanced mesh and how many it can hold. */
interface Slot { mesh: THREE.InstancedMesh; cap: number }

export class EdgeView {
  private pieces: EdgePiece[];
  private cells = new Map<string, EdgePiece[]>();
  private slots = new Map<string, Slot>();
  private variants = new Map<string, Shape[]>();
  private at = { x: NaN, z: NaN };
  private hidden = false;
  private group = new THREE.Group();
  private tmp = { m: new THREE.Matrix4(), q: new THREE.Quaternion(), up: new THREE.Vector3(0, 1, 0), s: new THREE.Vector3(), p: new THREE.Vector3(), c: new THREE.Color() };

  /** `material` is the renderer's own (render.ts `material`): the edge takes light like everything else. */
  constructor(scene: THREE.Scene, private material: (color: number, cls: string) => THREE.Material, pieces: EdgePiece[] = buildEdges(edgeStyles())) {
    this.pieces = pieces;
    scene.add(this.group);
    for (const p of pieces) {
      const k = `${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`;
      (this.cells.get(k) ?? this.cells.set(k, []).get(k)!).push(p);
    }
  }

  /** Pieces in the world, and instanced meshes live right now: for the bench. */
  get stats() { return { pieces: this.pieces.length, draws: [...this.slots.values()].filter(s => s.mesh.visible).length, instances: [...this.slots.values()].reduce((n, s) => n + (s.mesh.visible ? s.mesh.count : 0), 0) }; }

  /** Fill the meshes with what is near, when the player has gone somewhere new. Underground there is no sky for an edge to stand under. */
  update(px: number, pz: number) {
    if (inCave(px, pz)) {
      if (!this.hidden) { this.hidden = true; this.group.visible = false; }
      return;
    }
    if (this.hidden) { this.hidden = false; this.group.visible = true; this.at.x = NaN; }
    if (Math.hypot(px - this.at.x, pz - this.at.z) < REFRESH) return;
    this.at.x = px; this.at.z = pz;
    const near = new Map<string, EdgePiece[]>(), r2 = RANGE * RANGE;
    for (let cx = Math.floor((px - RANGE) / CELL); cx <= Math.floor((px + RANGE) / CELL); cx++) {
      for (let cz = Math.floor((pz - RANGE) / CELL); cz <= Math.floor((pz + RANGE) / CELL); cz++) {
        for (const p of this.cells.get(`${cx},${cz}`) ?? []) {
          if ((p.x - px) ** 2 + (p.z - pz) ** 2 > r2) continue;
          const key = `${p.kind}:${p.variant}`;
          (near.get(key) ?? near.set(key, []).get(key)!).push(p);
        }
      }
    }
    for (const [key, slot] of this.slots) if (!near.has(key.slice(0, key.lastIndexOf(':')))) { slot.mesh.count = 0; slot.mesh.visible = false; }
    for (const [key, list] of near) this.fill(key, list);
  }

  /** Fill every draw of a variant with its pieces. */
  private fill(variantKey: string, list: EdgePiece[]) {
    const kind = list[0].kind, recipe = edgeRecipe(kind), { m, q, up, s, p, c } = this.tmp;
    for (const shape of this.shapesOf(variantKey, kind, list[0].variant)) {
      const key = `${variantKey}:${shape.cls}`;
      let slot = this.slots.get(key);
      if (!slot || slot.cap < list.length) slot = this.grow(key, kind, shape, Math.max(64, Math.ceil(list.length * 1.5)));
      list.forEach((e, i) => {
        slot!.mesh.setMatrixAt(i, m.compose(p.set(e.x, -e.sink, e.z), q.setFromAxisAngle(up, e.rot), s.setScalar(e.scale)));
        // lighter and darker with the drift along the edge, and each rank back darker than the one before it: trees behind trees
        slot!.mesh.setColorAt(i, c.setScalar((1 + (e.tone - 0.5) * 2 * recipe.colorJitter) * (1 - recipe.rankShade * e.rank)));
      });
      slot.mesh.count = list.length;
      slot.mesh.visible = true;
      slot.mesh.instanceMatrix.needsUpdate = true;
      if (slot.mesh.instanceColor) slot.mesh.instanceColor.needsUpdate = true;
      slot.mesh.boundingSphere = null; // the frustum test must see where they are now
    }
  }

  /** A variant's draws, built the first time it is wanted and kept. */
  private shapesOf(variantKey: string, kind: EdgeKind, variant: number): Shape[] {
    let shapes = this.variants.get(variantKey);
    if (shapes) return shapes;
    const byClass = new Map<string, THREE.BufferGeometry[]>();
    for (const l of edgeRecipe(kind).pieces[variant].layers) {
      const g = flat(l.geometry).clone(), c = new THREE.Color(l.color), col = new Float32Array(g.attributes.position.count * 3);
      for (let i = 0; i < col.length; i += 3) c.toArray(col, i);
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      (byClass.get(l.cls) ?? byClass.set(l.cls, []).get(l.cls)!).push(g);
    }
    shapes = [...byClass].map(([cls, parts]) => {
      const material = this.material(0xffffff, cls) as THREE.MeshStandardMaterial;
      material.vertexColors = true;
      return { cls, geometry: bakeUV(mergeGeometries(parts)!), material };
    });
    this.variants.set(variantKey, shapes);
    return shapes;
  }

  private grow(key: string, kind: EdgeKind, shape: Shape, cap: number): Slot {
    const old = this.slots.get(key);
    if (old) { this.group.remove(old.mesh); old.mesh.dispose(); } // the instance buffers; the geometry and material outlive it
    const mesh = new THREE.InstancedMesh(shape.geometry, shape.material, cap);
    mesh.castShadow = kind !== 'water'; mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(mesh);
    const slot = { mesh, cap };
    this.slots.set(key, slot);
    return slot;
  }
}
