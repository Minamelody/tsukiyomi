#!/usr/bin/env python3
# 鑑定書PDFに差し込む図版を、顧客の実データから生成する。
#
# サムネイルと同じ絵柄・同じ配色で描くので、
# 「サムネで見た通りのものが届いた」が成立する。
# AI生成画像は使わない。全要素をコードで描画する。
#
# 単体テスト:
#   python3 src/figures.py --demo out/figs

import io, os, json, math, base64, argparse
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops

SERIF   = "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc"
SERIF_B = "/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc"
SANS    = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"

# サムネイルと共通のパレット
PAPER  = (23, 21, 49)      # #171531
PAPER2 = (16, 14, 36)
GOLD   = (245, 200, 105)   # #f5c869
GOLD_D = (168, 133, 62)
GOLD_F = (255, 233, 186)
WHITE  = (245, 242, 236)
MUTE   = (166, 160, 190)
ROSE   = (196, 108, 118)
GREEN  = (128, 186, 140)

SCALE = 2   # 印刷用に2倍で描いて縮小しない（PDF側で幅指定）


def _f(path, size):
    return ImageFont.truetype(path, int(size * SCALE))

def _tw(d, t, f):
    b = d.textbbox((0, 0), t, font=f)
    return b[2] - b[0], b[3] - b[1]

def _ctr(d, t, f, cx, y, fill):
    w, _ = _tw(d, t, f)
    d.text((cx - w / 2, y), t, font=f, fill=fill)

def _canvas(w, h):
    W, H = int(w * SCALE), int(h * SCALE)
    img = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(img)
    for y in range(H):
        t = y / max(1, H - 1)
        c = tuple(int(PAPER[i] + (PAPER2[i] - PAPER[i]) * t) for i in range(3))
        d.line([(0, y), (W, y)], fill=c)
    # 金の細罫
    d.rectangle([2, 2, W - 3, H - 3], outline=GOLD_D, width=2)
    return img, d, W, H


def _caption(d, W, H, text):
    fn = _f(SANS, 9)
    w, hh = _tw(d, text, fn)
    d.text((W / 2 - w / 2, H - hh - 12 * SCALE), text, font=fn, fill=MUTE)


def _out(img, path=None):
    """PNGバイト列を返す。path指定時はファイルにも書く。"""
    buf = io.BytesIO()
    img.save(buf, "PNG")
    b = buf.getvalue()
    if path:
        with open(path, "wb") as f:
            f.write(b)
    return b


def _dashed_rect(d, x0, y0, x1, y1, color, dash=4, width=1):
    """破線の矩形。霊数のような「補った枠」を実画数の枠と区別するために使う。"""
    dash = dash * SCALE
    for (ax, ay, bx2, by) in [(x0, y0, x1, y0), (x0, y1, x1, y1)]:
        x = ax
        while x < bx2:
            d.line([(x, ay), (min(x + dash, bx2), by)], fill=color, width=width)
            x += dash * 2
    for (ax, ay, bx2, by) in [(x0, y0, x0, y1), (x1, y0, x1, y1)]:
        y = ay
        while y < by:
            d.line([(ax, y), (bx2, min(y + dash, by))], fill=color, width=width)
            y += dash * 2


def _luck_color(luck):
    if "大吉" in luck:
        return GOLD_F
    if "吉" in luck:
        return GREEN
    return ROSE


# ---------------- 姓名判断: 五格の画数入り枠 ----------------

