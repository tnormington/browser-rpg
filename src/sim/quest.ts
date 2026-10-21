// The quest chain that stitches the golden path together, the NPC's dialogue, and the tracker view. Pure sim.
import type { GameState } from '../sim';
import { GATES, LANDMARKS, inCave } from './world';
import { ENEMY_TYPES } from './data';
import { SkillId, grantXp } from './skills';
import { NODE_TYPES } from './gathering';
import { recipeById } from './crafting';
import { countItem, removeItem } from './inventory';
import { refreshPlayerStats } from './combat';
import { EQUIP_SLOTS, ITEMS, STEEL_SET } from './items';

export type QuestStage = 'offer' | 'hunt' | 'report1' | 'forge' | 'brute' | 'report2' | 'done';
/**
 * The second chain starts where the first ends and runs on the same machinery (kill credit, item gates, a hand-in with a
 * reward, a tracker, dialogue) beside it. `locked` until the first quest is handed in; `stage` stays at 'done' throughout.
 */
export type Quest2Stage = 'locked' | 'offer' | 'delve' | 'armour' | 'warden' | 'report' | 'cleared';
/** The third chain is Saltmarrow's: given by its harbourmaster once the Hollow is quiet, and handed in to them. */
export type Quest3Stage = 'locked' | 'offer' | 'hunt' | 'report' | 'cleared';
/** The fourth chain is an errand, not a story beat: taken from the Warden in Hale at any time, worked on the Greywater Road, handed in to the harbourmaster. No lock. */
export type Quest4Stage = 'offer' | 'carry' | 'report' | 'cleared';
/**
 * The bible's Q4, Brine and Bone (the code's `fourth` is the errand, which was built first): Saltmarrow's second story chain, given by the harbourmaster once the
 * road is open, and the one that opens the Drowned Grotto's door. `locked` until the Salt Road is handed in.
 */
export type Quest5Stage = 'locked' | 'offer' | 'hunt' | 'report' | 'cleared';
/** The bible's Q5, The Rotroot: Thornwick's reeve, once Brine and Bone is handed in; it opens the Rotroot's mouth and pays 1,200 combat XP. */
export type Quest6Stage = 'locked' | 'offer' | 'hunt' | 'report' | 'cleared';
/** The bible's Q6, The Moor Writ: Highmoor's Steward, once the Rotroot is handed in; it opens Corvin's gate north and pays 1,500 combat XP. */
export type Quest7Stage = 'locked' | 'offer' | 'hunt' | 'report' | 'cleared';
/**
 * The bible's Q7, The Sundered Seal: the Spire's Keeper, once the writ is signed (they have walked the Cairnwaste to be here); it is what the Vault's door will ask for (HOM-112) and pays 1,800 combat XP.
 * The Q2 shape, not the Q3 to Q6 one: the ruins' lesser wards first (`hunt`), then the Warden alone (`warden`: it only counts once the wards are down), then the Keeper.
 * `cleared` is the seal read and the Vault's door open (HOM-112): the chain goes on from there to the end of the game, Archmage Vael slain (`closing`) and the Keeper told (`done`).
 */
export type Quest8Stage = 'locked' | 'offer' | 'hunt' | 'warden' | 'report' | 'cleared' | 'closing' | 'done';
export interface QuestState { stage: QuestStage; kills: Record<string, number>; second: Quest2Stage; third: Quest3Stage; fourth: Quest4Stage; fifth: Quest5Stage; sixth: Quest6Stage; seventh: Quest7Stage; eighth: Quest8Stage }
export const QUEST_STAGES: QuestStage[] = ['offer', 'hunt', 'report1', 'forge', 'brute', 'report2', 'done'];
export const QUEST2_STAGES: Quest2Stage[] = ['locked', 'offer', 'delve', 'armour', 'warden', 'report', 'cleared'];
export const QUEST3_STAGES: Quest3Stage[] = ['locked', 'offer', 'hunt', 'report', 'cleared'];
export const QUEST4_STAGES: Quest4Stage[] = ['offer', 'carry', 'report', 'cleared'];
export const QUEST5_STAGES: Quest5Stage[] = ['locked', 'offer', 'hunt', 'report', 'cleared'];
export const QUEST6_STAGES: Quest6Stage[] = ['locked', 'offer', 'hunt', 'report', 'cleared'];
export const QUEST7_STAGES: Quest7Stage[] = ['locked', 'offer', 'hunt', 'report', 'cleared'];
export const QUEST8_STAGES: Quest8Stage[] = ['locked', 'offer', 'hunt', 'warden', 'report', 'cleared', 'closing', 'done'];
/** True once the seal has been read (the Vault's door opens at this stage, and stays open through the two that follow). */
export const sealRead = (s: GameState) => QUEST8_STAGES.indexOf(s.quest.eighth) >= QUEST8_STAGES.indexOf('cleared');

/** True once the first quest has got as far as `stage`. */
export const questReached = (s: GameState, stage: QuestStage) => QUEST_STAGES.indexOf(s.quest.stage) >= QUEST_STAGES.indexOf(stage);

export const newQuest = (): QuestState => ({ stage: 'offer', kills: {}, second: 'locked', third: 'locked', fourth: 'offer', fifth: 'locked', sixth: 'locked', seventh: 'locked', eighth: 'locked' });

export const QUEST_NAME = 'The Brute of the Cave Mouth';
export const NPC = { name: 'Warden Hale', x: LANDMARKS.npc.x, z: LANDMARKS.npc.z, r: LANDMARKS.npc.r };
export const HARBOURMASTER = { name: 'Harbourmaster Pell', x: LANDMARKS.harbourmaster.x, z: LANDMARKS.harbourmaster.z, r: LANDMARKS.harbourmaster.r };
/** Thornwick's reeve: the town's one quest giver, who gives the Rotroot's chain once Brine and Bone is done. */
export const THORN_REEVE = { name: 'Reeve Maud Alder', x: LANDMARKS.thornReeve.x, z: LANDMARKS.thornReeve.z, r: LANDMARKS.thornReeve.r };
/** Highmoor's Steward: the town's one quest giver, who gives the writ for the north road once the Rotroot is done. */
export const HIGH_STEWARD = { name: 'Steward Hild Garrow', x: LANDMARKS.highSteward.x, z: LANDMARKS.highSteward.z, r: LANDMARKS.highSteward.r };
/** The Spire's Keeper: the town's one quest giver, who gives the seal's chain once the writ is signed. */
export const SPIRE_KEEPER = { name: 'Keeper Isaura Venn', x: LANDMARKS.spireKeeper.x, z: LANDMARKS.spireKeeper.z, r: LANDMARKS.spireKeeper.r };
export type NpcId = 'hale' | 'harbour' | 'thorn' | 'high' | 'spire';
/** Everyone with something to say, by id. Hale's warden is the first: an interaction with no one named falls back to him. */
export const NPCS: { id: NpcId; name: string; x: number; z: number; r: number }[] = [{ id: 'hale', ...NPC }, { id: 'harbour', ...HARBOURMASTER }, { id: 'thorn', ...THORN_REEVE }, { id: 'high', ...HIGH_STEWARD }, { id: 'spire', ...SPIRE_KEEPER }];
export const TALK_RANGE = 7;                       // centre to centre: advancing the quest needs this
export const HUNT_GOALS: Record<string, number> = { boar: 4, wolf: 3 };
const PLURAL: Record<string, string> = { boar: 'Wild Boars', wolf: 'Dire Wolves', ravager: 'Cave Ravagers', footpad: 'Footpads', toll_captain: 'Toll Captain', drowned_sailor: 'Drowned Sailors', tide_hag: 'Tide Hags', barnacle_ogre: 'Barnacle Ogre',
  thornback: 'Thornback Boars', rotwood_cultist: 'Rotwood Cultists', thorn_warden: 'Thorn Warden',
  moor_raider: 'Moor Raiders', moor_ram: 'Moor Rams', ridge_ogre: 'Ridge Ogres', stonehorn: 'Stonehorn',
  spire_adept: 'Spire Adepts', void_hound: 'Void Hounds', rune_golem: 'Rune Golems', spire_warden: 'Spire Warden' };
/**
 * What the Forgemaster's Blade costs in raw terms (see RECIPES): three steel bars, each an iron bar (two ore) and two coal, and a log. The plan is
 * padded past that (six iron bars, four steel) so the bars it asks for are also the practice the gates want (Steel Smithing 8, the blade Smithing 9).
 * What it cannot pad is Mining: iron wants 7 and coal 10, so a new character comes to it by way of copper and tin, and the bronze they smelt
 * on the way is what carries Smithing up to the iron bar's gate. Hale has only copper (HOM-77), so everything above it is a walk out
 * along the Greywater Road and back to the forge.
 */
export const BLADE_PLAN = { ore: 12, coal: 8, logs: 1, bars: 6, steel: 4 };
export const RECOMMENDED_COMBAT = 4; // finishing the hunt gets you there, and level 4 is what hands over the Pummel the Brute fight is built around; the blade is still what beats it
export const REWARD: { skill: SkillId; xp: number }[] = [
  { skill: 'combat', xp: 400 }, { skill: 'mining', xp: 150 }, { skill: 'smithing', xp: 150 },
];

export const QUEST2_NAME = 'The Hollow Below';
/** The cave's Ravager pack holds the hollow the passage opens into: going on past it means clearing it. */
export const DELVE_GOALS: Record<string, number> = { ravager: 3 };
/**
 * What the steel set costs in raw terms (see RECIPES): nine steel bars (2 + 3 + 4 across helm, greaves and chestplate), each an iron
 * bar (two ore) and two coal. The cave holds none of it since its seam became tin (HOM-81): iron and coal are both the Greywater
 * Road's waysides, the same ground the first quest's blade came off, which is why the trip out is twice the first one's and not new.
 */
