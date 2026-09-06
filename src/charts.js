#!/usr/bin/env node
// 図版生成用に、顧客データから各占術の「計算結果だけ」をJSONで吐く。
// 鑑定文（LLM）は通さないので即座に終わる。
//
// 使い方:
//   node src/charts.js --sei 佐藤 --mei 美咲 --birthday 1995-07-15 \
//     --question "転職しようか迷っています" [--date 2026-09-06]
//
// 重要: タロットの引きは「名前|生年月日|日付|悩み」をシードにした決定論なので、
// deliver.js に渡したのと同じ --question / --date を渡さないと、
// 図版と鑑定文で違うカードが出る。

const { seimeiHandan } = require('./seimei');
const { shichuMeishiki } = require('./shichu');
const { draw3 } = require('./tarot');
const { horoscope } = require('./astro');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? (process.argv[i + 1] ?? true) : def;
}

const sei = String(arg('sei', ''));
const mei = String(arg('mei', ''));
const birthday = String(arg('birthday', ''));
const date = String(arg('date', new Date().toISOString().slice(0, 10)));
const question = String(arg('question', ''));

if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday)) {
  console.error('使い方: node src/charts.js --sei 姓 --mei 名 --birthday YYYY-MM-DD [--question "悩み"] [--date YYYY-MM-DD]');
  process.exit(1);
}

const out = {};
const name = `${sei}${mei}`.trim();

try { if (sei && mei) out.seimei = seimeiHandan(sei, mei); } catch (e) { }
try { out.shichu = shichuMeishiki(birthday); } catch (e) { }
// readings.js と完全に同じシード文字列を使う（ここがズレると別のカードになる）
try { out.tarot = draw3(`${name || 'あなた'}|${birthday}|${date}|${question}`); } catch (e) { }
try { out.astro = horoscope(birthday); } catch (e) { }

process.stdout.write(JSON.stringify(out, null, 1));
