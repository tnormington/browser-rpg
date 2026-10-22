// Rendering only: reads GameState, never mutates it.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GameState, GameEvent, Enemy, LANDMARKS, ResourceNode, TOWNS, WORLD_HALF } from './sim';
import { floorLift, roomIndices } from './floor-stack';
import { CAVE_MOUTH, CAVE_ROCKS, COLLIDERS, CAVE_PILLARS, CAVE_ROOMS, REGIONS, WITHERING, caveDepth, caveWallPoints, clampToWorld, dungeonAt, inCave, perchAt, regionAt } from './sim/world';
import { ABILITIES, ENEMY_TYPES, defOf, AUTO_RANGE, SPAWNS, GRAVITY, FALL_GRAVITY } from './sim/data';
import { ITEMS, TIER_COLORS } from './sim/items';
import { GATHER_STRIKE, NODE_TYPES, nodeById } from './sim/gathering';
import { HARBOURMASTER, HIGH_STEWARD, NPC, SPIRE_KEEPER, THORN_REEVE, harbourMarker as harbourMarkOf, keeperMarker as keeperMarkOf, npcMarker as markerOf, reeveMarker as reeveMarkOf, stewardMarker as stewardMarkOf } from './sim/quest';
import { nearestSite, stationSites } from './sim/crafting';
import { VENDOR } from './sim/shop';
import { CHESTS, isOpened } from './sim/chests';
import { BOARDS } from './sim/bounties';
import { Motes, Particles, Rings, Slashes } from './fx';
import { PostStack, Quality } from './post';
import { Weather } from './weather';
import { SkyDome, Rain } from './sky';
import { BOULDERS_PER_FACTOR, ringPoints } from './sim/stress';
import { Animator, LEAD, TELLS } from './anim';
import { SILHOUETTES, Silhouette, mergeParts } from './creatures';
import { PROPS, PropId } from './props';
import { ECHO_BODY, ECHO_GLOW, ECHO_MIX, ECHO_RIM, ECHO_SHIMMER, EchoBand, echoBand, echoLevelOf } from './echo-look';
import { PlayerGear } from './gear';
import { MountRig, MOUNT_LOOKS, mountLookId } from './mount';
import { FOOT_SPEED, bestMount, moveSpeed } from './sim/mounts';
import { ROLL_SPEED, ROLL_TIME, SPRINT_SPEED, canDoubleJump } from './sim/agility';
import { BEACON_INTENSITY, cappedIntensity } from './glow';
import { HaloSpot, haloMesh, tickHalos } from './halo';
import { SLOTS, SlotId, Prepared, loadSlot, spawn, freeze } from './models';
import { WorldView, flightMasterFigure, hasTop, headstones, standableRocks, Kit } from './world-view';
import { WorldMap, mapPosition } from './world-map';
import { landingSpot } from './sim/flight';
import { GROUND_CELL, bakeUV, dress, groundDrift, hasSurface } from './surface';
import type { Pick } from './cursor';

/**
 * Every colour in the scene, in one place. Moonlit rather than drained (HOM-149): the terrain keeps its hues at a value
 * you can actually read, instead of sitting in a near-black band, so the world is still night and still cold but a green
 * reads as green. Saturation is still *spent* on fire (forge, gold), blood (enemies, damage) and arcane light (quest,
 * magic): those stay the brightest, most saturated things in the frame, and nothing here may catch them up.
 */
const PALETTE = {
  // terrain: moonlit green, earth, cold slate
  grass: 0x465a3b, grassAlt: 0x556a47, beyond: 0x2a3326, dirt: 0x6a6555, dirtAlt: 0x59574c,
  slate: 0x626e7c, slateDark: 0x4b545f, boulder: 0x5a616b, cave: 0x040405, caveFloor: 0x3a404b, caveFloorAlt: 0x454c59, caveWall: 0x454d59,
  stone: 0x767b85, stoneDark: 0x51555d, anvil: 0x1b1c20,
  bark: 0x614c39, pine: 0x416b4a,
  // ore: the flecks are the one warm, light accent on a rock so a node reads at distance
  ironRock: 0x828893, coalRock: 0x3c3e46, ironFleck: 0xd9803c, coalFleck: 0x5a5d70, spent: 0x3c3e44,
  // actors
  player: 0x93a1b0, skin: 0xc4a584, bone: 0xd9ceb2, steel: 0xb8bcc4,
  boar: 0x8d6349, wolf: 0xa8a89f, brute: 0x923a3a,
  robe: 0x76578f, hood: 0x513e63, staffWood: 0x614c39,
  // the three saturated families
  fire: 0xff6a1a, ember: 0xffb040, gold: 0xffc84a, forgeLight: 0xff7a2a,
  blood: 0xd02424, bloodDark: 0x701010, bloodLight: 0xff7a5a,
  arcane: 0x6ad8ff, arcaneLight: 0xc4efff, violet: 0xb070ff, heal: 0x5affd0,
  // atmosphere
  moon: 0xc3d2e4, rim: 0x7fa0c0, skyZenith: 0x1a2b50, skyMid: 0x27405a, horizon: 0x3a4e62, skyGround: 0x161c24, hemiSky: 0x7390b4, hemiGround: 0x303a30,
  ash: 0xa8a49a, smoke: [0xbbbbbb, 0x888888] as number[],
} as const;
const P = PALETTE;
/** What a blow lands on decides what comes off it: flesh bleeds, stone and armour throw sparks and grit, the unquiet shed bone and cold light. */
const STONE = /golem|colossus|cairn|stonehorn|hollow_knight|^warden$|spire_warden/, UNQUIET = /wight|barrow_lord|grave_hound|drowned|void_hound/;
const BLOOD = [PALETTE.blood, PALETTE.bloodDark, PALETTE.bloodDark];
const matterOf =(type: string): 'flesh' | 'stone' | 'bone' => STONE.test(type) ? 'stone' : UNQUIET.test(type) ? 'bone' : 'flesh';
/** The abilities that have a look of their own, by the slot the book holds them in (the book grows at the end, so none of these move). */
const slotNamed = (name: string) => ABILITIES.findIndex(a => a.name === name);
const FINAL_RECKONING = slotNamed('Final Reckoning'), BLOODBATH = slotNamed('Bloodbath'), SHOCKWAVE = slotNamed('Shockwave');
/** A blow that lands with weight: a crushing one, a sweep, or anything that carries two and a half weapons or more (Colossus Blow, Reaping Blow, Final Reckoning). */
const weighty = (a?: { tag?: string; kind: string; weaponMult?: number }) => !!a && (a.tag === 'crush' || a.kind === 'cleave' || (a.weaponMult ?? 1) >= 2.5);
/** The colours of a blade's trail when it is not plain steel: the capstone's, a blood-drinker's, and the echo Echo Surge leaves a beat behind a blow. */
const TRAIL = { capstone: new THREE.Color(PALETTE.ember).multiplyScalar(1.5), blood: new THREE.Color(PALETTE.bloodLight).multiplyScalar(1.1), echo: new THREE.Color(PALETTE.gold).multiplyScalar(1.1) };
/** The ground-plane vector (x, z) scaled to length 1; a zero vector points straight ahead. */
const unit = (x: number, z: number): [number, number] => { const d = Math.hypot(x, z); return d < 1e-4 ? [0, 1] : [x / d, z / d]; };
type Mat = THREE.MeshStandardMaterial;
/** Roughness / metalness per material class. */
const MATERIALS = {
  ground: [0.95, 0], dirt: [0.98, 0], foliage: [0.85, 0], wood: [0.8, 0], bark: [0.95, 0], rock: [0.9, 0], stone: [0.85, 0],
  plaster: [0.92, 0], roof: [0.88, 0],
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
  // the class's shared detail and normal maps (surface.ts): flat colour, with relief for the key light to catch
  dress(m, cls);
  // glow: a lit emitter, self-lit and capped under the bloom threshold (glow.ts). beacon: a thin marker meant to cross it and bloom.
  if (cls === 'glow' || cls === 'beacon') { m.emissive.setHex(color); m.emissiveIntensity = cls === 'beacon' ? BEACON_INTENSITY : cappedIntensity(color, BEACON_INTENSITY); }
  if (cls === 'glow') m.color.multiplyScalar(EMITTER_DIFFUSE); // an emitter shows its own light, not the room's: a light parked beside it would otherwise wash it to white
  return m;
};
const mesh = (g: THREE.BufferGeometry, color: number, cls: MatClass, shadow: 'cast' | 'receive' | 'both' | 'none' = 'both') => {
  const m = new THREE.Mesh(hasSurface(cls) ? bakeUV(g) : g, material(color, cls));
  m.castShadow = shadow === 'cast' || shadow === 'both';
  m.receiveShadow = shadow === 'receive' || shadow === 'both';
  return m;
};

/** The ground hazards that are a thing falling (not a cloud or a burst): their mark draws a stone dropping into the ring from FALL_HEIGHT. */
const FALLING = new Set(['Falling Stone', 'Falling Rock']), FALL_HEIGHT = 5;
/** Where the cave floors lift and what they must stay under: see floor-stack.ts. RUNE_Y is the dressing's own height, under the ground marks. */
const RUNE_Y = 0.055;
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
/** How far the eye carries on a clear night (HOM-149: was 6..42, a wall of haze at the edge of the combat arena). `clear` in weather.ts mirrors it; the rest only take distance away. */
const FOG = { near: 12, far: 85 };
/** Actors past this camera distance are not drawn or animated. Strictly beyond FOG.far, where fog is already 100%: nothing still meant to be visible is culled. */
const FOG_CULL = FOG.far + 8;
/** The fens' air: lifted and green-grey, a long open view. The Thornwood's: a dark green close about the player, the opposite of the fens. */
const FEN_AIR = { color: new THREE.Color(0x5c8073) }, WOOD_AIR = { color: new THREE.Color(0x3d6349) };
/** Withering Ground's circle: a sick yellow-green edge over a murkier fill, nowhere near the red of a mark that is about to land. */
const WITHER_EDGE = 0xb4c85a, WITHER_FILL = 0x5f7228;
/** The Warden's arcane gem floats just above his right fist (glTF loading strips the dot from "Fist.R"), carried by the bone. */
const GEM_HAND = 'FistR', GEM_LIFT = 0.4;
/** Furnace core emissive: hot enough to bloom orange, not so hot it clips to a white hole and washes out the building. */
const FURNACE_GLOW = 1.3;
const FORGE_LIGHT = { intensity: 100, distance: 28, y: 1.2 };

/**
 * Lighting at full cave depth (caveDepth = 1). Sun, hemisphere, sky-ambient and sky all drop to a trace and the fog closes in and goes
 * black; a cold lantern the player carries and the braziers that burn down there are what is left.
 */
const CAVE_LIGHT = {
  sun: 0.05, rim: 0.08, hemi: 0.95, env: 0.35, sky: 0,
  fog: { color: 0x0b1018, near: 5, far: 55 },
  lantern: { color: 0x8fb0e0, intensity: 85, distance: 22, y: 4.2 },
};
/** Daylight values the cave lighting fades from (what the constructor sets up). */
const DAY = { sun: 4.4, rim: 1.8, hemi: 0.85, env: 0.85, sky: 1 };
/**
 * A lit torch in the off hand (HOM-148). Three things, and they are three because one is not enough: the flame throws a real warm
 * light that follows the player wherever they are, `hemi` and `env` lift what the cave's dark leaves of the room, and the fog is
 * pushed back so the brightening is seen past the pool of light itself. The lift is scaled by caveDepth like everything else here --
 * outdoors there is a sun, and a torch is a flame you carry, not a change of weather.
 *
 * The light rides over the player's head, as the lantern does and for the same reason: the knight is 2 units tall and his skin is
 * the palest thing in the cave, so a flame carried at fist height washes him to a white cut-out. At y 4.6 the most his head can
 * take is 0.34 (the skin) x 95 / (pi x 2.8^2) = 1.3, under LIT_CAP (glow.ts), so he keeps his own colours inside his own light.
 */
const TORCH_LIGHT = { color: 0xff8a30, intensity: 95, y: 4.6, hemi: 0.7, env: 0.3, fogFar: 12 };
/** Held above the flame (the 1.7x brazier's flame tops out near y 3.4): a light inside or beside a prop bloomed the prop to white. See glow.ts minLightDistance. */
const BRAZIER_LIGHT = { intensity: 260, distance: 24, y: 5.8 };
/**
 * Braziers that burn in the cave: the hall's big one and the hollow's carry a real light, the others are lit geometry only (the frame budget has
 * room for few lights). The hollow's was geometry until HOM-81 took the mithril seam out of the wall: the cold light that lit that room was the
 * veins' own, and with tin in their place the brazier that was already standing there is what the Ravager fight is read by.
 */
const BRAZIERS = [{ x: -16.4, z: -38, s: 0.8 }, { x: -30.8, z: -60, s: 1, light: true }, { x: -7.2, z: -63, s: 1 }, { x: -18, z: -76.5, s: 1.7, light: true }];

/**
 * The Drowned Grotto (bible 1.2): a wrecked ship's belly in a sea-cave, flooded. Wet teal-slate floor under standing water, barnacle-pale walls, the
 * ship's own ribs and cargo, and cold green-teal lantern light: a different dark from the Hollow's blue one. A real light in each room.
 */
const GROTTO = {
  floor: 0x33544f, floorAlt: 0x3f6764, wall: new THREE.Color(0.78, 1, 0.95), water: 0x3a848b, timber: 0x7c6b56, lantern: 0x58d8c8,
  fog: new THREE.Color(0x0a1d1b), light: { color: 0x58d8c8, intensity: 150, distance: 22, y: 5.2 },
};
/**
 * The Rotroot (bible 1.2): the Thornwood's roots grown through a hollow, fungal and organic. Dark loam floor, root-brown walls, great roots arching
 * overhead, and the only light is a cold sickly green-violet from the fungus. No water; the Grotto's turned about.
 */
const ROTROOT = {
  floor: 0x3a3a2a, floorAlt: 0x47442e, wall: new THREE.Color(1, 0.72, 0.5), root: 0x5e4a36, fungus: 0x9ae07a,
  fog: new THREE.Color(0x15150d), light: { color: 0x8fd878, intensity: 120, distance: 20, y: 4.6 },
};
/**
 * The Cairn Hold (bible 1.2): a barrow's passage grave, dry and cold. A stand-in look until the 3D Artist's (HOM-99 ships the rooms): grey-violet flagstone, pale cut stone for walls, a cold
 * lamplight in each room and nothing else. It is a different dark from the other three: no green in it.
 */
const CAIRN = {
  floor: 0x3c3c46, floorAlt: 0x4a4a56, wall: new THREE.Color(0.85, 0.88, 1),
  fog: new THREE.Color(0x0f1118), light: { color: 0xa8b4e0, intensity: 110, distance: 20, y: 4.8 },
};
/**
 * The Sundered Vault (HOM-112): the Spire's school cellars, dressed stone gone violet in the dark. A stand-in look until the 3D Artist's: cut slate flagstone, a cold violet lamplight in each room, and rune
 * light on the floor of the sanctum. Its own dark, with no green and no blue-grey in it: the Archmage's rooms are the one place that is lit by what is in them.
 */
const VAULT = {
  floor: 0x35323f, floorAlt: 0x423e52, wall: new THREE.Color(0.8, 0.74, 1),
  fog: new THREE.Color(0x12101c), light: { color: 0xa090ff, intensity: 120, distance: 24, y: 3.9 },
};
const FLOORS: Record<string, [number, number]> = { hollow: [P.caveFloor, P.caveFloorAlt], grotto: [GROTTO.floor, GROTTO.floorAlt], rotroot: [ROTROOT.floor, ROTROOT.floorAlt], cairnhold: [CAIRN.floor, CAIRN.floorAlt], vault: [VAULT.floor, VAULT.floorAlt] };
/** Per-dungeon rock tint and air; the Hollow is the default and falls through. */
const DUNGEON_LOOK: Record<string, { wall: THREE.Color; fog: THREE.Color }> = { grotto: GROTTO, rotroot: ROTROOT, cairnhold: CAIRN, vault: VAULT };

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

