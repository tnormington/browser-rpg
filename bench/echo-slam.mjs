// HOM-178: does the Echo slam (docs/combat-99.md 3.6, level 70 and up, 1.7 s) read on a rig that never swung one?
// Every melee trash row is dressed as its Echo at LEVEL and left to start the slam itself through the real sim; frames are taken across the wind-up
// and the landing, from the side (the pose) and from the game's own camera (what a player at play distance has to read).
//   node bench/echo-slam.mjs <out-name> [type ...]      env: LEVEL=75, SHOTS=7, PER_SHEET=5
// writes bench/shots/<out-name>/sheet-<side|play>-<n>.png, one row a rig, one column a moment (0 .. 1.7 s, then the landing)
import { createServer } from 'vite';
import { launchBrowser } from './browser.mjs';
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [name, ...only] = process.argv.slice(2);
const GROUND = process.env.MODE === 'ground'; // the 56 rung: the mark under the player instead of the 70 rung's slam
const LEVEL = +(process.env.LEVEL ?? (GROUND ? 60 : 75)), WIND_KIND = GROUND ? 'ground' : 'heavy', SHOTS = +(process.env.SHOTS ?? 7), PER_SHEET = +(process.env.PER_SHEET ?? 5);
const out = join(root, 'bench', 'shots', name);
mkdirSync(out, { recursive: true });
const server = await createServer({ root, logLevel: 'error', server: { port: 5199, strictPort: false, open: false } });
await server.listen();
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', e => console.error('pageerror', e.stack ?? String(e)));
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&weather=clear`);
await page.waitForFunction(() => window.__debug, null, { timeout: 60000 });
await page.evaluate(() => window.__debug.view.modelsReady);
await page.locator('.helpok').click({ timeout: 3000 }).catch(() => {});
await page.addScriptTag({ content: `
  window.__home = { x: window.__debug.sim.player.x, z: window.__debug.sim.player.z };
  document.querySelectorAll("body > :not(canvas)").forEach(n => { n.style.visibility = "hidden"; });` });
await page.clock.install();
await page.clock.pauseAt(new Date(Date.now() + 2000));
const adv = ms => page.clock.runFor(ms);
await adv(15000);
await page.keyboard.press('Escape');

// every melee trash row: no bolt (it does not slam), and no slam of its own (MODE=ground takes every row without a mark of its own, casters too)
const types = only.length ? only : await page.evaluate(async ground => {
  const { ENEMY_TYPES } = await import('/src/sim/data.ts');
  const { ROLES } = await import('/src/sim/echo.ts');
  return Object.entries(ROLES).filter(([id, role]) => role === 'trash' && (ground || !ENEMY_TYPES[id].ranged) && !ENEMY_TYPES[id].heavy && !(ground && ENEMY_TYPES[id].hazard)).map(([id]) => id);
});
console.error(types.length, 'rigs:', types.join(' '));

const CLIP = { x: 130, y: 20, width: 700, height: 500 };
const WIND = GROUND ? 1.2 : 1.7;
// one rig, one camera: staged face to face, dressed as the Echo, then left alone to begin its own slam
async function run(type, cam) {
  const info = await page.evaluate(async ([type, cam, level, ground]) => {
    const { ENEMY_TYPES } = await import('/src/sim/data.ts');
    const { echoRow } = await import('/src/sim/echo.ts');
    const d = window.__debug, s = d.sim, p = s.player, e = s.enemies.find(e => e.type === type), def = ENEMY_TYPES[type];
    if (!e) throw new Error('no enemy of type ' + type);
    for (const o of s.enemies) if (o !== e) { o.x = 900; o.z = 900; o.spawnX = 900; o.spawnZ = 900; o.state = 'idle'; }
    const x = window.__home.x - 3, z = window.__home.z + 2, gap = Math.max(1.6, def.attackRange * 0.9);
    s.targetId = null; p.autoAttack = false; p.swing = 0; p.x = x; p.z = z; p.facing = Math.PI / 2; p.dead = false;
    e.x = x + gap; e.z = z; e.facing = -Math.PI / 2; e.spawnX = e.x; e.spawnZ = e.z;
    e.echo = level; e.row = echoRow(def, level); e.maxHp = e.hp = e.row.hp;
    p.hp = p.stats.maxHp = 1e6;
    e.state = 'chase'; e.attackCd = ground ? 99 : 0; e.heavyCd = ground ? 99 : 0; e.sweepCd = 99; e.hazardCd = ground ? 0 : 99; e.cast = null;
    d.view.snapshot(s); d.view.snapshot(s);
    window.__e = e;
    const r = def.radius;
    if (cam === 'side') d.view.debugCam = { pos: [x + gap / 2 + 0.2, 0.5 + 0.9 * r, z + 3.4 + 2.4 * r], at: [x + gap / 2 + 0.2, 0.4 + 0.8 * r, z] };
    else { d.view.debugCam = null; d.view.yaw = Math.PI / 2 * 0 + 0; d.view.pitch = 0.45; d.view.distance = 11; }
    const tell = ground ? e.row.hazard : e.row.heavy;
    return { radius: r, windup: tell.windup, tellRadius: tell.radius, damage: tell.damage };
  }, [type, cam, LEVEL, GROUND]);
  await adv(60);
  const started = await page.evaluate(() => window.__e.cast?.kind ?? null);
  if (started !== WIND_KIND) console.error(type, cam, 'DID NOT START a ' + WIND_KIND + ' cast:', started);
  const step = WIND / (SHOTS - 2); // SHOTS-1 frames across the wind-up, one after the landing
  for (let i = 0; i < SHOTS; i++) {
    await new Promise(r => setTimeout(r, 60));
    await page.screenshot({ path: join(out, `${type}-${cam}-${String(i).padStart(2, '0')}.jpg`), type: 'jpeg', quality: 78, clip: CLIP });
    if (process.env.PROBE) console.error(type, cam, i, JSON.stringify(await page.evaluate(() => ({ cast: window.__e.cast && { ...window.__e.cast }, state: window.__e.state }))));
    await adv(i === SHOTS - 2 ? step * 1000 + 160 : step * 1000); // the last gap runs past the landing
  }
  await adv(1500);
  return info;
}

const done = { side: [], play: [] };
for (const type of types) for (const cam of ['side', 'play']) {
  const info = await run(type, cam);
  done[cam].push(type);
  if (cam === 'side') console.error(type.padEnd(16), JSON.stringify(info));
}

// contact sheets: PER_SHEET rigs a sheet, one row each
const sheetPage = await browser.newPage({ viewport: { width: 1800, height: 600 } });
for (const cam of ['side', 'play']) {
  for (let g = 0; g * PER_SHEET < done[cam].length; g++) {
    const group = done[cam].slice(g * PER_SHEET, (g + 1) * PER_SHEET), w = Math.floor(1820 / SHOTS), h = Math.round(w * CLIP.height / CLIP.width);
    const rows = group.map(type => '<div style="display:flex;position:relative">' + readdirSync(out).filter(f => f.startsWith(`${type}-${cam}-`)).sort()
      .map(f => `<img style="width:${w}px;display:block" src="data:image/jpeg;base64,${readFileSync(join(out, f)).toString('base64')}">`).join('')
      + `<b style="position:absolute;left:4px;top:2px;color:#ff0;font:14px monospace">${type}</b></div>`);
    await sheetPage.setViewportSize({ width: w * SHOTS, height: h * group.length });
    await sheetPage.setContent('<body style="margin:0;background:#000">' + rows.join('') + '</body>');
    await sheetPage.screenshot({ path: join(out, `sheet-${cam}-${g}.png`) });
  }
}
if (!process.env.KEEP) for (const f of readdirSync(out)) if (f.endsWith('.jpg')) rmSync(join(out, f));
await browser.close(); await server.close();
console.error('wrote', out);

