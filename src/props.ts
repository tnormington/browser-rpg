// Props for the Fens and the Thornwood, built from primitives in code (there is no pack for them): the alembic, the herb patch and the
// thornoak. Each is a few merged layers, ready for the renderer to dress a station or a gathering node with (render.ts `buildProp`).
// Rendering only. Units are world units, feet at y 0, centred on x = z = 0.
import * as THREE from 'three';
import { put, spike, lump, stick, hangers, BARK, THORN, MOSS, MUD } from './creatures';

/** A material class the renderer knows (render.ts MATERIALS): how a layer takes light. `glow` layers are self-lit. */
export interface PropLayer { name: string; color: number; cls: 'wood' | 'metal' | 'foliage' | 'glow' | 'stone' | 'hide' | 'rock'; parts: THREE.BufferGeometry[] }
export interface Prop { layers: PropLayer[] }

const BRASS = 0x8a6f3c, COPPER = 0x7a4f34, GLASS_LIQUID = 0x2fa89e, EMBER = 0xff8a30, TABLE = 0x3d3328, STONE = 0x4b525b;
const LEAF = 0x44624c, LEAF_DARK = 0x2b4136, LEAF_BLIGHT = 0x546238, OAK_BARK = 0x5a4b3c, OAK_LEAF = 0x3b5238, BUD = 0x36907f, BUD_THORN = 0x6a58a8;

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
  ] };
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
    { name: 'bark', color: OAK_BARK, cls: 'wood', parts: [...bole, ...limbs] },
    { name: 'thorns', color: THORN, cls: 'wood', parts: thorns },
    { name: 'leaves', color: OAK_LEAF, cls: 'foliage', parts: clumps.map(([x, y, z, r]) => lump(x, y, z, r, 0.55)) },
    { name: 'moss', color: MOSS, cls: 'foliage', parts: [...hangers(-1.9, 4.2, 0.2, 0.9, 6, 0.9), ...hangers(1.7, 4.4, 0.8, 0.8, 6, 0.8), lump(0.9, 1.0, 0.5, 0.3, 0.6)] },
    { name: 'roots', color: MUD, cls: 'rock', parts: [lump(0.8, 0.12, 0.3, 0.4, 0.4), lump(-0.7, 0.1, -0.5, 0.35, 0.4)] },
  ] };
}

/** Prop id -> its build. A prop is built per use (cheap: a handful of merged layers) and the renderer shares nothing between uses. */
export const PROPS = {
  alembic, herbPatchFen: () => herbPatch('fen'), herbPatchThorn: () => herbPatch('thorn'), thornoak,
} satisfies Record<string, () => Prop>;
export type PropId = keyof typeof PROPS;
