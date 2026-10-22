#!/usr/bin/env python3
"""
blocks.py — main.py で使う「ブロック（部品）」集
=====================================================================
Scratch のブロックのように、main.py の mission() の中にこれらを並べるだけで飛ばせる。
接続・ログ・Ctrl+C・エラー時の着陸・2分の制限時間は run() が全部面倒を見る。

中身は hula_jp.py（機体の操作）と clip8m.py（マーカー探索・クリップ着陸）を使っている。
この3ファイルと main.py を同じフォルダに置くこと。

ブロック一覧（使い方は 使い方.md）
  離着陸   : takeoff()  land()  land_on_marker(qr)
  移動     : forward(cm)  back(cm)  left(cm)  right(cm)  up(cm)  down(cm)  height(cm)  go_to(x, y)
  向き     : turn_left(deg)  turn_right(deg)  face_front()
  マーカー : find_marker(qr)  clip(qr)  see_marker(qr)
  待つ     : hover(sec)
  調べる   : position()  battery()  time_left()  say(text)
  実行     : run(mission, markers=...)
"""
import argparse
import math

import clip8m
from hula_jp import HulaController, FakeApi, DroneError, S, install_stop_handlers

ATTEMPT_TIME_S = 120     # 1回の試技の制限時間（ルール 2分）。最初の takeoff() から数える
MAX_FORWARD_CM = 500     # 1回の前進命令の上限（5m）。これより長い forward() は分けて進む
FWD_SPEED_CM_S = 100     # forward() の速さ
MOVE_SPEED_CM_S = 60     # back / left / right の速さ

_c = None                # HulaController（run() が作る）
_api = None
_deadline = None         # 試技の終わりの時刻
_origin_raw = None       # 最初の離陸地点の生の座標（座標の向きを測るのに使う）


def _ctl():
    if _c is None:
        raise DroneError("ブロックは run(mission) の中で使ってください")
    return _c


# =========================================================================
# 離着陸
# =========================================================================
def takeoff():
    """離陸する（2回目以降は、前に着陸した場所で座標を合わせ直す）"""
    global _deadline, _origin_raw
    c = _ctl()
    c.takeoff()
    if _deadline is None:
        _deadline = c.now() + ATTEMPT_TIME_S
        x, y, _ = c.raw_xyz()
        _origin_raw = (x, y)
    _show("離陸OK")


def land():
    """その場に着陸して、ルールの10秒（+余裕）待つ"""
    _ctl().land()
    say("着陸しました")


def land_on_marker(qr):
    """マーカー qr を探して（前後だけ）、クリップで真上に合わせて着陸する。
    成功したら True。見つからない・時間切れならその場に着陸して False"""
    c = _ctl()
    x, y, _ = c.xyz()
    ok = clip8m.clip_and_land(c, qr, x, y, _deadline_or_default())
    say("マーカー %d の真上に着陸しました" % qr if ok else "マーカー %d に着陸できず、その場に着陸しました" % qr)
    return ok


# =========================================================================
# 移動
# =========================================================================
def forward(cm):
    """前に cm 進む（左右には動かない）。5m より長いと 5m ずつに分ける。
    最初の forward() で座標の向きを測るので、go_to() より先に1回 forward() すること"""
    remaining = float(cm)
    while remaining >= S.MIN_MANUAL_MOVE_CM:
        leg = min(remaining, MAX_FORWARD_CM)
        if 0 < remaining - leg < S.MIN_MANUAL_MOVE_CM:
            leg = remaining - S.MIN_MANUAL_MOVE_CM   # 最後が 20cm 未満にならないように
        _forward_leg(leg)
        remaining -= leg


def _forward_leg(leg):
    c = _ctl()
    c.fix_heading()                       # 向きだけ直す（旋回。左右には動かない）
    h = c.heading()
    xa, ya, _ = c.raw_xyz()
    say("前に %.0fcm 進みます" % leg)
    c._api_call("single_fly_forward", leg, FWD_SPEED_CM_S)
    xb, yb, _ = c.raw_xyz()
    moved = math.hypot(xb - xa, yb - ya)
    if moved < 0.5 * leg:
        # 命令が無視された・途中で止まった → 残りを 3m 未満ずつに分けて進む
        say("  ⚠ %.0fcm しか進んでいません。残り %.0fcm を分けて進みます" % (moved, leg - moved))
        clip8m.forward_only(c, leg - moved, FWD_SPEED_CM_S)
        xb, yb, _ = c.raw_xyz()
        moved = math.hypot(xb - xa, yb - ya)
    if not c.calibrated and moved >= S.CALIB_FWD_CM and _origin_raw is not None:
        c.calibrate_from_forward(_origin_raw[0], _origin_raw[1], xb, yb, h)
    _show("  ")


def back(cm):
    """後ろに cm 下がる"""
    _ctl()._axis("single_fly_forward", "single_fly_back", -float(cm), MOVE_SPEED_CM_S)
    _show("  ")


def left(cm):
    """左に cm 動く"""
    _ctl()._axis("single_fly_left", "single_fly_right", float(cm), MOVE_SPEED_CM_S)
    _show("  ")


def right(cm):
    """右に cm 動く"""
    _ctl()._axis("single_fly_left", "single_fly_right", -float(cm), MOVE_SPEED_CM_S)
    _show("  ")


def up(cm):
    """上に cm 上がる（天井ガード付き）"""
    c = _ctl()
    _, _, z = c.raw_xyz()
    c._go_alt(z + float(cm))


