#!/usr/bin/env python3
"""
main.py — ブロックを並べて飛ばす（使い方は 使い方.md）

    python main.py          実機
    python main.py --dry    偽の機体で練習
"""
from blocks import *


def mission():
    """ここにブロックを上から順に並べる"""
    takeoff()             # 離陸
    forward(500)          # 前に 5m
    forward(300)          # 前に 3m（合計 8m）
    land_on_marker(1)     # マーカー1 を前後で探して、真上に着陸


if __name__ == "__main__":
    # markers は --dry（偽の機体）のときだけ使う：マーカー1 を 8m 先に置く
    raise SystemExit(run(mission, markers={1: (800, 15)}))
