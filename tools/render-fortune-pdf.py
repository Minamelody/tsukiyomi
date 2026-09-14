#!/usr/bin/env python3
# tools/render-fortune-pdf.py — 無料鑑定（短縮版200〜300字）をツキヨミ・コンセプトの
# 縦型A4カードPDFへ描画する。gen_brand.py のブランド要素（夜空・三日月・金枠）を再利用し、
# 文面は既存辞書の断片のみ。入力はJSON（sections配列）。出力は単ページPDF（画像として埋め込み）。
#
# 使い方:
#   node src/line-fortune.js --short --json --sei 平石 --mei 廉太郎 --birthday 2004-10-04 \
#     | python3 tools/render-fortune-pdf.py -o 平石廉太郎.pdf

import sys, os, json, argparse
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'design', 'cards'))
import gen_brand as B

# A4縦 @200dpi
W, H = 1654, 2339

# レイアウト
PAD = 70               # 金枠の余白
MX = 150               # 本文の左右マージン
WORD_Y = 300           # ワードマーク上端
GREET_Y = 620          # 挨拶の上端
BODY_Y0 = 780          # セクション開始
LINE = 1.62            # 行間（フォントサイズ比）
BODY_MIN_GAP = 46      # セクション間の最小余白


def font(path, size):
    return ImageFont.truetype(path, size)


def wrap(d, text, font, maxw):
    """maxw px に収まるよう文字単位で折り返す（日本語は1字ずつ）。"""
    lines, cur = [], ''
    for ch in text:
        test = cur + ch
        if d.textlength(test, font=font) <= maxw:
            cur = test
        else:
            if cur:
                lines.append(cur)
            cur = ch
    if cur:
        lines.append(cur)
    return lines


def draw_wrapped(d, xy, lines, font, fill, line_height, anchor_top=True):
    x, y = xy
    for ln in lines:
        d.text((x, y), ln, font=font, fill=fill)
        y += line_height
    return y


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('-o', '--output', required=True)
    ap.add_argument('--spec-file', default='-')
    args = ap.parse_args()

    raw = sys.stdin.read() if args.spec_file == '-' else open(args.spec_file, encoding='utf-8').read()
    spec = json.loads(raw)

    img = B.background(W, H, gx=0.50, gy=0.13, stars=300, seed=20260914)

    # 三日月（上部中央）＋光輪
    mx, my, mr = W * 0.5, H * 0.115, 158
    img = B.halo(img, mx, my, mr, strength=56)
    B.crescent(img, mx, my, mr, B.GOLD, phase=0.58)

    d = ImageDraw.Draw(img)

    # 金枠＋四隅のあしらい
    B.frame(d, W, H, pad=PAD, corner=90)
    for (sx, sy, sr) in [(0.22, 0.225, 10), (0.78, 0.225, 10), (0.30, 0.90, 8), (0.70, 0.90, 8)]:
        B.star_glyph(d, W * sx, H * sy, sr, B.GOLD_D)

    # ワードマーク（中央）
    fn_word = font(B.SERIF_L, 104)
    word = "ツ キ ヨ ミ"
    ww = d.textlength(word, font=fn_word)
    d.text(((W - ww) / 2, WORD_Y), word, font=fn_word, fill=B.GOLD)

    fn_sub = font(B.SANS, 30)
    sub = "F O R T U N E  T E L L I N G"
    sw = d.textlength(sub, font=fn_sub)
    d.text(((W - sw) / 2, WORD_Y + 150), sub, font=fn_sub, fill=B.MUTE)

    # 罫線
    rule_y = WORD_Y + 150 + 66
    d.line([(W * 0.30, rule_y), (W * 0.70, rule_y)], fill=B.GOLD_D, width=2)

    sections = spec.get('sections', [])
    fn_body = font(B.SERIF, 40)
    fn_head = font(B.SERIF_B, 44)
    fn_greet = font(B.SERIF_L, 46)
    fn_guide = font(B.SERIF, 34)
    fn_footer = font(B.SANS, 30)

    body_font_h = int(40 * LINE)          # 本文行高
    head_font_h = 44 + 22                  # 見出し＋下余白

    y = GREET_Y

    # 挨拶（先頭・中央寄せ）
    greet = sections[0]['body'] if sections else ''
    gl = wrap(d, greet, fn_greet, W - MX * 2)
    for ln in gl:
        d.text((W / 2 - d.textlength(ln, font=fn_greet) / 2, y), ln, font=fn_greet, fill=B.WHITE)
        y += body_font_h
    y += 28

    # 中盤セクション（見出しあり）＋末尾の誘導行は分離
    middle = [s for s in sections[1:] if s.get('head')]
    guide = sections[-1] if (len(sections) > 1 and not sections[-1].get('head')) else None

    for sec in middle:
        d.text((MX, y), f"【{sec['head']}】", font=fn_head, fill=B.GOLD)
        y += head_font_h
        lines = wrap(d, sec.get('body', ''), fn_body, W - MX * 2)
        y = draw_wrapped(d, (MX, y), lines, fn_body, B.WHITE, body_font_h)
        y += BODY_MIN_GAP

    # 末尾の誘導行（控えめに中央寄せ）＋下罫＋屋号
    if guide and guide.get('body'):
        y += 20
        d.line([(W * 0.34, y - 8), (W * 0.66, y - 8)], fill=B.GOLD_D, width=1)
        glines = wrap(d, guide['body'], fn_guide, W - MX * 2)
        for ln in glines:
            d.text((W / 2 - d.textlength(ln, font=fn_guide) / 2, y), ln, font=fn_guide, fill=B.MUTE)
            y += int(34 * LINE)

    foot = "ツ キ ヨ ミ"
    fw = d.textlength(foot, font=fn_footer)
    d.text(((W - fw) / 2, H - 130), foot, font=fn_footer, fill=B.MUTE)

    img.save(args.output, 'PDF', resolution=200.0)
    print(f"生成完了: {args.output}（{W}x{H}）")


if __name__ == '__main__':
    main()
