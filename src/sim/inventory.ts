// Inventory + equipment operations on the player. Pure sim.
import type { GameState } from '../sim';
import { ITEMS, deriveStats } from './items';
import type { EquipSlot } from './items';

export const INVENTORY_SIZE = 28;
export interface ItemStack { id: string; qty: number }
export type Inventory = (ItemStack | null)[];

export const newInventory = (): Inventory => Array.from({ length: INVENTORY_SIZE }, () => null);

export type InvAction =
  | { k: 'equip'; slot: number }
  | { k: 'unequip'; slot: EquipSlot }
  | { k: 'move'; from: number; to: number }
  | { k: 'drop'; slot: number }
  | { k: 'destroy'; slot: number };

/** Adds to existing stacks first, then empty slots. Returns the quantity that did not fit. */
export function addItem(inv: Inventory, id: string, qty: number): number {
  const def = ITEMS[id];
  if (!def) return qty;
  for (const st of inv) {
    if (qty <= 0) break;
    if (st && st.id === id && st.qty < def.stack) {
      const n = Math.min(qty, def.stack - st.qty);
      st.qty += n; qty -= n;
    }
  }
  for (let i = 0; i < inv.length && qty > 0; i++) {
    if (inv[i]) continue;
    const n = Math.min(qty, def.stack);
    inv[i] = { id, qty: n }; qty -= n;
  }
  return qty;
}

export const countItem = (inv: Inventory, id: string) =>
  inv.reduce((n, st) => n + (st && st.id === id ? st.qty : 0), 0);

const validSlot = (i: number) => Number.isInteger(i) && i >= 0 && i < INVENTORY_SIZE;

function moveSlot(inv: Inventory, from: number, to: number) {
  if (!validSlot(from) || !validSlot(to) || from === to) return;
  const a = inv[from], b = inv[to];
  if (a && b && a.id === b.id && ITEMS[a.id].stack > 1) {
    const n = Math.min(a.qty, ITEMS[a.id].stack - b.qty);
    b.qty += n; a.qty -= n;
    if (a.qty <= 0) inv[from] = null;
    return;
  }
  inv[from] = b; inv[to] = a;
}

export function refreshGearStats(s: GameState) {
  Object.assign(s.player.stats, deriveStats(s.player.equipment));
}

export function applyInvAction(s: GameState, act: InvAction) {
  const p = s.player, inv = p.inventory;
  if (act.k === 'move') return moveSlot(inv, act.from, act.to);
  if (act.k === 'unequip') {
    const id = p.equipment[act.slot];
    if (!id) return;
    if (addItem(inv, id, 1) > 0) return void s.events.push({ t: 'invfull' });
    p.equipment[act.slot] = null;
    return refreshGearStats(s);
  }
  if (!validSlot(act.slot)) return;
  const st = inv[act.slot];
  if (!st) return;
  if (act.k === 'destroy') { inv[act.slot] = null; return; }
  if (act.k === 'drop') {
    inv[act.slot] = null;
    s.drops.push({
      id: s.nextDropId++, item: st.id, qty: st.qty, age: 0, blocked: true, // blocked: not re-grabbed until you step away
      x: p.x + 1.0 * Math.sin(p.facing), z: p.z + 1.0 * Math.cos(p.facing),
    });
    return;
  }
  // equip: swap with whatever is worn in that slot
  const slot = ITEMS[st.id].slot;
  if (!slot) return;
  const worn = p.equipment[slot];
  p.equipment[slot] = st.id;
  inv[act.slot] = worn ? { id: worn, qty: 1 } : null;
  refreshGearStats(s);
}
