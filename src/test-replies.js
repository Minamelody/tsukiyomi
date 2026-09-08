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

console.log('2. B2返信文（受け取り＋誘導）');
{
  const t = buildReplyText('B2', 0, true);
  ok(t.includes('受け取りました'), '受け取りの一言あり');
  ok(t.includes('無料'), '誘導文あり');
  ok(t.length <= 120, `120字以内（${t.length}字）`);
  ok(!FORBIDDEN.some(w => t.includes(w)), '禁止語なし');
  // 誘導辞書ローテーション（連続で同じ文を使わない）
  const a = buildReplyText('B2', 0, true);
  const b = buildReplyText('B2', 1, true);
  ok(a !== b, '誘導文はローテーション（連続同一なし）');
}

console.log('3. 保留・安全装置');
ok(buildReplyText('D', 0, true) === null, 'D は返信文なし（自動送信しない）');
ok(buildReplyText('B2', 0, false) === '🌙、受け取りました。', '誘導不可時は受け取りのみ（誘導なし）');
ok(buildReplyText('A', 0, true) === null, 'A はテンプレ未定義（今回は保留）');

console.log(`\n結果: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
