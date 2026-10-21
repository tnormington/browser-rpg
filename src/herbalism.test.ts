// HOM-65: herbalism (gathering, no tool), alchemy (crafting at the alembic), and the vial. Run with `npm run verify`.
import { createState, step, NO_INPUT, TICK_DT, Input, GameState } from './sim';
import { addItem, countItem } from './sim/inventory';
import { ITEMS } from './sim/items';
import { grantXp, SKILL_IDS } from './sim/skills';
import { xpForLevel } from './sim/xp';
import { NODE_TYPES } from './sim/gathering';
import { RECIPES, STATIONS, nearStation, recipeById, stationOf } from './sim/crafting';
import { HERBS, VIAL } from './sim/herbs';
import { THORN_STOCK, THORN_VENDOR, HARBOUR_STOCK, SHOP_STOCK, VENDORS, buyPrice } from './sim/shop';
import { LANDMARKS, REGIONS, regionAt, regionById } from './sim/world';
import { deserialize, serialize } from './sim/save';

let checks = 0;
function assert(cond: unknown, msg: string): asserts cond {
  checks++;
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
  console.log(`  ok  ${msg}`);
}
const section = (n: string) => console.log(`\n# ${n}`);
const tick = (s: GameState, i: Partial<Input> = {}) => step(s, { ...NO_INPUT, ...i });
const run = (s: GameState, seconds: number, i: Partial<Input> = {}) => { for (let n = 0; n < Math.round(seconds / TICK_DT); n++) tick(s, i); };
const failOf = (s: GameState) => s.events.find(e => e.t === 'actionfail') as Extract<GameState['events'][number], { t: 'actionfail' }> | undefined;
const kindOf = (s: GameState) => s.player.action?.k;
function quiet(seed: number): GameState {
  const s = createState(seed);
  for (const e of s.enemies) { e.state = 'dead'; e.hp = 0; e.respawnIn = 1e9; e.deadFor = 99; }
  return s;
}
const stand = (s: GameState, at: { x: number; z: number }, dx = 0, dz = 0) => { s.player.x = at.x + dx; s.player.z = at.z + dz; };
const patch = (s: GameState, type: string) => s.nodes.find(n => n.type === type)!;
/** The XP cost of the level: what the bible's rates are fractions of. */
const cost = (level: number) => xpForLevel(level + 1) - xpForLevel(level);

section('HOM-65 the herbs are data: one table feeds the patches, the items and the recipes');
{
  assert(SKILL_IDS.includes('herbalism') && SKILL_IDS.includes('alchemy'), 'Herbalism and Alchemy are skills, on the shared XP curve');
  assert(HERBS.every(h => NODE_TYPES[h.id] && ITEMS[h.id] && ITEMS[h.potion.id] && recipeById(h.potion.id)), 'every herb has a patch, an item, a potion and a recipe');
  assert(HERBS.every(h => { const d = NODE_TYPES[h.id]; return d.skill === 'herbalism' && d.level === h.level && d.item === h.id && d.time >= 3 && d.time <= 5 && d.charges >= 3 && d.charges <= 5 && d.respawn >= 20 && d.respawn <= 45; }),
    'a patch is 3 to 5 seconds a gather, 3 to 5 charges and back in 20 to 45 seconds, like the nodes already there');
  assert(HERBS.every(h => h.xp === Math.round(0.12 * cost(h.level))), 'a gather pays 0.12 x the XP cost of the herb\'s level: HOM-56\'s rate, not the bible\'s 0.42');
  assert(HERBS.every(h => { const r = recipeById(h.potion.id)!; return r.skill === 'alchemy' && r.level === h.level && stationOf(r) === 'alembic' && r.xp === Math.round(0.25 * cost(h.level) / 5) * 5; }),
    'a potion asks the herb\'s level at the alembic, and pays 0.25 x the cost of the level, as a bar does');
  assert(HERBS.every(h => { const r = recipeById(h.potion.id)!; return r.inputs.length === 2 && r.inputs.some(i => i.id === h.id && i.qty === 1) && r.inputs.some(i => i.id === VIAL && i.qty === 1); }), 'one herb and one vial make a potion');
  assert(STATIONS.alembic?.at === LANDMARKS.alembic && RECIPES.filter(r => r.skill === 'alchemy').every(r => stationOf(r) === 'alembic'), 'the alembic is the station of every alchemy recipe, and stands where the prop does');
}

