// Props for the Fens and the Thornwood, built from primitives in code (there is no pack for them): the alembic, the herb patch and the
// thornoak. Each is a few merged layers, ready for the renderer to dress a station or a gathering node with (render.ts `buildProp`).
// Rendering only. Units are world units, feet at y 0, centred on x = z = 0.
import * as THREE from 'three';
import { put, spike, lump, stick, hangers, BARK, THORN, MOSS, MUD } from './creatures';
import type { HaloSpot } from './halo';

/** A material class the renderer knows (render.ts MATERIALS): how a layer takes light. `glow` layers are self-lit. */
export interface PropLayer { name: string; color: number; cls: 'wood' | 'bark' | 'metal' | 'foliage' | 'glow' | 'stone' | 'hide' | 'rock'; parts: THREE.BufferGeometry[] }
/** `halos`: the glow a prop's own flames throw, in the prop's frame (halo.ts). Both placers emit them, so a lit prop glows wherever it is put. */
export interface Prop { layers: PropLayer[]; halos?: HaloSpot[] }

const BRASS = 0x8a6f3c, COPPER = 0x7a4f34, GLASS_LIQUID = 0x2fa89e, EMBER = 0xff8a30, TABLE = 0x3d3328, STONE = 0x4b525b;
const LEAF = 0x44624c, LEAF_DARK = 0x2b4136, LEAF_BLIGHT = 0x546238, OAK_BARK = 0x5a4b3c, OAK_LEAF = 0x3b5238, BUD = 0x36907f, BUD_THORN = 0x6a58a8;
const LEAF_DRY = 0x5a5c42, BUSH_STEM = 0x463a2d, TORCH_WOOD = 0x4a3b2e, TORCH_IRON = 0x3a3b40;

/**
 * The alembic: an alchemist's still on a stone-footed bench. A brass pot over a low fire, a swan neck bending over to a receiving flask,
 * two corked bottles of cold liquor and a ladle rack. The liquor is the arcane family (small, teal); the fire under the pot is the one
 * warm thing, kept to a few embers so it reads as lit without competing with the forge.
 */
function alembic(): Prop {
  const bench = [
    put(new THREE.BoxGeometry(2.4, 0.16, 1.1), 0, 0.92, 0),
    ...[[-1, -0.4], [1, -0.4], [-1, 0.4], [1, 0.4]].map(([x, z]) => put(new THREE.BoxGeometry(0.16, 0.92, 0.16), x, 0.46, z)),
    put(new THREE.BoxGeometry(2.2, 0.08, 0.9), 0, 0.3, 0), // the lower shelf
  ];
  const footing = [put(new THREE.CylinderGeometry(0.5, 0.58, 0.26, 7), -0.55, 1.1, 0.0)]; // the stone hearth the pot stands on
  const pot = [
    put(new THREE.SphereGeometry(0.46, 8, 6), -0.55, 1.62, 0, 0, 0, 0, 1, 1.05, 1), // the pot
    put(new THREE.CylinderGeometry(0.2, 0.34, 0.34, 7), -0.55, 2.12, 0), // its shoulder
    put(new THREE.CylinderGeometry(0.1, 0.2, 0.42, 6), -0.55, 2.44, 0), // the neck
    put(new THREE.ConeGeometry(0.17, 0.2, 6), -0.55, 2.76, 0), // the cap
    put(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 5).rotateZ(Math.PI / 2 - 0.35), 0.0, 2.72, 0), // the swan neck, angling down...
    put(new THREE.CylinderGeometry(0.06, 0.06, 0.55, 5), 0.5, 2.18, 0), // ...and dropping into the receiver
  ];
  const copper = [
    put(new THREE.SphereGeometry(0.34, 7, 5), 0.5, 1.38, 0, 0, 0, 0, 1, 1.2, 1), // the receiving flask
    put(new THREE.CylinderGeometry(0.1, 0.14, 0.3, 6), 0.5, 1.8, 0),
    ...[[-1.0, 0.3], [-0.95, -0.28]].map(([x, z]) => put(new THREE.CylinderGeometry(0.1, 0.18, 0.42, 6), x, 1.22, z)),
    put(new THREE.BoxGeometry(0.9, 0.05, 0.05), 0.15, 0.62, -0.45), // the ladle rack's rail
    ...[0.0, 0.3, 0.6].map(x => put(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 5), x - 0.1, 0.45, -0.45)),
  ];
  const liquor = [
    put(new THREE.SphereGeometry(0.2, 6, 4), 0.5, 1.28, 0, 0, 0, 0, 1, 1.2, 1),
    ...[[0.85, 0.2], [1.0, 0.0]].map(([x, z]) => put(new THREE.CylinderGeometry(0.1, 0.13, 0.34, 6), x, 1.17, z)),
  ];
  const embers = [put(new THREE.OctahedronGeometry(0.1), -0.7, 1.28, 0.2), put(new THREE.OctahedronGeometry(0.08), -0.45, 1.27, -0.25), put(new THREE.OctahedronGeometry(0.07), -0.55, 1.3, 0.1)];
  return { layers: [
    { name: 'bench', color: TABLE, cls: 'wood', parts: bench }, { name: 'hearth', color: STONE, cls: 'stone', parts: footing },
    { name: 'brass', color: BRASS, cls: 'metal', parts: pot }, { name: 'copper', color: COPPER, cls: 'metal', parts: copper },
    { name: 'liquor', color: GLASS_LIQUID, cls: 'glow', parts: liquor }, { name: 'embers', color: EMBER, cls: 'glow', parts: embers },
  ], halos: [{ id: 'ember', x: -0.57, y: 1.3, z: 0 }] };
}

