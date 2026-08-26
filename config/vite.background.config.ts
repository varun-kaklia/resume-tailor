import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/**
 * Service-worker bundle.
 *
 * IIFE keeps it a classic script, so the manifest needs no `"type": "module"`
 * and Firefox's event-page fallback loads the same file. Runs after the content
 * pass, so it must not empty the output directory.
 */
export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  publicDir: false,
  build: {
    outDir: 'dist/chrome',
    emptyOutDir: false,
    target: 'chrome114',
    lib: {
      entry: fileURLToPath(new URL('../src/background/index.ts', import.meta.url)),
      formats: ['iife'],
      name: 'ResumeTailorBackground',
      fileName: () => 'background.js',
    },
  },
});
