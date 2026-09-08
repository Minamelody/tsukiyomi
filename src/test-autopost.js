// src/test-autopost.js — 自動投稿ランナーの二重投稿ガード回帰テスト（投稿は行わない）
// 実行: node src/test-autopost.js → すべて PASS で exit 0
//
// PM 3856350 の二重投稿事故（同日・同スロットの二重実行）再発防止の回帰。
// 1) alreadyPosted() の単位テスト（履歴スキーマに即した一致判定）
// 2) 子プロセス統合テスト（履歴ファイル注入 → ガードで early return すること・
//    投稿やトークン検査まで進まないことを立証）

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { alreadyPosted } = require('./autopost');

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  OK   ${name}`); }
  else { fail++; console.log(`  NG   ${name}`); }
}

console.log('1. alreadyPosted（履歴スキーマに即した一致判定）');
{
  // 実運用の履歴要素（main() が push する形）と同型
  const hist = [
    { date: '2026-09-09', slot: 0, type: 'type_a', tag: '天赦日', text: 'x', postId: '18088545332215964', cardPath: null, at: '...' },
    { date: '2026-09-09', slot: 1, type: 'type_fomo', tag: '', text: 'y', postId: 'P2', cardPath: null, at: '...' },
  ];
  ok(alreadyPosted(hist, '2026-09-09', 0) === true, '同日・同スロット → true（二重投稿を検知）');
  ok(alreadyPosted(hist, '2026-09-09', 1) === true, 'slot1 も true');
  ok(alreadyPosted(hist, '2026-09-09', 2) === false, '同日・別スロット → false');
  ok(alreadyPosted(hist, '2026-09-10', 0) === false, '別日・同スロット → false（翌日は妨げない）');
  ok(alreadyPosted([], '2026-09-09', 0) === false, '履歴なし → false');
  ok(alreadyPosted(null, '2026-09-09', 0) === false, '履歴 null → false（壊れても暴発しない）');
  // 旧履歴に slot が無い場合も誤検知しない
  ok(alreadyPosted([{ date: '2026-09-09', text: 'old', postId: 'OLD' }], '2026-09-09', 0) === false, 'slot フィールド欠落 → false');
}

console.log('2. 子プロセス統合（同日・同スロットの再実行は早期終了し、投稿へ進まない）');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autopost-test-'));
  const histPath = path.join(dir, 'post-history.json');
  // 日本時間の「今日」に揃えた履歴を注入（main() と同じ算出式）
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  const today = jst.toISOString().slice(0, 10);
  fs.writeFileSync(histPath, JSON.stringify([
    { date: today, slot: 0, type: 'type_a', tag: '', text: 'x', postId: 'DUPE123', cardPath: null, at: '...' },
  ], null, 2));

  const env = { ...process.env, AUTOPOST_HISTORY: histPath };
  const argv = ['src/autopost.js', '--slot', '0'];

  // ケースA: 同日・同スロット → ガードで早期終了（exit 0・トークン検査まで進まない）
  const outA = execFileSync('node', argv, { env, cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  ok(/投稿済みです/.test(outA), 'ガードのスキップ文言を出力');
  ok(!/設定してください/.test(outA), 'トークン検査（投稿経路）まで進まない');
  ok(!/投稿しました/.test(outA), '投稿していない');

  // ケースB: 別スロット（slot1・未投稿）→ ガードをスルーしてトークン検査へ（exit 1）
  let outB = '';
  try { execFileSync('node', ['src/autopost.js', '--slot', '1'], { env, cwd: path.join(__dirname, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { outB = (e.stdout || '') + (e.stderr || ''); }
  ok(!/投稿済みです/.test(outB), '別スロットはガードで止まらない');
  ok(/設定してください/.test(outB), 'トークン検査へ進む（＝ガードが過剰遮断しない）');

  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n結果: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
