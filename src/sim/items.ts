// Item data, drop tables and the single derived-stat function. Pure data + math: no DOM/Three.
import { BARE_SWING } from './data';
import { FISH, SEA_SALT, cookedId, pieId } from './fish';
import { HERBS, POTION_PREMIUM, VIAL, VIAL_VALUE } from './herbs';

export type EquipSlot = 'weapon' | 'head' | 'chest' | 'legs';
export const EQUIP_SLOTS: EquipSlot[] = ['weapon', 'head', 'chest', 'legs'];

export interface ItemStats {
  damage?: number; // weapon: flat damage added to every direct hit (before level power)
  speed?: number;  // weapon: seconds between auto-attack swings (default BARE_SWING); sets the rhythm, not the damage per second
  armor?: number;  // armour: contributes to incoming damage reduction
}

/**
 * What using an item does (sim/consumables.ts). `food`: a 5-second heal over time that a hit breaks, on the one shared food cooldown.
 * `buff`: a timed effect from BUFFS, taken on use; food that carries one is a meal and needs a quiet moment.
 */
export interface ItemUse { heal?: number; food?: boolean; buff?: string }

export interface ItemDef {
  name: string;
  slot?: EquipSlot;   // present = equippable
  stats?: ItemStats;
  stack: number;      // max per inventory slot (1 = unstackable)
  dropWeight: number; // default weight in any drop table that lists it
  value: number;      // base sell price in gold: what the vendor pays for one. Never an input to a recipe's profit: see the no-arbitrage test
  tier: number;       // 0 material, 1 common, 2 good, 3 rare, 4 epic, 5 legendary: drives ground/tooltip colour and the worn look (gear-look.ts)
  /** What it takes to put it on. Absent on everything before adamant, so no old save is affected; the equip action reads it. */
  req?: { combat?: number };
  /** Present = it can be used (eaten, drunk) from the bag. `heal` is a share of max HP. */
  use?: ItemUse;
  desc: string;
}

/** Each fish's raw, cooked and pie rows (fish.ts has the numbers). A dish is worth half again its fish, a pie twice a dish. */
const fishItems = (): Record<string, ItemDef> => Object.fromEntries(FISH.flatMap(f => {
  const cooked = Math.round(f.value * 1.5);
  return [
    [f.id, { name: f.name, stack: 50, dropWeight: 0, tier: 0, value: f.value, desc: 'Fresh from the water. Cook it at a range.' }],
    [cookedId(f), { name: `Cooked ${f.name}`, stack: 20, dropWeight: 0, tier: 1, value: cooked, use: { food: true, heal: f.heal },
      desc: 'Heals over 5 seconds. Being hit spoils it, and every food shares a 20 second cooldown.' }],
    [pieId(f), { name: `${f.name} Pie`, stack: 20, dropWeight: 0, tier: 2, value: cooked * 2, use: { food: true, heal: f.heal, buff: 'well_fed' },
      desc: 'Heals over 5 seconds, and leaves you Well Fed: +10% max health for 20 minutes, lost on death. Needs a quiet moment: not in combat.' }],
  ] as [string, ItemDef][];
}));

/** Each herb's raw and potion rows, and the vial (herbs.ts has the numbers). */
const herbItems = (): Record<string, ItemDef> => ({
  [VIAL]: { name: 'Empty Vial', stack: 50, dropWeight: 0, tier: 0, value: VIAL_VALUE, desc: 'Thornwick\'s provisioner sells them. A potion is poured into one at the alembic.' },
  ...Object.fromEntries(HERBS.flatMap(h => [
    [h.id, { name: h.name, stack: 50, dropWeight: 0, tier: 0, value: h.value, desc: 'Picked from a patch. Brew it with a vial at the alembic in Thornwick.' }],
    [h.potion.id, { name: h.potion.name, stack: 20, dropWeight: 0, tier: 1, value: h.value + POTION_PREMIUM, desc: `Brewed from ${h.name}. Its effect is still to come.` }],
  ] as [string, ItemDef][])),
});

