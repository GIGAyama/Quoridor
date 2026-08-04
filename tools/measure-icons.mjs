/*
 * アイコンを画素で測る。
 *
 *   node tools/measure-icons.mjs [配るディレクトリ=dist]
 *
 * 見るのは2つ。
 *  1. apple-touch-icon に透明が含まれていないか
 *     （iOS は透明部分を黒で埋めるので、ホーム画面で四隅だけが黒く出る）
 *  2. maskable のセーフゾーン（中央80%の円）の外に「中身」がどれだけあるか
 *     欠けるのは下地ならよい。困るのは絵の中身が欠けること。
 *     下地と中身を色で区別しないと、実態より深刻に見える。
 */
import { chromium } from 'playwright';
import { serveDir } from './measure-lib.mjs';

const ROOT = process.argv[2] || 'dist';
const PORT = 4174;

const run = async () => {
  const server = await serveDir(new URL(`../${ROOT}/`, import.meta.url).pathname.replace(/\/$/, ''), PORT);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`);

  const result = await page.evaluate(async (files) => {
    const load = (src) => new Promise((res, rej) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = src;
    });

    const out = [];
    for (const f of files) {
      const img = await load(f);
      const cv = document.createElement('canvas');
      cv.width = img.naturalWidth;
      cv.height = img.naturalHeight;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, cv.width, cv.height);
      const n = cv.width * cv.height;

      let transparent = 0;
      // セーフゾーン＝中央80%の円。maskable はこの外側が切り落とされうる。
      const cx = cv.width / 2, cy = cv.height / 2, rad = cv.width * 0.4;
      let outside = 0, outsideOpaque = 0;
      // 「下地」＝四隅の平均色。ここから離れた画素を「絵の中身」とみなす。
      const cornerAt = (x, y) => { const i = (y * cv.width + x) * 4; return [data[i], data[i+1], data[i+2]]; };
      const corners = [cornerAt(1, 1), cornerAt(cv.width - 2, 1), cornerAt(1, cv.height - 2), cornerAt(cv.width - 2, cv.height - 2)];
      const base = [0, 1, 2].map((k) => corners.reduce((s, c) => s + c[k], 0) / corners.length);

      for (let y = 0; y < cv.height; y++) {
        for (let x = 0; x < cv.width; x++) {
          const i = (y * cv.width + x) * 4;
          if (data[i + 3] < 250) transparent++;
          const dx = x - cx, dy = y - cy;
          if (dx * dx + dy * dy > rad * rad) {
            outside++;
            if (data[i + 3] < 250) continue;   // 透明は下地扱い
            const dist = Math.abs(data[i] - base[0]) + Math.abs(data[i+1] - base[1]) + Math.abs(data[i+2] - base[2]);
            if (dist > 90) outsideOpaque++;    // 下地とはっきり違う色＝絵の中身
          }
        }
      }
      out.push({
        file: f,
        size: `${cv.width}x${cv.height}`,
        transparentPct: Math.round((transparent / n) * 10000) / 100,
        baseColor: `rgb(${base.map(Math.round).join(',')})`,
        outsideSafeZoneContentPct: Math.round((outsideOpaque / n) * 10000) / 100,
        safeZoneOuterPixels: outside,
      });
    }
    return out;
  }, [
    './favicon.png',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/maskable-192.png',
    './icons/maskable-512.png',
    './icons/apple-touch-icon.png',
  ]);

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  server.close();
};

run().catch((e) => { console.error(e); process.exit(2); });
