// Rendering only: reads GameState, never mutates it.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GameState, GameEvent, Enemy, LANDMARKS, ResourceNode, WORLD_HALF } from './sim';
import { CAVE_MOUTH, CAVE_ROCKS, COLLIDERS, CAVE_PILLARS, CAVE_ROOMS, caveDepth, caveWallPoints, clampToWorld, inCave } from './sim/world';
import { ENEMY_TYPES, JUMP_AIRTIME, AUTO_RANGE } from './sim/data';
import { ITEMS, TIER_COLORS } from './sim/items';
import { NPC, npcMarker as markerOf } from './sim/quest';
import { VENDOR } from './sim/shop';
import { Motes, Particles, Rings, Slashes } from './fx';
import { PostStack, Quality } from './post';
import { BOULDERS_PER_FACTOR, ringPoints } from './sim/stress';
import { Animator } from './anim';
import { PlayerGear } from './gear';
import { BEACON_INTENSITY, cappedIntensity } from './glow';
import { SLOTS, SlotId, Prepared, loadSlot, spawn, freeze } from './models';

/**
 * Every colour in the scene, in one place. Desaturated, cold and narrow: the world sits in a tight dark band so that
 * saturation is spent on exactly three things: fire (forge, gold), blood (enemies, damage) and arcane light (quest, magic).
 */
const PALETTE = {
  // terrain: drained grey-green, ash, cold slate
  grass: 0x3a4336, grassAlt: 0x465040, beyond: 0x181d17, dirt: 0x58574f, dirtAlt: 0x4a4b45,
  slate: 0x4b525b, slateDark: 0x3a4048, boulder: 0x454b53, cave: 0x040405, caveFloor: 0x2a2e36, caveFloorAlt: 0x333842, caveWall: 0x343a44,
  stone: 0x5d6169, stoneDark: 0x3d4046, anvil: 0x1b1c20,
  bark: 0x4a3b2e, pine: 0x35493a,
  // ore: the flecks are the one warm, light accent on a rock so a node reads at distance
  ironRock: 0x6a7078, coalRock: 0x2f3036, ironFleck: 0xd9803c, coalFleck: 0x5a5d70, spent: 0x2e2f33, mithrilRock: 0x3b5878, mithrilGlow: 0x103a6a,
  // actors
  player: 0x7a8794, skin: 0xc4a584, bone: 0xd9ceb2, steel: 0xb8bcc4,
  boar: 0x78553f, wolf: 0x9a9a92, brute: 0x7a3030,
  robe: 0x62497a, hood: 0x40314f, staffWood: 0x4a3b2e,
  // the three saturated families
  fire: 0xff6a1a, ember: 0xffb040, gold: 0xffc84a, forgeLight: 0xff7a2a,
  blood: 0xd02424, bloodDark: 0x701010, bloodLight: 0xff7a5a,
  arcane: 0x6ad8ff, arcaneLight: 0xc4efff, violet: 0xb070ff, heal: 0x5affd0,
  // atmosphere
  moon: 0xa9b8cc, rim: 0x6d8aa8, skyZenith: 0x07090d, skyMid: 0x141a22, horizon: 0x222c38, skyGround: 0x0c0f13, hemiSky: 0x4a5a74, hemiGround: 0x161b22,
  ash: 0xa8a49a, smoke: [0xbbbbbb, 0x888888] as number[],
} as const;
const P = PALETTE;
type Mat = THREE.MeshStandardMaterial;
/** Roughness / metalness per material class. */
const MATERIALS = {
  ground: [0.95, 0], dirt: [0.98, 0], foliage: [0.85, 0], wood: [0.8, 0], rock: [0.9, 0], stone: [0.85, 0],
  metal: [0.4, 0.9], ore: [0.55, 0.6], coal: [0.3, 0.1], cloth: [0.9, 0], skin: [0.6, 0], hide: [0.92, 0],
  gem: [0.3, 0.2], glow: [0.6, 0], beacon: [0.6, 0], dark: [1, 0],
} as const;
type MatClass = keyof typeof MATERIALS;
const EMITTER_DIFFUSE = 0.15;
/** Hard surfaces keep their facets (docs/art-direction.md): big planes catching the key light is what makes rock read as rock. Everything organic shades smooth. */
const FACETED = new Set<MatClass>(['rock', 'stone', 'foliage', 'ore', 'coal', 'gem']);

const material = (color: number, cls: MatClass): Mat => {
  const [roughness, metalness] = MATERIALS[cls];
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: FACETED.has(cls) });
  // glow: a lit emitter, self-lit and capped under the bloom threshold (glow.ts). beacon: a thin marker meant to cross it and bloom.
  if (cls === 'glow' || cls === 'beacon') { m.emissive.setHex(color); m.emissiveIntensity = cls === 'beacon' ? BEACON_INTENSITY : cappedIntensity(color, BEACON_INTENSITY); }
  if (cls === 'glow') m.color.multiplyScalar(EMITTER_DIFFUSE); // an emitter shows its own light, not the room's: a light parked beside it would otherwise wash it to white
  return m;
};
const mesh = (g: THREE.BufferGeometry, color: number, cls: MatClass, shadow: 'cast' | 'receive' | 'both' | 'none' = 'both') => {
  const m = new THREE.Mesh(g, material(color, cls));
  m.castShadow = shadow === 'cast' || shadow === 'both';
  m.receiveShadow = shadow === 'receive' || shadow === 'both';
  return m;
};

// Directional light sits at a fixed offset from its shadow target and follows the player, so the shadow frustum stays tight.
const SUN_OFFSET = new THREE.Vector3(-38, 36, 26); // ~37 degrees: long silhouettes, but shadow bands stay short enough not to swallow the combat arena
const SHADOW_EXTENT = 28, SHADOW_MAP = 2048;
/**
 * Findability of hostiles at range, replacing the old red snout cube. Two quiet cues, both in the blood family:
 * a dull ember lift on the enemy's own materials (its silhouette stays warmer than the cold ground around it), and a
 * dim blood-red ring on the ground under it. The ring ignores fog, so it still reads at 25-40 m where the model has
 * faded into haze, and it is hidden again just before the fog would have hidden the model (FOG_CULL), so it never
 * outlives the thing it marks.
 */
const HOSTILE_TINT = 0x2c0e08;
const RING_OPACITY = 0.42;
const FOG = { near: 6, far: 42 };
/** Actors past this camera distance are not drawn or animated. Strictly beyond FOG.far, where fog is already 100%: nothing still meant to be visible is culled. */
const FOG_CULL = FOG.far + 8;
/** The Warden's arcane gem floats just above his right fist (glTF loading strips the dot from "Fist.R"), carried by the bone. */
const GEM_HAND = 'FistR', GEM_LIFT = 0.4;
/** Furnace core emissive: hot enough to bloom orange, not so hot it clips to a white hole and washes out the building. */
const FURNACE_GLOW = 1.3;
const FORGE_LIGHT = { intensity: 100, distance: 28, y: 1.2 };

/**
 * Lighting at full cave depth (caveDepth = 1). Sun, hemisphere, sky-ambient and sky all drop to a trace and the fog closes in and goes
 * black; a cold lantern the player carries and the glow of what is in the cave (veins, braziers) are what is left.
 */
const CAVE_LIGHT = {
  sun: 0.03, rim: 0.05, hemi: 0.6, env: 0.2, sky: 0,
  fog: { color: 0x05070b, near: 3, far: 32 },
  lantern: { color: 0x8fb0e0, intensity: 65, distance: 18, y: 4.2 },
};
/** Daylight values the cave lighting fades from (what the constructor sets up). */
const DAY = { sun: 4.4, rim: 1.5, hemi: 0.4, env: 0.4, sky: 1 };
const MITHRIL_LIGHT = { x: -27.8, y: 2.2, z: -48, intensity: 38, distance: 11 };
/** Held above the flame (the 1.7x brazier's flame tops out near y 3.4): a light inside or beside a prop bloomed the prop to white. See glow.ts minLightDistance. */
const BRAZIER_LIGHT = { intensity: 260, distance: 24, y: 5.8 };
/** Braziers that burn in the cave: the hall's big one carries a real light, the others are lit geometry only (the frame budget has room for few lights). */
const BRAZIERS = [{ x: -16.4, z: -38, s: 0.8 }, { x: -30.8, z: -60, s: 1 }, { x: -7.2, z: -63, s: 1 }, { x: -18, z: -76.5, s: 1.7, light: true }];

