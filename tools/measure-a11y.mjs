/*
 * キーボードだけで遊べるかを、実際にキーを押して確かめる。
 *
 *   node tools/measure-a11y.mjs [配るディレクトリ=dist]
 *
 * 「tabindex を付けた」ことは読めば分かる。読んでも分からないのは
 * 「本当に1手指せるか」なので、Tab と矢印と Enter だけで駒を動かす。
 */
import { chromium } from 'playwright';
import { serveDir } from './measure-lib.mjs';

const ROOT = process.argv[2] || 'dist';
const PORT = 4176;
const BASE = `http://127.0.0.1:${PORT}/`;

const results = [];
const ok = (name, pass, detail) => results.push({ name, pass, detail });

const run = async () => {
  const server = await serveDir(new URL(`../${ROOT}/`, import.meta.url).pathname.replace(/\/$/, ''), PORT);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });

  // --- 1. せってい画面をキーボードだけで進めてゲームを始める ---------------
  await page.keyboard.press('Tab');
  let guard = 0;
  while (guard++ < 40) {
    const label = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? (el.textContent || el.getAttribute('aria-label') || '').trim() : '';
    });
    if (/ゲーム/.test(label)) break;
    await page.keyboard.press('Tab');
  }
  await page.keyboard.press('Enter');
  await page.waitForSelector('[role="grid"]', { timeout: 5000 });
  ok('F3a キーボードだけでゲームを開始できる', true, `Tab ${guard} 回で到達`);

  // --- 2. 盤面へ Tab で入れるか ------------------------------------------
  guard = 0;
  let reached = false;
  while (guard++ < 40) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => document.activeElement?.getAttribute('role') === 'gridcell');
    if (reached) break;
  }
  const cursorAt = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  ok('F3b 盤面へ Tab で入れる（roving tabindex）', reached, `Tab ${guard} 回 / ${cursorAt}`);

  // 81マスを Tab で辿らされていないこと
  const gridTabbables = await page.evaluate(() =>
    document.querySelectorAll('[role="gridcell"][tabindex="0"]').length);
  ok('F3c 盤面の Tab 止まりは1つだけ', gridTabbables === 1, `${gridTabbables} 個`);

  // --- 3. 矢印 + Enter で1手指せるか --------------------------------------
  const before = await page.evaluate(() =>
    [...document.querySelectorAll('[role="gridcell"]')].findIndex((el) =>
      /青のコマ/.test(el.getAttribute('aria-label') || '')));
  // 青は右へ進む。カーソルを駒の位置へ寄せてから右へ1つ動かす
  for (let i = 0; i < 12; i++) {
    const here = await page.evaluate(() => /青のコマ/.test(document.activeElement?.getAttribute('aria-label') || ''));
    if (here) break;
    await page.keyboard.press('ArrowDown');
  }
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  const after = await page.evaluate(() =>
    [...document.querySelectorAll('[role="gridcell"]')].findIndex((el) =>
      /青のコマ/.test(el.getAttribute('aria-label') || '')));
  ok('F3d 矢印キーと Enter で駒が動く', before !== after && after >= 0, `${before} → ${after}`);

  // --- 4. 読み上げ用の文言が更新されているか ------------------------------
  const live = await page.evaluate(() => {
    const el = document.querySelector('[aria-live="polite"]');
    return el ? el.textContent : null;
  });
  ok('F1 手番が aria-live で読み上げられる', !!live && /チームの番です/.test(live), JSON.stringify(live));

  // --- 5. カベもキーボードだけで置けるか ----------------------------------
  // カベは「1回目で下見、2回目で決まり」。マウスが使えなくても同じ手順で置けなければ、
  // キーボードの子だけカベを使えないことになる。
  guard = 0;
  let onWallButton = false;
  while (guard++ < 40) {
    await page.keyboard.press('Tab');
    onWallButton = await page.evaluate(() => {
      const el = document.activeElement;
      const name = (el?.getAttribute('aria-label') || el?.textContent || '').trim();
      return el?.tagName === 'BUTTON' && /カベを置く/.test(name);
    });
    if (onWallButton) break;
  }
  await page.keyboard.press('Enter');
  ok('F3e キーボードでカベモードへ入れる', onWallButton, `Tab ${guard} 回`);

  // 盤面へ戻る（Shift+Tab）
  guard = 0;
  let backOnCell = false;
  while (guard++ < 40) {
    await page.keyboard.press('Shift+Tab');
    backOnCell = await page.evaluate(() => document.activeElement?.getAttribute('role') === 'gridcell');
    if (backOnCell) break;
  }

  await page.keyboard.press('Enter');           // 1回目 … 下見
  await page.waitForTimeout(120);
  const aimed = await page.evaluate(() => !!document.querySelector('.wall-preview.is-aimed'));
  const placedTooEarly = await page.evaluate(() => document.querySelectorAll('.wall-piece').length);
  ok('F3f Enter 1回で下見に入る（まだ置かれない）',
     backOnCell && aimed && placedTooEarly === 0,
     `盤面へ戻れた=${backOnCell} / 下見=${aimed} / この時点のカベ ${placedTooEarly} 枚`);

  await page.keyboard.press('Escape');          // やめられるか
  await page.waitForTimeout(120);
  const cancelled = await page.evaluate(() => !document.querySelector('.wall-preview.is-aimed'));
  ok('F3g Esc で下見をやめられる', cancelled, `下見が残っている=${!cancelled}`);

  await page.keyboard.press('Enter');           // もう一度 1回目
  await page.keyboard.press('Enter');           // 2回目 … 決まり
  await page.waitForTimeout(300);
  const placed = await page.evaluate(() => document.querySelectorAll('.wall-piece').length);
  const backToWalk = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /歩/.test(x.textContent || ''));
    return b?.getAttribute('aria-pressed') === 'true';
  });
  ok('F3h Enter 2回でカベが置ける', placed === 1, `カベ ${placed} 枚`);
  ok('F3i 置いたら「あるく」に戻っている', backToWalk, `あるくが選ばれている=${backToWalk}`);

  // --- 6. モーダルの作法 ---------------------------------------------------
  await page.getByRole('button', { name: 'あそびかたを見る' }).click();
  await page.waitForTimeout(300);
  const dialog = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"], [role="alertdialog"]');
    if (!d) return null;
    return {
      role: d.getAttribute('role'),
      modal: d.getAttribute('aria-modal'),
      labelled: d.getAttribute('aria-labelledby'),
      focusInside: d.contains(document.activeElement),
    };
  });
  ok('F2a モーダルが dialog で、開いたら中にフォーカスが移る',
     !!dialog && dialog.modal === 'true' && !!dialog.labelled && dialog.focusInside,
     JSON.stringify(dialog));

  // Tab を何度押しても背面へ抜けないこと
  let escaped = false;
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"], [role="alertdialog"]');
      return d ? d.contains(document.activeElement) : false;
    });
    if (!inside) { escaped = true; break; }
  }
  ok('F2b Tab が背面へ抜けない（フォーカスが閉じ込められている）', !escaped, escaped ? '抜けた' : '12回押しても中に留まった');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const closed = await page.evaluate(() => !document.querySelector('[role="dialog"], [role="alertdialog"]'));
  const returned = await page.evaluate(() =>
    (document.activeElement?.getAttribute('aria-label') || '') === 'あそびかたを見る');
  ok('F2c Esc で閉じ、フォーカスが元へ戻る', closed && returned,
     `closed=${closed} / returned=${returned}`);

  // --- 7. 見出しの階層 -----------------------------------------------------
  const headings = await page.evaluate(() =>
    [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => h.tagName));
  let jump = false;
  let prev = 0;
  for (const h of headings) {
    const level = Number(h.slice(1));
    if (prev && level > prev + 1) jump = true;
    prev = level;
  }
  ok('a11y 見出しの階層が飛んでいない', !jump, headings.join(' → ') || '見出しなし');

  ok('JS エラー 0件', jsErrors.length === 0, JSON.stringify(jsErrors.slice(0, 3)));

  await browser.close();
  server.close();

  console.log(JSON.stringify(results, null, 2));
  console.error('\n== アクセシビリティ実測 ==');
  for (const r of results) console.error(`${r.pass ? '✅' : '❌'} ${r.name} … ${r.detail}`);
  process.exit(results.every((r) => r.pass) ? 0 : 1);
};

run().catch((e) => { console.error(e); process.exit(2); });