export const STEEL_PLAN = { ore: 18, coal: 18, iron: 9, bars: 9 };
export const RECOMMENDED_COMBAT_2 = 9;
export const REWARD2: { skill: SkillId; xp: number }[] = [
  { skill: 'combat', xp: 1000 }, { skill: 'mining', xp: 500 }, { skill: 'smithing', xp: 700 },
];

export const nearNpc = (s: GameState) => Math.hypot(s.player.x - NPC.x, s.player.z - NPC.z) <= TALK_RANGE;
/** Who the player is within earshot of (the nearest, if two are), or null. */
export const npcNear = (s: GameState): NpcId | null => {
  const d = (n: { x: number; z: number }) => Math.hypot(s.player.x - n.x, s.player.z - n.z);
  return NPCS.filter(n => d(n) <= TALK_RANGE).sort((a, b) => d(a) - d(b))[0]?.id ?? null;
};

export const QUEST3_NAME = 'The Salt Road';
/** Pell's carters will not take the road while the toll camp stands: the footpads who work it and the captain who runs it. */
export const SALT_GOALS: Record<string, number> = { footpad: 4, toll_captain: 1 };
export const RECOMMENDED_COMBAT_3 = 12;
export const REWARD3: { skill: SkillId; xp: number }[] = [{ skill: 'combat', xp: 600 }];

export const QUEST4_NAME = 'Timber and Copper for Saltmarrow';
/** What Saltmarrow's quay wants hauled from Hale: a level-1 character's whole kit (copper from Mining 1, logs from Woodcutting 1), all of it on the road's waysides. */
export const ERRAND_GOODS: { item: string; node: string; n: number; name: string }[] = [
  { item: 'logs', node: 'tree', n: 6, name: 'Logs' }, { item: 'copper_ore', node: 'copper', n: 6, name: 'Copper Ore' },
];
export const REWARD4: { skill: SkillId; xp: number }[] = [{ skill: 'woodcutting', xp: 150 }, { skill: 'mining', xp: 150 }];
export const QUEST5_NAME = 'Brine and Bone';
/** The Strand's drowned, which Pell wants thinned before anyone is sent at the cliff door: the sailors, the hags behind them and the ogre on the shingle. */
export const BRINE_GOALS: Record<string, number> = { drowned_sailor: 4, tide_hag: 2, barnacle_ogre: 1 };
export const RECOMMENDED_COMBAT_5 = 16;
export const REWARD5: { skill: SkillId; xp: number }[] = [{ skill: 'combat', xp: 900 }];
export const QUEST6_NAME = 'The Rotroot';
/** The cult's work in the Thornwood, which the reeve wants thinned before anyone is shown the way in: the cultists, the boars they ride out on and the Warden that keeps the road. */
export const ROT_GOALS: Record<string, number> = { rotwood_cultist: 4, thornback: 3, thorn_warden: 1 };
export const RECOMMENDED_COMBAT_6 = 22;
export const REWARD6: { skill: SkillId; xp: number }[] = [{ skill: 'combat', xp: 1200 }];
export const QUEST7_NAME = 'The Moor Writ';
/** What the Steward wants thinned before a writ is signed: the moor's raiders, the rams they run, the ogres on the ridge and the Stonehorn that keeps the north track. */
export const MOOR_GOALS: Record<string, number> = { moor_raider: 4, moor_ram: 3, ridge_ogre: 2, stonehorn: 1 };
export const RECOMMENDED_COMBAT_7 = 29;
export const REWARD7: { skill: SkillId; xp: number }[] = [{ skill: 'combat', xp: 1500 }];
export const QUEST8_NAME = 'The Sundered Seal';
/** The ruins' lesser wards, which the Keeper wants silenced before the Warden is faced: the adepts, the hounds that came out of the broken seal and the golems that still walk its rounds. */
export const SEAL_GOALS: Record<string, number> = { spire_adept: 4, void_hound: 3, rune_golem: 2 };
export const RECOMMENDED_COMBAT_8 = 36;
export const RECOMMENDED_COMBAT_VAEL = 40; // the sanctum's own: Vael is 41, and the Vault's door asks 38
export const REWARD8: { skill: SkillId; xp: number }[] = [{ skill: 'combat', xp: 1800 }];
/** What the Keeper pays when Vael is dead (HOM-112): the last combat XP the chains give, and a lift toward the first enchant (Enchanting 36 is 24,815 XP). */
export const REWARD8B: { skill: SkillId; xp: number }[] = [{ skill: 'combat', xp: 2400 }, { skill: 'enchanting', xp: 3000 }];
const haveGoods = (s: GameState) => ERRAND_GOODS.every(g => countItem(s.player.inventory, g.item) >= g.n);

/** Inventory plus what is worn: a piece you put on has not stopped being yours. */
const owned = (s: GameState, id: string) =>
  countItem(s.player.inventory, id) + EQUIP_SLOTS.filter(slot => s.player.equipment[slot] === id).length;
/** Bars already spent on pieces you own count toward the plan, so tracker progress never goes backwards at the forge. */
const BARS_IN: Record<string, number> = { steel_helm: 2, steel_greaves: 3, steel_chestplate: 4 };
const steelBars = (s: GameState) => owned(s, 'steel_bar') + STEEL_SET.reduce((n, id) => n + owned(s, id) * BARS_IN[id], 0);
/** Iron bars still in the bag plus the ones already hardened into steel: the same trick one rung down the recipe. */
const ironBars = (s: GameState) => countItem(s.player.inventory, 'iron_bar') + steelBars(s);
const ironOre = (s: GameState) => countItem(s.player.inventory, 'iron_ore') + 2 * ironBars(s);
const pieces = (s: GameState) => STEEL_SET.filter(id => owned(s, id) > 0).length;
const worn = (s: GameState) => STEEL_SET.filter(id => Object.values(s.player.equipment).includes(id)).length;

const hasBlade = (s: GameState) =>
  countItem(s.player.inventory, 'forged_blade') > 0 || Object.values(s.player.equipment).includes('forged_blade');

// ---------- transitions ----------

/** Which quest an event belongs to travels with it: both chains share stage 'done', so the HUD cannot work it out from state. */
const QUEST_NAMES = [QUEST_NAME, QUEST2_NAME, QUEST3_NAME, QUEST4_NAME, QUEST5_NAME, QUEST6_NAME, QUEST7_NAME, QUEST8_NAME];
const questEvent = (s: GameState, what: 'accept' | 'progress' | 'stage' | 'complete', chain: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 = 1) =>
  s.events.push({ t: 'quest', what, name: QUEST_NAMES[chain - 1] });

/** Kill credit. Hunt counts boars/wolves; the Brute only counts once the quest says so. */
export function questOnKill(s: GameState, type: string) {
  const q = s.quest;
  if (q.stage === 'hunt' && HUNT_GOALS[type] && (q.kills[type] ?? 0) < HUNT_GOALS[type]) {
    q.kills[type] = (q.kills[type] ?? 0) + 1;
    if (Object.entries(HUNT_GOALS).every(([t, n]) => (q.kills[t] ?? 0) >= n)) { q.stage = 'report1'; questEvent(s, 'stage'); }
    else questEvent(s, 'progress');
  } else if (q.stage === 'brute' && type === 'brute') {
    q.stage = 'report2';
    questEvent(s, 'stage');
  } else if (q.second === 'delve' && DELVE_GOALS[type] && (q.kills[type] ?? 0) < DELVE_GOALS[type]) {
    q.kills[type] = (q.kills[type] ?? 0) + 1;
    questEvent(s, 'progress', 2); // the stage itself ends in updateQuest, which also wants the ore
  } else if (q.second === 'warden' && type === 'warden') {
    q.second = 'report';
    questEvent(s, 'stage', 2);
  }
  // the third chain counts beside the others: a footpad is a footpad whoever asked
  if (q.third === 'hunt' && SALT_GOALS[type] && (q.kills[type] ?? 0) < SALT_GOALS[type]) {
    q.kills[type] = (q.kills[type] ?? 0) + 1;
    if (Object.entries(SALT_GOALS).every(([t, n]) => (q.kills[t] ?? 0) >= n)) { q.third = 'report'; questEvent(s, 'stage', 3); }
    else questEvent(s, 'progress', 3);
  }
  if (q.fifth === 'hunt' && BRINE_GOALS[type] && (q.kills[type] ?? 0) < BRINE_GOALS[type]) {
    q.kills[type] = (q.kills[type] ?? 0) + 1;
    if (Object.entries(BRINE_GOALS).every(([t, n]) => (q.kills[t] ?? 0) >= n)) { q.fifth = 'report'; questEvent(s, 'stage', 5); }
    else questEvent(s, 'progress', 5);
  }
  if (q.sixth === 'hunt' && ROT_GOALS[type] && (q.kills[type] ?? 0) < ROT_GOALS[type]) {
    q.kills[type] = (q.kills[type] ?? 0) + 1;
    if (Object.entries(ROT_GOALS).every(([t, n]) => (q.kills[t] ?? 0) >= n)) { q.sixth = 'report'; questEvent(s, 'stage', 6); }
    else questEvent(s, 'progress', 6);
  }
  if (q.seventh === 'hunt' && MOOR_GOALS[type] && (q.kills[type] ?? 0) < MOOR_GOALS[type]) {
    q.kills[type] = (q.kills[type] ?? 0) + 1;
    if (Object.entries(MOOR_GOALS).every(([t, n]) => (q.kills[t] ?? 0) >= n)) { q.seventh = 'report'; questEvent(s, 'stage', 7); }
    else questEvent(s, 'progress', 7);
  }
  if (q.eighth === 'hunt' && SEAL_GOALS[type] && (q.kills[type] ?? 0) < SEAL_GOALS[type]) {
    q.kills[type] = (q.kills[type] ?? 0) + 1;
    if (Object.entries(SEAL_GOALS).every(([t, n]) => (q.kills[t] ?? 0) >= n)) { q.eighth = 'warden'; questEvent(s, 'stage', 8); }
    else questEvent(s, 'progress', 8);
  } else if (q.eighth === 'warden' && type === 'spire_warden') { // the Warden only counts once the lesser wards are down, as the Hollow Warden's did once the steel was on
    q.eighth = 'report';
    questEvent(s, 'stage', 8);
  } else if (q.eighth === 'cleared' && type === 'archmage_vael') { // the Vault only counts once the seal is read: the door does not open before
    q.eighth = 'closing';
    questEvent(s, 'stage', 8);
  }
}

