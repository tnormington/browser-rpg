// Rendering only: reads GameState, never mutates it.
import * as THREE from 'three';
import { GameState, LANDMARKS, TREES, WORLD_HALF } from './sim';

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

  /** Called once per sim tick so we can interpolate between the last two states. */
  snapshot(s: GameState) {
    this.prev = this.curr;
    this.curr = { x: s.player.x, z: s.player.z };
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
    this.player.position.set(x, 1, z);
    this.player.rotation.y = s.player.facing;

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
    this.camera.lookAt(x, 1.5, z);
    this.renderer.render(this.scene, this.camera);
  }
}