/**
 * An herb patch: a low tuft of long blades with a few pale buds standing proud on thin stalks. The buds are the cue (small, cold, lit): they are
 * what a player sees across a field, and a depleted patch drops them (`buds` is its own layer). `kind` picks the family: fen herbs are reedy and
 * pale-blue, thorn herbs are shorter and broader with a lilac bud.
 */
function herbPatch(kind: 'fen' | 'thorn'): Prop {
  const fen = kind === 'fen', n = fen ? 11 : 9;
  const blades = Array.from({ length: n }, (_, i) => {
    const a = i * 2.4, r = 0.12 + (i % 3) * 0.12, len = (fen ? 0.85 : 0.6) - (i % 3) * 0.12;
    return spike(Math.sin(a) * r, 0, Math.cos(a) * r, len, fen ? 0.07 : 0.1, 0.25 + 0.15 * (i % 2), Math.sin(a) * 0.35);
  });
  const stalks = Array.from({ length: 4 }, (_, i) => stick(Math.sin(i * 1.7 + 0.5) * 0.28, 0, Math.cos(i * 1.7 + 0.5) * 0.28, 0.6 + (i % 2) * 0.18, 0.015, 0.1, Math.sin(i * 2.1) * 0.15));
  const buds = Array.from({ length: 4 }, (_, i) => put(new THREE.OctahedronGeometry(0.085 + (i % 2) * 0.02), Math.sin(i * 1.7 + 0.5) * 0.28 + Math.sin(i * 2.1) * 0.05, 0.66 + (i % 2) * 0.18, Math.cos(i * 1.7 + 0.5) * 0.28));
  return { layers: [
    { name: 'blades', color: fen ? LEAF : LEAF_BLIGHT, cls: 'foliage', parts: [...blades, lump(0, 0.04, 0, 0.3, 0.3)] },
    { name: 'stalks', color: LEAF_DARK, cls: 'foliage', parts: stalks },
    { name: 'buds', color: fen ? BUD : BUD_THORN, cls: 'glow', parts: buds },
  ] };
}

/**
 * A thornoak: nothing like Hale's pine. A broad, gnarled, leaning bole that forks low into three limbs, a flat spread of dark leaf-clumps
 * rather than tiers, hard thorns up the trunk and moss hanging from the limbs. Wider than it is tall, so a grove of them closes the sky.
 */
