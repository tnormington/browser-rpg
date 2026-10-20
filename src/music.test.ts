// music.ts under tsx: which place plays what, and the scale the pad and the line are both drawn from. The Music class itself
// needs an AudioContext and is judged by ear; everything it reads is here.
import { REGIONS } from './sim/world';
import { THEMES, degree, themeFor, type Theme } from './music';

const assert = (ok: boolean, msg: string) => { if (!ok) { console.error('FAIL', msg); process.exit(1); } };

// every region plays something, and nowhere is silent
for (const r of REGIONS) assert(themeFor(r.id) !== null, `${r.id} has a theme`);
assert(themeFor(null) === null, 'and nowhere plays nothing');
assert(themeFor('nowhere-at-all') === null, 'as does a region that does not exist');

// a region with no theme of its own falls through to its zone's, and every cave room shares the one underground theme
const own = new Set(Object.keys(THEMES));
for (const r of REGIONS) {
  const id = themeFor(r.id)!;
  if (own.has(r.id)) assert(id === r.id, `${r.id} plays its own theme`);
  else if (r.cave || !own.has(r.zone)) assert(id === 'cave', `${r.id} is underground and plays the cave theme`);
  else assert(id === r.zone, `${r.id} falls through to ${r.zone}, got ${id}`);
}
assert(REGIONS.filter(r => r.cave).every(r => themeFor(r.id) === 'cave'), 'every cave room shares one theme');
// the Grotto Ghostcap is cave: false in a dungeon zone, so it falls through both and is underground anyway
assert(themeFor('grottoghost') === 'cave', 'the Grotto Ghostcap plays underground, not silence');

// the themes are told apart by key as well as by mode: no two places above ground sit on the same root in the same scale
const seen = new Set<string>();
for (const [id, t] of Object.entries(THEMES)) {
  const key = `${t.root}:${t.scale.join(',')}`;
  assert(!seen.has(key), `${id} is in a key of its own (${key})`);
  seen.add(key);
}

// every chord names degrees the scale actually has, so a theme can never ask for a note that is not in its mode
for (const [id, t] of Object.entries(THEMES)) {
  assert(t.chords.length >= 3, `${id} has a round of at least three chords`);
  for (const c of t.chords) for (const d of c) assert(Number.isInteger(d) && d >= 0 && d < t.scale.length, `${id}: degree ${d} is in the scale`);
  assert(t.scale[0] === 0 && t.scale.every((s, i) => i === 0 || s > t.scale[i - 1]), `${id}'s scale climbs from the root`);
}

// degree() climbs into higher octaves rather than wrapping back on itself: the line sits above the pad, and an octave up is twice the pitch
const t: Theme = THEMES.hale, n = t.scale.length;
for (let i = 0; i < n * 3; i++) assert(degree(t, i + 1) > degree(t, i), `degree ${i + 1} is above degree ${i}`);
for (const i of [0, 3, 5]) assert(Math.abs(degree(t, i + n) / degree(t, i) - 2) < 1e-9, `degree ${i} an octave up is twice the pitch`);
assert(Math.abs(degree(t, -n) * 2 - degree(t, 0)) < 1e-9, 'and an octave down is half of it: the drone is below the root');

// the lift puts the line clear of the pad's top note in every theme
for (const [id, th] of Object.entries(THEMES)) {
  const top = Math.max(...th.chords.flat());
  assert(degree(th, th.lift) > degree(th, top), `${id}'s line sits above its chords`);
}

// nothing is loud: the music sits under the ambience bed it plays beneath (the quietest bed in sfx.ts is 0.35)
for (const [id, th] of Object.entries(THEMES)) assert(th.vol > 0 && th.vol <= 0.5, `${id} is quiet (${th.vol})`);

console.log('music ok');
