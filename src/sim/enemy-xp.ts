// What a combat kill pays above level 40 (docs/combat-99.md section 2, HOM-169). Up to 40 a trash kill is `20 + level`, as every authored
// row has it; above it the cost of a level grows 10 % a level and the reward follows the cost, not the number printed on the enemy
// (the way a mining swing pays a share of its node's level). Pure: no state, so a writ and an Echo can resolve against the same function.
import { xpForLevel, MAX_LEVEL } from './xp';

/** The one coefficient of the pace: mean kills a level at combat 98. 46 (flat) is 30 hours from 41 to 99, 90 is 44, 150 is 64 (section 1.3). */
export const K98 = 90;
/** Mean kills a level at combat 40, where the authored rows leave off: `cost(40) / (20 + 40) / 1.4345` is 46. */
export const K40 = 46;
/** A mean kill is 1.51 x a trash kill by XP, less 0.95 for drift (section 1.2): the share of a mean kill that a trash kill is. */
export const MEAN_KILL = 1.4345;
/** Above this level the reward is the rule and not `20 + level`. */
export const LAST_AUTHORED_LEVEL = 40;

export type EnemyRole = 'trash' | 'elite' | 'rare' | 'boss';
/** Time-fair: an elite is about 3 trash fights of work, a rare 6, a boss 10 (the multiples every authored row already has). */
export const ROLE_XP: Record<EnemyRole, number> = { trash: 1, elite: 3, rare: 6, boss: 10 };

/** XP from level `l` to the next. Level 99 has no next, so it costs what 98 does. */
export const cost = (l: number): number => {
  const at = Math.min(Math.max(1, Math.round(l)), MAX_LEVEL - 1);
  return xpForLevel(at + 1) - xpForLevel(at);
};

/** Mean kills a level at combat `l`: linear from K40 at 40 to K98 at 98. */
export const kpl = (l: number): number => K40 + (K98 - K40) * (l - LAST_AUTHORED_LEVEL) / (98 - LAST_AUTHORED_LEVEL);

/** XP a trash kill of level `e` pays at parity: the one function the writ and the Echo share. */
export const trashXp = (e: number): number =>
  e <= LAST_AUTHORED_LEVEL ? 20 + e : cost(Math.min(e, MAX_LEVEL - 1)) / (MEAN_KILL * kpl(Math.min(e, MAX_LEVEL - 1)));

/** What a row of level `e` and `role` is worth before `xpParity`. */
export const enemyXp = (e: number, role: EnemyRole): number => Math.round(trashXp(e) * ROLE_XP[role]);
