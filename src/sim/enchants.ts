// Slot enchants (docs/world-design.md 2.2, HOM-112): data and the one function that turns them into stats. Pure sim, and no value import from items.ts (which reads this).
// An enchant belongs to the *slot*, not the item: it keeps working when the sword changes, which is why the inventory needs no per-item state (`ItemStack` is `{ id, qty }`).
import type { Durability, Equipment, EquipSlot } from './items';
import { xpForLevel } from './xp';

/** What the player has set on each slot, by ENCHANTS id. A slot with no entry has none. */
export type Enchants = Partial<Record<EquipSlot, string>>;

export interface EnchantFx {
  /** Added to the crit chance (a fraction: 0.03 is three points). */
  crit: number;
  /** Energy a second, on top of ENERGY_REGEN. */
  energyRegen: number;
  /** Flat armour, before the reduction curve. */
  armor: number;
  /** Share of max health, added to it. */
  hpFrac: number;
}
export const NO_ENCHANT_FX: EnchantFx = { crit: 0, energyRegen: 0, armor: 0, hpFrac: 0 };

export interface EnchantDef {
  id: string;
  name: string;
  slots: EquipSlot[];
  /** Enchanting level it asks for. */
  level: number;
  /** Arcane dust it costs. */
  dust: number;
  fx: Partial<EnchantFx>;
  desc: string;
}

const ARMOUR_SLOTS: EquipSlot[] = ['head', 'chest', 'legs', 'hands', 'feet'];

/** The bible's four (2.2). */
export const ENCHANTS: EnchantDef[] = [
  { id: 'keen', name: 'Keen', slots: ['weapon'], level: 36, dust: 40, fx: { crit: 0.03 }, desc: '+3% crit chance.' },
  { id: 'vigour', name: 'Vigour', slots: ['weapon'], level: 38, dust: 80, fx: { energyRegen: 1 }, desc: '+1 energy a second.' },
  { id: 'warding', name: 'Warding', slots: ARMOUR_SLOTS, level: 36, dust: 25, fx: { armor: 4 }, desc: '+4 armour.' },
  { id: 'vitality', name: 'Vitality', slots: ['chest'], level: 40, dust: 60, fx: { hpFrac: 0.06 }, desc: '+6% max health.' },
];
export const enchantById = (id: string) => ENCHANTS.find(e => e.id === id);

/**
 * What an enchant pays in Enchanting experience: 0.4 x the cost of its own level, the rule a blade is paid by (every capstone is made once, so is worth more each). Worked out from the curve, so
 * it stays right if the curve is retuned.
 */
export const enchantXp = (e: EnchantDef) => Math.round(0.4 * (xpForLevel(e.level + 1) - xpForLevel(e.level)));

/** The sum of every slot's enchant that is working: the slot has to hold something, and it must not be broken (a broken piece gives nothing, and so does what is set on it). */
export function enchantFx(equipment: Equipment, durability: Durability, enchants: Enchants): EnchantFx {
  const out = { ...NO_ENCHANT_FX };
  for (const [slot, id] of Object.entries(enchants) as [EquipSlot, string][]) {
    const worn = equipment[slot], def = enchantById(id);
    if (!def || !worn || durability[worn] === 0) continue;
    for (const k of Object.keys(def.fx) as (keyof EnchantFx)[]) out[k] += def.fx[k] ?? 0;
  }
  return out;
}
