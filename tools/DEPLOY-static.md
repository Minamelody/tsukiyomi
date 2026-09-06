# 公開手順（完全クライアントサイド版・月額0円）

## ビルド

```bash
SITE_URL=https://<公開URL> node tools/build-static.js
```

`dist/` に `index.html` / `privacy.html` / `robots.txt` / `sitemap.xml` が出ます。
**この4ファイルを静的ホスティングに置くだけで動きます。サーバーもDBも要りません。**

`SITE_URL` を省略するとビルドは通りますが canonical・OGP・JSON-LD が出力されません
（プレースホルダを本番に出さないため、意図的に落としています）。公開URLが決まったら必ず付けて再ビルドしてください。

ココナラの出品URLもビルド時に埋め込みます（サーバーが無いため環境変数は実行時に読めません）。

```bash
SITE_URL=https://<公開URL> \
COCONALA_PROFILE_URL=... COCONALA_URL_SEIMEI=... COCONALA_URL_SEIZA=... \
COCONALA_URL_TAROT=... COCONALA_URL_SHICHU=... COCONALA_URL_ASTRO=... \
COCONALA_URL_BUNDLE=... node tools/build-static.js
```

未設定の枠は「準備中です」表示になり、押せません。

**ワークフローは Variables が1本も無いとビルドを失敗させます**（`REQUIRE_SHOP_URLS=1`）。
出品後に Variables を入れ忘れたまま再ビルドが走ると、購入ボタンが全部「準備中です」に
戻ったサイトを公開してしまうためです。デプロイが赤くなったら、まず Variables を確認してください。

手元でビルドする時はこの制限はかかりません（警告だけ出ます）。

## ホスティング（GitHub Pages で確定）

公開URLは **https://Minamelody.github.io/tsukiyomi/** です。

**リポジトリは public にしてください。** GitHub Pages を無料プランで使う場合、
private リポジトリからは公開できません（Pages は Pro 以上が必要）。
このリポジトリに秘密情報は含まれません（LLMのAPIキーを使うのは納品ツール側で、
そちらは公開しません）。

### 手順

1. GitHub で `tsukiyomi` という**空の public リポジトリ**を作る
2. このソース一式を push する（`dist/` も含めて構いませんが、無くても動きます）
3. リポジトリの Settings → Pages → **Source を「GitHub Actions」に設定**
   （**ここで公開が始まります。**ココナラ出品前なら保留 — 次節を参照）
4. 以降は main に push するたび `.github/workflows/pages.yml` が自動でビルド・公開します

**3で「Deploy from a branch」を選ばないでください。** 同梱のワークフローは
`actions/configure-pages` が返す公開URLをそのまま `SITE_URL` に渡してビルドし直す作りなので、
「GitHub Actions」を選んだ時だけ canonical・OGP・sitemap が正しいURLで焼かれます。
ブランチ配信を選ぶと、リポジトリに入っている古い `dist/` がそのまま配信されます。

### 公開が始まるタイミング（順序に注意）

**手順3で Source を「GitHub Actions」にした時点で、サイトが世界に公開されます。**
リポジトリを public にしただけでは公開されません（ソースが読める状態になるだけです）。
つまり公開のスイッチは3であって、1でも2でもありません。

**ココナラの出品が済むまでは、手順3を保留してください。** 先に公開すると、
「深掘り鑑定を見る」ボタンが全部「準備中です」の状態が人目に触れます。無料診断は
動くので実害は小さいですが、購入導線が無い状態を見せることになります。

順序としては **ココナラ出品 → Variables に7本設定 → 手順3で公開** が安全です。
1と2（リポジトリ作成とpush）は先に済ませて構いません。

もう一点、`robots.txt` は全ページをクロール許可で出しています。公開後は検索エンジンが
拾い始めるので、**「とりあえず公開して後で下げる」がやりにくい**という意味でも、
出品が済んでから3を押す方が安全です。

### ココナラURLを入れる

出品が済んだら、リポジトリの
**Settings → Secrets and variables → Actions → Variables** に7つ足してください。
次の push（または Actions の Re-run）で自動的に埋まります。**再ビルドの依頼は不要です。**

```
COCONALA_PROFILE_URL / COCONALA_URL_SEIMEI / COCONALA_URL_SEIZA
COCONALA_URL_TAROT / COCONALA_URL_SHICHU / COCONALA_URL_ASTRO / COCONALA_URL_BUNDLE
```

未設定の枠は「準備中です」表示になり、押せません。

### 手元でビルドしたdistを直接置く場合

Actions を使わず `dist/` の中身をそのまま配信する運用も可能ですが、その場合は
**必ず公開URLで焼いた dist を置いてください**（`dist/BUILD-INFO.txt` に焼き込み先が書いてあります）。
別URLで焼いた dist を置くと canonical が実在しないURLを指します。

## 残っている作業

- ココナラ出品URL7本 — 出品後、上記の Variables に設定（再ビルド不要）
- Google Search Console への登録（サイト公開後。URLプレフィックス + sitemap 手動提出）
- **Threads / Instagram のプロフィール画像を設定** — `tsukiyomi-profile-1080.png`（チャットで配布済み）。
  表示名 `ツキヨミ｜無料占い・姓名判断` と合わせて設定します（詳細は `tools/threads-profile.md`）。
  サイト側の og.png と違い**ビルドに含まれない手作業**なので、設定漏れに注意してください。

`public/og.png` と `public/privacy.html` の第6項（ココナラ窓口）は対応済みです。

## この構成で消えたもの

サーバーが無くなったので、以下は構造的に存在しません。
- APIキーの漏洩リスク（LLMを呼ばないのでキーを置く場所がない）
- リード保存（サーバーに何も送らない＝生年月日も悩みも受け取らない）
- レート制限・スリープ・コールドスタート・月額費用

有料鑑定のLLM生成は納品ツール（`src/deliver-ui.js`・ローカル運用）に残っています。
こちらは公開サーバーに置かないので、キーは手元だけにあります。

## この dist がどのURL向けか

ビルドすると `dist/BUILD-INFO.txt` に `SITE_URL` と生成時刻が書き出されます。
canonical・og:url・JSON-LD・robots.txt・sitemap.xml は**絶対URL**なので、
そこに書かれているURL以外のホスティングに置く場合は必ず再ビルドしてください。
再ビルドせずに置くと canonical が実在しないURLを指し、検索インデックスが空振りします。
