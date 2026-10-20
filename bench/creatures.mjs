// The wave-3 enemies, before the sim has them: serves the source through vite's dev server (so the page and this script share one ENEMY_TYPES),
// registers the bible's rows (docs/world-design.md 3.4) for the Fen/Thornwood kinds that have no sim entry yet, and shoots each at play distance
// and close up, with its rig's original beside it. Shots -> bench/shots/creatures/.   node bench/creatures.mjs [type ...]
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'bench', 'shots', 'creatures');
mkdirSync(out, { recursive: true });
const server = await createServer({ root, logLevel: 'error', server: { port: 4177 } });
await server.listen();
const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.error('pageerror', e.stack ?? String(e)));
page.on('console', m => { if (m.type() === 'error') console.error(m.text()); });
await page.goto('http://localhost:4177/?debug=1');
await page.waitForFunction(() => window.__debug, null, { timeout: 120000 });
await page.evaluate(() => window.__debug.view.modelsReady);
await page.locator('.helpok').click({ timeout: 3000 }).catch(() => {});

// [type, rig, scale, tint] as the bible has them; a type the sim already has is left alone
const WAVE = [
  ['fen_stalker', 'wolf', 1.0, 0x6a7a70], ['bog_witch', 'hexer', 1.1, 0x4a6a58], ['mire_troll', 'brute', 1.0, 0x4e6a48], ['bogfather', 'brute', 1.3, 0x3e5a52],
  ['mother_mire', 'brute', 1.7, 0x56604a], ['thornback', 'boar', 1.4, 0x4a4a38], ['blight_stag', 'wolf', 1.3, 0x6a5a48], ['rotwood_cultist', 'hexer', 1.0, 0x5a3a30],
  ['thorn_warden', 'brute', 1.3, 0x3e4a32], ['elder_thornback', 'boar', 2.0, 0x5a4a3a], ['shore_crab', 'boar', 0.8, 0xb8603a],
  // HOM-97: the Barrowdowns and Highmoor Moor (3.4). The dead are cold greys; the moor's living are wool and horn
  ['barrow_wight', 'hexer', 1.0, 0x5a6a78], ['grave_hound', 'wolf', 1.0, 0x8a8e90], ['cairn_brute', 'brute', 1.0, 0x7a8088], ['barrow_lord', 'brute', 1.4, 0x8a94a8],
  ['hollow_knight', 'brute', 1.5, 0xa8aeb8], ['moor_ram', 'boar', 1.5, 0xa09a8a], ['moor_raider', 'hexer', 1.0, 0x6a5a48], ['ridge_ogre', 'brute', 1.2, 0x6a5848],
  ['stonehorn', 'boar', 2.2, 0x7a7a74],
];
const want = process.argv.slice(2);
await page.evaluate(async WAVE => {
  const { ENEMY_TYPES } = await import('/src/sim/data.ts');
  const s = window.__debug.sim, base = s.enemies[0];
  for (const e of s.enemies) { e.state = 'dead'; e.respawnIn = 1e9; e.deadFor = 99; }
  s.player.hp = s.player.maxHp = 99999;
  let id = 9000;
  for (const [type, model, scale, tint] of WAVE) {
    if (!ENEMY_TYPES[type]) ENEMY_TYPES[type] = { ...ENEMY_TYPES[model === 'hexer' ? 'hexer' : model], name: type, aggroRadius: 0, look: { model, scale, tint } };
    ENEMY_TYPES[type].aggroRadius = 0;
    s.enemies.push({ ...base, id: ++id, type, x: 0, z: 0, spawnX: 0, spawnZ: 0, state: 'idle', hp: 99999, maxHp: 99999, respawnIn: 0, deadFor: 0 });
  }
}, WAVE);
await page.evaluate(() => {
  document.querySelectorAll('body > *:not(canvas)').forEach(n => { n.style.visibility = 'hidden'; }); // silhouettes, not HUD
  window.spot = { X: 70, Z: 8 }; // open road: no trees or walls in the frame
});
const wait = ms => new Promise(r => setTimeout(r, ms));
const frame = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
// park one enemy at the clearing's east edge, the player to its south looking north-east: `cam` back, `pitch` down
async function shoot(type, name, { cam = 9, pitch = 0.3, yaw = 0.7 } = {}) {
  await page.evaluate(([type, yaw, pitch, cam]) => {
    const d = window.__debug, s = d.sim, { X, Z } = window.spot;
    for (const e of s.enemies) if (e.type !== type && e.id > 9000) { e.x = e.z = 400; }
    const e = s.enemies.find(x => x.type === type && x.id > 9000);
    e.x = e.spawnX = X; e.z = e.spawnZ = Z; e.state = 'idle'; e.facing = yaw + Math.PI * 0.8;
    s.targetId = e.id;
    const p = s.player; p.x = X + Math.sin(yaw) * (cam + 6); p.z = Z + Math.cos(yaw) * (cam + 6); // behind the camera
    const h = 1.2 + pitch * 2;
    d.view.debugCam = { pos: [X + Math.sin(yaw) * cam, h + cam * pitch * 0.6, Z + Math.cos(yaw) * cam], at: [X, 1.3, Z] };
    d.step(); d.step();
  }, [type, yaw, pitch, cam]);
  await wait(900);
  await frame();
  await page.screenshot({ path: join(out, `${name}.png`) });
}for (const [type] of WAVE) {
  if (want.length && !want.includes(type)) continue;
  await shoot(type, `${type}-play`, { cam: 11, pitch: 0.35 });
  await shoot(type, `${type}-close`, { cam: 5.5, pitch: 0.25, yaw: 0.9 });
  await shoot(type, `${type}-back`, { cam: 7, pitch: 0.25, yaw: 2.6 });
}
await browser.close();
await server.close();
