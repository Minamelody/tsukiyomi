// 5種類の占いを統合し、それぞれ「無料の浅い診断」と「有料の深い鑑定」を返す。
//
// 商品設計:
//   単品 ¥3,000 × 5種 = ¥15,000相当 → セット ¥10,000（33%オフ）
//
// 無料パートは「当たっている」と思わせる具体性を出すが、
// 結論と対処法は有料パートに置く。

const { diagnose } = require('./fortune');
const { seimeiHandan } = require('./seimei');
const { shichuMeishiki } = require('./shichu');
const { draw3 } = require('./tarot');
const { horoscope } = require('./astro');
const { generateReading, isConfigured } = require('./llm');

const PRICE_SINGLE = 3000;
const PRICE_BUNDLE = 10000;

const TYPES = [
  { id: 'seimei', name: '姓名判断', icon: '筆', needs: ['sei', 'mei'], desc: '名前の画数から五格を出し、生涯の傾向を読みます' },
  { id: 'seiza', name: '星座占い', icon: '星', needs: ['birthday'], desc: '星座とエレメントから今日の運勢を読みます' },
  { id: 'tarot', name: 'タロット', icon: '札', needs: ['birthday'], desc: '大アルカナ3枚で過去・現在・未来を読みます' },
  { id: 'shichu', name: '四柱推命', icon: '命', needs: ['birthday'], desc: '生年月日から命式を組み、本質と五行の偏りを読みます' },
  { id: 'astro', name: '西洋占星術', icon: '宮', needs: ['birthday'], desc: '太陽・月・上昇宮の3点から性格の層を読みます' },
];

function trunc(s, n) {
  return s.length <= n ? s : s.slice(0, n) + '……';
}

// ── 姓名判断 ──
function readSeimei(input) {
  const r = seimeiHandan(input.sei, input.mei);
  if (!r) return { available: false, reason: '姓と名の入力が必要です' };
  if (r.error === 'unknown_strokes') {
    // 画数が確定できない字は推定しない（間違った五格で鑑定を出さないため）
    return { available: false,
             reason: `画数を確定できない文字が含まれています: ${r.chars.join('・')}。`
                   + `別の字体でご入力いただくか、トークルームでお知らせください。` };
  }
  const k = r.kaku;
  const goodCount = Object.values(k).filter(v => (v.luck || '').includes('吉')).length;
  // 霊数の補正対象（一字姓・一字名のときだけ値を持つ）。個別注記に使う。
  // 姓→天格・名→地格が出し分け（図版の注記と同じ規則）。
  // NOTE: 注記は paid.note として sections とは独立に持つ。本番はLLMが sections を
  // 丸ごと差し替えるため、sections 内に埋めるとLLM経路で消える（実測済み）。
  const rei = r.reisu || [];
  const reiLabel = rei.join('・');
  const reiAff = rei.map(s => s === '姓' ? '天格' : '地格').join('・');
  const reiNote = reiLabel ? `※${reiLabel}が一字のため、霊数1を補って${reiAff}を算出しています（総格には含めません）。` : '';
  return {
    available: true,
    free: {
      summary: `${r.sei}${r.mei}さん — 総格${k.総格.n}画。五格のうち${goodCount}つが吉数です。`,
      points: [
        `人格（性格の中心）: ${k.人格.n}画 ${k.人格.luck}`,
        `総格（生涯運）: ${k.総格.n}画 ${k.総格.luck}`,
      ],
      teaser: `人格${k.人格.n}画は「${trunc(k.人格.meaning, 12)}」の傾向。詳しくは深掘り鑑定で。`,
    },
    paid: {
      title: '姓名判断 詳細鑑定',
      note: reiNote,
      sections: [
        { h: '五格すべての判定', body: Object.entries(k).map(([name, v]) => `${name} ${v.n}画（${v.luck}）— ${v.meaning}`).join('\n') },
        { h: '画数の内訳', body: `姓: ${r.strokes.sei.join(' + ')} = ${r.strokes.sei.reduce((a, b) => a + b, 0)}画\n名: ${r.strokes.mei.join(' + ')} = ${r.strokes.mei.reduce((a, b) => a + b, 0)}画` },
        { h: 'あなたの中心にあるもの', body: `人格${k.人格.n}画（${k.人格.luck}）が示すのは「${k.人格.meaning}」です。これは他人から見える顔ではなく、判断の癖として出ます。迷った時にどちらを選ぶかがここで決まります。` },
        { h: '対人関係の出方', body: `外格${k.外格.n}画（${k.外格.luck}）— ${k.外格.meaning}。これは環境や周囲との関わりに表れる部分です。${(k.外格.luck || '').includes('吉') ? '人に恵まれる配置なので、迷ったら人に相談する方が早く解決します。' : '一人で抱えやすい配置です。意識して外に出す習慣を作ると流れが変わります。'}` },
        { h: '生涯の流れ', body: `総格${k.総格.n}画（${k.総格.luck}）— ${k.総格.meaning}。${(k.地格.luck || '').includes('吉') ? `地格${k.地格.n}画も吉数なので、若い時期に築いたものが後半を支えます。` : `地格${k.地格.n}画は${k.地格.luck}のため、前半の苦労が後半の土台になる形です。`}` },
      ],
    },
  };
}

