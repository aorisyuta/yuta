/* ---- pcbx.js ---- */
/* =====================================================================
   UniBoard SPICE — プリント基板 (PCB) 設計
   回路図から読み込み → 部品配置 → 手動 / 自動配線 (2層) → DRC → ガーバー出力
   座標系: mm、原点 = 基板左上、y は下向き (ガーバー出力時に反転)
   ===================================================================== */
(function () {
  'use strict';
  const UB = window.UniBoard, A = UB.api, C1 = window.CADCore, CB = window.CADBoard;
  const S = () => UB.state;
  const $ = id => document.getElementById(id);
  const el = A.el;
  const H = window.UBHooks = window.UBHooks || {};
  const toast = (t, l) => window.UBToast && window.UBToast(t, l);
  const IN = 2.54, GRID = IN / 8;

  /* ================= 状態 ================= */
  const PX = {
    active: false,
    board: { w: 60, h: 45, r: 1, holes: true, holeD: 3.2 },
    rules: { clear: 0.25, track: 0.3, power: 0.6, via: 0.8, viaDrill: 0.4, pourClear: 0.4, edge: 0.5 },
    comps: [], tracks: [], vias: [], nets: [], pour: { B: true, F: false, net: 'GND' },
    view: { x: 40, y: 40, z: 8 }, tool: 'sel', layer: 'F', sel: new Set(), mode: 'edit', flip: false,
    show: { F: true, B: true, silk: true, rats: true, pour: true },
    undo: [], redo: [], drc: null, route: null, hiNet: null, nextId: 1, imported: false, pourCache: null
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem('ubspice.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('ubspice.' + k, JSON.stringify(v)); } catch (e) { } }
  };

  /* ================= フットプリント ================= */
  const SMD2 = { '1005': [0.6, 0.6, 0.5], '1608': [0.9, 0.95, 0.8], '2012': [1.15, 1.4, 1.0], '3216': [1.6, 1.8, 1.5], '3528': [1.5, 2.4, 1.5] };
  function fpVariants(c) {
    const s = C1.symOf(c); if (!s || !s.fp) return [];
    const n = s.pins.length, fp = s.fp(c), out = [['tht', 'スルーホール (' + fpLabel(fp, n) + ')']];
    if (n === 2 && /^(R|C|CP|CNP|L|D|SBD|ZD|LED|F)$/.test(c.type)) out.push(['1608', 'SMD 1608 (0603)'], ['2012', 'SMD 2012 (0805)'], ['3216', 'SMD 3216 (1206)']);
    if (n === 3 && /^(NPN|PNP|NMOS|PMOS|NJFET|PJFET)$/.test(c.type)) out.push(['sot23', 'SMD SOT-23']);
    if (fp.kind === 'dip' && n >= 8) out.push(['soic', 'SMD SOIC-' + n]);
    return out;
  }
  function fpLabel(fp, n) { return fp.kind === 'dip' ? 'DIP-' + n : fp.kind === 'axial' ? 'アキシャル' : fp.kind === 'radial' ? 'ラジアル' : n + 'ピン'; }
  function makeFootprint(c) {
    const s = C1.symOf(c), fp = s.fp ? s.fp(c) : C1.fpInline(s.pins.length, 1);
    let v = (c.props && c.props.pcbfp) || (c.props && c.props.smd && SMD2[c.props.smd] && s.pins.length === 2 ? c.props.smd : 'tht');
    const names = s.pins.reduce((m, p) => (m[p.n] = p.name || String(p.n), m), {});
    const pads = [];
    let body;
    if (v !== 'tht' && SMD2[v] && fp.pads.length === 2) {
      const [w, h, hp] = SMD2[v];
      fp.pads.forEach((p, i) => pads.push({ num: p.pin, name: names[p.pin], x: i ? hp : -hp, y: 0, shape: 'rect', w, h, drill: 0, smd: true }));
      body = { x: -hp - w / 2 - 0.2, y: -h / 2 - 0.2, w: 2 * hp + w + 0.4, h: h + 0.4 };
    } else if (v === 'sot23' && fp.pads.length === 3) {
      const pos = [[-0.95, 1.1], [0.95, 1.1], [0, -1.1]];
      fp.pads.forEach((p, i) => pads.push({ num: p.pin, name: names[p.pin], x: pos[i][0], y: pos[i][1], shape: 'rect', w: 0.9, h: 0.8, drill: 0, smd: true }));
      body = { x: -1.5, y: -0.7, w: 3, h: 1.4 };
    } else if (v === 'soic' && fp.kind === 'dip') {
      const n = fp.pads.length, half = n / 2, pitch = 1.27, gap = 5.4;
      fp.pads.forEach(p => {
        const i = p.pin <= half ? p.pin - 1 : n - p.pin, bottom = p.pin <= half;
        pads.push({ num: p.pin, name: names[p.pin], x: (i - (half - 1) / 2) * pitch, y: bottom ? gap / 2 : -gap / 2, shape: 'rect', w: 0.6, h: 1.55, drill: 0, smd: true });
      });
      body = { x: -(half * pitch) / 2 - 0.2, y: -1.95, w: half * pitch + 0.4, h: 3.9 };
    } else {
      v = 'tht';
      const big = /to220|term/.test(fp.body.shape) || /^(TB\d*|DCJ|BR|RLY\d?|TRAFO|M|SPK)$/.test(c.type);
      const hdr = fp.body.shape === 'header';
      fp.pads.forEach((p, i) => pads.push({
        num: p.pin, name: names[p.pin], x: p.c * IN, y: p.r * IN,
        shape: i === 0 ? 'rect' : 'circle', w: big ? 2.2 : 1.7, h: big ? 2.2 : 1.7, drill: big ? 1.2 : hdr ? 1.0 : 0.9, smd: false
      }));
      body = { x: fp.body.x * IN, y: fp.body.y * IN, w: fp.body.w * IN, h: fp.body.h * IN, shape: fp.body.shape };
    }
    return { variant: v, pads, body };
  }

  /* ================= 回路図から読み込み ================= */
  function importFromSchematic(opts) {
    opts = opts || {};
    A.refreshNets();
    const doc = S().doc, nets = C1.extractNets(doc);
    const old = new Map(PX.comps.map(c => [c.id, c]));
    const comps = [];
    doc.components.forEach(c => {
      const s = C1.symOf(c); if (!s || s.virtual || s.simOnly || (c.props && c.props.offboard)) return;
      const f = makeFootprint(c), o = old.get(c.id);
      comps.push({ id: c.id, ref: c.ref, val: c.val || '', type: c.type, name: s.name, variant: f.variant, pads: f.pads, body: f.body,
        x: o ? o.x : NaN, y: o ? o.y : NaN, rot: o ? o.rot : 0, side: o ? o.side : 'top' });
    });
    const byId = new Map(comps.map((c, i) => [c.id, i]));
    const bnets = [];
    nets.forEach(n => {
      const pads = [];
      n.pins.forEach(p => {
        const ci = byId.get(p.comp.id); if (ci === undefined) return;
        comps[ci].pads.forEach((pd, pi) => { if (pd.num === p.pin.n) pads.push([ci, pi]); });
      });
      if (pads.length) bnets.push({ name: n.name, pads, cls: CB.netClass(n), power: !!n.rail });
    });
    comps.forEach(c => c.pads.forEach(p => p.net = -1));
    bnets.forEach((n, ni) => n.pads.forEach(([ci, pi]) => comps[ci].pads[pi].net = ni));
    // 既存の配線のネット番号を名前で付け直す
    const oldNames = PX.nets.map(n => n.name);
    const remap = t => { const nm = oldNames[t.net]; const k = bnets.findIndex(n => n.name === nm); t.net = k; };
    PX.tracks.forEach(remap); PX.vias.forEach(remap);
    PX.comps = comps; PX.nets = bnets; PX.imported = true; PX.pourCache = null;
    const missing = comps.filter(c => !isFinite(c.x));
    if (missing.length === comps.length || opts.place) autoPlace(true);
    else if (missing.length) {   // 新しい部品は基板の下に並べる
      let x = 3, y = PX.board.h + 6;
      missing.forEach(c => { const bb = compBBox(Object.assign({}, c, { x: 0, y: 0 })); c.x = x - bb.x0; c.y = y - bb.y0; x += bb.x1 - bb.x0 + 3; });
      toast(missing.length + ' 個の新しい部品を基板の下に置きました。基板内へ移動してください', 'ok');
    }
    PX.drc = null; save(); render(); panel();
  }

  /* ================= 自動配置 (蛇の目基板の配置エンジンを利用) ================= */
  function autoPlace(silent) {
    const doc = S().doc, nets = C1.extractNets(doc);
    const prj = CB.buildProject(doc, nets, { powerHeader: false });
    if (!prj.comps.length) { toast('基板に載せる部品がありません', 'err'); return; }
    const board = CB.autoBoardSize(prj, 'perf');
    board.type = 'perf';
    const placer = CB.makePlacer(prj, board, { seed: (Date.now() & 0xffff) || 7, crowdW: 4 });
    placer.finish();
    CB.compactBoard(prj, board, 2);
    pushUndo();
    const pos = new Map(prj.comps.map(c => [c.id, c])), mg = PX.board.holes ? 3 : 2;
    PX.comps.forEach(pc => {
      const q = pos.get(pc.id); if (!q) return;
      const k = ((q.pos.rot / 90) | 0) & 3, rp = q.rots[k].pads[0], p0 = q.fp.pads[0];
      const [lx, ly] = C1.rotXY(p0.c * IN, p0.r * IN, q.pos.rot);
      pc.rot = q.pos.rot; pc.side = 'top';
      pc.x = (q.pos.c + rp.c + mg) * IN - lx; pc.y = (q.pos.r + rp.r + mg) * IN - ly;
      // SMD 化した部品はパッド1の位置を穴位置に合わせる
      if (pc.variant !== 'tht') { pc.x = Math.round(pc.x / GRID) * GRID; pc.y = Math.round(pc.y / GRID) * GRID; }
    });
    PX.board.w = +((board.cols - 1 + 2 * mg) * IN).toFixed(2); PX.board.h = +((board.rows - 1 + 2 * mg) * IN).toFixed(2);
    PX.tracks = PX.tracks.filter(t => !t.auto); PX.pourCache = null; PX.drc = null;
    if (!silent) toast('部品を自動配置しました (' + PX.board.w + ' × ' + PX.board.h + ' mm)', 'ok');
    save(); fit(); render(); panel();
  }

  /* ================= 幾何 ================= */
  const rot = (x, y, r) => C1.rotXY(x, y, r);
  function padWorld(c, p) {
    let lx = p.x, ly = p.y;
    if (c.side === 'bottom') lx = -lx;
    const [dx, dy] = rot(lx, ly, c.rot);
    const sw = c.rot % 180 === 90;
    return { x: c.x + dx, y: c.y + dy, w: sw ? p.h : p.w, h: sw ? p.w : p.h, shape: p.shape, drill: p.drill, smd: p.smd,
      layers: p.smd ? [c.side === 'bottom' ? 'B' : 'F'] : ['F', 'B'], net: p.net, num: p.num, name: p.name };
  }
  function compBBox(c) {
    const b = c.body; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    const acc = (x, y) => { let lx = x; if (c.side === 'bottom') lx = -lx; const [a, bb] = rot(lx, y, c.rot); x0 = Math.min(x0, c.x + a); y0 = Math.min(y0, c.y + bb); x1 = Math.max(x1, c.x + a); y1 = Math.max(y1, c.y + bb); };
    acc(b.x, b.y); acc(b.x + b.w, b.y); acc(b.x + b.w, b.y + b.h); acc(b.x, b.y + b.h);
    c.pads.forEach(p => { acc(p.x - p.w / 2, p.y - p.h / 2); acc(p.x + p.w / 2, p.y + p.h / 2); });
    return { x0, y0, x1, y1 };
  }
  function segDist(ax, ay, bx, by, px, py) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  }
  function segSeg(a, b) {
    const [ax, ay, bx, by] = a, [cx, cy, dx, dy] = b;
    const cross = (x1, y1, x2, y2, x3, y3) => (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1);
    const d1 = cross(ax, ay, bx, by, cx, cy), d2 = cross(ax, ay, bx, by, dx, dy), d3 = cross(cx, cy, dx, dy, ax, ay), d4 = cross(cx, cy, dx, dy, bx, by);
    if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) && d1 && d2 && d3 && d4) return 0;
    return Math.min(segDist(ax, ay, bx, by, cx, cy), segDist(ax, ay, bx, by, dx, dy), segDist(cx, cy, dx, dy, ax, ay), segDist(cx, cy, dx, dy, bx, by));
  }
  // 銅箔アイテム: {kind:'seg', s:[ax,ay,bx,by], r} | {kind:'rect', x0,y0,x1,y1}
  function padGeom(pw) {
    if (pw.shape === 'rect') return { kind: 'rect', x0: pw.x - pw.w / 2, y0: pw.y - pw.h / 2, x1: pw.x + pw.w / 2, y1: pw.y + pw.h / 2, r: 0 };
    if (pw.shape === 'oval' && pw.w !== pw.h) {
      const r = Math.min(pw.w, pw.h) / 2, l = (Math.max(pw.w, pw.h) - 2 * r) / 2;
      return pw.w > pw.h ? { kind: 'seg', s: [pw.x - l, pw.y, pw.x + l, pw.y], r } : { kind: 'seg', s: [pw.x, pw.y - l, pw.x, pw.y + l], r };
    }
    return { kind: 'seg', s: [pw.x, pw.y, pw.x, pw.y], r: pw.w / 2 };
  }
  function geomDist(a, b) {
    if (a.kind === 'seg' && b.kind === 'seg') return segSeg(a.s, b.s) - a.r - b.r;
    if (a.kind === 'rect' && b.kind === 'rect') { const dx = Math.max(0, a.x0 - b.x1, b.x0 - a.x1), dy = Math.max(0, a.y0 - b.y1, b.y0 - a.y1); return Math.hypot(dx, dy); }
    const R = a.kind === 'rect' ? a : b, G = a.kind === 'rect' ? b : a;
    const [x1, y1, x2, y2] = G.s;
    const inside = (x, y) => x >= R.x0 && x <= R.x1 && y >= R.y0 && y <= R.y1;
    if (inside(x1, y1) || inside(x2, y2)) return -G.r;
    const E = [[R.x0, R.y0, R.x1, R.y0], [R.x1, R.y0, R.x1, R.y1], [R.x1, R.y1, R.x0, R.y1], [R.x0, R.y1, R.x0, R.y0]];
    return Math.min(...E.map(e => segSeg(G.s, e))) - G.r;
  }
  function pointGeom(g, x, y) {
    if (g.kind === 'seg') return segDist(g.s[0], g.s[1], g.s[2], g.s[3], x, y) - g.r;
    const dx = Math.max(g.x0 - x, 0, x - g.x1), dy = Math.max(g.y0 - y, 0, y - g.y1);
    if (dx === 0 && dy === 0) return -Math.min(x - g.x0, g.x1 - x, y - g.y0, g.y1 - y);
    return Math.hypot(dx, dy);
  }
  function copperItems() {
    const out = [];
    PX.comps.forEach((c, ci) => c.pads.forEach((p, pi) => { const pw = padWorld(c, p); out.push({ type: 'pad', ci, pi, layers: pw.layers, net: pw.net, g: padGeom(pw), pw }); }));
    PX.tracks.forEach(t => out.push({ type: 'track', t, layers: [t.layer], net: t.net, g: { kind: 'seg', s: [t.x1, t.y1, t.x2, t.y2], r: t.w / 2 } }));
    PX.vias.forEach(v => out.push({ type: 'via', v, layers: ['F', 'B'], net: v.net, g: { kind: 'seg', s: [v.x, v.y, v.x, v.y], r: v.d / 2 } }));
    out.forEach(it => { const g = it.g; it.bb = g.kind === 'rect' ? [g.x0, g.y0, g.x1, g.y1] : [Math.min(g.s[0], g.s[2]) - g.r, Math.min(g.s[1], g.s[3]) - g.r, Math.max(g.s[0], g.s[2]) + g.r, Math.max(g.s[1], g.s[3]) + g.r]; });
    return out;
  }
  const shareLayer = (a, b) => a.layers.some(l => b.layers.includes(l));
  const bbNear = (a, b, m) => !(a.bb[2] + m < b.bb[0] || b.bb[2] + m < a.bb[0] || a.bb[3] + m < b.bb[1] || b.bb[3] + m < a.bb[1]);

  /* ================= 接続性 / ラッツネスト ================= */
  function connectivity(items) {
    items = items || copperItems();
    const par = items.map((_, i) => i);
    const f = a => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (!shareLayer(a, b) || !bbNear(a, b, 0.01)) continue;
      if (geomDist(a.g, b.g) <= 0.001) par[f(i)] = f(j);
    }
    return { items, find: f };
  }
  function ratsnest(conn) {
    conn = conn || connectivity();
    const lines = []; let unrouted = 0;
    PX.nets.forEach((n, ni) => {
      const pads = conn.items.filter(it => it.type === 'pad' && it.net === ni);
      const groups = new Map();
      pads.forEach(p => { const r = conn.find(conn.items.indexOf(p)); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(p); });
      const gs = [...groups.values()];
      if (gs.length <= 1) return;
      unrouted += gs.length - 1;
      // グループ間の最小全域木
      const inT = [gs[0]], rest = gs.slice(1);
      while (rest.length) {
        let best = null;
        inT.forEach(g0 => g0.forEach(a => rest.forEach((g1, k) => g1.forEach(b => {
          const d = Math.hypot(a.pw.x - b.pw.x, a.pw.y - b.pw.y);
          if (!best || d < best.d) best = { d, a, b, k };
        }))));
        lines.push({ x1: best.a.pw.x, y1: best.a.pw.y, x2: best.b.pw.x, y2: best.b.pw.y, net: ni });
        inT.push(rest.splice(best.k, 1)[0]);
      }
    });
    return { lines, unrouted };
  }

  /* ================= DRC ================= */
  function runDRC() {
    const items = copperItems(), R = PX.rules, out = [];
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (a.net === b.net && a.net >= 0) continue;
      if (a.type === 'pad' && b.type === 'pad' && a.ci === b.ci && a.net < 0 && b.net < 0) continue;
      if (!shareLayer(a, b) || !bbNear(a, b, R.clear)) continue;
      const d = geomDist(a.g, b.g);
      if (d < R.clear - 1e-3) {
        const pa = midOf(a), pb = midOf(b);
        out.push({ lv: d <= 0 ? 'err' : 'warn', t: `${d <= 0 ? 'ショート' : 'クリアランス不足'} ${desc(a)} ↔ ${desc(b)} (${Math.max(0, d).toFixed(2)} mm < ${R.clear} mm)`, x: (pa[0] + pb[0]) / 2, y: (pa[1] + pb[1]) / 2 });
      }
    }
    const B = PX.board;
    items.forEach(it => {
      const [x0, y0, x1, y1] = it.bb;
      if (x0 < R.edge || y0 < R.edge || x1 > B.w - R.edge || y1 > B.h - R.edge) { const m = midOf(it); out.push({ lv: 'err', t: `${desc(it)} が基板の外形に近すぎる / はみ出しています`, x: m[0], y: m[1] }); }
    });
    if (PX.board.holes) holes().forEach(h => items.forEach(it => {
      if (pointGeom(it.g, h.x, h.y) < h.d / 2 + R.clear) { const m = midOf(it); out.push({ lv: 'err', t: `${desc(it)} が取付穴に重なっています`, x: m[0], y: m[1] }); }
    }));
    const rn = ratsnest(connectivity(items));
    if (rn.unrouted) out.push({ lv: 'warn', t: `未配線の接続が ${rn.unrouted} 本あります (細い線で表示)` });
    PX.tracks.forEach(t => { if (t.w < 0.15) out.push({ lv: 'warn', t: `配線幅 ${t.w} mm は細すぎます (0.15 mm 以上推奨)`, x: t.x1, y: t.y1 }); });
    PX.drc = { list: out, at: Date.now() };
    return out;
  }
  function midOf(it) { const g = it.g; return g.kind === 'rect' ? [(g.x0 + g.x1) / 2, (g.y0 + g.y1) / 2] : [(g.s[0] + g.s[2]) / 2, (g.s[1] + g.s[3]) / 2]; }
  function desc(it) {
    const nn = it.net >= 0 && PX.nets[it.net] ? PX.nets[it.net].name : '未接続';
    if (it.type === 'pad') { const c = PX.comps[it.ci]; return c.ref + '.' + (c.pads[it.pi].name || c.pads[it.pi].num) + ' [' + nn + ']'; }
    if (it.type === 'via') return 'ビア [' + nn + ']';
    return '配線 (' + (it.t.layer === 'F' ? '表' : '裏') + ') [' + nn + ']';
  }
  function holes() {
    const B = PX.board, m = 3.5;
    if (!B.holes || B.w < 20 || B.h < 20) return [];
    return [[m, m], [B.w - m, m], [m, B.h - m], [B.w - m, B.h - m]].map(([x, y]) => ({ x, y, d: B.holeD }));
  }

  /* ================= 自動配線 (2層 グリッド A*) ================= */
  function netWidth(ni) { const n = PX.nets[ni]; return n && (n.power || n.cls !== 'sig') ? PX.rules.power : PX.rules.track; }
  function autoRoute(opts) {
    opts = opts || {};
    const t0 = performance.now();
    const B = PX.board, R = PX.rules;
    const cols = Math.floor(B.w / GRID) + 1, rows = Math.floor(B.h / GRID) + 1, N = cols * rows;
    const wsig = R.track, inflBase = R.clear + wsig / 2;
    pushUndo();
    PX.tracks = PX.tracks.filter(t => !t.auto); PX.vias = PX.vias.filter(v => !v.auto);
    // 障害物グリッド: クラス (0=信号線, 1=電源線, 2=ビア) × 層
    const CLS = [R.track / 2, R.power / 2, R.via / 2];
    const OWN = CLS.map(() => [new Int32Array(N).fill(-1), new Int32Array(N).fill(-1)]);
    let owner = OWN[0];
    const LI = { F: 0, B: 1 };
    const px = i => i * GRID;
    const mark = (layer, g, net) => {
      const bb = g.kind === 'rect' ? [g.x0, g.y0, g.x1, g.y1] : [Math.min(g.s[0], g.s[2]) - g.r, Math.min(g.s[1], g.s[3]) - g.r, Math.max(g.s[0], g.s[2]) + g.r, Math.max(g.s[1], g.s[3]) + g.r];
      const inflMax = R.clear + Math.max(...CLS) + 0.02;
      const i0 = Math.max(0, Math.floor((bb[0] - inflMax) / GRID)), i1 = Math.min(cols - 1, Math.ceil((bb[2] + inflMax) / GRID));
      const j0 = Math.max(0, Math.floor((bb[1] - inflMax) / GRID)), j1 = Math.min(rows - 1, Math.ceil((bb[3] + inflMax) / GRID));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const d = pointGeom(g, px(i), px(j)), k = j * cols + i;
        for (let c = 0; c < CLS.length; c++) {
          if (d < R.clear + CLS[c] + 0.02) { const o = OWN[c][layer], cur = o[k]; if (cur === -1) o[k] = net; else if (cur !== net) o[k] = -2; }
        }
      }
    };
    const markItem = it => it.layers.forEach(l => mark(LI[l], it.g, it.net < 0 ? -3 : it.net));
    // 外形・取付穴
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const x = px(i), y = px(j);
      CLS.forEach((hw, c) => { const m = R.edge + hw; if (x < m || y < m || x > B.w - m || y > B.h - m) { OWN[c][0][j * cols + i] = -2; OWN[c][1][j * cols + i] = -2; } });
    }
    holes().forEach(h => [0, 1].forEach(l => mark(l, { kind: 'seg', s: [h.x, h.y, h.x, h.y], r: h.d / 2 }, -2)));
    copperItems().forEach(it => markItem(it));
    const viaOK = (i, j, net) => { const k = j * cols + i, a = OWN[2][0][k], b = OWN[2][1][k]; return (a === -1 || a === net) && (b === -1 || b === net); };
    void inflBase;
    // ネットの順番: 短いものから (電源は後)
    const conn0 = connectivity();
    const order = PX.nets.map((n, ni) => {
      const ps = n.pads.map(([ci, pi]) => padWorld(PX.comps[ci], PX.comps[ci].pads[pi]));
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; ps.forEach(p => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
      // 美しい配線: GND → 電源 → 信号の順 (GND を最短で引く)。従来は電源を最後に
      const rank = PX.beauty === false ? (n.power ? 1000 : 0) : (n.cls === 'gnd' ? -2000 : n.power ? -1000 : 0);
      return { ni, len: (x1 - x0) + (y1 - y0) + rank };
    }).sort((a, b) => a.len - b.len).map(o => o.ni);
    if (PX.pour.B && !opts.noPourSkip) { const gi = PX.nets.findIndex(n => n.name === PX.pour.net); if (gi >= 0 && opts.skipPourNet) order.splice(order.indexOf(gi), 1); }
    void conn0;
    let fail = 0, done = 0;
    const heap = new MinHeap();
    const g = new Float32Array(2 * N), from = new Int32Array(2 * N), closed = new Uint8Array(2 * N);
    const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    for (const ni of order) {
      const net = PX.nets[ni]; if (net.pads.length < 2) continue;
      const w = netWidth(ni); owner = w > R.track + 1e-9 ? OWN[1] : OWN[0];
      // 未接続のパッドを 1 つずつつなぐ
      for (let guard = 0; guard < net.pads.length * 2; guard++) {
        const conn = connectivity(copperItems().filter(it => it.net === ni));
        const pads = conn.items.filter(it => it.type === 'pad');
        const groups = new Map(); pads.forEach(p => { const r = conn.find(conn.items.indexOf(p)); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(p); });
        if (groups.size <= 1) { done++; break; }
        const gl = [...groups.values()];
        // 最大のグループを始点に、最も近いグループを目標に
        gl.sort((a, b) => b.length - a.length);
        const srcRoot = conn.find(conn.items.indexOf(gl[0][0]));
        let srcItems = conn.items.filter((it, k) => conn.find(k) === srcRoot);
        // 美しい配線: 線の途中から枝分かれさせず、まだ線が 1 本以下のパッド (一筆書きの端) から引く
        const padDeg = it => PX.tracks.filter(t => t.net === ni && [[t.x1, t.y1], [t.x2, t.y2]].some(([x, y]) => Math.abs(x - it.pw.x) <= it.pw.w / 2 + 0.05 && Math.abs(y - it.pw.y) <= it.pw.h / 2 + 0.05)).length;
        if (PX.beauty !== false) {
          const ends = srcItems.filter(it => it.type === 'pad' && padDeg(it) < 2);
          if (ends.length) srcItems = ends;
        }
        let tgt = null, bd = 1e9;
        const srcPads = srcItems.filter(it => it.type === 'pad'); gl.slice(1).forEach(gp => gp.forEach(p => (srcPads.length ? srcPads : gl[0]).forEach(q => { const d = Math.hypot(p.pw.x - q.pw.x, p.pw.y - q.pw.y); if (d < bd) { bd = d; tgt = p; } })));
        const tgtRoot = conn.find(conn.items.indexOf(tgt));
        const tgtItems = conn.items.filter((it, k) => conn.find(k) === tgtRoot);
        // 始点・目標セル
        g.fill(Infinity); closed.fill(0); heap.clear();
        const isTgt = new Uint8Array(2 * N);
        const cellsOf = (it, fn) => {
          const bb = it.bb, i0 = Math.max(0, Math.floor(bb[0] / GRID)), i1 = Math.min(cols - 1, Math.ceil(bb[2] / GRID)), j0 = Math.max(0, Math.floor(bb[1] / GRID)), j1 = Math.min(rows - 1, Math.ceil(bb[3] / GRID));
          let any = false;
          for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (pointGeom(it.g, px(i), px(j)) <= -0.05) it.layers.forEach(l => { fn(LI[l] * N + j * cols + i); any = true; });
          if (!any) { const m = midOf(it), i = Math.round(m[0] / GRID), j = Math.round(m[1] / GRID); if (i >= 0 && j >= 0 && i < cols && j < rows) it.layers.forEach(l => fn(LI[l] * N + j * cols + i)); }
        };
        tgtItems.forEach(it => cellsOf(it, k => isTgt[k] = 1));
        const tx = tgt.pw.x / GRID, ty = tgt.pw.y / GRID;
        const hfun = k => { const c = k % N, i = c % cols, j = (c / cols) | 0; const dx = Math.abs(i - tx), dy = Math.abs(j - ty); return (Math.max(dx, dy) + 0.414 * Math.min(dx, dy)) * 0.99; };
        srcItems.forEach(it => cellsOf(it, k => { g[k] = 0; from[k] = -1; heap.push(k, hfun(k)); }));
        let found = -1, exp = 0;
        const viaCost = 12;
        while (heap.n) {
          const k = heap.pop(); if (closed[k]) continue; closed[k] = 1;
          if (isTgt[k]) { found = k; break; }
          if (++exp > 600000) break;
          const l = k >= N ? 1 : 0, c = k - l * N, i = c % cols, j = (c / cols) | 0;
          const pk = from[k], pdi = pk >= 0 ? i - ((pk % N) % cols) : 0, pdj = pk >= 0 ? j - (((pk % N) / cols) | 0) : 0;
          for (const [di, dj, cost] of DIRS) {
            const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= cols || b >= rows) continue;
            const nk = l * N + b * cols + a; if (closed[nk]) continue;
            const o = owner[l][b * cols + a];
            if (!isTgt[nk] && o !== -1 && o !== ni) continue;
            // 斜め移動は角を削らない
            if (di && dj) { const o1 = owner[l][j * cols + a], o2 = owner[l][b * cols + i]; if ((o1 !== -1 && o1 !== ni) || (o2 !== -1 && o2 !== ni)) continue; }
            let ng = g[k] + cost + ((pdi !== di || pdj !== dj) && pk >= 0 ? 0.4 : 0) + (l === 1 ? 0 : 0.05);
            if (ng < g[nk]) { g[nk] = ng; from[nk] = k; heap.push(nk, ng + hfun(nk)); }
          }
          // 層の切替 (ビア)
          const ol = 1 - l, nk = ol * N + c;
          if (!closed[nk]) {
            const o = owner[ol][c];
            if ((o === -1 || o === ni) && viaOK(i, j, ni)) {
              const ng = g[k] + viaCost; if (ng < g[nk]) { g[nk] = ng; from[nk] = k; heap.push(nk, ng + hfun(nk)); }
            }
          }
        }
        if (found < 0) { fail++; break; }
        // 経路 → 配線
        const path = []; for (let k = found; k >= 0; k = from[k]) path.push(k);
        path.reverse();
        const pts = path.map(k => { const l = k >= N ? 1 : 0, c = k - l * N; return { l, x: px(c % cols), y: px((c / cols) | 0) }; });
        const segs = [];
        let s0 = pts[0];
        for (let q = 1; q < pts.length; q++) {
          const a = pts[q - 1], b = pts[q];
          if (b.l !== a.l) {
            if (a !== s0) segs.push({ layer: s0.l, x1: s0.x, y1: s0.y, x2: a.x, y2: a.y });
            PX.vias.push({ id: 'v' + PX.nextId++, x: a.x, y: a.y, d: R.via, drill: R.viaDrill, net: ni, auto: true });
            s0 = b; continue;
          }
          const nx = pts[q + 1];
          const straight = nx && nx.l === b.l && (nx.x - b.x) * (b.y - a.y) === (nx.y - b.y) * (b.x - a.x) && Math.sign(nx.x - b.x) === Math.sign(b.x - a.x) && Math.sign(nx.y - b.y) === Math.sign(b.y - a.y);
          if (!straight) { segs.push({ layer: b.l, x1: s0.x, y1: s0.y, x2: b.x, y2: b.y }); s0 = b; }
        }
        segs.forEach(sg => { if (sg.x1 === sg.x2 && sg.y1 === sg.y2) return; PX.tracks.push({ id: 't' + PX.nextId++, layer: sg.layer ? 'B' : 'F', x1: +sg.x1.toFixed(4), y1: +sg.y1.toFixed(4), x2: +sg.x2.toFixed(4), y2: +sg.y2.toFixed(4), w, net: ni, auto: true }); });
        // 占有を更新
        segs.forEach(sg => mark(sg.layer, { kind: 'seg', s: [sg.x1, sg.y1, sg.x2, sg.y2], r: w / 2 }, ni));
        PX.vias.filter(v => v.net === ni).forEach(v => [0, 1].forEach(l => mark(l, { kind: 'seg', s: [v.x, v.y, v.x, v.y], r: v.d / 2 }, ni)));
      }
    }
    PX.pourCache = null;
    const rn = ratsnest();
    PX.drc = null;
    save(); render(); panel();
    const ms = performance.now() - t0;
    if (rn.unrouted) toast(`自動配線: ${rn.unrouted} 本が未配線です (${ms.toFixed(0)} ms)。部品を離す・基板を広げる・手で配線してください`, 'err');
    else toast(`自動配線が完了しました (${ms.toFixed(0)} ms)`, 'ok');
    return rn.unrouted;
  }
  function MinHeap() { this.k = new Int32Array(4096); this.f = new Float64Array(4096); this.n = 0; }
  MinHeap.prototype.clear = function () { this.n = 0; };
  MinHeap.prototype.push = function (k, f) {
    if (this.n >= this.k.length) { const k2 = new Int32Array(this.k.length * 2), f2 = new Float64Array(this.k.length * 2); k2.set(this.k); f2.set(this.f); this.k = k2; this.f = f2; }
    let i = this.n++; while (i > 0) { const p = (i - 1) >> 1; if (this.f[p] <= f) break; this.k[i] = this.k[p]; this.f[i] = this.f[p]; i = p; }
    this.k[i] = k; this.f[i] = f;
  };
  MinHeap.prototype.pop = function () {
    const top = this.k[0], lk = this.k[--this.n], lf = this.f[this.n]; let i = 0;
    for (;;) { let c = 2 * i + 1; if (c >= this.n) break; if (c + 1 < this.n && this.f[c + 1] < this.f[c]) c++; if (this.f[c] >= lf) break; this.k[i] = this.k[c]; this.f[i] = this.f[c]; i = c; }
    this.k[i] = lk; this.f[i] = lf; return top;
  };

  /* ================= ベタ GND ================= */
  function pourFill(layer) {
    const key = layer + JSON.stringify([PX.board, PX.rules.pourClear, PX.pour.net, PX.tracks.length, PX.vias.length, PX.comps.map(c => [c.x, c.y, c.rot, c.side])]) + PX.tracks.map(t => t.x1 + t.y1 + t.x2 + t.y2).join();
    if (PX.pourCache && PX.pourCache[layer] && PX.pourCache[layer].key === key) return PX.pourCache[layer];
    const B = PX.board, R = PX.rules, gs = 0.25;
    const cols = Math.ceil(B.w / gs), rows = Math.ceil(B.h / gs);
    const cell = new Uint8Array(cols * rows);   // 1=塗れる 2=GND 接続
    const ni = PX.nets.findIndex(n => n.name === PX.pour.net);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const x = (i + 0.5) * gs, y = (j + 0.5) * gs;
      cell[j * cols + i] = x > R.edge + gs / 2 && y > R.edge + gs / 2 && x < B.w - R.edge - gs / 2 && y < B.h - R.edge - gs / 2 ? 1 : 0;
    }
    const clear = (g, infl) => {
      const bb = g.kind === 'rect' ? [g.x0, g.y0, g.x1, g.y1] : [Math.min(g.s[0], g.s[2]) - g.r, Math.min(g.s[1], g.s[3]) - g.r, Math.max(g.s[0], g.s[2]) + g.r, Math.max(g.s[1], g.s[3]) + g.r];
      const i0 = Math.max(0, Math.floor((bb[0] - infl) / gs) - 1), i1 = Math.min(cols - 1, Math.ceil((bb[2] + infl) / gs));
      const j0 = Math.max(0, Math.floor((bb[1] - infl) / gs) - 1), j1 = Math.min(rows - 1, Math.ceil((bb[3] + infl) / gs));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = (i + 0.5) * gs, y = (j + 0.5) * gs;
        if (pointGeom(g, x, y) < infl + gs * 0.71) cell[j * cols + i] = 0;
      }
    };
    const items = copperItems().filter(it => it.layers.includes(layer));
    items.forEach(it => { if (it.net !== ni || ni < 0) clear(it.g, R.pourClear); });
    holes().forEach(h => clear({ kind: 'seg', s: [h.x, h.y, h.x, h.y], r: h.d / 2 }, R.pourClear));
    // GND のパッド・配線に触れる所から塗りつぶし
    const q = [];
    if (ni >= 0) items.forEach(it => {
      if (it.net !== ni) return;
      const g = it.g, bb = it.bb;
      for (let j = Math.max(0, Math.floor(bb[1] / gs) - 1); j <= Math.min(rows - 1, Math.ceil(bb[3] / gs)); j++)
        for (let i = Math.max(0, Math.floor(bb[0] / gs) - 1); i <= Math.min(cols - 1, Math.ceil(bb[2] / gs)); i++) {
          const k = j * cols + i; if (cell[k] !== 1) continue;
          if (pointGeom(g, (i + 0.5) * gs, (j + 0.5) * gs) < gs * 1.2) { cell[k] = 2; q.push(k); }
        }
    });
    while (q.length) {
      const k = q.pop(), i = k % cols, j = (k / cols) | 0;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([a, b]) => { const x = i + a, y = j + b; if (x < 0 || y < 0 || x >= cols || y >= rows) return; const n = y * cols + x; if (cell[n] === 1) { cell[n] = 2; q.push(n); } });
    }
    // 矩形にまとめる (横方向の連続 → 同じ幅なら縦にもまとめる)
    const rects = [], open = new Map();
    for (let j = 0; j <= rows; j++) {
      const runs = [];
      if (j < rows) { let i = 0; while (i < cols) { if (cell[j * cols + i] === 2) { const s0 = i; while (i < cols && cell[j * cols + i] === 2) i++; runs.push(s0 + ',' + i); } else i++; } }
      const now = new Set(runs);
      for (const [k, r] of open) if (!now.has(k)) { rects.push(r); open.delete(k); }
      runs.forEach(k => { if (open.has(k)) open.get(k).h += gs; else { const [a, b] = k.split(',').map(Number); open.set(k, { x: a * gs, y: j * gs, w: (b - a) * gs, h: gs }); } });
    }
    const res = { key, rects, gs };
    PX.pourCache = PX.pourCache || {}; PX.pourCache[layer] = res;
    return res;
  }

  /* ================= 描画 ================= */
  const root = el('section', 'pcbx'); root.id = 'pcbx'; root.hidden = true;
  root.innerHTML = `
    <div class="px-bar" id="pxBar"></div>
    <div class="px-body">
      <div class="px-stage" id="pxStage"><canvas id="pxCv"></canvas><div class="hint" id="pxHint"></div>
        <div class="zoombox"><button class="btn" id="pxZo" title="縮小">−</button><button class="btn" id="pxZf" title="全体表示 (F)">全体</button><button class="btn" id="pxZi" title="拡大">＋</button></div>
        <div class="px-empty" id="pxEmpty" hidden></div>
      </div>
      <aside class="px-side" id="pxSide"></aside>
    </div>`;
  $('stage').parentNode.appendChild(root);
  const cv = $('pxCv'), ctx = cv.getContext('2d');
  let cw = 0, ch = 0;
  function resize() {
    const r = cv.getBoundingClientRect(), dpr = Math.min(2.5, window.devicePixelRatio || 1);
    cw = r.width; ch = r.height; cv.width = Math.max(1, Math.round(cw * dpr)); cv.height = Math.max(1, Math.round(ch * dpr));
    render();
  }
  new ResizeObserver(() => { if (PX.active) resize(); }).observe(cv);
  function fit() {
    const B = PX.board; let x0 = -2, y0 = -2, x1 = B.w + 2, y1 = B.h + 2;
    PX.comps.forEach(c => { if (!isFinite(c.x)) return; const b = compBBox(c); x0 = Math.min(x0, b.x0 - 2); y0 = Math.min(y0, b.y0 - 2); x1 = Math.max(x1, b.x1 + 2); y1 = Math.max(y1, b.y1 + 2); });
    const z = Math.min((cw - 60) / (x1 - x0), (ch - 60) / (y1 - y0));
    PX.view.z = Math.max(1, Math.min(80, z)); PX.view.x = cw / 2 - (x0 + x1) / 2 * PX.view.z; PX.view.y = ch / 2 - (y0 + y1) / 2 * PX.view.z;
    render();
  }
  const toW = (sx, sy) => { const v = PX.view; let x = (sx - v.x) / v.z; if (PX.flip) x = PX.board.w - x; return [x, (sy - v.y) / v.z]; };
  function theme() {
    const TH = window.CADRender.TH, dark = document.documentElement.getAttribute('data-theme') === 'dark' || (!document.documentElement.getAttribute('data-theme') && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    if (PX.mode === 'real') return { bg: dark ? '#0d1411' : '#e8ece9', board: '#1f6b3a', boardEdge: '#0f3d20', cuF: '#2a8a4c', cuB: '#185c33', pad: '#d9b25a', silk: '#f4f4ef', hole: '#101512', rats: '#ffffff', sel: '#ffd23f', text: TH.ink };
    return { bg: dark ? '#0f1417' : '#1a2126', board: dark ? '#172026' : '#222b31', boardEdge: '#e8c547', cuF: '#d9534f', cuB: '#3c8ce7', pad: '#c9a227', silk: '#e8e8e8', hole: '#0b0f12', rats: '#9fb4c3', sel: '#ffd23f', text: '#cfd8de' };
  }
  function render() {
    if (!PX.active) return;
    const dpr = Math.min(2.5, window.devicePixelRatio || 1), v = PX.view, T = theme(), B = PX.board;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = T.bg; ctx.fillRect(0, 0, cw, ch);
    $('pxEmpty').hidden = PX.comps.length > 0;
    ctx.save(); ctx.translate(v.x, v.y); ctx.scale(v.z, v.z);
    if (PX.flip) { ctx.translate(B.w, 0); ctx.scale(-1, 1); }
    const lw = 1 / v.z;
    // 基板
    rr(ctx, 0, 0, B.w, B.h, B.r); ctx.fillStyle = T.board; ctx.fill();
    ctx.lineWidth = PX.mode === 'real' ? 0.3 : 0.15; ctx.strokeStyle = T.boardEdge; ctx.stroke();
    // グリッド
    if (PX.mode !== 'real' && v.z > 5) {
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      const step = v.z > 14 ? IN / 2 : IN;
      for (let x = 0; x <= B.w; x += step) for (let y = 0; y <= B.h; y += step) ctx.fillRect(x - lw, y - lw, 2 * lw, 2 * lw);
    }
    const order = PX.mode === 'real' ? [PX.flip ? 'F' : 'B', PX.flip ? 'B' : 'F'].slice(1) : (PX.layer === 'F' ? ['B', 'F'] : ['F', 'B']);
    const hiN = PX.hiNet;
    // ベタ
    ['B', 'F'].forEach(L => {
      if (!PX.pour[L] || !PX.show.pour || !PX.show[L]) return;
      if (PX.mode === 'real' && L !== order[order.length - 1]) return;
      const pf = pourFill(L);
      ctx.fillStyle = PX.mode === 'real' ? T.cuF : hexA(L === 'F' ? T.cuF : T.cuB, 0.28);
      pf.rects.forEach(r => ctx.fillRect(r.x, r.y, r.w + 0.002, r.h + 0.002));
    });
    // 配線
    order.forEach(L => {
      if (!PX.show[L]) return;
      const col = PX.mode === 'real' ? T.cuF : (L === 'F' ? T.cuF : T.cuB);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      PX.tracks.forEach(t => {
        if (t.layer !== L) return;
        ctx.strokeStyle = PX.sel.has(t.id) ? T.sel : (hiN != null && t.net === hiN ? '#fff' : col);
        ctx.globalAlpha = PX.mode === 'real' ? 1 : (L === PX.layer ? 0.95 : 0.55);
        ctx.lineWidth = t.w; ctx.beginPath(); ctx.moveTo(t.x1, t.y1); ctx.lineTo(t.x2, t.y2); ctx.stroke();
      });
      ctx.globalAlpha = 1;
    });
    // 部品 (シルク + パッド)
    PX.comps.forEach(c => {
      if (!isFinite(c.x)) return;
      const sel = PX.sel.has(c.id);
      const visibleSide = PX.mode !== 'real' || (c.side === 'top') !== PX.flip;
      if (PX.show.silk && visibleSide) drawSilk(c, sel ? T.sel : (c.side === 'bottom' && PX.mode !== 'real' ? '#b58be0' : T.silk), lw);
      c.pads.forEach(p => {
        const pw = padWorld(c, p);
        if (PX.mode === 'real' && pw.smd && (pw.layers[0] === 'F') === PX.flip) return;
        const col = PX.mode === 'real' ? T.pad : (pw.smd ? (pw.layers[0] === 'F' ? T.cuF : T.cuB) : T.pad);
        ctx.fillStyle = hiN != null && pw.net === hiN ? '#fff' : col;
        padPath(pw); ctx.fill();
        if (pw.drill) { ctx.fillStyle = T.hole; ctx.beginPath(); ctx.arc(pw.x, pw.y, pw.drill / 2, 0, 7); ctx.fill(); }
        if (PX.mode !== 'real' && v.z > 9 && pw.net >= 0) {
          ctx.save(); if (PX.flip) { ctx.translate(pw.x, 0); ctx.scale(-1, 1); ctx.translate(-pw.x, 0); }
          ctx.fillStyle = 'rgba(0,0,0,.72)'; ctx.font = `600 ${Math.min(0.55, pw.w * 0.36)}px "IBM Plex Mono",monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          const nm = PX.nets[pw.net].name; ctx.fillText(nm.length > 6 ? nm.slice(0, 5) + '…' : nm, pw.x, pw.y + (pw.drill ? pw.drill / 2 + 0.3 : 0)); ctx.restore();
        }
      });
    });
    // ビア
    PX.vias.forEach(vv => {
      ctx.fillStyle = PX.sel.has(vv.id) ? T.sel : (PX.mode === 'real' ? T.pad : '#b9c2c9');
      ctx.beginPath(); ctx.arc(vv.x, vv.y, vv.d / 2, 0, 7); ctx.fill();
      ctx.fillStyle = T.hole; ctx.beginPath(); ctx.arc(vv.x, vv.y, vv.drill / 2, 0, 7); ctx.fill();
    });
    // 取付穴
    holes().forEach(h => { ctx.fillStyle = T.hole; ctx.beginPath(); ctx.arc(h.x, h.y, h.d / 2, 0, 7); ctx.fill(); ctx.strokeStyle = T.silk; ctx.lineWidth = 0.15; ctx.beginPath(); ctx.arc(h.x, h.y, h.d / 2 + 0.6, 0, 7); ctx.stroke(); });
    // ラッツネスト
    if (PX.show.rats && PX.mode !== 'real') {
      const rn = ratsnest();
      ctx.strokeStyle = T.rats; ctx.lineWidth = Math.max(0.06, lw * 1.1); ctx.setLineDash([0.6, 0.4]);
      rn.lines.forEach(l => { ctx.globalAlpha = hiN == null || l.net === hiN ? 0.9 : 0.25; ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke(); });
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      PX.unrouted = rn.unrouted;
    }
    // 配線中のプレビュー
    if (PX.route) {
      const r = PX.route, pts = routePreview();
      ctx.strokeStyle = PX.layer === 'F' ? T.cuF : T.cuB; ctx.globalAlpha = 0.7; ctx.lineCap = 'round'; ctx.lineWidth = r.w;
      ctx.beginPath(); ctx.moveTo(r.x, r.y); pts.forEach(p => ctx.lineTo(p[0], p[1])); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(r.cx, r.cy, 0.4, 0, 7); ctx.stroke();
    }
    // DRC マーカー
    if (PX.drc) PX.drc.list.forEach(m => { if (m.x == null) return; ctx.strokeStyle = m.lv === 'err' ? '#ff4d4f' : '#ffb020'; ctx.lineWidth = Math.max(0.12, 2 * lw); ctx.beginPath(); ctx.arc(m.x, m.y, 0.9, 0, 7); ctx.moveTo(m.x - 0.6, m.y - 0.6); ctx.lineTo(m.x + 0.6, m.y + 0.6); ctx.moveTo(m.x + 0.6, m.y - 0.6); ctx.lineTo(m.x - 0.6, m.y + 0.6); ctx.stroke(); });
    // 範囲選択
    if (PX.marq) { const m = PX.marq; ctx.fillStyle = 'rgba(91,140,255,.15)'; ctx.strokeStyle = '#5b8cff'; ctx.lineWidth = lw; ctx.fillRect(Math.min(m.x0, m.x1), Math.min(m.y0, m.y1), Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0)); ctx.strokeRect(Math.min(m.x0, m.x1), Math.min(m.y0, m.y1), Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0)); }
    ctx.restore();
    // 寸法
    ctx.fillStyle = T.text; ctx.font = '500 11px "IBM Plex Mono",monospace'; ctx.textAlign = 'left';
    ctx.fillText(`${B.w.toFixed(1)} × ${B.h.toFixed(1)} mm   ${PX.mode === 'real' ? (PX.flip ? '裏面' : '表面') + 'の仕上がり' : '配線層: ' + (PX.layer === 'F' ? '表 (F.Cu)' : '裏 (B.Cu)')}${PX.unrouted ? '   未配線 ' + PX.unrouted : ''}`, 10, ch - 10);
    hint();
  }
  function rr(g, x, y, w, h, r) { r = Math.min(r || 0, w / 2, h / 2); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function padPath(pw) {
    ctx.beginPath();
    if (pw.shape === 'rect') ctx.rect(pw.x - pw.w / 2, pw.y - pw.h / 2, pw.w, pw.h);
    else if (pw.shape === 'oval' && pw.w !== pw.h) rr(ctx, pw.x - pw.w / 2, pw.y - pw.h / 2, pw.w, pw.h, Math.min(pw.w, pw.h) / 2);
    else ctx.arc(pw.x, pw.y, pw.w / 2, 0, 7);
  }
  function silkLines(c) {   // 部品外形 (ローカル → ワールド) の線分リスト
    const b = c.body, L = [];
    const W = (x, y) => { let lx = x; if (c.side === 'bottom') lx = -lx; const [a, bb] = rot(lx, y, c.rot); return [c.x + a, c.y + bb]; };
    const box = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].map(p => W(p[0], p[1]));
    for (let i = 0; i < 4; i++) L.push([box[i], box[(i + 1) % 4]]);
    // 1 番ピン印
    const p1 = c.pads.find(p => p.num === 1) || c.pads[0];
    if (p1 && c.pads.length > 2) { const q = W(p1.x - (p1.w / 2 + 0.5) * (p1.x <= b.x + b.w / 2 ? 1 : -1), p1.y); L.push([q, [q[0] + 0.01, q[1]]]); }
    return L;
  }
  function drawSilk(c, col, lw) {
    ctx.strokeStyle = col; ctx.lineWidth = 0.15; ctx.lineCap = 'round';
    silkLines(c).forEach(([a, b]) => { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); });
    const bb = compBBox(c);
    strokeText(ctx, c.ref, (bb.x0 + bb.x1) / 2, bb.y0 - 0.5, 1.0, c.side === 'bottom');
    void lw;
  }
  function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; }

  /* ---- 線画フォント (シルク・ガーバー共通) ---- */
  const GLYPH = {
    '0': '0,1 1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1|0,5 4,1', '1': '1,1 2,0 2,6|1,6 3,6', '2': '0,1 1,0 3,0 4,1 4,2 0,6 4,6', '3': '0,0 4,0 2,2 3,2 4,3 4,5 3,6 1,6 0,5',
    '4': '3,6 3,0 0,4 4,4', '5': '4,0 0,0 0,2 3,2 4,3 4,5 3,6 0,6', '6': '3,0 1,0 0,1 0,5 1,6 3,6 4,5 4,3 3,2 0,2', '7': '0,0 4,0 1,6',
    '8': '1,3 0,2 0,1 1,0 3,0 4,1 4,2 3,3 1,3 0,4 0,5 1,6 3,6 4,5 4,4 3,3', '9': '4,4 1,4 0,3 0,1 1,0 3,0 4,1 4,5 3,6 1,6',
    A: '0,6 0,2 2,0 4,2 4,6|0,3 4,3', B: '0,0 0,6 3,6 4,5 4,4 3,3 0,3|0,0 3,0 4,1 4,2 3,3', C: '4,1 3,0 1,0 0,1 0,5 1,6 3,6 4,5', D: '0,0 0,6 2,6 4,4 4,2 2,0 0,0',
    E: '4,0 0,0 0,6 4,6|0,3 3,3', F: '4,0 0,0 0,6|0,3 3,3', G: '4,1 3,0 1,0 0,1 0,5 1,6 3,6 4,5 4,3 2,3', H: '0,0 0,6|4,0 4,6|0,3 4,3', I: '1,0 3,0|2,0 2,6|1,6 3,6',
    J: '4,0 4,5 3,6 1,6 0,5', K: '0,0 0,6|4,0 0,4|1,3 4,6', L: '0,0 0,6 4,6', M: '0,6 0,0 2,3 4,0 4,6', N: '0,6 0,0 4,6 4,0', O: '1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0',
    P: '0,6 0,0 3,0 4,1 4,2 3,3 0,3', Q: '1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0|2,4 4,6', R: '0,6 0,0 3,0 4,1 4,2 3,3 0,3|2,3 4,6', S: '4,1 3,0 1,0 0,1 0,2 1,3 3,3 4,4 4,5 3,6 1,6 0,5',
    T: '0,0 4,0|2,0 2,6', U: '0,0 0,5 1,6 3,6 4,5 4,0', V: '0,0 2,6 4,0', W: '0,0 1,6 2,3 3,6 4,0', X: '0,0 4,6|4,0 0,6', Y: '0,0 2,3 4,0|2,3 2,6', Z: '0,0 4,0 0,6 4,6',
    '-': '1,3 3,3', '+': '1,3 3,3|2,2 2,4', '.': '2,5.6 2,6', '/': '0,6 4,0', '_': '0,6 4,6', '(': '3,0 2,1 2,5 3,6', ')': '1,0 2,1 2,5 1,6', '#': '1,1 1,5|3,1 3,5|0,2 4,2|0,4 4,4', ':': '2,2 2,2.4|2,5 2,5.4', '=': '0,2 4,2|0,4 4,4', '*': '0,1 4,5|4,1 0,5|2,0 2,6', '%': '0,6 4,0|0,0 1,1|3,5 4,6', '<': '4,0 0,3 4,6', '>': '0,0 4,3 0,6', ',': '2,5 1.5,6.5', "'": '2,0 2,1.5', '!': '2,0 2,4|2,5.6 2,6', '?': '0,1 1,0 3,0 4,1 4,2 2,3 2,4|2,5.6 2,6', '~': '0,3 1,2 3,4 4,3'
  };
  const GL = {}; Object.entries(GLYPH).forEach(([k, s]) => GL[k] = s.split('|').map(st => st.split(' ').map(p => p.split(',').map(Number))));
  function textStrokes(t, x, y, h, mirror) {   // 中央下揃え。戻り値: [[x,y],...] のリスト
    t = String(t).toUpperCase().replace(/[ΜΜ]/g, 'U').replace(/[^\x20-\x7e]/g, '');
    const u = h / 6, adv = 6 * u, w0 = t.length * adv - 2 * u, out = [];
    [...t].forEach((ch, i) => {
      const gph = GL[ch]; if (!gph) return;
      const ox = x - w0 / 2 + i * adv;
      gph.forEach(st => out.push(st.map(([a, b]) => { let px2 = ox + a * u; if (mirror) px2 = 2 * x - px2; return [px2, y - h + b * u]; })));
    });
    return out;
  }
  function strokeText(g, t, x, y, h, mirror) {
    if (PX.flip) mirror = !mirror;
    g.lineWidth = h * 0.13; g.lineCap = 'round'; g.lineJoin = 'round';
    textStrokes(t, x, y, h, mirror).forEach(st => { g.beginPath(); st.forEach(([a, b], i) => i ? g.lineTo(a, b) : g.moveTo(a, b)); if (st.length === 1) g.lineTo(st[0][0] + 0.01, st[0][1]); g.stroke(); });
  }

  /* ================= 操作 ================= */
  let ptrs = new Map(), drag = null, pan = null, pinch = null;
  const snapG = v => Math.round(v / (IN / 4)) * (IN / 4);
  const snapR = v => Math.round(v / (GRID)) * GRID;
  function hitComp(x, y) {
    for (let i = PX.comps.length - 1; i >= 0; i--) { const c = PX.comps[i]; if (!isFinite(c.x)) continue; const b = compBBox(c); if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return c; }
    return null;
  }
  function hitCopper(x, y, layerPref) {
    const items = copperItems(); let best = null, bd = 1e9;
    items.forEach(it => {
      const d = pointGeom(it.g, x, y) - 0.15;
      const pen = layerPref && !it.layers.includes(layerPref) ? 0.3 : 0;
      if (d <= 0.2 && d + pen < bd) { bd = d + pen; best = it; }
    });
    return best;
  }
  function routePreview() {
    const r = PX.route; if (!r) return [];
    const dx = r.cx - r.x, dy = r.cy - r.y;
    if (!dx || !dy || Math.abs(Math.abs(dx) - Math.abs(dy)) < 1e-6) return [[r.cx, r.cy]];
    // 45° を先に、残りを直線
    const d = Math.min(Math.abs(dx), Math.abs(dy));
    const mx = r.x + Math.sign(dx) * d, my = r.y + Math.sign(dy) * d;
    return r.diagFirst ? [[mx, my], [r.cx, r.cy]] : [[r.cx - Math.sign(dx) * d, r.cy - Math.sign(dy) * d], [r.cx, r.cy]];
  }
  function commitRoute(finish) {
    const r = PX.route; if (!r) return;
    const pts = routePreview(); let px0 = r.x, py0 = r.y;
    pts.forEach(([x, y]) => { if (Math.hypot(x - px0, y - py0) > 1e-6) PX.tracks.push({ id: 't' + PX.nextId++, layer: PX.layer, x1: px0, y1: py0, x2: x, y2: y, w: r.w, net: r.net }); px0 = x; py0 = y; });
    r.x = px0; r.y = py0; PX.pourCache = null;
    if (finish) PX.route = null;
    save(); render();
  }
  cv.addEventListener('pointerdown', e => {
    const rct = cv.getBoundingClientRect(), sx = e.clientX - rct.left, sy = e.clientY - rct.top;
    try { cv.setPointerCapture(e.pointerId); } catch (er) { }
    ptrs.set(e.pointerId, [sx, sy]);
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: PX.view.z, x: PX.view.x, y: PX.view.y, mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2 }; drag = null; pan = null; return; }
    const [x, y] = toW(sx, sy);
    if (e.button === 1 || e.button === 2 || e.altKey) { pan = { sx, sy, vx: PX.view.x, vy: PX.view.y, moved: true }; return; }
    if (PX.tool === 'route') {
      if (!PX.route) {
        const it = hitCopper(x, y, PX.layer);
        if (!it) { toast('パッドか配線の上から始めてください', 'err'); return; }
        const m = it.type === 'pad' ? [it.pw.x, it.pw.y] : it.type === 'via' ? [it.v.x, it.v.y] : nearestOnSeg(it.t, x, y);
        if (it.type === 'pad' && it.pw.smd) PX.layer = it.pw.layers[0];
        pushUndo();
        PX.route = { x: m[0], y: m[1], cx: m[0], cy: m[1], net: it.net, w: netWidth(it.net), diagFirst: false };
        bar(); render(); return;
      }
      const it = hitCopper(x, y, PX.layer);
      if (it && it.net === PX.route.net && it.net >= 0 && (it.layers.includes(PX.layer))) {
        const m = it.type === 'pad' ? [it.pw.x, it.pw.y] : it.type === 'via' ? [it.v.x, it.v.y] : [PX.route.cx, PX.route.cy];
        PX.route.cx = m[0]; PX.route.cy = m[1]; commitRoute(true); toast('配線しました', 'ok'); panel(); return;
      }
      commitRoute(false); return;
    }
    if (PX.tool === 'via') {
      const it = hitCopper(x, y);
      pushUndo(); PX.vias.push({ id: 'v' + PX.nextId++, x: snapR(x), y: snapR(y), d: PX.rules.via, drill: PX.rules.viaDrill, net: it ? it.net : -1 });
      PX.pourCache = null; save(); render(); return;
    }
    if (PX.tool === 'del') {
      const it = hitCopper(x, y, PX.layer);
      if (it && it.type === 'track') { pushUndo(); PX.tracks = PX.tracks.filter(t => t !== it.t); }
      else if (it && it.type === 'via') { pushUndo(); PX.vias = PX.vias.filter(v => v !== it.v); }
      PX.pourCache = null; save(); render(); panel(); return;
    }
    // 選択・移動
    const c = hitComp(x, y);
    const it = !c && hitCopper(x, y, PX.layer);
    if (c) {
      if (!PX.sel.has(c.id)) { if (!e.shiftKey) PX.sel.clear(); PX.sel.add(c.id); }
      drag = { x0: x, y0: y, moved: false, items: PX.comps.filter(q => PX.sel.has(q.id)).map(q => ({ q, x: q.x, y: q.y })) };
      PX.hiNet = null; panel(); render(); return;
    }
    if (it && (it.type === 'track' || it.type === 'via')) {
      const id = it.type === 'track' ? it.t.id : it.v.id; if (!e.shiftKey) PX.sel.clear(); PX.sel.add(id); PX.hiNet = it.net; panel(); render(); return;
    }
    if (e.shiftKey) { PX.marq = { x0: x, y0: y, x1: x, y1: y }; return; }
    PX.sel.clear(); PX.hiNet = null;
    pan = { sx, sy, vx: PX.view.x, vy: PX.view.y, moved: false };
    panel(); render();
  });
  function nearestOnSeg(t, x, y) {
    const dx = t.x2 - t.x1, dy = t.y2 - t.y1, l2 = dx * dx + dy * dy; let u = l2 ? ((x - t.x1) * dx + (y - t.y1) * dy) / l2 : 0; u = Math.max(0, Math.min(1, u));
    return [t.x1 + u * dx, t.y1 + u * dy];
  }
  cv.addEventListener('pointermove', e => {
    const rct = cv.getBoundingClientRect(), sx = e.clientX - rct.left, sy = e.clientY - rct.top;
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, [sx, sy]);
    if (pinch && ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), k = d / pinch.d;
      const z = Math.max(1, Math.min(120, pinch.z * k)), kk = z / pinch.z;
      PX.view.z = z; PX.view.x = (a[0] + b[0]) / 2 - (pinch.mx - pinch.x) * kk; PX.view.y = (a[1] + b[1]) / 2 - (pinch.my - pinch.y) * kk; render(); return;
    }
    const [x, y] = toW(sx, sy);
    PX.cursor = [x, y];
    if (PX.route) { PX.route.cx = snapR(x); PX.route.cy = snapR(y); render(); return; }
    if (drag) {
      const dx = snapG(x - drag.x0), dy = snapG(y - drag.y0);
      if (dx || dy || drag.moved) {
        if (!drag.moved) { pushUndo(); drag.moved = true; }
        drag.items.forEach(o => { o.q.x = o.x + dx; o.q.y = o.y + dy; });
        PX.pourCache = null; render();
      }
      return;
    }
    if (PX.marq) { PX.marq.x1 = x; PX.marq.y1 = y; render(); return; }
    if (pan) { if (Math.abs(sx - pan.sx) + Math.abs(sy - pan.sy) > 3) pan.moved = true; PX.view.x = pan.vx + sx - pan.sx; PX.view.y = pan.vy + sy - pan.sy; render(); }
  });
  const endP = e => {
    ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null;
    if (PX.marq) {
      const m = PX.marq, x0 = Math.min(m.x0, m.x1), x1 = Math.max(m.x0, m.x1), y0 = Math.min(m.y0, m.y1), y1 = Math.max(m.y0, m.y1);
      PX.comps.forEach(c => { const b = compBBox(c); if (!(b.x1 < x0 || b.x0 > x1 || b.y1 < y0 || b.y0 > y1)) PX.sel.add(c.id); });
      PX.tracks.forEach(t => { if (Math.max(t.x1, t.x2) >= x0 && Math.min(t.x1, t.x2) <= x1 && Math.max(t.y1, t.y2) >= y0 && Math.min(t.y1, t.y2) <= y1) PX.sel.add(t.id); });
      PX.marq = null; panel(); render();
    }
    if (drag && drag.moved) save();
    drag = null; pan = null;
  };
  cv.addEventListener('pointerup', endP); cv.addEventListener('pointercancel', endP);
  cv.addEventListener('dblclick', () => { if (PX.route) { commitRoute(true); panel(); } });
  cv.addEventListener('contextmenu', e => { e.preventDefault(); if (PX.route) { PX.route = null; render(); } });
  cv.addEventListener('wheel', e => {
    e.preventDefault(); const rct = cv.getBoundingClientRect(), sx = e.clientX - rct.left, sy = e.clientY - rct.top, v = PX.view;
    const k = Math.pow(0.998, e.deltaY), z = Math.max(1, Math.min(120, v.z * k)), kk = z / v.z;
    v.x = sx - (sx - v.x) * kk; v.y = sy - (sy - v.y) * kk; v.z = z; render();
  }, { passive: false });

  function rotateSel() {
    const cs = PX.comps.filter(c => PX.sel.has(c.id)); if (!cs.length) return;
    pushUndo(); cs.forEach(c => { c.rot = (c.rot + 90) % 360; }); PX.pourCache = null; save(); render(); panel();
  }
  function flipSel() {
    const cs = PX.comps.filter(c => PX.sel.has(c.id)); if (!cs.length) return;
    pushUndo(); cs.forEach(c => { c.side = c.side === 'top' ? 'bottom' : 'top'; }); PX.pourCache = null; save(); render(); panel();
  }
  function deleteSel() {
    if (!PX.sel.size) return;
    const tr = PX.tracks.some(t => PX.sel.has(t.id)) || PX.vias.some(v => PX.sel.has(v.id));
    if (!tr) { toast('部品は回路図から削除してください (ここでは配線・ビアを削除できます)', 'err'); return; }
    pushUndo(); PX.tracks = PX.tracks.filter(t => !PX.sel.has(t.id)); PX.vias = PX.vias.filter(v => !PX.sel.has(v.id)); PX.sel.clear(); PX.pourCache = null; save(); render(); panel();
  }
  H.keyCapture = e => {
    if (!PX.active) return false;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return true; }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return true; }
    if (k === 'escape') { if (PX.route) { PX.route = null; } else { PX.sel.clear(); setTool('sel'); } render(); panel(); return true; }
    if (k === 'r') { rotateSel(); return true; }
    if (k === 'f') { if (PX.sel.size && !e.shiftKey) flipSel(); else fit(); return true; }
    if (k === 'x' || (k === 'v' && PX.route)) { switchLayer(); return true; }
    if (k === 'v') { setTool('sel'); return true; }
    if (k === 'delete' || k === 'backspace') { deleteSel(); return true; }
    if (k === 'w') { setTool('route'); return true; }
    if (k === '/') { if (PX.route) { PX.route.diagFirst = !PX.route.diagFirst; render(); } return true; }
    if (k === 'enter' && PX.route) { commitRoute(true); panel(); return true; }
    return true;
  };
  function switchLayer() {
    const r = PX.route;
    if (r) {
      commitRoute(false);
      PX.vias.push({ id: 'v' + PX.nextId++, x: r.x, y: r.y, d: PX.rules.via, drill: PX.rules.viaDrill, net: r.net });
    }
    PX.layer = PX.layer === 'F' ? 'B' : 'F'; bar(); render();
  }

  /* ================= Undo ================= */
  const snap = () => JSON.stringify({ comps: PX.comps.map(c => [c.id, c.x, c.y, c.rot, c.side]), tracks: PX.tracks, vias: PX.vias, board: PX.board });
  function pushUndo() { PX.undo.push(snap()); if (PX.undo.length > 60) PX.undo.shift(); PX.redo.length = 0; }
  function restore(s) {
    const o = JSON.parse(s); const m = new Map(o.comps.map(a => [a[0], a]));
    PX.comps.forEach(c => { const a = m.get(c.id); if (a) { c.x = a[1]; c.y = a[2]; c.rot = a[3]; c.side = a[4]; } });
    PX.tracks = o.tracks; PX.vias = o.vias; PX.board = o.board; PX.pourCache = null; PX.drc = null; save(); render(); panel();
  }
  function undo() { if (!PX.undo.length) return; PX.redo.push(snap()); restore(PX.undo.pop()); }
  function redo() { if (!PX.redo.length) return; PX.undo.push(snap()); restore(PX.redo.pop()); }

  /* ================= 保存 ================= */
  function serialize() {
    return { v: 1, board: PX.board, rules: PX.rules, pour: PX.pour, nextId: PX.nextId,
      comps: PX.comps.map(c => ({ id: c.id, x: c.x, y: c.y, rot: c.rot, side: c.side })), tracks: PX.tracks, vias: PX.vias, nets: PX.nets.map(n => n.name) };
  }
  let saveT = null;
  function save() { clearTimeout(saveT); saveT = setTimeout(() => store.set('pcb', serialize()), 400); }
  function load(o) {
    if (!o || !o.board) return;
    Object.assign(PX.board, o.board); Object.assign(PX.rules, o.rules || {}); Object.assign(PX.pour, o.pour || {}); PX.nextId = o.nextId || 1;
    PX.tracks = o.tracks || []; PX.vias = o.vias || [];
    PX._pending = { comps: o.comps || [], nets: o.nets || [] };
  }
  function applyPending() {
    const p = PX._pending; if (!p) return false;
    PX._pending = null;
    PX.comps = p.comps.map(c => Object.assign({ pads: [] }, c));
    PX.nets = p.nets.map(name => ({ name }));
    importFromSchematic({ keep: true });
    return true;
  }

  /* ================= ツールバー / サイドパネル ================= */
  function setTool(t) { PX.tool = t; if (t !== 'route') PX.route = null; bar(); render(); }
  function bar() {
    const b = $('pxBar'); b.innerHTML = '';
    const grp = () => { const g = el('div', 'toolgroup'); b.appendChild(g); return g; };
    const btn = (g, label, fn, o) => { o = o || {}; const x = el('button', 'btn' + (o.cls ? ' ' + o.cls : ''), label); x.type = 'button'; if (o.title) x.title = o.title; if (o.pressed != null) x.setAttribute('aria-pressed', String(o.pressed)); x.onclick = fn; g.appendChild(x); return x; };
    let g = grp();
    btn(g, '回路図から更新', () => importFromSchematic(), { title: '回路図の部品・接続を読み込み直します (配置と配線は残ります)' });
    btn(g, '自動配置', () => autoPlace(), { title: '部品をまとめて配置し直します' });
    btn(g, '自動配線', () => autoRoute(), { cls: 'primary', title: '2層で自動配線します' });
    btn(g, '配線クリア', () => { pushUndo(); PX.tracks = []; PX.vias = []; PX.pourCache = null; save(); render(); panel(); }, { title: 'すべての配線とビアを消します' });
    g = grp();
    [['sel', '選択・移動', 'V'], ['route', '配線', 'W'], ['via', 'ビア', ''], ['del', '消しゴム', '']].forEach(([k, l, key]) => btn(g, l, () => setTool(k), { pressed: PX.tool === k, title: l + (key ? ' (' + key + ')' : '') }));
    g = grp();
    const lb = btn(g, PX.layer === 'F' ? '表 F.Cu' : '裏 B.Cu', () => switchLayer(), { title: '配線する層を切替 (X)。配線中はビアを置いて切替えます' });
    lb.classList.add(PX.layer === 'F' ? 'lyF' : 'lyB');
    btn(g, '回転', rotateSel, { title: '選択部品を回転 (R)' }); btn(g, '裏返す', flipSel, { title: '選択部品を裏面へ (F)' });
    g = grp();
    btn(g, '編集表示', () => { PX.mode = 'edit'; bar(); render(); }, { pressed: PX.mode === 'edit' });
    btn(g, '仕上がり', () => { PX.mode = 'real'; bar(); render(); }, { pressed: PX.mode === 'real', title: '基板の完成イメージ (緑レジスト)' });
    btn(g, PX.flip ? '裏から見る' : '表から見る', () => { PX.flip = !PX.flip; bar(); render(); }, { title: '表 / 裏の視点を切替' });
    g = grp();
    btn(g, 'DRC', () => { runDRC(); side('drc'); render(); }, { title: 'デザインルールチェック' });
    btn(g, 'ガーバー出力', () => side('out'), { cls: 'dl', title: '製造用データ (Gerber / ドリル) をダウンロード' });
    $('pxEmpty').innerHTML = '<b>回路図がまだ読み込まれていません</b><br>上の「回路図から更新」を押すと、回路図の部品と接続から基板を作り始めます。';
  }
  let sideTab = 'board';
  function side(t) { if (t) sideTab = t; panel(); }
  function panel() {
    const p = $('pxSide'); if (!p || !PX.active) return;
    p.innerHTML = '';
    const tabs = el('div', 'itabs');
    [['board', '基板'], ['part', '部品'], ['net', 'ネット'], ['drc', 'DRC'], ['out', '出力']].forEach(([k, l]) => {
      const b = el('button', null, l); b.setAttribute('aria-selected', String(sideTab === k)); b.onclick = () => side(k); tabs.appendChild(b);
    });
    p.appendChild(tabs);
    const body = el('div', 'ipane'); p.appendChild(body);
    const field = (lab, node, hint) => { const f = el('div', 'field'); f.appendChild(el('label', null, lab)); f.appendChild(node); if (hint) f.appendChild(el('p', 'cfghint', hint)); body.appendChild(f); return f; };
    const num = (v, on, step) => { const i = el('input'); i.type = 'number'; i.step = step || 0.1; i.value = v; i.onchange = () => { pushUndo(); on(+i.value); PX.pourCache = null; save(); render(); }; return i; };
    const kv = (k, v) => { const d = el('div', 'kv'); d.appendChild(el('span', null, k)); d.appendChild(el('span', null, v)); body.appendChild(d); };
    const chk = (lab, val, on) => { const l = el('label', 'dk-check'); const c = el('input'); c.type = 'checkbox'; c.checked = val; c.onchange = () => { on(c.checked); PX.pourCache = null; save(); render(); panel(); }; l.appendChild(c); l.appendChild(el('span', null, lab)); body.appendChild(l); };
    if (sideTab === 'board') {
      body.appendChild(el('h5', 'sec', '基板の外形'));
      const r2 = el('div', 'row2'); body.appendChild(r2);
      const f1 = el('div', 'field'); f1.appendChild(el('label', null, '幅 (mm)')); f1.appendChild(num(PX.board.w, v => PX.board.w = Math.max(10, v), 0.5)); r2.appendChild(f1);
      const f2 = el('div', 'field'); f2.appendChild(el('label', null, '高さ (mm)')); f2.appendChild(num(PX.board.h, v => PX.board.h = Math.max(10, v), 0.5)); r2.appendChild(f2);
      field('角の丸み (mm)', num(PX.board.r, v => PX.board.r = Math.max(0, v), 0.5));
      chk('四隅に取付穴 (M3)', PX.board.holes, v => PX.board.holes = v);
      body.appendChild(el('h5', 'sec', 'ベタ GND'));
      chk('裏面 (B.Cu) をベタ GND にする', PX.pour.B, v => PX.pour.B = v);
      chk('表面 (F.Cu) もベタ GND にする', PX.pour.F, v => PX.pour.F = v);
      const ns = el('select'); PX.nets.forEach(n => { const o = el('option', null, n.name); o.value = n.name; ns.appendChild(o); }); ns.value = PX.pour.net;
      ns.onchange = () => { PX.pour.net = ns.value; PX.pourCache = null; save(); render(); }; field('ベタにするネット', ns);
      body.appendChild(el('h5', 'sec', 'デザインルール (mm)'));
      const R = PX.rules, r3 = el('div', 'row2'); body.appendChild(r3);
      [['clear', 'クリアランス'], ['track', '信号線の幅'], ['power', '電源線の幅'], ['via', 'ビア径'], ['viaDrill', 'ビア穴径'], ['edge', '外形からの距離']].forEach(([k, l]) => {
        const f = el('div', 'field'); f.appendChild(el('label', null, l)); f.appendChild(num(R[k], v => R[k] = Math.max(0.05, v), 0.05)); r3.appendChild(f);
      });
      body.appendChild(el('p', 'note', '一般的な基板製造サービスの標準: クリアランス・線幅 0.15mm 以上、ビア穴 0.3mm 以上。手はんだなら 0.3〜0.5mm の線幅が扱いやすいです。'));
      body.appendChild(el('h5', 'sec', '表示'));
      chk('表の銅箔', PX.show.F, v => PX.show.F = v); chk('裏の銅箔', PX.show.B, v => PX.show.B = v); chk('シルク', PX.show.silk, v => PX.show.silk = v); chk('ラッツネスト (未配線)', PX.show.rats, v => PX.show.rats = v); chk('ベタ', PX.show.pour, v => PX.show.pour = v);
      return;
    }
    if (sideTab === 'part') {
      const cs = PX.comps.filter(c => PX.sel.has(c.id));
      if (cs.length === 1) {
        const c = cs[0], sc = S().doc.components.find(q => q.id === c.id);
        body.appendChild(el('h5', 'sec', c.ref + ' · ' + c.name));
        kv('定数 / 型番', c.val || '—');
        if (sc) {
          const vs = fpVariants(sc), s2 = el('select');
          vs.forEach(([v, t]) => { const o = el('option', null, t); o.value = v; s2.appendChild(o); }); s2.value = c.variant;
          s2.onchange = () => { sc.props = sc.props || {}; sc.props.pcbfp = s2.value; const f = makeFootprint(sc); c.variant = f.variant; c.pads.forEach((p, i) => { if (f.pads[i]) f.pads[i].net = p.net; }); c.pads = f.pads; c.body = f.body; PX.pourCache = null; save(); render(); panel(); };
          field('フットプリント', s2);
        }
        const rs = el('select'); [0, 90, 180, 270].forEach(v => { const o = el('option', null, v + '°'); o.value = v; rs.appendChild(o); }); rs.value = c.rot;
        rs.onchange = () => { pushUndo(); c.rot = +rs.value; PX.pourCache = null; save(); render(); }; field('向き', rs);
        const ss = el('select'); [['top', '表面 (部品面)'], ['bottom', '裏面']].forEach(([v, t]) => { const o = el('option', null, t); o.value = v; ss.appendChild(o); }); ss.value = c.side;
        ss.onchange = () => { pushUndo(); c.side = ss.value; PX.pourCache = null; save(); render(); }; field('実装面', ss);
        const r2 = el('div', 'row2'); body.appendChild(r2);
        const fx = el('div', 'field'); fx.appendChild(el('label', null, 'X (mm)')); fx.appendChild(num(+c.x.toFixed(3), v => c.x = v, 0.635)); r2.appendChild(fx);
        const fy = el('div', 'field'); fy.appendChild(el('label', null, 'Y (mm)')); fy.appendChild(num(+c.y.toFixed(3), v => c.y = v, 0.635)); r2.appendChild(fy);
        body.appendChild(el('h5', 'sec', 'パッド'));
        c.pads.forEach(p => kv(String(p.name || p.num), p.net >= 0 ? PX.nets[p.net].name : '（未接続）'));
        return;
      }
      body.appendChild(el('h5', 'sec', '部品一覧 (' + PX.comps.length + ')'));
      const list = el('div', 'netlist');
      PX.comps.forEach(c => {
        const d = el('div', 'netrow'); d.setAttribute('aria-selected', String(PX.sel.has(c.id)));
        d.appendChild(el('b', null, c.ref)); d.appendChild(el('i', null, (c.val || c.name) + ' · ' + (c.variant === 'tht' ? 'THT' : c.variant.toUpperCase()) + (c.side === 'bottom' ? ' · 裏' : '')));
        d.onclick = () => { PX.sel.clear(); PX.sel.add(c.id); render(); panel(); };
        list.appendChild(d);
      });
      body.appendChild(list);
      body.appendChild(el('p', 'note', 'ドラッグで移動、R で回転、F で裏返し。Shift+ドラッグで範囲選択。'));
      return;
    }
    if (sideTab === 'net') {
      const rn = ratsnest();
      body.appendChild(el('h5', 'sec', 'ネット (' + PX.nets.length + ')' + (rn.unrouted ? ' — 未配線 ' + rn.unrouted : ' — すべて配線済み')));
      const list = el('div', 'netlist');
      PX.nets.forEach((n, ni) => {
        const d = el('div', 'netrow'); d.setAttribute('aria-selected', String(PX.hiNet === ni));
        const un = rn.lines.filter(l => l.net === ni).length;
        d.appendChild(el('b', null, n.name));
        if (n.power) d.appendChild(el('span', 'chip rail', '電源 ' + PX.rules.power + 'mm'));
        if (un) d.appendChild(el('span', 'chip warnchip', '未配線 ' + un));
        d.appendChild(el('i', null, n.pads.map(([ci, pi]) => PX.comps[ci].ref + '.' + (PX.comps[ci].pads[pi].name || PX.comps[ci].pads[pi].num)).join('  ')));
        d.onclick = () => { PX.hiNet = PX.hiNet === ni ? null : ni; render(); panel(); };
        list.appendChild(d);
      });
      body.appendChild(list);
      return;
    }
    if (sideTab === 'drc') {
      const b = el('button', 'btn primary', 'DRC を実行'); b.onclick = () => { runDRC(); render(); panel(); }; body.appendChild(b);
      if (!PX.drc) { body.appendChild(el('p', 'note', 'クリアランス、ショート、外形はみ出し、取付穴との干渉、未配線をチェックします。')); return; }
      body.appendChild(el('h5', 'sec', '結果 ' + PX.drc.list.length + ' 件'));
      if (!PX.drc.list.length) { const d = el('div', 'msg ok'); d.appendChild(el('b', null, 'OK')); d.appendChild(el('span', null, 'エラーはありません。製造データを出力できます。')); body.appendChild(d); }
      PX.drc.list.slice(0, 200).forEach(m => {
        const d = el('div', 'msg ' + (m.lv === 'err' ? 'err' : 'warn')); d.appendChild(el('b', null, m.lv === 'err' ? 'ERR' : 'WARN')); d.appendChild(el('span', null, m.t));
        if (m.x != null) { d.style.cursor = 'pointer'; d.onclick = () => { PX.view.z = Math.max(PX.view.z, 20); PX.view.x = cw / 2 - (PX.flip ? PX.board.w - m.x : m.x) * PX.view.z; PX.view.y = ch / 2 - m.y * PX.view.z; render(); }; }
        body.appendChild(d);
      });
      return;
    }
    if (sideTab === 'out') {
      body.appendChild(el('h5', 'sec', '製造データ'));
      const mk = (label, fn, cls) => { const b = el('button', 'btn ' + (cls || ''), label); b.style.width = '100%'; b.style.marginBottom = '6px'; b.onclick = fn; body.appendChild(b); };
      mk('ガーバー一式 (ZIP)', () => exportZip(), 'primary');
      mk('ドリルデータ (Excellon)', () => A.saveFile('board-PTH.drl', excellon(true)));
      mk('部品表 BOM (CSV)', () => A.saveFile('board-BOM.csv', bomCSV()));
      mk('実装座標 CPL (CSV)', () => A.saveFile('board-CPL.csv', cplCSV()));
      mk('基板イメージ (SVG)', () => A.saveFile('board.svg', boardSVG()));
      mk('PCB プロジェクト (JSON)', () => A.saveFile('board-pcb.json', JSON.stringify(Object.assign({ schematic: JSON.parse(window.CADDoc.serialize(S().doc)) }, serialize()), null, 1)));
      body.appendChild(el('p', 'note', 'ZIP には表裏の銅箔・レジスト・シルク・メタルマスク・外形・ドリル (PTH / NPTH) が入っています (RS-274X, 単位 mm)。多くの基板製造サービスにそのままアップロードできます。出力前に DRC を実行してください。'));
      const rn = ratsnest();
      if (rn.unrouted) { const d = el('div', 'msg warn'); d.appendChild(el('b', null, 'WARN')); d.appendChild(el('span', null, '未配線が ' + rn.unrouted + ' 本あります')); body.appendChild(d); }
      body.appendChild(el('h5', 'sec', '概要'));
      kv('基板サイズ', PX.board.w + ' × ' + PX.board.h + ' mm'); kv('部品', String(PX.comps.length)); kv('配線', PX.tracks.length + ' 本 (' + PX.tracks.reduce((s, t) => s + Math.hypot(t.x2 - t.x1, t.y2 - t.y1), 0).toFixed(0) + ' mm)');
      kv('ビア', String(PX.vias.length)); kv('穴', String(drills().length));
    }
  }
  function hint() {
    const h = $('pxHint'); if (!h) return;
    h.innerHTML = PX.tool === 'route' ? (PX.route ? '<b>配線中</b> — クリックで折れ点、同じネットのパッドで終了。<b>X</b> でビアを置いて層を切替、<b>/</b> で曲がり方を切替、右クリックで中止'
      : '<b>配線</b> — パッドか配線をクリックして開始')
      : PX.tool === 'via' ? '<b>ビア</b> — クリックでビアを置く' : PX.tool === 'del' ? '<b>消しゴム</b> — 配線・ビアをクリックで削除'
        : '<b>選択</b> — 部品をドラッグで移動、<b>R</b> 回転、<b>F</b> 裏返し。空き地のドラッグで画面移動、ホイールで拡大';
  }

  /* ================= ガーバー出力 ================= */
  const f6 = v => Math.round(v * 1e6);
  function gerberLayer(name, fn, polarity) {
    const ap = new Map(); let nap = 10;
    const body = [];
    const aperture = (key, def) => { if (!ap.has(key)) ap.set(key, { n: nap++, def }); return 'D' + ap.get(key).n; };
    const Y = y => PX.board.h - y;
    const g = {
      flash(x, y, shape, w, h) {
        const d = shape === 'rect' ? aperture('R' + w.toFixed(4) + 'X' + h.toFixed(4), `R,${w.toFixed(4)}X${h.toFixed(4)}`) : shape === 'oval' && w !== h ? aperture('O' + w.toFixed(4) + 'X' + h.toFixed(4), `O,${w.toFixed(4)}X${h.toFixed(4)}`) : aperture('C' + w.toFixed(4), `C,${w.toFixed(4)}`);
        body.push(d + '*', `X${f6(x)}Y${f6(Y(y))}D03*`);
      },
      line(x1, y1, x2, y2, w) {
        body.push(aperture('C' + w.toFixed(4), `C,${w.toFixed(4)}`) + '*', `X${f6(x1)}Y${f6(Y(y1))}D02*`, `X${f6(x2)}Y${f6(Y(y2))}D01*`);
      },
      poly(pts, w) { body.push(aperture('C' + w.toFixed(4), `C,${w.toFixed(4)}`) + '*'); pts.forEach((p, i) => body.push(`X${f6(p[0])}Y${f6(Y(p[1]))}D0${i ? 1 : 2}*`)); },
      region(pts) { body.push('G36*'); pts.forEach((p, i) => body.push(`X${f6(p[0])}Y${f6(Y(p[1]))}D0${i ? 1 : 2}*`)); body.push(`X${f6(pts[0][0])}Y${f6(Y(pts[0][1]))}D01*`, 'G37*'); },
      clear() { body.push('%LPC*%'); }, dark() { body.push('%LPD*%'); }
    };
    fn(g);
    const head = ['G04 UniBoard SPICE PCB — ' + name + '*', '%TF.GenerationSoftware,UniBoard SPICE,PCB,2026.09*%', '%TF.FileFunction,' + name + '*%', '%FSLAX46Y46*%', '%MOMM*%', '%LP' + (polarity || 'D') + '*%', 'G01*', 'G75*'];
    const aps = [...ap.values()].map(a => `%ADD${a.n}${a.def}*%`);
    return head.concat(aps, body, ['M02*']).join('\n') + '\n';
  }
  function copperLayer(L) {
    return gerberLayer(L === 'F' ? 'Copper,L1,Top' : 'Copper,L2,Bot', g => {
      if (PX.pour[L]) pourFill(L).rects.forEach(r => g.region([[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]]));
      PX.tracks.filter(t => t.layer === L).forEach(t => g.line(t.x1, t.y1, t.x2, t.y2, t.w));
      PX.comps.forEach(c => c.pads.forEach(p => { const pw = padWorld(c, p); if (pw.layers.includes(L)) g.flash(pw.x, pw.y, pw.shape, pw.w, pw.h); }));
      PX.vias.forEach(v => g.flash(v.x, v.y, 'circle', v.d, v.d));
    });
  }
  function maskLayer(L) {
    return gerberLayer(L === 'F' ? 'Soldermask,Top' : 'Soldermask,Bot', g => {
      const ex = 0.1;
      PX.comps.forEach(c => c.pads.forEach(p => { const pw = padWorld(c, p); if (pw.layers.includes(L)) g.flash(pw.x, pw.y, pw.shape, pw.w + ex, pw.h + ex); }));
      holes().forEach(h => g.flash(h.x, h.y, 'circle', h.d + 0.2, h.d + 0.2));
    });
  }
  function pasteLayer(L) {
    return gerberLayer(L === 'F' ? 'Paste,Top' : 'Paste,Bot', g => {
      PX.comps.forEach(c => c.pads.forEach(p => { const pw = padWorld(c, p); if (pw.smd && pw.layers.includes(L)) g.flash(pw.x, pw.y, pw.shape, pw.w, pw.h); }));
    });
  }
  function silkLayer(L) {
    return gerberLayer(L === 'F' ? 'Legend,Top' : 'Legend,Bot', g => {
      PX.comps.forEach(c => {
        if ((c.side === 'top') !== (L === 'F')) return;
        silkLines(c).forEach(([a, b]) => g.line(a[0], a[1], b[0], b[1], 0.15));
        const bb = compBBox(c);
        textStrokes(c.ref, (bb.x0 + bb.x1) / 2, bb.y0 - 0.5, 1.0, L === 'B').forEach(st => { if (st.length === 1) g.line(st[0][0], st[0][1], st[0][0] + 0.01, st[0][1], 0.15); else g.poly(st, 0.15); });
      });
      if (L === 'F' && PX.boardName) textStrokes(PX.boardName, PX.board.w / 2, PX.board.h - 1.2, 1.2, false).forEach(st => g.poly(st.length > 1 ? st : [st[0], [st[0][0] + 0.01, st[0][1]]], 0.15));
    });
  }
  function edgeLayer() {
    return gerberLayer('Profile,NP', g => {
      const B = PX.board, r = Math.min(B.r, B.w / 2, B.h / 2), pts = [];
      const arc = (cx, cy, a0) => { for (let i = 0; i <= 8; i++) { const a = a0 + i / 8 * Math.PI / 2; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } };
      if (r > 0) { arc(B.w - r, r, -Math.PI / 2); arc(B.w - r, B.h - r, 0); arc(r, B.h - r, Math.PI / 2); arc(r, r, Math.PI); pts.push(pts[0]); }
      else pts.push([0, 0], [B.w, 0], [B.w, B.h], [0, B.h], [0, 0]);
      g.poly(pts, 0.1);
    });
  }
  function drills() {
    const out = [];
    PX.comps.forEach(c => c.pads.forEach(p => { if (!p.smd && p.drill) { const pw = padWorld(c, p); out.push({ x: pw.x, y: pw.y, d: p.drill, pth: true }); } }));
    PX.vias.forEach(v => out.push({ x: v.x, y: v.y, d: v.drill, pth: true }));
    holes().forEach(h => out.push({ x: h.x, y: h.y, d: h.d, pth: false }));
    return out;
  }
  function excellon(pth) {
    const ds = drills().filter(d => d.pth === pth), tools = [...new Set(ds.map(d => d.d.toFixed(3)))].sort();
    const L = ['M48', '; UniBoard SPICE drill file (' + (pth ? 'PTH' : 'NPTH') + ')', ';FILE_FORMAT=4:3', 'METRIC,TZ', ...tools.map((t, i) => `T${i + 1}C${t}`), '%', 'G90', 'G05'];
    tools.forEach((t, i) => { L.push(`T${i + 1}`); ds.filter(d => d.d.toFixed(3) === t).forEach(d => L.push(`X${d.x.toFixed(3)}Y${(PX.board.h - d.y).toFixed(3)}`)); });
    L.push('T0', 'M30'); return L.join('\n') + '\n';
  }
  function bomCSV() {
    const m = new Map();
    PX.comps.forEach(c => { const k = c.val + '|' + c.variant; if (!m.has(k)) m.set(k, { val: c.val || c.name, fp: c.variant === 'tht' ? c.name + ' (THT)' : c.variant.toUpperCase(), refs: [] }); m.get(k).refs.push(c.ref); });
    return ['Comment,Designator,Footprint,Quantity', ...[...m.values()].map(v => `"${v.val}","${v.refs.join(',')}","${v.fp}",${v.refs.length}`)].join('\n');
  }
  function cplCSV() {
    return ['Designator,Mid X,Mid Y,Layer,Rotation', ...PX.comps.map(c => { const b = compBBox(c); return `${c.ref},${((b.x0 + b.x1) / 2).toFixed(3)}mm,${(PX.board.h - (b.y0 + b.y1) / 2).toFixed(3)}mm,${c.side === 'top' ? 'Top' : 'Bottom'},${(360 - c.rot) % 360}`; })].join('\n');
  }
  function boardSVG() {
    const B = PX.board, s = 10, out = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${(B.w + 4) * s}" height="${(B.h + 4) * s}" viewBox="-2 -2 ${B.w + 4} ${B.h + 4}">`);
    out.push(`<rect x="0" y="0" width="${B.w}" height="${B.h}" rx="${B.r}" fill="#1f6b3a" stroke="#0f3d20" stroke-width="0.2"/>`);
    if (PX.pour.B) pourFill('B').rects.forEach(r => out.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="#1c5f35" opacity=".6"/>`));
    PX.tracks.forEach(t => out.push(`<line x1="${t.x1}" y1="${t.y1}" x2="${t.x2}" y2="${t.y2}" stroke="${t.layer === 'F' ? '#2a8a4c' : '#185c33'}" stroke-width="${t.w}" stroke-linecap="round"/>`));
    PX.comps.forEach(c => {
      silkLines(c).forEach(([a, b]) => out.push(`<line x1="${a[0].toFixed(3)}" y1="${a[1].toFixed(3)}" x2="${b[0].toFixed(3)}" y2="${b[1].toFixed(3)}" stroke="#f4f4ef" stroke-width="0.15" stroke-linecap="round"/>`));
      const bb = compBBox(c);
      textStrokes(c.ref, (bb.x0 + bb.x1) / 2, bb.y0 - 0.5, 1, c.side === 'bottom').forEach(st => out.push(`<polyline points="${st.map(p => p.map(v => v.toFixed(3)).join(',')).join(' ')}" fill="none" stroke="#f4f4ef" stroke-width="0.13" stroke-linecap="round" stroke-linejoin="round"/>`));
      c.pads.forEach(p => {
        const pw = padWorld(c, p);
        out.push(pw.shape === 'rect' ? `<rect x="${(pw.x - pw.w / 2).toFixed(3)}" y="${(pw.y - pw.h / 2).toFixed(3)}" width="${pw.w}" height="${pw.h}" fill="#d9b25a"/>` : `<circle cx="${pw.x.toFixed(3)}" cy="${pw.y.toFixed(3)}" r="${pw.w / 2}" fill="#d9b25a"/>`);
        if (pw.drill) out.push(`<circle cx="${pw.x.toFixed(3)}" cy="${pw.y.toFixed(3)}" r="${pw.drill / 2}" fill="#101512"/>`);
      });
    });
    PX.vias.forEach(v => out.push(`<circle cx="${v.x}" cy="${v.y}" r="${v.d / 2}" fill="#d9b25a"/><circle cx="${v.x}" cy="${v.y}" r="${v.drill / 2}" fill="#101512"/>`));
    holes().forEach(h => out.push(`<circle cx="${h.x}" cy="${h.y}" r="${h.d / 2}" fill="#fff"/>`));
    out.push('</svg>'); return out.join('\n');
  }
  // ZIP (無圧縮)
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(files) {
    const enc = new TextEncoder(), parts = [], cen = []; let off = 0;
    const d = new Date(), dt = ((d.getFullYear() - 1980) << 25) | ((d.getMonth() + 1) << 21) | (d.getDate() << 16) | (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    files.forEach(([name, text]) => {
      const nb = enc.encode(name), data = enc.encode(text), crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint32(10, dt, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nb.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), nb, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint32(12, dt, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nb.length, true); c.setUint32(42, off, true);
      cen.push(new Uint8Array(c.buffer), nb);
      off += 30 + nb.length + data.length;
    });
    const csize = cen.reduce((s, a) => s + a.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...cen, new Uint8Array(e.buffer)], { type: 'application/zip' });
  }
  function gerberFiles() {
    return [
      ['board-F_Cu.gtl', copperLayer('F')], ['board-B_Cu.gbl', copperLayer('B')],
      ['board-F_Mask.gts', maskLayer('F')], ['board-B_Mask.gbs', maskLayer('B')],
      ['board-F_Silkscreen.gto', silkLayer('F')], ['board-B_Silkscreen.gbo', silkLayer('B')],
      ['board-F_Paste.gtp', pasteLayer('F')], ['board-B_Paste.gbp', pasteLayer('B')],
      ['board-Edge_Cuts.gm1', edgeLayer()], ['board-PTH.drl', excellon(true)], ['board-NPTH.drl', excellon(false)],
      ['README.txt', 'UniBoard SPICE PCB\n2 layers, 1.6mm FR-4, 1oz copper\nUnits: mm, RS-274X (4.6), Excellon METRIC\nBoard ' + PX.board.w + ' x ' + PX.board.h + ' mm\n']
    ];
  }
  async function exportZip() {
    const d = runDRC(); render(); panel();
    const errs = d.filter(m => m.lv === 'err').length;
    if (errs) toast(`DRC エラーが ${errs} 件あります。確認してから製造に出してください`, 'err');
    const r = await A.saveFile('board-gerber.zip', zip(gerberFiles()));
    toast(r || '保存しました', 'ok');
  }

  /* ================= 画面切替 ================= */
  function activate(on) {
    PX.active = on;
    root.hidden = !on;
    document.body.classList.toggle('pcbx-on', on);
    ['tabSch', 'tabPcb'].forEach(id => { if (on) $(id).setAttribute('aria-selected', 'false'); });
    $('tabPcbx').setAttribute('aria-selected', String(on));
    if (on) {
      if (!PX.imported) { if (!applyPending()) importFromSchematic(); }
      bar(); resize(); panel();
      if (!PX.fitted) { PX.fitted = true; fit(); }
    }
  }
  $('tabPcbx').onclick = () => activate(true);
  ['tabSch', 'tabPcb'].forEach(id => $(id).addEventListener('click', () => { if (PX.active) activate(false); }));
  $('pxZi').onclick = () => { const v = PX.view, k = 1.25; v.x = cw / 2 - (cw / 2 - v.x) * k; v.y = ch / 2 - (ch / 2 - v.y) * k; v.z *= k; render(); };
  $('pxZo').onclick = () => { const v = PX.view, k = 0.8; v.x = cw / 2 - (cw / 2 - v.x) * k; v.y = ch / 2 - (ch / 2 - v.y) * k; v.z *= k; render(); };
  $('pxZf').onclick = () => fit();
  load(store.get('pcb', null));
  if (window.matchMedia) { const mq = matchMedia('(prefers-color-scheme: dark)'); (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(() => render()); }
  new MutationObserver(() => render()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  window.UBPcb = { state: PX, activate, importFromSchematic, autoPlace, autoRoute, runDRC, gerberFiles, excellon, zip, ratsnest, serialize, render };
})();
