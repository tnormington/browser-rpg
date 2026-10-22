// How the world looks from where it is played (HOM-149): one frame per region at the player's own camera, plus a flat
// long view across open ground and one in the cave. The view that answers "is it bright enough, and how far does the eye
// carry"; bench/ground.mjs is the same spots shot steeply down at the floor instead.
//   node bench/world-look.mjs      Shots -> bench/shots/world-look/ (SHOTS=<dir> to put a before/after pair elsewhere).
import { createServer } from 'vite';
import { launchBrowser } from './browser.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'bench', 'shots', process.env.SHOTS ?? 'world-look');
mkdirSync(out, { recursive: true });
const server = await createServer({ root, logLevel: 'error', server: { port: 4187 } });
await server.listen();
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.error('pageerror', e.stack ?? String(e)));
page.on('console', m => { if (m.type() === 'error') console.error(m.text()); });
await page.goto('http://localhost:4187/?debug=1&weather=clear');
await page.waitForFunction(() => window.__debug, null, { timeout: 120000 });
await page.evaluate(() => window.__debug.view.modelsReady);
await page.locator('.helpok').click({ timeout: 3000 }).catch(() => {});
await page.evaluate(() => { document.querySelectorAll('body > *:not(canvas)').forEach(n => { n.style.visibility = 'hidden'; }); });

const wait = ms => new Promise(r => setTimeout(r, ms));
/** Stand at (x, z) and look out of the player's own orbit camera. */
async function shoot(name, x, z, yaw = 0, pitch = 0.22, dist = 10) {
  await page.evaluate(([x, z, yaw, pitch, dist]) => {
    const d = window.__debug, p = d.sim.player;
    p.hp = p.maxHp = 99999; p.x = x; p.z = z;
    d.view.debugCam = null; d.view.yaw = yaw; d.view.pitch = pitch; d.view.distance = dist;
    for (let i = 0; i < 6; i++) d.step();
  }, [x, z, yaw, pitch, dist]);
  await wait(1400);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: join(out, `${name}.png`) });
}

const SPOTS = [
  ['hale', 0, 14, 0, 0.18],
  ['hale-long', 0, 40, 0, 0.10],          // flat look across open ground: how far the eye carries
  ['road', 436, 20, 1.57, 0.12],
  ['strand', 930, 40, 0, 0.18],
  ['fen', 875, 400, 0, 0.16],
  ['wood', 905, 1040, 0, 0.18],
  ['barrow', 1400, 1030, 0, 0.14],
  ['moor', 1945, 1030, 0, 0.14],
  ['waste', 1980, 485, 0, 0.14],
  ['spire', 1980, 44, 0, 0.18],
  ['cave', -26, -47, -0.8, 0.4, 7],
];
for (const [name, x, z, yaw, pitch, dist] of SPOTS) await shoot(name, x, z, yaw, pitch, dist);
await browser.close(); await server.close();
