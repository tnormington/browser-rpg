// The merchant in the clearing: buys any item for its `value`, sells a short list of gear at a markup. Pure sim.
// Gold has one source (selling) and one sink (this stock). The stock is dropped-tier gear and never a crafting input, so
// buy -> smith -> sell cannot make gold however high the smith's yield climbs (see the no-arbitrage test).
import type { GameState } from '../sim';
import { LANDMARKS } from './world';
import { ITEMS } from './items';
import { addItem, hasRoom } from './inventory';

export const VENDOR = { name: 'Brannoch the Peddler', x: LANDMARKS.vendor.x, z: LANDMARKS.vendor.z, r: LANDMARKS.vendor.r };
export const SHOP_REACH = 6; // centre to centre, like the forge
export const BUY_MARKUP = 4; // the shop charges this many times an item's value: far above what it pays, so a round trip always loses gold
export const MAX_GOLD = 1e9;

/** What the merchant sells: gear the enemies already drop, never anything a recipe consumes. */
export const SHOP_STOCK = ['rusty_blade', 'leather_cap', 'hide_jerkin', 'hide_leggings', 'iron_sword', 'iron_helm', 'iron_chestplate', 'iron_greaves'] as const;

export type ShopAction = { k: 'sell'; slot: number; qty: number } | { k: 'buy'; item: string; qty: number };

export const buyPrice = (id: string) => ITEMS[id].value * BUY_MARKUP;
export const nearVendor = (s: GameState) => Math.hypot(s.player.x - VENDOR.x, s.player.z - VENDOR.z) <= SHOP_REACH;

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
  if (!(SHOP_STOCK as readonly string[]).includes(act.item)) return;
  const def = ITEMS[act.item];
  if (!nearVendor(s)) return fail(s, 'range', def.name);
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
