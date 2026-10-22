// The chests (HOM-158, docs/action-layer.md 7): the reason to leave the road. Fifty are planned, in three tiers by what it takes to reach one,
// and none respawns: a chest is found once, which is the whole point of hiding it. What is in one is coin, Agility XP and (hoards only) a lantern,
// and nothing else, because every item in the game sells for its `value` and a chest of items would compete with every other source at once.
// Pure sim, like every other action: the renderer draws what CHESTS says and the E key calls openChest.
//
// All fifty are placed: the 18 stashes, which need nothing but the legs to find, and the 17 caches and 15 hoards on the steps and rooftops of perches.ts.
// A chest declared at a tier its route cannot honour is a lie in the journal, so src/reach.test.ts holds every declared tier to the route it needs (reach.ts).
import type { GameState, Player } from '../sim';
import { PERCHES } from './perches';
import { grantXp } from './skills';
import { xpForLevel } from './xp';
import { MAX_GOLD } from './shop';
import { PLAYER_RADIUS, perchAt } from './world';
import { REACH } from './actions';
import { DOUBLE_JUMP_LEVEL } from './agility';

export type ChestTier = 'stash' | 'cache' | 'hoard';

/** What each tier pays, as a share of a mean kill's drops in coin (0.6 L + 3, 7.3) and of the level the player is on in Agility XP. */
export const TIERS: Record<ChestTier, { coin: number; lamp: number; needs: string }> = {
  stash: { coin: 0.5, lamp: 0, needs: 'nothing: it is off the road, behind something' },
  cache: { coin: 0.5, lamp: 0.5, needs: 'a hop onto a step' },
  hoard: { coin: 1, lamp: 1, needs: `a second jump, Agility ${DOUBLE_JUMP_LEVEL}` },
};
/** A lamp never pays more than this: the span of level 50 is 10,612, about eleven minutes of sprinting, so the cap bites a hoard from Agility 50. */
export const LAMP_CAP = 10_000;
/** The chest is a 0.8 u prop with no top: you stand beside it, it is not something to climb. */
export const CHEST_R = 0.4;
/** The floor under the player must be within this of the chest's, so a player on the ground cannot open a chest on a rooftop through its footprint. */
export const FLOOR_TOL = 0.3;
/** How many chests the finished game holds, and so the number the journal tells before anything is found (7.5). */
export const CHEST_TOTAL = 50;

export interface Place { id: string; name: string; /** Every region (world.ts) that is part of it: a place is a stretch of the world, not one footprint. */ regions: string[] }
export const PLACES: Place[] = [
  { id: 'hale', name: "Hale's Rest and the ridge", regions: ['clearing', 'ridge', 'seams'] },
  { id: 'hollow', name: 'The Hollow', regions: ['throat', 'hollow', 'neck', 'hall'] },
  { id: 'greywater', name: 'Greywater Road', regions: ['greywater', 'wayside'] },
  { id: 'saltmarrow', name: 'Saltmarrow and the Strand', regions: ['saltmarrow'] },
  { id: 'grotto', name: 'The Drowned Grotto', regions: ['gangway', 'galley', 'hold', 'grottoghost'] },
  { id: 'dunmere', name: 'Dunmere Fens', regions: ['dunmere'] },
  { id: 'thornwick', name: 'Thornwick and the Thornwood', regions: ['thornwick', 'thornseam'] },
  { id: 'rotroot', name: 'The Rotroot', regions: ['mouth', 'warren', 'heart'] },
  { id: 'barrowdowns', name: 'The Barrowdowns', regions: ['barrowdowns'] },
  { id: 'highmoor', name: 'Highmoor and the Moor', regions: ['highmoor'] },
  { id: 'cairnhold', name: 'The Cairn Hold', regions: ['stair', 'ossuary', 'chamber'] },
  { id: 'cairnwaste', name: 'The Cairnwaste', regions: ['cairnwaste'] },
  { id: 'spire', name: 'The Spire and its ruins', regions: ['spire'] },
  { id: 'vault', name: 'The Sundered Vault', regions: ['sealstair', 'archive', 'sanctum'] },
];
export const placeById = (id: string): Place | undefined => PLACES.find(p => p.id === id);
/** The place a region belongs to, for the map's label. */
export const placeOfRegion = (regionId: string): Place | undefined => PLACES.find(p => p.regions.includes(regionId));

