import { createState, step, TICK_DT, Input } from './sim';
import { Renderer } from './render';
import { Hud } from './hud';
import type { InvAction } from './sim/inventory';
import type { ShopAction } from './sim/shop';
import type { EnchantAction } from './sim/enchanting';
import type { AdminAction } from './sim/admin';
import type { Interact } from './sim';
import type { WeatherKind } from './weather';
import { loadGame, loadQuality, saveGame, saveQuality, wipeSave } from './storage';
import { playEvents, setAmbience, setWeather, toggleMute, unlockAudio } from './sfx';
import { GATES, LANDMARKS, WITHERING, regionAt } from './sim/world';
import { bestMount } from './sim/mounts';
import { applyStress } from './sim/stress';
import { ITEMS } from './sim/items';
import { bestFoodSlot } from './sim/consumables';
import { nodeById } from './sim/gathering';
import { CursorId, cursorFor } from './cursor';
import { cursorCss, preloadCursorArt } from './art';
import { Trace } from './trace';

// False in a public build (vite.config.ts), which folds every branch below it away: the deployed game has no
// QA panel and no __debug handle however the URL is dressed up. A local build keeps them, for the benches.
declare const __QA_TOOLS__: boolean;

// Dev-only tooling: ?debug=1 (or the dev server) enables ?stress=N and the window.__debug handle. Game code never reads either.
const params = new URLSearchParams(location.search);
const debug = __QA_TOOLS__ && (import.meta.env.DEV || params.has('debug'));
const stress = debug ? Math.max(1, Number(params.get('stress')) || 1) : 1;
applyStress(stress);
// ?debug=1 only: frame trace (T saves it). Built before the Renderer so its GL link wrapper sees every program. Absent the flag it is null and every call below is a no-op.
const trace = debug && params.has('debug') ? new Trace() : null;

const loaded = stress > 1 ? { state: null, status: 'none' as const } : loadGame(); // stress worlds never touch the real save
const state = loaded.state ?? createState();
const view = new Renderer(document.body, state, loadQuality());
if (trace) (window as any).__frameTrace = trace, trace.attach(view.renderer);
const pendingInv: InvAction[] = [];
const pendingShop: ShopAction[] = [];
const pendingEnchant: EnchantAction[] = [];
const pendingAdmin: AdminAction[] = [];
let pendingCraft: { recipe: string; count: number } | null = null;
let pendingAdvance: boolean | 'road' = false;
let pendingTalent: string | null = null, pendingTalentReset = false;
let pendingFlight: string | null = null;

// --- save / load ---
const AUTOSAVE_EVERY = 20; // seconds
let wiped = stress > 1, saveDirty = false, sinceSave = 0;
function save(): boolean { return !wiped && saveGame(state); }
const hud = new Hud((x, y, z) => view.showingMap ? null : view.project(x, y, z), () => view.yaw, {
  fly: to => { pendingFlight = to; saveDirty = true; },
  map: { setScreen: on => view.setMapScreen(on), project: town => view.mapProject(town), projectYou: () => view.mapProjectYou() },
  inv: a => { pendingInv.push(a); saveDirty = true; },
  talent: id => { pendingTalent = id; saveDirty = true; },
  talentReset: () => { pendingTalentReset = true; saveDirty = true; },
  sell: (slot, qty) => { pendingShop.push({ k: 'sell', slot, qty }); saveDirty = true; },
  buy: (item, qty) => { pendingShop.push({ k: 'buy', item, qty }); saveDirty = true; },
  learn: slot => { pendingShop.push({ k: 'learn', slot }); saveDirty = true; },
  repair: () => { pendingShop.push({ k: 'repair' }); saveDirty = true; },
  buyMount: id => { pendingShop.push({ k: 'mount', id }); saveDirty = true; },
  craft: (recipe, count) => { pendingCraft = { recipe, count }; },
  enchant: a => { pendingEnchant.push(a); saveDirty = true; },
  questAdvance: what => { pendingAdvance = what; },
  quality: toggle => {
    if (toggle) { view.setQuality(view.quality === 'high' ? 'low' : 'high'); saveQuality(view.quality); }
    return view.quality;
  },
  // the QA panel, and with it the admin actions, exists only in a debug build: a player's game has no way to raise one
  admin: debug ? (a: AdminAction) => { pendingAdmin.push(a); saveDirty = true; } : undefined,
  save: () => hud.note(save() ? 'Game saved.' : 'Could not save (browser storage unavailable).', 'log-info'),
  newGame: () => {
    if (!confirm('Wipe your save and start a new game?')) return;
    wiped = true; // stops the unload handler from re-saving over the wipe
    wipeSave();
    location.reload();
  },
});
if (loaded.status === 'loaded') hud.note('Welcome back: your progress was loaded.', 'log-quest');
else if (loaded.status === 'incompatible') hud.note('Your old save was from a different version and was ignored: starting a new game.', 'log-bad');
addEventListener('beforeunload', save);
addEventListener('visibilitychange', () => { if (document.hidden) save(); });
const canvas = view.renderer.domElement;
if (debug && params.has('weather')) view.weather.set(params.get('weather') as WeatherKind, true); // ?weather=clear|overcast|rain|fog pins it for the bench
if (debug) (window as any).__debug = { renderer: view.renderer, scene: view.scene, view, sim: state, step: () => step(state, readInput()), stress, items: ITEMS, world: { WITHERING, GATES, LANDMARKS, regionAt } };