def fig_seimei(data, path=None):
    """data: {sei, mei, strokes:{sei:[],mei:[]}, kaku:{天格:{n,luck,meaning},...}}"""
    img, d, W, H = _canvas(430, 276)
    kaku = data["kaku"]
    sei, mei = data["sei"], data["mei"]
    st = data["strokes"]
    chars = list(sei) + list(mei)
    nums = list(st["sei"]) + list(st["mei"])
    reisu = data.get("reisu") or []

    # 左: 名前の縦組み（各字の画数を添える）
    bx = 52 * SCALE
    bw = 52 * SCALE
    bh = 42 * SCALE
    top = (60 if (data.get("reisu") or []) and "姓" in (data.get("reisu") or []) else 44) * SCALE
    fc = _f(SERIF, 22)
    fn = _f(SANS, 10)
    for i, ch in enumerate(chars):
        y = top + i * (bh + 5 * SCALE)
        d.rectangle([bx, y, bx + bw, y + bh], outline=GOLD_D, width=2)
        w, hh = _tw(d, ch, fc)
        d.text((bx + bw / 2 - w / 2, y + bh / 2 - hh / 2 - 3 * SCALE), ch, font=fc, fill=WHITE)
        lab = f"{nums[i]}画"
        w2, hh2 = _tw(d, lab, fn)
        d.text((bx + bw + 8 * SCALE, y + bh / 2 - hh2 / 2), lab, font=fn, fill=MUTE)

    # 霊数の枠（破線）。姓が一字なら姓の「上」、名が一字なら名の「下」に置く。
    # 実画数の枠（実線）と重ならない位置に描くこと。
    rh = bh * 0.60
    if "姓" in reisu:
        ry = top - rh - 6 * SCALE
        _dashed_rect(d, bx, ry, bx + bw, ry + rh, GOLD_D)
        t = "霊 1"
        w3, hh3 = _tw(d, t, fn)
        d.text((bx + bw / 2 - w3 / 2, ry + rh / 2 - hh3 / 2), t, font=fn, fill=GOLD_D)
    if "名" in reisu:
        ry = top + len(chars) * (bh + 5 * SCALE) + 1 * SCALE
        _dashed_rect(d, bx, ry, bx + bw, ry + rh, GOLD_D)
        t = "霊 1"
        w3, hh3 = _tw(d, t, fn)
        d.text((bx + bw / 2 - w3 / 2, ry + rh / 2 - hh3 / 2), t, font=fn, fill=GOLD_D)
    # 姓名の区切り
    ysep = top + len(sei) * (bh + 5 * SCALE) - 3 * SCALE
    d.line([(bx - 10 * SCALE, ysep), (bx + bw + 4 * SCALE, ysep)], fill=GOLD, width=2)

    # 右: 五格の表
    tx = 190 * SCALE
    rowh = 33 * SCALE
    ty = 34 * SCALE
    fh = _f(SANS, 11)
    fnum = _f(SERIF_B, 17)
    fl = _f(SANS, 10)
    fm = _f(SANS, 9)
    order = ["天格", "人格", "地格", "外格", "総格"]
    for i, k in enumerate(order):
        v = kaku[k]
        y = ty + i * rowh
        hot = (k == "総格")
        if hot:
            d.rectangle([tx - 6 * SCALE, y - 3 * SCALE, W - 18 * SCALE, y + rowh - 8 * SCALE],
                        fill=(34, 30, 66))
        d.text((tx, y + 4 * SCALE), k, font=fh, fill=GOLD if hot else MUTE)
        ns = str(v["n"])
        d.text((tx + 42 * SCALE, y), ns, font=fnum, fill=WHITE)
        w, _ = _tw(d, ns, fnum)
        d.text((tx + 42 * SCALE + w + 2 * SCALE, y + 7 * SCALE), "画", font=fm, fill=MUTE)
        lc = _luck_color(v["luck"])
        d.text((tx + 88 * SCALE, y + 3 * SCALE), v["luck"], font=fl, fill=lc)
        # 枠に収まる文字数まで詰める（固定16字だと右の金罫を突き抜ける）
        mx = tx + 122 * SCALE
        avail = (W - 22 * SCALE) - mx
        mtxt = v["meaning"]
        while mtxt and _tw(d, mtxt, fm)[0] > avail:
            mtxt = mtxt[:-1]
        if mtxt != v["meaning"] and len(mtxt) > 1:
            mtxt = mtxt[:-1] + "…"
        d.text((mx, y + 4 * SCALE), mtxt, font=fm, fill=MUTE)
        d.line([(tx - 6 * SCALE, y + rowh - 7 * SCALE), (W - 18 * SCALE, y + rowh - 7 * SCALE)],
               fill=(58, 52, 88), width=1)

    _ctr(d, "五 格 一 覧", _f(SANS, 10), (tx + W - 18 * SCALE) / 2, 14 * SCALE, GOLD_D)
    if reisu:
        # 霊数が効く格は補った側で決まる: 姓一字→天格 / 名一字→地格。
        # 一律「天格・地格」と書くと、片側だけ一字の人には合わない注記になる。
        side = "・".join(reisu)
        aff = "・".join((["天格"] if "姓" in reisu else []) + (["地格"] if "名" in reisu else []))
        _ctr(d, f"※{side}が一字のため、霊数1を補って{aff}を算出（総格には含めません）",
             _f(SANS, 8), W / 2, H - 30 * SCALE, GOLD_D)
    _caption(d, W, H, f"{sei}{mei} さんの画数と五格")
    return _out(img, path)


