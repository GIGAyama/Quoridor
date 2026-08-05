/*
 * GIGA Standard v5 Part I の「静的に読めば分かる」検査。
 *
 * 実ブラウザで測らないと分からないもの（コントラスト・タップ領域・
 * Service Worker の挙動・アイコンの画素）は tools/ 側で測る。
 * ここには、読めば分かるのに見落とされやすいものだけを置く。
 *
 * ⚠️ 検査を書くときの落とし穴（実際に踏まれたもの）
 *   1. SW_CACHE_WIPE は「消す式」を正規表現で追うと (k) => caches.delete(k) を見落とす。
 *      見るべきは「startsWith で自アプリぶんに絞る式があるか」。
 *   2. SW_LOCALSTORAGE は「localStorage は操作しない」という注意書きに反応する。
 *      判定の前にコメントを落とす。
 *   3. VIEWPORT_100VH は @supports not (height: 100dvh) { … 100vh } を
 *      正しいフォールバックとして通す必要がある。ただし「近くに 100dvh があれば通す」
 *      では、壊れた 100vh の直後にフォールバックが続いているときに素通りする。
 *      入れ物（@supports の中か、同じ宣言ブロックか）で判断する。
 *
 * この3件と、あと2件は --self-test（わざと壊して落ちるか確かめる）で見つかった。
 * 検査を足したら、必ず対応する「壊し方」も scripts/check-project.mjs へ足すこと。
 * 「0件でした」だけでは、何も見ていない検査と区別が付かない。
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';

/** コメントを落とす（注意書きに検査が反応しないように） */
export const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  .replace(/<!--[\s\S]*?-->/g, '');

const read = (root, p) => {
  const full = join(root, p);
  return existsSync(full) ? readFileSync(full, 'utf8') : null;
};

