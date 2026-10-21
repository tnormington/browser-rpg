// HOM-114: the QA tools. What setting a level, a teleport and a grant do to the state, that they go through a normal
// sim step like any other action, and that every place the panel offers is somewhere you can actually stand.
// Run with `npm run verify`.
import { GameState, NO_INPUT, createState, step } from './sim';
import { AdminAction, BOSS_GROUP, MAX_GRANT, NAMED_RESPAWN, destinations, giveGold, giveItem, setCombatLevel, teleport } from './sim/admin';
import { MAX_GOLD } from './sim/shop';
import { MAX_LEVEL, xpForLevel } from './sim/xp';
import { ABILITIES, ENEMY_TYPES, SPAWNS } from './sim/data';
import { countItem } from './sim/inventory';
import { ITEMS } from './sim/items';
import { GATES, REGIONS, TOWNS, regionAt } from './sim/world';

let checks = 0;
function assert(cond: unknown, msg: string): asserts cond {
  checks++;
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
  console.log(`  ok  ${msg}`);
}
const section = (n: string) => console.log(`\n# ${n}`);

/** A world with nothing alive in it: the tools are what is under test, not what is chasing the player. */
function quiet(seed = 1140): GameState {
  const s = createState(seed);
  for (const e of s.enemies) { e.state = 'dead'; e.hp = 0; e.respawnIn = 1e9; e.deadFor = 99; }
  return s;
}
const run = (s: GameState, ...admin: AdminAction[]) => step(s, { ...NO_INPUT, admin });
const has = (s: GameState, t: string) => s.events.some(e => e.t === t);

section('Setting the combat level');
{
  const s = quiet(), p = s.player;
  const level = () => p.combat.level; // read through a call: an assert on one literal must not narrow the next
  const hp1 = p.maxHp;
  setCombatLevel(s, 30);
  assert(level() === 30 && p.combat.xp === xpForLevel(30), `level 30 with the XP level 30 costs: ${p.combat.xp}`);
  assert(p.maxHp > hp1 && p.hp === p.maxHp, `health follows the level and is topped up: ${hp1} -> ${p.maxHp}`);
  assert(p.energy === p.maxEnergy, 'and the energy bar is full');

  setCombatLevel(s, 4);
  assert(level() === 4 && p.combat.xp === xpForLevel(4), 'it winds back down as readily as it goes up');

  setCombatLevel(s, 0);
  assert(level() === 1, 'under 1 is level 1');
  setCombatLevel(s, 1e6);
  assert(level() === MAX_LEVEL, `over the top is ${MAX_LEVEL}`);
  setCombatLevel(s, Number.NaN);
  assert(level() === MAX_LEVEL, 'and a number that is not one leaves the level alone');
}
{
  const s = quiet(), p = s.player;
  run(s, { k: 'level', level: 24 });
  const unlocked = s.events.filter(e => e.t === 'unlock').length;
  // what climbing from `from` to `to` owes: a trainer's ability is announced by the sale and a capstone's by the talent point
  const owed = (from: number, to: number) => ABILITIES.filter(a => !a.trainer && !a.talent && a.unlockLevel > from && a.unlockLevel <= to).length;
  assert(p.combat.level === 24, 'the action reaches the sim through a plain step');
  assert(unlocked === owed(1, 24), `and every ability the level hands over is announced on that same tick: ${unlocked} of ${owed(1, 24)}`);
  run(s, { k: 'level', level: 2 });
  run(s, { k: 'level', level: 24 });
  assert(s.events.filter(e => e.t === 'unlock').length === owed(2, 24), 'going back down and up again hands them over a second time');
}

