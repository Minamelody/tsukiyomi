#!/usr/bin/env python3
# 鑑定書PDF生成ツール（Designerデザイン版）。
# src/deliver.js が生成した納品テキストを、図版入りの冊子PDFにする。
#
# 使い方:
#   # 1) 鑑定文を作る
#   node src/deliver.js --sei 佐藤 --mei 美咲 --birthday 1995-07-15 \
#     --question "転職しようか迷っています" --out out/deliv.txt
#   # 2) 図版用の計算結果を出す（LLMを通さないので即終わる）
#   node src/charts.js --sei 佐藤 --mei 美咲 --birthday 1995-07-15 > out/charts.json
#   # 3) PDF化
#   python3 src/pdfgen.py out/deliv.txt out/cert.pdf --name 佐藤美咲 --charts out/charts.json
#
# --charts を省略しても動く（図版なしのテキスト冊子になる）。
#
# 設計方針:
#   - 全ページ濃紺地＋金罫。表紙とめくった先が地続きになる。
#   - 各占術は扉ページで区切り、冒頭に「その人の実データで生成した図版」を置く。
#     図版は src/figures.py がコードで描画する（AI生成画像は使わない）。
#   - 図版はサムネイルと同じ絵柄・同じ配色なので、
#     「サムネで見た計算の実物が届いた」が成立する。

import sys
import os
import re
import json
import argparse
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from weasyprint import HTML
    ENGINE = 'weasyprint'
except Exception:
    ENGINE = 'reportlab'

try:
    import figures
    HAS_FIGURES = True
except Exception as e:
    print(f'※ 図版モジュールを読み込めませんでした（図版なしで続行）: {e}', file=sys.stderr)
    HAS_FIGURES = False


# 占術セクション名 → 図版キー・扉の英字・一言
SECTION_META = {
    '姓名判断':   dict(fig='seimei', div='seimei', en='SEIMEI HANDAN',
                       lead='名前の画数が示す、生まれ持った型'),
    '星座占い':   dict(fig=None,     div='seiza',  en='STAR SIGN',
                       lead='生まれた日の空が決めた性質'),
    'タロット':   dict(fig='tarot',  div='tarot',  en='TAROT',
                       lead='いまの一件に、三枚が返す答え'),
    '四柱推命':   dict(fig='shichu', div='shichu', en='SHICHU SUIMEI',
                       lead='命式が示す、持って生まれた強み'),
    '西洋占星術': dict(fig='astro',  div='astro',  en='ASTROLOGY',
                       lead='太陽・月・上昇宮、三層で読む自分'),
}


# 単品PDFの「本書で用いた算出」に載せる内容（実際に計算しているものだけを書く）
SECTION_BASIS = {
    '姓名判断': [('画数', 'お名前の各字の画数（旧字体・新字体の別を含む）'),
                 ('五格', '天格・人格・地格・外格・総格の5つ'),
                 ('吉凶', '81数の吉凶判定'),
                 ('ご相談', 'お伺いした内容に沿った読み解き')],
    '星座占い': [('太陽星座', '生年月日から算出'),
                 ('エレメント', '火・地・風・水の4分類'),
                 ('十二支', '生まれ年'),
                 ('ライフパス', '生年月日の数値還元'),
                 ('ご相談', 'お伺いした内容に沿った読み解き')],
    'タロット': [('デッキ', '大アルカナ22枚'),
                 ('スプレッド', '3枚引き（過去・現在・未来）'),
                 ('正逆', '各カードの正位置・逆位置'),
                 ('ご相談', 'お伺いした内容に沿った読み解き')],
    '四柱推命': [('命式', '年柱・月柱・日柱の天干地支'),
                 ('日干', '日柱の天干とその五行'),
                 ('五行', '木・火・土・金・水の配分と欠け'),
                 ('ご相談', 'お伺いした内容に沿った読み解き')],
    '西洋占星術': [('太陽星座', '表に出る性質'),
                   ('月星座', '内面の性質'),
                   ('上昇宮', '第一印象（生年月日からの推定値）'),
                   ('エレメント', '優勢なエレメントの判定'),
                   ('ご相談', 'お伺いした内容に沿った読み解き')],
}


