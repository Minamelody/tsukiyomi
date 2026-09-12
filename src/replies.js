// src/replies.js — Threads 返信パイプライン（自動返信）
//
// 未返信のリプライを取得 → 分類(D/C/A/B2/B) → 安全装置 → 辞書から返信文生成 → reply_to_id で送信 → ログ。
// 安全装置（spec §5・2026-09-08 改訂）: Dは自動送信しない／同一ユーザー誘導1回／120字上限／禁止語。
//   誘導は基本全員に入れる（R社長 2026-09-08「誘導は基本全員」＝誘導率カウンタ撤廃）。
//   文面は「受取行×誘導行」を組合わせてローテーションし、同じ投稿内で同じ文面を並べない（R社長「それぞれに違う文面」）。
// 未返信判定は conversation 方式: 自分の返信(replied_to)を突き合わせ、まだ返していないリプライだけを対象にする。
//
// 使い方（CLI）:
//   node tools/run-replies.js --media-id <id> [--post-type fomo] [--dry-run]
//   node tools/run-replies.js --recent-hours <N> [--post-type ...] [--dry-run]

const fs = require('fs');
const path = require('path');
const { ThreadsClient } = require('./threads-api');

const OUT = path.join(__dirname, '..', 'out');
const LOG_PATH = path.join(OUT, 'reply-log.jsonl');
const STATE_PATH = path.join(OUT, 'reply-state.json');

// 返信文の辞書。
// 受取行（spec §7 誘導なし版より・絵文字に依存しない）と誘導行（spec §3 確定版・4種）を
// カーソルで順に回し、組合わせを変えることで「同じ投稿内で同じ文面を並べない」
// （R社長 2026-09-08「それぞれに違う文面」）。受取3種×誘導4種＝12通りのユニーク文面。
// 誘導は基本全員に入れる（R社長 2026-09-08「誘導は基本全員」）。同一ユーザー1回のみ維持。
// 受け取りの「リード文」（2026-09-12 3段構成改訂・reply-guide.md 型FOMO誘導プール③〜⑮）。
// ①丁寧なお礼 ＋ ②受取の合図＋軽い鑑定（緩衝表現・断定なし）。③のLINE誘導（GUIDE_VARIANTS）は末尾に付ける。
// 12リードを1件ずつローテーションして同じ文面を並べない（「それぞれに違う文面」）。絵文字のみ（主に🌙）の返信（B2）に使う。
const RECEIVE_VARIANTS = [
  '🌙、お言葉、ありがとうございます。確かに受け取りました。今夜のあなたには、明確な答えを求めたくなる日が近づいています。',
  '🌙、丁寧にお預かりしました。ありがとうございます。今夜のあなたには、何かが静かに動き始める気配が来ています。',
  '🌙、しっかりと受け取りました。ありがとうございます。今夜のあなたには、ひとつ、はっきりした流れが来ています。',
  '🌙、お礼を込めて受け取りました。ありがとうございます。今夜のあなたには、迷いがほどける時間が近づいています。',
  '🌙、ありがとうございます。「この先どう動くか」への想い、しっかりと受け取りました。今夜のあなたには、道が見え始めています。',
  '🌙、確かに、ありがとうございます。今夜のあなたには、静かに回り始めた流れがあります。',
  '🌙、お心遣い、ありがとうございます。今夜のあなたには、もう迷わなくていい時間が来ています。',
  '🌙、確かに受け取りました。ありがとうございます。今夜のあなたには、次の一歩が見え始めています。',
  '🌙、受け取りました。ありがとうございます。今夜のあなたには、静かに変わる時が来ています。',
  '🌙、しっかりと受け取りました。ありがとうございます。「そろそろ動く」という予感、わかります。',
  '🌙、お言葉、ありがとうございます。今夜のあなたには、答えが出る時間が近づいています。',
  '🌙、ありがとうございます。今夜のあなたには、大きな流れの入口が見えています。',
];

// 誘導文は辞書からローテーション（LLMに生成させない＝表現の暴走防止）。
// 2026-09-08 R社長指示（3832619）で導線をLINE公式アカウントに切替。誘導テール3型（Designer 最終文案 3833077）をサイクル。
const LINE_URL = 'https://lin.ee/oSQE3an';
const GUIDE_VARIANTS = [
  `もしよろしければ、無料鑑定はこちらのLINEからどうぞ。${LINE_URL}`,
  `お時間のあるときに、よろしければこちらからどうぞ。${LINE_URL}`,
  `もしお読みになりたければ、無料の5種鑑定はこちら。${LINE_URL}`,
];

