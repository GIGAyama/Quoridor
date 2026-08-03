/* 【重要】キャッシュの掃除は、かならず自アプリのぶんだけに限る。
 *
 * gigayama.github.io は数十本の学習アプリが同じドメインを共有している。
 * ブラウザのキャッシュはドメイン単位なので、caches.keys() はこのアプリのものだけでなく、
 * 同居する全アプリのキャッシュを返す。
 *
 * これまでは「CACHE_VERSION 以外ぜんぶ」を消していたため、このアプリを開いて
 * 新しい Service Worker が有効になった瞬間、その端末に入っていた
 * 児童むけアプリ（Qalc・KANJI_Town など）のオフライン用データまで消えていた。
 * 児童がオフラインで開いても起動せず、しかも原因がそのアプリ側に見えないため
 * 「たまに開かなくなる」という再現しにくい不具合になっていた。 */
const CACHE_PREFIX = 'kabe-kabe-';
const CACHE_VERSION = CACHE_PREFIX + 'v3';
// 相対URLで指定し、ルート直下でもサブパス配信でも正しく解決されるようにする
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_VERSION)
        .map((key) => caches.delete(key))))   // ← 自アプリ分だけ削除
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // ナビゲーションはネットワーク優先（最新のHTMLを取得し、オフライン時はキャッシュへフォールバック）
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  // その他のアセットはキャッシュ優先＋バックグラウンド更新
  event.respondWith(
    caches.match(request).then((cached) => {
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