def down(cm):
    """下に cm 下がる"""
    c = _ctl()
    _, _, z = c.raw_xyz()
    c._go_alt(max(S.MIN_FLY_ALT_CM + 15, z - float(cm)))


def height(cm):
    """高さを cm にする"""
    _ctl()._go_alt(float(cm))


def go_to(x, y):
    """競技エリアの座標 (x, y) へ移動する（離陸地点が (0,0)、奥が +x、左が +y）。
    左右にも動く。先に forward() を1回して座標の向きを測っておくこと"""
    c = _ctl()
    if not c.calibrated:
        say("  ⚠ まだ forward() していないので、座標の向きが分かりません。斜めに飛ぶかもしれません")
    ok = c.move(None, x, y)
    _show("  ")
    return ok


# =========================================================================
# 向き
# =========================================================================
def turn_left(deg):
    """左に deg 度回る"""
    _ctl()._api_call("single_fly_turnleft", abs(float(deg)))


def turn_right(deg):
    """右に deg 度回る"""
    _ctl()._api_call("single_fly_turnright", abs(float(deg)))


def face_front():
    """最初に離陸したときの向き（奥）に向き直す"""
    _ctl().fix_heading()


# =========================================================================
# マーカー
# =========================================================================
def see_marker(qr):
    """今、真下にマーカー qr が見えるか。見えたら (前, 左) のズレ cm、見えなければ None"""
    return _ctl().see_marker(qr)


def find_marker(qr):
    """150cm まで上がり、前後だけに動いてマーカー qr を探す（0 → +60 → +120 → +180 → -60 → -120 → -180cm）。
    見つけたら True"""
    return clip8m.find_marker_fb(_ctl(), qr, _deadline_or_default())


def clip(qr, alt=S.CLIP_ALT_CM, timeout=15):
    """マーカー qr の真上に合わせて止まる（着陸はしない）。成功したら True"""
    return _ctl().clip(qr, alt, timeout)


# =========================================================================
# 待つ・調べる
# =========================================================================
def hover(sec):
    """その場で sec 秒待つ"""
    _ctl().sleep(float(sec))


def position():
    """今の座標 (x, y, 高さ) cm"""
    return _ctl().xyz()


def battery():
    """電池の残り %"""
    return _ctl().battery()


def time_left():
    """試技の残り時間（秒）。離陸前は 120"""
    if _deadline is None:
        return float(ATTEMPT_TIME_S)
    return _deadline - _ctl().now()


def say(text):
    """画面に表示する"""
    print(text)


def _show(label):
    c = _ctl()
    x, y, z = c.xyz()
    print("%s  座標 (%.0f, %+.0f)  高さ %.0fcm  向き %+.0f°  電池 %d%%  残り %.0f秒"
          % (label, x, y, z, c.heading(), c.battery(), time_left()))


def _deadline_or_default():
    return _deadline if _deadline is not None else _ctl().now() + ATTEMPT_TIME_S


# =========================================================================
# 実行
# =========================================================================
def run(mission, markers=None):
    """mission() を実行する。接続・ログ・Ctrl+C・エラー時の着陸を全部やる。

    markers: --dry（偽の機体）のときに置くマーカー {番号: (x, y)}。実機では使わない
    コマンドライン:
        python main.py            実機
        python main.py --dry      偽の機体で練習
        python main.py --dry --seed 3 --error 60   偽の機体、マーカーを奥に 60cm ずらす
    """
    global _c, _api, _deadline, _origin_raw
    p = argparse.ArgumentParser(description="main.py の mission() を実行する")
    p.add_argument("--dry", action="store_true", help="機体に接続せず、偽の機体で練習する")
    p.add_argument("--seed", type=int, default=None, help="--dry の乱数シード")
    p.add_argument("--error", type=float, default=0.0, help="--dry のとき、マーカーを奥に何 cm ずらして置くか")
    p.add_argument("--yaw0", type=float, default=-35.0, help="--dry のとき、離陸前の get_yaw の値")
    p.add_argument("--abs-frame", action="store_true", help="--dry のとき、座標の向きを方位基準にする")
    args = p.parse_args()

    if args.dry:
        pts = [{"qr": q, "x": float(xy[0]) + args.error, "y": float(xy[1])}
               for q, xy in (markers or {}).items()]
        _api = FakeApi(pts, seed=args.seed, yaw0=args.yaw0, abs_frame=args.abs_frame)
    else:
        try:
            _api = clip8m.connect_drone()
        except DroneError as e:
            print("✗", e)
            return 1
    _c = HulaController(api_instance=_api)
    install_stop_handlers()
    _c.search_moves = []      # クリップ中に見失っても左右に探し回らない（探すのは find_marker の担当）
    _deadline, _origin_raw = None, None
    try:
        print("接続OK  電池 %d%%" % _c.battery())
        mission()
        if _c.flying:
            say("mission() の最後で飛んでいたので着陸します")
            _c.land()
        print("=== 終了 ===")
        if args.dry and markers:
            x, y = _api.true_xy()
            for q in markers:
                mx, my = _api.markers[q]
                print("  [偽の機体] マーカー %d とのズレ %.1fcm" % (q, math.hypot(x - mx, y - my)))
        return 0
    except KeyboardInterrupt:
        print("\nCtrl+C → その場に着陸します")
        return 1
    except DroneError as e:
        print("✗ エラー → その場に着陸します:", e)
        return 1
    finally:
        _c.emergency_land()
        _c.close()
