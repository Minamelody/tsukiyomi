// src/test-posts-v2.js — 投稿ジェネレータv2の回帰テスト（投稿は行わない）
// 実行: node src/test-posts-v2.js  → すべて PASS で exit 0

const { planDay } = require('./threads-posts');

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  OK   ${name}`); }
  else { fail++; console.log(`  NG   ${name}`); }
}

function maxLineLen(text) {
  let mx = 0;
  for (const line of text.split('\n')) mx = Math.max(mx, [...line].length);
  return mx;
}

async function main() {
  console.log('1. T1対象日（useT1=true: 2026-09-06 3種重なり）');
  {
    const posts = await planDay('2026-09-06', 3, []);
    ok(posts.length === 3, '3本生成');
    ok(posts[0].type === 't1', `slot0=T1（実際: ${posts[0].type}）`);
    ok(posts[0].cardSpec && posts[0].cardSpec.senjitsu.includes('一粒万倍日'), 'cardSpecに一粒万倍日');
    ok(posts[0].cardSpec.window_name === '未の刻' && posts[0].cardSpec.window === '13:00〜14:59', `peak_window連携（${posts[0].cardSpec.window_name}/${posts[0].cardSpec.window}）`);
    ok(posts[0].cardSpec.senjitsu.length <= 34, `senjitsu上限34字（${posts[0].cardSpec.senjitsu.length}）`);
    ok(posts[0].cardSpec.window_name.length <= 8, `window_name上限8字（${posts[0].cardSpec.window_name.length}）`);
    ok(posts[1].type === 't2' && posts[2].type === 't3', 'slot1=T2 / slot2=T3');
    ok(maxLineLen(posts[0].text) <= 22, `T1行長上限22（実測 ${maxLineLen(posts[0].text)}）`);
    ok(!/https?:|URL|1000名|無料/.test(posts[0].text), '本文にURL/実績数値/「無料」なし');
    console.log('  --- slot0本文 ---'); console.log(posts[0].text.split('\n').map(l => '  ' + l).join('\n'));
  }

  console.log('2. T1対象外の日（useT1=false: 2026-09-10 ラベルなし）');
  {
    const posts = await planDay('2026-09-10', 3, []);
    ok(posts[0].type === 't2', `slot0=T2にフォールバック（実際: ${posts[0].type}）`);
    ok(!posts[0].cardSpec || posts[0].cardSpec.template === 't2', 'cardSpecはt2');
  }

  console.log('3. 一粒万倍日のみ（2026-09-07）→ T1かつ単一ラベル');
  {
    const posts = await planDay('2026-09-07', 3, []);
    ok(posts[0].type === 't1', `slot0=T1（実際: ${posts[0].type}）`);
    ok(posts[0].cardSpec.senjitsu === '一粒万倍日', `senjitsu=一粒万倍日（${posts[0].cardSpec.senjitsu}）`);
  }

  console.log('4. 決定性（同じ日は同じ文面）');
  {
    const a = await planDay('2026-09-06', 3, []);
    const b = await planDay('2026-09-06', 3, []);
    ok(a[0].text === b[0].text, '再実行で同一文面');
  }

  console.log('5. 履歴による重複回避（recentを渡すと別文面）');
  {
    const a = await planDay('2026-09-06', 3, []);
    const b = await planDay('2026-09-06', 3, [a[0].text]);
    ok(b[0].text !== a[0].text, '同一文面を回避');
  }

  console.log('6. 全テンプレのカードspec形状（t2/t3: 行長≤22・pain/body 2行）');
  {
    const posts = await planDay('2026-09-10', 3, []);
    for (const p of posts) {
      const spec = p.cardSpec || {};
      if (p.type === 't2') {
        ok(spec.template === 't2' && Array.isArray(spec.pain) && Array.isArray(spec.body), 't2 spec形状');
        ok([...spec.pain.join('')].length <= 22, `t2 pain行長（${[...spec.pain.join('')].length}）`);
      }
      if (p.type === 't3') {
        ok(spec.template === 't3' && spec.hook.length === 2 && spec.body.length === 2, 't3 spec形状');
        ok(!spec.body.join('').includes(p.text), 't3 カードbodyが本文と重複しない');
      }
    }
  }

  // 7. T1の文言がラベル数に応じて成立するか（単独日に「重なる」は日本語破綻・年37日発生）
  console.log('7. T1文言のラベル数分岐');
  {
    const multi = await planDay('2026-09-06', 3, []);   // 3ラベル
    ok(/重なる特別な日/.test(multi[0].text), '複数ラベルは「重なる」を使う');

    const single = await planDay('2026-09-07', 3, []);  // 一粒万倍日のみ
    ok(!/が\n重なる/.test(single[0].text), '単独ラベルで「が重なる」を出さない');
    ok(!/年に何度もない|年に数回/.test(single[0].text),
       '単独ラベルで希少さを主張しない（一粒万倍日単独は年37日）');

    // 通年で未定義値・破綻が出ないこと
    let t1count = 0, broken = 0;
    for (let m = 1; m <= 12; m++) {
      const dim = new Date(2026, m, 0).getDate();
      for (let d = 1; d <= dim; d++) {
        const day = `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const posts = await planDay(day, 3, []);
        const s0 = posts[0];
        if (s0.cardSpec && s0.cardSpec.template === 't1') {
          t1count++;
          if (/undefined|NaN|null/.test(s0.text)) broken++;
          if (/が\n重なる/.test(s0.text) && !/×/.test(s0.text)) broken++;
        }
      }
    }
    ok(t1count === 79, `T1は年79日だけ出る（実際: ${t1count}）`);
    ok(broken === 0, `通年でT1文言の破綻なし（破綻: ${broken}）`);
  }

  console.log(`\n結果: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
