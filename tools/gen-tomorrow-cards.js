#!/usr/bin/env node
// 翌日（JST）の3枠分の投稿カードを dist/cards/<date>/slotN.png に生成する。
//
// なぜ dist/ か: GitHub Pages が配信するのは dist/ 配下だけで、Threads API は
// 画像に公開URLを要求する。design/cards/out/ は .gitignore 対象なので配信されない。
//
// なぜ前日か: 投稿時に push→Pagesビルド完了を待つと、ビルドが遅れたり失敗した時に
// 投稿自体が止まる。前日に配信まで済ませておけば、投稿処理はURLを組むだけで済む。
// カードは同じ日付から同じspec・同じバイト列が出る決定的生成なので前倒しできる。
//
// 生成できなかった枠は黙って飛ばす。autopost 側が HEAD で200を確認してから
// 画像付きにするので、欠けた枠はテキストのみ投稿に落ちる（投稿は止まらない）。

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { planDay } = require('../src/threads-posts');

const ROOT = path.join(__dirname, '..');
const GEN = path.join(ROOT, 'design', 'cards', 'gen_cards.py');

/** JSTの「明日」をYYYY-MM-DDで返す（引数で上書き可） */
function targetDate() {
  const argDate = process.argv[2];
  if (argDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(argDate)) {
      console.error(`日付の形式が不正です: ${argDate}（YYYY-MM-DD）`);
      process.exit(1);
    }
    return argDate;
  }
  const jstNow = new Date(Date.now() + 9 * 3600 * 1000);
  jstNow.setUTCDate(jstNow.getUTCDate() + 1);
  return jstNow.toISOString().slice(0, 10);
}

async function main() {
  const date = targetDate();
  const outDir = path.join(ROOT, 'dist', 'cards', date);
  fs.mkdirSync(outDir, { recursive: true });

  const posts = await planDay(date, 3, []);
  let made = 0;

  for (let slot = 0; slot < posts.length; slot++) {
    const spec = posts[slot].cardSpec;
    if (!spec) {
      console.log(`slot${slot}: cardSpec なし（テキストのみの枠）`);
      continue;
    }
    const out = path.join(outDir, `slot${slot}.png`);
    try {
      execFileSync('python3', [GEN, '-o', out, '--spec', JSON.stringify(spec)],
        { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
      const kb = Math.round(fs.statSync(out).size / 1024);
      console.log(`slot${slot}: ${path.relative(ROOT, out)} (${kb}KB) ${spec.template}`);
      made++;
    } catch (e) {
      const msg = (e.stderr?.toString() || e.stdout?.toString() || e.message).split('\n')[0].trim();
      console.warn(`slot${slot}: 生成に失敗したので飛ばします — ${msg}`);
    }
  }

  // 古い日付を捨てる。毎日3枚(約480KB)積むとリポジトリが太り、clone が遅くなる。
  // 投稿は当日分しか参照しないので、数日残せば足りる。
  const KEEP_DAYS = 3;
  const cardsRoot = path.join(ROOT, 'dist', 'cards');
  const cutoff = new Date(`${date}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - KEEP_DAYS);
  for (const name of fs.readdirSync(cardsRoot)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) continue;
    if (new Date(`${name}T00:00:00Z`) < cutoff) {
      fs.rmSync(path.join(cardsRoot, name), { recursive: true, force: true });
      console.log(`古いカードを削除: ${name}`);
    }
  }

  console.log(`\n${date}: ${made}/${posts.length} 枚を用意しました。`);
  if (!made) {
    // 1枚も出なければ、翌日はテキストのみ投稿になる。ワークフローを赤くして気づけるようにする。
    console.error('1枚も生成できませんでした（翌日はテキストのみ投稿になります）');
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
