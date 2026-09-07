#!/usr/bin/env node
// Threads 全自動投稿ランナー（v2対応）。
// 1回の実行で「その日のスロット1件」を投稿する。cron/schedule から1日2〜3回呼ぶ。
//
// 使い方:
//   THREADS_USER_ID=xxx THREADS_ACCESS_TOKEN=yyy node src/autopost.js --slot 0
//   node src/autopost.js --slot 0 --dry-run     # 投稿せず本文だけ表示
//
// 重複防止のため投稿履歴を out/post-history.json に保存する。
// 同一文面の再投稿はシャドウバンの主要因なので履歴は消さないこと。
// v2: 文面は選日・時辰の実データで生成（senjitsu/rarity）。投稿後にカードを
//     ベストエフォート生成（design/cards/out/<date>/slot<N>.png）。失敗しても投稿は成功扱い。
// v2.2: カードがPagesで配信済み（https://minamelody.github.io/tsukiyomi/cards/<date>/slot<N>.png が200）なら
//       画像付きで投稿する。未配信ならテキストのみ（自己回復・投稿を止めない）。

const fs = require('fs');
const path = require('path');
const { planDay } = require('./threads-posts');
const { ThreadsClient } = require('./threads-api');
const { genCard } = require('./cards');

const HIST_PATH = path.join(__dirname, '..', 'out', 'post-history.json');
const MAX_HIST = 500;
const CARD_PUBLIC_BASE = process.env.CARD_PUBLIC_BASE || 'https://minamelody.github.io/tsukiyomi/cards';

function loadHistory() {
  try { return JSON.parse(fs.readFileSync(HIST_PATH, 'utf8')); }
  catch { return []; }
}
function saveHistory(h) {
  fs.mkdirSync(path.dirname(HIST_PATH), { recursive: true });
  fs.writeFileSync(HIST_PATH, JSON.stringify(h.slice(-MAX_HIST), null, 2));
}

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? (process.argv[i + 1] ?? true) : def;
}

/** カードの公開URLが配信済みか（200）を確認する。配信済みならURLを返す */
async function publishedCardUrl(date, slot) {
  if (process.argv.includes('--dry-run')) return null;
  const url = `${CARD_PUBLIC_BASE}/${date}/slot${slot}.png`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(url, { method: 'HEAD', signal: ctrl.signal });
    clearTimeout(t);
    return res.ok ? url : null;
  } catch { return null; }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const slot = Number(arg('slot', 0));
  const perDay = Number(arg('per-day', 3));
  // 日本時間で「今日」を決める（投稿の運用は日本時間基準）
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  const date = jst.toISOString().slice(0, 10);

  const history = loadHistory();
  const recentTexts = history.map(h => h.text);
  const posts = await planDay(date, perDay, recentTexts);
  const post = posts[slot % posts.length];

  console.log(`[${date}] slot=${slot} type=${post.type} tag=${post.tag}`);
  console.log('─'.repeat(40));
  console.log(post.text);
  console.log('─'.repeat(40));
  if (post.cardSpec) console.log(`カードspec: ${JSON.stringify(post.cardSpec)}`);

  if (dryRun) { console.log('dry-run: 投稿しませんでした'); return; }

  const userId = process.env.THREADS_USER_ID;
  const token = process.env.THREADS_ACCESS_TOKEN;
  if (!userId || !token) {
    console.error('THREADS_USER_ID と THREADS_ACCESS_TOKEN を環境変数に設定してください');
    process.exit(1);
  }

  const client = new ThreadsClient({ userId, accessToken: token });

  // 投稿枠の確認（250件/24h）。枠が尽きていたら投稿しない
  try {
    const limit = await client.publishingLimit();
    const used = limit?.data?.[0]?.quota_usage;
    const total = limit?.data?.[0]?.config?.quota_total;
    if (used != null) {
      console.log(`投稿枠: ${used}/${total ?? 250}`);
      if (total && used >= total) { console.error('投稿枠を使い切っています。中止します'); process.exit(1); }
    }
  } catch (e) { console.warn('投稿枠の確認に失敗（続行します）:', e.message); }

  // カードは cardSpec がある枠だけ付ける。テキストのみ枠（型T3夜は cardSpec が無い）に
  // Pages に古い生成器の slotN.png が残っていても添付しない（R社長指摘「12星座本文×縁カード」
  // の再発防止。公開URLの200確認だけでは cardSpec の有無を判定できないためここで止める）。
  const imageUrl = post.cardSpec ? await publishedCardUrl(date, slot) : null;
  const result = await client.publishText(post.text, imageUrl);
  console.log('投稿しました:', result.postId, imageUrl ? `（画像付き: ${imageUrl}）` : '（テキストのみ）');

  // カードはベストエフォート（失敗しても投稿は成立している。画像投稿の配信は別フェーズ）
  const cardPath = await genCard(date, slot, post.cardSpec);
  if (cardPath) console.log('カード生成:', cardPath);

  history.push({
    date, slot, type: post.type, tag: post.tag, text: post.text,
    postId: result.postId, cardPath: cardPath || null,
    at: new Date().toISOString(),
  });
  saveHistory(history);
}

main().catch(e => { console.error('失敗:', e.message); process.exit(1); });
