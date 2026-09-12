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
  ok(t.includes('https://lin.ee/oSQE3an'), '公式LINEリンク（URL）を含む');
  ok(t.length <= 120, `120字以内（${t.length}字）`);
  ok(!FORBIDDEN.some(w => t.includes(w)), '禁止語なし');
  // 全員誘導：カーソルが進んでも誘導が入る（誘導率カウンタ撤廃・R社長 2026-09-08）
  ok(buildReplyText('B2', 20, true).includes('無料'), 'カーソルが進んでも誘導あり（カウンタ撤廃）');
  // 文面はリード文（12種）×誘導テール（3型）でローテーション → 12通りのユニーク文面（「それぞれに違う文面」）
  const set = new Set();
  for (let i = 0; i < 12; i++) set.add(buildReplyText('B2', i, true));
  ok(set.size === 12, `12通りすべてユニーク（${set.size}通り）＝同じ文面を並べない`);
}

console.log('3. 保留・安全装置');
ok(buildReplyText('D', 0, true) === null, 'D は返信文なし（自動送信しない）');
ok(!buildReplyText('B2', 0, false).includes('無料'), '同一ユーザー2回目は誘導なし（受け止めのみ）');
ok(buildReplyText('B2', 0, false).includes('受け取りました'), '誘導なしでも受け止めの一言あり');

console.log('4. B分類（雑談・お礼リプ）＝受け取り＋軽い鑑定1行＋LINE誘導（2026-09-12 Designer追補）');
{
  ok(classify('🌙ありがとうございます') === 'B', '🌙ありがとう → B（お礼＝雑談）');
  ok(classify('ありがとうございます') === 'B', 'お礼のみ（🌙なし） → B');
  // プール6本を1件ずつ割当て・全件URL含有・120字以内・禁止語なし・プール内ユニーク
  const seen = new Set();
  for (let i = 0; i < 6; i++) {
    const b = buildReplyText('B', i, true);
    ok(b.includes('https://lin.ee/oSQE3an'), `B#${i + 1} は公式LINEリンク（URL）を含む`);
    ok(b.length <= 120, `B#${i + 1} は120字以内（${b.length}字）`);
    ok(!FORBIDDEN.some(w => b.includes(w)), `B#${i + 1} は禁止語なし`);
    ok(b.includes('ありがとう'), `B#${i + 1} は受け取りの一言あり`);
    seen.add(b);
  }
  ok(seen.size === 6, `Bプール6本すべてユニーク（${seen.size}/6）＝同じ文面を並べない`);
  // 同一ユーザー2回目=誘導なし（URLを外した受け取りのみ）
  const noguide = buildReplyText('B', 0, false);
  ok(!noguide.includes('https://lin.ee/oSQE3an'), 'B=同一ユーザー2回目はURL（誘導）なし');
  ok(noguide.includes('ありがとう'), 'B=誘導なしでも受け取りは返す');
}

console.log('5. 軽鑑定（A=自己申告/生年月日・C=相談 への自動返信）');
{
  // 分類: 生年月日は軽鑑定対象（A）に
  ok(classify('1995年3月12日生まれです') === 'A', '生年月日 → A（軽鑑定対象）');
  // 星座自己申告 → 呼称に星座名・見立て＋誘導
  const a = buildReplyText('A', 0, true, '牡羊座です。今日から始めたいことあります');
  ok(a.includes('牡羊座さん'), '星座名を呼称に反映');
  ok(a.includes('お悩みを読ませていただきました'), '定型の受け止め行');
  ok(a.includes('近づいている変化は'), '見立て#1（辞書ローテーション）');
  ok(a.includes('こちらのLINEから'), '公式LINE誘導行（全員誘導）');
  ok(a.includes('https://lin.ee/oSQE3an'), '軽鑑定にもLINEリンク');
  ok(a.length <= 120, `120字以内（${a.length}字）`);
  ok(!FORBIDDEN.some(w => a.includes(w)), '効果保証語/禁止語なし');
  // 相談（C・星座なし）→ 呼称なしで受け止め＋見立て#2
  const c = buildReplyText('C', 1, true, '転職迷ってます');
  ok(c.includes('お悩みを読ませていただきました'), 'C=受け止め行');
  ok(c.includes('焦っているほど、見えていないものが1つあります'), 'C=見立て#2（ローテーション）');
  ok(!c.includes('さん、'), '星座なし=Cは呼称なし');
  ok(c.includes('こちらのLINEから'), 'Cも誘導あり');
  // 見立て3種で文面ユニーク（それぞれに違う文面）
  const s = new Set();
  for (let i = 0; i < 3; i++) s.add(buildReplyText('A', i, true, '牡羊座です'));
  ok(s.size === 3, `見立て3種で文面ユニーク（${s.size}/3）`);
  // 同一ユーザー2回目=誘導なし（受け止め＋見立てのみ）
  const noguide = buildReplyText('A', 0, false, '牡羊座です');
  ok(!noguide.includes('無料の鑑定'), '2回目は誘導なし');
  ok(noguide.includes('お悩みを読ませていただきました'), '2回目も受け止めは返す');
}

console.log('6. D判定（医療/投資/法律）は軽鑑定対象外・自動送信しない');
{
  ok(buildReplyText('D', 0, true, '投資の相談です') === null, 'D=自動返信なし（人対応）');
  ok(classify('癌の相談です') === 'D', '医療 → D');
  ok(classify('株の相談があります') === 'D', '投資 → D');
}

console.log('7. 返信に載せるURLは公式LINEのみ（他URL・ココナラ・DMなし＝許可範囲の暴発防止）');
{
  const samples = [];
  for (let i = 0; i < 9; i++) samples.push(buildReplyText('B2', i, true));
  samples.push(buildReplyText('A', 0, true, '牡羊座です'));
  samples.push(buildReplyText('C', 1, true, '転職迷ってます'));
  for (let i = 0; i < 6; i++) samples.push(buildReplyText('B', i, true));
  const all = samples.join('\n');
  ok(/https:\/\/lin\.ee\/oSQE3an/.test(all), '公式LINEリンクは含まれる');
  const rest = all.split('https://lin.ee/oSQE3an').join('');
  ok(!/https?:\/\//.test(rest), '公式LINE以外のURLは含まれない');
  ok(!all.includes('ココナラ'), 'ココナラURLは誘導に載せない');
  ok(!all.includes('DM'), 'DM直連は案内しない');
}

console.log(`\n結果: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
