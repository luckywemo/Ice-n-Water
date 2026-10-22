import { defineConfig } from 'vite';

// relative base — the zip is served from a subpath on itch.io
// (html-classic.itch.zone/html/<id>/), so absolute /assets/... 404s there.
// flat assetsDir — no subdirectories in the zip at all, so itch's
// extractor can't mangle "assets/x.js" into a literal "assets\x.js" filename.
export default defineConfig({
  base: './',
  build: { assetsDir: '' },
});