def parse_text(path):
    """納品テキストをパースして構造化する。

    返り値: [(占術名, [('h', 見出し) | ('p', 本文), ...]), ...]
    """
    with open(path, encoding='utf-8') as f:
        raw = f.read()

    # 末尾の挨拶＋免責ブロックは奥付側で出すので、本文からは丸ごと切り落とす。
    # 行単位のキーワード除外だと全角空白始まりの行などを取りこぼすため、
    # 「最後の区切り線＋締めの挨拶」以降を切る方式にする。
    cut = raw.rfind('最後までお読みいただき')
    if cut > 0:
        bar = raw.rfind('────', 0, cut)
        raw = raw[:bar if bar > 0 else cut]
    lines = raw.splitlines()

    sections = []
    current_h = None
    current_body = []

    for ln in lines:
        st = ln.strip()
        if not st:
            continue
        if st.startswith('【') and st.endswith('】'):
            if current_h:
                sections.append((current_h, current_body))
            current_h = st.strip('【】')
            current_body = []
        elif st.startswith('■'):
            current_body.append(('h', st.strip('■').strip()))
        elif st.startswith('────'):
            continue
        elif (st.startswith('※本鑑定') or st.startswith('医療・法律')
              or st.startswith('最終的な選択')):
            continue
        elif st.startswith('最後までお読みいただき'):
            continue
        elif st.startswith('ご購入いただきありがとうございます'):
            continue
        elif st.startswith('お伺いした情報をもとに') or st.startswith('以下、鑑定結果を'):
            continue
        elif st.startswith('気になる点や') or st.startswith('このトークルームで'):
            continue
        elif st.endswith('様') and current_h is None:
            continue
        else:
            if current_h:
                current_body.append(('p', st))
    if current_h:
        sections.append((current_h, current_body))
    return sections


CARD_NUMBERS = {
    '愚者': 0, '魔術師': 1, '女教皇': 2, '女帝': 3, '皇帝': 4, '法王': 5,
    '恋人': 6, '戦車': 7, '力': 8, '隠者': 9, '運命の輪': 10, '正義': 11,
    '吊るされた男': 12, '死神': 13, '節制': 14, '悪魔': 15, '塔': 16,
    '星': 17, '月': 18, '太陽': 19, '審判': 20, '世界': 21,
}
POSITIONS = ['過去', '現在', '未来']


def tarot_from_text(path):
    """納品テキストの「3枚引き — 月(正位置) / ...」行から実際の引きを復元する。

    タロットの引きは seed（名前|生年月日|日付|悩み）依存なので、
    図版を別途 draw3 で引き直すと鑑定文と違うカードが出てしまう。
    納品テキストが唯一の正解なので、そこから読み取る。
    """
    with open(path, encoding='utf-8') as f:
        text = f.read()
    m = re.search(r'3枚引き\s*[—\-–]\s*([^\n]+)', text)
    if not m:
        return None
    cards = []
    for i, chunk in enumerate(m.group(1).split('/')):
        mm = re.match(r'\s*(.+?)\s*[（(]\s*(正位置|逆位置)\s*[)）]', chunk)
        if not mm:
            return None
        name, ori = mm.group(1).strip(), mm.group(2)
        if name not in CARD_NUMBERS:
            return None
        cards.append({
            'position': POSITIONS[i] if i < len(POSITIONS) else f'{i + 1}枚目',
            'card': name,
            'number': CARD_NUMBERS[name],
            'reversed': ori == '逆位置',
            'orientation': ori,
        })
    return cards or None


def esc(s):
    return (s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))


