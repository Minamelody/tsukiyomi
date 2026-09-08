// src/replies.js — Threads 返信パイプライン（自動返信）
//
// 未返信のリプライを取得 → 分類(D/C/A/B2/B) → 安全装置 → 辞書から返信文生成 → reply_to_id で送信 → ログ。
// 安全装置（spec §5）: Dは自動送信しない／誘導率カウンタ(直近20中7)／同一ユーザー誘導1回／120字上限／禁止語／誘導辞書ローテーション。
// 未返信判定は conversation 方式: 自分の返信(replied_to)を突き合わせ、まだ返していないリプライだけを対象にする。
//
// 使い方（CLI）: node tools/run-replies.js --media-id <id> [--post-type fomo] [--dry-run]

const fs = require('fs');
const path = require('path');
const { ThreadsClient } = require('./threads-api');

const OUT = path.join(__dirname, '..', 'out');
const LOG_PATH = path.join(OUT, 'reply-log.jsonl');
const STATE_PATH = path.join(OUT, 'reply-state.json');

// 誘導文は辞書からローテーション（LLMに生成させない＝表現の暴走防止）。spec §3 確定版。
const GUIDE_VARIANTS = [
  'もう少し詳しく見たいときは、プロフィールのリンクから無料で試せます。気が向いたときにでも。',
  'プロフィールのリンクから無料の鑑定が使えます。生年月日だけで出るので、よかったら。',
  'プロフィールのリンクに無料の鑑定を置いてあります。急がないので、必要なときに。',
  'よかったらプロフィールのリンクから無料で試してみてください。登録も何もいりません。',
];

// 禁止語（返信に含めてはいけない表現。効果保証・霊視・医療断定・URL・個別連絡）
const FORBIDDEN = ['絶対', '必ず', '保証', '霊視', '当たります', '治り', '儲か', 'URL', 'http', 'LINE', 'DM'];

const MAX_LEN = 120;
const GUIDE_WINDOW = 20; // 誘導率カウンタの窓
const GUIDE_MAX = 7;     // 直近20件中の誘導上限（3割）

// B2（絵文字のみ）の受け取りの一言。🌙の約束（「視えたままを返す」）をそのまま回収する。
const B2_RECEIVE = '🌙、受け取りました。視えたままを、お返しします。';
const B2_RECEIVE_NO_GUIDE = '🌙、受け取りました。';

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
  // A: 自己申告（星座名・余り・当たってた）
  if (/座|牡羊|牡牛|双子|蟹|獅子|乙女|天秤|蠍|射手|山羊|水瓶|魚|余り|当たって/.test(t)) return 'A';
  return 'B';
}

/** 返信文を生成する。送れない場合は null（D・テンプレ未定義・禁止語・文字数超過は呼び出し側で保留） */
function buildReplyText(cls, guideIdx, canGuide) {
  if (cls === 'D') return null;
  if (cls === 'B2') {
    if (!canGuide) return B2_RECEIVE_NO_GUIDE;
    const guide = GUIDE_VARIANTS[guideIdx % GUIDE_VARIANTS.length];
    return `${B2_RECEIVE}\n${guide}`;
  }
  // A/B/C は今後の枠（今回は B2 のみ実運用）。テンプレ未定義として保留。
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
    const guideCount = state.recent.filter(x => x.guide).length;
    const canGuide = guideCount < GUIDE_MAX && !state.userGuided[r.username];
    const text = buildReplyText(cls, cursor, canGuide);

    let holdReason = '';
    if (cls === 'D') holdReason = '分類D（自動送信しない）';
    else if (!text) holdReason = 'テンプレ未定義（A/B/Cは今後）';
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
      template: text ? (canGuide ? 'b2-receive-guide' : 'b2-receive') : '',
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
      state.recent.push({ username: r.username, guide: canGuide, at: Date.now() });
      if (state.recent.length > GUIDE_WINDOW) state.recent = state.recent.slice(-GUIDE_WINDOW);
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

module.exports = { run, classify, buildReplyText, GUIDE_VARIANTS, FORBIDDEN };
