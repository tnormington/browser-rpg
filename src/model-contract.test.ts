// The names in assets/models/*.glb that the code reads out by hand, checked against the files as shipped.
//
// Why this exists: break one of these names and the model still loads. It just renders wrong, silently -- a material
// that keeps its stock colour, a clip that never plays, a sword parented to the origin, greaves of zero length. A
// round trip through Blender is exactly how a name breaks (the exporter appends `.001` on a datablock collision, drops
// leaf bones unless *Add Leaf Bones* is on, and derives clip names from actions), so this is the harness an asset
// swap is performed against: it turns a silent mis-render into a failed run.
//
// It reads the files' glTF JSON directly rather than through the loader: no canvas, no fetch, no GPU, so it belongs in
// `npm run verify` next to the sim tests. The required names come from SLOTS where SLOTS has them (materials, clips)
// and are listed here where the code hard-codes them (the player's and the mounts' bones).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { RIG_BONES } from './anim';
import { SLOTS, SlotDef, SlotId } from './models';

const assert = (ok: boolean, msg: string) => { if (!ok) { console.error('FAIL', msg); process.exit(1); } };
/** The shipped models, or a directory of candidates: `MODEL_DIR=... tsx src/model-contract.test.ts` checks an export before it lands. */
const MODELS = process.env.MODEL_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '../assets/models');

/** A glTF node's name as three sees it: the loader sanitises `[ ] . : /` away, so the file's `Foot.L` is the code's `FootL`. */
const sanitize = (name: string) => THREE.PropertyBinding.sanitizeNodeName(name);

interface Gltf {
  materials?: { name?: string }[];
  nodes?: { name?: string }[];
  animations?: { name?: string; channels: { target: { node?: number } }[] }[];
}

/** The JSON chunk of a .glb: a 12-byte header, then length/type-prefixed chunks, of which the first is the JSON. */
function gltfOf(file: string): Gltf {
  const buf = readFileSync(join(MODELS, `${file}.glb`));
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  assert(view.getUint32(0, true) === 0x46546c67, `${file}.glb is a glb (magic)`);
  for (let at = 12; at + 8 <= view.byteLength;) {
    const len = view.getUint32(at, true), type = view.getUint32(at + 4, true);
    if (type === 0x4e4f534a) return JSON.parse(new TextDecoder().decode(buf.subarray(at + 8, at + 8 + len)));
    at += 8 + len;
  }
  throw new Error(`${file}.glb has no JSON chunk`);
}

const materialsOf = (g: Gltf) => new Set((g.materials ?? []).map(m => m.name ?? ''));
const nodesOf = (g: Gltf) => new Set((g.nodes ?? []).map(n => sanitize(n.name ?? '')));
/** Clip names as models.ts keys them: "HumanArmature|Run" -> "Run". */
const clipsOf = (g: Gltf) => new Set((g.animations ?? []).map(a => (a.name ?? '').split('|').pop()!));

/**
 * The one material models.ts manufactures at load rather than reading: `splitBones` peels the hands off `Skin` into a
 * mesh of their own, so a `splitHands` slot names it but no file carries it. What the file must carry is `Skin`.
 */
const SPLIT_FROM: Record<string, string> = { Hands: 'Skin' };

// ---- every slot: the materials and clips its SLOTS entry names ---------------------------------------------------

for (const id of Object.keys(SLOTS) as SlotId[]) {
  const def: SlotDef = SLOTS[id], g = gltfOf(def.file), mats = materialsOf(g), clips = clipsOf(g);
  const wanted = new Set<string>(Object.keys(def.look.named ?? {}));
  if (def.surface && typeof def.surface === 'object') for (const name of Object.keys(def.surface)) if (name !== '*') wanted.add(name);
  for (const name of wanted) {
    const want = def.splitHands ? SPLIT_FROM[name] ?? name : name;
    assert(mats.has(want), `${id}: ${def.file}.glb carries the material '${want}' that SLOTS.${id} dresses`);
  }
  const a = def.anim;
  if (a) for (const clip of [a.idle, a.move, a.hit, a.death, a.jump, ...(a.attack ?? []), ...(a.upper ?? [])])
    if (clip) assert(clips.has(clip), `${id}: ${def.file}.glb carries the clip '${clip}' that SLOTS.${id}.anim plays`);
}

// ---- the player's rig: the bones gear.ts and anim.ts reach for by name --------------------------------------------

/**
 * Every joint the code reaches for -- `gear.ts` (the head and chest pieces hang there, the hands hold the weapon and
 * the torch, the shins, palms and feet are the spans greaves, gloves and boots are sized along), `anim.ts` (the spine,
 * the limbs it aims, the legs it seats) and `models.ts` (the wrists the hands are split at) -- resolved through the
 * slot's own rig map. The names in `RIG_BONES` are the logical ones; a pack that spells them differently carries a
 * `RigMap` in SLOTS, and this is where that table is checked against the file rather than against a reading of it.
 *
 * Six of them are tips rather than joints on the human rig (`*_end`), written only when the exporter's *Add Leaf
 * Bones* option is on. A rig exported without them collapses greaves, boot shafts and glove fingertips to zero length
 * and says nothing about it, which is the whole reason this file exists.
 */
const player = gltfOf(SLOTS.player.file), playerNodes = nodesOf(player);
const playerRig: Record<string, string> = SLOTS.player.rig ?? {};
for (const logical of RIG_BONES) {
  const bone = playerRig[logical] ?? logical;
  assert(playerNodes.has(bone), `the player rig has '${bone}', which the code reaches for as '${logical}'`);
}
for (const logical of Object.keys(playerRig))
  assert((RIG_BONES as readonly string[]).includes(logical), `SLOTS.player.rig maps '${logical}', which is not a name the code uses`);

// ---- the mounts: mount.ts hangs every piece of tack off 'Torso' and the chanfron off 'Head', and asserts both -------

for (const id of ['horse', 'destrier'] as const) {
  const nodes = nodesOf(gltfOf(SLOTS[id].file));
  for (const bone of ['Torso', 'Head']) assert(nodes.has(bone), `the ${id} rig has the bone '${bone}' mount.ts hangs tack from`);
}

// ---- which of the player's clips write the spine ------------------------------------------------------------------

/**
 * `anim.ts` touches the spine two ways and they want different things of the clips. `bend()` (the mounted lean, the
 * gather's stoop) sets it absolutely from the bind rotation, so it holds whatever the clip wrote and is safe either
 * way. `turn('Abdomen')` (the swing's hip twist) MULTIPLIES onto whatever is there this frame, so it is the clip's own
 * spine track that writes the wind-up away each frame; under a clip that leaves the spine alone it would accumulate
 * over the frames of a swing and the hips would keep turning. Nothing above would catch that -- it is not a name --
 * and a replacement clip set is exactly what changes it, so every clip the player can be playing while a swing runs
 * has to carry a spine track.
 */
const nodeNames = (player.nodes ?? []).map(n => sanitize(n.name ?? ''));
const spineBone = playerRig.Abdomen ?? 'Abdomen';
const anim = SLOTS.player.anim;
for (const clip of [anim.idle, anim.move, anim.death, anim.jump, ...anim.attack, ...anim.upper]) {
  const def = (player.animations ?? []).find(a => (a.name ?? '').split('|').pop() === clip);
  assert(!!def, `the player rig has the clip '${clip}'`);
  const spine = def!.channels.some(c => c.target.node !== undefined && nodeNames[c.target.node] === spineBone);
  assert(spine, `the player's '${clip}' animates '${spineBone}', so the swing's hip twist has something under it (anim.ts turn)`);
}

console.log('model contract ok');
