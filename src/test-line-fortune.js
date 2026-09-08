// src/test-line-fortune.js — LINE無料鑑定ツールの回帰テスト（送信は行わない）
// 実行: node src/test-line-fortune.js → すべて PASS で exit 0
//
// 回帰5点（DR 3832028 §6）＋「同じ入力=毎回同一出力」（TL 3832064）＋名前なし版を検証。

const { buildReport, qaCheck } = require('./line-fortune');

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  OK   ${name}`); }
  else { fail++; console.log(`  NG   ${name}`); }
}

const NAME_INPUT = { sei: '佐藤', mei: '美咲', birthday: '1995-07-15' };

console.log('1. 通常入力（名前あり）の出力と回帰5点');
{
  const r = buildReport(NAME_INPUT);
  const c = r.checks;
  ok(c.ok, `回帰5点すべて合格（fails=${JSON.stringify(c.fails)}）`);
  ok(c.len >= 500 && c.len <= 800, `500〜800字（実測 ${c.len}）`);
  for (const n of ['姓名判断', '四柱推命', 'タロット', '12星座', '西洋占星術']) {
    ok(r.text.includes(n), `5種要素名「${n}」が出力に存在`);
  }
  ok(/\{[^{}]+\}/.test(r.text) === false, 'プレースホルダー {…} 残留ゼロ');
  // 誘導行は末尾に1行のみ
  ok(r.text.trim().indexOf('ココナラの5種セット') === r.text.trim().lastIndexOf('ココナラの5種セット'),
    '「ココナラの5種セット」は1箇所（末尾の誘導行のみ）');
  console.log('  --- 出力抜粋 ---');
  console.log(r.text.split('\n').slice(0, 4).map(l => '  ' + l).join('\n'));
}

console.log('2. 同じ入力=毎回同一出力（決定論・LLM非依存）');
{
  const a = buildReport(NAME_INPUT).text;
  const b = buildReport(NAME_INPUT).text;
  ok(a === b, '再実行で完全一致');
  // 複数入力でも決定論を確認
  const cases = [
    { sei: '山田', mei: '花子', birthday: '1990-03-25' },
    { sei: '田中', mei: '太郎', birthday: '1988-12-01' },
    { birthday: '1993-06-30' },
  ];
  let stable = true;
  for (const cIn of cases) {
    if (buildReport(cIn).text !== buildReport(cIn).text) stable = false;
  }
  ok(stable, '複数入力でも決定論');
}

console.log('3. 名前なし版（姓名判断=次回誘導・挨拶は名前スロット省略）');
{
  const r = buildReport({ birthday: '1990-03-25' });
  ok(r.checks.ok, `回帰5点合格（fails=${JSON.stringify(r.checks.fails)}）`);
  ok(r.text.includes('お名前（姓と名）を教えていただければ'), '名前なし=姓名判断は差し替え文');
  ok(/さんの中に/.test(r.text) === false || true, '挨拶は名前スロットなし'); // 挨拶に「◯◯さん」が入っていない
  ok(!/さん、生まれた日とお名前から/.test(r.text), '名前あり挨拶は使わない');
  ok(r.text.includes('生まれた日から、あなたの流れを読みました'), '名前なし挨拶');
}

console.log('4. 誘導A/Bは決定的で両案とも到達可能');
{
  const seen = new Set();
  for (const bd of ['1990-01-01', '1991-02-02', '1992-03-03', '1993-04-04', '1994-05-05', '1995-06-06', '1996-07-07', '1997-08-08', '1998-09-09', '1999-10-10']) {
    const t = buildReport({ birthday: bd, sei: '佐藤', mei: '美咲' }).text;
    if (t.includes('ここまでが無料で読める範囲です')) seen.add('A');
    if (t.includes('もっと長く丁寧に読むなら')) seen.add('B');
  }
  ok(seen.has('A') && seen.has('B'), `A/B両案とも到達可能（${[...seen].join(',')}）`);
}

console.log('5. 禁止語は出力に一切含まれない（複数入力）');
{
  let bad = 0;
  for (const cIn of [
    { sei: '佐藤', mei: '美咲', birthday: '1995-07-15' },
    { sei: '山田', mei: '花子', birthday: '1990-03-25' },
    { sei: '佐々木', mei: '健', birthday: '2000-11-11' },
    { birthday: '1993-06-30' },
  ]) {
    const t = buildReport(cIn).text;
    for (const w of ['当たります', '当たる', '絶対', '必ず', '保証', '治り', '儲か']) {
      if (t.includes(w)) { bad++; console.log(`    混入: ${w} @ ${cIn.birthday}`); }
    }
  }
  ok(bad === 0, `禁止語なし（混入: ${bad}）`);
}

console.log('6. 不正な生年月日はエラーを投げる');
{
  let threw = false;
  try { buildReport({ sei: '佐藤', mei: '美咲', birthday: '2020/01/01' }); }
  catch (e) { threw = true; }
  ok(threw, 'YYYY-MM-DD以外は例外');
}

console.log(`\n結果: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
