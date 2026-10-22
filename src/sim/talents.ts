// Talent trees: WoW's specialisations. One point per combat level from TALENT_START_LEVEL, spent in three trees; a tier
// opens once enough has been spent in that same tree, so depth costs breadth. Every tier below the capstone offers two
// talents and you cannot afford both of everything, so a tree is a route through it rather than a list to tick off.
//
// Two gates, not one. The tier's points are the floor; a talent may also name a `prereq`, a talent that must already be
// at full rank. Prerequisites are what make the branch mean something: Ruin is bought on the back of Overpower, Berserk
// on the back of Brutality, and the two cannot both be had early.
//
// All but the capstones change how a button the player already has behaves: combat reads a single derived TalentEffects
// record (the same shape of contract as DerivedStats in sim/items), never the ranks. The capstone of each tree is the
// exception, and the only one: it hands over a new ability, gated by `AbilityDef.talent` exactly as a trainer's ability
// is gated by `AbilityDef.trainer`.
import type { GameState } from '../sim';
import { ABILITIES } from './data';
import { resizeHp } from './consumables';

export type TreeId = 'fury' | 'bulwark' | 'hunt';
export const TREE_IDS: TreeId[] = ['fury', 'bulwark', 'hunt'];
export const TREES: Record<TreeId, { name: string; icon: string; blurb: string }> = {
  fury: { name: 'Fury', icon: '🔥', blurb: 'Hit harder and swing faster.' },
  bulwark: { name: 'Bulwark', icon: '🛡', blurb: 'Take less, heal more, punish casters.' },
  hunt: { name: 'Hunt', icon: '🩸', blurb: 'Bleeds, crits and crowds.' },
};

/**
 * Points that must already be spent in a tree before its tier opens. Index is the tier. Tier 4 is the capstone (one talent, one ability) and tier 5 (docs/combat-99.md 6.2) is the tree
 * past it: 18 is every rank the tree had, so it opens for a player who finished the tree and for no other, and five talents of four ranks (20) are what the 44 points past level 55 buy.
 */
export const TIER_COST = [0, 2, 4, 8, 12, 18];
/** The tier the capstone ability sits on: the last of the tiers that is a choice between two. */
export const CAPSTONE_TIER = 4;
export const TALENT_START_LEVEL = 2; // the combat level that hands over the first point
/** Talent points a player of this combat level has in total, spent or not. */
export const talentPoints = (level: number) => Math.max(0, level - TALENT_START_LEVEL + 1);

/** Crushing Blow's bonus against a target this far into its health, and how much more it hits for there. */
export const EXECUTE_UNDER = 0.35, EXECUTE_BONUS = 0.5;
/** The share of health Berserk and Guardian call "wounded": below this, one hits harder and the other takes less. */
export const WOUNDED_UNDER = 0.5;

