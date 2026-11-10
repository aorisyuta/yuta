/* ---- spice-models.js ---- */
/* =====================================================================
   UniBoard SPICE — IC の動作モデル (ロジック / TL431 / 単体ゲート)
   Spice だけに依存 (ワーカーでも読み込む)
   ===================================================================== */
(function (global) {
  'use strict';
  const SP = global.Spice;
  /* ---------------- ロジック IC の動作モデル ---------------- */
  const LC = SP.logicChip;
  const Q4 = (f, a) => a.map(g => ({ f, in: g.slice(0, -1), out: g[g.length - 1] }));
  const P7400 = [[1, 2, 3], [4, 5, 6], [10, 9, 8], [13, 12, 11]];
  const P7402 = [[2, 3, 1], [5, 6, 4], [8, 9, 10], [11, 12, 13]];
  const P7404 = [[1, 2], [3, 4], [5, 6], [9, 8], [11, 10], [13, 12]];
  const P4001 = [[1, 2, 3], [5, 6, 4], [8, 9, 10], [12, 13, 11]];
  const P7410 = [[1, 2, 13, 12], [3, 4, 5, 6], [9, 10, 11, 8]];
  const P7420 = [[1, 2, 4, 5, 6], [9, 10, 12, 13, 8]];
  const chip14 = (f, pins, hyst) => LC({ pins: 14, vcc: 14, gnd: 7, gates: Q4(f, pins), hyst: hyst ? 0.1 : 0 });
  const MODELS = {
    '00': chip14('nand', P7400), '01': chip14('nand', P7400), '03': chip14('nand', P7400), '132': chip14('nand', P7400, true),
    '08': chip14('and', P7400), '09': chip14('and', P7400), '32': chip14('or', P7400), '86': chip14('xor', P7400), '7266': chip14('xnor', P7400),
    '02': chip14('nor', P7402), '04': chip14('not', P7404), '05': chip14('not', P7404), '06': chip14('not', P7404), '14': chip14('not', P7404, true),
    '07': chip14('buf', P7404), '10': chip14('nand', P7410), '11': chip14('and', P7410), '27': chip14('nor', P7410), '20': chip14('nand', P7420), '21': chip14('and', P7420),
    'cd4001': chip14('nor', P4001), 'cd4011': chip14('nand', P4001), 'cd4081': chip14('and', P4001), 'cd4071': chip14('or', P4001), 'cd4070': chip14('xor', P4001),
    'cd4077': chip14('xnor', P4001), 'cd4093': chip14('nand', P4001, true), 'cd4069': chip14('not', P7404), 'cd40106': chip14('not', P7404, true), 'cd4584': chip14('not', P7404, true),
    'cd4049': LC({ pins: 16, vcc: 1, gnd: 8, gates: Q4('not', [[3, 2], [5, 4], [7, 6], [9, 10], [11, 12], [14, 15]]) }),
    'cd4050': LC({ pins: 16, vcc: 1, gnd: 8, gates: Q4('buf', [[3, 2], [5, 4], [7, 6], [9, 10], [11, 12], [14, 15]]) }),
    'cd4023': chip14('nand', [[1, 2, 8, 9], [3, 4, 5, 6], [11, 12, 13, 10]]), 'cd4025': chip14('nor', [[1, 2, 8, 9], [3, 4, 5, 6], [11, 12, 13, 10]]),
    'cd4073': chip14('and', [[1, 2, 8, 9], [3, 4, 5, 6], [11, 12, 13, 10]]), 'cd4075': chip14('or', [[1, 2, 8, 9], [3, 4, 5, 6], [11, 12, 13, 10]]),
    '74': LC({
      pins: 14, vcc: 14, gnd: 7, seq: {
        outs: [5, 6, 9, 8], init: () => ({ q1: 0, q2: 0 }),
        step(p, st, pp) {
          const ff = (clr, d, clk, pre, k) => {
            if (!p(clr)) st[k] = 0; else if (!p(pre)) st[k] = 1; else if (p(clk) && !pp(clk)) st[k] = p(d);
          };
          ff(1, 2, 3, 4, 'q1'); ff(13, 12, 11, 10, 'q2');
          const b1 = !p(1) && !p(4), b2 = !p(13) && !p(10);
          return [b1 ? 1 : st.q1, b1 ? 1 : 1 - st.q1, b2 ? 1 : st.q2, b2 ? 1 : 1 - st.q2];
        }
      }
    }),
    'cd4013': LC({
      pins: 14, vcc: 14, gnd: 7, seq: {
        outs: [1, 2, 13, 12], init: () => ({ q1: 0, q2: 0 }),
        step(p, st, pp) {
          const ff = (clk, rst, d, set, k) => {
            if (p(rst) && !p(set)) st[k] = 0; else if (p(set) && !p(rst)) st[k] = 1;
            else if (!p(set) && !p(rst) && p(clk) && !pp(clk)) st[k] = p(d);
          };
          ff(3, 4, 5, 6, 'q1'); ff(11, 10, 9, 8, 'q2');
          return [st.q1, 1 - st.q1, st.q2, 1 - st.q2];
        }
      }
    }),
    'cd4017': LC({
      pins: 16, vcc: 16, gnd: 8, seq: {
        outs: [3, 2, 4, 7, 10, 1, 5, 6, 9, 11, 12], init: () => ({ n: 0 }),
        step(p, st, pp) {
          if (p(15)) st.n = 0;
          else {
            const rise = p(14) && !pp(14) && !p(13), fall13 = !p(13) && pp(13) && p(14);
            if (rise || fall13) st.n = (st.n + 1) % 10;
          }
          const o = []; for (let i = 0; i < 10; i++) o.push(st.n === i ? 1 : 0);
          o.push(st.n < 5 ? 1 : 0); return o;
        }
      }
    }),
    '595': LC({
      pins: 16, vcc: 16, gnd: 8, seq: {
        outs: [15, 1, 2, 3, 4, 5, 6, 7, 9], init: () => ({ sr: 0, lat: 0 }),
        step(p, st, pp) {
          if (!p(10)) st.sr = 0;
          else if (p(11) && !pp(11)) st.sr = ((st.sr << 1) | p(14)) & 255;
          if (p(12) && !pp(12)) st.lat = st.sr;
          const o = []; for (let i = 0; i < 8; i++) o.push((st.lat >> i) & 1);
          o.push((st.sr >> 7) & 1); return o;
        }
      }
    }),
    '138': LC({
      pins: 16, vcc: 16, gnd: 8, gates: null, seq: {
        outs: [15, 14, 13, 12, 11, 10, 9, 7], init: () => ({}),
        step(p) {
          const en = p(6) && !p(4) && !p(5), a = p(1) | (p(2) << 1) | (p(3) << 2), o = [];
          for (let i = 0; i < 8; i++) o.push(en && a === i ? 0 : 1); return o;
        }
      }
    }),
    '393': LC({
      pins: 14, vcc: 14, gnd: 7, seq: {
        outs: [3, 4, 5, 6, 11, 10, 9, 8], init: () => ({ a: 0, b: 0 }),
        step(p, st, pp) {
          if (p(2)) st.a = 0; else if (!p(1) && pp(1)) st.a = (st.a + 1) & 15;
          if (p(12)) st.b = 0; else if (!p(13) && pp(13)) st.b = (st.b + 1) & 15;
          const o = []; for (let i = 0; i < 4; i++) o.push((st.a >> i) & 1); for (let i = 0; i < 4; i++) o.push((st.b >> i) & 1); return o;
        }
      }
    }),
    'cd4040': LC({
      pins: 16, vcc: 16, gnd: 8, seq: {
        outs: [9, 7, 6, 5, 3, 2, 4, 13, 12, 14, 15, 1], init: () => ({ n: 0 }),
        step(p, st, pp) { if (p(11)) st.n = 0; else if (!p(10) && pp(10)) st.n = (st.n + 1) & 4095; const o = []; for (let i = 0; i < 12; i++) o.push((st.n >> i) & 1); return o; }
      }
    })
  };
  Object.entries(MODELS).forEach(([k, m]) => SP.defineBuiltin('logic_' + k, m));
  // 単体ゲート (電源 5V 内蔵)
  const GF = { AND: 'and', OR: 'or', NAND: 'nand', NOR: 'nor', XOR: 'xor', XNOR: 'xnor', NOT: 'not', BUF: 'buf' };
  Object.entries(GF).forEach(([k, f]) => {
    const one = f === 'not' || f === 'buf';
    SP.defineBuiltin('gate_' + f, LC({ pins: one ? 2 : 3, vcc: null, gnd: null, gates: [{ f, in: one ? [1] : [1, 2], out: one ? 2 : 3 }] }));
  });
  SP.defineBuiltin('gate_dff', LC({ pins: 4, vcc: null, gnd: null, seq: { outs: [3, 4], init: () => ({ q: 0 }), step(p, st, pp) { if (p(2) && !pp(2)) st.q = p(1); return [st.q, 1 - st.q]; } } }));
  // vcc/gnd を持たない単体ゲートのため Digital 側で既定値を使う
  ['gate_and', 'gate_or', 'gate_nand', 'gate_nor', 'gate_xor', 'gate_xnor', 'gate_not', 'gate_buf', 'gate_dff'].forEach(k => {
    const b = SP.BUILTINS[k], mk = b.make;
    b.make = (c, name, nodes, P) => mk(c, name, nodes, Object.assign({ vcc: 5 }, P));
  });

  /* TL431: K A REF */
  SP.defineBuiltin('tl431', {
    pins: 3,
    make(c, name, nodes) {
      const [k, a, ref] = nodes.map(n => c.node(n));
      const B = SP.BUILTINS;
      void B;
      const parts = [];
      const src = new (class {
        constructor() { this.name = name + '#i'; this.kind = 'B'; this.nonlinear = true; }
        load(st, ctx) {
          const x = ctx.x, V = i => (i >= 0 ? x[i] : 0);
          const vr = V(ref) - V(a), vka = V(k) - V(a);
          const u = (vr - 2.495) * 400, sp = u > 30 ? u : Math.log1p(Math.exp(u)), ds = 1 / (1 + Math.exp(-u));
          const gate = 1 / (1 + Math.exp(-(vka - 1.0) * 20)), dg = gate * (1 - gate) * 20;
          const I = 0.05 * sp * gate + 1e-9 * vka;
          const dIdvr = 0.05 * ds * 400 * gate, dIdvka = 0.05 * sp * dg + 1e-9;
          st.nl([k, a], [I, -I], [[ref, a], [k, a]], [[dIdvr, dIdvka], [-dIdvr, -dIdvka]], [vr, vka]);
        }
        current(x) { return 0; }
      })();
      parts.push(src);
      return { name, kind: 'X', nonlinear: true, parts, setup() { }, load(st, ctx) { src.load(st, ctx); }, current() { return 0; } };
    }
  });

})(typeof window !== 'undefined' ? window : globalThis);
