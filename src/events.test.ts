// HOM-67: the sim events the audio asks for: fishing and cooking begin / finish, a species on every enemy hit and kill. Run with `npm run verify`.
import { createState, step, NO_INPUT, TICK_DT, Input, GameState, GameEvent } from './sim';
import { addItem } from './sim/inventory';
import { cookedId, FISH } from './sim/fish';
import { LANDMARKS } from './sim/world';

let checks = 0;
function assert(cond: unknown, msg: string): asserts cond {
  checks++;
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
  console.log(`  ok  ${msg}`);
}
/** Every event of every tick for this many seconds (the sim clears its list each tick). */
function record(s: GameState, seconds: number, first: Partial<Input> = {}): GameEvent[] {
  const all: GameEvent[] = [];
  for (let n = 0; n < Math.round(seconds / TICK_DT); n++) { step(s, { ...NO_INPUT, ...(n === 0 ? first : {}) }); all.push(...s.events); }
  return all;
}
const quiet = (seed: number) => { const s = createState(seed); for (const e of s.enemies) { e.state = 'dead'; e.hp = 0; e.respawnIn = 1e9; e.deadFor = 99; } return s; };

console.log('\n# HOM-67 fishing: a begin, then a catch per fish');
{
  const s = quiet(6701), n = s.nodes.find(x => x.type === 'silverfin')!;
  s.player.x = n.x; s.player.z = n.z + 2;
  const ev = record(s, 10, { interact: { k: 'node', id: n.id } });
  const begin = ev.filter(e => e.t === 'begin'), fish = ev.filter(e => e.t === 'catch');
  assert(begin.length === 1 && begin[0].t === 'begin' && begin[0].skill === 'fishing' && begin[0].what === 'gather' && begin[0].id === 'silverfin', 'casting raises one begin for fishing, naming the shoal');
  assert(fish.length === 2 && fish.every(e => e.t === 'catch' && e.fish === 'silverfin' && e.node === n.id), 'each landed fish raises a catch');
}

console.log('\n# HOM-67 cooking: a begin, then crafted per dish');
{
  const s = quiet(6702);
  addItem(s.player.inventory, FISH[0].id, 2);
  s.player.x = LANDMARKS.range.x; s.player.z = LANDMARKS.range.z + 2;
  const ev = record(s, 12, { craft: { recipe: cookedId(FISH[0]), count: 2 } });
  assert(ev.filter(e => e.t === 'begin' && e.skill === 'cooking' && e.what === 'craft' && e.id === cookedId(FISH[0])).length === 1, 'starting a batch raises one begin for cooking');
  assert(ev.filter(e => e.t === 'crafted' && e.skill === 'cooking').length === 2, 'each dish finished raises crafted');
}

console.log('\n# HOM-67 enemies: a species on the hit and the kill');
{
  const s = createState(6703), e = s.enemies[0];
  s.player.x = e.x; s.player.z = e.z + 2; s.player.hp = s.player.maxHp = 99999;
  s.targetId = e.id; s.player.autoAttack = true; e.hp = Math.min(e.hp, 40); // it hits back (the player's side of the hit event) and goes down inside a few swings
  const ev = record(s, 30);
  const hits = ev.filter(x => x.t === 'hit'), kills = ev.filter(x => x.t === 'kill');
  assert(hits.length > 0 && hits.every(x => x.t === 'hit' && typeof x.species === 'string' && x.species.length > 0), 'every hit, the player\'s and the enemy\'s, names a species');
  assert(hits.some(x => x.t === 'hit' && x.species === e.type), 'and it is the enemy\'s type');
  assert(kills.length > 0 && kills.every(x => x.t === 'kill' && typeof x.species === 'string' && x.species.length > 0), 'the kill names one too');
}

console.log(`\nAll ${checks} event checks passed.`);
