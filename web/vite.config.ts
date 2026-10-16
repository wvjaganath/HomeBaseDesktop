import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

// The dev server is for the development machine only: bound to localhost and
// proxying API calls to a local hub on :3000. It is never deployed.
const hub = 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [svelte()],
  build: {
    outDir: '../server/web-dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    cssCodeSplit: true,
    assetsInlineLimit: 0, // keep everything as files: CSP has no data: fonts/scripts
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: hub, changeOrigin: false },
      '/auth': { target: hub, changeOrigin: false },
      '/sync': { target: hub, changeOrigin: false },
      '/kiosk': { target: hub, changeOrigin: false },
      '/health': { target: hub, changeOrigin: false },
    },
  },
});
