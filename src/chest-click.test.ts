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
console.log(`\n${checks} checks`);
