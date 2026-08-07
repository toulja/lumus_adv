import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import cesium from 'vite-plugin-cesium';
import path from 'node:path';

// Ports bewusst abweichend von LUMUS (5173/4620), damit beide Projekte
// gleichzeitig laufen koennen.
export default defineConfig({
  root: 'web',
  plugins: [react(), cesium()],
  resolve: {
    alias: {
      '@shared': path.resolve(process.cwd(), 'shared'),
    },
  },
  server: {
    port: 5273,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4720',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (fehler) => {
            console.warn(`[proxy] ${fehler.message}`);
          });
        },
      },
      '/ws': {
        target: 'ws://127.0.0.1:4720',
        ws: true,
        // Bricht die Seite die WebSocket-Verbindung beim Neuladen ab, wirft der
        // Proxy unter Windows ECONNABORTED. Ohne eigenen Fehlerbehandler
        // beendet das den gesamten Entwicklungsserver.
        configure: (proxy) => {
          proxy.on('error', (fehler) => {
            console.warn(`[ws-proxy] ${fehler.message}`);
          });
          proxy.on('proxyReqWs', (proxyReq, _req, socket) => {
            socket.on('error', () => {});
            proxyReq.on('error', () => {});
          });
        },
      },
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4096,
  },
});
