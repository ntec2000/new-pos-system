import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const rendererRoot = fileURLToPath(new URL('./src/renderer', import.meta.url));
const out = (dir: string) => fileURLToPath(new URL(dir, import.meta.url));

// mode 'web' builds a browser demo (in-browser database) used for UI testing; production builds the Electron renderer.
export default defineConfig(({ mode }) => ({
  root: rendererRoot,
  base: './',
  plugins: [react()],
  define: { __WEB_DEMO__: JSON.stringify(mode === 'web' || mode === 'development') },
  build: {
    outDir: mode === 'web' ? out('./dist-web') : out('./dist/renderer'),
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 800,
  },
}));
