// Walks the Barrowdowns and Highmoor in real Chromium, with real keys and mouse clicks: Hobb's gate (a level-18 player turned back, a level-24 one let through), the road east past the
// barrows and a stand of stormiron, a camp of hounds picked off the screen, Highmoor from the west, its flight master clicked and its two gates refusing with a line.
// Screenshots land in bench/shots/barrow-*.png.
//   node bench/barrowdowns.mjs        (needs a build: npx vite build)
import { preview } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, 'bench', 'shots');
mkdirSync(shots, { recursive: true });
const server = await preview({ root, logLevel: 'error', preview: { port: 4177, open: false } });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
const fail = msg => { console.error(`FAIL: ${msg}`); process.exitCode = 1; };
const sim = (fn, arg) => page.evaluate(fn, arg);
const at = (x, y, z) => page.evaluate(([x, y, z]) => window.__debug.view.project(x, y, z), [x, y, z]);
/** Put the player at (x, z) with the camera `yaw` (0 looks north, PI south, -PI/2 east, so 3PI/2 too), health full, and let the sim and a frame settle. */
const stand = async (x, z, yaw = 0, ms = 500) => {
  await page.evaluate(([x, z, yaw]) => { const s = window.__debug.sim, p = s.player; s.moveTarget = null; s.interact = null; p.x = x; p.z = z; p.hp = p.maxHp; window.__debug.view.yaw = yaw; }, [x, z, yaw]);
  await page.waitForTimeout(ms);
};
const setLevel = level => page.evaluate(level => {
  const p = window.__debug.sim.player;
  p.combat.level = level; p.combat.xp = Math.round(100 * level ** 2.3); // the sim reads `level`
}, level);
const msg = () => page.locator('.msg').innerText();
/** Hold W for ms: the camera's forward is the way the player runs. */
const walk = async ms => { await page.keyboard.down('KeyW'); await page.waitForTimeout(ms); await page.keyboard.up('KeyW'); };
const EAST = Math.PI / 2 * 3, NORTH = 0;

await page.goto(`${server.resolvedUrls.local[0]}?debug=1`);
await page.waitForFunction(() => window.__debug, null, { timeout: 120000 });
await page.evaluate(() => window.__debug.view.modelsReady);
await page.locator('.helpok').click({ timeout: 5000 }).catch(() => {});
await sim(() => {
  const s = window.__debug.sim, p = s.player;
  for (const e of s.enemies) { e.state = 'dead'; e.respawnIn = 1e9; e.deadFor = 99; } // this is about the ground and the towns, not the fight
  p.gold = 2000;
});
const GATE = await sim(() => window.__debug.world.GATES.find(g => g.id === 'barrowdowns').at);
const Z = 1008;

// 1. Hobb's gate, at combat 18: walking east into it runs up to the line and he turns you back
await setLevel(18);
await stand(GATE - 14, Z, EAST);
await page.screenshot({ path: join(shots, 'barrow-gate-approach.png') });
await walk(3500);
const x1 = await sim(() => window.__debug.sim.player.x);
if (x1 >= GATE) fail(`a level-18 player ran through Hobb's gate to x = ${x1.toFixed(1)}`);
const said = await msg();
if (!said.includes('Gatewarden Hobb')) fail(`Hobb did not speak: the message line reads "${said}"`);
await page.screenshot({ path: join(shots, 'barrow-gate-refused.png') });

// 2. the same run at combat 24 goes through, and on into the Barrowdowns
await setLevel(24);
await stand(GATE - 14, Z, EAST);
await walk(4500);
const x2 = await sim(() => window.__debug.sim.player.x);
if (x2 < GATE + 8) fail(`a level-24 player did not get through Hobb's gate: x = ${x2.toFixed(1)}`);
await page.screenshot({ path: join(shots, 'barrow-gate-through.png') });

