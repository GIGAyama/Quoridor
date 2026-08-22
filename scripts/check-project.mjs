/*
 * 品質ゲート。
 *
 *   node scripts/check-project.mjs              … 検査する
 *   node scripts/check-project.mjs --self-test  … 検査そのものが動くか確かめる
 *
 * 「0件でした」だけでは、検査が動いているのか何も見ていないのか区別できない。
 * --self-test は、ファイルを1つずつわざと壊した写しを作り、
 * 対応する検査がちゃんと落ちることを確かめる。
 *
 * ## 正本との関係
 *
 * GIGA Standard v5 P4 は、共通の検査 scripts/lib/project-quality.mjs（正本）を
 * バイト単位でコピーし、Part I の検査を scripts/lib/giga-v5-checks.mjs に分け、
 * ここで両者を合成する形を求めている。
 *
 * このリポジトリには正本がまだ置かれていない（他リポジトリから持って来られなかった）。
 * そこで、正本が置かれたらそのまま読み込んで合成できる形にしてある。
 * scripts/lib/project-quality.mjs を置けば、こちらは何も直さずに拾う。
 */
import { readFileSync, mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runChecks } from './lib/giga-v5-checks.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(join(ROOT, 'quality.config.json'), 'utf8'));

// かつてここに、共通の正本 scripts/lib/project-quality.mjs を「あれば足す、
// 無ければ素通り」で読む枝があった。外した理由（2026-08-22 に実測）:
//
//   ・その正本は一度も取り込まれず、「まだ置かれていません」という
//     知らせだけを出しつづけていた。含まれていた秘密の直書きの検査も
//     働かず、src/ と public/ に Google API キーと同じ形の文字列を
//     置いても 37/37 で緑になっていた。
//   ・しかも取り込めば動く、というものでもなかった。この枝は
//     mod.runChecks を探すが、艦隊にある8本のコピーはどれもその名前を
//     export していない（6本が runQualityChecks、1本が run）。
//     実際に置いて走らせても null のまま、やはり何も足さなかった。
//
// 秘密の直書きは tools/check-secrets.mjs が見る（正本 GIGAyama.github.io の
// standards/lib/）。あちらは丸ごと1ファイルで完結し、無ければコマンドごと
// 失敗するので、「取り込み忘れたまま緑」にはならない。
const collect = async (root) => runChecks(root, config);

/*
 * わざと壊す一覧。
 * 「この壊し方をしたら、この検査が落ちるはず」を書いてある。
 * 落ちなければ、その検査は何も見ていない。
 */
const BREAKS = [
  {
    id: 'F4_RT_COLOR',
    file: 'src/styles.css',
    apply: (s) => s.replace('ruby rt {\n  color: inherit;\n}', 'rt {\n  color: #666;\n}'),
  },
  {
    id: 'D2_DVH',
    file: 'src/styles.css',
    apply: (s) => s.replace('.app-shell {\n  min-height: 100dvh;', '.app-shell {\n  min-height: 100vh;'),
  },
  {
    id: 'D11_FORCED_COLORS',
    file: 'src/styles.css',
    apply: (s) => s.replace('@media (forced-colors: active)', '@media (forced-colors: none-of-it)'),
  },
  {
    id: 'D10_REDUCED_MOTION',
    file: 'src/styles.css',
    apply: (s) => s.replace(/animation-duration: 0\.01ms !important;/, 'animation-duration: 0s !important;'),
  },
  {
    id: 'D4_FLUID_TYPE',
    file: 'src/styles.css',
    apply: (s) => s.replace(/clamp\([^)]*\)/g, '18px'),
  },
  {
    id: 'E7_NO_SKIP_WAITING_IN_INSTALL',
    file: 'public/sw.js',
    apply: (s) => s.replace('    // ここでは skipWaiting しない。理由は冒頭【重要2】。',
      '    await self.skipWaiting();'),
  },
  {
    id: 'E5_SW_CACHE_SCOPE',
    file: 'public/sw.js',
    // 「消す式」ではなく「startsWith で絞る式」を見ているかの確認。
    // filter を外して全消しにすると落ちなければならない。
    apply: (s) => s.replace(
      "      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_VERSION)\n",
      "      .filter((key) => key !== CACHE_VERSION)\n"),
  },
  {
    id: 'E6_SW_NO_LOCALSTORAGE',
    file: 'public/sw.js',
    apply: (s) => s.replace("self.addEventListener('message'", "localStorage.getItem('x');\nself.addEventListener('message'"),
  },
  {
    id: 'E_PRECACHE_BUILD_ASSETS',
    file: 'public/sw.js',
    apply: (s) => s.replace(/__PRECACHE_URLS__/g, 'NOTHING_AT_ALL'),
  },
  {
    id: 'B1_CSP',
    file: 'index.html',
    apply: (s) => s.replace('http-equiv="Content-Security-Policy"', 'http-equiv="X-Nothing"'),
  },
  {
    id: 'B1b_CSP_NO_UNSAFE_INLINE_SCRIPT',
    file: 'index.html',
    apply: (s) => s.replace("script-src 'self';", "script-src 'self' 'unsafe-inline';"),
  },
  {
    id: 'B1c_CSP_NO_FRAME_ANCESTORS',
    file: 'index.html',
    apply: (s) => s.replace("object-src 'none';", "object-src 'none'; frame-ancestors 'none';"),
  },
  {
    id: 'D14_NO_ZOOM_LOCK',
    file: 'index.html',
    apply: (s) => s.replace('initial-scale=1, viewport-fit=cover', 'initial-scale=1, user-scalable=no'),
  },
  {
    id: 'D1_VIEWPORT_COVER',
    file: 'index.html',
    apply: (s) => s.replace(', viewport-fit=cover', ''),
  },
  {
    id: 'E3b_INSTALL_HOOK_FIRST',
    file: 'index.html',
    apply: (s) => s.replace('<script src="/install-hook.js"></script>', ''),
  },
  {
    id: 'E1_MANIFEST_PATHS',
    file: 'public/manifest.webmanifest',
    // "./" は独自ドメインでの正しい値なので、もう壊れた形ではない。
    // いまの壊れ方は、サブドメイン直下で配信するのにリポジトリ名の絶対パスが残っていること。
    apply: (s) => s.replace('"start_url": "./"', '"start_url": "/Quoridor/"'),
  },
  {
    id: 'B6_NO_CDN_EXEC',
    file: 'index.html',
    apply: (s) => s.replace('</head>', '  <script src="https://cdn.tailwindcss.com"></script>\n  </head>'),
  },
  {
    id: 'C5_NO_LOCALSTORAGE_CLEAR',
    file: 'src/pwa.js',
    apply: (s) => `${s}\nexport const wipe = () => localStorage.clear();\n`,
  },
  {
    id: 'B4_NO_POSTMESSAGE_STAR',
    file: 'src/pwa.js',
    apply: (s) => `${s}\nexport const shout = (w) => w.postMessage({ a: 1 }, '*');\n`,
  },
  {
    id: 'A1_LICENSE',
    file: 'LICENSE',
    remove: true,
  },
  {
    id: 'A3_DEPENDABOT',
    file: '.github/dependabot.yml',
    remove: true,
  },
  {
    id: 'E10_OFFLINE_HTML',
    file: 'public/offline.html',
    remove: true,
  },
  {
    id: 'E10b_OFFLINE_SELF_CONTAINED',
    file: 'public/offline.html',
    apply: (s) => s.replace('</body>', '  <script>console.log(1)</script>\n  </body>'),
  },
];

