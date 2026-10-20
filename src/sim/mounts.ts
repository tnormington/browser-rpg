// Mounts (bible 4): bought from a stablemaster, ridden at a fixed speed, and never fought from. Pure sim.
// The player carries a `mounts` list (ids, saved) and one `mounted` flag; with several owned the fastest is the one ridden, so a second mount is a row in MOUNTS and nothing else.
// Getting on is a timed action like a gather (moving, a hit, or any other work breaks it); getting off is free and happens whenever the player acts or is hurt.
import type { GameState } from '../sim';
import { mountsAllowed } from './world';

export const FOOT_SPEED = 6;
export const MOUNT_CAST = 1.0; // seconds standing still to climb up

export interface MountDef { id: string; name: string; speed: number; level: number; price: number; vendor: string }
export const MOUNTS: MountDef[] = [
  { id: 'courser', name: 'Thornwick Courser', speed: 10, level: 20, price: 1000, vendor: 'thorn_stable' },
];
export const mountById = (id: string) => MOUNTS.find(m => m.id === id);
/** What a stablemaster sells. */
export const mountsSoldBy = (vendor: string) => MOUNTS.filter(m => m.vendor === vendor);

/** The fastest mount owned, if any. */
export const bestMount = (p: GameState['player']) => MOUNTS.filter(m => p.mounts.includes(m.id)).sort((a, b) => b.speed - a.speed)[0];
/** Units a second the player covers: the one movement constant. */
export const moveSpeed = (p: GameState['player']) => (p.mounted && bestMount(p)?.speed) || FOOT_SPEED;

const refuse = (s: GameState, what: string) => void s.events.push({ t: 'actionfail', reason: 'mount', need: 0, what });

/** The mount key: climb up (a cast), or cancel the cast, or get off. */
export function toggleMount(s: GameState) {
  const p = s.player;
  if (p.dead) return;
  if (p.mounted) return dismount(s);
  if (p.action?.k === 'mount') { p.action = null; return; }
  if (!bestMount(p)) return refuse(s, 'You have no mount: the stablemaster in Thornwick sells one');
  if (p.inCombat) return refuse(s, 'You cannot mount in combat');
  if (!mountsAllowed(p.x, p.z)) return refuse(s, 'You cannot ride in here');
  if (p.action) return refuse(s, 'Finish what you are doing first');
  s.moveTarget = null; s.interact = null; // a walk you were on ends where you stand: the cast needs stillness
  p.action = { k: 'mount', t: 0, duration: MOUNT_CAST };
}

export function dismount(s: GameState) {
  const p = s.player;
  if (!p.mounted) return;
  p.mounted = false;
  s.events.push({ t: 'mount', on: false });
}

/** The cast ran out: the player is up. */
export function finishMount(s: GameState) {
  const p = s.player;
  p.action = null;
  if (!bestMount(p) || !mountsAllowed(p.x, p.z)) return;
  p.mounted = true;
  s.events.push({ t: 'mount', on: true });
}

/** Each tick: death and dungeon rooms take you off the horse. */
export function updateMount(s: GameState) {
  const p = s.player;
  if (p.mounted && (p.dead || !mountsAllowed(p.x, p.z))) dismount(s);
}
