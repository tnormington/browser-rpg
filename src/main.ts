import { createState, step, TICK_DT, Input } from './sim';
import { Renderer } from './render';

const state = createState();
const view = new Renderer(document.body, state);
const canvas = view.renderer.domElement;

// --- input -> sim Input ---
const keys = new Set<string>();
addEventListener('keydown', e => keys.add(e.code));
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

// Left-click without dragging = click-to-move; left-drag = orbit.
let pendingClick: { x: number; z: number } | null = null;
let dragging = false, dragMoved = 0;
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('mousedown', () => { dragging = true; dragMoved = 0; });
addEventListener('mouseup', e => {
  if (dragging && e.button === 0 && dragMoved < 5) pendingClick = view.pick(e.clientX, e.clientY);
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
  };
  pendingClick = null;
  return input;
}

// --- fixed timestep loop ---
let last = performance.now(), acc = 0;
function frame(now: number) {
  acc += Math.min((now - last) / 1000, 0.25);
  last = now;
  while (acc >= TICK_DT) {
    step(state, readInput());
    view.snapshot(state);
    acc -= TICK_DT;
  }
  view.draw(state, acc / TICK_DT);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
