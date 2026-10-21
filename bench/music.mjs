// The ambient music (src/music.ts) measured in real Chromium: each place's theme is run for a round and its level read off an
// analyser, so "it plays" and "it is quiet" are numbers and not an opinion. The tests in src/music.test.ts cover the tables;
// this covers the half that needs a real AudioContext.
//   node bench/music.mjs            (no build needed: it drives the playtest server, starting it if it is not up)
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(process.execPath, [join(root, 'scripts', 'dev-server.mjs'), 'ensure'], { stdio: 'inherit', windowsHide: true });
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
page.on('pageerror', e => console.error('pageerror', e.stack ?? String(e)));
// A blank page on the dev server's origin, not the game: in headless Chromium the game saturates the main thread and a
// 250 ms timer lands two and a half seconds late, which would make the sampling below meaningless as well as slow. The
// module still comes from the dev server, so this measures the shipped music and nothing else.
await page.route('http://localhost:5173/bench-music', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>music bench</title>' }));
await page.goto('http://localhost:5173/bench-music');

const SECONDS = 14;   // a round of the slowest theme is 19 s; this is long enough for a chord and a line in every one
const places = ['clearing', 'greywater', 'saltmarrow', 'dunmere', 'thornwick', 'barrowdowns', 'highmoor', 'hollow', 'grottoghost'];
const rows = await page.evaluate(async ([places, seconds]) => {
  const { Music, themeFor } = await import('/src/music.ts');
  const ctx = new AudioContext();
  await ctx.resume();
  const an = ctx.createAnalyser();
  an.fftSize = 2048;
  const hush = ctx.createGain();
  hush.gain.value = 0;   // measured, never heard: the bench is not a speaker
  an.connect(hush).connect(ctx.destination);
  const music = new Music(ctx, an);
  const buf = new Float32Array(an.fftSize);
  const peak = () => { an.getFloatTimeDomainData(buf); let p = 0; for (const v of buf) p = Math.max(p, Math.abs(v)); return p; };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const out = [];
  for (const region of places) {
    music.set(region);
    const seen = [];
    for (let i = 0; i < seconds * 4; i++) { await wait(250); seen.push(peak()); }
    out.push({ region, theme: themeFor(region), peak: Math.max(...seen), mean: seen.reduce((a, b) => a + b, 0) / seen.length, silent: seen.filter(v => v < 1e-4).length / seen.length });
  }
  music.stop();
  await wait(4000);
  return { out, after: peak() };
}, [places, SECONDS]);

const fail = m => { console.error(`FAIL: ${m}`); process.exitCode = 1; };
console.table(rows.out.map(r => ({ ...r, peak: r.peak.toFixed(4), mean: r.mean.toFixed(4), silent: `${Math.round(r.silent * 100)}%` })));
for (const r of rows.out) {
  if (r.peak < 0.01) fail(`${r.region} (${r.theme}) never sounded: peak ${r.peak}`);
  if (r.peak > 0.5) fail(`${r.region} (${r.theme}) is too loud under the ambience bed: peak ${r.peak}`);
  if (r.silent > 0.5) fail(`${r.region} (${r.theme}) is silent ${Math.round(r.silent * 100)}% of the time`);
}
if (new Set(rows.out.map(r => r.theme)).size !== 8) fail(`nine places should name eight themes, got ${new Set(rows.out.map(r => r.theme)).size}`);
console.log(`after stop(): ${rows.after.toFixed(5)}`);
if (rows.after > 1e-3) fail(`stop() left something sounding: ${rows.after}`);
if (!process.exitCode) console.log('music bench ok');
await browser.close();
