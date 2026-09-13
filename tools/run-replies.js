#!/usr/bin/env node
// 返信パイプラインのCLIランナー。
//
// 使い方:
//   （単一投稿）
//   THREADS_USER_ID=xxx THREADS_ACCESS_TOKEN=yyy node tools/run-replies.js --media-id <id> [--post-type fomo] [--dry-run]
//
//   （直近N時間の投稿を自動解決＝スケジュール実行用）
//   THREADS_USER_ID=xxx THREADS_ACCESS_TOKEN=yyy node tools/run-replies.js --recent-hours <N> [--post-type ...] [--dry-run]
//
// --recent-hours は自分のスレッド一覧を取得し、直近N時間に投稿した上位ポストそれぞれに返信を回す。
// 未返信判定は conversation の replied_to 突き合わせ（API側 is_reply_owned_by_me）なので、
// 複数環境・複数回実行しても二重送信にならない。
// dry-run は送信せず、送信予定の返信文と分類・保留理由だけを表示する。

const { run } = require('../src/replies');
const { ThreadsClient, filterRecentThreads } = require('../src/threads-api');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? (process.argv[i + 1] ?? true) : def;
}

// 再スキャン窓の下限（恒久対応・PM 4077376）。
// 「投稿+5h」のバッチは投稿時刻基準のため、投稿から5h超に届いた遅着リプを見落とす
// （実例: 21時投稿への3:13着信リプが7:00 runで漏れた）。毎runで直近 RESCAN_HOURS 時間の投稿を
// 再スキャンして未返信を回収する。二重送信は conversation の is_reply_owned_by_me（未返信判定）で
// 防止済みなので、窓を広げても安全。
const RESCAN_HOURS = 24;

async function main() {
  const userId = process.env.THREADS_USER_ID;
  const token = process.env.THREADS_ACCESS_TOKEN;
  if (!userId || !token) {
    console.error('THREADS_USER_ID / THREADS_ACCESS_TOKEN を環境変数に設定してください');
    process.exit(1);
  }
  const dryRun = process.argv.includes('--dry-run');
  const postType = arg('post-type', 'unknown');
  const mediaId = arg('media-id');
  const recentHours = arg('recent-hours');

  let mediaIds = [];
  if (mediaId) {
    mediaIds = [mediaId];
  } else if (recentHours) {
    const h = Number(recentHours);
    if (!Number.isFinite(h) || h <= 0) {
      console.error('--recent-hours <正の時間数> を指定してください');
      process.exit(1);
    }
    const window = Math.max(h, RESCAN_HOURS);
    const client = new ThreadsClient({ userId, accessToken: token });
    const threads = await client.listThreads();
    mediaIds = filterRecentThreads(threads.data, window);
    if (mediaIds.length === 0) {
      console.log(`直近${window}時間の投稿はありません。`);
      return;
    }
    console.log(`直近${window}時間の投稿 ${mediaIds.length} 件を対象にします（指定 ${h}h の下限 ${RESCAN_HOURS}h で再スキャン）: ${mediaIds.join(', ')}`);
  } else {
    console.error('--media-id <id> か --recent-hours <N> を指定してください');
    process.exit(1);
  }

  const all = [];
  for (const id of mediaIds) {
    const results = await run({ userId, token, mediaId: id, postType, dryRun });
    all.push(...results);
  }

  for (const r of all) {
    const body = r.text.replace(/\n/g, ' / ').slice(0, 70);
    const hold = r.hold_reason ? `（保留: ${r.hold_reason}）` : '';
    console.log(`[${r.status}] ${r.classification} #${r.source_media_id} @${r.replied_to} -> ${body}${hold}`);
  }

  const sent = all.filter(r => r.status === 'sent').length;
  const held = all.filter(r => r.status === 'hold').length;
  console.log(`\n${dryRun ? 'dry-run（送信なし）' : '送信完了'}: ${sent} 件送信 / ${held} 件保留 / 合計 ${all.length} 件`);
}

main().catch(e => { console.error('失敗:', e.message); process.exit(1); });
