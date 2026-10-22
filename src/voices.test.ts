// HOM-146: every enemy has a voice, and every voice is built from samples that are on disk. A species that falls through
// to the 'beast' default is the bug this catches: it is silent about it, and a golem yelps like a wolf. Run with `npm run verify`.
import { existsSync } from 'node:fs';
import { ENEMY_TYPES } from './sim/data';
import { VOICES, voiceOf, type Voice } from './voices';

let checks = 0;
function assert(cond: unknown, msg: string): asserts cond {
  checks++;
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
}

// Same resolution as voiceOf, but it says which step answered: a species no rig and no override names is the gap.
const RIGS = new Set(['boar', 'pup', 'wolf', 'brute', 'hexer']);
for (const [id, def] of Object.entries(ENEMY_TYPES)) {
  assert(RIGS.has(def.look?.model ?? id), `${id}: draws on a rig voices.ts knows (${def.look?.model ?? id}), so it is never the bare 'beast' fallback`);
}

const used = new Set<Voice>();
for (const [voice, sounds] of Object.entries(VOICES) as [Voice, typeof VOICES[Voice]][]) {
  for (const [what, layers] of Object.entries(sounds)) {
    assert(layers.length > 0, `${voice}.${what}: has at least one layer`);
    for (const l of layers) {
      assert(l.files.length > 0 && l.vol > 0, `${voice}.${what}: names a file and is audible`);
      for (const f of l.files) assert(existsSync(`assets/audio/${f}.ogg`), `${voice}.${what}: assets/audio/${f}.ogg is on disk`);
    }
  }
}
for (const id of Object.keys(ENEMY_TYPES)) used.add(voiceOf(id));
assert(used.size === Object.keys(VOICES).length, `every voice is spoken by someone (${[...used].join(', ')})`);

// the two things the table is for: a thing of stone does not cry out like meat, and a crab does not swing like a wolf
assert(voiceOf('rune_golem') === 'stone' && voiceOf('hollow_knight') === 'stone', 'the golem and the empty suit of plate are stone');
assert(voiceOf('shore_crab') === 'shell' && voiceOf('wolf') === 'beast' && voiceOf('ogre') === 'big' && voiceOf('archer') === 'man', 'crab, wolf, ogre and archer each have their own');
assert(voiceOf('cairn_king') !== voiceOf('archmage_vael'), 'two bosses on two rigs do not share one voice');

console.log(`All ${checks} voice checks passed: ${Object.keys(ENEMY_TYPES).length} enemies across ${used.size} voices.`);
