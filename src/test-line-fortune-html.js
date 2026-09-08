// src/test-line-fortune-html.js — ローカルHTML版の一致回帰テスト（送信は行わない）
// 実行: node src/test-line-fortune-html.js → すべて PASS で exit 0
//
// 検証: 生成済み docs/line-fortune.html からエンジン部分を抽出して Node 上で評価し、
// CLI（./line-fortune の buildReport）と「同一入力 = 同一出力」であることを、
// 誘導A/B・回帰5点チェック結果を含む全出力で突き合わせる。
// これにより「文面QA合格基準が HTML版にもそのまま有効」であることを保証する。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const cli = require('./line-fortune');

const HTML = path.join(__dirname, '..', 'docs', 'line-fortune.html');

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  OK   ${name}`); }
  else { fail++; console.log(`  NG   ${name}`); }
}

// 1. HTML からエンジン抽出
const html = fs.readFileSync(HTML, 'utf8');
const m = html.match(/\/\* ==== ENGINE BEGIN[\s\S]*?\*\/([\s\S]*?)\n\/\* ==== ENGINE END/);
if (!m) {
  console.log('  エンジンブロックが見つかりません（build-line-fortune-html.js を先に実行）');
  process.exit(1);
}
const engineCode = m[1];

// 2. エンジンを評価して buildReport を得る
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(engineCode + "\n;globalThis.__LF = __ns['./line-fortune'];", sandbox);
const htmlBuild = sandbox.__LF.buildReport;
ok(typeof htmlBuild === 'function', 'エンジンから buildReport を取得');

// 3. 一致回帰（同一入力 = 同一出力・全出力突合）
console.log('1. CLI ≡ HTML 一致回帰（同一入力 = 同一出力）');
const cases = [
  { sei: '佐藤', mei: '美咲', birthday: '1995-07-15' },
  { sei: '山田', mei: '花子', birthday: '1990-03-25' },
  { sei: '田中', mei: '太郎', birthday: '1988-12-01' },
  { sei: '佐々木', mei: '健', birthday: '2000-11-11' },
  { birthday: '1993-06-30' },                       // 名前なし
  { sei: '林', mei: '大', birthday: '1977-01-01' },  // 一字姓・一字名（霊数補正）
  { sei: '高橋', mei: '結衣', birthday: '2005-02-14' },
  { sei: '鈴木', mei: '一郎', birthday: '1960-12-31' },
  { sei: '渡辺', mei: 'さくら', birthday: '2010-08-08' },
  { sei: '伊藤', mei: '光', birthday: '1945-04-29' },
];
// 誘導A/B 両方に到達する生年月日（回帰テストと同じ10件）
for (const bd of ['1990-01-01','1991-02-02','1992-03-03','1993-04-04','1994-05-05','1995-06-06','1996-07-07','1997-08-08','1998-09-09','1999-10-10']) {
  cases.push({ sei: '佐藤', mei: '美咲', birthday: bd });
}

let mismatch = 0;
for (const c of cases) {
  const a = cli.buildReport(c);
  const b = htmlBuild(c);
  const same = JSON.stringify(a) === JSON.stringify(b);
  if (!same) {
    mismatch++;
    console.log(`    MISMATCH: ${JSON.stringify(c)}`);
  }
}
ok(mismatch === 0, `全 ${cases.length} ケースで CLI ≡ HTML 完全一致（不一致 ${mismatch}）`);

// 4. 回帰5点が HTML 側でも通る（代表ケース）
console.log('2. 回帰5点（HTML側 buildReport.checks）');
{
  const r = htmlBuild({ sei: '佐藤', mei: '美咲', birthday: '1995-07-15' });
  ok(r.checks.ok, `回帰5点合格（fails=${JSON.stringify(r.checks.fails)}）`);
  ok(r.checks.len >= 500 && r.checks.len <= 800, `500〜800字（実測 ${r.checks.len}）`);
}

console.log('3. 生成物の配信安全性（external refer無し・ES modules無し）');
{
  const lower = html.toLowerCase();
  ok(!/<link /i.test(html), '<link>（外部CSS）なし');
  ok(!/src=/i.test(html), 'src=（外部JS）なし');
  ok(!/import /i.test(html), 'import（ES modules）なし');
  ok(!/https?:\/\//i.test(html), '外部URL なし');
  ok(html.includes("__ns['./line-fortune']"), 'エンジン組み込み済み');
}

console.log(`\n結果: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
