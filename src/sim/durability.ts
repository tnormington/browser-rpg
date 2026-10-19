// Gear durability. Dying wears every worn piece down (DEATH_WEAR points of MAX_DURABILITY); at 0 a piece stays on and gives nothing until a
// vendor mends it (shop.ts). Nothing is ever destroyed. Ordinary combat wears nothing: the board asked for dying to be the cost, and a
// maintenance tax on every fight would be a nag rather than a stake. Wear is kept per item id, not per bag slot, so taking a broken piece
// off and putting it back on mends nothing. Pure sim.
import type { Player } from '../sim';
import { DEATH_WEAR, MAX_DURABILITY, REPAIR_FRAC } from './data';
import { EQUIP_SLOTS, ITEMS } from './items';

export const durabilityOf = (p: Player, id: string) => p.durability[id] ?? MAX_DURABILITY;
export const isBroken = (p: Player, id: string) => durabilityOf(p, id) <= 0;

/** Wear every worn piece by DEATH_WEAR and report each one's durability before and after. */
export function wearWornGear(p: Player): { item: string; was: number; now: number }[] {
  const out: { item: string; was: number; now: number }[] = [];
  for (const slot of EQUIP_SLOTS) {
    const id = p.equipment[slot];
    if (!id || out.some(w => w.item === id)) continue;
    const was = durabilityOf(p, id), now = Math.max(0, was - DEATH_WEAR);
    p.durability[id] = now;
    out.push({ item: id, was, now });
  }
  return out;
}

/** Gold to mend one piece from where it stands to whole: its share of REPAIR_FRAC of its value, at least 1 for any damage. */
export function repairCost(p: Player, id: string): number {
  const missing = MAX_DURABILITY - durabilityOf(p, id);
  return missing > 0 ? Math.max(1, Math.ceil(ITEMS[id].value * REPAIR_FRAC * missing / MAX_DURABILITY)) : 0;
}

/** Everything the player carries that is worn down: worn pieces first, then the bag, each id once. */
export function damagedGear(p: Player): string[] {
  const ids = [...EQUIP_SLOTS.map(slot => p.equipment[slot]), ...p.inventory.map(st => st && ITEMS[st.id].slot ? st.id : null)];
  return ids.filter((id, i): id is string => !!id && ids.indexOf(id) === i && durabilityOf(p, id) < MAX_DURABILITY);
}
