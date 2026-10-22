#!/usr/bin/env python3
"""
clip8m.py — 初期位置から 8m 先の ARマーカーまで飛び、クリップで真上に合わせて正確に着陸する
=====================================================================
hula_jp.py の HulaController を使う。同じフォルダに置くこと。

    python clip8m.py --qr 1            実機：8m 先のマーカー番号 1 に着陸
    python clip8m.py --qr 1 --legs 200 試し：2m だけ前進してマーカーを探す
    python clip8m.py --dry             偽の機体で練習
    python clip8m.py --dry --error 60  偽の機体で、マーカーが予定より 60cm 前後にずれている練習

流れ（左右には動かない。左右に動くのはマーカーが見えて真上に合わせるときだけ）:
  1. 離陸して、機首の向きを覚える
  2. 前に 5m → 前に 3m（1回の前進は 5m が限界なので分ける）。
     1回目の前進で座標の向きも測る
  3. マーカーを探す：150cm まで上がって視野を広げ、前後に 0 → +60 → +120 → +180 → -60 → -120 → -180cm と動いて探す
  4. 粗いクリップ（高さ 100cm）→ 細かいクリップ（高さ 50cm、内蔵の位置合わせ）
     失敗したら 3 からやり直す（時間の許す限り）
  5. 着陸して 10 秒（+余裕）待つ
Ctrl+C でいつでも着陸して終了。
"""
import argparse
import math

from hula_jp import HulaController, FakeApi, DroneError, S, world_to_body, install_stop_handlers

LEGS_CM = (500, 300)     # 前進の区切り（5m + 3m）。1回の前進は 5m が限界
FWD_SPEED_CM_S = 100     # 前進の速さ
FIX_TOL_CM = 30          # 前進の後、前後の距離がこれ以上ずれていたら前後だけで直す
SEARCH_FB_CM = 60        # 前後探索の刻み
SEARCH_FB_MAX_CM = 180   # 前後探索でどこまで離れて見るか（0 → +60 → +120 → +180 → -60 → -120 → -180）
SEARCH_SPEED_CM_S = 60   # 前後探索の移動の速さ（30 だと長い移動が途中で止まった）
COARSE_ALT_CM = 100      # 粗いクリップの高さ（視野が広い）
COARSE_TIMEOUT_S = 15    # 粗いクリップの制限時間
FINE_TIMEOUT_S = 15      # 細かいクリップの制限時間
ATTEMPT_TIME_S = 120     # 1回の試技の制限時間（ルール 2分）
LAND_RESERVE_S = 18      # 着陸のために残しておく時間（クリップの最後の動作が長引く分も含む）


def build_parser():
    p = argparse.ArgumentParser(description="8m 先の ARマーカーまで飛んで正確に着陸する")
    p.add_argument("--qr", type=int, default=1, help="着陸するマーカーの番号（既定 1）")
    p.add_argument("--legs", type=int, nargs="+", default=list(LEGS_CM),
                   help="前進の区切り cm（既定 500 300 = 8m）。1つ 500 以下")
    p.add_argument("--dry", action="store_true", help="機体に接続せず、偽の機体で練習する")
    p.add_argument("--error", type=float, default=0.0,
                   help="--dry のとき、マーカーを予定から前後に何 cm ずらして置くか（+ で奥）")
    p.add_argument("--seed", type=int, default=None, help="--dry の乱数シード")
    p.add_argument("--yaw0", type=float, default=-35.0, help="--dry のとき、離陸前の get_yaw の値")
    p.add_argument("--abs-frame", action="store_true", help="--dry のとき、座標の向きを方位基準にする")
    return p


def connect_drone():
    """実機に接続して pyhula の API を返す"""
    try:
        import pyhula  # 実機用（公式配布の wheel を pip install しておく）
    except ImportError:
        raise DroneError("pyhula が見つかりません。公式の wheel をインストールしてください。")
    api = pyhula.UserApi()
    if not api.connect():
        raise DroneError("機体に接続できませんでした。Wi-Fi が機体につながっているか確認してください。")
    return api


