// The timed effects on a unit, as the unit frames show them. Pure sim: the HUD reads this, it does not work them out itself.
import type { Enemy, Player } from '../sim';
import { ABILITIES, STAGGER_TIME } from './data';
import { BUFFS, FOOD_TIME } from './consumables';
import { PROCS } from './procs';

export interface Status {
  key: string;   // stable while the effect lasts: its icon is kept between frames rather than rebuilt
  icon: string;
  name: string;
  left: number;  // seconds remaining
  total: number; // seconds it runs for at full, so the duration bar is left/total
  bad: boolean;  // a debuff rather than a buff
  /** An open proc window rather than a plain buff: the HUD lights it, because it is a thing to press, not a thing to have. */
  proc?: boolean;
}

const BLEED_TICKS = ABILITIES.find(a => a.kind === 'dot')!.dotTicks!;

/** What is on the player: the proc windows first (they are the ones that want answering), then the net, the meal and every timed buff. */
export function playerStatuses(p: Player): Status[] {
  const out: Status[] = [];
  for (const x of p.procs) {
    const def = PROCS[x.id];
    if (def) out.push({ key: `proc:${x.id}`, icon: def.icon, name: `${def.name}: ${def.desc}`, left: x.left, total: def.duration, bad: false, proc: true });
  }
  if (p.root) out.push({ key: 'root', icon: '🕸️', name: p.root.name, left: p.root.left, total: p.root.total, bad: true });
  if (p.food) out.push({ key: 'food', icon: '🍲', name: 'Eating', left: p.food.left, total: FOOD_TIME, bad: false });
  for (const b of p.buffs) {
    const def = BUFFS[b.id];
    if (def) out.push({ key: b.id, icon: def.icon, name: def.name, left: b.left, total: def.duration, bad: false });
  }
  return out;
}

/** What is on an enemy: the bleed it carries and the stagger a landed Pummel left. */
export function enemyStatuses(e: Enemy): Status[] {
  const out: Status[] = [];
  // the tick in flight, plus a whole interval for each one behind it (Exsanguinate shortens the interval, Rending adds ticks)
  if (e.bleed) out.push({ key: 'bleed', icon: '🩸', name: 'Bleeding',
    left: (e.bleed.ticks - 1) * e.bleed.interval + e.bleed.timer, total: BLEED_TICKS * e.bleed.interval, bad: true });
  if (e.stagger > 0) out.push({ key: 'stagger', icon: '💫', name: 'Staggered', left: e.stagger, total: STAGGER_TIME, bad: true });
  return out;
}
