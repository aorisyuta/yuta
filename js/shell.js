/* ---- shell.js ---- */
/* =====================================================================
   UniBoard SPICE — 画面まわり
   部品ライブラリ検索 / コマンドパレット / 自動保存 / ショートカット一覧
   ===================================================================== */
(function () {
  'use strict';
  const UB = window.UniBoard, A = UB.api, C1 = window.CADCore, CP = window.CADParts, RD = window.CADRender;
  const S = () => UB.state;
  const $ = id => document.getElementById(id);
  const el = A.el;
  const H = window.UBHooks = window.UBHooks || {};
  const toast = (t, l) => window.UBToast && window.UBToast(t, l);
  const store = {
    get(k, d) { try { const v = localStorage.getItem('ubspice.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('ubspice.' + k, JSON.stringify(v)); } catch (e) { } }
  };

  /* ================= 部品ライブラリ検索 ================= */
  const LS = { q: '', cat: 'all', rows: [], recent: store.get('recent', []) };
  const box = $('libSearch');
  box.innerHTML = `<div class="ls-in"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="7" cy="7" r="4.6"/><path d="m10.4 10.4 3.4 3.4"/></svg>
    <input id="libQ" type="search" autocomplete="off" spellcheck="false" placeholder="部品を検索 (型番・定数・種類)"></div>
    <div class="ls-cats" id="libCats"></div><div class="ls-list" id="libList" hidden><div class="ls-spacer" id="libSpacer"></div></div>`;
  $('libCount').textContent = CP.LIB.length.toLocaleString() + ' 点';
  const cats = $('libCats');
  CP.CATS.forEach(([k, l]) => {
    const b = el('button', 'lc', l); b.type = 'button'; b.dataset.k = k;
    b.onclick = () => { LS.cat = LS.cat === k && k !== 'all' ? 'all' : k; refresh(); };
    cats.appendChild(b);
  });
  const q = $('libQ'), list = $('libList'), spacer = $('libSpacer');
  let qt = null;
  q.addEventListener('input', () => { clearTimeout(qt); qt = setTimeout(() => { LS.q = q.value; refresh(); }, 80); });
  q.addEventListener('keydown', e => {
    if (e.key === 'Enter' && LS.rows.length) { pick(LS.rows[0]); }
    if (e.key === 'Escape') { q.value = ''; LS.q = ''; refresh(); q.blur(); }
  });
  function refresh() {
    cats.querySelectorAll('.lc').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === LS.cat)));
    const active = LS.q.trim() || LS.cat !== 'all';
    list.hidden = !active && !LS.recent.length;
    if (!active) {
      LS.rows = LS.recent.map(id => CP.LIB.find(e => e.id === id)).filter(Boolean);
      list.classList.add('recent');
    } else { LS.rows = CP.search(LS.q, LS.cat); list.classList.remove('recent'); }
    spacer.style.height = (LS.rows.length * ROW + (active ? 0 : 22)) + 'px';
    list.scrollTop = 0; drawRows();
    $('palette').classList.toggle('searching', !!active);
  }
  const ROW = 40;
  const thumbCache = new Map();
  function thumb(symId) {
    const key = symId + '|' + (RD.TH.ink || '');
    if (thumbCache.has(key)) return thumbCache.get(key);
    const s = C1.SYM[symId]; if (!s) return '';
    const c = document.createElement('canvas'); c.width = 72; c.height = 44;
    const g = c.getContext('2d'); g.setTransform(2, 0, 0, 2, 0, 0);
    const bb = C1.symBBox(s), w = Math.max(20, bb.x1 - bb.x0), h = Math.max(20, bb.y1 - bb.y0), z = Math.min(32 / w, 18 / h, 0.9);
    g.translate(18 - (bb.x0 + bb.x1) / 2 * z, 11 - (bb.y0 + bb.y1) / 2 * z); g.scale(z, z);
    try { RD.drawSymbol(RD.CanvasPen(g), s, 0, 0, 0, { w: 2 / z, color: RD.TH.ink2, pin: RD.TH.copper }); } catch (e) { }
    const url = c.toDataURL(); thumbCache.set(key, url); return url;
  }
  function drawRows() {
    [...list.querySelectorAll('.lr,.lh')].forEach(n => n.remove());
    const recent = list.classList.contains('recent');
    const off = recent ? 22 : 0;
    if (recent && LS.rows.length) { const h = el('div', 'lh', '最近使った部品'); h.style.top = '0px'; list.appendChild(h); }
    if (!LS.rows.length && !recent) { const h = el('div', 'lh', '見つかりません。別の言葉で探してください'); h.style.top = '0px'; list.appendChild(h); return; }
    const top = list.scrollTop, hgt = list.clientHeight || 300;
    const i0 = Math.max(0, Math.floor((top - off) / ROW) - 3), i1 = Math.min(LS.rows.length, Math.ceil((top - off + hgt) / ROW) + 3);
    for (let i = i0; i < i1; i++) {
      const e = LS.rows[i];
      const r = el('button', 'lr'); r.type = 'button'; r.style.top = (off + i * ROW) + 'px';
      r.title = e.name + (e.desc ? '\n' + e.desc : '');
      const im = el('img'); im.alt = ''; im.src = thumb(e.sym); r.appendChild(im);
      const t = el('span', 'lt'); t.appendChild(el('b', null, e.name)); t.appendChild(el('em', null, e.sub)); r.appendChild(t);
      r.setAttribute('aria-pressed', String(S().placeLib && S().placeLib.id === e.id));
      r.onclick = () => pick(e);
      list.appendChild(r);
    }
  }
  list.addEventListener('scroll', () => requestAnimationFrame(drawRows));
  function pick(e) {
    const st = S();
    if (st.placeLib && st.placeLib.id === e.id) { st.place = null; st.placeLib = null; A.paletteSync(); A.hint(); A.actbar(); A.rp(); drawRows(); return; }
    if (st.tab !== 'sch') A.setTab('sch');
    if (window.UBPcb && window.UBPcb.state.active) window.UBPcb.activate(false);
    A.setTool('sel', true);
    st.place = e.sym; st.placeLib = e; st.placeProps = { val: e.val, props: JSON.parse(JSON.stringify(e.props || {})) };
    LS.recent = [e.id].concat(LS.recent.filter(x => x !== e.id)).slice(0, 12); store.set('recent', LS.recent);
    A.paletteSync(); A.hint(); A.actbar(); A.rp(); drawRows();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();   // R / Esc などのキー操作を効かせる
    if (window.innerWidth <= 640) { st.palOpen = false; A.applyPanels(); }
  }
  H.paletteSync = () => { if (!list.hidden) drawRows(); };
  new ResizeObserver(() => drawRows()).observe(list);
  refresh();

  /* ================= コマンドパレット ================= */
  const cmds = () => [
    ['回路図を表示', () => { if (window.UBPcb) window.UBPcb.activate(false); A.setTab('sch'); }, '1'],
    ['蛇の目基板を表示', () => { if (window.UBPcb) window.UBPcb.activate(false); A.setTab('pcb'); }, '2'],
    ['PCB (プリント基板) を表示', () => window.UBPcb.activate(true), '3'],
    ['シミュレーション実行', () => window.UBSim.run(), 'F5'],
    ['シミュレーション: 動作点', () => { window.UBSim.state.cfg.type = 'op'; window.UBSim.run(); }],
    ['シミュレーション: 過渡解析', () => { window.UBSim.state.cfg.type = 'tran'; window.UBSim.run(); }],
    ['シミュレーション: AC 解析 (周波数特性)', () => { window.UBSim.state.cfg.type = 'ac'; window.UBSim.run(); }],
    ['シミュレーション: DC スイープ', () => { window.UBSim.state.cfg.type = 'dc'; window.UBSim.openDock(true); }],
    ['シミュレーション パネルを開く / 閉じる', () => window.UBSim.openDock()],
    ['プローブ ツール', () => { A.setTab('sch'); A.setTool('probe'); }, 'P'],
    ['配線ツール', () => { A.setTab('sch'); A.setTool('wire'); }, 'W'],
    ['回路図: 配線を整える (部品はそのまま)', () => { A.setTab('sch'); A.tidyWires(); }],
    ['回路図: 自動レイアウト (部品を並べ直す)', () => { A.setTab('sch'); A.autoLayout(); }],
    ['サンプル回路を開く', () => $('bSample').click()],
    ['SPICE サンプル回路を開く', () => openSpiceSamples()],
    ['回路図を読み込む', () => $('bImport').click()],
    ['ダウンロード (回路図・基板・部品表)', () => $('bExport').click()],
    ['蛇の目基板に変換', () => { A.setTab('pcb'); $('bConvert').click(); }],
    ['PCB: 回路図から更新', () => { window.UBPcb.activate(true); window.UBPcb.importFromSchematic(); }],
    ['PCB: 自動配置', () => { window.UBPcb.activate(true); window.UBPcb.autoPlace(); }],
    ['PCB: 自動配線', () => { window.UBPcb.activate(true); window.UBPcb.autoRoute(); }],
    ['PCB: DRC (デザインルールチェック)', () => { window.UBPcb.activate(true); window.UBPcb.runDRC(); window.UBPcb.render(); }],
    ['電子工作 計算ツール', () => window.UBCalc.open(), 'T'],
    ['表示テーマを切り替え', () => $('bTheme').click()],
    ['元に戻す', () => A.undo(), 'Ctrl+Z'], ['やり直し', () => A.redo(), 'Ctrl+Y'],
    ['全体表示', () => A.fit(), 'F'],
    ['キーボード ショートカット一覧', () => shortcuts(), '?']
  ];
  const cp = el('div', 'cmdk'); cp.hidden = true; cp.id = 'cmdk';
  cp.innerHTML = '<div class="cmdk-box" role="dialog" aria-label="コマンドと部品の検索"><input id="cmdkQ" type="text" autocomplete="off" spellcheck="false" placeholder="コマンドや部品を検索… (例: 実行, 自動配線, 2SC1815)"><div class="cmdk-list" id="cmdkList"></div><div class="cmdk-foot">↑↓ 選択　Enter 実行　Esc 閉じる</div></div>';
  document.body.appendChild(cp);
  let cpSel = 0, cpItems = [];
  function openCmd() { cp.hidden = false; $('cmdkQ').value = ''; cpRender(); setTimeout(() => $('cmdkQ').focus(), 10); }
  function closeCmd() { cp.hidden = true; }
  function cpRender() {
    const t = $('cmdkQ').value.trim().toLowerCase(), l = $('cmdkList'); l.innerHTML = '';
    const cs = cmds().filter(c => !t || c[0].toLowerCase().includes(t)).map(c => ({ kind: 'cmd', label: c[0], key: c[2], run: c[1] }));
    const ps = t ? CP.search(t, 'all', 30).map(e => ({ kind: 'part', label: e.name, key: e.sub, run: () => pick(e) })) : [];
    cpItems = cs.concat(ps).slice(0, 60); cpSel = Math.min(cpSel, Math.max(0, cpItems.length - 1));
    if (!cpItems.length) l.appendChild(el('div', 'cmdk-empty', '見つかりません'));
    cpItems.forEach((it, i) => {
      const b = el('button', 'cmdk-it' + (i === cpSel ? ' on' : '')); b.type = 'button';
      b.appendChild(el('i', 'k-' + it.kind, it.kind === 'cmd' ? '▸' : '◆'));
      b.appendChild(el('span', null, it.label));
      if (it.key) b.appendChild(el('kbd', null, it.key));
      b.onclick = () => { closeCmd(); it.run(); };
      l.appendChild(b);
    });
    const on = l.querySelector('.on'); if (on) on.scrollIntoView({ block: 'nearest' });
  }
  $('cmdkQ').addEventListener('input', () => { cpSel = 0; cpRender(); });
  $('cmdkQ').addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { cpSel = Math.min(cpItems.length - 1, cpSel + 1); cpRender(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { cpSel = Math.max(0, cpSel - 1); cpRender(); e.preventDefault(); }
    if (e.key === 'Enter' && cpItems[cpSel]) { const it = cpItems[cpSel]; closeCmd(); it.run(); }
    if (e.key === 'Escape') closeCmd();
  });
  cp.addEventListener('click', e => { if (e.target === cp) closeCmd(); });
  window.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); cp.hidden ? openCmd() : closeCmd(); return; }
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === '?' || (e.shiftKey && e.key === '/')) { shortcuts(); return; }
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      const pcb = window.UBPcb && window.UBPcb.state.active;
      if (e.key === '1') { if (pcb) window.UBPcb.activate(false); A.setTab('sch'); }
      if (e.key === '2') { if (pcb) window.UBPcb.activate(false); A.setTab('pcb'); }
      if (e.key === '3') window.UBPcb.activate(true);
      if (e.key === 't' && !pcb) window.UBCalc.open();
      if (e.key === '/' && !pcb) { e.preventDefault(); if (!S().palOpen) { S().palOpen = true; A.applyPanels(); } q.focus(); }
    }
  }, true);
  $('bCmd').onclick = openCmd;

  function shortcuts() {
    A.openModal('キーボード ショートカット', body => {
      const rows = [
        ['全体', [['Ctrl+K', 'コマンド・部品を検索'], ['1 / 2 / 3', '回路図 / 蛇の目基板 / PCB'], ['F5', 'シミュレーション実行'], ['T', '計算ツール'], ['/', '部品ライブラリを検索'], ['Ctrl+Z / Ctrl+Y', '元に戻す / やり直し'], ['F', '全体表示'], ['?', 'この一覧']]],
        ['回路図', [['W', '配線'], ['M', '範囲選択'], ['J', '接続点'], ['D', '消しゴム'], ['P', 'プローブ'], ['V / Esc', '選択に戻る'], ['R', '回転'], ['Space', '配線の折れ方向'], ['Delete', '削除']]],
        ['PCB', [['W', '配線'], ['X', '層を切替 (配線中はビア)'], ['/', '曲がり方を切替'], ['R', '回転'], ['F', '裏返す (未選択なら全体表示)'], ['Enter / ダブルクリック', '配線を終了'], ['右クリック', '配線を中止']]],
        ['波形', [['ドラッグ', '時間軸を拡大'], ['ホイール', '拡大 / 縮小'], ['ダブルクリック', '全体に戻す'], ['クリック', '回路図に表示する時刻を指定']]]
      ];
      const g = el('div', 'kbgrid');
      rows.forEach(([h, list]) => {
        const d = el('div'); d.appendChild(el('h5', 'sec', h));
        list.forEach(([k, t]) => { const r = el('div', 'kv'); const kk = el('span'); kk.appendChild(el('kbd', null, k)); r.appendChild(el('span', null, t)); r.appendChild(kk); d.appendChild(r); });
        g.appendChild(d);
      });
      body.appendChild(g);
    });
  }

  /* ================= SPICE サンプル ================= */
  const SPICE_SAMPLES = [
    { name: 'RC ローパスフィルタ (AC 解析)', desc: '1kΩ と 0.1µF の一次フィルタ。遮断周波数 ≈ 1.6kHz', sim: { type: 'ac' }, probes: ['v(out)'],
      json: { components: [['VSIN', 100, 200, 0, 'V1', 'SIN(0 1 1k)'], ['R', 170, 170, 0, 'R1', '1k'], ['C', 230, 200, 90, 'C1', '0.1u'], ['GND', 100, 240], ['GND', 230, 240], ['NET', 250, 170, 0, null, null, { net: 'OUT' }]],
        wires: [[100, 170, 150, 170], [190, 170, 250, 170], [230, 170, 230, 180], [100, 230, 100, 240], [230, 220, 230, 240]], junctions: [[230, 170]] } },
    { name: 'トランジスタ 1 石アンプ (過渡解析)', desc: '2SC1815 のエミッタ接地増幅。入力 10mV 1kHz → 出力を観察', sim: { type: 'tran', tstop: '5m', start: 'op' }, probes: ['v(in)', 'v(out)'],
      json: { components: [['VSIN', 60, 260, 0, 'V1', 'SIN(0 0.01 1k)'], ['C', 120, 230, 0, 'C1', '10u'], ['R', 170, 170, 90, 'R1', '47k'], ['R', 170, 290, 90, 'R2', '10k'], ['NPN', 200, 230, 0, 'Q1', '2SC1815'],
        ['R', 220, 150, 90, 'R3', '4.7k'], ['R', 220, 290, 90, 'R4', '1k'], ['C', 260, 290, 90, 'C3', '100u'], ['C', 290, 210, 0, 'C2', '10u'], ['R', 340, 250, 90, 'R5', '47k'], ['VCC', 170, 130, 0, null, null, { net: 'VCC' }], ['VCC', 220, 110, 0, null, null, { net: 'VCC' }],
        ['GND', 60, 300], ['GND', 170, 320], ['GND', 220, 320], ['GND', 260, 320], ['GND', 340, 280], ['NET', 350, 210, 0, null, null, { net: 'OUT' }], ['NET', 80, 230, 270, null, null, { net: 'IN' }]],
        wires: [[60, 230, 100, 230], [140, 230, 180, 230], [170, 190, 170, 270], [170, 150, 170, 130], [220, 130, 220, 110], [220, 170, 220, 210], [220, 250, 220, 270], [220, 260, 260, 260], [260, 260, 260, 270],
          [220, 310, 220, 320], [170, 310, 170, 320], [260, 310, 260, 320], [60, 290, 60, 300], [220, 210, 270, 210], [310, 210, 350, 210], [340, 210, 340, 230], [340, 270, 340, 280]],
        junctions: [[170, 230], [220, 210], [220, 260], [340, 210]] } },
    { name: 'オペアンプ 反転増幅 ×10 (過渡解析)', desc: '±5V 電源の反転増幅器。入力 0.2V 1kHz', sim: { type: 'tran', tstop: '3m', start: 'op' }, probes: ['v(in)', 'v(out)'],
      json: { components: [['VSIN', 60, 250, 0, 'V1', 'SIN(0 0.2 1k)'], ['R', 140, 210, 0, 'R1', '10k'], ['R', 230, 150, 0, 'R2', '100k'], ['OPAMP', 230, 220, 0, 'U1', 'NJM4580'], ['GND', 60, 290], ['GND', 180, 260],
        ['VCC', 230, 190, 0, null, null, { net: 'VCC' }], ['VEE', 230, 250, 0, null, null, { net: 'VEE' }], ['NET', 300, 220, 0, null, null, { net: 'OUT' }], ['NET', 90, 210, 270, null, null, { net: 'IN' }]],
        wires: [[60, 220, 60, 210], [60, 210, 120, 210], [160, 210, 200, 210], [180, 210, 180, 150], [180, 150, 210, 150], [250, 150, 280, 150], [280, 150, 280, 220], [260, 220, 300, 220], [200, 230, 180, 230], [180, 230, 180, 260], [60, 280, 60, 290]],
        junctions: [[180, 210], [280, 220]] } },
    { name: 'ツェナー定電圧 + LED (DC スイープ)', desc: '電源電圧を 0〜12V まで変えたときの出力電圧', sim: { type: 'dc', dc: { src: 'vv1', start: '0', stop: '12', step: '0.05' } },
      json: { components: [['VDC', 60, 220, 0, 'V1', '12V'], ['R', 130, 190, 0, 'R1', '470'], ['ZD', 180, 230, 270, 'D1', '5.1V'], ['R', 240, 220, 90, 'R2', '1k'], ['LED', 240, 280, 90, 'D2', '赤'], ['GND', 60, 260], ['GND', 180, 270], ['GND', 240, 310], ['NET', 250, 190, 0, null, null, { net: 'OUT' }]],
        wires: [[60, 190, 110, 190], [150, 190, 250, 190], [180, 190, 180, 210], [240, 190, 240, 200], [240, 240, 240, 260], [60, 250, 60, 260], [180, 250, 180, 270], [240, 300, 240, 310]], junctions: [[180, 190], [240, 190]] } },
    { name: 'CD4017 + 555 LED チェイサー (過渡解析)', desc: '555 のクロックで CD4017 の出力が順に光る定番回路 (LED 3 個分を表示)', sim: { type: 'tran', tstop: '0.8', start: 'power' }, probes: ['v(clk)', 'i(dd1)', 'i(dd2)', 'i(dd3)'], custom: true }
  ];
  // チェイサーは配線が多いのでネットラベルで組み立てる
  function chaserDoc() {
    const CD = window.CADDoc, d = CD.newDoc();
    const add = (t, x, y, r, ref, val, props) => CD.addComponent(d, t, x, y, r || 0, { ref, val, props });
    const lab = (x, y, n, r) => add('NET', x, y, r || 0, null, null, { net: n });
    const vcc = (x, y) => add('VCC', x, y, 0, null, null, { net: 'VCC' });
    const gnd = (x, y) => add('GND', x, y);
    const w = (a, b, c, e) => CD.addWire(d, a, b, c, e);
    // 555 (U1 @200,200): TRIG(140,170) THR(140,190) CV(140,210) RST(140,230) OUT(260,170) DIS(260,190) VCC(180,130) GND(180,270)
    add('IC555', 200, 200, 0, 'U1', 'NE555');
    vcc(180, 130); gnd(180, 270);
    lab(140, 170, 'TH', 180); lab(140, 190, 'TH', 180); lab(140, 210, 'CV', 180); w(140, 230, 110, 230); vcc(110, 230);
    lab(260, 170, 'CLK'); lab(260, 190, 'DIS');
    add('R', 40, 150, 90, 'R1', '1k'); vcc(40, 130); lab(40, 170, 'DIS', 180);
    add('R', 40, 230, 90, 'R2', '4.7k'); lab(40, 210, 'DIS', 180); lab(40, 250, 'TH', 180);
    add('C', 40, 310, 90, 'C1', '10u'); lab(40, 290, 'TH', 180); gnd(40, 330);
    add('C', 110, 310, 90, 'C2', '10n'); lab(110, 290, 'CV', 180); gnd(110, 330);
    // CD4017 (U2 @420,220): 左 x=360 ピン1..8 (y=150..290) / 右 x=480 ピン16..9
    add('DIP16', 420, 220, 0, 'U2', 'CD4017B');
    const R = p => 150 + (16 - p) * 20;
    lab(360, 190, 'Q0', 180); lab(360, 170, 'Q1', 180); lab(360, 210, 'Q2', 180);
    w(360, 290, 330, 290); gnd(330, 290);
    w(480, R(16), 520, R(16)); vcc(520, R(16));
    w(480, R(15), 540, R(15)); gnd(540, R(15));
    lab(480, R(14), 'CLK');
    w(480, R(13), 560, R(13)); gnd(560, R(13));
    [['Q0', '赤'], ['Q1', '緑'], ['Q2', '青']].forEach(([n, c], i) => {
      const x = 360 + i * 60;
      lab(x, 340, n); add('R', x, 360, 90, 'R' + (3 + i), '330'); add('LED', x, 400, 90, 'D' + (1 + i), c); gnd(x, 420);
    });
    return d;
  }
  function openSpiceSamples() {
    A.openModal('SPICE サンプル回路', body => {
      const g = el('div', 'samples');
      SPICE_SAMPLES.forEach((s, i) => {
        const b = el('button', 'scard'); b.type = 'button';
        b.appendChild(el('b', null, s.name)); b.appendChild(el('span', null, s.desc));
        b.onclick = () => {
          const CD = window.CADDoc;
          let doc;
          if (s.custom) doc = chaserDoc();
          else {
            doc = CD.newDoc();
            s.json.components.forEach(c => CD.addComponent(doc, c[0], c[1], c[2], c[3] || 0, { ref: c[4] || undefined, val: c[5], props: c[6] }));
            s.json.wires.forEach(w => CD.addWire(doc, w[0], w[1], w[2], w[3]));
            doc.junctions = s.json.junctions.map(j => ({ id: 'j' + (doc.nextId++), x: j[0], y: j[1] }));
          }
          A.loadJSONText(CD.serialize(doc));
          const cfg = window.UBSim.state.cfg; Object.assign(cfg, JSON.parse(JSON.stringify(s.sim)));
          if (s.sim.dc) cfg.dc = Object.assign({}, cfg.dc, s.sim.dc);
          window.UBSim.state.probes = []; window.UBSim.state.wantProbes = s.probes || null;
          window.UBSim.openDock(true); setTimeout(() => window.UBSim.run(), 60);
        };
        g.appendChild(b); void i;
      });
      body.appendChild(g);
      body.appendChild(el('p', 'note', '読み込むと現在の回路図は置き換わります (Ctrl+Z で戻せます)。読み込み後すぐにシミュレーションを実行します。'));
    });
  }
  window.UBSpiceSamples = openSpiceSamples;
  // 既存の「サンプル」画面に SPICE サンプルへの入口を足す
  $('bSample').addEventListener('click', () => setTimeout(() => {
    const body = $('modalBody'); if (!body || body.querySelector('.to-spice')) return;
    const b = el('button', 'scard to-spice'); b.type = 'button';
    b.appendChild(el('b', null, 'SPICE シミュレーション用サンプル →')); b.appendChild(el('span', null, 'フィルタ・アンプ・定電圧・LED チェイサーなど、読み込んですぐ波形が見られる回路'));
    b.onclick = openSpiceSamples;
    const g = body.querySelector('.samples'); if (g) g.appendChild(b);
  }, 0));

  /* ================= ヘッダの折り返し / 起動時のパネル ================= */
  // ツールが横に収まらないときは 2 段目へ折り返す (横スクロールで隠れるボタンを作らない)
  const bar = document.querySelector('.bar');
  let fitQ = 0;
  function fitBar() {
    cancelAnimationFrame(fitQ);
    fitQ = requestAnimationFrame(() => {
      bar.classList.remove('wrap');
      const over = [...bar.querySelectorAll('.tools')].some(t => !t.hidden && getComputedStyle(t).visibility !== 'hidden' && t.scrollWidth > t.clientWidth + 1)
        || bar.scrollWidth > bar.clientWidth + 1;
      bar.classList.toggle('wrap', over);
      A.resize(); A.rp();
    });
  }
  window.addEventListener('resize', fitBar);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitBar);
  const prevTab = H.onTab; H.onTab = t => { if (prevTab) prevTab(t); fitBar(); };
  fitBar();
  // スマートフォンでは部品パネル・情報パネルを閉じた状態で始める (画面を覆わないように)
  if (window.innerWidth <= 640 && S().palOpen) { S().palOpen = false; A.applyPanels(); }
  if (window.innerWidth <= 1100 && S().inspOpen) { S().inspOpen = false; A.applyPanels(); }

  /* ================= Android の戻るボタン ================= */
  // 開いているもの (コマンド検索 → ダイアログ → 値の編集 → 配置・配線中 → パネル → PCB / 基板タブ) を 1 つずつ閉じる。
  // 閉じるものが無ければ false を返し、アプリ側で終了する
  window.UBAndroidBack = () => {
    const st = S();
    if (!cp.hidden) { closeCmd(); return true; }
    if (!$('modal').hidden) { $('modal').hidden = true; return true; }
    if (document.querySelector('.popover')) { A.closePop(); return true; }
    if (st.place || st.wireStart || st.tool !== 'sel') { st.place = null; st.placeLib = null; st.wireStart = null; A.setTool('sel'); A.paletteSync(); return true; }
    if (st.selection.size) { st.selection.clear(); A.panels(); A.rp(); return true; }
    if (window.innerWidth <= 640 && st.palOpen) { st.palOpen = false; A.applyPanels(); return true; }
    if (window.innerWidth <= 1100 && st.inspOpen) { st.inspOpen = false; A.applyPanels(); return true; }
    if (window.UBPcb && window.UBPcb.state.active) { window.UBPcb.activate(false); A.setTab('sch'); return true; }
    if (window.UBSim && window.UBSim.state.open) { window.UBSim.openDock(false); return true; }
    if (st.tab !== 'sch') { A.setTab('sch'); return true; }
    return false;
  };
  if (window.AndroidBridge) document.documentElement.classList.add('android');

  /* ================= 自動保存 ================= */
  const CD = window.CADDoc;
  let last = null;
  const saved = store.get('autosave', null);
  if (saved && saved.doc) {
    try {
      const cur = CD.serialize(S().doc);
      if (saved.doc !== cur) { A.loadJSONText(saved.doc); toast('前回の作業を復元しました (Ctrl+Z でサンプルに戻せます)', 'ok'); }
      last = saved.doc;
    } catch (e) { }
  }
  setInterval(() => {
    try { const cur = CD.serialize(S().doc); if (cur !== last) { last = cur; store.set('autosave', { doc: cur, at: Date.now() }); } } catch (e) { }
  }, 2500);
})();
