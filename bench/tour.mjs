// HOM-183 / HOM-173: how long is a lap of the five towns? docs/combat-99.md 7.2 prices the writ economy on "29 minutes of flights and walking between five towns", an assumption nobody had timed.
// The lap: stand at Hale's board, walk to Hale's flight master, fly to Saltmarrow, walk landing -> board -> master, fly on to Thornwick, Highmoor, the Spire, and (the closed lap) fly home and
// walk to Hale's board. Walked on the keys, the camera turned to the goal, through the real sim step; flown by the sim's own startFlight, which is paid in full and cannot be cut short.
// The board stop is the sim's own `boardNear` (what the E key needs) and the master stop its `masterNear`, so a walk ends where a hand-in and a ride can start.
//   node bench/tour.mjs [--sprint] [--dwell 15] [--port 4176] [--skip-build]
// --sprint holds Shift on the whole walk (it stops mattering when the stamina meter runs dry, and the walk then carries on at a jog); --dwell S is the seconds a hand-in and a pick-up at a board and a
// click at the flight master take (the bench does not press the panels, so it is a number you choose): the report prints the lap without it and with it. Writes bench/shots/tour.json.
import { build, preview } from 'vite';
import { launchBrowser } from './browser.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const opt = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
const port = Number(opt('port', 4176)), dwell = Number(opt('dwell', 15)), sprint = process.argv.includes('--sprint');
const shots = join(root, 'bench', 'shots'); mkdirSync(shots, { recursive: true });

function lap(cfg) {
  const d = window.__debug, s = d.sim, p = s.player, view = d.view, L = d.world.LANDMARKS;
  const TOWNS = [['hale', 'boardHale', 'flightHale'], ['saltmarrow', 'boardSalt', 'flightSalt'], ['thornwick', 'boardThorn', 'flightThorn'], ['highmoor', 'boardHigh', 'flightHigh'], ['spire', 'boardSpire', 'flightSpire']];
  const held = new Set();
  const hold = (code, on) => { if (held.has(code) === on) return; on ? held.add(code) : held.delete(code); window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code })); };
  const secs = t0 => (s.tick - t0) / 30;
  /** Walk on the keys until `done()`: straight at the goal, and when it stops getting anywhere (a house, a well) 1.5 s of a turn to one side, the other side next time. */
  const walk = (goal, done) => {
    const t0 = s.tick; let turn = 0, turnUntil = 0, side = 1, lx = p.x, lz = p.z, lt = s.tick;
    while (!done()) {
      if (s.tick - t0 > 120 * 30) throw new Error(`walk to (${goal.x.toFixed(0)}, ${goal.z.toFixed(0)}) took over 120 s: stuck at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
      if (s.tick - lt >= 15) { if (Math.hypot(p.x - lx, p.z - lz) < 1.2 && s.tick >= turnUntil) { turn = side * (Math.PI / 2.2); side = -side; turnUntil = s.tick + 45; } lx = p.x; lz = p.z; lt = s.tick; }
      if (s.tick >= turnUntil) turn = 0;
      view.yaw = Math.atan2(-(goal.x - p.x), -(goal.z - p.z)) + turn;
      hold('KeyW', true); if (cfg.sprint) hold('ShiftLeft', true);
      d.step();
    }
    hold('KeyW', false); hold('ShiftLeft', false); d.step();
    return secs(t0);
  };
  const fly = to => {
    const t0 = s.tick; d.bench.flyTo(to);
    if (p.action?.k !== 'flight') throw new Error(`flight to ${to} did not start from ${d.bench.masterNear()}: ${JSON.stringify(s.events.filter(e => e.t === 'actionfail'))} found ${s.found} gold ${p.gold} inCombat ${p.inCombat} dead ${p.dead}`);
    while (p.action?.k === 'flight') d.step();
    return secs(t0);
  };
  for (const o of s.enemies) { o.state = 'dead'; o.respawnIn = 1e9; o.deadFor = 99; o.cast = null; } // a town's own road is safe, a lap is not timing a fight: nothing in the world is awake
  p.outOfCombat = 99; p.gold = 999999; for (const [id] of TOWNS) if (!s.found.includes(id)) s.found.push(id);
  p.x = L.boardHale.x + 2; p.z = L.boardHale.z + 2; p.dead = false; p.inCombat = false; for (let i = 0; i < 5; i++) d.step();
  const legs = [];
  const leg = (kind, town, seconds) => legs.push({ kind, town, seconds: +seconds.toFixed(1) });
  const order = [...TOWNS, TOWNS[0]];
  for (let i = 0; i < order.length; i++) {
    const [id, boardKey, flightKey] = order[i];
    if (i > 0) leg('walk to board', id, walk(L[boardKey], () => d.bench.boardNear() === id)); // landed: to the board
    if (i === order.length - 1) break;
    leg('walk to flight master', id, walk(L[flightKey], () => d.bench.masterNear() === id));
    const next = order[i + 1][0]; leg('flight', `${id} -> ${next}`, fly(next));
  }
  const sum = k => legs.filter(l => l.kind.startsWith(k)).reduce((a, l) => a + l.seconds, 0);
  return { legs, flight: sum('flight'), walk: sum('walk'), total: sum('flight') + sum('walk'), fares: 999999 - p.gold };
}

if (!process.argv.includes('--skip-build')) await build({ root, logLevel: 'warn' });
const server = await preview({ root, logLevel: 'error', preview: { port, open: false } });
const browser = await launchBrowser({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.error('pageerror', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}?debug=1`);
await page.waitForFunction(() => window.__debug, null, { timeout: 120000 });
await page.evaluate(() => window.__debug.view.modelsReady);
await page.locator('.helpok').click({ timeout: 3000 }).catch(() => {});
const r = await page.evaluate(lap, { sprint });
await browser.close(); await server.close();
const min = x => `${(x / 60).toFixed(1)} min`;
console.table(r.legs);
const open = r.legs.slice(0, -2); // the lap without the flight home and the walk to Hale's board
const openTotal = open.reduce((a, l) => a + l.seconds, 0), boards = 5, clicks = r.legs.filter(l => l.kind === 'flight').length;
console.log(`lap (${sprint ? 'sprinting' : 'on foot'}): flights ${r.flight.toFixed(0)} s, walking ${r.walk.toFixed(0)} s, moving total ${r.total.toFixed(0)} s = ${min(r.total)}`);
console.log(`  with ${dwell} s at each of ${boards} boards and ${clicks} flight masters: ${min(r.total + dwell * (boards + clicks))}`);
console.log(`  the five fares of the closed lap: ${r.fares} gold`);
console.log(`  open tour (Hale to the Spire, no flight home): ${openTotal.toFixed(0)} s = ${min(openTotal)}; the bible assumed 29 minutes`);
writeFileSync(join(shots, 'tour.json'), JSON.stringify({ sprint, dwell, ...r }, null, 1));
process.exit(0);
