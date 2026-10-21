// Walks Highmoor's new ground in real Chromium, with real keys and mouse clicks: the Steward (Q6, The Moor Writ) clicked, talked to and handed in to, Corvin's gate letting the signed
// player through, the provisioner's shop, and the Cairn Hold behind Ysolt's door: the stair, the ossuary, the King's chamber, a Ridge Ogre fought with the keyboard, the Cairn King's
// three tells watched and the King put down, and a Ghostcap patch picked. Screenshots land in bench/shots/cairn-*.png.
//   node bench/cairnhold.mjs        (needs a build: npx vite build)
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
const shot = name => page.screenshot({ path: join(shots, `cairn-${name}.png`) });
const HX = 1910, HZ = 1008; // Highmoor's frame: the bible's local coordinates are offsets from this
/** Put the player at (x, z) looking toward (lookX, lookZ) (or `yaw`), health full, and let the sim and a frame settle. */
const stand = async (x, z, look = null, ms = 500) => {
  await page.evaluate(([x, z, look]) => {
    const s = window.__debug.sim, p = s.player;
    s.interact = null; p.x = x; p.z = z; p.hp = p.maxHp;
    window.__debug.view.yaw = look ? Math.atan2(x - look.x, z - look.z) : 0;
  }, [x, z, look]);
  await page.waitForTimeout(ms);
};
/** Combat level with exactly its XP (sim/xp.ts's curve), so a kill's XP does not carry the player past it. */
const setLevel = level => page.evaluate(level => {
  let points = 0, xp = 0;
  for (let l = 1; l < level; l++) { points += Math.floor(l + 300 * Math.pow(2, l / 7)); xp = Math.floor(points / 4); }
  const p = window.__debug.sim.player; p.combat.level = level; p.combat.xp = xp;
}, level);
const msg = () => page.locator('.msg').innerText();
const px = () => sim(() => { const p = window.__debug.sim.player; return { x: p.x, z: p.z }; });
/** Hold W until the player's z is below `z` (or ms run out): the camera's forward is the way the player runs. */
const walkNorthTo = async (z, ms = 12000) => {
  await page.keyboard.down('KeyW');
  const t0 = Date.now();
  while (Date.now() - t0 < ms && (await px()).z > z) await page.waitForTimeout(100);
  await page.keyboard.up('KeyW');
};
/** A level-up shrinks the health the bench set, so the player is topped up wherever the fight is the point and not the dying. */
const heal = () => { const p = window.__debug.sim.player; p.hp = p.maxHp; };
/** Tab to the nearest enemy, auto-attack on, and Strike / Crushing Blow from the keyboard until `done()` or the time is up. */
const fight = async (done, ms = 60000) => {
  await page.keyboard.press('Tab');
  await page.keyboard.press('KeyX');
  const t0 = Date.now();
  while (Date.now() - t0 < ms && !(await sim(done))) {
    await sim(heal);
    await page.keyboard.press('Digit1'); await page.waitForTimeout(450);
    await page.keyboard.press('Digit3'); await page.waitForTimeout(450);
  }
  return sim(done);
};

await page.goto(`${server.resolvedUrls.local[0]}?debug=1`);
await page.waitForFunction(() => window.__debug, null, { timeout: 120000 });
await page.evaluate(() => window.__debug.view.modelsReady);
await page.locator('.helpok').click({ timeout: 5000 }).catch(() => {});
const LM = await sim(() => window.__debug.world.LANDMARKS);
const GATES = await sim(() => window.__debug.world.GATES.filter(g => g.id === 'cairnhold' || g.id === 'cairnwaste'));
const ysolt = GATES.find(g => g.id === 'cairnhold'), corvin = GATES.find(g => g.id === 'cairnwaste');
await sim(() => {
  const s = window.__debug.sim, p = s.player;
  for (const e of s.enemies) { e.state = 'dead'; e.respawnIn = 1e9; e.deadFor = 99; } // the town and the gates first: the Hold's own are woken when it is walked
  p.gold = 500; p.maxHp = p.hp = 99999;
  const q = s.quest; q.stage = 'done'; q.second = q.third = q.fifth = q.sixth = 'cleared'; // the chain up to the Rotroot is behind this player
  window.__seen = [];
  const push = s.events.push;
  s.events.push = function (...a) { for (const e of a) window.__seen.push(e.t === 'telegraph' ? `telegraph:${e.kind}` : e.t); return push.apply(this, a); };
});
await setLevel(29);

