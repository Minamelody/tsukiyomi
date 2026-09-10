#!/usr/bin/env node
'use strict';
// src/line-fortune.js — LINE無料鑑定ツール（R社長専用・task #18）
//
// 入力: 名前（姓+名・任意）＋生年月日（YYYY-MM-DD・必須）。
// 出力: プレーンテキスト 500〜800字（7セクション・5種すべて含む・LINEコピペ用）。
//
// 契約: TLインタフェース契約（3831959）／文面テンプレ v1（DR 3832028）／辞書確定版（Designer 3832105 + 現況 3832164）。
// 全スロット決定論（LLM非依存）＝「同じ入力=毎回同一出力」。文面はデータ駆動辞書（差し替え可能）。
// 回帰QA 5点: ①500〜800字 ②5種要素名が出力に存在 ③禁止語なし ④プレースホルダー{…}残留ゼロ ⑤誘導行が末尾に1行のみ。
//
// 使い方:
//   node src/line-fortune.js --sei 佐藤 --mei 美咲 --birthday 1995-07-15
//   node src/line-fortune.js --birthday 1990-03-25            （名前なし版）

const { seimeiHandan } = require('./seimei');
const { shichuMeishiki } = require('./shichu');
const { draw3 } = require('./tarot');
const { horoscope } = require('./astro');
const { isIchiryu, isBoso, isTenon, setsuDayInMonth } = require('./lunar-calendar');

// ── 辞書（Designer 本命確定 3832105・現況 3832164・DR QA合格） ─────────────

const ZODIAC = {
  牡羊座: { nature: 'まっすぐ突き進む', word: '先頭を走る火' },
  牡牛座: { nature: 'じっくりでも動き続ける', word: '頑丈な土の器' },
  双子座: { nature: '言葉で風を起こす', word: '言葉の風' },
  蟹座: { nature: '大事なものに水をやる', word: '深い水の持ち主' },
  獅子座: { nature: '光を集めて照らす', word: '灯台のように立つ光' },
  乙女座: { nature: '完成より整える', word: '細部に宿る真心' },
  天秤座: { nature: '選ぶことを恐れない', word: '正しい位置を探す秤' },
  蠍座: { nature: '疑うより深く見る', word: '底まで見通す眼' },
  射手座: { nature: '飛び込むことを選ぶ', word: '遠くへ放つ矢' },
  山羊座: { nature: '計画より実行する', word: '頂きへ登る石の道' },
  水瓶座: { nature: '枠の外へ変われる', word: '枠の外に置かれた灯' },
  魚座: { nature: '流されるのではなく選ぶ', word: '広い海を泳ぐ魚' },
};

// 人格画数→数霊性質/シーン/型ワード（Designer 数霊5類）
const NUMREI_RULES = [
  { test: n => n >= 1 && n <= 3, nature: '柔らかな調和の型', scene: '人と合わせるとき', type: '橋わたし' },
  { test: n => n >= 4 && n <= 6, nature: '確実に積む型', scene: '準備を重ねるとき', type: '土台づくり' },
  { test: n => n >= 7 && n <= 9, nature: '動いて掴む型', scene: '決断を下すとき', type: '挑戦者' },
  { test: n => n === 11 || n === 22 || n === 33, nature: '大きな流れを引く型', scene: '人をまとめるとき', type: '旗手' },
  { test: () => true, nature: '静かに深める型', scene: 'ひとり考えるとき', type: '読み手' },
];
function numrei(n) { return NUMREI_RULES.find(r => r.test(n)); }

const GOGYO = {
  木: { nature: '伸びる・始める', scene: '新しいことを芽吹かせるとき', rec1: '始めること', rec2: '整えること' },
  火: { nature: '熱する・照らす', scene: '人を動かすとき', rec1: '前に出すこと', rec2: '待つこと' },
  土: { nature: '整える・支える', scene: '土台を据えるとき', rec1: '固めること', rec2: '広げること' },
  金: { nature: '削る・決める', scene: '取捨を決めるとき', rec1: '絞ること', rec2: '足すこと' },
  水: { nature: '流す・巡らせる', scene: '流れに乗るとき', rec1: '流れに任せること', rec2: '流れを止めること' },
};

