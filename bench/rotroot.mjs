// Stands in each room of the Rotroot in real Chromium and screenshots it (the interior look: wet floor, water, wreck timbers, lights).
// Screenshots land in bench/shots/rotroot-*.png.
//   node bench/grotto.mjs        (needs a build: npx vite build)
import { preview } from 'vite';
import { launchBrowser } from './browser.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, 'bench', 'shots');
mkdirSync(shots, { recursive: true });
const server = await preview({ root, logLevel: 'error', preview: { port: 4177, open: false } });
const browser = await launchBrowser({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
const SX = 875, SZ = 1008; // Thornwick's origin: the Grotto's rooms are in its frame
const stand = async (lx, lz, yaw, ms = 700) => {
  await page.evaluate(([x, z, yaw]) => { const s = window.__debug.sim, p = s.player; s.moveTarget = null; s.interact = null; p.x = x; p.z = z; p.hp = p.maxHp = 99999; window.__debug.view.yaw = yaw; }, [SX + lx, SZ + lz, yaw]);
  await page.waitForTimeout(ms);
};

await page.goto(`${server.resolvedUrls.local[0]}?debug=1`);
await page.waitForFunction(() => window.__debug, null, { timeout: 120000 });
await page.evaluate(() => window.__debug.view.modelsReady);
await page.locator('.helpok').click({ timeout: 5000 }).catch(() => {});
await page.keyboard.press('Escape'); // the help window opens on a fresh game and covers the frame
await page.evaluate(() => { for (const e of window.__debug.sim.enemies) { if (!['rotwood_cultist', 'thorn_warden', 'rotroot_mother'].includes(e.type)) { e.state = 'dead'; e.respawnIn = 1e9; e.deadFor = 99; } } });

await stand(42.5, 62, Math.PI);
await page.screenshot({ path: join(shots, 'rotroot-door.png') });
await stand(42.5, 80, Math.PI);
await page.screenshot({ path: join(shots, 'rotroot-mouth.png') });
await stand(34, 98, Math.PI);
await page.screenshot({ path: join(shots, 'rotroot-warren.png') });
await stand(19, 114, Math.PI);
await page.screenshot({ path: join(shots, 'rotroot-heart.png') });
await stand(19, 134, 0);
await page.screenshot({ path: join(shots, 'rotroot-heart-back.png') });

if (errors.length) { console.error('page errors:', errors); process.exitCode = 1; }
await browser.close();
await server.close();
