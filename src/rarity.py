# -*- coding: utf-8 -*-
"""選日の希少度。T1（選日型）を「出すか/どう語るか」の判断に使う。

背景: 吉日は年の49%あり、最長9日連続する。全部を等価に「特別な日」と言うと
      特別さが消えて説得力を失う。年5日しかない三重日と、59日ある天恩日単独を
      同じ熱量で語らないための重み付け。
"""
import datetime
import senjitsu as S

# 2026年実測の出現日数（365日中）
FREQ_2026 = {
    "一粒万倍日 + 母倉日 + 天恩日": 5,
    "一粒万倍日 + 母倉日": 10,
    "一粒万倍日 + 天恩日": 12,
    "母倉日 + 天恩日": 15,
    "一粒万倍日": 37,
    "母倉日": 42,
    "天恩日": 59,
}

# 語る強さ。3=最大級（年数日）/ 2=強い / 1=控えめ / 0=T1を出さない
TIER = {3: "peak", 2: "strong", 1: "mild", 0: "skip"}


def tier(d: datetime.date) -> int:
    labels = S.lucky_labels(d)
    n = len(labels)
    if n == 0:
        return 0
    if n == 3:
        return 3
    if n == 2:
        return 2
    # 単独: 一粒万倍日は年37日で意味も強いので mild+、天恩日単独は最弱
    if labels == ["一粒万倍日"]:
        return 2
    return 1


def plan(d: datetime.date) -> dict:
    labels = S.lucky_labels(d)
    t = tier(d)
    key = " + ".join(labels)
    return {
        "date": d.isoformat(),
        "labels": labels,
        "tier": t,
        "tier_name": TIER[t],
        "freq_per_year": FREQ_2026.get(key),
        "use_T1": t >= 2,          # T1(選日型)を出すのはtier2以上だけ
        "note": {
            3: "年数日の最大級。時間窓を切って強く出す",
            2: "強い日。素直に選日を主題にできる",
            1: "弱い。T1を出すなら控えめに、または T2/T3 に回す",
            0: "選日なし。T2/T3 のみ",
        }[t],
    }


if __name__ == "__main__":
    import json
    from collections import Counter
    c = Counter()
    d = datetime.date(2026, 1, 1)
    while d <= datetime.date(2026, 12, 31):
        c[tier(d)] += 1
        d += datetime.timedelta(days=1)
    print("2026年 tier分布:", dict(sorted(c.items(), reverse=True)))
    print("T1を出せる日(tier>=2):", c[3] + c[2], "日 / 365")
    for s in ["2026-09-06", "2026-09-07", "2026-09-02", "2026-09-08"]:
        print(json.dumps(plan(datetime.date.fromisoformat(s)), ensure_ascii=False))
