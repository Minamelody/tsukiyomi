// Threads投稿ジェネレータ v2（2026-09-06 投稿品質改修）
//
// v1 からの変更（R社長「もっと濃く・誘導は露骨でなく」指摘の実装）:
//   - 5層構造（痛みの名指し / 暦・時間窓の限定 / 絵文字1個CTA / 選別の言葉 / 情景で約束）
//   - 本文にURL・商品・実績数値は一切出さない。鑑定への誘導は「お伝えします」の1語に留める
//   - T1（朝・選日型）は rarity.plan().useT1 の日のみ。単独ラベル日はT2へ
//   - 時間窓は senjitsu.peak_window() の実データ（参考投稿の5:00〜8:59を流用しない）
//   - カードspecを同梱（本文と同じデータから生成。本文とカードで文を繰り返さない）
//   - 従来型（engagement/funnel）はフォールバック用に温存
//
// 重要: 日付・時刻を焼いた文面は当日限りで破棄。失敗枠の翌日流用禁止。
//       同一文面の再投稿はシャドウバン対象。履歴（out/post-history.json）は消さないこと。

const { fetchDayFacts } = require('./senjitsu-bridge');

// ── データプール（v1から継続） ──────────────────────────────────────────
const SCENES = [
  { tag: 'reunion', lines: ['あなたが会いたかったあの人に、', 'もうすぐ会えます。'] },
  { tag: 'reunion', lines: ['もう終わったと思っていた縁が、', '向こうから戻ってきます。'] },
  { tag: 'reunion', lines: ['名前を思い出した人がいるなら、', 'その人からもうすぐ動きがあります。'] },
  { tag: 'reunion', lines: ['連絡が来ないのは、', '終わったからではありません。', 'まだ言葉が見つかっていないだけです。'] },
  { tag: 'reunion', lines: ['あの人は、あなたのことを', 'まだ一度も忘れていません。'] },
  { tag: 'reunion', lines: ['既読のまま止まっている画面。', 'あれは、あと少しで動きます。'] },
  { tag: 'reunion', lines: ['さよならを言えなかった相手と、', 'もう一度話す機会が来ます。'] },
  { tag: 'reunion', lines: ['あなたが諦めた連絡先。', '消さないでおいてください。'] },
  { tag: 'love', lines: ['伝えられなかった気持ち、', '来週あたりに言える流れが来ます。'] },
  { tag: 'love', lines: ['あなたが「無理だ」と思っている相手。', '相手はそう思っていません。'] },
  { tag: 'love', lines: ['好きだと気づかれたくない人に、', 'もう気づかれています。'] },
  { tag: 'love', lines: ['あなたが選ばれないと思ってる場面で、', '実はあなたが最初に名前を出されています。'] },
  { tag: 'love', lines: ['何気ない連絡が1つ来ます。', 'あれを見逃さないでください。'] },
  { tag: 'love', lines: ['今の関係、動かないように見えて', '相手の方が先に限界を迎えます。'] },
  { tag: 'endure', lines: ['あなたが我慢して飲み込んだ言葉、', '無駄になっていません。'] },
  { tag: 'endure', lines: ['誰にも気づかれてないと思ってること。', 'ちゃんと見てる人がいます。'] },
  { tag: 'endure', lines: ['「私ばっかり」と思ってた時間の分が、', 'そろそろ返ってきます。'] },
  { tag: 'endure', lines: ['一人で抱えてたこと、', '来月には話せる相手が現れます。'] },
  { tag: 'endure', lines: ['あなたが黙って直してきたこと。', '気づいてた人が動き出します。'] },
  { tag: 'endure', lines: ['報われないと思ってた努力の、', '結果が出るのは急にです。'] },
  { tag: 'move', lines: ['ずっと止まってた何かが、', '今夜から静かに動き出す人がいます。'] },
  { tag: 'move', lines: ['何も変わらないと思ってた毎日に、', '3日以内に切れ目が入ります。'] },
  { tag: 'move', lines: ['あなたが降りようとしていた場所。', 'あと一回だけ待ってください。'] },
  { tag: 'move', lines: ['止まっていたのは、', 'タイミングが揃うのを待っていたからです。'] },
  { tag: 'move', lines: ['近いうちに、大きく状況が動きます。'] },
  { tag: 'move', lines: ['同じ場所にいるように見えて、', 'あなたはもう半分抜け出しています。'] },
  { tag: 'giveup', lines: ['あなたが諦めかけてたこと、', '実はまだ、終わってません。'] },
  { tag: 'giveup', lines: ['選ばなかった道は、', 'まだ閉じていません。'] },
  { tag: 'giveup', lines: ['もう遅いと思っていること。', '期限はまだ来ていません。'] },
  { tag: 'giveup', lines: ['手放した方がいいと言われたもの。', 'あれはまだ持っていていいです。'] },
  { tag: 'giveup', lines: ['今かかっている重さは、', '手放す直前だからこそ出るものです。'] },
  { tag: 'work', lines: ['辞めようか迷っている人。', '答えは来月の半ばに出ます。'] },
  { tag: 'work', lines: ['評価されていないと感じている場所で、', 'あなたの名前が上がっています。'] },
  { tag: 'work', lines: ['今の環境が合わないと感じるのは、', 'あなたが次に進む準備ができたからです。'] },
  { tag: 'work', lines: ['声をかけられる話が来ます。', '断る前に一度だけ聞いてください。'] },
  { tag: 'work', lines: ['向いていないと思ってることの中に、', 'あなたが一番強い部分があります。'] },
  { tag: 'work', lines: ['頑張り方を、そろそろ変えていい時期です。'] },
  { tag: 'money', lines: ['出ていくばかりだった流れが、', '入る方に切り替わります。'] },
  { tag: 'money', lines: ['諦めた金額が、', '別の形で戻ってくる人がいます。'] },
  { tag: 'money', lines: ['今月の後半、想定していなかった入りがあります。'] },
  { tag: 'money', lines: ['減らすことばかり考えていた人。', 'そこはもう十分です。'] },
  { tag: 'relation', lines: ['離れていく人がいます。', 'それは失うのではなく、席が空くだけです。'] },
  { tag: 'relation', lines: ['合わないと感じていた相手と、', '距離を置いていい時期に入りました。'] },
  { tag: 'relation', lines: ['あなたを軽く扱う人の影響力が、', 'これから急に弱まります。'] },
  { tag: 'relation', lines: ['言い返せなかった相手のこと。', 'あなたが動かなくても状況が変わります。'] },
  { tag: 'relation', lines: ['新しく入ってくる人がいます。', '思っているより早く会います。'] },
  { tag: 'self', lines: ['ちゃんとやれてないと思ってる人。', '見えてないだけで、進んでます。'] },
  { tag: 'self', lines: ['疲れているのは弱さではなく、', 'ずっと踏ん張ってきたからです。'] },
  { tag: 'self', lines: ['自分だけ遅れていると思っている人。', '順番が違うだけです。'] },
  { tag: 'self', lines: ['今夜、眠れない人がいるなら。', 'その考えごとは明日には軽くなります。'] },
  { tag: 'self', lines: ['あなたが変わりたいと思った日から、', 'もう始まっています。'] },
  { tag: 'self', lines: ['決めきれないのは、', 'まだ材料が揃ってないだけです。'] },
  { tag: 'sign', lines: ['流れが変わる合図は、', 'いつも小さく静かに来ます。'] },
  { tag: 'sign', lines: ['ここ数日、同じ数字を見た人。', 'あれは切り替わりの印です。'] },
  { tag: 'sign', lines: ['急に昔のことを思い出したなら、', 'それは片付く順番が来たからです。'] },
  { tag: 'sign', lines: ['今日ふと嫌な予感がした人。', '避けられる範囲のものです。'] },
];

