// Silhouettes for the enemies that share a rig with another: a tint and a scale do not make a different creature at play distance, so each
// of these adds the shapes that do (antlers, thorns, a mantle of moss, a crown) and squashes the rig where its proportions are wrong.
// Rendering only. Everything is in the rig's own units (its fitted height: boar 1, wolf 1.25, brute 2.7, hexer 2.2; +z is forward) and is
// carried by the actor's group, so the look's scale applies to it as to the model.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** One merged draw of `parts`. A null colour is the rig's own (after its tint); `lit` parts are self-lit, for eyes, lanterns and spores. */
export interface Layer { color: number | null; parts: THREE.BufferGeometry[]; lit?: boolean }
export interface Silhouette {
  /** Multiplies the rig's scale: lower, wider, longer. The layers are drawn in the rig's unsquashed units and take it too (so an antler still stands on the head), unless squashRig says they were drawn in the final shape. */
  squash?: [number, number, number];
  squashRig?: boolean;
  /** Tips the rig forward about its feet, in radians: a hunch. */
  lean?: number;
  layers: Layer[];
  /** A cold light that floats over the right hand (the rig's `FistR` bone), as the Warden's gem does. */
  handLight?: { color: number; size: number };
}

// the creature palette: cold, drained, and dark enough that the rig's own tint still leads
export const BARK = 0x3a3027, THORN = 0x2a2520, HORN = 0x6e6552, BONE = 0xa59f8a, MOSS = 0x3d4d34, MUD = 0x2f3329, PALE = 0x8a9a86;
const EYE = 0xa8e8c8, WITCH = 0x6ad8ff, HEX = 0xb070ff, SPORE = 0x9ad8a8;

const flat = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g);
const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), S = new THREE.Vector3();
/** Place a geometry: position, then Euler turns (x, y, z) and a scale. Each part carries its own placement because the layer is merged. */
export function put(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  const out = flat(g);
  out.applyMatrix4(M.compose(V.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz)), S.set(sx, sy, sz)));
  return out;
}
/** A cone from its base: points up, `lean` tips it back (+) or forward (-), `splay` out to +x. */
export const spike = (x: number, y: number, z: number, len: number, r: number, lean = 0, splay = 0) =>
  put(new THREE.ConeGeometry(r, len, 4).translate(0, len / 2, 0), x, y, z, -lean, 0, -splay);
/** A rough lump: an icosahedron, faceted and squashed. */
export const lump = (x: number, y: number, z: number, r: number, sy = 0.8) => put(new THREE.IcosahedronGeometry(r, 0), x, y, z, 0, (x + z) * 3, 0, 1, sy, 1);
/** A tapering stick from its base, tilted: `tx` forward/back about x, `tz` out about z. */
export const stick = (x: number, y: number, z: number, len: number, r: number, tx = 0, tz = 0) =>
  put(new THREE.CylinderGeometry(r * 0.55, r, len, 4).translate(0, len / 2, 0), x, y, z, -tx, 0, tz);

/**
 * An antler: a main beam that sweeps up and back, and tines up off it. `side` is +1 / -1, `size` scales the lot.
 * Built from sticks parented by hand (each tine starts where its point on the beam is), so it needs no matrix stack.
 */
function antler(x: number, y: number, z: number, side: number, size: number, tines = 3): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [], r = 0.045 * size, beam = 0.9 * size, tilt = 0.45, splay = 0.55;
  const at = (t: number) => [x + side * Math.sin(splay) * beam * t, y + Math.cos(splay) * beam * t, z - Math.sin(tilt) * beam * t] as const;
  out.push(stick(x, y, z, beam, r, tilt, -side * splay * 0.9));
  for (let i = 1; i <= tines; i++) {
    const [px, py, pz] = at(i / (tines + 0.6));
    out.push(stick(px, py, pz, 0.38 * size * (1 - i * 0.12), r * 0.7, -0.5, side * 0.15));
  }
  return out;
}

