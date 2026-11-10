/* ---- sch-tidy.js ---- */
/* =====================================================================
   UniBoard SPICE — 回路図の配線を整える
   部品の位置はそのままに、配線だけを引き直す。
     ・縦横だけ、曲がりは少なく、部品の上は通さない
     ・他の配線とは直角に交わるだけ (並んで重ならない・角や分岐では交わらない)
     ・引き直した後、つながり方が元と同じことを確かめる (違えば何も変えない)
   CADCore だけに依存 (画面には触らない)
   ===================================================================== */
(function (global) {
  'use strict';
  const C1 = global.CADCore, GS = C1.GS;
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];   // 東 南 西 北
  const STEP = 10, BEND = 26, CROSS = 45, NEAR = 7, PINDIR = 12;

  /* ピン (記号の端子) を全部集める */
  function terminals(doc) {
    const out = [];
    for (const c of doc.components) {
      if (!C1.symOf(c)) continue;
      const bb = C1.compBBox(c);
      for (const p of C1.compPins(c)) out.push({ x: p.x, y: p.y, comp: c, bb, pin: p.pin });
    }
    return out;
  }

  /* いまの配線で、どのピンどうしがつながっているか (ネット名による結合は見ない = 線で実際につながる組) */
  function partition(doc, terms) {
    const key = (x, y) => x + ',' + y, idx = new Map(), pts = [];
    const nid = (x, y) => { const k = key(x, y); let i = idx.get(k); if (i === undefined) { i = pts.length; pts.push([x, y]); idx.set(k, i); } return i; };
    const tn = terms.map(t => nid(t.x, t.y));
    const segs = (doc.wires || []).map(w => ({ a: nid(w.x1, w.y1), b: nid(w.x2, w.y2), w }));
    (doc.junctions || []).forEach(j => nid(j.x, j.y));
    const par = pts.map((_, i) => i);
    const find = a => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
    const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) par[b] = a; };
    const onSeg = (px, py, w) => {
      const cr = (px - w.x1) * (w.y2 - w.y1) - (py - w.y1) * (w.x2 - w.x1);
      if (Math.abs(cr) > 1e-6) return false;
      const dt = (px - w.x1) * (w.x2 - w.x1) + (py - w.y1) * (w.y2 - w.y1), l2 = (w.x2 - w.x1) ** 2 + (w.y2 - w.y1) ** 2;
      return l2 > 0 && dt > 1e-6 && dt < l2 - 1e-6;
    };
    segs.forEach(s => uni(s.a, s.b));
    for (const s of segs) for (let i = 0; i < pts.length; i++)
      if (i !== s.a && i !== s.b && onSeg(pts[i][0], pts[i][1], s.w)) uni(s.a, i);
    for (const j of (doc.junctions || [])) {
      const jn = idx.get(key(j.x, j.y));
      for (const s of segs) if (onSeg(j.x, j.y, s.w) || s.a === jn || s.b === jn) uni(jn, s.a);
    }
    return tn.map(find);
  }
  /* 組分けを比べられる形にする: 「同じ組のピン位置」の集合の集合 */
  function signature(terms, grp) {
    const m = new Map();
    terms.forEach((t, i) => { const g = grp[i]; if (!m.has(g)) m.set(g, new Set()); m.get(g).add(t.x + ',' + t.y); });
    return [...m.values()].map(s => [...s].sort().join(' ')).sort().join('|');
  }

  function Heap() { this.k = []; this.v = []; }
  Heap.prototype.push = function (k, v) {
    const K = this.k, V = this.v; let i = K.length; K.push(k); V.push(v);
    while (i > 0) { const p = (i - 1) >> 1; if (K[p] <= k) break; K[i] = K[p]; V[i] = V[p]; i = p; }
    K[i] = k; V[i] = v;
  };
  Heap.prototype.pop = function () {
    const K = this.k, V = this.v, top = V[0], k = K.pop(), v = V.pop(), n = K.length;
    if (n) {
      let i = 0;
      for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && K[c + 1] < K[c]) c++; if (K[c] >= k) break; K[i] = K[c]; V[i] = V[c]; i = c; }
      K[i] = k; V[i] = v;
    }
    return top;
  };

  /* 見た目の悪さ: 線の長さ + 曲がり + 交差 (小さいほど良い) */
  function ugliness(ws) {
    let len = 0, crossings = 0;
    const m = new Map(); let bends = 0;
    ws.forEach(w => {
      len += Math.abs(w.x2 - w.x1) + Math.abs(w.y2 - w.y1);
      [[w.x1, w.y1], [w.x2, w.y2]].forEach(([x, y]) => { const k = x + ',' + y, h = w.y1 === w.y2 ? 1 : w.x1 === w.x2 ? 2 : 3; m.set(k, (m.get(k) || 0) | h); });
    });
    m.forEach(v => { if (v === 3) bends++; });
    const H = ws.filter(w => w.y1 === w.y2 && w.x1 !== w.x2), V = ws.filter(w => w.x1 === w.x2 && w.y1 !== w.y2);
    for (const h of H) for (const v of V)
      if (v.x1 > Math.min(h.x1, h.x2) && v.x1 < Math.max(h.x1, h.x2) && h.y1 > Math.min(v.y1, v.y2) && h.y1 < Math.max(v.y1, v.y2)) crossings++;
    const diag = ws.filter(w => w.x1 !== w.x2 && w.y1 !== w.y2).length;
    return { len, bends, crossings, count: ws.length, score: len / GS + bends * 3 + crossings * 5 + diag * 6 };
  }

  /** 配線を引き直す。成功 → { wires:[{x1,y1,x2,y2}], before, after }、できないとき → { error } */
  function rewire(doc) {
    const terms = terminals(doc);
    if (!terms.length || !(doc.wires || []).length) return { error: '引き直す配線がありません' };
    const grp0 = partition(doc, terms), sig0 = signature(terms, grp0);
    const r = routeGroups(doc, terms, grp0);
    if (r.error) return r;
    // つながり方が元と同じか確かめる
    if (signature(terms, partition({ components: doc.components, wires: r.wires, junctions: [] }, terms)) !== sig0)
      return { error: '引き直すとつながり方が変わってしまうため、変更しませんでした' };
    const before = ugliness(doc.wires), after = ugliness(r.wires);
    if (after.score > before.score - 0.5) return { error: '配線はすでに整っています', same: true, before, after };
    return { wires: r.wires, before, after };
  }

  /* terms[i] が組 grp0[i] に属するとして、組ごとに全ピンを結ぶ配線を作る */
  function routeGroups(doc, terms, grp0) {
    if (terms.some(t => t.x % GS || t.y % GS)) return { error: 'グリッドに乗っていないピンがあるため、自動では整えられません' };
    { const ids = new Map(); grp0 = grp0.map(g => { if (!ids.has(g)) ids.set(g, ids.size); return ids.get(g); }); }   // 組の名前を 0 からの番号に

    // ---- 作業用のマス目 (全体の外接矩形 + 余白) ----
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    const acc = (x, y) => { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; };
    doc.components.forEach(c => { if (!C1.symOf(c)) return; const b = C1.compBBox(c); acc(b.x0, b.y0); acc(b.x1, b.y1); });
    (doc.wires || []).forEach(w => { acc(w.x1, w.y1); acc(w.x2, w.y2); });
    const M = 4;
    x0 = Math.floor(x0 / GS) * GS - M * GS; y0 = Math.floor(y0 / GS) * GS - M * GS;
    const cols = Math.ceil((x1 - x0) / GS) + M + 1, rows = Math.ceil((y1 - y0) / GS) + M + 1, NC = cols * rows;
    if (NC > 600000) return { error: '図面が大きすぎるため、自動では整えられません' };
    const cellOf = (x, y) => Math.round((y - y0) / GS) * cols + Math.round((x - x0) / GS);
    const cx = i => i % cols, cy = i => (i / cols) | 0;

    // ---- 部品の上は通さない。ピンの穴だけは外へ出られるように開ける ----
    const body = new Uint8Array(NC), near = new Uint8Array(NC);
    doc.components.forEach(c => {
      if (!C1.symOf(c)) return;
      const b = C1.compBBox(c);
      for (let y = Math.ceil((b.y0 + 1e-6) / GS) * GS; y < b.y1 - 1e-6; y += GS)
        for (let x = Math.ceil((b.x0 + 1e-6) / GS) * GS; x < b.x1 - 1e-6; x += GS) body[cellOf(x, y)] = 1;
      // 細い部品 (高さが 1 マス未満) は、ピンを結ぶ線上をふさぐ
      const ps = C1.compPins(c);
      if (ps.length === 2 && (ps[0].x === ps[1].x || ps[0].y === ps[1].y)) {
        const dx = Math.sign(ps[1].x - ps[0].x) * GS, dy = Math.sign(ps[1].y - ps[0].y) * GS;
        for (let x = ps[0].x + dx, y = ps[0].y + dy; x !== ps[1].x || y !== ps[1].y; x += dx, y += dy) body[cellOf(x, y)] = 1;
      }
    });
    const pinGrp = new Int32Array(NC).fill(-1), pinOut = new Int8Array(NC).fill(-1);
    terms.forEach((t, i) => {
      const cell = cellOf(t.x, t.y), b = t.bb;
      pinGrp[cell] = grp0[i];
      // いちばん近い外形の辺の向きへ出る
      const d = [b.x1 - t.x, b.y1 - t.y, t.x - b.x0, t.y - b.y0];
      let k = 0; for (let q = 1; q < 4; q++) if (d[q] < d[k] - 1e-6) k = q;
      // 2 本足の部品は、相手のピンと反対の向きへ出す
      const ps = C1.compPins(t.comp);
      if (ps.length === 2) {
        const o = ps[0].x === t.x && ps[0].y === t.y ? ps[1] : ps[0];
        if (o.x !== t.x || o.y !== t.y) k = Math.abs(o.x - t.x) >= Math.abs(o.y - t.y) ? (o.x > t.x ? 2 : 0) : (o.y > t.y ? 3 : 1);
      }
      pinOut[cell] = k;
      body[cell] = 0;
      for (let x = t.x + DX[k] * GS, y = t.y + DY[k] * GS, n = 0; n < 8 && x > b.x0 - 1e-6 && x < b.x1 + 1e-6 && y > b.y0 - 1e-6 && y < b.y1 + 1e-6; x += DX[k] * GS, y += DY[k] * GS, n++)
        body[cellOf(x, y)] = 0;
    });
    for (let i = 0; i < NC; i++) if (body[i]) {
      const c = cx(i), r = cy(i);
      if (c > 0) near[i - 1] = 1; if (c < cols - 1) near[i + 1] = 1; if (r > 0) near[i - cols] = 1; if (r < rows - 1) near[i + cols] = 1;
    }

    // ---- マスの使用状況 ----
    const own = new Int32Array(NC).fill(-1);      // そのマスを使っている組
    const flag = new Uint8Array(NC);              // 1=横に通る 2=縦に通る 4=端・角・分岐
    const cross = new Int32Array(NC).fill(-1);    // 直角に横切っている別の組

    const gsc = new Float64Array(NC * 5), par = new Int32Array(NC * 5), stamp = new Int32Array(NC * 5);
    let mark = 0;

    function route(g, tree, goals) {
      mark++;
      const heap = new Heap();
      const single = goals.size === 1 ? [...goals][0] : -1;
      const H = i => single >= 0 ? STEP * (Math.abs(cx(i) - cx(single)) + Math.abs(cy(i) - cy(single))) : 0;
      tree.forEach(i => {
        if (cross[i] !== -1) return;              // 交差しているマスからは枝を出さない
        const s = i * 5 + 4; gsc[s] = 0; par[s] = -1; stamp[s] = mark; heap.push(H(i), s);
      });
      const done = new Set();
      while (heap.k.length) {
        const s = heap.pop();
        if (done.has(s)) continue; done.add(s);
        const d0 = s % 5, i = (s - d0) / 5;
        if (goals.has(i) && d0 !== 4) return s;
        const foreign = own[i] !== -1 && own[i] !== g;      // 他の配線を横切っている途中 → まっすぐ抜けるしかない
        const c = cx(i), r = cy(i), g0 = gsc[s];
        for (let d = 0; d < 4; d++) {
          if (foreign && d !== d0) continue;
          if (d0 !== 4 && ((d + 2) & 3) === d0) continue;   // 逆戻りしない
          const nc = c + DX[d], nr = r + DY[d];
          if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
          const j = nr * cols + nc;
          if (body[j]) continue;
          if (pinGrp[j] !== -1 && pinGrp[j] !== g) continue;
          let cst = STEP;
          if (own[j] === g) { if (!goals.has(j)) continue; }   // 自分の線へは戻らない (まだつないでいないピンは別)
          else if (own[j] !== -1) {
            if (cross[j] !== -1) continue;
            if (flag[j] !== ((d & 1) ? 1 : 2)) continue;    // 直角にまっすぐ通っている線だけ横切れる
            cst += CROSS;
          }
          if (d0 !== 4 && d0 !== d) cst += BEND;
          if (near[j]) cst += NEAR;
          if (d0 === 4 && pinOut[i] !== -1 && pinOut[i] !== d) cst += PINDIR;                 // ピンからは外向きに出る
          if (goals.has(j) && pinOut[j] !== -1 && ((pinOut[j] + 2) & 3) !== d) cst += PINDIR;  // ピンへは外側から入る
          const ns = j * 5 + d, ng = g0 + cst;
          if (stamp[ns] !== mark) { stamp[ns] = mark; gsc[ns] = Infinity; }
          if (ng < gsc[ns]) { gsc[ns] = ng; par[ns] = s; heap.push(ng + H(j), ns); }
        }
      }
      return -1;
    }

    // 1 本の経路 (マスの列) を使用状況に書き込む
    function markPath(g, cells) {
      const axis = (a, b) => (Math.abs(a - b) === 1 ? 1 : 2);
      for (let k = 0; k < cells.length; k++) {
        const i = cells[k], prev = k > 0 ? cells[k - 1] : -1, next = k + 1 < cells.length ? cells[k + 1] : -1;
        if (own[i] !== -1 && own[i] !== g) { cross[i] = g; continue; }
        own[i] = g;
        if (prev >= 0) flag[i] |= axis(prev, i);
        if (next >= 0) flag[i] |= axis(i, next);
        if (prev < 0 || next < 0 || axis(prev, i) !== axis(i, next)) flag[i] |= 4;
      }
    }

    // ---- 組の一覧: 短いものから ----
    const groups = new Map();
    terms.forEach((t, i) => { const g = grp0[i]; if (!groups.has(g)) groups.set(g, new Set()); groups.get(g).add(cellOf(t.x, t.y)); });
    const list = [...groups.entries()].filter(([, s]) => s.size >= 2).map(([g, s]) => {
      let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
      s.forEach(i => { a = Math.min(a, cx(i)); b = Math.min(b, cy(i)); c = Math.max(c, cx(i)); d = Math.max(d, cy(i)); });
      return { g, cells: [...s], span: (c - a) + (d - b) };
    }).sort((p, q) => p.span - q.span || p.cells.length - q.cells.length);

    const paths = new Map(), costOf = new Map();
    // 使用状況を作り直す (skip の組だけ除く)。ピンのマスは最初に押さえて、他の組に踏まれないようにする
    function reset(skip) {
      own.fill(-1); flag.fill(0); cross.fill(-1);
      list.forEach(n => n.cells.forEach(i => { own[i] = n.g; flag[i] |= 4; }));
      paths.forEach((ps, g) => { if (g !== skip) ps.forEach(cells => markPath(g, cells)); });
    }
    // 1 つの組を、指定のピンから始めて引く。first があれば最初にそのピンまで幹を引く
    function tryNet(n, start, first) {
      const tree = new Set([start]), goals = new Set(n.cells.filter(i => i !== start)), out = [];
      let cost = 0;
      while (goals.size) {
        const s = route(n.g, tree, first != null ? new Set([first]) : goals); first = null;
        if (s < 0) return null;
        cost += gsc[s];
        const cells = [];
        for (let q = s; q !== -1; q = par[q]) cells.push((q - (q % 5)) / 5);
        cells.reverse();
        markPath(n.g, cells);
        cells.forEach(i => { if (own[i] === n.g) tree.add(i); });
        out.push(cells); goals.delete(cells[cells.length - 1]);
      }
      return { paths: out, cost };
    }
    // 始め方をいくつか試す: 各ピンから近い順につなぐ / いちばん離れた 2 ピンを幹にして残りを枝でつなぐ
    function variants(n) {
      const cs = n.cells, v = [];
      const far = (f) => { let a = cs[0], b = cs[1], bd = -1; for (const p of cs) for (const q of cs) { const d = f(p, q); if (d > bd) { bd = d; a = p; b = q; } } return [a, b]; };
      if (cs.length > 2) {
        [far((p, q) => Math.abs(cx(p) - cx(q)) + Math.abs(cy(p) - cy(q))), far((p, q) => Math.abs(cx(p) - cx(q))), far((p, q) => Math.abs(cy(p) - cy(q)))]
          .forEach(([a, b]) => { if (a !== b) v.push([a, b]); });
      }
      (cs.length <= 5 ? cs : cs.slice(0, 5)).forEach(a => v.push([a, null]));
      return v;
    }
    function best(n) {
      let b = null;
      for (const [start, first] of variants(n)) {
        reset(n.g);
        const r = tryNet(n, start, first);
        if (r && (!b || r.cost < b.cost - 1e-9)) b = r;
      }
      return b;
    }
    for (const n of list) {
      const b = best(n);
      if (!b) return { error: '配線の通り道が見つからない箇所があります (部品の間を少し広げてください)', at: n.cells.map(i => [x0 + cx(i) * GS, y0 + cy(i) * GS, body[i]]) };
      paths.set(n.g, b.paths); costOf.set(n.g, b.cost);
    }
    // 他の組が決まった状態で、1 組ずつ引き直して良くなれば採用する
    for (let pass = 0; pass < 2; pass++) {
      let improved = false;
      for (const n of list) {
        const b = best(n);
        if (b && b.cost < costOf.get(n.g) - 1e-9) { paths.set(n.g, b.paths); costOf.set(n.g, b.cost); improved = true; }
      }
      if (!improved) break;
    }
    const edges = new Map();
    paths.forEach((ps, g) => {
      const E = new Set(); edges.set(g, E);
      ps.forEach(cells => { for (let k = 1; k < cells.length; k++) E.add(Math.min(cells[k - 1], cells[k]) * NC + Math.max(cells[k - 1], cells[k])); });
    });

    // ---- マスの並びを、まっすぐな線分にまとめる ----
    const wires = [];
    edges.forEach((E, g) => {
      const adj = new Map();
      const link = (a, b) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); };
      E.forEach(e => { const a = Math.floor(e / NC), b = e % NC; link(a, b); link(b, a); });
      const isNode = i => {
        const nb = adj.get(i);
        if (nb.length !== 2) return true;
        if (pinGrp[i] === g) return true;
        return Math.abs(nb[0] - i) !== Math.abs(nb[1] - i);   // 角
      };
      const seen = new Set();
      adj.forEach((nb, a) => {
        if (!isNode(a)) return;
        for (const first of nb) {
          const k0 = Math.min(a, first) * NC + Math.max(a, first);
          if (seen.has(k0)) continue;
          let prev = a, cur = first; seen.add(k0);
          while (!isNode(cur)) {
            const nx = adj.get(cur)[0] === prev ? adj.get(cur)[1] : adj.get(cur)[0];
            seen.add(Math.min(cur, nx) * NC + Math.max(cur, nx)); prev = cur; cur = nx;
          }
          wires.push({ x1: x0 + cx(a) * GS, y1: y0 + cy(a) * GS, x2: x0 + cx(cur) * GS, y2: y0 + cy(cur) * GS });
        }
      });
    });

    return { wires };
  }

  /* =====================================================================
     自動レイアウト: 部品を並べ直してから配線を引き直す
       ・電源につながる足は上、GND につながる足は下を向ける (抵抗などは回転させる)
       ・つながっている足どうしは一直線に並ぶ位置へ寄せる
       ・電源記号は、つながる足のすぐそばに 1 つずつ置き直す (長い電源線を引き回さない)
       ・部品・ラベル・電源記号が重ならない範囲でできるだけ小さくまとめる
     焼きなまし法で配置を探し、乱数を変えて数通り作って、配線がいちばんきれいなものを返す
     ===================================================================== */
  const netSig = d => C1.extractNets(d).filter(n => n.pins.length)
    .map(n => (n.power ? n.name : '') + '=' + n.pins.map(p => p.ref + '.' + p.pin.n).sort().join(',')).sort().join('|');
  const railCls = name => {
    const m = String(name).toUpperCase().replace(/\s/g, '');
    if (/^(GND|AGND|DGND|SGND|VSS|0V|COM)$/.test(m)) return 'gnd';
    if (/^(VEE|V-|VSS-)/.test(m) || /^-/.test(m)) return 'vee';
    return 'vcc';
  };

  function layout(doc, opts) {
    opts = opts || {};
    const CD = global.CADDoc;
    const nets = C1.extractNets(doc);
    const sig0 = netSig(doc);
    const isPwrSym = c => { const s = C1.symOf(c); return s && s.virtual && s.id !== 'NET'; };
    const items = doc.components.filter(c => C1.symOf(c) && !isPwrSym(c));
    if (items.filter(c => !C1.symOf(c).virtual).length < 2) return { error: '並べ直す部品がありません' };
    // 電源記号のひな形 (ネット名 → 記号の種類)
    const tmpl = new Map();
    doc.components.filter(isPwrSym).forEach(c => { const s = C1.symOf(c), nm = (c.props && c.props.net) || s.net; if (!tmpl.has(nm)) tmpl.set(nm, { type: c.type, props: Object.assign({}, c.props) }); });
    // ピン → ネット
    const netOfPin = new Map(), byName = new Map();
    nets.forEach((n, ni) => { n.pins.forEach(p => netOfPin.set(p.comp.id + ':' + p.pin.n, ni)); if (n.power) byName.set(n.name, ni); });
    const rail = nets.map(n => (n.rail && tmpl.has(n.name) ? railCls(n.name) : null));
    const symGeo = new Map();   // 電源記号の形 (ピンの位置と外形)
    tmpl.forEach((t, nm) => {
      const c = { type: t.type, x: 0, y: 0, rot: 0, props: t.props }, p = C1.compPins(c)[0], b = C1.compBBox(c);
      symGeo.set(nm, { px: p.x, py: p.y, b });
    });

    // ---- 部品ごと・向きごとの形を先に作っておく ----
    const N = items.length;
    const G = v => Math.round(v / GS);
    const shapes = items.map(c => {
      const s = C1.symOf(c), two = s.pins.length === 2 && !s.virtual;
      const rots = two ? [0, 90, 180, 270] : [c.rot || 0];
      return rots.map(rot => {
        const t = Object.assign({}, c, { x: 0, y: 0, rot }), b = C1.compBBox(t), ps = C1.compPins(t);
        const ext = { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 };
        const grow = (x0, y0, x1, y1) => { ext.x0 = Math.min(ext.x0, x0); ext.y0 = Math.min(ext.y0, y0); ext.x1 = Math.max(ext.x1, x1); ext.y1 = Math.max(ext.y1, y1); };
        const outOf = p => {
          const d = [b.x1 - p.x, b.y1 - p.y, p.x - b.x0, p.y - b.y0];
          let k = 0; for (let q = 1; q < 4; q++) if (d[q] < d[k] - 1e-6) k = q;
          if (ps.length === 2) { const o = ps[0] === p ? ps[1] : ps[0]; if (o.x !== p.x || o.y !== p.y) k = Math.abs(o.x - p.x) >= Math.abs(o.y - p.y) ? (o.x > p.x ? 2 : 0) : (o.y > p.y ? 3 : 1); }
          return k;
        };
        const stubRects = [];
        const pins = ps.map(p => {
          const k = outOf(p);
          const ni = s.virtual ? byName.get((c.props && c.props.net) || s.net) : netOfPin.get(c.id + ':' + p.pin.n);
          const pin = { x: p.x, y: p.y, out: k, net: ni == null ? -1 : ni, cls: ni == null ? null : rail[ni], n: p.pin.n, stub: null, bad: 0 };
          if (pin.cls) {
            // 電源記号を足のそばに置く: VCC は上、GND・負電源は下
            const want = pin.cls === 'vcc' ? 3 : 1, g = symGeo.get(nets[ni].name);
            // 同じ部品の他の電源記号や足の出口とぶつかるときは、外側へずらす
            const rectAt = (tx, ty) => ({ x0: tx - g.px + g.b.x0 - 6, y0: ty - g.py + g.b.y0 - 2, x1: tx - g.px + g.b.x1 + 6, y1: ty - g.py + g.b.y1 + 2 });
            const clash = r => stubRects.some(q => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0) ||
              ps.some(o => o !== p && [[o.x, o.y], [o.x + DX[outOf(o)] * GS, o.y + DY[outOf(o)] * GS]].some(([x, y]) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1));
            let tx = p.x, ty = p.y;
            if (k === want) { ty += DY[want] * 2 * GS; }
            else if (k === ((want + 2) & 3)) { tx += DX[k] * 2 * GS; ty += DY[k] * 2 * GS; pin.bad = 7; }
            else {
              pin.bad = 2.5;
              for (let d = 2; d <= 10; d += 2) { tx = p.x + DX[k] * d * GS; ty = p.y + DY[want] * 2 * GS; if (!clash(rectAt(tx, ty))) break; pin.bad += 0.5; }
            }
            stubRects.push(rectAt(tx, ty));
            pin.stub = { x: tx - g.px, y: ty - g.py, name: nets[ni].name };
            grow(pin.stub.x + g.b.x0 - 4, pin.stub.y + g.b.y0, pin.stub.x + g.b.x1 + 4, pin.stub.y + g.b.y1);
          }
          return pin;
        });
        if (!s.virtual) {   // ラベル (番号・定数) の場所を確保
          const wl = Math.max((c.ref || '').length, String(c.val || '').length) * 5.6 + 8;
          if ((rot % 180) === 90) grow(b.x0, b.y0, b.x1 + wl, b.y1); else grow(Math.min(b.x0, -wl / 2), b.y0 - 14, Math.max(b.x1, wl / 2), b.y1 + 16);
        }
        return { rot, pins, x0: G(ext.x0) - 1, y0: G(ext.y0) - 1, x1: G(ext.x1) + 1, y1: G(ext.y1) + 1 };
      });
    });
    const sigNets = [];   // 信号線: [部品番号, ピン番号] の並び
    nets.forEach((n, ni) => {
      if (rail[ni]) return;
      const ps = [];
      items.forEach((c, i) => shapes[i][0].pins.forEach((p, k) => { if (p.net === ni) ps.push([i, k]); }));
      if (ps.length >= 2) sigNets.push(ps);
    });
    const hasCls = items.map((c, i) => { const ps = shapes[i][0].pins; return (ps.some(p => p.cls === 'vcc') ? 1 : 0) - (ps.some(p => p.cls && p.cls !== 'vcc') ? 1 : 0); });

    function solve(seed) {
      let sd = seed >>> 0 || 1;
      const rnd = () => { sd ^= sd << 13; sd >>>= 0; sd ^= sd >> 17; sd ^= sd << 5; sd >>>= 0; return sd / 4294967296; };
      const ri = n => Math.floor(rnd() * n) % n;
      const pos = items.map((c, i) => ({ x: G(c.x), y: G(c.y), r: Math.max(0, shapes[i].findIndex(s => s.rot === (c.rot || 0))) }));
      const sh = i => shapes[i][pos[i].r];
      function cost() {
        let v = 0, bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
        for (let i = 0; i < N; i++) {
          const a = sh(i), p = pos[i], ax0 = p.x + a.x0, ay0 = p.y + a.y0, ax1 = p.x + a.x1, ay1 = p.y + a.y1;
          if (ax0 < bx0) bx0 = ax0; if (ay0 < by0) by0 = ay0; if (ax1 > bx1) bx1 = ax1; if (ay1 > by1) by1 = ay1;
          for (let j = i + 1; j < N; j++) {
            const b = sh(j), q = pos[j];
            const ox = Math.min(ax1, q.x + b.x1) - Math.max(ax0, q.x + b.x0), oy = Math.min(ay1, q.y + b.y1) - Math.max(ay0, q.y + b.y0);
            if (ox > 0 && oy > 0) v += 60 + 25 * ox * oy;
          }
          for (const pin of a.pins) v += pin.bad;
          v -= 0.12 * hasCls[i] * -p.y;   // 電源につながる部品は上、GND につながる部品は下へ
        }
        for (const ps of sigNets) {
          let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
          for (const [i, k] of ps) { const pin = sh(i).pins[k], x = pos[i].x + G(pin.x), y = pos[i].y + G(pin.y); if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
          const dx = x1 - x0, dy = y1 - y0;
          v += dx + dy;
          if (ps.length === 2) { if (dx && dy) v += 2.5; }
          else v += 0.6 * Math.min(dx, dy);                       // 3 本以上は、幹が 1 本で済む細長い形が良い
          const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
          for (const [i, k] of ps) {                               // 足の向いている側に相手がいるように
            const pin = sh(i).pins[k], x = pos[i].x + G(pin.x), y = pos[i].y + G(pin.y);
            const t = (mx - x) * DX[pin.out] + (my - y) * DY[pin.out];
            if (t < -0.5) v += 3;
          }
        }
        return v + 0.35 * ((bx1 - bx0) + (by1 - by0));
      }
      let cur = cost(), best = cur, bestPos = pos.map(p => Object.assign({}, p));
      const iters = Math.min(90000, 12000 + 4000 * N), T0 = 14;
      for (let it = 0; it < iters; it++) {
        const T = T0 * Math.exp(-7 * it / iters);
        const i = ri(N), p = pos[i], old = { x: p.x, y: p.y, r: p.r };
        const kind = rnd();
        let j = -1, oj = null;
        if (kind < 0.62) { const amp = Math.max(1, Math.round(1 + 12 * T / T0)); p.x += ri(2 * amp + 1) - amp; p.y += ri(2 * amp + 1) - amp; }
        else if (kind < 0.82 && shapes[i].length > 1) p.r = ri(shapes[i].length);
        else { j = ri(N); if (j === i) continue; const q = pos[j]; oj = { x: q.x, y: q.y }; p.x = q.x; p.y = q.y; q.x = old.x; q.y = old.y; }
        const nc = cost(), d = nc - cur;
        if (d <= 0 || rnd() < Math.exp(-d / Math.max(1e-6, T))) {
          cur = nc;
          if (cur < best) { best = cur; bestPos = pos.map(q => Object.assign({}, q)); }
        } else { p.x = old.x; p.y = old.y; p.r = old.r; if (j >= 0) { pos[j].x = oj.x; pos[j].y = oj.y; } }
      }
      return { pos: bestPos, cost: best };
    }

    function build(sol) {
      // 元の図と同じあたりに置く (左上をそろえる)
      let ox = 1e9, oy = 1e9, nx = 1e9, ny = 1e9;
      items.forEach((c, i) => { ox = Math.min(ox, G(c.x)); oy = Math.min(oy, G(c.y)); nx = Math.min(nx, sol.pos[i].x); ny = Math.min(ny, sol.pos[i].y); });
      const out = { components: [], wires: [], junctions: [], nextId: doc.nextId };
      const stubs = [];
      items.forEach((c, i) => {
        const p = sol.pos[i], s = shapes[i][p.r];
        const nc = Object.assign({}, c, { x: (p.x - nx + ox) * GS, y: (p.y - ny + oy) * GS, rot: s.rot, props: Object.assign({}, c.props) });
        out.components.push(nc);
        s.pins.forEach(pin => { if (pin.stub) stubs.push({ comp: nc, n: pin.n, x: nc.x + pin.stub.x, y: nc.y + pin.stub.y, name: pin.stub.name }); });
      });
      const stubOf = new Map();
      stubs.forEach((st, k) => {
        const t = tmpl.get(st.name), sc = CD.addComponent(out, t.type, st.x, st.y, 0, { props: t.props });
        stubOf.set(st.comp.id + ':' + st.n, 'S' + k); stubOf.set(sc.id + ':1', 'S' + k); stubOf.set(sc.id, 'S' + k);
      });
      const terms = terminals(out);
      const grp = terms.map((t, i) => {
        const s = C1.symOf(t.comp), key = t.comp.id + ':' + t.pin.n;
        if (stubOf.has(key)) return stubOf.get(key);
        if (isPwrSym(t.comp)) return stubOf.get(t.comp.id);
        const ni = s.virtual ? byName.get((t.comp.props && t.comp.props.net) || s.net) : netOfPin.get(key);
        return ni == null ? 'U' + i : 'N' + ni;
      });
      const r = routeGroups(out, terms, grp);
      if (r.error) { if (opts.debug) console.log('route', r.error, JSON.stringify(r.at), JSON.stringify(out.components.map(c => [c.type, c.ref, c.x, c.y, c.rot]))); return null; }
      r.wires.forEach(w => CD.addWire(out, w.x1, w.y1, w.x2, w.y2));
      if (netSig(out) !== sig0) { if (opts.debug) console.log('sig\n' + sig0 + '\n' + netSig(out)); return null; }
      return { doc: out, after: ugliness(out.wires) };
    }

    let bestR = null;
    const tries = opts.tries || 4, seed0 = opts.seed || 20260918;
    for (let k = 0; k < tries; k++) {
      const r = build(solve((seed0 + k * 2654435761) >>> 0));
      if (r && (!bestR || r.after.score < bestR.after.score)) bestR = r;
    }
    if (!bestR) return { error: '自動レイアウトできませんでした (配線の通り道が見つかりません)' };
    bestR.before = ugliness(doc.wires);
    return bestR;
  }

  global.CADTidy = { rewire, layout, ugliness };
})(typeof window !== 'undefined' ? window : globalThis);
