# browser-rpg

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
