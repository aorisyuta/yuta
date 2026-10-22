import time
import math
import sys
import os
import json
import random
import signal


def install_stop_handlers():
    """停止ボタン・ウィンドウを閉じる・Ctrl+Break でも Ctrl+C と同じ扱いにして、着陸してから終わる。
    （タスクマネージャーなどで強制終了された場合は着陸できない。止めるときは Ctrl+C を使うこと）"""
    def _stop(signum, frame):
        raise KeyboardInterrupt
    for name in ("SIGTERM", "SIGBREAK"):
        sig = getattr(signal, name, None)
        if sig is not None:
            try:
                signal.signal(sig, _stop)
            except (ValueError, OSError):
                pass

# ==========================================
# 3.7 調整つまみを全部ファイル先頭に集める
# ==========================================
class S:
    SPEED_CM_S = 100            # 2.2 移動は最低1m/s (API上限と要求が一致)
    FINE_SPEED_CM_S = 30        # マーカーに寄せる小さな移動の速さ
    CLIP_ALT_CM = 50            # 6.2 クリップ高度 (58cm角の視野確保)
    CEILING_CM = 240            # 3.6 天井ガード (日本の一般的な室内)
    CEILING_MARGIN_CM = 20      # 3.6 天井ガードの余裕
    MIN_MANUAL_MOVE_CM = 20     # 3.2 自分で動かす下限 (20cm未満はAPIに任せる)
    API_MOVE_MAX_CM = 299       # single_fly_forward 等は 0 < 距離 < 300
    TOLERANCE_CM = 4            # 3.2 到着判定 (4cm未満は直そうとすると悪化する)
    MOVE_TOL_CM = 15            # move の到着判定（座標で見る。細かい合わせは clip の担当）
    MOVE_MAX_ITERS = 3          # move の位置補正の最大回数
    LAND_WAIT_S = 12            # 6.2 着陸後の待機 (ルールの10秒+余裕2秒)
    TAKEOFF_WAIT_S = 3.5        # 5.2 (9) 離陸直後は指令を受け付けない（実機で 2.5 秒後の前進が無視された）
    QR_SIZE_CM = 16             # ARマーカーの大きさ
    ALIGN_RETRIES = 3           # 内蔵の位置合わせを何回まで試すか
    HEADING_TOL_DEG = 5         # 機首の向きがこれ以上ずれたら戻す
    SEARCH_ALT_CM = 150         # マーカーが見えないとき、ここまで上がって視野を広げる
    SEARCH_STEP_CM = 70         # マーカー探索で横に動く幅（150cm の高さで見える範囲 約±90cm より少し狭く）

    # 競技エリア (12m × 3.5m)。離陸地点が (0, 0)、奥が +x、左が +y
    FIELD_X_MAX_CM = 1200
    FIELD_Y_HALF_CM = 175
    GEOFENCE_MARGIN_CM = 30     # エリア端からこれだけ内側までしか行かない

    # 座標の向き
    #   get_coordinate() の向きは calibrate() で離陸直後に測る（前に 80cm・左に 50cm 動いて調べる）
    #   get_yaw()[0]   : 左旋回で増えるなら +1、減るなら -1
    #   マーカー認識の x, y: x が前、y が左。補正方向が逆なら MARKER_SIGN = -1
    YAW_SIGN = 1
    MARKER_SIGN = 1
    CALIB_FWD_CM = 80           # 向きを測るために前に進む距離
    CALIB_LEFT_CM = 50          # 左右の向きを測るために左に動く距離
    CALIB_SNAP_DEG = 10         # 測った向きが 0° か機首の向きにこれ以内なら、そちらに揃える（測定の揺れを消す）

    # 異常検知（衝突・墜落したら命令を出し続けずに止まる）
    MAX_TILT_DEG = 25           # これ以上傾いていたら異常
    MIN_FLY_ALT_CM = 15         # 飛んでいるはずなのにこれより低ければ異常


class DroneError(RuntimeError):
    pass


class DroneCrash(DroneError):
    """衝突・墜落など、飛行を続けてはいけない異常"""


