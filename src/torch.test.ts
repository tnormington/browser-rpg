// HOM-148: the torch. A seventh equipment slot — the off hand — and the one item made for it, whose stat is light rather than
// damage or armour. What the renderer does with it (a warm point light on the player, the lift on the cave, the halo in the
// fist) is rendering; what is checked here is everything the sim promises it: the slot, the stat, the shelf and the save.
// Run with `npm run verify`.
import { createState, step, NO_INPUT, Input, GameState } from './sim';
import { EQUIP_SLOTS, ITEMS, TORCH_REACH, deriveStats, describeStats, emptyEquipment } from './sim/items';
import { addItem, countItem } from './sim/inventory';
import { MAX_DURABILITY } from './sim/data';
import { wearWornGear } from './sim/durability';
import { deserialize, serialize } from './sim/save';
import { SHOP_STOCK, VENDORS, VENDOR, applyShopAction, buyPrice } from './sim/shop';
import { RECIPES } from './sim/crafting';

let checks = 0;
function assert(cond: unknown, msg: string): asserts cond {
  checks++;
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
  console.log(`  ok  ${msg}`);
}
const section = (n: string) => console.log(`\n# ${n}`);
const tick = (s: GameState, i: Partial<Input> = {}) => step(s, { ...NO_INPUT, ...i });

/** A new game with nothing alive, and `torch` in the first bag slot. */
function carrying(): GameState {
  const s = createState(1480);
  for (const e of s.enemies) { e.state = 'dead'; e.hp = 0; e.respawnIn = 1e9; e.deadFor = 99; }
  addItem(s.player.inventory, 'torch', 1);
  return s;
}

section('The off hand is a slot of its own');
{
  assert(EQUIP_SLOTS.includes('offhand') && emptyEquipment().offhand === null, 'offhand is an equipment slot, empty on a new character');
  assert(ITEMS.torch.slot === 'offhand' && !ITEMS.torch.req, 'the torch goes in it, at any combat level');
  const s = carrying();
  tick(s, { inv: [{ k: 'equip', slot: 0 }] });
  assert(s.player.equipment.offhand === 'torch' && s.player.inventory[0] === null, 'equipping it moves it out of the bag and into the off hand');
  assert(s.player.equipment.weapon === null, 'and it is not the weapon slot: a torch never costs you your blade');
  const blade = carrying();
  addItem(blade.player.inventory, 'iron_sword', 1);
  tick(blade, { inv: [{ k: 'equip', slot: 0 }] });
  tick(blade, { inv: [{ k: 'equip', slot: 1 }] });
  assert(blade.player.equipment.offhand === 'torch' && blade.player.equipment.weapon === 'iron_sword', 'a sword and a torch are worn at once');
  tick(s, { inv: [{ k: 'unequip', slot: 'offhand' }] });
  assert(s.player.equipment.offhand === null && countItem(s.player.inventory, 'torch') === 1, 'and it comes off again, back into the bag');
}

section('Light is the stat, and nothing else is');
{
  const lit = deriveStats({ ...emptyEquipment(), offhand: 'torch' });
  const dark = deriveStats(emptyEquipment());
  assert(dark.light === 0 && lit.light === TORCH_REACH && TORCH_REACH > 0, `nothing lit reaches 0; a torch reaches ${TORCH_REACH}`);
  assert(lit.weaponDamage === dark.weaponDamage && lit.armor === dark.armor && lit.swingInterval === dark.swingInterval, 'and it buys nothing in a fight: no damage, no armour, no swing speed');
  assert(describeStats(ITEMS.torch).some(l => l.includes('Lights')), 'the tooltip says what it does');
  const s = carrying();
  tick(s, { inv: [{ k: 'equip', slot: 0 }] });
  assert(s.player.stats.light === TORCH_REACH, 'and wearing one puts the reach on the derived stats the renderer reads');
  // a broken piece is worn and gives nothing (sim/durability.ts); a burnt-out torch is the same rule, so the dark comes back
  for (let n = 0; n < Math.ceil(MAX_DURABILITY); n++) wearWornGear(s.player);
  tick(s, { inv: [{ k: 'unequip', slot: 'offhand' }] });
  tick(s, { inv: [{ k: 'equip', slot: 0 }] });
  assert(s.player.durability.torch === 0 && Number(s.player.stats.light) === 0, 'a torch worn down to nothing is still carried and throws no light');
}

section('Where one comes from, and that it survives the night');
{
  assert(SHOP_STOCK.includes('torch') && VENDORS.filter(v => v.stock.length).every(v => v.stock.includes('torch')), 'every merchant in the game sells one');
  assert(RECIPES.every(r => r.output.id !== 'torch' && r.inputs.every(i => i.id !== 'torch')), 'and no recipe makes or eats one: the shelf stays safe from buy -> craft -> sell');
  assert(buyPrice('torch') > ITEMS.torch.value && buyPrice('torch') <= 40, `it is cheap: ${buyPrice('torch')} gold to buy, ${ITEMS.torch.value} to sell`);
  const s = createState(1481);
  s.player.x = VENDOR.x; s.player.z = VENDOR.z; s.player.gold = 100;
  applyShopAction(s, { k: 'buy', item: 'torch', qty: 1 });
  assert(countItem(s.player.inventory, 'torch') === 1, 'and a purchase goes through');
  s.player.equipment.offhand = 'torch';
  const back = deserialize(serialize(s))!;
  assert(back.player.equipment.offhand === 'torch' && back.player.stats.light === TORCH_REACH, 'a worn torch survives a save, light and all');
  const old = JSON.parse(serialize(createState(1))); delete old.player.equipment.offhand;
  assert(deserialize(JSON.stringify(old))!.player.equipment.offhand === null, 'and a save from before the slot loads with it empty');
  const bad = JSON.parse(serialize(s)); bad.player.equipment.weapon = 'torch';
  assert(deserialize(JSON.stringify(bad)) === null, 'a torch in the weapon slot refuses the save');
}

console.log(`\nAll ${checks} torch checks passed.`);