// ── 星座占い（既存の鑑定エンジンを利用） ──
function readSeiza(input) {
  const d = diagnose({ name: input.name || input.mei, birthday: input.birthday, question: input.question, date: input.date });
  return {
    available: true,
    free: {
      summary: `${d.meta.sign}・${d.meta.element}のエレメント / ${d.meta.animal}年 — 今日の総合運 ${d.scores.total}点（${d.tone}）`,
      points: [d.free.headline, d.free.body],
      scores: d.scores,
      lucky: d.lucky,
      teaser: `${d.deep.topicLabel}の深層と、今日打つべき一手は深掘り鑑定で。`,
    },
    paid: {
      title: '星座占い 詳細鑑定',
      sections: [
        { h: 'あなたの本質', body: d.deep.character },
        { h: `${d.deep.topicLabel}の深層 — ${d.deep.topicScore}点`, body: d.deep.reading },
        { h: '今日打つべき一手', body: d.deep.action },
        { h: '避けたいこと', body: d.deep.avoid },
        { h: '今後3か月の流れ', body: d.deep.flow },
        ...(d.deep.answer ? [{ h: 'あなたのご相談へ', body: d.deep.answer }] : []),
        { h: 'ラッキーアクション', body: `${d.lucky.action}。出かけるなら${d.lucky.place}へ。カラーは${d.lucky.color}、アイテムは${d.lucky.item}、数字は${d.lucky.number}。` },
      ],
    },
  };
}

// ── タロット ──
function readTarot(input) {
  const seed = `${input.name || ''}|${input.birthday}|${input.date}|${input.question || ''}`;
  const cards = draw3(seed);
  const [past, now, future] = cards;
  return {
    available: true,
    free: {
      summary: `3枚引き — ${cards.map(c => `${c.card}(${c.orientation})`).join(' / ')}`,
      points: [
        `現在: ${now.card}（${now.orientation}）`,
        now.meaning,
      ],
      cards: cards.map(c => ({ position: c.position, card: c.card, orientation: c.orientation })),
      teaser: `未来の位置には「${future.card}（${future.orientation}）」が出ています。読み解きは深掘り鑑定で。`,
    },
    paid: {
      title: 'タロット 詳細鑑定',
      sections: [
        ...cards.map(c => ({
          h: `${c.position} — ${c.card}（${c.orientation}）`,
          body: `${c.positionMeaning}。\n${c.meaning}`,
        })),
        {
          h: '3枚の流れをつなぐと', body:
            `${past.card}（${past.orientation}）から始まった流れが、いま${now.card}（${now.orientation}）の状態にあり、${future.card}（${future.orientation}）へ向かっています。` +
            (future.reversed
              ? `未来が逆位置なので、このまま何もしなければ引っかかりが残ります。${now.reversed ? '現在も逆位置なので、まず今の停滞を認めるところからです。' : '現在は正位置なので、いまの勢いを持続させる工夫が鍵になります。'}`
              : `未来が正位置なので、流れ自体は良い方に向いています。${now.reversed ? '現在の逆位置は通過点です。ここで諦めないことが条件になります。' : '現在も正位置なので、余計なことをしないのが最善手です。'}`),
        },
        {
          h: 'いま取るべき行動', body: future.reversed
            ? `${future.card}の逆位置を正位置に転じるには、${now.card}が示す「${trunc(now.meaning, 20)}」の課題を先に片づける必要があります。順番を飛ばさないでください。`
            : `${future.card}の正位置を引き寄せるには、いまの状態を維持しながら小さく前に出ることです。大きく動く必要はありません。`,
        },
      ],
    },
  };
}

