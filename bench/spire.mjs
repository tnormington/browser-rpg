// Screenshots of the Sundered Spire's square, for judging its dressing (HOM-123).
//   node bench/spire.mjs        (needs a build: npx vite build)
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
const at = (x, y, z) => page.evaluate(([x, y, z]) => window.__debug.view.project(x, y, z), [x, y, z]);
/** Put the player at (x, z) with the camera `yaw` (0 looks north, PI south, -PI/2 east, so 3PI/2 too), health full, and let the sim and a frame settle. */
const stand = async (x, z, yaw = 0, ms = 500) => {
  await page.evaluate(([x, z, yaw]) => { const s = window.__debug.sim, p = s.player, v = window.__debug.view; s.moveTarget = null; s.interact = null; p.x = x; p.z = z; p.hp = p.maxHp; v.yaw = yaw; v.weather.set('clear', true); v.skyClock = 0; }, [x, z, yaw]); // a clear morning, so every shot is judged in the same light
  await page.waitForTimeout(ms);
};
const setLevel = level => page.evaluate(level => {
  const p = window.__debug.sim.player;
  p.combat.level = level; p.combat.xp = Math.round(100 * level ** 2.3); // the sim reads `level`
}, level);
const msg = () => page.locator('.msg').innerText();
/** Hold W for ms: the camera's forward is the way the player runs. */
const walk = async ms => { await page.keyboard.down('KeyW'); await page.waitForTimeout(ms); await page.keyboard.up('KeyW'); };
const calm = () => sim(() => { const s = window.__debug.sim; for (const e of s.enemies) { e.state = 'dead'; e.respawnIn = 1e9; e.deadFor = 99; } s.targetId = null; });
const NORTH = 0, SOUTH = Math.PI;
/** The camera yaw that looks from (px, pz) at (tx, tz): forward is (-sin yaw, -cos yaw). */
const facing = (px, pz, tx, tz) => Math.atan2(-(tx - px), -(tz - pz));

await page.goto(`${server.resolvedUrls.local[0]}?debug=1`);
await page.waitForFunction(() => window.__debug, null, { timeout: 120000 });
await page.evaluate(() => window.__debug.view.modelsReady);
await page.locator('.helpok').click({ timeout: 5000 }).catch(() => {});
await sim(() => { window.__debug.sim.player.gold = 2000; });
await calm(); // this is about the ground and the towns, not the fight
const W = await sim(() => {
  const { GATES, LANDMARKS } = window.__debug.world, n = GATES.find(g => g.id === 'cairnwaste'), v = GATES.find(g => g.id === 'vault');
  return { north: { at: n.at, mid: (n.span[0] + n.span[1]) / 2 }, vault: { at: v.at, mid: (v.span[0] + v.span[1]) / 2 }, L: LANDMARKS };
});

const sq = W.L.spireSquare, fm = W.L.forgeSpire, rc = W.L.circle;
await setLevel(40);
const views = [
  ['spire-sq-south', sq.x, sq.z + 22, NORTH],
  ['spire-sq-stump', sq.x + 9, sq.z + 12, facing(sq.x + 9, sq.z + 12, sq.x, sq.z)],
  ['spire-sq-circle', rc.x - 8, rc.z + 7, facing(rc.x - 8, rc.z + 7, rc.x, rc.z)],
  ['spire-sq-forge', fm.x + 8, fm.z + 7, facing(fm.x + 8, fm.z + 7, fm.x, fm.z)],
  ['spire-sq-across', fm.x + 4, fm.z + 4, facing(fm.x + 4, fm.z + 4, rc.x, rc.z)],
  ['spire-ruins', sq.x, sq.z - 36, NORTH],
];
for (const [name, x, z, yaw] of views) { await stand(x, z, yaw, 900); await page.screenshot({ path: join(shots, name + '.png') }); }
if (errors.length) fail(errors.join('\n'));
await browser.close(); await server.close();
