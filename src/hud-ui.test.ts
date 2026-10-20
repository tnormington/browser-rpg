// HOM-60: what the inventory panel's Sort button does, and what the unit frames read for buffs and debuffs.
// HOM-104: what a saved action bar layout is worth once the bar has grown.
// Run with `npm run verify`.
import { createState, GameState } from './sim';
import { INVENTORY_SIZE, Inventory, applyInvAction, newInventory, sortInventory } from './sim/inventory';
import { ITEMS } from './sim/items';
import { BUFFS, FOOD_TIME, applyBuff } from './sim/consumables';
import { ABILITIES, STAGGER_TIME } from './sim/data';
import { enemyStatuses, playerStatuses } from './sim/status';
import { BarLayout, defaultBar, sanitizeBar } from './bar-layout';

let checks = 0;
function assert(cond: unknown, msg: string): asserts cond {
  checks++;
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
  console.log(`  ok  ${msg}`);
}
const section = (n: string) => console.log(`\n# ${n}`);
/** A bag laid out by hand: 'coal x30' at the slots given, everything else empty. */
const bagOf = (...at: [slot: number, id: string, qty: number][]): Inventory => {
  const inv = newInventory();
  for (const [slot, id, qty] of at) inv[slot] = { id, qty };
  return inv;
};
const names = (inv: Inventory) => inv.filter(Boolean).map(st => `${st!.id}x${st!.qty}`).join(' ');
const tally = (inv: Inventory) => {
  const m = new Map<string, number>();
  for (const st of inv) if (st) m.set(st.id, (m.get(st.id) ?? 0) + st.qty);
  return [...m].sort().map(([id, n]) => `${id}=${n}`).join(' ');
};

section('Sort: part-stacks merge and the bag packs to the front');
{
  const inv = bagOf([3, 'coal', 30], [9, 'coal', 25], [20, 'coal', 7]);
  sortInventory(inv);
  assert(names(inv) === 'coalx50 coalx12', `three part-stacks of coal become a full 50 and a 12: ${names(inv)}`);
  assert(inv[0] && inv[1] && !inv[2], 'and they sit in the first slots, with nothing left behind');
}
{
  const inv = bagOf([27, 'logs', 1]);
  sortInventory(inv);
  assert(!!inv[0] && inv.slice(1).every(st => !st), 'a single item at the back moves to the front');
}

section('Sort: gear first (by slot), then food, then materials');
{
  const inv = bagOf([0, 'coal', 4], [1, 'iron_sword', 1], [2, 'brine_trout_cooked', 3], [3, 'iron_helm', 1]);
  sortInventory(inv);
  const order = inv.filter(Boolean).map(st => st!.id);
  assert(order.join(',') === 'iron_sword,iron_helm,brine_trout_cooked,coal', `weapon, head, food, material: ${order.join(',')}`);
}
{
  const inv = bagOf([0, 'iron_sword', 1], [1, 'steel_sword', 1]);
  sortInventory(inv);
  assert(ITEMS[inv[0]!.id].tier > ITEMS[inv[1]!.id].tier, 'within a slot the better tier leads');
}

section('Sort: nothing is gained, lost or shuffled twice');
{
  const inv = bagOf([2, 'coal', 30], [5, 'coal', 25], [7, 'iron_sword', 1], [11, 'brine_trout_cooked', 2], [12, 'brine_trout_cooked', 9]);
  const before = tally(inv);
  sortInventory(inv);
  assert(tally(inv) === before, `every item survives the sort: ${tally(inv)}`);
  const once = names(inv);
  sortInventory(inv);
  assert(names(inv) === once, 'sorting an already sorted bag changes nothing');
}
{
  const inv = newInventory();
  const ids = Object.keys(ITEMS).slice(0, INVENTORY_SIZE);
  ids.forEach((id, i) => { inv[i] = { id, qty: 1 }; });
  sortInventory(inv);
  assert(inv.filter(Boolean).length === INVENTORY_SIZE, 'a full bag of 28 different items still holds 28 after a sort');
}
{
  const s: GameState = createState(991);
  s.player.inventory = bagOf([6, 'coal', 30], [14, 'coal', 9]);
  applyInvAction(s, { k: 'sort' });
  assert(names(s.player.inventory) === 'coalx39', 'the sim action is the same sort: the panel button needs nothing of its own');
}

