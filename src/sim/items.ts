// Item data, drop tables and the single derived-stat function. Pure data + math: no DOM/Three.
import { BARE_SWING } from './data';

export type EquipSlot = 'weapon' | 'head' | 'chest' | 'legs';
export const EQUIP_SLOTS: EquipSlot[] = ['weapon', 'head', 'chest', 'legs'];

export interface ItemStats {
  damage?: number; // weapon: flat damage added to every direct hit (before level power)
  speed?: number;  // weapon: seconds between auto-attack swings (default BARE_SWING); sets the rhythm, not the damage per second
  armor?: number;  // armour: contributes to incoming damage reduction
}

export interface ItemDef {
  name: string;
  slot?: EquipSlot;   // present = equippable
  stats?: ItemStats;
  stack: number;      // max per inventory slot (1 = unstackable)
  dropWeight: number; // default weight in any drop table that lists it
  tier: number;       // 0 material, 1 common, 2 good, 3 rare, 4 epic: drives ground/tooltip colour and the worn look (gear-look.ts)
  desc: string;
}

export const ITEMS: Record<string, ItemDef> = {
  // materials (M3 smithing uses iron_ore + coal; they come from mining nodes, not drops)
  boar_hide: { name: 'Boar Hide', stack: 50, dropWeight: 40, tier: 0, desc: 'Coarse hide. Crafting material.' },
  wolf_pelt: { name: 'Wolf Pelt', stack: 50, dropWeight: 40, tier: 0, desc: 'Thick grey fur. Crafting material.' },
  iron_ore: { name: 'Iron Ore', stack: 50, dropWeight: 0, tier: 0, desc: 'Smelts into iron at the forge.' },
  coal: { name: 'Coal', stack: 50, dropWeight: 0, tier: 0, desc: 'Fuel for the forge.' },
  logs: { name: 'Logs', stack: 50, dropWeight: 0, tier: 0, desc: 'Seasoned wood. Makes a good hilt.' },
  iron_bar: { name: 'Iron Bar', stack: 50, dropWeight: 0, tier: 0, desc: 'Smelted at the forge.' },
  steel_bar: { name: 'Steel Bar', stack: 50, dropWeight: 0, tier: 0, desc: 'Iron hardened with coal.' },
  mithril_ore: { name: 'Mithril Ore', stack: 50, dropWeight: 0, tier: 0, desc: 'Blue-veined ore from deep in the cave. Smelts into mithril at the forge.' },
  warden_shard: { name: 'Warden Shard', stack: 50, dropWeight: 0, tier: 0, desc: 'A splinter of the Hollow Warden. Forged with mithril, it makes a blade nothing else can.' },
  mithril_bar: { name: 'Mithril Bar', stack: 50, dropWeight: 0, tier: 0, desc: 'Light, cold and harder than steel. Armour is smithed from it.' },
  // weapons
  rusty_blade: { name: 'Rusty Blade', slot: 'weapon', stats: { damage: 2, speed: 2.2 }, stack: 1, dropWeight: 10, tier: 1, desc: 'Better than bare hands.' },
  iron_sword: { name: 'Iron Sword', slot: 'weapon', stats: { damage: 5, speed: 2.4 }, stack: 1, dropWeight: 6, tier: 2, desc: 'A reliable soldier\'s sword.' },
  steel_sword: { name: 'Steel Sword', slot: 'weapon', stats: { damage: 9, speed: 2.2 }, stack: 1, dropWeight: 3, tier: 3, desc: 'Keen, balanced, rare.' },
  forged_blade: { name: "Forgemaster's Blade", slot: 'weapon', stats: { damage: 18, speed: 2.0 }, stack: 1, dropWeight: 0, tier: 3, desc: 'Steel you smelted and shaped yourself. Better than anything the enemies carry.' },
  // smithed from Warden shards (the Warden's rare drop), so it is something the player made: the crafted weapon stays the best one
  warden_edge: { name: "Warden's Edge", slot: 'weapon', stats: { damage: 28, speed: 2.0 }, stack: 1, dropWeight: 0, tier: 4, desc: 'Mithril folded around a shard of the Hollow Warden. Nothing else you can carry cuts like it.' },
  // armour
  leather_cap: { name: 'Leather Cap', slot: 'head', stats: { armor: 2 }, stack: 1, dropWeight: 10, tier: 1, desc: 'Stitched hide.' },
  hide_jerkin: { name: 'Hide Jerkin', slot: 'chest', stats: { armor: 4 }, stack: 1, dropWeight: 8, tier: 1, desc: 'Stitched hide.' },
  hide_leggings: { name: 'Hide Leggings', slot: 'legs', stats: { armor: 3 }, stack: 1, dropWeight: 10, tier: 1, desc: 'Stitched hide.' },
  iron_helm: { name: 'Iron Helm', slot: 'head', stats: { armor: 5 }, stack: 1, dropWeight: 5, tier: 2, desc: 'Dented but solid.' },
  iron_chestplate: { name: 'Iron Chestplate', slot: 'chest', stats: { armor: 9 }, stack: 1, dropWeight: 4, tier: 2, desc: 'Heavy and protective.' },
  iron_greaves: { name: 'Iron Greaves', slot: 'legs', stats: { armor: 6 }, stack: 1, dropWeight: 5, tier: 2, desc: 'Heavy and protective.' },
  // the smithable set: the cave's enemies are tuned against it, and it is the top rung of the worn-gear ladder (tier 4)
  mithril_helm: { name: 'Mithril Helm', slot: 'head', stats: { armor: 12 }, stack: 1, dropWeight: 0, tier: 4, desc: "Smithed from cave mithril. The Hollow's arrows turn on it." },
  mithril_chestplate: { name: 'Mithril Chestplate', slot: 'chest', stats: { armor: 22 }, stack: 1, dropWeight: 0, tier: 4, desc: 'Smithed from cave mithril. Light enough to dodge in.' },
  mithril_greaves: { name: 'Mithril Greaves', slot: 'legs', stats: { armor: 16 }, stack: 1, dropWeight: 0, tier: 4, desc: 'Smithed from cave mithril.' },
};

