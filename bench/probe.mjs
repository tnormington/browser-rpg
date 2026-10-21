// Dev probe: what the renderer is holding at a given spot. node bench/probe.mjs x,z[,yaw]   (needs a built dist/)
import { preview } from 'vite';
import { launchBrowser } from './browser.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const at = (process.argv[2] ?? '0,6').split(',').map(Number);
const server = await preview({ root, logLevel: 'error', preview: { port: 4174, open: false } });
const browser = await launchBrowser({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&stress=1`);
await page.waitForFunction(() => window.__debug, null, { timeout: 120000 });
await page.evaluate(() => window.__debug.view.modelsReady);
await page.locator('.helpok').click({ timeout: 5000 }).catch(() => {});
await page.evaluate(() => new Promise(res => { let n = 0; const f = () => (++n >= 60 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }));
await page.waitForTimeout(Number(process.argv[3] ?? 0));
const out = await page.evaluate(([x, z, yaw]) => {
  const d = window.__debug, v = d.view, p = d.sim.player;
  if (!window.__noMove) { p.hp = p.maxHp = 99999; p.x = x; p.z = z; if (yaw !== undefined) v.yaw = yaw; d.step(); d.step(); }
  for (let i = 0; i < 5; i++) { v.snapshot(d.sim); v.draw(d.sim, 1); }
  const count = () => { let n = 0; d.scene.traverse(() => n++); return n; };
  const trail = [count()];
  for (let i = 0; i < 30; i++) d.step(); trail.push(count());
  for (let i = 0; i < 30; i++) v.draw(d.sim, 0.5); trail.push(count());
  for (let i = 0; i < 30; i++) v.post.render(d.scene); trail.push(count());
  const kinds = {}; d.scene.traverse(o => { const k = o.type + (o.geometry ? ':' + o.geometry.type : ''); kinds[k] = (kinds[k] ?? 0) + 1; });
  let objects = 0, visibleMeshes = 0, meshes = 0;
  d.scene.traverse(o => { objects++; if (o.isMesh) { meshes++; let vis = true; for (let q = o; q; q = q.parent) if (!q.visible) vis = false; if (vis) visibleMeshes++; } });
  const tiles = v.world.tiles.map(t => ({ x0: t.rect.x0, built: !!t.group, vis: t.group?.visible, kids: t.group?.children.length, ground: t.ground.map(m => ({ vis: m.visible, pos: m.geometry.attributes.position.count, col: Array.from(m.geometry.attributes.color.array.slice(0, 6)).map(n => +n.toFixed(2)), mat: m.material.type, vc: m.material.vertexColors })) })).filter(t => t.built);
  return { tiles, trail, kinds, actors: v.actors.size, world: v.world.stats, objects, meshes, visibleMeshes, calls: d.renderer.info.render.calls, tris: d.renderer.info.render.triangles };
}, at);
console.log(JSON.stringify(out));
await page.screenshot({ path: join(root, 'bench', 'shots', 'probe.png') });
await browser.close(); await server.close();