# ---------------- 四柱推命: 命式の四柱 + 五行 ----------------

ELEM_COLOR = {"木": (132, 186, 140), "火": (214, 118, 108), "土": (204, 168, 104),
              "金": (222, 218, 226), "水": (128, 156, 214)}

def fig_shichu(data, path=None):
    """data: {pillars:{年柱:{kan,shi,label},...}, elements:{木:n,...}, missing:[], strongest, nikkan:{}}"""
    img, d, W, H = _canvas(430, 336)
    pil = data["pillars"]
    order = [k for k in ["年柱", "月柱", "日柱", "時柱"] if k in pil]

    colw = 62 * SCALE
    gap = 14 * SCALE
    total = colw * len(order) + gap * (len(order) - 1)
    x0 = (W - total) / 2
    top = 34 * SCALE
    h = 132 * SCALE
    fh = _f(SANS, 10)
    fk = _f(SERIF_B, 26)
    for i, k in enumerate(order):
        v = pil[k]
        x = x0 + i * (colw + gap)
        hot = (k == "日柱")
        d.rectangle([x, top, x + colw, top + h], fill=(31, 27, 62),
                    outline=GOLD if hot else GOLD_D, width=3 if hot else 2)
        d.rectangle([x, top, x + colw, top + 22 * SCALE],
                    fill=(60, 48, 26) if hot else (38, 34, 70))
        w, hh = _tw(d, k, fh)
        d.text((x + colw / 2 - w / 2, top + 11 * SCALE - hh / 2), k, font=fh,
               fill=GOLD if hot else MUTE)
        for j, ch in enumerate((v["kan"], v["shi"])):
            w, hh = _tw(d, ch, fk)
            d.text((x + colw / 2 - w / 2, top + (36 + j * 48) * SCALE), ch, font=fk,
                   fill=WHITE if hot else (208, 202, 226))
        d.line([(x + 12 * SCALE, top + 82 * SCALE), (x + colw - 12 * SCALE, top + 82 * SCALE)],
               fill=(96, 84, 52), width=1)
    # 天干/地支のラベル
    fl = _f(SANS, 8)
    d.text((x0 - 34 * SCALE, top + 46 * SCALE), "天干", font=fl, fill=MUTE)
    d.text((x0 - 34 * SCALE, top + 94 * SCALE), "地支", font=fl, fill=MUTE)

    # 五行バランス
    els = ["木", "火", "土", "金", "水"]
    counts = data["elements"]
    mx = max(1, max(counts.values()))
    by = top + h + 52 * SCALE
    bh = 52 * SCALE
    bw = 30 * SCALE
    step = 62 * SCALE
    bx0 = (W - (step * 4 + bw)) / 2
    fe = _f(SERIF, 13)
    fnum = _f(SANS, 9)
    for i, e in enumerate(els):
        x = bx0 + i * step
        n = counts.get(e, 0)
        d.rectangle([x, by, x + bw, by + bh], outline=(74, 64, 108), width=1)
        if n:
            hh = bh * n / mx
            d.rectangle([x, by + bh - hh, x + bw, by + bh], fill=ELEM_COLOR[e])
        w, th = _tw(d, e, fe)
        d.text((x + bw / 2 - w / 2, by + bh + 6 * SCALE), e, font=fe,
               fill=MUTE if not n else WHITE)
        lab = "欠" if not n else str(n)
        w2, th2 = _tw(d, lab, fnum)
        d.text((x + bw / 2 - w2 / 2, by - 15 * SCALE), lab, font=fnum,
               fill=ROSE if not n else GOLD)
    d.line([(bx0, by + bh), (bx0 + step * 4 + bw, by + bh)], fill=GOLD_D, width=2)
    _ctr(d, "五 行 バ ラ ン ス", _f(SANS, 9), W / 2, by - 34 * SCALE, GOLD_D)

    miss = data.get("missing") or []
    cap = f"日干 {data['nikkan']['kan']}（{data['nikkan']['element']}）・最強 {data['strongest']}"
    if miss:
        cap += f"・欠け {'・'.join(miss)}"
    _caption(d, W, H, cap)
    return _out(img, path)


