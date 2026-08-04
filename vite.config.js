import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const OUT_DIR = 'dist';

/*
 * ビルドで作られた js / css の実ファイル名を sw.js へ埋め込む。
 *
 * なぜ必要か：
 *   バンドルの名前にはハッシュが付くため、public/sw.js に手で書いておけない。
 *   書かないままにすると、はじめて開いた直後に圏外へ行った児童に白い画面が出る。
 *   初回の読み込みでは Service Worker がまだページを管理していないので、
 *   js/css の取得が Service Worker を通らず、キャッシュに残らないからである。
 *   （index.html だけは先読みしてあるので「タイトルは出るが中身が出ない」形になる）
 *
 * 埋め込む先が見つからなければビルドを落とす。黙って何もしないのがいちばん危ない。
 */
function precacheBuiltAssets() {
  const MARKER = 'const BUILD_ASSETS = [];';
  return {
    name: 'precache-built-assets',
    apply: 'build',
    closeBundle() {
      const swPath = resolve(OUT_DIR, 'sw.js');
      if (!existsSync(swPath)) {
        throw new Error(`[precache-built-assets] ${swPath} が見つかりません`);
      }
      const assetsDir = resolve(OUT_DIR, 'assets');
      const assets = existsSync(assetsDir)
        ? readdirSync(assetsDir)
            .filter((f) => !f.endsWith('.map'))   // ソースマップは先読みしない（重いだけで表示に要らない）
            .sort()
            .map((f) => `./assets/${f}`)
        : [];

      const src = readFileSync(swPath, 'utf8');
      if (!src.includes(MARKER)) {
        throw new Error(`[precache-built-assets] sw.js に "${MARKER}" が見つかりません。`
          + 'この行を消すと、圏外での初回起動が黙って壊れます。');
      }
      writeFileSync(swPath, src.replace(MARKER, `const BUILD_ASSETS = ${JSON.stringify(assets)};`));
      console.log(`[precache-built-assets] ${assets.length} 件を sw.js に埋め込みました`);
    },
  };
}

export default defineConfig({
  // 相対パスでビルドし、ルート直下でもサブパス（GitHub Pages等）でも動作させる
  base: './',
  plugins: [react(), precacheBuiltAssets()],
  build: {
    outDir: OUT_DIR,
    target: 'es2020',
    sourcemap: true,
  },
});
