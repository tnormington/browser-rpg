// Render-side effects: one additive particle pool plus a few expanding rings. Presentation only, never touches sim state.
import * as THREE from 'three';

export interface BurstOpts {
  color: number | number[];  // one colour, or a palette picked per particle
  count: number;
  speed?: number;            // initial speed (units/sec)
  up?: number;               // extra upward kick
  life?: number;             // seconds
  gravity?: number;          // units/sec^2 (negative floats)
  flat?: boolean;            // spray sideways only (ground dust, rings)
}

/** Emissive FX are pushed past 1.0 so they cross the bloom threshold in the HDR buffer; they stay vivid either way. */
export const FX_HDR = 2.5;

export class Particles {
  private max = 900;
  private pos = new Float32Array(this.max * 3);
  private col = new Float32Array(this.max * 3);
  private vel = new Float32Array(this.max * 3);
  private life = new Float32Array(this.max);
  private maxLife = new Float32Array(this.max);
  private base = new Float32Array(this.max * 3);
  private grav = new Float32Array(this.max);
  private next = 0;
  readonly points: THREE.Points;

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.pos.fill(-1000);
    this.points = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.28, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, toneMapped: false, // emissive FX stay vivid under ACES
    }));
    this.points.frustumCulled = false;
  }

  burst(x: number, y: number, z: number, o: BurstOpts) {
    const palette = Array.isArray(o.color) ? o.color : [o.color];
    const c = new THREE.Color();
    for (let n = 0; n < o.count; n++) {
      const i = this.next; this.next = (this.next + 1) % this.max;
      const ang = Math.random() * Math.PI * 2, sp = (o.speed ?? 4) * (0.4 + Math.random() * 0.6);
      const el = o.flat ? 0 : (Math.random() - 0.3) * 2;
      this.pos.set([x, y, z], i * 3);
      this.vel.set([Math.cos(ang) * sp, el * sp * 0.6 + (o.up ?? 0), Math.sin(ang) * sp], i * 3);
      c.setHex(palette[Math.floor(Math.random() * palette.length)]);
      this.base.set([c.r * FX_HDR, c.g * FX_HDR, c.b * FX_HDR], i * 3);
      this.life[i] = this.maxLife[i] = (o.life ?? 0.7) * (0.6 + Math.random() * 0.4);
      this.grav[i] = o.gravity ?? -9;
    }
  }

  /** A line of sparks from a to b: the Serrated Throw "projectile". */
  trail(ax: number, ay: number, az: number, bx: number, by: number, bz: number, color: number) {
    const n = 14, c = new THREE.Color(color);
    for (let k = 0; k < n; k++) {
      const i = this.next, t = k / (n - 1);
      this.next = (this.next + 1) % this.max;
      this.pos.set([ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t], i * 3);
      this.vel.set([(Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6], i * 3);
      this.base.set([c.r * FX_HDR, c.g * FX_HDR, c.b * FX_HDR], i * 3);
      this.life[i] = this.maxLife[i] = 0.12 + t * 0.2; // the head of the trail lingers longest: reads as motion
      this.grav[i] = 0;
    }
  }

  update(dt: number) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]), j = i * 3;
      if (this.life[i] <= 0) { this.pos[j + 1] = -1000; this.col[j] = this.col[j + 1] = this.col[j + 2] = 0; continue; }
      this.vel[j + 1] += this.grav[i] * dt;
      for (let a = 0; a < 3; a++) { this.pos[j + a] += this.vel[j + a] * dt; this.col[j + a] = this.base[j + a] * k; }
      if (this.pos[j + 1] < 0.05 && this.vel[j + 1] < 0) { this.pos[j + 1] = 0.05; this.vel[j + 1] *= -0.3; }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

