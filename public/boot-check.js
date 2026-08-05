/*
 * 「開いたのに真っ白」から、児童と先生が自力で戻れるようにするための番人。
 *
 * なぜ要るか：
 *   このアプリは Service Worker で端末にキャッシュを持つ。
 *   一度おかしなものが焼き付くと、以後は配り直しても同じ画面が出続ける。
 *   本体（React）が動かなかった場合、body には何も無いので画面は真っ白になり、
 *   児童からは「こわれた」としか見えず、直す手立てが画面上に一つも無い。
 *   ここは本体とは別のファイルなので、本体が読めない・落ちた場合でも動く。
 *
 * 出す条件は「本体が描画できていない」こと1点だけ。
 *   ・js/css の読み込みが失敗したら、その時点で（読み込み失敗は確定なので短く待つ）
 *   ・そうでなければ 10 秒。校内 Wi-Fi が遅いだけの端末に出さないための余裕。
 *   本体が後から描けたら、この画面は自分で消える。
 *
 * ⚠️ 直すボタンが消すのは kabe-kabe- で始まるキャッシュだけにする。
 *    gigayama.github.io は数十本の学習アプリが同じドメインを共有しており、
 *    caches.keys() は他アプリのぶんまで返す。まとめて消すと、
 *    別のアプリがオフラインで開かなくなる（sw.js 冒頭【重要1】と同じ理由）。
 *
 * ⚠️ CSP は script-src 'self' なので、ここへインラインの <script> や onclick= は書けない。
 *    ボタンは addEventListener で繋ぐ。style 属性は style-src の 'unsafe-inline' で通る。
 */
