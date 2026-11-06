import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'path';
import fs from 'fs';

export default defineConfig(({ mode }) => {
  // 분석 서버 주소: 루트 .env 의 VITE_API_BASE (없으면 내 컴퓨터)
  const env = loadEnv(mode, __dirname, 'VITE_');
  const apiBase = (env.VITE_API_BASE || 'http://localhost:8080').replace(/\/$/, '');
  const apiOrigin = new URL(apiBase).origin;

  return {
    define: {
      __VERITAI_API_BASE__: JSON.stringify(apiBase),
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: {
          'frontend/content': resolve(__dirname, 'frontend/content.js'),
          'frontend/popup': resolve(__dirname, 'frontend/popup.html'),
        },
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: 'assets/[name].js',
          assetFileNames: 'assets/[name].[ext]'
        }
      }
    },
    plugins: [
      {
        name: 'copy-extension-files',
        writeBundle() {
          // manifest 의 서버 접근 권한(host_permissions)을 .env 의 서버 주소로 바꿔서 복사한다
          const manifest = JSON.parse(fs.readFileSync(resolve(__dirname, 'manifest.json'), 'utf8'));
          manifest.host_permissions = (manifest.host_permissions || []).map(p => (p === 'http://localhost:8080/*' ? `${apiOrigin}/*` : p));
          fs.writeFileSync(resolve(__dirname, 'dist/manifest.json'), JSON.stringify(manifest, null, 2));

          const distFrontend = resolve(__dirname, 'dist/frontend');
          if (!fs.existsSync(distFrontend)) {
            fs.mkdirSync(distFrontend, { recursive: true });
          }

          const filesToCopy = ['background.js', 'offscreen.html', 'worker.js'];
          filesToCopy.forEach(file => {
            const srcPath = resolve(__dirname, 'frontend', file);
            const destPath = resolve(__dirname, 'dist/frontend', file);

            if (fs.existsSync(srcPath)) {
              fs.copyFileSync(srcPath, destPath);
              console.log(`✅ [복사 완료] frontend/${file} -> dist/frontend/${file}`);
            } else {
              console.error(`❌ [파일 누락] frontend 폴더 안에 ${file} 파일이 없습니다!`);
            }
          });
        }
      },
      {
        name: 'guard-content-script-no-import',
        writeBundle() {
          const contentPath = resolve(__dirname, 'dist/frontend/content.js');
          if (!fs.existsSync(contentPath)) return;
          const code = fs.readFileSync(contentPath, 'utf8');
          if (/^\s*import[\s{*"']/m.test(code) || /^\s*export\s/m.test(code)) {
            throw new Error(
              '❌ dist/frontend/content.js 에 import/export 문이 남아 있습니다. ' +
              'content script는 단일 파일이어야 합니다. popup과 content가 공유하는 모듈을 확인하세요.'
            );
          }
        }
      }
    ]
  };
});