/** Tiny slow motes that drift off high-tier gear: a separate, small-point system so they read as dust of light, not as combat sparks. */
export class Motes {
  private max = 48;
  private pos = new Float32Array(this.max * 3).fill(-1000);
  private col = new Float32Array(this.max * 3);
  private base = new Float32Array(this.max * 3);
  private vel = new Float32Array(this.max * 3);
  private life = new Float32Array(this.max);
  private next = 0;
  readonly points: THREE.Points;
  private static LIFE = 1.3;

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.045, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, toneMapped: false,
    }));
    this.points.frustumCulled = false;
  }

  emit(x: number, y: number, z: number, color: number) {
    const i = this.next, c = new THREE.Color(color), j = i * 3;
    this.next = (this.next + 1) % this.max;
    this.pos.set([x + (Math.random() - 0.5) * 0.3, y + (Math.random() - 0.5) * 0.3, z + (Math.random() - 0.5) * 0.3], j);
    this.vel.set([(Math.random() - 0.5) * 0.2, 0.25 + Math.random() * 0.25, (Math.random() - 0.5) * 0.2], j);
    this.base.set([c.r * 1.6, c.g * 1.6, c.b * 1.6], j);
    this.life[i] = Motes.LIFE;
  }

  update(dt: number) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const j = i * 3, k = Math.max(0, this.life[i] / Motes.LIFE);
      if (this.life[i] <= 0) { this.pos[j + 1] = -1000; this.col.fill(0, j, j + 3); continue; }
      for (let a = 0; a < 3; a++) { this.pos[j + a] += this.vel[j + a] * dt; this.col[j + a] = this.base[j + a] * k; }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

interface Ring { mesh: THREE.Mesh; age: number; dur: number; from: number; to: number }

/** Expanding, fading ground rings (shockwaves, heals, level-ups). */
export class Rings {
  private rings: Ring[] = [];
  private geo = new THREE.TorusGeometry(1, 0.06, 4, 24).rotateX(Math.PI / 2);

  constructor(private scene: THREE.Scene) {}

  pulse(x: number, y: number, z: number, color: number, to: number, dur = 0.5, from = 0.3) {
    const mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, toneMapped: false }));
    (mesh.material as THREE.MeshBasicMaterial).color.multiplyScalar(FX_HDR);
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.rings.push({ mesh, age: 0, dur, from, to });
  }

  update(dt: number) {
    this.rings = this.rings.filter(r => {
      r.age += dt;
      const k = r.age / r.dur;
      if (k >= 1) { this.scene.remove(r.mesh); (r.mesh.material as THREE.Material).dispose(); return false; }
      r.mesh.scale.setScalar(r.from + (r.to - r.from) * (1 - (1 - k) * (1 - k)));
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - k;
      return true;
    });
  }
}

/** The arc a sword blow just cut: a crescent that sweeps across the player's front and fades. A small pool, reused. */
export class Slashes {
  private geo = new THREE.RingGeometry(0.95, 1.75, 14, 1, -Math.PI / 2 - 0.8, 1.6).rotateX(-Math.PI / 2); // arc centred on +z, lying flat
  private pool: { root: THREE.Group; mat: THREE.MeshBasicMaterial; age: number; dur: number; from: number }[] = [];
  private tint = new THREE.Color(0xbfd2ea).multiplyScalar(FX_HDR * 0.7);

  constructor(private scene: THREE.Scene) {}

  /** `heavy` swings wider and lasts longer. The arc is tilted so it reads as a diagonal cut, high on the sword side. */
  swipe(x: number, z: number, facing: number, heavy = false) {
    let s = this.pool.find(p => p.age >= p.dur);
    if (!s) {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false });
      const mesh = new THREE.Mesh(this.geo, mat), root = new THREE.Group();
      mesh.rotation.z = 0.55; // roll about the forward axis: the diagonal
      mesh.raycast = () => {};
      root.add(mesh);
      this.scene.add(root);
      s = { root, mat, age: 1, dur: 1, from: 0 };
      this.pool.push(s);
    }
    s.mat.color.copy(this.tint);
    s.age = 0; s.dur = heavy ? 0.28 : 0.2; s.from = facing + 1.1;
    s.root.position.set(x, 1.25, z);
    s.root.scale.setScalar(heavy ? 1.35 : 1);
    s.root.rotation.y = s.from;
    s.root.visible = true;
  }

  update(dt: number) {
    for (const s of this.pool) {
      if (s.age >= s.dur) { s.root.visible = false; continue; }
      s.age += dt;
      const k = Math.min(1, s.age / s.dur);
      s.root.rotation.y = s.from - 2.2 * (1 - (1 - k) * (1 - k)); // fast out, easing off: the cut
      s.mat.opacity = 0.6 * (1 - k) * (1 - k);
    }
  }
}
