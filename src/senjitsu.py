# -*- coding: utf-8 -*-
"""選日（一粒万倍日・母倉日・三隣亡）の算出。

規則の出典: 国立国会図書館「日本の暦」第三章 吉凶を表す言葉④その他
  https://www.ndl.go.jp/koyomi/chapter3/s6.html

検証: 2026年の一粒万倍日 61 日を JAL SKYWARD+ 公開一覧と全件突合し完全一致。
      日の干支は benri.jp[節月]干支カレンダーの 2026-08-18=甲子 で基準を実測。

重要な実装上の要点（ここを外すと必ずズレる）:
  1. 日の干支の基準日は実測で取ること。1984-02-02=甲子 は誤り。
  2. 節月の境界は「節入りの瞬間」ではなく「節入り日の 0:00 JST」。
     節が日中に入っても、その日は丸ごと新しい節月として扱う（暦の慣習）。
     瞬間で切ると節入り日が旧節月に落ち、一粒万倍日が年に数日ズレる。
"""
import datetime, math, functools
import ephem

JIKKAN = "甲乙丙丁戊己庚辛壬癸"
JUNISHI = "子丑寅卯辰巳午未申酉戌亥"

# 2026-08-18 = 甲子（benri.jp の節月干支カレンダーで実測）
_BASE = datetime.date(2026, 8, 18)

JST = datetime.timedelta(hours=9)


def day_kanshi(d: datetime.date) -> str:
    n = (d - _BASE).days % 60
    return JIKKAN[n % 10] + JUNISHI[n % 12]


def day_shi(d: datetime.date) -> str:
    return JUNISHI[(d - _BASE).days % 12]


def _sun_lon(dt) -> float:
    s = ephem.Sun(dt)
    e = ephem.Ecliptic(ephem.Equatorial(s.ra, s.dec, epoch=dt))
    return math.degrees(e.lon) % 360


def _find_term(deg: float, year: int) -> datetime.datetime:
    """太陽黄経が deg を通過する瞬間（UT）を二分探索で求める。"""
    lo = ephem.Date(datetime.datetime(year - 1, 12, 1))
    hi = ephem.Date(datetime.datetime(year + 1, 2, 1))
    for _ in range(80):
        mid = (lo + hi) / 2
        if ((_sun_lon(mid) - deg) % 360) < 180:
            hi = mid
        else:
            lo = mid
    return ephem.Date(hi).datetime()


@functools.lru_cache(maxsize=64)
def _setsu_starts(year: int):
    """その年に始まる各節月の開始日(JSTの暦日)。[(date, setsu_month), ...]"""
    out = []
    for k in range(1, 13):
        deg = (315 + 30 * (k - 1)) % 360
        t_ut = _find_term(deg, year)
        t_jst = t_ut + JST
        out.append((t_jst.date(), k))
    return tuple(sorted(out))


def setsu_month(d: datetime.date) -> int:
    """節月(1..12)。正月節=立春から。節入り日はその日から新しい節月。"""
    cur = None
    for y in (d.year - 1, d.year, d.year + 1):
        for start, k in _setsu_starts(y):
            if start <= d:
                cur = k
            else:
                break
        else:
            continue
        break
    # 年をまたぐので全部見て「d 以下で最大の開始日」を選ぶ
    best = None
    for y in (d.year - 1, d.year, d.year + 1):
        for start, k in _setsu_starts(y):
            if start <= d and (best is None or start > best[0]):
                best = (start, k)
    return best[1]


# 一粒万倍日: 節月ごとに2通りの選日法を併用（NDL の表そのまま）
ICHIRYU = {
    1: ("丑", "午"), 2: ("酉", "寅"), 3: ("子", "卯"), 4: ("卯", "辰"),
    5: ("巳", "午"), 6: ("酉", "午"), 7: ("子", "未"), 8: ("卯", "申"),
    9: ("酉", "午"), 10: ("酉", "戌"), 11: ("亥", "子"), 12: ("卯", "子"),
}


def is_ichiryu(d: datetime.date) -> bool:
    return day_shi(d) in ICHIRYU[setsu_month(d)]