// 絵文字を置かせる絵文字郡（毎日ローテーション）
const EMOJIS = ['🐉', '🌙', '✨', '🔑', '🌸', '⭐️', '🕊', '🌊', '🍀', '💫'];

// T2 用: 痛みの「原因の言い換え」（本文・1行目）
const REASONS = ['古い流れ', '巡りの滞り', '切れかけの縁', '逆風', '思い込み', '相手の事情'];

// T2/T3 用: 締めの一言（安心を渡す）
const CLOSERS = [
  '大丈夫、ちゃんと来てるから。',
  'あなたは間に合っています。',
  '焦らなくて大丈夫です。',
  'ちゃんと見えてます。',
  '順番は守られます。',
  'もう少しだけ、待てば足ります。',
  '近いうちに、動きが見えます。',
  'そのままのあなたで大丈夫です。',
];

// カード用フレーズ（本文と文を繰り返さない・tag別）
// pain = カード中段の名指し / body = カード下段の情景
const CARD_T2 = {
  reunion: { pain: ['会いたい人に', '届く言葉がある。'], body: ['返事は', 'もう動き始めている。'] },
  love:    { pain: ['気づかれたくない', 'あなたの気持ち。'], body: ['相手には', 'もう見えている。'] },
  endure:  { pain: ['飲み込んできた', '言葉の分。'], body: ['返る時期に', '入っている。'] },
  move:    { pain: ['止まっていた', '何かがある。'], body: ['今夜から', '静かに動き出す。'] },
  giveup:  { pain: ['諦めかけた', 'あの場所。'], body: ['まだ', '閉じてはいない。'] },
  work:    { pain: ['続けるか迷う', '今の場所。'], body: ['答えは', '来月の半ばに。'] },
  money:   { pain: ['出ていくばかりの', '流れ。'], body: ['入る方に', '切り替わる。'] },
  relation:{ pain: ['合わない人に', '縮こまる夜。'], body: ['席が空くと', '新しい人が来る。'] },
  self:    { pain: ['頑張ってきた', 'あなたへ。'], body: ['ちゃんと', '進んでいる。'] },
  sign:    { pain: ['同じ数字を', '見た夜。'], body: ['あれは', '切り替わりの印。'] },
};
// カード用フレーズ（t3用・本文とは別系統）
const CARD_T3 = {
  reunion: { body: ['終わった話は', 'もう一度、続きます。'] },
  love:    { body: ['思っているより', 'あなたは選ばれています。'] },
  endure:  { body: ['踏ん張った分は', '必ず返ってきます。'] },
  move:    { body: ['止まっていたのは', '助走のためです。'] },
  giveup:  { body: ['持っていていいものと', '手放すもの。'] },
  work:    { body: ['名前は', 'もう上がっています。'] },
  money:   { body: ['流れは', '入る方に変わります。'] },
  relation:{ body: ['空いた席に', '新しい人が来ます。'] },
  self:    { body: ['順番が違うだけ', '遅れてはいません。'] },
  sign:    { body: ['小さな合図は', 'もう来ています。'] },
};

