// Crafting at a station (the forge, the cooking range, the alembic): recipes, requirements, timed crafting. Pure sim.
import type { GameState } from '../sim';
import type { Action } from './actions';
import { LANDMARKS, Pt } from './world';
import { SkillId, grantXp } from './skills';
import { ITEMS } from './items';
import { masteryTime, masteryYield } from './mastery';
import { addItem, countItem, hasRoom, removeItem } from './inventory';
import { FISH, SEA_SALT, cookedId, pieId } from './fish';
import { HERBS, VIAL } from './herbs';

/** Where a recipe is made. The forge, the range and the alembic are built; the rest are named by the bible (2.2) for the skills still to come. */
export type Station = 'forge' | 'range' | 'alembic' | 'rack' | 'circle';

export interface Recipe {
  id: string;
  name: string;
  skill: SkillId;
  /** Default 'forge'. */
  station?: Station;
  level: number;
  inputs: { id: string; qty: number }[];
  output: { id: string; qty: number };
  time: number; // seconds
  xp: number;
}

// The metal ladder (docs/world-design.md 2.2, HOM-56). A bar's XP is 0.25 x the XP cost of its level (it is the action you repeat); a piece is 0.35 x,
// a blade 0.4 x (made once, so worth more each). Mining and smithing climb together if you smelt what you mine: a player who does is
// never more than a few bars short of a gate, but a player who skips the forge meets "needs Smithing N" at every rung.
export const RECIPES: Recipe[] = [
  // copper (HOM-81): two copper ore to a bar and nothing else, so the whole set is made from the one rock Hale has. It shares bronze's gate
  // rather than sitting under it (Smithing starts at 1), and pays less XP a bar: the reason to walk out for tin is still the better metal.
  { id: 'copper_bar', name: 'Copper Bar', skill: 'smithing', level: 1, time: 3, xp: 12,
    inputs: [{ id: 'copper_ore', qty: 2 }], output: { id: 'copper_bar', qty: 1 } },
  { id: 'copper_sword', name: 'Copper Sword', skill: 'smithing', level: 1, time: 6, xp: 20,
    inputs: [{ id: 'copper_bar', qty: 3 }, { id: 'logs', qty: 1 }], output: { id: 'copper_sword', qty: 1 } },
  { id: 'copper_helm', name: 'Copper Helm', skill: 'smithing', level: 1, time: 6, xp: 22,
    inputs: [{ id: 'copper_bar', qty: 2 }], output: { id: 'copper_helm', qty: 1 } },
  { id: 'copper_greaves', name: 'Copper Greaves', skill: 'smithing', level: 2, time: 7, xp: 26,
    inputs: [{ id: 'copper_bar', qty: 3 }], output: { id: 'copper_greaves', qty: 1 } },
  { id: 'copper_chestplate', name: 'Copper Chestplate', skill: 'smithing', level: 3, time: 8, xp: 30,
    inputs: [{ id: 'copper_bar', qty: 4 }], output: { id: 'copper_chestplate', qty: 1 } },
  // bronze: copper and tin, the first set worth walking out of Hale for
  { id: 'bronze_bar', name: 'Bronze Bar', skill: 'smithing', level: 1, time: 3, xp: 20,
    inputs: [{ id: 'copper_ore', qty: 1 }, { id: 'tin_ore', qty: 1 }], output: { id: 'bronze_bar', qty: 1 } },
  { id: 'bronze_sword', name: 'Bronze Sword', skill: 'smithing', level: 2, time: 6, xp: 30,
    inputs: [{ id: 'bronze_bar', qty: 3 }, { id: 'logs', qty: 1 }], output: { id: 'bronze_sword', qty: 1 } },
  { id: 'bronze_helm', name: 'Bronze Helm', skill: 'smithing', level: 3, time: 6, xp: 35,
    inputs: [{ id: 'bronze_bar', qty: 2 }], output: { id: 'bronze_helm', qty: 1 } },
  { id: 'bronze_greaves', name: 'Bronze Greaves', skill: 'smithing', level: 4, time: 7, xp: 40,
    inputs: [{ id: 'bronze_bar', qty: 3 }], output: { id: 'bronze_greaves', qty: 1 } },
  { id: 'bronze_chestplate', name: 'Bronze Chestplate', skill: 'smithing', level: 5, time: 8, xp: 45,
    inputs: [{ id: 'bronze_bar', qty: 4 }], output: { id: 'bronze_chestplate', qty: 1 } },
  // iron: smelt iron bars, harden them into steel bars (needs coal: Mining 10), forge the blade
  { id: 'iron_bar', name: 'Iron Bar', skill: 'smithing', level: 7, time: 3, xp: 40,
    inputs: [{ id: 'iron_ore', qty: 2 }], output: { id: 'iron_bar', qty: 1 } },
  { id: 'steel_bar', name: 'Steel Bar', skill: 'smithing', level: 8, time: 4, xp: 45,
    inputs: [{ id: 'iron_bar', qty: 1 }, { id: 'coal', qty: 2 }], output: { id: 'steel_bar', qty: 1 } },
  { id: 'forged_blade', name: "Forgemaster's Blade", skill: 'smithing', level: 9, time: 6, xp: 75,
    inputs: [{ id: 'steel_bar', qty: 3 }, { id: 'logs', qty: 1 }], output: { id: 'forged_blade', qty: 1 } },
  // The cave's ladder: mithril ore (Mining 18) smelted with coal, then the set. Each piece asks for one more Smithing than the last, and the nine
  // bars and the pieces before it carry a smith to the chestplate's gate exactly: the set is never the grind, getting to the bar is.
  { id: 'mithril_bar', name: 'Mithril Bar', skill: 'smithing', level: 15, time: 5, xp: 90,
    inputs: [{ id: 'mithril_ore', qty: 1 }, { id: 'coal', qty: 2 }], output: { id: 'mithril_bar', qty: 1 } },
  { id: 'mithril_helm', name: 'Mithril Helm', skill: 'smithing', level: 16, time: 7, xp: 145,
    inputs: [{ id: 'mithril_bar', qty: 2 }], output: { id: 'mithril_helm', qty: 1 } },
  { id: 'mithril_greaves', name: 'Mithril Greaves', skill: 'smithing', level: 17, time: 8, xp: 160,
    inputs: [{ id: 'mithril_bar', qty: 3 }], output: { id: 'mithril_greaves', qty: 1 } },
  { id: 'mithril_chestplate', name: 'Mithril Chestplate', skill: 'smithing', level: 18, time: 10, xp: 155,
    inputs: [{ id: 'mithril_bar', qty: 4 }], output: { id: 'mithril_chestplate', qty: 1 } },
  // the reason to keep killing the Warden after the quest: shards drop at random, three make the best weapon in the game
  { id: 'warden_edge', name: "Warden's Edge", skill: 'smithing', level: 20, time: 12, xp: 220,
    inputs: [{ id: 'mithril_bar', qty: 3 }, { id: 'warden_shard', qty: 3 }], output: { id: 'warden_edge', qty: 1 } },
  // The Strand's ladder (docs/world-design.md 3.3): adamant ore (Mining 28) and three coal to a bar, then the set and the blade. The blade takes
  // plain logs: the bible's ash is a tree that does not exist yet (W2.2).
  { id: 'adamant_bar', name: 'Adamant Bar', skill: 'smithing', level: 24, time: 6, xp: 205,
    inputs: [{ id: 'adamant_ore', qty: 1 }, { id: 'coal', qty: 3 }], output: { id: 'adamant_bar', qty: 1 } },
  { id: 'adamant_helm', name: 'Adamant Helm', skill: 'smithing', level: 25, time: 8, xp: 315,
    inputs: [{ id: 'adamant_bar', qty: 2 }], output: { id: 'adamant_helm', qty: 1 } },
  { id: 'adamant_blade', name: 'Adamant Blade', skill: 'smithing', level: 26, time: 13, xp: 395,
    inputs: [{ id: 'adamant_bar', qty: 3 }, { id: 'logs', qty: 1 }], output: { id: 'adamant_blade', qty: 1 } },
  // the capstone: Smithing 30 is one past the chestplate's 29 (3.3), and the shards are the limit, not the forge. XP is 0.4 x the 1,470 from 30 to 31
  { id: 'marrows_edge', name: "Marrow's Edge", skill: 'smithing', level: 30, time: 14, xp: 590,
    inputs: [{ id: 'adamant_bar', qty: 3 }, { id: 'marrow_shard', qty: 3 }], output: { id: 'marrows_edge', qty: 1 } },
  // the Rotroot's capstone (3.3): Smithing 42, one past stormiron's 41, XP 0.4 x the 4,810 from 42 to 43. Stormiron is not built yet, so the three bars are adamant for now
  { id: 'rotroot_edge', name: 'Rotroot Edge', skill: 'smithing', level: 42, time: 15, xp: 1924,
    inputs: [{ id: 'adamant_bar', qty: 3 }, { id: 'heartwood_shard', qty: 3 }], output: { id: 'rotroot_edge', qty: 1 } },
  { id: 'adamant_greaves', name: 'Adamant Greaves', skill: 'smithing', level: 27, time: 9, xp: 385,
    inputs: [{ id: 'adamant_bar', qty: 3 }], output: { id: 'adamant_greaves', qty: 1 } },
  { id: 'adamant_chestplate', name: 'Adamant Chestplate', skill: 'smithing', level: 29, time: 11, xp: 465,
    inputs: [{ id: 'adamant_bar', qty: 4 }], output: { id: 'adamant_chestplate', qty: 1 } },
  // the range: each fish cooked on its own, and a pie (2 fish and a pinch of salt) two levels up that also makes you Well Fed. Craft XP: fish.ts.
  ...FISH.flatMap((f): Recipe[] => [
    { id: cookedId(f), name: `Cooked ${f.name}`, skill: 'cooking', station: 'range', level: f.level, time: f.cookTime, xp: f.cookXp,
      inputs: [{ id: f.id, qty: 1 }], output: { id: cookedId(f), qty: 1 } },
    { id: pieId(f), name: `${f.name} Pie`, skill: 'cooking', station: 'range', level: f.level + 2, time: 6, xp: Math.round(f.cookXp * 1.5 / 5) * 5,
      inputs: [{ id: f.id, qty: 2 }, { id: SEA_SALT, qty: 1 }], output: { id: pieId(f), qty: 1 } },
  ]),
  // the alembic: an herb and an empty vial make its potion. Alchemy asks the herb's own level
  ...HERBS.map((h): Recipe => ({ id: h.potion.id, name: h.potion.name, skill: 'alchemy', station: 'alembic', level: h.level, time: 4, xp: h.potion.xp,
    inputs: [{ id: h.id, qty: 1 }, { id: VIAL, qty: 1 }], output: { id: h.potion.id, qty: 1 } })),
];

