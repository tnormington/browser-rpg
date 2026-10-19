// Smithing at the forge: recipes, requirements, timed crafting. Pure sim.
import type { GameState } from '../sim';
import type { Action } from './actions';
import { LANDMARKS } from './world';
import { SkillId, grantXp } from './skills';
import { ITEMS } from './items';
import { masteryTime, masteryYield } from './mastery';
import { addItem, countItem, hasRoom, removeItem } from './inventory';

export interface Recipe {
  id: string;
  name: string;
  skill: SkillId;
  level: number;
  inputs: { id: string; qty: number }[];
  output: { id: string; qty: number };
  time: number; // seconds
  xp: number;
}

// Forge ladder: smelt iron bars, harden them into steel bars (needs coal: Mining 4), forge the blade.
export const RECIPES: Recipe[] = [
  { id: 'iron_bar', name: 'Iron Bar', skill: 'smithing', level: 1, time: 3, xp: 35,
    inputs: [{ id: 'iron_ore', qty: 2 }], output: { id: 'iron_bar', qty: 1 } },
  { id: 'steel_bar', name: 'Steel Bar', skill: 'smithing', level: 3, time: 4, xp: 70,
    inputs: [{ id: 'iron_bar', qty: 1 }, { id: 'coal', qty: 2 }], output: { id: 'steel_bar', qty: 1 } },
  { id: 'forged_blade', name: "Forgemaster's Blade", skill: 'smithing', level: 4, time: 6, xp: 120,
    inputs: [{ id: 'steel_bar', qty: 3 }, { id: 'logs', qty: 1 }], output: { id: 'forged_blade', qty: 1 } },
  // The cave's ladder: mithril ore (Mining 9) smelted with coal, then the set. Each piece asks for more Smithing than the last,
  // and the bars alone carry a smith past all the gates, so a player who does the chain in order is never made to grind a skill.
  { id: 'mithril_bar', name: 'Mithril Bar', skill: 'smithing', level: 7, time: 5, xp: 70,
    inputs: [{ id: 'mithril_ore', qty: 1 }, { id: 'coal', qty: 2 }], output: { id: 'mithril_bar', qty: 1 } },
  { id: 'mithril_helm', name: 'Mithril Helm', skill: 'smithing', level: 8, time: 7, xp: 150,
    inputs: [{ id: 'mithril_bar', qty: 2 }], output: { id: 'mithril_helm', qty: 1 } },
  { id: 'mithril_greaves', name: 'Mithril Greaves', skill: 'smithing', level: 9, time: 8, xp: 210,
    inputs: [{ id: 'mithril_bar', qty: 3 }], output: { id: 'mithril_greaves', qty: 1 } },
  { id: 'mithril_chestplate', name: 'Mithril Chestplate', skill: 'smithing', level: 10, time: 10, xp: 300,
    inputs: [{ id: 'mithril_bar', qty: 4 }], output: { id: 'mithril_chestplate', qty: 1 } },
  // the reason to keep killing the Warden after the quest: shards drop at random, three make the best weapon in the game
  { id: 'warden_edge', name: "Warden's Edge", skill: 'smithing', level: 11, time: 12, xp: 450,
    inputs: [{ id: 'mithril_bar', qty: 3 }, { id: 'warden_shard', qty: 3 }], output: { id: 'warden_edge', qty: 1 } },
];

export const FORGE_REACH = 6; // centre-to-centre; the hut is 2.6 radius
export const MAX_BATCH = 99;

export const recipeById = (id: string) => RECIPES.find(r => r.id === id);
export const nearForge = (s: GameState) =>
  Math.hypot(s.player.x - LANDMARKS.forge.x, s.player.z - LANDMARKS.forge.z) <= FORGE_REACH;
export const hasInputs = (s: GameState, r: Recipe) => r.inputs.every(i => countItem(s.player.inventory, i.id) >= i.qty);

/** One craft at the player's current skill: the base time, cut by whatever they have over the recipe's level. */
export const craftTime = (s: GameState, r: Recipe) =>
  masteryTime(r.time, s.player.skills[r.skill].level, r.level);

/** A smith over the level gets more out of a batch — of stackable stock. A second helm out of the same bars would be a trick, not a skill. */
export const bonusOutput = (r: Recipe) => ITEMS[r.output.id].stack > 1;

/** Returns a failure reason, or null when the recipe can be made right now. */
function blocker(s: GameState, r: Recipe): 'range' | 'level' | 'materials' | 'full' | null {
  if (!nearForge(s)) return 'range';
  if (s.player.skills[r.skill].level < r.level) return 'level';
  if (!hasInputs(s, r)) return 'materials';
  if (!hasRoom(s.player.inventory, r.output.id, r.output.qty)) return 'full';
  return null;
}

const fail = (s: GameState, r: Recipe, reason: NonNullable<ReturnType<typeof blocker>>) =>
  void s.events.push({ t: 'actionfail', reason, skill: r.skill, need: r.level, what: r.name });

export function beginCraft(s: GameState, recipeId: string, count: number) {
  const r = recipeById(recipeId);
  if (!r || !Number.isFinite(count)) return;
  const why = blocker(s, r);
  if (why) return fail(s, r, why);
  s.player.action = { k: 'craft', recipe: r.id, t: 0, duration: craftTime(s, r), left: Math.max(1, Math.min(MAX_BATCH, Math.floor(count))) };
}

/** One craft completed: consume inputs, produce output, xp. Continues the batch while it still can. */
export function finishCraft(s: GameState, a: Extract<Action, { k: 'craft' }>) {
  const p = s.player, r = recipeById(a.recipe)!;
  const why = blocker(s, r);
  if (why) { p.action = null; return fail(s, r, why); }
  for (const i of r.inputs) removeItem(p.inventory, i.id, i.qty);
  const want = bonusOutput(r) ? masteryYield(s, r.output.qty, p.skills[r.skill].level, r.level) : r.output.qty;
  const made = want - addItem(p.inventory, r.output.id, want);
  s.events.push({ t: 'crafted', item: r.output.id, qty: made });
  grantXp(s, r.skill, r.xp, p.x, p.z);
  a.t = 0;
  a.duration = craftTime(s, r); // a level gained on this craft speeds up the rest of the batch
  if (--a.left <= 0 || blocker(s, r)) p.action = null;
}
