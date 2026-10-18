// Rendering only: reads GameState, never mutates it.
import * as THREE from 'three';
import { GameState, GameEvent, Enemy, LANDMARKS, ResourceNode, WORLD_HALF } from './sim';
import { ENEMY_TYPES } from './sim/data';
import { ITEMS, TIER_COLORS } from './sim/items';
import { NPC, QuestStage } from './sim/quest';
import { Particles, Rings } from './fx';
import { BOULDERS_PER_FACTOR, ringPoints } from './sim/stress';

/**
 * Every colour in the scene, in one place. Desaturated, cold and narrow: the world sits in a tight dark band so that
 * saturation is spent on exactly three things: fire (forge, gold), blood (enemies, damage) and arcane light (quest, magic).
 */
const PALETTE = {
  // terrain: drained grey-green, ash, cold slate
  grass: 0x3a4336, grassAlt: 0x465040, beyond: 0x181d17, dirt: 0x6b675d,
  slate: 0x4b525b, slateDark: 0x3a4048, boulder: 0x454b53, cave: 0x040405,
  stone: 0x5d6169, stoneDark: 0x3d4046, anvil: 0x1b1c20,
  bark: 0x4a3b2e, pine: 0x35493a,
  // ore: the flecks are the one warm, light accent on a rock so a node reads at distance
  ironRock: 0x6a7078, coalRock: 0x2f3036, ironFleck: 0xd9803c, coalFleck: 0x5a5d70, spent: 0x2e2f33,
  // actors
  player: 0x7a8794, skin: 0xc4a584, bone: 0xd9ceb2, steel: 0xb8bcc4,
  boar: 0x78553f, wolf: 0x9a9a92, brute: 0x7a3030,
  robe: 0x62497a, hood: 0x40314f, staffWood: 0x4a3b2e,
  // the three saturated families
  fire: 0xff6a1a, ember: 0xffb040, gold: 0xffc84a, forgeLight: 0xff7a2a,
  blood: 0xd02424, bloodDark: 0x701010, bloodLight: 0xff7a5a,
  arcane: 0x6ad8ff, arcaneLight: 0xc4efff, violet: 0xb070ff, heal: 0x5affd0,
  // atmosphere
  moon: 0xa9b8cc, rim: 0x6d8aa8, skyZenith: 0x15171d, skyMid: 0x2a2f33, horizon: 0x505a3a, skyGround: 0x20251c, hemiSky: 0x5a6678, hemiGround: 0x262a20,
  ash: 0xa8a49a, smoke: [0xbbbbbb, 0x888888] as number[],
} as const;
const P = PALETTE;

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
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: true });
  if (cls === 'glow') m.emissive.setHex(color).multiplyScalar(0.85); // self-lit: readable in any light
  return m;
};
const mesh = (g: THREE.BufferGeometry, color: number, cls: MatClass, shadow: 'cast' | 'receive' | 'both' | 'none' = 'both') => {
  const m = new THREE.Mesh(g, material(color, cls));
  m.castShadow = shadow === 'cast' || shadow === 'both';
  m.receiveShadow = shadow === 'receive' || shadow === 'both';
  return m;
};

