// Item data, drop tables and the single derived-stat function. Pure data + math: no DOM/Three.

export type EquipSlot = 'weapon' | 'head' | 'chest' | 'legs';
export const EQUIP_SLOTS: EquipSlot[] = ['weapon', 'head', 'chest', 'legs'];

export interface ItemStats {
  damage?: number; // weapon: flat damage added to every direct hit (before level power)
  armor?: number;  // armour: contributes to incoming damage reduction
}

export interface ItemDef {
  name: string;
  slot?: EquipSlot;   // present = equippable
  stats?: ItemStats;
  stack: number;      // max per inventory slot (1 = unstackable)
  dropWeight: number; // default weight in any drop table that lists it
  tier: number;       // 0 material, 1 common, 2 good, 3 rare: drives ground/tooltip colour
  desc: string;
}

export const ITEMS: Record<string, ItemDef> = {
  // materials (M3 smithing uses iron_ore + coal; they come from mining nodes, not drops)
  boar_hide: { name: 'Boar Hide', stack: 50, dropWeight: 40, tier: 0, desc: 'Coarse hide. Crafting material.' },
  wolf_pelt: { name: 'Wolf Pelt', stack: 50, dropWeight: 40, tier: 0, desc: 'Thick grey fur. Crafting material.' },
  iron_ore: { name: 'Iron Ore', stack: 50, dropWeight: 0, tier: 0, desc: 'Smelts into iron at the forge.' },
  coal: { name: 'Coal', stack: 50, dropWeight: 0, tier: 0, desc: 'Fuel for the forge.' },
  // weapons
  rusty_blade: { name: 'Rusty Blade', slot: 'weapon', stats: { damage: 2 }, stack: 1, dropWeight: 10, tier: 1, desc: 'Better than bare hands.' },
  iron_sword: { name: 'Iron Sword', slot: 'weapon', stats: { damage: 5 }, stack: 1, dropWeight: 6, tier: 2, desc: 'A reliable soldier\'s sword.' },
  steel_sword: { name: 'Steel Sword', slot: 'weapon', stats: { damage: 9 }, stack: 1, dropWeight: 3, tier: 3, desc: 'Keen, balanced, rare.' },
  // armour
  leather_cap: { name: 'Leather Cap', slot: 'head', stats: { armor: 2 }, stack: 1, dropWeight: 10, tier: 1, desc: 'Stitched hide.' },
  hide_jerkin: { name: 'Hide Jerkin', slot: 'chest', stats: { armor: 4 }, stack: 1, dropWeight: 8, tier: 1, desc: 'Stitched hide.' },
  hide_leggings: { name: 'Hide Leggings', slot: 'legs', stats: { armor: 3 }, stack: 1, dropWeight: 10, tier: 1, desc: 'Stitched hide.' },
  iron_helm: { name: 'Iron Helm', slot: 'head', stats: { armor: 5 }, stack: 1, dropWeight: 5, tier: 2, desc: 'Dented but solid.' },
  iron_chestplate: { name: 'Iron Chestplate', slot: 'chest', stats: { armor: 9 }, stack: 1, dropWeight: 4, tier: 2, desc: 'Heavy and protective.' },
  iron_greaves: { name: 'Iron Greaves', slot: 'legs', stats: { armor: 6 }, stack: 1, dropWeight: 5, tier: 2, desc: 'Heavy and protective.' },
};

export const TIER_COLORS = [0xc8c8c8, 0xe8e8e8, 0x4aa8ff, 0xffa030]; // material, common, good, rare

export interface DropEntry { id: string; qty?: [number, number]; weight?: number }
export interface DropTable {
  rolls: number;          // independent weighted rolls per kill
  nothing: number;        // weight of "no drop" in each roll
  entries: DropEntry[];
}

export const DROP_TABLES: Record<string, DropTable> = {
  boar: { rolls: 1, nothing: 25, entries: [
    { id: 'boar_hide', qty: [1, 2] }, { id: 'rusty_blade' }, { id: 'leather_cap' }, { id: 'hide_leggings' },
  ] },
  wolf: { rolls: 2, nothing: 40, entries: [
    { id: 'wolf_pelt', qty: [1, 2] }, { id: 'hide_jerkin' }, { id: 'leather_cap' }, { id: 'hide_leggings' },
    { id: 'rusty_blade' }, { id: 'iron_sword', weight: 4 },
  ] },
  brute: { rolls: 3, nothing: 20, entries: [
    { id: 'iron_sword' }, { id: 'steel_sword' }, { id: 'iron_helm' }, { id: 'iron_chestplate' }, { id: 'iron_greaves' },
    { id: 'wolf_pelt', qty: [2, 4] },
  ] },
};

export interface DerivedStats {
  weaponDamage: number; // flat, added to direct-hit base damage
  armor: number;
  reduction: number;    // fraction of incoming damage removed, 0..MAX_REDUCTION
}

export const ARMOR_K = 40;        // reduction = armor / (armor + ARMOR_K)
export const MAX_REDUCTION = 0.75;

export type Equipment = Record<EquipSlot, string | null>;
export const emptyEquipment = (): Equipment => ({ weapon: null, head: null, chest: null, legs: null });

/**
 * THE derived-stat calculation. Combat reads only this; M3's smithed weapon is just another
 * ITEMS entry equipped in the weapon slot.
 */
export function deriveStats(equipment: Equipment): DerivedStats {
  let weaponDamage = 0, armor = 0;
  for (const slot of EQUIP_SLOTS) {
    const id = equipment[slot];
    const st = id ? ITEMS[id]?.stats : undefined;
    if (!st) continue;
    weaponDamage += st.damage ?? 0;
    armor += st.armor ?? 0;
  }
  return { weaponDamage, armor, reduction: Math.min(MAX_REDUCTION, armor / (armor + ARMOR_K)) };
}

/** Human-readable stat lines for tooltips. */
export function describeStats(def: ItemDef): string[] {
  const out: string[] = [];
  if (def.stats?.damage) out.push(`+${def.stats.damage} weapon damage`);
  if (def.stats?.armor) out.push(`+${def.stats.armor} armour`);
  return out;
}