const walk = (dir, out = []) => {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git', 'dist'].includes(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};

const kb = (bytes) => Math.round((bytes / 1024) * 10) / 10;

/**
 * @returns {{id:string, ok:boolean, detail:string, severity:'P0'|'P1'|'P2'|'P3'}[]}
 */
export function runChecks(root, config) {
  const results = [];
  const add = (id, ok, detail, severity = 'P1') => results.push({ id, ok, detail, severity });

  const files = walk(root);
  const repo = config.repoName;

  // ---- 法務・配布 (P0) ----------------------------------------------------
  add('A1_LICENSE', existsSync(join(root, 'LICENSE')),
    existsSync(join(root, 'LICENSE')) ? 'あり' : 'LICENSE の実ファイルが無い', 'P0');
  add('A2_GITIGNORE', existsSync(join(root, '.gitignore')), '', 'P0');
  add('A3_DEPENDABOT', existsSync(join(root, '.github/dependabot.yml')), '', 'P0');
  for (const doc of ['README.md', 'MANUAL.md', 'AUDIT.md']) {
    add(`A4_${doc.replace('.md', '')}`, existsSync(join(root, doc)), '', 'P3');
  }

  // ---- 依存：CDN から取る実行コードは 0 バイト (P0.5) ----------------------
  const webFiles = files.filter((f) => ['.html', '.jsx', '.js', '.ts', '.tsx'].includes(extname(f))
    && !f.includes('/tools/') && !f.includes('/scripts/') && !f.includes('/tests/'));
  const cdnHits = [];
  for (const f of webFiles) {
    const src = stripComments(readFileSync(f, 'utf8'));
    for (const pattern of ['@babel/standalone', 'cdn.tailwindcss.com', 'unpkg.com',
      'cdn.jsdelivr.net', 'cdnjs.cloudflare.com']) {
      if (src.includes(pattern)) cdnHits.push(`${f.replace(root + '/', '')}: ${pattern}`);
    }
  }
  add('B6_NO_CDN_EXEC', cdnHits.length === 0,
    cdnHits.length ? cdnHits.join(', ') : 'CDN から取る実行コードは 0 件', 'P0');

  // ---- viewport ------------------------------------------------------------
  const html = read(root, 'index.html') || '';
  add('D1_VIEWPORT_COVER', /viewport-fit=cover/.test(html),
    /viewport-fit=cover/.test(html) ? '' : 'viewport に viewport-fit=cover が無い');
  const noScale = /user-scalable\s*=\s*no|maximum-scale\s*=\s*1/.test(html);
  add('D14_NO_ZOOM_LOCK', !noScale,
    noScale ? '拡大を禁止している（見えづらい子が拡大できなくなる）' : '拡大を禁止していない');

  // ---- 100vh の単独使用 ----------------------------------------------------
  // ⚠️ @supports not (height: 100dvh) { … 100vh } は正しいフォールバックなので通す。
  //    見つけた 100vh の前方 400 文字に dvh か @supports があるかを見る。
  const cssFiles = files.filter((f) => ['.css'].includes(extname(f)));

  /*
   * ⚠️ ここは自己確認（--self-test）で1度落ちている。
   *    もとは「100vh の後ろ 200 文字に 100dvh があれば通す」という作りだった。
   *    ところが正しい書き方では 100vh の直後に
   *      @supports not (height: 100dvh) { … }
   *    が続くため、壊れた 100vh のほうまで「後ろに 100dvh がある」として通っていた。
   *    見るべきは「その 100vh が、どの入れ物の中にあるか」である。
   *      ・@supports not (… 100dvh …) { … } の中にある  → 正しいフォールバック
   *      ・同じ宣言ブロックの中に 100dvh もある          → 正しい上書き
   *    どちらでもなければ単独使用。
   */
  const supportsRegions = (src) => {
    const out = [];
    const re = /@supports[^{]*100dvh[^{]*\{/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      let depth = 0;
      let i = m.index + m[0].length - 1;
      for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) break; }
      }
      out.push([m.index, i]);
    }
    return out;
  };
  const enclosingBlock = (src, at) => {
    let start = -1;
    let depth = 0;
    for (let i = at; i >= 0; i--) {
      if (src[i] === '}') depth++;
      else if (src[i] === '{') { if (depth === 0) { start = i; break; } depth--; }
    }
    if (start < 0) return '';
    let end = start;
    depth = 0;
    for (let i = start; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    return src.slice(start, end + 1);
  };

  const lonely100vh = [];
  for (const f of [...cssFiles, ...webFiles]) {
    const src = stripComments(readFileSync(f, 'utf8'));
    const regions = supportsRegions(src);
    let m;
    const re = /100vh/g;
    while ((m = re.exec(src)) !== null) {
      const inSupports = regions.some(([a, b]) => m.index > a && m.index < b);
      const block = enclosingBlock(src, m.index);
      if (!inSupports && !/100dvh/.test(block)) {
        lonely100vh.push(`${f.replace(root + '/', '')}:${src.slice(0, m.index).split('\n').length}`);
      }
    }
    // Tailwind の min-h-screen / h-screen も 100vh
    for (const cls of ['min-h-screen', 'h-screen']) {
      if (src.includes(cls)) lonely100vh.push(`${f.replace(root + '/', '')}: ${cls}（= 100vh）`);
    }
  }
  add('D2_DVH', lonely100vh.length === 0,
    lonely100vh.length ? lonely100vh.join(', ') : '100vh の単独使用なし');

  // ---- safe-area / clamp / forced-colors / reduced-motion ------------------
  const allCss = cssFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
  add('D3_SAFE_AREA', /safe-area-inset/.test(allCss), '');
  // 前が識別子でないことを見る。notclamp( のような別の語に当たらないようにするため。
  const hasClamp = /(^|[\s:,(])clamp\(/.test(allCss);
  add('D4_FLUID_TYPE', hasClamp, hasClamp ? '' : 'clamp() が1つも無い');
  add('D11_FORCED_COLORS', /forced-colors:\s*active/.test(allCss), '');
  // ⚠️ .01ms であって 0 ではない。0 にすると fill-mode: forwards が壊れ、
  //    fadeIn 系の要素が opacity: 0 のまま消える。
  const rm = allCss.match(/@media[^{]*prefers-reduced-motion[^{]*\{[\s\S]*?\n\}/);
  const rmZero = rm ? /animation-duration:\s*0s?\s*!/.test(rm[0]) || /transition-duration:\s*0s?\s*!/.test(rm[0]) : false;
  add('D10_REDUCED_MOTION', !!rm && !rmZero,
    !rm ? 'prefers-reduced-motion の指定が無い'
      : rmZero ? '0 を指定している（fill-mode: forwards が壊れ、要素が消える）' : '.01ms');

  // ---- rt（ふりがな）の色を決め打ちしていないか ----------------------------
  const rtHits = [];
  for (const f of [...cssFiles, ...webFiles]) {
    const src = stripComments(readFileSync(f, 'utf8'));
    // CSS 側： rt { … color: #xxx }（inherit / currentColor は可）
    for (const m of src.matchAll(/(^|[\s,>])rt\s*\{([^}]*)\}/g)) {
      const body = m[2];
      const color = body.match(/(?:^|;)\s*color\s*:\s*([^;]+)/);
      if (color && !/inherit|currentcolor/i.test(color[1])) {
        rtHits.push(`${f.replace(root + '/', '')}: rt { color: ${color[1].trim()} }`);
      }
    }
    // JSX 側： <rt className="… text-gray-500 …">
    for (const m of src.matchAll(/<rt[^>]*className="([^"]*)"/g)) {
      const cls = m[1].match(/(?:^|\s)(text-\w+-\d{2,3})(?:\s|$)/);
      if (cls) rtHits.push(`${f.replace(root + '/', '')}: <rt className="… ${cls[1]} …">`);
    }
  }
  add('F4_RT_COLOR', rtHits.length === 0,
    rtHits.length ? rtHits.join(', ') : 'rt の色を決め打ちしていない');

  // ---- Service Worker ------------------------------------------------------
  const swPath = ['public/sw.js', 'sw.js', 'docs/sw.js'].find((p) => existsSync(join(root, p)));
  const swRaw = swPath ? readFileSync(join(root, swPath), 'utf8') : null;
  const sw = swRaw ? stripComments(swRaw) : null;
  add('E_SW_EXISTS', !!sw, swPath || 'sw.js が無い');

  if (sw) {
    // ⚠️ 「消す式」ではなく「startsWith で絞る式があるか」を見る。
    //    (k) => caches.delete(k) の形だと、削除式を追う書き方では見落とす。
    const wipes = /caches\.keys\(\)/.test(sw);
    const narrowed = /startsWith\s*\(/.test(sw);
    add('E5_SW_CACHE_SCOPE', !wipes || narrowed,
      !wipes ? 'caches.keys() を使っていない'
        : narrowed ? 'startsWith で自アプリぶんに絞っている'
          : 'caches.keys() を全消ししている（同居する他アプリのオフラインを壊す）', 'P0');

    // ⚠️ コメントを落としてから見ないと「localStorage は操作しない」に反応する
    add('E6_SW_NO_LOCALSTORAGE', !/localStorage/.test(sw), '');

    /*
     * install の中で skipWaiting していないか（対戦の途中で画面が入れ替わる）。
     *
     * ⚠️ ここも自己確認で1度落ちている。
     *    もとは /addEventListener\('install'[\s\S]*?\n\}\)\);/ という正規表現で
     *    ブロックの終わりを探していたが、実際の sw.js は
     *      self.addEventListener('install', (event) => { event.waitUntil((async () => { … })()); });
     *    という形で、探していた行の並びがどこにも無かった。
     *    そのため installBlock が常に null になり、この検査は何も見ていなかった。
     *    括弧を数えて範囲を取る。
     */
    const installAt = sw.indexOf("addEventListener('install'");
    let installBlock = '';
    if (installAt >= 0) {
      let depth = 0;
      let started = false;
      for (let i = installAt; i < sw.length; i++) {
        if (sw[i] === '(' || sw[i] === '{') { depth++; started = true; }
        else if (sw[i] === ')' || sw[i] === '}') {
          depth--;
          if (started && depth === 0) { installBlock = sw.slice(installAt, i + 1); break; }
        }
      }
    }
    const skipInInstall = /skipWaiting/.test(installBlock);
    add('E7_NO_SKIP_WAITING_IN_INSTALL', installAt >= 0 && !skipInInstall,
      installAt < 0 ? 'install の受け口が見つからない'
        : skipInInstall ? 'install の中で skipWaiting している（押す前に切り替わる）' : '');

    // 押されたときだけ切り替えるための受け口があるか
    add('E7b_SKIP_WAITING_MESSAGE', /SKIP_WAITING/.test(sw),
      /SKIP_WAITING/.test(sw) ? '' : '更新を押して切り替える受け口が無い');

    add('E11_APP_VERSION', /APP_VERSION\s*=/.test(sw),
      (sw.match(/APP_VERSION\s*=\s*'([^']+)'/) || [])[1] || 'APP_VERSION が無い');

    // ハッシュ付きの js/css を先読みに入れているか（圏外での初回起動）
    add('E_PRECACHE_BUILD_ASSETS', /BUILD_ASSETS/.test(sw),
      /BUILD_ASSETS/.test(sw) ? '' : 'ビルド成果物を先読みしていない（初回のあと圏外で白い画面になる）');
  }

  add('E10_OFFLINE_HTML', existsSync(join(root, 'public/offline.html'))
    || existsSync(join(root, 'offline.html')), '');

  // offline.html が外部資産や JS に頼っていないこと
  const offline = read(root, 'public/offline.html');
  if (offline) {
    const bad = [];
    if (/<script/i.test(offline)) bad.push('<script> がある');
    if (/https?:\/\//.test(offline.replace(/<!--[\s\S]*?-->/g, ''))) bad.push('外部への参照がある');
    if (/onclick=/i.test(offline)) bad.push('onclick= がある（CSP で動かない）');
    add('E10b_OFFLINE_SELF_CONTAINED', bad.length === 0, bad.join(', ') || '自前で完結している');
  }

  // ---- install-hook（外部ファイルで、head の先頭に近いこと）----------------
  add('E3_INSTALL_HOOK_FILE', existsSync(join(root, 'public/install-hook.js')), '');
  // ⚠️ ここも自己確認で1度落ちている。
  //    コメントを落とさずに探していたため、
  //    「捕捉も install-hook.js に置いている」という説明文に反応し、
  //    <script> を消しても通っていた。
  const htmlNoComments = stripComments(html);
  const hookIdx = htmlNoComments.indexOf('install-hook.js');
  const rootIdx = htmlNoComments.indexOf('src/main.jsx');
  add('E3b_INSTALL_HOOK_FIRST', hookIdx > 0 && (rootIdx < 0 || hookIdx < rootIdx),
    hookIdx < 0 ? 'index.html が install-hook.js を読んでいない'
      : '本体より先に読んでいる');

  // ---- manifest ------------------------------------------------------------
  const manifestPath = ['public/manifest.webmanifest', 'manifest.webmanifest']
    .find((p) => existsSync(join(root, p)));
  if (manifestPath) {
    const mf = JSON.parse(readFileSync(join(root, manifestPath), 'utf8'));
    const want = `/${repo}/`;
    const wrong = ['id', 'scope', 'start_url'].filter((k) => mf[k] !== want);
    add('E1_MANIFEST_PATHS', wrong.length === 0,
      wrong.length ? `${wrong.map((k) => `${k}=${mf[k]}`).join(', ')}（すべて ${want} にする）` : want, 'P0');
    const purposes = (mf.icons || []).map((i) => i.purpose);
    add('E2_ICON_PURPOSES', purposes.includes('any') && purposes.includes('maskable'), '');
  } else {
    add('E1_MANIFEST_PATHS', false, 'manifest が無い', 'P0');
  }

  add('E2b_APPLE_TOUCH_ICON', /apple-touch-icon/.test(html), '');

  // ---- CSP -----------------------------------------------------------------
  const csp = (html.match(/http-equiv="Content-Security-Policy"[\s\S]*?content="([^"]*)"/) || [])[1];
  add('B1_CSP', !!csp, csp ? '' : 'CSP が無い', 'P0');
  if (csp) {
    const scriptSrc = (csp.match(/script-src([^;]*)/) || [])[1] || '';
    add('B1b_CSP_NO_UNSAFE_INLINE_SCRIPT', !/'unsafe-inline'/.test(scriptSrc),
      /'unsafe-inline'/.test(scriptSrc)
        ? "script-src に 'unsafe-inline' がある（CSP を入れた意味がほとんど無い）" : '', 'P0');
    // <meta> の frame-ancestors は無視され、警告が出るだけ
    add('B1c_CSP_NO_FRAME_ANCESTORS', !/frame-ancestors/.test(csp),
      /frame-ancestors/.test(csp) ? '<meta> の frame-ancestors は無視される（警告が出るだけ）' : '');
  }

  // ---- 禁止事項 ------------------------------------------------------------
  const appSrc = webFiles.map((f) => stripComments(readFileSync(f, 'utf8'))).join('\n');
  add('C5_NO_LOCALSTORAGE_CLEAR', !/localStorage\.clear\s*\(/.test(appSrc), '', 'P0');
  add('B4_NO_POSTMESSAGE_STAR', !/postMessage\([^)]*,\s*['"]\*['"]\s*\)/.test(appSrc), '', 'P0');

  // ---- サイズ --------------------------------------------------------------
  const big = [];
  for (const f of [...webFiles, ...cssFiles]) {
    const src = readFileSync(f, 'utf8');
    const lines = src.split('\n').length;
    const size = kb(Buffer.byteLength(src));
    if (lines > config.limits.maxFileLines || size > config.limits.maxFileKB) {
      big.push(`${f.replace(root + '/', '')} (${lines}行 / ${size}KB)`);
    }
  }
  add('F6_FILE_SIZE', big.length === 0, big.join(', ') || '上限内', 'P3');

  const images = files.filter((f) => ['.png', '.jpg', '.jpeg', '.webp'].includes(extname(f))
    && !f.includes('/tools/'));
  const heavy = [];
  for (const f of images) {
    const size = kb(statSync(f).size);
    const name = f.replace(root + '/', '');
    let limit = config.limits.maxImageKB;
    if (/favicon\.png$/.test(name)) limit = config.limits.maxFaviconKB;
    else if (/icon-512|maskable-512/.test(name)) limit = config.limits.maxIcon512KB;
    if (size > limit) heavy.push(`${name} ${size}KB (上限 ${limit}KB)`);
  }
  add('D7_IMAGE_SIZE', heavy.length === 0, heavy.join(', ') || `${images.length}枚すべて上限内`, 'P2');

  // ---- 初回 JS -------------------------------------------------------------
  const assetsDir = join(root, 'dist/assets');
  if (existsSync(assetsDir)) {
    const js = readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
    const total = js.reduce((s, f) => s + statSync(join(assetsDir, f)).size, 0);
    add('F5_INITIAL_JS', kb(total) <= config.limits.maxInitialJsKB,
      `${kb(total)}KB (上限 ${config.limits.maxInitialJsKB}KB)`, 'P2');
  }

  return results;
}