# ---------------- タロット: 引いた3枚 ----------------

# 大アルカナ22枚 → 記号系統の対応表（番号ではなく実際のカードに合わせる）
ARCANA_SYMBOL = {
    0: "star", 1: "wand", 2: "moon", 3: "cup", 4: "tower", 5: "pillar",
    6: "cup", 7: "wheel", 8: "wand", 9: "moon", 10: "wheel", 11: "scale",
    12: "pillar", 13: "scythe", 14: "cup", 15: "tower", 16: "tower",
    17: "star", 18: "moon", 19: "sun", 20: "trumpet", 21: "world",
}


def _card_symbol(cd, cx, cy, r, num, img=None):
    """カードの実際の意味に合う記号を描く。"""
    kind = ARCANA_SYMBOL.get(int(num), "star")

    if kind == "star":
        for i in range(5):
            a1 = -math.pi / 2 + i * 2 * math.pi / 5
            a2 = -math.pi / 2 + (i + 2) * 2 * math.pi / 5
            cd.line([(cx + r * math.cos(a1), cy + r * math.sin(a1)),
                     (cx + r * math.cos(a2), cy + r * math.sin(a2))], fill=GOLD, width=2)
    elif kind == "sun":
        cd.ellipse([cx - r * .5, cy - r * .5, cx + r * .5, cy + r * .5], outline=GOLD, width=2)
        for i in range(8):
            a = i * math.pi / 4
            cd.line([(cx + r * .74 * math.cos(a), cy + r * .74 * math.sin(a)),
                     (cx + r * 1.06 * math.cos(a), cy + r * 1.06 * math.sin(a))], fill=GOLD, width=2)
    elif kind == "moon":
        cd.ellipse([cx - r * .8, cy - r * .8, cx + r * .8, cy + r * .8], fill=GOLD)
        cd.ellipse([cx - r * .8 + r * .5, cy - r * .84, cx + r * .8 + r * .5, cy + r * .76],
                   fill=(31, 27, 62))
    elif kind == "wheel":
        cd.ellipse([cx - r * .82, cy - r * .82, cx + r * .82, cy + r * .82], outline=GOLD, width=2)
        cd.ellipse([cx - r * .22, cy - r * .22, cx + r * .22, cy + r * .22], outline=GOLD, width=2)
        for i in range(8):
            a = i * math.pi / 4
            cd.line([(cx + r * .22 * math.cos(a), cy + r * .22 * math.sin(a)),
                     (cx + r * .82 * math.cos(a), cy + r * .82 * math.sin(a))], fill=GOLD, width=1)
    elif kind == "cup":
        cd.arc([cx - r * .62, cy - r * .78, cx + r * .62, cy + r * .28], 0, 180, fill=GOLD, width=2)
        cd.line([(cx - r * .62, cy - r * .78), (cx + r * .62, cy - r * .78)], fill=GOLD, width=2)
        cd.line([(cx, cy + r * .28), (cx, cy + r * .78)], fill=GOLD, width=2)
        cd.line([(cx - r * .44, cy + r * .78), (cx + r * .44, cy + r * .78)], fill=GOLD, width=2)
    elif kind == "wand":
        cd.line([(cx - r * .55, cy + r * .75), (cx + r * .45, cy - r * .55)], fill=GOLD, width=3)
        for i in range(6):
            a = i * math.pi / 3
            cd.line([(cx + r * .45, cy - r * .55),
                     (cx + r * .45 + r * .34 * math.cos(a), cy - r * .55 + r * .34 * math.sin(a))],
                    fill=GOLD, width=2)
    elif kind == "scale":
        cd.line([(cx, cy - r * .8), (cx, cy + r * .8)], fill=GOLD, width=2)
        cd.line([(cx - r * .72, cy - r * .42), (cx + r * .72, cy - r * .42)], fill=GOLD, width=2)
        for sx in (-1, 1):
            bx = cx + sx * r * .72
            cd.arc([bx - r * .30, cy - r * .30, bx + r * .30, cy + r * .28], 0, 180,
                   fill=GOLD, width=2)
            cd.line([(bx, cy - r * .42), (bx, cy - r * .16)], fill=GOLD, width=1)
        cd.line([(cx - r * .40, cy + r * .8), (cx + r * .40, cy + r * .8)], fill=GOLD, width=2)
    elif kind == "scythe":
        cd.line([(cx - r * .30, cy + r * .82), (cx + r * .22, cy - r * .70)], fill=GOLD, width=3)
        cd.arc([cx - r * .92, cy - r * .96, cx + r * .38, cy - r * .10], 195, 350,
               fill=GOLD, width=3)
    elif kind == "trumpet":
        cd.line([(cx - r * .78, cy + r * .30), (cx + r * .30, cy - r * .18)], fill=GOLD, width=3)
        cd.polygon([(cx + r * .30, cy - r * .52), (cx + r * .88, cy - r * .80),
                    (cx + r * .88, cy + r * .28), (cx + r * .30, cy + r * .10)],
                   outline=GOLD, width=2)
    elif kind == "world":
        cd.ellipse([cx - r * .86, cy - r * .86, cx + r * .86, cy + r * .86], outline=GOLD, width=3)
        cd.ellipse([cx - r * .34, cy - r * .34, cx + r * .34, cy + r * .34], outline=GOLD, width=2)
        cd.line([(cx - r * .86, cy), (cx + r * .86, cy)], fill=GOLD, width=1)
        for i in range(4):
            a = math.pi / 4 + i * math.pi / 2
            cd.line([(cx + r * .86 * math.cos(a), cy + r * .86 * math.sin(a)),
                     (cx + r * 1.10 * math.cos(a), cy + r * 1.10 * math.sin(a))],
                    fill=GOLD, width=2)
    elif kind == "pillar":
        for sx in (-1, 1):
            x = cx + sx * r * .52
            cd.rectangle([x - r * .17, cy - r * .58, x + r * .17, cy + r * .82],
                         outline=GOLD, width=2)
            cd.rectangle([x - r * .28, cy - r * .74, x + r * .28, cy - r * .58],
                         outline=GOLD, width=2)
    else:  # tower
        cd.polygon([(cx - r * .5, cy + r * .82), (cx - r * .34, cy - r * .5),
                    (cx + r * .34, cy - r * .5), (cx + r * .5, cy + r * .82)],
                   outline=GOLD, width=2)
        cd.line([(cx - r * .5, cy - r * .5), (cx + r * .5, cy - r * .5)], fill=GOLD, width=2)
        cd.polygon([(cx, cy - r * .92), (cx - r * .3, cy - r * .5), (cx + r * .3, cy - r * .5)],
                   outline=GOLD, width=2)


