// HOM-87: the first mount in real Chromium. Buys it from Thornwick's stablemaster with real clicks (combat 20, 1,000 gold), mounts with the key,
// is knocked off by a bolt, and rides Thornwick's square to Saltmarrow's square holding W, on foot and mounted: the mount's whole justification is the two times.
// Screenshots land in bench/shots/ride-*.png.
//   node bench/ride.mjs        (needs a build: npx vite build)
import { preview } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, 'bench', 'shots');
mkdirSync(shots, { recursive: true });
const server = await preview({ root, logLevel: 'error', preview: { port: 4181, open: false } });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
const fail = msg => { console.error(`FAIL: ${msg}`); process.exitCode = 1; };
const sim = (fn, arg) => page.evaluate(fn, arg);
const stand = async (x, z, yaw = 0, ms = 500) => {
  await page.evaluate(([x, z, yaw]) => { const s = window.__debug.sim, p = s.player; s.moveTarget = null; s.interact = null; p.x = x; p.z = z; p.hp = p.maxHp; window.__debug.view.yaw = yaw; }, [x, z, yaw]);
  await page.waitForTimeout(ms);
};

await page.goto(`${server.resolvedUrls.local[0]}?debug=1`);
await page.waitForFunction(() => window.__debug, null, { timeout: 120000 });
await page.evaluate(() => window.__debug.view.modelsReady);
await page.locator('.helpok').click({ timeout: 5000 }).catch(() => {});
await sim(() => {
  const s = window.__debug.sim, p = s.player;
  for (const e of s.enemies) { e.state = 'dead'; e.respawnIn = 1e9; e.deadFor = 99; } // this is about the road, not the fight
  p.combat.level = 20; p.combat.xp = Math.round(100 * 20 ** 2.3); p.gold = 1000;
});
const L = await sim(() => window.__debug.world.LANDMARKS);

// 1. buy it: click the stablemaster, then Buy
await stand(L.thornStable.x + 3, L.thornStable.z + 3, Math.PI * 0.75, 700);
const screen = await sim(([x, z]) => window.__debug.view.project(x, 1.6, z), [L.thornStable.x, L.thornStable.z]);
await page.mouse.click(screen.x, screen.y);
await page.waitForTimeout(800);
await page.screenshot({ path: join(shots, 'ride-stable.png') });
await page.locator('.shoppanel').getByText('Buy', { exact: true }).click({ timeout: 3000 }).catch(() => fail('no Buy button on the stablemaster\'s panel'));
await page.waitForTimeout(300);
const bought = await sim(() => ({ mounts: [...window.__debug.sim.player.mounts], gold: window.__debug.sim.player.gold }));
if (bought.mounts.join() !== 'courser' || bought.gold !== 0) fail(`the purchase did not go through: ${JSON.stringify(bought)}`);

// 2. mount with the key: a one second cast, then up
await page.keyboard.press('Escape');
await stand(L.thornSquare.x, L.thornSquare.z, 0, 300);
await page.keyboard.press('KeyZ');
await page.waitForTimeout(500);
await page.screenshot({ path: join(shots, 'ride-casting.png') });
await page.waitForTimeout(900);
if (!(await sim(() => window.__debug.sim.player.mounted))) fail('a second after Z the player is not mounted');
await page.waitForTimeout(1200); // let the camera ease out
await page.screenshot({ path: join(shots, 'ride-mounted.png') });

// 3. an ability key dismounts (a bolt does too: mounts.test.ts)
await page.keyboard.press('Digit1');
await page.waitForTimeout(300);
if (await sim(() => window.__debug.sim.player.mounted)) fail('an ability key did not dismount');

// 4. the two times: hold W (camera north) from Thornwick's square to Saltmarrow's, counting sim ticks
const ride = async mounted => {
  await stand(L.thornSquare.x, L.thornSquare.z, 0, 300);
  await sim(() => { const p = window.__debug.sim.player; p.mounted = false; p.inCombat = false; });
  if (mounted) { await page.keyboard.press('KeyZ'); await page.waitForTimeout(1400); if (!(await sim(() => window.__debug.sim.player.mounted))) fail('did not mount for the ride'); }
  const goal = L.square.z;
  const t0 = await sim(() => window.__debug.sim.tick);
  await page.keyboard.down('KeyW');
  const r = await sim(goal => {
    const s = window.__debug.sim;
    let n = 0;
    while (s.player.z > goal && n++ < 40000) window.__debug.step();
    return { z: s.player.z, x: s.player.x, tick: s.tick, mounted: s.player.mounted, dead: s.player.dead };
  }, goal);
  await page.keyboard.up('KeyW');
  const seconds = (r.tick - t0) / 30;
  console.log(`${mounted ? 'mounted' : 'on foot '}: ${seconds.toFixed(1)} s for ${(L.thornSquare.z - L.square.z).toFixed(0)} units (arrived at x ${r.x.toFixed(1)}, z ${r.z.toFixed(1)}, ${r.mounted ? 'still mounted' : 'on foot'})`);
  return seconds;
};
const foot = await ride(false);
const horse = await ride(true);
console.log(`saved ${(foot - horse).toFixed(1)} s: ${(foot / horse).toFixed(2)}x`);
await page.screenshot({ path: join(shots, 'ride-saltmarrow.png') });

if (errors.length) fail(`page errors: ${errors.join(' | ')}`);
await browser.close();
await server.close();
