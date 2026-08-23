import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const OUT_DIR = 'dist';

export default defineConfig({
  // 相対パスでビルドし、ルート直下でもサブパス（GitHub Pages等）でも動作させる
  base: './',
  plugins: [react()],
  build: {
    outDir: OUT_DIR,
    target: 'es2020',
    sourcemap: true,
    /*
     * 入口は index.html だけではない。
     *
     * プライバシーポリシーと利用規約はリポジトリ直下に置いた素の HTML だが、
     * ここに並べないと Vite は index.html しか見ず、dist に出てこない。
     * 出てこなければ配信物にも入らず、
     * https://quoridor.giga-school.com/privacy.html は 404 になる。
     * （public/ に置けば素通しで配られるが、それだと canonical や文言の
     *   間違いをビルドが一切見ないまま配ることになるので、入口として並べる。）
     */
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        privacy: resolve(import.meta.dirname, 'privacy.html'),
        terms: resolve(import.meta.dirname, 'terms.html'),
      },
    },
  },
});