export interface TalentDef {
  id: string;
  tree: TreeId;
  tier: number;
  name: string;
  ranks: number;
  /** Another talent in the same tree that must be at full rank first. The tier's points are not the only gate. */
  prereq?: string;
  /** What the talent does at `rank` ranks, in the player's words. */
  desc: (rank: number) => string;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export const TALENTS: TalentDef[] = [
  // ---- Fury: everything you swing hits harder, and it swings more often ----
  { id: 'brutality', tree: 'fury', tier: 0, name: 'Brutality', ranks: 3,
    desc: r => `Everything you hit for deals ${pct(0.05 * r)} more damage.` },
  { id: 'overpower', tree: 'fury', tier: 0, name: 'Overpower', ranks: 3,
    desc: r => `Strike, your cheapest hit, deals ${pct(0.12 * r)} more damage.` },
  { id: 'frenzy', tree: 'fury', tier: 1, name: 'Frenzy', ranks: 2,
    desc: r => `Your auto-attack swings ${pct(0.1 * r)} faster. The swings get quicker; each one hits the same.` },
  { id: 'relentless', tree: 'fury', tier: 1, name: 'Relentless', ranks: 2,
    desc: r => `You crit ${pct(0.03 * r)} more often, and Crushing Blow comes back ${r}s sooner.` },
  { id: 'execute', tree: 'fury', tier: 2, name: 'Execute', ranks: 1,
    desc: () => `Crushing Blow deals ${pct(EXECUTE_BONUS)} more damage below ${pct(EXECUTE_UNDER)} health, and its cooldown resets if the blow kills.` },
  { id: 'ruin', tree: 'fury', tier: 2, name: 'Ruin', ranks: 2, prereq: 'overpower',
    desc: r => `Your critical hits deal ${pct(0.15 * r)} more damage on top of the crit itself.` },
  { id: 'berserk', tree: 'fury', tier: 3, name: 'Berserk', ranks: 2, prereq: 'brutality',
    desc: r => `Below ${pct(WOUNDED_UNDER)} health you deal ${pct(0.08 * r)} more damage. Cornered is where you are worst to meet.` },
  { id: 'unbridled', tree: 'fury', tier: 3, name: 'Unbridled', ranks: 2, prereq: 'frenzy',
    desc: r => `Every auto-attack swing gives you back ${3 * r} energy.` },
  { id: 'bloodthirst', tree: 'fury', tier: 4, name: 'Bloodthirst', ranks: 1, prereq: 'execute',
    desc: () => 'Teaches Bloodthirst: a heavy melee hit that heals you for a quarter of what it deals.' },

  // ---- Bulwark: what reaches you is smaller, and what you do about it is bigger ----
  { id: 'toughened', tree: 'bulwark', tier: 0, name: 'Toughened', ranks: 3,
    desc: r => `You take ${pct(0.04 * r)} less damage, on top of your armour.` },
  { id: 'bastion', tree: 'bulwark', tier: 0, name: 'Bastion', ranks: 3,
    desc: r => `Your maximum health is ${pct(0.05 * r)} higher.` },
  { id: 'rally', tree: 'bulwark', tier: 1, name: 'Rally', ranks: 2,
    desc: r => `Second Wind heals ${pct(0.25 * r)} more and comes back ${3 * r}s sooner.` },
  { id: 'stalwart', tree: 'bulwark', tier: 1, name: 'Stalwart', ranks: 2,
    desc: r => `Anything you stagger stays stunned ${(0.4 * r).toFixed(1)}s longer, and Pummel comes back ${2 * r}s sooner.` },
  { id: 'counterstrike', tree: 'bulwark', tier: 2, name: 'Counterstrike', ranks: 1,
    desc: () => 'Pummel costs half the cooldown, and a landed interrupt gives you back 30 energy.' },
  { id: 'thickskin', tree: 'bulwark', tier: 2, name: 'Thick Skin', ranks: 2, prereq: 'toughened',
    desc: r => `Telegraphed slams and marked ground hit you for ${pct(0.12 * r)} less. The ones you could not step out of hurt least.` },
  { id: 'guardian', tree: 'bulwark', tier: 3, name: 'Guardian', ranks: 2, prereq: 'bastion',
    desc: r => `Below ${pct(WOUNDED_UNDER)} health you take ${pct(0.1 * r)} less damage.` },
  { id: 'vigour', tree: 'bulwark', tier: 3, name: 'Vigour', ranks: 2, prereq: 'rally',
    desc: r => `Out of combat you heal ${pct(0.75 * r)} faster, and you leave combat ${r}s sooner.` },
  { id: 'ironwill', tree: 'bulwark', tier: 4, name: 'Iron Will', ranks: 1, prereq: 'counterstrike',
    desc: () => 'Teaches Shield Bash: off the global cooldown, it staggers anything you hit, wind-up or no wind-up.' },

  // ---- Hunt: the wound you opened is what kills, and there is never only one of them ----
  { id: 'serration', tree: 'hunt', tier: 0, name: 'Serration', ranks: 3,
    desc: r => `Serrated Throw's bleed ticks for ${pct(0.25 * r)} more.` },
  { id: 'predator', tree: 'hunt', tier: 0, name: 'Predator', ranks: 3,
    desc: r => `You deal ${pct(0.04 * r)} more damage to anything that is already bleeding.` },
  { id: 'whirling', tree: 'hunt', tier: 1, name: 'Whirling', ranks: 2,
    desc: r => `Cleave sweeps ${20 * r} degrees wider and costs ${5 * r} less energy.` },
  { id: 'rending', tree: 'hunt', tier: 1, name: 'Rending', ranks: 2,
    desc: r => `Your bleeds run for ${r} more tick${r > 1 ? 's' : ''}.` },
  { id: 'bloodscent', tree: 'hunt', tier: 2, name: 'Bloodscent', ranks: 1,
    desc: () => 'You crit 6% more often, and every critical hit adds two ticks to the bleed on its target.' },
  { id: 'carnage', tree: 'hunt', tier: 2, name: 'Carnage', ranks: 2, prereq: 'predator',
    desc: r => `Cleave and Whirlwind deal ${pct(0.12 * r)} more damage to everything they catch.` },
  { id: 'exsanguinate', tree: 'hunt', tier: 3, name: 'Exsanguinate', ranks: 2, prereq: 'serration',
    desc: r => `Your bleeds tick ${pct(0.2 * r)} faster: the same wound, emptied sooner.` },
  { id: 'opportunist', tree: 'hunt', tier: 3, name: 'Opportunist', ranks: 2, prereq: 'rending',
    desc: r => `Every critical hit gives you back ${10 * r} energy.` },
  { id: 'hemorrhage', tree: 'hunt', tier: 4, name: 'Hemorrhage', ranks: 1, prereq: 'bloodscent',
    desc: () => 'Teaches Hemorrhage: tears the bleed off your target from range, dealing everything it had left at once.' },

  // ---- Past the capstones (docs/combat-99.md 6.2, HOM-176): five of four ranks a tree, opening at 18 points. Nothing here is a prerequisite: the tier only opens to a finished tree ----
  { id: 'annihilator', tree: 'fury', tier: 5, name: 'Annihilator', ranks: 4,
    desc: r => `Your heavy hits (Crushing Blow, Colossus Blow, Reaping Blow, Bloodthirst, Final Reckoning) deal ${pct(0.06 * r)} more damage.` },
  { id: 'momentum', tree: 'fury', tier: 5, name: 'Momentum', ranks: 4,
    desc: r => `Every kill gives you back ${8 * r} energy: the next fight starts with the last one's breath.` },
  { id: 'savagery', tree: 'fury', tier: 5, name: 'Savagery', ranks: 4,
    desc: r => `Your auto-attack swings hit for ${pct(0.08 * r)} more.` },
  { id: 'warcry', tree: 'fury', tier: 5, name: 'Warcry', ranks: 4,
    desc: r => `Battle Fury hits ${pct(0.04 * r)} harder still: ${pct(0.15 + 0.04 * r)} in all.` },
  { id: 'cull', tree: 'fury', tier: 5, name: 'Cull', ranks: 4,
    desc: r => `Everything you deal hits ${pct(0.06 * r)} harder against a target below ${pct(EXECUTE_UNDER)} health.` },

  { id: 'triumph', tree: 'bulwark', tier: 5, name: 'Triumph', ranks: 4,
    desc: r => `Every kill heals you for ${pct(0.02 * r)} of your maximum health.` },
  { id: 'steadfast', tree: 'bulwark', tier: 5, name: 'Steadfast', ranks: 4,
    desc: r => `Guard and Rampart take ${pct(0.1 * r)} more of what is left off: the hit that still gets through is smaller.` },
  { id: 'concussion', tree: 'bulwark', tier: 5, name: 'Concussion', ranks: 4,
    desc: r => `Shield Bash comes back ${3 * r}s sooner.` },
  { id: 'adrenaline', tree: 'bulwark', tier: 5, name: 'Adrenaline', ranks: 4,
    desc: r => `Every hit that lands on you gives you back ${3 * r} energy.` },
  { id: 'deflection', tree: 'bulwark', tier: 5, name: 'Deflection', ranks: 4,
    desc: r => `Bolts from a distance hurt you ${pct(0.06 * r)} less.` },

  { id: 'openveins', tree: 'hunt', tier: 5, name: 'Open Veins', ranks: 4,
    desc: r => `Serrated Throw comes back ${(1.5 * r).toFixed(1).replace('.0', '')}s sooner.` },
  { id: 'farreach', tree: 'hunt', tier: 5, name: 'Far Reach', ranks: 4,
    desc: r => `Cleave, Whirlwind, Shockwave and Bloodbath reach ${(0.4 * r).toFixed(1)} units further.` },
  { id: 'lifeblood', tree: 'hunt', tier: 5, name: 'Lifeblood', ranks: 4,
    desc: r => `Every tick of a bleed you opened heals you for ${(0.3 * r).toFixed(1)}% of your maximum health.` },
  { id: 'predatoreye', tree: 'hunt', tier: 5, name: "Predator's Eye", ranks: 4,
    desc: r => `You crit ${pct(0.03 * r)} more often against anything that is bleeding.` },
  { id: 'rupture', tree: 'hunt', tier: 5, name: 'Rupture', ranks: 4,
    desc: r => `Hemorrhage pays out ${pct(0.15 * r)} more of the bleed it tears off.` },
];

/** Ranks taken, by talent id. A talent absent from the record has never been bought. */
export type Talents = Record<string, number>;
export const newTalents = (): Talents => ({});

/**
 * THE talent calculation. Combat reads only this, never the ranks, so a new talent is a line here and a line where it
 * bites rather than a condition threaded through the rules.
 */
export interface TalentEffects {
  damage: number;         // multiplier on every point of damage the player deals
  strikeBonus: number;    // multiplier on Strike's own damage
  swingSpeed: number;     // multiplier on the auto-attack interval (below 1 is faster)
  swingEnergy: number;    // energy an auto-attack swing gives back
  crit: number;           // added critical chance
  critMult: number;       // added to the critical multiplier
  critEnergy: number;     // energy a critical hit gives back
  critBleed: number;      // bleed ticks a critical hit adds to its target
  crushCdCut: number;     // seconds off Crushing Blow's cooldown
  lowHpDamage: number;    // multiplier on damage dealt while the player is wounded
  executeUnder: number;   // health fraction below which Crushing Blow is empowered; 0 when untalented
  reduction: number;      // damage reduction added on top of armour's, under the same cap
  heavyReduction: number; // further reduction, applied only to telegraphed slams and marked ground
  lowHpReduction: number; // ...and only while the player is wounded
  maxHp: number;          // multiplier on maximum health
  healBonus: number;      // multiplier on Second Wind
  healCdCut: number;      // seconds off Second Wind's cooldown
  oocRegen: number;       // multiplier on out-of-combat health regeneration
  oocDelayCut: number;    // seconds off the wait before it starts
  pummelCdMult: number;   // multiplier on Pummel's cooldown
  pummelCdCut: number;    // ...and seconds off what that leaves
  pummelEnergy: number;   // energy a landed interrupt gives back
  staggerBonus: number;   // seconds added to every stagger the player lands
  bleedBonus: number;     // multiplier on bleed tick damage
  bleedTicks: number;     // ticks added to a bleed the player applies
  bleedInterval: number;  // multiplier on the seconds between bleed ticks (below 1 is faster)
  bleedHunter: number;    // multiplier on damage dealt to a target that is bleeding
  cleaveArc: number;      // extra degrees on Cleave's cone
  cleaveCost: number;     // energy off Cleave
  cleaveDamage: number;   // multiplier on what a sweep deals
  heavyHit: number;       // multiplier on the heavy strikes (every strike that is not Strike itself)
  killEnergy: number;     // energy a kill gives back
  swingDamage: number;    // multiplier on an auto-attack swing's damage
  furyBonus: number;      // added to Battle Fury's damage multiplier
  cull: number;           // multiplier on everything dealt to a target below executeUnder's health
  killHeal: number;       // share of maximum health a kill heals
  guardDeepen: number;    // share of a guard buff's remaining damage taken that is taken off again (Guard, Rampart)
  bashCdCut: number;      // seconds off Shield Bash's cooldown
  hurtEnergy: number;     // energy every hit that lands on the player gives back
  rangedReduction: number; // further reduction on a bolt from a distance
  throwCdCut: number;     // seconds off Serrated Throw's cooldown
  sweepReach: number;     // world units added to a sweep's reach
  bleedHeal: number;      // share of maximum health a bleed tick heals
  bleedCrit: number;      // added critical chance against a target that is bleeding
  burstBonus: number;     // multiplier on the bleed Hemorrhage spends
}

export function deriveTalents(t: Talents): TalentEffects {
  const r = (id: string) => t[id] ?? 0;
  return {
    damage: 1 + 0.05 * r('brutality'),
    strikeBonus: 1 + 0.12 * r('overpower'),
    swingSpeed: 1 - 0.1 * r('frenzy'),
    swingEnergy: 3 * r('unbridled'),
    crit: 0.06 * r('bloodscent') + 0.03 * r('relentless'),
    critMult: 0.15 * r('ruin'),
    critEnergy: 10 * r('opportunist'),
    critBleed: 2 * r('bloodscent'),
    crushCdCut: r('relentless'),
    lowHpDamage: 1 + 0.08 * r('berserk'),
    executeUnder: r('execute') ? EXECUTE_UNDER : 0,
    reduction: 0.04 * r('toughened'),
    heavyReduction: 0.12 * r('thickskin'),
    lowHpReduction: 0.1 * r('guardian'),
    maxHp: 1 + 0.05 * r('bastion'),
    healBonus: 1 + 0.25 * r('rally'),
    healCdCut: 3 * r('rally'),
    oocRegen: 1 + 0.75 * r('vigour'),
    oocDelayCut: r('vigour'),
    pummelCdMult: r('counterstrike') ? 0.5 : 1,
    pummelCdCut: 2 * r('stalwart'),
    pummelEnergy: 30 * r('counterstrike'),
    staggerBonus: 0.4 * r('stalwart'),
    bleedBonus: 1 + 0.25 * r('serration'),
    bleedTicks: r('rending'),
    bleedInterval: 1 - 0.2 * r('exsanguinate'),
    bleedHunter: 1 + 0.04 * r('predator'),
    cleaveArc: 20 * r('whirling'),
    cleaveCost: 5 * r('whirling'),
    cleaveDamage: 1 + 0.12 * r('carnage'),
    heavyHit: 1 + 0.06 * r('annihilator'),
    killEnergy: 8 * r('momentum'),
    swingDamage: 1 + 0.08 * r('savagery'),
    furyBonus: 0.04 * r('warcry'),
    cull: 1 + 0.06 * r('cull'),
    killHeal: 0.02 * r('triumph'),
    guardDeepen: 0.1 * r('steadfast'),
    bashCdCut: 3 * r('concussion'),
    hurtEnergy: 3 * r('adrenaline'),
    rangedReduction: 0.06 * r('deflection'),
    throwCdCut: 1.5 * r('openveins'),
    sweepReach: 0.4 * r('farreach'),
    bleedHeal: 0.003 * r('lifeblood'),
    bleedCrit: 0.03 * r('predatoreye'),
    burstBonus: 1 + 0.15 * r('rupture'),
  };
}

export const talentById = (id: string): TalentDef | undefined => TALENTS.find(t => t.id === id);
export const spentIn = (t: Talents, tree: TreeId) => TALENTS.reduce((n, d) => n + (d.tree === tree ? t[d.id] ?? 0 : 0), 0);
export const spentTotal = (t: Talents) => TALENTS.reduce((n, d) => n + (t[d.id] ?? 0), 0);
/** The ability slot a capstone hands over, or -1 for the talents that only bend what you already have. */
export const abilityFromTalent = (id: string) => ABILITIES.findIndex(a => a.talent === id);
/** Has the talent this one is built on been taken all the way? True for the talents that ask for nothing. */
export const prereqMet = (t: Talents, def: TalentDef) =>
  !def.prereq || (t[def.prereq] ?? 0) >= (talentById(def.prereq)?.ranks ?? Infinity);

export type TalentFail = 'unknown' | 'maxrank' | 'points' | 'tier' | 'prereq' | 'combat';

/** Why this rank cannot be bought right now, or null when it can. Combat is checked by the caller, which has the state. */
export function learnBlocked(t: Talents, level: number, id: string): TalentFail | null {
  const def = talentById(id);
  if (!def) return 'unknown';
  if ((t[id] ?? 0) >= def.ranks) return 'maxrank';
  if (spentTotal(t) >= talentPoints(level)) return 'points';
  if (spentIn(t, def.tree) < TIER_COST[def.tier]) return 'tier';
  if (!prereqMet(t, def)) return 'prereq';
  return null;
}

/** Ranks held in a tree in tiers below `tier`: what had to be bought before that tier's first rank could be (its own ranks, and the ones above, come after). */
const spentBelow = (t: Talents, tree: TreeId, tier: number) => TALENTS.reduce((n, d) => n + (d.tree === tree && d.tier < tier ? t[d.id] ?? 0 : 0), 0);

/** True when a saved build could have been bought legally at that level: no unknown ids, no over-spend, no skipped tier or prerequisite. */
export function legalTalents(t: Talents, level: number): boolean {
  if (spentTotal(t) > talentPoints(level)) return false;
  return TALENTS.every(d => {
    const n = t[d.id] ?? 0;
    return n === 0 || (n <= d.ranks && spentBelow(t, d.tree, d.tier) >= TIER_COST[d.tier] && prereqMet(t, d));
  });
}

export function refreshTalents(s: GameState) {
  s.player.talentFx = deriveTalents(s.player.talents);
  resizeHp(s.player); // Bastion: the health it adds arrives (and leaves) with the rank
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
  const slot = abilityFromTalent(id); // a capstone hands over its ability the same way a level does
  if (slot >= 0) s.events.push({ t: 'unlock', slot, level: p.combat.level });
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
