# **🚧 カベカベ合戦！〜道を切り拓け〜**

GIGAスクール端末（Chromebook/iPad）で快適に動作する、教育用対戦パズルゲームです。

Vite + React 製のPWA（プログレッシブウェブアプリ）として動作し、Chromeなどのブラウザから「アプリとしてインストール」して利用できます。

## **🎮 ゲーム概要**

* **ジャンル**: 対戦型パズル（コリドール風）
* **プレイ人数**: 2人（1台の端末をシェアして対戦）
* **対象**: 小学生全学年
* **特徴**:
  * **ゼロ・ラグ**: 通信待ち時間なしでサクサク動く設計
  * **オフライン対応**: 一度読み込めばオフラインでも遊べる（Service Worker）
  * **アプリとしてインストール可能**: ホーム画面に追加して全画面で遊べる
  * **教育的配慮**: 全ての漢字にふりがな（ルビ）付き
  * **レスポンシブ**: スマホ（縦・横）・タブレット・PCのどれでも盤面が最大サイズで表示
  * **視覚的ルール**: 直感的にわかるルール説明機能
  * **キーボードだけで遊べる**: 矢印キーで選び、Enter / Space で決める
  * **提示モード**: 電子黒板むけに文字と操作を一回り大きくする
  * **記録を残さない**: 名前も点数も保存せず、どこにも送信しない

## **📂 プロジェクト構成**

```
├── App.jsx                    # ゲーム画面（UI）
├── index.html                 # エントリHTML（CSP・PWAメタタグ・install-hook）
├── src/
│   ├── main.jsx               # Reactエントリ
│   ├── rules.js               # ゲームの決まり（画面に依存しない判定。テスト対象）
│   ├── pwa.js                 # Service Worker の登録と更新の案内
│   └── styles.css             # レイアウト・レスポンシブ・提示モード・印刷
├── public/
│   ├── manifest.webmanifest   # PWAマニフェスト（id/scope/start_url は /Quoridor/）
│   ├── sw.js                  # Service Worker（オフラインキャッシュ）
│   ├── install-hook.js        # beforeinstallprompt の捕捉（head の先頭で読む）
│   ├── offline.html           # 圏外で本体も無いときに出す画面
│   └── icons/                 # PWAアイコン（192/512/maskable/apple-touch）
├── tests/
│   └── rules.test.mjs         # ゲームの決まりのテスト
├── tools/                     # 実測ツール（実ブラウザで測る）
│   ├── measure-ui.mjs         #   コントラスト・タップ領域・横スクロール・CSP違反
│   ├── measure-pwa.mjs        #   登録・更新・圏外・他アプリのキャッシュ
│   ├── measure-a11y.mjs       #   キーボード操作・モーダル
│   ├── measure-icons.mjs      #   透明・maskable のセーフゾーン（画素を数える）
│   ├── build-icons.mjs        #   アイコン一式を作り直す
│   └── icon-master.png        #   アイコンの元画像（ここを直して build-icons を走らせる）
├── scripts/
│   ├── check-project.mjs      # 品質ゲート（--self-test 付き）
│   └── lib/giga-v5-checks.mjs #   Part I の静的検査
├── quality.config.json
├── vite.config.js             # base:'./' と、先読みリストを sw.js へ埋める処理
└── tailwind.config.js
```

### **手で編集してよいもの／いけないもの**

| ファイル | |
|---|---|
| `App.jsx` `src/*` `public/*` `index.html` | **ここを直す** |
| `dist/**` | 生成物。手で編集しない |
| `dist/sw.js` の `BUILD_ASSETS` 行 | ビルド時に `vite.config.js` が埋める。手で書かない |
| `public/icons/*` `public/favicon.png` | 生成物。`tools/icon-master.png` を直して `npm run icons` |

**アイコンを直したら `npm run icons` を、原本を直したら `npm run build` を走らせてから push すること。**

## **🚀 開発・ビルド**

```bash
npm install        # 依存関係のインストール
npm run dev        # 開発サーバー起動
npm run lint       # ESLintチェック
npm test           # ゲームの決まりのテスト
npm run build      # 本番ビルド（dist/ に出力）
npm run preview    # ビルド結果の確認
npm run icons      # アイコン一式を作り直す（tools/icon-master.png から）
```