section('Teleporting');
{
  const s = quiet(), p = s.player;
  const salt = TOWNS.find(t => t.id === 'saltmarrow')!;
  s.targetId = 1;
  p.action = { k: 'gather', nodeId: 0, t: 0.5, duration: 3 };
  p.root = { left: 4, total: 6, name: 'Weighted Net' };
  p.y = 2; p.vy = 5;
  run(s, { k: 'teleport', x: salt.wake.x, z: salt.wake.z });
  assert(Math.hypot(p.x - salt.wake.x, p.z - salt.wake.z) < 1, `you are at Saltmarrow's waking spot: ${Math.round(p.x)}, ${Math.round(p.z)}`);
  assert(regionAt(p.x, p.z)?.id === 'saltmarrow', 'and standing on its floor');
  assert(s.targetId === null && !p.action && !p.root, 'the target, the gather and the net are all left behind');
  assert(p.y === 0 && p.vy === 0 && !p.airborne, 'and you arrive on the ground, not mid-jump');
}
{
  const s = quiet();
  teleport(s, 1e9, -1e9);
  assert(regionAt(s.player.x, s.player.z) !== null, `a point off the map lands on the nearest floor there is: ${Math.round(s.player.x)}, ${Math.round(s.player.z)}`);
  const before = { x: s.player.x, z: s.player.z };
  teleport(s, Number.NaN, 0);
  assert(s.player.x === before.x && s.player.z === before.z, 'and a coordinate that is not a number moves nobody');
}
{
  // the whole point of the tool: the late ground is reachable without the level its keeper asks for
  const s = quiet(), p = s.player;
  const hobb = GATES.find(g => g.id === 'barrowdowns')!;
  const downs = destinations().find(d => d.name === 'The Barrowdowns')!;
  run(s, { k: 'teleport', x: downs.x, z: downs.z });
  assert(p.combat.level < hobb.combat, `still level ${p.combat.level}, under the ${hobb.combat} ${hobb.keeper} asks for`);
  assert(regionAt(p.x, p.z)?.id === 'barrowdowns', 'and standing in the Barrowdowns all the same');
}
{
  const s = quiet(), p = s.player;
  p.dead = true; p.respawnIn = 5;
  run(s, { k: 'teleport', x: 10, z: 10 });
  assert(Math.hypot(p.x - 10, p.z - 10) < 1.5, 'a dead player can be moved too: being dead is a state to test out of');
}

section('Granting items');
{
  const s = quiet(), p = s.player;
  run(s, { k: 'give', id: 'stormiron_bar', qty: 3 });
  assert(countItem(p.inventory, 'stormiron_bar') === 3, 'three bars arrive in the bag');
  assert(s.events.some(e => e.t === 'loot' && e.item === 'stormiron_bar' && e.qty === 3), 'and they are reported as loot, so the log and the floater say so');

  giveItem(s, 'coal', 5000);
  assert(countItem(p.inventory, 'coal') === MAX_GRANT, `one grant stops at ${MAX_GRANT}: ${countItem(p.inventory, 'coal')} coal`);
  giveItem(s, 'coal', 0);
  assert(countItem(p.inventory, 'coal') === MAX_GRANT + 1, 'nothing asks for fewer than one');

  const bag = JSON.stringify(p.inventory);
  giveItem(s, 'not_an_item', 1);
  giveItem(s, 'coal', Number.NaN);
  assert(JSON.stringify(p.inventory) === bag, 'an unknown item, or a quantity that is not a number, changes nothing');
}
{
  const s = quiet(), p = s.player;
  p.inventory.fill(null);
  for (let i = 0; i < p.inventory.length; i++) p.inventory[i] = { id: 'iron_sword', qty: 1 };
  run(s, { k: 'give', id: 'iron_sword', qty: 1 });
  assert(has(s, 'invfull') && !has(s, 'loot'), 'a full bag takes none of it and says so');
}

section('Granting gold');
{
  const s = quiet(), purse = () => s.player.gold; // read through a call: an assert on the number narrows the next one to a literal
  run(s, { k: 'gold', amount: 500 });
  assert(purse() === 500, 'five hundred gold arrives: a trainer\'s price is a button now, not an afternoon');
  run(s, { k: 'gold', amount: 250 });
  assert(purse() === 750, 'and it adds to what was already in the purse');
  run(s, { k: 'gold', amount: MAX_GOLD * 2 });
  assert(purse() === MAX_GOLD, `the purse still stops where it always did (${MAX_GOLD})`);
  giveGold(s, Number.NaN);
  assert(purse() === MAX_GOLD, 'an amount that is not a number changes nothing');
}

