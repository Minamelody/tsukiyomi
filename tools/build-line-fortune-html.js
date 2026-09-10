#!/usr/bin/env node
'use strict';
// tools/build-line-fortune-html.js — LINE無料鑑定ツールのローカルHTML版を生成する。
//
// 単一HTML（Safari の file:// で開ける・外部JS/CSS/ES-modules 完全不使用）を、
// CLI（src/line-fortune.js）と「同一ロジック・同一辞書」で組み立てる。
//
// 方針: ソースモジュールを CommonJS から単一スコープへ機械変換してインライン化する。
//   - require('./x') → __ns['./x']
//   - module.exports = X → return X（各モジュールを IIFE で包む）
//   - line-fortune.js の CLI エントリブロック（require.main）は除去
// この変換は内容を変えない（コメント・リテラルはそのまま）ので、CLI と HTML の
// 出力が完全一致する（一致回帰は src/test-line-fortune-html.js が担保する）。
//
// 実行:
//   node tools/build-line-fortune-html.js
//   → docs/line-fortune.html を生成（テンプレは design/line-fortune-ui.template.html）
//
// docs/ は Pages デプロイ対象（dist/）とは無関係なので、公開サイトには載らない。

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TEMPLATE = path.join(ROOT, 'design', 'line-fortune-ui.template.html');
const OUTPUT = path.join(ROOT, 'docs', 'line-fortune.html');

// 依存順（下流が先）。キーは require の文字列 specifier と一致させる。
const MODULES = [
  ['./strokes-table', 'src/strokes-table.js'],
  ['./seimei', 'src/seimei.js'],
  ['./shichu', 'src/shichu.js'],
  ['./tarot', 'src/tarot.js'],
  ['./astro', 'src/astro.js'],
  ['./lunar-calendar', 'src/lunar-calendar.js'],
  ['./line-fortune', 'src/line-fortune.js'],
];

function transformModule(code) {
  // 1. shebang
  code = code.replace(/^#!.*\n/, '');
  // 2. 'use strict' は IIFE 内で自前付与するので除去
  code = code.replace(/['"]use strict['"];\s*/g, '');
  // 3. CLI エントリブロック（line-fortune.js のみ）とその直前コメントを除去
  code = code.replace(/\n*\/\/[^\n]*CLI[^\n]*\n*if \(require\.main === module\)\s*\{[\s\S]*$/, '');
  // 4. require('./x') → __ns['./x']
  code = code.replace(/require\((['"])(\.\/[A-Za-z0-9_-]+)\1\)/g, "__ns[$1$2$1]");
  // 5. module.exports = X → return X
  code = code.replace(/module\.exports\s*=\s*/, 'return ');
  return code.trim();
}

function buildEngineJs() {
  const parts = ['var __ns = {};'];
  for (const [spec, rel] of MODULES) {
    if (!rel) continue; // 差分で使わない行の保険
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const body = transformModule(src);
    parts.push(
      `__ns['${spec}'] = (function () {\n'use strict';\n${body}\n})();`
    );
  }
  return parts.join('\n\n');
}

function main() {
  if (!fs.existsSync(TEMPLATE)) {
    console.error('テンプレートが見つかりません: ' + TEMPLATE);
    process.exit(1);
  }
  const template = fs.readFileSync(TEMPLATE, 'utf8');
  if (!template.includes('/*@@ENGINE@@*/')) {
    console.error('テンプレートに注入点 /*@@ENGINE@@*/ がありません');
    process.exit(1);
  }

  const engine = buildEngineJs();
  const banner =
    '/* ==== ENGINE BEGIN（tools/build-line-fortune-html.js で自動生成・手編集禁止） ==== */\n' +
    engine +
    '\n/* ==== ENGINE END ==== */';

  const html = template.replace('/*@@ENGINE@@*/', banner);

  // 自罹: 外部参照ゼロ・ES modules ゼロ（Safari file:// 対応の必須条件）
  const prohibits = [
    ['<link ', '外部CSS参照'],
    ['src=', '外部JS参照'],
    [' href="http', '外部リンク'],
    ['import ', 'ES modules'],
  ];
  for (const [needle, label] of prohibits) {
    if (html.toLowerCase().includes(needle.toLowerCase())) {
      console.error('生成物に禁止要素が含まれます: ' + label);
      process.exit(1);
    }
  }

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, html, 'utf8');
  const kb = (fs.statSync(OUTPUT).size / 1024).toFixed(1);
  console.log(`生成完了: ${path.relative(ROOT, OUTPUT)}（${kb} KB）`);
}

main();