/** The player picked the "advance" dialogue option. Only meaningful at the NPC stages of either chain, and only in earshot. */
export function advanceQuest(s: GameState, what: boolean | 'road' = true) {
  const q = s.quest, who = npcNear(s);
  if (s.player.dead || !who) return;
  if (what === 'road') { // the errand's offer is its own option on the Warden's dialogue: it never moves the story chains
    if (who === 'hale' && q.fourth === 'offer') { q.fourth = 'carry'; questEvent(s, 'accept', 4); }
    return;
  }
  if (who === 'harbour') { // Saltmarrow's chains: only its own giver moves them, the errand's hand-in first
    if (q.fourth === 'report' && haveGoods(s)) {
      q.fourth = 'cleared';
      for (const g of ERRAND_GOODS) removeItem(s.player.inventory, g.item, g.n);
      for (const r of REWARD4) grantXp(s, r.skill, r.xp, HARBOURMASTER.x, HARBOURMASTER.z);
      questEvent(s, 'complete', 4);
    } else if (q.third === 'offer') { q.third = 'hunt'; questEvent(s, 'accept', 3); }
    else if (q.third === 'report') {
      q.third = 'cleared';
      for (const r of REWARD3) if (grantXp(s, r.skill, r.xp, HARBOURMASTER.x, HARBOURMASTER.z) > 0 && r.skill === 'combat') refreshPlayerStats(s, true);
      questEvent(s, 'complete', 3);
    } else if (q.fifth === 'offer') { q.fifth = 'hunt'; questEvent(s, 'accept', 5); }
    else if (q.fifth === 'report') {
      q.fifth = 'cleared';
      for (const r of REWARD5) if (grantXp(s, r.skill, r.xp, HARBOURMASTER.x, HARBOURMASTER.z) > 0 && r.skill === 'combat') refreshPlayerStats(s, true);
      questEvent(s, 'complete', 5);
    }
    return;
  }
  if (who === 'thorn') { // Thornwick's reeve: the Rotroot's chain is the only one she moves
    if (q.sixth === 'offer') { q.sixth = 'hunt'; questEvent(s, 'accept', 6); }
    else if (q.sixth === 'report') {
      q.sixth = 'cleared';
      for (const r of REWARD6) if (grantXp(s, r.skill, r.xp, THORN_REEVE.x, THORN_REEVE.z) > 0 && r.skill === 'combat') refreshPlayerStats(s, true);
      questEvent(s, 'complete', 6);
    }
    return;
  }
  if (who === 'high') { // Highmoor's Steward: the writ's chain is the only one they move
    if (q.seventh === 'offer') { q.seventh = 'hunt'; questEvent(s, 'accept', 7); }
    else if (q.seventh === 'report') {
      q.seventh = 'cleared';
      for (const r of REWARD7) if (grantXp(s, r.skill, r.xp, HIGH_STEWARD.x, HIGH_STEWARD.z) > 0 && r.skill === 'combat') refreshPlayerStats(s, true);
      questEvent(s, 'complete', 7);
    }
    return;
  }
  if (who === 'spire') { // the Spire's Keeper: the seal's chain is the only one they move
    if (q.eighth === 'offer') { q.eighth = 'hunt'; questEvent(s, 'accept', 8); }
    else if (q.eighth === 'report') {
      q.eighth = 'cleared';
      for (const r of REWARD8) if (grantXp(s, r.skill, r.xp, SPIRE_KEEPER.x, SPIRE_KEEPER.z) > 0 && r.skill === 'combat') refreshPlayerStats(s, true);
      questEvent(s, 'complete', 8);
    } else if (q.eighth === 'closing') {
      q.eighth = 'done';
      for (const r of REWARD8B) if (grantXp(s, r.skill, r.xp, SPIRE_KEEPER.x, SPIRE_KEEPER.z) > 0 && r.skill === 'combat') refreshPlayerStats(s, true);
      questEvent(s, 'complete', 8);
    }
    return;
  }
  if (!nearNpc(s)) return;
  if (q.stage === 'offer') { q.stage = 'hunt'; questEvent(s, 'accept'); }
  else if (q.stage === 'report1') { q.stage = 'forge'; questEvent(s, 'stage'); }
  else if (q.stage === 'report2') {
    q.stage = 'done';
    q.second = 'offer';
    for (const r of REWARD) if (grantXp(s, r.skill, r.xp, NPC.x, NPC.z) > 0 && r.skill === 'combat') refreshPlayerStats(s, true);
    questEvent(s, 'complete');
  } else if (q.stage === 'done' && q.second === 'offer') { q.second = 'delve'; questEvent(s, 'accept', 2); }
  else if (q.stage === 'done' && q.second === 'report') {
    q.second = 'cleared';
    for (const r of REWARD2) if (grantXp(s, r.skill, r.xp, NPC.x, NPC.z) > 0 && r.skill === 'combat') refreshPlayerStats(s, true);
    questEvent(s, 'complete', 2);
  }
}

/** Per tick: the forge stage ends the moment the blade exists (crafted, or already owned when the stage began). */
export function updateQuest(s: GameState) {
  const q = s.quest;
  if (q.stage === 'forge' && hasBlade(s)) { q.stage = 'brute'; questEvent(s, 'stage'); }
  // the delve ends when the Ravagers are down and eighteen ore's worth is in hand (or already smelted); the smithing ends when the set exists
  if (q.second === 'delve' && Object.entries(DELVE_GOALS).every(([t, n]) => (q.kills[t] ?? 0) >= n) && ironOre(s) >= STEEL_PLAN.ore) {
    q.second = 'armour'; questEvent(s, 'stage', 2);
  }
  if (q.second === 'armour' && pieces(s) === STEEL_SET.length) { q.second = 'warden'; questEvent(s, 'stage', 2); }
  // the errand is ready the moment the goods are in the bag, and not ready again if they leave it
  if (q.fourth === 'carry' && haveGoods(s)) { q.fourth = 'report'; questEvent(s, 'stage', 4); }
  else if (q.fourth === 'report' && !haveGoods(s)) q.fourth = 'carry';
  if (q.second === 'cleared' && q.third === 'locked') q.third = 'offer'; // the road east opens once the Hollow is quiet: nothing is announced, the harbourmaster's mark is the news
  if (q.third === 'cleared' && q.fifth === 'locked') q.fifth = 'offer'; // and the Strand's work, once the road is
  if (q.fifth === 'cleared' && q.sixth === 'locked') q.sixth = 'offer'; // and Thornwick's, once the Strand is
  if (q.sixth === 'cleared' && q.seventh === 'locked') q.seventh = 'offer'; // and Highmoor's, once the Thornwood is
  if (q.seventh === 'cleared' && q.eighth === 'locked') q.eighth = 'offer'; // and the Spire's, once the writ has taken the player up the Cairnwaste
}

// ---------- dialogue ----------

export interface DialogueOption { label: string; advance?: boolean | 'road'; reply?: string } // 'road': the errand's offer (advanceQuest)
export interface Dialogue { lines: string[]; options: DialogueOption[] }

const CLOSE = (label: string): DialogueOption => ({ label });

