/* =====================================================================
   UniBoard CAD — 描画 (Canvas / SVG 共通ペン)
   ===================================================================== */
(function (global) {
  'use strict';
  const C1 = global.CADCore, CB = global.CADBoard;
  const GS = C1.GS;

  /* ---------- テーマ色 ---------- */
  const TH = {};
  function readTheme() {
    const cs = getComputedStyle(document.documentElement);
    ['bg', 'surface', 'surface2', 'ink', 'ink2', 'muted', 'faint', 'line', 'accent', 'accent-soft',
     'copper', 'copper-lite', 'jump', 'jump-lite', 'ok', 'warn', 'crit', 'board', 'board-edge',
     'hole', 'pad', 'strip', 'grid', 'gridmaj',
     'net-gnd', 'net-gnd-glow', 'net-vcc', 'net-vee',
     'wire', 'wire-vcc', 'wire-gnd', 'wire-vee'].forEach(k => TH[k] = cs.getPropertyValue('--' + k).trim());
    TH.mono = false;
    return TH;
  }

  /* ---------- ペン ---------- */
  const ok = v => !!v && v !== 'none';
  function CanvasPen(ctx) {
    return {
      kind: 'canvas',
      line(x1, y1, x2, y2, o) {
        o = o || {}; ctx.save(); ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
        ctx.strokeStyle = o.stroke || TH.ink; ctx.lineWidth = o.w || 1;
        ctx.lineCap = o.cap || 'round'; if (o.dash) ctx.setLineDash(o.dash);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
      },
      poly(pts, o) {
        o = o || {}; ctx.save(); ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
        ctx.lineJoin = 'round'; ctx.lineCap = o.cap || 'round';
        if (o.dash) ctx.setLineDash(o.dash);
        ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
        if (o.close) ctx.closePath();
        if (ok(o.fill)) { ctx.fillStyle = o.fill; ctx.fill(); }
        if (ok(o.stroke)) { ctx.strokeStyle = o.stroke; ctx.lineWidth = o.w || 1; ctx.stroke(); }
        ctx.restore();
      },
      circle(x, y, r, o) {
        o = o || {}; ctx.save(); ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
        ctx.beginPath(); ctx.arc(x, y, Math.max(0.0001, r), 0, Math.PI * 2);
        if (ok(o.fill)) { ctx.fillStyle = o.fill; ctx.fill(); }
        if (ok(o.stroke)) { ctx.strokeStyle = o.stroke; ctx.lineWidth = o.w || 1; ctx.stroke(); }
        ctx.restore();
      },
      arc(x, y, r, a0, a1, o) {
        o = o || {}; ctx.save(); ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
        ctx.beginPath(); ctx.arc(x, y, r, a0, a1);
        ctx.strokeStyle = o.stroke || TH.ink; ctx.lineWidth = o.w || 1; ctx.lineCap = 'round'; ctx.stroke();
        ctx.restore();
      },
      rect(x, y, w, h, o) {
        o = o || {}; ctx.save(); ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
        const r = Math.min(o.rx || 0, Math.abs(w) / 2, Math.abs(h) / 2);
        ctx.beginPath();
        if (r > 0 && ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
        if (ok(o.fill)) { ctx.fillStyle = o.fill; ctx.fill(); }
        if (ok(o.stroke)) { ctx.strokeStyle = o.stroke; ctx.lineWidth = o.sw || o.w || 1; ctx.stroke(); }
        ctx.restore();
      },
      text(x, y, t, o) {
        o = o || {}; ctx.save(); ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
        ctx.fillStyle = o.fill || TH.ink;
        ctx.font = `${o.weight || 500} ${o.size || 9}px ${o.mono ? '"IBM Plex Mono",monospace' : '"Archivo","Hiragino Sans",sans-serif'}`;
        ctx.textAlign = o.anchor === 'start' ? 'left' : o.anchor === 'end' ? 'right' : 'center';
        ctx.textBaseline = o.base || 'alphabetic';
        if (o.halo) { ctx.strokeStyle = o.halo; ctx.lineWidth = o.haloW || (o.size || 9) * .32; ctx.lineJoin = 'round'; ctx.strokeText(t, x, y); }
        ctx.fillText(t, x, y); ctx.restore();
      }
    };
  }

  function SvgPen(out) {
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const n = v => (Math.round(v * 1000) / 1000);
    const sa = o => (o.alpha != null && o.alpha < 1 ? ` opacity="${o.alpha}"` : '');
    return {
      kind: 'svg',
      line(x1, y1, x2, y2, o) {
        o = o || {};
        out.push(`<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${o.stroke || '#000'}" stroke-width="${n(o.w || 1)}" stroke-linecap="${o.cap || 'round'}"${o.dash ? ` stroke-dasharray="${o.dash.join(' ')}"` : ''}${sa(o)}/>`);
      },
      poly(pts, o) {
        o = o || {};
        const d = pts.reduce((s, v, i) => s + (i % 2 ? ' ' + n(v) : (i ? ' L ' : 'M ') + n(v)), '') + (o.close ? ' Z' : '');
        out.push(`<path d="${d}" fill="${o.fill || 'none'}" stroke="${o.stroke || 'none'}" stroke-width="${n(o.w || 1)}" stroke-linejoin="round" stroke-linecap="round"${sa(o)}/>`);
      },
      circle(x, y, r, o) {
        o = o || {};
        out.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(Math.max(0.0001, r))}" fill="${o.fill || 'none'}" stroke="${o.stroke || 'none'}" stroke-width="${n(o.w || 1)}"${sa(o)}/>`);
      },
      arc(x, y, r, a0, a1, o) {
        o = o || {};
        const x0 = x + r * Math.cos(a0), y0 = y + r * Math.sin(a0);
        const x1 = x + r * Math.cos(a1), y1 = y + r * Math.sin(a1);
        const large = (a1 - a0) % (Math.PI * 2) > Math.PI ? 1 : 0;
        out.push(`<path d="M ${n(x0)} ${n(y0)} A ${n(r)} ${n(r)} 0 ${large} 1 ${n(x1)} ${n(y1)}" fill="none" stroke="${o.stroke || '#000'}" stroke-width="${n(o.w || 1)}" stroke-linecap="round"${sa(o)}/>`);
      },
      rect(x, y, w, h, o) {
        o = o || {};
        const X = w < 0 ? x + w : x, Y = h < 0 ? y + h : y;
        out.push(`<rect x="${n(X)}" y="${n(Y)}" width="${n(Math.abs(w))}" height="${n(Math.abs(h))}" rx="${n(o.rx || 0)}" fill="${o.fill || 'none'}" stroke="${o.stroke || 'none'}" stroke-width="${n(o.sw || o.w || 1)}"${sa(o)}/>`);
      },
      text(x, y, t, o) {
        o = o || {};
        out.push(`<text x="${n(x)}" y="${n(y)}" fill="${o.fill || '#000'}" font-size="${n(o.size || 9)}" font-weight="${o.weight || 500}" font-family="${o.mono ? 'IBM Plex Mono,monospace' : 'Archivo,sans-serif'}" text-anchor="${o.anchor === 'start' ? 'start' : o.anchor === 'end' ? 'end' : 'middle'}"${o.halo ? ` stroke="${o.halo}" stroke-width="${n(o.haloW || (o.size || 9) * .32)}" stroke-linejoin="round" paint-order="stroke"` : ''}${sa(o)}>${esc(t)}</text>`);
      }
    };
  }

  /* ---------- 記号プリミティブ描画 ---------- */
  function drawSymbol(pen, sym, cx, cy, rot, style) {
    const w = style.w, col = style.color;
    const M = (x, y) => { const [a, b] = C1.rotXY(x, y, rot); return [cx + a, cy + b]; };
    const rad = rot * Math.PI / 180;
    for (const p of sym.g) {
      switch (p[0]) {
        case 'L': { const a = M(p[1], p[2]), b = M(p[3], p[4]); pen.line(a[0], a[1], b[0], b[1], { stroke: col, w }); break; }
        case 'PL': { const pts = []; for (let i = 0; i < p[1].length; i += 2) { const q = M(p[1][i], p[1][i + 1]); pts.push(q[0], q[1]); } pen.poly(pts, { stroke: col, w }); break; }
        case 'PG': { const pts = []; for (let i = 0; i < p[1].length; i += 2) { const q = M(p[1][i], p[1][i + 1]); pts.push(q[0], q[1]); } pen.poly(pts, { fill: col, stroke: col, w: w * .7, close: true }); break; }
        case 'C': { const q = M(p[1], p[2]); pen.circle(q[0], q[1], p[3], { stroke: col, w }); break; }
        case 'CF': { const q = M(p[1], p[2]); pen.circle(q[0], q[1], p[3], { fill: col }); break; }
        case 'A': { const q = M(p[1], p[2]); pen.arc(q[0], q[1], p[3], p[4] + rad, p[5] + rad, { stroke: col, w }); break; }
        case 'R': {
          const c0 = M(p[1], p[2]), c1 = M(p[1] + p[3], p[2]), c2 = M(p[1] + p[3], p[2] + p[4]), c3 = M(p[1], p[2] + p[4]);
          pen.poly([c0[0], c0[1], c1[0], c1[1], c2[0], c2[1], c3[0], c3[1]], { stroke: col, w, close: true, fill: style.fill });
          break;
        }
        case 'T': {
          const q = M(p[1], p[2]);
          let t = p[3], sz = p[4];
          if (style.textOverride && sym.virtual) {
            t = style.textOverride;
            sz = Math.min(p[4], p[4] * 4.2 / Math.max(3, t.length));
          }
          pen.text(q[0], q[1], t, { size: sz, fill: col, anchor: p[5] === 'left' ? 'start' : p[5] === 'right' ? 'end' : 'middle', weight: 600 });
          break;
        }
      }
    }
    for (const pin of sym.pins) {
      const q = M(pin.x, pin.y);
      if (!style.pinMark) { pen.circle(q[0], q[1], w * 1.5, { fill: style.pin || col }); }
      else if (style.pinMark(q[0], q[1])) pen.circle(q[0], q[1], 3.2, { stroke: TH.warn, w: 1.5 });
    }
  }

  /* ---------- 暗黙ジャンクション ---------- */
  function junctionDots(doc) {
    const cnt = new Map(), key = (x, y) => x + ',' + y;
    const add = (x, y) => cnt.set(key(x, y), (cnt.get(key(x, y)) || 0) + 1);
    doc.wires.forEach(w => { add(w.x1, w.y1); add(w.x2, w.y2); });
    const dots = [];
    cnt.forEach((v, k) => { if (v >= 3) { const [x, y] = k.split(',').map(Number); dots.push({ x, y }); } });
    // 端点が他ワイヤの内部に乗る場合
    const onSeg = (px, py, w) => {
      const cr = (px - w.x1) * (w.y2 - w.y1) - (py - w.y1) * (w.x2 - w.x1);
      if (Math.abs(cr) > 1e-6) return false;
      const dt = (px - w.x1) * (w.x2 - w.x1) + (py - w.y1) * (w.y2 - w.y1);
      const l2 = (w.x2 - w.x1) ** 2 + (w.y2 - w.y1) ** 2;
      return l2 > 0 && dt > 1e-6 && dt < l2 - 1e-6;
    };
    const seen = new Set(dots.map(d => key(d.x, d.y)));
    doc.wires.forEach(a => [[a.x1, a.y1], [a.x2, a.y2]].forEach(([x, y]) => {
      if (seen.has(key(x, y))) return;
      for (const b of doc.wires) if (b !== a && onSeg(x, y, b)) { dots.push({ x, y }); seen.add(key(x, y)); return; }
    }));
    (doc.junctions || []).forEach(j => {
      const k = key(j.x, j.y);
      const ex = dots.find(d => key(d.x, d.y) === k);
      if (ex) ex.id = j.id; else { dots.push({ x: j.x, y: j.y, id: j.id }); seen.add(k); }
    });
    return dots;
  }

  /* ---------- 部品ラベル (番号・定数) の置き場所 ----------
     既定の位置 (横向き部品は上下、縦向き部品は右) が配線・他の部品・他のラベルと重なるときは、
     空いている側へ移す。図面が変わらない限り結果を使い回す */
  let labelCache = { doc: null, sig: '', map: null };
  function labelLayout(doc) {
    let sig = doc.components.length + ':' + doc.wires.length;
    let h = 0;
    for (const c of doc.components) h = (h * 31 + c.x * 7 + c.y * 13 + (c.rot || 0) + (c.ref ? c.ref.length : 0) * 3 + (c.val ? String(c.val).length : 0)) | 0;
    for (const w of doc.wires) h = (h * 31 + w.x1 + w.y1 * 3 + w.x2 * 5 + w.y2 * 7) | 0;
    sig += ':' + h;
    if (labelCache.doc === doc && labelCache.sig === sig) return labelCache.map;
    const CW = 5.6, LH = 11;                       // 等幅 9px の 1 文字の幅 / 行の高さ
    const boxes = [];                              // 部品の外形
    const comps = doc.components.filter(c => C1.symOf(c));
    comps.forEach(c => { const b = C1.compBBox(c); boxes.push({ id: c.id, x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 }); });
    const placed = [];
    const hitRect = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
    const hitWire = (r, w) => Math.min(w.x1, w.x2) < r.x1 && Math.max(w.x1, w.x2) > r.x0 && Math.min(w.y1, w.y2) < r.y1 && Math.max(w.y1, w.y2) > r.y0;
    const score = (rects, id) => {
      let v = 0;
      for (const r of rects) {
        for (const w of doc.wires) if (hitWire(r, w)) v += 3;
        for (const b of boxes) if (b.id !== id && hitRect(r, b)) v += 4;
        for (const q of placed) if (hitRect(r, q)) v += 4;
      }
      return v;
    };
    const map = new Map();
    for (const c of comps) {
      const s = C1.symOf(c); if (s.virtual) continue;
      const bb = C1.compBBox(c), ref = c.ref || '', val = c.val ? String(c.val) : '';
      const wr = ref.length * CW, wv = val.length * CW, wm = Math.max(wr, wv);
      const vert = ((c.rot || 0) % 180) === 90;
      const mid = (anchor, x, y, w) => anchor === 'start' ? { x0: x, x1: x + w, y0: y - 8, y1: y + 2 } : anchor === 'end' ? { x0: x - w, x1: x, y0: y - 8, y1: y + 2 } : { x0: x - w / 2, x1: x + w / 2, y0: y - 8, y1: y + 2 };
      const cand = (anchor, rx, ry, vx, vy) => ({ anchor, rx, ry, vx, vy, rects: [mid(anchor, rx, ry, wr)].concat(val ? [mid(anchor, vx, vy, wv)] : []) });
      const right = cand('start', bb.x1 + 5, c.y - 1, bb.x1 + 5, c.y + LH - 1);
      const left = cand('end', bb.x0 - 5, c.y - 1, bb.x0 - 5, c.y + LH - 1);
      const split = cand('middle', c.x, bb.y0 - 5, c.x, bb.y1 + 12);
      const above = cand('middle', c.x, bb.y0 - 5 - (val ? LH : 0), c.x, bb.y0 - 5);
      const below = cand('middle', c.x, bb.y1 + 12, c.x, bb.y1 + 12 + LH);
      const ur = cand('start', bb.x1 + 3, bb.y0 - 3 - (val ? LH : 0), bb.x1 + 3, bb.y0 - 3);
      const ul = cand('end', bb.x0 - 3, bb.y0 - 3 - (val ? LH : 0), bb.x0 - 3, bb.y0 - 3);
      const order = vert ? [right, left, ur, ul, above, below] : [split, above, below, ur, ul, right, left];
      let best = null, bs = Infinity;
      order.forEach((k, i) => { const v = score(k.rects, c.id) + i * .01; if (v < bs) { bs = v; best = k; } });
      void wm;
      best.rects.forEach(r => placed.push(r));
      map.set(c.id, best);
    }
    labelCache = { doc, sig, map };
    return map;
  }

  /* ---------- 回路図描画 ---------- */
  function drawSchematic(pen, doc, o) {
    const sel = o.selection || new Set();
    const hi = o.highlightNet;
    if (o.grid) {
      const step = GS, x0 = Math.floor(o.view.x0 / step) * step, x1 = o.view.x1, y0 = Math.floor(o.view.y0 / step) * step, y1 = o.view.y1;
      if ((x1 - x0) / step < 400 && (y1 - y0) / step < 400) {
        for (let x = x0; x <= x1; x += step)
          for (let y = y0; y <= y1; y += step)
            pen.circle(x, y, (x % (step * 5) === 0 && y % (step * 5) === 0) ? .9 : .5,
              { fill: (x % (step * 5) === 0 && y % (step * 5) === 0) ? TH.gridmaj : TH.grid });
      }
    }
    const wsel = w => sel.has(w.id);
    // 配線は部品と違う色で描き、電源 (VCC / GND / 負電源) は色を分ける → どこが電源かひと目でわかる
    const wireCol = TH.wire || TH.ink2;
    const clsCol = cls => cls === 'gnd' ? (TH['wire-gnd'] || wireCol) : cls === 'vcc' ? (TH['wire-vcc'] || wireCol) : cls === 'vee' ? (TH['wire-vee'] || wireCol) : wireCol;
    const netCls = new Map();
    if (o.nets) o.nets.forEach(n => netCls.set(n.index, n.rail ? CB.netClass(n) : 'sig'));
    const colOfWire = w => { const ni = o.netOfWire ? o.netOfWire.get(w.id) : null; return ni == null ? wireCol : clsCol(netCls.get(ni)); };
    const dotCol = new Map();
    for (const w of doc.wires) {
      const on = hi != null && o.netOfWire && o.netOfWire.get(w.id) === hi;
      const col = colOfWire(w);
      dotCol.set(w.x1 + ',' + w.y1, col); dotCol.set(w.x2 + ',' + w.y2, col);
      pen.line(w.x1, w.y1, w.x2, w.y2, {
        stroke: wsel(w) ? TH.accent : on ? TH.accent : col,
        w: wsel(w) || on ? 2.8 : 1.5, alpha: hi != null && !on && !wsel(w) ? .38 : 1
      });
    }
    for (const d of junctionDots(doc)) {
      const on = d.id && sel.has(d.id);
      if (on) pen.circle(d.x, d.y, 5.2, { fill: TH['accent-soft'], stroke: TH.accent, w: 1.6 });
      pen.circle(d.x, d.y, on ? 3 : 2.9, { fill: on ? TH.accent : dotCol.get(d.x + ',' + d.y) || wireCol });
    }
    const labelAt = o.labels !== false ? labelLayout(doc) : null;
    for (const c of doc.components) {
      const s = C1.symOf(c); if (!s) continue;
      const isSel = sel.has(c.id);
      // 電源記号は配線と同じ電源色にする
      const vcol = s.virtual && s.id !== 'NET' ? clsCol(CB.netClass({ rail: true, name: (c.props && c.props.net) || s.net || '' })) : null;
      drawSymbol(pen, s, c.x, c.y, c.rot || 0, {
        w: isSel ? 2.4 : 1.7, color: isSel ? TH.accent : vcol || TH.ink,
        pin: isSel ? TH.accent : TH.copper, pinMark: o.openPins ? (x, y) => o.openPins.has(x + ',' + y) : null,
        textOverride: s.virtual ? ((c.props && c.props.net) || s.net) : null
      });
      if (!s.virtual && c.props && c.props.offboard) {
        const bb = C1.compBBox(c);
        pen.rect(bb.x0 - 6, bb.y0 - 6, bb.x1 - bb.x0 + 12, bb.y1 - bb.y0 + 12, { stroke: TH.muted, w: 1, dash: [4, 3], rx: 4 });
        pen.text(bb.x0 - 4, bb.y1 + 3 + 12 + (((c.rot || 0) % 180) === 90 ? 0 : 12), '基板外', { size: 8, fill: TH.muted, anchor: 'start' });
      }
      if (!s.virtual && labelAt) {
        // 部品番号は濃く、定数は控えめに。配線や他の部品に重ならない位置へ自動で逃がす
        const L = labelAt.get(c.id);
        if (L) {
          const halo = pen.kind === 'canvas' ? TH.bg : null;
          pen.text(L.rx, L.ry, c.ref, { size: 9, fill: isSel ? TH.accent : TH.ink, weight: 700, mono: true, anchor: L.anchor, halo, haloW: 3.4 });
          if (c.val) pen.text(L.vx, L.vy, c.val, { size: 9, fill: isSel ? TH.accent : TH.muted, mono: true, anchor: L.anchor, halo, haloW: 3.4 });
        }
      }
    }
    if (o.ghost) {
      const s = C1.symOf(o.ghost);
      if (s) drawSymbol(pen, s, o.ghost.x, o.ghost.y, o.ghost.rot || 0, { w: 1.7, color: TH.accent, pin: TH.accent, fill: null });
    }
    if (o.preview) o.preview.forEach(p => pen.line(p[0], p[1], p[2], p[3], { stroke: TH.accent, w: 2, dash: [6, 5] }));
    if (o.handles) {
      const hs = (o.hscale || 1) * 4.6;
      o.handles.forEach(h => {
        if (h.kind === 'm') pen.circle(h.x, h.y, hs * .85, { fill: TH.surface, stroke: TH.accent, w: hs * .42 });
        else pen.rect(h.x - hs, h.y - hs, hs * 2, hs * 2, { fill: TH.surface, stroke: TH.accent, sw: hs * .42, rx: hs * .3 });
      });
    }
    if (o.marquee) {
      const m = o.marquee;
      pen.rect(Math.min(m.x0, m.x1), Math.min(m.y0, m.y1), Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0),
        { stroke: TH.accent, sw: 1.2, fill: TH['accent-soft'], alpha: .5 });
    }
  }

  /* ---------- 基板描画 ---------- */
  function bodyShape(pen, b, shape, col, alpha, fill, notch, rot, mirror) {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const paint = (fillCol, strokeCol, a) => {
      const o = { fill: fillCol, stroke: strokeCol, sw: .075, w: .075, alpha: a, rx: .2 };
      if (shape === 'circle') pen.circle(cx, cy, Math.max(b.w, b.h) / 2, o);
      else if (shape === 'to92') {
        // TO-92 の D 形: 足の並びに沿った平らな面 + 反対側の丸み。部品の向き (rot) に合わせて丸みの向きを変える
        const r = (((rot || 0) % 360) + 360) % 360, vert = b.h > b.w;
        let dir = vert ? (r === 270 ? 'L' : 'R') : (r === 180 ? 'D' : 'U');
        if (mirror && (dir === 'L' || dir === 'R')) dir = dir === 'L' ? 'R' : 'L';
        // 足の並び方向の半径 = 本体の半分、丸みの深さ = 約 1 穴 (実物の TO-92 と同じくらい)
        const RL = (vert ? b.h : b.w) / 2, RD = Math.min(RL, 1.0), pts = [], N = 18;
        const a0 = { U: Math.PI, D: 0, R: -Math.PI / 2, L: Math.PI / 2 }[dir];
        // 平らな面の両端 → 丸み → 反対の端 の順に一周する
        const start = { U: [b.x, b.y + b.h], D: [b.x + b.w, b.y], R: [b.x, b.y], L: [b.x + b.w, b.y + b.h] }[dir];
        const end = { U: [b.x + b.w, b.y + b.h], D: [b.x, b.y], R: [b.x, b.y + b.h], L: [b.x + b.w, b.y] }[dir];
        pts.push(start[0], start[1]);
        for (let i = 0; i <= N; i++) {
          const t = a0 + Math.PI * i / N, ct = Math.cos(t), st = Math.sin(t);
          pts.push(cx + (vert ? RD : RL) * ct, cy + (vert ? RL : RD) * st);
        }
        pts.push(end[0], end[1]);
        pen.poly(pts, Object.assign({}, o, { close: true }));
      } else pen.rect(b.x, b.y, b.w, b.h, o);
    };
    if (fill) paint(fill, null, alpha * .45);
    paint(null, col, alpha);
    if (shape === 'dip') {
      // 切り欠きは 1番ピン側の短辺の中央
      const n = notch || { x: cx, y: b.y, a0: 0, a1: Math.PI };
      pen.arc(n.x, n.y, Math.min(.3, Math.min(b.w, b.h) / 6), n.a0, n.a1, { stroke: col, w: .075, alpha });
    }
    else if (shape === 'to220') pen.line(b.x, b.y + b.h * .32, b.x + b.w, b.y + b.h * .32, { stroke: col, w: .06, alpha });
  }

  /* 白黒パターン図用の配色（テーマに関係なく紙のような白黒で描く） */
  const MONO = {
    board: '#FFFFFF', 'board-edge': '#8C8C8C', hole: '#B8B8B8', pad: '#000000', strip: '#E3E3E3',
    ink: '#000000', ink2: '#222222', muted: '#555555', surface: '#FFFFFF', surface2: '#FFFFFF',
    copper: '#000000', 'copper-lite': '#444444', jump: '#000000', 'jump-lite': '#444444',
    warn: '#000000', crit: '#000000',
    'net-gnd': '#000000', 'net-gnd-glow': '#000000', 'net-vcc': '#000000', 'net-vee': '#000000'
  };
  function drawBoard(pen, st, o) {
    if (!o || !o.mono) return drawBoardInner(pen, st, o || {});
    const saved = Object.assign({}, TH);
    Object.assign(TH, MONO, { mono: true });
    try { return drawBoardInner(pen, st, o); } finally { Object.keys(TH).forEach(k => delete TH[k]); Object.assign(TH, saved); }
  }
  function drawBoardInner(pen, st, o) {
    const { prj, board, result, strip } = st;
    const cols = board.cols, rows = board.rows;
    const mirror = !!o.mirror;
    const X = c => mirror ? (cols - 1 - c) : c;
    const showTop = o.view !== 'bottom', showBot = o.view !== 'topOnly';
    const aBot = o.view === 'top' ? .34 : 1;
    const aTop = o.view === 'bottom' ? .18 : 1;
    const aBody = o.view === 'bottom' ? .42 : 1;
    const hiNet = o.highlightNet;

    const railColOf = cls => !cls ? null : cls === 'gnd' ? TH['net-gnd'] : cls === 'vcc' ? TH['net-vcc'] : cls === 'vee' ? TH['net-vee'] : null;
    // 基材
    pen.rect(-1.25, -1.25, cols + 1.5, rows + 1.5, { fill: TH.board, stroke: TH['board-edge'], sw: .12, rx: .6 });
    for (const [dx, dy] of [[-.75, -.75], [cols - .25, -.75], [-.75, rows - .25], [cols - .25, rows - .25]])
      pen.circle(dx, dy, .28, { fill: TH['board-edge'], alpha: .55 });
    // 機能ブロック (同じ働きの部品のまとまり) の枠
    if (o.blocks && o.blocks.length) {
      const BC = ['#2E7D6B', '#5B6CC4', '#B5651D', '#8E4FA8', '#2F80A8', '#9A7A12', '#C0476A', '#4F7A2A'];
      o.blocks.forEach((b, i) => {
        const col = BC[i % BC.length], x0 = Math.min(X(b.c0), X(b.c1)) - .62, y0 = b.r0 - .62, w = Math.abs(X(b.c1) - X(b.c0)) + 1.24, h = b.r1 - b.r0 + 1.24;
        pen.rect(x0, y0, w, h, { fill: col, alpha: .09, rx: .5 });
        pen.rect(x0, y0, w, h, { stroke: col, sw: .07, alpha: .7, rx: .5 });
        pen.text(x0 + .18, y0 + .5, '#' + (i + 1) + ' ' + b.refs[0], { size: .42, fill: col, weight: 700, anchor: 'start', mono: true, halo: TH.board, haloW: .12 });
      });
    }

    if (board.type === 'strip' && strip) {
      const dir = strip.dir || 'row';
      const along = dir === 'row' ? cols : rows, across = dir === 'row' ? rows : cols;
      const cutAt = new Set(strip.cuts.map(k => k.b + ':' + k.a));
      for (let b = 0; b < across; b++) {
        let start = 0;
        for (let a = 0; a <= along; a++) {
          if (a === along || cutAt.has(b + ':' + a)) {
            const s = start, e = a === along ? along - 1 : a;
            const p1 = dir === 'row' ? [X(s), b] : [b, s], p2 = dir === 'row' ? [X(e), b] : [b, e];
            const x0 = Math.min(p1[0], p2[0]) - .38, y0 = Math.min(p1[1], p2[1]) - .38;
            const x1 = Math.max(p1[0], p2[0]) + .38, y1 = Math.max(p1[1], p2[1]) + .38;
            pen.rect(x0, y0, x1 - x0, y1 - y0, { fill: TH.strip, alpha: showBot ? .95 : .3, rx: .34 });
            start = a + 1;
          }
        }
      }
    }

    // 穴 + ランド
    const padNet = strip ? strip.padNet : (result && result.grid ? result.grid.padNet : null);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const idx = r * cols + c, x = X(c), y = r;
      const used = padNet && padNet[idx] >= 0;
      const pcls = used && prj.nets[padNet[idx]] ? prj.nets[padNet[idx]].cls : null;
      const pc = used ? (railColOf(pcls) || TH.pad) : null;
      if (pcls === 'gnd' && !TH.mono) pen.circle(x, y, .46, { stroke: TH['net-gnd-glow'], w: .22, alpha: .25 });
      if (board.type !== 'strip') pen.circle(x, y, .33, { stroke: used ? pc : TH['board-edge'], w: used ? .16 : .06, alpha: used ? 1 : .5 });
      else if (used) pen.circle(x, y, .33, { stroke: pc, w: .14 });
      pen.circle(x, y, .135, { fill: TH.hole, alpha: .85 });
    }

    // 四隅の取付穴エリア
    if (board.corner) {
      const k = board.corner;
      [[0, 0], [cols - k, 0], [0, rows - k], [cols - k, rows - k]].forEach(([c0, r0]) => {
        const x0 = mirror ? cols - (c0 + k) : c0;
        pen.rect(x0 - .45, r0 - .45, k - .1, k - .1, { stroke: TH.muted, sw: .06, rx: .2, alpha: .9, dash: [.2, .15] });
        pen.circle(x0 + (k - 1) / 2, r0 + (k - 1) / 2, Math.min(.9, k * .3), { stroke: TH.muted, w: .07, alpha: .9 });
      });
    }
    // カット
    if (strip) {
      strip.cuts.forEach(k => {
        const dir = strip.dir || 'row';
        const a = k.a + .5, b = k.b;
        const cx = dir === 'row' ? (mirror ? cols - 1 - a : a) : b;
        const cy = dir === 'row' ? b : a;
        if (dir === 'row') {
          pen.rect(cx - .17, cy - .42, .34, .84, { fill: TH.board });
          pen.line(cx, cy - .52, cx, cy + .52, { stroke: TH.crit, w: .15 });
          pen.line(cx - .2, cy - .52, cx + .2, cy - .52, { stroke: TH.crit, w: .09 });
          pen.line(cx - .2, cy + .52, cx + .2, cy + .52, { stroke: TH.crit, w: .09 });
        } else {
          pen.rect(cx - .42, cy - .17, .84, .34, { fill: TH.board });
          pen.line(cx - .52, cy, cx + .52, cy, { stroke: TH.crit, w: .15 });
          pen.line(cx - .52, cy - .2, cx - .52, cy + .2, { stroke: TH.crit, w: .09 });
          pen.line(cx + .52, cy - .2, cx + .52, cy + .2, { stroke: TH.crit, w: .09 });
        }
      });
    }

    // 配線 (GND / VCC / VEE は専用色、信号は半田面=銅 / 部品面=青)
    const clsOf = ni => (prj.nets[ni] && prj.nets[ni].cls) || 'sig';
    const railCol = cls => cls === 'gnd' ? TH['net-gnd'] : cls === 'vcc' ? TH['net-vcc'] : cls === 'vee' ? TH['net-vee'] : null;
    const wireCol = (ni, top) => {
      const rc = railCol(clsOf(ni));
      return rc || (top ? TH.jump : TH.copper);
    };
    // GND は発光しているように見せる（太いハロー＋明るい芯）
    const seg = (x1, y1, x2, y2, col, w, alpha, glow) => {
      if (glow) {
        pen.line(x1, y1, x2, y2, { stroke: TH['net-gnd-glow'], w: w * 3.2, alpha: alpha * .18 });
        pen.line(x1, y1, x2, y2, { stroke: TH['net-gnd-glow'], w: w * 1.9, alpha: alpha * .3 });
      }
      pen.line(x1, y1, x2, y2, { stroke: col, w, alpha });
      if (glow) pen.line(x1, y1, x2, y2, { stroke: TH['net-gnd-glow'], w: w * .34, alpha: alpha * .95 });
    };
    // 線の描き分け
    //   半田面すず線   : ネット色の実線
    //   部品面ジャンパ : 青い被覆＋ネット色(信号は白)の芯 = 絶縁電線らしい見た目
    //   被覆ジャンパ   : 黄色(白黒では黒)の被覆＋破線の芯
    const mono = !!TH.mono;
    const jumpCasing = hot => hot ? TH.accent : (mono ? TH.ink : TH.jump);
    const jumpCore = ni => mono ? TH.board : (railCol(clsOf(ni)) || '#FFFFFF');
    const drawJumper = (pts, ni, hot, alpha, style) => {
      const casing = style === 'forced' ? (hot ? TH.accent : (mono ? TH.ink : TH.warn)) : jumpCasing(hot);
      const cw = mono ? .46 : (style === 'forced' ? .34 : .36), kw = mono ? .24 : (style === 'forced' ? .13 : .15);
      for (let i = 1; i < pts.length; i++)
        pen.line(X(pts[i - 1][0]), pts[i - 1][1], X(pts[i][0]), pts[i][1], { stroke: casing, w: cw, alpha });
      const core = style === 'forced' ? (mono ? TH.board : (railCol(clsOf(ni)) || TH.board)) : jumpCore(ni);
      for (let i = 1; i < pts.length; i++)
        pen.line(X(pts[i - 1][0]), pts[i - 1][1], X(pts[i][0]), pts[i][1],
          { stroke: core, w: kw, alpha, dash: style === 'forced' ? [.32, .22] : null, cap: style === 'forced' ? 'butt' : 'round' });
      // 両端（穴に刺す所）に丸を付ける
      [pts[0], pts[pts.length - 1]].forEach(q => pen.circle(X(q[0]), q[1], .2, { fill: casing, alpha }));
    };
    if (result && result.routes) {
      // 1) 半田面すず線
      if (showBot) result.routes.forEach((rec, ni) => {
        const hot = hiNet != null && ni === hiNet;
        rec.segs.forEach(s => {
          if (s.l === 1) return;
          const col = hot ? TH.accent : (mono ? TH.ink : wireCol(ni, false));
          const glow = !mono && !hot && clsOf(ni) === 'gnd';
          seg(X(s.c1), s.r1, X(s.c2), s.r2, col, hot ? .3 : .24, hot ? 1 : aBot, glow);
        });
      });
      // 2) 被覆ジャンパ（半田面を這わせる絶縁電線）
      if (showBot) result.routes.forEach((rec, ni) => {
        const hot = hiNet != null && ni === hiNet;
        rec.jumpers.forEach(j => drawJumper(j.pts, ni, hot, hot ? 1 : aBot, 'forced'));
      });
      // 3) 部品面ジャンパ — 連続した線をまとめて被覆→芯の順に描く（継ぎ目が出ないように）
      if (showTop) result.routes.forEach((rec, ni) => {
        const hot = hiNet != null && ni === hiNet;
        const runs = [];
        rec.segs.forEach(s => {
          if (s.l !== 1) return;
          const last = runs[runs.length - 1];
          if (last) { const q = last[last.length - 1]; if (q[0] === s.c1 && q[1] === s.r1) { last.push([s.c2, s.r2]); return; } }
          runs.push([[s.c1, s.r1], [s.c2, s.r2]]);
        });
        runs.forEach(r => drawJumper(r, ni, hot, hot ? 1 : aTop, 'top'));
      });
      // 表裏渡しの穴
      result.routes.forEach((rec, ni) => {
        const hot = hiNet != null && ni === hiNet;
        rec.vias.forEach(v => pen.circle(X(v % cols), (v / cols) | 0, .42,
          { stroke: hot ? TH.accent : (mono ? TH.ink : TH.jump), w: .07, alpha: .8 }));
      });
    }
    if (strip && showTop) strip.jumpers.forEach(j => {
      const hot = hiNet != null && j.net === hiNet;
      drawJumper(j.pts, j.net, hot, hot ? 1 : aTop, 'top');
    });

    // 部品
    for (const c of prj.comps) {
      const sh = c.rots[((c.pos.rot / 90) | 0) & 3];
      const b = { x: c.pos.c + sh.body.x, y: c.pos.r + sh.body.y, w: sh.body.w, h: sh.body.h };
      const bx = mirror ? (cols - 1 - (b.x + b.w)) : b.x;
      const bb = { x: bx, y: b.y, w: b.w, h: b.h };
      // 組立手順で指している部品を囲んで目立たせる
      if (o.highlightComp != null && prj.comps[o.highlightComp] === c) {
        const xs = sh.pads.map(p => X(c.pos.c + p.c)), ys = sh.pads.map(p => c.pos.r + p.r);
        const x0 = Math.min(bb.x, ...xs) - .7, y0 = Math.min(bb.y, ...ys) - .7, x1 = Math.max(bb.x + bb.w, ...xs) + .7, y1 = Math.max(bb.y + bb.h, ...ys) + .7;
        pen.rect(x0, y0, x1 - x0, y1 - y0, { fill: TH.accent, alpha: .16, rx: .45 });
        pen.rect(x0, y0, x1 - x0, y1 - y0, { stroke: TH.accent, sw: .12, rx: .45 });
      }
      // リード線（本体からランドまで）
      sh.pads.forEach(p => {
        const px = X(c.pos.c + p.c), py = c.pos.r + p.r;
        const qx = Math.max(bb.x, Math.min(bb.x + bb.w, px)), qy = Math.max(bb.y, Math.min(bb.y + bb.h, py));
        if (Math.abs(qx - px) + Math.abs(qy - py) > .12)
          pen.line(px, py, qx, qy, { stroke: TH.ink, w: .085, alpha: aBody * .65 });
      });
      let notch = null;
      if (sh.body.shape === 'dip' && sh.pads.length >= 2) {
        const p1 = sh.pads[0], pn = sh.pads[sh.pads.length - 1];
        const mx = (X(c.pos.c + p1.c) + X(c.pos.c + pn.c)) / 2, my = c.pos.r + (p1.r + pn.r) / 2;
        const cxb = bb.x + bb.w / 2, cyb = bb.y + bb.h / 2, dx = mx - cxb, dy = my - cyb, P = Math.PI;
        notch = Math.abs(dx) > Math.abs(dy)
          ? (dx < 0 ? { x: bb.x, y: cyb, a0: -P / 2, a1: P / 2 } : { x: bb.x + bb.w, y: cyb, a0: P / 2, a1: 3 * P / 2 })
          : (dy < 0 ? { x: cxb, y: bb.y, a0: 0, a1: P } : { x: cxb, y: bb.y + bb.h, a0: P, a1: 2 * P });
      }
      bodyShape(pen, bb, sh.body.shape, TH.ink, aBody * .85, o.view === 'bottom' ? null : TH.surface2, notch, sh.rot, !!o.mirror);
      // 1番ピンマーク
      const p0 = sh.pads[0];
      pen.circle(X(c.pos.c + p0.c), c.pos.r + p0.r, .14, { fill: TH.ink, alpha: aBody * .75 });
      const padXY = pin => { const q = sh.pads.find(t => t.pin === pin); return q ? [X(c.pos.c + q.c), c.pos.r + q.r] : null; };
      const rowH = sh.pads.every(t => t.r === sh.pads[0].r);   // ピンが横一列
      const lbl = (x, y, t, sz) => pen.text(x, y, t, { size: sz || .36, fill: TH.ink, weight: 700, alpha: aBody, mono: true, halo: TH.board, haloW: .12 });
      // ダイオード / LED のカソード帯
      if (/^(D|ZD|LED|SBD)$/.test(c.type)) {
        const k = padXY(2), a = padXY(1);
        if (k && a) {
          const dx = Math.sign(k[0] - a[0]), dy = Math.sign(k[1] - a[1]);
          if (sh.body.shape !== 'circle') {
            const bxK = dx > 0 ? bb.x + bb.w - .22 : dx < 0 ? bb.x + .1 : null, byK = dy > 0 ? bb.y + bb.h - .22 : dy < 0 ? bb.y + .1 : null;
            if (bxK != null) pen.rect(bxK, bb.y, .12, bb.h, { fill: TH.ink, alpha: aBody });
            if (byK != null) pen.rect(bb.x, byK, bb.w, .12, { fill: TH.ink, alpha: aBody });
          }
          lbl(k[0] + (dx ? 0 : .5), k[1] + (dx ? .72 : .12), 'K');
        }
      }
      // 電解コンデンサの + 側
      if (c.type === 'CP') { const q = padXY(1); if (q) lbl(q[0] - .42, q[1] - .3, '+', .5); }
      // トランジスタ / FET のピン名
      if (/^(NPN|PNP|NJFET|PJFET|NMOS|PMOS|REG)$/.test(c.type)) {
        sh.pads.forEach(t => {
          const nm = String(c.pinNames[t.pin] || t.pin).slice(0, 3);
          const x = X(c.pos.c + t.c), y = c.pos.r + t.r;
          if (rowH) lbl(x, y + (bb.y + bb.h / 2 > y ? -.5 : .82), nm); else lbl(x + (bb.x + bb.w / 2 > x ? -.62 : .62), y + .12, nm);
        });
      }
      // コネクタ / 端子台のネット名
      if (c.edge && result && result.grid) {
        sh.pads.forEach(t => {
          const x = X(c.pos.c + t.c), y = c.pos.r + t.r, ni = result.grid.padNet[y * cols + (c.pos.c + t.c)];
          if (sh.body.shape === 'term') pen.circle(x, y, .55, { stroke: TH.ink, w: .07, alpha: aBody * .8 });
          const nm = ni >= 0 && prj.nets[ni] ? String(prj.nets[ni].name).replace(/^N\$/, '#') : '';
          if (!nm) return;
          const sz = .34;
          if (rowH) lbl(x, y + (bb.y + bb.h / 2 > y ? -.62 : .95), nm, sz);
          else pen.text(x + (bb.x + bb.w / 2 > x ? -.55 : .55), y + .12, nm, { size: sz, fill: TH.ink, weight: 700, alpha: aBody, mono: true, halo: TH.board, haloW: .12, anchor: bb.x + bb.w / 2 > x ? 'end' : 'start' });
        });
      }
      if (o.refs !== false) {
        const cxp = bx + b.w / 2, cyp = b.y + b.h / 2;
        const need = c.ref.length * .58;
        let size = Math.min(.66, b.w * .92 / Math.max(1, need), b.h * .8);
        if (size < .34) { // 本体に収まらない場合は真上に出す
          size = .5;
          pen.text(cxp, b.y - .22, c.ref, { size, fill: TH.ink, weight: 700, alpha: aBody, mono: true, halo: TH.board });
        } else {
          pen.text(cxp, cyp + size * .35, c.ref, { size, fill: TH.ink, weight: 700, alpha: aBody, mono: true, halo: TH.surface2 });
        }
      }
    }

    // 座標ラベル
    for (let c = 0; c < cols; c++)
      pen.text(X(c), -1.55, CB.colName(c), { size: .5, fill: TH['board-edge'], weight: 600, mono: true });
    for (let r = 0; r < rows; r++)
      pen.text(-1.6, r + .18, String(r + 1), { size: .5, fill: TH['board-edge'], weight: 600, anchor: 'end', mono: true });

    if (o.cursor) {
      const [hc, hr] = o.cursor;
      if (hc >= 0 && hr >= 0 && hc < cols && hr < rows)
        pen.circle(X(hc), hr, .5, { stroke: TH.accent, w: .1 });
    }
  }

  /* ---------- SVG 出力 ---------- */
  function schematicSVG(doc) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    doc.components.forEach(c => { const b = C1.compBBox(c); x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0 - 14); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1 + 14); });
    doc.wires.forEach(w => { x0 = Math.min(x0, w.x1, w.x2); y0 = Math.min(y0, w.y1, w.y2); x1 = Math.max(x1, w.x1, w.x2); y1 = Math.max(y1, w.y1, w.y2); });
    if (x0 > x1) { x0 = y0 = 0; x1 = y1 = 100; }
    const pad = 20, W = x1 - x0 + pad * 2, H = y1 - y0 + pad * 2;
    const out = [];
    const pen = SvgPen(out);
    const nets = C1.extractNets(doc), netOfWire = new Map();
    nets.forEach(n => (n.wires || []).forEach(id => netOfWire.set(id, n.index)));
    drawSchematic(pen, doc, { grid: false, view: { x0, y0, x1, y1 }, selection: new Set(), nets, netOfWire });
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(W * 1.6)}" height="${Math.round(H * 1.6)}" viewBox="${x0 - pad} ${y0 - pad} ${W} ${H}">` +
      `<rect x="${x0 - pad}" y="${y0 - pad}" width="${W}" height="${H}" fill="#ffffff"/>` + out.join('') + '</svg>';
  }
  function boardSVG(st, view, mono) {
    const out = [], pen = SvgPen(out);
    drawBoard(pen, st, { view: view || 'both', mirror: view === 'bottom', refs: true, mono: !!mono });
    const cols = st.board.cols, rows = st.board.rows;
    const x0 = -2.2, y0 = -2.2, W = cols + 3.4, H = rows + 3.4, s = 26;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(W * s)}" height="${Math.round(H * s)}" viewBox="${x0} ${y0} ${W} ${H}">` +
      `<rect x="${x0}" y="${y0}" width="${W}" height="${H}" fill="${TH.surface}"/>` + out.join('') + '</svg>';
  }

  global.CADRender = { readTheme, TH, CanvasPen, SvgPen, drawSchematic, drawBoard, drawSymbol, junctionDots, schematicSVG, boardSVG };
})(window);
