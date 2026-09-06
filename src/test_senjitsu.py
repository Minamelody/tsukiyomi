# -*- coding: utf-8 -*-
"""選日算出の検証。外部の公開暦データと全件突合する。

このテストの要点: 「関数が動くか」ではなく「暦として正しいか」を見る。
実装が壊れれば必ず落ちる形にしてある（期待値は外部データから取った実測値）。
"""
import datetime, calendar, sys
import senjitsu as S

FAIL = []


def check(label, got, exp):
    if got != exp:
        FAIL.append("%s\n    got=%s\n    exp=%s" % (label, got, exp))
        print("  DIFF %s" % label)
    else:
        print("  OK   %s" % label)


def days(mo, pred):
    nd = calendar.monthrange(2026, mo)[1]
    return [d.day for d in (datetime.date(2026, mo, 1) + datetime.timedelta(n)
                            for n in range(nd)) if pred(d)]


# --- 1. 日の干支の基準（benri.jp [節月]干支カレンダー 2026年8月）
print("1. 日の干支")
check("2026-08-18 = 甲子", S.day_kanshi(datetime.date(2026, 8, 18)), "甲子")
check("2026-09-01 = 戊寅", S.day_kanshi(datetime.date(2026, 9, 1)), "戊寅")
check("2026-08-31 = 丁丑", S.day_kanshi(datetime.date(2026, 8, 31)), "丁丑")

# --- 2. 一粒万倍日 2026年 全64日（arachne.jp 大安カレンダー 各月）
print("2. 一粒万倍日（arachne.jp 2026年 全12ヶ月）")
ICHIRYU_2026 = {
    1: [1, 2, 5, 14, 17, 26, 29], 2: [8, 13, 20, 25],
    3: [4, 5, 12, 17, 24, 29], 4: [8, 11, 20, 23],
    5: [2, 5, 6, 17, 18, 29, 30], 6: [12, 13, 24, 25],
    7: [6, 7, 10, 19, 22, 31], 8: [3, 13, 18, 25, 30],
    9: [6, 7, 14, 19, 26], 10: [1, 11, 14, 23, 26],
    11: [4, 7, 8, 19, 20], 12: [1, 2, 15, 16, 27, 28],
}
for mo, exp in ICHIRYU_2026.items():
    check("%d月" % mo, days(mo, S.is_ichiryu), exp)

# --- 3. 母倉日 2026年 全72日（festaria.jp 母倉日一覧）
print("3. 母倉日（festaria.jp 2026年）")
BOSO_2026 = {
    1: [7, 8, 19, 20, 31], 2: [1, 6, 7, 18, 19],
    3: [2, 3, 14, 15, 26, 27], 4: [13, 14, 25, 26],
    5: [5, 16, 17, 28, 29], 6: [9, 10, 21, 22],
    7: [3, 4, 7, 18, 19, 30, 31],
    8: [7, 10, 13, 16, 19, 22, 25, 28, 31],
    9: [3, 6, 9, 12, 15, 18, 21, 24, 27, 30],
    10: [3, 6, 10, 11, 22, 23], 11: [3, 4, 7, 18, 19, 30],
    12: [1, 12, 13, 24, 25],
}
for mo, exp in BOSO_2026.items():
    check("%d月" % mo, days(mo, S.is_boso), exp)

# --- 4. 寅の日・巳の日（arachne.jp、干支基準の独立検証）
print("4. 寅の日・巳の日（2026年9月）")
check("寅の日", days(9, lambda d: S.day_shi(d) == "寅"), [1, 13, 25])
check("巳の日", days(9, lambda d: S.day_shi(d) == "巳"), [4, 16, 28])

# --- 5. 天恩日（sot-web.com 2026年1月）
print("5. 天恩日")
check("2026年1月", days(1, S.is_tenon), [5, 6, 7, 8, 9])

# --- 6. R社長提示の参考投稿が主張する重なり（最終確認）
print("6. 2026-09-06 の重なり（一粒万倍日×母倉日×天恩日）")
d = datetime.date(2026, 9, 6)
check("一粒万倍日", S.is_ichiryu(d), True)
check("母倉日", S.is_boso(d), True)
check("天恩日", S.is_tenon(d), True)

# --- 7. 節入り日は当日から新節月（回帰防止）
print("7. 節月境界（節入り日は丸ごと新節月）")
check("2026-09-07(白露 23:41 JST)は節月8", S.setsu_month(datetime.date(2026, 9, 7)), 8)
check("2026-09-06 は節月7", S.setsu_month(datetime.date(2026, 9, 6)), 7)

# --- 8. 将来年でも動く（年跨ぎ・立春境界の回帰防止）
print("8. 2027年（arachne.jp）")


def days_y(y, mo, pred):
    nd = calendar.monthrange(y, mo)[1]
    return [d.day for d in (datetime.date(y, mo, 1) + datetime.timedelta(n)
                            for n in range(nd)) if pred(d)]


check("2027年1月 一粒万倍日", days_y(2027, 1, S.is_ichiryu), [9, 12, 21, 24])
check("2027年9月 一粒万倍日", days_y(2027, 9, S.is_ichiryu), [1, 6, 9, 14, 21, 26])
check("2028-02-04(立春)は節月1", S.setsu_month(datetime.date(2028, 2, 4)), 1)
check("2028-02-03 は節月12", S.setsu_month(datetime.date(2028, 2, 3)), 12)

# --- 9. 時辰（peak_window）と希少度
print("9. 時辰")
check("2026-09-06(癸未) は未の刻 13:00〜14:59",
      S.peak_window(datetime.date(2026, 9, 6))["label"], "13:00〜14:59")
check("2026-05-05(己卯) は卯の刻 5:00〜6:59",
      S.peak_window(datetime.date(2026, 5, 5))["label"], "5:00〜6:59")

print()
if FAIL:
    print("FAILED %d 件" % len(FAIL))
    for f in FAIL:
        print(" -", f)
    sys.exit(1)
print("ALL PASS — 選日算出は外部公開暦と全件一致")
