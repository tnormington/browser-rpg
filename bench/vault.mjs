// The Sundered Vault, Archmage Vael and the rune circle, looked at (HOM-112): the three rooms walked into from the stair, Vael at the length of the room and close, his Rune Storm's mark at four
// points of its wind-up and the Sundering Nova (the cast is pinned at each, so the picture is the frame a player would see), the sanctum's warded floor, the rune circle in the Spire, and the
// enchanting panel. The ground marks are the point: the last dungeon is where a floor stacked above them would hide a boss's tells. Screenshots land in bench/shots/vault/.
//   node bench/vault.mjs        (needs a build: npx vite build)
import { preview } from 'vite';
import { launchBrowser } from './browser.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, 'bench', 'shots', 'vault');
mkdirSync(shots, { recursive: true });
const server = await preview({ root, logLevel: 'error', preview: { port: 4181, open: false } });
const browser = await launchBrowser({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
const shot = name => page.screenshot({ path: join(shots, `${name}.png`) });

await page.goto(`${server.resolvedUrls.local[0]}?debug=1`);
await page.waitForFunction(() => window.__debug, null, { timeout: 120000 });
await page.evaluate(() => window.__debug.view.modelsReady);
await page.locator('.helpok').click({ timeout: 5000 }).catch(() => {});
const vael = await page.evaluate(() => { const k = window.__debug.sim.enemies.find(e => e.type === 'archmage_vael'); return { x: k.spawnX, z: k.spawnZ }; });

/** Player at (dx, dz) off Vael, facing him; Vael awake and holding still (no cast, no swing). */
const stand = async (dx, dz, { dist = 12, pitch = 0.5, ms = 900 } = {}) => {
  await page.evaluate(([vael, dx, dz, dist, pitch]) => {
    const d = window.__debug, s = d.sim, p = s.player, k = s.enemies.find(e => e.type === 'archmage_vael');
    for (const e of s.enemies) if (e !== k) { e.state = 'dead'; e.respawnIn = 1e9; e.deadFor = 99; }
    s.moveTarget = null; s.interact = null; p.maxHp = p.hp = 99999;
    p.x = vael.x + dx; p.z = vael.z + dz;
    Object.assign(k, { state: 'idle', hp: k.maxHp, x: k.spawnX, z: k.spawnZ, respawnIn: 0, deadFor: 0, cast: null, heavyCd: 1e9, hazardCd: 1e9, attackCd: 1e9 });
    d.view.yaw = Math.atan2(dx, dz); d.view.pitch = pitch; d.view.distance = dist;
  }, [vael, dx, dz, dist, pitch]);
  await page.waitForTimeout(ms);
};
/** Pin Vael's cast at `wind` of its wind-up: a ground one on the spot the player stands, or the nova under him. */
const pin = async (kind, wind) => {
  await page.evaluate(([kind, wind]) => {
    const s = window.__debug.sim, p = s.player, k = s.enemies.find(e => e.type === 'archmage_vael');
    k.cast = kind === 'ground' ? { kind, t: wind * 1000, total: 1000, x: p.x, z: p.z, radius: 3.5 } : { kind, t: wind * 1000, total: 1000 };
  }, [kind, wind]);
  await page.waitForTimeout(120);
};
await stand(0, 16, { dist: 17 }); await shot('vael-range');
await stand(0, 7, { dist: 9 }); await shot('vael-play');
await stand(4, 5, { dist: 7 }); await shot('vael-close');
await stand(0, 10, { dist: 12 });
for (const w of [0.15, 0.5, 0.8, 0.97]) { await pin('ground', w); await shot(`storm-${Math.round(w * 100)}`); }
await stand(0, 5, { dist: 9 });
await pin('bolt', 0.6); await shot('barrage');
await pin('heavy', 0.7); await shot('nova');
// a ground mark on the floor of each of the other rooms, to be sure none of the stack buries it (the tintedFloor class of bug)
for (const [name, x, z] of [['stair', 0, -92], ['archive', -16, -112], ['sanctum-door', 0, -128], ['sanctum-ward', 8, -131]]) {
  await page.evaluate(([x, z]) => {
    const d = window.__debug, s = d.sim, p = s.player, k = s.enemies.find(e => e.type === 'archmage_vael');
    for (const e of s.enemies) { e.state = 'dead'; e.respawnIn = 1e9; e.deadFor = 99; }
    p.hp = p.maxHp = 99999; p.x = 1980 + x; p.z = 8 + z; d.view.yaw = Math.PI; d.view.pitch = 0.55; d.view.distance = 13;
    k.state = 'dead'; k.cast = null;
  }, [x, z]);
  await page.waitForTimeout(900); await shot(`room-${name}`);
}
// the dressing, looked at from where a player stands in each room (HOM-132): the stair's arches, the archive's shelves and lectern, the sanctum's collars and sigils
for (const [name, x, z, yaw, dist, pitch] of [['dress-stair', 0, -88, 0, 9, 0.4], ['dress-stair-top', 0, -90, 0, 18, 1.3], ['dress-archive', -16, -106, 0, 9, 0.4], ['dress-archive-shelves', -22, -118, Math.PI, 9, 0.35], ['dress-sanctum', 16, -131, 0, 10, 0.4], ['dress-sanctum-stones', 8, -142, Math.PI / 2, 10, 0.4]]) {
  await page.evaluate(([x, z, yaw, dist, pitch]) => {
    const d = window.__debug, s = d.sim, p = s.player;
    for (const e of s.enemies) { e.state = 'dead'; e.respawnIn = 1e9; e.deadFor = 99; }
    p.hp = p.maxHp = 99999; p.x = 1980 + x; p.z = 8 + z; d.view.yaw = yaw; d.view.pitch = pitch; d.view.distance = dist;
  }, [x, z, yaw, dist, pitch]);
  await page.waitForTimeout(900); await shot(name);
}
// the stair from the corridor, the way a player walks in
await page.evaluate(() => {
  const d = window.__debug, s = d.sim, p = s.player;
  p.x = 1980; p.z = 8 - 74; d.view.yaw = 0; d.view.pitch = 0.4; d.view.distance = 10;
});
await page.waitForTimeout(900); await shot('door');
// the rune circle, and the panel
await page.evaluate(() => {
  const d = window.__debug, s = d.sim, p = s.player, c = d.world.LANDMARKS.circle;
  p.x = c.x + 4.2; p.z = c.z + 1; d.view.yaw = Math.atan2(4.2, 1); d.view.pitch = 0.5; d.view.distance = 9;
});
await page.waitForTimeout(900); await shot('circle');
await page.evaluate(() => {
  const d = window.__debug, s = d.sim, p = s.player, c = d.world.LANDMARKS.circle, it = d.items;
  p.skills.enchanting.xp = 24815; p.skills.enchanting.level = 36;
  p.x = c.x + 2.6; p.z = c.z; p.gold = 500;
  p.equipment.weapon = 'starmetal_blade'; p.equipment.chest = 'starmetal_chestplate'; p.equipment.head = 'steel_helm';
  p.inventory.fill(null);
  [['arcane_dust', 120], ['iron_chestplate', 1], ['steel_sword', 1], ['adamant_helm', 1], ['kings_crown', 1]].forEach(([id, qty], i) => { p.inventory[i] = { id, qty }; });
  s.interact = { k: 'circle' };
});
await page.waitForTimeout(700);
await shot('panel');
await page.evaluate(() => { window.__debug.sim.interact = null; });
await page.waitForTimeout(300);
if (errors.length) { console.error(`page errors: ${errors.join('; ')}`); process.exitCode = 1; }
console.log(process.exitCode ? 'vault bench FAILED' : 'vault shots written');
await browser.close();
await server.close();
