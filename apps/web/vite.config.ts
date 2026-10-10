import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // .env files stay at the repository root, shared by every workspace.
  envDir: '../..',
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    VitePWA({
      // The user chooses when to reload ("new version" banner).
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'Manifeste - les lycées et les facs mobilisés, en direct',
        short_name: 'Manifeste',
        description:
          'Partout en France, les lycéens et les étudiants se font entendre. La carte en direct des lycées et des facs bloqués.',
        lang: 'fr',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#07090d',
        theme_color: '#07090d',
        categories: ['news', 'education'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        shortcuts: [
          { name: 'Signaler un blocus', short_name: 'Signaler', url: '/signaler' },
          { name: 'Liste des établissements', short_name: 'Liste', url: '/liste' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/embed\//, /^\/(sitemap\.xml|robots\.txt)$/],
        runtimeCaching: [
          {
            // Public reads: network first (live data), cache when offline.
            urlPattern: ({ url, request }) =>
              request.method === 'GET' &&
              url.hostname.endsWith('.supabase.co') &&
              url.pathname.startsWith('/rest/v1/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-lecture',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 200, maxAgeSeconds: 24 * 3600 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Published (blurred) photos: immutable.
            urlPattern: ({ url }) =>
              url.hostname.endsWith('.supabase.co') &&
              url.pathname.startsWith('/storage/v1/object/public/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'photos',
              expiration: { maxEntries: 150, maxAgeSeconds: 7 * 24 * 3600 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Map tiles and style: cache capped in size and duration.
            urlPattern: ({ url }) => url.hostname === 'tiles.openfreemap.org',
            handler: 'CacheFirst',
            options: {
              cacheName: 'tuiles',
              expiration: {
                maxEntries: 1500,
                maxAgeSeconds: 7 * 24 * 3600,
                purgeOnQuotaError: true,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('../../legacy/supabase/functions/_shared', import.meta.url)),
    },
  },
  build: { chunkSizeWarningLimit: 1200 },
  worker: { format: 'es' },
})