/** A row of spikes down the back, shrinking toward the front: the Thornback's namesake. */
function spineRow(z0: number, z1: number, y: number, n: number, len: number, r: number, side = 0, lean = 0.5): THREE.BufferGeometry[] {
  return Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 0 : i / (n - 1), k = 1 - 0.35 * t;
    return spike(side, y - t * 0.05, z0 + (z1 - z0) * t, len * k, r * k, lean, side * 0.5);
  });
}

/** A mantle: a ring of lumps draped over shoulders and back, for the things that wear the bog. */
export const mantle = (y: number, rx: number, rz: number, n: number, r: number, backBias = 0.35): THREE.BufferGeometry[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2, wob = 0.8 + 0.4 * Math.abs(Math.sin(i * 2.3));
    return lump(Math.sin(a) * rx, y + Math.cos(i * 1.7) * 0.06, Math.cos(a) * rz - rz * backBias, r * wob);
  });

/** Dangling reeds / vines: thin hanging blades, for cloaks and manes. */
export const hangers = (cx: number, cy: number, cz: number, spread: number, n: number, len: number): THREE.BufferGeometry[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return put(new THREE.ConeGeometry(0.035, len * (0.7 + 0.3 * Math.abs(Math.sin(i * 1.9))), 3).translate(0, -len / 2, 0).rotateX(Math.PI), cx + Math.sin(a) * spread, cy, cz + Math.cos(a) * spread * 0.8, 0, 0, Math.sin(a) * 0.12);
  });

/** Eyes: two small lit points either side of the face. */
const eyes = (y: number, z: number, gap: number, r = 0.045): THREE.BufferGeometry[] => [1, -1].map(s => put(new THREE.OctahedronGeometry(r), s * gap, y, z));

/**
 * The shore crab's: a flat carapace with a toothed front rim, four bent legs a side, and two oversized claws held up and open (the one
 * thing everyone knows a crab by). The claw tips are bone-pale so the open jaws read against dark water and wet sand. The boar squashed
 * low and wide; the parts are drawn in the final shape.
 */
function crab(): Silhouette {
  const shell: THREE.BufferGeometry[] = [], tips: THREE.BufferGeometry[] = [], stalks: THREE.BufferGeometry[] = [];
  for (const side of [1, -1]) {
    // claw: an arm out and up from the shoulder, a heavy palm, and two jaws that open forward in a V
    shell.push(put(new THREE.BoxGeometry(0.2, 0.2, 0.7).translate(0, 0, 0.35), side * 0.85, 0.35, 0.3, -0.5, side * 0.5));
    shell.push(lump(side * 1.2, 0.85, 0.72, 0.36, 0.8));
    for (const j of [1, -1]) {
      const jaw = new THREE.ConeGeometry(0.2, 0.9, 4).rotateX(Math.PI / 2).translate(0, 0, 0.45);
      tips.push(put(jaw, side * 1.2 + j * 0.13, 0.85, 0.85, 0, side * 0.1 - j * side * 0.5));
    }
    // legs: thigh out and up, shin down to the ground
    for (const z of [-0.5, -0.17, 0.16, 0.5]) {
      shell.push(put(new THREE.BoxGeometry(0.5, 0.07, 0.07), side * 1.0, 0.42, z * 0.9, 0, 0, side * 0.5));
      shell.push(put(new THREE.BoxGeometry(0.07, 0.4, 0.07), side * 1.28, 0.22, z * 0.9 + 0.05, 0, 0, side * -0.25));
    }
    stalks.push(put(new THREE.SphereGeometry(0.08, 5, 4), side * 0.2, 0.98, 0.78));
    shell.push(put(new THREE.CylinderGeometry(0.03, 0.04, 0.4, 4), side * 0.2, 0.7, 0.78));
  }
  shell.push(put(new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.3, 0.1, 0, 0, 0, 1.05, 0.55, 0.9));
  for (const x of [-0.6, -0.3, 0, 0.3, 0.6]) tips.push(spike(x, 0.34, 0.88 - Math.abs(x) * 0.45, 0.24, 0.06, -0.8));
  const big = (ps: THREE.BufferGeometry[]) => ps.map(g => g.scale(1.3, 1.3, 1.3)); // the Strand's first enemy must read at play distance
  return { squash: [1.95, 0.78, 0.85], squashRig: true, layers: [{ color: null, parts: big(shell) }, { color: 0xe8dfc8, parts: big(tips) }, { color: 0x1a1210, parts: big(stalks) }] };
}

