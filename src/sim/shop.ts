// The merchants (Hale's, and the chandler on Saltmarrow's quay): each buys any item for its `value` and sells a short list of gear at a markup. Pure sim.
// Gold has one source (selling) and one sink (this stock). The stock is dropped-tier gear and never a crafting input, so
// buy -> smith -> sell cannot make gold however high the smith's yield climbs (see the no-arbitrage test).
import type { GameState } from '../sim';
import { LANDMARKS } from './world';
import { ITEMS } from './items';
import { addItem, hasRoom } from './inventory';

export const VENDOR = { name: 'Brannoch the Peddler', x: LANDMARKS.vendor.x, z: LANDMARKS.vendor.z, r: LANDMARKS.vendor.r };
export const HARBOUR_VENDOR = { name: 'Tam Brine, Chandler', x: LANDMARKS.harbourVendor.x, z: LANDMARKS.harbourVendor.z, r: LANDMARKS.harbourVendor.r };
export const SHOP_REACH = 6; // centre to centre, like the forge
export const BUY_MARKUP = 4; // the shop charges this many times an item's value: far above what it pays, so a round trip always loses gold
export const MAX_GOLD = 1e9;

/** What the merchant sells: gear the enemies already drop, never anything a recipe consumes. */
export const SHOP_STOCK = ['rusty_blade', 'leather_cap', 'hide_jerkin', 'hide_leggings', 'iron_sword', 'iron_helm', 'iron_chestplate', 'iron_greaves'] as const;

/** Saltmarrow's stock is the tier above Hale's (the bible: a town sells the previous tier's dropped gear), and again never anything a recipe consumes, bar the pie's pinch of sea salt. */
export const HARBOUR_STOCK = ['iron_sword', 'iron_helm', 'iron_chestplate', 'iron_greaves', 'steel_sword', 'sea_salt'] as const;

export type VendorId = 'hale' | 'harbour';
export interface Vendor { id: VendorId; name: string; x: number; z: number; r: number; stock: readonly string[] }
export const VENDORS: Vendor[] = [{ id: 'hale', ...VENDOR, stock: SHOP_STOCK }, { id: 'harbour', ...HARBOUR_VENDOR, stock: HARBOUR_STOCK }];
export const vendorById = (id: string) => VENDORS.find(v => v.id === id);

export type ShopAction = { k: 'sell'; slot: number; qty: number } | { k: 'buy'; item: string; qty: number };

export const buyPrice = (id: string) => ITEMS[id].value * BUY_MARKUP;
const reachOf = (s: GameState, v: Vendor) => Math.hypot(s.player.x - v.x, s.player.z - v.z);
/** The merchant the player is standing at (the nearest one in reach), if any. */
export const vendorNear = (s: GameState): Vendor | undefined =>
  VENDORS.filter(v => reachOf(s, v) <= SHOP_REACH).sort((a, b) => reachOf(s, a) - reachOf(s, b))[0];
export const nearVendor = (s: GameState) => !!vendorNear(s);

const fail = (s: GameState, reason: 'range' | 'full' | 'gold', what: string) =>
  void s.events.push({ t: 'actionfail', reason, need: 0, what });

export function applyShopAction(s: GameState, act: ShopAction) {
  const p = s.player;
  if (p.dead || !Number.isInteger(act.qty) || act.qty < 1) return;
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

function removeFromSlot(s: GameState, slot: number, qty: number) {
  const inv = s.player.inventory, st = inv[slot]!;
  st.qty -= qty;
  if (st.qty <= 0) inv[slot] = null;
}