# 母倉日: 節月ごとの十二支。festaria 公開の2026年全76日から逆算し矛盾ゼロで確定
# （節月3/6/9/12=巳午、4/5=寅卯、7/8=丑辰未戌、10/11=申酉、1/2=子亥）
BOSO = {
    1: ("子", "亥"), 2: ("子", "亥"), 3: ("巳", "午"), 4: ("寅", "卯"),
    5: ("寅", "卯"), 6: ("巳", "午"), 7: ("丑", "辰", "未", "戌"),
    8: ("丑", "辰", "未", "戌"), 9: ("巳", "午"), 10: ("申", "酉"),
    11: ("申", "酉"), 12: ("巳", "午"),
}


def is_boso(d: datetime.date) -> bool:
    return day_shi(d) in BOSO[setsu_month(d)]


# 三隣亡（凶日）: 節月1,4,7,10=亥 / 2,5,8,11=寅 / 3,6,9,12=午
_SANRIN = {1: "亥", 4: "亥", 7: "亥", 10: "亥",
           2: "寅", 5: "寅", 8: "寅", 11: "寅",
           3: "午", 6: "午", 9: "午", 12: "午"}


def is_sanrinbo(d: datetime.date) -> bool:
    return day_shi(d) == _SANRIN[setsu_month(d)]


# 不成就日: 旧暦月の日付基準（月切り）。旧暦計算が必要なため別途。
def describe(d: datetime.date) -> dict:
    return {
        "date": d.isoformat(),
        "kanshi": day_kanshi(d),
        "shi": day_shi(d),
        "setsu_month": setsu_month(d),
        "ichiryumanbai": is_ichiryu(d),
        "bosonichi": is_boso(d),
        "sanrinbo": is_sanrinbo(d),
        "tenonnichi": is_tenon(d),
    }


if __name__ == "__main__":
    import json
    for s in ["2026-09-06", "2026-09-07", "2026-09-19", "2026-03-05"]:
        print(json.dumps(describe(datetime.date.fromisoformat(s)), ensure_ascii=False))


# 天恩日: 月に関係なく次の15種の干支の日（「暦林問答集」）。5日連続×3組。
# 出典: https://www.linderabell.com/entry/gedan/tenon
TENON = frozenset([
    "甲子", "乙丑", "丙寅", "丁卯", "戊辰",
    "己卯", "庚辰", "辛巳", "壬午", "癸未",
    "己酉", "庚戌", "辛亥", "壬子", "癸丑",
])


def is_tenon(d: datetime.date) -> bool:
    return day_kanshi(d) in TENON


def dump_range(start: datetime.date, end: datetime.date):
    """期間内の選日を返す（ジェネレータ組み込み用）。"""
    out = []
    d = start
    while d <= end:
        out.append(describe(d))
        d += datetime.timedelta(days=1)
    return out


def lucky_labels(d: datetime.date):
    """その日に成立する吉日名のリスト。文面生成はこれだけ見ればよい。"""
    labels = []
    if is_ichiryu(d):
        labels.append("一粒万倍日")
    if is_boso(d):
        labels.append("母倉日")
    if is_tenon(d):
        labels.append("天恩日")
    return labels


# 十二時辰（不定時法ではなく現行の定時法配当）。
# 「その日の十二支と同じ刻」はその日の気が最も濃い時間、という暦の理屈が立つ。
# 参考投稿の「5:00〜8:59」は暦の裏付けがない任意の窓なので、代わりにこれを使う。
JIKOKU = {
    "子": (23, 0), "丑": (1, 2), "寅": (3, 4), "卯": (5, 6),
    "辰": (7, 8), "巳": (9, 10), "午": (11, 12), "未": (13, 14),
    "申": (15, 16), "酉": (17, 18), "戌": (19, 20), "亥": (21, 22),
}


def peak_window(d: datetime.date) -> dict:
    """その日の十二支と同じ時辰＝気が最も濃い時間帯。日ごとに変わる。"""
    shi = day_shi(d)
    h0, h1 = JIKOKU[shi]
    return {
        "shi": shi,
        "name": shi + "の刻",
        "start": "%d:00" % h0,
        "end": "%d:59" % h1,
        "label": "%d:00〜%d:59" % (h0, h1),
    }
