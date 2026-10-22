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
  dir?: [number, number];    // unit x,z the spray is thrown along (a blow's direction); omitted = every way
  cone?: number;             // with dir: 0 = no preference .. 1 = a tight jet
  size?: number;             // sprite size multiplier: grit and flashes are not the size of a spark
  drag?: number;             // per-second velocity loss: sparks that bite and stop
  hdr?: number;              // brightness (default FX_HDR): blood at full HDR blooms to white, so it asks for less
  alpha?: number;            // solid pool only: peak opacity (dust is a haze, blood is not)
}

/** Emissive FX are pushed past 1.0 so they cross the bloom threshold in the HDR buffer; they stay vivid either way. */
export const FX_HDR = 2.5;

/** Round soft sprite for point FX, so a particle is a mote of light, not a square. */
function discTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const x = c.getContext('2d')!, g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

/** Point FX use world-size attenuation, which balloons a particle spawned beside the camera into a screen-filling quad (HOM-27); cap it at a fraction of the viewport. */
function pointFxMaterial(size: number, sized = false, solid = false): THREE.PointsMaterial {
  const m = new THREE.PointsMaterial({
    size, map: discTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: solid ? THREE.NormalBlending : THREE.AdditiveBlending, sizeAttenuation: true, toneMapped: false, // emissive FX stay vivid under ACES
  });
  m.onBeforeCompile = (sh) => {
    // a big sprite (a contact flash) is allowed a proportionally bigger cap, up to 3x: it lives for five frames and is the point
    const cap = sized ? 'scale * 0.05 * clamp(aSize, 1.0, 3.0)' : 'scale * 0.05';
    sh.vertexShader = sh.vertexShader.replace('#include <logdepthbuf_vertex>', `gl_PointSize = min(gl_PointSize, ${cap});\n#include <logdepthbuf_vertex>`);
    if (sized) sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aSize;').replace('gl_PointSize = size;', 'gl_PointSize = size * aSize;');
  };
  return m;
}

/**
 * One pool of point sprites. The default pool is additive light (sparks, magic). A `solid` pool is normally blended and
 * fades by alpha: it is what has to read as matter (blood, grit, dust), because additive light can only brighten a dark
 * ground, and a dark red is not made of that.
 */
export class Particles {
  private max = 900;
  private pos = new Float32Array(this.max * 3);
  private col = new Float32Array(this.max * 4); // rgba
  private vel = new Float32Array(this.max * 3);
  private life = new Float32Array(this.max);
  private maxLife = new Float32Array(this.max);
  private base = new Float32Array(this.max * 3);
  private grav = new Float32Array(this.max);
  private drag = new Float32Array(this.max);
  private size = new Float32Array(this.max).fill(1);
  private opacity = new Float32Array(this.max).fill(1);
  private next = 0;
  readonly points: THREE.Points;