/** Fen Stalker: the wolf stretched long in the leg and dark with mud to the knee, a mane of reed blades from the skull to the tail, pale eyes. A thing that waits in the reeds. */
function fenStalker(): Silhouette {
  const mane = Array.from({ length: 10 }, (_, i) => stick(((i % 2) - 0.5) * 0.1, 0.78 - Math.abs(i - 4) * 0.01, 0.75 - i * 0.14, 0.95 - i * 0.04, 0.07, 0.6 + i * 0.05, (i % 2 ? 1 : -1) * 0.15));
  const tail = [0, 1, 2].map(i => stick((i - 1) * 0.07, 0.66, -0.78, 0.7, 0.06, 1.0 + i * 0.1, (i - 1) * 0.3));
  const socks = [[0.18, 0.44], [-0.18, 0.44], [0.18, -0.5], [-0.18, -0.5]].map(([x, z]) => put(new THREE.CylinderGeometry(0.1, 0.12, 0.5, 5), x, 0.27, z));
  return {
    squash: [0.82, 1.22, 1.12],
    layers: [{ color: MOSS, parts: [...mane, ...tail, ...hangers(0, 0.6, 0.1, 0.2, 7, 0.35)] }, { color: MUD, parts: socks }, { color: EYE, parts: eyes(0.95, 1.0, 0.09, 0.055), lit: true }],
  };
}
/** Blight Stag: the wolf stretched tall, a great pair of rotted antlers, and shelf fungus along the flank. */
function blightStag(): Silhouette {
  const horns = [1, -1].flatMap(s => antler(s * 0.13, 1.0, 0.82, s, 1.35, 4));
  const shelf = [[0.34, 0.82, -0.05], [0.3, 0.62, -0.3], [-0.33, 0.78, 0.15], [-0.3, 0.58, -0.4]].map(([x, y, z]) =>
    put(new THREE.CylinderGeometry(0.18, 0.16, 0.05, 6), x, y, z, 0, 0, Math.sign(x) * 0.6));
  return {
    squash: [0.85, 1.22, 1.0],
    layers: [{ color: BONE, parts: horns }, { color: PALE, parts: shelf }, { color: SPORE, parts: eyes(1.0, 1.0, 0.1), lit: true }],
  };
}

/** Thornback Boar: a row of long thorns down the back and tusks that curl up. `elder` doubles the thorns, adds a second row and a lichen back. */
function thornback(elder: boolean): Silhouette {
  const s = elder ? 1.3 : 1;
  const thorns = [...spineRow(-0.55, 0.45, 0.7, elder ? 8 : 6, 0.8 * s, 0.1 * s), ...(elder ? [...spineRow(-0.45, 0.3, 0.64, 5, 0.55, 0.08, 0.3), ...spineRow(-0.45, 0.3, 0.64, 5, 0.55, 0.08, -0.3)] : [])];
  const tusks = [1, -1].flatMap(side => [put(new THREE.ConeGeometry(0.06 * s, 0.5 * s, 4).translate(0, 0.25 * s, 0), side * 0.2, 0.28, 0.72, -0.9, 0, -side * 0.2),
    put(new THREE.ConeGeometry(0.04 * s, 0.25 * s, 4).translate(0, 0.12 * s, 0), side * 0.27, 0.5, 0.88, -0.1, 0, -side * 0.35)]);
  const layers: Layer[] = [{ color: HORN, parts: thorns }, { color: BONE, parts: tusks }];
  if (elder) layers.push({ color: MOSS, parts: [lump(0, 0.74, -0.2, 0.34, 0.45), lump(0.2, 0.7, 0.2, 0.22, 0.4), lump(-0.2, 0.7, 0.0, 0.25, 0.4), lump(0, 0.7, -0.5, 0.2, 0.45)] });
  return { squash: elder ? [1.0, 1.1, 1.05] : undefined, layers };
}