function thornoak(): Prop {
  const bole = [
    put(new THREE.CylinderGeometry(0.55, 0.85, 1.6, 6).translate(0, 0.8, 0), 0, 0, 0, 0, 0.5, 0.06),
    put(new THREE.CylinderGeometry(0.5, 0.55, 1.4, 6).translate(0, 0.7, 0), 0.05, 1.5, 0, 0, 0.9, -0.1),
  ];
  const limbs = [[-1.6, 0.9, 0], [1.4, 1.0, 0.7], [0.2, 1.1, -1.5], [-0.4, 0.6, 1.5]].flatMap(([x, y, z], i) => [
    stick(0.05, 2.5 + i * 0.12, 0, 1.9 + (i % 2) * 0.4, 0.3, -z * 0.28, -x * 0.32), // out from the fork
    stick(x * 1.2, 3.3 + i * 0.1, z * 1.1, 1.1, 0.16, -z * 0.15, -x * 0.2 + 0.3), // a second turn
  ]);
  const thorns = Array.from({ length: 9 }, (_, i) => spike(Math.sin(i * 2.4) * 0.62, 0.4 + i * 0.28, Math.cos(i * 2.4) * 0.62, 0.5, 0.07, 0, Math.sin(i * 2.4) * 1.0));
  const clumps = [[-1.9, 4.5, 0.2, 1.3], [1.7, 4.7, 0.8, 1.2], [0.2, 5.2, -1.6, 1.3], [-0.6, 4.3, 1.7, 1.1], [0.1, 5.5, 0.2, 1.5], [2.9, 4.1, -0.6, 0.9], [-3.0, 4.0, -0.4, 0.9]];
  return { layers: [
    { name: 'bark', color: OAK_BARK, cls: 'bark', parts: [...bole, ...limbs] },
    { name: 'thorns', color: THORN, cls: 'wood', parts: thorns },
    { name: 'leaves', color: OAK_LEAF, cls: 'foliage', parts: clumps.map(([x, y, z, r]) => lump(x, y, z, r, 0.55)) },
    { name: 'moss', color: MOSS, cls: 'foliage', parts: [...hangers(-1.9, 4.2, 0.2, 0.9, 6, 0.9), ...hangers(1.7, 4.4, 0.8, 0.8, 6, 0.8), lump(0.9, 1.0, 0.5, 0.3, 0.6)] },
    { name: 'roots', color: MUD, cls: 'rock', parts: [lump(0.8, 0.12, 0.3, 0.4, 0.4), lump(-0.7, 0.1, -0.5, 0.35, 0.4)] },
  ] };
}

/**
 * The tanning rack (Leatherworking, Highmoor): a timber frame with a raw hide stretched across it and laced to the posts, a fleshing beam leaning
 * against one side, a half-barrel of tanning liquor, and strips of cured leather hung over the top rail. No glow and no fire: it is the plainest
 * station in the game, and what marks it as a tannery from across a street is the pale stretched hide, the one big light shape in a brown-grey town.
 * Front faces +z. Standing on a station it is about 3 wide and 2.6 high.
 */
