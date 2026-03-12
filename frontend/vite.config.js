import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'icons/*.png'],
      manifest: {
        name: 'Inventario',
        short_name: 'Inventario',
        description: 'Sistema de inventario y ventas',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        // Rutas de datos en tiempo real: NUNCA cachear
        // Se listan primero con NetworkOnly para que tengan prioridad
        runtimeCaching: [
          {
            // Reportes, facturas, dashboard — datos que cambian constantemente
            urlPattern: /^https:\/\/inventario-final-production\.up\.railway\.app\/api\/(reportes|facturas|dashboard).*/i,
            handler: 'NetworkOnly',
          },
          {
            // El resto de la API: catálogos, config, productos — pueden cachearse brevemente
            urlPattern: /^https:\/\/inventario-final-production\.up\.railway\.app\/api\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: { maxEntries: 50, maxAgeSeconds: 300 },
            },
          },
        ],
      },
    })
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      }
    }
  }
})