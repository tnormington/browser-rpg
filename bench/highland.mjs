// The Barrowdowns' and Highmoor's ground at play distance: a barrow from the road, the grave country, Highmoor's houses and tanning racks, the heath.
// Screenshots land in bench/shots/highland-*.png.
//   node bench/highland.mjs        (needs a build: npx vite build)
import { preview } from 'vite';
import { launchBrowser } from './browser.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, 'bench', 'shots');
mkdirSync(shots, { recursive: true });
const server = await preview({ root, logLevel: 'error', preview: { port: 4178, open: false } });
const browser = await launchBrowser({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
const stand = async (x, z, yaw, ms = 700) => {
  await page.evaluate(([x, z, yaw]) => { const s = window.__debug.sim, p = s.player; s.moveTarget = null; s.interact = null; p.x = x; p.z = z; p.hp = p.maxHp; window.__debug.view.yaw = yaw; }, [x, z, yaw]);
  await page.waitForTimeout(ms);
};
const shot = name => page.screenshot({ path: join(shots, `highland-${name}.png`) });

await page.goto(`${server.resolvedUrls.local[0]}?debug=1`);
await page.waitForFunction(() => window.__debug, null, { timeout: 120000 });
await page.evaluate(() => window.__debug.view.modelsReady);
await page.locator('.helpok').click({ timeout: 5000 }).catch(() => {});
await page.evaluate(() => { const s = window.__debug.sim; for (const e of s.enemies) { e.state = 'dead'; e.respawnIn = 1e9; e.deadFor = 99; } });

const Z = 1008, N = 0, S = Math.PI, E = Math.PI / 2 * 3;
await stand(1089, Z + 8, S); await shot('barrow-mouth');                   // the stormiron stand's mound, from the road
await stand(1060, Z + 4, S); await shot('barrow-country');                 // grave country along the road
await stand(1500, Z - 10, N); await shot('barrow-country-north');
await stand(1855, Z, E); await shot('moor-approach');                      // Highmoor from the road
await stand(1892, Z + 6, 2.6); await shot('moor-racks');                   // the tanning racks off the road
await stand(1905, Z - 10, N); await shot('moor-houses');
await stand(1950, Z + 20, E); await shot('moor-heath');
if (errors.length) { console.error('FAIL: page errors', errors); process.exitCode = 1; }
await browser.close();
await server.close();