/** Where the chibi rigs carry things (fitted units, from bench/rigs.mjs): the brute's shoulders and the top of its head, the hexer's shoulders and the base of its hat. */
const BRUTE = { sh: 1.5, head: 2.15, belt: 0.8 }, HEXER = { sh: 1.05, hat: 1.35 };

/** Mire Troll: hunched, a mantle of mud and moss across the back and a hump between the shoulders, and weed trailing off the arms. */
function mireTroll(): Silhouette {
  return {
    squash: [1.22, 0.88, 1.1], lean: 0.22,
    layers: [{ color: MOSS, parts: [...mantle(BRUTE.sh - 0.05, 0.62, 0.5, 8, 0.26, 0.5), lump(0, BRUTE.sh + 0.2, -0.6, 0.4, 0.7), lump(0.5, BRUTE.sh + 0.05, -0.4, 0.28), lump(-0.5, BRUTE.sh + 0.05, -0.4, 0.28)] },
      { color: MUD, parts: hangers(0, BRUTE.sh - 0.1, -0.1, 0.6, 9, 0.9) }],
  };
}

/** The Bogfather: a crown of driftwood antlers, a mantle of weed with a drowned lantern at his belt, and reeds across the shoulders. */
function bogfather(): Silhouette {
  const crown = [1, -1].flatMap(s => antler(s * 0.2, BRUTE.head - 0.05, 0.02, s, 1.15, 3)).concat([spike(0, BRUTE.head, -0.05, 0.6, 0.07, 0.15)]);
  return {
    squash: [1.1, 1.0, 1.05], lean: 0.1,
    layers: [{ color: BARK, parts: crown }, { color: MOSS, parts: [...mantle(BRUTE.sh - 0.05, 0.66, 0.5, 8, 0.24, 0.5), lump(0, BRUTE.sh + 0.15, -0.55, 0.36, 0.7)] },
      { color: MUD, parts: hangers(0, BRUTE.sh - 0.2, 0, 0.68, 10, 0.9) }, { color: WITCH, parts: [put(new THREE.OctahedronGeometry(0.17), 0.6, BRUTE.belt, 0.25)], lit: true }],
  };
}

/** Mother Mire: low and very wide, she wades out of her own mud: a heaped mound at her feet, pustules across her back, a ring of sickly lights. */
function motherMire(): Silhouette {
  const at = [[0.5, 1.45, -0.3, 0.3], [-0.55, 1.4, -0.1, 0.34], [0.1, 1.75, -0.5, 0.4], [0.9, 1.1, 0.1, 0.26], [-0.95, 1.0, -0.2, 0.28], [0.3, 1.2, -0.7, 0.3], [-0.3, 1.6, 0.35, 0.2]];
  return {
    squash: [1.5, 0.85, 1.35], lean: 0.12,
    layers: [{ color: MUD, parts: [put(new THREE.ConeGeometry(1.7, 0.8, 7).translate(0, 0.4, 0), 0, 0, 0.1), lump(1.1, 0.3, 0.5, 0.5), lump(-1.2, 0.3, 0.2, 0.55), lump(0.2, 0.3, -1.3, 0.55)] },
      { color: MOSS, parts: at.map(([x, y, z, r]) => lump(x, y, z, r, 0.9)) },
      { color: SPORE, parts: at.slice(0, 5).map(([x, y, z, r]) => put(new THREE.OctahedronGeometry(r * 0.38), x, y + r * 0.8, z)), lit: true }],
  };
}

