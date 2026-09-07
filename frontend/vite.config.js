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
          { src: 'icons/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // Handlers de notificaciones push (public/push-sw.js). En modo
        // `generateSW` el service worker lo escribe Workbox y no se puede editar
        // a mano; importScripts inyecta nuestro código DENTRO de ese mismo SW
        // sin tocar ninguna regla de caché de aquí abajo.
        importScripts: ['/push-sw.js'],
        // Activa el nuevo SW inmediatamente sin esperar a que se cierren todas las pestañas
        skipWaiting: true,
        // El nuevo SW toma control de todas las pestañas abiertas al instante
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        runtimeCaching: [
          {
            // Reportes, facturas, dashboard, tesorería — datos en tiempo real: NUNCA cachear.
            // Inventario va aquí por otro motivo: la exportación devuelve varios MB y
            // guardarlos en CacheStorage llena la cuota del navegador y hace fallar la
            // descarga. Además el inventario cambia con cada venta, no sirve cacheado.
            // Etiquetas por las dos razones a la vez: el PDF pesa, y la lista de nodos
            // cacheada 5 minutos seguiría diciendo "sin código" justo después de que el
            // usuario generara los códigos — que es la secuencia normal de la pantalla.
            //
            // Préstamos entra por el MISMO motivo que inventario, medido: la lista de
            // Cellsite (negocio 31) son 9.976 filas = 13,1 MB de JSON. Con NetworkFirst
            // el Service Worker escribía esos 13 MB en CacheStorage en CADA carga y
            // después de CADA abono —porque toda mutación invalida ['prestamos']—, y
            // con `maxEntries: 50` compartido esa sola entrada desalojaba al resto de
            // la API. Además cachear 5 minutos una pantalla de dinero es lo que hace
            // que un abono recién registrado se siga viendo pendiente.
            urlPattern: /^https:\/\/inventario-final-production\.up\.railway\.app\/api\/(reportes|facturas|dashboard|tesoreria|inventario|etiquetas|prestamos)/i,
            handler: 'NetworkOnly',
          },
          {
            // El resto de la API: catálogos, productos, config — cacheo breve
            urlPattern: /^https:\/\/inventario-final-production\.up\.railway\.app\/api\//i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: { maxEntries: 50, maxAgeSeconds: 300 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})