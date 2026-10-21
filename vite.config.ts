import { defineConfig } from 'vite';

// Every URL the build emits is relative to index.html, so the same `dist/` plays from a project page
// under /browser-rpg/, from a user page at the root, or from a custom domain -- no rebuild, no base to
// keep in step with the repo name. Nothing in src/ writes an absolute path: art, models and audio all
// come through `import.meta.glob(..., '?url')`, which Vite rewrites for us.
// The QA panel, ?debug=1 and the window.__debug handle ship in a local build on purpose: every bench in
// bench/ drives the built dist/ through them. PUBLIC_BUILD=1 -- what the Pages workflow sets -- compiles
// them out instead, so the game on the public URL has no way to raise the panel.
export default defineConfig({
  base: './',
  define: { __QA_TOOLS__: JSON.stringify(process.env.PUBLIC_BUILD !== '1') },
});