def build_html(name, sections, date_str, figs):
    def uri(key):
        return figures.data_uri(figs[key]) if figs and key in figs else None

    # ---- 表紙 ----
    cover = f"""
    <section class="cover">
      <div class="cover-orn">✦ &nbsp; ☾ &nbsp; ✦</div>
      <div class="cover-title">ツ キ ヨ ミ</div>
      <div class="cover-rule"></div>
      <div class="cover-sub">F O R T U N E &nbsp; T E L L I N G &nbsp; · &nbsp; 鑑 定 書</div>
      <div class="cover-name">{esc(name)} <span class="sama">様</span></div>
      <div class="cover-date">{esc(date_str)}</div>
      <div class="cover-foot">この鑑定書は、ご提供いただいた情報のみをもとに<br>お一人のために作成したものです。</div>
    </section>"""

    single = (len(sections) == 1)
    solo_cls = 'solo' if single else ''

    # ---- 目次（単品では省く。1行だけの目次は白紙同然なので） ----
    toc_rows = []
    for i, (h, _) in enumerate(sections, 1):
        meta = SECTION_META.get(h, {})
        toc_rows.append(
            f'<div class="toc-row"><span class="toc-no">{i:02d}</span>'
            f'<span class="toc-name">{esc(h)}</span>'
            f'<span class="toc-lead">{esc(meta.get("lead", ""))}</span></div>')
    toc = '' if single else f"""
    <section class="page">
      <div class="page-head"><span>ツキヨミ 鑑定書</span><span>{esc(name)} 様</span></div>
      <h1 class="ttl">目 次</h1>
      <div class="toc">{''.join(toc_rows)}</div>
      <div class="toc-note">
        本書はこの5種の占術それぞれについて、まず計算結果を図でお示しし、
        そのうえで読み解きを記載しています。
      </div>
    </section>"""

    # ---- 単品用の前書き（目次の代わり。何を計算したのかを明示する） ----
    intro = ''
    if single:
        h0 = sections[0][0]
        meta0 = SECTION_META.get(h0, {})
        basis = SECTION_BASIS.get(h0, [])
        rows = ''.join(
            f'<div class="basis-row"><span class="basis-k">{esc(k)}</span>'
            f'<span class="basis-v">{esc(v)}</span></div>' for k, v in basis)
        intro = f"""
    <section class="page">
      <div class="page-head"><span>ツキヨミ 鑑定書</span><span>{esc(name)} 様</span></div>
      <h1 class="ttl">本 書 に つ い て</h1>
      <p class="lede">
        本書は「{esc(h0)}」について、{esc(name)} 様からお伺いした情報のみをもとに作成した鑑定書です。
        {esc(meta0.get('lead', ''))}という観点から読み解いています。
      </p>
      <h2>本書で用いた算出</h2>
      <div class="basis">{rows}</div>
      <h2>本書の構成</h2>
      <p>
        はじめに算出結果を図でお示しし、そのうえで項目ごとの読み解きを記載しています。
        図に出ている数値や記号が、そのまま本文の根拠になっています。
      </p>
      <div class="toc-note">
        鑑定文はご相談内容に沿って作成しているため、同じ生年月日の方でも記載は異なります。
        気になる点があれば、ご購入いただいたトークルームでお尋ねください。
      </div>
    </section>"""

    # ---- 各占術 ----
    body = []
    for i, (h, items) in enumerate(sections, 1):
        meta = SECTION_META.get(h, {})
        div_uri = uri(f'div_{meta.get("div", "")}')
        fig_uri = uri(meta.get('fig') or '')

        # 扉ページ（単品では本文ページ内の見出しに統合する）
        if not single:
            body.append(f"""
        <section class="divider">
          <div class="div-no">{i:02d}</div>
          {'<img class="div-mark" src="' + div_uri + '">' if div_uri else ''}
          <div class="div-name">{esc(h)}</div>
          <div class="div-en">{esc(meta.get('en', ''))}</div>
          <div class="div-lead">{esc(meta.get('lead', ''))}</div>
        </section>""")

        # 本文ページ
        parts = [f'<div class="page-head"><span>{i:02d} &nbsp; {esc(h)}</span>'
                 f'<span>{esc(name)} 様</span></div>']
        if single:
            parts.append(f"""
            <div class="solo-head">
              {'<img class="solo-mark" src="' + div_uri + '">' if div_uri else ''}
              <div class="solo-texts">
                <div class="solo-en">{esc(meta.get('en', ''))}</div>
                <h1 class="solo-name">{esc(h)}</h1>
                <div class="solo-lead">{esc(meta.get('lead', ''))}</div>
              </div>
            </div>""")
        else:
            parts.append(f'<h1 class="ttl">{esc(h)}</h1>')

        # 概要（最初の段落は導入として扱う）
        first_p = None
        rest = items
        if items and items[0][0] == 'p':
            first_p = items[0][1]
            rest = items[1:]
        if first_p:
            parts.append(f'<p class="lede">{esc(first_p)}</p>')

        if fig_uri:
            parts.append(f"""
            <figure class="fig">
              <img src="{fig_uri}">
              <figcaption>図 {i} ・ {esc(h)}の計算結果</figcaption>
            </figure>""")

        for kind, txt in rest:
            if kind == 'h':
                parts.append(f'<h2>{esc(txt)}</h2>')
            else:
                parts.append(f'<p>{esc(txt)}</p>')
        parts.append('<div class="sec-end">✦ &nbsp; ☾ &nbsp; ✦</div>')
        body.append(f'<section class="page">{"".join(parts)}</section>')

    # ---- 奥付 ----
    colophon = """
    <section class="colophon">
      <div class="col-orn">☾</div>
      <div class="col-title">ツ キ ヨ ミ</div>
      <div class="col-msg">
        最後までお読みいただきありがとうございました。<br>
        気になる点やもう少し詳しく聞きたいところがあれば、<br>
        ご購入いただいたトークルームでお気軽にお尋ねください。
      </div>
      <div class="col-rule"></div>
      <div class="col-note">
        ※本鑑定は娯楽を目的としたものです。医療・法律・投資に関する判断の根拠とはなりません。<br>
        最終的な選択はご自身の意思で行ってください。<br>
        ※画数は新字体（常用漢字）の画数に基づき算出しています。流派により値が異なる場合があります。<br>
        ※一字姓・一字名の場合は霊数1を補って算出しています（総格には含めません）。
      </div>
    </section>"""

    return f"""<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><title>ツキヨミ 鑑定書</title><style>
@page {{
  size: A4;
  margin: 0;
}}
@page :first {{ @bottom-center {{ content: none; }} }}
@page {{
  @bottom-center {{
    content: counter(page);
    font-family: 'Noto Sans CJK JP', sans-serif;
    font-size: 8pt;
    color: #6f6796;
    margin-bottom: 9mm;
  }}
}}
* {{ box-sizing: border-box; }}
html, body {{ margin: 0; padding: 0; }}
body {{
  font-family: 'Noto Serif CJK JP', 'Noto Serif JP', serif;
  color: #e9e5f4;
  background: #171531;
}}
body.solo p {{ font-size: 10.5pt; line-height: 2.15; }}
body.solo h2 {{ margin: 9mm 0 4mm; font-size: 12pt; }}
body.solo .lede {{ font-size: 11pt; line-height: 2.05; }}

/* ---- 共通ページ ---- */
.page, .divider, .cover, .colophon {{
  position: relative;
  width: 210mm;
  height: 297mm;
  page-break-after: always;
  overflow: hidden;
  background: #171531;
  background-image:
    radial-gradient(120mm 90mm at 22% 12%, rgba(70,60,132,.55) 0%, rgba(23,21,49,0) 70%),
    linear-gradient(178deg, #1b1838 0%, #171531 48%, #100e24 100%);
}}
.colophon {{ page-break-after: auto; }}
/* 金の二重罫 */
.page::before, .divider::before, .cover::before, .colophon::before {{
  content: '';
  position: absolute;
  top: 11mm; left: 11mm; right: 11mm; bottom: 11mm;
  border: 0.5pt solid rgba(245,200,105,.42);
}}
.page::after, .divider::after, .cover::after, .colophon::after {{
  content: '';
  position: absolute;
  top: 13.2mm; left: 13.2mm; right: 13.2mm; bottom: 13.2mm;
  border: 0.3pt solid rgba(245,200,105,.16);
}}

.page {{ padding: 24mm 22mm 22mm; }}
.page-head {{
  position: absolute;
  top: 16.5mm; left: 22mm; right: 22mm;
  display: flex; justify-content: space-between;
  font-family: 'Noto Sans CJK JP', sans-serif;
  font-size: 7.5pt; letter-spacing: .12em; color: #7f77a8;
}}

/* ---- 表紙 ---- */
.cover {{ text-align: center; }}
.cover-orn {{ margin-top: 88mm; font-size: 15pt; color: #f5c869; letter-spacing: .2em; }}
.cover-title {{ margin-top: 13mm; font-size: 32pt; color: #f5c869; letter-spacing: .12em; }}
.cover-rule {{
  width: 46mm; height: 0; margin: 7mm auto 0;
  border-top: 0.5pt solid rgba(245,200,105,.6);
}}
.cover-sub {{
  margin-top: 6mm;
  font-family: 'Noto Sans CJK JP', sans-serif;
  font-size: 8.5pt; letter-spacing: .3em; color: #a8a1cc;
}}
.cover-name {{ margin-top: 42mm; font-size: 19pt; letter-spacing: .12em; color: #f2eefc; }}
.cover-name .sama {{ font-size: 12pt; color: #cfc8e6; margin-left: 2mm; }}
.cover-date {{
  margin-top: 7mm;
  font-family: 'Noto Sans CJK JP', sans-serif;
  font-size: 9pt; letter-spacing: .16em; color: #8d86b4;
}}
.cover-foot {{
  position: absolute; left: 0; right: 0; bottom: 26mm;
  font-size: 8.5pt; line-height: 1.9; color: #7f77a8;
}}

/* ---- 目次 ---- */
.ttl {{
  margin: 0 0 9mm;
  font-size: 17pt; font-weight: normal; color: #f5c869;
  letter-spacing: .16em;
}}
.ttl::after {{
  content: ''; display: block; width: 22mm; margin-top: 4mm;
  border-top: 0.8pt solid rgba(245,200,105,.75);
}}
.toc-row {{
  display: flex; align-items: baseline;
  padding: 4.6mm 0;
  border-bottom: 0.3pt solid rgba(245,200,105,.18);
}}
.toc-no {{
  font-family: 'Noto Sans CJK JP', sans-serif;
  font-size: 10pt; color: #f5c869; width: 14mm; letter-spacing: .06em;
}}
.toc-name {{ font-size: 12.5pt; color: #f2eefc; width: 42mm; letter-spacing: .08em; }}
.toc-lead {{ font-size: 9pt; color: #9c95c2; }}
.toc-note {{
  margin-top: 12mm; padding: 6mm 7mm;
  border-left: 1.5pt solid rgba(245,200,105,.55);
  background: rgba(255,255,255,.035);
  font-size: 9pt; line-height: 2; color: #b9b3d6;
}}

/* ---- 扉 ---- */
.divider {{ text-align: center; }}
.div-no {{
  margin-top: 74mm;
  font-family: 'Noto Sans CJK JP', sans-serif;
  font-size: 9pt; letter-spacing: .4em; color: #f5c869;
}}
.div-mark {{ display: block; width: 44mm; margin: 10mm auto 0; }}
.div-name {{ margin-top: 11mm; font-size: 22pt; color: #f2eefc; letter-spacing: .22em; }}
.div-en {{
  margin-top: 5mm;
  font-family: 'Noto Sans CJK JP', sans-serif;
  font-size: 7.5pt; letter-spacing: .42em; color: #8d86b4;
}}
.div-lead {{ margin-top: 12mm; font-size: 10.5pt; color: #cfc8e6; letter-spacing: .06em; }}

/* ---- 本文 ---- */
.lede {{
  margin: 0 0 7mm; padding: 5mm 6mm;
  background: rgba(255,255,255,.04);
  border-left: 1.5pt solid rgba(245,200,105,.55);
  font-size: 10.5pt; line-height: 1.95; color: #f0ecfa;
}}
h2 {{
  margin: 8mm 0 3.5mm;
  font-size: 11.5pt; font-weight: normal; color: #f5c869;
  letter-spacing: .08em;
}}
h2::before {{
  content: ''; display: inline-block;
  width: 3mm; height: 3mm; margin-right: 3mm;
  border: 0.8pt solid #f5c869; transform: rotate(45deg);
  vertical-align: middle;
}}
p {{ margin: 0 0 3.6mm; font-size: 10pt; line-height: 2.0; color: #ded9ee; text-align: justify; }}

/* ---- 節の終わりの飾り ---- */
.sec-end {{
  margin-top: 10mm; text-align: center;
  font-size: 10pt; letter-spacing: .3em;
  color: rgba(245,200,105,.5);
}}

/* ---- 算出根拠の表 ---- */
.basis {{ margin: 0 0 4mm; }}
.basis-row {{
  display: flex; align-items: baseline;
  padding: 3.4mm 0;
  border-bottom: 0.3pt solid rgba(245,200,105,.18);
}}
.basis-k {{
  width: 30mm; flex: none;
  font-family: 'Noto Sans CJK JP', sans-serif;
  font-size: 8.5pt; letter-spacing: .1em; color: #f5c869;
}}
.basis-v {{ font-size: 9.5pt; color: #ded9ee; }}

/* ---- 単品用の見出しブロック ---- */
.solo-head {{
  display: flex; align-items: center;
  margin: 0 0 9mm; padding-bottom: 6mm;
  border-bottom: 0.5pt solid rgba(245,200,105,.42);
}}
.solo-mark {{ width: 30mm; margin-right: 8mm; }}
.solo-en {{
  font-family: 'Noto Sans CJK JP', sans-serif;
  font-size: 7pt; letter-spacing: .38em; color: #8d86b4;
}}
.solo-name {{
  margin: 3mm 0 0; font-size: 20pt; font-weight: normal;
  color: #f5c869; letter-spacing: .18em;
}}
.solo-lead {{ margin-top: 3.5mm; font-size: 9.5pt; color: #cfc8e6; }}

/* ---- 図版 ---- */
.fig {{ margin: 0 0 8mm; text-align: center; page-break-inside: avoid; }}
.fig img {{ width: 148mm; border: 0.5pt solid rgba(245,200,105,.42); }}
.fig figcaption {{
  margin-top: 3mm;
  font-family: 'Noto Sans CJK JP', sans-serif;
  font-size: 7.5pt; letter-spacing: .1em; color: #8d86b4;
}}

/* ---- 奥付 ---- */
.colophon {{ text-align: center; }}
.col-orn {{ margin-top: 92mm; font-size: 20pt; color: #f5c869; }}
.col-title {{ margin-top: 8mm; font-size: 19pt; color: #f5c869; letter-spacing: .2em; }}
.col-msg {{ margin-top: 16mm; font-size: 10pt; line-height: 2.1; color: #ded9ee; }}
.col-rule {{ width: 34mm; margin: 14mm auto 0; border-top: 0.5pt solid rgba(245,200,105,.5); }}
.col-note {{
  margin: 8mm auto 0; max-width: 142mm;
  font-family: 'Noto Sans CJK JP', sans-serif;
  font-size: 7.5pt; line-height: 1.95; color: #837bab;
}}
</style></head>
<body class="{solo_cls}">
{cover}
{toc}
{intro}
{''.join(body)}
{colophon}
</body></html>"""


