// 鑑定エンジン — 生年月日と悩みから個別鑑定を決定論的に生成する。
// 同じ人・同じ日は必ず同じ結果になる（再訪して結果が変わると信用が壊れるため）。

const SIGNS = [
  [1, 20, '水瓶座', '風'], [2, 19, '魚座', '水'], [3, 21, '牡羊座', '火'],
  [4, 20, '牡牛座', '地'], [5, 21, '双子座', '風'], [6, 22, '蟹座', '水'],
  [7, 23, '獅子座', '火'], [8, 23, '乙女座', '地'], [9, 23, '天秤座', '風'],
  [10, 24, '蠍座', '水'], [11, 23, '射手座', '火'], [12, 22, '山羊座', '地'],
];
const ANIMALS = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

// 悩みのカテゴリ判定用キーワード
const TOPICS = {
  love: ['恋', '好き', '彼', '彼女', '片思い', '復縁', '結婚', '離婚', '不倫', '出会', '別れ', 'デート', '相手', '夫', '妻', '婚'],
  work: ['仕事', '転職', '職場', '上司', '会社', 'キャリア', '退職', '就職', '独立', '起業', '同僚', '評価', '昇進', '副業'],
  money: ['金', 'お金', '収入', '貯金', '借金', '投資', '給料', '年収', '節約', '出費'],
  health: ['体調', '健康', '疲れ', '不調', '眠れ', '病', 'ストレス', 'メンタル'],
  self: ['自分', '将来', '不安', '迷', '生き方', '意味', '孤独', '性格', '変わりたい'],
};

// 星座境界表: [月, その月の切替日, 切替日以降の星座, 切替日より前の星座]
const SIGN_TABLE = [
  [1, 20, ['水瓶座', '風'], ['山羊座', '地']],
  [2, 19, ['魚座', '水'], ['水瓶座', '風']],
  [3, 21, ['牡羊座', '火'], ['魚座', '水']],
  [4, 20, ['牡牛座', '地'], ['牡羊座', '火']],
  [5, 21, ['双子座', '風'], ['牡牛座', '地']],
  [6, 22, ['蟹座', '水'], ['双子座', '風']],
  [7, 23, ['獅子座', '火'], ['蟹座', '水']],
  [8, 23, ['乙女座', '地'], ['獅子座', '火']],
  [9, 23, ['天秤座', '風'], ['乙女座', '地']],
  [10, 24, ['蠍座', '水'], ['天秤座', '風']],
  [11, 23, ['射手座', '火'], ['蠍座', '水']],
  [12, 22, ['山羊座', '地'], ['射手座', '火']],
];

