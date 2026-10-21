// Drives Saltmarrow in real Chromium, with real mouse clicks: the harbourmaster's dialogue and the third quest, the chandler's shop,
// a click-to-move across the gate, and an adamant vein. Screenshots land in bench/shots/salt-*.png.
//   node bench/saltmarrow.mjs        (needs a build: npx vite build)
import { preview } from 'vite';
import { launchBrowser } from './browser.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, 'bench', 'shots');
mkdirSync(shots, { recursive: true });
const server = await preview({ root, logLevel: 'error', preview: { port: 4175, open: false } });
const browser = await launchBrowser({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
const fail = msg => { console.error(`FAIL: ${msg}`); process.exitCode = 1; };
const sim = fn => page.evaluate(fn);
const at = (x, y, z) => page.evaluate(([x, y, z]) => window.__debug.view.project(x, y, z), [x, y, z]);
/** Stand `dz` south of a spot (the default camera looks north, so it is in front of us), let the sim and a frame settle. */
const standSouthOf = async (x, z, dz = 9) => {
  await page.evaluate(([x, z]) => { const s = window.__debug.sim, p = s.player; s.moveTarget = null; s.interact = null; p.x = x; p.z = z; p.hp = p.maxHp = 99999; window.__debug.view.yaw = 0; }, [x, z + dz]);
  await page.waitForTimeout(400);
};

await page.goto(`${server.resolvedUrls.local[0]}?debug=1`);
await page.waitForFunction(() => window.__debug, null, { timeout: 120000 });
await page.evaluate(() => window.__debug.view.modelsReady);
await page.locator('.helpok').click({ timeout: 5000 }).catch(() => {});
await sim(() => {
  const s = window.__debug.sim, p = s.player;
  for (const e of s.enemies) { e.state = 'dead'; e.respawnIn = 1e9; e.deadFor = 99; } // this is about the town, not the fight
  s.quest.stage = 'done'; s.quest.second = 'cleared'; s.quest.third = 'offer'; // the Hollow is quiet: the road is open
  p.gold = 1000;
  p.skills.mining.xp = 2000; p.skills.mining.level = 17; // the sim reads `level`, so both are set
});

// 1. click-to-move across the gate: click the ground on the far side of Hale's east wall
await sim(() => { const p = window.__debug.sim.player; p.x = 24; p.z = 8; window.__debug.view.yaw = -Math.PI / 2; }); // camera west of the player, looking east
await page.waitForTimeout(400);
const ground = await at(60, 0, 8);
await page.mouse.click(ground.x, ground.y);
await page.waitForTimeout(3200);
const x1 = await sim(() => window.__debug.sim.player.x);
if (x1 < 36) fail(`a click on the road beyond the gate walked the player to x = ${x1.toFixed(1)}, not through it`);
await page.screenshot({ path: join(shots, 'salt-gate-walk.png') });

// 2. the harbourmaster
await standSouthOf(886, 12);
const pell = await at(886, 1.2, 12);
await page.screenshot({ path: join(shots, 'salt-town.png') });
await page.mouse.click(pell.x, pell.y);
await page.waitForSelector('.dialogue', { state: 'visible', timeout: 8000 }).catch(() => fail('clicking the harbourmaster did not open a dialogue'));
await page.waitForTimeout(400);
const title = await page.locator('.dialogue .ptitle').innerText().catch(() => '');
if (!title.includes('Harbourmaster Pell')) fail(`the dialogue is headed "${title}", not the harbourmaster's name`);
await page.screenshot({ path: join(shots, 'salt-dialogue.png') });
await page.locator('.dopt', { hasText: "I'll open the road" }).click();
await page.waitForTimeout(300);
const third = await sim(() => window.__debug.sim.quest.third);
if (third !== 'hunt') fail(`accepting left the third quest at "${third}"`);
await page.locator('.dopt', { hasText: 'Okay' }).click();
await page.waitForTimeout(300);
const tracker = await page.locator('.tracker .qtitle').innerText();
if (!tracker.includes('The Salt Road')) fail(`the tracker reads "${tracker}"`);
await page.screenshot({ path: join(shots, 'salt-quest.png') });

// 3. the chandler
await standSouthOf(876, 14);
const tam = await at(876, 1.2, 14);
await page.mouse.click(tam.x, tam.y);
await page.waitForSelector('.shoppanel', { state: 'visible', timeout: 8000 }).catch(() => fail('clicking the chandler did not open the shop'));
await page.waitForTimeout(400);
const shopTitle = await page.locator('.shoppanel .ptitle').innerText();
if (!shopTitle.includes('Tam Brine')) fail(`the shop is headed "${shopTitle}"`);
if (await page.locator('.shoppanel .recipe', { hasText: 'Rusty Blade' }).count() !== 0) fail('the chandler lists Hale\'s rusty blade');
await page.screenshot({ path: join(shots, 'salt-shop.png') });
await page.locator('.shoppanel .recipe', { hasText: 'Steel Sword' }).locator('.rbtn').click();
await page.waitForTimeout(300);
const bought = await sim(() => window.__debug.sim.player.inventory.some(s => s && s.id === 'steel_sword'));
if (!bought) fail('buying a steel sword from the chandler did not put one in the bag');
await sim(() => { const p = window.__debug.sim.player; p.x = 876; p.z = 40; }); // walk off: the panel closes
await page.waitForTimeout(500);
if (await page.locator('.shoppanel').isVisible()) fail('the chandler\'s shop stayed open after walking away');

// 4. an adamant vein in the cliffs
await standSouthOf(892, -56, 8);
const vein = await at(892, 1, -56);
await page.screenshot({ path: join(shots, 'salt-cliffs.png') });
await page.mouse.click(vein.x, vein.y);
await page.waitForTimeout(9000);
const ore = await sim(() => window.__debug.sim.player.inventory.reduce((n, s) => n + (s && s.id === 'adamant_ore' ? s.qty : 0), 0));
if (ore < 1) fail('clicking an adamant vein with Mining 17 did not yield ore');
await page.screenshot({ path: join(shots, 'salt-vein.png') });

// 5. the quay
await sim(() => { const s = window.__debug.sim, p = s.player; s.moveTarget = null; s.interact = null; p.x = 930; p.z = 8; window.__debug.view.yaw = -Math.PI / 2; });
await page.waitForTimeout(500);
await page.screenshot({ path: join(shots, 'salt-quay.png') });

if (errors.length) fail(`page errors: ${errors.join('; ')}`);
console.log(process.exitCode ? 'saltmarrow bench FAILED' : 'saltmarrow bench passed');
await browser.close();
await server.close();
