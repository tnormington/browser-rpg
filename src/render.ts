// Rendering only: reads GameState, never mutates it.
import * as THREE from 'three';
import { GameState, GameEvent, Enemy, LANDMARKS, TREES, WORLD_HALF } from './sim';
import { ENEMY_TYPES } from './sim/data';
import { ITEMS, TIER_COLORS } from './sim/items';

const mesh = (g: THREE.BufferGeometry, color: number) =>
  new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color }));

export class Renderer {
  readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
  private ground: THREE.Mesh;
  private player: THREE.Mesh;
  private marker: THREE.Mesh;
  private prev = { x: 0, z: 0 };
  private curr = { x: 0, z: 0 };
  private raycaster = new THREE.Raycaster();
  private actors = new Map<number, Actor>();
  private selection: THREE.Mesh;
  private shakeMag = 0;
  private levelRing: THREE.Mesh;
  private levelRingAge = 99;
  private castPunch = 0;
  private drops = new Map<number, DropView>();
  private weapon: THREE.Mesh;

  // orbit camera (render-side only; sim never sees it except via input direction)
  yaw = 0;
  pitch = 0.5;
  distance = 10;

  constructor(parent: HTMLElement, s: GameState) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    parent.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x87ceeb);
    this.scene.fog = new THREE.Fog(0x87ceeb, 40, 110);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x556b2f, 1.1));
    const sun = new THREE.DirectionalLight(0xffffee, 1.4);
    sun.position.set(30, 50, 20);
    this.scene.add(sun);

    this.ground = mesh(new THREE.PlaneGeometry(WORLD_HALF * 2, WORLD_HALF * 2).rotateX(-Math.PI / 2), 0x5a8f3c);
    this.scene.add(this.ground);
    this.buildZone();

    this.player = mesh(new THREE.CapsuleGeometry(0.5, 1, 4, 12), 0x3a6ea5);
    this.scene.add(this.player);
    // a nose so facing is visible
    const nose = mesh(new THREE.BoxGeometry(0.2, 0.2, 0.4), 0xffd24a);
    nose.position.set(0, 0.4, 0.5);
    this.player.add(nose);

    // held weapon: colour follows the equipped item's tier, hidden when bare-handed
    this.weapon = mesh(new THREE.BoxGeometry(0.1, 0.1, 1.1), 0xffffff);
    this.weapon.position.set(0.6, 0.3, 0.7);
    this.player.add(this.weapon);

    this.selection = mesh(new THREE.TorusGeometry(1, 0.07, 8, 32).rotateX(Math.PI / 2), 0xff3b3b);
    this.selection.visible = false;
    this.scene.add(this.selection);
    this.levelRing = mesh(new THREE.TorusGeometry(1, 0.1, 8, 40).rotateX(Math.PI / 2), 0xffe14a);
    this.levelRing.visible = false;
    this.scene.add(this.levelRing);
    for (const e of s.enemies) this.addActor(e);

    this.marker = mesh(new THREE.TorusGeometry(0.5, 0.08, 8, 24).rotateX(Math.PI / 2), 0xffe14a);
    this.marker.visible = false;
    this.scene.add(this.marker);

    this.curr.x = this.prev.x = s.player.x;
    this.curr.z = this.prev.z = s.player.z;
    addEventListener('resize', () => this.resize());
    this.resize();
  }

  private buildZone() {
    const add = (m: THREE.Object3D, x: number, y: number, z: number) => { m.position.set(x, y, z); this.scene.add(m); return m; };

    // clearing: pale dirt disc
    const c = LANDMARKS.clearing;
    add(mesh(new THREE.CylinderGeometry(c.r, c.r, 0.05, 40), 0xb59b6a), c.x, 0.03, c.z);

    // forge: stone hut, chimney, glowing furnace, anvil
    const f = LANDMARKS.forge;
    add(mesh(new THREE.BoxGeometry(4, 2.5, 3), 0x777777), f.x, 1.25, f.z);
    add(mesh(new THREE.BoxGeometry(1, 2, 1), 0x555555), f.x + 1, 3.4, f.z);
    add(mesh(new THREE.BoxGeometry(1.2, 1, 0.1), 0xff6a1a), f.x - 1, 1, f.z + 1.55);
    add(mesh(new THREE.BoxGeometry(0.8, 0.6, 0.5), 0x222222), f.x - 3, 0.3, f.z + 2);
    add(new THREE.PointLight(0xff7a2a, 30, 12), f.x - 1, 1.2, f.z + 2.5);

    // cave mouth: dark opening between rocks, facing +z
    const k = LANDMARKS.caveMouth;
    add(mesh(new THREE.DodecahedronGeometry(3), 0x666a70), k.x - 3, 2, k.z - 2);
    add(mesh(new THREE.DodecahedronGeometry(3), 0x666a70), k.x + 3, 2, k.z - 2);
    add(mesh(new THREE.DodecahedronGeometry(3.4), 0x5c6066), k.x, 3.6, k.z - 3.5);
    add(mesh(new THREE.BoxGeometry(3.2, 3, 0.3), 0x050505), k.x, 1.5, k.z - 1.4);

    for (const t of TREES) {
      add(mesh(new THREE.CylinderGeometry(0.25, 0.35, 2, 8), 0x6b4a2b), t.x, 1, t.z);
      add(mesh(new THREE.ConeGeometry(1.4, 3.5, 8), 0x2f6b2f), t.x, 3.5, t.z);
    }

    // boundary: ring of boulders along the edge
    for (let i = -WORLD_HALF; i <= WORLD_HALF; i += 3) {
      for (const [x, z] of [[i, -WORLD_HALF], [i, WORLD_HALF], [-WORLD_HALF, i], [WORLD_HALF, i]]) {
        add(mesh(new THREE.DodecahedronGeometry(1.6), 0x777b80), x, 0.8, z);
      }
    }
    // beyond the boundary: dark ground so the edge reads as the end of the world
    add(mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), 0x2d4a22), 0, -0.05, 0);
  }

  private resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  orbit(dx: number, dy: number) {
    this.yaw -= dx * 0.005;
    this.pitch = Math.max(0.1, Math.min(1.4, this.pitch + dy * 0.005));
  }

  zoom(delta: number) {
    this.distance = Math.max(3, Math.min(20, this.distance + delta * 0.01));
  }

  private addActor(e: Enemy) {
    const def = ENEMY_TYPES[e.type];
    const color = e.type === 'boar' ? 0x8a5a3a : e.type === 'wolf' ? 0x777c88 : 0x8a2f2f;
    const group = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color });
    const body = new THREE.Mesh(
      e.type === 'brute' ? new THREE.BoxGeometry(1.6, 2.2, 1.2) : new THREE.CapsuleGeometry(def.radius * 0.8, def.radius * 1.2, 4, 10).rotateX(Math.PI / 2),
      mat);
    body.position.y = e.type === 'brute' ? 1.5 : def.radius + 0.2;
    body.userData.enemyId = e.id;
    group.add(body);
    // snout/fist so facing is readable
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.5), new THREE.MeshLambertMaterial({ color: 0xffd24a }));
    nose.position.set(0, body.position.y + 0.1, def.radius + 0.4);
    nose.userData.enemyId = e.id;
    group.add(nose);
    group.scale.setScalar(1);
    this.scene.add(group);
    this.actors.set(e.id, { group, body, mat, base: color, px: e.x, pz: e.z, cx: e.x, cz: e.z, flash: 0 });
  }

  /** Called once per sim tick so we can interpolate between the last two states. */
  snapshot(s: GameState) {
    this.prev = this.curr;
    this.curr = { x: s.player.x, z: s.player.z };
    for (const e of s.enemies) {
      const a = this.actors.get(e.id)!;
      const jump = Math.hypot(e.x - a.cx, e.z - a.cz) > 4; // respawn teleport: don't slide
      a.px = jump ? e.x : a.cx; a.pz = jump ? e.z : a.cz;
      a.cx = e.x; a.cz = e.z;
    }
  }

  /** Reacts to sim events (shake, flashes, level-up ring). Reads only. */
  onEvents(events: GameEvent[], s: GameState) {
    for (const ev of events) {
      if (ev.t === 'hit') {
        if (ev.target === 'player') this.shakeMag = Math.max(this.shakeMag, 0.12);
        else this.shakeMag = Math.max(this.shakeMag, ev.crit ? 0.2 : ev.slot === 1 ? 0.14 : 0.04);
      } else if (ev.t === 'cast') this.castPunch = 0.12;
      else if (ev.t === 'levelup') { this.levelRingAge = 0; this.shakeMag = Math.max(this.shakeMag, 0.1); }
      else if (ev.t === 'death') this.shakeMag = 0.3;
    }
    void s;
  }

  /** Enemy id under a screen position, or null. */
  pickEnemy(clientX: number, clientY: number): number | null {
    this.raycaster.setFromCamera(
      new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1), this.camera);
    const bodies = [...this.actors.values()].filter(a => a.group.visible).flatMap(a => a.group.children);
    const hit = this.raycaster.intersectObjects(bodies, false)[0];
    return hit ? (hit.object.userData.enemyId as number) : null;
  }

  /** Ground-drop id under a screen position, or null. Drops are generous to click. */
  pickDrop(clientX: number, clientY: number): number | null {
    this.raycaster.setFromCamera(
      new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1), this.camera);
    const hit = this.raycaster.intersectObjects([...this.drops.values()].map(d => d.hit), false)[0];
    return hit ? (hit.object.userData.dropId as number) : null;
  }

  /** World point to screen pixels; null when behind the camera. */
  project(x: number, y: number, z: number): { x: number; y: number } | null {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    if (v.z > 1) return null;
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
  }

  /** Ground point under a screen position, or null. */
  pick(clientX: number, clientY: number): { x: number; z: number } | null {
    this.raycaster.setFromCamera(
      new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1), this.camera);
    const hit = this.raycaster.intersectObject(this.ground)[0];
    return hit ? { x: hit.point.x, z: hit.point.z } : null;
  }

  draw(s: GameState, alpha: number) {
    const x = this.prev.x + (this.curr.x - this.prev.x) * alpha;
    const z = this.prev.z + (this.curr.z - this.prev.z) * alpha;
    this.castPunch = Math.max(0, this.castPunch - 1 / 60);
    this.player.position.set(x, s.player.dead ? 0.5 : 1, z);
    this.player.rotation.y = s.player.facing;
    this.player.rotation.x = s.player.dead ? -Math.PI / 2 : 0;
    this.player.scale.setScalar(1 + this.castPunch * 1.2);

    for (const e of s.enemies) this.drawActor(e, alpha);
    this.drawDrops(s);
    const w = s.player.equipment.weapon;
    this.weapon.visible = !!w;
    if (w) (this.weapon.material as THREE.MeshLambertMaterial).color.setHex(TIER_COLORS[ITEMS[w].tier]);

    const target = s.targetId === null ? undefined : s.enemies.find(e => e.id === s.targetId);
    this.selection.visible = !!target;
    if (target) {
      const a = this.actors.get(target.id)!;
      const r = ENEMY_TYPES[target.type].radius + 0.5 + 0.05 * Math.sin(performance.now() / 120);
      this.selection.position.set(a.px + (a.cx - a.px) * alpha, 0.12, a.pz + (a.cz - a.pz) * alpha);
      this.selection.scale.setScalar(r);
      this.selection.rotation.y = performance.now() / 600;
    }

    this.levelRingAge += 1 / 60;
    this.levelRing.visible = this.levelRingAge < 1;
    if (this.levelRing.visible) {
      this.levelRing.position.set(x, 0.15 + this.levelRingAge * 3, z);
      this.levelRing.scale.setScalar(1 + this.levelRingAge * 3);
    }

    this.marker.visible = !!s.moveTarget;
    if (s.moveTarget) {
      this.marker.position.set(s.moveTarget.x, 0.1, s.moveTarget.z);
      this.marker.scale.setScalar(1 + 0.15 * Math.sin(performance.now() / 150));
    }

    // orbit camera; y clamped above ground so it never clips through
    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      x + Math.sin(this.yaw) * cp * this.distance,
      Math.max(0.5, 1.5 + Math.sin(this.pitch) * this.distance),
      z + Math.cos(this.yaw) * cp * this.distance);
    this.shakeMag *= 0.88;
    if (this.shakeMag > 0.005) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeMag;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeMag;
    }
    this.camera.lookAt(x, 1.5, z);
    this.renderer.render(this.scene, this.camera);
  }

  /** Sync ground-drop meshes with sim state: bobbing gem + a light beam for good items. */
  private drawDrops(s: GameState) {
    const live = new Set<number>();
    const now = performance.now() / 1000;
    for (const d of s.drops) {
      live.add(d.id);
      let v = this.drops.get(d.id);
      if (!v) {
        const def = ITEMS[d.item], color = TIER_COLORS[def.tier];
        const group = new THREE.Group();
        const gem = mesh(def.slot ? new THREE.OctahedronGeometry(0.35) : new THREE.BoxGeometry(0.4, 0.4, 0.4), color);
        (gem.material as THREE.MeshLambertMaterial).emissive.setHex(color).multiplyScalar(0.5);
        gem.position.y = 0.6;
        group.add(gem);
        if (def.tier >= 2) {
          const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4, 8, 1, true),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35 }));
          beam.position.y = 2;
          group.add(beam);
        }
        const hit = new THREE.Mesh(new THREE.SphereGeometry(1.1, 6, 6), new THREE.MeshBasicMaterial({ visible: false }));
        hit.position.y = 0.6;
        hit.userData.dropId = d.id;
        group.add(hit);
        group.position.set(d.x, 0, d.z);
        this.scene.add(group);
        v = { group, gem, hit };
        this.drops.set(d.id, v);
      }
      v.gem.position.y = 0.6 + 0.12 * Math.sin(now * 3 + d.id);
      v.gem.rotation.y = now * 1.5;
    }
    for (const [id, v] of this.drops) {
      if (live.has(id)) continue;
      this.scene.remove(v.group);
      this.drops.delete(id);
    }
  }

  private drawActor(e: Enemy, alpha: number) {
    const a = this.actors.get(e.id)!;
    const g = a.group;
    g.visible = e.state !== 'dead' || e.deadFor < 2;
    g.position.set(a.px + (a.cx - a.px) * alpha, 0, a.pz + (a.cz - a.pz) * alpha);
    g.rotation.y = e.facing;
    g.rotation.z = e.state === 'dead' ? Math.PI / 2 : 0;
    g.position.y = e.state === 'dead' ? ENEMY_TYPES[e.type].radius : 0;
    g.scale.setScalar(1 + e.swing * 2); // attack lunge
    a.mat.emissive.setHex(e.hitFlash > 0 ? 0xff4444 : 0x000000);
  }
}

interface Actor {
  group: THREE.Group;
  body: THREE.Mesh;
  mat: THREE.MeshLambertMaterial;
  base: number;
  px: number; pz: number; cx: number; cz: number;
  flash: number;
}

interface DropView { group: THREE.Group; gem: THREE.Mesh; hit: THREE.Mesh }