section('HOM-65 the no-arbitrage rule holds for potions');
{
  const inputs = new Set(RECIPES.flatMap(r => r.inputs.map(i => i.id)));
  assert(HERBS.every(h => ITEMS[h.potion.id].value <= ITEMS[h.id].value + buyPrice(VIAL)), 'a potion never sells for more than its herb plus the vial\'s gold');
  assert(HERBS.every(h => ITEMS[h.potion.id].value - ITEMS[h.id].value < buyPrice(VIAL)), 'so herb -> potion -> sold, with the vial bought, always loses gold');
  assert(buyPrice(VIAL) === 4 && ITEMS[VIAL].value === 1 && THORN_VENDOR && THORN_STOCK.includes(VIAL), 'a vial is worth 1 and costs 4, at Thornwick\'s provisioner');
  const stocked = VENDORS.flatMap(v => v.stock).filter(id => inputs.has(id));
  assert(stocked.every(id => id === VIAL || id === 'sea_salt') && !HERBS.some(h => VENDORS.some(v => v.stock.includes(h.id))), 'the only crafting inputs for sale are the pie\'s salt and the vial: never an herb');
  assert([...SHOP_STOCK, ...HARBOUR_STOCK, ...THORN_STOCK].every(id => RECIPES.every(r => r.output.id !== id)), 'and nothing for sale is something a recipe makes');
}

section('HOM-65 the patches are placed where the bible says');
{
  const s = createState(6501);
  const at = (type: string) => s.nodes.filter(n => n.type === type).map(n => regionAt(n.x, n.z)?.id);
  assert(at('fenbloom').length >= 20 && at('fenbloom').every(r => r === 'dunmere'), 'Fenbloom grows in the Dunmere Fens');
  assert(at('thornmint').length >= 4 && at('thornmint').every(r => r === 'thornwick'), 'Thornmint in the Thornwood');
  const garden = s.nodes.filter(n => n.type === 'marrowleaf');
  assert(garden.length >= 4 && garden.every(n => regionAt(n.x, n.z)?.id === 'thornwick' && Math.hypot(n.x - LANDMARKS.alembic.x, n.z - LANDMARKS.alembic.z) < 30), 'Marrowleaf is the garden by the alembic');
  assert(REGIONS.reduce((n, r) => n + (r.herbs?.length ?? 0), 0) === s.nodes.filter(n => NODE_TYPES[n.type].skill === 'herbalism').length, 'every herb patch that was drawn is now a node (the fens\', the Thornwood\'s, and (HOM-99) the Ghostcap of the Grotto and the Cairn Hold)');
}

section('HOM-65 herbalism: click a patch, stand, get herb');
{
  const s = quiet(6511);
  const n = patch(s, 'marrowleaf');
  stand(s, n, 0, 2);
  tick(s, { interact: { k: 'node', id: n.id } });
  run(s, 12);
  assert(countItem(s.player.inventory, 'marrowleaf') >= 3 && n.charges === 0 && n.respawnIn > 0, 'three gathers empty the patch into the bag');
  assert(s.player.skills.herbalism.xp >= 3 * NODE_TYPES.marrowleaf.xp, 'each gather pays Herbalism XP');
  run(s, NODE_TYPES.marrowleaf.respawn + 1);
  assert(n.charges === NODE_TYPES.marrowleaf.charges, 'and it grows back');

  const lv = quiet(6512), f = patch(lv, 'fenbloom');
  stand(lv, f, 0, 2);
  tick(lv, { interact: { k: 'node', id: f.id } });
  assert(failOf(lv)?.reason === 'level' && failOf(lv)?.need === 10 && lv.player.action === null, 'Fenbloom wants Herbalism 10, and says so');
  grantXp(lv, 'herbalism', xpForLevel(10), 0, 0);
  tick(lv, { interact: { k: 'node', id: f.id } });
  assert(kindOf(lv) === 'gather', 'at Herbalism 10 it can be picked: no tool');
}