def fig_tarot(cards, path=None):
    """cards: [{position, card, number, reversed, orientation, meaning}, ...]"""
    img, d, W, H = _canvas(430, 260)
    n = len(cards)
    cw, ch = 92 * SCALE, 148 * SCALE
    gap = 22 * SCALE
    total = cw * n + gap * (n - 1)
    x0 = (W - total) / 2
    top = 34 * SCALE
    fpos = _f(SANS, 10)
    fname = _f(SERIF_B, 12)
    fori = _f(SANS, 9)
    fnum = _f(SANS, 8)
    for i, c in enumerate(cards):
        x = x0 + i * (cw + gap)
        card = Image.new("RGBA", (int(cw) + 8, int(ch) + 8), (0, 0, 0, 0))
        cd = ImageDraw.Draw(card)
        cd.rounded_rectangle([4, 4, cw + 3, ch + 3], radius=8 * SCALE, fill=(31, 27, 62),
                             outline=GOLD_D, width=2)
        cd.rounded_rectangle([11, 11, cw - 4, ch - 4], radius=6 * SCALE,
                             outline=(104, 86, 48), width=1)
        _card_symbol(cd, (cw + 7) / 2, ch * 0.50, cw * 0.26, int(c["number"]))
        if c.get("reversed"):
            card = card.rotate(180)
        img.paste(card, (int(x), int(top)), card)

        # ラベル
        cx = x + cw / 2
        _ctr(d, c["position"], fpos, cx, top - 22 * SCALE, GOLD)
        y = top + ch + 12 * SCALE
        _ctr(d, c["card"], fname, cx, y, WHITE)
        ori = c.get("orientation") or ("逆位置" if c.get("reversed") else "正位置")
        _ctr(d, f"No.{c['number']} ・ {ori}", fori, cx, y + 20 * SCALE,
             ROSE if c.get("reversed") else GREEN)

    _caption(d, W, H, "実際に引いた3枚（逆位置はカードを反転して表示）")
    return _out(img, path)


