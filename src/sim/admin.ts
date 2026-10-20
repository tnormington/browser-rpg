// QA tools as sim actions (HOM-114): set the combat level, put the player anywhere on the map, put any item in the bag,
// so a late-game fight, gate or recipe can be reached without playing up to it. Pure sim like every other action, so the
// panel and the tests drive the same code. Nothing in the game itself issues one of these: main.ts only hands the HUD an
// `admin` callback behind the dev flag (the dev server, or ?debug=1), and without that callback no panel is ever built.
import type { GameState } from '../sim';
import { MAX_LEVEL, xpForLevel } from './xp';
import { ITEMS } from './items';
import { addItem } from './inventory';
import { refreshPlayerStats } from './combat';
import { PLAYER_RADIUS, REGIONS, Rect, TOWNS, clampToWorld, resolveCollisions } from './world';

/** The most of one item a single grant may add: more than a bag of full stacks holds, and far more than a test needs. */
export const MAX_GRANT = 999;

export type AdminAction =
  | { k: 'level'; level: number }
  | { k: 'teleport'; x: number; z: number }
  | { k: 'give'; id: string; qty: number };

export function applyAdminAction(s: GameState, act: AdminAction) {
  if (act.k === 'level') setCombatLevel(s, act.level);
  else if (act.k === 'teleport') teleport(s, act.x, act.z);
  else giveItem(s, act.id, act.qty);
}

/**
 * Put the player at a combat level outright: the XP that level costs, the health and energy that come with it. The abilities
 * are not handed over here — combat's own announcement does that on the next tick, so a jump to 30 arrives with its spells and
 * its banners. Winding the level back winds `unlocked` back with it, so climbing again announces them a second time.
 */
export function setCombatLevel(s: GameState, level: number) {
  const p = s.player;
  if (!Number.isFinite(level)) return;
  const want = Math.max(1, Math.min(MAX_LEVEL, Math.round(level)));
  p.combat.xp = xpForLevel(want);
  p.combat.level = want;
  p.unlocked = Math.min(p.unlocked, want);
  refreshPlayerStats(s, true);
  p.energy = p.maxEnergy;
}

/**
 * Stand the player on the nearest walkable floor to (x, z). Whatever they were in the middle of is over: a gather, a craft
 * or a flight, the walk they were on, the target they held, and the net holding their feet, none of which travel with them.
 */
export function teleport(s: GameState, x: number, z: number) {
  const p = s.player;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return;
  const at = clampToWorld({ x, z }, PLAYER_RADIUS);
  p.x = at.x; p.z = at.z;
  resolveCollisions(p, PLAYER_RADIUS);
  p.y = 0; p.vy = 0; p.airborne = false; p.moving = false;
  p.action = null;
  p.root = null;
  s.moveTarget = null; s.interact = null; s.targetId = null; s.tab = null;
}

/** Put `qty` of an item in the bag. What arrives is reported as loot, and what will not fit says so, as any pickup does. */
export function giveItem(s: GameState, id: string, qty: number) {
  if (!ITEMS[id] || !Number.isFinite(qty)) return;
  const want = Math.max(1, Math.min(MAX_GRANT, Math.round(qty)));
  const left = addItem(s.player.inventory, id, want);
  if (left < want) s.events.push({ t: 'loot', item: id, qty: want - left });
  if (left > 0) s.events.push({ t: 'invfull' });
}

/** Somewhere the panel can send you: `group` is the heading it sits under. */
export interface Destination { group: string; name: string; x: number; z: number }

const area = (r: Rect) => (r.x1 - r.x0) * (r.z1 - r.z0);
/** The middle of the largest rectangle of a region's floor: a corridor into it is not where "take me to the Fens" means. */
const middleOf = (rects: Rect[]) => {
  const r = rects.reduce((best, x) => (area(x) > area(best) ? x : best));
  return clampToWorld({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 });
};

/** Everywhere the panel offers: each town's waking spot, then the middle of every region, dungeon rooms and all. */
export const destinations = (): Destination[] => [
  ...TOWNS.map(t => ({ group: 'Towns', name: t.name, x: t.wake.x, z: t.wake.z })),
  ...REGIONS.map(r => ({ group: 'Regions', name: r.name, ...middleOf(r.footprint) })),
];
