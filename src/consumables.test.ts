// HOM-48: fishing, cooking at a station, food and Well Fed, and what a death costs. Run with `npm run verify` (after the golden path).
import { createState, step, NO_INPUT, TICK_DT, Input, GameState } from './sim';
import { addItem, countItem } from './sim/inventory';
import { EQUIP_SLOTS, ITEMS, emptyEquipment } from './sim/items';
import { refreshGearStats } from './sim/inventory';
import { repairCost, wearWornGear } from './sim/durability';
import { grantXp } from './sim/skills';
import { NODE_TYPES } from './sim/gathering';
import { RECIPES, STATIONS, nearStation, recipeById, stationOf } from './sim/crafting';
import { FISH, cookedId, pieId } from './sim/fish';
import { FOOD_COOLDOWN, FOOD_TIME, BUFFS, bestFoodSlot } from './sim/consumables';
import { LANDMARKS, SALTMARROW, TOWNS, nearestTown } from './sim/world';
import { BARE_SWING, DEATH_WEAR, MAX_DURABILITY, REPAIR_FRAC, RESPAWN_DELAY } from './sim/data';
import { HARBOUR_STOCK, buyPrice } from './sim/shop';
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
const sawEvent = (s: GameState, t: string) => s.events.some(e => e.t === t);
/** Run until an event of this type shows up (and say whether it did). */
const until = (s: GameState, t: string, seconds: number) => { for (let n = 0; n < Math.round(seconds / TICK_DT); n++) { tick(s); if (sawEvent(s, t)) return true; } return false; };
const failOf = (s: GameState) => s.events.find(e => e.t === 'actionfail') as Extract<GameState['events'][number], { t: 'actionfail' }> | undefined;

/** A state with every enemy laid low for good, so nothing but the test is acting on the player. */
function quiet(seed: number): GameState {
  const s = createState(seed);
  for (const e of s.enemies) { e.state = 'dead'; e.hp = 0; e.respawnIn = 1e9; e.deadFor = 99; }
  return s;
}
const stand = (s: GameState, at: { x: number; z: number }, dx = 0, dz = 0) => { s.player.x = at.x + dx; s.player.z = at.z + dz; };
/** Read through functions so TS does not carry a narrowing across the sim calls in between. */
const kindOf = (s: GameState) => s.player.action?.k;
const buffCount = (s: GameState) => s.player.buffs.length;
const shoal = (s: GameState, type: string) => s.nodes.find(n => n.type === type)!;

// ---------------------------------------------------------------------------
section('HOM-48 the fish are data: one table feeds the nodes, the items and the recipes');
{
  assert(FISH.length === 6 && FISH.every(f => NODE_TYPES[f.id] && ITEMS[f.id] && ITEMS[cookedId(f)] && ITEMS[pieId(f)] && recipeById(cookedId(f)) && recipeById(pieId(f))),
    'six fish, each with a spot, a raw item, a dish, a pie and two recipes');
  assert(FISH.every(f => NODE_TYPES[f.id].level === f.level && NODE_TYPES[f.id].xp === f.xp && NODE_TYPES[f.id].time === 4 && NODE_TYPES[f.id].charges === 5 && NODE_TYPES[f.id].respawn === 20 && NODE_TYPES[f.id].skill === 'fishing'),
    "a spot is the bible's: 4 seconds a catch, 5 charges, back after 20, the fish's level and XP");
  assert(FISH.every(f => ITEMS[f.id].value === f.value && ITEMS[f.id].use === undefined && ITEMS[cookedId(f)].use?.heal === f.heal), 'raw fish are worth the bible\'s gold and cannot be eaten; a dish heals its share');
  assert(FISH.every(f => recipeById(cookedId(f))!.level === f.level && recipeById(pieId(f))!.level === f.level + 2 && recipeById(cookedId(f))!.xp === f.cookXp), 'cooking asks the fish\'s level, a pie two more');
  assert(RECIPES.filter(r => r.skill === 'cooking').every(r => stationOf(r) === 'range') && RECIPES.filter(r => r.skill === 'smithing').every(r => stationOf(r) === 'forge'), 'a recipe with no station is the forge\'s; cooking is the range\'s');
  assert(ITEMS[pieId(FISH[0])].use?.buff === 'well_fed' && !ITEMS[cookedId(FISH[0])].use?.buff && BUFFS.well_fed.maxHp === 0.1 && BUFFS.well_fed.duration === 1200, 'only a pie makes you Well Fed: +10% max health for 20 minutes');
  assert(HARBOUR_STOCK.includes('sea_salt') && RECIPES.some(r => r.inputs.some(i => i.id === 'sea_salt')) && buyPrice('sea_salt') > ITEMS.sea_salt.value, 'the chandler sells the pie\'s salt, dearer than he would buy it');
  const placed = new Set(createState(1).nodes.map(n => n.type));
  assert(['silverfin', 'brine_trout', 'saltpike'].every(t => placed.has(t)) && ['redgill', 'ghost_eel', 'stormtuna'].every(t => !placed.has(t)), 'the three fish whose water exists are placed; the other three wait for theirs');
  assert(createState(1).nodes.filter(n => NODE_TYPES[n.type].skill === 'fishing').every(n => n.x > SALTMARROW.x - 20), 'and all of them are at Saltmarrow');
}

