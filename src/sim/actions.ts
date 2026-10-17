// The player's one timed action (gathering or crafting) and the click-to-interact walk that starts it.
import type { GameState } from '../sim';
import { PLAYER_RADIUS, LANDMARKS, OBSTACLES, clampToWorld } from './world';
import { beginGather, finishGather, nodeById } from './gathering';
import { finishCraft } from './crafting';

export type Action =
  | { k: 'gather'; nodeId: number; t: number; duration: number }
  | { k: 'craft'; recipe: string; t: number; duration: number; left: number };

export type Interact = { k: 'node'; id: number } | { k: 'forge' };

const FORGE_R = OBSTACLES.find(o => o.x === LANDMARKS.forge.x && o.z === LANDMARKS.forge.z)!.r;
const REACH = 1.5; // gap between the player's edge and the thing's edge that still counts as touching

/** Where the thing is and how big. */
function target(s: GameState, it: Interact) {
  if (it.k === 'forge') return { x: LANDMARKS.forge.x, z: LANDMARKS.forge.z, r: FORGE_R };
  const n = nodeById(s, it.id);
  return n && { x: n.x, z: n.z, r: n.r };
}

/** Click on a node or the forge: walk up to it, then start (or open) it. */
export function requestInteract(s: GameState, it: Interact) {
  const p = s.player;
  p.action = null;
  const t = target(s, it);
  if (!t) { s.interact = null; return; }
  s.interact = it;
  const d = Math.hypot(p.x - t.x, p.z - t.z);
  if (d <= t.r + PLAYER_RADIUS + REACH) return; // already in reach: updateInteract starts it this tick
  const k = (t.r + PLAYER_RADIUS + 0.8) / d;
  s.moveTarget = clampToWorld({ x: t.x + (p.x - t.x) * k, z: t.z + (p.z - t.z) * k });
}

export function updateInteract(s: GameState) {
  const it = s.interact, p = s.player;
  if (!it) return;
  const t = target(s, it);
  if (!t) { s.interact = null; return; }
  if (Math.hypot(p.x - t.x, p.z - t.z) > t.r + PLAYER_RADIUS + REACH) {
    if (!s.moveTarget) s.interact = null; // walk ended (arrived short or blocked): give up
    return;
  }
  s.interact = null;
  s.moveTarget = null;
  p.moving = false;
  p.facing = Math.atan2(t.x - p.x, t.z - p.z);
  if (it.k === 'forge') s.events.push({ t: 'forge' });
  else beginGather(s, nodeById(s, it.id)!);
}

export function updateAction(s: GameState, dt: number) {
  const p = s.player, a = p.action;
  if (!a) return;
  if (p.dead || p.moving) { p.action = null; return; }
  a.t += dt;
  if (a.t < a.duration) return;
  if (a.k === 'gather') finishGather(s, a); else finishCraft(s, a);
}