export const DIALOGUE: Record<QuestStage, Dialogue> = {
  offer: {
    lines: [
      'Traveller! Thank the stars. Boars and wolves have overrun the clearing, and nobody can work the land.',
      'Thin them out for me: four Wild Boars and three Dire Wolves. Do that, and I will tell you about the real trouble.',
    ],
    options: [
      { label: "I'll deal with them.", advance: true,
        reply: 'Good. Click an enemy (or press Tab) to target it, then press 1 to strike. You will learn more as you level: watch the action bar. Rest if you are hurt: health returns out of combat. Come back when it is done.' },
      CLOSE('Not right now.'),
    ],
  },
  hunt: {
    lines: ['Still some left out there. The boars wander the edges of the clearing; the wolves keep further out.',
      'Tab targets the nearest enemy. Strike on 1. Every level hands you a new trick: the locked slots show when. Wolf pups hunt in packs, and the Cleave on 5 loves a pack.'],
    options: [CLOSE('Back to it.')],
  },
  report1: {
    lines: [
      'Well fought! The pack is scattered.',
      'But the Cave Brute, in the cave mouth to the north-west, is another matter. It crushed the last hunter who tried, and plain weapons barely scratch it.',
      "You need a better blade. Hale has no iron left in it: only copper, by the forge and along the ridge. The iron and the coal are out east, in the waysides of the Greywater Road. Bring them back with a log for the hilt, and the Forgemaster's Blade is smithed at the forge to the east. If you have never swung a pick, start on the copper here: it smelts on its own, and a copper set off the ridge is better than walking out in nothing. Then the tin at the first wayside past the gate: copper and tin make bronze, and bronze is better again.",
      'And watch its fist. It raises it before every crushing slam: Pummel it (6) to break the swing, or step out of the circle on the ground.',
    ],
    options: [
      { label: "I'll forge the blade.", advance: true,
        reply: `Click a rock to mine it. Iron wants Mining ${NODE_TYPES.iron.level} and coal Mining ${NODE_TYPES.coal.level}: copper and tin will get you there, the copper here and the tin out on the road. At the forge, smelt Copper Bars and make yourself a set out of those alone, then Bronze Bars once you have tin, then Iron Bars, then Steel Bars (Smithing ${recipeById('steel_bar')!.level}), then forge the blade (Smithing ${recipeById('forged_blade')!.level}). Equip it from your inventory (I) before you face the Brute.` },
      { label: 'Where is the forge?', reply: 'East of the clearing: the stone hut with the glowing furnace. Click it to open the forge.' },
    ],
  },
  forge: {
    lines: ['How goes the forging? Iron ore and coal from the waysides of the Greywater Road, a log for the hilt, then back to the forge. Copper first, then bronze, if your arms are still soft.'],
    options: [
      { label: 'Where do I find ore?', reply: 'Copper is the soft rock by the forge, with a few more on the ridge, and that is every rock Hale has: two of it make a bar, and a bar is a bar, so there is a whole set in the ridge if you want one. Go east through the gate and work the stands along the road: tin and iron at the first of them, the black coal seams from the second on, and the richest at the far end. Keep to the road and the camps will leave you be.' },
      CLOSE('Back to work.'),
    ],
  },
  brute: {
    lines: ['The blade! Magnificent. Equip it (press I and click it), then end that Brute. The cave mouth is north-west of here.'],
    options: [CLOSE('For the clearing!')],
  },
  report2: {
    lines: ['It is done? The Cave Brute is dead... the road is safe again.', 'Take this. You have earned every bit of it.'],
    options: [{ label: 'Thank you.', advance: true, reply: 'Safe travels, hero. The clearing will remember you.' }],
  },
  done: {
    lines: ['The clearing is safe, thanks to you. Come back any time: there is always another boar.'],
    options: [CLOSE('Farewell.')],
  },
};

export const DIALOGUE2: Record<Exclude<Quest2Stage, 'locked'>, Dialogue> = {
  offer: {
    lines: [
      'You did it. The Brute is dead, and that frightens me more than it comforts me.',
      'It was a sentry. Something has been driving creatures up out of the cave for weeks, and a Warden keeps the deep hall at the end of it.',
      'You carry steel and you wear a dead man\'s iron. That is backwards. Plate yourself in the metal you smelted yourself, then go down and put that Warden down.',
    ],
    options: [
      { label: "I'll go below.", advance: true,
        reply: `The cave mouth is north-west, and the passage runs on into the dark. There is nothing in the Hollow worth smithing: its seam is tin. The iron and the coal are east on the Greywater Road, Mining ${NODE_TYPES.iron.level} and ${NODE_TYPES.coal.level}. Harden the bars at the forge, smith the helm, greaves and chestplate (Smithing ${recipeById('steel_helm')!.level} and up), and wear them.` },
      CLOSE('Not yet.'),
    ],
  },
  delve: {
    lines: ['Three Ravagers and eighteen iron, that is all I ask of the first trip. The pack holds the hollow the passage opens into, and nothing goes deeper until it is down.',
      'A Gloom Archer stands sentry where the passage opens out: take it alone from the throat and rest before you go near the pack. Then Cleave the Ravagers, do not fight them one by one. The ore is the other errand: east out of the gate, along the road.'],
    options: [
      { label: 'Where do I find iron?', reply: `The Greywater Road's waysides, out the east gate: iron from the first stand on, coal from the second. Mining ${NODE_TYPES.iron.level} for the iron and ${NODE_TYPES.coal.level} for the coal; copper and tin are the practice if you are short of either.` },
      CLOSE('Back to it.'),
    ],
  },
  armour: {
    lines: ['Smelt the iron, harden it with coal, then smith the helm, greaves and chestplate. Each wants more Smithing than the last, but the bars will carry you there.',
      "The Hollow's archers and its seer are tuned to iron. You will want every plate of this before you go deeper."],
    options: [
      { label: 'How much coal?', reply: 'Two coal to every bar, nine bars in all: eighteen. The seams are out on the Greywater Road, a stand every hundred paces from the second one on.' },
      CLOSE('Back to work.'),
    ],
  },
  warden: {
    lines: ['Magnificent. Put it on (press I and click each piece), then go down to the Warden. The deep hall is at the far end of the cave, past the neck beyond the big cavern.',
      'Watch the ground. It marks where you stand and the rock comes down a moment later. Keep moving, and Pummel the slam.'],
    options: [CLOSE('For the clearing!')],
  },
  report: {
    lines: ['The Warden is dead? Then the Hollow is quiet at last.', 'Take this. The mountain owes you far more than I can pay.'],
    options: [{ label: 'Thank you.', advance: true, reply: 'The clearing will sing of this. And if you ever want a blade to match that armour, the Warden leaves shards of itself behind: bring them to the forge.' }],
  },
  cleared: {
    lines: ['The Hollow is yours, hero. Its Warden returns in time, and so do its shards: the forge can make a blade of them, if you want one.'],
    options: [CLOSE('Farewell.')],
  },
};

export const DIALOGUE3: Record<Exclude<Quest3Stage, 'locked'>, Dialogue> = {
  offer: {
    lines: [
      'You came by the Greywater Road? Then you walked past the toll camp, and you are luckier than my carters.',
      'A man who calls himself the Toll Captain has the road shut. His footpads rob whoever he lets through, and Saltmarrow has not seen a wagon from Hale in a month.',
      'Clear the camp. Four of his footpads and the Captain himself, west along the road. The first thing the sea-wives will do with the salt is buy your boots.',
    ],
    options: [
      { label: "I'll open the road.", advance: true,
        reply: 'The toll camp is a good way back along the road, where the Captain keeps his hut. Footpads throw knives: close the gap, or Pummel the throw. The Captain slams the ground with his cudgel: Pummel that too, or step out of the circle.' },
      { label: 'Not yet.' },
    ],
  },
  hunt: {
    lines: ['Still no wagons. The toll camp is west of here, near the start of the road: four footpads and their Captain.'],
    options: [{ label: 'I am on it.' }],
  },
  report: {
    lines: ['The road is open? The carters are already harnessing. Take this: it is the least the harbour owes you.'],
    options: [{ label: 'Thank you.', advance: true, reply: 'Come to the quay whenever you like. The adamant in the cliffs north of town wants a smith, and the Strand wants someone who can take a hit.' }],
  },
  cleared: {
    lines: ['The wagons are rolling again, and the inn has not been so loud in a year. The Strand is yours to hunt, if you want it.'],
    options: [{ label: 'Farewell.' }],
  },
};

export const DIALOGUE5: Record<Exclude<Quest5Stage, 'locked'>, Dialogue> = {
  offer: {
    lines: [
      'The road is open and the carters are happy, which leaves the Strand. The drowned are walking up out of the surf in numbers I have not seen, and the ones that carry harpoons are the worst.',
      "There is a door in the cliff north of the town, behind the adamant seams. It has been shut since my grandmother's day, and something behind it has been pulling the dead out of the sea.",
      'Thin the Strand first: four Drowned Sailors, two Tide Hags and the Barnacle Ogre that squats on the shingle. Do that, and I will tell you how the door is opened.',
    ],
    options: [
      { label: "I'll clear the Strand.", advance: true,
        reply: 'Sailors throw harpoons: close the gap, or Pummel the throw. The hags mark the ground and the tide comes up on it a moment later, so keep moving. The ogre slams the shingle: Pummel that too, or step out of the circle. Take them one at a time and rest between.' },
      { label: 'Not yet.' },
    ],
  },
  hunt: {
    lines: ['The Strand is south and east of the town, along the shore. Four sailors, two hags and the ogre: the cliff door can wait until they are down.'],
    options: [{ label: 'I am on it.' }],
  },
  report: {
    lines: ['The sea is quiet for the first time in a month. You have done it.', 'Take this, and take the news that goes with it: the door in the cliff is not barred any more. The Drowned Grotto is open.'],
    options: [{ label: 'Thank you.', advance: true, reply: 'Captain Marrow keeps the last room, and he fights like the ship he drowned with: an anchor, a cannon and a harpoon. If you can put him down, his anchor leaves shards behind, and a smith with adamant can make a blade of three.' }],
  },
  cleared: {
    lines: ['The door in the cliff stands open, thanks to you. Captain Marrow is down there, and he comes back as the tide does. His anchor leaves shards behind, and three of them make a blade.'],
    options: [{ label: 'Farewell.' }],
  },
};

/** What the Warden's dialogue panel shows right now: the first chain until it is handed in, the second after. */
export const activeDialogue = (s: GameState): Dialogue =>
  s.quest.stage === 'done' && s.quest.second !== 'locked' ? DIALOGUE2[s.quest.second] : DIALOGUE[s.quest.stage];

