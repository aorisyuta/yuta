/* ---- ui-pre.js ---- */
/* =====================================================================
   UniBoard SPICE — アプリ起動前に読み込む設定
   (基本記号パレットの表示対象 / 折りたたみ / 定数プリセット)
   ===================================================================== */
(function () {
  'use strict';
  // 基本記号のグリッドには代表的な記号だけを出し、残りは「部品ライブラリ」検索から
  const SHOW_EXTRA = new Set(['VDC', 'VSIN', 'VPULSE', 'IDC', 'G_AND', 'G_OR', 'G_NAND', 'G_NOR', 'G_XOR', 'G_NOT', 'DFF',
    'SBD', 'SCR', 'TRIAC', 'PHOTOTR', 'TL431', 'LED7', 'NTC', 'LDR', 'TRAFO', 'IC555', 'OPAMP4']);
  const ORIGINAL = new Set(['R', 'POT', 'C', 'CP', 'L', 'X', 'F', 'D', 'ZD', 'LED', 'BR', 'NPN', 'PNP', 'NMOS', 'PMOS', 'NJFET', 'PJFET', 'REG', 'PC',
    'OPAMP2', 'JACK35', 'OPAMP', 'DIP8', 'DIP14', 'DIP16', 'DIP18', 'DIP20', 'DIP28', 'SW', 'SW3', 'SWP', 'RLY', 'BUZ', 'SPK', 'M', 'LAMP',
    'J2', 'J3', 'J4', 'J6', 'J8', 'J10', 'DCJ', 'TB', 'TB3', 'BAT', 'GND', 'VCC', 'VEE', 'NET']);
  window.UBPaletteHide = s => !(ORIGINAL.has(s.id) || SHOW_EXTRA.has(s.id));
  window.UBPaletteFold = (g, h4, cat) => {
    let folded = {};
    try { folded = JSON.parse(localStorage.getItem('ubspice.fold') || '{}'); } catch (e) { }
    h4.classList.add('fold');
    h4.setAttribute('role', 'button'); h4.tabIndex = 0;
    const apply = () => { g.classList.toggle('folded', !!folded[cat]); h4.setAttribute('aria-expanded', String(!folded[cat])); };
    const tog = () => { folded[cat] = !folded[cat]; try { localStorage.setItem('ubspice.fold', JSON.stringify(folded)); } catch (e) { } apply(); };
    h4.onclick = tog; h4.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tog(); } };
    apply();
  };
  window.UBPresets = {
    VDC: ['1.5V', '3V', '3.3V', '5V', '6V', '9V', '12V', '15V', '24V'],
    VSIN: ['SIN(0 1 1k)', 'SIN(0 0.1 1k)', 'SIN(0 1 100)', 'SIN(0 1 10k)', 'SIN(2.5 2.5 1k)', 'SIN(0 0.01 1k)', 'SIN(0 17 50)'],
    VAC: ['SIN(0 141 50)', 'SIN(0 141 60)', 'SIN(0 17 50)'],
    VPULSE: ['PULSE(0 5 0 1u 1u 0.5m 1m)', 'PULSE(0 5 0 1u 1u 5m 10m)', 'PULSE(0 3.3 0 10n 10n 0.5u 1u)', 'PULSE(0 5 1m 1u 1u 1 2)'],
    IDC: ['100u', '1m', '10m', '20m', '100m'],
    SBD: ['1N5819', '1N5817', '1N5822', 'BAT43', 'BAT54', 'SS14'],
    TVS: ['P6KE6.8A', 'P6KE15A', 'P6KE18A', 'P6KE33A', 'SMBJ5.0A'],
    SCR: ['2P4M', 'C106D', 'MCR100-6', 'BT151-500R'],
    TRIAC: ['BCR1AM-12', 'BT136-600', 'BTA16-600B', 'MAC97A6'],
    PHOTOTR: ['PT334', 'NJL7502L', 'TPS601A'],
    PHOTOD: ['S1223', 'BPW34'],
    TL431: ['TL431', 'NJM431'],
    LED7: ['カソードコモン 赤', 'アノードコモン 赤', 'カソードコモン 緑', 'カソードコモン 青'],
    NTC: ['10k', '4.7k', '47k', '100k'],
    LDR: ['5k', '10k', '20k', '50k'],
    VARISTOR: ['18V', '47V', '270V', '470V'],
    CNP: ['1u', '4.7u', '10u', '47u'],
    TRAFO: ['100V:6V', '100V:9V', '100V:12V', '100V:15V', '100V:24V', '1:1', '10k:600', '1.2k:8'],
    IC555: ['NE555', 'TLC555', 'ICM7555', 'LMC555'],
    OPAMP2: ['NJM4580', 'NJM4558', 'LM358', 'TL072', 'NE5532', 'OPA2134', 'MCP6002'],
    OPAMP4: ['LM324', 'TL074', 'MCP6004', 'LM2902'],
    CMP2: ['LM393', 'LM2903'],
    NJFET: ['2SK30A-GR', '2SK117-BL', '2SK208-GR', 'J201', '2N5457'],
    PJFET: ['2SJ103-GR', 'J175'],
    RLY2: ['5V', '12V', '24V']
  };
})();
