#!/usr/bin/env python3
# ツキヨミ Threads投稿カード（1080x1350・縦長）
# gen_brand.py のブランド要素（夜空背景・三日月・金罫・四芒星）を再利用し、
# post-formula.md の T1/T2/T3 に対応する3テンプレを描画する。
# AI生成画像は使わず全要素をコード描画。AI表記は入れない（2026-09-06 B案確定）。

import os, sys, json, argparse
from PIL import Image, ImageDraw, ImageFont

# gen_brand.py（ブランド素材の描画プリミティブ）を探す。
# リポジトリ配置とサンドボックス配置でパスが違うので候補を順に試す。
_HERE = os.path.dirname(os.path.abspath(__file__))
_CANDIDATES = [
    os.path.join(_HERE, "..", "thumbs"),      # サンドボックス: work/tsukiyomi/{threads,thumbs}
    os.path.join(_HERE, "..", "thumbnails"),
    _HERE,                                     # 同ディレクトリに置かれた場合
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
                       GOLD, GOLD_D, GOLD_F, WHITE, MUTE)

OUT = os.path.dirname(os.path.abspath(__file__))
W, H = 1080, 1350
SITE = "minamelody.github.io/tsukiyomi"


EMOJI_FONT = next((p for p in [
    "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf",
    "/usr/share/fonts/truetype/noto-color-emoji/NotoColorEmoji.ttf",
    "/usr/share/fonts/NotoColorEmoji.ttf",
] if os.path.exists(p)), None)
_EMOJI_NATIVE = 109  # NotoColorEmoji はこのサイズしか受け付けないので描いてから縮小する


def emoji_img(ch, size):
    if not EMOJI_FONT:
        return None
    layer = Image.new("RGBA", (_EMOJI_NATIVE + 40, _EMOJI_NATIVE + 40), (0, 0, 0, 0))
    ImageDraw.Draw(layer).text((0, 0), ch, font=ImageFont.truetype(EMOJI_FONT, _EMOJI_NATIVE),
                               embedded_color=True)
    layer = layer.crop(layer.getbbox())
    r = size / max(layer.size)
    return layer.resize((max(1, int(layer.width * r)), max(1, int(layer.height * r))), Image.LANCZOS)


def cta_line(img, d, y, emoji, before, after, fsize=38, color=None):
    """「<emoji>」を置いてください の1行を、絵文字を画像として合成して中央に置く。"""
    color = color or WHITE
    fn = f(SERIF, fsize)
    em = emoji_img(emoji, int(fsize * 1.16))
    bw, _ = tw(d, before, fn)
    aw, _ = tw(d, after, fn)
    ew = em.width if em else 0
    x = W / 2 - (bw + ew + aw) / 2
    d.text((x, y), before, font=fn, fill=color)
    if em:
        img.paste(em, (int(x + bw), int(y - fsize * 0.10)), em)
    d.text((x + bw + ew, y), after, font=fn, fill=color)


# ---- 文字数の上限（超えるとレイアウトが崩れるので生成側で弾く） ----
LIMITS = {
    "t1": {"senjitsu_total": 34, "senjitsu_per_name": 11, "date_label": 20,
           "window": 16, "window_name": 8},
    "t2": {"pain_line": 22, "pain_lines": 2, "body_line": 22, "body_lines": 3},
    "t3": {"hook_line": 18, "hook_lines": 2, "body_line": 20, "body_lines": 3},
}


def _check(cond, msg):
    if not cond:
        raise ValueError("カード生成: " + msg)


