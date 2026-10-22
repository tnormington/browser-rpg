// The boards (HOM-163): a repeatable objective, the reason to go back. A board stands in every town and offers that town's bounties; a bounty is
// accepted, counted as its kills land, turned in at the board that gave it, and then offered again. Nothing here is a number the designer owns: what a
// bounty asks, how it scales with the player and what it pays are all rows in BOUNTIES (HOM-162 fills the reward table; the values there are PLACEHOLDERS).
// Pure sim, like every other action: the renderer draws what BOARDS says and the E key or a click calls the board's panel, which sends BountyActions.
//
// Scaling is data, not code: a `Scale` is a flat number or `base + perLevel * combat level`, read when the bounty is accepted and then written into the
// active entry, so a bounty on the player's page is the bounty they took whatever the table says next. `levelBand` goes the other way and makes the
// target itself follow the player (only enemies within so many levels of you count), which is the shape an endless-tail objective would take.
import type { GameState } from '../sim';
import { ENEMY_TYPES, SPAWNS } from './data';
import { ITEMS } from './items';
import { addItem, hasRoom } from './inventory';
import { grantXp } from './skills';
import { MAX_GOLD } from './shop';
import { LANDMARKS, PLAYER_RADIUS, regionAt } from './world';
import { REACH } from './actions';
import { refreshPlayerStats } from './combat';

/** A number that may depend on the player's combat level: `base + perLevel * level`, rounded, never below 0. */
export type Scale = number | { base: number; perLevel: number };
export const scaled = (v: Scale, level: number): number =>
  Math.max(0, Math.round(typeof v === 'number' ? v : v.base + v.perLevel * level));

export interface BountyDef {
  id: string;
  /** The board (a town id, as TOWNS and BOARDS have it) that offers it and takes it back. */
  board: string;
  name: string;
  text: string;
  /**
   * What counts as a kill for it. Every field narrows: none given means any enemy anywhere. `label` is the plural the panel counts in ("boars slain: 3/8").
   * `levelBand`: the enemy's level must be within this many of the player's combat level when it dies.
   */
  target: { types?: string[]; regions?: string[]; levelBand?: number; label: string };
  /** How many kills, read at accept time. */
  count: Scale;
  reward: { gold: Scale; xp: Scale; items?: { id: string; qty: number }[] };
}

export interface BoardDef { id: string; name: string; x: number; z: number; r: number }
/** One per town, by town id. The landmark is the collider (world.ts), so a board is something you stand beside. */
export const BOARDS: BoardDef[] = [
  { id: 'hale', name: "Hale's Rest Notice Board", ...LANDMARKS.boardHale },
  { id: 'saltmarrow', name: 'Saltmarrow Notice Board', ...LANDMARKS.boardSalt },
  { id: 'thornwick', name: 'Thornwick Notice Board', ...LANDMARKS.boardThorn },
  { id: 'highmoor', name: 'Highmoor Notice Board', ...LANDMARKS.boardHigh },
  { id: 'spire', name: 'Sundered Spire Notice Board', ...LANDMARKS.boardSpire },
];
export const boardById = (id: string) => BOARDS.find(b => b.id === id);

/** Bounties carried at once. */
export const MAX_ACTIVE = 3;
/** The most kills a bounty can ask for: what a save is held to, and what the table is tested against. */
export const MAX_GOAL = 999;
const GOLD_CAP = MAX_GOLD, XP_CAP = 1e7;