// ---------------------------------------------------------------------------
section('HOM-48 fishing: click a shoal, stand, get fish');
{
  const s = quiet(4801);
  const n = shoal(s, 'silverfin');
  stand(s, n, 0, 2);
  tick(s, { interact: { k: 'node', id: n.id } });
  run(s, 30);
  assert(countItem(s.player.inventory, 'silverfin') >= 5, 'five casts later the bag holds the silverfin');
  assert(s.player.skills.fishing.xp >= 5 * NODE_TYPES.silverfin.xp && s.player.skills.fishing.level >= 2, 'each catch pays Fishing XP, enough for a level');
  assert(n.charges === 0 && n.respawnIn > 0, 'the shoal is spent after five catches');
  run(s, 21);
  assert(n.charges === NODE_TYPES.silverfin.charges, 'and refilled twenty seconds on');

  const lv = quiet(4802), t = shoal(lv, 'brine_trout');
  stand(lv, t, -2.5, 0);
  tick(lv, { interact: { k: 'node', id: t.id } });
  assert(failOf(lv)?.reason === 'level' && failOf(lv)?.need === 8, 'and it says what it needs');
  run(lv, 5);
  assert(countItem(lv.player.inventory, 'brine_trout') === 0 && lv.player.action === null, 'Brine Trout wants Fishing 8: nothing is caught below it');

  const full = quiet(4803), m = shoal(full, 'silverfin');
  stand(full, m, 0, 2);
  for (let i = 0; i < full.player.inventory.length; i++) full.player.inventory[i] = { id: 'logs', qty: 50 };
  tick(full, { interact: { k: 'node', id: m.id } });
  assert(failOf(full)?.reason === 'full' && full.player.action === null, 'a full bag stops the cast, as mining does');
  full.player.inventory[0] = null;
  tick(full, { interact: { k: 'node', id: m.id } });
  assert(kindOf(full) === 'gather', 'a free slot is all it needs: no tool');
}

// ---------------------------------------------------------------------------
section('HOM-48 cooking: a recipe names its station');
{
  const s = quiet(4811);
  addItem(s.player.inventory, 'silverfin', 3);
  stand(s, LANDMARKS.forge);
  tick(s, { craft: { recipe: cookedId(FISH[0]), count: 3 } });
  assert(failOf(s)?.reason === 'range' && failOf(s)?.station === 'cooking range' && s.player.action === null, 'at the forge you cannot cook: the range is where it is done');
  assert(!nearStation(s, 'range') && !nearStation(s, 'alembic') && nearStation(s, 'forge') && STATIONS.circle !== undefined && !nearStation(s, 'circle') && !nearStation(s, 'rack'), 'near a station means near that station: the rune circle (HOM-112) is built, in the Spire, and a forge in Hale is nowhere near it');
  stand(s, LANDMARKS.range, 2);
  tick(s, { craft: { recipe: cookedId(FISH[0]), count: 3 } });
  run(s, 12);
  assert(countItem(s.player.inventory, cookedId(FISH[0])) >= 3 && countItem(s.player.inventory, 'silverfin') === 0, 'at the range three silverfin become three dishes');
  assert(s.player.skills.cooking.xp >= 3 * FISH[0].cookXp, 'each dish pays Cooking XP');

  const lv = quiet(4812);
  addItem(lv.player.inventory, 'brine_trout', 1);
  stand(lv, LANDMARKS.range, 2);
  tick(lv, { craft: { recipe: cookedId(FISH[1]), count: 1 } });
  assert(failOf(lv)?.reason === 'level' && failOf(lv)?.skill === 'cooking', 'Cooking 8 for a trout');

  const pie = quiet(4813);
  grantXp(pie, 'cooking', 300, 0, 0); // level 3 or more
  addItem(pie.player.inventory, 'silverfin', 2);
  stand(pie, LANDMARKS.range, 2);
  tick(pie, { craft: { recipe: pieId(FISH[0]), count: 1 } });
  assert(failOf(pie)?.reason === 'materials', 'a pie wants its pinch of salt as well as two fish');
  addItem(pie.player.inventory, 'sea_salt', 1);
  tick(pie, { craft: { recipe: pieId(FISH[0]), count: 1 } });
  run(pie, 8);
  assert(countItem(pie.player.inventory, pieId(FISH[0])) === 1 && countItem(pie.player.inventory, 'sea_salt') === 0 && countItem(pie.player.inventory, 'silverfin') === 0, 'two fish and the salt make a pie');
}

