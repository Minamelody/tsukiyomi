// Threads投稿ジェネレータ。
// 参考画像（runa_no_uranai）の「絵文字を置いていって」型を踏襲する。
//
// 効いている構造:
//   1) 短い。3〜4行で読み切れる
//   2) 「あなた」個人に向けた予言に見える（一般論・星座の話は刺さらない）
//   3) 反応のハードルが最低（絵文字1つ置くだけ）→ コメントが伸びる
//   4) コメントが伸びる → アルゴリズムに乗る → 表示が伸びる
//
// 設計方針（sssatankai の指摘を反映）:
//   星座を前面に出さない。**具体的な悩みの場面**を名指しする。
//   「会いたかったあの人にもうすぐ会える」のように、読んだ人が
//   自分の状況だと思える固有のシーンを描く。
//
// 重要: 同一文面の量産はシャドウバン対象。組み合わせで大量のバリエーションを作る。

// ─────────────────────────────────────────────
// SCENES: 悩みの「場面」ごとの本文。
// 読んだ人が「自分のことだ」と思える具体性を優先する。
// tag は投稿の偏り防止用（同じ悩みを連投しない）。
// ─────────────────────────────────────────────
const SCENES = [
  // ── 再会・復縁 ──
  { tag: 'reunion', lines: ['あなたが会いたかったあの人に、', 'もうすぐ会えます。'] },
  { tag: 'reunion', lines: ['もう終わったと思っていた縁が、', '向こうから戻ってきます。'] },
  { tag: 'reunion', lines: ['名前を思い出した人がいるなら、', 'その人からもうすぐ動きがあります。'] },
  { tag: 'reunion', lines: ['連絡が来ないのは、', '終わったからではありません。', 'まだ言葉が見つかっていないだけです。'] },
  { tag: 'reunion', lines: ['あの人は、あなたのことを', 'まだ一度も忘れていません。'] },
  { tag: 'reunion', lines: ['既読のまま止まっている画面。', 'あれは、あと少しで動きます。'] },
  { tag: 'reunion', lines: ['さよならを言えなかった相手と、', 'もう一度話す機会が来ます。'] },
  { tag: 'reunion', lines: ['あなたが諦めた連絡先。', '消さないでおいてください。'] },

  // ── 片思い・関係の進展 ──
  { tag: 'love', lines: ['伝えられなかった気持ち、', '来週あたりに言える流れが来ます。'] },
  { tag: 'love', lines: ['あなたが「無理だ」と思っている相手。', '相手はそう思っていません。'] },
  { tag: 'love', lines: ['好きだと気づかれたくない人に、', 'もう気づかれています。'] },
  { tag: 'love', lines: ['あなたが選ばれないと思ってる場面で、', '実はあなたが最初に名前を出されています。'] },
  { tag: 'love', lines: ['何気ない連絡が1つ来ます。', 'あれを見逃さないでください。'] },
  { tag: 'love', lines: ['今の関係、動かないように見えて', '相手の方が先に限界を迎えます。'] },

  // ── 我慢・報われなさ ──
  { tag: 'endure', lines: ['あなたが我慢して飲み込んだ言葉、', '無駄になっていません。'] },
  { tag: 'endure', lines: ['誰にも気づかれてないと思ってること。', 'ちゃんと見てる人がいます。'] },
  { tag: 'endure', lines: ['「私ばっかり」と思ってた時間の分が、', 'そろそろ返ってきます。'] },
  { tag: 'endure', lines: ['一人で抱えてたこと、', '来月には話せる相手が現れます。'] },
  { tag: 'endure', lines: ['あなたが黙って直してきたこと。', '気づいてた人が動き出します。'] },
  { tag: 'endure', lines: ['報われないと思ってた努力の、', '結果が出るのは急にです。'] },

  // ── 停滞・動き出し ──
  { tag: 'move', lines: ['ずっと止まってた何かが、', '今夜から静かに動き出す人がいます。'] },
  { tag: 'move', lines: ['何も変わらないと思ってた毎日に、', '3日以内に切れ目が入ります。'] },
  { tag: 'move', lines: ['あなたが降りようとしていた場所。', 'あと一回だけ待ってください。'] },
  { tag: 'move', lines: ['止まっていたのは、', 'タイミングが揃うのを待っていたからです。'] },
  { tag: 'move', lines: ['近いうちに、大きく状況が動きます。'] },
  { tag: 'move', lines: ['同じ場所にいるように見えて、', 'あなたはもう半分抜け出しています。'] },

  // ── 諦め・手放し ──
  { tag: 'giveup', lines: ['あなたが諦めかけてたこと、', '実はまだ、終わってません。'] },
  { tag: 'giveup', lines: ['選ばなかった道は、', 'まだ閉じていません。'] },
  { tag: 'giveup', lines: ['もう遅いと思っていること。', '期限はまだ来ていません。'] },
  { tag: 'giveup', lines: ['手放した方がいいと言われたもの。', 'あれはまだ持っていていいです。'] },
  { tag: 'giveup', lines: ['今かかっている重さは、', '手放す直前だからこそ出るものです。'] },

  // ── 仕事・進路 ──
  { tag: 'work', lines: ['辞めようか迷っている人。', '答えは来月の半ばに出ます。'] },
  { tag: 'work', lines: ['評価されていないと感じている場所で、', 'あなたの名前が上がっています。'] },
  { tag: 'work', lines: ['今の環境が合わないと感じるのは、', 'あなたが次に進む準備ができたからです。'] },
  { tag: 'work', lines: ['声をかけられる話が来ます。', '断る前に一度だけ聞いてください。'] },
  { tag: 'work', lines: ['向いていないと思ってることの中に、', 'あなたが一番強い部分があります。'] },
  { tag: 'work', lines: ['頑張り方を、そろそろ変えていい時期です。'] },

  // ── お金 ──
  { tag: 'money', lines: ['出ていくばかりだった流れが、', '入る方に切り替わります。'] },
  { tag: 'money', lines: ['諦めた金額が、', '別の形で戻ってくる人がいます。'] },
  { tag: 'money', lines: ['今月の後半、想定していなかった入りがあります。'] },
  { tag: 'money', lines: ['減らすことばかり考えていた人。', 'そこはもう十分です。'] },

  // ── 人間関係・離れる縁 ──
  { tag: 'relation', lines: ['離れていく人がいます。', 'それは失うのではなく、席が空くだけです。'] },
  { tag: 'relation', lines: ['合わないと感じていた相手と、', '距離を置いていい時期に入りました。'] },
  { tag: 'relation', lines: ['あなたを軽く扱う人の影響力が、', 'これから急に弱まります。'] },
  { tag: 'relation', lines: ['言い返せなかった相手のこと。', 'あなたが動かなくても状況が変わります。'] },
  { tag: 'relation', lines: ['新しく入ってくる人がいます。', '思っているより早く会います。'] },

  // ── 自分・疲れ ──
  { tag: 'self', lines: ['ちゃんとやれてないと思ってる人。', '見えてないだけで、進んでます。'] },
  { tag: 'self', lines: ['疲れているのは弱さではなく、', 'ずっと踏ん張ってきたからです。'] },
  { tag: 'self', lines: ['自分だけ遅れていると思っている人。', '順番が違うだけです。'] },
  { tag: 'self', lines: ['今夜、眠れない人がいるなら。', 'その考えごとは明日には軽くなります。'] },
  { tag: 'self', lines: ['あなたが変わりたいと思った日から、', 'もう始まっています。'] },
  { tag: 'self', lines: ['決めきれないのは、', 'まだ材料が揃ってないだけです。'] },

  // ── 予兆・合図 ──
  { tag: 'sign', lines: ['流れが変わる合図は、', 'いつも小さく静かに来ます。'] },
  { tag: 'sign', lines: ['ここ数日、同じ数字を見た人。', 'あれは切り替わりの印です。'] },
  { tag: 'sign', lines: ['急に昔のことを思い出したなら、', 'それは片付く順番が来たからです。'] },
  { tag: 'sign', lines: ['今日ふと嫌な予感がした人。', '避けられる範囲のものです。'] },
];

