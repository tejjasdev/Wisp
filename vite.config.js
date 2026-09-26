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
        theme_color: '#191c22',
        background_color: '#191c22',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The Latin font files are precached (~52 KB) so text looks right offline
        // from the first visit; other scripts' subsets are cached when first used.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}', '**/*-latin-{wght,700}-normal-*.woff2'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // Fonts are cached the first time a page uses them (only the scripts it
        // needs), instead of precaching every subset up front.
        runtimeCaching: [
          {
            urlPattern: ({ sameOrigin, url }) => sameOrigin && url.pathname.endsWith('.woff2'),
            handler: 'CacheFirst',
            options: { cacheName: 'fonts', expiration: { maxEntries: 20 } },
          },
        ],
      },
    }),
  ],
  build: {
    target: 'es2020',
    // hls.js is intentionally one big lazy chunk, loaded only when something plays.
    chunkSizeWarningLimit: 700,
  },
});
