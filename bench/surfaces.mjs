// Every model slot (src/models.ts) stood on the open road and shot close, so the surface maps on them can be looked at:
// the pine and its stump, the ore rocks, a boulder, the cave rock, the anvil and the smithy, and the knight himself.
//   node bench/surfaces.mjs      Shots -> bench/shots/surfaces/ (SHOTS=<dir> to put them elsewhere).
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'bench', 'shots', process.env.SHOTS ?? 'surfaces');
mkdirSync(out, { recursive: true });
const server = await createServer({ root, logLevel: 'error', server: { port: 4181 } });
await server.listen();
const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.error('pageerror', e.stack ?? String(e)));
page.on('console', m => { if (m.type() === 'error') console.error(m.text()); });
await page.goto('http://localhost:4181/?debug=1&weather=clear');   // rain over a close-up is noise
await page.waitForFunction(() => window.__debug, null, { timeout: 120000 });
await page.evaluate(() => window.__debug.view.modelsReady);
await page.locator('.helpok').click({ timeout: 3000 }).catch(() => {});

const X = 70, Z = 8, SLOTS = ['tree', 'stump', 'ironRock', 'coalRock', 'boulder', 'caveRock', 'anvil', 'forge'];
await page.evaluate(async ([X, Z, SLOTS]) => {
  document.querySelectorAll('body > *:not(canvas)').forEach(n => { n.style.visibility = 'hidden'; });
  const d = window.__debug, { spawn, loadSlot } = await import('/src/models.ts');
  for (const e of d.sim.enemies) { e.state = 'dead'; e.respawnIn = 1e9; e.deadFor = 99; }
  d.sim.player.moveTarget = null; d.sim.player.hp = d.sim.player.maxHp = 99999;
  for (let i = 0; i < SLOTS.length; i++) {
    const o = spawn(await loadSlot(SLOTS[i])).root;
    o.position.set(X + i * 14, 0, Z); o.updateMatrix(); d.scene.add(o);
  }
  // the props built from primitives, beside them: a thornoak (bark and leaf) and a bush
  for (const [id, dx] of [['thornoak', SLOTS.length * 14], ['bush', SLOTS.length * 14 + 8]]) {
    const o = d.view.buildProp(id);
    o.position.set(X + dx, 0, Z); o.updateMatrix(); d.scene.add(o);
  }
  window.x = X; window.z = Z;
}, [X, Z, SLOTS]);

const wait = ms => new Promise(r => setTimeout(r, ms));
async function shoot(name, ox, { cam = 5, h = 1.5, at = 1.0, yaw = 0.6 } = {}) {
  await page.evaluate(([ox, cam, h, at, yaw]) => {
    const d = window.__debug, X = window.x + ox, Z = window.z;
    d.sim.player.x = X; d.sim.player.z = Z + 12;
    d.view.debugCam = { pos: [X + Math.sin(yaw) * cam, h, Z + Math.cos(yaw) * cam], at: [X, at, Z] };
    d.step(); d.step();
  }, [ox, cam, h, at, yaw]);
  await wait(700);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: join(out, `${name}.png`) });
}
await shoot('pine', 0, { cam: 7, h: 3, at: 2.6 });
await shoot('pine-bole', 0, { cam: 3.2, h: 2.2, at: 1.4 });
await shoot('stump', 14, { cam: 2.2, h: 1.1, at: 0.4 });
await shoot('iron-rock', 28, { cam: 3.4, h: 1.6, at: 0.8 });
await shoot('coal-rock', 42, { cam: 3.4, h: 1.6, at: 0.8 });
await shoot('boulder', 56, { cam: 3.8, h: 1.8, at: 0.9 });
await shoot('cave-rock', 70, { cam: 7, h: 3, at: 1.6 });
await shoot('anvil', 84, { cam: 2.2, h: 1.1, at: 0.5 });
await shoot('smithy', 98, { cam: 9, h: 4, at: 2.2 });
await shoot('thornoak', 112, { cam: 9, h: 3, at: 3.0 });
await shoot('bush', 120, { cam: 2.6, h: 1.3, at: 0.6 });
// the knight: his own plate, boots and skin, from in front
await page.evaluate(() => {
  const d = window.__debug, X = window.x + 130, Z = window.z;
  d.sim.player.x = X; d.sim.player.z = Z;
  d.view.debugCam = { pos: [X + 1.4, 1.5, Z + 2.6], at: [X, 1.2, Z] };
  d.step(); d.step();
});
await wait(700);
await page.screenshot({ path: join(out, 'knight.png') });

// and the real thing at play distance: the camera the player actually has, over Hale's ore and its trees
for (const [name, type] of [['play-ore', 'iron'], ['play-tree', 'tree']]) {
  await page.evaluate(([type]) => {
    const d = window.__debug, n = d.sim.nodes.find(n => n.type === type);
    d.view.debugCam = null;
    d.sim.player.x = n.x + 2.5; d.sim.player.z = n.z + 3; d.sim.player.moveTarget = null;
    d.view.yaw = Math.PI; d.view.pitch = 0.5; d.view.distance = 9;
    d.step(); d.step();
  }, [type]);
  await wait(700);
  await page.screenshot({ path: join(out, `${name}.png`) });
}
await browser.close(); await server.close();