export interface ChestDef {
  id: string;
  place: string;
  tier: ChestTier;
  x: number; z: number;
  /** The height of the floor it stands on: 0 on the ground, a rooftop's top for a hoard. Opening needs the player's own floor to match. */
  floor: number;
}

/**
 * Where they are. A stash is 15 to 60 u off the road in open country, 16 u or more from any spawn (the widest notice radius is 12, and 4 is the margin),
 * outside every safe circle, 100 u from the next of its place; a dungeon's rooms are too packed for 16 (the nearest spawn is 8 to 14 u off), and Hale's 60 u
 * square holds eleven spawns, so there a chest need only be 4 u outside the notice radius of every one (10 at the widest). Each one stands 2 to 4 u from something solid, which is what "behind something" is. src/golden-path.test.ts holds all of that to account.
 */
export const CHESTS: ChestDef[] = [
  { id: 'hale-stash-1', place: 'hale', tier: 'stash', x: 28, z: -24, floor: 0 },
  { id: 'hollow-stash-1', place: 'hollow', tier: 'stash', x: -27, z: -89, floor: 0 },
  { id: 'greywater-stash-1', place: 'greywater', tier: 'stash', x: 294, z: 46, floor: 0 },
  { id: 'greywater-stash-2', place: 'greywater', tier: 'stash', x: 584, z: -42, floor: 0 },
  { id: 'saltmarrow-stash-1', place: 'saltmarrow', tier: 'stash', x: 873, z: 48, floor: 0 },
  { id: 'grotto-stash-1', place: 'grotto', tier: 'stash', x: 862, z: -89, floor: 0 },
  { id: 'dunmere-stash-1', place: 'dunmere', tier: 'stash', x: 824, z: 225, floor: 0 },
  { id: 'dunmere-stash-2', place: 'dunmere', tier: 'stash', x: 903, z: 800, floor: 0 },
  { id: 'thornwick-stash-1', place: 'thornwick', tier: 'stash', x: 831, z: 976, floor: 0 },
  { id: 'rotroot-stash-1', place: 'rotroot', tier: 'stash', x: 919, z: 1105, floor: 0 },
  { id: 'barrowdowns-stash-1', place: 'barrowdowns', tier: 'stash', x: 1130, z: 1036, floor: 0 },
  { id: 'barrowdowns-stash-2', place: 'barrowdowns', tier: 'stash', x: 1630, z: 957, floor: 0 },
  { id: 'highmoor-stash-1', place: 'highmoor', tier: 'stash', x: 1926, z: 1007, floor: 0 },
  { id: 'cairnhold-stash-1', place: 'cairnhold', tier: 'stash', x: 1867, z: 889, floor: 0 },
  { id: 'cairnwaste-stash-1', place: 'cairnwaste', tier: 'stash', x: 1999, z: 303, floor: 0 },
  { id: 'cairnwaste-stash-2', place: 'cairnwaste', tier: 'stash', x: 1996, z: 791, floor: 0 },
  { id: 'spire-stash-1', place: 'spire', tier: 'stash', x: 2037, z: -55, floor: 0 },
  { id: 'vault-stash-1', place: 'vault', tier: 'stash', x: 1967, z: -92, floor: 0 },
  // a cache stands on a step and a hoard on a rooftop (perches.ts); the chest is where its perch is, on its top
  ...PERCHES.map((p): ChestDef => ({ id: p.chest, place: placeOfRegion(p.region)!.id, tier: p.tier, x: p.x, z: p.z, floor: p.top })),
];

export const chestById = (id: string): ChestDef | undefined => CHESTS.find(c => c.id === id);
export const chestsIn = (place: string): ChestDef[] => CHESTS.filter(c => c.place === place);

