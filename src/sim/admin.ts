// QA tools as sim actions (HOM-114): set the combat level, put the player anywhere on the map, put any item in the bag,
// so a late-game fight, gate or recipe can be reached without playing up to it. Pure sim like every other action, so the
// panel and the tests drive the same code. Nothing in the game itself issues one of these: main.ts only hands the HUD an
// `admin` callback behind the dev flag (the dev server, or ?debug=1), and without that callback no panel is ever built.
import type { GameState } from '../sim';
import { MAX_LEVEL, xpForLevel } from './xp';
import { ITEMS } from './items';
import { addItem } from './inventory';
import { refreshPlayerStats } from './combat';
import { ENEMY_TYPES, EnemyDef, SPAWNS } from './data';
import { DUNGEONS, PLAYER_RADIUS, REGIONS, Rect, Region, TOWNS, clampToWorld, regionAt, regionById, resolveCollisions } from './world';
import { MAX_GOLD } from './shop';

/** The most of one item a single grant may add: more than a bag of full stacks holds, and far more than a test needs. */
export const MAX_GRANT = 999;

export type AdminAction =
  | { k: 'level'; level: number }
  | { k: 'teleport'; x: number; z: number }
  | { k: 'give'; id: string; qty: number }
  | { k: 'gold'; amount: number };

export function applyAdminAction(s: GameState, act: AdminAction) {
  if (act.k === 'level') setCombatLevel(s, act.level);
  else if (act.k === 'teleport') teleport(s, act.x, act.z);
  else if (act.k === 'gold') giveGold(s, act.amount);
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

/**
 * Put gold in the purse, up to what the purse holds. A trainer's ability is the one thing the panel could not reach:
 * the level it asks for is a button here, the price was an afternoon's play.
 */
export function giveGold(s: GameState, amount: number) {
  if (!Number.isFinite(amount)) return;
  const want = Math.max(1, Math.min(MAX_GOLD, Math.round(amount)));
  s.player.gold = Math.min(MAX_GOLD, s.player.gold + want);
}

/** Somewhere the panel can send you: `group` is the heading it sits under, `detail` what is standing there. */
export interface Destination { group: string; name: string; detail: string; x: number; z: number }

const area = (r: Rect) => (r.x1 - r.x0) * (r.z1 - r.z0);
/** The middle of the largest rectangle of a region's floor: a corridor into it is not where "take me to the Fens" means. */
const middleOf = (rects: Rect[]) => {
  const r = rects.reduce((best, x) => (area(x) > area(best) ? x : best));
  return clampToWorld({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 });
};

/**
 * The respawn that tells a name apart from the trash around it. It is data.ts's own rule read back: trash comes back in
 * 30 to 45 seconds, an elite in 120, a boss in 10 minutes and a rare in 30. So every elite, boss and rare is listed
 * against the place it holds, and no Marsh Hog is.
 */
export const NAMED_RESPAWN = 120;

/** Every spawn read once: what stands there, and the region the HUD would name for the spot it stands on. */
const posts = () => SPAWNS
  .map(sp => ({ def: ENEMY_TYPES[sp.type], type: sp.type, where: regionAt(sp.x, sp.z), x: sp.x, z: sp.z }))
  .filter((p): p is typeof p & { where: Region } => p.where !== null);

/** The levels a place covers: "lv 18-21", "lv 32" where everything there is one level, or '' where nothing stands there. */
const band = (defs: EnemyDef[]): string => {
  if (!defs.length) return '';
  const levels = defs.map(d => d.level), lo = Math.min(...levels), hi = Math.max(...levels);
  return `lv ${lo === hi ? lo : `${lo}-${hi}`}`;
};

/** What is waiting somewhere: the levels it covers, then its bosses, rares and elites, weakest first and each named once. */
const detailOf = (defs: EnemyDef[]): string => {
  const named = [...new Set(defs.filter(d => d.respawn >= NAMED_RESPAWN).sort((a, b) => a.level - b.level).map(d => d.name))];
  return [band(defs) || 'no enemies', ...(named.length ? [named.join(', ')] : [])].join('  -  ');
};

/** The heading the bosses, rares and elites sit under, each one a jump to the ground it holds. */
export const BOSS_GROUP = 'Bosses, rares and elites';

/**
 * One entry per named enemy per region: the post it stands on, so testing a fight is a jump and not a hunt. The middle of
 * the Greywater Road is three hundred units from Old Grey, which is what made the list hard to use. Weakest first.
 */
const bossPosts = (all: ReturnType<typeof posts>): Destination[] => {
  const one = new Map<string, typeof all[number]>(); // the first of a kind in a region: the Galley's two ogres are one line, not two
  for (const p of all) {
    const key = `${p.type} ${p.where.id}`;
    if (p.def.respawn >= NAMED_RESPAWN && !one.has(key)) one.set(key, p);
  }
  return [...one.values()]
    .sort((a, b) => a.def.level - b.def.level)
    .map(p => ({ group: BOSS_GROUP, name: p.def.name, detail: `lv ${p.def.level}  -  ${p.where.name}`, x: p.x, z: p.z }));
};

/**
 * Everywhere the panel offers: each town's waking spot, every named enemy's own post, the middle of every region out of
 * doors, then each dungeon's rooms under a heading of their own, so the room a boss is in is found by the dungeon it
 * belongs to. Every entry carries what stands there, read off SPAWNS, so an enemy moved or added shows up here with no edit.
 */
export const destinations = (): Destination[] => {
  const all = posts();
  const defsIn = (id: string) => all.filter(p => p.where.id === id).map(p => p.def);
  const townName = (id: string) => TOWNS.find(t => t.id === id)?.name ?? id;
  return [
    ...TOWNS.map(t => ({ group: 'Towns', name: t.name, detail: detailOf(defsIn(regionAt(t.wake.x, t.wake.z)?.id ?? '')), x: t.wake.x, z: t.wake.z })),
    ...bossPosts(all),
    ...REGIONS.filter(r => !r.dungeon).map(r => ({ group: 'Regions', name: r.name, detail: detailOf(defsIn(r.id)), ...middleOf(r.footprint) })),
    ...DUNGEONS.map(d => ({ d, rooms: d.rooms.map(r => regionById(r.name)) })).flatMap(({ d, rooms }) => {
      const group = `${d.name}  (${townName(d.parent)}, ${band(rooms.flatMap(r => defsIn(r.id))) || 'empty'})`;
      return rooms.map(r => ({ group, name: r.name, detail: detailOf(defsIn(r.id)), ...middleOf(r.footprint) }));
    }),
  ];
};
