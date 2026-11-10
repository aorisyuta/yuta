/* =====================================================================
   UniBoard CAD — core part 2
   基板プロジェクト構築 / 自動配置(焼きなまし) / 2層A*配線 / ストリップボード
   ===================================================================== */
(function (global) {
  'use strict';
  const C1 = global.CADCore;
  const { symOf, compPins, rotXY } = C1;

  /* ---- どのブラウザでも同じ結果になる計算 (Math.exp / hypot はエンジンで末尾の桁が違うことがある) ---- */
  const hyp = (a, b) => Math.sqrt(a * a + b * b);
  function detExp(x) {
    if (x < -30) return 0;          // 乱数の最小値 2^-32 より十分小さい
    const k = Math.round(x * 1.4426950408889634), r = x - k * 0.6931471805599453;
    let t = 1, sum = 1;
    for (let i = 1; i <= 12; i++) { t = t * r / i; sum += t; }
    let q = 1;
    if (k < 0) for (let i = 0; i < -k; i++) q *= 0.5; else for (let i = 0; i < k; i++) q *= 2;
    return sum * q;
  }
  /* ---------------- フットプリント回転 ---------------- */
  function rotFp(fp, r) {
    const pads = fp.pads.map(p => { const [c, rr] = rotXY(p.c, p.r, r); return { c, r: rr, pin: p.pin }; });
    const b = fp.body || { x: 0, y: 0, w: 0, h: 0, shape: 'rect' };
    const cor = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].map(p => rotXY(p[0], p[1], r));
    let bx0 = Math.min(...cor.map(p => p[0])), by0 = Math.min(...cor.map(p => p[1]));
    let bx1 = Math.max(...cor.map(p => p[0])), by1 = Math.max(...cor.map(p => p[1]));
    // 穴(c,r)は [c-.5,c+.5]×[r-.5,r+.5] を占めるとみなし、本体と重なる穴だけを占有とする
    const lo = v => Math.ceil(v - 0.5 + 1e-6), hi = v => Math.floor(v + 0.5 - 1e-6);
    let cMin = Math.min(lo(bx0), ...pads.map(p => p.c));
    let rMin = Math.min(lo(by0), ...pads.map(p => p.r));
    const dc = -cMin, dr = -rMin;
    pads.forEach(p => { p.c += dc; p.r += dr; });
    bx0 += dc; bx1 += dc; by0 += dr; by1 += dr;
    let cMax = Math.max(hi(bx1), ...pads.map(p => p.c));
    let rMax = Math.max(hi(by1), ...pads.map(p => p.r));
    const cells = new Set(), bodyCells = new Set();
    pads.forEach(p => cells.add(p.c + ',' + p.r));
    for (let c = lo(bx0); c <= hi(bx1); c++)
      for (let rr = lo(by0); rr <= hi(by1); rr++) { cells.add(c + ',' + rr); bodyCells.add(c + ',' + rr); }
    // 立体的なパッケージ(IC・TO-92・ラジアル等)は部品面ジャンパが下を通れない
    const solid = Math.min(bx1 - bx0, by1 - by0) >= 0.95;
    return {
      pads, body: { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0, shape: b.shape }, solid,
      cells: [...cells].map(s => s.split(',').map(Number)),
      bodyCells: [...bodyCells].map(s => s.split(',').map(Number)),
      w: cMax + 1, h: rMax + 1, rot: r
    };
  }

  /* ネットの種別 (パターン図の色分けに使う) */
  function netClass(n) {
    if (!n.rail) return 'sig';
    const m = String(n.name).toUpperCase().replace(/\s/g, '');
    if (/^(GND|AGND|DGND|SGND|VSS|0V|COM)$/.test(m)) return 'gnd';
    if (/^(VEE|V-|VSS-)/.test(m) || /^-/.test(m)) return 'vee';
    return 'vcc';
  }

  /* ---------------- 基板プロジェクト構築 ---------------- */
  function buildProject(doc, nets, opts) {
    opts = opts || {};
    const comps = [], compIndex = new Map();
    for (const c of doc.components) {
      const s = symOf(c); if (!s || s.virtual || s.simOnly) continue;
      if (c.props && c.props.offboard) continue;     // パネル取付など基板に載せない部品
      const fp = s.fp ? s.fp(c) : C1.fpInline(s.pins.length, 1);
      const rots = [0, 90, 180, 270].map(r => rotFp(fp, r));
      const padByPin = new Map();
      fp.pads.forEach((p, i) => padByPin.set(p.pin, i));
      const entry = {
        id: c.id, ref: c.ref, val: c.val, type: c.type, name: s.name,
        fp, rots, padByPin, pos: { c: 0, r: 0, rot: 0 }, nPads: fp.pads.length,
        edge: /^(J\d+|TB\d*|DCJ)$/.test(c.type),
        pinNames: s.pins.reduce((m, p) => (m[p.n] = p.name || String(p.n), m), {})
      };
      compIndex.set(c.id, comps.length); comps.push(entry);
    }

    // 電源レール → 電源コネクタを自動生成
    const isConn = p => { const ci = compIndex.get(p.comp.id); return ci !== undefined && comps[ci].edge; };
    const rails = nets.filter(n => n.rail && n.pins.length > 0 && !n.pins.some(isConn));
    let pwr = null;
    if (rails.length && opts.powerHeader !== false) {
      const fp = C1.fpInline(rails.length, 1, 0.55, 'header');
      pwr = {
        id: '#PWR', ref: 'J_PWR', val: rails.map(n => n.name).join('/'), type: 'PWRHDR', name: '電源コネクタ',
        fp, rots: [0, 90, 180, 270].map(r => rotFp(fp, r)),
        padByPin: new Map(rails.map((n, i) => [i + 1, i])),
        pos: { c: 0, r: 0, rot: 0 }, nPads: rails.length, isPower: true, edge: true,
        pinNames: rails.reduce((m, n, i) => (m[i + 1] = n.name, m), {})
      };
      comps.push(pwr);
    }

    const bnets = [];
    for (const n of nets) {
      const pads = [];
      for (const p of n.pins) {
        const ci = compIndex.get(p.comp.id); if (ci === undefined) continue;
        const pi = comps[ci].padByPin.get(p.pin.n);
        if (pi === undefined) continue;
        pads.push({ ci, pi, ref: comps[ci].ref, pin: p.pin.name || p.pin.n });
      }
      if (pwr && n.rail && rails.includes(n)) {
        const k = rails.indexOf(n);
        if (k >= 0) pads.push({ ci: comps.length - 1, pi: k, ref: 'J_PWR', pin: n.name });
      }
      if (pads.length >= 1) bnets.push({ name: n.name, pads, index: bnets.length, rail: !!n.rail, cls: netClass(n) });
    }
    for (const c of comps) c.nets = [];
    bnets.forEach(n => { const s = new Set(n.pads.map(p => p.ci)); s.forEach(ci => comps[ci].nets.push(n.index)); });
    return { comps, nets: bnets };
  }

  /* 配置後、実際に使っている範囲まで基板を切り詰めて中央に寄せる */
  /* 四隅 k×k 穴を使用禁止に (ケース取付ねじ穴用) */
  function cornerKeepout(cols, rows, k) {
    const a = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
      if ((c < k || c >= cols - k) && (r < k || r >= rows - k)) a.push(r * cols + c);
    return a;
  }
  function compactBoard(prj, board, margin) {
    const m = margin == null ? 2 : margin;
    let c0 = 1e9, r0 = 1e9, c1 = -1e9, r1 = -1e9;
    for (const c of prj.comps) {
      const s = c.rots[((c.pos.rot / 90) | 0) & 3];
      c0 = Math.min(c0, c.pos.c); r0 = Math.min(r0, c.pos.r);
      c1 = Math.max(c1, c.pos.c + s.w - 1); r1 = Math.max(r1, c.pos.r + s.h - 1);
    }
    if (c0 > c1) return board;
    const cols = Math.max(6, Math.min(board.cols, c1 - c0 + 1 + 2 * m));
    const rows = Math.max(5, Math.min(board.rows, r1 - r0 + 1 + 2 * m));
    const dc = Math.round((cols - (c1 - c0 + 1)) / 2) - c0;
    const dr = Math.round((rows - (r1 - r0 + 1)) / 2) - r0;
    prj.comps.forEach(c => { c.pos.c += dc; c.pos.r += dr; });
    board.cols = cols; board.rows = rows;
    return board;
  }

  function autoBoardSize(prj, type) {
    let area = 0;
    for (const c of prj.comps) area += c.rots[0].w * c.rots[0].h;
    const need = Math.max(48, area / (type === 'strip' ? 0.34 : 0.30));
    let cols = Math.ceil(Math.sqrt(need * 1.45));
    cols = Math.max(10, Math.min(90, cols));
    let rows = Math.max(8, Math.min(70, Math.ceil(need / cols)));
    return { cols, rows };
  }

  /* ---------------- 自動配置 (焼きなまし) ---------------- */
  function makePlacer(prj, board, opts) {
    opts = Object.assign({ overlapW: 260, jumpW: 26, seed: 12345, strip: board.type === 'strip' }, opts);
    // 美しい配線: GND・電源は短く一筆書きに、同じ機能ブロックの部品は一か所にまとめる
    const beauty = opts.beauty !== false;
    const gndW = opts.gndW || 5, railW = opts.railW || 1.5, branchW = opts.branchW || 1.2;
    const groupW = opts.groupW == null ? 0.4 : opts.groupW, intrudeW = opts.intrudeW == null ? 5 : opts.intrudeW, overlapGW = opts.overlapGW == null ? 0.5 : opts.overlapGW;
    // 組みやすさ優先: 配線は縦横だけで引く前提で距離を測り、部品の向きをそろえる
    const easy = !!opts.easy && !opts.strip;
    const alignW = opts.alignW == null ? 3 : opts.alignW, icRotW = opts.icRotW == null ? 8 : opts.icRotW, turnW = opts.turnW == null ? 1.2 : opts.turnW;
    const pdist = easy
      ? (dx, dy) => { dx = Math.abs(dx); dy = Math.abs(dy); return dx + dy + (dx && dy ? turnW : 0); }
      : (dx, dy) => octile(dx, dy);
    // 2 本足の横長部品 (抵抗・ダイオード等) と、足の多い部品 (IC・コネクタ) を覚えておく
    const axial = [], multi = [];
    if (easy) prj.comps.forEach((c, i) => {
      const s0 = c.rots[0];
      if (c.nPads === 2 && s0.w !== s0.h) axial.push(i);
      else if (c.nPads >= 6 && !c.edge) multi.push(i);
    });
    if (beauty && !prj.groups) functionalGroups(prj);
    const GRP = beauty && prj.groups && prj.nGroups ? prj.groups : null;
    const N = prj.comps.length, cols = board.cols, rows = board.rows, NC = cols * rows;
    const occ = new Int16Array(NC);
    if (board.keepout) for (const k of board.keepout) if (k >= 0 && k < NC) occ[k] = 1;
    let overlap = 0;
    // 部品の周り 1 穴 (上下左右) を「なるべく空ける」: 配線の通り道を残す
    const occH = new Int16Array(NC), crowdW = opts.crowdW || 0;
    let crowd = 0;
    const haloOf = sh => {
      if (sh.halo) return sh.halo;
      const set = new Set(sh.cells.map(q => q[0] + ',' + q[1])), h = new Set();
      for (const [c, r] of sh.cells) for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = (c + dc) + ',' + (r + dr); if (!set.has(k)) h.add(k);
      }
      return (sh.halo = [...h].map(t => t.split(',').map(Number)));
    };
    const edgeW = opts.edgeW == null ? 30 : opts.edgeW;
    const pos = prj.comps.map(c => ({ c: c.pos.c, r: c.pos.r, rot: c.pos.rot }));
    const netCost = new Float64Array(prj.nets.length);
    let wire = 0;

    let sd = opts.seed >>> 0;
    const rnd = () => { sd ^= sd << 13; sd >>>= 0; sd ^= sd >> 17; sd ^= sd << 5; sd >>>= 0; return sd / 4294967296; };
    const ri = n => Math.floor(rnd() * n) % n;

    const rotIdx = r => ((r / 90) | 0) & 3;
    const shape = i => prj.comps[i].rots[rotIdx(pos[i].rot)];

    function fits(i, c, r, rot) {
      const s = prj.comps[i].rots[rotIdx(rot)];
      return c >= 0 && r >= 0 && c + s.w <= cols && r + s.h <= rows;
    }
    function put(i, sign) {
      const s = shape(i), p = pos[i];
      for (const [dc, dr] of s.cells) {
        const idx = (p.r + dr) * cols + (p.c + dc);
        if (idx < 0 || idx >= NC) continue;
        if (sign > 0) { if (occ[idx] >= 1) overlap++; occ[idx]++; crowd += occH[idx]; }
        else { occ[idx]--; if (occ[idx] >= 1) overlap--; crowd -= occH[idx]; }
      }
      if (!crowdW) return;
      for (const [dc, dr] of haloOf(s)) {
        const c = p.c + dc, r = p.r + dr;
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        const idx = r * cols + c;
        if (sign > 0) { crowd += occ[idx]; occH[idx]++; } else { occH[idx]--; crowd -= occ[idx]; }
      }
    }
    function padAbs(p) {
      const s = prj.comps[p.ci].rots[rotIdx(pos[p.ci].rot)].pads[p.pi];
      return [pos[p.ci].c + s.c, pos[p.ci].r + s.r];
    }
    function edgeCost(i) {
      if (!prj.comps[i].edge) return 0;
      const s = shape(i), p = pos[i];
      const dl = p.c, dt = p.r, dr = cols - (p.c + s.w), db = rows - (p.r + s.h), d = Math.min(dl, dt, dr, db);
      // ピン列が最寄りの辺と平行になる向きにする (配線を外へ出しやすく)
      const horiz = s.w >= s.h, wantH = Math.min(dt, db) <= Math.min(dl, dr);
      return edgeW * d + (horiz === wantH || s.w === s.h ? 0 : edgeW * 2);
    }
    function calcNet(j) {
      const n = prj.nets[j];
      if (n.pads.length < 2) return 0;
      let c0 = 1e9, c1 = -1e9, r0 = 1e9, r1 = -1e9;
      const rs = new Set();
      for (const p of n.pads) {
        const [c, r] = padAbs(p);
        if (c < c0) c0 = c; if (c > c1) c1 = c;
        if (r < r0) r0 = r; if (r > r1) r1 = r;
        if (opts.strip) rs.add(board.stripDir === 'col' ? c : r);
      }
      let v = (c1 - c0) + (r1 - r0);
      if (beauty && !opts.strip) {
        // 最小全域木の長さ + 枝分かれ (3 本以上集まる点) の罰則。GND・電源は重く
        const P = n.pads.map(padAbs), k = P.length;
        if (k === 2) v = pdist(P[0][0] - P[1][0], P[0][1] - P[1][1]);
        else {
          const inT = new Uint8Array(k), dist = new Float64Array(k).fill(Infinity), par = new Int32Array(k).fill(-1), deg = new Int32Array(k);
          dist[0] = 0; v = 0;
          for (let it = 0; it < k; it++) {
            let u = -1; for (let q = 0; q < k; q++) if (!inT[q] && (u < 0 || dist[q] < dist[u])) u = q;
            inT[u] = 1; v += dist[u]; if (par[u] >= 0) { deg[u]++; deg[par[u]]++; }
            for (let q = 0; q < k; q++) if (!inT[q]) { const dd = pdist(P[u][0] - P[q][0], P[u][1] - P[q][1]); if (dd < dist[q]) { dist[q] = dd; par[q] = u; } }
          }
          for (let q = 0; q < k; q++) if (deg[q] > 2) v += branchW * (deg[q] - 2);
        }
        return v * (n.cls === 'gnd' ? gndW : n.rail ? railW : 1);
      }
      if (n.pads.length > 3) v *= 1 + (n.pads.length - 3) * 0.06;
      if (opts.strip) v = (c1 - c0) * 0.5 + (r1 - r0) * 0.4 + (rs.size - 1) * opts.jumpW;
      return v;
    }

    // 機能ブロック: まとまりの大きさ (中心の外接矩形の周長) + 他ブロックの部品が入り込んだ数
    const nG = GRP ? prj.nGroups : 0;
    const gx0 = new Float64Array(nG), gx1 = new Float64Array(nG), gy0 = new Float64Array(nG), gy1 = new Float64Array(nG);
    function groupCost() {
      if (!GRP) return 0;
      gx0.fill(1e9); gy0.fill(1e9); gx1.fill(-1e9); gy1.fill(-1e9);
      const cx = new Float64Array(N), cy = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        const s = shape(i); cx[i] = pos[i].c + (s.w - 1) / 2; cy[i] = pos[i].r + (s.h - 1) / 2;
        const g = GRP[i]; if (g < 0) continue;
        if (pos[i].c < gx0[g]) gx0[g] = pos[i].c; if (pos[i].c + s.w - 1 > gx1[g]) gx1[g] = pos[i].c + s.w - 1;
        if (pos[i].r < gy0[g]) gy0[g] = pos[i].r; if (pos[i].r + s.h - 1 > gy1[g]) gy1[g] = pos[i].r + s.h - 1;
      }
      let v = 0;
      for (let g = 0; g < nG; g++) v += groupW * ((gx1[g] - gx0[g]) + (gy1[g] - gy0[g]));
      for (let i = 0; i < N; i++) for (let g = 0; g < nG; g++)
        if (g !== GRP[i] && cx[i] > gx0[g] && cx[i] < gx1[g] && cy[i] > gy0[g] && cy[i] < gy1[g]) v += intrudeW;
      // ブロックどうしの領域が重ならないように (重なった面積に比例)
      for (let a = 0; a < nG; a++) for (let b = a + 1; b < nG; b++) {
        const ox = Math.min(gx1[a], gx1[b]) - Math.max(gx0[a], gx0[b]) + 1, oy = Math.min(gy1[a], gy1[b]) - Math.max(gy0[a], gy0[b]) + 1;
        if (ox > 0 && oy > 0) v += overlapGW * ox * oy;
      }
      return v;
    }
    // 向きのそろい具合: 横向きと縦向きが混ざった数 + IC が基準の向きでない数
    function alignCost() {
      if (!easy) return 0;
      let h = 0, v = 0;
      for (const i of axial) { if ((rotIdx(pos[i].rot) & 1) === 0) h++; else v++; }
      let c = alignW * Math.min(h, v);
      for (const i of axial) if (rotIdx(pos[i].rot) >= 2) c += alignW * 0.5;      // 180° 違いも片方に寄せる
      for (const i of multi) if (rotIdx(pos[i].rot) !== 0) c += icRotW;
      return c;
    }
    // 初期配置: 面積降順のシェルフパッキング
    const order = prj.comps.map((c, i) => i).sort((a, b) =>
      prj.comps[b].rots[0].w * prj.comps[b].rots[0].h - prj.comps[a].rots[0].w * prj.comps[a].rots[0].h);
    let cx = 0, cy = 0, shelfH = 0;
    for (const i of order) {
      const s = prj.comps[i].rots[0];
      if (cx + s.w + 1 > cols) { cx = 0; cy += shelfH + 1; shelfH = 0; }
      pos[i] = { c: Math.min(cx, Math.max(0, cols - s.w)), r: Math.min(cy, Math.max(0, rows - s.h)), rot: 0 };
      cx += s.w + 1; shelfH = Math.max(shelfH, s.h);
    }
    for (let i = 0; i < N; i++) put(i, +1);
    for (let j = 0; j < prj.nets.length; j++) { netCost[j] = calcNet(j); wire += netCost[j]; }

    let edgeSum = 0;
    for (let i = 0; i < N; i++) edgeSum += edgeCost(i);
    let grpSum = groupCost() + alignCost();
    let cost = wire + edgeSum + grpSum + overlap * opts.overlapW + crowd * crowdW;
    const iters = Math.max(20000, Math.min(500000, 5200 * N));
    let done = 0;
    let T0 = Math.max(6, cost / Math.max(4, N) * 0.55), T = T0;
    let best = null, bestCost = Infinity;

    function snapshot() { return pos.map(p => ({ c: p.c, r: p.r, rot: p.rot })); }

    function tryMove() {
      const i = ri(N), p = pos[i];
      const kind = rnd();
      let nc = p.c, nr = p.r, nrot = p.rot, j = -1;
      if (kind < 0.60) {
        const amp = Math.max(1, Math.round(1 + (T / T0) * Math.max(cols, rows) * 0.3));
        nc = p.c + ri(2 * amp + 1) - amp; nr = p.r + ri(2 * amp + 1) - amp;
      } else if (kind < 0.78) {
        nrot = [0, 90, 180, 270][ri(4)];
      } else {
        j = ri(N); if (j === i) return false;
      }
      const touched = new Set(prj.comps[i].nets);
      const old = { c: p.c, r: p.r, rot: p.rot };
      let oldJ = null;
      const eOldI = edgeCost(i), eOldJ = j >= 0 ? edgeCost(j) : 0;
      if (j >= 0) {
        const q = pos[j];
        prj.comps[j].nets.forEach(x => touched.add(x));
        oldJ = { c: q.c, r: q.r, rot: q.rot };
        if (!fits(i, q.c, q.r, p.rot) || !fits(j, old.c, old.r, q.rot)) return false;
        put(i, -1); put(j, -1);
        p.c = q.c; p.r = q.r; q.c = old.c; q.r = old.r;
        put(i, +1); put(j, +1);
      } else {
        if (!fits(i, nc, nr, nrot)) return false;
        put(i, -1);
        p.c = nc; p.r = nr; p.rot = nrot;
        put(i, +1);
      }
      let dW = 0;
      const upd = [];
      touched.forEach(x => { const v = calcNet(x); upd.push([x, v]); dW += v - netCost[x]; });
      const dE = edgeCost(i) - eOldI + (j >= 0 ? edgeCost(j) - eOldJ : 0);
      const nGrp = (GRP ? groupCost() : 0) + alignCost();
      const nCost = wire + dW + edgeSum + dE + nGrp + overlap * opts.overlapW + crowd * crowdW;
      const d = nCost - cost;
      if (d <= 0 || rnd() < detExp(-d / Math.max(1e-6, T))) {
        upd.forEach(([x, v]) => netCost[x] = v);
        wire += dW; edgeSum += dE; grpSum = nGrp; cost = nCost;
        return true;
      }
      // rollback
      if (j >= 0) {
        const q = pos[j];
        put(i, -1); put(j, -1);
        p.c = old.c; p.r = old.r; p.rot = old.rot;
        q.c = oldJ.c; q.r = oldJ.r; q.rot = oldJ.rot;
        put(i, +1); put(j, +1);
      } else {
        put(i, -1); p.c = old.c; p.r = old.r; p.rot = old.rot; put(i, +1);
      }
      return false;
    }

    return {
      total: iters,
      get done() { return done; },
      get cost() { return cost; },
      get overlap() { return overlap; },
      run(chunk) {
        const end = Math.min(iters, done + chunk);
        while (done < end) {
          T = T0 * detExp(-8.294049640102028 * done / iters);   // 0.00025^(done/iters)
          tryMove(); done++;
          if ((done & 1023) === 0 && overlap === 0 && cost < bestCost) { bestCost = cost; best = snapshot(); }
        }
        if (done >= iters) {
          if (best && bestCost < cost) best.forEach((p, i) => { pos[i] = p; });
          prj.comps.forEach((c, i) => { c.pos = { c: pos[i].c, r: pos[i].r, rot: pos[i].rot }; });
        }
        return done >= iters;
      },
      finish() { while (!this.run(50000)); }
    };
  }

  /* ---------------- 配線グリッド ---------------- */
  const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

  function Heap() { this.f = new Int32Array(1024); this.s = new Int32Array(1024); this.n = 0; }
  Heap.prototype.push = function (f, s) {
    if (this.n === this.f.length) {
      const nf = new Int32Array(this.n * 2), ns = new Int32Array(this.n * 2);
      nf.set(this.f); ns.set(this.s); this.f = nf; this.s = ns;
    }
    let i = this.n++; this.f[i] = f; this.s[i] = s;
    while (i > 0) { const p = (i - 1) >> 1; if (this.f[p] <= this.f[i]) break; this.sw(p, i); i = p; }
  };
  Heap.prototype.sw = function (a, b) {
    const f = this.f[a], s = this.s[a]; this.f[a] = this.f[b]; this.s[a] = this.s[b]; this.f[b] = f; this.s[b] = s;
  };
  Heap.prototype.pop = function () {
    const top = this.s[0], tf = this.f[0];
    this.n--;
    if (this.n > 0) {
      this.f[0] = this.f[this.n]; this.s[0] = this.s[this.n];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < this.n && this.f[l] < this.f[m]) m = l;
        if (r < this.n && this.f[r] < this.f[m]) m = r;
        if (m === i) break; this.sw(i, m); i = m;
      }
    }
    this.lastF = tf; return top;
  };

  function makeGrid(cols, rows) {
    const NC = cols * rows;
    const g = {
      cols, rows, NC,
      node: [new Int32Array(NC).fill(-1), new Int32Array(NC).fill(-1)],
      diag: [new Int8Array(NC), new Int8Array(NC)],
      diagNet: [new Int32Array(NC).fill(-1), new Int32Array(NC).fill(-1)],
      body: new Uint8Array(NC),
      solid: new Uint8Array(NC),
      padNet: new Int32Array(NC).fill(-1),
      padRef: new Array(NC).fill(null),
      S: 2 * NC * 9
    };
    g.gsc = new Int32Array(g.S);
    g.stamp = new Int32Array(g.S);
    g.parent = new Int32Array(g.S);
    g.mark = 0;
    g.heap = new Heap();
    return g;
  }

  function stampObstacles(grid, prj) {
    const { cols, rows } = grid;
    grid.body.fill(0); grid.solid.fill(0);
    for (const c of prj.comps) {
      const s = c.rots[((c.pos.rot / 90) | 0) & 3];
      for (const [dc, dr] of s.cells) {
        const cc = c.pos.c + dc, rr = c.pos.r + dr;
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
        grid.body[rr * cols + cc] = 1;
      }
      // 部品本体の下には部品面ジャンパを通さない・穴も使わない（抵抗など細い部品も含む）
      for (const [dc, dr] of s.bodyCells) {
        const cc = c.pos.c + dc, rr = c.pos.r + dr;
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
        grid.solid[rr * cols + cc] = 1;
      }
    }
  }
  function stampPads(grid, prj) {
    const { cols } = grid;
    grid.padNet.fill(-1); grid.padRef.fill(null);
    grid.node[0].fill(-1); grid.node[1].fill(-1);
    grid.diag[0].fill(0); grid.diag[1].fill(0);
    for (const n of prj.nets) {
      n.padCells = [];
      for (const p of n.pads) {
        const c = prj.comps[p.ci], s = c.rots[((c.pos.rot / 90) | 0) & 3].pads[p.pi];
        const cc = c.pos.c + s.c, rr = c.pos.r + s.r;
        const idx = rr * cols + cc;
        n.padCells.push(idx);
        grid.padNet[idx] = n.index;
        grid.padRef[idx] = c.ref + '.' + (c.pinNames[s.pin] || s.pin);
        grid.node[0][idx] = n.index; grid.node[1][idx] = n.index;
      }
    }
  }

  /* --- A* (複数始点 → 1目標) --- */
  function astar(grid, sources, target, net, opt) {
    const { cols, rows, NC } = grid;
    grid.mark++;
    const mk = grid.mark, heap = grid.heap; heap.n = 0;
    const tc = target % cols, tr = (target / cols) | 0;
    const hw = opt.hWeight || 1;
    const H = idx => {
      const c = idx % cols, r = (idx / cols) | 0;
      const dx = Math.abs(c - tc), dy = Math.abs(r - tr);
      return ((10 * (dx + dy) - 6 * Math.min(dx, dy)) * hw) | 0;
    };
    for (const enc of sources) {
      const l = enc >= NC ? 1 : 0, idx = enc - l * NC;
      if (l === 1 && grid.solid[idx]) continue;   // IC等の真下から部品面配線は出せない
      if (l === 1 && grid.padNet[idx] >= 0) continue;   // 部品のリードが刺さった穴からはジャンパを出さない
      // 部品面ジャンパの途中から枝分かれ = その穴で半田付けするので、半田面が他ネットなら不可
      if (l === 1) { const b = grid.node[0][idx]; if (b !== -1 && b !== net) continue; }
      const s = (l * NC + idx) * 9;
      grid.gsc[s] = 0; grid.stamp[s] = mk; grid.parent[s] = -1;
      heap.push(H(idx), s);
    }
    const closed = grid.stamp, gsc = grid.gsc, par = grid.parent;
    const bend = opt.bend, topX = opt.topExtra, bodyX = opt.bodyPenalty, viaC = opt.viaCost, nearX = opt.nearPad || 0;
    let guard = 0, maxGuard = opt.maxExpand || (NC * 400);
    while (heap.n) {
      if (++guard > maxGuard) return null;
      const s = heap.pop();
      if (closed[s] === -mk) continue;
      const d0 = s % 9, rest = (s - d0) / 9, idx = rest % NC, l = (rest - idx) / NC;
      closed[s] = -mk;
      if (idx === target) return s;
      const g0 = gsc[s];
      const c = idx % cols, r = (idx / cols) | 0;
      // 層変更 (穴通し)
      {
        const nl = 1 - l, nn = grid.node[nl][idx];
        // 部品のリードが刺さっている穴にはジャンパを刺せないので、表裏渡しは空き穴だけ
        if ((nn === -1 || nn === net) && !(nl === 1 && grid.solid[idx]) && grid.padNet[idx] < 0) {
          const cst = viaC;
          const ns = (nl * NC + idx) * 9 + 0, ng = g0 + cst;
          if (closed[ns] !== mk && closed[ns] !== -mk) { closed[ns] = mk; gsc[ns] = 1e9; }
          if (closed[ns] !== -mk && ng < gsc[ns]) { gsc[ns] = ng; par[ns] = s; heap.push(ng + H(idx), ns); }
        }
      }
      for (let d = 0; d < 8; d++) {
        const dc = DIRS[d][0], dr = DIRS[d][1];
        const nc2 = c + dc, nr2 = r + dr;
        if (nc2 < 0 || nr2 < 0 || nc2 >= cols || nr2 >= rows) continue;
        const nidx = nr2 * cols + nc2;
        const occN = grid.node[l][nidx];
        if (occN !== -1 && occN !== net) continue;
        if (l === 1 && grid.solid[nidx]) continue;   // 部品(IC等)の真下にジャンパは通せない
        if (l === 1 && grid.padNet[nidx] >= 0) continue;  // 部品のピン穴でジャンパを終端・通過させない
        const isDiag = dc !== 0 && dr !== 0;
        if (isDiag) {
          if (!opt.diagonal) continue;
          const cell = Math.min(r, nr2) * cols + Math.min(c, nc2);
          const type = (dc * dr < 0) ? 1 : 2;
          const dv = grid.diag[l][cell];
          if (dv !== 0 && !(dv === type && grid.diagNet[l][cell] === net)) continue;
        }
        const dcode = d + 1;
        // 部品面ジャンパの曲がり角は穴に通して固定する → 半田面が他ネットの穴では曲げられない
        if (l === 1 && d0 !== 0 && d0 !== dcode) { const b = grid.node[0][idx]; if (b !== -1 && b !== net) continue; }
        let cst = isDiag ? 14 + (opt.diagExtra || 0) : 10;
        if (l === 1) { cst += topX; if (grid.body[nidx]) cst += bodyX; }
        else if (nearX && grid.padNet[nidx] < 0) {
          // 他ネットのランドのすぐ隣は半田ブリッジしやすいので、空いていれば 1 穴離して通す
          const pn = grid.padNet;
          if ((nc2 > 0 && pn[nidx - 1] >= 0 && pn[nidx - 1] !== net) || (nc2 < cols - 1 && pn[nidx + 1] >= 0 && pn[nidx + 1] !== net) ||
              (nr2 > 0 && pn[nidx - cols] >= 0 && pn[nidx - cols] !== net) || (nr2 < rows - 1 && pn[nidx + cols] >= 0 && pn[nidx + cols] !== net)) cst += nearX;
        }
        if (d0 !== 0 && d0 !== dcode) cst += bend;
        const ns = ((l * NC + nidx) * 9) + dcode, ng = g0 + cst;
        if (closed[ns] !== mk && closed[ns] !== -mk) { closed[ns] = mk; gsc[ns] = 1e9; }
        if (closed[ns] === -mk) continue;
        if (ng < gsc[ns]) { gsc[ns] = ng; par[ns] = s; heap.push(ng + H(nidx), ns); }
      }
    }
    return null;
  }

  function reconstruct(grid, s) {
    const NC = grid.NC, pts = [];
    while (s !== -1) {
      const d0 = s % 9, rest = (s - d0) / 9, idx = rest % NC, l = (rest - idx) / NC;
      pts.push([l, idx]);
      s = grid.parent[s];
    }
    pts.reverse();
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = out[out.length - 1], b = pts[i];
      if (a[0] === b[0] && a[1] === b[1]) continue;
      out.push(b);
    }
    return out;
  }

  /* --- 45°刻みの汎用経路探索（被覆ジャンパ用） ---
     絶縁電線なので他の配線と交差できる。混んでいない所を選び、
     必要に応じて障害物（部品本体など）を避ける。 */
  function octiPath(cols, rows, from, to, isBlocked, extraCost) {
    const NC = cols * rows, S = NC * 9;
    const g = new Int32Array(S).fill(0x7fffffff);
    const par = new Int32Array(S).fill(-1);
    const seen = new Uint8Array(S);
    const heap = new Heap();
    const tc = to % cols, tr = (to / cols) | 0;
    const H = idx => {
      const dx = Math.abs((idx % cols) - tc), dy = Math.abs(((idx / cols) | 0) - tr);
      return (10 * (dx + dy) - 6 * Math.min(dx, dy)) * 1.2 | 0;
    };
    const s0 = from * 9;
    g[s0] = 0; heap.push(H(from), s0);
    let guard = 0;
    while (heap.n) {
      if (++guard > NC * 60) return null;
      const st = heap.pop();
      if (seen[st]) continue;
      seen[st] = 1;
      const d0 = st % 9, idx = (st - d0) / 9;
      if (idx === to) {
        const pts = []; let cur = st;
        while (cur !== -1) { const i = ((cur - cur % 9) / 9); pts.push([i % cols, (i / cols) | 0]); cur = par[cur]; }
        pts.reverse();
        const out = [pts[0]];
        for (let i = 1; i < pts.length; i++) {
          const a = out[out.length - 1];
          if (a[0] !== pts[i][0] || a[1] !== pts[i][1]) out.push(pts[i]);
        }
        return out;
      }
      const c = idx % cols, r = (idx / cols) | 0, g0 = g[st];
      for (let d = 0; d < 8; d++) {
        const nc = c + DIRS[d][0], nr = r + DIRS[d][1];
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const ni = nr * cols + nc;
        if (ni !== to && isBlocked && isBlocked(ni)) continue;
        const diag = DIRS[d][0] !== 0 && DIRS[d][1] !== 0;
        let cst = diag ? 14 : 10;
        if (d0 !== 0 && d0 !== d + 1) cst += 9;           // 曲がりを嫌う
        if (extraCost) cst += extraCost(ni);
        const ns = ni * 9 + d + 1, ng = g0 + cst;
        if (ng < g[ns]) { g[ns] = ng; par[ns] = st; heap.push(ng + H(ni), ns); }
      }
    }
    return null;
  }

  /** 被覆ジャンパ（半田面を這わせる絶縁電線）の経路を求める */
  function insulatedJumper(grid, from, to, net) {
    const { cols, rows, NC } = grid;
    const path = octiPath(cols, rows, from, to,
      null,                                   // 絶縁されているので通行禁止マスは無い
      ni => {                                 // 混雑している所は避ける
        let e = 0;
        if (grid.node[0][ni] >= 0 && grid.node[0][ni] !== net) e += 7;
        if (grid.padNet[ni] >= 0 && grid.padNet[ni] !== net) e += 9;
        return e;
      });
    if (path) return path;
    const fc = from % cols, fr = (from / cols) | 0, tc = to % cols, tr = (to / cols) | 0;
    return [[fc, fr], [tc, tr]];
  }

  /* --- ネット単位ルーティング --- */
  function routeNet(grid, net, opt, allowForced) {
    const { cols, NC } = grid;
    const pads = net.padCells;
    const rec = { segs: [], nodes: [], diags: [], vias: [], jumpers: [], len: 0 };
    if (pads.length < 2) return rec;
    const connected = new Set([pads[0]]);
    const connHoles = new Set([pads[0]]);
    let remaining = [...new Set(pads)].filter(p => p !== pads[0]);

    const commit = pts => {
      // 部品面ジャンパの曲がり角・分岐点は穴を通すので、半田面側も自ネットとして確保する
      const dirOf = (a, b) => (Math.sign((b % cols) - (a % cols)) + 1) * 3 + Math.sign(((b / cols) | 0) - ((a / cols) | 0)) + 1;
      for (let i = 0; i < pts.length; i++) {
        const [l, idx] = pts[i];
        if (l !== 1 || grid.node[0][idx] !== -1) continue;
        const prev = pts[i - 1], next = pts[i + 1];
        const start = !prev || prev[0] !== 1 || prev[1] === idx;
        const bend = prev && next && prev[0] === 1 && next[0] === 1 && prev[1] !== idx && next[1] !== idx &&
          dirOf(prev[1], idx) !== dirOf(idx, next[1]);
        if (start || bend) { grid.node[0][idx] = net.index; rec.nodes.push(idx); }
      }
      for (let i = 0; i < pts.length; i++) {
        const [l, idx] = pts[i];
        if (grid.node[l][idx] === -1) { grid.node[l][idx] = net.index; rec.nodes.push(l * NC + idx); }
        connected.add(l * NC + idx); connHoles.add(idx);
        if (i > 0) {
          const [pl, pidx] = pts[i - 1];
          if (pidx === idx) { rec.vias.push(idx); continue; }
          const c1 = pidx % cols, r1 = (pidx / cols) | 0, c2 = idx % cols, r2 = (idx / cols) | 0;
          rec.segs.push({ l, c1, r1, c2, r2 });
          rec.len += hyp(c2 - c1, r2 - r1);
          if (c1 !== c2 && r1 !== r2) {
            const cell = Math.min(r1, r2) * cols + Math.min(c1, c2);
            const type = ((c2 - c1) * (r2 - r1) < 0) ? 1 : 2;
            if (grid.diag[l][cell] === 0) { grid.diag[l][cell] = type; grid.diagNet[l][cell] = net.index; rec.diags.push([l, cell]); }
          }
        }
      }
    };

    // 美しい配線: 多ピンのネットは一筆書きの順にパッドからパッドへ結ぶ (途中から枝分かれさせない)
    if (opt.chain && remaining.length >= 2) {
      const ord = chainOrder([...new Set(pads)], cols);
      // 最初のパッドを一筆書きの端にそろえる
      connected.clear(); connHoles.clear(); connected.add(ord[0]); connHoles.add(ord[0]);
      for (let i = 1; i < ord.length; i++) {
        const target = ord[i];
        if (connHoles.has(target)) continue;
        let s = astar(grid, new Set([ord[i - 1]]), target, net.index, opt);
        if (s === null) s = astar(grid, connected, target, net.index, opt);   // 通れなければ既存の線から
        if (s === null) {
          if (!allowForced) return null;
          const jp = insulatedJumper(grid, ord[i - 1], target, net.index);
          rec.jumpers.push({ pts: jp, forced: true });
          for (let q = 1; q < jp.length; q++) rec.len += hyp(jp[q][0] - jp[q - 1][0], jp[q][1] - jp[q - 1][1]);
          connected.add(target); connHoles.add(target);
        } else commit(reconstruct(grid, s));
      }
      return rec;
    }
    let guard = 0;
    while (remaining.length) {
      if (++guard > 400) break;
      // 最も近い未接続パッドを選ぶ
      let bi = 0, bd = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const t = remaining[i], tc = t % cols, tr = (t / cols) | 0;
        let m = Infinity;
        connHoles.forEach(h => {
          const dx = Math.abs((h % cols) - tc), dy = Math.abs(((h / cols) | 0) - tr);
          const v = 10 * (dx + dy) - 6 * Math.min(dx, dy);
          if (v < m) m = v;
        });
        if (m < bd) { bd = m; bi = i; }
      }
      const target = remaining[bi];
      const s = astar(grid, connected, target, net.index, opt);
      if (s === null) {
        if (!allowForced) return null;
        // 強制ジャンパ (被覆線) — 最近接の接続済み穴と直結
        let best = null, bm = Infinity;
        const tc = target % cols, tr = (target / cols) | 0;
        connHoles.forEach(h => {
          const d = hyp((h % cols) - tc, ((h / cols) | 0) - tr);
          if (d < bm) { bm = d; best = h; }
        });
        const jp = insulatedJumper(grid, best, target, net.index);
        rec.jumpers.push({ pts: jp, forced: true });
        for (let i = 1; i < jp.length; i++) rec.len += hyp(jp[i][0] - jp[i - 1][0], jp[i][1] - jp[i - 1][1]);
        connected.add(target); connHoles.add(target);
      } else {
        commit(reconstruct(grid, s));
      }
      remaining = remaining.filter(p => !connHoles.has(p));
    }
    return rec;
  }

  function unroute(grid, rec, netIndex) {
    const NC = grid.NC;
    for (const enc of rec.nodes) {
      const l = enc >= NC ? 1 : 0, idx = enc - l * NC;
      if (grid.padNet[idx] === netIndex) continue;
      if (grid.node[l][idx] === netIndex) grid.node[l][idx] = -1;
    }
    for (const [l, cell] of rec.diags) { grid.diag[l][cell] = 0; grid.diagNet[l][cell] = -1; }
  }

  function netBBox(grid, net) {
    const cols = grid.cols;
    let c0 = 1e9, c1 = -1e9, r0 = 1e9, r1 = -1e9;
    for (const idx of net.padCells) {
      const c = idx % cols, r = (idx / cols) | 0;
      c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r);
    }
    return { c0, c1, r0, r1 };
  }

  function routeAll(prj, board, options) {
    const opt = Object.assign({
      bend: 7, topExtra: 5, bodyPenalty: 26, viaCost: 55, hWeight: 1.15,
      diagonal: true, maxPass: 7, ripCount: 5, seed: 7
    }, options || {});
    const grid = makeGrid(board.cols, board.rows);
    stampObstacles(grid, prj);
    stampPads(grid, prj);
    if (board.keepout) for (const k of board.keepout) if (k >= 0 && k < grid.NC && grid.padNet[k] < 0) { grid.node[0][k] = -2; grid.node[1][k] = -2; }

    let sd = opt.seed >>> 0;
    const rnd = () => { sd ^= sd << 13; sd >>>= 0; sd ^= sd >> 17; sd ^= sd << 5; sd >>>= 0; return sd / 4294967296; };

    const nets = prj.nets.filter(n => n.padCells.length >= 2);
    const routes = new Map();
    let queue = nets.slice().sort((a, b) => {
      const A = netBBox(grid, a), B = netBBox(grid, b);
      if (opt.railsFirst) { const ra = a.cls === 'gnd' ? 0 : a.rail ? 1 : 2, rb = b.cls === 'gnd' ? 0 : b.rail ? 1 : 2; if (ra !== rb) return ra - rb; }
      return ((A.c1 - A.c0) + (A.r1 - A.r0)) - ((B.c1 - B.c0) + (B.r1 - B.r0));
    });
    const stats = { passes: 0, ripups: 0, forced: 0 };
    const work = Object.assign({}, opt);
    const baseOrder = queue.slice();

    // ---- 最良解のスナップショット (リップアップで悪化させないため) ----
    const snap = () => ({
      n0: grid.node[0].slice(), n1: grid.node[1].slice(),
      d0: grid.diag[0].slice(), d1: grid.diag[1].slice(),
      dn0: grid.diagNet[0].slice(), dn1: grid.diagNet[1].slice(),
      routes: new Map(routes)
    });
    const restore = s => {
      grid.node[0].set(s.n0); grid.node[1].set(s.n1);
      grid.diag[0].set(s.d0); grid.diag[1].set(s.d1);
      grid.diagNet[0].set(s.dn0); grid.diagNet[1].set(s.dn1);
      routes.clear(); s.routes.forEach((v, k) => routes.set(k, v));
    };
    let best = null, bestFail = Infinity;

    for (let pass = 0; pass < opt.maxPass; pass++) {
      stats.passes = pass + 1;
      const failed = [];
      for (const n of queue) {
        if (routes.has(n.index)) continue;
        const rec = routeNet(grid, n, work, false);
        if (rec === null) failed.push(n); else routes.set(n.index, rec);
      }
      if (failed.length < bestFail) { bestFail = failed.length; best = snap(); }
      if (!failed.length) break;
      if (pass === opt.maxPass - 1) break;
      // 妨害ネットをリップアップ
      const victims = new Set();
      for (const f of failed) {
        const bb = netBBox(grid, f);
        const cand = [];
        routes.forEach((rec, ni) => {
          for (const s of rec.segs) {
            if (Math.min(s.c1, s.c2) <= bb.c1 + 2 && Math.max(s.c1, s.c2) >= bb.c0 - 2 &&
                Math.min(s.r1, s.r2) <= bb.r1 + 2 && Math.max(s.r1, s.r2) >= bb.r0 - 2) { cand.push(ni); break; }
          }
        });
        for (let k = 0; k < Math.min(opt.ripCount, cand.length); k++)
          victims.add(cand[Math.floor(rnd() * cand.length) % cand.length]);
      }
      victims.forEach(ni => { unroute(grid, routes.get(ni), ni); routes.delete(ni); stats.ripups++; });
      work.viaCost = Math.max(20, work.viaCost * 0.82);
      work.topExtra = Math.max(0, work.topExtra * 0.75);
      work.bodyPenalty = Math.max(8, work.bodyPenalty * 0.85);
      const failedSet = new Set(failed.map(n => n.index));
      queue = failed.concat(baseOrder.filter(n => !routes.has(n.index) && !failedSet.has(n.index)));
    }
    // ---- 最良解へ戻し、残りは被覆ジャンパで確実に接続 ----
    if (bestFail > 0 && best) {
      restore(best);
      if (!opt.noForced) for (const n of baseOrder) {
        if (routes.has(n.index)) continue;
        const rec = routeNet(grid, n, work, true);
        routes.set(n.index, rec || { segs: [], nodes: [], diags: [], vias: [], jumpers: [], len: 0 });
      }
    }
    // ---- 部品面ジャンパ削減: ジャンパを使うネットと周辺ネットを外し、すず線優先で引き直す (悪化したら戻す) ----
    if (opt.reduceTop && routes.size === nets.length) {
      const runsOf = rec => { let n = 0, prev = null; for (const s of rec.segs) { if (s.l === 1 && !(prev && prev.l === 1 && prev.c2 === s.c1 && prev.r2 === s.r1)) n++; prev = s; } return n; };
      const topLenOf = rec => rec.segs.reduce((a, s) => a + (s.l === 1 ? hyp(s.c2 - s.c1, s.r2 - s.r1) : 0), 0);
      const score = () => { let r = 0, t = 0, L = 0; routes.forEach(x => { r += runsOf(x); t += topLenOf(x); L += x.len; }); return r * 1000 + t * 10 + L * 0.1; };
      const hard = Object.assign({}, opt, { topExtra: opt.reduceTopExtra || 40, viaCost: 140, bodyPenalty: opt.bodyPenalty });
      let cur = score();
      stats.reduceBefore = cur;
      for (let it = 0; it < opt.reduceTop; it++) {
        const withTop = [...routes.keys()].filter(ni => runsOf(routes.get(ni)) > 0);
        if (!withTop.length) break;
        const ni0 = withTop[Math.floor(rnd() * withTop.length) % withTop.length];
        const rec0 = routes.get(ni0);
        let c0 = 1e9, c1 = -1e9, r0 = 1e9, r1 = -1e9;
        rec0.segs.forEach(sg => { if (sg.l === 1) { c0 = Math.min(c0, sg.c1, sg.c2); c1 = Math.max(c1, sg.c1, sg.c2); r0 = Math.min(r0, sg.r1, sg.r2); r1 = Math.max(r1, sg.r1, sg.r2); } });
        const cand = [];
        routes.forEach((rec, ni) => { if (ni !== ni0 && rec.segs.some(sg => Math.min(sg.c1, sg.c2) <= c1 + 1 && Math.max(sg.c1, sg.c2) >= c0 - 1 && Math.min(sg.r1, sg.r2) <= r1 + 1 && Math.max(sg.r1, sg.r2) >= r0 - 1)) cand.push(ni); });
        const vic = new Set([ni0]);
        const nv = 1 + Math.floor(rnd() * 4);
        for (let k = 0; k < nv && cand.length; k++) vic.add(cand.splice(Math.floor(rnd() * cand.length) % cand.length, 1)[0]);
        const s0 = snap();
        vic.forEach(ni => { unroute(grid, routes.get(ni), ni); routes.delete(ni); });
        const order = [...vic];
        for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)) % (i + 1); const t = order[i]; order[i] = order[j]; order[j] = t; }
        let ok = true;
        for (const ni of order) {
          const n = nets.find(q => q.index === ni);
          const rec = routeNet(grid, n, hard, false);
          if (!rec) { ok = false; break; }
          routes.set(ni, rec);
        }
        const sc = ok ? score() : Infinity;
        if (sc < cur) cur = sc; else restore(s0);
      }
      stats.reduceAfter = cur;
    }
    let totalLen = 0, vias = 0, forced = 0, topLen = 0, botLen = 0;
    routes.forEach(r => {
      totalLen += r.len; vias += r.vias.length; forced += r.jumpers.length;
      r.segs.forEach(s => { const d = hyp(s.c2 - s.c1, s.r2 - s.r1); if (s.l === 1) topLen += d; else botLen += d; });
    });
    stats.forced = forced;
    return { grid, routes, stats, metrics: { totalLen, vias, forced, topLen, botLen, nets: nets.length, routed: routes.size, unrouted: nets.length - routes.size } };
  }

  /* ---------------- ストリップボード変換 ---------------- */
  function stripConvert(prj, board) {
    const cols = board.cols, rows = board.rows, dir = board.stripDir || 'row';
    const along = dir === 'row' ? cols : rows;   // ストリップの長さ方向
    const across = dir === 'row' ? rows : cols;  // ストリップの本数
    const padNet = new Int32Array(cols * rows).fill(-1);
    const padRef = new Array(cols * rows).fill(null);
    for (const n of prj.nets) {
      n.padCells = [];
      for (const p of n.pads) {
        const c = prj.comps[p.ci], s = c.rots[((c.pos.rot / 90) | 0) & 3].pads[p.pi];
        const cc = c.pos.c + s.c, rr = c.pos.r + s.r, idx = rr * cols + cc;
        n.padCells.push(idx); padNet[idx] = n.index;
        padRef[idx] = c.ref + '.' + (c.pinNames[s.pin] || s.pin);
      }
    }
    const at = (a, b) => dir === 'row' ? (b * cols + a) : (a * cols + b); // a=along, b=across
    const body = new Uint8Array(cols * rows);
    for (const c of prj.comps) {
      const s = c.rots[((c.pos.rot / 90) | 0) & 3];
      for (const [dc, dr] of s.cells) {
        const cc = c.pos.c + dc, rr = c.pos.r + dr;
        if (cc >= 0 && rr >= 0 && cc < cols && rr < rows) body[rr * cols + cc] = 1;
      }
    }

    const cuts = [];          // {a, b}  = along位置 a と a+1 の間を b番ストリップで切断
    const segOf = new Int32Array(cols * rows).fill(-1);
    let segCount = 0;
    for (let b = 0; b < across; b++) {
      const list = [];
      for (let a = 0; a < along; a++) { const idx = at(a, b); if (padNet[idx] >= 0) list.push({ a, net: padNet[idx] }); }
      const rowCuts = [];
      for (let i = 1; i < list.length; i++) {
        if (list[i].net !== list[i - 1].net) {
          const mid = Math.floor((list[i - 1].a + list[i].a) / 2);
          rowCuts.push(Math.max(list[i - 1].a, Math.min(mid, list[i].a - 1)));
        }
      }
      rowCuts.forEach(a => cuts.push({ a, b }));
      let seg = segCount++;
      let ci = 0;
      for (let a = 0; a < along; a++) {
        segOf[at(a, b)] = seg;
        if (ci < rowCuts.length && rowCuts[ci] === a) { seg = segCount++; ci++; }
      }
    }

    // ネットごとにセグメントを結ぶジャンパを算出
    const jumpers = [];
    for (const n of prj.nets) {
      if (n.padCells.length < 2) continue;
      const segs = [...new Set(n.padCells.map(i => segOf[i]))];
      if (segs.length < 2) continue;
      // 各セグメントの候補穴 (自ネットのパッド + 空き穴)
      const cand = new Map();
      segs.forEach(s => cand.set(s, []));
      for (let b = 0; b < across; b++) for (let a = 0; a < along; a++) {
        const idx = at(a, b), s = segOf[idx];
        if (!cand.has(s)) continue;
        if (padNet[idx] === n.index) cand.get(s).push({ idx, own: true, pen: 0 });
        else if (padNet[idx] === -1 && !body[idx]) cand.get(s).push({ idx, own: false, pen: 0.25 });
      }
      // 部品の下しか空きがないセグメントは、自ネットのランドを使う
      segs.forEach(s => { if (!cand.get(s).length) cand.set(s, n.padCells.filter(i => segOf[i] === s).map(idx => ({ idx, own: true, pen: 0 }))); });
      const pt = i => [i % cols, (i / cols) | 0];
      // Prim法
      const inTree = new Set([segs[0]]);
      while (inTree.size < segs.length) {
        let best = null, bd = Infinity;
        for (const s of segs) {
          if (inTree.has(s)) continue;
          for (const t of inTree) {
            for (const x of cand.get(s)) for (const y of cand.get(t)) {
              const [ax, ay] = pt(x.idx), [bx, by] = pt(y.idx);
              const d = hyp(ax - bx, ay - by) + x.pen + y.pen;
              if (d < bd) { bd = d; best = { s, x: x.idx, y: y.idx }; }
            }
          }
        }
        if (!best) break;
        const solid = new Uint8Array(cols * rows);
        prj.comps.forEach(cp => {
          const sh = cp.rots[((cp.pos.rot / 90) | 0) & 3];
          sh.bodyCells.forEach(([dc, dr]) => {
            const cc = cp.pos.c + dc, rr2 = cp.pos.r + dr;
            if (cc >= 0 && rr2 >= 0 && cc < cols && rr2 < rows) solid[rr2 * cols + cc] = 1;
          });
        });
        // 部品の上は通れないので高コストにする（塞いでしまうと行き止まりになるため）
        const path = octiPath(cols, rows, best.x, best.y, null,
          ni => (solid[ni] ? 150 : 0) + (body[ni] ? 8 : 0)
              + (padNet[ni] >= 0 && padNet[ni] !== n.index ? 5 : 0))
          || [pt(best.x), pt(best.y)];
        jumpers.push({ pts: path, net: n.index });
        inTree.add(best.s);
      }
    }
    return { cuts, segOf, jumpers, padNet, padRef, segCount, dir };
  }

  /* ---------------- 検証 (接続性DRC) ---------------- */
  function verify(prj, board, result, strip) {
    const cols = board.cols, NC = cols * board.rows;
    const par = new Int32Array(2 * NC); for (let i = 0; i < par.length; i++) par[i] = i;
    const find = a => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
    const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) par[b] = a; };
    const step = (c, r) => r * cols + c;

    if (strip) {
      const { segOf, jumpers } = strip;
      const rep = new Map();
      for (let i = 0; i < NC; i++) {
        const s = segOf[i]; if (s < 0) continue;
        if (rep.has(s)) uni(i, rep.get(s)); else rep.set(s, i);
      }
      jumpers.forEach(j => { const p = j.pts; for (let i = 1; i < p.length; i++) uni(step(p[i - 1][0], p[i - 1][1]), step(p[i][0], p[i][1])); });
    } else {
      // 表裏が導通するのはリード/ビアが通る穴だけ
      for (const n of prj.nets) for (const idx of (n.padCells || [])) uni(idx, idx + NC);
      result.routes.forEach(rec => {
        rec.vias.forEach(v => uni(v, v + NC));
        rec.segs.forEach(s => uni(step(s.c1, s.r1) + s.l * NC, step(s.c2, s.r2) + s.l * NC));
        rec.jumpers.forEach(j => {
          const p = j.pts;
          for (let i = 1; i < p.length; i++) {
            const a = step(p[i - 1][0], p[i - 1][1]), b = step(p[i][0], p[i][1]);
            uni(a, b); uni(a + NC, b + NC); uni(a, a + NC); uni(b, b + NC);
          }
        });
      });
    }
    const problems = [];
    for (const n of prj.nets) {
      if (!n.padCells || n.padCells.length < 2) continue;
      const root = find(n.padCells[0]);
      for (const p of n.padCells) if (find(p) !== root) { problems.push({ net: n.name, t: '未接続パッドあり' }); break; }
    }
    // ショート検査
    if (!strip) {
      const owner = new Map();
      result.routes.forEach((rec, ni) => {
        rec.nodes.forEach(enc => {
          const l = enc >= NC ? 1 : 0, idx = enc - l * NC;
          const k = enc;
          if (owner.has(k) && owner.get(k) !== ni) problems.push({ net: prj.nets[ni].name, t: 'ノード競合' });
          owner.set(k, ni);
        });
      });
      // 部品面ジャンパと部品本体の干渉
      const bodyOf = new Array(NC).fill(null);
      for (const c of prj.comps) {
        const sh = c.rots[((c.pos.rot / 90) | 0) & 3];
        for (const [dc, dr] of sh.bodyCells) {
          const cc = c.pos.c + dc, rr = c.pos.r + dr;
          if (cc >= 0 && rr >= 0 && cc < cols && rr < board.rows) bodyOf[rr * cols + cc] = c.ref;
        }
      }
      result.routes.forEach((rec, ni) => {
        const hit = new Set();
        rec.segs.forEach(sg => {
          if (sg.l !== 1) return;
          [[sg.c1, sg.r1], [sg.c2, sg.r2]].forEach(([c, r]) => {
            const pr = result.grid && result.grid.padRef[step(c, r)];
            if (pr && !hit.has(pr)) { hit.add(pr); problems.push({ net: prj.nets[ni].name, t: `部品面ジャンパが部品のピン穴 ${pr} を使っています (${holeName(c, r)})` }); }
            const ref = bodyOf[step(c, r)];
            if (ref && !hit.has(ref)) { hit.add(ref); problems.push({ net: prj.nets[ni].name, t: `部品面ジャンパが ${ref} の本体と重なっています (${holeName(c, r)})` }); }
          });
        });
      });
    } else {
      const segNet = new Map();
      for (const n of prj.nets) for (const idx of (n.padCells || [])) {
        const s = strip.segOf[idx];
        if (segNet.has(s) && segNet.get(s) !== n.index)
          problems.push({ net: n.name, t: `ストリップ短絡 (seg ${s})` });
        segNet.set(s, n.index);
      }
    }
    return problems;
  }

  /* ---------------- 配線リスト生成 ---------------- */
  function colName(c) {
    let s = ''; c = c + 1;
    while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = ((c - m) / 26) | 0; }
    return s;
  }
  const holeName = (c, r) => colName(c) + (r + 1);

  function wiringList(prj, board, result, strip) {
    const cols = board.cols, out = [];
    if (strip) {
      strip.cuts.forEach(k => {
        const a = k.a, b = k.b;
        const p1 = strip.dir === 'row' ? [a, b] : [b, a];
        const p2 = strip.dir === 'row' ? [a + 1, b] : [b, a + 1];
        out.push({ kind: 'cut', text: `パターンカット: ${holeName(p1[0], p1[1])} ↔ ${holeName(p2[0], p2[1])} の間` });
      });
      strip.jumpers.forEach(j => {
        const p = j.pts; let len = 0;
        for (let i = 1; i < p.length; i++) len += hyp(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
        const via = p.length > 2 ? '（経由 ' + p.slice(1, -1).map(q => holeName(q[0], q[1])).join(' → ') + '）' : '';
        out.push({
          kind: 'jumper', net: prj.nets[j.net] && prj.nets[j.net].name,
          text: `ジャンパ(${prj.nets[j.net] ? prj.nets[j.net].name : '?'}): ${holeName(p[0][0], p[0][1])} → ${holeName(p[p.length - 1][0], p[p.length - 1][1])}${via}  長さ${(len * 2.54).toFixed(1)}mm`
        });
      });
      return out;
    }
    result.routes.forEach((rec, ni) => {
      const name = prj.nets[ni].name;
      // 同一直線の連続セグメントをまとめる
      const runs = [];
      let cur = null;
      for (const s of rec.segs) {
        const dx = Math.sign(s.c2 - s.c1), dy = Math.sign(s.r2 - s.r1);
        if (cur && cur.l === s.l && cur.dx === dx && cur.dy === dy && cur.c2 === s.c1 && cur.r2 === s.r1) {
          cur.c2 = s.c2; cur.r2 = s.r2;
        } else { cur = { l: s.l, dx, dy, c1: s.c1, r1: s.r1, c2: s.c2, r2: s.r2 }; runs.push(cur); }
      }
      runs.forEach(r => out.push({
        kind: r.l === 1 ? 'jumper' : 'trace', net: name,
        text: `${name} / ${r.l === 1 ? '部品面ジャンパ' : '半田面すず線'}: ${holeName(r.c1, r.r1)} → ${holeName(r.c2, r.r2)}  ${(hyp(r.c2 - r.c1, r.r2 - r.r1) * 2.54).toFixed(1)}mm`
      }));
      rec.vias.forEach(v => out.push({ kind: 'via', net: name, text: `${name} / 表裏渡し: ${holeName(v % cols, (v / cols) | 0)} の穴を通す` }));
      rec.jumpers.forEach(j => {
        const p = j.pts; let len = 0;
        for (let i = 1; i < p.length; i++) len += hyp(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
        const via = p.length > 2 ? '（経由 ' + p.slice(1, -1).map(q => holeName(q[0], q[1])).join(' → ') + '）' : '';
        out.push({
          kind: 'forced', net: name,
          text: `${name} / 被覆ジャンパ(半田面): ${holeName(p[0][0], p[0][1])} → ${holeName(p[p.length - 1][0], p[p.length - 1][1])}${via}  ${(len * 2.54).toFixed(1)}mm`
        });
      });
    });
    return out;
  }

  /* ---------------- 組立手順: 背の低い部品から順に付ける ----------------
     はんだ付けは基板を裏返して行うので、背の低い部品から付けると浮かずに固定できる */
  const ASM_STAGES = [
    ['抵抗・ダイオード', '基板にぴったり寝かせて付けます'],
    ['IC・IC ソケット', '切り欠き (1 番ピン側) の向きを図に合わせます'],
    ['小さなコンデンサ・水晶など', '向きのない部品です'],
    ['トランジスタ・LED などの半導体', '足の並び・向きを図に合わせます'],
    ['電解コンデンサ・可変抵抗・スイッチなど背の高い部品', '電解コンデンサは + の向きに注意します'],
    ['コネクタ・端子', '最後に付けます']
  ];
  function asmStage(c) {
    const t = String(c.type || '');
    if (c.edge || c.isPower || /^(J\d*|TB\d*|DCJ|JACK35|PWRHDR|BAT)$/.test(t)) return 5;
    if (/^(R|RNET|D|ZD|SBD|TVS|F|L|NTC|VARISTOR)$/.test(t)) return 0;
    if (/^(CP|POT|SW|SW3|SWP|RLY|BUZ|SPK|M|LAMP|TRAFO|LED7|BR)$/.test(t)) return 4;
    if (/^(C|CNP|X|LDR)$/.test(t)) return 2;
    if (c.nPads >= 6) return 1;
    return 3;
  }
  function assemblySteps(prj) {
    const stages = ASM_STAGES.map(([title, tip]) => ({ title, tip, items: [] }));
    prj.comps.forEach((c, ci) => {
      const sh = c.rots[((c.pos.rot / 90) | 0) & 3];
      const holes = sh.pads.map(p => ({ pin: String(c.pinNames[p.pin] || p.pin), hole: holeName(c.pos.c + p.c, c.pos.r + p.r) }));
      const t = String(c.type || '');
      let note = '';
      if (t === 'CP') note = '+ → ' + (holes.find(h => /^(\+|1|A|P)$/i.test(h.pin)) || holes[0]).hole;
      else if (/^(D|ZD|SBD|TVS|LED)$/.test(t)) { const k = holes.find(h => /^(K|C|2)$/i.test(h.pin)); if (k) note = 'K (カソード・線のある側) → ' + k.hole; }
      else if (c.nPads >= 6 && !c.edge && !c.isPower) note = '1 番ピン → ' + holes[0].hole;
      const text = c.nPads <= 3
        ? holes.map(h => (c.nPads > 2 || note ? h.pin + ':' : '') + h.hole).join(c.nPads > 2 || note ? '  ' : ' – ')
        : holes[0].hole + ' 〜 ' + holes[holes.length - 1].hole;
      stages[asmStage(c)].items.push({ ci, ref: c.ref, val: c.val || c.name || '', holes, text, note });
    });
    stages.forEach(st => st.items.sort((a, b) => a.ref.localeCompare(b.ref, 'en', { numeric: true })));
    return stages.filter(st => st.items.length);
  }

  /* ---------------- 手動調整: 部品を動かした後の引き直し ----------------
     動かした部品につながるネットと、新しい位置とぶつかる配線だけを外して引き直す (他の配線はそのまま)。
     引き直せなければ全体を配線し直す */
  function routeSummary(prj, routes, grid) {
    let totalLen = 0, vias = 0, forced = 0, topLen = 0, botLen = 0;
    routes.forEach(r => {
      totalLen += r.len; vias += r.vias.length; forced += r.jumpers.length;
      r.segs.forEach(s => { const d = hyp(s.c2 - s.c1, s.r2 - s.r1); if (s.l === 1) topLen += d; else botLen += d; });
    });
    const nets = prj.nets.filter(n => (n.padCells || []).length >= 2);
    const unrouted = nets.filter(n => !routes.has(n.index)).length;
    return { grid, routes, stats: { forced }, metrics: { totalLen, vias, forced, topLen, botLen, nets: nets.length, routed: nets.length - unrouted, unrouted } };
  }
  function rerouteAfterEdit(prj, board, old, options, changed) {
    const opt = Object.assign({ bend: 7, topExtra: 5, bodyPenalty: 26, viaCost: 55, hWeight: 1.15, diagonal: true, chain: true, railsFirst: true, diagExtra: 6 }, options || {});
    const grid = makeGrid(board.cols, board.rows), cols = board.cols, NC = grid.NC;
    stampObstacles(grid, prj); stampPads(grid, prj);
    if (board.keepout) for (const k of board.keepout) if (k >= 0 && k < NC && grid.padNet[k] < 0) { grid.node[0][k] = -2; grid.node[1][k] = -2; }
    const touched = new Set();
    prj.nets.forEach(n => { if (n.pads.some(p => changed.has(p.ci))) touched.add(n.index); });
    const routes = new Map();
    const inB = (c, r) => c >= 0 && r >= 0 && c < cols && r < board.rows;
    // 残す配線を 1 本ずつ置き直す (ぶつかったら外す)
    const tryKeep = (ni, rec) => {
      const cells = [], diags = [];
      for (const sg of rec.segs) {
        const dc = Math.sign(sg.c2 - sg.c1), dr = Math.sign(sg.r2 - sg.r1);
        const n = Math.max(Math.abs(sg.c2 - sg.c1), Math.abs(sg.r2 - sg.r1));
        if (dc && dr && Math.abs(sg.c2 - sg.c1) !== Math.abs(sg.r2 - sg.r1)) return false;   // 45° 以外は扱わない
        let c = sg.c1, r = sg.r1;
        cells.push([sg.l, c, r]);
        for (let k = 0; k < n; k++) {
          if (dc && dr) diags.push([sg.l, Math.min(r, r + dr) * cols + Math.min(c, c + dc), (dc * dr < 0) ? 1 : 2]);
          c += dc; r += dr; cells.push([sg.l, c, r]);
        }
      }
      rec.vias.forEach(i => { cells.push([0, i % cols, (i / cols) | 0]); cells.push([1, i % cols, (i / cols) | 0]); });
      for (const [l, c, r] of cells) {
        if (!inB(c, r)) return false;
        const i = r * cols + c;
        if (grid.padNet[i] >= 0 && grid.padNet[i] !== ni) return false;
        const o = grid.node[l][i]; if (o !== -1 && o !== ni) return false;
        if (l === 1 && (grid.solid[i] || grid.padNet[i] >= 0) && !rec.vias.includes(i)) {
          // 部品面ジャンパは部品の下・ピン穴を通れない (端のパッドは除く)
          const end = rec.segs.some(sg => sg.l === 1 && ((sg.c1 === c && sg.r1 === r) || (sg.c2 === c && sg.r2 === r)));
          if (grid.solid[i] || !end) return false;
        }
      }
      for (const [l, cell, t] of diags) if (grid.diag[l][cell] !== 0 && !(grid.diag[l][cell] === t && grid.diagNet[l][cell] === ni)) return false;
      const nodes = [], dl = [];
      for (const [l, c, r] of cells) { const i = r * cols + c; if (grid.node[l][i] === -1) { grid.node[l][i] = ni; nodes.push(l * NC + i); } }
      for (const [l, cell, t] of diags) if (grid.diag[l][cell] === 0) { grid.diag[l][cell] = t; grid.diagNet[l][cell] = ni; dl.push([l, cell]); }
      routes.set(ni, Object.assign({}, rec, { nodes, diags: dl }));
      return true;
    };
    const redo = [];
    const order = [...old.routes.keys()].sort((a, b) => a - b);
    for (const ni of order) {
      if (touched.has(ni) || !prj.nets[ni] || !tryKeep(ni, old.routes.get(ni))) redo.push(ni);
    }
    prj.nets.forEach(n => { if ((n.padCells || []).length >= 2 && !routes.has(n.index) && !redo.includes(n.index)) redo.push(n.index); });
    const rank = n => n.cls === 'gnd' ? 0 : n.rail ? 1 : 2;
    redo.sort((a, b) => rank(prj.nets[a]) - rank(prj.nets[b]));
    const failed = [];
    for (const ni of redo) {
      const n = prj.nets[ni]; if ((n.padCells || []).length < 2) continue;
      const rec = routeNet(grid, n, opt, false);
      if (rec) routes.set(ni, rec); else failed.push(ni);
    }
    let res = routeSummary(prj, routes, grid);
    res.stats.partial = true; res.stats.rerouted = redo.length;
    if (failed.length) {
      // 部分的に引き直せない → 全体を配線し直し、良い方を採る
      const full = routeAll(prj, board, Object.assign({}, opt, { noForced: true, maxPass: 6 }));
      if ((full.metrics.unrouted || 0) < failed.length) { full.stats.rerouted = 'all'; res = full; }
      else if (!opt.noForced) {
        for (const ni of failed) { const rec = routeNet(grid, prj.nets[ni], opt, true); if (rec) routes.set(ni, rec); }
        res = routeSummary(prj, routes, grid); res.stats.partial = true; res.stats.rerouted = redo.length;
      }
    }
    return res;
  }

  /* ---------------- 美しい配線: 機能ブロック / 一筆書きの順番 / 評価 ---------------- */
  const octile = (dx, dy) => { dx = Math.abs(dx); dy = Math.abs(dy); return Math.max(dx, dy) + 0.4142 * Math.min(dx, dy); };
  // 同じ働きをする部品のまとまり: 能動部品 (IC・トランジスタ等) を核に、信号線でつながる受動部品を集める
  function functionalGroups(prj) {
    const N = prj.comps.length, grp = new Int32Array(N).fill(-1);
    const W = Array.from({ length: N }, () => new Map());
    for (const n of prj.nets) {
      if (n.rail) continue;
      const cs = [...new Set(n.pads.map(p => p.ci))];
      if (cs.length < 2 || cs.length > 8) continue;
      const w = 1 / (cs.length - 1);
      for (const a of cs) for (const b of cs) if (a !== b) W[a].set(b, (W[a].get(b) || 0) + w);
    }
    const free = i => !prj.comps[i].edge && !prj.comps[i].isPower;
    const anchor = i => free(i) && (/^(U|IC|Q|TR|RY|K)\d/i.test(prj.comps[i].ref || '') || prj.comps[i].nPads >= 5);
    let G = 0;
    const anchors = [];
    for (let i = 0; i < N; i++) if (anchor(i)) { grp[i] = G++; anchors.push(i); }
    // 結び付きの強い順に 1 つずつ所属を決める
    for (;;) {
      let bi = -1, bg = -1, bs = 0;
      for (let i = 0; i < N; i++) {
        if (grp[i] >= 0 || !free(i)) continue;
        const sc = new Map();
        W[i].forEach((w, j) => { if (grp[j] >= 0) sc.set(grp[j], (sc.get(grp[j]) || 0) + w); });
        sc.forEach((v, g) => { if (v > bs + 1e-9) { bs = v; bi = i; bg = g; } });
      }
      if (bi < 0) break;
      grp[bi] = bg;
    }
    // 能動部品につながらない部品どうしのまとまり
    for (let i = 0; i < N; i++) {
      if (grp[i] >= 0 || !free(i) || !W[i].size) continue;
      const st = [i]; grp[i] = G;
      while (st.length) { const a = st.pop(); W[a].forEach((w, b) => { if (grp[b] < 0 && free(b)) { grp[b] = G; st.push(b); } }); }
      G++;
    }
    // 電源にしかつながらない部品 (パスコン等) は、同じ電源を使う能動部品のブロックへ
    for (let i = 0; i < N; i++) {
      if (grp[i] >= 0 || !free(i)) continue;
      const mine = new Set(prj.comps[i].nets);
      let best = -1, bv = 0;
      for (const a of anchors) {
        let v = 0; prj.comps[a].nets.forEach(x => { if (mine.has(x) && !prj.nets[x].rail) v += 2; else if (mine.has(x)) v += 1; });
        if (v > bv) { bv = v; best = a; }
      }
      if (best >= 0 && bv >= 2) grp[i] = grp[best];
    }
    // 1 部品だけのブロックは無し扱い
    const cnt = new Map(); grp.forEach(g => { if (g >= 0) cnt.set(g, (cnt.get(g) || 0) + 1); });
    const remap = new Map(); let k = 0;
    for (let i = 0; i < N; i++) { const g = grp[i]; if (g < 0 || cnt.get(g) < 2) { grp[i] = -1; continue; } if (!remap.has(g)) remap.set(g, k++); grp[i] = remap.get(g); }
    prj.groups = grp; prj.nGroups = k;
    prj.comps.forEach((c, i) => c.group = grp[i]);
    return grp;
  }
  // 多ピンのネットを一筆書き (枝分かれなし) で結ぶ順番: 最近傍法 + 2-opt
  function chainOrder(cells, cols) {
    const P = cells.map(i => [i % cols, (i / cols) | 0]), n = P.length;
    const d = (a, b) => octile(P[a][0] - P[b][0], P[a][1] - P[b][1]);
    if (n <= 2) return cells.slice();
    let best = null, bl = Infinity;
    for (let s = 0; s < n; s++) {
      const used = new Uint8Array(n), ord = [s]; used[s] = 1; let L = 0;
      for (let k = 1; k < n; k++) {
        const a = ord[ord.length - 1]; let bj = -1, bd = Infinity;
        for (let j = 0; j < n; j++) if (!used[j]) { const v = d(a, j); if (v < bd) { bd = v; bj = j; } }
        used[bj] = 1; ord.push(bj); L += bd;
      }
      if (L < bl) { bl = L; best = ord; }
    }
    for (let it = 0, imp = true; imp && it < 60; it++) {
      imp = false;
      for (let i = 0; i < n - 2; i++) for (let j = i + 2; j < n; j++) {
        const a = best[i], b = best[i + 1], c = best[j], e = j + 1 < n ? best[j + 1] : -1;
        const before = d(a, b) + (e >= 0 ? d(c, e) : 0), after = d(a, c) + (e >= 0 ? d(b, e) : 0);
        if (after + 1e-9 < before) { best = best.slice(0, i + 1).concat(best.slice(i + 1, j + 1).reverse(), best.slice(j + 1)); imp = true; }
      }
    }
    return best.map(k => cells[k]);
  }
  // 出来上がりの「美しさ」: GND の長さ・枝分かれの数・機能ブロックの混ざり具合
  function beautyMetrics(prj, board, result) {
    const cols = board.cols;
    let gndLen = 0, totalLen = 0, branches = 0, bends = 0, diags = 0;
    if (result && result.routes) result.routes.forEach((rec, ni) => {
      const net = prj.nets.find(n => n.index === ni) || prj.nets[ni];
      totalLen += rec.len || 0;
      if (net && net.cls === 'gnd') gndLen += rec.len || 0;
      const deg = new Map(), add = k => deg.set(k, (deg.get(k) || 0) + 1);
      const seen = new Set();
      let prev = null;
      rec.segs.forEach(sg => {
        if (sg.c1 !== sg.c2 && sg.r1 !== sg.r2) diags++;
        if (prev && prev.l === sg.l && prev.c2 === sg.c1 && prev.r2 === sg.r1 && (Math.sign(prev.c2 - prev.c1) !== Math.sign(sg.c2 - sg.c1) || Math.sign(prev.r2 - prev.r1) !== Math.sign(sg.r2 - sg.r1))) bends++;
        prev = sg;
        const a = sg.r1 * cols + sg.c1, b = sg.r2 * cols + sg.c2, key = Math.min(a, b) + ':' + Math.max(a, b);
        if (seen.has(key)) return; seen.add(key); add(a); add(b);
      });
      (rec.jumpers || []).forEach(j => { const p = j.pts; if (p.length > 1) { add(p[0][1] * cols + p[0][0]); add(p[p.length - 1][1] * cols + p[p.length - 1][0]); } });
      // 一直線の途中の点 (同じ向きで通り抜けるだけ) は数えない。3 本以上集まる点が枝分かれ
      deg.forEach(v => { if (v >= 3) branches += v - 2; });
    });
    const blocks = [];
    if (prj.groups) {
      for (let g = 0; g < (prj.nGroups || 0); g++) {
        let c0 = 1e9, r0 = 1e9, c1 = -1e9, r1 = -1e9; const refs = [];
        prj.comps.forEach(c => {
          if (c.group !== g) return;
          const s = c.rots[((c.pos.rot / 90) | 0) & 3];
          c0 = Math.min(c0, c.pos.c); r0 = Math.min(r0, c.pos.r); c1 = Math.max(c1, c.pos.c + s.w - 1); r1 = Math.max(r1, c.pos.r + s.h - 1);
          refs.push(c.ref);
        });
        if (refs.length) blocks.push({ g, c0, r0, c1, r1, refs });
      }
    }
    let mix = 0;
    prj.comps.forEach(c => {
      const s = c.rots[((c.pos.rot / 90) | 0) & 3], cx = c.pos.c + (s.w - 1) / 2, cy = c.pos.r + (s.h - 1) / 2;
      blocks.forEach(b => { if (b.g !== c.group && cx > b.c0 && cx < b.c1 && cy > b.r0 && cy < b.r1) mix++; });
    });
    return { gndLen, totalLen, branches, bends, diags, mix, blocks };
  }

  global.CADBoard = {
    rotFp, buildProject, netClass, autoBoardSize, compactBoard, cornerKeepout, makePlacer, makeGrid, routeAll,
    stripConvert, verify, wiringList, colName, holeName, stampObstacles, stampPads,
    functionalGroups, chainOrder, beautyMetrics, octile, rerouteAfterEdit, assemblySteps
  };
})(typeof window !== 'undefined' ? window : globalThis);
