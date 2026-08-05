/*
 * 「開いたのに真っ白」から自力で戻れることを、実ブラウザで測る。
 *
 *   node tools/measure-boot.mjs [配るディレクトリ=dist]
 *
 * なぜ実測でしか確かめられないか：
 *   番人（public/boot-check.js）が守っているのは「本体が動かなかったとき」である。
 *   本体が動く前提の単体テストでは、その状況そのものを作れない。
 *   ここでは本体の js をわざと 404 にして真っ白を再現し、
 *   番人が出ること・押せば直ること・他アプリを巻き添えにしないことを見る。
 *
 * 同時に「正常なときは出ない」ことも測る。誤って出る番人は、
 * 遅い校内 Wi-Fi でつながるのを待っている児童に「こわれた」と思わせるため、
 * 出ないことのほうが重要である。
 */
import { chromium } from 'playwright';
import { serveDir } from './measure-lib.mjs';

const ROOT = process.argv[2] || 'dist';
const PORT = 4190;
const BASE = `http://127.0.0.1:${PORT}/`;

// 本体の js を 404 にするかどうか。serveDir の手前で差し込む。
let breakBundle = false;
// ページの取得に、学校のフィルタの遮断ページのようなものを返すかどうか。
let blockPage = false;
const BLOCK_BODY = '<!doctype html><title>Blocked</title><body></body>';

const server = await serveDir(ROOT, PORT, (url, res) => {
  if (breakBundle && /^\/assets\/.*\.js$/.test(url.pathname)) {
    res.writeHead(404, { 'Content-Type': 'text/html' }).end('<h1>404</h1>');
    return true;
  }
  if (blockPage && (url.pathname === '/' || url.pathname.endsWith('.html'))) {
    // フィルタは 200 で中身の無いページを返すことがある。fetch は「成功」になる。
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(BLOCK_BODY);
    return true;
  }
  return false;
});

const failures = [];
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

const browser = await chromium.launch();

// ---- 1) 正常なときは出ない -------------------------------------------------
// 番人の待ち時間は 10 秒。それを超えて待ち、出ていないことを確かめる。
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(12500);
  check(await page.locator('#boot-recovery').count() === 0, '正常なときは番人が出ない（12.5秒待った）');
  check((await page.locator('#root').innerHTML()).length > 1000, '本体が描けている');
  await ctx.close();
}

// ---- 2) 真っ白のときは出て、直せる -----------------------------------------
breakBundle = true;
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#boot-recovery', { timeout: 8000 }).catch(() => {});

  const shown = await page.locator('#boot-recovery').count() > 0;
  check(shown, '本体が読めないとき、番人が出る');

  if (shown) {
    check((await page.locator('#boot-recovery').innerText()).includes('うまく ひらけませんでした'),
      '児童に分かる言葉で案内している');

    // 先生が報告できるよう、落ちた原因が画面に残っていること
    const note = await page.locator('#boot-recovery pre').evaluate((n) => n.textContent).catch(() => '');
    check(note.includes('よみこめなかったファイル'), '先生向けに原因を残している', note.split('\n')[0] || '');

    // ⚠️ いちばん大事な確認。ドメインを共有する他アプリのキャッシュを消さないこと。
    await page.evaluate(async () => {
      await (await caches.open('kabe-kabe-test')).put('/x', new Response('x'));
      await (await caches.open('qalc-v2')).put('/y', new Response('y'));
    });
    await page.locator('#boot-recovery button', { hasText: 'なおす' }).click();
    await page.waitForTimeout(3000);

    const keys = await page.evaluate(() => caches.keys());
    check(!keys.some((k) => k.startsWith('kabe-kabe-')), '自アプリのキャッシュは消した');
    check(keys.includes('qalc-v2'), '他アプリのキャッシュは残した', JSON.stringify(keys));
    check(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length) === 0,
      'Service Worker を外した');
  }
  await ctx.close();
}

// ---- 3) 配信が直れば、ふつうに起動する -------------------------------------
breakBundle = false;
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}?r=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  check(await page.locator('#boot-recovery').count() === 0, '配信が直れば番人は出ない');
  check((await page.evaluate(() => document.body.innerText)).includes('カベ'), '本体が表示されている');
  await ctx.close();
}

// ---- 4) ?fix=1 で、画面を待たずに直せる ------------------------------------
/*
 * 先生が配れる「直すためのアドレス」。番人が出るのを待たずに直せること、
 * そして直したあと ?fix=1 が外れて（＝繰り返しにならず）本体が起動することを見る。
 */
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.evaluate(async () => {
    await (await caches.open('kabe-kabe-test')).put('/x', new Response('x'));
    await (await caches.open('qalc-v2')).put('/y', new Response('y'));
  });

  await page.goto(`${BASE}?fix=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);

  const keys = await page.evaluate(() => caches.keys());
  // 直したあとは本体が起動し、Service Worker を登録し直して
  // 今の版のキャッシュ（kabe-kabe-v5）を作る。これは正しい。
  // 見るべきは「古いものが消えたか」なので、置いた目印が消えたことで確かめる。
  check(!keys.includes('kabe-kabe-test'), '?fix=1 で自アプリの古いキャッシュを消した', JSON.stringify(keys));
  check(keys.includes('qalc-v2'), '?fix=1 でも他アプリのキャッシュは残した', JSON.stringify(keys));
  check(!page.url().includes('fix=1'), '?fix=1 が外れている（繰り返しにならない）', page.url());
  check((await page.evaluate(() => document.body.innerText)).includes('カベ'), '直したあと本体が起動する');
  await ctx.close();
}

// ---- 5) 遮断ページを本体として焼き付けない ---------------------------------
/*
 * fetch は 404 でもフィルタの遮断ページでも「成功」として返る。
 * response.ok を見ずにキャッシュへ入れると、そのページが index.html として残り、
 * 以後オフラインのたびに本体ではなくそれが出る（＝ずっと白い画面）。
 * ここでは、遮断ページを1度つかまされたあとでも、
 * 圏外にしたときに本体が出ることを確かめる。
 */
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // まず正常に開いて、本体をキャッシュへ入れる
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.reload({ waitUntil: 'networkidle' });   // Service Worker の管理下に入れる
  await page.waitForTimeout(1500);

  // 遮断ページをつかまされる
  blockPage = true;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // 圏外にすると、キャッシュから出す番になる
  blockPage = false;
  await new Promise((r) => server.close(r));
  await page.goto(BASE, { waitUntil: 'load' }).catch(() => {});
  await page.waitForTimeout(2000);

  const text = await page.evaluate(() => document.body.innerText);
  check(text.includes('カベ') || text.includes('つながっていません'),
    '遮断ページを本体として焼き付けない', JSON.stringify(text.slice(0, 40)));
  await ctx.close();
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
}

await browser.close();
server.close();

console.log(`\n== 合計 ==\n起動の番人: ${failures.length === 0 ? '問題なし' : `${failures.length} 件`}`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
