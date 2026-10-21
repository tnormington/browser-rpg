// Drives Dunmere Fens and Thornwick in real Chromium, with real mouse clicks: the gate south of Saltmarrow turning a level-10 player back and letting a level-16 one through,
// Withering Ground draining health, Thornwick's reeve, provisioner and flight master, a Thornwood enemy picked from the screen, and the east gate that refuses everyone.
// Screenshots land in bench/shots/thorn-*.png.
//   node bench/thornwick.mjs        (needs a build: npx vite build)
import { preview } from 'vite';
import { launchBrowser } from './browser.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, 'bench', 'shots');
mkdirSync(shots, { recursive: true });
const server = await preview({ root, logLevel: 'error', preview: { port: 4176, open: false } });
const browser = await launchBrowser({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
const fail = msg => { console.error(`FAIL: ${msg}`); process.exitCode = 1; };
const sim = (fn, arg) => page.evaluate(fn, arg);
const at = (x, y, z) => page.evaluate(([x, y, z]) => window.__debug.view.project(x, y, z), [x, y, z]);
/** Put the player at (x, z) with the camera `yaw` (0 looks north, PI south, -PI/2 east), health full, and let the sim and a frame settle. */
const stand = async (x, z, yaw = 0, ms = 500) => {
  await page.evaluate(([x, z, yaw]) => { const s = window.__debug.sim, p = s.player; s.interact = null; p.x = x; p.z = z; p.hp = p.maxHp; window.__debug.view.yaw = yaw; }, [x, z, yaw]);
  await page.waitForTimeout(ms);
};
const setLevel = level => page.evaluate(level => {
  const p = window.__debug.sim.player;
  p.combat.level = level; p.combat.xp = Math.round(100 * level ** 2.3); // the sim reads `level`
}, level);
const msg = () => page.locator('.msg').innerText();
/** Hold W for ms: the camera's forward is the way the player runs (mouse-as-camera: a click on the ground goes nowhere). */
const walk = async ms => { await page.keyboard.down('KeyW'); await page.waitForTimeout(ms); await page.keyboard.up('KeyW'); };

await page.goto(`${server.resolvedUrls.local[0]}?debug=1`);
await page.waitForFunction(() => window.__debug, null, { timeout: 120000 });
await page.evaluate(() => window.__debug.view.modelsReady);
await page.locator('.helpok').click({ timeout: 5000 }).catch(() => {});
await sim(() => {
  const s = window.__debug.sim, p = s.player;
  for (const e of s.enemies) { e.state = 'dead'; e.respawnIn = 1e9; e.deadFor = 99; } // this is about the ground and the towns, not the fight
  p.gold = 2000;
});
await setLevel(10);

// 1. the gate south of Saltmarrow, at combat 10: walking south into it runs up to the line and the keeper turns you back
await stand(875, 72, Math.PI);
await page.screenshot({ path: join(shots, 'thorn-gate-approach.png') });
await walk(3500);
const z1 = await sim(() => window.__debug.sim.player.z);
if (z1 >= 90) fail(`a level-10 player ran through the gate to z = ${z1.toFixed(1)}`);
const said = await msg();
if (!said.includes('Marshwarden Quill')) fail(`the keeper did not speak: the message line reads "${said}"`);
await page.screenshot({ path: join(shots, 'thorn-gate-refused.png') });
const logged = await page.locator('.logline', { hasText: 'combat 16 needed' }).count();
if (logged < 1) fail('the refusal is not in the message log');

// 2. the same run at combat 16 goes through into the fens
await setLevel(16);
await stand(875, 72, Math.PI);
await walk(5000);
const z2 = await sim(() => window.__debug.sim.player.z);
if (z2 < 100) fail(`a level-16 player did not get through the gate: z = ${z2.toFixed(1)}`);
await page.screenshot({ path: join(shots, 'thorn-gate-through.png') });

// 3. Dunmere Fens: the road, the pools and reeds, and a patch of Withering Ground (standing in it drains)
await stand(875, 150, Math.PI);
await page.screenshot({ path: join(shots, 'thorn-fen-road.png') });
const patch = await sim(() => window.__debug.world.WITHERING.filter(h => h.z > 120).sort((a, b) => a.z - b.z)[1]);
await stand(patch.x, patch.z - patch.r - 14, Math.PI, 700);
await page.screenshot({ path: join(shots, 'thorn-withering-near.png') });
await stand(patch.x, patch.z, Math.PI, 300);
const hp0 = await sim(() => window.__debug.sim.player.hp);
await page.waitForTimeout(3200);
const hp1 = await sim(() => window.__debug.sim.player.hp);
if (hp1 >= hp0) fail(`standing in Withering Ground cost nothing: ${hp0} -> ${hp1}`);
await page.screenshot({ path: join(shots, 'thorn-withering-in.png') });
await stand(patch.x, patch.z - patch.r - 1.5, Math.PI, 300);
await stand(875, 330, Math.PI / 2, 400); // looking west along the verge: herbs, a camp in the distance
await page.screenshot({ path: join(shots, 'thorn-fen-verge.png') });

// 4. Thornwick: the town from the north road
await sim(() => { window.__debug.sim.player.combat.level = 18; });
await stand(875, 936, Math.PI);
await page.waitForTimeout(600);
await page.screenshot({ path: join(shots, 'thorn-road-end.png') });
await stand(878, 960, Math.PI, 700);
await page.screenshot({ path: join(shots, 'thorn-town.png') });
const reeve = await at(867, 1.2, 984);
await stand(867, 984 + 8, 0, 600);
const reevePt = await at(867, 1.2, 984);
await page.mouse.click(reevePt.x, reevePt.y);
await page.waitForSelector('.dialogue', { state: 'visible', timeout: 8000 }).catch(() => fail('clicking the reeve did not open a dialogue'));
const title = await page.locator('.dialogue .ptitle').innerText().catch(() => '');
if (!title.includes('Maud Alder')) fail(`the dialogue is headed "${title}", not the reeve's name`);
await page.screenshot({ path: join(shots, 'thorn-reeve.png') });
await sim(() => { const p = window.__debug.sim.player; p.x = 880; p.z = 1010; }); // walk off: the panel closes
await page.waitForTimeout(500);
void reeve;

// the provisioner
await stand(859, 996 + 8, 0, 600);
const edda = await at(859, 1.2, 996);
await page.mouse.click(edda.x, edda.y);
await page.waitForSelector('.shoppanel:visible', { timeout: 8000 }).catch(() => fail('clicking the provisioner did not open the shop'));
await page.waitForTimeout(400);
const shopTitle = await page.locator('.shoppanel:visible .ptitle').innerText();
if (!shopTitle.includes('Edda Bracken')) fail(`the shop is headed "${shopTitle}"`);
if (await page.locator('.shoppanel:visible .recipe', { hasText: 'Rusty Blade' }).count() !== 0) fail("the provisioner lists Hale's rusty blade");
await page.screenshot({ path: join(shots, 'thorn-shop.png') });
await sim(() => { const p = window.__debug.sim.player; p.x = 880; p.z = 1040; });
await page.waitForTimeout(500);

// the flight master: found by walking up, then clickable, and Saltmarrow (found on an earlier walk, here by the sim) is on its list
await sim(() => { const f = window.__debug.sim.found; if (!f.includes('saltmarrow')) f.push('saltmarrow'); });
await stand(885, 956 + 9, 0, 600);
const found = await sim(() => window.__debug.sim.found.join());
if (!found.includes('thornwick')) fail(`walking up to the flight master did not find Thornwick: found = ${found}`);
const fm = await at(885, 1.5, 956);
await page.mouse.click(fm.x, fm.y);
await page.waitForSelector('.shoppanel:visible', { timeout: 8000 }).catch(() => fail('clicking the flight master did not open the flights'));
await page.waitForTimeout(400);
const flightRows = await page.locator('.shoppanel:visible .recipe').allInnerTexts();
if (!flightRows.some(r => r.includes('Saltmarrow') && r.includes('190 gold'))) fail(`the flights from Thornwick read: ${JSON.stringify(flightRows)}`);
await page.screenshot({ path: join(shots, 'thorn-flights.png') });
await sim(() => { const p = window.__debug.sim.player; p.x = 880; p.z = 1040; });
await page.waitForTimeout(500);

// the alembic and the garden
await stand(889, 1000 + 7, 0, 700);
await page.screenshot({ path: join(shots, 'thorn-alembic.png') });

// 5. the Thornwood: wake the enemies again, then pick a thornback boar off the screen with a click
await stand(826, 1040, Math.PI / 2 * 3 - 0.4, 400);
const boar = await sim(() => {
  const s = window.__debug.sim, e = s.enemies.find(x => x.type === 'thornback');
  e.state = 'idle'; e.hp = e.maxHp; e.x = e.spawnX; e.z = e.spawnZ; e.respawnIn = 0; e.deadFor = 0;
  const p = s.player; p.x = e.x + 6; p.z = e.z + 7; p.hp = p.maxHp = 99999;
  window.__debug.view.yaw = Math.atan2(p.x - e.x, p.z - e.z); // the camera behind the player, forward toward the boar
  return { x: e.x, z: e.z, id: e.id };
});
await page.waitForTimeout(500);
const bp = await at(boar.x, 1, boar.z);
await page.screenshot({ path: join(shots, 'thorn-thornwood.png') });
await page.mouse.click(bp.x, bp.y);
await page.waitForTimeout(300);
const tgt = await sim(() => window.__debug.sim.targetId);
if (tgt !== boar.id) fail(`a click on the thornback boar targeted ${tgt}, not ${boar.id}`);
await sim(() => { const s = window.__debug.sim; for (const e of s.enemies) { e.state = 'dead'; e.respawnIn = 1e9; e.deadFor = 99; } s.targetId = null; });

// 6. the east gate: closed to everyone, with the keeper's line
await setLevel(24);
await stand(925, 1008, Math.PI / 2 * 3); // yaw 3PI/2: forward is east
await page.screenshot({ path: join(shots, 'thorn-east-gate.png') });
await walk(3500);
const x3 = await sim(() => window.__debug.sim.player.x);
const said2 = await msg();
if (x3 >= 938) fail(`a level-24 player got through the east gate to x = ${x3.toFixed(1)}`);
if (!said2.includes('Gatewarden Hobb')) fail(`the east gate keeper did not speak: "${said2}"`);
await page.screenshot({ path: join(shots, 'thorn-east-refused.png') });

// 7. cost: how many slabs are built and shown here
const stats = await sim(() => window.__debug.view.world.stats);
console.log(`world slabs: ${stats.tiles} in all, ${stats.built} built, ${stats.shown} shown`);
if (stats.shown > 14) fail(`${stats.shown} slabs shown at once in Thornwick`);

if (errors.length) fail(`page errors: ${errors.join('; ')}`);
console.log(process.exitCode ? 'thornwick bench FAILED' : 'thornwick bench passed');
await browser.close();
await server.close();
