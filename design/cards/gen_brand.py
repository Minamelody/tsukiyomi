#!/usr/bin/env python3
# ツキヨミ ブランド素材: OG画像（1200x630）と SNSプロフィール画像（正方形）
# gen.py と同じ手法: AI生成画像は使わず全要素をコード描画。配色も gen.py に合わせる。

import math, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops

OUT = os.path.dirname(os.path.abspath(__file__))

SERIF   = "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc"
SERIF_B = "/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc"
SERIF_L = "/usr/share/fonts/opentype/noto/NotoSerifCJK-Light.ttc"
SANS    = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"

DEEP   = (10, 8, 22)
PURPLE = (23, 21, 49)
PUR_HI = (46, 40, 88)
GOLD   = (245, 200, 105)
GOLD_D = (168, 133, 62)
GOLD_F = (255, 233, 186)
WHITE  = (245, 242, 236)
MUTE   = (166, 160, 190)


def f(path, size):
    return ImageFont.truetype(path, size)


def tw(d, txt, font):
    b = d.textbbox((0, 0), txt, font=font)
    return b[2] - b[0], b[3] - b[1]


def background(W, H, gx=0.30, gy=0.20, stars=420, seed=20260905):
    """gen.py の夜空背景を任意サイズに一般化したもの。"""
    D = max(W, H)
    img = Image.new("RGB", (W, H), DEEP)
    d = ImageDraw.Draw(img)
    for y in range(H):
        t = y / (H - 1)
        k = t ** 1.25
        c = tuple(int(PURPLE[i] + (DEEP[i] - PURPLE[i]) * k) for i in range(3))
        d.line([(0, y), (W, y)], fill=c)

    glow = Image.new("L", (W, H), 0)
    gd = ImageDraw.Draw(glow)
    gcx, gcy = W * gx, H * gy
    Rmax = int(D * 0.72)
    for r in range(Rmax, 0, -8):
        v = int(78 * (1 - r / Rmax) ** 1.7)
        gd.ellipse([gcx - r, gcy - r, gcx + r, gcy + r], fill=v)
    glow = glow.filter(ImageFilter.GaussianBlur(int(D * 0.026)))
    light = Image.new("RGB", (W, H), PUR_HI)
    img = Image.composite(Image.blend(img, light, 0.55), img, glow)

    st = Image.new("RGB", (W, H), (0, 0, 0))
    sd = ImageDraw.Draw(st)
    x = seed

    def nxt():
        nonlocal x
        x = (1103515245 * x + 12345) % (2 ** 31)
        return x

    for _ in range(stars):
        px, py = nxt() % W, nxt() % H
        n = nxt()
        r = 0.8 + (n % 4) * 0.55
        v = 45 + (n % 120)
        sd.ellipse([px - r, py - r, px + r, py + r],
                   fill=(v, int(v * 0.94), int(v * 0.86)))
    for _ in range(9):
        px, py = nxt() % W, nxt() % H
        L = 7 + (nxt() % 9)
        sd.line([(px - L, py), (px + L, py)], fill=(120, 112, 100))
        sd.line([(px, py - L), (px, py + L)], fill=(120, 112, 100))
        sd.ellipse([px - 2.4, py - 2.4, px + 2.4, py + 2.4], fill=(215, 205, 190))
    st = st.filter(ImageFilter.GaussianBlur(0.5))
    img = ImageChops.add(img, st)

    vig = Image.new("L", (W, H), 0)
    vd = ImageDraw.Draw(vig)
    y0 = int(H * 0.55)
    for y in range(y0, H):
        t = (y - y0) / max(1, H - y0)
        vd.line([(0, y), (W, y)], fill=int(120 * t ** 1.6))
    img = Image.composite(Image.new("RGB", (W, H), DEEP), img, vig)
    return img


def crescent(img, cx, cy, r, color, phase=0.60):
    ss = 5
    R = int(r * ss)
    m = Image.new("L", (R * 2 + 2, R * 2 + 2), 0)
    md = ImageDraw.Draw(m)
    md.ellipse([1, 1, R * 2, R * 2], fill=255)
    sh = R * phase
    md.ellipse([1 + sh, 1 - R * 0.04, sh + R * 2, R * 2 - R * 0.04], fill=0)
    tgt = int(r * 2) + 2
    m = m.resize((tgt, tgt), Image.LANCZOS)
    img.paste(Image.new("RGB", (tgt, tgt), color),
              (int(cx - tgt / 2), int(cy - tgt / 2)), m)


def halo(img, cx, cy, r, strength=52):
    """三日月のまわりの淡い光輪。"""
    W, H = img.size
    g = Image.new("L", (W, H), 0)
    gd = ImageDraw.Draw(g)
    for rr in range(int(r * 2.6), 0, -3):
        v = int(strength * (1 - rr / (r * 2.6)) ** 2.0)
        gd.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=v)
    g = g.filter(ImageFilter.GaussianBlur(r * 0.35))
    return Image.composite(Image.blend(img, Image.new("RGB", (W, H), GOLD_F), 0.30), img, g)


