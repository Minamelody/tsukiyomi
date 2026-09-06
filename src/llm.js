// LLM生成レイヤー。
//
// 設計方針:
//   占術の計算（画数・干支・五行・カード・星座）は **必ずコード側で確定させる**。
//   LLMには「確定した事実」を渡して、鑑定文の言語化だけをさせる。
//   LLMに占わせると数値がぶれて決定論性が壊れ、再訪時に結果が変わって信用を失う。
//
//   生成結果はキャッシュする（同じ人・同じ日・同じ種目なら同じ文章を返す）。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MODEL = process.env.TSUKIYOMI_MODEL || 'gpt-5.4-mini';
const BASE_URL = process.env.OPENAI_BASE_URL;
const API_KEY = process.env.OPENAI_API_KEY;
const CACHE_DIR = path.join(__dirname, '..', 'out', 'llm-cache');
const TIMEOUT_MS = Number(process.env.TSUKIYOMI_LLM_TIMEOUT || 25000);

const SYSTEM = `あなたは経験豊富な日本の占い師です。相談者に鑑定文を書きます。

厳守事項:
- 与えられた「鑑定データ」は確定した事実です。数値・干支・カード名・星座・画数を絶対に変更・追加しないこと。
- データにない占術用語を勝手に持ち込まないこと。
- 断定的な効果保証は禁止（「必ず」「絶対に」「確実に」「100%」を使わない）。景品表示法に触れます。
- 医療・法律・投資の助言をしないこと。診断名や病名、具体的な投資判断を書かない。
- 相談者を脅して不安を煽らないこと。不吉な内容でも必ず対処法を添えて終える。
- 抽象的な励ましで終わらせず、具体的な行動を1つ以上示すこと。
- 一人の相談者に語りかける文体。敬体（です・ます）。
- 装飾記号（*、#、-）や見出しを使わず、文章のみ。改行は段落区切りにのみ使う。`;

function cacheKey(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 32);
}
function readCache(key) {
  try { return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, key + '.json'), 'utf8')); }
  catch { return null; }
}
function writeCache(key, val) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(path.join(CACHE_DIR, key + '.json'), JSON.stringify(val));
  } catch {}
}

function isConfigured() {
  return Boolean(BASE_URL && API_KEY);
}

async function chat(messages, maxTokens = 9000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({ model: MODEL, messages, max_tokens: maxTokens }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    const text = j?.choices?.[0]?.message?.content;
    if (!text) throw new Error('LLM: empty response');
    return text.trim();
  } finally { clearTimeout(timer); }
}

// 禁止表現が混入していないか検査する（LLM出力の最終ゲート）
const BANNED = ['必ず', '絶対', '確実に', '100%', '保証します', '間違いなく'];
function violatesPolicy(text) {
  return BANNED.filter(w => text.includes(w));
}

/**
 * 確定済みの鑑定データから、有料パートの本文をLLMで生成する。
 * 失敗時は null を返す（呼び出し側でルールベースにフォールバックする）。
 *
 * @param {object} opts
 * @param {string} opts.typeName 占術名（例: 四柱推命）
 * @param {object} opts.facts 計算で確定したデータ
 * @param {string[]} opts.sectionTitles 生成させるセクション見出し
 * @param {string} opts.question 相談内容（任意）
 * @param {string} opts.cacheOn キャッシュキーに含める識別子
 */