/** What a given giver has to say: the Warden's two chains, or the harbourmaster's one (a plain greeting before the road opens). */
export const dialogueAt = (s: GameState, who: string): Dialogue => {
  if (who === 'thorn') return s.quest.sixth === 'locked' ? THORN_DIALOGUE : DIALOGUE6[s.quest.sixth];
  if (who === 'high') return s.quest.seventh === 'locked' ? HIGH_DIALOGUE : DIALOGUE7[s.quest.seventh];
  if (who === 'spire') return s.quest.eighth === 'locked' ? SPIRE_DIALOGUE : DIALOGUE8[s.quest.eighth];
  if (who !== 'harbour') { // the Warden's own words, and the errand as one more thing to ask him while it is on offer
    const d = activeDialogue(s);
    return s.quest.fourth === 'offer' ? { ...d, options: [...d.options, ERRAND_OFFER] } : d;
  }
  return s.quest.fourth === 'report' ? DIALOGUE4_REPORT : harbourDialogue(s);
};
const THORN_DIALOGUE: Dialogue = {
  lines: [
    'Thornwick keeps its gates shut at dusk and its lamps lit all night. You came down the fen road on foot? Then you know about the stained ground: do not stand in it.',
    'The Thornwood past the square is boar and cult country. There is work for someone who can clear it, but I have no errand to give you yet. Come back when the roads are quieter.',
  ],
  options: [{ label: 'Farewell.' }],
};
const DIALOGUE6: Record<Exclude<Quest6Stage, 'locked'>, Dialogue> = {
  offer: {
    lines: [
      'You have the look of someone the Strand did not manage to drown. Good. Thornwick has a wound of its own.',
      'South of the town the Thornwood folds into the ground: a mouth in the roots, and a cult feeding something down there. The Rotroot Mother. I can show you the way in, but not while the wood is crawling with them.',
      'Four Rotwood Cultists, three Thornback Boars and the Thorn Warden that keeps their road. Do that, and I will tell you how the mouth is opened.',
    ],
    options: [
      { label: "I'll clear the wood.", advance: true,
        reply: 'The cultists hex from a distance: close the gap, or break their line of sight. The Warden slams the ground and marks it with briars: Pummel the slam, or step out of the circle, and keep moving when the briars are marked. Rest between pulls.' },
      { label: 'Not yet.' },
    ],
  },
  hunt: {
    lines: ['The cult keeps to the south and east of the square. Four cultists, three boars and the Warden: the mouth can wait until they are down.'],
    options: [{ label: 'I am on it.' }],
  },
  report: {
    lines: ['The wood is quiet. I did not think I would hear that this year.', 'Take this. And take the way in: the mouth in the roots is not sealed against you any more, if you are combat level 22 or better.'],
    options: [{ label: 'Thank you.', advance: true, reply: 'The Mother holds the last chamber. She slams the floor, clouds the air with spores, and throws hexes at anyone who stands off from her. Guard against the slam, Pummel what you can, and bring her heartwood back: a smith can fold three shards round good metal into a blade.' }],
  },
  cleared: {
    lines: ['The mouth in the roots is open, thanks to you. The Mother comes back as the seasons do, and her heartwood shards are the best thing this town will ever see made into a blade.'],
    options: [{ label: 'Farewell.' }],
  },
};
const HIGH_DIALOGUE: Dialogue = {
  lines: [
    'Highmoor is a town that keeps its own counsel, and its own accounts. You came over the barrows on foot? Then you have seen what the dead do to a road.',
    'The north road is shut by my order, and I sign no writ for anyone I have not seen at work. There is a task on this desk for someone who has finished their business in the Thornwood: come back when the Rotroot is quiet.',
  ],
  options: [{ label: 'Farewell.' }],
};
const DIALOGUE7: Record<Exclude<Quest7Stage, 'locked'>, Dialogue> = {
  offer: {
    lines: [
      'You are the one who came through the Rotroot. Good: I do not have to explain what a bad road is.',
      'The north road out of this town runs to the Cairnwaste, and I closed it myself, the winter the raiders took the track. Watchman Corvin keeps it, and he will let nobody past without my writ.',
      'I will sign for you, but not for a stranger the moor has not tested. Four Moor Raiders, three Moor Rams, two Ridge Ogres and the Stonehorn that keeps the north track. Bring me that done, and the writ is yours.',
    ],
    options: [
      { label: "I'll clear the moor.", advance: true,
        reply: 'The raiders shoot from range: close the gap, or break their line of sight. The ogres slam the ground: Pummel the slam, or step out of the circle. The Stonehorn gores, and marks the ground under you a moment later: keep moving. Rest between pulls.' },
      { label: 'Not yet.' },
    ],
  },
  hunt: {
    lines: ['The Moor is the east half of the town\'s ground: raiders and rams on the near ground, ogres further out, the Stonehorn on the north track. Four, three, two and the one.'],
    options: [{ label: 'I am on it.' }],
  },
  report: {
    lines: ['The moor is quiet? Then Corvin has his answer, and I have mine.', 'Take this, and take the writ: I have put your name in his book. The north road is open to you.'],
    options: [{ label: 'Thank you.', advance: true, reply: 'Corvin keeps the gate in the north wall, east of the square. The Cairnwaste is a hard country, and what sleeps in the Hold under Ysolt\'s watch can wait for you or not, as you choose: she will let you down the stair if you are combat level 29 or better.' }],
  },
  cleared: {
    lines: ['Your name is in Corvin\'s book, and the north road is open to you. Mind the Cairnwaste: it is a long way from any town.'],
    options: [{ label: 'Farewell.' }],
  },
};
const SPIRE_DIALOGUE: Dialogue = {
  lines: [
    'You are a long way from the writ that sent you up the Cairnwaste, and further than most get. The Spire has not had a visitor in some years who was not carrying something to sell.',
    'I keep the ledger of what is left here, and there is more of it than I can read by myself. Come and find me when you have had a look at the ruins: I will know whether you can be trusted with the rest.',
  ],
  options: [{ label: 'Farewell.' }],
};
const DIALOGUE8: Record<Exclude<Quest8Stage, 'locked'>, Dialogue> = {
  offer: {
    lines: [
      'Highmoor sent you, with Corvin\'s book signed. Good. Then you have walked the Cairnwaste, and I do not have to tell you what this country does to the careless.',
      'The Spire was a school before it was a ruin. Archmage Vael taught here, and the night it was sundered he went down into the Vault under the north wall and shut the door behind him. The door is a seal, and a seal is a sentence written in wards. I have been reading it for eleven years.',
      'I can read no further while the wards walk. Four Spire Adepts, three Void Hounds and two Rune Golems: each one is a line I can read again. Then there is the Warden, who is the seal\'s last word and will not be reasoned with. Do the first, and the seal will show you what is left.',
    ],
    options: [
      { label: "I'll silence them.", advance: true,
        reply: 'The adepts throw arcs from a distance: close the gap, or break their line of sight. The hounds come in packs of three and wake together: Cleave them, and do not fight with your back in the open. The golems strike harder than anything on the road, and they are slow: rest between them. Take the ruins one pull at a time. The north half of the town is theirs; the square is not.' },
      { label: 'Not yet.' },
    ],
  },
  hunt: {
    lines: ['The ruins are north of the square, past the last houses: adepts at the edges, hounds in the broken arches, golems on the old rounds. Four, three and two. When they are down you will know it: the Warden is what is left.'],
    options: [{ label: 'I am on it.' }],
  },
  warden: {
    lines: [
      'Nine wards silenced, and the seal is quieter than I have heard it in eleven years.',
      'What is left is the Warden, at the head of the ruins before the Vault\'s corridor. It slams the ground with a verdict nothing carries off, and it marks the stones under you with a rune that breaks a moment later. Pummel the slam, or step out of the circle, and keep moving when the rune is marked. It will not follow you into the square.',
    ],
    options: [{ label: 'The Warden, then.' }],
  },
  report: {
    lines: ['The Warden is down? Then the last word is spoken, and I can read the seal from end to end.', 'Take this: it is what the school paid its keepers, and it is yours now.'],
    options: [{ label: 'Thank you.', advance: true, reply: 'I have read it, and I will tell you what it says, though you will not like it: it is not a lock, it is a promise. Whatever Vael promised, he is keeping it. Wardkeeper Thale holds the door, and I have told him to let you through: you are the first in eleven years to have earned it.' }],
  },
  cleared: {
    lines: [
      'The seal is read, and Thale will open the door to you: it is on the north road out of the ruins, past where the Warden stood.',
      'Vael is down there still. The first room is the stair, the second the archive where his adepts and golems keep the rounds, and the last is his sanctum. He fights from across the room: arcs at anyone within eighteen paces, a rune marked under your feet, a nova for anyone who closes with him. The stones in the sanctum are there to be stood behind, and the floor is warded. Do not stand still on it.',
    ],
    options: [{ label: 'I will end it.' }],
  },
  closing: {
    lines: ['It is quiet. For the first time in eleven years the seal has stopped saying anything at all.', 'The Vault is yours, and the school\'s last wage with it. Take it.'],
    options: [{ label: 'It is over.', advance: true, reply: 'It is over, for the school. The Spire is a town now, and not a ruin; the ledger is closed, and I will keep the book. If you want to do something with the rest of what you have found, the rune circle is south of the forge, across the square. It was built to be used.' }],
  },
  done: {
    lines: ['The Vault is open and empty, and the seal reads nothing. Whatever Vael promised, he kept, and so did you.', 'The rune circle is across the square from the forge. Gear you no longer need is dust there, and dust is worth more than it sounds.'],
    options: [{ label: 'Farewell.' }],
  },
};
const harbourDialogue = (s: GameState): Dialogue =>
  s.quest.third === 'locked'
    ? { lines: ['Welcome to Saltmarrow, traveller. Mind the Strand after dark: the sea gives back what it takes, and not kindly.', 'Come and see me once you have dealt with whatever troubles Hale: there is work on the road.'], options: [{ label: 'Farewell.' }] }
    : s.quest.third === 'cleared' && s.quest.fifth !== 'locked' ? DIALOGUE5[s.quest.fifth] : DIALOGUE3[s.quest.third];

