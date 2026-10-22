// HOM-152: the chest in its three states and a standable rock beside an unstandable one, at close range and at play distance, dusk and rain.
//   node bench/chest-look.mjs        -> bench/shots/chest/*.png
// Runs the dev server (not dist/) so the page can import the sim's world and give some rocks a `top` before their slab is built.
import { createServer } from 'vite';
import { launchBrowser } from './browser.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'bench', 'shots', 'chest');
mkdirSync(out, { recursive: true });
const server = await createServer({ root, logLevel: 'error', server: { port: 5199, strictPort: false, open: false } });
await server.listen();
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.error('pageerror', e.stack ?? String(e)));
page.on('console', m => { if (m.type() === 'error') console.error(m.text()); });
await page.goto(`${server.resolvedUrls.local[0]}?debug=1`);
await page.waitForFunction(() => window.__debug, null, { timeout: 60000 });
await page.evaluate(() => window.__debug.view.modelsReady);
await page.locator('.helpok').click({ timeout: 3000 }).catch(() => {});
await page.addScriptTag({ content: `
  window.wait = ms => new Promise(r => setTimeout(r, ms));
  window.look = (x, z, yaw = 0, pitch = 0.3, dist = 6) => {
    const d = window.__debug, p = d.sim.player;
    d.view.debugCam = null; p.hp = p.maxHp = 99999;
    p.x = x; p.z = z; d.view.yaw = yaw; d.view.pitch = pitch; d.view.distance = dist; d.step(); d.step();
  };` });

// a stretch of Highmoor with rocks in it: the first ten rocks near the first one get a top, the rest stay domes
const spot = await page.evaluate(async () => {
  const { REGIONS } = await import('/src/sim/world.ts');
  const reg = REGIONS.find(r => r.id === 'highmoor');
  const rocks = reg.obstacles.filter(o => (o.kind === undefined || o.kind === 'rock') && o.r > 1);
  const first = rocks[0];
  rocks.filter(o => Math.hypot(o.x - first.x, o.z - first.z) < 60).forEach((o, i) => { if (i % 2 === 0) o.top = 0.9 + (i % 3) * 0.3; });
  return { x: first.x, z: first.z, n: rocks.length };
});
console.log('rocks near', spot);
await page.evaluate(({ x, z }) => window.look(x + 12, z + 12, 0.8, 0.35, 14), spot);
await page.waitForTimeout(1500);
await page.screenshot({ path: join(out, 'rocks-dusk.png') });
await page.evaluate(() => window.__debug.view.weather.set('rain', true));
await page.waitForTimeout(1500);
await page.screenshot({ path: join(out, 'rocks-rain.png') });
await page.evaluate(() => window.__debug.view.weather.set('rain', false));

// the three chests in a row on clear ground, seen from a free camera: close, then at play distance
const at = await page.evaluate(({ x, z }) => {
  const d = window.__debug, p = d.sim.player, cx = x + 45, cz = z + 45;
  window.look(cx, cz, 0, 0.3, 6);
  d.sim.enemies.forEach(e => { if (Math.hypot(e.x - cx, e.z - cz) < 40) { e.x += 80; } });
  window.__chests = ['chest', 'chestOpen', 'chestSpent'].map((id, i) => {
    const g = d.view.buildProp(id); g.position.set(cx - 2 + i * 2, 0, cz); d.scene.add(g); return g;
  });
  p.x = cx; p.z = cz + 30;
  return { cx, cz };
}, spot);
const cam = (px, py, pz, ax, ay, az) => page.evaluate(([a, b]) => { window.__debug.view.debugCam = { pos: a, at: b }; }, [[px, py, pz], [ax, ay, az]]);
await cam(at.cx, 1.6, at.cz + 4.5, at.cx, 0.4, at.cz); await page.waitForTimeout(900);
await page.screenshot({ path: join(out, 'chests-close.png') });
await cam(at.cx, 3.2, at.cz + 16, at.cx, 0.5, at.cz); await page.waitForTimeout(900);
await page.screenshot({ path: join(out, 'chests-far.png') });
await cam(at.cx + 1, 3.2, at.cz + 30, at.cx, 0.5, at.cz); await page.waitForTimeout(900);
await page.screenshot({ path: join(out, 'chests-edge.png') });
await browser.close(); await server.close();
