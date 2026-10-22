// HOM-171: the Echo look. A row of wolves, one authored and one Echo per band, close and at the fog far plane, dusk and rain; then the notice board at play distance.
//   node bench/echo-look.mjs        -> bench/shots/echo/*.png
// The sim has no Echo field yet, so the bench sets `echo` on the enemies the renderer reads it from.
import { createServer } from 'vite';
import { launchBrowser } from './browser.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'bench', 'shots', 'echo');
mkdirSync(out, { recursive: true });
const server = await createServer({ root, logLevel: 'error', server: { port: 5197, strictPort: false, open: false } });
await server.listen();
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.error('pageerror', e.stack ?? String(e)));
page.on('console', m => { if (m.type() === 'error') console.error(m.text()); });
await page.goto(`${server.resolvedUrls.local[0]}?debug=1`);
await page.waitForFunction(() => window.__debug, null, { timeout: 60000 });
await page.evaluate(() => window.__debug.view.modelsReady);
await page.locator('.helpok').click({ timeout: 3000 }).catch(() => {});

// five of one species lined up on clear ground in the first region that has them, standing still
const row = await page.evaluate(async () => {
  const { ENEMY_TYPES } = await import('/src/sim/data.ts');
  const d = window.__debug, s = d.sim;
  const type = s.enemies.find(e => e.type === 'wolf')?.type ?? s.enemies[0].type;
  // wolves first, then whatever else is not a boss, to make five: the dye has to read on more than one rig
  const pool = [...s.enemies.filter(e => e.type === type), ...s.enemies.filter(e => e.type !== type && ENEMY_TYPES[e.type].level < 10)].slice(0, 5);
  const cx = pool[0].spawnX, cz = pool[0].spawnZ + 60;
  for (const e of s.enemies) { if (!pool.includes(e)) { e.state = 'dead'; e.hp = 0; e.respawnIn = 1e9; e.deadFor = 99; } }
  pool.forEach((e, i) => { e.x = e.spawnX = cx + (i - 2) * 3.2; e.z = e.spawnZ = cz; e.facing = Math.PI; e.state = 'idle'; e.aggro = false; e.speed = 0; e.echo = [null, 48, 62, 76, 92][i]; });
  window.__cam = (px, py, pz, ax, ay, az) => { d.view.debugCam = { pos: [px, py, pz], at: [ax, ay, az] }; };
  window.__pace = (dist) => { const p = s.player; p.hp = p.maxHp = 99999; p.x = cx; p.z = cz + dist; };
  return { cx, cz, type };
});
console.log('row', row);
const shot = async (name) => { await page.waitForTimeout(1100); await page.screenshot({ path: join(out, `${name}.png`) }); };
const cam = (...a) => page.evaluate(a => window.__cam(...a), a);

// the player trails the camera so the actors stay inside ACTOR_RANGE; the camera is free
await page.evaluate(d => window.__pace(d), 22);
await cam(row.cx, 2.2, row.cz + 11, row.cx, 1.0, row.cz);
await shot('echo-close');
await cam(row.cx, 3.4, row.cz + 26, row.cx, 1.0, row.cz);
await shot('echo-play');
await page.evaluate(d => window.__pace(d), 60);
await cam(row.cx, 4.0, row.cz + 52, row.cx, 1.0, row.cz);
await shot('echo-52u');
await page.evaluate(d => window.__pace(d), 80);
await cam(row.cx, 4.5, row.cz + 82, row.cx, 1.0, row.cz);
await shot('echo-far');
await page.evaluate(() => window.__debug.view.weather.set('rain', true));
await cam(row.cx, 3.4, row.cz + 26, row.cx, 1.0, row.cz);
await shot('echo-rain');
await cam(row.cx, 4.5, row.cz + 82, row.cx, 1.0, row.cz);
await shot('echo-far-rain');
await page.evaluate(() => window.__debug.view.weather.set('rain', false));

// the board, at play distance
await page.evaluate(async () => {
  const { boardById } = await import('/src/sim/bounties.ts');
  const { TOWNS } = await import('/src/sim/world.ts');
  const d = window.__debug, p = d.sim.player, b = boardById('hale'), w = TOWNS.find(t => t.id === 'hale').wake;
  const a = Math.atan2(w.x - b.x, w.z - b.z);
  p.x = b.x + Math.sin(a) * 12; p.z = b.z + Math.cos(a) * 12;
  d.view.debugCam = null; d.view.yaw = a; d.view.pitch = 0.3; d.view.distance = 12;
  d.step(); d.step();
});
await shot('board-play');
await page.evaluate(() => { window.__debug.view.distance = 22; });
await shot('board-far');
await browser.close(); await server.close();
