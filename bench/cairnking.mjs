// The Cairn King and his Falling Stone, looked at: the King at play distance, close and from the side, and the stone's mark at four points of its wind-up (the cast is pinned at each, so the
// picture is the frame a player would see), and the Crown Slam beside it. Screenshots land in bench/shots/cairnking/.
//   node bench/cairnking.mjs        (needs a build: npx vite build)
import { preview } from 'vite';
import { launchBrowser } from './browser.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, 'bench', 'shots', 'cairnking');
mkdirSync(shots, { recursive: true });
const server = await preview({ root, logLevel: 'error', preview: { port: 4179, open: false } });
const browser = await launchBrowser({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
const shot = name => page.screenshot({ path: join(shots, `${name}.png`) });

await page.goto(`${server.resolvedUrls.local[0]}?debug=1`);
await page.waitForFunction(() => window.__debug, null, { timeout: 120000 });
await page.evaluate(() => window.__debug.view.modelsReady);
await page.locator('.helpok').click({ timeout: 5000 }).catch(() => {});
const king = await page.evaluate(() => { const k = window.__debug.sim.enemies.find(e => e.type === 'cairn_king'); return { x: k.spawnX, z: k.spawnZ }; });
/** Player at (dx, dz) off the King, facing him; the King awake and holding still (no cast, no swing). */
const stand = async (dx, dz, ms = 900) => {
  await page.evaluate(([king, dx, dz]) => {
    const s = window.__debug.sim, p = s.player, k = s.enemies.find(e => e.type === 'cairn_king');
    for (const e of s.enemies) if (e !== k) { e.state = 'dead'; e.respawnIn = 1e9; e.deadFor = 99; }
    s.moveTarget = null; s.interact = null; p.maxHp = p.hp = 99999;
    p.x = king.x + dx; p.z = king.z + dz;
    Object.assign(k, { state: 'idle', hp: k.maxHp, x: k.spawnX, z: k.spawnZ, respawnIn: 0, deadFor: 0, cast: null, heavyCd: 1e9, hazardCd: 1e9, attackCd: 1e9 });
    window.__debug.view.yaw = Math.atan2(dx, dz);
  }, [king, dx, dz]);
  await page.waitForTimeout(ms);
};
/** Pin the King's cast at `wind` of its wind-up: a ground one on the spot the player stands, or a heavy under him. */
const pin = async (kind, wind) => {
  await page.evaluate(([kind, wind]) => {
    const s = window.__debug.sim, p = s.player, k = s.enemies.find(e => e.type === 'cairn_king');
    k.cast = kind === 'ground' ? { kind, t: wind * 1000, total: 1000, x: p.x, z: p.z, radius: 3.5 } : { kind, t: wind * 1000, total: 1000 };
  }, [kind, wind]);
  await page.waitForTimeout(120);
};
await stand(0, 9); await shot('king-play');
await stand(0, 5.5); await shot('king-close');
await stand(5, 6); await shot('king-side');
await stand(0, 10);
for (const w of [0.15, 0.5, 0.8, 0.97]) { await pin('ground', w); await shot(`stone-${Math.round(w * 100)}`); }
await pin('heavy', 0.7); await shot('slam');
// the three rooms, walked into from the south: nothing awake, so the picture is the rooms
for (const [name, x, z] of [['stair', -28, -88], ['ossuary', -30, -97], ['chamber', -28, -122]]) {
  await page.evaluate(([x, z]) => {
    const s = window.__debug.sim, p = s.player;
    for (const e of s.enemies) { e.state = 'dead'; e.respawnIn = 1e9; e.deadFor = 99; }
    p.x = 1910 + x; p.z = 1008 + z; window.__debug.view.yaw = 0;
  }, [x, z]);
  await page.waitForTimeout(900); await shot(`room-${name}`);
}
if (errors.length) { console.error(`page errors: ${errors.join('; ')}`); process.exitCode = 1; }
console.log(process.exitCode ? 'cairnking bench FAILED' : 'cairnking shots written');
await browser.close();
await server.close();
