// Input / HUD checks through real browser events (serves the existing dist/: run `npm run build` first).
//   node bench/feel.mjs   -> prints PASS/FAIL lines, writes bench/shots/feel/*.png
import { preview } from 'vite';
import { launchBrowser } from './browser.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'bench', 'shots', 'feel');
mkdirSync(out, { recursive: true });
const server = await preview({ root, logLevel: 'error', preview: { port: 4176, open: false } });
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.error('pageerror', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}?debug=1`);
await page.waitForFunction(() => window.__debug, null, { timeout: 60000 });
await page.evaluate(() => window.__debug.view.modelsReady);
await page.locator('.helpok').click({ timeout: 3000 }).catch(() => {});
let fails = 0;
const check = (name, ok, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };
const wait = ms => page.waitForTimeout(ms);
const sim = fn => page.evaluate(fn);
const place = (type, dist) => page.evaluate(([t, d]) => {
  const { view, sim } = window.__debug, p = sim.player;
  p.x = 0; p.z = 0; p.hp = p.maxHp = 1e9; view.yaw = 0; view.pitch = 0.5; view.distance = 10; sim.targetId = null;
  let id = null;
  sim.enemies.forEach((e, i) => { e.stagger = 1e9; if (e.type === t && id === null) { id = e.id; e.x = 0; e.z = -d; } else { e.x = 500 + i * 3; e.z = 500; } });
  return id;
}, [type, dist]);

// --- click: a near miss targets the enemy; a click far off does nothing at all (HOM-139: no click moves the player) ---
const wolf = await place('wolf', 14); await wait(500);
const spot = await page.evaluate(id => { const v = window.__debug.view, g = v.actors.get(id).group.position; const a = v.project(g.x, 0.6, g.z); return a; }, wolf);
await page.mouse.click(spot.x - 22, spot.y + 6);
await wait(200);
check('click 22px beside a wolf at 14u targets it', (await sim(() => window.__debug.sim.targetId)) === wolf);
await sim(() => { window.__debug.sim.targetId = null; });
const stood = await sim(() => ({ x: window.__debug.sim.player.x, z: window.__debug.sim.player.z }));
await page.mouse.click(spot.x + 150, spot.y + 150);
await wait(150);
check('click 150px away does not target it', (await sim(() => window.__debug.sim.targetId)) === null);
const moved = await sim(() => ({ x: window.__debug.sim.player.x, z: window.__debug.sim.player.z }));
check('...and it does not walk the player there either', Math.hypot(moved.x - stood.x, moved.z - stood.z) < 1e-6);

// --- precedence: the NPC / a node beside an enemy keeps the click ---
const brute = await place('brute', 14);
await sim(() => { const { sim } = window.__debug; sim.player.x = 0; sim.player.z = 0; });
const npc = await page.evaluate(() => { const v = window.__debug.view; return v.project(window.__debug.sim.player.x, 0, 0); });
// put the wolf on top of the Warden on screen: click the Warden's body, an enemy standing right behind him must not win
const { NPCX, NPCZ } = await sim(() => ({ NPCX: window.__debug.view.npcGroup.position.x, NPCZ: window.__debug.view.npcGroup.position.z }));
await page.evaluate(([x, z]) => { const { sim, view } = window.__debug; sim.player.x = x; sim.player.z = z + 8; view.yaw = 0; sim.targetId = null; const e = sim.enemies.find(e => e.type === 'wolf'); e.x = x + 1.2; e.z = z - 0.5; }, [NPCX, NPCZ]);
await wait(500);
const w = await page.evaluate(([x, z]) => window.__debug.view.project(x, 1.0, z), [NPCX, NPCZ]);
await page.screenshot({ path: join(out, 'npc-with-wolf-beside.png') });
await page.mouse.click(w.x, w.y);
await wait(200);
const hasTarget = await sim(() => window.__debug.sim.targetId);
check('clicking the Warden (wolf standing beside him) talks, not targets', hasTarget === null);

// --- jump (fresh page: the Warden click above left the player walking to him) ---
await page.reload();
await page.waitForFunction(() => window.__debug, null, { timeout: 60000 });
await page.evaluate(() => window.__debug.view.modelsReady);
await page.locator('.helpok').click({ timeout: 3000 }).catch(() => {});
await place('wolf', 30);
await page.evaluate(() => { const { sim } = window.__debug; sim.player.x = 0; sim.player.z = 0; document.activeElement?.blur?.(); });
await wait(200);
await page.keyboard.down('Space');
await wait(120);
check('Space on keydown puts the player in the air', await sim(() => window.__debug.sim.player.airborne));
const ys = [];
for (let i = 0; i < 14; i++) { ys.push(await sim(() => window.__debug.sim.player.y)); await wait(50); }
check('jump arc peaks near 1.3u', Math.max(...ys) > 1 && Math.max(...ys) < 1.6, `peak ${Math.max(...ys).toFixed(2)}`);
await page.keyboard.up('Space');
await wait(1500);
check('lands and stays on the ground after release', !(await sim(() => window.__debug.sim.player.airborne)));
check('page did not scroll', (await sim(() => scrollY)) === 0);
await page.keyboard.press('Space'); // a tap, down and up within a tick
await wait(250);
check('a quick tap still jumps', await sim(() => window.__debug.sim.player.airborne || window.__debug.sim.player.y > 0 || window.__debug.sim.events.some(e => e.t === 'jump') ), `y=${await sim(() => window.__debug.sim.player.y)}`);
await wait(1000);
await page.keyboard.press('KeyH'); // help overlay open
await page.keyboard.down('Space'); await wait(150);
check('Space does nothing while the help screen is open', !(await sim(() => window.__debug.sim.player.airborne)));
await page.keyboard.up('Space');
await page.keyboard.press('KeyH'); await wait(100);

// --- swing bar, auto-attack, floaters ---
const boar = await place('boar', 2.5);
await sim(() => { const e = window.__debug.sim.enemies.find(e => e.type === 'boar'); e.stagger = 0; e.maxHp = e.hp = 1e9; });
await page.mouse.move(640, 300);
await page.keyboard.press('KeyR');
await wait(300);
const shotBar = async name => { await page.screenshot({ path: join(out, name) }); };
check('R arms auto-attack', await sim(() => window.__debug.sim.player.autoAttack));
check('swing bar is lit', await page.evaluate(() => document.querySelector('.swing').classList.contains('on')));
await wait(1100); await shotBar('swing-bar-armed.png');
await wait(5000);
const fl = await page.evaluate(() => { const bar = document.querySelector('.actionbar').getBoundingClientRect(); return [...document.querySelectorAll('.floater')].map(f => f.getBoundingClientRect()).filter(r => r.bottom > bar.top - 2 && r.top < bar.bottom && r.right > bar.left && r.left < bar.right).length; });
check('no floating number sits on the action bar', fl === 0, `${fl} overlapping`);
await page.keyboard.press('KeyR'); await wait(200);
check('R again disarms', !(await sim(() => window.__debug.sim.player.autoAttack)));
await shotBar('swing-bar-off.png');
await browser.close(); await server.close();
process.exit(fails ? 1 : 0);