/** Enemies are built (and their models dressed) once the player is within this of them: Hale's are built at the start, the road's and the Strand's as they come near. */
const ACTOR_RANGE = FOG_CULL + 25;
/** Ore, trees and other nodes are drawn only within this of the player (the fog has hidden them well before). */
const NODE_RANGE = FOG_CULL + 25;
/** A chest is built, drawn and clickable only within this of the player: its one glint is meant to be found at the edge of sight (HOM-152), not from the fog. */
const CHEST_RANGE = FOG_CULL;
/** How long a chest that has just been opened stays open and glowing, before it settles to the dark, spent mouth. */
const CHEST_OPEN_S = 3;
const FISH_RIPPLE = 0x9fc8d8; // a fishing shoal's ripple and fins: cold, pale, the one thing on the water
/** A spot on the clearing's wall with another region's floor beyond it: the east gate. No boulder is set there. */
const openToWorld = (x: number, z: number) => REGIONS.some(r => r.zone !== 'hale' && r.footprint.some(f => x > f.x0 + 0.01 && x < f.x1 - 0.01 && z > f.z0 + 0.01 && z < f.z1 - 0.01));
/** Adamant (Saltmarrow's cliff ore): sea-green flecks on a dark green-black rock. A stand-in look until the Artist's (W2.5). */
const ADAMANT = { rock: 0x2c4a40, fleck: 0x5de0b0, glow: 0x0e3a2a };
/** Stormiron (the barrows' and the Thornwood's ore): a pale slate-lilac rock with lilac-white flecks, the cold opposite of adamant's jade. Matches the metal's look in gear-look.ts. */
const STORMIRON = { rock: 0x6a6478, fleck: 0xd8d0f0, glow: 0x2a2640 };
/** Starmetal (the Cairnwaste's ore, HOM-111): near-black indigo rock with star-white flecks, the gear's own palette (gear-look.ts tier 6) and the opposite of stormiron's pale slate. A stand-in look until the Artist's. */
const STARMETAL = { rock: 0x1c1a2e, fleck: 0xf2f0ff, glow: 0x0c0a1c };
const ORE_LOOK = { adamant: ADAMANT, stormiron: STORMIRON, starmetal: STARMETAL } as const;
/** Starter ores: copper is warm orange-brown with verdigris flecks, tin is pale silver, so neither reads as iron (grey, orange flecks) or coal (black). */
const STARTER_ORE = {
  copper: { rock: 0x9a5a34, fleck: 0x4fc2a0, glow: 0x3a1c0c },
  tin: { rock: 0xc4cad2, fleck: 0xf2f6fa, glow: 0x2a2e34 },
};

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
const CAMERA_LIFT_EASE = 10;
const CAMERA_FOV = 60;
const MOUNT_FOV_OPEN = 6, MOUNT_CAMERA_PULL = 0.3, MOUNT_CAMERA_EASE = 3; // mounted: the lens opens by this many degrees, the camera backs off by this fraction, and both settle at this rate (per second)
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

/** Gatherable click volume, in the same shape as an enemy's, sized from the bounds of the model that is drawn (`node bench/pick.mjs` measures them). */
function nodeVolume(type: string, depleted: boolean): { height: number; radius: number } {
  if (NODE_TYPES[type].skill === 'fishing') return { height: 0.4, radius: 1.1 }; // a flat ripple on the water
  if (type === 'tree') return depleted ? { height: 1, radius: 0.8 } : { height: 6, radius: 1.8 }; // the whole crown, not the thin trunk; a felled one is a stump
  return { height: 2.2, radius: 1.3 }; // an ore rock; a spent one shrinks with the group
}

