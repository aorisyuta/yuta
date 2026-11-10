/* ---- perf-manual.js ---- */
/* =====================================================================
   UniBoard SPICE — 蛇の目基板の「手配置」読み込み
   回路図 JSON の perfboard に書いた部品の穴位置と配線を、そのまま基板にする
   (自動配置・自動配線をせず、DRC と配線指示はそのまま使える)

   "perfboard": {
     "cols": 15, "rows": 11,                         // 基板の穴数 (省略時は内容から決める)
     "parts": { "R1": { "1": "C4", "2": "F4" },       // 部品 → ピン (番号か名前) → 穴 ("A1" 形式 / [列, 行] 0 始まり)
                "Q1": { "E": "E1", "C": "E2", "B": "E3" } },
     "wires": [ { "layer": "solder", "pts": ["B4", "C4"] },          // すず線 (半田面)
                { "layer": "component", "pts": ["D2", "D6"] },       // 部品面ジャンパ
                { "layer": "insulated", "pts": ["A1", "H9"] } ]      // 被覆線 (途中の穴に触れない)
   }
   ===================================================================== */
(function () {
  'use strict';
  const UB = window.UniBoard, A = UB.api, C1 = window.CADCore, CB = window.CADBoard, CD = window.CADDoc;
  const S = () => UB.state;
  const $ = id => document.getElementById(id);
  const el = A.el;
  const H = window.UBHooks = window.UBHooks || {};
  const toast = (t, l) => window.UBToast && window.UBToast(t, l);
  const hyp = (a, b) => Math.sqrt(a * a + b * b);

  function colName(c) { let s = ''; c = c + 1; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = ((c - m) / 26) | 0; } return s; }
  const holeName = (c, r) => colName(c) + (r + 1);
  function parseHole(h) {
    if (Array.isArray(h)) return [h[0] | 0, h[1] | 0];
    if (h && typeof h === 'object') return [h.c | 0, h.r | 0];
    const m = String(h || '').trim().toUpperCase().match(/^([A-Z]+)\s*-?\s*(\d+)$/);
    if (!m) return null;
    let n = 0; for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
    return [n - 1, +m[2] - 1];
  }

  /* ---------------- 手配置 → 基板データ ---------------- */
  function build(doc) {
    const pb = doc.perfboard, problems = [], notes = [];
    const nets = C1.extractNets(doc);
    const prj = CB.buildProject(doc, nets, { powerHeader: false });
    const parts = pb.parts || {};
    let maxC = 0, maxR = 0;
    const unplaced = [];
    for (const comp of prj.comps) {
      const spec = parts[comp.ref];
      if (!spec) { unplaced.push(comp); continue; }
      const holes = [];
      let bad = false;
      comp.fp.pads.forEach((p, i) => {
        const key = Object.keys(spec).find(k => String(k) === String(p.pin) || String(k).toUpperCase() === String(comp.pinNames[p.pin] || '').toUpperCase());
        const h = key != null ? parseHole(spec[key]) : null;
        if (!h) { bad = true; problems.push({ net: comp.ref, t: `${comp.ref} のピン ${comp.pinNames[p.pin] || p.pin} の穴が指定されていません` }); }
        holes[i] = h;
      });
      if (bad) { unplaced.push(comp); continue; }
      holes.forEach(h => { maxC = Math.max(maxC, h[0]); maxR = Math.max(maxR, h[1]); });
      // 元のフットプリントを回転して一致すれば、それをそのまま使う (部品の形がきれいに出る)
      let placed = false;
      for (let k = 0; k < 4 && !placed; k++) {
        const rp = comp.rots[k].pads, c0 = holes[0][0] - rp[0].c, r0 = holes[0][1] - rp[0].r;
        if (rp.every((q, i) => q.c + c0 === holes[i][0] && q.r + r0 === holes[i][1])) { comp.pos = { c: c0, r: r0, rot: k * 90 }; placed = true; }
      }
      if (!placed) {
        // 穴位置が違う (足を曲げて挿す等) ときは、指定どおりのパッド位置で部品を作る
        const minC = Math.min(...holes.map(h => h[0])), minR = Math.min(...holes.map(h => h[1]));
        const w = Math.max(...holes.map(h => h[0])) - minC, h = Math.max(...holes.map(h => h[1])) - minR;
        const fp = {
          pads: comp.fp.pads.map((p, i) => ({ c: holes[i][0] - minC, r: holes[i][1] - minR, pin: p.pin })),
          body: { x: -0.4, y: -0.4, w: w + 0.8, h: h + 0.8, shape: comp.fp.body && /dip|to92|to220|header|circle|term/.test(comp.fp.body.shape) ? comp.fp.body.shape : 'rect' },
          kind: 'grid'
        };
        if (w === 0 || h === 0) fp.body = { x: -0.35, y: -0.35, w: w + 0.7, h: h + 0.7, shape: 'rect' };
        comp.fp = fp; comp.rots = [0, 90, 180, 270].map(r => CB.rotFp(fp, r));
        comp.pos = { c: minC, r: minR, rot: 0 };
      }
    }
    // 配線の範囲も基板サイズに含める
    const wires = (pb.wires || []).map((w, i) => {
      const pts = (w.pts || []).map(parseHole);
      if (pts.some(p => !p)) { problems.push({ net: '配線', t: `${i + 1} 本目の配線に読めない穴名があります` }); return null; }
      pts.forEach(p => { maxC = Math.max(maxC, p[0]); maxR = Math.max(maxR, p[1]); });
      const L = String(w.layer || 'solder').toLowerCase();
      return { pts, kind: /insul|被覆/.test(L) ? 'insulated' : /comp|top|jumper|部品/.test(L) ? 'top' : 'solder' };
    }).filter(Boolean);
    const cols = Math.max(pb.cols | 0, maxC + 1), rowsBase = Math.max(pb.rows | 0, maxR + 1);
    // 位置が指定されていない部品は基板の下に並べて知らせる
    let rows = rowsBase;
    if (unplaced.length) {
      let c = 0, r = rowsBase + 1, rowH = 0;
      unplaced.forEach(comp => {
        const sh = comp.rots[0];
        if (c + sh.w > cols) { c = 0; r += rowH + 1; rowH = 0; }
        comp.pos = { c, r, rot: 0 }; c += sh.w + 1; rowH = Math.max(rowH, sh.h);
        problems.push({ net: comp.ref, t: `${comp.ref} の穴位置が perfboard.parts にありません (基板の下に仮置きしました)` });
      });
      rows = r + rowH + 1;
    }
    const board = { cols, rows, type: 'perf', stripDir: 'row' };
    const grid = CB.makeGrid(cols, rows);
    CB.stampObstacles(grid, prj); CB.stampPads(grid, prj);
    const NC = cols * rows, idx = (c, r) => r * cols + c;
    // 線分を穴ごとの 1 マスに分ける (縦・横・45°)
    const steps = (a, b) => {
      const dc = b[0] - a[0], dr = b[1] - a[1], n = Math.max(Math.abs(dc), Math.abs(dr));
      if (n === 0) return [a];
      if (dc && dr && Math.abs(dc) !== Math.abs(dr)) return null;
      const out = []; for (let i = 0; i <= n; i++) out.push([a[0] + Math.sign(dc) * i, a[1] + Math.sign(dr) * i]);
      return out;
    };
    // 導通: 層つき穴 (l*NC + idx) の union-find
    const par = new Int32Array(2 * NC); for (let i = 0; i < par.length; i++) par[i] = i;
    const find = a => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
    const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) par[b] = a; };
    for (let i = 0; i < NC; i++) if (grid.padNet[i] >= 0) uni(i, i + NC);
    const pieces = [];
    wires.forEach((w, wi) => {
      for (let k = 1; k < w.pts.length; k++) {
        const a = w.pts[k - 1], b = w.pts[k];
        if (w.kind === 'insulated') { uni(idx(a[0], a[1]), idx(b[0], b[1])); pieces.push({ wi, kind: w.kind, a, b }); continue; }
        const st = steps(a, b);
        const l = w.kind === 'top' ? 1 : 0;
        if (!st) { problems.push({ net: '配線', t: `${holeName(a[0], a[1])} → ${holeName(b[0], b[1])} は縦・横・45° 以外の向きです (被覆線にしてください)` }); pieces.push({ wi, kind: 'insulated', a, b }); uni(idx(a[0], a[1]), idx(b[0], b[1])); continue; }
        for (let i = 1; i < st.length; i++) { uni(l * NC + idx(st[i - 1][0], st[i - 1][1]), l * NC + idx(st[i][0], st[i][1])); pieces.push({ wi, kind: w.kind, a: st[i - 1], b: st[i], l }); }
      }
      // 部品面ジャンパ・被覆線の両端は穴を通して半田面とつながる
      if (w.kind !== 'solder') [w.pts[0], w.pts[w.pts.length - 1]].forEach(p => uni(idx(p[0], p[1]), idx(p[0], p[1]) + NC));
    });
    // 配線ごとのネットを決める (つながっているパッドから)
    const rootNets = new Map();
    for (let i = 0; i < NC; i++) if (grid.padNet[i] >= 0) {
      const r = find(i); if (!rootNets.has(r)) rootNets.set(r, new Set()); rootNets.get(r).add(grid.padNet[i]);
    }
    const shorted = new Set();
    rootNets.forEach(s => { if (s.size > 1) { const k = [...s].sort().join(','); if (!shorted.has(k)) { shorted.add(k); problems.push({ net: [...s].map(n => prj.nets[n].name).join(' / '), t: 'ショート: 別のネットが配線でつながっています' }); } } });
    const routes = new Map();
    const recOf = ni => { if (!routes.has(ni)) routes.set(ni, { segs: [], nodes: [], diags: [], vias: [], jumpers: [], len: 0 }); return routes.get(ni); };
    const netOfPoint = (l, p) => { const s = rootNets.get(find(l * NC + idx(p[0], p[1]))); return s ? [...s][0] : -1; };
    let floating = 0;
    const seenNode = new Set(), jumpDone = new Set();
    pieces.forEach(pc => {
      const ni = netOfPoint(pc.kind === 'top' ? 1 : 0, pc.a);
      if (ni < 0) { floating++; return; }
      const rec = recOf(ni);
      if (pc.kind === 'insulated') {
        if (jumpDone.has(pc.wi + ':' + pc.a + pc.b)) return;
        jumpDone.add(pc.wi + ':' + pc.a + pc.b);
        rec.jumpers.push({ pts: [pc.a, pc.b], forced: false }); rec.len += hyp(pc.b[0] - pc.a[0], pc.b[1] - pc.a[1]); return;
      }
      rec.segs.push({ l: pc.l, c1: pc.a[0], r1: pc.a[1], c2: pc.b[0], r2: pc.b[1] });
      rec.len += hyp(pc.b[0] - pc.a[0], pc.b[1] - pc.a[1]);
      [pc.a, pc.b].forEach(p => { const k = pc.l * NC + idx(p[0], p[1]); if (!seenNode.has(k + ':' + ni)) { seenNode.add(k + ':' + ni); if (grid.padNet[idx(p[0], p[1])] < 0) rec.nodes.push(k); } });
    });
    // 部品面ジャンパの端 (パッド以外の穴) は表裏渡し
    wires.forEach(w => {
      if (w.kind !== 'top') return;
      [w.pts[0], w.pts[w.pts.length - 1]].forEach(p => {
        const i = idx(p[0], p[1]); if (grid.padNet[i] >= 0) return;
        const ni = netOfPoint(1, p); if (ni >= 0 && !recOf(ni).vias.includes(i)) recOf(ni).vias.push(i);
      });
    });
    if (floating) notes.push(`どのパッドにもつながっていない配線が ${floating} 区間あります`);
    let totalLen = 0, vias = 0, forced = 0, topLen = 0, botLen = 0;
    routes.forEach(r => { totalLen += r.len; vias += r.vias.length; forced += r.jumpers.length; r.segs.forEach(s => { const d = hyp(s.c2 - s.c1, s.r2 - s.r1); if (s.l === 1) topLen += d; else botLen += d; }); });
    const result = { grid, routes, stats: {}, metrics: { totalLen, vias, forced, topLen, botLen, nets: prj.nets.length, routed: 0, unrouted: 0 } };
    const vp = CB.verify(prj, board, result, null);
    const openNets = new Set(vp.filter(p => /未接続/.test(p.t)).map(p => p.net));
    result.metrics.routed = prj.nets.length - openNets.size; result.metrics.unrouted = openNets.size;
    const all = problems.concat(vp.map(p => /未接続/.test(p.t) ? { net: p.net, t: '配線が足りません (つながっていないパッドがあります)' } : p));
    return {
      prj, board, result, strip: null, problems: all, nets, seed: 0, manual: true,
      note: '配線図に書いた部品の位置と配線をそのまま表示しています (自動配置・自動配線はしていません)' + (notes.length ? '。' + notes.join('。') : ''),
      noteLv: all.length ? 'warn' : 'ok'
    };
  }

  /* ---------------- いまの基板 → 手配置データ ---------------- */
  function toSpec(st) {
    const { prj, board, result } = st, cols = board.cols;
    const parts = {};
    prj.comps.forEach(c => {
      if (c.isPower) return;
      const sh = c.rots[((c.pos.rot / 90) | 0) & 3], o = {};
      sh.pads.forEach(p => { o[String(p.pin)] = holeName(c.pos.c + p.c, c.pos.r + p.r); });
      parts[c.ref] = o;
    });
    const wires = [];
    if (result && result.routes) result.routes.forEach(rec => {
      let cur = null;
      rec.segs.forEach(s => {
        const a = holeName(s.c1, s.r1), b = holeName(s.c2, s.r2), layer = s.l === 1 ? 'component' : 'solder';
        const dir = Math.sign(s.c2 - s.c1) + ',' + Math.sign(s.r2 - s.r1);
        if (cur && cur.layer === layer && cur.last === a && cur.dir === dir) { cur.pts[cur.pts.length - 1] = b; cur.last = b; }
        else if (cur && cur.layer === layer && cur.last === a) { cur.pts.push(b); cur.last = b; cur.dir = dir; }
        else { cur = { layer, pts: [a, b], last: b, dir }; wires.push(cur); }
      });
      rec.jumpers.forEach(j => wires.push({ layer: 'insulated', pts: j.pts.map(p => holeName(p[0], p[1])) }));
    });
    void cols;
    return { cols: board.cols, rows: board.rows, parts, wires: wires.map(w => ({ layer: w.layer, pts: w.pts })) };
  }

  /* ---------------- 画面 ---------------- */
  let builtFor = null;
  function show(force) {
    const st = S(), doc = st.doc;
    if (!doc.perfboard) return false;
    const key = CD.serialize(doc);
    if (!force && builtFor === key && st.board && st.board.manual) return true;
    try { st.board = build(doc); builtFor = key; }
    catch (e) { toast('配線図を読み込めませんでした: ' + e.message, 'err'); console.error(e); return false; }
    st.hiNet = null;
    A.panels(); A.hint(); A.fit(); A.rp();
    return true;
  }
  const prevTab = H.onTab;
  H.onTab = t => {
    if (prevTab) prevTab(t);
    if (t === 'pcb') {
      const doc = S().doc, key = doc.perfboard ? CD.serialize(doc) : null;
      if (doc.perfboard && builtFor !== key) setTimeout(() => show(true), 0);
    }
    syncBtns();
  };
  // ツールバー: 手配置を表示 / いまの配置を保存
  const grp = el('div', 'toolgroup'); grp.id = 'perfManual';
  const bShow = el('button', 'btn', '手配置'); bShow.type = 'button'; bShow.title = '回路図 JSON に保存された部品の位置と配線をそのまま表示';
  bShow.onclick = () => { if (!show(true)) toast('この回路図には手配置の配線 (perfboard) がありません', 'err'); };
  const bSave = el('button', 'btn', '配置を保存'); bSave.type = 'button'; bSave.title = 'いま表示している部品の位置と配線を回路図 JSON (perfboard) に保存。ダウンロードした JSON を読み込むと同じ基板になります';
  bSave.onclick = () => {
    const st = S(); if (!st.board || st.board.strip) { toast('蛇の目基板 (ストリップボード以外) を表示してから保存してください', 'err'); return; }
    A.pushUndo(); st.doc.perfboard = toSpec(st.board); builtFor = CD.serialize(st.doc); st.board.manual = true;
    toast('部品の位置と配線を回路図に保存しました。「ダウンロード」→「回路図 (JSON)」で書き出せます', 'ok'); syncBtns();
  };
  grp.appendChild(bShow); grp.appendChild(bSave);
  $('pcbTools').insertBefore(grp, $('pcbTools').querySelector('.sep'));
  function syncBtns() { bShow.hidden = !S().doc.perfboard; }
  syncBtns();

  window.UBPerf = { build, toSpec, show, parseHole, holeName };
})();
