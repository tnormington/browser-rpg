// Agility (HOM-147): the skill that says how long you can run flat out for. Pure sim, like every other rule.
// Shift is sprint. On foot, with somewhere to go, it buys half as much speed again and spends a stamina meter to do it;
// the meter is the skill, so every Agility level is felt directly as a longer run. Only sprinting earns the XP, which
// makes the skill its own training: you level it by using it, the way mining levels on rocks.
//
// Three more things the level buys, at the bottom of the file: a net lets go of you sooner, you leave the ground harder,
// and B is a dodge-roll paid out of the same meter. None of them touch a damage number -- Agility is about your feet.
import type { GameState, Player } from '../sim';
import { grantXp } from './skills';
import { MAX_LEVEL } from './xp';
import { GRAVITY, JUMP_VELOCITY } from './data';

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
  p.sprinting = wants && heading && !p.mounted && !p.winded && p.rolling <= 0 && p.stamina > 0;
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
  p.rolling = Math.max(0, p.rolling - dt);
  p.rollCd = Math.max(0, p.rollCd - dt);
}

// ---------- what the level buys besides a longer run (HOM-147) ----------

/** 0 at Agility 1, 1 at 99: how far up the ladder the player is. Every perk below is this, scaled, so each is one number to argue about. */
const ladder = (p: Player) => (p.skills.agility.level - 1) / (MAX_LEVEL - 1);

/** How much of a net's hold is cut at Agility 99: light on your feet, so you are out of it in half the time. */
export const ROOT_CUT = 0.5;
/** Seconds a net of `duration` actually holds this player. */
export const netHold = (p: Player, duration: number) => duration * (1 - ROOT_CUT * ladder(p));

/**
 * How much harder the player pushes off at Agility 99. Height goes as the square of it, so a quarter more takeoff is
 * a little over half again as high: the most visible reward on the skill, and a free one — the world is flat and
 * nothing reads `y`, so a bigger hop changes what you see and nothing about where you can go.
 */
export const JUMP_LIFT = 0.25;
export const jumpVelocity = (p: Player) => JUMP_VELOCITY * (1 + JUMP_LIFT * ladder(p));

/**
 * The double jump (HOM-151, ruled on in docs/action-layer.md 4): one more takeoff in the air per hop, behind an Agility level.
 * The second push replaces the vertical speed rather than adding to it, and is aimed at a fixed height above the floor under
 * the player, not at a share of a takeoff: a hoard's rooftop is 2.6 or 2.8 up, so the apex has to be the same at every
 * Agility level and every press time, or the roof is a different height for different players.
 */
export const DOUBLE_JUMP_LEVEL = 25;
export const DOUBLE_JUMP_APEX = 3.2;    // u above the floor the second push peaks at
export const DOUBLE_JUMP_CEILING = 2.9; // a press higher than this does nothing (it would overshoot the apex's meaning) and is not spent
export const DOUBLE_JUMP_COST = 40;     // stamina, against a roll's 45 and a meter of 220 at the level it unlocks
export const canDoubleJump = (p: Player, rise: number) =>
  p.skills.agility.level >= DOUBLE_JUMP_LEVEL && p.stamina >= DOUBLE_JUMP_COST && rise <= DOUBLE_JUMP_CEILING;
/** The vertical speed that peaks at DOUBLE_JUMP_APEX from `rise` units above the floor (rising is at GRAVITY, so the apex is v^2 / 2g). */
export const doubleJumpVelocity = (rise: number) => Math.sqrt(2 * GRAVITY * (DOUBLE_JUMP_APEX - rise));

/**
 * The dodge-roll: a burst along the ground that nothing can touch you during, paid for out of the sprint meter.
 * Agility governs it the same way it governs sprinting — not by making a roll cheaper or safer, but by making the
 * meter it is paid from bigger, so a low-Agility player counts their rolls and a high one stops having to. The
 * i-frames stay the same length at every level: a roll is a skill you learn, not a stat you buy.
 */
export const ROLL_COST = 45;    // stamina a roll spends: near half the meter at Agility 1, where it is a real choice against sprinting
export const ROLL_SPEED = 16;   // u/s while it carries you
export const ROLL_TIME = 0.3;   // ...for this long, so it covers about five units, and is untouchable for all of it
/**
 * Seconds after a roll ends before another may start. This, not the meter, is what holds the roll at high Agility: the
 * refill is a share of the meter (see STAMINA_REFILL), so a long enough meter puts back more between rolls than a roll
 * costs. That is the reward working as intended — breath is what you count early and stop counting later — but it means
 * the cooldown alone decides the ceiling, so it is set where rolling on repeat is a fifth of your time untouchable and
 * every second of it is spent not swinging and drifting out of reach of whatever you were fighting.
 */
export const ROLL_CD = 1.2;

/** Is the player inside a roll's invulnerable window? The one question combat asks of it. */
export const rolling = (p: Player) => p.rolling > 0;

/**
 * Decided before the step, like the sprint: a roll wants the key, feet on the ground, breath to pay with and nothing
 * already holding them. It takes the direction being walked, or the way the player faces when they are standing still.
 */
export function startRoll(s: GameState, wants: boolean, dx: number, dz: number) {
  const p = s.player;
  if (!wants || p.rolling > 0 || p.rollCd > 0 || p.mounted || p.root || p.dead || p.stamina < ROLL_COST) return;
  const len = Math.hypot(dx, dz);
  p.rollX = len > 1e-4 ? dx / len : Math.sin(p.facing);
  p.rollZ = len > 1e-4 ? dz / len : Math.cos(p.facing);
  p.stamina -= ROLL_COST;
  p.rolling = ROLL_TIME;
  p.rollCd = ROLL_TIME + ROLL_CD;
  p.action = null; // like a hop, it breaks the concentration of a gather or a craft
  s.events.push({ t: 'roll', x: p.x, z: p.z, facing: Math.atan2(p.rollX, p.rollZ) });
}
