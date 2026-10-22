// HOM-163: the notice board in Hale and the Spire, and the click that opens it. Clicks the board where the camera has it (the real pick chain), takes a bounty from the
// panel, and screenshots each step.
//   node bench/board-look.mjs        -> bench/shots/board/*.png
import { createServer } from 'vite';
import { launchBrowser } from './browser.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'bench', 'shots', 'board');
mkdirSync(out, { recursive: true });
const server = await createServer({ root, logLevel: 'error', server: { port: 5198, strictPort: false, open: false } });
await server.listen();
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.error('pageerror', e.stack ?? String(e)));
page.on('console', m => { if (m.type() === 'error') console.error(m.text()); });
await page.goto(`${server.resolvedUrls.local[0]}?debug=1`);
await page.waitForFunction(() => window.__debug, null, { timeout: 60000 });
await page.evaluate(() => window.__debug.view.modelsReady);
await page.locator('.helpok').click({ timeout: 3000 }).catch(() => {});

/** Stand a pace and a half in front of a town's board, looking at it. */
const standAt = (town) => page.evaluate(async (town) => {
  const { boardById } = await import('/src/sim/bounties.ts');
  const { TOWNS } = await import('/src/sim/world.ts');
  const d = window.__debug, p = d.sim.player, b = boardById(town), w = TOWNS.find(t => t.id === town).wake;
  for (const e of d.sim.enemies) { e.state = 'dead'; e.hp = 0; e.respawnIn = 1e9; e.deadFor = 99; }
  const a = Math.atan2(w.x - b.x, w.z - b.z); // the way the board faces
  p.x = b.x + Math.sin(a) * 2.6; p.z = b.z + Math.cos(a) * 2.6;
  d.view.debugCam = null; d.view.yaw = a; d.view.pitch = 0.18; d.view.distance = 5;
  d.step(); d.step();
  return { x: b.x, z: b.z };
}, town);
const clickBoard = async ({ x, z }) => {
  const at = await page.evaluate(([x, z]) => window.__debug.view.project(x, 1.3, z), [x, z]);
  await page.mouse.click(at.x, at.y);
};

for (const town of ['hale', 'spire']) {
  const b = await standAt(town);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(out, `${town}-board.png`) });
  await clickBoard(b);
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(out, `${town}-panel.png`) });
  const opened = await page.locator('.ptitle', { hasText: 'Notice Board' }).count();
  console.log(`${town}: panel ${opened ? 'opened by the click' : 'DID NOT OPEN'}`);
  await page.locator('.rbtn', { hasText: 'Take' }).first().click({ timeout: 3000 }).catch(() => console.log(`${town}: no Take button`));
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(out, `${town}-taken.png`) });
  console.log(`${town}: carrying`, await page.evaluate(() => window.__debug.sim.bounties.active.map(a => `${a.id} ${a.kills}/${a.goal}`)));
  await page.evaluate(() => { window.__debug.sim.bounties.active.length = 0; });
}
await browser.close(); await server.close();