const TAROT = {
  愚者: { brief: '新しい道が自然に開き始めているようです', advice: '未知をそのまま進むこと' },
  魔術師: { brief: '持っている手札が揃ってきたようです', advice: '今ある道具を使うこと' },
  女教皇: { brief: '答えはまだ奥に隠れているようです', advice: '静かに聞くこと' },
  女帝: { brief: '育てているものが実り始めています', advice: '与えることを惜しまないこと' },
  皇帝: { brief: '土台が固まってきています', advice: '堂々と決めること' },
  教皇: { brief: '信じる柱が見つかりつつあります', advice: '先に学ぶこと' },
  恋人: { brief: '選ぶべき分かれ道に立っています', advice: '心が向く方を選ぶこと' },
  戦車: { brief: '勢いがついてきています', advice: '速度を落とさず進むこと' },
  力: { brief: 'やわらかい強さが求められています', advice: 'にこやかに耐えること' },
  隠者: { brief: '一度立ち止まる時期のようです', advice: '灯りを頼りに歩むこと' },
  運命の輪: { brief: '流れが動き変わるときです', advice: '流れに身を任せること' },
  正義: { brief: '筋が通ってきています', advice: '正しい秤で量ること' },
  吊るされた男: { brief: '視点を変えるときです', advice: '逆さまから見ること' },
  死神: { brief: '終わるものが終わろうとしています', advice: '手放すこと' },
  節制: { brief: 'ほどよい加減が鍵のようです', advice: '混ぜ合わせること' },
  悪魔: { brief: '絡まった糸に気づいています', advice: '縛りをほどくこと' },
  塔: { brief: '急な変化が来ています', advice: '崩れた跡を片づけること' },
  星: { brief: '希望が差し込んできています', advice: '願いを言葉にすること' },
  月: { brief: '見えないものが動いています', advice: '明かりを待つこと' },
  太陽: { brief: '明るい流れが来ています', advice: '光に向かうこと' },
  審判: { brief: '呼び声が聞こえています', advice: '立ち上がること' },
  世界: { brief: '一つの輪が閉じようとしています', advice: '完成を味わうこと' },
};

const JIGI = {
  美: '美という字は、整えることを大切にする意味あいがあります',
  花: '花という字には、咲く時期を自ら選ぶ響きがあります',
  光: '光という字は、まわりを照らす性質を帯びています',
  海: '海という字は、広く受け入れる器を表しています',
  希: '希という字は、望みを持ち続ける強さがあります',
  愛: '愛という字は、つながりを何より重んじる心です',
  心: '心という字は、感覚が細かく働く持ち味です',
  彩: '彩という字は、暮らしに色を加える感性があります',
  優: '優という字は、やわらかい強さを持つ性質です',
  健: '健という字は、丈夫に育つ力を表しています',
  真: '真という字は、一本道をまっすぐ歩む性質です',
  和: '和という字は、ほどよい加減を重んじる心です',
  恵: '恵という字は、与えることを自然にする性質です',
  結: '結という字は、人と人を結ぶ力を帯びています',
  望: '望という字は、遠くを見つめる眼を持っています',
  夢: '夢という字は、描いたものを追う情熱があります',
  清: '清という字は、澄んだ見方を大切にする性質です',
  拓: '拓という字は、道を開くことを選ぶ強さです',
  颯: '颯という字は、風のように軽やかに進む性質です',
  蒼: '蒼という字は、広い空のように大きく構える性質です',
};
function jigiText(char) {
  if (JIGI[char]) return JIGI[char];
  return `${char}という字は、名前に込めた願いがそのまま形になっている字です`;
}

// {現況}（月相8区分→名詞句・Designer 3832164）
const GENKYO = {
  新月: '静かに始まる夜',
  三日月: '細く光る期待のような月',
  上弦の月: '半分まで満ちていく月',
  盈凸月: 'まもなく満ちようとする月',
  満月: '最も明るく満ちた月',
  虧凸月: '満ちたあと、静かに暮れていく月',
  下弦の月: '半分まで欠けていく月',
  残月: 'ほとんど消えて、次に備える月',
};

// 誘導A/B（DR 3832028 確定2案・決定的振り分け）
const GUIDE_A = 'ここまでが無料で読める範囲です。もっと深く、5つの占術を1冊にまとめた完全鑑定書は、ココナラの5種セットにあります。';
const GUIDE_B = '同じ5つの占術を、もっと長く丁寧に読むなら、ココナラの5種セット完全鑑定書へどうぞ。';

