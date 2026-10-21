// The GPU slot limiter in bench/browser.mjs, without launching a browser.  node bench/browser.test.mjs
import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'gpu-slot-test-'));
process.env.BENCH_GPU_DIR = dir;
process.env.BENCH_GPU_SLOTS = '1';
process.env.BENCH_GPU_WAIT_MS = '5000';
const { acquireGpuSlot } = await import('./browser.mjs');

const slot = join(dir, 'slot-0');
const ok = (cond, what) => { if (!cond) { console.error(`FAIL ${what}`); process.exitCode = 1; } else console.log(`ok   ${what}`); };
const settled = p => { let done = false; p.then(() => (done = true)); return () => done; };
const tick = ms => new Promise(r => setTimeout(r, ms));

// One slot: the second caller queues until the first gives it back.
const first = await acquireGpuSlot();
ok(existsSync(slot), 'holding a slot writes the slot file');

const second = acquireGpuSlot();
const secondDone = settled(second);
await tick(1200);
ok(!secondDone(), 'a second bench waits while the slot is held');

first.release();
ok(!existsSync(slot), 'releasing removes the slot file');
const got = await second;
ok(existsSync(slot), 'the waiting bench takes the slot once it is free');
got.release();

// A bench killed mid-run leaves its file behind; the next one must not queue behind a dead holder.
writeFileSync(slot, '999999999');
const old = new Date(Date.now() - 10 * 60_000);
utimesSync(slot, old, old);
const after = await Promise.race([acquireGpuSlot(), tick(3000).then(() => null)]);
ok(after !== null, 'a stale slot left by a killed bench is reclaimed');
after?.release();

// Two slots means two at once.
rmSync(dir, { recursive: true, force: true });
process.env.BENCH_GPU_SLOTS = '2';
const two = await import(`./browser.mjs?slots=2`);
const a = await two.acquireGpuSlot(), b = await Promise.race([two.acquireGpuSlot(), tick(3000).then(() => null)]);
ok(b !== null, 'BENCH_GPU_SLOTS=2 lets two benches render at once');
a.release(); b?.release();
const third = await Promise.race([two.acquireGpuSlot(), tick(1500).then(() => null)]);
ok(third !== null, 'slots are reusable after release');
third?.release();

rmSync(dir, { recursive: true, force: true });
console.log(process.exitCode ? 'gpu slot limiter: FAILED' : 'gpu slot limiter: all ok');
