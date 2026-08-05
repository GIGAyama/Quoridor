/* 【重要1】キャッシュの掃除は、かならず自アプリのぶんだけに限る。
 *
 * gigayama.github.io は数十本の学習アプリが同じドメインを共有している。
 * ブラウザのキャッシュはドメイン単位なので、caches.keys() はこのアプリのものだけでなく、
 * 同居する全アプリのキャッシュを返す。
 *
 * これまでは「CACHE_VERSION 以外ぜんぶ」を消していたため、このアプリを開いて
 * 新しい Service Worker が有効になった瞬間、その端末に入っていた
 * 児童むけアプリ（Qalc・KANJI_Town など）のオフライン用データまで消えていた。
 * 児童がオフラインで開いても起動せず、しかも原因がそのアプリ側に見えないため
 * 「たまに開かなくなる」という再現しにくい不具合になっていた。
 *
 * 【重要2】install の中で skipWaiting() しない。
 *
 * かつてここで skipWaiting() を呼んでいた。そのため、新しい版を配ると
 * 対戦している最中に画面が入れ替わり、並べたカベも駒の位置も消えていた。
 * 先生からは「たまに盤面が最初に戻る」としか見えず、再現できない。
 * 切り替えるのは、画面に出したトーストを利用者が押したときだけにする。
 *
 * 【重要3】Service Worker は localStorage を一切操作しない。
 */
const CACHE_PREFIX = 'kabe-kabe-';
const APP_VERSION = 'v5';                       // ← リリースごとに必ず上げる
const CACHE_VERSION = CACHE_PREFIX + APP_VERSION;

/*
 * ビルドで作られる JavaScript と CSS は、名前にハッシュが付く（index-Jjuig9u1.js など）ので
 * ここに直接は書けない。vite.config.js の precache-built-assets プラグインが
 * ビルドのあとにこの行へ実際のファイル名を埋め込む。
 *
 * ⚠️ これを入れないと、はじめて開いた直後に圏外へ行った児童に白い画面が出る。
 *    初回の読み込みでは Service Worker がまだページを管理下に置いていないため、
 *    js/css の取得が Service Worker を通らず、キャッシュに入らないためである。
 *    index.html だけキャッシュされているので「タイトルは出るが中身が出ない」形になる。
 *    実際に測るまで気づけなかった（サーバを止めて再読み込みして分かった）。
 */
const BUILD_ASSETS = [];

// 相対URLで指定し、ルート直下でもサブパス配信でも正しく解決されるようにする
const APP_SHELL = [
  './',
  './index.html',
  './offline.html',
  './manifest.webmanifest',
  './install-hook.js',
  './boot-check.js',
  './favicon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
].concat(BUILD_ASSETS);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // addAll は1本でも失敗すると全体が落ちる（＝オフラインで何も出せなくなる）ので、
    // 1本ずつ入れて、失敗したものだけ諦める。
    await Promise.all(APP_SHELL.map((url) =>
      cache.add(new Request(url, { cache: 'reload' }))
        .catch((err) => console.warn('[sw] precache skipped', url, err))));
    // ここでは skipWaiting しない。理由は冒頭【重要2】。
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_VERSION)
      .map((key) => caches.delete(key)));        // ← 自アプリ分だけ削除
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // ナビゲーションはネットワーク優先（最新のHTMLを取得し、圏外ならキャッシュへ）。
  // 本体のキャッシュも無いときは offline.html を出す。
  // 「壊れた」と思わせないためのページなので、外部資産にも JavaScript にも頼らない。
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        /*
         * ⚠️ 取れたものを見ずにキャッシュへ入れてはいけない。
         *
         * fetch は 404 でも、学校のフィルタが出す遮断ページでも「成功」として返る。
         * しかも遮断ページは 200 で返ってくることがあるので、response.ok だけでは足りない。
         * 見ずに入れると、そのページが index.html として焼き付き、
         * 以後オフラインのたびに本体ではなくそれが出る。
         * 中身の無い遮断ページだと、児童からは白い画面にしか見えず、
         * 配り直しても直らない（キャッシュから出しているため）。
         *
         * そこで「これは確かにこのアプリの本体である」ことを見てから入れる。
         * id="root" は本体を描く器で、遮断ページにも 404 ページにも無い。
         */
        if (response.ok) {
          const copy = response.clone();
          copy.text().then((html) => {
            if (!html.includes('id="root"')) return;   // 本体でないものは入れない
            caches.open(CACHE_VERSION)
              .then((cache) => cache.put('./index.html', new Response(html, {
                status: 200,
                headers: { 'Content-Type': 'text/html; charset=utf-8' },
              })));
          }).catch(() => {});
        }
        return response;
      } catch {
        // 自アプリのキャッシュだけを見る。caches.match は引数だけだと
        // 同じドメインに同居する他アプリのキャッシュまで探しに行く。
        const cache = await caches.open(CACHE_VERSION);
        return (await cache.match('./index.html'))
          || (await cache.match('./offline.html'))
          || Response.error();
      }
    })());
    return;
  }

  // その他のアセットはキャッシュ優先＋バックグラウンド更新
  // （校内Wi-Fiが混んでいても即表示される）
  event.respondWith(
    caches.open(CACHE_VERSION).then((cache) => cache.match(request)).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);

      return cached || network;
    }),
  );
});

// 画面のトーストで「さいしんに する」が押されたときだけ切り替える
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
