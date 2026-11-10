/* =====================================================================
   UniBoard CAD — アプリケーション
   ===================================================================== */
(function () {
  'use strict';
  const C1 = window.CADCore, CB = window.CADBoard, CD = window.CADDoc, RD = window.CADRender;
  const GS = C1.GS;
  const $ = id => document.getElementById(id);
  const el = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };

  /* ================= 状態 ================= */
  const S = {
    doc: CD.newDoc(),
    tab: 'sch',
    tool: 'sel',
    selection: new Set(),
    place: null,          // 配置中の型
    placeRot: 0,
    wireStart: null, wireHV: true,
    marquee: null,
    drag: null, hdrag: null,
    customs: [],
    vSch: { x: 60, y: 40, z: 1 },
    vPcb: { x: 60, y: 60, z: 26 },
    undo: [], redo: [],
    nets: [], netOfWire: new Map(), hiNet: null,
    board: null,          // 変換結果 {prj,board,result,strip,problems}
    boardView: 'top',
    cfg: { type: 'perf', auto: true, cols: 25, rows: 18, stripDir: 'row', policy: 'auto', quality: 1, forced: true, seed: 20260918, corner: 0, spacing: 1, beauty: true, blocks: true },
    cfgLoaded: false,
    cursor: [0, 0], hoverHole: null, openPins: new Set(), multi: false,
    palOpen: window.innerWidth > 640, inspOpen: window.innerWidth > 1100,
    ipane: 'prop', busy: false, dirty: true
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem('ubcad.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('ubcad.' + k, JSON.stringify(v)); } catch (e) { } }
  };

  /* ================= キャンバス ================= */
  const cv = $('cv'), ctx = cv.getContext('2d');
  let cw = 0, ch = 0;
  function resize() {
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const r = cv.getBoundingClientRect();
    cw = r.width; ch = r.height;
    cv.width = Math.max(1, Math.round(cw * dpr)); cv.height = Math.max(1, Math.round(ch * dpr));
    S.dirty = true;
  }
  const V = () => S.tab === 'sch' ? S.vSch : S.vPcb;
  const toW = (sx, sy) => { const v = V(); return [(sx - v.x) / v.z, (sy - v.y) / v.z]; };
  const snap = v => Math.round(v / GS) * GS;

  function draw() {
    if (!S.dirty) return; S.dirty = false;
    const dpr = Math.min(2.5, window.devicePixelRatio || 1), v = V();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = RD.TH.bg; ctx.fillRect(0, 0, cw, ch);
    ctx.save();
    ctx.translate(v.x, v.y); ctx.scale(v.z, v.z);
    const pen = RD.CanvasPen(ctx);
    if (S.tab === 'sch') {
      const [x0, y0] = toW(0, 0), [x1, y1] = toW(cw, ch);
      RD.drawSchematic(pen, S.doc, {
        grid: v.z > .42, view: { x0, y0, x1, y1 }, selection: S.selection,
        ghost: S.place ? { type: S.place, x: snap(S.cursor[0]), y: snap(S.cursor[1]), rot: S.placeRot, props: {} } : null,
        preview: wirePreview(), marquee: S.marquee, openPins: S.openPins,
        handles: wireHandles(), hscale: 1 / v.z,
        highlightNet: S.hiNet, netOfWire: S.netOfWire, nets: S.nets
      });
      if (window.UBHooks && window.UBHooks.schOverlay) { try { window.UBHooks.schOverlay(pen, ctx, v.z); } catch (e) { console.error(e); } }
    } else if (S.board) {
      RD.drawBoard(pen, S.board, {
        view: S.boardView === 'bottom' ? 'bottom' : S.boardView === 'both' ? 'both' : 'top',
        mirror: S.boardView === 'bottom', highlightNet: S.hiNet, highlightComp: S.hiComp, cursor: S.hoverHole, mono: S.pcbMono,
        blocks: S.cfg.blocks !== false && !S.pcbMono && S.board.beauty && S.board.beauty.blocks.length >= 2 ? S.board.beauty.blocks : null
      });
      if (window.UBHooks && window.UBHooks.boardOverlay) { try { window.UBHooks.boardOverlay(pen, ctx, v.z); } catch (e) { console.error(e); } }
    }
    ctx.restore();
    if (S.tab === 'pcb' && !S.board) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = RD.TH.faint;
      ctx.font = '500 13px "Archivo","Hiragino Sans",sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('「基板に変換」を押すと、回路図からユニバーサル基板パターンを生成します', cw / 2, ch / 2);
    }
  }
  function loop() { draw(); requestAnimationFrame(loop); }
  const rp = () => { S.dirty = true; };

  function fit(pad) {
    pad = pad || 40;
    if (S.tab === 'sch') {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      S.doc.components.forEach(c => { const b = C1.compBBox(c); x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0 - 14); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1 + 14); });
      S.doc.wires.forEach(w => { x0 = Math.min(x0, w.x1, w.x2); y0 = Math.min(y0, w.y1, w.y2); x1 = Math.max(x1, w.x1, w.x2); y1 = Math.max(y1, w.y1, w.y2); });
      if (x0 > x1) { x0 = 0; y0 = 0; x1 = 400; y1 = 300; }
      const z = Math.min((cw - pad * 2) / Math.max(1, x1 - x0), (ch - pad * 2) / Math.max(1, y1 - y0));
      S.vSch.z = Math.max(.1, Math.min(4, z));
      S.vSch.x = cw / 2 - (x0 + x1) / 2 * S.vSch.z;
      S.vSch.y = ch / 2 - (y0 + y1) / 2 * S.vSch.z;
    } else if (S.board) {
      const b = S.board.board, x0 = -2.4, y0 = -2.4, x1 = b.cols + 1.4, y1 = b.rows + 1.4;
      const z = Math.min((cw - pad * 2) / (x1 - x0), (ch - pad * 2) / (y1 - y0));
      S.vPcb.z = Math.max(4, Math.min(90, z));
      S.vPcb.x = cw / 2 - (x0 + x1) / 2 * S.vPcb.z;
      S.vPcb.y = ch / 2 - (y0 + y1) / 2 * S.vPcb.z;
    }
    rp();
  }
  function zoomBy(f, ax, ay) {
    S.userMoved = true;
    const v = V(); ax = ax == null ? cw / 2 : ax; ay = ay == null ? ch / 2 : ay;
    const [wx, wy] = toW(ax, ay);
    const lim = S.tab === 'sch' ? [.08, 8] : [3, 160];
    v.z = Math.max(lim[0], Math.min(lim[1], v.z * f));
    v.x = ax - wx * v.z; v.y = ay - wy * v.z; rp();
  }

  /* ================= Undo ================= */
  function pushUndo() {
    S.undo.push(CD.serialize(S.doc));
    if (S.undo.length > 80) S.undo.shift();
    S.redo.length = 0;
  }
  function restore(txt) {
    const d = CD.deserialize(txt);
    S.doc.components = d.components; S.doc.wires = d.wires;
    S.doc.junctions = d.junctions; S.doc.nextId = d.nextId; S.doc.perfboard = d.perfboard;
    S.selection.clear(); S.nets = null; refreshNets(); rp(); panels();
  }
  function undo() { if (!S.undo.length) return; S.redo.push(CD.serialize(S.doc)); restore(S.undo.pop()); }
  function redoFn() { if (!S.redo.length) return; S.undo.push(CD.serialize(S.doc)); restore(S.redo.pop()); }

  /* ================= ネット ================= */
  function refreshNets() {
    S.nets = C1.extractNets(S.doc);
    S.netOfWire = new Map();
    S.nets.forEach(n => (n.wires || []).forEach(id => S.netOfWire.set(id, n.index)));
    // 未接続ピンの検出（配線・他ピンのいずれにも触れていないピン）
    const ends = new Set();
    S.doc.wires.forEach(w => { ends.add(w.x1 + ',' + w.y1); ends.add(w.x2 + ',' + w.y2); });
    const pinCount = new Map(), pts = [];
    S.doc.components.forEach(c => C1.compPins(c).forEach(p => {
      const k = p.x + ',' + p.y;
      pinCount.set(k, (pinCount.get(k) || 0) + 1);
      pts.push({ k, x: p.x, y: p.y });
    }));
    const onSeg = (px, py, w) => {
      const cr = (px - w.x1) * (w.y2 - w.y1) - (py - w.y1) * (w.x2 - w.x1);
      if (Math.abs(cr) > 1e-6) return false;
      const dt = (px - w.x1) * (w.x2 - w.x1) + (py - w.y1) * (w.y2 - w.y1);
      const l2 = (w.x2 - w.x1) ** 2 + (w.y2 - w.y1) ** 2;
      return l2 > 0 && dt > 1e-6 && dt < l2 - 1e-6;
    };
    S.openPins = new Set();
    pts.forEach(p => {
      if (ends.has(p.k) || pinCount.get(p.k) > 1) return;
      for (const w of S.doc.wires) if (onSeg(p.x, p.y, w)) return;
      S.openPins.add(p.k);
    });
  }

  /* ================= 当たり判定 ================= */
  const COARSE = window.matchMedia && window.matchMedia('(pointer:coarse)').matches;
  const HITPAD = COARSE ? 12 : 5;
  function hitComponent(wx, wy) {
    for (let i = S.doc.components.length - 1; i >= 0; i--) {
      const c = S.doc.components[i], b = C1.compBBox(c);
      const t = HITPAD / V().z;
      if (wx >= b.x0 - t && wx <= b.x1 + t && wy >= b.y0 - t && wy <= b.y1 + t) return c;
    }
    return null;
  }
  function hitWire(wx, wy) {
    const tol = HITPAD / V().z + 2;
    for (let i = S.doc.wires.length - 1; i >= 0; i--) {
      const w = S.doc.wires[i];
      const dx = w.x2 - w.x1, dy = w.y2 - w.y1, l2 = dx * dx + dy * dy;
      let t = l2 ? ((wx - w.x1) * dx + (wy - w.y1) * dy) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      const px = w.x1 + t * dx, py = w.y1 + t * dy;
      if (Math.hypot(wx - px, wy - py) <= tol) return w;
    }
    return null;
  }
  function wirePreview() {
    if (S.tool !== 'wire' || !S.wireStart) return null;
    const a = S.wireStart, x = snap(S.cursor[0]), y = snap(S.cursor[1]);
    const mid = S.wireHV ? [x, a.y] : [a.x, y];
    const out = [];
    if (mid[0] !== a.x || mid[1] !== a.y) out.push([a.x, a.y, mid[0], mid[1]]);
    if (x !== mid[0] || y !== mid[1]) out.push([mid[0], mid[1], x, y]);
    return out;
  }

  /* ================= 配線の頂点ハンドル ================= */
  function wireHandles() {
    if (S.tool !== 'sel' || S.place || S.selection.size !== 1) return null;
    const w = S.doc.wires.find(x => S.selection.has(x.id));
    if (!w) return null;
    return [
      { x: w.x1, y: w.y1, kind: 'a', w },
      { x: w.x2, y: w.y2, kind: 'b', w },
      { x: (w.x1 + w.x2) / 2, y: (w.y1 + w.y2) / 2, kind: 'm', w }
    ];
  }
  function hitHandle(wx, wy) {
    const hs = wireHandles(); if (!hs) return null;
    const tol = (HITPAD + 5) / V().z;
    for (const h of hs) if (Math.abs(h.x - wx) <= tol && Math.abs(h.y - wy) <= tol) return h;
    return null;
  }
  function startHandleDrag(h, wx, wy) {
    const w = h.w, linked = [];
    if (h.kind === 'm') {
      [[w.x1, w.y1], [w.x2, w.y2]].forEach(([px, py]) => {
        S.doc.wires.forEach(o => {
          if (o === w) return;
          if (o.x1 === px && o.y1 === py) linked.push([o, 1]);
          if (o.x2 === px && o.y2 === py) linked.push([o, 2]);
        });
      });
    } else {
      const ox = h.kind === 'a' ? w.x1 : w.x2, oy = h.kind === 'a' ? w.y1 : w.y2;
      S.doc.wires.forEach(o => {
        if (o === w) return;
        if (o.x1 === ox && o.y1 === oy) linked.push([o, 1]);
        if (o.x2 === ox && o.y2 === oy) linked.push([o, 2]);
      });
    }
    S.hdrag = { h, linked, lx: snap(wx), ly: snap(wy), started: false };
  }
  function moveHandle(wx, wy) {
    const d = S.hdrag, h = d.h, w = h.w;
    const nx = snap(wx), ny = snap(wy);
    let dx = nx - d.lx, dy = ny - d.ly;
    if (!dx && !dy) return;
    if (!d.started) { pushUndo(); d.started = true; }
    if (h.kind === 'm') {
      if (w.y1 === w.y2) dx = 0; else if (w.x1 === w.x2) dy = 0;
      w.x1 += dx; w.y1 += dy; w.x2 += dx; w.y2 += dy;
    } else if (h.kind === 'a') { w.x1 += dx; w.y1 += dy; }
    else { w.x2 += dx; w.y2 += dy; }
    d.linked.forEach(([o, k]) => { if (k === 1) { o.x1 += dx; o.y1 += dy; } else { o.x2 += dx; o.y2 += dy; } });
    d.lx = nx; d.ly = ny;
    pruneJunctions(); refreshNets(); rp();
  }

  /* ================= 操作 (マウス / ペン / タッチ共通) ================= */
  const ptrs = new Map();
  let gesture = null, panning = null, tap = null;
  const stagePt = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  function cancelInteraction() { S.drag = null; S.marquee = null; S.hdrag = null; panning = null; tap = null; rp(); }

  function startGesture() {
    const [a, b] = [...ptrs.values()], v = V();
    return { d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, z0: v.z, x0: v.x, y0: v.y };
  }
  function applyGesture() {
    const [a, b] = [...ptrs.values()];
    const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const lim = S.tab === 'sch' ? [.08, 8] : [3, 160];
    const z = Math.max(lim[0], Math.min(lim[1], gesture.z0 * d / gesture.d0));
    const k = z / gesture.z0, v = V();
    v.z = z; v.x = mx - (gesture.mx - gesture.x0) * k; v.y = my - (gesture.my - gesture.y0) * k;
    S.userMoved = true; rp();
  }

  cv.addEventListener('pointerdown', e => {
    closePop();
    try { cv.setPointerCapture(e.pointerId); } catch (err) { }
    const [sx, sy] = stagePt(e);
    ptrs.set(e.pointerId, { x: sx, y: sy });
    if (ptrs.size === 2) { cancelInteraction(); gesture = startGesture(); return; }
    if (ptrs.size > 2) return;
    const [wx, wy] = toW(sx, sy);
    S.cursor = [wx, wy];
    if (e.button === 1 || e.button === 2 || e.altKey) { panning = { sx, sy, vx: V().x, vy: V().y }; return; }
    const add = e.shiftKey || S.multi;
    tap = { sx, sy, wx, wy, moved: false, add, handled: false, toggle: null };
    panning = { sx, sy, vx: V().x, vy: V().y };
    if (S.tab === 'pcb') { const HK = window.UBHooks; if (S.board && HK && HK.boardDown && HK.boardDown(wx, wy, e)) panning = null; return; }
    if (!S.place && S.tool === 'sel') {
      const hd = hitHandle(wx, wy);
      if (hd) { panning = null; tap = null; startHandleDrag(hd, wx, wy); return; }
      const hit = hitJunction(wx, wy) || hitComponent(wx, wy) || hitWire(wx, wy);
      if (hit) {
        panning = null;
        const already = S.selection.has(hit.id);
        if (add) {
          if (already) tap.toggle = hit.id;
          else { S.selection.add(hit.id); tap.handled = true; }
          S.drag = { x0: wx, y0: wy, moved: false };
          panels(); rp(); return;
        }
        if (S.selection.size === 1 && already && hit.type) tap.edit = hit.id;
        if (!already) { S.selection.clear(); S.selection.add(hit.id); }
        tap.handled = true;
        S.drag = { x0: wx, y0: wy, moved: false };
        panels(); rp(); return;
      }
      if (e.shiftKey) { panning = null; S.marquee = { x0: wx, y0: wy, x1: wx, y1: wy }; }
      return;
    }
    if (!S.place && S.tool === 'marq') { panning = null; S.marquee = { x0: wx, y0: wy, x1: wx, y1: wy }; }
  });
  cv.addEventListener('contextmenu', e => { e.preventDefault(); if (S.wireStart) { S.wireStart = null; actbar(); rp(); } });

  cv.addEventListener('pointermove', e => {
    const [sx, sy] = stagePt(e);
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: sx, y: sy });
    if (gesture && ptrs.size >= 2) { applyGesture(); return; }
    const [wx, wy] = toW(sx, sy);
    S.cursor = [wx, wy];
    if (tap && Math.abs(sx - tap.sx) + Math.abs(sy - tap.sy) > 6) tap.moved = true;
    if (S.hdrag) { moveHandle(wx, wy); return; }
    if (S.drag) {
      const dx = snap(wx - S.drag.x0), dy = snap(wy - S.drag.y0);
      if (dx || dy) {
        if (!S.drag.moved) { pushUndo(); S.drag.moved = true; }
        moveSelection(dx, dy);
        S.drag.x0 += dx; S.drag.y0 += dy;
        refreshNets(); rp();
      }
      return;
    }
    if (S.marquee) { S.marquee.x1 = wx; S.marquee.y1 = wy; rp(); return; }
    if (S.tab === 'pcb' && window.UBHooks && window.UBHooks.boardMove && window.UBHooks.boardMove(wx, wy, !!(tap && tap.moved))) return;
    if (panning && (!tap || tap.moved)) {
      const v = V(); v.x = panning.vx + (sx - panning.sx); v.y = panning.vy + (sy - panning.sy);
      S.userMoved = true; rp(); return;
    }
    if (S.tab === 'pcb') {
      if (S.board) {
        const b = S.board.board;
        let c = Math.round(wx), rr = Math.round(wy);
        if (S.boardView === 'bottom') c = b.cols - 1 - c;
        S.hoverHole = (c >= 0 && rr >= 0 && c < b.cols && rr < b.rows) ? [c, rr] : null;
        status(); rp();
      }
      return;
    }
    if (S.place || S.wireStart) rp();
    status();
  });

  function endPointer(e) {
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) gesture = null;
    if (ptrs.size > 0) { panning = null; tap = null; S.drag = null; S.marquee = null; if (window.UBHooks && window.UBHooks.boardCancel) window.UBHooks.boardCancel(); rp(); return; }
    if (S.marquee) {
      const m = S.marquee, x0 = Math.min(m.x0, m.x1), x1 = Math.max(m.x0, m.x1), y0 = Math.min(m.y0, m.y1), y1 = Math.max(m.y0, m.y1);
      if (Math.abs(x1 - x0) > 3 || Math.abs(y1 - y0) > 3) {
        if (!(tap && tap.add)) S.selection.clear();
        // 一部でも枠に重なっていれば選択（交差選択）
        const hits = (ax0, ay0, ax1, ay1) => !(ax1 < x0 || ax0 > x1 || ay1 < y0 || ay0 > y1);
        S.doc.components.forEach(c => {
          const b = C1.compBBox(c);
          if (hits(b.x0, b.y0, b.x1, b.y1)) S.selection.add(c.id);
        });
        S.doc.wires.forEach(w => {
          if (hits(Math.min(w.x1, w.x2), Math.min(w.y1, w.y2), Math.max(w.x1, w.x2), Math.max(w.y1, w.y2)))
            S.selection.add(w.id);
        });
        S.doc.junctions.forEach(j => { if (hits(j.x, j.y, j.x, j.y)) S.selection.add(j.id); });
      }
      S.marquee = null;
      // 範囲選択したら「選択」モードへ自動で戻す（そのまま移動・回転できる）
      if (S.tool === 'marq' && S.selection.size) setTool('sel');
      panels(); rp();
    }
    if (S.hdrag) { S.hdrag = null; panels(); }
    const wasDrag = S.drag && S.drag.moved;
    const t = tap; S.drag = null; panning = null; tap = null;
    if (wasDrag) { pruneJunctions(); refreshNets(); panels(); }
    if (S.tab === 'pcb' && window.UBHooks && window.UBHooks.boardUp) window.UBHooks.boardUp(t);
    if (t && !t.moved) handleTap(t);
    rp();
  }
  cv.addEventListener('pointerup', endPointer);
  cv.addEventListener('pointercancel', endPointer);

  function handleTap(t) {
    const wx = t.wx, wy = t.wy, add = t.add;
    if (S.tab === 'pcb') { pickBoard(wx, wy); return; }
    if (!S.place && S.tool === 'probe' && window.UBHooks && window.UBHooks.probeTap) { window.UBHooks.probeTap(wx, wy); return; }
    if (S.place) {
      pushUndo();
      CD.addComponent(S.doc, S.place, snap(wx), snap(wy), S.placeRot, S.placeProps || null);
      refreshNets(); panels(); rp(); return;
    }
    if (S.tool === 'wire') {
      const x = snap(wx), y = snap(wy);
      if (!S.wireStart) S.wireStart = { x, y };
      else {
        const pv = wirePreview();
        if (pv && pv.length) { pushUndo(); pv.forEach(p => CD.addWire(S.doc, p[0], p[1], p[2], p[3])); refreshNets(); panels(); }
        S.wireStart = { x, y };
      }
      actbar(); rp(); return;
    }
    if (S.tool === 'junc') {
      const x = snap(wx), y = snap(wy);
      pushUndo();
      const i = S.doc.junctions.findIndex(j => j.x === x && j.y === y);
      if (i >= 0) S.doc.junctions.splice(i, 1);
      else S.doc.junctions.push({ id: 'j' + (S.doc.nextId++), x, y });
      refreshNets(); panels(); rp(); return;
    }
    if (S.tool === 'del') {
      const jd = hitJunction(wx, wy);
      if (jd) { pushUndo(); S.doc.junctions = S.doc.junctions.filter(j => j !== jd); refreshNets(); panels(); rp(); return; }
      const h = hitComponent(wx, wy) || hitWire(wx, wy);
      if (h) { pushUndo(); removeItems([h.id]); }
      return;
    }
    if (t.toggle) {
      S.selection.has(t.toggle) ? S.selection.delete(t.toggle) : S.selection.add(t.toggle);
      panels(); rp(); return;
    }
    if (t.edit) { const c = S.doc.components.find(x => x.id === t.edit); if (c) openValueEditor(c); return; }
    if (t.handled) return;
    const hit = hitJunction(wx, wy) || hitComponent(wx, wy) || hitWire(wx, wy);
    if (hit) { if (!add) S.selection.clear(); S.selection.add(hit.id); }
    else if (!add) S.selection.clear();
    panels(); rp();
  }

  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const r = cv.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey || !e.shiftKey) zoomBy(Math.pow(.998, e.deltaY), e.clientX - r.left, e.clientY - r.top);
    else { const v = V(); v.x -= e.deltaY; S.userMoved = true; rp(); }
  }, { passive: false });

  function moveSelection(dx, dy) {
    S.doc.components.forEach(c => { if (S.selection.has(c.id)) { c.x += dx; c.y += dy; } });
    S.doc.wires.forEach(w => { if (S.selection.has(w.id)) { w.x1 += dx; w.x2 += dx; w.y1 += dy; w.y2 += dy; } });
    S.doc.junctions.forEach(j => { if (S.selection.has(j.id)) { j.x += dx; j.y += dy; } });
  }
  const onWire = (px, py, w) => {
    const cr = (px - w.x1) * (w.y2 - w.y1) - (py - w.y1) * (w.x2 - w.x1);
    if (Math.abs(cr) > 1e-6) return false;
    const dt = (px - w.x1) * (w.x2 - w.x1) + (py - w.y1) * (w.y2 - w.y1);
    const l2 = (w.x2 - w.x1) ** 2 + (w.y2 - w.y1) ** 2;
    return l2 > 0 && dt >= -1e-6 && dt <= l2 + 1e-6;
  };
  // 配線が消えて宙に浮いた接続点を取り除く
  function pruneJunctions() {
    S.doc.junctions = S.doc.junctions.filter(j => {
      let n = 0;
      for (const w of S.doc.wires) if (onWire(j.x, j.y, w)) { n++; if (n >= 2) return true; }
      return false;
    });
  }
  function hitJunction(wx, wy) {
    const tol = (HITPAD + 3) / V().z;
    for (let i = S.doc.junctions.length - 1; i >= 0; i--) {
      const j = S.doc.junctions[i];
      if (Math.abs(j.x - wx) <= tol && Math.abs(j.y - wy) <= tol) return j;
    }
    return null;
  }
  function removeItems(ids) {
    const s = new Set(ids);
    S.doc.components = S.doc.components.filter(c => !s.has(c.id));
    S.doc.wires = S.doc.wires.filter(w => !s.has(w.id));
    S.doc.junctions = S.doc.junctions.filter(j => !s.has(j.id));
    pruneJunctions();
    S.selection.clear(); closePop(); refreshNets(); panels(); rp();
  }
  /** 選択物を90°回転。複数選択のときは選択範囲の中心まわりに“ひとかたまり”で回す */
  function rotateSelection() {
    if (S.place) { S.placeRot = (S.placeRot + 90) % 360; actbar(); rp(); return; }
    if (!S.selection.size) return;
    pushUndo();
    const comps = S.doc.components.filter(c => S.selection.has(c.id));
    const wires = S.doc.wires.filter(w => S.selection.has(w.id));
    const juncs = S.doc.junctions.filter(j => S.selection.has(j.id));
    if (comps.length === 1 && wires.length === 0 && juncs.length === 0) {
      comps[0].rot = ((comps[0].rot || 0) + 90) % 360;
    } else {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      comps.forEach(c => {
        const b = C1.compBBox(c);
        x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0);
        x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1);
      });
      wires.forEach(w => {
        x0 = Math.min(x0, w.x1, w.x2); y0 = Math.min(y0, w.y1, w.y2);
        x1 = Math.max(x1, w.x1, w.x2); y1 = Math.max(y1, w.y1, w.y2);
      });
      juncs.forEach(j => {
        x0 = Math.min(x0, j.x); y0 = Math.min(y0, j.y);
        x1 = Math.max(x1, j.x); y1 = Math.max(y1, j.y);
      });
      if (x0 > x1) return;
      const cx = snap((x0 + x1) / 2), cy = snap((y0 + y1) / 2);
      const rot = (px, py) => [cx - (py - cy), cy + (px - cx)];   // 時計回り90°
      comps.forEach(c => {
        const [nx, ny] = rot(c.x, c.y);
        c.x = snap(nx); c.y = snap(ny); c.rot = ((c.rot || 0) + 90) % 360;
      });
      wires.forEach(w => {
        const a = rot(w.x1, w.y1), b = rot(w.x2, w.y2);
        w.x1 = snap(a[0]); w.y1 = snap(a[1]); w.x2 = snap(b[0]); w.y2 = snap(b[1]);
      });
      S.doc.junctions.forEach(j => {
        const inside = S.selection.has(j.id) || (j.x >= x0 && j.x <= x1 && j.y >= y0 && j.y <= y1);
        if (!inside) return;
        const [nx, ny] = rot(j.x, j.y);
        j.x = snap(nx); j.y = snap(ny);
      });
    }
    pruneJunctions(); refreshNets(); panels(); rp();
  }

  /* ---- 定数 / 型番のプリセット ---- */
  const PRESETS = {
    R: ['10', '47', '100', '220', '330', '470', '1k', '2.2k', '4.7k', '10k', '22k', '47k', '100k', '1M'],
    POT: ['1k', '5k', '10k', '50k', '100k', '500k'],
    C: ['10p', '100p', '470p', '1000p', '0.01u', '0.022u', '0.047u', '0.1u', '0.22u', '1u'],
    CP: ['1u', '4.7u', '10u', '47u', '100u', '220u', '470u', '1000u'],
    L: ['10u', '100u', '470u', '1m', '10m'],
    X: ['32.768kHz', '4MHz', '8MHz', '12MHz', '16MHz', '20MHz'],
    F: ['0.5A', '1A', '2A', '3A', '5A'],
    D: ['1N4148', '1N4007', '1N5819', '1S4'],
    ZD: ['3.3V', '5.1V', '6.2V', '9.1V', '12V', '15V'],
    LED: ['赤', '橙', '黄', '緑', '青', '白', '電球色'],
    BR: ['W04', 'DF10M', 'S1VB60'],
    NPN: ['2SC1815', '2SC945', '2N3904', 'BC547', 'TTC015'],
    PNP: ['2SA1015', '2N3906', 'BC557'],
    NMOS: ['2SK2232', '2N7000', 'IRF540', 'IRLZ44N'],
    PMOS: ['2SJ334', 'IRF9540'],
    REG: ['7805', '7809', '7812', '7905', 'LM317', 'AMS1117-3.3'],
    PC: ['TLP521', 'PC817', '4N35'],
    OPAMP: ['NJM4580', 'LM358', 'TL072', 'NJM072', 'LM324'],
    DIP8: ['NE555', 'LM358', 'PC817', '24C02', 'ATtiny85', 'MCP4131'],
    DIP14: ['74HC00', '74HC04', '74HC14', '74HC86', 'LM324', 'CD4011'],
    DIP16: ['74HC595', '74HC138', 'CD4017', 'ULN2003', 'CD4051'],
    DIP18: ['PIC16F84A', 'PIC16F88'],
    DIP20: ['74HC245', 'ATtiny2313'],
    DIP28: ['ATmega328P', 'PIC16F876', 'ATmega8'],
    SW: ['ON-OFF', 'SPST', '電源SW'],
    SW3: ['SPDT', '切替SW'],
    RLY: ['5V', '9V', '12V', '24V'],
    BUZ: ['3V', '5V', '12V'],
    SPK: ['8Ω', '16Ω', '32Ω'],
    M: ['DC3V', 'DC6V', 'DC12V'],
    LAMP: ['3V', '6V', '12V'],
    BAT: ['1.5V', '3V', '4.5V', '6V', '9V', '12V'],
    DCJ: ['DC5V', 'DC9V', 'DC12V'],
    TB: ['2P'],
    SWP: ['タクト']
  };
  Object.assign(PRESETS, window.UBPresets || {});
  const NET_PRESETS = ['VCC', '+5V', '+3.3V', '+9V', '+12V', 'VDD', 'VEE', '-5V', '-12V', 'GND'];

  let popEl = null;
  function closePop() { if (popEl) { popEl.remove(); popEl = null; } }
  function openValueEditor(c) {
    closePop();
    const sy = C1.symOf(c); if (!sy) return;
    const virtual = !!sy.virtual;
    const p = el('div', 'popover');
    const head = el('div', 'pophead');
    head.appendChild(el('b', null, virtual ? 'ネット名' : (c.ref + ' · ' + sy.name)));
    const x = el('button', 'btn icon', '×'); x.type = 'button'; x.onclick = closePop;
    head.appendChild(x); p.appendChild(head);

    const inp = el('input'); inp.type = 'text'; inp.className = 'popinput';
    inp.value = virtual ? (c.props.net || sy.net || '') : (c.val || '');
    inp.placeholder = virtual ? 'ネット名' : '定数・型番';
    const chips = el('div', 'chips');
    const apply = v => {
      if (virtual) c.props.net = v; else c.val = v;
      chips.querySelectorAll('.chip').forEach(b => b.classList.toggle('on', b.textContent === v));
      refreshNets(); paneProp(); paneNet(); status(); actbar(); rp();
    };
    inp.oninput = () => apply(inp.value);
    p.appendChild(inp);

    const list = virtual ? NET_PRESETS : (PRESETS[c.type] || []);
    list.forEach(v => {
      const b = el('button', 'chip' + (v === inp.value ? ' on' : ''), v); b.type = 'button';
      b.onclick = () => { inp.value = v; apply(v); };
      chips.appendChild(b);
    });
    if (list.length) p.appendChild(chips);

    if (!virtual) {
      const rowlab = el('div', 'poprow');
      rowlab.appendChild(el('span', null, 'リファレンス'));
      const ri = el('input'); ri.type = 'text'; ri.value = c.ref; ri.className = 'popinput small';
      ri.oninput = () => { c.ref = ri.value; refreshNets(); paneProp(); status(); rp(); };
      rowlab.appendChild(ri);
      p.appendChild(rowlab);
    }
    $('stage').appendChild(p); popEl = p;
    if (!COARSE) inp.focus();
  }

  function duplicateSelection() {
    if (!S.selection.size) return;
    pushUndo();
    const d = GS * 2, ns = new Set();
    S.doc.components.filter(c => S.selection.has(c.id)).forEach(c => {
      const n = CD.addComponent(S.doc, c.type, c.x + d, c.y + d, c.rot,
        { val: c.val, props: JSON.parse(JSON.stringify(c.props || {})) });
      if (n) ns.add(n.id);
    });
    S.doc.wires.filter(w => S.selection.has(w.id)).forEach(w => {
      const n = CD.addWire(S.doc, w.x1 + d, w.y1 + d, w.x2 + d, w.y2 + d);
      if (n) ns.add(n.id);
    });
    S.selection = ns; refreshNets(); panels(); rp();
  }

  /* ---- キャンバス上の操作バー (キーボード不要の全機能アクセス) ---- */
  const TOOLNAMES = { marq: '範囲選択', wire: '配線', junc: '接続点', del: '消しゴム', probe: 'プローブ' };
  function actbar() {
    const a = $('actbar'); a.innerHTML = '';
    const lab = t => a.appendChild(el('b', null, t));
    const add = (label, fn, cls) => {
      const b = el('button', 'btn' + (cls ? ' ' + cls : ''), label);
      b.type = 'button'; b.onclick = fn; a.appendChild(b); return b;
    };
    if (S.tab !== 'sch') { a.hidden = true; return; }
    if (S.place) {
      const sy = C1.SYM[S.place];
      lab('配置中: ' + (S.placeLib ? S.placeLib.name : sy ? sy.name : (S.placeProps && S.placeProps.val) || 'カスタム部品'));
      add('回転 ' + S.placeRot + '°', () => { S.placeRot = (S.placeRot + 90) % 360; actbar(); rp(); });
      add('やめる', () => { S.place = null; S.placeLib = null; paletteSync(); actbar(); hint(); rp(); });
      a.hidden = false; return;
    }
    if (S.tool !== 'sel') {
      lab(TOOLNAMES[S.tool] + ' モード');
      if (S.tool === 'wire') {
        add('折れ方向: ' + (S.wireHV ? '横→縦' : '縦→横'), () => { S.wireHV = !S.wireHV; actbar(); rp(); });
        if (S.wireStart) add('ここで区切る', () => { S.wireStart = null; actbar(); rp(); });
      }
      add('完了', () => setTool('sel'), 'primary');
      a.hidden = false; return;
    }
    if (S.selection.size) {
      lab(S.selection.size + ' 個を選択中');
      const one = S.selection.size === 1
        ? S.doc.components.find(c => S.selection.has(c.id)) : null;
      if (one) {
        const sy = C1.symOf(one);
        const cur = sy && sy.virtual ? (one.props.net || sy.net || '') : (one.val || '（未設定）');
        add('値: ' + cur, () => openValueEditor(one));
      }
      add('回転', rotateSelection);
      add('複製', duplicateSelection);
      add('削除', () => { pushUndo(); removeItems([...S.selection]); actbar(); }, 'danger');
      const m = add('追加選択', () => {
        S.multi = !S.multi; m.setAttribute('aria-pressed', String(S.multi)); hint();
      });
      m.setAttribute('aria-pressed', String(S.multi));
      add('解除', () => { S.selection.clear(); S.multi = false; closePop(); panels(); rp(); });
      a.hidden = false; return;
    }
    a.hidden = true;
  }

  function pickBoard(wx, wy) {
    if (!S.board) return;
    const b = S.board.board;
    let c = Math.round(wx), r = Math.round(wy);
    if (S.boardView === 'bottom') c = b.cols - 1 - c;
    if (c < 0 || r < 0 || c >= b.cols || r >= b.rows) { S.hiNet = null; rp(); panels(); return; }
    const idx = r * b.cols + c;
    const pn = S.board.strip ? S.board.strip.padNet : (S.board.result.grid ? S.board.result.grid.padNet : null);
    S.hiNet = pn && pn[idx] >= 0 ? pn[idx] : null;
    S.ipane = 'net'; setIPane(); panels(); rp();
  }

  /* ================= キーボード ================= */
  window.addEventListener('keydown', e => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (window.UBHooks && window.UBHooks.keyCapture && window.UBHooks.keyCapture(e)) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redoFn() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redoFn(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'a') { e.preventDefault(); S.doc.components.forEach(c => S.selection.add(c.id)); S.doc.wires.forEach(w => S.selection.add(w.id)); panels(); rp(); return; }
    if (k === 'escape') { S.place = null; S.placeLib = null; S.wireStart = null; S.selection.clear(); S.marquee = null; paletteSync(); panels(); rp(); return; }
    if (k === ' ' && S.tool === 'wire') { S.wireHV = !S.wireHV; actbar(); e.preventDefault(); rp(); return; }
    if (k === 'r') { rotateSelection(); return; }
    if (k === 'f') { fit(); return; }
    if (k === 'delete' || k === 'backspace') { if (S.selection.size) { pushUndo(); removeItems([...S.selection]); } return; }
    if (S.tab !== 'sch') return;
    if (k === 'v') setTool('sel');
    if (k === 'm') setTool('marq');
    if (k === 'w') setTool('wire');
    if (k === 'j') setTool('junc');
    if (k === 'd') setTool('del');
    if (k === 'p') setTool(S.tool === 'probe' ? 'sel' : 'probe');
    if (k === ' ') { S.wireHV = !S.wireHV; e.preventDefault(); rp(); }
  });

  /* ================= ツール / タブ ================= */
  // 既定は「選択・移動」。下の4つはモード切替ボタン（もう一度押すと選択に戻る）
  const TOOLS = [['marq', 'tMarq'], ['wire', 'tWire'], ['junc', 'tJunc'], ['del', 'tDel'], ['probe', 'tProbe']];
  function setTool(t, keepPlace) {
    S.tool = t; if (!keepPlace) S.place = null;
    S.wireStart = null; closePop(); paletteSync();
    TOOLS.forEach(([k, id]) => $(id).setAttribute('aria-pressed', String(k === t)));
    hint(); actbar(); rp();
  }
  TOOLS.forEach(([t, id]) => $(id).onclick = () => setTool(S.tool === t ? 'sel' : t));
  $('bAll').onclick = () => {
    setTool('sel');
    S.doc.components.forEach(c => S.selection.add(c.id));
    S.doc.wires.forEach(w => S.selection.add(w.id));
    S.doc.junctions.forEach(j => S.selection.add(j.id));
    panels(); rp();
  };
  function setTab(t) {
    S.tab = t;
    if (window.UBHooks && window.UBHooks.onTab) window.UBHooks.onTab(t);
    $('tabSch').setAttribute('aria-selected', String(t === 'sch'));
    $('tabPcb').setAttribute('aria-selected', String(t === 'pcb'));
    $('schTools').hidden = t !== 'sch'; $('pcbTools').hidden = t !== 'pcb';
    $('bMono').hidden = t !== 'pcb'; $('stage').classList.toggle('pcb', t === 'pcb');
    applyPanels(); placeMono();
    hint(); panels(); status(); rp();
    if (t === 'pcb' && S.board) fit();
  }
  $('tabSch').onclick = () => setTab('sch');
  $('tabPcb').onclick = () => setTab('pcb');
  ['vTop', 'vBot', 'vBoth'].forEach((id, i) => $(id).onclick = () => {
    S.boardView = ['top', 'bottom', 'both'][i];
    ['vTop', 'vBot', 'vBoth'].forEach((x, j) => $(x).setAttribute('aria-selected', String(i === j)));
    rp();
  });
  /* 白黒パターン図の切替 — 「部品面 / 半田面 / 両面」のすぐ下に置く */
  S.pcbMono = !!store.get('pcbMono', false);
  function placeMono() {
    const b = $('bMono'); if (b.hidden) return;
    const tr = $('viewTabs').getBoundingClientRect(), sr = $('stage').getBoundingClientRect();
    const left = Math.max(8, Math.min(tr.left - sr.left, sr.width - b.offsetWidth - 8));
    b.style.left = left + 'px';
  }
  function syncMono() { $('bMono').setAttribute('aria-pressed', String(S.pcbMono)); }
  $('bMono').onclick = () => { S.pcbMono = !S.pcbMono; store.set('pcbMono', S.pcbMono); syncMono(); panels(); rp(); };
  syncMono();
  $('zIn').onclick = () => zoomBy(1.25); $('zOut').onclick = () => zoomBy(.8); $('zFit').onclick = () => fit();
  /* 配線を整える: 部品はそのまま、配線だけを引き直す */
  const say = (t, lv) => { if (window.UBToast) window.UBToast(t, lv); else status(t); };
  function setWires(wires) {
    S.doc.wires = wires.map(w => ({ id: 'w' + (S.doc.nextId++), x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 }));
    S.doc.junctions = []; S.selection.clear(); S.board = null;
    refreshNets(); panels(); rp();
  }
  function tidyWires() {
    const r = window.CADTidy.rewire(S.doc);
    if (r.error) { say(r.error, 'warn'); return false; }
    pushUndo(); setWires(r.wires);
    const d = r.before.bends - r.after.bends;
    say(`配線を整えました（曲がり ${r.before.bends} → ${r.after.bends} か所${d > 0 ? '、' + d + ' か所減' : ''}）。Ctrl+Z で戻せます`, 'ok');
    return true;
  }
  /* 自動レイアウト: 部品を並べ直して配線も引き直す */
  function applyLayout(r) {
    S.doc.components = r.doc.components; S.doc.wires = r.doc.wires; S.doc.junctions = r.doc.junctions; S.doc.nextId = r.doc.nextId;
    S.selection.clear(); S.board = null;
    refreshNets(); fit(); panels(); rp();
  }
  function autoLayout() {
    const r = window.CADTidy.layout(S.doc);
    if (r.error) { say(r.error, 'warn'); return false; }
    pushUndo(); applyLayout(r);
    say(`部品を並べ直しました（配線の長さ ${Math.round(r.before.len / 10)} → ${Math.round(r.after.len / 10)} マス、曲がり ${r.before.bends} → ${r.after.bends} か所）。Ctrl+Z で戻せます`, 'ok');
    return true;
  }
  $('bTidy').onclick = tidyWires;
  $('bLayout').onclick = autoLayout;
  $('bUndo').onclick = undo; $('bRedo').onclick = redoFn;
  const palOverlay = () => window.innerWidth <= 640;
  const inspOverlay = () => window.innerWidth <= 1100;
  function applyPanels() {
    const palShown = S.tab === 'sch' && S.palOpen;
    $('palette').hidden = !palShown;
    $('inspector').hidden = !S.inspOpen;
    $('bPal2').setAttribute('aria-pressed', String(palShown));
    $('bInsp').setAttribute('aria-pressed', String(S.inspOpen));
    // 重ねて開いているときは背面を暗くし、外側タップで閉じられるようにする
    $('scrim').hidden = !((palOverlay() && palShown) || (inspOverlay() && S.inspOpen));
  }
  $('bPal2').onclick = () => { S.palOpen = !S.palOpen; applyPanels(); };
  $('bInsp').onclick = () => { S.inspOpen = !S.inspOpen; applyPanels(); };
  $('palClose').onclick = () => { S.palOpen = false; applyPanels(); };
  $('inspClose').onclick = () => { S.inspOpen = false; applyPanels(); };
  $('scrim').onclick = () => {
    if (palOverlay()) S.palOpen = false;
    if (inspOverlay()) S.inspOpen = false;
    applyPanels();
  };

  /* テーマ */
  let theme = store.get('theme', 'system');
  const THEMENAME = { system: '自動', light: 'ライト', dark: 'ダーク' };
  if (!THEMENAME[theme]) theme = 'system';
  function themeTitle() { $('bTheme').title = '表示テーマ: ' + THEMENAME[theme] + '（クリックで切替）'; }
  function applyTheme() {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    RD.readTheme(); paletteBuild(); rp();
  }
  $('bTheme').onclick = () => {
    theme = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
    store.set('theme', theme); applyTheme(); themeTitle();
    panels();
  };
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(() => { if (theme === 'system') applyTheme(); });
  }

  /* ================= 部品パレット ================= */
  const CATS = [['source', '信号源 (シミュレーション)'], ['passive', '受動部品'], ['semi', '半導体'], ['ic', 'IC'], ['logic', '論理ゲート'], ['mech', 'スイッチ・機構'], ['conn', 'コネクタ・電源'], ['power', '電源記号']];
  function paletteBuild() {
    const p = $('paletteBody'); p.innerHTML = '';
    for (const [cat, label] of CATS) {
      const items = Object.values(C1.SYM).filter(s => (s.cat === cat || (cat === 'conn' && s.cat === 'conn')) && !(window.UBPaletteHide && window.UBPaletteHide(s)));
      if (!items.length) continue;
      const g = el('div', 'pgroup'); const h4 = el('h4', null, label); g.appendChild(h4);
      if (window.UBPaletteFold) window.UBPaletteFold(g, h4, cat);
      const grid = el('div', 'pgrid');
      for (const s of items) {
        const b = el('button', 'pitem'); b.type = 'button'; b.dataset.type = s.id;
        b.title = s.name; b.setAttribute('aria-pressed', 'false');
        const c = document.createElement('canvas'); c.width = 88; c.height = 52;
        drawThumb(c, s); b.appendChild(c);
        b.appendChild(el('em', null, s.name));
        b.onclick = () => {
          const next = S.place === s.id && !S.placeLib ? null : s.id;
          S.placeProps = null; S.placeLib = null;
          setTool('sel', true);
          S.place = next; paletteSync(); hint(); rp();
        };
        grid.appendChild(b);
      }
      g.appendChild(grid); p.appendChild(g);
    }
    // カスタム部品（＋で新規作成、作ったものは以後ここに並ぶ）
    const g = el('div', 'pgroup'); g.appendChild(el('h4', null, 'カスタム部品'));
    const grid = el('div', 'pgrid');
    S.customs.forEach((d, i) => {
      const b = el('button', 'pitem'); b.type = 'button'; b.title = d.label;
      b.dataset.type = 'CUSTOM#' + i;
      const cvs = document.createElement('canvas');
      drawThumb(cvs, C1.customSym({ props: { custom: d } })); b.appendChild(cvs);
      b.appendChild(el('em', null, d.label));
      b.onclick = () => {
        const next = S.place === 'CUSTOM' && S.placeIdx === i ? null : 'CUSTOM';
        setTool('sel', true); S.placeLib = null;
        S.place = next; S.placeIdx = i;
        S.placeProps = next ? { props: { custom: d }, val: d.label } : null;
        paletteSync(); hint(); actbar(); rp();
      };
      const x = el('span', 'del', '×'); x.title = 'この部品を一覧から削除';
      x.onclick = ev => {
        ev.stopPropagation();
        S.customs.splice(i, 1); store.set('customs', S.customs); paletteBuild();
      };
      b.appendChild(x);
      grid.appendChild(b);
    });
    const plus = el('button', 'pitem plus', '＋'); plus.type = 'button';
    plus.title = 'カスタム部品を作る'; plus.onclick = openCustomModal;
    grid.appendChild(plus);
    g.appendChild(grid); p.appendChild(g);
    paletteSync();
  }
  function drawThumb(canvas, s) {
    const g = canvas.getContext('2d'), dpr = 2;
    canvas.width = 88 * dpr / 2 * 2; canvas.height = 52 * dpr / 2 * 2;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, 88, 52);
    const bb = C1.symBBox(s);
    const w = Math.max(20, bb.x1 - bb.x0), h = Math.max(20, bb.y1 - bb.y0);
    const z = Math.min(80 / w, 44 / h, 1.15);
    g.translate(44 - (bb.x0 + bb.x1) / 2 * z, 26 - (bb.y0 + bb.y1) / 2 * z); g.scale(z, z);
    RD.drawSymbol(RD.CanvasPen(g), s, 0, 0, 0, { w: 2 / z, color: RD.TH.ink2, pin: RD.TH.copper });
  }
  function paletteSync() {
    if (window.UBHooks && window.UBHooks.paletteSync) window.UBHooks.paletteSync();
    const key = S.place === 'CUSTOM' ? 'CUSTOM#' + S.placeIdx : S.placeLib ? null : S.place;
    $('palette').querySelectorAll('.pitem').forEach(b => b.setAttribute('aria-pressed', String(!!b.dataset.type && b.dataset.type === key)));
  }

  /* ================= ヒント ================= */
  function hint() {
    const h = $('hint');
    if (S.tab === 'pcb') { h.innerHTML = S.board ? '<b>部品をドラッグ</b>で移動 (配線は自動で引き直し) / 選んで <b>R</b> で回転 / パッドを<b>クリック</b>でネット強調 / 何もない所をドラッグでパン' : ''; return; }
    if (S.place) h.innerHTML = `<b>${S.placeLib ? S.placeLib.name.replace(/[<>&]/g, '') : C1.SYM[S.place] ? C1.SYM[S.place].name : 'カスタム部品'}</b> を配置 — 置きたい場所をタップ。下のバーで回転・終了`;
    else if (S.tool === 'wire') h.innerHTML = '<b>配線</b> — 始点をタップ → 終点をタップ。折れ方向は下のバーで切替';
    else if (S.tool === 'marq') h.innerHTML = '<b>範囲選択</b> — なぞった四角の中の部品・配線をまとめて選択';
    else if (S.tool === 'junc') h.innerHTML = '<b>接続点</b> — 交差部をタップで接続ドットを付け外し';
    else if (S.tool === 'del') h.innerHTML = '<b>消しゴム</b> — 部品や配線をタップで削除';
    else if (S.tool === 'probe') h.innerHTML = '<b>プローブ</b> — 配線をタップで電圧、部品をタップで電流の波形をシミュレーション画面に追加';
    else if (S.selection.size === 1 && S.doc.wires.some(w => S.selection.has(w.id)))
      h.innerHTML = '<b>配線を編集中</b> — 端の■で伸縮、中央の●で平行移動。つながっている配線も一緒に動きます';
    else h.innerHTML = '<b>選択</b> — 部品をタップで選択、もう一度タップで値を変更。ドラッグで移動、何もない所をドラッグで画面移動' +
      (S.multi ? ' / <b>追加選択ON</b>' : '');
  }

  /* ================= ステータスバー ================= */
  function status() {
    const s = $('status'); s.innerHTML = '';
    const add = (label, val, cls) => {
      const d = el('div', 's' + (cls ? ' ' + cls : ''));
      d.appendChild(document.createTextNode(label + ' '));
      const b = el('b', null, val); d.appendChild(b); s.appendChild(d);
    };
    if (S.tab === 'sch') {
      add('部品', String(S.doc.components.filter(c => { const y = C1.symOf(c); return y && !y.virtual; }).length));
      add('配線', String(S.doc.wires.length));
      add('ネット', String((S.nets || []).length));
      add('選択', String(S.selection.size));
      add('X', String(Math.round(S.cursor[0] / GS)));
      add('Y', String(Math.round(S.cursor[1] / GS)));
      add('倍率', Math.round(S.vSch.z * 100) + '%');
    } else if (S.board) {
      const b = S.board.board, m = S.board.result.metrics;
      add('基板', `${b.cols}×${b.rows}穴 (${(b.cols * 2.54).toFixed(0)}×${(b.rows * 2.54).toFixed(0)}mm)`);
      if (b.type === 'strip') {
        add('カット', String(S.board.strip.cuts.length));
        add('ジャンパ', String(S.board.strip.jumpers.length));
      } else {
        add('配線', `${m.routed}/${m.nets} ネット`, m.routed === m.nets ? 'good' : 'bad');
        add('半田面', (m.botLen * 2.54).toFixed(0) + 'mm');
        add('部品面', (m.topLen * 2.54).toFixed(0) + 'mm');
        add('表裏渡し', String(m.vias));
        if (m.forced) add('被覆ジャンパ', String(m.forced));
      }
      add('DRC', S.board.problems.length ? S.board.problems.length + '件' : 'OK', S.board.problems.length ? 'bad' : 'good');
      if (S.hoverHole) add('穴', CB.holeName(S.hoverHole[0], S.hoverHole[1]));
    } else add('状態', '未変換');
  }

  /* ================= インスペクタ ================= */
  const IP = [['prop', 'iProp', 'paneProp'], ['net', 'iNet', 'paneNet'], ['wire', 'iWire', 'paneWire'], ['chk', 'iChk', 'paneChk']];
  IP.forEach(([k, btn, pane]) => $(btn).onclick = () => { S.ipane = k; setIPane(); panels(); });
  function setIPane() {
    IP.forEach(([k, btn, pane]) => { $(btn).setAttribute('aria-selected', String(k === S.ipane)); $(pane).hidden = k !== S.ipane; });
  }

  function field(label, node) { const f = el('div', 'field'); f.appendChild(el('label', null, label)); f.appendChild(node); return f; }
  function input(val, on, type) { const i = el('input'); i.type = type || 'text'; i.value = val; i.oninput = () => on(i.value); return i; }
  function select(opts, val, on) {
    const s = el('select');
    opts.forEach(([v, t]) => { const o = el('option', null, t); o.value = v; s.appendChild(o); });
    s.value = val; s.onchange = () => on(s.value); return s;
  }
  function kv(k, v) { const d = el('div', 'kv'); d.appendChild(el('span', null, k)); d.appendChild(el('span', null, v)); return d; }

  function panels() {
    status(); actbar();
    paneProp(); paneNet(); paneWire(); paneChk();
  }

  function paneProp() {
    const p = $('paneProp'); p.innerHTML = '';
    if (S.tab === 'pcb') {
      p.appendChild(el('h5', 'sec', '基板設定'));
      cfgSummary().forEach(([k, v]) => p.appendChild(kv(k, v)));
      const cb = el('button', 'btn', '設定を変えて変換…'); cb.type = 'button'; cb.style.marginTop = '6px';
      cb.onclick = () => openConvertDialog();
      p.appendChild(cb);

      if (S.board) {
        const m = S.board.result.metrics, b = S.board.board;
        p.appendChild(el('h5', 'sec', '生成結果'));
        if (S.board.note) p.appendChild(msg(S.board.noteLv || 'warn', S.board.noteLv === 'ok' ? 'OK' : '注意', S.board.note));
        p.appendChild(kv('基板寸法', `${(b.cols * 2.54).toFixed(1)} × ${(b.rows * 2.54).toFixed(1)} mm`));
        p.appendChild(kv('穴数', `${b.cols * b.rows}`));
        p.appendChild(kv('部品点数', String(S.board.prj.comps.length)));
        p.appendChild(kv('ネット数', String(S.board.prj.nets.length)));
        if (b.type === 'strip') {
          p.appendChild(kv('パターンカット', String(S.board.strip.cuts.length) + ' 箇所'));
          p.appendChild(kv('ジャンパ線', String(S.board.strip.jumpers.length) + ' 本'));
        } else {
          p.appendChild(kv('配線完了', `${m.routed} / ${m.nets} ネット`));
          p.appendChild(kv('半田面 配線長', (m.botLen * 2.54).toFixed(1) + ' mm'));
          p.appendChild(kv('部品面 ジャンパ長', (m.topLen * 2.54).toFixed(1) + ' mm'));
          p.appendChild(kv('表裏渡し（穴通し）', String(m.vias)));
          p.appendChild(kv('被覆ジャンパ', String(m.forced)));
        }
        const bm = S.board.beauty;
        if (bm && b.type !== 'strip') {
          p.appendChild(el('h5', 'sec', '美しい配線のチェック'));
          const gOk = bm.gndLen <= Math.max(6, bm.totalLen * 0.35), brOk = bm.branches === 0, mixOk = bm.mix === 0;
          const row = (k, v, good) => { const d = kv(k, (good ? '✓ ' : '△ ') + v); d.classList.add(good ? 'bm-ok' : 'bm-warn'); return d; };
          p.appendChild(row('GND 配線長', (bm.gndLen * 2.54).toFixed(1) + ' mm', gOk));
          p.appendChild(row('枝分かれ', bm.branches + ' か所', brOk));
          p.appendChild(row('機能ブロックの混在', bm.mix ? bm.mix + ' 部品' : 'なし', mixOk));
          p.appendChild(kv('配線の曲がり', bm.bends + ' か所'));
          p.appendChild(kv('機能ブロック', bm.blocks.length ? bm.blocks.map((x, i) => '#' + (i + 1) + ' ' + x.refs.join(' ')).join(' / ') : '—'));
          if (bm.blocks.length >= 2) {
            const lb = el('label', 'dk-check'); const ck = el('input'); ck.type = 'checkbox'; ck.checked = S.cfg.blocks !== false;
            ck.onchange = () => { S.cfg.blocks = ck.checked; store.set('cfg', S.cfg); rp(); };
            lb.appendChild(ck); lb.appendChild(el('span', null, '機能ブロックを枠で表示')); p.appendChild(lb);
          }
        }
        p.appendChild(el('h5', 'sec', '凡例'));
        const lg = el('div', 'legend');
        const ln = (casing, core, dash) => `<svg class="lsw" viewBox="0 0 26 8"><line x1="4" y1="4" x2="22" y2="4" stroke="${casing}" stroke-width="${core ? 5.4 : 3.4}" stroke-linecap="round"/>${core ? `<line x1="4" y1="4" x2="22" y2="4" stroke="${core}" stroke-width="2" stroke-linecap="${dash ? 'butt' : 'round'}"${dash ? ' stroke-dasharray="3.5 2.5"' : ''}/>` : ''}</svg>`;
        const mono = !!S.pcbMono;
        lg.innerHTML = `<span>${ln(mono ? '#000' : 'var(--copper)')}半田面のすず線</span>
          <span>${ln(mono ? '#000' : 'var(--jump)', '#fff')}部品面ジャンパ</span>
          <span>${ln(mono ? '#000' : 'var(--warn)', mono ? '#fff' : 'var(--board)', true)}被覆ジャンパ（半田面）</span>` +
          (mono ? '' : `<span><i style="background:var(--net-gnd)"></i>GND</span>
          <span><i style="background:var(--net-vcc)"></i>VCC / ＋電源</span>
          <span><i style="background:var(--net-vee)"></i>VEE / −電源</span>`) +
          `<span><i style="background:${mono ? '#000' : 'var(--crit)'}"></i>パターンカット</span>`;
        p.appendChild(lg);
        p.appendChild(el('p', 'note', mono
          ? '白黒モード: 黒い実線が半田面、白抜きの線が部品面ジャンパ、破線入りが被覆ジャンパです。印刷向け。'
          : '白抜き（中が白や電源色）で青い縁の線が部品面ジャンパです。半田面のすず線は縁のない実線です。'));
      }
      return;
    }
    const comps = S.doc.components.filter(c => S.selection.has(c.id));
    if (comps.length === 1) {
      const c = comps[0], s = C1.symOf(c);
      p.appendChild(el('h5', 'sec', s.name));
      p.appendChild(field('リファレンス', input(c.ref, v => { c.ref = v; refreshNets(); rp(); status(); })));
      const chipRow = (list, get, set) => {
        const box = el('div', 'chips');
        list.forEach(v => {
          const b = el('button', 'chip' + (v === get() ? ' on' : ''), v); b.type = 'button';
          b.onclick = () => { set(v); paneProp(); actbar(); rp(); };
          box.appendChild(b);
        });
        return box;
      };
      if (!s.virtual) {
        p.appendChild(field('定数 / 型番', input(c.val || '', v => { c.val = v; rp(); actbar(); })));
        const list = PRESETS[c.type] || [];
        if (list.length) p.appendChild(chipRow(list, () => c.val, v => { c.val = v; refreshNets(); }));
      } else {
        p.appendChild(field('ネット名', input(c.props.net || s.net, v => { c.props.net = v; refreshNets(); rp(); paneNet(); })));
        p.appendChild(chipRow(NET_PRESETS, () => c.props.net || s.net, v => { c.props.net = v; refreshNets(); paneNet(); }));
      }
      p.appendChild(field('向き', select([['0', '0°'], ['90', '90°'], ['180', '180°'], ['270', '270°']], String(c.rot || 0), v => { pushUndo(); c.rot = +v; refreshNets(); rp(); })));
      if (!s.virtual) {
        p.appendChild(el('h5', 'sec', 'フットプリント'));
        if (c.props.span !== undefined)
          p.appendChild(field('ピン間隔（穴数）', input(c.props.span, v => { c.props.span = Math.max(1, Math.min(20, +v | 0)); }, 'number')));
        if (s.pkgOpts)
          p.appendChild(field('パッケージ', select(s.pkgOpts.map(x => [x, x]), c.props.pkg, v => c.props.pkg = v)));
        p.appendChild(field('取り付け', select([['0', '基板上'], ['1', '基板外（パネル取付・配線でつなぐ）']], c.props.offboard ? '1' : '0',
          v => { if (v === '1') c.props.offboard = true; else delete c.props.offboard; S.board = null; panels(); rp(); })));
        if (s.pinoutOpts)
          p.appendChild(field('ピン配置（1-2-3 番, 平らな面を正面）', select(s.pinoutOpts.map(x => [x, x.split('').join('-')]), c.props.pinout || s.pinoutOpts[0], v => { c.props.pinout = v; S.board = null; panels(); rp(); })));
        if (c.type === 'CP')
          p.appendChild(field('外径（穴数, 1 = 2.54mm）', input(c.props.dia || 2.4, v => { c.props.dia = Math.max(1, Math.min(10, +v || 2.4)); S.board = null; }, 'number')));
        if (c.props.rowGap !== undefined)
          p.appendChild(field('列間隔（穴数）', input(c.props.rowGap, v => { c.props.rowGap = Math.max(2, Math.min(12, +v | 0)); }, 'number')));
        const fp = s.fp ? s.fp(c) : null;
        if (fp) p.appendChild(kv('占有', `${fp.pads.length} パッド`));
      }
      if (window.UBHooks && window.UBHooks.propExtra) { try { window.UBHooks.propExtra(p, c); } catch (e) { console.error(e); } }
      const del = el('button', 'btn', '削除'); del.style.width = '100%'; del.style.marginTop = '8px';
      del.onclick = () => { pushUndo(); removeItems([c.id]); };
      p.appendChild(del);
      return;
    }
    if (S.selection.size > 1) {
      p.appendChild(el('div', 'empty', S.selection.size + ' 個を選択中\n画面下のバーから\n回転・複製・削除できます'));
      return;
    }
    p.appendChild(el('h5', 'sec', '図面'));
    const real = S.doc.components.filter(c => { const y = C1.symOf(c); return y && !y.virtual; });
    p.appendChild(kv('部品点数', String(real.length)));
    p.appendChild(kv('配線セグメント', String(S.doc.wires.length)));
    p.appendChild(kv('ネット数', String((S.nets || []).length)));
    p.appendChild(el('h5', 'sec', '使い方'));
    const n = el('p', 'note');
    n.innerHTML = '「部品」から部品を選び、キャンバスをタップすると置けます。部品をもう一度タップで定数を変更。' +
      '「範囲選択」で囲めば、かすった部品・配線・接続点をまとめて選べます（画面下のバーで回転・複製・削除）。' +
      '仕上がったら上部の「基板」タブ →「基板に変換」でユニバーサル基板のパターン図を自動生成します。';
    p.appendChild(n);
  }

  function paneNet() {
    const p = $('paneNet'); p.innerHTML = '';
    const nets = S.nets || [];
    if (!nets.length) { p.appendChild(el('div', 'empty', 'ネットがありません。\n部品を置いて配線してください。')); return; }
    const box = el('div', 'netlist');
    nets.forEach(n => {
      const d = el('div', 'netrow');
      d.setAttribute('aria-selected', String(S.hiNet === n.index));
      const b = el('b', null, n.name);
      d.appendChild(b);
      if (n.rail) { const c = el('span', 'chip rail', '電源'); d.appendChild(c); }
      d.appendChild(el('i', null, n.pins.map(x => x.ref + '.' + (x.pin.name || x.pin.n)).join('  ') || '（部品未接続）'));
      d.onclick = () => { S.hiNet = S.hiNet === n.index ? null : n.index; paneNet(); rp(); };
      box.appendChild(d);
    });
    p.appendChild(box);
  }

  // 組立手順のチェック (基板を作り直したら消える)
  let asmDone = new Set(), asmFor = null;
  function paneWire() {
    const p = $('paneWire'); p.innerHTML = '';
    if (!S.board) { p.appendChild(el('div', 'empty', 'まだ基板を生成していません。\n「基板」タブで変換してください。')); return; }
    if (asmFor !== S.board) { asmFor = S.board; asmDone = new Set(); }
    const list = CB.wiringList(S.board.prj, S.board.board, S.board.result, S.board.strip);
    const stages = S.board.strip ? [] : CB.assemblySteps(S.board.prj);
    const total = stages.reduce((a, st) => a + st.items.length, 0) + list.length;
    const prog = el('div', 'asm-prog'), progBar = el('i'), progTxt = el('span');
    prog.appendChild(el('div', 'asm-track')).appendChild(progBar); prog.appendChild(progTxt);
    const sync = () => { progBar.style.width = (total ? 100 * asmDone.size / total : 0) + '%'; progTxt.textContent = `${asmDone.size} / ${total} 完了`; };
    if (total) p.appendChild(prog);
    const row = (key, cls, main, sub, note, onHover) => {
      const d = el('label', 'asm-row ' + cls);
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = asmDone.has(key);
      cb.onchange = () => { cb.checked ? asmDone.add(key) : asmDone.delete(key); d.classList.toggle('done', cb.checked); sync(); };
      d.classList.toggle('done', cb.checked);
      d.appendChild(cb);
      const t = el('span', 'asm-t'); t.appendChild(el('b', null, main)); if (sub) t.appendChild(el('span', null, sub));
      if (note) t.appendChild(el('em', null, note));
      d.appendChild(t);
      if (onHover) { d.onmouseenter = () => onHover(true); d.onmouseleave = () => onHover(false); }
      return d;
    };
    let step = 0;
    stages.forEach(st => {
      p.appendChild(el('h5', 'sec asm-h', `手順 ${++step}　${st.title}`));
      p.appendChild(el('p', 'asm-tip', st.tip));
      const box = el('div', 'asm-list');
      st.items.forEach(it => box.appendChild(row('c' + it.ci, 'part', it.ref + (it.val ? '　' + it.val : ''), it.text, it.note,
        on => { S.hiComp = on ? it.ci : null; rp(); })));
      p.appendChild(box);
    });
    if (list.length) {
      p.appendChild(el('h5', 'sec asm-h', stages.length ? `手順 ${++step}　配線 ${list.length} 本` : `作業手順 ${list.length} 項目`));
      if (stages.length) p.appendChild(el('p', 'asm-tip', '基板を裏返し、部品の足を曲げたり、すずメッキ線を足したりして、図のとおりにつなぎます'));
      const box = el('div', 'asm-list');
      const netIdx = name => { const n = S.board.prj.nets.find(x => x.name === name); return n ? n.index : null; };
      list.forEach((w, i) => {
        const m = /^(.*?) \/ (.*?): (.*)$/.exec(w.text);
        box.appendChild(row('w' + i, 'wire ' + w.kind, m ? m[3] : w.text, m ? m[1] + '・' + m[2] : null, null,
          w.net != null ? on => { const k = netIdx(w.net); S.hiNet = on ? k : null; rp(); } : null));
      });
      p.appendChild(box);
    } else if (!stages.length) p.appendChild(el('div', 'empty', '配線指示はありません。'));
    sync();
  }

  function paneChk() {
    const p = $('paneChk'); p.innerHTML = '';
    const msgs = [];
    if (S.nets) C1.erc(S.doc, S.nets).forEach(m => msgs.push(m));
    p.appendChild(el('h5', 'sec', '回路図チェック (ERC)'));
    if (!msgs.length) p.appendChild(msg('ok', 'OK', '未接続ピン・重複リファレンスはありません'));
    else msgs.slice(0, 60).forEach(m => p.appendChild(msg(m.lv, m.lv === 'err' ? 'ERR' : 'WARN', m.t)));
    p.appendChild(el('h5', 'sec', '基板チェック (DRC)'));
    if (!S.board) p.appendChild(el('div', 'empty', '基板未生成'));
    else if (!S.board.problems.length) {
      p.appendChild(msg('ok', 'OK', '全ネットの導通を確認、短絡なし'));
      const m = S.board.result.metrics;
      if (S.board.board.type !== 'strip' && m.forced)
        p.appendChild(msg('warn', 'NOTE', `${m.forced} 本は被覆ジャンパで接続しています（すずメッキ線では届かない経路）`));
    } else S.board.problems.forEach(x => p.appendChild(msg('err', 'DRC', `${x.net}: ${x.t}`)));
  }
  function msg(lv, tag, t) {
    const d = el('div', 'msg ' + (lv === 'err' ? 'err' : lv === 'ok' ? 'ok' : 'warn'));
    d.appendChild(el('b', null, tag)); d.appendChild(el('span', null, t)); return d;
  }

  /* ================= 基板変換 ================= */
  window.UniBoard = {
    get state() { return S; }, convert: (reseed, silent) => convert(reseed, silent),
    api: { el, rp, refreshNets, panels, setTab, pushUndo, fit, toW, hitWire, hitComponent, openModal, setTool, paletteBuild, paletteSync,
      status, hint, resize, saveFile, tidyWires, setWires, autoLayout, applyLayout, say, closePop, actbar, applyPanels, withLight, zoomBy, loadJSONText, undo, redo: redoFn, removeItems, rotateSelection, duplicateSelection }
  };
  function convert(reseed, silent) {
    if (S.busy) return;
    refreshNets();
    const prjNets = S.nets;
    const doc = S.doc;
    const real = doc.components.filter(c => { const s = C1.symOf(c); return s && !s.virtual; });
    if (!real.length) { if (!silent) alert('回路図に部品がありません。先に部品を配置してください。'); return; }
    if (reseed) S.cfg.seed = (S.cfg.seed * 1103515245 + 12345) >>> 0;
    S.busy = true; $('progWrap').hidden = !!silent;
    $('progTitle').textContent = '自動配置を計算中';
    $('progText').textContent = '焼きなまし法で部品位置を最適化しています';
    $('progFill').style.width = '0%';

    const noForced = S.cfg.type !== 'strip' && S.cfg.forced === false;
    const beauty = S.cfg.beauty !== false;
    const easy = S.cfg.easy !== false && S.cfg.type !== 'strip';   // 組みやすさ優先 (縦横だけの配線・向きをそろえる)
    // 美しい配線: 配置の乱数を変えて何通りか作り、いちばん美しいものを採用する
    const maxTry = Math.max(noForced ? [5, 8, 12][S.cfg.quality] || 8 : 1, beauty ? [3, 6, 10][S.cfg.quality] || 6 : 1);
    const chunk = [14000, 26000, 40000][S.cfg.quality] || 26000;
    let bestRun = null, k = 0;

    function makeBoard(prj) {
      let board = S.cfg.auto ? CB.autoBoardSize(prj, S.cfg.type) : { cols: S.cfg.cols, rows: S.cfg.rows };
      board = { cols: board.cols, rows: board.rows, type: S.cfg.type, stripDir: S.cfg.stripDir };
      // 手動サイズが小さすぎる場合は自動拡張
      let area = 0; prj.comps.forEach(c => area += c.rots[0].w * c.rots[0].h);
      while (board.cols * board.rows < area * 1.9 && board.cols < 100) { board.cols++; board.rows = Math.max(board.rows, Math.ceil(area * 2.1 / board.cols)); }
      if (!S.cfg.auto && S.cfg.type !== 'strip' && (S.cfg.corner | 0) > 0) { board.keepout = CB.cornerKeepout(board.cols, board.rows, S.cfg.corner | 0); board.corner = S.cfg.corner | 0; }
      return board;
    }
    // 被覆ジャンパなしモードでは、配線しきれなければ配置の乱数と余白を変えてやり直す
    function attempt() {
      const seed = k === 0 ? S.cfg.seed : ((S.cfg.seed + k * 2654435761) >>> 0);
      const margin = 2 + (S.cfg.auto ? Math.floor(k / 2) : 0);
      const prj = CB.buildProject(doc, prjNets);
      const board = makeBoard(prj);
      const placer = CB.makePlacer(prj, board, { seed, beauty, easy, strip: S.cfg.type === 'strip', crowdW: S.cfg.type === 'strip' ? 0 : SPACING_W[S.cfg.spacing == null ? 1 : S.cfg.spacing] });
      $('progTitle').textContent = '自動配置を計算中';
      $('progText').textContent = k === 0 ? '焼きなまし法で部品位置を最適化しています'
        : beauty ? `GND が短く、機能ごとにまとまり、枝分かれの少ない配置を探しています（${k + 1} / ${maxTry} 通り目）`
        : `被覆ジャンパを使わずに配線できる配置を探しています（${k + 1} / ${maxTry} 回目）`;
      function stepPlace() {
        const t0 = performance.now();
        let done = false;
        while (performance.now() - t0 < 13 && !done) done = placer.run(chunk);
        $('progFill').style.width = (100 * (k + placer.done / placer.total) / maxTry).toFixed(1) + '%';
        if (!done) { requestAnimationFrame(stepPlace); return; }
        if (S.cfg.auto) CB.compactBoard(prj, board, margin);
        $('progTitle').textContent = S.cfg.type === 'strip' ? 'パターンカットを算出中' : '自動配線を計算中';
        requestAnimationFrame(() => route(prj, board, seed));
      }
      requestAnimationFrame(stepPlace);
    }
    function route(prj, board, seed) {
      let result, strip = null, problems, ropt = null;
      if (board.type === 'strip') {
        strip = CB.stripConvert(prj, board);
        result = { routes: new Map(), stats: {}, grid: null, metrics: { totalLen: 0, vias: 0, forced: strip.jumpers.length, topLen: 0, botLen: 0, nets: prj.nets.length, routed: prj.nets.length, unrouted: 0 } };
        problems = CB.verify(prj, board, result, strip);
      } else {
        ropt = {
          topExtra: S.cfg.policy === 'jumper' ? -2 : S.cfg.policy === 'solder' ? 15 : 5,
          viaCost: S.cfg.policy === 'jumper' ? 30 : 55,
          maxPass: 5 + S.cfg.quality * 3 + (noForced ? 3 : 0), seed, noForced,
          reduceTop: [300, 1000, 3000][S.cfg.quality] || 1000,
          chain: beauty, railsFirst: beauty, diagExtra: beauty ? 6 : 0,
          diagonal: !easy, bend: easy ? 12 : 7, nearPad: easy ? 4 : 0
        };
        result = CB.routeAll(prj, board, ropt);
        problems = CB.verify(prj, board, result, null);
      }
      const run = { prj, board, result, strip, problems, nets: prjNets, seed, ropt: board.type === 'strip' ? null : ropt };
      run.topRuns = topRunsOf(result);
      run.beauty = CB.beautyMetrics(prj, board, result);
      const score = r => (r.result.metrics.unrouted || 0) * 1e6 + r.board.cols * r.board.rows * 10 + (r.topRuns || 0) * 400 + r.result.metrics.totalLen
        + (beauty ? (r.result.metrics.forced || 0) * 3000 + r.beauty.branches * 250 + r.beauty.gndLen * 10 + r.beauty.mix * 600 + r.beauty.bends * 15 + r.result.metrics.totalLen * 1.5 : 0);
      if (!bestRun || score(run) < score(bestRun)) bestRun = run;
      k++;
      // 被覆ジャンパなし: 配線しきれない間は配置を変えて探し続ける (配線できたらその配置番号で確定 = 同じ番号なら同じ結果)
      if (k < maxTry && (beauty || (noForced && (result.metrics.unrouted || 0) > 0))) { attempt(); return; }
      finish(bestRun);
    }
    function topRunsOf(res) {
      let n = 0; if (!res || !res.routes) return 0;
      res.routes.forEach(rec => { let prev = null; rec.segs.forEach(s => { if (s.l === 1 && !(prev && prev.l === 1 && prev.c2 === s.c1 && prev.r2 === s.r1)) n++; prev = s; }); });
      return n;
    }
    function finish(r) {
      const un = r.result.metrics.unrouted || 0;
      if (noForced || beauty) S.cfg.seed = r.seed;   // 再試行はこの配置から続けて探す
      r.note = noForced && un > 0
        ? `被覆ジャンパなしでは ${un} ネットを配線しきれませんでした（${maxTry} 通りの配置を試行）。基板サイズを大きくする・「入念」にする・「再試行」を押す、のいずれかをお試しください。`
        : (noForced ? `被覆ジャンパなしで配線できました（${k} 通り試行、部品面ジャンパ ${r.topRuns || 0} 本、配置番号 ${r.seed}）。` : null);
      r.noteLv = un > 0 ? 'warn' : 'ok';
      S.board = r;
      S.busy = false; $('progWrap').hidden = true;
      S.hiNet = null;
      if (silent) { panels(); hint(); rp(); return; }
      if (S.tab !== 'pcb') setTab('pcb');
      fit(); panels(); hint(); rp();
    }
    attempt();
  }
  /* ---- 変換設定ポップアップ ---- */
  const SPACING_W = [1, 2.5, 4];   // 部品の間隔 (配置の混み具合の重み)
  const CFG_OPTS = {
    type: [['perf', '蛇の目基板', '穴ごとに独立したランド'], ['strip', 'ストリップボード', '銅箔が帯状につながった基板']],
    stripDir: [['row', '横方向', '行ごとに銅箔がつながる'], ['col', '縦方向', '列ごとに銅箔がつながる']],
    policy: [['auto', '自動（推奨）', 'バランスよく配線'], ['solder', 'すず線を優先', '半田面の配線を多めに'], ['jumper', 'ジャンパを優先', '部品面の渡り線を多めに']],
    auto: [['1', '自動', '部品量から算出'], ['0', '手動', '列×行を指定']],
    forced: [['1', '使ってよい', '配線しきれない所は絶縁線でつなぐ'], ['0', '使わない', '配置を変えて探し直す']],
    easy: [['1', '組みやすさ優先（推奨）', '縦横だけの配線・部品の向きをそろえる'], ['0', '小ささ優先', '斜めの配線も使って詰める']],
    beauty: [['1', '厳守（推奨）', 'GND 最短・機能ごとにまとめる・枝分かれ最小'], ['0', 'しない', '配線長だけで配置する']],
    quality: [['0', '速い', '数秒で完了'], ['1', '標準', 'おすすめ'], ['2', '入念', '時間をかけて最適化']],
    spacing: [['0', '詰める', '小さくまとめる'], ['1', '標準', 'おすすめ'], ['2', '広め', '配線の通り道を多く']],
    corner: [['0', 'なし', '四隅も使う'], ['2', '2×2 穴', '四隅を空ける'], ['3', '3×3 穴', 'M3 ねじ穴用に広め']]
  };
  const optLabel = (k, v) => (CFG_OPTS[k].find(o => o[0] === String(v)) || [, ''])[1];
  function cfgSummary() {
    const c = S.cfg, out = [['基板タイプ', optLabel('type', c.type)], ['美しい配線', c.beauty === false ? 'しない' : '厳守']];
    if (c.type === 'strip') out.push(['銅箔の向き', optLabel('stripDir', c.stripDir)]);
    else { out.push(['配線と配置', c.easy === false ? '小ささ優先' : '組みやすさ優先']); out.push(['配線の方針', optLabel('policy', c.policy)]); out.push(['被覆ジャンパ', c.forced === false ? '使わない' : '使ってよい']); }
    out.push(['基板サイズ', c.auto ? '自動' : `${c.cols} × ${c.rows} 穴`]);
    if (!c.auto && c.type !== 'strip' && (c.corner | 0) > 0) out.push(['四隅の取付穴', `${c.corner} × ${c.corner} 穴を空ける`]);
    if (c.type !== 'strip') out.push(['部品の間隔', optLabel('spacing', c.spacing == null ? 1 : c.spacing)]);
    out.push(['最適化の強さ', optLabel('quality', c.quality)]);
    out.push(['配置番号', String(c.seed)]);
    return out;
  }
  function openConvertDialog() {
    const d = Object.assign({}, S.cfg);   // 「変換」を押すまでは本体の設定を変えない
    openModal('基板に変換', body => {
      body.classList.add('cfgform');
      const draw = () => {
        body.innerHTML = '';
        const group = (title, key, get, set) => {
          const g = el('div', 'cfggroup');
          g.appendChild(el('h4', null, title));
          const seg = el('div', 'seg');
          CFG_OPTS[key].forEach(([v, label, sub]) => {
            const b = el('button', 'segbtn'); b.type = 'button';
            b.setAttribute('aria-pressed', String(String(get()) === v));
            b.appendChild(el('b', null, label)); b.appendChild(el('span', null, sub));
            b.onclick = () => { set(v); draw(); };
            seg.appendChild(b);
          });
          g.appendChild(seg); body.appendChild(g); return g;
        };
        group('基板タイプ', 'type', () => d.type, v => d.type = v);
        if (d.type !== 'strip') {
          const eg = group('配線と配置のしかた', 'easy', () => d.easy === false ? '0' : '1', v => d.easy = v === '1');
          if (d.easy !== false) eg.appendChild(el('p', 'cfghint', '配線は穴の並びに沿った縦と横だけ。抵抗などの向きをそろえ、電源コネクタは基板の端に置きます。他の部品の足のすぐ隣を通る配線も減らすので、半田ブリッジしにくくなります。'));
        }
        const bg = group('美しい配線', 'beauty', () => d.beauty === false ? '0' : '1', v => d.beauty = v === '1');
        if (d.beauty !== false) bg.appendChild(el('p', 'cfghint', '① GND・電源の配線をいちばん短く ② 同じ働きの部品 (IC・トランジスタとその周りの部品) を一か所にまとめる ③ 配線は一筆書きで枝分かれを減らす。配置を何通りか作って最も美しいものを選びます。'));
        if (d.type === 'strip') group('銅箔パターンの向き', 'stripDir', () => d.stripDir, v => d.stripDir = v);
        else {
          group('配線の方針', 'policy', () => d.policy, v => d.policy = v);
          const fg = group('被覆ジャンパ（半田面の絶縁線）', 'forced', () => d.forced === false ? '0' : '1', v => d.forced = v === '1');
          if (d.forced === false) fg.appendChild(el('p', 'cfghint', '配線しきれないときは、部品の配置と基板の余白を変えて何度か探し直します。そのぶん時間がかかります。'));
        }
        const sg = group('基板サイズ', 'auto', () => d.auto ? '1' : '0', v => d.auto = v === '1');
        if (!d.auto) {
          const r = el('div', 'sizerow');
          const num = (label, key, lo, hi) => {
            const f = el('label', 'numf'); f.appendChild(el('span', null, label));
            const i = el('input'); i.type = 'number'; i.min = lo; i.max = hi; i.value = d[key];
            i.oninput = () => { const v = +i.value | 0; if (v) d[key] = Math.max(lo, Math.min(hi, v)); mm.textContent = mmText(); };
            f.appendChild(i); return f;
          };
          const mmText = () => `≈ ${(d.cols * 2.54).toFixed(1)} × ${(d.rows * 2.54).toFixed(1)} mm`;
          r.appendChild(num('列（横の穴数）', 'cols', 6, 100)); r.appendChild(el('span', 'x', '×'));
          r.appendChild(num('行（縦の穴数）', 'rows', 5, 80));
          const mm = el('span', 'mm', mmText()); r.appendChild(mm);
          sg.appendChild(r);
          if (d.type !== 'strip') {
            const cg = group('四隅の取付穴（ケースにねじ止めする場合）', 'corner', () => String(d.corner | 0), v => d.corner = +v);
            cg.appendChild(el('p', 'cfghint', '指定した四隅の穴には部品も配線も置きません。基板の穴数は実物に合わせてください。'));
          }
        }
        if (d.type !== 'strip') group('部品の間隔', 'spacing', () => String(d.spacing == null ? 1 : d.spacing), v => d.spacing = +v);
        group('最適化の強さ', 'quality', () => String(d.quality), v => d.quality = +v);
        {
          const g = el('div', 'cfggroup'); g.appendChild(el('h4', null, '配置番号（乱数の種）'));
          const f = el('label', 'numf'); const i = el('input'); i.type = 'number'; i.min = 0; i.value = d.seed;
          i.oninput = () => { const v = Math.floor(+i.value); if (v >= 0) d.seed = v >>> 0; };
          f.appendChild(i); g.appendChild(f);
          g.appendChild(el('p', 'cfghint', '同じ番号・同じ設定なら同じ配置になります。別の配置を試すときは番号を変えてください。'));
          body.appendChild(g);
        }
      };
      draw();
    }, [
      (() => { const b = el('button', 'btn', 'キャンセル'); b.onclick = () => $('modal').hidden = true; return b; })(),
      (() => {
        const b = el('button', 'btn primary big', 'この設定で変換'); b.onclick = () => {
          Object.assign(S.cfg, d); store.set('cfg', S.cfg);
          $('modal').hidden = true; convert(false);
        }; return b;
      })()
    ]);
  }
  $('bConvert').onclick = () => openConvertDialog();
  $('bReseed').onclick = () => { if (S.board) convert(true); else convert(false); };

  /* ================= モーダル ================= */
  function openModal(title, buildBody, foot) {
    $('modalTitle').textContent = title;
    const b = $('modalBody'); b.innerHTML = ''; b.className = 'content'; b._raster = null; b._name = null;
    if (b._obs) { b._obs.disconnect(); b._obs = null; }
    buildBody(b);
    const f = $('modalFoot'); f.innerHTML = '';
    (foot || []).forEach(x => f.appendChild(x));
    $('modal').hidden = false;
  }
  $('modalClose').onclick = () => $('modal').hidden = true;
  $('modal').addEventListener('click', e => { if (e.target === $('modal')) $('modal').hidden = true; });

  /* --- サンプル --- */
  $('bSample').onclick = () => openModal('回路図を開く', body => {
    const g = el('div', 'samples');
    const blank = el('button', 'scard'); blank.type = 'button';
    blank.appendChild(el('b', null, '新規（空の回路図）'));
    blank.appendChild(el('span', null, '何もない状態から描き始めます。'));
    blank.onclick = () => {
      pushUndo(); S.doc = CD.newDoc(); S.selection.clear(); S.board = null;
      refreshNets(); $('modal').hidden = true; setTab('sch'); fit(); panels();
    };
    g.appendChild(blank);
    window.CADSamples.forEach(s => {
      const b = el('button', 'scard'); b.type = 'button';
      b.appendChild(el('b', null, s.name)); b.appendChild(el('span', null, s.desc));
      b.onclick = () => {
        pushUndo(); S.doc = CD.loadSample(s); S.selection.clear(); S.board = null;
        refreshNets(); $('modal').hidden = true; setTab('sch'); fit(); panels();
      };
      g.appendChild(b);
    });
    body.appendChild(g);
    const n = el('p', 'note', '読み込むと現在の回路図は置き換わります（Ctrl+Z で戻せます）。');
    body.appendChild(n);
  });

  /* --- カスタム部品 --- */
  function openCustomModal() {
    const GW = 10, GH = 8;
    let pads = [], label = 'MY-PART';
    openModal('カスタム部品を作る', body => {
      body.appendChild(field('部品名 / 型番', input(label, v => label = v)));
      const info = el('p', 'note', 'グリッドをタップしてピン（ランド）を置きます。タップした順にピン番号 1, 2, 3… が付きます。もう一度タップで取り消し。マス目の間隔は 2.54 mm です。');
      body.appendChild(info);
      const grid = el('div', 'padgrid');
      grid.style.gridTemplateColumns = `repeat(${GW},auto)`;
      const btns = [];
      for (let r = 0; r < GH; r++) for (let c = 0; c < GW; c++) {
        const b = el('button'); b.type = 'button'; b.dataset.c = c; b.dataset.r = r;
        b.onclick = () => {
          const i = pads.findIndex(p => p[0] === c && p[1] === r);
          if (i >= 0) pads.splice(i, 1); else pads.push([c, r]);
          sync();
        };
        grid.appendChild(b); btns.push(b);
      }
      body.appendChild(grid);
      const cnt = el('p', 'note', ''); body.appendChild(cnt);
      function sync() {
        btns.forEach(b => {
          const i = pads.findIndex(p => p[0] === +b.dataset.c && p[1] === +b.dataset.r);
          b.className = i >= 0 ? 'on' : ''; b.textContent = i >= 0 ? (i + 1) : '';
        });
        cnt.textContent = `ピン数: ${pads.length}`;
      }
      sync();
    }, [(() => {
      const b = el('button', 'btn primary', '部品リストに追加');
      b.onclick = () => {
        if (pads.length < 1) { alert('ピンを1つ以上置いてください。'); return; }
        const minC = Math.min(...pads.map(p => p[0])), minR = Math.min(...pads.map(p => p[1]));
        const d = { label: label || 'MY-PART', pads: pads.map(p => [p[0] - minC, p[1] - minR]) };
        S.customs.push(d); store.set('customs', S.customs);
        paletteBuild();
        S.palOpen = true; applyPanels();
        setTool('sel', true);
        S.place = 'CUSTOM'; S.placeIdx = S.customs.length - 1;
        S.placeProps = { props: { custom: d }, val: d.label };
        $('modal').hidden = true; setTab('sch'); paletteSync(); hint(); actbar(); rp();
      };
      return b;
    })()]);
  }

  /* --- 出力 --- */
  // SVG は印刷用途のため、常にライトテーマの配色で書き出す
  function withLight(fn) {
    const prev = document.documentElement.getAttribute('data-theme');
    document.documentElement.setAttribute('data-theme', 'light');
    RD.readTheme();
    let out;
    try { out = fn(); } finally {
      if (prev) document.documentElement.setAttribute('data-theme', prev);
      else document.documentElement.removeAttribute('data-theme');
      RD.readTheme(); rp();
    }
    return out;
  }
  $('bExport').onclick = () => openModal('ダウンロード', body => {
    const kinds = [
      ['回路図 (JSON)', () => CD.serialize(S.doc), 'schematic.json'],
      ['回路図 (画像)', () => withLight(() => RD.schematicSVG(S.doc)), 'schematic.svg', true],
      ['基板 部品面 (画像)', () => S.board ? withLight(() => RD.boardSVG(S.board, 'top', S.pcbMono)) : null, 'board-top.svg', true],
      ['基板 半田面 (画像)', () => S.board ? withLight(() => RD.boardSVG(S.board, 'bottom', S.pcbMono)) : null, 'board-bottom.svg', true],
      ['基板 両面 (画像)', () => S.board ? withLight(() => RD.boardSVG(S.board, 'both', S.pcbMono)) : null, 'board-both.svg', true],
      ['ネットリスト', netlistText, 'netlist.txt'],
      ['配線指示リスト', wiringText, 'wiring.txt'],
      ['部品表 BOM (CSV)', bomText, 'bom.csv']
    ];
    const row = el('div'); row.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px';
    const ta = el('textarea', 'code'); ta.readOnly = false;
    // 画像の形式 (SVG / PNG / JPEG)
    if (!S.expFmt) S.expFmt = store.get('expFmt', 'svg');
    const fmtRow = el('div', 'fmtrow');
    fmtRow.appendChild(el('span', 'fmtlab', '形式'));
    const fmts = [['svg', 'SVG'], ['png', 'PNG'], ['jpeg', 'JPEG']];
    const fmtBtns = fmts.map(([k, label]) => {
      const b = el('button', 'chip', label); b.type = 'button';
      b.onclick = () => { S.expFmt = k; store.set('expFmt', k); refresh(); };
      fmtRow.appendChild(b); return b;
    });
    const fmtNote = el('span', 'fmtnote'); fmtRow.appendChild(fmtNote);
    const prev = el('div', 'imgprev'); const img = el('img'); img.alt = 'プレビュー'; prev.appendChild(img);
    let cur = null, token = 0;
    body._raster = null;
    async function refresh() {
      if (!cur) return;
      const [, fn, file, isImg] = cur;
      const fmt = isImg ? (S.expFmt || 'svg') : 'svg';
      fmtRow.hidden = !isImg;
      fmtBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(fmts[i][0] === fmt)));
      const txt = fn();
      body._raster = null;
      if (txt == null) { ta.hidden = false; prev.hidden = true; ta.value = '（基板未生成）'; body._name = file; fmtNote.textContent = ''; return; }
      if (!isImg || fmt === 'svg') {
        ta.hidden = false; prev.hidden = true; ta.value = txt; body._name = file;
        fmtNote.textContent = isImg ? '拡大しても劣化しないベクター形式' : '';
        return;
      }
      ta.hidden = true; prev.hidden = false; ta.value = '';
      body._name = file.replace(/\.svg$/, fmt === 'jpeg' ? '.jpg' : '.png');
      fmtNote.textContent = '変換中…';
      const my = ++token;
      try {
        const r = await svgToRaster(txt, fmt);
        if (my !== token) return;
        body._raster = r; img.src = r.url;
        fmtNote.textContent = `${r.w} × ${r.h} px` + (fmt === 'jpeg' ? '（背景は白）' : '');
      } catch (e) { if (my === token) fmtNote.textContent = '画像に変換できませんでした'; }
    }
    kinds.forEach((k, i) => {
      const b = el('button', 'btn', k[0]); b.type = 'button';
      b.onclick = () => {
        row.querySelectorAll('.btn').forEach(x => x.setAttribute('aria-pressed', 'false'));
        b.setAttribute('aria-pressed', 'true'); cur = k; refresh();
      };
      if (i === 0) setTimeout(() => b.click(), 0);
      row.appendChild(b);
    });
    body.appendChild(row); body.appendChild(fmtRow); body.appendChild(ta); body.appendChild(prev);
    const imp = el('p', 'note');
    imp.innerHTML = '内容を選んで<b>ダウンロード</b>を押すと保存されます。回路図 (JSON) を保存しておくと、あとで「読み込み」から続きを編集できます。画像は SVG / PNG / JPEG から選べます。';
    body.appendChild(imp);
    body.dataset.ta = '1'; body._ta = ta;
  }, [
    (() => {
      const b = el('button', 'btn', 'コピー');
      b.title = 'クリップボードにコピー';
      b.onclick = async () => {
        const body = $('modalBody'), ta = body._ta;
        const done = t => { b.textContent = t; setTimeout(() => b.textContent = 'コピー', 1400); };
        if (body._raster) {
          try {
            const png = body._raster.type === 'image/png' ? body._raster.blob : await svgToRaster(body._raster.svg, 'png').then(r => r.blob);
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
            done('コピーしました');
          } catch (e) { done('この環境では画像をコピーできません'); }
          return;
        }
        try { await navigator.clipboard.writeText(ta.value); done('コピーしました'); }
        catch (e) { ta.select(); }
      };
      return b;
    })(),
    (() => {
      const b = el('button', 'btn primary big');
      const setL = t => { b.innerHTML = ''; b.insertAdjacentHTML('beforeend', DL_ICON); b.appendChild(el('span', null, t)); };
      const label = t => { setL(t); setTimeout(() => setL(defLabel()), 1800); };
      const defLabel = () => 'ダウンロード（' + ($('modalBody')._name || 'file') + '）';
      setL('ダウンロード');
      setTimeout(() => setL(defLabel()), 30);
      const obs = new MutationObserver(() => { if (!b.disabled) setL(defLabel()); });
      setTimeout(() => { const mb = $('modalBody'); obs.observe(mb, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-pressed', 'hidden'] }); mb._obs = obs; }, 0);
      b.onclick = async () => {
        const body = $('modalBody'), ta = body._ta;
        const name = body._name || 'uniboard.txt';
        b.disabled = true;
        try { label(await saveFile(name, body._raster ? body._raster.blob : ta.value)); } finally { b.disabled = false; }
      };
      return b;
    })()
  ]);

  /* ---- 読み込み ---- */
  function loadJSONText(txt) {
    const d = CD.deserialize(txt);
    const unknown = [...new Set(d.components.filter(c => !C1.symOf(c)).map(c => c.type))];
    if (unknown.length) {
      // 知らない部品を黙って落とすと、基板化したときに相手のない端子ができてしまう
      throw new Error('この CAD に無い部品種別が含まれています: ' + unknown.join(', ') +
        '。新しいバージョンの UniBoard CAD で開いてください（部品が消えたまま基板化すると配線が欠けます）。');
    }
    pushUndo(); S.doc.components = d.components; S.doc.wires = d.wires; S.doc.junctions = d.junctions; S.doc.nextId = d.nextId; S.doc.perfboard = d.perfboard;
    S.board = null; refreshNets(); $('modal').hidden = true;
    // 蛇の目基板の手配置が入っていれば、基板タブでその配置・配線を開く
    if (d.perfboard && window.UBPerf) { setTab('pcb'); } else { setTab('sch'); fit(); }
    panels();
  }
  $('bImport').onclick = () => openModal('回路図を読み込む', body => {
    const drop = el('label', 'dropzone');
    drop.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.6v8"/><path d="M5 5.6 8 2.6l3 3"/><path d="M2.8 10.4v1.6a1.4 1.4 0 0 0 1.4 1.4h7.6a1.4 1.4 0 0 0 1.4-1.4v-1.6"/></svg>');
    drop.appendChild(el('b', null, 'ファイルを選ぶ'));
    drop.appendChild(el('span', null, 'または、ここに .json ファイルをドラッグ＆ドロップ'));
    const fi = el('input'); fi.type = 'file'; fi.accept = '.json,application/json'; fi.hidden = true; drop.appendChild(fi);
    const msgEl = el('p', 'note');
    const readFile = f => {
      if (!f) return;
      const r = new FileReader();
      r.onload = () => { try { loadJSONText(String(r.result)); } catch (e) { msgEl.textContent = '読み込めませんでした: ' + e.message; msgEl.style.color = 'var(--crit)'; } };
      r.readAsText(f);
    };
    fi.onchange = () => readFile(fi.files[0]);
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); readFile(e.dataTransfer.files[0]); });
    body.appendChild(drop);
    const det = el('details', 'pastebox');
    det.appendChild(el('summary', null, 'JSON を貼り付けて読み込む'));
    const ta = el('textarea', 'code'); ta.placeholder = '「ダウンロード」→「回路図 (JSON)」でコピーした内容を貼り付け'; ta.style.height = '160px';
    det.appendChild(ta);
    const go = el('button', 'btn', '貼り付けた内容を読み込む'); go.type = 'button'; go.style.marginTop = '8px';
    go.onclick = () => { try { loadJSONText(ta.value); } catch (e) { msgEl.textContent = 'JSON を解釈できませんでした: ' + e.message; msgEl.style.color = 'var(--crit)'; } };
    det.appendChild(go);
    body.appendChild(det);
    msgEl.textContent = '読み込むと、今の回路図は置き換わります（元に戻すボタンで戻せます）。';
    body.appendChild(msgEl);
  }, [(() => { const b = el('button', 'btn', 'キャンセル'); b.onclick = () => $('modal').hidden = true; return b; })()]);

  /* ファイル保存: claude.ai 上ではダウンロード権限、ローカルHTMLでは通常のリンク */
  const DL_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.6v8"/><path d="M5 7.6l3 3 3-3"/><path d="M2.8 10.4v1.6a1.4 1.4 0 0 0 1.4 1.4h7.6a1.4 1.4 0 0 0 1.4-1.4v-1.6"/></svg>';
  /* SVG → PNG / JPEG 変換（2倍解像度、長辺は最大 8000px） */
  function svgToRaster(svg, fmt) {
    return new Promise((resolve, reject) => {
      const m = svg.match(/<svg[^>]*\swidth="([\d.]+)"[^>]*\sheight="([\d.]+)"/);
      const w0 = m ? +m[1] : 1200, h0 = m ? +m[2] : 900;
      const sc = Math.min(2, 8000 / Math.max(w0, h0));
      const w = Math.max(1, Math.round(w0 * sc)), h = Math.max(1, Math.round(h0 * sc));
      const im = new Image();
      im.onload = () => {
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const g = c.getContext('2d');
        if (fmt === 'jpeg') { g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, w, h); }
        g.drawImage(im, 0, 0, w, h);
        const type = fmt === 'jpeg' ? 'image/jpeg' : 'image/png';
        c.toBlob(blob => blob ? resolve({ blob, type, w, h, svg, url: URL.createObjectURL(blob) }) : reject(new Error('toBlob')), type, .95);
      };
      im.onerror = () => reject(new Error('svg load'));
      im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  async function saveFile(name, text) {
    const mime = /\.svg$/.test(name) ? 'image/svg+xml'
      : /\.png$/.test(name) ? 'image/png'
      : /\.jpe?g$/.test(name) ? 'image/jpeg'
      : /\.json$/.test(name) ? 'application/json'
      : /\.csv$/.test(name) ? 'text/csv'
      : /\.zip$/.test(name) ? 'application/zip' : /\.(drl|gbr|gtl|gbl)$/.test(name) ? 'application/octet-stream' : 'text/plain';
    // Android アプリ版: 端末の「保存先を選ぶ」画面で書き出す
    if (window.AndroidBridge && window.AndroidBridge.saveFile) {
      try {
        const blob = text instanceof Blob ? text : new Blob([text], { type: mime + ';charset=utf-8' });
        const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(blob); });
        window.AndroidBridge.saveFile(name, mime, b64);
        return '保存先を選んでください';
      } catch (e) { return '保存できませんでした'; }
    }
    try {
      const dl = (window.claude && window.claude.use) ? await window.claude.use('downloads') : null;
      if (dl) {
        await dl.save({ filename: name, data: text });
        return '保存しました';
      }
    } catch (e) {
      const code = e && e.code;
      if (code === 'declined') return 'キャンセルしました';
      if (code === 'rate_limited') return '少し待って再度お試しください';
      if (code && code !== 'unavailable' && code !== 'not_granted') return '保存できませんでした';
    }
    try {
      const url = URL.createObjectURL(text instanceof Blob ? text : new Blob([text], { type: mime + ';charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url; a.download = name; a.style.display = 'none';
      document.body.appendChild(a); a.click();
      setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 2000);
      return '保存しました';
    } catch (e) { return 'この環境では保存できません'; }
  }

  function netlistText() {
    if (!S.nets) refreshNets();
    const L = ['# UniBoard CAD ネットリスト', `# ネット数: ${S.nets.length}`, ''];
    S.nets.forEach(n => L.push(`${n.name}${n.rail ? ' (電源)' : ''}\t` + n.pins.map(p => p.ref + '.' + (p.pin.name || p.pin.n)).join('  ')));
    return L.join('\n');
  }
  function wiringText() {
    if (!S.board) return '（基板未生成）';
    const b = S.board;
    const list = CB.wiringList(b.prj, b.board, b.result, b.strip);
    const L = [`# UniBoard CAD 配線指示`,
      `# 基板: ${b.board.cols}×${b.board.rows} 穴 (${(b.board.cols * 2.54).toFixed(1)}×${(b.board.rows * 2.54).toFixed(1)} mm) / ${b.board.type === 'strip' ? 'ストリップボード' : '蛇の目基板'}`,
      `# 穴番号は左上を A1 とし、横= A,B,C… 縦= 1,2,3…`, ''];
    L.push('## 部品配置');
    b.prj.comps.forEach(c => {
      const sh = c.rots[((c.pos.rot / 90) | 0) & 3];
      L.push(`${c.ref}\t${c.val || c.name}\t1番ピン=${CB.holeName(c.pos.c + sh.pads[0].c, c.pos.r + sh.pads[0].r)}\t向き=${c.pos.rot}°\tピン: ` +
        sh.pads.map(p => `${c.pinNames[p.pin] || p.pin}→${CB.holeName(c.pos.c + p.c, c.pos.r + p.r)}`).join(' '));
    });
    L.push('', '## 配線作業');
    list.forEach((w, i) => L.push(`${String(i + 1).padStart(3, ' ')}. ${w.text}`));
    return L.join('\n');
  }
  function bomText() {
    const m = new Map();
    S.doc.components.forEach(c => {
      const s = C1.symOf(c); if (!s || s.virtual || s.simOnly) return;
      const off = !!(c.props && c.props.offboard);
      const k = s.name + '|' + (c.val || '') + '|' + off;
      if (!m.has(k)) m.set(k, { name: s.name, val: c.val || '', off, refs: [] });
      m.get(k).refs.push(c.ref);
    });
    const L = ['種別,定数/型番,数量,リファレンス,取り付け'];
    [...m.values()].forEach(v => L.push(`"${v.name}","${v.val}",${v.refs.length},"${v.refs.sort().join(' ')}","${v.off ? '基板外' : '基板上'}"`));
    return L.join('\n');
  }

  /* ================= 起動 ================= */
  S.customs = store.get('customs', []) || [];
  { const c = store.get('cfg', null); if (c && typeof c === 'object') ['type', 'auto', 'cols', 'rows', 'stripDir', 'policy', 'quality', 'forced', 'beauty', 'blocks'].forEach(k => { if (k in c) S.cfg[k] = c[k]; }); }
  RD.readTheme();
  applyTheme(); themeTitle();
  let firstFit = false, lastW = 0, lastH = 0;
  window.addEventListener('resize', () => {
    S.palOpen = window.innerWidth > 640;
    S.inspOpen = window.innerWidth > 1100;
    applyPanels();
  });
  applyPanels();
  new ResizeObserver(() => {
    resize(); placeMono();
    if (cw > 50 && (!firstFit || (!S.userMoved && (Math.abs(cw - lastW) > 8 || Math.abs(ch - lastH) > 8)))) {
      firstFit = true; lastW = cw; lastH = ch; fit();
    }
  }).observe($('stage'));
  resize();
  S.doc = CD.loadSample(window.CADSamples[0]);
  refreshNets();
  setTool('sel'); setIPane(); hint(); panels();
  fit();
  requestAnimationFrame(loop);
  // 起動時に基板も生成しておく（何ができるか一目で分かるように）
  setTimeout(() => convert(false, true), 150);
})();