def check_t1(senjitsu, date_label, window, window_name=None):
    L = LIMITS["t1"]
    names = [x.strip() for x in senjitsu.split("×") if x.strip()]
    _check(names, "senjitsu が空です")
    _check(len(senjitsu.replace(" ", "")) <= L["senjitsu_total"],
           "選日の合計が長すぎます（%d字 > %d字）" % (len(senjitsu.replace(" ", "")), L["senjitsu_total"]))
    for n in names:
        _check(len(n) <= L["senjitsu_per_name"], "選日名が長すぎます: %r" % n)
    _check(len(date_label) <= L["date_label"], "date_label が長すぎます: %r" % date_label)
    _check(len(window) <= L["window"], "window が長すぎます: %r" % window)
    if window_name:
        _check(len(window_name) <= L["window_name"],
               "window_name が長すぎます: %r" % window_name)


def check_lines(kind, key, lines):
    L = LIMITS[kind]
    _check(len(lines) <= L[key + "_lines"],
           "%s.%s の行数が多すぎます（%d行 > %d行）" % (kind, key, len(lines), L[key + "_lines"]))
    for ln in lines:
        _check(len(ln) <= L[key + "_line"], "%s.%s の1行が長すぎます: %r" % (kind, key, ln))


def wrap(txt, n):
    """日本語向け: 句読点で折らないよう n 文字目安で改行。"""
    out, line = [], ""
    for ch in txt:
        line += ch
        if len(line) >= n and ch not in "、。」）":
            out.append(line); line = ""
    if line:
        out.append(line)
    return out


def card_frame(d):
    """縦長カード用の金枠。gen_brand.frame より内側に細く。"""
    pad, corner = 34, 54
    d.rectangle([pad, pad, W - pad, H - pad], outline=GOLD_D, width=2)
    d.rectangle([pad + 11, pad + 11, W - pad - 11, H - pad - 11],
                outline=(70, 58, 34), width=1)
    for (cx, cy, sx, sy) in [(pad, pad, 1, 1), (W - pad, pad, -1, 1),
                             (pad, H - pad, 1, -1), (W - pad, H - pad, -1, -1)]:
        d.line([(cx, cy), (cx + sx * corner, cy)], fill=GOLD, width=3)
        d.line([(cx, cy), (cx, cy + sy * corner)], fill=GOLD, width=3)


def footer(d, emoji_label):
    """屋号 + URL + 絵文字CTAの控えめな足元。本文側にURLを貼らない前提でここに置く。"""
    # 金枠の内枠は H-45 にあるので、URL下端がそこに触れないよう足元全体を上げる。
    fy = H - 196
    d.line([(W * 0.16, fy), (W * 0.84, fy)], fill=(70, 58, 34), width=1)
    fn = f(SERIF, 40)
    word = "ツ キ ヨ ミ"
    ww, _ = tw(d, word, fn)
    d.text((W / 2 - ww / 2, fy + 24), word, font=fn, fill=GOLD)
    fn2 = f(SANS, 25)
    sw, _ = tw(d, SITE, fn2)
    d.text((W / 2 - sw / 2, fy + 86), SITE, font=fn2, fill=MUTE)
    if emoji_label:
        fn3 = f(SANS, 26)
        tw_, _ = tw(d, emoji_label, fn3)
        d.text((W / 2 - tw_ / 2, fy - 62), emoji_label, font=fn3, fill=GOLD_D)


def base(seed, gx, gy):
    return background(W, H, gx=gx, gy=gy, stars=560, seed=seed)