def weasyprint_render(html, out):
    HTML(string=html).write_pdf(out)


def reportlab_render(html, out):
    """weasyprintが無い環境向けの簡易フォールバック（図版なし・白地）。"""
    import re
    from reportlab.lib.pagesizes import A4
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    font = 'Helvetica'
    for cand in ('/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc',):
        if os.path.exists(cand):
            try:
                pdfmetrics.registerFont(TTFont('NotoSerifJP', cand, subfontIndex=0))
                font = 'NotoSerifJP'
                break
            except Exception:
                pass

    doc = SimpleDocTemplate(out, pagesize=A4, leftMargin=22 * mm, rightMargin=22 * mm,
                            topMargin=20 * mm, bottomMargin=20 * mm,
                            title='ツキヨミ 鑑定書', author='ツキヨミ')
    styles = getSampleStyleSheet()
    h1 = ParagraphStyle('h1', parent=styles['Heading1'], fontName=font, fontSize=15,
                        spaceBefore=14, spaceAfter=7, textColor=colors.HexColor('#171531'))
    h2 = ParagraphStyle('h2', parent=styles['Heading2'], fontName=font, fontSize=11,
                        spaceBefore=9, spaceAfter=4, textColor=colors.HexColor('#8a6d1f'))
    p = ParagraphStyle('p', parent=styles['BodyText'], fontName=font, fontSize=9.8,
                       leading=16.5, spaceAfter=5)

    story = [Spacer(1, 86 * mm)]
    story.append(Paragraph('ツキヨミ', ParagraphStyle('ct', parent=styles['Normal'], fontName=font,
                                                      fontSize=28, alignment=1,
                                                      textColor=colors.HexColor('#a5822c'))))
    m = re.search(r'class="cover-name">([^<]+)', html)
    if m:
        story += [Spacer(1, 30 * mm),
                  Paragraph(m.group(1).strip(), ParagraphStyle('cn', parent=styles['Normal'],
                                                               fontName=font, fontSize=15,
                                                               alignment=1))]
    story.append(PageBreak())

    for tag, text in re.findall(r'<(h1|h2|p)[^>]*>(.*?)</\1>', html, re.S):
        txt = re.sub(r'<[^>]+>', '', text).strip()
        if not txt:
            continue
        story.append(Paragraph(txt, {'h1': h1, 'h2': h2}.get(tag, p)))
    doc.build(story)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('input')
    ap.add_argument('output')
    ap.add_argument('--name', default='鑑定ご依頼者さま')
    ap.add_argument('--date', default='')
    ap.add_argument('--charts', default='',
                    help='node src/charts.js の出力JSON。省略すると図版なしになる')
    args = ap.parse_args()

    sections = parse_text(args.input)
    if not sections:
        print('エラー: セクションを検出できませんでした', file=sys.stderr)
        sys.exit(1)

    figs = {}
    if args.charts and HAS_FIGURES:
        if not os.path.exists(args.charts):
            print(f'※ {args.charts} が見つかりません。図版なしで続行します', file=sys.stderr)
        else:
            with open(args.charts, encoding='utf-8') as f:
                charts = json.load(f)
            # タロットは納品テキストの記載を正解とする（seedズレで別の札になるのを防ぐ）
            from_text = tarot_from_text(args.input)
            if from_text:
                charts['tarot'] = from_text
            elif 'tarot' in charts:
                print('※ 納品テキストから引いた札を読み取れませんでした。'
                      'charts.json の値を使いますが、鑑定文と一致するか確認してください。',
                      file=sys.stderr)
            figs = figures.build_all(charts)
    elif not args.charts:
        print('※ --charts の指定がないため図版なしで生成します', file=sys.stderr)

    date_str = args.date or datetime.now().strftime('%Y-%m-%d')
    html = build_html(args.name, sections, date_str, figs)

    d = os.path.dirname(os.path.abspath(args.output))
    if d:
        os.makedirs(d, exist_ok=True)
    if ENGINE == 'weasyprint':
        weasyprint_render(html, args.output)
    else:
        reportlab_render(html, args.output)
    nfig = len([k for k in figs if not k.startswith('div_')])
    print(f'PDF生成完了: {args.output}'
          f'（{os.path.getsize(args.output)} bytes・{len(sections)}種目・図版{nfig}点・'
          f'エンジン: {ENGINE}）')


if __name__ == '__main__':
    main()