/**
 * Arcane crystal clusters: the cold emissive accents the art direction asks for (docs/art-direction.md), small bright shapes against large
 * dark ones. Decorative, one merged draw, no light of their own. Outdoors they mark the clearing's rim and the way to the cave; in the cave they
 * are the only cold light off the player's lantern.
 */
/** Glow sits under the beacon's 3: lit blue, not a white hole. */
const CRYSTAL_COLOR = 0x2f7fe0, CRYSTAL_GLOW = 1.4, CRYSTAL_SHARDS = 4, CRYSTAL_CLEARANCE = 0.8;
const CRYSTALS = [
  { x: -10, z: -6, s: 1 }, { x: 11, z: 9, s: 0.8 }, { x: -6, z: 12, s: 1.1 }, { x: 14, z: -15, s: 0.9 }, { x: -24, z: -17, s: 1.2 }, { x: -11.5, z: -19, s: 0.9 },
  { x: -19.5, z: -33, s: 1 }, { x: -29, z: -48, s: 1.3 }, { x: -8, z: -45, s: 1.1 }, { x: -25, z: -62, s: 1 }, { x: -9.5, z: -82, s: 1.2 }, { x: -26, z: -74, s: 0.9 },
];

/** Enemy type -> the model slot that draws it: cave enemies are existing rigs (`look.model`), everyone else draws as itself. */
const slotOf = (type: string): SlotId => (ENEMY_TYPES[type].look?.model ?? type) as SlotId;
const lookScale = (type: string) => ENEMY_TYPES[type].look?.scale ?? 1;
/** How far a cave enemy's own colours are pulled toward its look tint, and how much of that tint it also gives off (so it reads in the dark). */
const TINT_MIX = 0.55, TINT_GLOW = 0.2;
const emissiveOf = (type: string) => { const t = ENEMY_TYPES[type].look?.tint; return t === undefined ? HOSTILE_TINT : new THREE.Color(HOSTILE_TINT).add(new THREE.Color(t).multiplyScalar(TINT_GLOW)).getHex(); };
/** The cave's standing stones and wall rock: tall, faceted, cold. */
const PILLAR_HEIGHT = 6.5, WALL_HEIGHT = 1.9;
/** The way in: rock heaped over the two flanks (CAVE_MOUTH), the gap between left clear. Bottom y and footprint. */
const MOUTH_TOPS = [{ x: -21, y: 2.6, z: -27.8, w: 4.6 }, { x: -15, y: 2.6, z: -27.8, w: 4.6 }];

/** Enemy click volume: a vertical capsule as tall as the model on screen, wide enough for the widest of its body and its sim radius. A little generous on purpose. */
const PICK_SPHERES = 4;
const CAMERA_JUMP_FOLLOW = 0.5;
/**
 * In the cave the orbit camera is pulled in along its own ray until it is on the floor (the walls are rectangle edges in the sim, so there is nothing
 * to raycast) and short of the first rock (wall boulder, standing stone, mouth rock) the ray would pass through; never closer to the player than
 * this fraction of the orbit. A rock the player is itself standing in (the throat and neck are only 5 wide and the boulders poke into them) is
 * ignored, so the camera may be no nearer such a boulder than the player is; the floor test is what keeps it out of the wall behind.
 */
const CAMERA_FLOOR_MARGIN = 0.3, CAMERA_ROCK_MARGIN = 0.6, CAMERA_MIN_PULL = 0.25, CAMERA_ROCK_FILL = 0.5; // a boulder is up to this fraction of its width from the centre to its edge (a neck-mouth boulder row hides the player at 0.38)