def frame(d, W, H, pad, corner):
    d.rectangle([pad, pad, W - pad, H - pad], outline=GOLD_D, width=2)
    d.rectangle([pad + 10, pad + 10, W - pad - 10, H - pad - 10],
                outline=(70, 58, 34), width=1)
    for (cx, cy, sx, sy) in [(pad, pad, 1, 1), (W - pad, pad, -1, 1),
                             (pad, H - pad, 1, -1), (W - pad, H - pad, -1, -1)]:
        d.line([(cx, cy), (cx + sx * corner, cy)], fill=GOLD, width=3)
        d.line([(cx, cy), (cx, cy + sy * corner)], fill=GOLD, width=3)


def star_glyph(d, cx, cy, r, color, width=2):
    """四芒星の小さな装飾。"""
    d.line([(cx - r, cy), (cx + r, cy)], fill=color, width=width)
    d.line([(cx, cy - r), (cx, cy + r)], fill=color, width=width)
    q = r * 0.34
    d.line([(cx - q, cy - q), (cx + q, cy + q)], fill=color, width=1)
    d.line([(cx - q, cy + q), (cx + q, cy - q)], fill=color, width=1)


# ---------------------------------------------------------------- OG 1200x630
def make_og(path):
    W, H = 1200, 630
    img = background(W, H, gx=0.24, gy=0.16, stars=520, seed=20260906)

    # 月を左側の主役として配置
    mcx, mcy, mr = W * 0.215, H * 0.47, 104
    img = halo(img, mcx, mcy, mr)
    crescent(img, mcx, mcy, mr, GOLD, phase=0.58)

    d = ImageDraw.Draw(img)
    frame(d, W, H, pad=26, corner=46)

    # 月まわりの小さな星
    for (sx, sy, sr) in [(0.325, 0.255, 9), (0.115, 0.70, 7), (0.335, 0.685, 6)]:
        star_glyph(d, W * sx, H * sy, sr, GOLD_D)

    # 右側テキストブロック
    tx = W * 0.395
    fn_word = f(SERIF_L, 82)
    word = "ツ キ ヨ ミ"
    d.text((tx, H * 0.215), word, font=fn_word, fill=GOLD)
    ww, wh = tw(d, word, fn_word)

    # ロゴ下の金罫
    ry = H * 0.215 + wh + 30
    d.line([(tx, ry), (tx + ww, ry)], fill=GOLD_D, width=2)

    fn_sub = f(SANS, 26)
    d.text((tx, ry + 26), "F O R T U N E  T E L L I N G", font=fn_sub, fill=MUTE)

    fn_tag = f(SERIF, 34)
    for i, line in enumerate(["名前と生年月日だけで、", "5つの占いを同時に。"]):
        d.text((tx, ry + 78 + i * 52), line, font=fn_tag, fill=WHITE)

    fn_kinds = f(SANS, 22)
    d.text((tx, ry + 78 + 2 * 52 + 22),
           "姓名判断 ・ 四柱推命 ・ タロット ・ 星座 ・ 西洋占星術",
           font=fn_kinds, fill=MUTE)

    img.save(path)
    return path


# ------------------------------------------------------- プロフィール（正方形）
def make_profile(path, S=1080):
    img = background(S, S, gx=0.30, gy=0.22, stars=380, seed=20250310)

    # 円形アイコンとして切り抜かれる前提で、中央に月＋ロゴを寄せる
    mcx, mcy, mr = S * 0.5, S * 0.385, S * 0.185
    img = halo(img, mcx, mcy, mr, strength=58)
    crescent(img, mcx, mcy, mr, GOLD, phase=0.58)

    d = ImageDraw.Draw(img)

    for (sx, sy, sr) in [(0.70, 0.235, 12), (0.285, 0.30, 9), (0.735, 0.50, 8)]:
        star_glyph(d, S * sx, S * sy, sr, GOLD_D)

    fn = f(SERIF_L, 116)
    word = "ツキヨミ"
    ww, wh = tw(d, word, fn)
    wy = S * 0.600
    d.text((S / 2 - ww / 2, wy), word, font=fn, fill=GOLD)

    # 罫線は文字の下端（descender含む）から十分に離す
    ry = wy + wh + 58
    d.line([(S / 2 - ww * 0.36, ry), (S / 2 + ww * 0.36, ry)], fill=GOLD_D, width=2)

    fn2 = f(SANS, 36)
    sub = "五 占 術 鑑 定"
    sw, _ = tw(d, sub, fn2)
    d.text((S / 2 - sw / 2, ry + 26), sub, font=fn2, fill=MUTE)

    img.save(path)

    # 円形マスクでの見え方確認用（実際のSNS表示に近い）
    prev = img.copy()
    m = Image.new("L", (S * 4, S * 4), 0)
    ImageDraw.Draw(m).ellipse([0, 0, S * 4, S * 4], fill=255)
    m = m.resize((S, S), Image.LANCZOS)
    circ = Image.new("RGB", (S, S), (18, 16, 30))
    circ.paste(prev, (0, 0), m)
    circ.save(path.replace(".png", "-circle-preview.png"))
    return path


if __name__ == "__main__":
    print(make_og(os.path.join(OUT, "og.png")))
    print(make_profile(os.path.join(OUT, "tsukiyomi-profile-1080.png")))
