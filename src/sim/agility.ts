// Agility (HOM-147): the skill that says how long you can run flat out for. Pure sim, like every other rule.
// Shift is sprint. On foot, with somewhere to go, it buys half as much speed again and spends a stamina meter to do it;
// the meter is the skill, so every Agility level is felt directly as a longer run. Only sprinting earns the XP, which
// makes the skill its own training: you level it by using it, the way mining levels on rocks.
import type { GameState, Player } from '../sim';
import { grantXp } from './skills';

export const SPRINT_SPEED = 9;        // u/s with shift held, against foot speed's 6 and the first mount's 10: a horse is still the faster way to travel
export const STAMINA_BASE = 100;      // the meter at Agility 1
export const STAMINA_PER_LEVEL = 5;   // ...and what each level adds to it: 590 at 99
export const SPRINT_DRAIN = 20;       // stamina a second of sprinting: five seconds flat out at Agility 1, half a minute at 99
/**
 * Seconds from empty back to full, at any level: the refill is a share of the meter, not a fixed trickle, so a longer
 * meter fills proportionally faster. Levelling Agility has to be all gain — a bigger pool that took longer to recharge
 * would make the reward for levelling a longer wait between runs.
 */
export const STAMINA_REFILL = 6;
export const WINDED_UNTIL = 0.3;      // run the meter dry and sprint is locked out until it is back to this much of full: without a floor, sprint flickers on and off a tick at a time at zero
export const SPRINT_XP_PER_UNIT = 2;  // XP for a unit of ground covered at a sprint: level 10 in about three minutes of running, 50 in an afternoon, and 99 out of reach, which is the shape the ore ladder has
export const SPRINT_XP_EVERY = 30;    // ...paid in stretches of this many units, so the floaters come every three seconds or so rather than every tick

/** The meter at the player's Agility level. Derived, never stored: it cannot go stale. */
export const maxStamina = (p: Player) => STAMINA_BASE + STAMINA_PER_LEVEL * (p.skills.agility.level - 1);

/** Stamina a unit of ground, which is what the drain is really charged by: running into a rock costs nothing. */
const DRAIN_PER_UNIT = SPRINT_DRAIN / SPRINT_SPEED;

/**
 * Decided before the step, because the speed of the step depends on it: sprinting wants shift held, somewhere to go,
 * feet on the ground (the saddle is already faster) and breath left to spend.
 */
export function startSprint(s: GameState, wants: boolean, heading: boolean) {
  const p = s.player;
  p.sprinting = wants && heading && !p.mounted && !p.winded && p.stamina > 0;
}

/**
 * Settled after the step, against the ground actually covered: a sprint is charged to the meter and credited to the
 * skill, and anything else — standing, walking, a sprint held against a wall — gets breath back.
 */
export function updateAgility(s: GameState, moved: number, dt: number) {
  const p = s.player, max = maxStamina(p);
  if (p.sprinting && moved > 0) {
    p.stamina = Math.max(0, p.stamina - moved * DRAIN_PER_UNIT);
    p.sprinted += moved;
    while (p.sprinted >= SPRINT_XP_EVERY) {
      p.sprinted -= SPRINT_XP_EVERY;
      grantXp(s, 'agility', SPRINT_XP_EVERY * SPRINT_XP_PER_UNIT, p.x, p.z);
    }
    if (p.stamina === 0) { p.winded = true; p.sprinting = false; }
  } else {
    p.stamina = Math.min(max, p.stamina + (max / STAMINA_REFILL) * dt);
    if (p.winded && p.stamina >= max * WINDED_UNTIL) p.winded = false;
  }
}
