#!/usr/bin/env bash
# リリース前の最終確認。tarball を作った「後」に、それを展開して実際に動かす。
#
# なぜ要るか: v13.1 で「ビルドは通るが納品ツールのPDF生成が壊れている」を出した。
# ビルド（assertNoPaidContent）は dist だけを見るので、納品ツール経路は素通りする。
# tarball を展開して注文1件分を通すところまでやらないと、この種は止まらない。
#
# 使い方:
#   tools/release-check.sh dist/../tsukiyomi-v13.2.tar.gz https://Minamelody.github.io/tsukiyomi
set -euo pipefail

TARBALL="${1:?使い方: release-check.sh <tarball> <SITE_URL>}"
SITE_URL="${2:?SITE_URL を指定してください（canonical に焼かれます）}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
echo "== tarball を展開: $TARBALL"
tar xzf "$TARBALL" -C "$WORK"
cd "$WORK"

fail() { echo "NG: $*" >&2; exit 1; }

echo "== 1. src/ と tools/ の共有ファイルが同期しているか"
for f in figures.py pdfgen.py; do
  if [ -f "src/$f" ] && [ -f "tools/$f" ]; then
    cmp -s "src/$f" "tools/$f" || fail "$f が src/ と tools/ で違います（片方だけ差し替えた形）"
  fi
done

echo "== 2. 静的サイトのビルド"
SITE_URL="$SITE_URL" node tools/build-static.js >/dev/null
grep -q 'rel="canonical"' dist/index.html || fail "canonical が出ていません"
[ -f dist/BUILD-INFO.txt ] || fail "BUILD-INFO.txt がありません"

echo "== 3. ブラウザに渡してはいけないものが dist に無いか"
node -e '
const fs=require("fs");const h=fs.readFileSync("dist/index.html","utf8");
const m=h.match(/module\.exports = \{ read[^}]*\}/);
if(!m) { console.error("公開関数の宣言が見つかりません"); process.exit(1); }
for (const bad of ["factsFor","readWithLLM"])
  if (m[0].includes(bad)) { console.error("ブラウザに "+bad+" が公開されています"); process.exit(1); }
'

echo "== 4. 納品ツールで注文1件分を実際に通す（PDFが出るところまで）"
# 本番と同じ経路を通す。deliver-ui.js の generate() と makePdf() をそのまま呼ぶ。
# 自前で pdfgen の引数を組むと「呼ばれる側」しか検証できず、v13.1 で壊れた
# 「呼ぶ側の引数不整合」が素通りする（実際に素通りした）。ここは必ず本番の関数を使う。
node - <<'NODE'
const path = require('path');
const fs = require('fs');
const os = require('os');

const dui = require('./src/deliver-ui.js');
if (typeof dui.makePdf !== 'function' || typeof dui.generate !== 'function') {
  console.error('deliver-ui.js が generate/makePdf をエクスポートしていません（検証が本番経路を通れません）');
  process.exit(1);
}

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-'));
const pdf = path.join(out, 'smoke.pdf');

// 一字姓＋二字名。霊数が片側だけ効くケースを既定にする（対称ケースだけだと出し分けが検証されない）。
const order = { sei: '林', mei: '美咲', birthday: '1995-07-15', gender: '女性',
                question: '転職しようか迷っています', types: 'seimei' };

(async () => {
  const g = await dui.generate(order);            // 本番と同じ生成経路
  const seimei = g.readings.find(r => r.type === 'seimei');
  if (!seimei) { console.error('姓名判断が返りません:', g.skipped); process.exit(1); }

  // 霊数の個別注記が納品テキストに載っているか（LLM経路でも消えないこと）
  if (!/霊数1を補って天格を算出/.test(g.text)) {
    console.error('納品テキストに霊数の注記（天格）がありません'); process.exit(1);
  }
  if (/霊数1を補って[^。]*地格/.test(g.text)) {
    console.error('林美咲の地格に霊数は入りません。注記が誤りです'); process.exit(1);
  }

  await dui.makePdf({ display: g.display, input: g.input, readings: g.readings,
                      text: g.text, plan: 'seimei' }, pdf);   // 本番と同じPDF経路

  const kb = fs.statSync(pdf).size / 1024;
  if (kb < 50) { console.error('PDFが小さすぎます: ' + kb.toFixed(0) + 'KB'); process.exit(1); }

  // 一時ファイル（顧客データ）が残っていないこと
  for (const leak of [pdf + '.txt', pdf + '.charts.json']) {
    if (fs.existsSync(leak)) { console.error('一時ファイルが残っています: ' + path.basename(leak)); process.exit(1); }
  }

  // 増量の補足ループが特定の章に偏っていないか。
  // 以前「追加分を全部 sections[0] に足して1章が全体の75%」という偏りを出しているので、
  // LLMが走った回だけ配分を見る（ルールベース固定文は対象外）。
  if (seimei.sections && seimei.sections.length > 1) {
    const lens = seimei.sections.map(x => x.body.length);
    const total = lens.reduce((a, b) => a + b, 0);
    const max = Math.max(...lens);
    const share = max / total;
    if (share > 0.5) {
      console.error('章の配分が偏っています: 最長章が全体の ' + (share * 100).toFixed(0) + '%'
        + '（増量の補足が1章に集中している可能性）');
      process.exit(1);
    }
    console.log('   章の配分OK (最長章 ' + (share * 100).toFixed(0) + '%・' + total + '字)');
  }

  console.log('   納品PDF生成OK (' + kb.toFixed(0) + 'KB)・deliver-ui.js 経由・一時ファイル破棄OK');
  fs.rmSync(out, { recursive: true, force: true });
})().catch(e => { console.error('納品経路で失敗:', e.message); process.exit(1); });
NODE