def show(c, label):
    x, y, z = c.xyz()
    print("%s  座標 (%.0f, %+.0f)  高さ %.0fcm  向き %+.0f°  電池 %d%%"
          % (label, x, y, z, c.heading(), c.battery()))


def forward_only(c, d, speed=S.FINE_SPEED_CM_S):
    """前後だけに d cm 動く（+ で前）。左右には動かない"""
    if abs(d) < S.MIN_MANUAL_MOVE_CM:
        return
    c._axis("single_fly_forward", "single_fly_back", d, speed)


def advance(c, legs):
    """区切りごとに前だけに進む。1回目の前進で座標の向きを測る"""
    x0, y0, _ = c.raw_xyz()
    for i, leg in enumerate(legs):
        c.fix_heading()                  # 向きだけ直す（旋回。左右には動かない）
        h = c.heading()
        xa, ya, _ = c.raw_xyz()
        print("前に %dcm 進みます（%d/%d）" % (leg, i + 1, len(legs)))
        c._api_call("single_fly_forward", leg, FWD_SPEED_CM_S)
        xb, yb, _ = c.raw_xyz()
        moved = math.hypot(xb - xa, yb - ya)
        if moved < 0.5 * leg:
            # 命令が無視された・途中で止まった → 残りを 3m 未満ずつに分けて進む
            print("  ⚠ %.0fcm しか進んでいません。残り %.0fcm を分けて進みます" % (moved, leg - moved))
            forward_only(c, leg - moved, FWD_SPEED_CM_S)
            xb, yb, _ = c.raw_xyz()
            moved = math.hypot(xb - xa, yb - ya)
        if i == 0 and moved >= S.CALIB_FWD_CM:
            c.calibrate_from_forward(x0, y0, xb, yb, h)
        show(c, "  ")
    # 合計の距離がずれていたら前後だけで直す
    target = float(sum(legs))
    x, y, _ = c.xyz()
    fwd, _ = world_to_body(target - x, 0.0 - y, c.heading())
    if abs(fwd) > FIX_TOL_CM:
        print("  前後に %+.0fcm ずれているので直します" % fwd)
        forward_only(c, fwd)
        show(c, "  ")


def find_marker_fb(c, qr, deadline):
    """前後だけに動いてマーカーを探す。今いる場所から 0 → +60 → +120 → +180 と奥へ見ていき、
    なければ -60 → -120 → -180 と手前を見る（行ったり来たりしない。実機で大きな往復は途中で止まった）。
    見つけたら True"""
    c._go_alt(min(S.SEARCH_ALT_CM, c.max_alt()))   # 上がって視野を広げる
    x0, _, _ = c.xyz()
    steps = list(range(SEARCH_FB_CM, SEARCH_FB_MAX_CM + 1, SEARCH_FB_CM))
    offsets = [0] + steps + [-k for k in steps]
    for d in offsets:
        if deadline - c.now() < LAND_RESERVE_S + 8:
            return False
        gx = min(max(x0 + d, 0.0), S.FIELD_X_MAX_CM - S.GEOFENCE_MARGIN_CM)
        x, _, _ = c.xyz()
        fwd, _ = world_to_body(gx - x, 0.0, c.heading())
        forward_only(c, fwd, SEARCH_SPEED_CM_S)
        if c.see_marker(qr) is not None:
            print("    マーカー発見（探し始めの場所から前後 %+dcm）" % d)
            return True
    return False