export const FORGE_REACH = 6; // centre-to-centre; the hut is 2.6 radius
export const STATION_REACH = FORGE_REACH; // the same for every station
export const MAX_BATCH = 99;

/** Where each built station stands, and what to call it when you are too far from it. */
export const STATIONS: Partial<Record<Station, { at: Pt; name: string }>> = {
  forge: { at: LANDMARKS.forge, name: 'forge' },
  range: { at: LANDMARKS.range, name: 'cooking range' },
  alembic: { at: LANDMARKS.alembic, name: 'alembic' },
};
export const stationOf = (r: Recipe): Station => r.station ?? 'forge';

export const recipeById = (id: string) => RECIPES.find(r => r.id === id);
/** Standing within reach of a station. A station that is not built anywhere is never near. */
export const nearStation = (s: GameState, station: Station) => {
  const at = STATIONS[station]?.at;
  return !!at && Math.hypot(s.player.x - at.x, s.player.z - at.z) <= STATION_REACH;
};
export const hasInputs = (s: GameState, r: Recipe) => r.inputs.every(i => countItem(s.player.inventory, i.id) >= i.qty);

/** One craft at the player's current skill: the base time, cut by whatever they have over the recipe's level. */
export const craftTime = (s: GameState, r: Recipe) =>
  masteryTime(r.time, s.player.skills[r.skill].level, r.level);

