// Parallel skills: each is an XpTrack on the shared RuneScape curve (sim/xp.ts). No classes.
import type { GameState } from '../sim';
import { XpTrack, addXp, newTrack } from './xp';

export type SkillId = 'combat' | 'mining' | 'woodcutting' | 'smithing' | 'fishing' | 'cooking' | 'herbalism' | 'alchemy' | 'leatherworking' | 'enchanting' | 'agility';
export const SKILL_IDS: SkillId[] = ['combat', 'mining', 'woodcutting', 'smithing', 'fishing', 'cooking', 'herbalism', 'alchemy', 'leatherworking', 'enchanting', 'agility'];

export const SKILLS: Record<SkillId, { name: string; icon: string; verb: string; made: string }> = {
  combat: { name: 'Combat', icon: '⚔', verb: 'fight', made: 'Fought' },
  mining: { name: 'Mining', icon: '⛏', verb: 'mine', made: 'Mined' },
  woodcutting: { name: 'Woodcutting', icon: '🪓', verb: 'chop', made: 'Chopped' },
  smithing: { name: 'Smithing', icon: '🔨', verb: 'smith', made: 'Smithed' },
  fishing: { name: 'Fishing', icon: '🎣', verb: 'fish', made: 'Caught' },
  cooking: { name: 'Cooking', icon: '🍳', verb: 'cook', made: 'Cooked' },
  herbalism: { name: 'Herbalism', icon: '🌿', verb: 'pick', made: 'Picked' },
  alchemy: { name: 'Alchemy', icon: '⚗', verb: 'brew', made: 'Brewed' },
  leatherworking: { name: 'Leatherworking', icon: '🧵', verb: 'tan', made: 'Made' },
  enchanting: { name: 'Enchanting', icon: '✨', verb: 'enchant', made: 'Enchanted' },
  agility: { name: 'Agility', icon: '🏃', verb: 'run', made: 'Ran' },
};

export type Skills = Record<SkillId, XpTrack>;

export const newSkills = (): Skills => ({
  combat: newTrack(), mining: newTrack(), woodcutting: newTrack(), smithing: newTrack(), fishing: newTrack(), cooking: newTrack(),
  herbalism: newTrack(), alchemy: newTrack(), leatherworking: newTrack(), enchanting: newTrack(), agility: newTrack(),
});

/** The sum of every skill's level: what the second stablemaster asks for (bible 4). */
export const totalLevel = (skills: Skills) => SKILL_IDS.reduce((n, id) => n + skills[id].level, 0);

/** Adds xp to a skill, raising xp / levelup events. Returns levels gained (combat callers refresh stats on > 0). */
export function grantXp(s: GameState, skill: SkillId, amount: number, x: number, z: number): number {
  const gained = addXp(s.player.skills[skill], amount);
  s.events.push({ t: 'xp', skill, amount, x, z });
  if (gained > 0) s.events.push({ t: 'levelup', skill, level: s.player.skills[skill].level });
  return gained;
}
