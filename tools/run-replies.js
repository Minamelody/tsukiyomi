#!/usr/bin/env node
// 返信パイプラインのCLIランナー。
//
// 使い方:
//   THREADS_USER_ID=xxx THREADS_ACCESS_TOKEN=yyy node tools/run-replies.js --media-id <id> [--post-type fomo] [--dry-run]
//
// dry-run は送信せず、送信予定の返信文と分類・保留理由だけを表示する。

const { run } = require('../src/replies');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? (process.argv[i + 1] ?? true) : def;
}

async function main() {
  const mediaId = arg('media-id');
  if (!mediaId) {
    console.error('--media-id <id> を指定してください');
    process.exit(1);
  }
  const userId = process.env.THREADS_USER_ID;
  const token = process.env.THREADS_ACCESS_TOKEN;
  if (!userId || !token) {
    console.error('THREADS_USER_ID / THREADS_ACCESS_TOKEN を環境変数に設定してください');
    process.exit(1);
  }
  const dryRun = process.argv.includes('--dry-run');
  const postType = arg('post-type', 'unknown');

  const results = await run({ userId, token, mediaId, postType, dryRun });

  for (const r of results) {
    const body = r.text.replace(/\n/g, ' / ').slice(0, 70);
    const hold = r.hold_reason ? `（保留: ${r.hold_reason}）` : '';
    console.log(`[${r.status}] ${r.classification} @${r.replied_to} -> ${body}${hold}`);
  }

  const sent = results.filter(r => r.status === 'sent').length;
  const held = results.filter(r => r.status === 'hold').length;
  console.log(`\n${dryRun ? 'dry-run（送信なし）' : '送信完了'}: ${sent} 件送信 / ${held} 件保留 / 合計 ${results.length} 件`);
}

main().catch(e => { console.error('失敗:', e.message); process.exit(1); });