export const isOpened = (p: Player, id: string) => p.chests.includes(id);
/** The journal's and the map's count: one place's ("Greywater 1 / 2"), or all of them when no place is named. */
export function chestCount(p: Player, place?: string): { opened: number; total: number } {
  const of = place === undefined ? CHESTS : chestsIn(place);
  return { opened: of.filter(c => isOpened(p, c.id)).length, total: of.length };
}

/**
 * What a chest of this tier pays a player at these levels. Both are indexed on the *player* at the moment of opening and not on the region, so no
 * chest decays as the player outlevels it (XP parity would floor old content at 10 %) and none inflates: coin is a share of a mean kill's drops at
 * their combat level, and the lamp is a share of the span of the Agility level they are on, capped.
 */
export function chestReward(tier: ChestTier, combatLevel: number, agilityLevel: number): { gold: number; xp: number } {
  const t = TIERS[tier];
  return {
    gold: Math.round(t.coin * (0.6 * combatLevel + 3)),
    xp: Math.min(LAMP_CAP, Math.round(t.lamp * (xpForLevel(agilityLevel + 1) - xpForLevel(agilityLevel)))),
  };
}

/** A chest is "near" inside NEAR_IN and stops being so past NEAR_OUT: the gap keeps a player pacing the edge from re-raising it every step. */
export const CHEST_NEAR_IN = 4;
export const CHEST_NEAR_OUT = 6;

/**
 * One `chestnear` per unopened chest per approach, for the sound of something worth finding. `s.chestsNear` is the set currently inside the
 * ring (run state, not saved): a chest enters it on the way in and leaves it on the way out, so walking away and back is a new approach.
 */
export function stepChestNear(s: GameState) {
  const p = s.player;
  for (const c of CHESTS) {
    const d = Math.hypot(p.x - c.x, p.z - c.z);
    const was = s.chestsNear.indexOf(c.id);
    const near = !p.dead && !isOpened(p, c.id) && Math.abs((perchAt(p.x, p.z, p.y)?.top ?? 0) - c.floor) <= FLOOR_TOL;
    if (was < 0 && near && d <= CHEST_NEAR_IN) { s.chestsNear.push(c.id); s.events.push({ t: 'chestnear', id: c.id }); }
    else if (was >= 0 && (!near || d > CHEST_NEAR_OUT)) s.chestsNear.splice(was, 1);
  }
}

export type ChestFail = 'unknown' | 'opened' | 'dead' | 'far' | 'floor';
export type ChestOutcome = { ok: true; gold: number; xp: number; opened: number; total: number } | { ok: false; why: ChestFail };

/**
 * Open a chest, from where the player stands. It must be within reach (the same gap as any other thing you touch) and opened from the floor it stands
 * on, and it pays once: the id goes into `player.chests`, which the save keeps. A refusal changes nothing and says why; the caller chooses the words.
 */
export function openChest(s: GameState, id: string): ChestOutcome {
  const p = s.player, c = chestById(id);
  if (!c) return { ok: false, why: 'unknown' };
  if (isOpened(p, id)) return { ok: false, why: 'opened' };
  if (p.dead) return { ok: false, why: 'dead' };
  if (Math.hypot(p.x - c.x, p.z - c.z) > CHEST_R + PLAYER_RADIUS + REACH) return { ok: false, why: 'far' };
  if (Math.abs((perchAt(p.x, p.z, p.y)?.top ?? 0) - c.floor) > FLOOR_TOL) return { ok: false, why: 'floor' };
  const { gold, xp } = chestReward(c.tier, p.combat.level, p.skills.agility.level);
  p.chests.push(id);
  p.gold = Math.min(MAX_GOLD, p.gold + gold);
  if (xp > 0) grantXp(s, 'agility', xp, c.x, c.z);
  const { opened, total } = chestCount(p, c.place);
  s.events.push({ t: 'chest', id, tier: c.tier, place: c.place, x: c.x, z: c.z, gold, xp, opened, total });
  return { ok: true, gold, xp, opened, total };
}
