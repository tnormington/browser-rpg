// The merchants (Hale's, and the chandler on Saltmarrow's quay): each buys any item for its `value` and sells a short list of gear at a markup. Pure sim.
// Gold has one source (selling) and three sinks (this stock, the trainer, and mending worn gear: the cost of dying). The stock is dropped-tier gear and never a crafting input, so
// buy -> smith -> sell cannot make gold however high the smith's yield climbs (see the no-arbitrage test).
import type { GameState } from '../sim';
import { LANDMARKS } from './world';
import { ITEMS } from './items';
import { VIAL } from './herbs';
import { addItem, hasRoom, refreshGearStats } from './inventory';
import { ABILITIES } from './data';
import { damagedGear, repairCost } from './durability';
import { mountById } from './mounts';
import { totalLevel } from './skills';

export const VENDOR = { name: 'Brannoch the Peddler', x: LANDMARKS.vendor.x, z: LANDMARKS.vendor.z, r: LANDMARKS.vendor.r };
export const HARBOUR_VENDOR = { name: 'Tam Brine, Chandler', x: LANDMARKS.harbourVendor.x, z: LANDMARKS.harbourVendor.z, r: LANDMARKS.harbourVendor.r };
export const THORN_VENDOR = { name: 'Edda Bracken, Provisioner', x: LANDMARKS.thornVendor.x, z: LANDMARKS.thornVendor.z, r: LANDMARKS.thornVendor.r };
export const TRAINER ={ name: 'Orla Saltblade, Trainer', x: LANDMARKS.trainer.x, z: LANDMARKS.trainer.z, r: LANDMARKS.trainer.r };
export const THORN_TRAINER = { name: 'Brannock Vane, Trainer', x: LANDMARKS.thornTrainer.x, z: LANDMARKS.thornTrainer.z, r: LANDMARKS.thornTrainer.r };
export const THORN_STABLE = { name: 'Garth Hollin, Stablemaster', x: LANDMARKS.thornStable.x, z: LANDMARKS.thornStable.z, r: LANDMARKS.thornStable.r };
export const HIGH_VENDOR = { name: 'Kell Ashdown, Provisioner', x: LANDMARKS.highVendor.x, z: LANDMARKS.highVendor.z, r: LANDMARKS.highVendor.r };
export const HIGH_TRAINER = { name: 'Ravn Highcastle, Trainer', x: LANDMARKS.highTrainer.x, z: LANDMARKS.highTrainer.z, r: LANDMARKS.highTrainer.r };
export const HIGH_STABLE = { name: 'Isolde Marr, Stablemaster', x: LANDMARKS.highStable.x, z: LANDMARKS.highStable.z, r: LANDMARKS.highStable.r };
export const SPIRE_VENDOR = { name: 'Corwen Ashmere, Provisioner', x: LANDMARKS.spireVendor.x, z: LANDMARKS.spireVendor.z, r: LANDMARKS.spireVendor.r };
export const SHOP_REACH = 6; // centre to centre, like the forge
export const BUY_MARKUP = 4; // the shop charges this many times an item's value: far above what it pays, so a round trip always loses gold
export const MAX_GOLD = 1e9;

/** What the merchant sells: gear the enemies already drop, never anything a recipe consumes. */
export const SHOP_STOCK = ['rusty_blade', 'leather_cap', 'hide_jerkin', 'hide_leggings', 'iron_sword', 'iron_helm', 'iron_chestplate', 'iron_greaves'] as const;

/** Saltmarrow's stock is the tier above Hale's (the bible: a town sells the previous tier's dropped gear), and again never anything a recipe consumes, bar the pie's pinch of sea salt. */
export const HARBOUR_STOCK = ['iron_sword', 'iron_helm', 'iron_chestplate', 'iron_greaves', 'steel_sword', 'sea_salt'] as const;

