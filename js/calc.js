/* ---- calc.js ---- */
/* =====================================================================
   UniBoard SPICE — 電子工作 計算ツール
   ===================================================================== */
(function () {
  'use strict';
  const A = window.UniBoard.api, SP = window.Spice, el = A.el;
  const $ = id => document.getElementById(id);
  const P = v => SP.parseNum(String(v).replace(/,/g, ''));
  const F = (v, u, d) => isFinite(v) ? SP.fmt(v, u || '', d || 4) : '—';
  const E = {
    E6: [1.0, 1.5, 2.2, 3.3, 4.7, 6.8], E12: [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2],
    E24: [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1],
    E96: [1.00, 1.02, 1.05, 1.07, 1.10, 1.13, 1.15, 1.18, 1.21, 1.24, 1.27, 1.30, 1.33, 1.37, 1.40, 1.43, 1.47, 1.50, 1.54, 1.58, 1.62, 1.65, 1.69, 1.74, 1.78, 1.82, 1.87, 1.91, 1.96, 2.00, 2.05, 2.10, 2.15, 2.21, 2.26, 2.32, 2.37, 2.43, 2.49, 2.55, 2.61, 2.67, 2.74, 2.80, 2.87, 2.94, 3.01, 3.09, 3.16, 3.24, 3.32, 3.40, 3.48, 3.57, 3.65, 3.74, 3.83, 3.92, 4.02, 4.12, 4.22, 4.32, 4.42, 4.53, 4.64, 4.75, 4.87, 4.99, 5.11, 5.23, 5.36, 5.49, 5.62, 5.76, 5.90, 6.04, 6.19, 6.34, 6.49, 6.65, 6.81, 6.98, 7.15, 7.32, 7.50, 7.68, 7.87, 8.06, 8.25, 8.45, 8.66, 8.87, 9.09, 9.31, 9.53, 9.76]
  };
  function nearest(v, ser, mode) {   // mode: 'near' | 'up' | 'down'
    if (!(v > 0)) return NaN;
    const d = Math.floor(Math.log10(v)); let best = null;
    for (let k = d - 1; k <= d + 1; k++) for (const m of E[ser]) {
      const c = +(m * Math.pow(10, k)).toPrecision(3);
      if (mode === 'up' && c < v * 0.9999) continue; if (mode === 'down' && c > v * 1.0001) continue;
      if (best == null || Math.abs(Math.log(c / v)) < Math.abs(Math.log(best / v))) best = c;
    }
    return best;
  }
  const COL = [['黒', '#1b1b1b', '#fff'], ['茶', '#7b3f00', '#fff'], ['赤', '#d32f2f', '#fff'], ['橙', '#f57c00', '#000'], ['黄', '#fbc02d', '#000'], ['緑', '#2e7d32', '#fff'], ['青', '#1565c0', '#fff'], ['紫', '#6a1b9a', '#fff'], ['灰', '#8a8a8a', '#000'], ['白', '#f5f5f5', '#000'], ['金', '#c9a227', '#000'], ['銀', '#b8bcc2', '#000']];
  const MUL = { 0: 1, 1: 10, 2: 100, 3: 1e3, 4: 1e4, 5: 1e5, 6: 1e6, 7: 1e7, 8: 1e8, 9: 1e9, 10: 0.1, 11: 0.01 };
  const TOL = { 1: '±1%', 2: '±2%', 5: '±0.5%', 6: '±0.25%', 7: '±0.1%', 8: '±0.05%', 10: '±5%', 11: '±10%' };

  /* ---------- 小さなフォーム部品 ---------- */
  function form(body, fields, calc) {
    const vals = {}, ins = {};
    const g = el('div', 'calc-grid');
    fields.forEach(f => {
      const d = el('label', 'calc-f'); d.appendChild(el('span', null, f.l));
      let i;
      if (f.opts) { i = el('select'); f.opts.forEach(([v, t]) => { const o = el('option', null, t); o.value = v; i.appendChild(o); }); }
      else { i = el('input'); i.type = 'text'; i.spellcheck = false; i.inputMode = 'decimal'; }
      i.id = 'calc_' + f.k; i.value = f.v; vals[f.k] = f.v; ins[f.k] = i;
      i.addEventListener('input', () => { vals[f.k] = i.value; run(); }); i.addEventListener('change', () => { vals[f.k] = i.value; run(); });
      d.appendChild(i); if (f.u) d.appendChild(el('em', null, f.u)); g.appendChild(d);
    });
    body.appendChild(g);
    const out = el('div', 'calc-out'); body.appendChild(out);
    const run = () => { out.innerHTML = ''; try { calc(vals, (k, v, strong) => { const r = el('div', 'calc-r' + (strong ? ' big' : '')); r.appendChild(el('span', null, k)); r.appendChild(el('b', null, v)); out.appendChild(r); }, out, ins); } catch (e) { out.appendChild(el('p', 'note', e.message)); } };
    run(); return { vals, ins, run };
  }
  const note = (body, t) => body.appendChild(el('p', 'note', t));

  const TOOLS = [
    ['ohm', 'オームの法則', body => {
      note(body, '分かっている値を 2 つ入れてください (残りは空欄)。');
      form(body, [{ k: 'v', l: '電圧 V', v: '5', u: 'V' }, { k: 'i', l: '電流 I', v: '', u: 'A' }, { k: 'r', l: '抵抗 R', v: '220', u: 'Ω' }, { k: 'p', l: '電力 P', v: '', u: 'W' }], (v, out) => {
        let V = P(v.v), I = P(v.i), R = P(v.r), W = P(v.p);
        const k = [V, I, R, W].filter(isFinite).length;
        if (k < 2) { out('2 つ入力してください', ''); return; }
        if (isFinite(V) && isFinite(R)) { I = V / R; W = V * I; }
        else if (isFinite(V) && isFinite(I)) { R = V / I; W = V * I; }
        else if (isFinite(I) && isFinite(R)) { V = I * R; W = V * I; }
        else if (isFinite(W) && isFinite(R)) { I = Math.sqrt(W / R); V = I * R; }
        else if (isFinite(W) && isFinite(V)) { I = W / V; R = V / I; }
        else if (isFinite(W) && isFinite(I)) { V = W / I; R = V / I; }
        out('電圧', F(V, 'V'), 1); out('電流', F(I, 'A'), 1); out('抵抗', F(R, 'Ω'), 1); out('電力', F(W, 'W'), 1);
      });
    }],
    ['led', 'LED の電流制限抵抗', body => {
      form(body, [{ k: 'vs', l: '電源電圧', v: '5', u: 'V' }, { k: 'vf', l: 'LED の順方向電圧 Vf', v: '2.0', u: 'V' }, { k: 'if', l: '流したい電流', v: '10m', u: 'A' }, { k: 'n', l: '直列につなぐ個数', v: '1' },
        { k: 'ser', l: '抵抗の系列', v: 'E24', opts: [['E12', 'E12'], ['E24', 'E24'], ['E96', 'E96 (1%)']] }], (v, out) => {
        const vs = P(v.vs), vf = P(v.vf) * (P(v.n) || 1), I = P(v.if);
        if (vs <= vf) { out('電源電圧が足りません', vf.toFixed(2) + ' V 以上が必要'); return; }
        const R = (vs - vf) / I, Rs = nearest(R, v.ser, 'up'), Ia = (vs - vf) / Rs;
        out('計算値', F(R, 'Ω'), 1); out('使う抵抗 (切り上げ)', F(Rs, 'Ω', 3), 1); out('実際の電流', F(Ia, 'A')); out('抵抗の消費電力', F(Ia * Ia * Rs, 'W') + (Ia * Ia * Rs > 0.25 ? '  ⚠ 1/2W 以上を' : ''));
        out('LED 1 個の消費電力', F(Ia * P(v.vf), 'W'));
      });
      note(body, 'Vf の目安: 赤・橙・黄 1.8〜2.1V、緑 (InGaN)・青・白 2.9〜3.3V、赤外 1.2〜1.4V。');
    }],
    ['color', '抵抗のカラーコード', body => {
      const st = { bands: 4, b: [2, 2, 2, 10], b5: [1, 0, 0, 1, 1] };
      const wrap = el('div'); body.appendChild(wrap);
      const draw = () => {
        wrap.innerHTML = '';
        const seg = el('div', 'chips');
        [4, 5].forEach(n => { const b = el('button', 'chip' + (st.bands === n ? ' on' : ''), n + ' 本帯'); b.onclick = () => { st.bands = n; draw(); }; seg.appendChild(b); });
        wrap.appendChild(seg);
        const bands = st.bands === 4 ? st.b : st.b5;
        const labels = st.bands === 4 ? ['1 桁目', '2 桁目', '乗数', '許容差'] : ['1 桁目', '2 桁目', '3 桁目', '乗数', '許容差'];
        const vis = el('div', 'rcc');
        const bodyR = el('div', 'rcc-body');
        bands.forEach((c, i) => { const s = el('i'); s.style.background = COL[c][1]; if (i === bands.length - 1) s.style.marginLeft = 'auto'; bodyR.appendChild(s); });
        vis.appendChild(bodyR); wrap.appendChild(vis);
        const g = el('div', 'calc-grid');
        labels.forEach((l, i) => {
          const d = el('label', 'calc-f'); d.appendChild(el('span', null, l));
          const s = el('select'); s.id = 'rcc_' + i;
          const last = i === labels.length - 1, mul = i === labels.length - 2;
          COL.forEach((c, k) => {
            if (!last && !mul && k > 9) return; if (mul && !(k in MUL)) return; if (last && !(k in TOL)) return;
            const o = el('option', null, c[0] + (last ? ' ' + TOL[k] : mul ? ' ×' + SP.fmt(MUL[k], '', 3) : ' ' + k)); o.value = k; s.appendChild(o);
          });
          s.value = bands[i]; s.onchange = () => { bands[i] = +s.value; draw(); };
          d.appendChild(s); g.appendChild(d);
        });
        wrap.appendChild(g);
        const digits = st.bands === 4 ? bands[0] * 10 + bands[1] : bands[0] * 100 + bands[1] * 10 + bands[2];
        const R = digits * MUL[bands[bands.length - 2]];
        const r = el('div', 'calc-r big'); r.appendChild(el('span', null, '抵抗値')); r.appendChild(el('b', null, F(R, 'Ω', 4) + ' ' + (TOL[bands[bands.length - 1]] || ''))); wrap.appendChild(r);
        // 値 → 色
        const d2 = el('label', 'calc-f'); d2.appendChild(el('span', null, '値から色を調べる'));
        const inp = el('input'); inp.placeholder = '例: 4.7k'; inp.id = 'rcc_val'; d2.appendChild(inp);
        const res = el('div', 'rcc-out'); wrap.appendChild(d2); wrap.appendChild(res);
        inp.oninput = () => {
          const v = P(inp.value); res.innerHTML = ''; if (!(v > 0)) return;
          const e = Math.floor(Math.log10(v)) - 1, m = Math.round(v / Math.pow(10, e));
          const e3 = Math.floor(Math.log10(v)) - 2, m3 = Math.round(v / Math.pow(10, e3));
          const put = (arr, lab) => { const row = el('div', 'rcc-row'); row.appendChild(el('span', null, lab)); arr.forEach(k => { const c = COL[k]; const t = el('b', null, c[0]); t.style.background = c[1]; t.style.color = c[2]; row.appendChild(t); }); res.appendChild(row); };
          const mk = x => x >= 0 ? x : x === -1 ? 10 : 11;
          if (m >= 10 && m <= 99 && e >= -2 && e <= 9) put([Math.floor(m / 10), m % 10, mk(e), 10], '4 本帯');
          if (m3 >= 100 && m3 <= 999 && e3 >= -2 && e3 <= 9) put([Math.floor(m3 / 100), Math.floor(m3 / 10) % 10, m3 % 10, mk(e3), 1], '5 本帯');
        };
      };
      draw();
    }],
    ['div', '分圧回路', body => {
      form(body, [{ k: 'vin', l: '入力電圧', v: '12', u: 'V' }, { k: 'r1', l: 'R1 (上側)', v: '10k', u: 'Ω' }, { k: 'r2', l: 'R2 (下側)', v: '4.7k', u: 'Ω' }, { k: 'rl', l: '負荷抵抗 (任意)', v: '', u: 'Ω' }], (v, out) => {
        const vin = P(v.vin), r1 = P(v.r1), r2 = P(v.r2), rl = P(v.rl);
        const r2e = isFinite(rl) && rl > 0 ? r2 * rl / (r2 + rl) : r2;
        out('出力電圧', F(vin * r2e / (r1 + r2e), 'V'), 1); out('分圧比', (r2e / (r1 + r2e)).toFixed(4)); out('流れる電流', F(vin / (r1 + r2e), 'A')); out('出力インピーダンス', F(r1 * r2e / (r1 + r2e), 'Ω'));
      });
      body.appendChild(el('h5', 'sec', '欲しい電圧から E24 の組み合わせを探す'));
      form(body, [{ k: 'vin', l: '入力電圧', v: '12', u: 'V' }, { k: 'vo', l: '欲しい電圧', v: '3.3', u: 'V' }, { k: 'rt', l: '合計抵抗の目安', v: '20k', u: 'Ω' }], (v, out) => {
        const vin = P(v.vin), vo = P(v.vo), rt = P(v.rt) || 20e3; if (!(vo < vin)) { out('出力は入力より小さくしてください', ''); return; }
        const cand = [];
        for (let d = Math.floor(Math.log10(rt)) - 2; d <= Math.floor(Math.log10(rt)) + 1; d++) E.E24.forEach(m => {
          const r2 = +(m * Math.pow(10, d)).toPrecision(3), r1 = nearest(r2 * (vin - vo) / vo, 'E24', 'near');
          const out2 = vin * r2 / (r1 + r2); cand.push({ r1, r2, err: Math.abs(out2 - vo) / vo, tot: Math.abs(Math.log((r1 + r2) / rt)), out: out2 });
        });
        cand.sort((a, b) => a.err + a.tot * 0.02 - (b.err + b.tot * 0.02));
        cand.slice(0, 4).forEach((c, i) => out(`R1 = ${F(c.r1, 'Ω', 3)} / R2 = ${F(c.r2, 'Ω', 3)}`, F(c.out, 'V') + ' (' + (c.err * 100).toFixed(2) + '%)', i === 0));
      });
    }],
    ['555', '555 タイマー', body => {
      body.appendChild(el('h5', 'sec', '非安定 (発振)'));
      form(body, [{ k: 'r1', l: 'R1 (VCC–DIS)', v: '10k', u: 'Ω' }, { k: 'r2', l: 'R2 (DIS–THR)', v: '47k', u: 'Ω' }, { k: 'c', l: 'C (タイミング)', v: '10u', u: 'F' }], (v, out) => {
        const r1 = P(v.r1), r2 = P(v.r2), c = P(v.c);
        const th = 0.693 * (r1 + r2) * c, tl = 0.693 * r2 * c;
        out('周波数', F(1 / (th + tl), 'Hz'), 1); out('周期', F(th + tl, 's')); out('H の時間', F(th, 's')); out('L の時間', F(tl, 's')); out('デューティ比', (th / (th + tl) * 100).toFixed(1) + ' %');
      });
      body.appendChild(el('h5', 'sec', '単安定 (ワンショット)'));
      form(body, [{ k: 'r', l: 'R', v: '100k', u: 'Ω' }, { k: 'c', l: 'C', v: '10u', u: 'F' }], (v, out) => { out('パルス幅', F(1.1 * P(v.r) * P(v.c), 's'), 1); });
    }],
    ['filter', 'RC / LC フィルタ・共振', body => {
      body.appendChild(el('h5', 'sec', 'RC フィルタ'));
      form(body, [{ k: 'r', l: 'R', v: '1k', u: 'Ω' }, { k: 'c', l: 'C', v: '0.1u', u: 'F' }], (v, out) => {
        const r = P(v.r), c = P(v.c); out('遮断周波数 fc', F(1 / (2 * Math.PI * r * c), 'Hz'), 1); out('時定数 τ = RC', F(r * c, 's')); out('63% まで充電', F(r * c, 's')); out('99% まで充電 (5τ)', F(5 * r * c, 's'));
      });
      body.appendChild(el('h5', 'sec', 'LC 共振'));
      form(body, [{ k: 'l', l: 'L', v: '100u', u: 'H' }, { k: 'c', l: 'C', v: '100p', u: 'F' }], (v, out) => {
        const l = P(v.l), c = P(v.c); out('共振周波数', F(1 / (2 * Math.PI * Math.sqrt(l * c)), 'Hz'), 1); out('特性インピーダンス √(L/C)', F(Math.sqrt(l / c), 'Ω'));
      });
      body.appendChild(el('h5', 'sec', 'リアクタンス'));
      form(body, [{ k: 'f', l: '周波数', v: '1k', u: 'Hz' }, { k: 'c', l: 'C', v: '1u', u: 'F' }, { k: 'l', l: 'L', v: '10m', u: 'H' }], (v, out) => {
        const w = 2 * Math.PI * P(v.f); out('容量性 Xc = 1/ωC', F(1 / (w * P(v.c)), 'Ω'), 1); out('誘導性 XL = ωL', F(w * P(v.l), 'Ω'), 1);
      });
    }],
    ['reg', 'LM317 出力電圧', body => {
      form(body, [{ k: 'r1', l: 'R1 (OUT–ADJ)', v: '240', u: 'Ω' }, { k: 'r2', l: 'R2 (ADJ–GND)', v: '720', u: 'Ω' }], (v, out) => {
        const r1 = P(v.r1), r2 = P(v.r2); out('出力電圧', F(1.25 * (1 + r2 / r1) + 50e-6 * r2, 'V'), 1); out('最低入力電圧 (目安)', F(1.25 * (1 + r2 / r1) + 3, 'V'));
      });
      form(body, [{ k: 'vo', l: '欲しい電圧', v: '9', u: 'V' }, { k: 'r1', l: 'R1', v: '240', u: 'Ω' }], (v, out) => {
        const r2 = (P(v.vo) / 1.25 - 1) * P(v.r1); out('R2 の計算値', F(r2, 'Ω'), 1); out('E24 で近い値', F(nearest(r2, 'E24'), 'Ω', 3) + ' → ' + F(1.25 * (1 + nearest(r2, 'E24') / P(v.r1)), 'V'));
      });
      note(body, '三端子レギュレータの損失 = (入力電圧 − 出力電圧) × 電流。1W を超えるなら放熱器を付けてください。');
      form(body, [{ k: 'vi', l: '入力電圧', v: '12', u: 'V' }, { k: 'vo', l: '出力電圧', v: '5', u: 'V' }, { k: 'i', l: '負荷電流', v: '0.5', u: 'A' }], (v, out) => {
        const pd = (P(v.vi) - P(v.vo)) * P(v.i); out('発熱', F(pd, 'W') + (pd > 1 ? '  ⚠ 放熱器が必要' : ''), 1); out('TO-220 単体の温度上昇 (約 50℃/W)', (pd * 50).toFixed(0) + ' ℃');
      });
    }],
    ['opamp', 'オペアンプの増幅率', body => {
      form(body, [{ k: 'rf', l: 'Rf (帰還)', v: '100k', u: 'Ω' }, { k: 'rg', l: 'Rg / Rin', v: '10k', u: 'Ω' }, { k: 'gbw', l: 'GBW (任意)', v: '1meg', u: 'Hz' }], (v, out) => {
        const rf = P(v.rf), rg = P(v.rg), gbw = P(v.gbw);
        const gn = 1 + rf / rg, gi = rf / rg;
        out('非反転増幅 1 + Rf/Rg', gn.toFixed(3) + ' 倍 (' + (20 * Math.log10(gn)).toFixed(1) + ' dB)', 1);
        out('反転増幅 −Rf/Rin', '−' + gi.toFixed(3) + ' 倍 (' + (20 * Math.log10(gi)).toFixed(1) + ' dB)', 1);
        if (isFinite(gbw)) out('帯域 (非反転) ≈ GBW / G', F(gbw / gn, 'Hz'));
      });
    }],
    ['trace', '配線幅 (許容電流)', body => {
      form(body, [{ k: 'i', l: '電流', v: '1', u: 'A' }, { k: 'dt', l: '許容温度上昇', v: '10', u: '℃' }, { k: 'oz', l: '銅箔の厚さ', v: '1', opts: [['0.5', '0.5 oz (18µm)'], ['1', '1 oz (35µm)'], ['2', '2 oz (70µm)']] }], (v, out) => {
        const I = P(v.i), dT = P(v.dt), t = P(v.oz) * 1.378;   // mil
        const aExt = Math.pow(I / (0.048 * Math.pow(dT, 0.44)), 1 / 0.725), aInt = Math.pow(I / (0.024 * Math.pow(dT, 0.44)), 1 / 0.725);
        out('外層 (表・裏) の最小線幅', (aExt / t * 0.0254).toFixed(3) + ' mm', 1); out('内層の最小線幅', (aInt / t * 0.0254).toFixed(3) + ' mm');
      });
      note(body, 'IPC-2221 の近似式です。実際は余裕を持たせてください。');
    }],
    ['code', 'コンデンサ / チップ抵抗の表示', body => {
      form(body, [{ k: 'c', l: 'コンデンサの 3 桁表示', v: '104' }], (v, out) => {
        const m = String(v.c).trim().match(/^(\d)(\d)(\d)([jkmJKM])?$/);
        if (!m) { const x = P(v.c); if (isFinite(x)) { const pf = x * 1e12; const e = Math.floor(Math.log10(pf)) - 1; out('3 桁表示', '' + Math.round(pf / Math.pow(10, e)) + e, 1); } return; }
        const pf = (+m[1] * 10 + +m[2]) * Math.pow(10, +m[3]);
        out('容量', F(pf * 1e-12, 'F'), 1); out('pF 表記', pf + ' pF'); if (m[4]) out('許容差', { j: '±5%', k: '±10%', m: '±20%' }[m[4].toLowerCase()]);
      });
      const E96C = E.E96.map(v => Math.round(v * 100));
      form(body, [{ k: 's', l: 'チップ抵抗の表示 (103 / 4R7 / 01C)', v: '472' }], (v, out) => {
        const s = String(v.s).trim().toUpperCase(); let R = NaN;
        let m;
        if ((m = s.match(/^(\d+)R(\d*)$/))) R = parseFloat(m[1] + '.' + (m[2] || '0'));
        else if ((m = s.match(/^R(\d+)$/))) R = parseFloat('0.' + m[1]);
        else if ((m = s.match(/^(\d{2})([ZYXABCDEF])$/))) R = E96C[+m[1] - 1] * { Z: 0.001, Y: 0.01, R: 0.01, X: 0.1, S: 0.1, A: 1, B: 10, H: 10, C: 100, D: 1000, E: 1e4, F: 1e5 }[m[2]];
        else if ((m = s.match(/^(\d{2,3})(\d)$/))) R = +m[1] * Math.pow(10, +m[2]);
        out('抵抗値', F(R, 'Ω'), 1);
      });
    }],
    ['eser', 'E 系列の近い値', body => {
      form(body, [{ k: 'v', l: '値', v: '5.3k' }], (v, out) => {
        const x = P(v.v); ['E6', 'E12', 'E24', 'E96'].forEach(s => { const n = nearest(x, s); out(s, F(n, '', 3) + ' (' + ((n / x - 1) * 100).toFixed(1) + '%)', s === 'E24'); });
      });
      body.appendChild(el('h5', 'sec', '2 本の抵抗の合成'));
      form(body, [{ k: 'a', l: 'R1', v: '10k', u: 'Ω' }, { k: 'b', l: 'R2', v: '4.7k', u: 'Ω' }], (v, out) => { const a = P(v.a), b = P(v.b); out('直列', F(a + b, 'Ω'), 1); out('並列', F(a * b / (a + b), 'Ω'), 1); });
    }],
    ['db', 'デシベル', body => {
      form(body, [{ k: 'r', l: '比 (出力 / 入力)', v: '10' }], (v, out) => { const r = P(v.r); out('電圧比 → dB (20log)', (20 * Math.log10(r)).toFixed(3) + ' dB', 1); out('電力比 → dB (10log)', (10 * Math.log10(r)).toFixed(3) + ' dB', 1); });
      form(body, [{ k: 'd', l: 'dB', v: '-3' }], (v, out) => { const d = P(v.d); out('電圧比', Math.pow(10, d / 20).toFixed(5), 1); out('電力比', Math.pow(10, d / 10).toFixed(5), 1); });
      form(body, [{ k: 'dbm', l: 'dBm (50Ω)', v: '0' }], (v, out) => { const p = Math.pow(10, P(v.dbm) / 10) / 1000; out('電力', F(p, 'W'), 1); out('実効電圧 (50Ω)', F(Math.sqrt(p * 50), 'V')); out('dBu (600Ω 基準の電圧)', (20 * Math.log10(Math.sqrt(p * 50) / 0.7746)).toFixed(2) + ' dBu'); });
    }],
    ['bat', '電池の持ち時間', body => {
      form(body, [{ k: 'c', l: '電池の容量', v: '2000', u: 'mAh' }, { k: 'i', l: '平均消費電流', v: '20m', u: 'A' }, { k: 'e', l: '使える割合 (%)', v: '80' }], (v, out) => {
        const h = P(v.c) * 1e-3 * (P(v.e) / 100) / P(v.i);
        out('持ち時間', h < 48 ? h.toFixed(1) + ' 時間' : (h / 24).toFixed(1) + ' 日', 1);
      });
      form(body, [{ k: 'ia', l: '動作時の電流', v: '15m', u: 'A' }, { k: 'ta', l: '動作時間 (1 周期中)', v: '1', u: 's' }, { k: 'is', l: 'スリープ電流', v: '5u', u: 'A' }, { k: 'tp', l: '周期', v: '60', u: 's' }], (v, out) => {
        const avg = (P(v.ia) * P(v.ta) + P(v.is) * (P(v.tp) - P(v.ta))) / P(v.tp); out('平均電流', F(avg, 'A'), 1);
      });
    }],
    ['awg', '電線の太さ (AWG)', body => {
      const t = el('table', 'op-t'); const h = el('tr'); ['AWG', '直径', '断面積', '許容電流 (目安)', '抵抗 /m'].forEach(x => h.appendChild(el('th', null, x))); t.appendChild(h);
      for (let n = 10; n <= 30; n += 2) {
        const d = 0.127 * Math.pow(92, (36 - n) / 39), a = Math.PI * d * d / 4, r = 0.01724 / a;
        const tr = el('tr'); [String(n), d.toFixed(3) + ' mm', a.toFixed(3) + ' mm²', (a * 5).toFixed(2) + ' A', F(r, 'Ω', 3)].forEach((x, i) => tr.appendChild(el('td', i ? 'num' : null, x))); t.appendChild(tr);
      }
      body.appendChild(t);
      note(body, '許容電流は 5A/mm² の目安 (機器内配線)。ジャンパ線は 22〜24AWG、電源線は 18〜20AWG がよく使われます。');
    }]
  ];

  function open(which) {
    let cur = which || (function () { try { return localStorage.getItem('ubspice.calc') || 'led'; } catch (e) { return 'led'; } })();
    A.openModal('電子工作 計算ツール', body => {
      body.classList.add('calc');
      const nav = el('nav', 'calc-nav'), pane = el('div', 'calc-pane');
      body.appendChild(nav); body.appendChild(pane);
      const show = k => {
        cur = k; try { localStorage.setItem('ubspice.calc', k); } catch (e) { }
        nav.querySelectorAll('button').forEach(b => b.setAttribute('aria-current', String(b.dataset.k === k)));
        pane.innerHTML = ''; const t = TOOLS.find(x => x[0] === k) || TOOLS[0];
        pane.appendChild(el('h4', null, t[1])); t[2](pane);
      };
      TOOLS.forEach(([k, l]) => { const b = el('button', null, l); b.type = 'button'; b.dataset.k = k; b.onclick = () => show(k); nav.appendChild(b); });
      show(cur);
    });
    $('modal').querySelector('.sheet').classList.add('wide');
    const obs = new MutationObserver(() => { if ($('modal').hidden) { $('modal').querySelector('.sheet').classList.remove('wide'); obs.disconnect(); } });
    obs.observe($('modal'), { attributes: true, attributeFilter: ['hidden'] });
  }
  $('bCalc').onclick = () => open();
  window.UBCalc = { open, nearest };
})();
