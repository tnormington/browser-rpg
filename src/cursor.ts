// What the mouse pointer is wearing, and why (HOM-142). The cursor is the game's own: a painted arrowhead
// everywhere, and over anything the click would do something to, the thing that would happen — an anvil and
// hammer over the smith's forge, a spilling coin pouch over a merchant, crossed swords over an enemy.
//
// Pure: the ids, the hotspots and the mapping, and nothing that reads a file or touches the DOM. That is what
// lets src/cursor.test.ts and scripts/cursor-art.ts both hold this set against the art on disk. The files
// themselves are art.ts's (cursorCss), and main.ts is what puts one on the canvas.
import type { Interact } from './sim/actions';

/**
 * What the pointer is over. An enemy, or anything the sim already knows how to be clicked: `Interact` is the
 * sim's own vocabulary (sim/actions.ts), so a station added there arrives here as a compile error in CURSOR_FOR
 * rather than as a pointer that silently keeps the plain arrow.
 */
export type Pick = { k: 'enemy'; id: number } | Interact;

/** Every cursor, in the order a reviewer wants to see them: the arrow, then the picks it turns into. */
export const CURSOR_IDS = ['point', 'attack', 'talk', 'trade', 'flight', 'gather', 'forge', 'cook', 'brew', 'tan', 'rune'] as const;
export type CursorId = typeof CURSOR_IDS[number];

/** The side of every cursor image, in CSS pixels. Chromium ignores a cursor over 128, and under about 32 the painted emblems stop reading. */
export const CURSOR_SIZE = 44;

/**
 * Where in the image the click actually lands. The arrow's is its own tip, up in the corner it points at, as
 * every arrow cursor's is; scripts/cursor-art.ts reads this number and hangs the arrow by its tip from it, so
 * moving it moves the picture too rather than leaving the two to drift apart. An emblem has no tip to aim with,
 * so it is carried on its centre and the thing it
 * stands for sits under the middle of it; the picks are forgiving to 48 pixels anyway (main.ts), so a centred
 * hotspot never costs a click.
 */
export const CURSOR_HOTSPOTS: Record<CursorId, [number, number]> = {
  point: [5, 5],
  attack: [22, 22], talk: [22, 22], trade: [22, 22], flight: [22, 22], gather: [22, 22],
  forge: [22, 22], cook: [22, 22], brew: [22, 22], tan: [22, 22], rune: [22, 22],
};

/**
 * The system cursor each one falls back to when its art is not on disk, so the game is playable with no
 * cursor art at all — the same silence itemArt keeps for a new item with no thumbnail yet.
 */
export const CURSOR_FALLBACKS: Record<CursorId, string> = {
  point: 'default', attack: 'crosshair', talk: 'pointer', trade: 'pointer', flight: 'pointer', gather: 'pointer',
  forge: 'pointer', cook: 'pointer', brew: 'pointer', tan: 'pointer', rune: 'pointer',
};

/** The cursor each kind of pick wears. A Record and not a switch: a new pick kind must be answered here or it will not compile. */
export const CURSOR_FOR: Record<Pick['k'], CursorId> = {
  enemy: 'attack',
  npc: 'talk',
  vendor: 'trade',
  flightmaster: 'flight',
  node: 'gather',
  forge: 'forge',
  range: 'cook',
  alembic: 'brew',
  rack: 'tan',
  circle: 'rune',
};

/** The cursor for what is under the pointer; the plain arrow when that is nothing. */
export const cursorFor = (pick: Pick | null): CursorId => (pick ? CURSOR_FOR[pick.k] : 'point');