function tanningRack(): Prop {
  const posts = [-1.2, 1.2].map(x => put(new THREE.CylinderGeometry(0.09, 0.11, 2.6, 5).translate(0, 1.3, 0), x, 0, 0, 0, 0, x * 0.03));
  const rails = [0.35, 2.3].map(y => put(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 5).rotateZ(Math.PI / 2), 0, y, 0));
  const feet = [-1.2, 1.2].map(x => put(new THREE.BoxGeometry(0.16, 0.14, 1.0), x, 0.07, 0));
  const beam = [put(new THREE.CylinderGeometry(0.1, 0.12, 2.2, 5).translate(0, 1.1, 0), 1.55, 0, 0.7, -0.5, 0, 0.15), put(new THREE.BoxGeometry(0.34, 0.05, 0.1), 1.55, 1.02, 0.18)]; // the fleshing beam and its knife
  const tub = [put(new THREE.CylinderGeometry(0.55, 0.48, 0.7, 8).translate(0, 0.35, 0), -1.7, 0, 0.9), ...[0.15, 0.5].map(y => put(new THREE.CylinderGeometry(0.57 - y * 0.1, 0.57 - y * 0.1, 0.05, 8), -1.7, y, 0.9))];
  // stretched: a body with the four legs pulled out to the corners (what makes it a pelt and not a board) and a ragged tail
  const hide = [put(new THREE.BoxGeometry(1.7, 1.4, 0.05), 0, 1.33, 0.02), put(new THREE.ConeGeometry(0.25, 0.5, 4).rotateX(Math.PI), 0.4, 0.5, 0.02),
    ...[[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([sx, sy]) => put(new THREE.BoxGeometry(0.5, 0.45, 0.05), sx * 1.0, 1.33 + sy * 0.8, 0.02, 0, 0, sx * sy * 0.5))];
  const lacing = [-0.9, -0.3, 0.3, 0.9].flatMap(x => [put(new THREE.BoxGeometry(0.03, 0.22, 0.04), x, 2.24, 0.03), put(new THREE.BoxGeometry(0.03, 0.22, 0.04), x, 0.46, 0.03)]);
  const cured = [-0.8, -0.4, 0, 0.4, 0.8].map((x, i) => put(new THREE.BoxGeometry(0.2, 0.7 - (i % 2) * 0.18, 0.04).translate(0, -0.35, 0), x, 2.3, -0.12, 0, 0, (i - 2) * 0.03));
  return { layers: [
    { name: 'frame', color: TABLE, cls: 'wood', parts: [...posts, ...rails, ...feet, ...beam, ...tub] },
    { name: 'hide', color: 0xb4a48a, cls: 'hide', parts: hide },
    { name: 'lacing', color: 0x4a3a2c, cls: 'hide', parts: lacing },
    { name: 'cured', color: 0x5e4630, cls: 'hide', parts: cured },
    { name: 'liquor', color: 0x2a2018, cls: 'hide', parts: [put(new THREE.CylinderGeometry(0.46, 0.46, 0.03, 8), -1.7, 0.66, 0.9)] },
  ] };
}

/**
 * A bush: a mound of leaf clumps over a few woody stems, with twigs breaking the dome so it is not a ball. Waist-high at most,
 * like the Thornwood's brush, so an enemy is never hidden behind one. `green` is in leaf and `dry` is half bare, more twig than
 * leaf and paler: the same plant in country that cannot keep it.
 */
function bush(kind: 'green' | 'dry'): Prop {
  const dry = kind === 'dry', spread = dry ? 0.8 : 0.95, top = dry ? 0.95 : 1.05;
  const stems = Array.from({ length: 3 }, (_, i) => stick(Math.sin(i * 2.1) * 0.16, 0, Math.cos(i * 2.1) * 0.16, 0.5, 0.055, Math.cos(i * 2.1) * 0.2, Math.sin(i * 2.1) * 0.22));
  // twigs out of the mound's shoulders, longer and more of them on a dry one: what stops it reading as a ball of moss
  const twigs = Array.from({ length: dry ? 9 : 5 }, (_, i) => {
    const a = i * 1.4 + (dry ? 0.5 : 0);
    return stick(Math.cos(a) * spread * 0.5, 0.35, Math.sin(a) * spread * 0.5, (dry ? 0.75 : 0.5) + (i % 3) * 0.12, 0.035, Math.sin(a) * 0.9, Math.cos(a) * 0.9);
  });
  const clumps = [[0, 0.5, 0, 0.58], [-0.5, 0.42, 0.22, 0.4], [0.46, 0.4, -0.2, 0.42], [0.1, 0.44, -0.5, 0.36], [-0.14, 0.34, 0.5, 0.34], [0.05, 0.72, 0.06, 0.4]]
    .filter((_, i) => !dry || i % 2 === 0)   // a dry bush keeps every other clump: the gaps are the look
    .map(([x, y, z, r]) => lump(x * spread, y * top, z * spread, r * (dry ? 0.85 : 1), 0.7));
  return { layers: [
    { name: 'wood', color: BUSH_STEM, cls: 'bark', parts: [...stems, ...twigs] },
    { name: 'leaf', color: dry ? LEAF_DRY : LEAF, cls: 'foliage', parts: clumps },
  ] };
}

