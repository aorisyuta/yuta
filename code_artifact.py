import argparse
import json
import os
import sys

# hula_jp.py の HulaController を使う（同じフォルダに置くこと）
from hula_jp import HulaController, FakeApi, DroneError

SETTING_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "setting.json")

# 競技全体の制限時間 (レポート 1.1 本質的な制約より)
TOTAL_TIME_LIMIT_S = 120


def load_settings(path):
    """競技マップ設定の読み込み。当日15分の調整時間では、このJSONファイルだけを書き換える。

    形式:
    {
      "order": ["A", "B"],
      "points": [
        {"name": "A", "qr": 1, "x": 300, "y": 0, "clip_alt_cm": 50, "clip_timeout_s": 15},
        ...
      ]
    }
    x は奥へ（cm）、y は左が +（cm）。離陸地点が (0, 0)
    """
    try:
        with open(path, "r", encoding="utf-8") as f:
            settings = json.load(f)
    except FileNotFoundError:
        print("エラー: %s が見つかりません。" % path)
        sys.exit(1)
    except ValueError as e:
        print("エラー: setting.json の書き方が間違っています:", e)
        sys.exit(1)

    if "order" not in settings or "points" not in settings:
        print("エラー: setting.json に \"order\" と \"points\" が必要です。")
        sys.exit(1)
    need = ("name", "qr", "x", "y", "clip_alt_cm", "clip_timeout_s")
    for p in settings["points"]:
        missing = [k for k in need if k not in p]
        if missing:
            print("エラー: ポイント %s に %s がありません。" % (p.get("name", "?"), ", ".join(missing)))
            sys.exit(1)
    return settings


def connect_drone():
    """実機に接続して pyhula の API を返す"""
    try:
        import pyhula  # 実機用（公式配布の wheel を pip install しておく）
    except ImportError:
        print("エラー: pyhula が見つかりません。公式の wheel をインストールしてください。")
        sys.exit(1)
    api = pyhula.UserApi()
    if not api.connect():
        print("エラー: 機体に接続できませんでした。Wi-Fi が機体につながっているか確認してください。")
        sys.exit(1)
    return api


def run_mission(controller, settings):
    start_time = controller.now()

    # 1. 最初の離陸
    print("\n--- 離陸 ---")
    controller.takeoff()
    controller.calibrate()   # 前に 80cm・左に 50cm 動いて座標の向きを測る（これをしないと斜めに飛ぶ）

    # 2. JSONで指定された順番(order)通りにターゲットを巡回
    order = settings["order"]
    for i, target_name in enumerate(order):
        target = next((p for p in settings["points"] if p["name"] == target_name), None)
        if target is None:
            print("⚠ ターゲット [%s] が points にありません。飛ばします。" % target_name)
            continue

        # 残り時間の確認 (着陸の予算を残すため、残り20秒を切ったら中断)
        remaining_time = TOTAL_TIME_LIMIT_S - (controller.now() - start_time)
        if remaining_time < 20:
            print("残り時間が少ないため、次のターゲットへの移動を中止します。")
            break

        # 着陸済みなら再離陸してから向かう
        if not controller.flying:
            print("\n--- 次のポイントへ向けて再離陸 ---")
            controller.takeoff()

        print("\n>>> ターゲット [%s] に向かいます（%d/%d）  電池 %d%%"
              % (target_name, i + 1, len(order), controller.battery()))

        # [動作1] 移動 (move)
        print("  [1/3] 移動中... 座標(%s, %s)" % (target["x"], target["y"]))
        controller.move(qr=target["qr"], target_x=target["x"], target_y=target["y"])
        x, y, z = controller.xyz()
        print("        → 今の座標 (%.0f, %.0f)  高さ %.0fcm" % (x, y, z))

        # [動作2] クリップ (clip)
        print("  [2/3] クリップ開始 (制限時間: %s秒)" % target["clip_timeout_s"])
        clip_success = controller.clip(
            qr=target["qr"],
            target_alt=target["clip_alt_cm"],
            timeout=target["clip_timeout_s"],
        )

        # [動作3] 着陸と得点確保 (land)
        # ルール: ヘリポート上で10秒間静止する必要がある
        if clip_success:
            print("  -> クリップ成功！正確な位置に静止しました。")
            print("  [3/3] 着陸し、得点を確保します...")
            # マーカーの真上なので、着陸地点はターゲットの座標（次の離陸で座標を合わせ直す）
            controller.land(xy=(float(target["x"]), float(target["y"])))
        else:
            print("  -> クリップタイムアウト。可能な範囲で着陸へ移行します。")
            print("  [3/3] 着陸します...")
            controller.land()

    # 3. 競技終了。まだ飛んでいれば（時間切れで中断したときなど）着陸する
    print("\n>>> 巡回終了。")
    # 必要であれば controller.home() を呼び出して原点に戻る
    # controller.home()
    controller.land()


def main(argv=None):
    p = argparse.ArgumentParser(description="setting.json の順番でヘリポートを回る")
    p.add_argument("--dry", action="store_true", help="機体に接続せず、偽の機体で流れを確認する")
    p.add_argument("--setting", default=SETTING_FILE, help="設定ファイル（既定 setting.json）")
    p.add_argument("--hover-test", action="store_true", help="TODO 2: 20秒静止テストだけ行う")
    p.add_argument("--seed", type=int, default=None, help="--dry の乱数シード")
    args = p.parse_args(argv)

    print("=== プログラム開始 ===")
    settings = None if args.hover_test else load_settings(args.setting)

    if args.dry:
        api = FakeApi(settings["points"] if settings else [], seed=args.seed)
    else:
        api = connect_drone()
    controller = HulaController(api_instance=api)
    try:
        print("接続OK  電池 %d%%" % controller.battery())
        if args.hover_test:
            controller.test_hover_20s()
        else:
            run_mission(controller, settings)
        print("=== 競技終了 ===")
        if args.dry:
            x, y = api.true_xy()
            print("  [偽の機体の本当の位置] (%.0f, %.0f)" % (x, y))
        return 0
    except KeyboardInterrupt:
        print("\nCtrl+C → その場に着陸します")
        return 1
    except DroneError as e:
        print("✗ エラー → その場に着陸します:", e)
        return 1
    finally:
        controller.emergency_land()
        controller.close()


if __name__ == "__main__":
    raise SystemExit(main())
