#!/usr/bin/env python3
# ツキヨミ Threads投稿カード v2（2026-09-06 / task #8 spec対応）
# ディープリサーチの調査spec（threads-post-spec.md 「3. 画像要件」）に基づく3テンプレ:
#   koyomi  = 暦カード（型A・朝8時に最優先）
#   seiza   = 12星座カード（型B・13時）
#   shindan = 診断カード（型D・週1）
# 共通ルール（specより）: 全要素コード描画（AI生成画像なし）／屋号「ツキヨミ」入り／
# 価格・「無料」表記なし／右ボタン列なし（Shorts用150px余白は不要）／
# 上下は端から88px以上空けてフィードのトリミングに耐える／本文にURLを貼らない代わりに
# 画像フッターに屋号+サイトを入れる。
# 12星座の記号（♈など）は Noto CJK に無いため DejaVu Sans で描く。

import os, sys, json, argparse
from PIL import Image, ImageDraw, ImageFont

_HERE = os.path.dirname(os.path.abspath(__file__))
_CANDIDATES = [
    os.path.join(_HERE, "..", "thumbs"),
    os.path.join(_HERE, "..", "thumbnails"),
    _HERE,
    os.path.join(_HERE, "..", "design"),
    os.path.join(_HERE, "..", "..", "design", "thumbs"),
]
for _c in _CANDIDATES:
    if os.path.exists(os.path.join(_c, "gen_brand.py")):
        sys.path.insert(0, os.path.abspath(_c))
        break
else:
    sys.exit("gen_brand.py が見つかりません。探索パス: "
             + ", ".join(os.path.abspath(c) for c in _CANDIDATES))

from gen_brand import (background, crescent, halo, star_glyph, f, tw,
                       SERIF, SERIF_B, SERIF_L, SANS,
                       GOLD, GOLD_D, GOLD_F, WHITE, MUTE, PUR_HI, DEEP)

OUT = os.path.dirname(os.path.abspath(__file__))
W, H = 1080, 1350
SITE = "minamelody.github.io/tsukiyomi"

# フィードのトリミングに耐える安全マージン（spec: 上下は端から80px以上）
SAFE_T, SAFE_B = 88, H - 88
PAD_X = 44

# 絵文字（👉）は別フォント。無ければ金の菱形で代替する。
EMOJI_FONT = next((p for p in [
    "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf",
    "/usr/share/fonts/truetype/noto-color-emoji/NotoColorEmoji.ttf",
    "/usr/share/fonts/NotoColorEmoji.ttf",
] if os.path.exists(p)), None)
_EMOJI_NATIVE = 109

# 12星座の記号（U+2648..U+2653）は Noto CJK に無い。DejaVu Sans で描く。
ZODIAC_FONT = next((p for p in [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Regular.ttf",
] if os.path.exists(p)), None)

# 12星座の並び（記号・日本語名）は固定。
SIGNS = [("♈", "牡羊座"), ("♉", "牡牛座"), ("♊", "双子座"), ("♋", "蟹座"),
         ("♌", "獅子座"), ("♍", "乙女座"), ("♎", "天秤座"), ("♏", "蠍座"),
         ("♐", "射手座"), ("♑", "山羊座"), ("♒", "水瓶座"), ("♓", "魚座")]


def emoji_img(ch, size):
    if not EMOJI_FONT:
        return None
    layer = Image.new("RGBA", (_EMOJI_NATIVE + 40, _EMOJI_NATIVE + 40), (0, 0, 0, 0))
    ImageDraw.Draw(layer).text((0, 0), ch, font=ImageFont.truetype(EMOJI_FONT, _EMOJI_NATIVE),
                               embedded_color=True)
    layer = layer.crop(layer.getbbox())
    r = size / max(layer.size)
    return layer.resize((max(1, int(layer.width * r)), max(1, int(layer.height * r))), Image.LANCZOS)


def marker(img, d, x, y, size=34):
    """行頭マーカー。👉絵文字（あれば）／なければ金の菱形を描く。戻り値: マーカー幅。"""
    em = emoji_img("👉", size)
    if em:
        img.paste(em, (int(x), int(y - size * 0.06)), em)
        return em.width
    s = size * 0.38
    d.polygon([(x, y), (x + s, y + s * 0.5), (x, y + s), (x - s, y + s * 0.5)], fill=GOLD)
    return int(size * 0.5)


