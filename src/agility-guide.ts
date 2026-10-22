// What the game says about Agility's verbs (HOM-193): the double jump, the Shift that trains it and the chest on a roof that wants it. Pure, and read from
// the player and the chest table only. Nothing here is a counter on screen: the player asks (a click on a hoard, the skills panel, the help list) and is told the
// true thing, and the one thing that is volunteered is said once (hoardSight, then the arrival at the level).
import type { GameState, Player } from './sim';
import {
  DOUBLE_JUMP_COST, DOUBLE_JUMP_LEVEL, ROLL_COST, ROOT_CUT, SPRINT_DRAIN, STAMINA_BASE, STAMINA_PER_LEVEL, doubleJumpAway, jumpVelocity, netHold,
} from './sim/agility';
import { CHESTS, TIERS, isOpened, type ChestDef, type ChestFail } from './sim/chests';
import { JUMP_VELOCITY } from './sim/data';
import { MAX_LEVEL } from './sim/xp';

/** How near the player must come to an unopened hoard to be told of it: the roof is plainly in view from here. Hale's watchtower stands about 25 u from where a new character wakes, so the first one is a few steps into the square, not at the first frame. */
export const HOARD_SIGHT = 20;
/** A refused click names the chest nearest the player within this: the event does not carry which chest was asked for, and no two chests are closer than 34 u. */
const REFUSAL_RANGE = 20;

export const hasDoubleJump = (p: Player) => p.skills.agility.level >= DOUBLE_JUMP_LEVEL;

/** Seconds of flat-out sprint a meter at this Agility level lasts (the meter is the skill: every level is a longer run). */
const sprintSeconds = (level: number) => (STAMINA_BASE + STAMINA_PER_LEVEL * (level - 1)) / SPRINT_DRAIN;

/**
 * The line the skills panel keeps under Agility: the double jump as a thing to walk toward ("983 paces", a distance a person can picture where 7,842 XP is not),
 * and once it is earned, the key that uses it. It is one short line because the panel's rows are a third of a 620 px window wide and the list must not scroll;
 * the tooltip on the row (agilityTip) carries the sentence.
 */
export function doubleJumpNote(p: Player): string {
  const away = doubleJumpAway(p);
  return away ? `Sprint ${away.ground} paces to double jump` : 'Double jump: Space in the air';
}

/** The Agility row's tooltip: what the skill trains by and everything a level buys, at the level the player is on and the two ends of the ladder. */
export function agilityTip(p: Player): string {
  const level = p.skills.agility.level, secs = (n: number) => `${Math.round(sprintSeconds(n) * 10) / 10} s`;
  const hop = Math.round(((jumpVelocity(p) / JUMP_VELOCITY) ** 2 - 1) * 100);
  const held = Math.round(netHold(p, 1) * 100), away = doubleJumpAway(p);
  return [
    'Agility is trained by sprinting: hold Shift and run. Each level buys:',
    `- A longer sprint: ${secs(level)} on the stamina bar (${secs(1)} at level 1, ${secs(MAX_LEVEL)} at ${MAX_LEVEL})`,
    `- A net lets go sooner: it holds you for ${held}% of its time (${Math.round((1 - ROOT_CUT) * 100)}% at ${MAX_LEVEL})`,
    `- A harder push off the ground: your hop is ${hop}% higher`,
    `- B, the dodge-roll, is paid from the same bar (${ROLL_COST} stamina), so a longer bar is more rolls`,
    `- Level ${DOUBLE_JUMP_LEVEL}: the double jump. ${away
      ? `${away.ground} paces of sprinting to go: it is what reaches the chests on rooftops.`
      : `Press Space again in the air (${DOUBLE_JUMP_COST} stamina).`}`,
  ].join('\n');
}

const flat = (a: ChestDef, p: Player) => Math.hypot(p.x - a.x, p.z - a.z);
const nearestWithin = (p: Player, range: number, keep: (c: ChestDef) => boolean): ChestDef | null => {
  let best: ChestDef | null = null;
  for (const c of CHESTS) if (keep(c) && flat(c, p) <= range && (!best || flat(c, p) < flat(best, p))) best = c;
  return best;
};

/**
 * The unopened hoard the player is close enough to be told about, or null: none in view, none left, or nothing to tell because they already have the second jump.
 * The caller says it once, ever (storage.ts hoardTold); a click on the chest says it every time, because that is asked for.
 */
export function hoardSight(s: GameState): ChestDef | null {
  const p = s.player;
  if (p.dead || hasDoubleJump(p)) return null;
  return nearestWithin(p, HOARD_SIGHT, c => c.tier === 'hoard' && !isOpened(p, c.id));
}

/** The words for being turned away from a chest: `say` for the middle of the screen, `note` for the log, which has room to say how far off the answer is. */
export interface Refusal { say: string; note?: string }

/** What a hoard asks of this player: the second jump and the distance to it, or, once they have it, how to use it to get up there. */
export function hoardRefusal(p: Player): Required<Refusal> {
  const away = doubleJumpAway(p);
  if (away) {
    return {
      say: `Out of reach: it needs ${TIERS.hoard.needs}`,
      note: `That chest is on a roof, and it needs ${TIERS.hoard.needs}. You are Agility ${p.skills.agility.level}: ${away.ground} paces of sprinting to go (hold Shift to run).`,
    };
  }
  return {
    say: 'Jump, then jump again in the air, to reach the roof',
    note: `Press Space, then Space again at the top of the hop (${DOUBLE_JUMP_COST} stamina), and land on the roof: the chest opens from up there.`,
  };
}

/**
 * Why a chest would not open, in the sim's own words for what each tier needs (TIERS) and the player's own distance from the second jump. A hoard is the one that
 * must say so: it is the chest the player can stand right beside and still not open, and "Can't reach that" is the whole of what it used to say. Null leaves the
 * generic shrug (nothing near enough to name).
 */
export function chestRefusal(s: GameState, why: ChestFail): Refusal | null {
  const p = s.player, c = nearestWithin(p, REFUSAL_RANGE, () => true);
  if (!c || (why !== 'far' && why !== 'floor' && why !== 'opened')) return null;
  if (isOpened(p, c.id)) return { say: 'You have already opened that chest' };
  if (c.tier === 'hoard') return hoardRefusal(p);
  if (why === 'far') return { say: 'Move closer to the chest' };
  if (c.tier === 'stash') return { say: 'Open it from the ground beside it' }; // a stash stands on the ground: the floor is wrong only for a player up on a roof
  return { say: `It needs ${TIERS[c.tier].needs}` };
}