# ---------------------------------------------- T1 暦×時間限定型（朝 8:00）
def make_t1(path, senjitsu="一粒万倍日 × 母倉日 × 天恩日",
            date_label="2026年9月6日（日）", window="13:00〜14:59",
            window_name="未の刻", emoji="🌊"):
    """window / window_name は senjitsu.peak_window(date) の label / name をそのまま渡す。
    参考投稿の時間を流用せず、その日の十二支から出た時辰を使う。"""
    check_t1(senjitsu, date_label, window, window_name)
    img = base(20260906, 0.50, 0.17)
    mcx, mcy, mr = W * 0.5, H * 0.175, 118
    img = halo(img, mcx, mcy, mr, strength=58)
    crescent(img, mcx, mcy, mr, GOLD, phase=0.58)
    d = ImageDraw.Draw(img)
    card_frame(d)
    for (sx, sy, sr) in [(0.28, 0.115, 11), (0.74, 0.135, 9), (0.755, 0.255, 7)]:
        star_glyph(d, W * sx, H * sy, sr, GOLD_D)

    fn_d = f(SANS, 30)
    dw, _ = tw(d, date_label, fn_d)
    d.text((W / 2 - dw / 2, H * 0.295), date_label, font=fn_d, fill=MUTE)

    # 選日は本カードの主役。事実なので堂々と大きく置く。
    # 「×」で区切って行に詰める（日名の途中で折らない）。
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
    fn_s = f(SERIF_B, 52 if max(len(l.replace(" ", "")) for l in lines) <= 11 else 46)
    for i, line in enumerate(lines):
        lw, _ = tw(d, line, fn_s)
        d.text((W / 2 - lw / 2, H * 0.355 + i * 74), line, font=fn_s, fill=GOLD)
    del lines, cur, parts

    d.line([(W * 0.30, H * 0.535), (W * 0.70, H * 0.535)], fill=GOLD_D, width=2)

    fn_l = f(SANS, 27)
    lab = ("気が最も濃くなる " + window_name) if window_name else "気が最も濃くなる時間"
    lw, _ = tw(d, lab, fn_l)
    d.text((W / 2 - lw / 2, H * 0.565), lab, font=fn_l, fill=MUTE)

    # 「〜」は SERIF_L で字面が小さいので、時刻は数字と区切りを分けて描く
    fn_w = f(SERIF_L, 78)
    ww, _ = tw(d, window, fn_w)
    d.text((W / 2 - ww / 2, H * 0.615), window, font=fn_w, fill=GOLD_F)

    cta_line(img, d, H * 0.735, emoji, "「", "」を置いてください")

    footer(d, "姓名判断 ・ 四柱推命 ・ タロット ・ 星座 ・ 西洋占星術")
    img.save(path)
    return path


# ---------------------------------------------- T2 痛みの名指し型（昼 13:00）
def make_t2(path, pain=("最近、やたら出ていく方が多く", "手元に残らないあなたへ。"),
            body=("それは あなたの力不足ではなく", "名前の画数が示す流れの時期です。"),
            emoji="🗻"):
    check_lines("t2", "pain", pain); check_lines("t2", "body", body)
    img = base(20260907, 0.22, 0.82)
    d = ImageDraw.Draw(img)
    card_frame(d)

    # 上部は余白を広く取り、文字を主役にする（参考Bの構造）
    fn_p = f(SERIF_B, 50)
    for i, line in enumerate(pain):
        lw, _ = tw(d, line, fn_p)
        d.text((W / 2 - lw / 2, H * 0.185 + i * 78), line, font=fn_p, fill=WHITE)

    d.line([(W * 0.36, H * 0.395), (W * 0.64, H * 0.395)], fill=GOLD_D, width=2)

    fn_b = f(SERIF, 40)
    for i, line in enumerate(body):
        lw, _ = tw(d, line, fn_b)
        d.text((W / 2 - lw / 2, H * 0.435 + i * 66), line, font=fn_b, fill=GOLD_F)

    mcx, mcy, mr = W * 0.5, H * 0.655, 96
    img = halo(img, mcx, mcy, mr, strength=50)
    crescent(img, mcx, mcy, mr, GOLD, phase=0.58)
    d = ImageDraw.Draw(img)
    for (sx, sy, sr) in [(0.27, 0.615, 10), (0.75, 0.60, 8), (0.72, 0.715, 7)]:
        star_glyph(d, W * sx, H * sy, sr, GOLD_D)

    cta_line(img, d, H * 0.760, emoji, "「", "」を置いてください")

    footer(d, "名前と生まれた日だけで視ます")
    img.save(path)
    return path