export const ITEMS: Record<string, ItemDef> = {
  // materials (M3 smithing uses iron_ore + coal; they come from mining nodes, not drops)
  boar_hide: { name: 'Boar Hide', stack: 50, dropWeight: 40, tier: 0, value: 2, desc: 'Coarse hide. Crafting material.' },
  wolf_pelt: { name: 'Wolf Pelt', stack: 50, dropWeight: 40, tier: 0, value: 3, desc: 'Thick grey fur. Crafting material.' },
  copper_ore: { name: 'Copper Ore', stack: 50, dropWeight: 0, tier: 0, value: 3, desc: 'Soft red ore from the clearing. Smelted with tin it makes bronze.' },
  tin_ore: { name: 'Tin Ore', stack: 50, dropWeight: 0, tier: 0, value: 5, desc: 'Pale, soft ore. On its own it is nothing: smelted with copper it makes bronze.' },
  bronze_bar: { name: 'Bronze Bar', stack: 50, dropWeight: 0, tier: 0, value: 12, desc: 'Copper and tin, smelted together. The first metal a smith can shape into armour.' },
  iron_ore: { name: 'Iron Ore', stack: 50, dropWeight: 0, tier: 0, value: 3, desc: 'Smelts into iron at the forge.' },
  coal: { name: 'Coal', stack: 50, dropWeight: 0, tier: 0, value: 4, desc: 'Fuel for the forge.' },
  logs: { name: 'Logs', stack: 50, dropWeight: 0, tier: 0, value: 2, desc: 'Seasoned wood. Makes a good hilt.' },
  iron_bar: { name: 'Iron Bar', stack: 50, dropWeight: 0, tier: 0, value: 8, desc: 'Smelted at the forge.' },
  steel_bar: { name: 'Steel Bar', stack: 50, dropWeight: 0, tier: 0, value: 22, desc: 'Iron hardened with coal.' },
  mithril_ore: { name: 'Mithril Ore', stack: 50, dropWeight: 0, tier: 0, value: 10, desc: 'Blue-veined ore from deep in the cave. Smelts into mithril at the forge.' },
  warden_shard: { name: 'Warden Shard', stack: 50, dropWeight: 0, tier: 0, value: 40, desc: 'A splinter of the Hollow Warden. Forged with mithril, it makes a blade nothing else can.' },
  marrow_shard: { name: 'Marrow Shard', stack: 50, dropWeight: 0, tier: 0, value: 60, desc: "A barnacled splinter of Captain Marrow's anchor. Forged with adamant, it makes a blade nothing at the forge can." },
  heartwood_shard: { name: 'Heartwood Shard', stack: 50, dropWeight: 0, tier: 0, value: 80, desc: "A hard, red splinter of the Rotroot Mother's heartwood. Forged with adamant, it makes a blade nothing at the forge can." },
  mithril_bar: { name: 'Mithril Bar', stack: 50, dropWeight: 0, tier: 0, value: 30, desc: 'Light, cold and harder than steel. Armour is smithed from it.' },
  adamant_ore: { name: 'Adamant Ore', stack: 50, dropWeight: 0, tier: 0, value: 19, desc: 'Green-black ore from the cliffs above the Strand. Smelts into adamant at the forge.' },
  adamant_bar: { name: 'Adamant Bar', stack: 50, dropWeight: 0, tier: 0, value: 55, desc: 'Dense and sea-dark. Armour and a blade are smithed from it.' },
  [SEA_SALT]: { name: 'Sea Salt', stack: 50, dropWeight: 0, tier: 0, value: 2, desc: 'Coarse grey salt from the Saltmarrow pans. A pie wants a pinch.' },
  ...fishItems(),
  ...herbItems(),
  // weapons
  // the bronze set (HOM-56): the first armour and blade a new character can smith, a step above hide and below the iron the enemies drop
  bronze_sword: { name: 'Bronze Sword', slot: 'weapon', stats: { damage: 3, speed: 2.3 }, stack: 1, dropWeight: 0, tier: 1, value: 20, desc: 'Cast at the forge from your first bars. Better than a rusty blade, not yet iron.' },
  rusty_blade: { name: 'Rusty Blade', slot: 'weapon', stats: { damage: 2, speed: 2.2 }, stack: 1, dropWeight: 10, tier: 1, value: 6, desc: 'Better than bare hands.' },
  iron_sword: { name: 'Iron Sword', slot: 'weapon', stats: { damage: 5, speed: 2.4 }, stack: 1, dropWeight: 6, tier: 2, value: 30, desc: 'A reliable soldier\'s sword.' },
  steel_sword: { name: 'Steel Sword', slot: 'weapon', stats: { damage: 9, speed: 2.2 }, stack: 1, dropWeight: 3, tier: 3, value: 90, desc: 'Keen, balanced, rare.' },
  forged_blade: { name: "Forgemaster's Blade", slot: 'weapon', stats: { damage: 18, speed: 2.0 }, stack: 1, dropWeight: 0, tier: 3, value: 120, desc: 'Steel you smelted and shaped yourself. Better than anything the enemies carry.' },
  // smithed from Warden shards (the Warden's rare drop), so it is something the player made: the crafted weapon stays the best one
  warden_edge: { name: "Warden's Edge", slot: 'weapon', stats: { damage: 28, speed: 2.0 }, stack: 1, dropWeight: 0, tier: 4, value: 400, desc: 'Mithril folded around a shard of the Hollow Warden. Nothing else you can carry cuts like it.' },
  // the adamant set (docs/world-design.md 3.3): tier 5, and the first gear that asks for a combat level
  adamant_blade: { name: 'Adamant Blade', slot: 'weapon', stats: { damage: 40, speed: 2.0 }, stack: 1, dropWeight: 0, tier: 5, value: 320, req: { combat: 14 }, desc: "Three bars of adamant, a log for the hilt. A step above the Warden's Edge." },
  // the adamant capstone (3.3): three adamant bars folded round three Marrow shards. Damage 50 against the Adamant Blade's 40; it asks for combat 18, two under the player who is on schedule
  marrows_edge: { name: "Marrow's Edge", slot: 'weapon', stats: { damage: 50, speed: 2.0 }, stack: 1, dropWeight: 0, tier: 5, value: 560, req: { combat: 18 }, desc: "Adamant folded round three shards of Captain Marrow's anchor. The best blade a smith in Saltmarrow can make." },
  // the Rotroot's capstone (3.3): damage 72, Smithing 42, equip combat 26 (one under the Mother's level; the committed player arrives at 27). Stormiron is not built yet: adamant stands in for its bars
  rotroot_edge: { name: 'Rotroot Edge', slot: 'weapon', stats: { damage: 72, speed: 2.0 }, stack: 1, dropWeight: 0, tier: 5, value: 760, req: { combat: 26 }, desc: "Metal folded round three shards of the Rotroot Mother's heartwood. The best blade a smith in Thornwick can make." },
  // armour
  leather_cap: { name: 'Leather Cap', slot: 'head', stats: { armor: 2 }, stack: 1, dropWeight: 10, tier: 1, value: 5, desc: 'Stitched hide.' },
  hide_jerkin: { name: 'Hide Jerkin', slot: 'chest', stats: { armor: 4 }, stack: 1, dropWeight: 8, tier: 1, value: 10, desc: 'Stitched hide.' },
  hide_leggings: { name: 'Hide Leggings', slot: 'legs', stats: { armor: 3 }, stack: 1, dropWeight: 10, tier: 1, value: 8, desc: 'Stitched hide.' },
  bronze_helm: { name: 'Bronze Helm', slot: 'head', stats: { armor: 3 }, stack: 1, dropWeight: 0, tier: 1, value: 14, desc: 'Smithed from copper and tin.' },
  bronze_chestplate: { name: 'Bronze Chestplate', slot: 'chest', stats: { armor: 6 }, stack: 1, dropWeight: 0, tier: 1, value: 28, desc: 'Smithed from copper and tin. Dull, soft and better than hide.' },
  bronze_greaves: { name: 'Bronze Greaves', slot: 'legs', stats: { armor: 4 }, stack: 1, dropWeight: 0, tier: 1, value: 20, desc: 'Smithed from copper and tin.' },
  iron_helm: { name: 'Iron Helm', slot: 'head', stats: { armor: 5 }, stack: 1, dropWeight: 5, tier: 2, value: 25, desc: 'Dented but solid.' },
  iron_chestplate: { name: 'Iron Chestplate', slot: 'chest', stats: { armor: 9 }, stack: 1, dropWeight: 4, tier: 2, value: 45, desc: 'Heavy and protective.' },
  iron_greaves: { name: 'Iron Greaves', slot: 'legs', stats: { armor: 6 }, stack: 1, dropWeight: 5, tier: 2, value: 30, desc: 'Heavy and protective.' },
  // the smithable set: the cave's enemies are tuned against it, and it is the top rung of the worn-gear ladder (tier 4)
  mithril_helm: { name: 'Mithril Helm', slot: 'head', stats: { armor: 12 }, stack: 1, dropWeight: 0, tier: 4, value: 90, desc: "Smithed from cave mithril. The Hollow's arrows turn on it." },
  mithril_chestplate: { name: 'Mithril Chestplate', slot: 'chest', stats: { armor: 22 }, stack: 1, dropWeight: 0, tier: 4, value: 190, desc: 'Smithed from cave mithril. Light enough to dodge in.' },
  mithril_greaves: { name: 'Mithril Greaves', slot: 'legs', stats: { armor: 16 }, stack: 1, dropWeight: 0, tier: 4, value: 140, desc: 'Smithed from cave mithril.' },
  adamant_helm: { name: 'Adamant Helm', slot: 'head', stats: { armor: 16 }, stack: 1, dropWeight: 0, tier: 5, value: 170, req: { combat: 14 }, desc: 'Smithed from Strand adamant.' },
  adamant_chestplate: { name: 'Adamant Chestplate', slot: 'chest', stats: { armor: 30 }, stack: 1, dropWeight: 0, tier: 5, value: 350, req: { combat: 14 }, desc: 'Smithed from Strand adamant. Heavy, and worth the weight.' },
  adamant_greaves: { name: 'Adamant Greaves', slot: 'legs', stats: { armor: 22 }, stack: 1, dropWeight: 0, tier: 5, value: 260, req: { combat: 14 }, desc: 'Smithed from Strand adamant.' },
};

