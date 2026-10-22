// Item data, drop tables and the single derived-stat function. Pure data + math: no DOM/Three.
import { BARE_SWING } from './data';
import { FISH, SEA_SALT, cookedId, pieId } from './fish';
import { HERBS, POTION_PREMIUM, VIAL, VIAL_VALUE } from './herbs';
import { Enchants, enchantFx } from './enchants';

export type EquipSlot = 'weapon' | 'head' | 'chest' | 'legs' | 'hands' | 'feet' | 'offhand';
// `hands` and `feet` are the leatherworker's: the smith makes the other four (bible 3.2). `offhand` is the free hand (HOM-148): nothing
// is smithed for it and nothing it holds fights, so it never competes with the blade.
export const EQUIP_SLOTS: EquipSlot[] = ['weapon', 'head', 'chest', 'legs', 'hands', 'feet', 'offhand'];

export interface ItemStats {
  damage?: number; // weapon: flat damage added to every direct hit (before level power)
  speed?: number;  // weapon: seconds between auto-attack swings (default BARE_SWING); sets the rhythm, not the damage per second
  armor?: number;  // armour: contributes to incoming damage reduction
  light?: number;  // a carried light: how far it reaches, world units. The renderer hangs a flame on the player and brightens the cave by it
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

/** How far a lit torch reaches, world units. Wider than the cave's own lantern (render.ts CAVE_LIGHT), which is what carrying one is for. */
export const TORCH_REACH = 26;

export const ITEMS: Record<string, ItemDef> = {
  // materials (M3 smithing uses iron_ore + coal; they come from mining nodes, not drops)
  // the hides (HOM-102, HOM-107): a vendor pays a few gold for one and the tanning rack in Highmoor turns it into the gear's leather, so each one says where it goes
  boar_hide: { name: 'Boar Hide', stack: 50, dropWeight: 40, tier: 0, value: 2, desc: "Coarse hide. Highmoor's tanning rack will want this: keep it, a vendor pays next to nothing." },
  wolf_pelt: { name: 'Wolf Pelt', stack: 50, dropWeight: 40, tier: 0, value: 3, desc: "Thick grey fur. Highmoor's tanning rack will want this: keep it, a vendor pays next to nothing." },
  marsh_hide: { name: 'Marsh Hide', stack: 50, dropWeight: 0, tier: 0, value: 4, desc: "Slick, dark hide off the Strand's and the Fens' beasts. Highmoor's tanning rack will want this: keep it, a vendor pays next to nothing." },
  thorn_hide: { name: 'Thorn Hide', stack: 50, dropWeight: 0, tier: 0, value: 5, desc: "Tough, barbed hide off the Thornwood's and the Barrowdowns' beasts. Highmoor's tanning rack will want this: keep it, a vendor pays next to nothing." },
  moor_hide: { name: 'Moor Hide', stack: 50, dropWeight: 0, tier: 0, value: 6, desc: "Heavy, weathered hide off the Moor's beasts. Highmoor's tanning rack will want this: keep it, a vendor pays next to nothing." },
  copper_ore: { name: 'Copper Ore', stack: 50, dropWeight: 0, tier: 0, value: 3, desc: 'Soft red ore from the clearing. Smelted on its own it makes copper; with tin it makes bronze.' },
  copper_bar: { name: 'Copper Bar', stack: 50, dropWeight: 0, tier: 0, value: 7, desc: 'Two ore, smelted on their own. Soft, but it is the one metal Hale can make without leaving.' },
  tin_ore: { name: 'Tin Ore', stack: 50, dropWeight: 0, tier: 0, value: 5, desc: 'Pale, soft ore. On its own it is nothing: smelted with copper it makes bronze.' },
  bronze_bar: { name: 'Bronze Bar', stack: 50, dropWeight: 0, tier: 0, value: 12, desc: 'Copper and tin, smelted together. The first metal a smith can shape into armour.' },
  iron_ore: { name: 'Iron Ore', stack: 50, dropWeight: 0, tier: 0, value: 3, desc: 'Smelts into iron at the forge.' },
  coal: { name: 'Coal', stack: 50, dropWeight: 0, tier: 0, value: 4, desc: 'Fuel for the forge.' },
  logs: { name: 'Logs', stack: 50, dropWeight: 0, tier: 0, value: 2, desc: 'Seasoned wood. Makes a good hilt.' },
  iron_bar: { name: 'Iron Bar', stack: 50, dropWeight: 0, tier: 0, value: 8, desc: 'Smelted at the forge.' },
  steel_bar: { name: 'Steel Bar', stack: 50, dropWeight: 0, tier: 0, value: 22, desc: 'Iron hardened with coal.' },
  warden_shard: { name: 'Warden Shard', stack: 50, dropWeight: 0, tier: 0, value: 40, desc: 'A splinter of the Hollow Warden. Forged with steel, it makes a blade nothing else can.' },
  marrow_shard: { name: 'Marrow Shard', stack: 50, dropWeight: 0, tier: 0, value: 60, desc: "A barnacled splinter of Captain Marrow's anchor. Forged with adamant, it makes a blade nothing at the forge can." },
  heartwood_shard: { name: 'Heartwood Shard', stack: 50, dropWeight: 0, tier: 0, value: 80, desc: "A hard, red splinter of the Rotroot Mother's heartwood. Forged with adamant, it makes a blade nothing at the forge can." },
  adamant_ore: { name: 'Adamant Ore', stack: 50, dropWeight: 0, tier: 0, value: 19, desc: 'Green-black ore from the cliffs above the Strand. Smelts into adamant at the forge.' },
  adamant_bar: { name: 'Adamant Bar', stack: 50, dropWeight: 0, tier: 0, value: 55, desc: 'Dense and sea-dark. Armour and a blade are smithed from it.' },
  stormiron_ore: { name: 'Stormiron Ore', stack: 50, dropWeight: 0, tier: 0, value: 32, desc: 'Pale, lilac-veined ore from the barrows and the Thornwood. It smelts into stormiron with four parts coal.' },
  stormiron_bar: { name: 'Stormiron Bar', stack: 50, dropWeight: 0, tier: 0, value: 90, desc: 'Cold, light and pale as slate. Armour and a blade are smithed from it.' },
  starmetal_ore: { name: 'Starmetal Ore', stack: 50, dropWeight: 0, tier: 0, value: 52, desc: 'Black, heavy ore flecked with cold white light, from the stands along the Cairnwaste road. It smelts into starmetal with five parts coal, at the Spire\'s forge.' },
  starmetal_bar: { name: 'Starmetal Bar', stack: 50, dropWeight: 0, tier: 0, value: 140, desc: 'Indigo-black and very cold. The last metal there is: armour and a blade are smithed from it.' },
  crown_shard: { name: 'Crown Shard', stack: 50, dropWeight: 0, tier: 0, value: 100, desc: "A splinter of the Cairn King's crown, grey and cold. Folded round starmetal, it makes a blade nothing else at the forge can." },
  // enchanting (bible 2.2, HOM-112): what a piece of gear is worth ground down at the Spire's rune circle (sim/enchanting.ts), and what a slot enchant is paid for in. Archmage Vael drops it by the handful
  arcane_dust: { name: 'Arcane Dust', stack: 500, dropWeight: 0, tier: 0, value: 2, desc: "Cold, faintly glowing grit. Gear ground down at the Spire's rune circle leaves it, and a slot enchant is paid for with it." },
  [SEA_SALT]: { name: 'Sea Salt', stack: 50, dropWeight: 0, tier: 0, value: 2, desc: 'Coarse grey salt from the Saltmarrow pans. A pie wants a pinch.' },
  ...fishItems(),
  ...herbItems(),
  // weapons
  // the copper set (HOM-81): the bottom rung, smithed from the one rock Hale has, so a new character can make gear before they leave town.
  // Soft and light: it swings quicker than a rusty blade and bites less, and every piece is a shade under its bronze counterpart.
  copper_sword: { name: 'Copper Sword', slot: 'weapon', stats: { damage: 2, speed: 2.1 }, stack: 1, dropWeight: 0, tier: 1, value: 12, desc: 'Your first bars, beaten into an edge. Light and quick; it will not hold a point for long.' },
  // the bronze set (HOM-56): the first armour and blade a new character can smith, a step above hide and below the iron the enemies drop
  bronze_sword: { name: 'Bronze Sword', slot: 'weapon', stats: { damage: 3, speed: 2.3 }, stack: 1, dropWeight: 0, tier: 1, value: 20, desc: 'Cast at the forge from your first bars. Better than a rusty blade, not yet iron.' },
  rusty_blade: { name: 'Rusty Blade', slot: 'weapon', stats: { damage: 2, speed: 2.2 }, stack: 1, dropWeight: 10, tier: 1, value: 6, desc: 'Better than bare hands.' },
  iron_sword: { name: 'Iron Sword', slot: 'weapon', stats: { damage: 5, speed: 2.4 }, stack: 1, dropWeight: 6, tier: 2, value: 30, desc: 'A reliable soldier\'s sword.' },
  steel_sword: { name: 'Steel Sword', slot: 'weapon', stats: { damage: 9, speed: 2.2 }, stack: 1, dropWeight: 3, tier: 3, value: 90, desc: 'Keen, balanced, rare.' },
  forged_blade: { name: "Forgemaster's Blade", slot: 'weapon', stats: { damage: 18, speed: 2.0 }, stack: 1, dropWeight: 0, tier: 3, value: 120, desc: 'Steel you smelted and shaped yourself. Better than anything the enemies carry.' },
  // smithed from Warden shards (the Warden's rare drop), so it is something the player made: the crafted weapon stays the best one
  warden_edge: { name: "Warden's Edge", slot: 'weapon', stats: { damage: 28, speed: 2.0 }, stack: 1, dropWeight: 0, tier: 4, value: 400, desc: 'Steel folded around a shard of the Hollow Warden. Nothing else you can carry cuts like it.' },
  // the adamant set (docs/world-design.md 3.3): tier 5, and the first gear that asks for a combat level
  adamant_blade: { name: 'Adamant Blade', slot: 'weapon', stats: { damage: 40, speed: 2.0 }, stack: 1, dropWeight: 0, tier: 5, value: 320, req: { combat: 14 }, desc: "Three bars of adamant, a log for the hilt. A step above the Warden's Edge." },
  // the adamant capstone (3.3): three adamant bars folded round three Marrow shards. Damage 50 against the Adamant Blade's 40; it asks for combat 18, two under the player who is on schedule
  marrows_edge: { name: "Marrow's Edge", slot: 'weapon', stats: { damage: 50, speed: 2.0 }, stack: 1, dropWeight: 0, tier: 5, value: 560, req: { combat: 18 }, desc: "Adamant folded round three shards of Captain Marrow's anchor. The best blade a smith in Saltmarrow can make." },
  // the stormiron set (3.3): tier 5 again, the next metal after adamant. A blade of 58 against Marrow's Edge 50; equip combat 23, one under the committed player's arrival
  stormiron_blade: { name: 'Stormiron Blade', slot: 'weapon', stats: { damage: 58, speed: 2.0 }, stack: 1, dropWeight: 0, tier: 5, value: 480, req: { combat: 23 }, desc: 'Three bars of barrow stormiron and a log for the hilt. Narrow, pale and very sharp.' },
  // the Rotroot's capstone (3.3): damage 72, Smithing 42, equip combat 26 (one under the Mother's level; the committed player arrives at 27)
  rotroot_edge: { name: 'Rotroot Edge', slot: 'weapon', stats: { damage: 72, speed: 2.0 }, stack: 1, dropWeight: 0, tier: 5, value: 760, req: { combat: 26 }, desc: "Stormiron folded round three shards of the Rotroot Mother's heartwood. The best blade a smith in Thornwick can make." },
  // the starmetal set (3.3, HOM-111): tier 6, the end of the ladder. A blade of 80 against the Rotroot Edge's 72; equip combat 32, which is the Cairnwaste's first level and the committed player's step
  // (they arrive at 30: the requirement binds, as the bible says it should). Crownbreaker is the capstone: 100, three bars folded round three Crown shards, the Cairn King's.
  starmetal_blade: { name: 'Starmetal Blade', slot: 'weapon', stats: { damage: 80, speed: 2.0 }, stack: 1, dropWeight: 0, tier: 6, value: 700, req: { combat: 32 }, desc: 'Three bars of Cairnwaste starmetal and a log for the hilt. A long, black edge with a seam of white light along it.' },
  crownbreaker: { name: 'Crownbreaker', slot: 'weapon', stats: { damage: 100, speed: 2.0 }, stack: 1, dropWeight: 0, tier: 6, value: 1100, req: { combat: 32 }, desc: "Starmetal folded round three shards of the Cairn King's crown. The best blade a smith in the Spire can make, and the last." },
  // leatherworking (bible 3.2, HOM-96): hides tanned at Highmoor's rack, then gloves and boots. Nothing sells a hide: they are only ever dropped
  tanned_hide: { name: 'Tanned Hide', stack: 50, dropWeight: 0, tier: 0, value: 4, desc: 'A boar hide, cured at a tanning rack in Highmoor. Gloves and boots are made from it.' },
  wolf_leather: { name: 'Wolf Leather', stack: 50, dropWeight: 0, tier: 0, value: 6, desc: 'A wolf pelt, cured at a tanning rack in Highmoor. Thicker than boar leather.' },
  hide_gloves: { name: 'Hide Gloves', slot: 'hands', stats: { armor: 2 }, stack: 1, dropWeight: 0, tier: 1, value: 10, desc: 'Cut and stitched from boar leather.' },
  hide_boots: { name: 'Hide Boots', slot: 'feet', stats: { armor: 3 }, stack: 1, dropWeight: 0, tier: 1, value: 14, desc: 'Cut and stitched from boar leather.' },
  wolfskin_gloves: { name: 'Wolfskin Gloves', slot: 'hands', stats: { armor: 5 }, stack: 1, dropWeight: 0, tier: 2, value: 24, desc: 'Wolf leather, fur turned inward.' },
  wolfskin_boots: { name: 'Wolfskin Boots', slot: 'feet', stats: { armor: 7 }, stack: 1, dropWeight: 0, tier: 2, value: 34, desc: 'Wolf leather, fur turned inward.' },
  // the regional hides (HOM-102 2.2, HOM-107): the sets are cut from these, five hides a pair. A tanned hide is worth twice the raw one and a piece twice its leather. Equip combat 18, 24, 32:
  // the band each set belongs to, so a burst of tanning cannot hand a player Moorhide at combat 28
  marsh_leather: { name: 'Marsh Leather', stack: 50, dropWeight: 0, tier: 0, value: 8, desc: 'A marsh hide, cured at a tanning rack in Highmoor. Dark and slick, it sheds water.' },
  marshhide_gloves: { name: 'Marsh-hide Gloves', slot: 'hands', stats: { armor: 8 }, stack: 1, dropWeight: 0, tier: 3, value: 32, req: { combat: 18 }, desc: 'Marsh leather, cut close and sealed at the seams.' },
  marshhide_boots: { name: 'Marsh-hide Boots', slot: 'feet', stats: { armor: 10 }, stack: 1, dropWeight: 0, tier: 3, value: 48, req: { combat: 18 }, desc: 'Marsh leather, cut close and sealed at the seams.' },
  thorn_leather: { name: 'Thorn Leather', stack: 50, dropWeight: 0, tier: 0, value: 10, desc: 'A thorn hide, cured at a tanning rack in Highmoor. Stiff, and the barbs are still in it.' },
  thornhide_gloves: { name: 'Thornhide Gloves', slot: 'hands', stats: { armor: 11 }, stack: 1, dropWeight: 0, tier: 4, value: 40, req: { combat: 24 }, desc: 'Thorn leather, barbs turned outward.' },
  thornhide_boots: { name: 'Thornhide Boots', slot: 'feet', stats: { armor: 14 }, stack: 1, dropWeight: 0, tier: 4, value: 60, req: { combat: 24 }, desc: 'Thorn leather, barbs turned outward. Nothing in the Thornwood will bite through them.' },
  moor_leather: { name: 'Moor Leather', stack: 50, dropWeight: 0, tier: 0, value: 12, desc: 'A moor hide, cured at a tanning rack in Highmoor. Heavy, and slow to wear through.' },
  moorhide_gloves: { name: 'Moorhide Gloves', slot: 'hands', stats: { armor: 15 }, stack: 1, dropWeight: 0, tier: 5, value: 48, req: { combat: 32 }, desc: 'Moor leather, weathered grey-green and stiff as bark. The best gloves a leatherworker in Highmoor can make.' },
  moorhide_boots: { name: 'Moorhide Boots', slot: 'feet', stats: { armor: 18 }, stack: 1, dropWeight: 0, tier: 5, value: 72, req: { combat: 32 }, desc: 'Moor leather, weathered grey-green and stiff as bark. The best boots a leatherworker in Highmoor can make.' },
  // armour
  leather_cap: { name: 'Leather Cap', slot: 'head', stats: { armor: 2 }, stack: 1, dropWeight: 10, tier: 1, value: 5, desc: 'Stitched hide.' },
  hide_jerkin: { name: 'Hide Jerkin', slot: 'chest', stats: { armor: 4 }, stack: 1, dropWeight: 8, tier: 1, value: 10, desc: 'Stitched hide.' },
  hide_leggings: { name: 'Hide Leggings', slot: 'legs', stats: { armor: 3 }, stack: 1, dropWeight: 10, tier: 1, value: 8, desc: 'Stitched hide.' },
  copper_helm: { name: 'Copper Helm', slot: 'head', stats: { armor: 2 }, stack: 1, dropWeight: 0, tier: 1, value: 8, desc: 'Smithed from Hale\'s own copper.' },
  copper_chestplate: { name: 'Copper Chestplate', slot: 'chest', stats: { armor: 5 }, stack: 1, dropWeight: 0, tier: 1, value: 16, desc: 'Smithed from Hale\'s own copper. Soft, and still better than a stitched jerkin.' },
  copper_greaves: { name: 'Copper Greaves', slot: 'legs', stats: { armor: 3 }, stack: 1, dropWeight: 0, tier: 1, value: 12, desc: 'Smithed from Hale\'s own copper.' },
  bronze_helm: { name: 'Bronze Helm', slot: 'head', stats: { armor: 3 }, stack: 1, dropWeight: 0, tier: 1, value: 14, desc: 'Smithed from copper and tin.' },
  bronze_chestplate: { name: 'Bronze Chestplate', slot: 'chest', stats: { armor: 6 }, stack: 1, dropWeight: 0, tier: 1, value: 28, desc: 'Smithed from copper and tin. Dull, soft and better than hide.' },
  bronze_greaves: { name: 'Bronze Greaves', slot: 'legs', stats: { armor: 4 }, stack: 1, dropWeight: 0, tier: 1, value: 20, desc: 'Smithed from copper and tin.' },
  iron_helm: { name: 'Iron Helm', slot: 'head', stats: { armor: 5 }, stack: 1, dropWeight: 5, tier: 2, value: 25, desc: 'Dented but solid.' },
  iron_chestplate: { name: 'Iron Chestplate', slot: 'chest', stats: { armor: 9 }, stack: 1, dropWeight: 4, tier: 2, value: 45, desc: 'Heavy and protective.' },
  iron_greaves: { name: 'Iron Greaves', slot: 'legs', stats: { armor: 6 }, stack: 1, dropWeight: 5, tier: 2, value: 30, desc: 'Heavy and protective.' },
  // the smithable set (HOM-81): the cave's enemies are tuned against it, and it is the top rung of the worn-gear ladder (tier 4). The iron above is
  // what the dead were wearing; this is the same metal the Forgemaster's Blade is, hardened and beaten into plate, which is why it is worth so much more.
  steel_helm: { name: 'Steel Helm', slot: 'head', stats: { armor: 12 }, stack: 1, dropWeight: 0, tier: 4, value: 90, desc: "Hardened at your own forge. The Hollow's arrows turn on it." },
  steel_chestplate: { name: 'Steel Chestplate', slot: 'chest', stats: { armor: 22 }, stack: 1, dropWeight: 0, tier: 4, value: 190, desc: 'Hardened at your own forge. Plate where the dead gave you scrap.' },
  steel_greaves: { name: 'Steel Greaves', slot: 'legs', stats: { armor: 16 }, stack: 1, dropWeight: 0, tier: 4, value: 140, desc: 'Hardened at your own forge.' },
  adamant_helm: { name: 'Adamant Helm', slot: 'head', stats: { armor: 16 }, stack: 1, dropWeight: 0, tier: 5, value: 170, req: { combat: 14 }, desc: 'Smithed from Strand adamant.' },
  adamant_chestplate: { name: 'Adamant Chestplate', slot: 'chest', stats: { armor: 30 }, stack: 1, dropWeight: 0, tier: 5, value: 350, req: { combat: 14 }, desc: 'Smithed from Strand adamant. Heavy, and worth the weight.' },
  adamant_greaves: { name: 'Adamant Greaves', slot: 'legs', stats: { armor: 22 }, stack: 1, dropWeight: 0, tier: 5, value: 260, req: { combat: 14 }, desc: 'Smithed from Strand adamant.' },
  stormiron_helm: { name: 'Stormiron Helm', slot: 'head', stats: { armor: 20 }, stack: 1, dropWeight: 0, tier: 5, value: 230, req: { combat: 23 }, desc: 'Smithed from barrow stormiron. Swept-back spikes, and light for its worth.' },
  stormiron_chestplate: { name: 'Stormiron Chestplate', slot: 'chest', stats: { armor: 38 }, stack: 1, dropWeight: 0, tier: 5, value: 470, req: { combat: 23 }, desc: 'Smithed from barrow stormiron. Pale plate, and the best chest a smith in Thornwick can make.' },
  stormiron_greaves: { name: 'Stormiron Greaves', slot: 'legs', stats: { armor: 28 }, stack: 1, dropWeight: 0, tier: 5, value: 340, req: { combat: 23 }, desc: 'Smithed from barrow stormiron.' },
  starmetal_helm: { name: 'Starmetal Helm', slot: 'head', stats: { armor: 24 }, stack: 1, dropWeight: 0, tier: 6, value: 350, req: { combat: 32 }, desc: 'Smithed from Cairnwaste starmetal. A four-point star stands over the brow.' },
  starmetal_chestplate: { name: 'Starmetal Chestplate', slot: 'chest', stats: { armor: 44 }, stack: 1, dropWeight: 0, tier: 6, value: 690, req: { combat: 32 }, desc: 'Smithed from Cairnwaste starmetal. Black plate with a star on the back, and the best chest a smith in the Spire can make.' },
  starmetal_greaves: { name: 'Starmetal Greaves', slot: 'legs', stats: { armor: 32 }, stack: 1, dropWeight: 0, tier: 6, value: 510, req: { combat: 32 }, desc: 'Smithed from Cairnwaste starmetal. A seam of cold light runs down each shin.' },
  // the Cairn King's named piece (6.2): armour 24 as written, against the stormiron helm's 20. Tier 5, not the bible's 6: the ladder ends at 5 (TIER_COLORS, TIER_LOOKS), and a sixth rung is the
  // artist's, as is a bespoke look (it wears the tier-5 fallback). Sells for 4x the helm (6.1). Equip combat 30: the first level of the Hold's band, two under the King.
  kings_crown: { name: "The King's Crown", slot: 'head', stats: { armor: 24 }, stack: 1, dropWeight: 0, tier: 5, value: 920, req: { combat: 30 }, desc: "A circlet of grey iron, cold as the barrow it was buried in. The Cairn King wore it into the dark, and it still keeps the shape of his head." },
  // the off hand (HOM-148): the one thing made for it, and the only item in the game whose stat is light rather than damage or armour. TORCH_REACH is
  // what the renderer hangs on the player; a broken one gives nothing, like any other worn piece.
  torch: { name: 'Torch', slot: 'offhand', stats: { light: TORCH_REACH }, stack: 1, dropWeight: 0, tier: 1, value: 6, desc: 'Pitch-soaked rag on an ash stake. Held in your off hand it burns wherever you carry it, and a cave stops being pitch dark.' },
};

/** The copper set, in smithing order: the bottom rung, made from Hale's own rock. */
export const COPPER_SET = ['copper_sword', 'copper_helm', 'copper_greaves', 'copper_chestplate'] as const;

/** The bronze set, in smithing order: the sword, then the plate. */
export const BRONZE_SET = ['bronze_sword', 'bronze_helm', 'bronze_greaves', 'bronze_chestplate'] as const;

/** The smithable set, in smithing order. Quests and verify read it from here. */
export const STEEL_SET = ['steel_helm', 'steel_greaves', 'steel_chestplate'] as const;

/** The adamant set, in smithing order. */
export const ADAMANT_SET = ['adamant_helm', 'adamant_greaves', 'adamant_chestplate'] as const;

/** The stormiron set, in smithing order. */
export const STORMIRON_SET = ['stormiron_helm', 'stormiron_greaves', 'stormiron_chestplate'] as const;

/** The starmetal set, in smithing order. */
export const STARMETAL_SET = ['starmetal_helm', 'starmetal_greaves', 'starmetal_chestplate'] as const;

/** The leatherworker's sets, gloves then boots: Hide at Leatherworking 1, Wolfskin at 10, Marsh-hide at 18, Thornhide at 26, Moorhide at 34. */
export const HIDE_SET = ['hide_gloves', 'hide_boots'] as const;
export const WOLFSKIN_SET = ['wolfskin_gloves', 'wolfskin_boots'] as const;
export const MARSHHIDE_SET = ['marshhide_gloves', 'marshhide_boots'] as const;
export const THORNHIDE_SET = ['thornhide_gloves', 'thornhide_boots'] as const;
export const MOORHIDE_SET = ['moorhide_gloves', 'moorhide_boots'] as const;

export const TIER_COLORS = [0xc8c8c8, 0xe8e8e8, 0x4aa8ff, 0xffa030, 0xb48cff, 0x3ee0c0, 0xf2f0ff, 0x7a5cff, 0xe060ff]; // material, common, good, rare, epic, legendary (spectral jade; art's TIER5_COLOR in gear-look.ts), mythic (star-white; TIER6_COLOR), the Echo blades (ultraviolet, orchid; TIER7_COLOR, TIER8_COLOR)

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
  // the cave: iron-grade gear and the metal for the next rung. The steel set is smithed, never dropped; the Warden's shards (smithed into a blade) are the one rare chase.
  // What the ogres dig up and the Warden carries is iron, not the Hollow's own tin: it is the old workings' leavings, and it is what the set is made of (HOM-81).
  ravager: { rolls: 1, nothing: 40, entries: [
    { id: 'wolf_pelt', qty: [1, 3] }, { id: 'iron_helm' }, { id: 'iron_greaves' }, { id: 'steel_sword', weight: 2 },
  ] },
  archer: { rolls: 1, nothing: 35, entries: [{ id: 'iron_helm' }, { id: 'iron_greaves' }, { id: 'iron_sword' }] },
  seer: { rolls: 1, nothing: 35, entries: [{ id: 'iron_chestplate' }, { id: 'iron_helm' }, { id: 'steel_sword', weight: 2 }] },
  ogre: { rolls: 2, nothing: 30, entries: [
    { id: 'iron_ore', qty: [3, 6], weight: 20 }, { id: 'iron_chestplate' }, { id: 'steel_sword', weight: 3 },
  ] },
  warden: { rolls: 2, nothing: 48, entries: [
    { id: 'iron_bar', qty: [3, 5], weight: 30 }, { id: 'warden_shard', qty: [1, 2], weight: 50 }, { id: 'iron_chestplate', weight: 10 },
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
  shore_crab: { rolls: 2, nothing: 39, entries: [
    { id: 'boar_hide', qty: [1, 3], weight: 30 }, { id: 'marsh_hide', qty: [1, 3], weight: 20 }, { id: 'hide_jerkin', weight: 8 }, { id: 'hide_leggings' }, { id: 'leather_cap' }, { id: 'iron_sword', weight: 3 }, { id: 'iron_helm', weight: 3 }, { id: 'iron_greaves', weight: 2 },
  ] },
  drowned_sailor: { rolls: 2, nothing: 73, entries: [
    { id: 'hide_jerkin', weight: 8 }, { id: 'hide_leggings' }, { id: 'rusty_blade' }, { id: 'iron_sword', weight: 4 }, { id: 'iron_helm', weight: 3 }, { id: 'iron_greaves', weight: 3 }, { id: 'iron_chestplate', weight: 2 }, { id: 'steel_sword', weight: 1 },
  ] },
  tide_hag: { rolls: 2, nothing: 83, entries: [
    { id: 'hide_jerkin', weight: 8 }, { id: 'leather_cap' }, { id: 'iron_sword', weight: 4 }, { id: 'iron_helm', weight: 3 }, { id: 'iron_greaves', weight: 3 }, { id: 'iron_chestplate', weight: 3 }, { id: 'steel_sword', weight: 2 },
  ] },
  barnacle_ogre: { rolls: 3, nothing: 51, entries: [
    { id: 'wolf_pelt', qty: [2, 4], weight: 15 }, { id: 'marsh_hide', qty: [2, 4], weight: 10 }, { id: 'iron_helm', weight: 6 }, { id: 'iron_greaves', weight: 6 }, { id: 'iron_chestplate', weight: 6 }, { id: 'steel_sword', weight: 5 },
  ] },
  gutterhook: { rolls: 3, nothing: 45, entries: [
    { id: 'wolf_pelt', qty: [3, 5], weight: 15 }, { id: 'marsh_hide', qty: [3, 5], weight: 10 }, { id: 'iron_greaves', weight: 6 }, { id: 'iron_chestplate', weight: 6 }, { id: 'steel_sword', weight: 8 },
  ] },
  // the fens and the Thornwood, the same rule: each table's `nothing` is solved to land within 1 % of 0.6 x level + 3 (an elite 3x, a rare 4x). No new gear tier is
  // dropped above steel, so these are the road's tables with the odds moved.
  fen_stalker: { rolls: 2, nothing: 38, entries: [
    { id: 'wolf_pelt', qty: [1, 3], weight: 40 }, { id: 'marsh_hide', qty: [1, 3], weight: 26 }, { id: 'hide_jerkin', weight: 8 }, { id: 'leather_cap' }, { id: 'hide_leggings' }, { id: 'iron_sword', weight: 4 }, { id: 'iron_chestplate', weight: 2 }, { id: 'steel_sword', weight: 1 },
  ] },
  bog_witch: { rolls: 2, nothing: 68, entries: [
    { id: 'hide_jerkin', weight: 8 }, { id: 'leather_cap' }, { id: 'iron_sword', weight: 4 }, { id: 'iron_helm', weight: 3 }, { id: 'iron_greaves', weight: 3 }, { id: 'iron_chestplate', weight: 3 }, { id: 'steel_sword', weight: 2 },
  ] },
  mire_troll: { rolls: 2, nothing: 78, entries: [
    { id: 'wolf_pelt', qty: [1, 3], weight: 20 }, { id: 'marsh_hide', qty: [1, 3], weight: 13 }, { id: 'iron_helm', weight: 5 }, { id: 'iron_greaves', weight: 5 }, { id: 'iron_sword', weight: 4 }, { id: 'iron_chestplate', weight: 4 }, { id: 'steel_sword', weight: 2 },
  ] },
  bogfather: { rolls: 3, nothing: 40, entries: [
    { id: 'wolf_pelt', qty: [2, 4], weight: 15 }, { id: 'marsh_hide', qty: [2, 4], weight: 10 }, { id: 'iron_helm', weight: 6 }, { id: 'iron_greaves', weight: 6 }, { id: 'iron_chestplate', weight: 6 }, { id: 'steel_sword', weight: 6 },
  ] },
  mother_mire: { rolls: 3, nothing: 38, entries: [
    { id: 'wolf_pelt', qty: [3, 5], weight: 15 }, { id: 'marsh_hide', qty: [3, 5], weight: 10 }, { id: 'iron_chestplate', weight: 6 }, { id: 'iron_greaves', weight: 6 }, { id: 'steel_sword', weight: 10 },
  ] },
  thornback: { rolls: 2, nothing: 36, entries: [
    { id: 'boar_hide', qty: [1, 3], weight: 30 }, { id: 'thorn_hide', qty: [1, 3], weight: 15 }, { id: 'hide_jerkin', weight: 8 }, { id: 'iron_sword', weight: 3 }, { id: 'iron_helm', weight: 3 }, { id: 'iron_greaves', weight: 3 }, { id: 'iron_chestplate', weight: 2 }, { id: 'steel_sword', weight: 1 },
  ] },
  blight_stag: { rolls: 2, nothing: 57, entries: [
    { id: 'wolf_pelt', qty: [1, 3], weight: 30 }, { id: 'thorn_hide', qty: [1, 3], weight: 15 }, { id: 'hide_jerkin', weight: 8 }, { id: 'iron_sword', weight: 4 }, { id: 'iron_helm', weight: 3 }, { id: 'iron_greaves', weight: 3 }, { id: 'iron_chestplate', weight: 3 }, { id: 'steel_sword', weight: 2 },
  ] },
  rotwood_cultist: { rolls: 2, nothing: 63, entries: [
    { id: 'hide_jerkin', weight: 8 }, { id: 'iron_sword', weight: 4 }, { id: 'iron_helm', weight: 4 }, { id: 'iron_greaves', weight: 4 }, { id: 'iron_chestplate', weight: 3 }, { id: 'steel_sword', weight: 2 },
  ] },
  thorn_warden: { rolls: 3, nothing: 37, entries: [
    { id: 'wolf_pelt', qty: [2, 4], weight: 15 }, { id: 'thorn_hide', qty: [2, 4], weight: 8 }, { id: 'iron_helm', weight: 6 }, { id: 'iron_chestplate', weight: 6 }, { id: 'iron_greaves', weight: 6 }, { id: 'steel_sword', weight: 7 },
  ] },
  elder_thornback: { rolls: 3, nothing: 24, entries: [
    { id: 'boar_hide', qty: [3, 5], weight: 20 }, { id: 'thorn_hide', qty: [3, 5], weight: 10 }, { id: 'iron_chestplate', weight: 6 }, { id: 'iron_sword', weight: 6 }, { id: 'steel_sword', weight: 10 },
  ] },
  // the Barrowdowns and the Moor, the same rule (HOM-95): `nothing` solved to land within 1 % of 0.6 x level + 3 (an elite 3x, a rare 4x). Still nothing above steel is dropped.
  barrow_wight: { rolls: 2, nothing: 57, entries: [
    { id: 'hide_jerkin', weight: 8 }, { id: 'iron_sword', weight: 4 }, { id: 'iron_helm', weight: 4 }, { id: 'iron_greaves', weight: 4 }, { id: 'iron_chestplate', weight: 3 }, { id: 'steel_sword', weight: 2 },
  ] },
  grave_hound: { rolls: 2, nothing: 26, entries: [
    { id: 'wolf_pelt', qty: [1, 3], weight: 40 }, { id: 'thorn_hide', qty: [1, 3], weight: 20 }, { id: 'hide_jerkin', weight: 8 }, { id: 'iron_sword', weight: 4 }, { id: 'iron_chestplate', weight: 3 }, { id: 'steel_sword', weight: 2 },
  ] },
  cairn_brute: { rolls: 2, nothing: 60, entries: [
    { id: 'wolf_pelt', qty: [1, 3], weight: 20 }, { id: 'thorn_hide', qty: [1, 3], weight: 10 }, { id: 'iron_helm', weight: 5 }, { id: 'iron_greaves', weight: 5 }, { id: 'iron_sword', weight: 4 }, { id: 'iron_chestplate', weight: 4 }, { id: 'steel_sword', weight: 3 },
  ] },
  barrow_lord: { rolls: 3, nothing: 25, entries: [
    { id: 'wolf_pelt', qty: [2, 4], weight: 15 }, { id: 'thorn_hide', qty: [2, 4], weight: 8 }, { id: 'iron_helm', weight: 6 }, { id: 'iron_chestplate', weight: 6 }, { id: 'iron_greaves', weight: 6 }, { id: 'steel_sword', weight: 7 },
  ] },
  hollow_knight: { rolls: 3, nothing: 19, entries: [
    { id: 'wolf_pelt', qty: [3, 5], weight: 15 }, { id: 'thorn_hide', qty: [3, 5], weight: 8 }, { id: 'iron_chestplate', weight: 6 }, { id: 'iron_greaves', weight: 6 }, { id: 'steel_sword', weight: 10 },
  ] },
  moor_ram: { rolls: 2, nothing: 25, entries: [
    { id: 'boar_hide', qty: [1, 3], weight: 30 }, { id: 'moor_hide', qty: [1, 3], weight: 15 }, { id: 'hide_jerkin', weight: 8 }, { id: 'iron_sword', weight: 3 }, { id: 'iron_helm', weight: 3 }, { id: 'iron_greaves', weight: 3 }, { id: 'iron_chestplate', weight: 2 }, { id: 'steel_sword', weight: 2 },
  ] },
  moor_raider: { rolls: 2, nothing: 47, entries: [
    { id: 'hide_jerkin', weight: 8 }, { id: 'iron_sword', weight: 4 }, { id: 'iron_helm', weight: 4 }, { id: 'iron_greaves', weight: 4 }, { id: 'iron_chestplate', weight: 3 }, { id: 'steel_sword', weight: 2 },
  ] },
  ridge_ogre: { rolls: 2, nothing: 52, entries: [
    { id: 'wolf_pelt', qty: [1, 3], weight: 20 }, { id: 'moor_hide', qty: [1, 3], weight: 10 }, { id: 'iron_helm', weight: 5 }, { id: 'iron_greaves', weight: 5 }, { id: 'iron_sword', weight: 4 }, { id: 'iron_chestplate', weight: 4 }, { id: 'steel_sword', weight: 3 },
  ] },
  stonehorn: { rolls: 3, nothing: 23, entries: [
    { id: 'boar_hide', qty: [3, 5], weight: 15 }, { id: 'moor_hide', qty: [3, 5], weight: 8 }, { id: 'iron_helm', weight: 6 }, { id: 'iron_chestplate', weight: 6 }, { id: 'iron_greaves', weight: 6 }, { id: 'steel_sword', weight: 7 },
  ] },
  // the Cairnwaste and the Spire's ruins, the same rule (HOM-111): `nothing` solved to land within 1 % of 0.6 x level + 3 (an elite 3x). The wastes' beasts add moor hide at half the weight of their pelt
  // entry (2.2); the Spire's beasts would drop the next hide, which is not designed yet, so they drop what the Moor's did. Still nothing above steel is dropped.
  waste_reaver: { rolls: 2, nothing: 41, entries: [
    { id: 'hide_jerkin', weight: 8 }, { id: 'iron_sword', weight: 4 }, { id: 'iron_helm', weight: 4 }, { id: 'iron_greaves', weight: 4 }, { id: 'iron_chestplate', weight: 3 }, { id: 'steel_sword', weight: 2 },
  ] },
  dune_hound: { rolls: 2, nothing: 8, entries: [
    { id: 'wolf_pelt', qty: [1, 3], weight: 40 }, { id: 'moor_hide', qty: [1, 3], weight: 20 }, { id: 'hide_jerkin', weight: 8 }, { id: 'iron_sword', weight: 4 }, { id: 'iron_chestplate', weight: 3 }, { id: 'steel_sword', weight: 2 },
  ] },
  sand_ogre: { rolls: 2, nothing: 39, entries: [
    { id: 'wolf_pelt', qty: [1, 3], weight: 20 }, { id: 'moor_hide', qty: [1, 3], weight: 10 }, { id: 'iron_helm', weight: 5 }, { id: 'iron_greaves', weight: 5 }, { id: 'iron_sword', weight: 4 }, { id: 'iron_chestplate', weight: 4 }, { id: 'steel_sword', weight: 3 },
  ] },
  ashen_colossus: { rolls: 3, nothing: 13, entries: [
    { id: 'wolf_pelt', qty: [2, 4], weight: 15 }, { id: 'moor_hide', qty: [2, 4], weight: 8 }, { id: 'iron_helm', weight: 6 }, { id: 'iron_chestplate', weight: 6 }, { id: 'iron_greaves', weight: 6 }, { id: 'steel_sword', weight: 7 },
  ] },
  spire_adept: { rolls: 2, nothing: 35, entries: [
    { id: 'hide_jerkin', weight: 8 }, { id: 'iron_sword', weight: 4 }, { id: 'iron_helm', weight: 4 }, { id: 'iron_greaves', weight: 4 }, { id: 'iron_chestplate', weight: 3 }, { id: 'steel_sword', weight: 2 },
  ] },
  void_hound: { rolls: 2, nothing: 3, entries: [
    { id: 'wolf_pelt', qty: [1, 3], weight: 40 }, { id: 'hide_jerkin', weight: 8 }, { id: 'iron_sword', weight: 4 }, { id: 'iron_chestplate', weight: 3 }, { id: 'steel_sword', weight: 2 },
  ] },
  rune_golem: { rolls: 2, nothing: 34, entries: [
    { id: 'wolf_pelt', qty: [1, 3], weight: 20 }, { id: 'iron_helm', weight: 5 }, { id: 'iron_greaves', weight: 5 }, { id: 'iron_sword', weight: 4 }, { id: 'iron_chestplate', weight: 4 }, { id: 'steel_sword', weight: 3 },
  ] },
  spire_warden: { rolls: 3, nothing: 12, entries: [
    { id: 'wolf_pelt', qty: [2, 4], weight: 15 }, { id: 'iron_helm', weight: 6 }, { id: 'iron_chestplate', weight: 6 }, { id: 'iron_greaves', weight: 6 }, { id: 'steel_sword', weight: 7 },
  ] },
  // the Grotto's boss shard (6.1): 35 % a kill, one shard, three to a blade: about nine kills on a ten-minute respawn. The one roll, so nothing else competes with it.
  captain_marrow: { rolls: 1, nothing: 65, entries: [{ id: 'marrow_shard', weight: 35 }] },
  // the Rotroot's: the same 35 % roll (6.1), for the blade that stormiron bars now smith.
  rotroot_mother: { rolls: 1, nothing: 65, entries: [{ id: 'heartwood_shard', weight: 35 }] },
  // the Cairn King's named piece (6.1: a boss's is 1 in 10 a kill, the one roll) and, since HOM-111, the Crown shard Crownbreaker is folded round: 35 % a kill like every other boss's shard, on the same roll.
  // There is no pity counter yet (the bible's 30-kill guarantee is its own card).
  cairn_king: { rolls: 1, nothing: 55, entries: [{ id: 'kings_crown', weight: 10 }, { id: 'crown_shard', weight: 35 }] },
  // Archmage Vael (HOM-112): the last boss pays in the reagent, a reliable 30 to 60 dust on each of two rolls, and nothing else: no equippable has a look drawn for it, so there is no named piece yet (6.2 lists none), and
  // no blade above Crownbreaker for a shard to open. The Vault is the one place dust is dropped rather than ground out of gear.
  archmage_vael: { rolls: 2, nothing: 0, entries: [{ id: 'arcane_dust', qty: [30, 60], weight: 1 }] },
};

export interface DerivedStats {
  weaponDamage: number; // flat, added to direct-hit base damage
  armor: number;
  reduction: number;    // fraction of incoming damage removed, 0..MAX_REDUCTION
  swingInterval: number; // seconds between auto-attack swings: the weapon's speed, or BARE_SWING bare-handed
  /** How far the light you carry reaches, world units; 0 with nothing lit. Rendering only: no rule reads it. */
  light: number;
  /** What the slot enchants add (sim/enchants.ts): crit chance, energy a second, and the share of max health. Armour is folded into `armor`. */
  crit: number;
  energyRegen: number;
  hpFrac: number;
}

export const ARMOR_K = 40;        // reduction = armor / (armor + ARMOR_K)
// 0.80 is armour 160 (HOM-107). At 0.75 (armour 120) starmetal with Thornhide and starmetal with Moorhide both met the cap, and twelve levels of Leatherworking bought nothing.
export const MAX_REDUCTION = 0.8;

export type Equipment = Record<EquipSlot, string | null>;
export const emptyEquipment = (): Equipment => ({ weapon: null, head: null, chest: null, legs: null, hands: null, feet: null, offhand: null });
/** Durability points left, by item id. Absent means whole (MAX_DURABILITY): only a piece that has been worn down has an entry, so an old save needs none. */
export type Durability = Record<string, number>;

/**
 * THE derived-stat calculation. Combat reads only this; M3's smithed weapon is just another
 * ITEMS entry equipped in the weapon slot. A broken piece (`durability` at 0) is worn but gives nothing, and neither does what is enchanted onto it.
 */
export function deriveStats(equipment: Equipment, durability: Durability = {}, enchants: Enchants = {}): DerivedStats {
  const fx = enchantFx(equipment, durability, enchants);
  let weaponDamage = 0, armor = fx.armor, swingInterval = BARE_SWING, light = 0;
  for (const slot of EQUIP_SLOTS) {
    const id = equipment[slot];
    const st = id && durability[id] !== 0 ? ITEMS[id]?.stats : undefined;
    if (!st) continue;
    weaponDamage += st.damage ?? 0;
    armor += st.armor ?? 0;
    if (st.speed) swingInterval = st.speed;
    light = Math.max(light, st.light ?? 0); // two lights do not add up: the brighter one is what you see by
  }
  return { weaponDamage, armor, reduction: Math.min(MAX_REDUCTION, armor / (armor + ARMOR_K)), swingInterval, light, crit: fx.crit, energyRegen: fx.energyRegen, hpFrac: fx.hpFrac };
}

/** Human-readable stat lines for tooltips. */
export function describeStats(def: ItemDef): string[] {
  const out: string[] = [];
  if (def.stats?.damage) out.push(`+${def.stats.damage} weapon damage`);
  if (def.stats?.speed) out.push(`${def.stats.speed.toFixed(1)}s swing`);
  if (def.stats?.armor) out.push(`+${def.stats.armor} armour`);
  if (def.stats?.light) out.push(`Lights ${def.stats.light}m around you`);
  if (def.req?.combat) out.push(`Requires Combat ${def.req.combat}`);
  if (def.use?.heal) out.push(`Heals ${Math.round(def.use.heal * 100)}% of max health`);
  return out;
}
