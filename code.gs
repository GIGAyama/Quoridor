/**
 * @fileoverview このファイルは、Google Apps ScriptでWebアプリケーションを
 * 提供するためのサーバーサイドのコードです。
 * ブラウザからのリクエストを受け取り、index.htmlの内容を返します。
 */

/**
 * Webアプリケーションにブラウザからアクセスがあった時（GETリクエスト）に自動的に実行される、
 * Google Apps Scriptで決められている特別な名前の関数です。
 * この関数は、デプロイされたGASウェブアプリのURLにアクセスすると呼び出されます。
 *
 * @param {object} e - アクセスに関する情報が入ったイベントオブジェクト。
 *                     今回は特にこのオブジェクトのデータを使用しません。
 * @return {HtmlOutput} - ブラウザに表示するためのHTMLコンテンツを返します。
 */
function doGet(e) {
  // HtmlServiceを使って、プロジェクト内の 'index.html' ファイルの内容を読み込みます。
  // これにより、HTMLファイル内のスクリプトレット（<?!= ... ?>形式のGASコード）も実行されるようになります。
  const template = HtmlService.createTemplateFromFile('index');

  // テンプレートを評価（evaluate）して、最終的なHTMLコンテンツを生成します。
  // スクリプトレットがあればここで処理され、静的なHTMLが完成します。
  const htmlOutput = template.evaluate();

  // 生成されたHTMLコンテンツに対して、ブラウザでの表示に関する設定を追加します。
  // これらの設定は、ウェブページの見た目や動作を改善するために重要です。
  htmlOutput
    .setTitle('コリドール') // ブラウザのタブやウィンドウに表示されるタイトルを設定します。
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0'); // スマートフォンなど、様々な画面サイズに合わせて表示を最適化するための設定です。

  // 設定済みのHTMLコンテンツをブラウザに返します。
  // これがユーザーの画面に表示されるウェブアプリケーションの本体となります。
  return htmlOutput;
}
