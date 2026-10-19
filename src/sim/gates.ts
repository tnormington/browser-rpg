// Hard gates (docs/world-design.md 1.3): a line across an opening that turns back a player below the combat level it asks for, and says why in its keeper's
// words. The world is one continuous floor, so a gate is a rule on movement rather than a door: the step that would carry the player over the line is undone.
// Only the near side is held: the way back is never refused. Pure sim.
import type { GameState } from '../sim';
import { GATES, PLAYER_RADIUS } from './world';
import { TICK_DT } from './data';

/** Seconds between the keeper's repeats while the player leans on the line. */
const TELL_EVERY = 2.5;
const toldAt = new WeakMap<GameState, Map<string, number>>();

/** Does this player pass this gate? Under the level, or with the way shut, no. */
export const gateOpen = (s: GameState, g: (typeof GATES)[number]) => !g.closed && s.player.combat.level >= g.combat;

/** After the player has moved from (px, pz): if the step crossed a gate they may not pass, put them back on its near side and have the keeper speak. */
export function holdAtGates(s: GameState, px: number, pz: number) {
  const p = s.player;
  for (const g of GATES) {
    const [from, now] = g.axis === 'x' ? [px, p.x] : [pz, p.z], across = g.axis === 'x' ? p.z : p.x;
    if ((from - g.at) * g.from <= 0 || (now - g.at) * g.from > 0) continue; // not coming from the near side, or has not reached the line
    if (across < g.span[0] - PLAYER_RADIUS || across > g.span[1] + PLAYER_RADIUS || gateOpen(s, g)) continue;
    const back = g.at + g.from * (PLAYER_RADIUS + 0.05);
    if (g.axis === 'x') p.x = back; else p.z = back;
    const told = toldAt.get(s) ?? new Map<string, number>(), t = s.tick * TICK_DT;
    toldAt.set(s, told);
    if (t - (told.get(g.id) ?? -Infinity) < TELL_EVERY) continue;
    told.set(g.id, t);
    s.events.push({ t: 'gate', id: g.id, keeper: g.keeper, text: p.combat.level >= g.combat && g.closed ? g.closed : g.refuse, need: g.combat });
  }
}