// 3. the road: the first mounds, then a stand of stormiron in the barrows
await stand(1010, Z, EAST, 700);
await page.screenshot({ path: join(shots, 'barrow-road-west.png') });
const stand0 = await sim(() => { const n = window.__debug.sim.nodes.filter(n => n.type === 'stormiron' && n.x > 1000)[0]; return { x: n.x, z: n.z, id: n.id }; });
await stand(stand0.x - 12, Z, EAST, 800);
await page.screenshot({ path: join(shots, 'barrow-stormiron-stand.png') });
await stand(stand0.x - 4, stand0.z + (stand0.z > Z ? -4 : 4), stand0.z > Z ? Math.PI : NORTH, 700);
await page.screenshot({ path: join(shots, 'barrow-stormiron-near.png') });
// a Mining-40 hand mines it by clicking
await sim(() => { const p = window.__debug.sim.player; p.skills.mining.level = 40; p.skills.mining.xp = 40000; });
const vein = await at(stand0.x, 1, stand0.z);
await page.mouse.click(vein.x, vein.y);
await page.waitForTimeout(1500);
const acting = await sim(() => window.__debug.sim.player.action?.k ?? null);
if (acting !== 'gather') fail(`a click on the stormiron vein did not start a gather: action = ${acting}`);
await sim(() => { window.__debug.sim.player.action = null; });

// 4. a camp of hounds, picked off the screen with a click
const hound = await sim(() => {
  const s = window.__debug.sim, e = s.enemies.find(x => x.type === 'grave_hound');
  for (const m of s.enemies) if (m.type === 'grave_hound' && Math.hypot(m.spawnX - e.spawnX, m.spawnZ - e.spawnZ) < 5) { m.state = 'idle'; m.hp = m.maxHp; m.x = m.spawnX; m.z = m.spawnZ; m.respawnIn = 0; m.deadFor = 0; }
  const p = s.player; p.x = e.x + 6; p.z = e.z + (e.z > 1008 ? -7 : 7); p.hp = p.maxHp = 99999;
  window.__debug.view.yaw = Math.atan2(p.x - e.x, p.z - e.z);
  return { x: e.x, z: e.z, id: e.id };
});
await page.waitForTimeout(500);
const hp = await at(hound.x, 0.8, hound.z);
await page.screenshot({ path: join(shots, 'barrow-hounds.png') });
await page.mouse.click(hp.x, hp.y);
await page.waitForTimeout(300);
const tgt = await sim(() => window.__debug.sim.targetId);
const type = await sim(id => window.__debug.sim.enemies.find(e => e.id === id)?.type, tgt);
if (type !== 'grave_hound') fail(`a click on a hound targeted ${tgt} (${type})`);
await sim(() => { const s = window.__debug.sim; for (const e of s.enemies) { e.state = 'dead'; e.respawnIn = 1e9; e.deadFor = 99; } s.targetId = null; });

// 5. the Barrow Lord's stretch, then Highmoor from the west
const lord = await sim(() => { const e = window.__debug.sim.enemies.find(x => x.type === 'barrow_lord'); return { x: e.spawnX, z: e.spawnZ }; });
await stand(lord.x - 20, lord.z + 14, Math.PI / 2 * 3 - 0.5, 500);
await page.screenshot({ path: join(shots, 'barrow-lord-country.png') });
await stand(1815, Z, EAST, 700);
await page.screenshot({ path: join(shots, 'barrow-road-east.png') });
await stand(1862, Z + 3, EAST, 900);
await page.screenshot({ path: join(shots, 'highmoor-from-the-road.png') });
await stand(1880, Z + 4, EAST, 700);
await page.screenshot({ path: join(shots, 'highmoor-town.png') });

// 6. the flight master: found by walking up, clickable, with Thornwick (found by the sim) on its list at 190 gold
await sim(() => { const f = window.__debug.sim.found; if (!f.includes('thornwick')) f.push('thornwick'); });
const fmPos = await sim(() => window.__debug.world.LANDMARKS.flightHigh);
await stand(fmPos.x + 9, fmPos.z, Math.PI / 2, 600);
const found = await sim(() => window.__debug.sim.found.join());
if (!found.includes('highmoor')) fail(`walking up to the flight master did not find Highmoor: found = ${found}`);
const fm = await at(fmPos.x, 1.5, fmPos.z);
await page.mouse.click(fm.x, fm.y);
await page.waitForSelector('.shoppanel:visible', { timeout: 8000 }).catch(() => fail('clicking the flight master did not open the flights'));
await page.waitForTimeout(400);
const rows = await page.locator('.shoppanel:visible .recipe').allInnerTexts();
if (!rows.some(r => r.includes('Thornwick') && r.includes('190 gold'))) fail(`the flights from Highmoor read: ${JSON.stringify(rows)}`);
await page.screenshot({ path: join(shots, 'highmoor-flights.png') });
await sim(f => { const p = window.__debug.sim.player; p.x = f.x + 20; p.z = f.z + 20; }, fmPos);
await page.waitForTimeout(500);

