// Gathering nodes: ore rocks and trees. Timed action -> item + skill XP; nodes deplete and respawn. Pure sim.
import type { GameState } from '../sim';
import type { Action } from './actions';
import { ROCKS, TREES } from './world';
import { SkillId, grantXp } from './skills';
import { addItem, hasRoom } from './inventory';

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

export const NODE_TYPES: Record<string, NodeDef> = {
  iron: { name: 'Iron Rock', skill: 'mining', level: 1, item: 'iron_ore', time: 3.5, xp: 35, charges: 3, respawn: 25 },
  coal: { name: 'Coal Seam', skill: 'mining', level: 4, item: 'coal', time: 4.5, xp: 50, charges: 3, respawn: 30 },
  tree: { name: 'Tree', skill: 'woodcutting', level: 1, item: 'logs', time: 3, xp: 25, charges: 2, respawn: 20 },
};

export interface ResourceNode {
  id: number;
  type: string;
  x: number; z: number; r: number;
  charges: number;
  respawnIn: number; // > 0 while depleted
}

export function createNodes(): ResourceNode[] {
  const spots = [...ROCKS, ...TREES.map(t => ({ ...t, type: 'tree' }))];
  return spots.map((sp, i) => ({
    id: i + 1, type: sp.type, x: sp.x, z: sp.z, r: sp.r, charges: NODE_TYPES[sp.type].charges, respawnIn: 0,
  }));
}

export const nodeById = (s: GameState, id: number) => s.nodes.find(n => n.id === id);

export function beginGather(s: GameState, node: ResourceNode) {
  const p = s.player, def = NODE_TYPES[node.type];
  const fail = (reason: 'level' | 'depleted' | 'full') =>
    void s.events.push({ t: 'actionfail', reason, skill: def.skill, need: def.level, what: def.name });
  if (node.charges <= 0) return fail('depleted');
  if (p.skills[def.skill].level < def.level) return fail('level');
  if (!hasRoom(p.inventory, def.item)) return fail('full');
  p.action = { k: 'gather', nodeId: node.id, t: 0, duration: def.time };
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
  addItem(p.inventory, def.item, 1);
  s.events.push({ t: 'loot', item: def.item, qty: 1 });
  grantXp(s, def.skill, def.xp, node.x, node.z);
  node.charges--;
  a.t = 0;
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
