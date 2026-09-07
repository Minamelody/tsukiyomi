// src/cards.js — 投稿カード生成（best-effort・失敗しても投稿は止めない）
// 呼び出し: python3 design/cards/gen_post_cards.py -o <out> --spec '<json>'
// ValueError（上限超過）や環境起因の失敗は null を返し、呼び出し側でログする。

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const CARDS_DIR = path.join(__dirname, '..', 'design', 'cards');
const OUT_DIR = path.join(CARDS_DIR, 'out');

/**
 * カード1枚を生成する。
 * @param {string} date 'YYYY-MM-DD'（JST）
 * @param {number} slot
 * @param {object|null} cardSpec
 * @returns {Promise<string|null>} 生成したPNGのパス（失敗時 null）
 */
function genCard(date, slot, cardSpec) {
  return new Promise((resolve) => {
    if (!cardSpec) return resolve(null);
    const dir = path.join(OUT_DIR, date);
    fs.mkdirSync(dir, { recursive: true });
    const outFile = path.join(dir, `slot${slot}.png`);
    const spec = JSON.stringify(cardSpec);
    execFile('python3', [path.join(CARDS_DIR, 'gen_post_cards.py'), '-o', outFile, '--spec', spec],
      { timeout: 30000 },
      (err, stdout, stderr) => {
        if (err) {
          console.warn(`カード生成をスキップ（${date} slot${slot}）: ${(stderr || stdout || err.message).split('\n')[0].trim()}`);
          return resolve(null);
        }
        resolve(outFile);
      });
  });
}

module.exports = { genCard };
