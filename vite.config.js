import { defineConfig } from 'vite';
import { resolve } from 'path';
import fs from 'fs';

export default defineConfig({
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
        fs.copyFileSync(resolve(__dirname, 'manifest.json'), resolve(__dirname, 'dist/manifest.json'));

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
    }
  ]
});