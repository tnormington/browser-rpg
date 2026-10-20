// HUD screenshots: the same scenes at the largest and smallest window the game is played at, so a restyle can be looked at, not just reasoned about.
//   node bench/hud-shots.mjs [tag]       (needs a build: npx vite build)   -> bench/shots/hud/<tag>/<WxH>-<scene>.png
import { preview } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tag = process.argv[2] ?? 'now';
const out = join(root, 'bench', 'shots', 'hud', tag);
mkdirSync(out, { recursive: true });
const SIZES = [[1600, 900], [800, 560]];
const server = await preview({ root, logLevel: 'error', preview: { port: 4177, open: false } });
const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--use-angle=d3d11'] });

for (const [width, height] of SIZES) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', e => console.error('pageerror', e.stack ?? String(e)));
  await page.goto(`${server.resolvedUrls.local[0]}?debug=1`);
  await page.waitForFunction(() => window.__debug, null, { timeout: 60000 });
  await page.evaluate(() => window.__debug.view.modelsReady);
  const shot = async name => { await page.waitForTimeout(450); await page.screenshot({ path: join(out, `${width}x${height}-${name}.png`) }); console.log('  ' + width + 'x' + height + ' ' + name); };
  const key = code => page.evaluate(c => dispatchEvent(new KeyboardEvent('keydown', { code: c })), code);
  const closeAll = async () => { await key('Escape'); await page.waitForTimeout(80); await key('Escape'); await page.waitForTimeout(80); };

  await shot('0-help');
  await page.locator('.helpok').click({ timeout: 3000 }).catch(() => {});

  // default view: a fresh start in the Clearing, quest tracker up
  await page.evaluate(() => { const p = window.__debug.sim.player; p.x = 5.5; p.z = 2; p.hp = p.maxHp; p.inventory[0] = { id: 'iron_bar', qty: 8 }; p.inventory[1] = { id: 'iron_sword', qty: 1 }; p.inventory[2] = { id: 'logs', qty: 9 }; p.gold = 137; window.__debug.step(); });
  await shot('1-default');

  // combat: a target in front of you, auto-attack on, the bar half spent
  await page.evaluate(() => {
    const d = window.__debug, s = d.sim, p = s.player, e = s.enemies.find(x => x.state !== 'dead');
    p.x = e.x + 4; p.z = e.z; d.view.yaw = Math.PI / 2; p.hp = Math.round(p.maxHp * 0.7); p.energy = p.maxEnergy * 0.45;
    s.targetId = e.id; p.autoAttack = true; e.hp = Math.round(e.maxHp * 0.6);
    d.step(); d.step();
  });
  await shot('2-combat');
  // the rest of the scenes are about panels, not survival: the world's enemies are pinned dead so the walk to the merchant is safe
  await page.evaluate(() => { const s = window.__debug.sim; s.targetId = null; s.player.autoAttack = false; for (const o of s.enemies) { o.state = 'dead'; o.respawnIn = 1e9; o.deadFor = 99; o.cast = null; } });

  // panels
  await key('KeyI'); await key('KeyC'); await shot('3-bag-sheet'); await closeAll();
  await key('KeyN'); await shot('4-talents'); await closeAll();
  await key('KeyP'); await shot('5-spellbook'); await closeAll();
  await key('KeyK'); await shot('6-skills'); await closeAll();
  await page.evaluate(() => { const d = window.__debug, p = d.sim.player, f = d.world.LANDMARKS.forge; p.x = f.x - 3; p.z = f.z; d.step(); d.step(); d.sim.interact = { k: 'forge' }; });
  await shot('7-forge'); await closeAll();
  await page.evaluate(() => { const d = window.__debug; d.sim.player.x = -10; d.sim.player.z = 3; d.step(); });
  const at = await page.evaluate(() => window.__debug.view.project(-5, 1.2, 3));
  await page.mouse.click(at.x, at.y);
  await page.waitForSelector('.shoppanel', { state: 'visible', timeout: 6000 }).catch(() => console.error('shop did not open'));
  await key('KeyI');
  await page.waitForTimeout(300);
  await page.locator('.cell[data-slot="1"]').click({ button: 'right' }).catch(() => {});
  await shot('8-shop-ctxmenu'); await closeAll();
  await page.evaluate(() => { const d = window.__debug; d.sim.quest.stage = 'forge'; d.sim.player.x = 5.5; d.sim.player.z = 2; d.step(); d.step(); });
  await key('KeyV'); await shot('9-dialogue'); await closeAll();
  // the worst case the HUD holds at once (HOM-108): the tallest tracker, a full log, both unit frames with the player's buffs and the food wait up
  await page.evaluate(() => {
    const d = window.__debug, s = d.sim, p = s.player;
    p.buffs = [{ id: 'well_fed', left: 600 }, { id: 'guard', left: 3 }]; p.foodCd = 30; s.targetId = s.enemies[0].id;
    const log = document.querySelector('.msglog');
    for (let i = 0; i < 12; i++) { const l = document.createElement('div'); l.className = 'logline log-quest'; l.textContent = 'Cairnwarden Ysolt: "The Cairn Hold is not for anyone under combat level 29. What sleeps in it has waited this long."'; log.append(l); }
    log.scrollTop = log.scrollHeight; d.step();
  });
  await shot('10-worst-case');
  await page.close();
}
await browser.close(); await server.close();
