// The generated art (HOM-135), looked up by the id the game already knows each thing by: assets/art/items/<item id>.webp
// for a thumbnail, assets/art/abilities/<ability art id>.webp for an ability icon, assets/art/talents/<talent id>.webp
// for a talent node, assets/art/portraits/<npc id>.webp for a face. Rendering only: nothing here touches the sim.
//
// Portrait ids follow the three sets of NPCs, which share ids with each other: a quest giver is their plain id ('hale' is
// Warden Hale), a merchant or trainer is 'vendor_' + the vendor id, a flight master is 'flight_' + their town. A villager
// at a waystation has no portrait at all, and a panel speaking for one shows no face rather than someone else's.
//
// Anything with no file falls back to what the HUD drew before the art existed (src/art.test.ts holds the set complete),
// so a new item is playable the moment the sim knows it, picture or no picture.
import { el } from './dom';

const ITEM_ART = import.meta.glob('../assets/art/items/*.webp', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const ABILITY_ART = import.meta.glob('../assets/art/abilities/*.webp', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const TALENT_ART = import.meta.glob('../assets/art/talents/*.webp', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const PORTRAIT_ART = import.meta.glob('../assets/art/portraits/*.webp', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

export const itemArt = (id: string): string | null => ITEM_ART[`../assets/art/items/${id}.webp`] ?? null;
/** An ability by its abilityArtId (sim/data.ts), not by its index: the index is a save-file detail and would reshuffle the set. */
export const abilityArt = (id: string): string | null => ABILITY_ART[`../assets/art/abilities/${id}.webp`] ?? null;
/** A talent node by its id in sim/talents.ts. Its own picture, not the ability a capstone hands over. */
export const talentArt = (id: string): string | null => TALENT_ART[`../assets/art/talents/${id}.webp`] ?? null;
export const portraitArt = (id: string): string | null => PORTRAIT_ART[`../assets/art/portraits/${id}.webp`] ?? null;

/**
 * Every item thumbnail, fetched before anything asks to see one (HOM-140). A shut panel is `display: none`, so a
 * picture painted into it is never sent for: opening the bag used to ask for all 28 slots at that moment and leave
 * them blank until the files landed. The whole set is 650 KB, cheaper to spend up front — at idle, where it never
 * races the models the game is still loading — than a slot at a time on the open.
 *
 * `warmed` is the point of this, not a leak. Dropping each Image the moment its load starts leaves the file in the
 * disk cache, where the dev server's `no-cache` makes the open revalidate all 28 anyway and wait on the round trips;
 * holding it keeps the decoded picture in the renderer's own cache, and the slot is drawn with no request at all.
 * `node bench/invart.mjs` is what measures that: 28 requests on the open without this line, none with it.
 *
 * One warm covers every panel that draws an item - the bag, a vendor's stock, a forge list, a loot window.
 */
const warmed: HTMLImageElement[] = [];
export function preloadItemArt() {
  requestIdleCallback(() => {
    for (const url of Object.values(ITEM_ART)) { const img = new Image(); img.src = url; warmed.push(img); }
  }, { timeout: 2000 });
}

/** Paint a piece of art as an element's whole face, or take it off again. `.art` is what makes it cover the element. */
export function paintArt(target: HTMLElement, url: string | null) {
  target.style.backgroundImage = url ? `url("${url}")` : '';
  target.classList.toggle('art', !!url);
}

/**
 * The top of a panel that speaks for an NPC: their face on the left, the panel's own lines in the column beside it.
 * The face stays empty until setFace names whoever the panel has opened for.
 */
export function faceRow(panel: HTMLElement): { face: HTMLElement; body: HTMLElement } {
  const row = el(panel, 'facerow');
  return { face: el(row, 'face'), body: el(row, 'facebody') };
}

/** Whose face a panel is wearing now. An NPC with no portrait leaves the panel with no face, not an empty box. */
export function setFace(face: HTMLElement, id: string) {
  const url = portraitArt(id);
  paintArt(face, url);
  face.style.display = url ? 'block' : 'none';
}
