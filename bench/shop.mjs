// Drives the merchant in real Chromium: walk up by clicking him, sell from the bag, buy, reload, confirm the gold persisted.
//   node bench/shop.mjs        (needs a build: npx vite build)   screenshots land in bench/shots/shop-*.png
import { preview } from 'vite';
import { launchBrowser } from './browser.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, 'bench', 'shots');
mkdirSync(shots, { recursive: true });
const server = await preview({ root, logLevel: 'error', preview: { port: 4174, open: false } });
const browser = await launchBrowser({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
const url = `${server.resolvedUrls.local[0]}?debug=1`;
const fail = msg => { console.error(`FAIL: ${msg}`); process.exitCode = 1; };
const gold = () => page.evaluate(() => window.__debug.sim.player.gold);
const count = id => page.evaluate(id => window.__debug.sim.player.inventory.reduce((n, s) => n + (s && s.id === id ? s.qty : 0), 0), id);

await page.goto(url);
await page.waitForFunction(() => window.__debug, null, { timeout: 120000 });
await page.evaluate(() => window.__debug.view.modelsReady);
await page.locator('.helpok').click({ timeout: 5000 }).catch(() => {});
await page.evaluate(() => {
  const p = window.__debug.sim.player;
  p.hp = p.maxHp = 99999;
  p.inventory[0] = { id: 'boar_hide', qty: 10 }; p.inventory[1] = { id: 'iron_sword', qty: 1 };
  p.x = -7.4; p.z = 3; // right beside the merchant at (-5, 3): since HOM-139 a click only acts on what is in reach
});
await page.waitForTimeout(300);

// click the merchant for real: project his chest to the screen
const at = await page.evaluate(() => window.__debug.view.project(-5, 1.2, 3));
await page.mouse.click(at.x, at.y);
await page.waitForSelector('.shoppanel', { state: 'visible', timeout: 8000 }).catch(() => fail('clicking the merchant did not open the shop'));
await page.waitForTimeout(400);
await page.screenshot({ path: join(shots, 'shop-open.png') });

// sell the sword (single item: no confirm), then the hides (a stack: confirm)
await page.locator('.cell[data-slot="1"]').click({ button: 'right' });
await page.locator('.mrow', { hasText: 'Sell Iron Sword' }).click();
await page.waitForTimeout(300);
if (await gold() !== 30) fail(`expected 30 gold after the sword, have ${await gold()}`);
await page.locator('.cell[data-slot="0"]').click({ button: 'right' });
await page.locator('.mrow', { hasText: 'Sell Boar Hide' }).first().click();
await page.screenshot({ path: join(shots, 'shop-confirm.png') });
await page.locator('.mrow', { hasText: 'Yes, sell them' }).click();
await page.waitForTimeout(300);
if (await gold() !== 50 || await count('boar_hide') !== 0) fail(`expected 50 gold and no hides, have ${await gold()} / ${await count('boar_hide')}`);

// buy a cap
await page.locator('.shoppanel .recipe', { hasText: 'Leather Cap' }).locator('.rbtn').click();
await page.waitForTimeout(300);
if (await gold() !== 30 || await count('leather_cap') !== 1) fail(`expected 30 gold and a cap, have ${await gold()} / ${await count('leather_cap')}`);
await page.screenshot({ path: join(shots, 'shop-bought.png') });

// walk away: the panel closes
await page.evaluate(() => { const p = window.__debug.sim.player; p.x = 5; p.z = 15; });
await page.waitForTimeout(400);
if (await page.locator('.shoppanel').isVisible()) fail('the shop stayed open after walking away');

// reload: the gold and the cap persisted
await page.evaluate(() => window.dispatchEvent(new Event('beforeunload')));
await page.reload();
await page.waitForFunction(() => window.__debug, null, { timeout: 120000 });
if (await gold() !== 30 || await count('leather_cap') !== 1) fail(`after reload expected 30 gold and a cap, have ${await gold()} / ${await count('leather_cap')}`);
await page.waitForTimeout(500);
await page.screenshot({ path: join(shots, 'shop-reloaded.png') });
if (errors.length) fail(`page errors: ${errors.join('; ')}`);
console.log(process.exitCode ? 'shop bench FAILED' : 'shop bench passed');
await browser.close();
await server.close();