// ---------------------------------------------------------------------------
section('HOM-48 food: a heal over time that a hit spoils, on one shared cooldown');
{
  const dish = cookedId(FISH[2]); // Saltpike: 25%
  const s = quiet(4821);
  addItem(s.player.inventory, dish, 3);
  s.player.hp = 20;
  const maxHp = s.player.maxHp, slot = s.player.inventory.findIndex(x => x?.id === dish);
  s.player.outOfCombat = 0; // a fight just ended: no resting regen muddies the numbers below
  tick(s, { inv: [{ k: 'use', slot }] });
  assert(countItem(s.player.inventory, dish) === 2 && s.player.food !== null && sawEvent(s, 'use'), 'eating takes one dish and starts the meal');
  assert(s.player.hp < 20 + 0.25 * maxHp / 2, 'it is a heal over time, not an instant one');
  run(s, FOOD_TIME / 2);
  assert(s.player.hp > 20 + 0.25 * maxHp * 0.4 && s.player.hp < 20 + 0.25 * maxHp * 0.6, 'half way through the five seconds, about half of it has landed');
  run(s, FOOD_TIME / 2 + 0.2);
  assert(Math.abs(s.player.hp - (20 + 0.25 * maxHp)) < 1.5 && s.player.food === null, 'the dish heals its share of max health in full');
  tick(s, { inv: [{ k: 'use', slot }] });
  assert(failOf(s)?.reason === 'cooldown' && countItem(s.player.inventory, dish) === 2, 'a second dish within twenty seconds is refused, and not eaten');
  run(s, FOOD_COOLDOWN);
  tick(s, { inv: [{ k: 'use', slot }] });
  assert(countItem(s.player.inventory, dish) === 1, 'twenty seconds after the first it can be eaten again');
  tick(s, { inv: [{ k: 'use', slot: 0 }, { k: 'use', slot: -3 }, { k: 'use', slot: 99 }, { k: 'use', slot: 1.5 }] });
  assert(countItem(s.player.inventory, dish) === 1, 'a bad slot (empty, off the bag, fractional) does nothing');

  // a hit breaks it, and the heal stops where it was
  const b = createState(4822);
  for (const e of b.enemies) if (e.type !== 'boar') { e.state = 'dead'; e.hp = 0; e.respawnIn = 1e9; e.deadFor = 99; }
  const boar = b.enemies.find(e => e.type === 'boar')!;
  b.player.x = boar.x - 1; b.player.z = boar.z; b.player.hp = 30;
  addItem(b.player.inventory, dish, 1);
  tick(b, { inv: [{ k: 'use', slot: b.player.inventory.findIndex(x => x?.id === dish) }] });
  assert(b.player.food !== null, 'in combat a plain dish may be eaten');
  let broke = false;
  for (let i = 0; i < 20 / TICK_DT && !broke; i++) { tick(b); broke = sawEvent(b, 'eatbreak'); }
  assert(broke && b.player.food === null, 'the boar\'s first bite spoils the meal');

  // the best food the bag has
  const bag = quiet(4823);
  addItem(bag.player.inventory, 'silverfin', 1);
  assert(bestFoodSlot(bag.player) === -1, 'raw fish is not food: nothing to eat');
  addItem(bag.player.inventory, cookedId(FISH[0]), 1);
  addItem(bag.player.inventory, cookedId(FISH[3]), 1);
  assert(bag.player.inventory[bestFoodSlot(bag.player)]?.id === cookedId(FISH[3]), 'F picks the biggest heal in the bag');
  addItem(bag.player.inventory, pieId(FISH[3]), 1);
  assert(bag.player.inventory[bestFoodSlot(bag.player)]?.id === pieId(FISH[3]), 'a pie before a plain dish of the same size');
  bag.player.inCombat = true;
  assert(bag.player.inventory[bestFoodSlot(bag.player)]?.id === cookedId(FISH[3]), 'but in a fight it picks what may be eaten there');
}