// PLACEHOLDER: every reward figure below (and the counts) is a stand-in until HOM-162 rules the table. They are chosen only to be plausible, not balanced.
const PLACEHOLDER_REWARD = { gold: { base: 3, perLevel: 1 }, xp: { base: 20, perLevel: 4 } } as const;
export const BOUNTIES: BountyDef[] = [
  { id: 'hale-boars', board: 'hale', name: 'Thin the Boars', text: 'The boars are rooting up the clearing again.',
    target: { types: ['boar'], regions: ['clearing'], label: 'boars' }, count: 8, reward: PLACEHOLDER_REWARD },
  { id: 'hale-pack', board: 'hale', name: 'Cull the Pack', text: 'Wolves and their pups, where the children play.',
    target: { types: ['wolf', 'pup'], regions: ['clearing'], label: 'wolves and pups' }, count: 10, reward: PLACEHOLDER_REWARD },
  { id: 'salt-crabs', board: 'saltmarrow', name: 'Clear the Strand', text: 'Shore crabs have the nets and the quay.',
    target: { types: ['shore_crab'], regions: ['saltmarrow'], label: 'shore crabs' }, count: 12, reward: PLACEHOLDER_REWARD },
  { id: 'salt-drowned', board: 'saltmarrow', name: 'Quiet the Drowned', text: 'The drowned come ashore at night.',
    target: { types: ['drowned_sailor', 'tide_hag'], regions: ['saltmarrow'], label: 'drowned' }, count: 8, reward: PLACEHOLDER_REWARD },
  { id: 'thorn-thornbacks', board: 'thornwick', name: 'Bark and Bristle', text: 'Thornbacks and blight stags are hemming the town in.',
    target: { types: ['thornback', 'blight_stag'], regions: ['thornwick'], label: 'thornbacks and stags' }, count: 10, reward: PLACEHOLDER_REWARD },
  { id: 'thorn-cultists', board: 'thornwick', name: 'Root and Branch', text: 'The cultists have cut the wood a new road.',
    target: { types: ['rotwood_cultist'], regions: ['thornwick'], label: 'cultists' }, count: 6, reward: PLACEHOLDER_REWARD },
  { id: 'high-rams', board: 'highmoor', name: 'The Moor Provides', text: 'The rams and raiders have not been thinned in a season.',
    target: { types: ['moor_ram', 'moor_raider'], regions: ['highmoor'], label: 'rams and raiders' }, count: 10, reward: PLACEHOLDER_REWARD },
  { id: 'high-ogres', board: 'highmoor', name: 'Stone and Sinew', text: 'The ridge ogres come down at the first snow.',
    target: { types: ['ridge_ogre'], regions: ['highmoor'], label: 'ridge ogres' }, count: 3, reward: PLACEHOLDER_REWARD },
  { id: 'spire-adepts', board: 'spire', name: 'Quiet the Ruins', text: 'Adepts still keep their vigil in the ruins.',
    target: { types: ['spire_adept'], regions: ['spire'], label: 'adepts' }, count: 6, reward: PLACEHOLDER_REWARD },
  // the level-following shape: any enemy near your own level, anywhere, and more of them the further you have come
  { id: 'spire-peace', board: 'spire', name: 'Keep the Peace', text: 'Anything that is your match, wherever it is found.',
    target: { levelBand: 3, label: 'foes of your own mettle' }, count: { base: 8, perLevel: 0.25 }, reward: PLACEHOLDER_REWARD },
];
export const bountyById = (id: string) => BOUNTIES.find(b => b.id === id);
export const bountiesOf = (board: string) => BOUNTIES.filter(b => b.board === board);

/** What the save keeps to know a bounty is still the one it was: change what counts as a kill and the signature changes, so the saved progress is dropped, not mis-applied. */
export const targetSig = (d: BountyDef) => `${(d.target.types ?? []).join(',')}|${(d.target.regions ?? []).join(',')}|${d.target.levelBand ?? ''}`;

export interface ActiveBounty {
  id: string;
  sig: string;
  kills: number;
  /** Resolved when accepted, and what is paid on turn-in: the table moving after that changes the next offer, not this one. */
  goal: number;
  gold: number;
  xp: number;
}
export interface BountyState { active: ActiveBounty[]; done: Record<string, number> }
export const newBounties = (): BountyState => ({ active: [], done: {} });

/** Resolve a bounty's count and reward for a player at this combat level. */
export function resolveBounty(d: BountyDef, level: number): { goal: number; gold: number; xp: number } {
  return { goal: Math.min(MAX_GOAL, Math.max(1, scaled(d.count, level))), gold: Math.min(GOLD_CAP, scaled(d.reward.gold, level)), xp: Math.min(XP_CAP, scaled(d.reward.xp, level)) };
}

/** Whether a kill of this enemy type, in this region, at this combat level counts toward the bounty. */
export function counts(d: BountyDef, type: string, region: string, level: number): boolean {
  const t = d.target, def = ENEMY_TYPES[type];
  if (!def) return false;
  if (t.types && !t.types.includes(type)) return false;
  if (t.regions && !t.regions.includes(region)) return false;
  if (t.levelBand !== undefined && Math.abs(def.level - level) > t.levelBand) return false;
  return true;
}

/**
 * Whether the world holds anything that could finish it for a player at this level. A fixed target always can (the table is tested against the spawns);
 * a level-following one cannot once the player has outgrown every enemy in the band, and a board must not offer a bounty nobody can finish.
 */
export function finishable(d: BountyDef, level: number): boolean {
  return STANDING.some(sp => counts(d, sp.type, sp.region, level));
}
/** Every spawn with the region it stands in, which is the region its enemy reports (sim.ts createState). */
const STANDING = SPAWNS.map(sp => ({ type: sp.type, region: regionAt(sp.x, sp.z)?.id ?? '' }));

export const isActive = (s: GameState, id: string) => s.bounties.active.some(a => a.id === id);
export const timesDone = (s: GameState, id: string) => s.bounties.done[id] ?? 0;
export const isReady = (a: ActiveBounty) => a.kills >= a.goal;

/** The board the player is standing at (nearest in reach), if any. */
export const BOARD_REACH = 1.5;
export const boardNear = (s: GameState): BoardDef | undefined => {
  const p = s.player, gap = (b: BoardDef) => Math.hypot(p.x - b.x, p.z - b.z) - b.r - PLAYER_RADIUS;
  return BOARDS.filter(b => gap(b) <= REACH + BOARD_REACH).sort((a, b) => gap(a) - gap(b))[0];
};

