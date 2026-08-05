/*
 * PWA の「挙動」を測る。sw.js を読んでも分からないことだけを測る。
 *
 *   node tools/measure-pwa.mjs [配るディレクトリ=dist]
 *
 * 測ること
 *   1. Service Worker が実際に登録されているか（getRegistration）
 *   2. 初回訪問で勝手にリロードしないか（画面遷移が1回か）
 *   3. 版を上げても、押すまで切り替わらないか（3秒放置して waiting のままか）
 *   4. 押したら切り替わるか
 *   5. 他アプリのキャッシュを巻き添えにしないか
 *   6. 圏外で起動するか／本体が無ければ offline.html が出るか
 */
import { chromium } from 'playwright';
import { serveDir } from './measure-lib.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = process.argv[2] || 'dist';
const PORT = 4175;
const DIR = new URL(`../${ROOT}/`, import.meta.url).pathname.replace(/\/$/, '');
const SW_PATH = `${DIR}/sw.js`;
const BASE = `http://127.0.0.1:${PORT}/`;

const results = [];
const ok = (name, pass, detail) => { results.push({ name, pass, detail }); };

const run = async () => {
  const server = await serveDir(DIR, PORT);
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  // --- 1・2. 初回訪問 -------------------------------------------------------
  let navCount = 0;
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navCount++; });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);   // SW の install / activate が終わるのを待つ

  const reg = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    return r ? { scope: r.scope, active: !!r.active, waiting: !!r.waiting } : null;
  });
  ok('E9 Service Worker が登録されている', !!reg && reg.active, JSON.stringify(reg));
  ok('E8 初回訪問の画面遷移が1回', navCount === 1, `${navCount} 回`);

  // --- 5. 他アプリのキャッシュを置いてから版を上げる -------------------------
  await page.evaluate(async () => {
    const a = await caches.open('other-app-v1');
    await a.put('/foreign-a', new Response('a'));
    const b = await caches.open('kanji-town-static-v2');
    await b.put('/foreign-b', new Response('b'));
  });

  // --- 3. 版を上げても押すまで切り替わらないか -------------------------------
  const original = readFileSync(SW_PATH, 'utf8');
  const bumped = original.replace(/APP_VERSION\s*=\s*'[^']+'/, "APP_VERSION = 'v999-test'");
  const changed = bumped !== original;
  writeFileSync(SW_PATH, bumped);

  let waitingState;
  try {
    await page.evaluate(async () => {
      const r = await navigator.serviceWorker.getRegistration();
      await r.update();
    });
    await page.waitForTimeout(3000);   // 3秒放置
    waitingState = await page.evaluate(async () => {
      const r = await navigator.serviceWorker.getRegistration();
      return { waiting: !!r.waiting, active: r.active ? r.active.scriptURL : null };
    });
    const cacheNamesAfterActivate = await page.evaluate(() => caches.keys());
    ok('E7 版を上げても押すまで waiting のまま', changed && waitingState.waiting,
       changed ? JSON.stringify(waitingState) : '版の文字列が見つからず未検証');

    // --- 4. 押したら切り替わるか ------------------------------------------
    const swapped = await page.evaluate(async () => {
      const r = await navigator.serviceWorker.getRegistration();
      if (!r.waiting) return { swapped: false, reason: 'waiting なし（既に切り替わっている）' };
      const done = new Promise((res) => {
        navigator.serviceWorker.addEventListener('controllerchange', () => res(true), { once: true });
        setTimeout(() => res(false), 4000);
      });
      r.waiting.postMessage({ type: 'SKIP_WAITING' });
      return { swapped: await done };
    });
    ok('E7b 押したら切り替わる（SKIP_WAITING メッセージ）', swapped.swapped !== false,
       JSON.stringify(swapped));

    await page.waitForTimeout(800);
    const keys = await page.evaluate(() => caches.keys());
    ok('E5 他アプリのキャッシュが残っている',
       keys.includes('other-app-v1') && keys.includes('kanji-town-static-v2'),
       JSON.stringify({ before: cacheNamesAfterActivate, after: keys }));
  } finally {
    writeFileSync(SW_PATH, original);
  }

  // --- 6. 圏外 -------------------------------------------------------------
  //
  // ⚠️ context.setOffline(true) では測れない。
  //    Chromium では Service Worker の中からの fetch がそのまま通ってしまい、
  //    「圏外なのに本物のサーバから返ってきた」状態を圏外と誤認する。
  //    実際、この方法だと本体キャッシュを消しても普通にアプリが表示され、
  //    offline.html が出ているように見えなかった。
  //    → サーバを本当に止める。これがいちばん本物の圏外に近い。
  const stopServer = () => new Promise((res) => { server.closeAllConnections(); server.close(res); });
  const restartServer = async () => serveDir(DIR, PORT);

  await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    await r.unregister();
    for (const k of await caches.keys()) await caches.delete(k);
  });

  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto(BASE, { waitUntil: 'networkidle' });
  await p2.waitForTimeout(2500);

  await stopServer();
  await p2.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await p2.waitForTimeout(1200);
  const offlineWorks = await p2.evaluate(() =>
    !!document.querySelector('#root') && document.body.innerText.includes('カベ'));
  ok('E10a 圏外で起動する（サーバを止めて確認）', offlineWorks, (await p2.title()) || '');

  // 本体のキャッシュだけ消してから圏外にすると offline.html が出るか
  const server2 = await restartServer();
  await p2.goto(BASE, { waitUntil: 'networkidle' });
  await p2.waitForTimeout(800);
  const leftInCache = await p2.evaluate(async () => {
    for (const k of await caches.keys()) {
      const c = await caches.open(k);
      for (const req of await c.keys()) {
        if (!/offline\.html$/.test(req.url)) await c.delete(req);
      }
    }
    const out = [];
    for (const k of await caches.keys()) {
      for (const req of await (await caches.open(k)).keys()) out.push(req.url);
    }
    return out;
  });
  await new Promise((res) => { server2.closeAllConnections(); server2.close(res); });
  await p2.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await p2.waitForTimeout(1000);
  const body = await p2.evaluate(() => (document.body ? document.body.innerText.slice(0, 120) : ''));
  ok('E10b 本体が無いとき offline.html が出る', /つながっていません/.test(body),
     `キャッシュに残したもの=${JSON.stringify(leftInCache)} / 表示=${JSON.stringify(body.slice(0, 40))}`);

  await browser.close();

  console.log(JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.pass);
  console.error('\n== PWA 実測 ==');
  for (const r of results) console.error(`${r.pass ? '✅' : '❌'} ${r.name} … ${r.detail}`);
  process.exit(failed.length === 0 ? 0 : 1);
};

run().catch((e) => { console.error(e); process.exit(2); });
