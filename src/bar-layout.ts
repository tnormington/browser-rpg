// The action bar's layout rules, apart from the DOM so they can be tested: what a fresh bar holds, what a stored layout is
// worth, and which keys a slot may answer to. A layout is one entry (or null) per bar slot.
import { ITEMS } from './sim/items';

/** What one bar slot holds: a spell, or a consumable named by item id so the slot follows the stack around the bag. */
export type BarEntry = { k: 'ability'; i: number } | { k: 'item'; id: string };
export type BarLayout = (BarEntry | null)[];

/** The keys a fresh player gets, one per slot. The bar is as long as this list, and lays itself out from it. */
export const DEFAULT_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'KeyT', 'Digit7', 'Digit8'];

/** Keys the rest of the game owns (main.ts): binding one to a slot would take movement, the camera or a panel away. */
export const RESERVED_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'Tab', 'Escape',
  'KeyX', 'KeyH', 'KeyJ', 'KeyG', 'KeyZ', 'KeyV', 'KeyM', 'KeyI', 'KeyC', 'KeyK', 'KeyN', 'KeyP',
]);

/** The shapes of `KeyboardEvent.code` a slot may take: letters, digits, the numpad digits and the punctuation keys. */
const BINDABLE = /^(Key[A-Z]|Digit\d|Numpad\d|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash)$/;
const MARKS: Record<string, string> = { Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: '\'', Comma: ',', Period: '.', Slash: '/' };

/** A key code as the player reads it on the slot: `Digit1` is 1, `KeyQ` is Q, an unbound slot is a dash. */
export const keyLabel = (code: string) =>
  !code ? '-' : MARKS[code] ?? code.replace(/^Digit/, '').replace(/^Key/, '').replace(/^Numpad/, 'Num');

/** Why `code` cannot be put on a bar slot, as the sentence the player is shown, or null when it can. */
export function bindRefusal(code: string): string | null {
  if (RESERVED_KEYS.has(code)) return `${keyLabel(code)} is already one of the game's controls`;
  if (!BINDABLE.test(code)) return 'That key cannot be used for an action bar slot';
  return null;
}

/** Put `code` on `slot`, taking it off whatever slot held it: one key fires one slot. */
export const bindKey = (keys: string[], slot: number, code: string) =>
  keys.map((k, i) => (i === slot ? code : k === code ? '' : k));

/** A stored key list, or the defaults. A key the game now owns, a repeat or a nonsense code leaves that slot unbound. */
export function sanitizeKeys(raw: unknown, slots: number): string[] {
  if (!Array.isArray(raw) || raw.length !== slots) return DEFAULT_KEYS.slice(0, slots);
  const kept: string[] = [];
  for (const v of raw) kept.push(typeof v === 'string' && !bindRefusal(v) && !kept.includes(v) ? v : '');
  return kept;
}

/** The two entries name the same thing, so one of them has to go: an ability (or an item) lives in one slot only. */
export const sameEntry = (a: BarEntry | null, b: BarEntry | null) =>
  !!a && !!b && (a.k === 'ability' && b.k === 'ability' ? a.i === b.i : a.k === 'item' && b.k === 'item' ? a.id === b.id : false);

/** Only a usable item (food, a potion) goes on the bar: there is nothing to press on a sword or a lump of ore. */
export const barWorthy = (id: string) => !!ITEMS[id]?.use;

/** The layout a fresh player gets: every ability in order, and the rest of the bar left empty for the spell book and the bag. */
export const defaultBar = (slots: number, abilities: number): BarLayout =>
  Array.from({ length: slots }, (_, i) => (i < abilities ? { k: 'ability' as const, i } : null));

/**
 * A stored layout, or the default. Anything that is not a legal, unrepeated entry is dropped from its slot.
 * A layout saved when the bar was shorter keeps every slot the player arranged; the keys added since come after the old ones, so they are the
 * new slots, and each takes an ability the save predates (an index at or past the old length) that is not already on the bar. An ability the
 * player took off the bar on purpose stays off. A longer layout than the bar has keys for is thrown away: it was saved by a build we cannot read.
 * A plain number is how a slot was stored before it could hold an item: it still means that ability.
 */
export function sanitizeBar(raw: unknown, slots: number, abilities: number): BarLayout {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > slots) return defaultBar(slots, abilities);
  const bar: BarLayout = [];
  for (const v of raw) {
    const e = entryOf(v, abilities);
    bar.push(e && !bar.some(k => sameEntry(k, e)) ? e : null);
  }
  const onBar = (i: number) => bar.some(e => e?.k === 'ability' && e.i === i);
  let next = bar.length;
  while (bar.length < slots) {
    while (next < abilities && onBar(next)) next++;
    bar.push(next < abilities ? { k: 'ability', i: next++ } : null);
  }
  return bar;
}

function entryOf(v: unknown, abilities: number): BarEntry | null {
  if (Number.isInteger(v)) return (v as number) >= 0 && (v as number) < abilities ? { k: 'ability', i: v as number } : null;
  if (!v || typeof v !== 'object') return null;
  const e = v as Partial<BarEntry> & Record<string, unknown>;
  if (e.k === 'ability') return Number.isInteger(e.i) && (e.i as number) >= 0 && (e.i as number) < abilities ? { k: 'ability', i: e.i as number } : null;
  if (e.k === 'item') return typeof e.id === 'string' && barWorthy(e.id) ? { k: 'item', id: e.id } : null;
  return null;
}
