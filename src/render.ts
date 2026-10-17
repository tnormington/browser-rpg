// Rendering only: reads GameState, never mutates it.
import * as THREE from 'three';
import { GameState, GameEvent, Enemy, LANDMARKS, ResourceNode, WORLD_HALF } from './sim';
import { ENEMY_TYPES } from './sim/data';
import { ITEMS, TIER_COLORS } from './sim/items';
import { NPC, QuestStage } from './sim/quest';
import { Particles, Rings } from './fx';
import { BOULDERS_PER_FACTOR, ringPoints } from './sim/stress';

type Mat = THREE.MeshStandardMaterial;
/** Roughness / metalness per material class. */
const MATERIALS = {
  ground: [0.95, 0], dirt: [0.98, 0], foliage: [0.85, 0], wood: [0.8, 0], rock: [0.9, 0], stone: [0.85, 0],
  metal: [0.4, 0.9], ore: [0.55, 0.6], coal: [0.3, 0.1], cloth: [0.9, 0], skin: [0.6, 0], hide: [0.92, 0],
  gem: [0.3, 0.2], glow: [0.6, 0], dark: [1, 0],
} as const;
type MatClass = keyof typeof MATERIALS;

const material = (color: number, cls: MatClass): Mat => {
  const [roughness, metalness] = MATERIALS[cls];
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
};
const mesh = (g: THREE.BufferGeometry, color: number, cls: MatClass, shadow: 'cast' | 'receive' | 'both' | 'none' = 'both') => {
  const m = new THREE.Mesh(g, material(color, cls));
  m.castShadow = shadow === 'cast' || shadow === 'both';
  m.receiveShadow = shadow === 'receive' || shadow === 'both';
  return m;
};