// --- input -> sim Input ---
/** G: eat the best food the bag has and the moment allows. */
function eatBest() {
  const slot = bestFoodSlot(state.player);
  if (slot < 0) return hud.say('Nothing to eat');
  use(slot);
}
function use(slot: number) {
  pendingInv.push({ k: 'use', slot });
  saveDirty = true;
}
/** An action bar key: a spell goes to the sim as a cast, a consumable as a use of the first stack of it in the bag. */
function pressBarSlot(barSlot: number) {
  const entry = hud.entryAt(barSlot);
  if (!entry) return;
  if (entry.k === 'ability') return void pendingAbilities.push(entry.i);
  const slot = state.player.inventory.findIndex(st => st?.id === entry.id);
  if (slot < 0) return hud.say(`You have no ${ITEMS[entry.id].name} left`);
  use(slot);
}
const keys = new Set<string>();
let pendingMount = false, pendingTab = false, pendingClear = false, pendingAttack = false, pendingJump = false;
/** Ability presses in the order they were made, one handed to each tick: two keys inside one tick (Guard, then Strike) are both cast, not the last of them. */
const pendingAbilities: number[] = [];
/** Keys typed into a form control belong to it. */
const typing = (e: Event) => e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
addEventListener('keydown', e => {
  if (typing(e)) return;
  keys.add(e.code);
  unlockAudio();
  if (state.player.action?.k === 'flight') return; // the ride owns the screen: no key does anything until it lands
  if (e.code === 'Space' && !hud.modalOpen) { e.preventDefault(); if (!e.repeat) pendingJump = true; return; } // latched here so a tap shorter than a tick still jumps; never scrolls or presses a focused button
  if (e.repeat) return;
  // the action bar comes first: it owns its keys, and both the layout and the keys themselves are the player's own
  const barSlot = hud.slotForKey(e.code);
  if (barSlot >= 0) { pressBarSlot(barSlot); return; }
  if (e.code === 'Tab') { e.preventDefault(); pendingTab = true; }
  else if (e.code === 'Escape') { if (!hud.closeAll()) pendingClear = true; }
  else if (e.code === 'KeyX') pendingAttack = true;
  else if (e.code === 'KeyH') hud.toggleHelp();
  else if (e.code === 'KeyJ') hud.toggleMap();
  else if (e.code === 'KeyG') eatBest();
  else if (e.code === 'KeyZ') pendingMount = true;
  else if (e.code === 'KeyV') pendingInteract = { k: 'npc' };
  else if (e.code === 'KeyM') hud.say(toggleMute() ? 'Sound off' : 'Sound on');
  else if (e.code === 'KeyI') hud.toggle('inv');
  else if (e.code === 'KeyC') hud.toggle('char');
  else if (e.code === 'KeyK') hud.toggle('skills');
  else if (e.code === 'KeyN') hud.toggle('talents');
  else if (e.code === 'KeyP') hud.toggle('book');
  else if (debug && e.code === 'Backquote') hud.toggleAdmin(); // the QA panel: after the bar, so a slot bound to ` still wins
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); held.clear(); cursorAwayForDrag(false); }); // a drag that ends by leaving the window still gives the cursor back