/**
 * A torch on a post: a stake with two iron bands, a cage of four struts over it and a pitch head burning in the cage. The one
 * warm thing where there is no lamp and no forge, so it is kept small and its flame sits under the bloom threshold like the
 * braziers'. Feet at y 0, the flame near y 2.3; the glow round the flame rides with the prop, and its pool of light on the
 * ground is the placer's to add (world-view.ts `torchPost`).
 */
function torch(): Prop {
  const post = [put(new THREE.CylinderGeometry(0.075, 0.1, 2.1, 6).translate(0, 1.05, 0), 0, 0, 0), put(new THREE.ConeGeometry(0.14, 0.26, 5).rotateX(Math.PI), 0, 0.08, 0)];
  const iron = [
    ...[0.75, 1.5].map(y => put(new THREE.CylinderGeometry(0.1, 0.1, 0.07, 6), 0, y, 0)),   // the bands down the stake
    put(new THREE.CylinderGeometry(0.21, 0.13, 0.1, 6), 0, 2.1, 0),   // the cage's rim
    ...Array.from({ length: 4 }, (_, i) => { const a = i * Math.PI / 2; return put(new THREE.BoxGeometry(0.04, 0.34, 0.04), Math.cos(a) * 0.17, 2.22, Math.sin(a) * 0.17, Math.sin(a) * 0.2, 0, -Math.cos(a) * 0.2); }),
  ];
  const pitch = [put(new THREE.CylinderGeometry(0.13, 0.09, 0.3, 6), 0, 2.2, 0)];
  const flame = [put(new THREE.OctahedronGeometry(0.17).scale(1, 1.9, 1), 0, 2.46, 0), put(new THREE.OctahedronGeometry(0.1).scale(1, 1.5, 1), 0.04, 2.72, -0.03)];
  return { layers: [
    { name: 'post', color: TORCH_WOOD, cls: 'wood', parts: post },
    { name: 'iron', color: TORCH_IRON, cls: 'metal', parts: iron },
    { name: 'pitch', color: 0x241c16, cls: 'wood', parts: pitch },
    { name: 'flame', color: EMBER, cls: 'glow', parts: flame },
  ], halos: [{ id: 'torch', x: 0, y: 2.52, z: 0 }] };
}

/**
 * A signpost at a fork (HOM-134): a squared post under a shingle cap, with three pointed boards on it — one straight ahead
 * for the track, one each way for the road. Nothing in the game carries letters, so what has to read at a distance is the
 * shape: three pale arms at three heights, and the only squared timber for a hundred paces. The arm for the track faces +z.
 */
function signpost(): Prop {
  const post = [
    put(new THREE.BoxGeometry(0.22, 3, 0.22).translate(0, 1.5, 0), 0, 0, 0),
    put(new THREE.BoxGeometry(0.46, 0.12, 0.46), 0, 3.05, 0),
    put(new THREE.ConeGeometry(0.36, 0.34, 4), 0, 3.26, 0),
    ...[-1, 1].map(s => put(new THREE.BoxGeometry(0.12, 0.9, 0.12).rotateX(s * 0.45), 0, 0.46, s * 0.26)), // the braces at the foot
  ];
  // each board stands off the post along its own heading, with a point on the far end
  const boards = ([[0, 2.55], [Math.PI / 2, 2.1], [-Math.PI / 2, 1.65]] as const).flatMap(([a, y]) => [
    put(new THREE.BoxGeometry(0.08, 0.3, 1.2), Math.sin(a) * 0.72, y, Math.cos(a) * 0.72, 0, a, 0),
    put(new THREE.ConeGeometry(0.17, 0.34, 3).rotateX(Math.PI / 2), Math.sin(a) * 1.44, y, Math.cos(a) * 1.44, 0, a, 0),
  ]);
  return { layers: [
    { name: 'post', color: TORCH_WOOD, cls: 'wood', parts: post },
    { name: 'boards', color: 0x9a8f78, cls: 'wood', parts: boards },
  ] };
}

