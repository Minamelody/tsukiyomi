# 復旧手順（サンドボックスが失われた時）

自動投稿を動かしていた実行環境ごと失った場合に、ここから戻す。

**この文書がリポジトリにある理由**: 復旧手順を実行環境のメモだけに置くと、
その環境が飛んだ時に手順ごと消えて復旧できない。手順は復旧対象の外に置く。

## 何がどこに生きているか

| 層 | 置き場所 | 環境が飛んだ時 |
|---|---|---|
| 動かす側（ランナー） | このリポジトリ直下 `run-post.sh` / `run-refresh-token.sh` | 残る |
| 作る側（選日・カード） | `src/senjitsu.py` `src/rarity.py` `design/cards/` | 残る |
| 回す側（スケジュール） | GenTeam のスケジュール（サンドボックス外） | 残る |
| カード配信 | GitHub Actions `.github/workflows/cards.yml` + Pages | 残る |
| **アクセストークン** | 実行環境の `.env.threads` のみ | **消える** |

**消えるのはトークンだけ。** そこだけ人の手が必要になる。

## 手順

### 1. リポジトリを取得

```bash
git clone <repo> ~/repos/tsukiyomi
cd ~/repos/tsukiyomi
```

`out/` は gitignore なので存在しない。ランナーが `mkdir -p out` するので手当は不要。

### 2. 依存を入れる

```bash
pip install -r requirements.txt          # ephem（選日計算）・Pillow 他
sudo apt-get install -y fonts-noto-cjk fonts-noto-cjk-extra fonts-noto-color-emoji
python3 design/cards/gen_cards.py --check-env   # 全項目 OK になるまで進まない
```

**`fonts-noto-cjk-extra` を省くと落ちる。** Light ウェイトがそちらに入っており、
カードのロゴと時刻に使っている。

### 3. トークンを再配置する（ここだけ人の手が必要）

`.env.threads` を作る:

```
THREADS_USER_ID=28648536884749907
THREADS_ACCESS_TOKEN=TH...
```

```bash
chmod 600 .env.threads
```

**トークン文字列がどこにも残っていない場合は再取得が必要。**
アカウント所有者（R社長）の手元操作になる。Threads アプリ内ブラウザでは
Facebook の発行ページが白画面になるので、Safari 等で直接開くこと（2026-09-05 の実績）。

`THREADS_USER_ID` は上の値で固定（アカウント `@aurora_uranai7`）。

### 4. 動作を確認する

```bash
bash run-refresh-token.sh --check      # 「トークンは現在有効です」
bash run-post.sh 0                     # dry-run（--live が無い限り投稿しない）
node src/test-posts-v2.js              # 15 PASS（型A/B/D）
python3 src/test_senjitsu.py           # ALL PASS
```

`.env.threads` が無いと両ランナーは exit 1 で止まる。偽の成功にはならない。

### 5. スケジュールを確認する

GenTeam 側に残っているので作り直しは不要。ただし**実際に動いているかは別問題**なので、
`de schedule-list` で存在を確認し、次回実行を待たずに1本手で走らせて通す。

## 落とし穴（すべて実際に踏んだもの）

- **ランナーはリポジトリ直下から動かす。** `cd "$(dirname "$0")"` があるので、
  `tools/` などに移すと `node src/...` と `.env.threads` の参照が全部壊れる。
- **`fonts-noto-cjk` だけでは足りない**（上記）。
- **クレジットが枯渇するとスケジュール実行が黙って失敗する。** 通知も飛ばない。
  投稿が来ないのに通知もない時は、まずクレジットを疑う。
- **トークンは「発行/更新から24時間以上」経過しないと更新できない**（Meta仕様）。
  安全側に振って毎日更新にすると初回で必ず失敗する。週1が下限。
- **GITHUB_TOKEN による push は他のワークフローを起動しない。**
  カード生成ワークフローが Pages デプロイまで自分で完結させているのはこのため。
  「コミットすれば pages.yml が拾う」に変えると、カードが永久に404になる。

## 通知の試し方

失敗時の通知を検証する時は、本物をチャンネルに飛ばさないこと。

```bash
AUTOPOST_NOTIFY_SILENT_TEST=1 bash run-post.sh 0 --live      # 投稿側
TOKEN_NOTIFY_SILENT_TEST=1   bash run-refresh-token.sh       # トークン側
```

ログに記録されるだけで送信されない。
