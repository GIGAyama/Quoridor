/**
 * このリポジトリだけの検査。
 *
 * 共通の検査は正本（GIGAyama.github.io/standards/lib/giga-v5-checks.mjs）が
 * 受け持つ。ここに残すのは、正本に対応するものが無いものだけである。
 *
 * 移行のとき（2026-08-22）にフォーク 37 件を正本 38 件へ1つずつ突き合わせた。
 * 名前が変わっただけのものと、正本では1つにまとまったもの
 * （A4_README/MANUAL/AUDIT → A_DOCS、B1/B1b/B1c → B_CSP、
 *  D1/D14 → D_VIEWPORT、E2/E2b → E_ICONS、E10/E10b → E_OFFLINE_HTML）を
 * 除くと、行き先が無いのは下の 4 件だった。
 *
 * ⚠️ 検査そのものが壊れていないかは check-project.mjs --self-test が確かめる。
 *    「0件でした」だけでは、効いているのか何も見ていないのか区別できない。
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';

const walk = (dir, out = []) => {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};
const kb = (n) => Math.round((n / 1024) * 10) / 10;

/** 読めば分かるもの。正本に行き先が無かった 3 件。 */
export function runLocalChecks(root) {
  const out = [];
  const add = (id, ok, detail, severity = 'P1') => out.push({ id, ok, detail, severity });

  // 正本の E_SW_* はどれも sw.js の中身を読むので、無ければそちらも落ちる。
  // ただし「なぜ落ちたか」が読み取りにくいので、在ることを名指しで見る。
  const swPath = join(root, 'public/sw.js');
  add('E_SW_EXISTS', existsSync(swPath), existsSync(swPath) ? 'public/sw.js' : 'public/sw.js が無い');

  // 先読み一覧はビルドで注入する。目印が消えると注入先が無くなり、
  // 初回のあと圏外で白い画面になる。
  // 正本の E_SW_PRECACHE_OFFLINE もこの目印を手がかりにしているので、
  // 消えたことをここで名指しにしておく。
  const swRaw = existsSync(swPath) ? readFileSync(swPath, 'utf8') : '';
  const hasMark = /__PRECACHE_URLS__/.test(swRaw);
  add('E_PRECACHE_BUILD_ASSETS', hasMark,
    hasMark ? '' : '先読み一覧の目印が無い（初回のあと圏外で白い画面になる）');

  // 正本の E_INSTALL_HOOK は「<head> で合図を受けているか」を見る。
  // 読み込んでいる先のファイルが在るかは見ていないので、ここで見る。
  // 消えていれば本番で 404 になり、インストールの合図を取りこぼす。
  const hookPath = join(root, 'public/install-hook.js');
  add('E3_INSTALL_HOOK_FILE', existsSync(hookPath),
    existsSync(hookPath) ? '' : 'public/install-hook.js が無い');

  return out;
}

/**
 * ビルドした結果を見るもの。正本は原文だけを見るので、ここは守備範囲の外。
 * dist が無ければ何も返さない（ビルド前でもゲートが動くように）。
 */
export function runBuildChecks(root, config) {
  const out = [];
  const add = (id, ok, detail, severity = 'P2') => out.push({ id, ok, detail, severity });
  const dist = join(root, 'dist');
  if (!existsSync(dist)) return out;

  const total = walk(join(dist, 'assets'))
    .filter((p) => extname(p) === '.js')
    .reduce((n, p) => n + statSync(p).size, 0);
  add('F5_INITIAL_JS', kb(total) <= config.limits.maxInitialJsKB,
    `${kb(total)}KB (上限 ${config.limits.maxInitialJsKB}KB)`);

  /*
   * 素の HTML の入口（プライバシーポリシー・利用規約）が配信物に入っているか。
   *
   * この2枚はリポジトリ直下に置いてあり、置いてあるだけでは配られない。
   * Vite は vite.config.js の入口一覧に並べたものしか dist に出さないので、
   * 並べ忘れると、リポジトリには在るのに本番だけ 404 になる——
   * 手元では気づけず、外から見た人だけが踏む形になる（2026-08-23 に発生）。
   * 規約とポリシーは公開していること自体が要件なので、名指しで見る。
   */
  const POLICY_PAGES = ['privacy.html', 'terms.html'];
  const missing = POLICY_PAGES
    .filter((name) => existsSync(join(root, name)))     // 原文が在るものだけを見る
    .filter((name) => !existsSync(join(dist, name)));
  add('F_POLICY_PAGES_SHIPPED', missing.length === 0,
    missing.length === 0
      ? POLICY_PAGES.join(' / ')
      : `${missing.join(' / ')} が dist に無い（本番で 404 になる）`,
    'P1');

  return out;
}