# ---- 文字数上限（超えるとレイアウトが崩れるので生成側で弾く） ----
LIMITS = {
    "koyomi": {"date_label": 16, "senjitsu_total": 16, "senjitsu_per_name": 11,
               "items": 4, "item": 20, "window": 18, "caption": 14},
    "seiza": {"title": 14, "sub": 18, "words": 12, "word": 10},
    "shindan": {"topic": 14, "labels": 3, "label": 5, "lines": 2, "line": 16},
}


def _check(cond, msg):
    if not cond:
        raise ValueError("カード生成: " + msg)


def check_koyomi(date_label, senjitsu, items, window=None, window_caption=None, emoji=None):
    L = LIMITS["koyomi"]
    _check(len(date_label) <= L["date_label"], "date_label が長すぎます: %r" % date_label)
    names = [x.strip() for x in senjitsu.split("×") if x.strip()]
    _check(names, "senjitsu が空です")
    _check(len(senjitsu.replace(" ", "")) <= L["senjitsu_total"],
           "暦名の合計が長すぎます（%d字 > %d字）" % (len(senjitsu.replace(" ", "")), L["senjitsu_total"]))
    for n in names:
        _check(len(n) <= L["senjitsu_per_name"], "暦名が長すぎます: %r" % n)
    _check(len(items) <= L["items"], "項目数が多すぎます（%d > %d）" % (len(items), L["items"]))
    for it in items:
        _check(len(it) <= L["item"], "項目が長すぎます: %r" % it)
    if window:
        _check(len(window) <= L["window"], "時刻が長すぎます: %r（%d字 > %d字）"
               % (window, len(window), L["window"]))
    if window_caption:
        _check(len(window_caption) <= L["caption"], "時刻ラベルが長すぎます: %r" % window_caption)
    if emoji:
        _check(len(emoji) <= 2, "絵文字は1個で指定してください: %r" % emoji)


def check_seiza(title, sub, words):
    L = LIMITS["seiza"]
    _check(len(title) <= L["title"], "title が長すぎます: %r" % title)
    _check(len(sub) <= L["sub"], "sub が長すぎます: %r" % sub)
    _check(len(words) <= L["words"], "words の数が多すぎます（%d > 12）" % len(words))
    _check(len(words) == 12, "words は12個必要です（%d個）" % len(words))
    for i, wd in enumerate(words):
        _check(len(wd) <= L["word"],
               "%s（%s）の一言が長すぎます: %r（%d字 > %d字）" % (SIGNS[i][1], SIGNS[i][0], wd,
                                            len(wd), L["word"]))


def check_shindan(topic, blocks):
    L = LIMITS["shindan"]
    _check(len(topic) <= L["topic"], "topic が長すぎます: %r" % topic)
    _check(len(blocks) == L["labels"], "blocks は3個必要です（%d個）" % len(blocks))
    for lab, lines in blocks:
        _check(len(lab) <= L["label"], "ラベルが長すぎます: %r" % lab)
        _check(len(lines) <= L["lines"], "ブロックの行数が多すぎます: %r" % (lines,))
        for ln in lines:
            _check(len(ln) <= L["line"], "ブロックの1行が長すぎます: %r" % ln)


def base(seed, gx, gy):
    return background(W, H, gx=gx, gy=gy, stars=560, seed=seed)


def frame_safe(d):
    """上下88px・左右44pxの金枠。フィードのトリミング（上下80px）に耐える。"""
    tl, tr, tt, tb = PAD_X, PAD_X, SAFE_T, H - SAFE_B
    corner = 54
    d.rectangle([tl, tt, W - tr, H - tb], outline=GOLD_D, width=2)
    d.rectangle([tl + 11, tt + 11, W - tr - 11, H - tb - 11], outline=(70, 58, 34), width=1)
    for (cx, cy, sx, sy) in [(tl, tt, 1, 1), (W - tr, tt, -1, 1),
                             (tl, H - tb, 1, -1), (W - tr, H - tb, -1, -1)]:
        d.line([(cx, cy), (cx + sx * corner, cy)], fill=GOLD, width=3)
        d.line([(cx, cy), (cx, cy + sy * corner)], fill=GOLD, width=3)


def center(d, txt, fn, cx, y, color):
    w, _ = tw(d, txt, fn)
    d.text((cx - w / 2, y), txt, font=fn, fill=color)


def wordmark(img, d, cx, y, size=40):
    """ツキヨミ の語ロゴ（三日月+文字）。フッター用。"""
    fn = f(SERIF_L, size)
    txt = "ツ キ ヨ ミ"
    w, h = tw(d, txt, fn)
    d.text((cx - w / 2 + 16, y), txt, font=fn, fill=GOLD)
    crescent(img, cx - w / 2 - 26, y + h / 2 - 2, int(size * 0.44), GOLD)
    return h


