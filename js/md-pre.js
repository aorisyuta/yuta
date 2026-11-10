/* ---- md-pre.js ---- */
/* =====================================================================
   UniBoard SPICE — 表示スタイルの判定 (描画より前に実行)
   Web 版も Android アプリと同じ Material Design 3 の見た目 (html.md) にする。
   旧デザインは URL に ?ui=classic を付けたときだけ (Android では使えない)
   ===================================================================== */
(function () {
  var d = document.documentElement;
  var app = !!window.AndroidBridge;
  if (app) d.classList.add('android');
  var q = location.search;
  // Android アプリは Material (md)。Web は Pro テーマ。?ui=md / ?ui=classic で旧デザインも確認できる
  var ui = app || /[?&]ui=md\b/.test(q) ? 'md' : /[?&]ui=classic\b/.test(q) ? 'classic' : 'pro';
  try { localStorage.removeItem('ubspice.ui'); } catch (e) { }
  if (ui === 'md') d.classList.add('md');
  if (ui === 'pro') {
    d.classList.add('pro');
    // 初回はダーク。保存済みのテーマがあれば描画前に当てておく (白いちらつき防止)
    try {
      var th = localStorage.getItem('ubcad.theme');
      if (th == null) { th = '"dark"'; localStorage.setItem('ubcad.theme', th); }
      th = JSON.parse(th);
      if (th === 'light' || th === 'dark') d.setAttribute('data-theme', th);
    } catch (e) { }
  }
})();
