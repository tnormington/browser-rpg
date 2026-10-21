// Herbalism and alchemy in real Chromium, with real mouse clicks: click a Marrowleaf patch in Thornwick's garden and pick it, click the alembic and brew.
// Screenshots land in bench/shots/herbs-*.png.
//   node bench/herbs.mjs        (needs a build: npx vite build)
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
const fail = msg => { console.error(`FAIL: ${msg}`); process.exitCode = 1; };
const sim = (fn, arg) => page.evaluate(fn, arg);
const stand = async (x, z, yaw = 0, ms = 600) => {
  await page.evaluate(([x, z, yaw]) => { const s = window.__debug.sim, p = s.player; s.interact = null; p.x = x; p.z = z; p.hp = p.maxHp; window.__debug.view.yaw = yaw; }, [x, z, yaw]);
  await page.waitForTimeout(ms);
};
/**
 * Click the thing at (x, y, z), closing the gap to `gap` first without changing which side we are on. Since HOM-139 a
 * click only acts on what is already in reach (the thing's radius + 0.5 + 1.5), so a shot's wide framing is taken
 * first and then stepped in from.
 */
const click = async (x, y, z, gap = 2.4) => {
  await page.evaluate(([x, z, gap]) => {
    const p = window.__debug.sim.player, d = Math.hypot(p.x - x, p.z - z) || 1;
    p.x = x + ((p.x - x) / d) * gap; p.z = z + ((p.z - z) / d) * gap;
  }, [x, z, gap]);
  await page.waitForTimeout(400);
  const p = await page.evaluate(([x, y, z]) => window.__debug.view.project(x, y, z), [x, y, z]);
  await page.mouse.click(p.x, p.y);
};
const count = id => sim(id => window.__debug.sim.player.inventory.reduce((n, st) => n + (st && st.id === id ? st.qty : 0), 0), id);

await page.goto(`${server.resolvedUrls.local[0]}?debug=1`);
await page.waitForFunction(() => window.__debug, null, { timeout: 120000 });
await page.evaluate(() => window.__debug.view.modelsReady);
await page.keyboard.press('Escape'); // the help is taller than the page: its button is off screen, the key is not
await sim(() => { for (const e of window.__debug.sim.enemies) { e.state = 'dead'; e.respawnIn = 1e9; e.deadFor = 99; } });

// 1. the garden by the alembic: stand a few paces off and click the patch itself
const garden = await sim(() => window.__debug.sim.nodes.filter(n => n.type === 'marrowleaf')[0]);
await stand(garden.x - 5, garden.z + 5, -Math.PI / 4); // the patch is north-east of here: yaw -PI/4 looks that way
await page.screenshot({ path: join(shots, 'herbs-garden.png') });
await click(garden.x, 0.4, garden.z, 2.6); // a herb patch is radius 1: 2.6 is inside its reach
await page.waitForTimeout(9000);
const herb = await count('marrowleaf');
if (herb < 1) fail(`clicking a Marrowleaf patch picked nothing (bag holds ${herb})`);
await page.screenshot({ path: join(shots, 'herbs-picked.png') });

// 2. the alembic: click it, get its panel, brew
const al = await sim(() => window.__debug.world.LANDMARKS.alembic);
await sim(() => { const s = window.__debug.sim, inv = s.player.inventory, i = inv.findIndex(x => x === null); inv[i] = { id: 'vial', qty: 5 }; });
await stand(al.x - 5, al.z + 5, -Math.PI / 4);
await click(al.x, 1.5, al.z, 2.8); // the alembic is radius 1.3: 2.8 is inside its reach
await page.waitForTimeout(2500);
const open = await page.locator('.forgepanel', { hasText: 'Healing Draught' }).first().isVisible().catch(() => false);
if (!open) fail('clicking the alembic did not open its recipe list');
await page.screenshot({ path: join(shots, 'herbs-alembic-panel.png') });
await page.locator('.rbtn', { hasText: 'Make all' }).first().click().catch(() => fail('no Make button on the alembic panel'));
await page.waitForTimeout(5000);
const potions = await count('healing_draught');
if (potions < 1) fail(`brewing at the alembic made no potion (bag holds ${potions})`);
await page.screenshot({ path: join(shots, 'herbs-brewed.png') });

if (errors.length) fail(`page errors: ${errors.join(' | ')}`);
console.log(process.exitCode ? 'herbs: FAILED' : `herbs: picked ${herb} Marrowleaf, brewed ${potions} Healing Draught`);
await browser.close();
await server.close();