// Directional light sits at a fixed offset from its shadow target and follows the player, so the shadow frustum stays tight.
const SUN_OFFSET = new THREE.Vector3(-40, 22, 28); // low and raking: a moon, not noon
const SHADOW_EXTENT = 28, SHADOW_MAP = 2048;
const FOG = { near: 8, far: 46 };
const FORGE_LIGHT = { intensity: 140, distance: 24, y: 1.2 };

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
  private forgeLight!: THREE.PointLight;
  private sun = new THREE.DirectionalLight(P.moon, 3);

  // orbit camera (render-side only; sim never sees it except via input direction)
  yaw = 0;
  pitch = 0.5;
  distance = 10;

  constructor(parent: HTMLElement, s: GameState) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    parent.appendChild(this.renderer.domElement);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.5;
    this.setupSky();
    this.scene.add(new THREE.HemisphereLight(P.hemiSky, P.hemiGround, 0.5));
    this.setupRim();
    this.setupSun();

    this.ground = this.facetedGround();
    this.scene.add(this.ground);
    this.buildZone();
    this.rings = new Rings(this.scene);
    this.scene.add(this.particles.points);
    this.buildNpc();

    this.player = mesh(new THREE.CapsuleGeometry(0.5, 1, 2, 6), P.player, 'cloth', 'cast');
    this.scene.add(this.player);
    // a nose so facing is visible
    const nose = mesh(new THREE.BoxGeometry(0.2, 0.2, 0.4), P.bone, 'skin', 'cast');
    nose.position.set(0, 0.4, 0.5);
    this.player.add(nose);

    // held weapon: colour follows the equipped item's tier, hidden when bare-handed
    this.weapon = mesh(new THREE.BoxGeometry(0.1, 0.1, 1.1), P.steel, 'metal', 'cast');
    this.weapon.position.set(0.6, 0.3, 0.7);
    this.player.add(this.weapon);

    this.selection = mesh(new THREE.TorusGeometry(1, 0.07, 4, 24).rotateX(Math.PI / 2), P.blood, 'glow', 'none');
    this.selection.visible = false;
    this.scene.add(this.selection);
    this.levelRing = mesh(new THREE.TorusGeometry(1, 0.1, 4, 28).rotateX(Math.PI / 2), P.gold, 'glow', 'none');
    this.levelRing.visible = false;
    this.scene.add(this.levelRing);
    for (const e of s.enemies) this.addActor(e);
    for (const n of s.nodes) this.addNode(n);

    this.marker = mesh(new THREE.TorusGeometry(0.5, 0.08, 4, 16).rotateX(Math.PI / 2), P.gold, 'glow', 'none');
    this.marker.visible = false;
    this.scene.add(this.marker);

    this.curr.x = this.prev.x = s.player.x;
    this.curr.z = this.prev.z = s.player.z;
    addEventListener('resize', () => this.resize());
    this.resize();
  }

  /** Gradient sky baked once through PMREM: background and image-based ambient light in one. */
  private setupSky() {
    const horizon = P.horizon;
    this.scene.fog = new THREE.Fog(horizon, FOG.near, FOG.far);
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: {
        zenith: { value: new THREE.Color(P.skyZenith) }, mid: { value: new THREE.Color(P.skyMid) }, horizon: { value: new THREE.Color(horizon) },
        ground: { value: new THREE.Color(P.skyGround) }, sun: { value: SUN_OFFSET.clone().normalize() }, moon: { value: new THREE.Color(P.moon) },
      },
      vertexShader: 'varying vec3 d; void main() { d = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 zenith, mid, horizon, ground, sun, moon; varying vec3 d;
        void main() {
          vec3 n = normalize(d);
          float h = clamp(n.y, 0.0, 1.0);
          vec3 c = mix(horizon, mid, smoothstep(0.0, 0.22, h));   // sick band hugging the horizon, then bruised overcast
          c = mix(c, zenith, smoothstep(0.1, 0.8, h));
          c = mix(c, ground, smoothstep(0.0, -0.25, n.y));
          c += moon * pow(max(dot(n, sun), 0.0), 40.0) * 0.55;    // cold smear where the moon sits behind the cloud
          gl_FragColor = vec4(c, 1.0);
        }`,
    }));
    const skyScene = new THREE.Scene();
    skyScene.add(sky);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const rt = pmrem.fromScene(skyScene);
    this.scene.environment = this.scene.background = rt.texture;
    this.scene.environmentIntensity = 1.0;
    this.scene.backgroundIntensity = 1.0;
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

  /** Cool back-light from the side opposite the moon, no shadows: gives actors a bright edge against the dark ground. */
  private setupRim() {
    const rim = new THREE.DirectionalLight(P.rim, 0.8);
    rim.position.copy(SUN_OFFSET).multiplyScalar(-1).setY(14);
    this.scene.add(rim);
  }

  /** Ground as a coarse mesh of flat, individually tinted triangles: the cheapest way to make a plane read as low poly. */
  private facetedGround() {
    const segs = Math.min(Math.round(WORLD_HALF * 2 / 3), 90);
    const g = new THREE.PlaneGeometry(WORLD_HALF * 2, WORLD_HALF * 2, segs, segs).rotateX(-Math.PI / 2).toNonIndexed();
    const a = new THREE.Color(P.grass), b = new THREE.Color(P.grassAlt), c = new THREE.Color();
    const col = new Float32Array(g.attributes.position.count * 3);
    for (let t = 0; t < col.length / 9; t++) {
      const r = Math.abs(Math.sin(t * 12.9898) * 43758.5453) % 1; // deterministic per-triangle jitter, no rng state touched
      c.copy(a).lerp(b, r);
      for (let v = 0; v < 3; v++) c.toArray(col, t * 9 + v * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = mesh(g, 0xffffff, 'ground', 'receive');
    (m.material as Mat).vertexColors = true;
    return m;
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
    add(mesh(new THREE.CylinderGeometry(c.r, c.r, 0.05, 20), P.dirt, 'dirt', 'receive'), c.x, 0.03, c.z);

    // forge: stone hut, chimney, glowing furnace, anvil
    const f = LANDMARKS.forge;
    this.forgeParts.push(
      add(mesh(new THREE.BoxGeometry(4, 2.5, 3), P.stone, 'stone'), f.x, 1.25, f.z),
      add(mesh(new THREE.BoxGeometry(1, 2, 1), P.stoneDark, 'stone'), f.x + 1, 3.4, f.z),
      add(mesh(new THREE.BoxGeometry(1.2, 1, 0.1), P.fire, 'glow', 'receive'), f.x - 1, 1, f.z + 1.55),
      add(mesh(new THREE.BoxGeometry(0.8, 0.6, 0.5), P.anvil, 'metal'), f.x - 3, 0.3, f.z + 2));
    this.forgeLight = add(new THREE.PointLight(P.forgeLight, FORGE_LIGHT.intensity, FORGE_LIGHT.distance), f.x - 1, FORGE_LIGHT.y, f.z + 2.5) as THREE.PointLight;

    // cave mouth: dark opening between rocks, facing +z
    const k = LANDMARKS.caveMouth;
    add(mesh(new THREE.DodecahedronGeometry(3), P.slate, 'rock'), k.x - 3, 2, k.z - 2);
    add(mesh(new THREE.DodecahedronGeometry(3), P.slate, 'rock'), k.x + 3, 2, k.z - 2);
    add(mesh(new THREE.DodecahedronGeometry(3.4), P.slateDark, 'rock'), k.x, 3.6, k.z - 3.5);
    add(mesh(new THREE.BoxGeometry(3.2, 3, 0.3), P.cave, 'dark', 'receive'), k.x, 1.5, k.z - 1.4);

    // boundary: ring of boulders along the edge
    for (let i = -WORLD_HALF; i <= WORLD_HALF; i += 3) {
      for (const [x, z] of [[i, -WORLD_HALF], [i, WORLD_HALF], [-WORLD_HALF, i], [WORLD_HALF, i]]) {
        add(mesh(new THREE.DodecahedronGeometry(1.6), P.boulder, 'rock'), x, 0.8, z);
      }
    }
    // dev stress only (?stress=N): scatter extra decorative boulders so boulder count scales with N like everything else
    if (WORLD_HALF > 30) {
      const factor = (WORLD_HALF / 30) ** 2, ring = Math.ceil(2 * WORLD_HALF / 3 + 1) * 4;
      const pts = ringPoints({ rng: 777 }, WORLD_HALF, 30, 3);
      for (let i = ring; i < Math.round(BOULDERS_PER_FACTOR * factor); i++) { const p = pts.next().value!; add(mesh(new THREE.DodecahedronGeometry(1.6), P.boulder, 'rock'), p.x, 0.8, p.z); }
    }
    // beyond the boundary: dark ground so the edge reads as the end of the world
    add(mesh(new THREE.PlaneGeometry(Math.max(400, WORLD_HALF * 4), Math.max(400, WORLD_HALF * 4)).rotateX(-Math.PI / 2), P.beyond, 'ground', 'receive'), 0, -0.05, 0);
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
    part(new THREE.ConeGeometry(0.7, 1.7, 6), P.robe, 'cloth', 0.85);
    part(new THREE.SphereGeometry(0.3, 6, 4), P.skin, 'skin', 1.95);
    part(new THREE.ConeGeometry(0.34, 0.5, 6), P.hood, 'cloth', 2.3);
    part(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 5), P.staffWood, 'wood', 1.3, 0.7, 0.15);
    part(new THREE.OctahedronGeometry(0.25), P.arcane, 'glow', 2.7, 0.7, 0.15); // arcane light on the staff
    const staffLight = new THREE.PointLight(P.arcane, 6, 7);
    staffLight.position.set(NPC.x + 0.7, 2.7, NPC.z + 0.15);
    this.scene.add(staffLight);
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
    this.markerTex = { offer: tex('!', '#ffc84a'), ready: tex('?', '#ffc84a'), wait: tex('?', '#7f858c') };
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
      part(new THREE.CylinderGeometry(0.25, 0.35, 2, 5), P.bark, 'wood', 1);
      crown = part(new THREE.ConeGeometry(1.4, 3.5, 6), P.pine, 'foliage', 3.5);
    } else {
      const coal = n.type === 'coal';
      part(new THREE.DodecahedronGeometry(1.3), coal ? P.coalRock : P.ironRock, 'rock', 0.9);
      // ore flecks: rust for iron, glossy black for coal
      for (const [dx, dy, dz] of [[0.7, 1.2, 0.6], [-0.6, 1.0, 0.8], [0.1, 1.6, -0.5]]) {
        const fleck = part(new THREE.OctahedronGeometry(0.28), coal ? P.coalFleck : P.ironFleck, coal ? 'coal' : 'ore', dy);
        if (!coal) (fleck.material as Mat).emissive.setHex(P.ironFleck).multiplyScalar(0.35); // faint ember glint so a node reads at range
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
      v.mats.forEach((m, i) => { const spent = depleted && !v.crown; m.color.setHex(spent ? P.spent : v.base[i]); m.emissiveIntensity = spent ? 0 : 1; });
      v.group.rotation.z = n.id === active ? Math.sin(now * 18) * 0.05 : 0;
    }
  }

  private addActor(e: Enemy) {
    const def = ENEMY_TYPES[e.type];
    const color = e.type === 'boar' ? P.boar : e.type === 'wolf' ? P.wolf : P.brute;
    const group = new THREE.Group();
    const mat = material(color, 'hide');
    const body = new THREE.Mesh(
      e.type === 'brute' ? new THREE.BoxGeometry(1.6, 2.2, 1.2) : new THREE.CapsuleGeometry(def.radius * 0.8, def.radius * 1.2, 2, 6).rotateX(Math.PI / 2),
      mat);
    body.castShadow = body.receiveShadow = true;
    body.position.y = e.type === 'brute' ? 1.5 : def.radius + 0.2;
    body.userData.enemyId = e.id;
    group.add(body);
    // snout/fist so facing is readable
    const noseMat = material(P.bloodDark, 'skin');
    noseMat.emissive.setHex(P.blood).multiplyScalar(0.55); // glowing red snout: the aggressive accent that finds an enemy in the dark
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.5), noseMat);
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
          this.particles.burst(ev.x, 1.2, ev.z, { color: [P.blood, P.bloodLight], count: 12, speed: 4, life: 0.5 });
        } else {
          this.shakeMag = Math.max(this.shakeMag, ev.crit ? 0.2 : ev.slot === 1 ? 0.14 : 0.04);
          this.impact(s, ev);
        }
      } else if (ev.t === 'cast') this.castPunch = 0.12;
      else if (ev.t === 'heal') {
        this.particles.burst(ev.x, 0.4, ev.z, { color: [P.heal, P.arcaneLight], count: 24, speed: 1.6, up: 3.5, gravity: -1, life: 1 });
        this.rings.pulse(ev.x, 0.15, ev.z, P.heal, 2.2, 0.6);
      } else if (ev.t === 'levelup') {
        this.levelRingAge = 0;
        this.shakeMag = Math.max(this.shakeMag, 0.1);
        const p = s.player;
        this.particles.burst(p.x, 0.3, p.z, { color: [P.gold, P.arcaneLight, P.ember], count: 70, speed: 3, up: 8, gravity: -6, life: 1.4 });
        this.rings.pulse(p.x, 0.2, p.z, P.gold, 4, 0.9);
      } else if (ev.t === 'kill') {
        const type = s.enemies.find(e => e.id === ev.id)!.type, big = type === 'brute';
        this.particles.burst(ev.x, 0.8, ev.z, { color: [...P.smoke, P.ember], count: big ? 70 : 32, speed: big ? 6 : 4, up: 2, life: 0.9 });
        this.rings.pulse(ev.x, 0.15, ev.z, P.ash, big ? 5 : 2.5, 0.5);
        if (big) this.shakeMag = Math.max(this.shakeMag, 0.35);
      } else if (ev.t === 'drop') {
        this.particles.burst(ev.x, 0.6, ev.z, { color: TIER_COLORS[ITEMS[ev.item].tier], count: 14, speed: 1.5, up: 3, gravity: -5, life: 0.8 });
      } else if (ev.t === 'loot') {
        this.particles.burst(s.player.x, 1.6, s.player.z, { color: [P.heal, P.arcaneLight], count: 12, speed: 1.2, up: 2.5, gravity: -3, life: 0.7 });
      } else if (ev.t === 'depleted') {
        const n = s.nodes.find(x => x.id === ev.id)!;
        this.particles.burst(n.x, 1, n.z, { color: n.type === 'tree' ? [P.pine, P.bark] : P.smoke, count: 24, speed: 3, up: 1, life: 0.8 });
      } else if (ev.t === 'crafted') {
        const f = LANDMARKS.forge;
        this.particles.burst(f.x - 3, 0.9, f.z + 2, { color: [P.ember, P.fire, P.arcaneLight], count: 50, speed: 5, up: 4, life: 0.9 });
        this.rings.pulse(f.x - 3, 0.3, f.z + 2, P.fire, 3, 0.6);
      } else if (ev.t === 'quest') {
        const p = s.player;
        if (ev.what === 'complete') this.fireworks(p.x, p.z);
        else this.particles.burst(p.x, 1, p.z, { color: [P.arcane, P.arcaneLight], count: 26, speed: 2, up: 4, gravity: -3, life: 1 });
      } else if (ev.t === 'death') {
        this.shakeMag = 0.3;
        this.particles.burst(s.player.x, 1, s.player.z, { color: [P.blood, P.bloodDark], count: 50, speed: 5, up: 3, life: 1.1 });
      }
    }
  }

  /** Ability-specific hit feedback: each of the four reads differently at a glance. */
  private impact(s: GameState, ev: Extract<GameEvent, { t: 'hit' }>) {
    const p = s.player, y = 1.2;
    if (ev.dot) return void this.particles.burst(ev.x, y, ev.z, { color: P.violet, count: 5, speed: 1.5, up: 1, life: 0.4 });
    if (ev.slot === 1) {
      this.particles.burst(ev.x, 0.5, ev.z, { color: [P.fire, P.gold, P.arcaneLight], count: 36, speed: 6, up: 3, life: 0.7 });
      this.rings.pulse(ev.x, 0.15, ev.z, P.fire, 3.2, 0.4);
    } else if (ev.slot === 2) {
      this.particles.trail(p.x, 1.4, p.z, ev.x, y, ev.z, P.violet);
      this.particles.burst(ev.x, y, ev.z, { color: [P.violet, P.arcaneLight], count: 16, speed: 3, life: 0.5 });
    } else {
      this.particles.burst(ev.x, y, ev.z, { color: [P.arcaneLight, P.ash], count: 10, speed: 4, life: 0.35 });
    }
    if (ev.crit) this.particles.burst(ev.x, y + 0.4, ev.z, { color: [P.gold, P.arcaneLight], count: 20, speed: 5, up: 2, life: 0.6 });
  }

  /** Quest-complete fanfare: staggered coloured bursts over the player. */
  private fireworks(x: number, z: number) {
    const palettes = [[P.blood, P.bloodLight], [P.heal, P.arcaneLight], [P.arcane, P.arcaneLight], [P.gold, P.ember], [P.violet, P.arcaneLight]];
    palettes.forEach((pal, i) => setTimeout(() => {
      const a = (i / palettes.length) * Math.PI * 2;
      this.particles.burst(x + Math.cos(a) * 3, 6 + (i % 2) * 2, z + Math.sin(a) * 3, { color: pal, count: 50, speed: 5, gravity: -3, life: 1.6 });
    }, i * 220));
    this.rings.pulse(x, 0.2, z, P.gold, 6, 1.2);
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
    this.forgeLight.intensity = FORGE_LIGHT.intensity * (1 + 0.07 * Math.sin(nowMs / 90) + 0.05 * Math.sin(nowMs / 37));
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
    a.mat.emissive.setHex(e.hitFlash > 0 ? P.bloodLight : 0x000000);
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
