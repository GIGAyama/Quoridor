/*
 * 実ブラウザで測るときの共通処理。
 *
 * ここに置いてあるのは「ページの中に流し込む関数のソース文字列」である。
 * Playwright の evaluate へ渡して、ブラウザの中で走らせる。
 *
 * 読むだけでは分からないこと（実際の色・実際の当たり判定）を測るための道具なので、
 * 計算はすべて getComputedStyle と getBoundingClientRect の実測値から行う。
 */

/**
 * ページ内に注入する計測コード。
 * window.__giga に測定関数を生やす。
 */
export const INJECTED_MEASURE_SOURCE = `
(() => {
  // ---- 色の読み取り -------------------------------------------------------
  // Tailwind v4 は色を oklch() で書き出すため、数字を正規表現で拾うと
  // oklch(0.554 0.046 257.417) を rgb(0.554, 0.046, 257.417) と読み違えて
  // 「ほぼ真っ黒」と判定してしまう。ctx.fillStyle に入れて読み返しても
  // Chrome は色空間を保つので oklch のまま返る。
  // → 1px 実際に塗って getImageData で読む。これがいちばん確実。
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  function parseColor(s) {
    if (!s) return [0, 0, 0, 0];
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000';
    ctx.fillStyle = s;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    const a = d[3] / 255;
    return a === 0 ? [0, 0, 0, 0] : [d[0] / a, d[1] / a, d[2] / a, a];
  }

  function srgbToLin(v) {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function luminance([r, g, b]) {
    return 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
  }
  function contrast(fg, bg) {
    const l1 = luminance(fg), l2 = luminance(bg);
    const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  }
  // 半透明の前景を背景の上に重ねた実際の見え方
  function over(fg, bg) {
    const a = fg[3];
    return [
      fg[0] * a + bg[0] * (1 - a),
      fg[1] * a + bg[1] * (1 - a),
      fg[2] * a + bg[2] * (1 - a),
      1,
    ];
  }

  // グラデーション背景は backgroundColor が透明になる。
  // backgroundImage を見ないと「白の上の白（比 1.0）」という誤報になるので、
  // グラデーションの中の色を全部拾い、いちばん不利（＝コントラストが低い）ものを採る。
  function gradientStops(bgImage) {
    if (!bgImage || bgImage === 'none') return [];
    const out = [];
    const re = /(rgba?\\([^)]*\\)|oklch\\([^)]*\\)|color\\([^)]*\\)|#[0-9a-fA-F]{3,8})/g;
    let m;
    while ((m = re.exec(bgImage)) !== null) {
      const c = parseColor(m[1]);
      if (c[3] > 0.05) out.push(c);
    }
    return out;
  }

  // 要素の後ろにある「実際に見えている色」を、祖先をたどって合成する。
  // 戻り値は候補の配列（グラデーションがあると複数になる）。
  function backdropColors(el) {
    let stack = [[255, 255, 255, 1]];   // いちばん後ろは白（キャンバス地）とみなす
    const chain = [];
    for (let n = el; n && n !== document.documentElement.parentNode; n = n.parentElement) {
      chain.unshift(n);
    }
    for (const n of chain) {
      const cs = getComputedStyle(n);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const layers = [];
      const bc = parseColor(cs.backgroundColor);
      if (bc[3] > 0) layers.push(bc);
      for (const g of gradientStops(cs.backgroundImage)) layers.push(g);
      if (layers.length === 0) continue;
      const next = [];
      for (const base of stack) {
        for (const l of layers) next.push(over(l, base));
      }
      // 候補が増えすぎないよう、明るい方と暗い方の代表だけ残す
      next.sort((a, b) => luminance(a) - luminance(b));
      stack = next.length > 4 ? [next[0], next[next.length - 1]] : next;
    }
    return stack;
  }

  const EMOJI = /[\\u{1F000}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{FE0F}\\u{1F1E6}-\\u{1F1FF}\\u{2B00}-\\u{2BFF}\\u{2190}-\\u{21FF}]/u;

  function visible(el) {
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    if (parseFloat(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // 使用不可の状態は WCAG の対象外。濃くすると「もう済んだもの」が押せるように見える。
  function isDisabled(el) {
    for (let n = el; n; n = n.parentElement) {
      if (n.disabled === true) return true;
      if (n.getAttribute && n.getAttribute('aria-disabled') === 'true') return true;
      if (n.classList && (n.classList.contains('cursor-not-allowed') ||
          n.classList.contains('opacity-50'))) return true;
    }
    return false;
  }

  function describe(el) {
    const parts = [el.tagName.toLowerCase()];
    if (el.id) parts.push('#' + el.id);
    const cls = (el.getAttribute && el.getAttribute('class')) || '';
    if (cls) parts.push('.' + cls.trim().split(/\\s+/).slice(0, 6).join('.'));
    return parts.join('');
  }

  // ---- コントラスト -------------------------------------------------------
  window.__giga = window.__giga || {};
  window.__giga.contrast = function () {
    const results = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent.replace(/\\s+/g, ' ').trim();
      if (!text) continue;
      const el = node.parentElement;
      if (!el || !visible(el)) continue;
      if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue;
      // 絵文字はフォント自身の色で描かれ CSS の color が効かない。除外しないと誤報になる。
      const stripped = text.replace(EMOJI, '').trim();
      if (!stripped) continue;
      if (isDisabled(el)) continue;

      const cs = getComputedStyle(el);
      let fg = parseColor(cs.color);
      const backs = backdropColors(el);
      const fontPx = parseFloat(cs.fontSize);
      const weight = parseInt(cs.fontWeight, 10) || 400;
      // 大きい文字（24px以上、または18.66px以上かつ太字）は 3:1
      const large = fontPx >= 24 || (fontPx >= 18.66 && weight >= 700);
      const need = large ? 3 : 4.5;

      let worst = Infinity, worstBg = null;
      for (const bg of backs) {
        const composited = fg[3] < 1 ? over(fg, bg) : fg;
        const ratio = contrast(composited, bg);
        if (ratio < worst) { worst = ratio; worstBg = bg; }
      }
      if (worst + 0.005 < need) {
        results.push({
          text: text.slice(0, 40),
          selector: describe(el),
          color: cs.color,
          bg: worstBg ? 'rgb(' + worstBg.slice(0, 3).map(Math.round).join(',') + ')' : '?',
          fontPx: Math.round(fontPx * 10) / 10,
          weight,
          ratio: Math.round(worst * 100) / 100,
          need,
        });
      }
    }
    return results;
  };

  // ---- タップ領域 ---------------------------------------------------------
  // ボタン本体が小さくても、疑似要素で当たり判定だけを広げてある場合がある。
  // ::after / ::before の実効サイズも足して測る。
  window.__giga.tapTargets = function () {
    const SEL = 'a[href], button, input, select, textarea, [role="button"], [onclick], [tabindex]:not([tabindex="-1"])';
    const out = [];
    for (const el of document.querySelectorAll(SEL)) {
      if (!visible(el) || isDisabled(el)) continue;
      const r = el.getBoundingClientRect();
      let w = r.width, h = r.height;
      for (const pseudo of ['::after', '::before']) {
        const cs = getComputedStyle(el, pseudo);
        if (cs.content === 'none' || cs.position === 'static') continue;
        const pw = parseFloat(cs.width), ph = parseFloat(cs.height);
        const mw = parseFloat(cs.minWidth), mh = parseFloat(cs.minHeight);
        if (Number.isFinite(pw)) w = Math.max(w, Number.isFinite(mw) ? Math.max(pw, mw) : pw);
        if (Number.isFinite(ph)) h = Math.max(h, Number.isFinite(mh) ? Math.max(ph, mh) : ph);
      }
      if (w < 43.5 || h < 43.5) {
        out.push({
          selector: describe(el),
          text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24),
          w: Math.round(w * 10) / 10,
          h: Math.round(h * 10) / 10,
        });
      }
    }
    return out;
  };

  // ---- 横スクロール -------------------------------------------------------
  window.__giga.overflow = function () {
    const doc = document.documentElement;
    const over = doc.scrollWidth - doc.clientWidth;
    const culprits = [];
    if (over > 1) {
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        if (r.right > doc.clientWidth + 1 || r.left < -1) {
          culprits.push({ selector: describe(el), left: Math.round(r.left), right: Math.round(r.right) });
        }
      }
    }
    return { overflowPx: over, scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth,
             culprits: culprits.slice(0, 8) };
  };
})();
`;

/** 静的ファイルを配る簡易サーバ（CORS ヘッダー付き）。 */
export async function serveDir(dir, port) {
  const http = await import('node:http');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.map': 'application/json',
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let file = path.join(dir, decodeURIComponent(url.pathname));
    if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
    if (!file.startsWith(dir)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found'); return; }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
        // crossorigin を付けた資産は CORS 応答でないとブラウザが弾く
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      });
      res.end(data);
    });
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return server;
}
