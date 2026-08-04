/*
 * Service Worker の登録と、更新の案内。
 *
 * ここは「読んでも分からない」ことが多い場所なので、なぜそう書いたかを残す。
 */

let registration = null;
let userAskedUpdate = false;
let reloading = false;

/**
 * 更新が待機していることを画面へ知らせる。
 * 画面側（App.jsx）がこのイベントを受けてトーストを出す。
 */
const announce = (worker) => {
  window.dispatchEvent(new CustomEvent('pwa-update-ready', { detail: { worker } }));
};

/**
 * 「さいしんに する」を押されたときだけ呼ばれる。
 * ここで初めて新しい版へ切り替える。
 */
export const applyUpdate = () => {
  const waiting = registration && registration.waiting;
  if (!waiting) return;
  userAskedUpdate = true;
  waiting.postMessage({ type: 'SKIP_WAITING' });
};

export const registerServiceWorker = () => {
  if (!('serviceWorker' in navigator)) return;

  // ⚠️ controllerchange は、はじめて開いたときにも飛んでくる。
  //    activate の clients.claim() でページが管理下に入るためである。
  //    これを素直に受けると初回訪問が必ず1回リロードされ、
  //    ゲームでは並べたばかりの盤面が消える。
  //    「もともと管理下だったか」で分ける直し方は、入れた直後に更新を押した場合に
  //    切り替わったのに読み込み直されなくなる。見るべきは利用者が押したかどうかだけ。
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!userAskedUpdate || reloading) return;
    reloading = true;
    window.location.reload();
  });

  const start = async () => {
    try {
      // 相対パスで登録し、ルート直下でもサブパス配信（GitHub Pages 等）でも
      // 正しいスコープになるようにする。
      registration = await navigator.serviceWorker.register(
        new URL('sw.js', window.location.href),
      );

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          // controller が居る＝初回インストールではなく更新。
          // 初回で知らせると「入れた直後に更新があります」と出て混乱する。
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            announce(installing);
          }
        });
      });

      // 前回開いたときにすでに待機していた場合も拾う
      if (registration.waiting && navigator.serviceWorker.controller) {
        announce(registration.waiting);
      }
    } catch (error) {
      console.error('Service worker registration failed:', error);
    }
  };

  // ❌ window.addEventListener('load', …) だけだと、すでに load が済んでいる場合に
  //    リスナーが二度と呼ばれず、Service Worker が黙って登録されないままになる。
  //    （React の effect へ移したときに必ず踏む。ここは module の外側だが、
  //      同じ形を残しておかないと移動したときに壊れる）
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
};
