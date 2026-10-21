// One GPU bench at a time, machine-wide.
//
// Every bench script here drives the game in a real Chromium with the GPU unblocked, and seven agents
// bench out of seven worktrees at once. Nothing used to stop all of them rendering at the same moment,
// which pins the human's GPU and makes every frame time measured during it a lie. So each script takes
// a slot from a lock directory in the OS temp dir (shared by every worktree and every process) before
// it launches, and gives it back when the browser closes.
//
//   BENCH_GPU_SLOTS    how many may render at once (default 1)
//   BENCH_GPU_WAIT_MS  how long to queue for a slot before giving up (default 20 min)
//
// Scripts that do not render the game (bench/music.mjs on a blank page, bench/sheet.mjs tiling PNGs)
// launch Chromium directly and do not take a slot.
import { chromium } from 'playwright';
import { closeSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, utimesSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const GPU_ARGS = ['--ignore-gpu-blocklist', '--use-angle=d3d11'];
// Timing benches only: uncapped frames are what makes a frame time mean something, and also what makes
// a stray bench cost a whole GPU. Screenshot scripts stay on the default ~60 Hz schedule.
export const UNCAPPED_ARGS = [...GPU_ARGS, '--disable-frame-rate-limit', '--disable-gpu-vsync'];

const DIR = process.env.BENCH_GPU_DIR ?? join(tmpdir(), 'browser-rpg-gpu');
const SLOTS = Math.max(1, Number(process.env.BENCH_GPU_SLOTS) || 1);
const WAIT_MS = Number(process.env.BENCH_GPU_WAIT_MS) || 20 * 60_000;
const STALE_MS = 3 * 60_000;  // a holder that has not touched its slot for this long was killed; take it
const BEAT_MS = 30_000;
const POLL_MS = 500;

// A slot is held if its file exists, was touched recently, and names a live process. Any of those
// failing means the holder died without cleaning up and the slot is free to take.
function held(file) {
  let st;
  try { st = statSync(file); } catch { return false; }
  if (Date.now() - st.mtimeMs > STALE_MS) return false;
  const pid = Number(readFileSync(file, 'utf8').trim());
  if (!pid) return true;  // still being written by the winner of the race below
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// 'wx' fails if the file exists, so exactly one process can win a free slot. On a hit, re-check that the
// holder is still dead before clearing it — between the check above and here someone else may have taken it.
function claim(file) {
  let fd = open(file);
  if (fd === null && !held(file)) {
    try { unlinkSync(file); } catch {}
    fd = open(file);
  }
  if (fd === null) return false;
  writeSync(fd, String(process.pid));
  closeSync(fd);
  return true;
}

function open(file) {
  try { return openSync(file, 'wx'); } catch { return null; }
}

/** Wait for one of the GPU slots, then hold it until `release()`. */
export async function acquireGpuSlot() {
  mkdirSync(DIR, { recursive: true });
  const deadline = Date.now() + WAIT_MS;
  let announced = false;
  for (;;) {
    for (let i = 0; i < SLOTS; i++) {
      const file = join(DIR, `slot-${i}`);
      if (!claim(file)) continue;
      // Keep the mtime fresh so a long bench is never mistaken for a dead one, and give the slot back
      // even if the script throws on its way to browser.close().
      const beat = setInterval(() => { try { utimesSync(file, new Date(), new Date()); } catch {} }, BEAT_MS);
      beat.unref();
      let done = false;
      const release = () => { if (done) return; done = true; clearInterval(beat); try { unlinkSync(file); } catch {} };
      process.once('exit', release);
      return { release };
    }
    if (Date.now() >= deadline) throw new Error(`bench: no GPU slot free after ${Math.round(WAIT_MS / 1000)}s (${SLOTS} in use, ${DIR})`);
    if (!announced) { console.error(`bench: waiting for a GPU slot — ${SLOTS} bench${SLOTS > 1 ? 'es are' : ' is'} already rendering`); announced = true; }
    await new Promise(r => setTimeout(r, POLL_MS));
  }
}

/** chromium.launch(), queued behind the GPU slots. The slot is released by browser.close(). */
export async function launchBrowser(options = {}) {
  const slot = await acquireGpuSlot();
  let browser;
  try { browser = await chromium.launch({ args: GPU_ARGS, ...options }); }
  catch (e) { slot.release(); throw e; }
  const close = browser.close.bind(browser);
  browser.close = async (...args) => { try { return await close(...args); } finally { slot.release(); } };
  return browser;
}
