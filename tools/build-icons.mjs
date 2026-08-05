/*
 * アイコン一式を1枚の元画像から作り直す。
 *
 *   node tools/build-icons.mjs
 *
 * ・色数を落としてパレット PNG にする。もとの絵は色数の少ないドット絵なので、
 *   フルカラーで持つ理由がない（元は 1枚で 1,102KB あった）。
 * ・maskable は「欠け」より「余白」を疑う。中央80%の円の外に絵の中身が
 *   はみ出していると円で切り抜かれて欠けるので、絵を小さくして下地を端まで伸ばす。
 *   目標はセーフゾーン外の中身 0.2% 以下（tools/measure-icons.mjs で測る）。
 * ・apple-touch-icon には透明を含めない。iOS は透明を黒で埋めるため、
 *   ホーム画面でアイコンの四隅だけが黒く出る。
 *
 * ⚠️ sharp を通して書き直すとパレットが落ちる。作ったバッファをそのまま書くこと。
 */
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MASTER = resolve(ROOT, 'tools/icon-master.png');
const OUT = resolve(ROOT, 'public');

// アプリの下地の色。manifest の background_color と揃える。
const BASE = { r: 0xff, g: 0xf9, b: 0xc4, alpha: 1 };

// maskable の中身の大きさ（辺の割合）。
// 中央80%の円に「絵の中身」が収まる値を、実測（measure-icons.mjs）で詰めた結果。
const MASKABLE_SCALE = 0.62;

const COLOURS = 128;   // これ以上増やしても見た目は変わらず、容量だけ 5倍になる

const png = (pipeline) => pipeline.png({
  palette: true, colours: COLOURS, effort: 10, compressionLevel: 9,
}).toBuffer();

const write = (name, buf) => {
  writeFileSync(resolve(OUT, name), buf);
  console.log(`${name.padEnd(32)} ${(buf.length / 1024).toFixed(1)} KB`);
};

/** 透明のまま、指定サイズへ縮める（any 用アイコンと favicon） */
const transparentIcon = (size) => png(
  sharp(MASTER).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }),
);

/** 下地を端まで伸ばし、絵を中央へ小さく置く（maskable / apple-touch 用） */
const filledIcon = async (size, scale) => {
  const inner = Math.round(size * scale);
  const art = await sharp(MASTER).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
  return png(
    sharp({ create: { width: size, height: size, channels: 4, background: BASE } })
      .composite([{ input: art, gravity: 'centre' }])
      .flatten({ background: BASE }),   // 透明を残さない
  );
};

const run = async () => {
  console.log(`元画像: ${MASTER}`);
  write('favicon.png', await transparentIcon(64));
  write('icons/icon-192.png', await transparentIcon(192));
  write('icons/icon-512.png', await transparentIcon(512));
  write('icons/maskable-192.png', await filledIcon(192, MASKABLE_SCALE));
  write('icons/maskable-512.png', await filledIcon(512, MASKABLE_SCALE));
  // apple-touch は円ではなく角丸四角で切られるので、maskable ほど小さくしなくてよい
  write('icons/apple-touch-icon.png', await filledIcon(180, 0.92));
  console.log('\n作り直したら node tools/measure-icons.mjs public で測ること。');
};

run().catch((e) => { console.error(e); process.exit(1); });
