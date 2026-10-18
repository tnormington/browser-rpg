// Click-target coverage: for each enemy type at play distances, sample the screen over the enemy's *visible model* (a ray
// against the real meshes is the ground truth for "the player clicked the enemy") and report how much of it the click picks
// get, for the old proxy raycast and the new volume pick; then probe near misses. Writes annotated screenshots.
//   node bench/pick.mjs   (serves the existing dist/: run `npm run build` first)
import { preview } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'bench', 'shots', 'pick');
mkdirSync(out, { recursive: true });
const TOL = 28; // keep in step with CLICK_TOLERANCE_PX in src/main.ts
const server = await preview({ root, logLevel: 'error', preview: { port: 4175, open: false } });
const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.error('pageerror', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}?debug=1`);
await page.waitForFunction(() => window.__debug, null, { timeout: 60000 });
await page.evaluate(() => window.__debug.view.modelsReady);
await page.locator('.helpok').click({ timeout: 3000 }).catch(() => {});
await page.addScriptTag({ content: `
window.wait = ms => new Promise(r => setTimeout(r, ms));
window.setup = async (type, dist, pitch) => {
  const { view, sim } = window.__debug, p = sim.player;
  p.x = 0; p.z = 0; p.hp = p.maxHp = 1e9; view.yaw = 0; view.pitch = pitch; view.distance = 10; view.debugCam = null;
  let id = null;
  sim.enemies.forEach((e, i) => { e.stagger = 1e9; if (e.type === type && id === null) { id = e.id; e.x = 0; e.z = -dist; e.facing = 2; e.state = 'idle'; } else { e.x = 500 + i * 3; e.z = 500; } });
  await window.wait(400);
  return id;
};
window.measure = (id) => {
  const { view } = window.__debug, a = view.actors.get(id), cam = view.camera;
  const rc = view.raycaster, proxies = a.group.children.filter(c => c.userData.enemyId !== undefined);
  const meshes = []; a.model.traverse(o => { if (o.isMesh) meshes.push(o); });
  // screen rect of the model (sampled over the real vertices via a coarse grid of rays)
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  const ray = (x, y, objs) => { rc.setFromCamera({ x: x / innerWidth * 2 - 1, y: -y / innerHeight * 2 + 1 }, cam); return rc.intersectObjects(objs, false).length > 0; };
  const hits = [];
  for (let y = 0; y < innerHeight; y += 4) for (let x = 0; x < innerWidth; x += 4) if (ray(x, y, meshes)) { hits.push([x, y]); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  let oldOk = 0, newOk = 0;
  for (const [x, y] of hits) { if (ray(x, y, proxies)) oldOk++; if (view.pickEnemy(x, y) === id) newOk++; }
  // near misses: ring of points at a pixel gap outside the silhouette (distance to nearest hit point)
  const near = (gap) => { let n = 0, got = 0; for (let y = y0 - 80; y < y1 + 80; y += 8) for (let x = x0 - 80; x < x1 + 80; x += 8) {
    let d = 1e9; for (const [hx, hy] of hits) { const dd = Math.hypot(hx - x, hy - y); if (dd < d) d = dd; if (d < gap - 4) break; }
    if (d >= gap - 4 && d <= gap + 4) { n++; if (view.pickEnemy(x, y, ${TOL}) === id) got++; } } return n ? Math.round(100 * got / n) : null; };
  return { rect: [x0, y0, x1, y1], hitPx: hits.length, oldPct: Math.round(100 * oldOk / hits.length), newPct: Math.round(100 * newOk / hits.length), near10: near(10), near20: near(20), near40: near(40), near80: near(80) };
};` });

// type, distance from the player in world units (the camera is 10 behind the player, so the enemy is 10 + dist from the lens), pitch
const CASES = [['boar', 6, 0.5], ['boar', 14, 0.5], ['wolf', 8, 0.5], ['wolf', 18, 0.35], ['pup', 8, 0.5], ['pup', 14, 0.5], ['hexer', 11, 0.5], ['hexer', 18, 0.35], ['brute', 5, 0.5], ['brute', 12, 0.5], ['brute', 20, 0.35]];
const rows = [];
for (const [type, dist, pitch] of CASES) {
  const id = await page.evaluate(([t, d, p]) => window.setup(t, d, p), [type, dist, pitch]);
  if (id === null) { console.log(`${type}: no such enemy in this world`); continue; }
  const m = await page.evaluate(i => window.measure(i), id);
  rows.push({ type, dist, ...m });
  console.log(`${type.padEnd(6)} @${String(dist).padStart(2)}u  model ${m.hitPx * 16 / 1000 | 0}k px  old proxy covers ${String(m.oldPct).padStart(3)}%  new covers ${String(m.newPct).padStart(3)}%   near-miss pick rate (px outside): 10=${m.near10}% 20=${m.near20}% 40=${m.near40}% 80=${m.near80}%`);
  // screenshot: a crosshair 20px off the model edge (down-left of the rect), annotated with what a click there picks
  const [x0, , , y1] = m.rect;
  const cx = x0 - 12, cy = y1 - 6;
  const got = await page.evaluate(([x, y, i]) => window.__debug.view.pickEnemy(x, y, 28) === i, [cx, cy, id]);
  await page.evaluate(([x, y, ok, label]) => {
    document.getElementById('probe')?.remove();
    const d = document.createElement('div'); d.id = 'probe';
    d.style.cssText = `position:fixed;left:${x - 9}px;top:${y - 9}px;width:18px;height:18px;border:2px solid ${ok ? '#4f4' : '#f44'};border-radius:50%;z-index:99;pointer-events:none`;
    d.innerHTML = `<div style="position:absolute;left:24px;top:-4px;white-space:nowrap;font:12px sans-serif;color:#fff;background:#000a;padding:2px 4px">${label}</div>`;
    document.body.appendChild(d);
  }, [cx, cy, got, `click here (${Math.round(x0 - cx)}px off the model): ${got ? 'TARGETS the ' + type : 'misses'}`]);
  await page.screenshot({ path: join(out, `${type}-${dist}u.png`) });
}
await browser.close(); await server.close();
