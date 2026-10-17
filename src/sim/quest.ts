// The quest chain that stitches the golden path together, the NPC's dialogue, and the tracker view. Pure sim.
import type { GameState } from '../sim';
import { LANDMARKS } from './world';
import { ENEMY_TYPES } from './data';
import { SkillId, grantXp } from './skills';
import { NODE_TYPES } from './gathering';
import { recipeById } from './crafting';
import { countItem } from './inventory';
import { refreshPlayerStats } from './combat';

export type QuestStage = 'offer' | 'hunt' | 'report1' | 'forge' | 'brute' | 'report2' | 'done';
export interface QuestState { stage: QuestStage; kills: Record<string, number> }
export const QUEST_STAGES: QuestStage[] = ['offer', 'hunt', 'report1', 'forge', 'brute', 'report2', 'done'];

export const newQuest = (): QuestState => ({ stage: 'offer', kills: {} });

export const QUEST_NAME = 'The Brute of the Cave Mouth';
export const NPC = { name: 'Warden Hale', x: LANDMARKS.npc.x, z: LANDMARKS.npc.z, r: LANDMARKS.npc.r };
export const TALK_RANGE = 7;                       // centre to centre: advancing the quest needs this
export const HUNT_GOALS: Record<string, number> = { boar: 4, wolf: 3 };
const PLURAL: Record<string, string> = { boar: 'Wild Boars', wolf: 'Dire Wolves' };
/**
 * What the Forgemaster's Blade costs in raw terms (see RECIPES), padded to the XP the gates need: Steel wants Smithing 3
 * (five bars of practice, two more than the three the blade uses) and Coal wants Mining 4 (eight ore of XP, ten gathered).
 */
export const BLADE_PLAN = { ore: 10, coal: 6, logs: 1, bars: 5, steel: 3 };
export const RECOMMENDED_COMBAT = 3; // finishing the hunt gets you there; the blade, not the level, is what beats the Brute
export const REWARD: { skill: SkillId; xp: number }[] = [
  { skill: 'combat', xp: 400 }, { skill: 'mining', xp: 150 }, { skill: 'smithing', xp: 150 },
];

export const nearNpc = (s: GameState) => Math.hypot(s.player.x - NPC.x, s.player.z - NPC.z) <= TALK_RANGE;

const hasBlade = (s: GameState) =>
  countItem(s.player.inventory, 'forged_blade') > 0 || Object.values(s.player.equipment).includes('forged_blade');

// ---------- transitions ----------

const questEvent = (s: GameState, what: 'accept' | 'progress' | 'stage' | 'complete') => s.events.push({ t: 'quest', what });

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
  }
}

/** The player picked the "advance" dialogue option. Only meaningful at the three NPC stages, and only in earshot. */
export function advanceQuest(s: GameState) {
  const q = s.quest;
  if (s.player.dead || !nearNpc(s)) return;
  if (q.stage === 'offer') { q.stage = 'hunt'; questEvent(s, 'accept'); }
  else if (q.stage === 'report1') { q.stage = 'forge'; questEvent(s, 'stage'); }
  else if (q.stage === 'report2') {
    q.stage = 'done';
    for (const r of REWARD) if (grantXp(s, r.skill, r.xp, NPC.x, NPC.z) > 0 && r.skill === 'combat') refreshPlayerStats(s, true);
    questEvent(s, 'complete');
  }
}

/** Per tick: the forge stage ends the moment the blade exists (crafted, or already owned when the stage began). */
export function updateQuest(s: GameState) {
  if (s.quest.stage === 'forge' && hasBlade(s)) { s.quest.stage = 'brute'; questEvent(s, 'stage'); }
}

// ---------- dialogue ----------

