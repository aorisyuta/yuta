/* ---- spice.js ---- */
/* =====================================================================
   UniBoard SPICE — 回路シミュレーション エンジン
   修正節点解析 (MNA) + ニュートン法 + 台形積分
   解析: .OP / .DC / .TRAN / .AC
   素子: R C L V I D Q(BJT) M(MOSFET) J(JFET) E G F H K S X(サブ回路・内蔵モデル)
   ===================================================================== */
(function (global) {
  'use strict';

  const VT = 0.025852;           // 熱電圧 (27℃)
  const GMIN = 1e-12;

  /* ---------------- 数値の読み取り (工学接頭辞) ---------------- */
  const SUFFIX = { t: 1e12, g: 1e9, meg: 1e6, k: 1e3, m: 1e-3, mil: 25.4e-6, u: 1e-6, 'µ': 1e-6, 'μ': 1e-6, n: 1e-9, p: 1e-12, f: 1e-15 };
  function parseNum(s, params) {
    if (typeof s === 'number') return s;
    if (s == null) return NaN;
    let t = String(s).trim();
    if (!t) return NaN;
    if (t[0] === '{' && t[t.length - 1] === '}') return evalExpr(t.slice(1, -1), params || {});
    if (params && Object.prototype.hasOwnProperty.call(params, t.toLowerCase())) return params[t.toLowerCase()];
    t = t.replace(/[Ω]/g, '').replace(/ohms?$/i, '');
    // 4k7 / 2R2 / 1M5 表記
    let m = t.match(/^([+-]?\d+)([rRkKmMuUnNpP])(\d+)$/);
    if (m) {
      const mult = { r: 1, k: 1e3, m: t.includes('M') && !/meg/i.test(t) ? 1e6 : 1e-3, u: 1e-6, n: 1e-9, p: 1e-12 }[m[2].toLowerCase()];
      const mm = m[2] === 'M' ? 1e6 : m[2] === 'm' ? 1e-3 : mult;
      return parseFloat(m[1] + '.' + m[3]) * mm;
    }
    m = t.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(.*)$/i);
    if (!m) return NaN;
    const v = parseFloat(m[1]);
    let rest = m[2].trim();
    if (!rest) return v;
    // 大文字 M 単独は「メガ」として扱う (電子工作の表記: 1M = 1MΩ)
    if (/^M(?![a-z])/.test(rest) && !/^meg/i.test(rest) && !/^mil/i.test(rest)) return v * 1e6;
    const lo = rest.toLowerCase();
    if (lo.startsWith('meg')) return v * 1e6;
    if (lo.startsWith('mil')) return v * 25.4e-6;
    const c = lo[0];
    if (SUFFIX[c] !== undefined) return v * SUFFIX[c];
    return v;   // 単位のみ (V, A, F, H, Hz)
  }
  function fmt(v, unit, digits) {
    unit = unit || ''; digits = digits || 4;
    if (v === 0 || Math.abs(v) < 1e-15) return '0' + unit;
    if (!isFinite(v)) return String(v);
    const a = Math.abs(v);
    const P = [[1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f']];
    for (const [s, p] of P) if (a >= s * 0.9995) return +(v / s).toPrecision(digits) + p + unit;
    return v.toExponential(2) + unit;
  }

  /* ---- 簡易数式 (.param / {expr}) ---- */
  function evalExpr(src, params) {
    const toks = src.match(/\d+\.?\d*(?:e[+-]?\d+)?[a-zA-Zµ]*|\.\d+(?:e[+-]?\d+)?[a-zA-Z]*|[A-Za-z_][\w]*|\*\*|[-+*/^(),]/g) || [];
    let i = 0;
    const peek = () => toks[i], next = () => toks[i++];
    const FN = { sqrt: Math.sqrt, exp: Math.exp, log: Math.log, ln: Math.log, log10: Math.log10, sin: Math.sin, cos: Math.cos, tan: Math.tan, abs: Math.abs, min: Math.min, max: Math.max, pow: Math.pow, atan: Math.atan };
    function prim() {
      const t = next();
      if (t === '(') { const v = expr(); next(); return v; }
      if (t === '-') return -prim();
      if (t === '+') return prim();
      if (/^[\d.]/.test(t)) return parseNum(t);
      const k = t.toLowerCase();
      if (k === 'pi') return Math.PI;
      if (FN[k] && peek() === '(') {
        next(); const args = [];
        if (peek() !== ')') { args.push(expr()); while (peek() === ',') { next(); args.push(expr()); } }
        next(); return FN[k](...args);
      }
      if (Object.prototype.hasOwnProperty.call(params, k)) return params[k];
      throw new Error('未定義のパラメータ: ' + t);
    }
    function pw() { let v = prim(); while (peek() === '^' || peek() === '**') { next(); v = Math.pow(v, prim()); } return v; }
    function term() { let v = pw(); while (peek() === '*' || peek() === '/') { const o = next(), r = pw(); v = o === '*' ? v * r : v / r; } return v; }
    function expr() { let v = term(); while (peek() === '+' || peek() === '-') { const o = next(), r = term(); v = o === '+' ? v + r : v - r; } return v; }
    return expr();
  }

  /* ---------------- 線形代数 (密行列 LU) ---------------- */
  function luSolve(A, b, n) {
    const piv = new Int32Array(n);
    for (let k = 0; k < n; k++) {
      let p = k, mx = Math.abs(A[k * n + k]);
      for (let i = k + 1; i < n; i++) { const v = Math.abs(A[i * n + k]); if (v > mx) { mx = v; p = i; } }
      if (mx < 1e-300) return null;
      piv[k] = p;
      if (p !== k) {
        for (let j = 0; j < n; j++) { const t = A[k * n + j]; A[k * n + j] = A[p * n + j]; A[p * n + j] = t; }
        const t = b[k]; b[k] = b[p]; b[p] = t;
      }
      const d = A[k * n + k];
      for (let i = k + 1; i < n; i++) {
        const f = A[i * n + k] / d;
        if (f === 0) continue;
        A[i * n + k] = f;
        for (let j = k + 1; j < n; j++) A[i * n + j] -= f * A[k * n + j];
        b[i] -= f * b[k];
      }
    }
    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let s = b[i];
      for (let j = i + 1; j < n; j++) s -= A[i * n + j] * x[j];
      x[i] = s / A[i * n + i];
    }
    return x;
  }
  function cluSolve(Ar, Ai, br, bi, n) {
    for (let k = 0; k < n; k++) {
      let p = k, mx = Ar[k * n + k] ** 2 + Ai[k * n + k] ** 2;
      for (let i = k + 1; i < n; i++) { const v = Ar[i * n + k] ** 2 + Ai[i * n + k] ** 2; if (v > mx) { mx = v; p = i; } }
      if (mx < 1e-300) return null;
      if (p !== k) {
        for (let j = 0; j < n; j++) {
          let t = Ar[k * n + j]; Ar[k * n + j] = Ar[p * n + j]; Ar[p * n + j] = t;
          t = Ai[k * n + j]; Ai[k * n + j] = Ai[p * n + j]; Ai[p * n + j] = t;
        }
        let t = br[k]; br[k] = br[p]; br[p] = t; t = bi[k]; bi[k] = bi[p]; bi[p] = t;
      }
      const dr = Ar[k * n + k], di = Ai[k * n + k], dd = dr * dr + di * di;
      for (let i = k + 1; i < n; i++) {
        const ar = Ar[i * n + k], ai = Ai[i * n + k];
        if (ar === 0 && ai === 0) continue;
        const fr = (ar * dr + ai * di) / dd, fi = (ai * dr - ar * di) / dd;
        for (let j = k + 1; j < n; j++) {
          const kr = Ar[k * n + j], ki = Ai[k * n + j];
          Ar[i * n + j] -= fr * kr - fi * ki; Ai[i * n + j] -= fr * ki + fi * kr;
        }
        br[i] -= fr * br[k] - fi * bi[k]; bi[i] -= fr * bi[k] + fi * br[k];
      }
    }
    const xr = new Float64Array(n), xi = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let sr = br[i], si = bi[i];
      for (let j = i + 1; j < n; j++) {
        const ar = Ar[i * n + j], ai = Ai[i * n + j];
        sr -= ar * xr[j] - ai * xi[j]; si -= ar * xi[j] + ai * xr[j];
      }
      const dr = Ar[i * n + i], di = Ai[i * n + i], dd = dr * dr + di * di;
      xr[i] = (sr * dr + si * di) / dd; xi[i] = (si * dr - sr * di) / dd;
    }
    return [xr, xi];
  }

  /* ---------------- 接合電圧の制限 (収束安定化) ---------------- */
  function pnjlim(vnew, vold, vt, vcrit) {
    if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
      if (vold > 0) {
        const arg = 1 + (vnew - vold) / vt;
        vnew = arg > 0 ? vold + vt * Math.log(arg) : vcrit;
      } else vnew = vt * Math.log(vnew / vt);
      return [vnew, true];
    }
    return [vnew, false];
  }
  function fetlim(vnew, vold, vto) {
    const d = vnew - vold, lim = Math.max(2, Math.abs(vold - vto) + 2) * 0.5 + 0.5;
    if (Math.abs(d) > lim) return [vold + Math.sign(d) * lim, true];
    return [vnew, false];
  }
  function lexp(x) {  // 上限付き指数 (オーバーフロー防止)
    if (x > 80) { const e = Math.exp(80); return [e * (1 + x - 80), e]; }
    const e = Math.exp(x); return [e, e];
  }

  /* ================= 回路 ================= */
  class Circuit {
    constructor() {
      this.varIdx = new Map();   // 節点名 -> 変数番号
      this.varNames = [];        // 変数名 (V(n) / I(Vx) など)
      this.varKind = [];         // 'v' | 'i'
      this.elems = [];
      this.byName = new Map();
      this.ics = new Map();
      this.warnings = [];
    }
    node(name) {
      let k = String(name).toLowerCase();
      if (k === '0' || k === 'gnd' || k === 'gnd!') return -1;
      let i = this.varIdx.get(k);
      if (i === undefined) { i = this.varNames.length; this.varIdx.set(k, i); this.varNames.push(k); this.varKind.push('v'); }
      return i;
    }
    branch(label) { const i = this.varNames.length; this.varNames.push(label); this.varKind.push('i'); return i; }
    add(e) {
      const k = e.name.toLowerCase();
      if (this.byName.has(k)) throw new Error('素子名が重複しています: ' + e.name);
      this.byName.set(k, e); this.elems.push(e); return e;
    }
    get n() { return this.varNames.length; }
    setup() {
      for (const e of this.elems) if (e.setup) e.setup(this);
      for (const e of this.elems) if (e.link) e.link(this);
      this.nl = this.elems.some(e => e.nonlinear);
    }
  }

  /* ---- 行列スタンプ ---- */
  class Stamp {
    constructor(n) { this.n = n; this.A = new Float64Array(n * n); this.b = new Float64Array(n); this.C = null; }
    clear() { this.A.fill(0); this.b.fill(0); }
    a(i, j, v) { if (i >= 0 && j >= 0) this.A[i * this.n + j] += v; }
    rhs(i, v) { if (i >= 0) this.b[i] += v; }
    g(p, q, g) { this.a(p, p, g); this.a(q, q, g); this.a(p, q, -g); this.a(q, p, -g); }
    i(p, q, I) { this.rhs(p, -I); this.rhs(q, I); }        // p→q へ素子内を流れる電流源
    vsrc(p, q, k, V) { this.a(p, k, 1); this.a(q, k, -1); this.a(k, p, 1); this.a(k, q, -1); this.rhs(k, V); }
    // 非線形素子: terms=端子節点, I[k]=端子kへ流れ込む電流, ctl=[[p,q],...] 制御電圧, G[k][c]=dI_k/dv_c, vc=使用した制御電圧
    nl(terms, I, ctl, G, vc) {
      for (let k = 0; k < terms.length; k++) {
        const row = terms[k]; if (row < 0) continue;
        let s = I[k];
        for (let c = 0; c < ctl.length; c++) {
          const gg = G[k][c]; if (!gg) continue;
          const [p, q] = ctl[c];
          this.a(row, p, gg); this.a(row, q, -gg);
          s -= gg * vc[c];
        }
        this.b[row] -= s;
      }
    }
    cap(p, q, C) { if (!this.C) return; const n = this.n; const f = (i, j, v) => { if (i >= 0 && j >= 0) this.C[i * n + j] += v; }; f(p, p, C); f(q, q, C); f(p, q, -C); f(q, p, -C); }
    cmat(i, j, v) { if (this.C && i >= 0 && j >= 0) this.C[i * this.n + j] += v; }
  }
  const V = (x, i) => (i >= 0 ? x[i] : 0);

  /* ================= 独立電源の波形 ================= */
  function makeWave(spec) {
    // spec: {dc, ac, acp, kind, args}
    const a = spec.args || [];
    switch (spec.kind) {
      case 'sin': {
        const [vo, va, f, td = 0, th = 0, ph = 0] = a;
        return {
          at: t => t < td ? vo + va * Math.sin(ph * Math.PI / 180) : vo + va * Math.exp(-(t - td) * th) * Math.sin(2 * Math.PI * f * (t - td) + ph * Math.PI / 180),
          dc: vo + va * Math.sin(ph * Math.PI / 180), bp: () => [], tmax: f > 0 ? 1 / f / 40 : Infinity
        };
      }
      case 'pulse': {
        const [v1, v2, td = 0, tr0 = 0, tf0 = 0, pw = Infinity, per = Infinity] = a;
        const tr = tr0 || 1e-9, tf = tf0 || 1e-9;
        const at = t => {
          if (t < td) return v1;
          let tt = t - td;
          if (isFinite(per) && per > 0) tt = tt % per;
          if (tt < tr) return v1 + (v2 - v1) * tt / tr;
          if (tt < tr + pw) return v2;
          if (tt < tr + pw + tf) return v2 + (v1 - v2) * (tt - tr - pw) / tf;
          return v1;
        };
        const bp = tstop => {
          const out = [];
          for (let k = 0, base = td; base < tstop && k < 20000; k++, base += per) {
            out.push(base, base + tr, base + tr + pw, base + tr + pw + tf);
            if (!isFinite(per) || per <= 0) break;
          }
          return out;
        };
        return { at, dc: v1, bp, tmax: isFinite(per) ? per / 20 : Infinity };
      }
      case 'pwl': {
        const pts = []; for (let i = 0; i + 1 < a.length; i += 2) pts.push([a[i], a[i + 1]]);
        const at = t => {
          if (!pts.length) return 0;
          if (t <= pts[0][0]) return pts[0][1];
          for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) {
            const [t0, v0] = pts[i - 1], [t1, v1] = pts[i];
            return t1 === t0 ? v1 : v0 + (v1 - v0) * (t - t0) / (t1 - t0);
          }
          return pts[pts.length - 1][1];
        };
        return { at, dc: at(0), bp: () => pts.map(p => p[0]), tmax: Infinity };
      }
      case 'exp': {
        const [v1, v2, td1 = 0, tau1 = 1e-6, td2 = Infinity, tau2 = 1e-6] = a;
        const at = t => {
          if (t < td1) return v1;
          let v = v1 + (v2 - v1) * (1 - Math.exp(-(t - td1) / tau1));
          if (t >= td2) v += (v1 - v2) * (1 - Math.exp(-(t - td2) / tau2));
          return v;
        };
        return { at, dc: v1, bp: () => [td1, td2].filter(isFinite), tmax: Infinity };
      }
      default: return { at: () => spec.dc || 0, dc: spec.dc || 0, bp: () => [], tmax: Infinity };
    }
  }

  /* ================= 素子 ================= */
  class Resistor {
    constructor(name, a, b, R) { this.name = name; this.na = a; this.nb = b; this.R = Math.max(1e-6, Math.abs(R)); this.kind = 'R'; }
    setup(c) { this.a = c.node(this.na); this.b = c.node(this.nb); }
    load(st) { st.g(this.a, this.b, 1 / this.R); }
    current(x) { return (V(x, this.a) - V(x, this.b)) / this.R; }
  }
  class Capacitor {
    constructor(name, a, b, C, ic) { this.name = name; this.na = a; this.nb = b; this.C = C; this.ic = ic; this.kind = 'C'; this.vp = 0; this.ip = 0; }
    setup(c) { this.a = c.node(this.na); this.b = c.node(this.nb); }
    load(st, ctx) {
      if (ctx.mode !== 'tran') return;
      const geq = (ctx.method === 'trap' ? 2 : 1) * this.C / ctx.h;
      st.g(this.a, this.b, geq);
      st.i(this.a, this.b, ctx.method === 'trap' ? -geq * this.vp - this.ip : -geq * this.vp);
    }
    loadAC(st) { st.cap(this.a, this.b, this.C); }
    initTran(x, uic) {
      this.vp = uic && this.ic !== undefined ? this.ic : V(x, this.a) - V(x, this.b); this.ip = 0;
    }
    accept(x, ctx) {
      const v = V(x, this.a) - V(x, this.b);
      const geq = (ctx.method === 'trap' ? 2 : 1) * this.C / ctx.h;
      this.ip = ctx.method === 'trap' ? geq * (v - this.vp) - this.ip : geq * (v - this.vp);
      this.vp = v;
    }
    current() { return this.ip; }
  }
  class Inductor {
    constructor(name, a, b, L, ic) { this.name = name; this.na = a; this.nb = b; this.L = L; this.ic = ic; this.kind = 'L'; this.ipv = 0; this.vp = 0; this.mut = []; this.rser = 1e-3; }
    setup(c) { this.a = c.node(this.na); this.b = c.node(this.nb); this.k = c.branch('i(' + this.name.toLowerCase() + ')'); }
    load(st, ctx) {
      const { a, b, k } = this;
      st.a(a, k, 1); st.a(b, k, -1); st.a(k, a, 1); st.a(k, b, -1);
      st.a(k, k, -this.rser);   // 直列抵抗 (LTspice と同じく既定 1mΩ)
      if (ctx.mode !== 'tran') return;
      const f = (ctx.method === 'trap' ? 2 : 1) / ctx.h;
      st.a(k, k, -f * this.L);
      let r = -f * this.L * this.ipv;
      for (const m of this.mut) { st.a(k, m.o.k, -f * m.M); r -= f * m.M * m.o.ipv; }
      if (ctx.method === 'trap') r -= this.vp;
      st.rhs(k, r);
    }
    loadAC(st) {
      st.cmat(this.k, this.k, -this.L);
      for (const m of this.mut) st.cmat(this.k, m.o.k, -m.M);
    }
    initTran(x, uic) { this.ipv = uic && this.ic !== undefined ? this.ic : x[this.k]; this.vp = V(x, this.a) - V(x, this.b) - this.rser * this.ipv; }
    accept(x) { this.ipv = x[this.k]; this.vp = V(x, this.a) - V(x, this.b) - this.rser * this.ipv; }
    current(x) { return x[this.k]; }
  }
  class Coupling {
    constructor(name, l1, l2, k) { this.name = name; this.l1 = l1; this.l2 = l2; this.kc = k; this.kind = 'K'; }
    load() { }
    link(c) {
      const A = c.byName.get(this.l1.toLowerCase()), B = c.byName.get(this.l2.toLowerCase());
      if (!A || !B || A.kind !== 'L' || B.kind !== 'L') throw new Error(this.name + ': 結合するインダクタが見つかりません');
      const M = this.kc * Math.sqrt(A.L * B.L);
      A.mut.push({ o: B, M }); B.mut.push({ o: A, M });
    }
  }
  class VSource {
    constructor(name, a, b, spec) { this.name = name; this.na = a; this.nb = b; this.spec = spec; this.w = makeWave(spec); this.kind = 'V'; }
    setup(c) { this.a = c.node(this.na); this.b = c.node(this.nb); this.k = c.branch('i(' + this.name.toLowerCase() + ')'); }
    value(ctx) { return (ctx.mode === 'tran' ? this.w.at(ctx.t) : (this.dcOverride !== undefined ? this.dcOverride : this.w.dc)) * (ctx.srcFact == null ? 1 : ctx.srcFact); }
    load(st, ctx) { st.vsrc(this.a, this.b, this.k, this.value(ctx)); }
    loadACsrc(br, bi) {
      if (!this.spec.ac) return;
      const ph = (this.spec.acp || 0) * Math.PI / 180;
      br[this.k] += this.spec.ac * Math.cos(ph); bi[this.k] += this.spec.ac * Math.sin(ph);
    }
    acZero(st) { st.vsrc(this.a, this.b, this.k, 0); }
    current(x) { return x[this.k]; }
  }
  class ISource {
    constructor(name, a, b, spec) { this.name = name; this.na = a; this.nb = b; this.spec = spec; this.w = makeWave(spec); this.kind = 'I'; }
    setup(c) { this.a = c.node(this.na); this.b = c.node(this.nb); }
    value(ctx) { return (ctx.mode === 'tran' ? this.w.at(ctx.t) : (this.dcOverride !== undefined ? this.dcOverride : this.w.dc)) * (ctx.srcFact == null ? 1 : ctx.srcFact); }
    load(st, ctx) { st.i(this.a, this.b, this.value(ctx)); }
    loadACsrc(br, bi) {
      if (!this.spec.ac) return;
      const ph = (this.spec.acp || 0) * Math.PI / 180, m = this.spec.ac;
      if (this.a >= 0) { br[this.a] -= m * Math.cos(ph); bi[this.a] -= m * Math.sin(ph); }
      if (this.b >= 0) { br[this.b] += m * Math.cos(ph); bi[this.b] += m * Math.sin(ph); }
    }
    current(ctx) { return this.w.dc; }
  }
  class VCVS {
    constructor(name, a, b, c, d, gain) { Object.assign(this, { name, na: a, nb: b, nc: c, nd: d, gain, kind: 'E' }); }
    setup(c) { this.a = c.node(this.na); this.b = c.node(this.nb); this.c = c.node(this.nc); this.d = c.node(this.nd); this.k = c.branch('i(' + this.name.toLowerCase() + ')'); }
    load(st) { st.vsrc(this.a, this.b, this.k, 0); st.a(this.k, this.c, -this.gain); st.a(this.k, this.d, this.gain); }
    current(x) { return x[this.k]; }
  }
  class VCCS {
    constructor(name, a, b, c, d, gm) { Object.assign(this, { name, na: a, nb: b, nc: c, nd: d, gm, kind: 'G' }); }
    setup(c) { this.a = c.node(this.na); this.b = c.node(this.nb); this.c = c.node(this.nc); this.d = c.node(this.nd); }
    load(st) { const { a, b, c, d, gm } = this; st.a(a, c, gm); st.a(a, d, -gm); st.a(b, c, -gm); st.a(b, d, gm); }
    current(x) { return this.gm * (V(x, this.c) - V(x, this.d)); }
  }
  class CCCS {
    constructor(name, a, b, vname, gain) { Object.assign(this, { name, na: a, nb: b, vname, gain, kind: 'F' }); }
    setup(c) { this.a = c.node(this.na); this.b = c.node(this.nb); }
    link(c) { const s = c.byName.get(this.vname.toLowerCase()); if (!s || s.k === undefined) throw new Error(this.name + ': 制御電流源 ' + this.vname + ' がありません'); this.src = s; }
    load(st) { st.a(this.a, this.src.k, this.gain); st.a(this.b, this.src.k, -this.gain); }
    current(x) { return this.gain * x[this.src.k]; }
  }
  class CCVS {
    constructor(name, a, b, vname, r) { Object.assign(this, { name, na: a, nb: b, vname, r, kind: 'H' }); }
    setup(c) { this.a = c.node(this.na); this.b = c.node(this.nb); this.k = c.branch('i(' + this.name.toLowerCase() + ')'); }
    link(c) { const s = c.byName.get(this.vname.toLowerCase()); if (!s || s.k === undefined) throw new Error(this.name + ': 制御電流源 ' + this.vname + ' がありません'); this.src = s; }
    load(st) { st.vsrc(this.a, this.b, this.k, 0); st.a(this.k, this.src.k, -this.r); }
    current(x) { return x[this.k]; }
  }

  /* ---- ダイオード ---- */
  const DDEF = { is: 1e-14, n: 1, rs: 0, cjo: 0, bv: Infinity, ibv: 1e-3, nbv: 1, tt: 0 };
  class Diode {
    constructor(name, a, k, model) { Object.assign(this, { name, na: a, nk: k, kind: 'D', nonlinear: true }); this.m = Object.assign({}, DDEF, model || {}); this.vd = 0; }
    setup(c) {
      this.a = c.node(this.na); this.k = c.node(this.nk);
      this.ai = this.m.rs > 1e-6 ? c.node(this.name.toLowerCase() + '#a') : this.a;
      if (this.m.cjo > 0) this.cap = new Capacitor(this.name + '#cj', '', '', this.m.cjo);
      if (this.cap) { this.cap.a = this.ai; this.cap.b = this.k; }
      const m = this.m; this.nvt = m.n * VT; this.vcrit = this.nvt * Math.log(this.nvt / (Math.SQRT2 * m.is));
    }
    eval(vd) {
      const m = this.m;
      const [e, de] = lexp(vd / this.nvt);
      let id = m.is * (e - 1) + GMIN * vd, gd = m.is * de / this.nvt + GMIN;
      if (isFinite(m.bv) && vd < -m.bv + 50 * m.nbv * VT) {
        const [eb, deb] = lexp(-(vd + m.bv) / (m.nbv * VT));
        id -= m.ibv * eb; gd += m.ibv * deb / (m.nbv * VT);
      }
      return [id, gd];
    }
    load(st, ctx) {
      const x = ctx.x;
      let vd = V(x, this.ai) - V(x, this.k), lim = false;
      if (ctx.init) vd = 0.6 * this.m.n;
      else {
        [vd, lim] = pnjlim(vd, this.vd, this.nvt, this.vcrit);
        if (isFinite(this.m.bv) && vd < -this.m.bv * 0.9) { const [v2, l2] = pnjlim(-vd - this.m.bv, -this.vd - this.m.bv, this.m.nbv * VT, 0.6); vd = -v2 - this.m.bv; lim = lim || l2; }
      }
      if (lim) ctx.limited = true;
      this.vd = vd;
      const [id, gd] = this.eval(vd);
      this.id = id; this.gd = gd;
      st.nl([this.ai, this.k], [id, -id], [[this.ai, this.k]], [[gd], [-gd]], [vd]);
      if (this.ai !== this.a) st.g(this.a, this.ai, 1 / this.m.rs);
      if (this.cap) this.cap.load(st, ctx);
    }
    loadAC(st) { if (this.cap) this.cap.loadAC(st); }
    initTran(x, uic) { if (this.cap) this.cap.initTran(x, uic); }
    accept(x, ctx) { if (this.cap) this.cap.accept(x, ctx); }
    current(x) { const vd = V(x, this.ai) - V(x, this.k); return this.eval(vd)[0] + (this.cap ? this.cap.ip : 0); }
  }

  /* ---- バイポーラトランジスタ (Ebers-Moll + アーリー効果) ---- */
  const QDEF = { is: 1e-14, bf: 100, br: 1, nf: 1, nr: 1, vaf: 100, cje: 0, cjc: 0, tf: 0, rb: 0, rc: 0, re: 0 };
  class BJT {
    constructor(name, c, b, e, model, pnp) {
      Object.assign(this, { name, nc: c, nb: b, ne: e, kind: 'Q', nonlinear: true, pol: pnp ? -1 : 1 });
      this.m = Object.assign({}, QDEF, model || {}); this.vbe = 0; this.vbc = 0;
    }
    setup(c) {
      this.c = c.node(this.nc); this.b = c.node(this.nb); this.e = c.node(this.ne);
      const nm = this.name.toLowerCase();
      this.ci = this.m.rc > 1e-6 ? c.node(nm + '#c') : this.c;
      this.bi = this.m.rb > 1e-6 ? c.node(nm + '#b') : this.b;
      this.ei = this.m.re > 1e-6 ? c.node(nm + '#e') : this.e;
      const m = this.m;
      this.caps = [];
      if (m.cje > 0) { const k = new Capacitor(nm + '#cje', '', '', m.cje); k.a = this.bi; k.b = this.ei; this.caps.push(k); }
      if (m.cjc > 0) { const k = new Capacitor(nm + '#cjc', '', '', m.cjc); k.a = this.bi; k.b = this.ci; this.caps.push(k); }
      this.vcrit = m.nf * VT * Math.log(m.nf * VT / (Math.SQRT2 * m.is));
    }
    eval(vbe, vbc) {
      const m = this.m, nf = m.nf * VT, nr = m.nr * VT;
      const [e1, d1] = lexp(vbe / nf), [e2, d2] = lexp(vbc / nr);
      const If = m.is * (e1 - 1), Ir = m.is * (e2 - 1), gif = m.is * d1 / nf, gir = m.is * d2 / nr;
      let q = 1 - vbc / m.vaf, dq = -1 / m.vaf;
      if (q < 0.1) { q = 0.1; dq = 0; }
      const Ict = (If - Ir) * q;
      const Ic = Ict - Ir / m.br + GMIN * (vbe - vbc) - GMIN * vbc;
      const Ib = If / m.bf + Ir / m.br + GMIN * vbe + GMIN * vbc;
      const dIc_dvbe = gif * q + GMIN, dIc_dvbc = -gir * q + (If - Ir) * dq - gir / m.br - 2 * GMIN;
      const dIb_dvbe = gif / m.bf + GMIN, dIb_dvbc = gir / m.br + GMIN;
      return { Ic, Ib, dIc_dvbe, dIc_dvbc, dIb_dvbe, dIb_dvbc, gm: gif * q, gpi: gif / m.bf };
    }
    load(st, ctx) {
      const x = ctx.x, p = this.pol;
      let vbe = p * (V(x, this.bi) - V(x, this.ei)), vbc = p * (V(x, this.bi) - V(x, this.ci)), l1 = false, l2 = false;
      if (ctx.init) { vbe = 0.65; vbc = -1; }
      else {
        [vbe, l1] = pnjlim(vbe, this.vbe, this.m.nf * VT, this.vcrit);
        [vbc, l2] = pnjlim(vbc, this.vbc, this.m.nr * VT, this.vcrit);
      }
      if (l1 || l2) ctx.limited = true;
      this.vbe = vbe; this.vbc = vbc;
      const r = this.eval(vbe, vbc); this.op = r;
      const Ic = p * r.Ic, Ib = p * r.Ib, Ie = -(Ic + Ib);
      // 制御電圧 (極性込み): vbe' = p*(Vb-Ve), vbc' = p*(Vb-Vc)。dI/dV = p * dI'/dv' * p = dI'/dv'
      const G = [[r.dIc_dvbe, r.dIc_dvbc], [r.dIb_dvbe, r.dIb_dvbc],
                 [-(r.dIc_dvbe + r.dIb_dvbe), -(r.dIc_dvbc + r.dIb_dvbc)]];
      st.nl([this.ci, this.bi, this.ei], [Ic, Ib, Ie], [[this.bi, this.ei], [this.bi, this.ci]], G, [p * vbe, p * vbc]);
      if (this.ci !== this.c) st.g(this.c, this.ci, 1 / this.m.rc);
      if (this.bi !== this.b) st.g(this.b, this.bi, 1 / this.m.rb);
      if (this.ei !== this.e) st.g(this.e, this.ei, 1 / this.m.re);
      for (const k of this.caps) k.load(st, ctx);
    }
    loadAC(st) { for (const k of this.caps) k.loadAC(st); }
    initTran(x, uic) { for (const k of this.caps) k.initTran(x, uic); }
    accept(x, ctx) { for (const k of this.caps) k.accept(x, ctx); }
    terminalCurrents(x) {
      const p = this.pol;
      const r = this.eval(p * (V(x, this.bi) - V(x, this.ei)), p * (V(x, this.bi) - V(x, this.ci)));
      return { ic: p * r.Ic, ib: p * r.Ib, ie: -p * (r.Ic + r.Ib) };
    }
    current(x) { return this.terminalCurrents(x).ic; }
  }

  /* ---- MOSFET (Level 1 + 滑らかなしきい値) ---- */
  const MDEF = { vto: 2, kp: 2e-5, w: 1, l: 1, lambda: 0.01, cgs: 0, cgd: 0, rd: 0, rs: 0, is: 1e-14, body: 1, nsub: 1.5 };
  class MOSFET {
    constructor(name, d, g, s, model, pch) {
      Object.assign(this, { name, nd: d, ng: g, ns: s, kind: 'M', nonlinear: true, pol: pch ? -1 : 1 });
      this.m = Object.assign({}, MDEF, model || {}); this.vgs = 0; this.vds = 0;
      if (pch && this.m.vto > 0) this.m.vto = -this.m.vto;
    }
    setup(c) {
      this.d = c.node(this.nd); this.g = c.node(this.ng); this.s = c.node(this.ns);
      const nm = this.name.toLowerCase();
      this.caps = [];
      if (this.m.cgs > 0) { const k = new Capacitor(nm + '#cgs', '', '', this.m.cgs); k.a = this.g; k.b = this.s; this.caps.push(k); }
      if (this.m.cgd > 0) { const k = new Capacitor(nm + '#cgd', '', '', this.m.cgd); k.a = this.g; k.b = this.d; this.caps.push(k); }
      if (this.m.body) {   // ボディダイオード (N: S→D, P: D→S)
        this.bd = this.pol > 0 ? new Diode(nm + '#bd', '', '', { is: 1e-12, n: 1.2 }) : new Diode(nm + '#bd', '', '', { is: 1e-12, n: 1.2 });
        this.bd.setup({ node: () => -1 });
        if (this.pol > 0) { this.bd.a = this.bd.ai = this.s; this.bd.k = this.d; } else { this.bd.a = this.bd.ai = this.d; this.bd.k = this.s; }
      }
    }
    evalN(vgs, vds) {
      // vds >= 0 前提 (呼び出し側で入れ替え)
      const m = this.m, beta = m.kp * m.w / m.l;
      const vto = this.pol > 0 ? m.vto : -m.vto;
      const nv = m.nsub * VT;
      const u = (vgs - vto) / nv;
      const vov = u > 40 ? vgs - vto : nv * Math.log1p(Math.exp(u));
      const dvov = u > 40 ? 1 : 1 / (1 + Math.exp(-u));
      const cl = 1 + m.lambda * vds;
      let id, gm, gds;
      if (vds < vov) { id = beta * (vov * vds - vds * vds / 2) * cl; gm = beta * vds * cl * dvov; gds = beta * (vov - vds) * cl + beta * (vov * vds - vds * vds / 2) * m.lambda; }
      else { id = beta / 2 * vov * vov * cl; gm = beta * vov * cl * dvov; gds = beta / 2 * vov * vov * m.lambda; }
      return { id: id + GMIN * vds, gm, gds: gds + GMIN };
    }
    load(st, ctx) {
      const x = ctx.x, p = this.pol;
      let vgs = p * (V(x, this.g) - V(x, this.s)), vds = p * (V(x, this.d) - V(x, this.s)), l1 = false, l2 = false;
      const vto = p > 0 ? this.m.vto : -this.m.vto;
      if (ctx.init) { vgs = vto + 0.5; vds = 0.1; }
      else { [vgs, l1] = fetlim(vgs, this.vgs, vto); [vds, l2] = fetlim(vds, this.vds, 0); }
      if (l1 || l2) ctx.limited = true;
      this.vgs = vgs; this.vds = vds;
      let rev = vds < 0;
      let r;
      if (!rev) r = this.evalN(vgs, vds);
      else r = this.evalN(vgs - vds, -vds);   // vgd, vsd
      this.op = r;
      // 電流 (正規化): Id' (D へ流れ込む)
      let Id, dId_dvgs, dId_dvds;
      if (!rev) { Id = r.id; dId_dvgs = r.gm; dId_dvds = r.gds; }
      else { Id = -r.id; dId_dvgs = -r.gm; dId_dvds = r.gm + r.gds; }
      const I = p * Id;
      st.nl([this.d, this.s], [I, -I], [[this.g, this.s], [this.d, this.s]], [[dId_dvgs, dId_dvds], [-dId_dvgs, -dId_dvds]], [p * vgs, p * vds]);
      for (const k of this.caps) k.load(st, ctx);
      if (this.bd) this.bd.load(st, ctx);
    }
    loadAC(st) { for (const k of this.caps) k.loadAC(st); }
    initTran(x, uic) { for (const k of this.caps) k.initTran(x, uic); }
    accept(x, ctx) { for (const k of this.caps) k.accept(x, ctx); }
    current(x) {
      const p = this.pol;
      const vgs = p * (V(x, this.g) - V(x, this.s)), vds = p * (V(x, this.d) - V(x, this.s));
      const r = vds >= 0 ? this.evalN(vgs, vds).id : -this.evalN(vgs - vds, -vds).id;
      let i = p * r;
      if (this.bd) { const vd = V(x, this.bd.a) - V(x, this.bd.k); i += (p > 0 ? -1 : 1) * this.bd.eval(vd)[0]; }
      return i;
    }
  }

  /* ---- JFET ---- */
  const JDEF = { vto: -2, beta: 1e-3, lambda: 0.01, is: 1e-14, cgs: 0, cgd: 0 };
  class JFET {
    constructor(name, d, g, s, model, pch) {
      Object.assign(this, { name, nd: d, ng: g, ns: s, kind: 'J', nonlinear: true, pol: pch ? -1 : 1 });
      this.m = Object.assign({}, JDEF, model || {}); this.vgs = 0; this.vds = 0;
      if (this.m.vto > 0) this.m.vto = -this.m.vto;
    }
    setup(c) {
      this.d = c.node(this.nd); this.g = c.node(this.ng); this.s = c.node(this.ns);
      const nm = this.name.toLowerCase();
      const dm = { is: this.m.is, n: 1 };
      this.dgs = new Diode(nm + '#gs', '', '', dm); this.dgd = new Diode(nm + '#gd', '', '', dm);
      [this.dgs, this.dgd].forEach(dd => dd.setup({ node: () => -1 }));
      if (this.pol > 0) { this.dgs.a = this.dgs.ai = this.g; this.dgs.k = this.s; this.dgd.a = this.dgd.ai = this.g; this.dgd.k = this.d; }
      else { this.dgs.a = this.dgs.ai = this.s; this.dgs.k = this.g; this.dgd.a = this.dgd.ai = this.d; this.dgd.k = this.g; }
      this.caps = [];
      if (this.m.cgs > 0) { const k = new Capacitor(nm + '#cgs', '', '', this.m.cgs); k.a = this.g; k.b = this.s; this.caps.push(k); }
      if (this.m.cgd > 0) { const k = new Capacitor(nm + '#cgd', '', '', this.m.cgd); k.a = this.g; k.b = this.d; this.caps.push(k); }
    }
    evalN(vgs, vds) {
      const m = this.m, nv = 1.2 * VT, u = (vgs - m.vto) / nv;
      const vov = u > 40 ? vgs - m.vto : nv * Math.log1p(Math.exp(u)), dvov = u > 40 ? 1 : 1 / (1 + Math.exp(-u));
      const cl = 1 + m.lambda * vds;
      let id, gm, gds;
      if (vds < vov) { id = m.beta * vds * (2 * vov - vds) * cl; gm = 2 * m.beta * vds * cl * dvov; gds = m.beta * (2 * vov - 2 * vds) * cl + m.beta * vds * (2 * vov - vds) * m.lambda; }
      else { id = m.beta * vov * vov * cl; gm = 2 * m.beta * vov * cl * dvov; gds = m.beta * vov * vov * m.lambda; }
      return { id: id + GMIN * vds, gm, gds: gds + GMIN };
    }
    load(st, ctx) {
      const x = ctx.x, p = this.pol;
      let vgs = p * (V(x, this.g) - V(x, this.s)), vds = p * (V(x, this.d) - V(x, this.s)), l1, l2;
      if (ctx.init) { vgs = 0; vds = 0.5; }
      else { [vgs, l1] = fetlim(vgs, this.vgs, this.m.vto); [vds, l2] = fetlim(vds, this.vds, 0); if (l1 || l2) ctx.limited = true; }
      this.vgs = vgs; this.vds = vds;
      const rev = vds < 0;
      const r = !rev ? this.evalN(vgs, vds) : this.evalN(vgs - vds, -vds);
      this.op = r;
      let Id, a1, a2;
      if (!rev) { Id = r.id; a1 = r.gm; a2 = r.gds; } else { Id = -r.id; a1 = -r.gm; a2 = r.gm + r.gds; }
      const I = p * Id;
      st.nl([this.d, this.s], [I, -I], [[this.g, this.s], [this.d, this.s]], [[a1, a2], [-a1, -a2]], [p * vgs, p * vds]);
      this.dgs.load(st, ctx); this.dgd.load(st, ctx);
      for (const k of this.caps) k.load(st, ctx);
    }
    loadAC(st) { for (const k of this.caps) k.loadAC(st); }
    initTran(x, uic) { for (const k of this.caps) k.initTran(x, uic); }
    accept(x, ctx) { for (const k of this.caps) k.accept(x, ctx); }
    current(x) {
      const p = this.pol, vgs = p * (V(x, this.g) - V(x, this.s)), vds = p * (V(x, this.d) - V(x, this.s));
      return p * (vds >= 0 ? this.evalN(vgs, vds).id : -this.evalN(vgs - vds, -vds).id);
    }
  }

  /* ---- 電圧制御スイッチ ---- */
  class VSwitch {
    constructor(name, a, b, c, d, model) {
      Object.assign(this, { name, na: a, nb: b, nc: c, nd: d, kind: 'S', nonlinear: true });
      this.m = Object.assign({ ron: 1, roff: 1e9, vt: 0.5, vh: 0.1 }, model || {});
    }
    setup(c) { this.a = c.node(this.na); this.b = c.node(this.nb); this.c = c.node(this.nc); this.d = c.node(this.nd); }
    gOf(vc) {
      const m = this.m, w = Math.max(1e-3, m.vh || 0.05);
      const s = 1 / (1 + Math.exp(-(vc - m.vt) / w * 4));
      const lg = Math.log(1 / m.roff) + (Math.log(1 / m.ron) - Math.log(1 / m.roff)) * s;
      const g = Math.exp(lg);
      const dg = g * (Math.log(1 / m.ron) - Math.log(1 / m.roff)) * s * (1 - s) * 4 / w;
      return [g, dg];
    }
    load(st, ctx) {
      const x = ctx.x, v = V(x, this.a) - V(x, this.b), vc = V(x, this.c) - V(x, this.d);
      const [g, dg] = this.gOf(vc), I = g * v;
      st.nl([this.a, this.b], [I, -I], [[this.a, this.b], [this.c, this.d]], [[g, dg * v], [-g, -dg * v]], [v, vc]);
    }
    current(x) { return this.gOf(V(x, this.c) - V(x, this.d))[0] * (V(x, this.a) - V(x, this.b)); }
  }

  /* ---- ビヘイビア電源 (内蔵モデル用) ----
     f(vc[], ctx) -> 値 / 数値微分で線形化  */
  class BSource {
    constructor(name, a, b, ctl, f, isCurrent, rout) {
      Object.assign(this, { name, a, b, ctl, f, isCurrent, rout: rout || 0, kind: 'B', nonlinear: true });
    }
    setup(c) {
      if (!this.isCurrent) {
        this.k = c.branch('i(' + this.name.toLowerCase() + ')');
        if (this.rout > 0) { this.o = c.node(this.name.toLowerCase() + '#o'); }
      }
    }
    load(st, ctx) {
      const x = ctx.x, vc = this.ctl.map(([p, q]) => V(x, p) - V(x, q));
      const f0 = this.f(vc, ctx), d = new Array(vc.length);
      for (let i = 0; i < vc.length; i++) {
        const h = 1e-6 * Math.max(1, Math.abs(vc[i]));
        const v2 = vc.slice(); v2[i] += h;
        d[i] = (this.f(v2, ctx) - f0) / h;
      }
      if (this.isCurrent) {
        st.nl([this.a, this.b], [f0, -f0], this.ctl, [d, d.map(v => -v)], vc);
      } else {
        const p = this.rout > 0 ? this.o : this.a;
        st.vsrc(p, this.b, this.k, 0);
        let r = f0;
        for (let i = 0; i < vc.length; i++) {
          const [pp, qq] = this.ctl[i];
          st.a(this.k, pp, -d[i]); st.a(this.k, qq, d[i]); r -= d[i] * vc[i];
        }
        st.rhs(this.k, r);
        if (this.rout > 0) st.g(this.o, this.a, 1 / this.rout);
      }
    }
    current(x) { return this.isCurrent ? this.f(this.ctl.map(([p, q]) => V(x, p) - V(x, q)), {}) : x[this.k]; }
  }

  /* ================= 内蔵モデル (X 素子で呼び出す) ================= */
  const BUILTINS = {};
  function defineBuiltin(name, def) { BUILTINS[name.toLowerCase()] = def; }
  const soft = (v, lo, hi, k) => {   // なめらかな飽和
    k = k || 0.05;
    const sp = z => z > 30 ? z : Math.log1p(Math.exp(z));
    return lo + k * sp((v - lo) / k) - k * sp((v - hi) / k);
  };

  /* 汎用の複合素子: 子素子をまとめる */
  class Composite {
    constructor(name, parts) { this.name = name; this.parts = parts; this.kind = 'X'; this.nonlinear = parts.some(p => p.nonlinear) || true; }
    setup(c) { for (const p of this.parts) if (p.setup) p.setup(c); }
    link(c) { for (const p of this.parts) if (p.link) p.link(c); }
    load(st, ctx) { for (const p of this.parts) p.load(st, ctx); }
    loadAC(st) { for (const p of this.parts) if (p.loadAC) p.loadAC(st); }
    initTran(x, u) { for (const p of this.parts) if (p.initTran) p.initTran(x, u); }
    accept(x, ctx) { for (const p of this.parts) if (p.accept) p.accept(x, ctx); if (this.onAccept) this.onAccept(x, ctx); }
    current(x) { return this.mainCurrent ? this.mainCurrent(x) : 0; }
  }

  /* オペアンプ: pins in+ in- out v+ v-  / 1ポール + 出力飽和 */
  defineBuiltin('opamp', {
    pins: 5,
    make(c, name, nodes, P) {
      const [ip, im, out, vp, vn] = nodes.map(n => c.node(n));
      const A = P.a || 2e5, gbw = P.gbw || 1e6, rout = P.rout || 50, hr = P.headroom == null ? 0.05 : P.headroom;
      const vos = P.vos || 0;
      const nm = name.toLowerCase();
      const x = c.node(nm + '#x');
      const gm = 1e-3, R = A / gm, Cx = gm / (2 * Math.PI * gbw);
      const railsFixed = P.vpos !== undefined;
      const parts = [
        mk(new Resistor(nm + '#rin', '', '', P.rin || 1e12), ip, im),
        mk(new VCCS(nm + '#g', '', '', '', '', gm), -1, x, ip, im),
        mk(new Resistor(nm + '#rx', '', '', R), x, -1),
        mk(new Capacitor(nm + '#cx', '', '', Cx), x, -1),
        new BSource(nm + '#clamp', x, -1, [[x, -1], [vp, -1], [vn, -1]], (v) => {
          const hi = railsFixed ? P.vpos : v[1], lo = railsFixed ? P.vneg : v[2];
          const ex = soft(v[0], lo - 1, hi + 1, 0.2);
          return (v[0] - ex) * 0.05;   // 積分器の張り付き防止
        }, true),
        new BSource(nm + '#out', out, -1, [[x, -1], [vp, -1], [vn, -1]], (v) => {
          const hi = (railsFixed ? P.vpos : v[1]) - (P.hrp == null ? hr : P.hrp), lo = (railsFixed ? P.vneg : v[2]) + (P.hrn == null ? hr : P.hrn);
          return soft(v[0] + vos * A, Math.min(lo, hi), Math.max(lo, hi), 0.02);
        }, false, rout)
      ];
      // 入力を VCCS の制御に使うため gm の符号: 電流は -1(接地) から x へ → x の電位が上がる
      parts[1].c = ip; parts[1].d = im;
      const comp = new Composite(name, parts);
      comp.pinNodes = { ip, im, out, vp, vn };
      comp.mainCurrent = xx => -parts[5].current(xx);
      return comp;
    }
  });
  /* コンパレータ (オープンコレクタ出力): in+ in- out v+ v- */
  defineBuiltin('comparator', {
    pins: 5,
    make(c, name, nodes, P) {
      const [ip, im, out, vp, vn] = nodes.map(n => c.node(n));
      const nm = name.toLowerCase(), ron = P.ron || 20;
      const sw = new BSource(nm + '#sw', out, vn, [[ip, im], [out, vn]], v => {
        const s = 1 / (1 + Math.exp(v[0] / 0.002));   // in+ < in- で導通
        return v[1] * (s / ron + 1e-9);
      }, true);
      return new Composite(name, [sw]);
    }
  });
  /* 三端子レギュレータ: in gnd out */
  defineBuiltin('regulator', {
    pins: 3,
    make(c, name, nodes, P) {
      const [vin, gnd, out] = nodes.map(n => c.node(n));
      const nm = name.toLowerCase(), Vnom = P.v == null ? 5 : P.v, drop = P.drop == null ? 2 : P.drop, adj = !!P.adj;
      const iq = P.iq == null ? (adj ? 50e-6 : 5e-3) : P.iq;
      const parts = [];
      const neg = Vnom < 0 && !adj;
      parts.push(new BSource(nm + '#reg', out, -1, [[vin, -1], [gnd, -1]], v => {
        const vi = v[0], vg = v[1];
        if (neg) {
          const target = vg + Vnom, lim = vi + drop;
          return -soft(-target, -vg, Math.max(-vg, -lim), 0.05);
        }
        const target = vg + (adj ? 1.25 : Vnom), lim = vi - drop;
        return soft(target, vg, Math.max(vg, lim), 0.05);
      }, false, P.rout || 0.02));
      // 静止電流 (in → gnd)
      parts.push(new BSource(nm + '#iq', vin, gnd, [[vin, gnd]], v => neg ? -iq * Math.tanh(Math.max(0, -v[0]) / 0.5) : iq * Math.tanh(Math.max(0, v[0]) / 0.5), true));
      const comp = new Composite(name, parts);
      comp.mainCurrent = xx => -parts[0].current(xx);
      return comp;
    }
  });

  /* ---- デジタル (イベント駆動) ----
     状態は受理された時刻ごとに更新。出力は Rout 付きの電圧源。 */
  class Digital {
    constructor(name, spec, nodes, P) {
      this.name = name; this.kind = 'X'; this.nonlinear = true; this.spec = spec; this.nodesNm = nodes; this.P = P;
    }
    setup(c) {
      this.nd = this.nodesNm.map(n => c.node(n));
      const s = this.spec, nm = this.name.toLowerCase();
      this.vcc = s.vcc != null ? this.nd[s.vcc] : null;
      this.gnd = s.gnd != null ? this.nd[s.gnd] : -1;
      this.state = s.init ? s.init(this.P) : {};
      this.outs = s.outs.map((pin, i) => {
        const o = { pin, node: this.nd[pin], level: 0, k: c.branch('i(' + nm + '#o' + i + ')'), int: c.node(nm + '#o' + i) };
        return o;
      });
      this.rout = s.rout || 50;
    }
    supply(x) {
      const vcc = this.vcc != null ? V(x, this.vcc) : (this.P.vcc || 5), gnd = V(x, this.gnd);
      return [vcc, gnd];
    }
    inputs(x) {
      const [vcc, gnd] = this.supply(x), sp = this.spec, th = sp.thresh || 0.5;
      const hyst = sp.hyst || 0;
      return this.nd.map((n, i) => {
        const v = (V(x, n) - gnd) / Math.max(0.5, vcc - gnd);
        const prev = this.lastIn ? this.lastIn[i] : 0;
        if (hyst) return prev ? (v > th - hyst ? 1 : 0) : (v > th + hyst ? 1 : 0);
        return v > th ? 1 : 0;
      });
    }
    raw(x) {   // アナログ値 (555 など)
      const [vcc, gnd] = this.supply(x);
      return { v: this.nd.map(n => V(x, n) - gnd), vcc: vcc - gnd };
    }
    compute(x) {
      const ins = this.inputs(x);
      const st = JSON.parse(JSON.stringify(this.state));
      const res = this.spec.step(ins, st, this.lastIn || ins, this.raw(x), this.P);
      return { ins, st, res };
    }
    evaluate(x, commit) {
      const { ins, st, res } = this.compute(x);
      let changed = false;
      this.outs.forEach((o, i) => { const lv = res[i]; if (lv !== o.level) changed = true; if (commit) o.level = lv; });
      if (commit) {
        const sc = JSON.stringify(st) !== JSON.stringify(this.state);
        this.state = st; this.lastIn = ins;
        return changed || sc;
      }
      return changed;
    }
    load(st, ctx) {
      const x = ctx.x;
      for (const o of this.outs) {
        // 出力 = gnd + level*(vcc-gnd) (level: 0..1, または 'z' ハイインピーダンス)
        st.vsrc(o.int, -1, o.k, 0);
        const lv = o.level, lo = this.spec.vol || 0, hi = this.spec.voh == null ? 0 : this.spec.voh;
        // V(int) - [ (1-lv)*gnd + lv*vcc ] = off
        const off = lv ? -hi : lo;
        if (this.vcc != null) st.a(o.k, this.vcc, -lv);
        st.a(o.k, this.gnd, -(1 - lv));
        st.rhs(o.k, this.vcc != null ? off : off + lv * (this.P.vcc || 5));
        st.g(o.int, o.node, 1 / this.rout);
      }
      // 電源電流 (静止): vcc-gnd に大きな抵抗
      if (this.vcc != null) st.g(this.vcc, this.gnd, 1e-6);
      if (this.spec.load) this.spec.load(this, st, ctx);
    }
    initTran(x) { this.settle(x); }
    settle(x) { for (let i = 0; i < 4; i++) if (!this.evaluate(x, true)) break; }
    wouldChange(x) { return this.evaluate(x, false); }
    accept(x) { return this.evaluate(x, true); }
    current(x) { const o = this.outs[0]; return o ? -x[o.k] : 0; }
  }
  function mk(e, a, b, c, d) { e.a = a; e.b = b; if (c !== undefined) { e.c = c; e.d = d; } e.setup = null; return e; }

  /* ---- 555 タイマ: pins 1..8 = GND TRIG OUT RESET CTRL THR DIS VCC ---- */
  defineBuiltin('ne555', {
    pins: 8,
    make(c, name, nodes, P) {
      const nm = name.toLowerCase();
      const n = nodes.map(x => c.node(x));
      const [GND, TRIG, OUT, RST, CTRL, THR, DIS, VCC] = n;
      const dig = new Digital(name, {
        vcc: 7, gnd: 0, outs: [2], rout: 10, voh: 1.7, vol: 0.1,
        init: () => ({ q: 0 }),
        step(ins, st, prev, raw) {
          const v = raw.v, vc = v[4];
          if (v[3] < 0.7) st.q = 0;
          else if (v[1] < vc / 2) st.q = 1;
          else if (v[5] > vc) st.q = 0;
          return [st.q];
        }
      }, nodes, P);
      const disc = new BSource(nm + '#dis', DIS, GND, [[DIS, GND]], (v) => dig.outs[0] && dig.outs[0].level ? v[0] * 1e-9 : v[0] / 10, true);
      const parts = [
        mk(new Resistor(nm + '#r1', '', '', 5000), VCC, CTRL),
        mk(new Resistor(nm + '#r2', '', '', 10000), CTRL, GND),
        mk(new Resistor(nm + '#rq', '', '', 3000), VCC, GND),   // 静止電流 ≈ 数 mA 相当
        mk(new Resistor(nm + '#rtr', '', '', 1e9), TRIG, GND),
        mk(new Resistor(nm + '#rth', '', '', 1e9), THR, GND),
        mk(new Resistor(nm + '#rrs', '', '', 1e6), RST, VCC),
        disc
      ];
      const comp = new Composite(name, parts.concat([dig]));
      comp.digital = [dig];
      comp.mainCurrent = xx => dig.current(xx);
      return comp;
    }
  });

  /* ---- ロジック IC の汎用定義: gates [{f, in:[pin...], out:pin}] ピン番号は 1 始まり ---- */
  const GATEF = {
    nand: a => a.every(Boolean) ? 0 : 1, and: a => a.every(Boolean) ? 1 : 0,
    or: a => a.some(Boolean) ? 1 : 0, nor: a => a.some(Boolean) ? 0 : 1,
    xor: a => a.reduce((s, v) => s ^ v, 0), xnor: a => a.reduce((s, v) => s ^ v, 0) ? 0 : 1,
    not: a => a[0] ? 0 : 1, buf: a => a[0] ? 1 : 0
  };
  function logicChip(def) {
    // def: {pins, vcc, gnd, gates? , seq? {outs:[pins], init, step(ins(by pin), st, prev)}, hyst}
    return {
      pins: def.pins,
      make(c, name, nodes, P) {
        const outsPins = def.gates ? def.gates.map(g => g.out - 1) : def.seq.outs.map(p => p - 1);
        const dig = new Digital(name, {
          vcc: def.vcc - 1, gnd: def.gnd - 1, outs: outsPins, rout: def.rout || 60, hyst: def.hyst || 0,
          init: def.seq && def.seq.init,
          step(ins, st, prev) {
            const pin = p => ins[p - 1], ppin = p => prev[p - 1];
            if (def.gates) return def.gates.map(g => GATEF[g.f](g.in.map(pin)));
            return def.seq.step(pin, st, ppin);
          }
        }, nodes, P);
        const comp = new Composite(name, [dig]);
        comp.digital = [dig];
        return comp;
      }
    };
  }

  /* ================= ネットリスト パーサ ================= */
  function tokenize(line) {
    // 括弧内の区切りを保ったままトークン化。 key=value は1トークン
    line = line.replace(/\(\s*/g, '(').replace(/\s*\)/g, ')').replace(/\s*=\s*/g, '=');
    const out = []; let cur = '', depth = 0;
    for (const ch of line) {
      if (ch === '(' ) depth++;
      if (ch === ')') depth = Math.max(0, depth - 1);
      if (depth === 0 && /[\s,]/.test(ch)) { if (cur) out.push(cur); cur = ''; }
      else cur += ch;
    }
    if (cur) out.push(cur);
    return out;
  }
  function parseParams(toks, params) {
    const o = {};
    toks.forEach(t => { const m = t.match(/^([A-Za-z_][\w.]*)=(.+)$/); if (m) o[m[1].toLowerCase()] = parseNum(m[2], params); });
    return o;
  }
  function parseModelLine(toks, params) {
    // .model NAME TYPE(p=v ...)  or .model NAME TYPE p=v ...
    const name = toks[1];
    let rest = toks.slice(2).join(' ');
    const m = rest.match(/^([A-Za-z]+)\s*\(?(.*?)\)?\s*$/);
    if (!m) throw new Error('.model の書式が正しくありません: ' + toks.join(' '));
    const type = m[1].toUpperCase();
    const p = {};
    (m[2].replace(/\s*=\s*/g, '=').match(/[A-Za-z_]\w*=[^\s,]+/g) || []).forEach(kv => {
      const [k, v] = kv.split('='); p[k.toLowerCase()] = parseNum(v, params);
    });
    return { name: name.toLowerCase(), type, p };
  }
  function parseSourceSpec(toks, params) {
    const spec = { dc: 0, ac: 0, acp: 0, kind: 'dc', args: [] };
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i], lo = t.toLowerCase();
      const fm = t.match(/^(sin|sine|pulse|pwl|exp)\((.*)\)$/i);
      if (fm) {
        spec.kind = fm[1].toLowerCase() === 'sine' ? 'sin' : fm[1].toLowerCase();
        spec.args = fm[2].trim().split(/[\s,]+/).filter(Boolean).map(v => parseNum(v, params));
        continue;
      }
      if (/^(sin|sine|pulse|pwl|exp)$/i.test(t) && toks[i + 1] && toks[i + 1][0] === '(') {
        spec.kind = lo === 'sine' ? 'sin' : lo;
        spec.args = toks[i + 1].slice(1, -1).trim().split(/[\s,]+/).filter(Boolean).map(v => parseNum(v, params));
        i++; continue;
      }
      if (lo === 'dc') { spec.dc = parseNum(toks[++i], params); continue; }
      if (lo === 'ac') {
        spec.ac = parseNum(toks[++i], params);
        if (toks[i + 1] && isFinite(parseNum(toks[i + 1], params))) spec.acp = parseNum(toks[++i], params);
        if (!isFinite(spec.ac)) spec.ac = 1;
        continue;
      }
      const v = parseNum(t, params);
      if (isFinite(v)) spec.dc = v;
    }
    if (spec.kind !== 'dc' && spec.dc === 0) spec.dc = makeWave(spec).dc;
    return spec;
  }

  const MODEL_LIB = {};   // 部品ライブラリが登録する既定モデル (名前 -> {type,p})
  function registerModel(name, type, p) { MODEL_LIB[name.toLowerCase()] = { name: name.toLowerCase(), type: type.toUpperCase(), p }; }

  function parseNetlist(text) {
    const raw = String(text).replace(/\r/g, '').split('\n');
    const lines = [];
    let title = '';
    raw.forEach((l, i) => {
      let s = l.replace(/;.*$/, '').replace(/\s\$.*$/, '');
      if (i === 0 && !/^\s*[.+*]/.test(s) && !/^\s*[rclvidqmjegfhksxb]\S*\s+\S+\s+\S+/i.test(s)) { title = s.trim(); return; }
      if (/^\s*\*/.test(s)) { if (i === 0) title = s.replace(/^\s*\*+\s*/, ''); return; }
      if (/^\s*\+/.test(s) && lines.length) { lines[lines.length - 1].t += ' ' + s.replace(/^\s*\+/, ''); return; }
      if (s.trim()) lines.push({ t: s.trim(), n: i + 1 });
    });
    const params = {}, models = {}, subckts = {}, cards = [], analyses = [], probes = [], ics = {}, opts = {};
    let sub = null;
    for (const { t, n } of lines) {
      const toks = tokenize(t);
      const head = toks[0].toLowerCase();
      try {
        if (head === '.subckt') { sub = { name: toks[1].toLowerCase(), pins: toks.slice(2).filter(x => !x.includes('=')), defaults: parseParams(toks.slice(2), params), cards: [] }; subckts[sub.name] = sub; continue; }
        if (head === '.ends') { sub = null; continue; }
        if (sub && head[0] !== '.') { sub.cards.push({ toks, n }); continue; }
        if (sub && head === '.model') { const m = parseModelLine(toks, params); models[m.name] = m; continue; }
        switch (head) {
          case '.param': toks.slice(1).forEach(kv => { const m = kv.match(/^(\w+)=(.+)$/); if (m) params[m[1].toLowerCase()] = parseNum(m[2], params); }); break;
          case '.model': { const m = parseModelLine(toks, params); models[m.name] = m; break; }
          case '.tran': {
            const nums = toks.slice(1).filter(x => !/^uic$/i.test(x)).map(x => parseNum(x, params));
            analyses.push({ type: 'tran', tstep: nums[0], tstop: nums[1], tstart: nums[2] || 0, tmax: nums[3], uic: toks.some(x => /^uic$/i.test(x)) });
            break;
          }
          case '.ac': analyses.push({ type: 'ac', sweep: toks[1].toLowerCase(), n: parseNum(toks[2]), fstart: parseNum(toks[3], params), fstop: parseNum(toks[4], params) }); break;
          case '.dc': analyses.push({ type: 'dc', src: toks[1], start: parseNum(toks[2], params), stop: parseNum(toks[3], params), step: parseNum(toks[4], params) }); break;
          case '.op': analyses.push({ type: 'op' }); break;
          case '.ic': toks.slice(1).forEach(kv => { const m = kv.match(/^v\((.+)\)=(.+)$/i); if (m) ics[m[1].toLowerCase()] = parseNum(m[2], params); }); break;
          case '.probe': case '.plot': case '.print': toks.slice(1).forEach(x => { if (/^[vi]\(/i.test(x)) probes.push(x.toLowerCase()); }); break;
          case '.options': case '.option': Object.assign(opts, parseParams(toks.slice(1), params)); break;
          case '.end': case '.backanno': case '.include': case '.lib': case '.save': case '.meas': case '.measure': case '.temp': break;
          default:
            if (head[0] === '.') break;
            cards.push({ toks, n });
        }
      } catch (e) { throw new Error(`${n} 行目: ${e.message}`); }
    }
    return { title, params, models, subckts, cards, analyses, probes, ics, opts };
  }

  function findModel(nl, name, types) {
    const k = String(name).toLowerCase();
    const m = nl.models[k] || MODEL_LIB[k];
    if (!m) return null;
    if (types && !types.includes(m.type)) return null;
    return m;
  }

  function buildCircuit(nl) {
    const c = new Circuit();
    c.title = nl.title;
    function expand(cards, prefix, map, params, depth) {
      if (depth > 12) throw new Error('サブ回路の入れ子が深すぎます');
      const nm = s => {
        const k = String(s).toLowerCase();
        if (k === '0' || k === 'gnd') return '0';
        if (map && map[k] !== undefined) return map[k];
        return prefix ? prefix + '.' + k : k;
      };
      const P = v => parseNum(v, params);
      for (const { toks, n } of cards) {
        const name0 = toks[0], name = prefix ? prefix + '.' + name0 : name0;
        const t = name0[0].toLowerCase();
        const need = k => { if (toks.length < k) throw new Error(`${n} 行目: ${name0} の端子/値が足りません`); };
        try {
          switch (t) {
            case 'r': need(4); c.add(new Resistor(name, nm(toks[1]), nm(toks[2]), P(toks[3]))); break;
            case 'c': { need(4); const o = parseParams(toks.slice(4), params); c.add(new Capacitor(name, nm(toks[1]), nm(toks[2]), P(toks[3]), o.ic)); break; }
            case 'l': { need(4); const o = parseParams(toks.slice(4), params); c.add(new Inductor(name, nm(toks[1]), nm(toks[2]), P(toks[3]), o.ic)); break; }
            case 'v': need(3); c.add(new VSource(name, nm(toks[1]), nm(toks[2]), parseSourceSpec(toks.slice(3), params))); break;
            case 'i': need(3); c.add(new ISource(name, nm(toks[1]), nm(toks[2]), parseSourceSpec(toks.slice(3), params))); break;
            case 'e': need(6); c.add(new VCVS(name, nm(toks[1]), nm(toks[2]), nm(toks[3]), nm(toks[4]), P(toks[5]))); break;
            case 'g': need(6); c.add(new VCCS(name, nm(toks[1]), nm(toks[2]), nm(toks[3]), nm(toks[4]), P(toks[5]))); break;
            case 'f': need(5); c.add(new CCCS(name, nm(toks[1]), nm(toks[2]), prefix ? prefix + '.' + toks[3] : toks[3], P(toks[4]))); break;
            case 'h': need(5); c.add(new CCVS(name, nm(toks[1]), nm(toks[2]), prefix ? prefix + '.' + toks[3] : toks[3], P(toks[4]))); break;
            case 'k': need(4); c.add(new Coupling(name, prefix ? prefix + '.' + toks[1] : toks[1], prefix ? prefix + '.' + toks[2] : toks[2], P(toks[3]))); break;
            case 'd': {
              need(4); const m = findModel(nl, toks[3], ['D']);
              if (!m) c.warnings.push(`${name0}: モデル ${toks[3]} が無いので標準ダイオードで代用`);
              c.add(new Diode(name, nm(toks[1]), nm(toks[2]), m ? m.p : {})); break;
            }
            case 'q': {
              need(5);
              let mi = 4; if (toks.length > 5 && !findModel(nl, toks[4]) && findModel(nl, toks[5])) mi = 5;
              const m = findModel(nl, toks[mi], ['NPN', 'PNP']);
              const pnp = m ? m.type === 'PNP' : /pnp|2sa|2sb|bc55|2n3906|2n2907/i.test(toks[mi]);
              if (!m) c.warnings.push(`${name0}: モデル ${toks[mi]} が無いので標準${pnp ? 'PNP' : 'NPN'}で代用`);
              const extra = parseParams(toks.slice(mi + 1), params);
              c.add(new BJT(name, nm(toks[1]), nm(toks[2]), nm(toks[3]), Object.assign({}, m ? m.p : {}, extra), pnp)); break;
            }
            case 'm': {
              need(5);
              let mi = 5; if (!toks[5] || /=/.test(toks[5]) || (!findModel(nl, toks[5]) && findModel(nl, toks[4]))) mi = 4;
              const m = findModel(nl, toks[mi], ['NMOS', 'PMOS']);
              const p = m ? m.type === 'PMOS' : /pmos|2sj|irf9|pch/i.test(toks[mi]);
              if (!m) c.warnings.push(`${name0}: モデル ${toks[mi]} が無いので標準MOSFETで代用`);
              const extra = parseParams(toks.slice(mi + 1), params);
              c.add(new MOSFET(name, nm(toks[1]), nm(toks[2]), nm(toks[3]), Object.assign({}, m ? m.p : {}, extra), p)); break;
            }
            case 'j': {
              need(5); const m = findModel(nl, toks[4], ['NJF', 'PJF']);
              if (!m) c.warnings.push(`${name0}: モデル ${toks[4]} が無いので標準JFETで代用`);
              c.add(new JFET(name, nm(toks[1]), nm(toks[2]), nm(toks[3]), m ? m.p : {}, m ? m.type === 'PJF' : false)); break;
            }
            case 's': {
              need(6); const m = findModel(nl, toks[5], ['SW']);
              c.add(new VSwitch(name, nm(toks[1]), nm(toks[2]), nm(toks[3]), nm(toks[4]), m ? m.p : {})); break;
            }
            case 'x': {
              const pos = toks.slice(1).filter(x => !x.includes('='));
              const kv = parseParams(toks.slice(1), params);
              const sname = pos[pos.length - 1].toLowerCase(), pins = pos.slice(0, -1);
              const sc = nl.subckts[sname];
              if (sc) {
                if (sc.pins.length !== pins.length) throw new Error(`${name0}: サブ回路 ${sname} の端子数 (${sc.pins.length}) と一致しません`);
                const map = {}; sc.pins.forEach((p, i) => map[p.toLowerCase()] = nm(pins[i]));
                const P2 = Object.assign({}, params, sc.defaults, kv);
                expand(sc.cards, name.toLowerCase(), map, P2, depth + 1);
              } else if (BUILTINS[sname]) {
                const b = BUILTINS[sname];
                if (b.pins && pins.length !== b.pins) throw new Error(`${name0}: ${sname} は ${b.pins} 端子です (${pins.length} 端子が指定されています)`);
                const mdl = nl.models[sname];
                c.add(b.make(c, name, pins.map(nm), Object.assign({}, mdl ? mdl.p : {}, kv)));
              } else throw new Error(`${name0}: サブ回路 / 内蔵モデル ${sname} が見つかりません`);
              break;
            }
            default: throw new Error(`${n} 行目: 未対応の素子 ${name0}`);
          }
        } catch (e) { if (/行目/.test(e.message)) throw e; throw new Error(`${n} 行目: ${e.message}`); }
      }
    }
    expand(nl.cards, '', null, nl.params, 0);
    c.setup();
    for (const [k, v] of Object.entries(nl.ics || {})) { const i = c.varIdx.get(k); if (i !== undefined) c.ics.set(i, v); }
    return c;
  }

  /* ================= 解析 ================= */
  function newton(c, st, x0, ctx, maxIt) {
    const n = c.n;
    let x = Float64Array.from(x0);
    for (let it = 0; it < maxIt; it++) {
      st.clear();
      ctx.x = x; ctx.limited = false;
      for (const e of c.elems) e.load(st, ctx);
      // gmin: すべての節点から接地へ
      const gm = ctx.gmin || GMIN;
      for (let i = 0; i < n; i++) if (c.varKind[i] === 'v') st.A[i * n + i] += gm;
      if (ctx.nodeset) for (const [i, v] of ctx.nodeset) { st.A[i * n + i] += 1; st.b[i] += v; }
      const xn = luSolve(st.A, st.b, n);
      if (!xn) return { ok: false, reason: 'singular', x };
      let conv = !ctx.limited && it > 0;
      for (let i = 0; i < n; i++) {
        if (!isFinite(xn[i])) return { ok: false, reason: 'nan', x };
        const tol = 1e-3 * Math.max(Math.abs(xn[i]), Math.abs(x[i])) + (c.varKind[i] === 'v' ? 1e-6 : 1e-9);
        if (Math.abs(xn[i] - x[i]) > tol) conv = false;
      }
      // ダンピング (大きすぎる更新を抑える)
      let damp = 1;
      if (c.nl) { let mx = 0; for (let i = 0; i < n; i++) if (c.varKind[i] === 'v') mx = Math.max(mx, Math.abs(xn[i] - x[i])); if (mx > 20 && it > 0) damp = 20 / mx; }
      for (let i = 0; i < n; i++) x[i] += damp * (xn[i] - x[i]);
      ctx.init = false;
      if (conv && damp === 1) return { ok: true, x, it: it + 1 };
      if (!c.nl && it >= 1) return { ok: true, x, it: it + 1 };
    }
    return { ok: false, reason: 'noconv', x };
  }

  function settleDigital(c, x) {
    for (const e of c.elems) if (e.digital) e.digital.forEach(d => d.settle(x));
  }

  function opPoint(c, opt) {
    opt = opt || {};
    const n = c.n, st = new Stamp(n);
    let x = new Float64Array(n);
    const base = { mode: 'dc', t: 0, srcFact: 1, init: true, gmin: GMIN };
    const tryN = (ctx, x0, it) => newton(c, st, x0, Object.assign({}, base, ctx), it || 150);
    let r;
    for (let round = 0; round < 6; round++) {
      r = tryN({}, x);
      if (!r.ok) {   // gmin ステッピング
        let xx = new Float64Array(n), ok = true;
        for (let g = 1e-2; g >= 1e-13; g /= 10) {
          const rr = tryN({ gmin: Math.max(g, GMIN), init: g === 1e-2 }, xx, 200);
          if (!rr.ok) { ok = false; break; }
          xx = rr.x;
        }
        if (ok) r = tryN({ init: false }, xx);
      }
      if (!r.ok) {   // 電源ステッピング
        let xx = new Float64Array(n), ok = true;
        for (let s = 0.05; s <= 1.0001; s += 0.05) {
          const rr = tryN({ srcFact: s, init: s === 0.05 }, xx, 300);
          if (!rr.ok) { ok = false; break; }
          xx = rr.x;
        }
        if (ok) r = tryN({ init: false }, xx);
      }
      if (!r.ok) throw new Error('動作点が求まりませんでした（' + (r.reason === 'singular' ? '回路が閉じていない / 浮いた節点があります' : '収束しません') + '）');
      x = r.x;
      // デジタル素子の状態を確定させて再計算
      let changed = false;
      for (const e of c.elems) if (e.digital) e.digital.forEach(d => { if (d.accept(x)) changed = true; });
      if (!changed) break;
    }
    return x;
  }

  function resultNames(c) {
    const names = [], getters = [];
    c.varNames.forEach((nm, i) => {
      if (c.varKind[i] === 'v') { if (nm.includes('#')) return; names.push('v(' + nm + ')'); getters.push(x => x[i]); }
    });
    for (const e of c.elems) {
      if (!e.current || e.kind === 'K') continue;
      const nm = e.name.toLowerCase();
      if (e.kind === 'Q') {
        names.push('ic(' + nm + ')', 'ib(' + nm + ')', 'ie(' + nm + ')');
        getters.push(x => e.terminalCurrents(x).ic, x => e.terminalCurrents(x).ib, x => e.terminalCurrents(x).ie);
      } else if (e.kind === 'C') { names.push('i(' + nm + ')'); getters.push(() => e.ip); }
      else if (e.kind === 'D' && e.cap) { names.push('i(' + nm + ')'); getters.push(x => e.current(x)); }
      else { names.push('i(' + nm + ')'); getters.push((x, ctx) => e.kind === 'I' ? e.value(ctx || { mode: 'dc' }) : e.current(x)); }
    }
    return { names, getters };
  }

  function runOP(c) {
    const x = opPoint(c);
    const { names, getters } = resultNames(c);
    const vals = getters.map(g => g(x, { mode: 'dc' }));
    // 素子ごとの消費電力
    const power = {};
    for (const e of c.elems) {
      if (e.kind === 'R') power[e.name.toLowerCase()] = e.current(x) ** 2 * e.R;
    }
    return { type: 'op', names, values: vals, x, power };
  }

  function runDC(c, a) {
    const src = c.byName.get(String(a.src).toLowerCase());
    if (!src || (src.kind !== 'V' && src.kind !== 'I')) throw new Error('.dc: 掃引する電源 ' + a.src + ' がありません');
    const { names, getters } = resultNames(c);
    const st = new Stamp(c.n), pts = [];
    const step = a.step || (a.stop - a.start) / 100;
    const N = Math.min(100000, Math.floor(Math.abs((a.stop - a.start) / step) + 1e-9) + 1);
    const data = names.map(() => new Float64Array(N)), sweep = new Float64Array(N);
    let x = null;
    for (let i = 0; i < N; i++) {
      const v = a.start + i * Math.abs(step) * Math.sign(a.stop - a.start || 1);
      src.dcOverride = v;
      if (!x) x = opPoint(c);
      else {
        const r = newton(c, st, x, { mode: 'dc', srcFact: 1, gmin: GMIN }, 200);
        x = r.ok ? r.x : opPoint(c);
      }
      sweep[i] = v; getters.forEach((g, k) => data[k][i] = g(x, { mode: 'dc' }));
      pts.push(v);
    }
    delete src.dcOverride;
    return { type: 'dc', xname: String(a.src).toLowerCase(), x: sweep, names, data };
  }

  function runTran(c, a, hooks) {
    const tstop = a.tstop, tstart = a.tstart || 0;
    if (!(tstop > 0)) throw new Error('.tran の停止時間が正しくありません');
    let tmax = a.tmax || Math.min(a.tstep > 0 ? a.tstep : tstop / 500, tstop / 50);
    for (const e of c.elems) if (e.w && e.w.tmax < tmax) tmax = Math.max(e.w.tmax, tstop / 2e5);
    const hmin = tstop * 1e-12;
    const maxPts = (a.maxPoints || 200000);
    const n = c.n, st = new Stamp(n);
    const { names, getters } = resultNames(c);
    const digs = []; for (const e of c.elems) if (e.digital) digs.push(...e.digital);
    // 初期状態
    let x;
    if (a.uic) {
      x = new Float64Array(n);
      for (const [i, v] of c.ics) x[i] = v;
      settleDigital(c, x);
    } else {
      if (c.ics.size) {
        const ctx0 = { mode: 'dc', srcFact: 1, gmin: GMIN, init: true, nodeset: [...c.ics] };
        const r = newton(c, st, new Float64Array(n), ctx0, 200);
        x = r.ok ? r.x : opPoint(c);
      } else x = opPoint(c);
    }
    for (const e of c.elems) if (e.initTran) e.initTran(x, a.uic);
    // ブレークポイント
    let bps = [];
    for (const e of c.elems) if (e.w) bps.push(...e.w.bp(tstop));
    bps = [...new Set(bps.filter(t => t > 0 && t < tstop))].sort((p, q) => p - q); bps.push(tstop);
    let bi = 0;
    const T = [], D = names.map(() => []);
    const rec = (t, xx, ctx) => { if (t >= tstart - 1e-15) { T.push(t); getters.forEach((g, k) => D[k].push(g(xx, ctx))); } };
    rec(0, x, { mode: 'tran', t: 0 });
    let t = 0, h = Math.min(tmax, tstop / 1000) / 10, first = true, steps = 0, rejects = 0;
    const tStart = Date.now();
    let vscale = 1; for (let i = 0; i < n; i++) if (c.varKind[i] === 'v') vscale = Math.max(vscale, Math.abs(x[i]));
    const dvmax = Math.max(0.2, vscale * 0.05);
    while (t < tstop * (1 - 1e-12)) {
      while (bi < bps.length && bps[bi] <= t * (1 + 1e-12) + 1e-18) bi++;
      const nb = bi < bps.length ? bps[bi] : tstop;
      let hh = Math.min(h, tmax, nb - t);
      if (hh < hmin) hh = Math.min(hmin, nb - t);
      const ctx = { mode: 'tran', t: t + hh, h: hh, method: first ? 'be' : 'trap', srcFact: 1, gmin: GMIN };
      const r = newton(c, st, x, ctx, 50);
      steps++;
      if (!r.ok) {
        rejects++; h = hh / 8;
        if (h < hmin) throw new Error(`時刻 ${fmt(t, 's')} で収束しませんでした（時間刻みが小さくなりすぎました）`);
        continue;
      }
      // 電圧変化が大きすぎる場合は刻みを小さく
      if (!first && hh > hmin * 1e3) {
        let mx = 0; for (let i = 0; i < n; i++) if (c.varKind[i] === 'v') mx = Math.max(mx, Math.abs(r.x[i] - x[i]));
        if (mx > dvmax) { h = hh * Math.max(0.1, 0.8 * dvmax / mx); rejects++; continue; }
      }
      // デジタルのしきい値通過は刻みを詰めて時刻を正確に
      if (digs.length && hh > Math.max(hmin * 10, tstop * 2e-7)) {
        if (digs.some(d => d.wouldChange(r.x))) { h = hh / 3; rejects++; continue; }
      }
      // 受理
      x = r.x; t = t + hh;
      for (const e of c.elems) if (e.accept && !e.digital) e.accept(x, ctx);
      let evt = false;
      for (const e of c.elems) if (e.digital) { for (const d of e.digital) if (d.accept(x)) evt = true; if (e.onAccept) e.onAccept(x, ctx); for (const p of e.parts) if (p.accept && !(p instanceof Digital)) p.accept(x, ctx); }
      rec(t, x, ctx);
      if (T.length > maxPts) throw new Error('データ点が多すぎます。最大刻みを大きくするか、停止時間を短くしてください');
      const atBp = Math.abs(t - nb) <= 1e-12 * Math.max(1, tstop);
      first = atBp || evt;
      if (first) h = Math.min(tmax / 10, h); else h = r.it <= 4 ? Math.min(tmax, hh * 1.6) : r.it > 12 ? hh * 0.5 : hh;
      if (hooks && hooks.progress && (steps & 255) === 0) hooks.progress(t / tstop);
      if (Date.now() - tStart > (a.timeout || 60000)) throw new Error('計算時間が長すぎるため中断しました（' + fmt(t, 's') + ' まで計算）');
    }
    return { type: 'tran', xname: 'time', x: Float64Array.from(T), names, data: D.map(d => Float64Array.from(d)), steps, rejects };
  }

  function runAC(c, a) {
    const x = opPoint(c);
    const n = c.n, st = new Stamp(n);
    st.C = new Float64Array(n * n);
    // 動作点で線形化した G 行列
    const ctx = { mode: 'dc', srcFact: 1, gmin: GMIN, x, ac: true };
    st.clear(); st.C.fill(0);
    for (const e of c.elems) { if (e.acZero) e.acZero(st); else if (e.kind === 'I') { /* 開放 */ } else e.load(st, ctx); }
    for (let i = 0; i < n; i++) if (c.varKind[i] === 'v') st.A[i * n + i] += GMIN;
    for (const e of c.elems) if (e.loadAC) e.loadAC(st);
    const G = Float64Array.from(st.A), C = st.C;
    const br0 = new Float64Array(n), bi0 = new Float64Array(n);
    for (const e of c.elems) if (e.loadACsrc) e.loadACsrc(br0, bi0);
    if (!br0.some(v => v) && !bi0.some(v => v)) throw new Error('AC 解析: 「AC 1」を指定した信号源がありません');
    const freqs = [];
    const { fstart, fstop } = a, N = Math.max(1, a.n | 0);
    if (a.sweep === 'lin') { for (let i = 0; i < N; i++) freqs.push(N === 1 ? fstart : fstart + (fstop - fstart) * i / (N - 1)); }
    else {
      const per = a.sweep === 'oct' ? Math.log(2) : Math.log(10);
      const tot = Math.max(1, Math.ceil(Math.log(fstop / fstart) / per * N));
      for (let i = 0; i <= tot; i++) freqs.push(fstart * Math.exp(Math.log(fstop / fstart) * i / tot));
    }
    const { names } = resultNames(c);
    const vIdx = []; c.varNames.forEach((nm, i) => { if (c.varKind[i] === 'v' && !nm.includes('#')) vIdx.push(i); });
    const iEl = c.elems.filter(e => e.k !== undefined && (e.kind === 'V' || e.kind === 'L' || e.kind === 'E' || e.kind === 'H'));
    const outNames = vIdx.map(i => 'v(' + c.varNames[i] + ')').concat(iEl.map(e => 'i(' + e.name.toLowerCase() + ')'));
    const re = outNames.map(() => new Float64Array(freqs.length)), im = outNames.map(() => new Float64Array(freqs.length));
    freqs.forEach((f, fi) => {
      const w = 2 * Math.PI * f;
      const Ar = Float64Array.from(G), Ai = new Float64Array(n * n);
      for (let i = 0; i < n * n; i++) Ai[i] = w * C[i];
      const sol = cluSolve(Ar, Ai, Float64Array.from(br0), Float64Array.from(bi0), n);
      if (!sol) throw new Error('AC 解析: 行列が特異です');
      vIdx.forEach((i, k) => { re[k][fi] = sol[0][i]; im[k][fi] = sol[1][i]; });
      iEl.forEach((e, k) => { re[vIdx.length + k][fi] = sol[0][e.k]; im[vIdx.length + k][fi] = sol[1][e.k]; });
    });
    void names;
    return { type: 'ac', xname: 'frequency', x: Float64Array.from(freqs), names: outNames, re, im };
  }

  function simulate(text, which, hooks) {
    const nl = typeof text === 'string' ? parseNetlist(text) : text;
    const c = buildCircuit(nl);
    let a = which || nl.analyses[nl.analyses.length - 1] || { type: 'op' };
    let res;
    switch (a.type) {
      case 'op': res = runOP(c); break;
      case 'dc': res = runDC(c, a); break;
      case 'tran': res = runTran(c, a, hooks); break;
      case 'ac': res = runAC(c, a); break;
      default: throw new Error('未対応の解析: ' + a.type);
    }
    res.warnings = c.warnings; res.analysis = a; res.probes = nl.probes; res.title = nl.title;
    return res;
  }

  global.Spice = {
    VT, parseNum, fmt, evalExpr, parseNetlist, buildCircuit, simulate, opPoint, runOP, runDC, runTran, runAC,
    defineBuiltin, logicChip, registerModel, MODEL_LIB, BUILTINS, luSolve, cluSolve, makeWave, soft
  };
})(typeof window !== 'undefined' ? window : globalThis);