function sign(d) {
  const m = d.getMonth() + 1, day = d.getDate();
  const row = SIGN_TABLE.find(r => r[0] === m);
  const [, cusp, after, before] = row;
  const [name, element] = day >= cusp ? after : before;
  return { name, element };
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function rng(seed) {
  let x = seed || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}

function detectTopic(q) {
  if (!q) return 'self';
  let best = 'self', bestN = 0;
  for (const [k, words] of Object.entries(TOPICS)) {
    const n = words.filter(w => q.includes(w)).length;
    if (n > bestN) { bestN = n; best = k; }
  }
  return best;
}

// 数値のライフパス（生年月日の各桁を合算して1桁に）
function lifePath(bd) {
  const digits = bd.replace(/\D/g, '').split('').map(Number);
  let n = digits.reduce((a, b) => a + b, 0);
  while (n > 9) n = String(n).split('').map(Number).reduce((a, b) => a + b, 0);
  return n;
}

const LIFEPATH_TRAITS = {
  1: '先に立って道を作る性質。ただし人に頼るのが苦手で、抱え込みやすい',
  2: '人の間に立って調整する性質。相手の感情を自分のものとして引き受けすぎる',
  3: '表現して人を動かす性質。飽きが早く、深める前に次へ行きたくなる',
  4: '積み上げて形にする性質。手順が崩れると強いストレスを感じる',
  5: '変化に強く自由を求める性質。定まった枠に入れられると力が出ない',
  6: '面倒を見て支える性質。頼まれると断れず、自分の分を後回しにする',
  7: '一人で深く掘る性質。人に説明する手間を省いて誤解されやすい',
  8: '現実を動かして結果を出す性質。数字や成果で自分を測りすぎる',
  9: '全体を見て受け入れる性質。境界線が曖昧で、他人の問題を背負う',
};

const ELEMENT_TONE = {
  火: { push: '勢いがそのまま結果に変わる', hold: '勢いが空回りして摩擦になる' },
  地: { push: '積んだものが確実に形になる', hold: '足場の確認に時間を使うべき' },
  風: { push: '情報と縁が向こうから集まる', hold: '考えが散って決まらなくなる' },
  水: { push: '感情の機微が正確に読める', hold: '相手の感情に巻き込まれる' },
};

const COLORS = ['深い藍', 'くすみピンク', 'ミントグリーン', 'オフホワイト', 'テラコッタ', 'ラベンダー', 'マスタード', 'チャコール', '若草色', '珊瑚色', '生成り', '深緑'];
const ITEMS = ['白いハンカチ', '使い慣れたペン', '小さな鏡', '温かい飲み物', '木製の小物', '柑橘系の香り', '手帳', '丸いアクセサリー', '無地のノート', '石のついた指輪'];
const PLACES = ['水辺のある場所', 'よく行くカフェ', '書店', '駅から一本外れた道', '高い場所', '緑のある公園', '静かな階段', 'はじめて入る店', '朝の商店街'];
const ACTS = ['朝いちばんに窓を開ける', '返信を後回しにしない', '5分だけ散歩する', '部屋の一角だけ片づける', '誰かに小さくお礼を言う', 'いつもと違う道を通る', '思いついた予定をその場で書き留める', '寝る前に明日やることを3つだけ決める'];

const TOPIC_LABEL = { love: '恋愛', work: '仕事', money: '金運', health: '健康', self: '自分自身' };

// 悩みカテゴリごとの深掘り本文
function topicDeep(topic, score, r, sg) {
  const pick = a => a[Math.floor(r() * a.length)];
  const t = ELEMENT_TONE[sg.element];
  const high = score >= 65;
  const map = {
    love: {
      read: high
        ? `いま感情を出すことに抵抗がなくなっています。${sg.element}のエレメントらしく${t.push}時期なので、遠回しな伝え方はかえって伝わりません。`
        : `相手の反応を先に想像して、期待と失望を自分の中だけで済ませてしまう癖が出ています。相手には何も届いていないので、状況は動きません。`,
      act: pick(['相手の話を遮らず最後まで聞く', 'こちらから日時を指定して予定を提案する', '返信の速さを相手に合わせる', '聞きたいことを一つだけ直接聞く']),
      avoid: pick(['察してもらうことを期待する', '相手の生活を推測で埋める', '過去の一言を根拠に結論を出す']),
    },
    work: {
      read: high
        ? `判断の材料は揃っています。${t.push}配置なので、基準を決めた瞬間に物事が動き出します。迷いの正体は情報不足ではなく決めていないことです。`
        : `いまは${t.hold}時期。決め急ぐと精度が落ちます。動かないことは後退ではなく、材料を待つ判断です。`,
      act: pick(['やらないことを1つ決める', '判断基準を紙に書き出す', '信頼できる人に一度声に出して説明する', '期限だけ先に決める']),
      avoid: pick(['選択肢を増やして考え直す', '決めていないことを決めたふりで処理する', '他人の成功例を自分の基準にする']),
    },
    money: {
      read: high
        ? `入る流れが強い時期です。ただし入った分をそのまま出す癖が同時に強まるので、増えた実感が残りません。`
        : `出ていく方が目立つ時期。新しい支出の決定は先送りが賢明です。減らすより「決めない」だけで十分効きます。`,
      act: pick(['固定費を1つだけ見直す', '衝動的な買い物を24時間保留する', '小さな入金経路を1つ作る', '1週間だけ支出を記録する']),
      avoid: pick(['一度で大きく取り返そうとする', '相場や勧誘の話に急いで乗る', '見栄のための出費']),
    },
    health: {
      read: high
        ? `体力は戻ってきています。ただし回復したところで一気に詰め込むと元に戻るので、増やす前に整える順番を守ってください。`
        : `エネルギーが内側を向いています。気力の問題ではなく単純に休息が足りていません。判断も精度が落ちるので重い決断は避けてください。`,
      act: pick(['寝る時間を30分早める', '画面を見ない時間を作る', '一食だけ丁寧に食べる', '軽く体を動かす']),
      avoid: pick(['気力で押し切ろうとする', '休むことに罪悪感を持つ', '予定を詰めて空白を埋める']),
    },
    self: {
      read: high
        ? `自分の輪郭がはっきりしてきた時期です。${t.push}流れなので、やりたいと思ったことを小さく試すのに向いています。`
        : `他人の期待と自分の願いが混ざって区別できなくなっています。まず「これは誰の願いか」を分けるところからです。`,
      act: pick(['やりたいことを10個書き出す', '断る練習を1回する', '一人で過ごす時間を確保する', '誰にも言っていない願いを1つ書く']),
      avoid: pick(['他人の評価で自分を測る', '答えを急いで出す', '変わらない自分を責める']),
    },
  };
  return map[topic];
}

/**
 * 鑑定を生成する。
 * @param {object} input - { name, birthday: 'YYYY-MM-DD', gender, question, date: 'YYYY-MM-DD' }
 * @returns {object} 無料パートと有料パートを含む鑑定結果
 */
function diagnose(input) {
  const name = (input.name || 'あなた').trim();
  const bd = input.birthday;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bd || '')) throw new Error('birthday must be YYYY-MM-DD');
  const question = (input.question || '').trim();
  const today = input.date || new Date().toISOString().slice(0, 10);

  const bdDate = new Date(bd);
  const sg = sign(bdDate);
  const animal = ANIMALS[(((bdDate.getFullYear() - 4) % 12) + 12) % 12];
  const lp = lifePath(bd);
  const topic = detectTopic(question);

  const seed = hash(`${name}|${bd}|${today}`);
  const r = rng(seed);

  const scores = {};
  for (const k of ['love', 'work', 'money', 'health']) scores[k] = 40 + Math.floor(r() * 61);
  scores.total = Math.round((scores.love + scores.work + scores.money + scores.health) / 4);

  const lr = rng(seed ^ 0x5bf03635);
  const lucky = {
    color: COLORS[Math.floor(lr() * COLORS.length)],
    item: ITEMS[Math.floor(lr() * ITEMS.length)],
    place: PLACES[Math.floor(lr() * PLACES.length)],
    number: 1 + Math.floor(lr() * 40),
    action: ACTS[Math.floor(lr() * ACTS.length)],
  };

  const t = scores.total;
  const tone = t >= 85 ? '絶好調' : t >= 70 ? 'good' : t >= 55 ? '穏やか' : t >= 45 ? 'ゆらぎ' : '休息日';
  const headline = t >= 75 ? `${name}さん、今日は流れが味方します。`
    : t >= 55 ? `${name}さん、今日は静かに整う日。`
    : `${name}さん、今日は守りを固める日。`;
  const freeBody = t >= 75
    ? `${sg.name}の${sg.element}のエネルギーがはっきり前に出て、動いた分だけ結果が返ってきます。迷っていた連絡や申し込みは今日のうちに。`
    : t >= 55
    ? `大きな波はありませんが、丁寧に積んだものがそのまま残る日です。派手な決断より下ごしらえに時間を使うと後で効きます。`
    : `エネルギーがやや内側を向いています。無理に決めると精度が落ちるので、判断は明日以降に回してください。`;

  const dr = rng(seed ^ 0x9e3779b9);
  const deepTopic = topicDeep(topic, scores[topic] || scores.total, dr, sg);
  const nextMonth = new Date(today);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const turningMonth = nextMonth.getMonth() + 1;

  return {
    meta: { name, birthday: bd, date: today, sign: sg.name, element: sg.element, animal, lifePath: lp, topic, topicLabel: TOPIC_LABEL[topic] },
    scores, tone, lucky,
    free: { headline, body: freeBody },
    deep: {
      character: `ライフパス${lp}。${LIFEPATH_TRAITS[lp]}。${sg.name}の${sg.element}が重なるので、${ELEMENT_TONE[sg.element].hold}場面で特にそれが出ます。`,
      topicLabel: TOPIC_LABEL[topic],
      topicScore: scores[topic] || scores.total,
      reading: deepTopic.read,
      action: deepTopic.act,
      avoid: deepTopic.avoid,
      flow: `今月は準備期間。${turningMonth}月の中旬に外側からの誘いという形で転機が来ます。そこで動けるかは、それまでに${scores.work >= 60 ? '判断基準を決めておけたか' : '体力と余白を残せたか'}で決まります。3か月目に結果が形になり始めます。`,
      answer: question
        ? (scores.total >= 65
          ? `「${question}」について。結論から言えば進めて構いません。ただし自分で期限を切ってください。期限のない前進は迷いに戻ります。`
          : `「${question}」について。いま答えを出す必要はありません。判断を止めるのは負けではなく、材料が揃っていないという事実の確認です。2週間後に同じ問いを見直してください。`)
        : null,
    },
    disclaimer: '娯楽目的の鑑定です。医療・法律・投資の判断に用いるものではありません。',
  };
}

module.exports = { diagnose, sign, lifePath, detectTopic };