// ---------------------------------------------------------------------------
section('HOM-48 Well Fed: meals only, out of combat, +10% max health, lost on death');
{
  const pie = pieId(FISH[1]);
  const s = quiet(4831);
  addItem(s.player.inventory, pie, 3);
  const base = s.player.maxHp, slot = s.player.inventory.findIndex(x => x?.id === pie);
  s.player.inCombat = true; s.player.outOfCombat = 0;
  tick(s, { inv: [{ k: 'use', slot }] });
  assert(failOf(s)?.reason === 'combat' && countItem(s.player.inventory, pie) === 3 && s.player.buffs.length === 0, 'a pie is refused in combat and stays in the bag');
  run(s, 6);
  assert(!s.player.inCombat, 'a few quiet seconds and the fight is over');
  tick(s, { inv: [{ k: 'use', slot }] });
  assert(countItem(s.player.inventory, pie) === 2 && s.player.buffs.some(b => b.id === 'well_fed') && s.player.maxHp === Math.round(base * 1.1), 'out of combat the pie leaves you Well Fed: +10% max health');
  assert(s.player.hp >= base, 'the extra health arrives with the buff');
  run(s, FOOD_COOLDOWN + 1);
  const before = s.player.buffs[0].left;
  tick(s, { inv: [{ k: 'use', slot }] });
  assert(buffCount(s) === 1 && s.player.buffs[0].left > before, 'a second pie renews it rather than stacking');
  run(s, 1200 - 5);
  assert(buffCount(s) === 1, 'it lasts twenty minutes...');
  run(s, 10);
  assert(buffCount(s) === 0 && s.player.maxHp === base && s.player.hp <= s.player.maxHp, '...and then max health goes back');

  const saved = quiet(4832);
  addItem(saved.player.inventory, pie, 1);
  run(saved, 6);
  tick(saved, { inv: [{ k: 'use', slot: saved.player.inventory.findIndex(x => x?.id === pie) }] });
  run(saved, 100);
  const back = deserialize(serialize(saved))!;
  assert(back.player.buffs.length === 1 && Math.abs(back.player.buffs[0].left - saved.player.buffs[0].left) < 0.01 && back.player.maxHp === saved.player.maxHp, 'Well Fed survives a save and load, with its time left');
  const old = JSON.parse(serialize(quiet(4833)));
  delete old.player.buffs; delete old.player.xp.fishing; delete old.player.xp.cooking;
  const o = deserialize(JSON.stringify(old));
  assert(o !== null && o.player.buffs.length === 0 && o.player.skills.fishing.level === 1 && o.player.skills.cooking.xp === 0, 'a save from before the two skills still loads: level 1, nobody Well Fed');
  const bad = JSON.parse(serialize(saved)); bad.player.buffs = [{ id: 'immortal', left: 5 }];
  assert(deserialize(JSON.stringify(bad)) === null, 'a save naming a buff that does not exist is refused');
  bad.player.buffs = [{ id: 'well_fed', left: 99999 }];
  assert(deserialize(JSON.stringify(bad)) === null, 'and so is one with more time than the buff has');
}

