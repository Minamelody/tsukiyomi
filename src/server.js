// ツキヨミ 鑑定サーバー。
// 5種類の占い（姓名判断・星座・タロット・四柱推命・西洋占星術）。
// 無料は浅い診断まで。深掘りは単品¥3,000 / 全5種セット¥10,000。

const http = require('http');
const fs = require('fs');
const path = require('path');
const { read, readAll, readWithLLM, TYPES, PRICE_SINGLE, PRICE_BUNDLE } = require('./readings');

const PORT = process.env.PORT || 7452;
const PUBLIC = path.join(__dirname, '..', 'public');
const OUT = path.join(__dirname, '..', 'out');
const LEADS = path.join(OUT, 'leads.jsonl');

// ココナラの出品URL（実運用で差し替える）
// 販売はココナラで行う。ココナラは購入者を外部サイトへ誘導できない規約のため、
// 鑑定の納品はココナラのトークルーム内で行う（src/deliver.js で納品文を生成する）。
// このサイトは「無料診断で信頼を得てココナラへ送る」集客装置として機能する。
const SHOP_URLS = {
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

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };

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

// ── 入力検証 ──
// 生年月日は全占術の土台。実在しない日付が通ると鑑定内容がまるごと無意味になる。
const MAX_NAME = 32;
const MAX_QUESTION = 400;   // 悩み欄。上限が無いとLLMのトークン課金を他人に焼かれる
function validBirthday(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '')) return false;
  const [y, m, d] = v.split('-').map(Number);
  if (y < 1900 || y > new Date().getFullYear()) return false;
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  // 2月30日・4月31日のような存在しない日付を弾く（Dateが繰り上げるのを検出）
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function sanitizeInput(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  // 切り出しはコードポイント単位で行う。String#slice はUTF-16単位なので、
  // 「𠮷」のようなサロゲートペアが境界に来ると文字が割れて壊れた字が残る。
  const str = (v, n) => (typeof v === 'string' ? [...v.trim()].slice(0, n).join('') : '');
  return {
    sei: str(o.sei, MAX_NAME),
    mei: str(o.mei, MAX_NAME),
    name: str(o.name, MAX_NAME * 2),
    birthday: str(o.birthday, 10),
    gender: str(o.gender, 16),
    question: str(o.question, MAX_QUESTION),
    date: str(o.date, 10) || undefined,
  };
}

// ── 濫用対策 ──
// 目的は2つあり、分けて考える必要がある。
//   (a) LLM請求の防御 — 無認証でLLMを呼べるので、ループを回されると請求が焼ける
//   (b) 正当なユーザーを弾かない — Threadsからの流入はほぼモバイルで、
//       キャリアNATや社内NATでは大量のユーザーが同一IPになる。
//       IP単位で厳しく絞ると、集客が当たった瞬間に本物の客を拒否する。
//
// なので「同一入力の連打」を主な壁にする（同じ人が同じ条件で何度も引くのは
// 結果が決定論的なので意味がなく、ループ攻撃はほぼこの形になる）。
// IP単位の上限は事故防止の外枠として高めに置く。
const crypto = require('crypto');
const BUCKETS = new Map();
const RECENT = new Map();

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  return (Array.isArray(xf) ? xf[0] : (xf || '')).split(',')[0].trim()
    || req.socket.remoteAddress || 'unknown';
}
function sweep(map, now) {
  if (map.size > 50000) for (const [k, v] of map) if (now > v.reset) map.delete(k);
}
/** IP単位の外枠。NATを考慮して高めに置く（1時間に200回） */
function rateLimit(req, name, limit, windowMs) {
  const key = `${name}:${clientIp(req)}`;
  const now = Date.now();
  const b = BUCKETS.get(key);
  if (!b || now > b.reset) {
    BUCKETS.set(key, { n: 1, reset: now + windowMs });
    sweep(BUCKETS, now);
    return true;
  }
  if (b.n >= limit) return false;
  b.n++;
  return true;
}
/** 同一入力の連打を弾く。鑑定は決定論的なので、同じ入力の再実行は結果が変わらない。
 *  IPを混ぜないので、NAT配下の別ユーザーが別条件で引く分は影響を受けない。 */
function duplicateRequest(payload, windowMs = 60 * 1000) {
  const key = crypto.createHash('sha256')
    .update(JSON.stringify([payload.sei, payload.mei, payload.birthday, payload.question]))
    .digest('hex').slice(0, 24);
  const now = Date.now();
  const r = RECENT.get(key);
  if (r && now < r.reset) { r.n++; return r.n > 3; }
  RECENT.set(key, { n: 1, reset: now + windowMs });
  sweep(RECENT, now);
  return false;
}

