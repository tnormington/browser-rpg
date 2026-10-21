// The ground itself, in every region that has one, shot steeply from above so a wide sweep of floor fills the frame:
// the one view that shows whether the floor repeats. Two framings per region: play distance, and a high wide one where a
// tiling pitch would read as a grid.
//   node bench/ground.mjs      Shots -> bench/shots/ground/ (SHOTS=<dir> to put them elsewhere).
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'bench', 'shots', process.env.SHOTS ?? 'ground');
mkdirSync(out, { recursive: true });
const server = await createServer({ root, logLevel: 'error', server: { port: 4183 } });
await server.listen();
const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.error('pageerror', e.stack ?? String(e)));
page.on('console', m => { if (m.type() === 'error') console.error(m.text()); });
await page.goto('http://localhost:4183/?debug=1&weather=clear');   // rain over the floor is noise
await page.waitForFunction(() => window.__debug, null, { timeout: 120000 });
await page.evaluate(() => window.__debug.view.modelsReady);
await page.locator('.helpok').click({ timeout: 3000 }).catch(() => {});
await page.evaluate(() => { document.querySelectorAll('body > *:not(canvas)').forEach(n => { n.style.visibility = 'hidden'; }); });

const wait = ms => new Promise(r => setTimeout(r, ms));
/** Stand at (x, z) and look at the floor from `cam` units up and back. */
async function shoot(name, x, z, { cam = 16, h = 11 } = {}) {
  await page.evaluate(([x, z, cam, h]) => {
    const d = window.__debug, p = d.sim.player;
    p.hp = p.maxHp = 99999; p.moveTarget = null; p.x = x; p.z = z;
    for (const e of d.sim.enemies) { e.state = 'dead'; e.respawnIn = 1e9; e.deadFor = 99; }
    d.view.debugCam = { pos: [x, h, z + cam], at: [x, 0, z] };
    for (let i = 0; i < 6; i++) d.step();
  }, [x, z, cam, h]);
  await wait(1200);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: join(out, `${name}.png`) });
}

// grass (Hale), road verge, beach, fen, wood litter, barrow turf, moor heath
const SPOTS = [
  ['hale', 0, 14], ['road', 436, 20], ['strand', 930, 40],
  ['fen', 875, 400], ['wood', 905, 1040], ['barrow', 1400, 1030], ['moor', 1945, 1030],
];
for (const [name, x, z] of SPOTS) {
  await shoot(`${name}-near`, x, z, { cam: 9, h: 5 });
  await shoot(`${name}-wide`, x, z, { cam: 20, h: 16 });
}
await browser.close(); await server.close();