// ── 四柱推命 ──
function readShichu(input) {
  const m = shichuMeishiki(input.birthday);
  const p = m.pillars;
  return {
    available: true,
    free: {
      summary: `命式 ${p.年柱.label} / ${p.月柱.label} / ${p.日柱.label} — 日干は${m.nikkan.kan}（${m.nikkan.element}・${m.nikkan.image}）`,
      points: [
        `あなたの本質: ${m.nikkan.trait}`,
        `五行で最も強いのは「${m.strongest}」${m.missing.length ? `、欠けているのは「${m.missing.join('・')}」` : ''}`,
      ],
      elements: m.elements,
      teaser: `${m.missing.length ? `${m.missing.join('・')}が欠けている影響と補い方は` : '五行の偏りが生む癖と対処は'}深掘り鑑定で。`,
    },
    paid: {
      title: '四柱推命 詳細鑑定',
      sections: [
        { h: '命式', body: `年柱 ${p.年柱.label}（家系・生まれ持った環境）\n月柱 ${p.月柱.label}（社会性・仕事運）\n日柱 ${p.日柱.label}（本人・内面）\n\n※出生時刻がないため時柱は省略しています` },
        { h: `日干「${m.nikkan.kan}」— あなたの本質`, body: `${m.nikkan.element}の${m.nikkan.yin ? '陰' : '陽'}、${m.nikkan.image}に例えられます。${m.nikkan.trait}。\nこれは努力で変えるものではなく、前提として扱う部分です。合わない環境に長くいると消耗が早いのはここが原因です。` },
        { h: '五行のバランス', body: `${Object.entries(m.elements).map(([k, v]) => `${k}: ${'●'.repeat(v) || '—'} ${v}`).join('\n')}\n\n最も強いのは「${m.strongest}」— ${m.balance.strongestMeaning}。${m.missing.length ? `\n欠けているのは「${m.missing.join('・')}」です。これは能力の欠損ではなく、意識しないと使わない領域という意味です。` : '\n大きな欠けがなく、バランスの取れた配置です。'}` },
        { h: '力を得る方向と消耗する方向', body: `あなた（${m.nikkan.element}）を助けるのは「${m.balance.supports}」の性質を持つ人・環境です。\n逆に「${m.balance.weakenedBy}」が強い場所では力が削られます。\nあなたが抑える立場になるのは「${m.balance.drains}」です。ここでは主導権を取れます。` },
        { h: '運の使い方', body: `${m.missing.length ? `${m.missing[0]}を意識的に取り入れると流れが整います。${m.missing[0] === '金' ? '決断と区切りをつけること、不要なものを手放すことです。' : m.missing[0] === '水' ? '休息と情報収集、柔軟に方針を変えることです。' : m.missing[0] === '木' ? '計画を立てて育てること、新しく始めることです。' : m.missing[0] === '火' ? '人前に出ること、感情を表現することです。' : '土台を固めること、安定した習慣を作ることです。'}` : `強い「${m.strongest}」を活かす場所を選ぶことが最短です。`}` },
      ],
    },
  };
}