/**
 * A wayshrine at the end of a fork's track: a stepped plinth, a standing slab with a niche cut in it, a votive lamp burning in
 * the niche and a few stones left by whoever passed. The one lit thing in open country away from a town, so the track is worth
 * following from the fork at dusk.
 */
function wayshrine(): Prop {
  const stone = [
    put(new THREE.CylinderGeometry(1.25, 1.4, 0.24, 8), 0, 0.12, 0),
    put(new THREE.CylinderGeometry(1, 1.1, 0.22, 8), 0, 0.34, 0),
    put(new THREE.BoxGeometry(1.3, 2.1, 0.45).rotateZ(0.03), 0, 1.5, -0.15),
    put(new THREE.BoxGeometry(1.6, 0.3, 0.7), 0, 2.62, -0.15),                            // the cap over the niche
    ...[-1, 1].map(s => put(new THREE.BoxGeometry(0.3, 1.1, 0.4), s * 0.5, 1.4, 0.12)),    // the jambs the niche is between
  ];
  const offerings = [[0.95, 0.55], [-1, 0.4], [0.5, 1.05]].map(([x, z], i) => put(new THREE.DodecahedronGeometry(0.26 - i * 0.04), x, 0.2, z));
  const lamp = [put(new THREE.OctahedronGeometry(0.19), 0, 1.5, 0.05), put(new THREE.OctahedronGeometry(0.11).scale(1, 1.5, 1), 0, 1.74, 0.05)];
  return { layers: [
    { name: 'stone', color: 0x6b6b66, cls: 'stone', parts: stone },
    { name: 'offerings', color: 0x4b525b, cls: 'rock', parts: offerings },
    { name: 'flame', color: EMBER, cls: 'glow', parts: lamp },
  ], halos: [{ id: 'ember', x: 0, y: 1.6, z: 0.05, scale: 1.4 }] };
}

/**
 * A traveller's fire at the end of a fork's track: a ring of stones round a burning pile of sticks, a pot on a tripod over it, and
 * a lean-to of poles and hide to sleep under. The warm counterpart of the wayshrine, for the stops that are a camp and not a holy
 * place. The lean-to is behind the fire (-z), so the prop is turned to face whoever comes up the track.
 */
function wayfire(): Prop {
  const ring = Array.from({ length: 9 }, (_, i) => { const a = i * Math.PI * 2 / 9; return put(new THREE.DodecahedronGeometry(0.3), Math.cos(a) * 0.85, 0.12, Math.sin(a) * 0.85, 0, a, 0, 1, 0.7, 1); });
  const sticks = Array.from({ length: 5 }, (_, i) => { const a = i * 1.3; return stick(Math.cos(a) * 0.2, 0.05, Math.sin(a) * 0.2, 0.8, 0.07, Math.sin(a) * 0.9, Math.cos(a) * 0.9); });
  const tripod = Array.from({ length: 3 }, (_, i) => { const a = i * 2.1; return stick(Math.cos(a) * 0.95, 0, Math.sin(a) * 0.95, 2.1, 0.05, Math.sin(a) * -0.45, Math.cos(a) * -0.45); });
  const pot = [put(new THREE.SphereGeometry(0.3, 7, 5).scale(1, 0.85, 1), 0, 1.15, 0), put(new THREE.CylinderGeometry(0.3, 0.26, 0.1, 7), 0, 1.38, 0)];
  const frame = [
    ...[-1, 1].map(s => put(new THREE.CylinderGeometry(0.07, 0.09, 1.9, 5).translate(0, 0.95, 0), s * 1.1, 0, -2.4)),
    put(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 5).rotateZ(Math.PI / 2), 0, 1.88, -2.4),
    ...[-1, 1].map(s => put(new THREE.CylinderGeometry(0.05, 0.05, 1.7, 4).rotateX(0.95), s * 1.05, 0.88, -3.1)),
  ];
  const hide = [put(new THREE.BoxGeometry(2.5, 0.06, 1.9).rotateX(-0.8), 0, 1.25, -3.05)];
  const flame = [put(new THREE.OctahedronGeometry(0.28).scale(1, 1.7, 1), 0, 0.55, 0), put(new THREE.OctahedronGeometry(0.16).scale(1, 1.4, 1), 0.08, 0.95, -0.05)];
  return { layers: [
    { name: 'ring', color: 0x4b525b, cls: 'rock', parts: ring },
    { name: 'wood', color: TORCH_WOOD, cls: 'wood', parts: [...sticks, ...tripod, ...frame] },
    { name: 'pot', color: TORCH_IRON, cls: 'metal', parts: pot },
    { name: 'hide', color: 0x6d5a44, cls: 'hide', parts: hide },
    { name: 'flame', color: EMBER, cls: 'glow', parts: flame },
  ], halos: [{ id: 'torch', x: 0, y: 0.7, z: 0, scale: 1.8 }] };
}