/**
 * Mouse, WoW's way round. Nothing on the ground is clickable any more: the mouse is the camera.
 *  - left drag  : swings the camera round the player, who keeps facing wherever they were
 *  - right drag : swings the camera and turns the player with it
 *  - both held  : the same, and the player runs the way the camera looks
 * A left click that did not drag still picks what is under it (an enemy, an NPC, a node, the forge), but it never
 * moves the player: the only thing that walks is the keys.
 */
let pendingEnemy: number | null = null;
let pendingInteract: Interact | null = null;
const held = new Set<number>();
let dragMoved = 0, pressX = 0, pressY = 0;
const DRAG_SLOP_PX = 5; // below this a press is a click, not a drag. How far the cursor got from where it went down, not how far it wandered getting there: a hand tremor over several mousemoves used to add up past the slop and eat the click
/** How far outside a target's silhouette a click still takes it, in screen pixels. */
const CLICK_TOLERANCE_PX = 48;
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('mousedown', e => {
  if (!held.size) { dragMoved = 0; pressX = e.clientX; pressY = e.clientY; } // the first button down starts the gesture; the second joins it
  held.add(e.button);
  unlockAudio();
});
addEventListener('mouseup', e => {
  if (held.has(0) && e.button === 0 && dragMoved < DRAG_SLOP_PX) {
    // What is under the press, by the one precedence both the click and the cursor read (render.ts pickAt). A click
    // that hits none of them does nothing at all.
    const hit = view.pickAt(e.clientX, e.clientY, CLICK_TOLERANCE_PX);
    if (hit?.k === 'enemy') pendingEnemy = hit.id;
    else if (hit) pendingInteract = hit;
  }
  held.delete(e.button);
  if (!held.size) cursorAwayForDrag(false); // the second button of a two-button drag keeps the cursor away until it too comes up
});
/**
 * A swing of the camera takes the cursor away, and gives it back when the last button comes up. Only once the
 * press is past the slop and is really a drag — a click that picks something never hides it, so picking never
 * flashes the cursor away. A pointer lock would also pin the cursor where the drag began, but Chromium puts a
 * "localhost has control of your pointer" banner across the top of the game every time one is taken, which is
 * browser UI the page cannot dismiss or suppress, so the cursor is only hidden, not held.
 */
function cursorAwayForDrag(on: boolean) {
  document.body.classList.toggle('swinging', on);
}
/**
 * The cursor is the game's own, and it says what the press under it would do (HOM-142): the arrow everywhere,
 * an anvil and hammer over the forge, a coin pouch over a merchant, crossed swords over an enemy. It reads the
 * same pickAt the click reads, so the two can never disagree about what is under the pointer.
 *
 * Resolved on the frame rather than on the move, for two reasons. The chain is a dozen raycasts, and a mouse
 * reports far more often than it is worth running; and the world moves under a pointer that is standing still —
 * walk past a boar and the cursor has to become a sword without the mouse having been touched. CURSOR_EVERY is
 * the throttle on top of that: a tenth of a second is under what a hand notices, and cuts the chain to a tenth.
 *
 * Only the canvas wears it. Over a HUD panel the panel's own cursor applies (a button is a hand, a bag slot a
 * grab), and body carries the plain arrow so nothing is ever left on the system's.
 */
let pointerX = -1, pointerY = -1, cursorNow: CursorId | null = null, sinceCursor = 0;
const CURSOR_EVERY = 0.1;
function updateCursor(dt: number) {
  sinceCursor += dt;
  if (pointerX < 0 || sinceCursor < CURSOR_EVERY) return;
  sinceCursor = 0;
  // A swing hides the cursor anyway, and the map screen draws no world to pick out of: both stay on the arrow,
  // so the pointer does not come back from a drag still wearing whatever it was over when the drag began.
  const pick = held.size || view.showingMap ? null : view.pickAt(pointerX, pointerY, CLICK_TOLERANCE_PX);
  // A pick names a node by id alone, and an axe over a tree is not the pickaxe over a rock, so the type is read
  // out of the state here and cursor.ts stays pure.
  const want = cursorFor(pick, pick?.k === 'node' ? nodeById(state, pick.id)?.type : undefined);
  if (want === cursorNow) return;
  canvas.style.cursor = cursorCss(cursorNow = want);
}
document.body.style.cursor = cursorCss('point');
preloadCursorArt();