section('Everywhere the panel can send you');
{
  const list = destinations();
  const towns = list.filter(d => d.group === 'Towns'), regions = list.filter(d => d.group !== 'Towns' && d.group !== BOSS_GROUP);
  assert(towns.length === TOWNS.length && regions.length === REGIONS.length, `every town and every region is offered: ${towns.length} + ${regions.length}`);
  const off = list.filter(d => !regionAt(d.x, d.z));
  assert(off.length === 0, `and every one of the ${list.length} is on walkable floor${off.length ? `: ${off.map(d => d.name).join(', ')}` : ''}`);
  const s = quiet();
  const stuck = list.filter(d => {
    teleport(s, d.x, d.z);
    return Math.hypot(s.player.x - d.x, s.player.z - d.z) > 4; // pushed out of a prop is fine; shoved across the map is not
  });
  assert(stuck.length === 0, `and the player lands at each of them${stuck.length ? `, except ${stuck.map(d => d.name).join(', ')}` : ''}`);
}
{
  // HOM-115: the list says what is where, so a boss is found without knowing the map by heart
  const list = destinations();
  // every enemy on a 10-minute respawn or longer: the three dungeon bosses and the rares out of doors
  const bosses = [...new Set(SPAWNS.map(sp => sp.type).filter(t => ENEMY_TYPES[t].respawn >= 600))].map(t => ENEMY_TYPES[t].name);
  const missing = bosses.filter(name => !list.some(d => d.detail.includes(name)));
  assert(missing.length === 0, `all ${bosses.length} bosses and rares are named against the place they stand${missing.length ? `, bar ${missing.join(', ')}` : ''}`);

  const king = list.find(d => d.detail.includes('The Cairn King'))!;
  assert(king.name === "The King's Chamber" && king.detail === 'lv 32  -  The Cairn King', `the King's room reads "${king.name}  -  ${king.detail}"`);
  assert(king.group.startsWith('The Cairn Hold') && king.group.includes('Highmoor') && king.group.includes('lv 30-32'),
    `and sits under its dungeon's heading: "${king.group}"`);
  assert(list.every(d => d.detail.length > 0), 'and every place says something: the empty ones say so');
  const throat = list.find(d => d.name === 'The Throat')!;
  assert(throat.detail === 'no enemies', `a corridor with nothing in it says "${throat.detail}"`);
}
{
  // HOM-115: and the fight itself is a jump, not a hunt across the region it is somewhere in
  const posts = destinations().filter(d => d.group === BOSS_GROUP);
  const named = SPAWNS.filter(sp => ENEMY_TYPES[sp.type].respawn >= NAMED_RESPAWN);
  assert(posts.length > 0 && posts.every(p => named.some(sp => ENEMY_TYPES[sp.type].name === p.name && sp.x === p.x && sp.z === p.z)),
    `all ${posts.length} boss posts stand on the spawn they name`);
  assert(posts.every(p => p.detail.includes(regionAt(p.x, p.z)!.name)), 'and each says the region it is in');
  assert(posts.every((p, i) => i === 0 || Number(posts[i - 1].detail.match(/lv (\d+)/)![1]) <= Number(p.detail.match(/lv (\d+)/)![1])),
    'the list runs weakest first, so it reads as the order you would meet them');

  const s = quiet();
  const king = posts.find(p => p.name === 'The Cairn King')!;
  teleport(s, king.x, king.z);
  assert(regionAt(s.player.x, s.player.z)?.id === 'chamber', "jumping to the King puts you in the King's Chamber, on his mark");
  const grey = posts.find(p => p.name === 'Old Grey')!;
  const road = destinations().find(d => d.name === 'Greywater Road')!;
  assert(Math.hypot(grey.x - road.x, grey.z - road.z) > 50, `the rare's post is ${Math.round(Math.hypot(grey.x - road.x, grey.z - road.z))} units off the middle of its road: the walk the list used to cost you`);
}

console.log(`\nAll ${checks} admin-tool checks passed.`);