const IRON_DARK = 0x2e3036, CHEST_WOOD = 0x3a3027, CHEST_SPENT = 0x2a2520, TROVE = 0x6fb8d8, TROVE_GOLD = 0x8a7a50;

/**
 * A treasure chest (HOM-152), in the three states a player has to tell apart from across a clearing. Front (the hasp) faces +z, feet at y 0,
 * about 1.1 wide and 0.6 high closed. It is deliberately a dull, low, near-rock-coloured box: a hidden chest is found by its one cold
 * glint (the lock plate, plus a pinprick `trove` halo), which reads at the edge of sight as "something is there" and not as "a chest is there".
 *   closed: lid down, a single lit lock plate.            open: lid up, a cold glow and a heap of goods spilling out: the loud one, and only once opened.
 *   spent:  lid thrown flat back, the inside black, no light and no goods, wood greyed: from afar it is the one dark, open mouth in a clearing.
 */
function chest(state: 'closed' | 'open' | 'spent'): Prop {
  const spent = state === 'spent', up = state !== 'closed';
  const body = [
    put(new THREE.BoxGeometry(1.1, 0.42, 0.7), 0, 0.21, 0),
    ...[-0.36, 0.36].map(x => put(new THREE.BoxGeometry(0.1, 0.46, 0.76), x, 0.22, 0)), // the iron straps round the body
  ];
  // the lid is a half-round of faceted wood, hinged at the back edge: opening it swings it about (0, 0.42, -0.35)
  const lidAngle = state === 'closed' ? 0 : spent ? -2.3 : -1.75;
  const half = (len: number, r: number) => new THREE.CylinderGeometry(r, r, len, 6, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).scale(1, 0.75, 1);
  const hinge = (g: THREE.BufferGeometry) => put(g.translate(0, 0, 0.35), 0, 0.42, -0.35, lidAngle, 0, 0);
  const lid = [hinge(half(1.12, 0.36))];
  const straps = [-0.36, 0.36].map(x => hinge(half(0.1, 0.385).translate(x, 0, 0)));
  const layers: PropLayer[] = [
    { name: 'wood', color: spent ? CHEST_SPENT : CHEST_WOOD, cls: 'wood', parts: [body[0], ...lid] },
    { name: 'iron', color: IRON_DARK, cls: 'metal', parts: [...body.slice(1), ...straps, put(new THREE.BoxGeometry(0.2, 0.2, 0.06), 0, 0.4, 0.37)] },
  ];
  const halos: HaloSpot[] = [];
  if (up) layers.push({ name: 'inside', color: 0x0c0d10, cls: 'wood', parts: [put(new THREE.BoxGeometry(0.96, 0.04, 0.56), 0, 0.43, 0)] }); // the dark of the open mouth
  if (state === 'closed') {
    layers.push({ name: 'lock', color: TROVE, cls: 'glow', parts: [put(new THREE.OctahedronGeometry(0.05), 0, 0.4, 0.41)] });
    halos.push({ id: 'trove', x: 0, y: 0.42, z: 0.4, scale: 0.8 });
  } else if (state === 'open') {
    layers.push({ name: 'goods', color: TROVE_GOLD, cls: 'metal', parts: [lump(-0.2, 0.46, 0.05, 0.16, 0.6), lump(0.18, 0.47, -0.08, 0.14, 0.6), lump(0.02, 0.5, 0.1, 0.12, 0.7), put(new THREE.OctahedronGeometry(0.1), 0.34, 0.5, 0.1)] });
    layers.push({ name: 'gleam', color: TROVE, cls: 'glow', parts: [put(new THREE.OctahedronGeometry(0.09), 0, 0.58, 0), put(new THREE.OctahedronGeometry(0.06), -0.3, 0.52, -0.1)] });
    halos.push({ id: 'trove', x: 0, y: 0.6, z: 0, scale: 2.2 });
  }
  return { layers, halos };
}