addEventListener('mousemove', e => {
  pointerX = e.clientX; pointerY = e.clientY;
  if (!held.size) return;
  dragMoved = Math.max(dragMoved, Math.hypot(e.clientX - pressX, e.clientY - pressY)); // a high-water mark: a drag that comes back to where it started is still a drag
  if (dragMoved >= DRAG_SLOP_PX) { cursorAwayForDrag(true); view.orbit(e.movementX, e.movementY); }
});
canvas.addEventListener('wheel', e => { e.preventDefault(); view.zoom(e.deltaY); }, { passive: false });

function readInput(): Input {
  // WASD is camera-relative: W moves away from the camera. Both mouse buttons held is a held W.
  const steering = held.has(2), autorun = held.has(0) && steering;
  const f = (keys.has('KeyW') || keys.has('ArrowUp') || autorun ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const r = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const sy = Math.sin(view.yaw), cy = Math.cos(view.yaw);
  // forward = (-sin, -cos), right = (cos, -sin)
  const input: Input = {
    dirX: -sy * f + cy * r,
    dirZ: -cy * f - sy * r,
    face: steering ? view.yaw + Math.PI : null, // facing is atan2(dx, dz) of the camera's forward, which is yaw turned round
    clickEnemy: pendingEnemy,
    tab: pendingTab,
    attack: pendingAttack,
    mount: pendingMount,
    jump: (pendingJump || keys.has('Space')) && !hud.modalOpen,
    sprint: keys.has('ShiftLeft') || keys.has('ShiftRight'), // held, like the walk keys: let go and you are back to a jog

    clearTarget: pendingClear,
    ability: pendingAbilities.shift() ?? null,
    inv: pendingInv.splice(0),
    shop: pendingShop.splice(0),
    enchant: pendingEnchant.splice(0),
    admin: pendingAdmin.splice(0),
    interact: pendingInteract,
    craft: pendingCraft,
    questAdvance: pendingAdvance,
    talent: pendingTalent,
    talentReset: pendingTalentReset,
    flight: pendingFlight,
  };
  pendingFlight = null;
  pendingInteract = null; pendingCraft = null; pendingAdvance = false; pendingTalent = null; pendingTalentReset = false;
  pendingEnemy = null; pendingTab = false; pendingAttack = false; pendingMount = false; pendingJump = false; pendingClear = false;
  return input;
}

// --- fixed timestep loop ---
let last = performance.now(), acc = 0;
let lastRegion: string | null | undefined; // undefined until the first tick, so the starting region's bed is asked for too
function frame(now: number) {
  trace?.beginFrame(now);
  const dt = Math.min((now - last) / 1000, 0.25);
  acc += dt;
  last = now;
  while (acc >= TICK_DT) {
    step(state, readInput());
    view.snapshot(state);
    view.onEvents(state.events, state);
    hud.onEvents(state.events, state);
    playEvents(state.events, state.player.mounted ? bestMount(state.player)?.id ?? 'courser' : null);
    const region = regionAt(state.player.x, state.player.z)?.id ?? null;
    if (region !== lastRegion) setAmbience(lastRegion = region);
    trace?.tick(state.events);
    if (state.events.some(ev => ev.t === 'levelup' || ev.t === 'quest' || ev.t === 'crafted' || ev.t === 'kill' || ev.t === 'talent' || ev.t === 'talentreset' || ev.t === 'flight' || ev.t === 'discover' || ev.t === 'stable' || ev.t === 'mount')) saveDirty = true;
    acc -= TICK_DT;
  }
  // autosave: soon after anything meaningful, otherwise on a timer
  sinceSave += dt;
  if ((saveDirty && sinceSave > 1) || sinceSave > AUTOSAVE_EVERY) { save(); saveDirty = false; sinceSave = 0; }
  trace?.simDone();
  trace?.drawStart();
  view.draw(state, acc / TICK_DT);
  trace?.drawEnd();
  setWeather(view.weatherHeard);   // after the draw: the draw is what moves the weather on
  hud.update(state, dt);
  updateCursor(dt); // after the draw: the pick reads the camera the frame was drawn with
  trace?.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
