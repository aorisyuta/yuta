/* ---- simui.js ---- */
/* =====================================================================
   UniBoard SPICE — シミュレーション画面
   下部ドック: 解析設定 / 波形ビューア / 動作点 / ネットリスト
   回路図上: 電圧表示・LED 点灯・プローブ
   ===================================================================== */
(function () {
  'use strict';
  const UB = window.UniBoard, A = UB.api, C1 = window.CADCore, SP = window.Spice, SN = window.SimNet;
  const S = () => UB.state;
  const $ = id => document.getElementById(id);
  const el = A.el;
  const H = window.UBHooks = window.UBHooks || {};
  const store = {
    get(k, d) { try { const v = localStorage.getItem('ubspice.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('ubspice.' + k, JSON.stringify(v)); } catch (e) { } }
  };

  /* ================= 状態 ================= */
  const SIM = {
    open: false, h: store.get('dockH', 300), tab: 'wave',
    cfg: Object.assign({
      type: 'tran', tstop: '', tstep: '', ac: { fstart: '10', fstop: '1meg', n: 30 }, dc: { src: '', start: '0', stop: '5', step: '0.05' },
      vcc: 5, vee: -5, tol: 0.1, start: 'auto', rails: {}
    }, store.get('cfg', {})),
    probes: [], res: null, net: null, running: false, tcur: null, log: [], custom: null, useCustom: false,
    view: null, showV: store.get('showV', true), fftOf: null
  };
  const COLORS = ['#f5c400', '#16c4d8', '#e0479e', '#3fbf5f', '#ff7a1a', '#5b8cff', '#e5484d', '#9ad400', '#a26bff', '#00a38a'];
  const colorOf = i => COLORS[i % COLORS.length];

  /* ================= DOM ================= */
  const stage = $('stage');
  const dock = el('section', 'simdock'); dock.id = 'simdock'; dock.hidden = true;
  dock.innerHTML = `
    <div class="dk-grip" id="dkGrip" title="ドラッグで高さを変更"></div>
    <div class="dk-head">
      <div class="dk-types" role="tablist" id="dkTypes"></div>
      <div class="dk-params" id="dkParams"></div>
      <div class="dk-run">
        <button class="btn primary" id="dkRun" title="シミュレーションを実行 (F5)"><svg viewBox="0 0 16 16"><path d="M4.5 3.2v9.6L12.8 8z" fill="currentColor"/></svg><span>実行</span></button>
        <button class="btn icon" id="dkStop" hidden title="中止">■</button>
      </div>
      <div class="dk-tabs" role="tablist" id="dkTabs"></div>
      <button class="pclose" id="dkClose" aria-label="シミュレーションを閉じる">×</button>
    </div>
    <div class="dk-body">
      <div class="dk-pane" id="dkWave">
        <div class="wv-legend" id="wvLegend"></div>
        <div class="wv-plot"><canvas id="wvCanvas"></canvas><div class="wv-empty" id="wvEmpty"></div></div>
        <div class="wv-foot" id="wvFoot"></div>
      </div>
      <div class="dk-pane" id="dkOp" hidden></div>
      <div class="dk-pane" id="dkNet" hidden></div>
      <div class="dk-pane" id="dkSet" hidden></div>
      <div class="dk-pane" id="dkLog" hidden></div>
    </div>`;
  stage.appendChild(dock);

  const TYPES = [['op', '動作点', 'DC 電圧・電流'], ['tran', '過渡解析', '時間波形'], ['ac', 'AC 解析', '周波数特性'], ['dc', 'DC スイープ', '電源を掃引']];
  const TABS = [['wave', '波形'], ['op', '動作点'], ['net', 'ネットリスト'], ['set', '設定'], ['log', 'メッセージ']];
  function buildHead() {
    const t = $('dkTypes'); t.innerHTML = '';
    TYPES.forEach(([k, lab, sub]) => {
      const b = el('button', null, lab); b.type = 'button'; b.title = sub; b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(SIM.cfg.type === k));
      b.onclick = () => { SIM.cfg.type = k; saveCfg(); buildHead(); };
      t.appendChild(b);
    });
    const tb = $('dkTabs'); tb.innerHTML = '';
    TABS.forEach(([k, lab]) => {
      const b = el('button', null, lab); b.type = 'button'; b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(SIM.tab === k));
      if (k === 'log' && SIM.log.some(m => m.lv === 'err' || m.lv === 'warn')) b.appendChild(el('i', 'dot'));
      b.onclick = () => { SIM.tab = k; buildHead(); showTab(); };
      tb.appendChild(b);
    });
    buildParams();
  }
  function numField(label, get, set, w, title) {
    const f = el('label', 'dk-f'); f.appendChild(el('span', null, label));
    const i = el('input'); i.type = 'text'; i.value = get(); i.style.width = (w || 64) + 'px'; if (title) i.title = title;
    i.spellcheck = false; i.oninput = () => { set(i.value.trim()); saveCfg(); };
    i.onkeydown = e => { if (e.key === 'Enter') run(); };
    f.appendChild(i); return f;
  }
  function buildParams() {
    const p = $('dkParams'); p.innerHTML = '';
    const c = SIM.cfg;
    if (c.type === 'tran') {
      p.appendChild(numField('停止時間', () => c.tstop, v => c.tstop = v, 64, '空欄なら回路から自動で決めます。例: 10m = 10ms, 2 = 2秒'));
      const sf = p.lastChild.querySelector('input'); sf.placeholder = SIM.autoT ? '自動 ' + SP.fmt(SIM.autoT, 's', 2) : '自動';
      p.appendChild(numField('最大刻み', () => c.tstep, v => c.tstep = v, 56, '空欄なら自動 (停止時間の 1/1000)'));
      const s = el('select'); s.title = '開始時の状態';
      [['auto', '自動'], ['power', '電源投入から'], ['op', '動作点から']].forEach(([v, t]) => { const o = el('option', null, t); o.value = v; s.appendChild(o); });
      s.value = c.start; s.onchange = () => { c.start = s.value; saveCfg(); };
      const f = el('label', 'dk-f'); f.appendChild(el('span', null, '開始')); f.appendChild(s); p.appendChild(f);
    } else if (c.type === 'ac') {
      p.appendChild(numField('開始', () => c.ac.fstart, v => c.ac.fstart = v, 52, 'Hz'));
      p.appendChild(numField('終了', () => c.ac.fstop, v => c.ac.fstop = v, 58, 'Hz (1meg = 1MHz)'));
      p.appendChild(numField('点/桁', () => String(c.ac.n), v => c.ac.n = +v || 30, 36));
    } else if (c.type === 'dc') {
      const s = el('select'); s.title = '掃引する電源';
      const srcs = sourceList();
      if (!srcs.length) { const o = el('option', null, '（電源がありません）'); o.value = ''; s.appendChild(o); }
      srcs.forEach(([v, t]) => { const o = el('option', null, t); o.value = v; s.appendChild(o); });
      if (!srcs.some(x => x[0] === c.dc.src)) c.dc.src = srcs.length ? srcs[0][0] : '';
      s.value = c.dc.src; s.onchange = () => { c.dc.src = s.value; saveCfg(); };
      const f = el('label', 'dk-f'); f.appendChild(el('span', null, '電源')); f.appendChild(s); p.appendChild(f);
      p.appendChild(numField('開始', () => c.dc.start, v => c.dc.start = v, 44));
      p.appendChild(numField('終了', () => c.dc.stop, v => c.dc.stop = v, 44));
      p.appendChild(numField('刻み', () => c.dc.step, v => c.dc.step = v, 48));
    } else {
      p.appendChild(el('span', 'dk-note', '回路の直流電圧・電流を計算し、回路図に表示します'));
    }
  }
  function sourceList() {
    const out = [];
    let nl; try { nl = netlistFor(); } catch (e) { return out; }
    nl.text.split('\n').forEach(l => { const m = l.match(/^([VI]\S*)\s/i); if (m) out.push([m[1].toLowerCase(), m[1].replace(/^V_/, 'V ').replace(/^([VI])/i, '$1')]); });
    return out;
  }
  const saveCfg = () => store.set('cfg', SIM.cfg);

  function showTab() {
    ['wave', 'op', 'net', 'set', 'log'].forEach(k => { $({ wave: 'dkWave', op: 'dkOp', net: 'dkNet', set: 'dkSet', log: 'dkLog' }[k]).hidden = SIM.tab !== k; });
    if (SIM.tab === 'op') paneOp();
    if (SIM.tab === 'net') paneNetlist();
    if (SIM.tab === 'set') paneSettings();
    if (SIM.tab === 'log') paneLog();
    if (SIM.tab === 'wave') { sizePlot(); drawPlot(); }
  }

  function openDock(on) {
    SIM.open = on == null ? !SIM.open : on;
    const vis = SIM.open && S().tab === 'sch';
    dock.hidden = !vis;
    document.documentElement.style.setProperty('--dockH', vis ? SIM.h + 'px' : '0px');
    const b = $('bSim'); if (b) b.setAttribute('aria-pressed', String(SIM.open));
    if (SIM.open && S().tab !== 'sch') A.setTab('sch');
    A.resize(); A.rp();
    if (SIM.open) { buildHead(); showTab(); }
    placeLayers();
  }
  function placeLayers() { stage.classList.toggle('docked', SIM.open && S().tab === 'sch'); }
  // 回路図以外のタブではドックを隠す (開いている状態は覚えておく)
  const prevOnTab = H.onTab;
  H.onTab = t => {
    if (prevOnTab) prevOnTab(t);
    const vis = SIM.open && t === 'sch';
    dock.hidden = !vis;
    document.documentElement.style.setProperty('--dockH', vis ? SIM.h + 'px' : '0px');
    stage.classList.toggle('docked', vis);
    if (vis) setTimeout(() => { sizePlot(); drawPlot(); }, 0);
  };
  $('dkClose').onclick = () => openDock(false);
  $('dkRun').onclick = () => run();
  $('dkStop').onclick = () => stop();
  // 高さ変更
  (() => {
    const g = $('dkGrip'); let st = null;
    g.addEventListener('pointerdown', e => { st = { y: e.clientY, h: SIM.h }; g.setPointerCapture(e.pointerId); });
    g.addEventListener('pointermove', e => {
      if (!st) return;
      const max = stage.getBoundingClientRect().height - 80;
      SIM.h = Math.max(150, Math.min(max, st.h - (e.clientY - st.y)));
      document.documentElement.style.setProperty('--dockH', SIM.h + 'px');
      A.resize(); A.rp(); sizePlot(); drawPlot();
    });
    const end = () => { if (st) { st = null; store.set('dockH', SIM.h); } };
    g.addEventListener('pointerup', end); g.addEventListener('pointercancel', end);
  })();

  /* ================= ネットリスト生成 ================= */
  function netlistFor() {
    const c = SIM.cfg;
    const nl = SN.schematicToNetlist(S().doc, { vcc: +c.vcc, vee: +c.vee, rails: c.rails, tol: (+c.tol || 0) / 100 });
    return nl;
  }
  // 停止時間の自動決定: 信号源の周期と RC 時定数から
  function autoTstop(text) {
    let per = Infinity, R = 0, C = 0;
    text.split('\n').forEach(l => {
      const t = l.trim().split(/\s+/), h = (t[0] || '').toLowerCase();
      let m;
      if ((m = l.match(/sin\(([^)]*)\)/i))) { const a = m[1].trim().split(/[\s,]+/).map(SP.parseNum); if (a[2] > 0) per = Math.min(per, 1 / a[2]); }
      if ((m = l.match(/pulse\(([^)]*)\)/i))) { const a = m[1].trim().split(/[\s,]+/).map(SP.parseNum); if (a[6] > 0 && isFinite(a[6])) per = Math.min(per, a[6]); else if (a[2] > 0) per = Math.min(per, a[2] * 3); }
      if (h[0] === 'r' && t.length >= 4) { const v = SP.parseNum(t[3]); if (v > 0 && v < 1e7) R = Math.max(R, v); }
      if (h[0] === 'c' && t.length >= 4) { const v = SP.parseNum(t[3]); if (v > 0) C = Math.max(C, v); }
    });
    const tau = R * C;
    let ts = isFinite(per) ? Math.max(5 * per, Math.min(3 * tau, 50 * per)) : tau > 0 ? 5 * tau : 10e-3;
    ts = Math.min(20, Math.max(1e-6, ts));
    const e = Math.pow(10, Math.floor(Math.log10(ts)));
    return [1, 2, 5, 10].map(k => k * e).find(v => v >= ts * 0.999);
  }
  function analysis(text, quiet) {
    const c = SIM.cfg, P = v => SP.parseNum(v);
    if (c.type === 'tran') {
      let tstop = P(c.tstop);
      if (!String(c.tstop || '').trim() && text) { tstop = autoTstop(text); SIM.autoT = tstop; if (!quiet) SIM.log.push({ lv: 'info', t: '停止時間を回路から自動で ' + SP.fmt(tstop, 's', 3) + ' にしました (変更するには停止時間に入力)' }); }
      if (!(tstop > 0)) throw new Error('停止時間を入力してください (例: 10m)');
      const tstep = P(c.tstep);
      // 自動: 信号源 (SIN / PULSE) がある回路は動作点から、直流だけの回路 (発振器・タイマなど) は電源投入から
      const hasSig = /\b(sin|pulse|pwl|exp)\s*\(/i.test(text || '');
      const uic = c.start === 'power' || (c.start === 'auto' && !hasSig);
      return { type: 'tran', tstop, tstep: tstep > 0 ? tstep : tstop / 1000, uic };
    }
    if (c.type === 'ac') return { type: 'ac', sweep: 'dec', n: +c.ac.n || 30, fstart: P(c.ac.fstart) || 10, fstop: P(c.ac.fstop) || 1e6 };
    if (c.type === 'dc') {
      if (!c.dc.src) throw new Error('掃引する電源がありません (電圧源または電源記号を置いてください)');
      return { type: 'dc', src: c.dc.src, start: P(c.dc.start), stop: P(c.dc.stop), step: P(c.dc.step) || 0.1 };
    }
    return { type: 'op' };
  }

  /* ================= ワーカー ================= */
  let worker = null, jobId = 0, pending = null;
  const WORKER_MAIN = `
    self.onmessage = function (e) {
      var m = e.data;
      if (m.models) { for (var k in m.models) Spice.MODEL_LIB[k] = m.models[k]; return; }
      try {
        var res = Spice.simulate(m.text, m.analysis, { progress: function (p) { self.postMessage({ id: m.id, progress: p }); } });
        var tr = [];
        if (res.x && res.x.buffer) tr.push(res.x.buffer);
        (res.data || []).forEach(function (d) { tr.push(d.buffer); });
        (res.re || []).forEach(function (d) { tr.push(d.buffer); });
        (res.im || []).forEach(function (d) { tr.push(d.buffer); });
        self.postMessage({ id: m.id, ok: true, res: res }, tr);
      } catch (err) { self.postMessage({ id: m.id, ok: false, error: String(err && err.message || err) }); }
    };`;
  let workerDead = false, workerReady = false;
  function getWorker() {
    if (worker) return worker;
    if (workerDead) return null;
    try {
      // 1 ファイル版 (tools/build.py) はインラインの本文から、分割版は js/*.js を importScripts して作る
      const ws = [...document.querySelectorAll('script[data-worker]')];
      const src = ws.some(s => s.src)
        ? 'importScripts(' + ws.map(s => JSON.stringify(s.src)).join(',') + ');' + WORKER_MAIN
        : ws.map(s => s.textContent).join('\n;\n') + WORKER_MAIN;
      worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      worker.postMessage({ models: SP.MODEL_LIB });
      worker.onmessage = e => {
        workerReady = true;
        const m = e.data; if (!pending || m.id !== pending.id) return;
        if (m.progress != null) { setProgress(m.progress); return; }
        const p = pending; pending = null;
        m.ok ? p.resolve(m.res) : p.reject(new Error(m.error));
      };
      worker.onerror = e => {
        // file:// で開いたときなど、ワーカーが js を読めない場合は画面側のスレッドで計算する
        if (!workerReady) { workerDead = true; try { worker.terminate(); } catch (_) { } worker = null; }
        if (pending) {
          const p = pending; pending = null;
          if (workerDead) { try { p.resolve(SP.simulate(p.text, p.an)); } catch (err) { p.reject(err); } }
          else p.reject(new Error(e.message || 'ワーカーでエラー'));
        }
      };
    } catch (e) { worker = null; }
    return worker;
  }
  function simulateAsync(text, an) {
    const w = getWorker();
    if (!w) return new Promise((res, rej) => setTimeout(() => { try { res(SP.simulate(text, an)); } catch (e) { rej(e); } }, 20));
    return new Promise((resolve, reject) => { pending = { id: ++jobId, resolve, reject, text, an }; w.postMessage({ id: jobId, text, analysis: an }); });
  }
  function stop() {
    if (worker) { worker.terminate(); worker = null; }
    if (pending) { const p = pending; pending = null; p.reject(new Error('中止しました')); }
  }
  function setProgress(p) { const b = $('dkRun'); b.style.setProperty('--prog', Math.round(p * 100) + '%'); }

  /* ================= 実行 ================= */
  async function run(silent) {
    if (SIM.running) return;
    if (!SIM.open) openDock(true);
    A.refreshNets();
    let nl, an;
    SIM.log = [];
    try {
      if (SIM.useCustom && SIM.custom != null) nl = { text: SIM.custom, map: {}, warnings: [], elemOf: {}, info: {}, nets: [], custom: true };
      else nl = netlistFor();
      an = analysis(nl.text);
    } catch (e) { SIM.log.push({ lv: 'err', t: e.message }); buildHead(); SIM.tab = 'log'; buildHead(); showTab(); return; }
    nl.warnings.forEach(w => SIM.log.push(w));
    if (nl.warnings.some(w => w.lv === 'err')) { SIM.tab = 'log'; buildHead(); showTab(); toast('回路に問題があります。メッセージを確認してください', 'err'); return; }
    SIM.running = true; $('dkRun').classList.add('busy'); $('dkStop').hidden = false; setProgress(0);
    const t0 = performance.now();
    try {
      const res = await simulateAsync(nl.text, an);
      res.ms = performance.now() - t0;
      (res.warnings || []).forEach(w => SIM.log.push({ lv: 'warn', t: w }));
      SIM.log.push({ lv: 'ok', t: `${TYPES.find(t => t[0] === an.type)[1]} 完了 (${res.ms.toFixed(0)} ms${res.x ? '、' + res.x.length + ' 点' : ''})` });
      SIM.res = res; SIM.net = nl; SIM.tcur = null; SIM.view = null; SIM.fftOf = null;
      if (SIM.wantProbes && res.type !== 'op') { SIM.probes = SIM.wantProbes.filter(n => res.names.includes(n)).map((n, i) => ({ name: n, color: colorOf(i), on: true })); SIM.wantProbes = null; }
      pruneProbes();
      if (res.type !== 'op' && !SIM.probes.length) autoProbes();
      if (res.type === 'op') SIM.tab = 'op';
      else if (SIM.tab === 'op' || SIM.tab === 'log') SIM.tab = 'wave';
      if (res.type === 'tran') SIM.tcur = res.x[res.x.length - 1];
      buildHead(); showTab(); A.rp(); A.panels();
    } catch (e) {
      SIM.log.push({ lv: 'err', t: e.message });
      SIM.tab = 'log'; buildHead(); showTab();
      if (!silent) toast('シミュレーションできませんでした: ' + e.message, 'err');
    } finally {
      SIM.running = false; $('dkRun').classList.remove('busy'); $('dkStop').hidden = true;
    }
  }

  /* ================= プローブ ================= */
  function autoProbes() {
    const res = SIM.res, nl = SIM.net; if (!res) return;
    const names = res.names;
    const pick = [];
    // ネットラベル・出力らしいネット → LED の電流 → その他の信号
    (nl.nets || []).forEach(n => { if (!n.rail && n.spice !== '0' && !/^n\d+$/.test(n.spice)) pick.push('v(' + n.spice + ')'); });
    S().doc.components.forEach(c => {
      if (pick.length >= 4) return;
      const s = C1.symOf(c); if (!s || s.virtual) return;
      if (/OUT/i.test((s.pins.find(p => /OUT/.test(p.name || '')) || {}).name || '')) {
        const p = s.pins.find(p => /OUT/.test(p.name || '')), k = nl.nets.find(n => n.pins.some(q => q.comp === c && q.pin === p));
        if (k && k.spice !== '0') pick.push('v(' + k.spice + ')');
      }
    });
    if (res.type === 'tran') S().doc.components.forEach(c => { if (c.type === 'LED' && nl.elemOf[c.id]) pick.push('i(' + nl.elemOf[c.id][0] + ')'); });
    if (pick.length < 2) (nl.nets || []).forEach(n => { if (!n.rail && n.spice !== '0' && n.pins.length > 1) pick.push('v(' + n.spice + ')'); });
    if (!pick.length) names.filter(n => /^v\(/.test(n)).slice(0, 3).forEach(n => pick.push(n));
    SIM.probes = [...new Set(pick)].filter(n => names.includes(n)).slice(0, 5).map((n, i) => ({ name: n, color: colorOf(i), on: true }));
  }
  function pruneProbes() {
    if (!SIM.res) return;
    SIM.probes = SIM.probes.filter(p => SIM.res.names.includes(p.name));
  }
  function addProbe(name) {
    if (!SIM.res) { SIM.pendingProbe = SIM.pendingProbe || []; SIM.pendingProbe.push(name); toast('プローブを追加しました。実行すると波形が出ます', 'ok'); return; }
    if (!SIM.res.names.includes(name)) { toast('この結果にはその信号がありません: ' + label(name), 'err'); return; }
    const ex = SIM.probes.find(p => p.name === name);
    if (ex) { ex.on = true; } else {
      const used = new Set(SIM.probes.map(p => p.color));
      SIM.probes.push({ name, color: COLORS.find(c => !used.has(c)) || colorOf(SIM.probes.length), on: true });
    }
    if (SIM.tab !== 'wave') { SIM.tab = 'wave'; buildHead(); showTab(); } else drawPlot();
    A.rp();
  }
  // 表示名
  function label(n) {
    const m = n.match(/^([a-z]+)\((.+)\)$/); if (!m) return n;
    const nl = SIM.net || { map: {} };
    if (m[1] === 'v') return 'V(' + (nl.map[m[2]] || m[2]) + ')';
    const owner = elemOwner(m[2]);
    return m[1].toUpperCase() + '(' + (owner ? owner.ref + (owner.sub ? '.' + owner.sub : '') : m[2]) + ')';
  }
  function elemOwner(elName) {
    const nl = SIM.net; if (!nl) return null;
    for (const c of S().doc.components) {
      const els = nl.elemOf[c.id]; if (!els) continue;
      const i = els.indexOf(elName);
      if (i >= 0) return { ref: c.ref, comp: c, sub: els.length > 1 ? els[i].replace(/^[a-z]/, '').replace(c.ref.toLowerCase(), '').replace(/^_/, '') : '' };
    }
    const a = (nl.autoSrc || []).find(x => x.el === elName); if (a) return { ref: '電源 ' + a.name };
    return null;
  }
  const unitOf = n => /^v\(/.test(n) ? 'V' : 'A';

  // 回路図タップでプローブ
  H.probeTap = (wx, wy) => {
    const w = A.hitWire(wx, wy), c = !w && A.hitComponent(wx, wy);
    const nets = S().nets || [];
    if (w) {
      const ni = S().netOfWire.get(w.id); const n = nets.find(x => x.index === ni);
      if (n) { const nl = SIM.net || netlistFor(); const k = (nl.nets.find(x => x.name === n.name) || {}).spice; if (k && k !== '0') addProbe('v(' + k + ')'); else toast('GND は 0V の基準です', 'ok'); }
      return;
    }
    if (c) {
      const s = C1.symOf(c);
      if (s && s.virtual) {
        const nl = SIM.net || netlistFor(); const k = nl.nets.find(x => x.name === ((c.props && c.props.net) || s.net));
        if (k && k.spice !== '0') addProbe('v(' + k.spice + ')'); return;
      }
      // ピンの近くなら電圧、本体なら電流
      const pins = C1.compPins(c);
      let best = null, bd = 1e9; pins.forEach(p => { const d = Math.hypot(p.x - wx, p.y - wy); if (d < bd) { bd = d; best = p; } });
      if (best && bd < 7) {
        const nl = SIM.net || netlistFor(); const k = nl.nets.find(n => n.pins.some(q => q.comp.id === c.id && q.pin.n === best.pin.n));
        if (k && k.spice !== '0') { addProbe('v(' + k.spice + ')'); return; }
      }
      const nl = SIM.net || netlistFor(); const els = nl.elemOf[c.id];
      if (!els || !els.length) { toast(c.ref + ' はシミュレーション対象外です', 'err'); return; }
      const e0 = els[0];
      addProbe((/^q/.test(e0) ? 'ic(' : 'i(') + e0 + ')');
    }
  };

  /* ================= 結果の取り出し ================= */
  function idxAt(t) {
    const x = SIM.res.x; let lo = 0, hi = x.length - 1;
    if (t <= x[0]) return 0; if (t >= x[hi]) return hi;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (x[m] <= t) lo = m; else hi = m; }
    return t - x[lo] < x[hi] - t ? lo : hi;
  }
  function valueOf(name) {
    const r = SIM.res; if (!r) return null;
    const k = r.names.indexOf(name); if (k < 0) return null;
    if (r.type === 'op') return r.values[k];
    if (r.type === 'tran') return r.data[k][idxAt(SIM.tcur == null ? r.x[r.x.length - 1] : SIM.tcur)];
    if (r.type === 'dc') return r.data[k][idxAt(SIM.tcur == null ? r.x[r.x.length - 1] : SIM.tcur)];
    return null;
  }
  H.simValue = valueOf;

  /* ================= 回路図オーバーレイ ================= */
  const SEG = { a: [-4, -30, 16, -30], b: [18, -28, 18, -4], c: [18, 4, 18, 28], d: [-4, 30, 16, 30], e: [-6, 4, -6, 28], f: [-6, -28, -6, -4], g: [-4, 0, 16, 0], dp: [24, 30, 24, 30] };
  H.schOverlay = (pen, ctx, z) => {
    const r = SIM.res, nl = SIM.net; if (!r || !nl || r.type === 'ac' || nl.custom) { probeMarks(pen, z); return; }
    const doc = S().doc, TH = window.CADRender.TH;
    // LED / 7セグ / ランプ
    doc.components.forEach(c => {
      const inf = nl.info[c.id], els = nl.elemOf[c.id]; if (!inf || !els) return;
      if (inf.led && !inf.seg7) {
        const I = valueOf('i(' + els[0] + ')'); if (I == null) return;
        const b = Math.max(0, Math.min(1, Math.log10(Math.max(I, 1e-9) / 5e-5) / 2.6));
        if (b <= 0.02) return;
        const col = SN.LEDCOLOR[inf.led] || '#ff3b30';
        ctx.save(); ctx.globalCompositeOperation = 'source-over';
        const g = ctx.createRadialGradient(c.x, c.y, 1, c.x, c.y, 26);
        g.addColorStop(0, hexA(col, 0.85 * b)); g.addColorStop(0.35, hexA(col, 0.45 * b)); g.addColorStop(1, hexA(col, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.x, c.y, 26, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
      if (inf.seg7) {
        const col = SN.LEDCOLOR[inf.led] || '#ff3b30';
        inf.seg7.forEach(sg => {
          const I = valueOf('i(' + sg.el + ')'); if (I == null || I < 2e-4) return;
          const q = SEG[sg.name]; if (!q) return;
          const [ax, ay] = C1.rotXY(q[0], q[1], c.rot || 0), [bx, by] = C1.rotXY(q[2], q[3], c.rot || 0);
          ctx.save(); ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.lineWidth = 5; ctx.shadowColor = col; ctx.shadowBlur = 10 * z;
          ctx.beginPath(); ctx.moveTo(c.x + ax, c.y + ay); ctx.lineTo(c.x + bx + (ax === bx && ay === by ? 0.1 : 0), c.y + by); ctx.stroke(); ctx.restore();
        });
      }
    });
    // ネット電圧
    if (SIM.showV) {
      const S0 = S(), nets = S0.nets || [];
      nets.forEach(n => {
        const k = (nl.nets.find(x => x.name === n.name) || {}).spice; if (!k || k === '0') return;
        const v = valueOf('v(' + k + ')'); if (v == null) return;
        const pt = netAnchor(n); if (!pt) return;
        const t = SP.fmt(v, 'V', 3);
        const fs = 8.5, w = t.length * fs * 0.62 + 6;
        pen.rect(pt[0] - w / 2, pt[1] - 17, w, 12, { fill: TH.surface, stroke: TH.ok, sw: 0.8, rx: 3, alpha: 0.95 });
        pen.text(pt[0], pt[1] - 8, t, { size: fs, fill: TH.ok, mono: true, weight: 600 });
      });
    }
    probeMarks(pen, z);
  };
  function probeMarks(pen, z) {
    if (!SIM.probes.length || !SIM.net) return;
    const nets = S().nets || [];
    SIM.probes.forEach(p => {
      if (!p.on) return;
      const m = p.name.match(/^v\((.+)\)$/);
      if (m) {
        const nn = SIM.net.nets.find(x => x.spice === m[1]); if (!nn) return;
        const n = nets.find(x => x.name === nn.name); const pt = n && netAnchor(n); if (!pt) return;
        pen.circle(pt[0], pt[1], 4.2, { fill: p.color, stroke: '#000', w: 0.6 });
      } else {
        const o = elemOwner(p.name.replace(/^[a-z]+\(|\)$/g, ''));
        if (!o || !o.comp) return;
        const bb = C1.compBBox(o.comp);
        pen.rect(bb.x0 - 3, bb.y0 - 3, bb.x1 - bb.x0 + 6, bb.y1 - bb.y0 + 6, { stroke: p.color, sw: 1.6, rx: 4, dash: [4, 3] });
      }
    });
    void z;
  }
  function netAnchor(n) {
    const doc = S().doc;
    const ws = (n.wires || []).map(id => doc.wires.find(w => w.id === id)).filter(Boolean);
    if (ws.length) {
      let best = ws[0], bl = -1;
      ws.forEach(w => { const l = Math.abs(w.x2 - w.x1) + Math.abs(w.y2 - w.y1); if (l > bl && w.y1 === w.y2) { bl = l; best = w; } });
      if (bl < 0) ws.forEach(w => { const l = Math.abs(w.x2 - w.x1) + Math.abs(w.y2 - w.y1); if (l > bl) { bl = l; best = w; } });
      return [(best.x1 + best.x2) / 2, (best.y1 + best.y2) / 2];
    }
    const p = n.pins[0]; if (!p) return null;
    return C1.pinPos(p.comp, p.pin);
  }
  function hexA(hex, a) {
    const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a.toFixed(3)})`;
  }

  /* ================= 波形ビューア ================= */
  const cv = $('wvCanvas'), g = cv.getContext('2d');
  let pw = 0, ph = 0, hover = null, drag = null;
  function sizePlot() {
    const r = cv.getBoundingClientRect(), dpr = Math.min(2.5, window.devicePixelRatio || 1);
    pw = r.width; ph = r.height;
    cv.width = Math.max(1, Math.round(pw * dpr)); cv.height = Math.max(1, Math.round(ph * dpr));
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  new ResizeObserver(() => { if (SIM.open && SIM.tab === 'wave') { sizePlot(); drawPlot(); } }).observe(cv);

  function niceTicks(lo, hi, n) {
    if (!(hi > lo)) { hi = lo + 1; }
    const span = hi - lo, step0 = span / (n || 5), mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) || mag * 10;
    const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return out;
  }
  function series() {
    const r = SIM.res; if (!r) return [];
    const out = [];
    SIM.probes.forEach(p => {
      if (!p.on) return;
      const k = r.names.indexOf(p.name); if (k < 0) return;
      if (r.type === 'ac') {
        const re = r.re[k], im = r.im[k], mag = new Float64Array(re.length), phs = new Float64Array(re.length);
        for (let i = 0; i < re.length; i++) { mag[i] = 20 * Math.log10(Math.max(1e-30, Math.hypot(re[i], im[i]))); phs[i] = Math.atan2(im[i], re[i]) * 180 / Math.PI; }
        // 位相の折り返し補正
        for (let i = 1; i < phs.length; i++) { while (phs[i] - phs[i - 1] > 180) phs[i] -= 360; while (phs[i] - phs[i - 1] < -180) phs[i] += 360; }
        out.push({ p, y: mag, unit: 'dB', axis: 0 }, { p, y: phs, unit: '°', axis: 1, dash: true });
      } else out.push({ p, y: r.data[k], unit: unitOf(p.name), axis: unitOf(p.name) === 'V' ? 0 : 1 });
    });
    return out;
  }
  function fftSeries() {
    const r = SIM.res, p = SIM.fftOf; if (!r || r.type !== 'tran' || !p) return null;
    const k = r.names.indexOf(p.name); if (k < 0) return null;
    const x = r.x, y = r.data[k], t0 = SIM.view ? SIM.view.x0 : x[0], t1 = SIM.view ? SIM.view.x1 : x[x.length - 1];
    let N = 1; while (N < 4096) N <<= 1;
    const re = new Float64Array(N), im = new Float64Array(N), dt = (t1 - t0) / N;
    let j = 0;
    for (let i = 0; i < N; i++) {
      const t = t0 + i * dt; while (j < x.length - 2 && x[j + 1] < t) j++;
      const f = x[j + 1] > x[j] ? (t - x[j]) / (x[j + 1] - x[j]) : 0;
      re[i] = (y[j] + (y[j + 1] - y[j]) * Math.max(0, Math.min(1, f))) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
    }
    fft(re, im);
    const M = N / 2, fx = new Float64Array(M - 1), mag = new Float64Array(M - 1);
    for (let i = 1; i < M; i++) { fx[i - 1] = i / (N * dt); mag[i - 1] = 20 * Math.log10(Math.max(1e-12, 4 * Math.hypot(re[i], im[i]) / N)); }
    return { x: fx, s: [{ p, y: mag, unit: 'dB', axis: 0 }] };
  }
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
    for (let len = 2; len <= n; len <<= 1) {
      const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
          re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  }
  let layout = null;
  function drawPlot() {
    if (!SIM.open || SIM.tab !== 'wave') return;
    const TH = window.CADRender.TH;
    g.clearRect(0, 0, pw, ph);
    const r = SIM.res, empty = $('wvEmpty');
    legend();
    if (!r || r.type === 'op') {
      empty.hidden = false;
      empty.innerHTML = r ? '動作点の結果は「動作点」タブと回路図上に表示しています。<br>波形を見るには <b>過渡解析</b> か <b>AC 解析</b> を選んで実行してください。'
        : '<b>▶ 実行</b> でシミュレーションします。<br>ツールバーの <b>プローブ</b> で配線や部品をタップすると、その電圧・電流の波形を表示します。';
      layout = null; foot(); return;
    }
    const F = fftSeries();
    const logx = r.type === 'ac' || !!F;
    const X = F ? F.x : r.x, ss = F ? F.s : series();
    empty.hidden = ss.length > 0;
    if (!ss.length) { empty.innerHTML = '表示する信号がありません。<b>プローブ</b>で回路図の配線や部品をタップしてください。'; layout = null; foot(); return; }
    // x 範囲
    let x0 = X[0], x1 = X[X.length - 1];
    if (SIM.view && !F) { x0 = SIM.view.x0; x1 = SIM.view.x1; }
    const tx = v => logx ? Math.log10(Math.max(v, 1e-30)) : v;
    const L = 58, Rm = ss.some(s => s.axis === 1) ? 58 : 16, T = 10, B = 26;
    const W = pw - L - Rm, Hh = ph - T - B;
    const X0 = tx(x0), X1 = tx(x1);
    const sx = v => L + (tx(v) - X0) / (X1 - X0 || 1) * W;
    // y 範囲 (軸ごと)
    const rng = [[Infinity, -Infinity], [Infinity, -Infinity]];
    const i0 = Math.max(0, lowerIdx(X, x0) - 1), i1 = Math.min(X.length - 1, lowerIdx(X, x1) + 1);
    ss.forEach(s => { for (let i = i0; i <= i1; i++) { const v = s.y[i]; if (isFinite(v)) { if (v < rng[s.axis][0]) rng[s.axis][0] = v; if (v > rng[s.axis][1]) rng[s.axis][1] = v; } } });
    rng.forEach(q => { if (!isFinite(q[0])) { q[0] = 0; q[1] = 1; } const pad = (q[1] - q[0]) * 0.08 || Math.max(Math.abs(q[0]) * 0.1, 1e-3); q[0] -= pad; q[1] += pad; });
    if (r.type === 'ac' && !F && ss.some(s => s.axis === 1)) { rng[1] = [Math.floor(rng[1][0] / 45) * 45, Math.ceil(rng[1][1] / 45) * 45]; }
    const sy = (v, a) => T + Hh - (v - rng[a][0]) / (rng[a][1] - rng[a][0]) * Hh;
    // グリッド
    g.fillStyle = TH.surface; g.fillRect(L, T, W, Hh);
    g.strokeStyle = TH.line; g.lineWidth = 1; g.font = '10px "IBM Plex Mono",monospace'; g.fillStyle = TH.muted;
    const unitX = F || r.type === 'ac' ? 'Hz' : r.type === 'tran' ? 's' : (r.xname && r.xname.startsWith('i') ? 'A' : 'V');
    if (logx) {
      for (let d = Math.floor(X0); d <= Math.ceil(X1); d++) {
        for (let m = 1; m < 10; m++) {
          const v = Math.pow(10, d) * m; if (v < x0 || v > x1) continue;
          const x = sx(v); g.globalAlpha = m === 1 ? 1 : 0.35; g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + Hh); g.stroke();
          if (m === 1) { g.globalAlpha = 1; g.textAlign = 'center'; g.fillText(SP.fmt(v, unitX, 3), x, T + Hh + 15); }
        }
      }
      g.globalAlpha = 1;
    } else {
      niceTicks(x0, x1, Math.max(3, W / 90 | 0)).forEach(v => {
        const x = sx(v); g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + Hh); g.stroke();
        g.textAlign = 'center'; g.fillText(SP.fmt(v, unitX, 3), x, T + Hh + 15);
      });
    }
    const units = [ss.find(s => s.axis === 0), ss.find(s => s.axis === 1)].map(s => s && s.unit);
    [0, 1].forEach(a => {
      if (!ss.some(s => s.axis === a)) return;
      niceTicks(rng[a][0], rng[a][1], Math.max(3, Hh / 40 | 0)).forEach(v => {
        const y = sy(v, a);
        if (a === 0) { g.globalAlpha = 1; g.beginPath(); g.moveTo(L, y); g.lineTo(L + W, y); g.stroke(); }
        g.textAlign = a === 0 ? 'right' : 'left';
        g.fillText(units[a] === 'dB' || units[a] === '°' ? (Math.round(v * 10) / 10) + units[a] : SP.fmt(v, units[a], 3), a === 0 ? L - 6 : L + W + 6, y + 3);
      });
    });
    g.strokeStyle = TH.line2 || TH.line; g.strokeRect(L + 0.5, T + 0.5, W, Hh);
    // 波形
    g.save(); g.beginPath(); g.rect(L, T, W, Hh); g.clip();
    ss.forEach(s => {
      g.strokeStyle = s.p.color; g.lineWidth = 1.6; g.setLineDash(s.dash ? [5, 4] : []);
      g.beginPath();
      // 画素ごとの間引き (min/max)
      let lastPx = -1, mn = 0, mx = 0, first = true;
      for (let i = i0; i <= i1; i++) {
        const px = Math.round(sx(X[i])), py = sy(s.y[i], s.axis);
        if (px !== lastPx) {
          if (!first) { g.lineTo(lastPx, mn); g.lineTo(lastPx, mx); }
          if (first) { g.moveTo(px, py); first = false; }
          else g.lineTo(px, py);
          lastPx = px; mn = mx = py;
        } else { if (py < mn) mn = py; if (py > mx) mx = py; }
      }
      g.stroke();
    });
    g.setLineDash([]);
    // 時刻カーソル (回路図表示に使う時刻)
    if (!F && (r.type === 'tran' || r.type === 'dc') && SIM.tcur != null) {
      const x = sx(SIM.tcur); g.strokeStyle = TH.accent; g.lineWidth = 1.2; g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + Hh); g.stroke(); g.setLineDash([]);
    }
    // ホバー
    if (hover && hover.x >= L && hover.x <= L + W) {
      const xv = logx ? Math.pow(10, X0 + (hover.x - L) / W * (X1 - X0)) : X0 + (hover.x - L) / W * (X1 - X0);
      const i = lowerIdx(X, xv), j = Math.min(X.length - 1, i + 1), k = Math.abs(X[j] - xv) < Math.abs(X[i] - xv) ? j : i;
      const x = sx(X[k]);
      g.strokeStyle = TH.ink2; g.lineWidth = 1; g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + Hh); g.stroke();
      const rows = [SP.fmt(X[k], unitX, 5)];
      ss.forEach(s => { const y = sy(s.y[k], s.axis); g.fillStyle = s.p.color; g.beginPath(); g.arc(x, y, 3.2, 0, 7); g.fill(); rows.push([s.p.color, label(s.p.name) + (s.unit === '°' ? ' 位相' : ''), s.unit === 'dB' || s.unit === '°' ? s.y[k].toFixed(2) + ' ' + s.unit : SP.fmt(s.y[k], s.unit, 4)]); });
      // 吹き出し
      g.font = '11px "IBM Plex Mono",monospace';
      const tw = Math.max(...rows.map(r => g.measureText(typeof r === 'string' ? r : r[1] + '  ' + r[2]).width)) + 22, th = rows.length * 15 + 8;
      let bx = x + 10, by = T + 8; if (bx + tw > L + W) bx = x - 10 - tw;
      g.fillStyle = TH.surface; g.strokeStyle = TH.line; g.globalAlpha = 0.96; g.fillRect(bx, by, tw, th); g.strokeRect(bx + 0.5, by + 0.5, tw, th); g.globalAlpha = 1;
      rows.forEach((rw, q) => {
        const yy = by + 15 + q * 15;
        if (typeof rw === 'string') { g.fillStyle = TH.muted; g.textAlign = 'left'; g.fillText(rw, bx + 8, yy); return; }
        g.fillStyle = rw[0]; g.fillRect(bx + 8, yy - 8, 8, 8);
        g.fillStyle = TH.ink; g.textAlign = 'left'; g.fillText(rw[1] + '  ' + rw[2], bx + 20, yy);
      });
    }
    // ドラッグ範囲
    if (drag && drag.moved) { g.fillStyle = hexA('#5b8cff', 0.15); g.fillRect(Math.min(drag.x0, drag.x1), T, Math.abs(drag.x1 - drag.x0), Hh); }
    g.restore();
    layout = { L, W, T, Hh, X0, X1, logx, F: !!F, X };
    foot(ss, X, i0, i1, F);
  }
  function lowerIdx(X, v) { let lo = 0, hi = X.length - 1; if (v <= X[0]) return 0; if (v >= X[hi]) return hi; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (X[m] <= v) lo = m; else hi = m; } return lo; }

  function legend() {
    const lg = $('wvLegend'); lg.innerHTML = '';
    const r = SIM.res;
    SIM.probes.forEach((p, i) => {
      const b = el('span', 'wv-chip' + (p.on ? '' : ' off'));
      const sw = el('i'); sw.style.background = p.color; b.appendChild(sw);
      b.appendChild(el('span', null, label(p.name)));
      b.title = 'クリックで表示切替';
      b.onclick = () => { p.on = !p.on; drawPlot(); A.rp(); };
      const x = el('button', 'x', '×'); x.title = '削除'; x.onclick = ev => { ev.stopPropagation(); SIM.probes.splice(i, 1); if (SIM.fftOf === p) SIM.fftOf = null; drawPlot(); A.rp(); };
      b.appendChild(x);
      if (r && r.type === 'tran') {
        const f = el('button', 'x fft' + (SIM.fftOf === p ? ' on' : ''), 'FFT'); f.title = 'この信号の周波数スペクトル';
        f.onclick = ev => { ev.stopPropagation(); SIM.fftOf = SIM.fftOf === p ? null : p; drawPlot(); };
        b.appendChild(f);
      }
      lg.appendChild(b);
    });
    const add = el('button', 'wv-add', '＋ 信号を追加'); add.type = 'button';
    add.onclick = () => pickSignal();
    lg.appendChild(add);
    const sp = el('span', 'wv-sp'); lg.appendChild(sp);
    const tv = el('button', 'wv-tool' + (SIM.showV ? ' on' : ''), '電圧表示'); tv.title = '回路図に各ネットの電圧を表示';
    tv.onclick = () => { SIM.showV = !SIM.showV; store.set('showV', SIM.showV); legend(); A.rp(); };
    lg.appendChild(tv);
    if (r && r.type !== 'op') {
      const csv = el('button', 'wv-tool', 'CSV'); csv.title = '表示中の波形を CSV で保存'; csv.onclick = exportCSV; lg.appendChild(csv);
      const png = el('button', 'wv-tool', 'PNG'); png.title = '波形を画像で保存'; png.onclick = () => cv.toBlob(b => b && A.saveFile('waveform.png', b)); lg.appendChild(png);
      if (SIM.view) { const rs = el('button', 'wv-tool', '全体'); rs.onclick = () => { SIM.view = null; drawPlot(); }; lg.appendChild(rs); }
    }
  }
  function foot(ss, X, i0, i1, F) {
    const f = $('wvFoot'); f.innerHTML = '';
    const r = SIM.res;
    if (!ss || !ss.length) { f.appendChild(el('span', 'dk-note', r && r.type === 'tran' ? '' : '')); return; }
    if (r.type === 'tran' && !F) {
      const tl = el('div', 'wv-time');
      const play = el('button', 'btn icon', '▶'); play.title = '回路図上で時間を再生'; play.onclick = () => animate(play);
      const rg = el('input'); rg.type = 'range'; rg.min = 0; rg.max = 1000; rg.value = Math.round((SIM.tcur - r.x[0]) / (r.x[r.x.length - 1] - r.x[0]) * 1000) || 1000;
      rg.title = '回路図に表示する時刻';
      const lab = el('b', null, 't = ' + SP.fmt(SIM.tcur, 's', 4));
      rg.oninput = () => { SIM.tcur = r.x[0] + (r.x[r.x.length - 1] - r.x[0]) * rg.value / 1000; lab.textContent = 't = ' + SP.fmt(SIM.tcur, 's', 4); drawPlotOnly(); A.rp(); };
      tl.appendChild(play); tl.appendChild(rg); tl.appendChild(lab); f.appendChild(tl);
    }
    const tbl = el('div', 'wv-meas');
    ss.forEach(s => {
      if (s.unit === '°') return;
      const y = s.y; let mn = Infinity, mx = -Infinity, sum = 0, sq = 0, n = 0;
      let integ = 0, integ2 = 0, dur = 0;
      for (let i = i0; i <= i1; i++) {
        const v = y[i]; if (v < mn) mn = v; if (v > mx) mx = v; sum += v; sq += v * v; n++;
        if (i > i0 && !F && r.type === 'tran') { const dt = X[i] - X[i - 1]; integ += (v + y[i - 1]) / 2 * dt; integ2 += (v * v + y[i - 1] * y[i - 1]) / 2 * dt; dur += dt; }
      }
      const d = el('div', 'wv-m'); const sw = el('i'); sw.style.background = s.p.color; d.appendChild(sw);
      d.appendChild(el('b', null, label(s.p.name)));
      const u = s.unit, fm = v => u === 'dB' ? v.toFixed(2) + ' dB' : SP.fmt(v, u, 4);
      const add = (k, v) => { const q = el('span'); q.appendChild(el('em', null, k)); q.appendChild(document.createTextNode(v)); d.appendChild(q); };
      add('最大', fm(mx)); add('最小', fm(mn));
      if (r.type === 'tran' && !F) {
        const avg = dur ? integ / dur : sum / n, rms = dur ? Math.sqrt(integ2 / dur) : Math.sqrt(sq / n);
        add('平均', fm(avg)); add('実効値', fm(rms)); add('p-p', fm(mx - mn));
        const fr = freqOf(X, y, i0, i1, avg); if (fr) add('周波数', SP.fmt(fr, 'Hz', 4));
      } else if (r.type === 'ac' && !F) {
        let pk = i0; for (let i = i0; i <= i1; i++) if (y[i] > y[pk]) pk = i;
        add('ピーク', SP.fmt(X[pk], 'Hz', 3));
        const lvl = y[pk] - 3; let fc = null;
        for (let i = pk + 1; i <= i1; i++) if (y[i] < lvl) { const t = (lvl - y[i - 1]) / (y[i] - y[i - 1]); fc = Math.pow(10, Math.log10(X[i - 1]) + t * (Math.log10(X[i]) - Math.log10(X[i - 1]))); break; }
        if (fc) add('−3dB', SP.fmt(fc, 'Hz', 3));
      }
      tbl.appendChild(d);
    });
    f.appendChild(tbl);
  }
  function drawPlotOnly() { const k = hover; drawPlot(); hover = k; }
  function freqOf(X, y, i0, i1, avg) {
    const cr = []; for (let i = i0 + 1; i <= i1; i++) if (y[i - 1] < avg && y[i] >= avg) cr.push(X[i - 1] + (avg - y[i - 1]) / (y[i] - y[i - 1]) * (X[i] - X[i - 1]));
    if (cr.length < 3) return null;
    return (cr.length - 2) / (cr[cr.length - 1] - cr[1]);
  }
  let anim = null;
  function animate(btn) {
    const r = SIM.res; if (!r || r.type !== 'tran') return;
    if (anim) { cancelAnimationFrame(anim); anim = null; btn.textContent = '▶'; return; }
    btn.textContent = '❚❚';
    const t0 = r.x[0], t1 = r.x[r.x.length - 1], dur = 6000, start = performance.now();
    const step = now => {
      const f = (now - start) / dur; if (f >= 1) { SIM.tcur = t1; anim = null; drawPlot(); A.rp(); return; }
      SIM.tcur = t0 + (t1 - t0) * f; drawPlot(); A.rp();
      const b2 = $('wvFoot').querySelector('.wv-time .btn'); if (b2) b2.textContent = '❚❚';
      anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }
  // 操作
  cv.addEventListener('pointermove', e => {
    const r = cv.getBoundingClientRect(); hover = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (drag) { drag.x1 = hover.x; if (Math.abs(drag.x1 - drag.x0) > 4) drag.moved = true; }
    drawPlotOnly();
  });
  cv.addEventListener('pointerleave', () => { hover = null; drawPlotOnly(); });
  cv.addEventListener('pointerdown', e => {
    if (!layout) return; const r = cv.getBoundingClientRect(); const x = e.clientX - r.left;
    drag = { x0: x, x1: x, moved: false }; cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointerup', () => {
    if (!drag || !layout) { drag = null; return; }
    const L = layout, toX = px => { const f = (px - L.L) / L.W; const v = L.X0 + f * (L.X1 - L.X0); return L.logx ? Math.pow(10, v) : v; };
    if (drag.moved && !L.F) {
      const a = toX(Math.min(drag.x0, drag.x1)), b = toX(Math.max(drag.x0, drag.x1));
      if (b > a) SIM.view = { x0: a, x1: b };
    } else if (!drag.moved && SIM.res && (SIM.res.type === 'tran' || SIM.res.type === 'dc') && !L.F) {
      SIM.tcur = Math.max(SIM.res.x[0], Math.min(SIM.res.x[SIM.res.x.length - 1], toX(drag.x0))); A.rp();
    }
    drag = null; drawPlot();
  });
  cv.addEventListener('dblclick', () => { SIM.view = null; drawPlot(); });
  cv.addEventListener('wheel', e => {
    if (!layout || layout.F || !SIM.res || SIM.res.type === 'op') return;
    e.preventDefault();
    const L = layout, r = cv.getBoundingClientRect(), f = Math.max(0, Math.min(1, (e.clientX - r.left - L.L) / L.W));
    const k = Math.pow(1.0015, e.deltaY);
    let a = L.X0, b = L.X1; const c = a + (b - a) * f; a = c - (c - a) * k; b = c + (b - c) * k;
    const X = SIM.res.x, lo = L.logx ? Math.log10(X[0]) : X[0], hi = L.logx ? Math.log10(X[X.length - 1]) : X[X.length - 1];
    a = Math.max(lo, a); b = Math.min(hi, b);
    SIM.view = b - a >= (hi - lo) * 0.999 ? null : { x0: L.logx ? Math.pow(10, a) : a, x1: L.logx ? Math.pow(10, b) : b };
    drawPlot();
  }, { passive: false });

  function pickSignal() {
    const r = SIM.res;
    if (!r) { toast('先に ▶ 実行 してください', 'err'); return; }
    A.openModal('波形に追加する信号', body => {
      const q = el('input', 'popinput'); q.placeholder = '絞り込み (例: out, R1, Q1)'; q.id = 'sigFilter'; body.appendChild(q);
      const box = el('div', 'siglist'); body.appendChild(box);
      const names = r.names.filter(n => !/#/.test(n));
      const draw = () => {
        box.innerHTML = '';
        const t = q.value.trim().toLowerCase();
        names.filter(n => !t || label(n).toLowerCase().includes(t) || n.includes(t)).slice(0, 400).forEach(n => {
          const b = el('button', 'chip' + (SIM.probes.some(p => p.name === n) ? ' on' : ''), label(n)); b.type = 'button';
          b.onclick = () => { addProbe(n); draw(); legend(); };
          box.appendChild(b);
        });
      };
      q.oninput = draw; draw(); setTimeout(() => q.focus(), 30);
    }, [(() => { const b = el('button', 'btn primary', '閉じる'); b.onclick = () => $('modal').hidden = true; return b; })()]);
  }
  function exportCSV() {
    const r = SIM.res; if (!r) return;
    const ss = SIM.probes.filter(p => p.on && r.names.includes(p.name));
    const head = [r.type === 'ac' ? 'freq[Hz]' : r.type === 'tran' ? 'time[s]' : r.xname];
    ss.forEach(p => { if (r.type === 'ac') head.push(label(p.name) + ' mag[dB]', label(p.name) + ' phase[deg]'); else head.push(label(p.name)); });
    const L = [head.join(',')];
    for (let i = 0; i < r.x.length; i++) {
      const row = [r.x[i]];
      ss.forEach(p => {
        const k = r.names.indexOf(p.name);
        if (r.type === 'ac') { row.push((20 * Math.log10(Math.hypot(r.re[k][i], r.im[k][i]))).toFixed(4), (Math.atan2(r.im[k][i], r.re[k][i]) * 180 / Math.PI).toFixed(3)); }
        else row.push(r.data[k][i]);
      });
      L.push(row.join(','));
    }
    A.saveFile('waveform.csv', L.join('\n'));
  }

  /* ================= 動作点タブ ================= */
  function paneOp() {
    const p = $('dkOp'); p.innerHTML = '';
    const r = SIM.res;
    if (!r) { p.appendChild(el('div', 'empty', '▶ 実行 すると、ここに各ネットの電圧と各部品の電流・消費電力を表示します。')); return; }
    if (r.type !== 'op' && r.type !== 'tran' && r.type !== 'dc') { p.appendChild(el('div', 'empty', 'AC 解析の結果は「波形」タブで見られます。')); return; }
    const wrap = el('div', 'op-grid');
    const v = el('div', 'op-col'); v.appendChild(el('h5', 'sec', 'ネットの電圧' + (r.type !== 'op' ? '（t = ' + SP.fmt(SIM.tcur, r.type === 'tran' ? 's' : 'V', 4) + '）' : '')));
    const tv = el('table', 'op-t');
    r.names.filter(n => /^v\(/.test(n)).forEach(n => {
      const tr = el('tr'); tr.appendChild(el('td', null, label(n))); tr.appendChild(el('td', 'num', SP.fmt(valueOf(n), 'V', 5)));
      const pb = el('td'); const b = el('button', 'chip', '波形'); b.onclick = () => addProbe(n); if (r.type !== 'op') pb.appendChild(b); tr.appendChild(pb);
      tv.appendChild(tr);
    });
    v.appendChild(tv); wrap.appendChild(v);
    const ic = el('div', 'op-col'); ic.appendChild(el('h5', 'sec', '部品の電流・電力'));
    const ti = el('table', 'op-t');
    const tr0 = el('tr'); ['部品', '電流', '電力'].forEach(h => tr0.appendChild(el('th', null, h))); ti.appendChild(tr0);
    r.names.filter(n => /^i[cb]?\(/.test(n) && !/#/.test(n)).forEach(n => {
      const val = valueOf(n); if (val == null) return;
      const tr = el('tr'); tr.appendChild(el('td', null, label(n))); tr.appendChild(el('td', 'num', SP.fmt(val, 'A', 4)));
      const nm = n.replace(/^i\(|\)$/g, '');
      const pw0 = r.power && r.power[nm];
      tr.appendChild(el('td', 'num' + (pw0 > 0.25 ? ' hot' : ''), pw0 != null ? SP.fmt(pw0, 'W', 3) + (pw0 > 0.25 ? ' ⚠' : '') : ''));
      ti.appendChild(tr);
    });
    ic.appendChild(ti);
    if (r.power && Object.values(r.power).some(v => v > 0.25)) ic.appendChild(el('p', 'note', '⚠ は 1/4W 抵抗の定格を超える消費電力です。大きい電力の抵抗を使ってください。'));
    wrap.appendChild(ic); p.appendChild(wrap);
  }

  /* ================= ネットリスト タブ ================= */
  function paneNetlist() {
    const p = $('dkNet'); p.innerHTML = '';
    const row = el('div', 'dk-row');
    const cb = el('label', 'dk-check'); const ck = el('input'); ck.type = 'checkbox'; ck.checked = SIM.useCustom; ck.id = 'nlCustom';
    cb.appendChild(ck); cb.appendChild(el('span', null, 'このネットリストを直接編集して実行する'));
    row.appendChild(cb);
    const regen = el('button', 'btn', '回路図から作り直す'); regen.onclick = () => { SIM.custom = null; SIM.useCustom = false; paneNetlist(); };
    const open = el('button', 'btn', '.cir / .net を開く'); open.onclick = () => fi.click();
    const fi = el('input'); fi.type = 'file'; fi.accept = '.cir,.net,.sp,.spi,.txt,.asc'; fi.hidden = true;
    fi.onchange = () => { const f = fi.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { SIM.custom = String(rd.result); SIM.useCustom = true; paneNetlist(); }; rd.readAsText(f); };
    const dl = el('button', 'btn', 'ダウンロード'); dl.onclick = () => A.saveFile('circuit.cir', ta.value);
    row.appendChild(regen); row.appendChild(open); row.appendChild(dl); row.appendChild(fi);
    p.appendChild(row);
    const ta = el('textarea', 'code nl-ta'); ta.spellcheck = false; ta.id = 'nlText';
    let text;
    if (SIM.useCustom && SIM.custom != null) text = SIM.custom;
    else { try { const nl = netlistFor(); text = nl.text + '\n' + an2card() + '\n.end'; } catch (e) { text = '* ' + e.message; } }
    ta.value = text; ta.readOnly = !SIM.useCustom;
    ck.onchange = () => { SIM.useCustom = ck.checked; if (SIM.useCustom && SIM.custom == null) SIM.custom = ta.value; ta.readOnly = !SIM.useCustom; };
    ta.oninput = () => { SIM.custom = ta.value; };
    p.appendChild(ta);
    p.appendChild(el('p', 'note', '書式は SPICE 互換です (R C L V I D Q M J E G F H K S X / .model .subckt .param .tran .ac .dc .op)。オペアンプ・555・ロジック IC・レギュレータは内蔵モデル (X素子: opamp / ne555 / logic_74hc00 / regulator など) を使います。編集モードでは解析の種類は上の設定が優先されます。'));
  }
  function an2card() {
    try {
      let t = ''; try { t = netlistFor().text; } catch (e) { }
      const a = analysis(t, true);
      if (a.type === 'tran') return `.tran ${SN.sn(a.tstep)} ${SN.sn(a.tstop)}${a.uic ? ' uic' : ''}`;
      if (a.type === 'ac') return `.ac dec ${a.n} ${SN.sn(a.fstart)} ${SN.sn(a.fstop)}`;
      if (a.type === 'dc') return `.dc ${a.src} ${a.start} ${a.stop} ${a.step}`;
      return '.op';
    } catch (e) { return '.op'; }
  }

  /* ================= 設定タブ ================= */
  function paneSettings() {
    const p = $('dkSet'); p.innerHTML = '';
    const c = SIM.cfg, grid = el('div', 'set-grid');
    const f = (lab, node, hint) => { const d = el('div', 'field'); d.appendChild(el('label', null, lab)); d.appendChild(node); if (hint) d.appendChild(el('p', 'cfghint', hint)); grid.appendChild(d); };
    const inp = (v, on) => { const i = el('input'); i.value = v; i.oninput = () => { on(i.value); saveCfg(); }; return i; };
    f('VCC / VDD の電圧', inp(c.vcc, v => c.vcc = +v || 0), '電源記号 VCC に自動で付く電圧源の値');
    f('VEE の電圧', inp(c.vee, v => c.vee = +v || 0), '電源記号 VEE (負電源) の値');
    f('部品のばらつき (%)', inp(c.tol, v => c.tol = Math.max(0, +v || 0)), '抵抗・コンデンサの値を少しずらします。対称な発振回路が起動しやすくなります');
    p.appendChild(grid);
    // 電源ネットの一覧
    const nets = (S().nets || []).filter(n => n.rail);
    if (nets.length) {
      p.appendChild(el('h5', 'sec', '電源ネットの電圧 (空欄は名前から自動)'));
      const g2 = el('div', 'set-grid');
      nets.forEach(n => {
        const k = String(n.name).toUpperCase().replace(/\s/g, '');
        if (/^(GND|AGND|DGND|0V|VSS|COM)$/.test(k)) return;
        const d = el('div', 'field'); d.appendChild(el('label', null, n.name));
        const auto = SN.railVolts(n.name, { vcc: c.vcc, vee: c.vee, rails: {} });
        const i = el('input'); i.placeholder = auto == null ? '未設定' : auto + ' V (自動)'; i.value = c.rails[k] != null ? c.rails[k] : '';
        i.oninput = () => { if (i.value.trim() === '') delete c.rails[k]; else c.rails[k] = +i.value; saveCfg(); };
        d.appendChild(i); g2.appendChild(d);
      });
      p.appendChild(g2);
    }
    p.appendChild(el('p', 'note', '電池・DC ジャック・電圧源が付いていない電源記号 (VCC, +5V, +12V, -12V など) には、自動で電圧源を付けてシミュレーションします。'));
  }
  function paneLog() {
    const p = $('dkLog'); p.innerHTML = '';
    if (!SIM.log.length) { p.appendChild(el('div', 'empty', 'メッセージはありません')); return; }
    SIM.log.forEach(m => {
      const d = el('div', 'msg ' + (m.lv === 'err' ? 'err' : m.lv === 'ok' ? 'ok' : 'warn'));
      d.appendChild(el('b', null, m.lv === 'err' ? 'ERR' : m.lv === 'ok' ? 'OK' : m.lv === 'info' ? 'INFO' : 'WARN'));
      d.appendChild(el('span', null, m.t)); p.appendChild(d);
    });
  }

  /* ================= プロパティ欄 (部品選択時) ================= */
  H.propExtra = (p, c) => {
    const s = C1.symOf(c); if (!s || s.virtual) return;
    const sec = () => p.appendChild(el('h5', 'sec', 'シミュレーション'));
    const redo = () => { if (SIM.res) run(true); };
    let head = false; const H1 = () => { if (!head) { sec(); head = true; } };
    const sel = (lab, opts, val, on) => {
      H1(); const f = el('div', 'field'); f.appendChild(el('label', null, lab));
      const s2 = el('select'); opts.forEach(([v, t]) => { const o = el('option', null, t); o.value = v; s2.appendChild(o); });
      s2.value = val; s2.onchange = () => { on(s2.value); redo(); A.rp(); }; f.appendChild(s2); p.appendChild(f);
    };
    const slider = (lab, min, max, step, val, fmtv, on, log) => {
      H1(); const f = el('div', 'field'); const l = el('label', null, lab + ': ' + fmtv(val)); f.appendChild(l);
      const r = el('input'); r.type = 'range'; r.min = min; r.max = max; r.step = step;
      r.value = log ? Math.log10(val) : val;
      r.oninput = () => { const v = log ? Math.pow(10, +r.value) : +r.value; on(v); l.textContent = lab + ': ' + fmtv(v); };
      r.onchange = redo; f.appendChild(r); p.appendChild(f);
    };
    const pr = c.props;
    if (c.type === 'SW') sel('スイッチの状態', [['on', 'ON (閉)'], ['off', 'OFF (開)']], pr.state || 'on', v => pr.state = v);
    if (c.type === 'SWP') sel('ボタン', [['off', '離している'], ['on', '押している']], pr.state || 'off', v => pr.state = v);
    if (c.type === 'SW3' || c.type === 'SW_DPDT') sel('切替位置', [['a', '1 側'], ['b', '2 側']], pr.state || 'a', v => pr.state = v);
    if (c.type === 'POT') slider('つまみ位置', 0, 1, 0.01, pr.wiper == null ? 0.5 : pr.wiper, v => Math.round(v * 100) + '%', v => pr.wiper = v);
    if (c.type === 'NTC' || c.type === 'SENS3') slider('温度', -20, 100, 1, pr.temp == null ? 25 : pr.temp, v => v + ' ℃', v => pr.temp = v);
    if (c.type === 'LDR' || c.type === 'PHOTOTR' || c.type === 'PHOTOD') slider('明るさ', -1, 4, 0.05, pr.light == null ? 100 : pr.light, v => SP.fmt(v, 'lx', 3), v => pr.light = v, true);
    // 結果
    const nl = SIM.net, r = SIM.res;
    if (nl && r && (r.type === 'op' || r.type === 'tran' || r.type === 'dc') && nl.elemOf[c.id]) {
      H1();
      nl.elemOf[c.id].slice(0, 6).forEach(e => {
        const nm = /^q/.test(e) ? 'ic(' + e + ')' : 'i(' + e + ')';
        const v = valueOf(nm); if (v == null) return;
        const d = el('div', 'kv'); d.appendChild(el('span', null, label(nm))); d.appendChild(el('span', null, SP.fmt(v, 'A', 4))); p.appendChild(d);
        if (r.power && r.power[e] != null) { const d2 = el('div', 'kv'); d2.appendChild(el('span', null, '消費電力')); d2.appendChild(el('span', null, SP.fmt(r.power[e], 'W', 3))); p.appendChild(d2); }
      });
      if (r.type !== 'op') { const b = el('button', 'btn', 'この部品の電流を波形に追加'); b.style.marginTop = '6px'; b.onclick = () => { const e = nl.elemOf[c.id][0]; addProbe((/^q/.test(e) ? 'ic(' : 'i(') + e + ')'); }; p.appendChild(b); }
    }
  };

  /* ================= トースト ================= */
  function toast(t, lv) {
    let box = $('toasts'); if (!box) { box = el('div', 'toasts'); box.id = 'toasts'; document.body.appendChild(box); }
    // 通知はヘッダのすぐ下に出す (下部の操作バーやシミュレーション画面を隠さない)
    const hb = document.querySelector('.bar'); if (hb) box.style.top = (hb.getBoundingClientRect().bottom + 10) + 'px';
    const d = el('div', 'toast ' + (lv || '')); d.textContent = t; box.appendChild(d);
    setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 300); }, lv === 'err' ? 5200 : 2600);
  }
  window.UBToast = toast;

  /* ================= ツールバー ================= */
  $('bSim').onclick = () => openDock();
  $('bRunQ').onclick = () => run();
  window.addEventListener('keydown', e => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) { e.preventDefault(); run(); }
  });

  window.UBSim = { run, openDock, addProbe, state: SIM, netlistFor, label };
})();
