// Readability moments: combat w/ target + damage numbers, forge, ore node, NPC quest marker, plus the default view.
//   node bench/moments.mjs <outdir-name>   -> bench/shots/<name>/*.png
import { build, preview } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const name = process.argv[2] || 'moments';
const out = join(root, 'bench', 'shots', name); mkdirSync(out, { recursive: true });
if (!process.argv.includes('--skip-build')) await build({ root, logLevel: 'warn' });
const server = await preview({ root, logLevel: 'error', preview: { port: 4174, open: false } });
const browser = await chromium.launch({ headless: true, args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.error('pageerror', e));
await page.goto(`${server.resolvedUrls.local[0]}?debug=1`);
await page.waitForFunction(() => window.__debug);
await page.locator('.helpok').click({ timeout: 5000 }).catch(() => {});
const frames = n => page.evaluate(n => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const place = (x, z, yaw, pitch, dist) => page.evaluate(([x, z, yaw, pitch, dist]) => {
  const d = window.__debug, p = d.sim.player; p.x = x; p.z = z; d.step(); d.step();
  d.view.yaw = yaw; d.view.pitch = pitch; d.view.distance = dist;
}, [x, z, yaw, pitch, dist]);
const shot = async n => { await frames(20); await page.screenshot({ path: join(out, `${n}.png`) }); };
const nodes = await page.evaluate(() => window.__debug.sim.nodes.map(n => ({ id: n.id, type: n.type, x: n.x, z: n.z })));
const ore = nodes.find(n => n.type !== 'tree' && n.type !== 'coal') || nodes.find(n => n.type !== 'tree');
const tree = nodes.find(n => n.type === 'tree');

await shot('default');
await place(5, 8, 0.2, 0.35, 9); await shot('npc');
await place(14, -2, -0.9, 0.3, 8); await shot('forge');
await place(ore.x + 5, ore.z + 6, 0.7, 0.4, 10); await shot('ore');
await place(tree.x + 6, tree.z + 8, 0.6, 0.4, 12); await shot('tree');
// combat: stand beside a boar, tab-target, mash abilities, shoot while damage numbers are up
await place(-13, 0, 0.3, 0.45, 9);
await page.keyboard.press('Tab');
for (let i = 0; i < 6; i++) { await page.keyboard.press(String(1 + (i % 3))); await page.waitForTimeout(450); }
await shot('combat');
await browser.close(); await server.close();
console.error('wrote', out, JSON.stringify({ ore, tree }));
