import { createState, step, TICK_DT, Input } from './sim';
import { Renderer } from './render';
import { BAR_KEYS, Hud } from './hud';
import type { InvAction } from './sim/inventory';
import type { ShopAction } from './sim/shop';
import type { Interact } from './sim';
import type { WeatherKind } from './weather';
import { loadGame, loadQuality, saveGame, saveQuality, wipeSave } from './storage';
import { playEvents, setAmbience, toggleMute, unlockAudio } from './sfx';
import { regionAt } from './sim/world';
import { applyStress } from './sim/stress';
import { ITEMS } from './sim/items';
import { bestFoodSlot } from './sim/consumables';
import { Trace } from './trace';

// Dev-only tooling: ?debug=1 (or the dev server) enables ?stress=N and the window.__debug handle. Game code never reads either.
const params = new URLSearchParams(location.search);
const debug = import.meta.env.DEV || params.has('debug');
const stress = debug ? Math.max(1, Number(params.get('stress')) || 1) : 1;
applyStress(stress);
// ?debug=1 only: frame trace (T saves it). Built before the Renderer so its GL link wrapper sees every program. Absent the flag it is null and every call below is a no-op.
const trace = params.has('debug') ? new Trace() : null;

const loaded = stress > 1 ? { state: null, status: 'none' as const } : loadGame(); // stress worlds never touch the real save
const state = loaded.state ?? createState();
const view = new Renderer(document.body, state, loadQuality());
if (trace) (window as any).__frameTrace = trace, trace.attach(view.renderer);
const pendingInv: InvAction[] = [];
const pendingShop: ShopAction[] = [];
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
  craft: (recipe, count) => { pendingCraft = { recipe, count }; },
  questAdvance: what => { pendingAdvance = what; },
  quality: toggle => {
    if (toggle) { view.setQuality(view.quality === 'high' ? 'low' : 'high'); saveQuality(view.quality); }
    return view.quality;
  },
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
if (debug) (window as any).__debug = { renderer: view.renderer, scene: view.scene, view, sim: state, step: () => step(state, readInput()), stress, items: ITEMS };

// --- input -> sim Input ---
/** G: eat the best food the bag has and the moment allows. */
function eatBest() {
  const slot = bestFoodSlot(state.player);
  if (slot < 0) return hud.say('Nothing to eat');
  pendingInv.push({ k: 'use', slot });
  saveDirty = true;
}
const keys = new Set<string>();
let pendingTab = false, pendingClear = false, pendingAttack = false, pendingJump = false, pendingAbility: number | null = null;
/** Keys typed into a form control belong to it. */
const typing = (e: Event) => e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
addEventListener('keydown', e => {
  if (typing(e)) return;
  keys.add(e.code);
  unlockAudio();
  if (state.player.action?.k === 'flight') return; // the ride owns the screen: no key does anything until it lands
  if (e.code === 'Space' && !hud.modalOpen) { e.preventDefault(); if (!e.repeat) pendingJump = true; return; } // latched here so a tap shorter than a tick still jumps; never scrolls or presses a focused button
  if (e.repeat) return;
  // the ability bar (1 2 3 4 Q E R F) comes first: it owns those keys, and what each one casts is the player's own layout
  if (BAR_KEYS.includes(e.code)) { pendingAbility = hud.abilityAt(BAR_KEYS.indexOf(e.code)); return; }
  if (e.code === 'Tab') { e.preventDefault(); pendingTab = true; }
  else if (e.code === 'Escape') { if (!hud.closeAll()) pendingClear = true; }
  else if (e.code === 'KeyX') pendingAttack = true;
  else if (e.code === 'KeyH') hud.toggleHelp();
  else if (e.code === 'KeyJ') hud.toggleMap();
  else if (e.code === 'KeyG') eatBest();
  else if (e.code === 'KeyV') pendingInteract = { k: 'npc' };
  else if (e.code === 'KeyM') hud.say(toggleMute() ? 'Sound off' : 'Sound on');
  else if (e.code === 'KeyI') hud.toggle('inv');
  else if (e.code === 'KeyC') hud.toggle('char');
  else if (e.code === 'KeyK') hud.toggle('skills');
  else if (e.code === 'KeyN') hud.toggle('talents');
  else if (e.code === 'KeyP') hud.toggle('book');
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); held.clear(); });