export type BountyAction = { k: 'accept'; id: string } | { k: 'turnin'; id: string } | { k: 'abandon'; id: string };
export type BountyFail = 'unknown' | 'dead' | 'far' | 'active' | 'slots' | 'level' | 'notready' | 'full';
export type BountyOutcome = { ok: true } | { ok: false; why: BountyFail };

const bountyEvent = (s: GameState, what: 'accept' | 'progress' | 'ready' | 'turnin' | 'abandon', d: BountyDef, a: ActiveBounty) =>
  s.events.push({ t: 'bounty', what, id: d.id, name: d.name, kills: a.kills, goal: a.goal, gold: a.gold, xp: a.xp });

/** Take a bounty off the board that offers it. A refusal changes nothing and says why; the panel draws the reason, so the sim does not choose the words. */
export function acceptBounty(s: GameState, id: string): BountyOutcome {
  const d = bountyById(id), p = s.player;
  if (!d) return { ok: false, why: 'unknown' };
  if (p.dead) return { ok: false, why: 'dead' };
  if (boardNear(s)?.id !== d.board) return { ok: false, why: 'far' };
  if (isActive(s, id)) return { ok: false, why: 'active' };
  if (s.bounties.active.length >= MAX_ACTIVE) return { ok: false, why: 'slots' };
  if (!finishable(d, p.combat.level)) return { ok: false, why: 'level' };
  const a: ActiveBounty = { id, sig: targetSig(d), kills: 0, ...resolveBounty(d, p.combat.level) };
  s.bounties.active.push(a);
  bountyEvent(s, 'accept', d, a);
  return { ok: true };
}

/** Hand a finished bounty in at its own board: the gold, the combat XP and the items, and it is on offer again. */
export function turnInBounty(s: GameState, id: string): BountyOutcome {
  const d = bountyById(id), p = s.player, a = s.bounties.active.find(x => x.id === id);
  if (!d || !a) return { ok: false, why: 'unknown' };
  if (p.dead) return { ok: false, why: 'dead' };
  if (boardNear(s)?.id !== d.board) return { ok: false, why: 'far' };
  if (!isReady(a)) return { ok: false, why: 'notready' };
  const items = d.reward.items ?? [];
  if (!items.every(i => ITEMS[i.id] && hasRoom(p.inventory, i.id, i.qty))) return { ok: false, why: 'full' };
  s.bounties.active.splice(s.bounties.active.indexOf(a), 1);
  s.bounties.done[id] = timesDone(s, id) + 1;
  p.gold = Math.min(MAX_GOLD, p.gold + a.gold);
  for (const i of items) addItem(p.inventory, i.id, i.qty);
  bountyEvent(s, 'turnin', d, a);
  if (a.xp > 0 && grantXp(s, 'combat', a.xp, p.x, p.z) > 0) refreshPlayerStats(s, true);
  return { ok: true };
}

/** Drop a bounty you are carrying. It costs nothing and keeps nothing: it is on offer again as if it had never been taken. */
export function abandonBounty(s: GameState, id: string): BountyOutcome {
  const d = bountyById(id), a = s.bounties.active.find(x => x.id === id);
  if (!d || !a) return { ok: false, why: 'unknown' };
  if (s.player.dead) return { ok: false, why: 'dead' };
  s.bounties.active.splice(s.bounties.active.indexOf(a), 1);
  bountyEvent(s, 'abandon', d, a);
  return { ok: true };
}

export function applyBountyAction(s: GameState, act: BountyAction) {
  const out = act.k === 'accept' ? acceptBounty(s, act.id) : act.k === 'turnin' ? turnInBounty(s, act.id) : abandonBounty(s, act.id);
  if (!out.ok && (out.why === 'far' || out.why === 'full')) s.events.push({ t: 'actionfail', reason: out.why === 'far' ? 'range' : 'full', need: 0, what: bountyById(act.id)?.name ?? 'a bounty' });
}

/** Kill credit, called as an enemy dies: every bounty it counts for moves one, and the one that reaches its goal says so. */
export function bountyOnKill(s: GameState, type: string, region: string) {
  const level = s.player.combat.level;
  for (const a of s.bounties.active) {
    const d = bountyById(a.id);
    if (!d || a.kills >= a.goal || !counts(d, type, region, level)) continue;
    a.kills++;
    bountyEvent(s, a.kills >= a.goal ? 'ready' : 'progress', d, a);
  }
}

/** The bounties a board offers, each with whether it can be taken right now and why not. */
export function offers(s: GameState, board: string) {
  const level = s.player.combat.level;
  return bountiesOf(board).map(d => {
    const active = s.bounties.active.find(a => a.id === d.id);
    const now = resolveBounty(d, level);
    const why: BountyFail | null = active ? 'active' : s.bounties.active.length >= MAX_ACTIVE ? 'slots' : !finishable(d, level) ? 'level' : null;
    return { def: d, active, goal: active?.goal ?? now.goal, gold: active?.gold ?? now.gold, xp: active?.xp ?? now.xp, done: timesDone(s, d.id), why };
  });
}