  constructor(private solid = false) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.pos.fill(-1000);
    this.points = new THREE.Points(g, pointFxMaterial(0.28, true, solid));
    this.points.frustumCulled = false;
  }

  burst(x: number, y: number, z: number, o: BurstOpts) {
    const palette = Array.isArray(o.color) ? o.color : [o.color];
    const c = new THREE.Color(), hdr = o.hdr ?? FX_HDR;
    const aim = o.dir ? Math.atan2(o.dir[1], o.dir[0]) : 0, cone = o.cone ?? 0.7;
    for (let n = 0; n < o.count; n++) {
      const i = this.next; this.next = (this.next + 1) % this.max;
      // a jet narrows round the aim: cone 1 is +-0.35 rad, cone 0 the full circle
      const ang = o.dir ? aim + (Math.random() - 0.5) * 2 * (Math.PI * (1 - cone) + 0.35 * cone) : Math.random() * Math.PI * 2;
      const sp = (o.speed ?? 4) * (0.4 + Math.random() * 0.6);
      const el = o.flat ? 0 : (Math.random() - 0.3) * 2;
      this.pos.set([x, y, z], i * 3);
      this.vel.set([Math.cos(ang) * sp, el * sp * 0.6 + (o.up ?? 0), Math.sin(ang) * sp], i * 3);
      c.setHex(palette[Math.floor(Math.random() * palette.length)]);
      this.base.set([c.r * hdr, c.g * hdr, c.b * hdr], i * 3);
      this.life[i] = this.maxLife[i] = (o.life ?? 0.7) * (0.6 + Math.random() * 0.4);
      this.grav[i] = o.gravity ?? -9;
      this.drag[i] = o.drag ?? 0;
      this.size[i] = (o.size ?? 1) * (0.75 + Math.random() * 0.5);
      this.opacity[i] = o.alpha ?? 1;
    }
    this.points.geometry.attributes.aSize.needsUpdate = true;
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
      this.grav[i] = 0; this.drag[i] = 0; this.size[i] = 1; this.opacity[i] = 1;
    }
    this.points.geometry.attributes.aSize.needsUpdate = true;
  }

  update(dt: number) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]), j = i * 3, c = i * 4;
      if (this.life[i] <= 0) { this.pos[j + 1] = -1000; this.col.fill(0, c, c + 4); continue; }
      this.vel[j + 1] += this.grav[i] * dt;
      if (this.drag[i] > 0) { const keep = Math.max(0, 1 - this.drag[i] * dt); this.vel[j] *= keep; this.vel[j + 1] *= keep; this.vel[j + 2] *= keep; }
      for (let a = 0; a < 3; a++) { this.pos[j + a] += this.vel[j + a] * dt; this.col[c + a] = this.solid ? this.base[j + a] : this.base[j + a] * k; }
      this.col[c + 3] = this.solid ? Math.min(1, k * 3) * this.opacity[i] : 1;
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
    this.points = new THREE.Points(g, pointFxMaterial(0.045));
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

  pulse(x: number, y: number, z: number, color: number, to: number, dur = 0.5, from = 0.3, hdr = FX_HDR) {
    const mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, toneMapped: false }));
    (mesh.material as THREE.MeshBasicMaterial).color.multiplyScalar(hdr);
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
  private geo = new THREE.RingGeometry(1.4, 1.8, 14, 1, -Math.PI / 2 - 0.8, 1.6).rotateX(-Math.PI / 2); // arc centred on +z, lying flat
  private spinGeo = new THREE.RingGeometry(0.86, 1, 36, 1, 0, 5).rotateX(-Math.PI / 2); // five-sixths of a circle: the blade's whole turn, unit radius
  private pool: Slash[] = [];
  private spins: Slash[] = [];
  private tint = new THREE.Color(0xbfd2ea).multiplyScalar(FX_HDR * 0.45);

  constructor(private scene: THREE.Scene) {}

  /** A free slot of `pool` (one that has finished), or a new mesh on `geo` with `tilt` radians of roll about the forward axis. */
  private grab(pool: Slash[], geo: THREE.BufferGeometry, tilt: number): Slash {
    let s = pool.find(p => p.age >= p.dur);
    if (!s) {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false });
      const mesh = new THREE.Mesh(geo, mat), root = new THREE.Group();
      mesh.rotation.z = tilt;
      mesh.raycast = () => {};
      root.add(mesh);
      this.scene.add(root);
      s = { root, mat, age: 1, dur: 1, from: 0, turn: 0, peak: 0.5 };
      pool.push(s);
    }
    return s;
  }

  /**
   * `heavy` swings wider and lasts longer. The arc is tilted so it reads as a diagonal cut, high on the sword side.
   * `scale` and `color` are for the blows that are not an ordinary heavy one: the capstone's is twice the size and gold, an echo of a swing is a ghost of it.
   */
  swipe(x: number, z: number, facing: number, heavy = false, scale = heavy ? 1.35 : 1, color?: THREE.Color, peak = 0.5) {
    const s = this.grab(this.pool, this.geo, 0.55);
    s.mat.color.copy(color ?? this.tint);
    s.age = 0; s.dur = heavy ? 0.28 : 0.2; s.from = facing + 1.1; s.turn = 2.2; s.peak = peak;
    s.root.position.set(x, 1.25, z);
    s.root.scale.setScalar(scale);
    s.root.rotation.y = s.from;
    s.root.visible = true;
  }

  /** The body's full turn: a ring at hip height, `radius` across, that the blade sweeps round once. For the 360 degree blows (Whirlwind, Shockwave, Bloodbath). */
  spin(x: number, z: number, facing: number, radius: number, color?: THREE.Color) {
    const s = this.grab(this.spins, this.spinGeo, 0.22);
    s.mat.color.copy(color ?? this.tint);
    s.age = 0; s.dur = 0.3; s.from = facing + 1.1; s.turn = Math.PI * 2; s.peak = 0.7;
    s.root.position.set(x, 1.0, z);
    s.root.scale.setScalar(radius);
    s.root.rotation.y = s.from;
    s.root.visible = true;
  }

  update(dt: number) {
    for (const list of [this.pool, this.spins]) for (const s of list) {
      if (s.age >= s.dur) { s.root.visible = false; continue; }
      s.age += dt;
      const k = Math.min(1, s.age / s.dur);
      s.root.rotation.y = s.from - s.turn * (1 - (1 - k) * (1 - k)); // fast out, easing off: the cut
      s.mat.opacity = s.peak * (1 - k) * (1 - k);
    }
  }
}

interface Slash { root: THREE.Group; mat: THREE.MeshBasicMaterial; age: number; dur: number; from: number; turn: number; peak: number }