// B分類（雑談・お礼リプ）の返信文（2026-09-12 Designer追補・reply-guide.md「B分類」節）。
// 対象: 「🌙ありがとうございます」等の短いお礼・雑談（🌙なしのお礼にも流用可）。
// 受け取り＋軽い鑑定1行＋LINE誘導の3点セット。プール6本を1件ずつローテーション（プール内ユニーク維持）。
// 誘導=基本全員・同一ユーザー1回。お礼への返しは断定を避け「〜ています／〜のようです」の緩衝表現に統一。
const B_VARIANTS = [
  '🌙、ありがとうございます。その一言が、今夜は何よりうれしいです。あなたの運気は、静かに動き始めています。',
  '🌙、置いてくださって、ありがとうございます。今夜のあなたには、迷いがほどけていく時間が来ています。',
  '🌙、ありがとうございます。そのお言葉に、あなたの今の良い流れが表れています。',
  '🌙、お言葉、ありがとうございます。こんな夜に名前を残してくださるなんて、うれしいです。あなたの運気は、静かに整っていくようです。',
  '🌙、こちらこそ、ありがとうございます。今夜のあなたには、ひとつ、はっきりした流れが来ています。',
  '🌙、ありがとうございます。その一言が、今夜のあなたの運気を教えてくれました。',
];

// 禁止語（返信に含めてはいけない表現。効果保証・霊視・医療断定・個別連絡DM）
// R社長のLINE導線切替に伴い、URL/http/LINE の禁止は撤去（公式LINEリンクを返信に載せるため）。DM直連は引き続き禁止。
const FORBIDDEN = ['絶対', '必ず', '保証', '霊視', '当たります', '治り', '儲か', 'DM'];

const MAX_LEN = 120;

// 軽鑑定（文章リプ A=自己申告/生年月日・C=相談 への返信）。Designer 3831339 確定版・Tech Lead QA合格。
// 定型: 〔{星座}さん、〕そのお悩み、読みました。{見立て}〔詳しくはプロフィールのリンクに、生年月日だけで出る無料の鑑定があります。〕
// 見立ては辞書3種ローテーション（データ駆動・差し替え可）。効果保証語（必ず/絶対/保証）不使用・2行以内・120字内。
// 医療/投資/法律=分類D=自動送信しない（人対応のまま）。誘導は基本全員・同一ユーザー1回のみ維持。
const LIGHT_READING_VARIANTS = [
  '近づいている変化は、あなたが思うより早く来ます。',
  '焦っているほど、見えていないものが1つあります。',
  '迷いは、2日以内に理由がはっきりします。',
];

const ZODIAC_NAMES = ['牡羊座', '牡牛座', '双子座', '蟹座', '獅子座', '乙女座', '天秤座', '蠍座', '射手座', '山羊座', '水瓶座', '魚座'];

/** 返信テキストから星座名を取り出す（呼称に使う）。無ければ null */
function extractZodiac(text) {
  return ZODIAC_NAMES.find(z => (text || '').includes(z)) || null;
}

/** 軽鑑定の返信文（A/C）。星座名があれば呼称に、無ければ受け止めのみ。誘導は canGuide に従う */
function buildLightReading(replyText, idx, canGuide) {
  const z = extractZodiac(replyText);
  const prefix = z ? `${z}さん、` : '';
  const reading = LIGHT_READING_VARIANTS[idx % LIGHT_READING_VARIANTS.length];
  const core = `${prefix}お悩みを読ませていただきました。${reading}`;
  if (!canGuide) return core; // 同一ユーザー2回目以降は誘導なし（受け止め＋見立てのみ）
  return `${core}もしよろしければ、詳しくは無料鑑定をこちらのLINEからどうぞ。${LINE_URL}`;
}

/** 返信テキストの分類。返信テキストのみで判定する（spec §1） */
function classify(text) {
  const t = (text || '').trim();
  if (!t) return 'B2';
  // D: 医療・投資・法律・個別依頼・連絡要求 → 自動送信しない（人に回す）
  if (/病|癌|手術|投資|株|FX|法律|弁護士|裁判|個別|鑑定して|占って|連絡/.test(t)) return 'D';
  // B2: 文字種（漢字/かな/英数字）を含まない＝絵文字・記号のみ
  const hasWord = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Latin}\d]/u.test(t);
  if (!hasWord) return 'B2';
  // C: 相談（悩み・迷い）
  if (/迷|悩|つらい|しんどい|うまくいか|別れ|復縁|好き|恋|転職|疲れ/.test(t)) return 'C';
  // A: 自己申告（星座名・余り・当たってた・生年月日）
  if (/座|牡羊|牡牛|双子|蟹|獅子|乙女|天秤|蠍|射手|山羊|水瓶|魚|余り|当たって/.test(t)) return 'A';
  // 生年月日（自己申告・軽鑑定対象）
  if (/\d{4}\s*[年/.\-]\s*\d{1,2}\s*[月/.\-]\s*\d{1,2}/.test(t)) return 'A';
  return 'B';
}

