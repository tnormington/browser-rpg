// Skill mastery: every level above what an action asks for makes that action quicker and more generous, so a
// veteran miner tears through iron rock that once took them a while. Gathering and crafting both read this one
// calculation, the way combat reads DerivedStats, so the curve is tuned in a single place.
import { nextRandom } from './rng';

export const SPEED_PER_LEVEL = 0.04; // of the base time, per level above the requirement
export const MAX_SPEEDUP = 0.5;      // never quicker than half the base time
export const BONUS_PER_LEVEL = 0.05; // chance of one extra output, per level above
export const MAX_BONUS = 1;          // ...up to one every time

export interface Mastery {
  above: number;  // levels above the requirement, never negative
  speed: number;  // multiplier on the action's time (below 1 is quicker)
  bonus: number;  // chance of one extra output
}

/** What a player of `level` gets out of an action that only asks for `required`. */
export function mastery(level: number, required: number): Mastery {
  const above = Math.max(0, level - required);
  return {
    above,
    speed: 1 - Math.min(MAX_SPEEDUP, SPEED_PER_LEVEL * above),
    bonus: Math.min(MAX_BONUS, BONUS_PER_LEVEL * above),
  };
}

/** How long the action takes at that level. */
export const masteryTime = (time: number, level: number, required: number): number =>
  time * mastery(level, required).speed;

/** The quantity the action hands over: its base, plus one more on a mastery roll. Only draws when a bonus is possible. */
export function masteryYield(s: { rng: number }, qty: number, level: number, required: number): number {
  const { bonus } = mastery(level, required);
  if (bonus <= 0) return qty;
  return nextRandom(s) < bonus ? qty + 1 : qty;
}