// Directional light sits at a fixed offset from its shadow target and follows the player, so the shadow frustum stays tight.
const SUN_OFFSET = new THREE.Vector3(30, 50, 20);
const SHADOW_EXTENT = 28, SHADOW_MAP = 2048;

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
  private nodes = new Map<number, NodeView>();
  private forgeParts: THREE.Object3D[] = [];
  private npcParts: THREE.Object3D[] = [];
  private npcMarker!: THREE.Sprite;
  private markerTex!: Record<'offer' | 'ready' | 'wait', THREE.Texture>;
  private particles = new Particles();
  private rings: Rings;
  private lastDraw = performance.now();
  private sun = new THREE.DirectionalLight(0xfff4e0, 2.2);

  // orbit camera (render-side only; sim never sees it except via input direction)
  yaw = 0;
  pitch = 0.5;
  distance = 10;

  constructor(parent: HTMLElement, s: GameState) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    parent.appendChild(this.renderer.domElement);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.85;
    this.setupSky();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x556b2f, 0.12));
    this.setupSun();

    this.ground = mesh(new THREE.PlaneGeometry(WORLD_HALF * 2, WORLD_HALF * 2).rotateX(-Math.PI / 2), 0x5a8f3c, 'ground', 'receive');
    this.scene.add(this.ground);
    this.buildZone();
    this.rings = new Rings(this.scene);
    this.scene.add(this.particles.points);
    this.buildNpc();

    this.player = mesh(new THREE.CapsuleGeometry(0.5, 1, 4, 12), 0x3a6ea5, 'cloth', 'cast');
    this.scene.add(this.player);
    // a nose so facing is visible
    const nose = mesh(new THREE.BoxGeometry(0.2, 0.2, 0.4), 0xffd24a, 'skin', 'cast');
    nose.position.set(0, 0.4, 0.5);
    this.player.add(nose);

    // held weapon: colour follows the equipped item's tier, hidden when bare-handed
    this.weapon = mesh(new THREE.BoxGeometry(0.1, 0.1, 1.1), 0xffffff, 'metal', 'cast');
    this.weapon.position.set(0.6, 0.3, 0.7);
    this.player.add(this.weapon);

    this.selection = mesh(new THREE.TorusGeometry(1, 0.07, 8, 32).rotateX(Math.PI / 2), 0xff3b3b, 'glow', 'none');
    this.selection.visible = false;
    this.scene.add(this.selection);
    this.levelRing = mesh(new THREE.TorusGeometry(1, 0.1, 8, 40).rotateX(Math.PI / 2), 0xffe14a, 'glow', 'none');
    this.levelRing.visible = false;
    this.scene.add(this.levelRing);
    for (const e of s.enemies) this.addActor(e);
    for (const n of s.nodes) this.addNode(n);

    this.marker = mesh(new THREE.TorusGeometry(0.5, 0.08, 8, 24).rotateX(Math.PI / 2), 0xffe14a, 'glow', 'none');
    this.marker.visible = false;
    this.scene.add(this.marker);

    this.curr.x = this.prev.x = s.player.x;
    this.curr.z = this.prev.z = s.player.z;
    addEventListener('resize', () => this.resize());
    this.resize();
  }

  /** Gradient sky baked once through PMREM: background and image-based ambient light in one. */
  private setupSky() {
    const horizon = 0xb4d4f0;
    this.scene.fog = new THREE.Fog(horizon, 40, 110);
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: {
        zenith: { value: new THREE.Color(0x3a78c8) }, horizon: { value: new THREE.Color(horizon) },
        ground: { value: new THREE.Color(0x6a7f55) }, sun: { value: SUN_OFFSET.clone().normalize() },
      },
      vertexShader: 'varying vec3 d; void main() { d = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 zenith, horizon, ground, sun; varying vec3 d;
        void main() {
          vec3 n = normalize(d);
          vec3 c = mix(horizon, zenith, pow(clamp(n.y, 0.0, 1.0), 0.5));
          c = mix(c, ground, smoothstep(0.0, -0.25, n.y));
          c += vec3(1.0, 0.85, 0.6) * pow(max(dot(n, sun), 0.0), 48.0) * 1.5; // soft sun glow
          gl_FragColor = vec4(c, 1.0);
        }`,
    }));
    const skyScene = new THREE.Scene();
    skyScene.add(sky);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const rt = pmrem.fromScene(skyScene);
    this.scene.environment = this.scene.background = rt.texture;
    this.scene.environmentIntensity = 1.0;
    this.scene.backgroundIntensity = 1.3;
    pmrem.dispose();
  }

  private setupSun() {
    const sun = this.sun;
    sun.position.copy(SUN_OFFSET);
    this.scene.add(sun, sun.target);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    sun.castShadow = true;
    sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    const c = sun.shadow.camera;
    c.left = c.bottom = -SHADOW_EXTENT; c.right = c.top = SHADOW_EXTENT;
    c.near = 10; c.far = 120;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  }

  /** Re-centre the shadow frustum on the player, snapped to shadow-texel steps so shadows do not swim as it moves. */
  private followSun(x: number, z: number) {
    const dir = SUN_OFFSET.clone().normalize();
    const right = new THREE.Vector3(0, 1, 0).cross(dir).normalize(), up = dir.clone().cross(right);
    const target = new THREE.Vector3(x, 0, z), texel = (2 * SHADOW_EXTENT) / SHADOW_MAP;
    const a = target.dot(right), b = target.dot(up);
    target.addScaledVector(right, Math.round(a / texel) * texel - a).addScaledVector(up, Math.round(b / texel) * texel - b);
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).add(SUN_OFFSET);
  }

  private buildZone() {
    const add = (m: THREE.Object3D, x: number, y: number, z: number) => { m.position.set(x, y, z); this.scene.add(m); return m; };

    // clearing: pale dirt disc
    const c = LANDMARKS.clearing;
    add(mesh(new THREE.CylinderGeometry(c.r, c.r, 0.05, 40), 0xb59b6a, 'dirt', 'receive'), c.x, 0.03, c.z);

    // forge: stone hut, chimney, glowing furnace, anvil
    const f = LANDMARKS.forge;
    this.forgeParts.push(
      add(mesh(new THREE.BoxGeometry(4, 2.5, 3), 0x777777, 'stone'), f.x, 1.25, f.z),
      add(mesh(new THREE.BoxGeometry(1, 2, 1), 0x555555, 'stone'), f.x + 1, 3.4, f.z),
      add(mesh(new THREE.BoxGeometry(1.2, 1, 0.1), 0xff6a1a, 'glow', 'receive'), f.x - 1, 1, f.z + 1.55),
      add(mesh(new THREE.BoxGeometry(0.8, 0.6, 0.5), 0x222222, 'metal'), f.x - 3, 0.3, f.z + 2));
    add(new THREE.PointLight(0xff7a2a, 30, 12), f.x - 1, 1.2, f.z + 2.5);

    // cave mouth: dark opening between rocks, facing +z
    const k = LANDMARKS.caveMouth;
    add(mesh(new THREE.DodecahedronGeometry(3), 0x666a70, 'rock'), k.x - 3, 2, k.z - 2);
    add(mesh(new THREE.DodecahedronGeometry(3), 0x666a70, 'rock'), k.x + 3, 2, k.z - 2);
    add(mesh(new THREE.DodecahedronGeometry(3.4), 0x5c6066, 'rock'), k.x, 3.6, k.z - 3.5);
    add(mesh(new THREE.BoxGeometry(3.2, 3, 0.3), 0x050505, 'dark', 'receive'), k.x, 1.5, k.z - 1.4);

    // boundary: ring of boulders along the edge
    for (let i = -WORLD_HALF; i <= WORLD_HALF; i += 3) {
      for (const [x, z] of [[i, -WORLD_HALF], [i, WORLD_HALF], [-WORLD_HALF, i], [WORLD_HALF, i]]) {
        add(mesh(new THREE.DodecahedronGeometry(1.6), 0x777b80, 'rock'), x, 0.8, z);
      }
    }
    // dev stress only (?stress=N): scatter extra decorative boulders so boulder count scales with N like everything else
    if (WORLD_HALF > 30) {
      const factor = (WORLD_HALF / 30) ** 2, ring = Math.ceil(2 * WORLD_HALF / 3 + 1) * 4;
      const pts = ringPoints({ rng: 777 }, WORLD_HALF, 30, 3);
      for (let i = ring; i < Math.round(BOULDERS_PER_FACTOR * factor); i++) { const p = pts.next().value!; add(mesh(new THREE.DodecahedronGeometry(1.6), 0x777b80, 'rock'), p.x, 0.8, p.z); }
    }
    // beyond the boundary: dark ground so the edge reads as the end of the world
    add(mesh(new THREE.PlaneGeometry(Math.max(400, WORLD_HALF * 4), Math.max(400, WORLD_HALF * 4)).rotateX(-Math.PI / 2), 0x2d4a22, 'ground', 'receive'), 0, -0.05, 0);
  }

  /** Quest giver: robed figure with a hood and staff, and a bobbing ! / ? marker above. */
  private buildNpc() {
    const group = new THREE.Group();
    group.position.set(NPC.x, 0, NPC.z);
    group.rotation.y = Math.atan2(0 - NPC.x, 6 - NPC.z); // faces the spawn point
    const part = (g: THREE.BufferGeometry, color: number, cls: MatClass, y: number, x = 0, z = 0) => {
      const m = mesh(g, color, cls, 'cast');
      m.position.set(x, y, z);
      group.add(m);
      this.npcParts.push(m);
      return m;
    };
    part(new THREE.ConeGeometry(0.7, 1.7, 10), 0x7a3a8a, 'cloth', 0.85);
    part(new THREE.SphereGeometry(0.3, 12, 10), 0xe0b890, 'skin', 1.95);
    part(new THREE.ConeGeometry(0.34, 0.5, 10), 0x5a2a6a, 'cloth', 2.3);
    part(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6), 0x6b4a2b, 'wood', 1.3, 0.7, 0.15);
    part(new THREE.SphereGeometry(0.14, 8, 8), 0x6ad8ff, 'gem', 2.7, 0.7, 0.15);
    this.scene.add(group);

    const tex = (ch: string, color: string) => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d')!;
      g.font = 'bold 56px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 6; g.strokeStyle = '#000'; g.strokeText(ch, 32, 34);
      g.fillStyle = color; g.fillText(ch, 32, 34);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace; // canvas pixels are sRGB: without this the ! / ? read washed out
      return t;
    };
    this.markerTex = { offer: tex('!', '#ffe14a'), ready: tex('?', '#ffe14a'), wait: tex('?', '#9a9a9a') };
    this.npcMarker = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.markerTex.offer, depthTest: false }));
    this.npcMarker.scale.set(1.1, 1.1, 1);
    this.npcMarker.renderOrder = 10;
    this.scene.add(this.npcMarker);
  }

  private markerFor(stage: QuestStage): 'offer' | 'ready' | 'wait' | null {
    if (stage === 'offer') return 'offer';
    if (stage === 'report1' || stage === 'report2') return 'ready';
    return stage === 'done' ? null : 'wait';
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

  private addNode(n: ResourceNode) {
    const group = new THREE.Group();
    group.position.set(n.x, 0, n.z);
    group.userData.nodeId = n.id;
    let crown: THREE.Mesh | undefined;
    const mats: Mat[] = [];
    const part = (g: THREE.BufferGeometry, color: number, cls: MatClass, y: number) => {
      const m = mesh(g, color, cls);
      m.position.y = y;
      group.add(m);
      mats.push(m.material as Mat);
      return m;
    };
    if (n.type === 'tree') {
      part(new THREE.CylinderGeometry(0.25, 0.35, 2, 8), 0x6b4a2b, 'wood', 1);
      crown = part(new THREE.ConeGeometry(1.4, 3.5, 8), 0x2f6b2f, 'foliage', 3.5);
    } else {
      const coal = n.type === 'coal';
      part(new THREE.DodecahedronGeometry(1.3), coal ? 0x2b2b30 : 0x7a7f86, 'rock', 0.9);
      // ore flecks: rust for iron, glossy black for coal
      for (const [dx, dy, dz] of [[0.7, 1.2, 0.6], [-0.6, 1.0, 0.8], [0.1, 1.6, -0.5]]) {
        const fleck = part(new THREE.OctahedronGeometry(0.28), coal ? 0x111114 : 0xc9733a, coal ? 'coal' : 'ore', dy);
        fleck.position.x = dx; fleck.position.z = dz;
      }
    }
    this.scene.add(group);
    this.nodes.set(n.id, { group, crown, mats, base: mats.map(m => m.color.getHex()) });
  }

  private drawNodes(s: GameState) {
    const now = performance.now() / 1000;
    const active = s.player.action?.k === 'gather' ? s.player.action.nodeId : -1;
    for (const n of s.nodes) {
      const v = this.nodes.get(n.id)!;
      const depleted = n.charges <= 0;
      if (v.crown) v.crown.visible = !depleted; // a felled tree leaves a stump
      else v.group.scale.setScalar(depleted ? 0.4 : 1);
      v.mats.forEach((m, i) => m.color.setHex(depleted && !v.crown ? 0x3a3a3a : v.base[i]));
      v.group.rotation.z = n.id === active ? Math.sin(now * 18) * 0.05 : 0;
    }
  }

  private addActor(e: Enemy) {
    const def = ENEMY_TYPES[e.type];
    const color = e.type === 'boar' ? 0x8a5a3a : e.type === 'wolf' ? 0x777c88 : 0x8a2f2f;
    const group = new THREE.Group();
    const mat = material(color, 'hide');
    const body = new THREE.Mesh(
      e.type === 'brute' ? new THREE.BoxGeometry(1.6, 2.2, 1.2) : new THREE.CapsuleGeometry(def.radius * 0.8, def.radius * 1.2, 4, 10).rotateX(Math.PI / 2),
      mat);
    body.castShadow = body.receiveShadow = true;
    body.position.y = e.type === 'brute' ? 1.5 : def.radius + 0.2;
    body.userData.enemyId = e.id;
    group.add(body);
    // snout/fist so facing is readable
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.5), material(0xffd24a, 'skin'));
    nose.castShadow = true;
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
        if (ev.target === 'player') {
          this.shakeMag = Math.max(this.shakeMag, 0.12);
          this.particles.burst(ev.x, 1.2, ev.z, { color: [0xff3030, 0xff7050], count: 12, speed: 4, life: 0.5 });
        } else {
          this.shakeMag = Math.max(this.shakeMag, ev.crit ? 0.2 : ev.slot === 1 ? 0.14 : 0.04);
          this.impact(s, ev);
        }
      } else if (ev.t === 'cast') this.castPunch = 0.12;
      else if (ev.t === 'heal') {
        this.particles.burst(ev.x, 0.4, ev.z, { color: [0x5aff7a, 0xbaffc8], count: 24, speed: 1.6, up: 3.5, gravity: -1, life: 1 });
        this.rings.pulse(ev.x, 0.15, ev.z, 0x5aff7a, 2.2, 0.6);
      } else if (ev.t === 'levelup') {
        this.levelRingAge = 0;
        this.shakeMag = Math.max(this.shakeMag, 0.1);
        const p = s.player;
        this.particles.burst(p.x, 0.3, p.z, { color: [0xffe14a, 0xffffff, 0xffa030], count: 70, speed: 3, up: 8, gravity: -6, life: 1.4 });
        this.rings.pulse(p.x, 0.2, p.z, 0xffe14a, 4, 0.9);
      } else if (ev.t === 'kill') {
        const type = s.enemies.find(e => e.id === ev.id)!.type, big = type === 'brute';
        this.particles.burst(ev.x, 0.8, ev.z, { color: [0xbbbbbb, 0x888888, 0xff9a4a], count: big ? 70 : 32, speed: big ? 6 : 4, up: 2, life: 0.9 });
        this.rings.pulse(ev.x, 0.15, ev.z, 0xffffff, big ? 5 : 2.5, 0.5);
        if (big) this.shakeMag = Math.max(this.shakeMag, 0.35);
      } else if (ev.t === 'drop') {
        this.particles.burst(ev.x, 0.6, ev.z, { color: TIER_COLORS[ITEMS[ev.item].tier], count: 14, speed: 1.5, up: 3, gravity: -5, life: 0.8 });
      } else if (ev.t === 'loot') {
        this.particles.burst(s.player.x, 1.6, s.player.z, { color: [0x8affc0, 0xffffff], count: 12, speed: 1.2, up: 2.5, gravity: -3, life: 0.7 });
      } else if (ev.t === 'depleted') {
        const n = s.nodes.find(x => x.id === ev.id)!;
        this.particles.burst(n.x, 1, n.z, { color: n.type === 'tree' ? [0x2f6b2f, 0x6b4a2b] : [0x888888, 0x555555], count: 24, speed: 3, up: 1, life: 0.8 });
      } else if (ev.t === 'crafted') {
        const f = LANDMARKS.forge;
        this.particles.burst(f.x - 3, 0.9, f.z + 2, { color: [0xffb040, 0xff6a1a, 0xffffff], count: 50, speed: 5, up: 4, life: 0.9 });
        this.rings.pulse(f.x - 3, 0.3, f.z + 2, 0xff9a3a, 3, 0.6);
      } else if (ev.t === 'quest') {
        const p = s.player;
        if (ev.what === 'complete') this.fireworks(p.x, p.z);
        else this.particles.burst(p.x, 1, p.z, { color: [0x6ad8ff, 0xffffff], count: 26, speed: 2, up: 4, gravity: -3, life: 1 });
      } else if (ev.t === 'death') {
        this.shakeMag = 0.3;
        this.particles.burst(s.player.x, 1, s.player.z, { color: [0xff2020, 0x701010], count: 50, speed: 5, up: 3, life: 1.1 });
      }
    }
  }

  /** Ability-specific hit feedback: each of the four reads differently at a glance. */
  private impact(s: GameState, ev: Extract<GameEvent, { t: 'hit' }>) {
    const p = s.player, y = 1.2;
    if (ev.dot) return void this.particles.burst(ev.x, y, ev.z, { color: 0xd070ff, count: 5, speed: 1.5, up: 1, life: 0.4 });
    if (ev.slot === 1) {
      this.particles.burst(ev.x, 0.5, ev.z, { color: [0xff8a1a, 0xffd24a, 0xffffff], count: 36, speed: 6, up: 3, life: 0.7 });
      this.rings.pulse(ev.x, 0.15, ev.z, 0xff8a1a, 3.2, 0.4);
    } else if (ev.slot === 2) {
      this.particles.trail(p.x, 1.4, p.z, ev.x, y, ev.z, 0xd070ff);
      this.particles.burst(ev.x, y, ev.z, { color: [0xd070ff, 0xffffff], count: 16, speed: 3, life: 0.5 });
    } else {
      this.particles.burst(ev.x, y, ev.z, { color: [0xffffff, 0xffe9a0], count: 10, speed: 4, life: 0.35 });
    }
    if (ev.crit) this.particles.burst(ev.x, y + 0.4, ev.z, { color: [0xffd24a, 0xffffff], count: 20, speed: 5, up: 2, life: 0.6 });
  }

  /** Quest-complete fanfare: staggered coloured bursts over the player. */
  private fireworks(x: number, z: number) {
    const palettes = [[0xff4a4a, 0xffa0a0], [0x4aff7a, 0xa0ffc0], [0x4ab0ff, 0xa0d8ff], [0xffe14a, 0xffffff], [0xd070ff, 0xffffff]];
    palettes.forEach((pal, i) => setTimeout(() => {
      const a = (i / palettes.length) * Math.PI * 2;
      this.particles.burst(x + Math.cos(a) * 3, 6 + (i % 2) * 2, z + Math.sin(a) * 3, { color: pal, count: 50, speed: 5, gravity: -3, life: 1.6 });
    }, i * 220));
    this.rings.pulse(x, 0.2, z, 0xffe14a, 6, 1.2);
    this.shakeMag = Math.max(this.shakeMag, 0.12);
  }

  /** True when the click lands on the quest giver. */
  pickNpc(clientX: number, clientY: number): boolean {
    this.raycaster.setFromCamera(
      new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1), this.camera);
    return this.raycaster.intersectObjects([...this.npcParts, this.npcMarker], false).length > 0;
  }

  /** Enemy id under a screen position, or null. */
  pickEnemy(clientX: number, clientY: number): number | null {
    this.raycaster.setFromCamera(
      new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1), this.camera);
    const bodies = [...this.actors.values()].filter(a => a.group.visible).flatMap(a => a.group.children);
    const hit = this.raycaster.intersectObjects(bodies, false)[0];
    return hit ? (hit.object.userData.enemyId as number) : null;
  }

  /** Gatherable node id under a screen position, or null. */
  pickNode(clientX: number, clientY: number): number | null {
    this.raycaster.setFromCamera(
      new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1), this.camera);
    const hit = this.raycaster.intersectObjects([...this.nodes.values()].map(n => n.group), true)[0];
    for (let o: THREE.Object3D | null = hit?.object ?? null; o; o = o.parent) if (o.userData.nodeId !== undefined) return o.userData.nodeId as number;
    return null;
  }

  /** True when the click lands on the forge building. */
  pickForge(clientX: number, clientY: number): boolean {
    this.raycaster.setFromCamera(
      new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1), this.camera);
    return this.raycaster.intersectObjects(this.forgeParts, false).length > 0;
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
    const nowMs = performance.now(), dtFx = Math.min(0.1, (nowMs - this.lastDraw) / 1000);
    this.lastDraw = nowMs;
    this.particles.update(dtFx);
    this.rings.update(dtFx);
    const mk = this.markerFor(s.quest.stage);
    this.npcMarker.visible = !!mk;
    if (mk) {
      (this.npcMarker.material as THREE.SpriteMaterial).map = this.markerTex[mk];
      this.npcMarker.position.set(NPC.x, 3.5 + 0.18 * Math.sin(nowMs / 250), NPC.z);
    }
    this.player.position.set(x, s.player.dead ? 0.5 : 1, z);
    this.player.rotation.y = s.player.facing;
    this.player.rotation.x = s.player.dead ? -Math.PI / 2 : 0;
    this.player.scale.setScalar(1 + this.castPunch * 1.2);

    for (const e of s.enemies) this.drawActor(e, alpha);
    this.drawDrops(s);
    this.drawNodes(s);
    const w = s.player.equipment.weapon;
    this.weapon.visible = !!w;
    if (w) (this.weapon.material as Mat).color.setHex(TIER_COLORS[ITEMS[w].tier]);

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
    this.followSun(x, z);
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
        const gem = mesh(def.slot ? new THREE.OctahedronGeometry(0.35) : new THREE.BoxGeometry(0.4, 0.4, 0.4), color, 'gem', 'cast');
        (gem.material as Mat).emissive.setHex(color).multiplyScalar(0.5);
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
    g.scale.setScalar(e.state === 'dead' ? Math.max(0.05, 1 - e.deadFor / 2) : 1 + e.swing * 2); // attack lunge / shrink away when dead
    a.mat.emissive.setHex(e.hitFlash > 0 ? 0xff4444 : 0x000000);
  }
}

interface Actor {
  group: THREE.Group;
  body: THREE.Mesh;
  mat: Mat;
  base: number;
  px: number; pz: number; cx: number; cz: number;
  flash: number;
}

interface NodeView { group: THREE.Group; crown?: THREE.Mesh; mats: Mat[]; base: number[] }
interface DropView { group: THREE.Group; gem: THREE.Mesh; hit: THREE.Mesh }
