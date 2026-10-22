// HOM-191: the eight edge kinds (src/edges.ts), each laid along a stretch of open ground the way the placer will (ranks, spacing, jitter, rank shade,
// from the recipe), shot from inside looking out at play distance and close, in clear weather and in rain. The game has no time of day: its one
// light is the moonlit dusk, so "day and dusk" is clear and rain here.  node bench/edges.mjs [kind ...]   -> bench/shots/edges/*.png
// The placer here is a stand-in for HOM-190's: instanced per piece-layer with stock materials, so surface detail is a little plainer than in game.
import { createServer } from 'vite';
import { launchBrowser } from './browser.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'bench', 'shots', 'edges');
mkdirSync(out, { recursive: true });
const kinds = process.argv.slice(2).length ? process.argv.slice(2) : ['rock', 'cliff', 'treeline', 'thicket', 'water', 'hedgerow', 'ruin', 'barrow'];
const server = await createServer({ root, logLevel: 'error', server: { port: 4181 } });
await server.listen();
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.error('pageerror', e.stack ?? String(e)));
page.on('console', m => { if (m.type() === 'error') console.error(m.text()); });
await page.goto('http://localhost:4181/?debug=1');
await page.waitForFunction(() => window.__debug, null, { timeout: 120000 });
await page.evaluate(() => window.__debug.view.modelsReady);
await page.locator('.helpok').click({ timeout: 3000 }).catch(() => {});
const X = 90, Z = 8, GAP = 50, LEN = 40;
const cost = await page.evaluate(async ([kinds, X, Z, GAP, LEN]) => {
  document.querySelectorAll('body > *:not(canvas)').forEach(n => { n.style.visibility = 'hidden'; });
  const { layEdge } = await import('/bench/edges-swatch.js'), d = window.__debug;
  for (const e of d.sim.enemies) { e.state = 'dead'; e.respawnIn = 1e9; e.deadFor = 99; }
  d.sim.player.hp = d.sim.player.maxHp = 99999;
  return kinds.map((kind, k) => ({ kind, ...layEdge(d.scene, kind, 1234 + k, X + (k + 1) * GAP, Z, LEN) }));
}, [kinds, X, Z, GAP, LEN]);
console.table(cost);const wait = ms => new Promise(r => setTimeout(r, ms));
async function shoot(name, k, { cam = 9, h = 3.2, at = 1.6, dx = 0, dz = -3 } = {}) {
  await page.evaluate(([k, cam, h, at, dx, dz, X, Z, GAP]) => {
    const d = window.__debug, cx = X + (k + 1) * GAP + dx;
    d.sim.player.x = cx; d.sim.player.z = Z + 4;
    d.view.debugCam = { pos: [cx, h, Z + cam], at: [cx, at, Z + dz] };
    d.step(); d.step();
  }, [k, cam, h, at, dx, dz, X, Z, GAP]);
  await wait(700);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: join(out, `${name}.png`) });
}
for (const [k, kind] of kinds.entries()) {
  await page.evaluate(() => window.__debug.view.weather.set('clear', true));
  await shoot(`${kind}-clear`, k);
  await shoot(`${kind}-close`, k, { cam: 4.5, h: 1.8, at: 1.4, dz: -3 });
  await page.evaluate(() => window.__debug.view.weather.set('rain', true));
  await wait(1200);
  await shoot(`${kind}-rain`, k);
}
await browser.close();
await server.close();