section('HOM-65 alchemy: a recipe made at the alembic, not the forge');
{
  const s = quiet(6521);
  addItem(s.player.inventory, 'marrowleaf', 2); addItem(s.player.inventory, VIAL, 1);
  stand(s, LANDMARKS.forge);
  tick(s, { craft: { recipe: 'healing_draught', count: 1 } });
  assert(failOf(s)?.reason === 'range' && failOf(s)?.station === 'alembic' && s.player.action === null, 'at the forge you cannot brew: the alembic is where it is done');
  stand(s, LANDMARKS.alembic, 2);
  tick(s, { craft: { recipe: 'healing_draught', count: 2 } });
  run(s, 12);
  assert(countItem(s.player.inventory, 'healing_draught') === 1 && countItem(s.player.inventory, VIAL) === 0 && countItem(s.player.inventory, 'marrowleaf') === 1, 'a herb and a vial become one potion; with no second vial the batch stops');
  assert(s.player.skills.alchemy.xp === recipeById('healing_draught')!.xp, 'and the brew pays Alchemy XP');
  stand(s, LANDMARKS.alembic, 2);
  tick(s, { craft: { recipe: 'bronze_bar', count: 1 } });
  assert(failOf(s)?.reason === 'range' && failOf(s)?.station === 'forge', 'and a bar cannot be smelted at the alembic');

  const click = quiet(6523);
  stand(click, LANDMARKS.alembic, 12);
  tick(click, { interact: { k: 'alembic' } });
  assert(click.events.some(e => e.t === 'stuck') && !click.events.some(e => e.t === 'alembic'), 'HOM-139: clicking the alembic from 12u off says you cannot reach it, rather than walking you there');
  stand(click, LANDMARKS.alembic, 3);
  tick(click, { interact: { k: 'alembic' } });
  assert(click.events.some(e => e.t === 'alembic') && nearStation(click, 'alembic'), 'standing at it, the click opens its recipe list');

  const lv = quiet(6522);
  addItem(lv.player.inventory, 'fenbloom', 1); addItem(lv.player.inventory, VIAL, 1);
  stand(lv, LANDMARKS.alembic, 2);
  tick(lv, { craft: { recipe: 'draught_of_vigour', count: 1 } });
  assert(failOf(lv)?.reason === 'level' && failOf(lv)?.need === 10, 'a Draught of Vigour wants Alchemy 10');
}

section('HOM-65 old saves still load');
{
  const s = quiet(6531);
  grantXp(s, 'herbalism', 500, 0, 0); grantXp(s, 'alchemy', 300, 0, 0);
  const back = deserialize(serialize(s))!;
  assert(back.player.skills.herbalism.xp === 500 && back.player.skills.alchemy.xp === 300, 'the new skills survive a round trip');
  const old = JSON.parse(serialize(s));
  delete old.player.xp.herbalism; delete old.player.xp.alchemy;
  old.nodes = old.nodes.filter((n: { type: string }) => NODE_TYPES[n.type].skill !== 'herbalism'); // a save from before the patches were nodes
  const loaded = deserialize(JSON.stringify(old));
  assert(loaded !== null && loaded.player.skills.herbalism.xp === 0 && loaded.player.skills.alchemy.xp === 0 && loaded.player.skills.combat.level === s.player.skills.combat.level, 'a save from before them loads with both at 0');
  assert(loaded !== null && loaded.nodes.length === s.nodes.length && loaded.nodes.filter(n => NODE_TYPES[n.type].skill === 'herbalism').every(n => n.charges === NODE_TYPES[n.type].charges), 'and the patches stand full');
  const bad = JSON.parse(serialize(s)); bad.player.xp.herbalism = -5;
  assert(deserialize(JSON.stringify(bad)) === null, 'a negative XP is still refused');
}

console.log(`\nAll ${checks} herbalism and alchemy checks passed.`);
