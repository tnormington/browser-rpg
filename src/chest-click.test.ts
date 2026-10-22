// HOM-153: the click on a chest (Interact 'chest') reaches openChest, and only from within reach. Run with `npm run verify`.
import { createState, step, NO_INPUT, TICK_DT, Input, GameState } from './sim';
import { CHESTS, CHEST_R, isOpened } from './sim/chests';
import { serialize, deserialize } from './sim/save';
import { CURSOR_FOR } from './cursor';

let checks = 0;
function assert(cond: unknown, msg: string): asserts cond {
  checks++;
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
  console.log(`  ok  ${msg}`);
}
const tick = (s: GameState, i: Partial<Input> = {}) => step(s, { ...NO_INPUT, ...i });
const c = CHESTS[0];

const far = createState(7);
for (const e of far.enemies) { e.state = 'dead'; e.hp = 0; e.respawnIn = 1e9; e.deadFor = 99; }
tick(far, { interact: { k: 'chest', id: c.id } });
assert(!isOpened(far.player, c.id) && far.events.some(e => e.t === 'stuck'), 'a click on a chest out of reach opens nothing and shrugs, like a node');

const s = createState(7);
for (const e of s.enemies) { e.state = 'dead'; e.hp = 0; e.respawnIn = 1e9; e.deadFor = 99; }
s.player.x = c.x + CHEST_R + 1; s.player.z = c.z;
tick(s, { interact: { k: 'chest', id: c.id } });
const ev = s.events.find(e => e.t === 'chest');
assert(isOpened(s.player, c.id) && ev && ev.t === 'chest' && ev.gold > 0, 'a click in reach opens the chest and pays its gold');
tick(s, { interact: { k: 'chest', id: c.id } });
assert(s.events.some(e => e.t === 'stuck') && s.player.chests.length === 1, 'a second click on an opened chest pays nothing');
const back = deserialize(serialize(s));
assert(back !== null && isOpened(back.player, c.id),'the opened chest survives a save');
assert(CURSOR_FOR.chest === 'gather', 'the pointer over a chest is the one for a thing you take from');

// HOM-164: the events the audio listens for
const fails = (st: GameState) => st.events.flatMap(e => e.t === 'chestfail' ? [e.why] : []);
assert(fails(far).join() === 'far', 'a refused open names why: out of reach is "far"');
assert(fails(s).join() === 'opened', 'a second open is refused as "opened"');

const n = createState(7);
for (const e of n.enemies) { e.state = 'dead'; e.hp = 0; e.respawnIn = 1e9; e.deadFor = 99; }
const near = (st: GameState) => st.events.filter(e => e.t === 'chestnear').length;
let raised = 0;
n.player.x = c.x + 10; n.player.z = c.z; tick(n); raised += near(n);
n.player.x = c.x + 3; tick(n); raised += near(n);
n.player.x = c.x + 3.5; tick(n); raised += near(n);
assert(raised === 1, 'walking up to a chest raises chestnear once, not every tick');
n.player.x = c.x + 10; tick(n);
n.player.x = c.x + 3; tick(n);
assert(near(n) === 1, 'walking away and back is a new approach');
n.player.x = c.x + CHEST_R + 1; tick(n, { interact: { k: 'chest', id: c.id } });
n.player.x = c.x + 10; tick(n); n.player.x = c.x + 3; tick(n);
assert(near(n) === 0, 'an opened chest is never near again');

const f = createState(7);
for (const e of f.enemies) { e.state = 'dead'; e.hp = 0; e.respawnIn = 1e9; e.deadFor = 99; }
f.player.x = 0; f.player.z = 0;
tick(f, { jump: true });
let land: Extract<GameState['events'][number], { t: 'land' }> | undefined;
for (let i = 0; i < 200 && !land; i++) { tick(f); land = f.events.find(e => e.t === 'land') as typeof land; }
assert(land && land.fall > 0.5 && land.fall < 2, `a hop lands with the height it fell: ${land?.fall.toFixed(2)}`);
assert(land && (land.on === 'grass' || land.on === 'cave'), 'a hop on the ground lands on turf');

console.log(`\n${checks} checks`);