// 1. Q6: the Steward. A mark over them, a click opens the talk, the offer is taken, the hunt is done, the hand-in pays 1,500
const sw = LM.highSteward;
await stand(sw.x + 7, sw.z + 8, sw, 700);
const q0 = await sim(() => window.__debug.sim.quest.seventh);
if (q0 !== 'offer') fail(`with the Rotroot handed in the Steward's chain is "${q0}", not on offer`);
await shot('steward');
const sp = await at(sw.x, 1.4, sw.z);
await page.mouse.click(sp.x, sp.y);
await page.waitForSelector('.dialogue:visible', { timeout: 8000 }).catch(() => fail('clicking the Steward did not open the talk'));
await page.waitForTimeout(400);
if (!(await page.locator('.dialogue:visible .ptitle').innerText()).includes('Steward Hild Garrow')) fail('the talk is not with the Steward');
await shot('steward-talk');
await page.locator('.dopt', { hasText: "I'll clear the moor" }).click();
await page.waitForTimeout(300);
await page.locator('.dopt', { hasText: 'Okay' }).click();
if (await sim(() => window.__debug.sim.quest.seventh) !== 'hunt') fail('taking the offer did not start the hunt');
if (!(await page.locator('.tracker').innerText()).includes('The Moor Writ')) fail('the tracker does not show The Moor Writ');
await shot('tracker');
// one of the four is fought with the keyboard; the rest are credited as if killed (the kills are the sim's, the walk and the fight are what this bench is for)
await sim(() => {
  const s = window.__debug.sim, e = s.enemies.find(x => x.type === 'moor_ram'), p = s.player;
  e.state = 'idle'; e.hp = 40; e.x = e.spawnX = p.x + 2; e.z = e.spawnZ = p.z - 2; e.respawnIn = 0; e.deadFor = 0; s.targetId = null;
});
await fight(() => window.__debug.sim.quest.kills.moor_ram >= 1, 20000);
const kills = await sim(() => window.__debug.sim.quest.kills.moor_ram ?? 0);
if (kills < 1) fail('a Moor Ram killed with the keyboard did not count toward the hunt');
await sim(() => { const q = window.__debug.sim.quest; q.kills.moor_raider = 4; q.kills.moor_ram = 3; q.kills.ridge_ogre = 2; q.kills.stonehorn = 1; q.seventh = 'report'; });
await page.waitForTimeout(300);
await shot('report');
const xp0 = await sim(() => window.__debug.sim.player.combat.xp);
await page.keyboard.press('KeyV');
await page.waitForSelector('.dialogue:visible', { timeout: 5000 }).catch(() => fail('V beside the Steward did not open the talk'));
await page.locator('.dopt', { hasText: 'Thank you' }).click();
await page.waitForTimeout(300);
await page.locator('.dopt', { hasText: 'Okay' }).click();
const q1 = await sim(() => window.__debug.sim.quest.seventh), xp1 = await sim(() => window.__debug.sim.player.combat.xp);
if (q1 !== 'cleared' || xp1 - xp0 !== 1500) fail(`the hand-in left the chain at "${q1}" and paid ${xp1 - xp0} combat XP, not 1,500`);
await shot('handed-in');

// 2. Corvin: at any level the gate was shut; with the writ it lets the player through
await setLevel(29);
await stand(corvin.span[0] + 3, corvin.at + 14, null, 600);
await page.keyboard.down('KeyW'); await page.waitForTimeout(3500); await page.keyboard.up('KeyW');
const cz = (await px()).z;
if (cz > corvin.at) fail(`with the writ signed Corvin still held the line: z = ${cz.toFixed(1)}`);
await shot('corvin-open');

// 3. the provisioner: a click opens the shop, and the bag can be sold here
const vd = LM.highVendor;
await stand(vd.x + 6, vd.z + 7, vd, 600);
await sim(() => { const inv = window.__debug.sim.player.inventory; inv[0] = { id: 'iron_sword', qty: 1 }; });
const vp = await at(vd.x, 1.4, vd.z);
await page.mouse.click(vp.x, vp.y);
await page.waitForSelector('.shoppanel:visible', { timeout: 8000 }).catch(() => fail('clicking the provisioner did not open the shop'));
await page.waitForTimeout(400);
const stock = await page.locator('.shoppanel:visible .recipe').allInnerTexts();
if (!stock.some(r => r.includes('Steel Sword'))) fail(`the provisioner's stock reads: ${JSON.stringify(stock)}`);
await shot('provisioner');
await page.keyboard.press('Escape');

// 4. Ysolt's door, then the Hold: the stair
await setLevel(30);
await stand(ysolt.span[0] + 3, ysolt.at + 14, null, 600);
await shot('door');
// wake the stair's ogre and walk in on it with W
await sim(() => { const e = window.__debug.sim.enemies.find(x => x.type === 'ridge_ogre' && x.spawnZ > 910 && x.spawnZ < 920); e.state = 'idle'; e.hp = e.maxHp; e.x = e.spawnX; e.z = e.spawnZ; e.respawnIn = 0; e.deadFor = 0; });
await walkNorthTo(HZ - 86);
await shot('stair-entry');
if ((await px()).z > HZ - 80) fail('a level-30 player did not get past Ysolt into the Hold');
await walkNorthTo(HZ - 90, 6000);
await page.waitForTimeout(400);
await sim(() => { window.__debug.sim.player.hp = 99999; });
await sim(() => { const o = window.__debug.sim.enemies.find(x => x.type === 'ridge_ogre' && x.spawnZ > 910 && x.spawnZ < 920); o.hp = 600; });
const ogre1 = await fight(() => window.__debug.sim.enemies.find(x => x.type === 'ridge_ogre' && x.spawnZ > 910 && x.spawnZ < 920).state === 'dead', 40000);
if (!ogre1) fail('the stair\'s Ridge Ogre was not put down with the keyboard');
await shot('stair-ogre');