`dist/` を任意の静的ホスティング（GitHub Pages、Netlify、Cloudflare Pages等）に**HTTPSで**配置してください。PWAのインストールとService WorkerはHTTPS環境（またはlocalhost）でのみ有効です。

## **✅ 品質ゲートと実測**

読めば分かることは品質ゲートで、読んでも分からないことは実ブラウザで測る。
**CI（pull_request と push の両方）で全部走る。**

```bash
npm run check            # 下の全部（push 前にこれを通す）

npm run gate             # Part I の静的検査
npm run gate:self-test   # 検査そのものが動くか（わざと壊して落ちるか確かめる）
npm run measure:ui       # コントラスト・タップ領域・横スクロール・CSP違反・JSエラー
npm run measure:pwa      # SW の登録・更新・圏外・他アプリのキャッシュ
npm run measure:a11y     # キーボードだけで1手指せるか・モーダルの作法
npm run measure:icons    # アイコンの透明・maskable のセーフゾーン（画素を数える）
```

`measure:*` は `dist/` を配って測るので、先に `npm run build` が要る。

**検査を足したら、`scripts/check-project.mjs` の `BREAKS` に「壊し方」も足すこと。**
「0件でした」だけでは、検査が動いているのか何も見ていないのか区別が付かない。
実際、この自己確認で検査そのものの不具合が3件見つかっている。

実測値と、測っていないものの一覧は [AUDIT.md](./AUDIT.md) にある。
先生向けの使い方は [MANUAL.md](./MANUAL.md)。

## **🔒 セキュリティ設計**

* **外部への通信が1本も無い。** CDN・Web フォント・解析・API すべて使っていない。
  学校のフィルタリングで何が塞がれても、このアプリは起動する。
* **CSP を `index.html` の `<meta>` で入れている**（`script-src 'self'`）。
  インラインの `<script>` と `onclick=` は使っていない。
  `frame-ancestors` は `<meta>` では無視されるので書いていない
  （独自ドメインや CDN を挟むときは、そちら側で HTTP ヘッダーとして設定すること）。
* **個人情報を持たない。** 名前・出席番号を入力する欄が無く、`localStorage` も使っていない。
* **Service Worker は自アプリ接頭辞（`kabe-kabe-`）のキャッシュだけを消す。**
  `gigayama.github.io` は複数アプリで同一オリジンを共有しているため、
  `caches.keys()` の全削除は他アプリのオフラインを壊す。

## **📐 制限**

* 9x9 の盤を 320x568 の画面で開くと、1マスが 25.3px になる（44px には物理的に届かない）。
  5x5 / 7x7 を選ぶか、キーボード操作（矢印 + Enter）で補う。
* 記録を残さない。閉じると盤面は消える。

## **📱 インストール方法（児童・生徒向け）**

1. ChromeでアプリのURLを開く
2. アドレスバー右端の「インストール」アイコン（またはメニュー →「アプリをインストール」）をタップ
3. ホーム画面 / デスクトップに追加されたアイコンから、アプリとして全画面で起動できます

iPadのSafariでは「共有」→「ホーム画面に追加」でインストールできます。

## **🕹️ 遊び方**

1. **準備**: 2人ペアになり、1台のタブレットを机の真ん中に置きます。
2. **チーム決め**: 「青チーム（右へ進む）」と「赤チーム（左へ進む）」を決めます。
3. **アクション**: 自分の番が来たら、以下のどちらか1つを行います。
   * 🏃 **歩く**: コマを1マス進める（上下左右）。
   * 🚧 **カベ**: 相手のジャマをするためにカベを置く。
4. **勝利条件**: 先に反対側の端っこにたどり着いたチームの勝ち！

## **⚠️ 注意事項**

* **カベのルール**: 相手がゴールできなくなるような「閉じ込め」配置はできません（システムが自動で判定してエラーを出します）。
* **オフライン**: 初回アクセス時にアプリ全体がキャッシュされるため、2回目以降はオフラインでも動作します。

## **📜 ライセンス**

MIT License — [LICENSE](./LICENSE) を参照。

Copyright (c) 2026 GIGAyama
