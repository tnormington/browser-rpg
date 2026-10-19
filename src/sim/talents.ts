// Talent trees: WoW's specialisations, scaled to a six-button kit. One point per combat level from TALENT_START_LEVEL,
// spent in three trees; a tier opens once enough has been spent in that same tree, so depth costs breadth.
//
// Not one talent adds an ability. Every one of them changes how a button the player already has behaves, which is what
// keeps the action bar the same shape whatever you pick and keeps the sim honest: combat reads a single derived
// TalentEffects record (the same shape of contract as DerivedStats in sim/items), never the ranks.
import type { GameState } from '../sim';

export type TreeId = 'fury' | 'bulwark' | 'hunt';
export const TREE_IDS: TreeId[] = ['fury', 'bulwark', 'hunt'];
export const TREES: Record<TreeId, { name: string; icon: string; blurb: string }> = {
  fury: { name: 'Fury', icon: '🔥', blurb: 'Hit harder and swing faster.' },
  bulwark: { name: 'Bulwark', icon: '🛡', blurb: 'Take less, heal more, punish casters.' },
  hunt: { name: 'Hunt', icon: '🩸', blurb: 'Bleeds, crits and crowds.' },
};

/** Points that must already be spent in a tree before its tier opens. Index is the tier. */
export const TIER_COST = [0, 2, 4];
export const TALENT_START_LEVEL = 2; // the combat level that hands over the first point
/** Talent points a player of this combat level has in total, spent or not. */
export const talentPoints = (level: number) => Math.max(0, level - TALENT_START_LEVEL + 1);

/** Crushing Blow's bonus against a target this far into its health, and how much more it hits for there. */
export const EXECUTE_UNDER = 0.35, EXECUTE_BONUS = 0.5;

