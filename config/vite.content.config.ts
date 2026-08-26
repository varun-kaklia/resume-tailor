import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/**
 * Content-script bundle.
 *
 * IIFE, because Chrome does not load content scripts as ES modules. Built first
 * so this pass owns clearing `dist` and copying the manifest from `public`.
 */
export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  publicDir: 'public',
  build: {
    outDir: 'dist/chrome',
    emptyOutDir: true,
    target: 'chrome114',
    lib: {
      entry: fileURLToPath(new URL('../src/content/index.ts', import.meta.url)),
      formats: ['iife'],
      name: 'ResumeTailorContent',
      fileName: () => 'content.js',
    },
  },
});