/**
 * The look of a rock you can stand on (HOM-152): its top is a flat, pale, worn cap, drawn at the height the sim lets you land at. The cue is
 * the silhouette first (every unclimbable rock is a faceted dome with a point, this one is cut off flat: a table, not a lump), the tone
 * second (lichen-pale on the one surface you can reach, so it reads in dusk, rain and fog where a hue would not) and a few chipped, pale
 * foot-holds along the lip third. No glow and no halo: a quest marker asks to be seen, this only has to be noticed by someone who is looking.
 * Unit radius, its top face at y 0; the placer scales it to the obstacle's radius and lifts it to the top height.
 */
function ledge(): Prop {
  const slab = [put(new THREE.CylinderGeometry(1, 1.06, 0.2, 7).translate(0, -0.1, 0), 0, 0, 0)];
  const chips = Array.from({ length: 6 }, (_, i) => { const a = i * Math.PI * 2 / 6 + 0.3; return put(new THREE.BoxGeometry(0.26, 0.1, 0.18), Math.cos(a) * 0.93, 0.02, Math.sin(a) * 0.93, 0, -a, 0); });
  return { layers: [
    { name: 'cap', color: 0x8c9892, cls: 'stone', parts: slab },
    { name: 'chips', color: 0xa8b2ac, cls: 'stone', parts: chips },
  ] };
}

/**
 * A notice board (HOM-163): two posts, a weathered backboard under a little roof, and a few pale sheets pinned across it. Front faces +z, feet at y 0, about
 * 2 wide and 2.3 tall. Plain on purpose: the surface is the UI Designer's to dress, this is only something to walk up to and read.
 */
function board(): Prop {
  const frame = [
    ...[-0.95, 0.95].map(x => put(new THREE.BoxGeometry(0.14, 2.1, 0.14), x, 1.05, 0)),
    put(new THREE.BoxGeometry(1.9, 1.15, 0.08), 0, 1.35, 0.02), // the backboard
    put(new THREE.BoxGeometry(2.2, 0.1, 0.5), 0, 2.2, 0.08, 0.18, 0, 0), // the roof, tipped back
  ];
  const sheets = [[-0.6, 1.55, 0.04], [0.05, 1.4, -0.03], [0.62, 1.58, 0.05], [-0.35, 1.12, 0.02], [0.4, 1.1, -0.02]]
    .map(([x, y, a]) => put(new THREE.BoxGeometry(0.42, 0.52, 0.02), x, y, 0.08, 0, 0, a));
  return { layers: [
    { name: 'wood', color: CHEST_WOOD, cls: 'wood', parts: frame },
    { name: 'notices', color: 0xcfc3a3, cls: 'hide', parts: sheets },
  ] };
}

/** Prop id -> its build. A prop is built per use (cheap: a handful of merged layers) and the renderer shares nothing between uses. */
export const PROPS = {
  chest: () => chest('closed'), chestOpen: () => chest('open'), chestSpent: () => chest('spent'), ledge, board,
  alembic, herbPatchFen: () => herbPatch('fen'), herbPatchThorn: () => herbPatch('thorn'), thornoak, tanningRack,
  bush: () => bush('green'), bushDry: () => bush('dry'), torch, signpost, wayshrine, wayfire,
} satisfies Record<string, () => Prop>;
export type PropId = keyof typeof PROPS;
