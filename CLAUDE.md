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

    node "$PAPERCLIP_GITHUB_LAUNCHER_DIR/git" -C <repo> fetch origin

Local-only commands (`status`, `log`, `commit`, `rev-list`) work as normal. If you cannot reach the
remote, say so rather than reporting measurements as verified against it.