// 7. the Moor, and an enemy picked off the screen
const ram = await sim(() => {
  const s = window.__debug.sim, e = s.enemies.find(x => x.type === 'moor_ram');
  e.state = 'idle'; e.hp = e.maxHp; e.x = e.spawnX; e.z = e.spawnZ; e.respawnIn = 0; e.deadFor = 0;
  const p = s.player; p.x = e.x - 6; p.z = e.z + 7; p.hp = p.maxHp = 99999;
  window.__debug.view.yaw = Math.atan2(p.x - e.x, p.z - e.z);
  return { x: e.x, z: e.z, id: e.id };
});
await page.waitForTimeout(500);
const rp = await at(ram.x, 1, ram.z);
await page.screenshot({ path: join(shots, 'highmoor-moor.png') });
await page.mouse.click(rp.x, rp.y);
await page.waitForTimeout(300);
if (await sim(() => window.__debug.sim.targetId) !== ram.id) fail('a click on the moor ram did not target it');
await sim(() => { const s = window.__debug.sim; for (const e of s.enemies) { e.state = 'dead'; e.respawnIn = 1e9; e.deadFor = 99; } s.targetId = null; });

// 8. the Cairn Hold's door at combat 24 (refused with the level), then at 30 (shut for good); the north gate at 40 (shut)
const gates = await sim(() => Object.fromEntries(window.__debug.world.GATES.filter(g => g.id === 'cairnhold' || g.id === 'cairnwaste').map(g => [g.id, { at: g.at, mid: (g.span[0] + g.span[1]) / 2 }])));
await setLevel(24);
await stand(gates.cairnhold.mid, gates.cairnhold.at + 14, NORTH, 600);
await page.screenshot({ path: join(shots, 'highmoor-cairn-door.png') });
await walk(3500);
if (!(await msg()).includes('Cairnwarden Ysolt')) fail(`the Cairn Hold's keeper did not speak: "${await msg()}"`);
if (await page.locator('.logline', { hasText: 'combat 29 needed' }).count() < 1) fail('the Cairn Hold refusal is not in the log with its level');
await page.screenshot({ path: join(shots, 'highmoor-cairn-refused.png') });
await setLevel(30);
await stand(gates.cairnhold.mid, gates.cairnhold.at + 14, NORTH, 600);
await walk(3500);
const z3 = await sim(() => window.__debug.sim.player.z);
if (z3 < gates.cairnhold.at) fail(`a level-30 player got through the Cairn Hold's door to z = ${z3.toFixed(1)}`);
await page.screenshot({ path: join(shots, 'highmoor-cairn-shut.png') });
await setLevel(40);
await stand(gates.cairnwaste.mid, gates.cairnwaste.at + 14, NORTH, 600);
await walk(3500);
if (!(await msg()).includes('Watchman Corvin')) fail(`the north gate's keeper did not speak: "${await msg()}"`);
if (await page.locator('.logline', { hasText: 'Watchman Corvin' }).filter({ hasText: 'needed' }).count() > 0) fail('the north gate logs a combat level it does not ask for');
await page.screenshot({ path: join(shots, 'highmoor-north-gate.png') });

// 9. cost: how many slabs are built and shown here
const stats = await sim(() => window.__debug.view.world.stats);
console.log(`world slabs: ${stats.tiles} in all, ${stats.built} built, ${stats.shown} shown`);
if (stats.shown > 14) fail(`${stats.shown} slabs shown at once in Highmoor`);

if (errors.length) fail(`page errors: ${errors.join('; ')}`);
console.log(process.exitCode ? 'barrowdowns bench FAILED' : 'barrowdowns bench passed');
await browser.close();
await server.close();
