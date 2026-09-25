import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: path.join(__dirname, 'src/renderer'),
  build: {
    outDir: path.join(__dirname, '.vite/renderer/main_window'),
    emptyOutDir: true,
  },
});
