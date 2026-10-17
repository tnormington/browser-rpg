import { createState, step, TICK_DT, Input } from './sim';
import { Renderer } from './render';
import { Hud } from './hud';
import type { InvAction } from './sim/inventory';

const state = createState();
const view = new Renderer(document.body, state);
const pendingInv: InvAction[] = [];
const hud = new Hud((x, y, z) => view.project(x, y, z), a => pendingInv.push(a));
const canvas = view.renderer.domElement;

// --- input -> sim Input ---
const keys = new Set<string>();
let pendingTab = false, pendingClear = false, pendingAbility: number | null = null;
addEventListener('keydown', e => {
  keys.add(e.code);
  if (e.repeat) return;
  if (e.code === 'Tab') { e.preventDefault(); pendingTab = true; }
  else if (e.code === 'Escape') pendingClear = true;
  else if (e.code === 'KeyI') hud.toggle('inv');
  else if (e.code === 'KeyC') hud.toggle('char');
  else if (/^Digit[1-4]$/.test(e.code)) pendingAbility = Number(e.code.slice(5)) - 1;
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

// Left-click without dragging = click-to-move; left-drag = orbit.
let pendingClick: { x: number; z: number } | null = null;
let pendingEnemy: number | null = null;
let pendingPickup: number | null = null;
let dragging = false, dragMoved = 0;
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('mousedown', () => { dragging = true; dragMoved = 0; });
addEventListener('mouseup', e => {
  if (dragging && e.button === 0 && dragMoved < 5) {
    pendingPickup = view.pickDrop(e.clientX, e.clientY);
    if (pendingPickup === null) pendingEnemy = view.pickEnemy(e.clientX, e.clientY);
    if (pendingPickup === null && pendingEnemy === null) pendingClick = view.pick(e.clientX, e.clientY);
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
    clearTarget: pendingClear,
    ability: pendingAbility,
    pickup: pendingPickup,
    inv: pendingInv.splice(0),
  };
  pendingClick = null; pendingEnemy = null; pendingPickup = null; pendingTab = false; pendingClear = false; pendingAbility = null;
  return input;
}

// --- fixed timestep loop ---
let last = performance.now(), acc = 0;
function frame(now: number) {
  const dt = Math.min((now - last) / 1000, 0.25);
  acc += dt;
  last = now;
  while (acc >= TICK_DT) {
    step(state, readInput());
    view.snapshot(state);
    view.onEvents(state.events, state);
    hud.onEvents(state.events, state);
    acc -= TICK_DT;
  }
  view.draw(state, acc / TICK_DT);
  hud.update(state, dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