def footer(img, d, note=None):
    fy = H - 236
    d.line([(W * 0.16, fy), (W * 0.84, fy)], fill=(70, 58, 34), width=1)
    wordmark(img, d, W / 2, fy + 24)
    fn2 = f(SANS, 24)
    sw, _ = tw(d, SITE, fn2)
    d.text((W / 2 - sw / 2, fy + 86), SITE, font=fn2, fill=MUTE)
    if note:
        fn3 = f(SANS, 26)
        center(d, note, fn3, W / 2, fy - 66, GOLD_D)


# ---------------------------------------------- 型A: 暦カード（朝8時）
# window / window_caption / emoji は分岐可能:
#   window=None → 時刻行を出さない（問いかけ型の既定）
#   window="15:00〜16:59頃" + window_caption="今日の吉時" → 投稿時刻と誤読されない「吉時（情報）」表示
#   emoji=None → 絵文字指示を載せない（問いかけ型）
#   emoji="🕊️" → 「🕊️を置いてください」をカードに載せる（絵文字リアクション型・本文側にも同指示を入れる）
# 投稿スロット（8時/13時/日曜21時）に合わせた値はパイプライン側から渡す（2026-09-06 R社長指摘対応）。
def cta_line(img, d, y, emoji, fn, color=GOLD_F):
    """「{emoji}」を置いてください の1行を中央に描く。"""
    pre, post = "「", "」を置いてください"
    em = emoji_img(emoji, 34)
    bw, _ = tw(d, pre, fn)
    aw, _ = tw(d, post, fn)
    ew = em.width if em else 0
    x = W / 2 - (bw + ew + aw) / 2
    d.text((x, y), pre, font=fn, fill=color)
    if em:
        img.paste(em, (int(x + bw), int(y - 2)), em)
    d.text((x + bw + ew, y), post, font=fn, fill=color)


def make_koyomi(path, date_label="明日 9月7日（月）", senjitsu="天赦日 × 一粒万倍日",
                items=("天赦日＝天が赦す最上の吉日", "一粒万倍日＝種まきに最適な日",
                       "寅の日＝旅立ちに良い日", "大安＝何事も始めやすい日"),
                window=None, window_caption=None, emoji=None, note=None):
    check_koyomi(date_label, senjitsu, items, window, window_caption, emoji)
    img = base(20260907, 0.50, 0.15)
    mcx, mcy, mr = W * 0.5, H * 0.17, 108
    img = halo(img, mcx, mcy, mr, strength=54)
    crescent(img, mcx, mcy, mr, GOLD, phase=0.58)
    d = ImageDraw.Draw(img)
    frame_safe(d)
    for (sx, sy, sr) in [(0.28, 0.115, 10), (0.74, 0.13, 8), (0.235, 0.235, 7)]:
        star_glyph(d, W * sx, H * sy, sr, GOLD_D)

    fn_d = f(SANS, 30)
    center(d, date_label, fn_d, W / 2, H * 0.250, MUTE)

    # 暦名（主役）。「×」で区切って行に詰める（日名の途中で折らない）。
    parts = [x.strip() for x in senjitsu.split("×")]
    lines, cur = [], ""
    for pt in parts:
        cand = pt if not cur else cur + " × " + pt
        if len(cand.replace(" ", "")) > 11 and cur:
            lines.append(cur); cur = "× " + pt
        else:
            cur = cand
    if cur:
        lines.append(cur)
    fn_s = f(SERIF_B, 58 if max(len(l.replace(" ", "")) for l in lines) <= 11 else 50)
    for i, line in enumerate(lines):
        center(d, line, fn_s, W / 2, H * 0.302 + i * 84, GOLD)

    d.line([(W * 0.30, H * 0.440), (W * 0.70, H * 0.440)], fill=GOLD_D, width=2)

    # 暦の根拠4項目
    fn_i = f(SERIF, 29)
    y0 = H * 0.462
    for i, it in enumerate(items):
        y = y0 + i * 76
        mx = W * 0.185
        mw = marker(img, d, mx, y + 6, 30)
        center(d, it, fn_i, mx + mw + (W * 0.815 - mx) / 2, y, WHITE)

    y_next = H * 0.462 + len(items) * 76
    # 時刻行（分岐: window=None なら出さない）
    if window:
        if window_caption:
            fn_c = f(SANS, 25)
            center(d, window_caption, fn_c, W / 2, y_next + 22, MUTE)
        fn_w = f(SERIF_L, 46)
        center(d, window, fn_w, W / 2, y_next + 62, GOLD_F)
        y_next += 100
    # 絵文字指示（分岐: emoji=None なら出さない＝問いかけ型）
    if emoji:
        cta_line(img, d, y_next + 26, emoji, f(SERIF, 28))
        y_next += 76

    footer(img, d, note)
    img.save(path)
    return path


