// The player's one timed action (gathering, crafting, mounting or a flight) and the click-to-interact walk that starts it.
import type { GameState } from '../sim';
import { PLAYER_RADIUS, LANDMARKS, OBSTACLES, clampToWorld } from './world';
import { beginGather, finishGather, nodeById, strikeGather } from './gathering';
import { finishCraft } from './crafting';
import { NPCS, npcNear } from './quest';
import { vendorById, vendorNear } from './shop';
import { masterById, masterNear } from './flight';
import { dismount, finishMount } from './mounts';

export type Action =
  | { k: 'gather'; nodeId: number; t: number; duration: number }
  | { k: 'craft'; recipe: string; t: number; duration: number; left: number }
  | { k: 'mount'; t: number; duration: number }                                      // climbing up: mounts.ts finishes it. Any movement, hit or other work breaks it like any action
  | { k: 'flight'; from: string; to: string; t: number; duration: number }; // the ride: flight.ts runs it, and the player is out of everyone's reach until it lands

/** `npc` and `vendor` name who (a click on them knows); without one, the nearest in earshot is meant (the E key). */
export type Interact = { k: 'node'; id: number } | { k: 'forge' } | { k: 'range' } | { k: 'alembic' } | { k: 'npc'; id?: string } | { k: 'vendor'; id?: string } | { k: 'flightmaster'; id?: string };

const FORGE_R = OBSTACLES.find(o => o.x === LANDMARKS.forge.x && o.z === LANDMARKS.forge.z)!.r;
const RANGE_R = 0.9; // the hearth is a prop, not a collider: this is only how close counts as touching it
const ALEMBIC_R = 1.3; // the bench is a collider of this radius (world.ts)
const REACH = 1.5; // gap between the player's edge and the thing's edge that still counts as touching

/** Where the thing is and how big. */
function target(s: GameState, it: Interact) {
  if (it.k === 'npc') return NPCS.find(n => n.id === it.id) ?? NPCS.find(n => n.id === npcNear(s)) ?? NPCS[0];
  if (it.k === 'vendor') return vendorById(it.id ?? '') ?? vendorNear(s) ?? vendorById('hale')!;
  if (it.k === 'flightmaster') return masterById(it.id ?? '') ?? masterNear(s) ?? masterById('hale')!;
  if (it.k === 'forge') return { x: LANDMARKS.forge.x, z: LANDMARKS.forge.z, r: FORGE_R };
  if (it.k === 'range') return { x: LANDMARKS.range.x, z: LANDMARKS.range.z, r: RANGE_R };
  if (it.k === 'alembic') return { x: LANDMARKS.alembic.x, z: LANDMARKS.alembic.z, r: ALEMBIC_R };
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
  dismount(s); // a node, the forge or somebody to talk to is a stop: you step down
  p.facing = Math.atan2(t.x - p.x, t.z - p.z);
  if (it.k === 'forge') s.events.push({ t: 'forge' });
  else if (it.k === 'range') s.events.push({ t: 'range' });
  else if (it.k === 'alembic') s.events.push({ t: 'alembic' });
  else if (it.k === 'npc') s.events.push({ t: 'npc', who: (t as { id: string }).id });
  else if (it.k === 'vendor') s.events.push({ t: 'shop', vendor: (t as { id: string }).id });
  else if (it.k === 'flightmaster') s.events.push({ t: 'flightmaster', town: (t as { id: string }).id });
  else beginGather(s, nodeById(s, it.id)!);
}

export function updateAction(s: GameState, dt: number) {
  const p = s.player, a = p.action;
  if (!a || a.k === 'flight') return; // a flight is run by updateFlight, which walking cannot interrupt
  if (p.dead || p.moving) { p.action = null; return; }
  const before = a.t;
  a.t += dt;
  if (a.t < a.duration) { if (a.k === 'gather') strikeGather(s, a, before); return; }
  if (a.k === 'gather') finishGather(s, a); else if (a.k === 'mount') finishMount(s); else finishCraft(s, a);
}