export interface TalentDef {
  id: string;
  tree: TreeId;
  tier: number;
  name: string;
  ranks: number;
  /** What the talent does at `rank` ranks, in the player's words. */
  desc: (rank: number) => string;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export const TALENTS: TalentDef[] = [
  { id: 'brutality', tree: 'fury', tier: 0, name: 'Brutality', ranks: 3,
    desc: r => `Everything you hit for deals ${pct(0.05 * r)} more damage.` },
  { id: 'frenzy', tree: 'fury', tier: 1, name: 'Frenzy', ranks: 2,
    desc: r => `Your auto-attack swings ${pct(0.1 * r)} faster. The swings get quicker; each one hits the same.` },
  { id: 'execute', tree: 'fury', tier: 2, name: 'Execute', ranks: 1,
    desc: () => `Crushing Blow deals ${pct(EXECUTE_BONUS)} more damage below ${pct(EXECUTE_UNDER)} health, and its cooldown resets if the blow kills.` },

  { id: 'toughened', tree: 'bulwark', tier: 0, name: 'Toughened', ranks: 3,
    desc: r => `You take ${pct(0.04 * r)} less damage, on top of your armour.` },
  { id: 'rally', tree: 'bulwark', tier: 1, name: 'Rally', ranks: 2,
    desc: r => `Second Wind heals ${pct(0.25 * r)} more and comes back ${3 * r}s sooner.` },
  { id: 'counterstrike', tree: 'bulwark', tier: 2, name: 'Counterstrike', ranks: 1,
    desc: () => 'Pummel costs half the cooldown, and a landed interrupt gives you back 30 energy.' },

  { id: 'serration', tree: 'hunt', tier: 0, name: 'Serration', ranks: 3,
    desc: r => `Serrated Throw's bleed ticks for ${pct(0.25 * r)} more.` },
  { id: 'whirling', tree: 'hunt', tier: 1, name: 'Whirling', ranks: 2,
    desc: r => `Cleave sweeps ${20 * r} degrees wider and costs ${5 * r} less energy.` },
  { id: 'bloodscent', tree: 'hunt', tier: 2, name: 'Bloodscent', ranks: 1,
    desc: () => 'You crit 6% more often, and every critical hit adds two ticks to the bleed on its target.' },
];

/** Ranks taken, by talent id. A talent absent from the record has never been bought. */
export type Talents = Record<string, number>;
export const newTalents = (): Talents => ({});

/**
 * THE talent calculation. Combat reads only this, never the ranks, so a new talent is a line here and a line where it
 * bites rather than a condition threaded through the rules.
 */
export interface TalentEffects {
  damage: number;        // multiplier on every point of damage the player deals
  swingSpeed: number;    // multiplier on the auto-attack interval (below 1 is faster)
  reduction: number;     // damage reduction added on top of armour's, under the same cap
  healBonus: number;     // multiplier on Second Wind
  healCdCut: number;     // seconds off Second Wind's cooldown
  pummelCdMult: number;  // multiplier on Pummel's cooldown
  pummelEnergy: number;  // energy a landed interrupt gives back
  bleedBonus: number;    // multiplier on bleed tick damage
  cleaveArc: number;     // extra degrees on Cleave's cone
  cleaveCost: number;    // energy off Cleave
  crit: number;          // added critical chance
  critBleed: number;     // bleed ticks a critical hit adds to its target
  executeUnder: number;  // health fraction below which Crushing Blow is empowered; 0 when untalented
}

export function deriveTalents(t: Talents): TalentEffects {
  const r = (id: string) => t[id] ?? 0;
  return {
    damage: 1 + 0.05 * r('brutality'),
    swingSpeed: 1 - 0.1 * r('frenzy'),
    reduction: 0.04 * r('toughened'),
    healBonus: 1 + 0.25 * r('rally'),
    healCdCut: 3 * r('rally'),
    pummelCdMult: r('counterstrike') ? 0.5 : 1,
    pummelEnergy: 30 * r('counterstrike'),
    bleedBonus: 1 + 0.25 * r('serration'),
    cleaveArc: 20 * r('whirling'),
    cleaveCost: 5 * r('whirling'),
    crit: 0.06 * r('bloodscent'),
    critBleed: 2 * r('bloodscent'),
    executeUnder: r('execute') ? EXECUTE_UNDER : 0,
  };
}

export const talentById = (id: string): TalentDef | undefined => TALENTS.find(t => t.id === id);
export const spentIn = (t: Talents, tree: TreeId) => TALENTS.reduce((n, d) => n + (d.tree === tree ? t[d.id] ?? 0 : 0), 0);
export const spentTotal = (t: Talents) => TALENTS.reduce((n, d) => n + (t[d.id] ?? 0), 0);

export type TalentFail = 'unknown' | 'maxrank' | 'points' | 'tier' | 'combat';

/** Why this rank cannot be bought right now, or null when it can. Combat is checked by the caller, which has the state. */
export function learnBlocked(t: Talents, level: number, id: string): TalentFail | null {
  const def = talentById(id);
  if (!def) return 'unknown';
  if ((t[id] ?? 0) >= def.ranks) return 'maxrank';
  if (spentTotal(t) >= talentPoints(level)) return 'points';
  if (spentIn(t, def.tree) < TIER_COST[def.tier]) return 'tier';
  return null;
}

/** True when a saved build could have been bought legally at that level: no unknown ids, no over-spend, no skipped tier. */
export function legalTalents(t: Talents, level: number): boolean {
  if (spentTotal(t) > talentPoints(level)) return false;
  return TALENTS.every(d => {
    const n = t[d.id] ?? 0;
    return n === 0 || (n <= d.ranks && spentIn(t, d.tree) >= TIER_COST[d.tier]);
  });
}

export function refreshTalents(s: GameState) {
  s.player.talentFx = deriveTalents(s.player.talents);
}

/** Buy a rank. Talents are a plan, not a trick played mid-fight, so they are out-of-combat only, as in WoW. */
export function learnTalent(s: GameState, id: string) {
  const p = s.player;
  if (p.inCombat || p.dead) return void s.events.push({ t: 'talentfail', reason: 'combat', id });
  const why = learnBlocked(p.talents, p.combat.level, id);
  if (why) return void s.events.push({ t: 'talentfail', reason: why, id });
  p.talents[id] = (p.talents[id] ?? 0) + 1;
  refreshTalents(s);
  s.events.push({ t: 'talent', id, rank: p.talents[id] });
}

/** Hand every point back. Free: the fun is in trying builds, not in being punished for one. */
export function resetTalents(s: GameState) {
  const p = s.player;
  if (!spentTotal(p.talents)) return;
  if (p.inCombat || p.dead) return void s.events.push({ t: 'talentfail', reason: 'combat', id: '' });
  p.talents = newTalents();
  refreshTalents(s);
  s.events.push({ t: 'talentreset' });
}
