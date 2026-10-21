// Walks the Cairnwaste and the Sundered Spire in real Chromium, with real keys and mouse clicks: Corvin's gate (shut without the writ, open with it), the road north past a stand of starmetal, a camp of
// hounds and the Colossus's country, the Spire from the south, its square, its Keeper, its forge and flight master clicked, the ruins, and the Vault's door refusing with a line.
// Screenshots land in bench/shots/waste-*.png and spire-*.png.
//   node bench/cairnwaste.mjs        (needs a build: npx vite build)
import { preview } from 'vite';
import { launchBrowser } from './browser.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, 'bench', 'shots');
mkdirSync(shots, { recursive: true });
const server = await preview({ root, logLevel: 'error', preview: { port: 4178, open: false } });
const browser = await launchBrowser({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
const fail = msg => { console.error(`FAIL: ${msg}`); process.exitCode = 1; };
const sim = (fn, arg) => page.evaluate(fn, arg);
const at = (x, y, z) => page.evaluate(([x, y, z]) => window.__debug.view.project(x, y, z), [x, y, z]);
/** Put the player at (x, z) with the camera `yaw` (0 looks north, PI south, -PI/2 east, so 3PI/2 too), health full, and let the sim and a frame settle. */
const stand = async (x, z, yaw = 0, ms = 500) => {
  await page.evaluate(([x, z, yaw]) => { const s = window.__debug.sim, p = s.player, v = window.__debug.view; s.interact = null; p.x = x; p.z = z; p.hp = p.maxHp; v.yaw = yaw; v.weather.set('clear', true); v.skyClock = 0; }, [x, z, yaw]); // a clear morning, so every shot is judged in the same light
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
const CX = 1980, CZ = 485, SX = 1980, SZ = 8; // the wastes' and the Spire's frames (sim/world.ts)

// 1. Corvin's gate: shut without the writ at any level, open with it, and the corridor runs on into the wastes
await setLevel(40);
await stand(W.north.mid, W.north.at + 14, NORTH, 600);
await page.screenshot({ path: join(shots, 'waste-gate-approach.png') });
await walk(3500);
if (!(await msg()).includes('Watchman Corvin')) fail(`Corvin did not speak without the writ: "${await msg()}"`);
if ((await sim(() => window.__debug.sim.player.z)) < W.north.at) fail('a player without the writ got past Corvin');
await page.screenshot({ path: join(shots, 'waste-gate-refused.png') });
await sim(() => { window.__debug.sim.quest.seventh = 'cleared'; });
await setLevel(32);
await stand(W.north.mid, W.north.at + 14, NORTH, 600);
await walk(9000);
const zg = await sim(() => window.__debug.sim.player.z);
if (zg > W.north.at - 40) fail(`with the writ the walk north got no further than z = ${zg.toFixed(0)}`);
await page.screenshot({ path: join(shots, 'waste-gate-through.png') });

// 2. the road: the first stretch, then a stand of starmetal
await stand(CX + 3, CZ + 395, NORTH, 800);
await page.screenshot({ path: join(shots, 'waste-road-south.png') });
const stand0 = await sim(() => { const n = window.__debug.sim.nodes.filter(n => n.type === 'starmetal')[0]; return { x: n.x, z: n.z }; });
await stand(CX + 2, stand0.z + 14, NORTH, 900);
await page.screenshot({ path: join(shots, 'waste-starmetal-stand.png') });
const sp = { x: stand0.x + (stand0.x > CX ? -5 : 5), z: stand0.z + 4 };
await stand(sp.x, sp.z, facing(sp.x, sp.z, stand0.x, stand0.z), 700);
await page.screenshot({ path: join(shots, 'waste-starmetal-near.png') });
await sim(() => { const p = window.__debug.sim.player; p.skills.mining.level = 52; p.skills.mining.xp = 150000; });
const vein = await at(stand0.x, 1, stand0.z);
await page.mouse.click(vein.x, vein.y);
await page.waitForTimeout(1500);
if ((await sim(() => window.__debug.sim.player.action?.k ?? null)) !== 'gather') fail(`a click on the starmetal vein did not start a gather: ${JSON.stringify(await sim(() => { const s = window.__debug.sim; return { interact: s.interact, at: [s.player.x, s.player.z], node: s.nodes.filter(n => n.type === 'starmetal')[0] }; }))} click at ${JSON.stringify(vein)} msg "${await msg()}"`);
await sim(() => { window.__debug.sim.player.action = null; });

// 3. a camp of hounds, picked off the screen with a click
const hound = await sim(() => {
  const s = window.__debug.sim, e = s.enemies.find(x => x.type === 'dune_hound');
  for (const m of s.enemies) if (m.type === 'dune_hound' && Math.hypot(m.spawnX - e.spawnX, m.spawnZ - e.spawnZ) < 5) { m.state = 'idle'; m.hp = m.maxHp; m.x = m.spawnX; m.z = m.spawnZ; m.respawnIn = 0; m.deadFor = 0; }
  const p = s.player; p.x = e.x - 6; p.z = e.z + 7; p.hp = p.maxHp = 99999;
  window.__debug.view.yaw = Math.atan2(p.x - e.x, p.z - e.z);
  return { x: e.x, z: e.z };
});
await page.waitForTimeout(500);
const hp = await at(hound.x, 0.8, hound.z);
await page.screenshot({ path: join(shots, 'waste-hounds.png') });
await page.mouse.click(hp.x, hp.y);
await page.waitForTimeout(300);
const type = await sim(() => { const s = window.__debug.sim; return s.enemies.find(e => e.id === s.targetId)?.type; });
if (type !== 'dune_hound') fail(`a click on a hound targeted ${type}`);
await calm();

// 4. an ogre, and the Colossus's stretch
const ogre = await sim(() => {
  const s = window.__debug.sim, e = s.enemies.find(x => x.type === 'sand_ogre');
  e.state = 'idle'; e.hp = e.maxHp; e.x = e.spawnX; e.z = e.spawnZ; e.respawnIn = 0; e.deadFor = 0;
  const p = s.player; p.x = e.x + 6; p.z = e.z + 7; p.hp = p.maxHp = 99999;
  window.__debug.view.yaw = Math.atan2(p.x - e.x, p.z - e.z);
  return { x: e.x, z: e.z };
});
await page.waitForTimeout(500);
await page.screenshot({ path: join(shots, 'waste-ogre.png') });
await calm();
const col = await sim(() => {
  const s = window.__debug.sim, e = s.enemies.find(x => x.type === 'ashen_colossus');
  e.state = 'idle'; e.hp = e.maxHp; e.x = e.spawnX; e.z = e.spawnZ; e.respawnIn = 0; e.deadFor = 0;
  const p = s.player; p.x = e.x - 16; p.z = e.z + 14; p.hp = p.maxHp = 99999;
  window.__debug.view.yaw = Math.atan2(p.x - e.x, p.z - e.z);
  return { x: e.x, z: e.z };
});
await page.waitForTimeout(700);
await page.screenshot({ path: join(shots, 'waste-colossus-country.png') });
await calm();

// 5. the Spire from the south, and its square
await stand(SX + 1, SZ + 120, NORTH, 700);
await page.screenshot({ path: join(shots, 'waste-road-north.png') });
await stand(SX + 1, SZ + 80, NORTH, 900);
await page.screenshot({ path: join(shots, 'spire-from-the-road.png') });
await stand(SX + 1, SZ + 58, NORTH, 900);
await page.screenshot({ path: join(shots, 'spire-town.png') });
await stand(W.L.spireSquare.x - 4, W.L.spireSquare.z + 12, Math.PI * 0.75, 700);
await page.screenshot({ path: join(shots, 'spire-square.png') });

// 6. the flight master: found by walking up, clickable, with Highmoor on its list at 190 gold
await sim(() => { const f = window.__debug.sim.found; if (!f.includes('highmoor')) f.push('highmoor'); });
const fmPos = W.L.flightSpire;
await stand(fmPos.x - 9, fmPos.z, -Math.PI / 2, 600);
if (!(await sim(() => window.__debug.sim.found.join()))?.includes('spire')) fail('walking up to the flight master did not find the Spire');
const fm = await at(fmPos.x, 1.5, fmPos.z);
await page.mouse.click(fm.x, fm.y);
await page.waitForSelector('.shoppanel:visible', { timeout: 8000 }).catch(() => fail('clicking the flight master did not open the flights'));
await page.waitForTimeout(400);
const rows = await page.locator('.shoppanel:visible .recipe').allInnerTexts();
if (!rows.some(r => r.includes('Highmoor') && r.includes('190 gold'))) fail(`the flights from the Spire read: ${JSON.stringify(rows)}`);
await page.screenshot({ path: join(shots, 'spire-flights.png') });
await stand(fmPos.x - 12, fmPos.z + 10, 0, 500);

// 7. the Keeper: a mark over her, clicked, her offer in the dialogue
const kp = W.L.spireKeeper;
await sim(() => { const q = window.__debug.sim.quest; q.stage = 'done'; q.second = 'cleared'; q.third = 'cleared'; q.fifth = 'cleared'; q.sixth = 'cleared'; q.seventh = 'cleared'; });
await stand(kp.x + 8, kp.z + 5, facing(kp.x + 8, kp.z + 5, kp.x, kp.z), 800);
await page.screenshot({ path: join(shots, 'spire-keeper-mark.png') });
const kpp = await at(kp.x, 1.2, kp.z);
await page.mouse.click(kpp.x, kpp.y);
await page.waitForSelector('.dialogue', { state: 'visible', timeout: 8000 }).catch(() => fail('clicking the Keeper did not open a dialogue'));
const title = await page.locator('.dialogue .ptitle').innerText().catch(() => '');
if (!title.includes('Isaura Venn')) fail(`the dialogue is headed "${title}", not the Keeper's name`);
if ((await sim(() => window.__debug.sim.quest.eighth)) !== 'offer') fail('with the writ signed the Keeper has nothing on offer');
await page.screenshot({ path: join(shots, 'spire-keeper-dialogue.png') });
await page.keyboard.press('Escape');

// 8. the forge: a click walks the player over and opens its recipe list, with the starmetal on it
const fg = W.L.forgeSpire;
await sim(() => { const p = window.__debug.sim.player; p.skills.smithing.level = 54; p.skills.smithing.xp = 200000; });
await stand(fg.x + 12, fg.z + 6, Math.PI / 2 + 0.4, 800);
await page.screenshot({ path: join(shots, 'spire-forge.png') });
const fgp = await at(fg.x, 1.2, fg.z);
await page.mouse.click(fgp.x, fgp.y);
await page.waitForSelector('.forgepanel:visible', { timeout: 8000 }).catch(() => fail('clicking the Spire\'s forge did not open the forge'));
const forgeRows = await page.locator('.forgepanel:visible .recipe').allInnerTexts();
if (!forgeRows.some(r => r.includes('Starmetal Bar')) || !forgeRows.some(r => r.includes('Crownbreaker'))) fail('the Spire\'s forge does not list starmetal and Crownbreaker');
await page.screenshot({ path: join(shots, 'spire-forge-panel.png') });
await page.keyboard.press('Escape');

// 9. the ruins: a Warden and his rune golems, the Vault's door past them
const warden = await sim(() => {
  const s = window.__debug.sim, e = s.enemies.find(x => x.type === 'spire_warden');
  e.state = 'idle'; e.hp = e.maxHp; e.x = e.spawnX; e.z = e.spawnZ; e.respawnIn = 0; e.deadFor = 0;
  const p = s.player; p.x = e.x - 18; p.z = e.z + 22; p.hp = p.maxHp = 99999;
  window.__debug.view.yaw = Math.atan2(p.x - e.x, p.z - e.z);
  return { x: e.x, z: e.z };
});
await page.waitForTimeout(800);
await page.screenshot({ path: join(shots, 'spire-warden.png') });
await calm();
await stand(SX - 40, SZ - 8, Math.PI * 1.25, 800);
await page.screenshot({ path: join(shots, 'spire-ruins.png') });

// 10. the Vault's door: at 30 the level is the reason, at 40 it is shut
await setLevel(30);
await stand(W.vault.mid, W.vault.at + 14, NORTH, 700);
await page.screenshot({ path: join(shots, 'spire-vault-door.png') });
await walk(3500);
if (!(await msg()).includes('Wardkeeper Osric Thale')) fail(`the Vault's keeper did not speak: "${await msg()}"`);
if (await page.locator('.logline', { hasText: 'combat 38 needed' }).count() < 1) fail('the Vault refusal is not in the log with its level');
await setLevel(40);
await stand(W.vault.mid, W.vault.at + 14, NORTH, 600);
await walk(3500);
if ((await sim(() => window.__debug.sim.player.z)) < W.vault.at) fail('a level-40 player got through the shut Vault door');
await page.screenshot({ path: join(shots, 'spire-vault-shut.png') });

// 11. cost: how many slabs are built and shown here
const stats = await sim(() => window.__debug.view.world.stats);
console.log(`world slabs: ${stats.tiles} in all, ${stats.built} built, ${stats.shown} shown`);
if (stats.shown > 14) fail(`${stats.shown} slabs shown at once in the Spire`);

if (errors.length) fail(`page errors: ${errors.join('; ')}`);
console.log(process.exitCode ? 'cairnwaste bench FAILED' : 'cairnwaste bench passed');
await browser.close();
await server.close();