// ── リード記録 ──
// Renderのファイルシステムは非永続で、デプロイ・再起動・スリープ復帰のたびに消える。
// なので外部（Googleスプレッドシート）へ送るのを正とし、ローカルファイルは
// 送信失敗時の取りこぼし用バッファとしてのみ使う。
//
// 保存するのは集計分析に必要な項目だけにする。
//   悩みの「本文」は保存しない — 健康・恋愛・金銭の要配慮情報が平文で溜まると、
//   privacy.html が約束した本人請求での削除に手作業でしか応えられなくなる。
//   分析に必要なのはジャンルと長さなので、判定結果と文字数だけを残す。
const LEADS_WEBHOOK = process.env.LEADS_WEBHOOK_URL || '';

/** 悩み本文からジャンルだけを判定する（本文は保存しない） */
function questionTopic(q) {
  if (!q) return null;
  const table = [
    ['恋愛', /恋|好き|彼|彼女|片思|復縁|結婚|離婚|出会|不倫|パートナー|夫|妻/],
    ['仕事', /仕事|転職|職場|会社|上司|同僚|就職|退職|独立|起業|昇進|評価|副業/],
    ['金運', /金|収入|給料|貯金|借金|投資|返済|生活費|支出/],
    ['健康', /健康|体調|病|疲れ|不安|眠れ|ストレス|心療|うつ/],
    ['人間関係', /友人|友達|family|家族|親|子供|嫁|姑|近所|人間関係/],
    ['進路', /進路|受験|学校|勉強|資格|留学|大学/],
  ];
  for (const [label, re] of table) if (re.test(q)) return label;
  return 'その他';
}

async function recordLead(input) {
  const row = {
    at: new Date().toISOString(),
    birthday: input.birthday,          // 占術の分布分析に使う
    hasName: Boolean(input.sei && input.mei),
    gender: input.gender || null,
    topic: questionTopic(input.question),
    questionLength: (input.question || '').length,
  };
  if (LEADS_WEBHOOK) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const r = await fetch(LEADS_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(row),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (r.ok) return;
      console.warn(`[leads] webhook ${r.status}`);
    } catch (e) {
      console.warn(`[leads] webhook 失敗: ${e.message}`);
    }
  }
  // webhookが未設定/失敗した時のみローカルへ退避する（非永続なのであくまで保険）
  try {
    fs.mkdirSync(OUT, { recursive: true });
    fs.appendFileSync(LEADS, JSON.stringify(row) + '\n');
  } catch {}
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/healthz') {
    return send(res, 200, JSON.stringify({ ok: true }));
  }

  // 占いの種類一覧と価格
  if (req.method === 'GET' && url.pathname === '/api/types') {
    return send(res, 200, JSON.stringify({
      types: TYPES, priceSingle: PRICE_SINGLE, priceBundle: PRICE_BUNDLE,
      shopUrls: SHOP_URLS,
    }));
  }

  // 無料診断（全種類の浅い結果を返す）
  if (req.method === 'POST' && url.pathname === '/api/diagnose') {
    // 外枠: IP単位 200回/時（NAT配下の正当なユーザーを弾かない水準）
    if (!rateLimit(req, 'diagnose', 200, 60 * 60 * 1000)) {
      return send(res, 429, JSON.stringify({ error: 'アクセスが集中しています。しばらくしてからお試しください' }));
    }
    try {
      const input = sanitizeInput(await readBody(req));
      if (!validBirthday(input.birthday)) {
        return send(res, 400, JSON.stringify({ error: '生年月日を正しく入力してください' }));
      }
      // 主な壁: 同一入力の連打（同じ条件なら結果は同じなので繰り返す意味がない）
      if (duplicateRequest(input)) {
        return send(res, 429, JSON.stringify({ error: '同じ内容の鑑定はすでに出ています。内容を変えてお試しください' }));
      }
      const all = readAll(input);
      // 無料パートのみ返す（有料パートはサーバーに残す）
      const free = all.map(r => ({
        type: r.type, name: r.name, icon: r.icon, desc: r.desc,
        available: r.available, reason: r.reason,
        free: r.free || null,
      }));
      // 記録は鑑定の返却をブロックしない（webhookが遅くてもユーザーを待たせない）
      recordLead(input).catch(() => {});
      return send(res, 200, JSON.stringify({ types: free, priceSingle: PRICE_SINGLE, priceBundle: PRICE_BUNDLE, shopUrls: SHOP_URLS }));
    } catch (e) {
      return send(res, 400, JSON.stringify({ error: e.message }));
    }
  }

  // 有料鑑定の配信エンドポイントは存在しない。
  // 販売と納品はココナラで完結する（トークルームで鑑定書PDFを直接渡す）。
  // 旧BASE前提の解放コード方式（/api/unlock, /api/demo-unlock）は削除した。
  // 理由は2つ。①ココナラは購入者を外部サイトへ誘導することを禁じている、
  // ②購入者の識別も配信もココナラ側で完結するため、こちらに鍵をかける場所がない。

  // 静的ファイル
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(PUBLIC, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'forbidden', 'text/plain');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'not found', 'text/plain');
    send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream');
  });
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`ツキヨミ listening on ${PORT}`));
}

module.exports = { server };
