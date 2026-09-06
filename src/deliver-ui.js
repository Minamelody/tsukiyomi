#!/usr/bin/env node
// 納品オペレーション用のローカルUI（社内専用。公開サーバーには載せない）。
//
// ココナラのトークルームで受け取った情報を貼り付けて「生成」を押すと、
// 5種の深掘り鑑定を生成して「納品テキスト」と「鑑定書PDF」を出す。
// 24時間以内納品を数分作業に落とすための道具。
//
// 使い方:
//   node src/deliver-ui.js            # http://localhost:7470 を開く
//
// PDF生成は tools/pdfgen.py（weasyprint）に委譲する。
// PDFのデザイン（HTML/CSS）は Designer 側が pdfgen.py で管理するので、
// このファイルは「鑑定データを渡してPDFを受け取る」ところまでしか持たない。

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { readWithLLM, TYPES } = require('./readings');

const PORT = process.env.DELIVER_UI_PORT || 7470;
const OUT = path.join(__dirname, '..', 'out', 'deliveries');
const PDFGEN = path.join(__dirname, '..', 'tools', 'pdfgen.py');
const CHARTJS = path.join(__dirname, 'charts.js');

// 社内ツールなので、ループバック以外からの接続は受けない。
// 誤って公開ホストで起動しても顧客データと納品物が外から触れないようにする。
function isLocal(req) {
  const a = req.socket.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 2e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function validBirthday(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '')) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const HEADER = name => `${name} 様

ご購入いただきありがとうございます。
お伺いした情報をもとに鑑定させていただきました。
以下、鑑定結果をお届けします。`;

const FOOTER = `
────────────────────
最後までお読みいただきありがとうございました。
気になる点やもう少し詳しく聞きたいところがあれば、
このトークルームでお気軽にお尋ねください。

※本鑑定は娯楽を目的としたものです。
　医療・法律・投資に関する判断の根拠とはなりません。
　最終的な選択はご自身の意思で行ってください。`;

/** 鑑定を生成する。テキストとPDF用の構造データの両方を返す。 */
async function generate({ sei, mei, birthday, gender, question, types }) {
  const input = {
    sei, mei, name: `${sei || ''}${mei || ''}` || 'あなた',
    birthday, gender, question,
    date: new Date().toISOString().slice(0, 10),
  };
  const wanted = (!types || types === 'all') ? TYPES.map(t => t.id)
    : String(types).split(',').map(s => s.trim()).filter(Boolean);

  const display = `${sei || ''}${mei || ''}`.trim() || 'ご相談者';
  const parts = [HEADER(display), ''];
  const readings = [];
  const skipped = [];

  for (const id of wanted) {
    const r = await readWithLLM(id, input);
    if (!r.available) { skipped.push(`${r.name}: ${r.reason}`); continue; }
    readings.push({
      type: id, name: r.name,
      summary: r.free?.summary || '',
      facts: r.facts || null,           // PDFの図版生成に使う（命式・五格・カード等）
      sections: r.paid.sections,
      note: r.paid.note || '',          // 計算の事実の注記（霊数の個別注記など）。LLMの成否に関わらず必ず出す
    });
    parts.push('────────────────────', `【${r.name}】`, '');
    if (r.free?.summary) parts.push(r.free.summary, '');
    for (const s of r.paid.sections) parts.push(`■ ${s.h}`, s.body, '');
    if (r.paid.note) parts.push('', r.paid.note);
  }
  parts.push(FOOTER);

  const text = parts.join('\n');
  const chars = readings.reduce((a, r) => a + r.sections.reduce((b, s) => b + s.body.length, 0), 0);
  return { text, chars, readings, skipped, display, input };
}

/**
 * tools/pdfgen.py に納品データを渡してPDFを作らせる。
 * v13のpdfgenは「納品テキスト(input) + charts.json(--charts)」の2ファイル入力方式なので、
 * こちらの生成済みテキストと、charts.js の再計算JSONを一時ファイルとして渡す。
 * タロット図版はpdfgen側が納品テキストの記載を正解として照合するため、
 * charts.jsのカードが仮にズレていても図版は本文と一致する。
 */
