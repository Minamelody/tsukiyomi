#!/usr/bin/env node
// 納品用の鑑定生成ツール（ココナラのトークルームに貼るテキストを作る）。
//
// ココナラは購入者を外部サイトへ誘導できないため、鑑定はトークルーム内で納品する。
// このツールで生成したテキストをそのまま貼れば納品が完了する。
//
// 使い方:
//   node src/deliver.js --sei 佐藤 --mei 美咲 --birthday 1995-07-15 \
//     --question "転職しようか迷っています" --types all
//   node src/deliver.js --sei 山田 --mei 花子 --birthday 1990-03-25 --types tarot
//
// オプション:
//   --types all | seimei,tarot,...   納品する種目（既定 all）
//   --out <path>                     ファイルに書き出す（既定は標準出力）
//   --plain                          区切り線を減らしたシンプルな体裁

const fs = require('fs');
const { readWithLLM, TYPES } = require('./readings');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? (process.argv[i + 1] ?? true) : def;
}

const HEADER = (name) => `${name} 様

ご購入いただきありがとうございます。
お伺いした情報をもとに鑑定させていただきました。
以下、鑑定結果をお届けします。`;

const FOOTER = `
────────────────────
最後までお読みいただきありがとうございました。
気になる点やもう少し詳しく聞きたいところがあれば、
このトークルームでお気軽にお尋ねください。

※本鑑定は娯楽を目的としたものです。
　医療・法律・投資に関する判断の根拠とはなりません。
　最終的な選択はご自身の意思で行ってください。`;

async function main() {
  const sei = arg('sei', '');
  const mei = arg('mei', '');
  const birthday = arg('birthday', '');
  const question = arg('question', '');
  const typesArg = String(arg('types', 'all'));
  const plain = process.argv.includes('--plain');
  const outPath = arg('out', null);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday)) {
    console.error('使い方: node src/deliver.js --sei 姓 --mei 名 --birthday YYYY-MM-DD [--question "悩み"] [--types all]');
    process.exit(1);
  }

  const wanted = typesArg === 'all' ? TYPES.map(t => t.id)
    : typesArg.split(',').map(s => s.trim()).filter(Boolean);
  const unknown = wanted.filter(w => !TYPES.some(t => t.id === w));
  if (unknown.length) {
    console.error(`不明な種目: ${unknown.join(', ')}`);
    console.error(`指定できるのは: ${TYPES.map(t => `${t.id}(${t.name})`).join(', ')}`);
    process.exit(1);
  }

  const input = { sei, mei, name: `${sei}${mei}` || 'あなた', birthday, question, date: new Date().toISOString().slice(0, 10) };
  const displayName = `${sei}${mei}`.trim() || 'ご相談者';

  const parts = [HEADER(displayName), ''];
  const bar = plain ? '' : '────────────────────';

  for (const id of wanted) {
    const r = await readWithLLM(id, input);
    if (!r.available) {
      console.error(`※ ${r.name} はスキップ: ${r.reason}`);
      continue;
    }
    if (bar) parts.push(bar);
    parts.push(`【${r.name}】`, '');
    // 無料パートの要約も入れて全体像が分かるようにする
    if (r.free?.summary) parts.push(r.free.summary, '');
    for (const s of r.paid.sections) {
      parts.push(`■ ${s.h}`, s.body, '');
    }
  }

  parts.push(FOOTER);
  const text = parts.join('\n');

  if (outPath) {
    fs.writeFileSync(outPath, text);
    console.error(`書き出しました: ${outPath}（${text.length}文字）`);
  } else {
    process.stdout.write(text);
  }
}

main().catch(e => { console.error('失敗:', e.message); process.exit(1); });
