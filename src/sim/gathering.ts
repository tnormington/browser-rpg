// Gathering nodes: ore rocks and trees. Timed action -> item + skill XP; nodes deplete and respawn. Pure sim.
import type { GameState } from '../sim';
import type { Action } from './actions';
import { nodeSpots } from './world';
import { SkillId, grantXp } from './skills';
import { masteryTime, masteryYield } from './mastery';
import { addItem, hasRoom } from './inventory';
import { FISH } from './fish';
import { HERBS } from './herbs';

export interface NodeDef {
  name: string;
  skill: SkillId;
  level: number;    // minimum skill level to gather
  item: string;
  time: number;     // seconds per gather
  xp: number;       // per gather
  charges: number;  // gathers before the node depletes
  respawn: number;  // seconds depleted
}

// The metal ladder (docs/world-design.md 2.2, HOM-56): copper from Mining 1, then tin, iron, coal, adamant, with real distance between the rungs.
// Ore XP is 0.12 x the XP cost of the rock's own level, rounded: eight to seventeen swings a level where the first ladder took under three.
// The Mining 18 mithril vein that used to sit between coal and adamant went out with the mithril set (HOM-81): the rung above coal is steel, which
// is smithed from iron and coal rather than mined, and the Hollow's three veins are tin.
export const NODE_TYPES: Record<string, NodeDef> = {
  copper: { name: 'Copper Rock', skill: 'mining', level: 1, item: 'copper_ore', time: 3.5, xp: 10, charges: 3, respawn: 25 },
  tin: { name: 'Tin Rock', skill: 'mining', level: 3, item: 'tin_ore', time: 3.5, xp: 12, charges: 3, respawn: 25 },
  iron: { name: 'Iron Rock', skill: 'mining', level: 7, item: 'iron_ore', time: 3.5, xp: 18, charges: 3, respawn: 25 },
  coal: { name: 'Coal Seam', skill: 'mining', level: 10, item: 'coal', time: 4.5, xp: 24, charges: 3, respawn: 30 },
  adamant: { name: 'Adamant Vein', skill: 'mining', level: 28, item: 'adamant_ore', time: 5.5, xp: 145, charges: 3, respawn: 45 },
  tree: { name: 'Tree', skill: 'woodcutting', level: 1, item: 'logs', time: 3, xp: 25, charges: 2, respawn: 20 },
  // fishing spots, one per fish (fish.ts): five catches of four seconds, back after twenty. Only the first three have water placed (world.ts)
  ...Object.fromEntries(FISH.map((f): [string, NodeDef] => [f.id, { name: `${f.name} Shoal`, skill: 'fishing', level: f.level, item: f.id, time: 4, xp: f.xp, charges: 5, respawn: 20 }])),
  // herb patches, one per herb (herbs.ts): three gathers of three seconds, back after 25, like the ore
  ...Object.fromEntries(HERBS.map((h): [string, NodeDef] => [h.id, { name: `${h.name} Patch`, skill: 'herbalism', level: h.level, item: h.id, time: 3, xp: h.xp, charges: 3, respawn: 25 }])),
};

export interface ResourceNode {
  id: number;
  type: string;
  x: number; z: number; r: number;
  charges: number;
  respawnIn: number; // > 0 while depleted
}

export function createNodes(): ResourceNode[] {
  // ids are positions in this list (region order, see REGIONS): new ground goes last so every older node keeps its id (and its save)
  return nodeSpots().map((sp, i) => ({
    id: i + 1, type: sp.type, x: sp.x, z: sp.z, r: sp.r, charges: NODE_TYPES[sp.type].charges, respawnIn: 0,
  }));
}

export const nodeById = (s: GameState, id: number) => s.nodes.find(n => n.id === id);

/** One gather cycle at the player's current skill: the base time, cut by whatever they have over the requirement. */
export const gatherTime = (s: GameState, def: NodeDef) =>
  masteryTime(def.time, s.player.skills[def.skill].level, def.level);

export function beginGather(s: GameState, node: ResourceNode) {
  const p = s.player, def = NODE_TYPES[node.type];
  const fail = (reason: 'level' | 'depleted' | 'full') =>
    void s.events.push({ t: 'actionfail', reason, skill: def.skill, need: def.level, what: def.name });
  if (node.charges <= 0) return fail('depleted');
  if (p.skills[def.skill].level < def.level) return fail('level');
  if (!hasRoom(p.inventory, def.item)) return fail('full');
  p.action = { k: 'gather', nodeId: node.id, t: 0, duration: gatherTime(s, def) };
  s.events.push({ t: 'begin', skill: def.skill, what: 'gather', id: node.type });
}

/** The pick or axe falls every GATHER_STRIKE seconds of a cycle, so audio lands on a beat instead of once at the end. */
export const GATHER_STRIKE = 1.1;
export function strikeGather(s: GameState, a: Extract<Action, { k: 'gather' }>, before: number) {
  if (Math.floor(a.t / GATHER_STRIKE) > Math.floor(before / GATHER_STRIKE)) {
    s.events.push({ t: 'gather', skill: NODE_TYPES[nodeById(s, a.nodeId)!.type].skill, node: a.nodeId });
  }
}

/** One gather cycle completed: yield, xp, charge use. Ends or continues the action. */
export function finishGather(s: GameState, a: Extract<Action, { k: 'gather' }>) {
  const p = s.player, node = nodeById(s, a.nodeId);
  if (!node || node.charges <= 0) { p.action = null; return; }
  const def = NODE_TYPES[node.type];
  if (!hasRoom(p.inventory, def.item)) {
    p.action = null;
    s.events.push({ t: 'actionfail', reason: 'full', skill: def.skill, need: def.level, what: def.name });
    return;
  }
  // a high-level gatherer brings up more per swing; whatever the bag cannot hold is simply not mined
  const want = masteryYield(s, 1, p.skills[def.skill].level, def.level);
  const got = want - addItem(p.inventory, def.item, want);
  if (def.skill === 'fishing') s.events.push({ t: 'catch', fish: def.item, node: node.id });
  s.events.push({ t: 'loot', item: def.item, qty: got });
  grantXp(s, def.skill, def.xp, node.x, node.z);
  node.charges--;
  a.t = 0;
  a.duration = gatherTime(s, def); // a level gained on this swing speeds up the next one
  if (node.charges <= 0) {
    node.respawnIn = def.respawn;
    p.action = null;
    s.events.push({ t: 'depleted', id: node.id });
  }
}

export function updateNodes(s: GameState, dt: number) {
  for (const n of s.nodes) {
    if (n.charges > 0) continue;
    n.respawnIn -= dt;
    if (n.respawnIn <= 0) { n.charges = NODE_TYPES[n.type].charges; n.respawnIn = 0; s.events.push({ t: 'respawned', id: n.id }); }
  }
}
