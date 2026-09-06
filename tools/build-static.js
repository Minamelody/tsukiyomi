#!/usr/bin/env node
// 完全クライアントサイド版をビルドする。
//
// 目的: 静的ホスティング（Cloudflare Pages / GitHub Pages / Netlify）に置くだけで動く形にする。
//   - サーバー不要 → 完全無料・スリープなし・コールドスタートなし
//   - 生年月日と悩みが一切サーバーに送られない → プライバシー面の負担が最小になる
//
// 成立する理由: 無料パートの占術計算は5種すべてコード内で完結していて、
// LLMもネットワークもファイルI/Oも使わない（実測: 無料診断のAPI応答が1〜9ミリ秒、
// generateReading の呼び出し回数は0）。だからそのままブラウザへ持って行ける。
//
// 有料パート（LLM生成）はブラウザに出さない。APIキーが露出するため。
// 有料鑑定はココナラのトークルームで納品するので、サイト側には不要。
//
//   node tools/build-static.js   → dist/ に index.html と privacy.html を出す

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

// ブラウザへ持って行くモジュール（依存順）。llm.js は含めない（APIキーを露出させない）
const MODULES = ['strokes-table.js', 'seimei.js', 'fortune.js', 'shichu.js', 'tarot.js', 'astro.js', 'readings.js'];

/**
 * readings.js から有料パート（paid: {...}）を取り除く。
 *
 * `paid:` の直後の波括弧を対応括弧まで数えて丸ごと落とす。
 * 文字列リテラル・テンプレートリテラル・エスケープを跨がないよう1文字ずつ走る。
 * readWithLLM / factsFor は無料版では使わないので、関数ごと落とす。
 */