(function () {
  var CACHE_PREFIX = 'kabe-kabe-';
  var GRACE_MS = 10000;          // ふつうに待つ時間
  var GRACE_AFTER_ERROR_MS = 1500; // 読み込みが失敗したと分かっているときの待ち時間

  // 先生が報告できるように、起きたことをそのまま控えておく。
  var notes = [];
  var timer = null;
  var shown = false;

  var note = function (text) {
    if (notes.length < 8 && notes.indexOf(text) < 0) notes.push(text);
  };

  var mounted = function () {
    var root = document.getElementById('root');
    return !!root && root.childElementCount > 0;
  };

  var schedule = function (ms) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(check, ms);
  };

  // 本体の js / css が読めなかった場合。これは待っても直らないので早めに出す。
  window.addEventListener('error', function (e) {
    var el = e.target;
    if (el && el !== window && (el.tagName === 'SCRIPT' || el.tagName === 'LINK')) {
      note('よみこめなかったファイル: ' + (el.src || el.href || el.tagName));
      schedule(GRACE_AFTER_ERROR_MS);
    } else if (e.message) {
      note('エラー: ' + e.message);
    }
  }, true);

  window.addEventListener('unhandledrejection', function (e) {
    note('エラー: ' + ((e.reason && e.reason.message) || e.reason));
  });

  /*
   * 直したあとに開き直すアドレスを作る。
   *
   * ⚠️ fix は必ず外すこと。付けたまま開き直すと、また直しにいって終わらなくなる。
   * ⚠️ r（時刻）を足すのは、同じものがキャッシュから返ってくると
   *    直ったのかどうか分からなくなるため。
   */
  var cleanUrl = function () {
    var parts = location.href.split('#')[0].split('?');
    var query = (parts[1] || '').split('&').filter(function (kv) {
      return kv && kv.split('=')[0] !== 'fix' && kv.split('=')[0] !== 'r';
    });
    query.push('r=' + Date.now());
    return parts[0] + '?' + query.join('&');
  };

  var repair = function (button) {
    if (button) {
      button.disabled = true;
      button.textContent = 'なおしています…';
    }

    var done = function () { location.replace(cleanUrl()); };

    var jobs = [];

    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      jobs.push(navigator.serviceWorker.getRegistrations().then(function (regs) {
        return Promise.all(regs.map(function (r) {
          // このアプリの担当ぶんだけ外す。ドメインを共有している他アプリのものは触らない。
          return r.scope.indexOf(location.origin + location.pathname.replace(/[^/]*$/, '')) === 0
            ? r.unregister()
            : null;
        }));
      }).catch(function () {}));
    }

    if (window.caches && caches.keys) {
      jobs.push(caches.keys().then(function (keys) {
        return Promise.all(keys.map(function (key) {
          return key.indexOf(CACHE_PREFIX) === 0 ? caches.delete(key) : null;
        }));
      }).catch(function () {}));
    }

    Promise.all(jobs).then(done, done);
    // 端末が固まっても必ず読み直す
    setTimeout(done, 4000);
  };

  var el = function (tag, style, text) {
    var node = document.createElement(tag);
    if (style) node.setAttribute('style', style);
    if (text) node.textContent = text;
    return node;
  };

  var show = function () {
    shown = true;
    var box = el('div', 'position:fixed;inset:0;z-index:99999;overflow:auto;'
      + 'background:#fff9c4;color:#1f2937;display:flex;align-items:center;justify-content:center;'
      + 'padding:24px;font-family:ui-rounded,"Hiragino Maru Gothic ProN",system-ui,sans-serif;');
    box.id = 'boot-recovery';

    var card = el('div', 'max-width:520px;width:100%;background:#fff;border-radius:20px;'
      + 'padding:28px 24px;box-shadow:0 8px 24px rgba(0,0,0,.14);text-align:center;');

    card.appendChild(el('div', 'font-size:56px;line-height:1;margin-bottom:12px;', '🚧'));
    card.appendChild(el('h1', 'font-size:24px;font-weight:700;margin:0 0 12px;color:#1f2937;',
      'うまく ひらけませんでした'));
    card.appendChild(el('p', 'font-size:16px;line-height:1.7;margin:0 0 20px;color:#374151;',
      'したの ボタンを じゅんばんに おしてみてください。'));

    var reload = el('button', 'display:block;width:100%;margin:0 0 12px;padding:16px;'
      + 'font-size:18px;font-weight:700;color:#fff;background:#2563eb;border:0;border-radius:14px;'
      + 'cursor:pointer;min-height:56px;', '❶ もういちど よみこむ');
    reload.addEventListener('click', function () { location.reload(); });
    card.appendChild(reload);

    var fix = el('button', 'display:block;width:100%;margin:0 0 20px;padding:16px;'
      + 'font-size:18px;font-weight:700;color:#fff;background:#b45309;border:0;border-radius:14px;'
      + 'cursor:pointer;min-height:56px;', '❷ なおす（ほぞんを けす）');
    fix.addEventListener('click', function () { repair(fix); });
    card.appendChild(fix);

    card.appendChild(el('p', 'font-size:13px;line-height:1.6;margin:0 0 16px;color:#6b7280;',
      '「なおす」を おしても とくてんや せっていは きえません。'));

    if (notes.length) {
      var details = document.createElement('details');
      details.setAttribute('style', 'text-align:left;font-size:12px;color:#6b7280;');
      var summary = el('summary', 'cursor:pointer;padding:6px 0;min-height:32px;',
        '先生へ：くわしい情報');
      details.appendChild(summary);
      details.appendChild(el('pre', 'white-space:pre-wrap;word-break:break-all;margin:8px 0 0;'
        + 'font-size:11px;line-height:1.5;', notes.join('\n')));
      card.appendChild(details);
    }

    box.appendChild(card);
    (document.body || document.documentElement).appendChild(box);
  };

  var hide = function () {
    var box = document.getElementById('boot-recovery');
    if (box && box.parentNode) box.parentNode.removeChild(box);
    shown = false;
  };

  function check() {
    if (mounted()) {
      if (shown) hide();      // 遅れて描けた場合は引っ込む
      return;                 // 以後は見張らない
    }
    if (!shown) show();
    schedule(1000);           // 本体が後から立ち上がったら消すために見続ける
  }

  /*
   * 先生が配れる「直すためのアドレス」。末尾に ?fix=1 を付けて開くと、
   * 画面を待たずにその場で直して開き直す。
   *
   * 画面のボタンは、番人が出て初めて押せる。しかし本体が中途半端に描けている
   * 端末（画面は出るが動かない等）では番人が出ないため、押す手立てが無い。
   * 一斉に配れる形が要る、というのが足した理由である。
   */
  if (location.search.indexOf('fix=1') >= 0) {
    if (document.body) repair(null);
    else window.addEventListener('DOMContentLoaded', function () { repair(null); });
  } else {
    schedule(GRACE_MS);
  }
})();
