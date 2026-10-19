// The six fish (docs/world-design.md 2.2), as one table: each is a fishing spot (NODE_TYPES), a raw item, a cooked dish and a pie (ITEMS),
// and two cooking recipes (RECIPES). Those three tables spread the rows from here, so a fish is added in one place. Pure data: imports nothing.
// Only the first three have water to stand beside yet (Saltmarrow's quay, shallows and the Strand); the rest wait for their regions.

export interface FishDef {
  id: string;
  name: string;
  level: number;     // Fishing to catch it, and Cooking to cook it (a pie asks two more)
  xp: number;        // per catch
  value: number;     // raw sell price; the dish and the pie are worth more
  heal: number;      // share of max HP the cooked dish restores
  cookXp: number;    // per dish; the pie pays 1.5x
  cookTime: number;  // seconds a dish takes
}

export const FISH: FishDef[] = [
  { id: 'silverfin', name: 'Silverfin', level: 1, xp: 35, value: 3, heal: 0.15, cookXp: 50, cookTime: 3 },
  { id: 'brine_trout', name: 'Brine Trout', level: 8, xp: 71, value: 10, heal: 0.20, cookXp: 100, cookTime: 3 },
  { id: 'saltpike', name: 'Saltpike', level: 16, xp: 155, value: 18, heal: 0.25, cookXp: 220, cookTime: 4 },
  { id: 'redgill', name: 'Redgill', level: 24, xp: 342, value: 26, heal: 0.30, cookXp: 490, cookTime: 4 },
  { id: 'ghost_eel', name: 'Ghost Eel', level: 32, xp: 752, value: 34, heal: 0.35, cookXp: 1075, cookTime: 5 },
  { id: 'stormtuna', name: 'Stormtuna', level: 40, xp: 1658, value: 42, heal: 0.40, cookXp: 2370, cookTime: 5 },
];

export const cookedId = (f: FishDef) => `${f.id}_cooked`;
export const pieId = (f: FishDef) => `${f.id}_pie`;

/** The pie's one bought input. Sold by Saltmarrow's chandler: the design says 6 gold, but the shop charges 4x an integer value, so it is 8. */
export const SEA_SALT = 'sea_salt';
