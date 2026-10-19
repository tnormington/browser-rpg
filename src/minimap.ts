// Minimap: a round radar in the top-right corner. Draws the walkable ground, scenery, gathering nodes, ground drops and
// living enemies within RANGE of the player, north (-z) at the top like the map screen. Reads GameState; presentation only.
import type { GameState } from './sim';
import { REGIONS, collidersIn, regionAt } from './sim/world';
import { el } from './dom';

/** The face's diameter in CSS pixels (the iron ring round it is .minimap in index.html) and how far it sees, in world units. */
const SIZE = 140, RANGE = 44;
/** The game's HUD palette, as the canvas needs it: drained greens and slate for the land, blood for what wants to kill you. */
const C = { back: '#0b0d10', ground: '#2a3228', cave: '#1b1f26', tree: '#35493a', rock: '#565c64', node: '#93b58c', spent: '#4a5247', drop: '#c0a55e', enemy: '#c23a32', target: '#ff7a5a', you: '#6ad8ff', north: '#c0a55e' };

export class Minimap {
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private zone: HTMLElement;
  private zoneName = '';
  private dpr = 0;

  constructor(root: HTMLElement) {
    const box = el(root, 'minimap');
    box.appendChild(this.canvas);
    this.zone = el(box, 'mmzone'); // after the canvas, so the caption prints over the map
    this.ctx = this.canvas.getContext('2d')!;
  }

  update(s: GameState) {
    const p = s.player, ctx = this.ctx, c = SIZE / 2, k = c / RANGE;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (dpr !== this.dpr) { // the backing store follows the display, so the dots stay crisp on a retina screen
      this.dpr = dpr;
      this.canvas.width = this.canvas.height = Math.round(SIZE * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sx = (x: number) => c + (x - p.x) * k, sy = (z: number) => c + (z - p.z) * k;
    const near = (x: number, z: number) => Math.abs(x - p.x) <= RANGE && Math.abs(z - p.z) <= RANGE;
    const dot = (x: number, z: number, r: number, fill: string) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(sx(x), sy(z), r, 0, Math.PI * 2);
      ctx.fill();
    };

    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, c, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = C.back;
    ctx.fillRect(0, 0, SIZE, SIZE);

    // the floor, region by region rather than from the flat FOOTPRINT, so the cave reads darker than open country
    for (const reg of REGIONS) for (const f of reg.footprint) {
      const x0 = sx(f.x0), x1 = sx(f.x1), z0 = sy(f.z0), z1 = sy(f.z1);
      if (x1 < 0 || x0 > SIZE || z1 < 0 || z0 > SIZE) continue;
      ctx.fillStyle = reg.cave ? C.cave : C.ground;
      ctx.fillRect(x0, z0, x1 - x0, z1 - z0);
    }

    // scenery first, gatherables over it: a tree is both, and the node colour is the one worth reading
    for (const o of collidersIn(p.x - RANGE, p.z - RANGE, p.x + RANGE, p.z + RANGE)) {
      dot(o.x, o.z, Math.max(1, o.r * k), o.kind === 'tree' ? C.tree : C.rock);
    }
    for (const n of s.nodes) if (near(n.x, n.z)) dot(n.x, n.z, 2, n.charges > 0 ? C.node : C.spent);
    for (const d of s.drops) if (near(d.x, d.z)) dot(d.x, d.z, 2, C.drop);
    for (const e of s.enemies) {
      if (e.state === 'dead' || !near(e.x, e.z)) continue;
      const sel = e.id === s.targetId;
      dot(e.x, e.z, sel ? 3.5 : 2.5, sel ? C.target : C.enemy);
    }

    // the player: an arrow at the centre pointing where they face (facing is atan2(dx, dz), so forward is (sin, cos))
    const fx = Math.sin(p.facing), fz = Math.cos(p.facing);
    ctx.fillStyle = C.you;
    ctx.beginPath();
    ctx.moveTo(c + fx * 7, c + fz * 7);
    ctx.lineTo(c - fx * 4.5 + fz * 4.5, c - fz * 4.5 - fx * 4.5);
    ctx.lineTo(c - fx * 4.5 - fz * 4.5, c - fz * 4.5 + fx * 4.5);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = C.north;
    ctx.font = 'bold 9px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', c, 11);
    ctx.restore();

    const name = regionAt(p.x, p.z)?.name ?? '';
    if (name !== this.zoneName) this.zone.textContent = this.zoneName = name;
  }
}