def wrap_deg(a):
    """角度を -180〜180 に正規化"""
    return (a + 180.0) % 360.0 - 180.0


def world_to_body(dx, dy, yaw_deg):
    """ワールド座標の変位 → 機体座標 (前, 左)"""
    yaw = math.radians(yaw_deg)
    fwd = dx * math.cos(yaw) + dy * math.sin(yaw)
    left = -dx * math.sin(yaw) + dy * math.cos(yaw)
    return fwd, left


def body_to_world(fwd, left, yaw_deg):
    """機体座標 (前, 左) → ワールド座標の変位"""
    yaw = math.radians(yaw_deg)
    return (fwd * math.cos(yaw) - left * math.sin(yaw),
            fwd * math.sin(yaw) + left * math.cos(yaw))


class HulaController:
    def __init__(self, api_instance):
        """api_instance: pyhula.UserApi（接続済み）か、練習用の FakeApi"""
        if api_instance is None:
            raise DroneError("api_instance がありません。実機なら pyhula.UserApi、練習なら FakeApi を渡してください。")
        self.api = api_instance
        # FakeApi は仮想の時計を持つ（待ち時間を本当に待たない）
        self.clock = getattr(api_instance, "clock", None)
        self.measured = set()
        self.cost_s = {
            "touchdown": 3.0,
            "align_api": 4.0,
            "hover_flight": 3.0
        }
        self.anchor_dx = 0.0
        self.anchor_dy = 0.0
        self.flying = False
        self.heading_ref = None     # 最初の離陸時の機首の向き（これを「まっすぐ」とする）
        self.last_land_xy = None    # 最後に着陸した地点。再離陸後にここで座標を合わせ直す
        self.marker_xy = {}         # マーカー番号 → 最後に見えたときの座標
        # get_coordinate() の座標 → 競技エリア座標 の変換（calibrate() で測る）
        self.frame_offset_deg = 0.0  # 生の座標が競技エリアに対して何度回っているか
        self.y_sign = 1              # 生の座標の y が右向きなら -1
        self.calibrated = False
        self.takeoff_t = None
        # マーカーが見えないときの探索の動き (前, 左) cm。既定は元の場所を囲む四角
        # （前 → 左 → 後ろ×2 → 右×2 → 前×2）。前後だけで探すなら差し替える
        st = S.SEARCH_STEP_CM
        self.search_moves = [(st, 0), (0, st), (-st, 0), (-st, 0), (0, -st), (0, -st), (st, 0), (st, 0)]

        # 3.8 ログ設定: 失敗しても情報が残るようにする
        os.makedirs("logs", exist_ok=True)
        self.log_file = open(f"logs/run_{int(time.time() * 1000)}.jsonl", "a", encoding="utf-8")

    # ==========================================
    # 実機特有の不具合回避・ユーティリティ
    # ==========================================
    @staticmethod
    def _int_args(args):
        """5.2 (8) 数値引数は整数でなければならない。実機APIへ渡す前に変換する"""
        out = []
        for a in args:
            if isinstance(a, bool):
                out.append(a)
            elif isinstance(a, float):
                out.append(int(round(a)))
            else:
                out.append(a)
        return out

    @staticmethod
    def max_alt():
        """3.6 天井ガード。上がってよい高さの上限を返す"""
        if S.CEILING_CM is None:
            return float("inf")
        return max(S.CLIP_ALT_CM, S.CEILING_CM - S.CEILING_MARGIN_CM)

    def now(self):
        return self.clock.now() if self.clock else time.time()

    def sleep(self, s):
        if s <= 0:
            return
        if self.clock:
            self.clock.sleep(s)
        else:
            time.sleep(s)

    def _log(self, entry):
        self.log_file.write(json.dumps(entry, ensure_ascii=False, default=str) + "\n")
        self.log_file.flush()

    def _api_call(self, func_name, *args):
        """実機APIを安全に呼ぶためのラッパー。呼び出し直前にログをfsyncする。失敗したら1回だけやり直す"""
        safe_args = self._int_args(args)
        self._log({"time": self.now(), "call": func_name, "args": safe_args})
        os.fsync(self.log_file.fileno())

        fn = getattr(self.api, func_name, None)
        if fn is None:
            raise DroneError("API に %s がありません" % func_name)
        last = None
        for _ in range(2):
            try:
                result = fn(*safe_args)
                self._log({"time": self.now(), "result_for": func_name, "val": result})
                return result
            except Exception as e:  # pyhula の例外型は公開されていないので広く捕まえる
                last = e
                self._log({"time": self.now(), "error_for": func_name, "err": repr(e)})
                time.sleep(0.3)
        raise DroneError("%s が失敗: %s" % (func_name, last))

    # ==========================================
    # センサ
    # ==========================================
    def raw_xyz(self):
        """機体の get_coordinate() を呼び出し、現在の(x, y, z)を返す。
        飛んでいるはずなのに高さがほぼ 0 なら DroneCrash"""
        x, y, z = self._api_call("get_coordinate")
        x, y, z = float(x), float(y), float(z)
        if (self.flying and self.takeoff_t is not None
                and self.now() - self.takeoff_t > S.TAKEOFF_WAIT_S and z < S.MIN_FLY_ALT_CM):
            raise DroneCrash("高さが %.0fcm です。衝突・墜落した可能性があります（座標 %.0f, %.0f）" % (z, x, y))
        return x, y, z

    def _raw_to_field(self, x, y):
        """生の座標 → 競技エリアの向きの座標（アンカー補正前）"""
        y *= self.y_sign
        a = math.radians(-self.frame_offset_deg)
        return x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a)

    def xyz(self):
        """アンカー補正済みの競技エリア座標 (x, y, z)"""
        x, y, z = self.raw_xyz()
        fx, fy = self._raw_to_field(x, y)
        return fx + self.anchor_dx, fy + self.anchor_dy, z

    def yaw(self):
        """機首の向き（度、左回り正。get_yaw の値そのもの）。大きく傾いていたら DroneCrash"""
        ypr = self._api_call("get_yaw")
        if self.flying and max(abs(float(ypr[1])), abs(float(ypr[2]))) > S.MAX_TILT_DEG:
            raise DroneCrash("機体が傾いています（pitch %.0f°, roll %.0f°）。衝突した可能性があります"
                             % (float(ypr[1]), float(ypr[2])))
        return wrap_deg(float(ypr[0]) * S.YAW_SIGN)

    def heading(self):
        """競技エリアでの機首の向き（度）。最初の離陸前の向き（= 奥の方向）が 0"""
        if self.heading_ref is None:
            return 0.0
        return wrap_deg(self.yaw() - self.heading_ref)

    def battery(self):
        try:
            return int(self._api_call("get_battery"))
        except (DroneError, TypeError, ValueError):
            return -1

    def see_marker(self, qr):
        """下のカメラでマーカーを探す。見えたらマーカーまでのズレ (前, 左) cm、見えなければ None"""
        try:
            r = self._api_call("single_fly_Optical_flow_recognition", qr, S.QR_SIZE_CM) or {}
        except DroneError:
            return None
        if not r.get("result"):
            return None
        off = float(r.get("x", 0)) * S.MARKER_SIGN, float(r.get("y", 0)) * S.MARKER_SIGN
        # 見えたマーカーの座標を覚えておく（見失ったときにここへ戻る）
        try:
            x, y, _ = self.xyz()
            wx, wy = body_to_world(off[0], off[1], self.heading())
            self.marker_xy[qr] = (x + wx, y + wy)
        except DroneCrash:
            raise
        except DroneError:
            pass
        return off

    # ==========================================
    # 安全・時間管理・座標系管理
    # ==========================================
    @staticmethod
    def clamp_to_field(x, y):
        """座標を競技エリアの内側に押し込む（離陸地点 x=0 は許す）"""
        m = S.GEOFENCE_MARGIN_CM
        return (min(max(x, 0.0), S.FIELD_X_MAX_CM - m),
                min(max(y, -S.FIELD_Y_HALF_CM + m), S.FIELD_Y_HALF_CM - m))

    def anchor(self, true_x, true_y):
        """2.3 今いる場所の本当の座標が分かったときに座標を合わせ直す(アンカー補正)"""
        x, y, z = self.raw_xyz()
        fx, fy = self._raw_to_field(x, y)
        self.anchor_dx = true_x - fx
        self.anchor_dy = true_y - fy

    def calibrate_from_forward(self, x0, y0, x1, y1, h):
        """前にだけ進んだ結果（生の座標 (x0,y0) → (x1,y1)、そのときの向き h）から座標の向きを測る。
        左右には動かない（左右が逆の座標には対応しない）。(x0, y0) を競技エリアの原点にする"""
        self.y_sign = 1
        a = wrap_deg(math.degrees(math.atan2(y1 - y0, x1 - x0)) - h)
        for cand in (0.0, self.heading_ref or 0.0):
            if abs(wrap_deg(a - cand)) <= S.CALIB_SNAP_DEG:
                a = cand
                break
        self.frame_offset_deg = a
        self.calibrated = True
        fx0, fy0 = self._raw_to_field(x0, y0)
        self.anchor_dx, self.anchor_dy = -fx0, -fy0
        print("  座標の向きを測りました: 回転 %+.0f°" % a)

    def calibrate(self):
        """最初の離陸直後に1回だけ呼ぶ。前と左に少し動いて、get_coordinate() の座標の向きを測る。
        機首の向き(get_yaw)が 0° でなくても、座標の向きがどうなっていても、正しく飛べるようになる"""
        self.frame_offset_deg, self.y_sign = 0.0, 1
        h = self.heading()
        x0, y0, _ = self.raw_xyz()
        # 1) 前に進んで、座標がどちらに増えるかを見る
        for _ in range(2):
            self._axis("single_fly_forward", "single_fly_back", S.CALIB_FWD_CM, 50)
            x1, y1, _ = self.raw_xyz()
            if math.hypot(x1 - x0, y1 - y0) >= 0.4 * S.CALIB_FWD_CM:
                break
            self.sleep(1.0)   # 命令が無視された（離陸直後など）→ 少し待ってもう一度
        else:
            raise DroneError("前に進む命令を出しても座標が変わりません（座標 %.0f, %.0f → %.0f, %.0f）"
                             % (x0, y0, x1, y1))
        fdx, fdy = x1 - x0, y1 - y0
        # 2) 左に動いて、座標の左右が逆になっていないかを見る
        self._axis("single_fly_left", "single_fly_right", S.CALIB_LEFT_CM, 50)
        x2, y2, _ = self.raw_xyz()
        ldx, ldy = x2 - x1, y2 - y1
        if math.hypot(ldx, ldy) >= 0.4 * S.CALIB_LEFT_CM:
            # 前 → 左 が左回り（外積が +）なら普通、右回りなら y が逆
            self.y_sign = 1 if fdx * ldy - fdy * ldx > 0 else -1
        else:
            print("  ⚠ 左に動いても座標が変わらないので、左右は普通の向きとみなします")
        a = wrap_deg(math.degrees(math.atan2(fdy * self.y_sign, fdx)) - h)
        # 測定の揺れを消す：0°（離陸時の向き基準）か機首の向き（方位基準）に近ければそちらに揃える
        for cand in (0.0, self.heading_ref or 0.0):
            if abs(wrap_deg(a - cand)) <= S.CALIB_SNAP_DEG:
                a = cand
                break
        self.frame_offset_deg = a
        self.calibrated = True
        # 離陸地点 (0, 0) が競技エリアの原点になるように合わせ直す
        fx0, fy0 = self._raw_to_field(x0, y0)
        self.anchor_dx, self.anchor_dy = -fx0, -fy0
        x, y, _ = self.xyz()
        print("  座標の向きを測りました: 回転 %+.0f°  左右 %s  → 今の座標 (%.0f, %+.0f)"
              % (a, "普通" if self.y_sign == 1 else "逆", x, y))

    def affordable(self, what, remaining):
        """3.3 終わらない動作は始めない"""
        margin = 0.8 if what in self.measured else 2.0
        cost = self.cost_s.get(what, 5.0)
        return remaining >= cost * margin

    def wait_after_takeoff(self):
        """5.2 (9) 離陸直後は指令を受け付けないため、2.5秒待機する"""
        self.sleep(S.TAKEOFF_WAIT_S)

    def check_altitude_changed(self, target_alt):
        """5.2 (9) 高度指令のあとに実際に高度が変化したかを確認し、変化していなければやり直す"""
        self.sleep(0.5)
        _, _, current_z = self.raw_xyz()
        diff = target_alt - current_z
        if abs(diff) > 10:
            self._move_vertical(diff)

    def safe_shutdown(self):
        """緊急停止や異常時に即着陸する"""
        self.emergency_land()
        sys.exit(1)

    # ==========================================
    # 離着陸
    # ==========================================
    def takeoff(self):
        """離陸。2回目以降は、前回着陸した地点で座標を合わせ直す"""
        if self.flying:
            return
        if self.heading_ref is None:
            self.heading_ref = self.yaw()   # 最初の離陸前の向きを「まっすぐ」とする
        self._api_call("single_fly_takeoff")
        self.flying = True
        self.takeoff_t = self.now()
        self.wait_after_takeoff()
        if self.last_land_xy is not None:
            self.anchor(*self.last_land_xy)
        self.fix_heading()

    def land(self, timeout=None, xy=None):
        """着陸して、ルールの10秒（+余裕）その場で待つ。
        xy: 着陸地点の本当の座標が分かっていれば渡す（次の離陸で座標を合わせ直す）"""
        if not self.flying:
            return
        if xy is None:
            x, y, _ = self.xyz()
            xy = (x, y)
        self._api_call("single_fly_touchdown")
        self.flying = False
        self.last_land_xy = xy
        self.sleep(S.LAND_WAIT_S)

    def emergency_land(self):
        """エラー・Ctrl+C のときに待たずに着陸する"""
        if not self.flying:
            return
        try:
            self._api_call("single_fly_touchdown")
            self.flying = False
        except DroneError as e:
            print("✗ 着陸コマンド失敗！手動で止めてください:", e)

    def close(self):
        if self.log_file:
            self.log_file.close()
            self.log_file = None

    # ==========================================
    # 3つの基本動作 (move / clip / home)
    # ==========================================
    def move(self, qr, target_x, target_y):
        """原点基準の絶対座標(x, y)へ移動する。着いたら True"""
        # エリアの外には出ない
        tx, ty = self.clamp_to_field(target_x, target_y)
        if (tx, ty) != (target_x, target_y):
            print("  ⚠ 目標 (%s, %s) はエリアの端に近いので (%.0f, %.0f) にします" % (target_x, target_y, tx, ty))

        for _ in range(S.MOVE_MAX_ITERS):
            self.fix_heading()
            x, y, _ = self.xyz()
            dx, dy = tx - x, ty - y
            if math.hypot(dx, dy) <= S.MOVE_TOL_CM:
                return True
            # 機体の向きを加味して「前・左」に直す
            fwd, left = world_to_body(dx, dy, self.heading())
            if abs(fwd) < S.MIN_MANUAL_MOVE_CM and abs(left) < S.MIN_MANUAL_MOVE_CM:
                break   # 20cm 未満は動けない。残りは clip で合わせる
            self._move_manual(fwd, left)
        x, y, _ = self.xyz()
        return math.hypot(tx - x, ty - y) <= S.MIN_MANUAL_MOVE_CM

    def clip(self, qr, target_alt, timeout, use_align=True):
        """指定番号のARマーカーを正確に捉え、その真上で静止する(距離に応じた3段階制御)。
        成功したら True。timeout 秒を過ぎたら False。
        use_align=False なら 20cm 以内に寄れた時点で成功（粗い合わせ用。内蔵の位置合わせを使わない）"""
        start_time = self.now()

        def remaining():
            return timeout - (self.now() - start_time)

        # 準備：今の高さで見えれば大きく寄せてから、クリップ高度まで下りる
        self._prepare_clip(qr, target_alt)

        last_off = None   # 【手書きメモ追加】過去に見えたズレを保持
        align_tries = 0
        while remaining() > 0:
            off = self.see_marker(qr)
            if off is None:
                # 【例外処理】画面内にARマーカーがない場合
                if last_off is not None:
                    # 完全にフリーズするのを防ぐため、過去に認識した位置へ一度移動する
                    self._move_manual(*last_off, speed=S.FINE_SPEED_CM_S)
                    last_off = None   # 一度使ったらリセット
                    continue
                # 過去の位置もなければ上がって探す。見つけたら寄せてから下りる（寄せずに下りると見失う）
                found = self._search_marker(qr, remaining)
                if found is None:
                    break
                self._move_manual(*found, speed=S.FINE_SPEED_CM_S)
                self._go_alt(target_alt)
                continue
            last_off = off

            dist = math.hypot(*off)
            if dist < S.TOLERANCE_CM:
                return True   # 4cm未満: 何もしない (成功)
            if abs(off[0]) > S.MIN_MANUAL_MOVE_CM or abs(off[1]) > S.MIN_MANUAL_MOVE_CM:
                # 20cm以上: 自作コマンドで大きく寄せる
                self._move_manual(*off, speed=S.FINE_SPEED_CM_S)
                continue
            # 4〜20cm: 前後左右コマンドでは細かく動けないので、内蔵の位置合わせAPIに任せる
            if not use_align:
                return True
            if align_tries >= S.ALIGN_RETRIES or not self.affordable("align_api", remaining()):
                break
            align_tries += 1
            if self._call_align_api(qr):
                return True
        return False

    def home(self, qr=1):
        """原点に戻り、原点にクリップする"""
        self.move(qr, 0, 0)
        return self.clip(qr, S.CLIP_ALT_CM, timeout=6.0)

    # ==========================================
    # 内部処理・テスト機能
    # ==========================================
    def fix_heading(self):
        """機首の向きがずれていたら最初の向きに戻す（ずれると前後左右の移動が斜めになる）"""
        if self.heading_ref is None:
            return
        err = wrap_deg(self.heading_ref - self.yaw())
        if abs(err) >= S.HEADING_TOL_DEG:
            if err > 0:
                self._api_call("single_fly_turnleft", abs(err))
            else:
                self._api_call("single_fly_turnright", abs(err))

    def _prepare_clip(self, qr, alt):
        """クリップの【準備】段階。マーカーに寄せてから高度を合わせる"""
        off = self.see_marker(qr)
        if off is not None:
            self._move_manual(*off, speed=S.FINE_SPEED_CM_S)
        self._go_alt(alt)

    def _search_marker(self, qr, remaining):
        """マーカー探索：上がって視野を広げ、それでも見えなければ周りを四角く回って探す。
        見つけたらマーカーまでのズレ (前, 左)、見つからなければ None"""
        self._go_alt(min(S.SEARCH_ALT_CM, self.max_alt()))
        off = self.see_marker(qr)
        if off is not None:
            return off
        for fwd, left in self.search_moves:
            if remaining() < 6:
                return None
            self._move_manual(fwd, left, speed=S.FINE_SPEED_CM_S)
            off = self.see_marker(qr)
            if off is not None:
                return off
        return None

    def _call_align_api(self, qr):
        """内蔵の位置合わせ（カメラでマーカーの真上に合わせる）。成功したら True"""
        t0 = self.now()
        try:
            ok = bool(self._api_call("single_fly_Optical_flow_alignment", qr, S.QR_SIZE_CM, 0))
        except DroneError:
            ok = False
        self.cost_s["align_api"] = self.now() - t0
        self.measured.add("align_api")
        return ok

    def _go_alt(self, alt):
        """高さ alt cm へ（天井ガード付き）"""
        alt = min(alt, self.max_alt())
        _, _, z = self.raw_xyz()
        if abs(alt - z) >= S.MIN_MANUAL_MOVE_CM:
            self._move_vertical(alt - z)
            self.check_altitude_changed(alt)

    def _move_vertical(self, dz):
        if abs(dz) < S.MIN_MANUAL_MOVE_CM:
            return
        self._axis("single_fly_up", "single_fly_down", dz, 40)

    def _axis(self, pos_cmd, neg_cmd, d, speed):
        """1軸の移動。300cm以上は分割し、最後の1回が20cm未満にならないようにする"""
        if abs(d) < S.MIN_MANUAL_MOVE_CM:
            return
        cmd = pos_cmd if d > 0 else neg_cmd
        speed = min(max(speed, 10), 100)
        remaining = abs(d)
        while remaining >= S.MIN_MANUAL_MOVE_CM:
            step = min(remaining, S.API_MOVE_MAX_CM)
            if 0 < remaining - step < S.MIN_MANUAL_MOVE_CM:
                step = remaining - S.MIN_MANUAL_MOVE_CM
            self._send_checked(cmd, step, speed)
            remaining -= step

    def _send_checked(self, cmd, step, speed):
        """前後左右の命令を送り、座標で本当に動いたか確かめる。
        実機では命令が 0.1 秒で拒否されたり、途中で止まったりする（どちらも false が返る）ので、
        動いた量が半分未満なら少し待って残りを1回だけ送り直す"""
        if cmd in ("single_fly_up", "single_fly_down"):
            self._api_call(cmd, step, speed)
            return
        xa, ya, _ = self.raw_xyz()
        self._api_call(cmd, step, speed)
        xb, yb, _ = self.raw_xyz()
        moved = math.hypot(xb - xa, yb - ya)
        rest = step - moved
        if moved < 0.5 * step and rest >= S.MIN_MANUAL_MOVE_CM:
            self._log({"time": self.now(), "note": "%s %d のうち %.0fcm しか動いていない → 残りを送り直す"
                       % (cmd, step, moved)})
            self.sleep(0.5)
            self._api_call(cmd, rest, speed)

    def _move_manual(self, dx, dy, speed=None):
        """自前の前後左右コマンド。機体の前(x), 左(y)を正とする"""
        speed = S.SPEED_CM_S if speed is None else speed
        if abs(dx) < S.MIN_MANUAL_MOVE_CM and abs(dy) < S.MIN_MANUAL_MOVE_CM:
            return
        # 行き先がエリアの外なら、エリアの内側までに縮める
        x, y, _ = self.xyz()
        yaw = self.heading()
        wx, wy = body_to_world(dx, dy, yaw)
        cx, cy = self.clamp_to_field(x + wx, y + wy)
        if (cx, cy) != (x + wx, y + wy):
            dx, dy = world_to_body(cx - x, cy - y, yaw)
        self._axis("single_fly_forward", "single_fly_back", dx, speed)
        self._axis("single_fly_left", "single_fly_right", dy, speed)

    # ==========================================
    # 本日のTODO (手書きメモより) 用のテスト関数
    # ==========================================
    def test_hover_20s(self):
        """TODO 2: スタート地点から浮き上がって、最低20秒間は安定して静止できるようにする"""
        self.takeoff()
        # 安定静止のテスト (20秒)。1秒ごとに位置を表示
        for i in range(20):
            x, y, z = self.xyz()
            print("  %2d秒  x %+.0f  y %+.0f  高さ %.0fcm" % (i, x, y, z))
            self.sleep(1)
        self.land(xy=(0.0, 0.0))


