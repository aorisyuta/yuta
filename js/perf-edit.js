/* ---- perf-edit.js ---- */
/* =====================================================================
   UniBoard SPICE — 蛇の目基板パターン図の手動調整
   出力された基板の部品をドラッグで移動・R で回転できる (部品の追加・削除はしない)。
   動かすたびに、その部品につながる配線と新しい位置とぶつかる配線だけを引き直す。
   ===================================================================== */
(function () {
  'use strict';
  const UB = window.UniBoard, A = UB.api, S = () => UB.state, CB = window.CADBoard;
  const $ = id => document.getElementById(id);
  const el = A.el;
  const H = window.UBHooks = window.UBHooks || {};
  const toast = (t, l) => window.UBToast && window.UBToast(t, l);

  const E = { sel: -1, drag: null, undo: [], redo: [], ref: null };
  const rotI = r => ((r / 90) | 0) & 3;
  const shapeOf = (c, pos) => c.rots[rotI((pos || c.pos).rot)];
  const B = () => S().board;

  // 別の基板が出力されたら選択と履歴を捨てる
  function sync() {
    if (E.ref !== B()) { E.ref = B(); E.sel = -1; E.drag = null; E.undo = []; E.redo = []; }
  }
  function hole(wx, wy) {
    const b = B().board; let c = Math.round(wx); const r = Math.round(wy);
    if (S().boardView === 'bottom') c = b.cols - 1 - c;
    return [c, r];
  }
  function compAt(c, r) {
    const comps = B().prj.comps; let best = -1, area = Infinity;
    comps.forEach((k, i) => {
      const s = shapeOf(k);
      if (c >= k.pos.c && c < k.pos.c + s.w && r >= k.pos.r && r < k.pos.r + s.h && s.w * s.h < area) { area = s.w * s.h; best = i; }
    });
    return best;
  }
  // 置けるか: 基板の内側・他の部品と重ならない・四隅の禁止穴を避ける
  function check(ci, pos) {
    const st = B(), b = st.board, comp = st.prj.comps[ci], s = shapeOf(comp, pos);
    if (pos.c < 0 || pos.r < 0 || pos.c + s.w > b.cols || pos.r + s.h > b.rows) return '基板の外にはみ出します';
    const occ = new Set();
    st.prj.comps.forEach((k, i) => { if (i === ci) return; const q = shapeOf(k); q.cells.forEach(([dc, dr]) => occ.add((k.pos.r + dr) * b.cols + k.pos.c + dc)); });
    const ko = new Set(b.keepout || []);
    for (const [dc, dr] of s.cells) { const i = (pos.r + dr) * b.cols + pos.c + dc; if (occ.has(i)) return '他の部品と重なります'; if (ko.has(i)) return '四隅の取付穴の場所です'; }
    return null;
  }

  function snapshot() {
    const r = B();
    return { pos: r.prj.comps.map(c => Object.assign({}, c.pos)), result: r.result, strip: r.strip, problems: r.problems, beauty: r.beauty, note: r.note, noteLv: r.noteLv, sel: E.sel };
  }
  function restore(sn) {
    const r = B();
    r.prj.comps.forEach((c, i) => { c.pos = Object.assign({}, sn.pos[i]); });
    Object.assign(r, { result: sn.result, strip: sn.strip, problems: sn.problems, beauty: sn.beauty, note: sn.note, noteLv: sn.noteLv });
    E.sel = sn.sel;
  }
  function refresh() { S().hiNet = null; A.panels(); A.rp(); bar(); }

  /* 部品の位置を変えて配線を引き直す */
  function apply(ci, pos, what) {
    const r = B(), comp = r.prj.comps[ci];
    E.undo.push(snapshot()); E.redo = [];
    if (E.undo.length > 60) E.undo.shift();
    comp.pos = { c: pos.c, r: pos.r, rot: pos.rot };
    const t0 = performance.now();
    let msg;
    if (r.board.type === 'strip') {
      r.strip = CB.stripConvert(r.prj, r.board);
      r.result = Object.assign({}, r.result, { metrics: Object.assign({}, r.result.metrics, { forced: r.strip.jumpers.length }) });
      r.problems = CB.verify(r.prj, r.board, r.result, r.strip);
      msg = 'パターンカットとジャンパを計算し直しました';
    } else {
      const opt = Object.assign({}, r.ropt || {}, { maxPass: 6 });
      if (S().cfg.beauty === false && !r.ropt) Object.assign(opt, { chain: false, railsFirst: false, diagExtra: 0 });
      const res = CB.rerouteAfterEdit(r.prj, r.board, r.result, opt, new Set([ci]));
      r.result = res;
      r.problems = CB.verify(r.prj, r.board, res, null);
      msg = res.stats.rerouted === 'all' ? '配線をすべて引き直しました' : `関係する ${res.stats.rerouted} ネットの配線を引き直しました`;
    }
    if (S().cfg.beauty !== false && !r.prj.groups) CB.functionalGroups(r.prj);
    r.beauty = CB.beautyMetrics(r.prj, r.board, r.result);
    const un = r.result.metrics.unrouted || 0;
    r.edited = true;
    r.note = `手動で調整しました (${comp.ref} を${what})。${msg}` + (un ? `。${un} ネットが未配線です — 部品を少し離してください` : '') + ` (${Math.round(performance.now() - t0)} ms)`;
    r.noteLv = un ? 'warn' : 'ok';
    refresh();
    if (un) toast(`${un} ネットを配線しきれませんでした。部品を少し離すか「元に戻す」を押してください`, 'err');
  }

  function rotate(ci) {
    sync(); const r = B(); if (!r || ci < 0) return;
    const c = r.prj.comps[ci], s0 = shapeOf(c), rot = (c.pos.rot + 90) % 360, s1 = c.rots[rotI(rot)];
    const cx = c.pos.c + (s0.w - 1) / 2, cy = c.pos.r + (s0.h - 1) / 2;
    const base = { c: Math.round(cx - (s1.w - 1) / 2), r: Math.round(cy - (s1.h - 1) / 2), rot };
    // その場で回せなければ近くの空いている場所を探す
    const cand = [];
    for (let dr = -4; dr <= 4; dr++) for (let dc = -4; dc <= 4; dc++) cand.push([Math.abs(dc) + Math.abs(dr), dc, dr]);
    cand.sort((a, b) => a[0] - b[0]);
    for (const [, dc, dr] of cand) {
      const p = { c: base.c + dc, r: base.r + dr, rot };
      if (!check(ci, p)) { apply(ci, p, '回転'); return; }
    }
    toast('回転できる空きがありません。周りの部品を先に動かしてください', 'err');
  }
  function undo() { sync(); if (!E.undo.length) return false; E.redo.push(snapshot()); restore(E.undo.pop()); refresh(); return true; }
  function redo() { sync(); if (!E.redo.length) return false; E.undo.push(snapshot()); restore(E.redo.pop()); refresh(); return true; }

  /* ================= ポインタ操作 (base の操作ハンドラから呼ばれる) ================= */
  H.boardDown = (wx, wy) => {
    sync(); if (!B()) return false;
    const [c, r] = hole(wx, wy), ci = compAt(c, r);
    if (ci < 0) { if (E.sel >= 0) { E.sel = -1; bar(); A.rp(); } return false; }
    E.sel = ci;
    E.drag = { ci, c0: c, r0: r, pos0: Object.assign({}, B().prj.comps[ci].pos), ghost: null, err: null };
    bar(); A.rp();
    return true;
  };
  H.boardMove = (wx, wy, moved) => {
    const d = E.drag; if (!d) return false;
    if (!moved) return true;
    const [c, r] = hole(wx, wy);
    const g = { c: d.pos0.c + c - d.c0, r: d.pos0.r + r - d.r0, rot: d.pos0.rot };
    if (!d.ghost || d.ghost.c !== g.c || d.ghost.r !== g.r) { d.ghost = g; d.err = check(d.ci, g); A.rp(); }
    return true;
  };
  H.boardUp = () => {
    const d = E.drag; if (!d) return; E.drag = null;
    if (d.ghost && (d.ghost.c !== d.pos0.c || d.ghost.r !== d.pos0.r)) {
      if (d.err) toast('そこには置けません: ' + d.err, 'err');
      else apply(d.ci, d.ghost, '移動');
    }
    A.rp();
  };
  H.boardCancel = () => { E.drag = null; };

  /* ================= 描画 (選択枠・移動中の影・ラッツネスト) ================= */
  H.boardOverlay = pen => {
    sync(); const st = B(); if (!st) return;
    const b = st.board, mirror = S().boardView === 'bottom', X = c => mirror ? b.cols - 1 - c : c;
    const TH = window.CADRender.TH;
    const box = (comp, pos, o) => {
      const s = shapeOf(comp, pos), x0 = Math.min(X(pos.c), X(pos.c + s.w - 1)) - .5, y0 = pos.r - .5;
      pen.rect(x0 - .08, y0 - .08, s.w + .16, s.h + .16, o);
    };
    if (E.sel >= 0 && st.prj.comps[E.sel]) {
      const comp = st.prj.comps[E.sel];
      box(comp, comp.pos, { stroke: TH.accent || '#0A7A62', sw: .12, rx: .35 });
      const d = E.drag;
      if (d && d.ghost) {
        const ok = !d.err, col = ok ? (TH.accent || '#0A7A62') : (TH.crit || '#B23A2E');
        box(comp, d.ghost, { fill: col, alpha: .22, rx: .35 });
        box(comp, d.ghost, { stroke: col, sw: .1, rx: .35 });
        const s = shapeOf(comp, d.ghost);
        // 動かした先から、同じネットのいちばん近いパッドへ点線
        s.pads.forEach((p, pi) => {
          const x = d.ghost.c + p.c, y = d.ghost.r + p.r;
          pen.circle(X(x), y, .3, { fill: col, alpha: .9 });
          const net = st.prj.nets.find(n => n.pads.some(q => q.ci === d.ci && q.pi === pi));
          if (!net) return;
          let bx = null, bd = Infinity;
          net.pads.forEach(q => {
            if (q.ci === d.ci) return;
            const k = st.prj.comps[q.ci], sp = shapeOf(k).pads[q.pi], qx = k.pos.c + sp.c, qy = k.pos.r + sp.r, dd = Math.hypot(qx - x, qy - y);
            if (dd < bd) { bd = dd; bx = [qx, qy]; }
          });
          if (bx) pen.line(X(x), y, X(bx[0]), bx[1], { stroke: col, w: .09, dash: [.25, .2], alpha: .9 });
        });
        if (d.err) pen.text(X(d.ghost.c), d.ghost.r - .8, d.err, { size: .5, fill: col, weight: 700, anchor: 'start', halo: TH.board, haloW: .14 });
      }
    }
  };

  /* ================= 操作バー ================= */
  const bar0 = el('div', 'actbar'); bar0.id = 'boardEdit'; bar0.hidden = true;
  $('stage').appendChild(bar0);
  function bar() {
    const st = S(), r = st.board;
    const show = st.tab === 'pcb' && r && (E.sel >= 0 || E.undo.length || E.redo.length);
    bar0.hidden = !show; if (!show) return;
    bar0.innerHTML = '';
    const comp = E.sel >= 0 ? r.prj.comps[E.sel] : null;
    bar0.appendChild(el('b', null, comp ? comp.ref + (comp.val ? ' ' + comp.val : '') : '手動調整'));
    const btn = (label, title, fn, dis) => { const x = el('button', 'btn', label); x.type = 'button'; x.title = title; x.disabled = !!dis; x.onclick = fn; bar0.appendChild(x); return x; };
    if (comp) btn('↻ 回転', '90° 回転して配線を引き直す (R)', () => rotate(E.sel));
    btn('元に戻す', '直前の移動・回転を取り消す (Ctrl+Z)', () => undo(), !E.undo.length);
    btn('やり直し', '取り消した操作をやり直す (Ctrl+Y)', () => redo(), !E.redo.length);
    if (comp) btn('×', '選択を解除 (Esc)', () => { E.sel = -1; bar(); A.rp(); });
  }
  const prevTab = H.onTab;
  H.onTab = t => { if (prevTab) prevTab(t); sync(); bar(); };

  /* ================= キーボード ================= */
  const prevKey = H.keyCapture;
  H.keyCapture = e => {
    if (prevKey && prevKey(e)) return true;
    const st = S(); if (st.tab !== 'pcb' || !st.board) return false;
    sync();
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (mod && k === 'z' && (e.shiftKey ? E.redo.length : E.undo.length)) { e.preventDefault(); e.shiftKey ? redo() : undo(); return true; }
    if (mod && k === 'y' && E.redo.length) { e.preventDefault(); redo(); return true; }
    if (!mod && k === 'r' && E.sel >= 0) { e.preventDefault(); rotate(E.sel); return true; }
    if (k === 'escape' && E.sel >= 0) { E.sel = -1; bar(); A.rp(); return true; }
    if ((k === 'delete' || k === 'backspace') && E.sel >= 0) { toast('部品の追加・削除は回路図で行ってください (ここでは移動・回転だけできます)', 'err'); return true; }
    return false;
  };

  /* Android の戻るボタン: 部品の選択を先に外す */
  const back0 = window.UBAndroidBack;
  window.UBAndroidBack = () => { if (S().tab === 'pcb' && E.sel >= 0) { E.sel = -1; bar(); A.rp(); return true; } return back0 ? back0() : false; };

  window.UBPerfEdit = { rotate, undo, redo, move: (ci, pos) => { sync(); const err = check(ci, pos); if (err) return err; apply(ci, pos, '移動'); return null; }, state: E, check };
})();
