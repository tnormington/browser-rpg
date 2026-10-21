// Motion contact sheets: serves the existing dist/ (run `npm run build` first), stages one combat moment through the real
// sim + renderer path, and screenshots a burst of frames across it.
//   node bench/anim.mjs <out-name> <scenario> [scenario ...]    -> bench/shots/<out-name>/<scenario>-<n>.png
// scenarios: swing hit-boar hit-wolf hit-brute hit-player death-wolf death-boar jump telegraph-brute telegraph-hexer enemy-lunge
import { preview } from 'vite';
import { launchBrowser } from './browser.mjs';
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [name, ...scenarios] = process.argv.slice(2);
const out = join(root, 'bench', 'shots', name);
mkdirSync(out, { recursive: true });
const server = await preview({ root, logLevel: 'error', preview: { port: 4175, open: false } });
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', e => console.error('pageerror', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}?debug=1`);
await page.waitForFunction(() => window.__debug, null, { timeout: 60000 });
await page.evaluate(() => window.__debug.view.modelsReady);
await page.locator('.helpok').click({ timeout: 3000 }).catch(() => {});
// GEAR='{"weapon":"steel_sword","head":"iron_helm",...}' dresses the player before staging, to check worn gear through a motion
if (process.env.GEAR) await page.evaluate(g => Object.assign(window.__debug.sim.player.equipment, JSON.parse(g)), process.env.GEAR);
await page.addScriptTag({ content: `
  window.__home = { x: window.__debug.sim.player.x, z: window.__debug.sim.player.z };
  document.querySelectorAll("body > :not(canvas)").forEach(n => { n.style.visibility = "hidden"; });
  window.wait = ms => new Promise(r => setTimeout(r, ms));
  // park the player and one enemy of a type face to face on open ground, camera low and to the side
  window.stage = (type, gap = 2.0) => {
    const d = window.__debug, s = d.sim, p = s.player, e = s.enemies.find(e => e.type === type);
    const x = window.__home.x - 3, z = window.__home.z + 2; for (const o of s.enemies) if (o !== e) { o.x = 900; o.z = 900; o.spawnX = 900; o.spawnZ = 900; o.state = 'idle'; }
    s.targetId = null; p.autoAttack = false; p.swing = 0; p.equipment.weapon = 'steel_sword'; p.x = x; p.z = z; p.facing = Math.PI / 2; p.hp = p.stats.maxHp; p.dead = false;
    e.x = x + gap; e.z = z; e.facing = -Math.PI / 2; e.hp = e.maxHp; e.state = 'idle'; e.attackCd = 99; e.heavyCd = 99; e.spawnX = e.x; e.spawnZ = e.z;
    d.step(); d.step();
    window.__e = e;
    return e;
  };
  window.frame = (gap, h = 1.2, back = 5.5, dx = 2.2) => {
    const v = window.__debug.view, e = window.__e, p = window.__debug.sim.player;
    v.debugCam = { pos: [p.x + gap / 2 + dx, h + 0.4, p.z + back], at: [p.x + gap / 2 + dx, h, p.z] };
  };` });

