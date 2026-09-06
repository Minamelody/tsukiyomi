#!/usr/bin/env node
// Renderの無料プランは15分アクセスが無いとスリープし、復帰に30〜60秒かかる。
// Threadsから流入した人が最初に踏むページなので、そこで待たされると離脱する。
// このジョブを10分ごとに走らせて無活動タイマーをリセットし、常時起動を保つ。
// 無料枠は750インスタンス時間/月に対し常時起動でも約730時間なので、枠内に収まる。

const host = process.env.SITE_URL || process.env.RENDER_EXTERNAL_URL;
if (!host) {
  console.error('SITE_URL が未設定です');
  process.exit(1);
}
const url = /^https?:\/\//.test(host) ? `${host}/healthz` : `https://${host}/healthz`;

const ctrl = new AbortController();
const timer = setTimeout(() => ctrl.abort(), 30000);

fetch(url, { signal: ctrl.signal })
  .then(r => {
    console.log(`${new Date().toISOString()} ${url} -> ${r.status}`);
    process.exit(r.ok ? 0 : 1);
  })
  .catch(e => {
    console.error(`${new Date().toISOString()} ${url} 失敗: ${e.message}`);
    process.exit(1);
  })
  .finally(() => clearTimeout(timer));