# ---------------- 西洋占星術: ホロスコープ円 ----------------

SIGN_ORDER = ["牡羊座", "牡牛座", "双子座", "蟹座", "獅子座", "乙女座",
              "天秤座", "蠍座", "射手座", "山羊座", "水瓶座", "魚座"]

def _sun(d, x, y, g):
    d.ellipse([x - g, y - g, x + g, y + g], outline=GOLD_F, width=2 * SCALE)
    d.ellipse([x - g * .22, y - g * .22, x + g * .22, y + g * .22], fill=GOLD_F)

def _moon(img, x, y, g):
    ss = 4
    R = int(g * ss)
    m = Image.new("L", (R * 2 + 2, R * 2 + 2), 0)
    md = ImageDraw.Draw(m)
    md.ellipse([1, 1, R * 2, R * 2], fill=255)
    md.ellipse([1 + R * .52, 1, R * .52 + R * 2, R * 2], fill=0)
    t = int(g * 2) + 2
    m = m.resize((t, t), Image.LANCZOS)
    img.paste(Image.new("RGB", (t, t), GOLD_F), (int(x - t / 2), int(y - t / 2)), m)

def _asc_glyph(d, x, y, g):
    # 上昇宮は上向きの矢
    d.line([(x, y + g), (x, y - g)], fill=GOLD_F, width=2 * SCALE)
    d.polygon([(x, y - g * 1.5), (x - g * .55, y - g * .6), (x + g * .55, y - g * .6)], fill=GOLD_F)


def fig_astro(data, path=None):
    """data: {sun:{name,element}, moon:{name}, ascendant:{name}, dominantElement}"""
    img, d, W, H = _canvas(430, 356)
    cx, cy = W / 2, 142 * SCALE
    R = 108 * SCALE
    d.ellipse([cx - R, cy - R, cx + R, cy + R], outline=GOLD, width=3)
    d.ellipse([cx - R * .84, cy - R * .84, cx + R * .84, cy + R * .84], outline=GOLD_D, width=2)
    d.ellipse([cx - R * .28, cy - R * .28, cx + R * .28, cy + R * .28], outline=(112, 92, 52), width=1)

    fs = _f(SANS, 7)
    for i in range(12):
        a = -math.pi / 2 + i * math.pi / 6
        d.line([(cx + R * .84 * math.cos(a), cy + R * .84 * math.sin(a)),
                (cx + R * math.cos(a), cy + R * math.sin(a))], fill=GOLD_D, width=2)
        # 宮名
        am = a + math.pi / 12
        lx = cx + R * .92 * math.cos(am)
        ly = cy + R * .92 * math.sin(am)
        nm = SIGN_ORDER[i][:-1]   # 「座」を落として省スペース
        w, hh = _tw(d, nm, fs)
        d.text((lx - w / 2, ly - hh / 2), nm, font=fs, fill=MUTE)

    # 三要素の配置（太陽・月・上昇宮を該当宮の位置に置く）
    def ang_of(sign):
        try:
            i = SIGN_ORDER.index(sign)
        except ValueError:
            i = 0
        return -math.pi / 2 + (i + 0.5) * math.pi / 6

    items = [("太陽", data["sun"]["name"], _sun), ("月", data["moon"]["name"], None),
             ("上昇宮", data["ascendant"]["name"], _asc_glyph)]
    pos = []
    used = {}
    for label, sign, fn in items:
        a = ang_of(sign)
        k = used.get(sign, 0)
        used[sign] = k + 1
        rad = R * (.62 - k * .26)     # 同じ宮に複数あるときは内側へずらす
        pos.append((cx + rad * math.cos(a), cy + rad * math.sin(a)))
    # 三角のアスペクト線
    for i in range(3):
        d.line([pos[i], pos[(i + 1) % 3]], fill=(112, 102, 162), width=2)
    fl = _f(SANS, 9)
    for (label, sign, fn), (x, y) in zip(items, pos):
        rr = 17 * SCALE
        d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=(31, 27, 62), outline=GOLD_D, width=1)
        if fn is _sun:
            _sun(d, x, y, 8 * SCALE)
        elif fn is _asc_glyph:
            _asc_glyph(d, x, y, 8 * SCALE)
        else:
            _moon(img, x, y, 9 * SCALE)

    # 凡例
    ly0 = cy + R + 30 * SCALE
    fk = _f(SANS, 10)
    fv = _f(SERIF_B, 12)
    cols = [("太陽（表の顔）", data["sun"]["name"]), ("月（内面）", data["moon"]["name"]),
            ("上昇宮（第一印象）", data["ascendant"]["name"])]
    colw = W / 3
    for i, (k, v) in enumerate(cols):
        x = colw * (i + 0.5)
        _ctr(d, k, fk, x, ly0, MUTE)
        _ctr(d, v, fv, x, ly0 + 16 * SCALE, GOLD)
    _caption(d, W, H, f"優勢エレメント: {data.get('dominantElement', '-')}"
                      " / 同じ宮に重なる場合は内側にずらして表示")
    return _out(img, path)


