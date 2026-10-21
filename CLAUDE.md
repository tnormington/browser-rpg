# browser-rpg

## Run everything through PowerShell

Every command in this repo goes through the **PowerShell** tool. Do not reach for bash first: the
Bash tool's PATH is a stub, so `node`, `npm`, `npx`, `tsx` — and even `sleep` — all come back as
`command not found`. Nothing this file documents can run there, so a bash attempt costs a tool call
and teaches you nothing. Committing from bash is worse than slow: git fires the `post-commit` hook,
the hook cannot find `node` either, and the playtest-server check silently never runs.

It is Windows PowerShell 5.1, so the bash reflexes do not carry over:

    a && b              a; if ($?) { b }          `&&` and `||` are a parse error
    $VAR                $env:VAR
    VAR=x node y.mjs    $env:VAR='x'; node y.mjs
    2>/dev/null         2>$null
    curl ...            curl.exe ...              bare `curl` is an alias for Invoke-WebRequest

The human is sitting at this machine, so nothing you run may throw a console window onto their
screen. Commands go in the PowerShell tool, and long jobs go in its background mode. `Start-Process`
opens a visible window unless you pass `-NoNewWindow`, and so do `cmd /c start` and a `.bat` wrapper
— none of them belong in a task.

The same applies to code you write. **Every `child_process` call in this repo passes
`windowsHide: true`** — `spawn`, `exec`, `execFileSync`, all of them. Without it a console child
inherits its parent's console, which is invisible right up until the parent has none: scripts run
from the `post-commit` hook have no console, so Windows gives the child a fresh one and hands it to
Windows Terminal — a window that flashes on the human's screen. `windowsHide` on a parent that
already has a console is a harmless no-op, so there is never a reason to leave it off.

## The playtest server

The game is played at **http://localhost:5173**, served by a vite dev server running against the
main checkout (`browser-rpg/`, on `master`). Vite watches the source, so anything that lands on
`master` is live on the next reload — there is no separate build step to run. `dist/` is only ever
built by the benches in `bench/`; it is not what the human plays.

**Before you report a task done, run `npm run dev:ensure`** and confirm it prints `playtest server
is live`. It starts the server if it is not answering, and fails if the entry point no longer
compiles — meaning the thing the human would open is broken.

    npm run dev:ensure     start it if it is not already up, and check what it serves compiles
    npm run dev:status     just check, never start
    npm run dev:restart    kill whatever holds 5173 and start fresh

Run it from any worktree: the script always serves the main checkout, never the worktree it is
invoked from, because that is what the human has open.

A `post-commit` hook runs `dev:ensure` in the background as a safety net. Enable it once per clone
with `git config core.hooksPath .githooks`; it never blocks or delays a commit.

Work in a `wt/*` worktree is not playable until it lands on `master` in the main checkout.

## Benching without flattening the human's GPU

Every bench in `bench/` drives the game in a real Chromium with the GPU unblocked, and seven agents
bench out of seven worktrees at the same time. All of them rendering at once pins the machine the
human is playing on, and makes every frame time measured during it meaningless.

So a bench does not call `chromium.launch()` itself. It imports from `bench/browser.mjs`:

    import { launchBrowser } from './browser.mjs';
    const browser = await launchBrowser({ headless: true });   // queues until a GPU slot is free

`launchBrowser` takes one of a fixed number of slots from a lock directory in the OS temp dir —
shared by every worktree and every process on the machine — and gives it back when `browser.close()`
runs, or when the process exits if it never got that far. A bench that is killed leaves a slot behind
for at most three minutes. Default args are `GPU_ARGS`; pass `args: UNCAPPED_ARGS` only when the
script is measuring frame time, because uncapped frames are most of the cost.

    $env:BENCH_GPU_SLOTS=2; node bench/look.mjs ...   allow two at once (default 1)
    $env:BENCH_GPU_WAIT_MS=...                        how long to queue before giving up (default 20 min)

**A new bench script must go through `launchBrowser`** — a script that calls `chromium.launch()`
directly is outside the limit and is the one that will be rendering while everything else waits.
`bench/music.mjs` and `bench/sheet.mjs` are the exceptions: neither renders the game, so neither
takes a slot. `node bench/browser.test.mjs` (part of `npm run verify`) covers the limiter.

## The admin panel (QA)

The playtest server is a dev build, so the game always has the QA panel: the **Admin** button in the
bottom-left corner, or the **`** key. It sets your combat level, teleports you to any town or region,
and puts any item in your bag — which is how a late-game fight, gate or recipe is reached without
playing up to it. Levelling up through it hands over the abilities and the talent points the level
owes, so a jumped-to character is the character, not a stand-in.

It is dev tooling: a build the human downloads has no panel, no button and no key, because main.ts
only wires it up behind the same `?debug=1` flag that `window.__debug` sits behind. The rules it uses
are in `src/sim/admin.ts` (pure sim, like every other action) and the panel in `src/admin-ui.ts`.

## Reaching the remote

Plain `git fetch`/`push` has no credentials and fails with `could not read Username for
'https://github.com'`. Credentials are minted per-operation by a launcher shim, so route any
command that touches the network through it:

    node "$env:PAPERCLIP_GITHUB_LAUNCHER_DIR/git" -C <repo> fetch origin

Local-only commands (`status`, `log`, `commit`, `rev-list`) work as normal. If you cannot reach the
remote, say so rather than reporting measurements as verified against it.
