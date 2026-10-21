// The playtest server: one vite dev server on a fixed port, serving the main checkout's source.
// Vite watches the files, so once it is up every landed change is live on the next reload — the job
// here is only to make sure it is up, and to say so loudly when what it serves no longer compiles.
//
//   node scripts/dev-server.mjs ensure    start it if it is not already answering (the one to run after landing work)
//   node scripts/dev-server.mjs status    report whether it answers, and whether what it serves compiles
//   node scripts/dev-server.mjs restart   kill whatever holds the port and start a fresh one
//   node scripts/dev-server.mjs stop      kill whatever holds the port
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, openSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 5173;
const BASE = `http://localhost:${PORT}`;
const here = dirname(dirname(fileURLToPath(import.meta.url)));

// Agents work in git worktrees; the human plays the main checkout, so that is the one we serve.
const root = (() => {
  try {
    const gitDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: here, encoding: 'utf8', windowsHide: true }).trim();
    return basename(gitDir) === '.git' ? dirname(gitDir) : here;
  } catch { return here; }
})();

// windowsHide matters here: the post-commit hook runs this script with no console of its own, so a
// console child without it makes Windows allocate a fresh console — a Windows Terminal window that
// flashes on the human's screen every time an agent commits.
const quiet = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8', windowsHide: true }); } catch { return ''; } };

// strictPort means at most one server owns the port, so whoever listens on it is the playtest server.
const portOwner = () => {
  if (process.platform === 'win32') {
    for (const line of quiet('netstat', ['-ano']).split('\n')) {
      const [, local, , state, pid] = line.trim().split(/\s+/);
      if (state === 'LISTENING' && local?.endsWith(`:${PORT}`)) return Number(pid);
    }
    return null;
  }
  const pid = Number(quiet('lsof', ['-ti', `tcp:${PORT}`, '-sTCP:LISTEN']).split('\n')[0]);
  return pid || null;
};

const get = async path => {
  try {
    const res = await fetch(BASE + path, { signal: AbortSignal.timeout(5000) });
    return { status: res.status, body: await res.text() };
  } catch { return null; }
};

// "up" is answering at all; "healthy" is the entry point still compiling — vite answers 500 with the error when it does not.
const probe = async () => {
  if (!(await get('/'))) return { up: false };
  const entry = await get('/src/main.ts');
  if (entry?.status === 200) return { up: true, healthy: true };
  return { up: true, healthy: false, error: (entry?.body ?? 'no answer for /src/main.ts').trim().split('\n')[0] };
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

const stop = () => {
  const pid = portOwner();
  if (pid) { try { process.kill(pid); } catch { /* already gone */ } }
  return pid;
};

const start = async () => {
  const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!existsSync(vite)) {
    console.error(`cannot start: ${vite} is missing — run npm install in ${root}`);
    process.exitCode = 1;
    return { up: false };
  }
  const out = openSync(join(root, 'dev-server.log'), 'a');
  const err = openSync(join(root, 'dev-server.err.log'), 'a');
  const child = spawn(process.execPath, [vite, '--port', String(PORT), '--strictPort'], {
    cwd: root, detached: true, stdio: ['ignore', out, err], windowsHide: true,
  });
  child.unref();
  for (const until = Date.now() + 40_000; Date.now() < until;) {
    const state = await probe();
    if (state.up) return state;
    await sleep(500);
  }
  return { up: false };
};

const report = state => {
  if (!state.up) {
    console.error(`playtest server is DOWN — ${BASE} does not answer (see dev-server.err.log)`);
    process.exitCode = 1;
  } else if (!state.healthy) {
    console.error(`playtest server is up at ${BASE} but src/main.ts does not compile: ${state.error}`);
    process.exitCode = 1;
  } else {
    console.log(`playtest server is live at ${BASE}`);
  }
};

const command = process.argv[2] ?? 'ensure';
if (command === 'stop') {
  const pid = stop();
  console.log(pid ? `stopped the playtest server (pid ${pid})` : `nothing was listening on ${BASE}`);
} else if (command === 'status') {
  report(await probe());
} else if (command === 'ensure' || command === 'restart') {
  if (command === 'restart') { stop(); await sleep(1000); }
  let state = await probe();
  if (!state.up) {
    console.log(`starting the playtest server on ${BASE} (serving ${root})`);
    state = await start();
  }
  report(state);
} else {
  console.error(`unknown command "${command}" — expected ensure, status, restart or stop`);
  process.exitCode = 1;
}
