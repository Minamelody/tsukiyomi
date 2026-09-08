// src/test-replies.js — 返信パイプラインの分類・返信文生成の回帰テスト（送信は行わない）
// 実行: node src/test-replies.js → すべて PASS で exit 0

const { classify, buildReplyText, FORBIDDEN } = require('./replies');

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  OK   ${name}`); }
  else { fail++; console.log(`  NG   ${name}`); }
}

console.log('1. 分類（D/C/A/B2/B）');
ok(classify('🌙') === 'B2', '🌙 → B2（絵文字のみ）');
ok(classify('💫') === 'B2', '💫 → B2');
ok(classify('⭐️') === 'B2', '⭐️ → B2');
ok(classify('') === 'B2', '空 → B2');
ok(classify('投資の相談です') === 'D', '投資 → D');
ok(classify('癌の相談') === 'D', '医療 → D');
ok(classify('転職迷ってます') === 'C', '転職 → C');
ok(classify('牡羊座です') === 'A', '牡羊座 → A');
ok(classify('今日いい日になりそう') === 'B', '雑談 → B');

console.log('2. B2返信文（受け取り＋誘導＝全員誘導）');
{
  const t = buildReplyText('B2', 0, true);
  ok(t.includes('受け取りました'), '受け取りの一言あり');
  ok(t.includes('無料'), '誘導文あり');
  ok(t.length <= 120, `120字以内（${t.length}字）`);
  ok(!FORBIDDEN.some(w => t.includes(w)), '禁止語なし');
  // 全員誘導：カーソルが進んでも誘導が入る（誘導率カウンタ撤廃・R社長 2026-09-08）
  ok(buildReplyText('B2', 20, true).includes('無料'), 'カーソルが進んでも誘導あり（カウンタ撤廃）');
  // 文面は受取×誘導の組合わせでローテーション → 12通りのユニーク文面（「それぞれに違う文面」）
  const set = new Set();
  for (let i = 0; i < 12; i++) set.add(buildReplyText('B2', i, true));
  ok(set.size === 12, `12通りすべてユニーク（${set.size}通り）＝同じ文面を並べない`);
}

console.log('3. 保留・安全装置');
ok(buildReplyText('D', 0, true) === null, 'D は返信文なし（自動送信しない）');
ok(!buildReplyText('B2', 0, false).includes('無料'), '同一ユーザー2回目は誘導なし（受け止めのみ）');
ok(buildReplyText('B2', 0, false).includes('受け取りました'), '誘導なしでも受け止めの一言あり');
ok(buildReplyText('A', 0, true) === null, 'A はテンプレ未定義（今回は保留）');

console.log('4. --recent-hours の窓解決（投稿+5h一括返信・前日またぎ）');
{
  const { filterRecentThreads } = require('./threads-api');
  const toApiTs = ms => new Date(ms).toISOString().replace('Z', '+0000');
  // 「今」= 9/9 2:00 JST（＝9/8 17:00 UTC）。前日 21:00 JST 投稿（＝9/8 12:00 UTC）＝5時間前。
  const now = Date.parse('2026-09-08T17:00:00Z');
  const post21 = Date.parse('2026-09-08T12:00:00Z'); // 前日21時投稿（5h前・日付またぎ）
  const older = Date.parse('2026-09-08T10:00:00Z');  // 7h前（窓外）
  const ids = filterRecentThreads([
    { id: 'prev21', timestamp: toApiTs(post21) },
    { id: 'older7', timestamp: toApiTs(older) },
  ], 6, now);
  ok(ids.includes('prev21'), '2:00 run が前日21時投稿を窓内に解決（6h窓）');
  ok(!ids.includes('older7'), '7時間前は窓外（取りこぼしは対象外）');
  ok(filterRecentThreads(null, 6, now).length === 0, 'data欠落でも空配列（クラッシュしない）');
}

console.log(`\n結果: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
