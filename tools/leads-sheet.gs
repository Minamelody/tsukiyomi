/**
 * リード記録をGoogleスプレッドシートへ受けるウェブアプリ（Google Apps Script）。
 *
 * 設置手順:
 *   1. Googleスプレッドシートを新規作成する
 *   2. 拡張機能 → Apps Script を開き、このファイルの内容を貼る
 *   3. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
 *        実行するユーザー: 自分
 *        アクセスできるユーザー: 全員
 *   4. 発行されたウェブアプリURLを Render の環境変数 LEADS_WEBHOOK_URL に入れる
 *
 * 保存されるのは集計用の項目だけ。氏名と悩み本文は送られてこない。
 */
function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['日時', '生年月日', '氏名入力あり', '性別', '悩みジャンル', '悩み文字数']);
  }
  var d = JSON.parse(e.postData.contents);
  sheet.appendRow([
    d.at || new Date().toISOString(),
    d.birthday || '',
    d.hasName ? 'あり' : 'なし',
    d.gender || '',
    d.topic || '',
    d.questionLength || 0
  ]);
  return ContentService.createTextOutput('ok');
}