/** The fourth chain's two spoken parts: the ask, an option on the Warden's dialogue (see dialogueAt), and the hand-in at the quay. */
const ERRAND_OFFER: DialogueOption = {
  label: 'Is there anything I can carry to Saltmarrow?', advance: 'road',
  reply: `Saltmarrow's quay is short of timber and copper, and nobody will walk the Greywater Road for it. Cut ${ERRAND_GOODS[0].n} Logs and mine ${ERRAND_GOODS[1].n} Copper Ore as you go: there are rocks and trees beside the road, a stand every hundred paces. Bring them to Harbourmaster Pell. The wolves and hogs out there are well beyond a new traveller: keep to the road.`,
};
const DIALOGUE4_REPORT: Dialogue = {
  lines: ['From Hale? On foot, along the Greywater Road? And you have the timber and the copper.', 'The quay has been waiting on exactly this. Here is something for the trouble.'],
  options: [{ label: 'Glad to help.', advance: true, reply: 'The carters will remember this. Come and see me if you want real work.' }],
};

export const npcName = (who: string) => NPCS.find(n => n.id === who)?.name ?? NPC.name;

/** The mark over the harbourmaster: '!' there is work, '?' waiting for you, grey it is under way, none otherwise. */
export function harbourMarker(s: GameState): 'offer' | 'ready' | 'wait' | null {
  const t = s.quest.third;
  if (s.quest.fourth === 'report') return 'ready';
  const f = s.quest.fifth; // the Strand's work follows the road's: once the road is cleared it is the one that speaks
  if (t === 'cleared') return f === 'offer' ? 'offer' : f === 'report' ? 'ready' : f === 'hunt' ? 'wait' : null;
  return t === 'offer' ? 'offer' : t === 'report' ? 'ready' : t === 'hunt' ? 'wait' : null;
}

/** The mark over a giver whose one chain is at `t`: '!' to offer, '?' to hand in, grey while it is under way. */
const chainMark = (t: Quest6Stage | Quest7Stage | Quest8Stage): 'offer' | 'ready' | 'wait' | null => t === 'offer' ? 'offer' : t === 'report' ? 'ready' : t === 'hunt' || t === 'warden' ? 'wait' : null;

/** The mark over Thornwick's reeve, by the same rule as the harbourmaster's. */
export const reeveMarker = (s: GameState) => chainMark(s.quest.sixth);

/** The mark over Highmoor's Steward. */
export const stewardMarker = (s: GameState) => chainMark(s.quest.seventh);

/** The mark over the Spire's Keeper: '?' once Vael is dead and the last hand-in waits, grey while the Vault is open and he is not. */
export const keeperMarker = (s: GameState) => s.quest.eighth === 'closing' ? 'ready' : s.quest.eighth === 'cleared' ? 'wait' : chainMark(s.quest.eighth);

/** Which marker floats over the Warden: '!' he has something to offer, '?' he is waiting for you, grey he is not, none for nothing left to say. */
export function npcMarker(s: GameState): 'offer' | 'ready' | 'wait' | null {
  const { stage, second } = s.quest;
  if (stage !== 'done') return stage === 'offer' ? 'offer' : stage === 'report1' || stage === 'report2' ? 'ready' : 'wait';
  return second === 'offer' ? 'offer' : second === 'report' ? 'ready' : second === 'cleared' ? null : 'wait';
}

// ---------- tracker ----------

export interface QuestLine { text: string; done: boolean }
export interface QuestView {
  title: string;
  lines: QuestLine[];
  target: { x: number; z: number; label: string } | null; // where to go next, for the HUD arrow
  ready: boolean;                                          // true when only a conversation is left
  stageNo: number;                                         // 1-based, within the chain
  progress: string;                                        // "(3/6)" for the tracker title; empty once the chain is done
}

const nearest = <T extends { x: number; z: number }>(s: GameState, list: T[]): T | undefined =>
  list.slice().sort((a, b) => Math.hypot(a.x - s.player.x, a.z - s.player.z) - Math.hypot(b.x - s.player.x, b.z - s.player.z))[0];

const enemyTarget = (s: GameState, type: string) => {
  const all = s.enemies.filter(e => e.type === type);
  const e = nearest(s, all.filter(x => x.state !== 'dead')) ?? nearest(s, all.map(x => ({ x: x.spawnX, z: x.spawnZ })));
  return e ? { x: e.x, z: e.z, label: ENEMY_TYPES[type].name } : null;
};
/**
 * The nearest node of a type the tracker can honestly point at: one on the player's own side of the cave mouth first. Since the Hollow's seam
 * became tin (HOM-81) the nearest tin rock to the ridge is three rooms into a dungeon, and a tracker that says "practise on tin" must not be
 * the thing that walks a Mining 3 character past the Cave Brute. Only if there is none out here does it fall back to the whole list.
 */
const nodeTarget = (s: GameState, type: string) => {
  const all = s.nodes.filter(n => n.type === type);
  const here = inCave(s.player.x, s.player.z);
  const near = all.filter(n => inCave(n.x, n.z) === here);
  const pick = (ns: typeof all) => nearest(s, ns.filter(x => x.charges > 0)) ?? nearest(s, ns);
  const n = pick(near.length ? near : all);
  return n ? { x: n.x, z: n.z, label: NODE_TYPES[type].name } : null;
};

/** Where to practise Mining before iron opens: the rock whose ore the bag has fewer of, so the copper and the tin come out even for the bars. */
const practiceTarget = (s: GameState) => {
  const tinOpen = s.player.skills.mining.level >= NODE_TYPES.tin.level;
  return nodeTarget(s, tinOpen && countItem(s.player.inventory, 'tin_ore') < countItem(s.player.inventory, 'copper_ore') ? 'tin' : 'copper');
};

export function questView(s: GameState): QuestView {
  const q = s.quest, have = (id: string) => countItem(s.player.inventory, id);
  const stageNo = QUEST_STAGES.indexOf(q.stage) + 1;
  const talk = (what: string) => ({ text: `${what} (click or press V)`, done: false });
  const npcTarget = { x: NPC.x, z: NPC.z, label: NPC.name };
  const progress = stageNo >= QUEST_STAGES.length ? '' : `(${stageNo}/${QUEST_STAGES.length - 1})`;
  const v = (lines: QuestLine[], target: QuestView['target'], ready = false): QuestView => ({ title: QUEST_NAME, lines, target, ready, stageNo, progress });

  switch (q.stage) {
    case 'offer': return v([talk(`Speak to ${NPC.name} in the clearing`)], npcTarget, true);
    case 'hunt': {
      const lines = Object.entries(HUNT_GOALS).map(([t, n]) => {
        const k = Math.min(n, q.kills[t] ?? 0);
        return { text: `${PLURAL[t]} slain: ${k}/${n}`, done: k >= n };
      });
      const open = Object.entries(HUNT_GOALS).find(([t, n]) => (q.kills[t] ?? 0) < n)!;
      return v(lines, enemyTarget(s, open[0]));
    }
    case 'report1': return v([{ text: 'Hunt complete', done: true }, talk(`Return to ${NPC.name}`)], npcTarget, true);
    case 'forge': {
      const P = BLADE_PLAN, steel = have('steel_bar'), bars = have('iron_bar') + steel;
      // ore/coal count what was already smelted, so progress never goes backwards at the forge
      const ore = Math.min(P.ore, have('iron_ore') + 2 * have('iron_bar') + 2 * steel);
      const coal = Math.min(P.coal, have('coal') + 2 * steel);
      const logs = Math.min(P.logs, have('logs'));
      const coalLocked = s.player.skills.mining.level < NODE_TYPES.coal.level;
      const gathered = ore >= P.ore && coal >= P.coal && logs >= P.logs;
      const ironLocked = s.player.skills.mining.level < NODE_TYPES.iron.level;
      const lines: QuestLine[] = [
        { text: `Mine Iron Ore: ${ore}/${P.ore}${ore < P.ore && ironLocked ? ` (needs Mining ${NODE_TYPES.iron.level}: practise on copper and tin)` : ''}`, done: ore >= P.ore },
        { text: `Mine Coal: ${coal}/${P.coal}${coal < P.coal && coalLocked ? ` (needs Mining ${NODE_TYPES.coal.level})` : ''}`, done: coal >= P.coal },
        { text: `Chop Logs: ${logs}/${P.logs}`, done: logs >= P.logs },
      ];
      let target: QuestView['target'];
      if (ore < P.ore && ironLocked) target = practiceTarget(s);
      else if (ore < P.ore || (coal < P.coal && coalLocked)) target = nodeTarget(s, 'iron');
      else if (coal < P.coal) target = nodeTarget(s, 'coal');
      else if (logs < P.logs) target = nodeTarget(s, 'tree');
      else target = { x: LANDMARKS.forge.x, z: LANDMARKS.forge.z, label: 'Forge' };
      if (gathered) {
        const b = Math.min(P.bars, bars), st = Math.min(P.steel, steel);
        const ironLevel = recipeById('iron_bar')!.level, steelLevel = recipeById('steel_bar')!.level, smithing = s.player.skills.smithing.level;
        const gate = smithing < ironLevel ? ` (needs Smithing ${ironLevel}: smelt Copper Bars here, or Bronze from copper and tin, to practise)` : smithing < steelLevel ? ` (Steel needs Smithing ${steelLevel})` : '';
        lines.push({ text: `Smelt Iron Bars at the forge: ${b}/${P.bars}${b < P.bars ? gate : ''}`, done: b >= P.bars });
        if (b >= P.bars) lines.push({ text: `Harden Steel Bars: ${st}/${P.steel}`, done: st >= P.steel });
        if (st >= P.steel) lines.push({ text: "Forge the Forgemaster's Blade", done: false });
      }
      return v(lines, target);
    }
    case 'brute': {
      const lvl = s.player.combat.level, equipped = s.player.equipment.weapon === 'forged_blade';
      const lines: QuestLine[] = [
        { text: "Forgemaster's Blade forged", done: true },
        { text: equipped ? 'Blade equipped' : 'Equip the blade (press I, click it)', done: equipped },
        { text: 'Slay the Cave Brute (north-west cave mouth)', done: false },
      ];
      if (lvl < RECOMMENDED_COMBAT) lines.push({ text: `Recommended Combat ${RECOMMENDED_COMBAT} (you are ${lvl})`, done: false });
      return v(lines, enemyTarget(s, 'brute'));
    }
    case 'report2': return v([{ text: 'Cave Brute slain', done: true }, talk(`Return to ${NPC.name} for your reward`)], npcTarget, true);
    case 'done': return { title: QUEST_NAME, lines: [{ text: 'Quest complete. The clearing is safe.', done: true }], target: null, ready: false, stageNo, progress };
  }
}

