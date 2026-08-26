import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/**
 * Popup bundle. Same shape as the options build; see that config for why
 * `base` is relative and why the output directory is not emptied.
 */
export default defineConfig({
  root: fileURLToPath(new URL('../src/ui/popup', import.meta.url)),
  base: './',
  build: {
    outDir: fileURLToPath(new URL('../dist/chrome', import.meta.url)),
    emptyOutDir: false,
    target: 'chrome114',
    rollupOptions: { input: fileURLToPath(new URL('../src/ui/popup/popup.html', import.meta.url)) },
  },
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
});