/** The bronze set, in smithing order: the sword, then the plate. */
export const BRONZE_SET = ['bronze_sword', 'bronze_helm', 'bronze_greaves', 'bronze_chestplate'] as const;

/** The smithable set, in smithing order. Quests and verify read it from here. */
export const MITHRIL_SET = ['mithril_helm', 'mithril_greaves', 'mithril_chestplate'] as const;

/** The adamant set, in smithing order. */
export const ADAMANT_SET = ['adamant_helm', 'adamant_greaves', 'adamant_chestplate'] as const;

export const TIER_COLORS = [0xc8c8c8, 0xe8e8e8, 0x4aa8ff, 0xffa030, 0xb48cff, 0x3ee0c0]; // material, common, good, rare, epic, legendary (spectral jade; art's TIER5_COLOR in gear-look.ts)

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
    { id: 'mithril_ore', qty: [2, 4], weight: 30 }, { id: 'warden_shard', qty: [1, 2], weight: 50 }, { id: 'iron_chestplate', weight: 10 },
  ] },
  // the road and the Strand: hides and dropped iron-grade gear, nothing a recipe eats. The bible's rule (3.4) is an expected sale value of
  // 0.6 x level + 3 gold a kill (an elite 3x, a rare 4x); `nothing` is solved so each table lands on it, which is why so many rolls come up empty.
  marsh_hog: { rolls: 2, nothing: 38, entries: [
    { id: 'boar_hide', qty: [1, 3], weight: 40 }, { id: 'hide_jerkin', weight: 8 }, { id: 'rusty_blade' }, { id: 'leather_cap' }, { id: 'hide_leggings' }, { id: 'iron_sword', weight: 2 }, { id: 'iron_helm', weight: 2 },
  ] },
  road_wolf: { rolls: 2, nothing: 71, entries: [
    { id: 'wolf_pelt', qty: [1, 3], weight: 40 }, { id: 'hide_jerkin', weight: 8 }, { id: 'leather_cap' }, { id: 'hide_leggings' }, { id: 'iron_sword', weight: 2 }, { id: 'iron_chestplate', weight: 2 }, { id: 'steel_sword', weight: 1 },
  ] },
  footpad: { rolls: 2, nothing: 77, entries: [
    { id: 'leather_cap' }, { id: 'hide_leggings' }, { id: 'rusty_blade' }, { id: 'hide_jerkin', weight: 8 }, { id: 'iron_sword', weight: 4 }, { id: 'iron_helm', weight: 3 }, { id: 'iron_greaves', weight: 3 }, { id: 'steel_sword', weight: 1 },
  ] },
  toll_captain: { rolls: 3, nothing: 64, entries: [
    { id: 'wolf_pelt', qty: [2, 4], weight: 20 }, { id: 'iron_helm', weight: 6 }, { id: 'iron_greaves', weight: 6 }, { id: 'iron_sword', weight: 6 }, { id: 'iron_chestplate', weight: 5 }, { id: 'steel_sword', weight: 3 },
  ] },
  old_grey: { rolls: 3, nothing: 52, entries: [
    { id: 'wolf_pelt', qty: [3, 5], weight: 20 }, { id: 'iron_helm', weight: 6 }, { id: 'iron_chestplate', weight: 6 }, { id: 'iron_sword', weight: 6 }, { id: 'steel_sword', weight: 5 },
  ] },
  shore_crab: { rolls: 2, nothing: 31, entries: [
    { id: 'boar_hide', qty: [1, 3], weight: 30 }, { id: 'hide_jerkin', weight: 8 }, { id: 'hide_leggings' }, { id: 'leather_cap' }, { id: 'iron_sword', weight: 3 }, { id: 'iron_helm', weight: 3 }, { id: 'iron_greaves', weight: 2 },
  ] },
  drowned_sailor: { rolls: 2, nothing: 73, entries: [
    { id: 'hide_jerkin', weight: 8 }, { id: 'hide_leggings' }, { id: 'rusty_blade' }, { id: 'iron_sword', weight: 4 }, { id: 'iron_helm', weight: 3 }, { id: 'iron_greaves', weight: 3 }, { id: 'iron_chestplate', weight: 2 }, { id: 'steel_sword', weight: 1 },
  ] },
  tide_hag: { rolls: 2, nothing: 83, entries: [
    { id: 'hide_jerkin', weight: 8 }, { id: 'leather_cap' }, { id: 'iron_sword', weight: 4 }, { id: 'iron_helm', weight: 3 }, { id: 'iron_greaves', weight: 3 }, { id: 'iron_chestplate', weight: 3 }, { id: 'steel_sword', weight: 2 },
  ] },
  barnacle_ogre: { rolls: 3, nothing: 52, entries: [
    { id: 'wolf_pelt', qty: [2, 4], weight: 15 }, { id: 'iron_helm', weight: 6 }, { id: 'iron_greaves', weight: 6 }, { id: 'iron_chestplate', weight: 6 }, { id: 'steel_sword', weight: 5 },
  ] },
  gutterhook: { rolls: 3, nothing: 45, entries: [
    { id: 'wolf_pelt', qty: [3, 5], weight: 15 }, { id: 'iron_greaves', weight: 6 }, { id: 'iron_chestplate', weight: 6 }, { id: 'steel_sword', weight: 8 },
  ] },
  // the fens and the Thornwood, the same rule: each table's `nothing` is solved to land within 1 % of 0.6 x level + 3 (an elite 3x, a rare 4x). No new gear tier is
  // dropped above steel, so these are the road's tables with the odds moved.
  fen_stalker: { rolls: 2, nothing: 34, entries: [
    { id: 'wolf_pelt', qty: [1, 3], weight: 40 }, { id: 'hide_jerkin', weight: 8 }, { id: 'leather_cap' }, { id: 'hide_leggings' }, { id: 'iron_sword', weight: 4 }, { id: 'iron_chestplate', weight: 2 }, { id: 'steel_sword', weight: 1 },
  ] },
  bog_witch: { rolls: 2, nothing: 68, entries: [
    { id: 'hide_jerkin', weight: 8 }, { id: 'leather_cap' }, { id: 'iron_sword', weight: 4 }, { id: 'iron_helm', weight: 3 }, { id: 'iron_greaves', weight: 3 }, { id: 'iron_chestplate', weight: 3 }, { id: 'steel_sword', weight: 2 },
  ] },
  mire_troll: { rolls: 2, nothing: 77, entries: [
    { id: 'wolf_pelt', qty: [1, 3], weight: 20 }, { id: 'iron_helm', weight: 5 }, { id: 'iron_greaves', weight: 5 }, { id: 'iron_sword', weight: 4 }, { id: 'iron_chestplate', weight: 4 }, { id: 'steel_sword', weight: 2 },
  ] },
  bogfather: { rolls: 3, nothing: 43, entries: [
    { id: 'wolf_pelt', qty: [2, 4], weight: 15 }, { id: 'iron_helm', weight: 6 }, { id: 'iron_greaves', weight: 6 }, { id: 'iron_chestplate', weight: 6 }, { id: 'steel_sword', weight: 6 },
  ] },
  mother_mire: { rolls: 3, nothing: 40, entries: [
    { id: 'wolf_pelt', qty: [3, 5], weight: 15 }, { id: 'iron_chestplate', weight: 6 }, { id: 'iron_greaves', weight: 6 }, { id: 'steel_sword', weight: 10 },
  ] },
  thornback: { rolls: 2, nothing: 31, entries: [
    { id: 'boar_hide', qty: [1, 3], weight: 30 }, { id: 'hide_jerkin', weight: 8 }, { id: 'iron_sword', weight: 3 }, { id: 'iron_helm', weight: 3 }, { id: 'iron_greaves', weight: 3 }, { id: 'iron_chestplate', weight: 2 }, { id: 'steel_sword', weight: 1 },
  ] },
  blight_stag: { rolls: 2, nothing: 53, entries: [
    { id: 'wolf_pelt', qty: [1, 3], weight: 30 }, { id: 'hide_jerkin', weight: 8 }, { id: 'iron_sword', weight: 4 }, { id: 'iron_helm', weight: 3 }, { id: 'iron_greaves', weight: 3 }, { id: 'iron_chestplate', weight: 3 }, { id: 'steel_sword', weight: 2 },
  ] },
  rotwood_cultist: { rolls: 2, nothing: 63, entries: [
    { id: 'hide_jerkin', weight: 8 }, { id: 'iron_sword', weight: 4 }, { id: 'iron_helm', weight: 4 }, { id: 'iron_greaves', weight: 4 }, { id: 'iron_chestplate', weight: 3 }, { id: 'steel_sword', weight: 2 },
  ] },
  thorn_warden: { rolls: 3, nothing: 38, entries: [
    { id: 'wolf_pelt', qty: [2, 4], weight: 15 }, { id: 'iron_helm', weight: 6 }, { id: 'iron_chestplate', weight: 6 }, { id: 'iron_greaves', weight: 6 }, { id: 'steel_sword', weight: 7 },
  ] },
  elder_thornback: { rolls: 3, nothing: 25, entries: [
    { id: 'boar_hide', qty: [3, 5], weight: 20 }, { id: 'iron_chestplate', weight: 6 }, { id: 'iron_sword', weight: 6 }, { id: 'steel_sword', weight: 10 },
  ] },
  // the Grotto's boss shard (6.1): 35 % a kill, one shard, three to a blade: about nine kills on a ten-minute respawn. The one roll, so nothing else competes with it.
  captain_marrow: { rolls: 1, nothing: 65, entries: [{ id: 'marrow_shard', weight: 35 }] },
  // the Rotroot's: the same 35 % roll (6.1). The blade it is for waits on stormiron.
  rotroot_mother: { rolls: 1, nothing: 65, entries: [{ id: 'heartwood_shard', weight: 35 }] },
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
/** Durability points left, by item id. Absent means whole (MAX_DURABILITY): only a piece that has been worn down has an entry, so an old save needs none. */
export type Durability = Record<string, number>;

/**
 * THE derived-stat calculation. Combat reads only this; M3's smithed weapon is just another
 * ITEMS entry equipped in the weapon slot. A broken piece (`durability` at 0) is worn but gives nothing.
 */
export function deriveStats(equipment: Equipment, durability: Durability = {}): DerivedStats {
  let weaponDamage = 0, armor = 0, swingInterval = BARE_SWING;
  for (const slot of EQUIP_SLOTS) {
    const id = equipment[slot];
    const st = id && durability[id] !== 0 ? ITEMS[id]?.stats : undefined;
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
  if (def.req?.combat) out.push(`Requires Combat ${def.req.combat}`);
  if (def.use?.heal) out.push(`Heals ${Math.round(def.use.heal * 100)}% of max health`);
  return out;
}
