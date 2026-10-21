// Procs: the part of a fight you cannot plan (HOM-138). Something you were doing anyway - a swing landing, a critical
// hit, a wound ticking - throws a short window open, and inside it one ability you would normally be waiting on is free
// and ready now. That is the whole mechanic: a proc never fires itself, it only offers, and the offer runs out.
//
// Each one names its ability by `AbilityDef.name`, not by its slot: a slot is a save-file detail and would reshuffle
// the set the first time an ability was inserted. A proc for an ability the player has not got yet never opens, so the
// windows arrive with the buttons that answer them.
import type { GameState, Player } from '../sim';
import { ABILITIES } from './data';
import { abilityOpen } from './combat';
import { sideRandom } from './rng';

/** What sets a proc off. Each is somewhere the player was already producing a result, so none of them is a new clock to watch. */
export type ProcTrigger = 'swing' | 'crit' | 'bleed';

export interface ProcDef {
  name: string;
  icon: string;
  /** The line the HUD says when the window opens: what to press, and why now. */
  desc: string;
  trigger: ProcTrigger;
  chance: number;   // per trigger
  duration: number; // seconds the window stays open
  /** The ability it opens, by `AbilityDef.name`. */
  ability: string;
  /** What the empowered cast hits for, on top of everything else that bends the damage. */
  mult: number;
}

/** A window that is open: `left` seconds before the offer lapses. Transient, like a cooldown, so a save never carries one. */
export interface Proc { id: string; left: number }

export const PROCS: Record<string, ProcDef> = {
  opening: { name: 'Opening', icon: '🗡', desc: 'Crushing Blow is free and ready, and lands 30% harder.',
    trigger: 'swing', chance: 0.07, duration: 8, ability: 'Crushing Blow', mult: 1.3 },
  open_wound: { name: 'Open Wound', icon: '🩸', desc: 'Serrated Throw is free and ready, and bites 30% deeper.',
    trigger: 'crit', chance: 0.08, duration: 8, ability: 'Serrated Throw', mult: 1.3 },
  blood_scent: { name: 'Scent of Blood', icon: '🌀', desc: 'Cleave is free and ready, and sweeps 30% harder.',
    trigger: 'bleed', chance: 0.07, duration: 8, ability: 'Cleave', mult: 1.3 },
};

/** The ability slot a proc opens, or -1 if its name names nothing (which src/combat-depth.test.ts refuses to let happen). */
export const procSlot = (id: string) => ABILITIES.findIndex(a => a.name === PROCS[id]?.ability);

/** The proc open on this slot right now, or null. One ability is named by one proc, so the first match is the answer. */
export function procOn(p: Player, slot: number): string | null {
  const name = ABILITIES[slot]?.name;
  return name === undefined ? null : p.procs.find(x => PROCS[x.id]?.ability === name)?.id ?? null;
}

/**
 * Roll everything that answers this trigger. A proc already open is refreshed rather than stacked, and one whose
 * ability the player cannot use yet is not rolled at all - there would be nothing to offer.
 *
 * The dice are `sideRandom`'s, not the world's: a window is a layer added on top of a game that was already tuned,
 * and drawing from the world's own stream would have re-rolled every drop and every damage spread behind it.
 */
export function rollProcs(s: GameState, trigger: ProcTrigger) {
  const p = s.player;
  for (const id of Object.keys(PROCS)) {
    const def = PROCS[id];
    if (def.trigger !== trigger) continue;
    const slot = procSlot(id);
    if (slot < 0 || !abilityOpen(p, slot)) continue;
    if (sideRandom(s, id) >= def.chance) continue;
    const have = p.procs.find(x => x.id === id);
    if (have) have.left = def.duration;
    else p.procs.push({ id, left: def.duration });
    s.events.push({ t: 'proc', id, on: true });
  }
}

/** The window was taken: the cast that spent it has already been paid for. */
export function spendProc(s: GameState, id: string) {
  s.player.procs = s.player.procs.filter(x => x.id !== id);
  s.events.push({ t: 'proc', id, on: false });
}

export function updateProcs(s: GameState, dt: number) {
  const p = s.player;
  if (!p.procs.length) return;
  for (const x of p.procs) x.left -= dt;
  const over = p.procs.filter(x => x.left <= 0);
  if (!over.length) return;
  p.procs = p.procs.filter(x => x.left > 0);
  for (const x of over) s.events.push({ t: 'proc', id: x.id, on: false });
}

/** Dying closes every window, the way it takes every buff. */
export function clearProcs(s: GameState) {
  for (const x of s.player.procs) s.events.push({ t: 'proc', id: x.id, on: false });
  s.player.procs = [];
}