# ---------------------------------------------- 型B: 12星座カード（13時）
def make_seiza(path, title="今日の12星座", sub="あなたの星座、当たってた？",
               words=("直感が冴える日", "金運アップの兆し", "会話が弾む日",
                      "家族に優しく", "思い切りが吉", "整理整頓が開運",
                      "選択は直感で", "ヒラメキに従って", "新しい挑戦を",
                      "計画が実る日", "アイデアが光る", "直感を信じて"), note=None):
    check_seiza(title, sub, words)
    img = base(20260907, 0.24, 0.13)
    d = ImageDraw.Draw(img)
    frame_safe(d)
    star_glyph(d, W * 0.87, H * 0.13, 10, GOLD_D)
    star_glyph(d, W * 0.13, H * 0.21, 8, GOLD_D)

    fn_t = f(SERIF_B, 54)
    center(d, title, fn_t, W / 2, H * 0.118, GOLD)
    fn_s = f(SERIF, 32)
    center(d, sub, fn_s, W / 2, H * 0.184, MUTE)
    d.line([(W * 0.34, H * 0.234), (W * 0.66, H * 0.234)], fill=GOLD_D, width=2)

    cell_w, cell_h, gx, gy = 256, 188, 16, 16
    grid_w = 3 * cell_w + 2 * gx
    x0 = (W - grid_w) / 2
    y0 = H * 0.258

    sym_f = ImageFont.truetype(ZODIAC_FONT, 44) if ZODIAC_FONT else f(SERIF_B, 44)
    name_f = f(SANS, 22)
    word_f = f(SERIF_B, 24)

    for i, (sym, name) in enumerate(SIGNS):
        r, c = divmod(i, 3)
        x = x0 + c * (cell_w + gx)
        y = y0 + r * (cell_h + gy)
        cx, cy = x + cell_w / 2, y + cell_h / 2
        d.rounded_rectangle([x, y, x + cell_w, y + cell_h], radius=14,
                            fill=(38, 33, 72), outline=GOLD_D, width=2)
        # 記号（DejaVu Sans）: 上下を収める
        sb = d.textbbox((0, 0), sym, font=sym_f)
        sh = sb[3] - sb[1]
        d.text((cx - (sb[2] - sb[0]) / 2 - sb[0], y + 18 - sb[1]), sym,
               font=sym_f, fill=GOLD)
        center(d, name, name_f, cx, y + 62 + (sh - 44) // 2, MUTE)
        center(d, words[i], word_f, cx, y + 118, GOLD_F)

    footer(img, d, note)
    img.save(path)
    return path


# ---------------------------------------------- 型D: 診断カード（週1）
def make_shindan(path, topic="あなたの隠れ性格",
                 blocks=(("余り0", ("直感で動く・行動派", "始めるのが正解の日")),
                         ("余り1", ("慎重に考える・思考派", "調べるのが正解の日")),
                         ("余り2", ("周りを整える・調和派", "人と繋がるのが吉"))),
                 note=None):
    check_shindan(topic, blocks)
    img = base(20260907, 0.72, 0.14)
    d = ImageDraw.Draw(img)
    frame_safe(d)
    star_glyph(d, W * 0.86, H * 0.14, 10, GOLD_D)
    star_glyph(d, W * 0.16, H * 0.11, 7, GOLD_D)

    fn_l1 = f(SERIF_B, 46)
    center(d, "生まれた日を3で割った余りで", fn_l1, W / 2, H * 0.128, WHITE)
    fn_l2 = f(SERIF_B, 46)
    center(d, topic + "が分かります", fn_l2, W / 2, H * 0.196, GOLD)
    d.line([(W * 0.34, H * 0.248), (W * 0.66, H * 0.248)], fill=GOLD_D, width=2)

    bx0, bx1 = W * 0.13, W * 0.87
    b_h, b_gap = 224, 22
    y0 = H * 0.278
    lab_f = f(SERIF_B, 46)
    line_f = f(SERIF, 30)
    for i, (lab, lines) in enumerate(blocks):
        y = y0 + i * (b_h + b_gap)
        by = y + b_h / 2
        d.rounded_rectangle([bx0, y, bx1, y + b_h], radius=18,
                            fill=(38, 33, 72), outline=GOLD_D, width=2)
        center(d, lab, lab_f, W / 2, y + 26, GOLD)
        for j, ln in enumerate(lines):
            center(d, ln, line_f, W / 2, y + 106 + j * 48, WHITE)

    footer(img, d, note)
    img.save(path)
    return path


def contact_sheet(paths, path):
    n = len(paths)
    tw_, th = 360, 450
    sheet = Image.new("RGB", (tw_ * n + 20 * (n + 1), th + 40), (14, 12, 26))
    for i, p in enumerate(paths):
        im = Image.open(p).resize((tw_, th), Image.LANCZOS)
        sheet.paste(im, (20 + i * (tw_ + 20), 20))
    sheet.save(path)
    return path


MAKERS = {"koyomi": make_koyomi, "seiza": make_seiza, "shindan": make_shindan}

REQUIRED_FONTS = [
    ("NotoSerifCJK-Regular.ttc", "本文セリフ"),
    ("NotoSerifCJK-Bold.ttc", "見出し"),
    ("NotoSerifCJK-Light.ttc", "ロゴ・数字"),
    ("NotoSansCJK-Regular.ttc", "小見出し・URL"),
]


def check_env(verbose=True):
    import gen_brand as _gb
    missing = []
    rows = []
    for path, role in [(_gb.SERIF, "本文セリフ"), (_gb.SERIF_B, "見出し"),
                       (_gb.SERIF_L, "ロゴ・数字"), (_gb.SANS, "小見出し・URL"),
                       (ZODIAC_FONT or "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "星座記号"),]:
        ok = os.path.exists(path)
        rows.append(("OK  " if ok else "なし", role, path))
        if not ok:
            missing.append(path)
    rows.append((("OK  " if EMOJI_FONT else "なし"), "絵文字マーカー（無くても菱形で続行）",
                 EMOJI_FONT or "NotoColorEmoji.ttf"))
    if verbose:
        for st, role, path in rows:
            print("%s %-22s %s" % (st, role, path))
        if missing:
            print("\n不足フォントがあります。Debian/Ubuntu 系なら:")
            print("  apt-get install -y fonts-noto-cjk fonts-dejavu-core")
        else:
            print("\nすべて揃っています。")
    return missing


def render(spec, out):
    spec = dict(spec)
    t = spec.pop("template", "").lower()
    if t not in MAKERS:
        raise SystemExit("template は koyomi/seiza/shindan のいずれか（指定: %r）" % t)
    for k in ("items", "words", "blocks", "lines"):
        if k in spec and isinstance(spec[k], list):
            spec[k] = tuple(spec[k])
    return MAKERS[t](out, **spec)


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="ツキヨミ Threads投稿カードv2生成（1080x1350・暦/12星座/診断）")
    ap.add_argument("--spec", help='JSON文字列。例: \'{"template":"koyomi",'
                                   '"date_label":"明日 9月8日（火）",'
                                   '"senjitsu":"一粒万倍日 × 大安",'
                                   '"items":["一粒万倍日＝種まきに最適な日","大安＝何事も始めやすい日"]}\'')
    ap.add_argument("--spec-file", help="JSONファイル（- で標準入力）")
    ap.add_argument("-o", "--out", help="出力PNGパス")
    ap.add_argument("--samples", action="store_true",
                    help="3テンプレのサンプルとコンタクトシートを出力")
    ap.add_argument("--check-env", action="store_true",
                    help="必要フォントの有無を確認して終了（不足時は終了コード1）")
    a = ap.parse_args(argv)

    if a.check_env:
        raise SystemExit(1 if check_env() else 0)

    if a.samples or not (a.spec or a.spec_file):
        # 型Aサンプルは「吉時（情報）＋絵文字リアクション型」の分岐例。
        # 問いかけ型なら window/emoji を渡さない（時刻行・絵文字指示なし）。
        x = make_koyomi(os.path.join(OUT, "card-koyomi-1080x1350.png"),
                        window="15:00〜16:59頃", window_caption="今日の吉時", emoji="🕊️")
        y = make_seiza(os.path.join(OUT, "card-seiza-1080x1350.png"))
        z = make_shindan(os.path.join(OUT, "card-shindan-1080x1350.png"))
        sheet = contact_sheet([x, y, z], os.path.join(OUT, "_post-cards-contact-sheet.png"))
        for p in (x, y, z, sheet):
            print(p)
        return

    if a.spec_file:
        raw = sys.stdin.read() if a.spec_file == "-" else open(a.spec_file, encoding="utf-8").read()
    else:
        raw = a.spec
    spec = json.loads(raw)
    if not a.out:
        raise SystemExit("--out を指定してください")
    print(render(spec, a.out))


if __name__ == "__main__":
    main()
