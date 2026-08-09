/*
 * 画面を実際に開いて歩き、コントラスト・タップ領域・横スクロール・
 * コンソールエラー・CSP 違反を測る。
 *
 *   node tools/measure-ui.mjs [配るディレクトリ=dist]
 *
 * 「読んで分かること」はここでは測らない。読んでも分からないことだけを測る。
 */
import { chromium } from 'playwright';
import { INJECTED_MEASURE_SOURCE, serveDir } from './measure-lib.mjs';

const ROOT = process.argv[2] || 'dist';
const PORT = 4173;

// 実際に配備される端末の実効解像度
const VIEWPORTS = [
  { name: '320x568 (設計下限)', width: 320, height: 568 },
  { name: '375x667 (iPhone SE)', width: 375, height: 667 },
  { name: '810x1080 (iPad)', width: 810, height: 1080 },
  { name: '1366x768 (Chromebook)', width: 1366, height: 768 },
  { name: '1920x1080 (教員PC)', width: 1920, height: 1080 },
];

const CELL_GRID = 'div[style*="grid-template-columns"]';

async function walkTo(page, state, boardSize) {
  // 盤面サイズを選んでゲームを開始する
  if (state !== 'setup') {
    await page.selectOption('select', String(boardSize));
    await page.getByRole('button', { name: /ゲーム/ }).click();
    await page.waitForSelector(CELL_GRID);
    await page.waitForTimeout(150);
  }
  if (state === 'rules') {
    await page.getByRole('button', { name: 'あそびかたを見る' }).click();
    await page.waitForTimeout(150);
  }
  if (state === 'wall' || state === 'wall-error' || state === 'wall-aim') {
    await page.getByRole('button', { name: /カベ/ }).last().click();
    await page.waitForTimeout(100);
    // 盤面の外枠に置こうとして「置けません」を出す（案内文はいちばん読みにくくなりやすい）
    const cells = page.locator(`${CELL_GRID} > div`);
    if (state === 'wall-error') {
      await cells.nth(boardSize * boardSize - 1).click();
    } else if (state === 'wall-aim') {
      // 置き場所を選んだところ（「ここに おく！」が出ている状態）
      await cells.nth(Math.floor(boardSize * boardSize / 2)).click();
    } else {
      await cells.nth(Math.floor(boardSize * boardSize / 2)).hover();
    }
    await page.waitForTimeout(150);
  }
  if (state === 'win') {
    // 上端／下端を通って一直線に走らせる。先手（青）が先にゴールする。
    const n = boardSize;
    const idx = (r, c) => r * n + c;
    const mid = Math.floor(n / 2);
    const blue = [];
    for (let r = mid - 1; r >= 0; r--) blue.push(idx(r, 0));
    for (let c = 1; c < n; c++) blue.push(idx(0, c));
    const red = [];
    for (let r = mid + 1; r < n; r++) red.push(idx(r, n - 1));
    for (let c = n - 2; c >= 0; c--) red.push(idx(n - 1, c));
    const cells = page.locator(`${CELL_GRID} > div`);
    for (let i = 0; i < blue.length; i++) {
      await cells.nth(blue[i]).click();
      await page.waitForTimeout(30);
      if (i < red.length && !(await page.locator('text=勝負').count())) {
        await cells.nth(red[i]).click();
        await page.waitForTimeout(30);
      }
      if (await page.locator('text=あり').count()) break;
    }
    await page.waitForTimeout(400);
  }
}

const STATES = [
  { state: 'setup', boardSize: 9, label: 'せってい画面' },
  { state: 'game', boardSize: 9, label: 'ゲーム画面 9x9' },
  { state: 'game', boardSize: 5, label: 'ゲーム画面 5x5' },
  { state: 'rules', boardSize: 9, label: 'あそびかた（モーダル）' },
  { state: 'wall', boardSize: 9, label: 'カベモード（プレビュー中）' },
  { state: 'wall-aim', boardSize: 9, label: 'カベの置き場所を選んだところ' },
  { state: 'wall-error', boardSize: 9, label: 'エラー表示（置けません）' },
  { state: 'win', boardSize: 5, label: '勝利モーダル' },
];

