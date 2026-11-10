import { defineConfig } from 'vite';
import { resolve } from 'path';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  root: resolve(__dirname, 'portal'),
  publicDir: resolve(__dirname, 'portal/public'),
  // 분석 서버 주소(VITE_API_BASE)는 프로젝트 루트 .env 에서 읽는다 (크롬 확장과 같은 파일)
  envDir: resolve(__dirname),
  // portal 폴더 밖의 공통 코드(shared/)를 개발 서버에서도 읽을 수 있게 한다
  server: { fs: { allow: [resolve(__dirname)] } },
  build: {
    outDir: resolve(__dirname, 'dist-portal'),
    emptyOutDir: true,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      // 개발 서버에서는 끈다. 켜 두면 예전 화면이 남고, 서버를 켤 때마다 휴대폰이 새로 설치하고 새로고침해서 느려진다
      devOptions: { enabled: false },
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