export interface DialogueOption { label: string; advance?: boolean; reply?: string }
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
        reply: 'Good. Click an enemy (or press Tab) to target it, then press 1-4 to fight. Rest if you are hurt: health returns out of combat. Come back when it is done.' },
      CLOSE('Not right now.'),
    ],
  },
  hunt: {
    lines: ['Still some left out there. The boars wander the edges of the clearing; the wolves keep further out.',
      'Tab targets the nearest enemy. Strike on 1, Crushing Blow on 2, bleed on 3, heal on 4.'],
    options: [CLOSE('Back to it.')],
  },
  report1: {
    lines: [
      'Well fought! The pack is scattered.',
      'But the Cave Brute, in the cave mouth to the north-west, is another matter. It crushed the last hunter who tried, and plain weapons barely scratch it.',
      "You need a better blade. Mine iron ore and coal on the ridge by the cave, chop a log for the hilt, and smith the Forgemaster's Blade at the forge to the east.",
    ],
    options: [
      { label: "I'll forge the blade.", advance: true,
        reply: 'Click an iron rock to mine it. Coal needs Mining 4, so iron first. At the forge, smelt Iron Bars, harden them into Steel Bars, then forge the blade. Equip it from your inventory (I) before you face the Brute.' },
      { label: 'Where is the forge?', reply: 'East of the clearing: the stone hut with the glowing furnace. Click it to open the forge.' },
    ],
  },
  forge: {
    lines: ['How goes the forging? Iron ore and coal from the ridge by the cave, a log for the hilt, then the forge.'],
    options: [
      { label: 'Where do I find ore?', reply: 'The grey rocks with orange flecks are iron, the black seams are coal. Both lie along the ridge south-east of the cave mouth. Keep clear of the Brute itself.' },
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

// ---------- tracker ----------

export interface QuestLine { text: string; done: boolean }
export interface QuestView {
  title: string;
  lines: QuestLine[];
  target: { x: number; z: number; label: string } | null; // where to go next, for the HUD arrow
  ready: boolean;                                          // true when only a conversation is left
  stageNo: number;                                         // 1-based
}

const nearest = <T extends { x: number; z: number }>(s: GameState, list: T[]): T | undefined =>
  list.slice().sort((a, b) => Math.hypot(a.x - s.player.x, a.z - s.player.z) - Math.hypot(b.x - s.player.x, b.z - s.player.z))[0];

const enemyTarget = (s: GameState, type: string) => {
  const all = s.enemies.filter(e => e.type === type);
  const e = nearest(s, all.filter(x => x.state !== 'dead')) ?? nearest(s, all.map(x => ({ x: x.spawnX, z: x.spawnZ })));
  return e ? { x: e.x, z: e.z, label: ENEMY_TYPES[type].name } : null;
};
const nodeTarget = (s: GameState, type: string) => {
  const all = s.nodes.filter(n => n.type === type);
  const n = nearest(s, all.filter(x => x.charges > 0)) ?? nearest(s, all);
  return n ? { x: n.x, z: n.z, label: NODE_TYPES[type].name } : null;
};

export function questView(s: GameState): QuestView {
  const q = s.quest, have = (id: string) => countItem(s.player.inventory, id);
  const stageNo = QUEST_STAGES.indexOf(q.stage) + 1;
  const talk = (what: string) => ({ text: `${what} (click or press E)`, done: false });
  const npcTarget = { x: NPC.x, z: NPC.z, label: NPC.name };
  const v = (lines: QuestLine[], target: QuestView['target'], ready = false): QuestView => ({ title: QUEST_NAME, lines, target, ready, stageNo });

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
      const lines: QuestLine[] = [
        { text: `Mine Iron Ore: ${ore}/${P.ore}`, done: ore >= P.ore },
        { text: `Mine Coal: ${coal}/${P.coal}${coal < P.coal && coalLocked ? ` (needs Mining ${NODE_TYPES.coal.level})` : ''}`, done: coal >= P.coal },
        { text: `Chop Logs: ${logs}/${P.logs}`, done: logs >= P.logs },
      ];
      let target: QuestView['target'];
      if (ore < P.ore || (coal < P.coal && coalLocked)) target = nodeTarget(s, 'iron');
      else if (coal < P.coal) target = nodeTarget(s, 'coal');
      else if (logs < P.logs) target = nodeTarget(s, 'tree');
      else target = { x: LANDMARKS.forge.x, z: LANDMARKS.forge.z, label: 'Forge' };
      if (gathered) {
        const b = Math.min(P.bars, bars), st = Math.min(P.steel, steel);
        const steelLevel = recipeById('steel_bar')!.level, practice = s.player.skills.smithing.level < steelLevel;
        lines.push({ text: `Smelt Iron Bars at the forge: ${b}/${P.bars}${b < P.bars && practice ? ` (Steel needs Smithing ${steelLevel})` : ''}`, done: b >= P.bars });
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
    case 'done': return { title: QUEST_NAME, lines: [{ text: 'Quest complete. The clearing is safe.', done: true }], target: null, ready: false, stageNo };
  }
}