// 5. the ossuary
await stand(HX - 30, HZ - 97, null, 700);
await sim(() => { for (const e of window.__debug.sim.enemies) if (e.type === 'ridge_ogre' && e.spawnZ < 910 && e.spawnZ > 880) { e.state = 'idle'; e.hp = 300; e.x = e.spawnX; e.z = e.spawnZ; e.respawnIn = 0; e.deadFor = 0; } });
await shot('ossuary');
await page.waitForTimeout(1500);
await fight(() => window.__debug.sim.enemies.filter(e => e.type === 'ridge_ogre' && e.spawnZ < 910 && e.spawnZ > 880).every(e => e.state === 'dead'), 50000);
await shot('ossuary-cleared');

// 6. the King's chamber, and the three tells
await stand(HX - 28, HZ - 122, null, 700);
await shot('chamber-door');
await stand(HX - 19, HZ - 133, null, 300); // nine from the King, inside his notice
await sim(() => { window.__seen.length = 0; const k = window.__debug.sim.enemies.find(e => e.type === 'cairn_king'); k.state = 'idle'; k.hp = k.maxHp; k.x = k.spawnX; k.z = k.spawnZ; k.respawnIn = 0; k.deadFor = 0; });
const kingHp = await sim(() => window.__debug.sim.enemies.find(e => e.type === 'cairn_king').maxHp);
if (kingHp !== 23290) fail(`the Cairn King has ${kingHp} HP, not 23,290`);
await sim(() => { const s = window.__debug.sim; for (const e of s.enemies) if (e.type === 'ridge_ogre') { e.state = 'dead'; e.respawnIn = 1e9; e.deadFor = 99; } s.targetId = null; });
await page.keyboard.press('Tab'); await page.keyboard.press('KeyX');
let ground = false;
for (let i = 0; i < 80 && !ground; i++) { await sim(heal); await page.keyboard.press('Digit1'); await page.waitForTimeout(250); ground = await sim(() => window.__seen.includes('telegraph:ground')); }
if (ground) await shot('falling-stone');
await page.waitForTimeout(1200);
await shot('king-fight');
for (let i = 0; i < 80; i++) { await sim(heal); await page.keyboard.press('Digit1'); await page.waitForTimeout(250); if ((await sim(() => window.__seen)).filter(x => x.startsWith('telegraph')).length >= 6) break; }
const kinds = [...new Set((await sim(() => window.__seen)).filter(x => x.startsWith('telegraph')).map(x => x.slice(10)))];
for (const k of ['heavy', 'ground', 'bolt']) if (!kinds.includes(k)) fail(`the Cairn King never showed his "${k}" tell: saw ${kinds.join(', ') || 'none'}`);
await sim(() => { window.__debug.sim.enemies.find(e => e.type === 'cairn_king').hp = 120; });
const dead = await fight(() => window.__debug.sim.enemies.find(e => e.type === 'cairn_king').state === 'dead', 40000);
if (!dead) fail('the Cairn King was not put down with the keyboard');
await shot('king-down');

// 7. Ghostcap: a patch in the chamber, picked with a click at Herbalism 34
const gh = await sim(() => { const n = window.__debug.sim.nodes.filter(n => n.type === 'ghostcap'); return { count: n.length, near: n.find(m => m.z < 900 && m.x > 1870) }; });
if (gh.count !== 6) fail(`${gh.count} Ghostcap patches in the world, not 6`);
await sim(() => { const p = window.__debug.sim.player; p.skills.herbalism.level = 34; p.skills.herbalism.xp = 99999; });
await stand(gh.near.x + 3, gh.near.z + 3, gh.near, 700);
await shot('ghostcap');
const gp = await at(gh.near.x, 0.6, gh.near.z);
await page.mouse.click(gp.x, gp.y);
await page.waitForTimeout(1200);
const acting = await sim(() => window.__debug.sim.player.action?.k ?? null);
if (acting !== 'gather') fail(`a click on the Ghostcap did not start a gather: action = ${acting}`);

if (errors.length) fail(`page errors: ${errors.join('; ')}`);
console.log(process.exitCode ? 'cairnhold bench FAILED' : 'cairnhold bench passed');
await browser.close();
await server.close();