async function generateReading({ typeName, facts, sectionTitles, question, cacheOn }) {
  if (!isConfigured()) return null;

  const key = cacheKey({ MODEL, typeName, facts, sectionTitles, question, cacheOn });
  const cached = readCache(key);
  if (cached) return cached;

  const prompt = `占術: ${typeName}

【鑑定データ（確定事実・変更禁止）】
${JSON.stringify(facts, null, 2)}

${question ? `【相談者の悩み】\n${question}\n` : ''}
以下の見出しごとに鑑定文を書いてください。
各見出しは5〜8文程度。合計で2000〜2500字を目安に。
「結論」だけで終わらせず、具体例や場面の描写を含めて、読み応えのある鑑定にしてください。

見出し:
${sectionTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}

出力形式（厳守。JSONのみを返し、前後に説明を書かない）:
{"sections":[{"h":"見出し","body":"本文"}]}`;

  let text;
  try {
    text = await chat([{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }]);
  } catch (e) {
    console.warn(`[llm] 生成失敗（ルールベースにフォールバック）: ${e.message}`);
    return null;
  }

  // JSON部分を取り出す
  let parsed;
  try {
    const m = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : text);
  } catch {
    console.warn('[llm] JSON解析に失敗（フォールバック）');
    return null;
  }
  if (!Array.isArray(parsed?.sections) || !parsed.sections.length) return null;

  let sections = parsed.sections
    .filter(s => s && typeof s.h === 'string' && typeof s.body === 'string')
    .map(s => ({
      // 見出しに「1. 」等の番号や装飾記号が混ざることがあるので除去する
      h: s.h.trim().replace(/^[\s]*[0-9０-９]+[.．、)）:：]\s*/, '').replace(/^[#*\-\s]+/, '').trim(),
      body: s.body.trim().replace(/^[#*]+\s*/gm, ''),
    }))
    .filter(s => s.h && s.body);
  if (!sections.length) return null;

  // ポリシー違反チェック。違反したら採用しない（ルールベースに落とす）
  const joined = sections.map(s => s.body).join('\n');
  const bad = violatesPolicy(joined);
  if (bad.length) {
    console.warn(`[llm] 禁止表現を検出（フォールバック）: ${bad.join(', ')}`);
    return null;
  }

  // 字数検証: 目標字数に達していなければ、各セクションの補足を追加生成する（最大2回）
  const MIN_CHARS = Number(process.env.TSUKIYOMI_MIN_CHARS || 2000);
  for (let round = 1; round <= 2; round++) {
    const joined = sections.map(s => s.body).join('\n');
    if (joined.length >= MIN_CHARS) break;
    const shortage = MIN_CHARS - joined.length;
    const snapshot = sections.map(x => ({ ...x }));   // 補足を破棄する時に戻す先
    console.warn(`[llm] 字数不足 ${joined.length}字 < ${MIN_CHARS}字。${round}回目の補足生成 (不足${shortage}字)`);
    const exp = await chat([{ role: 'system', content: SYSTEM }, { role: 'user', content:
      `先ほど生成した鑑定文は合計${joined.length}字で、目標の${MIN_CHARS}字に足りていません。
` +
      `不足分は約${shortage}字です。既存の内容と矛盾しないよう、各セクションに「具体的な場面の描写」「行動の手順」「より掘り下げた読み」を追加してください。
` +
      `既存の鑑定文:
${joined}

` +
      `出力形式: JSONのみ {"additions":[{"h":"見出し","body":"追加本文(200〜400字)"}]}` }], 4000);
    try {
      const m = exp.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(m ? m[0] : exp);
      if (Array.isArray(parsed?.additions)) {
        // 追加分は見出しで元のセクションに突き合わせる。
        // 一致しない場合は「最も短いセクション」へ回す。
        // 全部 sections[0] に足すと、1章だけ極端に長い偏った鑑定書になる
        // （実測で1章が全体の75%を占めた）。
        const norm = t => String(t || '').trim().replace(/^[0-9０-９]+[.．、)）:：]\s*/, '').replace(/[\s　]/g, '');
        for (const a of parsed.additions) {
          if (!a || typeof a.body !== 'string' || !a.body.trim()) continue;
          const add = a.body.trim();
          let i = sections.findIndex(sec => norm(sec.h) === norm(a.h));
          if (i < 0) {
            i = sections.reduce((min, sec, idx) =>
              sec.body.length < sections[min].body.length ? idx : min, 0);
          }
          sections[i] = { h: sections[i].h, body: sections[i].body + '\n\n' + add };
        }
      }
      // ポリシー再検査
      const joined2 = sections.map(s => s.body).join('\n');
      const bad2 = violatesPolicy(joined2);
      if (bad2.length) {
        // 破棄すると言いながら sections をそのまま返していたので、
        // 禁止表現入りの補足が本文に残っていた。スナップショットへ巻き戻す。
        console.warn(`[llm] 補足に禁止表現(${bad2.join(',')})を検出。補足を破棄します`);
        sections = snapshot.map(x => ({ ...x }));
        break;
      }
    } catch (e) {
      console.warn('[llm] 補足生成の解析に失敗（スキップ）:', e.message);
    }
  }

  const result = { sections, generatedBy: MODEL };
  writeCache(key, result);
  return result;
}

module.exports = { generateReading, isConfigured, violatesPolicy, MODEL };