function stripPaid(code) {
  let out = '';
  let i = 0;
  let removed = 0;
  while (i < code.length) {
    const at = code.indexOf('paid: {', i);
    if (at < 0) { out += code.slice(i); break; }
    out += code.slice(i, at) + 'paid: null';
    // 対応する } を探す
    let d = 0, j = code.indexOf('{', at);
    let str = null;      // 現在の文字列リテラルの引用符
    for (; j < code.length; j++) {
      const c = code[j];
      if (str) {
        if (c === '\\') { j++; continue; }
        if (c === str) str = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { str = c; continue; }
      if (c === '{') d++;
      else if (c === '}') { d--; if (d === 0) { j++; break; } }
    }
    removed++;
    i = j;
  }
  if (!removed) throw new Error('readings.js の paid ブロックを検出できませんでした（build-static.js の stripPaid を確認）');
  console.log(`  有料パートを ${removed} 箇所ブラウザ用バンドルから除去`);
  return out;
}

/** CommonJS を IIFE のモジュールレジストリに包む（バンドラを持ち込まずに解決する） */
function bundle() {
  const parts = [
    '// 自動生成 — tools/build-static.js が src/ から生成する。直接編集しない。',
    '(function(){',
    'var __mods={},__cache={};',
    'function require(p){',
    '  var k=p.replace(/^\\.\\//,"").replace(/\\.js$/,"");',
    '  if(__cache[k])return __cache[k].exports;',
    '  var m={exports:{}};__cache[k]=m;__mods[k](m,m.exports,require);return m.exports;',
    '}',
  ];
  for (const f of MODULES) {
    const name = f.replace(/\.js$/, '');
    let code = fs.readFileSync(path.join(SRC, f), 'utf8');
    // 有料パートのLLM生成はブラウザ側では使わないので参照を落とす
    code = code.replace(
      /const \{ generateReading, isConfigured \} = require\('\.\/llm'\);/,
      'const generateReading = async () => null;\nconst isConfigured = () => false;'
    );
    // 有料の深掘り鑑定はブラウザへ持って行かない。
    // 表示側で絞るだけでは、コンソールから TSUKIYOMI.read(...).paid で全文が取れてしまう
    // （¥3,000商品が無料で読める）。データそのものを存在させないのが唯一の防ぎ方。
    if (f === 'readings.js') {
      code = stripPaid(code);
      // ブラウザへ出す関数を無料診断に必要な分だけに絞る。
      // factsFor は計算確定値（五格の画数・吉凶・意味、五行バランス、カードの意味）を
      // 完全な形で返すので、公開すると有料章「五格すべての判定」が素で読める。
      // PDF図版のためにサーバー側（納品ツール）で必要な関数で、ブラウザには要らない。
      // readWithLLM も同様。
      const before = 'module.exports = { read, readAll, readWithLLM, factsFor, TYPES, PRICE_SINGLE, PRICE_BUNDLE };';
      const after = 'module.exports = { read, readAll, TYPES, PRICE_SINGLE, PRICE_BUNDLE };';
      if (!code.includes(before)) {
        throw new Error('readings.js の module.exports が想定と一致しません（build-static.js の絞り込みを更新してください）');
      }
      code = code.replace(before, after);
    }
    parts.push(`__mods[${JSON.stringify(name)}]=function(module,exports,require){\n${code}\n};`);
  }
  parts.push('window.TSUKIYOMI=require("readings");');
  parts.push('})();');
  return parts.join('\n');
}

/** 生成物を実際に評価して、有料鑑定が取り出せないことを確認する */
function assertNoPaidContent(html) {
  const start = html.indexOf('<script>');
  const end = html.indexOf('</script>', start);
  const sandbox = { window: {} };
  // eslint-disable-next-line no-new-func
  new Function('window', html.slice(start + '<script>'.length, end))(sandbox.window);
  const T = sandbox.window.TSUKIYOMI;
  if (!T) throw new Error('バンドルから TSUKIYOMI を取得できませんでした');

  const probe = { sei: '佐藤', mei: '美咲', birthday: '1995-07-15', question: '転職しようか迷っています' };
  const leaks = [];
  for (const t of T.TYPES) {
    const r = T.read(t.id, probe);
    if (r && r.paid && Array.isArray(r.paid.sections) && r.paid.sections.length) leaks.push(t.id);
  }
  if (leaks.length) {
    throw new Error(`有料鑑定がブラウザから取得できます: ${leaks.join(', ')} — 公開してはいけません`);
  }
  // 有料相当の情報を返す関数が公開されていないこと。
  // paid を消しても factsFor から五格の全判定が取れていたので、関数単位でも塞ぐ。
  for (const name of ['factsFor', 'readWithLLM']) {
    if (typeof T[name] === 'function') {
      throw new Error(`${name} がブラウザへ公開されています（有料鑑定の内容が取得できます） — 公開してはいけません`);
    }
  }

  // 無料パートは従来どおり動くこと（絞り込みで壊していないか）
  const free = T.readAll(probe);
  if (!free.length || !free.every(r => r.available === false || r.free)) {
    throw new Error('無料診断が壊れています（絞り込みの影響を確認してください）');
  }

  console.log('  検証: 有料鑑定・factsFor・readWithLLM はブラウザから取得できません');
}

function build() {
  fs.mkdirSync(DIST, { recursive: true });
  const engine = bundle();

  let html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

  // ココナラの出品URLは環境変数ではなくビルド時に埋め込む（サーバーが無いため）
  const urls = {
    profile: process.env.COCONALA_PROFILE_URL || '',
    single: {
      seimei: process.env.COCONALA_URL_SEIMEI || '',
      seiza: process.env.COCONALA_URL_SEIZA || '',
      tarot: process.env.COCONALA_URL_TAROT || '',
      shichu: process.env.COCONALA_URL_SHICHU || '',
      astro: process.env.COCONALA_URL_ASTRO || '',
    },
    bundle: process.env.COCONALA_URL_BUNDLE || '',
  };

  // ココナラURLが1本も無いままビルドすると、購入ボタンが全部「準備中です」になる。
  // 出品が済んだ後に Variables 未設定のまま再ビルドすると、URLが入っていた dist を
  // 黙って上書きして購入導線が消える。REQUIRE_SHOP_URLS=1 を付けたビルドでは落とす。
  const shopFilled = [urls.profile, urls.bundle, ...Object.values(urls.single)]
    .filter(Boolean).length;
  if (process.env.REQUIRE_SHOP_URLS === '1' && shopFilled === 0) {
    throw new Error(
      'ココナラURLが1本も設定されていません（購入ボタンが全て「準備中です」になります）。\n'
      + '      GitHub Actions なら Settings → Secrets and variables → Actions → Variables に\n'
      + '      COCONALA_PROFILE_URL / COCONALA_URL_* を設定してください。');
  }
  if (shopFilled === 0) {
    console.warn('注意: ココナラURLが未設定です。購入ボタンは全て「準備中です」表示になります');
  } else if (shopFilled < 7) {
    console.warn(`注意: ココナラURLが ${shopFilled}/7 本のみ設定されています（未設定の枠は「準備中です」表示）`);
  }

  // fetch('/api/diagnose') をローカル計算に差し替える
  const shim = `
<script>${engine}</script>
<script>
// サーバーへは何も送らない。診断はこのブラウザ内で完結する。
const SHOP_URLS = ${JSON.stringify(urls)};
// 入力の正規化。サーバーが無いので、サーバー側でやっていた検証をここで行う。
// 切り出しはコードポイント単位（String#slice はUTF-16単位で、「𠮷」のような
// サロゲートペアが境界に来ると文字が割れる）。
function __cut(v, n){ return typeof v === 'string' ? [...v.trim()].slice(0, n).join('') : ''; }
function __validBirthday(v){
  if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v||'')) return false;
  const p = v.split('-').map(Number), y=p[0], m=p[1], d=p[2];
  if(y < 1900 || y > new Date().getFullYear()) return false;
  const dt = new Date(Date.UTC(y, m-1, d));
  // 2月30日・4月31日のような存在しない日付を弾く（Dateが繰り上げるのを検出）
  return dt.getUTCFullYear()===y && dt.getUTCMonth()===m-1 && dt.getUTCDate()===d;
}
window.__diagnose = function(raw){
  const input = {
    sei: __cut(raw.sei, 32), mei: __cut(raw.mei, 32),
    name: __cut(raw.name, 64), birthday: __cut(raw.birthday, 10),
    gender: __cut(raw.gender, 16), question: __cut(raw.question, 400),
  };
  if(!__validBirthday(input.birthday)) throw new Error('生年月日を正しく入力してください');
  const T = window.TSUKIYOMI;
  const all = T.readAll(input);
  return {
    types: all.map(function(r){
      return { type:r.type, name:r.name, icon:r.icon, desc:r.desc,
               available:r.available, reason:r.reason, free:r.free||null };
    }),
    priceSingle: T.PRICE_SINGLE, priceBundle: T.PRICE_BUNDLE, shopUrls: SHOP_URLS
  };
};
</script>`;

  html = html.replace('</head>', shim + '\n</head>');

  // 診断ボタンの通信部分をローカル呼び出しへ。
  // 置換が効かないまま出すとサーバーへ投げて必ず失敗するので、下で必ず検証する。
  const NEEDLE = "const res=await fetch('/api/diagnose',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(INPUT)});\n    const j=await res.json();\n    if(!res.ok)throw new Error(j.error||'失敗しました');";
  if (!html.includes(NEEDLE)) {
    throw new Error('public/index.html の /api/diagnose 呼び出しが想定と一致しません。build-static.js の NEEDLE を更新してください');
  }
  html = html.replace(NEEDLE, 'const j=window.__diagnose(INPUT);');

  if (/fetch\(['"]\/api\//.test(html)) {
    throw new Error('ビルド結果にサーバーAPIの呼び出しが残っています（静的版では動きません）');
  }

  // 有料鑑定が本当に消えているかを、生成物を実行して確かめる。
  // 「バンドルから外したつもり」を信用しない（facts が全種 null だったのと同じ見落ちを防ぐ）。
  assertNoPaidContent(html);

  // canonical / OGP / JSON-LD の絶対URLを埋める。
  // 未設定のまま出すとプレースホルダが本番に出てしまうので、その場合はSEOタグを落とす。
  const site = (process.env.SITE_URL || '').replace(/\/$/, '');
  if (site) {
    html = html.split('__SITE_URL__').join(site);
  } else {
    html = html.replace(/^.*__SITE_URL__.*$/gm, '');
    console.warn('警告: SITE_URL が未設定のため canonical/OGP/JSON-LD を出力しませんでした');
    console.warn('      公開URLが決まったら SITE_URL=https://example.com node tools/build-static.js で再ビルドしてください');
  }

  fs.writeFileSync(path.join(DIST, 'index.html'), html);
  fs.copyFileSync(path.join(ROOT, 'public', 'privacy.html'), path.join(DIST, 'privacy.html'));

  // robots.txt と sitemap.xml（SITE_URL があるときだけ意味を持つ）
  if (site) {
    fs.writeFileSync(path.join(DIST, 'robots.txt'),
      `User-agent: *\nAllow: /\n\nSitemap: ${site}/sitemap.xml\n`);
    const today = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(path.join(DIST, 'sitemap.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>\n`
      + `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
      + `  <url><loc>${site}/</loc><lastmod>${today}</lastmod><priority>1.0</priority></url>\n`
      + `  <url><loc>${site}/privacy.html</loc><lastmod>${today}</lastmod><priority>0.3</priority></url>\n`
      + `</urlset>\n`);
  }

  // Designer から og.png（1200×630）が届いたら public/ に置く。あれば dist へコピーする。
  const og = path.join(ROOT, 'public', 'og.png');
  if (fs.existsSync(og)) fs.copyFileSync(og, path.join(DIST, 'og.png'));
  else console.warn('注意: public/og.png がまだありません（SNSシェア時の画像が出ません）');

  // この dist がどのURL向けに焼かれたかを、成果物自身に残す。
  // canonical は絶対URLなので、別のホスティングに置くと実在しないURLを指したまま公開される。
  // 受け取った人が dist だけ見て判断できるように、ここに書き出す。
  fs.writeFileSync(path.join(DIST, 'BUILD-INFO.txt'),
    site
      ? `SITE_URL=${site}\n`
      + `built_at=${new Date().toISOString()}\n\n`
      + `この dist は上記URLに固定されています（canonical / og:url / JSON-LD / robots.txt / sitemap.xml）。\n`
      + `別のURLで公開する場合は、そのURLで再ビルドしてください:\n`
      + `  SITE_URL=https://<公開URL> node tools/build-static.js\n`
      + `再ビルドせずに置くと canonical が実在しないURLを指し、検索インデックスが空振りします。\n`
      : `SITE_URL=(未設定)\n`
      + `built_at=${new Date().toISOString()}\n\n`
      + `SEOタグ（canonical / OGP / JSON-LD / robots.txt / sitemap.xml）は出力していません。\n`
      + `公開URLが決まったら SITE_URL を付けて再ビルドしてください。\n`);
  if (site) {
    console.log(`このビルドは ${site} に固定されています（dist/BUILD-INFO.txt 参照）。`);
    console.log('別のURLで公開する場合は、そのURLで再ビルドしてください。');
  }

  const kb = n => (n / 1024).toFixed(0) + 'KB';
  console.log(`dist/index.html   ${kb(fs.statSync(path.join(DIST, 'index.html')).size)}`);
  console.log(`dist/privacy.html ${kb(fs.statSync(path.join(DIST, 'privacy.html')).size)}`);
  console.log('静的ホスティングにこの2ファイルを置けば動きます（サーバー不要）。');
}

build();