# ---------------------------------------------- T3 選別・静かな誘導型（夜 21:00）
def make_t3(path, hook=("この時間に", "これを読んでいる人へ。"),
            body=("眠れないのではなく", "まだ終われないだけ。", "その感覚は当たっています。"),
            emoji="💫"):
    check_lines("t3", "hook", hook); check_lines("t3", "body", body)
    img = base(20260908, 0.78, 0.20)
    mcx, mcy, mr = W * 0.775, H * 0.185, 104
    img = halo(img, mcx, mcy, mr, strength=54)
    crescent(img, mcx, mcy, mr, GOLD, phase=0.62)
    d = ImageDraw.Draw(img)
    card_frame(d)
    for (sx, sy, sr) in [(0.30, 0.13, 12), (0.50, 0.235, 8), (0.235, 0.255, 7)]:
        star_glyph(d, W * sx, H * sy, sr, GOLD_D)

    # 左揃えで語りかける。中央揃えより独白に近い温度になる。
    tx = W * 0.135
    fn_h = f(SERIF_L, 52)
    for i, line in enumerate(hook):
        d.text((tx, H * 0.345 + i * 76), line, font=fn_h, fill=GOLD)

    d.line([(tx, H * 0.475), (tx + W * 0.30, H * 0.475)], fill=GOLD_D, width=2)

    fn_b = f(SERIF, 42)
    for i, line in enumerate(body):
        d.text((tx, H * 0.515 + i * 70), line, font=fn_b, fill=WHITE)

    fn_c = f(SERIF, 36)
    em = emoji_img(emoji, 42)
    bw, _ = tw(d, "「", fn_c)
    d.text((tx, H * 0.755), "「", font=fn_c, fill=GOLD_F)
    ew = 0
    if em:
        img.paste(em, (int(tx + bw), int(H * 0.755 + 2)), em)
        ew = em.width
    d.text((tx + bw + ew, H * 0.755), "」だけ置いてください", font=fn_c, fill=GOLD_F)
    fn_n = f(SANS, 25)
    d.text((tx, H * 0.800), "理由は聞きません。", font=fn_n, fill=MUTE)

    footer(d, None)
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


MAKERS = {"t1": make_t1, "t2": make_t2, "t3": make_t3}


def render(spec, out):
    """spec = {"template": "t1", ...template固有の引数}
    ジェネレータ側からは JSON を渡すだけでカードが1枚出る。
    T1は選日データ（実在するもの）を呼び出し側が入れる前提。"""
    spec = dict(spec)
    t = spec.pop("template", "").lower()
    if t not in MAKERS:
        raise SystemExit("template は t1/t2/t3 のいずれか（指定: %r）" % t)
    for k in ("pain", "body", "hook"):
        if k in spec and isinstance(spec[k], list):
            spec[k] = tuple(spec[k])
    return MAKERS[t](out, **spec)


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="ツキヨミ Threads投稿カード生成（1080x1350）")
    ap.add_argument("--spec", help='JSON文字列。例: \'{"template":"t1",'
                                   '"senjitsu":"天赦日 × 大安","date_label":"2026年9月10日（木）",'
                                   '"window":"6:00 — 9:59","emoji":"🌊"}\'')
    ap.add_argument("--spec-file", help="JSONファイル（- で標準入力）")
    ap.add_argument("-o", "--out", help="出力PNGパス")
    ap.add_argument("--samples", action="store_true",
                    help="3テンプレのサンプルとコンタクトシートを出力")
    a = ap.parse_args(argv)

    if a.samples or not (a.spec or a.spec_file):
        x = make_t1(os.path.join(OUT, "card-t1-koyomi-1080x1350.png"))
        y = make_t2(os.path.join(OUT, "card-t2-pain-1080x1350.png"))
        z = make_t3(os.path.join(OUT, "card-t3-night-1080x1350.png"))
        sheet = contact_sheet([x, y, z], os.path.join(OUT, "_cards-contact-sheet.png"))
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
