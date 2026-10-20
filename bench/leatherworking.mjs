// Leatherworking and Highmoor's stable in real Chromium, with real mouse clicks: click the tanning rack, tan hides, make boots, wear them, then try to buy
// the second horse short of its gold and short of its total level (nothing is bought), and finally with both.
// Screenshots land in bench/shots/leather-*.png.
//   node bench/leatherworking.mjs        (needs a build: npx vite build)
import { preview } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, 'bench', 'shots');
mkdirSync(shots, { recursive: true });
const server = await preview({ root, logLevel: 'error', preview: { port: 4178, open: false } });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
const fail = msg => { console.error(`FAIL: ${msg}`); process.exitCode = 1; };
const sim = (fn, arg) => page.evaluate(fn, arg);
const stand = async (x, z, yaw = 0, ms = 700) => {
  await page.evaluate(([x, z, yaw]) => { const s = window.__debug.sim, p = s.player; s.moveTarget = null; s.interact = null; p.x = x; p.z = z; p.hp = p.maxHp; window.__debug.view.yaw = yaw; }, [x, z, yaw]);
  await page.waitForTimeout(ms);
};
const click = async (x, y, z) => {
  const p = await page.evaluate(([x, y, z]) => window.__debug.view.project(x, y, z), [x, y, z]);
  await page.mouse.click(p.x, p.y);
};
const count = id => sim(id => window.__debug.sim.player.inventory.reduce((n, st) => n + (st && st.id === id ? st.qty : 0), 0), id);
const state = () => sim(() => { const p = window.__debug.sim.player; return { gold: p.gold, mounts: [...p.mounts], feet: p.equipment.feet, armor: p.stats.armor, lw: p.skills.leatherworking.level }; });

await page.goto(`${server.resolvedUrls.local[0]}?debug=1`);
await page.waitForFunction(() => window.__debug, null, { timeout: 120000 });
await page.evaluate(() => window.__debug.view.modelsReady);
await page.keyboard.press('Escape');
await sim(() => { for (const e of window.__debug.sim.enemies) { e.state = 'dead'; e.respawnIn = 1e9; e.deadFor = 99; } });
const L = await sim(() => window.__debug.world.LANDMARKS);

// 1. the rack: stand a few paces off, click it, tan five boar hides (the first two levels), make a pair of boots
await sim(() => { const inv = window.__debug.sim.player.inventory; inv[0] = { id: 'boar_hide', qty: 5 }; });
await stand(L.rack.x - 4, L.rack.z + 5, -Math.PI / 2.4);
await page.screenshot({ path: join(shots, 'leather-rack.png') });
await click(L.rack.x, 1.4, L.rack.z);
await page.waitForTimeout(2500);
if (!await page.locator('.forgepanel', { hasText: 'Tan Boar Hide' }).first().isVisible().catch(() => false)) fail('clicking the tanning rack did not open its recipe list');
await page.screenshot({ path: join(shots, 'leather-panel.png') });
await page.locator('.recipe', { hasText: 'Tan Boar Hide' }).locator('.rbtn', { hasText: 'Make all' }).first().click().catch(() => fail('no Make all on the Tan Boar Hide row'));
await page.waitForTimeout(18000);
const tanned = await count('tanned_hide');
if (tanned < 5 || await count('boar_hide') !== 0) fail(`tanning five hides left ${tanned} tanned and ${await count('boar_hide')} raw`);
await page.locator('.recipe', { hasText: 'Hide Boots' }).locator('.rbtn', { hasText: /^Make$/ }).first().click().catch(() => fail('no Make on the Hide Boots row'));
await page.waitForTimeout(8500);
if (await count('hide_boots') !== 1) fail(`the boots were not made (bag holds ${await count('hide_boots')}, tanned hide ${await count('tanned_hide')})`);
await page.screenshot({ path: join(shots, 'leather-made.png') });

// 2. wear them: open the bag and click the pair
await page.keyboard.press('Escape');
await page.keyboard.press('KeyI');
await page.waitForTimeout(400);
const slot = await sim(() => window.__debug.sim.player.inventory.findIndex(st => st && st.id === 'hide_boots'));
await page.locator(`[data-slot="${slot}"]`).first().click().catch(() => fail('the boots are not in the bag panel'));
await page.waitForTimeout(500);
const worn = await state();
if (worn.feet !== 'hide_boots' || worn.armor !== 3) fail(`clicking the boots did not wear them (feet ${worn.feet}, armour ${worn.armor})`);
await page.keyboard.press('KeyC');
await page.waitForTimeout(400);
await page.screenshot({ path: join(shots, 'leather-worn.png') });
await page.keyboard.press('Escape');

// 3. the stable: 2,999 gold and a total level that is enough buys nothing; 3,000 gold and a total of 284 buys nothing; both buys the horse
const stable = L.highStable;
const open = async () => {
  await stand(stable.x + 4, stable.z + 4, Math.PI / 4);
  await click(stable.x, 1.2, stable.z);
  await page.waitForSelector('.shoppanel', { state: 'visible', timeout: 8000 }).catch(() => fail('clicking the stablemaster did not open the stable'));
  await page.waitForTimeout(500);
};
const buy = async () => { await page.locator('.recipe', { hasText: 'Highmoor Destrier' }).locator('.rbtn').first().click({ force: true }).catch(() => fail('no Buy on the Destrier row')); await page.waitForTimeout(500); };
const setTotal = n => sim(n => { const p = window.__debug.sim.player; for (const id of Object.keys(p.skills)) { p.skills[id].level = 1; } p.skills.combat.level = n - (Object.keys(p.skills).length - 1); }, n);
await sim(() => { window.__debug.sim.player.gold = 2999; });
await setTotal(285);
await open();
await page.screenshot({ path: join(shots, 'leather-stable-poor.png') });
await buy();
let st = await state();
if (st.mounts.length || st.gold !== 2999) fail(`2,999 gold bought something: ${JSON.stringify(st)}`);
await sim(() => { window.__debug.sim.player.gold = 5000; });
await setTotal(284);
await page.waitForTimeout(400);
await page.screenshot({ path: join(shots, 'leather-stable-low.png') });
await buy();
st = await state();
if (st.mounts.length || st.gold !== 5000) fail(`a total level of 284 bought something: ${JSON.stringify(st)}`);
await setTotal(285);
await sim(() => { window.__debug.sim.player.gold = 3000; });
await page.waitForTimeout(400);
await page.screenshot({ path: join(shots, 'leather-stable-ready.png') });
await buy();
st = await state();
if (st.mounts.join() !== 'destrier' || st.gold !== 0) fail(`3,000 gold at total level 285 did not buy the horse: ${JSON.stringify(st)}`);
await page.keyboard.press('Escape');
await sim(() => { const p = window.__debug.sim.player; p.mounted = true; });
await stand(stable.x + 8, stable.z + 8, 0.6, 1500);
await page.screenshot({ path: join(shots, 'leather-destrier.png') });

if (errors.length) fail(`page errors: ${errors.join(' | ')}`);
console.log(process.exitCode ? 'leatherworking: FAILED' : `leatherworking: tanned ${tanned} hides, made and wore Hide Boots (armour ${worn.armor}); the Destrier was refused at 2,999 gold and at total level 249, and bought at both`);
await browser.close();
await server.close();