const report = (results) => {
  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? '✅' : '❌'} [${r.severity}] ${r.id.padEnd(34)} ${r.detail}`);
  }
  console.log(`\n${results.length - failed.length} / ${results.length} 件が基準を満たしています。`);
  return failed;
};

const selfTest = async () => {
  console.log('== 品質ゲートの自己確認 ==');
  console.log('ファイルをわざと壊した写しを作り、対応する検査が落ちることを確かめます。\n');

  const base = await collect(ROOT);
  const baseFailed = base.filter((r) => !r.ok);
  if (baseFailed.length) {
    console.log('⚠️ もとの状態で落ちている検査があります。先にそちらを直してください。');
    for (const r of baseFailed) console.log(`   ❌ ${r.id} ${r.detail}`);
    return 1;
  }

  let bad = 0;
  for (const brk of BREAKS) {
    const dir = mkdtempSync(join(tmpdir(), 'giga-selftest-'));
    try {
      cpSync(ROOT, dir, {
        recursive: true,
        filter: (src) => !/node_modules|\.git$|\.git\/|dist$|dist\//.test(src),
      });
      const target = join(dir, brk.file);
      if (brk.remove) {
        rmSync(target, { force: true });
      } else {
        const before = readFileSync(target, 'utf8');
        const after = brk.apply(before);
        if (after === before) {
          console.log(`⚠️ ${brk.id.padEnd(34)} 壊し方が当たっていません（対象の文字列が見つからない）`);
          bad++;
          continue;
        }
        writeFileSync(target, after);
      }
      const results = await collect(dir);
      const hit = results.find((r) => r.id === brk.id);
      if (!hit) {
        console.log(`⚠️ ${brk.id.padEnd(34)} そんな検査がありません`);
        bad++;
      } else if (hit.ok) {
        console.log(`❌ ${brk.id.padEnd(34)} 壊したのに落ちませんでした（この検査は何も見ていない）`);
        bad++;
      } else {
        console.log(`✅ ${brk.id.padEnd(34)} 壊したら落ちた`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  console.log(`\n${BREAKS.length - bad} / ${BREAKS.length} 件の検査が、壊したときに落ちることを確認しました。`);
  return bad === 0 ? 0 : 1;
};

const main = async () => {
  if (process.argv.includes('--self-test')) {
    process.exit(await selfTest());
  }
  console.log(`== GIGA Standard v5 品質ゲート（${config.repoName} / ${config.appType}型）==\n`);
  const failed = report(await collect(ROOT));
  if (failed.length) {
    console.log('\n実ブラウザで測るもの（コントラスト・タップ領域・PWA の挙動・アイコンの画素）は');
    console.log('tools/measure-*.mjs で別に測ります。npm run measure を見てください。');
  }
  process.exit(failed.length === 0 ? 0 : 1);
};

main().catch((e) => { console.error(e); process.exit(2); });
