// Enchanting at the rune circle (bible 2.2, HOM-112): the first system that changes gear the player already owns instead of handing them new. Grind a spare piece down to arcane dust, spend the dust on a
// slot enchant. Pure sim; the data and the stat sum are in enchants.ts.
import type { GameState } from '../sim';
import { EquipSlot, ITEMS } from './items';
import { ENCHANTS, enchantById, enchantXp } from './enchants';
import { grantXp } from './skills';
import { addItem, countItem, regear, removeItem } from './inventory';
import { nearStation } from './crafting';

export const DUST = 'arcane_dust';
/** Only gear of this tier or better is worth grinding: the bible's "tier 2 or above" keeps the bronze and hide off the circle. */
export const MIN_DISENCHANT_TIER = 2;
/** Dust a piece of gear grinds down to: a tenth of its value, never less than one (bible 2.2). */
export const dustFor = (id: string) => Math.max(1, Math.round(ITEMS[id].value / 10));
/**
 * Enchanting experience for grinding a piece, per gold of its value. Designed (HOM-125, bible 2.2): the skill opens at 36 (24,815 XP), which at 8 is 3,102 gold of gear, one hour of the Spire's income
 * (about 3,100); everything the climb makes and the player has outgrown (5,238 gold of it) grinds to Enchanting 41, so a hoarder arrives at the top of the list and a seller reaches 36 on 60 % of it;
 * and buying the shop's iron at 4x to grind it costs four hours. Checked in vault.test.ts, so retuning the curve, the loot rule or the markup says this has to be decided again.
 */
export const DISENCHANT_XP_PER_VALUE = 8;
export const disenchantXp = (id: string) => ITEMS[id].value * DISENCHANT_XP_PER_VALUE;
export const canDisenchant = (id: string) => { const d = ITEMS[id]; return !!d?.slot && d.tier >= MIN_DISENCHANT_TIER; };

export type EnchantAction =
  | { k: 'disenchant'; slot: number }                 // grind the stack's first piece in this bag slot
  | { k: 'enchant'; id: string; slot: EquipSlot };    // set an enchant on a slot

export type EnchantFail = 'range' | 'item' | 'level' | 'dust' | 'slot' | 'worn';

const fail = (s: GameState, what: string, reason: 'level' | 'materials' | 'range' | 'req', need = 0) =>
  void s.events.push({ t: 'actionfail', reason, skill: 'enchanting', need, what, station: 'rune circle' });

/** Why this enchant cannot go on this slot right now, or null. The panel reads the same answer, so a greyed button and a refused click agree. */
export function enchantBlocker(s: GameState, id: string, slot: EquipSlot): EnchantFail | null {
  const p = s.player, e = enchantById(id);
  if (!e || !e.slots.includes(slot)) return 'slot';
  if (!nearStation(s, 'circle')) return 'range';
  if (p.skills.enchanting.level < e.level) return 'level';
  if (!p.equipment[slot]) return 'worn';
  if (countItem(p.inventory, DUST) < e.dust) return 'dust';
  return null;
}

export function applyEnchantAction(s: GameState, a: EnchantAction) {
  const p = s.player;
  if (p.dead) return;
  if (a.k === 'disenchant') {
    const st = Number.isInteger(a.slot) ? p.inventory[a.slot] : null;
    if (!st || !canDisenchant(st.id)) return;
    if (!nearStation(s, 'circle')) return fail(s, 'Disenchant', 'range');
    const dust = dustFor(st.id), id = st.id;
    removeItem(p.inventory, id, 1); // the piece goes first: its own slot is the one a full bag's dust goes into (gear never stacks, so there is always room)
    addItem(p.inventory, DUST, dust);
    s.events.push({ t: 'crafted', item: DUST, qty: dust, skill: 'enchanting' });
    grantXp(s, 'enchanting', disenchantXp(id), p.x, p.z);
    return;
  }
  const e = enchantById(a.id), why = enchantBlocker(s, a.id, a.slot);
  if (why === 'range') return fail(s, e?.name ?? 'Enchant', 'range');
  if (why === 'level') return fail(s, e!.name, 'level', e!.level);
  if (why === 'dust') return fail(s, e!.name, 'materials');
  if (why) return fail(s, e?.name ?? 'Enchant', 'req');
  removeItem(p.inventory, DUST, e!.dust);
  p.enchants[a.slot] = e!.id; // whatever was on the slot is overwritten and gone
  regear(s);
  s.events.push({ t: 'enchanted', slot: a.slot, id: e!.id });
  grantXp(s, 'enchanting', enchantXp(e!), p.x, p.z);
}

export { ENCHANTS };