/** Thorn Warden: bark plate over the shoulders and chest, thorns up from each shoulder and the spine, and a crown of thorn. A knight grown from the wood. */
function thornWarden(): Silhouette {
  const sh = BRUTE.sh;
  const plates = [1, -1].flatMap(s => [put(new THREE.BoxGeometry(0.5, 0.16, 0.6), s * 0.62, sh + 0.08, 0, 0, 0, s * 0.3), put(new THREE.BoxGeometry(0.42, 0.14, 0.5), s * 0.78, sh - 0.1, 0, 0, 0, s * 0.55)]);
  const chest = put(new THREE.BoxGeometry(0.9, 0.8, 0.3), 0, 1.15, 0.3);
  const thorns = [...[1, -1].flatMap(s => [spike(s * 0.7, sh + 0.2, 0, 0.8, 0.1, 0, -s * 0.5), spike(s * 0.92, sh, 0.1, 0.5, 0.08, 0, -s * 0.9), spike(s * 0.5, sh + 0.2, -0.25, 0.55, 0.08, 0.4, -s * 0.2)]),
    ...[0, 1, 2, 3].map(i => spike(0, 1.0 + i * 0.22, -0.4 - i * 0.02, 0.7, 0.09, 0.7)),
    ...[0, 1, 2, 3, 4, 5].map(i => spike(Math.sin(i * 1.05) * 0.24, BRUTE.head - 0.05, Math.cos(i * 1.05) * 0.24, 0.5, 0.06))];
  return { squash: [1.05, 1.0, 1.0], layers: [{ color: BARK, parts: [...plates, chest] }, { color: THORN, parts: thorns }, { color: EYE, parts: eyes(1.9, 0.3, 0.1, 0.05), lit: true }] };
}

/** Bog Witch: a ragged shawl of moss over the shoulders, reeds hanging from the hat brim, a pale light over her hand. */
function bogWitch(): Silhouette {
  return {
    squash: [0.95, 0.92, 0.95], lean: 0.18,
    layers: [{ color: MOSS, parts: [...mantle(HEXER.sh + 0.05, 0.45, 0.35, 8, 0.22), put(new THREE.ConeGeometry(0.75, 1.0, 7, 1, true).translate(0, -0.5, 0), 0, HEXER.sh + 0.1, -0.12)] },
      { color: MUD, parts: hangers(0, HEXER.hat, 0.05, 0.3, 8, 0.7) }],
    handLight: { color: WITCH, size: 0.2 },
  };
}

/** Rotwood Cultist: the crimson robe with a halo of rotted branches grown from the shoulders and back, and a violet flame in the hand. */
function rotwoodCultist(): Silhouette {
  const sh = HEXER.sh;
  const bough = (s: number, y: number, ang: number) => [stick(s * 0.3, y, -0.15, 0.75, 0.055, 0.15, -s * ang), stick(s * (0.3 + Math.sin(ang) * 0.5), y + Math.cos(ang) * 0.5, -0.2, 0.4, 0.04, -0.2, s * 0.5)];
  const boughs = [1, -1].flatMap(s => [...bough(s, sh, 0.5), ...bough(s, sh - 0.15, 1.0), stick(s * 0.14, sh + 0.05, -0.3, 0.9, 0.055, 0.45, -s * 0.2)]);
  return { layers: [{ color: BARK, parts: boughs }, { color: MOSS, parts: [lump(0.35, sh + 0.05, -0.2, 0.15), lump(-0.35, sh + 0.05, -0.2, 0.15), lump(0, sh, -0.3, 0.18)] }], handLight: { color: HEX, size: 0.18 } };
}
/** Enemy type id -> its silhouette. A type not listed draws as its rig, tinted and scaled. */
export const SILHOUETTES: Record<string, () => Silhouette> = {
  shore_crab: crab,
  fen_stalker: fenStalker, blight_stag: blightStag,
  thornback: () => thornback(false), elder_thornback: () => thornback(true),
  mire_troll: mireTroll, bogfather, mother_mire: motherMire, thorn_warden: thornWarden,
  bog_witch: bogWitch, rotwood_cultist: rotwoodCultist,
};

/** Merge parts into one geometry: all non-indexed and stripped to the same attributes, so one draw whatever the mix of primitives. */
export function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  for (const g of parts) for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  return mergeGeometries(parts)!;
}