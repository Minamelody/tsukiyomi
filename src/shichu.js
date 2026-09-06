// 四柱推命エンジン（年柱・月柱・日柱を算出）。
// 十干十二支・五行・十二運を用いて命式を組む。
// 日柱の干支は基準日からの通日で求める（生時未入力が前提なので時柱は省略）。

const KAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const SHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

// 十干の五行と陰陽
const KAN_INFO = {
  甲: { element: '木', yin: false, image: '大樹', trait: 'まっすぐ伸びる。曲げられるのを嫌う' },
  乙: { element: '木', yin: true, image: '草花', trait: 'しなやかに合わせる。折れずに残る' },
  丙: { element: '火', yin: false, image: '太陽', trait: '明るく開放的。隠し事が苦手' },
  丁: { element: '火', yin: true, image: '灯火', trait: '内に熱を持つ。一点を照らす' },
  戊: { element: '土', yin: false, image: '山', trait: '動かない安定感。腰が重い' },
  己: { element: '土', yin: true, image: '田畑', trait: '受け入れて育てる。世話役になる' },
  庚: { element: '金', yin: false, image: '刀剣', trait: '切り分ける決断力。角が立つ' },
  辛: { element: '金', yin: true, image: '宝石', trait: '繊細で美意識が高い。傷つきやすい' },
  壬: { element: '水', yin: false, image: '大河', trait: '流れて広がる。型に収まらない' },
  癸: { element: '水', yin: true, image: '雨露', trait: '静かに染み込む。察知力が高い' },
};

const SHI_INFO = {
  子: { element: '水', trait: '知恵と繁殖。夜に強い' }, 丑: { element: '土', trait: '忍耐と蓄積' },
  寅: { element: '木', trait: '行動開始。勢いがある' }, 卯: { element: '木', trait: '社交と成長' },
  辰: { element: '土', trait: '理想と変化。器が大きい' }, 巳: { element: '火', trait: '執念と知略' },
  午: { element: '火', trait: '華やかさと拡散' }, 未: { element: '土', trait: '穏やかさと調整' },
  申: { element: '金', trait: '機転と器用さ' }, 酉: { element: '金', trait: '完成と美意識' },
  戌: { element: '土', trait: '忠実と守り' }, 亥: { element: '水', trait: '包容と直感' },
};

// 五行の相性
const SEI = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' };   // 相生（生む）
const KOKU = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' };  // 相剋（抑える）

const ELEMENT_BALANCE = {
  木: '伸びる力。計画と成長を担う',
  火: '広げる力。表現と情熱を担う',
  土: '支える力。安定と信頼を担う',
  金: '定める力。決断と規律を担う',
  水: '流す力。知恵と柔軟性を担う',
};

function daysFromEpoch(y, m, d) {
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/**
 * 四柱推命の命式を出す。
 * @param {string} birthday 'YYYY-MM-DD'
 */
function shichuMeishiki(birthday) {
  const [y, m, d] = birthday.split('-').map(Number);

  // 年柱: 立春を境にするのが本式だが、簡易に1月1日区切りとする（2月4日以前は前年扱い）
  let yy = y;
  if (m === 1 || (m === 2 && d <= 3)) yy = y - 1;
  const yKan = KAN[((yy - 4) % 10 + 10) % 10];
  const yShi = SHI[((yy - 4) % 12 + 12) % 12];

  // 月柱: 節入りを月初として簡易計算。月支は寅=2月から順に割り当て
  const mShiIdx = ((m - 2) % 12 + 12) % 12;  // 2月→寅(index 2)基準に補正
  const mShi = SHI[(mShiIdx + 2) % 12];
  // 月干は年干から導く（五虎遁）
  const yKanIdx = KAN.indexOf(yKan);
  const mKanStart = [2, 4, 6, 8, 0][yKanIdx % 5];
  const mKan = KAN[(mKanStart + ((m - 2) % 12 + 12) % 12) % 10];

  // 日柱: 1900-01-01 が甲戌の日という基準を使う
  const base = daysFromEpoch(1900, 1, 1);
  const diff = daysFromEpoch(y, m, d) - base;
  const dKan = KAN[((diff + 0) % 10 + 10) % 10];
  const dShi = SHI[((diff + 10) % 12 + 12) % 12];

  // 五行のバランスを数える
  const counts = { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 };
  for (const k of [yKan, mKan, dKan]) counts[KAN_INFO[k].element]++;
  for (const s of [yShi, mShi, dShi]) counts[SHI_INFO[s].element]++;

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const strongest = sorted[0][0];
  const missing = Object.entries(counts).filter(([, v]) => v === 0).map(([k]) => k);

  const nikkan = KAN_INFO[dKan];  // 日干＝本人の本質

  return {
    pillars: {
      年柱: { kan: yKan, shi: yShi, label: `${yKan}${yShi}` },
      月柱: { kan: mKan, shi: mShi, label: `${mKan}${mShi}` },
      日柱: { kan: dKan, shi: dShi, label: `${dKan}${dShi}` },
    },
    nikkan: { kan: dKan, ...nikkan },
    elements: counts,
    strongest,
    missing,
    balance: {
      strongestMeaning: ELEMENT_BALANCE[strongest],
      supports: SEI[nikkan.element],       // 自分を助ける五行
      drains: KOKU[nikkan.element],        // 自分が抑える五行
      weakenedBy: Object.entries(KOKU).find(([, v]) => v === nikkan.element)?.[0], // 自分を抑える五行
    },
  };
}

module.exports = { shichuMeishiki, KAN, SHI, KAN_INFO, SHI_INFO };