/** Thornwick's is Saltmarrow's stock without the salt, and with the vial every potion is poured into: no tier of dropped gear exists above steel yet. */
export const THORN_STOCK = ['iron_sword', 'iron_helm', 'iron_chestplate', 'iron_greaves', 'steel_sword', VIAL] as const;

/** Highmoor's is Thornwick's without the vial (bible 2.1: nothing added, leatherworking is self-supplied): no tier of dropped gear exists above steel yet. It exists for the bag and the mending. */
export const HIGH_STOCK = ['iron_sword', 'iron_helm', 'iron_chestplate', 'iron_greaves', 'steel_sword'] as const;

/** The Spire's is Highmoor's (bible 2.1: nothing added): no tier of dropped gear exists above steel, and the town's trade is the forge. It exists for the bag and the mending. */
export const SPIRE_STOCK = HIGH_STOCK;

export interface Vendor { id: string; name: string; x: number; z: number; r: number; stock: readonly string[] }
/** Merchants buy and sell; the trainer has no stock and teaches whatever ABILITIES names her in `trainer.vendor`, and the stablemaster sells whatever MOUNTS names him in `vendor`. */
export const VENDORS: Vendor[] = [{ id: 'hale', ...VENDOR, stock: SHOP_STOCK }, { id: 'harbour', ...HARBOUR_VENDOR, stock: HARBOUR_STOCK }, { id: 'trainer', ...TRAINER, stock: [] }, { id: 'thorn', ...THORN_VENDOR, stock: THORN_STOCK }, { id: 'thorn_trainer', ...THORN_TRAINER, stock: [] }, { id: 'thorn_stable', ...THORN_STABLE, stock: [] },
  { id: 'high', ...HIGH_VENDOR, stock: HIGH_STOCK }, { id: 'high_trainer', ...HIGH_TRAINER, stock: [] }, { id: 'high_stable', ...HIGH_STABLE, stock: [] },
  { id: 'spire', ...SPIRE_VENDOR, stock: SPIRE_STOCK }];
/** The slots a trainer teaches. */
export const taughtBy = (vendor: string) => ABILITIES.flatMap((a, slot) => a.trainer?.vendor === vendor ? [slot] : []);
export const vendorById = (id: string) => VENDORS.find(v => v.id === id);

export type ShopAction = { k: 'sell'; slot: number; qty: number } | { k: 'buy'; item: string; qty: number } | { k: 'learn'; slot: number } | { k: 'mount'; id: string } | { k: 'repair' };

export const buyPrice = (id: string) => ITEMS[id].value * BUY_MARKUP;
const reachOf = (s: GameState, v: Vendor) => Math.hypot(s.player.x - v.x, s.player.z - v.z);
/** The merchant the player is standing at (the nearest one in reach), if any. */
export const vendorNear = (s: GameState): Vendor | undefined =>
  VENDORS.filter(v => v.stock.length > 0 && reachOf(s, v) <= SHOP_REACH).sort((a, b) => reachOf(s, a) - reachOf(s, b))[0];
export const nearVendor = (s: GameState) => !!vendorNear(s);
/** Reach to the trainer, which `vendorNear` leaves out: nobody buys your bag there. */
const nearTrainer = (s: GameState, id: string) => { const v = vendorById(id); return !!v && reachOf(s, v) <= SHOP_REACH; };

const fail = (s: GameState, reason: 'range' | 'full' | 'gold', what: string) =>
  void s.events.push({ t: 'actionfail', reason, need: 0, what });