/**
 * Mouse, WoW's way round. Nothing on the ground is clickable any more: the mouse is the camera.
 *  - left drag  : swings the camera round the player, who keeps facing wherever they were
 *  - right drag : swings the camera and turns the player with it
 *  - both held  : the same, and the player runs the way the camera looks
 * A left click that did not drag still picks what is under it (an enemy, a drop, an NPC, a node, the forge).
 */
let pendingEnemy: number | null = null;
let pendingPickup: number | null = null;
let pendingInteract: Interact | null = null;
const held = new Set<number>();
let dragMoved = 0;
const DRAG_SLOP_PX = 5; // below this a press is a click, not a drag
/** How far outside an enemy's silhouette a click still takes it, in screen pixels. */
const CLICK_TOLERANCE_PX = 28;
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('mousedown', e => {
  if (!held.size) dragMoved = 0; // the first button down starts the gesture; the second joins it
  held.add(e.button);
  unlockAudio();
});
addEventListener('mouseup', e => {
  if (held.has(0) && e.button === 0 && dragMoved < DRAG_SLOP_PX) {
    // Precedence, most specific first: ground drop, then an enemy under the cursor itself, then the NPC, ore/tree node and
    // forge (all exact), and only then the forgiving enemy pick: a near miss takes the enemy, but never a click that was
    // really aimed at something else. A click that hits none of them does nothing at all.
    pendingPickup = view.pickDrop(e.clientX, e.clientY);
    if (pendingPickup === null) pendingEnemy = view.pickEnemy(e.clientX, e.clientY);
    if (pendingPickup === null && pendingEnemy === null) {
      const node = view.pickNode(e.clientX, e.clientY), npc = view.pickNpc(e.clientX, e.clientY), vendor = view.pickVendor(e.clientX, e.clientY), flightMaster = view.pickFlightMaster(e.clientX, e.clientY);
      if (npc !== null) pendingInteract = { k: 'npc', id: npc };
      else if (flightMaster !== null) pendingInteract = { k: 'flightmaster', id: flightMaster };
      else if (node !== null) pendingInteract = { k: 'node', id: node };
      else if (vendor !== null) pendingInteract = { k: 'vendor', id: vendor };
      else if (view.pickForge(e.clientX, e.clientY)) pendingInteract = { k: 'forge' };
      else if (view.pickRange(e.clientX, e.clientY)) pendingInteract = { k: 'range' };
      else pendingEnemy = view.pickEnemy(e.clientX, e.clientY, CLICK_TOLERANCE_PX);
    }
  }
  held.delete(e.button);
});
addEventListener('mousemove', e => {
  if (!held.size) return;
  dragMoved += Math.abs(e.movementX) + Math.abs(e.movementY);
  if (dragMoved >= DRAG_SLOP_PX) view.orbit(e.movementX, e.movementY);
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
    clickTarget: null,
    clickEnemy: pendingEnemy,
    tab: pendingTab,
    attack: pendingAttack,
    jump: (pendingJump || keys.has('Space')) && !hud.modalOpen,
    clearTarget: pendingClear,
    ability: pendingAbility,
    pickup: pendingPickup,
    inv: pendingInv.splice(0),
    shop: pendingShop.splice(0),
    interact: pendingInteract,
    craft: pendingCraft,
    questAdvance: pendingAdvance,
    talent: pendingTalent,
    talentReset: pendingTalentReset,
    flight: pendingFlight,
  };
  pendingFlight = null;
  pendingInteract = null; pendingCraft = null; pendingAdvance = false; pendingTalent = null; pendingTalentReset = false;
  pendingEnemy = null; pendingPickup = null; pendingTab = false; pendingAttack = false; pendingJump = false; pendingClear = false; pendingAbility = null;
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
    playEvents(state.events);
    const region = regionAt(state.player.x, state.player.z)?.id ?? null;
    if (region !== lastRegion) setAmbience(lastRegion = region);
    trace?.tick(state.events);
    if (state.events.some(ev => ev.t === 'levelup' || ev.t === 'quest' || ev.t === 'crafted' || ev.t === 'kill' || ev.t === 'talent' || ev.t === 'talentreset' || ev.t === 'flight' || ev.t === 'discover')) saveDirty = true;
    acc -= TICK_DT;
  }
  // autosave: soon after anything meaningful, otherwise on a timer
  sinceSave += dt;
  if ((saveDirty && sinceSave > 1) || sinceSave > AUTOSAVE_EVERY) { save(); saveDirty = false; sinceSave = 0; }
  trace?.simDone();
  trace?.drawStart();
  view.draw(state, acc / TICK_DT);
  trace?.drawEnd();
  hud.update(state, dt);
  trace?.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