const FORBIDDEN = ['当たります', '当たる', '絶対', '必ず', '保証', '治り', '儲か', '効果が', 'うまくいく', '全てがうまく'];

// ── 決定論ユーティリティ ─────────────────────────────────────────────────
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** 月齢（日）→8区分。2000-01-06 を新月基準とした簡易 synodic 算出（決定論）。 */
function moonPhaseKey(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const days = Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(2000, 0, 6)) / 86400000);
  const syn = 29.53058867;
  const age = ((days % syn) + syn) % syn;
  const step = syn / 8;
  const idx = Math.min(7, Math.floor(age / step));
  return ['新月', '三日月', '上弦の月', '盈凸月', '満月', '虧凸月', '下弦の月', '残月'][idx];
}

/** 生まれ月→月支五行（節入り簡易・寅=2月）。{月気}として用いる（決定論）。 */
function monthElement(y, m) {
  const map = [null, '土', '木', '木', '土', '火', '火', '土', '金', '金', '土', '水', '水'];
  return map[m];
}

/** 字義の主要1字（文字数の多い方・同数は姓）。 */
function primaryChar(sei, mei) {
  if (!sei && !mei) return null;
  const src = (mei.length > sei.length) ? mei : sei;
  return src[0];
}

/**
 * ⑥運気の流れ。生まれ月（生年月日の年・月）の暦をスキャンして、実際の節入り・
 * 一粒万倍日・天恩日から文言を作る（決定論・LLM非依存・外部暦＝senjitsu.py と同一判定）。
 * 「今月」は生年月日に紐づけた生まれ月＝同じ入力なら毎回同一出力。
 */