/** The first chain's tracker until it is handed in, then the second's. This is what the HUD shows; `questView` stays the first chain only. */
export function activeQuestView(s: GameState): QuestView {
  const q = s.quest;
  if ((q.fourth === 'carry' || q.fourth === 'report') && s.player.x > EAST_OF_HALE) return errandView(s); // out on the road the errand is what you are doing
  if (q.stage !== 'done' || q.second === 'locked') return questView(s);
  if (q.seventh === 'cleared' && q.eighth !== 'locked') return sealView(s);
  if (q.sixth === 'cleared' && q.seventh !== 'locked') return moorView(s);
  if (q.fifth === 'cleared' && q.sixth !== 'locked') return rotrootView(s);
  if (q.third === 'cleared' && q.fifth !== 'locked') return brineView(s);
  if (q.second === 'cleared' && q.third !== 'locked') return saltRoadView(s);
  const have = (id: string) => countItem(s.player.inventory, id);
  const stageNo = QUEST2_STAGES.indexOf(q.second); // 'offer' is 1: stage 0 is the lock
  const total = QUEST2_STAGES.indexOf('cleared') - 1;
  const v = (lines: QuestLine[], target: QuestView['target'], ready = false): QuestView =>
    ({ title: QUEST2_NAME, lines, target, ready, stageNo, progress: q.second === 'cleared' ? '' : `(${stageNo}/${total})` });
  const npcTarget = { x: NPC.x, z: NPC.z, label: NPC.name };
  const lvl = s.player.combat.level;
  const advice = (n: number): QuestLine[] => lvl < n ? [{ text: `Recommended Combat ${n} (you are ${lvl})`, done: false }] : [];

  switch (q.second) {
    case 'offer': return v([{ text: `${QUEST_NAME} complete`, done: true }, { text: `${NPC.name} has one more task (click or press V)`, done: false }], npcTarget, true);
    case 'delve': {
      const P = STEEL_PLAN, ore = Math.min(P.ore, ironOre(s)), locked = s.player.skills.mining.level < NODE_TYPES.iron.level;
      const open = Object.entries(DELVE_GOALS).find(([t, n]) => (q.kills[t] ?? 0) < n);
      const lines: QuestLine[] = [
        { text: `Mine Iron Ore: ${ore}/${P.ore}${ore < P.ore && locked ? ` (needs Mining ${NODE_TYPES.iron.level}: practise on copper and tin)` : ''}`, done: ore >= P.ore },
        ...Object.entries(DELVE_GOALS).map(([t, n]) => ({ text: `${PLURAL[t]} slain: ${Math.min(n, q.kills[t] ?? 0)}/${n}`, done: (q.kills[t] ?? 0) >= n })),
        ...advice(RECOMMENDED_COMBAT_2),
      ];
      // practise on copper and tin until iron opens; then the road's iron; then the pack that holds the hollow
      const target = ore < P.ore ? locked ? practiceTarget(s) : nodeTarget(s, 'iron') : open ? enemyTarget(s, open[0]) : null;
      return v(lines, target);
    }
    case 'armour': {
      const P = STEEL_PLAN, bars = steelBars(s), iron = ironBars(s);
      const coal = Math.min(P.coal, have('coal') + 2 * bars);
      const ironLevel = recipeById('iron_bar')!.level, barLevel = recipeById('steel_bar')!.level;
      const smithing = s.player.skills.smithing.level;
      const lines: QuestLine[] = [
        { text: `Mine Coal: ${coal}/${P.coal}`, done: coal >= P.coal },
        { text: `Smelt Iron Bars at the forge: ${Math.min(P.iron, iron)}/${P.iron}${iron < P.iron && smithing < ironLevel ? ` (needs Smithing ${ironLevel})` : ''}`, done: iron >= P.iron },
        { text: `Harden Steel Bars: ${Math.min(P.bars, bars)}/${P.bars}${bars < P.bars && smithing < barLevel ? ` (needs Smithing ${barLevel})` : ''}`, done: bars >= P.bars },
        ...STEEL_SET.map(id => {
          const need = recipeById(id)!.level, has = owned(s, id) > 0;
          return { text: `Smith the ${ITEMS[id].name}${!has && smithing < need ? ` (needs Smithing ${need})` : ''}`, done: has };
        }),
      ];
      const target = coal < P.coal ? nodeTarget(s, 'coal') : { x: LANDMARKS.forge.x, z: LANDMARKS.forge.z, label: 'Forge' };
      return v(lines, target);
    }
    case 'warden':
      return v([
        { text: 'Steel set forged', done: true },
        { text: `Wear the steel set (press I): ${worn(s)}/${STEEL_SET.length}`, done: worn(s) === STEEL_SET.length },
        { text: 'Slay the Hollow Warden (the deep hall, far end of the cave)', done: false },
        ...advice(RECOMMENDED_COMBAT_2 + 1),
      ], enemyTarget(s, 'warden'));
    case 'report': return v([{ text: 'Hollow Warden slain', done: true }, { text: `Return to ${NPC.name} for your reward (click or press V)`, done: false }], npcTarget, true);
    case 'cleared': return v([{ text: 'Quest complete. The Hollow is quiet.', done: true }], null);
  }
}


/** The third chain's tracker, once the Hollow is quiet: Saltmarrow's road. */
function saltRoadView(s: GameState): QuestView {
  const q = s.quest, lvl = s.player.combat.level, stageNo = QUEST3_STAGES.indexOf(q.third); // 'offer' is 1: stage 0 is the lock
  const total = QUEST3_STAGES.indexOf('cleared') - 1;
  const talk = (what: string) => ({ text: `${what} (click or press V)`, done: false });
  const target = { x: HARBOURMASTER.x, z: HARBOURMASTER.z, label: HARBOURMASTER.name };
  const v = (lines: QuestLine[], t: QuestView['target'], ready = false): QuestView =>
    ({ title: QUEST3_NAME, lines, target: t, ready, stageNo, progress: q.third === 'cleared' ? '' : `(${stageNo}/${total})` });
  switch (q.third) {
    case 'hunt': {
      const open = Object.entries(SALT_GOALS).find(([t, n]) => (q.kills[t] ?? 0) < n);
      const lines: QuestLine[] = [
        ...Object.entries(SALT_GOALS).map(([t, n]) => ({ text: `${PLURAL[t]} slain: ${Math.min(n, q.kills[t] ?? 0)}/${n}`, done: (q.kills[t] ?? 0) >= n })),
        ...(lvl < RECOMMENDED_COMBAT_3 ? [{ text: `Recommended Combat ${RECOMMENDED_COMBAT_3} (you are ${lvl})`, done: false }] : []),
      ];
      return v(lines, open ? enemyTarget(s, open[0]) : null);
    }
    case 'report': return v([{ text: 'The toll camp is cleared', done: true }, talk(`Return to ${HARBOURMASTER.name} for your reward`)], target, true);
    case 'cleared': return v([{ text: 'Quest complete. The road is open.', done: true }], null);
    default: return v([talk(`Speak to ${HARBOURMASTER.name} on the quay`)], target, true); // offer
  }
}