// ---------------------------------------------------------------------------
section('HOM-58 death costs something: wake at a graveyard, run back, gear worn down, no buffs');
{
  assert(DEATH_WEAR === 25 && MAX_DURABILITY === 100 && REPAIR_FRAC === 0.25, 'the cost of dying is three constants: 25 points a death, of 100, mended at a quarter of the piece\'s value');
  const a = quiet(4841);
  a.player.equipment.weapon = 'warden_edge'; a.player.equipment.head = 'steel_helm'; a.player.equipment.chest = 'steel_chestplate'; a.player.equipment.legs = 'steel_greaves';
  refreshGearStats(a);
  const whole = { ...a.player.stats };
  assert(wearWornGear(a.player).length === 4 && EQUIP_SLOTS.filter(sl => a.player.equipment[sl]).every(sl => a.player.durability[a.player.equipment[sl]!] === 75), 'a death takes 25 points off every worn piece');
  a.player.durability.warden_edge = 0;
  refreshGearStats(a);
  assert(a.player.stats.weaponDamage === 0 && a.player.stats.armor === whole.armor && a.player.equipment.weapon === 'warden_edge', 'a broken piece stays on and gives nothing: not its damage, and not its swing speed');
  assert(a.player.stats.swingInterval === BARE_SWING, 'a broken weapon swings like bare hands');
  assert(wearWornGear(a.player).find(w => w.item === 'warden_edge')!.now === 0, 'durability never goes below zero');
  assert(repairCost(a.player, 'warden_edge') === 100 && repairCost(a.player, 'steel_helm') === Math.ceil(90 * 0.25 * 0.5), 'mending a broken Warden\'s Edge costs a quarter of its 400; half-worn steel helm half of that');
  a.player.x = LANDMARKS.vendor.x; a.player.z = LANDMARKS.vendor.z + 1; a.player.gold = 0;
  tick(a, { shop: [{ k: 'repair' }] });
  assert(failOf(a)?.reason === 'gold' && a.player.durability.warden_edge === 0, 'with no gold nothing is mended');
  a.player.gold = 105;
  tick(a, { shop: [{ k: 'repair' }] });
  assert(a.player.durability.warden_edge === undefined && a.player.gold === 5 && !!a.player.durability.steel_helm, 'with 105 gold the worn pieces are mended in order while the gold lasts: the blade, then the helm is too dear');
  a.player.gold = 1000;
  tick(a, { shop: [{ k: 'repair' }] });
  assert(Object.keys(a.player.durability).length === 0 && a.player.stats.weaponDamage === whole.weaponDamage && sawEvent(a, 'repair'), 'and the rest on a full purse: everything whole, stats back');
  addItem(a.player.inventory, 'iron_helm', 1); a.player.x = 0; a.player.z = -12; a.player.durability.iron_helm = 10;
  tick(a, { shop: [{ k: 'repair' }] });
  assert(failOf(a)?.reason === 'range' && a.player.durability.iron_helm === 10, 'a merchant has to be in reach');
  a.player.equipment = emptyEquipment();
  assert(wearWornGear(a.player).length === 0, 'and wearing nothing, nothing is worn');

  const at = (s: GameState, type: string) => {
    const e = s.enemies.find(x => x.type === type)!;
    e.state = 'idle'; e.hp = e.maxHp; e.respawnIn = 0; e.deadFor = 0;
    stand(s, e, -1); s.player.hp = 1;
    return e;
  };
  /** Die next to this kind of enemy, and say what the death event and the wake said. */
  const dieNear = (seed: number, type: string, setup: (s: GameState) => void) => {
    const s = quiet(seed);
    setup(s);
    at(s, type);
    let died: Extract<GameState['events'][number], { t: 'death' }> | undefined;
    for (let i = 0; i < 30 / TICK_DT && !died; i++) { tick(s); died = s.events.find(e => e.t === 'death') as typeof died; }
    return { s, died };
  };
  const dress = (s: GameState) => {
    s.player.equipment.weapon = 'warden_edge'; s.player.equipment.chest = 'steel_chestplate'; s.player.gold = 200;
    addItem(s.player.inventory, 'iron_ore', 7);
    s.found.push('saltmarrow'); // walked there already (HOM-49): a death wakes you in the nearest town whose flight master you have found
    s.player.buffs.push({ id: 'well_fed', left: 900 }); s.player.maxHp = Math.round(s.player.maxHp * 1.1); s.player.hp = s.player.maxHp;
  };

  const strand = dieNear(4842, 'shore_crab', dress);
  assert(strand.died !== undefined, 'a crab on the Strand can kill a player on one hit point');
  const { s } = strand;
  assert(strand.died!.wear.length === 2 && strand.died!.wear.every(w => w.was === 100 && w.now === 75) && s.player.durability.warden_edge === 75 && s.player.durability.steel_chestplate === 75, 'the event and the player both say the two worn pieces went from 100 to 75');
  assert(s.player.gold === 200, 'and no gold is taken: the toll is retired');
  assert(strand.died!.grave === 'Saltmarrow' && strand.died!.run > 30 && Math.abs(strand.died!.run - Math.hypot(s.player.x - TOWNS[1].grave.x, s.player.z - TOWNS[1].grave.z)) < 1e-6,'it names the graveyard and how far the run back is');
  assert(s.player.buffs.length === 0 && s.player.food === null && sawEvent(s, 'buff'), 'Well Fed is lost on death');
  assert(s.player.equipment.weapon === 'warden_edge' && s.player.equipment.chest === 'steel_chestplate' && countItem(s.player.inventory, 'iron_ore') === 7, 'and not one item');
  const fell = { x: s.player.x, z: s.player.z };
  run(s, RESPAWN_DELAY + 0.5);
  const wake = TOWNS.find(t => t.id === 'saltmarrow')!.grave;
  assert(!s.player.dead && Math.hypot(s.player.x - wake.x, s.player.z - wake.z) < 3, 'dying on the Strand, you wake at Saltmarrow\'s graveyard, not 900 units away');
  assert(Math.hypot(fell.x - wake.x, fell.z - wake.z) > 30 && Math.hypot(wake.x - TOWNS[1].wake.x, wake.z - TOWNS[1].wake.z) > 25, 'and not in the town square: the run back is a real walk');
  assert(s.player.hp === s.player.maxHp && s.player.maxHp === 100, 'healed, at the plain max health');

  const hale = dieNear(4843, 'boar', dress);
  run(hale.s, RESPAWN_DELAY + 0.5);
  assert(hale.died !== undefined && Math.hypot(hale.s.player.x - TOWNS[0].grave.x, hale.s.player.z - TOWNS[0].grave.z) < 3, 'dying in Hale wakes you at Hale\'s graveyard');
  assert(hale.died!.run > 15, `and the boar by the smithy is ${Math.round(hale.died!.run)} paces from it: a walk, not a step`);

  const broke = dieNear(4844, 'boar', s2 => { s2.player.equipment.weapon = 'warden_edge'; s2.player.gold = 3; });
  assert(broke.s.player.gold === 3 && broke.s.player.durability.warden_edge === 75, 'with three gold you keep three gold, and the blade is still worn down');

  const save = dieNear(4845, 'shore_crab', dress);
  const reload = deserialize(serialize(save.s))!;
  assert(Math.hypot(reload.player.x - wake.x, reload.player.z - wake.z) < 3 && reload.player.durability.warden_edge === 75, 'saving while dead stores the graveyard and the worn gear: reloading does not dodge either');
  const older = JSON.parse(serialize(save.s)); delete older.player.durability;
  const loaded = deserialize(JSON.stringify(older))!;
  assert(loaded !== null && Object.keys(loaded.player.durability).length === 0 && loaded.player.stats.weaponDamage === ITEMS.warden_edge.stats!.damage, 'a save from before durability loads with every piece whole');
  older.player.durability = { warden_edge: 0 };
  assert(deserialize(JSON.stringify(older))!.player.stats.weaponDamage === 0, 'a broken blade is still broken after a reload');
  older.player.durability = { warden_edge: 500 };
  assert(deserialize(JSON.stringify(older)) === null, 'a save with durability above the maximum is refused');
  older.player.durability = { not_an_item: 5 };
  assert(deserialize(JSON.stringify(older)) === null, 'and so is one naming a piece that does not exist');

  // the graveyards sit out past each town: the nearest is by distance from the graveyard (the middle of the road splits at its halfway)
  const mid = (TOWNS[0].grave.x + TOWNS[1].grave.x) / 2;
  assert(nearestTown(SALTMARROW.x - 60, SALTMARROW.z).id === 'saltmarrow' && nearestTown(10, 0).id === 'hale' && nearestTown(mid - 30, 8).id === 'hale' && nearestTown(mid + 30, 8).id === 'saltmarrow', 'the nearest graveyard is by distance: the middle of the road splits at its halfway');
  assert(nearestTown(SALTMARROW.x, SALTMARROW.z, ['hale']).id === 'hale' && nearestTown(0, 0, []).id === 'hale', 'only towns whose flight master is found count (W2.3), and with none found it is the nearest outright');
}

console.log(`\nAll ${checks} fishing, cooking and death checks passed.`);
