// The world map: one low-detail scene of the whole land (towns on a chain of roads, hills, trees, sea), built once from the towns' world-map
// positions (sim/world.ts TOWNS) and used twice (docs/world-design.md 5.3): the map screen looks straight down at it, and the flight ride
// follows a bird across it on rails. It knows nothing about the game's own scene: Renderer draws it instead of that scene while either is up.
// Rendering only. Adding a town to TOWNS grows the land, the road and the markers with no change here.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TOWNS } from './sim/world';

/** The game's palette (render.ts PALETTE): drained greens, slate and a cold sea, with the saturation spent on gold light and arcane blue. */
const C = { grass: 0x3a4336, grassAlt: 0x465040, sand: 0x6b6654, slate: 0x4b525b, sea: 0x1b2c3a, road: 0x7a735f, pine: 0x35493a, wall: 0x6c675c, roof: 0x3c4750,
  gold: 0xffc84a, cold: 0x59626d, arcane: 0x6ad8ff, sky: 0x141a22, hemiSky: 0x4a5a74, hemiGround: 0x161b22, moon: 0xa9b8cc, bird: 0xd9ceb2 } as const;

const MARGIN = 520;            // land and sea beyond the outermost towns
const STEP = 24;               // terrain grid cell
const SEA_Y = 0;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smooth = (t: number) => t * t * (3 - 2 * t);
const hash = (i: number, j: number) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
function vnoise(x: number, z: number) {
  const i = Math.floor(x), j = Math.floor(z), u = smooth(x - i), v = smooth(z - j), l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(l(hash(i, j), hash(i + 1, j), u), l(hash(i, j + 1), hash(i + 1, j + 1), u), v);
}
const fbm = (x: number, z: number) => 0.5 * vnoise(x / 260, z / 260) + 0.3 * vnoise(x / 110 + 9, z / 110) + 0.2 * vnoise(x / 45, z / 45 + 4);

/** Where the player is on the map: between the two nearest towns, in proportion to how far from each (the road is the only way between). */
export function mapPosition(x: number, z: number): { x: number; z: number } {
  const ranked = TOWNS.map(t => ({ t, d: Math.hypot(x - t.wake.x, z - t.wake.z) })).sort((a, b) => a.d - b.d);
  const [a, b] = ranked;
  if (!b) return { ...a.t.map };
  const k = a.d / (a.d + b.d || 1);
  return { x: a.t.map.x + (b.t.map.x - a.t.map.x) * k, z: a.t.map.z + (b.t.map.z - a.t.map.z) * k };
}

const ease = (u: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(u, 0, 1));

export class WorldMap {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(48, 1, 2, 9000);
  private center: THREE.Vector3;
  private size: { w: number; d: number };
  private markers = new Map<string, { group: THREE.Group; pole: THREE.Mesh; gem: THREE.Mesh; at: THREE.Vector3 }>();
  private you: THREE.Mesh;
  private bird = new THREE.Group();
  private wings: THREE.Mesh[] = [];
  private chain: { x: number; z: number }[] = TOWNS.map(t => t.map);
  private foundMat = new THREE.MeshBasicMaterial({ color: C.gold });
  private lostMat = new THREE.MeshBasicMaterial({ color: C.cold });

  constructor() {
    const xs = this.chain.map(p => p.x), zs = this.chain.map(p => p.z);
    const x0 = Math.min(...xs) - MARGIN, x1 = Math.max(...xs) + MARGIN, z0 = Math.min(...zs) - MARGIN, z1 = Math.max(...zs) + MARGIN;
    this.center = new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2);
    this.size = { w: x1 - x0, d: z1 - z0 };

    this.scene.background = new THREE.Color(C.sky);
    this.scene.fog = new THREE.Fog(C.sky, 700, 3000);
    this.scene.add(new THREE.HemisphereLight(C.hemiSky, C.hemiGround, 2.4));
    const moon = new THREE.DirectionalLight(C.moon, 3.2);
    moon.position.set(-600, 900, 500);
    this.scene.add(moon);