const run = async () => {
  const server = await serveDir(new URL(`../${ROOT}/`, import.meta.url).pathname.replace(/\/$/, ''), PORT);
  const browser = await chromium.launch();
  const report = { contrast: [], tap: [], overflow: [], consoleErrors: [], cspViolations: [], failedRequests: [] };

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
    });
    await context.addInitScript(INJECTED_MEASURE_SOURCE);
    await context.addInitScript(() => {
      window.__cspViolations = [];
      document.addEventListener('securitypolicyviolation', (e) => {
        window.__cspViolations.push({ directive: e.violatedDirective, blocked: e.blockedURI, line: e.lineNumber });
      });
    });
    const page = await context.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') report.consoleErrors.push({ vp: vp.name, text: m.text().slice(0, 200) });
    });
    page.on('pageerror', (e) => report.consoleErrors.push({ vp: vp.name, text: 'pageerror: ' + e.message.slice(0, 200) }));
    page.on('requestfailed', (r) =>
      report.failedRequests.push({ vp: vp.name, url: r.url(), reason: r.failure()?.errorText }));

    for (const s of STATES) {
      await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
      await walkTo(page, s.state, s.boardSize);

      const where = `${vp.name} / ${s.label}`;
      for (const c of await page.evaluate('window.__giga.contrast()')) report.contrast.push({ where, ...c });
      for (const t of await page.evaluate('window.__giga.tapTargets()')) report.tap.push({ where, ...t });
      const ov = await page.evaluate('window.__giga.overflow()');
      if (ov.overflowPx > 1) report.overflow.push({ where, ...ov });
      for (const v of await page.evaluate('window.__cspViolations')) report.cspViolations.push({ where, ...v });
    }
    await context.close();
  }

  await browser.close();
  server.close();

  // 同じ原因のものはまとめて数える
  const group = (rows, keyFn) => {
    const m = new Map();
    for (const r of rows) {
      const k = keyFn(r);
      if (!m.has(k)) m.set(k, { ...r, count: 0, where: [] });
      const e = m.get(k);
      e.count++;
      if (!e.where.includes(r.where)) e.where.push(r.where);
    }
    return [...m.values()].sort((a, b) => (a.ratio ?? a.h ?? 0) - (b.ratio ?? b.h ?? 0));
  };

  // 操作ボタンと盤面のマスは分けて数える（盤面は物理的に 44px にできない。理由は measure-lib.mjs）
  const tapControls = report.tap.filter((t) => !t.isBoardCell);
  const tapBoard = report.tap.filter((t) => t.isBoardCell);

  const out = {
    contrastTotal: report.contrast.length,
    contrast: group(report.contrast, (r) => `${r.selector}|${r.color}|${r.bg}|${r.text}`),
    tapControlsTotal: tapControls.length,
    tapControls: group(tapControls, (r) => `${r.selector}|${r.text}`),
    tapBoardTotal: tapBoard.length,
    tapBoard: group(tapBoard, (r) => `${r.w}x${r.h}`),
    overflow: report.overflow,
    consoleErrors: report.consoleErrors,
    cspViolations: report.cspViolations,
    failedRequests: report.failedRequests,
  };
  console.log(JSON.stringify(out, null, 2));
  const bad = out.contrastTotal + out.tapControlsTotal + out.overflow.length +
              out.consoleErrors.length + out.cspViolations.length;
  console.error(`\n== 合計 ==\nコントラスト ${out.contrastTotal} 件 / 操作ボタンのタップ ${out.tapControlsTotal} 件 / 横スクロール ${out.overflow.length} 件 / JSエラー ${out.consoleErrors.length} 件 / CSP違反 ${out.cspViolations.length} 件`);
  if (tapBoard.length) {
    const sizes = [...new Set(tapBoard.map((t) => `${t.w}x${t.h}px`))].join(', ');
    console.error(`（参考・判定には含めない）盤面のマスが 44px 未満になる組み合わせ ${tapBoard.length} 件: ${sizes}`);
  }
  process.exit(bad === 0 ? 0 : 1);
};

run().catch((e) => { console.error(e); process.exit(2); });
