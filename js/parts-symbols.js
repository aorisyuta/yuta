/* ---- parts-symbols.js ---- */
/* =====================================================================
   UniBoard SPICE — 追加の回路記号
   信号源 / 論理ゲート / サイリスタ / センサ / トランス / 7セグ / 追加パッケージ / モジュール
   ===================================================================== */
(function (global) {
  'use strict';
  const C1 = global.CADCore, SYM = C1.SYM;
  const L = (x1, y1, x2, y2) => ['L', x1, y1, x2, y2];
  const PL = pts => ['PL', pts];
  const PG = pts => ['PG', pts];
  const CI = (x, y, r) => ['C', x, y, r];
  const CF = (x, y, r) => ['CF', x, y, r];
  const AR = (x, y, r, a0, a1) => ['A', x, y, r, a0, a1];
  const RC = (x, y, w, h) => ['R', x, y, w, h];
  const TX = (x, y, t, s, al) => ['T', x, y, t, s || 9, al || 'center'];
  const P = Math.PI;
  function def(id, o) { if (SYM[id]) return SYM[id]; o.id = id; SYM[id] = o; return o; }
  const { fpAxial, fpRadial, fpInline, fpDip, fpGrid, fpTerm } = C1;

  /* ---------- シミュレーション用 信号源 (基板には載らない) ---------- */
  const srcBody = extra => [CI(0, 0, 16), L(0, -30, 0, -16), L(0, 16, 0, 30)].concat(extra);
  const twoPin = [{ n: 1, x: 0, y: -30, name: '+' }, { n: 2, x: 0, y: 30, name: '-' }];
  def('VDC', {
    name: '直流電圧源', cat: 'source', prefix: 'V', val: '5V', simOnly: true, pins: twoPin,
    g: srcBody([TX(0, -3, '+', 11), TX(0, 11, '−', 11)]), props: {}
  });
  const sinPts = []; for (let i = 0; i <= 20; i++) { const x = -9 + i * 0.9; sinPts.push(x, -6 * Math.sin(i / 20 * 2 * P)); }
  def('VSIN', {
    name: '正弦波電源', cat: 'source', prefix: 'V', val: 'SIN(0 1 1k)', simOnly: true, pins: twoPin,
    g: srcBody([PL(sinPts), TX(-11, -20, '+', 9)]), props: {}
  });
  def('VPULSE', {
    name: 'パルス電源', cat: 'source', prefix: 'V', val: 'PULSE(0 5 0 1u 1u 0.5m 1m)', simOnly: true, pins: twoPin,
    g: srcBody([PL([-10, 6, -5, 6, -5, -6, 3, -6, 3, 6, 10, 6]), TX(-11, -20, '+', 9)]), props: {}
  });
  def('VAC', {
    name: '商用交流 (AC100V)', cat: 'source', prefix: 'V', val: 'SIN(0 141 50)', simOnly: true, pins: twoPin,
    g: srcBody([PL(sinPts), TX(0, 12, 'AC', 7)]), props: {}
  });
  def('IDC', {
    name: '直流電流源', cat: 'source', prefix: 'I', val: '1m', simOnly: true, pins: twoPin,
    g: srcBody([L(0, 10, 0, -8), PG([0, -11, -4, -4, 4, -4])]), props: {}
  });

  /* ---------- 論理ゲート (シミュレーション用・電源 5V 内蔵) ---------- */
  function gateShape(kind) {
    const g = [], inv = /^(NAND|NOR|NOT|XNOR)$/.test(kind);
    const ox = inv ? 14 : 20;
    if (kind === 'NOT' || kind === 'BUF') {
      g.push(PL([-12, -12, -12, 12, 12, 0, -12, -12]), L(-30, 0, -12, 0));
    } else if (/AND/.test(kind)) {
      g.push(PL([2, -14, -14, -14, -14, 14, 2, 14]), AR(2, 0, 14, -P / 2, P / 2), L(-30, -10, -14, -10), L(-30, 10, -14, 10));
    } else {
      // OR 系: 左の凹曲線 + 上下の弧
      const L0 = []; for (let i = 0; i <= 12; i++) { const a = -P / 2 + P * i / 12; L0.push(-14 + 5 * Math.cos(a), 14 * Math.sin(a)); }
      const top = []; for (let i = 0; i <= 12; i++) { const t = i / 12; top.push(-14 + 30 * t, -14 + 14 * t * t); }
      const bot = []; for (let i = 0; i <= 12; i++) { const t = i / 12; bot.push(-14 + 30 * t, 14 - 14 * t * t); }
      g.push(PL(L0), PL(top), PL(bot), L(-30, -10, -10, -10), L(-30, 10, -10, 10));
      if (kind === 'XOR' || kind === 'XNOR') { const X = []; for (let i = 0; i <= 12; i++) { const a = -P / 2 + P * i / 12; X.push(-19 + 5 * Math.cos(a), 14 * Math.sin(a)); } g.push(PL(X)); }
    }
    const end = kind === 'NOT' || kind === 'BUF' ? 12 : 16;
    if (inv) g.push(CI(end + 3, 0, 3), L(end + 6, 0, 30, 0)); else g.push(L(end, 0, 30, 0));
    void ox; return g;
  }
  ['AND', 'OR', 'NAND', 'NOR', 'XOR', 'XNOR', 'NOT', 'BUF'].forEach(k => {
    const one = k === 'NOT' || k === 'BUF';
    def('G_' + k, {
      name: k + ' ゲート', cat: 'logic', prefix: 'G', val: k, simOnly: true,
      pins: one ? [{ n: 1, x: -30, y: 0, name: 'A' }, { n: 2, x: 30, y: 0, name: 'Y' }]
        : [{ n: 1, x: -30, y: -10, name: 'A' }, { n: 2, x: -30, y: 10, name: 'B' }, { n: 3, x: 30, y: 0, name: 'Y' }],
      g: gateShape(k), props: {}
    });
  });
  def('DFF', {
    name: 'D フリップフロップ', cat: 'logic', prefix: 'G', val: 'DFF', simOnly: true,
    pins: [{ n: 1, x: -40, y: -20, name: 'D' }, { n: 2, x: -40, y: 20, name: 'CLK' }, { n: 3, x: 40, y: -20, name: 'Q' }, { n: 4, x: 40, y: 20, name: '/Q' }],
    g: [RC(-24, -34, 48, 68), L(-40, -20, -24, -20), L(-40, 20, -24, 20), L(40, -20, 24, -20), L(40, 20, 24, 20),
        PL([-24, 14, -17, 20, -24, 26]), TX(-18, -16, 'D', 8, 'left'), TX(18, -16, 'Q', 8, 'right'), TX(18, 24, 'Q̄', 8, 'right')],
    props: {}
  });

  /* ---------- 半導体の追加 ---------- */
  const diodeBody = [L(-20, 0, -6, 0), PG([-6, -8, -6, 8, 6, 0]), L(6, 0, 20, 0)];
  def('SBD', {
    name: 'ショットキーダイオード', cat: 'semi', prefix: 'D', val: '1N5819',
    pins: [{ n: 1, x: -20, y: 0, name: 'A' }, { n: 2, x: 20, y: 0, name: 'K' }],
    g: diodeBody.concat([PL([10, -5, 10, -8, 6, -8, 6, 8, 2, 8, 2, 5])]),
    props: { span: 3 }, fp: c => fpAxial(c.props.span || 3, 0.45)
  });
  def('TVS', {
    name: 'TVS ダイオード', cat: 'semi', prefix: 'D', val: 'P6KE18A',
    pins: [{ n: 1, x: -20, y: 0, name: 'A' }, { n: 2, x: 20, y: 0, name: 'K' }],
    g: [L(-20, 0, -12, 0), PG([-12, -7, -12, 7, 0, 0]), PG([12, -7, 12, 7, 0, 0]), PL([-3, -10, 0, -7, 0, 7, 3, 10]), L(12, 0, 20, 0)],
    props: { span: 4 }, fp: c => fpAxial(c.props.span || 4, 0.5)
  });
  def('SCR', {
    name: 'サイリスタ (SCR)', cat: 'semi', prefix: 'Q', val: '2P4M',
    pins: [{ n: 2, x: -20, y: 0, name: 'A' }, { n: 1, x: 20, y: 0, name: 'K' }, { n: 3, x: 20, y: 20, name: 'G' }],
    g: diodeBody.concat([L(6, -8, 6, 8), L(6, 6, 20, 20)]),
    props: {}, fp: () => { const f = fpInline(3, 1, 0.55, 'to92'); f.pads[0].pin = 1; f.pads[1].pin = 3; f.pads[2].pin = 2; return f; }
  });
  def('TRIAC', {
    name: 'トライアック', cat: 'semi', prefix: 'Q', val: 'BCR1AM',
    pins: [{ n: 1, x: 0, y: -30, name: 'T1' }, { n: 2, x: 0, y: 30, name: 'T2' }, { n: 3, x: -20, y: 20, name: 'G' }],
    g: [L(0, -30, 0, -8), L(0, 8, 0, 30), L(-12, -8, 12, -8), L(-12, 8, 12, 8),
        PG([-12, -8, 0, -8, -6, 8]), PG([0, 8, 12, 8, 6, -8]), L(-6, 8, -20, 20)],
    props: {}, fp: () => fpInline(3, 1, 0.55, 'to92')
  });
  def('PHOTOTR', {
    name: 'フォトトランジスタ', cat: 'semi', prefix: 'Q', val: 'PT334',
    pins: [{ n: 1, x: 20, y: -20, name: 'C' }, { n: 2, x: 20, y: 20, name: 'E' }],
    g: [CI(2, 0, 18), L(-6, -10, -6, 10), PL([-6, -6, 12, -20, 20, -20]), PL([-6, 6, 12, 20, 20, 20]), PG([12, 20, 5.2, 16.6, 8.4, 13.4]),
        PL([-26, -18, -13, -7]), PG([-13, -7, -18, -9, -15, -12]), PL([-26, -8, -13, 3]), PG([-13, 3, -18, 1, -15, -2])],
    props: { light: 100 }, fp: () => fpRadial(1, 1.9)
  });
  def('PHOTOD', {
    name: 'フォトダイオード', cat: 'semi', prefix: 'D', val: 'S1223',
    pins: [{ n: 1, x: -20, y: 0, name: 'A' }, { n: 2, x: 20, y: 0, name: 'K' }],
    g: diodeBody.concat([L(6, -8, 6, 8), PL([-6, -22, 0, -12]), PG([0, -12, -5, -14, -2, -17]), PL([2, -22, 8, -12]), PG([8, -12, 3, -14, 6, -17])]),
    props: { light: 100 }, fp: () => fpRadial(1, 1.9)
  });
  def('TL431', {
    name: 'シャントレギュレータ', cat: 'semi', prefix: 'U', val: 'TL431',
    pins: [{ n: 1, x: 0, y: -30, name: 'K' }, { n: 2, x: 0, y: 30, name: 'A' }, { n: 3, x: -30, y: 0, name: 'REF' }],
    g: [L(0, -30, 0, -8), L(0, 8, 0, 30), PG([-8, 8, 8, 8, 0, -6]), PL([-11, -9, -8, -6, 8, -6, 11, -3]), L(-30, 0, -4, 0)],
    props: {}, fp: () => fpInline(3, 1, 0.55, 'to92')
  });
  def('LED7', {
    name: '7セグメントLED', cat: 'semi', prefix: 'DS', val: 'カソードコモン 赤',
    pins: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'].map((nm, i) => ({ n: [7, 6, 4, 2, 1, 9, 10, 5][i], x: -50, y: -70 + i * 20, name: nm }))
      .concat([{ n: 3, x: 50, y: -10, name: 'COM' }, { n: 8, x: 50, y: 10, name: 'COM' }]),
    g: (() => {
      const a = [RC(-34, -84, 68, 168)];
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'].forEach((nm, i) => { const y = -70 + i * 20; a.push(L(-50, y, -34, y), TX(-30, y + 3, nm, 7, 'left')); });
      a.push(L(50, -10, 34, -10), L(50, 10, 34, 10), TX(30, -7, 'COM', 6, 'right'));
      // 数字 8 の形
      a.push(PL([-4, -30, 16, -30]), PL([18, -28, 18, -4]), PL([18, 4, 18, 28]), PL([-4, 30, 16, 30]), PL([-6, 4, -6, 28]), PL([-6, -28, -6, -4]), PL([-4, 0, 16, 0]), CF(24, 30, 2));
      return a;
    })(),
    props: {}, fp: () => fpDip(10, 6), seg7: true
  });

  /* ---------- 受動部品の追加 ---------- */
  def('NTC', {
    name: 'サーミスタ (NTC)', cat: 'passive', prefix: 'TH', val: '10k',
    pins: [{ n: 1, x: -20, y: 0 }, { n: 2, x: 20, y: 0 }],
    g: [L(-20, 0, -12, 0), RC(-12, -5, 24, 10), L(12, 0, 20, 0), PL([-16, 12, -10, 12, 12, -12]), TX(-13, 21, '-t°', 7, 'left')],
    props: { span: 3, temp: 25, beta: 3435 }, fp: c => fpInline(2, c.props.span || 3, 0.8)
  });
  def('LDR', {
    name: 'CdS セル (光センサ)', cat: 'passive', prefix: 'CDS', val: '10k',
    pins: [{ n: 1, x: -20, y: 0 }, { n: 2, x: 20, y: 0 }],
    g: [L(-20, 0, -12, 0), RC(-12, -5, 24, 10), L(12, 0, 20, 0), CI(0, 0, 14),
        PL([-14, -24, -6, -14]), PG([-6, -14, -11, -15, -8, -19]), PL([-4, -26, 4, -16]), PG([4, -16, -1, -17, 2, -21])],
    props: { span: 2, light: 100 }, fp: c => fpRadial(c.props.span || 2, 2)
  });
  def('VARISTOR', {
    name: 'バリスタ', cat: 'passive', prefix: 'ZNR', val: '470V',
    pins: [{ n: 1, x: -20, y: 0 }, { n: 2, x: 20, y: 0 }],
    g: [L(-20, 0, -12, 0), RC(-12, -5, 24, 10), L(12, 0, 20, 0), PL([-16, 10, -10, 10, 12, -12])],
    props: { span: 3 }, fp: c => fpRadial(c.props.span || 3, 3)
  });
  def('CNP', {
    name: '無極性電解コンデンサ', cat: 'passive', prefix: 'C', val: '10u',
    pins: [{ n: 1, x: -20, y: 0 }, { n: 2, x: 20, y: 0 }],
    g: [L(-20, 0, -3, 0), AR(-15, 0, 12, -P * 0.25, P * 0.25), AR(15, 0, 12, P * 0.75, P * 1.25), L(3, 0, 20, 0), TX(-9, -12, 'NP', 7)],
    props: { span: 2 }, fp: c => fpRadial(c.props.span || 2, 2.4)
  });
  def('TRAFO', {
    name: 'トランス', cat: 'passive', prefix: 'T', val: '100V:12V',
    pins: [{ n: 1, x: -30, y: -20, name: 'P1' }, { n: 2, x: -30, y: 20, name: 'P2' }, { n: 3, x: 30, y: -20, name: 'S1' }, { n: 4, x: 30, y: 20, name: 'S2' }],
    g: (() => {
      const a = [L(-30, -20, -14, -20), L(-30, 20, -14, 20), L(30, -20, 14, -20), L(30, 20, 14, 20), L(-2, -22, -2, 22), L(2, -22, 2, 22)];
      for (let i = 0; i < 4; i++) { a.push(AR(-14, -15 + i * 10, 5, -P / 2, P / 2)); a.push(AR(14, -15 + i * 10, 5, P / 2, P * 1.5)); }
      a.push(CF(-10, -24, 1.6), CF(10, -24, 1.6));
      return a;
    })(),
    props: {}, fp: () => fpGrid([[0, 0], [0, 4], [6, 0], [6, 4]])
  });
  def('RNET', {
    name: '集合抵抗 (8素子)', cat: 'passive', prefix: 'RN', val: '10k',
    pins: (() => { const a = [{ n: 1, x: -80, y: 30, name: 'COM' }]; for (let i = 0; i < 8; i++) a.push({ n: i + 2, x: -60 + i * 20, y: 30 }); return a; })(),
    g: (() => {
      const a = [RC(-90, -26, 180, 40), L(-80, 30, -80, 14), L(-80, -14, 80, -14)];
      for (let i = 0; i < 8; i++) { const x = -60 + i * 20; a.push(RC(x - 3, -10, 6, 14), L(x, -14, x, -10), L(x, 4, x, 30)); }
      return a;
    })(),
    props: {}, fp: () => fpInline(9, 1, 0.6)
  });

  /* ---------- IC 箱型記号の生成 ---------- */
  // left/right: [[pinNo, name], ...] 上から順, top/bottom: [[pinNo,name],...]
  function boxSym(id, o) {
    const L1 = o.left || [], R1 = o.right || [], T1 = o.top || [], B1 = o.bottom || [];
    const rows = Math.max(L1.length, R1.length, 1);
    const w = Math.max(o.w || 80, (Math.max(T1.length, B1.length) + 1) * 20);
    const h = rows * 20 + 20;
    const x0 = -w / 2, y0 = -h / 2;
    const pins = [], g = [RC(x0, y0, w, h)];
    const ly = i => y0 + 20 + i * 20;
    const snap = v => Math.round(v / 10) * 10;
    L1.forEach(([n, nm], i) => { const y = snap(ly(i)), x = snap(x0 - 20); pins.push({ n, x, y, name: nm }); g.push(L(x, y, x0, y), TX(x0 + 4, y + 3, nm, 7, 'left')); });
    R1.forEach(([n, nm], i) => { const y = snap(ly(i)), x = snap(-x0 + 20); pins.push({ n, x, y, name: nm }); g.push(L(x, y, -x0, y), TX(-x0 - 4, y + 3, nm, 7, 'right')); });
    T1.forEach(([n, nm], i) => { const x = snap(x0 + 20 + i * 20), y = snap(y0 - 20); pins.push({ n, x, y, name: nm }); g.push(L(x, y, x, y0), TX(x, y0 + 10, nm, 6)); });
    B1.forEach(([n, nm], i) => { const x = snap(x0 + 20 + i * 20), y = snap(-y0 + 20); pins.push({ n, x, y, name: nm }); g.push(L(x, y, x, -y0), TX(x, -y0 - 4, nm, 6)); });
    if (o.label) g.push(TX(0, y0 - (T1.length ? 26 : 6), o.label, 8));
    return def(id, { name: o.name, cat: o.cat || 'ic', prefix: o.prefix || 'U', val: o.val || o.label || '', pins, g, props: o.props || {}, fp: o.fp, simOnly: o.simOnly });
  }

  /* DIP の追加 (4 / 6 / 24 / 32 / 40 ピン) — 既存と同じ描き方 */
  [4, 6, 10, 24, 32, 40].forEach(n => {
    if (SYM['DIP' + n]) return;
    const half = n >> 1, h = half * 20;
    const pins = [], g = [RC(-40, -h / 2, 80, h), AR(0, -h / 2, 8, 0, P)];
    for (let i = 0; i < half; i++) {
      const y = -h / 2 + 10 + i * 20;
      pins.push({ n: i + 1, x: -60, y }); pins.push({ n: n - i, x: 60, y });
      g.push(L(-60, y, -40, y), L(60, y, 40, y), TX(-34, y + 3, String(i + 1), 7, 'left'), TX(34, y + 3, String(n - i), 7, 'right'));
    }
    def('DIP' + n, { name: 'DIP-' + n + ' IC', cat: 'ic', prefix: 'U', val: 'IC', pins, g, props: { rowGap: n >= 24 ? 6 : 3 }, fp: c => fpDip(n, c.props.rowGap || (n >= 24 ? 6 : 3)) });
  });

  /* SIP (片側 1 列) の汎用 IC */
  [3, 5, 6, 7, 9, 10, 12].forEach(n => {
    const left = []; for (let i = 0; i < n; i++) left.push([i + 1, String(i + 1)]);
    boxSym('SIP' + n, { name: 'SIP-' + n + ' IC', label: 'IC', val: 'IC', left, w: 60, fp: () => fpInline(n, 1, 0.6) });
  });

  /* 専用の IC 記号 */
  boxSym('IC555', {
    name: 'タイマー IC 555', label: 'NE555', val: 'NE555',
    left: [[2, 'TRIG'], [6, 'THR'], [5, 'CV'], [4, 'RST']], right: [[3, 'OUT'], [7, 'DIS']], top: [[8, 'VCC']], bottom: [[1, 'GND']],
    fp: () => fpDip(8, 3)
  });
  boxSym('OPAMP4', {
    name: 'クワッドオペアンプ', label: 'LM324', val: 'LM324',
    left: [[3, '+A'], [2, '-A'], [5, '+B'], [6, '-B'], [10, '+C'], [9, '-C'], [12, '+D'], [13, '-D']],
    right: [[1, 'OUTA'], [7, 'OUTB'], [8, 'OUTC'], [14, 'OUTD']], top: [[4, 'V+']], bottom: [[11, 'V-']],
    fp: () => fpDip(14, 3)
  });
  boxSym('CMP2', {
    name: 'デュアルコンパレータ', label: 'LM393', val: 'LM393',
    left: [[3, '+A'], [2, '-A'], [5, '+B'], [6, '-B']], right: [[1, 'OUTA'], [7, 'OUTB']], top: [[8, 'V+']], bottom: [[4, 'GND']],
    fp: () => fpDip(8, 3)
  });
  boxSym('LM386', {
    name: 'オーディオアンプ LM386', label: 'LM386', val: 'LM386N-1',
    left: [[3, '+IN'], [2, '-IN'], [1, 'GAIN'], [8, 'GAIN']], right: [[5, 'OUT'], [7, 'BYP']], top: [[6, 'VS']], bottom: [[4, 'GND']],
    fp: () => fpDip(8, 3)
  });
  boxSym('L293D', {
    name: 'モータドライバ L293D', label: 'L293D', val: 'L293D',
    left: [[1, 'EN1,2'], [2, '1A'], [7, '2A'], [9, 'EN3,4'], [10, '3A'], [15, '4A']],
    right: [[3, '1Y'], [6, '2Y'], [11, '3Y'], [14, '4Y']], top: [[16, 'VCC1'], [8, 'VCC2']], bottom: [[4, 'GND'], [5, 'GND'], [12, 'GND'], [13, 'GND']],
    w: 100, fp: () => fpDip(16, 3)
  });
  boxSym('ULN2003', {
    name: 'トランジスタアレイ ULN2003', label: 'ULN2003A', val: 'ULN2003A',
    left: [[1, 'IN1'], [2, 'IN2'], [3, 'IN3'], [4, 'IN4'], [5, 'IN5'], [6, 'IN6'], [7, 'IN7']],
    right: [[16, 'OUT1'], [15, 'OUT2'], [14, 'OUT3'], [13, 'OUT4'], [12, 'OUT5'], [11, 'OUT6'], [10, 'OUT7']],
    top: [[9, 'COM']], bottom: [[8, 'GND']], fp: () => fpDip(16, 3)
  });
  boxSym('SENS3', {
    name: '3端子センサ (TO-92)', label: 'LM35', val: 'LM35DZ', cat: 'sensor',
    left: [[1, '+VS']], right: [[2, 'OUT']], bottom: [[3, 'GND']], w: 60,
    fp: () => fpInline(3, 1, 0.55, 'to92'), props: { temp: 25 }
  });
  boxSym('DS18B20', {
    name: '温度センサ DS18B20', label: 'DS18B20', val: 'DS18B20', cat: 'sensor',
    left: [[2, 'DQ']], top: [[3, 'VDD']], bottom: [[1, 'GND']], w: 60, fp: () => fpInline(3, 1, 0.55, 'to92')
  });
  boxSym('USB', {
    name: 'USB コネクタ', label: 'USB', val: 'USB-B', cat: 'conn', prefix: 'J',
    right: [[1, 'VBUS'], [2, 'D-'], [3, 'D+'], [4, 'GND']], w: 60, fp: () => fpGrid([[0, 0], [1, 0], [2, 0], [3, 0], [-1, 3], [4, 3]].slice(0, 4))
  });
  // ピン配置は実物と同じ並び (1 回路目が左列 A–COM–B、2 回路目が右列)
  boxSym('SW_DPDT', {
    name: 'スイッチ(DPDT)', label: 'DPDT', val: 'DPDT', cat: 'mech', prefix: 'SW',
    left: [[1, 'A1'], [2, 'COM1'], [3, 'B1']], right: [[4, 'A2'], [5, 'COM2'], [6, 'B2']], w: 80,
    fp: () => fpGrid([[0, 0], [1, 0], [2, 0], [0, 2], [1, 2], [2, 2]])
  });
  // 2 回路リレー: Omron G5V-2 などの標準ピン配置 (コイル端から 0 / 3 / 5 / 7 穴 = コイル / COM / NC / NO、列間 3 穴)
  boxSym('RLY2', {
    name: 'リレー (2回路)', label: '2c', val: '5V', cat: 'mech', prefix: 'K',
    left: [[3, 'NO1'], [2, 'NC1'], [4, 'COM1'], [1, 'C1']], right: [[6, 'NO2'], [7, 'NC2'], [5, 'COM2'], [8, 'C2']], w: 80,
    fp: () => ({
      pads: [[0, 0, 1], [0, 3, 4], [0, 5, 2], [0, 7, 3], [3, 0, 8], [3, 3, 5], [3, 5, 7], [3, 7, 6]].map(([c, r, pin]) => ({ c, r, pin })),
      body: { x: -0.5, y: -0.5, w: 4, h: 8, shape: 'rect' }, kind: 'grid'
    })
  });
  [2, 4, 6, 8].forEach(n => {
    const left = [], right = [];
    for (let i = 0; i < n; i++) { left.push([i + 1, String(i + 1)]); right.push([2 * n - i, String(i + 1)]); }
    boxSym('DIPSW' + n, { name: 'DIP スイッチ ' + n + 'P', label: 'DIPSW', val: n + 'P', cat: 'mech', prefix: 'SW', left, right, w: 60, fp: () => fpDip(2 * n, 3) });
  });

  /* ---------- コネクタの追加 ---------- */
  for (let n = 1; n <= 40; n++) {
    if (SYM['J' + n]) continue;
    def('J' + n, {
      name: 'ピンヘッダ ' + n + 'P', cat: 'conn', prefix: 'J', val: n + 'P',
      pins: (() => { const a = []; for (let i = 0; i < n; i++) a.push({ n: i + 1, x: -30, y: -(n - 1) * 10 + i * 20 }); return a; })(),
      g: (() => {
        const a = [RC(-14, -(n - 1) * 10 - 10, 24, n * 20)];
        for (let i = 0; i < n; i++) { const y = -(n - 1) * 10 + i * 20; a.push(L(-30, y, -14, y), CF(-4, y, 3), TX(6, y + 3, String(i + 1), 7, 'right')); }
        return a;
      })(),
      props: {}, fp: () => fpInline(n, 1, 0.55, 'header')
    });
  }
  for (let n = 2; n <= 20; n++) {
    const id = 'JD' + n;
    const pins = [], g = [RC(-16, -n * 10, 32, n * 20)];
    for (let i = 0; i < n; i++) {
      const y = -(n - 1) * 10 + i * 20;
      pins.push({ n: 2 * i + 1, x: -30, y }, { n: 2 * i + 2, x: 30, y });
      g.push(L(-30, y, -16, y), L(30, y, 16, y), CF(-7, y, 2.6), CF(7, y, 2.6));
    }
    g.push(TX(-10, -n * 10 - 4, '1', 7));
    def(id, {
      name: 'ピンヘッダ 2×' + n, cat: 'conn', prefix: 'J', val: '2x' + n, pins, g, props: {},
      fp: () => { const c = []; for (let i = 0; i < n; i++) c.push([i, 1], [i, 0]); const f = fpGrid(c); f.body.shape = 'header'; return f; }
    });
  }
  [4, 5, 6, 8].forEach(n => {
    def('TB' + n, {
      name: 'ターミナル ' + n + 'P', cat: 'conn', prefix: 'TB', val: n + 'P',
      pins: (() => { const a = []; for (let i = 0; i < n; i++) a.push({ n: i + 1, x: -30, y: -(n - 1) * 10 + i * 20 }); return a; })(),
      g: (() => { const a = [RC(-14, -(n - 1) * 10 - 12, 28, n * 20 + 4)]; for (let i = 0; i < n; i++) { const y = -(n - 1) * 10 + i * 20; a.push(L(-30, y, -14, y), CI(2, y, 5)); } return a; })(),
      props: {}, fp: () => fpTerm(n)
    });
  });

  /* ---------- モジュール (ピン名付きヘッダ) ---------- */
  const MODS = {};
  function module(id, name, pinNames, opt) {
    opt = opt || {};
    const n = pinNames.length, two = !!opt.twoRow;
    let left, right;
    if (two) { const h = n / 2; left = pinNames.slice(0, h).map((nm, i) => [i + 1, nm]); right = pinNames.slice(h).map((nm, i) => [h + i + 1, nm]).reverse(); }
    else { left = pinNames.map((nm, i) => [i + 1, nm]); right = []; }
    const rowGap = opt.rowGap || 6;
    const s = boxSym(id, {
      name, label: opt.label || name, val: opt.val || opt.label || name, cat: 'module', prefix: opt.prefix || 'M', left, right, w: opt.w || 80,
      fp: two ? () => fpDip(n, rowGap) : () => fpInline(n, 1, 0.55, 'header')
    });
    MODS[id] = s; return s;
  }
  module('MOD_NANO', 'Arduino Nano', ['D1/TX', 'D0/RX', 'RST', 'GND', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12',
    'D13', '3V3', 'AREF', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', '5V', 'RST', 'GND', 'VIN'], { twoRow: true, rowGap: 6, label: 'Arduino Nano', w: 100 });
  module('MOD_PICO', 'Raspberry Pi Pico', ['GP0', 'GP1', 'GND', 'GP2', 'GP3', 'GP4', 'GP5', 'GND', 'GP6', 'GP7', 'GP8', 'GP9', 'GND', 'GP10', 'GP11', 'GP12', 'GP13', 'GND', 'GP14', 'GP15',
    'GP16', 'GP17', 'GND', 'GP18', 'GP19', 'GP20', 'GP21', 'GND', 'GP22', 'RUN', 'GP26', 'GP27', 'GND', 'GP28', 'VREF', '3V3', '3V3EN', 'GND', 'VSYS', 'VBUS'], { twoRow: true, rowGap: 7, label: 'Pi Pico', w: 100 });
  module('MOD_ESP32', 'ESP32 DevKitC', ['3V3', 'EN', 'VP', 'VN', 'IO34', 'IO35', 'IO32', 'IO33', 'IO25', 'IO26', 'IO27', 'IO14', 'IO12', 'GND', 'IO13', 'SD2', 'SD3', 'CMD', '5V',
    'CLK', 'SD0', 'SD1', 'IO15', 'IO2', 'IO0', 'IO4', 'IO16', 'IO17', 'IO5', 'IO18', 'IO19', 'GND', 'IO21', 'RXD', 'TXD', 'IO22', 'IO23', 'GND'], { twoRow: true, rowGap: 10, label: 'ESP32', w: 100 });
  module('MOD_D1MINI', 'Wemos D1 mini (ESP8266)', ['RST', 'A0', 'D0', 'D5', 'D6', 'D7', 'D8', '3V3', '5V', 'GND', 'D4', 'D3', 'D2', 'D1', 'RX', 'TX'], { twoRow: true, rowGap: 9, label: 'D1 mini' });
  module('MOD_OLED', 'OLED 0.96" I2C', ['GND', 'VCC', 'SCL', 'SDA'], { label: 'OLED I2C' });
  module('MOD_LCD1602', 'キャラクタ LCD 16×2', ['VSS', 'VDD', 'V0', 'RS', 'RW', 'E', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'A', 'K'], { label: 'LCD1602' });
  module('MOD_HCSR04', '超音波距離センサ HC-SR04', ['VCC', 'TRIG', 'ECHO', 'GND'], { label: 'HC-SR04' });
  module('MOD_DHT11', '温湿度センサ DHT11', ['VCC', 'DATA', 'NC', 'GND'], { label: 'DHT11' });
  module('MOD_BME280', '気圧温湿度 BME280', ['VIN', 'GND', 'SCL', 'SDA'], { label: 'BME280' });
  module('MOD_MPU6050', '6軸センサ MPU-6050', ['VCC', 'GND', 'SCL', 'SDA', 'XDA', 'XCL', 'AD0', 'INT'], { label: 'MPU-6050' });
  module('MOD_HC05', 'Bluetooth HC-05', ['EN', 'VCC', 'GND', 'TXD', 'RXD', 'STATE'], { label: 'HC-05' });
  module('MOD_DFPLAYER', 'MP3 DFPlayer Mini', ['VCC', 'RX', 'TX', 'DAC_R', 'DAC_L', 'SPK1', 'GND', 'SPK2', 'IO1', 'GND', 'IO2', 'ADK1', 'ADK2', 'USB+', 'USB-', 'BUSY'], { twoRow: true, rowGap: 7, label: 'DFPlayer' });
  module('MOD_TB6612', 'モータドライバ TB6612', ['PWMA', 'AIN2', 'AIN1', 'STBY', 'BIN1', 'BIN2', 'PWMB', 'GND', 'VM', 'VCC', 'GND', 'AO1', 'AO2', 'BO2', 'BO1', 'GND'], { twoRow: true, rowGap: 6, label: 'TB6612' });
  module('MOD_A4988', 'ステッピングドライバ A4988', ['EN', 'MS1', 'MS2', 'MS3', 'RST', 'SLP', 'STEP', 'DIR', 'VMOT', 'GND', '2B', '2A', '1A', '1B', 'VDD', 'GND'], { twoRow: true, rowGap: 5, label: 'A4988' });
  module('MOD_ADS1115', 'ADC ADS1115', ['VDD', 'GND', 'SCL', 'SDA', 'ADDR', 'ALRT', 'A0', 'A1', 'A2', 'A3'], { label: 'ADS1115' });
  module('MOD_MCP4725', 'DAC MCP4725', ['GND', 'VCC', 'SDA', 'SCL', 'A0', 'OUT'], { label: 'MCP4725' });
  module('MOD_PAM8403', 'D級アンプ PAM8403', ['L', 'GND', 'R', '5V', 'GND', 'L+', 'L-', 'R-', 'R+'], { label: 'PAM8403' });
  module('MOD_DCDC', '降圧 DC-DC (LM2596)', ['IN+', 'IN-', 'OUT+', 'OUT-'], { label: 'LM2596' });
  module('MOD_BOOST', '昇圧 DC-DC (MT3608)', ['VIN+', 'VIN-', 'VOUT+', 'VOUT-'], { label: 'MT3608' });
  module('MOD_TP4056', 'Li-ion 充電 TP4056', ['IN+', 'IN-', 'B+', 'B-', 'OUT+', 'OUT-'], { label: 'TP4056' });
  module('MOD_RTC', 'RTC DS3231', ['32K', 'SQW', 'SCL', 'SDA', 'VCC', 'GND'], { label: 'DS3231' });
  module('MOD_SD', 'microSD カード', ['CS', 'SCK', 'MOSI', 'MISO', 'VCC', 'GND'], { label: 'microSD' });
  module('MOD_RELAY', 'リレーモジュール', ['VCC', 'GND', 'IN', 'COM', 'NO', 'NC'], { label: 'Relay' });
  module('MOD_SERVO', 'サーボモータ', ['GND', 'VCC', 'SIG'], { label: 'SERVO' });
  module('MOD_WS2812', 'フルカラー LED WS2812B', ['VDD', 'DOUT', 'GND', 'DIN'], { label: 'WS2812B' });
  module('MOD_PIR', '人感センサ HC-SR501', ['VCC', 'OUT', 'GND'], { label: 'HC-SR501' });
  module('MOD_IR', '赤外線受信 OSRB38C9AA', ['OUT', 'GND', 'VCC'], { label: 'IR RX' });
  module('MOD_JOY', 'ジョイスティック', ['GND', '+5V', 'VRx', 'VRy', 'SW'], { label: 'JOYSTICK' });
  module('MOD_ENC', 'ロータリーエンコーダ', ['A', 'COM', 'B', 'SW1', 'SW2'], { label: 'ENCODER' });

  global.CADExtra = { boxSym, module, MODS, gateShape };
})(typeof window !== 'undefined' ? window : globalThis);