    this.scene.add(this.sea(x0, x1, z0, z1), this.terrain(x0, x1, z0, z1), this.roads(), this.scatter(x0, x1, z0, z1));
    for (const t of TOWNS) this.addTown(t.id, t.map.x, t.map.z);
    this.you = new THREE.Mesh(new THREE.ConeGeometry(9, 26, 5).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: C.arcane }));
    this.scene.add(this.you);
    this.buildBird();
    this.scene.add(this.bird);
    this.bird.visible = false;
    this.setFound([]);
  }

  // --- the land -------------------------------------------------------------------------------------------------------------------

  /** Distance to the nearest road (the chain of towns, in order). */
  private roadDist(x: number, z: number) {
    let best = Infinity;
    for (let i = 0; i < this.chain.length; i++) {
      const a = this.chain[i], b = this.chain[Math.min(i + 1, this.chain.length - 1)];
      const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
      const k = l2 ? clamp(((x - a.x) * dx + (z - a.z) * dz) / l2, 0, 1) : 0;
      best = Math.min(best, Math.hypot(x - (a.x + dx * k), z - (a.z + dz * k)));
    }
    return best;
  }
  /** Ground height: land hugging the road, sea elsewhere. */
  private height(x: number, z: number) {
    const reach = 280 + 150 * fbm(x + 700, z - 300), k = clamp((reach - this.roadDist(x, z)) / 90, 0, 1);
    return -7 + smooth(k) * (11 + 40 * fbm(x, z) * k);
  }
  private groundY(x: number, z: number) { return Math.max(this.height(x, z), SEA_Y + 0.4); }

  private sea(x0: number, x1: number, z0: number, z1: number) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry((x1 - x0) * 3, (z1 - z0) * 3).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: C.sea, roughness: 0.45, metalness: 0.1 }));
    m.position.set(this.center.x, SEA_Y, this.center.z);
    return m;
  }

  private terrain(x0: number, x1: number, z0: number, z1: number) {
    const nx = Math.ceil((x1 - x0) / STEP), nz = Math.ceil((z1 - z0) / STEP);
    const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz).rotateX(-Math.PI / 2).translate(this.center.x, 0, this.center.z);
    const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color(), a = new THREE.Color(C.grass), b = new THREE.Color(C.grassAlt),
      sand = new THREE.Color(C.sand), slate = new THREE.Color(C.slate);
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v), z = pos.getZ(v), h = this.height(x, z);
      pos.setY(v, h);
      c.copy(a).lerp(b, hash(Math.round(x / STEP), Math.round(z / STEP)));
      c.lerp(sand, clamp(1 - (h - 0.5) / 3, 0, 1));
      c.lerp(slate, clamp((h - 22) / 14, 0, 1));
      c.toArray(col, v * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
  }

  /** A ribbon along each leg of the chain, a little wandering, lying on the ground. */
  private roads() {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i + 1 < this.chain.length; i++) {
      const a = this.chain[i], b = this.chain[i + 1], len = Math.hypot(b.x - a.x, b.z - a.z), n = Math.ceil(len / 18);
      const nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len, pts: { x: number; z: number }[] = [];
      for (let s = 0; s <= n; s++) {
        const u = s / n, wob = Math.sin(u * 9 + i * 2) * 14 * Math.sin(Math.PI * u);
        pts.push({ x: a.x + (b.x - a.x) * u + nx * wob, z: a.z + (b.z - a.z) * u + nz * wob });
      }
      const verts: number[] = [], idx: number[] = [];
      pts.forEach((p, s) => {
        const q = pts[Math.min(s + 1, n)], r = pts[Math.max(s - 1, 0)], tx = q.x - r.x, tz = q.z - r.z, tl = Math.hypot(tx, tz) || 1, ox = -tz / tl * 4.5, oz = tx / tl * 4.5;
        verts.push(p.x + ox, this.groundY(p.x + ox, p.z + oz) + 0.5, p.z + oz, p.x - ox, this.groundY(p.x - ox, p.z - oz) + 0.5, p.z - oz);
        if (s < n) idx.push(s * 2, s * 2 + 1, s * 2 + 2, s * 2 + 1, s * 2 + 3, s * 2 + 2);
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      g.setIndex(idx);
      parts.push(g);
    }
    const m = new THREE.Mesh(parts.length ? mergeGeometries(parts)! : new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: C.road, roughness: 1, side: THREE.DoubleSide }));
    m.geometry.computeVertexNormals();
    return m;
  }

  /** Pines on the lowland and peaks on the high ground, as two instanced draws. */
  private scatter(x0: number, x1: number, z0: number, z1: number) {
    const g = new THREE.Group(), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3();
    const trees: THREE.Matrix4[] = [], peaks: THREE.Matrix4[] = [];
    const nearTown = (x: number, z: number, r: number) => TOWNS.some(t => Math.hypot(x - t.map.x, z - t.map.z) < r);
    for (let k = 0; k < 2600 && (trees.length < 700 || peaks.length < 36); k++) {
      const x = x0 + hash(k, 1) * (x1 - x0), z = z0 + hash(k, 2) * (z1 - z0), h = this.height(x, z), s = 0.8 + hash(k, 3) * 0.8, rd = this.roadDist(x, z);
      if (h < 2 || nearTown(x, z, 90) || rd < 14) continue;
      if (h > 20 && rd > 110) { // peaks keep off the roads, so the ride and the map see over them
        if (peaks.length < 36) peaks.push(M.clone().compose(V.set(x, h - 4, z), Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(k, 4) * 6), S.set(s, s * (1.1 + hash(k, 5) * 0.6), s)));
      } else if (h <= 24 && trees.length < 700) trees.push(M.clone().compose(V.set(x, h, z), Q.identity(), S.set(s, s, s)));
    }
    const inst = (geo: THREE.BufferGeometry, color: number, list: THREE.Matrix4[]) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 1 }), list.length);
      list.forEach((m, i) => im.setMatrixAt(i, m));
      g.add(im);
    };
    inst(new THREE.ConeGeometry(4, 15, 5).translate(0, 7.5, 0), C.pine, trees);
    inst(new THREE.ConeGeometry(15, 40, 5).translate(0, 20, 0), C.slate, peaks);
    return g;
  }

  // --- towns, the pin and the bird -------------------------------------------------------------------------------------------------

  /** A ring of roofs round a beacon: gold when the town's master has been found, cold iron when it has not. */
  private addTown(id: string, x: number, z: number) {
    const y = this.groundY(x, z), group = new THREE.Group(), houses: THREE.BufferGeometry[] = [], roofs: THREE.BufferGeometry[] = [];
    group.position.set(x, y, z);
    for (let k = 0; k < 9; k++) {
      const a = k * 2.4 + hash(x, k) , r = 14 + hash(k, z) * 22, w = 6 + hash(k, 8) * 5, hx = Math.cos(a) * r, hz = Math.sin(a) * r;
      houses.push(new THREE.BoxGeometry(w, 5, w * 0.8).translate(hx, 2.5, hz));
      roofs.push(new THREE.ConeGeometry(w * 0.85, 4.5, 4).rotateY(Math.PI / 4).translate(hx, 7.2, hz));
    }
    group.add(new THREE.Mesh(mergeGeometries(houses)!, new THREE.MeshStandardMaterial({ color: C.wall, flatShading: true, roughness: 1 })),
      new THREE.Mesh(mergeGeometries(roofs)!, new THREE.MeshStandardMaterial({ color: C.roof, flatShading: true, roughness: 1 })));
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 46, 6).translate(0, 23, 0), this.lostMat);
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(6), this.lostMat);
    gem.position.y = 54;
    group.add(pole, gem);
    this.scene.add(group);
    this.markers.set(id, { group, pole, gem, at: new THREE.Vector3(x, y, z) });
  }

  private buildBird() {
    const mat = new THREE.MeshStandardMaterial({ color: C.bird, flatShading: true, roughness: 0.9 });
    const body = new THREE.Mesh(new THREE.ConeGeometry(1.6, 7, 5).rotateX(Math.PI / 2), mat); // nose toward +z
    const head = new THREE.Mesh(new THREE.SphereGeometry(1.1, 5, 4), mat);
    head.position.set(0, 0.5, 3.6);
    this.bird.add(body, head);
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(9, 0.3, 3.4).translate(side * 4.5, 0, 0), mat);
      wing.userData.side = side;
      this.bird.add(wing);
      this.wings.push(wing);
    }
    this.bird.scale.setScalar(2.2);
  }

  /** Gold beacons for the towns whose master has been found; the rest stay cold and unlit. */
  setFound(found: readonly string[]) {
    for (const [id, m] of this.markers) { const on = found.includes(id); m.pole.material = m.gem.material = on ? this.foundMat : this.lostMat; }
  }

  /** The pin: "you are here". */
  setYou(x: number, z: number, now: number) {
    this.you.position.set(x, this.groundY(x, z) + 60 + 4 * Math.sin(now / 300), z);
  }

  // --- the two shots ---------------------------------------------------------------------------------------------------------------

  /** The map screen: the whole land from above, north (-z) at the top. */
  frameScreen(aspect: number) {
    const cam = this.camera, pitch = THREE.MathUtils.degToRad(72), t = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const dist = Math.max(this.size.w / 2 / (t * aspect), (this.size.d / 2) / t * 0.95) * 1.08;
    this.resetFov();
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    cam.position.set(this.center.x, Math.sin(pitch) * dist, this.center.z + Math.cos(pitch) * dist);
    cam.lookAt(this.center);
    this.bird.visible = false;
    this.you.visible = true;
  }

  /** The ride: the camera trails a bird from one town to the next, `u` through the trip (0 to 1). */
  frameRide(from: string, to: string, u: number, aspect: number, now: number) {
    const a = this.markers.get(from)!.at, b = this.markers.get(to)!.at, e = ease(u), cam = this.camera;
    const dir = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize(), side = new THREE.Vector3(-dir.z, 0, dir.x);
    const lift = 26 + 52 * Math.sin(Math.PI * e);
    const p = new THREE.Vector3(a.x + (b.x - a.x) * e, 0, a.z + (b.z - a.z) * e);
    p.y = this.groundY(p.x, p.z) + lift;
    this.bird.visible = true; this.you.visible = false;
    this.bird.position.copy(p);
    this.bird.lookAt(p.clone().add(dir));
    const flap = Math.sin(now / 140) * 0.55;
    for (const w of this.wings) w.rotation.z = flap * w.userData.side * -1;
    const sway = Math.sin(u * Math.PI * 3) * 34;
    cam.aspect = aspect;
    cam.fov = 58;
    cam.updateProjectionMatrix();
    cam.position.copy(p).addScaledVector(dir, -(120 - 30 * Math.sin(Math.PI * e))).addScaledVector(side, sway).add(new THREE.Vector3(0, 60 + 30 * Math.sin(Math.PI * e), 0));
    cam.position.y = Math.max(cam.position.y, this.groundY(cam.position.x, cam.position.z) + 18);
    cam.lookAt(p.clone().addScaledVector(dir, 60).add(new THREE.Vector3(0, -8, 0)));
  }

  /** Keep the beacons turning and the screen camera's field of view honest after a ride changed it. */
  update(now: number) {
    for (const m of this.markers.values()) m.gem.rotation.y = now / 700;
  }

  resetFov() { if (this.camera.fov !== 48) { this.camera.fov = 48; this.camera.updateProjectionMatrix(); } }

  private toScreen(p: THREE.Vector3): { x: number; y: number } | null {
    const v = p.clone().project(this.camera);
    return v.z > 1 ? null : { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
  }
  /** A town's beacon on screen, in CSS pixels, or null when it is behind the camera. */
  project(id: string) {
    const m = this.markers.get(id);
    return m && this.toScreen(m.at.clone().add(new THREE.Vector3(0, 70, 0)));
  }
  /** The pin on screen. */
  projectYou() { return this.toScreen(this.you.position.clone().add(new THREE.Vector3(0, 22, 0))); }
}
