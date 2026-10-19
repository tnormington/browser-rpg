// Parallel skills: each is an XpTrack on the shared RuneScape curve (sim/xp.ts). No classes.
import type { GameState } from '../sim';
import { XpTrack, addXp, newTrack } from './xp';

export type SkillId = 'combat' | 'mining' | 'woodcutting' | 'smithing' | 'fishing' | 'cooking';
export const SKILL_IDS: SkillId[] = ['combat', 'mining', 'woodcutting', 'smithing', 'fishing', 'cooking'];

export const SKILLS: Record<SkillId, { name: string; icon: string; verb: string; made: string }> = {
  combat: { name: 'Combat', icon: '⚔', verb: 'fight', made: 'Fought' },
  mining: { name: 'Mining', icon: '⛏', verb: 'mine', made: 'Mined' },
  woodcutting: { name: 'Woodcutting', icon: '🪓', verb: 'chop', made: 'Chopped' },
  smithing: { name: 'Smithing', icon: '🔨', verb: 'smith', made: 'Smithed' },
  fishing: { name: 'Fishing', icon: '🎣', verb: 'fish', made: 'Caught' },
  cooking: { name: 'Cooking', icon: '🍳', verb: 'cook', made: 'Cooked' },
};

export type Skills = Record<SkillId, XpTrack>;

export const newSkills = (): Skills => ({
  combat: newTrack(), mining: newTrack(), woodcutting: newTrack(), smithing: newTrack(), fishing: newTrack(), cooking: newTrack(),
});

/** Adds xp to a skill, raising xp / levelup events. Returns levels gained (combat callers refresh stats on > 0). */
export function grantXp(s: GameState, skill: SkillId, amount: number, x: number, z: number): number {
  const gained = addXp(s.player.skills[skill], amount);
  s.events.push({ t: 'xp', skill, amount, x, z });
  if (gained > 0) s.events.push({ t: 'levelup', skill, level: s.player.skills[skill].level });
  return gained;
}