export function applyShopAction(s: GameState, act: ShopAction) {
  const p = s.player;
  if (p.dead) return;
  if (act.k === 'learn') return learnAbility(s, act.slot);
  if (act.k === 'repair') return repairGear(s);
  if (act.k === 'mount') return buyMount(s, act.id);
  if (!Number.isInteger(act.qty) || act.qty < 1) return;
  if (act.k === 'sell') {
    const st = Number.isInteger(act.slot) ? p.inventory[act.slot] : null;
    if (!st) return;
    if (!nearVendor(s)) return fail(s, 'range', ITEMS[st.id].name);
    const qty = Math.min(act.qty, st.qty), gold = ITEMS[st.id].value * qty;
    removeFromSlot(s, act.slot, qty);
    p.gold = Math.min(MAX_GOLD, p.gold + gold);
    s.events.push({ t: 'trade', sold: true, item: st.id, qty, gold });
    return;
  }
  const vendor = vendorNear(s);
  if (!VENDORS.some(v => v.stock.includes(act.item))) return;
  const def = ITEMS[act.item];
  if (!vendor) return fail(s, 'range', def.name);
  if (!vendor.stock.includes(act.item)) return; // this one does not sell it
  const cost = buyPrice(act.item) * act.qty;
  if (p.gold < cost) return fail(s, 'gold', def.name);
  if (!hasRoom(p.inventory, act.item, act.qty)) return fail(s, 'full', def.name);
  addItem(p.inventory, act.item, act.qty);
  p.gold -= cost;
  s.events.push({ t: 'trade', sold: false, item: act.item, qty: act.qty, gold: cost });
}

/** Mend every worn-down piece you carry (worn first, then the bag) at a merchant, each in full while the gold lasts: a piece you cannot afford is left as it is. */
function repairGear(s: GameState) {
  const p = s.player, damaged = damagedGear(p);
  if (!damaged.length) return;
  if (!nearVendor(s)) return fail(s, 'range', 'repairs');
  let gold = 0, pieces = 0;
  for (const id of damaged) {
    const cost = repairCost(p, id);
    if (p.gold < cost) continue;
    p.gold -= cost; gold += cost; pieces++;
    delete p.durability[id]; // whole again: no entry
  }
  if (!pieces) return fail(s, 'gold', 'repairs');
  refreshGearStats(s);
  s.events.push({ t: 'repair', gold, pieces });
}

/** Buy an ability from its trainer: needs the level, the gold and the trainer in reach, and is paid for once. */
function learnAbility(s: GameState, slot: number) {
  const p = s.player, a = Number.isInteger(slot) ? ABILITIES[slot] : undefined;
  if (!a?.trainer || p.learned.includes(a.name)) return;
  if (!nearTrainer(s, a.trainer.vendor)) return fail(s, 'range', a.name);
  if (p.combat.level < a.unlockLevel) return s.events.push({ t: 'fail', reason: 'locked', slot });
  if (p.gold < a.trainer.price) return fail(s, 'gold', a.name);
  p.gold -= a.trainer.price;
  p.learned.push(a.name);
  s.events.push({ t: 'learn', slot, gold: a.trainer.price });
}

/** Buy a mount from its stablemaster: needs the level, the gold and the stablemaster in reach, and is paid for once. */
function buyMount(s: GameState, id: string) {
  const p = s.player, m = mountById(id);
  if (!m || p.mounts.includes(m.id)) return;
  if (!nearTrainer(s, m.vendor)) return fail(s, 'range', m.name);
  if (p.combat.level < m.level) return void s.events.push({ t: 'actionfail', reason: 'mount', need: m.level, what: `You need Combat level ${m.level} to buy ${m.name}` });
  if (m.total && totalLevel(p.skills) < m.total) return void s.events.push({ t: 'actionfail', reason: 'mount', need: m.total, what: `You need a total level of ${m.total} to buy ${m.name} (you are at ${totalLevel(p.skills)})` });
  if (p.gold < m.price) return fail(s, 'gold', m.name);
  p.gold -= m.price;
  p.mounts.push(m.id);
  s.events.push({ t: 'stable', mount: m.id, gold: m.price });
}

function removeFromSlot(s: GameState, slot: number, qty: number) {
  const inv = s.player.inventory, st = inv[slot]!;
  st.qty -= qty;
  if (st.qty <= 0) inv[slot] = null;
}
