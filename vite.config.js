import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    preact(),
    // App-shell service worker: the UI (HTML/JS/CSS/icons) is precached so the
    // app opens instantly on repeat visits. Streams, playlists and API calls are
    // never cached — they always go to the network.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script-defer',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Wisp',
        short_name: 'Wisp',
        description: 'A fast, lightweight player for HLS/IPTV playlists and internet radio.',
        theme_color: '#10151c',
        background_color: '#10151c',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    target: 'es2020',
    // hls.js is intentionally one big lazy chunk, loaded only when something plays.
    chunkSizeWarningLimit: 700,
  },
});