/** The fifth chain's tracker (the bible's Q4): the Strand's drowned, then Pell, then the open door and the Captain behind it. */
function brineView(s: GameState): QuestView {
  const q = s.quest, lvl = s.player.combat.level, stageNo = QUEST5_STAGES.indexOf(q.fifth); // 'offer' is 1: stage 0 is the lock
  const total = QUEST5_STAGES.indexOf('cleared') - 1;
  const talk = (what: string) => ({ text: `${what} (click or press V)`, done: false });
  const target = { x: HARBOURMASTER.x, z: HARBOURMASTER.z, label: HARBOURMASTER.name };
  const v = (lines: QuestLine[], t: QuestView['target'], ready = false): QuestView =>
    ({ title: QUEST5_NAME, lines, target: t, ready, stageNo, progress: q.fifth === 'cleared' ? '' : `(${stageNo}/${total})` });
  switch (q.fifth) {
    case 'hunt': {
      const open = Object.entries(BRINE_GOALS).find(([t, n]) => (q.kills[t] ?? 0) < n);
      const lines: QuestLine[] = [
        ...Object.entries(BRINE_GOALS).map(([t, n]) => ({ text: `${PLURAL[t]} slain: ${Math.min(n, q.kills[t] ?? 0)}/${n}`, done: (q.kills[t] ?? 0) >= n })),
        ...(lvl < RECOMMENDED_COMBAT_5 ? [{ text: `Recommended Combat ${RECOMMENDED_COMBAT_5} (you are ${lvl})`, done: false }] : []),
      ];
      return v(lines, open ? enemyTarget(s, open[0]) : null);
    }
    case 'report': return v([{ text: 'The Strand is quiet', done: true }, talk(`Return to ${HARBOURMASTER.name} for your reward`)], target, true);
    case 'cleared': return v([{ text: 'Quest complete. The door in the cliff stands open.', done: true }, { text: 'Captain Marrow holds the Drowned Grotto (north cliff of Saltmarrow)', done: false }], enemyTarget(s, 'captain_marrow'));
    default: return v([talk(`Speak to ${HARBOURMASTER.name} on the quay`)], target, true); // offer
  }
}

/** The sixth chain's tracker (the bible's Q5): the cult's wood, then the reeve, then the open mouth and the Mother behind it. */
function rotrootView(s: GameState): QuestView {
  const q = s.quest, lvl = s.player.combat.level, stageNo = QUEST6_STAGES.indexOf(q.sixth); // 'offer' is 1: stage 0 is the lock
  const total = QUEST6_STAGES.indexOf('cleared') - 1;
  const talk = (what: string) => ({ text: `${what} (click or press V)`, done: false });
  const target = { x: THORN_REEVE.x, z: THORN_REEVE.z, label: THORN_REEVE.name };
  const v = (lines: QuestLine[], t: QuestView['target'], ready = false): QuestView =>
    ({ title: QUEST6_NAME, lines, target: t, ready, stageNo, progress: q.sixth === 'cleared' ? '' : `(${stageNo}/${total})` });
  switch (q.sixth) {
    case 'hunt': {
      const open = Object.entries(ROT_GOALS).find(([t, n]) => (q.kills[t] ?? 0) < n);
      const lines: QuestLine[] = [
        ...Object.entries(ROT_GOALS).map(([t, n]) => ({ text: `${PLURAL[t]} slain: ${Math.min(n, q.kills[t] ?? 0)}/${n}`, done: (q.kills[t] ?? 0) >= n })),
        ...(lvl < RECOMMENDED_COMBAT_6 ? [{ text: `Recommended Combat ${RECOMMENDED_COMBAT_6} (you are ${lvl})`, done: false }] : []),
      ];
      return v(lines, open ? enemyTarget(s, open[0]) : null);
    }
    case 'report': return v([{ text: 'The Thornwood is quiet', done: true }, talk(`Return to ${THORN_REEVE.name} for your reward`)], target, true);
    case 'cleared': return v([{ text: 'Quest complete. The mouth in the roots is open.', done: true }, { text: 'The Rotroot Mother holds the last chamber (south edge of the Thornwood)', done: false }], enemyTarget(s, 'rotroot_mother'));
    default: return v([talk(`Speak to ${THORN_REEVE.name} in Thornwick`)], target, true); // offer
  }
}

/** The seventh chain's tracker (the bible's Q6): the moor's raiders and ogres, then the Steward, then Corvin's open gate. */
function moorView(s: GameState): QuestView {
  const q = s.quest, lvl = s.player.combat.level, stageNo = QUEST7_STAGES.indexOf(q.seventh); // 'offer' is 1: stage 0 is the lock
  const total = QUEST7_STAGES.indexOf('cleared') - 1;
  const talk = (what: string) => ({ text: `${what} (click or press V)`, done: false });
  const target = { x: HIGH_STEWARD.x, z: HIGH_STEWARD.z, label: HIGH_STEWARD.name }, corvin = GATES.find(g => g.id === 'cairnwaste')!;
  const v = (lines: QuestLine[], t: QuestView['target'], ready = false): QuestView =>
    ({ title: QUEST7_NAME, lines, target: t, ready, stageNo, progress: q.seventh === 'cleared' ? '' : `(${stageNo}/${total})` });
  switch (q.seventh) {
    case 'hunt': {
      const open = Object.entries(MOOR_GOALS).find(([t, n]) => (q.kills[t] ?? 0) < n);
      const lines: QuestLine[] = [
        ...Object.entries(MOOR_GOALS).map(([t, n]) => ({ text: `${PLURAL[t]} slain: ${Math.min(n, q.kills[t] ?? 0)}/${n}`, done: (q.kills[t] ?? 0) >= n })),
        ...(lvl < RECOMMENDED_COMBAT_7 ? [{ text: `Recommended Combat ${RECOMMENDED_COMBAT_7} (you are ${lvl})`, done: false }] : []),
      ];
      return v(lines, open ? enemyTarget(s, open[0]) : null);
    }
    case 'report': return v([{ text: 'The moor is quiet', done: true }, talk(`Return to ${HIGH_STEWARD.name} for your writ`)], target, true);
    case 'cleared': return v([{ text: 'Quest complete. The writ is signed: the north road is open.', done: true }, { text: 'Watchman Corvin keeps the gate (the north wall of Highmoor)', done: false }], { x: corvin.post.x, z: corvin.post.z, label: corvin.keeper });
    default: return v([talk(`Speak to ${HIGH_STEWARD.name} in Highmoor`)], target, true); // offer
  }
}

/** The eighth chain's tracker (the bible's Q7): the ruins' lesser wards, then the Warden, then the Keeper, then the Vault's shut door. */
function sealView(s: GameState): QuestView {
  const q = s.quest, lvl = s.player.combat.level, stageNo = QUEST8_STAGES.indexOf(q.eighth); // 'offer' is 1: stage 0 is the lock
  const total = QUEST8_STAGES.indexOf('cleared') - 1;
  const talk = (what: string) => ({ text: `${what} (click or press V)`, done: false });
  const target = { x: SPIRE_KEEPER.x, z: SPIRE_KEEPER.z, label: SPIRE_KEEPER.name }, thale = GATES.find(g => g.id === 'vault')!;
  const v = (lines: QuestLine[], t: QuestView['target'], ready = false): QuestView =>
    ({ title: QUEST8_NAME, lines, target: t, ready, stageNo, progress: sealRead(s) ? '' : `(${stageNo}/${total})` });
  const goals = Object.entries(SEAL_GOALS).map(([t, n]) => ({ text: `${PLURAL[t]} slain: ${Math.min(n, q.kills[t] ?? 0)}/${n}`, done: (q.kills[t] ?? 0) >= n }));
  const advice = lvl < RECOMMENDED_COMBAT_8 ? [{ text: `Recommended Combat ${RECOMMENDED_COMBAT_8} (you are ${lvl})`, done: false }] : [];
  switch (q.eighth) {
    case 'hunt': {
      const open = Object.entries(SEAL_GOALS).find(([t, n]) => (q.kills[t] ?? 0) < n);
      return v([...goals, ...advice], open ? enemyTarget(s, open[0]) : null);
    }
    case 'warden': return v([...goals, { text: 'Slay the Spire Warden (the head of the ruins, south of the Vault corridor)', done: false }, ...advice], enemyTarget(s, 'spire_warden'));
    case 'report': return v([{ text: 'The Spire Warden is slain', done: true }, talk(`Return to ${SPIRE_KEEPER.name} for your reward`)], target, true);
    case 'cleared': return v([{ text: 'The seal is read. Wardkeeper Thale will open the Vault door (the north wall of the Spire)', done: true },
      { text: 'Slay Archmage Vael (the Vault: down the stair, through the archive, in the sanctum)', done: false }, ...(lvl < RECOMMENDED_COMBAT_VAEL ? [{ text: `Recommended Combat ${RECOMMENDED_COMBAT_VAEL} (you are ${lvl})`, done: false }] : [])],
      s.player.z < thale.at ? enemyTarget(s, 'archmage_vael') : { x: thale.post.x, z: thale.post.z, label: thale.keeper });
    case 'closing': return v([{ text: 'Archmage Vael is slain', done: true }, talk(`Return to ${SPIRE_KEEPER.name} for your reward`)], target, true);
    case 'done': return v([{ text: 'Quest complete. The Vault is quiet and the seal reads nothing.', done: true }], null);
    default: return v([talk(`Speak to ${SPIRE_KEEPER.name} in the Spire`)], target, true); // offer
  }
}

/** Past Hale's east wall (x = 30): from here the tracker follows the errand rather than the Hale chains. */
const EAST_OF_HALE = 34;

/** The fourth chain's tracker: what is still to gather, the nearest node that gives it, then the quay. */
function errandView(s: GameState): QuestView {
  const have = (id: string) => countItem(s.player.inventory, id), ready = s.quest.fourth === 'report';
  const lines: QuestLine[] = ERRAND_GOODS.map(g => {
    const n = Math.min(g.n, have(g.item));
    return { text: `${g.name}: ${n}/${g.n}`, done: n >= g.n };
  });
  const open = ERRAND_GOODS.find(g => have(g.item) < g.n);
  const target = open ? nodeTarget(s, open.node) : { x: HARBOURMASTER.x, z: HARBOURMASTER.z, label: HARBOURMASTER.name };
  if (ready) lines.push({ text: `Bring them to ${HARBOURMASTER.name} in Saltmarrow (click or press V)`, done: false });
  return { title: QUEST4_NAME, lines, target, ready, stageNo: ready ? 2 : 1, progress: `(${ready ? 2 : 1}/2)` };
}
