/* =====================================================================
   UniBoard CAD — core part 1
   記号ライブラリ / フットプリント / ネットリスト抽出
   ===================================================================== */
(function (global) {
  'use strict';

  const GS = 10;                 // 回路図グリッド(世界座標)
  const PITCH = 2.54;            // mm / ユニバーサル基板ピッチ

  /* ---------------- 幾何 ---------------- */
  function rotXY(x, y, r) {
    switch (((r % 360) + 360) % 360) {
      case 90:  return [-y, x];
      case 180: return [-x, -y];
      case 270: return [y, -x];
      default:  return [x, y];
    }
  }

  /* ---------------- 描画プリミティブ ヘルパ ---------------- */
  const L  = (x1, y1, x2, y2) => ['L', x1, y1, x2, y2];
  const PL = (pts)            => ['PL', pts];
  const PG = (pts)            => ['PG', pts];
  const CI = (x, y, r)        => ['C', x, y, r];
  const CF = (x, y, r)        => ['CF', x, y, r];
  const AR = (x, y, r, a0, a1)=> ['A', x, y, r, a0, a1];
  const RC = (x, y, w, h)     => ['R', x, y, w, h];
  const TX = (x, y, t, s, al) => ['T', x, y, t, s || 9, al || 'center'];

  const P = Math.PI;

  /* ---------------- フットプリント生成 ---------------- */
  // pads: [{c,r,pin}]  body:{x,y,w,h,shape}  (単位=穴)
  function fpAxial(span, bw) {
    span = Math.max(1, span | 0);
    return {
      pads: [{ c: 0, r: 0, pin: 1 }, { c: span, r: 0, pin: 2 }],
      body: { x: 0.62, y: -(bw || 0.42), w: span - 1.24, h: (bw || 0.42) * 2, shape: 'rect' },
      kind: 'axial'
    };
  }
  function fpRadial(span, d) {
    return {
      pads: [{ c: 0, r: 0, pin: 1 }, { c: span, r: 0, pin: 2 }],
      body: { x: span / 2 - d / 2, y: -d / 2, w: d, h: d, shape: 'circle' },
      kind: 'radial'
    };
  }
  function fpInline(n, step, bh, label) {
    step = step || 1;
    const pads = [];
    for (let i = 0; i < n; i++) pads.push({ c: i * step, r: 0, pin: i + 1 });
    return {
      pads,
      body: { x: -0.45, y: -(bh || 0.5), w: (n - 1) * step + 0.9, h: (bh || 0.5) * 2, shape: label || 'rect' },
      kind: 'inline'
    };
  }
  /* ねじ端子台 (5.08mm ピッチ = 2 穴おき) */
  function fpTerm(n) {
    const pads = [];
    for (let i = 0; i < n; i++) pads.push({ c: i * 2, r: 0, pin: i + 1 });
    return { pads, body: { x: -1.2, y: -1.6, w: (n - 1) * 2 + 2.4, h: 3.2, shape: 'term' }, kind: 'inline' };
  }
  function fpDip(n, rowGap) {
    const half = n >> 1, g = rowGap || 3, pads = [];
    // 部品面（上）から見たDIP: 切り欠きを左に置くと 1番ピンは左下、下の列を左→右に 1…n/2、
    // 上の列を右→左に n/2+1…n（反時計回り）。※以前は上下が逆で、裏から見た鏡像になっていた
    for (let i = 0; i < half; i++) pads.push({ c: i, r: g, pin: i + 1 });
    for (let i = 0; i < half; i++) pads.push({ c: half - 1 - i, r: 0, pin: half + 1 + i });
    return {
      pads,
      body: { x: -0.5, y: -0.5, w: half, h: g + 1, shape: 'dip' },
      kind: 'dip'
    };
  }
  function fpGrid(coords) { // coords:[[c,r],...]
    const pads = coords.map((p, i) => ({ c: p[0], r: p[1], pin: i + 1 }));
    const cs = coords.map(p => p[0]), rs = coords.map(p => p[1]);
    return {
      pads,
      body: {
        x: Math.min(...cs) - 0.45, y: Math.min(...rs) - 0.45,
        w: Math.max(...cs) - Math.min(...cs) + 0.9,
        h: Math.max(...rs) - Math.min(...rs) + 0.9, shape: 'rect'
      },
      kind: 'grid'
    };
  }

  /* ---------------- 記号ライブラリ ---------------- */
  const SYM = {};
  function def(id, o) { o.id = id; SYM[id] = o; return o; }

  /* --- 受動部品 --- */
  def('R', {
    name: '抵抗', cat: 'passive', prefix: 'R', val: '10k',
    pins: [{ n: 1, x: -20, y: 0 }, { n: 2, x: 20, y: 0 }],
    g: [L(-20, 0, -12, 0), RC(-12, -5, 24, 10), L(12, 0, 20, 0)],
    props: { span: 4 }, fp: c => fpAxial(c.props.span || 4, 0.45)
  });
  def('POT', {
    name: '可変抵抗', cat: 'passive', prefix: 'VR', val: '10k',
    pins: [{ n: 1, x: -20, y: 0 }, { n: 3, x: 20, y: 0 }, { n: 2, x: 0, y: -20 }],
    g: [L(-20, 0, -12, 0), RC(-12, -5, 24, 10), L(12, 0, 20, 0),
        L(0, -20, 0, -11), PG([-3.5, -11, 3.5, -11, 0, -5])],
    props: { span: 2 }, fp: c => fpInline(3, c.props.span || 2, 1.4)
  });
  def('C', {
    name: 'コンデンサ', cat: 'passive', prefix: 'C', val: '0.1u',
    pins: [{ n: 1, x: -20, y: 0 }, { n: 2, x: 20, y: 0 }],
    g: [L(-20, 0, -3, 0), L(-3, -9, -3, 9), L(3, -9, 3, 9), L(3, 0, 20, 0)],
    props: { span: 2 }, fp: c => fpAxial(c.props.span || 2, 0.5)
  });
  def('CP', {
    name: '電解コンデンサ', cat: 'passive', prefix: 'C', val: '10u',
    pins: [{ n: 1, x: -20, y: 0 }, { n: 2, x: 20, y: 0 }],
    g: [L(-20, 0, -3, 0), L(-3, -9, -3, 9), AR(14, 0, 12, P * 0.75, P * 1.25),
        L(3, 0, 20, 0), TX(-9, -12, '+', 10)],
    props: { span: 2 }, fp: c => fpRadial(c.props.span || 2, c.props.dia || 2.4)   // dia: 外径(穴ピッチ単位, 2.54mm=1)
  });
  def('L', {
    name: 'インダクタ', cat: 'passive', prefix: 'L', val: '100u',
    pins: [{ n: 1, x: -20, y: 0 }, { n: 2, x: 20, y: 0 }],
    g: [L(-20, 0, -14, 0), AR(-10.5, 0, 3.5, P, 2 * P), AR(-3.5, 0, 3.5, P, 2 * P),
        AR(3.5, 0, 3.5, P, 2 * P), AR(10.5, 0, 3.5, P, 2 * P), L(14, 0, 20, 0)],
    props: { span: 4 }, fp: c => fpAxial(c.props.span || 4, 0.5)
  });
  def('X', {
    name: '水晶振動子', cat: 'passive', prefix: 'X', val: '16MHz',
    pins: [{ n: 1, x: -20, y: 0 }, { n: 2, x: 20, y: 0 }],
    g: [L(-20, 0, -8, 0), L(-8, -9, -8, 9), RC(-4, -10, 8, 20), L(8, -9, 8, 9), L(8, 0, 20, 0)],
    props: { span: 2 }, fp: c => fpInline(2, c.props.span || 2, 1.1)
  });
  def('F', {
    name: 'ヒューズ', cat: 'passive', prefix: 'F', val: '1A',
    pins: [{ n: 1, x: -20, y: 0 }, { n: 2, x: 20, y: 0 }],
    g: [L(-20, 0, -12, 0), RC(-12, -5, 24, 10), L(-12, 0, 12, 0), L(12, 0, 20, 0)],
    props: { span: 4 }, fp: c => fpAxial(c.props.span || 4, 0.5)
  });

  /* --- 半導体 --- */
  const diodeBody = [L(-20, 0, -6, 0), PG([-6, -8, -6, 8, 6, 0]), L(6, -8, 6, 8), L(6, 0, 20, 0)];
  def('D', {
    name: 'ダイオード', cat: 'semi', prefix: 'D', val: '1N4148',
    pins: [{ n: 1, x: -20, y: 0, name: 'A' }, { n: 2, x: 20, y: 0, name: 'K' }],
    g: diodeBody, props: { span: 3 }, fp: c => fpAxial(c.props.span || 3, 0.45)
  });
  def('ZD', {
    name: 'ツェナー', cat: 'semi', prefix: 'D', val: '5.1V',
    pins: [{ n: 1, x: -20, y: 0, name: 'A' }, { n: 2, x: 20, y: 0, name: 'K' }],
    g: [L(-20, 0, -6, 0), PG([-6, -8, -6, 8, 6, 0]), PL([2, -12, 6, -8, 6, 8, 10, 12]), L(6, 0, 20, 0)],
    props: { span: 3 }, fp: c => fpAxial(c.props.span || 3, 0.45)
  });
  def('LED', {
    name: 'LED', cat: 'semi', prefix: 'D', val: 'LED',
    pins: [{ n: 1, x: -20, y: 0, name: 'A' }, { n: 2, x: 20, y: 0, name: 'K' }],
    g: diodeBody.concat([
      PL([1, -11, 8, -18]), PG([8, -18, 3.4, -15.6, 5.6, -13.4]),
      PL([7, -11, 14, -18]), PG([14, -18, 9.4, -15.6, 11.6, -13.4])]),
    props: { span: 1 }, fp: c => fpRadial(c.props.span || 1, 1.9)
  });
  def('BR', {
    name: 'ブリッジ整流', cat: 'semi', prefix: 'BR', val: 'W04',
    pins: [{ n: 1, x: -30, y: 0, name: '~' }, { n: 2, x: 0, y: -30, name: '+' },
           { n: 3, x: 30, y: 0, name: '~' }, { n: 4, x: 0, y: 30, name: '-' }],
    g: [PL([-22, 0, 0, -22, 22, 0, 0, 22, -22, 0]), L(-30, 0, -22, 0), L(0, -30, 0, -22),
        L(30, 0, 22, 0), L(0, 30, 0, 22), PG([-8, 0, 4, -6, 4, 6]), L(6, -7, 6, 7),
        TX(0, 4, '~', 9)],
    props: {}, fp: () => fpInline(4, 1, 1.2)
  });
  function bjt(id, name, pnp) {
    const ar = pnp ? PG([-2.4, 2.6, 4.6, 6.4, 1.4, 9.6]) : PG([12, 20, 5.2, 16.6, 8.4, 13.4]);
    def(id, {
      name, cat: 'semi', prefix: 'Q', val: pnp ? '2SA1015' : '2SC1815',
      pins: [{ n: 1, x: -20, y: 0, name: 'B' }, { n: 2, x: 20, y: -20, name: 'C' }, { n: 3, x: 20, y: 20, name: 'E' }],
      pkgOpts: ['TO-92', 'TO-126', 'TO-220'],
      g: [CI(2, 0, 18), L(-20, 0, -6, 0), L(-6, -10, -6, 10),
          PL([-6, -6, 12, -20, 20, -20]), PL([-6, 6, 12, 20, 20, 20]), ar],
      pinoutOpts: ['BCE', 'ECB', 'EBC', 'CBE', 'BEC', 'CEB'],
      props: { pkg: 'TO-92' },
      fp: c => {
        const f = c.props.pkg === 'TO-220' ? fpInline(3, 1, 0.6, 'to220')
             : c.props.pkg === 'TO-126' ? fpInline(3, 1, 0.6, 'to220') : fpInline(3, 1, 0.55, 'to92');
        const o = String((c.props && c.props.pinout) || 'BCE').toUpperCase(), map = { B: 1, C: 2, E: 3 };
        if (/^[BCE]{3}$/.test(o) && new Set(o).size === 3) f.pads.forEach((q, i) => { q.pin = map[o[i]]; });
        return f;
      }
    });
  }
  bjt('NPN', 'NPNトランジスタ', false);
  bjt('PNP', 'PNPトランジスタ', true);
  function fet(id, name, p) {
    def(id, {
      name, cat: 'semi', prefix: 'Q', val: p ? '2SJ' : '2SK2232',
      pins: [{ n: 1, x: -20, y: 0, name: 'G' }, { n: 2, x: 20, y: -20, name: 'D' }, { n: 3, x: 20, y: 20, name: 'S' }],
      pkgOpts: ['TO-220', 'TO-92'],
      g: [CI(2, 0, 18), L(-20, 0, -10, 0), L(-10, -10, -10, 10),
          L(-4, -11, -4, -4), L(-4, -3.5, -4, 3.5), L(-4, 4, -4, 11),
          L(-4, -8, 20, -8), L(20, -8, 20, -20), L(-4, 8, 20, 8), L(20, 8, 20, 20),
          L(-4, 0, 12, 0), L(12, -8, 12, 8),
          p ? PG([2, 0, 8, -3.4, 8, 3.4]) : PG([8, 0, 2, -3.4, 2, 3.4])],
      props: { pkg: 'TO-220' }, fp: c => fpInline(3, 1, 0.6, c.props.pkg === 'TO-92' ? 'to92' : 'to220')
    });
  }
  fet('NMOS', 'Nch MOSFET', false);
  fet('PMOS', 'Pch MOSFET', true);
  /* 接合型FET (JFET)。TO-92 のピン配置はメーカーで違うので props.pinout で並びを選ぶ */
  function jfet(id, name, p) {
    def(id, {
      name, cat: 'semi', prefix: 'Q', val: p ? '2SJ103GR' : '2SK208GR',
      pins: [{ n: 1, x: -20, y: 0, name: 'G' }, { n: 2, x: 20, y: -20, name: 'D' }, { n: 3, x: 20, y: 20, name: 'S' }],
      pinoutOpts: ['DGS', 'SGD', 'GDS', 'GSD', 'DSG', 'SDG'],
      g: [CI(2, 0, 18), L(-20, 0, -4, 0), L(-4, -12, -4, 12),
          L(-4, -8, 20, -8), L(20, -8, 20, -20), L(-4, 8, 20, 8), L(20, 8, 20, 20),
          p ? PG([-15, 0, -9, -3.4, -9, 3.4]) : PG([-5, 0, -11, -3.4, -11, 3.4])],
      props: { pinout: 'DGS' },
      fp: c => {
        const f = fpInline(3, 1, 0.55, 'to92'), map = { G: 1, D: 2, S: 3 };
        const o = String((c.props && c.props.pinout) || 'DGS').toUpperCase();
        if (/^[DGS]{3}$/.test(o) && new Set(o).size === 3) f.pads.forEach((q, i) => { q.pin = map[o[i]]; });
        return f;
      }
    });
  }
  jfet('NJFET', 'Nch JFET', false);
  jfet('PJFET', 'Pch JFET', true);
  def('REG', {
    name: '3端子レギュレータ', cat: 'semi', prefix: 'U', val: '7805',
    pins: [{ n: 1, x: -40, y: 0, name: 'IN' }, { n: 2, x: 0, y: 30, name: 'GND' }, { n: 3, x: 40, y: 0, name: 'OUT' }],
    g: [RC(-25, -18, 50, 36), L(-40, 0, -25, 0), L(40, 0, 25, 0), L(0, 30, 0, 18),
        TX(-17, 4, 'I', 9), TX(17, 4, 'O', 9)],
    props: {}, fp: () => fpInline(3, 1, 0.6, 'to220')
  });
  def('PC', {
    name: 'フォトカプラ', cat: 'semi', prefix: 'PC', val: 'TLP521',
    pins: [{ n: 1, x: -40, y: -15, name: 'A' }, { n: 2, x: -40, y: 15, name: 'K' },
           { n: 3, x: 40, y: 15, name: 'E' }, { n: 4, x: 40, y: -15, name: 'C' }],
    g: [RC(-25, -25, 50, 50), L(-40, -15, -25, -15), L(-40, 15, -25, 15),
        L(40, -15, 25, -15), L(40, 15, 25, 15),
        PG([-18, -19, -18, -5, -6, -12]), L(-18, -5, -6, -5), L(-18, -19, -18, -5),
        PL([2, -16, 10, -16, 6, -8, 14, -8]), L(0, -22, 0, 22)],
    props: {}, fp: () => fpDip(4, 3)
  });
  def('OPAMP2', {
    name: 'デュアルオペアンプ', cat: 'semi', prefix: 'U', val: 'OPA2134PA',
    pins: [{ n: 3, x: -40, y: -40, name: '+A' }, { n: 2, x: -40, y: -20, name: '-A' }, { n: 1, x: 40, y: -30, name: 'OUTA' },
           { n: 5, x: -40, y: 20, name: '+B' }, { n: 6, x: -40, y: 40, name: '-B' }, { n: 7, x: 40, y: 30, name: 'OUTB' },
           { n: 8, x: 0, y: -70, name: 'V+' }, { n: 4, x: 0, y: 70, name: 'V-' }],
    g: [PL([-24, -48, -24, -12, 22, -30, -24, -48]), PL([-24, 12, -24, 48, 22, 30, -24, 12]),
        L(-40, -40, -24, -40), L(-40, -20, -24, -20), L(22, -30, 40, -30),
        L(-40, 20, -24, 20), L(-40, 40, -24, 40), L(22, 30, 40, 30),
        L(0, -70, 0, -21), L(0, 70, 0, 21),
        TX(-17, -36, '+', 10), TX(-17, -16, '−', 10), TX(-17, 24, '+', 10), TX(-17, 44, '−', 10),
        TX(-2, -26, 'A', 8), TX(-2, 34, 'B', 8)],
    props: {}, fp: () => fpDip(8, 3)
  });
  def('JACK35', {
    name: 'ステレオジャック 3.5mm', cat: 'conn', prefix: 'J', val: '3.5mm',
    pins: [{ n: 1, x: -30, y: -20, name: 'L' }, { n: 2, x: -30, y: 0, name: 'R' }, { n: 3, x: -30, y: 20, name: 'G' }],
    g: [RC(-14, -30, 30, 60), L(-30, -20, -14, -20), L(-30, 0, -14, 0), L(-30, 20, -14, 20),
        PL([16, -12, 28, -12, 28, 12, 16, 12]), L(22, -12, 22, 12),
        TX(-6, -16, 'L', 7, 'left'), TX(-6, 4, 'R', 7, 'left'), TX(-6, 24, 'G', 7, 'left')],
    props: {}, fp: () => fpInline(3, 2, 1.2)
  });
  def('OPAMP', {
    name: 'オペアンプ', cat: 'semi', prefix: 'U', val: 'NJM4580',
    pins: [{ n: 3, x: -30, y: 10, name: '+' }, { n: 2, x: -30, y: -10, name: '-' },
           { n: 1, x: 30, y: 0, name: 'OUT' }, { n: 8, x: 0, y: -30, name: 'V+' }, { n: 4, x: 0, y: 30, name: 'V-' }],
    g: [PG([-18, -24, -18, 24, 22, 0]), L(-30, 10, -18, 10), L(-30, -10, -18, -10),
        L(30, 0, 22, 0), L(0, -30, 0, -13), L(0, 30, 0, 13),
        TX(-11, -6, '−', 11), TX(-11, 16, '+', 11)],
    props: {}, fp: () => fpDip(8, 3)
  });
  [8, 14, 16, 18, 20, 28].forEach(n => {
    def('DIP' + n, {
      name: 'DIP-' + n + ' IC', cat: 'ic', prefix: 'U', val: 'IC',
      pins: (() => {
        const half = n >> 1, a = [], h = half * 20;
        for (let i = 0; i < half; i++) a.push({ n: i + 1, x: -60, y: -h / 2 + 10 + i * 20 });
        for (let i = 0; i < half; i++) a.push({ n: n - i, x: 60, y: -h / 2 + 10 + i * 20 });
        return a;
      })(),
      g: (() => {
        const half = n >> 1, h = half * 20, a = [RC(-40, -h / 2, 80, h), AR(0, -h / 2, 8, 0, P)];
        for (let i = 0; i < half; i++) {
          const y = -h / 2 + 10 + i * 20;
          a.push(L(-60, y, -40, y), L(60, y, 40, y));
          a.push(TX(-34, y + 3, String(i + 1), 7, 'left'));
          a.push(TX(34, y + 3, String(n - i), 7, 'right'));
        }
        return a;
      })(),
      props: { rowGap: 3 }, fp: c => fpDip(n, c.props.rowGap || 3)
    });
  });

  /* --- スイッチ・機構部品 --- */
  def('SW', {
    name: 'スイッチ(SPST)', cat: 'mech', prefix: 'SW', val: 'SPST',
    pins: [{ n: 1, x: -20, y: 0 }, { n: 2, x: 20, y: 0 }],
    g: [L(-20, 0, -10, 0), CF(-10, 0, 2.5), CF(10, 0, 2.5), L(-10, 0, 9, -11), L(10, 0, 20, 0)],
    props: { span: 2 }, fp: c => fpInline(2, c.props.span || 2, 1.0)
  });
  def('SW3', {
    name: 'スイッチ(SPDT)', cat: 'mech', prefix: 'SW', val: 'SPDT',
    pins: [{ n: 1, x: -20, y: 0 }, { n: 2, x: 20, y: -10 }, { n: 3, x: 20, y: 10 }],
    g: [L(-20, 0, -10, 0), CF(-10, 0, 2.5), CF(10, -10, 2.5), CF(10, 10, 2.5),
        L(-10, 0, 9, -11), L(10, -10, 20, -10), L(10, 10, 20, 10)],
    props: { span: 1 }, fp: c => fpInline(3, c.props.span || 1, 1.0)
  });
  def('SWP', {
    name: 'タクトスイッチ', cat: 'mech', prefix: 'SW', val: 'TACT',
    pins: [{ n: 1, x: -20, y: 0 }, { n: 2, x: 20, y: 0 }],
    g: [L(-20, 0, -10, 0), CF(-10, 0, 2.5), CF(10, 0, 2.5), L(-13, -9, 13, -9),
        L(0, -9, 0, -16), L(-7, -16, 7, -16), L(10, 0, 20, 0)],
    props: {}, fp: () => fpGrid([[0, 0], [2, 0], [0, 2], [2, 2]])
  });
  def('RLY', {
    name: 'リレー', cat: 'mech', prefix: 'K', val: '5V',
    pins: [{ n: 1, x: -40, y: -20, name: 'C1' }, { n: 2, x: -40, y: 20, name: 'C2' },
           { n: 3, x: 40, y: -20, name: 'COM' }, { n: 4, x: 40, y: 0, name: 'NO' }, { n: 5, x: 40, y: 20, name: 'NC' }],
    g: [RC(-26, -28, 20, 56), L(-40, -20, -26, -20), L(-40, 20, -26, 20),
        L(-6, 0, 8, 0), L(40, -20, 20, -20), L(20, -20, 20, -6), CF(20, -20, 2.5),
        L(40, 0, 26, 0), CF(26, 0, 2.5), L(40, 20, 26, 20), CF(26, 20, 2.5), PL([20, -6, 28, 4])],
    props: {}, fp: () => fpGrid([[0, 0], [0, 4], [5, 0], [5, 2], [5, 4]])
  });
  def('BUZ', {
    name: 'ブザー', cat: 'mech', prefix: 'BZ', val: '5V',
    pins: [{ n: 1, x: -20, y: 0, name: '+' }, { n: 2, x: 20, y: 0, name: '-' }],
    // ドーム (半円) と底辺、両端から端子。上に音を表す弧
    g: [L(-20, 0, 20, 0), AR(0, 0, 13, P, 2 * P), AR(0, 0, 8, P * 1.2, P * 1.8),
        TX(-17, -5, '+', 9)],
    props: { span: 3 }, fp: c => fpRadial(c.props.span || 3, 3.2)
  });
  def('SPK', {
    name: 'スピーカ', cat: 'mech', prefix: 'SP', val: '8Ω',
    pins: [{ n: 1, x: -20, y: -8 }, { n: 2, x: -20, y: 8 }],
    g: [L(-20, -8, -8, -8), L(-20, 8, -8, 8), RC(-8, -10, 8, 20), PG([0, -10, 0, 10, 14, 20, 14, -20])],
    props: { span: 4 }, fp: c => fpInline(2, c.props.span || 4, 2.2)
  });
  def('M', {
    name: 'モータ', cat: 'mech', prefix: 'M', val: 'DC',
    pins: [{ n: 1, x: -30, y: 0 }, { n: 2, x: 30, y: 0 }],
    g: [CI(0, 0, 18), L(-30, 0, -18, 0), L(30, 0, 18, 0), TX(0, 5, 'M', 13)],
    props: { span: 2 }, fp: c => fpInline(2, c.props.span || 2, 2.2)
  });
  def('LAMP', {
    name: 'ランプ', cat: 'mech', prefix: 'LA', val: '6V',
    pins: [{ n: 1, x: -20, y: 0 }, { n: 2, x: 20, y: 0 }],
    g: [CI(0, 0, 11), L(-20, 0, -11, 0), L(20, 0, 11, 0), L(-7.8, -7.8, 7.8, 7.8), L(-7.8, 7.8, 7.8, -7.8)],
    props: { span: 3 }, fp: c => fpInline(2, c.props.span || 3, 1.6)
  });

  /* --- コネクタ --- */
  [2, 3, 4, 6, 8, 10].forEach(n => {
    def('J' + n, {
      name: 'ピンヘッダ ' + n + 'P', cat: 'conn', prefix: 'J', val: n + 'P',
      pins: (() => { const a = []; for (let i = 0; i < n; i++) a.push({ n: i + 1, x: -30, y: -(n - 1) * 10 + i * 20 }); return a; })(),
      g: (() => {
        const a = [RC(-14, -(n - 1) * 10 - 10, 24, n * 20)];
        for (let i = 0; i < n; i++) { const y = -(n - 1) * 10 + i * 20; a.push(L(-30, y, -14, y), CF(-4, y, 3)); a.push(TX(6, y + 3, String(i + 1), 7, 'right')); }
        return a;
      })(),
      props: {}, fp: () => fpInline(n, 1, 0.55, 'header')
    });
  });
  def('DCJ', {
    name: 'DCジャック', cat: 'conn', prefix: 'J', val: 'DC',
    pins: [{ n: 1, x: -30, y: -10, name: '+' }, { n: 2, x: -30, y: 10, name: '-' }],
    g: [RC(-14, -22, 28, 44), L(-30, -10, -14, -10), L(-30, 10, -14, 10), AR(6, 0, 10, P * 0.5, P * 1.5), L(-2, -10, -2, 10)],
    props: {}, fp: () => fpGrid([[0, 0], [2, 2]])
  });
  def('TB', {
    name: 'ターミナル', cat: 'conn', prefix: 'TB', val: '2P',
    pins: [{ n: 1, x: -30, y: -10 }, { n: 2, x: -30, y: 10 }],
    g: [RC(-14, -22, 28, 44), L(-30, -10, -14, -10), L(-30, 10, -14, 10), CI(2, -10, 5), CI(2, 10, 5)],
    props: {}, fp: () => fpTerm(2)
  });
  def('TB3', {
    name: 'ターミナル 3P', cat: 'conn', prefix: 'TB', val: '3P',
    pins: [{ n: 1, x: -30, y: -20 }, { n: 2, x: -30, y: 0 }, { n: 3, x: -30, y: 20 }],
    g: [RC(-14, -32, 28, 64), L(-30, -20, -14, -20), L(-30, 0, -14, 0), L(-30, 20, -14, 20), CI(2, -20, 5), CI(2, 0, 5), CI(2, 20, 5)],
    props: {}, fp: () => fpTerm(3)
  });
  def('BAT', {
    name: '電池', cat: 'conn', prefix: 'BT', val: '9V',
    pins: [{ n: 1, x: -20, y: 0, name: '+' }, { n: 2, x: 20, y: 0, name: '-' }],
    g: [L(-20, 0, -8, 0), L(-8, -12, -8, 12), L(-2, -6, -2, 6), L(4, -12, 4, 12), L(10, -6, 10, 6),
        L(10, 0, 20, 0), TX(-12, -14, '+', 10)],
    props: { span: 2 }, fp: c => fpInline(2, c.props.span || 2, 1.0)
  });

  /* --- 電源記号・ラベル (仮想 = 基板上の実体なし) --- */
  def('GND', {
    name: 'GND', cat: 'power', prefix: '#PWR', virtual: true, net: 'GND',
    pins: [{ n: 1, x: 0, y: 0 }],
    g: [L(0, 0, 0, 10), L(-13, 10, 13, 10), L(-8, 15, 8, 15), L(-3, 20, 3, 20)],
    props: {}
  });
  def('VCC', {
    name: 'VCC', cat: 'power', prefix: '#PWR', virtual: true, net: 'VCC',
    pins: [{ n: 1, x: 0, y: 0 }],
    g: [L(0, 0, 0, -10), L(-10, -10, 10, -10), TX(0, -15, 'VCC', 9)],
    props: { net: 'VCC' }
  });
  def('VEE', {
    name: 'V- / VEE', cat: 'power', prefix: '#PWR', virtual: true, net: 'VEE',
    pins: [{ n: 1, x: 0, y: 0 }],
    g: [L(0, 0, 0, 10), L(-10, 10, 10, 10), TX(0, 22, 'VEE', 9)],
    props: { net: 'VEE' }
  });
  def('NET', {
    name: 'ネットラベル', cat: 'power', prefix: '#LBL', virtual: true, net: 'NET',
    pins: [{ n: 1, x: 0, y: 0 }],
    g: [L(0, 0, 10, 0), PL([10, -7, 46, -7, 46, 7, 10, 7, 10, -7]), TX(28, 4, 'NET', 9)],
    props: { net: 'NET1' }
  });

  /* ---------------- 部品インスタンス ---------------- */
  function symOf(comp) {
    if (comp.type === 'CUSTOM') return customSym(comp);
    return SYM[comp.type];
  }
  function customSym(comp) {
    const d = comp.props.custom || { pins: 4, pads: [[0, 0], [1, 0], [0, 3], [1, 3]], label: 'CUSTOM' };
    const n = d.pads.length, half = Math.max(1, Math.ceil(n / 2)), h = half * 20;
    const pins = [], g = [RC(-40, -h / 2, 80, h)];
    for (let i = 0; i < n; i++) {
      const left = i < half, k = left ? i : i - half;
      const y = -h / 2 + 10 + k * 20, x = left ? -60 : 60;
      pins.push({ n: i + 1, x, y, name: (d.names && d.names[i]) || String(i + 1) });
      g.push(L(x, y, left ? -40 : 40, y));
      g.push(TX(left ? -34 : 34, y + 3, String(i + 1), 7, left ? 'left' : 'right'));
    }
    g.push(TX(0, -h / 2 - 6, d.label || 'CUSTOM', 9));
    return { id: 'CUSTOM', name: d.label || 'カスタム', cat: 'custom', prefix: 'U', pins, g, props: {}, fp: () => fpGrid(d.pads) };
  }

  function pinPos(comp, pin) {
    const [x, y] = rotXY(pin.x, pin.y, comp.rot || 0);
    return [comp.x + x, comp.y + y];
  }
  function compPins(comp) {
    const s = symOf(comp); if (!s) return [];
    return s.pins.map(p => { const [x, y] = pinPos(comp, p); return { pin: p, x, y }; });
  }
  function symBBox(s) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    const acc = (x, y) => { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; };
    for (const p of s.g) {
      switch (p[0]) {
        case 'L': acc(p[1], p[2]); acc(p[3], p[4]); break;
        case 'PL': case 'PG': for (let i = 0; i < p[1].length; i += 2) acc(p[1][i], p[1][i + 1]); break;
        case 'C': case 'CF': case 'A': acc(p[1] - p[3], p[2] - p[3]); acc(p[1] + p[3], p[2] + p[3]); break;
        case 'R': acc(p[1], p[2]); acc(p[1] + p[3], p[2] + p[4]); break;
        case 'T': acc(p[1] - 14, p[2] - 10); acc(p[1] + 14, p[2] + 4); break;
      }
    }
    for (const p of s.pins) acc(p.x, p.y);
    return { x0, y0, x1, y1 };
  }
  function compBBox(comp) {
    const s = symOf(comp); if (!s) return { x0: comp.x, y0: comp.y, x1: comp.x, y1: comp.y };
    const b = s._bb || (s._bb = symBBox(s));
    const pts = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]].map(p => rotXY(p[0], p[1], comp.rot || 0));
    return {
      x0: comp.x + Math.min(...pts.map(p => p[0])), y0: comp.y + Math.min(...pts.map(p => p[1])),
      x1: comp.x + Math.max(...pts.map(p => p[0])), y1: comp.y + Math.max(...pts.map(p => p[1]))
    };
  }

  /* ---------------- ネットリスト抽出 ---------------- */
  // 接続規則: ワイヤ端点同士 / 端点がワイヤ内部に接する(T) / ピンがワイヤ上にある
  //           交差(X)はジャンクションドットがある場合のみ接続
  function extractNets(doc) {
    const key = (x, y) => x + ',' + y;
    const idx = new Map(), pts = [];
    const nid = (x, y) => { const k = key(x, y); let i = idx.get(k); if (i === undefined) { i = pts.length; pts.push([x, y]); idx.set(k, i); } return i; };

    const parent = [];
    const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
    const ensure = i => { while (parent.length <= i) parent.push(parent.length); };

    const wires = doc.wires || [];
    const segs = wires.map(w => ({ a: nid(w.x1, w.y1), b: nid(w.x2, w.y2), w }));
    const pinNodes = [];
    for (const c of doc.components) for (const pp of compPins(c)) pinNodes.push({ comp: c, pin: pp.pin, node: nid(pp.x, pp.y) });
    for (const j of (doc.junctions || [])) nid(j.x, j.y);
    for (let i = 0; i < pts.length; i++) ensure(i);

    for (const s of segs) union(s.a, s.b);

    // 端点/ピンがセグメント内部に乗る場合を接続
    const onSeg = (px, py, x1, y1, x2, y2) => {
      const cross = (px - x1) * (y2 - y1) - (py - y1) * (x2 - x1);
      if (Math.abs(cross) > 1e-6) return false;
      const dot = (px - x1) * (x2 - x1) + (py - y1) * (y2 - y1);
      const len2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
      return len2 > 0 && dot > 1e-6 && dot < len2 - 1e-6;
    };
    for (const s of segs) {
      const w = s.w;
      for (let i = 0; i < pts.length; i++) {
        if (i === s.a || i === s.b) continue;
        if (onSeg(pts[i][0], pts[i][1], w.x1, w.y1, w.x2, w.y2)) union(s.a, i);
      }
    }
    // ジャンクションドット: 同一点を通る全ワイヤを接続 (交差の明示接続)
    for (const j of (doc.junctions || [])) {
      const jn = idx.get(key(j.x, j.y)); if (jn === undefined) continue;
      for (const s of segs) if (onSeg(j.x, j.y, s.w.x1, s.w.y1, s.w.x2, s.w.y2) || s.a === jn || s.b === jn) union(jn, s.a);
    }

    // グループ化
    const groups = new Map();
    for (const pn of pinNodes) {
      const r = find(pn.node);
      if (!groups.has(r)) groups.set(r, { pins: [], labels: [], root: r });
      const g = groups.get(r);
      const s = symOf(pn.comp);
      if (s && s.virtual) g.labels.push({ name: (pn.comp.props && pn.comp.props.net) || s.net || 'NET', rail: s.id !== 'NET' });
      else g.pins.push({ ref: pn.comp.ref, comp: pn.comp, pin: pn.pin, node: pn.node });
    }
    // ワイヤのみのネット(部品なし)も拾う
    for (const s of segs) { const r = find(s.a); if (!groups.has(r)) groups.set(r, { pins: [], labels: [], root: r }); }

    // ラベルで統合
    const byLabel = new Map(), nets = [], netByRoot = new Map();
    let auto = 0;
    for (const g of groups.values()) {
      netByRoot.set(g.root, null);
      const lbl = g.labels.length ? g.labels[0].name : null;
      if (lbl) {
        if (byLabel.has(lbl)) {
          const t = byLabel.get(lbl); t.pins.push(...g.pins);
          t.rail = t.rail || g.labels[0].rail; netByRoot.set(g.root, t); continue;
        }
        const n = { name: lbl, pins: g.pins, power: true, rail: g.labels[0].rail, wires: [] };
        byLabel.set(lbl, n); nets.push(n); netByRoot.set(g.root, n);
      } else {
        const n = { name: 'N$' + (++auto), pins: g.pins, power: false, wires: [] };
        nets.push(n); netByRoot.set(g.root, n);
      }
    }
    for (const s of segs) {
      const n = netByRoot.get(find(s.a));
      if (n) { (n.wires || (n.wires = [])).push(s.w.id); }
    }
    const used = nets.filter(n => n.pins.length > 0 || n.power);
    used.forEach((n, i) => n.index = i);
    return used;
  }

  /* 簡易ERC */
  function erc(doc, nets) {
    const msgs = [];
    for (const n of nets) {
      if (n.pins.length === 0) msgs.push({ lv: 'warn', t: `ネット ${n.name}: 接続部品なし` });
      else if (n.pins.length === 1) msgs.push({ lv: 'warn', t: `ネット ${n.name}: ${n.pins[0].ref}.${n.pins[0].pin.name || n.pins[0].pin.n} が単独接続` });
    }
    const seen = new Set();
    for (const c of doc.components) {
      const s = symOf(c); if (!s || s.virtual) continue;
      if (seen.has(c.ref)) msgs.push({ lv: 'err', t: `リファレンス重複: ${c.ref}` });
      seen.add(c.ref);
    }
    const connected = new Set();
    for (const n of nets) for (const p of n.pins) connected.add(p.comp.id + ':' + p.pin.n);
    for (const c of doc.components) {
      const s = symOf(c); if (!s || s.virtual) continue;
      for (const p of s.pins) if (!connected.has(c.id + ':' + p.n))
        msgs.push({ lv: 'warn', t: `${c.ref}.${p.name || p.n} 未接続` });
    }
    // 基板外部品のピンは、基板上の部品（コネクタ等）につながっていないと配線できない
    const onboard = p => { const sy = symOf(p.comp); return sy && !sy.virtual && !(p.comp.props && p.comp.props.offboard); };
    for (const n of nets) {
      const on = n.pins.filter(onboard);
      if (on.length === 1 && n.pins.length >= 2)
        msgs.push({ lv: 'err', t: `ネット ${n.name}: 基板上の端子が ${on[0].ref}.${on[0].pin.name || on[0].pin.n} だけです（基板では線が出ません。配線穴用のコネクタを追加してください）` });
      const off = n.pins.filter(p => p.comp.props && p.comp.props.offboard);
      if (off.length && !n.pins.some(onboard))
        msgs.push({ lv: 'warn', t: `基板外部品 ${off.map(p => p.ref + '.' + (p.pin.name || p.pin.n)).join(', ')} が基板上の部品につながっていません` });
    }
    return msgs;
  }

  global.CADCore = {
    GS, PITCH, SYM, symOf, pinPos, compPins, compBBox, symBBox, rotXY,
    extractNets, erc, fpAxial, fpRadial, fpInline, fpDip, fpGrid, fpTerm, customSym
  };
})(typeof window !== 'undefined' ? window : globalThis);
