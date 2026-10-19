import { createState, step, TICK_DT, Input } from './sim';
import { Renderer } from './render';
import { Hud } from './hud';
import type { InvAction } from './sim/inventory';
import type { Interact } from './sim';
import { loadGame, loadQuality, saveGame, saveQuality, wipeSave } from './storage';
import { playEvents, toggleMute, unlockAudio } from './sfx';
import { applyStress } from './sim/stress';
import { ITEMS } from './sim/items';
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
let pendingCraft: { recipe: string; count: number } | null = null;
let pendingAdvance = false;
let pendingTalent: string | null = null, pendingTalentReset = false;

// --- save / load ---
const AUTOSAVE_EVERY = 20; // seconds
let wiped = stress > 1, saveDirty = false, sinceSave = 0;
function save(): boolean { return !wiped && saveGame(state); }
const hud = new Hud((x, y, z) => view.project(x, y, z), () => view.yaw, {
  inv: a => { pendingInv.push(a); saveDirty = true; },
  talent: id => { pendingTalent = id; saveDirty = true; },
  talentReset: () => { pendingTalentReset = true; saveDirty = true; },
  craft: (recipe, count) => { pendingCraft = { recipe, count }; },
  questAdvance: () => { pendingAdvance = true; },
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
if (debug) (window as any).__debug = { renderer: view.renderer, scene: view.scene, view, sim: state, step: () => step(state, readInput()), stress, items: ITEMS };

// --- input -> sim Input ---
const keys = new Set<string>();
let pendingTab = false, pendingClear = false, pendingAttack = false, pendingJump = false, pendingAbility: number | null = null;
/** Keys typed into a form control belong to it. */
const typing = (e: Event) => e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
addEventListener('keydown', e => {
  if (typing(e)) return;
  keys.add(e.code);
  unlockAudio();
  if (e.code === 'Space' && !hud.modalOpen) { e.preventDefault(); if (!e.repeat) pendingJump = true; return; } // latched here so a tap shorter than a tick still jumps; never scrolls or presses a focused button
  if (e.repeat) return;
  if (e.code === 'Tab') { e.preventDefault(); pendingTab = true; }
  else if (e.code === 'Escape') { if (!hud.closeOverlay()) pendingClear = true; }
  else if (e.code === 'KeyR') pendingAttack = true;
  else if (e.code === 'KeyH') hud.toggleHelp();
  else if (e.code === 'KeyE') pendingInteract = { k: 'npc' };
  else if (e.code === 'KeyM') hud.say(toggleMute() ? 'Sound off' : 'Sound on');
  else if (e.code === 'KeyI') hud.toggle('inv');
  else if (e.code === 'KeyC') hud.toggle('char');
  else if (e.code === 'KeyK') hud.toggle('skills');
  else if (e.code === 'KeyN') hud.toggle('talents');
  else if (/^Digit[1-6]$/.test(e.code)) pendingAbility = Number(e.code.slice(5)) - 1;
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

// Left-click without dragging = click-to-move; left-drag = orbit.
let pendingClick: { x: number; z: number } | null = null;
let pendingEnemy: number | null = null;
let pendingPickup: number | null = null;
let pendingInteract: Interact | null = null;
let dragging = false, dragMoved = 0;
/** How far outside an enemy's silhouette a click still takes it, in screen pixels. */
const CLICK_TOLERANCE_PX = 28;
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('mousedown', () => { dragging = true; dragMoved = 0; unlockAudio(); });
addEventListener('mouseup', e => {
  if (dragging && e.button === 0 && dragMoved < 5) {
    // Precedence, most specific first: ground drop, then an enemy under the cursor itself, then the NPC, ore/tree node and
    // forge (all exact), and only then the forgiving enemy pick: a near miss takes the enemy, but never a click that was
    // really aimed at something else. The ground (click-to-move) comes last.
    pendingPickup = view.pickDrop(e.clientX, e.clientY);
    if (pendingPickup === null) pendingEnemy = view.pickEnemy(e.clientX, e.clientY);
    if (pendingPickup === null && pendingEnemy === null) {
      const node = view.pickNode(e.clientX, e.clientY);
      if (view.pickNpc(e.clientX, e.clientY)) pendingInteract = { k: 'npc' };
      else if (node !== null) pendingInteract = { k: 'node', id: node };
      else if (view.pickForge(e.clientX, e.clientY)) pendingInteract = { k: 'forge' };
      else if ((pendingEnemy = view.pickEnemy(e.clientX, e.clientY, CLICK_TOLERANCE_PX)) === null) pendingClick = view.pick(e.clientX, e.clientY);
    }
  }
  dragging = false;
});
addEventListener('mousemove', e => {
  if (!dragging) return;
  dragMoved += Math.abs(e.movementX) + Math.abs(e.movementY);
  if (dragMoved >= 5) view.orbit(e.movementX, e.movementY);
});
canvas.addEventListener('wheel', e => { e.preventDefault(); view.zoom(e.deltaY); }, { passive: false });

function readInput(): Input {
  // WASD is camera-relative: W moves away from the camera.
  const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const r = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const sy = Math.sin(view.yaw), cy = Math.cos(view.yaw);
  // forward = (-sin, -cos), right = (cos, -sin)
  const input: Input = {
    dirX: -sy * f + cy * r,
    dirZ: -cy * f - sy * r,
    clickTarget: pendingClick,
    clickEnemy: pendingEnemy,
    tab: pendingTab,
    attack: pendingAttack,
    jump: (pendingJump || keys.has('Space')) && !hud.modalOpen,
    clearTarget: pendingClear,
    ability: pendingAbility,
    pickup: pendingPickup,
    inv: pendingInv.splice(0),
    interact: pendingInteract,
    craft: pendingCraft,
    questAdvance: pendingAdvance,
    talent: pendingTalent,
    talentReset: pendingTalentReset,
  };
  pendingInteract = null; pendingCraft = null; pendingAdvance = false; pendingTalent = null; pendingTalentReset = false;
  pendingClick = null; pendingEnemy = null; pendingPickup = null; pendingTab = false; pendingAttack = false; pendingJump = false; pendingClear = false; pendingAbility = null;
  return input;
}

// --- fixed timestep loop ---
let last = performance.now(), acc = 0;
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
    trace?.tick(state.events);
    if (state.events.some(ev => ev.t === 'levelup' || ev.t === 'quest' || ev.t === 'crafted' || ev.t === 'kill' || ev.t === 'talent' || ev.t === 'talentreset')) saveDirty = true;
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