# ---------------- 共通: 扉ページの紋章 ----------------

def fig_divider(kind, path=None):
    """各占術の扉ページに置く紋章。サムネのモチーフを小さく描く。"""
    img, d, W, H = _canvas(300, 300)
    cx, cy = W / 2, H / 2
    R = 96 * SCALE
    d.ellipse([cx - R, cy - R, cx + R, cy + R], outline=GOLD_D, width=2)
    d.ellipse([cx - R * 1.08, cy - R * 1.08, cx + R * 1.08, cy + R * 1.08],
              outline=(70, 58, 34), width=1)
    s = R * 1.15

    if kind == "seimei":
        pw, ph = s * 0.36, s * 0.86
        d.rectangle([cx - pw / 2, cy - ph / 2, cx + pw / 2, cy + ph / 2], outline=GOLD, width=3)
        fn = _f(SERIF, 22)
        for i, ch in enumerate(["姓", "名"]):
            w, hh = _tw(d, ch, fn)
            d.text((cx - w / 2, cy - ph / 2 + ph * (0.14 + i * 0.44)), ch, font=fn, fill=WHITE)
    elif kind == "seiza":
        pts = [(-.66, -.38), (-.26, -.58), (.04, -.24), (.42, -.44), (.62, .02),
               (.24, .22), (-.14, .13), (-.43, .44)]
        P = [(cx + px * s, cy + py * s) for px, py in pts]
        for i in range(len(P) - 1):
            d.line([P[i], P[i + 1]], fill=GOLD_D, width=2)
        for i, (x, y) in enumerate(P):
            rr = s * (0.030 if i in (1, 4, 7) else 0.018)
            d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=GOLD_F if i in (1, 4, 7) else GOLD)
    elif kind == "tarot":
        cw, ch = s * 0.34, s * 0.56
        for i, off in enumerate((-1, 0, 1)):
            x = cx + off * (cw * 1.14)
            y = cy + (0 if off == 0 else s * 0.045)
            d.rounded_rectangle([x - cw / 2, y - ch / 2, x + cw / 2, y + ch / 2],
                                radius=int(s * 0.05), outline=GOLD if off == 0 else GOLD_D,
                                width=3 if off == 0 else 2, fill=(31, 27, 62))
            _card_symbol(d, x, y, cw * 0.26, (17, 18, 19)[i])
    elif kind == "shichu":
        colw, gap = s * 0.20, s * 0.055
        total = colw * 3 + gap * 2
        x0 = cx - total / 2
        hh = s * 0.72
        fn = _f(SERIF_B, 17)
        for i, ch in enumerate(["年", "月", "日"]):
            x = x0 + i * (colw + gap)
            d.rectangle([x, cy - hh / 2, x + colw, cy + hh / 2],
                        outline=GOLD if i == 2 else GOLD_D, width=3 if i == 2 else 2)
            w, th = _tw(d, ch, fn)
            d.text((x + colw / 2 - w / 2, cy - hh / 2 + hh * 0.16), ch, font=fn,
                   fill=WHITE if i == 2 else MUTE)
    else:  # astro
        rr = s * 0.80
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=GOLD, width=3)
        d.ellipse([cx - rr * .66, cy - rr * .66, cx + rr * .66, cy + rr * .66],
                  outline=GOLD_D, width=1)
        for i in range(12):
            a = -math.pi / 2 + i * math.pi / 6
            d.line([(cx + rr * .66 * math.cos(a), cy + rr * .66 * math.sin(a)),
                    (cx + rr * math.cos(a), cy + rr * math.sin(a))], fill=GOLD_D, width=2)
        _sun(d, cx, cy - rr * .34, s * 0.075)
        _moon(img, cx - rr * .30, cy + rr * .26, s * 0.085)
    return _out(img, path)