echo "== 5. dist のページ内リンクが絶対パスでないか"
# GitHub Pages はサブディレクトリ配信（/tsukiyomi/）なので、href="/..." は
# ドメイン直下を指して404になる。プライバシーポリシーがこれで踏めなくなっていた。
if grep -n 'href="/' dist/*.html; then
  fail 'dist に絶対パスのリンクがあります（サブディレクトリ配信で404になります）'
fi

echo "== 5b. 購入導線が生きているか（ココナラURLが7枠すべて埋まるか）"
# 段2は環境変数なしでビルドするので、ココナラURLは0本。つまり release-check だけでは
# 「URLが1本も入っていない tarball」を検知できない（REQUIRE_SHOP_URLS は Actions 経路のみ）。
# そこで dist を「URLあり」で焼き直して、購入ボタンが全部生きることを確認する。
# 「準備中です」は ctaHTML() のフォールバック定義1件だけが正常。実ボタンに出たら増える。
_probe=$(mktemp -d); trap 'rm -rf "$_probe"' EXIT
SITE_URL="$SITE_URL" \
COCONALA_PROFILE_URL=https://example.com/u \
COCONALA_URL_SEIMEI=https://example.com/1 COCONALA_URL_SEIZA=https://example.com/2 \
COCONALA_URL_TAROT=https://example.com/3 COCONALA_URL_SHICHU=https://example.com/4 \
COCONALA_URL_ASTRO=https://example.com/5 COCONALA_URL_BUNDLE=https://example.com/6 \
REQUIRE_SHOP_URLS=1 node tools/build-static.js >"$_probe/log" 2>&1 \
  || { cat "$_probe/log"; fail 'URL7本を与えたビルドが失敗しました'; }
# ボタンはJSが実行時に組むので、HTMLを grep しても数えられない
# （「準備中です」はテンプレート定義として常に1件出る）。SHOP_URLS を実際に読んで、
# 6商品すべてに URL が入っているかを見る。
node -e '
const fs=require("fs");
const h=fs.readFileSync("dist/index.html","utf8");
const m=h.match(/SHOP_URLS = (\{.*?\});/s);
if(!m){ console.error("SHOP_URLS が見つかりません"); process.exit(1); }
const j=JSON.parse(m[1]);
const missing=[];
for(const k of ["seimei","seiza","tarot","shichu","astro"])
  if(!j.single || !j.single[k]) missing.push(k);
if(!j.bundle) missing.push("bundle");
if(!j.profile) missing.push("profile");
if(missing.length){
  console.error("URLが入っていない枠があります（該当ボタンが「準備中です」になります）: "+missing.join(", "));
  process.exit(1);
}
' || fail '購入導線に欠けがあります'
grep -q 'REQUIRE_SHOP_URLS' .github/workflows/pages.yml \
  || fail 'pages.yml に REQUIRE_SHOP_URLS がありません（Actions経路のガードが外れています）'
echo "   購入導線OK（6商品＋プロフィールの7枠すべてにURL・pages.yml のガードあり）"

echo "== 6. サイトのAI表記が復活していないか"
# R社長の決定（2026-09-06・B案）: サイトからAI表記を全外し。
# 検査は「消したい語の列挙」ではなく単語としての AI で落とす方式（tools/check-no-ai.sh）。
# 列挙方式は列挙漏れがそのまま穴になる（「AIが同時に」がすり抜けた実例あり）。
#
# privacy.html §2 の1行だけは意図的に残す。無料診断がブラウザ内で完結し
# 外部へ送信しない、という事実の説明であって販売訴求ではないため。
# ファイル全体を除外せず1行だけ許可するので、privacy.html の他でAIが増えれば検出される。
bash tools/check-no-ai.sh dist '外部のAIサービスへ送信することもありません' \
  || fail 'AI表記の検査に失敗しました'

echo
echo "OK: この tarball はビルド・公開関数の絞り込み・納品PDF生成（本番経路）・リンク検査・AI表記ゼロまで通りました。"
