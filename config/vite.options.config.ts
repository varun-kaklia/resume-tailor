import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/**
 * Options page bundle.
 *
 * A normal HTML build rather than a library one, so Preact and the stylesheet
 * are code-split and hashed as usual. `base: './'` matters: assets are loaded
 * from a `chrome-extension://` origin, where absolute paths do not resolve.
 * Runs after the script passes, so it must not empty the output directory.
 */
export default defineConfig({
  root: fileURLToPath(new URL('../src/ui/options', import.meta.url)),
  base: './',
  build: {
    outDir: fileURLToPath(new URL('../dist/chrome', import.meta.url)),
    emptyOutDir: false,
    target: 'chrome114',
    rollupOptions: {
      input: fileURLToPath(new URL('../src/ui/options/options.html', import.meta.url)),
    },
  },
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
});