/** A smith over the level gets more out of a batch — of stackable stock. A second helm out of the same bars would be a trick, not a skill. */
export const bonusOutput = (r: Recipe) => ITEMS[r.output.id].stack > 1;

/** Returns a failure reason, or null when the recipe can be made right now. */
function blocker(s: GameState, r: Recipe): 'range' | 'level' | 'materials' | 'full' | null {
  if (!nearStation(s, stationOf(r))) return 'range';
  if (s.player.skills[r.skill].level < r.level) return 'level';
  if (!hasInputs(s, r)) return 'materials';
  if (!hasRoom(s.player.inventory, r.output.id, r.output.qty)) return 'full';
  return null;
}

const fail = (s: GameState, r: Recipe, reason: NonNullable<ReturnType<typeof blocker>>) =>
  void s.events.push({ t: 'actionfail', reason, skill: r.skill, need: r.level, what: r.name, station: STATIONS[stationOf(r)]?.name });

export function beginCraft(s: GameState, recipeId: string, count: number) {
  const r = recipeById(recipeId);
  if (!r || !Number.isFinite(count)) return;
  const why = blocker(s, r);
  if (why) return fail(s, r, why);
  s.player.action = { k: 'craft', recipe: r.id, t: 0, duration: craftTime(s, r), left: Math.max(1, Math.min(MAX_BATCH, Math.floor(count))) };
  s.events.push({ t: 'begin', skill: r.skill, what: 'craft', id: r.id });
}

/** One craft completed: consume inputs, produce output, xp. Continues the batch while it still can. */
export function finishCraft(s: GameState, a: Extract<Action, { k: 'craft' }>) {
  const p = s.player, r = recipeById(a.recipe)!;
  const why = blocker(s, r);
  if (why) { p.action = null; return fail(s, r, why); }
  for (const i of r.inputs) removeItem(p.inventory, i.id, i.qty);
  const want = bonusOutput(r) ? masteryYield(s, r.output.qty, p.skills[r.skill].level, r.level) : r.output.qty;
  const made = want - addItem(p.inventory, r.output.id, want);
  s.events.push({ t: 'crafted', item: r.output.id, qty: made, skill: r.skill });
  grantXp(s, r.skill, r.xp, p.x, p.z);
  a.t = 0;
  a.duration = craftTime(s, r); // a level gained on this craft speeds up the rest of the batch
  if (--a.left <= 0 || blocker(s, r)) p.action = null;
}
