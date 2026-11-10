# UniBoard SPICE

ブラウザで動く電子工作 CAD です。回路図 → SPICE シミュレーション → 蛇の目基板のパターン図 → プリント基板 (ガーバー出力) までを 1 つの画面で行えます。

`index.html` をブラウザで開くだけで動きます (ビルド不要)。GitHub Pages にもそのまま置けます。

## ファイル構成

```
index.html            画面の骨組み (HTML) と、css / js の読み込み順
css/
  base.css            共通の部品とレイアウト
  theme-new.css       配色とパネルの見た目
  theme-md.css        Android アプリ用 (Material Design 3、html.md)
  theme-pro.css       Web 版の標準テーマ (html.pro)
  theme-pro-mobile.css  Web 版の画面サイズ別の調整
  ui.css              配線色・組立手順・作業場ごとの色分け (最後に読み込む)
js/
  md-pre.js           テーマの判定 (描画より前に実行)
  cad-core.js         回路記号・フットプリント・ネットリスト抽出
  cad-board.js        蛇の目基板: 自動配置・自動配線・検証・配線指示・組立手順
  cad-doc.js          図面データの読み書き
  sch-tidy.js         回路図: 配線を整える / 自動レイアウト
  samples.js          サンプル回路
  spice.js            SPICE エンジン (ワーカーでも読み込む)
  spice-models.js     IC の動作モデル (ワーカーでも読み込む)
  parts-symbols.js    追加の回路記号
  parts-catalog.js    部品ライブラリ
  sim-netlist.js      回路図 → SPICE ネットリスト
  render.js           描画 (Canvas / SVG)
  app.js              回路図エディタ本体・基板変換の画面
  simui.js            シミュレーション画面
  pcbx.js             プリント基板 (PCB) 設計
  perf-manual.js      蛇の目基板の手配置読み込み
  perf-edit.js        蛇の目基板パターン図の手動調整
  calc.js             計算ツール
  shell.js            検索・コマンドパレット・自動保存
  md.js / pro.js      テーマごとの画面部品
tools/build.py        1 ファイル版 (dist/uniboard.html) を作る
```

各 js は `<script>` で順番に読み込む普通のスクリプトです (モジュールではありません)。
ファイルどうしは `window.CADCore` / `window.CADBoard` / `window.UniBoard` などのグローバルでやり取りします。
読み込み順は `index.html` の末尾に書いてある順番が正です。

## 1 ファイル版を作る

Android アプリ (WebView) に組み込むときや、1 ファイルだけ配りたいときに使います。

```bash
python3 tools/build.py
```

`dist/uniboard.html` に、css と js をすべて埋め込んだ HTML ができます。

## 手元で動かす

```bash
python3 -m http.server 8000
```

`http://localhost:8000/` を開きます。`index.html` を直接ダブルクリックしても動きます
(その場合、シミュレーションは別スレッドではなく画面と同じスレッドで計算します)。
