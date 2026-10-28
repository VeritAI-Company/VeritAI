import { defineConfig } from 'vite';
import { resolve } from 'path';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  root: resolve(__dirname, 'portal'),
  publicDir: resolve(__dirname, 'portal/public'),
  build: {
    outDir: resolve(__dirname, 'dist-portal'),
    emptyOutDir: true,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: { enabled: true },
      includeAssets: ['icon-192x192.png', 'icon-512x512.png'],
      manifest: {
        name: 'VeritAI Mobile Portal',
        short_name: 'VeritAI',
        description: '실시간 딥페이크 탐지 모바일 포털',
        theme_color: '#19202d',
        background_color: '#19202d',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      }
    })
  ]
});
