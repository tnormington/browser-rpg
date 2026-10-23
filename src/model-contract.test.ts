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
import { SLOTS, SlotDef, SlotId } from './models';

const assert = (ok: boolean, msg: string) => { if (!ok) { console.error('FAIL', msg); process.exit(1); } };
const MODELS = join(dirname(fileURLToPath(import.meta.url)), '../assets/models');

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
 * The two materials models.ts manufactures at load rather than reading: `splitBones` peels the leg triangles off `Armor`
 * and the hands off `Skin` into meshes of their own, so a `splitLegs` slot names four materials but ships two. What the
 * file must carry is the parent each is cut from.
 */
const SPLIT_FROM: Record<string, string> = { ArmorLegs: 'Armor', Hands: 'Skin' };

// ---- every slot: the materials and clips its SLOTS entry names ---------------------------------------------------

for (const id of Object.keys(SLOTS) as SlotId[]) {
  const def: SlotDef = SLOTS[id], g = gltfOf(def.file), mats = materialsOf(g), clips = clipsOf(g);
  const wanted = new Set<string>(Object.keys(def.look.named ?? {}));
  if (def.surface && typeof def.surface === 'object') for (const name of Object.keys(def.surface)) if (name !== '*') wanted.add(name);
  for (const name of wanted) {
    const want = def.splitLegs ? SPLIT_FROM[name] ?? name : name;
    assert(mats.has(want), `${id}: ${def.file}.glb carries the material '${want}' that SLOTS.${id} dresses`);
  }
  const a = def.anim;
  if (a) for (const clip of [a.idle, a.move, a.hit, a.death, a.jump, ...(a.attack ?? []), ...(a.upper ?? [])])
    if (clip) assert(clips.has(clip), `${id}: ${def.file}.glb carries the clip '${clip}' that SLOTS.${id}.anim plays`);
}

// ---- the player's rig: the bones gear.ts and anim.ts reach for by name --------------------------------------------

/**
 * Joints, as `gear.ts` (`Head`, `Torso`, the hands the weapon and torch hang in, the shins and palms the greaves and
 * gloves are sized along), `anim.ts` (the spine, the limbs it aims, the legs it seats) and `models.ts` (`LEG_BONE` and
 * `HAND_BONE`, which both match members of this list) read them.
 */
const PLAYER_BONES = ['Abdomen', 'Torso', 'Head',
  'UpperArmL', 'UpperArmR', 'LowerArmL', 'LowerArmR', 'PalmL', 'PalmR', 'MiddleHandL', 'MiddleHandR',
  'UpperLegL', 'UpperLegR', 'LowerLegL', 'LowerLegR', 'FootL', 'FootR'];

/**
 * The tips: Blender leaf bones, written only when the exporter's *Add Leaf Bones* option is on, and plain nodes rather
 * than joints -- which is why `PlayerGear` keeps the `*_end` names as well as the skeleton's. Greaves (gear.ts), boot
 * shafts and glove fingertips are each sized from the span between a bone and its tip, and `anim.ts` carries the foot
 * to the shin's end from them. A rig exported without them collapses all three pieces to zero length and says nothing.
 */
const PLAYER_TIPS = ['LowerLegL_end', 'LowerLegR_end', 'FootL_end', 'FootR_end', 'FingersL_end', 'FingersR_end'];

const player = gltfOf(SLOTS.player.file), playerNodes = nodesOf(player);
for (const bone of PLAYER_BONES) assert(playerNodes.has(bone), `the player rig has the joint '${bone}'`);
for (const tip of PLAYER_TIPS) assert(playerNodes.has(tip), `the player rig kept the leaf bone '${tip}' (exported with Add Leaf Bones)`);

// ---- the mounts: mount.ts hangs every piece of tack off 'Torso' and the chanfron off 'Head', and asserts both -------

for (const id of ['horse', 'destrier'] as const) {
  const nodes = nodesOf(gltfOf(SLOTS[id].file));
  for (const bone of ['Torso', 'Head']) assert(nodes.has(bone), `the ${id} rig has the bone '${bone}' mount.ts hangs tack from`);
}

// ---- which of the player's clips write the spine ------------------------------------------------------------------

/**
 * `anim.ts` touches `Abdomen` two ways, and they want opposite things of the clips. `bend()` (the mounted lean, the
 * gather's stoop) sets it absolutely from the bind rotation, so it overrides whatever the clip wrote; `turn('Abdomen')`
 * (the swing's hip twist) multiplies onto it, so it is a clip's own track that stops it winding up over the frames of
 * a swing. Neither is a name, so nothing above would catch a change here -- but a replacement rig's clip set is exactly
 * what changes it. This is the shipped answer, measured off the file: a rig swap that moves a line here is not
 * necessarily wrong, it just has to be looked at against anim.ts's two uses rather than discovered in the game.
 */
const SPINE_TRACKS: Record<string, boolean> = { Idle: false, Run: true, Jump: true, swordAttackJump: true, Death: true, Run_swordAttack: true };

const nodeNames = (player.nodes ?? []).map(n => sanitize(n.name ?? ''));
for (const [clip, writes] of Object.entries(SPINE_TRACKS)) {
  const def = (player.animations ?? []).find(a => (a.name ?? '').split('|').pop() === clip)!;
  assert(!!def, `the player rig has the clip '${clip}'`);
  const spine = def.channels.some(c => c.target.node !== undefined && nodeNames[c.target.node] === 'Abdomen');
  assert(spine === writes, `the player's '${clip}' ${writes ? 'animates' : 'leaves'} the Abdomen (anim.ts bend/turn)`);
}

console.log('model contract ok');