// 冒頭のフック（無くても成立するので空を混ぜる）
const HOOKS = [
  '正直に言います。',
  '信じなくていいので、これだけ聞いてください。',
  '今夜だけの話をします。',
  '今日これを見た人へ。',
  '先に言っておきます。',
  'これ、見た人だけの話です。',
  '静かに伝えます。',
  '一度だけ言います。',
  '当たってたら怖いので、軽く読んでください。',
  '本当は書くか迷いました。',
  '',
  '',
  '',
];

// 絵文字を置かせるCTA。{e} に絵文字が入る
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

const EMOJIS = ['🐉', '🌙', '✨', '🔑', '🌸', '⭐️', '🕊', '🌊', '🍀', '💫'];

// 締めの一言（安心を渡して読後感を良くする）
const CLOSERS = [
  '大丈夫、ちゃんと来てるから。',
  'あなたは間に合っています。',
  '焦らなくて大丈夫です。',
  'ちゃんと見えてます。',
  '順番は守られます。',
  'もう少しだけ、待てば足ります。',
  '',
  '',
  '',
  '',
];

function rng(seed) {
  let x = seed || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * 悩みに当てる「絵文字置き型」投稿を生成する（メインの型）
 * @param {string} seedStr
 * @param {string[]} avoidTags 直近で使った悩みタグ（連投を避ける）
 */
function engagementPost(seedStr, avoidTags = []) {
  const r = rng(hash(seedStr));
  const pick = a => a[Math.floor(r() * a.length)];

  // 直近と同じ悩みジャンルを避ける
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

/**
 * 無料鑑定への誘導投稿（変換用・頻度は低く保つ）
 */
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

/**
 * 1日分の投稿計画。
 * 絵文字置き型を主軸にし、1日1回だけ誘導を混ぜる。
 * recent に過去の本文を渡すと重複を回避する（シャドウバン対策・必須）。
 */
function planDay(date, count = 3, recent = []) {
  const posts = [];
  const used = new Set(recent);
  const recentTags = [];
  for (let i = 0; i < count; i++) {
    // 最後の1枠だけ誘導。それ以外は悩みに当てる投稿
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

module.exports = { engagementPost, funnelPost, planDay, SCENES };