export class Renderer {
  readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 200);
  private ground: THREE.Mesh;
  private player: THREE.Mesh;
  private prev = { x: 0, y: 0, z: 0 };
  private curr = { x: 0, y: 0, z: 0 };
  private raycaster = new THREE.Raycaster();
  private actors = new Map<number, Actor>();
  /** The fens' Withering Ground, each drawn as a boss's ground circle (makeTele) in the colour of the stain: made when the player first comes near. */
  private witherMarks = new Map<number, NonNullable<Actor['tele']>>();
  private selection: THREE.Mesh;
  private shakeMag = 0;
  private doubleReadyT = 0; // paces the trickle of light that says the double jump is still unspent
  /** A shove on the camera along the blow (world units), decaying fast: the view is carried with the hit, not just jittered. */
  private kick = { x: 0, z: 0 };
  /** Effects waiting on a strike pose that is still on its way (see Animator.strikeIn). */
  private later: { t: number; fn: () => void }[] = [];
  private levelRing: THREE.Mesh;
  private levelRingAge = 99;
  private castPunch = 0;
  private drops = new Map<number, DropView>();
  private weapon: THREE.Mesh;
  private nodes = new Map<number, NodeView>();
  /** The chests (sim/chests.ts), by id: one group per state, built the first time that state is drawn, and only the current one is visible. */
  private chests = new Map<string, { states: Partial<Record<ChestState, THREE.Group>>; shown?: ChestState; openUntil: number }>();
  /** One list per forge, in `stationSites('forge')` order: the hut, the chimney, the furnace, the anvil, then the dressed model once it loads. */
  private forgeSites: THREE.Object3D[][] = [];
  private rangeParts: THREE.Object3D[] = [];
  private alembicPick!: THREE.Mesh;
  private rackPick!: THREE.Mesh;
  private circlePick!: THREE.Mesh;
  private npcParts: THREE.Object3D[] = [];
  private vendorParts: THREE.Object3D[] = [];
  private flightParts: THREE.Mesh[] = [];
  /** The notice boards (sim/bounties.ts BOARDS), in that order: one standing prop per town. */
  private boards: THREE.Group[] = [];
  /** The world map: built the first time the map screen or a ride wants it, then kept (one mesh, two uses: see world-map.ts). */
  private mapScene: WorldMap | null = null;
  private mapScreen = false;
  private inMap = false;
  /** The last frame drawn was the map, not the game: nothing projected through the game's camera (nameplates, floaters) means anything. */
  get showingMap() { return this.inMap; }
  private npcMarker!: THREE.Sprite;
  private harbourMarker!: THREE.Sprite;
  private reeveMarker!: THREE.Sprite;
  private stewardMarker!: THREE.Sprite;
  private keeperMarker!: THREE.Sprite;
  private world!: WorldView;
  private kit!: Kit;
  private beyond!: THREE.Mesh;
  /** Model slots that have loaded: an enemy built after its slot arrived is dressed at once. */
  private prepared = new Map<string, Prepared>();
  private staffLight!: THREE.PointLight;
  private markerTex!: Record<'offer' | 'ready' | 'wait', THREE.Texture>;
  private particles = new Particles();
  /** The matter pool (blood, grit, dust): normally blended, so it can be dark. `particles` is light. */
  private matter = new Particles(true);
  private motes = new Motes();
  private rings: Rings;
  private slashes: Slashes;
  private lastDraw = performance.now();
  private forgeLights: THREE.PointLight[] = [];
  private boundary: THREE.Mesh[] = [];
  private caveRocks: THREE.Mesh[] = [];
  private caveFloor!: THREE.Mesh;
  private caveWalls!: THREE.InstancedMesh;
  private caveWallPts: { x: number; z: number; r: number; w: number }[] = [];
  private caveFlames: { m: THREE.Mesh; phase: number }[] = [];
  /** The glow round every fixed light of the clearing and the caves (halo.ts), collected as they are built and drawn as one. */
  private haloSpots: HaloSpot[] = [];
  private hemi!: THREE.HemisphereLight;
  private rim!: THREE.DirectionalLight;
  private lantern!: THREE.PointLight;
  /** The light of a torch in the off hand, at zero when none is worn (HOM-148). Never added or removed: that recompiles every material. */
  private torch!: THREE.PointLight;
  private brazierLights: THREE.PointLight[] = [];
  private caveFogColor = new THREE.Color(CAVE_LIGHT.fog.color);
  private caveFogHollow = new THREE.Color(CAVE_LIGHT.fog.color);
  private npcGroup!: THREE.Group;
  private npcAnim?: Animator;
  private playerAnim?: Animator;
  private mounts = new Map<string, MountRig>(); // by look id: each horse is built the first time it is ridden
  private mountWanted = false;
  private gear?: PlayerGear;
  private playerWasDead = false;
  /** Resolves once every model slot has either swapped in or failed (and kept its primitive). Models stream in; the first frame never waits. */
  readonly modelsReady: Promise<void>;
  debugCam: { pos: number[]; at: number[] } | null = null;
  private sun = new THREE.DirectionalLight(P.moon, 3);
  post!: PostStack;
  /** Random, self-changing weather (render-side only; the sim never sees it). `__debug.view.weather.set('rain', true)` pins it. */
  readonly weather = new Weather();
  private skyDome!: SkyDome;
  private rain = new Rain();
  /** How much of the rain and the wind reaches the player where they stand: the eased weather, cut to nothing underground. main.ts hands it to sfx.ts. */
  readonly weatherHeard = { rain: 0, wind: 0 };
  private skyClock = 0;
  private fogLift = new THREE.Color(0x5a6b7c);
  private air = { fen: 0, wood: 0 };

  // orbit camera (render-side only; sim never sees it except via input direction)
  yaw = 0;
  pitch = 0.5;
  distance = 10;
  /** 0 on foot, 1 mounted: eased, so climbing up pulls the camera back and opens the lens rather than cutting. */
  private mountedBlend = 0;
  private camLift = 0;
  private rideShown = false; // what the rider and the horse were last told

  constructor(parent: HTMLElement, s: GameState, quality: Quality = 'high') {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    parent.appendChild(this.renderer.domElement);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.6;
    this.setupSky();
    this.hemi = new THREE.HemisphereLight(P.hemiSky, P.hemiGround, DAY.hemi);
    this.scene.add(this.hemi);
    this.setupRim();
    this.setupSun();

    this.ground = this.tintedGround();
    this.scene.add(this.ground);
    this.buildZone();
    this.kit = { mesh: (g, c, cls, sh) => mesh(g, c, cls as MatClass, sh), P };
    this.world = new WorldView(this.scene, this.kit);
    this.scene.add(flightMasterFigure(this.kit, LANDMARKS.flightHale, { x: 0, z: 6 }, this.flightParts)); // faces the spawn, like the other two
    standableRocks(this.kit, REGIONS.filter(r => r.zone === 'hale' || r.cave).flatMap(r => r.obstacles), o => this.scene.add(o)); // the steps and rooftops of Hale and the caves: render.ts draws those regions itself (HOM-161)
    this.buildBoards();
    this.scene.add(headstones(this.kit, REGIONS.find(r => r.id === 'clearing')!.obstacles.filter(o => o.kind === 'grave'))); // Hale's graveyard
    this.rings = new Rings(this.scene);
    this.slashes = new Slashes(this.scene);
    this.scene.add(this.particles.points, this.matter.points, this.motes.points);
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
    for (const e of s.enemies) if (Math.hypot(e.x - s.player.x, e.z - s.player.z) <= ACTOR_RANGE) this.addActor(e);
    for (const n of s.nodes) this.addNode(n);

    this.curr.x = this.prev.x = s.player.x;
    this.curr.y = this.prev.y = s.player.y;
    this.curr.z = this.prev.z = s.player.z;
    this.post = new PostStack(this.renderer, this.scene, this.camera, quality);
    this.skyDome.setQuality(quality); this.rain.setQuality(quality);
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

  /** The image-based ambient light, baked once through PMREM from a gradient (the visible sky is the live dome in sky.ts; re-baking this per frame is the cost). */
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
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = DAY.env;
    // the aurora is the one saturated thing in the sky, and it borrows the arcane family so it still belongs to this world
    this.skyDome = new SkyDome({ zenith: P.skyZenith, mid: P.skyMid, horizon, ground: P.skyGround, moon: P.moon, auroraLow: P.heal, auroraHigh: P.violet }, SUN_OFFSET);
    this.scene.add(this.skyDome.mesh, this.rain.lines);
    this.rain.setQuality('high');
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
    const segs = Math.min(Math.round(WORLD_HALF * 2 / GROUND_CELL), 180);
    const g = new THREE.PlaneGeometry(WORLD_HALF * 2, WORLD_HALF * 2, segs, segs).rotateX(-Math.PI / 2);
    const a = new THREE.Color(P.grass), b = new THREE.Color(P.grassAlt), c = new THREE.Color();
    const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
    const clr = LANDMARKS.clearing, da = new THREE.Color(P.dirt), db = new THREE.Color(P.dirtAlt), dirt = new THREE.Color();
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v), z = pos.getZ(v);
      const r = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1; // deterministic per-vertex jitter, no rng state touched
      c.copy(a).lerp(b, groundDrift(x, z) * 0.8 + r * 0.2); // the two greens in drifts, not a dapple: the jitter only breaks the drift's edge
      c.lerp(da, THREE.MathUtils.clamp((groundDrift(x, z, 7) - 0.64) * 2.6, 0, 0.5)); // and earth coming through where the turf has worn thin
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
      this.haloSpots.push({ id: 'crystal', x: c.x, y: 0.75 * c.s, z: c.z, scale: c.s });
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

    // forges (Hale's, and the Spire's): stone hut, chimney, glowing furnace, anvil, and the warm light each gives
    for (const f of stationSites('forge')) {
      const furnace = mesh(new THREE.BoxGeometry(1.2, 1, 0.1), P.fire, 'glow', 'receive');
      (furnace.material as Mat).emissiveIntensity = FURNACE_GLOW;
      this.forgeSites.push([
        add(mesh(new THREE.BoxGeometry(4, 2.5, 3), P.stone, 'stone'), f.x, 1.25, f.z),
        add(mesh(new THREE.BoxGeometry(1, 2, 1), P.stoneDark, 'stone'), f.x + 1, 3.4, f.z),
        add(furnace, f.x - 1, 1, f.z + 1.55),
        add(mesh(new THREE.BoxGeometry(0.8, 0.6, 0.5), P.anvil, 'metal'), f.x - 3, 0.3, f.z + 2)]);
      this.forgeLights.push(add(new THREE.PointLight(P.forgeLight, FORGE_LIGHT.intensity, FORGE_LIGHT.distance), f.x - 1, FORGE_LIGHT.y, f.z + 3.6) as THREE.PointLight);
      this.haloSpots.push({ id: 'forge', x: f.x - 1, y: 1, z: f.z + 1.7 });
    }
    // the cooking range, in Saltmarrow's inn: a stone hearth with a bed of coals. No light of its own: the forge keeps the one warm light
    const r = LANDMARKS.range;
    const coals = mesh(new THREE.BoxGeometry(1.1, 0.1, 0.6), P.fire, 'glow', 'receive');
    (coals.material as Mat).emissiveIntensity = FURNACE_GLOW;
    this.rangeParts.push(
      add(mesh(new THREE.BoxGeometry(1.6, 0.9, 0.9), P.stone, 'stone'), r.x, 0.45, r.z),
      add(mesh(new THREE.BoxGeometry(0.5, 1.3, 0.5), P.stoneDark, 'stone'), r.x + 0.5, 1.55, r.z - 0.2),
      add(coals, r.x - 0.1, 0.93, r.z),
      // what makes it a range and not a second forge: forked posts with a spit across, an iron pot hanging over the coals, a hood on the chimney
      add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.7, 5), P.bark, 'wood'), r.x - 0.95, 0.85, r.z + 0.1),
      add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.7, 5), P.bark, 'wood'), r.x + 0.75, 0.85, r.z + 0.1),
      add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.8, 5).rotateZ(Math.PI / 2), P.bark, 'wood'), r.x - 0.1, 1.6, r.z + 0.1),
      add(mesh(new THREE.SphereGeometry(0.3, 7, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).rotateX(Math.PI), P.anvil, 'metal'), r.x - 0.1, 1.3, r.z + 0.1),
      add(mesh(new THREE.ConeGeometry(0.55, 0.5, 4).rotateY(Math.PI / 4), P.stoneDark, 'stone'), r.x + 0.5, 2.4, r.z - 0.2));
    this.haloSpots.push({ id: 'ember', x: r.x - 0.1, y: 1.02, z: r.z });
    // Thornwick's alembic is drawn with the town (world-view.ts, merged): this unseen box over the bench is what a click lands on. Its front faces the square
    const alembic = LANDMARKS.alembic;
    this.alembicPick = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3, 1.4), new THREE.MeshBasicMaterial({ visible: false }));
    this.alembicPick.position.set(alembic.x, 1.5, alembic.z);
    this.alembicPick.rotation.y = Math.atan2(LANDMARKS.thornSquare.x - alembic.x, LANDMARKS.thornSquare.z - alembic.z) - Math.PI / 2;
    this.scene.add(this.alembicPick);
    // ...and so is Highmoor's tanning rack (drawn by the town, turned 0.5 rad: world-view.ts)
    const rack = LANDMARKS.rack;
    this.rackPick = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.8, 1.4), new THREE.MeshBasicMaterial({ visible: false }));
    this.rackPick.position.set(rack.x, 1.4, rack.z);
    this.rackPick.rotation.y = 0.5;
    this.scene.add(this.rackPick);
    // ...and the Spire's rune circle (drawn by the town: world-view.ts): a low disc to click, and the standing stones round it
    const circle = LANDMARKS.circle;
    this.circlePick = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 1.6, 12), new THREE.MeshBasicMaterial({ visible: false }));
    this.circlePick.position.set(circle.x, 0.8, circle.z);
    this.scene.add(this.circlePick);

    // cave mouth: the sim's four flank colliders, rock heaped over them and across the top; the way in is the gap between
    for (const o of CAVE_MOUTH) this.caveRocks.push(add(mesh(new THREE.DodecahedronGeometry(o.r * 1.4), P.slate, 'rock'), o.x, o.r * 0.9, o.z) as THREE.Mesh);
    for (const t of MOUTH_TOPS) this.caveRocks.push(add(mesh(new THREE.DodecahedronGeometry(t.w / 2), P.slateDark, 'rock'), t.x, t.y + t.w * 0.2, t.z) as THREE.Mesh);
    this.buildCave();
    this.buildCrystals();

    // boundary: ring of boulders along the edge
    for (let i = -WORLD_HALF; i <= WORLD_HALF; i += 3) {
      for (const [x, z] of [[i, -WORLD_HALF], [i, WORLD_HALF], [-WORLD_HALF, i], [WORLD_HALF, i]]) {
        if (inCave(x, z) || openToWorld(x, z)) continue; // the throat opens through the boundary here, and so does the east gate
        this.boundary.push(add(mesh(new THREE.DodecahedronGeometry(1.6), P.boulder, 'rock'), x, 0.8, z) as THREE.Mesh);
      }
    }
    // the east gate: two stone posts and a lintel across the 6-unit gap, so the way out reads as a way out
    for (const z of [4.4, 11.6]) add(mesh(new THREE.CylinderGeometry(0.45, 0.6, 3.6, 6), P.stone, 'stone'), 30, 1.8, z);
    add(mesh(new THREE.BoxGeometry(0.6, 0.45, 7.8), P.bark, 'wood'), 30, 3.6, 8);
    // a torch on each gate post and on each flank of the cave mouth: the clearing's two ways out, lit, and the only warm light the forge does not throw
    for (const [x, z] of [[29.1, 4.4], [29.1, 11.6], [-23, -23.4], [-13, -23.4]]) this.standTorch(x, z);
    // dev stress only (?stress=N): scatter extra decorative boulders so boulder count scales with N like everything else
    if (WORLD_HALF > 30) {
      const factor = (WORLD_HALF / 30) ** 2, ring = Math.ceil(2 * WORLD_HALF / 3 + 1) * 4;
      const pts = ringPoints({ rng: 777 }, WORLD_HALF, 30, 3);
      for (let i = ring; i < Math.round(BOULDERS_PER_FACTOR * factor); i++) { const p = pts.next().value!; this.boundary.push(add(mesh(new THREE.DodecahedronGeometry(1.6), P.boulder, 'rock'), p.x, 0.8, p.z) as THREE.Mesh); }
    }
    // beyond the boundary: dark ground so the edge reads as the end of the world
    this.beyond = add(mesh(new THREE.PlaneGeometry(Math.max(400, WORLD_HALF * 4), Math.max(400, WORLD_HALF * 4)).rotateX(-Math.PI / 2), P.beyond, 'ground', 'receive'), 0, -0.05, 0) as THREE.Mesh; // follows the player: the world is no longer 400 across
    // the glow of every fixed light built above -- forge, range, braziers, crystals, the two lit dungeons -- in one draw
    const halos = haloMesh(this.haloSpots);
    if (halos) this.scene.add(halos);
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
    this.buildCaveWalls(bakeUV(new THREE.DodecahedronGeometry(1)), material(P.caveWall, 'rock'), 2);

    // standing stones: one instanced draw
    const pillars = CAVE_PILLARS.filter(o => !hasTop(o)); // a stone with a top is a step: standableRocks draws it
    const stones = new THREE.InstancedMesh(bakeUV(new THREE.CylinderGeometry(0.75, 1.05, 1, 6)), material(P.caveWall, 'rock'), pillars.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    pillars.forEach((o, i) => {
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
      this.haloSpots.push({ id: 'brazier', x: b.x, y: 1.5 * b.s, z: b.z, scale: b.s });
      if (b.light) {
        const light = new THREE.PointLight(P.arcane, BRAZIER_LIGHT.intensity, BRAZIER_LIGHT.distance);
        light.position.set(b.x, BRAZIER_LIGHT.y, b.z);
        this.brazierLights.push(light);
        this.scene.add(light);
      }
    }

    // the light that follows the lantern (player, scaled by caveDepth): at zero outdoors, never added or removed (that would recompile every material)
    this.lantern = new THREE.PointLight(CAVE_LIGHT.lantern.color, 0, CAVE_LIGHT.lantern.distance);
    this.scene.add(this.lantern);
    // and the one the player lights for themselves: its reach is the torch's own (ITEMS.torch), so the sim says how far it carries
    this.torch = new THREE.PointLight(TORCH_LIGHT.color, 0);
    this.scene.add(this.torch);
    this.buildGrotto();
    this.buildRotroot();
    this.buildCairnHold();
    this.buildVault();
  }

  /**
   * The Vault's dressing, a stand-in until the 3D Artist's: a cold violet light in each room, and in the sanctum a dais of rune under the Archmage's post, two rings and a spoke of ticks, laid flat under
   * the ground marks (RUNE_Y) so none of his circles is ever buried by the dressing.
   */
  private buildVault() {
    const rooms = CAVE_ROOMS.filter(r => r.dungeon === 'vault'), rune: THREE.BufferGeometry[] = [], cut: THREE.BufferGeometry[] = [], paper: THREE.BufferGeometry[] = [];
    let n = 0;
    const rnd = () => this.jitter(1700 + n++);
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, ry = 0) => new THREE.BoxGeometry(w, h, d).rotateY(ry).translate(x, y, z);
    for (const { rect: r, name } of rooms) {
      const cx = (r.x0 + r.x1) / 2;
      // lamps spaced along the room's long axis so the dressing against the walls is in reach of one: the stair and the archive take two, the sanctum one at its middle and one over each far corner
      const lamps: [number, number][] = name === 'sealstair' ? [[cx, r.z0 + 5.25], [cx, r.z0 + 14.25]]
        : name === 'archive' ? [0.25, 0.75].flatMap(fx => [0.2, 0.8].map(fz => [r.x0 + (r.x1 - r.x0) * fx, r.z0 + (r.z1 - r.z0) * fz] as [number, number]))
        : [[cx, (r.z0 + r.z1) / 2], [r.x0 + 8, (r.z0 + r.z1) / 2], [r.x1 - 8, (r.z0 + r.z1) / 2]];
      for (const [lx, lz] of lamps) { // the stair's hang lower and softer: its lintels are two metres off, and a lamp that near blows the cut stone to white
        const l = new THREE.PointLight(VAULT.light.color, VAULT.light.intensity * (name === 'sanctum' ? 1.25 : name === 'sealstair' ? 0.6 : 1), VAULT.light.distance);
        l.position.set(lx, name === 'sealstair' ? 3 : VAULT.light.y, lz);
        this.scene.add(l);
      }
      // the stair: pointed school arches across the way every few paces, each a pair of piers and a lintel with a rune keystone, and a low step-kerb down both walls
      if (name === 'sealstair') for (let z = r.z0 + 3; z < r.z1 - 2; z += 4.5) {
        for (const side of [1, -1]) cut.push(box(0.9, 4.4, 1, cx + side * 3, 2.2, z), box(1.3, 0.35, 1.3, cx + side * 3, 0.17, z), box(0.7, 0.8, 0.7, cx + side * 3, 4.8, z, Math.PI / 4));
        cut.push(box(7.4, 0.7, 1, cx, 4.5, z));
        rune.push(new THREE.OctahedronGeometry(0.28).scale(0.7, 1.4, 0.7).translate(cx, 3.8, z));
      }
      // the archive: shelves in long ranks down both walls, some of them fallen, with books (paper) on the shelves and scattered about the toppled ones, and a lectern with a lit page in the room's middle
      if (name === 'archive') {
        for (const side of [1, -1]) for (let x = r.x0 + 4; x < r.x1 - 3; x += 3.4) {
          const z = side > 0 ? r.z1 - 1.3 : r.z0 + 1.3, fallen = rnd() < 0.22;
          if (fallen) { cut.push(box(2.6, 0.3, 1.1, x, 0.9, z - side * 1.1, (rnd() - 0.5) * 0.5)); for (let k = 0; k < 5; k++) paper.push(box(0.35, 0.12 + rnd() * 0.1, 0.5, x + (rnd() - 0.5) * 3, 0.07, z - side * (1.5 + rnd() * 2), rnd() * 3)); continue; }
          cut.push(box(0.2, 3.6, 1, x - 1.3, 1.8, z), box(0.2, 3.6, 1, x + 1.3, 1.8, z), box(2.8, 0.18, 1, x, 3.6, z));
          for (const y of [0.15, 1.0, 1.9, 2.8]) { cut.push(box(2.6, 0.12, 0.95, x, y, z)); for (let k = 0; k < 5; k++) if (rnd() < 0.75) paper.push(box(0.32, 0.55 + rnd() * 0.15, 0.6, x - 1.0 + k * 0.5, y + 0.4, z)); }
        }
        const lz = (r.z0 + r.z1) / 2;
        cut.push(new THREE.CylinderGeometry(0.2, 0.35, 1.2, 6).translate(cx, 0.6, lz), box(1.1, 0.12, 0.8, cx, 1.3, lz));
        rune.push(new THREE.PlaneGeometry(0.8, 0.55).rotateX(-Math.PI / 2 + 0.3).translate(cx, 1.4, lz));
      }
      // the sanctum: a stepped dais under Vael with a ring of cold rune, and the four standing stones capped with a sigil
      if (name === 'sanctum') {
        const vael = SPAWNS.find(sp => sp.type === 'archmage_vael')!;
        for (const [rad, tube] of [[7, 0.07], [3.6, 0.06]]) rune.push(new THREE.RingGeometry(rad - tube, rad + tube, 40).rotateX(-Math.PI / 2).translate(vael.x, RUNE_Y, vael.z));
        for (let i = 0; i < 16; i++) rune.push(new THREE.PlaneGeometry(0.2, 0.5).rotateX(-Math.PI / 2).rotateY(i * Math.PI / 8).translate(vael.x + Math.sin(i * Math.PI / 8) * 5.3, RUNE_Y, vael.z + Math.cos(i * Math.PI / 8) * 5.3));
        // wall braziers of rune light: tall spiked obelisks against the back and side walls, half-sunk
        for (let x = r.x0 + 4; x < r.x1 - 3; x += 7) rune.push(new THREE.OctahedronGeometry(0.4).scale(0.6, 2.2, 0.6).translate(x, 2.6, r.z0 + 1.2));
        for (const [x, z] of [[r.x0 + 1.3, r.z1 - 6], [r.x1 - 1.3, r.z1 - 6]]) cut.push(new THREE.CylinderGeometry(0.5, 0.7, 5, 6).translate(x, 2.5, z));
      }
    }
    // the standing stones: every vault obstacle gets a cut collar and a floating sigil, so none reads as a bare rock
    for (const o of CAVE_PILLARS.filter(o => !hasTop(o) && dungeonAt(o.x, o.z)?.id === 'vault')) {
      cut.push(new THREE.CylinderGeometry(o.r * 0.9, o.r * 1.15, 0.5, 8).translate(o.x, 0.25, o.z), new THREE.CylinderGeometry(o.r * 0.75, o.r * 0.75, 0.3, 8).translate(o.x, 3.2, o.z));
      rune.push(new THREE.OctahedronGeometry(0.3).translate(o.x, 4, o.z));
    }
    const flat = (gs: THREE.BufferGeometry[]) => mergeGeometries(gs.map(g => g.index ? g.toNonIndexed() : g))!; // the octahedra are unindexed, the boxes are not
    this.scene.add(mesh(flat(cut), 0x8a84ac, 'stone', 'both'), mesh(flat(paper), 0x8a7458, 'rock', 'cast'), mesh(flat(rune), 0xb8a8ff, 'glow', 'none'));
  }

  /**
   * The Cairn Hold's dressing, three merged draws (cut stone, bone, rune light) and a light in each room. A passage grave: a kerb of low slabs down both walls, trilithon gates (two uprights and a
   * lintel) across the stair and the ossuary, heaps of bone against the ossuary's walls, and under the King a low dais with a ring of pale rune. Everything keeps to the walls but the dais.
   */
  private buildCairnHold() {
    const rooms = CAVE_ROOMS.filter(r => r.dungeon === 'cairnhold');
    const cut: THREE.BufferGeometry[] = [], bone: THREE.BufferGeometry[] = [], rune: THREE.BufferGeometry[] = [];
    let n = 0;
    const rnd = () => this.jitter(1300 + n++);
    for (const { rect: r, name } of rooms) {
      const w = r.x1 - r.x0, d = r.z1 - r.z0, cx = (r.x0 + r.x1) / 2;
      // the kerb: slabs laid end to end along both long walls, each a different length and a little out of true, with gaps where the rock has taken them
      for (const side of [1, -1] as const) for (let z = r.z0 + 3.5; z < r.z1 - 3; z += 2.2 + rnd() * 1.2) {
        if (rnd() < 0.2) continue;
        cut.push(new THREE.BoxGeometry(0.7 + rnd() * 0.3, 0.35 + rnd() * 0.35, 1.5 + rnd() * 0.9).rotateY((rnd() - 0.5) * 0.25)
          .translate(side > 0 ? r.x1 - 1.1 : r.x0 + 1.1, 0.25, z));
      }
      // trilithon gates across the passage rooms: the uprights stand in the wall's own line, the lintel spans the room's width
      if (name !== 'chamber') for (let z = r.z0 + 5; z < r.z1 - 4; z += name === 'stair' ? 6 : 8) {
        const span = Math.min(w - 2.4, 8);
        for (const side of [1, -1]) cut.push(new THREE.BoxGeometry(0.9, 3.6 + rnd() * 0.5, 1.1).rotateY(rnd() * 0.2).translate(cx + side * span / 2, 1.9, z));
        cut.push(new THREE.BoxGeometry(span + 1.6, 0.7, 1.2).translate(cx, 4.0, z));
      }
      // the ossuary: heaps of bone against the walls, skulls and long bones in a tumble
      if (name === 'ossuary') for (let i = 0; i < 9; i++) {
        const side = i % 2 ? 1 : -1, x = side > 0 ? r.x1 - 2.1 : r.x0 + 2.1, z = r.z0 + 3 + rnd() * (d - 6);
        for (let k = 0; k < 7; k++) bone.push(new THREE.IcosahedronGeometry(0.2 + rnd() * 0.12, 0).translate(x + (rnd() - 0.5) * 1.1, 0.15 + rnd() * 0.35, z + (rnd() - 0.5) * 1.3));
        for (let k = 0; k < 3; k++) bone.push(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 4).rotateZ(Math.PI / 2).rotateY(rnd() * 3).translate(x + (rnd() - 0.5) * 1.2, 0.08, z + (rnd() - 0.5) * 1.4));
      }
      // the chamber: a floor of cold rune at the King's end, two rings and a spoke of ticks, laid flat and under the ground marks (RUNE_Y) so a boss circle is never buried by the dressing
      if (name === 'chamber') {
        const kz = r.z0 + 5, dais = 6.2;
        for (const [rad, tube] of [[dais - 0.5, 0.07], [3.4, 0.06]]) rune.push(new THREE.RingGeometry(rad - tube, rad + tube, 36).rotateX(-Math.PI / 2).translate(cx, RUNE_Y, kz));
        for (let i = 0; i < 12; i++) rune.push(new THREE.PlaneGeometry(0.2, 0.5).rotateX(-Math.PI / 2).rotateY(i * Math.PI / 6).translate(cx + Math.sin(i * Math.PI / 6) * 4.8, RUNE_Y, kz + Math.cos(i * Math.PI / 6) * 4.8));
      }
    }
    this.scene.add(mesh(mergeGeometries(cut)!, 0x5a6068, 'stone', 'both'), mesh(mergeGeometries(bone.map(g => g.index ? g.toNonIndexed() : g))!, 0xa59f8a, 'rock', 'cast'), mesh(mergeGeometries(rune)!, 0xb4dcf0, 'glow', 'none'));
    for (const room of rooms) {
      const l = new THREE.PointLight(CAIRN.light.color, CAIRN.light.intensity, CAIRN.light.distance);
      l.position.set((room.rect.x0 + room.rect.x1) / 2, CAIRN.light.y, (room.rect.z0 + room.rect.z1) / 2);
      this.scene.add(l);
    }
  }

  /** The Rotroot's dressing, one merged draw each for roots and fungus glow, and a light in each room: roots arch over the rooms, fungus clusters on them and the floor. */
  private buildRotroot() {
    const rooms = CAVE_ROOMS.filter(r => r.dungeon === 'rotroot');
    const roots: THREE.BufferGeometry[] = [], glow: THREE.BufferGeometry[] = [];
    let n = 0;
    const rnd = () => this.jitter(900 + n++);
    for (const { rect: r } of rooms) {
      const w = r.x1 - r.x0, d = r.z1 - r.z0;
      // roots: thick arches from each wall, closer together and more ragged than the Grotto's ribs, with a fungus bloom where each one meets the floor
      const R = Math.min(5.5, w * 0.48);
      for (let z = r.z0 + 2, i = 0; z < r.z1 - 1.5; z += 3.2, i++) {
        for (const side of [1, -1] as const) {
          const rad = R * (0.8 + rnd() * 0.4), arc = new THREE.TorusGeometry(rad, 0.22 + rnd() * 0.18, 5, 9, Math.PI * (0.35 + rnd() * 0.15));
          if (side < 0) arc.rotateY(Math.PI);
          const bx = side > 0 ? r.x1 - rad : r.x0 + rad, zz = z + (rnd() - 0.5) * 1.2;
          roots.push(arc.translate(bx, 0, zz));
          if ((i + (side > 0 ? 1 : 0)) % 2 === 0) {
            const bx = side > 0 ? r.x1 - 0.9 : r.x0 + 0.9;
            glow.push(new THREE.ConeGeometry(0.28, 0.5, 5).translate(bx, 0.25, zz + 0.4));
            this.haloSpots.push({ id: 'fungus', x: bx, y: 0.3, z: zz + 0.4 });
          }
        }
      }
      // standing roots and fungus on the floor: knuckled stumps, and clusters of caps, kept out of the doorways
      for (let i = 0; i < Math.round(d / 2.5); i++) {
        const x = r.x0 + 1.2 + rnd() * (w - 2.4), z = r.z0 + 4 + rnd() * (d - 8);
        if (i % 2) roots.push(new THREE.CylinderGeometry(0.3, 0.6, 0.9 + rnd() * 0.8, 6).translate(x, 0.5, z));
        else { // a cluster of caps, under one glow: three halos stacked on each other would read as one bright blob anyway
          for (let k = 0; k < 3; k++) glow.push(new THREE.SphereGeometry(0.2 + rnd() * 0.18, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(x + (rnd() - 0.5) * 1.1, 0.05, z + (rnd() - 0.5) * 1.1));
          this.haloSpots.push({ id: 'fungus', x, y: 0.2, z, scale: 1.3 });
        }
      }
    }
    this.scene.add(mesh(mergeGeometries(roots)!, ROTROOT.root, 'wood', 'cast'), mesh(mergeGeometries(glow)!, ROTROOT.fungus, 'glow', 'none'));
    for (const room of rooms) {
      const l = new THREE.PointLight(ROTROOT.light.color, ROTROOT.light.intensity, ROTROOT.light.distance);
      l.position.set((room.rect.x0 + room.rect.x1) / 2, ROTROOT.light.y, (room.rect.z0 + room.rect.z1) / 2);
      this.scene.add(l);
    }
  }

  /** The Grotto's own dressing, one merged draw each for standing water, timber and lantern glass, and a light in each room. */
  private buildGrotto() {
    const rooms = CAVE_ROOMS.filter(r => r.dungeon === 'grotto');
    const water: THREE.BufferGeometry[] = [], timber: THREE.BufferGeometry[] = [], glass: THREE.BufferGeometry[] = [];
    let n = 0;
    const rnd = () => this.jitter(500 + n++);
    for (const { rect: r, name } of rooms) {
      const w = r.x1 - r.x0, d = r.z1 - r.z0, cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
      // standing water: shallow, wide, overlapping sheets, kept off the doorways at the room's ends
      for (let i = 0; i < Math.round(d / 4); i++) {
        const rad = 2 + rnd() * 2.2;
        water.push(new THREE.CircleGeometry(rad, 12).rotateX(-Math.PI / 2).scale(1 + rnd(), 1, 0.8 + rnd() * 0.5)
          .translate(cx + (rnd() - 0.5) * (w - 2), 0.07, r.z0 + 4 + rnd() * (d - 8)));
      }
      // the ship's ribs: arches rising from each wall and curving in, a lantern hung at the tip of every third
      const R = Math.min(5, w * 0.45);
      for (let z = r.z0 + 3, i = 0; z < r.z1 - 2; z += 5, i++) {
        const arc = new THREE.TorusGeometry(R, 0.17, 5, 10, Math.PI * 0.42);
        for (const side of [1, -1] as const) {
          const rib = arc.clone();
          if (side < 0) rib.rotateY(Math.PI);
          timber.push(rib.translate(side > 0 ? r.x1 - R : r.x0 + R, 0, z + (rnd() - 0.5) * 0.6));
          if ((i + (side > 0 ? 1 : 0)) % 3 === 0) {
            const tip = { x: (side > 0 ? r.x1 - R : r.x0 + R) + side * R * Math.cos(Math.PI * 0.42), y: R * Math.sin(Math.PI * 0.42) };
            glass.push(new THREE.OctahedronGeometry(0.28).scale(1, 1.4, 1).translate(tip.x, tip.y - 0.5, z));
            this.haloSpots.push({ id: 'glass', x: tip.x, y: tip.y - 0.5, z });
            timber.push(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 4).translate(tip.x, tip.y - 0.1, z));
          }
        }
      }
      // cargo, against the walls of the two big rooms: crates and barrels
      if (name !== 'gangway') for (let i = 0; i < 6; i++) {
        const side = i % 2 ? 1 : -1, x = side > 0 ? r.x1 - 1.4 - rnd() : r.x0 + 1.4 + rnd(), z = r.z0 + 3 + rnd() * (d - 6);
        timber.push(i % 3 === 0
          ? new THREE.CylinderGeometry(0.5, 0.55, 1.1, 7).translate(x, 0.55, z)
          : new THREE.BoxGeometry(1, 0.9, 1).rotateY(rnd() * 3).scale(0.8 + rnd() * 0.5, 1, 0.8 + rnd() * 0.5).translate(x, 0.45, z));
      }
    }
    const sheet = mesh(mergeGeometries(water)!, GROTTO.water, 'ground', 'receive');
    const wm = sheet.material as Mat;
    Object.assign(wm, { transparent: true, opacity: 0.62, roughness: 0.18, metalness: 0.1, depthWrite: false });
    this.scene.add(sheet, mesh(mergeGeometries(timber)!, GROTTO.timber, 'wood', 'cast'), mesh(mergeGeometries(glass)!, GROTTO.lantern, 'glow', 'none'));
    // lights, always present at their rooms (never added or removed): they only reach what is within their distance
    for (const room of rooms) {
      const l = new THREE.PointLight(GROTTO.light.color, GROTTO.light.intensity * (room.name === 'gangway' ? 0.5 : 1), GROTTO.light.distance);
      l.position.set((room.rect.x0 + room.rect.x1) / 2, GROTTO.light.y, (room.rect.z0 + room.rect.z1) / 2);
      this.scene.add(l);
    }
  }

  /** (Re)build the wall rock from a geometry whose footprint is `unit` wide: the primitive first, the model once it loads. */
  private buildCaveWalls(geometry: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], unit: number) {
    if (this.caveWalls) { this.scene.remove(this.caveWalls); this.caveWalls.dispose(); }
    const im = this.caveWalls = new THREE.InstancedMesh(geometry, mat, this.caveWallPts.length), shade = new THREE.Color();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    this.caveWallPts.forEach((p, i) => {
      const s = p.w / unit;
      // the Hollow's rock goes dark past the threshold, so the way in reads as a way in; the Grotto's stays pale with barnacle, the one thing the lantern can find, the Rotroot's is root-brown
      const look = DUNGEON_LOOK[dungeonAt(p.x, p.z)?.id ?? ''];
      im.setColorAt(i, look ? shade.copy(look.wall) : shade.setScalar(THREE.MathUtils.lerp(1, 0.3, THREE.MathUtils.clamp((-p.z - 30) / 10, 0, 1))));
      im.setMatrixAt(i, m.compose(pos.set(p.x, -0.2, p.z), q.setFromAxisAngle(up, p.r * 40), sc.set(s, s * WALL_HEIGHT, s)));
    });
    im.castShadow = im.receiveShadow = true;
    im.matrixAutoUpdate = false;
    this.scene.add(im);
  }

  /** The cave floor: the rooms tinted per vertex like the outdoor ground, each room a hair above the last so overlaps do not shimmer. One draw. */
  private tintedFloor() {
    const a = new THREE.Color(), b = new THREE.Color(), c = new THREE.Color();
    const nth = roomIndices(CAVE_ROOMS.map(r => r.dungeon)); // the lift counts within a dungeon: a stack across all of them buries the last boss's circle (floor-stack.ts)
    const rooms = CAVE_ROOMS.map(({ rect: r, dungeon }, i) => {
      a.setHex(FLOORS[dungeon][0]); b.setHex(FLOORS[dungeon][1]);
      const w = r.x1 - r.x0, d = r.z1 - r.z0;
      const g = new THREE.PlaneGeometry(w, d, Math.max(1, Math.round(w / 3)), Math.max(1, Math.round(d / 3))).rotateX(-Math.PI / 2)
        .translate((r.x0 + r.x1) / 2, floorLift(nth[i]), (r.z0 + r.z1) / 2);
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

  /** How much of the fens' air and the Thornwood's the player is standing in, eased frame by frame so crossing a region's edge is a change of weather and not a cut. */
  private zoneAir(x: number, z: number) {
    const id = regionAt(x, z)?.id, sq = LANDMARKS.thornSquare;
    const wood = id === 'thornwick' ? THREE.MathUtils.clamp((Math.hypot(x - sq.x, z - sq.z) - 36) / 14, 0, 1) : 0;
    this.air.fen += ((id === 'dunmere' ? 1 : 0) - this.air.fen) * 0.03;
    this.air.wood += (wood - this.air.wood) * 0.03;
    return this.air;
  }

  /**
   * Daylight to cave dark by `depth` (the sim's caveDepth at the player): sun, sky, ambient and fog fade, the lantern comes up.
   * `reach` is how far the light the player carries throws (the sim's `stats.light`, 0 with nothing lit): a torch is a warm light
   * that follows them anywhere, and underground it also lifts the room the dark leaves them.
   */
  private applyCaveLight(depth: number, x: number, z: number, reach: number, nowMs: number) {
    const mix = THREE.MathUtils.lerp;
    const w = this.weather.look;
    const lit = reach > 0 ? 1 : 0;
    this.sun.intensity = mix(DAY.sun * w.sun, CAVE_LIGHT.sun, depth);
    this.rim.intensity = mix(DAY.rim, CAVE_LIGHT.rim, depth);
    this.hemi.intensity = mix(DAY.hemi * w.hemi, CAVE_LIGHT.hemi + TORCH_LIGHT.hemi * lit, depth);
    this.scene.environmentIntensity = mix(DAY.env * w.env, CAVE_LIGHT.env + TORCH_LIGHT.env * lit, depth);
    const fog = this.scene.fog as THREE.Fog;
    const air = this.zoneAir(x, z);
    this.caveFogColor.lerp((DUNGEON_LOOK[dungeonAt(x, z)?.id ?? ''] ?? { fog: this.caveFogHollow }).fog, 0.05); // the Grotto's dark is green-black, the Rotroot's loam-black, the Hollow's blue-black
    fog.color.setHex(P.horizon).lerp(this.fogLift, w.lift).lerp(FEN_AIR.color, air.fen * 0.5).lerp(WOOD_AIR.color, air.wood * 0.4).lerp(this.caveFogColor, depth);
    fog.near = mix(w.fogNear + air.fen * 4 - air.wood * 4, CAVE_LIGHT.fog.near, depth);
    fog.far = mix(w.fogFar + air.fen * 20 - air.wood * 14, CAVE_LIGHT.fog.far + TORCH_LIGHT.fogFar * lit, depth);
    // the sky and the rain go with the daylight: nothing of the weather reaches underground (rain is gone by the first few metres of cave), and
    // what is left of it is also what is left to be heard
    const outside = 1 - THREE.MathUtils.clamp(depth * 5, 0, 1);
    this.skyDome.update(this.skyClock, w.cover, fog.color, mix(DAY.sky, CAVE_LIGHT.sky, depth), this.camera.position);
    this.rain.update(this.skyClock, w.rain * outside, this.camera.position);
    this.weatherHeard.rain = w.rain * outside;
    this.weatherHeard.wind = w.wind * outside;
    this.lantern.intensity = CAVE_LIGHT.lantern.intensity * depth;
    this.lantern.position.set(x, CAVE_LIGHT.lantern.y, z);
    // the torch burns wherever you are, in or out of the cave, and flickers off the same two beats the braziers do
    this.torch.distance = reach;
    this.torch.intensity = lit * TORCH_LIGHT.intensity * (1 + 0.09 * Math.sin(nowMs / 95) + 0.06 * Math.sin(nowMs / 39));
    this.torch.position.set(x, TORCH_LIGHT.y, z);
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
    this.harbourMarker = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.markerTex.offer, depthTest: false }));
    this.harbourMarker.scale.set(1.1, 1.1, 1);
    this.harbourMarker.renderOrder = 10;
    this.harbourMarker.visible = false;
    this.scene.add(this.harbourMarker);
    this.reeveMarker = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.markerTex.offer, depthTest: false }));
    this.reeveMarker.scale.set(1.1, 1.1, 1);
    this.reeveMarker.renderOrder = 10;
    this.reeveMarker.visible = false;
    this.scene.add(this.reeveMarker);
    this.stewardMarker = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.markerTex.offer, depthTest: false }));
    this.stewardMarker.scale.set(1.1, 1.1, 1);
    this.stewardMarker.renderOrder = 10;
    this.stewardMarker.visible = false;
    this.scene.add(this.stewardMarker);
    this.keeperMarker = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.markerTex.offer, depthTest: false }));
    this.keeperMarker.scale.set(1.1, 1.1, 1);
    this.keeperMarker.renderOrder = 10;
    this.keeperMarker.visible = false;
    this.scene.add(this.keeperMarker);
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
      ...[...slots].map(t => fill(t, p => { this.prepared.set(t, p); for (const a of this.actors.values()) if (slotOf(a.type) === t) this.dressActor(a, p); })),
      Promise.all([loadSlot('tree'), loadSlot('stump')]).then(([t, st]) => this.dressTrees(t, st)).catch(err => console.warn('model slot "tree" kept as a primitive:', err)),
      fill('ironRock', p => { for (const t of ['iron', 'copper', 'tin', 'adamant', 'stormiron', 'starmetal'] as const) this.dressRocks(t, p); }),
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

  /**
   * Put the player on a mount (or take him off). A horse loads the first time it is asked for; until it has, he stays on foot. `speed`
   * is the mount's travel speed in world units per second, which sets the gait's playback rate; `id` picks which horse (mount.ts).
   */
  setMounted(on: boolean, speed = 10, id?: string) {
    this.mountWanted = on;
    for (const rig of this.mounts.values()) rig.root.visible = false;
    if (!on) {
      this.playerAnim?.ride(null);
      return;
    }
    const key = mountLookId(id, speed), look = MOUNT_LOOKS[key];
    const seat = (rig: MountRig) => {
      if (!this.mountWanted || !this.playerAnim) return;
      rig.root.visible = true;
      this.playerAnim.ride(rig.seat);
    };
    const have = this.mounts.get(key);
    if (have) return seat(have);
    loadSlot(look.slot).then(p => {
      if (this.mounts.has(key)) return;
      const rig = new MountRig(p, speed, look);
      this.mounts.set(key, rig);
      this.player.add(rig.root);
      seat(rig);
    }).catch(err => console.warn(`model slot "${look.slot}" skipped, the rider stays on foot:`, err));
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
    const tint = defOf(a).look?.tint;
    for (const m of a.mats) { if (tint !== undefined) m.color.lerp(new THREE.Color(tint), TINT_MIX); m.emissive.setHex(a.glow); }
    a.anim = new Animator(inst.root, inst.clips, SLOTS[slotOf(a.type) as 'boar'].anim);
    const kit = SILHOUETTES[a.type];
    if (kit) this.dressKit(a, inst.root, kit());
    if (a.echo) this.setEcho(a, a.echo); // the model's materials are new: the dye goes on them too
  }

  /** What makes a re-skinned rig a different creature (creatures.ts): squash and lean the rig, add its layers, hang a light from its hand. */
  private dressKit(a: Actor, fit: THREE.Object3D, kit: Silhouette) {
    // the Animator rewrites the fit wrapper's own scale and rotation every frame, so the squash goes on the model inside it; the extras ride the
    // wrapper (they topple with the corpse) and share the hunch, but not the squash: they are drawn in rig units
    const model = fit.children[0], dress = new THREE.Group();
    if (kit.squash) model.scale.multiply(new THREE.Vector3(...kit.squash));
    if (kit.lean) model.rotation.x = dress.rotation.x = kit.lean;
    if (kit.squash && !kit.squashRig) dress.scale.set(...kit.squash);
    fit.add(dress);
    for (const l of kit.layers) {
      const m = new THREE.Mesh(bakeUV(mergeParts(l.parts)), material(l.color ?? a.mats[0].color.getHex(), l.lit ? 'glow' : 'hide'));
      if (!l.lit) m.material.emissive.setHex(a.glow);
      m.castShadow = !l.lit;
      m.raycast = () => {}; // the click volume is the enemy's own
      dress.add(m);
      if (!l.lit) a.mats.push(m.material);
    }
    const hand = kit.handLight && fit.getObjectByName(GEM_HAND);
    if (hand && kit.handLight) {
      a.group.updateMatrixWorld(true);
      const orb = mesh(new THREE.OctahedronGeometry(kit.handLight.size), kit.handLight.color, 'glow', 'none');
      orb.scale.setScalar(1 / hand.getWorldScale(new THREE.Vector3()).x); // bone space is rig-scaled: undo it so the light is in world units
      orb.position.copy(hand.worldToLocal(hand.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, GEM_LIFT, 0))));
      orb.raycast = () => {};
      hand.add(orb);
    }
  }

  /** A torch standing in the clearing (props.ts): lit geometry and its halo, like the braziers that carry no light, so the frame's light budget is untouched. */
  private standTorch(x: number, z: number) {
    const t = this.buildProp('torch');
    t.position.set(x, 0, z);
    t.rotation.y = x * 1.7 + z;   // no two face the same way
    this.scene.add(t);
  }

  /** A built prop (props.ts) as a group of one mesh per layer, ready to stand on a station or a node. Its materials are its own. */
  buildProp(id: PropId): THREE.Group {
    const g = new THREE.Group(), p = PROPS[id]();
    for (const l of p.layers) g.add(mesh(mergeParts(l.parts), l.color, l.cls, l.cls === 'glow' ? 'none' : 'both')).name = l.name;
    const halos = haloMesh(p.halos ?? []); // in the prop's own frame: it turns and moves with the group
    if (halos) g.add(halos).name = 'halo';
    return g;
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

  private dressRocks(type: 'iron' | 'coal' | 'copper' | 'tin' | keyof typeof ORE_LOOK, p: Prepared) {
    for (const v of this.nodes.values()) {
      if (v.type !== type) continue;
      const id = v.group.userData.nodeId as number, inst = spawn(p, true);
      inst.root.rotation.y = this.jitter(id) * Math.PI * 2;
      inst.root.updateMatrix();
      this.hide(v.group.children[0]);
      v.group.add(inst.root);
      if (type in ORE_LOOK) { const look = ORE_LOOK[type as keyof typeof ORE_LOOK]; for (const m of inst.materials) { m.color.setHex(look.rock); m.emissive.setHex(look.glow); } }
      if (type === 'copper' || type === 'tin') for (const m of inst.materials) { m.color.setHex(STARTER_ORE[type].rock); m.emissive.setHex(STARTER_ORE[type].glow); }
      v.mats.push(...inst.materials);
      v.base.push(...inst.materials.map(m => m.color.getHex()));
    }
  }

  private dressForge(p: Prepared) {
    stationSites('forge').forEach((f, i) => {
      const parts = this.forgeSites[i], inst = spawn(p);
      this.hide(parts[0], parts[1]);
      inst.root.position.set(f.x, 0, f.z);
      this.scene.add(inst.root);
      freeze(inst.root);
      parts.push(inst.root);
    });
  }

  private dressAnvil(p: Prepared) {
    stationSites('forge').forEach((f, i) => {
      const inst = spawn(p);
      this.hide(this.forgeSites[i][3]);
      inst.root.position.set(f.x - 3, 0, f.z + 2);
      this.scene.add(inst.root);
      freeze(inst.root);
    });
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
      this.cameraRocks = [...this.caveWallPts.map(p => ({ x: p.x, z: p.z, r: p.w * CAMERA_ROCK_FILL })), ...CAVE_PILLARS.filter(o => !hasTop(o)), ...CAVE_MOUTH.map(o => ({ x: o.x, z: o.z, r: o.r * 1.1 }))];
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
  setQuality(q: Quality) { this.post.setQuality(q); this.skyDome.setQuality(q); this.rain.setQuality(q); }

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
    if (NODE_TYPES[n.type].skill === 'herbalism') {
      // a patch of herb (props.ts): its materials join the node's, so a picked one greys out and shrinks like a spent rock. The invisible disc is the click target: a tuft is small
      const patch = this.buildProp(n.type === 'fenbloom' ? 'herbPatchFen' : 'herbPatchThorn');
      for (const m of patch.children as THREE.Mesh[]) { mats.push(m.material as Mat); }
      const target = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.9, 8), new THREE.MeshBasicMaterial({ visible: false }));
      target.position.y = 0.45;
      group.add(patch, target);
    } else if (NODE_TYPES[n.type].skill === 'fishing') {
      // a shoal: a pale ripple on the water and the fins breaking it. Flat, so the click is the ring and not the sea behind it
      part(new THREE.TorusGeometry(0.9, 0.07, 6, 20).rotateX(Math.PI / 2), FISH_RIPPLE, 'beacon', 0.06);
      part(new THREE.CylinderGeometry(0.9, 0.9, 0.04, 16), P.slateDark, 'dark', 0.02);
      for (const [dx, dz] of [[0.3, 0.1], [-0.35, -0.2], [0.05, -0.4]]) {
        const fin = part(new THREE.ConeGeometry(0.1, 0.35, 4), FISH_RIPPLE, 'ore', 0.2);
        fin.position.x = dx; fin.position.z = dz;
      }
    } else if (n.type === 'tree') {
      part(new THREE.CylinderGeometry(0.25, 0.35, 2, 5), P.bark, 'bark', 1);
      crown = part(new THREE.ConeGeometry(1.4, 3.5, 6), P.pine, 'foliage', 3.5);
    } else {
      const coal = n.type === 'coal', glow = n.type in ORE_LOOK ? ORE_LOOK[n.type as keyof typeof ORE_LOOK] : undefined;
      const starter = n.type === 'copper' || n.type === 'tin' ? STARTER_ORE[n.type] : undefined;
      part(new THREE.DodecahedronGeometry(1.3), starter ? starter.rock : coal ? P.coalRock : glow ? glow.rock : P.ironRock, 'rock', 0.9);
      // ore flecks: rust for iron, verdigris for copper, bright silver for tin, glossy black for coal, sea-green for adamant, lilac-white for stormiron
      for (const [dx, dy, dz] of [[0.7, 1.2, 0.6], [-0.6, 1.0, 0.8], [0.1, 1.6, -0.5]]) {
        const fleck = part(new THREE.OctahedronGeometry(0.28), starter ? starter.fleck : coal ? P.coalFleck : glow ? glow.fleck : P.ironFleck, coal ? 'coal' : glow ? 'beacon' : 'ore', dy);
        if (!coal && !glow) (fleck.material as Mat).emissive.setHex(starter ? starter.fleck : P.ironFleck).multiplyScalar(0.35); // faint glint so a node reads at range
        fleck.position.x = dx; fleck.position.z = dz;
      }
    }
    this.scene.add(group);
    this.nodes.set(n.id, { group, type: n.type, crown, mats, base: mats.map(m => m.color.getHex()) });
  }

  private drawNodes(s: GameState) {
    const now = performance.now() / 1000;
    const active = s.player.action?.k === 'gather' ? s.player.action.nodeId : -1;
    const p = s.player;
    for (const n of s.nodes) {
      const v = this.nodes.get(n.id)!;
      v.group.visible = Math.hypot(n.x - p.x, n.z - p.z) <= NODE_RANGE; // far ore costs a scene object each: not drawn, not updated
      if (!v.group.visible) continue;
      const depleted = n.charges <= 0;
      if (v.crown) v.crown.visible = !depleted; // a felled tree leaves a stump
      else v.group.scale.setScalar(depleted ? 0.4 : 1);
      if (v.live) { v.live.visible = !depleted; v.stump!.visible = depleted; }
      v.mats.forEach((m, i) => { const spent = depleted && !v.crown; m.color.setHex(spent ? P.spent : v.base[i]); m.emissiveIntensity = spent ? 0 : 1; });
      v.group.rotation.z = n.id === active ? Math.sin(now * 18) * 0.05 : 0;
    }
  }

  /** A notice board in every town, turned to face the town's own wake point (where you arrive), and clickable from anywhere you can see it. */
  private buildBoards() {
    for (const b of BOARDS) {
      const town = TOWNS.find(t => t.id === b.id)!, g = this.buildProp('board');
      g.position.set(b.x, 0, b.z);
      g.rotation.y = Math.atan2(town.wake.x - b.x, town.wake.z - b.z);
      this.scene.add(g);
      this.boards.push(g);
    }
  }

  /** A chest within sight shows its state: closed (the lock's glint), open for a few seconds after you open it, then spent. Far ones are not drawn at all. */
  private drawChests(s: GameState, nowMs: number) {
    const p = s.player;
    for (const c of CHESTS) {
      const v = this.chests.get(c.id) ?? { states: {}, openUntil: 0 };
      this.chests.set(c.id, v);
      const near = Math.hypot(c.x - p.x, c.z - p.z) <= CHEST_RANGE;
      const opened = isOpened(p, c.id);
      if (opened && v.shown === 'closed') v.openUntil = nowMs + CHEST_OPEN_S * 1000; // seen closed and now opened: this is the moment it happens
      const want: ChestState = !opened ? 'closed' : nowMs < v.openUntil ? 'open' : 'spent';
      for (const [state, g] of Object.entries(v.states)) g.visible = near && state === want;
      if (!near) continue;
      if (!v.states[want]) {
        const g = this.buildProp(want === 'closed' ? 'chest' : want === 'open' ? 'chestOpen' : 'chestSpent');
        g.position.set(c.x, c.floor, c.z);
        g.rotation.y = c.x * 1.7 + c.z; // no two face the same way
        g.userData.chestId = c.id;
        this.scene.add(g);
        v.states[want] = g;
      }
      v.states[want]!.visible = true;
      v.shown = want;
    }
  }

  private addActor(e: Enemy) {
    const def = defOf(e);
    const slot = slotOf(e.type), color = slot === 'boar' ? P.boar : slot === 'wolf' || slot === 'pup' ? P.wolf : slot === 'hexer' ? P.robe : P.brute;
    const group = new THREE.Group();
    const mat = material(color, 'hide');
    const body = new THREE.Mesh(
      bakeUV(slot === 'brute' ? new THREE.BoxGeometry(1.6, 2.2, 1.2) : new THREE.CapsuleGeometry(def.radius * 0.8, def.radius * 1.2, 2, 6).rotateX(Math.PI / 2)),
      mat);
    body.castShadow = body.receiveShadow = true;
    body.position.y = slot === 'brute' ? 1.5 : def.radius + 0.2;
    body.userData.enemyId = e.id;
    group.add(body);
    const glow = emissiveOf(e.type);
    if (def.look) mat.color.lerp(new THREE.Color(def.look.tint), TINT_MIX);
    mat.emissive.setHex(glow);
    // snout/fist so facing is readable on the placeholder body; the model carries its own face
    const nose = new THREE.Mesh(bakeUV(new THREE.BoxGeometry(0.3, 0.3, 0.5)), material(P.bone, 'skin'));
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
    this.actors.set(e.id, { group, body, nose, ring, tele, mats: [mat], type: e.type, scale: lookScale(e.type), glow, px: e.x, pz: e.z, cx: e.x, cz: e.z, swing: 0, flash: 0, dead: false, t: e.id, echo: null });
  }

  /**
   * Dress an enemy as the band's Echo, or take it off (null): the body's own colour pulled toward the band hue, a cold rim light on every facet's edge (emissive, so it
   * holds in the dark and under rain), and a ring of dashes in the band colour on the ground inside the red one. Idempotent; the colours are remembered per material so
   * an Echo that respawns as the authored thing gets its own back. The Echo's glow replaces the hostile red-brown a rested enemy carries.
   */
  private setEcho(a: Actor, band: EchoBand | null) {
    a.echo = band;
    a.glow = band ? new THREE.Color(band.color).multiplyScalar(ECHO_GLOW).getHex() : emissiveOf(a.type);
    for (const m of a.mats) {
      m.userData.echoBase ??= m.color.clone();
      m.color.copy(m.userData.echoBase);
      if (band) m.color.lerp(new THREE.Color(band.color).multiplyScalar(ECHO_BODY), ECHO_MIX);
      if (!m.userData.echoRim) {
        const rim = m.userData.echoRim = { value: new THREE.Color(0) };
        m.onBeforeCompile = sh => {
          sh.uniforms.echoRim = rim;
          sh.fragmentShader = sh.fragmentShader
            .replace('uniform vec3 emissive;', 'uniform vec3 emissive;\nuniform vec3 echoRim;')
            .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += echoRim * pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.2);');
        };
        m.customProgramCacheKey = () => 'echo-rim';
        m.needsUpdate = true;
      }
      m.userData.echoRim.value.setHex(band ? band.color : 0).multiplyScalar(band ? ECHO_RIM : 0);
    }
    if (band) {
      if (!a.echoRing) {
        const r = ENEMY_TYPES[a.type].radius, arcs: THREE.BufferGeometry[] = [];
        for (let i = 0; i < 10; i++) arcs.push(new THREE.RingGeometry(r * 0.78, r * 0.98, 4, 1, (i / 10) * Math.PI * 2, Math.PI * 2 / 10 * 0.55).rotateX(-Math.PI / 2));
        a.echoRing = new THREE.Mesh(mergeGeometries(arcs)!, new THREE.MeshBasicMaterial({ color: band.color, transparent: true, opacity: 0.85, fog: false, depthWrite: false, side: THREE.DoubleSide }));
        a.echoRing.position.y = 0.075;
        a.echoRing.renderOrder = 1;
        a.echoRing.raycast = () => {};
        a.group.add(a.echoRing);
      }
      (a.echoRing.material as THREE.MeshBasicMaterial).color.setHex(band.color);
    }
    if (a.echoRing) a.echoRing.visible = !!band;
  }

  /** A danger circle on the ground: an outline that pulses and a fill that grows to meet it. The radius is fixed per type. */
  private makeTele(r: number, color: number = P.blood): NonNullable<Actor['tele']> {
    const tm = (o: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: o, fog: false, depthWrite: false, side: THREE.DoubleSide });
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

  /** The stone a Falling Stone / Falling Rock mark brings down: sized to the ring it lands in, a tall dark slab so it reads against the floor as it falls. A child of the mark's root. */
  private makeFallingStone(r: number): THREE.Mesh {
    // Lambert, not the rock class: the Hold's room light hangs a few units overhead, and a standard material's specular blows the stone's top face to white as it falls past it
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r * 0.3), new THREE.MeshLambertMaterial({ color: 0x14181c, emissive: 0x222a33, flatShading: true }));
    rock.castShadow = true;
    rock.scale.set(1, 1.35, 1);
    rock.userData.rest = r * 0.3 * 1.35 * 0.8; // resting on the ground, a little sunk
    rock.raycast = () => {};
    return rock;
  }

  /** Build an enemy's actor the first time the player comes within ACTOR_RANGE of it (and dress it if its model has already loaded). */
  private ensureActor(e: Enemy, s: GameState): Actor | undefined {
    if (Math.hypot(e.x - s.player.x, e.z - s.player.z) > ACTOR_RANGE) return undefined;
    this.addActor(e);
    const a = this.actors.get(e.id)!, p = this.prepared.get(slotOf(e.type));
    if (p) this.dressActor(a, p);
    return a;
  }

  /** Called once per sim tick so we can interpolate between the last two states. */
  snapshot(s: GameState) {
    const next = { x: s.player.x, y: s.player.y, z: s.player.z };
    this.prev = Math.hypot(next.x - this.curr.x, next.z - this.curr.z) > 30 ? next : this.curr; // a long jump (a flight's landing, a respawn) is a cut, not a slide
    this.curr = next;
    for (const e of s.enemies) {
      const a = this.actors.get(e.id) ?? this.ensureActor(e, s);
      if (!a) continue;
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
          const src = ev.src === undefined ? undefined : s.enemies.find(e => e.id === ev.src);
          const ranged = !!src && !!defOf(src).ranged, lag = ranged ? 0 : LEAD; // a bolt lands on the tick; a bite lands when the jaws arrive
          const [dx, dz] = src ? unit(ev.x - src.x, ev.z - src.z) : [-Math.sin(s.player.facing), -Math.cos(s.player.facing)];
          const hold = ev.heavy ? 0.1 : 0.05;
          this.playerAnim?.react(ev.heavy ? 1.6 : 0.8, lag);
          this.playerAnim?.freeze(hold, lag, 0.04);
          if (src && !ranged) this.actors.get(src.id)?.anim?.freeze(hold, 0); // the attacker is caught in the same held frame
          this.after(lag, () => {
            this.shakeMag = Math.max(this.shakeMag, ev.heavy ? 0.25 : 0.06);
            this.punch(dx, dz, ev.heavy ? 0.28 : 0.11);
            this.particles.burst(ev.x, 1.3, ev.z, { color: P.blood, count: 1, speed: 0, size: 5.5, life: 0.09, gravity: 0, hdr: 1.8 });
            this.matter.burst(ev.x, 1.3, ev.z, { color: BLOOD, count: ev.heavy ? 24 : 12, speed: ev.heavy ? 7.5 : 5.5, dir: [dx, dz], cone: 0.5, up: 0.5, gravity: -22, drag: 0.6, size: 0.9, life: 0.45, hdr: 1 });
          });
          if (src && ranged) this.particles.trail(src.x, 1.7, src.z, ev.x, 1.3, ev.z, P.violet); // the bolt
        } else if (ev.dot) {
          this.shakeMag = Math.max(this.shakeMag, 0.04);
          this.impact(s, ev, 0, 0, false);
        } else {
          const A = ABILITIES[ev.slot], heavy = ev.crit || weighty(A), last = ev.slot === FINAL_RECKONING; // the last button there is is held longest and shoves hardest
          const thrown = A?.kind === 'dot', lag = this.playerAnim?.strikeIn ?? 0, hold = last ? 0.2 : heavy ? 0.09 : 0.05;
          const [dx, dz] = unit(ev.x - s.player.x, ev.z - s.player.z);
          const an = this.actors.get(ev.target)?.anim;
          if (!thrown) this.playerAnim?.freeze(hold, lag); // a thrown blade leaves the hand: only a swung one is held in it
          an?.freeze(hold, lag, last ? 0.08 : heavy ? 0.05 : 0.03);
          an?.react(last ? 2.2 : heavy ? 1.5 : 1, lag); // the recoil is the proof the blow landed
          this.after(lag, () => {
            this.shakeMag = Math.max(this.shakeMag, last ? 0.22 : ev.crit ? 0.1 : heavy ? 0.08 : 0);
            this.punch(dx, dz, last ? 0.3 : ev.crit ? 0.2 : heavy ? 0.16 : 0.07);
            this.impact(s, ev, dx, dz, heavy);
          });
          // Bloodbath's leech, drawn: a thread of blood runs from every body the sweep struck back to the one that swung
          if (ev.slot === BLOODBATH) this.after(lag, () => this.particles.trail(ev.x, 1.2, ev.z, s.player.x, 1.3, s.player.z, P.blood));
        }
      } else if (ev.t === 'cast') {
        this.castPunch = 0.12;
        const A = ABILITIES[ev.slot], last = ev.slot === FINAL_RECKONING;
        if (A.kind === 'guard') this.guardCast(A.buff, s); // a raised guard is a ring of light round the player, not a swing
        else if (A.kind !== 'heal' && this.playerAnim) { // a heal has no swing; the heavy ones and the sweeps take the heavy swing
          this.playerAnim.attack(weighty(A), last ? 0.7 : 0.4);
          if (A.arc === 360) this.spinCast(ev.slot, s);
          else this.slash(s, weighty(A), last ? 1.9 : undefined, last ? TRAIL.capstone : undefined);
          if (last) this.rings.pulse(s.player.x, 0.2, s.player.z, P.gold, 0.5, 0.24, 3.2, 1.5); // the whole body drawn into the blow: it lets go as the hold ends
        }
        if (ev.slot === 4) { // the sweep: a wide arc of dust and light in front of the player
          const p = s.player, a = p.facing;
          this.rings.pulse(p.x + Math.sin(a) * 1.4, 0.3, p.z + Math.cos(a) * 1.4, P.arcaneLight, 3.8, 0.28, 1.2);
          for (let k = -2; k <= 2; k++) this.particles.burst(p.x + Math.sin(a + k * 0.45) * 2.2, 1.0, p.z + Math.cos(a + k * 0.45) * 2.2, { color: [P.arcaneLight, P.ash], count: 6, speed: 2.5, life: 0.35 });
        }
      }
      else if (ev.t === 'swing' && this.playerAnim) { this.playerAnim.swung(); this.slash(s, false); } // auto-attack: raises no 'cast', the hit follows this tick
      else if (ev.t === 'jump' && ev.double) {
        // the one takeoff with nothing to push against: the body crouches into it and rolls, and the air gives for an instant, a disc of
        // arcane light snapping out under the feet and gone. That flash is also how the player learns the second jump is spent
        const p = s.player, top = p.y + (p.vy * p.vy) / (2 * GRAVITY);
        this.playerAnim?.doubleJump(p.vy / GRAVITY + Math.sqrt((2 * top) / FALL_GRAVITY)); // the air time still to come, from here
        this.rings.pulse(p.x, p.y + 0.05, p.z, P.arcaneLight, 1.3, 0.22, 0.25, 0.9); // hdr 0.9: at the default it blooms to a white bar from the side
        this.particles.burst(p.x, p.y + 0.1, p.z, { color: [P.arcaneLight, P.ash], count: 10, speed: 2.4, up: -1.2, gravity: -2, size: 0.7, life: 0.35 });
      }
      else if (ev.t === 'jump') this.playerAnim?.jump(ev.airtime); // the clip is stretched over the hop actually taken: Agility makes it a longer one
      else if (ev.t === 'roll') {
        // no roll clip in the pack, so the roll is told by the ground: a kick of dirt where it starts and a low streak of it along the way
        const [dx, dz] = [Math.sin(ev.facing), Math.cos(ev.facing)];
        this.matter.burst(ev.x, 0.2, ev.z, { color: [P.ash, P.dirt], count: 14, speed: 4.5, dir: [-dx, -dz], cone: 0.6, flat: true, gravity: 0, drag: 2.5, size: 1.6, life: 0.4, hdr: 0.8, alpha: 0.6 });
        this.after(ROLL_TIME, () => this.matter.burst(s.player.x, 0.2, s.player.z, { color: [P.ash, P.dirt], count: 8, speed: 2.4, flat: true, gravity: 0, drag: 3, size: 1.4, life: 0.35, hdr: 0.6, alpha: 0.45 }));
      }
      else if (ev.t === 'land') {
        // the dust and the camera are sized to how hard it came down, which is the same number the squash is: a hop is 1, a drop off a rock is more
        const w = this.playerAnim?.touchdown() ?? 1, y = s.player.y + 0.15;
        this.matter.burst(ev.x, y, ev.z, { color: [P.ash, P.dirt], count: Math.round(9 * w), speed: 2.4 * Math.sqrt(w), flat: true, gravity: 0, drag: 2.5, size: 1.8, life: 0.45, hdr: 0.8, alpha: 0.5 });
        if (w > 1.25) this.shakeMag = Math.max(this.shakeMag, 0.06 * (w - 1.25) / 0.45);
      }
      else if (ev.t === 'slam') {
        const src = s.enemies.find(e => e.id === ev.id), hz = src && defOf(src).hazard, stone = !!hz && FALLING.has(hz.name) && hz.radius === ev.radius; // the stone landing, not the boss's own slam
        this.matter.burst(ev.x, 0.2, ev.z, { color: [P.ash, P.dirt], count: 22, speed: ev.radius * 0.9, flat: true, gravity: 0, drag: 2.2, size: 3, life: 0.8, hdr: 0.8, alpha: 0.45 }); // the ground goes up in a ring of dust
        if (stone) this.matter.burst(ev.x, 0.3, ev.z, { color: [P.ash, P.boulder, P.stone], count: 36, speed: 6, up: 3, gravity: -12, size: 1.4, life: 0.8, hdr: 1 });
        else this.particles.burst(ev.x, 0.3, ev.z, { color: [P.bloodLight, P.ember], count: 26, speed: 7, up: 2, size: 0.8, life: 0.7 });
        this.rings.pulse(ev.x, 0.15, ev.z, P.blood, ev.radius * 1.15, 0.5, ev.radius * 0.3);
        this.shakeMag = Math.max(this.shakeMag, Math.hypot(ev.x - s.player.x, ev.z - s.player.z) < ev.radius ? 0.35 : 0.2);
      } else if (ev.t === 'interrupt') {
        this.particles.burst(ev.x, 1.6, ev.z, { color: [P.gold, P.arcaneLight], count: 30, speed: 5, up: 1, life: 0.5 });
        this.rings.pulse(ev.x, 1.4, ev.z, P.gold, 2, 0.3);
        this.shakeMag = Math.max(this.shakeMag, 0.12);
      } else if (ev.t === 'net') { // the net closes round the player's feet
        this.particles.burst(ev.x, 0.5, ev.z, { color: [P.ash, P.arcaneLight], count: 24, speed: 2.5, up: 1, life: 0.6 });
        this.rings.pulse(ev.x, 0.15, ev.z, P.ash, 2, 0.45);
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
        const type = ev.species, big = slotOf(type) === 'brute', matter = matterOf(type);
        const [dx, dz] = unit(ev.x - s.player.x, ev.z - s.player.z), lag = this.playerAnim?.strikeIn ?? 0, hold = big ? 0.16 : 0.11;
        this.playerAnim?.freeze(hold, lag);
        const an = this.actors.get(ev.id)?.anim;
        an?.freeze(hold, lag, 0.04);
        an?.die(big ? 1.1 : 0.7); // the killing blow throws the body back along itself
        this.after(lag, () => {
          this.punch(dx, dz, big ? 0.3 : 0.2);
          if (matter === 'flesh') this.matter.burst(ev.x, 0.9, ev.z, { color: BLOOD, count: big ? 40 : 22, speed: big ? 7.5 : 6.5, dir: [dx, dz], cone: 0.5, up: 1.5, gravity: -20, drag: 0.6, size: 1, life: 0.6, hdr: 1 });
          else if (matter === 'stone') this.matter.burst(ev.x, 0.9, ev.z, { color: [P.ash, P.boulder, P.stone], count: big ? 40 : 24, speed: 6, up: 2.5, gravity: -12, size: 1.3, life: 0.8, hdr: 1 });
          else this.particles.burst(ev.x, 0.9, ev.z, { color: [P.bone, P.arcaneLight], count: big ? 30 : 18, speed: 3, up: 3.5, gravity: -2, size: 0.8, life: 1.0, hdr: 1.4 }); // what held it here lets go
          this.matter.burst(ev.x, 0.15, ev.z, { color: [P.ash, P.dirt], count: big ? 18 : 9, speed: big ? 3.2 : 2.2, flat: true, gravity: 0, drag: 2.5, size: 2.4, life: 0.7, hdr: 0.8, alpha: 0.4 }); // the dust of it hitting the ground
          if (big) this.rings.pulse(ev.x, 0.15, ev.z, P.ash, 4, 0.5, 0.5, 0.8);
        });
        if (big) this.shakeMag = Math.max(this.shakeMag, 0.35);
      } else if (ev.t === 'drop') {
        this.particles.burst(ev.x, 0.6, ev.z, { color: TIER_COLORS[ITEMS[ev.item].tier], count: 14, speed: 1.5, up: 3, gravity: -5, life: 0.8 });
      } else if (ev.t === 'loot') {
        this.particles.burst(s.player.x, 1.6, s.player.z, { color: [P.heal, P.arcaneLight], count: 12, speed: 1.2, up: 2.5, gravity: -3, life: 0.7 });
      } else if (ev.t === 'gather') {
        // the blow landed on the node: what comes off it is thrown back at whoever struck it
        const n = nodeById(s, ev.node);
        if (!n) continue;
        const [dx, dz] = unit(s.player.x - n.x, s.player.z - n.z);
        if (ev.skill === 'mining') {
          this.matter.burst(n.x, 1.1, n.z, { color: [P.ash, P.stone, P.boulder], count: 11, speed: 4, dir: [dx, dz], cone: 0.5, up: 1.2, gravity: -16, size: 1, life: 0.5, hdr: 1 });
          this.particles.burst(n.x, 1.1, n.z, { color: [P.ember, P.gold], count: 5, speed: 3, dir: [dx, dz], cone: 0.6, up: 0.6, size: 0.7, life: 0.22 }); // struck stone throws a few sparks
        } else if (ev.skill === 'woodcutting') {
          this.matter.burst(n.x, 1.2, n.z, { color: [P.bark, P.pine], count: 11, speed: 3.5, dir: [dx, dz], cone: 0.5, up: 1.4, gravity: -14, size: 1.1, life: 0.6, hdr: 1 });
        } else if (ev.skill === 'fishing') {
          this.rings.pulse(n.x, 0.12, n.z, FISH_RIPPLE, 1.7, 0.5, 0.35, 1.2); // the line goes in: a ring on the water and a little spray
          this.matter.burst(n.x, 0.2, n.z, { color: [FISH_RIPPLE, P.slate], count: 8, speed: 1.6, up: 2.2, gravity: -10, size: 0.9, life: 0.5, hdr: 1, alpha: 0.7 });
        } else {
          this.particles.burst(n.x, 0.45, n.z, { color: [P.pine, P.heal], count: 8, speed: 1.2, up: 1.8, gravity: -4, size: 0.8, life: 0.6 }); // a tuft pulled: leaves and a breath of sap
        }
      } else if (ev.t === 'depleted') {
        const n = s.nodes.find(x => x.id === ev.id)!;
        this.particles.burst(n.x, 1, n.z, { color: n.type === 'tree' ? [P.pine, P.bark] : P.smoke, count: 24, speed: 3, up: 1, life: 0.8 });
      } else if (ev.t === 'crafted') {
        const f = stationSites('forge')[nearestSite(s, 'forge')];
        this.particles.burst(f.x - 3, 0.9, f.z + 2, { color: [P.ember, P.fire, P.arcaneLight], count: 50, speed: 5, up: 4, life: 0.9 });
        this.rings.pulse(f.x - 3, 0.3, f.z + 2, P.fire, 3, 0.6);
      } else if (ev.t === 'quest') {
        const p = s.player;
        if (ev.what === 'complete') this.fireworks(p.x, p.z);
        else this.particles.burst(p.x, 1, p.z, { color: [P.arcane, P.arcaneLight], count: 26, speed: 2, up: 4, gravity: -3, life: 1 });
      } else if (ev.t === 'death') {
        this.shakeMag = 0.3;
        this.matter.burst(s.player.x, 1, s.player.z, { color: BLOOD, count: 50, speed: 5, up: 3, gravity: -16, drag: 0.4, size: 1.1, life: 1, hdr: 1 });
      }
    }
  }

  /** Ability-specific hit feedback: each of the four reads differently at a glance. */
  private impact(s: GameState, ev: Extract<GameEvent, { t: 'hit' }>, dx: number, dz: number, heavy: boolean) {
    const p = s.player, y = 1.2, dir: [number, number] = [dx, dz];
    if (ev.dot) return void this.particles.burst(ev.x, y, ev.z, { color: P.violet, count: 5, speed: 1.5, up: 1, life: 0.4 });
    const power = ev.slot === FINAL_RECKONING ? 2.4 : heavy ? 1.6 : 1, matter = matterOf(ev.species);
    const r = ENEMY_TYPES[ev.species]?.radius ?? 0.6, cx = ev.x - dx * r * 0.8, cz = ev.z - dz * r * 0.8; // where the blade met it: the near face, not its middle
    if (ev.slot === 2) {
      this.particles.trail(p.x, 1.4, p.z, ev.x, y, ev.z, P.violet);
      this.particles.burst(ev.x, y, ev.z, { color: [P.violet, P.arcaneLight], count: 12, speed: 3, life: 0.5 });
    } else if (ev.slot === 1) { // Crushing Blow: the ground takes some of it too
      this.particles.burst(ev.x, 0.4, ev.z, { color: [P.fire, P.gold, P.ember], count: 18, speed: 5, dir, cone: 0.35, up: 2, gravity: -10, size: 0.8, life: 0.55 });
      this.rings.pulse(ev.x, 0.15, ev.z, P.fire, 2.8, 0.35, 0.4, 1.4);
    } else if (ev.slot === FINAL_RECKONING) this.reckoning(ev, dx, dz);
    // the contact flash: one big sprite, gone in about five frames; it is what makes the hit read as a hit
    this.particles.burst(cx, y, cz, { color: matter === 'flesh' ? P.bloodLight : [P.ember, P.gold], count: 1, speed: 0, size: 5 * power, life: 0.09, gravity: 0, hdr: matter === 'flesh' ? 1.8 : 2.4 });
    if (matter === 'flesh') {
      this.matter.burst(cx, y, cz, { color: BLOOD, count: Math.round(13 * power), speed: 6.5 * Math.sqrt(power), dir, cone: 0.55, up: 0.4, gravity: -22, drag: 0.6, size: 0.9, life: 0.45, hdr: 1 });
    } else {
      // steel on stone or bone throws sparks in a fan and a little grit that falls where it is
      this.particles.burst(cx, y, cz, { color: [P.ember, P.gold, P.arcaneLight], count: Math.round(6 * power), speed: 8, dir, cone: 0.45, up: 1, gravity: -16, drag: 1.5, size: 0.9, life: 0.35 });
      this.matter.burst(cx, y, cz, { color: matter === 'stone' ? [P.ash, P.boulder] : [P.bone, P.ash], count: Math.round(5 * power), speed: 3, dir, cone: 0.3, up: 1.5, gravity: -12, size: 1.4, life: 0.5, hdr: 1 });
    }
    if (ev.crit) this.particles.burst(ev.x, y + 0.4, ev.z, { color: [P.gold, P.arcaneLight], count: 12, speed: 5, up: 2, size: 0.8, life: 0.5 });
  }

  /** A cut of the blade. While Echo Surge is on, a wider, golden one follows a beat behind it: the buff shows in every blow it feeds. */
  private slash(s: GameState, heavy: boolean, scale?: number, color?: THREE.Color) {
    const { x, z, facing } = s.player;
    this.slashes.swipe(x, z, facing, heavy, scale, color);
    if (s.player.buffs.some(b => b.id === 'echo_surge')) this.after(0.09, () => this.slashes.swipe(x, z, facing, heavy, (scale ?? (heavy ? 1.35 : 1)) * 1.25, TRAIL.echo, 0.35));
  }

  /** The 360 degree blows: one turn of the blade at the reach of the sweep. Whirlwind is plain steel; Bloodbath is red and Shockwave sets the ground off. */
  private spinCast(slot: number, s: GameState) {
    const p = s.player, A = ABILITIES[slot], r = A.range;
    this.slashes.spin(p.x, p.z, p.facing, r, slot === BLOODBATH ? TRAIL.blood : undefined);
    if (p.buffs.some(b => b.id === 'echo_surge')) this.after(0.1, () => this.slashes.spin(p.x, p.z, p.facing + 1, r * 1.2, TRAIL.echo));
    if (slot === SHOCKWAVE) { // the stagger is the enemies' (the interrupt event holds each of them); the wave that did it runs out along the ground from the feet
      this.rings.pulse(p.x, 0.2, p.z, P.gold, r * 1.15, 0.4, 0.8, 1.4);
      this.matter.burst(p.x, 0.2, p.z, { color: [P.ash, P.dirt], count: 24, speed: r * 2.4, flat: true, gravity: 0, drag: 2.5, size: 2.2, life: 0.6, hdr: 0.8, alpha: 0.5 });
      this.shakeMag = Math.max(this.shakeMag, 0.1);
    } else if (slot === BLOODBATH) this.matter.burst(p.x, 1.0, p.z, { color: BLOOD, count: 14, speed: 4.5, up: 0.5, gravity: -22, drag: 0.6, size: 0.9, life: 0.45, hdr: 1 });
  }

  /** A raised buff. Guard is light round the body; Rampart is a wall closing on it, and Echo Surge is heat climbing it: two buttons that do opposite things do not get one picture. */
  private guardCast(buff: string | undefined, s: GameState) {
    const p = s.player;
    if (buff === 'rampart') {
      for (const y of [0.25, 0.95, 1.65]) this.rings.pulse(p.x, y, p.z, P.steel, 0.85, 0.22, 2.1, 1); // three bands of steel snap shut on the body together
      this.matter.burst(p.x, 0.2, p.z, { color: [P.ash, P.dirt], count: 14, speed: 4, flat: true, gravity: 0, drag: 2.5, size: 1.8, life: 0.45, hdr: 0.8, alpha: 0.5 }); // and the ground takes the weight
      this.shakeMag = Math.max(this.shakeMag, 0.05);
    } else if (buff === 'echo_surge') {
      [0.2, 0.9, 1.6].forEach((y, i) => this.after(i * 0.08, () => this.rings.pulse(p.x, y, p.z, i === 1 ? P.gold : P.ember, 2.1, 0.45, 0.7, 1.8))); // bands of heat climb the body one after another
      this.particles.burst(p.x, 0.3, p.z, { color: [P.gold, P.ember, P.fire], count: 26, speed: 1.2, up: 5, gravity: -1, life: 0.9, size: 0.8 });
    } else {
      this.rings.pulse(p.x, 0.3, p.z, P.arcaneLight, 2.4, 0.4, 0.8);
      this.particles.burst(p.x, 1.0, p.z, { color: [P.arcaneLight, P.gold], count: 14, speed: 2, up: 1.5, life: 0.5 });
    }
  }

  /** Final Reckoning's landing: the ground takes the blow at once, and lets go of it when the hold on the frame ends (0.2 s, the same as the hit-stop). */
  private reckoning(ev: Extract<GameEvent, { t: 'hit' }>, dx: number, dz: number) {
    this.particles.burst(ev.x, 0.4, ev.z, { color: [P.fire, P.gold, P.ember], count: 30, speed: 6, dir: [dx, dz], cone: 0.35, up: 3, gravity: -10, size: 0.9, life: 0.6 });
    this.rings.pulse(ev.x, 0.15, ev.z, P.fire, 3.4, 0.4, 0.5, 1.6);
    this.matter.burst(ev.x, 0.2, ev.z, { color: [P.ash, P.dirt], count: 20, speed: 7, flat: true, gravity: 0, drag: 2.2, size: 2.4, life: 0.6, hdr: 0.8, alpha: 0.5 });
    this.after(0.2, () => {
      this.rings.pulse(ev.x, 0.15, ev.z, P.gold, 6, 0.6, 1, 1.2);
      this.rings.pulse(ev.x, 0.15, ev.z, P.fire, 5, 0.5, 0.6, 1.8);
      this.particles.burst(ev.x, 0.3, ev.z, { color: [P.gold, P.ember, P.fire], count: 36, speed: 1.5, up: 7, gravity: -3, life: 1, size: 0.8 }); // the column
      this.matter.burst(ev.x, 0.2, ev.z, { color: [P.ash, P.dirt], count: 30, speed: 12, flat: true, gravity: 0, drag: 2.2, size: 2.6, life: 0.8, hdr: 0.8, alpha: 0.5 });
      this.shakeMag = Math.max(this.shakeMag, 0.3);
      this.punch(dx, dz, 0.3);
    });
  }

  /** Run `fn` once `t` seconds have passed on the render clock (at once if it is already time). */
  private after(t: number, fn: () => void) { if (t > 0.005) this.later.push({ t, fn }); else fn(); }

  /** Shove the camera along (dx, dz), a unit vector: the view is carried with the blow. */
  private punch(dx: number, dz: number, mag: number) {
    const x = this.kick.x + dx * mag, z = this.kick.z + dz * mag, n = Math.hypot(x, z), cap = 0.35;
    this.kick.x = n > cap ? x / n * cap : x; this.kick.z = n > cap ? z / n * cap : z;
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

  /** The merchant under the click ('hale', 'harbour', 'thorn', 'high' or 'trainer'), or null. */
  pickVendor(clientX: number, clientY: number): string | null {
    this.raycaster.setFromCamera(
      new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1), this.camera);
    if (this.raycaster.intersectObjects(this.vendorParts, false).length > 0) return 'hale';
    const trainer = this.raycaster.intersectObjects(this.world.trainerPicks(), false)[0]; // Saltmarrow's or Thornwick's, by the id the figure was tagged with
    if (trainer) return trainer.object.userData.id;
    return this.raycaster.intersectObjects(this.world.vendorPicks(), false)[0]?.object.userData.id ?? null; // Saltmarrow's chandler or Thornwick's provisioner
  }

  /** The flight master under the click (a town id), or null. */
  pickFlightMaster(clientX: number, clientY: number): string | null {
    this.raycaster.setFromCamera(
      new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1), this.camera);
    if (this.raycaster.intersectObjects(this.flightParts, false).length > 0) return 'hale';
    return this.raycaster.intersectObjects(this.world.flightPicks(), false)[0]?.object.userData.id ?? null; // each master's figure is tagged with its town
  }

  /** The quest giver under the click ('hale', 'harbour', 'thorn' or 'high'), or null. */
  pickNpc(clientX: number, clientY: number): string | null {
    this.raycaster.setFromCamera(
      new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1), this.camera);
    if (this.raycaster.intersectObjects([...this.npcParts, this.npcMarker], false).length > 0) return 'hale';
    return this.raycaster.intersectObjects(this.world.npcPicks(), false)[0]?.object.userData.id ?? null;
  }

  /**
   * Id of the click volume under a screen position, or null. A volume is a chain of spheres up the object, tested in
   * screen pixels, so it is as easy to hit at range as it is up close. `tolerance` is extra pixels of forgiveness
   * around the silhouette (0 = the volume itself). Several candidates resolve deterministically: nearest to the cursor
   * (inside a volume counts as 0), then nearest to the camera.
   */
  private pickVolumes(clientX: number, clientY: number, tolerance: number, vols: PickCandidate[]): number | null {
    const focal = innerHeight / 2 / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const v = new THREE.Vector3();
    let best: { id: number; miss: number; depth: number } | null = null;
    for (const c of vols) {
      let miss = Infinity, depth = Infinity;
      for (let i = 0; i <= PICK_SPHERES; i++) {
        v.set(c.x, (c.height * i) / PICK_SPHERES, c.z).applyMatrix4(this.camera.matrixWorldInverse);
        if (-v.z <= this.camera.near) continue; // behind the camera
        const k = focal / -v.z, d = Math.hypot(v.x * k + innerWidth / 2 - clientX, -v.y * k + innerHeight / 2 - clientY) - c.radius * k;
        if (d < miss) miss = d;
        depth = Math.min(depth, -v.z);
      }
      miss = Math.max(0, Math.round(miss)); // whole pixels: two candidates both under the cursor tie, and the nearer one wins
      if (miss > tolerance) continue;
      if (!best || miss < best.miss || (miss === best.miss && depth < best.depth)) best = { id: c.id, miss, depth };
    }
    return best ? best.id : null;
  }

  /** Enemy id under a screen position, or null. The volume is sized from the model that is drawn (SLOTS height), not from the primitive the model replaced. */
  pickEnemy(clientX: number, clientY: number, tolerance = 0): number | null {
    const vols: PickCandidate[] = [];
    for (const [id, a] of this.actors) {
      if (!a.group.visible || a.dead) continue;
      vols.push({ id, x: a.group.position.x, z: a.group.position.z, ...pickVolume(a.type) });
    }
    return this.pickVolumes(clientX, clientY, tolerance, vols);
  }

  /**
   * Gatherable node id under a screen position, or null. A trunk is thin and a rock is low, so the exact ray is only the
   * first try: a miss falls back to the same forgiving volume the enemies use, shrunk with a spent node's model.
   */
  pickNode(clientX: number, clientY: number, tolerance = 0): number | null {
    this.raycaster.setFromCamera(
      new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1), this.camera);
    const live = [...this.nodes].filter(([, n]) => n.group.visible); // a ray ignores `visible`: the far ones are left out here
    const hit = this.raycaster.intersectObjects(live.map(([, n]) => n.group), true)[0];
    for (let o: THREE.Object3D | null = hit?.object ?? null; o; o = o.parent) if (o.userData.nodeId !== undefined) return o.userData.nodeId as number;
    return this.pickVolumes(clientX, clientY, tolerance, live.map(([id, n]) => {
      const { height, radius } = nodeVolume(n.type, n.crown ? !n.crown.visible : false), s = n.group.scale.x; // only a tree has a crown, and drawNodes hides it once the tree is felled
      return { id, x: n.group.position.x, z: n.group.position.z, height: height * s, radius: radius * s };
    }));
  }

  /** The id of the chest under a screen position, or null: the exact ray first, then the same forgiving volume a node gets. A chest is low and a click is wide. */
  pickChest(clientX: number, clientY: number, tolerance = 0): string | null {
    this.raycaster.setFromCamera(
      new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1), this.camera);
    const shown = [...this.chests.values()].flatMap(v => Object.values(v.states).filter(g => g.visible));
    const hit = this.raycaster.intersectObjects(shown, true)[0];
    for (let o: THREE.Object3D | null = hit?.object ?? null; o; o = o.parent) if (o.userData.chestId !== undefined) return o.userData.chestId as string;
    const idx = this.pickVolumes(clientX, clientY, tolerance, shown.map(g => ({ id: CHESTS.findIndex(c => c.id === g.userData.chestId), x: g.position.x, z: g.position.z, height: 0.6 + g.position.y, radius: 0.7 })));
    return idx === null ? null : CHESTS[idx].id;
  }

  /** The id (a town id) of the notice board under a screen position, or null: the exact ray, then the forgiving volume. */
  pickBoard(clientX: number, clientY: number, tolerance = 0): string | null {
    this.raycaster.setFromCamera(
      new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1), this.camera);
    const hit = this.raycaster.intersectObjects(this.boards, true)[0];
    if (hit) return BOARDS[this.boards.findIndex(g => hit.object.parent === g)]?.id ?? null;
    const idx = tolerance > 0 ? this.pickVolumes(clientX, clientY, tolerance, this.boards.map((g, i) => ({ id: i, x: g.position.x, z: g.position.z, height: 2.3, radius: 1.1 }))) : null;
    return idx === null ? null : BOARDS[idx].id;
  }

  /** The index into `stationSites('forge')` of the forge building under the click, or null when it lands on none. */
  pickForge(clientX: number, clientY: number): number | null {
    this.raycaster.setFromCamera(
      new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1), this.camera);
    const i = this.forgeSites.findIndex(parts => this.raycaster.intersectObjects(parts, false).length > 0);
    return i < 0 ? null : i;
  }

  /** True when the click lands on the cooking range. */
  pickRange(clientX: number, clientY: number): boolean {
    this.raycaster.setFromCamera(
      new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1), this.camera);
    return this.raycaster.intersectObjects(this.rangeParts, false).length > 0;
  }

  /** True when the click lands on the alembic in Thornwick. */
  pickAlembic(clientX: number, clientY: number): boolean {
    this.raycaster.setFromCamera(
      new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1), this.camera);
    return this.raycaster.intersectObject(this.alembicPick, false).length > 0;
  }

  /** True when the click lands on the tanning rack in Highmoor. */
  pickRack(clientX: number, clientY: number): boolean {
    this.raycaster.setFromCamera(
      new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1), this.camera);
    return this.raycaster.intersectObject(this.rackPick, false).length > 0;
  }

  /** True when the click lands on the rune circle in the Spire. */
  pickCircle(clientX: number, clientY: number): boolean {
    this.raycaster.setFromCamera(
      new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1), this.camera);
    return this.raycaster.intersectObject(this.circlePick, false).length > 0;
  }

  /**
   * Everything above in one answer: what is under a screen position, or null for nothing at all. One chain, used
   * by the click that acts on it (main.ts) and by the cursor that shows what the click would do (HOM-142), so
   * the pointer can never promise something the press would not deliver.
   *
   * Precedence, most specific first: an enemy under the position itself, then the NPC, flight master, node,
   * vendor and the five stations (all exact), and only then the forgiving picks Ã¢â‚¬â€ a near miss takes the enemy,
   * else the node, but never something that was really aimed at elsewhere. `tolerance` is how many pixels of
   * near miss still count; 0 leaves the forgiving pass out.
   */
  pickAt(clientX: number, clientY: number, tolerance = 0): Pick | null {
    const enemy = this.pickEnemy(clientX, clientY);
    if (enemy !== null) return { k: 'enemy', id: enemy };
    const node = this.pickNode(clientX, clientY), npc = this.pickNpc(clientX, clientY);
    const vendor = this.pickVendor(clientX, clientY), flightMaster = this.pickFlightMaster(clientX, clientY), forge = this.pickForge(clientX, clientY);
    if (npc !== null) return { k: 'npc', id: npc };
    if (flightMaster !== null) return { k: 'flightmaster', id: flightMaster };
    if (node !== null) return { k: 'node', id: node };
    const chest = this.pickChest(clientX, clientY);
    if (chest !== null) return { k: 'chest', id: chest };
    const board = this.pickBoard(clientX, clientY);
    if (board !== null) return { k: 'board', id: board };
    if (vendor !== null) return { k: 'vendor', id: vendor };
    if (forge !== null) return { k: 'forge', site: forge };
    if (this.pickRange(clientX, clientY)) return { k: 'range' };
    if (this.pickAlembic(clientX, clientY)) return { k: 'alembic' };
    if (this.pickRack(clientX, clientY)) return { k: 'rack' };
    if (this.pickCircle(clientX, clientY)) return { k: 'circle' };
    if (tolerance > 0) {
      const nearEnemy = this.pickEnemy(clientX, clientY, tolerance);
      if (nearEnemy !== null) return { k: 'enemy', id: nearEnemy };
      const nearNode = this.pickNode(clientX, clientY, tolerance);
      if (nearNode !== null) return { k: 'node', id: nearNode };
      const nearChest = this.pickChest(clientX, clientY, tolerance);
      if (nearChest !== null) return { k: 'chest', id: nearChest };
      const nearBoard = this.pickBoard(clientX, clientY, tolerance);
      if (nearBoard !== null) return { k: 'board', id: nearBoard };
    }
    return null;
  }

  /** World point to screen pixels; null when behind the camera. */
  project(x: number, y: number, z: number): { x: number; y: number } | null {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    if (v.z > 1) return null;
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
  }

  /** Show the world map screen instead of the game (the ride shows the same map by itself, whatever this says). */
  setMapScreen(on: boolean) { this.mapScreen = on; }
  /** A town's beacon / the player's pin on the map screen, in CSS pixels (null before the map is first drawn or when off screen). */
  mapProject(town: string) { return this.mapScene?.project(town) ?? null; }
  mapProjectYou() { return this.mapScene?.projectYou() ?? null; }

  /** The world map in place of the game: the screen (looking down, with the player's pin) or, mid-flight, the bird's-eye ride. */
  private drawMap(s: GameState, ride: Extract<NonNullable<GameState['player']['action']>, { k: 'flight' }> | null) {
    const map = this.mapScene ??= new WorldMap(), now = performance.now(), aspect = innerWidth / innerHeight;
    this.lastDraw = now;
    map.setFound(s.found);
    if (ride) {
      map.frameRide(ride.from, ride.to, ride.t / ride.duration, aspect, now);
      const at = landingSpot(ride.to);
      this.world.update(at.x, at.z); // the arrival is built while the ride runs, so landing costs no frame
    } else {
      const me = mapPosition(s.player.x, s.player.z);
      map.setYou(me.x, me.z, now);
      map.frameScreen(aspect);
    }
    map.update(now);
    this.renderer.render(map.scene, map.camera);
  }

  draw(s: GameState, alpha: number) {
    const a = s.player.action, ride = a?.k === 'flight' ? a : null;
    this.inMap = !!ride || this.mapScreen;
    if (this.inMap) return this.drawMap(s, ride);
    const x = this.prev.x + (this.curr.x - this.prev.x) * alpha;
    const z = this.prev.z + (this.curr.z - this.prev.z) * alpha;
    // the hop rides the same interpolation as the ground does: taken raw, a half-second arc is 16 sim steps the display
    // shows twice each, so the body climbs in stairs while its shadow slides
    const py = this.prev.y + (this.curr.y - this.prev.y) * alpha;
    this.castPunch = Math.max(0, this.castPunch - 1 / 60);
    const nowMs = performance.now(), dtFx = Math.min(0.1, (nowMs - this.lastDraw) / 1000);
    this.lastDraw = nowMs;
    for (let i = this.later.length - 1; i >= 0; i--) if ((this.later[i].t -= dtFx) <= 0) this.later.splice(i, 1)[0].fn();
    this.particles.update(dtFx);
    this.matter.update(dtFx);
    this.motes.update(dtFx);
    this.rings.update(dtFx);
    this.slashes.update(dtFx);
    this.world.update(x, z);
    this.beyond.position.set(x, -0.05, z);
    const hm = harbourMarkOf(s);
    this.harbourMarker.visible = !!hm && this.world.harbourShown();
    if (hm && this.harbourMarker.visible) {
      (this.harbourMarker.material as THREE.SpriteMaterial).map = this.markerTex[hm];
      this.harbourMarker.position.set(HARBOURMASTER.x, 3.5 + 0.18 * Math.sin(nowMs / 250 + 1), HARBOURMASTER.z);
    }
    const rm = reeveMarkOf(s); // Thornwick's reeve: only worth drawing when the town is the one on screen
    this.reeveMarker.visible = !!rm && Math.hypot(THORN_REEVE.x - x, THORN_REEVE.z - z) < 150;
    if (rm && this.reeveMarker.visible) {
      (this.reeveMarker.material as THREE.SpriteMaterial).map = this.markerTex[rm];
      this.reeveMarker.position.set(THORN_REEVE.x, 3.5 + 0.18 * Math.sin(nowMs / 250 + 2), THORN_REEVE.z);
    }
    const sm = stewardMarkOf(s); // Highmoor's Steward, the same way
    this.stewardMarker.visible = !!sm && Math.hypot(HIGH_STEWARD.x - x, HIGH_STEWARD.z - z) < 150;
    if (sm && this.stewardMarker.visible) {
      (this.stewardMarker.material as THREE.SpriteMaterial).map = this.markerTex[sm];
      this.stewardMarker.position.set(HIGH_STEWARD.x, 3.5 + 0.18 * Math.sin(nowMs / 250 + 3), HIGH_STEWARD.z);
    }
    const km = keeperMarkOf(s); // and the Spire's Keeper
    this.keeperMarker.visible = !!km && Math.hypot(SPIRE_KEEPER.x - x, SPIRE_KEEPER.z - z) < 150;
    if (km && this.keeperMarker.visible) {
      (this.keeperMarker.material as THREE.SpriteMaterial).map = this.markerTex[km];
      this.keeperMarker.position.set(SPIRE_KEEPER.x, 3.5 + 0.18 * Math.sin(nowMs / 250 + 4), SPIRE_KEEPER.z);
    }
    const mk = markerOf(s);
    this.npcMarker.visible = !!mk;
    if (mk) {
      (this.npcMarker.material as THREE.SpriteMaterial).map = this.markerTex[mk];
      this.npcMarker.position.set(NPC.x, 3.5 + 0.18 * Math.sin(nowMs / 250), NPC.z);
    }
    const pa = this.playerAnim, pl = s.player;
    this.player.rotation.y = pl.facing;
    // working a node: the swing rides the sim's own strike beat, so the pick lands with the sound and the chips
    const act = pl.action?.k === 'gather' ? pl.action : null, work = act && nodeById(s, act.nodeId);
    const workSkill = work ? NODE_TYPES[work.type].skill : null;
    if (pa) {
      if (pl.dead !== this.playerWasDead) { if (pl.dead) pa.die(); else pa.revive(); this.playerWasDead = pl.dead; }
      pa.locomotion(pl.moving && !pl.dead, pl.rolling > 0 ? ROLL_SPEED : pl.sprinting ? SPRINT_SPEED : FOOT_SPEED); // a sprint, and harder a roll, plays the same run clip faster, so the legs keep up with the ground
      pa.gather(workSkill, act ? (act.t % GATHER_STRIKE) / GATHER_STRIKE : 0);
      for (const rig of this.mounts.values()) if (rig.root.visible) { rig.update(dtFx, pl.moving && !pl.dead); pa.rideBob(rig.bob); }
      pa.update(dtFx);
      pa.airborne(pl.airborne ? pl.vy : 0);
      // the second jump is still in hand: a thin trickle of arcane light falls from the feet for as long as it is, and stops the moment it is spent
      this.doubleReadyT += dtFx;
      if (pl.airborne && !pl.airJumped && !pl.dead && canDoubleJump(pl) && this.doubleReadyT > 0.06) {
        this.doubleReadyT = 0;
        this.particles.burst(x, pl.y + 0.08, z, { color: P.arcaneLight, count: 1, speed: 0.35, gravity: -0.5, size: 0.55, life: 0.4, hdr: 1.4 });
      }
      // auto-attack's swing timer is the sim's, so the wind-up can start early enough that the strike lands on the beat
      const tgt = pl.autoAttack && !pl.dead && s.targetId !== null ? s.enemies.find(e => e.id === s.targetId) : undefined;
      if (tgt && Math.hypot(tgt.x - pl.x, tgt.z - pl.z) <= AUTO_RANGE) pa.anticipate(pl.swing);
      this.player.position.set(x, py, z); // py: the sim's jump offset, presentation only
      this.player.rotation.x = pl.dead && !pa.hasDeath ? -Math.PI / 2 : 0;
      this.player.scale.setScalar(1);
    } else {
      this.player.position.set(x, (pl.dead ? 0.5 : 1) + py, z);
      this.player.rotation.x = pl.dead ? -Math.PI / 2 : 0;
      this.player.scale.setScalar(1 + this.castPunch * 1.2);
    }
    if (this.npcAnim) { this.npcAnim.locomotion(false); this.npcAnim.update(dtFx); }

    for (const e of s.enemies) this.drawActor(e, alpha, dtFx);
    this.drawWithering(x, z, nowMs);
    this.drawDrops(s);
    this.drawNodes(s);
    this.drawChests(s, nowMs);
    if (this.gear) {
      this.gear.sync(s.player.equipment, dtFx, this.motes);
      this.gear.hold(workSkill); // after sync: a slot rebuilt this frame does not know a tool is out in place of the sword
    }
    else { // primitive fallback until (or unless) the knight model loads
      const w = s.player.equipment.weapon;
      this.weapon.visible = !!w;
      if (w) (this.weapon.material as Mat).color.setHex(TIER_COLORS[ITEMS[w].tier]);
    }

    const target = s.targetId === null ? undefined : s.enemies.find(e => e.id === s.targetId);
    this.selection.visible = !!target;
    if (target) {
      const a = this.actors.get(target.id) ?? { px: target.x, pz: target.z, cx: target.x, cz: target.z };
      const r = defOf(target).radius + 0.5 + 0.05 * Math.sin(performance.now() / 120);
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

    // orbit camera; y clamped above ground so it never clips through
    // it rides the floor you stand on in full and half of a jump above it (eased, so stepping onto a perch does not pop): a pure translation (the view angle never changes), so the hop reads without the horizon lurching
    const floor = perchAt(pl.x, pl.z, pl.y)?.top ?? 0;
    this.camLift += (floor + (pl.y - floor) * CAMERA_JUMP_FOLLOW - this.camLift) * Math.min(1, dtFx * CAMERA_LIFT_EASE);
    const cp = Math.cos(this.pitch), lift = this.camLift;
    if (pl.mounted !== this.rideShown) { this.rideShown = pl.mounted; this.setMounted(pl.mounted, moveSpeed(pl), bestMount(pl)?.id); }
    this.mountedBlend += ((pl.mounted ? 1 : 0) - this.mountedBlend) * Math.min(1, dtFx * MOUNT_CAMERA_EASE);
    const fov = CAMERA_FOV + this.mountedBlend * MOUNT_FOV_OPEN;
    if (Math.abs(fov - this.camera.fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    const dist = this.distance * (1 + this.mountedBlend * MOUNT_CAMERA_PULL);
    this.camera.position.set(
      x + Math.sin(this.yaw) * cp * dist,
      Math.max(0.5, 1.5 + lift + Math.sin(this.pitch) * dist),
      z + Math.cos(this.yaw) * cp * dist);
    if (inCave(x, z)) this.pullCameraInside(x, 1.5 + lift, z);
    this.shakeMag *= 0.88;
    if (this.shakeMag > 0.005) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeMag;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeMag;
    }
    const decay = Math.exp(-dtFx * 14);
    this.kick.x *= decay; this.kick.z *= decay;
    this.camera.position.x += this.kick.x; this.camera.position.z += this.kick.z;
    this.camera.lookAt(x + this.kick.x, 1.5 + lift, z + this.kick.z);
    if (this.debugCam) { this.camera.position.fromArray(this.debugCam.pos); this.camera.lookAt(...(this.debugCam.at as [number, number, number])); } // dev only: bench/look.mjs close-ups
    this.forgeLights.forEach((l, i) => { l.intensity = FORGE_LIGHT.intensity * (1 + 0.07 * Math.sin(nowMs / 90 + i * 2.1) + 0.05 * Math.sin(nowMs / 37 + i)); });
    this.weather.update(dtFx);
    this.skyClock += dtFx;
    this.applyCaveLight(caveDepth(x, z), x, z, pl.stats.light, nowMs);
    this.caveFlames.forEach(f => f.m.scale.set(1, 0.85 + 0.25 * Math.sin(nowMs / 110 + f.phase) + 0.1 * Math.sin(nowMs / 47 + f.phase), 1));
    tickHalos(nowMs / 1000); // every glow in the scene flickers off one clock
    for (const l of this.brazierLights) l.intensity = BRAZIER_LIGHT.intensity * (1 + 0.08 * Math.sin(nowMs / 100) + 0.05 * Math.sin(nowMs / 41));
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
        group.position.set(d.x, 0, d.z);
        this.scene.add(group);
        v = { group, gem };
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

  /** Withering Ground, from the sim's patches: the same circle a boss's mark draws, but full and slow rather than filling, and in sickly green so it is never mistaken for a hit on its way. Only the ones within sight exist. */
  private drawWithering(px: number, pz: number, nowMs: number) {
    const pulse = 0.5 + 0.5 * Math.sin(nowMs / 700);
    WITHERING.forEach((h, i) => {
      const near = Math.hypot(h.x - px, h.z - pz) < FOG_CULL + h.r;
      let m = this.witherMarks.get(i);
      if (!m) {
        if (!near) return;
        this.witherMarks.set(i, m = this.makeTele(h.r, WITHER_EDGE));
        (m.fill.material as THREE.MeshBasicMaterial).color.setHex(WITHER_FILL);
        m.root.position.set(h.x, 0.07, h.z);
      }
      m.root.visible = near;
      if (!near) return;
      (m.fill.material as THREE.MeshBasicMaterial).opacity = 0.22 + 0.1 * pulse;
      (m.outline.material as THREE.MeshBasicMaterial).opacity = 0.45 + 0.3 * pulse;
    });
  }

  private drawActor(e: Enemy, alpha: number, dt: number) {
    const a = this.actors.get(e.id);
    if (!a) return; // not built yet: it is further than ACTOR_RANGE from the player
    const g = a.group, an = a.anim, dead = e.state === 'dead';
    const band = echoBand(echoLevelOf(e) ?? 0);
    if (band !== a.echo) this.setEcho(a, band); // the sim re-rolls a spawn as an Echo (or back) on the same enemy
    g.visible = !dead || e.deadFor < 2;
    g.position.set(a.px + (a.cx - a.px) * alpha, 0, a.pz + (a.cz - a.pz) * alpha);
    // past the fog a model is invisible but still costs a skinned draw and a mixer update: skip both
    if (Math.hypot(g.position.x - this.camera.position.x, g.position.z - this.camera.position.z) > FOG_CULL) { g.visible = false; if (a.tele) a.tele.root.visible = false; if (a.ground) a.ground.root.visible = false; a.swing = e.swing; a.flash = e.hitFlash; return; }
    g.rotation.y = e.facing;
    let lunge = 1 + e.swing * 2, shrink = Math.max(0.05, 1 - e.deadFor / 2), fall = dead;
    if (an) {
      const speed = defOf(a).speed, moving = !dead && Math.hypot(a.cx - a.px, a.cz - a.pz) > 1e-3;
      if (dead !== a.dead) { if (dead) an.die(); else an.revive(); }
      // a bite is `attackCd` away and the sim gives no warning of its own: draw back for it, so the lunge has a wind-up the player can read
      const def = defOf(a);
      if (!dead && e.state === 'chase' && !e.cast && e.stagger <= 0 && !def.ranged && !(def.heavy && e.heavyCd <= 0) && e.attackCd > 0
        && Math.hypot(e.x - this.curr.x, e.z - this.curr.z) <= def.attackRange) an.anticipate(e.attackCd, 0.35);
      if (!dead && e.swing > a.swing) an.swung();
      lunge = 1; // the swing is a clip or a procedural lunge on the model, never a scale pop
      an.locomotion(moving, speed);
      an.telegraph(e.cast && !dead ? e.cast.kind : null, e.cast ? e.cast.t / e.cast.total : 0);
      // a low wind-up scrapes the ground it is about to take the legs from: grit streams flat out along the floor, thicker as it winds
      if (e.cast && !dead && TELLS[e.cast.kind]?.scrape && Math.random() < dt * 22 * (0.4 + 0.6 * (e.cast.t / e.cast.total))) {
        const [fx, fz] = [Math.sin(e.facing), Math.cos(e.facing)], side = (Math.random() - 0.5) * 1.6;
        this.matter.burst(e.x + fx * 0.9 + fz * side, 0.12, e.z + fz * 0.9 - fx * side, { color: [P.ash, P.dirt], count: 2, speed: 1.6, dir: [fx, fz], cone: 0.5, flat: true, gravity: 0, drag: 2.2, size: 1.3, life: 0.5, hdr: 0.8, alpha: 0.5 });
      }
      an.update(dt);
      // every animated rig topples or plays its death, holds, then shrinks away
      if (an.hasDeath) { fall = false; shrink = e.deadFor < 1 ? 1 : Math.max(0.05, 2 - e.deadFor); }
    }
    a.swing = e.swing; a.flash = e.hitFlash; a.dead = dead;
    g.rotation.z = fall ? Math.PI / 2 : 0;
    g.position.y = fall ? defOf(e).radius : 0;
    g.scale.setScalar((dead ? shrink : lunge) * a.scale); // shrink away when dead
    // the tell: a wind-up reddens and swells the model (and leans it back), and a heavy fills its ground circle until it lands
    const wind = e.cast && !dead ? e.cast.t / e.cast.total : 0;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / (90 - 50 * wind));
    if (wind > 0 && !an) { g.scale.multiplyScalar(1 + 0.12 * wind); if (a.model) a.model.rotation.x = -0.3 * wind; } // primitives (models not yet loaded) keep the old swell
    // an Echo's slam is on a row the actor was not built from: a boar that respawns as an Echo keeps its body, so the circle is made the first time it winds one
    if (e.cast?.kind === 'heavy' && !dead) a.tele ??= this.makeTele(defOf(e).heavy!.radius);
    if (a.tele) {
      a.tele.root.visible = e.cast?.kind === 'heavy' && !dead;
      a.tele.root.position.set(g.position.x, 0.08, g.position.z);
      a.tele.fill.scale.set(wind, 1, wind);
      (a.tele.fill.material as THREE.MeshBasicMaterial).opacity = 0.2 + 0.4 * wind;
      (a.tele.outline.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.5 * pulse;
    }
    const gc = e.cast?.kind === 'ground' && !dead ? e.cast : null; // the mark under the player: drawn from state, so it needs no event
    if (gc) {
      a.ground ??= this.makeTele(gc.radius!);
      if (FALLING.has(defOf(e).hazard?.name ?? '') && !a.ground.rock) a.ground.root.add(a.ground.rock = this.makeFallingStone(gc.radius!));
    }
    if (a.ground) {
      a.ground.root.visible = !!gc;
      if (gc) {
        a.ground.root.position.set(gc.x!, 0.08, gc.z!);
        if (a.ground.rock) { // the stone drops from out of the frame and quickens as it falls, so it is the thing the eye follows down to the ring; the cast ending is the landing
          a.ground.rock.position.y = FALL_HEIGHT * (1 - wind * wind) + a.ground.rock.userData.rest;
          a.ground.rock.rotation.set(wind * 2.4, wind * 3.1, 0);
        }
        a.ground.fill.scale.set(wind, 1, wind);
        (a.ground.fill.material as THREE.MeshBasicMaterial).opacity = 0.2 + 0.4 * wind;
        (a.ground.outline.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.5 * pulse;
      }
    }
    if (dead) for (const m of a.mats) { m.emissive.setHex(0x000000); (m.userData.echoRim?.value as THREE.Color | undefined)?.setHex(0); } // a corpse takes no hostile tint, no hit flash (hitFlash stops ticking on death) and no rim
    else if (e.hitFlash > 0) for (const m of a.mats) m.emissive.setHex(P.bloodLight).multiplyScalar(0.7 * Math.min(1, e.hitFlash / 0.12)); // a flash that fades, never so hot the model loses its facets
    else if (wind > 0) for (const m of a.mats) m.emissive.setRGB(0.12 + 0.38 * wind * (0.6 + 0.4 * pulse), 0.06, 0.03);
    else if (a.echo) { // an Echo breathes, each out of step with the next
      const s = 1 - ECHO_SHIMMER.depth * (0.5 + 0.5 * Math.sin(performance.now() / 1000 * Math.PI * 2 / ECHO_SHIMMER.period + a.t * 1.7));
      for (const m of a.mats) { m.emissive.setHex(a.glow).multiplyScalar(s); (m.userData.echoRim?.value as THREE.Color | undefined)?.setHex(a.echo.color).multiplyScalar(ECHO_RIM * s); }
    }
    else for (const m of a.mats) m.emissive.setHex(a.glow);
    if (a.echoRing) { a.echoRing.rotation.y += dt * 0.35; a.echoRing.visible = !dead && !!a.echo; }
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
  /** The Echo band this actor is dressed as, or null for the authored enemy (echo-look.ts), and the band-coloured dashes on the ground it brings. */
  echo: EchoBand | null; echoRing?: THREE.Mesh;
  tele?: { root: THREE.Group; fill: THREE.Mesh; outline: THREE.Mesh };
  /** The mark a 'ground' cast lays under the player: made on first use, at the spot the sim fixed. */
  ground?: { root: THREE.Group; fill: THREE.Mesh; outline: THREE.Mesh; rock?: THREE.Mesh };
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

/** One upright click volume: a capsule standing on the ground at (x, z). */
type ChestState = 'closed' | 'open' | 'spent';
interface PickCandidate { id: number; x: number; z: number; height: number; radius: number }
interface NodeView { group: THREE.Group; type: string; crown?: THREE.Mesh; live?: THREE.Object3D; stump?: THREE.Object3D; mats: Mat[]; base: number[] }
interface DropView { group: THREE.Group; gem: THREE.Mesh }