// ── 西洋占星術 ──
function readAstro(input) {
  const h = horoscope(input.birthday);
  return {
    available: true,
    free: {
      summary: `太陽 ${h.sun.name} / 月 ${h.moon.name} / 上昇宮 ${h.ascendant.name} — 優勢エレメントは${h.dominantElement}`,
      points: [
        `太陽星座（本質）: ${h.sun.meaning}`,
      ],
      teaser: `月星座${h.moon.name}が示す感情の癖と、周囲から見えるあなたの姿は深掘り鑑定で。`,
    },
    paid: {
      title: '西洋占星術 詳細鑑定',
      sections: [
        { h: `太陽 ${h.sun.name}（${h.sun.element}・支配星${h.sun.ruler}）— 本質`, body: `キーワードは「${h.sun.keyword}」。\n${h.sun.meaning}。\nこれは人生の方向性を決める部分で、ここに逆らう選択をすると理由のない疲れが出ます。` },
        { h: `月 ${h.moon.name}（${h.moon.element}）— 感情の癖`, body: `${h.moon.meaning}。\n月星座は素の反応が出る場所です。人に見せない部分なので、ここが分かると自分の機嫌の取り方が分かります。${h.sun.element === h.moon.element ? `太陽と月が同じ${h.sun.element}なので、感情と目的が一致していて迷いが少ない配置です。` : `太陽（${h.sun.element}）と月（${h.moon.element}）が違うため、やりたいことと感情がずれる瞬間があります。それは矛盾ではなく二層構造です。`}` },
        { h: `上昇宮 ${h.ascendant.name} — 周囲から見えるあなた`, body: `${h.ascendant.meaning}。\n第一印象と本質がずれるのはよくあることで、${h.sun.name === h.ascendant.name ? '今回は太陽と一致しているので、見た目と中身が近いタイプです。' : 'あなたの場合は太陽星座と違うので、「思っていた人と違った」と言われることがあります。'}\n\n${h.ascendant.note}` },
        { h: '3点をまとめると', body: `優勢なエレメントは「${h.dominantElement}」です。${h.dominantElement === '火' ? '動くことで整うタイプ。考える前に一歩出した方が結果が良くなります。' : h.dominantElement === '地' ? '形にすることで安心するタイプ。手触りのある成果が必要です。' : h.dominantElement === '風' ? '言葉と情報で整うタイプ。人と話すことが解決策になります。' : '感じることで整うタイプ。理屈より納得感を優先して構いません。'}` },
      ],
    },
  };
}

const READERS = { seimei: readSeimei, seiza: readSeiza, tarot: readTarot, shichu: readShichu, astro: readAstro };

/**
 * 指定した種類の占いを実行する。
 * @param {string} type TYPES の id
 * @param {object} input { name, sei, mei, birthday, gender, question, date }
 */
function read(type, input) {
  const reader = READERS[type];
  if (!reader) throw new Error(`unknown type: ${type}`);
  const date = input.date || new Date().toISOString().slice(0, 10);
  return { type, ...TYPES.find(t => t.id === type), ...reader({ ...input, date }) };
}

/** 全種類の無料パートをまとめて返す（一覧表示用） */
function readAll(input) {
  return TYPES.map(t => {
    try { return read(t.id, input); }
    catch (e) { return { type: t.id, ...t, available: false, reason: e.message }; }
  });
}

// ─────────────────────────────────────────────
// 有料パートのLLM生成。
// 計算結果（facts）は必ずコード側で確定させ、LLMは言語化のみ担当する。
// 生成に失敗・ポリシー違反ならルールベースの本文をそのまま使う。
// ─────────────────────────────────────────────