# ==========================================
# 練習用：実機なしで動作を確認する偽の機体 (--dry)
# ==========================================
class FakeClock:
    def __init__(self):
        self.t = 0.0

    def now(self):
        return self.t

    def sleep(self, s):
        self.t += max(0.0, s)


class FakeApi:
    """pyhula.UserApi と同じ名前の命令を持つ偽の機体。points のマーカー位置を知っている。

    yaw0      : 離陸前の get_yaw の値（実機では -35° などになる）
    abs_frame : True なら get_coordinate の向きが方位基準（yaw=0 の方向が +x）。False なら離陸時の機首が +x
    mirror    : True なら get_coordinate の y が右向き
    エリアの外に出るとネットにぶつかって落ちる（座標 0,0,0・傾き 35°）
    """

    def __init__(self, points=(), seed=None, yaw0=0.0, abs_frame=False, mirror=False):
        self.clock = FakeClock()
        self.rng = random.Random(seed)
        self.markers = {p["qr"]: (float(p["x"]), float(p["y"])) for p in points}
        self.x = self.y = self.z = self.yaw = 0.0   # 本当の位置（競技エリア座標）と向き
        self.yaw0, self.abs_frame, self.mirror = yaw0, abs_frame, mirror
        self.flying = False
        self.crashed = False

    def _move(self, fwd, left, up, speed):
        if not self.flying or self.crashed:
            return False
        n = lambda: self.rng.gauss(0, 2.0)
        wx, wy = body_to_world(fwd * 0.95 + n(), left * 0.92 + n(), self.yaw)
        self.x += wx
        self.y += wy
        self.z = max(10.0, self.z + up)
        self.yaw = wrap_deg(self.yaw + self.rng.gauss(0, 0.5))
        self.clock.sleep(math.sqrt(fwd * fwd + left * left + up * up) / speed + 1.0)
        if not (-50 <= self.x <= S.FIELD_X_MAX_CM and abs(self.y) <= S.FIELD_Y_HALF_CM):
            self.crashed, self.z = True, 0.0
        return True

    def connect(self, *a):
        return True

    def single_fly_takeoff(self, *a):
        self.flying, self.z = True, 100.0
        self.clock.sleep(3)
        return True

    def single_fly_touchdown(self, *a):
        self.flying, self.z = False, 0.0
        self.clock.sleep(2)
        return True

    def single_fly_hover_flight(self, t, *a):
        self.clock.sleep(t)
        return True

    def single_fly_forward(self, d, s=100, *a): return self._move(d, 0, 0, s)
    def single_fly_back(self, d, s=100, *a): return self._move(-d, 0, 0, s)
    def single_fly_left(self, d, s=100, *a): return self._move(0, d, 0, s)
    def single_fly_right(self, d, s=100, *a): return self._move(0, -d, 0, s)
    def single_fly_up(self, d, s=100, *a): return self._move(0, 0, d, s)
    def single_fly_down(self, d, s=100, *a): return self._move(0, 0, -d, s)

    def single_fly_turnleft(self, a, *_):
        self.yaw = wrap_deg(self.yaw + a)
        self.clock.sleep(1)
        return True

    def single_fly_turnright(self, a, *_):
        return self.single_fly_turnleft(-a)

    def _offset(self, qr):
        if qr not in self.markers or not self.flying or self.crashed:
            return None
        mx, my = self.markers[qr]
        fwd, left = world_to_body(mx - self.x, my - self.y, self.yaw)
        view = self.z * math.tan(math.radians(30)) + 8   # 下カメラの見える範囲
        return (fwd, left) if math.hypot(fwd, left) <= view else None

    def single_fly_Optical_flow_recognition(self, qr, size=16):
        self.clock.sleep(0.5)
        off = self._offset(qr)
        if off is None:
            return {"result": False, "x": 0, "y": 0, "z": 0, "yaw": 0, "qr_id": qr}
        return {"result": True, "x": round(off[0] + self.rng.gauss(0, 1), 1),
                "y": round(off[1] + self.rng.gauss(0, 1), 1), "z": -self.z, "yaw": 0, "qr_id": qr}

    def single_fly_Optical_flow_alignment(self, qr, size=16, angle=0):
        self.clock.sleep(4)
        if self._offset(qr) is None or self.rng.random() > 0.9:
            return False
        self.x, self.y = self.markers[qr][0] + self.rng.gauss(0, 1.5), self.markers[qr][1] + self.rng.gauss(0, 1.5)
        return True

    def get_coordinate(self):
        if self.crashed:
            return [0.0, 0.0, 0.0]
        x, y = self.x, self.y
        if self.abs_frame:
            x, y = body_to_world(x, y, self.yaw0)
        if self.mirror:
            y = -y
        return [round(x, 2), round(y, 2), round(self.z, 2)]

    def get_yaw(self):
        roll = 35.0 if self.crashed else 0.0
        return [round(wrap_deg(self.yaw + self.yaw0), 2), 0.0, roll]

    def get_battery(self):
        return 90

    def true_xy(self):
        return self.x, self.y


def main():
    print("このファイルは部品です。python code_artifact.py を実行してください。")


if __name__ == "__main__":
    main()
