#!/usr/bin/env node
// Threads の長期トークンを更新する。寿命60日なので定期実行が必要。
//
// 使い方:
//   THREADS_ACCESS_TOKEN=xxx node tools/refresh-token.js            # 残り日数を表示するだけ
//   THREADS_ACCESS_TOKEN=xxx node tools/refresh-token.js --refresh  # 実際に更新する
//
// 更新すると新しいトークン文字列が標準出力に出る。**保存先はこのスクリプトの外**で、
// 実行環境が読んでいる場所（.env.threads など）に書き戻す必要がある。
// 保存を忘れると次回の実行で古いトークンが使われ、期限切れで投稿が止まる。
//
// なぜ「表示するだけ」を既定にしたか: 更新は必ず新しい文字列を返すので、
// 保存に失敗したまま更新を回すと、有効なトークンを取り違えて失う事故が起きる。

const { ThreadsClient } = require('../src/threads-api');

async function main() {
  const token = process.env.THREADS_ACCESS_TOKEN;
  const userId = process.env.THREADS_USER_ID || '0';
  if (!token) {
    console.error('THREADS_ACCESS_TOKEN を環境変数に設定してください');
    process.exit(1);
  }

  const client = new ThreadsClient({ userId, accessToken: token });

  if (!process.argv.includes('--refresh')) {
    // 残り寿命の確認だけ。投稿枠の取得が通れば、トークンは今は有効。
    try {
      await client.publishingLimit();
      console.log('トークンは現在有効です。');
      console.log('更新するには --refresh を付けて実行してください。');
      console.log('更新後は、新しいトークンを実行環境の保存先に必ず書き戻すこと。');
    } catch (e) {
      console.error('トークンが無効か期限切れです:', e.message);
      console.error('--refresh で更新を試すか、手動で再取得してください。');
      process.exit(1);
    }
    return;
  }

  const json = await client.refreshToken();
  const days = json.expires_in ? Math.round(json.expires_in / 86400) : null;
  console.log('更新しました。' + (days ? ` 新しい寿命: 約${days}日` : ''));
  console.log('');
  console.log('=== 新しいトークン（保存先に書き戻してください）===');
  console.log(json.access_token);
  console.log('===');
  console.log('');
  console.log('書き戻しを忘れると、次回の実行で古いトークンが使われて投稿が止まります。');
}

main().catch(e => { console.error('失敗:', e.message); process.exit(1); });