function rng(seed) {
  let x = seed || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ── v2 ビルダー ─────────────────────────────────────────────────────────

/** T1（朝・選日型。useT1の日のみ） */
function buildT1(dateStr, facts, r, emoji) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const labels = facts.labels;
  const wName = facts.windowName || '';
  const wLabel = facts.windowLabel || '';
  // 単独の選日に「重なる」は使えない（年37日発生する）。ラベル数で文言を分ける。
  // 単独側で希少さを主張しないこと: 一粒万倍日単独は年37日（月3回）あり「年に何度もない」は嘘になる。
  const head = labels.length >= 2
    ? [`${labels.join(' × ')}が`, '重なる特別な日。']
    : [`${labels[0]}にあたります。`, '何かを始めるのに向く日です。'];
  const lines = [
    `${m}月${d}日は、`,
    ...head,
    '',
    '気が最も濃くなるのは',
    `${wName}（${wLabel}）だけ。`,
    '',
    `「${emoji}」を置いてくださった方に、`,
    'いま視えているものを',
    '正直にお返しします。',
  ];
  const wd = '日月火水木金土'[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const cardSpec = {
    template: 't1',
    senjitsu: labels.join(' × '),
    date_label: `${y}年${m}月${d}日（${wd}）`,
    window: wLabel,
    window_name: wName,
    emoji,
  };
  return { type: 't1', tag: 'koyomi', emoji, text: lines.join('\n'), cardSpec };
}

/** T2（昼・痛み名指し型） */
function buildT2(dateStr, r, emoji, avoidTags = []) {
  const [y, m, d] = dateStr.split('-').map(Number);
  let pool = SCENES.filter(s => !avoidTags.includes(s.tag));
  if (!pool.length) pool = SCENES;
  const scene = pool[Math.floor(r() * pool.length)];
  const reason = REASONS[Math.floor(r() * REASONS.length)];
  const closerTails = [
    ['置けた人から順に、', 'お伝えします。'],
    ['置いてくれた人から、', '順に見ていきます。'],
    ['置いた人から一つずつ、', 'お返しします。'],
  ];
  const tail = closerTails[Math.floor(r() * closerTails.length)];
  const lines = [
    ...scene.lines,
    '',
    `それ、${reason}が`,
    '居座っているだけかもしれません。',
    '',
    `${m}月${d}日、${emoji}を`,
    ...tail,
  ];
  const cardPh = CARD_T2[scene.tag] || CARD_T2.self;
  const cardSpec = { template: 't2', pain: cardPh.pain, body: cardPh.body, emoji };
  return { type: 't2', tag: scene.tag, emoji, text: lines.join('\n'), cardSpec };
}

/** T3（夜・独白型） */
function buildT3(dateStr, r, emoji, avoidTags = []) {
  let pool = SCENES.filter(s => !avoidTags.includes(s.tag));
  if (!pool.length) pool = SCENES;
  const scene = pool[Math.floor(r() * pool.length)];
  const closer = CLOSERS[Math.floor(r() * CLOSERS.length)];
  const lines = [
    'この時間に、',
    'これを読んでいる人へ。',
    '',
    ...scene.lines,
    '',
    'その感覚は',
    '当たっています。',
    '',
    `「${emoji}」だけ置いてください。`,
    '理由は聞きません。',
    '',
    closer,
  ];
  const cardPh = CARD_T3[scene.tag] || CARD_T3.self;
  const cardSpec = { template: 't3', hook: ['静かな夜に、', '届く言葉。'], body: cardPh.body, emoji };
  return { type: 't3', tag: scene.tag, emoji, text: lines.join('\n'), cardSpec };
}

// ── 型A: 暦名→意味の固定辞書（計算はコード・語りは辞書） ──────────────────
const TYPE_A_MEANINGS = {
  '天赦日': '天地がすべてを赦す日',
  '一粒万倍日': '種をまけば万倍になる日',
  '母倉日': '母が子を慈しむ日',
  '天恩日': '天の恵みを受ける日',
  '寅の日': '力が満ち、動き出す日',
  '巳の日': '金運を呼ぶ日',
};
// 型A: 暦名→（煽り但し書き・煽り実践・問い）。吉日の性質に沿った煽り強めで統一する。
// 一粒万倍日＝始める／母倉日＝慈しむ／天赦日＝許す／天恩日＝感謝／寅の日＝動く／巳の日＝整える。
// ・「静かに過ごす」等の「その日の意味と逆」は矛盾するので入れない（R社長 2026-09-07 指摘）
// ・時刻・絵文字は本文に出さない（カードも window/emoji=None 既定。a6476e4）
// ・煽り強め（二択・期限の切迫感・弱さの名指し）だが、効果保証語（必ず/絶対/保証）・実績捏造・いいね/フォロー依頼は「ない」。
const TYPE_A_FLOW = {
  '天赦日': {
    caveat: 'なのに、あなたはまだ、過去を許せないままでいます。',
    actions: [
      '今日、許すか、許さないか。それだけです。',
      '次に許せる日がいつ来るかは、だれにも分かりません。今日、手放しなさい。',
    ],
    question: '今日、許すなら、誰を許しますか。',
  },
  '一粒万倍日': {
    caveat: 'なのに、あなたはまだ何も始めていません。',
    actions: [
      '今日、まくか、まかないか。それだけです。',
      'この機会を逃せば、次はいつ来るか分かりません。明日では遅い。',
    ],
    question: '今日、始めるなら、何から始めますか。',
  },
  '母倉日': {
    caveat: 'なのに、あなたは大切な人を、後回しにし続けています。',
    actions: [
      '今日、伝えるか、伝えないか。それだけです。',
      '言いそびれた言葉は、明日には言えなくなります。今日、伝えなさい。',
    ],
    question: '今日、いちばん大切にしたい人は、だれですか。',
  },
  '天恩日': {
    caveat: 'なのに、あなたは受けた恩を、そのままにしていませんか。',
    actions: [
      '今日、返すか、返さないか。それだけです。',
      '恩は返さなければ、そこで止まります。今日、ありがとうを言葉にしなさい。',
    ],
    question: '最近、ありがとうを伝えたい人は、いますか。',
  },
  '寅の日': {
    caveat: 'なのに、あなたは今日も、動き出せずにいます。',
    actions: [
      '今日、動くか、動かないか。それだけです。',
      'この力を逃せば、次に動ける日は、また先になります。今日、一歩踏み出しなさい。',
    ],
    question: '今日、一歩動くなら、どこから始めますか。',
  },
  '巳の日': {
    caveat: 'なのに、あなたはお金の流れを、乱れたまま放っています。',
    actions: [
      '今日、整えるか、整えないか。それだけです。',
      '無駄を放っておけば、金運が巡る日は遠くなります。今日、片付けなさい。',
    ],
    question: '最近、整えたいのは、何ですか。',
  },
};
// 型A・絵文字リアクション型のCTA（1投稿＝1反応誘導。問いかけ型とは排他で使う）
const TYPE_A_EMOJI_CTA = [
  '受け取れる人は【{e}】を。',
  '信じる人は【{e}】を置いていってください。',
  '当たってる人は【{e}】だけ置いていって。',
];

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

// ── 型B: 12星座の一言（画像カード用。本文には書かない） ──────────────────
const ZODIAC_LINES = [
  ['牡羊座', '迷ったら進む'],
  ['牡牛座', '焦らずに待つ'],
  ['双子座', '話せば軽くなる'],
  ['蟹座',   '家族が力になる'],
  ['獅子座', '前に出ていい'],
  ['乙女座', '細やかさが光る'],
  ['天秤座', '相手に任せる'],
  ['蠍座',   '深く見る日'],
  ['射手座', '遠くが呼ぶ'],
  ['山羊座', '積み上げが効く'],
  ['水瓶座', '常識を外す'],
  ['魚座',   '直感が鋭い'],
];
// 型B・煽り強め（一言なし版）。R社長「今日の一言とか要らない」を受けて定式を撤去。
// 星座フックの問い → 弱さの名指し → 締めの問い の3行。2禁（実績捏造・いいねおねだり）・効果保証（必ず/絶対）は不使用。
// 本採用 = Designer案（post-formula.md 収録・2026-09-07）。差し替えで多様化する時はここに配列を足す。
const TYPE_B_VARIANTS = [
  [
    '今日の12星座。あなたの星座、何て書いてあった？',
    '読んだ瞬間に「違う」と思った人。それ、当たってたのを認めたくないだけ。',
    'あなたの星座、当たってましたか。',
  ],
];

// ── 型D: 生まれた日を3で割った余りの診断 ─────────────────────────────────
const TYPE_D_BRANCHES = [
  { r: '余り0', name: '直感タイプ', line: '迷ったときは、最初に思いついた方が正解になりやすい。' },
  { r: '余り1', name: '計画タイプ', line: '段取りを整えるほど、力が伸びていく。' },
  { r: '余り2', name: '共感タイプ', line: '人の気持ちが、言葉にしなくても読める。' },
];
// 型Dカード用（TYPE_D_BRANCHES と同順。label＋2行の短縮表現。make_shindan が描く）
const TYPE_D_CARD_BLOCKS = [
  ['余り0', ['直感で決める人', '最初に思いつく方が正解']],
  ['余り1', ['段取りで決める人', '準備するほど力が伸びる']],
  ['余り2', ['空気で決める人', '言葉にしなくても読める']],
];

/** 型A（朝・暦フック型）。逆張り＋行動宣言＋（問い or 絵文字CTA）が返信を生む。
 *  但し書き・行動・問いは暦ごとの定石辞書（TYPE_A_FLOW）から引くので、
 *  「一粒万倍日なのに静かに過ごす」類の意味矛盾は構造的に起こらない（R社長指摘対応）。
 *  variant: 'question'（問いかけ・既定）/ 'emoji'（絵文字リアクション）。
 *  カードは既定 window=None, emoji=None（時刻・絵文字指示を出さない）。 */
function buildTypeA(dateStr, facts, r, opts = {}) {
  const variant = opts.variant || 'question';
  const [y, m, d] = dateStr.split('-').map(Number);
  const items = (facts.typeAFacts || []).slice(0, 4);
  const primary = items[0];
  const flow = TYPE_A_FLOW[primary] || TYPE_A_FLOW['一粒万倍日'];

  const labels = items.join('×');
  const head = items.length >= 2
    ? [`${m}月${d}日は、`, `${labels}が`, '重なる日。']
    : [`${m}月${d}日は、`, `${items[0]}にあたる日。`];

  const action = flow.actions[Math.floor(r() * flow.actions.length)];

  const lines = [
    ...head,
    '',
    ...items.map(k => `👉 ${k}＝${TYPE_A_MEANINGS[k]}`),
    '',
    flow.caveat,
    '',
    action,
    '',
  ];

  let emoji = null;
  if (variant === 'emoji') {
    emoji = EMOJIS[Math.floor(r() * EMOJIS.length)];
    lines.push(TYPE_A_EMOJI_CTA[Math.floor(r() * TYPE_A_EMOJI_CTA.length)].replace(/\{e\}/g, emoji));
  } else {
    lines.push(flow.question);
  }

  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const cardSpec = {
    template: 'koyomi',
    date_label: `${y}年${m}月${d}日（${wd}）`,
    senjitsu: labels,
    items: items.map(k => `${k}＝${TYPE_A_MEANINGS[k]}`),
  };
  if (emoji) cardSpec.emoji = emoji;
  return { type: 'type_a', tag: 'koyomi', text: lines.join('\n'), cardSpec };
}

/** 型B（昼・12星座＋返信誘導型）。本文3〜4行＋「当たってた？」。 */
function buildTypeB(dateStr, r) {
  const v = TYPE_B_VARIANTS[Math.floor(r() * TYPE_B_VARIANTS.length)];
  const lines = [v[0], '', v[1], '', v[2]];
  const cardSpec = {
    template: 'seiza',
    title: '今日の12星座',
    sub: 'あなたの星座、当たってましたか。',
    words: ZODIAC_LINES.map(([, w]) => w),
  };
  return { type: 'type_b', tag: 'seiza', text: lines.join('\n'), cardSpec };
}

/** 型D（週1・診断ミニ型）。余り診断で「自分の結果を返信したくなる」構造。 */
function buildTypeD(dateStr, r) {
  const lines = [
    '生まれた日を3で割った余りで、',
    'あなたの「決め方」が分かります。',
    '',
    ...TYPE_D_BRANCHES.map(b => `${b.r}＝${b.name}（${b.line}）`),
    '',
    'あなたは、どのタイプでしたか。',
  ];
  // カードは本文の短縮表現（label＋2行）。make_shindan が「余り0」ラベル＋2行で描く。
  const cardSpec = {
    template: 'shindan',
    topic: 'あなたの「決め方」',
    blocks: TYPE_D_BRANCHES.map((b, i) => [b.r, TYPE_D_CARD_BLOCKS[i][1]]),
  };
  return { type: 'type_d', tag: 'shindan', text: lines.join('\n'), cardSpec };
}

/**
 * 1日分の投稿計画（v3・型A/B/D）。slot0=朝(型A暦) / slot1=昼(型B12星座) / slot2=型D(診断)。
 * 型C(自己開示・21時)はR社長の手動ストックのため対象外。
 * 選日モジュールが使えない・暦要素がゼロの日は、型Aを型Bで埋める／従来型へフォールバック。
 */
async function planDay(date, count = 3, recent = [], opts = {}) {
  const [y, m, d] = date.split('-').map(Number);
  const facts = await fetchDayFacts(y, m, d);
  if (!facts) return planDayLegacy(date, count, recent);

  const used = new Set(recent);
  const kinds = ['type_a', 'type_b', 'type_d'];  // slot0/1/2
  const posts = [];
  for (let i = 0; i < Math.min(count, kinds.length); i++) {
    if (kinds[i] === 'type_a' && (!facts.typeAFacts || !facts.typeAFacts.length)) {
      kinds[i] = 'type_b';  // 暦要素ゼロの日は型Aを作れない → 型Bで埋める
    }
    let post = null;
    for (let attempt = 0; attempt < 300; attempt++) {
      const seed = `${date}|${i}|${attempt}`;
      const r = rng(hash(seed));
      const kind = kinds[i];
      const cand = kind === 'type_a'
        ? buildTypeA(date, facts, r, opts)     // opts.variant で絵文字型へ切替可
        : kind === 'type_b'
          ? buildTypeB(date, r)
          : buildTypeD(date, r);
      post = cand;
      if (!used.has(cand.text)) break;
    }
    used.add(post.text);
    posts.push({ ...post, slot: i });
  }
  return posts;
}

// ── 従来型（フォールバック用） ───────────────────────────────────────────

const HOOKS = [
  '正直に言います。', '信じなくていいので、これだけ聞いてください。',
  '今夜だけの話をします。', '今日これを見た人へ。', '先に言っておきます。',
  'これ、見た人だけの話です。', '静かに伝えます。', '一度だけ言います。',
  '当たってたら怖いので、軽く読んでください。', '本当は書くか迷いました。', '', '', '',
];

const CTA_TEMPLATES = [
  '受け取る人は【{e}】を置いていって。',
  '信じる人は【{e}】を置いていってください。',
  '心当たりがある人は【{e}】を。',
  '「{e}」を置いた人から、流れが一つ上に入ります。',
  '当たってる人は【{e}】だけ置いていって。',
  '受け取れる人は【{e}】を。',
  '{e}を置いた人には、もう届いています。',
  'これを自分のことだと思った人は【{e}】を。',
  '{e}を置いてくれた人から順に動き始めます。',
  '思い当たる人は、何も書かずに【{e}】だけ。',
];

function engagementPost(seedStr, avoidTags = []) {
  const r = rng(hash(seedStr));
  const pick = a => a[Math.floor(r() * a.length)];
  let pool = SCENES.filter(s => !avoidTags.includes(s.tag));
  if (!pool.length) pool = SCENES;
  const scene = pool[Math.floor(r() * pool.length)];
  const emoji = pick(EMOJIS);
  const hook = pick(HOOKS);
  const cta = pick(CTA_TEMPLATES).replace(/\{e\}/g, emoji);
  const closer = pick(CLOSERS);
  const lines = [];
  if (hook) { lines.push(hook, ''); }
  lines.push(...scene.lines, '', cta);
  if (closer) lines.push('', closer);
  return { type: 'engagement', tag: scene.tag, emoji, text: lines.join('\n') };
}

const FUNNEL_OPEN = [
  '生年月日だけで、今のあなたの流れを見ます。',
  '今日は無料で数名だけ見ます。',
  '当たってるか試したい人向けの話です。',
  '一人ずつ見るので少人数だけ。',
  '今の状況が知りたい人へ。',
  '無料でやります。今日だけ。',
  '名前と生年月日だけで大丈夫です。',
];
const FUNNEL_HOW = [
  ['気になる人はコメントに{e}を置いていってください。', '順番に見ていきます。'],
  ['「今いちばん気になっていること」を一言添えて', '{e}を置いていってください。'],
  ['生年月日を入れると今の流れが出ます。', 'プロフィールのリンクから無料で見られます。'],
  ['{e}を置いてくれた人から見ていきます。'],
  ['コメントに{e}と、気になっていることを一言だけ。'],
  ['プロフィールのリンクから無料で試せます。', '当たってたら{e}で教えてください。'],
];

function funnelPost(seedStr) {
  const r = rng(hash(seedStr + '|funnel'));
  const pick = a => a[Math.floor(r() * a.length)];
  const emoji = pick(EMOJIS);
  const open = pick(FUNNEL_OPEN);
  const how = pick(FUNNEL_HOW).map(l => l.replace(/\{e\}/g, emoji));
  return { type: 'funnel', tag: 'funnel', emoji, text: [open, '', ...how].join('\n') };
}

/** v1互換（選日モジュール不在時のフォールバック） */
function planDayLegacy(date, count = 3, recent = []) {
  const posts = [];
  const used = new Set(recent);
  const recentTags = [];
  for (let i = 0; i < count; i++) {
    const kind = (i === count - 1 && count > 1) ? 'funnel' : 'engagement';
    let post = null;
    for (let attempt = 0; attempt < 300; attempt++) {
      const seed = `${date}|${i}|${attempt}`;
      const cand = kind === 'funnel' ? funnelPost(seed) : engagementPost(seed, recentTags);
      post = cand;
      if (!used.has(cand.text)) break;
    }
    used.add(post.text);
    if (post.tag !== 'funnel') recentTags.push(post.tag);
    posts.push({ ...post, slot: i });
  }
  return posts;
}

module.exports = { engagementPost, funnelPost, planDay, planDayLegacy, SCENES };
