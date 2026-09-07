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
// 効果保証語（景表法）：結果断定「全てがうまく」「うまくいく」級もここで弾く（task #15 回帰）。
const FORBIDDEN = ['!', '！', '笑', 'よければ', 'どうぞ', '気になりますよね',
  '5種', '5つ', 'まとめて', 'ぜひ', 'お試しください', '参考に',
  '必ず', '絶対', '保証', '霊視', '当たります', '無料', 'URL', 'http',
  '全てがうまく', 'うまくいく'];

async function main() {
  console.log('1. 型A/FOMO/D が3本生成（2026-09-06 三重日）');
  const triple = await planDay('2026-09-06', 3, []);
  ok(triple.length === 3, '3本生成');
  ok(triple[0].type === 'type_a', `slot0=型A（実際: ${triple[0].type}）`);
  ok(triple[1].type === 'type_fomo', `slot1=型FOMO（実際: ${triple[1].type}）`);
  ok(triple[2].type === 'type_d', `slot2=型D（実際: ${triple[2].type}）`);

  console.log('2. 型A（暦フック）の構造');
  {
    const a = triple[0];
    ok(/👉/.test(a.text), '根拠👉あり');
    ok(a.cardSpec && a.cardSpec.senjitsu.includes('一粒万倍日'), 'cardSpecに暦名');
    ok(/重なる日/.test(a.text), '三重日は「重なる日」');
    console.log('  --- 型A本文 ---'); console.log(a.text.split('\n').map(l => '  ' + l).join('\n'));
  }

  console.log('3. 型FOMO（13時・🌙ミーム）の構造と効果保証語');
  {
    const f = triple[1];
    ok(/飛ばしたらダメ、とは言いません/.test(f.text), 'FOMO見出しあり');
    ok(/🌙/.test(f.text), '本文に🌙（CTA絵文字）');
    ok(!/全てがうまく|うまくいく/.test(f.text), '効果保証語（全てがうまく/うまくいく）なし');
    ok(!/必ず|絶対|保証/.test(f.text), '絶対/必ず/保証 なし');
    ok(f.cardSpec && f.cardSpec.template === 'koyomi', `cardSpec=koyomi（実際: ${f.cardSpec.template}）`);
    ok(f.cardSpec.emoji === '🌙', 'cardSpec.emoji=🌙（カードCTA行にも絵文字）');
    ok(f.cardSpec.senjitsu === '運気が動き始める日', 'cardSpec.senjitsu 一致');
    console.log('  --- 型FOMO本文 ---'); console.log(f.text.split('\n').map(l => '  ' + l).join('\n'));
  }

  console.log('3b. 型B（12星座・次回型B枠用に温存）は直接生成で健在');
  {
    const { buildTypeB } = require('./threads-posts');
    const b = buildTypeB('2026-09-08', () => 0);
    ok(b.type === 'type_b' && b.cardSpec.template === 'seiza', `型B=seizaのまま（実際: ${b.cardSpec && b.cardSpec.template}）`);
    ok(Array.isArray(b.cardSpec.words) && b.cardSpec.words.length === 12, 'words 12件');
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

  console.log('8. 通年で未定義値・破綻が出ない（型A/B/Dすべて）＋暦と矛盾する行動なし');
  {
    let broken = 0, contradict = 0;
    for (let m = 1; m <= 12; m++) {
      const dim = new Date(Date.UTC(2026, m, 0)).getUTCDate();
      for (let d = 1; d <= dim; d++) {
        const day = `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const posts = await planDay(day, 3, []);
        for (const p of posts) {
          if (!p.text || /undefined|NaN|null/.test(p.text)) broken++;
          // 一粒万倍日（＝始める日）に「静かに過ごす」類の逆の行動が出る矛盾を監視（R社長指摘）
          if (p.type === 'type_a' && /静かに過ご|衝動買いをやめ/.test(p.text)) contradict++;
        }
      }
    }
    ok(broken === 0, `通年で破綻なし（破綻: ${broken}）`);
    ok(contradict === 0, `暦と矛盾する行動なし（混入: ${contradict}）`);
  }

  console.log('9. 一粒万倍日は「始める/種」の行動になる（2026-09-07 回帰）');
  {
    const sep7 = await planDay('2026-09-07', 1, []);
    const a = sep7[0];
    ok(a.type === 'type_a', `slot0=型A（実際: ${a.type}）`);
    ok(/始め|種を/.test(a.text), '「始める/種」の行動で締める');
    ok(!/静かに過ご/.test(a.text), '「静かに過ごす」が出ない');
    console.log('  --- 9/7 型A本文 ---'); console.log(a.text.split('\n').map(l => '  ' + l).join('\n'));
  }

  console.log('10. 21時枠: 月〜土=型T3夜 / 日曜=型D');
  {
    const mon = await planDay('2026-09-07', 3, []);   // 月
    const sun = await planDay('2026-09-06', 3, []);   // 日
    ok(mon[2].type === 'type_night', `月曜 slot2=型T3夜（実際: ${mon[2].type}）`);
    ok(sun[2].type === 'type_d', `日曜 slot2=型D（実際: ${sun[2].type}）`);
    ok(mon[2].cardSpec === null, '型T3夜はカードなし（テキストのみ・夜の独白型）');
  }

  console.log('11. 型T3夜（21時・煽り）の構造と禁止語');
  {
    const mon = await planDay('2026-09-07', 3, []);
    const n = mon[2];
    ok(/21時にこれを読んでいるあなた/.test(n.text), '時刻の呼びかけあり（投稿時刻と一致）');
    ok(/その感覚、当たってます/.test(n.text), '「その感覚、当たってます」あり');
    ok(/このまま流されたら、また何も変わらない/.test(n.text), '期限の煽りあり');
    ok(/五つの占術が同じことを指していたら/.test(n.text), '五占術の提供で締める');
    ok(!/必ず|絶対|保証/.test(n.text), '効果保証語（必ず/絶対/保証）なし');
    console.log('  --- 9/7 21時 本文 ---'); console.log(n.text.split('\n').map(l => '  ' + l).join('\n'));
  }

  console.log('12. 型T3夜の内心の言い換えは重複なし・10日一周（決定論ローテーション）');
  {
    const { buildTypeNight } = require('./threads-posts');
    const seen = [];
    for (let k = 0; k < 10; k++) {
      const d = new Date(Date.UTC(2026, 8, 7 + k)); // 9/7 から10日分
      seen.push(buildTypeNight(d.toISOString().slice(0, 10)).text);
    }
    ok(new Set(seen).size === 10, `10日間で重複なし（${new Set(seen).size}/10）`);
    ok(buildTypeNight('2026-09-07').text === buildTypeNight('2026-09-17').text, '10日で一周（9/7 == 9/17）');
    ok(buildTypeNight('2026-09-07').text.includes('明日やろう'), '9/7=辞書#1（Designer確定文の起点）');
    // 連続2日が同じ文面にならない（固定1文の再発防止）
    ok(buildTypeNight('2026-09-07').text !== buildTypeNight('2026-09-08').text, '9/7 ≠ 9/8（日替わり）');
  }

  console.log('13. カード紐付け回帰: 型FOMO(13時)=koyomi／夜枠=テキストのみ／テンプレは koyomi|seiza|shindan のみ');
  {
    const mon = await planDay('2026-09-07', 3, []);
    const b = mon[1];
    ok(b.type === 'type_fomo' && b.cardSpec && b.cardSpec.template === 'koyomi',
      `型FOMO(13時)=koyomiカード（実際: ${b.cardSpec && b.cardSpec.template}）`);
    ok(mon[2].type === 'type_night' && mon[2].cardSpec === null,
      '型T3夜(21時)=テキストのみ（cardSpec null・画像を添付しない）');
    // 通年スポット: 生成されるカードテンプレは koyomi/seiza/shindan のみ。
    // 旧生成器（t1/t2/t3・縁「会いたい人」等）が混入しないことを回帰で担保。
    let bad = 0;
    const allowed = new Set(['koyomi', 'seiza', 'shindan']);
    for (const day of ['2026-09-06', '2026-09-07', '2026-09-08', '2026-09-13', '2026-10-01', '2026-12-16']) {
      const posts = await planDay(day, 3, []);
      for (const p of posts) {
        if (p.cardSpec && !allowed.has(p.cardSpec.template)) {
          bad++; console.log(`    不正template: ${day} ${p.type} -> ${p.cardSpec.template}`);
        }
        if (p.type === 'type_night' && p.cardSpec !== null) {
          bad++; console.log(`    夜枠にcardSpecあり: ${day}`);
        }
      }
    }
    ok(bad === 0, `カードテンプレ正・夜枠はテキストのみ（不正: ${bad}）`);
  }

  console.log(`\n結果: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
