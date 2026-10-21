// The contextual cursor holds together (HOM-142). Three things can quietly come apart here, and each one of them
// leaves the pointer lying about what a click would do rather than crashing, which is why they are checked:
//   - a pick kind with no cursor: TypeScript catches that one in CURSOR_FOR, so it is not checked again here;
//   - a cursor nothing can ever be hovered to show, which is art generated for nobody;
//   - a cursor whose PNG is missing or the wrong size. A cursor image over 128 pixels is ignored by Chromium
//     outright, and a hotspot outside its own image makes the whole `cursor` rule invalid, so the pointer silently
//     drops to the system arrow over the one thing the picture was drawn for;
//   - a cursor whose credit no longer matches the icon it is built from, which is a licence breach rather than
//     a bug, and the only one in the repo that nothing else would catch.
// Run with `npm run verify`.
import { readFileSync, existsSync } from 'node:fs';
import { CURSOR_FALLBACKS, CURSOR_FOR, CURSOR_FOR_NODE, CURSOR_HOTSPOTS, CURSOR_IDS, CURSOR_SIZE, cursorFor } from './cursor';
import { NODE_TYPES } from './sim/gathering';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  if (!cond) throw new Error(`FAIL: ${what}`);
  checks++;
};

// Nothing under the pointer is the plain arrow, and every pick kind names a cursor that exists.
ok(cursorFor(null) === 'point', 'an empty pick should wear the plain arrow');
for (const [kind, id] of Object.entries(CURSOR_FOR)) {
  ok((CURSOR_IDS as readonly string[]).includes(id), `pick kind ${kind} wants cursor ${id}, which is not in CURSOR_IDS`);
}

// A node's own tool (an axe over a tree, the pick over everything else). Keyed by a node type string, so a typo
// would not fail to compile — it would just leave a tree wearing the pickaxe, which is the bug this catches.
for (const [type, id] of Object.entries(CURSOR_FOR_NODE)) {
  ok(!!NODE_TYPES[type], `CURSOR_FOR_NODE names node type ${type}, which no node in sim/gathering.ts is`);
  ok((CURSOR_IDS as readonly string[]).includes(id), `node type ${type} wants cursor ${id}, which is not in CURSOR_IDS`);
}
ok(cursorFor({ k: 'node', id: 1 }, 'tree') === 'chop', 'a tree should put the axe in hand');
ok(cursorFor({ k: 'node', id: 1 }, 'copper') === CURSOR_FOR.node, 'a node with no tool of its own should keep the pick');
ok(cursorFor({ k: 'node', id: 1 }) === CURSOR_FOR.node, 'a node whose type could not be read should keep the pick');

// No orphans: every cursor but the arrow is what some pick turns into.
const wanted = new Set<string>([...Object.values(CURSOR_FOR), ...Object.values(CURSOR_FOR_NODE)]);
for (const id of CURSOR_IDS) {
  ok(id === 'point' || wanted.has(id), `cursor ${id} is drawn and loaded but no pick ever shows it`);
}

// Chromium ignores a cursor image over 128 pixels, and a hotspot has to land inside its own image.
ok(CURSOR_SIZE > 0 && CURSOR_SIZE <= 128, `CURSOR_SIZE ${CURSOR_SIZE} is outside what a browser will use as a cursor`);
for (const id of CURSOR_IDS) {
  const [hx, hy] = CURSOR_HOTSPOTS[id];
  ok(hx >= 0 && hx < CURSOR_SIZE && hy >= 0 && hy < CURSOR_SIZE, `cursor ${id} has its hotspot ${hx},${hy} outside its ${CURSOR_SIZE}px image`);
  ok(!!CURSOR_FALLBACKS[id], `cursor ${id} has no system cursor to fall back to`);
}

// The art itself, at the size the hotspots were measured in. The size is read out of the PNG header (IHDR's width
// and height are the two big-endian words at byte 16) rather than trusted, because gen-art.ts frames it and a
// reframe is where it would change.
for (const id of CURSOR_IDS) {
  const file = `assets/art/cursors/${id}.png`;
  ok(existsSync(file), `cursor ${id} has no art at ${file}`);
  const head = readFileSync(file).subarray(0, 24);
  const w = head.readUInt32BE(16), h = head.readUInt32BE(20);
  ok(w === CURSOR_SIZE && h === CURSOR_SIZE, `${file} is ${w}x${h}, not the ${CURSOR_SIZE}px square the hotspots are measured in`);
}

// The credit. The cursors are the one piece of art in the repo under a licence that requires one (CC BY, see
// assets/CREDITS.md), and a cursor swapped to a different icon without rerunning scripts/cursor-art.ts would
// leave the file crediting the icon it used to be. Checked here because nothing else would ever notice.
const licences = readFileSync('assets/art/cursors/LICENSES.md', 'utf8');
for (const id of CURSOR_IDS) {
  ok(licences.includes(`| ${id}.png |`), `cursor ${id} is not credited in assets/art/cursors/LICENSES.md`);
}

console.log(`All ${CURSOR_IDS.length} cursors map to a pick, have their art at ${CURSOR_SIZE}px and a hotspot inside it (${checks} checks).`);