/** 返信文を生成する。送れない場合は null（D・テンプレ未定義・禁止語・文字数超過は呼び出し側で保留） */
function buildReplyText(cls, idx, canGuide, replyText = '') {
  if (cls === 'D') return null;
  if (cls === 'B2') {
    const lead = RECEIVE_VARIANTS[idx % RECEIVE_VARIANTS.length];
    if (!canGuide) return lead; // 同一ユーザー2回目以降は誘導なし（受け止めのみ）
    // リード文（12種）と誘導テール（3型）を別レートで進める → 12通りのユニークな組合わせ（「それぞれに違う文面」）
    return `${lead}\n${GUIDE_VARIANTS[idx % GUIDE_VARIANTS.length]}`;
  }
  if (cls === 'A' || cls === 'C') {
    return buildLightReading(replyText, idx, canGuide);
  }
  if (cls === 'B') {
    // B（雑談・お礼）＝リード6本を1件ずつローテーション。同一ユーザー2回目以降は誘導なしの受け取りのみ。
    const lead = B_VARIANTS[idx % B_VARIANTS.length];
    if (!canGuide) return lead;
    return `${lead}\n${GUIDE_VARIANTS[idx % GUIDE_VARIANTS.length]}`;
  }
  return null;
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); }
  catch { return { recent: [], userGuided: {}, guideCursor: 0 }; }
}

function saveState(s) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

function log(entry) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n');
}

/**
 * 返信パイプライン本体。
 * @param {object} opts { userId, token, mediaId, postType, dryRun }
 * @returns {Promise<Array>} 各リプライの処理結果（11フィールドログ相当）
 */
async function run({ userId, token, mediaId, postType = 'unknown', dryRun = false }) {
  const client = new ThreadsClient({ userId, accessToken: token });
  const conv = await client.conversation(mediaId);
  const data = conv.data || [];

  // 未返信判定: 自分の返信が replied_to で紐付いているリプライは除外（二重送信防止）
  const owned = new Set(data.filter(r => r.is_reply_owned_by_me).map(r => r.replied_to?.id).filter(Boolean));
  const pending = data.filter(r => !r.is_reply_owned_by_me && !owned.has(r.id));

  const state = loadState();
  let cursor = state.guideCursor;
  const results = [];

  for (const r of pending) {
    const cls = classify(r.text);
    const canGuide = !state.userGuided[r.username]; // 誘導は基本全員、同一ユーザー1回のみ維持
    const text = buildReplyText(cls, cursor, canGuide, r.text);

    let holdReason = '';
    if (cls === 'D') holdReason = '分類D（自動送信しない）';
    else if (!text) holdReason = 'テンプレ未定義';
    else if (FORBIDDEN.some(w => text.includes(w))) holdReason = '禁止語';
    else if (text.length > MAX_LEN) holdReason = '120字超過';

    const entry = {
      reply_id: null,
      source_media_id: mediaId,
      post_type: postType,
      replied_to: r.id,
      text: text || '',
      classification: cls,
      matched_rule: cls,
      template: text
        ? (cls === 'B2'
            ? (canGuide ? 'b2-receive-guide' : 'b2-receive')
            : cls === 'B'
              ? (canGuide ? 'b-thanks-guide' : 'b-thanks')
              : (canGuide ? 'light-reading-guide' : 'light-reading'))
        : '',
      status: holdReason ? 'hold' : 'dry-run',
      hold_reason: holdReason,
      guide: false,
      at: new Date().toISOString(),
    };

    if (!holdReason && !dryRun) {
      const sent = await client.publishReply(r.id, text);
      entry.reply_id = sent.postId;
      entry.status = 'sent';
      entry.guide = canGuide;
      if (canGuide) state.userGuided[r.username] = true;
      cursor += 1;
    } else if (!holdReason && dryRun) {
      entry.guide = canGuide;
      cursor += 1; // dry-run は表示用にローカルで進めるだけ（state は汚さない）
    }

    log(entry);
    results.push(entry);
  }

  if (!dryRun) state.guideCursor = cursor;
  saveState(state);
  return results;
}

module.exports = { run, classify, buildReplyText, RECEIVE_VARIANTS, GUIDE_VARIANTS, B_VARIANTS, FORBIDDEN };