section('Buffs on the player carry their own clock');
{
  const s = createState(992), p = s.player;
  assert(playerStatuses(p).length === 0, 'an unfed player with no buffs shows nothing');

  p.food = { left: 3, rate: 5, pending: 0 };
  const eating = playerStatuses(p);
  assert(eating.length === 1 && eating[0].key === 'food' && eating[0].left === 3 && eating[0].total === FOOD_TIME,
    'a meal in the mouth is one entry: 3 of its 5 seconds left');
  assert(!eating[0].bad, 'and it is a buff, not a debuff');

  applyBuff(s, 'well_fed');
  const fed = playerStatuses(p);
  assert(fed.length === 2 && fed[1].key === 'well_fed' && fed[1].icon === BUFFS.well_fed.icon && fed[1].total === BUFFS.well_fed.duration,
    'Well Fed joins it, with the full twenty minutes to run');
  p.buffs[0].left = 30;
  assert(playerStatuses(p)[1].left === 30, 'and the clock it reports is the buff\'s own remainder');
}

section('Debuffs on the target: the bleed and the stagger');
{
  const s = createState(993), e = s.enemies[0];
  assert(enemyStatuses(e).length === 0, 'an untouched enemy shows nothing');

  const ticks = ABILITIES.find(a => a.kind === 'dot')!.dotTicks!;
  e.bleed = { ticks, timer: 1, damage: 4, interval: 1 };
  const bleeding = enemyStatuses(e);
  assert(bleeding.length === 1 && bleeding[0].key === 'bleed' && bleeding[0].bad, 'a fresh bleed is one debuff');
  assert(bleeding[0].left === ticks && bleeding[0].total === ticks, `and it has its whole run left: ${bleeding[0].left}/${bleeding[0].total}s`);
  e.bleed = { ticks: 2, timer: 0.5, damage: 4, interval: 1 };
  assert(enemyStatuses(e)[0].left === 1.5, 'part way through, the tick in flight counts as the fraction it has left');

  e.bleed = null;
  e.stagger = STAGGER_TIME;
  const stunned = enemyStatuses(e);
  assert(stunned.length === 1 && stunned[0].key === 'stagger' && stunned[0].left === STAGGER_TIME && stunned[0].total === STAGGER_TIME,
    'a landed Pummel shows as a stagger with its full time');
  e.stagger = 0;
  assert(enemyStatuses(e).length === 0, 'and it leaves the frame the moment it runs out');
}

section('Saved bar layout: a longer bar keeps what the player arranged (HOM-104)');
{
  // a layout as the plain ability indices it is stored as, so these checks read the same now a slot can also hold an item (HOM-105)
  const idx = (bar: BarLayout) => bar.map(e => (e?.k === 'ability' ? e.i : null));
  // the bar was eleven keys when this was saved: the player swapped Strike and Cleave, took the Pummel off, and left the new keys to come
  const old = [4, 1, 2, 3, 0, null, 6, 7, 8, 9, 10];
  const grown = idx(sanitizeBar(old, 13, 13));
  const none = (...v: unknown[]) => v.map(raw => idx(sanitizeBar(raw, 13, 13)).join()).every(j => j === idx(defaultBar(13, 13)).join());
  assert(grown.length === 13, 'a layout saved for a shorter bar comes back as long as the bar is now');
  assert(old.every((v, i) => grown[i] === v), 'every slot the player arranged is where they left it, the emptied one included');
  assert(grown[11] === 11 && grown[12] === 12, 'the two new keys take the two abilities the save predates');
  assert(!grown.includes(5), 'an ability the player took off the bar on purpose does not come back');
  assert(new Set(grown.filter(v => v !== null)).size === grown.filter(v => v !== null).length, 'no ability is on the bar twice');

  const full = [...Array(13).keys()].reverse();
  assert(idx(sanitizeBar(full, 13, 13)).join() === full.join(), 'a layout that already fits the bar is kept as it is');
  assert(idx(sanitizeBar([0, 1, 2], 13, 3)).join() === '0,1,2,,,,,,,,,,', 'a short bar with nothing new to add leaves the new keys empty');
  assert(none([...full, 0]), 'a layout longer than the bar is thrown away');
  assert(none(null, [], 'x'), 'nothing, an empty list or a non-list is the default');
  assert(idx(sanitizeBar([0, 0, 99, -1, 1.5], 13, 13)).slice(0, 5).join() === '0,,,,', 'a repeat, an unknown ability or a non-integer is dropped from its slot');
}

console.log(`\nAll ${checks} inventory-sort, unit-frame and bar-layout checks passed.`);