/** 種目ごとに、LLMへ渡す確定事実と見出しを組み立てる */
function factsFor(type, input, base) {
  const date = input.date || new Date().toISOString().slice(0, 10);
  if (type === 'seimei') {
    const r = seimeiHandan(input.sei, input.mei);
    if (!r || r.error) return null;
    return {
      facts: {
        姓名: `${r.sei}${r.mei}`,
        画数: { 姓: r.strokes.sei, 名: r.strokes.mei },
        五格: Object.fromEntries(Object.entries(r.kaku).map(([k, v]) => [k, `${v.n}画 ${v.luck}（${v.meaning}）`])),
        霊数補正: (r.reisu || []).join('・'),
      },
      titles: ['五格それぞれの意味', 'あなたの性格の中心にあるもの', '対人関係での出方', '生涯の運の流れ', '今後の指針'],
    };
  }
  if (type === 'seiza') {
    const d = diagnose({ name: input.name || input.mei, birthday: input.birthday, question: input.question, date });
    return {
      facts: {
        星座: d.meta.sign, エレメント: d.meta.element, 十二支: d.meta.animal, ライフパス: d.meta.lifePath,
        今日の運勢スコア: d.scores, 悩みのジャンル: d.meta.topicLabel,
        ラッキー要素: d.lucky,
      },
      titles: ['あなたの本質', `${d.meta.topicLabel}の深層`, '今日打つべき一手', '避けたいこと', '今後3か月の流れ', ...(input.question ? ['ご相談への回答'] : [])],
    };
  }
  if (type === 'tarot') {
    const cards = draw3(`${input.name || ''}|${input.birthday}|${date}|${input.question || ''}`);
    return {
      facts: {
        引いたカード: cards.map(c => ({ 位置: c.position, カード: c.card, 正逆: c.orientation, 意味: c.meaning })),
      },
      titles: ['過去のカードが示すもの', '現在のカードが示すもの', '未来のカードが示すもの', '3枚の流れをつなぐと', 'いま取るべき行動'],
    };
  }
  if (type === 'shichu') {
    const m = shichuMeishiki(input.birthday);
    return {
      facts: {
        命式: { 年柱: m.pillars.年柱.label, 月柱: m.pillars.月柱.label, 日柱: m.pillars.日柱.label },
        日干: `${m.nikkan.kan}（${m.nikkan.element}・${m.nikkan.image}）`,
        日干の性質: m.nikkan.trait,
        五行バランス: m.elements, 最も強い五行: m.strongest, 欠けている五行: m.missing,
        自分を助ける五行: m.balance.supports, 自分を抑える五行: m.balance.weakenedBy,
        注記: '出生時刻が不明なため時柱は算出していません',
      },
      titles: ['命式が示すあなたの土台', '日干から見る本質', '五行の偏りが生む癖', '力を得る環境と消耗する環境', '運の使い方'],
    };
  }
  if (type === 'astro') {
    const h = horoscope(input.birthday);
    return {
      facts: {
        太陽星座: `${h.sun.name}（${h.sun.element}・支配星${h.sun.ruler}・${h.sun.keyword}）`,
        月星座: `${h.moon.name}（${h.moon.element}）`,
        上昇宮: `${h.ascendant.name}（${h.ascendant.element}）`,
        優勢エレメント: h.dominantElement,
        注記: '出生時刻が不明なため上昇宮は生年月日からの推定値です',
      },
      titles: ['太陽星座が示す本質', '月星座が示す感情の癖', '上昇宮と周囲から見えるあなた', '3点をまとめた総合的な読み'],
    };
  }
  return null;
}

/**
 * 有料パートをLLMで生成して差し替える。
 * @returns {Promise<object>} read() と同じ形。paid.sections がLLM生成に置き換わる
 */
async function readWithLLM(type, input) {
  const base = read(type, input);
  if (!base.available || !base.paid) return base;
  if (!isConfigured()) return { ...base, paid: { ...base.paid, generatedBy: 'rules' } };

  const f = factsFor(type, input, base);
  // facts はPDFの図版生成に使うので、LLMの成否に関わらず必ず返す。
  if (!f) return { ...base, paid: { ...base.paid, generatedBy: 'rules' } };

  const withFacts = { ...base, facts: f.facts };

  const gen = await generateReading({
    typeName: base.name,
    facts: f.facts,
    sectionTitles: f.titles,
    question: input.question,
    cacheOn: `${input.sei || ''}${input.mei || ''}|${input.birthday}|${input.date || ''}`,
  });

  if (!gen) return { ...withFacts, paid: { ...base.paid, generatedBy: 'rules' } };
  return {
    ...withFacts,
    // note（霊数の個別注記など計算の事実）は LLM の成否に関わらず必ず引き継ぐ。
    // sections はLLM生成で置き換わるが、note は生成結果に依存しない確定値。
    paid: { title: base.paid.title, sections: gen.sections, note: base.paid.note || '', generatedBy: gen.generatedBy },
  };
}

module.exports = { read, readAll, readWithLLM, factsFor, TYPES, PRICE_SINGLE, PRICE_BUNDLE };