function buildUnkiSec(y, m) {
  const p2 = n => String(n).padStart(2, '0');
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const ichiryu = [], tenon = [], boso = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${y}-${p2(m)}-${p2(d)}`;
    if (isIchiryu(ds)) ichiryu.push(d);
    if (isTenon(ds)) tenon.push(d);
    if (isBoso(ds)) boso.push(d);
  }
  const setsu = setsuDayInMonth(y, m);
  const setsuD = setsu ? setsu.dd : Math.min(15, daysInMonth);
  const a = ichiryu[0] ?? (boso[0] ?? tenon[0] ?? setsuD);              // 吉日A（始める）
  const b = ichiryu[1] ?? (ichiryu[0] ?? boso[0] ?? tenon[0] ?? setsuD); // 吉日B（始める・2本目）
  const c = tenon[0] ?? (boso[0] ?? ichiryu[2] ?? setsuD);              // 片付日（手放し・片付け＝天恩日）
  return `生まれ月の流れの切り替わりは${m}月${setsuD}日のあたり。新しいことを始めるなら${m}月${a}日・${m}月${b}日、手放したり片づけたりするなら${m}月${c}日が向きやすいようです。一粒万倍日は、流れが重なる日です。`;
}

// ── レポート生成 ─────────────────────────────────────────────────────────

/**
 * LINE無料鑑定レポートを生成する（決定論・LLM非依存）。
 * @returns {{ text:string, sections:string[], checks:object }}
 */
function buildReport({ sei = '', mei = '', birthday } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday || '')) {
    throw new Error('birthday は YYYY-MM-DD 形式で必須です');
  }
  const [y, m, d] = birthday.split('-').map(Number);
  const name = (sei + mei).trim();

  // 5種エンジン（すべて決定論）
  const seimei = name ? seimeiHandan(sei, mei) : null;
  const jinkaku = (seimei && seimei.kaku && seimei.kaku.人格) ? seimei.kaku.人格.n : null;
  const shichu = shichuMeishiki(birthday);
  const nikkanKan = shichu.nikkan.kan;             // 例: 甲
  const nikkanEl = shichu.nikkan.element;          // 例: 木
  const sun = horoscope(birthday).sun.name;        // 太陽星座
  const cards = draw3(`${name}|${birthday}`);
  const nowCard = cards.find(c => c.position === '現在') || cards[1];

  // 誘導A/B（生年月日のハッシュで決定的に振り分け）
  const guide = (hash(birthday) % 2 === 0) ? GUIDE_A : GUIDE_B;

  // ① 挨拶
  const greet = name
    ? `${name}さん、生まれた日とお名前から、あなたの流れを読みました。`
    : '生まれた日から、あなたの流れを読みました。';

  // ② 姓名判断
  let seimeiSec;
  if (jinkaku == null) {
    seimeiSec = 'お名前（姓と名）を教えていただければ、姓名判断も加えて読めます。';
  } else {
    const nr = numrei(jinkaku);
    const ch = primaryChar(sei, mei);
    seimeiSec = `お名前の中心になる画数は${jinkaku}画。この画数には${nr.nature}の性質があって、${nr.scene}、あなたらしさがよく出るようです。${jigiText(ch)}。名前が示す型は、${nr.type}。急がず、この型のまま進むのが自然な流れです。`;
  }

  // ③ 12星座・西洋占星術
  const zod = ZODIAC[sun];
  const genkyo = GENKYO[moonPhaseKey(birthday)];
  const seizaSec = `${m}月${d}日生まれのあなたの太陽は${sun}。${zod.nature}ことを大切にする、${zod.word}のような人として映ります。今のあなたは${genkyo}の流れの中にいて、繰り返し浮かぶ考えが、答えの形をやわらかく変えているようです。生まれた時刻・場所をいただけると、上昇星座まで読めます。`;

  // ④ 四柱推命
  const gy = GOGYO[nikkanEl];
  const gesshi = monthElement(y, m);
  const shichuSec = `あなたの日干は${nikkanKan}（${nikkanEl}）。${gy.nature}の持ち味を持つ日干で、${gy.scene}に力を発揮しやすいようです。今は${gesshi}の気が強く、${gy.rec1}よりも${gy.rec2}を進めるのが、流れに合っているように見えます。`;

  // ⑤ タロット
  const tv = TAROT[nowCard.card] || TAROT['愚者'];
  const tarotSec = `いまのあなたの1枚は、${nowCard.card}（${nowCard.orientation}）。${tv.brief}。急がず、${tv.advice}を選ぶのが、自然な流れのようです。`;

  // ⑥ 運気の流れ（生まれ月の暦スキャン・決定論）
  const unkiSec = buildUnkiSec(y, m);

  const sections = [
    { head: null, body: greet },
    { head: '姓名判断', body: seimeiSec },
    { head: '12星座・西洋占星術', body: seizaSec },
    { head: '四柱推命', body: shichuSec },
    { head: 'タロット', body: tarotSec },
    { head: '運気の流れ', body: unkiSec },
    { head: null, body: guide },
  ];

  const text = sections
    .map(s => (s.head ? `【${s.head}】\n${s.body}` : s.body))
    .join('\n\n');

  return { text, sections, checks: qaCheck(text, sections) };
}

// ── 回帰QA 5点 ───────────────────────────────────────────────────────────
function qaCheck(text, sections) {
  const fails = [];
  const len = text.length;
  if (len < 500 || len > 800) fails.push(`字数 ${len}（500〜800外）`);
  for (const name of ['姓名判断', '四柱推命', 'タロット', '12星座', '西洋占星術']) {
    if (!text.includes(name)) fails.push(`5種要素名「${name}」が存在しない`);
  }
  for (const w of FORBIDDEN) {
    if (text.includes(w)) fails.push(`禁止語「${w}」が含まれる`);
  }
  if (/\{[^{}]+\}/.test(text)) fails.push('プレースホルダー {…} 残留');
  const bodies = sections.filter(s => s.body === GUIDE_A || s.body === GUIDE_B);
  if (bodies.length !== 1) fails.push(`誘導行が末尾に1行でない（${bodies.length}件）`);
  const last = sections[sections.length - 1];
  if (last.body !== GUIDE_A && last.body !== GUIDE_B) fails.push('末尾が誘導行でない');
  return { len, ok: fails.length === 0, fails };
}

module.exports = { buildReport, qaCheck, ZODIAC, TAROT, JIGI, GENKYO, FORBIDDEN };

// CLI（R社長専用）
if (require.main === module) {
  function arg(name, def) {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 ? (process.argv[i + 1] ?? true) : def;
  }
  try {
    const r = buildReport({ sei: arg('sei', ''), mei: arg('mei', ''), birthday: arg('birthday', '') });
    if (arg('check')) {
      console.log(JSON.stringify(r.checks, null, 2));
    } else {
      console.log(r.text);
    }
  } catch (e) {
    console.error('失敗:', e.message);
    process.exit(1);
  }
}
