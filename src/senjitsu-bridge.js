// src/senjitsu-bridge.js — Node→Python ブリッジ（選日・時辰の実データ取得）
// 依存: python3 + ephem + src/senjitsu.py + src/rarity.py
// 失敗時は null を返す（呼び出し側で従来型にフォールバックし、投稿を止めない）。

const { execFile } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CACHE = {};

/**
 * その日の選日・時辰データを返す。
 * @returns {Promise<{labels:string[], useT1:boolean, tier:?number, windowName:?string, windowLabel:?string}|null>}
 */
function fetchDayFacts(y, m, d) {
  const key = `${y}-${m}-${d}`;
  if (CACHE[key]) return Promise.resolve(CACHE[key]);

  const code = [
    'import sys,json,datetime',
    'sys.path.insert(0, "src")',
    'import senjitsu, rarity',
    `d = datetime.date(${y},${m},${d})`,
    'p = rarity.plan(d)',
    'w = senjitsu.peak_window(d)',
    'print(json.dumps({"labels": p.get("labels") or [], "useT1": bool(p.get("use_T1")), "tier": p.get("tier"), "windowName": w["name"] if w else None, "windowLabel": w["label"] if w else None}, ensure_ascii=False))',
  ].join('\n');

  return new Promise((resolve) => {
    execFile('python3', ['-c', code], { cwd: ROOT, timeout: 20000 }, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      try {
        const obj = JSON.parse(stdout.trim().split('\n').pop());
        CACHE[key] = obj;
        resolve(obj);
      } catch { resolve(null); }
    });
  });
}

module.exports = { fetchDayFacts };