function makePdf(payload, outPath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(PDFGEN)) return reject(new Error(`PDF生成スクリプトが見つかりません: tools/pdfgen.py`));
    const txtPath = outPath + '.txt';
    const chartsPath = outPath + '.charts.json';
    // 同期削除にする。非同期だと resolve() が先に返り、呼び出し側から見た時に
    // 「PDFはできたが顧客データの一時ファイルがまだ残っている」瞬間ができる。
    // 顧客データなので、戻った時点で消えていることを保証する。
    const cleanup = () => {
      for (const p of [txtPath, chartsPath]) {
        try { fs.unlinkSync(p); } catch (e) { /* 既に無い場合は無視 */ }
      }
    };

    fs.writeFileSync(txtPath, payload.text || '');
    const in_ = payload.input || {};
    const today = new Date().toISOString().slice(0, 10);
    const args = [CHARTJS,
      '--sei', String(in_.sei || ''),
      '--mei', String(in_.mei || ''),
      '--birthday', String(in_.birthday || ''),
      '--date', String(in_.date || today)];
    if (in_.question) args.push('--question', String(in_.question));

    execFile('node', args, { maxBuffer: 32 * 1024 * 1024 }, (cerr, cstdout, cstderr) => {
      if (cerr) { cleanup(); return reject(new Error(`図版データ生成に失敗: ${(cstderr || cerr.message).slice(0, 300)}`)); }
      fs.writeFileSync(chartsPath, cstdout);
      execFile('python3', [PDFGEN, txtPath, outPath, '--name', payload.display || '鑑定ご依頼者さま', '--charts', chartsPath],
        { maxBuffer: 32 * 1024 * 1024 },
        (err, stdout, stderr) => {
          cleanup();
          if (err) return reject(new Error(`PDF生成に失敗: ${(stderr || err.message).slice(0, 400)}`));
          resolve(outPath);
        });
    });
  });
}

const PAGE = `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>ツキヨミ 納品ツール</title>
<style>
body{margin:0;background:#12111c;color:#eeecf7;font:14px/1.7 -apple-system,"Hiragino Sans","Segoe UI",Roboto,sans-serif}
.w{max-width:820px;margin:0 auto;padding:24px 18px 60px}
h1{font-size:18px;letter-spacing:.08em;margin:0 0 4px}
.sub{color:#8d87ad;font-size:12.5px;margin:0 0 20px}
.card{background:#1c1a2b;border:1px solid #2e2b45;border-radius:12px;padding:18px;margin-bottom:14px}
label{display:block;font-size:12px;color:#8d87ad;margin-bottom:4px}
input,textarea,select{width:100%;box-sizing:border-box;background:#12111c;border:1px solid #2e2b45;color:#eeecf7;border-radius:8px;padding:10px;font:inherit}
textarea{min-height:84px;resize:vertical}
.g{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.f{margin-bottom:12px}
button{background:linear-gradient(135deg,#7c5cf0,#a78bfa);color:#fff;border:0;border-radius:9px;padding:12px 20px;font:inherit;font-weight:700;cursor:pointer}
button.ghost{background:transparent;border:1px solid #2e2b45;color:#8d87ad;font-weight:500}
button:disabled{opacity:.5;cursor:not-allowed}
pre{white-space:pre-wrap;background:#12111c;border:1px solid #2e2b45;border-radius:9px;padding:14px;max-height:460px;overflow:auto;font:12.5px/1.85 ui-monospace,monospace}
.meta{color:#8d87ad;font-size:12.5px;margin:10px 0}
.ok{color:#8ee6a8}.ng{color:#ff9d9d}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
a.dl{color:#f5c869}
</style></head><body><div class="w">
<h1>ツキヨミ 納品ツール</h1>
<p class="sub">ココナラのトークルームで受け取った情報を入れて生成 → テキストをコピーして貼る／PDFを添付する。社内専用。</p>
<div class="card">
  <div class="g">
    <div class="f"><label>姓</label><input id="sei" placeholder="佐藤"></div>
    <div class="f"><label>名</label><input id="mei" placeholder="美咲"></div>
  </div>
  <div class="g">
    <div class="f"><label>生年月日</label><input id="bd" type="date"></div>
    <div class="f"><label>プラン</label><select id="types">
      <option value="all">5種セット（¥10,000）</option>
      <option value="seimei">姓名判断（¥3,000）</option>
      <option value="seiza">星座占い（¥3,000）</option>
      <option value="tarot">タロット（¥3,000）</option>
      <option value="shichu">四柱推命（¥3,000）</option>
      <option value="astro">西洋占星術（¥3,000）</option>
    </select></div>
  </div>
  <div class="f"><label>ご相談内容（トークルームの文面をそのまま貼ってOK）</label><textarea id="q"></textarea></div>
  <div class="row">
    <button id="go">鑑定を生成する</button>
    <button class="ghost" id="copy" disabled>テキストをコピー</button>
    <span id="dl"></span>
  </div>
  <p class="meta" id="meta"></p>
</div>
<pre id="out">まだ生成していません。</pre>
</div><script>
const $=id=>document.getElementById(id);
let TEXT='';
$('go').onclick=async()=>{
  const body={sei:$('sei').value,mei:$('mei').value,birthday:$('bd').value,
              question:$('q').value,types:$('types').value};
  if(!body.birthday){$('meta').innerHTML='<span class="ng">生年月日を入れてください</span>';return;}
  $('go').disabled=true;$('go').textContent='生成中…（20〜40秒）';$('dl').textContent='';
  const t0=Date.now();
  try{
    const r=await fetch('/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const j=await r.json();
    if(!r.ok)throw new Error(j.error||'失敗');
    TEXT=j.text;$('out').textContent=j.text;$('copy').disabled=false;
    const sec=((Date.now()-t0)/1000).toFixed(0);
    let m='<span class="ok">生成しました</span> — 鑑定本文 '+j.chars.toLocaleString()+'字 / '+sec+'秒';
    if(j.chars<2000)m+=' <span class="ng">（2,000字を下回っています）</span>';
    if(j.skipped&&j.skipped.length)m+='<br>スキップ: '+j.skipped.join(' / ');
    if(j.pdf)$('dl').innerHTML='<a class="dl" href="'+j.pdf+'" download>鑑定書PDFをダウンロード</a>';
    else if(j.pdfError)m+='<br><span class="ng">PDF: '+j.pdfError+'</span>（テキスト納品は可能です）';
    $('meta').innerHTML=m;
  }catch(e){$('meta').innerHTML='<span class="ng">'+e.message+'</span>';}
  finally{$('go').disabled=false;$('go').textContent='鑑定を生成する';}
};
$('copy').onclick=async()=>{await navigator.clipboard.writeText(TEXT);$('copy').textContent='コピーしました';setTimeout(()=>$('copy').textContent='テキストをコピー',1500);};
</script></body></html>`;