/** The smithable set, in smithing order. Quests and verify read it from here. */
export const MITHRIL_SET = ['mithril_helm', 'mithril_greaves', 'mithril_chestplate'] as const;

export const TIER_COLORS = [0xc8c8c8, 0xe8e8e8, 0x4aa8ff, 0xffa030, 0xb48cff]; // material, common, good, rare, epic

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
  hexer: { rolls: 1, nothing: 30, entries: [{ id: 'leather_cap' }, { id: 'hide_leggings' }, { id: 'rusty_blade' }] },
  brute: { rolls: 3, nothing: 20, entries: [
    { id: 'iron_sword' }, { id: 'steel_sword' }, { id: 'iron_helm' }, { id: 'iron_chestplate' }, { id: 'iron_greaves' },
    { id: 'wolf_pelt', qty: [2, 4] },
  ] },
  // the cave: iron-grade gear and ore only. The mithril set is smithed, never dropped; the Warden's shards (smithed into a blade) are the one rare chase.
  ravager: { rolls: 1, nothing: 40, entries: [
    { id: 'wolf_pelt', qty: [1, 3] }, { id: 'iron_helm' }, { id: 'iron_greaves' }, { id: 'steel_sword', weight: 2 },
  ] },
  archer: { rolls: 1, nothing: 35, entries: [{ id: 'iron_helm' }, { id: 'iron_greaves' }, { id: 'iron_sword' }] },
  seer: { rolls: 1, nothing: 35, entries: [{ id: 'iron_chestplate' }, { id: 'iron_helm' }, { id: 'steel_sword', weight: 2 }] },
  ogre: { rolls: 2, nothing: 30, entries: [
    { id: 'mithril_ore', qty: [1, 2], weight: 20 }, { id: 'iron_chestplate' }, { id: 'steel_sword', weight: 3 },
  ] },
  warden: { rolls: 2, nothing: 48, entries: [
    { id: 'mithril_ore', qty: [2, 4], weight: 30 }, { id: 'warden_shard', qty: [1, 2], weight: 36 }, { id: 'iron_chestplate', weight: 10 },
  ] },
};

export interface DerivedStats {
  weaponDamage: number; // flat, added to direct-hit base damage
  armor: number;
  reduction: number;    // fraction of incoming damage removed, 0..MAX_REDUCTION
  swingInterval: number; // seconds between auto-attack swings: the weapon's speed, or BARE_SWING bare-handed
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
  let weaponDamage = 0, armor = 0, swingInterval = BARE_SWING;
  for (const slot of EQUIP_SLOTS) {
    const id = equipment[slot];
    const st = id ? ITEMS[id]?.stats : undefined;
    if (!st) continue;
    weaponDamage += st.damage ?? 0;
    armor += st.armor ?? 0;
    if (st.speed) swingInterval = st.speed;
  }
  return { weaponDamage, armor, reduction: Math.min(MAX_REDUCTION, armor / (armor + ARMOR_K)), swingInterval };
}

/** Human-readable stat lines for tooltips. */
export function describeStats(def: ItemDef): string[] {
  const out: string[] = [];
  if (def.stats?.damage) out.push(`+${def.stats.damage} weapon damage`);
  if (def.stats?.speed) out.push(`${def.stats.speed.toFixed(1)}s swing`);
  if (def.stats?.armor) out.push(`+${def.stats.armor} armour`);
  return out;
}