const shots = [];
const burst = async (label, n, gapMs, clip) => {
  shots.push(label);
  for (let i = 0; i < n; i++) {
    await page.screenshot({ path: join(out, `${label}-${String(i).padStart(2, '0')}.jpg`), type: 'jpeg', quality: 80, clip });
    await page.waitForTimeout(gapMs);
  }
};
// scrub:<who>:<clip>:<t0>:<t1>:<n>  freeze a clip at n times between t0 and t1 (who = player or an enemy type): for reading a clip
const scrub = async (who, clip, t0, t1, n) => {
  await page.evaluate(([who]) => { stage(who === 'player' ? 'boar' : who, 6); frame(6, 1.1, 5, 0); const v = window.__debug.view; v.debugCam.pos[0] = window.__debug.sim.player.x + 2.4; v.debugCam.pos[2] -= 0; }, [who]);
  await page.waitForTimeout(300);
  for (let i = 0; i < n; i++) {
    const t = t0 + (t1 - t0) * (i / Math.max(1, n - 1));
    await page.evaluate(([who, clip, t]) => {
      const v = window.__debug.view, an = who === 'player' ? v.playerAnim : [...v.actors.values()].find(a => a.type === who).anim;
      for (const a of an.actions.values()) { a.stop(); }
      an.layer = null; an.holding = false;
      const act = an.actions.get(clip) ?? an.mixer.clipAction(an.clips.get(clip));
      act.reset().play(); act.time = t; act.paused = true; act.weight = 1; act.setEffectiveWeight(1);
      an.mixer.update(0);
    }, [who, clip, t]);
    await page.waitForTimeout(120);
    await page.screenshot({ path: join(out, `scrub-${clip}-${String(i).padStart(2, '0')}.jpg`), type: 'jpeg', quality: 80, clip: CLIP });
  }
  shots.push('scrub-' + clip);
};
// tell:<type>:<kind>:<json>[;<json>...]  hold a wind-up with TELLS[kind].bones set to each json in turn (tuning arm raises)
const tell = async (type, kind, variants) => {
  await page.evaluate(([type, kind]) => {
    const gap = type === 'hexer' ? 4 : 2.6; stage(type, gap); const e0 = window.__e, p0 = window.__debug.sim.player; window.__debug.view.debugCam = { pos: [e0.x - 0.5, 1.8, p0.z + 7.5], at: [e0.x - 0.5, 1.6, e0.z] };
    const e = window.__e; e.cast = { kind, t: 900, total: 1000 }; e.attackCd = 99;
  }, [type, kind]);
  for (let i = 0; i < variants.length; i++) {
    await page.evaluate(([kind, v]) => { Object.assign(window.__TELLS[kind].arms, JSON.parse(v)); }, [kind, variants[i]]);
    await page.evaluate(() => { window.__e.cast.t = 900; });
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(out, `tell-${type}-${kind}-${String(i).padStart(2, '0')}.jpg`), type: 'jpeg', quality: 80, clip: { x: 130, y: 20, width: 700, height: 500 } });
  }
  shots.push(`tell-${type}-${kind}`);
};
const CLIP = { x: 180, y: 60, width: 600, height: 400 };
const S = {
  async swing() {
    await page.evaluate(() => { stage('boar', 1.8); frame(1.8); });
    await page.waitForTimeout(300);
    await page.keyboard.press('r'); // arm auto-attack: the first swing lands this tick
    await burst('swing', 24, 70, CLIP);
    await page.keyboard.press('r');
  },
  async hit(type, gap = 1.8, h = 1.0) {
    await page.evaluate(([t, g, h]) => { stage(t, g); frame(g, h); }, [type, gap, h]);
    await page.waitForTimeout(300);
    await page.keyboard.press('r');
    await burst(`hit-${type}`, 10, 0, CLIP);
    console.error(type, 'hp', await page.evaluate(() => [window.__e.hp, window.__e.maxHp, window.__debug.sim.targetId, window.__e.id]));
    await page.keyboard.press('r');
  },
  async death(type, h = 0.8) {
    await page.evaluate(([t, h]) => { stage(t, 1.8); frame(1.8, h); window.__e.hp = 1; }, [type, h]);
    await page.waitForTimeout(300);
    await page.keyboard.press('r');
    await burst(`death-${type}`, 14, 90, CLIP);
    await page.keyboard.press('r');
  },
  async 'hit-player'() {
    await page.evaluate(() => { stage('boar', 1.8); frame(1.8, 1.2, 5.5, -0.9); const e = window.__e; e.attackCd = 0; });
    await burst('hit-player', 10, 70, CLIP);
  },
  async 'enemy-lunge'() {
    await page.evaluate(() => { stage('wolf', 1.8); frame(1.8); window.__e.attackCd = 0; });
    await burst('enemy-lunge', 10, 70, CLIP);
  },
  async jump() {
    await page.evaluate(() => { stage('boar', 8); frame(8, 1.2, 5.5, -2.5); });
    await page.waitForTimeout(300);
    await page.keyboard.down('Space');
    await burst('jump', 14, 60, CLIP);
    await page.keyboard.up('Space');
  },
  async telegraph(type, h = 1.4) {
    await page.evaluate(([t, h]) => {
      const gap = t === 'hexer' ? 4 : 2.6; stage(t, gap); frame(gap, h, t === 'hexer' ? 6 : 7);
      const e = window.__e; e.attackCd = 0; e.heavyCd = 0; e.cast = null;
    }, [type, h]);
    await burst(`telegraph-${type}`, 12, type === 'hexer' ? 90 : 180, { x: 130, y: 20, width: 700, height: 500 });
  },
};
for (const sc of scenarios) {
  if (sc.startsWith('tell:')) { const [, t, k, ...rest] = sc.split(':'); await tell(t, k, rest.join(':').split(';')); continue; }
  if (sc.startsWith('scrub:')) { const [, w, c, a, b, n] = sc.split(':'); await scrub(w, c, +a, +b, +n); continue; }
  if (sc === 'hit-boar') await S.hit('boar');
  else if (sc === 'hit-wolf') await S.hit('wolf');
  else if (sc === 'hit-brute') await S.hit('brute', 2.6, 1.4);
  else if (sc === 'death-wolf') await S.death('wolf');
  else if (sc === 'death-boar') await S.death('boar');
  else if (sc === 'telegraph-brute') await S.telegraph('brute');
  else if (sc === 'telegraph-hexer') await S.telegraph('hexer');
  else await S[sc]();
}
// contact sheets: one PNG per scenario, frames left to right, top to bottom, scaled down
const sheetPage = await browser.newPage({ viewport: { width: 1800, height: 600 } });
for (const label of shots) {
  const files = readdirSync(out).filter(f => f.startsWith(label + '-') && /-[0-9]+.jpg$/.test(f)).sort();
  const imgs = files.map(f => 'data:image/jpeg;base64,' + readFileSync(join(out, f)).toString('base64'));
  const rows = Math.ceil(files.length / 4);
  await sheetPage.setViewportSize({ width: 1800, height: Math.round(rows * 305) });
  await sheetPage.setContent('<body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(4,450px);gap:0">' + imgs.map((u, i) => '<div style="position:relative"><img style="width:450px;display:block" src="' + u + '"><b style="position:absolute;left:4px;top:2px;color:#ff0;font:12px monospace">' + i + '</b></div>').join('') + '</body>');
  await sheetPage.screenshot({ path: join(out, 'sheet-' + label + '.png') });
  for (const f of files) rmSync(join(out, f));
}
await browser.close(); await server.close();
console.error('wrote', out);