const QUADRUPEDS = new Set(['boar', 'wolf', 'pup']);
function pickVolume(type: string): { height: number; radius: number } {
  const slot = slotOf(type), height = SLOTS[slot as 'boar'].height! * lookScale(type);
  // beasts are longer than they are tall and have no facing-independent footprint: size them by length, people by height
  return { height, radius: Math.max(ENEMY_TYPES[type].radius * 1.15, height * (QUADRUPEDS.has(slot) ? 1 : 0.32)) };
}

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
  private vendorParts: THREE.Object3D[] = [];
  private npcMarker!: THREE.Sprite;
  private staffLight!: THREE.PointLight;
  private markerTex!: Record<'offer' | 'ready' | 'wait', THREE.Texture>;
  private particles = new Particles();
  private motes = new Motes();
  private rings: Rings;
  private slashes: Slashes;
  private lastDraw = performance.now();
  private forgeLight!: THREE.PointLight;
  private boundary: THREE.Mesh[] = [];
  private caveRocks: THREE.Mesh[] = [];
  private caveFloor!: THREE.Mesh;
  private caveWalls!: THREE.InstancedMesh;
  private caveWallPts: { x: number; z: number; r: number; w: number }[] = [];
  private caveFlames: { m: THREE.Mesh; phase: number }[] = [];
  private hemi!: THREE.HemisphereLight;
  private rim!: THREE.DirectionalLight;
  private lantern!: THREE.PointLight;
  private mithrilLight!: THREE.PointLight;
  private hallLight?: THREE.PointLight;
  private caveFogColor = new THREE.Color(CAVE_LIGHT.fog.color);
  /** 0..1: how much of the mithril seam is still standing, so the cold light goes out with the last vein. */
  private veinGlow = 1;
  private npcGroup!: THREE.Group;
  private npcAnim?: Animator;
  private playerAnim?: Animator;
  private gear?: PlayerGear;
  private playerWasDead = false;
  /** Resolves once every model slot has either swapped in or failed (and kept its primitive). Models stream in; the first frame never waits. */
  readonly modelsReady: Promise<void>;
  debugCam: { pos: number[]; at: number[] } | null = null;
  private sun = new THREE.DirectionalLight(P.moon, 3);
  post!: PostStack;

  // orbit camera (render-side only; sim never sees it except via input direction)
  yaw = 0;
  pitch = 0.5;
  distance = 10;

  constructor(parent: HTMLElement, s: GameState, quality: Quality = 'high') {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    parent.appendChild(this.renderer.domElement);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.5;
    this.setupSky();
    this.hemi = new THREE.HemisphereLight(P.hemiSky, P.hemiGround, DAY.hemi);
    this.scene.add(this.hemi);
    this.setupRim();
    this.setupSun();

    this.ground = this.tintedGround();
    this.scene.add(this.ground);
    this.buildZone();
    this.rings = new Rings(this.scene);
    this.slashes = new Slashes(this.scene);
    this.scene.add(this.particles.points, this.motes.points);
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

    this.selection = mesh(new THREE.TorusGeometry(1, 0.07, 4, 24).rotateX(Math.PI / 2), P.blood, 'beacon', 'none');
    this.selection.visible = false;
    this.scene.add(this.selection);
    this.levelRing = mesh(new THREE.TorusGeometry(1, 0.1, 4, 28).rotateX(Math.PI / 2), P.gold, 'beacon', 'none');
    this.levelRing.visible = false;
    this.scene.add(this.levelRing);
    for (const e of s.enemies) this.addActor(e);
    for (const n of s.nodes) this.addNode(n);

    this.marker = mesh(new THREE.TorusGeometry(0.5, 0.08, 4, 16).rotateX(Math.PI / 2), P.gold, 'beacon', 'none');
    this.marker.visible = false;
    this.scene.add(this.marker);

    this.curr.x = this.prev.x = s.player.x;
    this.curr.z = this.prev.z = s.player.z;
    this.post = new PostStack(this.renderer, this.scene, this.camera, quality);
    addEventListener('resize', () => this.resize());
    this.resize();
    this.modelsReady = this.populate(s).then(() => this.warmUp());
  }

  /** Compile every shader the first fight needs before the player's first frame: hidden effects (slash pool, rings, ground telegraphs) otherwise compile the first time they appear, a 10-20 ms stall mid-combat. One synchronous render, so no frame of it is ever presented. */
  private warmUp() {
    const saved = new Map<THREE.Object3D, [boolean, boolean]>();
    this.scene.traverse(o => { saved.set(o, [o.visible, o.frustumCulled]); o.visible = true; o.frustumCulled = false; });
    this.rings.pulse(0, 0.2, 0, 0xffffff, 1, 0.1);
    this.slashes.swipe(0, 0, 0);
    this.post.render(this.scene);
    this.rings.update(1); this.slashes.update(1); // expire the throwaways
    for (const [o, [v, f]] of saved) { o.visible = v; o.frustumCulled = f; }
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
          vec3 c = mix(horizon, mid, smoothstep(0.0, 0.22, h));   // cold blue-grey band hugging the horizon, then deepening dusk
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
    this.scene.environmentIntensity = DAY.env;
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
    const rim = this.rim = new THREE.DirectionalLight(P.rim, DAY.rim);
    rim.position.copy(SUN_OFFSET).multiplyScalar(-1).setY(14);
    this.scene.add(rim);
  }

  /** Ground as a coarse mesh tinted per vertex: the grid stays indexed so the tint washes across it instead of tiling it into triangles. */
  private tintedGround() {
    const segs = Math.min(Math.round(WORLD_HALF * 2 / 3), 90);
    const g = new THREE.PlaneGeometry(WORLD_HALF * 2, WORLD_HALF * 2, segs, segs).rotateX(-Math.PI / 2);
    const a = new THREE.Color(P.grass), b = new THREE.Color(P.grassAlt), c = new THREE.Color();
    const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
    const clr = LANDMARKS.clearing, da = new THREE.Color(P.dirt), db = new THREE.Color(P.dirtAlt), dirt = new THREE.Color();
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v), z = pos.getZ(v);
      const r = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1; // deterministic per-vertex jitter, no rng state touched
      c.copy(a).lerp(b, r);
      // the clearing is the same ground, tinted toward bare earth: no separate slab, so no hard straight edge
      const k = THREE.MathUtils.clamp((clr.r + 1.5 - Math.hypot(x - clr.x, z - clr.z)) / 3, 0, 1);
      if (k > 0) c.lerp(dirt.copy(da).lerp(db, r), k);
      c.toArray(col, v * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = mesh(g, 0xffffff, 'ground', 'receive');
    (m.material as Mat).vertexColors = true;
    return m;
  }

  private buildCrystals() {
    const shards: THREE.BufferGeometry[] = [];
    // deterministic scatter, no rng state touched: a cluster is a tall centre shard and leaning companions
    const hash = (n: number) => Math.abs(Math.sin(n * 12.9898) * 43758.5453) % 1;
    CRYSTALS.forEach((c, i) => {
      if (COLLIDERS.some(o => Math.hypot(o.x - c.x, o.z - c.z) < o.r + CRYSTAL_CLEARANCE)) return; // never grow out of a tree, rock or wall
      for (let k = 0; k < CRYSTAL_SHARDS; k++) {
        const h = (k === 0 ? 1.5 : 0.7 + hash(i * 7 + k) * 0.6) * c.s, a = hash(i * 31 + k) * Math.PI * 2, lean = k === 0 ? 0 : 0.25 + hash(i * 13 + k) * 0.3;
        shards.push(new THREE.OctahedronGeometry(1).scale(0.22 * c.s, h / 2, 0.22 * c.s).translate(0, h / 2, 0).rotateZ(lean).rotateY(a).translate(c.x + (k ? Math.cos(a) * 0.35 * c.s : 0), 0, c.z + (k ? Math.sin(a) * 0.35 * c.s : 0)));
      }
    });
    if (!shards.length) return;
    const crystals = mesh(mergeGeometries(shards)!, CRYSTAL_COLOR, 'beacon', 'none');
    (crystals.material as Mat).flatShading = true; // gems are faceted by design
    (crystals.material as Mat).emissiveIntensity = CRYSTAL_GLOW;
    this.scene.add(crystals);
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

    // forge: stone hut, chimney, glowing furnace, anvil
    const f = LANDMARKS.forge;
    const furnace = mesh(new THREE.BoxGeometry(1.2, 1, 0.1), P.fire, 'glow', 'receive');
    (furnace.material as Mat).emissiveIntensity = FURNACE_GLOW;
    this.forgeParts.push(
      add(mesh(new THREE.BoxGeometry(4, 2.5, 3), P.stone, 'stone'), f.x, 1.25, f.z),
      add(mesh(new THREE.BoxGeometry(1, 2, 1), P.stoneDark, 'stone'), f.x + 1, 3.4, f.z),
      add(furnace, f.x - 1, 1, f.z + 1.55),
      add(mesh(new THREE.BoxGeometry(0.8, 0.6, 0.5), P.anvil, 'metal'), f.x - 3, 0.3, f.z + 2));
    this.forgeLight = add(new THREE.PointLight(P.forgeLight, FORGE_LIGHT.intensity, FORGE_LIGHT.distance), f.x - 1, FORGE_LIGHT.y, f.z + 3.6) as THREE.PointLight;

    // cave mouth: the sim's four flank colliders, rock heaped over them and across the top; the way in is the gap between
    for (const o of CAVE_MOUTH) this.caveRocks.push(add(mesh(new THREE.DodecahedronGeometry(o.r * 1.4), P.slate, 'rock'), o.x, o.r * 0.9, o.z) as THREE.Mesh);
    for (const t of MOUTH_TOPS) this.caveRocks.push(add(mesh(new THREE.DodecahedronGeometry(t.w / 2), P.slateDark, 'rock'), t.x, t.y + t.w * 0.2, t.z) as THREE.Mesh);
    this.buildCave();
    this.buildCrystals();

    // boundary: ring of boulders along the edge
    for (let i = -WORLD_HALF; i <= WORLD_HALF; i += 3) {
      for (const [x, z] of [[i, -WORLD_HALF], [i, WORLD_HALF], [-WORLD_HALF, i], [WORLD_HALF, i]]) {
        if (inCave(x, z)) continue; // the throat opens through the boundary here
        this.boundary.push(add(mesh(new THREE.DodecahedronGeometry(1.6), P.boulder, 'rock'), x, 0.8, z) as THREE.Mesh);
      }
    }
    // dev stress only (?stress=N): scatter extra decorative boulders so boulder count scales with N like everything else
    if (WORLD_HALF > 30) {
      const factor = (WORLD_HALF / 30) ** 2, ring = Math.ceil(2 * WORLD_HALF / 3 + 1) * 4;
      const pts = ringPoints({ rng: 777 }, WORLD_HALF, 30, 3);
      for (let i = ring; i < Math.round(BOULDERS_PER_FACTOR * factor); i++) { const p = pts.next().value!; this.boundary.push(add(mesh(new THREE.DodecahedronGeometry(1.6), P.boulder, 'rock'), p.x, 0.8, p.z) as THREE.Mesh); }
    }
    // beyond the boundary: dark ground so the edge reads as the end of the world
    add(mesh(new THREE.PlaneGeometry(Math.max(400, WORLD_HALF * 4), Math.max(400, WORLD_HALF * 4)).rotateX(-Math.PI / 2), P.beyond, 'ground', 'receive'), 0, -0.05, 0);
  }

  /** Everything inside the cave that is not a rock model: floor, wall rock, standing stones, braziers and the lights they carry. */
  private buildCave() {
    this.caveFloor = this.tintedFloor();
    this.scene.add(this.caveFloor);

    // wall rock hangs on the sim's wall points, pushed out of the room so the walkable floor stays clear; one instanced draw
    for (const p of caveWallPoints(2)) {
      const room = CAVE_ROOMS.find(({ rect: r }) => Math.abs(p.x - r.x0) < 0.01 || Math.abs(p.x - r.x1) < 0.01 || Math.abs(p.z - r.z0) < 0.01 || Math.abs(p.z - r.z1) < 0.01)!.rect;
      const cx = (room.x0 + room.x1) / 2, cz = (room.z0 + room.z1) / 2;
      const alongX = Math.abs(p.x - cx) / (room.x1 - room.x0) > Math.abs(p.z - cz) / (room.z1 - room.z0);
      const r = this.jitter(this.caveWallPts.length + 40);
      this.caveWallPts.push({ x: p.x + (alongX ? Math.sign(p.x - cx) * 0.5 : 0), z: p.z + (alongX ? 0 : Math.sign(p.z - cz) * 0.5), r, w: 3.4 + r * 1.4 });
    }
    this.buildCaveWalls(new THREE.DodecahedronGeometry(1), material(P.caveWall, 'rock'), 2);

    // standing stones: one instanced draw
    const stones = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.75, 1.05, 1, 6), material(P.caveWall, 'rock'), CAVE_PILLARS.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    CAVE_PILLARS.forEach((o, i) => {
      const h = PILLAR_HEIGHT * (0.85 + this.jitter(i + 7) * 0.3);
      stones.setMatrixAt(i, m.compose(pos.set(o.x, h / 2, o.z), q.setFromAxisAngle(up, i * 1.7), sc.set(o.r, h, o.r)));
    });
    stones.castShadow = stones.receiveShadow = true;
    stones.matrixAutoUpdate = false;
    this.scene.add(stones);

    // braziers: a stone bowl on a pedestal and a cold arcane flame (the forge stays the one warm thing). Only the hall's carries a real light
    const stand = mergeGeometries([new THREE.CylinderGeometry(0.3, 0.5, 0.9, 6).translate(0, 0.45, 0), new THREE.CylinderGeometry(0.62, 0.36, 0.34, 6).translate(0, 1.05, 0)])!;
    for (const [i, b] of BRAZIERS.entries()) {
      const g = new THREE.Group(), flame = mesh(new THREE.OctahedronGeometry(0.3).scale(1, 1.7, 1), P.arcane, 'glow', 'none');
      flame.position.y = 1.5;
      (flame.material as Mat).emissiveIntensity = 0.8;
      g.add(mesh(stand, P.stoneDark, 'stone', 'cast'), flame);
      g.position.set(b.x, 0, b.z);
      g.scale.setScalar(b.s);
      this.scene.add(g);
      this.caveFlames.push({ m: flame, phase: i * 2.3 });
      if (b.light) {
        this.hallLight = new THREE.PointLight(P.arcane, BRAZIER_LIGHT.intensity, BRAZIER_LIGHT.distance);
        this.hallLight.position.set(b.x, BRAZIER_LIGHT.y, b.z);
        this.scene.add(this.hallLight);
      }
    }

    // lights that follow the lantern (player, scaled by caveDepth) and the veins; both at zero outdoors, never added or removed (that would recompile every material)
    this.lantern = new THREE.PointLight(CAVE_LIGHT.lantern.color, 0, CAVE_LIGHT.lantern.distance);
    this.mithrilLight = new THREE.PointLight(P.arcane, 0, MITHRIL_LIGHT.distance);
    this.mithrilLight.position.set(MITHRIL_LIGHT.x, MITHRIL_LIGHT.y, MITHRIL_LIGHT.z);
    this.scene.add(this.lantern, this.mithrilLight);
  }

  /** (Re)build the wall rock from a geometry whose footprint is `unit` wide: the primitive first, the model once it loads. */
  private buildCaveWalls(geometry: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], unit: number) {
    if (this.caveWalls) { this.scene.remove(this.caveWalls); this.caveWalls.dispose(); }
    const im = this.caveWalls = new THREE.InstancedMesh(geometry, mat, this.caveWallPts.length), shade = new THREE.Color();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    this.caveWallPts.forEach((p, i) => {
      const s = p.w / unit;
      im.setColorAt(i, shade.setScalar(THREE.MathUtils.lerp(1, 0.3, THREE.MathUtils.clamp((-p.z - 30) / 10, 0, 1)))); // the rock goes dark past the threshold, so the way in reads as a way in
      im.setMatrixAt(i, m.compose(pos.set(p.x, -0.2, p.z), q.setFromAxisAngle(up, p.r * 40), sc.set(s, s * WALL_HEIGHT, s)));
    });
    im.castShadow = im.receiveShadow = true;
    im.matrixAutoUpdate = false;
    this.scene.add(im);
  }

  /** The cave floor: the rooms tinted per vertex like the outdoor ground, each room a hair above the last so overlaps do not shimmer. One draw. */
  private tintedFloor() {
    const a = new THREE.Color(P.caveFloor), b = new THREE.Color(P.caveFloorAlt), c = new THREE.Color();
    const rooms = CAVE_ROOMS.map(({ rect: r }, i) => {
      const w = r.x1 - r.x0, d = r.z1 - r.z0;
      const g = new THREE.PlaneGeometry(w, d, Math.max(1, Math.round(w / 3)), Math.max(1, Math.round(d / 3))).rotateX(-Math.PI / 2)
        .translate((r.x0 + r.x1) / 2, 0.02 * (i + 1), (r.z0 + r.z1) / 2);
      const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
      for (let v = 0; v < pos.count; v++) {
        c.copy(a).lerp(b, Math.abs(Math.sin(pos.getX(v) * 12.9898 + pos.getZ(v) * 78.233 + i * 977) * 43758.5453) % 1);
        c.toArray(col, v * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return g;
    });
    const m = mesh(mergeGeometries(rooms)!, 0xffffff, 'ground', 'receive');
    (m.material as Mat).vertexColors = true;
    return m;
  }

  /** Daylight to cave dark by `depth` (the sim's caveDepth at the player): sun, sky, ambient and fog fade, the lantern comes up. */
  private applyCaveLight(depth: number, x: number, z: number) {
    const mix = THREE.MathUtils.lerp;
    this.sun.intensity = mix(DAY.sun, CAVE_LIGHT.sun, depth);
    this.rim.intensity = mix(DAY.rim, CAVE_LIGHT.rim, depth);
    this.hemi.intensity = mix(DAY.hemi, CAVE_LIGHT.hemi, depth);
    this.scene.environmentIntensity = mix(DAY.env, CAVE_LIGHT.env, depth);
    this.scene.backgroundIntensity = mix(DAY.sky, CAVE_LIGHT.sky, depth);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.setHex(P.horizon).lerp(this.caveFogColor, depth);
    fog.near = mix(FOG.near, CAVE_LIGHT.fog.near, depth);
    fog.far = mix(FOG.far, CAVE_LIGHT.fog.far, depth);
    this.lantern.intensity = CAVE_LIGHT.lantern.intensity * depth;
    this.lantern.position.set(x, CAVE_LIGHT.lantern.y, z);
    this.mithrilLight.intensity = MITHRIL_LIGHT.intensity * depth * this.veinGlow;
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
    part(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 5), P.staffWood, 'wood', 1.3, 0.7, 0.15); // stand-in until the model loads
    part(new THREE.OctahedronGeometry(0.25), P.arcane, 'glow', 2.7, 0.7, 0.15);
    this.staffLight = new THREE.PointLight(P.arcane, 6, 7);
    this.staffLight.position.set(NPC.x + 0.7, 2.7, NPC.z + 0.15);
    this.scene.add(this.staffLight);
    this.scene.add(group);
    this.npcGroup = group;

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
    this.buildVendor();
  }

  /** The merchant: a stand-in made of primitives (no model slot yet) - a hatted figure in a brown cloak behind a pack-laden crate. */
  private buildVendor() {
    const group = new THREE.Group();
    group.position.set(VENDOR.x, 0, VENDOR.z);
    group.rotation.y = Math.atan2(0 - VENDOR.x, 6 - VENDOR.z);
    const part = (g: THREE.BufferGeometry, color: number, cls: MatClass, y: number, x = 0, z = 0) => {
      const m = mesh(g, color, cls, 'cast');
      m.position.set(x, y, z);
      group.add(m);
      this.vendorParts.push(m);
    };
    part(new THREE.ConeGeometry(0.75, 1.6, 6), 0x6b4a2c, 'cloth', 0.8);
    part(new THREE.SphereGeometry(0.3, 6, 4), P.skin, 'skin', 1.85);
    part(new THREE.ConeGeometry(0.55, 0.35, 6), 0x3a2a1a, 'cloth', 2.2); // wide hat brim
    part(new THREE.BoxGeometry(0.9, 0.7, 0.7), 0x5a4128, 'wood', 0.35, 1.2, 0.3); // crate
    part(new THREE.SphereGeometry(0.4, 6, 4), P.boar, 'hide', 0.95, 1.2, 0.3);    // sack on top
    part(new THREE.BoxGeometry(0.28, 0.28, 0.28), P.gold, 'metal', 0.8, 0.2, 0.55);
    this.scene.add(group);
  }

  // ---- models: each slot swaps in when its file is parsed; a slot that fails to load keeps its styled primitive ----

  private async populate(s: GameState) {
    const fill = (id: SlotId, apply: (p: Prepared) => void) =>
      loadSlot(id).then(apply).catch(err => console.warn(`model slot "${id}" kept as a primitive:`, err));
    const slots = new Set(s.enemies.map(e => slotOf(e.type)));
    await Promise.all([
      fill('player', p => this.dressPlayer(p)),
      fill('warden', p => this.dressNpc(p)),
      ...[...slots].map(t => fill(t, p => { for (const a of this.actors.values()) if (slotOf(a.type) === t) this.dressActor(a, p); })),
      Promise.all([loadSlot('tree'), loadSlot('stump')]).then(([t, st]) => this.dressTrees(t, st)).catch(err => console.warn('model slot "tree" kept as a primitive:', err)),
      fill('ironRock', p => { this.dressRocks('iron', p); this.dressRocks('mithril', p); }),
      fill('coalRock', p => this.dressRocks('coal', p)),
      fill('forge', p => this.dressForge(p)),
      fill('anvil', p => this.dressAnvil(p)),
      fill('caveRock', p => this.dressCave(p)),
      fill('boulder', p => this.dressBoundary(p)),
    ]);
  }

  /** Swap a primitive for a model: it stays in the scene as an invisible pick proxy (raycasts ignore material.visible). */
  private hide(...objs: THREE.Object3D[]) {
    for (const o of objs) o.traverse(c => {
      const m = c as THREE.Mesh;
      if (m.isMesh) { (m.material as Mat).visible = false; m.castShadow = m.receiveShadow = false; }
    });
  }

  /** Fixed per-id jitter so repeated props do not all face the same way; no rng state touched. */
  private jitter = (id: number) => Math.abs(Math.sin(id * 78.233) * 43758.5453) % 1;

  /** The knight plus the pieces bound to its bones. Everything is attached at the bind pose, before the first animation frame. */
  private async dressPlayer(p: Prepared) {
    const [helmet, pauldrons, sword] = await Promise.all(
      (['helmet', 'pauldrons', 'sword'] as const).map(id => loadSlot(id).catch(err => { console.warn(`model slot "${id}" skipped:`, err); return null; })));
    const inst = spawn(p);
    inst.root.updateMatrixWorld(true);
    // gear is mounted from the sim's equipment record every frame (see gear.ts); nothing is attached unconditionally
    this.gear = new PlayerGear(inst, { helmet, pauldrons, sword });
    this.hide(this.weapon);
    this.hide(this.player);
    this.player.add(inst.root);
    this.playerAnim = new Animator(inst.root, inst.clips, SLOTS.player.anim);
  }

  private dressNpc(p: Prepared) {
    const inst = spawn(p);
    // every primitive is replaced (they stay as invisible pick proxies). The wizard model carries no staff, so the arcane gem
    // and the quest light hang over his hand instead of on a second, primitive staff
    this.hide(...this.npcParts);
    this.npcGroup.add(inst.root);
    this.npcGroup.updateMatrixWorld(true);
    const hand = inst.root.getObjectByName(GEM_HAND);
    if (hand) {
      const gem = mesh(new THREE.OctahedronGeometry(0.16), P.arcane, 'glow', 'none');
      (gem.material as Mat).emissiveIntensity = 0.55; // arcane light, not a white blowout
      gem.scale.setScalar(1 / hand.getWorldScale(new THREE.Vector3()).x); // bone space is rig-scaled: undo it so the gem is in world units
      gem.position.copy(hand.worldToLocal(hand.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, GEM_LIFT, 0))));
      this.staffLight.position.copy(gem.position);
      hand.add(gem, this.staffLight);
    }
    this.npcAnim = new Animator(inst.root, inst.clips, SLOTS.warden.anim);
  }

  private dressActor(a: Actor, p: Prepared) {
    const inst = spawn(p, true);
    this.hide(a.body);
    this.hide(a.nose);
    a.group.add(inst.root);
    a.model = inst.root;
    a.mats = inst.materials;
    const tint = ENEMY_TYPES[a.type].look?.tint;
    for (const m of a.mats) { if (tint !== undefined) m.color.lerp(new THREE.Color(tint), TINT_MIX); m.emissive.setHex(a.glow); }
    a.anim = new Animator(inst.root, inst.clips, SLOTS[slotOf(a.type) as 'boar'].anim);
  }

  private dressTrees(tree: Prepared, stump: Prepared) {
    for (const v of this.nodes.values()) {
      if (v.type !== 'tree') continue;
      const id = v.group.userData.nodeId as number, r = this.jitter(id);
      const live = spawn(tree).root, cut = spawn(stump).root;
      for (const m of [live, cut]) {
        m.rotation.y = r * Math.PI * 2;
        m.scale.setScalar(m === live ? 0.9 + r * 0.25 : 1);
        m.updateMatrix();
        v.group.add(m);
      }
      cut.visible = false;
      v.live = live; v.stump = cut;
      if (v.crown) v.crown.visible = false;
      this.hide(...v.group.children.filter(c => c !== live && c !== cut));
    }
  }

  private dressRocks(type: 'iron' | 'coal' | 'mithril', p: Prepared) {
    for (const v of this.nodes.values()) {
      if (v.type !== type) continue;
      const id = v.group.userData.nodeId as number, inst = spawn(p, true);
      inst.root.rotation.y = this.jitter(id) * Math.PI * 2;
      inst.root.updateMatrix();
      this.hide(v.group.children[0]);
      v.group.add(inst.root);
      if (type === 'mithril') for (const m of inst.materials) { m.color.setHex(P.mithrilRock); m.emissive.setHex(P.mithrilGlow); }
      v.mats.push(...inst.materials);
      v.base.push(...inst.materials.map(m => m.color.getHex()));
    }
  }

  private dressForge(p: Prepared) {
    const f = LANDMARKS.forge, inst = spawn(p);
    this.hide(this.forgeParts[0], this.forgeParts[1]);
    inst.root.position.set(f.x, 0, f.z);
    this.scene.add(inst.root);
    freeze(inst.root);
    this.forgeParts.push(inst.root);
  }

  private dressAnvil(p: Prepared) {
    const f = LANDMARKS.forge, inst = spawn(p);
    this.hide(this.forgeParts[3]);
    inst.root.position.set(f.x - 3, 0, f.z + 2);
    this.scene.add(inst.root);
    freeze(inst.root);
  }

  /** Mouth rocks sit on the sim's collider circles (scaled so the model's footprint matches), with more heaped over them; the wall rock is rebuilt from the model. */
  private dressCave(p: Prepared) {
    const side = SLOTS.caveRock.footprint;
    this.hide(...this.caveRocks);
    const rocks = [...CAVE_MOUTH.map(o => ({ x: o.x, y: -0.2, z: o.z, w: o.r * 2.2 })), ...MOUTH_TOPS];
    rocks.forEach((o, i) => {
      const inst = spawn(p);
      inst.root.position.set(o.x, o.y, o.z);
      inst.root.rotation.y = i * 2.1;
      inst.root.scale.setScalar(o.w / side);
      this.scene.add(inst.root);
      freeze(inst.root);
    });
    this.buildCaveWalls(p.geometry!, p.materials.length === 1 ? p.materials[0] : p.materials, side);
  }

  /** The 80-odd boundary boulders become one instanced draw: a single scene object instead of one per rock. */
  private dressBoundary(p: Prepared) {
    const im = new THREE.InstancedMesh(p.geometry!, p.materials.length === 1 ? p.materials[0] : p.materials, this.boundary.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    this.boundary.forEach((b, i) => {
      const r = this.jitter(i + 1);
      sc.setScalar(0.8 + r * 0.45);
      m.compose(pos.set(b.position.x, -0.25, b.position.z), q.setFromAxisAngle(up, r * 40), sc);
      im.setMatrixAt(i, m);
      this.scene.remove(b);
      b.geometry.dispose(); (b.material as Mat).dispose();
    });
    this.boundary = [];
    im.castShadow = im.receiveShadow = true;
    im.matrixAutoUpdate = false;
    this.scene.add(im);
  }

  private resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.post.setSize(innerWidth, innerHeight);
  }

  /** Every rock the cave camera must not clip, as discs on the floor plan. Built once the wall boulders exist. */
  private cameraRocks: { x: number; z: number; r: number }[] = [];
  private pullCameraInside(fx: number, fy: number, fz: number) {
    if (!this.cameraRocks.length) {
      this.cameraRocks = [...this.caveWallPts.map(p => ({ x: p.x, z: p.z, r: p.w * CAMERA_ROCK_FILL })), ...CAVE_PILLARS, ...CAVE_MOUTH.map(o => ({ x: o.x, z: o.z, r: o.r * 1.1 }))];
    }
    const c = this.camera.position, dx = c.x - fx, dz = c.z - fz, len2 = dx * dx + dz * dz;
    const onFloor = (k: number) => { const p = { x: fx + dx * k, z: fz + dz * k }, o = clampToWorld(p, CAMERA_FLOOR_MARGIN); return o.x === p.x && o.z === p.z; };
    let k = 1;
    while (k > CAMERA_MIN_PULL && !onFloor(k)) k -= 0.05;
    for (const o of this.cameraRocks) {
      const r = o.r + CAMERA_ROCK_MARGIN, ox = o.x - fx, oz = o.z - fz;
      if (ox * ox + oz * oz < r * r) continue; // the player is standing in this one
      const tc = (ox * dx + oz * dz) / len2, miss2 = (ox - dx * tc) ** 2 + (oz - dz * tc) ** 2; // tc: closest approach along the ray, 0..1
      if (tc > 0 && miss2 < r * r) k = Math.min(k, tc - Math.sqrt((r * r - miss2) / len2));
    }
    k = Math.max(k, CAMERA_MIN_PULL);
    c.set(fx + dx * k, fy + (c.y - fy) * k, fz + dz * k);
  }

  get quality() { return this.post.quality; }
  setQuality(q: Quality) { this.post.setQuality(q); }

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
      const coal = n.type === 'coal', mithril = n.type === 'mithril';
      part(new THREE.DodecahedronGeometry(1.3), coal ? P.coalRock : mithril ? P.mithrilRock : P.ironRock, 'rock', 0.9);
      // ore flecks: rust for iron, glossy black for coal, cold arcane light for mithril
      for (const [dx, dy, dz] of [[0.7, 1.2, 0.6], [-0.6, 1.0, 0.8], [0.1, 1.6, -0.5]]) {
        const fleck = part(new THREE.OctahedronGeometry(0.28), coal ? P.coalFleck : mithril ? P.arcane : P.ironFleck, coal ? 'coal' : mithril ? 'beacon' : 'ore', dy);
        if (!coal && !mithril) (fleck.material as Mat).emissive.setHex(P.ironFleck).multiplyScalar(0.35); // faint ember glint so a node reads at range
        fleck.position.x = dx; fleck.position.z = dz;
      }
    }
    this.scene.add(group);
    this.nodes.set(n.id, { group, type: n.type, crown, mats, base: mats.map(m => m.color.getHex()) });
  }

  private drawNodes(s: GameState) {
    const now = performance.now() / 1000;
    const active = s.player.action?.k === 'gather' ? s.player.action.nodeId : -1;
    let vein = 0;
    for (const n of s.nodes) {
      const v = this.nodes.get(n.id)!;
      const depleted = n.charges <= 0;
      if (n.type === 'mithril' && !depleted) vein++;
      if (v.crown) v.crown.visible = !depleted; // a felled tree leaves a stump
      else v.group.scale.setScalar(depleted ? 0.4 : 1);
      if (v.live) { v.live.visible = !depleted; v.stump!.visible = depleted; }
      v.mats.forEach((m, i) => { const spent = depleted && !v.crown; m.color.setHex(spent ? P.spent : v.base[i]); m.emissiveIntensity = spent ? 0 : 1; });
      v.group.rotation.z = n.id === active ? Math.sin(now * 18) * 0.05 : 0;
    }
    this.veinGlow = vein / CAVE_ROCKS.filter(r => r.type === 'mithril').length;
  }

  private addActor(e: Enemy) {
    const def = ENEMY_TYPES[e.type];
    const slot = slotOf(e.type), color = slot === 'boar' ? P.boar : slot === 'wolf' || slot === 'pup' ? P.wolf : slot === 'hexer' ? P.robe : P.brute;
    const group = new THREE.Group();
    const mat = material(color, 'hide');
    const body = new THREE.Mesh(
      slot === 'brute' ? new THREE.BoxGeometry(1.6, 2.2, 1.2) : new THREE.CapsuleGeometry(def.radius * 0.8, def.radius * 1.2, 2, 6).rotateX(Math.PI / 2),
      mat);
    body.castShadow = body.receiveShadow = true;
    body.position.y = slot === 'brute' ? 1.5 : def.radius + 0.2;
    body.userData.enemyId = e.id;
    group.add(body);
    const glow = emissiveOf(e.type);
    if (def.look) mat.color.lerp(new THREE.Color(def.look.tint), TINT_MIX);
    mat.emissive.setHex(glow);
    // snout/fist so facing is readable on the placeholder body; the model carries its own face
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.5), material(P.bone, 'skin'));
    nose.castShadow = true;
    nose.position.set(0, body.position.y + 0.1, def.radius + 0.4);
    nose.userData.enemyId = e.id;
    group.add(nose);
    const ring = new THREE.Mesh(new THREE.RingGeometry(def.radius * 1.15, def.radius * 1.5, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: P.blood, transparent: true, opacity: RING_OPACITY, fog: false, depthWrite: false }));
    ring.position.y = 0.06;
    ring.renderOrder = 1;
    ring.raycast = () => {}; // a ground mark, not a click target
    group.add(ring);
    group.scale.setScalar(1);
    this.scene.add(group);
    let tele: Actor['tele'];
    if (def.heavy) tele = this.makeTele(def.heavy.radius); // the ground circle a slam lands in: an outline that stays, and a fill that grows to meet it
    this.actors.set(e.id, { group, body, nose, ring, tele, mats: [mat], type: e.type, scale: lookScale(e.type), glow, px: e.x, pz: e.z, cx: e.x, cz: e.z, swing: 0, flash: 0, dead: false, t: e.id });
  }

  /** A danger circle on the ground: an outline that pulses and a fill that grows to meet it. The radius is fixed per type. */
  private makeTele(r: number): NonNullable<Actor['tele']> {
    const tm = (o: number) => new THREE.MeshBasicMaterial({ color: P.blood, transparent: true, opacity: o, fog: false, depthWrite: false, side: THREE.DoubleSide });
    const outline = new THREE.Mesh(new THREE.RingGeometry(r - 0.12, r, 48).rotateX(-Math.PI / 2), tm(0.85));
    const fill = new THREE.Mesh(new THREE.CircleGeometry(r, 48).rotateX(-Math.PI / 2), tm(0.3));
    const root = new THREE.Group();
    root.add(outline, fill);
    for (const m of [outline, fill]) { m.raycast = () => {}; m.renderOrder = 2; }
    root.position.y = 0.08;
    root.visible = false;
    this.scene.add(root);
    return { root, fill, outline };
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
          this.playerAnim?.react(ev.heavy ? 1.6 : 0.8);
          this.shakeMag = Math.max(this.shakeMag, ev.heavy ? 0.4 : 0.12);
          this.particles.burst(ev.x, 1.2, ev.z, { color: [P.blood, P.bloodLight], count: ev.heavy ? 30 : 12, speed: ev.heavy ? 6 : 4, life: 0.5 });
          const src = ev.src === undefined ? undefined : s.enemies.find(e => e.id === ev.src);
          if (src && ENEMY_TYPES[src.type].ranged) this.particles.trail(src.x, 1.7, src.z, ev.x, 1.3, ev.z, P.violet); // the bolt
        } else {
          this.shakeMag = Math.max(this.shakeMag, ev.crit ? 0.2 : ev.slot === 1 || ev.slot === 4 ? 0.14 : 0.04);
          if (!ev.dot) this.actors.get(ev.target as number)?.anim?.react(ev.crit || ev.slot === 1 || ev.slot === 4 ? 1.5 : 1); // the recoil is the proof the blow landed
          this.impact(s, ev);
        }
      } else if (ev.t === 'cast') {
        this.castPunch = 0.12;
        if (ev.slot !== 3 && this.playerAnim) { // slot 3 is the heal: no swing; the cleave takes the heavy swing
          this.playerAnim.attack(ev.slot === 1 || ev.slot === 4);
          this.slashes.swipe(s.player.x, s.player.z, s.player.facing, ev.slot === 1 || ev.slot === 4);
        }
        if (ev.slot === 4) { // the sweep: a wide arc of dust and light in front of the player
          const p = s.player, a = p.facing;
          this.rings.pulse(p.x + Math.sin(a) * 1.4, 0.3, p.z + Math.cos(a) * 1.4, P.arcaneLight, 3.8, 0.28, 1.2);
          for (let k = -2; k <= 2; k++) this.particles.burst(p.x + Math.sin(a + k * 0.45) * 2.2, 1.0, p.z + Math.cos(a + k * 0.45) * 2.2, { color: [P.arcaneLight, P.ash], count: 6, speed: 2.5, life: 0.35 });
        }
      }
      else if (ev.t === 'swing' && this.playerAnim) { this.playerAnim.swung(); this.slashes.swipe(s.player.x, s.player.z, s.player.facing); } // auto-attack: raises no 'cast', the hit follows this tick
      else if (ev.t === 'jump') this.playerAnim?.jump(JUMP_AIRTIME);
      else if (ev.t === 'land') {
        this.playerAnim?.touchdown();
        this.particles.burst(ev.x, 0.15, ev.z, { color: [P.ash], count: 8, speed: 2.2, flat: true, life: 0.35 });
      }
      else if (ev.t === 'slam') {
        this.particles.burst(ev.x, 0.3, ev.z, { color: [P.ash, P.bloodLight, P.ember], count: 40, speed: 7, up: 2, life: 0.8 });
        this.rings.pulse(ev.x, 0.15, ev.z, P.blood, ev.radius * 1.15, 0.5, ev.radius * 0.3);
        this.shakeMag = Math.max(this.shakeMag, Math.hypot(ev.x - s.player.x, ev.z - s.player.z) < ev.radius ? 0.35 : 0.2);
      } else if (ev.t === 'interrupt') {
        this.particles.burst(ev.x, 1.6, ev.z, { color: [P.gold, P.arcaneLight], count: 30, speed: 5, up: 1, life: 0.5 });
        this.rings.pulse(ev.x, 1.4, ev.z, P.gold, 2, 0.3);
        this.shakeMag = Math.max(this.shakeMag, 0.12);
      } else if (ev.t === 'blocked') {
        this.particles.burst(ev.x, 1.5, ev.z, { color: [P.ash, P.arcaneLight], count: 10, speed: 3, life: 0.35 }); // the shot spends itself on the rock
      } else if (ev.t === 'unlock') {
        const p = s.player;
        this.particles.burst(p.x, 0.4, p.z, { color: [P.gold, P.ember, P.arcaneLight], count: 36, speed: 2.5, up: 5, gravity: -3, life: 1.1 });
        this.rings.pulse(p.x, 0.2, p.z, P.gold, 2.6, 0.7);
      } else if (ev.t === 'heal') {
        this.particles.burst(ev.x, 0.4, ev.z, { color: [P.heal, P.arcaneLight], count: 24, speed: 1.6, up: 3.5, gravity: -1, life: 1 });
        this.rings.pulse(ev.x, 0.15, ev.z, P.heal, 2.2, 0.6);
      } else if (ev.t === 'levelup') {
        this.levelRingAge = 0;
        this.shakeMag = Math.max(this.shakeMag, 0.1);
        const p = s.player;
        this.particles.burst(p.x, 0.3, p.z, { color: [P.gold, P.arcaneLight, P.ember], count: 70, speed: 3, up: 8, gravity: -6, life: 1.4 });
        this.rings.pulse(p.x, 0.2, p.z, P.gold, 4, 0.9);
      } else if (ev.t === 'kill') {
        const type = s.enemies.find(e => e.id === ev.id)!.type, big = slotOf(type) === 'brute';
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

  /** True when the click lands on the merchant. */
  pickVendor(clientX: number, clientY: number): boolean {
    this.raycaster.setFromCamera(
      new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1), this.camera);
    return this.raycaster.intersectObjects(this.vendorParts, false).length > 0;
  }

  /** True when the click lands on the quest giver. */
  pickNpc(clientX: number, clientY: number): boolean {
    this.raycaster.setFromCamera(
      new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1), this.camera);
    return this.raycaster.intersectObjects([...this.npcParts, this.npcMarker], false).length > 0;
  }

  /**
   * Enemy id under a screen position, or null. Hit volumes are sized from the model that is drawn (SLOTS height), not from
   * the primitive the model replaced: a chain of spheres up the body, tested in screen pixels. `tolerance` is extra
   * pixels of forgiveness around the silhouette (0 = the body itself). Several candidates resolve deterministically:
   * nearest to the cursor (inside the body counts as 0), then nearest to the camera.
   */
  pickEnemy(clientX: number, clientY: number, tolerance = 0): number | null {
    const focal = innerHeight / 2 / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const v = new THREE.Vector3();
    let best: { id: number; miss: number; depth: number } | null = null;
    for (const [id, a] of this.actors) {
      if (!a.group.visible || a.dead) continue;
      const { height, radius } = pickVolume(a.type);
      let miss = Infinity, depth = Infinity;
      for (let i = 0; i <= PICK_SPHERES; i++) {
        v.set(a.group.position.x, (height * i) / PICK_SPHERES, a.group.position.z).applyMatrix4(this.camera.matrixWorldInverse);
        if (-v.z <= this.camera.near) continue; // behind the camera
        const k = focal / -v.z, d = Math.hypot(v.x * k + innerWidth / 2 - clientX, -v.y * k + innerHeight / 2 - clientY) - radius * k;
        if (d < miss) miss = d;
        depth = Math.min(depth, -v.z);
      }
      miss = Math.max(0, Math.round(miss)); // whole pixels: two enemies both under the cursor tie, and the nearer one wins
      if (miss > tolerance) continue;
      if (!best || miss < best.miss || (miss === best.miss && depth < best.depth)) best = { id, miss, depth };
    }
    return best ? best.id : null;
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
    const hit = this.raycaster.intersectObjects([this.ground, this.caveFloor])[0];
    return hit ? { x: hit.point.x, z: hit.point.z } : null;
  }

  draw(s: GameState, alpha: number) {
    const x = this.prev.x + (this.curr.x - this.prev.x) * alpha;
    const z = this.prev.z + (this.curr.z - this.prev.z) * alpha;
    this.castPunch = Math.max(0, this.castPunch - 1 / 60);
    const nowMs = performance.now(), dtFx = Math.min(0.1, (nowMs - this.lastDraw) / 1000);
    this.lastDraw = nowMs;
    this.particles.update(dtFx);
    this.motes.update(dtFx);
    this.rings.update(dtFx);
    this.slashes.update(dtFx);
    const mk = markerOf(s);
    this.npcMarker.visible = !!mk;
    if (mk) {
      (this.npcMarker.material as THREE.SpriteMaterial).map = this.markerTex[mk];
      this.npcMarker.position.set(NPC.x, 3.5 + 0.18 * Math.sin(nowMs / 250), NPC.z);
    }
    const pa = this.playerAnim, pl = s.player;
    this.player.rotation.y = pl.facing;
    if (pa) {
      if (pl.dead !== this.playerWasDead) { if (pl.dead) pa.die(); else pa.revive(); this.playerWasDead = pl.dead; }
      pa.locomotion(pl.moving && !pl.dead, 6);
      pa.update(dtFx);
      pa.airborne(pl.airborne ? pl.vy : 0);
      // auto-attack's swing timer is the sim's, so the wind-up can start early enough that the strike lands on the beat
      const tgt = pl.autoAttack && !pl.dead && s.targetId !== null ? s.enemies.find(e => e.id === s.targetId) : undefined;
      if (tgt && Math.hypot(tgt.x - pl.x, tgt.z - pl.z) <= AUTO_RANGE) pa.anticipate(pl.swing);
      this.player.position.set(x, pl.y, z); // pl.y: the sim's jump offset, presentation only
      this.player.rotation.x = pl.dead && !pa.hasDeath ? -Math.PI / 2 : 0;
      this.player.scale.setScalar(1);
    } else {
      this.player.position.set(x, (pl.dead ? 0.5 : 1) + pl.y, z);
      this.player.rotation.x = pl.dead ? -Math.PI / 2 : 0;
      this.player.scale.setScalar(1 + this.castPunch * 1.2);
    }
    if (this.npcAnim) { this.npcAnim.locomotion(false); this.npcAnim.update(dtFx); }

    for (const e of s.enemies) this.drawActor(e, alpha, dtFx);
    this.drawDrops(s);
    this.drawNodes(s);
    if (this.gear) this.gear.sync(s.player.equipment, dtFx, this.motes);
    else { // primitive fallback until (or unless) the knight model loads
      const w = s.player.equipment.weapon;
      this.weapon.visible = !!w;
      if (w) (this.weapon.material as Mat).color.setHex(TIER_COLORS[ITEMS[w].tier]);
    }

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
    // it rides half of a jump: a pure translation (the view angle never changes), so the hop reads without the horizon lurching
    const cp = Math.cos(this.pitch), lift = pl.y * CAMERA_JUMP_FOLLOW;
    this.camera.position.set(
      x + Math.sin(this.yaw) * cp * this.distance,
      Math.max(0.5, 1.5 + lift + Math.sin(this.pitch) * this.distance),
      z + Math.cos(this.yaw) * cp * this.distance);
    if (inCave(x, z)) this.pullCameraInside(x, 1.5 + lift, z);
    this.shakeMag *= 0.88;
    if (this.shakeMag > 0.005) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeMag;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeMag;
    }
    this.camera.lookAt(x, 1.5 + lift, z);
    if (this.debugCam) { this.camera.position.fromArray(this.debugCam.pos); this.camera.lookAt(...(this.debugCam.at as [number, number, number])); } // dev only: bench/look.mjs close-ups
    this.forgeLight.intensity = FORGE_LIGHT.intensity * (1 + 0.07 * Math.sin(nowMs / 90) + 0.05 * Math.sin(nowMs / 37));
    this.applyCaveLight(caveDepth(x, z), x, z);
    this.caveFlames.forEach(f => f.m.scale.set(1, 0.85 + 0.25 * Math.sin(nowMs / 110 + f.phase) + 0.1 * Math.sin(nowMs / 47 + f.phase), 1));
    if (this.hallLight) this.hallLight.intensity = BRAZIER_LIGHT.intensity * (1 + 0.08 * Math.sin(nowMs / 100) + 0.05 * Math.sin(nowMs / 41));
    this.followSun(x, z);
    this.post.render(this.scene);
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
        (gem.material as Mat).emissive.setHex(color).multiplyScalar(1.6);
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

  private drawActor(e: Enemy, alpha: number, dt: number) {
    const a = this.actors.get(e.id)!;
    const g = a.group, an = a.anim, dead = e.state === 'dead';
    g.visible = !dead || e.deadFor < 2;
    g.position.set(a.px + (a.cx - a.px) * alpha, 0, a.pz + (a.cz - a.pz) * alpha);
    // past the fog a model is invisible but still costs a skinned draw and a mixer update: skip both
    if (an && Math.hypot(g.position.x - this.camera.position.x, g.position.z - this.camera.position.z) > FOG_CULL) { g.visible = false; if (a.tele) a.tele.root.visible = false; if (a.ground) a.ground.root.visible = false; a.swing = e.swing; a.flash = e.hitFlash; return; }
    g.rotation.y = e.facing;
    let lunge = 1 + e.swing * 2, shrink = Math.max(0.05, 1 - e.deadFor / 2), fall = dead;
    if (an) {
      const speed = ENEMY_TYPES[a.type].speed, moving = !dead && Math.hypot(a.cx - a.px, a.cz - a.pz) > 1e-3;
      if (dead !== a.dead) { if (dead) an.die(); else an.revive(); }
      if (!dead && e.swing > a.swing) an.attack();
      lunge = 1; // the swing is a clip or a procedural lunge on the model, never a scale pop
      an.locomotion(moving, speed);
      an.telegraph(e.cast && !dead ? e.cast.kind : null, e.cast ? e.cast.t / e.cast.total : 0);
      an.update(dt);
      // every animated rig topples or plays its death, holds, then shrinks away
      if (an.hasDeath) { fall = false; shrink = e.deadFor < 1 ? 1 : Math.max(0.05, 2 - e.deadFor); }
    }
    a.swing = e.swing; a.flash = e.hitFlash; a.dead = dead;
    g.rotation.z = fall ? Math.PI / 2 : 0;
    g.position.y = fall ? ENEMY_TYPES[e.type].radius : 0;
    g.scale.setScalar((dead ? shrink : lunge) * a.scale); // shrink away when dead
    // the tell: a wind-up reddens and swells the model (and leans it back), and a heavy fills its ground circle until it lands
    const wind = e.cast && !dead ? e.cast.t / e.cast.total : 0;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / (90 - 50 * wind));
    if (wind > 0 && !an) { g.scale.multiplyScalar(1 + 0.12 * wind); if (a.model) a.model.rotation.x = -0.3 * wind; } // primitives (models not yet loaded) keep the old swell
    if (a.tele) {
      a.tele.root.visible = e.cast?.kind === 'heavy' && !dead;
      a.tele.root.position.set(g.position.x, 0.08, g.position.z);
      a.tele.fill.scale.set(wind, 1, wind);
      (a.tele.fill.material as THREE.MeshBasicMaterial).opacity = 0.2 + 0.4 * wind;
      (a.tele.outline.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.5 * pulse;
    }
    const gc = e.cast?.kind === 'ground' && !dead ? e.cast : null; // the mark under the player: drawn from state, so it needs no event
    if (gc) a.ground ??= this.makeTele(gc.radius!);
    if (a.ground) {
      a.ground.root.visible = !!gc;
      if (gc) {
        a.ground.root.position.set(gc.x!, 0.08, gc.z!);
        a.ground.fill.scale.set(wind, 1, wind);
        (a.ground.fill.material as THREE.MeshBasicMaterial).opacity = 0.2 + 0.4 * wind;
        (a.ground.outline.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.5 * pulse;
      }
    }
    if (dead) for (const m of a.mats) m.emissive.setHex(0x000000); // a corpse takes no hostile tint and no hit flash (hitFlash stops ticking on death)
    else if (e.hitFlash > 0) for (const m of a.mats) m.emissive.setHex(P.bloodLight);
    else if (wind > 0) for (const m of a.mats) m.emissive.setRGB(0.12 + 0.38 * wind * (0.6 + 0.4 * pulse), 0.06, 0.03);
    else for (const m of a.mats) m.emissive.setHex(a.glow);
    if (e.stagger > 0 && !dead) for (const m of a.mats) m.emissive.setRGB(0.5, 0.45, 0.1); // stunned: a dull gold flash
    a.ring.scale.setScalar(wind > 0 ? 1 + 0.25 * pulse : 1);
    a.ring.visible = !dead && Math.hypot(g.position.x - this.camera.position.x, g.position.z - this.camera.position.z) < FOG.far;
  }
}

interface Actor {
  group: THREE.Group;
  body: THREE.Mesh;
  nose: THREE.Mesh;
  ring: THREE.Mesh;
  tele?: { root: THREE.Group; fill: THREE.Mesh; outline: THREE.Mesh };
  /** The mark a 'ground' cast lays under the player: made on first use, at the spot the sim fixed. */
  ground?: { root: THREE.Group; fill: THREE.Mesh; outline: THREE.Mesh };
  scale: number; glow: number; // the look's scale, and the emissive an idle model rests at
  mats: Mat[];
  type: string;
  px: number; pz: number; cx: number; cz: number;
  swing: number; flash: number; // last seen sim timers: a rise is an attack / a hit landing
  dead: boolean;
  t: number; // per-actor phase for procedural bob
  model?: THREE.Object3D;
  anim?: Animator;
}

interface NodeView { group: THREE.Group; type: string; crown?: THREE.Mesh; live?: THREE.Object3D; stump?: THREE.Object3D; mats: Mat[]; base: number[] }
interface DropView { group: THREE.Group; gem: THREE.Mesh; hit: THREE.Mesh }