def clip_and_land(c, qr, tx, ty, deadline):
    """マーカーを前後で探す → 粗いクリップ → 細かいクリップ をくり返し、成功したら真上に着陸する。成功なら True"""
    attempt = 0
    while True:
        attempt += 1
        left_s = deadline - c.now()
        if left_s < LAND_RESERVE_S + 5:
            print("  時間切れが近いので、今の場所に着陸します")
            break
        if c.see_marker(qr) is None:
            print("  [クリップ %d回目] マーカーが見えないので前後に探します" % attempt)
            if not find_marker_fb(c, qr, deadline):
                print("    見つかりませんでした。今の場所に着陸します")
                break
        left_s = deadline - c.now()
        print("  [クリップ %d回目] 粗く合わせる（高さ %dcm）" % (attempt, COARSE_ALT_CM))
        coarse = c.clip(qr, COARSE_ALT_CM, min(COARSE_TIMEOUT_S, left_s - LAND_RESERVE_S),
                        use_align=False)
        if not coarse:
            # 最後にマーカーが見えた場所に前後だけで戻って探し直す
            bx, by = c.marker_xy.get(qr, (tx, ty))
            x, y, _ = c.xyz()
            fwd, _ = world_to_body(bx - x, by - y, c.heading())
            print("    マーカーに寄れませんでした → 前後に %+.0fcm 戻ってやり直します" % fwd)
            forward_only(c, fwd)
            continue
        left_s = deadline - c.now()
        if left_s < LAND_RESERVE_S + 5:
            print("  時間切れが近いので、粗く合った位置に着陸します")
            c.land()
            return False
        print("  [クリップ %d回目] 細かく合わせる（高さ %dcm）" % (attempt, S.CLIP_ALT_CM))
        if c.clip(qr, S.CLIP_ALT_CM, min(FINE_TIMEOUT_S, left_s - LAND_RESERVE_S)):
            show(c, "  クリップ成功")
            # マーカーの真上なので、着陸地点はマーカーの座標
            c.land(xy=c.marker_xy.get(qr, (tx, ty)))
            return True
        print("    細かい合わせに失敗 → もう一度")
    c.land()
    return False


def run(argv=None):
    args = build_parser().parse_args(argv)
    if any(l <= 0 or l > 500 for l in args.legs):
        print("✗ --legs は 1〜500 cm で指定してください（1回の前進は 5m が限界）")
        return 1
    tx, ty = float(sum(args.legs)), 0.0
    if args.dry:
        # マーカーを予定から前後に --error cm ずらし、左右にも少しずらして置く（実機の座標のズレの代わり）
        api = FakeApi([{"qr": args.qr, "x": tx + args.error, "y": 15.0}], seed=args.seed,
                      yaw0=args.yaw0, abs_frame=args.abs_frame)
    else:
        api = connect_drone()
    c = HulaController(api_instance=api)
    install_stop_handlers()
    # クリップ中に見失ったときは、上がって見るだけにする（左右・前後に探し回らない）。
    # 探すのは clip_and_land の find_marker_fb（前後だけ）の担当
    c.search_moves = []
    ok = False
    try:
        print("接続OK  電池 %d%%  目標: %.0fcm 先のマーカー %d" % (c.battery(), tx, args.qr))
        start = c.now()
        deadline = start + ATTEMPT_TIME_S
        c.takeoff()
        show(c, "離陸OK")
        advance(c, args.legs)
        show(c, "到着 ")
        ok = clip_and_land(c, args.qr, tx, ty, deadline)
        print("着陸しました（%s）  かかった時間 %.0f秒"
              % ("マーカーの真上" if ok else "クリップできず", c.now() - start))
        if args.dry:
            x, y = api.true_xy()
            mx, my = api.markers[args.qr]
            print("  [偽の機体] マーカーとのズレ %.1fcm" % math.hypot(x - mx, y - my))
        return 0 if ok else 2
    except KeyboardInterrupt:
        print("\nCtrl+C → その場に着陸します")
        return 1
    except DroneError as e:
        print("✗ エラー → その場に着陸します:", e)
        return 1
    finally:
        c.emergency_land()
        c.close()


if __name__ == "__main__":
    raise SystemExit(run())
