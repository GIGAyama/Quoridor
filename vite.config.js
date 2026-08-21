import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const OUT_DIR = 'dist';

export default defineConfig({
  // 相対パスでビルドし、ルート直下でもサブパス（GitHub Pages等）でも動作させる
  base: './',
  plugins: [react()],
  build: {
    outDir: OUT_DIR,
    target: 'es2020',
    sourcemap: true,
  },
});
