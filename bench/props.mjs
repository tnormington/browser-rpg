// The Fen and Thornwood props and the tanning rack (src/props.ts), each shot alone at the open road, and the thornoak beside Hale's pine.  node bench/props.mjs
// Shots -> bench/shots/props/.
import { createServer } from 'vite';
import { launchBrowser } from './browser.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'bench', 'shots', 'props');
mkdirSync(out, { recursive: true });
const server = await createServer({ root, logLevel: 'error', server: { port: 4179 } });
await server.listen();
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.error('pageerror', e.stack ?? String(e)));
page.on('console', m => { if (m.type() === 'error') console.error(m.text()); });
await page.goto('http://localhost:4179/?debug=1');
await page.waitForFunction(() => window.__debug, null, { timeout: 120000 });
await page.evaluate(() => window.__debug.view.modelsReady);
await page.locator('.helpok').click({ timeout: 3000 }).catch(() => {});
const X = 70, Z = 8;
await page.evaluate(async ([X, Z]) => {
  document.querySelectorAll('body > *:not(canvas)').forEach(n => { n.style.visibility = 'hidden'; });
  const d = window.__debug, { spawn, loadSlot } = await import('/src/models.ts'), pine = await loadSlot('tree');
  for (const e of d.sim.enemies) { e.state = 'dead'; e.respawnIn = 1e9; e.deadFor = 99; }
  d.sim.player.x = X; d.sim.player.z = Z + 14; d.sim.player.moveTarget = null; d.sim.player.hp = d.sim.player.maxHp = 99999;
  const put = (o, x, z) => { o.position.set(X + x, 0, Z + z); o.updateMatrix(); d.scene.add(o); return o; };
  window.shelf = {
    alembic: put(d.view.buildProp('alembic'), 0, 0), herbFen: put(d.view.buildProp('herbPatchFen'), 24, 0), herbThorn: put(d.view.buildProp('herbPatchThorn'), 48, 0),
    thornoak: put(d.view.buildProp('thornoak'), 72, 0), pine: put(spawn(pine).root, 78, 0), rack: put(d.view.buildProp('tanningRack'), 96, 0),
    bush: put(d.view.buildProp('bush'), 120, 0), bushDry: put(d.view.buildProp('bushDry'), 123, 0), torch: put(d.view.buildProp('torch'), 126, 0),
  };
  window.x = X; window.z = Z;
}, [X, Z]);
const wait = ms => new Promise(r => setTimeout(r, ms));
async function shoot(name, ox, { cam = 5, h = 1.5, at = 1.0, yaw = 0.6, dx = 0 } = {}) {
  await page.evaluate(([name, ox, cam, h, at, yaw, dx]) => {
    const d = window.__debug, X = window.x + ox + dx, Z = window.z;
    d.sim.player.x = X; d.sim.player.z = Z + 12;
    d.view.debugCam = { pos: [X + Math.sin(yaw) * cam, h, Z + Math.cos(yaw) * cam], at: [X, at, Z] };
    d.step(); d.step();
  }, [name, ox, cam, h, at, yaw, dx]);
  await wait(700);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: join(out, `${name}.png`) });
}
await shoot('alembic', 0, { cam: 5.5, h: 2.4, at: 1.5 });
await shoot('herb-fen', 24, { cam: 4, h: 1.8, at: 0.4 });
await shoot('herb-thorn', 48, { cam: 4, h: 1.8, at: 0.4 });
await shoot('thornoak-vs-pine', 72, { cam: 13, h: 4, at: 3.0, dx: 3 });
await shoot('thornoak', 72, { cam: 9, h: 3, at: 3.0 });
await shoot('tanning-rack', 96, { cam: 5.5, h: 2.2, at: 1.3, yaw: 0.5 });
await shoot('tanning-rack-play', 96, { cam: 11, h: 5.5, at: 1.0, yaw: 0.3 });
await shoot('bushes-and-torch', 123, { cam: 7, h: 2.4, at: 1.2, yaw: 0.4 });
await shoot('torch', 126, { cam: 4, h: 2, at: 1.6, yaw: 0.4 });
await browser.close(); await server.close();