// src/test-posts-v2.js — 投稿ジェネレータの回帰テスト（型A/B/D・投稿は行わない）
// 実行: node src/test-posts-v2.js  → すべて PASS で exit 0
// （旧T1/T2/T3から型A/B/Dへ置換。ファイル名は歴史的経緯で -v2 のまま）

const { planDay } = require('./threads-posts');

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  OK   ${name}`); }
  else { fail++; console.log(`  NG   ${name}`); }
}

// キャラ設定＋運用者の声を弾く禁止語（返信specと共用）。投稿本文にも同じゲートをかける。
const FORBIDDEN = ['!', '！', '笑', 'よければ', 'どうぞ', '気になりますよね',
  '5種', '5つ', 'まとめて', 'ぜひ', 'お試しください', '参考に',
  '必ず', '絶対', '保証', '霊視', '当たります', '無料', 'URL', 'http'];

async function main() {
  console.log('1. 型A/B/D が3本生成（2026-09-06 三重日）');
  const triple = await planDay('2026-09-06', 3, []);
  ok(triple.length === 3, '3本生成');
  ok(triple[0].type === 'type_a', `slot0=型A（実際: ${triple[0].type}）`);
  ok(triple[1].type === 'type_b', `slot1=型B（実際: ${triple[1].type}）`);
  ok(triple[2].type === 'type_d', `slot2=型D（実際: ${triple[2].type}）`);

  console.log('2. 型A（暦フック）の構造');
  {
    const a = triple[0];
    ok(/👉/.test(a.text), '根拠👉あり');
    ok(a.cardSpec && a.cardSpec.senjitsu.includes('一粒万倍日'), 'cardSpecに暦名');
    ok(/重なる日/.test(a.text), '三重日は「重なる日」');
    console.log('  --- 型A本文 ---'); console.log(a.text.split('\n').map(l => '  ' + l).join('\n'));
  }

  console.log('3. 型B（12星座）の構造');
  {
    const b = triple[1];
    ok(/当たってましたか/.test(b.text), '問い「当たってた？」あり');
    ok(b.cardSpec && Array.isArray(b.cardSpec.words) && b.cardSpec.words.length === 12, `words 12件（${b.cardSpec.words.length}）`);
  }

  console.log('4. 型D（診断）の構造');
  {
    const d = triple[2];
    ok(/余り0/.test(d.text) && /余り1/.test(d.text) && /余り2/.test(d.text), '余り0/1/2分岐あり');
    ok(/どのタイプ/.test(d.text), '問い「どのタイプ？」あり');
  }

  console.log('5. 禁止語が混入しない（通年スポットチェック）');
  {
    let bad = 0;
    for (const day of ['2026-09-06', '2026-09-07', '2026-09-10', '2026-03-05', '2026-01-01', '2026-12-16', '2026-10-01']) {
      const posts = await planDay(day, 3, []);
      for (const p of posts) for (const w of FORBIDDEN) {
        if (p.text.includes(w)) { bad++; console.log(`    混入: ${day} ${p.type} -> ${w}`); }
      }
    }
    ok(bad === 0, `禁止語なし（混入: ${bad}）`);
  }

  console.log('6. 決定性（同じ日は同じ文面）');
  {
    const a = await planDay('2026-09-06', 3, []);
    const b = await planDay('2026-09-06', 3, []);
    ok(a[0].text === b[0].text, '再実行で同一文面');
  }

  console.log('6b. cardSpec が gen_post_cards.py の契約（koyomi/seiza/shindan）に一致');
  {
    const a = triple[0];
    ok(a.cardSpec.template === 'koyomi', `型A template=koyomi（${a.cardSpec.template}）`);
    ok(/^\d{4}年\d{1,2}月\d{1,2}日（[日月火水木金土]）$/.test(a.cardSpec.date_label), `date_label 形式（${a.cardSpec.date_label}）`);
    ok(Array.isArray(a.cardSpec.items) && a.cardSpec.items.every(x => typeof x === 'string' && x.includes('＝')), '型A items は「名＝意味」文字列配列');
    ok(!('window' in a.cardSpec) && !('emoji' in a.cardSpec), '既定は window/emoji なし（時刻・絵文字指示を出さない）');
    const d = triple[2];
    ok(d.cardSpec.template === 'shindan' && Array.isArray(d.cardSpec.blocks) && d.cardSpec.blocks.length === 3, '型D blocks 3件');
    ok(Array.isArray(d.cardSpec.blocks[0][1]) && d.cardSpec.blocks[0][1].length === 2, '型D block=label+2行');
  }

  console.log('6c. 型A絵文字型（variant=emoji）は本文末尾に絵文字CTA＋cardSpec.emojiを付与');
  {
    const em = await planDay('2026-09-06', 3, [], { variant: 'emoji' });
    const a = em[0];
    ok(/【/.test(a.text), '本文末尾に絵文字CTA（【{emoji}】）');
    ok(!/始めたい|予定|思っている/.test(a.text), '問いかけ文は入らない（1投稿＝1反応誘導）');
    ok(typeof a.cardSpec.emoji === 'string', `cardSpec.emoji 付与（${a.cardSpec.emoji}）`);
  }

  console.log('7. 暦要素ゼロの日（2026-09-10 は typeA=[]）は型Bで埋める');
  {
    const posts = await planDay('2026-09-10', 3, []);
    ok(posts[0].type === 'type_b', `slot0=型Bにフォールバック（実際: ${posts[0].type}）`);
  }

  console.log('8. 通年で未定義値・破綻が出ない（型A/B/Dすべて）');
  {
    let broken = 0;
    for (let m = 1; m <= 12; m++) {
      const dim = new Date(Date.UTC(2026, m, 0)).getUTCDate();
      for (let d = 1; d <= dim; d++) {
        const day = `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const posts = await planDay(day, 3, []);
        for (const p of posts) {
          if (!p.text || /undefined|NaN|null/.test(p.text)) broken++;
        }
      }
    }
    ok(broken === 0, `通年で破綻なし（破綻: ${broken}）`);
  }

  console.log(`\n結果: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