BUILDERS = {
    "seimei": fig_seimei,
    "shichu": fig_shichu,
    "tarot": fig_tarot,
    "astro": fig_astro,
}


def build_all(charts):
    """charts の内容に応じて図版を作り、{key: PNG bytes} を返す。"""
    figs = {}
    for key, fn in BUILDERS.items():
        if key in charts and charts[key]:
            try:
                figs[key] = fn(charts[key])
            except Exception as e:
                print(f"※ 図版 {key} をスキップ: {e}")
    for key in ("seimei", "seiza", "tarot", "shichu", "astro"):
        figs[f"div_{key}"] = fig_divider(key)
    return figs


def data_uri(png_bytes):
    return "data:image/png;base64," + base64.b64encode(png_bytes).decode()


DEMO = {
    "seimei": {"sei": "佐藤", "mei": "美咲",
               "strokes": {"sei": [7, 18], "mei": [9, 15]},
               "kaku": {"天格": {"n": 25, "luck": "吉", "meaning": "独特の才。個性で立つ"},
                        "人格": {"n": 27, "luck": "凶", "meaning": "中断。詰めが甘くなりやすい"},
                        "地格": {"n": 24, "luck": "大吉", "meaning": "蓄財。着実に増える"},
                        "外格": {"n": 22, "luck": "凶", "meaning": "内に溜めやすい"},
                        "総格": {"n": 49, "luck": "凶", "meaning": "吉凶が入れ替わりやすい"}}},
    "shichu": {"pillars": {"年柱": {"kan": "乙", "shi": "亥", "label": "乙亥"},
                           "月柱": {"kan": "癸", "shi": "未", "label": "癸未"},
                           "日柱": {"kan": "丁", "shi": "未", "label": "丁未"}},
               "nikkan": {"kan": "丁", "element": "火"},
               "elements": {"木": 1, "火": 1, "土": 2, "金": 0, "水": 2},
               "strongest": "土", "missing": ["金"]},
    "tarot": [{"position": "過去", "card": "運命の輪", "number": 10, "reversed": True,
               "orientation": "逆位置"},
              {"position": "現在", "card": "世界", "number": 21, "reversed": False,
               "orientation": "正位置"},
              {"position": "未来", "card": "節制", "number": 14, "reversed": False,
               "orientation": "正位置"}],
    "astro": {"sun": {"name": "蟹座", "element": "水"}, "moon": {"name": "蟹座"},
              "ascendant": {"name": "山羊座"}, "dominantElement": "水"},
}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--demo", metavar="DIR")
    ap.add_argument("--charts", metavar="JSON")
    ap.add_argument("--outdir", default="out/figs")
    a = ap.parse_args()
    charts = DEMO if a.demo else json.load(open(a.charts, encoding="utf-8"))
    outdir = a.demo or a.outdir
    os.makedirs(outdir, exist_ok=True)
    for k, fn in BUILDERS.items():
        if k in charts:
            fn(charts[k], os.path.join(outdir, f"{k}.png"))
            print(os.path.join(outdir, f"{k}.png"))
    for k in ("seimei", "seiza", "tarot", "shichu", "astro"):
        fig_divider(k, os.path.join(outdir, f"div-{k}.png"))