const server = http.createServer(async (req, res) => {
  if (!isLocal(req)) return send(res, 403, JSON.stringify({ error: 'local only' }));
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    return send(res, 200, PAGE, 'text/html; charset=utf-8');
  }

  if (req.method === 'GET' && url.pathname.startsWith('/pdf/')) {
    const f = path.join(OUT, path.basename(url.pathname));
    return fs.readFile(f, (e, d) => {
      if (e) return send(res, 404, 'not found', 'text/plain');
      send(res, 200, d, 'application/pdf');
      // 渡したら消す（顧客データを手元に溜めない）
      if (process.env.KEEP_DELIVERIES !== 'on') fs.unlink(f, () => {});
    });
  }

  if (req.method === 'POST' && url.pathname === '/generate') {
    try {
      const b = await readBody(req);
      if (!validBirthday(b.birthday)) {
        return send(res, 400, JSON.stringify({ error: '生年月日を正しく入力してください' }));
      }
      const g = await generate(b);

      // 顧客の要配慮情報（氏名・生年月日・悩み）はこちら側に残さない。
      // 原本はココナラのトークルームにあるので、こちらで保管する必要がない。
      // PDFは納品に必要なので一時ファイルとして作り、ダウンロード後に破棄する。
      // KEEP_DELIVERIES=on を明示した時だけ、鑑定テキストも保存する（検証用）。
      fs.mkdirSync(OUT, { recursive: true });
      const stamp = Date.now().toString(36);
      // ファイル名に氏名・生年月日を入れない（ディレクトリ一覧が顧客リストになるのを避ける）
      const base = `delivery_${stamp}`;
      if (process.env.KEEP_DELIVERIES === 'on') {
        fs.writeFileSync(path.join(OUT, base + '.txt'), g.text);
      }

      let pdf = null, pdfError = null;
      try {
        const file = base + '.pdf';
        await makePdf({
          display: g.display, input: g.input, readings: g.readings, text: g.text,
          plan: (!b.types || b.types === 'all') ? 'bundle' : b.types,
        }, path.join(OUT, file));
        pdf = '/pdf/' + file;
      } catch (e) { pdfError = e.message; }

      return send(res, 200, JSON.stringify({
        text: g.text, chars: g.chars, skipped: g.skipped, pdf, pdfError,
      }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: e.message }));
    }
  }
  send(res, 404, JSON.stringify({ error: 'not found' }));
});

if (require.main === module) {
  server.listen(PORT, '127.0.0.1', () =>
    console.log(`納品ツール: http://localhost:${PORT}  （ローカル専用）\n`
      + (process.env.KEEP_DELIVERIES === 'on'
        ? '※ KEEP_DELIVERIES=on: 鑑定テキストを out/deliveries/ に保存します（検証用）'
        : '※ 顧客データは保存しません（PDFはダウンロード後に破棄）')));
}
module.exports = { server, generate, makePdf };
