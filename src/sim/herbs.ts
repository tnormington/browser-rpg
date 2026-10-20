// The herbs and their potions (docs/world-design.md 2.2), as one table like fish.ts: each is a herb patch (NODE_TYPES), a raw item and a potion (ITEMS),
// and one alchemy recipe (RECIPES). Those tables spread the rows from here, so an herb is added in one place. Pure data: imports nothing.
// Only four have ground to grow on yet (Thornwick's garden, the Fens, the Thornwood, and the Grotto and Cairn Hold for Ghostcap); Sunpetal and Dragonroot wait for their regions.
// The potions have no effect yet: drinking them is the consumables card's (a shared potion cooldown, buffs usable in combat).

export interface HerbDef {
  id: string;
  name: string;
  level: number;       // Herbalism to pick it, and Alchemy to brew its potion
  xp: number;          // per gather: 0.12 x the XP cost of the level (HOM-56's rate, the same as ore), not the bible's 0.42
  value: number;       // sell price
  potion: { id: string; name: string; xp: number }; // xp per brew: 0.25 x the cost of the level, rounded to 5, like a bar
}

export const HERBS: HerbDef[] = [
  { id: 'marrowleaf', name: 'Marrowleaf', level: 1, xp: 10, value: 3, potion: { id: 'healing_draught', name: 'Healing Draught', xp: 20 } },
  { id: 'fenbloom', name: 'Fenbloom', level: 10, xp: 24, value: 12, potion: { id: 'draught_of_vigour', name: 'Draught of Vigour', xp: 50 } },
  { id: 'thornmint', name: 'Thornmint', level: 18, xp: 54, value: 20, potion: { id: 'stoneskin', name: 'Stoneskin', xp: 115 } },
  // dungeon-only (the Drowned Grotto and the Cairn Hold): 0.12 and 0.25 of the 2,182 from level 34 to 35, by the same rule as the rows above
  { id: 'ghostcap', name: 'Ghostcap', level: 34, xp: 262, value: 36, potion: { id: 'greater_healing', name: 'Greater Healing', xp: 545 } },
];

/** The empty vial a potion is poured into: the one input Thornwick's provisioner sells. Worth 1, so it costs 4. */
export const VIAL = 'vial';
export const VIAL_VALUE = 1;
/** A potion sells for its herb plus this much: under the herb plus the vial's 4 gold to buy one, so buy -> brew -> sell can never make gold. */
export const POTION_PREMIUM = 2;
